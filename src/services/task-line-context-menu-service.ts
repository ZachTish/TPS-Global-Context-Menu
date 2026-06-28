import { App, Menu, Modal, Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { FileSuggestModal } from '../modals/FileSuggestModal';
import { RecurrenceModal } from '../modals/recurrence-modal';
import { ScheduledModal } from '../modals/scheduled-modal';
import { TextInputModal } from '../modals/text-input-modal';
import type { CustomProperty, LinkedSubitemCheckboxMapping } from '../types';
import {
  buildDailyNoteScratchpadMovedTaskBlock,
  findCurrentTaskLineIndex,
  insertTaskBlockAfterFrontmatter,
  removeTaskBlockFromContent,
  replaceTaskBlockInContent,
} from '../utils/task-block-move';
import { getEffectivePropertyOptions } from '../utils/property-options';
import {
  addInlineTagToTaskLine,
  getTaskDisplayTitle,
  parseTaskLine,
  readInlineFieldValue,
  readInlineTags,
  removeInlineTagFromTaskLine,
  setInlineFieldValueOnTaskLine,
  setTaskCheckboxToken,
  setTaskTitle,
  updateTaskCompletedDateForCheckboxState,
  updateTaskLineTimestamps,
} from '../utils/task-line-metadata';
import {
  getInheritedDailyNoteTaskScheduledValue,
  getIsoDateFromScheduledValue,
  parseDailyNoteFileDate,
  resolveTaskScheduledValue,
} from '../utils/daily-note-task-schedule';
import { getLinkedSubitemCompleteMarkers, mapSubitemCheckboxStateToStatus, normalizeLinkedSubitemMappings } from '../utils/linked-subitem-mapping';

export type TaskLineContext = {
  file: TFile;
  lineNumber: number;
  lineIndex: number;
  rawLine: string;
  title: string;
  checkboxToken: string;
  taskOrdinal?: number;
  isCalendarTask: boolean;
  calendarAllDay: boolean;
};

type TaskLineHighlightKind = 'active' | 'selected';

const KANBAN_TASK_SELECTOR = [
  '[data-tps-gcm-context="kanban-task"]',
  '[data-tps-gcm-context="calendar-task"]',
  '.tps-kanban-card-task[data-task-path][data-task-line]',
  '.tps-kanban-task-card[data-task-path][data-task-line]',
  '.tps-calendar-task-entry[data-task-path][data-task-line]',
  '.task-list-item',
  'input.task-list-item-checkbox',
  '[data-task]',
  'input[type="checkbox"]',
].join(', ');

export class TaskLineContextMenuService {
  private selectedTaskContexts = new Map<string, TaskLineContext>();
  private activeHighlightEls = new Set<HTMLElement>();
  private selectedHighlightEls = new Set<HTMLElement>();

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  handleContextMenu(evt: MouseEvent): boolean {
    const target = evt.target instanceof HTMLElement ? evt.target : null;
    const pointTaskEl = this.resolveTaskElementAtPoint(evt);
    const taskEl = pointTaskEl || this.resolveTaskElement(target);
    if (!taskEl) return false;

    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();

    void this.resolveContext(taskEl, target || pointTaskEl, { x: evt.clientX, y: evt.clientY }).then((context) => {
      if (!context) {
        new Notice('Could not resolve the task line.');
        return;
      }
      this.showMenu(context, taskEl, evt.pageX, evt.pageY);
    });
    return true;
  }

  handleClick(evt: MouseEvent): boolean {
    if (!evt.metaKey && !evt.ctrlKey) return false;
    const target = evt.target instanceof HTMLElement ? evt.target : null;
    if (target?.matches('input.task-list-item-checkbox, input[type="checkbox"]')) return false;
    const pointTaskEl = this.resolveTaskElementAtPoint(evt);
    const taskEl = pointTaskEl || this.resolveTaskElement(target);
    if (!taskEl) return false;

    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();

    void this.resolveContext(taskEl, target || pointTaskEl, { x: evt.clientX, y: evt.clientY }).then((context) => {
      if (!context) {
        new Notice('Could not resolve the task line.');
        return;
      }
      this.toggleSelectedTask(context, taskEl);
    });
    return true;
  }

  private resolveTaskElement(target: HTMLElement | null): HTMLElement | null {
    if (!target) return null;
    const taskEl = target.closest<HTMLElement>(KANBAN_TASK_SELECTOR);
    if (!taskEl) return null;
    return taskEl.matches('input.task-list-item-checkbox, input[type="checkbox"]')
      ? taskEl.closest<HTMLElement>('.task-list-item, [data-task], li, p, div') ?? taskEl
      : taskEl;
  }

  private resolveTaskElementAtPoint(evt: MouseEvent): HTMLElement | null {
    const pointTaskEl = this.resolveTaskElementByPointBounds(evt.clientX, evt.clientY);
    if (pointTaskEl) return pointTaskEl;

    if (typeof document.elementsFromPoint !== 'function') return null;
    const elements = document.elementsFromPoint(evt.clientX, evt.clientY);
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      const taskEl = this.resolveTaskElement(element);
      if (taskEl) return taskEl;
    }
    return null;
  }

  private resolveTaskElementByPointBounds(clientX: number, clientY: number): HTMLElement | null {
    const selectors = [
      '[data-tps-gcm-context="kanban-task"]',
      '[data-tps-gcm-context="calendar-task"]',
      '.tps-kanban-card-task[data-task-path][data-task-line]',
      '.tps-kanban-task-card[data-task-path][data-task-line]',
      '.tps-calendar-task-entry[data-task-path][data-task-line]',
      'li.task-list-item',
      '.cm-line',
    ];
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selectors.join(', ')))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) =>
        rect.width > 0
        && rect.height > 0
        && clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom
        && (element.matches('[data-task-path], [data-tps-gcm-context], li.task-list-item, .cm-line')
          || !!element.querySelector('input.task-list-item-checkbox, input[type="checkbox"]')))
      .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));

    for (const { element } of candidates) {
      const taskEl = this.resolveTaskElement(element);
      if (taskEl) return taskEl;
    }
    return null;
  }

  private async resolveContext(
    taskEl: HTMLElement,
    sourceEl: HTMLElement | null = null,
    point: { x: number; y: number } | null = null,
  ): Promise<TaskLineContext | null> {
    const rawPath =
      taskEl.dataset.taskPath ||
      taskEl.dataset.tpsKanbanPath ||
      taskEl.dataset.path ||
      '';
    const file = rawPath ? this.plugin.app.vault.getFileByPath(rawPath) : this.resolveMarkdownTaskFile(taskEl);
    if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') return null;

    const content = await this.plugin.app.vault.cachedRead(file);
    const lines = content.split(/\r?\n/);

    const directTargetTexts = sourceEl && sourceEl !== taskEl ? this.getDirectTaskElementSearchTexts(sourceEl) : [];
    const targetTexts = directTargetTexts.length ? directTargetTexts : this.getTaskElementSearchTexts(taskEl);
    const candidateIndexes = this.getTaskLineCandidateIndexes(taskEl, lines, file, sourceEl, point);
    for (const candidateIndex of candidateIndexes) {
      const context = this.contextFromLine(file, candidateIndex, lines[candidateIndex] || '', taskEl, lines);
      if (context && this.taskLineMatchesSearchTexts(context.rawLine, targetTexts)) {
        return context;
      }
    }

    const lineIndex = this.resolveFallbackLineIndex(lines, targetTexts);
    if (lineIndex < 0) return null;
    return this.contextFromLine(file, lineIndex, lines[lineIndex] || '', taskEl, lines);
  }

  private contextFromLine(file: TFile, lineIndex: number, rawLine: string, taskEl: HTMLElement, lines: string[]): TaskLineContext | null {
    const parsed = parseTaskLine(rawLine);
    if (!parsed) return null;
    return {
      file,
      lineNumber: lineIndex + 1,
      lineIndex,
      rawLine,
      title: getTaskDisplayTitle(rawLine),
      checkboxToken: parsed.token,
      taskOrdinal: this.getTaskOrdinal(lines, lineIndex),
      isCalendarTask: taskEl.dataset.tpsGcmContext === 'calendar-task' || taskEl.classList.contains('tps-calendar-task-entry'),
      calendarAllDay: /^true$/i.test(String(taskEl.dataset.tpsCalendarAllDay || '')),
    };
  }

  private getTaskOrdinal(lines: string[], lineIndex: number): number {
    let ordinal = -1;
    for (let index = 0; index <= lineIndex && index < lines.length; index += 1) {
      if (parseTaskLine(lines[index] || '')) ordinal += 1;
    }
    return ordinal;
  }

  private getTaskLineCandidateIndexes(
    taskEl: HTMLElement,
    lines: string[],
    file: TFile,
    sourceEl: HTMLElement | null = null,
    point: { x: number; y: number } | null = null,
  ): number[] {
    const candidates: number[] = [];
    const add = (value: unknown, oneBased: boolean) => {
      const raw = Number(value);
      if (!Number.isFinite(raw)) return;
      const lineIndex = Math.floor(raw) - (oneBased ? 1 : 0);
      if (lineIndex < 0 || lineIndex >= lines.length || candidates.includes(lineIndex)) return;
      candidates.push(lineIndex);
    };

    const pointLineIndex = this.resolveRenderedTaskLineIndexByPoint(file, lines, point);
    if (pointLineIndex != null) add(pointLineIndex, false);

    const orderedLineIndex = this.resolveRenderedTaskLineIndexByOrder(taskEl, file, lines);
    if (orderedLineIndex != null) add(orderedLineIndex, false);

    const pluginLine =
      sourceEl?.getAttribute('data-task-line') ||
      sourceEl?.getAttribute('data-tps-kanban-line') ||
      taskEl.getAttribute('data-task-line') ||
      taskEl.getAttribute('data-tps-kanban-line');
    if (pluginLine != null && pluginLine !== '') {
      add(pluginLine, true);
      add(pluginLine, false);
    }

    const renderedLineHost =
      sourceEl?.closest<HTMLElement>('li.task-list-item[data-line], li[data-line], [data-line]') ||
      taskEl.closest<HTMLElement>('li.task-list-item[data-line], li[data-line], [data-line]');
    const renderedLine = renderedLineHost?.getAttribute('data-line') ?? taskEl.getAttribute('data-line');
    if (renderedLine != null && renderedLine !== '') {
      add(renderedLine, false);
    }

    return candidates;
  }

  private resolveRenderedTaskLineIndexByPoint(
    file: TFile,
    lines: string[],
    point: { x: number; y: number } | null,
  ): number | null {
    if (!point) return null;
    const sourceTaskIndexes = lines
      .map((line, index) => parseTaskLine(line || '') ? index : -1)
      .filter((index) => index >= 0);
    if (!sourceTaskIndexes.length) return null;

    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as any;
      if (view?.file?.path !== file.path) continue;
      const root = view?.previewMode?.containerEl
        || view?.contentEl
        || view?.containerEl?.querySelector?.('.markdown-preview-view, .markdown-rendered, .markdown-reading-view, .markdown-source-view');
      if (!(root instanceof HTMLElement)) continue;
      const rootRect = root.getBoundingClientRect();
      if (point.x < rootRect.left || point.x > rootRect.right || point.y < rootRect.top || point.y > rootRect.bottom) continue;

      const rows = Array.from(root.querySelectorAll<HTMLElement>('input.task-list-item-checkbox, input[type="checkbox"]'))
        .map((checkbox) => {
          const rect = checkbox.getBoundingClientRect();
          return { rect, centerY: rect.top + rect.height / 2 };
        })
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .sort((a, b) => a.centerY - b.centerY);
      if (!rows.length) continue;

      const row = rows.find(({ rect }) => point.y >= rect.top - 8 && point.y <= rect.bottom + 14)
        || rows
          .map((candidate, index) => ({ candidate, index, distance: Math.abs(candidate.centerY - point.y) }))
          .filter(({ distance }) => distance <= 28)
          .sort((a, b) => a.distance - b.distance)[0]?.candidate;
      if (!row) continue;

      const ordinal = rows.indexOf(row);
      return sourceTaskIndexes[ordinal] ?? null;
    }
    return null;
  }

  private resolveRenderedTaskLineIndexByOrder(taskEl: HTMLElement, file: TFile, lines: string[]): number | null {
    const host = taskEl.closest<HTMLElement>('li.task-list-item, li');
    if (!host) return null;

    const view = this.resolveMarkdownViewForElement(host);
    if (!view || view.file?.path !== file.path) return null;

    const previewEl = view?.previewMode?.containerEl
      || view?.containerEl?.querySelector?.('.markdown-preview-view, .markdown-rendered, .markdown-reading-view');
    if (!(previewEl instanceof HTMLElement) || !previewEl.contains(host)) return null;

    const renderedTasks = Array.from(previewEl.querySelectorAll<HTMLElement>('li.task-list-item, li'))
      .filter((element) => element.matches('li.task-list-item') || !!element.querySelector('input.task-list-item-checkbox, input[type="checkbox"]'));
    const ordinal = renderedTasks.findIndex((element) => element === host || element.contains(host));
    if (ordinal < 0) return null;

    const sourceTaskIndexes = lines
      .map((line, index) => parseTaskLine(line || '') ? index : -1)
      .filter((index) => index >= 0);
    return sourceTaskIndexes[ordinal] ?? null;
  }

  private resolveMarkdownViewForElement(element: HTMLElement): any | null {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as any;
      const containerEl = view?.containerEl;
      const contentEl = view?.contentEl;
      const previewEl = view?.previewMode?.containerEl;
      if ((containerEl instanceof HTMLElement && containerEl.contains(element))
        || (contentEl instanceof HTMLElement && contentEl.contains(element))
        || (previewEl instanceof HTMLElement && previewEl.contains(element))) {
        return view;
      }
    }
    return null;
  }

  private getDirectTaskElementSearchTexts(taskEl: HTMLElement): string[] {
    const candidates = [
      taskEl.dataset.tpsKanbanTaskText,
      taskEl.dataset.taskText,
      taskEl.dataset.title,
      taskEl.getAttribute('aria-label'),
      taskEl.getAttribute('title'),
      taskEl.textContent,
      taskEl.closest<HTMLElement>('.task-list-item, li')?.textContent,
    ];
    const seen = new Set<string>();
    return candidates
      .flatMap((value) => this.getTaskSearchTextVariants(String(value || '').trim()))
      .filter((value) => {
        const key = this.normalizeTaskText(value);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  private getTaskElementSearchTexts(taskEl: HTMLElement): string[] {
    const candidates = [
      taskEl.dataset.tpsKanbanTaskText,
      taskEl.dataset.taskText,
      taskEl.dataset.title,
      taskEl.getAttribute('aria-label'),
      taskEl.getAttribute('title'),
      taskEl.textContent,
      taskEl.closest<HTMLElement>('.task-list-item, [data-task], li, p, div')?.textContent,
      taskEl.parentElement?.textContent,
    ];
    const seen = new Set<string>();
    return candidates
      .flatMap((value) => this.getTaskSearchTextVariants(String(value || '').trim()))
      .filter((value) => {
        const key = this.normalizeTaskText(value);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  private resolveMarkdownTaskFile(taskEl: HTMLElement): TFile | null {
    const viewEl = taskEl.closest<HTMLElement>('.markdown-preview-view, .markdown-rendered, .markdown-view');
    const view = viewEl ? this.plugin.app.workspace.getLeavesOfType('markdown')
      .map((leaf) => leaf.view as any)
      .find((candidate) => candidate?.containerEl instanceof HTMLElement && candidate.containerEl.contains(taskEl)) : null;
    const viewFile = view?.file;
    if (viewFile instanceof TFile) return viewFile;
    const activeFile = this.plugin.app.workspace.getActiveFile();
    return activeFile instanceof TFile ? activeFile : null;
  }

  private resolveFallbackLineIndex(lines: string[], targetTexts: string[]): number {
    const normalizedTargets = targetTexts
      .map((targetText) => this.normalizeTaskText(targetText))
      .filter(Boolean);
    if (!normalizedTargets.length) {
      const taskLineIndexes = lines
        .map((line, index) => parseTaskLine(line || '') ? index : -1)
        .filter((index) => index >= 0);
      return taskLineIndexes.length === 1 ? taskLineIndexes[0] : -1;
    }
    return lines.findIndex((line) => {
      const parsed = parseTaskLine(line || '');
      if (!parsed) return false;
      return this.taskLineMatchesNormalizedTargets(line || '', normalizedTargets);
    });
  }

  private taskLineMatchesSearchTexts(rawLine: string, targetTexts: string[]): boolean {
    const normalizedTargets = targetTexts
      .map((targetText) => this.normalizeTaskText(targetText))
      .filter(Boolean);
    if (!normalizedTargets.length) return true;
    return this.taskLineMatchesNormalizedTargets(rawLine, normalizedTargets);
  }

  private taskLineMatchesNormalizedTargets(rawLine: string, normalizedTargets: string[]): boolean {
    const parsed = parseTaskLine(rawLine || '');
    if (!parsed) return false;
    const normalizedLine = this.normalizeTaskText(getTaskDisplayTitle(rawLine || '') || parsed.body);
    if (!normalizedLine) return false;
    return normalizedTargets.some((normalizedTarget) =>
      normalizedLine === normalizedTarget
      || normalizedLine.includes(normalizedTarget)
      || normalizedTarget.includes(normalizedLine)
    );
  }

  private toggleSelectedTask(context: TaskLineContext, sourceEl: HTMLElement): void {
    const key = this.getTaskContextKey(context);
    if (this.selectedTaskContexts.has(key)) {
      this.selectedTaskContexts.delete(key);
    } else {
      for (const [existingKey, existingContext] of this.selectedTaskContexts.entries()) {
        if (existingContext.file.path !== context.file.path) {
          this.selectedTaskContexts.delete(existingKey);
        }
      }
      this.selectedTaskContexts.set(key, { ...context });
    }
    this.refreshTaskSelectionHighlights(sourceEl);
    new Notice(`${this.selectedTaskContexts.size} task${this.selectedTaskContexts.size === 1 ? '' : 's'} selected.`);
  }

  private clearTaskSelection(): void {
    this.selectedTaskContexts.clear();
    this.refreshTaskSelectionHighlights();
  }

  private setActiveTaskHighlight(contexts: TaskLineContext[], sourceEl: HTMLElement): void {
    this.clearHighlightEls(this.activeHighlightEls, 'active');
    for (const context of contexts) {
      for (const element of this.resolveTaskHighlightElements(context, sourceEl)) {
        element.addClass('tps-gcm-task-line-active');
        this.activeHighlightEls.add(element);
      }
    }
  }

  private clearActiveTaskHighlight(): void {
    this.clearHighlightEls(this.activeHighlightEls, 'active');
  }

  private refreshTaskSelectionHighlights(sourceEl?: HTMLElement): void {
    this.clearHighlightEls(this.selectedHighlightEls, 'selected');
    for (const context of this.selectedTaskContexts.values()) {
      for (const element of this.resolveTaskHighlightElements(context, sourceEl)) {
        element.addClass('tps-gcm-task-line-selected');
        this.selectedHighlightEls.add(element);
      }
    }
  }

  private clearHighlightEls(elements: Set<HTMLElement>, kind: TaskLineHighlightKind): void {
    const className = kind === 'active' ? 'tps-gcm-task-line-active' : 'tps-gcm-task-line-selected';
    for (const element of elements) {
      element.removeClass(className);
    }
    elements.clear();
  }

  private resolveTaskHighlightElements(context: TaskLineContext, sourceEl?: HTMLElement): HTMLElement[] {
    const elements = new Set<HTMLElement>();
    const sourceHost = sourceEl ? this.resolveDirectTaskHighlightHost(sourceEl) : null;
    if (sourceHost && this.highlightHostMatchesContext(sourceHost, context)) {
      elements.add(sourceHost);
    }

    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as any;
      if (view?.file?.path !== context.file.path) continue;
      const cmLine = this.resolveCodeMirrorLineElement(view, context.lineIndex);
      if (cmLine) elements.add(cmLine);
      for (const rendered of this.resolveRenderedTaskElements(view, context)) {
        elements.add(rendered);
      }
    }

    return [...elements];
  }

  private resolveDirectTaskHighlightHost(sourceEl: HTMLElement): HTMLElement | null {
    const host = sourceEl.closest<HTMLElement>(
      'li.task-list-item, .task-list-item, .cm-line, .tps-calendar-task-entry[data-task-path][data-task-line], .tps-kanban-card-task[data-task-path][data-task-line], .tps-kanban-task-card[data-task-path][data-task-line], [data-tps-gcm-context="calendar-task"], [data-tps-gcm-context="kanban-task"]',
    );
    if (!host) return null;
    return this.isTaskHighlightElement(host) ? host : null;
  }

  private highlightHostMatchesContext(host: HTMLElement, context: TaskLineContext): boolean {
    const taskLine = Number(host.getAttribute('data-task-line') || host.getAttribute('data-tps-kanban-line'));
    if (Number.isFinite(taskLine)) {
      const normalized = Math.floor(taskLine);
      if (normalized === context.lineNumber || normalized === context.lineIndex) return true;
    }

    const dataLine = Number(host.getAttribute('data-line'));
    if (Number.isFinite(dataLine) && Math.floor(dataLine) === context.lineIndex) return true;

    const view = this.resolveMarkdownViewForElement(host);
    if (view?.file?.path === context.file.path) {
      const previewEl = view?.previewMode?.containerEl
        || view?.containerEl?.querySelector?.('.markdown-preview-view, .markdown-rendered, .markdown-reading-view');
      if (typeof context.taskOrdinal === 'number' && previewEl instanceof HTMLElement && previewEl.contains(host)) {
        const renderedTasks = this.getRenderedTaskHighlightElements(previewEl);
        const ordinal = renderedTasks.findIndex((element) => element === host || element.contains(host));
        if (ordinal >= 0 && ordinal === context.taskOrdinal) return true;
      }
    }

    const hostText = this.normalizeTaskText(host.innerText || host.textContent || '');
    const taskText = this.normalizeTaskText(context.title || getTaskDisplayTitle(context.rawLine) || context.rawLine);
    return !!hostText && !!taskText && hostText === taskText;
  }

  private resolveCodeMirrorLineElement(view: any, lineIndex: number): HTMLElement | null {
    const cm = view?.editor?.cm;
    if (!cm?.state?.doc || typeof cm.domAtPos !== 'function') return null;
    try {
      const line = cm.state.doc.line(lineIndex + 1);
      const domResult = cm.domAtPos(line.from);
      const node = domResult?.node;
      const element = node instanceof HTMLElement
        ? node.closest<HTMLElement>('.cm-line') || node
        : node?.parentElement?.closest?.('.cm-line');
      return element instanceof HTMLElement ? element : null;
    } catch {
      return null;
    }
  }

  private resolveRenderedTaskElements(view: any, context: TaskLineContext): HTMLElement[] {
    const previewEl = view?.previewMode?.containerEl
      || view?.containerEl?.querySelector?.('.markdown-preview-view, .markdown-rendered, .markdown-reading-view');
    if (!(previewEl instanceof HTMLElement)) return [];

    const directMatches = Array.from(previewEl.querySelectorAll<HTMLElement>([
      `li.task-list-item[data-line="${context.lineIndex}"]`,
      `.task-list-item[data-line="${context.lineIndex}"]`,
      `.tps-calendar-task-entry[data-task-path][data-task-line="${context.lineNumber}"]`,
      `.tps-calendar-task-entry[data-task-path][data-task-line="${context.lineIndex}"]`,
      `.tps-kanban-card-task[data-task-path][data-task-line="${context.lineNumber}"]`,
      `.tps-kanban-card-task[data-task-path][data-task-line="${context.lineIndex}"]`,
      `.tps-kanban-task-card[data-task-path][data-task-line="${context.lineNumber}"]`,
      `.tps-kanban-task-card[data-task-path][data-task-line="${context.lineIndex}"]`,
      `[data-tps-gcm-context="calendar-task"][data-task-line="${context.lineNumber}"]`,
      `[data-tps-gcm-context="calendar-task"][data-task-line="${context.lineIndex}"]`,
      `[data-tps-gcm-context="kanban-task"][data-task-line="${context.lineNumber}"]`,
      `[data-tps-gcm-context="kanban-task"][data-task-line="${context.lineIndex}"]`,
    ].join(', ')))
      .filter((element) => this.isTaskHighlightElement(element));
    if (directMatches.length > 0) return directMatches;

    if (typeof context.taskOrdinal !== 'number' || context.taskOrdinal < 0) return [];
    const rendered = this.getRenderedTaskHighlightElements(previewEl)[context.taskOrdinal];
    return rendered ? [rendered] : [];
  }

  private getRenderedTaskHighlightElements(previewEl: HTMLElement): HTMLElement[] {
    return Array.from(previewEl.querySelectorAll<HTMLElement>(
      'li.task-list-item, .task-list-item, .tps-calendar-task-entry[data-task-path][data-task-line], .tps-kanban-card-task[data-task-path][data-task-line], .tps-kanban-task-card[data-task-path][data-task-line], [data-tps-gcm-context="calendar-task"], [data-tps-gcm-context="kanban-task"]',
    ))
      .filter((element) => this.isTaskHighlightElement(element));
  }

  private isTaskHighlightElement(element: HTMLElement): boolean {
    if (element.matches('.cm-line, li.task-list-item, .tps-calendar-task-entry[data-task-path][data-task-line], .tps-kanban-card-task[data-task-path][data-task-line], .tps-kanban-task-card[data-task-path][data-task-line], [data-tps-gcm-context="calendar-task"], [data-tps-gcm-context="kanban-task"]')) {
      return true;
    }
    return element.matches('.task-list-item') && !!element.querySelector('input.task-list-item-checkbox, input[type="checkbox"]');
  }

  private showMenu(context: TaskLineContext, taskEl: HTMLElement, x: number, y: number): void {
    const menu = new Menu();
    const selectedContexts = this.getMenuSelection(context);
    this.setActiveTaskHighlight(selectedContexts, taskEl);
    menu.onHide(() => this.clearActiveTaskHighlight());

    if (selectedContexts.length > 1) {
      this.addSelectedTaskMenuItems(menu, selectedContexts);
      menu.addSeparator();
    }
    this.addTaskLineMenuItems(menu, context);
    menu.showAtPosition({ x, y });
  }

  private getMenuSelection(context: TaskLineContext): TaskLineContext[] {
    const key = this.getTaskContextKey(context);
    if (!this.selectedTaskContexts.has(key)) return [context];
    const selected = [...this.selectedTaskContexts.values()]
      .filter((candidate) => candidate.file.path === context.file.path)
      .sort((a, b) => a.lineIndex - b.lineIndex);
    return selected.length > 0 ? selected : [context];
  }

  private addSelectedTaskMenuItems(menu: Menu, contexts: TaskLineContext[]): void {
    const count = contexts.length;
    menu.addItem((item) => {
      item
        .setTitle(`Selected tasks (${count})`)
        .setIcon('list-checks');
      const subMenu = (item as any).setSubmenu();

      subMenu.addItem((sub: any) => {
        sub.setTitle('Set status').setIcon('circle-check');
        const statusMenu = sub.setSubmenu();
        for (const mapping of this.getCheckboxMappings()) {
          const status = String(mapping.statuses?.[0] || '').trim();
          const label = String(mapping.label || status || mapping.checkboxState).trim();
          statusMenu.addItem((statusItem: any) => {
            statusItem.setTitle(label).setIcon(mapping.icon || 'square').onClick(() => {
              void this.updateTaskLines(contexts, (line) => setTaskCheckboxToken(line, mapping.checkboxState), {
                checkboxMutation: true,
              });
            });
          });
        }
      });

      subMenu.addItem((sub: any) => {
        sub.setTitle('Add tag...').setIcon('tag').onClick(() => {
          new TextInputModal(this.plugin.app, 'Tag', '', async (value) => {
            const tag = String(value || '').trim();
            if (!tag) return;
            await this.updateTaskLines(contexts, (line) => addInlineTagToTaskLine(line, tag));
          }).open();
        });
      });

      subMenu.addSeparator();
      subMenu.addItem((sub: any) => {
        sub.setTitle('Archive selected in place').setIcon('archive').onClick(() => {
          void this.archiveSelectedTasks(contexts);
        });
      });
      subMenu.addItem((sub: any) => {
        sub.setTitle('Move selected to file...').setIcon('file-input').onClick(() => {
          this.promptMoveSelectedTasksToFile(contexts);
        });
      });
      subMenu.addItem((sub: any) => {
        sub.setTitle('Delete selected').setIcon('trash-2').onClick(() => {
          void this.deleteSelectedTasks(contexts);
        });
      });

      subMenu.addSeparator();
      subMenu.addItem((sub: any) => {
        sub.setTitle('Clear selection').setIcon('x').onClick(() => this.clearTaskSelection());
      });
    });
  }

  addTaskLineMenuItems(
    menu: Menu,
    context: TaskLineContext,
    options: { includeTitle?: boolean; includeStatus?: boolean } = {},
  ): void {
    const includeTitle = options.includeTitle !== false;
    const includeStatus = options.includeStatus !== false;

    if (includeTitle) {
      menu.addItem((item) => {
        item
          .setTitle(`Title: ${context.title || '(untitled task)'}`)
          .setIcon('pencil')
          .onClick(() => this.promptTaskTitle(context));
      });
    }

    if (includeStatus) {
      this.addTaskStatusMenu(menu, context);
    }
    this.addConfiguredPropertyMenus(menu, context);

    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle('Open task line')
        .setIcon('list')
        .onClick(() => {
          void this.openTaskLine(context);
        });
    });
    menu.addItem((item) => {
      item
        .setTitle('Link task to note...')
        .setIcon('link')
        .onClick(() => {
          this.plugin.dailyInboxLineService.promptLinkTaskLineInFile(context);
        });
    });
    menu.addItem((item) => {
      item
        .setTitle('Transfer item to note...')
        .setIcon('file-output')
        .onClick(() => {
          this.plugin.dailyInboxLineService.promptTransferTaskLine(context);
        });
    });
    menu.addItem((item) => {
      item
        .setTitle('Archive item in place')
        .setIcon('archive')
        .onClick(() => {
          void this.plugin.dailyInboxLineService.archiveTaskLine(context);
        });
    });
    menu.addItem((item) => {
      item
        .setTitle('Move task to file...')
        .setIcon('file-input')
        .onClick(() => this.promptMoveTaskToFile(context));
    });
    menu.addItem((item) => {
      item
        .setTitle('Delete task')
        .setIcon('trash-2')
        .onClick(() => {
          void this.deleteTask(context);
        });
    });

    if (readInlineFieldValue(context.rawLine, 'recurrence') || readInlineFieldValue(context.rawLine, 'recurrenceRule')) {
      menu.addItem((item) => {
        item
          .setTitle('Edit recurrence template...')
          .setIcon('copy-check')
          .onClick(() => {
            void this.plugin.taskRecurrenceService.editTemplateForTaskLine(
              context.file,
              context.lineIndex,
              context.rawLine,
            );
          });
      });
    }

    if (this.plugin.settings.enableTimeTracking !== false) {
      this.addTaskTimeTrackingMenu(menu, context);
    }
  }

  private addTaskStatusMenu(menu: Menu, context: TaskLineContext): void {
    menu.addItem((item) => {
      const current = this.getStatusForCheckboxToken(context.checkboxToken);
      item
        .setTitle(current ? `Status: ${current}` : 'Status')
        .setIcon('circle-check');
      const subMenu = (item as any).setSubmenu();

      for (const mapping of this.getCheckboxMappings()) {
        const status = String(mapping.statuses?.[0] || '').trim();
        const label = String(mapping.label || status || mapping.checkboxState).trim();
        subMenu.addItem((sub: any) => {
          sub
            .setTitle(label)
            .setIcon(mapping.icon || 'square');
          if (mapping.checkboxState === context.checkboxToken) sub.setChecked(true);
          sub.onClick(() => {
            void this.updateTaskLine(context, (line) => setTaskCheckboxToken(line, mapping.checkboxState), {
              checkboxMutation: true,
            });
          });
        });
      }

      subMenu.addSeparator();
      subMenu.addItem((sub: any) => {
        sub
          .setTitle('Custom checkbox value...')
          .setIcon('brackets')
          .onClick(() => {
            new TextInputModal(this.plugin.app, 'Checkbox value', context.checkboxToken, async (value) => {
              const token = this.normalizeCheckboxToken(value);
              if (!token) {
                new Notice('Use a single checkbox marker, for example ?, *, /, -, x, or blank.');
                return;
              }
              await this.updateTaskLine(context, (line) => setTaskCheckboxToken(line, token), {
                checkboxMutation: true,
              });
            }).open();
          });
      });
    });
  }

  private addConfiguredPropertyMenus(menu: Menu, context: TaskLineContext): void {
    const statusKey = this.getStatusKey().toLowerCase();
    const properties = (this.plugin.settings.properties || []).filter((property) => this.isTaskMenuProperty(property, statusKey));
    for (const property of properties) {
      if (property.type === 'selector') {
        this.addSelectorPropertyMenu(menu, context, property);
      } else if (property.type === 'datetime') {
        this.addDatetimePropertyMenu(menu, context, property);
      } else if (property.type === 'list') {
        this.addListPropertyMenu(menu, context, property);
      } else if (property.type === 'recurrence') {
        this.addRecurrencePropertyMenu(menu, context, property);
      } else if (property.type === 'text' || property.type === 'number') {
        this.addTextPropertyMenu(menu, context, property);
      }
    }
  }

  private addSelectorPropertyMenu(menu: Menu, context: TaskLineContext, property: CustomProperty): void {
    const current = readInlineFieldValue(context.rawLine, property.key);
    menu.addItem((item) => {
      item
        .setTitle(current ? `${property.label}: ${current}` : `${property.label} (create field)`)
        .setIcon(property.icon || 'list');
      const subMenu = (item as any).setSubmenu();
      subMenu.addItem((sub: any) => {
        sub.setTitle('(none)').setChecked(!current).onClick(() => {
          void this.updateTaskLine(context, (line) => setInlineFieldValueOnTaskLine(line, property.key, null));
        });
      });
      subMenu.addItem((sub: any) => {
        sub.setTitle('Set custom value...').setIcon('pencil').onClick(() => {
          this.promptInlineValue(context, property, current);
        });
      });
      subMenu.addSeparator();
      for (const option of getEffectivePropertyOptions(this.plugin.app, property)) {
        subMenu.addItem((sub: any) => {
          sub.setTitle(option).setChecked(current === option).onClick(() => {
            void this.updateTaskLine(context, (line) => setInlineFieldValueOnTaskLine(line, property.key, option));
          });
        });
      }
    });
  }

  private addDatetimePropertyMenu(menu: Menu, context: TaskLineContext, property: CustomProperty): void {
    const isScheduled = String(property.key || '').trim().toLowerCase() === 'scheduled';
    const current = isScheduled
      ? resolveTaskScheduledValue(this.plugin.app, this.plugin.settings, context.file, context.rawLine)
      : readInlineFieldValue(context.rawLine, property.key);
    const inherited = isScheduled && current && !readInlineFieldValue(context.rawLine, property.key);
    menu.addItem((item) => {
      item
        .setTitle(current
          ? `${property.label}: ${current}${inherited ? ' (inherited)' : ''}`
          : `${property.label} (create field)`)
        .setIcon(property.icon || 'calendar')
        .onClick(() => {
          const timeEstimate = Number.parseInt(readInlineFieldValue(context.rawLine, 'timeEstimate') || '0', 10) || 0;
          const allDay = /^true$/i.test(readInlineFieldValue(context.rawLine, 'allDay'));
          new ScheduledModal(this.plugin.app, current, timeEstimate, allDay, async (result) => {
            await this.applyDatetimePropertyChange(context, property, result);
          }).open();
        });
    });
  }

  private async applyDatetimePropertyChange(
    context: TaskLineContext,
    property: CustomProperty,
    result: { date: string; timeEstimate: number; allDay: boolean },
  ): Promise<void> {
    const isScheduled = String(property.key || '').trim().toLowerCase() === 'scheduled';
    await this.updateTaskLine(context, (line) => {
      let next = setInlineFieldValueOnTaskLine(line, property.key, result.date || null);
      if (isScheduled) {
        next = setInlineFieldValueOnTaskLine(next, 'timeEstimate', result.date ? String(result.timeEstimate || 0) : null);
        next = setInlineFieldValueOnTaskLine(next, 'allDay', result.date && result.allDay ? 'true' : null);
      }
      return next;
    });

    if (isScheduled) {
      await this.maybePromptMoveScheduledDailyNoteTask(context, result.date);
    }
  }

  private async maybePromptMoveScheduledDailyNoteTask(context: TaskLineContext, scheduledValue: string): Promise<void> {
    if (this.plugin.settings.inheritUnscheduledTasksFromDailyNotes === false) return;
    const sourceDate = getInheritedDailyNoteTaskScheduledValue(this.plugin.app, this.plugin.settings, context.file);
    if (!sourceDate) return;
    const targetDate = getIsoDateFromScheduledValue(scheduledValue);
    if (!targetDate || targetDate === sourceDate) return;
    const targetFile = await this.plugin.noteOperationService.ensureDailyNote(targetDate);
    if (!(targetFile instanceof TFile) || targetFile.path === context.file.path) return;

    new DailyNoteTaskMovePromptModal(this.plugin.app, {
      taskTitle: context.title || 'Task',
      sourceDate,
      targetDate,
      targetFile,
      onMove: async () => {
        await this.moveTaskToFile(context, targetFile);
      },
    }).open();
  }

  private addListPropertyMenu(menu: Menu, context: TaskLineContext, property: CustomProperty): void {
    const isTags = String(property.key || '').trim().toLowerCase() === 'tags' || property.listItemType === 'tag';
    const current = isTags ? readInlineTags(context.rawLine) : this.parseListValue(readInlineFieldValue(context.rawLine, property.key));
    menu.addItem((item) => {
      item
        .setTitle(current.length > 0 ? `${property.label} (${current.length})` : `${property.label} (create field)`)
        .setIcon(property.icon || 'tag');
      const subMenu = (item as any).setSubmenu();
      subMenu.addItem((sub: any) => {
        sub.setTitle(`Add ${property.label}...`).setIcon('plus').onClick(() => {
          new TextInputModal(this.plugin.app, property.label || property.key, '', async (value) => {
            const next = String(value || '').trim();
            if (!next) return;
            await this.updateTaskLine(context, (line) => isTags
              ? addInlineTagToTaskLine(line, next)
              : setInlineFieldValueOnTaskLine(line, property.key, this.joinUnique([...current, next])));
          }).open();
        });
      });
      if (current.length > 0) subMenu.addSeparator();
      for (const value of current) {
        subMenu.addItem((sub: any) => {
          sub.setTitle(`Remove ${value}`).setIcon('x').onClick(() => {
            void this.updateTaskLine(context, (line) => isTags
              ? removeInlineTagFromTaskLine(line, value)
              : setInlineFieldValueOnTaskLine(line, property.key, this.joinUnique(current.filter((itemValue) => itemValue !== value))));
          });
        });
      }
    });
  }

  private addRecurrencePropertyMenu(menu: Menu, context: TaskLineContext, property: CustomProperty): void {
    const current = readInlineFieldValue(context.rawLine, property.key);
    menu.addItem((item) => {
      item
        .setTitle(current ? `Edit ${property.label}...` : `${property.label} (create field)`)
        .setIcon(property.icon || 'repeat')
        .onClick(() => {
          const scheduled = readInlineFieldValue(context.rawLine, 'scheduled');
          const startDate = scheduled ? new Date(scheduled.replace(' ', 'T')) : new Date();
          new RecurrenceModal(this.plugin.app, current, Number.isNaN(startDate.getTime()) ? new Date() : startDate, '', async (rule) => {
            await this.updateTaskLine(context, (line) => setInlineFieldValueOnTaskLine(line, property.key, rule || null));
          }).open();
        });
    });
  }

  private addTextPropertyMenu(menu: Menu, context: TaskLineContext, property: CustomProperty): void {
    const current = readInlineFieldValue(context.rawLine, property.key);
    menu.addItem((item) => {
      item
        .setTitle(current ? `${property.label}: ${current}` : `${property.label} (create field)`)
        .setIcon(property.icon || 'pencil')
        .onClick(() => this.promptInlineValue(context, property, current));
    });
  }

  private addTaskTimeTrackingMenu(menu: Menu, context: TaskLineContext): void {
    menu.addItem((item) => {
      item
        .setTitle('Time Tracking')
        .setIcon('timer');
      const subMenu = (item as any).setSubmenu();
      subMenu.addItem((sub: any) => {
        sub.setTitle('Start timer').setIcon('play').onClick(() => {
          void this.startTaskTimer(context);
        });
      });
      subMenu.addItem((sub: any) => {
        sub.setTitle('Add manual session').setIcon('clock').onClick(() => {
          void this.plugin.timeTrackingService.promptAddManualSession({
            file: context.file,
            type: 'task',
            lineNumber: context.lineIndex,
            title: context.title || context.file.basename,
          });
        });
      });
    });
  }

  private startTaskTimer(context: TaskLineContext, mode?: 'overwrite' | 'duplicate'): Promise<void> | void {
    if (!mode && this.shouldPromptForTimedCalendarTask(context)) {
      new TaskTimerScheduledConflictModal(this.plugin.app, context.title || context.file.basename, {
        overwrite: () => {
          void this.startTaskTimer(context, 'overwrite');
        },
        duplicate: async () => {
          const duplicateContext = await this.duplicateTaskBelowForTimer(context);
          if (duplicateContext) {
            await this.startTaskTimer(duplicateContext, 'overwrite');
          }
        },
      }).open();
      return;
    }

    return this.plugin.timeTrackingService.startTimer({
      file: context.file,
      type: 'task',
      lineNumber: context.lineIndex,
      title: context.title || context.file.basename,
    }).then(() => undefined);
  }

  private shouldPromptForTimedCalendarTask(context: TaskLineContext): boolean {
    if (!context.isCalendarTask || context.calendarAllDay) return false;
    return !!readInlineFieldValue(context.rawLine, 'scheduled');
  }

  private async duplicateTaskBelowForTimer(context: TaskLineContext): Promise<TaskLineContext | null> {
    const duplicateLine = this.buildTimerDuplicateTaskLine(context);
    let insertedIndex = -1;
    await this.plugin.app.vault.process(context.file, (content) => {
      const newline = content.includes('\r\n') ? '\r\n' : '\n';
      const endsWithNewline = /\r?\n$/.test(content);
      const lines = content.split(/\r?\n/);
      if (endsWithNewline) lines.pop();
      const lineIndex = this.resolveLineIndex(lines, context);
      if (lineIndex < 0 || !parseTaskLine(lines[lineIndex] || '')) return content;
      insertedIndex = lineIndex + 1;
      lines.splice(insertedIndex, 0, duplicateLine);
      return `${lines.join(newline)}${endsWithNewline ? newline : ''}`;
    });

    if (insertedIndex < 0) {
      new Notice('Could not create a new task under the scheduled task.');
      return null;
    }

    const parsed = parseTaskLine(duplicateLine);
    if (!parsed) return null;
    this.plugin.eventService.emitFilesUpdated([context.file.path]);
    this.plugin.overlayRenderingService?.invalidate({
      reason: 'task-line-context-menu-duplicate-for-timer',
      file: context.file,
      surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
      rebuildInlineSubitems: true,
      refreshLivePreviewEditors: true,
      delayMs: 80,
    });
    return {
      file: context.file,
      lineIndex: insertedIndex,
      lineNumber: insertedIndex + 1,
      rawLine: duplicateLine,
      title: getTaskDisplayTitle(duplicateLine),
      checkboxToken: parsed.token,
      isCalendarTask: false,
      calendarAllDay: false,
    };
  }

  private buildTimerDuplicateTaskLine(context: TaskLineContext): string {
    let next = setTaskCheckboxToken(context.rawLine, '[ ]');
    next = setTaskTitle(next, context.title || 'New task');
    for (const key of ['scheduled', 'timeEstimate', 'allDay', 'end', 'endDate', 'ends', 'duration', 'tpsId', 'subitemId']) {
      next = setInlineFieldValueOnTaskLine(next, key, null);
    }
    return next;
  }

  private promptTaskTitle(context: TaskLineContext): void {
    new TextInputModal(this.plugin.app, 'Task title', context.title, async (value) => {
      await this.updateTaskLine(context, (line) => setTaskTitle(line, value));
    }).open();
  }

  private promptInlineValue(context: TaskLineContext, property: CustomProperty, current: string): void {
    new TextInputModal(this.plugin.app, property.label || property.key, current, async (value) => {
      const next = property.type === 'number' && String(value || '').trim()
        ? String(Number(value))
        : String(value || '').trim();
      await this.updateTaskLine(context, (line) => setInlineFieldValueOnTaskLine(line, property.key, next || null));
    }).open();
  }

  private async updateTaskLine(
    context: TaskLineContext,
    updater: (line: string) => string,
    options: { checkboxMutation?: boolean } = {},
  ): Promise<void> {
    let changed = false;
    let previousMarker: string | null = null;
    let nextMarker: string | null = null;
    let updatedLines: string[] | null = null;

    await this.plugin.app.vault.process(context.file, (content) => {
      const newline = content.includes('\r\n') ? '\r\n' : '\n';
      const endsWithNewline = /\r?\n$/.test(content);
      const lines = content.split(/\r?\n/);
      if (endsWithNewline) lines.pop();
      const lineIndex = this.resolveLineIndex(lines, context);
      if (lineIndex < 0) return content;
      const currentLine = lines[lineIndex] || '';
      const currentParsed = parseTaskLine(currentLine);
      if (!currentParsed) return content;
      let nextLine = updater(currentLine);
      if (nextLine === currentLine) return content;
      const nextParsed = parseTaskLine(nextLine);
      if (options.checkboxMutation === true) {
        nextLine = updateTaskCompletedDateForCheckboxState(nextLine, nextParsed?.marker ?? currentParsed.marker, {
          completeMarkers: this.getCompleteMarkers(),
        });
      }
      nextLine = updateTaskLineTimestamps(nextLine, {
        modifiedKey: this.plugin.settings.dateModifiedFrontmatterKey,
        format: this.plugin.settings.fileTimestampFormat,
        markModified: true,
      });
      lines[lineIndex] = nextLine;
      context.lineIndex = lineIndex;
      context.lineNumber = lineIndex + 1;
      context.rawLine = nextLine;
      context.title = getTaskDisplayTitle(nextLine);
      context.checkboxToken = nextParsed?.token || currentParsed.token;
      previousMarker = currentParsed.marker;
      nextMarker = nextParsed?.marker ?? currentParsed.marker;
      updatedLines = [...lines];
      changed = true;
      return `${lines.join(newline)}${endsWithNewline ? newline : ''}`;
    });

    if (!changed) return;

    if (options.checkboxMutation === true && updatedLines) {
      await this.plugin.taskCheckboxHandler.handleExternalChecklistStateMutation(
        context.file,
        previousMarker,
        nextMarker,
        updatedLines,
      );
    }
    this.plugin.eventService.emitFilesUpdated([context.file.path]);
    this.plugin.overlayRenderingService?.invalidate({
      reason: 'task-line-context-menu-write',
      file: context.file,
      surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
      rebuildInlineSubitems: true,
      refreshLivePreviewEditors: true,
      delayMs: 80,
    });
  }

  private async updateTaskLines(
    contexts: TaskLineContext[],
    updater: (line: string, context: TaskLineContext) => string,
    options: { checkboxMutation?: boolean } = {},
  ): Promise<void> {
    const uniqueContexts = this.getUniqueContexts(contexts);
    const updatedPaths = new Set<string>();
    for (const context of uniqueContexts) {
      await this.updateTaskLine(context, (line) => updater(line, context), options);
      updatedPaths.add(context.file.path);
    }
    if (updatedPaths.size > 0) {
      this.refreshSelectionAfterWrites(uniqueContexts);
      this.refreshTaskSelectionHighlights();
    }
  }

  private async archiveSelectedTasks(contexts: TaskLineContext[]): Promise<void> {
    const uniqueContexts = this.getUniqueContexts(contexts);
    for (const context of this.getMutationOrderedContexts(uniqueContexts)) {
      await this.plugin.dailyInboxLineService.archiveTaskLine(context);
      this.selectedTaskContexts.delete(this.getTaskContextKey(context));
    }
    this.refreshTaskSelectionHighlights();
    new Notice(`Archived ${uniqueContexts.length} tasks.`);
  }

  private promptMoveSelectedTasksToFile(contexts: TaskLineContext[]): void {
    const uniqueContexts = this.getUniqueContexts(contexts);
    new FileSuggestModal(this.plugin.app, async (targetFile) => {
      if (uniqueContexts.some((context) => context.file.path === targetFile.path)) {
        new Notice('Choose a different file when moving selected tasks.');
        return;
      }
      for (const context of this.getMutationOrderedContexts(uniqueContexts)) {
        await this.moveTaskToFile(context, targetFile);
        this.selectedTaskContexts.delete(this.getTaskContextKey(context));
      }
      this.refreshTaskSelectionHighlights();
      new Notice(`Moved ${uniqueContexts.length} tasks.`);
    }, { extensions: ['md'] }).open();
  }

  private async deleteSelectedTasks(contexts: TaskLineContext[]): Promise<void> {
    const uniqueContexts = this.getUniqueContexts(contexts);
    for (const context of this.getMutationOrderedContexts(uniqueContexts)) {
      await this.deleteTask(context);
      this.selectedTaskContexts.delete(this.getTaskContextKey(context));
    }
    this.refreshTaskSelectionHighlights();
    new Notice(`Deleted ${uniqueContexts.length} tasks.`);
  }

  private getUniqueContexts(contexts: TaskLineContext[]): TaskLineContext[] {
    const unique = new Map<string, TaskLineContext>();
    for (const context of contexts) {
      unique.set(this.getTaskContextKey(context), context);
    }
    return [...unique.values()];
  }

  private getTaskContextKey(context: TaskLineContext): string {
    return `${context.file.path}:${Math.max(0, Math.floor(Number(context.lineIndex) || 0))}`;
  }

  private getMutationOrderedContexts(contexts: TaskLineContext[]): TaskLineContext[] {
    return [...this.getUniqueContexts(contexts)].sort((a, b) =>
      a.file.path.localeCompare(b.file.path) || b.lineIndex - a.lineIndex);
  }

  private refreshSelectionAfterWrites(contexts: TaskLineContext[]): void {
    for (const context of contexts) {
      const currentKey = [...this.selectedTaskContexts.entries()]
        .find(([, selected]) => selected === context)?.[0];
      if (currentKey && currentKey !== this.getTaskContextKey(context)) {
        this.selectedTaskContexts.delete(currentKey);
      }
      this.selectedTaskContexts.set(this.getTaskContextKey(context), context);
    }
  }

  private promptMoveTaskToFile(context: TaskLineContext): void {
    new FileSuggestModal(this.plugin.app, async (targetFile) => {
      await this.moveTaskToFile(context, targetFile);
    }, { extensions: ['md'] }).open();
  }

  private async moveTaskToFile(context: TaskLineContext, targetFile: TFile): Promise<void> {
    if (!(targetFile instanceof TFile) || targetFile.extension?.toLowerCase() !== 'md') {
      new Notice('Choose a Markdown file.');
      return;
    }

    const sourceFile = context.file;
    const sourceContent = await this.plugin.app.vault.cachedRead(sourceFile);
    const sourceUpdate = this.removeTaskBlockFromContent(sourceContent, context);
    if (!sourceUpdate.changed) {
      new Notice('Could not find the task block to move.');
      return;
    }
    const taskBlockLines = sourceUpdate.blockLines;

    if (targetFile.path === sourceFile.path) {
      let changed = false;
      await this.plugin.app.vault.process(sourceFile, (content) => {
        const update = this.moveTaskBlockWithinContent(content, context);
        if (!update.changed) return content;
        context.lineIndex = update.lineIndex;
        context.lineNumber = update.lineIndex + 1;
        context.rawLine = update.rawLine || context.rawLine;
        changed = true;
        return update.content;
      });
      if (!changed) {
        new Notice('Could not move the task line.');
        return;
      }
      this.notifyTaskMoved([sourceFile.path]);
      new Notice(`Moved task to the top of ${sourceFile.basename}.`);
      return;
    }

    let insertedLineIndex = -1;
    await this.plugin.app.vault.process(targetFile, (content) => {
      const inserted = insertTaskBlockAfterFrontmatter(content, taskBlockLines);
      insertedLineIndex = inserted.lineIndex;
      return inserted.content;
    });

    if (this.isDailyNoteSourceFile(sourceFile)) {
      const scratchpadBlock = buildDailyNoteScratchpadMovedTaskBlock(taskBlockLines, {
        targetPath: targetFile.path,
        movedAt: new Date(),
      });
      let preserved = false;
      await this.plugin.app.vault.process(sourceFile, (content) => {
        const update = replaceTaskBlockInContent(
          content,
          context.lineIndex,
          context.rawLine,
          context.title,
          scratchpadBlock,
        );
        if (!update.changed) return content;
        preserved = true;
        return update.content;
      });

      this.notifyTaskMoved([sourceFile.path, targetFile.path]);
      new Notice(preserved
        ? `Copied task to ${targetFile.basename}; kept a struck scratchpad record in ${sourceFile.basename}.`
        : `Copied task to ${targetFile.basename}; the original daily-note line changed before it could be marked.`);
      return;
    }

    let removed = false;
    await this.plugin.app.vault.process(sourceFile, (content) => {
      const update = this.removeTaskBlockFromContent(content, context);
      if (!update.changed) return content;
      removed = true;
      return update.content;
    });

    context.file = targetFile;
    context.lineIndex = Math.max(0, insertedLineIndex);
    context.lineNumber = context.lineIndex + 1;
    context.rawLine = taskBlockLines[0] || context.rawLine;

    this.notifyTaskMoved([sourceFile.path, targetFile.path]);
    new Notice(removed
      ? `Moved task to ${targetFile.basename}.`
      : `Copied task to ${targetFile.basename}; the original line changed before it could be removed.`);
  }

  private isDailyNoteSourceFile(file: TFile): boolean {
    return parseDailyNoteFileDate(this.plugin.app, this.plugin.settings, file) !== null;
  }

  private moveTaskBlockWithinContent(content: string, context: TaskLineContext): { content: string; changed: boolean; lineIndex: number; rawLine: string } {
    const removed = this.removeTaskBlockFromContent(content, context);
    if (!removed.changed) return { content, changed: false, lineIndex: context.lineIndex, rawLine: context.rawLine };
    const inserted = insertTaskBlockAfterFrontmatter(removed.content, removed.blockLines);
    return {
      content: inserted.content,
      changed: true,
      lineIndex: inserted.lineIndex >= 0 ? inserted.lineIndex : 0,
      rawLine: removed.blockLines[0] || context.rawLine,
    };
  }

  private notifyTaskMoved(paths: string[]): void {
    this.plugin.eventService.emitFilesUpdated(Array.from(new Set(paths)));
    this.plugin.overlayRenderingService?.invalidate({
      reason: 'task-line-context-menu-move',
      surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
      rebuildInlineSubitems: true,
      refreshLivePreviewEditors: true,
      delayMs: 80,
    });
  }

  private async deleteTask(context: TaskLineContext): Promise<void> {
    let changed = false;
    await this.plugin.app.vault.process(context.file, (content) => {
      const update = this.removeTaskBlockFromContent(content, context);
      if (!update.changed) return content;
      changed = true;
      return update.content;
    });

    if (!changed) {
      new Notice('Could not find the task line to delete.');
      return;
    }

    this.plugin.eventService.emitFilesUpdated([context.file.path]);
    this.plugin.overlayRenderingService?.invalidate({
      reason: 'task-line-context-menu-delete',
      file: context.file,
      surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
      rebuildInlineSubitems: true,
      refreshLivePreviewEditors: true,
      delayMs: 80,
    });
    new Notice('Deleted task.');
  }

  private removeTaskBlockFromContent(content: string, context: TaskLineContext): { content: string; changed: boolean; blockLines: string[] } {
    const update = removeTaskBlockFromContent(content, context.lineIndex, context.rawLine, context.title);
    return {
      content: update.content,
      changed: update.changed,
      blockLines: update.block.lines,
    };
  }

  private resolveLineIndex(lines: string[], context: TaskLineContext): number {
    return findCurrentTaskLineIndex(lines, context.lineIndex, context.rawLine, context.title);
  }

  private async openTaskLine(context: TaskLineContext): Promise<void> {
    this.plugin.hideCompletedCheckboxesService?.revealCompletedForFile(context.file.path, context.lineIndex);
    await this.delay(90);
    const opened = await this.plugin.openFileInLeaf(
      context.file,
      false,
      () => this.plugin.app.workspace.getLeaf(false),
      { revealLeaf: true },
    );
    if (!opened) return;

    const leaf = this.plugin.findOpenLeafForFile(context.file) ?? this.plugin.app.workspace.activeLeaf;
    const view = leaf?.view as any;
    const editor = view?.editor;
    if (!editor || typeof editor.setCursor !== 'function') return;
    editor.setCursor({ line: context.lineIndex, ch: 0 });
    editor.scrollIntoView?.({ from: { line: context.lineIndex, ch: 0 }, to: { line: context.lineIndex + 1, ch: 0 } }, true);
    editor.focus?.();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private isTaskMenuProperty(property: CustomProperty, statusKey: string): boolean {
    if (!property || property.disabled || property.hidden || property.showInContextMenu === false || property.allowInlineSet === false) return false;
    const key = String(property.key || '').trim().toLowerCase();
    const id = String(property.id || '').trim().toLowerCase();
    if (!key) return false;
    if (key === 'title' || id === 'title' || key === 'folderpath' || property.type === 'folder' || property.type === 'snooze') return false;
    if (key === statusKey || id === 'status') return false;
    return true;
  }

  private getStatusKey(): string {
    const configured = this.plugin.settings.properties?.find((prop) => prop.id === 'status')?.key;
    return String(configured || 'status').trim() || 'status';
  }

  private getCheckboxMappings(): LinkedSubitemCheckboxMapping[] {
    return normalizeLinkedSubitemMappings(this.plugin.settings.linkedSubitemCheckboxMappings || [], {
      enforceStrictDefaults: false,
    });
  }

  private getStatusForCheckboxToken(token: string): string {
    return mapSubitemCheckboxStateToStatus(this.getCheckboxMappings(), token) || '';
  }

  private getCompleteMarkers(): string[] {
    return getLinkedSubitemCompleteMarkers(this.getCheckboxMappings());
  }

  private normalizeCheckboxToken(value: string): string {
    const raw = String(value || '').trim();
    if (/^\[[^\]\r\n]?\]$/.test(raw)) return raw;
    if (raw.length <= 1) return `[${raw || ' '}]`;
    return '';
  }

  private parseListValue(value: string): string[] {
    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private joinUnique(values: string[]): string {
    const seen = new Set<string>();
    return values
      .map((value) => String(value || '').trim())
      .filter((value) => {
        const key = value.toLowerCase();
        if (!value || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join(', ');
  }

  private getTaskSearchTextVariants(value: string): string[] {
    const raw = String(value || '').trim();
    if (!raw) return [];
    const withoutCheckbox = raw
      .replace(/^toggle task:\s*/i, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]*\]\s+/, '')
      .replace(/^\s*[☐☑✓✔]\s*/, '')
      .trim();
    const withoutInlineFields = withoutCheckbox
      .replace(/\[[^\]\n]+::[^\]\n]*\]/g, ' ')
      .replace(/\b(?:todo|complete|wont-do|working|all day:\s*(?:true|false)|allDay:\s*(?:true|false))\b/gi, ' ')
      .replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b/gi, ' ')
      .replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+\w+\s+\d{1,2}\s+\d{4}\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return [raw, withoutCheckbox, withoutInlineFields].filter(Boolean);
  }

  private normalizeTaskText(value: string): string {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
}

class TaskTimerScheduledConflictModal extends Modal {
  constructor(
    app: App,
    private readonly taskTitle: string,
    private readonly callbacks: {
      overwrite: () => void;
      duplicate: () => Promise<void> | void;
    },
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('mod-tps-gcm');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Task already has a scheduled time' });
    contentEl.createEl('p', {
      text: `Starting a timer for "${this.taskTitle}" will update its scheduled time and duration. Choose whether to overwrite the existing time or create a new task underneath it for this timer.`,
    });

    const buttonRow = contentEl.createDiv({ cls: 'tps-gcm-confirm-buttons' });
    buttonRow.createEl('button', { text: 'Overwrite time', cls: 'mod-warning' }).addEventListener('click', () => {
      this.close();
      this.callbacks.overwrite();
    });
    buttonRow.createEl('button', { text: 'Create new task', cls: 'mod-cta' }).addEventListener('click', () => {
      this.close();
      void this.callbacks.duplicate();
    });
    buttonRow.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class DailyNoteTaskMovePromptModal extends Modal {
  constructor(
    app: App,
    private readonly options: {
      taskTitle: string;
      sourceDate: string;
      targetDate: string;
      targetFile: TFile;
      onMove: () => Promise<void> | void;
    },
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('mod-tps-gcm');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Move task to scheduled Daily Note?' });
    contentEl.createEl('p', {
      text: `"${this.options.taskTitle}" is in the ${this.options.sourceDate} Daily Note, but it is now scheduled for ${this.options.targetDate}.`,
    });
    contentEl.createEl('p', {
      text: `Move the full task block to ${this.options.targetFile.basename}, or keep it in the current note with the explicit scheduled value.`,
    });

    const buttonRow = contentEl.createDiv({ cls: 'tps-gcm-confirm-buttons' });
    buttonRow.createEl('button', { text: 'Move task', cls: 'mod-cta' }).addEventListener('click', () => {
      this.close();
      void this.options.onMove();
    });
    buttonRow.createEl('button', { text: 'Keep here' }).addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
