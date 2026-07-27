import { App, Menu, Modal, Notice, TFile, setIcon } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { FileSuggestModal } from '../modals/FileSuggestModal';
import { RecurrenceModal } from '../modals/recurrence-modal';
import { ScheduledModal } from '../modals/scheduled-modal';
import { TextInputModal } from '../modals/text-input-modal';
import { promptNestedLineDelete } from '../modals/nested-line-delete-modal';
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
  convertTaskLineToBullet,
  getTaskDisplayTitle,
  getPlainTaskTitle,
  getTaskSourceTitle,
  getTaskEditableBody,
  parseTaskTitleLink,
  parseTaskLine,
  readInlineFieldValue,
  readInlineTags,
  readTaskAssociatedNotePath,
  removeInlineTagFromTaskLine,
  setInlineFieldValueOnTaskLine,
  setTaskCheckboxToken,
  setTaskEditableBody,
  setTaskTitle,
  stripTaskInlinePropsMetadata,
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
import * as logger from '../logger';
import { KeyboardAwareOverlay } from '../utils/mobile-overlay';
import { getOrderedSelectionRange } from '../utils/ordered-selection';
import { matchTaskHighlightMetadata } from '../utils/task-highlight-metadata';
import { buildTaskLineCandidateIndexes, resolveTaskLineIndex } from '../utils/task-line-resolution';
import {
  inspectLineItemDeleteTarget,
  performLineItemDelete,
  requestLineItemDelete,
  type LineItemDeleteTarget,
} from './line-item-delete-service';
import type { LineItemDeleteMode } from '../utils/line-item-deletion';
import { resolveCustomProperties } from '../resolve-profiles';
import { ViewModeService } from './view-mode-service';
import {
  applyTaskEditorPropertyChanges,
  applyTaskEditorScheduleResult,
  buildTaskEditorPropertyChange,
  collectTaskEditorProperties,
  isTruthyTaskPropertyValue,
  normalizeTaskEditorPropertyValue,
  type TaskEditorPropertyChange,
  type TaskEditorPropertyDescriptor,
} from './task-editor-properties';
import {
  isEntityReferenceProperty,
  mergeEntityReferenceList,
  removeEntityReferenceListValues,
} from '../utils/entity-property';
import { openEntitySuggestModal } from '../modals/EntitySuggestModal';
import {
  getWikilinkDisplayText,
  parseLinkListInput,
} from '../utils/list-utils';

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

type TaskEditorPropertyDraft = {
  descriptor: TaskEditorPropertyDescriptor;
  initialValue: string;
  getValue: () => string;
  setDisabled: (disabled: boolean) => void;
  focus: () => void;
  getValidationError: () => string | null;
};

const KANBAN_TASK_SELECTOR = [
  '[data-tps-gcm-context="kanban-task"]',
  '[data-tps-gcm-context="calendar-task"]',
  '[data-tps-gcm-context="table-task"]',
  '.tps-kanban-card-task[data-task-path][data-task-line]',
  '.tps-kanban-task-card[data-task-path][data-task-line]',
  '.tps-calendar-task-entry[data-task-path][data-task-line]',
  '.task-list-item',
  'input.task-list-item-checkbox',
].join(', ');

function taskElSurface(element: HTMLElement): string {
  if (element.closest('.tps-log-base')) return 'tps-table';
  if (element.closest('.tps-list-native')) return 'tps-list';
  if (element.closest('.tps-kanban-container')) return 'tps-kanban';
  if (element.closest('.tps-calendar-entry, .bases-calendar-view')) return 'calendar';
  if (element.closest('.markdown-source-view')) return 'markdown-editor';
  if (element.closest('.markdown-reading-view, .markdown-preview-view, .markdown-rendered')) return 'markdown-reading';
  return 'unknown';
}

export class TaskLineContextMenuService {
  private selectedTaskContexts = new Map<string, TaskLineContext>();
  private taskSelectionAnchor: TaskLineContext | null = null;
  private tpsListSelectionSyncGeneration = 0;
  private tpsListSelectionOwner: HTMLElement | null = null;
  private activeHighlightEls = new Set<HTMLElement>();
  private selectedHighlightEls = new Set<HTMLElement>();
  private taskEditorEl: HTMLElement | null = null;
  private taskEditorOutsideHandler: ((evt: MouseEvent) => void) | null = null;
  private taskEditorOverlay: KeyboardAwareOverlay | null = null;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  dispose(): void {
    this.closeTaskEditor();
    this.clearTaskSelection();
  }

  async openQuickEditorForElement(taskEl: HTMLElement, sourceEl: HTMLElement | null = taskEl): Promise<boolean> {
    const context = await this.resolveContext(taskEl, sourceEl);
    if (!context) {
      logger.flowWarn('TaskQuickEditor', 'open:unresolved', {
        path: taskEl.dataset.taskPath || taskEl.dataset.tpsKanbanPath || taskEl.dataset.path || '',
        lineNumber: taskEl.dataset.taskLine || taskEl.dataset.tpsKanbanLine || '',
      });
      new Notice('Could not resolve the task line.');
      return false;
    }
    this.showTaskEditor(context, taskEl);
    return true;
  }

  handleContextMenu(evt: MouseEvent): boolean {
    const target = evt.target instanceof HTMLElement ? evt.target : null;
    if (this.isTaskInteractionBoundary(target) || this.isTaskPropertyTarget(target)) return false;
    const taskEl = this.resolveTaskElement(target);
    if (!taskEl) return false;
    const listSelection = taskElSurface(taskEl) === 'tps-list'
      ? this.routeTpsListSelection(evt, taskEl, true)
      : null;

    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();

    void (listSelection ?? Promise.resolve()).then(() => this.resolveContext(taskEl, target)).then((context) => {
      if (!context) {
        new Notice('Could not resolve the task line.');
        return;
      }
      this.showMenu(context, taskEl, evt.pageX, evt.pageY);
    });
    return true;
  }

  handleClick(evt: MouseEvent): boolean {
    const target = evt.target instanceof HTMLElement ? evt.target : null;
    if (this.isTaskInteractionBoundary(target)) return false;
    if (target?.matches('input.task-list-item-checkbox, input[type="checkbox"]')) return false;
    if (this.isTaskEditorExcludedTarget(target)) return false;
    const taskEl = this.resolveTaskElement(target);
    if (!taskEl) return false;
    if (!this.isTaskEditorActivationTarget(target, taskEl)) return false;
    const surface = taskElSurface(taskEl);
    if (surface === 'tps-table' && (evt.shiftKey || evt.metaKey || evt.ctrlKey)) return false;
    const listSelection = surface === 'tps-list' ? this.routeTpsListSelection(evt, taskEl) : null;
    if (listSelection && (evt.shiftKey || evt.metaKey || evt.ctrlKey)) {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      void listSelection;
      return true;
    }

    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();

    void this.resolveContext(taskEl, target).then(async (context) => {
      if (!context) {
        new Notice('Could not resolve the task line.');
        return;
      }
      if (evt.shiftKey && surface === 'tps-list') {
        await this.selectTaskRange(context, taskEl, surface);
        return;
      }
      if (evt.metaKey || evt.ctrlKey) {
        this.toggleSelectedTask(context, taskEl, surface);
        return;
      }
      this.taskSelectionAnchor = { ...context };
      this.showTaskEditor(context, taskEl);
    });
    return true;
  }

  private routeTpsListSelection(
    evt: MouseEvent,
    taskEl: HTMLElement,
    preserveIfSelected = false,
  ): Promise<void> | null {
    const scrollEl = taskEl.closest<HTMLElement>('.tps-list-scroll');
    const view = (scrollEl as any)?.__tpsListView as {
      applyTpsListRowSelection?: (
        event: MouseEvent,
        target: HTMLElement,
        preserve?: boolean,
      ) => Promise<void>;
    } | undefined;
    if (typeof view?.applyTpsListRowSelection !== 'function') return null;
    return view.applyTpsListRowSelection(evt, taskEl, preserveIfSelected);
  }

  private isTaskEditorExcludedTarget(target: HTMLElement | null): boolean {
    if (!target) return false;
    const interactive = target.closest<HTMLElement>(
      'a, input, textarea, select, [contenteditable="true"], .tps-list-native-property, .metadata-property, .clickable-icon, button',
    );
    if (!interactive) return false;
    return !interactive.matches('.tps-list-native-title-button');
  }

  private isTaskInteractionBoundary(target: HTMLElement | null): boolean {
    return Boolean(target?.closest([
      '.modal',
      '.modal-container',
      '.menu',
      '.popover',
      '.hover-popover',
      '.suggestion-container',
      '.prompt',
      '.tps-gcm-task-editor-card',
      '.tps-gcm-base-link-preview',
      '.tps-home-native-capture-editor',
    ].join(', ')));
  }

  private isTaskPropertyTarget(target: HTMLElement | null): boolean {
    return Boolean(target?.closest([
      '.tps-list-native-property',
      '.tps-list-native-property-input',
      '.metadata-property',
      '.metadata-container',
    ].join(', ')));
  }

  private isTaskEditorActivationTarget(target: HTMLElement | null, taskEl: HTMLElement): boolean {
    if (!target) return false;
    if (taskEl.closest('[data-tps-gcm-context="table-task"]')) {
      return Boolean(target.closest(
        '.tps-log-base-cell[data-key="title"], .tps-log-base-cell[data-key="line"], .tps-log-base-cell[data-key$=".title"]',
      ));
    }
    if (taskEl.closest('.tps-list-native-row--task')) {
      return Boolean(target.closest('.tps-list-native-title-button, .tps-list-native-title'));
    }
    return true;
  }

  private showTaskEditor(context: TaskLineContext, anchorEl: HTMLElement): void {
    this.closeTaskEditor();
    const card = document.body.createDiv({ cls: 'tps-gcm-task-editor-card' });
    card.dataset.path = context.file.path;
    card.dataset.line = String(context.lineNumber);
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', `Edit task in ${context.file.basename}`);

    const header = card.createDiv({ cls: 'tps-gcm-task-editor-header' });
    const headerMain = header.createDiv({ cls: 'tps-gcm-task-editor-header-main' });
    const icon = headerMain.createSpan({ cls: 'tps-gcm-task-editor-icon' });
    setIcon(icon, 'square-pen');
    const heading = headerMain.createDiv({ cls: 'tps-gcm-task-editor-heading' });
    heading.createDiv({ cls: 'tps-gcm-task-editor-title', text: 'Edit task' });
    heading.createDiv({
      cls: 'tps-gcm-task-editor-source',
      text: `${context.file.basename} · line ${context.lineNumber}`,
      attr: { title: context.file.path },
    });
    const closeButton = header.createEl('button', {
      cls: 'tps-gcm-task-editor-close clickable-icon',
      attr: { type: 'button', 'aria-label': 'Close task editor' },
    });
    setIcon(closeButton, 'x');

    const editorRow = card.createDiv({ cls: 'tps-gcm-task-editor-row' });
    const checkboxButton = editorRow.createEl('input', {
      cls: 'task-list-item-checkbox tps-gcm-task-editor-checkbox',
      attr: {
        type: 'checkbox',
      },
    });
    const input = editorRow.createEl('textarea', {
      cls: 'tps-gcm-task-editor-input',
      attr: {
        rows: '4',
        spellcheck: 'true',
        'aria-label': 'Task content',
      },
    });
    const initialBody = getTaskEditableBody(context.rawLine);
    input.value = initialBody;
    this.renderTaskEditorCheckbox(checkboxButton, context);

    let childModalCount = 0;
    const setChildModalOpen = (open: boolean): void => {
      childModalCount = Math.max(0, childModalCount + (open ? 1 : -1));
      card.toggleClass('is-child-modal-open', childModalCount > 0);
      if (childModalCount === 0 && card.isConnected) {
        window.setTimeout(() => this.taskEditorOverlay?.schedule(), 0);
      }
    };
    const openChildModal = (modal: Modal, focusTarget: HTMLElement): void => {
      const originalOnClose = modal.onClose.bind(modal);
      let resumed = false;
      modal.onClose = () => {
        try {
          originalOnClose();
        } finally {
          if (!resumed) {
            resumed = true;
            setChildModalOpen(false);
            if (card.isConnected) window.setTimeout(() => focusTarget.focus(), 0);
          }
        }
      };
      setChildModalOpen(true);
      modal.open();
    };

    let checkboxBusy = false;
    let longPressTimer: number | null = null;
    let longPressTriggered = false;
    const clearLongPress = (): void => {
      if (longPressTimer !== null) window.clearTimeout(longPressTimer);
      longPressTimer = null;
    };
    const openStatusMenu = (): void => {
      this.showTaskEditorStatusMenu(context, checkboxButton, () => {
        this.renderTaskEditorCheckbox(checkboxButton, context);
      });
    };
    const toggleCheckbox = async (): Promise<void> => {
      if (checkboxBusy) return;
      checkboxBusy = true;
      checkboxButton.disabled = true;
      try {
        const mappings = this.getCheckboxMappings();
        const marker = parseTaskLine(context.rawLine)?.marker || ' ';
        const completeMarkers = new Set(this.getCompleteMarkers());
        const currentIsComplete = completeMarkers.has(marker);
        const nextMapping = currentIsComplete
          ? mappings.find((mapping) => mapping.checkboxState === '[ ]')
          : mappings.find((mapping) => completeMarkers.has(parseTaskLine(`- ${mapping.checkboxState} item`)?.marker || ''));
        const nextToken = nextMapping?.checkboxState || (currentIsComplete ? '[ ]' : '[x]');
        const updated = await this.updateTaskLine(context, (line) => setTaskCheckboxToken(line, nextToken), {
          checkboxMutation: true,
        });
        if (!updated) return;
        logger.flow('TaskQuickEditor', 'status:toggle', {
          path: context.file.path,
          lineNumber: context.lineNumber,
          checkboxState: nextToken,
        });
        this.renderTaskEditorCheckbox(checkboxButton, context);
      } finally {
        checkboxBusy = false;
        checkboxButton.disabled = false;
      }
    };
    checkboxButton.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || checkboxBusy) return;
      clearLongPress();
      longPressTriggered = false;
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        if (!checkboxButton.isConnected) return;
        longPressTriggered = true;
        checkboxButton.addClass('is-long-pressing');
      }, 500);
    });
    checkboxButton.addEventListener('pointerup', () => {
      const shouldOpen = longPressTriggered;
      clearLongPress();
      checkboxButton.removeClass('is-long-pressing');
      if (shouldOpen) openStatusMenu();
    });
    checkboxButton.addEventListener('pointercancel', () => {
      clearLongPress();
      longPressTriggered = false;
      checkboxButton.removeClass('is-long-pressing');
    });
    checkboxButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (longPressTriggered) {
        longPressTriggered = false;
        return;
      }
      void toggleCheckbox();
    });
    checkboxButton.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearLongPress();
      longPressTriggered = false;
      openStatusMenu();
    });

    const propertyDrafts: TaskEditorPropertyDraft[] = [];
    let scheduledCompanions: {
      initialTimeEstimate: string;
      initialAllDay: string;
      timeEstimate: string;
      allDay: string;
    } | null = null;
    const propertyDescriptors = collectTaskEditorProperties(
      context.rawLine,
      this.plugin.settings.properties || [],
      this.getStatusKey(),
      [
        this.plugin.settings.dateCreatedFrontmatterKey,
        this.plugin.settings.dateModifiedFrontmatterKey,
      ],
    );
    if (propertyDescriptors.length > 0) {
      const propertiesEl = card.createDiv({ cls: 'tps-gcm-task-editor-properties' });
      propertiesEl.createDiv({
        cls: 'tps-gcm-task-editor-properties-title',
        text: 'Properties',
      });

      const scheduleOverlay = (target: HTMLElement): void => {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        this.taskEditorOverlay?.schedule();
      };
      const configureControl = (control: HTMLElement): void => {
        control.addEventListener('focus', () => scheduleOverlay(control));
        control.addEventListener('input', () => this.taskEditorOverlay?.schedule());
      };
      const addDraft = (
        descriptor: TaskEditorPropertyDescriptor,
        getValue: () => string,
        setDisabled: (disabled: boolean) => void,
        focus: () => void,
        getValidationError: () => string | null = () => null,
      ): void => {
        propertyDrafts.push({
          descriptor,
          initialValue: normalizeTaskEditorPropertyValue(descriptor, descriptor.value),
          getValue,
          setDisabled,
          focus,
          getValidationError,
        });
      };

      for (const descriptor of propertyDescriptors) {
        const propertyEl = propertiesEl.createDiv({ cls: 'tps-gcm-task-editor-property' });
        const labelEl = propertyEl.createDiv({ cls: 'tps-gcm-task-editor-property-label' });
        labelEl.createSpan({
          cls: 'tps-gcm-task-editor-property-name',
          text: descriptor.label,
        });
        if (descriptor.label.toLowerCase() !== descriptor.key.toLowerCase()) {
          labelEl.createSpan({
            cls: 'tps-gcm-task-editor-property-key',
            text: descriptor.key,
          });
        }
        const controlEl = propertyEl.createDiv({ cls: 'tps-gcm-task-editor-property-control' });
        const ariaLabel = `${descriptor.label} property`;

        if (isEntityReferenceProperty(descriptor.property)) {
          let value = descriptor.value;
          const control = controlEl.createEl('button', {
            cls: 'tps-gcm-task-editor-property-button',
            attr: { type: 'button', 'aria-label': ariaLabel },
          });
          const renderValue = (): void => {
            const links = descriptor.type === 'list' ? parseLinkListInput(value) : value ? [value] : [];
            control.textContent = links.length > 0
              ? links.map((link) => getWikilinkDisplayText(link)).join(', ')
              : `Choose ${descriptor.label}…`;
            control.toggleClass('is-empty', links.length === 0);
            control.setAttribute('title', value || `Choose ${descriptor.label}`);
          };
          renderValue();
          control.addEventListener('click', () => {
            openEntitySuggestModal(this.plugin.app, this.plugin, descriptor.property, (choice) => {
              value = descriptor.type === 'list'
                ? mergeEntityReferenceList(value, choice.wikilink).join(', ')
                : choice.wikilink;
              renderValue();
              this.taskEditorOverlay?.schedule();
            });
          });
          configureControl(control);
          addDraft(
            descriptor,
            () => value,
            (disabled) => { control.disabled = disabled; },
            () => control.focus(),
          );
          continue;
        }

        if (descriptor.type === 'checkbox') {
          const control = controlEl.createEl('input', {
            cls: 'tps-gcm-task-editor-property-checkbox',
            attr: { type: 'checkbox', 'aria-label': ariaLabel },
          });
          control.checked = isTruthyTaskPropertyValue(descriptor.value);
          configureControl(control);
          addDraft(
            descriptor,
            () => (control.checked ? 'true' : 'false'),
            (disabled) => { control.disabled = disabled; },
            () => control.focus(),
          );
          continue;
        }

        if (descriptor.type === 'datetime') {
          let value = descriptor.value;
          const isScheduled = descriptor.key.trim().toLowerCase() === 'scheduled';
          if (isScheduled) {
            const initialTimeEstimate = readInlineFieldValue(context.rawLine, 'timeEstimate');
            const initialAllDay = readInlineFieldValue(context.rawLine, 'allDay');
            scheduledCompanions = {
              initialTimeEstimate,
              initialAllDay,
              timeEstimate: initialTimeEstimate,
              allDay: initialAllDay,
            };
          }
          const control = controlEl.createEl('button', {
            cls: 'tps-gcm-task-editor-property-button',
            attr: { type: 'button', 'aria-label': ariaLabel },
          });
          const renderValue = (): void => {
            control.textContent = value || 'Set date…';
            control.toggleClass('is-empty', !value);
            control.setAttribute('title', value || `Set ${descriptor.label}`);
          };
          renderValue();
          control.addEventListener('click', () => {
            const timeEstimate = isScheduled && scheduledCompanions
              ? Number.parseInt(scheduledCompanions.timeEstimate || '0', 10) || 0
              : 0;
            const allDay = isScheduled && scheduledCompanions
              ? isTruthyTaskPropertyValue(scheduledCompanions.allDay)
              : false;
            const modal = new ScheduledModal(this.plugin.app, value, timeEstimate, allDay, (result) => {
              value = result.date;
              scheduledCompanions = applyTaskEditorScheduleResult(
                descriptor.key,
                scheduledCompanions,
                result,
              );
              renderValue();
              this.taskEditorOverlay?.schedule();
            }, isScheduled ? {} : {
              title: `Set ${descriptor.label || descriptor.key}`,
              fieldLabel: descriptor.label || descriptor.key,
              showTimeDetails: false,
            });
            openChildModal(modal, control);
          });
          configureControl(control);
          addDraft(
            descriptor,
            () => value,
            (disabled) => { control.disabled = disabled; },
            () => control.focus(),
          );
          continue;
        }

        if (descriptor.type === 'recurrence') {
          let value = descriptor.value;
          const control = controlEl.createEl('button', {
            cls: 'tps-gcm-task-editor-property-button',
            attr: { type: 'button', 'aria-label': ariaLabel },
          });
          const renderValue = (): void => {
            control.textContent = value || 'Set recurrence…';
            control.toggleClass('is-empty', !value);
            control.setAttribute('title', value || `Set ${descriptor.label}`);
          };
          renderValue();
          control.addEventListener('click', () => {
            const scheduledDraft = propertyDrafts.find((draft) => (
              draft.descriptor.key.trim().toLowerCase() === 'scheduled'
            ));
            const scheduled = scheduledDraft?.getValue() || readInlineFieldValue(context.rawLine, 'scheduled');
            const startDate = scheduled ? new Date(scheduled.replace(' ', 'T')) : new Date();
            const modal = new RecurrenceModal(
              this.plugin.app,
              value,
              Number.isNaN(startDate.getTime()) ? new Date() : startDate,
              '',
              (rule) => {
                value = String(rule || '').trim();
                renderValue();
                this.taskEditorOverlay?.schedule();
              },
              { showEndsOn: false },
            );
            openChildModal(modal, control);
          });
          configureControl(control);
          addDraft(
            descriptor,
            () => value,
            (disabled) => { control.disabled = disabled; },
            () => control.focus(),
          );
          continue;
        }

        if (descriptor.type === 'selector') {
          const control = controlEl.createEl('select', {
            cls: 'tps-gcm-task-editor-property-input',
            attr: { 'aria-label': ariaLabel },
          });
          control.createEl('option', { text: '(none)', value: '' });
          const options = getEffectivePropertyOptions(this.plugin.app, descriptor.property);
          if (descriptor.value && !options.some((option) => option === descriptor.value)) {
            control.createEl('option', { text: descriptor.value, value: descriptor.value });
          }
          for (const option of options) {
            control.createEl('option', { text: option, value: option });
          }
          control.value = descriptor.value;
          configureControl(control);
          addDraft(
            descriptor,
            () => control.value,
            (disabled) => { control.disabled = disabled; },
            () => control.focus(),
          );
          continue;
        }

        const control = controlEl.createEl('input', {
          cls: 'tps-gcm-task-editor-property-input',
          attr: {
            type: 'text',
            inputmode: descriptor.type === 'number' ? 'decimal' : 'text',
            value: descriptor.value,
            'aria-label': ariaLabel,
            placeholder: descriptor.type === 'list' ? 'Comma-separated values' : '',
          },
        });
        if (descriptor.type === 'number') control.step = 'any';
        const getValidationError = (): string | null => {
          if (descriptor.type !== 'number') return null;
          const rawValue = control.value.trim();
          const invalid = control.validity.badInput || Boolean(rawValue && !Number.isFinite(Number(rawValue)));
          control.setAttribute('aria-invalid', String(invalid));
          return invalid ? `${descriptor.label || descriptor.key} must be a valid number.` : null;
        };
        control.addEventListener('input', () => {
          if (control.getAttribute('aria-invalid') === 'true') getValidationError();
        });
        configureControl(control);
        addDraft(
          descriptor,
          () => control.value,
          (disabled) => { control.disabled = disabled; },
          () => control.focus(),
          getValidationError,
        );
      }
    }

    const hint = card.createDiv({
      cls: 'tps-gcm-task-editor-hint',
      text: propertyDrafts.length > 0
        ? 'Edit task text, tags, and existing properties. Hidden TPS metadata stays attached. ⌘↵ saves.'
        : 'Edit task text and tags. Hidden TPS metadata stays attached. ⌘↵ saves.',
    });
    const actions = card.createDiv({ cls: 'tps-gcm-task-editor-actions' });
    const openButton = actions.createEl('button', { text: 'Open in note', attr: { type: 'button' } });
    const actionSpacer = actions.createDiv({ cls: 'tps-gcm-task-editor-action-spacer' });
    void actionSpacer;
    const cancelButton = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
    const saveButton = actions.createEl('button', {
      cls: 'mod-cta',
      text: 'Save',
      attr: { type: 'button' },
    });

    let saving = false;
    const save = async (): Promise<void> => {
      if (saving) return;
      const nextBody = input.value.trim();
      if (!nextBody) {
        new Notice('Task content cannot be empty.');
        input.focus();
        return;
      }
      const propertyChanges: TaskEditorPropertyChange[] = [];
      for (const draft of propertyDrafts) {
        const rawValue = draft.getValue();
        const change = buildTaskEditorPropertyChange(draft.descriptor, draft.initialValue, rawValue);
        if (!change) continue;
        const validationError = draft.getValidationError();
        if (validationError) {
          new Notice(validationError);
          draft.focus();
          return;
        }
        if (draft.descriptor.type === 'number' && rawValue.trim() && !Number.isFinite(Number(rawValue))) {
          new Notice(`${draft.descriptor.label || draft.descriptor.key} must be a valid number.`);
          draft.focus();
          return;
        }
        propertyChanges.push(change);
      }
      if (scheduledCompanions) {
        if (scheduledCompanions.timeEstimate !== scheduledCompanions.initialTimeEstimate) {
          propertyChanges.push({
            key: 'timeEstimate',
            value: scheduledCompanions.timeEstimate || null,
          });
        }
        if (scheduledCompanions.allDay !== scheduledCompanions.initialAllDay) {
          propertyChanges.push({
            key: 'allDay',
            value: scheduledCompanions.allDay || null,
          });
        }
      }
      const bodyChanged = nextBody !== initialBody;
      if (!bodyChanged && propertyChanges.length === 0) {
        this.closeTaskEditor();
        return;
      }
      saving = true;
      input.disabled = true;
      checkboxButton.disabled = true;
      propertyDrafts.forEach((draft) => draft.setDisabled(true));
      saveButton.disabled = true;
      try {
        const updated = await this.updateTaskLine(context, (line) => {
          const editedBody = bodyChanged ? setTaskEditableBody(line, nextBody) : line;
          return applyTaskEditorPropertyChanges(editedBody, propertyChanges);
        });
        if (!updated) {
          saving = false;
          input.disabled = false;
          checkboxButton.disabled = false;
          propertyDrafts.forEach((draft) => draft.setDisabled(false));
          saveButton.disabled = false;
          input.focus();
          return;
        }
        logger.flow('TaskQuickEditor', 'save', {
          path: context.file.path,
          lineNumber: context.lineNumber,
          bodyChanged,
          changedPropertyKeys: propertyChanges.map((change) => change.key),
        });
        this.closeTaskEditor();
        const scheduledChange = propertyChanges.find((change) => change.key.toLowerCase() === 'scheduled');
        if (scheduledChange) {
          await this.maybePromptMoveScheduledDailyNoteTask(context, scheduledChange.value || '');
        }
      } catch (error) {
        saving = false;
        input.disabled = false;
        checkboxButton.disabled = false;
        propertyDrafts.forEach((draft) => draft.setDisabled(false));
        saveButton.disabled = false;
        logger.flowError('TaskQuickEditor', 'save-failed', error, {
          path: context.file.path,
          lineNumber: context.lineNumber,
        });
        new Notice('Could not update the task.');
        input.focus();
      }
    };

    closeButton.addEventListener('click', () => this.closeTaskEditor());
    cancelButton.addEventListener('click', () => this.closeTaskEditor());
    saveButton.addEventListener('click', () => void save());
    openButton.addEventListener('click', () => {
      this.closeTaskEditor();
      void this.openTaskLine(context);
    });
    card.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeTaskEditor();
        return;
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void save();
      }
    });

    this.taskEditorEl = card;
    this.taskEditorOverlay = new KeyboardAwareOverlay(card, anchorEl, { maxWidth: 480 });
    this.taskEditorOverlay.connect();
    this.taskEditorOutsideHandler = (event: MouseEvent) => {
      const eventTarget = event.target;
      if (eventTarget instanceof Node && card.contains(eventTarget)) return;
      if (eventTarget instanceof HTMLElement && eventTarget.closest([
        '.modal',
        '.modal-container',
        '.menu',
        '.popover',
        '.hover-popover',
        '.suggestion-container',
      ].join(', '))) return;
      if (childModalCount > 0) return;
      this.closeTaskEditor();
    };
    window.setTimeout(() => {
      if (this.taskEditorOutsideHandler) document.addEventListener('mousedown', this.taskEditorOutsideHandler, true);
      input.focus();
      input.select();
      this.taskEditorOverlay?.schedule();
    }, 0);
    logger.flow('TaskQuickEditor', 'open', {
      path: context.file.path,
      lineNumber: context.lineNumber,
      surface: taskElSurface(anchorEl),
    });
  }

  private closeTaskEditor(): void {
    this.taskEditorOverlay?.disconnect();
    this.taskEditorOverlay = null;
    if (this.taskEditorOutsideHandler) {
      document.removeEventListener('mousedown', this.taskEditorOutsideHandler, true);
      this.taskEditorOutsideHandler = null;
    }
    this.taskEditorEl?.remove();
    this.taskEditorEl = null;
  }

  private renderTaskEditorCheckbox(button: HTMLInputElement, context: TaskLineContext): void {
    const mapping = this.getCheckboxMappings().find((candidate) => candidate.checkboxState === context.checkboxToken);
    const status = this.getStatusForCheckboxToken(context.checkboxToken);
    const marker = parseTaskLine(context.rawLine)?.marker || ' ';
    const complete = this.getCompleteMarkers().includes(marker);
    button.checked = complete;
    button.indeterminate = marker !== ' ' && !complete;
    button.dataset.checkboxToken = context.checkboxToken;
    button.dataset.task = marker;
    button.setAttribute('aria-checked', button.indeterminate ? 'mixed' : String(button.checked));
    button.setAttr('aria-label', `${status || 'No mapped status'}. Click to toggle; long-press to change status.`);
    button.setAttr('title', `${status || context.checkboxToken} · Click to toggle · Long-press for status`);
  }

  private showTaskEditorStatusMenu(
    context: TaskLineContext,
    button: HTMLInputElement,
    onChanged: () => void,
  ): void {
    if (!button.isConnected) return;
    const menu = new Menu();
    for (const mapping of this.getCheckboxMappings()) {
      const status = String(mapping.statuses?.[0] || '').trim();
      const label = String(mapping.label || status || mapping.checkboxState).trim();
      const selected = mapping.checkboxState === context.checkboxToken;
      menu.addItem((item) => {
        item
          .setTitle(selected ? `${label} — Selected` : label)
          .setIcon(mapping.icon || 'square')
          .setChecked(selected)
          .onClick(() => {
            void this.updateTaskLine(context, (line) => setTaskCheckboxToken(line, mapping.checkboxState), {
              checkboxMutation: true,
            }).then((updated) => {
              if (!updated) return;
              logger.flow('TaskQuickEditor', 'status:change', {
                path: context.file.path,
                lineNumber: context.lineNumber,
                checkboxState: mapping.checkboxState,
                status: status || null,
              });
              onChanged();
            });
          });
      });
    }
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle('Bullet — No status')
        .setIcon('list')
        .onClick(() => {
          void this.updateTaskLine(context, (line) => convertTaskLineToBullet(
            setInlineFieldValueOnTaskLine(line, this.getStatusKey(), null),
          ), {
            checkboxMutation: true,
          }).then((updated) => {
            if (!updated) return;
            logger.flow('TaskQuickEditor', 'status:bullet', {
              path: context.file.path,
              lineNumber: context.lineNumber,
            });
            this.closeTaskEditor();
          });
        });
    });
    const rect = button.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 6 });
  }

  private resolveTaskElement(target: HTMLElement | null): HTMLElement | null {
    if (!target) return null;
    const taskEl = target.closest<HTMLElement>(KANBAN_TASK_SELECTOR);
    if (!taskEl) return null;
    return taskEl.matches('input.task-list-item-checkbox')
      ? taskEl.closest<HTMLElement>('.task-list-item, li, p, div') ?? taskEl
      : taskEl;
  }

  private async resolveContext(
    taskEl: HTMLElement,
    sourceEl: HTMLElement | null = null,
  ): Promise<TaskLineContext | null> {
    const metadataHost = sourceEl?.closest<HTMLElement>('[data-task-path], [data-tps-kanban-path], [data-source-path], [data-file-path], [data-path]')
      || taskEl.closest<HTMLElement>('[data-task-path], [data-tps-kanban-path], [data-source-path], [data-file-path], [data-path]');
    const rawPath =
      taskEl.dataset.taskPath ||
      taskEl.dataset.tpsKanbanPath ||
      taskEl.dataset.sourcePath ||
      taskEl.dataset.filePath ||
      taskEl.dataset.path ||
      metadataHost?.dataset.taskPath ||
      metadataHost?.dataset.tpsKanbanPath ||
      metadataHost?.dataset.sourcePath ||
      metadataHost?.dataset.filePath ||
      metadataHost?.dataset.path ||
      '';
    const file = rawPath ? this.plugin.app.vault.getFileByPath(rawPath) : this.resolveMarkdownTaskFile(taskEl);
    if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') {
      logger.flowWarn('TaskLineResolve', 'file:unresolved', {
        rawPath,
        surface: taskElSurface(taskEl),
        hasMetadataHost: !!metadataHost,
        activePath: this.plugin.app.workspace.getActiveFile()?.path || '',
      });
      return null;
    }

    const content = await this.plugin.app.vault.cachedRead(file);
    const lines = content.split(/\r?\n/);

    const tableTaskIdentity = this.getTableTaskIdentity(taskEl);
    const directTargetTexts = sourceEl && sourceEl !== taskEl && tableTaskIdentity == null
      ? this.getDirectTaskElementSearchTexts(sourceEl)
      : [];
    const targetTexts = tableTaskIdentity
      ? []
      : directTargetTexts.length
        ? directTargetTexts
        : this.getTaskElementSearchTexts(taskEl);
    const candidateIndexes = this.getTaskLineCandidateIndexes(taskEl, lines, file, sourceEl);
    const lineIndex = resolveTaskLineIndex({
      lines,
      candidateIndexes,
      targetTexts,
      exactTaskText: tableTaskIdentity?.taskText,
      exactLineIdentity: tableTaskIdentity?.lineIdentity,
    });
    if (lineIndex < 0) {
      logger.flowWarn('TaskLineResolve', 'line:unresolved', {
        path: file.path,
        surface: taskElSurface(taskEl),
        candidates: candidateIndexes,
        targetVariants: targetTexts.length,
        taskCount: lines.filter((line) => !!parseTaskLine(line)).length,
      });
      return null;
    }
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
  ): number[] {
    const orderedLineIndex = this.resolveRenderedTaskLineIndexByOrder(taskEl, file, lines);
    const pluginLine =
      sourceEl?.getAttribute('data-task-line') ||
      sourceEl?.getAttribute('data-tps-kanban-line') ||
      sourceEl?.closest<HTMLElement>('[data-task-line], [data-tps-kanban-line]')?.getAttribute('data-task-line') ||
      sourceEl?.closest<HTMLElement>('[data-task-line], [data-tps-kanban-line]')?.getAttribute('data-tps-kanban-line') ||
      taskEl.getAttribute('data-task-line') ||
      taskEl.getAttribute('data-tps-kanban-line') ||
      taskEl.closest<HTMLElement>('[data-task-line], [data-tps-kanban-line]')?.getAttribute('data-task-line') ||
      taskEl.closest<HTMLElement>('[data-task-line], [data-tps-kanban-line]')?.getAttribute('data-tps-kanban-line');

    const renderedLineHost =
      sourceEl?.closest<HTMLElement>('li.task-list-item[data-line], li[data-line], [data-line]') ||
      taskEl.closest<HTMLElement>('li.task-list-item[data-line], li[data-line], [data-line]');
    const renderedLine = renderedLineHost?.getAttribute('data-line') ?? taskEl.getAttribute('data-line');
    return buildTaskLineCandidateIndexes({
      lineCount: lines.length,
      orderedLineIndex,
      pluginLine,
      renderedLine: taskEl.dataset.tpsGcmContext === 'table-task' ? null : renderedLine,
    });
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

  private getTableTaskIdentity(taskEl: HTMLElement): { taskText: string; lineIdentity: string } | null {
    if (taskEl.dataset.tpsGcmContext !== 'table-task') return null;
    return {
      taskText: String(
        taskEl.dataset.taskText
        ?? taskEl.querySelector<HTMLElement>('.tps-log-base-cell[data-key="title"], [data-key="title"]')?.textContent
        ?? '',
      ).trim(),
      lineIdentity: String(taskEl.dataset.taskLineIdentity || '').trim(),
    };
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

  private toggleSelectedTask(context: TaskLineContext, sourceEl: HTMLElement, surface = taskElSurface(sourceEl)): void {
    if (surface !== 'tps-list') {
      this.tpsListSelectionSyncGeneration += 1;
      this.tpsListSelectionOwner = null;
    }
    const key = this.getTaskContextKey(context);
    if (this.selectedTaskContexts.has(key)) {
      this.selectedTaskContexts.delete(key);
    } else {
      if (surface !== 'tps-list') {
        for (const [existingKey, existingContext] of this.selectedTaskContexts.entries()) {
          if (existingContext.file.path !== context.file.path) {
            this.selectedTaskContexts.delete(existingKey);
          }
        }
      }
      this.selectedTaskContexts.set(key, { ...context });
    }
    this.taskSelectionAnchor = { ...context };
    this.refreshTaskSelectionHighlights(sourceEl);
    logger.flow('TaskSelection', 'changed', {
      mode: 'toggle',
      surface,
      selectedCount: this.selectedTaskContexts.size,
    });
    new Notice(`${this.selectedTaskContexts.size} task${this.selectedTaskContexts.size === 1 ? '' : 's'} selected.`);
  }

  private async selectTaskRange(
    context: TaskLineContext,
    sourceEl: HTMLElement,
    surface: 'tps-list',
  ): Promise<void> {
    const scope = sourceEl.closest<HTMLElement>('.tps-list-native');
    const anchor = this.taskSelectionAnchor;
    if (!scope || !anchor) {
      this.selectedTaskContexts.clear();
      this.selectedTaskContexts.set(this.getTaskContextKey(context), { ...context });
      this.taskSelectionAnchor = { ...context };
      this.refreshTaskSelectionHighlights(sourceEl);
      logger.flow('TaskSelection', 'changed', { mode: 'range-fallback', surface, selectedCount: 1 });
      new Notice('1 task selected.');
      return;
    }

    const rows = Array.from(scope.querySelectorAll<HTMLElement>(
      '[data-tps-gcm-context="kanban-task"][data-task-path][data-task-line]',
    ));
    const anchorRow = rows.find((row) => row.dataset.taskPath === anchor.file.path && this.highlightHostMatchesContext(row, anchor)) ?? null;
    const targetRow = rows.find((row) => row === sourceEl || row.contains(sourceEl)) ?? null;
    if (!anchorRow || !targetRow) {
      this.selectedTaskContexts.clear();
      this.selectedTaskContexts.set(this.getTaskContextKey(context), { ...context });
      this.taskSelectionAnchor = { ...context };
      this.refreshTaskSelectionHighlights(sourceEl);
      logger.flow('TaskSelection', 'changed', { mode: 'range-fallback', surface, selectedCount: 1 });
      new Notice('1 task selected.');
      return;
    }

    const rangeRows = getOrderedSelectionRange(rows, anchorRow, targetRow);
    const resolved = await Promise.all(rangeRows.map((row) => this.resolveContext(row, row)));
    const contexts = resolved.filter((candidate): candidate is TaskLineContext => candidate != null);
    this.selectedTaskContexts.clear();
    for (const candidate of contexts) {
      this.selectedTaskContexts.set(this.getTaskContextKey(candidate), { ...candidate });
    }
    if (this.selectedTaskContexts.size === 0) {
      this.selectedTaskContexts.set(this.getTaskContextKey(context), { ...context });
    }
    this.refreshTaskSelectionHighlights(sourceEl);
    logger.flow('TaskSelection', 'changed', {
      mode: 'range',
      surface,
      selectedCount: this.selectedTaskContexts.size,
      visibleRangeCount: rangeRows.length,
    });
    new Notice(`${this.selectedTaskContexts.size} task${this.selectedTaskContexts.size === 1 ? '' : 's'} selected.`);
  }

  private clearTaskSelection(): void {
    this.tpsListSelectionSyncGeneration += 1;
    this.tpsListSelectionOwner = null;
    this.selectedTaskContexts.clear();
    this.taskSelectionAnchor = null;
    this.refreshTaskSelectionHighlights();
  }

  refreshSelectionHighlights(): void {
    this.refreshTaskSelectionHighlights();
  }

  async syncTpsListSelectionRows(
    rows: HTMLElement[],
    anchorRow: HTMLElement | null,
    owner: HTMLElement,
  ): Promise<void> {
    const generation = ++this.tpsListSelectionSyncGeneration;
    this.tpsListSelectionOwner = owner;
    const taskRows = rows.filter((row) => row.matches(
      '[data-tps-gcm-context="kanban-task"][data-task-path][data-task-line]',
    ));
    const anchorTaskRow = anchorRow?.matches(
      '[data-tps-gcm-context="kanban-task"][data-task-path][data-task-line]',
    ) ? anchorRow : null;
    const [resolved, anchorContext] = await Promise.all([
      Promise.all(taskRows.map((row) => this.resolveContext(row, row))),
      anchorTaskRow ? this.resolveContext(anchorTaskRow, anchorTaskRow) : Promise.resolve(null),
    ]);
    if (generation !== this.tpsListSelectionSyncGeneration) return;
    const contexts = resolved.filter((candidate): candidate is TaskLineContext => candidate != null);
    this.selectedTaskContexts.clear();
    for (const context of contexts) {
      this.selectedTaskContexts.set(this.getTaskContextKey(context), { ...context });
    }

    this.taskSelectionAnchor = anchorContext ? { ...anchorContext } : null;
    this.refreshTaskSelectionHighlights(anchorTaskRow ?? undefined);
    logger.flow('TaskSelection', 'changed', {
      mode: 'tps-list-sync',
      selectedCount: this.selectedTaskContexts.size,
      visibleSelectionCount: rows.length,
    });
  }

  reconcileTpsListSelectionRows(
    rows: HTMLElement[],
    anchorRow: HTMLElement | null,
    owner: HTMLElement,
  ): Promise<void> {
    if (this.tpsListSelectionOwner !== owner) return Promise.resolve();
    return this.syncTpsListSelectionRows(rows, anchorRow, owner);
  }

  releaseTpsListSelection(owner: HTMLElement): void {
    if (this.tpsListSelectionOwner !== owner) return;
    this.tpsListSelectionSyncGeneration += 1;
    this.tpsListSelectionOwner = null;
    this.selectedTaskContexts.clear();
    this.taskSelectionAnchor = null;
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

    for (const candidate of Array.from(document.querySelectorAll<HTMLElement>('[data-task-path][data-task-line]'))) {
      if (candidate.dataset.taskPath !== context.file.path) continue;
      if (!this.isTaskHighlightElement(candidate)) continue;
      if (this.highlightHostMatchesContext(candidate, context)) elements.add(candidate);
    }

    return [...elements];
  }

  private resolveDirectTaskHighlightHost(sourceEl: HTMLElement): HTMLElement | null {
    const host = sourceEl.closest<HTMLElement>(
      'li.task-list-item, .task-list-item, .cm-line, .tps-calendar-task-entry[data-task-path][data-task-line], .tps-kanban-card-task[data-task-path][data-task-line], .tps-kanban-task-card[data-task-path][data-task-line], [data-tps-gcm-context="calendar-task"], [data-tps-gcm-context="kanban-task"], [data-tps-gcm-context="table-task"]',
    );
    if (!host) return null;
    return this.isTaskHighlightElement(host) ? host : null;
  }

  private highlightHostMatchesContext(host: HTMLElement, context: TaskLineContext): boolean {
    const metadataMatch = matchTaskHighlightMetadata({
      taskPath: host.dataset.taskPath,
      tpsKanbanPath: host.dataset.tpsKanbanPath,
      taskLine: host.getAttribute('data-task-line'),
      tpsKanbanLine: host.getAttribute('data-tps-kanban-line'),
      dataLine: host.getAttribute('data-line'),
    }, {
      filePath: context.file.path,
      lineNumber: context.lineNumber,
      lineIndex: context.lineIndex,
    });
    if (metadataMatch != null) return metadataMatch;

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
      `.tps-kanban-card-task[data-task-path][data-task-line="${context.lineNumber}"]`,
      `.tps-kanban-task-card[data-task-path][data-task-line="${context.lineNumber}"]`,
      `[data-tps-gcm-context="calendar-task"][data-task-line="${context.lineNumber}"]`,
      `[data-tps-gcm-context="kanban-task"][data-task-line="${context.lineNumber}"]`,
      `[data-tps-gcm-context="table-task"][data-task-line="${context.lineNumber}"]`,
    ].join(', ')))
      .filter((element) => this.isTaskHighlightElement(element) && this.highlightHostMatchesContext(element, context));
    if (directMatches.length > 0) return directMatches;

    if (typeof context.taskOrdinal !== 'number' || context.taskOrdinal < 0) return [];
    const rendered = this.getRenderedTaskHighlightElements(previewEl)[context.taskOrdinal];
    return rendered ? [rendered] : [];
  }

  private getRenderedTaskHighlightElements(previewEl: HTMLElement): HTMLElement[] {
    return Array.from(previewEl.querySelectorAll<HTMLElement>(
      'li.task-list-item, .task-list-item, .tps-calendar-task-entry[data-task-path][data-task-line], .tps-kanban-card-task[data-task-path][data-task-line], .tps-kanban-task-card[data-task-path][data-task-line], [data-tps-gcm-context="calendar-task"], [data-tps-gcm-context="kanban-task"], [data-tps-gcm-context="table-task"]',
    ))
      .filter((element) => this.isTaskHighlightElement(element));
  }

  private isTaskHighlightElement(element: HTMLElement): boolean {
    if (element.matches('.cm-line, li.task-list-item, .tps-calendar-task-entry[data-task-path][data-task-line], .tps-kanban-card-task[data-task-path][data-task-line], .tps-kanban-task-card[data-task-path][data-task-line], [data-tps-gcm-context="calendar-task"], [data-tps-gcm-context="kanban-task"], [data-tps-gcm-context="table-task"]')) {
      return true;
    }
    return element.matches('.task-list-item') && !!element.querySelector('input.task-list-item-checkbox, input[type="checkbox"]');
  }

  private showMenu(context: TaskLineContext, taskEl: HTMLElement, x: number, y: number): void {
    const menu = new Menu();
    const surface = taskElSurface(taskEl);
    const selectedContexts = this.getMenuSelection(context);
    this.setActiveTaskHighlight(selectedContexts, taskEl);
    menu.onHide(() => this.clearActiveTaskHighlight());

    if (selectedContexts.length > 1) {
      this.addSelectedTaskMenuItems(menu, selectedContexts);
      menu.addSeparator();
    }
    this.addTaskLineMenuItems(menu, context, {
      includeTags: surface === 'tps-list' || surface === 'tps-table',
    });
    menu.showAtPosition({ x, y });
  }

  private getMenuSelection(context: TaskLineContext): TaskLineContext[] {
    const key = this.getTaskContextKey(context);
    if (!this.selectedTaskContexts.has(key)) return [context];
    const selected = [...this.selectedTaskContexts.values()]
      .sort((a, b) => a.file.path.localeCompare(b.file.path) || a.lineIndex - b.lineIndex);
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
        sub.setTitle('Move selected to note...').setIcon('file-input').onClick(() => {
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
    options: { includeTitle?: boolean; includeStatus?: boolean; includeNoteActions?: boolean; includeTags?: boolean } = {},
  ): void {
    const includeTitle = options.includeTitle !== false;
    const includeStatus = options.includeStatus !== false;
    const includeNoteActions = options.includeNoteActions !== false;
    context.title = this.getContextTaskTitle(context);

    if (includeTitle) {
      menu.addItem((item) => {
        item
          .setTitle(`Title: ${context.title || '(untitled task)'}`)
          .setIcon('pencil')
          .setSection('tps-title')
          .onClick(() => this.promptTaskTitle(context));
      });
    }

    if (includeStatus) {
      this.addTaskStatusMenu(menu, context);
    }
    if (options.includeTags === true) {
      this.addInlineTagsMenu(menu, context);
    }
    this.addConfiguredPropertyMenus(menu, context, options.includeTags === true);

    const sourceNoteTitle = this.plugin.noteTitleRenderService.getDisplayTitle(context.file) || context.file.basename;
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle(`Move task from ${sourceNoteTitle}...`)
        .setIcon('file-input')
        .onClick(() => this.promptMoveTaskToFile(context));
    });
    menu.addItem((item) => {
      item
        .setTitle('Open task line')
        .setIcon('list')
        .onClick(() => {
          this.runTaskMenuAction(context, 'open-task-line', () => this.openTaskLine(context));
        });
    });
    if (includeNoteActions) {
      const hasAssociatedNote = Boolean(
        readTaskAssociatedNotePath(context.rawLine)
        || parseTaskTitleLink(getTaskSourceTitle(context.rawLine)),
      );
      menu.addItem((item) => {
        item
          .setTitle(hasAssociatedNote ? 'Open linked note' : 'Create note for task')
          .setIcon(hasAssociatedNote ? 'file-text' : 'file-plus-2')
          .onClick(() => {
            this.runTaskMenuAction(context, 'open-or-create-task-note', () => (
              this.plugin.dailyInboxLineService.createNoteForLine(context)
            ));
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
    }
    menu.addItem((item) => {
      item
        .setTitle('Delete task')
        .setIcon('trash-2')
        .onClick(() => {
          void this.deleteSingleTask(context);
        });
    });

    if (readInlineFieldValue(context.rawLine, 'recurrence') || readInlineFieldValue(context.rawLine, 'recurrenceRule')) {
      menu.addItem((item) => {
        item
          .setTitle('Edit recurrence template...')
          .setIcon('copy-check')
          .onClick(() => {
            this.runTaskMenuAction(context, 'edit-recurrence-template', () => (
              this.plugin.taskRecurrenceService.editTemplateForTaskLine(
                context.file,
                context.lineIndex,
                context.rawLine,
              )
            ));
          });
      });
    }

    if (this.plugin.settings.enableTimeTracking !== false) {
      this.addTaskTimeTrackingMenu(menu, context);
    }
  }

  private addInlineTagsMenu(menu: Menu, context: TaskLineContext): void {
    const current = readInlineTags(context.rawLine);
    menu.addItem((item) => {
      item
        .setTitle(current.length > 0 ? `Tags (${current.length})` : 'Tags')
        .setIcon('tag');
      const subMenu = (item as any).setSubmenu();
      subMenu.addItem((sub: any) => {
        sub.setTitle('Add tag...').setIcon('plus').onClick(() => {
          new TextInputModal(this.plugin.app, 'Tag', '', async (value) => {
            const tag = String(value || '').trim();
            if (!tag) return;
            await this.updateTaskLine(context, (line) => addInlineTagToTaskLine(line, tag));
          }).open();
        });
      });
      if (current.length > 0) subMenu.addSeparator();
      for (const tag of current) {
        subMenu.addItem((sub: any) => {
          sub.setTitle(`Remove #${tag}`).setIcon('x').onClick(() => {
            void this.updateTaskLine(context, (line) => removeInlineTagFromTaskLine(line, tag));
          });
        });
      }
    });
  }

  private addTaskStatusMenu(menu: Menu, context: TaskLineContext): void {
    menu.addItem((item) => {
      const current = this.getStatusForCheckboxToken(context.checkboxToken);
      item
        .setTitle(current ? `Status: ${current}` : 'Status')
        .setIcon('circle-check');
      const subMenu = (item as any).setSubmenu();
      const statusItems: Array<{ item: any; mapping: LinkedSubitemCheckboxMapping; label: string }> = [];
      const setSelectedToken = (token: string) => {
        context.checkboxToken = token;
        const selectedStatus = this.getStatusForCheckboxToken(token);
        item.setTitle(selectedStatus ? `Status: ${selectedStatus}` : 'Status');
        for (const entry of statusItems) {
          const selected = entry.mapping.checkboxState === token;
          entry.item.setTitle(selected ? `${entry.label} — Selected` : entry.label);
          entry.item.setChecked(selected);
        }
      };

      for (const mapping of this.getCheckboxMappings()) {
        const status = String(mapping.statuses?.[0] || '').trim();
        const label = String(mapping.label || status || mapping.checkboxState).trim();
        subMenu.addItem((sub: any) => {
          statusItems.push({ item: sub, mapping, label });
          const selected = mapping.checkboxState === context.checkboxToken;
          sub
            .setTitle(selected ? `${label} — Selected` : label)
            .setIcon(mapping.icon || 'square');
          sub.setChecked(selected);
          sub.onClick(() => {
            const previousToken = context.checkboxToken;
            setSelectedToken(mapping.checkboxState);
            void this.updateTaskLine(context, (line) => setTaskCheckboxToken(line, mapping.checkboxState), {
              checkboxMutation: true,
            }).then((updated) => {
              if (!updated) setSelectedToken(previousToken);
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
              const previousToken = context.checkboxToken;
              setSelectedToken(token);
              const updated = await this.updateTaskLine(context, (line) => setTaskCheckboxToken(line, token), {
                checkboxMutation: true,
              });
              if (!updated) setSelectedToken(previousToken);
            }).open();
          });
      });
    });
  }

  private addConfiguredPropertyMenus(menu: Menu, context: TaskLineContext, excludeTags = false): void {
    if (this.plugin.settings.showCustomPropertiesInContextMenu === false) return;
    const statusKey = this.getStatusKey().toLowerCase();
    const frontmatter: Record<string, unknown> = {};
    for (const property of this.plugin.settings.properties || []) {
      const key = String(property?.key || '').trim();
      const value = key ? readInlineFieldValue(context.rawLine, key) : '';
      if (key && value) frontmatter[key] = value;
    }
    const tags = readInlineTags(context.rawLine);
    if (tags.length > 0) frontmatter.tags = tags;
    const properties = resolveCustomProperties(
      this.plugin.settings.properties || [],
      [{ file: context.file, frontmatter }],
      new ViewModeService(),
      'context',
    ).filter((property) => (
      this.isTaskMenuProperty(property, statusKey)
      && !(
        excludeTags
        && (
          String(property.key || '').trim().toLowerCase() === 'tags'
          || property.listItemType === 'tag'
        )
      )
    ));
    for (const property of properties) {
      if (isEntityReferenceProperty(property)) {
        this.addEntityPropertyMenu(menu, context, property);
      } else if (property.type === 'selector') {
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

  private addEntityPropertyMenu(menu: Menu, context: TaskLineContext, property: CustomProperty): void {
    const isList = property.type === 'list';
    const currentValue = readInlineFieldValue(context.rawLine, property.key);
    const current = isList ? parseLinkListInput(currentValue) : currentValue ? [currentValue] : [];
    menu.addItem((item) => {
      item
        .setTitle(current.length > 0
          ? `${property.label}: ${current.map((value) => getWikilinkDisplayText(value)).join(', ')}`
          : `${property.label} (create field)`)
        .setIcon(property.icon || 'file-search');
      const subMenu = (item as any).setSubmenu();
      subMenu.addItem((sub: any) => {
        sub.setTitle('(none)').setChecked(current.length === 0).onClick(() => {
          void this.updateTaskLine(context, (line) => setInlineFieldValueOnTaskLine(line, property.key, null));
        });
      });
      subMenu.addItem((sub: any) => {
        sub.setTitle(isList ? `Add ${property.label}…` : `Choose ${property.label}…`).setIcon('search').onClick(() => {
          openEntitySuggestModal(this.plugin.app, this.plugin, property, (choice) => {
            void this.updateTaskLine(context, (line) => {
              const nextValue = isList
                ? mergeEntityReferenceList(readInlineFieldValue(line, property.key), choice.wikilink).join(', ')
                : choice.wikilink;
              return setInlineFieldValueOnTaskLine(line, property.key, nextValue);
            });
          });
        });
      });
      if (isList && current.length > 0) {
        subMenu.addSeparator();
        for (const link of current) {
          subMenu.addItem((sub: any) => {
            sub.setTitle(`Remove ${getWikilinkDisplayText(link)}`).setIcon('x').onClick(() => {
              void this.updateTaskLine(context, (line) => {
                const remaining = removeEntityReferenceListValues(readInlineFieldValue(line, property.key), link);
                return setInlineFieldValueOnTaskLine(
                  line,
                  property.key,
                  remaining.length > 0 ? remaining.join(', ') : null,
                );
              });
            });
          });
        }
      }
    });
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
          }, isScheduled ? {} : {
            title: `Set ${property.label || property.key}`,
            fieldLabel: property.label || property.key,
            showTimeDetails: false,
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
    const updated = await this.updateTaskLine(context, (line) => {
      let next = setInlineFieldValueOnTaskLine(line, property.key, result.date || null);
      if (isScheduled) {
        next = setInlineFieldValueOnTaskLine(next, 'timeEstimate', result.date ? String(result.timeEstimate || 0) : null);
        next = setInlineFieldValueOnTaskLine(next, 'allDay', result.date && result.allDay ? 'true' : null);
      }
      return next;
    });
    if (!updated) return;

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

    new DailyNoteTaskMovePromptModal(this.plugin.app, {
      taskTitle: this.getContextTaskTitle(context) || 'Task',
      sourceDate,
      targetDate,
      onMove: async () => {
        const targetFile = await this.plugin.noteOperationService.ensureDailyNote(targetDate);
        if (!(targetFile instanceof TFile) || targetFile.path === context.file.path) return;
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
              : setInlineFieldValueOnTaskLine(
                line,
                property.key,
                this.joinUnique([
                  ...this.parseListValue(readInlineFieldValue(line, property.key)),
                  next,
                ]),
              ));
          }).open();
        });
      });
      if (current.length > 0) subMenu.addSeparator();
      for (const value of current) {
        subMenu.addItem((sub: any) => {
          sub.setTitle(`Remove ${value}`).setIcon('x').onClick(() => {
            void this.updateTaskLine(context, (line) => isTags
              ? removeInlineTagFromTaskLine(line, value)
              : setInlineFieldValueOnTaskLine(
                line,
                property.key,
                this.joinUnique(
                  this.parseListValue(readInlineFieldValue(line, property.key))
                    .filter((itemValue) => itemValue !== value),
                ),
              ));
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
          }, { showEndsOn: false }).open();
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
          this.runTaskMenuAction(context, 'start-timer', () => this.startTaskTimer(context));
        });
      });
      subMenu.addItem((sub: any) => {
        sub.setTitle('Add manual session').setIcon('clock').onClick(() => {
          this.runTaskMenuAction(context, 'add-manual-session', () => (
            this.plugin.timeTrackingService.promptAddManualSession({
              file: context.file,
              type: 'task',
              lineNumber: context.lineIndex,
              rawLine: context.rawLine,
              title: this.getContextTaskTitle(context) || context.file.basename,
            })
          ));
        });
      });
    });
  }

  private startTaskTimer(context: TaskLineContext, mode?: 'overwrite' | 'duplicate'): Promise<void> | void {
    if (!mode && this.shouldPromptForTimedCalendarTask(context)) {
      new TaskTimerScheduledConflictModal(this.plugin.app, this.getContextTaskTitle(context) || context.file.basename, {
        overwrite: () => this.startTaskTimer(context, 'overwrite'),
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
      rawLine: context.rawLine,
      title: this.getContextTaskTitle(context) || context.file.basename,
    }).then(() => undefined);
  }

  private shouldPromptForTimedCalendarTask(context: TaskLineContext): boolean {
    if (!context.isCalendarTask || context.calendarAllDay) return false;
    return !!readInlineFieldValue(context.rawLine, 'scheduled');
  }

  private async duplicateTaskBelowForTimer(context: TaskLineContext): Promise<TaskLineContext | null> {
    const duplicateLine = this.buildTimerDuplicateTaskLine(context);
    let insertedIndex = -1;
    try {
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
    } catch (error) {
      logger.flowError('TaskLineContextMenu', 'timer-duplicate:failed', error, {
        path: context.file.path,
        renderedLineNumber: context.lineIndex + 1,
      });
      new Notice('Could not create a new task for the timer.');
      return null;
    }

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
    next = setTaskTitle(next, this.getContextTaskTitle(context) || 'New task');
    for (const key of [
      'scheduled',
      'timeEstimate',
      'allDay',
      'end',
      'endDate',
      'ends',
      'duration',
      'completedDate',
      'recurrence',
      'recurrenceRule',
      'recurrenceTaskId',
      'tpsId',
      'subitemId',
    ]) {
      next = setInlineFieldValueOnTaskLine(next, key, null);
    }
    next = stripTaskInlinePropsMetadata(next);
    return updateTaskLineTimestamps(next, {
      enabled: this.plugin.settings.autoSyncFileTimestamps === true,
      createdKey: this.plugin.settings.dateCreatedFrontmatterKey,
      modifiedKey: this.plugin.settings.dateModifiedFrontmatterKey,
      format: this.plugin.settings.fileTimestampFormat,
      markCreated: true,
      markModified: true,
    });
  }

  private promptTaskTitle(context: TaskLineContext): void {
    logger.flow('TaskLineContextMenu', 'rename:prompt', {
      path: context.file.path,
      lineNumber: context.lineNumber,
      surface: context.isCalendarTask ? 'calendar' : 'task-line',
    });
    new TextInputModal(this.plugin.app, 'Task title', this.getContextTaskTitle(context), async (value) => {
      await this.updateTaskLine(context, (line) => setTaskTitle(line, value));
    }).open();
  }

  private promptInlineValue(context: TaskLineContext, property: CustomProperty, current: string): void {
    new TextInputModal(this.plugin.app, property.label || property.key, current, async (value) => {
      const raw = String(value || '').trim();
      if (property.type === 'number' && raw && !Number.isFinite(Number(raw))) {
        new Notice(`${property.label || property.key} must be a valid number.`);
        return;
      }
      const next = property.type === 'number' && raw ? String(Number(raw)) : raw;
      await this.updateTaskLine(context, (line) => setInlineFieldValueOnTaskLine(line, property.key, next || null));
    }).open();
  }

  private async updateTaskLine(
    context: TaskLineContext,
    updater: (line: string) => string,
    options: { checkboxMutation?: boolean } = {},
  ): Promise<boolean> {
    let resolved = false;
    let changed = false;
    let previousMarker: string | null = null;
    let nextMarker: string | null = null;
    let updatedLines: string[] | null = null;

    try {
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
        resolved = true;
        let nextLine = updater(currentLine);
        if (nextLine === currentLine) return content;
        let nextParsed = parseTaskLine(nextLine);
        if (options.checkboxMutation === true) {
          nextLine = updateTaskCompletedDateForCheckboxState(nextLine, nextParsed?.marker ?? currentParsed.marker, {
            completeMarkers: this.getCompleteMarkers(),
          });
          nextParsed = parseTaskLine(nextLine);
        }
        nextLine = updateTaskLineTimestamps(nextLine, {
          enabled: this.plugin.settings.autoSyncFileTimestamps === true,
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
        nextMarker = nextParsed?.marker ?? null;
        updatedLines = [...lines];
        changed = true;
        return `${lines.join(newline)}${endsWithNewline ? newline : ''}`;
      });
    } catch (error) {
      logger.flowError('TaskLineContextMenu', 'write:failed', error, {
        path: context.file.path,
        renderedLineNumber: context.lineIndex + 1,
        checkboxMutation: options.checkboxMutation === true,
      });
      new Notice('Could not update the task.');
      return false;
    }

    if (!resolved) {
      logger.flowWarn('TaskLineContextMenu', 'write:stale-target', {
        path: context.file.path,
        renderedLineNumber: context.lineIndex + 1,
      });
      new Notice('That task changed before it could be updated. Refresh and try again.');
      return false;
    }
    if (!changed) return true;

    if (options.checkboxMutation === true && updatedLines) {
      try {
        await this.plugin.taskCheckboxHandler.handleExternalChecklistStateMutation(
          context.file,
          previousMarker,
          nextMarker,
          updatedLines,
        );
      } catch (error) {
        logger.flowError('TaskLineContextMenu', 'write:checkbox-followup-failed', error, {
          path: context.file.path,
          lineNumber: context.lineNumber,
        });
        new Notice('Task updated, but its follow-up status sync did not finish.');
      }
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
    logger.flow('TaskLineContextMenu', 'write:done', {
      path: context.file.path,
      lineNumber: context.lineNumber,
      checkboxMutation: options.checkboxMutation === true,
    });
    return true;
  }

  private async updateTaskLines(
    contexts: TaskLineContext[],
    updater: (line: string, context: TaskLineContext) => string,
    options: { checkboxMutation?: boolean } = {},
  ): Promise<number> {
    const uniqueContexts = this.getUniqueContexts(contexts);
    const updatedPaths = new Set<string>();
    let updatedCount = 0;
    for (const context of uniqueContexts) {
      if (await this.updateTaskLine(context, (line) => updater(line, context), options)) {
        updatedCount += 1;
        updatedPaths.add(context.file.path);
      }
    }
    if (updatedPaths.size > 0) {
      this.refreshSelectionAfterWrites(uniqueContexts);
      this.refreshTaskSelectionHighlights();
    }
    return updatedCount;
  }

  private promptMoveSelectedTasksToFile(contexts: TaskLineContext[]): void {
    const uniqueContexts = this.getUniqueContexts(contexts);
    new FileSuggestModal(this.plugin.app, async (targetFile) => {
      if (uniqueContexts.some((context) => context.file.path === targetFile.path)) {
        new Notice('Choose a different file when moving selected tasks.');
        return;
      }
      let movedCount = 0;
      for (const context of this.getMutationOrderedContexts(uniqueContexts)) {
        const selectionKey = this.getTaskContextKey(context);
        if (await this.moveTaskToFile(context, targetFile)) movedCount += 1;
        this.selectedTaskContexts.delete(selectionKey);
      }
      this.refreshTaskSelectionHighlights();
      new Notice(movedCount === uniqueContexts.length
        ? `Moved ${movedCount} tasks.`
        : `Moved ${movedCount} of ${uniqueContexts.length} tasks.`);
    }, { extensions: ['md'] }).open();
  }

  private async deleteSelectedTasks(contexts: TaskLineContext[]): Promise<void> {
    const uniqueContexts = this.getUniqueContexts(contexts);
    const orderedContexts = this.getMutationOrderedContexts(uniqueContexts);
    const targets = orderedContexts.map((context) => ({
      context,
      target: this.createTaskDeleteTarget(context, 'task-menu-selected'),
    }));
    const inspections = new Map<string, Awaited<ReturnType<typeof inspectLineItemDeleteTarget>>>();
    let nestedContentLineCount = 0;
    for (const { context, target } of targets) {
      try {
        const inspection = await inspectLineItemDeleteTarget(target);
        inspections.set(this.getTaskContextKey(context), inspection);
        nestedContentLineCount += inspection?.nestedContentLineCount ?? 0;
      } catch (error) {
        logger.flowError('TaskLineContextMenu', 'delete-selected:inspect-failed', error, {
          path: context.file.path,
          lineNumber: context.lineNumber,
        });
        inspections.set(this.getTaskContextKey(context), null);
      }
    }

    let mode: LineItemDeleteMode = 'delete-subtree';
    if (nestedContentLineCount > 0) {
      const choice = await promptNestedLineDelete(this.plugin.app, {
        itemLabel: 'selected task group',
        nestedContentLineCount,
      });
      if (!choice) return;
      mode = choice;
    }

    let deletedCount = 0;
    for (const { context, target } of targets) {
      const selectionKey = this.getTaskContextKey(context);
      const inspection = inspections.get(selectionKey);
      if (!inspection) continue;
      const result = await performLineItemDelete(target, mode, {
        refuseUnexpectedNestedContent: inspection.nestedContentLineCount === 0,
        showNotices: false,
      });
      if (result.outcome === 'deleted') {
        deletedCount += 1;
        this.selectedTaskContexts.delete(selectionKey);
      }
    }
    this.refreshTaskSelectionHighlights();
    new Notice(deletedCount === uniqueContexts.length
      ? `Deleted ${deletedCount} tasks.`
      : `Deleted ${deletedCount} of ${uniqueContexts.length} tasks.`);
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
    const selectionKey = this.getTaskContextKey(context);
    new FileSuggestModal(this.plugin.app, async (targetFile) => {
      if (await this.moveTaskToFile(context, targetFile)) {
        this.selectedTaskContexts.delete(selectionKey);
        this.refreshTaskSelectionHighlights();
      }
    }, { extensions: ['md'] }).open();
  }

  private async deleteSingleTask(context: TaskLineContext): Promise<void> {
    const selectionKey = this.getTaskContextKey(context);
    const result = await requestLineItemDelete(this.createTaskDeleteTarget(context, 'task-menu-single'));
    if (result.outcome !== 'deleted') return;
    this.selectedTaskContexts.delete(selectionKey);
    this.refreshTaskSelectionHighlights();
  }

  private createTaskDeleteTarget(context: TaskLineContext, source: string): LineItemDeleteTarget {
    return {
      app: this.plugin.app,
      file: context.file,
      lineIndex: context.lineIndex,
      rawLine: context.rawLine,
      itemLabel: 'task',
      source,
      resolveLineIndex: (lines) => findCurrentTaskLineIndex(
        lines,
        context.lineIndex,
        context.rawLine,
        context.title,
      ),
      onDeleted: () => {
        this.plugin.eventService.emitFilesUpdated([context.file.path]);
        this.plugin.overlayRenderingService?.invalidate({
          reason: 'task-line-context-menu-delete',
          file: context.file,
          surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
          rebuildInlineSubitems: true,
          refreshLivePreviewEditors: true,
          delayMs: 80,
        });
      },
    };
  }

  private async moveTaskToFile(context: TaskLineContext, targetFile: TFile): Promise<boolean> {
    if (!(targetFile instanceof TFile) || targetFile.extension?.toLowerCase() !== 'md') {
      new Notice('Choose a Markdown file.');
      return false;
    }

    const sourceFile = context.file;
    const sourcePath = sourceFile.path;
    const initialLineNumber = context.lineNumber;
    let taskBlockLines: string[] = [];
    try {
      await this.plugin.app.vault.process(sourceFile, (content) => {
        const sourceUpdate = this.removeTaskBlockFromContent(content, context);
        if (!sourceUpdate.changed) return content;
        taskBlockLines = sourceUpdate.blockLines;
        const parts = content.split(/\r?\n/);
        const resolvedIndex = this.resolveLineIndex(parts, context);
        if (resolvedIndex >= 0) {
          context.lineIndex = resolvedIndex;
          context.lineNumber = resolvedIndex + 1;
          context.rawLine = parts[resolvedIndex] || context.rawLine;
          context.title = getTaskDisplayTitle(context.rawLine);
        }
        return content;
      });
    } catch (error) {
      logger.flowError('TaskLineContextMenu', 'move:source-read-failed', error, {
        sourcePath,
        targetPath: targetFile.path,
        lineNumber: initialLineNumber,
      });
      new Notice('Could not read the task block to move.');
      return false;
    }
    if (taskBlockLines.length === 0) {
      new Notice('Could not find the task block to move.');
      return false;
    }
    logger.flow('TaskLineContextMenu', 'move:start', {
      sourcePath,
      targetPath: targetFile.path,
      lineNumber: context.lineNumber,
      blockLines: taskBlockLines.length,
    });

    if (targetFile.path === sourceFile.path) {
      let changed = false;
      try {
        await this.plugin.app.vault.process(sourceFile, (content) => {
          const update = this.moveTaskBlockWithinContent(content, context);
          if (!update.changed) return content;
          context.lineIndex = update.lineIndex;
          context.lineNumber = update.lineIndex + 1;
          context.rawLine = update.rawLine || context.rawLine;
          changed = true;
          return update.content;
        });
      } catch (error) {
        logger.flowError('TaskLineContextMenu', 'move:same-file-failed', error, {
          sourcePath,
          lineNumber: initialLineNumber,
        });
        new Notice('Could not move the task within this note.');
        return false;
      }
      if (!changed) {
        new Notice('Could not move the task line.');
        return false;
      }
      this.notifyTaskMoved([sourceFile.path]);
      logger.flow('TaskLineContextMenu', 'move:done', {
        sourcePath,
        targetPath: targetFile.path,
        outcome: 'same-file-end',
      });
      new Notice(`Moved task to the end of ${sourceFile.basename}.`);
      return true;
    }

    let insertedLineIndex = -1;
    try {
      await this.plugin.app.vault.process(targetFile, (content) => {
        const inserted = insertTaskBlockAfterFrontmatter(content, taskBlockLines);
        insertedLineIndex = inserted.lineIndex;
        return inserted.content;
      });
    } catch (error) {
      logger.flowError('TaskLineContextMenu', 'move:target-write-failed', error, {
        sourcePath,
        targetPath: targetFile.path,
        lineNumber: initialLineNumber,
      });
      new Notice(`Could not add the task to ${targetFile.basename}.`);
      return false;
    }
    if (insertedLineIndex < 0) {
      new Notice(`Could not add the task to ${targetFile.basename}.`);
      return false;
    }

    if (this.isDailyNoteSourceFile(sourceFile)) {
      const scratchpadBlock = buildDailyNoteScratchpadMovedTaskBlock(taskBlockLines, {
        targetPath: targetFile.path,
        movedAt: new Date(),
      });
      let preserved = false;
      try {
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
      } catch (error) {
        logger.flowError('TaskLineContextMenu', 'move:daily-source-mark-failed', error, {
          sourcePath,
          targetPath: targetFile.path,
          lineNumber: initialLineNumber,
        });
      }

      this.notifyTaskMoved([sourceFile.path, targetFile.path]);
      new Notice(preserved
        ? `Copied task to ${targetFile.basename}; marked the daily-note record as migrated.`
        : `Copied task to ${targetFile.basename}; the original daily-note line changed before it could be marked.`);
      logger.flow('TaskLineContextMenu', 'move:done', {
        sourcePath,
        targetPath: targetFile.path,
        outcome: preserved ? 'daily-note-migrated' : 'daily-note-copied-source-changed',
      });
      return preserved;
    }

    let removed = false;
    try {
      await this.plugin.app.vault.process(sourceFile, (content) => {
        const update = this.removeTaskBlockFromContent(content, context);
        if (!update.changed) return content;
        removed = true;
        return update.content;
      });
    } catch (error) {
      logger.flowError('TaskLineContextMenu', 'move:source-remove-failed', error, {
        sourcePath,
        targetPath: targetFile.path,
        lineNumber: initialLineNumber,
      });
    }

    if (!removed) {
      const rolledBack = await this.rollbackInsertedTaskBlock(targetFile, insertedLineIndex, taskBlockLines);
      logger.flowWarn('TaskLineContextMenu', 'move:source-changed', {
        sourcePath,
        targetPath: targetFile.path,
        lineNumber: initialLineNumber,
        targetRolledBack: rolledBack,
      });
      new Notice(rolledBack
        ? 'The task changed before it could be moved. No copy was left behind.'
        : `The task changed before it could be removed; check ${targetFile.basename} for a duplicate.`);
      return false;
    }

    context.file = targetFile;
    context.lineIndex = Math.max(0, insertedLineIndex);
    context.lineNumber = context.lineIndex + 1;
    context.rawLine = taskBlockLines[0] || context.rawLine;

    this.notifyTaskMoved([sourceFile.path, targetFile.path]);
    new Notice(`Moved task to ${targetFile.basename}.`);
    logger.flow('TaskLineContextMenu', 'move:done', {
      sourcePath,
      targetPath: targetFile.path,
      outcome: 'moved',
    });
    return true;
  }

  private async rollbackInsertedTaskBlock(targetFile: TFile, lineIndex: number, blockLines: string[]): Promise<boolean> {
    const rawLine = blockLines[0] || '';
    const title = getTaskDisplayTitle(rawLine);
    let removed = false;
    try {
      await this.plugin.app.vault.process(targetFile, (content) => {
        const update = removeTaskBlockFromContent(content, lineIndex, rawLine, title);
        if (!update.changed) return content;
        removed = true;
        return update.content;
      });
    } catch (error) {
      logger.flowError('TaskLineContextMenu', 'move:rollback-failed', error, {
        targetPath: targetFile.path,
        lineNumber: lineIndex + 1,
      });
    }
    return removed;
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
    const currentLeaf = this.plugin.findOpenLeafForFile(context.file);
    const currentEditor = (currentLeaf?.view as any)?.editor;
    const content = typeof currentEditor?.getValue === 'function'
      ? currentEditor.getValue()
      : await this.plugin.app.vault.cachedRead(context.file);
    const lines = content.split('\n');
    const lineIndex = this.resolveLineIndex(lines, context);
    if (lineIndex < 0) {
      logger.flowWarn('TaskLineContextMenu', 'open-line:stale-target', {
        path: context.file.path,
        renderedLineNumber: context.lineIndex + 1,
      });
      new Notice('That task line changed before it could be opened. Refresh and try again.');
      return;
    }
    this.plugin.hideCompletedCheckboxesService?.revealCompletedForFile(context.file.path, lineIndex);
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
    editor.setCursor({ line: lineIndex, ch: 0 });
    editor.scrollIntoView?.({ from: { line: lineIndex, ch: 0 }, to: { line: lineIndex + 1, ch: 0 } }, true);
    editor.focus?.();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private runTaskMenuAction(
    context: TaskLineContext,
    action: string,
    work: () => unknown | Promise<unknown>,
  ): void {
    void Promise.resolve()
      .then(work)
      .catch((error) => {
        logger.flowError('TaskLineContextMenu', 'action:failed', error, {
          action,
          path: context.file.path,
          renderedLineNumber: context.lineIndex + 1,
        });
        new Notice('Could not complete that task action.');
      });
  }

  private isTaskMenuProperty(property: CustomProperty, statusKey: string): boolean {
    if (!property || property.disabled || property.hidden || property.showInContextMenu === false || property.allowInlineSet === false) return false;
    const key = String(property.key || '').trim().toLowerCase();
    const id = String(property.id || '').trim().toLowerCase();
    if (!key) return false;
    if (
      key === 'title'
      || id === 'title'
      || key === 'folderpath'
      || property.type === 'folder'
      || property.type === 'snooze'
      || property.type === 'kind'
    ) return false;
    if (key === statusKey || id === 'status') return false;
    return true;
  }

  private getContextTaskTitle(context: TaskLineContext): string {
    return getTaskDisplayTitle(context.rawLine) || getPlainTaskTitle(context.title) || '';
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
    const taskTitle = getTaskDisplayTitle(raw);
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
    return [raw, taskTitle, withoutCheckbox, withoutInlineFields].filter(Boolean);
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
      overwrite: () => Promise<void> | void;
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
      this.runAction('overwrite', this.callbacks.overwrite);
    });
    buttonRow.createEl('button', { text: 'Create new task', cls: 'mod-cta' }).addEventListener('click', () => {
      this.close();
      this.runAction('duplicate', this.callbacks.duplicate);
    });
    buttonRow.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private runAction(action: string, callback: () => Promise<void> | void): void {
    void Promise.resolve()
      .then(callback)
      .catch((error) => {
        logger.flowError('TaskTimerScheduledConflictModal', 'action:failed', error, {
          action,
          taskTitle: this.taskTitle,
        });
        new Notice('Could not start the task timer.');
      });
  }
}

class DailyNoteTaskMovePromptModal extends Modal {
  constructor(
    app: App,
    private readonly options: {
      taskTitle: string;
      sourceDate: string;
      targetDate: string;
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
      text: `Move the full task block to the ${this.options.targetDate} Daily Note, or keep it in the current note with the explicit scheduled value.`,
    });

    const buttonRow = contentEl.createDiv({ cls: 'tps-gcm-confirm-buttons' });
    buttonRow.createEl('button', { text: 'Move task', cls: 'mod-cta' }).addEventListener('click', () => {
      this.close();
      void Promise.resolve()
        .then(this.options.onMove)
        .catch((error) => {
          logger.flowError('DailyNoteTaskMovePromptModal', 'move:failed', error, {
            sourceDate: this.options.sourceDate,
            targetDate: this.options.targetDate,
          });
          new Notice('Could not move the task to its scheduled Daily Note.');
        });
    });
    buttonRow.createEl('button', { text: 'Keep here' }).addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
