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

export type NotebookNavigatorPresentationEntry = Readonly<{
  filePath: string;
  values: Readonly<Record<string, string>>;
}>;

export type NotebookNavigatorPresentationListener = (revision: number) => void;

type PresentationCacheValue = NotebookNavigatorPresentationEntry | null;

type ComputedPresentation = {
  value: PresentationCacheValue;
  dependencyPaths: string[];
};

/**
 * GCM-owned Notebook Navigator rule engine.
 *
 * Icon, color, and sort are transient presentation values. They are projected
 * through the public API and never persisted in a note. Hide rules remain an
 * explicit semantic-tag workflow, and create-time title repair remains a
 * separate note mutation.
 */
export class NotebookNavigatorRuleService {
  private readonly timers = new Map<string, number>();
  private readonly recentUserEditAtByPath = new Map<string, number>();
  private readonly ruleEngine: RuleEngine;
  private readonly presentationCache = new Map<string, PresentationCacheValue>();
  private readonly presentationDependenciesByPath = new Map<string, Set<string>>();
  private readonly presentationDependentsByPath = new Map<string, Set<string>>();
  private readonly presentationListeners = new Set<NotebookNavigatorPresentationListener>();
  private readonly presentationPendingByPath = new Map<string, Promise<void>>();
  private readonly presentationGenerationByPath = new Map<string, number>();
  private presentationRevision = 0;
  private presentationGeneration = 0;
  private presentationNotificationQueued = false;
  private presentationSetup = false;
  private presentationMidnightTimer: number | null = null;
  private disposed = false;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {
    this.ruleEngine = new RuleEngine(plugin.app);
  }

  /**
   * Start the read-only Notebook Navigator presentation cache. The cache is
   * deliberately separate from the existing frontmatter writer: consumers can
   * request projected values without causing a vault mutation.
   */
  setupPresentationProjection(): void {
    if (this.presentationSetup || this.disposed) return;
    this.presentationSetup = true;

    this.plugin.registerEvent(this.plugin.app.metadataCache.on('changed', (file) => {
      this.invalidatePresentationFiles([this.resolvePresentationSourceFile(file)]);
    }));
    this.plugin.registerEvent(this.plugin.app.metadataCache.on('resolved', () => {
      this.invalidateNotebookNavigatorPresentation();
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('modify', (file) => {
      this.invalidatePresentationFiles([this.resolvePresentationSourceFile(file)]);
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('create', () => {
      // A newly created file can resolve a previously unresolved parent link.
      this.invalidateNotebookNavigatorPresentation();
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('delete', () => {
      // Deletion can change previously ambiguous or unresolved parent links.
      this.invalidateNotebookNavigatorPresentation();
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('rename', () => {
      // Rename can both invalidate resolved ancestors and resolve new ones.
      this.invalidateNotebookNavigatorPresentation();
    }));
    this.plugin.register(this.plugin.eventService.onFilesUpdated((paths) => {
      this.invalidatePresentationPaths(paths);
    }));

    this.schedulePresentationMidnightInvalidation();
  }

  async ensureNotebookNavigatorPresentation(
    files: readonly (TFile | string)[] | TFile | string,
  ): Promise<void> {
    if (this.disposed) return;
    const requested = Array.isArray(files) ? files : [files];
    const unique = new Map<string, TFile | null>();
    for (const reference of requested) {
      const resolved = this.resolvePresentationReference(reference);
      if (!resolved.path || unique.has(resolved.path)) continue;
      unique.set(resolved.path, resolved.file);
    }

    await Promise.all(Array.from(unique, async ([path, file]) => {
      if (this.presentationCache.has(path)) return;
      const existing = this.presentationPendingByPath.get(path);
      if (existing) {
        await existing;
        return;
      }
      const pending = this.preparePresentationPath(path, file)
        .finally(() => {
          if (this.presentationPendingByPath.get(path) === pending) {
            this.presentationPendingByPath.delete(path);
          }
        });
      this.presentationPendingByPath.set(path, pending);
      await pending;
    }));
  }

  getNotebookNavigatorPresentation(
    reference: TFile | string,
  ): NotebookNavigatorPresentationEntry | null | undefined {
    const path = this.presentationPath(reference);
    if (!path || !this.presentationCache.has(path)) return undefined;
    return this.presentationCache.get(path);
  }

  getNotebookNavigatorPresentationRevision(): number {
    return this.presentationRevision;
  }

  onNotebookNavigatorPresentationChanged(
    listener: NotebookNavigatorPresentationListener,
  ): () => void {
    if (this.disposed || typeof listener !== 'function') return () => {};
    this.presentationListeners.add(listener);
    return () => {
      this.presentationListeners.delete(listener);
    };
  }

  /** Clear all prepared values and notify consumers that they must ensure again. */
  invalidateNotebookNavigatorPresentation(): void {
    if (this.disposed) return;
    const hasPreparedOrPending = this.presentationCache.size > 0 || this.presentationPendingByPath.size > 0;
    this.clearAllPresentationEntries();
    if (!hasPreparedOrPending) return;
    this.presentationGeneration += 1;
    this.publishPresentationChanged();
  }

  shouldAutoApplyOnFileOpen(): boolean {
    // Visual rules are invalidated by the presentation cache listeners. There
    // is no note mutation that belongs on the latency-sensitive file-open path.
    return false;
  }

  shouldAutoApplyOnMetadataChange(): boolean {
    if (!this.plugin.canRunBackgroundAutomation()) return false;
    const settings = this.getSettings();
    return !!settings?.enabled
      && settings.autoApplyOnMetadataChange !== false
      && this.hasEnabledHideRules(settings);
  }

  shouldApplyOnStartup(): boolean {
    if (!this.plugin.canRunBackgroundAutomation()) return false;
    const settings = this.getSettings();
    return !!settings?.enabled
      && settings.applyOnStartup !== false
      && this.hasEnabledHideRules(settings);
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
    this.invalidatePresentationPaths([file.path]);
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
    this.invalidateNotebookNavigatorPresentation();
    if (!this.isReady()) return 0;
    if (!this.hasEnabledHideRules(this.getSettings())) return 0;
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
    this.invalidatePresentationPaths([file.path]);
    if (!this.canUseExistingPropertyStorage(file)) return false;
    if (!this.isReady()) return false;
    if (this.requiresControllerAutomation(options.reason) && !this.plugin.canRunBackgroundAutomation()) return false;
    if (this.shouldIgnore(file, options)) return false;

    const settings = this.getSettings();
    const ruleEngine = this.getRuleEngine();
    if (!settings || !ruleEngine) return false;
    const canMutateGeneratedTitle = options.reason === 'create';
    const canMutateHideTags = options.reason !== 'file-open'
      && this.hasEnabledHideRules(settings);
    if (!canMutateGeneratedTitle && !canMutateHideTags) return false;
    const ownedKeys: string[] = [];
    if (canMutateGeneratedTitle) ownedKeys.push('title');
    if (canMutateHideTags) ownedKeys.push('tags');

    const started = performance.now();
    const body = await this.readBody(file);
    const changed = await this.plugin.frontmatterMutationService.processOwnedKeysPreservingSource(file, ownedKeys, (frontmatter) => {
      const context = this.buildRuleContext(file, frontmatter, body);
      // A record remains a record while the global architecture setting is temporarily
      // switched to Legacy. Semantic tag and title repair must respect the document
      // identity itself, not the current write mode.
      const hasNativeRecordIdentityEvidence = this.plugin.nativeRecordService
        ?.hasRecordIdentityEvidenceInFrontmatter(frontmatter) === true;
      if (canMutateGeneratedTitle && !hasNativeRecordIdentityEvidence) {
        this.removeGeneratedBlankNoteTitle(file, frontmatter, body, options);
      }
      if (canMutateHideTags && !hasNativeRecordIdentityEvidence) {
        this.applyHideTagMutations(ruleEngine, settings, context, frontmatter);
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
      this.invalidatePresentationPaths([file.path]);
      logger.debug('[TPS GCM] Applied Notebook Navigator rules', {
        file: file.path,
        reason: options.reason || 'gcm-rule-apply',
      });
    }
    return changed;
  }

  private hasEnabledHideRules(settings: any): boolean {
    return (settings?.hideRules || []).some((rule: any) => (
      rule?.enabled && this.normalizeTag(rule?.tagName || 'hide')
    ));
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

  private async preparePresentationPath(path: string, initialFile: TFile | null): Promise<void> {
    // If a file changes during the async body read, recompute against the new
    // generation instead of publishing a stale projection.
    for (let attempt = 0; attempt < 3 && !this.disposed; attempt += 1) {
      const generation = this.presentationGeneration;
      const pathGeneration = this.presentationGenerationByPath.get(path) ?? 0;
      const liveFile = attempt === 0 && initialFile?.path === path
        ? initialFile
        : this.resolvePresentationReference(path).file;
      let computed: ComputedPresentation;
      try {
        computed = liveFile
          ? await this.computePresentation(liveFile)
          : { value: null, dependencyPaths: [] };
      } catch (error) {
        logger.warn('[TPS GCM] Failed preparing Notebook Navigator presentation', { file: path, error });
        computed = { value: null, dependencyPaths: [] };
      }
      if (this.disposed) return;
      if (
        generation !== this.presentationGeneration
        || pathGeneration !== (this.presentationGenerationByPath.get(path) ?? 0)
      ) continue;
      if (liveFile && this.presentationPath(liveFile) !== path) return;
      this.presentationCache.set(path, computed.value);
      this.replacePresentationDependencies(path, computed.dependencyPaths);
      return;
    }
  }

  private async computePresentation(file: TFile): Promise<ComputedPresentation> {
    if (!this.canApplyToFile(file) || !this.canUseExistingPropertyStorage(file)) {
      return { value: null, dependencyPaths: [] };
    }
    const settings = this.getSettings();
    if (!settings?.enabled) return { value: null, dependencyPaths: [] };
    if (this.shouldIgnore(file, {
      reason: 'presentation',
      force: true,
      bypassCreationGrace: true,
    })) {
      return { value: null, dependencyPaths: [] };
    }

    const body = await this.readBody(file);
    // Preserve the established projection precedence: sort evaluates after
    // generated visual values on this in-memory clone. No YAML mutation occurs.
    const frontmatter = { ...(this.getFrontmatterForFile(file) ?? {}) };
    const context = this.buildRuleContext(file, frontmatter, body);
    const visualOutputs = this.ruleEngine.resolveVisualOutputs(settings.rules || [], context);
    const desiredIcon = visualOutputs?.icon?.matched
      ? String(visualOutputs.icon.value || '').trim()
      : settings.clearIconWhenNoMatch ? null : undefined;
    const desiredColor = visualOutputs?.color?.matched
      ? this.normalizeNoteColorValue(String(visualOutputs.color.value || '').trim())
      : settings.clearColorWhenNoMatch ? null : undefined;
    const iconField = this.getIconField(settings);
    const colorField = this.getColorField(settings);
    const nativeRecordInspection = this.plugin.nativeRecordService?.inspect(frontmatter) || null;
    const nativeRecordProtectedKeys = nativeRecordInspection
      ? this.getNativeRecordProtectedKeys(nativeRecordInspection)
      : null;
    const canProjectDestination = (key: string): boolean => (
      !nativeRecordProtectedKeys?.has(String(key || '').trim().toLowerCase())
      && !this.isProtectedKey(key)
    );
    const projected = new Map<string, { key: string; value: string }>();

    if (iconField.toLowerCase() === colorField.toLowerCase()) {
      if (canProjectDestination(iconField)) {
        this.applyPresentationScalar(
          projected,
          frontmatter,
          iconField,
          desiredIcon !== undefined ? desiredIcon : desiredColor,
        );
      }
    } else {
      if (canProjectDestination(iconField)) {
        this.applyPresentationScalar(projected, frontmatter, iconField, desiredIcon);
      }
      if (canProjectDestination(colorField)) {
        this.applyPresentationScalar(projected, frontmatter, colorField, desiredColor);
      }
    }

    const sortField = String(settings.smartSort?.field || 'sort').trim() || 'sort';
    const sortContext = this.buildRuleContext(file, frontmatter, body);
    const sortKey = this.computeSortKey(this.ruleEngine, settings, sortContext);
    if (sortKey !== undefined && canProjectDestination(sortField)) {
      this.applyPresentationScalar(projected, frontmatter, sortField, sortKey);
    }

    const dependencyPaths = this.collectPresentationDependencyPaths(file.path, sortContext);
    if (projected.size === 0) return { value: null, dependencyPaths };
    const values: Record<string, string> = {};
    for (const entry of projected.values()) values[entry.key] = entry.value;
    return {
      value: Object.freeze({
        filePath: file.path,
        values: Object.freeze(values),
      }),
      dependencyPaths,
    };
  }

  private applyPresentationScalar(
    projected: Map<string, { key: string; value: string }>,
    frontmatter: Record<string, unknown>,
    key: string,
    desired: string | null | undefined,
  ): void {
    const cleanKey = String(key || '').trim();
    if (!cleanKey || desired === undefined) return;
    const normalized = cleanKey.toLowerCase();
    if (desired === null || !String(desired).trim()) {
      deleteValueCaseInsensitive(frontmatter, cleanKey);
      projected.delete(normalized);
      return;
    }
    const value = String(desired).trim();
    setValueCaseInsensitive(frontmatter, cleanKey, value);
    projected.set(normalized, { key: cleanKey, value });
  }

  private collectPresentationDependencyPaths(filePath: string, context: RuleContext): string[] {
    const dependencies = new Set<string>();
    const add = (path: unknown): void => {
      const normalized = this.presentationPath(String(path || ''));
      if (normalized && normalized !== filePath) dependencies.add(normalized);
    };
    add(context.parent?.file?.path);
    for (const node of context.relationshipLineage || []) add(node.file?.path);
    return Array.from(dependencies);
  }

  private replacePresentationDependencies(path: string, dependencyPaths: string[]): void {
    this.removePresentationDependencies(path);
    const dependencies = new Set(dependencyPaths.filter((dependency) => dependency && dependency !== path));
    if (dependencies.size === 0) return;
    this.presentationDependenciesByPath.set(path, dependencies);
    for (const dependency of dependencies) {
      const dependents = this.presentationDependentsByPath.get(dependency) ?? new Set<string>();
      dependents.add(path);
      this.presentationDependentsByPath.set(dependency, dependents);
    }
  }

  private removePresentationDependencies(path: string): void {
    const dependencies = this.presentationDependenciesByPath.get(path);
    if (!dependencies) return;
    this.presentationDependenciesByPath.delete(path);
    for (const dependency of dependencies) {
      const dependents = this.presentationDependentsByPath.get(dependency);
      if (!dependents) continue;
      dependents.delete(path);
      if (dependents.size === 0) this.presentationDependentsByPath.delete(dependency);
    }
  }

  private clearPresentationEntry(path: string): void {
    this.presentationCache.delete(path);
    this.removePresentationDependencies(path);
  }

  private clearAllPresentationEntries(): void {
    this.presentationCache.clear();
    this.presentationDependenciesByPath.clear();
    this.presentationDependentsByPath.clear();
  }

  private invalidatePresentationFiles(files: Array<TFile | null>): void {
    const paths = files
      .filter((file): file is TFile => file instanceof TFile)
      .map((file) => file.path);
    if (paths.length > 0) this.invalidatePresentationPaths(paths);
  }

  private invalidatePresentationPaths(paths: string[]): void {
    if (this.disposed) return;
    const queue = paths.map((path) => this.presentationPath(path)).filter(Boolean);
    const affected = new Set<string>();
    while (queue.length > 0) {
      const path = queue.shift()!;
      if (affected.has(path)) continue;
      affected.add(path);
      for (const dependent of this.presentationDependentsByPath.get(path) || []) {
        queue.push(dependent);
      }
    }
    const hasPreparedOrPending = Array.from(affected).some((path) => (
      this.presentationCache.has(path) || this.presentationPendingByPath.has(path)
    ));
    for (const path of affected) this.clearPresentationEntry(path);
    if (!hasPreparedOrPending) return;
    for (const path of affected) {
      this.presentationGenerationByPath.set(
        path,
        (this.presentationGenerationByPath.get(path) ?? 0) + 1,
      );
    }
    this.publishPresentationChanged();
  }

  private resolvePresentationSourceFile(file: unknown): TFile | null {
    if (!(file instanceof TFile)) return null;
    if (!this.plugin.filePropertiesService?.isCompanionFile(file)) return file;
    const source = this.plugin.filePropertiesService.getSourceFileForCompanion(file);
    return source instanceof TFile ? source : null;
  }

  private resolvePresentationReference(reference: TFile | string): { path: string; file: TFile | null } {
    const path = this.presentationPath(reference);
    if (!path) return { path: '', file: null };
    if (reference instanceof TFile && this.presentationPath(reference.path) === path) {
      return { path, file: reference };
    }
    const file = this.plugin.app.vault.getFileByPath?.(path)
      ?? this.plugin.app.vault.getAbstractFileByPath?.(path)
      ?? null;
    return { path, file: file instanceof TFile ? file : null };
  }

  private presentationPath(reference: TFile | string): string {
    const raw = reference instanceof TFile ? reference.path : String(reference || '');
    const trimmed = raw.trim();
    return trimmed ? normalizePath(trimmed).replace(/^\/+/, '') : '';
  }

  private publishPresentationChanged(): void {
    this.presentationRevision += 1;
    if (this.presentationNotificationQueued) return;
    this.presentationNotificationQueued = true;
    void Promise.resolve().then(() => {
      this.presentationNotificationQueued = false;
      if (this.disposed) return;
      const revision = this.presentationRevision;
      for (const listener of Array.from(this.presentationListeners)) {
        try {
          listener(revision);
        } catch (error) {
          logger.warn('[TPS GCM] Notebook Navigator presentation listener failed', { error });
        }
      }
    });
  }

  private schedulePresentationMidnightInvalidation(): void {
    if (this.disposed) return;
    if (this.presentationMidnightTimer !== null) window.clearTimeout(this.presentationMidnightTimer);
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 25);
    const delay = Math.max(1000, nextMidnight.getTime() - now.getTime());
    this.presentationMidnightTimer = window.setTimeout(() => {
      this.presentationMidnightTimer = null;
      this.invalidateNotebookNavigatorPresentation();
      this.schedulePresentationMidnightInvalidation();
    }, delay);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
    if (this.presentationMidnightTimer !== null) {
      window.clearTimeout(this.presentationMidnightTimer);
      this.presentationMidnightTimer = null;
    }
    this.clearAllPresentationEntries();
    this.presentationPendingByPath.clear();
    this.presentationGenerationByPath.clear();
    this.presentationListeners.clear();
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
