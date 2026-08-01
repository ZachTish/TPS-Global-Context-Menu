import { Component, FuzzySuggestModal, ItemView, MarkdownRenderer, MarkdownView, Menu, Modal, Notice, Platform, TFile, WorkspaceLeaf, normalizePath, parseYaml, setIcon } from 'obsidian';
import { RangeSetBuilder, StateEffect, Transaction, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type TPSGlobalContextMenuPlugin from '../main';
import type { HomeActionContext, HomeBaseComponent, HomeBuiltInComponentId, HomeCommandComponent, HomeComponentAction, HomeComponentId, HomeComponentLayout } from '../types';
import type { TimeTrackingSession } from '../services/time-tracking-service';
import { applyHomeDateContext } from './home-context';
import { parseDailyNoteFileDate } from '../utils/daily-note-task-schedule';
import {
  createHomeCaptureRangeSnapshot,
  prepareHomeCaptureDraft,
  replaceHomeCaptureRangeIfUnchanged,
  resolveHomeCaptureDraftRange,
  resolveHomeCaptureLineRange,
  type HomeCaptureRangeSnapshot,
} from '../services/home-capture-block';
import * as logger from '../logger';
import { withBaseEmbedRenderContext } from './base-embed-context';
import { DEFAULT_SETTINGS, HOME_DAILY_NOTE_FEED_BASE_CONTENT, HOME_DAILY_NOTE_FEED_BASE_PATH } from '../constants';
import { normalizeHomeComponentActions } from '../services/home-component-action-core';
import { addHomeBaseContextFilter, resolveHomeBaseDefinitionSourcePath } from './home-base-context';
import { FileSuggestModal } from '../modals/FileSuggestModal';
import { SerializedLatestSettingWriter } from '../services/serialized-latest-setting-writer';
import {
  preserveTpsInlinePropsMetadata,
  stripTaskInlinePropsMetadata,
} from '../utils/task-line-metadata';

export const TPS_HOME_VIEW_TYPE = 'tps-home';

const getMoment = (): any => (window as any).moment;
const HOME_COMPONENTS: Array<{ id: HomeBuiltInComponentId; title: string; icon: string; countLabel?: string }> = [
  { id: 'calendar', title: 'Calendar', icon: 'calendar-days' },
  { id: 'food-tracker', title: 'Food tracker', icon: 'utensils' },
  { id: 'workout-tracker', title: 'Activity log', icon: 'activity' },
  { id: 'open-unscheduled-tasks', title: 'Open unscheduled tasks', icon: 'list-checks', countLabel: 'tasks' },
];
const HOME_PANEL_MIN_HEIGHT = 220;
const HOME_PANEL_MAX_HEIGHT = 1200;
const HOME_CAPTURE_PREVIEW_MIN_HEIGHT = 120;
const HOME_CAPTURE_PREVIEW_MAX_HEIGHT = 900;
const HOME_CAPTURE_HIDDEN_LINE_CLASS = 'tps-home-capture-hidden-source-line';

type HomeBuiltInBasePathSettingKey =
  | 'homeCalendarBasePath'
  | 'homeFoodBasePath'
  | 'homeWorkoutBasePath'
  | 'homeOpenTasksBasePath';

type HomeCaptureTrigger = {
  id: string;
  label: string;
  matches: (value: string) => boolean;
  clean: (value: string) => string;
};

const HOME_CAPTURE_TRIGGERS: HomeCaptureTrigger[] = [
  {
    id: 'food-describe',
    label: '#food',
    matches: (value) => /(^|\s)#food(?=\s|$)/i.test(value),
    clean: (value) => value.replace(/(^|\s)#food(?=\s|$)/ig, '$1').replace(/[ \t]{2,}/g, ' ').trim(),
  },
];

function createHomeCaptureIsolationExtension(
  getCaptureRange: () => { from: number; to: number },
  onDocumentChange: (update: ViewUpdate) => void,
): Extension {
  const buildDecorations = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;
    const captureRange = getCaptureRange();
    const safeFrom = Math.max(0, Math.min(captureRange.from, doc.length));
    const safeTo = Math.max(safeFrom, Math.min(captureRange.to, doc.length));
    const captureStartLine = doc.lineAt(safeFrom).number - 1;
    const captureEndLine = doc.lineAt(safeTo > safeFrom ? safeTo - 1 : safeTo).number - 1;
    for (let oneBasedLine = 1; oneBasedLine <= doc.lines; oneBasedLine += 1) {
      const zeroBasedLine = oneBasedLine - 1;
      const hidden = zeroBasedLine < captureStartLine || zeroBasedLine > captureEndLine;
      if (!hidden) continue;
      const line = doc.line(oneBasedLine);
      builder.add(line.from, line.from, Decoration.line({ class: HOME_CAPTURE_HIDDEN_LINE_CLASS }));
    }
    return builder.finish();
  };

  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view);
        }

        update(update: ViewUpdate): void {
          if (update.docChanged) onDocumentChange(update);
          if (update.docChanged || update.transactions.some((transaction) => transaction.reconfigured)) {
            this.decorations = buildDecorations(update.view);
          }
        }
      },
      { decorations: (pluginValue) => pluginValue.decorations },
    ),
  ];
}

interface HomeCaptureDraftTarget {
  path: string;
  line: number;
  value: string;
}

interface HomeCaptureEditorSession {
  id: number;
  generation: number;
  view: MarkdownView;
  file: TFile;
  cm: EditorView;
  editTarget: { path: string; line: number } | null;
  originalEditLine: string | null;
  snapshot: HomeCaptureRangeSnapshot;
  allowedValues: Set<string>;
  rangeFrom: number;
  rangeTo: number;
  accepting: boolean;
  settled: boolean;
  conflict: boolean;
  conflictNotified: boolean;
  conflictRecoveryScheduled: boolean;
  internalChange: boolean;
  operationPromise: Promise<'saved' | 'conflict' | 'stale'> | null;
}

class HomeCaptureRevisionConflictError extends Error {
  constructor() {
    super('The Daily Note changed outside Quick Capture.');
    this.name = 'HomeCaptureRevisionConflictError';
  }
}

interface TPSHealthApiLike {
  ensureFoodLogBase?: () => Promise<string>;
  ensureActivityLogBase?: () => Promise<string>;
  ensureWorkoutLogBase?: () => Promise<string>;
  getActiveWorkout?: () => HomeActiveWorkoutState | null;
  getActiveWorkoutPath?: () => string;
}

interface TPSHealthPluginLike {
  api?: TPSHealthApiLike;
  settings?: {
    workoutsFolder?: string;
  };
  openFoodLogger?: (dateContext?: HomeFoodLogDateContext | null) => void;
  openActivityLogger?: (dateContext?: HomeFoodLogDateContext | null) => void;
  openFoodDescriber?: (description: string, dateContext?: HomeFoodLogDateContext | null) => Promise<void>;
  openWorkoutStarter?: (dateContext?: HomeFoodLogDateContext | null) => void;
}

interface HomeFoodLogDateContext {
  dateIso: string;
  label: string;
  isToday: boolean;
  foodLogTarget?: 'daily-note' | 'single-file';
  focusAfterLog?: boolean;
}

interface HomeActiveWorkoutState {
  path?: string;
  dailyNotePath?: string;
  title?: string;
  startedAt?: string;
}

type HomeActiveTimerTarget =
  | { kind: 'time-tracking'; session: TimeTrackingSession; title: string; startedAt: string }
  | { kind: 'workout'; session?: TimeTrackingSession; path: string; title: string; startedAt: string };

export class TpsHomeView extends ItemView {
  private rootEl: HTMLElement | null = null;
  private editMode = false;
  private embedComponents: Component[] = [];
  private selectedDate: any | null = null;
  private dailyNotePath: string | null = null;
  private unresolvedDailyNotePath: string | null = null;
  private lastHomeModalOutsideTouchY: number | null = null;
  private homeActiveTimerButton: HTMLButtonElement | null = null;
  private homeAddComponentButton: HTMLButtonElement | null = null;
  private homeActiveTimerTarget: HomeActiveTimerTarget | null = null;
  private homeActiveTimerUpdateInFlight = false;
  private homePanelCleanups: Array<() => void> = [];
  private homeCaptureMarkdownView: MarkdownView | null = null;
  private homeCaptureSkipSaveViews = new WeakSet<MarkdownView>();
  private homeCaptureDraftTarget: HomeCaptureDraftTarget | null = null;
  private homeCaptureEditTarget: { path: string; line: number } | null = null;
  private homeCaptureEditorSession: HomeCaptureEditorSession | null = null;
  private homeCaptureSessionId = 0;
  private homeRenderPromise: Promise<void> | null = null;
  private homeRenderRequested = false;
  private homeRenderGeneration = 0;
  private homeInitialRenderTimer: number | null = null;
  private homeClosing = false;
  private readonly homeBaseSettingWriter = new SerializedLatestSettingWriter<
    HomeBuiltInBasePathSettingKey,
    string
  >();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: TPSGlobalContextMenuPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return TPS_HOME_VIEW_TYPE;
  }

  getDisplayText(): string {
    const file = this.getBackedDailyNoteFile();
    return file?.basename || 'TPS Home';
  }

  getIcon(): string {
    return 'layout-dashboard';
  }

  getState(): Record<string, unknown> {
    const statePath = this.dailyNotePath ?? this.unresolvedDailyNotePath;
    return statePath
      ? { dailyNotePath: statePath, dateIso: this.getSelectedDate().format('YYYY-MM-DD') }
      : {};
  }

  async setState(state: Record<string, unknown>): Promise<void> {
    const previousPath = this.dailyNotePath ?? this.unresolvedDailyNotePath;
    const previousDateIso = this.selectedDate?.format?.('YYYY-MM-DD') || '';
    const requestedPath = String(state?.dailyNotePath || '').trim();
    const file = requestedPath ? this.plugin.app.vault.getAbstractFileByPath(requestedPath) : null;
    const dateIso = file instanceof TFile
      ? parseDailyNoteFileDate(this.plugin.app, this.plugin.settings, file)
      : String(state?.dateIso || '').trim();
    this.dailyNotePath = file instanceof TFile ? file.path : null;
    this.unresolvedDailyNotePath = file instanceof TFile ? null : requestedPath || null;
    this.selectedDate = dateIso
      ? getMoment()(dateIso, 'YYYY-MM-DD', true).startOf('day')
      : null;
    (this.leaf as any).updateHeader?.();
    this.plugin.app.workspace.requestSaveLayout();
    if (!this.rootEl) return;

    const coalescedInitialRender = this.cancelInitialHomeRender('state');
    const nextDateIso = this.selectedDate?.format?.('YYYY-MM-DD') || '';
    const nextPath = this.dailyNotePath ?? this.unresolvedDailyNotePath;
    const stateChanged = previousPath !== nextPath || previousDateIso !== nextDateIso;
    if (!coalescedInitialRender && !stateChanged && this.rootEl.hasChildNodes()) {
      logger.flow('HomeView', 'state:render-skipped', {
        path: this.dailyNotePath,
        dateIso: nextDateIso,
        reason: 'unchanged',
      });
      return;
    }

    logger.flow('HomeView', 'state:render', {
      path: this.dailyNotePath,
      dateIso: nextDateIso,
      reason: coalescedInitialRender ? 'initial-state' : stateChanged ? 'state-changed' : 'empty-root',
    });
    await this.render();
  }

  isDailyNoteBacked(): boolean {
    return this.dailyNotePath !== null;
  }

  async onOpen(): Promise<void> {
    this.homeClosing = false;
    this.contentEl.empty();
    this.contentEl.addClass('tps-home-view');
    this.contentEl.tabIndex = 0;
    this.registerHomeInnerScrollHandlers();
    this.registerDomEvent(window, 'click', (event: MouseEvent) => {
      const button = this.homeAddComponentButton;
      if (!this.editMode || !button?.isConnected) return;
      const target = event.target instanceof Node ? event.target : null;
      const rect = button.getBoundingClientRect();
      const hitsButton = !!target && button.contains(target);
      const hitsButtonBounds = event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!hitsButton && !hitsButtonBounds) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      this.showAddComponentMenu(button, event.clientX, event.clientY);
    }, { capture: true });
    this.registerInterval(window.setInterval(() => {
      void this.refreshHomeActiveTimerButton();
    }, 1000));
    this.rootEl = this.contentEl.createDiv({ cls: 'tps-home-root' });
    this.scheduleInitialHomeRender();
  }

  async onClose(): Promise<void> {
    this.homeClosing = true;
    this.cancelInitialHomeRender('close');
    this.homeRenderRequested = false;
    if (this.homeRenderPromise) {
      try {
        await this.homeRenderPromise;
      } catch (error) {
        logger.flowError('HomeView', 'close:pending-render-failed', error);
      }
    }
    await this.prepareHomeCaptureForTeardown('close');
    this.homeRenderGeneration += 1;
    await this.unloadEmbeds();
    this.homeActiveTimerButton = null;
    this.homeAddComponentButton = null;
    this.homeActiveTimerTarget = null;
    this.rootEl = null;
  }

  private scheduleInitialHomeRender(): void {
    if (this.homeInitialRenderTimer !== null) return;
    logger.flow('HomeView', 'initial-render:scheduled', {
      path: this.dailyNotePath,
      dateIso: this.selectedDate?.format?.('YYYY-MM-DD') || '',
    });
    this.homeInitialRenderTimer = window.setTimeout(() => {
      this.homeInitialRenderTimer = null;
      if (!this.rootEl || this.homeClosing) {
        logger.flow('HomeView', 'initial-render:skipped', { reason: 'view-closed' });
        return;
      }
      logger.flow('HomeView', 'initial-render:run', {
        path: this.dailyNotePath,
        dateIso: this.selectedDate?.format?.('YYYY-MM-DD') || '',
      });
      void this.render().catch((error) => {
        logger.flowError('HomeView', 'initial-render:failed', error, {
          path: this.dailyNotePath,
          dateIso: this.selectedDate?.format?.('YYYY-MM-DD') || '',
        });
      });
    }, 0);
  }

  private cancelInitialHomeRender(reason: 'state' | 'close'): boolean {
    if (this.homeInitialRenderTimer === null) return false;
    window.clearTimeout(this.homeInitialRenderTimer);
    this.homeInitialRenderTimer = null;
    logger.flow('HomeView', 'initial-render:coalesced', {
      path: this.dailyNotePath,
      dateIso: this.selectedDate?.format?.('YYYY-MM-DD') || '',
      into: reason,
    });
    return true;
  }

  private getSelectedDate(): any {
    const source = this.selectedDate ?? getMoment()();
    return source.clone ? source.clone().startOf('day') : getMoment()(source).startOf('day');
  }

  private async setSelectedDate(date: any): Promise<void> {
    this.homeCaptureDraftTarget = null;
    this.homeCaptureEditTarget = null;
    const next = (date?.clone ? date.clone() : getMoment()(date)).startOf('day');
    if (!this.isDailyNoteBacked()) {
      this.selectedDate = next;
      await this.render();
      return;
    }
    await this.navigateToDailyNoteHome(next);
  }

  private async shiftSelectedDate(days: number): Promise<void> {
    await this.setSelectedDate(this.getSelectedDate().add(days, 'day'));
  }

  private applyHomeContext(element: HTMLElement, date: any): void {
    applyHomeDateContext(element, date, getMoment());
  }

  async render(): Promise<void> {
    if (!this.rootEl || this.homeClosing) return;
    this.homeRenderRequested = true;
    if (this.homeRenderPromise) return this.homeRenderPromise;

    const pending = this.runHomeRenderLoop();
    this.homeRenderPromise = pending;
    try {
      await pending;
    } finally {
      if (this.homeRenderPromise === pending) this.homeRenderPromise = null;
    }
  }

  private async runHomeRenderLoop(): Promise<void> {
    while (this.homeRenderRequested && this.rootEl && !this.homeClosing) {
      this.homeRenderRequested = false;
      await this.prepareHomeCaptureForTeardown('render');
      const generation = ++this.homeRenderGeneration;
      await this.renderHomeOnce(generation);
    }
  }

  private async renderHomeOnce(generation: number): Promise<void> {
    if (!this.isHomeRenderCurrent(generation)) return;

    const today = this.getSelectedDate();
    logger.flow('HomeView', 'render:start', {
      generation,
      path: this.dailyNotePath,
      dateIso: today.format('YYYY-MM-DD'),
    });
    await this.unloadEmbeds();
    if (!this.isHomeRenderCurrent(generation)) return;
    this.rootEl.empty();
    this.homeAddComponentButton = null;
    this.applyHomeContext(this.rootEl, today);
    this.rootEl.classList.toggle('tps-home-root--editing', this.editMode);
    const header = this.rootEl.createDiv({ cls: 'tps-home-header' });
    const title = header.createDiv({ cls: 'tps-home-title' });
    title.createEl('span', { text: 'Home' });
    title.createEl('small', { text: today.format('ddd, MMM D') });

    const actions = header.createDiv({ cls: 'tps-home-actions' });
    actions.setAttr('aria-label', 'Home date navigation');
    this.createIconButton(actions, 'chevron-left', 'Previous Home day', () => void this.shiftSelectedDate(-1));
    const todayButton = actions.createEl('button', {
      cls: 'tps-home-calendar-today-button',
      attr: {
        type: 'button',
        title: 'Show today on Home',
        'aria-pressed': String(this.isSelectedHomeDateToday(today)),
      },
      text: 'Today',
    });
    todayButton.classList.toggle('is-selected-date-today', this.isSelectedHomeDateToday(today));
    todayButton.addEventListener('click', () => void this.setSelectedDate(getMoment()()));
    this.createIconButton(actions, 'chevron-right', 'Next Home day', () => void this.shiftSelectedDate(1));
    this.createIconButton(actions, 'refresh-cw', 'Refresh Home', () => void this.render());
    this.homeActiveTimerButton = this.createIconButton(actions, 'timer', 'Open running time-tracked note', () => void this.openHomeActiveTimerTarget());
    this.homeActiveTimerButton.addClass('tps-home-active-timer-button');
    this.homeActiveTimerButton.style.display = 'none';
    void this.refreshHomeActiveTimerButton();
    this.createIconButton(
      actions,
      this.editMode ? 'check' : 'pencil',
      this.editMode ? 'Done editing Home' : 'Edit Home layout',
      () => {
        this.editMode = !this.editMode;
        void this.render();
      },
    );
    if (this.editMode) {
      const addButton = this.createIconButton(actions, 'plus', 'Add Home component', (event) => {
        this.showAddComponentMenu(addButton, event.clientX, event.clientY);
      });
      addButton.addClass('tps-home-add-component-button');
      addButton.createSpan({ text: 'Add component' });
      this.homeAddComponentButton = addButton;
    }
    this.createIconButton(
      actions,
      this.isDailyNoteBacked() ? 'file-pen-line' : 'calendar-days',
      this.isDailyNoteBacked() ? 'Edit this Daily Note in Live Preview' : 'Open selected day capture note',
      () => void this.openSelectedDailyNoteForEditing(today),
    );

    const grid = this.rootEl.createDiv({ cls: 'tps-home-grid' });
    for (const component of this.getHomeComponents()) {
      const componentId = this.getHomeComponentKey(component);
      if (componentId === 'quick-capture') {
        await this.renderQuickCapture(grid, today, component, generation);
      } else if (componentId === 'calendar') {
        await this.renderCalendar(grid, component, today);
      } else if (componentId === 'food-tracker') {
        await this.renderFoodBase(grid, component, today);
      } else if (componentId === 'workout-tracker') {
        await this.renderWorkoutBase(grid, component, today);
      } else if (componentId === 'open-unscheduled-tasks') {
        await this.renderOpenTasksBase(grid, component, today);
      } else if (this.isHomeBaseComponent(component)) {
        await this.renderCustomBase(grid, component, today);
      } else if (this.isHomeCommandComponent(component)) {
        this.renderCommandPanel(grid, component);
      }
      if (!this.isHomeRenderCurrent(generation)) return;
    }
    logger.flow('HomeView', 'render:done', {
      generation,
      path: this.dailyNotePath,
      dateIso: today.format('YYYY-MM-DD'),
    });
  }

  private isHomeRenderCurrent(generation: number): boolean {
    return !this.homeClosing && this.rootEl !== null && generation === this.homeRenderGeneration;
  }

  private getBackedDailyNoteFile(): TFile | null {
    if (!this.dailyNotePath) return null;
    const file = this.plugin.app.vault.getAbstractFileByPath(this.dailyNotePath);
    return file instanceof TFile ? file : null;
  }

  private async navigateToDailyNoteHome(date: any): Promise<void> {
    try {
      const dailyNote = await this.plugin.homeCaptureService.getDailyNoteForCapture(date);
      logger.flow('DailyNoteHome', 'navigate', {
        from: this.dailyNotePath,
        to: dailyNote.path,
        dateIso: date.format('YYYY-MM-DD'),
      });
      await this.leaf.setViewState({
        type: TPS_HOME_VIEW_TYPE,
        active: true,
        pinned: this.leaf.getViewState().pinned,
        state: {
          dailyNotePath: dailyNote.path,
          dateIso: date.format('YYYY-MM-DD'),
        },
      });
    } catch (error) {
      logger.flowError('DailyNoteHome', 'navigate:daily-note-unavailable', error, {
        from: this.dailyNotePath,
        dateIso: date.format?.('YYYY-MM-DD') ?? null,
      });
    }
  }

  private async openSelectedDailyNoteForEditing(date: any): Promise<void> {
    try {
      if (!this.isDailyNoteBacked()) {
        await this.plugin.homeCaptureService.openDailyNote(date);
        return;
      }
      const dailyNote = this.getBackedDailyNoteFile()
        ?? await this.plugin.homeCaptureService.getDailyNoteForCapture(date);
      logger.flow('DailyNoteHome', 'edit:live-preview', { path: dailyNote.path });
      this.plugin.dailyNoteHomeService.allowLivePreview(this.leaf, dailyNote.path);
      await this.leaf.setViewState({
        type: 'markdown',
        active: true,
        pinned: this.leaf.getViewState().pinned,
        state: {
          file: dailyNote.path,
          mode: 'source',
          source: false,
        },
      });
    } catch (error) {
      logger.flowError('DailyNoteHome', 'edit:daily-note-unavailable', error, {
        path: this.dailyNotePath,
        dateIso: date.format?.('YYYY-MM-DD') ?? null,
      });
    }
  }

  private async refreshHomeActiveTimerButton(): Promise<void> {
    const button = this.homeActiveTimerButton;
    if (!button || this.homeActiveTimerUpdateInFlight) return;
    if (this.plugin.settings.enableTimeTracking === false) {
      this.renderHomeActiveTimerButton(button, null);
      return;
    }

    this.homeActiveTimerUpdateInFlight = true;
    try {
      const target = await this.getHomeActiveTimerTarget();
      if (button !== this.homeActiveTimerButton) return;
      this.renderHomeActiveTimerButton(button, target);
    } catch (error) {
      logger.flowError('HomeView', 'refresh-active-timer-button-failed', error);
      this.renderHomeActiveTimerButton(button, null);
    } finally {
      this.homeActiveTimerUpdateInFlight = false;
    }
  }

  private async getHomeActiveTimerTarget(): Promise<HomeActiveTimerTarget | null> {
    const status = await this.plugin.timeTrackingService.getRuntimeStatus();
    if (status.active) {
      const activePath = normalizePath(String(status.active.targetPath || status.active.sourcePath || '').trim()).replace(/^\/+/, '');
      return {
        kind: this.isWorkoutTimeTrackingSession(status.active) ? 'workout' : 'time-tracking',
        session: status.active,
        path: activePath,
        title: status.active.title || 'Tracked time',
        startedAt: status.active.start,
      };
    }
    return null;
  }

  private isWorkoutTimeTrackingSession(session: TimeTrackingSession): boolean {
    const path = normalizePath(String(session.targetPath || session.sourcePath || '').trim()).replace(/^\/+/, '');
    if (!path) return false;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const kind = String(frontmatter.kind || '').trim().toLowerCase();
    const runType = String(frontmatter.runType || frontmatter.workflowType || '').trim().toLowerCase();
    if (kind === 'workout' || runType === 'workout') return true;
    const cssclasses = frontmatter.cssclasses;
    const cssList = Array.isArray(cssclasses) ? cssclasses : String(cssclasses || '').split(/\s+/);
    if (cssList.some((entry) => String(entry).trim() === 'tps-health-workout')) return true;
    const healthPlugin = this.getHealthPlugin();
    const workoutsFolder = normalizePath(String(healthPlugin?.settings?.workoutsFolder || '').trim()).replace(/^\/+|\/+$/g, '');
    return Boolean(workoutsFolder && (file.path === workoutsFolder || file.path.startsWith(`${workoutsFolder}/`)));
  }

  private renderHomeActiveTimerButton(button: HTMLButtonElement, target: HomeActiveTimerTarget | null): void {
    this.homeActiveTimerTarget = target;
    button.style.display = target ? '' : 'none';
    button.empty();
    setIcon(button, 'timer');
    if (!target) {
      button.setAttr('aria-label', 'No running time-tracked note');
      button.setAttr('title', 'No running time-tracked note');
      return;
    }

    const elapsed = this.plugin.timeTrackingService.formatElapsed(
      this.getHomeActiveTimerElapsedMs(target),
    );
    const label = `Open running ${target.kind === 'workout' ? 'workout' : 'time-tracked note'}: ${elapsed} | ${target.title}`;
    button.setAttr('aria-label', label);
    button.setAttr('title', label);
  }

  private getHomeActiveTimerElapsedMs(target: HomeActiveTimerTarget): number {
    if (target.session) {
      return this.plugin.timeTrackingService.getElapsedMsForSession({ start: target.startedAt });
    }
    const startedAt = Date.parse(target.startedAt);
    return Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0;
  }

  private async openHomeActiveTimerTarget(): Promise<void> {
    const target = await this.getHomeActiveTimerTarget() ?? this.homeActiveTimerTarget;
    if (!target) {
      new Notice('No running time-tracked note.');
      await this.refreshHomeActiveTimerButton();
      return;
    }

    let opened = false;
    if ('session' in target && target.session) {
      opened = await this.plugin.timeTrackingService.openHydratedSessionTarget(target.session);
    } else if ('path' in target) {
      opened = await this.openHomeWorkoutTarget(target.path);
    }
    if (!opened) new Notice('Could not open timer target.');
    await this.refreshHomeActiveTimerButton();
  }

  private async openHomeWorkoutTarget(path: string): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return false;
    return this.plugin.openFileInLeaf(
      file,
      false,
      () => this.plugin.app.workspace.getLeaf(false),
      { revealLeaf: true },
    );
  }

  private async renderQuickCapture(
    parent: HTMLElement,
    today: any,
    component: HomeComponentId,
    generation: number,
  ): Promise<void> {
    const panel = this.createComponentPanel(parent, component, 'Daily note');
    this.applyHomeContext(panel, today);
    const capture = panel.createDiv({ cls: 'tps-home-native-capture' });
    const editorHost = capture.createDiv({ cls: 'tps-home-native-capture-editor' });
    const actions = capture.createDiv({ cls: 'tps-home-capture-actions' });
    const addButton = actions.createEl('button', { cls: 'tps-home-primary-button', attr: { type: 'button' } });
    setIcon(addButton, 'send');
    addButton.createSpan({ text: 'Add to day' });
    const taskButton = actions.createEl('button', { cls: 'tps-home-secondary-button', attr: { type: 'button' } });
    setIcon(taskButton, 'list-checks');
    taskButton.createSpan({ text: 'Add task' });
    actions.createSpan({ cls: 'tps-home-capture-shortcut', text: '⌘↵ Add to day' });

    if (Platform.isMobile) {
      await this.renderMobileQuickCapture(editorHost, actions, addButton, taskButton, today, generation);
      if (!this.isHomeRenderCurrent(generation)) return;
      this.renderQuickCapturePreview(panel, component, today, generation);
      return;
    }

    let dailyNote: TFile;
    try {
      dailyNote = await this.plugin.homeCaptureService.getDailyNoteForCapture(today.clone());
    } catch (error) {
      logger.flowError('HomeView', 'quick-capture:daily-note-unavailable', error, {
        dateIso: today.format?.('YYYY-MM-DD') ?? null,
      });
      editorHost.empty();
      editorHost.createDiv({
        cls: 'tps-home-empty',
        text: 'Daily Note unavailable. Check the Daily Notes template setting.',
      });
      addButton.disabled = true;
      taskButton.disabled = true;
      return;
    }
    if (!this.isHomeRenderCurrent(generation)) return;
    const editTarget = this.homeCaptureEditTarget?.path === dailyNote.path ? this.homeCaptureEditTarget : null;
    let dailyContent = await this.app.vault.read(dailyNote);
    if (!this.isHomeRenderCurrent(generation)) return;

    let draftTarget = !editTarget && this.homeCaptureDraftTarget?.path === dailyNote.path
      ? this.homeCaptureDraftTarget
      : null;
    if (draftTarget && !resolveHomeCaptureDraftRange(dailyContent, draftTarget.line, draftTarget.value)) {
      logger.flowWarn('HomeView', 'quick-capture:draft-resume-conflict', {
        target: dailyNote.path,
        selectedDate: today.format('YYYY-MM-DD'),
        line: draftTarget.line + 1,
      });
      this.homeCaptureDraftTarget = null;
      draftTarget = null;
    }
    if (!editTarget && !draftTarget) {
      let prepared = prepareHomeCaptureDraft(dailyContent, this.plugin.settings.homeCaptureInsertPosition);
      dailyContent = await this.app.vault.process(dailyNote, (current) => {
        prepared = prepareHomeCaptureDraft(current, this.plugin.settings.homeCaptureInsertPosition);
        return prepared.content;
      });
      draftTarget = { path: dailyNote.path, line: prepared.startLine, value: '' };
      this.homeCaptureDraftTarget = draftTarget;
    }
    if (!this.isHomeRenderCurrent(generation)) return;

    const embeddedView = new MarkdownView(this.leaf);
    this.homeCaptureMarkdownView = embeddedView;
    embeddedView.containerEl.addClass('tps-home-embedded-markdown-view');
    embeddedView.containerEl.dataset.tpsHomeCaptureTarget = dailyNote.path;
    let captureStartLine = editTarget?.line ?? draftTarget?.line ?? 0;

    try {
      await (embeddedView as MarkdownView & { open(parent: HTMLElement): Promise<void> }).open(editorHost);
      await embeddedView.setState({
        file: dailyNote.path,
        mode: 'source',
        source: false,
      }, { history: false } as any);
      if (!this.isHomeRenderCurrent(generation) || this.homeCaptureMarkdownView !== embeddedView) {
        if (this.homeCaptureMarkdownView === embeddedView) this.homeCaptureMarkdownView = null;
        await this.closeHomeCaptureMarkdownView(embeddedView);
        return;
      }
      const nativeEditor = embeddedView.editor;
      const cm = (nativeEditor as any).cm as EditorView | undefined;
      if (!cm?.dispatch) throw new Error('Obsidian did not expose the mounted CodeMirror editor.');
      const editorDocument = cm.state.doc.toString();
      let rangeFrom: number;
      let rangeTo: number;
      let originalEditLine: string | null = null;
      if (editTarget) {
        if (!Number.isInteger(editTarget.line) || editTarget.line < 0 || editTarget.line >= cm.state.doc.lines) {
          throw new HomeCaptureRevisionConflictError();
        }
        captureStartLine = editTarget.line;
        const sourceLine = cm.state.doc.line(captureStartLine + 1);
        rangeFrom = sourceLine.from;
        rangeTo = sourceLine.to;
        originalEditLine = sourceLine.text;
      } else {
        const resolved = draftTarget
          ? resolveHomeCaptureDraftRange(editorDocument, draftTarget.line, draftTarget.value)
          : null;
        if (!draftTarget || !resolved) throw new HomeCaptureRevisionConflictError();
        captureStartLine = draftTarget.line;
        rangeFrom = resolved.from;
        rangeTo = resolved.to;
      }

      const snapshot = createHomeCaptureRangeSnapshot(editorDocument, rangeFrom, rangeTo);
      const session: HomeCaptureEditorSession = {
        id: ++this.homeCaptureSessionId,
        generation,
        view: embeddedView,
        file: dailyNote,
        cm,
        editTarget,
        originalEditLine,
        snapshot,
        allowedValues: new Set([snapshot.value]),
        rangeFrom,
        rangeTo,
        accepting: true,
        settled: false,
        conflict: false,
        conflictNotified: false,
        conflictRecoveryScheduled: false,
        internalChange: false,
        operationPromise: null,
      };
      this.homeCaptureEditorSession = session;
      if (!editTarget) this.updateHomeCaptureDraftTarget(session);

      const focusCaptureEditor = () => {
        if (!this.isHomeCaptureSessionCurrent(session) || !editorHost.isConnected) return;
        nativeEditor.focus();
        nativeEditor.setCursor(Math.min(session.rangeTo, cm.state.doc.length));
        const cursor = nativeEditor.offsetToPos(session.rangeTo);
        nativeEditor.scrollIntoView({ from: cursor, to: cursor }, true);
      };

      const handleCaptureSurfacePointer = (event: PointerEvent | TouchEvent) => {
        const target = event.target instanceof Element ? event.target : null;
        focusCaptureEditor();
        if (!target?.closest('.cm-content')) event.preventDefault();
      };

      editorHost.addEventListener('pointerdown', handleCaptureSurfacePointer, { capture: true });
      editorHost.addEventListener('touchstart', handleCaptureSurfacePointer, { capture: true, passive: false });
      editorHost.addEventListener('click', focusCaptureEditor);

      let submitInFlight = false;
      const getCaptureValue = () => this.getHomeCaptureSessionValue(session).trim();
      const updateSubmitState = () => {
        const disabled = submitInFlight || !this.isHomeCaptureSessionCurrent(session) || !getCaptureValue();
        addButton.disabled = disabled;
        taskButton.disabled = disabled;
      };
      cm.dispatch({
        effects: StateEffect.appendConfig.of(
          createHomeCaptureIsolationExtension(() => ({ from: session.rangeFrom, to: session.rangeTo }), (update) => {
            this.handleHomeCaptureDocumentUpdate(session, update);
            updateSubmitState();
          }),
        ),
      });

      const runReplacement = async (replacement: string, action: string) => {
        const operation = this.replaceHomeCaptureSessionRange(session, replacement, action);
        session.operationPromise = operation;
        try {
          return await operation;
        } finally {
          if (session.operationPromise === operation) session.operationPromise = null;
        }
      };

      const submit = async (task: boolean) => {
        if (submitInFlight || !this.isHomeCaptureSessionCurrent(session)) return;
        const value = getCaptureValue();
        if (!value) return;
        submitInFlight = true;
        updateSubmitState();
        let rerender = false;
        let afterRender: (() => void) | null = null;
        try {
          const trigger = !editTarget ? HOME_CAPTURE_TRIGGERS.find((candidate) => candidate.matches(value)) : null;
          if (trigger) {
            const choice = await new HomeCaptureTriggerModal(this.app, trigger, value).choose();
            if (!this.isHomeCaptureSessionCurrent(session)) return;
            logger.flow('HomeCaptureTrigger', 'choice', {
              trigger: trigger.id,
              choice,
              selectedDate: today.format('YYYY-MM-DD'),
              requestedTask: task,
            });
            if (choice === 'cancel') return;
            if (choice === 'describe') {
              const healthPlugin = this.getHealthPlugin();
              if (typeof healthPlugin?.openFoodDescriber !== 'function') {
                new Notice('TPS Health Describe is unavailable.');
                return;
              }
              const description = trigger.clean(value);
              if (!description) {
                new Notice('Add a food description before #food.');
                return;
              }
              const outcome = await runReplacement('', 'food-describe-clear');
              rerender = outcome !== 'stale';
              if (outcome !== 'saved') return;
              this.homeCaptureDraftTarget = null;
              this.homeCaptureEditTarget = null;
              new Notice('Your food is being researched and will be added to the tray shortly.', 6000);
              afterRender = () => {
                void healthPlugin.openFoodDescriber(description, this.getHomeFoodLogDateContext(today)).catch((error) => {
                  logger.flowError('HomeCaptureTrigger', 'food-describe:failed', error, { selectedDate: today.format('YYYY-MM-DD') });
                  new Notice(error instanceof Error ? error.message : 'Could not build the food tray.', 10000);
                });
              };
              return;
            }
          }
          if (!this.plugin.homeCaptureService.validateCaptureValue(value, today.clone(), { task })) return;

          const replacement = editTarget && originalEditLine != null
            ? preserveTpsInlinePropsMetadata(originalEditLine, value)
            : `${this.plugin.homeCaptureService.formatCaptureValue(value, task)}${session.snapshot.suffix.startsWith('\n') ? '' : '\n'}`;
          const outcome = await runReplacement(replacement, editTarget ? 'edit-save' : task ? 'capture-task' : 'capture-note');
          rerender = outcome !== 'stale';
          if (outcome !== 'saved') return;
          if (editTarget) {
            if (this.isMatchingHomeCaptureEditTarget(editTarget)) this.homeCaptureEditTarget = null;
          } else {
            this.homeCaptureDraftTarget = null;
            new Notice(`${task ? 'Added task' : 'Added'} to ${today.format('YYYY-MM-DD')}.`);
          }
          logger.flow('HomeView', 'quick-capture:submitted', {
            target: dailyNote.path,
            selectedDate: today.format('YYYY-MM-DD'),
            task: editTarget ? false : task,
            mode: editTarget ? 'edit-line' : 'new-line',
          });
        } catch (error) {
          logger.flowError('HomeView', 'quick-capture:submit-failed', error, {
            target: dailyNote.path,
            selectedDate: today.format('YYYY-MM-DD'),
            task: editTarget ? false : task,
            mode: editTarget ? 'edit-line' : 'new-line',
          });
          new Notice(error instanceof Error ? error.message : 'Quick Capture could not be saved.', 10000);
        } finally {
          submitInFlight = false;
          if (addButton.isConnected) updateSubmitState();
          if (rerender) await this.render();
          afterRender?.();
        }
      };

      const cancelEdit = async () => {
        if (!editTarget || originalEditLine == null || submitInFlight || !this.isHomeCaptureSessionCurrent(session)) return;
        submitInFlight = true;
        updateSubmitState();
        let rerender = false;
        try {
          const outcome = await runReplacement(originalEditLine, 'edit-cancel');
          rerender = outcome !== 'stale';
          if (outcome === 'saved') {
            logger.flow('HomeView', 'quick-capture:edit-cancelled', {
              target: dailyNote.path,
              selectedDate: today.format('YYYY-MM-DD'),
              line: captureStartLine,
              restored: true,
            });
          }
          if (this.isMatchingHomeCaptureEditTarget(editTarget)) this.homeCaptureEditTarget = null;
        } catch (error) {
          logger.flowError('HomeView', 'quick-capture:edit-cancel-failed', error, {
            target: dailyNote.path,
            selectedDate: today.format('YYYY-MM-DD'),
            line: captureStartLine,
          });
          new Notice(error instanceof Error ? error.message : 'Quick Capture could not restore the original line.', 10000);
        } finally {
          submitInFlight = false;
        }
        if (rerender) await this.render();
      };

      addButton.addEventListener('click', () => void submit(false));
      taskButton.addEventListener('click', () => void submit(true));
      editorHost.addEventListener('keydown', (event) => {
        if (editTarget && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          void cancelEdit();
          return;
        }
        if (editTarget && event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          void submit(false);
        }
      }, { capture: true });
      if (editTarget) {
        editorHost.addEventListener('paste', (event) => {
          const pasted = event.clipboardData?.getData('text/plain') || '';
          if (!/[\r\n]/.test(pasted)) return;
          event.preventDefault();
          session.internalChange = true;
          try {
            nativeEditor.replaceSelection(pasted.replace(/\s*\r?\n\s*/g, ' '));
          } finally {
            session.internalChange = false;
          }
        }, { capture: true });
        addButton.empty();
        setIcon(addButton, 'save');
        addButton.createSpan({ text: 'Save changes' });
        taskButton.style.display = 'none';
        const cancelButton = actions.createEl('button', { cls: 'tps-home-secondary-button', attr: { type: 'button' } });
        setIcon(cancelButton, 'x');
        cancelButton.createSpan({ text: 'Cancel' });
        cancelButton.addEventListener('click', () => void cancelEdit());
        actions.querySelector<HTMLElement>('.tps-home-capture-shortcut')?.setText('⌘↵ Save · Esc Cancel');
        editorHost.addClass('is-editing-daily-note-line');
      }
      updateSubmitState();
      logger.flow('HomeView', 'quick-capture:editor-mounted', {
        target: dailyNote.path,
        selectedDate: today.format('YYYY-MM-DD'),
        line: captureStartLine + 1,
        mode: editTarget ? 'edit-line' : 'new-line',
      });
      window.setTimeout(() => {
        if (!this.isHomeCaptureSessionCurrent(session) || !editorHost.isConnected) return;
        focusCaptureEditor();
      }, 0);
    } catch (error) {
      logger.flowError('HomeView', 'quick-capture:editor-mount-failed', error, {
        target: dailyNote.path,
        selectedDate: today.format('YYYY-MM-DD'),
        line: captureStartLine + 1,
        mode: editTarget ? 'edit-line' : 'new-line',
      });
      if (this.homeCaptureEditorSession?.view === embeddedView) this.homeCaptureEditorSession = null;
      if (this.homeCaptureMarkdownView === embeddedView) this.homeCaptureMarkdownView = null;
      await this.closeHomeCaptureMarkdownView(embeddedView);
      editorHost.empty();
      editorHost.createDiv({ cls: 'tps-home-empty', text: 'Quick Capture Live Preview could not be mounted. Refresh Home to retry.' });
      addButton.disabled = true;
      taskButton.disabled = true;
    }

    this.renderQuickCapturePreview(panel, component, today, generation);
  }

  private async renderMobileQuickCapture(
    editorHost: HTMLElement,
    actions: HTMLElement,
    addButton: HTMLButtonElement,
    taskButton: HTMLButtonElement,
    today: any,
    generation: number,
  ): Promise<void> {
    this.homeCaptureDraftTarget = null;
    const editTarget = this.homeCaptureEditTarget;
    let editFile: TFile | null = null;
    let editSnapshot: HomeCaptureRangeSnapshot | null = null;
    if (editTarget) {
      const candidate = this.app.vault.getAbstractFileByPath(editTarget.path);
      if (candidate instanceof TFile) {
        const content = await this.app.vault.read(candidate);
        if (!this.isHomeRenderCurrent(generation)) return;
        const range = resolveHomeCaptureLineRange(content, editTarget.line);
        if (range) {
          editFile = candidate;
          editSnapshot = createHomeCaptureRangeSnapshot(content, range.from, range.to);
        }
      }
      if (!editFile || !editSnapshot) this.homeCaptureEditTarget = null;
    }
    editorHost.addClass('tps-home-native-capture-editor--mobile');
    const textarea = editorHost.createEl('textarea', {
      cls: 'tps-home-native-capture-textarea',
      attr: {
        'aria-label': 'Quick capture',
        placeholder: 'Write a note or thought…',
        rows: '1',
        spellcheck: 'true',
      },
    });
    textarea.value = editSnapshot ? stripTaskInlinePropsMetadata(editSnapshot.value) : '';
    let submitInFlight = false;
    const resizeTextarea = () => {
      textarea.style.height = '1px';
      textarea.style.minHeight = '0';
      const nextHeight = textarea.scrollHeight;
      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY = 'hidden';
      textarea.scrollTop = 0;
      editorHost.style.height = `${nextHeight}px`;
      editorHost.style.minHeight = '0';
      editorHost.style.maxHeight = 'none';
      editorHost.scrollTop = 0;
    };
    const focusMobileCaptureSurface = (event: PointerEvent | TouchEvent | MouseEvent) => {
      if (event.target === textarea) return;
      event.preventDefault();
      textarea.focus({ preventScroll: true });
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    };
    editorHost.addEventListener('pointerdown', focusMobileCaptureSurface, { capture: true });
    editorHost.addEventListener('touchstart', focusMobileCaptureSurface, { capture: true, passive: false });
    editorHost.addEventListener('click', focusMobileCaptureSurface);
    const updateSubmitState = () => {
      const disabled = submitInFlight || !textarea.value.trim() || !this.isHomeRenderCurrent(generation);
      addButton.disabled = disabled;
      taskButton.disabled = disabled;
    };
    const submit = async (task: boolean) => {
      if (submitInFlight || !this.isHomeRenderCurrent(generation) || !textarea.isConnected) return;
      const value = textarea.value.trim();
      if (!value) return;
      submitInFlight = true;
      updateSubmitState();
      try {
        if (editFile && editSnapshot && editTarget) {
          if (!this.plugin.homeCaptureService.validateCaptureValue(value, today.clone())) return;
          let conflict = false;
          await this.app.vault.process(editFile, (current) => {
            const replacement = preserveTpsInlinePropsMetadata(editSnapshot!.value, value);
            const next = replaceHomeCaptureRangeIfUnchanged(current, editSnapshot!, [editSnapshot!.value], replacement);
            if (next == null) {
              conflict = true;
              return current;
            }
            return next;
          });
          this.homeCaptureEditTarget = null;
          if (conflict) {
            logger.flowWarn('HomeView', 'quick-capture:mobile-edit-conflict', {
              target: editFile.path,
              selectedDate: today.format('YYYY-MM-DD'),
              line: editTarget.line + 1,
            });
            new Notice('That Daily Note line changed on another device. Nothing was replaced.', 10000);
          } else {
            logger.flow('HomeView', 'quick-capture:mobile-edit-saved', {
              target: editFile.path,
              selectedDate: today.format('YYYY-MM-DD'),
              line: editTarget.line + 1,
            });
          }
          await this.render();
          return;
        }
        const trigger = HOME_CAPTURE_TRIGGERS.find((candidate) => candidate.matches(value));
        if (trigger) {
          const choice = await new HomeCaptureTriggerModal(this.app, trigger, value).choose();
          if (!this.isHomeRenderCurrent(generation) || !textarea.isConnected) return;
          logger.flow('HomeCaptureTrigger', 'choice', {
            trigger: trigger.id,
            choice,
            selectedDate: today.format('YYYY-MM-DD'),
            requestedTask: task,
            surface: 'mobile-textarea',
          });
          if (choice === 'cancel') return;
          if (choice === 'describe') {
            const healthPlugin = this.getHealthPlugin();
            if (typeof healthPlugin?.openFoodDescriber !== 'function') {
              new Notice('TPS Health Describe is unavailable.');
              return;
            }
            const description = trigger.clean(value);
            if (!description) {
              new Notice('Add a food description before #food.');
              return;
            }
            textarea.value = '';
            updateSubmitState();
            new Notice('Your food is being researched and will be added to the tray shortly.', 6000);
            await this.render();
            void healthPlugin.openFoodDescriber(description, this.getHomeFoodLogDateContext(today)).catch((error) => {
              logger.flowError('HomeCaptureTrigger', 'food-describe:failed', error, {
                selectedDate: today.format('YYYY-MM-DD'),
                surface: 'mobile-textarea',
              });
              new Notice(error instanceof Error ? error.message : 'Could not build the food tray.', 10000);
            });
            return;
          }
        }
        const saved = await this.plugin.homeCaptureService.capture(value, today.clone(), { task });
        if (!saved) return;
        logger.flow('HomeView', 'quick-capture:mobile-submitted', {
          target: saved.path,
          selectedDate: today.format('YYYY-MM-DD'),
          task,
        });
        textarea.value = '';
        await this.render();
      } catch (error) {
        logger.flowError('HomeView', 'quick-capture:mobile-submit-failed', error, {
          selectedDate: today.format('YYYY-MM-DD'),
          task,
        });
        new Notice(error instanceof Error ? error.message : 'Quick Capture could not be saved.', 10000);
      } finally {
        submitInFlight = false;
        if (textarea.isConnected) updateSubmitState();
      }
    };
    textarea.addEventListener('input', () => {
      updateSubmitState();
      resizeTextarea();
    });
    textarea.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void submit(false);
      }
    });
    addButton.addEventListener('click', () => void submit(false));
    if (editFile && editSnapshot && editTarget) {
      addButton.empty();
      setIcon(addButton, 'save');
      addButton.createSpan({ text: 'Save changes' });
      taskButton.style.display = 'none';
      const cancelButton = actions.createEl('button', { cls: 'tps-home-secondary-button', attr: { type: 'button' } });
      setIcon(cancelButton, 'x');
      cancelButton.createSpan({ text: 'Cancel' });
      cancelButton.addEventListener('click', () => {
        this.homeCaptureEditTarget = null;
        void this.render();
      });
      actions.querySelector<HTMLElement>('.tps-home-capture-shortcut')?.setText('Save selected line · Cancel leaves it unchanged');
      editorHost.addClass('is-editing-daily-note-line');
    } else {
      taskButton.addEventListener('click', () => void submit(true));
    }
    updateSubmitState();
    window.requestAnimationFrame(resizeTextarea);
    logger.flow('HomeView', 'quick-capture:mobile-textarea-mounted', {
      selectedDate: today.format('YYYY-MM-DD'),
      idleDailyNoteWrite: false,
      mode: editSnapshot ? 'edit-line' : 'new-line',
    });
  }

  private renderQuickCapturePreview(
    panel: HTMLElement,
    component: HomeComponentId,
    today: any,
    generation: number,
  ): void {
    if (!this.isHomeRenderCurrent(generation)) return;
    const previewComponent = new Component();
    previewComponent.load();
    this.embedComponents.push(previewComponent);
    this.plugin.homeCaptureService.renderDailyNotePreview(panel, {
      date: today.clone(),
      component: previewComponent,
      className: 'tps-home-capture-preview tps-home-capture-preview--home',
      onLineClick: (file, line) => {
        this.homeCaptureEditTarget = { path: file.path, line };
        void this.render();
      },
    });
    this.applyHomeCapturePreviewLayout(panel, component);
    this.finishComponentPanel(panel, component, { capturePreview: true });
  }

  private isHomeCaptureSessionCurrent(session: HomeCaptureEditorSession): boolean {
    return session.accepting
      && this.isHomeCaptureSessionMounted(session)
      && this.isHomeRenderCurrent(session.generation);
  }

  private isHomeCaptureSessionMounted(session: HomeCaptureEditorSession): boolean {
    return session.generation === this.homeRenderGeneration
      && this.homeCaptureEditorSession === session
      && this.homeCaptureMarkdownView === session.view;
  }

  private isMatchingHomeCaptureEditTarget(target: { path: string; line: number }): boolean {
    return this.homeCaptureEditTarget?.path === target.path && this.homeCaptureEditTarget.line === target.line;
  }

  private getHomeCaptureSessionValue(session: HomeCaptureEditorSession): string {
    const documentLength = session.cm.state.doc.length;
    const from = Math.max(0, Math.min(session.rangeFrom, documentLength));
    const to = Math.max(from, Math.min(session.rangeTo, documentLength));
    return session.cm.state.doc.sliceString(from, to);
  }

  private handleHomeCaptureDocumentUpdate(session: HomeCaptureEditorSession, update: ViewUpdate): void {
    const oldFrom = session.rangeFrom;
    const oldTo = session.rangeTo;
    let insideCaptureRange = true;
    update.changes.iterChangedRanges((fromA, toA) => {
      if (fromA < oldFrom || toA > oldTo) insideCaptureRange = false;
    });
    const userAuthored = update.transactions
      .filter((transaction) => transaction.docChanged)
      .every((transaction) => (
        transaction.annotation(Transaction.remote) !== true
        && (
          transaction.isUserEvent('input')
          || transaction.isUserEvent('delete')
          || transaction.isUserEvent('move')
          || transaction.isUserEvent('undo')
          || transaction.isUserEvent('redo')
        )
      ));

    session.rangeFrom = update.changes.mapPos(oldFrom, -1);
    session.rangeTo = update.changes.mapPos(oldTo, 1);
    if (!session.internalChange && (!insideCaptureRange || !userAuthored)) {
      if (!session.conflict) {
        logger.flowWarn('HomeView', 'quick-capture:editor-revision-conflict', {
          target: session.file.path,
          mode: session.editTarget ? 'edit-line' : 'new-line',
          insideCaptureRange,
          userAuthored,
        });
      }
      session.conflict = true;
      if (!session.operationPromise && !session.settled) this.scheduleHomeCaptureConflictRecovery(session);
      return;
    }
    if (!session.accepting) return;
    session.allowedValues.add(this.getHomeCaptureSessionValue(session));
    if (!session.editTarget) this.updateHomeCaptureDraftTarget(session);
  }

  private scheduleHomeCaptureConflictRecovery(session: HomeCaptureEditorSession): void {
    if (session.conflictRecoveryScheduled) return;
    session.conflictRecoveryScheduled = true;
    window.setTimeout(() => {
      void (async () => {
        if (!this.isHomeCaptureSessionMounted(session) || session.settled) return;
        const recovery = (async (): Promise<'conflict'> => {
          await this.handleHomeCaptureRevisionConflict(session, 'editor-change');
          return 'conflict';
        })();
        session.operationPromise = recovery;
        try {
          await recovery;
        } finally {
          if (session.operationPromise === recovery) session.operationPromise = null;
        }
        await this.render();
      })();
    }, 0);
  }

  private updateHomeCaptureDraftTarget(session: HomeCaptureEditorSession): void {
    if (session.editTarget || session.conflict) return;
    const line = session.cm.state.doc.lineAt(Math.min(session.rangeFrom, session.cm.state.doc.length)).number - 1;
    this.homeCaptureDraftTarget = {
      path: session.file.path,
      line,
      value: this.getHomeCaptureSessionValue(session),
    };
  }

  private replaceHomeCaptureSessionEditorValue(session: HomeCaptureEditorSession, replacement: string): void {
    session.internalChange = true;
    try {
      session.cm.dispatch({
        changes: { from: session.rangeFrom, to: session.rangeTo, insert: replacement },
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      session.internalChange = false;
    }
  }

  private async replaceHomeCaptureSessionRange(
    session: HomeCaptureEditorSession,
    replacement: string,
    action: string,
    allowTeardown = false,
  ): Promise<'saved' | 'conflict' | 'stale'> {
    if (allowTeardown ? !this.isHomeCaptureSessionMounted(session) : !this.isHomeCaptureSessionCurrent(session)) return 'stale';
    const currentValue = this.getHomeCaptureSessionValue(session);
    if (session.conflict || !session.allowedValues.has(currentValue)) {
      await this.handleHomeCaptureRevisionConflict(session, action);
      return 'conflict';
    }

    this.replaceHomeCaptureSessionEditorValue(session, replacement);
    const allowedValues = new Set(session.allowedValues);
    allowedValues.add(replacement);
    let processed: string;
    let revisionConflict = false;
    try {
      processed = await this.app.vault.process(session.file, (current) => {
        const next = replaceHomeCaptureRangeIfUnchanged(current, session.snapshot, allowedValues, replacement);
        if (next == null) {
          revisionConflict = true;
          return current;
        }
        return next;
      });
    } catch (error) {
      logger.flowError('HomeView', 'quick-capture:range-process-failed', error, {
        target: session.file.path,
        action,
      });
      await this.handleHomeCaptureRevisionConflict(session, `${action}-process-failed`);
      return 'conflict';
    }
    if (revisionConflict) {
      await this.handleHomeCaptureRevisionConflict(session, action);
      return 'conflict';
    }

    session.settled = true;
    (session.view as MarkdownView & { data: string }).data = processed;
    try {
      await session.view.save();
    } catch (error) {
      logger.flowError('HomeView', 'quick-capture:post-process-save-failed', error, {
        target: session.file.path,
        action,
      });
    }
    logger.flow('HomeView', 'quick-capture:range-committed', {
      target: session.file.path,
      action,
      mode: session.editTarget ? 'edit-line' : 'new-line',
    });
    return 'saved';
  }

  private async handleHomeCaptureRevisionConflict(session: HomeCaptureEditorSession, action: string): Promise<void> {
    const hadUnsettledUserValue = session.editTarget !== null || Boolean(this.getHomeCaptureSessionValue(session).trim());
    session.conflict = true;
    session.accepting = false;
    session.settled = true;
    if (session.editTarget && this.isMatchingHomeCaptureEditTarget(session.editTarget)) {
      this.homeCaptureEditTarget = null;
    }
    if (!session.editTarget && this.homeCaptureDraftTarget?.path === session.file.path) {
      this.homeCaptureDraftTarget = null;
    }

    try {
      const latest = await this.app.vault.read(session.file);
      session.internalChange = true;
      try {
        session.view.setViewData(latest, true);
        (session.view as MarkdownView & { data: string }).data = latest;
      } finally {
        session.internalChange = false;
      }
    } catch (error) {
      this.homeCaptureSkipSaveViews.add(session.view);
      logger.flowError('HomeView', 'quick-capture:conflict-reload-failed', error, {
        target: session.file.path,
        action,
      });
    }

    if (!session.conflictNotified && hadUnsettledUserValue) {
      session.conflictNotified = true;
      new Notice('Daily Note changed outside Quick Capture. Nothing was replaced; Home will reopen the latest note.', 10000);
    }
    logger.flowWarn('HomeView', 'quick-capture:revision-conflict', {
      target: session.file.path,
      action,
      mode: session.editTarget ? 'edit-line' : 'new-line',
    });
  }

  private async prepareHomeCaptureForTeardown(reason: 'render' | 'close'): Promise<void> {
    const session = this.homeCaptureEditorSession;
    if (!session) return;
    if (session.operationPromise) {
      try {
        await session.operationPromise;
      } catch (error) {
        logger.flowError('HomeView', 'quick-capture:pending-operation-failed', error, {
          target: session.file.path,
          reason,
        });
        if (this.isHomeCaptureSessionMounted(session) && !session.settled) {
          await this.handleHomeCaptureRevisionConflict(session, `${reason}-operation-failed`);
        }
      }
    }
    if (this.homeCaptureEditorSession !== session) return;

    if (session.conflict && !session.settled) {
      await this.handleHomeCaptureRevisionConflict(session, `${reason}-conflict`);
    } else if (session.editTarget && !session.settled && session.originalEditLine != null) {
      const operation = this.replaceHomeCaptureSessionRange(session, session.originalEditLine, `edit-${reason}-rollback`, true);
      session.operationPromise = operation;
      let outcome: 'saved' | 'conflict' | 'stale';
      try {
        outcome = await operation;
      } catch (error) {
        logger.flowError('HomeView', 'quick-capture:edit-teardown-failed', error, {
          target: session.file.path,
          reason,
          line: session.editTarget.line + 1,
        });
        await this.handleHomeCaptureRevisionConflict(session, `edit-${reason}-rollback-failed`);
        outcome = 'conflict';
      } finally {
        if (session.operationPromise === operation) session.operationPromise = null;
      }
      logger.flow('HomeView', 'quick-capture:edit-teardown', {
        target: session.file.path,
        reason,
        outcome,
        line: session.editTarget.line + 1,
      });
      if (this.isMatchingHomeCaptureEditTarget(session.editTarget)) this.homeCaptureEditTarget = null;
    } else if (!session.editTarget && !session.settled && !session.conflict) {
      this.updateHomeCaptureDraftTarget(session);
    }
    session.accepting = false;
  }

  private async renderCalendar(parent: HTMLElement, component: HomeComponentId, today: any): Promise<void> {
    const baseFile = this.getHomeCalendarBaseFile();
    let calendarComponent: any = null;
    const panel = this.createComponentPanel(parent, component, this.editMode ? baseFile?.name || 'Base not found' : undefined);
    const host = panel.createDiv({ cls: 'tps-home-calendar-base-host tps-home-scroll-host tps-auto-base-embed__panel' });
    this.prepareHomeScrollHost(host, 'Calendar');
    this.applyHomeContext(panel, today);
    this.applyHomeContext(host, today);

    if (!baseFile) {
      host.createDiv({ cls: 'tps-home-empty', text: 'Home calendar Base was not found' });
      this.finishComponentPanel(panel, component);
      return;
    }

    panel.dataset.tpsBasePath = baseFile.path;
    host.dataset.path = baseFile.path;
    host.dataset.src = baseFile.path;
    const embedComponent = new Component();
    embedComponent.load();
    this.embedComponents.push(embedComponent);
    try {
      const calendarPlugin = this.getCalendarPlugin();
      const renderCalendarEmbed = calendarPlugin?.api?.renderBaseCalendarEmbed || calendarPlugin?.renderBaseCalendarEmbed;
      if (typeof renderCalendarEmbed === 'function') {
        calendarComponent = await renderCalendarEmbed.call(
          calendarPlugin?.api?.renderBaseCalendarEmbed ? calendarPlugin.api : calendarPlugin,
          host,
          baseFile.path,
        );
        if (calendarComponent) {
          this.embedComponents.push(calendarComponent);
        }
        calendarComponent?.navigateToDate?.(today.toDate?.() ?? today);
        this.scheduleHomeCalendarScrollToNow(calendarComponent, today);
      } else {
        await MarkdownRenderer.render(this.app, `![[${baseFile.path}]]`, host, baseFile.path, embedComponent);
      }
      this.scheduleCalendarEmbedResize(host);
    } catch (error) {
      logger.flowError('HomeView', 'render-calendar-base-embed-failed', error, { path: baseFile.path });
      host.empty();
      const message = error instanceof Error && error.message ? error.message : String(error || 'Unknown error');
      host.createDiv({ cls: 'tps-home-empty', text: `Could not render ${baseFile.path}: ${message}` });
    }
    this.finishComponentPanel(panel, component);
  }

  private async renderFoodBase(parent: HTMLElement, component: HomeComponentId, today: any): Promise<void> {
    const dateIso = this.normalizeHomeDateKey(today);
    await this.renderBasePanel(parent, component, await this.getHomeFoodBaseFile(), today, {
      beforeRender: (panel) => {
        if (dateIso) panel.dataset.tpsHomeFoodDate = dateIso;
      },
    });
  }

  private async renderWorkoutBase(parent: HTMLElement, component: HomeComponentId, today: any): Promise<void> {
    const selectedDate = this.normalizeHomeDateKey(today);
    await this.renderBasePanel(parent, component, await this.getHomeWorkoutBaseFile(), today, {
      beforeRender: (panel) => {
        if (selectedDate) panel.dataset.tpsHomeActivityDate = selectedDate;
      },
      afterRender: (panel, host) => this.decorateHomeWorkoutPanel(panel, host, today),
    });
  }

  private decorateHomeWorkoutPanel(panel: HTMLElement, host: HTMLElement, today: any): void {
    const update = () => {
      // Use textContent so the hidden Base result count remains part of the
      // state check after the friendly empty view replaces it visually.
      const visibleText = panel.textContent || '';
      const empty = /(?:^|\D)0\s*results?/i.test(visibleText);
      if (host.dataset.tpsHomeWorkoutEmpty === String(empty)) return;
      host.dataset.tpsHomeWorkoutEmpty = String(empty);
      logger.flow('HomeView', 'workout-panel:summary-state', {
        empty,
        selectedDate: today.format('YYYY-MM-DD'),
      });
      host.toggleClass('is-tps-home-workout-empty', empty);
      panel.querySelector('.tps-home-workout-empty')?.remove();
      if (!empty) return;
      const state = panel.createDiv({ cls: 'tps-home-workout-empty' });
      const icon = state.createDiv({ cls: 'tps-home-workout-empty-icon' });
      setIcon(icon, 'dumbbell');
      state.createDiv({ cls: 'tps-home-workout-empty-title', text: 'No activity logged' });
      state.createDiv({
        cls: 'tps-home-workout-empty-copy',
        text: `Nothing recorded for ${today.format('ddd, MMM D')}. Log an activity or start a workout.`,
      });
    };
    const observer = new MutationObserver(update);
    observer.observe(panel, { childList: true, subtree: true, characterData: true });
    const timers = [0, 250, 750, 1500, 3000].map((delay) => window.setTimeout(update, delay));
    this.homePanelCleanups.push(() => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    });
  }

  private async renderOpenTasksBase(parent: HTMLElement, component: HomeComponentId, today: any): Promise<void> {
    await this.renderBasePanel(parent, component, this.getHomeOpenTasksBaseFile(), today);
  }

  private async renderCustomBase(parent: HTMLElement, component: HomeBaseComponent, today: any): Promise<void> {
    let baseFile = this.getBaseFileFromSetting(component.path);
    if (!baseFile && normalizePath(component.path) === HOME_DAILY_NOTE_FEED_BASE_PATH) {
      baseFile = await this.ensureHomeDailyNoteFeedBaseFile();
    }
    await this.renderBasePanel(parent, component, baseFile, today);
  }

  private renderCommandPanel(parent: HTMLElement, component: HomeCommandComponent): void {
    const command = this.getCommand(component.commandId);
    const title = command?.name || component.title || component.commandId;
    const panel = this.createComponentPanel(parent, component, 'Command');
    const body = panel.createDiv({ cls: 'tps-home-command' });
    const button = body.createEl('button', {
      cls: 'tps-home-primary-button',
      attr: { type: 'button' },
    });
    setIcon(button, component.icon || 'terminal');
    button.createSpan({ text: title });
    if (this.editMode) button.disabled = true;
    if (!command) {
      button.disabled = true;
      body.createDiv({ cls: 'tps-home-empty', text: 'Command is no longer available' });
      this.finishComponentPanel(panel, component);
      return;
    }
    button.addEventListener('click', () => {
      void this.runCommand(component.commandId);
    });
    this.finishComponentPanel(panel, component);
  }

  private async renderBasePanel(
    parent: HTMLElement,
    component: HomeComponentId,
    baseFile: TFile | null,
    today: any,
    options: {
      beforeRender?: (panel: HTMLElement) => void;
      afterRender?: (panel: HTMLElement, host: HTMLElement) => void;
      contextFilter?: string;
    } = {},
  ): Promise<void> {
    const isCustomBase = typeof component !== 'string';
    const fileLabel = this.editMode
      ? baseFile?.name || 'Base not found'
      : isCustomBase ? baseFile?.basename || 'Base' : undefined;
    const panel = this.createComponentPanel(parent, component, fileLabel);
    options.beforeRender?.(panel);
    const host = panel.createDiv({ cls: 'tps-home-base-host tps-home-scroll-host tps-auto-base-embed__panel' });
    this.prepareHomeScrollHost(host, baseFile?.basename || 'Base');
    this.applyHomeContext(panel, today);
    this.applyHomeContext(host, today);
    if (!baseFile) {
      host.createDiv({ cls: 'tps-home-empty', text: 'Configured Base was not found' });
      this.finishComponentPanel(panel, component);
      return;
    }
    panel.dataset.tpsBasePath = baseFile.path;
    host.dataset.tpsBasePath = baseFile.path;
    host.dataset.path = baseFile.path;
    host.dataset.src = baseFile.path;
    let dailyNote: TFile;
    try {
      dailyNote = this.getBackedDailyNoteFile()
        ?? await this.plugin.homeCaptureService.getDailyNoteForCapture(today?.clone ? today.clone() : today);
    } catch (error) {
      logger.flowError('HomeView', 'base:daily-note-unavailable', error, {
        basePath: baseFile.path,
        dateIso: today?.format?.('YYYY-MM-DD') ?? null,
      });
      host.empty();
      host.createDiv({
        cls: 'tps-home-empty',
        text: 'Daily Note unavailable. Check the Daily Notes template setting.',
      });
      this.finishComponentPanel(panel, component);
      return;
    }
    const sourcePath = dailyNote.path;
    panel.dataset.tpsContextPath = sourcePath;
    host.dataset.tpsContextPath = sourcePath;
    await this.stampHomeBaseDefinition(panel, host, baseFile);
    if (options.contextFilter) {
      const definition = addHomeBaseContextFilter(host.dataset.tpsBaseDefinition || '', options.contextFilter);
      panel.dataset.tpsBaseDefinition = definition;
      host.dataset.tpsBaseDefinition = definition;
    }
    this.applyHomeBaseSourceContext(panel, host, sourcePath);
    const embedComponent = new Component();
    embedComponent.load();
    this.embedComponents.push(embedComponent);
    try {
      await withBaseEmbedRenderContext({
        path: baseFile.path,
        definition: host.dataset.tpsBaseDefinition || '',
        sourcePath,
      }, () => MarkdownRenderer.render(this.app, `![[${baseFile.path}]]`, host, sourcePath, embedComponent));
      this.scheduleCalendarEmbedResize(host);
      options.afterRender?.(panel, host);
    } catch (error) {
      logger.flowError('HomeView', 'render-base-embed-failed', error, { path: baseFile.path });
      host.empty();
      const message = error instanceof Error && error.message ? error.message : String(error || 'Unknown error');
      host.createDiv({ cls: 'tps-home-empty', text: `Could not render ${baseFile.path}: ${message}` });
    }
    this.finishComponentPanel(panel, component);
  }

  private normalizeHomeDateKey(value: unknown): string | null {
    if (value && typeof (value as any).format === 'function') {
      const formatted = (value as any).format('YYYY-MM-DD');
      return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : null;
    }
    const raw = String(value || '').trim();
    if (!raw) return null;
    const direct = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (direct) return direct;
    const moment = getMoment();
    const parsed = moment(raw, ['YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DDTHH:mm:ss.SSSZ', 'MM/DD/YYYY', 'MMM D YYYY', 'ddd, MMM D YYYY'], true);
    return parsed?.isValid?.() ? parsed.format('YYYY-MM-DD') : null;
  }

  private async stampHomeBaseDefinition(panel: HTMLElement, host: HTMLElement, baseFile: TFile): Promise<void> {
    try {
      const parsed = parseYaml(await this.app.vault.cachedRead(baseFile)) as Record<string, unknown> | null | undefined;
      const serialized = JSON.stringify({
        filters: parsed?.filters,
        formulas: parsed?.formulas,
        properties: parsed?.properties,
        views: parsed?.views,
      });
      panel.dataset.tpsBaseDefinition = serialized;
      host.dataset.tpsBaseDefinition = serialized;
      logger.flow('HomeView', 'base-definition:stamped', {
        path: baseFile.path,
        views: Array.isArray(parsed?.views) ? parsed.views.length : 0,
        hasBaseFilters: parsed?.filters != null,
        formulas: parsed?.formulas && typeof parsed.formulas === 'object'
          ? Object.keys(parsed.formulas as Record<string, unknown>).length
          : 0,
      });
    } catch (error) {
      logger.flowWarn('HomeView', 'base-definition:stamp-failed', { path: baseFile.path, error: logger.errorSummary(error) });
    }
  }

  private applyHomeBaseSourceContext(panel: HTMLElement, host: HTMLElement, sourcePath: string): void {
    const definition = resolveHomeBaseDefinitionSourcePath(host.dataset.tpsBaseDefinition || '', sourcePath);
    panel.dataset.tpsBaseDefinition = definition;
    host.dataset.tpsBaseDefinition = definition;
    logger.flow('HomeView', 'base-definition:contextualized', {
      sourcePath,
      replacedFilePathToken: definition.includes(JSON.stringify(sourcePath)),
    });
  }

  private addFoodLogPanelAction(panel: HTMLElement, today: any): void {
    const heading = panel.querySelector<HTMLElement>('.tps-home-panel-heading');
    if (!heading) return;

    const button = heading.createEl('button', {
      cls: 'tps-home-panel-action tps-home-food-log-button',
      attr: {
        type: 'button',
        title: 'Log food',
        'aria-label': 'Log food',
      },
    });
    const icon = button.createSpan({ cls: 'tps-home-panel-action-icon' });
    setIcon(icon, 'apple');
    button.createSpan({ text: 'Log food' });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openHomeFoodLogger(today);
    });
  }

  private openHomeFoodLogger(today: any): void {
    const healthPlugin = this.getHealthPlugin();
    const dateContext = this.getHomeFoodLogDateContext(today);
    if (typeof healthPlugin?.openFoodLogger === 'function') {
      healthPlugin.openFoodLogger(dateContext);
      return;
    }
    void this.runCommand('tps-health:log-food');
  }

  private addWorkoutPanelAction(panel: HTMLElement, today: any): void {
    const heading = panel.querySelector<HTMLElement>('.tps-home-panel-heading');
    if (!heading) return;

    const button = heading.createEl('button', {
      cls: 'tps-home-panel-action tps-home-start-workout-button',
      attr: {
        type: 'button',
        title: 'Start a workout for this day',
        'aria-label': 'Start a workout for this day',
      },
    });
    const icon = button.createSpan({ cls: 'tps-home-panel-action-icon' });
    setIcon(icon, 'play');
    button.createSpan({ text: 'Start workout' });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openHomeWorkoutStarter(today);
    });
  }

  private openHomeWorkoutStarter(today: any): void {
    const healthPlugin = this.getHealthPlugin();
    const dateContext = this.getHomeFoodLogDateContext(today);
    if (typeof healthPlugin?.openWorkoutStarter === 'function') {
      healthPlugin.openWorkoutStarter(dateContext);
      return;
    }
    logger.flowWarn('HomeView', 'start-workout:context-api-unavailable', {
      date: dateContext.dateIso,
    });
    void this.runCommand('tps-health:start-workout');
  }

  private getHomeFoodLogDateContext(today: any): HomeFoodLogDateContext {
    const moment = getMoment();
    const selected = (today?.clone ? today.clone() : moment(today)).startOf('day');
    const current = moment().startOf('day');
    return {
      dateIso: selected.format('YYYY-MM-DD'),
      label: selected.format('ddd, MMM D YYYY'),
      isToday: selected.isSame(current, 'day'),
      foodLogTarget: 'daily-note',
      focusAfterLog: false,
    };
  }

  private prepareHomeScrollHost(host: HTMLElement, label: string): void {
    host.addClass('tps-home-base-viewport');
    host.dataset.tpsHomeScrollOwner = 'base-viewport';
    host.tabIndex = 0;
    host.setAttr('role', 'region');
    host.setAttr('aria-label', `${label} scroll area`);
  }

  private registerHomeInnerScrollHandlers(): void {
    this.registerDomEvent(document, 'wheel', (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const modal = this.getHomeOutsideScrollModal(event.target);
      if (!modal) return;
      this.closeHomeModalForOutsideScroll(modal);
      this.scrollHomeElement(this.contentEl, event.deltaY);
      this.consumeHomeScrollEvent(event);
    }, { capture: true, passive: false });

    this.registerDomEvent(document, 'touchstart', (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        this.lastHomeModalOutsideTouchY = null;
        return;
      }
      const touch = event.touches[0];
      this.lastHomeModalOutsideTouchY = this.getHomeOutsideScrollModal(event.target, touch.clientX, touch.clientY)
        ? touch.clientY
        : null;
    }, { capture: true, passive: true });

    this.registerDomEvent(document, 'touchmove', (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      const modal = this.getHomeOutsideScrollModal(event.target, touch.clientX, touch.clientY);
      if (!modal) return;
      const previousY = this.lastHomeModalOutsideTouchY ?? touch.clientY;
      const deltaY = previousY - touch.clientY;
      this.lastHomeModalOutsideTouchY = touch.clientY;
      this.closeHomeModalForOutsideScroll(modal);
      this.scrollHomeElement(this.contentEl, deltaY);
      this.consumeHomeScrollEvent(event);
    }, { capture: true, passive: false });

    const clearModalTouch = () => {
      this.lastHomeModalOutsideTouchY = null;
    };
    this.registerDomEvent(document, 'touchend', clearModalTouch, { capture: true, passive: true });
    this.registerDomEvent(document, 'touchcancel', clearModalTouch, { capture: true, passive: true });

  }

  private getHomeOutsideScrollModal(target: EventTarget | null, clientX?: number, clientY?: number): HTMLElement | null {
    if (this.app.workspace.activeLeaf?.view !== this) return null;
    const modals = Array.from(document.body.querySelectorAll<HTMLElement>('.modal'))
      .filter((modal) => modal.isConnected && this.isVisibleHomeModal(modal));
    const modal = modals[modals.length - 1];
    if (!modal) return null;

    const targetEl = target instanceof HTMLElement ? target : null;
    if (targetEl && modal.contains(targetEl)) {
      if (clientX === undefined || clientY === undefined) return null;
      const rect = modal.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) return null;
    }
    return modal;
  }

  private isVisibleHomeModal(modal: HTMLElement): boolean {
    const rect = modal.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(modal);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  private closeHomeModalForOutsideScroll(modal: HTMLElement): void {
    const closeButton = modal.querySelector<HTMLElement>('.modal-close-button, button[aria-label="Close"], button[aria-label="Close modal"]');
    if (closeButton) {
      closeButton.click();
      return;
    }

    const keyTarget = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    keyTarget.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    }));
  }

  private consumeHomeScrollEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  private scrollHomeElement(host: HTMLElement, deltaY: number): boolean {
    if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 1) return false;
    const maxScrollTop = this.getHomeElementMaxScrollTop(host);
    if (maxScrollTop <= 1) return false;
    const previous = host.scrollTop;
    host.scrollTop = Math.max(0, Math.min(maxScrollTop, previous + deltaY));
    return Math.abs(host.scrollTop - previous) > 0;
  }

  private getHomeElementMaxScrollTop(element: HTMLElement): number {
    return element.scrollHeight - element.clientHeight;
  }

  private createComponentPanel(
    parent: HTMLElement,
    component: HomeComponentId,
    count?: string,
  ): HTMLElement {
    const componentId = this.getHomeComponentKey(component);
    const definition = this.getComponentDefinition(componentId);
    const panel = parent.createDiv({ cls: `tps-home-panel tps-home-component-${componentId.replace(/[^a-z0-9_-]/gi, '-')}` });
    panel.dataset.tpsHomeComponentKey = componentId;
    panel.addEventListener('contextmenu', (event: MouseEvent) => {
      this.openHomeComponentBaseContextMenu(event, panel, component);
    });
    this.applyHomeComponentLayout(panel, componentId);
    const heading = panel.createDiv({ cls: 'tps-home-panel-heading' });
    const iconEl = heading.createSpan({ cls: 'tps-home-panel-icon' });
    setIcon(iconEl, definition?.icon || 'panel-top');
    heading.createSpan({ text: definition?.title || this.getComponentTitle(component, componentId) });
    if (count) heading.createEl('small', { text: count });
    this.renderHomeComponentActions(heading, component);

    if (this.editMode) {
      const controls = panel.createDiv({ cls: 'tps-home-component-controls' });
      this.createHomeBuiltInBasePickerButton(controls, component);
      this.createIconButton(controls, 'arrow-up', 'Move component up', () => void this.moveComponent(component, -1));
      this.createIconButton(controls, 'arrow-down', 'Move component down', () => void this.moveComponent(component, 1));
      this.createIconButton(
        controls,
        this.getHomeComponentLayout(componentId).span === 2 ? 'columns-2' : 'maximize-2',
        this.getHomeComponentLayout(componentId).span === 2 ? 'Use one Home column' : 'Span both Home columns',
        () => void this.toggleHomeComponentSpan(component),
      );
      this.createIconButton(controls, 'rotate-ccw', 'Reset component size', () => void this.resetHomeComponentLayout(component));
      this.createIconButton(controls, 'x', 'Remove component from Home', () => void this.removeComponent(component));
    }
    return panel;
  }

  private createHomeBuiltInBasePickerButton(parent: HTMLElement, component: HomeComponentId): void {
    const settingKey = this.getHomeBuiltInBasePathSettingKey(component);
    if (!settingKey) return;

    const componentId = this.getHomeComponentKey(component);
    const title = this.getComponentDefinition(componentId)?.title || componentId;
    const label = this.getBaseFileFromSetting(this.plugin.settings[settingKey]) ? 'Change Base' : 'Choose Base';
    const accessibleLabel = `${label} for ${title}`;
    const button = parent.createEl('button', {
      cls: 'tps-home-secondary-button tps-home-component-base-button',
      attr: { 'aria-label': accessibleLabel, title: accessibleLabel, type: 'button' },
    });
    const icon = button.createSpan({ cls: 'tps-home-component-base-button-icon' });
    setIcon(icon, 'database');
    button.createSpan({ text: label });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      this.openHomeBuiltInBasePicker(component);
    });
  }

  private openHomeBuiltInBasePicker(component: HomeComponentId): void {
    if (!this.editMode) return;
    const settingKey = this.getHomeBuiltInBasePathSettingKey(component);
    if (!settingKey) return;

    const componentId = this.getHomeComponentKey(component);
    const title = this.getComponentDefinition(componentId)?.title || componentId;
    const picker = new FileSuggestModal(this.app, async (file) => {
      if (!this.editMode || file.extension !== 'base') return;
      const componentStillPresent = this.getHomeComponents()
        .some((candidate) => this.getHomeComponentKey(candidate) === componentId);
      if (!componentStillPresent) return;

      const selectedPath = this.normalizeHomeBasePath(file.path);
      if (!selectedPath) return;
      const scrollTop = this.contentEl.scrollTop;
      let result: 'applied' | 'superseded';
      try {
        result = await this.homeBaseSettingWriter.write(settingKey, selectedPath, {
          get: () => this.plugin.settings[settingKey],
          set: (path) => {
            this.plugin.settings[settingKey] = path;
          },
          persist: () => this.plugin.saveSettings(),
        });
      } catch (error) {
        const componentRemainsPresent = this.editMode && this.getHomeComponents()
          .some((candidate) => this.getHomeComponentKey(candidate) === componentId);
        if (componentRemainsPresent) {
          await this.render();
          this.restoreHomeBuiltInBasePickerFocus(componentId, scrollTop);
        }
        throw error;
      }
      if (result !== 'applied') return;
      if (!this.editMode) return;
      const componentRemainsPresent = this.getHomeComponents()
        .some((candidate) => this.getHomeComponentKey(candidate) === componentId);
      if (!componentRemainsPresent) return;
      logger.flow('HomeView', 'component-base:changed', {
        componentId,
        basePath: selectedPath,
      });
      await this.render();
      this.restoreHomeBuiltInBasePickerFocus(componentId, scrollTop);
    }, { extensions: ['base'], caseSensitiveExtensions: true });
    picker.setPlaceholder(`Choose Base for ${title}`);
    picker.open();
  }

  private restoreHomeBuiltInBasePickerFocus(componentId: string, scrollTop: number): void {
    this.contentEl.scrollTop = scrollTop;
    const panel = Array.from(
      this.rootEl?.querySelectorAll<HTMLElement>('.tps-home-panel') ?? [],
    ).find((candidate) => candidate.dataset.tpsHomeComponentKey === componentId);
    panel
      ?.querySelector<HTMLButtonElement>('.tps-home-component-base-button')
      ?.focus({ preventScroll: true });
    this.contentEl.scrollTop = scrollTop;
  }

  private openHomeComponentBaseContextMenu(
    event: MouseEvent,
    panel: HTMLElement,
    component: HomeComponentId,
  ): void {
    if (event.defaultPrevented) return;
    const configuredPath = this.getHomeComponentBasePath(component);
    const basePath = String(panel.dataset.tpsBasePath || configuredPath || '').trim();
    if (!basePath) return;

    const baseFile = this.resolveHomeComponentBaseFile(basePath);
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle(baseFile ? 'Open Base' : 'Open Base (not found)');
      item.setIcon('database');
      item.setDisabled(!baseFile);
      if (baseFile) {
        item.onClick(() => void this.openHomeComponentBase(
          this.getHomeComponentKey(component),
          baseFile.path,
        ));
      }
    });
    menu.showAtPosition({ x: event.clientX, y: event.clientY });
    logger.flow('HomeView', 'component-base:menu-open', {
      componentId: this.getHomeComponentKey(component),
      basePath,
      found: baseFile !== null,
    });
  }

  private resolveHomeComponentBaseFile(path: string): TFile | null {
    const normalized = normalizePath(String(path || '').trim()).replace(/^\/+/, '');
    if (!normalized) return null;
    const withExtension = normalized.toLowerCase().endsWith('.base') ? normalized : `${normalized}.base`;
    const file = this.app.vault.getAbstractFileByPath(withExtension);
    return file instanceof TFile && file.extension === 'base' ? file : null;
  }

  private async openHomeComponentBase(componentId: string, path: string): Promise<void> {
    const baseFile = this.resolveHomeComponentBaseFile(path);
    if (!baseFile) {
      logger.flowWarn('HomeView', 'component-base:open-missing', { componentId, basePath: path });
      new Notice('This Home component Base could not be found.');
      return;
    }
    const opened = await this.plugin.openFileInLeaf(
      baseFile,
      'tab',
      () => this.app.workspace.getLeaf('tab'),
      { revealLeaf: true },
    );
    logger.flow('HomeView', 'component-base:open-done', {
      componentId,
      basePath: baseFile.path,
      opened,
    });
    if (!opened) new Notice(`Could not open ${baseFile.name}.`);
  }

  private renderHomeComponentActions(heading: HTMLElement, component: HomeComponentId): void {
    const configured = this.getHomeComponentActions(component);
    if (!this.editMode && configured.length === 0) return;
    const host = heading.createDiv({ cls: 'tps-home-panel-actions' });
    for (const [index, action] of configured.entries()) {
      const command = this.getCommand(action.commandId);
      const label = action.label || command?.name || action.commandId;
      const button = host.createEl('button', {
        cls: `tps-home-panel-action tps-home-configured-action${this.editMode ? ' is-editing' : ''}`,
        attr: {
          type: 'button',
          title: this.editMode ? `Configure ${label}` : label,
          'aria-label': this.editMode ? `Configure ${label}` : label,
        },
      });
      const icon = button.createSpan({ cls: 'tps-home-panel-action-icon' });
      setIcon(icon, action.icon || 'play');
      button.createSpan({ cls: 'tps-home-panel-action-label', text: label });
      if (this.editMode) {
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.showHomeActionEditMenu(button, component, action, index);
        });
      } else {
        const available = this.plugin.homeComponentActionService.canExecute(action);
        button.disabled = !available;
        if (!available) button.setAttr('title', `${label} is unavailable`);
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (button.disabled) return;
          button.disabled = true;
          void this.runHomeComponentAction(component, action).finally(() => {
            if (button.isConnected) button.disabled = !this.plugin.homeComponentActionService.canExecute(action);
          });
        });
      }
    }
    if (this.editMode) {
      const add = this.createIconButton(host, 'plus', 'Add command to this component', () => {
        this.showHomeActionCommandPicker(component);
      });
      add.addClass('tps-home-action-add-button');
    }
  }

  private async runHomeComponentAction(component: HomeComponentId, action: HomeComponentAction): Promise<void> {
    try {
      const context = await this.buildHomeActionContext(component);
      await this.plugin.homeComponentActionService.execute(action, context);
    } catch (error) {
      logger.flowError('HomeView', 'component-action:context-failed', error, {
        commandId: action.commandId,
        componentId: this.getHomeComponentKey(component),
      });
      new Notice(error instanceof Error ? error.message : 'Could not resolve the selected Home Daily Note.', 10000);
    }
  }

  private async buildHomeActionContext(component: HomeComponentId): Promise<HomeActionContext> {
    const selected = this.getSelectedDate();
    const dailyNote = this.getBackedDailyNoteFile()
      ?? await this.plugin.homeCaptureService.getDailyNoteForCapture(selected.clone());
    const componentId = this.getHomeComponentKey(component);
    const basePath = this.getHomeComponentBasePath(component);
    return {
      source: 'tps-home',
      dateIso: selected.format('YYYY-MM-DD'),
      dailyNotePath: dailyNote.path,
      componentId,
      ...(basePath ? { basePath } : {}),
    };
  }

  private getHomeComponentBasePath(component: HomeComponentId): string | undefined {
    if (this.isHomeBaseComponent(component)) return component.path;
    const settingKey = this.getHomeBuiltInBasePathSettingKey(component);
    return settingKey ? this.plugin.settings[settingKey] : undefined;
  }

  private getHomeBuiltInBasePathSettingKey(component: HomeComponentId): HomeBuiltInBasePathSettingKey | null {
    const componentId = this.getHomeComponentKey(component);
    if (componentId === 'calendar') return 'homeCalendarBasePath';
    if (componentId === 'food-tracker') return 'homeFoodBasePath';
    if (componentId === 'workout-tracker') return 'homeWorkoutBasePath';
    if (componentId === 'open-unscheduled-tasks') return 'homeOpenTasksBasePath';
    return null;
  }

  private showHomeActionCommandPicker(
    component: HomeComponentId,
    replaceIndex: number | null = null,
  ): void {
    const commands = this.getCommands().sort((left, right) => left.name.localeCompare(right.name));
    new HomeActionCommandSuggestModal(this.app, commands, (command) => {
      void this.savePickedHomeAction(component, command, replaceIndex);
    }).open();
  }

  private async savePickedHomeAction(
    component: HomeComponentId,
    command: { id: string; name: string },
    replaceIndex: number | null,
  ): Promise<void> {
    const actions = this.getHomeComponentActions(component);
    const presentation = this.getDefaultHomeActionPresentation(command);
    if (replaceIndex != null && actions[replaceIndex]) {
      actions[replaceIndex] = {
        ...actions[replaceIndex],
        commandId: command.id,
        label: presentation.label,
        icon: presentation.icon,
      };
    } else {
      const baseId = command.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'command';
      const used = new Set(actions.map((action) => action.id.toLowerCase()));
      let id = baseId;
      let suffix = 2;
      while (used.has(id.toLowerCase())) id = `${baseId}-${suffix++}`;
      actions.push({
        id,
        commandId: command.id,
        label: presentation.label,
        icon: presentation.icon,
        target: 'home-note',
      });
    }
    await this.setHomeComponentActions(component, actions);
  }

  private getDefaultHomeActionPresentation(command: { id: string; name: string }): { label: string; icon: string } {
    if (command.id === 'tps-global-context-menu:capture-to-home-note') return { label: 'Capture', icon: 'send' };
    if (command.id === 'tps-global-context-menu:add-task-to-home-note') return { label: 'Add task', icon: 'list-checks' };
    if (command.id === 'tps-health:log-food') return { label: 'Log food', icon: 'apple' };
    if (command.id === 'tps-health:start-workout') return { label: 'Start workout', icon: 'play' };
    return { label: command.name, icon: 'terminal' };
  }

  private showHomeActionEditMenu(
    anchor: HTMLElement,
    component: HomeComponentId,
    action: HomeComponentAction,
    index: number,
  ): void {
    const actions = this.getHomeComponentActions(component);
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle(this.getCommand(action.commandId)?.name || action.commandId).setDisabled(true);
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle('Target selected Daily Note')
        .setIcon('file-input')
        .setChecked(action.target === 'home-note')
        .onClick(() => void this.setHomeActionTarget(component, index, 'home-note'));
    });
    menu.addItem((item) => {
      item
        .setTitle('Run normally in workspace')
        .setIcon('terminal')
        .setChecked(action.target === 'workspace')
        .onClick(() => void this.setHomeActionTarget(component, index, 'workspace'));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle('Change command').setIcon('replace').onClick(() => this.showHomeActionCommandPicker(component, index));
    });
    menu.addItem((item) => {
      item
        .setTitle('Move action left')
        .setIcon('arrow-left')
        .setDisabled(index <= 0)
        .onClick(() => void this.moveHomeAction(component, index, -1));
    });
    menu.addItem((item) => {
      item
        .setTitle('Move action right')
        .setIcon('arrow-right')
        .setDisabled(index >= actions.length - 1)
        .onClick(() => void this.moveHomeAction(component, index, 1));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle('Remove action').setIcon('trash-2').onClick(() => {
        const next = this.getHomeComponentActions(component);
        next.splice(index, 1);
        void this.setHomeComponentActions(component, next);
      });
    });
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }

  private async setHomeActionTarget(
    component: HomeComponentId,
    index: number,
    target: HomeComponentAction['target'],
  ): Promise<void> {
    const actions = this.getHomeComponentActions(component);
    if (!actions[index]) return;
    actions[index] = { ...actions[index], target };
    await this.setHomeComponentActions(component, actions);
  }

  private async moveHomeAction(component: HomeComponentId, index: number, delta: -1 | 1): Promise<void> {
    const actions = this.getHomeComponentActions(component);
    const nextIndex = index + delta;
    if (!actions[index] || nextIndex < 0 || nextIndex >= actions.length) return;
    [actions[index], actions[nextIndex]] = [actions[nextIndex], actions[index]];
    await this.setHomeComponentActions(component, actions);
  }

  private getHomeComponentActions(component: HomeComponentId): HomeComponentAction[] {
    const map = normalizeHomeComponentActions(this.plugin.settings.homeComponentActions);
    return [...(map[this.getHomeComponentKey(component).toLowerCase()] || [])];
  }

  private async setHomeComponentActions(component: HomeComponentId, actions: HomeComponentAction[]): Promise<void> {
    const key = this.getHomeComponentKey(component).toLowerCase();
    const map = normalizeHomeComponentActions(this.plugin.settings.homeComponentActions);
    const normalized = normalizeHomeComponentActions({ [key]: actions })[key] || [];
    if (normalized.length > 0) map[key] = normalized;
    else delete map[key];
    this.plugin.settings.homeComponentActions = map;
    await this.plugin.saveSettings();
    await this.render();
  }

  private setHomePanelFileLabel(panel: HTMLElement, filename: string): void {
    const heading = panel.querySelector<HTMLElement>('.tps-home-panel-heading');
    if (!heading) return;
    let label = heading.querySelector<HTMLElement>('.tps-home-panel-file');
    if (!label) label = heading.createEl('small', { cls: 'tps-home-panel-file' });
    label.setText(filename);
    label.setAttr('title', filename);
  }

  private finishComponentPanel(
    panel: HTMLElement,
    component: HomeComponentId,
    options: { capturePreview?: boolean } = {},
  ): void {
    if (!this.editMode) return;
    if (options.capturePreview) {
      const preview = panel.querySelector<HTMLElement>('.tps-home-capture-preview--home');
      if (preview) {
        this.createHomeResizeHandle(preview, 'Resize daily note preview', 'horizontal', (event) => {
          this.startHomeComponentResize(event, component, preview, 'capturePreviewHeight');
        });
      }
    }
    this.createHomeResizeHandle(panel, 'Resize Home component height', 'corner', (event) => {
      this.startHomeComponentResize(event, component, panel, 'height');
    });
  }

  private createHomeResizeHandle(
    parent: HTMLElement,
    label: string,
    variant: 'corner' | 'horizontal',
    onPointerDown: (event: PointerEvent) => void,
  ): HTMLElement {
    const handle = parent.createDiv({ cls: `tps-home-resize-handle tps-home-resize-handle--${variant}` });
    handle.setAttr('role', 'separator');
    handle.setAttr('aria-label', label);
    handle.setAttr('title', label);
    handle.tabIndex = 0;
    setIcon(handle, variant === 'corner' ? 'grip' : 'grip-horizontal');
    handle.addEventListener('pointerdown', onPointerDown);
    return handle;
  }

  private startHomeComponentResize(
    event: PointerEvent,
    component: HomeComponentId,
    target: HTMLElement,
    field: 'height' | 'capturePreviewHeight',
  ): void {
    if (!this.editMode) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    handle?.setPointerCapture?.(event.pointerId);
    const componentKey = this.getHomeComponentKey(component);
    const startY = event.clientY;
    const startHeight = target.getBoundingClientRect().height;
    const min = field === 'height' ? HOME_PANEL_MIN_HEIGHT : HOME_CAPTURE_PREVIEW_MIN_HEIGHT;
    const max = field === 'height' ? HOME_PANEL_MAX_HEIGHT : HOME_CAPTURE_PREVIEW_MAX_HEIGHT;
    let latest = this.clampHomeLayoutValue(startHeight, min, max);

    const apply = (value: number) => {
      latest = this.clampHomeLayoutValue(value, min, max);
      this.setHomeComponentLayoutField(componentKey, field, latest);
      if (field === 'height') {
        this.applyHomeComponentLayout(target, componentKey);
      } else {
        const panel = target.closest<HTMLElement>('.tps-home-panel');
        if (panel) this.applyHomeCapturePreviewLayout(panel, component);
      }
      window.dispatchEvent(new Event('resize'));
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      apply(startHeight + moveEvent.clientY - startY);
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      this.setHomeComponentLayoutField(componentKey, field, latest);
      void this.plugin.saveSettings();
    };

    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true, once: true });
    window.addEventListener('pointercancel', onPointerUp, { capture: true, once: true });
  }

  private applyHomeComponentLayout(panel: HTMLElement, componentKey: string): void {
    const layout = this.getHomeComponentLayout(componentKey);
    panel.toggleClass('tps-home-panel--wide', layout.span === 2);
    panel.toggleClass('tps-home-panel--custom-height', layout.height != null);
    panel.toggleClass('tps-home-panel--custom-preview-height', layout.capturePreviewHeight != null);
    if (layout.height != null) {
      panel.style.setProperty('--tps-home-panel-height', `${layout.height}px`);
    } else {
      panel.style.removeProperty('--tps-home-panel-height');
    }
  }

  private applyHomeCapturePreviewLayout(panel: HTMLElement, component: HomeComponentId): void {
    const layout = this.getHomeComponentLayout(this.getHomeComponentKey(component));
    const preview = panel.querySelector<HTMLElement>('.tps-home-capture-preview--home');
    if (!preview) return;
    panel.toggleClass('tps-home-panel--custom-preview-height', layout.capturePreviewHeight != null);
    if (layout.capturePreviewHeight != null) {
      preview.style.setProperty('--tps-home-capture-preview-height', `${layout.capturePreviewHeight}px`);
    } else {
      preview.style.removeProperty('--tps-home-capture-preview-height');
    }
  }

  private async toggleHomeComponentSpan(component: HomeComponentId): Promise<void> {
    if (!this.editMode) return;
    const key = this.getHomeComponentKey(component);
    const layout = this.getHomeComponentLayout(key);
    this.setHomeComponentLayoutField(key, 'span', layout.span === 2 ? undefined : 2);
    await this.plugin.saveSettings();
    await this.render();
  }

  private async resetHomeComponentLayout(component: HomeComponentId): Promise<void> {
    if (!this.editMode) return;
    const key = this.getHomeComponentKey(component);
    const layouts = { ...(this.plugin.settings.homeComponentLayouts || {}) };
    delete layouts[key];
    this.plugin.settings.homeComponentLayouts = layouts;
    await this.plugin.saveSettings();
    await this.render();
  }

  private getHomeComponentLayout(componentKey: string): HomeComponentLayout {
    return this.normalizeHomeComponentLayout(this.plugin.settings.homeComponentLayouts?.[componentKey]);
  }

  private setHomeComponentLayoutField<K extends keyof HomeComponentLayout>(
    componentKey: string,
    field: K,
    value: HomeComponentLayout[K] | undefined,
  ): void {
    const layouts = { ...(this.plugin.settings.homeComponentLayouts || {}) };
    const current = this.normalizeHomeComponentLayout(layouts[componentKey]);
    if (value == null || value === 1) {
      delete current[field];
    } else {
      (current as Record<string, unknown>)[field] = value;
    }
    if (Object.keys(current).length > 0) {
      layouts[componentKey] = current;
    } else {
      delete layouts[componentKey];
    }
    this.plugin.settings.homeComponentLayouts = layouts;
  }

  private normalizeHomeComponentLayout(value: unknown): HomeComponentLayout {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const source = value as Record<string, unknown>;
    const height = this.normalizeHomeLayoutNumber(source.height, HOME_PANEL_MIN_HEIGHT, HOME_PANEL_MAX_HEIGHT);
    const capturePreviewHeight = this.normalizeHomeLayoutNumber(
      source.capturePreviewHeight,
      HOME_CAPTURE_PREVIEW_MIN_HEIGHT,
      HOME_CAPTURE_PREVIEW_MAX_HEIGHT,
    );
    return {
      ...(height != null ? { height } : {}),
      ...(Number(source.span) === 2 ? { span: 2 as const } : {}),
      ...(capturePreviewHeight != null ? { capturePreviewHeight } : {}),
    };
  }

  private normalizeHomeLayoutNumber(value: unknown, min: number, max: number): number | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return this.clampHomeLayoutValue(parsed, min, max);
  }

  private clampHomeLayoutValue(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)));
  }

  private createIconButton(parent: HTMLElement, icon: string, label: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
    const button = parent.createEl('button', {
      cls: 'tps-home-icon-button',
      attr: { 'aria-label': label, title: label, type: 'button' },
    });
    setIcon(button, icon);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onClick(event);
    });
    return button;
  }

  private showAddComponentMenu(anchor: HTMLElement, fallbackX: number, fallbackY: number): void {
    if (!this.editMode) return;
    const active = new Set(this.getHomeComponents().map((component) => this.getHomeComponentKey(component)));
    const missing = HOME_COMPONENTS.filter((component) => !active.has(component.id));
    const baseFiles = this.app.vault.getFiles()
      .filter((file) => file.extension === 'base' && !active.has(this.getHomeBaseComponentKey(file.path)))
      .sort((a, b) => a.path.localeCompare(b.path));
    const commands = this.getCommands()
      .filter((command) => !active.has(this.getHomeCommandComponentKey(command.id)))
      .sort((a, b) => a.name.localeCompare(b.name));
    const menu = new Menu();
    if (missing.length === 0 && baseFiles.length === 0 && commands.length === 0) {
      menu.addItem((item) => {
        item.setTitle('All components are visible').setDisabled(true);
      });
    } else {
      for (const component of missing) {
        menu.addItem((item) => {
          item
            .setTitle(component.title)
            .setIcon(component.icon)
            .onClick(() => void this.addComponent(component.id));
        });
      }
      if (missing.length > 0 && baseFiles.length > 0) menu.addSeparator();
      for (const file of baseFiles) {
        menu.addItem((item) => {
          item
            .setTitle(file.basename)
            .setIcon('table')
            .onClick(() => void this.addComponent({ type: 'base', path: file.path }));
        });
      }
      if ((missing.length > 0 || baseFiles.length > 0) && commands.length > 0) menu.addSeparator();
      for (const command of commands) {
        menu.addItem((item) => {
          item
            .setTitle(command.name)
            .setIcon('terminal')
            .onClick(() => void this.addComponent({ type: 'command', commandId: command.id, title: command.name }));
        });
      }
    }
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle('Reset Home layout')
        .setIcon('rotate-ccw')
        .onClick(() => void this.resetHomeLayout());
    });
    const rect = anchor.getBoundingClientRect();
    window.setTimeout(() => {
      if (!this.editMode || !anchor.isConnected) return;
      menu.showAtPosition({
        x: rect.left || fallbackX,
        y: (rect.bottom || fallbackY) + 4,
      });
    }, 120);
  }

  private async addComponent(componentId: HomeComponentId): Promise<void> {
    if (!this.editMode) return;
    const components = this.getHomeComponents();
    const key = this.getHomeComponentKey(componentId);
    if (components.some((component) => this.getHomeComponentKey(component) === key)) return;
    await this.setHomeComponents([...components, componentId]);
  }

  private async removeComponent(componentId: HomeComponentId): Promise<void> {
    if (!this.editMode) return;
    const key = this.getHomeComponentKey(componentId);
    const next = this.getHomeComponents().filter((existing) => this.getHomeComponentKey(existing) !== key);
    await this.setHomeComponents(next.length ? next : [
      { type: 'base', path: HOME_DAILY_NOTE_FEED_BASE_PATH },
    ]);
  }

  private async moveComponent(componentId: HomeComponentId, delta: -1 | 1): Promise<void> {
    if (!this.editMode) return;
    const components = this.getHomeComponents();
    const key = this.getHomeComponentKey(componentId);
    const index = components.findIndex((component) => this.getHomeComponentKey(component) === key);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= components.length) return;
    const next = [...components];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    await this.setHomeComponents(next);
  }

  private async setHomeComponents(components: HomeComponentId[]): Promise<void> {
    const normalized = this.normalizeHomeComponents(components);
    this.plugin.settings.homeComponents = normalized;
    this.pruneHomeComponentLayouts(normalized);
    await this.plugin.saveSettings();
    await this.render();
  }

  private async resetHomeLayout(): Promise<void> {
    if (!this.editMode) return;
    this.plugin.settings.homeComponents = DEFAULT_SETTINGS.homeComponents.map((component) => (
      typeof component === 'string' ? component : { ...component }
    ));
    this.plugin.settings.homeComponentLayouts = {};
    this.plugin.settings.homeComponentActions = normalizeHomeComponentActions(DEFAULT_SETTINGS.homeComponentActions);
    await this.plugin.saveSettings();
    await this.render();
  }

  private pruneHomeComponentLayouts(components: HomeComponentId[]): void {
    const allowed = new Set(components.map((component) => this.getHomeComponentKey(component)));
    const current = this.plugin.settings.homeComponentLayouts || {};
    this.plugin.settings.homeComponentLayouts = Object.fromEntries(
      Object.entries(current).filter(([key]) => allowed.has(key)),
    );
    const actions = normalizeHomeComponentActions(this.plugin.settings.homeComponentActions);
    this.plugin.settings.homeComponentActions = Object.fromEntries(
      Object.entries(actions).filter(([key]) => allowed.has(key)),
    );
  }

  private getHomeComponents(): HomeComponentId[] {
    return this.normalizeHomeComponents(this.plugin.settings.homeComponents);
  }

  private normalizeHomeComponents(components: unknown): HomeComponentId[] {
    const seen = new Set<string>();
    const source = Array.isArray(components) && components.length > 0
      ? components
      : DEFAULT_SETTINGS.homeComponents;
    const normalized: HomeComponentId[] = [];
    for (const value of source) {
      const component = this.normalizeHomeComponent(value);
      if (!component) continue;
      const key = this.getHomeComponentKey(component);
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(component);
    }
    return normalized.length ? normalized : [{ type: 'base', path: HOME_DAILY_NOTE_FEED_BASE_PATH }];
  }

  private normalizeHomeComponent(value: unknown): HomeComponentId | null {
    const allowed = new Set(HOME_COMPONENTS.map((component) => component.id));
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === 'quick-capture') return { type: 'base', path: HOME_DAILY_NOTE_FEED_BASE_PATH };
      if (allowed.has(trimmed as HomeBuiltInComponentId)) return trimmed as HomeBuiltInComponentId;
      if (trimmed.toLowerCase().endsWith('.base')) return { type: 'base', path: normalizePath(trimmed).replace(/^\/+/, '') };
      return null;
    }
    if (this.isHomeBaseComponent(value)) {
      const path = normalizePath(String(value.path || '').trim()).replace(/^\/+/, '');
      return path ? { type: 'base', path } : null;
    }
    if (this.isHomeCommandComponent(value)) {
      const commandId = String(value.commandId || '').trim();
      if (!commandId) return null;
      const title = String(value.title || '').trim();
      const icon = String(value.icon || '').trim();
      return {
        type: 'command',
        commandId,
        ...(title ? { title } : {}),
        ...(icon ? { icon } : {}),
      };
    }
    return null;
  }

  private isHomeBaseComponent(value: unknown): value is HomeBaseComponent {
    return !!value && typeof value === 'object' && (value as HomeBaseComponent).type === 'base';
  }

  private isHomeCommandComponent(value: unknown): value is HomeCommandComponent {
    return !!value && typeof value === 'object' && (value as HomeCommandComponent).type === 'command';
  }

  private getHomeComponentKey(component: HomeComponentId): string {
    if (this.isHomeBaseComponent(component)) return this.getHomeBaseComponentKey(component.path);
    if (this.isHomeCommandComponent(component)) return this.getHomeCommandComponentKey(component.commandId);
    return component;
  }

  private getHomeBaseComponentKey(path: string): string {
    const normalized = normalizePath(String(path || '').trim()).replace(/^\/+/, '');
    return `base:${normalized.toLowerCase()}`;
  }

  private getHomeCommandComponentKey(commandId: string): string {
    return `command:${String(commandId || '').trim().toLowerCase()}`;
  }

  private getComponentDefinition(componentId: string): typeof HOME_COMPONENTS[number] | undefined {
    return HOME_COMPONENTS.find((component) => component.id === componentId);
  }

  private getComponentTitle(component: HomeComponentId, componentId: string): string {
    if (this.isHomeCommandComponent(component)) {
      return this.getCommand(component.commandId)?.name || component.title || component.commandId;
    }
    if (this.isHomeBaseComponent(component)) {
      const name = normalizePath(component.path).split('/').pop() || component.path;
      return name.replace(/\.base$/i, '') || componentId;
    }
    return componentId;
  }

  private getCommands(): Array<{ id: string; name: string }> {
    const commands = (this.app as any).commands;
    const listed = typeof commands?.listCommands === 'function'
      ? commands.listCommands()
      : Object.values(commands?.commands || {});
    if (!Array.isArray(listed)) return [];
    return listed
      .map((command: any) => ({
        id: String(command?.id || '').trim(),
        name: String(command?.name || command?.id || '').trim(),
      }))
      .filter((command) => command.id && command.name);
  }

  private getCommand(commandId: string): { id: string; name: string } | null {
    const id = String(commandId || '').trim();
    if (!id) return null;
    return this.getCommands().find((command) => command.id === id) || null;
  }

  private async runCommand(commandId: string): Promise<void> {
    const id = String(commandId || '').trim();
    const commands = (this.app as any).commands;
    if (!id || typeof commands?.executeCommandById !== 'function') return;
    await commands.executeCommandById(id);
  }

  private getHomeCalendarBaseFile(): TFile | null {
    return this.getBaseFileFromSetting(this.plugin.settings.homeCalendarBasePath);
  }

  private async getHomeFoodBaseFile(): Promise<TFile | null> {
    const configuredPath = this.plugin.settings.homeFoodBasePath;
    const configuredFile = this.getBaseFileFromSetting(configuredPath);
    if (configuredFile) return configuredFile;
    if (!this.isCanonicalHomeBasePath(configuredPath, DEFAULT_SETTINGS.homeFoodBasePath)) return null;
    return await this.ensureDefaultFoodLogBaseFile();
  }

  private async getHomeWorkoutBaseFile(): Promise<TFile | null> {
    const configuredPath = this.plugin.settings.homeWorkoutBasePath;
    const configuredFile = this.getBaseFileFromSetting(configuredPath);
    if (configuredFile) return configuredFile;
    if (!this.isCanonicalHomeBasePath(configuredPath, DEFAULT_SETTINGS.homeWorkoutBasePath)) return null;
    return await this.ensureDefaultWorkoutLogBaseFile();
  }

  private getHomeOpenTasksBaseFile(): TFile | null {
    return this.getBaseFileFromSetting(this.plugin.settings.homeOpenTasksBasePath);
  }

  private getBaseFileFromSetting(path: string | undefined): TFile | null {
    const normalized = this.normalizeHomeBasePath(path);
    if (!normalized) return null;
    const file = this.app.vault.getAbstractFileByPath(normalized);
    return file instanceof TFile && file.extension === 'base' ? file : null;
  }

  private isCanonicalHomeBasePath(path: string | undefined, canonicalPath: string): boolean {
    const configured = this.normalizeHomeBasePath(path);
    const canonical = this.normalizeHomeBasePath(canonicalPath);
    return Boolean(configured) && configured === canonical;
  }

  private normalizeHomeBasePath(path: string | undefined): string {
    const rawPath = String(path || '').trim();
    if (!rawPath) return '';
    const normalized = normalizePath(rawPath).replace(/^\/+/, '');
    if (!normalized) return '';
    return normalized.toLowerCase().endsWith('.base') ? normalized : `${normalized}.base`;
  }

  private getCalendarPlugin(): any {
    const plugins = (this.app as any).plugins;
    const direct = (
      plugins?.getPlugin?.('tps-calendar-base')
      || plugins?.plugins?.['tps-calendar-base']
      || plugins?.getPlugin?.('TPS-Calendar-Base (Dev)')
      || plugins?.plugins?.['TPS-Calendar-Base (Dev)']
      || null
    );
    if (direct) return direct;

    const loadedPlugins = plugins?.plugins && typeof plugins.plugins === 'object'
      ? Object.values(plugins.plugins)
      : [];
    return loadedPlugins.find((plugin: any) => {
      const manifestId = String(plugin?.manifest?.id || '').trim();
      return manifestId === 'tps-calendar-base'
        || typeof plugin?.api?.renderBaseCalendarEmbed === 'function'
        || typeof plugin?.renderBaseCalendarEmbed === 'function';
    }) || null;
  }

  private async ensureDefaultFoodLogBaseFile(): Promise<TFile | null> {
    const healthApi = this.getHealthApi();
    if (typeof healthApi?.ensureFoodLogBase !== 'function') return null;

    try {
      const path = normalizePath(String(await healthApi.ensureFoodLogBase() || '').trim()).replace(/^\/+/, '');
      const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
      return file instanceof TFile && file.extension === 'base' ? file : null;
    } catch (error) {
      logger.flowError('HomeView', 'ensure-food-log-base-failed', error);
      return null;
    }
  }

  private async ensureHomeDailyNoteFeedBaseFile(): Promise<TFile | null> {
    const existing = this.app.vault.getAbstractFileByPath(HOME_DAILY_NOTE_FEED_BASE_PATH);
    if (existing instanceof TFile && existing.extension === 'base') return existing;
    if (existing) {
      logger.flowWarn('HomeView', 'daily-note-feed:path-not-file', { path: HOME_DAILY_NOTE_FEED_BASE_PATH });
      return null;
    }
    try {
      const created = await this.app.vault.create(HOME_DAILY_NOTE_FEED_BASE_PATH, HOME_DAILY_NOTE_FEED_BASE_CONTENT);
      logger.flow('HomeView', 'daily-note-feed:created', { path: created.path });
      return created instanceof TFile ? created : null;
    } catch (error) {
      logger.flowError('HomeView', 'daily-note-feed:create-failed', error, { path: HOME_DAILY_NOTE_FEED_BASE_PATH });
      return null;
    }
  }

  private async ensureDefaultWorkoutLogBaseFile(): Promise<TFile | null> {
    const healthApi = this.getHealthApi();
    const ensureActivityLogBase = healthApi?.ensureActivityLogBase || healthApi?.ensureWorkoutLogBase;
    if (typeof ensureActivityLogBase !== 'function') return null;

    try {
      const path = normalizePath(String(await ensureActivityLogBase.call(healthApi) || '').trim()).replace(/^\/+/, '');
      const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
      return file instanceof TFile && file.extension === 'base' ? file : null;
    } catch (error) {
      logger.flowError('HomeView', 'ensure-activity-log-base-failed', error);
      return null;
    }
  }

  private getHealthApi(): TPSHealthApiLike | null {
    const appAny = this.app as any;
    const healthPlugin = this.getHealthPlugin();
    return appAny.tpsHealth || healthPlugin?.api || healthPlugin || null;
  }

  private getHealthPlugin(): TPSHealthPluginLike | null {
    const plugins = (this.app as any).plugins;
    const direct = (
      plugins?.getPlugin?.('tps-health')
      || plugins?.plugins?.['tps-health']
      || plugins?.getPlugin?.('TPS-health (Dev)')
      || plugins?.plugins?.['TPS-health (Dev)']
      || null
    );
    if (direct) return direct;

    const loadedPlugins = plugins?.plugins && typeof plugins.plugins === 'object'
      ? Object.values(plugins.plugins)
      : [];
    return loadedPlugins.find((plugin: any) => {
      const manifestId = String(plugin?.manifest?.id || '').trim();
      return manifestId === 'tps-health'
        || typeof plugin?.openFoodLogger === 'function'
        || typeof plugin?.api?.ensureFoodLogBase === 'function';
    }) as TPSHealthPluginLike || null;
  }

  private async unloadEmbeds(): Promise<void> {
    const captureView = this.homeCaptureMarkdownView;
    this.homeCaptureMarkdownView = null;
    const captureSession = this.homeCaptureEditorSession;
    if (captureSession?.view === captureView) {
      captureSession.accepting = false;
      this.homeCaptureEditorSession = null;
    }
    if (captureView) await this.closeHomeCaptureMarkdownView(captureView);
    for (const cleanup of this.homePanelCleanups.splice(0)) cleanup();
    for (const component of this.embedComponents.splice(0)) {
      try {
        component.unload();
      } catch (error) {
        logger.flowError('HomeView', 'unload-embedded-component-failed', error);
      }
    }
  }

  private async closeHomeCaptureMarkdownView(view: MarkdownView): Promise<void> {
    if (this.homeCaptureSkipSaveViews.has(view)) {
      this.homeCaptureSkipSaveViews.delete(view);
      view.containerEl.remove();
      try {
        view.unload();
      } catch (error) {
        logger.flowError('HomeView', 'quick-capture:editor-discard-unload-failed', error, {
          target: view.file?.path || null,
        });
      }
      return;
    }
    try {
      await view.save();
      const close = (view as MarkdownView & { close?: () => Promise<void> }).close;
      if (typeof close === 'function') {
        await close.call(view);
      } else {
        view.containerEl.remove();
        view.unload();
      }
    } catch (error) {
      logger.flowError('HomeView', 'quick-capture:editor-unload-failed', error, {
        target: view.file?.path || null,
      });
      view.containerEl.remove();
      try {
        view.unload();
      } catch {
        // Best-effort fallback after the native editor already failed to close.
      }
    }
  }

  private scheduleCalendarEmbedResize(host: HTMLElement): void {
    const sync = () => {
      if (!host.isConnected) return;
      window.dispatchEvent(new Event('resize'));
    };
    window.requestAnimationFrame(sync);
    window.setTimeout(sync, 150);
    window.setTimeout(sync, 600);
  }

  private scheduleHomeCalendarScrollToNow(calendarComponent: any, date: any): void {
    if (typeof calendarComponent?.scrollToNow !== 'function') return;
    if (!this.isSelectedHomeDateToday(date)) return;

    const scroll = () => {
      try {
        calendarComponent.scrollToNow();
      } catch (error) {
        logger.flowError('HomeView', 'calendar-scroll-to-now-failed', error);
      }
    };

    window.requestAnimationFrame(scroll);
    window.setTimeout(scroll, 150);
    window.setTimeout(scroll, 650);
  }

  private isSelectedHomeDateToday(date: any): boolean {
    const moment = getMoment();
    const selected = date?.clone ? date.clone() : moment(date);
    return selected.isSame(moment(), 'day');
  }

}

type HomeCaptureTriggerChoice = 'describe' | 'capture' | 'cancel';

class HomeCaptureTriggerModal extends Modal {
  private resolveChoice: ((choice: HomeCaptureTriggerChoice) => void) | null = null;
  private settled = false;

  constructor(app: TpsHomeView['app'], private readonly trigger: HomeCaptureTrigger, private readonly value: string) {
    super(app);
  }

  choose(): Promise<HomeCaptureTriggerChoice> {
    return new Promise((resolve) => {
      this.resolveChoice = resolve;
      this.open();
    });
  }

  onOpen(): void {
    this.modalEl.addClass('mod-tps-gcm', 'tps-home-trigger-modal', 'tps-keyboard-aware-modal');
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: 'Food trigger found' });
    this.contentEl.createEl('p', { text: `Quick Capture found ${this.trigger.label}. Send this text to Describe food?` });
    this.contentEl.createEl('blockquote', { text: this.trigger.clean(this.value) || this.value });
    const actions = this.contentEl.createDiv({ cls: 'tps-home-trigger-actions' });
    const describe = actions.createEl('button', { text: 'Describe food', cls: 'mod-cta', attr: { type: 'button' } });
    describe.addEventListener('click', () => this.finish('describe'));
    const capture = actions.createEl('button', { text: 'Keep as capture', attr: { type: 'button' } });
    capture.addEventListener('click', () => this.finish('capture'));
    const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
    cancel.addEventListener('click', () => this.finish('cancel'));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) this.settle('cancel');
  }

  private finish(choice: HomeCaptureTriggerChoice): void {
    this.settle(choice);
    this.close();
  }

  private settle(choice: HomeCaptureTriggerChoice): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveChoice?.(choice);
    this.resolveChoice = null;
  }
}

class HomeActionCommandSuggestModal extends FuzzySuggestModal<{ id: string; name: string }> {
  constructor(
    app: TpsHomeView['app'],
    private readonly commands: Array<{ id: string; name: string }>,
    private readonly onChoose: (command: { id: string; name: string }) => void,
  ) {
    super(app);
    this.setPlaceholder('Choose a command for this Home component');
  }

  getItems(): Array<{ id: string; name: string }> {
    return this.commands;
  }

  getItemText(command: { id: string; name: string }): string {
    return `${command.name} ${command.id}`;
  }

  onChooseItem(command: { id: string; name: string }): void {
    this.onChoose(command);
  }
}
