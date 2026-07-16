import { Component, MarkdownView, TFile, WorkspaceLeaf, debounce } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { parseDailyNoteFileDate } from '../utils/daily-note-task-schedule';
import { TPS_HOME_VIEW_TYPE } from '../views/home-view';
import * as logger from '../logger';

export class DailyNoteHomeService extends Component {
  private readonly applyingLeaves = new WeakSet<WorkspaceLeaf>();
  private livePreviewOverride: { leaf: WorkspaceLeaf; path: string } | null = null;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {
    super();
  }

  onload(): void {
    const schedule = debounce(() => void this.convertReadingDailyNotes(), 60, false);
    this.registerEvent(this.plugin.app.workspace.on('active-leaf-change', (leaf) => {
      if (this.livePreviewOverride && leaf !== this.livePreviewOverride.leaf) {
        this.livePreviewOverride = null;
      }
      schedule();
    }));
    this.registerEvent(this.plugin.app.workspace.on('file-open', schedule));
    this.registerEvent(this.plugin.app.workspace.on('layout-change', schedule));
    this.registerInterval(window.setInterval(schedule, 600));
    this.plugin.app.workspace.onLayoutReady(schedule);
  }

  allowLivePreview(leaf: WorkspaceLeaf, path: string): void {
    this.livePreviewOverride = { leaf, path };
  }

  isLivePreviewOverride(leaf: WorkspaceLeaf): boolean {
    const override = this.livePreviewOverride;
    if (!override || override.leaf !== leaf) return false;
    const view = leaf.view;
    const state = leaf.getViewState();
    return view instanceof MarkdownView
      && view.file?.path === override.path
      && state.state?.mode === 'source'
      && state.state?.source !== true;
  }

  private async convertReadingDailyNotes(): Promise<void> {
    const candidates: Array<{ leaf: WorkspaceLeaf; file: TFile; dateIso: string }> = [];
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (this.applyingLeaves.has(leaf)) return;
      if (!(leaf.view instanceof MarkdownView) || leaf.view.getViewType() !== 'markdown') return;
      const file = leaf.view.file;
      if (!(file instanceof TFile)) return;
      const state = leaf.getViewState();
      if (state.state?.mode !== 'preview') return;
      const dateIso = parseDailyNoteFileDate(this.plugin.app, this.plugin.settings, file);
      if (!dateIso) return;
      candidates.push({ leaf, file, dateIso });
    });

    for (const candidate of candidates) {
      await this.convertLeaf(candidate.leaf, candidate.file, candidate.dateIso);
    }
  }

  private async convertLeaf(leaf: WorkspaceLeaf, file: TFile, dateIso: string): Promise<void> {
    if (this.applyingLeaves.has(leaf)) return;
    this.applyingLeaves.add(leaf);
    if (this.livePreviewOverride?.leaf === leaf) this.livePreviewOverride = null;
    try {
      const current = leaf.getViewState();
      await leaf.setViewState({
        type: TPS_HOME_VIEW_TYPE,
        active: leaf === this.plugin.app.workspace.activeLeaf,
        pinned: current.pinned,
        state: {
          dailyNotePath: file.path,
          dateIso,
        },
      });
      logger.flow('DailyNoteHome', 'reading:render-home', {
        path: file.path,
        dateIso,
      });
    } catch (error) {
      logger.flowError('DailyNoteHome', 'reading:render-home-failed', error, {
        path: file.path,
        dateIso,
      });
    } finally {
      this.applyingLeaves.delete(leaf);
    }
  }
}
