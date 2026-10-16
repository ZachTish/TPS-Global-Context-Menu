import { MarkdownView, Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import type { BodySubitemLink } from './subitem-types';
import { resolveLinkTargetToFile } from './link-target-service';
import { getCompatibleMarkdownViewFromLeaf, pickBestMarkdownLeaf } from './leaf-resolver';
import {
  getLinkedSubitemMappingForState,
  normalizeLinkedSubitemCheckboxState,
  normalizeLinkedSubitemMappings,
  resolveLinkedSubitemSemanticCheckboxPlanForState,
  resolveLinkedSubitemSemanticCheckboxPlanForStatus,
  type LinkedSubitemSemanticCheckboxPlan,
} from '../utils/linked-subitem-mapping';
import {
  canAutomaticallyMutatePathWithExclusions,
  canAutomaticallyMutateTemplateFile,
  canAutomaticallyMutateTemplateSource,
} from '../utils/template-protection';
import * as logger from '../logger';

export type ChildWorkflowCheckboxResolution = {
  outcome: 'mapped' | 'statusless' | 'unmapped';
  statusKey: string;
  statuses: string[];
  checkboxState: string | null;
  mappingPlans: LinkedSubitemSemanticCheckboxPlan[];
};

export type ChildWorkflowBodyLinkResult = {
  changed: boolean;
  blockedReason: 'ignored' | 'unmapped-status' | 'workflow-changed' | null;
  resolution: ChildWorkflowCheckboxResolution;
};

export class SubitemRelationshipSyncService {
  private bodyWriteChains = new Map<string, Promise<void>>();

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  async readMarkdownText(file: TFile, options: { cached?: boolean } = {}): Promise<string> {
    if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') return '';
    const openView = this.getOpenMarkdownViewForFile(file);
    if (openView) {
      const source = this.readViewSource(openView);
      if (source !== null) return source;
    }
    return options.cached
      ? await this.plugin.app.vault.cachedRead(file)
      : await this.plugin.app.vault.read(file);
  }

  async linkExistingChildToParent(childFile: TFile, parentFile: TFile, options?: { insertBodyLink?: boolean; checkboxState?: string | null }): Promise<boolean> {
    if (
      this.plugin.parentLinkResolutionService.isIgnoredFile(childFile)
      || this.plugin.parentLinkResolutionService.isIgnoredFile(parentFile)
    ) {
      return false;
    }
    let changed = false;
    if (parentFile.extension?.toLowerCase() === 'md' && options?.insertBodyLink === true) {
      const checkboxState = options?.checkboxState !== undefined ? options.checkboxState : this.resolveCheckboxStateForChild(childFile);
      changed = (await this.insertBodyLink(parentFile, childFile, checkboxState)) || changed;
    }
    changed = (await this.plugin.parentLinkResolutionService.addParentToChild(childFile, parentFile)) || changed;
    return changed;
  }

  /**
   * Resolve a child note's workflow status through the strict, ordered
   * checkbox mapping contract. A nonempty unsupported status is distinct from
   * a genuinely statusless note and never receives an invented open marker.
   */
  public resolveChildWorkflowCheckbox(
    frontmatter: Record<string, unknown> | null | undefined,
    options: { statuslessMode?: 'bullet' | 'configured-open' } = {},
  ): ChildWorkflowCheckboxResolution {
    const statusService = this.plugin.sharedServices.status;
    const statusKey = String(statusService.getStatusPropertyKey() || '').trim() || 'status';
    const statuses = statusService.getStatuses(frontmatter, statusKey);
    const mappings = normalizeLinkedSubitemMappings(
      this.plugin.settings.linkedSubitemCheckboxMappings || [],
      {
        enforceStrictDefaults: false,
        normalizeStatus: (value) => statusService.normalize(value),
      },
    );
    if (statuses.length === 0) {
      if (options.statuslessMode !== 'configured-open') {
        return { outcome: 'statusless', statusKey, statuses: [], checkboxState: null, mappingPlans: [] };
      }
      const configuredState = normalizeLinkedSubitemCheckboxState(
        this.plugin.settings.linkedSubitemDefaultOpenState,
      );
      const configuredMapping = configuredState
        ? getLinkedSubitemMappingForState(mappings, configuredState, { normalizedMappings: true })
        : null;
      const configuredStatuses = configuredMapping?.statuses
        .map((status) => statusService.normalize(status))
        .filter(Boolean) || [];
      if (
        !configuredState
        || !configuredMapping
        || configuredStatuses.length === 0
        || configuredStatuses.some((status) => statusService.isDoneStatus(status))
      ) {
        return { outcome: 'unmapped', statusKey, statuses: [], checkboxState: null, mappingPlans: [] };
      }
      const openPlan = resolveLinkedSubitemSemanticCheckboxPlanForState(
        mappings,
        configuredState,
        configuredStatuses[0],
        {
          normalizeStatus: (value) => statusService.normalize(value),
          normalizedMappings: true,
        },
      );
      return openPlan
        ? {
          outcome: 'statusless',
          statusKey,
          statuses: [],
          checkboxState: openPlan.checkboxState,
          mappingPlans: [openPlan],
        }
        : { outcome: 'unmapped', statusKey, statuses: [], checkboxState: null, mappingPlans: [] };
    }

    const mappingPlans = statuses.map((status) => resolveLinkedSubitemSemanticCheckboxPlanForStatus(
      mappings,
      status,
      {
        normalizeStatus: (value) => statusService.normalize(value),
        normalizedMappings: true,
      },
    ));
    if (mappingPlans.some((plan) => plan == null)) {
      return { outcome: 'unmapped', statusKey, statuses, checkboxState: null, mappingPlans: [] };
    }
    const exactPlans = mappingPlans as LinkedSubitemSemanticCheckboxPlan[];
    const checkboxState = exactPlans[0]?.checkboxState || null;
    if (!checkboxState || exactPlans.some((plan) => plan.checkboxState !== checkboxState)) {
      return { outcome: 'unmapped', statusKey, statuses, checkboxState: null, mappingPlans: [] };
    }
    return { outcome: 'mapped', statusKey, statuses, checkboxState, mappingPlans: exactPlans };
  }

  public resolveChildWorkflowCheckboxForFile(
    childFile: TFile,
    options: { statuslessMode?: 'bullet' | 'configured-open' } = {},
  ): ChildWorkflowCheckboxResolution {
    const frontmatter = (this.plugin.app.metadataCache.getFileCache(childFile)?.frontmatter || {}) as Record<string, unknown>;
    return this.resolveChildWorkflowCheckbox(frontmatter, options);
  }

  /**
   * Insert a derived child link with semantic compare-and-swap revalidation at
   * the parent body mutation boundary.
   */
  public async insertBodyLinkForChildWorkflow(
    parentFile: TFile,
    childFile: TFile,
    options: {
      frontmatter?: Record<string, unknown>;
      statuslessMode?: 'bullet' | 'configured-open';
    } = {},
  ): Promise<ChildWorkflowBodyLinkResult> {
    const resolveCurrent = () => options.frontmatter
      ? this.resolveChildWorkflowCheckbox(options.frontmatter, { statuslessMode: options.statuslessMode })
      : this.resolveChildWorkflowCheckboxForFile(childFile, { statuslessMode: options.statuslessMode });
    const isIgnored = () => (
      this.plugin.parentLinkResolutionService.isIgnoredFile(parentFile)
      || this.plugin.parentLinkResolutionService.isIgnoredFile(childFile)
      || (
        options.frontmatter !== undefined
        && this.plugin.parentLinkResolutionService.isIgnoredFrontmatter(options.frontmatter)
      )
    );
    const planned = resolveCurrent();
    if (isIgnored()) {
      logger.flow('SubitemRelationship', 'body-link:ignored', {
        parentPath: parentFile.path,
        childPath: childFile.path,
      });
      return { changed: false, blockedReason: 'ignored', resolution: planned };
    }
    if (planned.outcome === 'unmapped') {
      logger.flowWarn('SubitemRelationship', 'body-link:unmapped-child-status', {
        parentPath: parentFile.path,
        childPath: childFile.path,
        statusKey: planned.statusKey,
        statuses: planned.statuses,
      });
      return { changed: false, blockedReason: 'unmapped-status', resolution: planned };
    }
    if (!(await canAutomaticallyMutateTemplateFile(
      this.plugin.app.vault,
      parentFile,
      this.plugin.settings,
    ))) {
      return { changed: false, blockedReason: null, resolution: planned };
    }

    let guardBlocked: 'ignored' | 'workflow-changed' | null = null;
    const changed = await this.mutateMarkdownBody(parentFile, async (lines, raw) => {
      // The open editor is authoritative at the body mutation boundary. A note
      // can gain an explicitly excluded tag after its caller's earlier vault
      // preflight, so recheck these exact bytes before inserting a derived link.
      if (
        !canAutomaticallyMutatePathWithExclusions(parentFile, this.plugin.settings)
        || !canAutomaticallyMutateTemplateSource(raw, this.plugin.settings)
      ) {
        logger.flow('SubitemRelationship', 'body-link:auto-write-excluded', {
          parentPath: parentFile.path,
          childPath: childFile.path,
        });
        return false;
      }
      if (isIgnored()) {
        guardBlocked = 'ignored';
        return false;
      }
      const live = resolveCurrent();
      if (!sameChildWorkflowCheckboxResolution(planned, live)) {
        guardBlocked = 'workflow-changed';
        return false;
      }
      return this.insertBodyLinkIntoLines(parentFile, childFile, live.checkboxState, lines, raw);
    });
    if (guardBlocked === 'workflow-changed') {
      logger.flowWarn('SubitemRelationship', 'body-link:child-workflow-changed', {
        parentPath: parentFile.path,
        childPath: childFile.path,
        statusKey: planned.statusKey,
        statuses: planned.statuses,
      });
    }
    return {
      changed,
      blockedReason: guardBlocked,
      resolution: planned,
    };
  }

  async unlinkChildFromParent(childFile: TFile, parentFile: TFile): Promise<{ childChanged: boolean; parentChanged: boolean }> {
    const childChanged = await this.plugin.parentLinkResolutionService.removeParentFromChild(childFile, parentFile);
    let parentChanged = false;
    if (parentFile.extension?.toLowerCase() === 'md') {
      parentChanged = await this.removeBodyLink(parentFile, childFile);
    }
    return { childChanged, parentChanged };
  }

  public async insertBodyLink(parentFile: TFile, childFile: TFile, checkboxState?: string | null): Promise<boolean> {
    if (
      this.plugin.parentLinkResolutionService.isIgnoredFile(parentFile)
      || this.plugin.parentLinkResolutionService.isIgnoredFile(childFile)
    ) {
      return false;
    }
    return await this.mutateMarkdownBody(parentFile, async (lines, raw) => (
      this.plugin.parentLinkResolutionService.isIgnoredFile(parentFile)
      || this.plugin.parentLinkResolutionService.isIgnoredFile(childFile)
        ? false
        : this.insertBodyLinkIntoLines(parentFile, childFile, checkboxState, lines, raw)
    ));
  }

  private insertBodyLinkIntoLines(
    parentFile: TFile,
    childFile: TFile,
    checkboxState: string | null | undefined,
    lines: string[],
    raw: string,
  ): boolean {
    const existing = this.plugin.bodySubitemLinkService.scanText(parentFile, raw);
    if (existing.some((entry) => entry.childPath === childFile.path)) return false;

    const line = this.buildBodyLinkLine(parentFile, childFile, checkboxState);
    const repaired = this.replaceBrokenPlaceholderWithLine(raw, line);
    const normalized = repaired !== raw ? repaired : this.insertLineAfterSubitemBlock(raw, line, existing);
    if (normalized === raw) return false;

    const nextLines = normalized.split('\n');
    lines.splice(0, lines.length, ...nextLines);
    return true;
  }

  /**
   * Insert a line after the existing subitem link block, maintaining ordering.
   * Falls back to inserting after frontmatter if no existing subitem links.
   */
  private insertLineAfterSubitemBlock(content: string, line: string, existingLinks: BodySubitemLink[]): string {
    const lines = content.split('\n');
    
    // Find the insertion point: after the last existing subitem link
    let insertAfterLine = -1;
    if (existingLinks.length > 0) {
      // Sort by line number descending to find the last one
      const sortedLinks = [...existingLinks].sort((a, b) => b.line - a.line);
      insertAfterLine = sortedLinks[0].line;
    }
    
    // If we found existing subitem links, insert after the last one
    if (insertAfterLine >= 0) {
      // Check if there's a blank line after the last subitem link
      const nextLineIndex = insertAfterLine + 1;
      const hasNextBlankLine = nextLineIndex < lines.length && lines[nextLineIndex]?.trim() === '';
      
      const resultLines = [...lines];
      if (hasNextBlankLine) {
        // Insert before the blank line to keep subitems grouped
        resultLines.splice(nextLineIndex, 0, line);
      } else {
        // Insert right after the last subitem link
        resultLines.splice(nextLineIndex, 0, line);
      }
      
      let result = resultLines.join('\n');
      if (!result.endsWith('\n')) result += '\n';
      return result;
    }
    
    // No existing subitem links - find frontmatter end and insert after it
    return this.insertLineAfterFrontmatter(content, line);
  }

  /**
   * Insert a line after frontmatter, or at the top if no frontmatter exists.
   * This ensures subitem links appear at a consistent location in the note body.
   */
  private insertLineAfterFrontmatter(content: string, line: string): string {
    const lines = content.split('\n');
    
    // Check for frontmatter (starts with --- on first line)
    if (lines[0]?.trim() !== '---') {
      // No frontmatter - insert at the top
      if (content.length === 0) return `${line}\n`;
      if (content.endsWith('\n')) return `${line}\n${content}`;
      return `${line}\n${content}`;
    }

    // Find the closing ---
    let frontmatterEndIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === '---') {
        frontmatterEndIndex = i;
        break;
      }
    }

    if (frontmatterEndIndex === -1) {
      // Unclosed frontmatter - append to end as fallback
      if (content.endsWith('\n') || content.length === 0) return `${content}${line}\n`;
      return `${content}\n${line}\n`;
    }

    // Insert after frontmatter closing ---
    // Keep one blank line between frontmatter and content if there was one
    const afterFrontmatter = lines.slice(frontmatterEndIndex + 1);
    const hasBlankLineAfter = afterFrontmatter.length > 0 && afterFrontmatter[0]?.trim() === '';
    
    // Build the new content
    const beforeInsert = lines.slice(0, frontmatterEndIndex + 1);
    const resultLines = [...beforeInsert, '', line];
    
    // Add remaining content, skipping leading blank line if we already added one
    const remainingContent = hasBlankLineAfter ? afterFrontmatter.slice(1) : afterFrontmatter;
    if (remainingContent.length > 0) {
      resultLines.push(...remainingContent);
    }
    
    // Ensure trailing newline
    let result = resultLines.join('\n');
    if (!result.endsWith('\n')) result += '\n';
    return result;
  }

  private buildBodyLinkLine(parentFile: TFile, childFile: TFile, checkboxState?: string | null): string {
    const sourcePath = this.plugin.app.metadataCache.fileToLinktext(childFile, parentFile.path, true) || childFile.path;
    return checkboxState
      ? `- ${checkboxState} [[${sourcePath}|${childFile.basename}]]`
      : `- [[${sourcePath}|${childFile.basename}]]`;
  }

  private resolveCheckboxStateForChild(childFile: TFile): string | null {
    const resolution = this.resolveChildWorkflowCheckboxForFile(childFile);
    return resolution.outcome === 'mapped' ? resolution.checkboxState : null;
  }

  private async removeBodyLink(parentFile: TFile, childFile: TFile): Promise<boolean> {
    return await this.mutateMarkdownBody(parentFile, async (lines) => {
      let changed = false;
      for (let index = lines.length - 1; index >= 0; index--) {
        const parsed = this.plugin.bodySubitemLinkService.parseLine(lines[index] || '');
        if (!parsed) continue;
        const resolved = resolveLinkTargetToFile(this.plugin.app, parsed.linkTarget, parentFile.path);
        if (!(resolved instanceof TFile) || resolved.path !== childFile.path) continue;
        lines.splice(index, 1);
        changed = true;
      }
      return changed;
    });
  }

  async mutateMarkdownBody(
    file: TFile,
    mutator: (lines: string[], raw: string) => boolean | Promise<boolean>,
  ): Promise<boolean> {
    if (this.plugin.settings?.dataArchitectureMode === 'native-records') return false;
    if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') return false;

    let changed = false;
    const started = performance.now();
    await this.runSerializedBodyMutation(file, async () => {
      const openViews = this.getOpenMarkdownViewsForFile(file);
      const raw = await this.readMarkdownText(file);
      const lines = raw.split('\n');
      const didChange = await mutator(lines, raw);
      if (!didChange) return;

      const next = lines.join('\n');
      if (next === raw) return;
      if (!this.hasSuspiciousBrokenSubitemLine(raw) && this.hasSuspiciousBrokenSubitemLine(next)) {
        new Notice(`Skipped suspicious subitem body write for "${file.basename}".`);
        logger.flowWarn('SubitemRelationship', 'suspicious-body-write-blocked', {
          file: file.path,
          raw,
          next,
          stack: new Error().stack,
        });
        return;
      }

      if (openViews.length > 0) {
        await this.writeOpenMarkdownViews(file, next, openViews);
      } else {
        await this.plugin.app.vault.modify(file, next);
      }
      changed = true;
    });

    logger.perf('subitemRelationship:mutateMarkdownBody', {
      file: file.path,
      changed,
      durationMs: Math.round(performance.now() - started),
      stack: changed ? compactStack(new Error().stack) : undefined,
    });
    return changed;
  }

  private async runSerializedBodyMutation(file: TFile, action: () => Promise<void>): Promise<void> {
    const key = file.path;
    const previous = this.bodyWriteChains.get(key) ?? Promise.resolve();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.bodyWriteChains.set(key, previous.then(() => gate).catch(() => gate));

    try {
      await previous;
      await action();
    } finally {
      release();
      if (this.bodyWriteChains.get(key) === gate) {
        this.bodyWriteChains.delete(key);
      }
    }
  }

  private getOpenMarkdownViewForFile(file: TFile): MarkdownView | null {
    return this.getOpenMarkdownViewsForFile(file)[0] ?? null;
  }

  private hasSuspiciousBrokenSubitemLine(text: string): boolean {
    return String(text || '').split('\n').some((line) => this.isSuspiciousBrokenSubitemLine(line));
  }

  private isSuspiciousBrokenSubitemLine(line: string): boolean {
    return /^[ \t]*(?:[-*+]|\d+\.)\s+(?:\[[^\]]+]\s+)?\[\[$/.test(String(line || '').trimEnd());
  }

  private replaceBrokenPlaceholderWithLine(content: string, replacementLine: string): string {
    const lines = content.split('\n');
    const brokenIndex = lines.findIndex((line) => this.isSuspiciousBrokenSubitemLine(line));
    if (brokenIndex < 0) return content;
    lines[brokenIndex] = replacementLine;
    let result = lines.join('\n');
    if (!result.endsWith('\n')) result += '\n';
    return result;
  }

  private getOpenMarkdownViewsForFile(file: TFile): MarkdownView[] {
    const leaves = [];
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      if (view.file?.path !== file.path) continue;
      leaves.push(leaf);
    }
    if (leaves.length === 0) return [];

    const activeLeaf = this.plugin.app.workspace.activeLeaf ?? null;
    const bestLeaf = pickBestMarkdownLeaf(leaves, activeLeaf);
    const orderedLeaves = bestLeaf
      ? [bestLeaf, ...leaves.filter((leaf) => leaf !== bestLeaf)]
      : leaves;

    return orderedLeaves
      .map((leaf) => getCompatibleMarkdownViewFromLeaf(leaf))
      .filter((view): view is MarkdownView => view instanceof MarkdownView);
  }

  private readViewData(view: MarkdownView): string {
    const anyView = view as any;
    const editor = anyView.editor;
    if (typeof editor?.getValue === 'function') {
      return String(editor.getValue() || '');
    }
    if (typeof anyView.getViewData === 'function') {
      const data = anyView.getViewData();
      if (typeof data === 'string') return data;
    }
    return String(anyView.data || '');
  }

  private readViewSource(view: MarkdownView): string | null {
    const anyView = view as any;
    const editor = anyView.editor;
    if (typeof editor?.getValue === 'function') {
      return String(editor.getValue() || '');
    }
    return null;
  }

  private async writeOpenMarkdownViews(file: TFile, next: string, views: MarkdownView[]): Promise<void> {
    const editorViews = views.filter((view) => {
      const editor = (view as any)?.editor;
      return typeof editor?.setValue === 'function';
    });

    if (editorViews.length === 0) {
      await this.plugin.app.vault.modify(file, next);
      return;
    }

    for (const view of editorViews) {
      const editor = (view as any).editor;
      editor.setValue(next);
    }

    const primaryView = editorViews[0] as any;
    if (typeof primaryView?.requestSave === 'function') {
      primaryView.requestSave();
      return;
    }
    if (typeof primaryView?.save === 'function') {
      try {
        await primaryView.save(false);
        return;
      } catch (error) {
        // Fall back to direct vault persistence if the live view save path fails.
      }
    }

    await this.plugin.app.vault.modify(file, next);
  }
}

function sameChildWorkflowCheckboxResolution(
  planned: ChildWorkflowCheckboxResolution,
  current: ChildWorkflowCheckboxResolution,
): boolean {
  if (
    planned.outcome !== current.outcome
    || planned.statusKey !== current.statusKey
    || planned.checkboxState !== current.checkboxState
    || planned.statuses.length !== current.statuses.length
    || planned.statuses.some((status, index) => status !== current.statuses[index])
    || planned.mappingPlans.length !== current.mappingPlans.length
  ) return false;
  return planned.mappingPlans.every((plan, index) => {
    const live = current.mappingPlans[index];
    return Boolean(
      live
      && plan.resolution === live.resolution
      && plan.checkboxState === live.checkboxState
      && plan.status === live.status
      && plan.statuses.length === live.statuses.length
      && plan.statuses.every((status, statusIndex) => status === live.statuses[statusIndex]),
    );
  });
}

function compactStack(stack: string | undefined): string[] | undefined {
  if (!stack) return undefined;
  return stack
    .split('\n')
    .slice(2, 8)
    .map((line) => line.trim())
    .filter(Boolean);
}
