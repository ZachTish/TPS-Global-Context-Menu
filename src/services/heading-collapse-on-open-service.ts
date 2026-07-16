import { Component, MarkdownView, Platform, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';

const COLLAPSE_DELAY_MS = 700;
const COLLAPSE_RETRY_DELAY_MS = 1200;
const OPEN_PATH_REFRESH_DELAY_MS = 1500;

type ObsidianCommandApi = {
  commands?: {
    commands?: Record<string, { id?: string; name?: string }>;
    executeCommandById?: (id: string) => boolean | void;
  };
};

export class HeadingCollapseOnOpenService extends Component {
  private knownOpenPaths = new Set<string>();
  private pendingCollapseTimer: number | null = null;
  private pendingRetryTimer: number | null = null;
  private pendingRefreshTimer: number | null = null;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {
    super();
  }

  onload(): void {
    this.refreshKnownOpenPaths();
    this.registerEvent(this.plugin.app.workspace.on('file-open', (file) => {
      this.handleFileOpen(file);
    }));
    this.registerEvent(this.plugin.app.workspace.on('layout-change', () => {
      this.scheduleKnownOpenPathsRefresh(OPEN_PATH_REFRESH_DELAY_MS);
    }));
    this.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => {
      this.handleActiveLeafChange();
      this.scheduleKnownOpenPathsRefresh(OPEN_PATH_REFRESH_DELAY_MS);
    }));
  }

  onunload(): void {
    if (this.pendingCollapseTimer !== null) {
      window.clearTimeout(this.pendingCollapseTimer);
      this.pendingCollapseTimer = null;
    }
    if (this.pendingRetryTimer !== null) {
      window.clearTimeout(this.pendingRetryTimer);
      this.pendingRetryTimer = null;
    }
    if (this.pendingRefreshTimer !== null) {
      window.clearTimeout(this.pendingRefreshTimer);
      this.pendingRefreshTimer = null;
    }
  }

  private handleFileOpen(file: TFile | null): void {
    if (!(file instanceof TFile) || file.extension !== 'md') {
      this.scheduleKnownOpenPathsRefresh();
      return;
    }

    const wasAlreadyOpen = this.knownOpenPaths.has(file.path);
    this.scheduleKnownOpenPathsRefresh();

    if (Platform.isMobile || this.plugin.settings.collapseHeadingsOnOpen !== true || wasAlreadyOpen) {
      return;
    }

    this.scheduleCollapse(file.path);
  }

  private scheduleCollapse(path: string): void {
    if (this.pendingCollapseTimer !== null) {
      window.clearTimeout(this.pendingCollapseTimer);
    }

    this.pendingCollapseTimer = window.setTimeout(() => {
      this.pendingCollapseTimer = null;
      if (!this.collapseActiveMarkdownFile(path)) {
        this.pendingRetryTimer = window.setTimeout(() => {
          this.pendingRetryTimer = null;
          this.collapseActiveMarkdownFile(path);
        }, COLLAPSE_RETRY_DELAY_MS);
      }
    }, COLLAPSE_DELAY_MS);
  }

  private handleActiveLeafChange(): void {
    if (Platform.isMobile || this.plugin.settings.collapseHeadingsOnOpen !== true) {
      return;
    }

    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!(file instanceof TFile) || file.extension !== 'md' || this.knownOpenPaths.has(file.path)) {
      return;
    }

    this.scheduleCollapse(file.path);
  }

  private collapseActiveMarkdownFile(path: string): boolean {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file?.path !== path) {
      return false;
    }

    view.editor?.focus();

    if (this.executeFoldAllCommand(path)) {
      return true;
    }

    if (view.editor && this.collapseMarkdownHeadings(view)) {
      logger.log('[TPS GCM] Collapsed headings for newly opened note via heading fold fallback', { path });
      return true;
    }

    logger.warn('[TPS GCM] Cannot collapse headings on open because no fold API is available');
    return false;
  }

  private collapseMarkdownHeadings(view: MarkdownView): boolean {
    const editor = view.editor;
    if (!editor) {
      return false;
    }

    const headingLines: number[] = [];
    for (let line = 0; line < editor.lineCount(); line += 1) {
      if (/^#{1,6}\s+\S/.test(editor.getLine(line))) {
        headingLines.push(line);
      }
    }

    if (!headingLines.length) {
      return false;
    }

    const cursor = editor.getCursor();
    const scroll = editor.getScrollInfo();

    editor.focus();
    editor.exec('unfoldAll');
    for (const line of headingLines.reverse()) {
      editor.setCursor({ line, ch: 0 });
      editor.exec('toggleFold');
    }
    editor.setCursor(cursor);
    editor.scrollTo(scroll.left, scroll.top);

    return true;
  }

  private executeFoldAllCommand(path: string): boolean {
    const commandApi = this.plugin.app as unknown as ObsidianCommandApi;
    const commands = commandApi.commands;
    const executeCommandById = commands?.executeCommandById;
    if (typeof executeCommandById !== 'function') {
      return false;
    }

    const commandId = this.resolveFoldAllCommandId(commands);
    if (!commandId) {
      return false;
    }

    const didExecute = executeCommandById.call(commands, commandId);
    if (didExecute === false) {
      logger.warn('[TPS GCM] Obsidian fold-all command was unavailable', { path, commandId });
      return false;
    }

    logger.log('[TPS GCM] Collapsed headings for newly opened note', { path, commandId });
    return true;
  }

  private resolveFoldAllCommandId(commands: NonNullable<ObsidianCommandApi['commands']>): string | null {
    if (!commands.commands) {
      return null;
    }

    const exactMatch = commands.commands['editor:fold-all'];
    if (exactMatch) {
      return exactMatch.id ?? 'editor:fold-all';
    }

    for (const command of Object.values(commands.commands)) {
      const name = String(command.name ?? '').toLowerCase();
      if (name.includes('fold all')) {
        return command.id ?? null;
      }
    }

    return null;
  }

  private scheduleKnownOpenPathsRefresh(delayMs = 0): void {
    if (this.pendingRefreshTimer !== null) {
      window.clearTimeout(this.pendingRefreshTimer);
    }
    this.pendingRefreshTimer = window.setTimeout(() => {
      this.pendingRefreshTimer = null;
      this.refreshKnownOpenPaths();
    }, delayMs);
  }

  private refreshKnownOpenPaths(): void {
    const paths = new Set<string>();
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path) {
        paths.add(view.file.path);
      }
    });
    this.knownOpenPaths = paths;
  }
}
