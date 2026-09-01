import { Editor, normalizePath, Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { FileSuggestModal } from '../modals/FileSuggestModal';
import {
  getPlainTaskTitle,
  getTaskDisplayTitle,
  getTaskSourceTitle,
  normalizeTaskAssociatedNotePath,
  parseTaskLine,
  parseTaskTitleLink,
  readInlineFieldValue,
  readTaskAssociatedNotePath,
  setTaskAssociatedNotePath,
  setTaskTitle,
  updateTaskLineTimestamps,
} from '../utils/task-line-metadata';
import { createSubitemForParentWithTitle, getDefaultSubitemFolderPath } from './subitem-creation-service';
import * as logger from '../logger';
import {
  abortDirectTaskHistory,
  beginDirectTaskHistory,
  commitDirectTaskHistory,
  ensureDirectTaskHistoryIdentity,
  type DirectTaskHistoryLocation,
  type DirectTaskHistoryLogContext,
} from '../utils/direct-task-history';

type LineContext = {
  file: TFile;
  lineIndex: number;
  rawLine: string;
};

type LineTransform = (line: string) => string;

type FileBearingView = {
  file?: TFile | null;
};

const LIST_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/;

export class DailyInboxLineService {
  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  promptArchiveCurrentEditorLine(editor: Editor, view: FileBearingView): void {
    const file = view.file;
    if (!(file instanceof TFile)) {
      new Notice('No active markdown file.');
      return;
    }
    const lineIndex = editor.getCursor().line;
    const rawLine = editor.getLine(lineIndex);
    const nextLine = this.withModifiedTimestamp(this.archiveLine(rawLine));
    if (nextLine === rawLine) {
      new Notice('Could not archive this line.');
      return;
    }
    editor.replaceRange(nextLine, { line: lineIndex, ch: 0 }, { line: lineIndex, ch: rawLine.length });
    this.notifyChanged(file, 'daily-inbox-archive-editor-line');
  }

  promptTransferCurrentEditorLine(editor: Editor, view: FileBearingView): void {
    const file = view.file;
    if (!(file instanceof TFile)) {
      new Notice('No active markdown file.');
      return;
    }
    const lineIndex = editor.getCursor().line;
    const rawLine = editor.getLine(lineIndex);
    this.promptTransferLine({ file, lineIndex, rawLine }, (nextLine) => {
      editor.replaceRange(this.withModifiedTimestamp(nextLine), { line: lineIndex, ch: 0 }, { line: lineIndex, ch: rawLine.length });
      this.notifyChanged(file, 'daily-inbox-transfer-editor-line');
    });
  }

  promptLinkCurrentEditorTaskLine(editor: Editor, view: FileBearingView): void {
    const file = view.file;
    if (!(file instanceof TFile)) {
      new Notice('No active markdown file.');
      return;
    }
    const lineIndex = editor.getCursor().line;
    const rawLine = editor.getLine(lineIndex);
    if (!parseTaskLine(rawLine)) {
      new Notice('Current line is not a checkbox task.');
      return;
    }
    const context = { file, lineIndex, rawLine };
    this.promptLinkTaskLine(context, (transform) => {
      const lines = editor.getValue().split(/\r?\n/);
      const currentIndex = this.resolveLineIndex(lines, context);
      if (currentIndex < 0) {
        new Notice('Could not update the selected line.');
        return false;
      }
      const currentLine = editor.getLine(currentIndex);
      const nextLine = this.withModifiedTimestamp(transform(currentLine));
      if (nextLine === currentLine) return true;
      editor.replaceRange(nextLine, { line: currentIndex, ch: 0 }, { line: currentIndex, ch: currentLine.length });
      context.lineIndex = currentIndex;
      context.rawLine = nextLine;
      this.notifyChanged(file, 'daily-inbox-link-editor-task-line');
      return true;
    });
  }

  async archiveTaskLine(context: LineContext): Promise<void> {
    await this.updateLineInFile(context, (line) => this.archiveLine(line), 'Archived item.');
  }

  promptTransferTaskLine(context: LineContext): void {
    this.promptTransferLine(context, (nextLine) => {
      void this.updateLineInFile(context, () => nextLine, 'Transferred item.');
    });
  }

  promptLinkTaskLineInFile(context: LineContext): void {
    if (!parseTaskLine(context.rawLine)) {
      new Notice('Selected line is not a checkbox task.');
      return;
    }
    this.promptLinkTaskLine(context, (transform) => {
      return this.updateLineInFile(
        context,
        transform,
        'Linked task to note.',
        'daily-inbox-link-task-association',
      );
    });
  }

  async createNoteForLine(context: LineContext): Promise<TFile | null> {
    if (!(await this.refreshLineContext(context))) return null;

    const rawTitle = this.getLineSourceTitle(context.rawLine);
    const legacyLink = parseTaskTitleLink(rawTitle);
    const title = getPlainTaskTitle(rawTitle);
    if (!title) {
      new Notice('Could not resolve line text.');
      return null;
    }
    const itemKind = parseTaskLine(context.rawLine) ? 'task' : 'bullet';
    const hiddenPath = readTaskAssociatedNotePath(context.rawLine);
    const associationSource = hiddenPath ? 'hidden' : legacyLink ? 'legacy-link' : 'new';
    const requestedPath = hiddenPath || legacyLink?.targetPath || '';
    const pathExisting = requestedPath
      ? this.resolveAssociatedNoteFile(requestedPath, context.file, hiddenPath !== '')
      : null;
    const matchingChild = pathExisting
      ? { file: null, matchCount: 0 }
      : this.resolveUniqueMatchingChildNote(title, context.file);
    if (!pathExisting && matchingChild.matchCount > 1) {
      logger.flowWarn('DailyInboxLine', 'create-note-for-line:ambiguous-child', {
        sourcePath: context.file.path,
        line: context.lineIndex + 1,
        itemKind,
        associationSource,
        matchingChildCount: matchingChild.matchCount,
      });
      new Notice('Multiple child notes match this task title. Use “Link task to note…” to choose one.');
      return null;
    }
    const existing = pathExisting || matchingChild.file;
    const resolutionRoute = pathExisting
      ? 'stored-path'
      : matchingChild.file
        ? 'matching-child'
        : 'create';
    logger.flow('DailyInboxLine', 'create-note-for-line:start', {
      sourcePath: context.file.path,
      line: context.lineIndex + 1,
      itemKind,
      associationSource,
      existing: existing instanceof TFile,
      resolutionRoute,
      matchingChildCount: matchingChild.matchCount,
    });
    this.plugin.eventService.emitExplicitAction([context.file.path], {
      source: 'daily-inbox-create-note-for-line',
    });

    const requestedTargetPath = existing
      ? existing.path
      : requestedPath
        ? this.buildRequestedNotePath(requestedPath, context.file, hiddenPath !== '')
        : '';
    const noteFile = existing || await createSubitemForParentWithTitle(
        this.plugin,
        context.file,
        title,
        getDefaultSubitemFolderPath(this.plugin, context.file),
        {
          seedParentTags: false,
          insertParentBodyLink: false,
          inheritParentTemporalMetadata: false,
          saveFolderPath: false,
          targetPath: requestedTargetPath || undefined,
          frontmatterTitle: title,
        },
      );
    if (!(noteFile instanceof TFile)) {
      logger.flowWarn('DailyInboxLine', 'create-note-for-line:failed', {
        sourcePath: context.file.path,
        line: context.lineIndex + 1,
        itemKind,
        associationSource,
        stage: 'create-or-resolve-note',
      });
      return null;
    }

    const sourceUpdated = await this.updateLineInFile(
      context,
      (currentLine) => this.associateLineWithNote(currentLine, noteFile.path, title),
      '',
      'daily-inbox-create-note-association',
    );
    if (!sourceUpdated) {
      logger.flowWarn('DailyInboxLine', 'create-note-for-line:failed', {
        sourcePath: context.file.path,
        line: context.lineIndex + 1,
        itemKind,
        associationSource,
        stage: 'write-source-association',
        notePath: noteFile.path,
        noteRetained: true,
      });
      return null;
    }
    const opened = await this.openAssociatedNote(noteFile);
    logger.flow('DailyInboxLine', 'create-note-for-line:done', {
      sourcePath: context.file.path,
      line: context.lineIndex + 1,
      itemKind,
      associationSource,
      route: resolutionRoute,
      notePath: noteFile.path,
      sourceUpdated,
      opened,
    });
    return noteFile;
  }

  archiveLine(line: string): string {
    const source = String(line || '');
    const task = parseTaskLine(source);
    if (task) {
      return `${task.prefix}${this.strike(this.stripExistingStrike(task.body))}`.trimEnd();
    }

    const listMatch = source.match(LIST_LINE_RE);
    if (listMatch) {
      const prefix = String(listMatch[1] || '');
      const body = String(listMatch[2] || '').trim();
      if (!body) return source;
      return `${prefix}${this.strike(this.stripExistingStrike(body))}`.trimEnd();
    }

    const body = source.trim();
    if (!body) return source;
    const indent = source.match(/^\s*/)?.[0] || '';
    return `${indent}${this.strike(this.stripExistingStrike(body))}`.trimEnd();
  }

  private promptTransferLine(context: LineContext, apply: (nextLine: string) => void): void {
    new FileSuggestModal(this.plugin.app, async (targetFile) => {
      const title = this.getLineTitle(context.rawLine);
      if (!title) {
        new Notice('Could not resolve line text.');
        return;
      }
      await this.appendTransferText(targetFile, title);
      const linked = this.makeWikiLink(targetFile, title);
      const nextLine = this.archiveLineWithBody(context.rawLine, linked);
      apply(nextLine);
      this.notifyChanged(targetFile, 'daily-inbox-transfer-target');
      new Notice(`Transferred to ${targetFile.basename}.`);
    }, { extensions: ['md'] }).open();
  }

  private promptLinkTaskLine(context: LineContext, apply: (transform: LineTransform) => boolean | Promise<boolean>): void {
    new FileSuggestModal(this.plugin.app, async (targetFile) => {
      const transform: LineTransform = (currentLine) => this.associateLineWithNote(
        currentLine,
        targetFile.path,
        targetFile.basename,
      );
      const sourceUpdated = await apply(transform);
      if (!sourceUpdated) {
        logger.flowWarn('DailyInboxLine', 'link-task-to-note:source-update-failed', {
          sourcePath: context.file.path,
          line: context.lineIndex + 1,
          notePath: targetFile.path,
        });
        return;
      }
      const opened = await this.openAssociatedNote(targetFile);
      logger.flow('DailyInboxLine', 'link-task-to-note', {
        sourcePath: context.file.path,
        line: context.lineIndex + 1,
        notePath: targetFile.path,
        opened,
      });
      new Notice(`Linked task to ${targetFile.basename}.`);
    }, { extensions: ['md'] }).open();
  }

  private async updateLineInFile(
    context: LineContext,
    transform: LineTransform,
    notice: string,
    reason = 'daily-inbox-update-line',
  ): Promise<boolean> {
    let resolved = false;
    let changed = false;
    let committedLine = '';
    let historyReady = true;
    let confirmedHistoryBefore: DirectTaskHistoryLocation | undefined;
    const historyContext: DirectTaskHistoryLogContext = {
      action: 'task.update',
      surface: reason,
      path: context.file.path,
      lineNumber: context.lineIndex,
    };
    const historyHandle = parseTaskLine(context.rawLine)
      ? await beginDirectTaskHistory(this.plugin.itemHistoryService, {
          action: historyContext.action,
          cause: {
            kind: 'user',
            sourcePluginId: 'tps-global-context-menu',
            surface: reason,
          },
          before: {
            path: context.file.path,
            lineNumber: context.lineIndex,
            rawLine: context.rawLine,
          },
        })
      : null;
    try {
      await this.plugin.app.vault.process(context.file, (content) => {
        const newline = content.includes('\r\n') ? '\r\n' : '\n';
        const endsWithNewline = /\r?\n$/.test(content);
        const lines = content.split(/\r?\n/);
        if (endsWithNewline) lines.pop();
        const lineIndex = this.resolveLineIndex(lines, context);
        if (lineIndex < 0) return content;
        const currentLine = lines[lineIndex] || '';
        confirmedHistoryBefore = {
          path: context.file.path,
          lineNumber: lineIndex,
          rawLine: currentLine,
        };
        let nextLine = this.withModifiedTimestamp(transform(currentLine));
        resolved = true;
        context.lineIndex = lineIndex;
        if (nextLine === currentLine) return content;
        if (historyHandle) {
          if (!parseTaskLine(currentLine) || !parseTaskLine(nextLine)) {
            historyReady = false;
          } else {
            const ensured = ensureDirectTaskHistoryIdentity(
              this.plugin.itemHistoryService,
              historyHandle,
              nextLine,
              historyContext,
            );
            nextLine = ensured.line;
            historyReady = ensured.ready;
          }
        }
        context.rawLine = nextLine;
        committedLine = nextLine;
        lines[lineIndex] = nextLine;
        changed = true;
        return `${lines.join(newline)}${endsWithNewline ? newline : ''}`;
      });
    } catch (error) {
      await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
      logger.flowError('DailyInboxLine', 'line-update:failed', error, {
        sourcePath: context.file.path,
        renderedLine: context.lineIndex + 1,
        reason,
      });
      new Notice('Could not update the selected line.');
      return false;
    }
    if (!resolved) {
      await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
      logger.flowWarn('DailyInboxLine', 'line-update:unresolved', {
        sourcePath: context.file.path,
        renderedLine: context.lineIndex + 1,
        reason,
      });
      new Notice('Could not update the selected line.');
      return false;
    }
    if (changed) {
      if (historyReady && committedLine) {
        await commitDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, {
          ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
          after: {
            path: context.file.path,
            lineNumber: context.lineIndex,
            rawLine: committedLine,
          },
          sourceDisposition: 'retained',
          outcome: 'committed',
        }, historyContext);
      } else {
        await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
      }
      this.notifyChanged(context.file, reason);
    } else {
      await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
    }
    if (notice) new Notice(notice);
    return true;
  }

  private resolveLineIndex(lines: string[], context: LineContext): number {
    if (this.isSupportedLine(lines[context.lineIndex] || '') && lines[context.lineIndex] === context.rawLine) {
      return context.lineIndex;
    }
    const exactMatches = lines
      .map((line, index) => line === context.rawLine && this.isSupportedLine(line) ? index : -1)
      .filter((index) => index >= 0);
    if (exactMatches.length === 1) return exactMatches[0];

    for (const key of ['tpsId', 'subitemId']) {
      const identity = readInlineFieldValue(context.rawLine, key);
      if (!identity) continue;
      const matches = lines
        .map((line, index) => this.isSupportedLine(line) && readInlineFieldValue(line, key) === identity ? index : -1)
        .filter((index) => index >= 0);
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) return -1;
    }

    const title = getPlainTaskTitle(this.getLineTitle(context.rawLine)).toLowerCase();
    if (!title) return -1;
    const titleMatches = lines
      .map((line, index) => this.isSupportedLine(line) && getPlainTaskTitle(this.getLineTitle(line)).toLowerCase() === title ? index : -1)
      .filter((index) => index >= 0);
    return titleMatches.length === 1 ? titleMatches[0] : -1;
  }

  private archiveLineWithBody(line: string, body: string): string {
    const task = parseTaskLine(line);
    if (task) return `${task.prefix}${this.strike(body)}`.trimEnd();
    const listMatch = String(line || '').match(LIST_LINE_RE);
    if (listMatch) return `${String(listMatch[1] || '')}${this.strike(body)}`.trimEnd();
    const indent = String(line || '').match(/^\s*/)?.[0] || '';
    return `${indent}${this.strike(body)}`.trimEnd();
  }

  private withModifiedTimestamp(line: string): string {
    if (!parseTaskLine(line)) return line;
    return updateTaskLineTimestamps(line, {
      enabled: this.plugin.settings.autoSyncFileTimestamps === true,
      modifiedKey: this.plugin.settings.dateModifiedFrontmatterKey,
      format: this.plugin.settings.fileTimestampFormat,
      markModified: true,
    });
  }

  private getLineTitle(line: string): string {
    const taskTitle = getTaskDisplayTitle(line);
    if (taskTitle) return this.stripExistingStrike(taskTitle);
    const listMatch = String(line || '').match(LIST_LINE_RE);
    const body = listMatch ? this.splitListLineBody(String(listMatch[2] || '')).title : String(line || '');
    return this.stripExistingStrike(body).replace(/\s+/g, ' ').trim();
  }

  private getLineSourceTitle(line: string): string {
    const taskTitle = getTaskSourceTitle(line);
    if (taskTitle) return this.stripExistingStrike(taskTitle);
    return this.getLineTitle(line);
  }

  private setLineTitle(line: string, title: string): string {
    if (parseTaskLine(line)) return setTaskTitle(line, title);
    const listMatch = String(line || '').match(LIST_LINE_RE);
    if (!listMatch) return title;
    const parts = this.splitListLineBody(String(listMatch[2] || ''));
    return `${String(listMatch[1] || '')}${title}${parts.suffix}`.trimEnd();
  }

  private associateLineWithNote(line: string, notePath: string, fallbackTitle: string): string {
    const currentTitle = getPlainTaskTitle(this.getLineTitle(line)) || getPlainTaskTitle(fallbackTitle);
    if (!currentTitle) return line;
    return this.setLineTitle(setTaskAssociatedNotePath(line, notePath), currentTitle);
  }

  private splitListLineBody(body: string): { title: string; suffix: string } {
    const source = String(body || '');
    const metadataStart = source.search(/\s+(?=(?:#[\p{L}\p{N}_/-]+|\[[^\]\n]+::[^\]\n]*\]|%%\s*tps-inline-props\s*:|<!--\s*tps-inline-props\s*:|<span\b[^>]*data-tps-inline-props\s*=))/iu);
    if (metadataStart < 0) return { title: source.trim(), suffix: '' };
    return {
      title: source.slice(0, metadataStart).trim(),
      suffix: source.slice(metadataStart),
    };
  }

  private async appendTransferText(targetFile: TFile, title: string): Promise<void> {
    if (!(targetFile instanceof TFile) || targetFile.extension?.toLowerCase() !== 'md') return;
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) return;
    await this.plugin.app.vault.process(targetFile, (content) => {
      if (content.includes(cleanTitle)) return content;
      const newline = content.includes('\r\n') ? '\r\n' : '\n';
      const separator = content.endsWith('\n') || content.length === 0 ? '' : newline;
      return `${content}${separator}- ${cleanTitle}${newline}`;
    });
  }

  private makeWikiLink(file: TFile, alias: string): string {
    const target = String(file.path || file.basename).replace(/\.md$/i, '');
    const cleanAlias = String(alias || file.basename).replace(/\|/g, '/').trim() || file.basename;
    return `[[${target}|${cleanAlias}]]`;
  }

  private strike(body: string): string {
    const clean = String(body || '').trim();
    if (!clean) return '';
    return /^~~[\s\S]*~~$/.test(clean) ? clean : `~~${clean}~~`;
  }

  private stripExistingStrike(body: string): string {
    return String(body || '').trim().replace(/^~~([\s\S]*)~~$/, '$1').trim();
  }

  private async refreshLineContext(context: LineContext): Promise<boolean> {
    try {
      const content = await this.plugin.app.vault.cachedRead(context.file);
      const lines = content.split(/\r?\n/);
      const lineIndex = this.resolveLineIndex(lines, context);
      if (lineIndex < 0) {
        logger.flowWarn('DailyInboxLine', 'create-note-for-line:stale-target', {
          sourcePath: context.file.path,
          renderedLine: context.lineIndex + 1,
        });
        new Notice('That task or bullet changed before its note could be opened. Refresh and try again.');
        return false;
      }
      context.lineIndex = lineIndex;
      context.rawLine = lines[lineIndex] || '';
      return true;
    } catch (error) {
      logger.flowError('DailyInboxLine', 'create-note-for-line:preflight-failed', error, {
        sourcePath: context.file.path,
        renderedLine: context.lineIndex + 1,
      });
      new Notice('Could not verify the selected task before creating its note.');
      return false;
    }
  }

  private isSupportedLine(line: string): boolean {
    return !!parseTaskLine(line) || LIST_LINE_RE.test(String(line || ''));
  }

  private resolveAssociatedNoteFile(path: string, sourceFile: TFile, directPath: boolean): TFile | null {
    const target = this.normalizeAssociationTarget(path);
    if (!target) return null;
    const direct = this.plugin.app.vault.getFileByPath(this.ensureMarkdownPath(target));
    if (directPath && direct instanceof TFile) return direct;
    const linkPath = target.replace(/\.md$/i, '');
    const linked = this.plugin.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFile.path);
    if (linked instanceof TFile) return linked;
    if (direct instanceof TFile) return direct;
    const requested = this.buildRequestedNotePath(target, sourceFile, directPath);
    const requestedFile = this.plugin.app.vault.getFileByPath(requested);
    return requestedFile instanceof TFile ? requestedFile : null;
  }

  private resolveUniqueMatchingChildNote(title: string, sourceFile: TFile): { file: TFile | null; matchCount: number } {
    const wantedTitle = this.normalizeTitleIdentity(title);
    if (!wantedTitle) return { file: null, matchCount: 0 };
    const matches = this.plugin.app.vault.getMarkdownFiles().filter((candidate) => {
      if (candidate.path === sourceFile.path) return false;
      if (this.plugin.filePropertiesService?.isCompanionFile(candidate)) return false;
      const frontmatter = (this.plugin.app.metadataCache.getFileCache(candidate)?.frontmatter || {}) as Record<string, unknown>;
      const titleKey = Object.keys(frontmatter).find((key) => key.trim().toLowerCase() === 'title');
      if (!titleKey || this.normalizeTitleIdentity(frontmatter[titleKey]) !== wantedTitle) return false;
      return this.plugin.parentLinkResolutionService.hasParent(candidate, sourceFile);
    });
    return {
      file: matches.length === 1 ? matches[0] : null,
      matchCount: matches.length,
    };
  }

  private normalizeTitleIdentity(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private buildRequestedNotePath(path: string, sourceFile: TFile, directPath: boolean): string {
    const target = this.normalizeAssociationTarget(path);
    if (!target) return '';
    const markdownPath = this.ensureMarkdownPath(target);
    if (directPath || target.includes('/')) return markdownPath;
    const folder = getDefaultSubitemFolderPath(this.plugin, sourceFile);
    return normalizePath(folder && folder !== '/' ? `${folder}/${markdownPath}` : markdownPath);
  }

  private normalizeAssociationTarget(path: string): string {
    const target = normalizeTaskAssociatedNotePath(path);
    return target ? normalizePath(target) : '';
  }

  private ensureMarkdownPath(path: string): string {
    const target = normalizePath(String(path || '').trim().replace(/^\/+/, ''));
    return target.toLowerCase().endsWith('.md') ? target : `${target}.md`;
  }

  private async openAssociatedNote(file: TFile): Promise<boolean> {
    return this.plugin.openFileInLeaf(
      file,
      false,
      () => this.plugin.app.workspace.getLeaf(false),
      { revealLeaf: true },
    );
  }

  private notifyChanged(file: TFile, reason: string): void {
    this.plugin.eventService.emitFilesUpdated([file.path]);
    this.plugin.overlayRenderingService?.invalidate({
      reason,
      file,
      surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
      rebuildInlineSubitems: true,
      refreshLivePreviewEditors: true,
      delayMs: 80,
    });
  }
}
