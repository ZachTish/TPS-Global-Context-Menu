import { TFile, normalizePath, setIcon } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';
import { deleteValueCaseInsensitive, findKeyCaseInsensitive, setValueCaseInsensitive } from '../core';
import { RuleEngine } from './notebook-navigator-rule-engine';

type ApplyOptions = {
  reason?: string;
  force?: boolean;
  bypassCreationGrace?: boolean;
};

type RuleContext = {
  file: {
    path: string;
    name: string;
    basename: string;
    extension: string;
    stat: {
      ctime: number;
      mtime: number;
    };
  };
  frontmatter: Record<string, unknown> | null;
  tags: string[];
  body?: string;
  checkboxStates?: string[];
  lineType?: 'note' | 'task';
  relationshipLineage?: RelationshipLineageNode[];
  parent?: {
    file: RuleContext['file'];
    frontmatter: Record<string, unknown> | null;
    tags: string[];
  };
};

type RelationshipLineageNode = {
  file: RuleContext['file'];
  frontmatter: Record<string, unknown> | null;
  tags: string[];
};

/**
 * GCM-owned writer for Notebook Navigator rule outputs.
 *
 * Rule configuration, evaluation, and note/frontmatter mutations for icon,
 * color, sort, and hide tags happen here.
 */
export class NotebookNavigatorRuleService {
  private readonly timers = new Map<string, number>();
  private readonly recentUserEditAtByPath = new Map<string, number>();
  private readonly ruleEngine: RuleEngine;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {
    this.ruleEngine = new RuleEngine(plugin.app);
  }

  shouldAutoApplyOnFileOpen(): boolean {
    const settings = this.getSettings();
    return !!settings?.enabled && settings.autoApplyOnFileOpen !== false;
  }

  shouldAutoApplyOnMetadataChange(): boolean {
    if (!this.plugin.canRunBackgroundAutomation()) return false;
    const settings = this.getSettings();
    return !!settings?.enabled && settings.autoApplyOnMetadataChange !== false;
  }

  shouldApplyOnStartup(): boolean {
    if (!this.plugin.canRunBackgroundAutomation()) return false;
    const settings = this.getSettings();
    return !!settings?.enabled && settings.applyOnStartup !== false;
  }

  getMetadataDebounceMs(): number {
    const raw = Number(this.getSettings()?.metadataDebounceMs ?? 150);
    return Number.isFinite(raw) ? Math.max(0, Math.min(raw, 5000)) : 150;
  }

  getSortField(): string {
    return String(this.getSettings()?.smartSort?.field || 'sort').trim() || 'sort';
  }

  canApplyToFile(file: unknown): file is TFile {
    if (!(file instanceof TFile)) return false;
    if (this.plugin.filePropertiesService?.isCompanionFile(file)) return false;
    return String(file.extension || '').toLowerCase() === 'md'
      || this.plugin.filePropertiesService?.isPropertyTarget(file) === true;
  }

  scheduleApply(file: TFile, options: ApplyOptions = {}): void {
    if (!this.canApplyToFile(file)) return;
    if (!this.canUseExistingPropertyStorage(file)) return;
    if (this.requiresControllerAutomation(options.reason) && !this.plugin.canRunBackgroundAutomation()) return;
    const delay = options.reason === 'metadata-change'
      ? this.getMetadataDebounceMs()
      : options.reason === 'file-open'
        ? 75
      : options.reason === 'create'
        ? 2200
        : 250;
    const key = `${file.path}:${options.reason || 'scheduled'}`;
    const existing = this.timers.get(key);
    if (existing !== undefined) window.clearTimeout(existing);
    logger.perf('notebookRules:scheduleApply', {
      file: file.path,
      reason: options.reason || 'scheduled',
      delay,
    });
    const timer = window.setTimeout(() => {
      this.timers.delete(key);
      void this.applyRulesToFile(file, options);
    }, delay);
    this.timers.set(key, timer);
  }

  async applyRulesToAllFiles(options: ApplyOptions = {}): Promise<number> {
    if (!this.isReady()) return 0;
    let changed = 0;
    for (const file of this.getRuleCandidateFiles()) {
      if (await this.applyRulesToFile(file, {
        reason: options.reason || 'gcm-manual-all',
        force: true,
        bypassCreationGrace: true,
      })) {
        changed += 1;
      }
    }
    return changed;
  }

  async applyRulesToFile(file: TFile, options: ApplyOptions = {}): Promise<boolean> {
    if (!this.canApplyToFile(file)) return false;
    if (!this.canUseExistingPropertyStorage(file)) return false;
    if (!this.isReady()) return false;
    if (this.requiresControllerAutomation(options.reason) && !this.plugin.canRunBackgroundAutomation()) return false;
    if (this.shouldIgnore(file, options)) return false;

    const settings = this.getSettings();
    const ruleEngine = this.getRuleEngine();
    if (!settings || !ruleEngine) return false;
    const iconField = this.getIconField(settings);
    const colorField = this.getColorField(settings);
    const canMutateGeneratedTitle = options.reason === 'create';
    const canMutateHideTags = options.reason !== 'file-open'
      && (settings.hideRules || []).some((rule: any) => rule?.enabled && this.normalizeTag(rule?.tagName || 'hide'));
    const ownedKeys = [iconField, colorField];
    if (options.reason !== 'file-open' && settings.smartSort?.enabled) {
      ownedKeys.push(settings.smartSort?.field || 'sort');
    }
    if (canMutateGeneratedTitle) ownedKeys.push('title');
    if (canMutateHideTags) ownedKeys.push('tags');

    const started = performance.now();
    const body = await this.readBody(file);
    const changed = await this.plugin.frontmatterMutationService.processOwnedKeysPreservingSource(file, ownedKeys, (frontmatter) => {
      const context = this.buildRuleContext(file, frontmatter, body);
      // A record remains a record while the global architecture setting is temporarily
      // switched to Legacy. Protect proven record-owned fields from unrelated visual
      // automation based on the document identity itself, not the current write mode.
      const nativeRecordInspection = this.plugin.nativeRecordService?.inspect(frontmatter) || null;
      const isNativeRecord = !!nativeRecordInspection;
      const nativeRecordProtectedKeys = nativeRecordInspection
        ? this.getNativeRecordProtectedKeys(nativeRecordInspection)
        : null;
      const canMutateDestination = (key: string): boolean => (
        !nativeRecordProtectedKeys?.has(String(key || '').trim().toLowerCase())
      );
      if (canMutateGeneratedTitle && !isNativeRecord) {
        this.removeGeneratedBlankNoteTitle(file, frontmatter, body, options);
      }
      const visualOutputs = ruleEngine.resolveVisualOutputs(settings.rules || [], context);
      const desiredIcon = visualOutputs?.icon?.matched
        ? String(visualOutputs.icon.value || '').trim()
        : settings.clearIconWhenNoMatch ? null : undefined;
      const desiredColor = visualOutputs?.color?.matched
        ? this.normalizeNoteColorValue(String(visualOutputs.color.value || '').trim())
        : settings.clearColorWhenNoMatch ? null : undefined;

      if (iconField.toLowerCase() === colorField.toLowerCase()) {
        if (canMutateDestination(iconField)) {
          this.applyScalarMutation(frontmatter, iconField, desiredIcon !== undefined ? desiredIcon : desiredColor);
        }
      } else {
        if (canMutateDestination(iconField)) {
          this.applyScalarMutation(frontmatter, iconField, desiredIcon);
        }
        if (canMutateDestination(colorField)) {
          this.applyScalarMutation(frontmatter, colorField, desiredColor);
        }
      }

      // Opening a note is a latency-sensitive, device-local visual refresh.
      // Controller-owned sweeps and metadata automation retain sort/hide writes.
      if (options.reason !== 'file-open') {
        const sortKey = this.computeSortKey(ruleEngine, settings, context);
        const sortField = settings.smartSort?.field || 'sort';
        if (sortKey !== undefined && canMutateDestination(sortField)) {
          this.applyScalarMutation(frontmatter, sortField, sortKey);
        }

        if (canMutateHideTags && !isNativeRecord) {
          this.applyHideTagMutations(ruleEngine, settings, context, frontmatter);
        }
      }
    }, {
      kind: 'automation',
      sourcePluginId: this.plugin.manifest.id,
      surface: 'notebook-navigator-rules',
    });
    logger.perf('notebookRules:applyRulesToFile', {
      file: file.path,
      reason: options.reason || 'gcm-rule-apply',
      changed,
      durationMs: Math.round(performance.now() - started),
    });

    if (changed) {
      logger.debug('[TPS GCM] Applied Notebook Navigator rules', {
        file: file.path,
        reason: options.reason || 'gcm-rule-apply',
      });
    }
    return changed;
  }

  private getNativeRecordProtectedKeys(inspection: any): Set<string> {
    const protectedKeys = new Set([
      'tpsid',
      'tpsschemaversion',
      'kind',
      'title',
      'createddate',
      'modifieddate',
      'tags',
    ]);
    const nativeRecordService = this.plugin.nativeRecordService;
    const profiles = [
      nativeRecordService?.getStorageProfile?.(),
      inspection?.profile,
      ...(nativeRecordService?.getReadableStorageProfiles?.() || []),
    ].filter(Boolean);

    for (const profile of profiles) {
      const propertyKeys = [
        ...(profile.identityMode === 'property'
          ? [profile.identityPropertyKey, profile.schemaPropertyKey]
          : []),
        profile.kindPropertyKey,
        profile.titlePropertyKey,
        profile.createdPropertyKey,
        profile.modifiedPropertyKey,
      ];
      for (const key of propertyKeys) {
        const normalized = String(key || '').trim().toLowerCase();
        if (normalized) protectedKeys.add(normalized);
      }
    }
    return protectedKeys;
  }

  markUserEdited(file: TFile): void {
    if (!this.canApplyToFile(file)) return;
    this.recentUserEditAtByPath.set(file.path, Date.now());
  }

  getSmartSortPreviewForFile(file: TFile): string | null {
    if (!this.canApplyToFile(file)) return null;
    const settings = this.getSettings();
    if (!settings?.smartSort?.enabled) return null;
    const frontmatter = this.getFrontmatterForFile(file);
    const context = this.buildRuleContext(file, frontmatter ?? {}, '');
    return this.ruleEngine.composeSortKeyResult(settings.smartSort, context).key || null;
  }

  getRulePreviewForFile(file: TFile): Record<string, unknown> | null {
    if (!this.canApplyToFile(file)) return null;
    const settings = this.getSettings();
    if (!settings?.enabled) return null;

    const frontmatter = this.getFrontmatterForFile(file) ?? {};
    const context = this.buildRuleContext(file, frontmatter, '');
    const visualOutputs = this.ruleEngine.resolveVisualOutputs(settings.rules || [], context);
    const sortResult = settings.smartSort?.enabled
      ? this.ruleEngine.composeSortKeyResult(settings.smartSort, context)
      : null;
    const tagFrontmatter: Record<string, unknown> = { tags: [...context.tags] };
    this.applyHideTagMutations(this.ruleEngine, settings, context, tagFrontmatter);
    const beforeTags = new Set(this.normalizeTagList(context.tags));
    const afterTags = new Set(this.normalizeTagList(this.getValue(tagFrontmatter, 'tags')));

    return {
      filePath: file.path,
      iconField: this.getIconField(settings),
      colorField: this.getColorField(settings),
      sortField: settings.smartSort?.field || 'sort',
      icon: visualOutputs.icon.matched ? visualOutputs.icon.value : null,
      iconRuleId: visualOutputs.icon.ruleId,
      color: visualOutputs.color.matched ? this.normalizeNoteColorValue(visualOutputs.color.value) : null,
      colorRuleId: visualOutputs.color.ruleId,
      sortKey: sortResult?.key || null,
      sortMatched: sortResult?.matched ?? false,
      sortBucketName: sortResult?.bucketName ?? null,
      tagsAdded: Array.from(afterTags).filter((tag) => !beforeTags.has(tag)),
      tagsRemoved: Array.from(beforeTags).filter((tag) => !afterTags.has(tag)),
    };
  }

  getRuleMatchForFile(file: TFile, rule: any): boolean | null {
    if (!this.canApplyToFile(file) || !rule) return null;
    const frontmatter = this.getFrontmatterForFile(file);
    const context = this.buildRuleContext(file, frontmatter ?? {}, '');
    return this.ruleEngine.matchesRule(rule, context);
  }

  getVisualOutputsForFile(file: TFile, frontmatterOverride?: Record<string, unknown>): any | null {
    if (!this.canApplyToFile(file)) return null;
    const settings = this.getSettings();
    if (!settings?.enabled) return null;
    if (this.shouldIgnore(file, { force: true, bypassCreationGrace: true })) return null;
    const frontmatter = frontmatterOverride ?? this.getFrontmatterForFile(file) ?? {};
    const context = this.buildRuleContext(file, frontmatter, '');
    return this.ruleEngine.resolveVisualOutputs(settings.rules || [], context);
  }

  dispose(): void {
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
  }

  private isReady(): boolean {
    const settings = this.getSettings();
    return !!settings?.enabled;
  }

  private getSettings(): any {
    return this.plugin.settings.notebookNavigatorRules ?? null;
  }

  private getRuleEngine(): any {
    return this.ruleEngine;
  }

  private removeGeneratedBlankNoteTitle(file: TFile, frontmatter: Record<string, unknown>, body: string, options: ApplyOptions): void {
    if (options.reason !== 'create') return;
    if (String(body || '').trim()) return;
    const titleKey = findKeyCaseInsensitive(frontmatter, 'title');
    if (!titleKey) return;
    const title = String(frontmatter[titleKey] ?? '').replace(/\s+/g, ' ').trim();
    const basename = String(file.basename || '').replace(/\s+/g, ' ').trim();
    if (!title || title !== basename) return;
    deleteValueCaseInsensitive(frontmatter, 'title');
  }

  private getRuleCandidateFiles(): TFile[] {
    return this.plugin.app.vault.getFiles().filter((file): file is TFile => (
      this.canApplyToFile(file) && this.canUseExistingPropertyStorage(file)
    ));
  }

  private canUseExistingPropertyStorage(file: TFile): boolean {
    return file.extension?.toLowerCase() === 'md'
      || this.plugin.filePropertiesService?.hasCompanion(file) === true;
  }

  private shouldIgnore(file: TFile, options: ApplyOptions): boolean {
    if (!options.bypassCreationGrace && !options.force && Date.now() - file.stat.ctime < 2000) return true;
    if ((options.reason === 'rename' || this.isAutomaticReason(options.reason)) && this.isNavigationTextInputActive()) {
      logger.debug('[TPS GCM] Skipping Notebook Navigator rule apply while navigation text input is active', {
        file: file.path,
        reason: options.reason || 'scheduled',
      });
      return true;
    }
    if (!options.force && options.reason === 'metadata-change' && this.isActiveFile(file)) {
      logger.debug('[TPS GCM] Skipping metadata-change Notebook Navigator rule apply for active note', {
        file: file.path,
      });
      return true;
    }
    if (!options.force && this.isAutomaticReason(options.reason) && this.wasRecentlyUserEdited(file)) {
      logger.debug('[TPS GCM] Skipping automatic Notebook Navigator rule apply for actively edited note', {
        file: file.path,
        reason: options.reason || 'scheduled',
      });
      return true;
    }
    const patterns = this.getExclusionPatterns();
    if (patterns.length === 0) return false;
    const path = this.normalizeComparablePath(file.path);
    const basename = String(file.basename || '').trim().toLowerCase();
    return patterns.some((pattern) => this.matchesExclusion(path, basename, pattern));
  }

  private isActiveFile(file: TFile): boolean {
    return this.plugin.app.workspace.getActiveFile()?.path === file.path;
  }

  private isAutomaticReason(reason: string | undefined): boolean {
    return reason === 'file-open' || reason === 'metadata-change' || !reason;
  }

  private requiresControllerAutomation(reason: string | undefined): boolean {
    return this.isAutomaticReason(reason) && reason !== 'file-open';
  }

  private isNavigationTextInputActive(): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    const isTextInput = active instanceof HTMLInputElement
      || active instanceof HTMLTextAreaElement
      || active.getAttribute('contenteditable') === 'true';
    if (!isTextInput) return false;
    return !!active.closest([
      '.workspace-leaf-content[data-type="file-explorer"]',
      '.nav-files-container',
      '.nav-file',
      '.nav-folder',
      '.tree-item',
      '.tree-item-self',
      '.nn-split',
      '.nn-pane',
      '.nn-navitem',
      '.nn-file',
    ].join(', '));
  }

  private wasRecentlyUserEdited(file: TFile): boolean {
    const editedAt = this.recentUserEditAtByPath.get(file.path);
    if (!editedAt) return false;
    const ageMs = Date.now() - editedAt;
    if (ageMs > 15000) {
      this.recentUserEditAtByPath.delete(file.path);
      return false;
    }
    return true;
  }

  private getExclusionPatterns(): string[] {
    const raw = String(this.getSettings()?.frontmatterWriteExclusions || '');
    return raw
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private matchesExclusion(path: string, basename: string, rawPattern: string): boolean {
    const pattern = String(rawPattern || '').trim();
    if (!pattern) return false;
    const lower = pattern.toLowerCase();
    if (lower.startsWith('re:')) {
      try {
        const regex = new RegExp(pattern.slice(3).trim(), 'i');
        return regex.test(path) || regex.test(basename);
      } catch {
        return false;
      }
    }
    if (lower.startsWith('name:')) {
      return this.matchesWildcard(pattern.slice(5).trim().toLowerCase(), basename);
    }
    const target = this.normalizeComparablePath(lower.startsWith('path:') ? pattern.slice(5) : pattern);
    if (!target) return false;
    if (target.includes('*')) return this.matchesWildcard(target, path) || this.matchesWildcard(target, basename);
    return path === target || path.startsWith(`${target}/`) || basename === target;
  }

  private matchesWildcard(pattern: string, value: string): boolean {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 'i').test(value);
  }

  private normalizeComparablePath(value: string): string {
    return normalizePath(String(value || '').trim()).replace(/^\/+|\/+$/g, '').toLowerCase();
  }

  private async readBody(file: TFile): Promise<string> {
    if (file.extension?.toLowerCase() !== 'md') return '';
    try {
      const content = await this.plugin.app.vault.cachedRead(file);
      const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
      return match ? content.slice(match[0].length) : content;
    } catch (error) {
      logger.warn('[TPS GCM] Failed reading note body for Notebook Navigator rules', { file: file.path, error });
      return '';
    }
  }

  private getFrontmatterForFile(file: TFile): Record<string, unknown> | null {
    if (file.extension?.toLowerCase() !== 'md' && this.plugin.filePropertiesService?.isPropertyTarget(file)) {
      return this.toRecord(this.plugin.filePropertiesService.read(file));
    }
    return this.toRecord(this.plugin.app.metadataCache.getFileCache(file)?.frontmatter);
  }

  private buildRuleContext(file: TFile, frontmatter: Record<string, unknown>, body: string): RuleContext {
    const context: RuleContext = {
      file: {
        path: file.path,
        name: file.name,
        basename: file.basename,
        extension: file.extension,
        stat: {
          ctime: file.stat.ctime,
          mtime: file.stat.mtime,
        },
      },
      frontmatter,
      tags: this.collectTags(file, frontmatter),
      body,
      checkboxStates: this.collectCheckboxStates(body),
    };

    if (this.getSettings()?.smartSort?.relationshipGrouping === 'children-under-parent') {
      context.relationshipLineage = this.buildRelationshipLineage(file, frontmatter);
    }

    const lineageParent = context.relationshipLineage && context.relationshipLineage.length > 1
      ? context.relationshipLineage[context.relationshipLineage.length - 2]
      : null;
    const parent = lineageParent ?? this.resolveParentContext(file);
    if (parent) {
      context.parent = {
        file: parent.file,
        frontmatter: parent.frontmatter,
        tags: parent.tags,
      };
    }
    return context;
  }

  private collectCheckboxStates(body: string): string[] {
    const states = new Set<string>();
    const pattern = /^[\t ]*[-*+]\s+\[([^\]\r\n]*)\]/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const marker = String(match[1] || '').trim();
      states.add(marker || 'open');
    }
    return Array.from(states);
  }

  private buildRelationshipLineage(file: TFile, frontmatter: Record<string, unknown> | null): RelationshipLineageNode[] {
    const lineage: RelationshipLineageNode[] = [];
    const visited = new Set<string>();
    let currentFile: TFile | null = file;
    let currentFrontmatter = frontmatter;
    let depth = 0;

    while (currentFile && depth < 12) {
      if (visited.has(currentFile.path)) break;
      visited.add(currentFile.path);
      lineage.push(this.createRelationshipNode(currentFile, currentFrontmatter));

      const parent = this.plugin.parentLinkResolutionService.getParentsForChild(currentFile)[0]?.file ?? null;
      if (!(parent instanceof TFile) || parent.path === currentFile.path) break;

      currentFile = parent;
      currentFrontmatter = this.getFrontmatterForFile(parent);
      depth += 1;
    }

    return lineage.reverse();
  }

  private resolveParentContext(file: TFile): RelationshipLineageNode | null {
    const parent = this.plugin.parentLinkResolutionService.getParentsForChild(file)[0]?.file ?? null;
    if (!(parent instanceof TFile) || parent.path === file.path) return null;
    const frontmatter = this.getFrontmatterForFile(parent);
    return this.createRelationshipNode(parent, frontmatter);
  }

  private createRelationshipNode(file: TFile, frontmatter: Record<string, unknown> | null): RelationshipLineageNode {
    return {
      file: {
        path: file.path,
        name: file.name,
        basename: file.basename,
        extension: file.extension,
        stat: {
          ctime: file.stat.ctime,
          mtime: file.stat.mtime,
        },
      },
      frontmatter,
      tags: this.collectTags(file, frontmatter),
    };
  }

  private collectTags(file: TFile, frontmatter: Record<string, unknown> | null): string[] {
    const tags = new Set<string>();
    const cacheTags = this.plugin.app.metadataCache.getFileCache(file)?.tags ?? [];
    for (const cacheTag of cacheTags) {
      const normalized = this.normalizeTag(cacheTag.tag);
      if (normalized) tags.add(normalized);
    }
    const rawTags = frontmatter ? this.getValue(frontmatter, 'tags') : undefined;
    const rawTag = frontmatter ? this.getValue(frontmatter, 'tag') : undefined;
    for (const value of [rawTags, rawTag]) {
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          const normalized = this.normalizeTag(entry);
          if (normalized) tags.add(normalized);
        });
      } else if (typeof value === 'string') {
        value.split(/[\s,]+/).forEach((entry) => {
          const normalized = this.normalizeTag(entry);
          if (normalized) tags.add(normalized);
        });
      }
    }
    return Array.from(tags);
  }

  private computeSortKey(ruleEngine: any, settings: any, context: RuleContext): string | null | undefined {
    const smartSort = settings.smartSort;
    if (!smartSort?.enabled) return undefined;
    const enabledBuckets = Array.isArray(smartSort.buckets)
      ? smartSort.buckets.filter((bucket: any) => bucket?.enabled)
      : [];
    if (enabledBuckets.length === 0) {
      return smartSort.clearWhenNoMatch ? null : undefined;
    }
    const sortResult = ruleEngine.composeSortKeyResult?.(smartSort, context);
    const sortKey = String((sortResult?.key ?? ruleEngine.composeSortKey(smartSort, context)) || '').trim();
    if (sortKey) return sortKey;
    return undefined;
  }

  private getIconField(settings: any): string {
    return String(
      this.plugin.sharedServices?.visualMetadata?.getIconField?.()
      || settings.frontmatterIconField
      || 'icon',
    ).trim() || 'icon';
  }

  private getColorField(settings: any): string {
    return String(
      this.plugin.sharedServices?.visualMetadata?.getColorField?.()
      || settings.frontmatterColorField
      || 'color',
    ).trim() || 'color';
  }

  private applyHideTagMutations(ruleEngine: any, settings: any, context: RuleContext, frontmatter: Record<string, unknown>): void {
    const toAdd = new Set<string>();
    const toRemove = new Set<string>();
    const addRuleDefined = new Set<string>();
    const addRuleMatched = new Set<string>();

    for (const rule of settings.hideRules || []) {
      const tag = this.normalizeTag(rule?.tagName || 'hide');
      if (!tag) continue;
      if (!rule.enabled) continue;
      if (rule.mode !== 'remove') addRuleDefined.add(tag);
      if (!ruleEngine.matchesRule?.(rule, context)) continue;
      if (rule.mode === 'remove') {
        toRemove.add(tag);
        toAdd.delete(tag);
      } else {
        addRuleMatched.add(tag);
        toAdd.add(tag);
        toRemove.delete(tag);
      }
    }

    if (settings.autoRemoveHiddenWhenNoMatch !== false) {
      for (const tag of addRuleDefined) {
        if (!addRuleMatched.has(tag) && !toAdd.has(tag)) toRemove.add(tag);
      }
    }

    if (toAdd.size === 0 && toRemove.size === 0) return;
    const current = new Set(this.normalizeTagList(this.getValue(frontmatter, 'tags')));
    for (const tag of toRemove) current.delete(tag);
    for (const tag of toAdd) current.add(tag);
    if (current.size === 0) {
      deleteValueCaseInsensitive(frontmatter, 'tags');
    } else {
      setValueCaseInsensitive(frontmatter, 'tags', Array.from(current));
    }
  }

  private normalizeTagList(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((entry) => this.normalizeTag(entry)).filter(Boolean);
    if (typeof value === 'string') return value.split(/[\s,]+/).map((entry) => this.normalizeTag(entry)).filter(Boolean);
    return [];
  }

  private applyScalarMutation(frontmatter: Record<string, unknown>, key: string, desired: string | null | undefined): void {
    const cleanKey = String(key || '').trim();
    if (!cleanKey || this.isProtectedKey(cleanKey)) return;
    if (desired === undefined) return;
    if (desired === null || String(desired).trim() === '') {
      deleteValueCaseInsensitive(frontmatter, cleanKey);
      return;
    }
    setValueCaseInsensitive(frontmatter, cleanKey, String(desired).trim());
  }

  private normalizeStoredColorValue(value: string): string {
    return String(value || '').trim().replace(/^#/, '');
  }

  private normalizeNoteColorValue(value: string): string {
    const trimmed = String(value || '').trim();
    const bareHex = trimmed.match(/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
    if (bareHex) return `#${bareHex[1]}`;
    return trimmed;
  }

  private isProtectedKey(key: string): boolean {
    const normalized = key.trim().toLowerCase();
    if (!normalized) return true;
    return normalized === 'externaleventid' || normalized === 'tpscalendaruid';
  }

  private readString(frontmatter: Record<string, unknown>, key: string): string | null {
    const value = this.getValue(frontmatter, key);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private getValue(frontmatter: Record<string, unknown>, key: string): unknown {
    const actual = findKeyCaseInsensitive(frontmatter, key);
    return actual ? frontmatter[actual] : undefined;
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private normalizeTag(raw: unknown): string {
    return String(raw ?? '').trim().replace(/^#+/, '').toLowerCase();
  }

  private composeBasesIconValues(
    iconValue: string | null | undefined,
    colorValue: string | null | undefined,
  ): { markdown: string | null | undefined; uri: string | null | undefined } {
    if (iconValue === undefined) return { markdown: undefined, uri: undefined };
    if (iconValue === null || !String(iconValue).trim()) return { markdown: null, uri: null };
    const iconId = String(iconValue || '').trim().replace(/^lucide[:\-]/i, '');
    if (!iconId) return { markdown: null, uri: null };

    const iconContainer = document.createElement('span');
    try {
      setIcon(iconContainer, iconId);
    } catch {
      return { markdown: null, uri: null };
    }
    const svg = iconContainer.querySelector('svg');
    if (!svg) return { markdown: null, uri: null };

    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', svg.getAttribute('viewBox') || '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke-width', svg.getAttribute('stroke-width') || '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('stroke', this.normalizeCssColorForSvg(colorValue ?? '') || 'currentColor');

    const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg.outerHTML)}`;
    return { uri, markdown: `![](${uri})` };
  }

  private normalizeCssColorForSvg(rawValue: string): string | null {
    const value = String(rawValue || '').trim();
    if (!value || /[<>{}\n\r;]/.test(value)) return null;
    const hexWithoutHash = value.match(/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
    if (hexWithoutHash) return `#${hexWithoutHash[1]}`;
    try {
      if (typeof CSS !== 'undefined' && CSS.supports('color', value)) return value;
    } catch {
      // Fall through.
    }
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value) ? value : null;
  }
}
