
import { BasesView, QueryController, Menu, BasesEntry, BasesEntryGroup, setIcon, TFile, debounce, normalizePath, Modal, Setting, WorkspaceLeaf, parseYaml, Notice, Platform } from 'obsidian';
import {
  extractGroupValues as extractKanbanGroupValues,
  getFrontmatterPropNameFromId as getKanbanFrontmatterPropNameFromId,
} from '../kanban-utils';
import {
  buildKanbanRootTaskLine,
  getKanbanRootLineKind,
  normalizeKanbanTaskTargetPath,
  resolveKanbanRootTaskTargetPath,
  type KanbanRootLineKind,
} from '../task-creation-utils';
import {
  getKanbanCheckboxStateForStatus,
  getKanbanStatusForCheckboxState,
  getKanbanToggleCheckboxState,
  normalizeKanbanCheckboxState,
  replaceKanbanTaskLineCheckboxState,
} from '../task-checkbox-utils';
import {
  buildKanbanTaskDropLine,
  normalizeKanbanWritableTaskTag,
  parseKanbanLineItem,
} from '../task-drop-utils';
import { getMarkdownIndentColumns, orderTpsListHierarchy } from '../tps-list-hierarchy';
import { emitFilesUpdated } from '../tps-gcm-api';
import { flow, flowError, flowWarn } from '../logger';
import {
  filterTreeIncludesStructuralKind,
  isBareSemanticKindFilter,
  matchesTpsListStructuralKind,
  normalizeTpsListHeadingKind,
  parseBareSemanticKindExpression,
} from '../filter-kind-utils';
import { getTpsListHeadingDisplayTitle, parseTpsListHeadingLine, setTpsListHeadingText } from '../heading-line-utils';
import {
  composeEffectiveFilterRoots,
  evaluateOrderedFilterChildren,
  extractPersistedFilterRoots,
  isPersistedFilterCacheMatch,
} from '../base-filter-roots';
import { resolveBaseEmbedSourcePath } from '../../views/base-embed-context';
import { getOrderedSelectionRange, toggleOrderedSelection } from '../../utils/ordered-selection';
import { hashSelectionIdentity } from '../../utils/selection-identity';
import { getTaskLineIdentity } from '../../utils/task-line-resolution';
import { resolveBulletLineSourceTarget } from '../bullet-line-source-target';
import { requestLineItemDelete } from '../../services/line-item-delete-service';
import { TextInputModal } from '../../modals/text-input-modal';
import { ScheduledModal } from '../../modals/scheduled-modal';
import { RecurrenceModal } from '../../modals/recurrence-modal';
import { TagSuggestModal } from '../../modals/TagSuggestModal';
import { getPlainDisplayTitle } from '../../utils/display-title';
import {
  collectPropertyValuesByKey,
  findPropertyKeyCaseInsensitive,
  normalizePropertyKeyIdentity,
} from '../../utils/property-key-identity';
import {
  addLogBaseListPropertyValue,
  applyLogBasePropertyValueChoice,
  removeLogBaseListPropertyValue,
} from '../../views/log-base-property-choice';
import {
  readInlineFieldCarrierValues,
  setLogInlineFieldValue,
  setVisibleLineText,
  toggleLogLineSemanticTag,
  visibleLineText,
} from '../../views/log-line-utils';
import { resolveExactLineRevisionIndex, splitLineItemContent } from '../../utils/line-item-deletion';
import {
  abortDirectTaskHistory,
  beginDirectTaskHistory,
  commitDirectTaskHistory,
  ensureDirectTaskHistoryIdentity,
  type DirectTaskHistoryLocation,
  type DirectTaskHistoryLogContext,
} from '../../utils/direct-task-history';
import {
  scanMarkdownDocumentLines,
  type MarkdownDocumentLine,
} from '../../utils/markdown-document-lines';
import {
  addInlineTagToTaskLine,
  parseTaskTagValues,
  readInlineFieldRanges,
  readInlineFieldValue,
  readInlineTags,
  readTaskLineTags,
  removeInlineTagFromTaskLine,
} from '../../utils/task-line-metadata';
import { collectTpsListInlineFields } from '../task-inline-property-fields';
import {
  getSourceNoteGroupValue,
  getTpsBaseGroupLaneId,
  isSourceNoteGroupProperty,
  resolveTpsBaseGroupDescriptor,
} from '../../views/base-row-grouping';
import {
  compareTpsBaseValues,
  getTpsBaseAdditiveKindValues,
  getTpsBaseGroupValues,
  resolveTpsBaseMultiValueGroupingMode,
  resolveTpsBaseValueSemantics,
  type TpsBaseMultiValueGroupingMode,
  type TpsBaseValueSemantics,
} from '../../views/base-value-semantics';
import {
  resolveTpsBaseDateExpression,
  resolveTpsBaseLineCreationPlan,
  type TpsBaseLineCreationPlan,
} from '../../views/base-line-creation-plan';
import type { CustomProperty } from '../../types';
import { normalizeLinkedSubitemMappings } from '../../utils/linked-subitem-mapping';
import {
  isEntityReferenceProperty,
  mergeEntityReferenceList,
  mergeMixedEntityReferenceList,
  removeEntityReferenceListValues,
  removeMixedEntityReferenceListValues,
  resolveConfiguredProperty,
} from '../../utils/entity-property';
import { openPropertyValueSuggestModal } from '../../modals/PropertyValueSuggestModal';
import {
  showPropertyValueChoiceMenuAtElement,
} from '../../menu/property-value-choice-menu';
import {
  addLineEntityPropertyMenus,
  getConfiguredLineContextPropertyKeys,
} from '../../menu/line-entity-property-menu';
import {
  getWikilinkDisplayText,
  isLinkListProperty,
  isTagListProperty,
  mergeLinkList,
  mergeMixedList,
  mergeStringList,
  parseLinkListInput,
  parseMixedListInput,
  parseStringListInput,
  removeLinkListValues,
  removeStringListValues,
} from '../../utils/list-utils';
import { collectKnownVaultTags } from '../../utils/known-tags';
import {
  getBooleanPropertyPresentation,
  getNextBooleanPropertyValue,
  getReadOnlyBooleanFormulaPresentation,
  isBooleanPropertyType,
} from '../../utils/boolean-property';
import {
  findRelationalStatusProperty,
  propertyUsesEntityOptions,
} from '../../utils/property-option-source';
import {
  isRelationalStatusFilterExpression,
  isRelationalStatusPropertyReference as isRelationalStatusReference,
} from '../relational-status-routing';
import {
  compareTpsFormulaValues,
  extractTpsBaseFormulaDefinitions,
  formatTpsFormulaValue,
  getTpsFormulaComparableValues,
  getTpsFormulaGroupValues,
  hasTpsFormulaReference,
  isTpsFormulaTruthy,
  tpsBaseFormulaService,
  type TpsCompiledFormulaSet,
  type TpsFormulaRecordContext,
  type TpsFormulaResult,
  type TpsFormulaRowSession,
} from '../../services/tps-base-formula-service';
import { getOwningWorkspaceFile } from '../../views/base-view-owner';
import {
  evaluateLogBaseFilterRoots,
  type LogBaseFilterContext,
} from '../../views/log-base-filter';

export const TPS_LIST_VIEW_TYPE = 'tps-list';

type LaneRenderItem = {
  entry: BasesEntry;
  depth: number;
  hasChildren: boolean;
  childCount: number;
  children: LaneRenderItem[];
};

type TaskRenderItem = {
  file: TFile;
  task: OpenTaskSubitem;
  laneId: string;
  laneLabel?: string;
};

type TpsListRowItem =
  | { kind: 'note'; item: LaneRenderItem; nativeIndex: number; taskKey?: string; parentTaskKey?: string }
  | { kind: 'task' | 'heading'; item: TaskRenderItem; nativeIndex: number; taskKey: string; parentTaskKey?: string };

type TpsListDisplayRow = {
  row: TpsListRowItem;
  depth: number;
};

type TpsSortDescriptor = {
  prop: string;
  direction: 'asc' | 'desc';
};

type TpsTaskPropertyDisplay = {
  text: string;
  title?: string;
  kind?: string;
  editable?: boolean;
  propName?: string;
  rawValue?: unknown;
};

type ActiveTaskPointerDrag = {
  pointerId: number;
  itemKind?: 'task' | 'bullet';
  path: string;
  line: number;
  rawLine?: string;
  checkboxState?: string;
  text?: string;
  sourceLaneValues: string[];
  propName: string | null;
  displayLane: DisplayLaneGroup;
  startX: number;
  startY: number;
  moved: boolean;
  activated: boolean;
  activationTimer: number | null;
  detachLostPointerCapture: (() => void) | null;
  cardEl: HTMLElement;
};

type TpsListRenderScrollState = {
  top: number;
  left: number;
  laneCards: Record<string, number>;
};

type KanbanTaskRootFilter = {
  mode: 'mixed' | 'notes' | 'tasks' | 'bullets';
  hasTaskDirective: boolean;
  includeBullets: boolean;
  includeHeadings: boolean;
  includeDone: boolean;
  statuses: Set<string>;
  excludeStatuses: Set<string>;
  tags: Set<string>;
  excludeTags: Set<string>;
};

type DisplayLaneGroup = {
  id: string;
  label: string;
  groups: BasesEntryGroup[];
  laneIds: string[];
};

type OpenTaskSubitem = {
  itemKind?: 'task' | 'bullet' | 'heading';
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  internalId?: string;
  line: number;
  indent?: number;
  parentLine?: number;
  checkboxState?: string;
  text: string;
  rawLine?: string;
  displayText?: string;
  inlineFields?: Array<{ key: string; value: string }>;
};

type TaskDropPayload = {
  itemKind?: 'task' | 'bullet';
  path?: string;
  line?: number;
  rawLine?: string;
  checkboxState?: string;
  text?: string;
  sourceLaneValues?: string[];
};

type TaskDropPlan = {
  changes: string[];
  filterTags: string[];
  filterStatus: string | null;
  targetError: string | null;
  mappingError: string | null;
  currentLine: string;
  nextLine: string;
  itemKind: 'task' | 'bullet';
};

type TaskCreationDefaults = {
  mode?: 'mixed' | 'notes' | 'tasks' | 'bullets' | 'headings';
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  includeDone?: boolean;
  status?: string | null;
  targetPath?: string | null;
  targetPathSpecified?: boolean;
  inlineFields: Map<string, { key: string; value: string }>;
  tags: Set<string>;
  excludedStatuses: Set<string>;
  excludedTags: Set<string>;
};

type TpsBaseDefinitionCache = {
  path: string;
  mtime: number;
  viewName: string;
  viewNames: string[];
  filters: unknown[] | null;
  formulas: Record<string, string>;
  formulaSet: TpsCompiledFormulaSet;
};

type NoteCreationDefaults = {
  frontmatter: Record<string, unknown>;
  baseFileName?: string | null;
  blockedReason?: string | null;
};

const TPS_TASK_LINE_POINTER_DROP_EVENT = 'tps-task-line-pointer-drop';
// Match familiar mobile long-press timing while leaving a 10px touch slop so
// ordinary vertical scrolling cancels before TPS takes pointer capture.
const TPS_LIST_TOUCH_DRAG_HOLD_MS = 550;
const TPS_LIST_POINTER_DRAG_DISTANCE_PX = 10;

const MOBILE_UI_KEYBOARD_HIDDEN_CLASS = 'tps-tps-mobile-ui-keyboard-hidden';
const MOBILE_UI_GESTURE_HIDDEN_CLASS = 'tps-tps-mobile-ui-gesture-hidden';
const MOBILE_KEYBOARD_COLLAPSE_THRESHOLD_PX = 140;

const FALLBACK_ICON_PATHS: Record<string, string[]> = {
  plus: ['M12 5v14', 'M5 12h14'],
  pencil: ['M18 2l4 4L8 20l-5 1 1-5L18 2z'],
  columns: ['M4 5h16v14H4z', 'M12 5v14'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  'panel-left-close': ['M4 5h16v14H4z', 'M9 5v14', 'M15 9l-3 3 3 3'],
  'panel-left-open': ['M4 5h16v14H4z', 'M9 5v14', 'M12 9l3 3-3 3'],
  'eye-off': ['M3 3l18 18', 'M10.6 10.6a2 2 0 0 0 2.8 2.8', 'M9.9 4.2A10.8 10.8 0 0 1 12 4c5 0 9 5 9 5a16 16 0 0 1-3.1 3.8', 'M6.6 6.6C4.3 8.1 3 10 3 10s4 5 9 5c1.1 0 2.1-.2 3-.5'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  'grip-vertical': ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
  'chevron-right': ['M9 18l6-6-6-6'],
  'chevron-down': ['M6 9l6 6 6-6'],
  square: ['M5 5h14v14H5z'],
  'square-check-big': ['M5 5h14v14H5z', 'M9 12l2 2 4-5'],
  'square-minus': ['M5 5h14v14H5z', 'M9 12h6'],
  'square-play': ['M5 5h14v14H5z', 'M10 8l6 4-6 4z'],
  'square-help': ['M5 5h14v14H5z', 'M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4', 'M12 17h.01'],
  'square-dot': ['M5 5h14v14H5z', 'M12 12h.01'],
};

function setIconWithFallback(el: HTMLElement, iconId: string): void {
  el.empty();
  try {
    setIcon(el, iconId);
  } catch {
    // Fall back below.
  }
  if (el.querySelector('svg')) return;

  const paths = FALLBACK_ICON_PATHS[iconId];
  if (!paths) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  el.appendChild(svg);
}

class TaskDropConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: any,
    private readonly title: string,
    private readonly changes: string[],
    private readonly onResolve: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("tps-keyboard-aware-modal");
    this.modalEl.addClass("mod-tps-gcm-tps-list");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: this.title });
    contentEl.createEl('p', {
      text: 'This will update the task line itself, not any note linked from the task title.',
    });
    const currentLine = this.changes.find((change) => change.startsWith('Current line: '));
    const resultLine = this.changes.find((change) => change.startsWith('Result line: '));
    if (currentLine || resultLine) {
      const preview = contentEl.createDiv({ cls: 'tps-kanban-task-drop-preview' });
      if (currentLine) {
        preview.createEl('div', { cls: 'tps-kanban-task-drop-preview-label', text: 'Current line' });
        preview.createEl('code', { cls: 'tps-kanban-task-drop-preview-line', text: currentLine.replace(/^Current line:\s*/u, '') });
      }
      if (resultLine) {
        preview.createEl('div', { cls: 'tps-kanban-task-drop-preview-label', text: 'Result line' });
        preview.createEl('code', { cls: 'tps-kanban-task-drop-preview-line', text: resultLine.replace(/^Result line:\s*/u, '') });
      }
    }
    const list = contentEl.createEl('ul');
    for (const change of this.changes.filter((item) => !/^(?:Current|Result) line: /u.test(item))) {
      list.createEl('li', { text: change });
    }
    const buttonRow = contentEl.createDiv({ cls: 'tps-kanban-confirm-buttons' });
    buttonRow.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.finish(false));
    buttonRow.createEl('button', { text: 'Apply changes', cls: 'mod-cta' }).addEventListener('click', () => this.finish(true));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.onResolve(false);
  }

  private finish(confirmed: boolean): void {
    this.resolved = true;
    this.close();
    this.onResolve(confirmed);
  }
}

class LaneValueSelectModal extends Modal {
  private readonly titleText: string;
  private readonly options: Array<{ label: string; value: string | null }>;
  private readonly resolve: (value: string | null | undefined) => void;
  private submitted = false;

  constructor(
    app: any,
    titleText: string,
    options: Array<{ label: string; value: string | null }>,
    resolve: (value: string | null | undefined) => void,
  ) {
    super(app);
    this.titleText = titleText;
    this.options = options;
    this.resolve = resolve;
  }

  onOpen(): void {
    this.modalEl.addClass("tps-keyboard-aware-modal");
    this.modalEl.addClass("mod-tps-gcm-tps-list");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: this.titleText });
    contentEl.createEl('p', { text: 'Choose which underlying value to apply:' });

    const list = contentEl.createDiv({ cls: 'tps-kanban-lane-value-picker' });
    this.options.forEach((option) => {
      const button = list.createEl('button', {
        cls: 'mod-cta',
        text: option.label,
      });
      button.addEventListener('click', () => this.submit(option.value));
    });

    const cancel = contentEl.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.cancel());
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.submitted) this.resolve(undefined);
  }

  private submit(value: string | null): void {
    if (this.submitted) return;
    this.submitted = true;
    this.resolve(value);
    this.close();
  }

  private cancel(): void {
    if (this.submitted) return;
    this.submitted = true;
    this.resolve(undefined);
    this.close();
  }
}

class TaskTitleModal extends Modal {
  private submitted = false;
  private inputEl: HTMLInputElement | null = null;

  constructor(
    app: any,
    private readonly cardTitle: string,
    private readonly itemKind: KanbanRootLineKind,
    private readonly resolve: (value: string | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("tps-keyboard-aware-modal");
    this.modalEl.addClass("mod-tps-gcm-tps-list");
    const { contentEl } = this;
    contentEl.empty();
    const noun = this.itemKind === 'heading' ? 'heading' : this.itemKind;
    contentEl.createEl('h3', { text: `Add ${noun} to ${this.cardTitle}` });

    new Setting(contentEl)
      .setName(`${this.itemKind === 'bullet' ? 'Bullet' : this.itemKind === 'heading' ? 'Heading' : 'Task'} title`)
      .addText((text) => {
        this.inputEl = text.inputEl;
        text.setPlaceholder(`${this.itemKind === 'bullet' ? 'Bullet' : this.itemKind === 'heading' ? 'Heading' : 'Task'} title`);
        text.inputEl.addEventListener('keydown', (evt: KeyboardEvent) => {
          if (evt.key === 'Enter') {
            evt.preventDefault();
            this.submit();
          } else if (evt.key === 'Escape') {
            evt.preventDefault();
            this.cancel();
          }
        });
      });

    const actions = contentEl.createDiv({ cls: 'tps-kanban-lane-rename-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.cancel());
    actions.createEl('button', { text: `Add ${noun}`, cls: 'mod-cta' }).addEventListener('click', () => this.submit());

    window.setTimeout(() => this.inputEl?.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.submitted) this.resolve(null);
  }

  private submit(): void {
    if (this.submitted) return;
    const value = String(this.inputEl?.value ?? '').trim();
    if (!value) return;
    this.submitted = true;
    this.resolve(value);
    this.close();
  }

  private cancel(): void {
    if (this.submitted) return;
    this.submitted = true;
    this.resolve(null);
    this.close();
  }
}

export class TpsListView extends BasesView {
  type = TPS_LIST_VIEW_TYPE;
  private plugin: any;
  private scrollEl: HTMLElement;
  private containerEl: HTMLElement;
  private refreshDebounced: () => void;
  private selectedRowIds = new Set<string>();
  private activeNotePath: string | null = null;
  private selectionAnchorRowId: string | null = null;
  private renderedRowOrder: string[] = [];
  private renderedTaskItemCount = 0;
  private renderedResultCount = 0;
  private hasRenderedResultCount = false;
  private expandedSubtreePaths = new Set<string>();
  private openTasksByPath = new Map<string, OpenTaskSubitem[]>();
  private allTasksByPath = new Map<string, OpenTaskSubitem[]>();
  private openTaskOverflowByPath = new Map<string, number>();
  private openTasksLoading = new Set<string>();
  private taskCacheEpochByPath = new Map<string, number>();
  private baseFileFilterCache: TpsBaseDefinitionCache | null = null;
  private baseFileFiltersLoadingKey: string | null = null;
  private baseFileFiltersLoadingPromise: Promise<boolean> | null = null;
  private embeddedBaseFilterCache: TpsBaseDefinitionCache | null = null;
  private stampedFormulaSet: TpsCompiledFormulaSet | null = null;
  private embeddedBaseFiltersLoadingKey: string | null = null;
  private embeddedBaseFiltersLoadingPromise: Promise<boolean> | null = null;
  private baseFilterSignature = '';
  private baseFilterPollInterval: number | null = null;
  private renderGeneration = 0;
  private wheelHandlerTarget: HTMLElement | null = null;
  private onWheelBound: ((event: WheelEvent) => void) | null = null;
  private touchHandlerTarget: HTMLElement | null = null;
  private onTouchStartBound: ((event: TouchEvent) => void) | null = null;
  private onTouchMoveBound: ((event: TouchEvent) => void) | null = null;
  private onTouchEndBound: ((event: TouchEvent) => void) | null = null;
  private mobileKeyboardSuppressed = false;
  private mobileGestureSuppressed = false;
  private mobileKeyboardResizeBaseHeight = 0;
  private mobileKeyboardTimeout: number | null = null;
  private mobileGestureRevealTimeout: number | null = null;
  private activeTaskPointerDrag: ActiveTaskPointerDrag | null = null;
  private renderedDisplayLanesById = new Map<string, DisplayLaneGroup>();
  private suppressTaskRowClickUntil = 0;
  private taskFormulaSessions = new WeakMap<OpenTaskSubitem, TpsFormulaRowSession>();
  private formulaFileContexts = new Map<string, NonNullable<TpsFormulaRecordContext['file']>>();
  private formulaThisValue: Record<string, unknown> | null | undefined;
  private formulaDiagnostics = new Set<string>();
  private formulaFilterFailureSequence = 0;
  private formulaNow: Date | undefined;
  private noteSemanticReconciliationRevision = 0;
  private noteSemanticReconciliationCache: { key: string; entries: BasesEntry[] } | null = null;

  constructor(controller: QueryController, scrollEl: HTMLElement, plugin: any) {
    super(controller);
    this.plugin = plugin;
    this.scrollEl = scrollEl;
    scrollEl.removeClass('tps-log-base');
    delete (scrollEl as any).__tpsTableView;
    scrollEl.addClass('tps-list-scroll');
    Object.assign(scrollEl, { __tpsListView: this });
    this.containerEl = scrollEl.createDiv({ cls: 'tps-list-container' });
    this.refreshDebounced = debounce(() => this.render(), 120, false);
    this.applyLayoutSettings();
  }

  async createFileForView(
    baseFileName?: string,
    frontmatterProcessor?: (frontmatter: Record<string, unknown>) => void,
  ): Promise<void> {
    if (this.runCreateCommandOverride()) return;
    let creationFilterRoots: unknown[];
    try {
      creationFilterRoots = await this.getBaseFilterRootsForCreation();
    } catch (error) {
      flowError('CreateFile', 'filter-read-failed', error, {
        viewType: this.type,
        viewName: this.getConfiguredBaseViewName(),
      });
      new Notice('Could not read the Base filters, so TPS List did not create anything.');
      return;
    }
    const taskFilter = this.getTaskRootFilterFromBaseFilters(creationFilterRoots);
    flow('CreateFile', 'start', {
      baseFileName: baseFileName || '',
      taskFilterMode: taskFilter.mode,
      viewType: this.type,
      viewName: this.getConfiguredBaseViewName(),
    });
    const creationCheckboxMappings = this.getGcmCheckboxMappings();
    const linePlan = resolveTpsBaseLineCreationPlan(creationFilterRoots, {
      resolveValue: (value) => this.resolveBaseContextToken(value) ?? '',
      orderedMappedStatuses: creationCheckboxMappings.flatMap((mapping) => mapping.statuses),
      isDoneStatus: (status) => this.classifyDoneStatus(status),
      isWorkflowStatusProperty: (property) => {
        const normalized = String(property || '').trim().toLowerCase();
        return normalized === 'task.status'
          || normalized.endsWith('checkboxstatus')
          || !findRelationalStatusProperty(this.getGcmSettings()?.properties);
      },
    });
    if (linePlan.blockedReason) {
      flowWarn('CreateFile', 'blocked', {
        reason: linePlan.blockedReason,
        selectedBranches: linePlan.diagnostics.selectedBranches,
        viewName: this.getConfiguredBaseViewName(),
      });
      new Notice('Could not create an item because the active-view and whole-Base filters do not have a compatible default.');
      return;
    }
    const lineKind = linePlan.kind;
    if (lineKind) {
      const lineDefaults = this.getTaskCreationDefaultsFromPlan(linePlan);
      const desiredTaskStatus = lineKind === 'task'
        ? lineDefaults.status || this.getDefaultMappedTaskStatus('open')
        : null;
      if (lineKind === 'task' && (!desiredTaskStatus || !this.getCheckboxStateForStatus(desiredTaskStatus))) {
        flowWarn('CreateFile', 'blocked', {
          reason: 'unmapped-status',
          status: desiredTaskStatus || '',
          viewName: this.getConfiguredBaseViewName(),
        });
        new Notice(desiredTaskStatus
          ? `Could not create the task because status "${desiredTaskStatus}" has no checkbox mapping.`
          : 'Could not create the task because GCM has no authoritative mapped open status.');
        return;
      }
      flow('CreateFile', 'route-root-line', {
        reason: 'structural-kind-filter',
        itemKind: lineKind,
        headingLevel: lineDefaults.headingLevel ?? null,
        defaultKeys: Array.from(lineDefaults.inlineFields.keys()),
        tagCount: lineDefaults.tags.size,
        selectedBranches: linePlan.diagnostics.selectedBranches,
        viewName: this.getConfiguredBaseViewName(),
      });
      await this.createRootTaskForLane(
        null,
        { id: 'ungrouped', label: 'Ungrouped', groups: [], laneIds: ['ungrouped'] },
        taskFilter,
        lineKind,
        creationFilterRoots,
        lineDefaults,
      );
      return;
    }

    if (hasTpsFormulaReference(creationFilterRoots)) {
      flowWarn('CreateFile', 'blocked', {
        reason: 'formula-filtered-note-creation-unverifiable',
        viewName: this.getConfiguredBaseViewName(),
      });
      new Notice('TPS List did not create the note because its formula filter cannot be validated before the file exists.');
      return;
    }

    const creationDefaults = this.getNoteCreationDefaultsFromBaseFilters();
    if (!baseFileName && creationDefaults.blockedReason) {
      flowWarn('CreateFile', 'blocked', { reason: creationDefaults.blockedReason });
      new Notice(creationDefaults.blockedReason);
      return;
    }
    const mergedProcessor = (frontmatter: Record<string, unknown>) => {
      Object.assign(frontmatter, creationDefaults.frontmatter);
      frontmatterProcessor?.(frontmatter);
    };
    flow('CreateFile', 'route-note', {
      baseFileName: baseFileName ?? creationDefaults.baseFileName ?? '',
      defaultKeys: Object.keys(creationDefaults.frontmatter || {}),
    });
    await super.createFileForView(baseFileName ?? creationDefaults.baseFileName ?? undefined, mergedProcessor);
  }

  private getPriorityResolvedCreationMode(
    taskFilter: KanbanTaskRootFilter,
    roots = this.getBaseFilterRoots(),
  ): TaskCreationDefaults['mode'] {
    for (const root of roots) {
      const mode = this.inferPriorityCreationModeFromFilterNode(root);
      if (mode) return mode;
    }
    return taskFilter.mode;
  }

  private inferPriorityCreationModeFromFilterNode(node: unknown): TaskCreationDefaults['mode'] | null {
    if (!node) return null;
    if (typeof node === 'string') {
      if (parseBareSemanticKindExpression(node)) return 'notes';
      const match = node.trim().match(/^(?:(?:tps|kanban)\.)?(?:itemtype|itemkind|kind)\s*(?:==|=|is|equals?)\s*["']?(task|tasks|bullet|bullets|note|notes|all|mixed)["']?$/i);
      const value = String(match?.[1] || '').toLowerCase();
      return value.startsWith('task') ? 'tasks'
        : value.startsWith('bullet') ? 'bullets'
          : value.startsWith('note') ? 'notes'
            : value ? 'mixed' : null;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        const mode = this.inferPriorityCreationModeFromFilterNode(child);
        if (mode) return mode;
      }
      return null;
    }
    if (typeof node !== 'object') return null;
    const record = node as Record<string, unknown>;
    for (const branchKey of ['or', 'any']) {
      if (!Object.prototype.hasOwnProperty.call(record, branchKey)) continue;
      for (const child of this.asArray(record[branchKey])) {
        const mode = this.inferPriorityCreationModeFromFilterNode(child);
        if (mode) return mode;
      }
      return null;
    }
    for (const groupKey of ['and', 'all', 'filters', 'children', 'data']) {
      if (!Object.prototype.hasOwnProperty.call(record, groupKey)) continue;
      const mode = this.inferPriorityCreationModeFromFilterNode(record[groupKey]);
      if (mode) return mode;
    }
    const propRaw = String(record.property ?? record.field ?? '').trim();
    const values = this.readFilterObjectValues(record);
    if (isBareSemanticKindFilter(propRaw, values)) return 'notes';
    const normalizedProp = this.normalizeInlinePropertyKey(propRaw.replace(/^(?:tps|kanban)\./i, ''));
    if (!['itemtype', 'itemkind', 'kind'].includes(normalizedProp)) return null;
    const value = String(values[0] || '').trim().toLowerCase();
    return value.startsWith('task') ? 'tasks'
      : value.startsWith('bullet') ? 'bullets'
        : value.startsWith('note') ? 'notes'
          : ['all', 'mixed'].includes(value) ? 'mixed' : null;
  }

  private getCreateCommandOverride(): { id: string; name: string } | null {
    const rawAction = this.getConfigValue('createAction') ?? (this.getConfigValue('create') as any)?.action;
    if (String(rawAction || '').trim().toLowerCase() !== 'command') return null;
    const commandId = String(this.getConfigValue('createCommandId') ?? (this.getConfigValue('create') as any)?.commandId ?? '').trim();
    if (!commandId) return null;
    const commands = (this.app as any)?.commands;
    const command = commands?.findCommand?.(commandId);
    return { id: commandId, name: String(command?.name || commandId) };
  }

  private getConfigValue(key: string): unknown {
    const getterValue = this.config?.get?.(key);
    if (getterValue != null) return getterValue;
    return (this.config as any)?.[key];
  }

  private runCreateCommandOverride(): boolean {
    const command = this.getCreateCommandOverride();
    if (!command) return false;
    const commands = (this.app as any)?.commands;
    if (typeof commands?.executeCommandById !== 'function') return false;
    const executed = commands.executeCommandById(command.id);
    if (!executed) new Notice(`Command not found: ${command.id}`);
    flow('CreateCommandOverride', 'run', {
      commandId: command.id,
      executed: !!executed,
      viewType: this.type,
      viewName: this.getConfiguredBaseViewName(),
    });
    return true;
  }

  private getGcmApi(): any {
    return this.plugin?.api ?? null;
  }

  private getGcmPlugin(): any {
    return this.plugin ?? null;
  }

  private getGcmServices(): any {
    const gcm = this.getGcmApi();
    return gcm?.services || gcm?.sharedServices || null;
  }

  private async processFrontmatter(
    file: TFile,
    mutator: (frontmatter: Record<string, any>) => void | Promise<void>,
  ): Promise<boolean> {
    const service = this.getGcmPlugin()?.frontmatterMutationService;
    if (typeof service?.process !== 'function') {
      throw new Error('TPS GCM frontmatter mutation service is unavailable.');
    }
    return await service.process(file, mutator);
  }

  private openTaskLineContextMenu(evt: MouseEvent, fallbackPath?: string | null, fallbackLine?: number | null): boolean {
    const plugin = this.getGcmPlugin();
    const contextTargetService = plugin?.contextTargetService || this.getGcmApi()?.contextTargetService;
    const taskLineContextMenuService = plugin?.taskLineContextMenuService || this.getGcmApi()?.taskLineContextMenuService;
    if (typeof taskLineContextMenuService?.handleContextMenu !== 'function') {
      return false;
    }

    if (!evt) {
      return false;
    }

    const rawTarget = evt.target instanceof HTMLElement
      ? evt.target
      : evt.currentTarget instanceof HTMLElement
        ? evt.currentTarget
        : null;

    const rootTarget = rawTarget
      ? rawTarget.closest<HTMLElement>([
          '.tps-kanban-card-task[data-task-path][data-task-line]',
          '.tps-kanban-task-card[data-task-path][data-task-line]',
          '[data-task-path][data-task-line][data-tps-gcm-context="kanban-task"]',
          '[data-tps-gcm-context="kanban-task"]',
        ].join(', '))
      : null;

    if (typeof contextTargetService?.recordContextTarget === 'function') {
      if (rootTarget) {
        contextTargetService.recordContextTarget(rootTarget);
      } else if (typeof fallbackLine === 'number' && fallbackPath) {
        const line = Number(fallbackLine);
        const expectedLine = String(Math.max(1, Math.floor(line) + 1));
        const escapedPath = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
          ? CSS.escape(fallbackPath)
          : fallbackPath.replace(/"/g, '\\"');
        const selector = [
          `.tps-kanban-card-task[data-task-path="${escapedPath}"][data-task-line="${expectedLine}"]`,
          `.tps-kanban-task-card[data-task-path="${escapedPath}"][data-task-line="${expectedLine}"]`,
          `[data-task-path="${escapedPath}"][data-task-line="${expectedLine}"][data-tps-gcm-context="kanban-task"]`,
          `[data-task-path="${escapedPath}"][data-task-line="${expectedLine}"]`,
        ].join(', ');
        const fallbackTarget = this.containerEl.querySelector<HTMLElement>(selector);
        if (fallbackTarget) {
          contextTargetService.recordContextTarget(fallbackTarget);
        }
      }
    }

    return taskLineContextMenuService.handleContextMenu(evt);
  }

  private openTaskQuickEditor(event: Event, taskEl: HTMLElement, sourceEl: HTMLElement | null = taskEl): boolean {
    const plugin = this.getGcmPlugin();
    const service = plugin?.taskLineContextMenuService || this.getGcmApi()?.taskLineContextMenuService;
    if (typeof service?.openQuickEditorForElement !== 'function') return false;
    event.preventDefault();
    event.stopPropagation();
    if ('stopImmediatePropagation' in event && typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    void service.openQuickEditorForElement(taskEl, sourceEl);
    return true;
  }

  private async resolveRenderedLineRevision(
    file: TFile,
    oneBasedLine: number,
    expectedRawLine: string,
    scope: string,
    itemLabel: 'heading' | 'line item',
  ): Promise<{ lineIndex: number; rawLine: string } | null> {
    const preferredIndex = Math.max(0, oneBasedLine - 1);
    const expectedLine = String(expectedRawLine ?? '');
    if (!expectedLine) {
      flowWarn(scope, 'open:missing-rendered-revision', { path: file.path, line: oneBasedLine });
      new Notice(`That ${itemLabel} is out of date. Refresh the view and try again.`);
      return null;
    }
    try {
      const content = await this.app.vault.cachedRead(file);
      const parts = splitLineItemContent(content);
      const lineIndex = resolveExactLineRevisionIndex(parts.lines, preferredIndex, expectedLine);
      if (lineIndex < 0) {
        flowWarn(scope, 'open:stale-target', { path: file.path, line: oneBasedLine });
        new Notice(`That ${itemLabel} changed since this list was rendered. Refresh the view and try again.`);
        return null;
      }
      return { lineIndex, rawLine: parts.lines[lineIndex] ?? expectedLine };
    } catch (error) {
      flowError(scope, 'open:source-read-failed', error, { path: file.path, line: oneBasedLine });
      new Notice(`Could not verify the ${itemLabel}.`);
      return null;
    }
  }

  private async openRenderedLineInNote(
    file: TFile,
    oneBasedLine: number,
    expectedRawLine: string,
    sourceEl: HTMLElement | undefined,
    scope: string,
    itemLabel: 'heading' | 'line item',
  ): Promise<void> {
    const revision = await this.resolveRenderedLineRevision(
      file,
      oneBasedLine,
      expectedRawLine,
      scope,
      itemLabel,
    );
    if (!revision) return;
    try {
      await this.openTaskLine(file, revision.lineIndex + 1, sourceEl);
    } catch (error) {
      flowError(scope, 'open-line:failed', error, { path: file.path, line: revision.lineIndex + 1 });
      new Notice(`Could not open the ${itemLabel}.`);
    }
  }

  private openBulletLineEditor(
    event: Event,
    file: TFile,
    oneBasedLine: number,
    expectedRawLine: string,
  ): boolean {
    const service = this.getGcmPlugin()?.homeCaptureService || this.getGcmApi()?.homeCaptureService;
    if (typeof service?.openLineEditor !== 'function') return false;
    event.preventDefault();
    event.stopPropagation();
    if ('stopImmediatePropagation' in event && typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    void this.resolveRenderedLineRevision(
      file,
      oneBasedLine,
      expectedRawLine,
      'BulletLineEditor',
      'line item',
    ).then(async (revision) => {
      if (!revision) return;
      await service.openLineEditor(file, revision.lineIndex);
    }).catch((error) => {
      flowError('BulletLineEditor', 'open:failed', error, { path: file.path, line: oneBasedLine });
      new Notice('Could not open the line editor.');
    });
    return true;
  }

  private promptRenderedLineTitle(
    kind: 'heading' | 'bullet',
    file: TFile,
    lineIndex: number,
    rawLine: string,
  ): void {
    const currentTitle = kind === 'heading'
      ? getTpsListHeadingDisplayTitle(rawLine)
      : getPlainDisplayTitle(visibleLineText(rawLine));
    flow(kind === 'heading' ? 'HeadingLineMenu' : 'BulletLineMenu', 'title-rename:prompt', {
      path: file.path,
      line: lineIndex + 1,
      linkedTitle: currentTitle !== (kind === 'heading' ? parseTpsListHeadingLine(rawLine)?.text : visibleLineText(rawLine)),
    });
    new TextInputModal(this.app, kind === 'heading' ? 'Heading title' : 'Title', currentTitle, async (value) => {
      const title = String(value || '').replace(/\s+/g, ' ').trim();
      if (!title) return;
      await this.updateRenderedLineTitle(kind, file, lineIndex, rawLine, title);
    }).open();
  }

  private async updateRenderedLineTitle(
    kind: 'heading' | 'bullet',
    file: TFile,
    lineIndex: number,
    rawLine: string,
    title: string,
  ): Promise<void> {
    const mutation: { outcome: 'changed' | 'unchanged' | 'stale' } = { outcome: 'unchanged' };
    try {
      await this.app.vault.process(file, (content) => {
        const parts = splitLineItemContent(content);
        const resolvedIndex = resolveExactLineRevisionIndex(parts.lines, lineIndex, rawLine);
        if (resolvedIndex < 0) {
          mutation.outcome = 'stale';
          return content;
        }
        const current = parts.lines[resolvedIndex] || '';
        const next = kind === 'heading'
          ? setTpsListHeadingText(current, title)
          : setVisibleLineText(current, title);
        if (!next || next === current) return content;
        parts.lines[resolvedIndex] = next;
        mutation.outcome = 'changed';
        return `${parts.lines.join(parts.newline)}${parts.endsWithNewline ? parts.newline : ''}`;
      });
    } catch (error) {
      flowError(kind === 'heading' ? 'HeadingLineMenu' : 'BulletLineMenu', 'title-rename:failed', error, {
        path: file.path,
        line: lineIndex + 1,
      });
      new Notice(`Could not rename the ${kind === 'heading' ? 'heading' : 'line item'}.`);
      return;
    }

    if (mutation.outcome === 'stale') {
      flowWarn(kind === 'heading' ? 'HeadingLineMenu' : 'BulletLineMenu', 'title-rename:stale-target', {
        path: file.path,
        line: lineIndex + 1,
      });
      new Notice(`That ${kind === 'heading' ? 'heading' : 'line item'} changed before it could be renamed. Refresh and try again.`);
      return;
    }
    if (mutation.outcome !== 'changed') return;

    emitFilesUpdated(this.app, [file.path], 'tps-list');
    this.getGcmPlugin()?.overlayRenderingService?.invalidate?.({
      reason: `tps-list-${kind}-title-rename`,
      file,
      surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
      rebuildInlineSubitems: kind === 'bullet',
      refreshLivePreviewEditors: true,
      delayMs: 80,
    });
    flow(kind === 'heading' ? 'HeadingLineMenu' : 'BulletLineMenu', 'title-rename:done', {
      path: file.path,
      line: lineIndex + 1,
      preservedLeadingLink: /^\s*(?:[-*+]\s+)?!?\[/.test(rawLine),
    });
  }

  private async updateRenderedLineEntityProperty(
    kind: 'heading' | 'bullet',
    file: TFile,
    lineIndex: number,
    rawLine: string,
    property: CustomProperty,
    action: 'set' | 'clear' | 'remove',
    updater: (currentLine: string) => string,
  ): Promise<boolean> {
    const mutation: { outcome: 'changed' | 'unchanged' | 'stale' } = { outcome: 'unchanged' };
    let resolvedLineIndex = lineIndex;
    try {
      await this.app.vault.process(file, (content) => {
        const parts = splitLineItemContent(content);
        const resolvedIndex = resolveExactLineRevisionIndex(parts.lines, lineIndex, rawLine);
        if (resolvedIndex < 0) {
          mutation.outcome = 'stale';
          return content;
        }
        const current = parts.lines[resolvedIndex] || '';
        const stillMatchesKind = kind === 'heading'
          ? parseTpsListHeadingLine(current) != null
          : !!this.parseLineItem(current, true) && parseTpsListHeadingLine(current) == null;
        if (!stillMatchesKind) {
          mutation.outcome = 'stale';
          return content;
        }
        const next = updater(current);
        if (!next || next === current) return content;
        parts.lines[resolvedIndex] = next;
        resolvedLineIndex = resolvedIndex;
        mutation.outcome = 'changed';
        return `${parts.lines.join(parts.newline)}${parts.endsWithNewline ? parts.newline : ''}`;
      });
    } catch (error) {
      flowError(kind === 'heading' ? 'HeadingLineMenu' : 'BulletLineMenu', 'entity-property:failed', error, {
        action,
        path: file.path,
        line: lineIndex + 1,
        property: property.key,
      });
      new Notice(`Could not update ${property.label || property.key}.`);
      return false;
    }

    if (mutation.outcome === 'stale') {
      flowWarn(kind === 'heading' ? 'HeadingLineMenu' : 'BulletLineMenu', 'entity-property:stale-target', {
        action,
        path: file.path,
        line: lineIndex + 1,
        property: property.key,
      });
      new Notice(`That ${kind === 'heading' ? 'heading' : 'line item'} changed before its property could be updated.`);
      return false;
    }
    if (mutation.outcome !== 'changed') return false;

    this.clearTaskCachesForPath(file.path);
    emitFilesUpdated(this.app, [file.path], 'tps-list');
    this.getGcmPlugin()?.overlayRenderingService?.invalidate?.({
      reason: `tps-list-${kind}-entity-property`,
      file,
      surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
      rebuildInlineSubitems: kind === 'bullet',
      refreshLivePreviewEditors: true,
      delayMs: 80,
    });
    flow(kind === 'heading' ? 'HeadingLineMenu' : 'BulletLineMenu', 'entity-property:done', {
      action,
      path: file.path,
      requestedLine: lineIndex + 1,
      resolvedLine: resolvedLineIndex + 1,
      property: property.key,
      acceptedKind: property.acceptsKind,
    });
    this.render(false);
    return true;
  }

  private addBulletLineTagsMenu(menu: Menu, file: TFile, lineIndex: number, rawLine: string): void {
    const current = readInlineTags(rawLine);
    menu.addItem((item) => {
      item
        .setTitle(current.length > 0 ? `Line tags (${current.length})` : 'Line tags')
        .setIcon('tag')
        .setSection('tps-line');
      (item as any)._isTpsItem = true;
      const subMenu = (item as any).setSubmenu();
      subMenu.addItem((sub: any) => {
        sub.setTitle('Add tag...').setIcon('plus').onClick(() => {
          new TextInputModal(this.app, 'Tag', '', async (value) => {
            const tag = String(value || '').trim();
            if (!tag) return;
            await this.updateBulletLineTags(file, lineIndex, rawLine, 'add', (line) => (
              addInlineTagToTaskLine(line, tag)
            ));
          }, { suggestions: collectKnownVaultTags(this.app) }).open();
        });
      });
      if (current.length > 0) subMenu.addSeparator();
      for (const tag of current) {
        subMenu.addItem((sub: any) => {
          sub.setTitle(`Remove #${tag}`).setIcon('x').onClick(() => {
            void this.updateBulletLineTags(file, lineIndex, rawLine, 'remove', (line) => (
              removeInlineTagFromTaskLine(line, tag)
            ));
          });
        });
      }
    });
  }

  private async updateBulletLineTags(
    file: TFile,
    lineIndex: number,
    rawLine: string,
    action: 'add' | 'remove',
    updater: (line: string) => string,
  ): Promise<void> {
    const mutation: { outcome: 'changed' | 'unchanged' | 'stale' } = { outcome: 'unchanged' };
    try {
      await this.app.vault.process(file, (content) => {
        const parts = splitLineItemContent(content);
        const resolvedIndex = resolveExactLineRevisionIndex(parts.lines, lineIndex, rawLine);
        if (resolvedIndex < 0) {
          mutation.outcome = 'stale';
          return content;
        }
        const current = parts.lines[resolvedIndex] || '';
        const next = updater(current);
        if (next === current) return content;
        parts.lines[resolvedIndex] = next;
        mutation.outcome = 'changed';
        return `${parts.lines.join(parts.newline)}${parts.endsWithNewline ? parts.newline : ''}`;
      });
    } catch (error) {
      flowError('BulletLineMenu', 'tags:failed', error, {
        action,
        path: file.path,
        line: lineIndex + 1,
      });
      new Notice('Could not update tags for that line item.');
      return;
    }

    if (mutation.outcome === 'stale') {
      flowWarn('BulletLineMenu', 'tags:stale-target', {
        action,
        path: file.path,
        line: lineIndex + 1,
      });
      new Notice('That line item changed before its tags could be updated. Refresh and try again.');
      return;
    }
    if (mutation.outcome !== 'changed') return;

    emitFilesUpdated(this.app, [file.path], 'tps-list');
    this.getGcmPlugin()?.overlayRenderingService?.invalidate?.({
      reason: 'tps-list-bullet-tags',
      file,
      surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
      rebuildInlineSubitems: true,
      refreshLivePreviewEditors: true,
      delayMs: 80,
    });
    flow('BulletLineMenu', 'tags:done', {
      action,
      path: file.path,
      line: lineIndex + 1,
    });
  }

  private async openHeadingLineContextMenu(
    event: MouseEvent,
    file: TFile,
    oneBasedLine: number,
    expectedRawLine: string,
    row: HTMLElement,
  ): Promise<void> {
    try {
      const revision = await this.resolveRenderedLineRevision(
        file,
        oneBasedLine,
        expectedRawLine,
        'HeadingLineMenu',
        'heading',
      );
      if (!revision) return;
      const { lineIndex, rawLine } = revision;
      const resolvedOneBasedLine = lineIndex + 1;
      const plugin = this.getGcmPlugin();
      const menu = new Menu();
      const addHeadingAction = (
        title: string,
        icon: string,
        onClick: () => void,
        warning = false,
        section = 'tps-line',
      ): void => {
        menu.addItem((item) => {
          item.setTitle(title)
            .setIcon(icon)
            .setSection(section)
            .onClick(onClick);
          if (warning) (item as any).setWarning?.(true);
          (item as any)._isTpsItem = true;
        });
      };

      addHeadingAction(`Title: ${getTpsListHeadingDisplayTitle(rawLine) || '(empty)'}`, 'pencil', () => {
        this.promptRenderedLineTitle('heading', file, lineIndex, rawLine);
      }, false, 'tps-title');

      if (plugin) {
        addLineEntityPropertyMenus({
          app: this.app,
          plugin,
          menu,
          file,
          rawLine,
          mutateLine: (updater, property, action) => this.updateRenderedLineEntityProperty(
            'heading',
            file,
            lineIndex,
            rawLine,
            property,
            action,
            updater,
          ),
        });
      }

      addHeadingAction('Open heading in note', 'file-text', () => {
        void this.openRenderedLineInNote(
          file,
          resolvedOneBasedLine,
          rawLine,
          row,
          'HeadingLineMenu',
          'heading',
        );
      });
      addHeadingAction('Delete heading', 'trash-2', () => {
        void requestLineItemDelete({
          app: this.app,
          file,
          lineIndex,
          rawLine,
          itemLabel: 'heading',
          source: 'tps-list-heading-menu',
          blockKind: 'heading-section',
          onDeleted: ({ mode, nestedContentLineCount }) => {
            emitFilesUpdated(this.app, [file.path], 'tps-list');
            plugin?.overlayRenderingService?.invalidate?.({
              reason: 'tps-list-heading-delete',
              file,
              surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
              refreshLivePreviewEditors: true,
              delayMs: 80,
            });
            flow('HeadingLineMenu', 'delete:done', {
              path: file.path,
              line: resolvedOneBasedLine,
              mode,
              nestedContentLineCount,
            });
          },
        });
      }, true);

      const menuController = plugin?.menuController || this.getGcmApi()?.menuController;
      menuController?.addToNativeMenu?.(menu, [file], {
        includeTitle: false,
        excludeCustomPropertyKeys: getConfiguredLineContextPropertyKeys(plugin),
      });
      this.app.workspace.trigger('file-menu', menu as any, file as any);
      menu.showAtPosition({ x: event.clientX, y: event.clientY });
      flow('HeadingLineMenu', 'open', {
        path: file.path,
        line: resolvedOneBasedLine,
      });
    } catch (error) {
      flowError('HeadingLineMenu', 'open:failed', error, { path: file.path, line: oneBasedLine });
      new Notice('Could not open the heading menu.');
    }
  }

  private async openBulletLineContextMenu(
    event: MouseEvent,
    file: TFile,
    oneBasedLine: number,
    expectedRawLine: string,
  ): Promise<void> {
    try {
      const revision = await this.resolveRenderedLineRevision(
        file,
        oneBasedLine,
        expectedRawLine,
        'BulletLineMenu',
        'line item',
      );
      if (!revision) return;
      const { lineIndex, rawLine } = revision;
      const resolvedOneBasedLine = lineIndex + 1;
      const plugin = this.getGcmPlugin();
      const api = this.getGcmApi();
      const linkService = this.getGcmServices()?.links;
      const sourceDecision = resolveBulletLineSourceTarget(rawLine, file.path, {
        resolveToPath: (target, sourcePath) => linkService?.resolveToPath?.(target, sourcePath) ?? null,
        extractTargets: (text) => linkService?.extractTargetsFromText?.(text, false) ?? [],
      });
      const resolvedSource = sourceDecision.resolution
        ? this.app.vault.getAbstractFileByPath(sourceDecision.resolution.path)
        : null;
      const sourceNote = resolvedSource instanceof TFile ? resolvedSource : null;
      const menuTarget = sourceNote ?? file;
      const lineService = plugin?.dailyInboxLineService || api?.dailyInboxLineService;
      const context = { file, lineIndex, rawLine };
      const menu = new Menu();
      const addLineAction = (
        title: string,
        icon: string,
        onClick: () => void,
        warning = false,
        section = 'tps-line',
      ): void => {
        menu.addItem((item) => {
          item.setTitle(title)
            .setIcon(icon)
            .setSection(section)
            .onClick(onClick);
          if (warning) (item as any).setWarning?.(true);
          (item as any)._isTpsItem = true;
        });
      };

      addLineAction(`Title: ${getPlainDisplayTitle(visibleLineText(rawLine)) || '(empty)'}`, 'pencil', () => {
        this.promptRenderedLineTitle('bullet', file, lineIndex, rawLine);
      }, false, 'tps-title');
      this.addBulletLineTagsMenu(menu, file, lineIndex, rawLine);
      if (plugin) {
        addLineEntityPropertyMenus({
          app: this.app,
          plugin,
          menu,
          file,
          rawLine,
          mutateLine: (updater, property, action) => this.updateRenderedLineEntityProperty(
            'bullet',
            file,
            lineIndex,
            rawLine,
            property,
            action,
            updater,
          ),
        });
      }
      addLineAction('Edit full line...', 'text-cursor-input', () => {
        this.openBulletLineEditor(event, file, resolvedOneBasedLine, rawLine);
      });
      if (sourceNote && sourceNote.path !== file.path) {
        addLineAction('Open source note', 'external-link', () => {
          void this.openOrFocusFile(sourceNote).catch((error) => {
            flowError('BulletLineMenu', 'open-source:failed', error, {
              path: file.path,
              line: resolvedOneBasedLine,
              sourceNotePath: sourceNote.path,
            });
            new Notice('Could not open the source note.');
          });
        });
      }
      addLineAction('Open line in note', 'file-text', () => {
        void this.openRenderedLineInNote(
          file,
          resolvedOneBasedLine,
          rawLine,
          undefined,
          'BulletLineMenu',
          'line item',
        );
      });
      addLineAction('Delete line item', 'trash-2', () => {
        void requestLineItemDelete({
          app: this.app,
          file,
          lineIndex,
          rawLine,
          itemLabel: 'line item',
          source: 'tps-list-bullet-menu',
          onDeleted: ({ mode, nestedContentLineCount }) => {
            emitFilesUpdated(this.app, [file.path], 'tps-list');
            plugin?.overlayRenderingService?.invalidate?.({
              reason: 'tps-list-bullet-delete',
              file,
              surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
              rebuildInlineSubitems: true,
              refreshLivePreviewEditors: true,
              delayMs: 80,
            });
            flow('BulletLineMenu', 'delete:done', {
              path: file.path,
              line: resolvedOneBasedLine,
              mode,
              nestedContentLineCount,
            });
          },
        });
      }, true);
      if (!sourceNote && typeof lineService?.createNoteForLine === 'function') {
        addLineAction('Create note for bullet', 'file-plus-2', () => {
          try {
            void Promise.resolve(lineService.createNoteForLine(context)).catch((error) => {
              flowError('BulletLineMenu', 'create-note:failed', error, { path: file.path, line: resolvedOneBasedLine });
              new Notice('Could not create a note for this line.');
            });
          } catch (error) {
            flowError('BulletLineMenu', 'create-note:failed', error, { path: file.path, line: resolvedOneBasedLine });
            new Notice('Could not create a note for this line.');
          }
        });
      }

      plugin?.contextTargetService?.clearRecentContextTarget?.();
      const menuController = plugin?.menuController || api?.menuController;
      if (typeof menuController?.addToNativeMenu === 'function') {
        const targetLabel = sourceNote ? 'source note' : 'containing note';
        menuController.addToNativeMenu(menu, [menuTarget], {
          deleteLabel: `Delete ${targetLabel}`,
          includeTitle: false,
          excludeCustomPropertyKeys: getConfiguredLineContextPropertyKeys(plugin),
        });
      }
      this.app.workspace.trigger('file-menu', menu as any, menuTarget as any);
      menu.showAtPosition({ x: event.clientX, y: event.clientY });
      flow('BulletLineMenu', 'open', {
        path: file.path,
        line: resolvedOneBasedLine,
        menuTargetPath: menuTarget.path,
        sourceNotePath: sourceNote?.path || null,
        sourceRoute: sourceDecision.resolution?.route || 'source-fallback',
        sourceKey: sourceDecision.resolution?.sourceKey || null,
        ambiguousVisibleTargets: sourceDecision.ambiguousVisibleTargets,
        hasOpenSourceAction: !!sourceNote && sourceNote.path !== file.path,
      });
    } catch (error) {
      flowError('BulletLineMenu', 'open:failed', error, { path: file.path, line: oneBasedLine });
      new Notice('Could not open the line menu.');
    }
  }

  private openBaseNotePreview(event: MouseEvent, file: TFile, anchorEl: HTMLElement): boolean {
    if (typeof this.plugin?.openBaseNotePreviewFromClick === 'function') {
      return this.plugin.openBaseNotePreviewFromClick(event, file, anchorEl) === true;
    }
    const plugin = this.getGcmPlugin();
    const openPreview = plugin?.openBaseNotePreviewFromClick || this.getGcmApi()?.openBaseNotePreviewFromClick;
    if (typeof openPreview !== 'function') return false;
    return openPreview.call(plugin, event, file, anchorEl) === true;
  }

  private getGcmSettings(): any {
    const plugin = this.getGcmPlugin();
    return plugin?.settings || this.getGcmApi()?.settings || null;
  }

  private getGcmCheckboxMappings(): Array<{ checkboxState: string; statuses: string[]; toggleTargetStatus?: string; icon?: string; label?: string }> {
    const configured = this.getGcmSettings()?.linkedSubitemCheckboxMappings;
    return normalizeLinkedSubitemMappings(configured, {
      enforceStrictDefaults: false,
      normalizeStatus: (value) => this.normalizeTaskStatus(value),
    });
  }

  private normalizeCheckboxState(rawState: string): string {
    return normalizeKanbanCheckboxState(rawState);
  }

  private getStatusForCheckboxState(rawState: string): string {
    return this.normalizeTaskStatus(getKanbanStatusForCheckboxState(rawState, this.getGcmCheckboxMappings()));
  }

  private resolveMappedTaskCheckbox(task: OpenTaskSubitem): { checkboxState: string; status: string } | null {
    if (task.itemKind === 'bullet' || task.itemKind === 'heading') return null;
    const checkboxState = this.normalizeCheckboxState(task.checkboxState || '');
    if (!checkboxState) return null;
    const status = this.getStatusForCheckboxState(checkboxState);
    return status ? { checkboxState, status } : null;
  }

  private getMappedCheckboxStateForTask(task: OpenTaskSubitem): string {
    return this.resolveMappedTaskCheckbox(task)?.checkboxState || '';
  }

  private getMappedStatusForTask(task: OpenTaskSubitem): string {
    return this.resolveMappedTaskCheckbox(task)?.status || '';
  }

  private normalizeTaskStatus(rawStatus: unknown): string {
    const normalized = this.getGcmServices()?.status?.normalize?.(rawStatus);
    return String(normalized || rawStatus || '').trim().toLowerCase();
  }

  private getLaneIdForStatus(status: string | null): string {
    const normalized = String(status ?? '').trim().toLowerCase();
    return normalized ? `key:${normalized}` : 'ungrouped';
  }

  private getCheckboxStateForStatus(rawStatus: string | null): string | null {
    return getKanbanCheckboxStateForStatus(
      this.normalizeTaskStatus(rawStatus),
      this.getGcmCheckboxMappings(),
    );
  }

  private getToggleCheckboxStateForTask(task: OpenTaskSubitem): string | null {
    const currentState = this.getMappedCheckboxStateForTask(task);
    return currentState
      ? getKanbanToggleCheckboxState(currentState, this.getGcmCheckboxMappings())
      : null;
  }

  private requestTaskCheckboxToggle(file: TFile, task: OpenTaskSubitem, checkboxEl: HTMLInputElement): void {
    const currentState = this.getMappedCheckboxStateForTask(task);
    const currentStatus = currentState ? this.getStatusForCheckboxState(currentState) : '';
    const nextState = this.getToggleCheckboxStateForTask(task);
    const expectedRawLine = String(task.rawLine || '');
    if (!currentState || !currentStatus || !nextState || !expectedRawLine) {
      checkboxEl.checked = this.classifyDoneStatus(currentStatus) === true;
      flowWarn('TaskCheckbox', 'toggle:blocked', {
        path: file.path,
        line: task.line,
        checkboxState: currentState,
        reason: expectedRawLine ? 'unmapped-toggle-target' : 'missing-source-revision',
      });
      new Notice('Could not toggle this task because GCM has no valid target mapping.');
      return;
    }
    void this.updateTaskCheckboxState(file, task.line, nextState, currentState, expectedRawLine);
  }

  private getBaseSourcePath(): string | null {
    const directFile = this.getRuntimeBaseFile();
    if (directFile) return directFile.path;

    const embeddedMarkdownContext = this.getWorkspaceLeafMarkdownContextPath();
    return this.isEmbeddedKanbanContext() ? embeddedMarkdownContext : null;
  }

  private getBaseFile(): TFile | null {
    const sourcePath = this.getBaseSourcePath();
    if (!sourcePath || !sourcePath.endsWith('.base')) return null;
    const file = this.app.vault.getFileByPath(sourcePath);
    return file instanceof TFile ? file : null;
  }

  private getBaseContextFile(): TFile | null {
    const stampedContextPath = this.getStampedBaseContextPath();
    if (stampedContextPath) {
      const stampedContextFile = this.app.vault.getFileByPath(stampedContextPath);
      if (stampedContextFile instanceof TFile) return stampedContextFile;
    }

    const markdownContextPath = this.getWorkspaceLeafMarkdownContextPath();
    if (markdownContextPath) {
      const markdownContextFile = this.app.vault.getFileByPath(markdownContextPath);
      if (markdownContextFile instanceof TFile) return markdownContextFile;
    }

    const sourcePath = this.getBaseSourcePath();
    if (!sourcePath || sourcePath.endsWith('.base')) return null;
    const file = this.app.vault.getFileByPath(sourcePath);
    return file instanceof TFile ? file : null;
  }

  private getStampedBaseContextPath(): string | null {
    const contextHost = this.containerEl?.closest<HTMLElement>('[data-tps-context-path]');
    return resolveBaseEmbedSourcePath([
      this.containerEl?.dataset.tpsContextPath,
      contextHost?.dataset.tpsContextPath,
    ]);
  }

  private getBaseContextFrontmatterValue(key: string): string | null {
    const domContextValue = this.getDomBaseContextValue(key);
    if (domContextValue) return domContextValue;

    const file = this.getBaseContextFile();
    if (!file) return null;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const actualKey = findPropertyKeyCaseInsensitive(frontmatter, key);
    const value = actualKey ? frontmatter?.[actualKey] : undefined;
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).trim() || null;
  }

  private getDomBaseContextValue(key: string): string | null {
    const normalizedKey = this.normalizeInlinePropertyKey(key);
    if (normalizedKey !== 'scheduled') return null;
    const host = this.containerEl?.closest('[data-tps-context-scheduled], [data-tps-context-date]') as HTMLElement | null;
    const value = host?.dataset?.tpsContextScheduled || host?.dataset?.tpsContextDate || '';
    return String(value || '').trim() || null;
  }

  private resolveBaseContextToken(rawValue: unknown): string | null {
    const value = String(rawValue ?? '').trim().replace(/^["']|["']$/g, '');
    if (!value) return null;
    const contextFile = this.getBaseContextFile();
    const resolveSimpleToken = (token: string): string | null => {
      if (/^this\.file\.path$/i.test(token)) return contextFile?.path ?? null;
      if (/^this\.file\.name$/i.test(token)) return contextFile?.name ?? null;
      if (/^this\.file\.basename$/i.test(token)) return contextFile?.basename ?? null;
      const frontmatterMatch = token.match(/^this\.([A-Za-z][\w -]{0,40})$/i);
      if (frontmatterMatch?.[1]) return this.getBaseContextFrontmatterValue(frontmatterMatch[1]);
      return token;
    };
    const dateValue = resolveTpsBaseDateExpression(value, {
      resolveValue: (token) => resolveSimpleToken(token) ?? '',
    });
    return dateValue || resolveSimpleToken(value);
  }

  private getRuntimeBaseFile(): TFile | null {
    const embeddedBasePath = this.getEmbeddedBasePathFromDom();
    if (embeddedBasePath) {
      const embeddedBaseFile = this.app.vault.getFileByPath(embeddedBasePath);
      if (embeddedBaseFile instanceof TFile) return embeddedBaseFile;
    }

    return getOwningWorkspaceFile(this.app, this.containerEl, 'base');
  }

  private getEmbeddedBasePathFromDom(): string | null {
    const embedEl = this.containerEl?.closest(
      '[data-tps-base-path], .internal-embed[src$=".base"], .internal-embed[data-src$=".base"], .markdown-embed[src$=".base"], .markdown-embed[data-src$=".base"], [data-path$=".base"]',
    ) as HTMLElement | null;
    if (!embedEl) return null;
    const rawPath = embedEl.dataset.tpsBasePath
      || embedEl.getAttribute('src')
      || embedEl.getAttribute('data-src')
      || embedEl.getAttribute('data-path')
      || embedEl.getAttribute('alt')
      || '';
    return this.resolveBasePathFromName(rawPath);
  }

  private getWorkspaceLeafMarkdownContextPath(): string | null {
    const markdownContextEl = this.containerEl?.closest('.markdown-reading-view, .markdown-source-view, .markdown-preview-view, .markdown-embed, .internal-embed, .cm-embed-block, .sync-embed, .sync-container');
    if (!markdownContextEl) return null;
    return getOwningWorkspaceFile(this.app, this.containerEl, 'md')?.path || null;
  }

  private resolveBasePathFromName(rawName: unknown): string | null {
    const name = String(rawName ?? '').trim();
    if (!name) return null;
    const withoutExtension = name.replace(/\.base$/i, '').trim();
    if (!withoutExtension) return null;
    const directPath = name.endsWith('.base') ? name : `${withoutExtension}.base`;
    const directFile = this.app.vault.getFileByPath(directPath);
    if (directFile instanceof TFile && (directFile.extension === 'base' || directFile.path.endsWith('.base'))) return directFile.path;
    const matches = this.app.vault.getFiles()
      .filter((file) => (file.extension === 'base' || file.path.endsWith('.base')) && file.basename === withoutExtension);
    return matches.length === 1 ? matches[0].path : null;
  }

  private getBaseFileFilterRoot(): unknown[] | null {
    const file = this.getBaseFile();
    if (!file) return null;
    const mtime = Number(file.stat?.mtime || 0);
    const viewName = this.getConfiguredBaseViewName();
    if (
      this.baseFileFilterCache?.path === file.path
      && this.baseFileFilterCache.mtime === mtime
      && isPersistedFilterCacheMatch(this.baseFileFilterCache.viewName, viewName, this.baseFileFilterCache.viewNames)
    ) {
      return this.baseFileFilterCache.filters;
    }

    void this.loadBaseFileFilters(file, mtime, viewName);
    return this.baseFileFilterCache?.path === file.path
      && isPersistedFilterCacheMatch(
        this.baseFileFilterCache.viewName,
        viewName,
        this.baseFileFilterCache.viewNames,
      )
      ? this.baseFileFilterCache.filters
      : null;
  }

  private async loadBaseFileFilters(file: TFile, mtime = Number(file.stat?.mtime || 0), viewName = this.getCurrentBaseViewName()): Promise<boolean> {
    const loadingKey = `${file.path}:${mtime}:${viewName}`;
    if (this.baseFileFiltersLoadingKey === loadingKey && this.baseFileFiltersLoadingPromise) {
      return this.baseFileFiltersLoadingPromise;
    }
    this.baseFileFiltersLoadingKey = loadingKey;
    const loadPromise = (async () => {
      try {
        const content = await this.app.vault.cachedRead(file);
        const parsed = parseYaml(content) as Record<string, unknown> | null | undefined;
        const extracted = this.extractBaseFileFilterRoots(parsed, viewName);
        const formulas = extractTpsBaseFormulaDefinitions(parsed);
        if (this.baseFileFiltersLoadingKey !== loadingKey) return;
        const previous = this.baseFileFilterCache;
        this.baseFileFilterCache = {
          path: file.path,
          mtime,
          viewName: extracted.viewName,
          viewNames: extracted.viewNames,
          filters: extracted.filters,
          formulas,
          formulaSet: tpsBaseFormulaService.compile(formulas, `${file.path}:${mtime}`),
        };
        if (previous?.path !== file.path || previous?.mtime !== mtime || previous?.viewName !== extracted.viewName || previous?.filters !== extracted.filters) {
          flow('BaseFilters', 'loaded', {
            path: file.path,
            viewName: extracted.viewName,
            viewCount: extracted.viewNames.length,
            filterRoots: extracted.filters?.length || 0,
            formulas: Object.keys(formulas).length,
          });
          this.refreshDebounced();
        }
        return true;
      } catch (error) {
        flowError('BaseFilters', 'read-failed', error, { path: file.path, viewName });
        if (this.baseFileFiltersLoadingKey === loadingKey) {
          this.baseFileFilterCache = {
            path: file.path,
            mtime,
            viewName,
            viewNames: [],
            filters: null,
            formulas: {},
            formulaSet: tpsBaseFormulaService.compile({}, `${file.path}:${mtime}:read-error`),
          };
        }
        return false;
      }
    })();
    this.baseFileFiltersLoadingPromise = loadPromise;
    try {
      return await loadPromise;
    } finally {
      if (this.baseFileFiltersLoadingPromise === loadPromise) {
        this.baseFileFiltersLoadingPromise = null;
        if (this.baseFileFiltersLoadingKey === loadingKey) this.baseFileFiltersLoadingKey = null;
      }
    }
  }

  private extractBaseFileFilterRoots(
    parsed: Record<string, unknown> | null | undefined,
    fallbackViewName = this.getCurrentBaseViewName(),
  ): { viewName: string; viewNames: string[]; filters: unknown[] | null } {
    return extractPersistedFilterRoots(parsed, fallbackViewName, new Set([TPS_LIST_VIEW_TYPE]));
  }

  private getCurrentBaseViewName(knownViewNames?: Set<string>): string {
    const visible = this.getVisibleBaseViewName(knownViewNames);
    if (visible) return visible;
    return this.getConfiguredBaseViewName();
  }

  private getConfiguredBaseViewName(): string {
    const candidates = [
      this.config?.name,
      this.config?.get?.('name'),
      (this as any)?.view?.name,
      (this as any)?.controller?.viewConfig?.name,
      (this as any)?.controller?.config?.name,
      (this as any)?.queryController?.query?.name,
      (this as any)?.queryController?.view?.name,
    ];
    for (const candidate of candidates) {
      const value = String(candidate || '').trim();
      if (value) return value;
    }
    return '';
  }

  private getVisibleBaseViewName(knownViewNames?: Set<string>): string {
    if (!knownViewNames?.size) return '';
    const root = this.containerEl.ownerDocument.body;
    const visibleText = String(root.innerText || '');
    const visibleKnownNames = Array.from(knownViewNames).filter((name) => visibleText.includes(name));
    if (visibleKnownNames.length === 1) return visibleKnownNames[0];
    const visibleMatches: string[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      if (!el.offsetParent) continue;
      const text = String(el.textContent || '').trim();
      if (!text || text.length > 120) continue;
      if (knownViewNames.has(text)) visibleMatches.push(text);
    }
    if (visibleMatches.length) return visibleMatches[0];
    for (const name of knownViewNames) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
        if (!el.offsetParent) continue;
        const text = String(el.textContent || '').trim();
        if (text.startsWith(name)) return name;
      }
    }
    return '';
  }

  onload(): void {
    this.ensureContainer();
    this.activeNotePath = this.getActiveMarkdownPath();

    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      if (!(file instanceof TFile)) return;
      this.invalidateNoteSemanticReconciliation();
      if (!this.isVisibleFile(file.path)) return;
      this.refreshDebounced();
    }));

    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (!(file instanceof TFile)) return;
      this.invalidateNoteSemanticReconciliation();
      if (file.path === this.getBaseSourcePath()) {
        this.baseFileFilterCache = null;
        this.embeddedBaseFilterCache = null;
        this.refreshDebounced();
        return;
      }
      this.clearTaskCachesForPath(file.path);
      const taskFilter = this.getTaskRootFilterFromBaseFilters();
      if (taskFilter.mode === 'tasks' || taskFilter.mode === 'bullets' || taskFilter.hasTaskDirective) {
        this.refreshDebounced();
        return;
      }
      if (!this.isVisibleFile(file.path)) return;
      this.refreshDebounced();
    }));

    this.registerEvent(this.app.vault.on('create', (file) => {
      if (!(file instanceof TFile)) return;
      this.invalidateNoteSemanticReconciliation();
      this.refreshDebounced();
      this.queuePostCreateRefresh();
    }));

    // Keep synthesized rows stable through file lifecycle changes even when
    // their source note is not one of the native Bases result entries.
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.invalidateNoteSemanticReconciliation();
      if (oldPath) this.clearTaskCachesForPath(oldPath);
      if (file instanceof TFile) this.clearTaskCachesForPath(file.path);
      this.refreshDebounced();
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (!(file instanceof TFile)) return;
      this.invalidateNoteSemanticReconciliation();
      this.clearTaskCachesForPath(file.path);
      const taskFilter = this.getTaskRootFilterFromBaseFilters();
      if (
        this.isVisibleFile(file.path)
        || taskFilter.mode === 'tasks'
        || taskFilter.mode === 'bullets'
        || taskFilter.hasTaskDirective
      ) this.refreshDebounced();
    }));

    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      const nextPath = file instanceof TFile ? file.path : null;
      if (nextPath === this.activeNotePath) return;
      this.activeNotePath = nextPath;
      this.syncSelectionClasses();
    }));

    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      const nextPath = this.getActiveMarkdownPath();
      if (nextPath === this.activeNotePath) return;
      this.activeNotePath = nextPath;
      this.syncSelectionClasses();
    }));
    this.baseFilterSignature = this.getBaseFilterSignature();
    this.baseFilterPollInterval = window.setInterval(() => {
      const nextSignature = this.getBaseFilterSignature();
      if (nextSignature === this.baseFilterSignature) return;
      this.baseFilterSignature = nextSignature;
      this.refreshDebounced();
    }, 400);
    this.register(() => {
      if (this.baseFilterPollInterval) {
        window.clearInterval(this.baseFilterPollInterval);
        this.baseFilterPollInterval = null;
      }
    });
    if (Platform.isMobile) {
      this.setupMobileKeyboardSuppression();

      this.registerDomEvent(this.containerEl, 'focusin', (evt: FocusEvent) => {
        if (!this.isInteractiveInputEventTarget(evt.target)) return;
        this.setMobileKeyboardHidden(true);
      });

      this.registerDomEvent(this.containerEl, 'focusout', () => {
        window.setTimeout(() => {
          const activeElement = document.activeElement;
          const isInside = !!(activeElement && this.containerEl.contains(activeElement));
          if (!isInside) {
            this.setMobileKeyboardHidden(false);
          }
        }, 0);
      });
    }
    this.registerDomEvent(document, TPS_TASK_LINE_POINTER_DROP_EVENT as any, (evt: Event) => {
      void this.handleTaskPointerDropEvent(evt as CustomEvent);
    }, { capture: true });
    this.registerDomEvent(document, 'pointermove', (evt: PointerEvent) => {
      this.handleTaskPointerMove(evt);
    }, { capture: true });
    this.registerDomEvent(document, 'pointerup', (evt: PointerEvent) => {
      void this.handleTaskPointerUp(evt);
    }, { capture: true });
    this.registerDomEvent(document, 'pointercancel', (evt: PointerEvent) => {
      this.cancelTaskPointerDrag(evt);
    }, { capture: true });
    this.registerDomEvent(window, 'blur', () => this.clearActiveTaskPointerDrag());
    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.visibilityState !== 'visible') this.clearActiveTaskPointerDrag();
    });
    this.render();
    window.setTimeout(() => this.render(), 300);
  }

  onunload(): void {
    this.clearActiveTaskPointerDrag();
    this.renderedDisplayLanesById.clear();
    const taskSelectionService = this.getGcmPlugin()?.taskLineContextMenuService || this.getGcmApi()?.taskLineContextMenuService;
    taskSelectionService?.releaseTpsListSelection?.(this.scrollEl);
    this.detachWheelHandler();
    this.detachTouchHandlers();
    this.setMobileKeyboardHidden(false);
    this.setMobileGestureHidden(false);
    if (this.mobileKeyboardTimeout) {
      window.clearTimeout(this.mobileKeyboardTimeout);
      this.mobileKeyboardTimeout = null;
    }
    if (this.mobileGestureRevealTimeout) {
      window.clearTimeout(this.mobileGestureRevealTimeout);
      this.mobileGestureRevealTimeout = null;
    }
    if (this.baseFilterPollInterval) {
      window.clearInterval(this.baseFilterPollInterval);
      this.baseFilterPollInterval = null;
    }
    // Do not clear the root scroll element; Bases controls this container's lifecycle.
    // Clearing it here can leave the view blank when switching away and back.
    this.containerEl?.empty();
    this.scrollEl.removeClass('tps-list-scroll');
    if ((this.scrollEl as any).__tpsListView === this) delete (this.scrollEl as any).__tpsListView;
  }
  onResize(): void {}

  private setMobileUiHiddenClass(className: string, hidden: boolean): void {
    if (!Platform.isMobile) return;
    const body = document.body;
    if (!body) return;
    body.classList.toggle(className, hidden);
  }

  private setMobileKeyboardHidden(hidden: boolean): void {
    if (this.mobileKeyboardSuppressed === hidden) return;
    this.mobileKeyboardSuppressed = hidden;
    this.setMobileUiHiddenClass(MOBILE_UI_KEYBOARD_HIDDEN_CLASS, hidden);
    if (hidden) {
      this.setMobileGestureHidden(false);
      if (this.mobileKeyboardTimeout) {
        window.clearTimeout(this.mobileKeyboardTimeout);
        this.mobileKeyboardTimeout = null;
      }
    }
  }

  private setMobileGestureHidden(hidden: boolean): void {
    if (this.mobileGestureSuppressed === hidden) return;
    this.mobileGestureSuppressed = hidden;
    this.setMobileUiHiddenClass(MOBILE_UI_GESTURE_HIDDEN_CLASS, hidden);
  }

  private isInteractiveInputEventTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest('input, textarea, [contenteditable="true"], [contenteditable]')) {
      return true;
    }
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.contentEditable === 'true';
  }

  private setupMobileKeyboardSuppression(): void {
    const getViewportHeight = () => window.visualViewport?.height || window.innerHeight;
    if (!window.visualViewport) {
      return;
    }

    this.mobileKeyboardResizeBaseHeight = getViewportHeight();

    const evaluateKeyboard = () => {
      const currentHeight = getViewportHeight();
      if (currentHeight > this.mobileKeyboardResizeBaseHeight) {
        this.mobileKeyboardResizeBaseHeight = currentHeight;
      }

      const delta = this.mobileKeyboardResizeBaseHeight - currentHeight;
      const shouldHide = delta > MOBILE_KEYBOARD_COLLAPSE_THRESHOLD_PX;

      this.setMobileKeyboardHidden(shouldHide);
    };

    const viewport = window.visualViewport;
    viewport.addEventListener('resize', evaluateKeyboard);
    viewport.addEventListener('scroll', evaluateKeyboard);
    this.register(() => {
      viewport.removeEventListener('resize', evaluateKeyboard);
      viewport.removeEventListener('scroll', evaluateKeyboard);
    });
  }
  focus(): void { this.scrollEl.focus({ preventScroll: true }); }

  onDataUpdated(): void {
    this.ensureContainer();
    this.render();
    this.syncNativeResultsCountSoon();
  }

  private queuePostCreateRefresh(): void {
    this.refreshDebounced();
    [150, 500, 1200].forEach((delay) => {
      window.setTimeout(() => {
        this.ensureContainer();
        this.render();
        this.syncNativeResultsCountSoon();
      }, delay);
    });
  }

  private ensureContainer(): void {
    if (this.containerEl && this.containerEl.parentElement === this.scrollEl) return;
    this.containerEl = this.scrollEl.createDiv({ cls: 'tps-list-container' });
    this.applyLayoutSettings();
  }

  private shouldRenderView(): boolean {
    if (!this.containerEl?.isConnected) return false;
    if (this.containerEl.isShown()) return true;

    const activeContainer = (this.app.workspace.activeLeaf?.view as any)?.containerEl as HTMLElement | undefined;
    return !!activeContainer?.contains(this.containerEl);
  }

  private syncNativeResultsCountSoon(): void {
    this.syncNativeResultsCount();
    window.setTimeout(() => this.syncNativeResultsCount(), 0);
    window.setTimeout(() => this.syncNativeResultsCount(), 180);
  }

  private syncNativeResultsCount(): void {
    const header = this.getNearestBasesHeader();
    if (!header) return;
    this.syncEmbeddedHeaderChrome(header);
    const resultCount = this.getDisplayedResultCount();
    const text = `${resultCount} result${resultCount === 1 ? '' : 's'}`;
    const countEl =
      header.querySelector<HTMLElement>('.view-header-count') ??
      header.querySelector<HTMLElement>('.bases-view-results-count') ??
      header.querySelector<HTMLElement>('.bases-results-count') ??
      header.querySelector<HTMLElement>('.bases-view-result-count') ??
      header.querySelector<HTMLElement>('.bases-result-count') ??
      header.querySelector<HTMLElement>('[class*="results-count"]') ??
      header.querySelector<HTMLElement>('[class*="result-count"]') ??
      header.querySelector<HTMLElement>('.bases-view-results') ??
      header.querySelector<HTMLElement>('.bases-results') ??
      this.findResultsCountElementByText(header);
    if (countEl && countEl.textContent?.trim() !== text) {
      countEl.textContent = text;
    }
  }

  private findResultsCountElementByText(root: HTMLElement): HTMLElement | null {
    const candidates = Array.from(root.querySelectorAll<HTMLElement>('*'))
      .filter((el) => /^\d+\s+results?$/i.test((el.textContent ?? '').trim()));
    if (!candidates.length) return null;
    return candidates
      .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0] ?? null;
  }

  private getDisplayedResultCount(): number {
    if (this.hasRenderedResultCount) return this.renderedResultCount;
    const taskFilter = this.getTaskRootFilterFromBaseFilters();
    if (taskFilter.mode === 'tasks') return this.renderedTaskItemCount;
    const dataRows = (this.data as any)?.data;
    if (Array.isArray(dataRows)) return dataRows.length + (taskFilter.hasTaskDirective ? this.renderedTaskItemCount : 0);
    const unique = new Set<string>();
    const groups: BasesEntryGroup[] = this.data?.groupedData ?? [];
    for (const group of groups) {
      for (const entry of group.entries) unique.add(entry.file.path);
    }
    return unique.size + (taskFilter.hasTaskDirective ? this.renderedTaskItemCount : 0);
  }

  private getNearestBasesHeader(): HTMLElement | null {
    const selectors = '.bases-view-header, .base-view-header, .bases-toolbar, .bases-header, .view-header';
    const embedRoot = this.containerEl.closest(
      '.tps-auto-base-embed__panel, .block-language-bases, .cm-preview-code-block, .internal-embed, .markdown-embed, .cm-embed-block, .sync-embed, .sync-container',
    ) as HTMLElement | null;
    const searchRoot = embedRoot ?? (this.containerEl.closest('.workspace-leaf') as HTMLElement | null);
    if (!searchRoot) return null;
    const headers = Array.from(searchRoot.querySelectorAll<HTMLElement>(selectors));
    if (!headers.length) return null;
    const preceding = headers.filter((header) => {
      if (header === this.containerEl) return false;
      const relation = header.compareDocumentPosition(this.containerEl);
      return Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    if (preceding.length > 0) return preceding[preceding.length - 1];
    const fallbackHeaders = Array.from(searchRoot.querySelectorAll<HTMLElement>('div, header, section')).filter((el) => {
      if (el === this.containerEl || el.contains(this.containerEl)) return false;
      const relation = el.compareDocumentPosition(this.containerEl);
      if (!Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      return text.length > 0
        && text.length <= 180
        && /\bSort\b/.test(text)
        && /\bFilter\b/.test(text)
        && /\bProperties\b/.test(text);
    });
    if (fallbackHeaders.length > 0) return fallbackHeaders[fallbackHeaders.length - 1];
    return headers[headers.length - 1];
  }

  private getContainingWorkspaceLeaf(): WorkspaceLeaf | null {
    const leafEl = this.containerEl?.closest('.workspace-leaf') as HTMLElement | null;
    if (!leafEl) return null;
    let found: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (found) return;
      const leafContainer = (leaf as any).containerEl as HTMLElement | undefined;
      if (!leafContainer) return;
      if (leafContainer === leafEl || leafContainer.contains(leafEl) || leafEl.contains(leafContainer)) {
        found = leaf;
      }
    });
    return found;
  }

  private isEmbeddedKanbanContext(): boolean {
    if (this.containerEl.closest(
      '.tps-auto-base-embed__panel, .block-language-bases, .cm-preview-code-block, .internal-embed, .markdown-embed, .cm-embed-block, .sync-embed, .sync-container',
    )) {
      return true;
    }

    const leaf = this.getContainingWorkspaceLeaf();
    const viewType = typeof leaf?.view?.getViewType === 'function' ? leaf.view.getViewType() : null;
    return viewType === 'markdown';
  }

  private isReadingEmbeddedKanbanContext(): boolean {
    if (!this.isEmbeddedKanbanContext()) return false;
    if (this.containerEl.closest('.markdown-source-view, .cm-editor, .cm-content, .cm-preview-code-block')) return false;
    if (this.containerEl.closest('.markdown-reading-view, .markdown-rendered')) return true;
    const leaf = this.getContainingWorkspaceLeaf();
    const state = typeof (leaf as any)?.getViewState === 'function' ? (leaf as any).getViewState() : null;
    const viewState = (leaf?.view as any)?.getState?.();
    const mode = state?.state?.mode
      ?? state?.mode
      ?? viewState?.mode
      ?? (leaf?.view as any)?.getMode?.()
      ?? (leaf?.view as any)?.mode
      ?? (leaf?.view as any)?.currentMode?.type;
    if (typeof mode === 'string') return mode === 'preview' || mode === 'reading';
    return false;
  }

  private syncEmbeddedHeaderChrome(header: HTMLElement): void {
    header.classList.toggle('tps-kanban-embedded-hidden-header', this.isReadingEmbeddedKanbanContext());
  }

  applyLayoutSettings(): void {
    this.type = TPS_LIST_VIEW_TYPE;
    this.scrollEl.addClass('tps-list-scroll');
    this.containerEl.addClass('tps-list-container');
    this.containerEl.dataset.tpsListOwner = 'gcm';
  }

  private detachWheelHandler(): void {
    if (!this.wheelHandlerTarget || !this.onWheelBound) return;
    this.wheelHandlerTarget.removeEventListener('wheel', this.onWheelBound);
    this.wheelHandlerTarget = null;
    this.onWheelBound = null;
  }

  private detachTouchHandlers(): void {
    if (!this.touchHandlerTarget) return;
    if (this.onTouchStartBound) {
      this.touchHandlerTarget.removeEventListener('touchstart', this.onTouchStartBound);
    }
    if (this.onTouchMoveBound) {
      this.touchHandlerTarget.removeEventListener('touchmove', this.onTouchMoveBound);
    }
    if (this.onTouchEndBound) {
      this.touchHandlerTarget.removeEventListener('touchend', this.onTouchEndBound);
      this.touchHandlerTarget.removeEventListener('touchcancel', this.onTouchEndBound);
    }
    this.touchHandlerTarget = null;
    this.onTouchStartBound = null;
    this.onTouchMoveBound = null;
    this.onTouchEndBound = null;
  }

  private captureRenderScrollState(): TpsListRenderScrollState {
    const laneCards: Record<string, number> = {};
    if (this.containerEl) {
      this.containerEl.querySelectorAll<HTMLElement>('.tps-kanban-lane[data-display-lane-id] .tps-kanban-cards').forEach((cardsEl) => {
        const laneEl = cardsEl.closest<HTMLElement>('.tps-kanban-lane[data-display-lane-id]');
        const laneId = laneEl?.dataset.displayLaneId || '';
        if (laneId) laneCards[laneId] = cardsEl.scrollTop;
      });
    }
    return {
      top: this.containerEl?.scrollTop || 0,
      left: this.containerEl?.scrollLeft || 0,
      laneCards,
    };
  }

  private restoreRenderScrollState(state: TpsListRenderScrollState | null): void {
    if (!state || !this.containerEl) return;
    const restore = () => {
      if (!this.containerEl) return;
      this.containerEl.scrollTop = state.top;
      this.containerEl.scrollLeft = state.left;
      this.containerEl.querySelectorAll<HTMLElement>('.tps-kanban-lane[data-display-lane-id] .tps-kanban-cards').forEach((cardsEl) => {
        const laneEl = cardsEl.closest<HTMLElement>('.tps-kanban-lane[data-display-lane-id]');
        const laneId = laneEl?.dataset.displayLaneId || '';
        if (!laneId || state.laneCards[laneId] == null) return;
        cardsEl.scrollTop = state.laneCards[laneId];
      });
    };
    restore();
    window.requestAnimationFrame(restore);
  }

  private isVisibleFile(path: string): boolean {
    const groups: BasesEntryGroup[] = this.data?.groupedData ?? [];
    for (const group of groups) {
      for (const entry of group.entries) {
        if (entry.file.path === path) return true;
      }
    }
    return false;
  }

  private getAllTasksForFile(file: TFile): OpenTaskSubitem[] {
    const cached = this.allTasksByPath.get(file.path);
    if (cached) return cached;
    this.loadOpenTasksForFile(file);
    return [];
  }

  private clearTaskCachesForPath(path: string): void {
    this.taskCacheEpochByPath.set(path, (this.taskCacheEpochByPath.get(path) ?? 0) + 1);
    this.openTasksByPath.delete(path);
    this.allTasksByPath.delete(path);
    this.allTasksByPath.delete(`${path}:bullets`);
    this.allTasksByPath.delete(`${path}:headings`);
    this.allTasksByPath.delete(`${path}:bullets+headings`);
    this.openTaskOverflowByPath.delete(path);
  }

  private loadOpenTasksForFile(file: TFile): void {
    const sourcePath = file.path;
    if (this.openTasksLoading.has(sourcePath)) return;
    const generation = this.renderGeneration;
    const cacheEpoch = this.taskCacheEpochByPath.get(sourcePath) ?? 0;
    this.openTasksLoading.add(sourcePath);
    void this.app.vault.cachedRead(file)
      .then((content) => {
        if ((this.taskCacheEpochByPath.get(sourcePath) ?? 0) !== cacheEpoch) return;
        const liveFile = typeof this.app.vault.getFileByPath === 'function'
          ? this.app.vault.getFileByPath(sourcePath)
          : file;
        if (liveFile !== file || file.path !== sourcePath) return;
        const taskFilter = this.getTaskRootFilterFromBaseFilters();
        if (generation !== this.renderGeneration && !this.isVisibleFile(sourcePath) && !this.isTaskSourceFile(file, taskFilter)) return;
        const limit = this.getOpenTaskPreviewLimit();
        const documentLines = scanMarkdownDocumentLines(content);
        const allTasks = this.parseOpenTasks(
          content,
          file.path,
          Number.MAX_SAFE_INTEGER,
          true,
          false,
          false,
          documentLines,
        ).openTasks;
        const enrichedAllTasks = allTasks.map((task: OpenTaskSubitem) => {
          const normalized = { ...task };
          return { ...normalized, displayText: this.getTaskVisibleTitle(normalized) };
        });
        const openCandidates = enrichedAllTasks.filter((task) => {
          const status = this.getMappedStatusForTask(task);
          return !!status && this.classifyDoneStatus(status) === false;
        });
        const normalizedLimit = Number.isFinite(Number(limit))
          ? Math.max(0, Math.floor(Number(limit)))
          : openCandidates.length;
        const openTasks = openCandidates.slice(0, normalizedLimit);
        const overflowCount = Math.max(0, openCandidates.length - openTasks.length);
        this.openTasksByPath.set(sourcePath, openTasks);
        this.allTasksByPath.set(sourcePath, enrichedAllTasks);
        this.openTaskOverflowByPath.set(sourcePath, overflowCount);
      })
      .catch(() => {
        if ((this.taskCacheEpochByPath.get(sourcePath) ?? 0) !== cacheEpoch) return;
        this.openTasksByPath.set(sourcePath, []);
        this.allTasksByPath.set(sourcePath, []);
        this.openTaskOverflowByPath.set(sourcePath, 0);
      })
      .finally(() => {
        this.openTasksLoading.delete(sourcePath);
        // Vault-wide task views can read hundreds of source files at once.
        // Repaint once when the batch settles instead of once per file.
        if (this.openTasksLoading.size === 0) this.refreshDebounced();
      });
  }

  private parseOpenTasks(
    content: string,
    filePath = '',
    limit = this.getOpenTaskPreviewLimit(),
    includeDone = false,
    includeBullets = false,
    includeHeadings = false,
    documentLines: readonly MarkdownDocumentLine[] = scanMarkdownDocumentLines(content),
  ): { openTasks: OpenTaskSubitem[]; overflowCount: number } {
    const tasks: OpenTaskSubitem[] = [];
    const hierarchyStack: Array<{ line: number; indent: number }> = [];
    documentLines.forEach((documentLine) => {
      if (!documentLine.isContent) {
        if (documentLine.text.trim() && getMarkdownIndentColumns(documentLine.text) === 0) {
          hierarchyStack.length = 0;
        }
        return;
      }
      const { text: line, lineNumber } = documentLine;
      const structuralItem = this.parseLineItem(line, true);
      const indent = getMarkdownIndentColumns(line);
      let parentLine: number | undefined;
      if (structuralItem) {
        while (hierarchyStack.length && hierarchyStack[hierarchyStack.length - 1].indent >= indent) hierarchyStack.pop();
        parentLine = hierarchyStack[hierarchyStack.length - 1]?.line;
        hierarchyStack.push({ line: lineNumber, indent });
      } else if (line.trim() && indent === 0) {
        hierarchyStack.length = 0;
      }
      const parsed = includeHeadings ? parseTpsListHeadingLine(line) ?? this.parseLineItem(line, includeBullets) : this.parseLineItem(line, includeBullets);
      if (!parsed) return;
      const checkboxState = parsed.itemKind === 'heading' ? undefined : parsed.checkboxState;
      const mappedStatus = parsed.itemKind === 'task'
        ? this.getMappedStatusForTask({ itemKind: 'task', line: lineNumber, checkboxState, text: parsed.text })
        : '';
      if (parsed.itemKind === 'task' && !includeDone && this.classifyDoneStatus(mappedStatus) !== false) return;
      const inlineFields = this.extractTaskInlineFields(parsed.text);
      const text = this.cleanTaskText(parsed.text);
      if (!text) return;
      tasks.push({
        itemKind: parsed.itemKind,
        ...(parsed.itemKind === 'heading' ? { headingLevel: parsed.headingLevel } : {}),
        internalId: `${filePath}:${lineNumber}`,
        line: lineNumber,
        indent,
        parentLine,
        checkboxState,
        text,
        rawLine: line,
        displayText: this.cleanTaskDisplayText(this.stripTaskInlineFields(text)),
        inlineFields,
      });
    });
    const finiteLimit = Number.isFinite(Number(limit)) ? Number(limit) : tasks.length;
    const normalizedLimit = Math.max(0, Math.min(tasks.length, Math.floor(finiteLimit || 0)));
    const openTasks = tasks.slice(0, normalizedLimit);
    return { openTasks, overflowCount: Math.max(0, tasks.length - openTasks.length) };
  }

  private parseLineItem(line: string, includeBullets = true): { itemKind: 'task' | 'bullet'; checkboxState?: string; text: string } | null {
    return parseKanbanLineItem(line, includeBullets);
  }

  private cleanTaskText(text: string): string {
    return this.stripTaskHiddenMetadata(text)
      .replace(/\s+\^[A-Za-z0-9-]+$/u, '')
      .replace(/<!--.*?-->/gu, '')
      .trim();
  }

  private cleanTaskDisplayText(text: string): string {
    return this.cleanTaskText(text)
      .replace(/(^|\s)#[\p{L}\p{N}/_-]+/gu, ' ')
      .replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu, '$1')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/gu, '$2')
      .replace(/\[\[([^\]]+)\]\]/gu, '$1')
      .replace(/!\[([^\]]*)\]\([^)]+\)/gu, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
      .replace(/`([^`]+)`/gu, '$1')
      .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/gu, '$1')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private stripTaskHiddenMetadata(text: string): string {
    return String(text || '')
      .replace(/<span\b[^>]*data-tps-inline-props="[^"]*"[^>]*>\s*<\/span>/giu, ' ')
      .replace(/<!--\s*tps-inline-props:[\s\S]*?-->/giu, ' ')
      .replace(/\s*%%\s*tps-inline-props:[\s\S]*?%%/giu, ' ')
      .replace(/\[\^\s*tps-inline:[^\]]+\](?::\s*\S+)?/giu, ' ');
  }

  private getTaskVisibleTitle(task: Pick<OpenTaskSubitem, 'displayText' | 'text'>): string {
    const display = this.cleanTaskDisplayText(this.stripTaskInlineFields(task.displayText || ''));
    if (display) return display;
    const text = this.cleanTaskDisplayText(this.stripTaskInlineFields(task.text || ''));
    return text || 'Untitled task';
  }

  private extractTaskInlineFields(text: string): Array<{ key: string; value: string }> {
    return collectTpsListInlineFields(text);
  }

  private stripTaskInlineFields(text: string): string {
    const source = String(text || '');
    const ranges = this.getTaskInlineFieldRanges(source);
    if (!ranges.length) return source.replace(/\s+/gu, ' ').trim();
    let output = '';
    let cursor = 0;
    for (const range of ranges) {
      output += source.slice(cursor, range.start);
      cursor = range.end;
    }
    output += source.slice(cursor);
    return output
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private getTaskInlineFieldRanges(text: string): Array<{ start: number; end: number; key: string; value: string }> {
    return readInlineFieldRanges(String(text || '')).map((field) => ({
      start: field.start,
      end: field.end,
      key: field.key,
      value: field.value,
    }));
  }

  private getOpenTaskPreviewLimit(): number {
    const value = Number(this.plugin.settings?.openTaskPreviewLimit ?? 5);
    return Number.isFinite(value) ? Math.max(0, Math.min(20, Math.floor(value))) : 5;
  }

  /**
   * Returns the grouping property used by synthesized TPS List rows.
   * Plain and `note.*` properties keep their legacy writable inline-field
   * behavior; source-note properties retain their full read-only property ID.
   */
  private getGroupByPropName(): string | null {
    // Primary: read from the internal config (works when Bases exposes groupBy)
    const raw = resolveTpsBaseGroupDescriptor(this.getConfigValue('groupBy'))?.property;
    if (raw) {
      if (raw.toLowerCase() === 'file.tags') return 'tags';
      if (isSourceNoteGroupProperty(raw)) return raw;
      const dot = raw.indexOf('.');
      if (dot === -1) return raw;                    // plain "status"
      const prefix = raw.slice(0, dot);
      if (prefix === 'note') return raw.slice(dot + 1); // "note.status" → "status"
      if (prefix === 'formula') return raw;
      if (['task', 'line', 'heading', 'tps', 'kanban'].includes(prefix)) return raw;
      return null; // other file namespaces are not line-level group values
    }

    // Fallback: find which allProperty's value matches .key for the first real group
    const groups = this.data?.groupedData ?? [];
    const allProps: string[] = Array.isArray((this as any).allProperties)
      ? (this as any).allProperties
      : [];
    for (const g of groups) {
      if (!g.hasKey() || g.key == null || g.entries.length === 0) continue;
      const keyStr = g.key.toString();
      const entry = g.entries[0];
      for (const propId of allProps) {
        if (typeof propId !== 'string' || propId.length === 0) continue;
        const val = entry.getValue(propId as any);
        if (val != null && val.toString() === keyStr) {
          const dot = propId.indexOf('.');
          const prefix = dot !== -1 ? propId.slice(0, dot) : '';
          if (propId.toLowerCase() === 'file.tags') return 'tags';
          if (isSourceNoteGroupProperty(propId)) return propId;
          if (prefix === 'formula') return propId;
          if (prefix === 'file') return null;
          return dot !== -1 ? propId.slice(dot + 1) : propId;
        }
      }
      break;
    }
    return null;
  }

  private getGroupByPropId(propName: string | null): string | null {
    if (!propName) return null;

    const raw = resolveTpsBaseGroupDescriptor(this.getConfigValue('groupBy'))?.property;
    if (raw) {
      if (raw.includes('.')) return raw;
      return `note.${raw}`;
    }

    const allProps: string[] = Array.isArray((this as any).allProperties)
      ? (this as any).allProperties
      : [];
    const lower = propName.toLowerCase();
    const exact = allProps.find((p) => p.toLowerCase() === lower || p.toLowerCase() === `note.${lower}`);
    if (exact) return exact;

    const suffix = allProps.find((p) => p.toLowerCase().endsWith(`.${lower}`));
    return suffix || null;
  }

  private getFrontmatterPropNameFromId(propId: unknown): string | null {
    return getKanbanFrontmatterPropNameFromId(propId);
  }

  private isLikelyListGroupingProperty(propName: string | null, propId: string | null): boolean {
    const name = String(propName || '').trim().toLowerCase();
    const id = String(propId || '').trim().toLowerCase();
    if (!propId || !id) return false;
    const normalized = this.normalizeTaskPropertyId(propId);
    if (normalized === 'kind' || normalized === 'explicitkind' || normalized === 'entitykind') return true;
    if (name === 'tags' || id.endsWith('.tags') || id === 'tags') return true;
    if (this.getConfiguredCustomProperty(propId)?.type === 'list') return true;

    const entries: BasesEntry[] = this.data?.data ?? [];
    const semantics = this.getOrderingSemantics(propId);
    for (const entry of entries) {
      const values = getTpsBaseGroupValues(entry.getValue(propId as any), semantics, 'separate');
      if (values.length > 1) return true;
    }
    return false;
  }

  private buildMultiValueGroups(propId: string): BasesEntryGroup[] {
    const entries: BasesEntry[] = this.data?.data ?? [];
    return this.groupEntriesByProperty(entries, propId);
  }

  private getSourceGroupsForRender(propId: string | null, listGrouping: boolean): BasesEntryGroup[] {
    const rawNativeGroups: BasesEntryGroup[] = (listGrouping && propId)
      ? this.buildMultiValueGroups(propId)
      : (this.data?.groupedData ?? []);
    const nativeGroups = rawNativeGroups.filter((group) => Array.isArray(group?.entries));

    const groupedEntries = nativeGroups.flatMap((group) => group.entries ?? []);
    const nativeEntries: BasesEntry[] = groupedEntries.length ? groupedEntries : (this.data?.data ?? []);
    const reconciledEntries = this.reconcileNativeNoteEntries(nativeEntries);
    if (reconciledEntries !== nativeEntries) {
      if (propId && (isSourceNoteGroupProperty(propId) || this.getConfiguredCustomProperty(propId)?.type === 'folder')) {
        return this.groupEntriesBySourceNote(reconciledEntries, propId);
      }
      return propId
        ? this.groupEntriesByProperty(reconciledEntries, propId)
        : [{ key: null, entries: reconciledEntries, hasKey: () => false } as unknown as BasesEntryGroup];
    }
    if (propId && (isSourceNoteGroupProperty(propId) || this.getConfiguredCustomProperty(propId)?.type === 'folder')) {
      return nativeEntries.length
        ? this.groupEntriesBySourceNote(nativeEntries, propId)
        : nativeGroups;
    }
    // Obsidian Bases is the sole authority for note inclusion, native formula
    // evaluation, filtering, grouping, sorting, and search. TPS augments that
    // result with synthesized line rows later; it never recreates note rows
    // that Bases intentionally excluded.
    return nativeGroups;
  }

  /**
   * Obsidian Bases normally owns note inclusion. Two TPS field contracts are
   * intentionally different from native frontmatter lookup, though: bare
   * `kind` includes the structural `note` kind as well as authored kinds, and
   * configured Folder properties always reflect the file's current parent.
   *
   * When either contract participates in the effective filter tree, recover
   * only missing notes whose *complete* filter tree can be evaluated true by
   * the shared strict evaluator. Unsupported syntax and unavailable indexes
   * fail closed, and active native search remains solely owned by Bases.
   */
  private reconcileNativeNoteEntries(nativeEntries: BasesEntry[]): BasesEntry[] {
    if (!this.isBaseFileFilterReady()) {
      this.scheduleBaseFileFilterLoad();
      return nativeEntries;
    }
    if (this.getActiveBasesSearchQuery()) return nativeEntries;
    const roots = this.getBaseFilterRoots();
    if (!roots.length || !roots.some((root) => this.filterTreeUsesNoteSemanticOverride(root))) return nativeEntries;
    if (roots.some((root) => this.filterTreeUsesUnsupportedNoteContextReference(root))) return nativeEntries;

    const reconciliationKey = this.getNoteSemanticReconciliationKey(nativeEntries, roots);
    if (this.noteSemanticReconciliationCache?.key === reconciliationKey) {
      return this.noteSemanticReconciliationCache.entries;
    }

    const entriesByPath = new Map<string, BasesEntry>();
    for (const entry of nativeEntries) {
      if (entry?.file?.path && !entriesByPath.has(entry.file.path)) entriesByPath.set(entry.file.path, entry);
    }
    let recovered = 0;
    let removed = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const nativeEntry = entriesByPath.get(file.path);
      const frontmatter = this.getNoteFilterFrontmatter(file);
      const context = this.createNoteFilterContext(file, frontmatter);
      const matches = evaluateLogBaseFilterRoots(roots, context);
      if (nativeEntry) {
        // A conclusive semantic mismatch must remove a native false-positive
        // (for example, stale Folder frontmatter after a move). If evaluation
        // is unavailable, preserve Bases' native result instead.
        if (matches === false && !context.filterFailed && !context.formulaFailed) {
          entriesByPath.delete(file.path);
          removed += 1;
        }
        continue;
      }
      if (matches !== true) continue;
      entriesByPath.set(file.path, this.createSyntheticNoteEntry(file, frontmatter));
      recovered += 1;
    }
    if (!recovered && !removed) {
      this.noteSemanticReconciliationCache = { key: reconciliationKey, entries: nativeEntries };
      return nativeEntries;
    }
    flow('TpsListView', 'note-filter-semantics:reconciled', {
      base: this.getBaseSourcePath(),
      nativeRows: nativeEntries.length,
      recoveredRows: recovered,
      removedRows: removed,
    });
    const reconciledEntries = Array.from(entriesByPath.values());
    this.noteSemanticReconciliationCache = { key: reconciliationKey, entries: reconciledEntries };
    return reconciledEntries;
  }

  private getNoteSemanticReconciliationKey(nativeEntries: BasesEntry[], roots: unknown[]): string {
    const nativePaths = nativeEntries
      .map((entry) => String(entry?.file?.path || ''))
      .filter(Boolean)
      .join('\u001f');
    const folderProperties = (this.getGcmSettings()?.properties || [])
      .filter((property: CustomProperty) => property?.type === 'folder')
      .map((property: CustomProperty) => [property.id, property.key])
      .sort((left: unknown[], right: unknown[]) => String(left[0] || left[1] || '').localeCompare(String(right[0] || right[1] || '')));
    return [
      String(this.noteSemanticReconciliationRevision || 0),
      this.stableFilterSignature(roots),
      this.stableFilterSignature(folderProperties),
      nativePaths,
    ].join('\u001e');
  }

  private invalidateNoteSemanticReconciliation(): void {
    this.noteSemanticReconciliationRevision = (this.noteSemanticReconciliationRevision || 0) + 1;
    this.noteSemanticReconciliationCache = null;
  }

  private filterTreeUsesNoteSemanticOverride(node: unknown): boolean {
    if (!node) return false;
    if (Array.isArray(node)) return node.some((child) => this.filterTreeUsesNoteSemanticOverride(child));
    if (typeof node === 'string') {
      const property = this.readDirectFilterProperty(node);
      return property ? this.isNoteSemanticOverrideProperty(property) : false;
    }
    if (typeof node !== 'object') return false;
    const record = node as Record<string, unknown>;
    const property = this.readFilterObjectProperty(record);
    if (property && this.isNoteSemanticOverrideProperty(property)) return true;
    return Object.values(record).some((value) => this.filterTreeUsesNoteSemanticOverride(value));
  }

  private filterTreeUsesUnsupportedNoteContextReference(node: unknown): boolean {
    if (typeof node === 'string') {
      return /\bthis\.(?!scheduled\b|date\b)/iu.test(node);
    }
    if (Array.isArray(node)) return node.some((child) => this.filterTreeUsesUnsupportedNoteContextReference(child));
    if (!node || typeof node !== 'object') return false;
    return Object.values(node as Record<string, unknown>)
      .some((value) => this.filterTreeUsesUnsupportedNoteContextReference(value));
  }

  private readDirectFilterProperty(rawExpression: string): string | null {
    const expression = String(rawExpression || '').trim().replace(/^!+\s*/u, '');
    const method = expression.match(/^([\s\S]+?)\.[\p{L}_$][\p{L}\p{N}_$-]*\s*\(/u);
    if (method?.[1]) return method[1].trim();
    const comparison = expression.match(/^([\s\S]+?)\s*(?:!==|!=|>=|<=|==|=|>|<|\bis\s+not\b|\bdoes\s+not\s+equal\b|\bnot\s+equals\b|\bequals?\b|\bis\b)\s*/iu);
    return comparison?.[1]?.trim() || null;
  }

  private isNoteSemanticOverrideProperty(rawProperty: string): boolean {
    const property = String(rawProperty || '').trim();
    if (!property) return false;
    if (property.toLocaleLowerCase() === 'kind') return true;
    return this.getConfiguredCustomProperty(property)?.type === 'folder';
  }

  private getNoteFilterFrontmatter(file: TFile): Record<string, unknown> {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return frontmatter && typeof frontmatter === 'object'
      ? frontmatter as Record<string, unknown>
      : {};
  }

  private getNoteExplicitKindValues(frontmatter: Record<string, unknown>): string[] {
    const values: string[] = [];
    for (const [key, rawValue] of Object.entries(frontmatter)) {
      const normalized = normalizePropertyKeyIdentity(key);
      if (!['kind', 'explicitkind', 'entitykind'].includes(normalized)) continue;
      const source = Array.isArray(rawValue) ? rawValue : rawValue == null ? [] : [rawValue];
      for (const value of source) {
        const text = String(value ?? '').trim();
        if (text) values.push(text);
      }
    }
    return Array.from(new Set(values));
  }

  private createNoteFilterContext(file: TFile, frontmatter: Record<string, unknown>): LogBaseFilterContext {
    const cache = this.app.metadataCache.getFileCache(file) as any;
    const filterFrontmatter: Record<string, unknown> = { ...frontmatter };
    const folder = file.parent?.path || '/';
    for (const property of this.getGcmSettings()?.properties || []) {
      if (property?.type !== 'folder') continue;
      const aliases = [property.key, property.id]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
      for (const alias of aliases) {
        const actualKey = findPropertyKeyCaseInsensitive(filterFrontmatter, alias);
        filterFrontmatter[actualKey || alias] = folder;
      }
    }
    const explicitKinds = this.getNoteExplicitKindValues(frontmatter);
    const fields: Record<string, unknown> = { ...filterFrontmatter };
    fields.explicitkind = explicitKinds;
    return {
      fields: fields as Record<string, string>,
      file: {
        path: file.path,
        name: file.name,
        basename: file.basename,
        extension: file.extension,
        folder,
        size: Number(file.stat?.size || 0),
        ctime: Number(file.stat?.ctime || 0),
        mtime: Number(file.stat?.mtime || 0),
        tags: parseTaskTagValues([
          this.asArray(frontmatter.tags),
          this.asArray(cache?.tags).map((tag: any) => tag?.tag ?? tag),
        ]),
        links: this.asArray(cache?.links).map((link: any) => link?.link ?? link),
        frontmatter: filterFrontmatter,
      },
      contextDate: this.getBaseContextFrontmatterValue('scheduled'),
      rowKind: 'note',
    };
  }

  private createSyntheticNoteEntry(file: TFile, frontmatter: Record<string, unknown>): BasesEntry {
    const findFrontmatterValue = (rawKey: string): unknown => {
      const actualKey = findPropertyKeyCaseInsensitive(frontmatter, rawKey);
      return actualKey == null ? null : frontmatter[actualKey];
    };
    return {
      file,
      getValue: (rawProperty: any) => {
        const property = String(rawProperty || '').trim();
        const lower = property.toLocaleLowerCase();
        if (this.getConfiguredCustomProperty(property)?.type === 'folder') return file.parent?.path || '/';
        if (lower === 'file.path' || lower === 'path') return file.path;
        if (lower === 'file.name') return file.name;
        if (lower === 'file.basename' || lower === 'name' || lower === 'title') return file.basename;
        if (lower === 'file.folder') return file.parent?.path || '/';
        if (lower === 'file.ext' || lower === 'file.extension') return file.extension;
        const key = this.getFrontmatterPropNameFromId(property)
          ?? property.replace(/^note\./iu, '');
        return findFrontmatterValue(key);
      },
    } as BasesEntry;
  }

  private groupsContainEntries(groups: BasesEntryGroup[]): boolean {
    return groups.some((group) => (group.entries ?? []).length > 0);
  }

  private shouldRenderNoteEntriesForGroups(groups: BasesEntryGroup[], taskFilter: KanbanTaskRootFilter): boolean {
    if (taskFilter.mode !== 'tasks') return true;
    return this.groupsContainEntries(groups);
  }

  private groupEntriesByProperty(entries: BasesEntry[], propId: string | null): BasesEntryGroup[] {
    if (!propId) {
      return [{
        key: null,
        entries,
        hasKey: () => false,
      } as unknown as BasesEntryGroup];
    }

    const normalized = this.normalizeTaskPropertyId(propId);
    return this.groupEntriesByValue(
      entries,
      (entry) => normalized === 'kind'
        ? getTpsBaseAdditiveKindValues('note', this.getEntryValue(entry, propId))
        : normalized === 'itemkind' || normalized === 'itemtype'
          ? 'note'
          : normalized === 'explicitkind' || normalized === 'entitykind'
            ? getTpsBaseAdditiveKindValues(null, this.getEntryValue(entry, propId))
            : entry.getValue(propId as any),
      this.getOrderingSemantics(propId),
      this.getMultiValueGroupingMode(),
    );
  }

  private groupEntriesBySourceNote(entries: BasesEntry[], propId: string): BasesEntryGroup[] {
    return this.groupEntriesByValue(
      entries,
      (entry) => this.getConfiguredCustomProperty(propId)?.type === 'folder'
        ? entry.file.parent?.path || '/'
        : getSourceNoteGroupValue(entry.file, propId),
      this.getOrderingSemantics(propId),
      this.getMultiValueGroupingMode(),
    );
  }

  private groupEntriesByValue(
    entries: BasesEntry[],
    getValue: (entry: BasesEntry) => unknown,
    semantics: TpsBaseValueSemantics = { kind: 'auto', collection: false },
    multiValueMode: TpsBaseMultiValueGroupingMode = 'separate',
  ): BasesEntryGroup[] {

    const byKey = new Map<string, BasesEntry[]>();
    const keyLabel = new Map<string, string>();
    const ungrouped: BasesEntry[] = [];

    for (const entry of entries) {
      const values = getTpsBaseGroupValues(getValue(entry), semantics, multiValueMode);
      if (!values.length) {
        ungrouped.push(entry);
        continue;
      }

      const unique = new Set(values.map((v) => v.trim()).filter(Boolean));
      if (!unique.size) {
        ungrouped.push(entry);
        continue;
      }

      for (const label of unique) {
        const norm = label.toLowerCase();
        const lane = byKey.get(norm) ?? [];
        lane.push(entry);
        byKey.set(norm, lane);
        if (!keyLabel.has(norm)) keyLabel.set(norm, label);
      }
    }

    const groups: BasesEntryGroup[] = [];
    for (const [norm, laneEntries] of byKey.entries()) {
      const label = keyLabel.get(norm) || norm;
      groups.push({
        key: label,
        entries: laneEntries,
        hasKey: () => true,
      } as unknown as BasesEntryGroup);
    }

    if (ungrouped.length) {
      groups.push({
        key: null,
        entries: ungrouped,
        hasKey: () => false,
      } as unknown as BasesEntryGroup);
    }

    return groups;
  }

  private getSortDescriptors(): TpsSortDescriptor[] {
    const rawSort = (this.config as any)?.sort
      ?? (this.config as any)?.getSort?.()
      ?? this.getConfigValue('sortBy')
      ?? [];
    const values = Array.isArray(rawSort) ? rawSort : rawSort ? [rawSort] : [];
    return values
      .map((item: any) => {
        const prop = typeof item === 'string'
          ? item.trim()
          : String(item?.property ?? item?.field ?? item?.key ?? '').trim();
        if (!prop) return null;
        const rawDirection = String(item?.direction ?? item?.dir ?? item?.order ?? '').trim().toLowerCase();
        const direction = rawDirection === 'desc' || rawDirection === 'descending' ? 'desc' : 'asc';
        return { prop, direction } satisfies TpsSortDescriptor;
      })
      .filter((item): item is TpsSortDescriptor => !!item);
  }

  private getCardPropertyIds(groupPropName: string | null): string[] {
    const rawOrder = (this.config as any)?.order ?? [];
    const values = Array.isArray(rawOrder) ? rawOrder : rawOrder ? [rawOrder] : [];
    const excluded = new Set([
      'name',
      'title',
      this.normalizeInlinePropertyKey(groupPropName || ''),
      this.normalizeInlinePropertyKey(this.plugin.settings?.iconKey || 'icon'),
      this.normalizeInlinePropertyKey(this.plugin.settings?.colorKey || 'color'),
      'icon',
      'color',
      'sort',
    ].filter(Boolean));
    const seen = new Set<string>();
    const props: string[] = [];
    for (const item of values) {
      const prop = typeof item === 'string'
        ? item.trim()
        : String(item?.property ?? item?.field ?? item?.key ?? '').trim();
      if (!prop) continue;
      const normalized = this.normalizeInlinePropertyKey(this.getFrontmatterPropNameFromId(prop) ?? prop);
      const lower = prop.toLowerCase();
      if (excluded.has(lower) || excluded.has(normalized)) continue;
      if (seen.has(lower)) continue;
      seen.add(lower);
      props.push(prop);
    }
    return props;
  }

  private sortEntriesForView(entries: BasesEntry[]): BasesEntry[] {
    const sortDescriptors = this.getSortDescriptors();
    if (!sortDescriptors.length) return entries;

    return entries.map((entry, index) => ({ entry, index })).sort((a, b) => {
      for (const { prop, direction } of sortDescriptors) {
        const result = compareTpsBaseValues(
          this.getNativeSortValue(a.entry, prop),
          this.getNativeSortValue(b.entry, prop),
          this.getOrderingSemantics(prop),
          direction,
        );
        if (result !== 0) return result;
      }
      return a.index - b.index;
    }).map(({ entry }) => entry);
  }

  private getNativeSortValue(entry: BasesEntry, propId: string): unknown {
    const lower = String(propId || '').trim().toLowerCase();
    if (lower === 'file.name' || lower === 'name' || lower === 'title') return entry.file?.basename || entry.file?.name || '';
    if (lower === 'file.path' || lower === 'path') return entry.file?.path || '';
    if (this.getConfiguredCustomProperty(propId)?.type === 'folder') return entry.file?.parent?.path || '/';
    const normalized = this.normalizeTaskPropertyId(propId);
    const authored = this.getEntryValue(entry, propId.includes('.') ? propId : `note.${propId}`);
    if (normalized === 'kind') return getTpsBaseAdditiveKindValues('note', authored);
    if (normalized === 'itemkind' || normalized === 'itemtype') return 'note';
    if (normalized === 'explicitkind' || normalized === 'entitykind') {
      return getTpsBaseAdditiveKindValues(null, authored);
    }
    return authored;
  }

  private getOrderingSemantics(propId: string): TpsBaseValueSemantics {
    if (/^formula\./iu.test(String(propId || '').trim())) {
      return resolveTpsBaseValueSemantics(propId, null);
    }
    if (this.isStatusPropertyName(propId)) return { kind: 'choice', collection: false };
    const normalized = this.normalizeTaskPropertyId(propId);
    if (normalized === 'kind') return { kind: 'choice', collection: true, itemKind: 'choice' };
    if (normalized === 'itemkind' || normalized === 'itemtype') return { kind: 'choice', collection: false };
    if (normalized === 'explicitkind' || normalized === 'entitykind') {
      return { kind: 'choice', collection: true, itemKind: 'choice' };
    }
    return resolveTpsBaseValueSemantics(propId, this.getConfiguredCustomProperty(propId));
  }

  private extractGroupValues(raw: unknown): string[] {
    if (
      raw instanceof Date
      || raw instanceof Set
      || Array.isArray(raw)
      || (raw && typeof raw === 'object' && '__tpsFormulaType' in raw)
    ) return getTpsFormulaGroupValues(raw);
    return extractKanbanGroupValues(raw);
  }

  private keyLabel(group: BasesEntryGroup): string {
    if (!group.hasKey() || group.key == null) return 'No value';
    const s = String(group.key ?? '').trim();
    const normalized = s.toLowerCase();
    if (!s || normalized === 'null' || normalized === 'undefined') return 'No value';
    return s;
  }

  private getLaneLabelAlias(laneId: string): string | null {
    const viewId = this.getLaneOrderViewId();
    const all = this.plugin.settings?.laneLabelAliasesByView as Record<string, Record<string, string>> | undefined;
    const aliases = all?.[viewId] ?? all?.[this.getLegacyUnknownBaseViewId()];
    if (!aliases || typeof aliases !== 'object') return null;
    const alias = String(aliases[laneId] ?? '').trim();
    return alias || null;
  }

  private getLaneDisplayLabel(group: BasesEntryGroup): string {
    const laneId = this.getLaneId(group);
    const alias = this.getLaneLabelAlias(laneId);
    if (alias) return alias;
    const scheduledTemplateLabel = this.getScheduledTemplateLaneLabel(group);
    if (scheduledTemplateLabel) return scheduledTemplateLabel;
    return this.keyLabel(group);
  }

  private getScheduledTemplateLaneLabel(group: BasesEntryGroup): string | null {
    const groupPropName = this.getGroupByPropName();
    if (this.normalizeInlinePropertyKey(this.getTaskInlinePropertyName(groupPropName)) !== 'scheduled') return null;

    const scheduled = this.getBaseContextFrontmatterValue('scheduled');
    if (!scheduled) return null;
    if (!group.hasKey() || group.key == null) return 'Unscheduled';

    const groupKey = String(group.key ?? '').trim();
    if (!groupKey) return 'Unscheduled';
    const scheduledDay = scheduled.slice(0, 10);
    const groupDay = groupKey.slice(0, 10);
    return scheduledDay && groupDay === scheduledDay ? 'Scheduled today' : null;
  }

  private buildDisplayLaneGroups(groups: BasesEntryGroup[]): DisplayLaneGroup[] {
    const byLabel = new Map<string, DisplayLaneGroup>();
    const ordered: DisplayLaneGroup[] = [];

    for (const group of groups) {
      const label = this.getLaneDisplayLabel(group);
      const normalized = label.trim().toLowerCase() || 'no value';
      let display = byLabel.get(normalized);
      if (!display) {
        display = {
          id: `display:${normalized}`,
          label,
          groups: [],
          laneIds: [],
        };
        byLabel.set(normalized, display);
        ordered.push(display);
      }
      display.groups.push(group);
      display.laneIds.push(this.getLaneId(group));
    }

    return ordered;
  }

  private getRenderItemsForDisplayLane(
    displayLane: DisplayLaneGroup,
    laneRenderItemsByLane: Map<string, LaneRenderItem[]>,
  ): LaneRenderItem[] {
    const items: LaneRenderItem[] = [];
    const seen = new Set<string>();
    const cloneVisibleTree = (item: LaneRenderItem): LaneRenderItem | null => {
      const path = item.entry.file.path;
      if (seen.has(path)) return null;
      seen.add(path);
      return {
        ...item,
        children: item.children.map(cloneVisibleTree).filter((child): child is LaneRenderItem => !!child),
      };
    };
    for (const laneId of displayLane.laneIds) {
      const laneItems = laneRenderItemsByLane.get(laneId) ?? [];
      for (const item of laneItems) {
        const cloned = cloneVisibleTree(item);
        if (cloned) items.push(cloned);
      }
    }
    return items;
  }

  private async resolveDropValueForDisplayLane(
    displayLane: DisplayLaneGroup,
  ): Promise<{ selected: boolean; value: string | null }> {
    const options = displayLane.groups.map((group) => {
      if (group.hasKey() && group.key != null) {
        const value = String(group.key ?? '').trim();
        return { label: value || 'No value', value: value || null };
      }
      return { label: 'No value', value: null };
    });

    // De-duplicate while preserving lane order.
    const deduped: Array<{ label: string; value: string | null }> = [];
    const seen = new Set<string>();
    for (const option of options) {
      const key = option.value === null ? '__null__' : option.value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(option);
    }

    if (displayLane.groups.length <= 1 || deduped.length <= 1) {
      return { selected: true, value: deduped[0]?.value ?? null };
    }

    const selection = await new Promise<string | null | undefined>((resolve) => {
      const modal = new LaneValueSelectModal(
        this.app,
        `Apply value in "${displayLane.label}"`,
        deduped,
        resolve,
      );
      modal.open();
    });
    if (selection === undefined) return { selected: false, value: null };
    return { selected: true, value: selection };
  }

  private normalizeInlinePropertyKey(key: string): string {
    return normalizePropertyKeyIdentity(key);
  }

  private getTaskInlinePropertyName(propName: string | null | undefined): string {
    return String(propName || '').trim().replace(/^(?:task|note)\./i, '');
  }

  private isStatusPropertyName(propName: string | null | undefined): boolean {
    if (this.isRelationalStatusPropertyReference(propName)) return false;
    const normalized = this.normalizeInlinePropertyKey(this.getTaskInlinePropertyName(propName));
    if (!normalized) return false;
    if (normalized === 'status' || normalized === 'checkboxstatus') return true;
    const configuredKey = this.getGcmServices()?.status?.getStatusPropertyKey?.()
      ?? this.getGcmSettings()?.properties?.find?.((property: any) => {
        const id = String(property?.id || '').trim().toLowerCase();
        const key = String(property?.key || '').trim().toLowerCase();
        return id === 'status' || key === 'status';
      })?.key;
    return normalized === this.normalizeInlinePropertyKey(String(configuredKey || ''));
  }

  private getWorkflowStatusPropertyKey(): string {
    return String(this.getGcmServices()?.status?.getStatusPropertyKey?.() || '').trim();
  }

  private getRelationalStatusPropertyKey(): string {
    return String(this.getGcmServices()?.status?.getRelationalStatusPropertyKey?.() || '').trim();
  }

  private getWorkflowStatusFieldKeysToClear(): string[] {
    const workflowKey = this.getWorkflowStatusPropertyKey();
    const relationalKey = this.normalizeInlinePropertyKey(this.getRelationalStatusPropertyKey());
    return Array.from(new Set([
      workflowKey,
      'task.status',
      'checkboxStatus',
      ...(this.normalizeInlinePropertyKey(workflowKey) === 'status' ? ['status'] : []),
    ].map((key) => String(key || '').trim()).filter((key) => (
      !!key && this.normalizeInlinePropertyKey(key) !== relationalKey
    ))));
  }

  private isRelationalStatusPropertyReference(
    propName: string | null | undefined,
  ): boolean {
    return isRelationalStatusReference(
      propName,
      this.getGcmSettings()?.properties,
    );
  }

  private async openOrFocusFile(file: TFile): Promise<WorkspaceLeaf | null> {
    const existingLeaf = this.findMainWorkspaceLeafForFile(file);
    if (existingLeaf) {
      flow('OpenTarget', 'focus-existing', { path: file.path });
      this.app.workspace.setActiveLeaf(existingLeaf, { focus: true } as any);
      this.app.workspace.revealLeaf(existingLeaf);
      return existingLeaf;
    }

    const leaf = this.getTargetLeafForOpen();
    if (!leaf) {
      flowWarn('OpenTarget', 'blocked', { reason: 'no-target-leaf', path: file.path });
      return null;
    }
    flow('OpenTarget', 'open-new', { path: file.path });
    await leaf.openFile(file, { active: true } as any);
    this.app.workspace.setActiveLeaf(leaf, { focus: true } as any);
    this.app.workspace.revealLeaf(leaf);
    flow('OpenTarget', 'open-done', { path: file.path });
    return leaf;
  }

  private async openTaskLine(file: TFile, line: number, sourceEl?: HTMLElement): Promise<void> {
    const targetLine = Math.max(0, Number(line || 1) - 1);
    let leaf = sourceEl ? this.getOwningWorkspaceLeaf(sourceEl) : null;
    if (leaf) {
      this.app.workspace.setActiveLeaf(leaf, { focus: true } as any);
      this.app.workspace.revealLeaf(leaf);
    } else {
      leaf = await this.openOrFocusFile(file);
    }
    let editor = (leaf?.view as any)?.editor;
    if (leaf && (!editor || typeof editor.setCursor !== 'function')) {
      flow('OpenTaskLine', 'source-fallback', {
        path: file.path,
        line: targetLine + 1,
        reason: 'matched-view-has-no-editor',
      });
      this.getGcmPlugin()?.dailyNoteHomeService?.allowLivePreview?.(leaf, file.path);
      await leaf.setViewState({
        type: 'markdown',
        active: true,
        pinned: leaf.getViewState().pinned,
        state: { file: file.path, mode: 'source', source: false },
      });
      editor = (leaf.view as any)?.editor;
    }
    if (!editor || typeof editor.setCursor !== 'function') {
      flow('OpenTaskLine', 'source-tab-fallback', {
        path: file.path,
        line: targetLine + 1,
      });
      leaf = this.app.workspace.getLeaf('tab');
      this.getGcmPlugin()?.dailyNoteHomeService?.allowLivePreview?.(leaf, file.path);
      await leaf.openFile(file, { active: true, state: { mode: 'source' } } as any);
      this.app.workspace.setActiveLeaf(leaf, { focus: true } as any);
      this.app.workspace.revealLeaf(leaf);
      editor = (leaf.view as any)?.editor;
    }
    if (!editor || typeof editor.setCursor !== 'function') {
      flowWarn('OpenTaskLine', 'blocked', {
        reason: 'missing-editor',
        path: file.path,
        line: targetLine + 1,
      });
      return;
    }
    flow('OpenTaskLine', 'scroll:start', {
      path: file.path,
      line: targetLine + 1,
    });
    editor.setCursor({ line: targetLine, ch: 0 });
    if (typeof editor.scrollIntoView === 'function') {
      editor.scrollIntoView({ from: { line: targetLine, ch: 0 }, to: { line: targetLine, ch: 0 } }, true);
    }
    if (typeof editor.focus === 'function') editor.focus();
    flow('OpenTaskLine', 'scroll:done', {
      path: file.path,
      line: targetLine + 1,
    });
  }

  private getOwningWorkspaceLeaf(element: HTMLElement): WorkspaceLeaf | null {
    let match: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (match) return;
      const containerEl = (leaf.view as any)?.containerEl;
      if (containerEl instanceof HTMLElement && containerEl.contains(element)) match = leaf;
    });
    return match;
  }

  private findMainWorkspaceLeafForFile(file: TFile): WorkspaceLeaf | null {
    let match: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (match || !this.isMainWorkspaceOpenTarget(leaf)) return;
      const viewFile = (leaf.view as any)?.file;
      if (viewFile instanceof TFile && viewFile.path === file.path) {
        match = leaf;
      }
    });
    return match;
  }

  private getTargetLeafForOpen(): WorkspaceLeaf | null {
    return this.app.workspace.getLeaf('tab');
  }

  private isMainWorkspaceOpenTarget(leaf: WorkspaceLeaf | null | undefined): leaf is WorkspaceLeaf {
    if (!leaf) return false;
    const containerEl = (leaf as any).containerEl as HTMLElement | undefined;
    if (containerEl?.closest('.workspace-split.mod-left-split, .workspace-split.mod-right-split')) return false;
    const viewType = leaf.view?.getViewType?.();
    return viewType !== TPS_LIST_VIEW_TYPE;
  }

  private getEntryValue(entry: BasesEntry, propName: string): unknown {
    try {
      return entry.getValue(propName as any);
    } catch {
      return undefined;
    }
  }

  private getOrderedVisiblePaths(
    displayLanes: DisplayLaneGroup[],
    renderItemsByDisplayLane: Map<string, LaneRenderItem[]>,
  ): string[] {
    const ordered: string[] = [];
    const appendItem = (item: LaneRenderItem) => {
      ordered.push(item.entry.file.path);
      for (const child of item.children) appendItem(child);
    };
    for (const displayLane of displayLanes) {
      const items = renderItemsByDisplayLane.get(displayLane.id) ?? [];
      for (const item of items) appendItem(item);
    }
    return ordered;
  }

  private buildLaneRenderItemsByLane(
    groups: BasesEntryGroup[],
    parentByChild: Map<string, string>,
  ): Map<string, LaneRenderItem[]> {
    const laneRenderItemsByLane = new Map<string, LaneRenderItem[]>();
    const markCollapsedDescendantsHandled = (
      parentPath: string,
      lineage: Set<string>,
      renderedInLane: Set<string>,
      laneChildrenByParent: Map<string, BasesEntry[]>,
    ) => {
      const children = laneChildrenByParent.get(parentPath) ?? [];
      for (const child of children) {
        const childPath = child.file.path;
        if (renderedInLane.has(childPath) || lineage.has(childPath)) continue;
        renderedInLane.add(childPath);
        const nextLineage = new Set(lineage);
        nextLineage.add(childPath);
        markCollapsedDescendantsHandled(childPath, nextLineage, renderedInLane, laneChildrenByParent);
      }
    };

    const walk = (
      entry: BasesEntry,
      depth: number,
      lineage: Set<string>,
      renderedInLane: Set<string>,
      laneChildrenByParent: Map<string, BasesEntry[]>,
    ): LaneRenderItem | null => {
      const path = entry.file.path;
      if (renderedInLane.has(path) || lineage.has(path)) return null;

      renderedInLane.add(path);
      const childCount = (laneChildrenByParent.get(path) ?? []).length;
      const hasChildren = childCount > 0;
      const item: LaneRenderItem = { entry, depth, hasChildren, childCount, children: [] };

      if (hasChildren && !this.expandedSubtreePaths.has(path)) {
        const nextLineage = new Set(lineage);
        nextLineage.add(path);
        markCollapsedDescendantsHandled(path, nextLineage, renderedInLane, laneChildrenByParent);
        return item;
      }

      const nextLineage = new Set(lineage);
      nextLineage.add(path);
      const children = laneChildrenByParent.get(path) ?? [];
      for (const child of children) {
        const childItem = walk(child, depth + 1, nextLineage, renderedInLane, laneChildrenByParent);
        if (childItem) item.children.push(childItem);
      }
      return item;
    };

    for (const group of groups) {
      const laneId = this.getLaneId(group);
      const laneEntryByPath = new Map<string, BasesEntry>();
      for (const entry of group.entries) {
        if (!laneEntryByPath.has(entry.file.path)) {
          laneEntryByPath.set(entry.file.path, entry);
        }
      }

      const laneChildrenByParent = new Map<string, BasesEntry[]>();
      for (const entry of laneEntryByPath.values()) {
        const parentPath = parentByChild.get(entry.file.path);
        if (!parentPath || parentPath === entry.file.path) continue;
        if (!laneEntryByPath.has(parentPath)) continue;
        const children = laneChildrenByParent.get(parentPath) ?? [];
        children.push(entry);
        laneChildrenByParent.set(parentPath, children);
      }

      const topLevel: BasesEntry[] = [];
      for (const entry of laneEntryByPath.values()) {
        const parentPath = parentByChild.get(entry.file.path);
        const hasVisibleParentInLane = !!parentPath && parentPath !== entry.file.path && laneEntryByPath.has(parentPath);
        if (!hasVisibleParentInLane) topLevel.push(entry);
      }

      laneRenderItemsByLane.set(laneId, []);
      const renderedInLane = new Set<string>();
      for (const entry of topLevel) {
        const item = walk(entry, 0, new Set(), renderedInLane, laneChildrenByParent);
        if (item) laneRenderItemsByLane.get(laneId)?.push(item);
      }

      // Defensive fallback for malformed parent chains/cycles.
      for (const entry of laneEntryByPath.values()) {
        if (!renderedInLane.has(entry.file.path)) {
          const item = walk(entry, 0, new Set(), renderedInLane, laneChildrenByParent);
          if (item) laneRenderItemsByLane.get(laneId)?.push(item);
        }
      }
    }

    return laneRenderItemsByLane;
  }

  private buildTaskRenderItemsByLane(
    groups: BasesEntryGroup[],
    propName: string | null,
    visibleNotePaths = this.getVisibleNotePaths(groups),
    taskFilter = this.getTaskRootFilterFromBaseFilters(),
  ): Map<string, TaskRenderItem[]> {
    const tasksByLane = new Map<string, TaskRenderItem[]>();
    if (taskFilter.mode === 'notes') return tasksByLane;
    if (!this.isBaseFileFilterReady()) {
      this.scheduleBaseFileFilterLoad();
      return tasksByLane;
    }
    const searchQuery = this.getActiveBasesSearchQuery();
    const explicitTaskSourceFiles = this.getExplicitTaskSourceFiles(taskFilter);
    const explicitTaskSourcePaths = new Set(explicitTaskSourceFiles.map((file) => file.path));

    const sourceFiles = new Map<string, TFile>();
    for (const group of groups) {
      for (const entry of group.entries) {
        if (!sourceFiles.has(entry.file.path)) sourceFiles.set(entry.file.path, entry.file);
      }
    }
    for (const file of explicitTaskSourceFiles) {
      if (!sourceFiles.has(file.path)) sourceFiles.set(file.path, file);
    }
    if (taskFilter.mode === 'tasks' || taskFilter.mode === 'bullets' || this.shouldScanVaultForTaskFilters(taskFilter)) {
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!sourceFiles.has(file.path)) sourceFiles.set(file.path, file);
      }
    }

    for (const file of sourceFiles.values()) {
      if (
        taskFilter.mode !== 'tasks'
        && !taskFilter.hasTaskDirective
        && !explicitTaskSourcePaths.has(file.path)
        && !visibleNotePaths.has(file.path)
      ) continue;
      for (const task of this.getAllLineItemsForFile(file, taskFilter)) {
        if (!this.taskMatchesRootFilter(task, taskFilter, file)) continue;
        if (!this.taskMatchesSearchQuery(file, task, searchQuery)) continue;
        for (const laneId of this.getTaskLaneIds(task, propName, file)) {
          const laneTasks = tasksByLane.get(laneId) ?? [];
          const propId = this.getGroupByPropId(propName) ?? propName;
          const sourceLabel = isSourceNoteGroupProperty(propId)
            ? getSourceNoteGroupValue(file, propId)
            : undefined;
          laneTasks.push({
            file,
            task,
            laneId,
            ...(sourceLabel ? { laneLabel: sourceLabel } : {}),
          });
          tasksByLane.set(laneId, laneTasks);
        }
      }
    }

    return tasksByLane;
  }

  private getExplicitTaskSourceFiles(taskFilter = this.getTaskRootFilterFromBaseFilters()): TFile[] {
    const paths = new Set<string>();
    const defaults = this.getRootTaskCreationDefaults(taskFilter);
    const targetPath = this.normalizeTaskTargetPath(defaults.targetPath || '');
    if (targetPath) paths.add(targetPath);
    for (const root of this.getBaseFilterRoots()) {
      this.collectTaskPathFilters(root, paths);
    }
    return Array.from(paths)
      .map((path) => this.app.vault.getFileByPath(path))
      .filter((file): file is TFile => file instanceof TFile);
  }

  private isExplicitTaskSourceFile(file: TFile, taskFilter = this.getTaskRootFilterFromBaseFilters()): boolean {
    return this.getExplicitTaskSourceFiles(taskFilter).some((source) => source.path === file.path);
  }

  private isTaskSourceFile(file: TFile, taskFilter = this.getTaskRootFilterFromBaseFilters()): boolean {
    return this.shouldScanVaultForTaskFilters(taskFilter) || this.isExplicitTaskSourceFile(file, taskFilter);
  }

  private shouldScanVaultForTaskFilters(taskFilter = this.getTaskRootFilterFromBaseFilters()): boolean {
    if (taskFilter.mode === 'tasks' || taskFilter.mode === 'bullets') return true;
    if (this.isEmbeddedScheduledDailyTaskBoard()) return true;
    // A formula can select a synthesized checkbox, bullet, or heading even when
    // Bases returned no native note rows. Detect only real formula references;
    // quoted/regex/object-literal text is deliberately ignored by the provider.
    if (hasTpsFormulaReference(this.getBaseFilterRoots())) return true;
    if (!taskFilter.hasTaskDirective) return false;
    return this.getBaseFilterRoots().some((root) => this.hasGlobalTaskMatchFilter(root));
  }

  private hasGlobalTaskMatchFilter(node: unknown): boolean {
    if (!node) return false;
    if (Array.isArray(node)) return node.some((child) => this.hasGlobalTaskMatchFilter(child));
    if (typeof node === 'string') {
      const expr = node.trim().replace(/^!+\s*/u, '');
      return /^(?:task\.)?(?:tags?|status|open|isopen|done|isdone|completed|complete)\b/i.test(expr)
        || /^(?:(?:tps|kanban)\.)?(?:itemtype|itemkind|kind)\s*(?:==|=|is|equals?)\s*/i.test(expr)
        || this.isSharedTaskValueFilterExpression(expr);
    }
    if (typeof node !== 'object') return false;
    const record = node as Record<string, unknown>;
    const propRaw = this.readFilterObjectProperty(record).toLowerCase();
    const normalizedProp = this.normalizeInlinePropertyKey(propRaw.replace(/^(?:task|tps|kanban)\./i, ''));
    if (propRaw.startsWith('task.') && !['path', 'file', 'filepath', 'fileextension', 'fileext'].includes(normalizedProp)) return true;
    if (['itemtype', 'itemkind', 'kind', 'tags', 'tag', 'status', 'open', 'isopen', 'done', 'isdone', 'completed', 'complete'].includes(normalizedProp)) return true;
    if (propRaw && !propRaw.startsWith('note.') && !propRaw.startsWith('file.') && !['path', 'file', 'filepath', 'fileextension', 'fileext'].includes(normalizedProp)) return true;
    return Object.values(record).some((value) => this.hasGlobalTaskMatchFilter(value));
  }

  private isSharedTaskValueFilterExpression(expr: string): boolean {
    const prop = this.readFilterExpressionProperty(expr);
    if (!prop) return false;
    const lower = prop.toLowerCase();
    if (lower.startsWith('note.') || lower.startsWith('file.')) return false;
    const normalized = this.normalizeInlinePropertyKey(lower.replace(/^(?:task|tps|kanban)\./i, ''));
    return !['path', 'file', 'filepath', 'fileextension', 'fileext', 'extension', 'ext'].includes(normalized);
  }

  private collectTaskPathFilters(node: unknown, paths: Set<string>): void {
    if (!node) return;
    if (typeof node === 'string') {
      const extracted = this.extractTaskPathFilterFromString(node);
      if (extracted) paths.add(extracted);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) this.collectTaskPathFilters(child, paths);
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const pathFromObject = this.extractTaskPathFilterFromObject(record);
    if (pathFromObject) paths.add(pathFromObject);
    for (const value of Object.values(record)) this.collectTaskPathFilters(value, paths);
  }

  private extractTaskPathFilterFromString(rawExpr: string): string | null {
    const expr = String(rawExpr || '').trim().replace(/^!+\s*/u, '');
    const match = expr.match(/^(?:task\.)?(?:path|file|file\.path)\s*(?:==|=|is|equals?)\s*(?:"([^"]+)"|'([^']+)'|(.+))$/i);
    const value = match?.[1] || match?.[2] || match?.[3];
    return value ? this.normalizeTaskTargetPath(value) : null;
  }

  private extractTaskPathFilterFromObject(record: Record<string, unknown>): string | null {
    const propRaw = this.readFilterObjectProperty(record);
    const normalizedProp = this.normalizeInlinePropertyKey(propRaw.replace(/^task\./i, '').replace(/^tps\./i, ''));
    if (!(['path', 'file', 'filepath'].includes(normalizedProp) || propRaw.toLowerCase() === 'file.path' || propRaw.toLowerCase() === 'task.file.path')) return null;
    const operator = this.readFilterObjectOperator(record);
    if (!this.isPathComparisonOperator(operator) || operator.includes('contains') || operator.startsWith('!')) return null;
    const value = this.readFilterObjectValues(record).find(Boolean);
    return value ? this.normalizeTaskTargetPath(value) : null;
  }

  private getActiveBasesSearchQuery(): string {
    const roots = [
      this.containerEl.closest('.internal-embed, .markdown-embed, .cm-embed-block, .sync-embed, .sync-container') as HTMLElement | null,
      this.containerEl.closest('.workspace-leaf') as HTMLElement | null,
    ].filter((root): root is HTMLElement => !!root);

    for (const root of roots) {
      const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="search"], input[placeholder*="Search" i], input[aria-label*="Search" i]'));
      for (const input of inputs) {
        const value = String(input.value || '').trim();
        if (value) return value;
      }
    }
    return '';
  }

  private taskMatchesSearchQuery(file: TFile, task: OpenTaskSubitem, query: string): boolean {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) return true;
    const formulaValues = Object.values(this.getTaskFormulaSession(file, task).getAll())
      .filter((result) => result.status === 'value')
      .map((result) => formatTpsFormulaValue(result.value));
    const haystack = [
      file.basename,
      file.name,
      file.path,
      task.text,
      task.displayText,
      task.checkboxState,
      ...(task.inlineFields ?? []).flatMap((field) => [field.key, field.value]),
      ...formulaValues,
    ]
      .map((value) => String(value ?? '').toLowerCase())
      .join('\n');
    return normalizedQuery
      .split(/\s+/g)
      .filter(Boolean)
      .every((part) => haystack.includes(part));
  }

  private getVisibleNotePaths(groups: BasesEntryGroup[]): Set<string> {
    const visible = new Set<string>();
    for (const group of groups) {
      for (const entry of group.entries) visible.add(entry.file.path);
    }
    return visible;
  }

  private getAllLineItemsForFile(file: TFile, filter: KanbanTaskRootFilter): OpenTaskSubitem[] {
    if (!filter.includeBullets && !filter.includeHeadings) return this.getAllTasksForFile(file);
    const cacheSuffix = filter.includeBullets && filter.includeHeadings
      ? 'bullets+headings'
      : filter.includeBullets ? 'bullets' : 'headings';
    const cacheKey = `${file.path}:${cacheSuffix}`;
    const cached = this.allTasksByPath.get(cacheKey);
    if (cached) return cached;
    let items: OpenTaskSubitem[] = [];
    void this.app.vault.cachedRead(file).then((content) => {
      items = this.parseOpenTasks(
        content,
        file.path,
        Number.MAX_SAFE_INTEGER,
        true,
        filter.includeBullets,
        filter.includeHeadings,
      ).openTasks;
      this.allTasksByPath.set(cacheKey, items);
      this.refreshDebounced();
    });
    return items;
  }

  private taskMatchesRootFilter(task: OpenTaskSubitem, filter: KanbanTaskRootFilter, file: TFile | null = null): boolean {
    const structuredMatch = this.taskMatchesStructuredBaseFilters(task, file);
    if (structuredMatch === false) return false;
    if (structuredMatch == null && this.isEmbeddedScheduledDailyTaskBoard()) {
      if (!this.taskMatchesEmbeddedScheduledDailyBoard(task)) return false;
    }

    if (filter.mode === 'tasks' && task.itemKind !== 'task') return false;
    if (filter.mode === 'bullets' && task.itemKind !== 'bullet') return false;
    if ((task.itemKind === 'bullet' || task.itemKind === 'heading') && structuredMatch !== true) return false;

    if (task.itemKind === 'heading') return true;

    if (task.itemKind === 'bullet') {
      const taskTags = new Set(this.getTaskInlineValues(task, 'tags').map((tag) => tag.toLowerCase()));
      for (const tag of filter.excludeTags) {
        if (taskTags.has(tag)) return false;
      }
      if (filter.tags.size) {
        let matched = false;
        for (const tag of filter.tags) {
          if (taskTags.has(tag)) {
            matched = true;
            break;
          }
        }
        if (!matched) return false;
      }
      return true;
    }

    const status = this.getMappedStatusForTask(task);
    if (!status) {
      // A structurally valid task may still participate in kind/tag/formula
      // queries, but it must never be guessed into a workflow-status branch.
      if (structuredMatch !== true) return false;
    } else {
      if (!filter.includeDone && this.classifyDoneStatus(status) !== false) return false;
      if (filter.excludeStatuses.has(status)) return false;
      if (filter.statuses.size && !filter.statuses.has(status)) return false;
    }
    const taskTags = new Set(this.getTaskInlineValues(task, 'tags').map((tag) => tag.toLowerCase()));
    for (const tag of filter.excludeTags) {
      if (taskTags.has(tag)) return false;
    }
    if (filter.tags.size) {
      let matched = false;
      for (const tag of filter.tags) {
        if (taskTags.has(tag)) {
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    }
    return true;
  }

  private isEmbeddedScheduledDailyTaskBoard(): boolean {
    const groupPropName = this.getGroupByPropName();
    if (this.normalizeInlinePropertyKey(this.getTaskInlinePropertyName(groupPropName)) !== 'scheduled') return false;
    if (!this.getBaseContextFrontmatterValue('scheduled')) return false;
    return this.isEmbeddedScheduledDailyTaskFallbackFilter();
  }

  private isEmbeddedScheduledDailyTaskFallbackFilter(): boolean {
    const roots = this.getBaseFilterRoots();
    if (!roots.length) return false;
    return roots.some((root) => this.filterTreeHasDailyTaskFallback(root));
  }

  private filterTreeHasDailyTaskFallback(root: unknown): boolean {
    const conditions = this.collectFilterTextConditions(root);
    return conditions.some((condition) => this.isTaskKindCondition(condition))
      && conditions.some((condition) => this.isScheduledTodayCondition(condition))
      && conditions.some((condition) => this.isScheduledEmptyCondition(condition));
  }

  private collectFilterTextConditions(root: unknown, seen = new WeakSet<object>()): string[] {
    if (!root) return [];
    if (typeof root === 'string') return [this.normalizeFilterConditionText(root)];
    if (typeof root !== 'object') return [];
    if (seen.has(root)) return [];
    seen.add(root);

    if (Array.isArray(root)) {
      return root.flatMap((item) => this.collectFilterTextConditions(item, seen));
    }

    const record = root as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of ['and', 'or', 'all', 'any', 'not', 'children', 'filters']) {
      parts.push(...this.collectFilterTextConditions(record[key], seen));
    }

    const prop = String(record.property ?? record.field ?? record.key ?? '').trim();
    const operator = String(record.operator ?? record.op ?? record.comparison ?? '').trim();
    const value = record.value ?? record.values ?? record.expected;
    if (prop || operator || value != null) {
      parts.push(this.normalizeFilterConditionText(`${prop} ${operator} ${Array.isArray(value) ? value.join(',') : String(value ?? '')}`));
    }

    return parts.filter(Boolean);
  }

  private normalizeFilterConditionText(condition: string): string {
    return condition
      .toLowerCase()
      .replace(/\\?["'`]/g, '')
      .replace(/\s+/g, '');
  }

  private isTaskKindCondition(condition: string): boolean {
    return /(?:^|[^\w.])kind(?:==|=|is|:)?task(?:$|[^\w.])/.test(condition);
  }

  private isScheduledTodayCondition(condition: string): boolean {
    return condition.includes('scheduled==this.scheduled')
      || condition.includes('scheduled=this.scheduled')
      || condition.includes('scheduledisthis.scheduled')
      || condition.includes('scheduled:this.scheduled');
  }

  private isScheduledEmptyCondition(condition: string): boolean {
    return condition.includes('scheduled.isempty()')
      || condition.includes('scheduled.empty()')
      || condition.includes('scheduledisempty')
      || condition.includes('scheduledempty');
  }

  private taskMatchesEmbeddedScheduledDailyBoard(task: OpenTaskSubitem): boolean {
    if (task.itemKind !== 'task') return false;
    const scheduled = this.getBaseContextFrontmatterValue('scheduled');
    const scheduledDay = this.extractDateDay(scheduled || '');
    if (!scheduledDay) return false;
    const values = this.getTaskInlineValues(task, 'scheduled');
    if (!values.length) return true;
    return values.some((value) => this.extractDateDay(value) === scheduledDay);
  }

  private taskMatchesStructuredBaseFilters(task: OpenTaskSubitem, file: TFile | null = null): boolean | null {
    let hasStructuredTaskFilter = false;
    for (const root of this.getBaseFilterRoots()) {
      const result = this.evaluateTaskFilterRootFailClosed(root, task, file);
      if (result == null) continue;
      hasStructuredTaskFilter = true;
      if (!result) return false;
    }
    return hasStructuredTaskFilter ? true : null;
  }

  private evaluateTaskFilterRootFailClosed(
    node: unknown,
    task: OpenTaskSubitem,
    file: TFile | null = null,
  ): boolean | null {
    const failureSequence = this.formulaFilterFailureSequence ?? 0;
    const result = this.evaluateTaskFilterNode(node, task, file);
    return (this.formulaFilterFailureSequence ?? 0) === failureSequence ? result : false;
  }

  private evaluateTaskFilterNode(node: unknown, task: OpenTaskSubitem, file: TFile | null = null): boolean | null {
    if (!node) return null;
    if (typeof node === 'string') return this.evaluateTaskFilterString(node, task, file);
    if (Array.isArray(node)) return evaluateOrderedFilterChildren(node, 'and', (child) => this.evaluateTaskFilterNode(child, task, file));
    if (typeof node !== 'object') return null;

    const record = node as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, 'and') || Object.prototype.hasOwnProperty.call(record, 'all')) {
      const children = Object.prototype.hasOwnProperty.call(record, 'and') ? record.and : record.all;
      return evaluateOrderedFilterChildren(this.asArray(children), 'and', (child) => this.evaluateTaskFilterNode(child, task, file));
    }
    if (Object.prototype.hasOwnProperty.call(record, 'or') || Object.prototype.hasOwnProperty.call(record, 'any')) {
      const children = Object.prototype.hasOwnProperty.call(record, 'or') ? record.or : record.any;
      return evaluateOrderedFilterChildren(this.asArray(children), 'or', (child) => this.evaluateTaskFilterNode(child, task, file));
    }
    if (Object.prototype.hasOwnProperty.call(record, 'not')) {
      if (
        !this.getMappedStatusForTask(task)
        && this.filterNodeUsesWorkflowStatus(record.not)
      ) return false;
      const result = this.evaluateTaskFilterNode(record.not, task, file);
      return result == null ? null : !result;
    }

    return this.evaluateTaskFilterObject(record, task, file);
  }

  private evaluateTaskFilterString(rawExpr: string, task: OpenTaskSubitem, file: TFile | null = null): boolean | null {
    const raw = String(rawExpr || '').trim();
    const isNegated = raw.startsWith('!');
    const expr = (isNegated ? raw.slice(1) : raw).trim();
    const workflowMatch = expr.match(
      /^((?:task\.)?(?:status|checkboxstatus|open|isopen|done|isdone|completed|complete))\b/iu,
    );
    if (
      workflowMatch
      && !this.isRelationalStatusPropertyReference(workflowMatch[1])
      && (task.itemKind === 'bullet' || task.itemKind === 'heading' || !this.getMappedStatusForTask(task))
    ) return false;
    const result = this.evaluatePositiveTaskFilterString(expr, task, file);
    return result == null ? null : isNegated ? !result : result;
  }

  private evaluatePositiveTaskFilterString(expr: string, task: OpenTaskSubitem, file: TFile | null = null): boolean | null {
    if (/^note\.kind\b/i.test(expr)) return false;
    if (hasTpsFormulaReference(expr)) {
      if (!(file instanceof TFile)) {
        this.markFormulaFilterFailure();
        return null;
      }
      const result = this.getTaskFormulaSession(file, task).evaluateExpression(expr, '$filter');
      if (result.status === 'error' || result.status === 'unsupported') {
        this.reportFormulaFailure(result, file, task);
        return null;
      }
      return isTpsFormulaTruthy(result.value);
    }
    const kindMatch = expr.match(/^(?:(?:tps|kanban)\.)?(itemtype|itemkind|kind)\s*(==|=|!=|!==|is|equals?)\s*["']?([^"']+?)["']?$/i);
    if (kindMatch?.[1] && kindMatch[3]) {
      const property = kindMatch[1].toLowerCase();
      const value = kindMatch[3].trim().toLowerCase();
      const matched = property === 'kind'
        ? this.taskMatchesAdditiveKind(task, value)
        : matchesTpsListStructuralKind(value, task.itemKind || 'task', task.headingLevel)
          || value === 'all'
          || value === 'mixed';
      return kindMatch[2].startsWith('!') ? !matched : matched;
    }

    const workflowMatch = expr.match(
      /^((?:task\.)?(?:status|checkboxstatus|open|isopen|done|isdone|completed|complete))\b/iu,
    );
    if (
      (task.itemKind === 'bullet' || task.itemKind === 'heading')
      && workflowMatch
      && !this.isRelationalStatusPropertyReference(workflowMatch[1])
    ) return false;
    const status = this.getMappedStatusForTask(task);
    const hasMappedStatus = !!status;
    const booleanMatch = expr.match(
      /^(?:task\.)?(open|isopen|done|isdone|completed|complete)\s*(==|=|!=|!==|is|equals?)\s*(true|false|1|0)$/i,
    );
    if (booleanMatch) {
      const isOpenProperty = ['open', 'isopen'].includes(booleanMatch[1].toLowerCase());
      const isDone = this.classifyDoneStatus(status);
      if (isDone == null) return false;
      const actual = isOpenProperty
        ? hasMappedStatus && !isDone
        : hasMappedStatus && isDone;
      const expected = ['true', '1'].includes(booleanMatch[3].toLowerCase());
      const matched = actual === expected;
      return booleanMatch[2].startsWith('!') ? !matched : matched;
    }

    if (!isRelationalStatusFilterExpression(expr, this.getGcmSettings()?.properties)) {
      const statusResult = this.evaluateTaskValueFilterExpression(expr, 'status', status ? [status] : [], false);
      if (statusResult != null) return hasMappedStatus ? statusResult : false;
    }
    const tagsResult = this.evaluateTaskValueFilterExpression(expr, 'tags', this.getTaskInlineValues(task, 'tags'), false);
    if (tagsResult != null) return tagsResult;
    const fileResult = this.evaluateTaskFileFilterExpression(expr, file);
    if (fileResult != null) return fileResult;
    return this.evaluateGenericTaskValueFilterExpression(expr, task, file);
  }

  private evaluateTaskValueFilterExpression(expr: string, propName: 'status' | 'tags', rawValues: string[], requireTaskPrefix = false): boolean | null {
    const propPattern = `${requireTaskPrefix ? 'task\\.' : '(?:task\\.)?'}${propName === 'tags' ? '(?:tags|tag)' : 'status'}`;
    const values = new Set(rawValues.map((value) => propName === 'tags' ? this.normalizeTaskTag(value) : String(value || '').trim().toLowerCase()).filter(Boolean));
    const normalizeToken = (token: string) => {
      const resolved = this.resolveBaseContextToken(token) || token;
      return propName === 'tags' ? this.normalizeTaskTag(resolved) : resolved.trim().toLowerCase();
    };
    const containsAnyMatch = expr.match(new RegExp(`^${propPattern}\\.containsAny\\((.*)\\)$`, 'i'));
    if (containsAnyMatch) return this.extractFilterTokens(containsAnyMatch[1] || '').some((token) => values.has(normalizeToken(token)));
    const containsMatch = expr.match(new RegExp(`^${propPattern}\\.contains\\((.*)\\)$`, 'i'));
    if (containsMatch) return this.extractFilterTokens(containsMatch[1] || '').some((token) => values.has(normalizeToken(token)));
    const equalsCallMatch = expr.match(new RegExp(`^${propPattern}\\.equals\\((.*)\\)$`, 'i'));
    if (equalsCallMatch) return this.extractFilterTokens(equalsCallMatch[1] || '').some((token) => values.has(normalizeToken(token)));
    if (new RegExp(`^${propPattern}\\.(?:isEmpty|empty)\\(\\)$`, 'i').test(expr)) return values.size === 0;
    const existsMatch = expr.match(new RegExp(`^${propPattern}\\.(?:exists|isNotEmpty)\\(\\)$`, 'i'));
    if (existsMatch) return values.size > 0;
    const wordOperatorMatch = expr.match(new RegExp(`^${propPattern}\\s+(contains|has|is not empty|is empty|isNotEmpty|exists|empty|is|equals?)\\s*(.*)$`, 'i'));
    if (wordOperatorMatch) {
      const op = wordOperatorMatch[1].trim().toLowerCase().replace(/\s+/g, '');
      if (op === 'isempty' || op === 'empty') return values.size === 0;
      if (op === 'isnotempty' || op === 'exists') return values.size > 0;
      const tokens = this.extractFilterTokens(wordOperatorMatch[2] || '');
      if (op === 'contains' || op === 'has') return tokens.some((token) => values.has(normalizeToken(token)));
      return tokens.some((token) => values.has(normalizeToken(token)));
    }
    const comparisonMatch = expr.match(new RegExp(`^${propPattern}\\s*(==|=|!=|!==|is|equals?)\\s*(?:"([^"]+)"|'([^']+)'|(.+))$`, 'i'));
    if (comparisonMatch?.[2] || comparisonMatch?.[3] || comparisonMatch?.[4]) {
      const matched = values.has(normalizeToken(comparisonMatch[2] || comparisonMatch[3] || comparisonMatch[4]));
      return String(comparisonMatch[1] || '').startsWith('!') ? !matched : matched;
    }
    return null;
  }

  private evaluateGenericTaskValueFilterExpression(expr: string, task: OpenTaskSubitem, file: TFile | null = null): boolean | null {
    const callMatch = expr.match(/^([\w.\s-]+)\.(contains|containsAny|equals)\((.*)\)$/i);
    if (callMatch?.[1]) {
      const values = this.getGenericTaskComparableValues(task, callMatch[1].trim(), file);
      if (values == null) return /^formula\./iu.test(callMatch[1].trim()) ? null : false;
      const tokens = this.extractFilterTokens(callMatch[3] || '').map((value) => value.toLowerCase());
      if (callMatch[2].toLowerCase().includes('contains')) {
        return tokens.some((token) => this.taskValuesContain(callMatch[1].trim(), values, token));
      }
      return tokens.some((token) => this.taskValuesMatch(callMatch[1].trim(), values, token));
    }

    const emptyMatch = expr.match(/^([\w.\s-]+)\.(isEmpty|empty|exists|isNotEmpty)\(\)$/i);
    if (emptyMatch?.[1]) {
      const values = this.getGenericTaskComparableValues(task, emptyMatch[1].trim(), file);
      if (values == null) return /^formula\./iu.test(emptyMatch[1].trim()) ? null : false;
      const op = emptyMatch[2].toLowerCase();
      return op.includes('empty') && !op.includes('not') ? values.length === 0 : values.length > 0;
    }

    const wordOperatorMatch = expr.match(/^([\w.\s-]+)\s+(contains|has|is not empty|is empty|isNotEmpty|exists|empty|is|equals?)\s*(.*)$/i);
    if (wordOperatorMatch?.[1]) {
      const values = this.getGenericTaskComparableValues(task, wordOperatorMatch[1].trim(), file);
      if (values == null) return /^formula\./iu.test(wordOperatorMatch[1].trim()) ? null : false;
      const op = wordOperatorMatch[2].trim().toLowerCase().replace(/\s+/g, '');
      if (op === 'isempty' || op === 'empty') return values.length === 0;
      if (op === 'isnotempty' || op === 'exists') return values.length > 0;
      const tokens = this.extractFilterTokens(wordOperatorMatch[3] || '').map((token) => token.toLowerCase());
      if (op === 'contains' || op === 'has') return tokens.some((token) => this.taskValuesContain(wordOperatorMatch[1].trim(), values, token));
      return tokens.some((token) => this.taskValuesMatch(wordOperatorMatch[1].trim(), values, token));
    }

    const comparisonMatch = expr.match(/^([\w.\s-]+)\s*(==|=|!=|!==|>=|<=|>|<|is|equals?)\s*["']?([^"']+)["']?$/i);
    if (comparisonMatch?.[1]) {
      const values = this.getGenericTaskComparableValues(task, comparisonMatch[1].trim(), file);
      if (values == null) return /^formula\./iu.test(comparisonMatch[1].trim()) ? null : false;
      const token = this.resolveBaseContextToken(comparisonMatch[3]) || comparisonMatch[3];
      const op = String(comparisonMatch[2] || '').toLowerCase();
      if (['>', '>=', '<', '<='].includes(op)) {
        return values.some((value) => {
          const comparison = this.compareTaskFilterValues(value, token);
          return op === '>' ? comparison > 0 : op === '>=' ? comparison >= 0 : op === '<' ? comparison < 0 : comparison <= 0;
        });
      }
      const matched = this.taskValuesMatch(comparisonMatch[1].trim(), values, token);
      return op.startsWith('!') ? !matched : matched;
    }

    return null;
  }

  private getGenericTaskComparableValues(task: OpenTaskSubitem, propRaw: string, file: TFile | null = null): string[] | null {
    const raw = String(propRaw || '').trim();
    const lower = raw.toLowerCase();
    if (!raw || lower.startsWith('note.') || lower.startsWith('file.')) return null;
    if (this.getConfiguredCustomProperty(raw)?.type === 'folder') {
      return [file?.parent?.path || '/'].map((value) => value.toLowerCase());
    }
    if (lower.startsWith('formula.')) {
      if (!(file instanceof TFile)) {
        this.markFormulaFilterFailure();
        return null;
      }
      const result = this.getTaskFormulaSession(file, task).get(raw);
      if (result.status === 'error' || result.status === 'unsupported') {
        this.reportFormulaFailure(result, file, task);
        return null;
      }
      return getTpsFormulaComparableValues(result.value)
        .map((value) => formatTpsFormulaValue(value).trim().toLowerCase())
        .filter(Boolean);
    }
    const prop = raw.replace(/^(?:task|tps|kanban)\./i, '');
    const normalized = this.normalizeTaskPropertyId(raw);
    if (['itemtype', 'itemkind', 'kind', 'open', 'isopen', 'done', 'isdone', 'completed', 'complete'].includes(normalized)) return null;
    if (['title', 'tasktitle', 'text', 'linetext', 'headingtext'].includes(normalized)) {
      return [this.getTaskVisibleTitle(task).toLowerCase()];
    }
    if (['line', 'linenumber', 'taskline', 'headingline'].includes(normalized)) return [String(task.line)];
    if (['level', 'headinglevel'].includes(normalized)) {
      return task.itemKind === 'heading' && task.headingLevel ? [String(task.headingLevel)] : [];
    }
    if (
      ['status', 'checkboxstatus'].includes(normalized)
      && !this.isRelationalStatusPropertyReference(propRaw)
    ) {
      if (task.itemKind === 'heading') return [];
      const status = this.getMappedStatusForTask(task);
      return status ? [status] : null;
    }
    if (['tag', 'tags'].includes(normalized)) {
      return this.getTaskInlineValues(task, 'tags').map((tag) => tag.toLowerCase());
    }
    const configuredProperty = this.getConfiguredCustomProperty(raw);
    const values = this.getTaskInlineValues(task, configuredProperty?.key || prop);
    return (configuredProperty?.type === 'list'
      ? values.flatMap((value) => this.parseConfiguredListValues(configuredProperty, value))
      : values)
      .map((value) => value.toLowerCase());
  }

  private compareTaskFilterValues(left: unknown, right: unknown): number {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (String(left ?? '').trim() && String(right ?? '').trim() && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
    }
    return String(left ?? '').trim().toLowerCase().localeCompare(String(right ?? '').trim().toLowerCase());
  }

  private evaluateTaskFileFilterExpression(expr: string, file: TFile | null): boolean | null {
    const fileTagCall = expr.match(/^file\.tags?\.(containsAny|contains|equals)\((.*)\)$/i);
    if (fileTagCall) {
      const currentTags = new Set(
        this.getTaskFileComparableValues(file, 'file.tags')
          .map((value) => this.normalizeTaskTag(value)),
      );
      const expectedTags = this.extractFilterTokens(fileTagCall[2] || '')
        .map((value) => this.resolveBaseContextToken(value) || value)
        .map((value) => this.normalizeTaskTag(value))
        .filter(Boolean);
      return expectedTags.some((tag) => currentTags.has(tag));
    }
    const folderComparison = expr.match(/^file\.folder\s*(==|=|!=|!==|is|equals?)\s*(?:"([^"]*)"|'([^']*)'|(.+))$/i);
    if (folderComparison) {
      const expected = String(folderComparison[2] ?? folderComparison[3] ?? folderComparison[4] ?? '').trim();
      const isNegated = String(folderComparison[1] || '').startsWith('!');
      const matched = this.taskFileFolderMatches(file, expected, isNegated);
      return isNegated ? !matched : matched;
    }
    if (/^file\.links?\.(?:isEmpty|empty)\(\)$/i.test(expr)) return true;
    if (/^file\.links?\.(?:isNotEmpty|exists)\(\)$/i.test(expr)) return false;
    const propPattern = `(?:(?:task|line|heading)\\.)?(?:path|file|file\\.path)`;
    const quoted = (text: string) => this.extractQuotedStrings(text).map((value) => value.trim().toLowerCase()).filter(Boolean);
    const pathCallMatch = expr.match(new RegExp(`^${propPattern}\\.(contains|startsWith|equals)\\((.*)\\)$`, 'i'));
    if (pathCallMatch) {
      const operator = pathCallMatch[1].toLowerCase();
      const tokens = quoted(pathCallMatch[2] || '').map((token) => this.resolveBaseContextToken(token) || token);
      if (operator === 'startswith') return tokens.some((token) => this.taskFilePathStartsWith(file, token));
      if (operator === 'equals') return tokens.some((token) => this.taskFilePathMatches(file, token));
      const values = file ? [file.path, file.basename, file.name, file.path.replace(/\.md$/i, '')].map((value) => value.toLowerCase()) : [];
      return tokens.some((token) => {
        const normalized = String(token || '').replace(/\.md$/i, '').toLowerCase();
        return values.some((value) => value.includes(String(token || '').toLowerCase()) || value.includes(normalized));
      });
    }
    const comparisonMatch = expr.match(new RegExp(`^${propPattern}\\s*(==|=|!=|!==|is|equals?)\\s*(?:"([^"]+)"|'([^']+)'|(.+))$`, 'i'));
    if (comparisonMatch?.[2] || comparisonMatch?.[3] || comparisonMatch?.[4]) {
      const matched = this.taskFilePathMatches(file, this.resolveBaseContextToken(comparisonMatch[2] || comparisonMatch[3] || comparisonMatch[4]) || '');
      const op = String(comparisonMatch[1] || '').toLowerCase();
      return op.startsWith('!') ? !matched : matched;
    }
    const extensionValues = file ? [file.extension.toLowerCase()] : [];
    const taskFileExtensionPattern = `task\\.file[.\\s-]*(?:extension|ext)`;
    const itemExtensionPattern = `(?:extension|ext|file[.\\s-]*(?:extension|ext)|file[\\s-]+(?:extension|ext))`;
    const extensionCallMatch = expr.match(new RegExp(`^${taskFileExtensionPattern}\\.(contains|equals)\\((.*)\\)$`, 'i'));
    if (extensionCallMatch) {
      const tokens = quoted(extensionCallMatch[2] || '').map((token) => token.replace(/^\./, ''));
      return tokens.some((token) => extensionValues.some((value) => extensionCallMatch[1].toLowerCase() === 'contains' ? value.includes(token) : value === token));
    }
    const fileExtensionComparison = expr.match(new RegExp(`^${taskFileExtensionPattern}\\s*(==|=|!=|!==|is|equals?)\\s*["']?([^"']+)["']?$`, 'i'));
    if (fileExtensionComparison?.[2]) {
      const token = fileExtensionComparison[2].trim().toLowerCase().replace(/^\./, '');
      const matched = extensionValues.includes(token);
      const op = String(fileExtensionComparison[1] || '').toLowerCase();
      return op.startsWith('!') ? !matched : matched;
    }
    const itemExtensionCallMatch = expr.match(new RegExp(`^${itemExtensionPattern}\\.(contains|equals)\\((.*)\\)$`, 'i'));
    if (itemExtensionCallMatch) return false;
    const itemExtensionComparison = expr.match(new RegExp(`^${itemExtensionPattern}\\s*(==|=|!=|!==|is|equals?)\\s*["']?([^"']+)["']?$`, 'i'));
    if (itemExtensionComparison?.[2]) {
      const op = String(itemExtensionComparison[1] || '').toLowerCase();
      return op.startsWith('!');
    }
    return null;
  }

  private taskFilePathMatches(file: TFile | null, rawValue: string): boolean {
    if (!file) return false;
    const needle = String(rawValue || '').trim().replace(/\\/g, '/').toLowerCase();
    if (!needle) return false;
    const withoutExt = needle.replace(/\.md$/i, '');
    return [
      file.path,
      file.basename,
      file.name,
      file.path.replace(/\.md$/i, ''),
    ].some((candidate) => {
      const normalized = String(candidate || '').replace(/\\/g, '/').toLowerCase();
      return normalized === needle || normalized === withoutExt || normalized.endsWith(`/${needle}`) || normalized.endsWith(`/${withoutExt}`);
    });
  }

  private taskFilePathStartsWith(file: TFile | null, rawValue: string): boolean {
    if (!file) return false;
    const needle = String(rawValue || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    if (!needle) return false;
    return String(file.path || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase().startsWith(needle);
  }

  private isPathComparisonOperator(operator: string): boolean {
    const op = String(operator || '').trim().toLowerCase().replace(/\s+/g, '');
    return !op || op === '=' || op === '==' || op === '!=' || op === '!==' || op === 'is' || op === 'equals' || op === 'equal' || op.includes('contains') || op.includes('startswith') || op === 'starts';
  }

  private isStartsWithFilterOperator(operator: string): boolean {
    const op = String(operator || '').trim().toLowerCase().replace(/\s+/g, '');
    return op.includes('startswith') || op === 'starts' || op === '!starts';
  }

  private readFilterObjectProperty(node: Record<string, unknown>): string {
    return String(
      node.property ??
      node.field ??
      node.key ??
      node.column ??
      node.left ??
      node.lhs ??
      node.operand ??
      '',
    ).trim();
  }

  private readFilterObjectOperator(node: Record<string, unknown>): string {
    return String(node.operator ?? node.op ?? node.comparison ?? node.type ?? node.condition ?? '').trim().toLowerCase();
  }

  private readFilterObjectValues(node: Record<string, unknown>): string[] {
    const value =
      node.values ??
      node.value ??
      node.pattern ??
      node.match ??
      node.right ??
      node.rhs ??
      node.target ??
      node.expected ??
      [];
    return this.asArray(value)
      .flatMap((item) => this.extractFilterTokens(String(item ?? '')))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private isNegatedFilterOperator(operator: string): boolean {
    const op = String(operator || '').trim().toLowerCase();
    return op.startsWith('!') || op.includes('not') || op === '!=' || op === '!==';
  }

  private isContainsFilterOperator(operator: string): boolean {
    const op = String(operator || '').trim().toLowerCase().replace(/\s+/g, '');
    return op.includes('contains') || op === 'has';
  }

  private isEmptyFilterOperator(operator: string): boolean {
    const op = String(operator || '').trim().toLowerCase().replace(/\s+/g, '');
    return op === 'empty' || op === 'isempty';
  }

  private isExistsFilterOperator(operator: string): boolean {
    const op = String(operator || '').trim().toLowerCase().replace(/\s+/g, '');
    return op === 'exists' || op === 'isnotempty' || op.includes('exist');
  }

  private isImplicitEmptyValueFilter(operator: string, values: string[]): boolean {
    if (values.length > 0) return false;
    const op = String(operator || '').trim().toLowerCase().replace(/\s+/g, '');
    return !op || op === '=' || op === '==' || op === 'is' || op === 'equals' || op === 'equal';
  }

  private isImplicitNotEmptyValueFilter(operator: string, values: string[]): boolean {
    if (values.length > 0) return false;
    const op = String(operator || '').trim().toLowerCase().replace(/\s+/g, '');
    return op === '!=' || op === '!==' || op === 'isnot' || op === 'not' || op === 'isnotempty';
  }

  private evaluateFormulaFilterObject(
    node: Record<string, unknown>,
    session: TpsFormulaRowSession,
    reportFailure: (result: TpsFormulaResult) => void,
  ): boolean | null {
    const property = this.readFilterObjectProperty(node);
    const formulaResult = session.get(property);
    if (formulaResult.status === 'error' || formulaResult.status === 'unsupported') {
      reportFailure(formulaResult);
      return null;
    }
    const rawExpected = node.values ?? node.value ?? node.expected ?? node.right ?? node.rhs ?? node.target;
    const expected = this.asArray(rawExpected).map((value) => (
      typeof value === 'string'
        ? this.resolveBaseContextToken(value) || value.replace(/^(?:["'])(.*)(?:["'])$/u, '$1')
        : value
    ));
    const values = getTpsFormulaComparableValues(formulaResult.value);
    const operator = this.readFilterObjectOperator(node);
    const normalizedOperator = operator.replace(/[\s_-]+/gu, '');
    const positiveEquality = new Set(['', '=', '==', '===', 'is', 'equal', 'equals']);
    const negativeEquality = new Set(['!=', '!==', 'isnot', 'not', 'notequal', 'notequals', 'doesnotequal']);
    const positiveContains = new Set(['contains', 'containsany', 'has']);
    const negativeContains = new Set(['!contains', 'notcontains', 'doesnotcontain']);
    const positiveExists = new Set(['exists', 'isnotempty']);
    const negativeExists = new Set(['!exists', 'notexists', 'doesnotexist']);
    let matched: boolean | null;
    if (this.isImplicitEmptyValueFilter(operator, expected.map(String)) || this.isEmptyFilterOperator(operator)) {
      matched = values.length === 0;
    } else if (this.isImplicitNotEmptyValueFilter(operator, expected.map(String)) || positiveExists.has(normalizedOperator)) {
      matched = values.length > 0;
    } else if (negativeExists.has(normalizedOperator)) {
      matched = values.length === 0;
    } else if (positiveContains.has(normalizedOperator) || negativeContains.has(normalizedOperator)) {
      matched = expected.some((target) => values.some((current) => (
        Array.isArray(formulaResult.value)
          ? compareTpsFormulaValues(current, target) === 0
          : formatTpsFormulaValue(current).toLocaleLowerCase().includes(formatTpsFormulaValue(target).toLocaleLowerCase())
      )));
      if (negativeContains.has(normalizedOperator)) matched = !matched;
    } else if (['>', '>=', '<', '<='].includes(operator.trim())) {
      matched = expected.some((target) => values.some((current) => {
        const comparison = compareTpsFormulaValues(current, target);
        return operator.trim() === '>'
          ? comparison > 0
          : operator.trim() === '>='
            ? comparison >= 0
            : operator.trim() === '<'
              ? comparison < 0
              : comparison <= 0;
      }));
    } else if (positiveEquality.has(normalizedOperator) || negativeEquality.has(normalizedOperator)) {
      matched = expected.some((target) => values.some((current) => compareTpsFormulaValues(current, target) === 0));
      if (negativeEquality.has(normalizedOperator)) matched = !matched;
    } else {
      reportFailure({
        status: 'unsupported',
        value: null,
        formula: property.replace(/^formula\./iu, ''),
        code: 'unsupported-formula-filter-operator',
        message: `Unsupported formula filter operator: ${operator || '(empty)'}`,
      });
      return null;
    }
    return matched;
  }

  private evaluateTaskFilterObject(node: Record<string, unknown>, task: OpenTaskSubitem, file: TFile | null = null): boolean | null {
    const propRaw = this.readFilterObjectProperty(node);
    if (!propRaw) return null;
    if (/^formula\./iu.test(propRaw)) {
      if (!(file instanceof TFile)) {
        this.markFormulaFilterFailure();
        return null;
      }
      return this.evaluateFormulaFilterObject(node, this.getTaskFormulaSession(file, task), (failure) => {
        this.reportFormulaFailure(failure, file, task);
      });
    }
    const normalizedProp = this.normalizeTaskPropertyId(propRaw);
    const operator = this.readFilterObjectOperator(node);
    const values = this.readFilterObjectValues(node).map((value) => this.resolveBaseContextToken(value) || value);
    const isNegated = this.isNegatedFilterOperator(operator);
    let result: boolean | null = null;

    if (propRaw.toLowerCase() === 'note.kind') return false;
    if (['itemtype', 'itemkind', 'kind'].includes(normalizedProp)) {
      result = values.some((value) => {
        const normalized = value.toLowerCase();
        return normalizedProp === 'kind'
          ? this.taskMatchesAdditiveKind(task, normalized)
          : matchesTpsListStructuralKind(normalized, task.itemKind || 'task', task.headingLevel)
            || normalized === 'all'
            || normalized === 'mixed';
      });
    } else if (['open', 'isopen', 'done', 'isdone', 'completed', 'complete'].includes(normalizedProp)) {
      if (task.itemKind === 'bullet' || task.itemKind === 'heading') return false;
      const status = this.getMappedStatusForTask(task);
      if (!status) return false;
      const isDone = this.classifyDoneStatus(status);
      if (isDone == null) return false;
      const isOpen = !isDone;
      const actual = ['open', 'isopen'].includes(normalizedProp) ? isOpen : !isOpen;
      const expected = values.find((value) => ['true', 'false', '1', '0'].includes(value.toLowerCase()));
      result = expected == null ? null : actual === ['true', '1'].includes(expected.toLowerCase());
    } else if (
      (propRaw.toLowerCase().startsWith('task.') || normalizedProp === 'status' || normalizedProp === 'checkboxstatus')
      && ['status', 'checkboxstatus'].includes(normalizedProp)
      && !this.isRelationalStatusPropertyReference(propRaw)
    ) {
      if (task.itemKind === 'bullet' || task.itemKind === 'heading') return false;
      const status = this.getMappedStatusForTask(task);
      if (!status) return false;
      if (this.isImplicitEmptyValueFilter(operator, values)) {
        result = false;
      } else if (this.isImplicitNotEmptyValueFilter(operator, values)) {
        result = true;
      } else {
        result = values.some((value) => value.toLowerCase() === status);
      }
    } else if (!propRaw.toLowerCase().startsWith('note.') && ['tag', 'tags'].includes(normalizedProp)) {
      const tags = new Set(this.getTaskInlineValues(task, 'tags').map((tag) => this.normalizeTaskTag(tag)));
      if (this.isImplicitEmptyValueFilter(operator, values)) {
        result = tags.size === 0;
      } else if (this.isImplicitNotEmptyValueFilter(operator, values)) {
        result = tags.size > 0;
      } else if (this.isEmptyFilterOperator(operator) || this.isExistsFilterOperator(operator)) {
        result = this.isEmptyFilterOperator(operator) ? tags.size === 0 : tags.size > 0;
      } else {
        result = values.some((value) => tags.has(this.normalizeTaskTag(value)));
      }
    } else if (propRaw.toLowerCase() === 'task.file.extension' || propRaw.toLowerCase() === 'task.file.ext') {
      result = values.some((value) => !!file && value.toLowerCase().replace(/^\./, '') === file.extension.toLowerCase());
    } else if (['extension', 'ext', 'fileextension', 'fileext'].includes(normalizedProp) || propRaw.toLowerCase() === 'file.extension' || propRaw.toLowerCase() === 'file.ext') {
      result = false;
    } else if (['path', 'file', 'filepath'].includes(normalizedProp)
      || ['file.path', 'task.file.path', 'line.path', 'heading.path'].includes(propRaw.toLowerCase())) {
      if (!this.isPathComparisonOperator(operator)) return null;
      if (this.isStartsWithFilterOperator(operator)) {
        result = values.some((value) => this.taskFilePathStartsWith(file, value));
      } else if (this.isContainsFilterOperator(operator)) {
        result = values.some((value) => {
          const token = String(value || '').trim().toLowerCase();
          return !!file && [file.path, file.basename, file.name].some((candidate) => String(candidate || '').toLowerCase().includes(token));
        });
      } else {
        result = values.some((value) => this.taskFilePathMatches(file, value));
      }
    } else if (/^file\.tags?$/i.test(propRaw)) {
      const tags = new Set(
        this.getTaskFileComparableValues(file, propRaw)
          .map((value) => this.normalizeTaskTag(value)),
      );
      if (this.isImplicitEmptyValueFilter(operator, values)) {
        result = tags.size === 0;
      } else if (this.isImplicitNotEmptyValueFilter(operator, values)) {
        result = tags.size > 0;
      } else if (this.isEmptyFilterOperator(operator) || this.isExistsFilterOperator(operator)) {
        result = this.isEmptyFilterOperator(operator) ? tags.size === 0 : tags.size > 0;
      } else {
        result = values.some((value) => tags.has(this.normalizeTaskTag(value)));
      }
    } else if (propRaw.toLowerCase().startsWith('file.') || ['folder', 'folderpath', 'name', 'basename'].includes(normalizedProp)) {
      const currentValues = this.getTaskFileComparableValues(file, propRaw);
      if (this.isImplicitEmptyValueFilter(operator, values) || this.isEmptyFilterOperator(operator)) {
        result = currentValues.length === 0;
      } else if (this.isImplicitNotEmptyValueFilter(operator, values) || this.isExistsFilterOperator(operator)) {
        result = currentValues.length > 0;
      } else if (this.isContainsFilterOperator(operator)) {
        result = values.some((value) => this.taskValuesContain(propRaw, currentValues, value));
      } else if (
        (propRaw.toLowerCase() === 'file.folder' || ['folder', 'folderpath'].includes(normalizedProp))
        && ['!=', '!==', 'isnot', 'notequal', 'notequals', 'doesnotequal'].includes(operator.replace(/\s+/g, ''))
      ) {
        result = values.some((value) => this.taskFileFolderMatches(file, value, true));
      } else {
        result = values.some((value) => this.taskValuesMatch(propRaw, currentValues, value));
      }
    } else {
      const currentValues = this.getGenericTaskComparableValues(task, propRaw, file);
      if (currentValues == null) {
        result = null;
      } else if (this.isImplicitEmptyValueFilter(operator, values)) {
        result = currentValues.length === 0;
      } else if (this.isImplicitNotEmptyValueFilter(operator, values)) {
        result = currentValues.length > 0;
      } else if (this.isEmptyFilterOperator(operator)) {
        result = currentValues.length === 0;
      } else if (this.isExistsFilterOperator(operator)) {
        result = currentValues.length > 0;
      } else if (this.isContainsFilterOperator(operator)) {
        result = values.some((value) => this.taskValuesContain(propRaw, currentValues, value));
      } else if (['>', '>=', '<', '<='].includes(operator.trim())) {
        result = values.some((value) => currentValues.some((current) => {
          const comparison = this.compareTaskFilterValues(current, value);
          return operator.trim() === '>'
            ? comparison > 0
            : operator.trim() === '>='
              ? comparison >= 0
              : operator.trim() === '<'
                ? comparison < 0
                : comparison <= 0;
        }));
      } else {
        result = values.some((value) => this.taskValuesMatch(propRaw, currentValues, value));
      }
    }

    return result == null ? null : isNegated ? !result : result;
  }

  private getTaskFileComparableValues(file: TFile | null, propRaw: string): string[] {
    if (!file) return [];
    const prop = String(propRaw || '').trim().toLowerCase().replace(/^file\./, '');
    if (prop === 'folder' || prop === 'folderpath') return file.parent?.path ? [file.parent.path.toLowerCase()] : [];
    if (prop === 'name') return [file.name.toLowerCase()];
    if (prop === 'basename') return [file.basename.toLowerCase()];
    if (prop === 'path') return [file.path.toLowerCase()];
    if (prop === 'extension' || prop === 'ext') return [file.extension.toLowerCase()];
    if (prop === 'tag' || prop === 'tags') {
      const cache = this.app.metadataCache.getFileCache(file) as any;
      const frontmatterTags = this.asArray(cache?.frontmatter?.tags);
      const inlineTags = this.asArray(cache?.tags).map((tag: any) => tag?.tag ?? tag);
      return parseTaskTagValues([...frontmatterTags, ...inlineTags]);
    }
    if (prop === 'links' || prop === 'link') {
      // TPS task rows are synthesized Base records. Their source note is
      // exposed separately through file.name/path/folder, but the task record
      // itself has no file-links collection.
      return [];
    }
    const cache = this.app.metadataCache.getFileCache(file) as any;
    const rawValue = cache?.frontmatter?.[propRaw.slice(5)] ?? cache?.frontmatter?.[prop];
    return this.asArray(rawValue).map((value) => String(value ?? '').trim().toLowerCase()).filter(Boolean);
  }

  private taskFileFolderMatches(file: TFile | null, rawValue: string, includeDescendants = false): boolean {
    if (!file) return false;
    const expected = String(rawValue || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
    if (!expected) return false;
    const actual = String(file.parent?.path || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
    return actual === expected || (includeDescendants && actual.startsWith(`${expected}/`));
  }

  private getTaskLaneIds(
    task: OpenTaskSubitem,
    propName: string | null,
    file: TFile | null = null,
  ): string[] {
    const propId = this.getGroupByPropId(propName) ?? propName;
    if (propId && this.getConfiguredCustomProperty(propId)?.type === 'folder') {
      return [getTpsBaseGroupLaneId(file?.parent?.path || '/')];
    }
    if (isSourceNoteGroupProperty(propId)) {
      const sourceNoteValue = getSourceNoteGroupValue(file, propId);
      return [getTpsBaseGroupLaneId(sourceNoteValue)];
    }
    if (/^formula\./iu.test(String(propId || '').trim())) {
      if (!(file instanceof TFile)) return ['ungrouped'];
      const result = this.getTaskFormulaSession(file, task).get(String(propId));
      if (result.status === 'error' || result.status === 'unsupported') {
        this.reportFormulaFailure(result, file, task);
        return ['ungrouped'];
      }
      const values = getTpsBaseGroupValues(
        result.value,
        this.getOrderingSemantics(String(propId)),
        this.getMultiValueGroupingMode(),
      );
      return values.length
        ? Array.from(new Set(values.map((value) => getTpsBaseGroupLaneId(value))))
        : ['ungrouped'];
    }
    const normalized = this.normalizeTaskPropertyId(String(propId || propName || ''));
    const inlinePropertyKey = this.getConfiguredCustomProperty(String(propId || propName || ''))?.key
      || this.getTaskInlinePropertyName(propName);
    if (this.isStatusPropertyName(propName)) {
      if (task.itemKind !== 'task') return ['ungrouped'];
      const status = this.getMappedStatusForTask(task);
      return status ? [this.getLaneIdForStatus(status)] : ['ungrouped'];
    }
    const semanticValues = normalized === 'kind'
      ? getTpsBaseAdditiveKindValues(
          task.itemKind === 'heading' ? `h${task.headingLevel || 1}` : task.itemKind || 'task',
          this.getTaskExplicitKindValues(task),
        )
      : normalized === 'itemkind' || normalized === 'itemtype'
        ? [task.itemKind === 'heading' ? `h${task.headingLevel || 1}` : task.itemKind || 'task']
        : normalized === 'explicitkind' || normalized === 'entitykind'
          ? this.getTaskExplicitKindValues(task)
          : ['title', 'text', 'linetext', 'headingtext'].includes(normalized)
            ? [this.getTaskVisibleTitle(task)]
            : ['line', 'linenumber', 'taskline', 'headingline'].includes(normalized)
              ? [String(task.line)]
              : ['level', 'headinglevel'].includes(normalized)
                ? task.itemKind === 'heading' && task.headingLevel ? [String(task.headingLevel)] : []
                : this.getTaskInlineValues(task, inlinePropertyKey);
    const values = semanticValues
      .map((value) => normalized === 'scheduled' ? this.normalizeScheduledLaneValue(value) : value);
    if (!values.length) return ['ungrouped'];
    const groupedValues = getTpsBaseGroupValues(
      values,
      this.getOrderingSemantics(String(propId || propName || '')),
      this.getMultiValueGroupingMode(),
    );
    return groupedValues.length
      ? Array.from(new Set(groupedValues.map((value) => getTpsBaseGroupLaneId(value))))
      : ['ungrouped'];
  }

  private getUngroupedPosition(): 'first' | 'last' {
    const configured = String(this.getConfigValue('ungroupedPosition') || '').trim().toLowerCase();
    if (configured === 'first' || configured === 'last') return configured;
    return this.plugin.settings.ungroupedPosition === 'first' ? 'first' : 'last';
  }

  private getMultiValueGroupingMode(): TpsBaseMultiValueGroupingMode {
    return resolveTpsBaseMultiValueGroupingMode(this.getConfigValue('multiValueGrouping'));
  }

  private normalizeScheduledLaneValue(value: string): string {
    const raw = String(value || '').trim();
    const day = this.extractDateDay(raw);
    if (!day) return raw;
    const contextScheduled = this.getBaseContextFrontmatterValue('scheduled');
    const contextDay = this.extractDateDay(contextScheduled || '');
    if (contextDay && contextDay === day && contextScheduled) return contextScheduled;
    return `${day} 00:00:00`;
  }

  private extractDateDay(value: string): string | null {
    const raw = String(value || '').trim();
    const match = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/u);
    return match?.[1] ?? null;
  }

  private taskValuesMatch(propRaw: string, currentValues: string[], expectedValue: string): boolean {
    const normalizedProp = this.normalizeInlinePropertyKey(this.getTaskInlinePropertyName(propRaw));
    const expected = String(expectedValue || '').trim().toLowerCase();
    if (normalizedProp === 'scheduled') {
      const expectedDay = this.extractDateDay(expected);
      if (expectedDay) {
        return currentValues.some((current) => this.extractDateDay(current) === expectedDay);
      }
    }
    return currentValues.some((current) => String(current || '').trim().toLowerCase() === expected);
  }

  private taskValuesContain(propRaw: string, currentValues: string[], expectedValue: string): boolean {
    const normalizedProp = this.normalizeInlinePropertyKey(this.getTaskInlinePropertyName(propRaw));
    const expected = String(expectedValue || '').trim().toLowerCase();
    if (normalizedProp === 'scheduled') return this.taskValuesMatch(propRaw, currentValues, expected);
    if (this.getConfiguredCustomProperty(propRaw)?.type === 'list') {
      return this.taskValuesMatch(propRaw, currentValues, expected);
    }
    return currentValues.some((current) => String(current || '').trim().toLowerCase().includes(expected));
  }

  private getTaskInlineValues(task: OpenTaskSubitem, propName: string): string[] {
    const identity = normalizePropertyKeyIdentity(this.getTaskInlinePropertyName(propName));
    const semantic = this.normalizeInlinePropertyKey(this.getTaskInlinePropertyName(propName));
    const values: string[] = semantic === 'tags'
      ? readTaskLineTags(task.text).map((tag) => this.normalizeTaskTag(tag))
      : collectPropertyValuesByKey(task.inlineFields, identity);
    if (semantic === 'tags') {
      for (const field of task.inlineFields ?? []) {
        const key = normalizePropertyKeyIdentity(field.key);
        if (key === 'tag' || key === 'tags') {
          values.push(...parseTaskTagValues(field.value).map((tag) => this.normalizeTaskTag(tag)));
        }
      }
    }
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  }

  private getTaskExplicitKindValues(task: OpenTaskSubitem): string[] {
    return Array.from(new Set(
      this.getTaskInlineValues(task, 'kind')
        .flatMap((value) => {
          const parsed = parseStringListInput(value);
          return parsed.length ? parsed : [value];
        })
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ));
  }

  private normalizeAdditiveKindIdentity(value: unknown): string {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'tasks') return 'task';
    if (normalized === 'bullets') return 'bullet';
    if (normalized === 'notes') return 'note';
    return normalized;
  }

  private taskMatchesAdditiveKind(task: OpenTaskSubitem, rawValue: unknown): boolean {
    const value = String(rawValue ?? '').trim().toLowerCase();
    if (!value) return false;
    if (value === 'all' || value === 'mixed') return true;
    if (matchesTpsListStructuralKind(value, task.itemKind || 'task', task.headingLevel)) return true;
    return this.getTaskExplicitKindValues(task)
      .some((candidate) => candidate.toLowerCase() === value);
  }

  private getTaskFormulaSession(file: TFile, task: OpenTaskSubitem): TpsFormulaRowSession {
    const cached = this.taskFormulaSessions.get(task);
    if (cached) return cached;
    const session = tpsBaseFormulaService.createSession(
      this.getActiveFormulaSet(),
      this.createTaskFormulaContext(file, task),
    );
    this.taskFormulaSessions.set(task, session);
    return session;
  }

  private createTaskFormulaContext(file: TFile, task: OpenTaskSubitem): TpsFormulaRecordContext {
    const cache = this.app.metadataCache.getFileCache(file) as any;
    const note = (cache?.frontmatter || {}) as Record<string, unknown>;
    const fileContext = this.createFormulaFileContext(file);
    const inline: Record<string, unknown> = {};
    const inlineGroups = new Map<string, { aliases: Set<string>; values: string[] }>();
    for (const field of task.inlineFields ?? []) {
      const key = String(field.key || '').trim();
      if (!key) continue;
      const normalized = normalizePropertyKeyIdentity(key);
      if (!normalized) continue;
      const group = inlineGroups.get(normalized) ?? { aliases: new Set<string>(), values: [] };
      group.aliases.add(key);
      // Blank is a real inline value. Formulas can distinguish it from a
      // missing field with isEmpty()/isNull() instead of TPS dropping it.
      group.values.push(String(field.value ?? '').trim());
      inlineGroups.set(normalized, group);
    }
    for (const [normalized, group] of inlineGroups) {
      const aggregate: unknown = group.values.length > 1 ? [...group.values] : group.values[0] ?? '';
      inline[normalized] = aggregate;
      for (const alias of group.aliases) inline[alias] = aggregate;
    }
    const itemKind = task.itemKind === 'heading'
      ? `h${task.headingLevel || 1}`
      : task.itemKind === 'bullet'
        ? 'bullet'
        : 'task';
    const title = this.getTaskVisibleTitle(task);
    const tags = Array.from(new Set([
      ...readTaskLineTags(task.text),
      ...this.getTaskInlineValues(task, 'tags'),
    ].map((tag) => tag.startsWith('#') ? tag : `#${tag}`)));
    const isTask = itemKind === 'task';
    const mappedCheckboxState = isTask ? this.getMappedCheckboxStateForTask(task) : '';
    const status = mappedCheckboxState ? this.getStatusForCheckboxState(mappedCheckboxState) : '';
    const hasMappedStatus = isTask && !!status;
    const doneClassification = hasMappedStatus ? this.classifyDoneStatus(status) : null;
    const hasCompletionClassification = doneClassification != null;
    const done = doneClassification === true;
    const rowInline = { ...inline };
    for (const key of Object.keys(rowInline)) {
      if (['checkboxstate', 'checkboxstatus', 'open', 'isopen', 'done', 'isdone', 'completed', 'complete'].includes(
        this.normalizeInlinePropertyKey(key),
      )) delete rowInline[key];
    }
    const explicitKinds = this.getTaskExplicitKindValues(task);
    const kinds = Array.from(new Set(
      [itemKind, ...explicitKinds]
        .map((value) => this.normalizeAdditiveKindIdentity(value))
        .filter(Boolean),
    ));
    const row: Record<string, unknown> = {
      ...rowInline,
      kind: itemKind,
      itemKind,
      itemType: itemKind,
      explicitKind: explicitKinds.length > 1 ? explicitKinds : explicitKinds[0] ?? null,
      kinds,
      title,
      text: title,
      line: task.line,
      lineNumber: task.line,
      path: file.path,
      tags,
      ...(hasMappedStatus ? {
        checkboxState: mappedCheckboxState,
        checkboxStatus: status,
        ...(hasCompletionClassification ? {
          open: !done,
          isOpen: !done,
          done,
          completed: done,
        } : {}),
      } : {}),
    };
    const taskRow = { ...row };
    delete taskRow.status;
    const lineContext = {
      ...row,
      number: task.line,
      raw: task.rawLine ?? task.text,
      file: fileContext,
    };
    return {
      row,
      note,
      file: fileContext,
      thisValue: this.createFormulaThisValue(),
      line: lineContext,
      task: isTask ? {
        ...taskRow,
        ...(hasMappedStatus ? {
          status,
          checkboxState: mappedCheckboxState,
          checkboxStatus: status,
          ...(hasCompletionClassification ? {
            open: !done,
            isOpen: !done,
            done,
            completed: done,
          } : {}),
        } : {}),
        tags,
        file: fileContext,
      } : null,
      heading: task.itemKind === 'heading' ? {
        ...row,
        level: task.headingLevel || 1,
        file: fileContext,
      } : null,
      now: this.formulaNow,
    };
  }

  private createFormulaFileContext(file: TFile): TpsFormulaRecordContext['file'] {
    const cacheKey = `${file.path}:${Number(file.stat?.mtime || 0)}`;
    const contexts = this.formulaFileContexts ??= new Map<string, NonNullable<TpsFormulaRecordContext['file']>>();
    const cachedContext = contexts.get(cacheKey);
    if (cachedContext) return cachedContext;
    const cache = this.app.metadataCache.getFileCache(file) as any;
    const properties = (cache?.frontmatter || {}) as Record<string, unknown>;
    const tags = parseTaskTagValues([
      this.asArray(properties.tags),
      this.asArray(cache?.tags).map((tag: any) => tag?.tag ?? tag),
    ]);
    const context: NonNullable<TpsFormulaRecordContext['file']> = {
      path: file.path,
      name: file.name,
      basename: file.basename,
      extension: file.extension,
      folder: file.parent?.path || '',
      size: Number(file.stat?.size || 0),
      ctime: Number(file.stat?.ctime || 0),
      mtime: Number(file.stat?.mtime || 0),
      tags,
      links: this.asArray(cache?.links).map((link: any) => link?.link ?? link),
      properties,
    };
    contexts.set(cacheKey, context);
    return context;
  }

  private createFormulaThisValue(): Record<string, unknown> | null {
    if (this.formulaThisValue !== undefined) return this.formulaThisValue;
    const contextFile = this.getBaseContextFile() ?? this.getBaseFile();
    if (!(contextFile instanceof TFile)) {
      this.formulaThisValue = null;
      return null;
    }
    const frontmatter = (this.app.metadataCache.getFileCache(contextFile)?.frontmatter || {}) as Record<string, unknown>;
    const scheduled = this.getBaseContextFrontmatterValue('scheduled');
    this.formulaThisValue = {
      ...frontmatter,
      ...(scheduled ? { scheduled, date: scheduled } : {}),
      file: this.createFormulaFileContext(contextFile),
    };
    return this.formulaThisValue;
  }

  private reportFormulaFailure(result: TpsFormulaResult, file: TFile, task?: OpenTaskSubitem): void {
    this.markFormulaFilterFailure();
    const key = `${this.getActiveFormulaSet().revision}:${result.formula}:${result.code || result.status}`;
    this.formulaDiagnostics ??= new Set<string>();
    if (this.formulaDiagnostics.has(key)) return;
    this.formulaDiagnostics.add(key);
    flowWarn('TpsListView', 'formula:evaluation-failed', {
      base: this.getBaseSourcePath(),
      viewName: this.getConfiguredBaseViewName(),
      formula: result.formula,
      code: result.code || result.status,
      message: result.message || '',
      samplePath: file.path,
      sampleLine: task?.line ?? null,
    });
  }

  private markFormulaFilterFailure(): void {
    this.formulaFilterFailureSequence = (this.formulaFilterFailureSequence ?? 0) + 1;
  }

  private normalizeTaskTag(value: string): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return trimmed.startsWith('#') ? trimmed.toLowerCase() : `#${trimmed.toLowerCase()}`;
  }

  private getParentLinkKeys(): string[] {
    const gcmKeys = this.getGcmServices()?.parents?.getParentKeys?.();
    if (Array.isArray(gcmKeys) && gcmKeys.length > 0) {
      return gcmKeys.map((key: unknown) => String(key || '').trim()).filter(Boolean);
    }

    const keys = new Set<string>();
    for (const settings of this.getRelationshipSettingsSources()) {
      const configured = String(
        settings?.parentLinkFrontmatterKey
        ?? settings?.parentLinkKey
        ?? '',
      ).trim();
      if (configured) keys.add(configured);
    }
    keys.add('childOf');
    keys.add('parent');
    return Array.from(keys);
  }

  /** Returns null when GCM cannot provide an authoritative completion snapshot. */
  private getAuthoritativeDoneStatuses(): Set<string> | null {
    const statusService = this.getGcmServices()?.status;
    if (typeof statusService?.getDoneStatuses !== 'function') return null;
    const gcmDoneStatuses = statusService.getDoneStatuses();
    if (!Array.isArray(gcmDoneStatuses)) return null;
    return new Set(gcmDoneStatuses.map((status: unknown) => this.normalizeTaskStatus(status)).filter(Boolean));
  }

  /** Returns only the authoritative done statuses exposed by GCM. */
  private getDoneStatuses(): Set<string> {
    return this.getAuthoritativeDoneStatuses() ?? new Set();
  }

  private classifyDoneStatus(rawStatus: unknown): boolean | null {
    const status = this.normalizeTaskStatus(rawStatus);
    if (!status) return null;
    const doneStatuses = this.getAuthoritativeDoneStatuses();
    return doneStatuses ? doneStatuses.has(status) : null;
  }

  private getDefaultMappedTaskStatus(kind: 'open' | 'done'): string | null {
    const doneStatuses = this.getAuthoritativeDoneStatuses();
    if (!doneStatuses) return null;
    for (const mapping of this.getGcmCheckboxMappings()) {
      for (const rawStatus of mapping.statuses) {
        const status = this.normalizeTaskStatus(rawStatus);
        if (status && (kind === 'done') === doneStatuses.has(status)) return status;
      }
    }
    return null;
  }

  private async applyInlineTaskProperty(
    file: TFile,
    line: number,
    propName: string,
    value: string | null,
    sourceLaneValues: string[] = [],
  ): Promise<void> {
    const plan = await this.buildTaskDropPlan(file, line, propName, value, sourceLaneValues);
    const blockingError = plan.targetError ?? plan.mappingError;
    if (blockingError) {
      flowWarn('TaskDrop', 'blocked', {
        reason: plan.targetError ? 'stale-source-revision' : 'unmapped-status',
        error: blockingError,
        path: file.path,
        line,
        propName,
        value,
      });
      new Notice(blockingError);
      return;
    }
    await this.applyInlineTaskDropPlan(file, line, propName, value, sourceLaneValues, {
      filterTags: plan.filterTags,
      filterStatus: plan.filterStatus,
      currentLine: plan.currentLine,
      nextLine: plan.nextLine,
    });
  }

  private async confirmAndApplyInlineTaskDrop(
    file: TFile,
    line: number,
    propName: string,
    value: string | null,
    sourceLaneValues: string[] = [],
    expectedRawLine = '',
  ): Promise<boolean> {
    const plan = await this.buildTaskDropPlan(
      file,
      line,
      propName,
      value,
      sourceLaneValues,
      expectedRawLine,
    );
    const blockingError = plan.targetError ?? plan.mappingError;
    if (blockingError) {
      flowWarn('TaskDrop', 'blocked', {
        reason: plan.targetError ? 'stale-source-revision' : 'unmapped-status',
        error: blockingError,
        path: file.path,
        line,
        propName,
        value,
      });
      new Notice(blockingError);
      return false;
    }
    if (!plan.changes.length) {
      flowWarn('TaskDrop', 'no-change', {
        reason: 'empty-plan',
        path: file.path,
        line,
        propName,
        value,
      });
      new Notice('No line-item changes were inferred for this drop.');
      return false;
    }
    if (plan.nextLine === plan.currentLine) {
      flowWarn('TaskDrop', 'no-change', {
        reason: 'same-line',
        path: file.path,
        line,
        propName,
        value,
        itemKind: plan.itemKind,
      });
      new Notice(`No ${plan.itemKind} changes were inferred for this drop.`);
      return false;
    }
    flow('TaskDrop', 'confirm:start', {
      path: file.path,
      line,
      propName,
      value,
      itemKind: plan.itemKind,
      changeCount: plan.changes.length,
    });
    const confirmed = await this.confirmTaskDrop(plan.changes);
    if (!confirmed) {
      flow('TaskDrop', 'confirm:cancelled', {
        path: file.path,
        line,
        propName,
        value,
        itemKind: plan.itemKind,
      });
      return false;
    }
    return this.applyInlineTaskDropPlan(file, line, propName, value, sourceLaneValues, plan);
  }

  private async buildTaskDropPlan(
    file: TFile,
    line: number,
    propName: string,
    value: string | null,
    sourceLaneValues: string[] = [],
    expectedRawLine = '',
  ): Promise<TaskDropPlan> {
    const filter = this.getTaskRootFilterFromBaseFilters();
    const filterTags = Array.from(filter.tags).filter((tag) => !filter.excludeTags.has(tag));
    const normalizedProp = this.normalizeInlinePropertyKey(propName);
    const filterStatus = !this.isStatusPropertyName(propName) && filter.statuses.size === 1
      ? Array.from(filter.statuses)[0] ?? null
      : null;
    const changes: string[] = [];
    const displayValue = value == null || value === '' ? '(empty)' : String(value);
    const targetLine = Math.max(1, Math.floor(Number(line || 1)));
    const content = await this.app.vault.cachedRead(file);
    const parts = splitLineItemContent(content);
    const expectedSourceRevision = String(expectedRawLine || '');
    const preferredIndex = targetLine - 1;
    const resolvedIndex = expectedSourceRevision
      ? resolveExactLineRevisionIndex(parts.lines, preferredIndex, expectedSourceRevision)
      : preferredIndex;
    const targetError = expectedSourceRevision && resolvedIndex < 0
      ? 'Could not move this line item because its source revision changed or is no longer unique. Refresh the view and try again.'
      : null;
    const resolvedTargetLine = resolvedIndex >= 0 ? resolvedIndex + 1 : targetLine;
    const currentLine = parts.lines[resolvedIndex] ?? '';
    const parsedLine = this.parseLineItem(currentLine, true);
    const itemKind = parsedLine?.itemKind ?? 'task';
    const requestsStatusChange = this.isStatusPropertyName(propName) && itemKind !== 'bullet';
    const statusValue = requestsStatusChange ? String(value ?? '').trim() : null;
    const statusCheckboxState = requestsStatusChange
      ? this.getCheckboxStateForStatus(statusValue)
      : null;
    const filterCheckboxState = filterStatus && itemKind !== 'bullet'
      ? this.getCheckboxStateForStatus(filterStatus)
      : null;
    const mappingError = requestsStatusChange && !statusCheckboxState
      ? `Could not move this task: no checkbox mapping exists for status "${statusValue || '(empty)'}".`
      : filterStatus && itemKind !== 'bullet' && !filterCheckboxState
        ? `Could not move this task: no checkbox mapping exists for Base status "${filterStatus}".`
        : null;
    let nextLine = currentLine;

    if (this.isStatusPropertyName(propName)) {
      if (itemKind === 'bullet') {
        changes.push('Leave status unchanged because bullets do not have checkbox status.');
      } else {
        changes.push(`Set checkbox state for status "${displayValue}"${statusCheckboxState ? ` to ${statusCheckboxState}` : ''}.`);
      }
    } else if (normalizedProp === 'tags') {
      changes.push(`Move task tag lane to #${this.normalizeWritableTaskTag(String(value ?? '')) || displayValue}.`);
      const removed = sourceLaneValues
        .map((sourceValue) => this.normalizeWritableTaskTag(sourceValue))
        .filter(Boolean);
      if (removed.length) changes.push(`Remove previous lane tag(s): ${removed.map((tag) => `#${tag}`).join(', ')}.`);
    } else {
      changes.push(`Set inline field [${propName}:: ${displayValue}].`);
    }

    for (const tag of filterTags) {
      if (normalizedProp === 'tags' && this.normalizeTaskTag(String(value ?? '')) === tag) continue;
      const displayTag = tag.startsWith('#') ? tag : `#${tag}`;
      changes.push(`Add Base filter tag ${displayTag}.`);
    }
    if (filterStatus && itemKind !== 'bullet') {
      changes.push(`Set checkbox state for Base status filter "${filterStatus}"${filterCheckboxState ? ` to ${filterCheckboxState}` : ''}.`);
    } else if (filterStatus && itemKind === 'bullet') {
      changes.push(`Base status filter "${filterStatus}" applies to tasks only; bullet status will remain empty.`);
    } else if (!this.isStatusPropertyName(propName) && filter.statuses.size > 1) {
      changes.push(`Base allows multiple statuses (${Array.from(filter.statuses).join(', ')}), so status will not be guessed.`);
    }
    nextLine = targetError || mappingError
      ? currentLine
      : buildKanbanTaskDropLine({
          line: currentLine,
          propName,
          value,
          sourceLaneValues,
          filterTags,
          statusCheckboxState,
          filterCheckboxState,
          statusFieldKeysToRemove: this.getWorkflowStatusFieldKeysToClear(),
          configuredProperty: this.getConfiguredCustomProperty(propName),
          isStatusPropertyName: (name) => this.isStatusPropertyName(name),
        });

    changes.unshift(`${itemKind === 'bullet' ? 'Bullet' : 'Task'}: ${file.path}:${resolvedTargetLine}`);
    changes.push(`Current line: ${currentLine}`);
    changes.push(`Result line: ${nextLine}`);
    return {
      changes,
      filterTags,
      filterStatus: itemKind === 'bullet' ? null : filterStatus,
      targetError,
      mappingError,
      currentLine,
      nextLine,
      itemKind,
    };
  }

  private confirmTaskDrop(changes: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      new TaskDropConfirmModal(this.app, 'Apply task drop changes?', changes, resolve).open();
    });
  }

  private async applyInlineTaskDropPlan(
    file: TFile,
    line: number,
    propName: string,
    value: string | null,
    sourceLaneValues: string[] = [],
    plan: Pick<TaskDropPlan, 'filterTags' | 'filterStatus' | 'currentLine' | 'nextLine'>,
  ): Promise<boolean> {
    const targetLine = Math.max(1, Math.floor(Number(line || 1)));
    const mutation: { outcome: 'changed' | 'unchanged' | 'stale' } = { outcome: 'unchanged' };
    let resolvedLine = targetLine;
    let committedLine = '';
    let historyReady = true;
    let confirmedHistoryBefore: DirectTaskHistoryLocation | undefined;
    const historyService = this.plugin?.itemHistoryService;
    const historyContext: DirectTaskHistoryLogContext = {
      action: 'task.update',
      surface: 'tps-list',
      path: file.path,
      lineNumber: targetLine - 1,
    };
    const historyHandle = this.parseLineItem(plan.currentLine, true)?.itemKind === 'task'
      ? await beginDirectTaskHistory(historyService, {
          action: historyContext.action,
          cause: {
            kind: 'user',
            sourcePluginId: 'tps-global-context-menu',
            surface: historyContext.surface,
          },
          before: {
            path: file.path,
            lineNumber: targetLine - 1,
            rawLine: plan.currentLine,
          },
        })
      : null;
    flow('TaskDrop', 'apply:start', {
      path: file.path,
      line: targetLine,
      propName,
      value,
      sourceLaneValues,
      filterTags: plan.filterTags,
      filterStatus: plan.filterStatus,
    });

    try {
      await this.app.vault.process(file, (content) => {
        const parts = splitLineItemContent(content);
        const index = resolveExactLineRevisionIndex(parts.lines, targetLine - 1, plan.currentLine);
        if (index < 0) {
          mutation.outcome = 'stale';
          return content;
        }
        const current = parts.lines[index] || '';
        confirmedHistoryBefore = {
          path: file.path,
          lineNumber: index,
          rawLine: current,
        };
        const currentItem = this.parseLineItem(current, true);
        if (!currentItem) return content;
        const next = plan.nextLine;
        if (next === current) return content;
        let finalNext = next;
        if (historyHandle) {
          if (currentItem.itemKind !== 'task') {
            historyReady = false;
          } else {
            const ensured = ensureDirectTaskHistoryIdentity(
              historyService,
              historyHandle,
              next,
              historyContext,
            );
            finalNext = ensured.line;
            historyReady = ensured.ready;
          }
        }
        parts.lines[index] = finalNext;
        committedLine = finalNext;
        resolvedLine = index + 1;
        mutation.outcome = 'changed';
        return `${parts.lines.join(parts.newline)}${parts.endsWithNewline ? parts.newline : ''}`;
      });
    } catch (error) {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      throw error;
    }

    if (mutation.outcome === 'stale') {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      flowWarn('TaskDrop', 'apply:stale-target', {
        path: file.path,
        requestedLine: targetLine,
        propName,
        value,
      });
      new Notice('The source line changed while the task drop confirmation was open.');
      return false;
    }
    if (mutation.outcome === 'changed') {
      if (historyReady && committedLine) {
        await commitDirectTaskHistory(historyService, historyHandle, {
          ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
          after: {
            path: file.path,
            lineNumber: resolvedLine - 1,
            rawLine: committedLine,
          },
          sourceDisposition: 'retained',
          outcome: 'committed',
        }, historyContext);
      } else {
        await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      }
      this.clearTaskCachesForPath(file.path);
      emitFilesUpdated(this.app, [file.path], 'tps-list');
    } else {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
    }
    flow('TaskDrop', mutation.outcome === 'changed' ? 'apply:done' : 'apply:no-change', {
      path: file.path,
      requestedLine: targetLine,
      resolvedLine,
      propName,
      value,
    });
    return mutation.outcome === 'changed';
  }

  private getDisplayLaneWritableValues(displayLane: DisplayLaneGroup | null | undefined): string[] {
    if (!displayLane) return [];
    const values: string[] = [];
    const seen = new Set<string>();
    for (const group of displayLane.groups) {
      if (!group.hasKey() || group.key == null) continue;
      const value = String(group.key).trim();
      const normalized = value.toLowerCase();
      if (!value || seen.has(normalized)) continue;
      values.push(value);
      seen.add(normalized);
    }
    return values;
  }

  private parseTaskPointerDropPayload(rawPayload: unknown): TaskDropPayload | null {
    if (!rawPayload || typeof rawPayload !== 'object') return null;
    const parsed = rawPayload as TaskDropPayload;
    const path = String(parsed.path || '').trim();
    const line = Math.max(1, Math.floor(Number(parsed.line || 1)));
    if (!path || !line) return null;
    return {
      ...parsed,
      path,
      line,
      rawLine: typeof parsed.rawLine === 'string' ? parsed.rawLine : undefined,
      sourceLaneValues: Array.isArray(parsed.sourceLaneValues) ? parsed.sourceLaneValues : [],
    };
  }

  private async handleTaskPointerDropEvent(evt: CustomEvent): Promise<void> {
    const detail = (evt as CustomEvent<{ payload?: unknown; x?: number; y?: number }>).detail || {};
    const x = Number(detail.x);
    const y = Number(detail.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const targetEl = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!targetEl || !this.containerEl.contains(targetEl)) return;
    const displayLane = this.getRenderedDisplayLaneFromElement(targetEl);
    if (!displayLane) return;
    const propName = this.getGroupByPropName();
    if (!this.isWritableTaskGroupingProperty(propName)) return;
    const parsed = this.parseTaskPointerDropPayload(detail.payload);
    const taskFile = parsed?.path ? this.app.vault.getFileByPath(parsed.path) : null;
    if (!parsed || !taskFile || !parsed.line) return;
    if (!parsed.rawLine) {
      flowWarn('TaskDrop', 'blocked', {
        reason: 'missing-source-revision',
        path: parsed.path,
        line: parsed.line,
      });
      new Notice('Could not move this line item because its source revision is unavailable. Refresh the view and try again.');
      return;
    }

    evt.preventDefault();
    const targetSelection = await this.resolveDropValueForDisplayLane(displayLane);
    if (!targetSelection.selected) return;
    await this.confirmAndApplyInlineTaskDrop(
      taskFile,
      parsed.line,
      propName,
      targetSelection.value,
      Array.isArray(parsed.sourceLaneValues) ? parsed.sourceLaneValues : [],
      parsed.rawLine,
    );
    this.render();
  }

  private beginTaskPointerDrag(
    event: PointerEvent,
    file: TFile,
    task: OpenTaskSubitem,
    propName: string | null,
    displayLane: DisplayLaneGroup,
    cardEl: HTMLElement,
  ): void {
    if (event.button !== 0) return;
    if (task.itemKind === 'heading') return;
    if (!this.isWritableTaskGroupingProperty(propName)) return;
    const expectedRawLine = String(task.rawLine || '');
    if (!expectedRawLine) {
      flowWarn('TaskDrop', 'blocked', {
        reason: 'missing-source-revision',
        path: file.path,
        line: task.line,
      });
      new Notice('Could not start this drag because the source revision is unavailable. Refresh the view and try again.');
      return;
    }
    this.clearActiveTaskPointerDrag();
    const isTouch = event.pointerType === 'touch';
    this.activeTaskPointerDrag = {
      pointerId: event.pointerId,
      itemKind: task.itemKind || 'task',
      path: file.path,
      line: task.line,
      rawLine: expectedRawLine,
      checkboxState: task.itemKind === 'bullet'
        ? undefined
        : this.getMappedCheckboxStateForTask(task) || undefined,
      text: this.getTaskVisibleTitle(task),
      sourceLaneValues: this.getDisplayLaneWritableValues(displayLane),
      propName,
      displayLane,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      activated: !isTouch,
      activationTimer: null,
      detachLostPointerCapture: null,
      cardEl,
    };
    const active = this.activeTaskPointerDrag;
    const onLostPointerCapture = () => this.clearActiveTaskPointerDrag(active.pointerId);
    cardEl.addEventListener('lostpointercapture', onLostPointerCapture);
    active.detachLostPointerCapture = () => cardEl.removeEventListener('lostpointercapture', onLostPointerCapture);
    if (isTouch) {
      active.activationTimer = window.setTimeout(() => {
        if (this.activeTaskPointerDrag !== active) return;
        if (!cardEl.isConnected) {
          this.clearActiveTaskPointerDrag(active.pointerId);
          return;
        }
        active.activationTimer = null;
        active.activated = true;
        cardEl.addClass('tps-list-native-row--drag-ready');
        try {
          cardEl.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture is best-effort in embedded Obsidian webviews.
        }
      }, TPS_LIST_TOUCH_DRAG_HOLD_MS);
    } else {
      try {
        cardEl.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort in embedded Obsidian webviews.
      }
    }
  }

  private handleTaskPointerMove(event: PointerEvent): void {
    const active = this.activeTaskPointerDrag;
    if (!active || active.pointerId !== event.pointerId) return;
    const deltaX = Math.abs(event.clientX - active.startX);
    const deltaY = Math.abs(event.clientY - active.startY);
    if (Math.max(deltaX, deltaY) < TPS_LIST_POINTER_DRAG_DISTANCE_PX) return;
    if (!active.activated) {
      // A normal touch pan must scroll the list rather than accidentally move
      // a task. Long-press activates the drag before movement begins.
      this.clearActiveTaskPointerDrag(active.pointerId);
      return;
    }
    active.moved = true;
    event.preventDefault();
    event.stopPropagation();
    active.cardEl.addClass('tps-kanban-card-task--dragging');
  }

  private async handleTaskPointerUp(event: PointerEvent): Promise<void> {
    const active = this.activeTaskPointerDrag;
    if (!active || active.pointerId !== event.pointerId) return;
    this.clearActiveTaskPointerDrag(active.pointerId);
    if (!active.moved || !active.activated) return;
    this.suppressTaskRowClickUntil = Date.now() + 500;

    event.preventDefault();
    event.stopPropagation();

    const releaseTarget = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const targetDisplayLane = this.getRenderedDisplayLaneFromElement(releaseTarget);
    if (!targetDisplayLane) {
      const dropEvent = new CustomEvent(TPS_TASK_LINE_POINTER_DROP_EVENT, {
        bubbles: true,
        cancelable: true,
        detail: {
          payload: this.buildPointerTaskDropPayload(active),
          x: event.clientX,
          y: event.clientY,
        },
      });
      document.dispatchEvent(dropEvent);
      return;
    }
    if (targetDisplayLane.id === active.displayLane.id) return;
    if (!this.isWritableTaskGroupingProperty(active.propName)) return;
    if (!active.rawLine) {
      flowWarn('TaskDrop', 'blocked', {
        reason: 'missing-source-revision',
        path: active.path,
        line: active.line,
      });
      new Notice('Could not move this line item because its source revision is unavailable. Refresh the view and try again.');
      return;
    }

    const taskFile = this.app.vault.getFileByPath(active.path);
    if (!taskFile) return;
    const targetSelection = await this.resolveDropValueForDisplayLane(targetDisplayLane);
    if (!targetSelection.selected) return;
    await this.confirmAndApplyInlineTaskDrop(
      taskFile,
      active.line,
      active.propName,
      targetSelection.value,
      active.sourceLaneValues.length ? active.sourceLaneValues : this.getDisplayLaneWritableValues(active.displayLane),
      active.rawLine,
    );
    this.render();
  }

  private cancelTaskPointerDrag(event: PointerEvent): void {
    const active = this.activeTaskPointerDrag;
    if (!active || active.pointerId !== event.pointerId) return;
    this.clearActiveTaskPointerDrag(active.pointerId);
  }

  private clearActiveTaskPointerDrag(pointerId?: number): void {
    const active = this.activeTaskPointerDrag;
    if (!active || (pointerId != null && active.pointerId !== pointerId)) return;
    this.activeTaskPointerDrag = null;
    if (active.activationTimer != null) window.clearTimeout(active.activationTimer);
    active.detachLostPointerCapture?.();
    active.cardEl.removeClass('tps-kanban-card-task--dragging');
    active.cardEl.removeClass('tps-list-native-row--drag-ready');
    try {
      if (active.cardEl.hasPointerCapture?.(active.pointerId)) {
        active.cardEl.releasePointerCapture(active.pointerId);
      }
    } catch {
      // Ignore capture cleanup failures for detached/rerendered rows.
    }
  }

  private getRenderedDisplayLaneFromElement(target: Element | null | undefined): DisplayLaneGroup | null {
    const laneEl = target?.closest<HTMLElement>(
      '.tps-list-native-group[data-display-lane-id], .tps-kanban-lane[data-display-lane-id]',
    ) ?? null;
    if (!laneEl || !this.containerEl.contains(laneEl)) return null;
    const displayLaneId = String(laneEl.dataset.displayLaneId || '').trim();
    return displayLaneId ? this.renderedDisplayLanesById.get(displayLaneId) ?? null : null;
  }

  private buildPointerTaskDropPayload(active: ActiveTaskPointerDrag): TaskDropPayload & { type: 'task-line'; source: 'tps-list' } {
    return {
      type: 'task-line',
      source: 'tps-list',
      itemKind: active.itemKind || 'task',
      path: active.path,
      line: active.line,
      rawLine: active.rawLine || '',
      checkboxState: active.itemKind === 'bullet' ? undefined : active.checkboxState,
      text: active.text || '',
      sourceLaneValues: active.sourceLaneValues,
    };
  }

  private getCurrentDisplayLaneById(displayLaneId: string): DisplayLaneGroup | null {
    const propName = this.getGroupByPropName();
    const propId = this.getGroupByPropId(propName);
    const listGrouping = this.isLikelyListGroupingProperty(propName, propId);
    const sourceGroups = this.getSourceGroupsForRender(propId, listGrouping);
    const allGroups = this.mergeGroupsByLaneId(sourceGroups);
    const keyed = allGroups.filter((g) => this.getLaneId(g) !== 'ungrouped');
    const ungrouped = allGroups.filter((g) => this.getLaneId(g) === 'ungrouped');
    const forced = this.getForcedLanesFromFilters(propName);
    const keyedWithForced: BasesEntryGroup[] = [...keyed];
    const existingKeys = new Set(keyed.map((g) => String(g.key).trim().toLowerCase()));
    for (const forcedKey of forced.keys) {
      const normalized = forcedKey.trim().toLowerCase();
      if (!normalized || existingKeys.has(normalized)) continue;
      keyedWithForced.push(this.createSyntheticGroup(forcedKey));
      existingKeys.add(normalized);
    }
    const ungroupedWithForced = [...ungrouped];
    if (forced.includeUngrouped && ungroupedWithForced.length === 0) {
      ungroupedWithForced.push(this.createSyntheticGroup(null));
    }
    const mergedGroups = this.getUngroupedPosition() === 'first'
      ? [...ungroupedWithForced, ...keyedWithForced]
      : [...keyedWithForced, ...ungroupedWithForced];
    const mergedWithSavedLanes = this.includeSavedLaneGroups(mergedGroups);
    const groups = this.applyManualLaneOrder(mergedWithSavedLanes.length ? mergedWithSavedLanes : [this.createSyntheticGroup(null)]);
    return this.buildDisplayLaneGroups(groups).find((lane) => lane.id === displayLaneId) ?? null;
  }

  private async updateTaskCheckboxState(
    file: TFile,
    line: number,
    checkboxState: string,
    expectedCurrentState: string,
    expectedRawLine: string,
  ): Promise<void> {
    const targetLine = Math.max(1, Math.floor(Number(line || 1)));
    const nextState = this.normalizeCheckboxState(checkboxState);
    const expectedState = this.normalizeCheckboxState(expectedCurrentState);
    if (!nextState || !this.getStatusForCheckboxState(nextState) || !expectedState || !expectedRawLine) {
      flowWarn('TaskCheckbox', 'update:blocked', {
        path: file.path,
        line: targetLine,
        reason: 'unmapped-checkbox-state',
      });
      return;
    }
    let changed = false;
    let blockedReason = '';
    let resolvedLine = targetLine;
    let committedLine = '';
    let historyReady = true;
    let confirmedHistoryBefore: DirectTaskHistoryLocation | undefined;
    const historyService = this.plugin?.itemHistoryService;
    const historyContext: DirectTaskHistoryLogContext = {
      action: 'task.checkbox',
      surface: 'tps-list',
      path: file.path,
      lineNumber: targetLine - 1,
    };
    const historyHandle = this.parseLineItem(expectedRawLine, true)?.itemKind === 'task'
      ? await beginDirectTaskHistory(historyService, {
          action: historyContext.action,
          cause: {
            kind: 'user',
            sourcePluginId: 'tps-global-context-menu',
            surface: historyContext.surface,
          },
          before: {
            path: file.path,
            lineNumber: targetLine - 1,
            rawLine: expectedRawLine,
          },
        })
      : null;
    flow('TaskCheckbox', 'update:start', {
      path: file.path,
      line: targetLine,
      nextState,
    });

    try {
      await this.app.vault.process(file, (content) => {
        const parts = splitLineItemContent(content);
        const index = resolveExactLineRevisionIndex(parts.lines, targetLine - 1, expectedRawLine);
        if (index < 0) {
          blockedReason = 'stale-source-revision';
          return content;
        }
        const current = parts.lines[index];
        confirmedHistoryBefore = {
          path: file.path,
          lineNumber: index,
          rawLine: current,
        };
        const taskMatch = current.match(/^\s*(?:[-*+]|\d+[.)])\s+(\[[^\]\r\n]*\])\s+/u);
        if (!taskMatch) {
          blockedReason = 'not-task-line';
          return content;
        }
        const currentState = this.normalizeCheckboxState(taskMatch[1]);
        if (!currentState || !this.getStatusForCheckboxState(currentState)) {
          blockedReason = 'unmapped-current-state';
          return content;
        }
        if (expectedState && currentState !== expectedState) {
          blockedReason = 'stale-checkbox-state';
          return content;
        }
        const currentToggleTarget = getKanbanToggleCheckboxState(currentState, this.getGcmCheckboxMappings());
        if (!currentToggleTarget || currentToggleTarget !== nextState) {
          blockedReason = 'stale-toggle-mapping';
          return content;
        }
        const next = replaceKanbanTaskLineCheckboxState(current, nextState);
        if (next === current) {
          blockedReason = 'unchanged';
          return content;
        }
        const ensured = ensureDirectTaskHistoryIdentity(
          historyService,
          historyHandle,
          next,
          historyContext,
        );
        parts.lines[index] = ensured.line;
        committedLine = ensured.line;
        historyReady = ensured.ready;
        resolvedLine = index + 1;
        changed = true;
        return `${parts.lines.join(parts.newline)}${parts.endsWithNewline ? parts.newline : ''}`;
      });
    } catch (error) {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      throw error;
    }

    if (changed) {
      if (historyReady && committedLine) {
        await commitDirectTaskHistory(historyService, historyHandle, {
          ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
          after: {
            path: file.path,
            lineNumber: resolvedLine - 1,
            rawLine: committedLine,
          },
          sourceDisposition: 'retained',
          outcome: 'committed',
        }, historyContext);
      } else {
        await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      }
      this.clearTaskCachesForPath(file.path);
      emitFilesUpdated(this.app, [file.path], 'tps-list');
    } else {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
    }
    flow('TaskCheckbox', changed ? 'update:done' : 'update:no-change', {
      path: file.path,
      line: targetLine,
      resolvedLine,
      nextState,
      reason: changed ? undefined : blockedReason || 'unknown',
    });
  }

  private normalizeWritableTaskTag(value: string): string {
    return normalizeKanbanWritableTaskTag(value);
  }

  private getChildLinkKeys(): string[] {
    const keys = new Set<string>();
    for (const settings of this.getRelationshipSettingsSources()) {
      const configured = String(
        settings?.childLinkFrontmatterKey
        ?? settings?.childLinkKey
        ?? '',
      ).trim();
      if (configured) keys.add(configured);
    }
    keys.add('parentOf');
    keys.add('children');
    keys.add('meetings');
    return Array.from(keys);
  }

  private getRelationshipSettingsSources(): Array<Record<string, any>> {
    const out: Array<Record<string, any>> = [];
    const pushIfObject = (candidate: unknown) => {
      if (candidate && typeof candidate === 'object') out.push(candidate as Record<string, any>);
    };

    // Local plugin settings (if present in this build variant).
    pushIfObject((this.plugin as any)?.settings);

    const plugins = (this.app as any)?.plugins?.plugins;
    if (plugins && typeof plugins === 'object') {
      // Dedicated GCM plugin variants.
      pushIfObject(plugins['tps-global-context-menu']?.settings);
      pushIfObject(plugins['TPS-Global-Context-Menu (Dev)']?.settings);
      // Consolidated TPS plugin variants.
      pushIfObject(plugins['tps']?.settings);
      pushIfObject(plugins['TPS (Dev)']?.settings);
    }

    return out;
  }

  private findFrontmatterKeyCaseInsensitive(frontmatter: Record<string, unknown>, target: string): string | null {
    return findPropertyKeyCaseInsensitive(frontmatter, target);
  }

  private getFrontmatterValueCaseInsensitive(frontmatter: Record<string, unknown>, key: string): unknown {
    const actual = this.findFrontmatterKeyCaseInsensitive(frontmatter, key);
    return actual ? frontmatter[actual] : undefined;
  }

  private formatCardPropertyValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return '';
    if (Array.isArray(value)) {
      const items = value
        .map((item) => String(item ?? '').replace(/^#/, '').trim())
        .filter((item) => item && item.toLowerCase() !== 'null' && item.toLowerCase() !== 'undefined');
      if (items.length <= 3) return items.join(', ');
      return `${items.slice(0, 3).join(', ')} +${items.length - 3} more`;
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    const raw = String(value).trim();
    if (!raw) return '';
    if (raw.toLowerCase() === 'null' || raw.toLowerCase() === 'undefined') return '';
    const dateTime = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (dateTime) {
      const year = Number(dateTime[1]);
      const month = Number(dateTime[2]) - 1;
      const day = Number(dateTime[3]);
      const hours = dateTime[4] === undefined ? 0 : Number(dateTime[4]);
      const minutes = dateTime[5] === undefined ? 0 : Number(dateTime[5]);
      const date = new Date(year, month, day, hours, minutes);
      if (!Number.isNaN(date.getTime())) {
        const datePart = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        if (dateTime[4] === undefined) return datePart;
        const timePart = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        return `${datePart}, ${timePart}`;
      }
    }
    return raw.length > 42 ? `${raw.slice(0, 39)}...` : raw;
  }

  private normalizeLinkTarget(rawTarget: string): string | null {
    let target = String(rawTarget || '').trim();
    if (!target) return null;
    if (target.startsWith('<') && target.endsWith('>')) {
      target = target.slice(1, -1).trim();
    }
    if (target.includes('|')) {
      target = target.split('|')[0].trim();
    }
    if (target.includes('#')) {
      target = target.split('#')[0].trim();
    }
    target = target.replace(/^\.\/+/, '').trim();
    if (!target) return null;
    try {
      target = decodeURI(target);
    } catch {
      // Keep raw if decode fails.
    }
    return target || null;
  }

  private resolveLinkTargetToPath(rawTarget: string, sourcePath: string): string | null {
    const gcmResolved = this.getGcmServices()?.links?.resolveToPath?.(rawTarget, sourcePath);
    if (gcmResolved) return String(gcmResolved);

    const target = this.normalizeLinkTarget(rawTarget);
    if (!target) return null;

    const noMd = target.replace(/\.md$/i, '');
    const viaCache =
      this.app.metadataCache.getFirstLinkpathDest(target, sourcePath)
      || this.app.metadataCache.getFirstLinkpathDest(noMd, sourcePath);
    if (viaCache instanceof TFile) return viaCache.path;

    const normalized = normalizePath(target);
    const direct = this.app.vault.getAbstractFileByPath(normalized);
    if (direct instanceof TFile) return direct.path;

    const withMd = normalized.endsWith('.md') ? normalized : `${normalized}.md`;
    const directMd = this.app.vault.getAbstractFileByPath(withMd);
    if (directMd instanceof TFile) return directMd.path;

    // Defensive decode of malformed nested markdown link payloads.
    const nestedTargets = this.extractLinkTargetsFromText(target, false);
    for (const nestedTarget of nestedTargets) {
      const nestedResolved = this.resolveLinkTargetToPath(nestedTarget, sourcePath);
      if (nestedResolved) return nestedResolved;
    }

    return null;
  }

  private extractLinkTargetsFromText(rawText: string, allowBareValue: boolean = false): string[] {
    const text = String(rawText || '').trim();
    if (!text) return [];

    const targets: string[] = [];
    const seen = new Set<string>();
    const push = (rawTarget: string) => {
      const normalized = this.normalizeLinkTarget(rawTarget);
      if (!normalized) return;
      const key = normalized.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      targets.push(normalized);
    };

    let matchedStructuredLink = false;

    const wikiPattern = /!?\[\[([^[\]]+)\]\]/g;
    let wikiMatch: RegExpExecArray | null = null;
    while ((wikiMatch = wikiPattern.exec(text)) !== null) {
      matchedStructuredLink = true;
      push(wikiMatch[1]);
    }

    for (const markdownTarget of this.extractMarkdownLinkTargets(text)) {
      matchedStructuredLink = true;
      push(markdownTarget);
    }

    if (allowBareValue && !matchedStructuredLink) {
      text.split(/[\n,;]/).forEach((chunk) => push(chunk));
    }

    return targets;
  }

  private extractMarkdownLinkTargets(text: string): string[] {
    const targets: string[] = [];
    let i = 0;

    while (i < text.length) {
      const openBracket = text.indexOf('[', i);
      if (openBracket === -1) break;

      let closeBracket = openBracket + 1;
      let escaped = false;
      while (closeBracket < text.length) {
        const ch = text[closeBracket];
        if (!escaped && ch === ']') break;
        escaped = !escaped && ch === '\\';
        closeBracket += 1;
      }
      if (closeBracket >= text.length) break;

      if (text[closeBracket + 1] !== '(') {
        i = closeBracket + 1;
        continue;
      }

      let cursor = closeBracket + 2;
      let depth = 1;
      let inAngle = false;
      escaped = false;

      while (cursor < text.length) {
        const ch = text[cursor];
        if (!escaped) {
          if (ch === '<') inAngle = true;
          if (ch === '>') inAngle = false;
          if (!inAngle) {
            if (ch === '(') depth += 1;
            if (ch === ')') {
              depth -= 1;
              if (depth === 0) break;
            }
          }
        }
        escaped = !escaped && ch === '\\';
        cursor += 1;
      }

      if (depth !== 0 || cursor >= text.length) {
        i = closeBracket + 1;
        continue;
      }

      const destination = text.slice(closeBracket + 2, cursor).trim();
      if (destination) {
        targets.push(destination);
      }
      i = cursor + 1;
    }

    return targets;
  }

  private parseLinksFromFrontmatterValue(value: unknown, sourcePath: string): string[] {
    const gcmFiles = this.getGcmServices()?.links?.parseFrontmatterLinks?.(value, sourcePath);
    if (Array.isArray(gcmFiles)) {
      return gcmFiles
        .map((file: unknown) => file instanceof TFile ? file.path : '')
        .filter(Boolean);
    }

    const output = new Set<string>();
    const visitedObjects = new Set<unknown>();

    const consume = (candidate: unknown) => {
      if (candidate === null || candidate === undefined) return;

      if (Array.isArray(candidate)) {
        if (visitedObjects.has(candidate)) return;
        visitedObjects.add(candidate);
        candidate.forEach((entry) => consume(entry));
        return;
      }

      if (typeof candidate === 'object') {
        if (visitedObjects.has(candidate)) return;
        visitedObjects.add(candidate);
        const record = candidate as Record<string, unknown>;
        const preferredLinkKeys = ['path', 'link', 'target', 'file', 'href', 'value'];
        let consumedPreferred = false;
        for (const key of preferredLinkKeys) {
          if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
          consumedPreferred = true;
          consume(record[key]);
        }
        if (!consumedPreferred) {
          Object.values(record).forEach((entry) => consume(entry));
        }
        return;
      }

      if (typeof candidate === 'string') {
        const targets = this.extractLinkTargetsFromText(candidate, true);
        for (const target of targets) {
          const resolved = this.resolveLinkTargetToPath(target, sourcePath);
          if (resolved) output.add(resolved);
        }
        return;
      }

      if (typeof candidate === 'number' || typeof candidate === 'boolean') {
        const resolved = this.resolveLinkTargetToPath(String(candidate), sourcePath);
        if (resolved) output.add(resolved);
      }
    };

    consume(value);
    return Array.from(output);
  }

  private resolveParentPath(file: TFile): string | null {
    const gcmParent = this.getGcmServices()?.parents?.getParentFile?.(file);
    if (gcmParent instanceof TFile && gcmParent.path !== file.path) return gcmParent.path;

    const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, unknown>;
    const parentKeys = this.getParentLinkKeys();

    for (const key of parentKeys) {
      const raw = this.getFrontmatterValueCaseInsensitive(fm, key);
      const paths = this.parseLinksFromFrontmatterValue(raw, file.path);
      for (const path of paths) {
        if (path && path !== file.path) return path;
      }
    }

    return null;
  }

  private buildParentByChild(groups: BasesEntryGroup[]): Map<string, string> {
    const parentByChild = new Map<string, string>();
    const visiblePaths = new Set<string>();
    const entries: BasesEntry[] = [];
    const visibleEntryByPath = new Map<string, BasesEntry>();

    for (const group of groups) {
      for (const entry of group.entries) {
        visiblePaths.add(entry.file.path);
        if (!visibleEntryByPath.has(entry.file.path)) {
          visibleEntryByPath.set(entry.file.path, entry);
        }
        entries.push(entry);
      }
    }

    // Forward direction: child -> parent (e.g. childOf)
    for (const entry of entries) {
      if (parentByChild.has(entry.file.path)) continue;
      const parentPath = this.resolveParentPath(entry.file);
      if (!parentPath) continue;
      if (!visiblePaths.has(parentPath)) continue;
      parentByChild.set(entry.file.path, parentPath);
    }

    // Reverse direction: parent -> children (e.g. parentOf)
    const childKeys = this.getChildLinkKeys();
    for (const parentEntry of visibleEntryByPath.values()) {
      const fm = (this.app.metadataCache.getFileCache(parentEntry.file)?.frontmatter || {}) as Record<string, unknown>;
      for (const childKey of childKeys) {
        const raw = this.getFrontmatterValueCaseInsensitive(fm, childKey);
        const childPaths = this.parseLinksFromFrontmatterValue(raw, parentEntry.file.path);
        for (const childPath of childPaths) {
          if (!visiblePaths.has(childPath)) continue;
          if (childPath === parentEntry.file.path) continue;
          if (parentByChild.has(childPath)) continue;
          parentByChild.set(childPath, parentEntry.file.path);
        }
      }
    }

    return parentByChild;
  }

  private createSyntheticGroup(key: string | null): BasesEntryGroup {
    return {
      key,
      entries: [],
      hasKey: () => key != null,
    } as unknown as BasesEntryGroup;
  }

  private ensureGroupsForTaskLanes(
    groups: BasesEntryGroup[],
    taskRenderItemsByLane: Map<string, TaskRenderItem[]>,
  ): BasesEntryGroup[] {
    if (!taskRenderItemsByLane.size) return groups;
    const existingLaneIds = new Set(groups.map((group) => this.getLaneId(group)));
    const nextGroups = [...groups];
    for (const laneId of taskRenderItemsByLane.keys()) {
      if (existingLaneIds.has(laneId)) continue;
      const laneLabel = taskRenderItemsByLane.get(laneId)?.[0]?.laneLabel;
      const synthetic = this.createSyntheticGroupFromLaneId(laneId, laneLabel);
      if (!synthetic) continue;
      nextGroups.push(synthetic);
      existingLaneIds.add(laneId);
    }
    return this.applyManualLaneOrder(nextGroups);
  }

  private createSyntheticGroupFromLaneId(laneId: string, laneLabel?: string): BasesEntryGroup | null {
    if (laneId === 'ungrouped') return this.createSyntheticGroup(null);
    if (laneId.startsWith('key:')) return this.createSyntheticGroup(laneLabel || laneId.slice(4));
    return null;
  }

  private getSavedLaneFallbackGroups(): BasesEntryGroup[] {
    const map = (this.plugin.settings?.laneOrderByView || {}) as Record<string, string[]>;
    const viewId = this.getLaneOrderViewId();
    const legacyViewId = this.getLegacyUnknownBaseViewId();
    const saved = Array.isArray(map[viewId]) ? map[viewId] : Array.isArray(map[legacyViewId]) ? map[legacyViewId] : [];
    const groups: BasesEntryGroup[] = [];
    for (const laneIdRaw of saved) {
      const laneId = String(laneIdRaw || '').trim();
      if (!laneId) continue;
      if (laneId === 'ungrouped') {
        groups.push(this.createSyntheticGroup(null));
        continue;
      }
      if (laneId.startsWith('key:')) {
        const key = laneId.slice(4).trim();
        groups.push(this.createSyntheticGroup(key || null));
      }
    }
    return groups;
  }

  private includeSavedLaneGroups(groups: BasesEntryGroup[]): BasesEntryGroup[] {
    const savedGroups = this.getSavedLaneFallbackGroups();
    if (!savedGroups.length) return groups;
    const existingLaneIds = new Set(groups.map((group) => this.getLaneId(group)));
    const nextGroups = [...groups];
    for (const savedGroup of savedGroups) {
      const laneId = this.getLaneId(savedGroup);
      if (existingLaneIds.has(laneId)) continue;
      nextGroups.push(savedGroup);
      existingLaneIds.add(laneId);
    }
    return nextGroups;
  }

  private getForcedLanesFromFilters(propName: string | null): { keys: string[]; includeUngrouped: boolean } {
    if (!propName) return { keys: [], includeUngrouped: false };

    const keys = new Set<string>();
    const includeUngrouped = { value: false };
    for (const root of this.getBaseFilterRoots()) {
      if (!root) continue;
      this.collectForcedLanesFromFilterNode(root, propName, keys, includeUngrouped);
    }
    if (this.normalizeInlinePropertyKey(this.getTaskInlinePropertyName(propName)) === 'scheduled') {
      const scheduled = this.getBaseContextFrontmatterValue('scheduled');
      if (scheduled) {
        keys.add(scheduled);
        includeUngrouped.value = true;
      }
    }
    return { keys: Array.from(keys), includeUngrouped: includeUngrouped.value };
  }

  private getBaseFilterRoots(): unknown[] {
    // Runtime roots include unsaved edits from Obsidian's Base filter editor. Keep
    // them ahead of persisted roots so the custom view reacts immediately while
    // still inheriting the Base-wide filters stored in the .base file.
    const runtimeRoots = this.getRuntimeBaseFilterRoots();
    const stampedRoots = this.getStampedBaseFilterRoots();
    if (stampedRoots) return composeEffectiveFilterRoots(runtimeRoots, stampedRoots);
    const baseFile = this.getBaseFile();
    if (baseFile) {
      const fileRoots = this.getBaseFileFilterRoot();
      return composeEffectiveFilterRoots(runtimeRoots, fileRoots || []);
    }

    const embeddedRoots = this.getEmbeddedBaseFilterRoot();
    if (embeddedRoots?.length) return composeEffectiveFilterRoots(runtimeRoots, embeddedRoots);
    return composeEffectiveFilterRoots(runtimeRoots, []);
  }

  private getActiveFormulaSet(): TpsCompiledFormulaSet {
    if (this.stampedFormulaSet) return this.stampedFormulaSet;
    const baseFile = this.getBaseFile();
    if (
      baseFile
      && this.baseFileFilterCache?.path === baseFile.path
      && this.baseFileFilterCache.mtime === Number(baseFile.stat?.mtime || 0)
    ) return this.baseFileFilterCache.formulaSet;
    const contextFile = this.getBaseContextFile();
    if (
      contextFile
      && this.embeddedBaseFilterCache?.path === contextFile.path
      && this.embeddedBaseFilterCache.mtime === Number(contextFile.stat?.mtime || 0)
    ) return this.embeddedBaseFilterCache.formulaSet;
    return tpsBaseFormulaService.compile({}, 'tps-list:unresolved');
  }

  private getRuntimeBaseFilterRoots(): unknown[] {
    return this.extractFilterRootCandidates([
      this.config?.get?.('filters'),
      (this.config as any)?.filters,
      (this as any)?.filters,
      (this as any)?.view?.filters,
      (this as any)?.controller?.viewConfig?.filters,
      (this as any)?.controller?.config?.filters,
      (this as any)?.queryController?.query?.filters,
      (this as any)?.queryController?.queryState,
    ]);
  }

  private async getBaseFilterRootsForCreation(): Promise<unknown[]> {
    const runtimeRoots = this.getRuntimeBaseFilterRoots();
    const stampedRoots = this.getStampedBaseFilterRoots();
    if (stampedRoots) return composeEffectiveFilterRoots(runtimeRoots, stampedRoots);
    const baseFile = this.getBaseFile();
    if (baseFile) {
      const loaded = await this.loadBaseFileFilters(
        baseFile,
        Number(baseFile.stat?.mtime || 0),
        this.getConfiguredBaseViewName(),
      );
      if (!loaded) throw new Error(`Could not read Base filters from ${baseFile.path}`);
      const fileRoots = this.getBaseFileFilterRoot();
      return composeEffectiveFilterRoots(runtimeRoots, fileRoots || []);
    }

    const embeddedFile = this.getBaseContextFile();
    if (embeddedFile) {
      const loaded = await this.loadEmbeddedBaseFilters(
        embeddedFile,
        Number(embeddedFile.stat?.mtime || 0),
        this.getConfiguredBaseViewName(),
      );
      if (!loaded) throw new Error(`Could not read embedded Base filters from ${embeddedFile.path}`);
      return composeEffectiveFilterRoots(runtimeRoots, this.getEmbeddedBaseFilterRoot() || []);
    }
    throw new Error('Could not resolve the Base definition for line creation');
  }

  private getStampedBaseFilterRoots(): unknown[] | null {
    const host = this.containerEl?.closest('[data-tps-base-definition]') as HTMLElement | null;
    const serialized = host?.dataset.tpsBaseDefinition;
    if (!serialized) {
      this.stampedFormulaSet = null;
      return null;
    }
    try {
      const parsed = JSON.parse(serialized) as Record<string, unknown>;
      const source = this.getBaseSourcePath() || this.getBaseContextFile()?.path || 'embedded';
      this.stampedFormulaSet = tpsBaseFormulaService.compile(
        extractTpsBaseFormulaDefinitions(parsed),
        `tps-list:stamped:${source}`,
      );
      return this.extractBaseFileFilterRoots(parsed, this.getConfiguredBaseViewName()).filters;
    } catch (error) {
      this.stampedFormulaSet = tpsBaseFormulaService.compile({}, 'tps-list:stamped-invalid');
      flowError('BaseFilters', 'stamped-definition-invalid', error, { viewName: this.getConfiguredBaseViewName() });
      return null;
    }
  }

  private getEmbeddedBaseFilterRoot(): unknown[] | null {
    const file = this.getBaseContextFile();
    if (!file) return null;
    const mtime = Number(file.stat?.mtime || 0);
    const viewName = this.getConfiguredBaseViewName();
    if (
      this.embeddedBaseFilterCache?.path === file.path
      && this.embeddedBaseFilterCache.mtime === mtime
      && isPersistedFilterCacheMatch(
        this.embeddedBaseFilterCache.viewName,
        viewName,
        this.embeddedBaseFilterCache.viewNames,
      )
    ) {
      return this.embeddedBaseFilterCache.filters;
    }

    void this.loadEmbeddedBaseFilters(file, mtime, viewName);
    return this.embeddedBaseFilterCache?.path === file.path
      && isPersistedFilterCacheMatch(
        this.embeddedBaseFilterCache.viewName,
        viewName,
        this.embeddedBaseFilterCache.viewNames,
      )
      ? this.embeddedBaseFilterCache.filters
      : null;
  }

  private async loadEmbeddedBaseFilters(file: TFile, mtime = Number(file.stat?.mtime || 0), viewName = this.getConfiguredBaseViewName()): Promise<boolean> {
    const loadingKey = `${file.path}:${mtime}:${viewName}`;
    if (this.embeddedBaseFiltersLoadingKey === loadingKey && this.embeddedBaseFiltersLoadingPromise) {
      return this.embeddedBaseFiltersLoadingPromise;
    }
    this.embeddedBaseFiltersLoadingKey = loadingKey;
    const loadPromise = (async () => {
      try {
        const content = await this.app.vault.cachedRead(file);
        const exactRoots: unknown[] = [];
        const fallbackRoots: unknown[] = [];
        let exactFormulas: Record<string, string> = {};
        let fallbackFormulas: Record<string, string> = {};
        const viewNames: string[] = [];
        let exactBlockCount = 0;
        let fallbackBlockCount = 0;
        const blockPattern = /```base\s*\n([\s\S]*?)```/gi;
        let match: RegExpExecArray | null = null;
        while ((match = blockPattern.exec(content)) !== null) {
          try {
            const parsed = parseYaml(match[1] || '') as Record<string, unknown> | null | undefined;
            const blockMatch = this.getEmbeddedKanbanBlockMatch(parsed, viewName);
            if (!blockMatch) continue;
            const formulas = extractTpsBaseFormulaDefinitions(parsed);
            if (blockMatch === 'fallback') {
              fallbackBlockCount += 1;
              if (fallbackBlockCount === 1) fallbackFormulas = formulas;
            } else {
              exactBlockCount += 1;
              if (exactBlockCount === 1) exactFormulas = formulas;
            }
            const extracted = this.extractBaseFileFilterRoots(parsed, viewName);
            viewNames.push(...extracted.viewNames);
            if (extracted.filters?.length) {
              const target = blockMatch === 'exact' ? exactRoots : fallbackRoots;
              target.push(...extracted.filters);
            }
          } catch (error) {
            flowError('EmbeddedBaseFilters', 'parse-block-failed', error, { path: file.path, viewName });
          }
        }
        const ambiguousExact = exactBlockCount > 1;
        const ambiguousFallback = exactBlockCount === 0 && fallbackBlockCount > 1;
        const roots = exactBlockCount === 1 ? exactRoots : ambiguousExact || ambiguousFallback ? [] : fallbackRoots;
        const formulas = exactBlockCount === 1 ? exactFormulas : ambiguousExact || ambiguousFallback ? {} : fallbackFormulas;
        const currentViewName = viewName || (ambiguousExact || ambiguousFallback ? '' : viewNames[0] || '');
        if (this.embeddedBaseFiltersLoadingKey !== loadingKey) return;
        const previous = this.embeddedBaseFilterCache;
        this.embeddedBaseFilterCache = {
          path: file.path,
          mtime,
          viewName: currentViewName,
          viewNames: Array.from(new Set(viewNames)),
          filters: roots.length ? roots : null,
          formulas,
          formulaSet: tpsBaseFormulaService.compile(formulas, `${file.path}:${mtime}:embedded:${currentViewName}`),
        };
        if (ambiguousExact || ambiguousFallback) {
          flowWarn('EmbeddedBaseFilters', 'ambiguous-fallback-skipped', {
            path: file.path,
            viewName,
            exactBlocks: exactBlockCount,
            fallbackBlocks: fallbackBlockCount,
          });
        }
        if (previous?.path !== file.path || previous?.mtime !== mtime || previous?.viewName !== currentViewName || previous?.filters !== this.embeddedBaseFilterCache.filters) {
          flow('EmbeddedBaseFilters', 'loaded', {
            path: file.path,
            viewName: currentViewName,
            filterRoots: roots.length,
            formulas: Object.keys(formulas).length,
          });
          this.refreshDebounced();
        }
        return true;
      } catch (error) {
        flowError('EmbeddedBaseFilters', 'read-failed', error, { path: file.path, viewName });
        if (this.embeddedBaseFiltersLoadingKey === loadingKey) {
          this.embeddedBaseFilterCache = {
            path: file.path,
            mtime,
            viewName,
            viewNames: [],
            filters: null,
            formulas: {},
            formulaSet: tpsBaseFormulaService.compile({}, `${file.path}:${mtime}:embedded-read-error`),
          };
        }
        return false;
      }
    })();
    this.embeddedBaseFiltersLoadingPromise = loadPromise;
    try {
      return await loadPromise;
    } finally {
      if (this.embeddedBaseFiltersLoadingPromise === loadPromise) {
        this.embeddedBaseFiltersLoadingPromise = null;
        if (this.embeddedBaseFiltersLoadingKey === loadingKey) this.embeddedBaseFiltersLoadingKey = null;
      }
    }
  }

  private getEmbeddedKanbanBlockMatch(parsed: Record<string, unknown> | null | undefined, viewName: string): 'exact' | 'fallback' | null {
    const views = Array.isArray(parsed?.views) ? parsed.views : [];
    if (!views.length) return 'fallback';
    const kanbanViews = views.filter((view) => {
      if (!view || typeof view !== 'object') return false;
      const record = view as Record<string, unknown>;
      const type = String(record.type || '').trim();
      return type === TPS_LIST_VIEW_TYPE;
    }) as Array<Record<string, unknown>>;
    if (!kanbanViews.length) return null;
    if (viewName && kanbanViews.some((record) => {
      const name = String(record.name || '').trim();
      return !name || name === viewName;
    })) return 'exact';
    return kanbanViews.length === 1 ? 'fallback' : null;
  }

  private scheduleBaseFileFilterLoad(): void {
    const file = this.getBaseFile();
    if (!file) return;
    const mtime = Number(file.stat?.mtime || 0);
    const viewName = this.getConfiguredBaseViewName();
    if (this.baseFileFilterCache?.path === file.path
      && this.baseFileFilterCache.mtime === mtime
      && isPersistedFilterCacheMatch(
        this.baseFileFilterCache.viewName,
        viewName,
        this.baseFileFilterCache.viewNames,
      )) return;
    void this.loadBaseFileFilters(file, mtime, viewName);
  }

  private isBaseFileFilterReady(): boolean {
    const file = this.getBaseFile();
    if (!file) return true;
    const cache = this.baseFileFilterCache;
    const viewName = this.getConfiguredBaseViewName();
    return cache?.path === file.path
      && cache.mtime === Number(file.stat?.mtime || 0)
      && isPersistedFilterCacheMatch(cache.viewName, viewName, cache.viewNames);
  }

  private extractFilterRootCandidates(candidates: unknown[]): unknown[] {
    const roots: unknown[] = [];
    for (const candidate of candidates) {
      this.collectFilterRootCandidates(candidate, roots);
    }
    return roots;
  }

  private collectFilterRootCandidates(root: unknown, roots: unknown[]): void {
    if (!root) return;
    if (this.isDirectFilterRoot(root)) {
      roots.push(root);
      return;
    }
    if (Array.isArray(root)) {
      for (const item of root) this.collectFilterRootCandidates(item, roots);
      return;
    }
    if (typeof root !== 'object') return;
    const record = root as Record<string, unknown>;
    for (const key of ['filters', 'children', 'data', 'query', 'queryState']) {
      this.collectFilterRootCandidates(record[key], roots);
    }
  }

  private isDirectFilterRoot(root: unknown): boolean {
    if (!root) return false;
    if (typeof root === 'string') return !!root.trim();
    if (Array.isArray(root)) return root.some((item) => this.isDirectFilterRoot(item));
    if (typeof root !== 'object') return false;
    const record = root as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, 'and')
      || Object.prototype.hasOwnProperty.call(record, 'or')
      || Object.prototype.hasOwnProperty.call(record, 'all')
      || Object.prototype.hasOwnProperty.call(record, 'any')
      || Object.prototype.hasOwnProperty.call(record, 'not')
      || Object.prototype.hasOwnProperty.call(record, 'property')
      || Object.prototype.hasOwnProperty.call(record, 'field')) {
      return true;
    }
    return false;
  }

  private getBaseFilterSignature(): string {
    return this.stableFilterSignature(this.getBaseFilterRoots());
  }

  private stableFilterSignature(value: unknown, seen = new WeakSet<object>()): string {
    if (value == null) return '';
    if (typeof value === 'function') return '';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (seen.has(value)) return '"[Circular]"';
    seen.add(value);
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableFilterSignature(item, seen)).filter(Boolean).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => {
        const lower = key.toLowerCase();
        return !lower.includes('el') && !lower.includes('dom') && !lower.includes('owner') && typeof record[key] !== 'function';
      })
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${this.stableFilterSignature(record[key], seen)}`).filter((part) => !part.endsWith(':')).join(',')}}`;
  }

  private getNoteCreationDefaultsFromBaseFilters(): NoteCreationDefaults {
    for (const root of this.getBaseFilterRoots()) {
      const frontmatter = this.extractNoteFrontmatterDefaults(root);
      const targetDefault = this.extractNoteCreationTargetDefault(root);
      if (!Object.keys(frontmatter).length && !targetDefault.baseFileName && !targetDefault.blockedReason) continue;
      return { frontmatter, ...targetDefault };
    }
    return { frontmatter: {} };
  }

  private extractNoteCreationTargetDefault(filters: unknown): Pick<NoteCreationDefaults, 'baseFileName' | 'blockedReason'> {
    let folderTarget: string | null = null;
    for (const condition of this.collectPositiveNoteFilterConditions(filters)) {
      const propertyRaw = condition.property.trim();
      if (!propertyRaw) continue;
      const property = propertyRaw.toLowerCase().replace(/^note\./, '');
      const value = this.resolveBaseContextToken(condition.value) ?? this.normalizeNoteFilterDefaultValue(condition.value);
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      const text = String(value).trim();
      if (!text) continue;

      if (property === 'file.path' || property === 'path' || property === 'filepath') {
        const targetPath = this.normalizeNoteTargetPath(text);
        if (targetPath) {
          if (this.app.vault.getFileByPath(targetPath) instanceof TFile) {
            return { blockedReason: `Cannot create a matching note because the Base filters require existing file: ${targetPath}` };
          }
          return { baseFileName: targetPath.replace(/\.md$/i, '') };
        }
      }
      if (property === 'file.folder' || property === 'folder' || property === 'folderpath') {
        const folderPath = this.normalizeNoteTargetFolder(text);
        if (!folderPath) continue;
        if (folderTarget && folderTarget.toLowerCase() !== folderPath.toLowerCase()) return {};
        folderTarget = folderPath;
      }
    }
    return folderTarget ? { baseFileName: `${folderTarget}/Untitled` } : {};
  }

  private extractNoteFrontmatterDefaults(filters: unknown): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};
    for (const condition of this.collectPositiveNoteFilterConditions(filters)) {
      const propertyRaw = condition.property.trim();
      if (!propertyRaw) continue;
      const property = propertyRaw.toLowerCase();
      if (
        property.startsWith('formula.') ||
        property.startsWith('formula[') ||
        property.includes('file.') ||
        property.includes('path') ||
        property.includes('folder') ||
        property.includes('name') ||
        property.includes('title') ||
        property.startsWith('task.') ||
        property.startsWith('line.') ||
        property.startsWith('block.') ||
        property.startsWith('tps.') ||
        property.startsWith('kanban.')
      ) {
        continue;
      }

      const value = this.normalizeNoteFilterDefaultValue(condition.value);
      if (value === null) continue;
      const key = propertyRaw.startsWith('note.')
        ? propertyRaw.slice(5)
        : propertyRaw;
      if (!key.trim()) continue;
      defaults[key.trim()] = value;
    }
    return defaults;
  }

  private collectPositiveNoteFilterConditions(filters: unknown): Array<{ property: string; operator: string; value: unknown }> {
    const conditions: Array<{ property: string; operator: string; value: unknown }> = [];
    const visited = new WeakSet<object>();

    const visit = (node: any, negated = false): boolean => {
      if (!node) return false;
      if (typeof node === 'string') {
        const parsed = this.parseInlineNoteFilterCondition(node);
        if (parsed && !negated && this.isPositiveNoteEqualityOperator(parsed.operator)) {
          conditions.push(parsed);
          return true;
        }
        return false;
      }
      if (Array.isArray(node)) {
        let found = false;
        for (const child of node) {
          found = visit(child, negated) || found;
        }
        return found;
      }
      if (typeof node !== 'object') return false;
      const proto = Object.getPrototypeOf(node);
      if (proto !== Object.prototype && proto !== null) return false;
      if (visited.has(node)) return false;
      visited.add(node);

      const record = node as Record<string, unknown>;
      const orBranches = Object.prototype.hasOwnProperty.call(record, 'or')
        ? record.or
        : Object.prototype.hasOwnProperty.call(record, 'any')
          ? record.any
          : null;
      if (orBranches != null) {
        for (const child of this.asArray(orBranches)) {
          const before = conditions.length;
          const found = visit(child, negated);
          if (found || conditions.length > before) return true;
        }
        return false;
      }
      if (Object.prototype.hasOwnProperty.call(record, 'not')) {
        return visit(record.not, !negated);
      }
      let found = false;
      for (const key of ['and', 'all', 'filters', 'children', 'data']) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
          found = visit(record[key], negated) || found;
        }
      }

      const inline = record.expression ?? record.expr ?? record.query ?? record.code ?? record.source ?? record.text ?? record.raw;
      if (typeof inline === 'string') {
        const parsed = this.parseInlineNoteFilterCondition(inline);
        if (parsed && !negated && this.isPositiveNoteEqualityOperator(parsed.operator)) {
          conditions.push(parsed);
          return true;
        }
      }

      const rawProperty =
        record.property ??
        record.field ??
        record.key ??
        record.column ??
        record.left ??
        record.lhs ??
        record.operand ??
        null;
      const property = this.readFilterToken(rawProperty);
      if (!property) return found;
      const rawOperator = record.op ?? record.operator ?? record.comparison ?? record.type ?? record.condition;
      const operator = this.readFilterToken(rawOperator);
      if (negated || !this.isPositiveNoteEqualityOperator(operator)) return found;
      let value =
        record.value ??
        record.pattern ??
        record.match ??
        record.right ??
        record.rhs ??
        record.target ??
        record.literal;
      if (value && typeof value === 'object' && 'value' in value) value = (value as any).value;
      conditions.push({ property, operator, value });
      return true;
    };

    visit(filters);
    return conditions;
  }

  private parseInlineNoteFilterCondition(expression: string): { property: string; operator: string; value: unknown } | null {
    const trimmed = String(expression || '').trim();
    if (!trimmed || trimmed.startsWith('!')) return null;

    const containsMatch = trimmed.match(/^([\w.]+)\.contains\((.+)\)\s*$/i);
    if (containsMatch) {
      return { property: containsMatch[1], operator: 'contains', value: this.stripFilterQuotes(containsMatch[2].trim()) };
    }

    const comparisonMatch = trimmed.match(/^([\w.]+)\s*(==|!=|=)\s*(.+)$/);
    if (comparisonMatch) {
      return { property: comparisonMatch[1], operator: comparisonMatch[2], value: this.stripFilterQuotes(comparisonMatch[3].trim()) };
    }

    const textualMatch = trimmed.match(/^([\w.]+)\s+(is|equals?)\s+(.+)$/i);
    if (textualMatch) {
      return { property: textualMatch[1], operator: textualMatch[2], value: this.stripFilterQuotes(textualMatch[3].trim()) };
    }

    return null;
  }

  private readFilterToken(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    return String(
      record.property ??
      record.name ??
      record.key ??
      record.field ??
      record.id ??
      record.label ??
      record.column ??
      '',
    ).trim();
  }

  private readFilterExpressionProperty(expr: string): string {
    const raw = String(expr || '').trim().replace(/^!+\s*/u, '');
    if (!raw) return '';
    const callMatch = raw.match(/^([\w.\s-]+)\.(?:contains|containsAny|equals|isEmpty|empty|exists|isNotEmpty)\b/i);
    if (callMatch?.[1]) return callMatch[1].trim();
    const wordMatch = raw.match(/^([\w.\s-]+?)\s+(?:contains|has|is not empty|is empty|isNotEmpty|exists|empty|is|equals?)\b/i);
    if (wordMatch?.[1]) return wordMatch[1].trim();
    const comparisonMatch = raw.match(/^([\w.\s-]+?)\s*(?:==|=|!=|!==)\s*/i);
    if (comparisonMatch?.[1]) return comparisonMatch[1].trim();
    return '';
  }

  private isPositiveNoteEqualityOperator(operator: string): boolean {
    const op = String(operator || '').toLowerCase().replace(/\s+/g, '');
    if (!op) return true;
    if (op.includes('not') || op.includes('!=') || op.includes('doesnot')) return false;
    return op === '=' || op === '==' || op.includes('is') || op.includes('equals');
  }

  private normalizeNoteFilterDefaultValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      const normalized = value
        .map((item) => this.normalizeNoteFilterDefaultValue(item))
        .filter((item) => item !== null);
      return normalized.length ? normalized : null;
    }
    if (value && typeof value === 'object' && 'value' in value) {
      return this.normalizeNoteFilterDefaultValue((value as any).value);
    }
    if (typeof value === 'string') {
      const trimmed = this.stripFilterQuotes(value.trim());
      if (!trimmed) return null;
      if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
      if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
      return trimmed;
    }
    return value ?? null;
  }

  private stripFilterQuotes(value: string): string {
    const trimmed = String(value || '').trim();
    if (trimmed.length >= 2) {
      const first = trimmed[0];
      const last = trimmed[trimmed.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return trimmed.slice(1, -1);
      }
    }
    return trimmed;
  }

  private getTaskRootFilterFromBaseFilters(roots = this.getBaseFilterRoots()): KanbanTaskRootFilter {
    const filter: KanbanTaskRootFilter = {
      mode: 'mixed',
      hasTaskDirective: false,
      includeBullets: false,
      includeHeadings: false,
      includeDone: false,
      statuses: new Set<string>(),
      excludeStatuses: new Set<string>(),
      tags: new Set<string>(),
      excludeTags: new Set<string>(),
    };
    for (const root of roots) {
      if (hasTpsFormulaReference(root)) {
        filter.hasTaskDirective = true;
        filter.includeBullets = true;
        filter.includeHeadings = true;
      }
      if (this.hasTaskDirectiveInFilterNode(root)) filter.hasTaskDirective = true;
      if (filterTreeIncludesStructuralKind(root, 'bullet')) filter.includeBullets = true;
      if (filterTreeIncludesStructuralKind(root, 'heading')) filter.includeHeadings = true;
      if (this.filterTreeIncludesAdditiveKind(root)) {
        filter.includeBullets = true;
        filter.includeHeadings = true;
      }
      this.collectTaskRootFilterNode(root, filter);
    }
    // A task-aware Base query owns completion visibility. Feed every task status
    // into its effective all-views + active-view predicates instead of applying
    // the legacy open-task preview gate first.
    if (filter.hasTaskDirective) filter.includeDone = true;
    const doneStatuses = this.getDoneStatuses();
    for (const status of filter.statuses) {
      if (doneStatuses.has(status)) filter.includeDone = true;
    }
    if (this.shouldShowCompletedTasks()) filter.includeDone = true;
    return filter;
  }

  private filterTreeIncludesAdditiveKind(node: unknown): boolean {
    if (!node) return false;
    if (Array.isArray(node)) return node.some((child) => this.filterTreeIncludesAdditiveKind(child));
    if (typeof node === 'string') {
      return /^(?:!+\s*)?(?:(?:tps|kanban)\.)?kind\s*(?:==|=|!=|!==|is|equals?)\s*/iu.test(node.trim());
    }
    if (typeof node !== 'object') return false;
    const record = node as Record<string, unknown>;
    const property = String(record.property ?? record.field ?? record.key ?? '').trim().toLowerCase();
    if (/^(?:(?:tps|kanban)\.)?kind$/u.test(property)) return true;
    return Object.values(record).some((value) => this.filterTreeIncludesAdditiveKind(value));
  }

  private filterNodeUsesWorkflowStatus(node: unknown): boolean {
    if (!node) return false;
    if (Array.isArray(node)) return node.some((child) => this.filterNodeUsesWorkflowStatus(child));
    if (typeof node === 'string') {
      const expr = node.trim().replace(/^!+\s*/u, '');
      const match = expr.match(/^((?:task\.)?(?:status|checkboxstatus|open|isopen|done|isdone|completed|complete))\b/iu);
      return !!match && !this.isRelationalStatusPropertyReference(match[1]);
    }
    if (typeof node !== 'object') return false;
    const record = node as Record<string, unknown>;
    const propRaw = String(record.property ?? record.field ?? '').trim();
    if (propRaw) {
      const normalized = this.normalizeInlinePropertyKey(propRaw.replace(/^(?:task|tps|kanban)\./iu, ''));
      if (['open', 'isopen', 'done', 'isdone', 'completed', 'complete', 'checkboxstatus'].includes(normalized)) return true;
      if (normalized === 'status' && !this.isRelationalStatusPropertyReference(propRaw)) return true;
    }
    return Object.values(record).some((value) => this.filterNodeUsesWorkflowStatus(value));
  }

  private hasTaskDirectiveInFilterNode(node: unknown): boolean {
    if (!node) return false;
    if (Array.isArray(node)) return node.some((child) => this.hasTaskDirectiveInFilterNode(child));
    if (typeof node === 'string') {
      const expr = node.trim().replace(/^!+\s*/u, '');
      return /^(?:(?:tps|kanban)\.)?(?:itemtype|itemkind|kind)\b/i.test(expr)
        || /^(?:task\.)?(?:status|tags?|open|isopen|done|isdone|completed|complete)\b/i.test(expr)
        || /^task\.(?:path|file|file\.path|file\.extension|file\.ext)\b/i.test(expr)
        || this.isSharedTaskValueFilterExpression(expr);
    }
    if (typeof node !== 'object') return false;
    const record = node as Record<string, unknown>;
    const propRaw = String(record.property ?? record.field ?? '').trim();
    const normalizedProp = this.normalizeInlinePropertyKey(propRaw.replace(/^(?:task|tps|kanban)\./i, ''));
    const propLower = propRaw.toLowerCase();
    if (propLower.startsWith('task.')
      || ['itemtype', 'itemkind', 'kind', 'tag', 'tags', 'status', 'checkboxstatus', 'open', 'isopen', 'done', 'isdone', 'completed', 'complete'].includes(normalizedProp)
      || (propRaw && !propLower.startsWith('note.') && !propLower.startsWith('file.') && !['path', 'file', 'filepath', 'fileextension', 'fileext'].includes(normalizedProp))) return true;
    return Object.values(record).some((value) => this.hasTaskDirectiveInFilterNode(value));
  }

  private collectTaskRootFilterNode(node: unknown, filter: KanbanTaskRootFilter, parentNegated = false): void {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const child of node) this.collectTaskRootFilterNode(child, filter, parentNegated);
      return;
    }
    if (typeof node === 'string') {
      this.collectTaskRootFilterString(parentNegated ? `!${node}` : node, filter);
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, 'not')) {
      this.collectTaskRootFilterNode(record.not, filter, !parentNegated);
    }
    if (Object.prototype.hasOwnProperty.call(record, 'or') || Object.prototype.hasOwnProperty.call(record, 'any')) {
      return;
    }
    this.collectTaskRootFilterObject(record, filter, parentNegated);
    for (const [key, value] of Object.entries(record)) {
      if (key === 'not') continue;
      this.collectTaskRootFilterNode(value, filter, parentNegated);
    }
  }

  private collectTaskRootFilterString(rawExpr: string, filter: KanbanTaskRootFilter): void {
    const raw = String(rawExpr || '').trim();
    const isNegated = raw.startsWith('!');
    const expr = (isNegated ? raw.slice(1) : raw).trim();
    if (!expr) return;
    const lower = expr.toLowerCase();

    if (parseBareSemanticKindExpression(expr)) {
      filter.hasTaskDirective = true;
      filter.mode = 'mixed';
      return;
    }

    const kindMatch = lower.match(/^(?:(?:tps|kanban)\.)?(itemtype|itemkind|kind)\s*(?:==|=)\s*["']?([^"']+?)["']?$/i);
    if (kindMatch?.[1] && kindMatch[2]) {
      const property = kindMatch[1].toLowerCase();
      const value = kindMatch[2].trim().toLowerCase();
      filter.hasTaskDirective = true;
      filter.mode = property === 'kind'
        ? 'mixed'
        : value.startsWith('task') ? 'tasks' : value.startsWith('bullet') ? 'bullets' : value.startsWith('note') ? 'notes' : 'mixed';
    }

    if (/^(?:task\.)?(?:open|isopen)\s*(?:==|=)\s*(true|1)$/i.test(expr)) {
      filter.hasTaskDirective = true;
      filter.includeDone = false;
    }
    if (/^(?:task\.)?(?:done|isdone|completed|complete)\s*(?:==|=)\s*(false|0)$/i.test(expr)) {
      filter.hasTaskDirective = true;
      filter.includeDone = false;
    }
    if (/^(?:task\.)?(?:done|isdone|completed|complete)\s*(?:==|=)\s*(true|1)$/i.test(expr)) {
      filter.hasTaskDirective = true;
      filter.includeDone = true;
    }

    if (!isRelationalStatusFilterExpression(expr, this.getGcmSettings()?.properties)) {
      this.collectTaskValuesFromFilterExpression(
        expr,
        'status',
        filter.statuses,
        filter.excludeStatuses,
        filter,
        isNegated,
        false,
      );
    }
    this.collectTaskValuesFromFilterExpression(expr, 'tags', filter.tags, filter.excludeTags, filter, isNegated, false);
  }

  private collectTaskValuesFromFilterExpression(
    expr: string,
    propName: 'status' | 'tags',
    includeTarget: Set<string>,
    excludeTarget: Set<string>,
    filter: KanbanTaskRootFilter,
    isNegated = false,
    requireTaskPrefix = false,
  ): void {
    const propPattern = `${requireTaskPrefix ? 'task\\.' : '(?:task\\.)?'}${propName === 'tags' ? '(?:tags|tag)' : 'status'}`;
    const addToken = (rawToken: string, target: Set<string>) => {
      const token = propName === 'tags' ? this.normalizeTaskTag(rawToken) : rawToken.trim().toLowerCase();
      if (token) target.add(token);
    };
    const callTarget = isNegated ? excludeTarget : includeTarget;
    const containsAnyMatch = expr.match(new RegExp(`^${propPattern}\\.containsAny\\((.*)\\)$`, 'i'));
    if (containsAnyMatch) {
      filter.hasTaskDirective = true;
      for (const token of this.extractFilterTokens(containsAnyMatch[1] || '')) {
        addToken(token, callTarget);
      }
    }
    const containsMatch = expr.match(new RegExp(`^${propPattern}\\.contains\\((.*)\\)$`, 'i'));
    if (containsMatch) {
      filter.hasTaskDirective = true;
      for (const token of this.extractFilterTokens(containsMatch[1] || '')) {
        addToken(token, callTarget);
      }
    }
    const equalsCallMatch = expr.match(new RegExp(`^${propPattern}\\.equals\\((.*)\\)$`, 'i'));
    if (equalsCallMatch) {
      filter.hasTaskDirective = true;
      for (const token of this.extractFilterTokens(equalsCallMatch[1] || '')) {
        addToken(token, callTarget);
      }
    }
    const wordOperatorMatch = expr.match(new RegExp(`^${propPattern}\\s+(contains|has|is|equals?)\\s*(.*)$`, 'i'));
    if (wordOperatorMatch?.[2]) {
      filter.hasTaskDirective = true;
      for (const token of this.extractFilterTokens(wordOperatorMatch[2] || '')) {
        addToken(token, callTarget);
      }
    }
    const comparisonMatch = expr.match(new RegExp(`^${propPattern}\\s*(==|=|!=|!==|is|equals?)\\s*(?:"([^"]+)"|'([^']+)'|(.+))$`, 'i'));
    if (comparisonMatch?.[2] || comparisonMatch?.[3] || comparisonMatch?.[4]) {
      filter.hasTaskDirective = true;
      const target = isNegated || String(comparisonMatch[1] || '').startsWith('!') ? excludeTarget : includeTarget;
      addToken(comparisonMatch[2] || comparisonMatch[3] || comparisonMatch[4], target);
    }
  }

  private collectTaskRootFilterObject(node: Record<string, unknown>, filter: KanbanTaskRootFilter, parentNegated = false): void {
    const propRaw = String(node.property ?? node.field ?? '').trim();
    if (!propRaw) return;
    const normalizedProp = this.normalizeTaskPropertyId(propRaw);
    const rawValues = node.values ?? node.value;
    const values = Array.isArray(rawValues) ? rawValues : rawValues == null ? [] : [rawValues];
    const operator = String(node.operator ?? node.op ?? '').trim().toLowerCase();
    const isNegated = parentNegated || operator.startsWith('!') || operator.includes('not') || operator === '!=' || operator === '!==';

    if (isBareSemanticKindFilter(propRaw, values)) {
      filter.hasTaskDirective = true;
      filter.mode = 'mixed';
      return;
    }

    if (['itemtype', 'itemkind', 'kind'].includes(normalizedProp)) {
      for (const raw of values) {
        const value = String(raw || '').trim().toLowerCase();
        if (!value) continue;
        filter.hasTaskDirective = true;
        filter.mode = normalizedProp === 'kind'
          ? 'mixed'
          : value.startsWith('task') ? 'tasks' : value.startsWith('bullet') ? 'bullets' : value.startsWith('note') ? 'notes' : 'mixed';
      }
      return;
    }

    if (['open', 'isopen'].includes(normalizedProp)) {
      filter.hasTaskDirective = true;
      filter.includeDone = values.some((value) => String(value).toLowerCase() === 'true' || String(value) === '1') ? false : filter.includeDone;
      return;
    }

    if (['done', 'isdone', 'completed', 'complete'].includes(normalizedProp)) {
      filter.hasTaskDirective = true;
      return;
    }

    if (
      (propRaw.toLowerCase().startsWith('task.') || normalizedProp === 'status' || normalizedProp === 'checkboxstatus')
      && ['status', 'checkboxstatus'].includes(normalizedProp)
      && !this.isRelationalStatusPropertyReference(propRaw)
    ) {
      filter.hasTaskDirective = true;
      const target = isNegated ? filter.excludeStatuses : filter.statuses;
      for (const raw of values) {
        const value = String(raw || '').trim().toLowerCase();
        if (value) target.add(value);
      }
      return;
    }

    if (!propRaw.toLowerCase().startsWith('note.') && ['tag', 'tags'].includes(normalizedProp)) {
      filter.hasTaskDirective = true;
      const target = isNegated ? filter.excludeTags : filter.tags;
      for (const raw of values) {
        const value = this.normalizeTaskTag(String(raw || ''));
        if (value) target.add(value);
      }
    }
  }

  private collectForcedLanesFromFilterNode(
    node: unknown,
    propName: string,
    keys: Set<string>,
    includeUngrouped: { value: boolean },
  ): void {
    if (!node) return;

    if (Array.isArray(node)) {
      for (const child of node) {
        this.collectForcedLanesFromFilterNode(child, propName, keys, includeUngrouped);
      }
      return;
    }

    if (typeof node === 'string') {
      this.collectForcedLanesFromFilterString(node, propName, keys, includeUngrouped);
      return;
    }

    if (typeof node !== 'object') return;
    this.collectForcedLanesFromFilterObject(node as Record<string, unknown>, propName, keys, includeUngrouped);

    for (const value of Object.values(node as Record<string, unknown>)) {
      this.collectForcedLanesFromFilterNode(value, propName, keys, includeUngrouped);
    }
  }

  private collectForcedLanesFromFilterString(
    rawExpr: string,
    propName: string,
    keys: Set<string>,
    includeUngrouped: { value: boolean },
  ): void {
    const expr = String(rawExpr || '').trim();
    if (!expr || expr.startsWith('!')) return;

    const escaped = this.getTaskInlinePropertyName(propName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const propPattern = `(?:note\\.|task\\.)?${escaped}`;

    const containsAnyMatch = expr.match(new RegExp(`^${propPattern}\\.containsAny\\((.*)\\)$`, 'i'));
    if (containsAnyMatch) {
      const args = containsAnyMatch[1] || '';
      for (const token of this.extractQuotedStrings(args)) {
        keys.add(token);
      }
    }

    const equalsCallMatch = expr.match(new RegExp(`^${propPattern}\\.equals\\((.*)\\)$`, 'i'));
    if (equalsCallMatch) {
      const [first] = this.extractFilterTokens(equalsCallMatch[1] || '');
      const resolved = this.resolveBaseContextToken(first);
      if (resolved) keys.add(resolved);
    }

    const comparisonMatch = expr.match(new RegExp(`^${propPattern}\\s*(==|=|is|equals?)\\s*(?:"([^"]+)"|'([^']+)'|([^\\s].*?))$`, 'i'));
    if (comparisonMatch?.[2] || comparisonMatch?.[3] || comparisonMatch?.[4]) {
      const resolved = this.resolveBaseContextToken(comparisonMatch[2] || comparisonMatch[3] || comparisonMatch[4]);
      if (resolved) keys.add(resolved);
    }

    const isEmptyMatch = expr.match(new RegExp(`^${propPattern}\\.isEmpty\\(\\)$`, 'i'));
    if (isEmptyMatch) includeUngrouped.value = true;
  }

  private collectForcedLanesFromFilterObject(
    node: Record<string, unknown>,
    propName: string,
    keys: Set<string>,
    includeUngrouped: { value: boolean },
  ): void {
    const propRaw =
      (typeof node.property === 'string' ? node.property : '') ||
      (typeof node.field === 'string' ? node.field : '');
    if (!propRaw) return;

    const normalizedProp = this.normalizeInlinePropertyKey(this.getTaskInlinePropertyName(propRaw));
    if (normalizedProp !== this.normalizeInlinePropertyKey(this.getTaskInlinePropertyName(propName))) return;

    const op = String(node.operator ?? node.op ?? '').toLowerCase();
    if (op.includes('empty')) {
      includeUngrouped.value = true;
      return;
    }

    const rawValues = node.values ?? node.value;
    if (Array.isArray(rawValues)) {
      for (const value of rawValues) {
        const resolved = this.resolveBaseContextToken(value);
        if (resolved) keys.add(resolved);
      }
      return;
    }

    const resolved = this.resolveBaseContextToken(rawValues);
    if (resolved) {
      keys.add(resolved);
    }
  }

  private extractQuotedStrings(text: string): string[] {
    const values: string[] = [];
    const regex = /"([^"]+)"|'([^']+)'/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const value = (match[1] ?? match[2] ?? '').trim();
      if (value) values.push(value);
    }
    return values;
  }

  private extractFilterTokens(text: string): string[] {
    const raw = String(text || '').trim();
    if (!raw) return [];
    const quoted = this.extractQuotedStrings(raw);
    if (quoted.length) return quoted;
    return raw
      .split(/[,;]/gu)
      .map((value) => value.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }

  private getLaneId(group: BasesEntryGroup): string {
    if (!group.hasKey() || group.key == null) return 'ungrouped';
    return getTpsBaseGroupLaneId(group.key);
  }

  private mergeGroupsByLaneId(groups: BasesEntryGroup[]): BasesEntryGroup[] {
    const laneOrder: string[] = [];
    const laneEntries = new Map<string, Map<string, BasesEntry>>();
    const laneLabel = new Map<string, string | null>();

    for (const group of groups) {
      const laneId = this.getLaneId(group);
      if (!laneEntries.has(laneId)) {
        laneOrder.push(laneId);
        laneEntries.set(laneId, new Map<string, BasesEntry>());
        laneLabel.set(
          laneId,
          laneId === 'ungrouped'
            ? null
            : String(group.key ?? '').trim() || null,
        );
      }

      const entriesByPath = laneEntries.get(laneId)!;
      for (const entry of group.entries) {
        if (!entriesByPath.has(entry.file.path)) {
          entriesByPath.set(entry.file.path, entry);
        }
      }
    }

    return laneOrder.map((laneId) => {
      const entries = Array.from((laneEntries.get(laneId) ?? new Map()).values());
      const key = laneId === 'ungrouped' ? null : (laneLabel.get(laneId) ?? null);
      return {
        key,
        entries,
        hasKey: () => key != null,
      } as unknown as BasesEntryGroup;
    });
  }

  private getLaneOrderViewId(): string {
    const sourcePath = this.getBaseSourcePath() || 'unknown-base';
    const viewName = String(this.config?.name || 'kanban').trim() || 'kanban';
    return `${sourcePath}::${viewName}`;
  }

  private getLegacyUnknownBaseViewId(): string {
    const viewName = String(this.config?.name || 'kanban').trim() || 'kanban';
    return `unknown-base::${viewName}`;
  }

  private shouldShowCompletedTasks(): boolean {
    const viewId = this.getLaneOrderViewId();
    const map = (this.plugin.settings?.showCompletedTasksByView || {}) as Record<string, boolean>;
    const legacyViewId = this.getLegacyUnknownBaseViewId();
    return (map[viewId] ?? map[legacyViewId]) === true;
  }

  private applyManualLaneOrder(groups: BasesEntryGroup[]): BasesEntryGroup[] {
    const ungrouped = groups.filter((group) => this.getLaneId(group) === 'ungrouped');
    const keyed = groups.filter((group) => this.getLaneId(group) !== 'ungrouped');
    const settings = this.plugin.settings;
    const map = (settings?.laneOrderByView || {}) as Record<string, string[]>;
    const viewId = this.getLaneOrderViewId();
    const legacyViewId = this.getLegacyUnknownBaseViewId();
    const saved = Array.isArray(map[viewId]) ? map[viewId] : Array.isArray(map[legacyViewId]) ? map[legacyViewId] : [];
    let orderedKeyed = keyed;
    if (saved.length) {
      const rank = new Map<string, number>();
      saved.forEach((id, i) => rank.set(String(id), i));

      orderedKeyed = keyed
        .map((group, index) => ({ group, index, laneId: this.getLaneId(group) }))
        .sort((a, b) => {
          const ar = rank.has(a.laneId) ? (rank.get(a.laneId) as number) : Number.MAX_SAFE_INTEGER;
          const br = rank.has(b.laneId) ? (rank.get(b.laneId) as number) : Number.MAX_SAFE_INTEGER;
          if (ar !== br) return ar - br;
          return a.index - b.index;
        })
        .map((item) => item.group);
    }

    // The per-view Top/Bottom control is authoritative. Saved manual lane order may rank
    // real groups, but a stale `ungrouped` rank must never override the current view setting.
    return this.getUngroupedPosition() === 'first'
      ? [...ungrouped, ...orderedKeyed]
      : [...orderedKeyed, ...ungrouped];
  }

  private getSelectedFiles(): TFile[] {
    const selected: TFile[] = [];
    const seen = new Set<string>();
    const rows = this.containerEl.querySelectorAll<HTMLElement>(
      '.tps-list-native-row--note[data-path][data-tps-list-selection-id]',
    );
    rows.forEach((row) => {
      const path = row.dataset.path;
      const selectionId = row.dataset.tpsListSelectionId;
      if (!path || !selectionId || !this.selectedRowIds.has(selectionId) || seen.has(path)) return;
      const af = this.app.vault.getAbstractFileByPath(path);
      if (af instanceof TFile) {
        seen.add(path);
        selected.push(af);
      }
    });
    return selected;
  }

  private syncSelectionClasses(): void {
    const rows = this.containerEl.querySelectorAll<HTMLElement>(
      '.tps-list-native-row[data-tps-list-selection-id]',
    );
    rows.forEach((row) => {
      const selectionId = row.dataset.tpsListSelectionId;
      const path = row.dataset.path;
      const selected = !!selectionId && this.selectedRowIds.has(selectionId);
      row.classList.toggle('tps-list-native-row--selected', selected);
      row.classList.toggle(
        'tps-list-native-row--open-note',
        row.matches('.tps-list-native-row--note') && !!path && !!this.activeNotePath && path === this.activeNotePath,
      );
      row.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  private getActiveMarkdownPath(): string | null {
    const active = this.app.workspace.getActiveFile();
    return active instanceof TFile ? active.path : null;
  }

  private selectOnlyRow(selectionId: string): void {
    this.selectedRowIds.clear();
    this.selectedRowIds.add(selectionId);
    this.selectionAnchorRowId = selectionId;
    this.syncSelectionClasses();
  }

  private toggleRowSelection(selectionId: string): boolean {
    const result = toggleOrderedSelection(this.selectedRowIds, selectionId, this.renderedRowOrder);
    this.selectedRowIds = result.selected;
    this.selectionAnchorRowId = result.anchor;
    this.syncSelectionClasses();
    return result.removed;
  }

  private selectRowRange(selectionId: string): number {
    const range = getOrderedSelectionRange(this.renderedRowOrder, this.selectionAnchorRowId, selectionId);
    this.selectedRowIds.clear();
    for (const selectedRowId of range) this.selectedRowIds.add(selectedRowId);
    this.syncSelectionClasses();
    return range.length;
  }

  private getSelectedRows(): HTMLElement[] {
    return Array.from(this.containerEl.querySelectorAll<HTMLElement>(
      '.tps-list-native-row[data-tps-list-selection-id]',
    )).filter((row) => {
      const selectionId = row.dataset.tpsListSelectionId;
      return !!selectionId && this.selectedRowIds.has(selectionId);
    });
  }

  /** Shared by the document-level task handler so every TPS List row uses one visible selection order. */
  applyTpsListRowSelection(event: MouseEvent, target: HTMLElement, preserveIfSelected = false): Promise<void> {
    const row = target.closest<HTMLElement>('.tps-list-native-row[data-tps-list-selection-id]');
    const selectionId = row?.dataset.tpsListSelectionId;
    if (!row || !selectionId || !this.containerEl.contains(row)) return Promise.resolve();

    let mode = 'single';
    let visibleRangeCount: number | undefined;
    if (event.shiftKey) {
      const hasAnchor = !!this.selectionAnchorRowId && this.renderedRowOrder.includes(this.selectionAnchorRowId);
      if (hasAnchor) {
        visibleRangeCount = this.selectRowRange(selectionId);
        mode = 'range';
      } else {
        this.selectOnlyRow(selectionId);
        visibleRangeCount = 1;
        mode = 'range-fallback';
      }
    } else if (event.metaKey || event.ctrlKey) {
      mode = this.toggleRowSelection(selectionId) ? 'toggle-off' : 'toggle-on';
    } else if (!(preserveIfSelected && this.selectedRowIds.has(selectionId))) {
      this.selectOnlyRow(selectionId);
    } else {
      mode = 'preserve';
    }

    const selectedRows = this.getSelectedRows();
    flow('TpsListView', 'selection:changed', {
      mode,
      selectedCount: selectedRows.length,
      ...(visibleRangeCount == null ? {} : { visibleRangeCount }),
    });
    const taskSelectionService = this.getGcmPlugin()?.taskLineContextMenuService
      || this.getGcmApi()?.taskLineContextMenuService;
    if (typeof taskSelectionService?.syncTpsListSelectionRows !== 'function') return Promise.resolve();
    const anchorRow = this.selectionAnchorRowId
      ? Array.from(this.containerEl.querySelectorAll<HTMLElement>(
          '.tps-list-native-row[data-tps-list-selection-id]',
        )).find((candidate) => candidate.dataset.tpsListSelectionId === this.selectionAnchorRowId) ?? null
      : null;
    return taskSelectionService.syncTpsListSelectionRows(selectedRows, anchorRow, this.scrollEl);
  }

  private registerListRowModifierSelection(row: HTMLElement): void {
    row.addEventListener('click', (event: MouseEvent) => {
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void this.applyTpsListRowSelection(event, row);
    }, { capture: true });
  }

  private getTaskPropertyValue(file: TFile, task: OpenTaskSubitem, propId: string, hidden: Set<string>): TpsTaskPropertyDisplay | null {
    if (/^formula\./iu.test(String(propId || '').trim())) {
      const result = this.getTaskFormulaSession(file, task).get(propId);
      if (result.status === 'error' || result.status === 'unsupported') {
        this.reportFormulaFailure(result, file, task);
        return {
          text: '⚠ Formula',
          title: result.message || result.code || 'Formula evaluation failed',
          kind: 'formula-error',
          editable: false,
        };
      }
      const presentation = getReadOnlyBooleanFormulaPresentation(result.value);
      if (presentation) {
        return {
          text: presentation.text,
          title: `${propId}: ${presentation.text}`,
          kind: 'checkbox',
          editable: false,
          rawValue: result.value,
        };
      }
      const text = formatTpsFormulaValue(result.value);
      return text ? { text, title: text, kind: 'formula', editable: false } : null;
    }
    const normalized = this.normalizeTaskPropertyId(propId);
    const propertyIdentity = normalizePropertyKeyIdentity(this.getTaskInlinePropertyName(propId));
    if (!normalized || hidden.has(propertyIdentity)) return null;
    const workflowStatusReference = this.isStatusPropertyName(propId);
    const configuredForProperty = workflowStatusReference
      ? null
      : this.getConfiguredCustomProperty(propId);

    // Folder properties describe the source file location. They are never an
    // inline line field, and rendering a stale [folderPath:: ...] value would
    // contradict the file that owns the task/bullet/heading.
    if (configuredForProperty?.type === 'folder') {
      const folder = file.parent?.path || '/';
      return {
        text: folder,
        title: `Source folder: ${folder}`,
        kind: 'folder',
        editable: false,
        rawValue: folder,
      };
    }

    if (configuredForProperty?.type === 'kind' && normalized === 'kind') {
      const explicitKinds = this.getTaskExplicitKindValues(task);
      if (!explicitKinds.length) return null;
      const value = explicitKinds.join(', ');
      return {
        text: value,
        title: `${configuredForProperty.label || configuredForProperty.key}: ${value}`,
        kind: 'kind',
        editable: true,
        propName: configuredForProperty.key,
        rawValue: value,
      };
    }

    if ((normalized === 'status' || normalized === 'checkboxstatus') && workflowStatusReference) {
      if (task.itemKind === 'heading') return null;
      const status = task.itemKind === 'bullet' ? 'bullet' : this.getMappedStatusForTask(task);
      return status ? {
        text: status,
        kind: 'status',
        editable: task.itemKind !== 'bullet',
        propName: String(propId || '').trim() || 'status',
        rawValue: status,
      } : null;
    }

    if (normalized === 'kind' || normalized === 'itemkind' || normalized === 'itemtype') {
      const kind = task.itemKind === 'heading' ? `h${task.headingLevel || 1}` : task.itemKind === 'bullet' ? 'bullet' : 'task';
      return { text: kind, kind: 'kind', editable: false };
    }

    if (normalized === 'title' || normalized === 'text' || normalized === 'linetext' || normalized === 'headingtext') {
      return { text: this.getTaskVisibleTitle(task), kind: 'title', editable: false };
    }

    if ((normalized === 'level' || normalized === 'headinglevel') && task.itemKind === 'heading' && task.headingLevel) {
      return { text: String(task.headingLevel), kind: 'heading-level', editable: false };
    }

    if (normalized === 'path' || normalized === 'file' || normalized === 'source') {
      return { text: file.basename, title: file.path, kind: 'source', editable: false };
    }

    if (normalized === 'line') {
      return { text: String(task.line), title: `${file.path}:${task.line}`, kind: 'line', editable: false };
    }

    if (normalized === 'tag' || normalized === 'tags') {
      const tags = this.getTaskInlineValues(task, 'tags')
        .map((tag) => tag.replace(/^#/, ''))
        .filter(Boolean);
      if (tags.length === 0) return null;
      const configuredProperty = configuredForProperty
        || this.getConfiguredCustomProperty('tags');
      return {
        text: tags.map((tag) => `#${tag}`).join(', '),
        title: tags.map((tag) => `#${tag}`).join(', '),
        kind: 'tag',
        editable: true,
        propName: configuredProperty?.key || 'tags',
        rawValue: tags.map((tag) => `#${tag}`).join(', '),
      };
    }

    if (configuredForProperty?.type === 'list') {
      const values = this.getTaskInlineValues(task, configuredForProperty.key)
        .flatMap((value) => this.parseConfiguredListValues(configuredForProperty, value));
      const unique = Array.from(new Set(values));
      if (unique.length === 0) return null;
      const rawValue = unique.join(', ');
      const text = isEntityReferenceProperty(configuredForProperty)
        ? this.formatEntityPropertyValue(rawValue, configuredForProperty)
        : this.formatTaskCardField(configuredForProperty.key, rawValue);
      return {
        text,
        title: `${configuredForProperty.label || configuredForProperty.key}: ${rawValue}`,
        kind: isEntityReferenceProperty(configuredForProperty) ? 'entity' : 'list',
        editable: true,
        propName: configuredForProperty.key,
        rawValue,
      };
    }

    for (const field of task.inlineFields ?? []) {
      const key = normalizePropertyKeyIdentity(field.key);
      if (!key || key !== propertyIdentity || hidden.has(key)) continue;
      const value = String(field.value || '').trim();
      if (!value) return null;
      const configuredProperty = configuredForProperty
        || this.getConfiguredCustomProperty(field.key);
      if (isBooleanPropertyType(configuredProperty?.type)) {
        const booleanValue: unknown = value === 'true' ? true : value === 'false' ? false : value;
        const presentation = getBooleanPropertyPresentation(booleanValue);
        return {
          text: presentation.text,
          title: `${configuredProperty?.label || field.key}: ${presentation.text}`,
          kind: 'checkbox',
          editable: true,
          propName: configuredProperty?.key || field.key,
          rawValue: booleanValue,
        };
      }
      const entityReference = isEntityReferenceProperty(configuredProperty);
      const text = entityReference
        ? this.formatEntityPropertyValue(value, configuredProperty!)
        : this.formatTaskCardField(field.key, value);
      if (!text) return null;
      return {
        text,
        title: key === 'tag' || key === 'tags' ? value : `${field.key}: ${value}`,
        kind: entityReference ? 'entity' : key === 'tag' || key === 'tags' ? 'tag' : key,
        editable: true,
        propName: field.key,
        rawValue: value,
      };
    }

    return null;
  }

  private normalizeTaskPropertyId(propId: string): string {
    const raw = String(propId || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    const virtualAliases: Record<string, string> = {
      'file.name': 'path',
      'file.basename': 'path',
      'file.fullname': 'path',
      'file.link': 'path',
      'task.title': 'title',
      'task.text': 'text',
      'task.status': 'status',
      'task.checkboxstatus': 'checkboxstatus',
      'task.tags': 'tags',
      'task.tag': 'tag',
      'line.title': 'linetext',
      'line.text': 'linetext',
      'line.number': 'line',
      'heading.title': 'headingtext',
      'heading.text': 'headingtext',
      'heading.level': 'headinglevel',
      'heading.line': 'line',
    };
    if (virtualAliases[lower]) return virtualAliases[lower];
    if (lower === 'title') return 'title';
    const frontmatterProp = this.getFrontmatterPropNameFromId(raw);
    const withoutPrefix = lower.startsWith('task.') ? raw.slice(5) : frontmatterProp ?? raw;
    const normalized = this.normalizeInlinePropertyKey(withoutPrefix);
    if (normalized === 'filename' || normalized === 'basename' || normalized === 'fullname') return 'path';
    return normalized;
  }

  private formatTaskCardField(key: string, value: string): string {
    const normalized = this.normalizeInlinePropertyKey(key);
    if (normalized === 'tag' || normalized === 'tags') return value.replace(/^#/, '');
    if (this.isDateLikeProperty(normalized)) {
      const dateTime = this.formatCardPropertyValue(value);
      if (dateTime && dateTime !== value) return dateTime;
      const timeMatch = value.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/u);
      if (timeMatch) {
        const hour = Number(timeMatch[1]);
        const minute = timeMatch[2];
        if (Number.isFinite(hour)) {
          const suffix = hour >= 12 ? 'PM' : 'AM';
          const displayHour = hour % 12 || 12;
          return `${displayHour}:${minute} ${suffix}`;
        }
      }
      return dateTime || value;
    }
    if (this.isDurationLikeProperty(normalized)) return this.formatDurationLikeValue(value);
    const text = this.formatCardPropertyValue(value);
    return text.length > 34 ? `${text.slice(0, 31)}...` : text;
  }

  private isDateLikeProperty(normalizedKey: string): boolean {
    return normalizedKey === 'scheduled'
      || normalizedKey === 'due'
      || normalizedKey === 'start'
      || normalizedKey === 'end'
      || normalizedKey === 'date'
      || normalizedKey === 'created'
      || normalizedKey === 'modified'
      || normalizedKey === 'ctime'
      || normalizedKey === 'mtime'
      || normalizedKey.endsWith('date')
      || normalizedKey.endsWith('time')
      || normalizedKey.endsWith('at');
  }

  private isDurationLikeProperty(normalizedKey: string): boolean {
    return normalizedKey === 'timeestimate'
      || normalizedKey === 'estimate'
      || normalizedKey === 'duration'
      || normalizedKey.endsWith('duration');
  }

  private formatDurationLikeValue(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/[a-z]/i.test(raw)) return raw;
    return `${raw}m`;
  }

  private getCheckboxMarker(rawState: string): string {
    const state = this.normalizeCheckboxState(rawState);
    return state.slice(1, -1);
  }

  private async createRootTaskForLane(
    propName: string | null,
    displayLane: DisplayLaneGroup,
    taskFilter = this.getTaskRootFilterFromBaseFilters(),
    itemKind: KanbanRootLineKind = getKanbanRootLineKind(this.getPriorityResolvedCreationMode(taskFilter)) ?? 'task',
    creationFilterRoots?: unknown[],
    resolvedCreationDefaults?: TaskCreationDefaults,
  ): Promise<void> {
    const effectiveFilterRoots = creationFilterRoots ?? await this.getBaseFilterRootsForCreation();
    const effectiveTaskFilter = creationFilterRoots
      ? taskFilter
      : this.getTaskRootFilterFromBaseFilters(effectiveFilterRoots);
    const targetSelection = propName
      ? await this.resolveDropValueForDisplayLane(displayLane)
      : { selected: true, value: null as string | null };
    if (!targetSelection.selected) {
      flow('CreateRootTask', 'cancelled-target', { lane: displayLane.label, itemKind });
      return;
    }

    const title = await this.promptForRootLineTitle(itemKind);
    if (!title) {
      flow('CreateRootTask', 'cancelled-title', { lane: displayLane.label, itemKind });
      return;
    }

    const inferredDefaults = resolvedCreationDefaults ?? this.getRootTaskCreationDefaults(effectiveTaskFilter, effectiveFilterRoots);
    const laneOwnsStatus = !!propName
      && this.isStatusPropertyName(propName)
      && !!String(targetSelection.value || '').trim();
    const defaults = itemKind === 'task' && !laneOwnsStatus && !inferredDefaults.status
      ? { ...inferredDefaults, status: this.getDefaultMappedTaskStatus('open') }
      : inferredDefaults;
    const taskLine = this.buildRootTaskLine(title, propName, targetSelection.value, effectiveTaskFilter, itemKind, defaults);
    if (!taskLine) {
      const desiredStatus = propName && this.isStatusPropertyName(propName) && String(targetSelection.value || '').trim()
        ? String(targetSelection.value)
        : defaults.status || '(unavailable)';
      flowWarn('CreateRootTask', 'unmapped-status', {
        lane: displayLane.label,
        itemKind,
        status: desiredStatus,
      });
      new Notice(`Could not create the task because status "${desiredStatus}" has no checkbox mapping.`);
      return;
    }
    const desiredTaskStatus = itemKind === 'task'
      ? this.normalizeTaskStatus(
          laneOwnsStatus ? targetSelection.value : defaults.status,
        )
      : '';
    const plannedCheckboxState = itemKind === 'task'
      ? this.normalizeCheckboxState(this.parseLineItem(taskLine, true)?.checkboxState || '')
      : '';
    const targetFile = await this.resolveRootTaskTargetFile(defaults);
    if (!targetFile) {
      flowWarn('CreateRootTask', 'missing-target', {
        lane: displayLane.label,
        itemKind,
        defaultTargetPath: defaults.targetPath || '',
        configuredDefaultRootTaskPath: this.plugin.settings?.defaultRootTaskPath || '',
      });
      new Notice('Could not resolve a note to write the task into.');
      return;
    }

    flow('CreateRootTask', 'write', {
      path: targetFile.path,
      lane: displayLane.label,
      itemKind,
      propName: propName || '',
      targetValue: targetSelection.value,
      status: defaults.status || '',
      tags: Array.from(defaults.tags || []),
      inlineKeys: Array.from(defaults.inlineFields?.keys?.() || []),
      openAfterCreate: this.plugin.settings.openTaskDestinationAfterCreate !== false,
    });
    this.formulaNow = new Date();
    this.taskFormulaSessions = new WeakMap<OpenTaskSubitem, TpsFormulaRowSession>();
    const historyService = this.plugin?.itemHistoryService;
    const historyContext: DirectTaskHistoryLogContext = {
      action: 'task.create',
      surface: 'tps-list',
      path: targetFile.path,
      lineNumber: 0,
    };
    const historyHandle = itemKind === 'task'
      ? await beginDirectTaskHistory(historyService, {
          action: historyContext.action,
          cause: {
            kind: 'user',
            sourcePluginId: 'tps-global-context-menu',
            surface: historyContext.surface,
          },
          before: {
            path: targetFile.path,
            lineNumber: 0,
            rawLine: taskLine,
          },
        })
      : null;
    let blockedReason: 'mismatch' | 'formula-unresolved' | 'mapping-changed' | null = null;
    let insertedLine = taskLine;
    let insertedLineIndex = -1;
    let historyReady = true;
    let writeAccepted = false;
    let processedContent = '';
    try {
      processedContent = await this.app.vault.process(targetFile, (content) => {
        if (itemKind === 'task') {
          const liveState = this.getCheckboxStateForStatus(desiredTaskStatus);
          const liveStatus = plannedCheckboxState
            ? this.getStatusForCheckboxState(plannedCheckboxState)
            : '';
          if (
            !desiredTaskStatus
            || !plannedCheckboxState
            || liveState !== plannedCheckboxState
            || liveStatus !== desiredTaskStatus
          ) {
            blockedReason = 'mapping-changed';
            return content;
          }
        }
        const nextLineNumber = this.getAppendedLineNumber(content);
        insertedLineIndex = nextLineNumber - 1;
        insertedLine = taskLine;
        if (itemKind === 'task') {
          const historyIdentity = ensureDirectTaskHistoryIdentity(
            historyService,
            historyHandle,
            taskLine,
            historyContext,
          );
          insertedLine = historyIdentity.line;
          historyReady = historyIdentity.ready;
        }
        const creationFilterMatch = this.lineMatchesCreationFilters(
          insertedLine,
          targetFile,
          effectiveFilterRoots,
          nextLineNumber,
        );
        if (creationFilterMatch === false) {
          blockedReason = 'mismatch';
          return content;
        }
        if (creationFilterMatch == null && hasTpsFormulaReference(effectiveFilterRoots)) {
          blockedReason = 'formula-unresolved';
          return content;
        }
        if (creationFilterMatch == null) {
          flowWarn('CreateRootTask', 'filter-validation-partial', {
            path: targetFile.path,
            itemKind,
            nextLineNumber,
          });
        }
        writeAccepted = true;
        historyContext.lineNumber = insertedLineIndex;
        return this.insertLineAfterFrontmatter(content, insertedLine);
      });
    } catch (error) {
      let reconciled = false;
      if (writeAccepted && insertedLineIndex >= 0) {
        try {
          const currentContent = await this.app.vault.read(targetFile);
          const currentLines = String(currentContent || '').split(/\r?\n/u);
          const exactMatches = currentLines
            .map((line, index) => line === insertedLine ? index : -1)
            .filter((index) => index >= 0);
          const confirmedIndex = currentLines[insertedLineIndex] === insertedLine
            ? insertedLineIndex
            : historyHandle && historyReady && exactMatches.length === 1
              ? exactMatches[0]
              : -1;
          if (confirmedIndex >= 0) {
            insertedLineIndex = confirmedIndex;
            historyContext.lineNumber = confirmedIndex;
            processedContent = currentContent;
            reconciled = true;
            flow('CreateRootTask', 'write-reconciled', {
              path: targetFile.path,
              itemKind,
              insertedLineNumber: confirmedIndex + 1,
            });
          }
        } catch (readError) {
          flowError('CreateRootTask', 'write-reconciliation-failed', readError, {
            path: targetFile.path,
            itemKind,
          });
        }
      }
      if (!reconciled) {
        if (!writeAccepted || !historyHandle || !historyReady) {
          await abortDirectTaskHistory(historyService, historyHandle, historyContext);
        }
        flowError('CreateRootTask', 'write-failed', error, {
          path: targetFile.path,
          itemKind,
          historyResolution: writeAccepted && historyHandle && historyReady ? 'pending-recovery' : 'aborted',
        });
        new Notice(`Could not create the ${itemKind}.`);
        return;
      }
    }
    if (blockedReason) {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      flowWarn('CreateRootTask', 'blocked', {
        reason: blockedReason === 'mismatch'
          ? 'prospective-line-does-not-match-filters'
          : blockedReason === 'mapping-changed'
            ? 'checkbox-mapping-changed'
            : 'formula-filter-unresolved',
        path: targetFile.path,
        itemKind,
      });
      new Notice(blockedReason === 'mismatch'
        ? 'TPS List did not create the item because the resulting line would not match this view.'
        : blockedReason === 'mapping-changed'
          ? 'TPS List did not create the task because its checkbox mapping changed before the write.'
          : 'TPS List did not create the item because its formula filter could not be evaluated reliably.');
      return;
    }

    const persistedLine = String(processedContent || '').split(/\r?\n/u)[insertedLineIndex] || '';
    if (!writeAccepted || insertedLineIndex < 0 || persistedLine !== insertedLine) {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      flowWarn('CreateRootTask', 'write-unconfirmed', {
        path: targetFile.path,
        itemKind,
        insertedLineNumber: insertedLineIndex + 1,
      });
      new Notice(`Could not confirm the new ${itemKind}. Refresh and try again.`);
      return;
    }
    if (itemKind === 'task') {
      if (historyReady) {
        await commitDirectTaskHistory(historyService, historyHandle, {
          after: {
            path: targetFile.path,
            lineNumber: insertedLineIndex,
            rawLine: persistedLine,
          },
          outcome: 'committed',
        }, historyContext);
      } else {
        await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      }
    }

    this.clearTaskCachesForPath(targetFile.path);
    emitFilesUpdated(this.app, [targetFile.path], 'tps-list');
    this.queuePostCreateRefresh();
    flow('CreateRootTask', 'done', { path: targetFile.path, itemKind });
    if (this.plugin.settings.openTaskDestinationAfterCreate !== false) {
      await this.openOrFocusFile(targetFile);
    }
  }

  private async promptForRootLineTitle(itemKind: KanbanRootLineKind): Promise<string | null> {
    return await new Promise<string | null>((resolve) => {
      new TaskTitleModal(this.app, 'TPS List', itemKind, resolve).open();
    });
  }

  private buildRootTaskLine(
    title: string,
    propName: string | null,
    laneValue: string | null,
    taskFilter: KanbanTaskRootFilter,
    itemKind: KanbanRootLineKind,
    defaults = this.getRootTaskCreationDefaults(taskFilter),
  ): string | null {
    return buildKanbanRootTaskLine({
      title,
      propName,
      laneValue,
      itemKind,
      headingLevel: defaults.headingLevel,
      defaults,
      getCheckboxStateForStatus: (status) => this.getCheckboxStateForStatus(status),
      isStatusPropertyName: (name) => this.isStatusPropertyName(name),
    });
  }

  private lineMatchesCreationFilters(line: string, file: TFile, roots: unknown[], oneBasedLineNumber: number): boolean | null {
    const parsed = parseTpsListHeadingLine(line) ?? this.parseLineItem(line, true);
    if (!parsed) return false;
    const checkboxState = parsed.itemKind === 'heading' ? undefined : parsed.checkboxState;
    const inlineFields = this.extractTaskInlineFields(parsed.text);
    const text = this.cleanTaskText(parsed.text);
    const task: OpenTaskSubitem = {
      itemKind: parsed.itemKind,
      ...(parsed.itemKind === 'heading' ? { headingLevel: parsed.headingLevel } : {}),
      internalId: `${file.path}:creation-preview`,
      line: oneBasedLineNumber,
      indent: 0,
      checkboxState,
      text,
      displayText: this.cleanTaskDisplayText(this.stripTaskInlineFields(text)),
      inlineFields,
    };
    const failureSequence = this.formulaFilterFailureSequence ?? 0;
    const result = evaluateOrderedFilterChildren(
      roots,
      'and',
      (root) => this.evaluateTaskFilterNode(root, task, file),
    );
    return (this.formulaFilterFailureSequence ?? 0) === failureSequence ? result : null;
  }

  private getRootTaskCreationDefaults(
    taskFilter: KanbanTaskRootFilter,
    roots = this.getBaseFilterRoots(),
  ): TaskCreationDefaults {
    const fallback: TaskCreationDefaults = {
      mode: taskFilter.mode,
      includeDone: taskFilter.includeDone,
      status: taskFilter.statuses.size === 1 ? Array.from(taskFilter.statuses)[0] ?? null : null,
      inlineFields: new Map(),
      tags: new Set(Array.from(taskFilter.tags).filter((tag) => !taskFilter.excludeTags.has(tag))),
      excludedStatuses: new Set(taskFilter.excludeStatuses),
      excludedTags: new Set(taskFilter.excludeTags),
    };

    let structured = fallback;
    for (const root of [...roots].reverse()) {
      const defaults = this.inferTaskCreationDefaultsFromFilterNode(root);
      if (!defaults) continue;
      structured = this.mergePriorityTaskCreationDefaults(defaults, structured);
    }
    return structured;
  }

  private getTaskCreationDefaultsFromPlan(plan: TpsBaseLineCreationPlan): TaskCreationDefaults {
    const inlineFields = new Map<string, { key: string; value: string }>();
    for (const [key, value] of Object.entries(plan.fields)) {
      inlineFields.set(normalizePropertyKeyIdentity(key), { key, value });
    }
    return {
      mode: plan.kind === 'task' ? 'tasks' : plan.kind === 'bullet' ? 'bullets' : plan.kind === 'heading' ? 'headings' : undefined,
      headingLevel: plan.kind === 'heading'
        ? Math.max(1, Math.min(6, Number(plan.headingLevel) || 1)) as 1 | 2 | 3 | 4 | 5 | 6
        : undefined,
      includeDone: plan.status ? this.classifyDoneStatus(plan.status) ?? undefined : undefined,
      status: plan.status ? this.normalizeTaskStatus(plan.status) : null,
      targetPath: plan.targetPath,
      targetPathSpecified: plan.targetPathSpecified,
      inlineFields,
      tags: new Set(plan.tags.map((tag) => this.normalizeTaskTag(tag)).filter(Boolean)),
      excludedStatuses: new Set(),
      excludedTags: new Set(),
    };
  }

  private mergePriorityTaskCreationDefaults(
    higherPriority: TaskCreationDefaults,
    lowerPriority: TaskCreationDefaults,
  ): TaskCreationDefaults {
    const inlineFields = new Map(lowerPriority.inlineFields);
    for (const [key, field] of higherPriority.inlineFields) inlineFields.set(key, field);

    const tags = new Set([...lowerPriority.tags, ...higherPriority.tags]);
    const excludedTags = new Set([...lowerPriority.excludedTags, ...higherPriority.excludedTags]);
    for (const tag of higherPriority.tags) excludedTags.delete(tag);
    for (const tag of higherPriority.excludedTags) tags.delete(tag);

    const excludedStatuses = new Set([...lowerPriority.excludedStatuses, ...higherPriority.excludedStatuses]);
    const status = higherPriority.status ?? lowerPriority.status ?? null;
    if (higherPriority.status) excludedStatuses.delete(higherPriority.status);
    if (!higherPriority.status && status && higherPriority.excludedStatuses.has(status)) {
      return {
        mode: higherPriority.mode ?? lowerPriority.mode,
        includeDone: higherPriority.includeDone ?? lowerPriority.includeDone,
        status: null,
        targetPath: higherPriority.targetPathSpecified === true
          ? higherPriority.targetPath ?? null
          : lowerPriority.targetPath ?? null,
        targetPathSpecified: higherPriority.targetPathSpecified === true || lowerPriority.targetPathSpecified === true,
        inlineFields,
        tags,
        excludedStatuses,
        excludedTags,
      };
    }

    return {
      mode: higherPriority.mode ?? lowerPriority.mode,
      includeDone: higherPriority.includeDone ?? lowerPriority.includeDone,
      status,
      targetPath: higherPriority.targetPathSpecified === true
        ? higherPriority.targetPath ?? null
        : lowerPriority.targetPath ?? null,
      targetPathSpecified: higherPriority.targetPathSpecified === true || lowerPriority.targetPathSpecified === true,
      inlineFields,
      tags,
      excludedStatuses,
      excludedTags,
    };
  }

  private inferTaskCreationDefaultsFromFilterNode(node: unknown): TaskCreationDefaults | null {
    if (!node) return null;
    if (typeof node === 'string') return this.inferTaskCreationDefaultsFromString(node);
    if (Array.isArray(node)) return this.inferTaskCreationDefaultsFromAnd(node);
    if (typeof node !== 'object') return null;

    const record = node as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, 'and')) {
      return this.inferTaskCreationDefaultsFromAnd(this.asArray(record.and));
    }
    if (Object.prototype.hasOwnProperty.call(record, 'or')) {
      for (const child of this.asArray(record.or)) {
        const defaults = this.inferTaskCreationDefaultsFromFilterNode(child);
        if (defaults && defaults.mode !== 'notes') return defaults;
      }
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(record, 'any')) {
      for (const child of this.asArray(record.any)) {
        const defaults = this.inferTaskCreationDefaultsFromFilterNode(child);
        if (defaults && defaults.mode !== 'notes') return defaults;
      }
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(record, 'not')) {
      const negated = this.inferTaskCreationDefaultsFromFilterNode(record.not);
      if (!negated) return null;
      return {
        tags: new Set(),
        inlineFields: new Map(),
        excludedTags: new Set(negated.tags),
        excludedStatuses: new Set(negated.status ? [negated.status] : []),
      };
    }

    return this.inferTaskCreationDefaultsFromObject(record);
  }

  private inferTaskCreationDefaultsFromAnd(nodes: unknown[]): TaskCreationDefaults | null {
    let merged: TaskCreationDefaults | null = null;
    for (const child of nodes) {
      const childDefaults = this.inferTaskCreationDefaultsFromFilterNode(child);
      if (!childDefaults) continue;
      merged = this.mergeTaskCreationDefaults(merged, childDefaults);
      if (!merged) return null;
    }
    return merged;
  }

  private mergeTaskCreationDefaults(left: TaskCreationDefaults | null, right: TaskCreationDefaults): TaskCreationDefaults | null {
    if (!left) return {
      mode: right.mode,
      includeDone: right.includeDone,
      status: right.status,
      targetPath: right.targetPath,
      targetPathSpecified: right.targetPathSpecified,
      inlineFields: new Map(right.inlineFields),
      tags: new Set(right.tags),
      excludedStatuses: new Set(right.excludedStatuses),
      excludedTags: new Set(right.excludedTags),
    };

    const status = right.status ?? left.status ?? null;
    if (left.status && right.status && left.status !== right.status) return null;
    const leftOwnsTarget = left.targetPathSpecified === true;
    const rightOwnsTarget = right.targetPathSpecified === true;
    const normalizedLeftTarget = this.normalizeTaskTargetPath(left.targetPath);
    const normalizedRightTarget = this.normalizeTaskTargetPath(right.targetPath);
    const targetPathSpecified = leftOwnsTarget || rightOwnsTarget;
    const targetPath = leftOwnsTarget && rightOwnsTarget
      ? normalizedLeftTarget && normalizedRightTarget && normalizedLeftTarget === normalizedRightTarget
        ? normalizedRightTarget
        : null
      : rightOwnsTarget
        ? normalizedRightTarget
        : leftOwnsTarget
          ? normalizedLeftTarget
          : null;

    const inlineFields = new Map(left.inlineFields);
    for (const [normalizedKey, field] of right.inlineFields) {
      const previous = inlineFields.get(normalizedKey);
      if (previous && previous.value.toLowerCase() !== field.value.toLowerCase()) return null;
      inlineFields.set(normalizedKey, field);
    }
    const tags = new Set([...left.tags, ...right.tags]);
    const excludedTags = new Set([...left.excludedTags, ...right.excludedTags]);
    const excludedStatuses = new Set([...left.excludedStatuses, ...right.excludedStatuses]);
    for (const tag of tags) if (excludedTags.has(tag)) return null;
    if (status && excludedStatuses.has(status)) return null;

    return {
      mode: right.mode ?? left.mode,
      includeDone: right.includeDone ?? left.includeDone,
      status,
      targetPath,
      targetPathSpecified,
      inlineFields,
      tags,
      excludedStatuses,
      excludedTags,
    };
  }

  private inferTaskCreationDefaultsFromString(rawExpr: string): TaskCreationDefaults | null {
    const raw = String(rawExpr || '').trim();
    if (hasTpsFormulaReference(raw)) return null;
    if (parseBareSemanticKindExpression(raw)) {
      return { mode: 'notes', inlineFields: new Map(), tags: new Set(), excludedStatuses: new Set(), excludedTags: new Set() };
    }
    const isNegated = raw.startsWith('!');
    const expr = (isNegated ? raw.slice(1) : raw).trim();
    const defaults = this.inferPositiveTaskCreationDefaultsFromString(expr);
    if (!defaults || !isNegated) return defaults;
    return {
      inlineFields: new Map(),
      tags: new Set(),
      excludedTags: new Set(defaults.tags),
      excludedStatuses: new Set(defaults.status ? [defaults.status] : []),
    };
  }

  private inferPositiveTaskCreationDefaultsFromString(expr: string): TaskCreationDefaults | null {
    const kindMatch = expr.match(/^(?:(?:tps|kanban)\.)?(?:itemtype|itemkind|kind)\s*(?:==|=)\s*["']?(task|tasks|note|notes|all|mixed)["']?$/i);
    if (kindMatch?.[1]) {
      const value = kindMatch[1].toLowerCase();
      return { mode: value.startsWith('task') ? 'tasks' : value.startsWith('note') ? 'notes' : 'mixed', inlineFields: new Map(), tags: new Set(), excludedStatuses: new Set(), excludedTags: new Set() };
    }
    if (/^(?:task\.)?(?:open|isopen)\s*(?:==|=)\s*(true|1)$/i.test(expr) || /^(?:task\.)?(?:done|isdone|completed|complete)\s*(?:==|=)\s*(false|0)$/i.test(expr)) {
      return { includeDone: false, inlineFields: new Map(), tags: new Set(), excludedStatuses: new Set(), excludedTags: new Set() };
    }
    if (/^(?:task\.)?(?:done|isdone|completed|complete)\s*(?:==|=)\s*(true|1)$/i.test(expr)) {
      const doneStatus = this.getDefaultMappedTaskStatus('done');
      return doneStatus
        ? { includeDone: true, status: doneStatus, inlineFields: new Map(), tags: new Set(), excludedStatuses: new Set(), excludedTags: new Set() }
        : null;
    }
    return (
      isRelationalStatusFilterExpression(expr, this.getGcmSettings()?.properties)
        ? null
        : this.inferTaskValueCreationDefaultsFromString(expr, 'status')
    )
      ?? this.inferTaskValueCreationDefaultsFromString(expr, 'tags')
      ?? this.inferTaskPathCreationDefaultsFromString(expr)
      ?? this.inferTaskInlineFieldCreationDefaultsFromString(expr);
  }

  private inferTaskPathCreationDefaultsFromString(expr: string): TaskCreationDefaults | null {
    const pathMatch = expr.match(/^(?:file\.path|task\.path)\s*(?:==|=|is|equals?)\s*(?:"([^"]+)"|'([^']+)'|([^\s].*?))$/i);
    if (!pathMatch) return null;
    const resolved = this.resolveBaseContextToken(pathMatch[1] || pathMatch[2] || pathMatch[3]);
    const targetPath = this.normalizeTaskTargetPath(resolved || '');
    return {
      targetPath,
      targetPathSpecified: true,
      inlineFields: new Map(),
      tags: new Set(),
      excludedStatuses: new Set(),
      excludedTags: new Set(),
    };
  }

  private inferTaskValueCreationDefaultsFromString(expr: string, propName: 'status' | 'tags'): TaskCreationDefaults | null {
    const propPattern = `(?:task\\.)?${propName === 'tags' ? '(?:tags|tag)' : 'status'}`;
    const tokenDefaults = (token: string, excluded = false): TaskCreationDefaults => {
      const normalized = propName === 'tags' ? this.normalizeTaskTag(token) : String(token || '').trim().toLowerCase();
      return {
        status: propName === 'status' && !excluded ? normalized : null,
        inlineFields: new Map(),
        tags: new Set(propName === 'tags' && !excluded ? [normalized] : []),
        excludedStatuses: new Set(propName === 'status' && excluded ? [normalized] : []),
        excludedTags: new Set(propName === 'tags' && excluded ? [normalized] : []),
      };
    };
    const callMatch = expr.match(new RegExp(`^${propPattern}\\.(?:containsAny|contains|equals)\\((.*)\\)$`, 'i'));
    if (callMatch) {
      const token = this.extractFilterTokens(callMatch[1] || '')[0];
      return token ? tokenDefaults(token) : null;
    }
    const comparisonMatch = expr.match(new RegExp(`^${propPattern}\\s*(==|=|!=|!==)\\s*["']([^"']+)["']$`, 'i'));
    if (comparisonMatch?.[2]) return tokenDefaults(comparisonMatch[2], String(comparisonMatch[1] || '').startsWith('!'));
    return null;
  }

  private inferTaskInlineFieldCreationDefaultsFromString(expr: string): TaskCreationDefaults | null {
    const match = expr.match(/^(?:task\.)?([A-Za-z][\w -]{0,40})\s*(==|=|is|equals?)\s*(?:"([^"]+)"|'([^']+)'|([^\s].*?))$/i);
    const rawKey = String(match?.[1] || '').trim();
    const value = String(this.resolveBaseContextToken(match?.[3] || match?.[4] || match?.[5]) || '').trim();
    if (
      !rawKey
      || !value
      || (
        this.isReservedTaskDefaultKey(rawKey)
        && !this.isRelationalStatusPropertyReference(rawKey)
      )
    ) return null;
    return {
      inlineFields: new Map([[normalizePropertyKeyIdentity(rawKey), { key: rawKey, value }]]),
      tags: new Set(),
      excludedStatuses: new Set(),
      excludedTags: new Set(),
    };
  }

  private inferTaskCreationDefaultsFromObject(node: Record<string, unknown>): TaskCreationDefaults | null {
    const propRaw = String(node.property ?? node.field ?? '').trim();
    if (!propRaw) return null;
    if (/^formula(?:\.|\[)/iu.test(propRaw)) return null;
    const normalizedProp = this.normalizeInlinePropertyKey(propRaw.replace(/^task\./i, '').replace(/^tps\./i, ''));
    const operator = String(node.operator ?? node.op ?? '').trim().toLowerCase();
    const values = this.asArray(node.values ?? node.value).map((value) => String(value || '').trim()).filter(Boolean);
    if (!values.length) return null;
    const excluded = operator.startsWith('!') || operator.includes('not') || operator === '!=' || operator === '!==';

    if (isBareSemanticKindFilter(propRaw, values)) {
      return { mode: 'notes', inlineFields: new Map(), tags: new Set(), excludedStatuses: new Set(), excludedTags: new Set() };
    }

    if (['itemtype', 'itemkind', 'kind'].includes(normalizedProp)) {
      const value = values[0].toLowerCase();
      return { mode: value.startsWith('task') ? 'tasks' : value.startsWith('note') ? 'notes' : 'mixed', inlineFields: new Map(), tags: new Set(), excludedStatuses: new Set(), excludedTags: new Set() };
    }
    if (['open', 'isopen'].includes(normalizedProp)) {
      return values.some((value) => value.toLowerCase() === 'true' || value === '1')
        ? { includeDone: false, inlineFields: new Map(), tags: new Set(), excludedStatuses: new Set(), excludedTags: new Set() }
        : null;
    }
    if (
      ['status', 'checkboxstatus'].includes(normalizedProp)
      && !this.isRelationalStatusPropertyReference(propRaw)
    ) {
      const value = values[0].toLowerCase();
      return { status: excluded ? null : value, inlineFields: new Map(), tags: new Set(), excludedStatuses: new Set(excluded ? [value] : []), excludedTags: new Set() };
    }
    if (['tag', 'tags'].includes(normalizedProp)) {
      const value = this.normalizeTaskTag(values[0]);
      return { inlineFields: new Map(), tags: new Set(excluded ? [] : [value]), excludedStatuses: new Set(), excludedTags: new Set(excluded ? [value] : []) };
    }
    if (propRaw.toLowerCase() === 'file.path' || propRaw.toLowerCase() === 'task.path') {
      const value = this.normalizeTaskTargetPath(this.resolveBaseContextToken(values[0]) || '');
      return !excluded
        ? {
            targetPath: value,
            targetPathSpecified: true,
            inlineFields: new Map(),
            tags: new Set(),
            excludedStatuses: new Set(),
            excludedTags: new Set(),
          }
        : null;
    }
    if (propRaw.toLowerCase() === 'task.file.path') return null;
    if (
      !excluded
      && !propRaw.toLowerCase().startsWith('note.')
      && !propRaw.toLowerCase().startsWith('file.')
      && (
        !this.isReservedTaskDefaultKey(normalizedProp)
        || this.isRelationalStatusPropertyReference(propRaw)
      )
    ) {
      const writableKey = propRaw.replace(/^task\./i, '').replace(/^tps\./i, '');
      return {
        inlineFields: new Map([[normalizePropertyKeyIdentity(writableKey), { key: writableKey, value: values[0] }]]),
        tags: new Set(),
        excludedStatuses: new Set(),
        excludedTags: new Set(),
      };
    }
    return null;
  }

  private isReservedTaskDefaultKey(key: string): boolean {
    const normalized = this.normalizeInlinePropertyKey(key.replace(/^(?:task|tps|kanban)\./i, ''));
    return ['itemtype', 'itemkind', 'kind', 'status', 'checkboxstatus', 'tag', 'tags', 'open', 'isopen', 'done', 'isdone', 'completed', 'complete', 'path', 'file', 'filepath', 'fileextension', 'fileext'].includes(normalized);
  }

  private asArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    return value == null ? [] : [value];
  }

  private insertLineAfterFrontmatter(content: string, line: string): string {
    const normalizedLine = String(line || '').trim();
    if (!normalizedLine) return content;
    const normalizedContent = String(content || '').replace(/\s+$/g, '');
    return normalizedContent ? `${normalizedContent}\n${normalizedLine}\n` : `${normalizedLine}\n`;
  }

  private getAppendedLineNumber(content: string): number {
    const normalizedContent = String(content || '').replace(/\s+$/gu, '');
    return normalizedContent ? normalizedContent.split('\n').length + 1 : 1;
  }

  private async resolveRootTaskTargetFile(defaults = this.getRootTaskCreationDefaults(this.getTaskRootFilterFromBaseFilters())): Promise<TFile | null> {
    const gcmPlugin = this.getGcmPlugin();
    if (typeof gcmPlugin?.resolveTpsBaseWriteFile === 'function') {
      const resolution = await gcmPlugin.resolveTpsBaseWriteFile({
        explicitTargetPath: defaults.targetPath,
        explicitTargetSpecified: defaults.targetPathSpecified === true,
        createExplicitIfMissing: true,
      });
      if (resolution?.file instanceof TFile) {
        flow('CreateRootTaskTarget', 'resolved', {
          path: resolution.file.path,
          source: resolution.source,
        });
        return resolution.file;
      }
      flowWarn('CreateRootTaskTarget', 'unresolved', {
        source: resolution?.source ?? null,
        reason: resolution?.reason ?? 'resolver-returned-no-file',
        targetPath: resolution?.path ?? defaults.targetPath ?? null,
      });
      return null;
    }

    const targetPath = resolveKanbanRootTaskTargetPath(defaults.targetPath, this.plugin.settings?.defaultRootTaskPath || '');
    if (targetPath) {
      const existing = this.app.vault.getFileByPath(targetPath);
      if (existing instanceof TFile) {
        flow('CreateRootTaskTarget', 'resolved-existing', { path: targetPath });
        return existing;
      }
      const folderPath = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : '';
      if (folderPath) await this.ensureFolderPath(folderPath);
      const basename = targetPath.split('/').pop()?.replace(/\.md$/i, '') || 'Tasks';
      flow('CreateRootTaskTarget', 'create-file', { path: targetPath, folderPath });
      return await this.app.vault.create(targetPath, `---\ntitle: ${basename}\n---\n`);
    }

    flowWarn('CreateRootTaskTarget', 'unresolved', {
      defaultTargetPath: defaults.targetPath || '',
      configuredDefaultRootTaskPath: this.plugin.settings?.defaultRootTaskPath || '',
    });
    return null;
  }

  private normalizeTaskTargetPath(value: unknown): string | null {
    return normalizeKanbanTaskTargetPath(value);
  }

  private normalizeNoteTargetPath(value: unknown): string | null {
    const raw = String(value || '').trim()
      .replace(/^\[\[|\]\]$/g, '')
      .replace(/^\"+|\"+$/g, '')
      .replace(/^'+|'+$/g, '');
    if (!raw) return null;
    const normalized = normalizePath(raw).replace(/^\/+/, '');
    if (!normalized || normalized.endsWith('/')) return null;
    return normalized.toLowerCase().endsWith('.md') ? normalized : `${normalized}.md`;
  }

  private normalizeNoteTargetFolder(value: unknown): string | null {
    const raw = String(value || '').trim()
      .replace(/^\"+|\"+$/g, '')
      .replace(/^'+|'+$/g, '');
    if (!raw) return null;
    const normalized = normalizePath(raw).replace(/^\/+|\/+$/g, '');
    if (!normalized || normalized.toLowerCase().endsWith('.md')) return null;
    return normalized;
  }

  private async ensureFolderPath(folderPath: string): Promise<void> {
    const parts = normalizePath(folderPath).split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private render(preserveScroll = true): void {
    this.renderGeneration += 1;
    if (!this.shouldRenderView()) return;
    const generation = this.renderGeneration;
    this.clearActiveTaskPointerDrag();
    this.renderedDisplayLanesById.clear();
    this.taskFormulaSessions = new WeakMap<OpenTaskSubitem, TpsFormulaRowSession>();
    this.formulaFileContexts?.clear();
    this.formulaThisValue = undefined;
    this.formulaDiagnostics.clear();
    this.formulaNow = new Date();
    this.getBaseFilterRoots();
    const scrollState = preserveScroll ? this.captureRenderScrollState() : null;
    this.applyLayoutSettings();
    this.ensureContainer();
    this.containerEl.empty();

    const propName = this.getGroupByPropName();
    const propId = this.getGroupByPropId(propName);
    const listGrouping = this.isLikelyListGroupingProperty(propName, propId);
    const sourceGroups = this.getSourceGroupsForRender(propId, listGrouping);
    void this.renderAsync(sourceGroups, propName, scrollState, generation);
  }

  private async renderAsync(
    sourceGroups: BasesEntryGroup[],
    propName: string | null,
    scrollState: TpsListRenderScrollState | null = null,
    generation = this.renderGeneration,
  ): Promise<void> {
    if (generation !== this.renderGeneration) return;
    this.activeNotePath = this.getActiveMarkdownPath();
    const allGroups = this.mergeGroupsByLaneId(sourceGroups);

    // Separate keyed groups from the ungrouped lane, then reorder per settings
    const keyed = allGroups.filter((g) => this.getLaneId(g) !== 'ungrouped');
    const ungrouped = allGroups.filter((g) => this.getLaneId(g) === 'ungrouped');
    const forced = this.getForcedLanesFromFilters(propName);

    const keyedWithForced: BasesEntryGroup[] = [...keyed];
    const existingKeys = new Set(keyed.map((g) => String(g.key).trim().toLowerCase()));
    for (const forcedKey of forced.keys) {
      const normalized = forcedKey.trim().toLowerCase();
      if (!normalized || existingKeys.has(normalized)) continue;
      keyedWithForced.push(this.createSyntheticGroup(forcedKey));
      existingKeys.add(normalized);
    }

    const ungroupedWithForced = [...ungrouped];
    if (forced.includeUngrouped && ungroupedWithForced.length === 0) {
      ungroupedWithForced.push(this.createSyntheticGroup(null));
    }

    const ungroupedPos = this.getUngroupedPosition();
    let mergedGroups = ungroupedPos === 'first'
      ? [...ungroupedWithForced, ...keyedWithForced]
      : [...keyedWithForced, ...ungroupedWithForced];
    mergedGroups = this.includeSavedLaneGroups(mergedGroups);
    if (mergedGroups.length === 0) {
      mergedGroups = [this.createSyntheticGroup(null)];
    }
    let groups = this.applyManualLaneOrder(mergedGroups);
    const taskFilter = this.getTaskRootFilterFromBaseFilters();
    let parentByChild = this.buildParentByChild(groups);
    let laneRenderItemsByLane = !this.shouldRenderNoteEntriesForGroups(groups, taskFilter)
      ? new Map<string, LaneRenderItem[]>()
      : this.buildLaneRenderItemsByLane(groups, parentByChild);
    const taskRenderItemsByLane = this.buildTaskRenderItemsByLane(
      groups,
      propName,
      this.getVisibleNotePaths(groups),
      taskFilter,
    );
    groups = this.ensureGroupsForTaskLanes(groups, taskRenderItemsByLane);
    parentByChild = this.buildParentByChild(groups);
    laneRenderItemsByLane = !this.shouldRenderNoteEntriesForGroups(groups, taskFilter)
      ? new Map<string, LaneRenderItem[]>()
      : this.buildLaneRenderItemsByLane(groups, parentByChild);
    const displayLanes = this.buildDisplayLaneGroups(groups);
    if (generation !== this.renderGeneration) return;
    this.renderedDisplayLanesById = new Map(displayLanes.map((lane) => [lane.id, lane]));
    const renderItemsByDisplayLane = new Map<string, LaneRenderItem[]>();
    const taskItemsByDisplayLane = new Map<string, TaskRenderItem[]>();
    for (const displayLane of displayLanes) {
      renderItemsByDisplayLane.set(
        displayLane.id,
        this.getRenderItemsForDisplayLane(displayLane, laneRenderItemsByLane),
      );
      const taskItems = displayLane.laneIds.flatMap((laneId) => taskRenderItemsByLane.get(laneId) ?? []);
      taskItemsByDisplayLane.set(displayLane.id, taskItems);
    }
    this.renderedTaskItemCount = Array.from(taskItemsByDisplayLane.values())
      .reduce((total, taskItems) => total + taskItems.length, 0);
    if (taskFilter.includeHeadings) {
      const headingRows = Array.from(taskItemsByDisplayLane.values())
        .reduce((total, taskItems) => total + taskItems.filter((item) => item.task.itemKind === 'heading').length, 0);
      flow('TpsListView', 'heading-rows:resolved', {
        viewName: this.getConfiguredBaseViewName(),
        rows: headingRows,
      });
    }

    const visibleNotePaths = this.getOrderedVisiblePaths(displayLanes, renderItemsByDisplayLane);
      this.renderedResultCount = visibleNotePaths.length + this.renderedTaskItemCount;
      this.hasRenderedResultCount = true;
      this.renderList(displayLanes, renderItemsByDisplayLane, taskItemsByDisplayLane, groups, propName);
      const rowOccurrences = new Map<string, number>();
      this.renderedRowOrder = Array.from(
        this.containerEl.querySelectorAll<HTMLElement>('.tps-list-native-row[data-tps-list-selection-id]'),
      ).map((row) => {
        const baseId = row.dataset.tpsListSelectionId || '';
        if (!baseId) return '';
        const occurrence = rowOccurrences.get(baseId) ?? 0;
        rowOccurrences.set(baseId, occurrence + 1);
        const selectionId = `${baseId}#${occurrence}`;
        row.dataset.tpsListSelectionId = selectionId;
        return selectionId;
      }).filter((id): id is string => !!id);
      const visible = new Set(this.renderedRowOrder);
      const retainedSelection = new Set(Array.from(this.selectedRowIds).filter((id) => visible.has(id)));
      this.selectedRowIds = retainedSelection;
      const anchorPruned = !!this.selectionAnchorRowId && !visible.has(this.selectionAnchorRowId);
      if (anchorPruned) this.selectionAnchorRowId = null;
      this.syncSelectionClasses();
      const taskSelectionService = this.getGcmPlugin()?.taskLineContextMenuService || this.getGcmApi()?.taskLineContextMenuService;
      if (typeof taskSelectionService?.reconcileTpsListSelectionRows === 'function') {
        const anchorRow = this.selectionAnchorRowId
          ? Array.from(this.containerEl.querySelectorAll<HTMLElement>(
              '.tps-list-native-row[data-tps-list-selection-id]',
            )).find((row) => row.dataset.tpsListSelectionId === this.selectionAnchorRowId) ?? null
          : null;
        void taskSelectionService.reconcileTpsListSelectionRows(
          this.getSelectedRows(),
          anchorRow,
          this.scrollEl,
        );
      } else {
        taskSelectionService?.refreshSelectionHighlights?.();
      }
      this.syncNativeResultsCountSoon();
      this.restoreRenderScrollState(scrollState);
  }

  private renderList(
    displayLanes: DisplayLaneGroup[],
    renderItemsByDisplayLane: Map<string, LaneRenderItem[]>,
    taskItemsByDisplayLane: Map<string, TaskRenderItem[]>,
    groups: BasesEntryGroup[],
    propName: string | null,
  ): void {
    const list = this.containerEl.createDiv({ cls: 'tps-list-native' });
    const selectedProps = this.getCardPropertyIds(propName);
    let renderedRows = 0;

    for (const displayLane of displayLanes) {
      const noteItems = renderItemsByDisplayLane.get(displayLane.id) ?? [];
      const taskItems = taskItemsByDisplayLane.get(displayLane.id) ?? [];
      if (noteItems.length === 0 && taskItems.length === 0) continue;

      const group = list.createDiv({
        cls: 'tps-list-native-group',
        attr: { 'data-display-lane-id': displayLane.id },
      });
      const groupLabel = this.formatListGroupLabel(propName, displayLane.label);
      if (groupLabel) {
        group.createDiv({ cls: 'tps-list-native-group-label', text: groupLabel });
      }
      const rows = group.createEl('ul', {
        cls: 'tps-list-native-rows',
        attr: { role: 'list' },
      });
      const rowItems = this.getSortedListRows(noteItems, taskItems);
      for (const { row: rowItem, depth } of rowItems) {
        if (rowItem.kind === 'note') {
          this.createListNoteRow(rows, rowItem.item, selectedProps, displayLane.id);
        } else if (rowItem.kind === 'heading') {
          this.createListHeadingRow(rows, rowItem.item, selectedProps, displayLane);
        } else {
          this.createListTaskRow(rows, rowItem.item, selectedProps, propName, displayLane, depth);
        }
        renderedRows += 1;
      }
    }

    if (renderedRows === 0) {
      list.createDiv({ cls: 'tps-list-native-empty', text: 'No notes to display' });
    }
  }

  private formatListGroupLabel(propName: string | null, label: string): string {
    const cleanLabel = String(label || '').trim();
    const formattedLabel = cleanLabel && cleanLabel.toLowerCase() !== 'null'
      ? this.formatCardPropertyValue(cleanLabel) || cleanLabel
      : 'No value';
    if (!propName) return formattedLabel;
    const propId = this.getGroupByPropId(propName) ?? propName;
    const displayName = String((this.config as any)?.getDisplayName?.(propId) ?? '').trim();
    const property = displayName || (isSourceNoteGroupProperty(propId)
      ? 'Note'
      : this.getFrontmatterPropNameFromId(propName) ?? propName);
    const cleanProperty = String(property || '').replace(/^note\./, '').trim();
    return [cleanProperty, formattedLabel].filter(Boolean).join(' ');
  }

  private isWritableTaskGroupingProperty(propName: string | null): propName is string {
    if (!propName) return false;
    const propId = this.getGroupByPropId(propName) ?? propName;
    const normalized = String(propId || '').trim().toLowerCase();
    return !isSourceNoteGroupProperty(propId)
      && this.getConfiguredCustomProperty(propId)?.type !== 'folder'
      && !normalized.startsWith('file.')
      && !normalized.startsWith('formula.');
  }

  private getSortedListRows(noteItems: LaneRenderItem[], taskItems: TaskRenderItem[]): TpsListDisplayRow[] {
    const rows: TpsListRowItem[] = [
      ...noteItems.map((item, nativeIndex) => ({ kind: 'note' as const, item, nativeIndex })),
      ...taskItems.map((item, index) => ({
        kind: item.task.itemKind === 'heading' ? 'heading' as const : 'task' as const,
        item,
        nativeIndex: noteItems.length + index,
        taskKey: `${item.file.path}:${item.task.line}`,
        parentTaskKey: item.task.parentLine ? `${item.file.path}:${item.task.parentLine}` : undefined,
      })),
    ];
    const sortDescriptors = this.getSortDescriptors();
    return orderTpsListHierarchy(rows, (a, b) => sortDescriptors.length
      ? this.compareListRows(a, b, sortDescriptors)
      : a.nativeIndex - b.nativeIndex);
  }

  private compareListRows(a: TpsListRowItem, b: TpsListRowItem, sortDescriptors: TpsSortDescriptor[]): number {
    for (const descriptor of sortDescriptors) {
      const av = this.getListSortValue(a, descriptor.prop);
      const bv = this.getListSortValue(b, descriptor.prop);
      const result = compareTpsBaseValues(
        av,
        bv,
        this.getOrderingSemantics(descriptor.prop),
        descriptor.direction,
      );
      if (result !== 0) return result;
    }
    return a.nativeIndex - b.nativeIndex;
  }

  private getListSortValue(row: TpsListRowItem, propId: string): unknown {
    if (row.kind === 'note') {
      if (/^formula\./iu.test(String(propId || '').trim())) {
        return this.normalizeFormulaSortOperand(this.getEntryValue(row.item.entry, propId));
      }
      return this.getNativeSortValue(row.item.entry, propId);
    }
    return this.getTaskSortValue(row.item, propId);
  }

  private getTaskSortValue(item: TaskRenderItem, propId: string): unknown {
    const raw = String(propId || '').trim();
    if (/^formula\./iu.test(raw)) {
      const result = this.getTaskFormulaSession(item.file, item.task).get(raw);
      if (result.status === 'error' || result.status === 'unsupported') {
        this.reportFormulaFailure(result, item.file, item.task);
        return '';
      }
      return this.normalizeFormulaSortOperand(result.value);
    }
    const lower = raw.toLowerCase();
    const normalized = this.normalizeTaskPropertyId(raw);
    if (this.getConfiguredCustomProperty(raw)?.type === 'folder') return item.file.parent?.path || '/';
    if (lower === 'file.path' || lower === 'path' || lower === 'task.path' || normalized === 'filepath') return item.file.path;
    if (lower === 'title' || lower === 'task.title') return this.getTaskVisibleTitle(item.task);
    if (lower === 'file.name' || lower === 'file.basename' || lower === 'file.fullname' || lower === 'name' || normalized === 'path') {
      return item.file.basename;
    }
    if (normalized === 'status' && !this.isRelationalStatusPropertyReference(raw)) {
      if (item.task.itemKind === 'heading') return '';
      return item.task.itemKind === 'bullet' ? 'bullet' : this.getMappedStatusForTask(item.task);
    }
    const structuralKind = item.task.itemKind === 'heading'
      ? `h${item.task.headingLevel || 1}`
      : item.task.itemKind === 'bullet' ? 'bullet' : 'task';
    if (normalized === 'kind') {
      return getTpsBaseAdditiveKindValues(structuralKind, this.getTaskExplicitKindValues(item.task));
    }
    if (normalized === 'itemkind' || normalized === 'itemtype') return structuralKind;
    if (normalized === 'explicitkind' || normalized === 'entitykind') return this.getTaskExplicitKindValues(item.task);
    if (['title', 'text', 'linetext', 'headingtext'].includes(normalized)) return this.getTaskVisibleTitle(item.task);
    if (normalized === 'line') return item.task.line;
    if (normalized === 'level' || normalized === 'headinglevel') {
      return item.task.itemKind === 'heading' ? item.task.headingLevel ?? '' : '';
    }
    const configuredProperty = this.getConfiguredCustomProperty(raw);
    const values = this.getTaskInlineValues(
      item.task,
      configuredProperty?.key || this.getTaskInlinePropertyName(raw),
    );
    if (!values.length) return '';
    return values.length === 1 ? values[0] : values;
  }

  private normalizeFormulaSortOperand(value: unknown): unknown {
    return value instanceof Date ? value.getTime() : value;
  }

  private createListNoteRow(
    parent: HTMLElement,
    item: LaneRenderItem,
    selectedProps: string[],
    displayLaneId: string,
  ): void {
    const entry = item.entry;
    const row = parent.createEl('li', { cls: 'tps-list-native-row tps-list-native-row--note' });
    const selectionId = `note:${displayLaneId}:${entry.file.path}`;
    row.dataset.path = entry.file.path;
    row.dataset.tpsListSelectionId = selectionId;
    row.dataset.href = entry.file.path;
    row.dataset.linkpath = entry.file.path;
    row.dataset.file = entry.file.path;
    row.dataset.tpsGcmContext = 'kanban-card';
    row.dataset.tpsKanbanPath = entry.file.path;
    this.registerListRowModifierSelection(row);
    row.setAttribute('aria-selected', this.selectedRowIds.has(selectionId) ? 'true' : 'false');
    if (this.selectedRowIds.has(selectionId)) row.addClass('tps-list-native-row--selected');
    if (this.activeNotePath && entry.file.path === this.activeNotePath) row.addClass('tps-list-native-row--open-note');

    const marker = row.createSpan({
      cls: 'tps-list-native-leading tps-list-native-file-marker',
      attr: { 'aria-hidden': 'true' },
    });
    setIconWithFallback(marker, 'file-text');
    const body = row.createDiv({ cls: 'tps-list-native-row-body' });

    const link = body.createEl('a', {
      text: entry.file.basename,
      cls: 'tps-list-native-title internal-link',
      attr: {
        href: entry.file.path,
        'data-href': entry.file.path,
        'data-linkpath': entry.file.path,
        'aria-label': entry.file.path,
        draggable: 'false',
      },
    });
    link.addEventListener('click', (event: MouseEvent) => {
      void this.applyTpsListRowSelection(event, row);
      if (this.openBaseNotePreview(event, entry.file, link)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey || event.metaKey || event.ctrlKey) return;
      void this.openOrFocusFile(entry.file);
    });
    row.addEventListener('contextmenu', (event: MouseEvent) => this.openListNoteContextMenu(event, entry, row));
    this.renderListNoteProperties(body, entry, selectedProps);
  }

  private openListNoteContextMenu(event: MouseEvent, entry: BasesEntry, row: HTMLElement): void {
    event.preventDefault();
    event.stopPropagation();
    void this.applyTpsListRowSelection(event, row, true);

    const selectedFiles = this.getSelectedFiles();
    const menu = new Menu();
    const targets = selectedFiles.length > 0 ? selectedFiles : [entry.file];
    const menuController = this.getGcmPlugin()?.menuController || this.getGcmApi()?.menuController;
    menuController?.addToNativeMenu?.(menu, targets, { includeTags: true });
    if (selectedFiles.length > 1) {
      this.app.workspace.trigger('files-menu', menu as any, selectedFiles as any);
    } else {
      const target = selectedFiles[0] ?? entry.file;
      this.app.workspace.trigger('file-menu', menu as any, target as any);
    }
    menu.showAtPosition({ x: event.clientX, y: event.clientY });
  }

  private renderListNoteProperties(parent: HTMLElement, entry: BasesEntry, selectedProps: string[]): void {
    for (const propId of selectedProps) {
      const rawValue = this.getEntryValue(entry, propId);
      const propName = this.getFrontmatterPropNameFromId(propId) ?? propId;
      const configuredProperty = this.getConfiguredCustomProperty(propId);
      const sourceFolderProperty = configuredProperty?.type === 'folder';
      // Canonical GCM keeps whole-note recurrence read-only: editing only the
      // rule would bypass the recurrence service's series/template lifecycle.
      // Task-line recurrence remains editable through its stale-safe modal.
      const noteRecurrenceProperty = configuredProperty?.type === 'recurrence';
      const entityReference = !sourceFolderProperty
        && !noteRecurrenceProperty
        && isEntityReferenceProperty(configuredProperty);
      const editable = this.isWritableNotePropertyId(propId)
        && !sourceFolderProperty
        && !noteRecurrenceProperty;
      const formulaBoolean = /^formula\./iu.test(String(propId || '').trim())
        ? getReadOnlyBooleanFormulaPresentation(rawValue)
        : null;
      if (formulaBoolean) {
        this.renderListReadOnlyBooleanProperty(parent, propId, rawValue);
        continue;
      }
      if (editable && isBooleanPropertyType(configuredProperty?.type)) {
        this.createListBooleanPropertyControl(
          parent,
          configuredProperty?.label || propName,
          rawValue,
          async (next) => {
            try {
              await this.processFrontmatter(entry.file, (fm) => {
                const actualKey = this.findFrontmatterKeyCaseInsensitive(fm, propName) || propName;
                fm[actualKey] = next;
              });
              emitFilesUpdated(this.app, [entry.file.path], 'tps-list');
              this.render(false);
              return true;
            } catch (error) {
              flowError('ListProperty', 'boolean-note-update:failed', error, {
                path: entry.file.path,
                property: propName,
              });
              new Notice(`Could not update ${configuredProperty?.label || propName}.`);
              return false;
            }
          },
          async () => {
            try {
              await this.processFrontmatter(entry.file, (fm) => {
                const actualKey = this.findFrontmatterKeyCaseInsensitive(fm, propName) || propName;
                delete fm[actualKey];
              });
              emitFilesUpdated(this.app, [entry.file.path], 'tps-list');
              this.render(false);
              return true;
            } catch (error) {
              flowError('ListProperty', 'boolean-note-clear:failed', error, {
                path: entry.file.path,
                property: propName,
              });
              new Notice(`Could not clear ${configuredProperty?.label || propName}.`);
              return false;
            }
          },
        );
        continue;
      }
      const typedEmptyTarget = Boolean(configuredProperty) || editable;
      const effectiveRawValue = sourceFolderProperty ? entry.file.parent?.path || '/' : rawValue;
      const value = entityReference
        ? this.formatEntityPropertyValue(effectiveRawValue, configuredProperty!)
        : this.formatCardPropertyValue(effectiveRawValue);
      if (!value && !typedEmptyTarget) continue;
      const propertyLabel = configuredProperty?.label || propName;
      const displayValue = noteRecurrenceProperty && !value ? 'Not recurring' : value;
      const readOnlyRecurrenceTitle = noteRecurrenceProperty
        ? `${propertyLabel}: ${displayValue}. Recurrence is read-only in GCM; edit the note frontmatter property directly.`
        : '';
      const span = parent.createSpan({
        cls: `tps-list-native-property${editable ? ' tps-list-native-property--editable' : ''}${noteRecurrenceProperty ? ' tps-list-native-property--readonly' : ''}${!value ? ' is-empty' : ''}`,
        text: displayValue || `+ ${propertyLabel}`,
        attr: {
          title: readOnlyRecurrenceTitle || (editable ? `${value ? 'Edit' : 'Set'} ${propertyLabel}` : value),
          ...(noteRecurrenceProperty ? {
            'aria-label': readOnlyRecurrenceTitle,
            'data-tps-list-read-only-reason': 'recurrence',
          } : {}),
          ...(editable ? { role: 'button', tabindex: '0' } : {}),
        },
      });
      if (!editable) continue;
      span.addEventListener('pointerdown', (event: PointerEvent) => event.stopPropagation());
      span.addEventListener('click', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        this.startListNotePropertyEdit(span, entry.file, propName, rawValue);
      });
      span.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        this.startListNotePropertyEdit(span, entry.file, propName, rawValue);
      });
    }
  }

  private createListBooleanPropertyControl(
    parent: HTMLElement,
    propertyLabel: string,
    rawValue: unknown,
    commit: (next: boolean) => Promise<boolean>,
    clear: () => Promise<boolean>,
  ): HTMLElement {
    const control = parent.createEl('span', {
      cls: 'tps-list-native-property tps-list-native-property--checkbox tps-list-native-property--editable',
    });
    const checkbox = control.createEl('input', {
      cls: 'tps-list-native-property-checkbox',
      attr: { type: 'checkbox' },
    });
    const stateText = control.createSpan({ cls: 'tps-list-native-property-checkbox-label' });
    const clearButton = control.createEl('button', {
      cls: 'tps-list-native-property-checkbox-clear',
      text: '×',
      attr: {
        type: 'button',
        title: `Clear ${propertyLabel}`,
        'aria-label': `Clear ${propertyLabel}`,
      },
    });
    let currentValue = rawValue;
    const renderState = (value: unknown) => {
      const presentation = getBooleanPropertyPresentation(value);
      checkbox.checked = presentation.checked;
      checkbox.indeterminate = presentation.indeterminate;
      checkbox.setAttribute('aria-label', `${propertyLabel}: ${presentation.text}`);
      if (presentation.state === 'invalid') checkbox.setAttribute('aria-invalid', 'true');
      else checkbox.removeAttribute('aria-invalid');
      stateText.setText(`${propertyLabel}: ${presentation.text}`);
      control.dataset.tpsListBooleanState = presentation.state;
      clearButton.disabled = presentation.state === 'unset';
    };
    renderState(currentValue);
    const stop = (event: Event) => event.stopPropagation();
    control.addEventListener('pointerdown', stop);
    control.addEventListener('click', stop);
    control.addEventListener('keydown', stop);
    checkbox.addEventListener('change', (event) => {
      event.stopPropagation();
      if (checkbox.disabled) return;
      const previous = currentValue;
      const next = getNextBooleanPropertyValue(previous);
      currentValue = next;
      renderState(next);
      checkbox.disabled = true;
      clearButton.disabled = true;
      void commit(next).then((changed) => {
        if (!changed) {
          currentValue = previous;
          renderState(previous);
        }
      }).finally(() => {
        checkbox.disabled = false;
        renderState(currentValue);
      });
    });
    clearButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (clearButton.disabled) return;
      const previous = currentValue;
      currentValue = undefined;
      renderState(currentValue);
      checkbox.disabled = true;
      clearButton.disabled = true;
      void clear().then((changed) => {
        if (!changed) {
          currentValue = previous;
          renderState(previous);
        }
      }).finally(() => {
        checkbox.disabled = false;
        renderState(currentValue);
      });
    });
    return control;
  }

  private renderListReadOnlyBooleanProperty(
    parent: HTMLElement,
    propertyLabel: string,
    rawValue: unknown,
  ): HTMLElement {
    const presentation = getBooleanPropertyPresentation(rawValue);
    const control = parent.createEl('span', {
      cls: 'tps-list-native-property tps-list-native-property--checkbox tps-list-native-property--readonly',
      attr: {
        title: `${propertyLabel}: ${presentation.text}`,
        'aria-label': `${propertyLabel}: ${presentation.text}`,
      },
    });
    const checkbox = control.createEl('input', {
      cls: 'tps-list-native-property-checkbox',
      attr: {
        type: 'checkbox',
        disabled: 'true',
        'aria-readonly': 'true',
      },
    });
    checkbox.checked = presentation.checked;
    checkbox.indeterminate = presentation.indeterminate;
    control.createSpan({
      cls: 'tps-list-native-property-checkbox-label',
      text: presentation.text,
    });
    control.dataset.tpsListBooleanState = presentation.state;
    return control;
  }

  private isWritableNotePropertyId(propId: string): boolean {
    const raw = String(propId || '').trim();
    if (!raw) return false;
    if (this.getFrontmatterPropNameFromId(raw)) return true;
    return !raw.includes('.');
  }

  private createListHeadingRow(
    parent: HTMLElement,
    item: TaskRenderItem,
    selectedProps: string[],
    displayLane: DisplayLaneGroup,
  ): void {
    const { file, task } = item;
    const headingLevel = task.headingLevel || 1;
    const headingKind = `h${headingLevel}`;
    const headingTitle = this.getTaskVisibleTitle(task);
    const row = parent.createEl('li', {
      cls: 'tps-list-native-row tps-list-native-row--heading',
      attr: { title: `${file.path}:${task.line}` },
    });
    const selectionFingerprint = hashSelectionIdentity(task.text || headingTitle);
    const selectionId = `${headingKind}:${displayLane.id}:${file.path}:${task.line}:${selectionFingerprint}`;
    row.dataset.path = file.path;
    row.dataset.tpsListSelectionId = selectionId;
    row.dataset.tpsLineContext = 'true';
    row.dataset.tpsHeadingKind = headingKind;
    row.dataset.tpsHeadingLevel = String(headingLevel);
    this.registerListRowModifierSelection(row);
    row.setAttribute('aria-selected', this.selectedRowIds.has(selectionId) ? 'true' : 'false');
    if (this.selectedRowIds.has(selectionId)) row.addClass('tps-list-native-row--selected');

    row.createSpan({
      cls: 'tps-list-native-leading tps-list-native-heading-marker',
      text: headingKind.toUpperCase(),
      attr: { 'aria-hidden': 'true' },
    });
    const body = row.createDiv({ cls: 'tps-list-native-row-body' });
    const title = body.createEl('button', {
      cls: 'tps-list-native-title tps-list-native-title-button tps-list-native-heading-title',
      text: headingTitle,
      attr: { type: 'button', 'aria-label': `Open ${headingKind} heading in ${file.basename}` },
    });
    title.addEventListener('pointerdown', (event: PointerEvent) => event.stopPropagation());
    title.addEventListener('click', (event: MouseEvent) => {
      void this.applyTpsListRowSelection(event, row);
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey || event.metaKey || event.ctrlKey) return;
      void this.openRenderedLineInNote(
        file,
        task.line,
        task.rawLine || '',
        row,
        'HeadingLineOpen',
        'heading',
      );
    });
    row.addEventListener('contextmenu', (event: MouseEvent) => {
      if (this.activeTaskPointerDrag?.cardEl === row) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void this.applyTpsListRowSelection(event, row, true);
      void this.openHeadingLineContextMenu(event, file, task.line, task.rawLine || '', row);
    });

    const hidden = new Set(['tpsinlineprops', 'externalid', 'externaleventid', 'tpscalendaruid', 'tpscalendarsourceurl']);
    for (const propId of selectedProps) {
      let property = this.getTaskPropertyValue(file, task, propId, hidden);
      if (!property && /^formula\./iu.test(String(propId || '').trim())) continue;
      if (!property) {
        const configuredProperty = this.getConfiguredCustomProperty(propId);
        if (isEntityReferenceProperty(configuredProperty)) {
          property = {
            text: `+ ${configuredProperty?.label || configuredProperty?.key || propId}`,
            kind: 'entity',
            editable: true,
            propName: configuredProperty?.key,
            rawValue: '',
          };
        } else if (this.isTagProperty(configuredProperty, propId)) {
          property = {
            text: `+ ${configuredProperty?.label || configuredProperty?.key || propId}`,
            kind: 'tag',
            editable: true,
            propName: configuredProperty?.key || propId,
            rawValue: '',
          };
        } else if (this.isDatetimeProperty(configuredProperty, propId)) {
          property = {
            text: `+ ${configuredProperty?.label || configuredProperty?.key || propId}`,
            kind: 'datetime',
            editable: true,
            propName: configuredProperty?.key || propId,
            rawValue: '',
          };
        } else if (
          configuredProperty
          && !(
            this.normalizeTaskPropertyId(propId) === 'status'
            && !propertyUsesEntityOptions(configuredProperty)
          )
        ) {
          property = {
            text: `+ ${configuredProperty.label || configuredProperty.key || propId}`,
            kind: configuredProperty.type,
            editable: true,
            propName: configuredProperty.key || propId,
            rawValue: '',
          };
        } else if (!this.isStatusPropertyName(propId)) {
          const writablePropertyName = this.getWritableTaskPropertyName(propId);
          if (writablePropertyName) {
            property = {
              text: `+ ${writablePropertyName}`,
              kind: 'text',
              editable: true,
              propName: writablePropertyName,
              rawValue: '',
            };
          }
        }
      }
      if (!property) continue;
      if (property.kind === 'checkbox') {
        if (property.editable && property.propName) this.renderListTaskBooleanProperty(body, file, task, property);
        else this.renderListReadOnlyBooleanProperty(body, property.title || propId, property.rawValue);
        continue;
      }
      const span = body.createSpan({
        cls: `tps-list-native-property${property.kind ? ` tps-list-native-property--${property.kind}` : ''}${property.editable ? ' tps-list-native-property--editable' : ''}`,
        text: property.text,
        attr: {
          title: property.editable ? `Edit ${property.propName || propId}` : property.title || property.text,
          ...(property.editable ? { role: 'button', tabindex: '0' } : {}),
        },
      });
      if (!property.editable || !property.propName) continue;
      span.addEventListener('pointerdown', (event: PointerEvent) => event.stopPropagation());
      span.addEventListener('click', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        this.startListTaskPropertyEdit(span, file, task, property);
      });
      span.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        this.startListTaskPropertyEdit(span, file, task, property);
      });
    }
  }

  private createListTaskRow(
    parent: HTMLElement,
    item: TaskRenderItem,
    selectedProps: string[],
    propName: string | null,
    displayLane: DisplayLaneGroup,
    depth = 0,
  ): void {
    const { file, task } = item;
    const taskTitle = this.getTaskVisibleTitle(task);
    const isBullet = task.itemKind === 'bullet';
    const mappedCheckboxState = isBullet ? '' : this.getMappedCheckboxStateForTask(task);
    const mappedStatus = mappedCheckboxState ? this.getStatusForCheckboxState(mappedCheckboxState) : '';
    const row = parent.createEl('li', {
      cls: 'tps-list-native-row tps-list-native-row--task',
      attr: { title: `${file.path}:${task.line}` },
    });
    const selectionFingerprint = hashSelectionIdentity(task.text || taskTitle);
    const selectionId = `${isBullet ? 'bullet' : 'task'}:${displayLane.id}:${file.path}:${task.line}:${selectionFingerprint}`;
    row.dataset.path = file.path;
    row.dataset.tpsListSelectionId = selectionId;
    row.dataset.tpsTaskContext = 'true';
    this.registerListRowModifierSelection(row);
    row.setAttribute('aria-selected', this.selectedRowIds.has(selectionId) ? 'true' : 'false');
    if (this.selectedRowIds.has(selectionId)) row.addClass('tps-list-native-row--selected');
    row.dataset.tpsListDepth = String(depth);
    row.style.setProperty('--tps-list-task-indent', `${depth * 22}px`);
    row.dataset.tpsKanbanTaskText = task.text;
    if (!isBullet) {
      row.dataset.taskPath = file.path;
      row.dataset.taskLine = String(task.line);
      if (task.rawLine) row.dataset.taskLineIdentity = getTaskLineIdentity(task.rawLine);
      row.dataset.tpsGcmContext = 'kanban-task';
      row.dataset.tpsKanbanPath = file.path;
      row.dataset.tpsKanbanLine = String(task.line);
      row.dataset.tpsKanbanCheckboxState = mappedCheckboxState;
    }

    if (isBullet) {
      const marker = row.createSpan({
        cls: 'tps-list-native-leading tps-list-native-bullet-marker',
        attr: { 'aria-hidden': 'true' },
      });
      setIconWithFallback(marker, 'list');
    } else {
      const checkbox = row.createEl('input', {
        cls: 'tps-list-native-leading tps-list-native-checkbox',
        attr: {
          type: 'checkbox',
          role: 'checkbox',
          'aria-label': `Toggle task: ${taskTitle}`,
          'data-checkbox-state': mappedCheckboxState,
          'data-checkbox-marker': this.getCheckboxMarker(mappedCheckboxState),
        },
      });
      checkbox.checked = this.classifyDoneStatus(mappedStatus) === true;
      checkbox.disabled = !mappedStatus;
      if (!mappedStatus) checkbox.title = 'Checkbox status is unavailable because this marker is not mapped by GCM.';
      checkbox.addEventListener('pointerdown', (event: PointerEvent) => {
        event.stopPropagation();
      });
      checkbox.addEventListener('click', (event: MouseEvent) => {
        event.stopPropagation();
      });
      checkbox.addEventListener('change', (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        this.requestTaskCheckboxToggle(file, task, checkbox);
      });
    }

    const body = row.createDiv({ cls: 'tps-list-native-row-body' });
    const title = body.createEl('button', {
      cls: 'tps-list-native-title tps-list-native-title-button',
      text: taskTitle,
      attr: { type: 'button', 'aria-label': isBullet ? `Open line in ${file.basename}` : `Open task in ${file.basename}` },
    });
    title.addEventListener('pointerdown', (event: PointerEvent) => {
      event.stopPropagation();
      this.beginTaskPointerDrag(event, file, task, propName, displayLane, row);
    });
    title.addEventListener('click', (event: MouseEvent) => {
      if (Date.now() < this.suppressTaskRowClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      void this.applyTpsListRowSelection(event, row);
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (isBullet && this.openBulletLineEditor(event, file, task.line, task.rawLine || '')) return;
      if (!isBullet && this.openTaskQuickEditor(event, row, title)) return;
      event.preventDefault();
      event.stopPropagation();
      if (isBullet) {
        void this.openRenderedLineInNote(
          file,
          task.line,
          task.rawLine || '',
          row,
          'BulletLineOpen',
          'line item',
        );
        return;
      }
      void this.openTaskLine(file, task.line, row);
    });
    row.addEventListener('contextmenu', (event: MouseEvent) => {
      if (this.activeTaskPointerDrag?.cardEl === row) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        await this.applyTpsListRowSelection(event, row, true);
        if (isBullet) {
          await this.openBulletLineContextMenu(event, file, task.line, task.rawLine || '');
          return;
        }
        if (!this.openTaskLineContextMenu(event, file.path, task.line)) {
          await this.openTaskLine(file, task.line, row);
        }
      })();
    });

    const hidden = new Set(['tpsinlineprops', 'externalid', 'externaleventid', 'tpscalendaruid', 'tpscalendarsourceurl']);
    for (const propId of selectedProps) {
      let property = this.getTaskPropertyValue(file, task, propId, hidden);
      if (!property && /^formula\./iu.test(String(propId || '').trim())) continue;
      if (!property) {
        const configuredProperty = this.getConfiguredCustomProperty(propId);
        if (isEntityReferenceProperty(configuredProperty)) {
          property = {
            text: `+ ${configuredProperty?.label || configuredProperty?.key || propId}`,
            kind: 'entity',
            editable: true,
            propName: configuredProperty?.key,
            rawValue: '',
          };
        } else if (this.isTagProperty(configuredProperty, propId)) {
          property = {
            text: `+ ${configuredProperty?.label || configuredProperty?.key || propId}`,
            kind: 'tag',
            editable: true,
            propName: configuredProperty?.key || propId,
            rawValue: '',
          };
        } else if (this.isDatetimeProperty(configuredProperty, propId)) {
          property = {
            text: `+ ${configuredProperty?.label || configuredProperty?.key || propId}`,
            kind: 'datetime',
            editable: true,
            propName: configuredProperty?.key || propId,
            rawValue: '',
          };
        } else if (
          configuredProperty
          && !(
            this.normalizeTaskPropertyId(propId) === 'status'
            && !propertyUsesEntityOptions(configuredProperty)
          )
        ) {
          property = {
            text: `+ ${configuredProperty.label || configuredProperty.key || propId}`,
            kind: configuredProperty.type,
            editable: true,
            propName: configuredProperty.key || propId,
            rawValue: '',
          };
        } else {
          const writablePropertyName = this.getWritableTaskPropertyName(propId);
          if (writablePropertyName) {
            property = {
              text: `+ ${writablePropertyName}`,
              kind: 'text',
              editable: true,
              propName: writablePropertyName,
              rawValue: '',
            };
          }
        }
      }
      if (!property) continue;
      if (property.kind === 'source') {
        const link = body.createEl('a', {
          cls: 'tps-list-native-property tps-list-native-property--source internal-link',
          text: property.text,
          attr: {
            href: file.path,
            'data-href': file.path,
            'data-linkpath': file.path,
            title: property.title || file.path,
            draggable: 'false',
          },
        });
        link.addEventListener('pointerdown', (event: PointerEvent) => event.stopPropagation());
        link.addEventListener('click', (event: MouseEvent) => {
          if (event.shiftKey || event.metaKey || event.ctrlKey) {
            event.preventDefault();
            event.stopPropagation();
            void this.applyTpsListRowSelection(event, row);
            return;
          }
          if (this.openBaseNotePreview(event, file, link)) return;
          event.preventDefault();
          event.stopPropagation();
          void this.openOrFocusFile(file);
        });
        continue;
      }
      if (property.kind === 'checkbox') {
        if (property.editable && property.propName) this.renderListTaskBooleanProperty(body, file, task, property);
        else this.renderListReadOnlyBooleanProperty(body, property.title || propId, property.rawValue);
        continue;
      }
      const span = body.createSpan({
        cls: `tps-list-native-property${property.kind ? ` tps-list-native-property--${property.kind}` : ''}${property.editable ? ' tps-list-native-property--editable' : ''}`,
        text: property.text,
        attr: {
          title: property.editable ? `Edit ${property.propName || propId}` : property.title || property.text,
          ...(property.editable ? { role: 'button', tabindex: '0' } : {}),
        },
      });
      if (property.editable && property.propName) {
        span.addEventListener('pointerdown', (event: PointerEvent) => event.stopPropagation());
        span.addEventListener('click', (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          this.startListTaskPropertyEdit(span, file, task, property);
        });
        span.addEventListener('keydown', (event: KeyboardEvent) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          this.startListTaskPropertyEdit(span, file, task, property);
        });
      }
    }

    row.addEventListener('pointerdown', (event: PointerEvent) => {
      this.beginTaskPointerDrag(event, file, task, propName, displayLane, row);
    });
  }

  private renderListTaskBooleanProperty(
    row: HTMLElement,
    file: TFile,
    task: OpenTaskSubitem,
    property: TpsTaskPropertyDisplay,
  ): void {
    const propertyKey = String(property.propName || '').trim();
    if (!propertyKey) return;
    const configuredProperty = this.getConfiguredCustomProperty(propertyKey);
    const rawValue = property.rawValue === '' && property.text.startsWith('+')
      ? undefined
      : property.rawValue;
    this.createListBooleanPropertyControl(
      row,
      configuredProperty?.label || propertyKey,
      rawValue,
      async (next) => {
        const expectedLine = await this.resolveRenderedTaskLine(file, task, 'boolean-property');
        if (!expectedLine) return false;
        const changed = await this.mutateRenderedTaskLine(
          file,
          task.line,
          expectedLine,
          propertyKey,
          'boolean-property-update',
          (line) => setLogInlineFieldValue(line, propertyKey, next ? 'true' : 'false'),
        );
        if (changed) this.render(false);
        return changed;
      },
      async () => {
        const expectedLine = await this.resolveRenderedTaskLine(file, task, 'boolean-property-clear');
        if (!expectedLine) return false;
        const changed = await this.mutateRenderedTaskLine(
          file,
          task.line,
          expectedLine,
          propertyKey,
          'boolean-property-clear',
          (line) => setLogInlineFieldValue(line, propertyKey, null),
        );
        if (changed) this.render(false);
        return changed;
      },
    );
  }

  private startListTaskPropertyEdit(
    span: HTMLElement,
    file: TFile,
    task: OpenTaskSubitem,
    property: TpsTaskPropertyDisplay,
  ): void {
    const propName = String(property.propName || '').trim();
    if (!propName || span.hasClass('tps-list-native-property--editing')) return;
    const configuredProperty = this.getConfiguredCustomProperty(propName);
    if (
      task.itemKind !== 'heading'
      && !propertyUsesEntityOptions(configuredProperty)
      && (property.kind === 'status' || this.isStatusPropertyName(propName))
    ) {
      void this.openListTaskWorkflowStatusPicker(span, file, task);
      return;
    }
    if (
      !propertyUsesEntityOptions(configuredProperty)
      && this.isTagProperty(configuredProperty, propName)
    ) {
      void this.openListTaskTagPicker(file, task, configuredProperty?.key || propName);
      return;
    }
    if (
      !propertyUsesEntityOptions(configuredProperty)
      && this.isDatetimeProperty(configuredProperty, propName)
    ) {
      void this.openListTaskScheduledPicker(
        file,
        task,
        configuredProperty ?? this.createDatetimeProperty(propName),
      );
      return;
    }
    if (!propertyUsesEntityOptions(configuredProperty) && configuredProperty?.type === 'recurrence') {
      void this.openListTaskRecurrencePicker(file, task, configuredProperty);
      return;
    }
    if (configuredProperty?.type === 'folder') return;
    if (configuredProperty?.type === 'list') {
      void this.openListTaskListEditor(span, file, task, configuredProperty);
      return;
    }
    if (
      configuredProperty
      && (
        isEntityReferenceProperty(configuredProperty)
        || configuredProperty.type === 'selector'
        || configuredProperty.type === 'kind'
      )
    ) {
      const gcm = this.getGcmPlugin();
      void this.openListTaskEntityPicker(file, task, configuredProperty, gcm);
      return;
    }
    void this.openListTaskScalarEditor(
      span,
      file,
      task,
      configuredProperty,
      propName,
      String(property.rawValue ?? property.text),
    );
  }

  private async openListTaskWorkflowStatusPicker(
    span: HTMLElement,
    file: TFile,
    task: OpenTaskSubitem,
  ): Promise<void> {
    const rawLine = await this.resolveRenderedTaskLine(file, task, 'workflow-status-picker');
    if (!rawLine) return;
    const service = this.getGcmPlugin()?.taskLineContextMenuService
      || this.getGcmApi()?.taskLineContextMenuService;
    if (typeof service?.openTaskStatusPicker !== 'function') {
      new Notice('The task status picker is not available.');
      return;
    }
    service.openTaskStatusPicker({
      file,
      lineNumber: task.line,
      lineIndex: Math.max(0, task.line - 1),
      rawLine,
      title: this.getTaskVisibleTitle(task),
    }, span, () => this.render(false));
  }

  private async openListTaskScalarEditor(
    span: HTMLElement,
    file: TFile,
    task: OpenTaskSubitem,
    property: CustomProperty | null,
    propertyKey: string,
    initialValue: string,
  ): Promise<void> {
    const expectedLine = await this.resolveRenderedTaskLine(file, task, 'scalar-editor');
    if (!expectedLine) return;
    this.startListPropertyInput(span, initialValue, async (nextValue) => {
      if (property?.type === 'number' && nextValue && !Number.isFinite(Number(nextValue))) {
        throw new Error('Enter a valid number.');
      }
      const changed = await this.mutateRenderedTaskLine(
        file,
        task.line,
        expectedLine,
        propertyKey,
        'scalar-update',
        (line) => setLogInlineFieldValue(line, propertyKey, nextValue || null),
      );
      if (changed) this.render(false);
    });
  }

  private async openListTaskEntityPicker(
    file: TFile,
    task: OpenTaskSubitem,
    property: CustomProperty,
    source: any,
  ): Promise<void> {
    const expectedLine = await this.resolveRenderedTaskLine(file, task, 'entity-picker');
    if (!expectedLine) return;
    const currentValue = property.type === 'list'
      ? readInlineFieldCarrierValues(expectedLine, property.key).join(', ')
      : readInlineFieldValue(expectedLine, property.key);
    openPropertyValueSuggestModal(this.app, source, property, currentValue, async (choice) => {
      const changed = await this.mutateRenderedTaskLine(
        file,
        task.line,
        expectedLine,
        property.key,
        'property-choice-update',
        (line) => applyLogBasePropertyValueChoice(line, property, choice),
        {
          source: choice.kind,
          acceptedKind: property.acceptsKind,
        },
      );
      if (changed) this.render(false);
    });
  }

  private async openListTaskListEditor(
    anchor: HTMLElement,
    file: TFile,
    task: OpenTaskSubitem,
    property: CustomProperty,
  ): Promise<void> {
    const expectedLine = await this.resolveRenderedTaskLine(file, task, 'list-property-editor');
    if (!expectedLine) return;
    const current = readInlineFieldCarrierValues(expectedLine, property.key).join(', ');
    const values = this.parseConfiguredListValues(property, current);
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle('(none)')
      .setChecked(values.length === 0)
      .onClick(() => {
        void this.mutateRenderedTaskLine(
          file,
          task.line,
          expectedLine,
          property.key,
          'list-property-clear',
          (line) => setLogInlineFieldValue(line, property.key, null),
        ).then((changed) => {
          if (changed) this.render(false);
        });
      }));
    menu.addItem((item) => item
      .setTitle('Add value…')
      .setIcon('plus')
      .onClick(() => {
        openPropertyValueSuggestModal(this.app, this.getGcmPlugin(), property, current, async (choice) => {
          const changed = await this.mutateRenderedTaskLine(
            file,
            task.line,
            expectedLine,
            property.key,
            'list-property-add',
            (line) => choice.kind === 'clear'
              ? setLogInlineFieldValue(line, property.key, null)
              : addLogBaseListPropertyValue(
                  line,
                  property,
                  choice.value,
                  choice.kind === 'entity' ? 'entity' : 'literal',
                ),
            { source: choice.kind, acceptedKind: property.acceptsKind },
          );
          if (changed) this.render(false);
        });
      }));
    if (values.length > 0) {
      menu.addSeparator();
      values.forEach((value) => menu.addItem((item) => item
        .setTitle(`Remove ${/^\[\[/u.test(value) ? getWikilinkDisplayText(value) : value}`)
        .setIcon('x')
        .onClick(() => {
          void this.mutateRenderedTaskLine(
            file,
            task.line,
            expectedLine,
            property.key,
            'list-property-remove',
            (line) => removeLogBaseListPropertyValue(line, property, value),
          ).then((changed) => {
            if (changed) this.render(false);
          });
        })));
    }
    showPropertyValueChoiceMenuAtElement(menu, anchor);
  }

  private async resolveRenderedTaskLine(
    file: TFile,
    task: OpenTaskSubitem,
    source: string,
  ): Promise<string> {
    const expectedLine = String(task.rawLine ?? '');
    const targetLine = Math.max(1, Math.floor(Number(task.line || 1)));
    if (!expectedLine) {
      flowWarn('ListProperty', `${source}:target-unresolved`, {
        path: file.path,
        line: targetLine,
        reason: 'missing-source-revision',
      });
      new Notice('Could not resolve the source line.');
      return '';
    }
    try {
      const content = await this.app.vault.cachedRead(file);
      const parts = splitLineItemContent(content);
      const resolvedIndex = resolveExactLineRevisionIndex(parts.lines, targetLine - 1, expectedLine);
      if (resolvedIndex >= 0) {
        const line = parts.lines[resolvedIndex] || '';
        const parsed = task.itemKind === 'heading'
          ? parseTpsListHeadingLine(line)
          : this.parseLineItem(line, true);
        if (parsed) return line;
      }
    } catch (error) {
      flowError('ListProperty', `${source}:read-failed`, error, {
        path: file.path,
        line: targetLine,
      });
      new Notice('Could not read the source line.');
      return '';
    }
    flowWarn('ListProperty', `${source}:target-unresolved`, {
      path: file.path,
      line: targetLine,
      reason: 'stale-or-ambiguous-source-revision',
    });
    new Notice('Could not resolve the source line.');
    return '';
  }

  private async mutateRenderedTaskLine(
    file: TFile,
    line: number,
    expectedLine: string,
    propertyKey: string,
    event: string,
    updater: (currentLine: string) => string,
    logContext: Record<string, unknown> = {},
  ): Promise<boolean> {
    const targetLine = Math.max(1, Math.floor(Number(line || 1)));
    const expectedIsHeading = parseTpsListHeadingLine(expectedLine) != null;
    const expectedItem = expectedIsHeading ? null : this.parseLineItem(expectedLine, true);
    const mutation: { outcome: 'changed' | 'unchanged' | 'stale' } = { outcome: 'unchanged' };
    let resolvedLine = targetLine;
    let committedLine = '';
    let historyReady = true;
    let confirmedHistoryBefore: DirectTaskHistoryLocation | undefined;
    const historyService = this.plugin?.itemHistoryService;
    const historyContext: DirectTaskHistoryLogContext = {
      action: 'task.update',
      surface: 'tps-list',
      path: file.path,
      lineNumber: targetLine - 1,
    };
    const historyHandle = expectedItem?.itemKind === 'task'
      ? await beginDirectTaskHistory(historyService, {
          action: historyContext.action,
          cause: {
            kind: 'user',
            sourcePluginId: 'tps-global-context-menu',
            surface: historyContext.surface,
          },
          before: {
            path: file.path,
            lineNumber: targetLine - 1,
            rawLine: expectedLine,
          },
        })
      : null;
    try {
      await this.app.vault.process(file, (content) => {
        const parts = splitLineItemContent(content);
        const index = resolveExactLineRevisionIndex(parts.lines, targetLine - 1, expectedLine);
        if (index < 0) {
          mutation.outcome = 'stale';
          return content;
        }
        const currentLine = parts.lines[index] || '';
        confirmedHistoryBefore = {
          path: file.path,
          lineNumber: index,
          rawLine: currentLine,
        };
        const currentItem = expectedIsHeading ? null : this.parseLineItem(currentLine, true);
        const currentMatchesKind = expectedIsHeading
          ? parseTpsListHeadingLine(currentLine) != null
          : currentItem != null;
        if (!currentMatchesKind) return content;
        const nextLine = updater(currentLine);
        if (nextLine === currentLine) return content;
        let finalNext = nextLine;
        if (historyHandle) {
          if (currentItem?.itemKind !== 'task') {
            historyReady = false;
          } else {
            const ensured = ensureDirectTaskHistoryIdentity(
              historyService,
              historyHandle,
              nextLine,
              historyContext,
            );
            finalNext = ensured.line;
            historyReady = ensured.ready;
          }
        }
        parts.lines[index] = finalNext;
        committedLine = finalNext;
        resolvedLine = index + 1;
        mutation.outcome = 'changed';
        return `${parts.lines.join(parts.newline)}${parts.endsWithNewline ? parts.newline : ''}`;
      });
    } catch (error) {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      throw error;
    }
    if (mutation.outcome === 'stale') {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      flowWarn('ListProperty', `${event}:stale-target`, {
        path: file.path,
        requestedLine: targetLine,
        property: propertyKey,
        ...logContext,
      });
      new Notice('The source line changed while the property picker was open.');
      return false;
    }
    if (mutation.outcome !== 'changed') {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      return false;
    }
    if (historyReady && committedLine) {
      await commitDirectTaskHistory(historyService, historyHandle, {
        ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
        after: {
          path: file.path,
          lineNumber: resolvedLine - 1,
          rawLine: committedLine,
        },
        sourceDisposition: 'retained',
        outcome: 'committed',
      }, historyContext);
    } else {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
    }
    this.clearTaskCachesForPath(file.path);
    emitFilesUpdated(this.app, [file.path], 'tps-list');
    flow('ListProperty', `${event}:done`, {
      path: file.path,
      requestedLine: targetLine,
      resolvedLine,
      property: propertyKey,
      ...logContext,
    });
    return true;
  }

  private async openListTaskTagPicker(
    file: TFile,
    task: OpenTaskSubitem,
    propertyKey: string,
  ): Promise<void> {
    const expectedLine = await this.resolveRenderedTaskLine(file, task, 'tag-picker');
    if (!expectedLine) return;
    const semanticTaskTags = /^(?:tag|tags)$/iu.test(this.normalizeInlinePropertyKey(propertyKey));
    const current = semanticTaskTags
      ? readTaskLineTags(expectedLine)
      : parseTaskTagValues(readInlineFieldCarrierValues(expectedLine, propertyKey));
    new TagSuggestModal(this.app, [...collectKnownVaultTags(this.app), ...current], async (tag, selected) => {
      const changed = await this.mutateRenderedTaskLine(
        file,
        task.line,
        expectedLine,
        propertyKey,
        'tag-update',
        (line) => {
          if (semanticTaskTags) {
            return toggleLogLineSemanticTag(line, propertyKey, tag, selected);
          }
          const existing = parseTaskTagValues(readInlineFieldCarrierValues(line, propertyKey));
          const normalizedTag = tag.toLocaleLowerCase();
          const next = selected
            ? existing.filter((value) => value.toLocaleLowerCase() !== normalizedTag)
            : Array.from(new Set([...existing, normalizedTag]));
          return setLogInlineFieldValue(
            line,
            propertyKey,
            next.length > 0 ? next.map((value) => `#${value}`).join(', ') : null,
          );
        },
        { tag, action: selected ? 'remove' : 'add' },
      );
      if (changed) this.render(false);
    }, {
      title: 'Choose tag',
      selectedTags: current,
    }).open();
  }

  private async openListTaskScheduledPicker(
    file: TFile,
    task: OpenTaskSubitem,
    property: CustomProperty,
  ): Promise<void> {
    const expectedLine = await this.resolveRenderedTaskLine(file, task, 'datetime-picker');
    if (!expectedLine) return;
    const isScheduled = this.normalizeInlinePropertyKey(property.key) === 'scheduled';
    const current = readInlineFieldValue(expectedLine, property.key);
    const timeEstimate = Number.parseInt(readInlineFieldValue(expectedLine, 'timeEstimate') || '0', 10) || 0;
    const allDay = /^true$/iu.test(readInlineFieldValue(expectedLine, 'allDay'));
    new ScheduledModal(this.app, current, timeEstimate, allDay, async (result) => {
      const changed = await this.mutateRenderedTaskLine(
        file,
        task.line,
        expectedLine,
        property.key,
        'datetime-update',
        (line) => {
          let next = setLogInlineFieldValue(line, property.key, result.date || null);
          if (isScheduled) {
            next = setLogInlineFieldValue(
              next,
              'timeEstimate',
              result.date ? String(result.timeEstimate || 0) : null,
            );
            next = setLogInlineFieldValue(
              next,
              'allDay',
              result.date && result.allDay ? 'true' : null,
            );
          }
          return next;
        },
        {
          cleared: !result.date,
          allDay: result.allDay,
          timeEstimate: result.timeEstimate,
        },
      );
      if (changed) this.render(false);
    }, isScheduled ? {} : {
      title: `Set ${property.label || property.key}`,
      fieldLabel: property.label || property.key,
      showTimeDetails: false,
    }).open();
  }

  private async openListTaskRecurrencePicker(
    file: TFile,
    task: OpenTaskSubitem,
    property: CustomProperty,
  ): Promise<void> {
    const expectedLine = await this.resolveRenderedTaskLine(file, task, 'recurrence-picker');
    if (!expectedLine) return;
    const current = readInlineFieldValue(expectedLine, property.key);
    const scheduled = readInlineFieldValue(expectedLine, 'scheduled');
    const startDate = scheduled ? new Date(scheduled.replace(' ', 'T')) : new Date();
    new RecurrenceModal(
      this.app,
      current,
      Number.isNaN(startDate.getTime()) ? new Date() : startDate,
      '',
      async (rule) => {
        const changed = await this.mutateRenderedTaskLine(
          file,
          task.line,
          expectedLine,
          property.key,
          'recurrence-update',
          (line) => setLogInlineFieldValue(line, property.key, rule || null),
          { cleared: !rule },
        );
        if (changed) this.render(false);
      },
      { showEndsOn: false },
    ).open();
  }

  private startListNotePropertyEdit(
    span: HTMLElement,
    file: TFile,
    propName: string,
    rawValue: unknown,
  ): void {
    const writableProp = this.getFrontmatterPropNameFromId(propName) ?? propName;
    if (!writableProp || span.hasClass('tps-list-native-property--editing')) return;
    const configuredProperty = this.getConfiguredCustomProperty(writableProp);
    if (configuredProperty?.type === 'folder' || configuredProperty?.type === 'recurrence') return;
    if (!propertyUsesEntityOptions(configuredProperty) && configuredProperty?.type === 'snooze') {
      const menuController = this.getGcmPlugin()?.menuController || this.getGcmApi()?.menuController;
      if (typeof menuController?.openSnoozeModal !== 'function') {
        new Notice('The snooze picker is not available.');
        return;
      }
      const frontmatter = {
        ...(this.app.metadataCache.getFileCache(file)?.frontmatter || {}),
      };
      menuController.openSnoozeModal([{ file, frontmatter }], configuredProperty.key || writableProp);
      return;
    }
    if (
      !propertyUsesEntityOptions(configuredProperty)
      && this.isTagProperty(configuredProperty, writableProp)
    ) {
      const current = parseTaskTagValues(rawValue);
      new TagSuggestModal(this.app, [...collectKnownVaultTags(this.app), ...current], async (tag, selected) => {
        await this.processFrontmatter(file, (fm) => {
          const actualKey = this.findFrontmatterKeyCaseInsensitive(fm, writableProp) || writableProp;
          const existing = parseTaskTagValues(fm[actualKey]);
          const normalizedTag = tag.toLocaleLowerCase();
          const next = selected
            ? existing.filter((value) => value.toLocaleLowerCase() !== normalizedTag)
            : Array.from(new Set([...existing, normalizedTag]));
          if (next.length > 0) fm[actualKey] = next;
          else delete fm[actualKey];
        });
        emitFilesUpdated(this.app, [file.path], 'tps-list');
        this.render(false);
      }, {
        title: 'Choose tag',
        selectedTags: current,
      }).open();
      return;
    }
    if (
      !propertyUsesEntityOptions(configuredProperty)
      && this.isDatetimeProperty(configuredProperty, writableProp)
    ) {
      const property = configuredProperty ?? this.createDatetimeProperty(writableProp);
      const cacheFrontmatter = (this.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, unknown>;
      const actualKey = this.findFrontmatterKeyCaseInsensitive(cacheFrontmatter, writableProp) || writableProp;
      const current = this.stringifyEditablePropertyValue(cacheFrontmatter[actualKey] ?? rawValue);
      const timeEstimate = Number.parseInt(String(cacheFrontmatter.timeEstimate || '0'), 10) || 0;
      const allDay = cacheFrontmatter.allDay === true || /^true$/iu.test(String(cacheFrontmatter.allDay || ''));
      const isScheduled = this.normalizeInlinePropertyKey(property.key) === 'scheduled';
      new ScheduledModal(this.app, current, timeEstimate, allDay, async (result) => {
        await this.processFrontmatter(file, (fm) => {
          const destinationKey = this.findFrontmatterKeyCaseInsensitive(fm, writableProp) || writableProp;
          if (result.date) fm[destinationKey] = result.date;
          else delete fm[destinationKey];
          if (isScheduled) {
            if (result.date) fm.timeEstimate = result.timeEstimate || 0;
            else delete fm.timeEstimate;
            if (result.date && result.allDay) fm.allDay = true;
            else delete fm.allDay;
          }
        });
        emitFilesUpdated(this.app, [file.path], 'tps-list');
        this.render(false);
      }, isScheduled ? {} : {
        title: `Set ${property.label || property.key}`,
        fieldLabel: property.label || property.key,
        showTimeDetails: false,
      }).open();
      return;
    }
    if (
      configuredProperty
      && configuredProperty.type === 'list'
    ) {
      this.openListNoteListEditor(span, file, writableProp, rawValue, configuredProperty);
      return;
    }
    if (
      configuredProperty
      && (
        isEntityReferenceProperty(configuredProperty)
        || configuredProperty.type === 'selector'
        || configuredProperty.type === 'kind'
      )
    ) {
      const gcm = this.getGcmPlugin();
      openPropertyValueSuggestModal(
        this.app,
        gcm,
        configuredProperty,
        this.stringifyEditablePropertyValue(rawValue),
        async (choice) => {
        await this.processFrontmatter(file, (fm) => {
          const actualKey = this.findFrontmatterKeyCaseInsensitive(fm, writableProp) || writableProp;
          if (choice.kind === 'clear') {
            delete fm[actualKey];
          } else if (configuredProperty.type === 'list') {
            fm[actualKey] = choice.kind === 'entity'
              ? isLinkListProperty(configuredProperty)
                ? mergeEntityReferenceList(fm[actualKey], choice.value)
                : mergeMixedEntityReferenceList(fm[actualKey], choice.value)
              : isLinkListProperty(configuredProperty)
                ? mergeLinkList(fm[actualKey], choice.value)
                : propertyUsesEntityOptions(configuredProperty)
                  ? mergeMixedList(fm[actualKey], choice.value)
                  : mergeStringList(fm[actualKey], choice.value);
          } else {
            fm[actualKey] = choice.value;
          }
        });
        emitFilesUpdated(this.app, [file.path], 'tps-list');
        this.render(false);
        },
      );
      return;
    }
    this.startListPropertyInput(span, this.stringifyEditablePropertyValue(rawValue), async (nextValue) => {
      await this.processFrontmatter(file, (fm) => {
        const actualKey = this.findFrontmatterKeyCaseInsensitive(fm, writableProp) || writableProp;
        const currentValue = fm[actualKey];
        if (!nextValue.trim()) {
          delete fm[actualKey];
        } else if (configuredProperty?.type === 'number') {
          const numeric = Number(nextValue);
          if (!Number.isFinite(numeric)) throw new Error('Enter a valid number.');
          fm[actualKey] = numeric;
        } else if (configuredProperty?.type === 'checkbox') {
          fm[actualKey] = /^(?:true|yes|1|on)$/iu.test(nextValue);
        } else if (configuredProperty?.type === 'list') {
          fm[actualKey] = isLinkListProperty(configuredProperty)
            ? parseLinkListInput(nextValue)
            : parseStringListInput(nextValue);
        } else if (!configuredProperty) {
          fm[actualKey] = this.coerceUnconfiguredFrontmatterValue(currentValue, nextValue);
        } else {
          fm[actualKey] = nextValue.trim();
        }
      });
      emitFilesUpdated(this.app, [file.path], 'tps-list');
      this.render(false);
    });
  }

  private openListNoteListEditor(
    anchor: HTMLElement,
    file: TFile,
    propertyKey: string,
    rawValue: unknown,
    property: CustomProperty,
  ): void {
    const values = this.parseConfiguredListValues(property, rawValue);
    const menu = new Menu();
    const mutate = async (
      route: string,
      updater: (current: unknown) => unknown[] | null,
    ): Promise<void> => {
      try {
        await this.processFrontmatter(file, (fm) => {
          const actualKey = this.findFrontmatterKeyCaseInsensitive(fm, propertyKey) || propertyKey;
          const next = updater(fm[actualKey]);
          if (next && next.length > 0) fm[actualKey] = next;
          else delete fm[actualKey];
        });
        emitFilesUpdated(this.app, [file.path], 'tps-list');
        this.render(false);
        flow('ListProperty', route, { path: file.path, property: property.key });
      } catch (error) {
        flowError('ListProperty', `${route}:failed`, error, { path: file.path, property: property.key });
        new Notice(`Could not update ${property.label || property.key}.`);
      }
    };
    menu.addItem((item) => item
      .setTitle('(none)')
      .setChecked(values.length === 0)
      .onClick(() => { void mutate('list-note-clear', () => null); }));
    menu.addItem((item) => item
      .setTitle('Add value…')
      .setIcon('plus')
      .onClick(() => {
        openPropertyValueSuggestModal(
          this.app,
          this.getGcmPlugin(),
          property,
          this.stringifyEditablePropertyValue(rawValue),
          async (choice) => {
            await mutate('list-note-add', (current) => {
              if (choice.kind === 'clear') return null;
              return choice.kind === 'entity'
                ? isLinkListProperty(property)
                  ? mergeEntityReferenceList(current, choice.value)
                  : mergeMixedEntityReferenceList(current, choice.value)
                : isLinkListProperty(property)
                  ? mergeLinkList(current, choice.value)
                  : propertyUsesEntityOptions(property)
                    ? mergeMixedList(current, choice.value)
                    : mergeStringList(current, choice.value);
            });
          },
        );
      }));
    if (values.length > 0) {
      menu.addSeparator();
      values.forEach((value) => menu.addItem((item) => item
        .setTitle(`Remove ${/^\[\[/u.test(value) ? getWikilinkDisplayText(value) : value}`)
        .setIcon('x')
        .onClick(() => {
          void mutate('list-note-remove', (current) => this.removeConfiguredListValue(property, current, value));
        })));
    }
    showPropertyValueChoiceMenuAtElement(menu, anchor);
  }

  private parseConfiguredListValues(property: CustomProperty, value: unknown): string[] {
    if (propertyUsesEntityOptions(property)) {
      return isLinkListProperty(property) ? parseLinkListInput(value) : parseMixedListInput(value);
    }
    return isLinkListProperty(property) ? parseLinkListInput(value) : parseStringListInput(value);
  }

  private removeConfiguredListValue(
    property: CustomProperty,
    current: unknown,
    value: string,
  ): string[] {
    if (propertyUsesEntityOptions(property)) {
      return isLinkListProperty(property)
        ? removeEntityReferenceListValues(current, value)
        : removeMixedEntityReferenceListValues(current, value);
    }
    return isLinkListProperty(property)
      ? removeLinkListValues(current, value)
      : removeStringListValues(current, value);
  }

  private startListPropertyInput(
    span: HTMLElement,
    initialValue: string,
    commit: (value: string) => Promise<void>,
  ): void {
    span.addClass('tps-list-native-property--editing');
    const originalText = span.textContent || '';
    span.empty();
    const input = span.createEl('input', {
      cls: 'tps-list-native-property-input',
      attr: {
        type: 'text',
        value: initialValue,
        'aria-label': 'Edit property value',
      },
    });
    let closed = false;
    const close = (restore = true) => {
      if (closed) return;
      closed = true;
      span.removeClass('tps-list-native-property--editing');
      span.empty();
      span.setText(restore ? originalText : input.value.trim());
    };
    const save = async () => {
      if (closed) return;
      const nextValue = input.value.trim();
      if (nextValue === String(initialValue || '').trim()) {
        close(true);
        return;
      }
      input.disabled = true;
      try {
        await commit(nextValue);
        close(false);
      } catch (error) {
        flowError('ListProperty', 'update-failed', error, { initialValue, nextValue });
        new Notice('Could not update property.');
        close(true);
      }
    };
    input.addEventListener('pointerdown', (event: PointerEvent) => event.stopPropagation());
    input.addEventListener('click', (event: MouseEvent) => event.stopPropagation());
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        void save();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    });
    input.addEventListener('blur', () => {
      void save();
    });
    input.focus();
    input.select();
  }

  private stringifyEditablePropertyValue(value: unknown): string {
    if (value == null) return '';
    if (Array.isArray(value)) {
      return value
        .map((item) => item instanceof Date ? item.toISOString() : String(item ?? '').trim())
        .filter(Boolean)
        .join(', ');
    }
    if (value instanceof Date) return value.toISOString();
    return String(value).trim();
  }

  private coerceUnconfiguredFrontmatterValue(currentValue: unknown, nextValue: string): unknown {
    const trimmed = nextValue.trim();
    if (Array.isArray(currentValue)) {
      const values = parseMixedListInput(trimmed);
      const existingValues = currentValue.filter((value) => value !== null && value !== undefined);
      if (existingValues.length > 0 && existingValues.every((value) => typeof value === 'number')) {
        return values.map((value) => {
          const numeric = Number(value);
          if (!Number.isFinite(numeric)) throw new Error('Enter valid numbers separated by commas.');
          return numeric;
        });
      }
      if (existingValues.length > 0 && existingValues.every((value) => typeof value === 'boolean')) {
        return values.map((value) => this.parseEditableBoolean(value));
      }
      if (existingValues.length > 0 && existingValues.every((value) => value instanceof Date)) {
        return values.map((value) => this.parseEditableDate(value));
      }
      return values;
    }
    if (typeof currentValue === 'boolean') return this.parseEditableBoolean(trimmed);
    if (typeof currentValue === 'number') {
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric)) throw new Error('Enter a valid number.');
      return numeric;
    }
    if (currentValue instanceof Date) return this.parseEditableDate(trimmed);
    return trimmed;
  }

  private parseEditableBoolean(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (/^(?:true|yes|1|on)$/u.test(normalized)) return true;
    if (/^(?:false|no|0|off)$/u.test(normalized)) return false;
    throw new Error('Enter true or false.');
  }

  private parseEditableDate(value: string): Date {
    const parsed = new Date(value.trim());
    if (Number.isNaN(parsed.getTime())) throw new Error('Enter a valid date.');
    return parsed;
  }

  private formatEntityPropertyValue(value: unknown, property: CustomProperty): string {
    const values = property.type === 'list' && !isLinkListProperty(property)
      ? parseMixedListInput(value)
      : parseLinkListInput(value);
    const selected = property.type === 'list' ? values : values.slice(0, 1);
    return selected
      .map((item) => /^\[\[/u.test(item) ? getWikilinkDisplayText(item) : item)
      .filter(Boolean)
      .join(', ');
  }

  private isTagProperty(property: CustomProperty | null, reference: string): boolean {
    return isTagListProperty(property)
      || /^(?:tag|tags)$/u.test(this.normalizeInlinePropertyKey(property?.key || reference));
  }

  private isDatetimeProperty(property: CustomProperty | null, reference: string): boolean {
    return property?.type === 'datetime'
      || property?.type === 'snooze'
      || this.normalizeInlinePropertyKey(property?.key || reference) === 'scheduled';
  }

  private createDatetimeProperty(reference: string): CustomProperty {
    const key = String(reference || 'scheduled')
      .replace(/^task\./iu, '')
      .replace(/^note\./iu, '')
      .trim() || 'scheduled';
    return {
      id: key,
      key,
      label: key.replace(/([a-z0-9])([A-Z])/gu, '$1 $2').replace(/\b\w/gu, (letter) => letter.toUpperCase()),
      type: 'datetime',
    };
  }

  private getWritableTaskPropertyName(reference: string): string | null {
    const raw = String(reference || '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (
      lower.startsWith('file.')
      || lower.startsWith('formula.')
      || lower.startsWith('source.')
    ) return null;

    const normalized = this.normalizeTaskPropertyId(raw);
    if (
      !normalized
      || [
        'title',
        'text',
        'linetext',
        'headingtext',
        'kind',
        'itemkind',
        'itemtype',
        'path',
        'file',
        'source',
        'line',
        'level',
        'headinglevel',
        'status',
        'checkboxstatus',
        'taskstatus',
      ].includes(normalized)
    ) return null;

    return this.getTaskInlinePropertyName(raw) || null;
  }

  private getConfiguredCustomProperty(reference: string): CustomProperty | null {
    const gcm = this.getGcmPlugin();
    return resolveConfiguredProperty(gcm?.settings?.properties || [], reference);
  }
}
