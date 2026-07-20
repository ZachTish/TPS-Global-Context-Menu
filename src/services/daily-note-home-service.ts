import { Component, MarkdownView, Platform, TFile, WorkspaceLeaf, debounce } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { parseDailyNoteFileDate } from '../utils/daily-note-task-schedule';
import {
  collectNotebookNavigatorSelectionPaths,
  isNotebookNavigatorSelectionGesture,
  NotebookNavigatorHomeIntentTracker,
  type NotebookNavigatorMultiSelectModifier,
} from '../utils/notebook-navigator-home-intent';
import { TPS_HOME_VIEW_TYPE } from '../views/home-view';
import * as logger from '../logger';

type NotebookNavigatorFileInteraction = { file: TFile; scopeRoot: HTMLElement };

export class DailyNoteHomeService extends Component {
  private readonly applyingLeaves = new WeakSet<WorkspaceLeaf>();
  private readonly notebookNavigatorHomeIntent = new NotebookNavigatorHomeIntentTracker<WorkspaceLeaf>();
  private notebookNavigatorInteractionGeneration = 0;
  private livePreviewOverride: { leaf: WorkspaceLeaf; path: string } | null = null;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {
    super();
  }

  onload(): void {
    const schedule = debounce(() => void this.convertReadingDailyNotes(), 60, false);
    this.registerDomEvent(document, 'click', (event) => {
      this.handleNotebookNavigatorClick(event, schedule);
    }, true);
    this.registerDomEvent(document, 'dragstart', (event) => {
      this.handleNotebookNavigatorDragStart(event, schedule);
    }, true);
    this.register(() => {
      this.notebookNavigatorInteractionGeneration += 1;
      this.notebookNavigatorHomeIntent.clear();
    });
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

  private handleNotebookNavigatorClick(event: MouseEvent, schedule: () => void): void {
    if (event.button !== 0) return;
    if (Platform.isMacOS && event.ctrlKey && !event.metaKey) return;
    const target = this.resolveNotebookNavigatorFileInteraction(event.target);
    if (!target) return;

    const generation = ++this.notebookNavigatorInteractionGeneration;
    const configuredModifier = this.getNotebookNavigatorMultiSelectModifier();
    const isSelectionGesture = isNotebookNavigatorSelectionGesture(
      event,
      configuredModifier,
      Platform.isMacOS,
      Platform.isMobile,
    );

    if (!isSelectionGesture) {
      this.notebookNavigatorHomeIntent.markPlainOpen(target.file.path);
      logger.flow('DailyNoteHome', 'notebook-navigator:plain-open', {
        path: target.file.path,
      });
      schedule();
      return;
    }

    this.notebookNavigatorHomeIntent.markSelection([target.file.path]);
    this.scheduleNotebookNavigatorSelectionReconciliation(
      target,
      generation,
      'notebook-navigator:selection-only',
      schedule,
    );
    schedule();
  }

  private handleNotebookNavigatorDragStart(event: DragEvent, schedule: () => void): void {
    const target = this.resolveNotebookNavigatorFileInteraction(event.target);
    if (!target) return;

    const generation = ++this.notebookNavigatorInteractionGeneration;
    this.notebookNavigatorHomeIntent.markSelection([target.file.path]);
    this.scheduleNotebookNavigatorSelectionReconciliation(
      target,
      generation,
      'notebook-navigator:drag-selection',
      schedule,
    );
    schedule();
  }

  private scheduleNotebookNavigatorSelectionReconciliation(
    target: NotebookNavigatorFileInteraction,
    generation: number,
    eventName: string,
    schedule: () => void,
  ): void {
    window.setTimeout(() => {
      if (generation !== this.notebookNavigatorInteractionGeneration) return;
      const selectedFiles = this.plugin.contextTargetService.getSelectedFiles(target.scopeRoot);
      const paths = new Set(selectedFiles.map((file) => file.path));
      paths.add(target.file.path);
      for (const path of this.getNotebookNavigatorCurrentSelectionPaths()) paths.add(path);
      this.notebookNavigatorHomeIntent.markSelection(paths);
      logger.flow('DailyNoteHome', eventName, {
        path: target.file.path,
        selectedCount: paths.size,
      });
      schedule();
    }, 0);
  }

  private resolveNotebookNavigatorFileInteraction(
    eventTarget: EventTarget | null,
  ): NotebookNavigatorFileInteraction | null {
    const target = eventTarget instanceof HTMLElement
      ? eventTarget
      : eventTarget instanceof Element
        ? eventTarget.parentElement
        : null;
    if (!target) return null;
    if (target.closest('.nn-quick-action-item, .nn-parent-folder-content[data-reveal="true"]')) return null;
    if (!this.plugin.contextTargetService.isNotebookNavigatorFileContextTarget(target)) return null;
    const file = this.plugin.contextTargetService.resolveNotebookNavigatorFileTarget(target);
    if (!(file instanceof TFile)) return null;
    const scopeRoot = target.closest<HTMLElement>(
      '.workspace-leaf-content[data-type="notebook-navigator"], .view-content.notebook-navigator',
    );
    return scopeRoot ? { file, scopeRoot } : null;
  }

  private getNotebookNavigatorMultiSelectModifier(): NotebookNavigatorMultiSelectModifier {
    const notebookNavigator = this.getNotebookNavigatorPlugin();
    const raw = notebookNavigator?.settings?.multiSelectModifier
      ?? notebookNavigator?.instance?.settings?.multiSelectModifier
      ?? notebookNavigator?.plugin?.settings?.multiSelectModifier;
    return String(raw || '').trim().toLowerCase() === 'optionalt' ? 'optionAlt' : 'cmdCtrl';
  }

  private getNotebookNavigatorCurrentSelectionPaths(): string[] {
    const notebookNavigator = this.getNotebookNavigatorPlugin();
    const selectionApi = notebookNavigator?.api?.selection
      ?? notebookNavigator?.instance?.api?.selection
      ?? notebookNavigator?.plugin?.api?.selection;
    const getCurrent = selectionApi?.getCurrent;
    if (typeof getCurrent !== 'function') return [];
    let currentSelection: unknown;
    try {
      currentSelection = getCurrent.call(selectionApi);
    } catch {
      return [];
    }
    return collectNotebookNavigatorSelectionPaths(currentSelection, (rawPath) => {
      const file = this.plugin.app.vault.getAbstractFileByPath(rawPath);
      return file instanceof TFile ? file.path : null;
    });
  }

  private getNotebookNavigatorPlugin(): any {
    const plugins = (this.plugin.app as any)?.plugins;
    return plugins?.getPlugin?.('notebook-navigator')
      ?? plugins?.plugins?.['notebook-navigator'];
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
    const openLeaves = new Set<WorkspaceLeaf>();
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      openLeaves.add(leaf);
      if (this.applyingLeaves.has(leaf)) return;
      if (!(leaf.view instanceof MarkdownView) || leaf.view.getViewType() !== 'markdown') {
        this.notebookNavigatorHomeIntent.reconcileLeaf(leaf, null);
        return;
      }
      const file = leaf.view.file;
      if (!(file instanceof TFile)) {
        this.notebookNavigatorHomeIntent.reconcileLeaf(leaf, null);
        return;
      }
      this.notebookNavigatorHomeIntent.reconcileLeaf(leaf, file.path);
      const state = leaf.getViewState();
      if (state.state?.mode !== 'preview') return;
      const dateIso = parseDailyNoteFileDate(this.plugin.app, this.plugin.settings, file);
      if (!dateIso) return;
      candidates.push({ leaf, file, dateIso });
    });
    this.notebookNavigatorHomeIntent.retainLeaves(openLeaves);
    candidates.sort((left, right) =>
      Number(right.leaf === this.plugin.app.workspace.activeLeaf)
      - Number(left.leaf === this.plugin.app.workspace.activeLeaf));

    for (const candidate of candidates) {
      if (this.notebookNavigatorHomeIntent.shouldSuppress(candidate.leaf, candidate.file.path)) continue;
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
