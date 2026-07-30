import { Component, MarkdownView, Platform, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';

const COLLAPSE_DELAY_MS = 700;
const COLLAPSE_RETRY_DELAY_MS = 1200;
const OPEN_PATH_REFRESH_DELAY_MS = 1500;

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

    this.scheduleCollapse(file);
  }

  private scheduleCollapse(file: TFile): void {
    if (this.pendingCollapseTimer !== null) {
      window.clearTimeout(this.pendingCollapseTimer);
    }

    this.pendingCollapseTimer = window.setTimeout(() => {
      this.pendingCollapseTimer = null;
      if (!this.collapseActiveMarkdownFile(file.path)) {
        this.pendingRetryTimer = window.setTimeout(() => {
          this.pendingRetryTimer = null;
          this.collapseActiveMarkdownFile(file.path);
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

    this.scheduleCollapse(file);
  }

  private collapseActiveMarkdownFile(path: string): boolean {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file?.path !== path) {
      return false;
    }

    const editor = view.editor;
    if (!editor) {
      logger.warn('[TPS GCM] Cannot collapse headings on open because no editor is available', { path });
      return false;
    }

    try {
      editor.focus();
      editor.exec('foldAll');
      logger.log('[TPS GCM] Requested heading collapse for newly opened note', { path });
      return true;
    } catch (error) {
      logger.warn('[TPS GCM] Heading collapse request failed', {
        path,
        error: logger.errorSummary(error),
      });
      return false;
    }
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
