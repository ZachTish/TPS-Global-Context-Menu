import { Component, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';

export type OverlayRenderSurface =
  | 'menus'
  | 'daily-nav'
  | 'inline-task-controls'
  | 'linked-subitems'
  | 'live-preview-editors';

export interface OverlayInvalidationRequest {
  reason: string;
  file?: TFile | null;
  files?: Array<TFile | null | undefined>;
  surfaces?: OverlayRenderSurface[];
  force?: boolean;
  rebuildInlineSubitems?: boolean;
  refreshLivePreviewEditors?: boolean;
  ensureMenus?: boolean;
  delayMs?: number;
}

type PendingFileRefresh = {
  file: TFile;
  force: boolean;
  rebuildInlineSubitems: boolean;
};

/**
 * Coalesces page-attached TPS UI refreshes into a single batched render pass.
 *
 * This first implementation intentionally keeps the existing renderers in place.
 * The service owns scheduling and lifecycle fanout so workspace/vault events do
 * not independently trigger each overlay feature.
 */
export class OverlayRenderingService extends Component {
  private ensureMenusRequested = false;
  private dailyNavRequested = false;
  private inlineTaskControlsRequested = false;
  private linkedSubitemsRequested = false;
  private livePreviewEditorsRequested = false;
  private pendingFiles = new Map<string, PendingFileRefresh>();
  private flushTimer: number | null = null;
  private flushInProgress = false;
  private nextDelayMs = 0;

  constructor(private plugin: TPSGlobalContextMenuPlugin) {
    super();
  }

  onunload(): void {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.resetPending();
  }

  invalidate(request: OverlayInvalidationRequest): void {
    const surfaces = new Set<OverlayRenderSurface>(request.surfaces || ['menus']);
    const files = this.collectFiles(request);

    if (surfaces.has('menus') && (request.ensureMenus === true || files.length === 0)) {
      this.ensureMenusRequested = true;
    }
    if (surfaces.has('daily-nav')) {
      this.dailyNavRequested = true;
    }
    if (surfaces.has('inline-task-controls')) {
      this.inlineTaskControlsRequested = true;
    }
    if (surfaces.has('linked-subitems')) {
      this.linkedSubitemsRequested = true;
    }
    if (surfaces.has('live-preview-editors')) {
      this.livePreviewEditorsRequested = true;
    }
    if (request.refreshLivePreviewEditors === true) {
      this.livePreviewEditorsRequested = true;
    }

    if (surfaces.has('menus') && files.length > 0) {
      for (const file of files) {
        const existing = this.pendingFiles.get(file.path);
        this.pendingFiles.set(file.path, {
          file,
          force: (existing?.force ?? false) || request.force === true,
          rebuildInlineSubitems:
            (existing?.rebuildInlineSubitems ?? false) || request.rebuildInlineSubitems === true,
        });
      }
    }

    logger.perf?.('overlay-rendering:invalidate', {
      reason: request.reason,
      surfaces: Array.from(surfaces),
      files: files.map((file) => file.path),
    });

    this.scheduleFlush(request.delayMs);
  }

  scheduleMenus(reason: string, delayMs = 120): void {
    this.invalidate({ reason, surfaces: ['menus'], delayMs });
  }

  scheduleFileRefresh(
    file: TFile | null | undefined,
    reason: string,
    options: { force?: boolean; rebuildInlineSubitems?: boolean; ensureMenus?: boolean; delayMs?: number } = {},
  ): void {
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    this.invalidate({
      reason,
      file,
      surfaces: ['menus'],
      ensureMenus: options.ensureMenus,
      force: options.force,
      rebuildInlineSubitems: options.rebuildInlineSubitems,
      delayMs: options.delayMs,
    });
  }

  scheduleSubitemRefresh(
    file: TFile | null | undefined,
    reason: string,
    options: { refreshLivePreviewEditors?: boolean; delayMs?: number } = {},
  ): void {
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    this.invalidate({
      reason,
      file,
      surfaces: ['inline-task-controls', 'linked-subitems'],
      refreshLivePreviewEditors: options.refreshLivePreviewEditors ?? true,
      delayMs: options.delayMs,
    });
  }

  scheduleDailyNavRefresh(reason: string, delayMs = 60): void {
    this.invalidate({ reason, surfaces: ['daily-nav'], delayMs });
  }

  flushNow(reason = 'manual'): void {
    logger.perf?.('overlay-rendering:flushNow', { reason });
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  private collectFiles(request: OverlayInvalidationRequest): TFile[] {
    const files: TFile[] = [];
    if (request.file instanceof TFile && request.file.extension === 'md') {
      files.push(request.file);
    }
    for (const file of request.files || []) {
      if (file instanceof TFile && file.extension === 'md') files.push(file);
    }

    const byPath = new Map<string, TFile>();
    for (const file of files) byPath.set(file.path, file);
    return Array.from(byPath.values());
  }

  private scheduleFlush(delayMs: number | undefined): void {
    const delay = Math.max(0, delayMs ?? 120);
    if (this.flushTimer !== null) {
      if (delay >= this.nextDelayMs) return;
      this.nextDelayMs = delay;
      window.clearTimeout(this.flushTimer);
    } else {
      this.nextDelayMs = delay;
    }

    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      this.nextDelayMs = 0;
      this.flush();
    }, delay);
  }

  private flush(): void {
    if (this.flushInProgress) {
      this.scheduleFlush(50);
      return;
    }
    const flushStartedAt = performance.now();

    const ensureMenus = this.ensureMenusRequested;
    const dailyNav = this.dailyNavRequested;
    const inlineTaskControls = this.inlineTaskControlsRequested;
    const linkedSubitems = this.linkedSubitemsRequested;
    const livePreviewEditors = this.livePreviewEditorsRequested;
    const fileRefreshes = Array.from(this.pendingFiles.values());

    this.resetPending();
    this.flushInProgress = true;

    try {
      this.taskTrace('flush:start', {
        ensureMenus,
        dailyNav,
        inlineTaskControls,
        linkedSubitems,
        livePreviewEditors,
        fileRefreshes: fileRefreshes.length,
        sampleFiles: fileRefreshes.slice(0, 5).map((refresh) => refresh.file.path),
      });
      this.runStep('menus:ensure', ensureMenus, () => {
        this.plugin.persistentMenuManager?.ensureMenus?.();
      });

      for (const refresh of fileRefreshes) {
        this.runStep(`menus:file:${refresh.file.path}`, true, () => {
          this.plugin.persistentMenuManager?.refreshMenusForFile?.(
            refresh.file,
            refresh.force,
            { rebuildInlineSubitems: refresh.rebuildInlineSubitems },
          );
        });
      }

      this.runStep('linked-subitems', linkedSubitems, () => {
        this.plugin.linkedSubitemCheckboxService?.ensureForAllMarkdownViews?.();
      });

      this.runStep('live-preview-editors', livePreviewEditors, () => {
        this.plugin.linkedSubitemCheckboxService?.refreshLivePreviewEditors?.();
      });

      this.runStep('daily-nav', dailyNav, () => {
        this.plugin.dailyNoteNavManager?.refresh?.();
      });
    } finally {
      this.flushInProgress = false;
      this.taskTrace('flush:end', {
        durationMs: Math.round(performance.now() - flushStartedAt),
        hadPendingWorkAfterFlush: this.hasPendingWork(),
      });
      if (this.hasPendingWork()) {
        this.scheduleFlush(50);
      }
    }
  }

  private runStep(label: string, shouldRun: boolean, render: () => void): void {
    if (!shouldRun) return;
    const startedAt = performance.now();
    try {
      render();
      this.taskTrace('step:end', {
        label,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      this.taskTrace('step:error', {
        label,
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      });
      logger.error(`[TPS GCM] Overlay rendering step failed: ${label}`, error);
    }
  }

  private taskTrace(message: string, details?: Record<string, unknown>): void {
    if ((window as any).__TPS_TASKTRACE !== true) return;
    console.log(`[TPS TASKTRACE] [GCM Overlay] ${message}`, {
      t: Math.round(performance.now()),
      ...(details || {}),
    });
  }

  private resetPending(): void {
    this.ensureMenusRequested = false;
    this.dailyNavRequested = false;
    this.inlineTaskControlsRequested = false;
    this.linkedSubitemsRequested = false;
    this.livePreviewEditorsRequested = false;
    this.pendingFiles.clear();
  }

  private hasPendingWork(): boolean {
    return (
      this.ensureMenusRequested ||
      this.dailyNavRequested ||
      this.inlineTaskControlsRequested ||
      this.linkedSubitemsRequested ||
      this.livePreviewEditorsRequested ||
      this.pendingFiles.size > 0
    );
  }
}
