import { Component, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { reconcileTaskStatusLine } from '../utils/task-status-checkbox-reconcile';
import { getLinkedSubitemCompleteMarkers } from '../utils/linked-subitem-mapping';
import type { LinkedSubitemCheckboxMapping } from '../types';
import { scanMarkdownDocumentLines } from '../utils/markdown-document-lines';

const RECONCILE_DELAY_MS = 1200;
const EDITOR_QUIET_FALLBACK_MS = 1600;

export class TaskStatusCheckboxReconcileService extends Component {
  private readonly pendingFiles = new Map<string, TFile>();
  private flushTimer: number | null = null;
  private readonly filesBeingProcessed = new Set<string>();

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {
    super();
  }

  onload(): void {
    this.registerEvent(this.plugin.app.vault.on('modify', (file) => {
      if (file instanceof TFile) this.scheduleFile(file, 'vault-modify');
    }));

    this.registerEvent(this.plugin.app.workspace.on('editor-change', (_editor, info) => {
      const file = (info as { file?: unknown } | undefined)?.file;
      if (file instanceof TFile) this.scheduleFile(file, 'editor-change', RECONCILE_DELAY_MS);
    }));

    this.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => {
      this.scheduleActiveFile('active-leaf-change');
    }));

    this.plugin.app.workspace.onLayoutReady(() => {
      window.setTimeout(() => this.scheduleActiveFile('layout-ready'), 800);
    });
  }

  onunload(): void {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingFiles.clear();
    this.filesBeingProcessed.clear();
  }

  scheduleActiveFile(reason: string): void {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (activeFile instanceof TFile) this.scheduleFile(activeFile, reason);
  }

  scheduleFile(file: TFile, reason: string, delayMs = RECONCILE_DELAY_MS): void {
    if (!this.isEnabled()) return;
    if (!this.isMarkdownFile(file)) return;
    if (this.filesBeingProcessed.has(file.path)) return;
    this.pendingFiles.set(file.path, file);
    this.scheduleFlush(reason, delayMs);
  }

  async reconcileFileNow(file: TFile): Promise<number> {
    if (!this.isEnabled() || !this.isMarkdownFile(file)) return 0;
    if (this.filesBeingProcessed.has(file.path)) return 0;

    const statusKey = this.getStatusKey();
    const mappings = this.plugin.settings.linkedSubitemCheckboxMappings || [];
    if (!statusKey || mappings.length === 0) return 0;
    const completedAt = new Date();
    const completeMarkers = this.getCompleteMarkers(mappings);
    const normalizeStatus = (value: unknown): string => this.plugin.sharedServices.status.normalize(value);

    let changeCount = 0;
    this.filesBeingProcessed.add(file.path);
    try {
      await this.plugin.app.vault.process(file, (data) => {
        const newline = data.includes('\r\n') ? '\r\n' : data.includes('\r') ? '\r' : '\n';
        const endsWithNewline = /(?:\r\n|\n|\r)$/u.test(data);
        const documentLines = scanMarkdownDocumentLines(data);
        const lines = documentLines.map((line) => line.text);
        if (endsWithNewline) lines.pop();

        changeCount = 0;
        const nextLines = lines.map((line, index) => {
          if (documentLines[index]?.isContent !== true) return line;
          const result = reconcileTaskStatusLine(line, statusKey, mappings, {
            completedAt,
            completeMarkers,
            normalizeStatus,
          });
          if (result.changed) changeCount += 1;
          return result.line;
        });

        if (changeCount === 0) return data;
        return `${nextLines.join(newline)}${endsWithNewline ? newline : ''}`;
      });
    } finally {
      this.filesBeingProcessed.delete(file.path);
    }

    if (changeCount > 0) {
      this.plugin.app.workspace.updateOptions();
      this.plugin.overlayRenderingService?.invalidate?.({
        reason: 'task-status-checkbox-reconcile',
        file,
        surfaces: ['daily-nav', 'linked-subitems', 'live-preview-editors'],
        delayMs: 80,
      });
    }

    return changeCount;
  }

  private scheduleFlush(_reason: string, delayMs: number): void {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
    }
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flushPendingFiles();
    }, delayMs);
  }

  private async flushPendingFiles(): Promise<void> {
    if (!this.isEnabled()) {
      this.pendingFiles.clear();
      return;
    }

    if (!this.isEditorQuiet()) {
      this.scheduleFlush('editor-not-quiet', 400);
      return;
    }

    const files = Array.from(this.pendingFiles.values());
    this.pendingFiles.clear();
    for (const file of files) {
      await this.reconcileFileNow(file);
    }
  }

  private isEnabled(): boolean {
    return this.plugin.settings.reconcileTaskStatusToCheckbox !== false;
  }

  private isMarkdownFile(file: TFile): boolean {
    return file.extension?.toLowerCase() === 'md';
  }

  private isEditorQuiet(): boolean {
    const lastEditorChangeAt = Number((this.plugin as unknown as { lastEditorChangeAt?: number }).lastEditorChangeAt || 0);
    const quietWindowMs = Number((this.plugin as unknown as { typingQuietWindowMs?: number }).typingQuietWindowMs || EDITOR_QUIET_FALLBACK_MS);
    if (!lastEditorChangeAt) return true;
    const recentlyChanged = Date.now() - lastEditorChangeAt < quietWindowMs;
    if (!recentlyChanged) return true;

    const isEditorFocused = (this.plugin as unknown as { isEditorFocused?: () => boolean }).isEditorFocused;
    if (typeof isEditorFocused !== 'function') return false;
    return !isEditorFocused();
  }

  private getStatusKey(): string {
    return String(
      this.plugin.sharedServices?.status?.getStatusPropertyKey?.() || 'status',
    ).trim() || 'status';
  }

  private getCompleteMarkers(mappings: Array<{ checkboxState?: string; statuses?: string[] }>): string[] {
    return getLinkedSubitemCompleteMarkers(mappings as LinkedSubitemCheckboxMapping[], {
      completionStatuses: this.plugin.sharedServices.status.getDoneStatuses(),
      normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value),
    });
  }
}
