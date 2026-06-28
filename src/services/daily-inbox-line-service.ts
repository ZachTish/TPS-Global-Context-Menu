import { Editor, Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { FileSuggestModal } from '../modals/FileSuggestModal';
import { getTaskDisplayTitle, parseTaskLine, setTaskTitle, updateTaskLineTimestamps } from '../utils/task-line-metadata';

type LineContext = {
  file: TFile;
  lineIndex: number;
  rawLine: string;
};

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
    this.promptLinkTaskLine({ file, lineIndex, rawLine }, (nextLine) => {
      editor.replaceRange(this.withModifiedTimestamp(nextLine), { line: lineIndex, ch: 0 }, { line: lineIndex, ch: rawLine.length });
      this.notifyChanged(file, 'daily-inbox-link-editor-task-line');
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
    this.promptLinkTaskLine(context, (nextLine) => {
      void this.updateLineInFile(context, () => nextLine, 'Linked task to note.');
    });
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

  private promptLinkTaskLine(context: LineContext, apply: (nextLine: string) => void): void {
    new FileSuggestModal(this.plugin.app, (targetFile) => {
      const title = this.getLineTitle(context.rawLine);
      if (!title) {
        new Notice('Could not resolve task title.');
        return;
      }
      const nextLine = setTaskTitle(context.rawLine, this.makeWikiLink(targetFile, title));
      apply(nextLine);
      new Notice(`Linked task to ${targetFile.basename}.`);
    }, { extensions: ['md'] }).open();
  }

  private async updateLineInFile(context: LineContext, transform: (line: string) => string, notice: string): Promise<void> {
    let changed = false;
    await this.plugin.app.vault.process(context.file, (content) => {
      const newline = content.includes('\r\n') ? '\r\n' : '\n';
      const endsWithNewline = /\r?\n$/.test(content);
      const lines = content.split(/\r?\n/);
      if (endsWithNewline) lines.pop();
      const lineIndex = this.resolveLineIndex(lines, context);
      if (lineIndex < 0) return content;
      const currentLine = lines[lineIndex] || '';
      const nextLine = this.withModifiedTimestamp(transform(currentLine));
      if (nextLine === currentLine) return content;
      lines[lineIndex] = nextLine;
      context.lineIndex = lineIndex;
      context.rawLine = nextLine;
      changed = true;
      return `${lines.join(newline)}${endsWithNewline ? newline : ''}`;
    });
    if (!changed) {
      new Notice('Could not update the selected line.');
      return;
    }
    this.notifyChanged(context.file, 'daily-inbox-update-line');
    new Notice(notice);
  }

  private resolveLineIndex(lines: string[], context: LineContext): number {
    if (lines[context.lineIndex] === context.rawLine) return context.lineIndex;
    const title = this.getLineTitle(context.rawLine).toLowerCase();
    if (!title) return -1;
    return lines.findIndex((line) => this.getLineTitle(line).toLowerCase() === title);
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
      modifiedKey: this.plugin.settings.dateModifiedFrontmatterKey,
      format: this.plugin.settings.fileTimestampFormat,
      markModified: true,
    });
  }

  private getLineTitle(line: string): string {
    const taskTitle = getTaskDisplayTitle(line);
    if (taskTitle) return this.stripExistingStrike(taskTitle);
    const listMatch = String(line || '').match(LIST_LINE_RE);
    const body = listMatch ? String(listMatch[2] || '') : String(line || '');
    return this.stripExistingStrike(body)
      .replace(/\[[^\]\n]+::[^\]\n]*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
