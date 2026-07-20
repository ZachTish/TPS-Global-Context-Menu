import { MarkdownView, Notice, TFile, normalizePath } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import type {
  BodySubitemLink,
  MarkdownBodyMutationOutcome,
  ReconcileResult,
  RelationshipSideRemovalOutcome,
  RelationshipUnlinkOutcome,
} from './subitem-types';
import { normalizeLinkTarget, resolveLinkTargetToFile } from './link-target-service';
import { getCompatibleMarkdownViewFromLeaf, pickBestMarkdownLeaf } from './leaf-resolver';
import { mapStatusToSubitemCheckboxState } from '../utils/linked-subitem-mapping';
import { runFailClosedTwoSidedRemoval } from './relationship-outcome';
import * as logger from '../logger';

export class SubitemRelationshipSyncService {
  private bodyWriteChains = new Map<string, Promise<void>>();

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  async reconcileMarkdownParent(parentFile: TFile): Promise<ReconcileResult> {
    this.logRetiredAutoRepair('reconcileMarkdownParent', parentFile);
    return { addedParents: 0, removedParents: 0, touchedChildren: [] };
  }

  async reconcileMarkdownParentText(parentFile: TFile, raw: string): Promise<ReconcileResult> {
    this.logRetiredAutoRepair('reconcileMarkdownParentText', parentFile, { rawLength: raw.length });
    return { addedParents: 0, removedParents: 0, touchedChildren: [] };
  }

  async repairBrokenBodyLinksForParent(parentFile: TFile): Promise<number> {
    this.logRetiredAutoRepair('repairBrokenBodyLinksForParent', parentFile);
    return 0;
  }

  private async repairBrokenBodyLinksForParentLegacy(parentFile: TFile): Promise<number> {
    if (!(parentFile instanceof TFile) || parentFile.extension?.toLowerCase() !== 'md') return 0;

    let repairedCount = 0;
    await this.mutateMarkdownBody(parentFile, async (lines, raw) => {
      const brokenIndexes = this.getSuspiciousBrokenSubitemLineIndexes(lines);
      if (brokenIndexes.length === 0) return false;

      const existingLinks = this.plugin.bodySubitemLinkService.scanText(parentFile, raw);
      const existingChildPaths = new Set(existingLinks.map((entry) => entry.childPath));
      const missingChildren = this.getMarkdownChildrenForParent(parentFile)
        .filter((childFile) => !existingChildPaths.has(childFile.path));

      if (missingChildren.length === 0) return false;

      let changed = false;
      let insertedCount = 0;

      for (const index of brokenIndexes) {
        const nextChild = missingChildren.shift();
        if (!nextChild) break;
        const placeholderState =
          this.getBrokenSubitemPlaceholderCheckboxState(lines[index] || '') ??
          this.resolveCheckboxStateForChild(nextChild) ??
          '[ ]';
        lines[index] = this.buildBodyLinkLine(parentFile, nextChild, placeholderState);
        repairedCount += 1;
        changed = true;
      }

      if (missingChildren.length > 0) {
        let nextRaw = lines.join('\n');
        let nextLinks = this.plugin.bodySubitemLinkService.scanText(parentFile, nextRaw);
        for (const childFile of missingChildren) {
          nextRaw = this.insertLineAfterSubitemBlock(
            nextRaw,
            this.buildBodyLinkLine(parentFile, childFile, this.resolveCheckboxStateForChild(childFile)),
            nextLinks,
          );
          nextLinks = this.plugin.bodySubitemLinkService.scanText(parentFile, nextRaw);
          insertedCount += 1;
        }
        if (insertedCount > 0) {
          lines.splice(0, lines.length, ...nextRaw.split('\n'));
          repairedCount += insertedCount;
          changed = true;
        }
      }

      return changed;
    });

    return repairedCount;
  }

  async ensureBodyLinksForChild(childFile: TFile): Promise<number> {
    this.logRetiredAutoRepair('ensureBodyLinksForChild', childFile);
    return 0;
  }

  private async ensureBodyLinksForChildLegacy(childFile: TFile): Promise<number> {
    if (!(childFile instanceof TFile) || childFile.extension?.toLowerCase() !== 'md') return 0;

    // Check if child file should be ignored based on folder or tag
    if (this.shouldIgnoreForAutoEmbed(childFile)) return 0;

    let inserted = 0;
    const parents = this.plugin.parentLinkResolutionService.getParentsForChild(childFile);
    const checkboxState = this.resolveCheckboxStateForChild(childFile);

    for (const entry of parents) {
      const parentFile = entry.file;
      if (!(parentFile instanceof TFile) || parentFile.path === childFile.path) continue;
      if (entry.kind !== 'markdown-parent') continue;
      const changed = await this.insertBodyLink(parentFile, childFile, checkboxState);
      if (changed) inserted += 1;
    }

    return inserted;
  }

  async readMarkdownText(file: TFile): Promise<string> {
    if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') return '';
    for (const openView of this.getOpenMarkdownViewsForFile(file)) {
      const source = this.readViewSource(openView);
      if (source != null) return source;
    }
    return await this.plugin.app.vault.read(file);
  }

  private async reconcileMarkdownParentLinks(
    parentFile: TFile,
    bodyLinks: BodySubitemLink[],
    options: { removeStaleParents: boolean },
  ): Promise<ReconcileResult> {
    const desiredChildren = new Map(bodyLinks.map((entry) => [entry.childPath, entry.childFile]));
    const touchedChildren = new Map<string, TFile>();
    let addedParents = 0;
    let removedParents = 0;

    for (const childFile of desiredChildren.values()) {
      if (!(await this.plugin.bulkEditService.canMutateFrontmatterSafely(childFile))) continue;
      const changed = await this.plugin.parentLinkResolutionService.addParentToChild(childFile, parentFile);
      if (changed) {
        addedParents += 1;
        touchedChildren.set(childFile.path, childFile);
      }
    }

    if (options.removeStaleParents) {
      for (const file of this.plugin.app.vault.getMarkdownFiles()) {
        if (file.path === parentFile.path) continue;
        if (!this.plugin.parentLinkResolutionService.hasParent(file, parentFile)) continue;
        if (desiredChildren.has(file.path)) continue;
        if (!(await this.plugin.bulkEditService.canMutateFrontmatterSafely(file))) continue;
        const changed = await this.plugin.parentLinkResolutionService.removeParentFromChild(file, parentFile);
        if (changed) {
          removedParents += 1;
          touchedChildren.set(file.path, file);
        }
      }
    }

    const statusSyncCandidates = new Map<string, TFile>();
    for (const childFile of desiredChildren.values()) {
      statusSyncCandidates.set(childFile.path, childFile);
    }
    for (const childFile of touchedChildren.values()) {
      statusSyncCandidates.set(childFile.path, childFile);
    }
    for (const childFile of statusSyncCandidates.values()) {
      const currentParentReferences = bodyLinks.filter((entry) => entry.childPath === childFile.path);
      const savedReferences = await this.plugin.subitemReferenceIndexService.getReferencesForChild(childFile);
      const mergedReferences = [
        ...savedReferences.filter((entry) => entry.parentPath !== parentFile.path),
        ...currentParentReferences,
      ];
      await this.plugin.linkedSubitemCheckboxService.syncDerivedStatusForChildFromReferences(childFile, mergedReferences);
    }

    return {
      addedParents,
      removedParents,
      touchedChildren: Array.from(touchedChildren.values()),
    };
  }

  async linkExistingChildToParent(childFile: TFile, parentFile: TFile, options?: { insertBodyLink?: boolean; checkboxState?: string | null }): Promise<boolean> {
    let changed = false;
    if (parentFile.extension?.toLowerCase() === 'md' && options?.insertBodyLink === true) {
      const checkboxState = options?.checkboxState !== undefined ? options.checkboxState : this.resolveCheckboxStateForChild(childFile);
      changed = (await this.insertBodyLink(parentFile, childFile, checkboxState)) || changed;
    }
    changed = (await this.plugin.parentLinkResolutionService.addParentToChild(childFile, parentFile)) || changed;
    return changed;
  }

  async unlinkChildFromParent(childFile: TFile, parentFile: TFile): Promise<RelationshipUnlinkOutcome> {
    const result = await runFailClosedTwoSidedRemoval(
      () => this.plugin.parentLinkResolutionService.removeParentFromChildWithOutcome(childFile, parentFile),
      () => parentFile.extension?.toLowerCase() === 'md'
        ? this.removeBodyLinkWithOutcome(parentFile, childFile)
        : Promise.resolve('absent'),
    );
    return {
      status: result.status,
      child: result.first,
      parent: result.second,
    };
  }

  public async insertBodyLink(parentFile: TFile, childFile: TFile, checkboxState?: string | null): Promise<boolean> {
    return await this.mutateMarkdownBody(parentFile, async (lines, raw) => {
      const existing = this.plugin.bodySubitemLinkService.scanText(parentFile, raw);
      if (existing.some((entry) => entry.childPath === childFile.path)) return false;

      const line = this.buildBodyLinkLine(parentFile, childFile, checkboxState);

      const repaired = this.replaceBrokenPlaceholderWithLine(raw, line);
      const normalized = repaired !== raw ? repaired : this.insertLineAfterSubitemBlock(raw, line, existing);
      if (normalized === raw) return false;

      const nextLines = normalized.split('\n');
      lines.splice(0, lines.length, ...nextLines);
      return true;
    });
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
    const statusKey = String(this.plugin.settings.properties?.find((prop) => prop.id === 'status')?.key || 'status').trim() || 'status';
    const frontmatter = (this.plugin.app.metadataCache.getFileCache(childFile)?.frontmatter || {}) as Record<string, unknown>;
    const actualKey = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === statusKey.toLowerCase());
    const statusValue = String(actualKey ? frontmatter[actualKey] : '').trim();
    const mapped = mapStatusToSubitemCheckboxState(
      this.plugin.settings.linkedSubitemCheckboxMappings || [],
      statusValue,
    );
    if (mapped) return mapped;
    return statusValue ? (this.plugin.settings.linkedSubitemDefaultOpenState || '[ ]') : null;
  }

  private async removeBodyLinkWithOutcome(
    parentFile: TFile,
    childFile: TFile,
  ): Promise<RelationshipSideRemovalOutcome> {
    let relationPresent = false;
    let relationUnverified = false;
    const outcome = await this.mutateMarkdownBodyWithOutcome(parentFile, (lines) => {
      for (let index = lines.length - 1; index >= 0; index--) {
        const parsed = this.plugin.bodySubitemLinkService.parseLine(lines[index] || '');
        if (!parsed) continue;
        const resolved = resolveLinkTargetToFile(this.plugin.app, parsed.linkTarget, parentFile.path);
        if (!(resolved instanceof TFile)) {
          if (this.unresolvedLinkTargetMayReferenceFile(parsed.linkTarget, childFile)) {
            relationUnverified = true;
          }
          continue;
        }
        if (resolved.path !== childFile.path) continue;
        lines.splice(index, 1);
        relationPresent = true;
      }
      return relationPresent;
    });
    if (outcome === 'refused' || relationUnverified) return 'refused';
    return outcome === 'changed' && relationPresent ? 'removed' : 'absent';
  }

  private unresolvedLinkTargetMayReferenceFile(rawTarget: string, file: TFile): boolean {
    const normalizedTarget = normalizePath(normalizeLinkTarget(rawTarget)).replace(/\.md$/i, '').toLowerCase();
    if (!normalizedTarget) return false;
    const normalizedPath = normalizePath(file.path).replace(/\.md$/i, '').toLowerCase();
    return normalizedTarget === normalizedPath || normalizedTarget === file.basename.toLowerCase();
  }

  async mutateMarkdownBody(
    file: TFile,
    mutator: (lines: string[], raw: string) => boolean | Promise<boolean>,
  ): Promise<boolean> {
    return (await this.mutateMarkdownBodyWithOutcome(file, mutator)) === 'changed';
  }

  async mutateMarkdownBodyWithOutcome(
    file: TFile,
    mutator: (lines: string[], raw: string) => boolean | Promise<boolean>,
  ): Promise<MarkdownBodyMutationOutcome> {
    if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') return 'refused';

    const mutationState: { outcome: MarkdownBodyMutationOutcome } = { outcome: 'unchanged' };
    const started = performance.now();
    await this.runSerializedBodyMutation(file, async () => {
      try {
        const editorViews = this.getOpenMarkdownViewsForFile(file).filter((view) => {
          const editor = view.editor;
          return typeof editor?.getValue === 'function' && typeof editor?.setValue === 'function';
        });
        const raw = editorViews.length > 0
          ? this.readViewSource(editorViews[0])
          : await this.plugin.app.vault.read(file);
        if (raw == null) {
          mutationState.outcome = 'refused';
          return;
        }

        const lines = raw.split('\n');
        const didChange = await mutator(lines, raw);
        if (!didChange) return;

        const next = lines.join('\n');
        if (next === raw) return;
        if (!this.isBodyMutationSafe(file, raw, next)) {
          mutationState.outcome = 'refused';
          return;
        }

        if (editorViews.length > 0) {
          mutationState.outcome = await this.writeOpenMarkdownViews(file, next, raw, editorViews)
            ? 'changed'
            : 'refused';
          return;
        }

        let committed = false;
        let stale = false;
        await this.plugin.app.vault.process(file, (current: string) => {
          if (current !== raw) {
            stale = true;
            return current;
          }
          committed = true;
          return next;
        });
        mutationState.outcome = committed && !stale ? 'changed' : 'refused';
        if (stale) {
          logger.flowWarn('SubitemRelationship', 'stale-closed-note-body-write-refused', { file: file.path });
        }
      } catch (error) {
        mutationState.outcome = 'refused';
        logger.flowWarn('SubitemRelationship', 'body-write-refused', {
          file: file.path,
          error: logger.errorSummary(error),
        });
      }
    });
    const finalOutcome = mutationState.outcome;

    logger.perf('subitemRelationship:mutateMarkdownBody', {
      file: file.path,
      outcome: finalOutcome,
      durationMs: Math.round(performance.now() - started),
      stack: finalOutcome === 'changed' ? compactStack(new Error().stack) : undefined,
    });
    return finalOutcome;
  }

  private isBodyMutationSafe(file: TFile, raw: string, next: string): boolean {
    if (this.hasSuspiciousBrokenSubitemLine(raw) || !this.hasSuspiciousBrokenSubitemLine(next)) return true;
    new Notice(`Skipped suspicious subitem body write for "${file.basename}".`);
    logger.flowWarn('SubitemRelationship', 'suspicious-body-write-blocked', {
      file: file.path,
      previousLength: raw.length,
      nextLength: next.length,
      stack: compactStack(new Error().stack),
    });
    return false;
  }

  private shouldIgnoreForAutoEmbed(file: TFile): boolean {
    // Check if file is in an ignored folder
    const ignoreFolders = this.plugin.settings.autoEmbedIgnoreFolders || [];
    const filePath = file.path.toLowerCase();
    for (const folder of ignoreFolders) {
      const normalizedFolder = folder.trim().toLowerCase();
      if (!normalizedFolder) continue;
      if (filePath.startsWith(normalizedFolder + '/') || filePath.startsWith(normalizedFolder)) {
        return true;
      }
    }

    // Check if file has an ignored tag
    const ignoreTags = this.plugin.settings.autoEmbedIgnoreTags || [];
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const fm = (cache?.frontmatter || {}) as Record<string, unknown>;
    const tagsKey = Object.keys(fm).find((k) => k.toLowerCase() === 'tags');
    const fileTags = Array.isArray(fm[tagsKey || 'tags']) ? fm[tagsKey || 'tags'] as string[] : [];
    
    for (const ignoreTag of ignoreTags) {
      const normalizedTag = ignoreTag.trim().toLowerCase().replace(/^#/, '');
      if (!normalizedTag) continue;
      for (const fileTag of fileTags) {
        if (String(fileTag).trim().toLowerCase().replace(/^#/, '') === normalizedTag) {
          return true;
        }
      }
    }

    return false;
  }

  private logRetiredAutoRepair(method: string, file: TFile, details?: Record<string, unknown>): void {
    if (!this.plugin.settings.enableLogging) return;
    logger.flow('SubitemRelationship', 'retired-auto-repair-skipped', {
      method,
      file: file instanceof TFile ? file.path : null,
      ...(details ?? {}),
    });
  }

  private async runSerializedBodyMutation(file: TFile, action: () => Promise<void>): Promise<void> {
    const key = file.path;
    const previous = this.bodyWriteChains.get(key) ?? Promise.resolve();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const queued = previous.catch(() => undefined).then(() => gate);
    this.bodyWriteChains.set(key, queued);

    try {
      await previous.catch(() => undefined);
      await action();
    } finally {
      release();
      if (this.bodyWriteChains.get(key) === queued) {
        this.bodyWriteChains.delete(key);
      }
    }
  }

  private hasSuspiciousBrokenSubitemLine(text: string): boolean {
    return String(text || '').split('\n').some((line) => this.isSuspiciousBrokenSubitemLine(line));
  }

  private getSuspiciousBrokenSubitemLineIndexes(lines: string[]): number[] {
    const output: number[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (this.isSuspiciousBrokenSubitemLine(lines[index] || '')) {
        output.push(index);
      }
    }
    return output;
  }

  private isSuspiciousBrokenSubitemLine(line: string): boolean {
    return /^[ \t]*(?:[-*+]|\d+\.)\s+(?:\[[^\]]+]\s+)?\[\[$/.test(String(line || '').trimEnd());
  }

  private getBrokenSubitemPlaceholderCheckboxState(line: string): string | null {
    const match = String(line || '').trimEnd().match(/^[ \t]*(?:[-*+]|\d+\.)\s+(\[[^\]]+])\s+\[\[$/);
    return match?.[1] ? String(match[1]).trim() : null;
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

  private getMarkdownChildrenForParent(parentFile: TFile): TFile[] {
    return this.plugin.app.vault
      .getMarkdownFiles()
      .filter((file) =>
        this.plugin.parentLinkResolutionService
          .getParentsForChild(file)
          .some((entry) => entry.kind === 'markdown-parent' && entry.file.path === parentFile.path),
      )
      .sort((a, b) => a.path.localeCompare(b.path));
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

  private async writeOpenMarkdownViews(
    file: TFile,
    next: string,
    expected: string,
    views: MarkdownView[],
  ): Promise<boolean> {
    const editorViews = views.filter((view) => {
      const editor = view.editor;
      return typeof editor?.getValue === 'function' && typeof editor?.setValue === 'function';
    });

    if (editorViews.length === 0) return false;
    if (editorViews.some((view) => this.readViewSource(view) !== expected)) {
      logger.flowWarn('SubitemRelationship', 'stale-open-editor-body-write-refused', { file: file.path });
      return false;
    }

    const primaryView = editorViews[0];
    const canRequestSave = typeof primaryView?.requestSave === 'function';
    if (!canRequestSave) {
      logger.flowWarn('SubitemRelationship', 'open-editor-save-unavailable', { file: file.path });
      return false;
    }

    for (const view of editorViews) {
      view.editor.setValue(next);
    }

    if (typeof primaryView?.requestSave === 'function') {
      primaryView.requestSave();
      return true;
    }
    return false;
  }
}

function compactStack(stack: string | undefined): string[] | undefined {
  if (!stack) return undefined;
  return stack
    .split('\n')
    .slice(2, 8)
    .map((line) => line.trim())
    .filter(Boolean);
}
