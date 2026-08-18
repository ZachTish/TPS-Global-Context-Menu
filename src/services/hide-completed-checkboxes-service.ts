import type TPSGlobalContextMenuPlugin from '../main';
import { TFile } from 'obsidian';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
  getLinkedSubitemCompleteMarkers,
  normalizeLinkedSubitemCheckboxMarker,
} from '../utils/linked-subitem-mapping';
import { MIGRATED_TASK_CHECKBOX } from '../constants/task-migration';
import { isLivePreviewEditorRoot } from '../utils/markdown-editor-mode';

const BODY_CLASS = 'tps-gcm-hide-completed-checkboxes';
const READING_ONLY_BODY_CLASS = 'tps-gcm-hide-completed-checkboxes-reading-only';
const HIDDEN_LINE_CLASS = 'tps-gcm-hidden-completed-checkbox-line';
const REVEAL_WIDGET_CLASS = 'tps-gcm-completed-checkbox-reveal';
const REVEALED_ROOT_CLASS = 'tps-gcm-completed-checkboxes-revealed';
const EDITING_ROOT_CLASS = 'tps-gcm-completed-checkboxes-editing';
const HAS_REVEAL_WIDGET_CLASS = 'tps-gcm-completed-checkboxes-has-reveal';
const HIDE_ALL_TASK_LINES_BODY_CLASS = 'tps-gcm-hide-all-task-lines-reading-mode';
const TASK_HIDING_EXCLUDED_ROOT_CLASS = 'tps-gcm-task-hiding-excluded';
const MAPPED_COMPLETED_TASK_CLASS = 'tps-gcm-mapped-completed-task';
const TASK_LINE_STATE_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([^\]\r\n])\](?:\s|$)/u;
const EDITING_QUIET_WINDOW_MS = 1200;
type HiddenCompletedLine = { from: number; text: string };
type TaskVisibilityState = { showCompleted?: boolean; showTasks?: boolean };

export class HideCompletedCheckboxesService {
  private observer: MutationObserver | null = null;
  private rootObservers = new WeakMap<HTMLElement, MutationObserver>();
  private refreshTimer: number | null = null;
  private pendingRoots = new Set<HTMLElement>();
  private pendingRenderedRoots = new Set<HTMLElement>();
  private initializedRoots = new WeakSet<HTMLElement>();
  private revealedRoots = new WeakSet<HTMLElement>();
  private revealTimers = new WeakMap<HTMLElement, number>();
  private rootLastInputAt = new WeakMap<HTMLElement, number>();
  private editingClearTimers = new WeakMap<HTMLElement, number>();
  private editingClearTimerIds = new Set<number>();
  private discoverTimer: number | null = null;
  private lastEditorInputAt = 0;
  private readonly boundMarkEditorInput = (event: Event) => this.markEditorInput(event);
  private readonly boundEditorFocusOut = (event: Event) => this.handleEditorFocusOut(event);

  constructor(private plugin: TPSGlobalContextMenuPlugin) {}

  getEditorExtension(): Extension {
    const service = this;
    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = service.buildCompletedLineDecorations(view);
        }

        update(update: ViewUpdate): void {
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.selectionSet ||
            update.transactions.some((transaction) => transaction.reconfigured)
          ) {
            this.decorations = service.buildCompletedLineDecorations(update.view);
          }
        }
      },
      {
        decorations: (pluginValue) => pluginValue.decorations,
      },
    );
  }

  attach(): void {
    if (this.observer) return;
    document.addEventListener('keydown', this.boundMarkEditorInput, true);
    document.addEventListener('input', this.boundMarkEditorInput, true);
    document.addEventListener('focusout', this.boundEditorFocusOut, true);
    this.observer = new MutationObserver((mutations) => {
      if (this.mutationsAddedEditorRoot(mutations)) this.scheduleDiscoverLivePreviewRoots();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.discoverLivePreviewRoots();
    this.discoverRenderedRoots();
  }

  applyBodyClass(): void {
    document.body?.classList?.toggle(BODY_CLASS, this.plugin.settings.hideCompletedCheckboxes === true);
    document.body?.classList?.toggle(
      READING_ONLY_BODY_CLASS,
      this.plugin.settings.hideCompletedCheckboxes === true
        && this.plugin.settings.completedTaskHidingScope === 'reading-only',
    );
    document.body?.classList?.toggle(HIDE_ALL_TASK_LINES_BODY_CLASS, this.plugin.settings.hideAllTaskLinesInReadingMode === true);
    this.scheduleRefresh();
  }

  detach(): void {
    document.body?.classList?.remove(BODY_CLASS);
    document.body?.classList?.remove(READING_ONLY_BODY_CLASS);
    document.body?.classList?.remove(HIDE_ALL_TASK_LINES_BODY_CLASS);
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.discoverTimer !== null) {
      window.clearTimeout(this.discoverTimer);
      this.discoverTimer = null;
    }
    for (const timer of Array.from(this.editingClearTimerIds)) {
      window.clearTimeout(timer);
    }
    this.editingClearTimerIds.clear();
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener('keydown', this.boundMarkEditorInput, true);
    document.removeEventListener('input', this.boundMarkEditorInput, true);
    document.removeEventListener('focusout', this.boundEditorFocusOut, true);
    this.pendingRoots.clear();
    this.pendingRenderedRoots.clear();
    document.querySelectorAll<HTMLElement>(`.${HIDDEN_LINE_CLASS}`).forEach((line) => {
      line.classList.remove(HIDDEN_LINE_CLASS);
    });
    document.querySelectorAll<HTMLElement>(`.${REVEAL_WIDGET_CLASS}`).forEach((button) => button.remove());
    document.querySelectorAll<HTMLElement>(`.${REVEALED_ROOT_CLASS}`).forEach((root) => {
      root.classList.remove(REVEALED_ROOT_CLASS);
    });
    document.querySelectorAll<HTMLElement>(`.${EDITING_ROOT_CLASS}`).forEach((root) => {
      root.classList.remove(EDITING_ROOT_CLASS);
    });
    document.querySelectorAll<HTMLElement>(`.${TASK_HIDING_EXCLUDED_ROOT_CLASS}`).forEach((root) => {
      root.classList.remove(TASK_HIDING_EXCLUDED_ROOT_CLASS);
    });
    document.querySelectorAll<HTMLElement>(`.${MAPPED_COMPLETED_TASK_CLASS}`).forEach((task) => {
      task.classList.remove(MAPPED_COMPLETED_TASK_CLASS);
    });
  }

  refreshAllEditors(): void {
    this.discoverLivePreviewRoots();
    this.discoverRenderedRoots();
    this.scheduleRefresh();
    this.plugin.app.workspace.updateOptions();
  }

  shouldHideCompletedTasksInLivePreview(): boolean {
    return this.plugin.settings.hideCompletedCheckboxes === true
      && this.plugin.settings.completedTaskHidingScope !== 'reading-only';
  }

  isCompletedTaskSourceLine(source: unknown): boolean {
    return this.isCompletedTaskSourceLineWithMarkers(source, this.getCompleteTaskMarkers());
  }

  classifyRenderedTaskRows(container: ParentNode): number {
    const completeMarkers = this.getCompleteTaskMarkers();
    let completedCount = 0;
    container.querySelectorAll<HTMLElement>('li.task-list-item').forEach((task) => {
      const marker = normalizeLinkedSubitemCheckboxMarker(task.getAttribute('data-task'));
      const completed = marker != null && completeMarkers.has(marker);
      task.classList.toggle(MAPPED_COMPLETED_TASK_CLASS, completed);
      if (completed) completedCount += 1;
    });
    return completedCount;
  }

  revealCompletedForFile(filePath: string, lineNumber?: number): void {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) return;
    let revealed = false;
    for (const root of this.getMarkdownRootsForFile(normalizedPath)) {
      if (this.isRootTaskHidingExcluded(root)) {
        this.clearTaskHidingRoot(root);
        continue;
      }
      this.revealTemporarily(root);
      revealed = true;
    }
    if (revealed) {
      this.plugin.app.workspace.updateOptions();
      if (typeof lineNumber === 'number' && Number.isFinite(lineNumber)) {
        window.setTimeout(() => this.plugin.app.workspace.updateOptions(), 50);
      }
    }
  }

  private markEditorInput(event: Event): void {
    const target = event.target as HTMLElement | null;
    const root = target?.closest?.('.markdown-source-view.mod-cm6') as HTMLElement | null;
    if (!root) return;
    this.lastEditorInputAt = Date.now();
    this.markRootEditing(root);
    this.scheduleRefreshAfterQuiet(root);
  }

  private handleEditorFocusOut(event: Event): void {
    const target = event.target as HTMLElement | null;
    const root = target?.closest?.('.markdown-source-view.mod-cm6') as HTMLElement | null;
    if (!root) return;
    window.setTimeout(() => {
      this.clearRootEditing(root);
      this.scheduleRefresh(root);
    }, 120);
  }

  private scheduleDiscoverLivePreviewRoots(): void {
    if (this.discoverTimer !== null) return;
    const delay = Math.max(50, EDITING_QUIET_WINDOW_MS - (Date.now() - this.lastEditorInputAt));
    this.discoverTimer = window.setTimeout(() => {
      this.discoverTimer = null;
      this.discoverLivePreviewRoots();
      this.discoverRenderedRoots();
    }, delay);
  }

  private mutationsAddedEditorRoot(mutations: MutationRecord[]): boolean {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        const el = node instanceof HTMLElement ? node : null;
        if (!el) continue;
        if (el.matches('.markdown-source-view.mod-cm6')) return true;
        if (el.querySelector?.('.markdown-source-view.mod-cm6')) return true;
        if (el.matches('.markdown-preview-view, .markdown-rendered, .markdown-reading-view')) return true;
        if (el.querySelector?.('.markdown-preview-view, .markdown-rendered, .markdown-reading-view')) return true;
      }
    }
    return false;
  }

  private discoverLivePreviewRoots(): void {
    for (const root of Array.from(document.querySelectorAll<HTMLElement>('.markdown-source-view.mod-cm6'))) {
      this.observeRoot(root);
      this.scheduleRefresh(root);
    }
  }

  private discoverRenderedRoots(): void {
    for (const root of this.getRenderedRoots()) {
      this.observeRenderedRoot(root);
      this.scheduleRenderedRefresh(root);
    }
  }

  private observeRoot(root: HTMLElement): void {
    if (this.rootObservers.has(root)) return;
    const observer = new MutationObserver(() => {
      if (this.isRootRecentlyEdited(root)) {
        this.markRootEditing(root);
        this.scheduleRefreshAfterQuiet(root);
        return;
      }
      this.scheduleRefresh(root);
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
    });
    this.rootObservers.set(root, observer);
  }

  private observeRenderedRoot(root: HTMLElement): void {
    if (this.rootObservers.has(root)) return;
    const observer = new MutationObserver(() => {
      this.scheduleRenderedRefresh(root);
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-task'],
    });
    this.rootObservers.set(root, observer);
  }

  private scheduleRefresh(root?: HTMLElement): void {
    if (root) this.pendingRoots.add(root);
    if (this.refreshTimer !== null) return;

    const idleDelay = Math.max(50, EDITING_QUIET_WINDOW_MS - (Date.now() - this.lastEditorInputAt));
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (Date.now() - this.lastEditorInputAt < EDITING_QUIET_WINDOW_MS) {
        this.scheduleRefresh();
        return;
      }
      this.refreshLivePreviewEditors();
      this.refreshRenderedViews();
    }, idleDelay);
  }

  private scheduleRenderedRefresh(root?: HTMLElement): void {
    if (root) this.pendingRenderedRoots.add(root);
    this.scheduleRefresh();
  }

  private scheduleRefreshAfterQuiet(root: HTMLElement): void {
    const existing = this.editingClearTimers.get(root);
    if (existing !== undefined) {
      window.clearTimeout(existing);
      this.editingClearTimerIds.delete(existing);
    }
    const timer = window.setTimeout(() => {
      this.editingClearTimerIds.delete(timer);
      this.editingClearTimers.delete(root);
      this.clearRootEditing(root);
      this.scheduleRefresh(root);
    }, EDITING_QUIET_WINDOW_MS + 80);
    this.editingClearTimers.set(root, timer);
  }

  private refreshLivePreviewEditors(): void {
    const enabled = this.shouldHideCompletedTasksInLivePreview();
    if (!enabled) {
      this.pendingRoots.clear();
      document.querySelectorAll<HTMLElement>('.markdown-source-view.mod-cm6').forEach((root) => {
        this.clearLivePreviewRoot(root);
      });
      return;
    }

    const roots = this.pendingRoots.size > 0
      ? Array.from(this.pendingRoots)
      : Array.from(document.querySelectorAll<HTMLElement>('.markdown-source-view.mod-cm6'));
    this.pendingRoots.clear();

    for (const root of roots) {
      if (!root.isConnected) continue;
      if (!this.isLivePreviewRoot(root)) {
        this.clearLivePreviewRoot(root);
        continue;
      }
      if (this.isRootTaskHidingExcluded(root)) {
        this.clearTaskHidingRoot(root);
        continue;
      }
      root.classList.remove(TASK_HIDING_EXCLUDED_ROOT_CLASS);
      this.refreshLivePreviewRoot(root);
    }
  }

  private refreshLivePreviewRoot(root: HTMLElement): void {
    if (this.isRootRecentlyEdited(root)) {
      this.markRootEditing(root);
      this.scheduleRefreshAfterQuiet(root);
      return;
    }
    this.clearRootEditing(root);
    const lines = Array.from(root.querySelectorAll<HTMLElement>('.cm-line'));
    const completeMarkers = this.getCompleteTaskMarkers();
    const completedLines = lines.filter((line) => this.isCompletedTaskLine(line, completeMarkers));
    const hasCompletedTasks = completedLines.length > 0 || root.querySelector(
      '.tps-gcm-linked-context-panel--live-preview .tps-gcm-linked-context-card--terminal-task, '
      + '.tps-gcm-linked-context-panel--live-preview li.task-list-item.tps-gcm-mapped-completed-task',
    ) !== null;
    const revealed = this.getEffectiveRevealState(root, false);
    root.classList.toggle(REVEALED_ROOT_CLASS, revealed);

    this.syncRevealButton(root, hasCompletedTasks, revealed, false);
    this.initializedRoots.add(root);
  }

  private refreshRenderedViews(): void {
    const enabled =
      this.plugin.settings.hideCompletedCheckboxes === true ||
      this.plugin.settings.hideAllTaskLinesInReadingMode === true;
    const roots = this.pendingRenderedRoots.size > 0
      ? Array.from(this.pendingRenderedRoots)
      : this.getRenderedRoots();
    this.pendingRenderedRoots.clear();

    if (!enabled) {
      for (const root of roots) this.clearRenderedRoot(root);
      return;
    }

    for (const root of roots) {
      if (!root.isConnected) continue;
      this.refreshRenderedRoot(root);
    }
  }

  private refreshRenderedRoot(root: HTMLElement): void {
    if (this.isRootTaskHidingExcluded(root)) {
      this.clearTaskHidingRoot(root);
      return;
    }
    root.classList.remove(TASK_HIDING_EXCLUDED_ROOT_CLASS);
    const revealAllTasks = this.plugin.settings.hideAllTaskLinesInReadingMode === true;
    this.syncRenderedCompletedTasks(root);
    const hasRevealableTasks = revealAllTasks
      ? root.querySelector('li.task-list-item[data-task], li.task-list-item') !== null
      : root.querySelector(`li.task-list-item.${MAPPED_COMPLETED_TASK_CLASS}`) !== null;
    const revealed = this.getEffectiveRevealState(root, revealAllTasks);
    root.classList.toggle(REVEALED_ROOT_CLASS, revealed);
    this.syncRevealButton(root, hasRevealableTasks, revealed, revealAllTasks);
  }

  private clearLivePreviewRoot(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>(`.${HIDDEN_LINE_CLASS}`).forEach((line) => {
      line.classList.remove(HIDDEN_LINE_CLASS);
    });
    root.querySelectorAll<HTMLElement>(`.${REVEAL_WIDGET_CLASS}`).forEach((button) => button.remove());
    root.classList.remove(EDITING_ROOT_CLASS);
    root.classList.remove(REVEALED_ROOT_CLASS);
    root.classList.remove(HAS_REVEAL_WIDGET_CLASS);
    root.classList.remove(TASK_HIDING_EXCLUDED_ROOT_CLASS);
    this.initializedRoots.delete(root);
  }

  private clearRenderedRoot(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>(`.${REVEAL_WIDGET_CLASS}`).forEach((button) => button.remove());
    root.classList.remove(REVEALED_ROOT_CLASS);
    root.classList.remove(HAS_REVEAL_WIDGET_CLASS);
    root.classList.remove(TASK_HIDING_EXCLUDED_ROOT_CLASS);
    root.querySelectorAll<HTMLElement>(`.${MAPPED_COMPLETED_TASK_CLASS}`).forEach((task) => {
      task.classList.remove(MAPPED_COMPLETED_TASK_CLASS);
    });
  }

  private clearTaskHidingRoot(root: HTMLElement): void {
    if (root.matches('.markdown-source-view.mod-cm6')) {
      this.clearLivePreviewRoot(root);
    } else {
      this.clearRenderedRoot(root);
    }
    root.classList.add(TASK_HIDING_EXCLUDED_ROOT_CLASS);
  }

  private syncRevealButton(root: HTMLElement, hasRevealableTasks: boolean, revealed: boolean, revealAllTasks: boolean): void {
    const existing = root.querySelector<HTMLElement>(`.${REVEAL_WIDGET_CLASS}`);
    if (!hasRevealableTasks) {
      existing?.remove();
      root.classList.remove(HAS_REVEAL_WIDGET_CLASS);
      return;
    }
    root.classList.add(HAS_REVEAL_WIDGET_CLASS);

    const wrap = existing ?? document.createElement('div');
    wrap.className = `${REVEAL_WIDGET_CLASS} tps-gcm-hover-element`;
    wrap.dataset.tpsHoverElement = 'true';

    let button = wrap.querySelector('button');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      wrap.appendChild(button);
      let lastTouchToggleAt = 0;
      const suppressPress = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      const toggleReveal = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.type === 'click' && Date.now() - lastTouchToggleAt < 700) return;
        if (event.type === 'touchend') lastTouchToggleAt = Date.now();
        const revealed = this.getEffectiveRevealState(root, revealAllTasks);
        if (this.shouldPersistRevealState()) {
          void this.setPersistedRevealState(root, revealAllTasks, !revealed);
        } else if (revealed) {
          this.hideCompletedAgain(root);
        } else {
          this.revealTemporarily(root);
        }
      };
      button.addEventListener('mousedown', suppressPress);
      button.addEventListener('pointerdown', suppressPress);
      button.addEventListener('touchstart', suppressPress, { passive: false });
      button.addEventListener('click', toggleReveal);
      button.addEventListener('touchend', toggleReveal, { passive: false });
    }

    button.textContent = revealAllTasks
      ? (revealed ? 'Hide tasks' : 'Show tasks')
      : (revealed ? 'Hide completed' : 'Show completed');
    button.setAttribute(
      'aria-label',
      revealAllTasks
        ? (revealed ? 'Hide task lines again' : 'Show all task lines temporarily')
        : (revealed ? 'Hide completed checkbox lines again' : 'Show completed checkbox lines temporarily'),
    );

    const mount = this.getRevealButtonMount(root);
    if (this.isRootRecentlyEdited(root) && wrap.parentElement === mount) return;
    if (wrap.parentElement !== mount) mount.prepend(wrap);
  }

  private revealTemporarily(root: HTMLElement): void {
    this.revealedRoots.add(root);
    root.classList.add(REVEALED_ROOT_CLASS);
    const existing = this.revealTimers.get(root);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.revealedRoots.delete(root);
      this.revealTimers.delete(root);
      this.scheduleRefresh();
    }, 120000);
    this.revealTimers.set(root, timer);
    this.scheduleRefresh();
  }

  private hideCompletedAgain(root: HTMLElement): void {
    this.revealedRoots.delete(root);
    root.classList.remove(REVEALED_ROOT_CLASS);
    const existing = this.revealTimers.get(root);
    if (existing !== undefined) window.clearTimeout(existing);
    this.revealTimers.delete(root);
    this.scheduleRefresh();
  }

  private shouldPersistRevealState(): boolean {
    return this.plugin.settings.persistTaskVisibilityStateToFrontmatter === true;
  }

  private getTaskVisibilityFrontmatterKey(): string {
    return String(this.plugin.settings.taskVisibilityStateFrontmatterKey || 'gcmTaskVisibility').trim() || 'gcmTaskVisibility';
  }

  private getEffectiveRevealState(root: HTMLElement, revealAllTasks: boolean): boolean {
    if (this.shouldPersistRevealState()) {
      const state = this.getPersistedRevealState(root);
      const persisted = revealAllTasks ? state?.showTasks : state?.showCompleted;
      if (typeof persisted === 'boolean') return persisted;
    }
    return this.revealedRoots.has(root);
  }

  private getPersistedRevealState(root: HTMLElement): TaskVisibilityState | null {
    const file = this.getFileForRoot(root);
    if (!(file instanceof TFile)) return null;
    const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    const raw = frontmatter?.[this.getTaskVisibilityFrontmatterKey()];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const state = raw as Record<string, unknown>;
    return {
      showCompleted: typeof state.showCompleted === 'boolean' ? state.showCompleted : undefined,
      showTasks: typeof state.showTasks === 'boolean' ? state.showTasks : undefined,
    };
  }

  private async setPersistedRevealState(root: HTMLElement, revealAllTasks: boolean, revealed: boolean): Promise<void> {
    const file = this.getFileForRoot(root);
    if (!(file instanceof TFile)) {
      if (revealed) this.revealTemporarily(root);
      else this.hideCompletedAgain(root);
      return;
    }

    if (revealed) this.revealedRoots.add(root);
    else this.revealedRoots.delete(root);
    const existing = this.revealTimers.get(root);
    if (existing !== undefined) window.clearTimeout(existing);
    this.revealTimers.delete(root);
    root.classList.toggle(REVEALED_ROOT_CLASS, revealed);
    this.scheduleRefresh(root);

    const key = this.getTaskVisibilityFrontmatterKey();
    await this.plugin.frontmatterMutationService.process(file, (frontmatter) => {
      const current = frontmatter[key];
      const next: Record<string, boolean> = current && typeof current === 'object' && !Array.isArray(current)
        ? { ...(current as Record<string, boolean>) }
        : {};
      next[revealAllTasks ? 'showTasks' : 'showCompleted'] = revealed;
      frontmatter[key] = next;
    });
    this.scheduleRefresh(root);
  }

  private isRootActivelyBeingEdited(root: HTMLElement): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    if (!root.contains(active)) return false;
    return !!active.closest('.cm-editor, .markdown-source-view.mod-cm6, .canvas-node-content');
  }

  private isRootRecentlyEdited(root: HTMLElement): boolean {
    const last = this.rootLastInputAt.get(root) || 0;
    return last > 0 && Date.now() - last < EDITING_QUIET_WINDOW_MS;
  }

  private markRootEditing(root: HTMLElement): void {
    this.rootLastInputAt.set(root, Date.now());
    root.classList.add(EDITING_ROOT_CLASS);
  }

  private clearRootEditing(root: HTMLElement): void {
    if (this.isRootActivelyBeingEdited(root) && this.isRootRecentlyEdited(root)) return;
    root.classList.remove(EDITING_ROOT_CLASS);
  }

  private getCompleteTaskMarkers(): Set<string> {
    const markers = new Set(getLinkedSubitemCompleteMarkers(
      this.plugin.settings.linkedSubitemCheckboxMappings || [],
      {
        completionStatuses: ['complete', 'wont-do'],
        normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value),
      },
    ));
    const migratedMarker = MIGRATED_TASK_CHECKBOX.slice(1, -1);
    if (migratedMarker) markers.add(migratedMarker);
    return markers;
  }

  private isCompletedTaskSourceLineWithMarkers(source: unknown, completeMarkers: ReadonlySet<string>): boolean {
    const marker = normalizeLinkedSubitemCheckboxMarker(
      String(source ?? '').match(TASK_LINE_STATE_RE)?.[1],
    );
    return marker != null && completeMarkers.has(marker);
  }

  private isCompletedTaskLine(line: HTMLElement, completeMarkers: ReadonlySet<string>): boolean {
    if (this.isCompletedTaskSourceLineWithMarkers(line.textContent, completeMarkers)) return true;
    const task = line.matches('[data-task]') ? line : line.querySelector<HTMLElement>('[data-task]');
    const marker = normalizeLinkedSubitemCheckboxMarker(task?.getAttribute('data-task'));
    return marker != null && completeMarkers.has(marker);
  }

  private syncRenderedCompletedTasks(root: HTMLElement): void {
    this.classifyRenderedTaskRows(root);
  }

  private getMarkdownRootsForFile(filePath: string): HTMLElement[] {
    const roots: HTMLElement[] = [];
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as any;
      const file = view?.file;
      if (!(file && file.path === filePath)) continue;
      const container = view.containerEl as HTMLElement | undefined;
      if (!container) continue;
      const root =
        container.querySelector<HTMLElement>('.markdown-source-view.mod-cm6')
        ?? container.querySelector<HTMLElement>('.markdown-preview-view')
        ?? container.querySelector<HTMLElement>('.markdown-rendered')
        ?? container.querySelector<HTMLElement>('.markdown-reading-view');
      if (root) roots.push(root);
    }
    return roots;
  }

  private getFileForRoot(root: HTMLElement): TFile | null {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as any;
      const file = view?.file;
      const container = view?.containerEl as HTMLElement | undefined;
      if (file instanceof TFile && container?.contains(root)) return file;
    }
    return null;
  }

  private getRenderedRoots(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.markdown-preview-view, .markdown-rendered, .markdown-reading-view')).filter((root) => {
      if (root.closest('.markdown-source-view.mod-cm6')) return false;
      return root.parentElement?.closest('.markdown-preview-view, .markdown-rendered, .markdown-reading-view') === null;
    });
  }

  private getRevealButtonMount(root: HTMLElement): HTMLElement {
    if (root.matches('.markdown-preview-view, .markdown-rendered, .markdown-reading-view')) {
      return root.querySelector<HTMLElement>('.markdown-preview-sizer') ?? root;
    }
    return root;
  }

  private isLivePreviewRoot(root: HTMLElement): boolean {
    return isLivePreviewEditorRoot(root);
  }

  private isRootTaskHidingExcluded(root: HTMLElement): boolean {
    const file = this.getFileForRoot(root);
    if (!(file instanceof TFile)) return false;
    return this.isTaskHidingExcludedFile(file);
  }

  private isTaskHidingExcludedFile(file: TFile): boolean {
    const patterns = this.getTaskHidingExclusionPatterns();
    if (!patterns.length) return false;
    const normalizedPath = this.normalizeTaskHidingExclusionValue(file.path);
    const normalizedBasename = this.normalizeTaskHidingExclusionValue(file.basename);
    const tags = this.getTaskHidingFileTags(file);
    const cssclasses = this.getTaskHidingFileCssClasses(file);
    return patterns.some((pattern) =>
      this.matchesTaskHidingExclusionPattern(normalizedPath, normalizedBasename, tags, cssclasses, pattern),
    );
  }

  private matchesTaskHidingExclusionPattern(
    normalizedPath: string,
    normalizedBasename: string,
    tags: Set<string>,
    cssclasses: Set<string>,
    rawPattern: string,
  ): boolean {
    const pattern = String(rawPattern || '').trim();
    if (!pattern) return false;
    const asLower = pattern.toLowerCase();
    if (asLower.startsWith('tag:')) {
      const tag = this.normalizeTaskHidingTagPattern(pattern.slice(4));
      return tag ? tags.has(tag) : false;
    }
    if (asLower.startsWith('#')) {
      const tag = this.normalizeTaskHidingTagPattern(pattern);
      return tag ? tags.has(tag) : false;
    }
    if (asLower.startsWith('cssclass:')) {
      const cssclass = this.normalizeTaskHidingExclusionValue(pattern.slice(9));
      return cssclass ? cssclasses.has(cssclass) : false;
    }
    if (asLower.startsWith('class:')) {
      const cssclass = this.normalizeTaskHidingExclusionValue(pattern.slice(6));
      return cssclass ? cssclasses.has(cssclass) : false;
    }
    return this.plugin.matchesAutoFrontmatterExclusionPattern(normalizedPath, normalizedBasename, pattern);
  }

  private getTaskHidingFileTags(file: TFile): Set<string> {
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const tags = new Set<string>();
    for (const tag of cache?.tags ?? []) {
      this.addTaskHidingTag(tags, tag?.tag);
    }
    const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
    this.addTaskHidingTag(tags, frontmatter?.tags);
    this.addTaskHidingTag(tags, frontmatter?.tag);
    return tags;
  }

  private addTaskHidingTag(tags: Set<string>, raw: unknown): void {
    if (Array.isArray(raw)) {
      for (const item of raw) this.addTaskHidingTag(tags, item);
      return;
    }
    if (typeof raw !== 'string') return;
    for (const token of raw.split(/[\s,]+/)) {
      const normalized = this.normalizeTaskHidingTagPattern(token);
      if (normalized) tags.add(normalized);
    }
  }

  private normalizeTaskHidingTagPattern(value: string): string {
    return String(value || '')
      .trim()
      .replace(/^#+/, '')
      .replace(/,+$/, '')
      .toLowerCase();
  }

  private getTaskHidingFileCssClasses(file: TFile): Set<string> {
    const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    const cssclasses = new Set<string>();
    this.addTaskHidingCssClass(cssclasses, frontmatter?.cssclass);
    this.addTaskHidingCssClass(cssclasses, frontmatter?.cssclasses);
    return cssclasses;
  }

  private addTaskHidingCssClass(cssclasses: Set<string>, raw: unknown): void {
    if (Array.isArray(raw)) {
      for (const item of raw) this.addTaskHidingCssClass(cssclasses, item);
      return;
    }
    if (typeof raw !== 'string') return;
    for (const token of raw.split(/[\s,]+/)) {
      const normalized = this.normalizeTaskHidingExclusionValue(token);
      if (normalized) cssclasses.add(normalized);
    }
  }

  private getTaskHidingExclusionPatterns(): string[] {
    const raw = String(this.plugin.settings.taskHidingExclusionPatterns || '');
    if (!raw.trim()) return [];
    return raw
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private normalizeTaskHidingExclusionValue(value: string): string {
    return String(value || '')
      .trim()
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }

  private buildCompletedLineDecorations(view: EditorView): DecorationSet {
    if (!this.shouldHideCompletedTasksInLivePreview()) return Decoration.none;
    const root = view.dom.closest('.markdown-source-view.mod-cm6') as HTMLElement | null;
    if (root && this.isRootTaskHidingExcluded(root)) return Decoration.none;
    if (root && !this.isLivePreviewRoot(root)) return Decoration.none;

    const builder = new RangeSetBuilder<Decoration>();
    for (const line of this.getHiddenCompletedLines(view)) {
      builder.add(line.from, line.from, Decoration.line({ class: HIDDEN_LINE_CLASS }));
    }
    return builder.finish();
  }

  private getHiddenCompletedLines(view: EditorView): HiddenCompletedLine[] {
    const doc = view.state.doc;
    const hidden: HiddenCompletedLine[] = [];
    const seen = new Set<number>();
    const completeMarkers = this.getCompleteTaskMarkers();
    for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
      const line = doc.line(lineNumber);
      if (!this.isCompletedTaskSourceLineWithMarkers(line.text, completeMarkers)) continue;
      this.collectCompletedTaskBlockLines(view, lineNumber, seen, hidden);
    }
    return hidden;
  }

  private collectCompletedTaskBlockLines(
    view: EditorView,
    startLineNumber: number,
    seen: Set<number>,
    hidden: HiddenCompletedLine[],
  ): void {
    const doc = view.state.doc;
    const startLine = doc.line(startLineNumber);
    const baseIndent = this.getIndentWidth(startLine.text);
    this.addHiddenLine(startLine, seen, hidden);

    for (let lineNumber = startLineNumber + 1; lineNumber <= doc.lines; lineNumber += 1) {
      const line = doc.line(lineNumber);
      if (!line.text.trim()) {
        const next = this.findNextNonBlankDocLine(view, lineNumber + 1);
        if (!next || this.getIndentWidth(next.text) <= baseIndent) break;
        this.addHiddenLine(line, seen, hidden);
        continue;
      }

      if (this.getIndentWidth(line.text) <= baseIndent) break;
      this.addHiddenLine(line, seen, hidden);
    }
  }

  private addHiddenLine(line: HiddenCompletedLine, seen: Set<number>, hidden: HiddenCompletedLine[]): void {
    if (seen.has(line.from)) return;
    seen.add(line.from);
    hidden.push(line);
  }

  private findNextNonBlankDocLine(view: EditorView, startLineNumber: number): HiddenCompletedLine | null {
    const doc = view.state.doc;
    for (let lineNumber = startLineNumber; lineNumber <= doc.lines; lineNumber += 1) {
      const line = doc.line(lineNumber);
      if (line.text.trim()) return line;
    }
    return null;
  }

  private getIndentWidth(text: string): number {
    let width = 0;
    for (const ch of String(text || '').match(/^[ \t]*/)?.[0] ?? '') {
      width += ch === '\t' ? 4 : 1;
    }
    return width;
  }
}
