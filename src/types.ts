import { TFile, MarkdownView } from 'obsidian';

export interface CustomProperty {
  id: string;
  label: string;
  key: string;
  type: 'text' | 'number' | 'datetime' | 'selector' | 'list' | 'checkbox' | 'recurrence' | 'folder' | 'snooze' | 'kind';
  options?: string[]; // For selector/list suggestions
  /**
   * Composable sources for selectable values. `optionsSource` remains for
   * backwards compatibility with releases where `vault` meant manual + vault.
   */
  optionSources?: PropertyOptionSource[];
  optionsSource?: 'manual' | 'vault';
  listItemType?: 'tag' | 'text' | 'link'; // For list
  /**
   * Restrict this property's values to indexed notes or structural Markdown
   * lines whose Kind identity matches any configured value. Persisted as a
   * lowercase, comma-separated string for backward compatibility. Entity
   * choices are stored as canonical wikilinks. Mixed source modes keep literal
   * values unchanged; entity-only lists use link-list storage.
   */
  acceptsKind?: string;
  disabled?: boolean;
  hidden?: boolean;
  scopeTags?: string[];
  scopeMode?: 'any' | 'all';
  excludeTags?: string[];
  scopePaths?: string[];
  excludePaths?: string[];
  scopeProperties?: Array<{ key: string; value: string; operator?: 'equals' | 'contains' | 'exists' | 'missing' | 'not-equals' | 'not-contains' }>;
  icon?: string;
  showInCollapsed?: boolean; // Whether to show this property in the collapsed inline header
  showInContextMenu?: boolean; // Whether to show this property in the right-click context menu
  allowInlineSet?: boolean; // Whether this property can be inserted with task-line @@ inline syntax
  showWhen?: 'always' | 'populated' | 'exists' | 'empty' | 'blank' | 'missing' | 'never'; // Controls property visibility based on key/value presence
  inlineShowWhen?: 'always' | 'populated' | 'exists' | 'empty' | 'blank' | 'missing' | 'never'; // Optional inline/header visibility override
  contextMenuShowWhen?: 'always' | 'populated' | 'exists' | 'empty' | 'blank' | 'missing' | 'never'; // Optional right-click menu visibility override
}

export type PropertyOptionSource = 'manual' | 'vault' | 'entity';

export type VirtualBaseEmbedPlacement = 'top' | 'bottom' | 'hover';

export interface VirtualBaseEmbedProperty {
  key: string;
  placement: VirtualBaseEmbedPlacement;
}


export type GcmLiveMenuPosition = 'left' | 'center' | 'right';
export type ParentLinkFormat = 'wikilink' | 'markdown-title';
export type ChecklistPromotionBehavior = 'remove' | 'complete-and-link' | 'link-only';
export type LinkedSubitemCheckboxStyle = 'native' | 'soft-link' | 'accent';
export type TimeTrackingStorageMode = 'daily-note' | 'source-note' | 'dedicated-note';
export type TpsBaseWriteFallbackMode = 'filter-required' | 'today-daily-note' | 'specific-note';
type ExtensibleLiteral<T extends string> = T | (string & Record<never, never>);

export type TpsRecordKind = ExtensibleLiteral<'note' | 'task' | 'project' | 'food' | 'log' | 'workflow' | 'run' | 'workout' | 'workout-plan'>;
export type WorkflowRecurrenceMode = 'completion-triggered' | 'scheduled';
export type WorkflowTemplateKind = 'workflow';
export type WorkflowRunKind = 'run';
export type WorkflowRunType = ExtensibleLiteral<'workflow' | 'workout'>;

export interface WorkflowTemplateFrontmatter {
  kind?: TpsRecordKind;
  workflowKind?: WorkflowTemplateKind;
  workflowType?: WorkflowRunType;
  recurrenceMode?: WorkflowRecurrenceMode;
  targetGapDays?: number;
  lastCompletedDate?: string;
  lastRunPath?: string;
}

export interface WorkflowRunFrontmatter {
  kind?: TpsRecordKind;
  runKind?: WorkflowRunKind;
  runType?: WorkflowRunType;
  workflowPath?: string;
  workflowName?: string;
  workflowType?: WorkflowRunType;
  recurrenceMode?: WorkflowRecurrenceMode;
  startedAt?: string;
  endedAt?: string;
  completedDate?: string;
  previousCompletedDate?: string;
  secondsSincePreviousCompletion?: number;
  targetGapDays?: number;
}
export interface TimeTrackingPausedSessionState {
  targetId: string;
  targetType: 'note' | 'heading' | 'bullet' | 'task' | 'line';
  sourcePath: string;
  lineNumber?: number;
  title: string;
  pausedAt: string;
  elapsedMs: number;
  lastSessionId?: string;
}
export interface LinkedSubitemCheckboxMapping {
  checkboxState: string;
  statuses: string[];
  toggleTargetStatus?: string;
  icon?: string;
  label?: string;
}
export type AppearanceSyncMode = 'synced' | 'local';
export type AppearanceSettingKey =
  | 'menuTextScale'
  | 'buttonScale'
  | 'controlScale'
  | 'menuDensity'
  | 'menuRadiusScale'
  | 'liveMenuPosition'
  | 'liveMenuOffsetX'
  | 'liveMenuOffsetY'
  | 'modalWidth'
  | 'modalMaxHeightVh'
  | 'subitemsMarginBottom'
  | 'dailyNavScale'
  | 'dailyNavRestOpacity';

export type ViewModeRuleMatch = 'all' | 'any';
export type ViewModeConditionType = 'frontmatter' | 'path' | 'scheduled' | 'daily-note';
export type ViewModeConditionOperator =
  | 'equals'
  | 'contains'
  | 'starts-with'
  | 'ends-with'
  | 'not-equals'
  | 'not-contains'
  | 'exists'
  | 'missing'
  | 'is-empty'
  | 'past'
  | 'future'
  | 'today'
  | 'not-today';

export interface ViewModeRuleCondition {
  type: ViewModeConditionType;
  key?: string;
  operator?: ViewModeConditionOperator;
  value?: string;
}

export interface ViewModeRule {
  mode: string;
  match?: ViewModeRuleMatch;
  conditions?: ViewModeRuleCondition[];
  // Legacy rule format compatibility
  key?: string;
  value?: string;
}

export type NotebookNavigatorRuleOperator = 'is' | '!is' | 'contains' | '!contains' | 'exists' | '!exists';
export type NotebookNavigatorSmartRuleOperator =
  | NotebookNavigatorRuleOperator
  | 'is-not-empty'
  | 'starts'
  | '!starts'
  | 'within-next-days'
  | '!within-next-days'
  | 'has-open-checkboxes'
  | '!has-open-checkboxes'
  | 'is-today'
  | '!is-today'
  | 'is-before-today'
  | '!is-before-today'
  | 'is-after-today'
  | '!is-after-today';
export type NotebookNavigatorRuleMatchMode = 'all' | 'any';
export type NotebookNavigatorRuleConditionSource =
  | 'frontmatter'
  | 'path'
  | 'extension'
  | 'name'
  | 'tag'
  | 'body'
  | 'checkbox-state'
  | 'date-created'
  | 'date-modified'
  | 'parent-frontmatter'
  | 'parent-tag'
  | 'parent-name'
  | 'parent-path';

export type RuleOperator = NotebookNavigatorRuleOperator;
export type SmartRuleOperator = NotebookNavigatorSmartRuleOperator;
export type RuleMatchMode = NotebookNavigatorRuleMatchMode;
export type RuleConditionSource = NotebookNavigatorRuleConditionSource;

export interface RuleCondition {
  source: NotebookNavigatorRuleConditionSource;
  field: string;
  operator: NotebookNavigatorSmartRuleOperator;
  value: string;
}

export interface IconColorRule {
  id: string;
  name: string;
  enabled: boolean;
  property: string;
  operator: NotebookNavigatorRuleOperator;
  value: string;
  pathPrefix: string;
  icon: string;
  color: string;
  match: NotebookNavigatorRuleMatchMode;
  conditions: RuleCondition[];
}

export interface SortValueMapping {
  input: string;
  output: string;
}

export type SortFieldType = 'date' | 'status' | 'priority' | 'text' | 'number';

export interface SortCriteria {
  source: NotebookNavigatorRuleConditionSource;
  field: string;
  type: SortFieldType;
  direction: 'asc' | 'desc';
  mappings: SortValueMapping[];
  missingValuePlacement: 'first' | 'last';
}

export interface ConditionGroup {
  id: string;
  match: NotebookNavigatorRuleMatchMode;
  conditions: RuleCondition[];
}

export interface SortBucket {
  id: string;
  enabled: boolean;
  name: string;
  match: NotebookNavigatorRuleMatchMode;
  conditions: RuleCondition[];
  conditionGroups?: ConditionGroup[];
  sortCriteria: SortCriteria[];
}

export interface SmartSortSettings {
  enabled: boolean;
  field: string;
  separator: string;
  appendBasename: boolean;
  relationshipGrouping: 'none' | 'children-under-parent';
  clearWhenNoMatch: boolean;
  buckets: SortBucket[];
}

export interface RuleFileDescriptor {
  path: string;
  name: string;
  basename: string;
  extension: string;
}

export interface RelationshipLineageNode {
  file: RuleFileDescriptor;
  frontmatter: Record<string, unknown> | null;
  tags: string[];
}

export interface RuleEvaluationContext {
  file: RuleFileDescriptor;
  frontmatter: Record<string, unknown> | null;
  tags: string[];
  body?: string;
  checkboxStates?: string[];
  lineType?: 'note' | 'task';
  relationshipLineage?: RelationshipLineageNode[];
  parent?: {
    file: RuleFileDescriptor;
    frontmatter: Record<string, unknown> | null;
    tags: string[];
  };
}

export interface SortSegmentRule {
  id: string;
  enabled: boolean;
  source: NotebookNavigatorRuleConditionSource;
  field: string;
  fallback: string;
  mappings: SortValueMapping[];
  match: NotebookNavigatorRuleMatchMode;
  conditions: RuleCondition[];
}

export interface HideRule {
  id: string;
  name: string;
  enabled: boolean;
  match: NotebookNavigatorRuleMatchMode;
  conditions: RuleCondition[];
  mode: 'add' | 'remove';
  tagName: string;
}

export interface NotebookNavigatorRuleSettings {
  enabled: boolean;
  autoApplyOnFileOpen: boolean;
  autoApplyOnMetadataChange: boolean;
  applyOnStartup: boolean;
  startupDelayMs: number;
  metadataDebounceMs: number;
  frontmatterIconField: string;
  frontmatterColorField: string;
  frontmatterWriteExclusions: string;
  clearIconWhenNoMatch: boolean;
  clearColorWhenNoMatch: boolean;
  autoRemoveHiddenWhenNoMatch: boolean;
  rules: IconColorRule[];
  smartSort: SmartSortSettings;
  hideRules: HideRule[];
}

export const DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS: NotebookNavigatorRuleSettings = {
  enabled: false,
  autoApplyOnFileOpen: false,
  autoApplyOnMetadataChange: false,
  applyOnStartup: false,
  startupDelayMs: 800,
  metadataDebounceMs: 150,
  frontmatterIconField: 'icon',
  frontmatterColorField: 'color',
  frontmatterWriteExclusions: '',
  clearIconWhenNoMatch: false,
  clearColorWhenNoMatch: false,
  autoRemoveHiddenWhenNoMatch: true,
  rules: [],
  smartSort: {
    enabled: false,
    field: 'sort',
    separator: '_',
    appendBasename: true,
    relationshipGrouping: 'none',
    clearWhenNoMatch: false,
    buckets: [],
  },
  hideRules: [],
};

export function createRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createDefaultRule(): IconColorRule {
  return {
    id: createRuleId(),
    name: '',
    enabled: true,
    property: 'status',
    operator: 'is',
    value: '',
    pathPrefix: '',
    icon: '',
    color: '',
    match: 'all',
    conditions: [],
  };
}

export function createSortSegmentId(): string {
  return `sort-segment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createSortBucketId(): string {
  return `bucket-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createSortCriteriaId(): string {
  return `criteria-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createDefaultSortCriteria(): SortCriteria {
  return {
    source: 'frontmatter',
    field: 'priority',
    type: 'priority',
    direction: 'asc',
    mappings: [],
    missingValuePlacement: 'last',
  };
}

export function createDefaultSortBucket(): SortBucket {
  return {
    id: createSortBucketId(),
    enabled: true,
    name: 'New Bucket',
    match: 'all',
    conditions: [],
    sortCriteria: [],
  };
}

export function createDefaultSortSegment(): SortSegmentRule {
  return {
    id: createSortSegmentId(),
    enabled: true,
    source: 'frontmatter',
    field: 'priority',
    fallback: '',
    mappings: [],
    match: 'all',
    conditions: [],
  };
}

export function createDefaultHideRule(): HideRule {
  return {
    id: `hide-rule-${Date.now()}`,
    name: 'New Hide Rule',
    enabled: true,
    match: 'all',
    conditions: [],
    mode: 'add',
    tagName: 'hide',
  };
}

export function createConditionGroupId(): string {
  return `group-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createDefaultConditionGroup(): ConditionGroup {
  return {
    id: createConditionGroupId(),
    match: 'all',
    conditions: [],
  };
}

export interface TPSGlobalContextMenuSettings {
  enableLogging: boolean;
  logOpenerDecisions: boolean;
  enableInlinePersistentMenus: boolean;
  enableInLivePreview: boolean;
  enableInPreview: boolean;
  enableInSidePanels: boolean;
  inlineMenuOnly: boolean;
  nativeMenuPlacement: 'tps-first' | 'tps-last';
  suppressMobileKeyboard: boolean;
  enableCanvasOpenGuard: boolean;
  enableBasesForcedLinkPreview: boolean;
  collapseHeadingsOnOpen: boolean;
  homeComponents: HomeComponentId[];
  homeComponentLayouts: Record<string, HomeComponentLayout>;
  homeComponentActions: HomeComponentActionMap;
  homeCalendarBasePath: string;
  homeFoodBasePath: string;
  homeWorkoutBasePath: string;
  homeOpenTasksBasePath: string;
  homeCaptureInsertPosition: HomeCaptureInsertPosition;
  hideCompletedCheckboxes: boolean;
  hideAllTaskLinesInReadingMode: boolean;
  taskHidingExclusionPatterns: string;
  persistTaskVisibilityStateToFrontmatter: boolean;
  taskVisibilityStateFrontmatterKey: string;
  properties: CustomProperty[];
  showCustomPropertiesInInlineUi: boolean;
  showCustomPropertiesUnderTitle: boolean;
  defaultStackedPropertiesClosed: boolean;
  enableVirtualBaseEmbeds: boolean;
  virtualBaseEmbedProperties: VirtualBaseEmbedProperty[];
  showCustomPropertiesInContextMenu: boolean;
  inheritNotebookNavigatorTagColors: boolean;
  notebookNavigatorRules: NotebookNavigatorRuleSettings;

  // Time tracking
  enableTimeTracking: boolean;
  timeTrackingPropertyKey: string;
  timeTrackingStorageMode: TimeTrackingStorageMode;
  timeTrackingDedicatedNotePath: string;
  timeTrackingSingleActiveSession: boolean;
  timeTrackingIgnoreArchivedFiles: boolean;
  timeTrackingPausedSession?: TimeTrackingPausedSessionState | null;

  // Recurrence settings
  enableRecurrence: boolean;
  promptOnRecurrenceEdit: boolean;
  recurrencePromptTimeout: number; // Minutes
  activeStatusValues: string[];
  recurrenceCompletionStatuses: string[];
  recurrenceDefaultStatus: string; // Default status for new recurrence instances
  recurringTemplateFolder: string; // Folder to store recurring event templates

  // File naming settings

  enableAutoRename: boolean;
  autoSyncTitleFromFilename: boolean;
  autoSaveFolderPath: boolean;
  autoSyncFileTimestamps: boolean;
  dateCreatedFrontmatterKey: string;
  dateModifiedFrontmatterKey: string;
  fileTimestampFormat: string;
  applyNotebookNavigatorRulesOnSubitemCreate: boolean;
  frontmatterAutoWriteExclusions: string;
  enableActivityLog: boolean;
  activityLogPropertyKey: string;
  activityLogTrackedProperties: string;
  activityLogMaxEntries: number;
  folderExclusions: string;
  checkOpenChecklistItems: boolean;
  checkParentLinkStatuses: boolean;
  parentLinkFrontmatterKey: string;
  /** @deprecated Parent-side reverse links are no longer canonical. */
  childLinkFrontmatterKey?: string;
  autoSelfLinkParentInParentKey: boolean;
  parentLinkFormat: ParentLinkFormat;
  parentTagOnChildLink: string;
  parentCompletionStatuses: string[];
  ignoredBacklinksFrontmatterKeys: string[];
  ignoredSubitemTags: string[];

  // View Mode Settings
  enableViewModeSwitching: boolean;
  enableInlineManualViewMode: boolean;
  viewModeFrontmatterKey: string;
  viewModeIgnoredFolders: string;
  viewModeRules: ViewModeRule[];

  enableChecklistCompletionProperty: boolean;
  checklistCompletionPropertyKey: string;
  checklistFinalPromptStatuses: string[];
  reconcileTaskStatusToCheckbox: boolean;
  enableLinkedSubitemCheckboxes: boolean;
  linkedSubitemCheckboxStyle: LinkedSubitemCheckboxStyle;
  linkedSubitemCheckboxMappings: LinkedSubitemCheckboxMapping[];
  linkedSubitemDefaultOpenState: string;
  /** @deprecated migrated into linkedSubitemCheckboxMappings */
  linkedSubitemUncheckedStatuses?: string[];
  /** @deprecated migrated into linkedSubitemCheckboxMappings */
  linkedSubitemCheckedStatuses?: string[];
  /** @deprecated migrated into linkedSubitemCheckboxMappings */
  linkedSubitemCanceledStatuses?: string[];
  /** @deprecated migrated into linkedSubitemCheckboxMappings */
  linkedSubitemToggleCheckedStatus?: string;
  /** @deprecated migrated into linkedSubitemCheckboxMappings */
  linkedSubitemToggleUncheckedStatus?: string;

  // Archive tag automation
  enableArchiveTagMove: boolean;
  archiveTag: string;
  archiveFolderPath: string;
  archiveUseDailyFolder: boolean;
  lastArchiveTagSweepDate?: string;

  // Workspace Ribbon Buttons
  workspaceRibbonButtons: boolean;
  workspaceRibbonIcons: Record<string, string>;

  // Daily Note Navigation
  enableDailyNoteNav: boolean;
  enableTopParentNav: boolean;
  topParentNavPlacement: 'top' | 'bottom';
  ignoreEmbeddedChildrenInTopLinks: boolean;
  dailyNavShowToday: boolean;
  enableAutoPopulateDailyNotes: boolean;
  inheritUnscheduledTasksFromDailyNotes: boolean;

  // Overlay ignore rules
  subitems_IgnoreRules: ViewModeRule[];
  inlineMenu_IgnoreRules: ViewModeRule[];

  // Auto-embed ignore settings
  autoEmbedIgnoreFolders: string[];
  autoEmbedIgnoreTags: string[];

  // Auto-insert blank line on note open
  enableAutoInsertBlankLineOnOpen: boolean;

  // Default paths for new items
  defaultAttachmentsPath: string;
  checklistPromotionBehavior: ChecklistPromotionBehavior;
  tpsBaseWriteFallbackMode: TpsBaseWriteFallbackMode;
  tpsBaseWriteFallbackPath: string;

  // Appearance (Navigator-style controls)
  menuTextScale: number;
  buttonScale: number;
  controlScale: number;
  menuDensity: number;
  menuRadiusScale: number;
  inlinePanelMaxWidth: number;
  liveMenuPosition: GcmLiveMenuPosition;
  liveMenuOffsetX: number;
  liveMenuOffsetY: number;
  modalWidth: number;
  modalMaxHeightVh: number;
  subitemsMarginBottom: number;
  dailyNavScale: number;
  dailyNavRestOpacity: number;
  appearanceSyncModes: Partial<Record<AppearanceSettingKey, AppearanceSyncMode>>;
}

/**
 * Frontmatter data structure for TPS notes
 */
export interface FrontmatterData {
  status?: string;
  priority?: string;
  prio?: string;
  title?: string;
  scheduled?: string;
  sheduledEnd?: string;
  timeEstimate?: number;
  tags?: string | string[];
  recurrenceRule?: string;
  recurrence?: string;
  [key: string]: any;
}

/**
 * File entry with associated frontmatter
 */
export interface FileEntry {
  file: TFile;
  frontmatter: FrontmatterData;
}

/**
 * Context event data for reopening native menus
 */
export interface ContextEventData {
  target: HTMLElement;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  button: number;
}

/**
 * Options for showing menu
 */
export interface ShowMenuOptions {
  files: TFile[];
  event: MouseEvent;
  sourceEl: HTMLElement;
}

/**
 * Options for building special panel
 */
export interface BuildPanelOptions {
  recurrenceRoot?: HTMLElement | null;
  closeAfterRecurrence?: boolean;
}

export type HomeBuiltInComponentId = 'quick-capture' | 'calendar' | 'food-tracker' | 'workout-tracker' | 'open-unscheduled-tasks';
export type HomeBaseComponent = { type: 'base'; path: string };
export type HomeCommandComponent = { type: 'command'; commandId: string; title?: string; icon?: string };
export type HomeComponentId = HomeBuiltInComponentId | HomeBaseComponent | HomeCommandComponent;
export interface HomeComponentLayout {
  height?: number;
  span?: 1 | 2;
  capturePreviewHeight?: number;
}
export type HomeComponentActionTarget = 'home-note' | 'workspace';
export interface HomeComponentAction {
  id: string;
  commandId: string;
  label?: string;
  icon?: string;
  target: HomeComponentActionTarget;
}
export type HomeComponentActionMap = Record<string, HomeComponentAction[]>;
export interface HomeActionContext {
  source: 'tps-home';
  dateIso: string;
  dailyNotePath: string;
  componentId: string;
  basePath?: string;
}
export interface HomeActionProvider {
  version?: number;
  canHandle(commandId: string): boolean;
  execute(commandId: string, context: HomeActionContext): void | boolean | Promise<void | boolean>;
}
export type HomeCaptureInsertPosition = 'top' | 'bottom';

/**
 * Recurrence rule button option
 */
export interface RecurrenceOption {
  label: string;
  value: string;
}

/**
 * Parsed recurrence rule structure
 */
export interface ParsedRecurrence {
  freq: string | null;
  interval: number;
  byDay: string[];
}

/**
 * Menu instances for a markdown view
 */
export interface MenuInstances {
  reading?: HTMLElement | null;
  live?: HTMLElement | null;
  filePath?: string;
}

/**
 * Date row creation result
 */
export interface DateRowResult {
  row: HTMLElement;
  input: HTMLInputElement;
}

/**
 * End row creation result
 */
export interface EndRowResult {
  row: HTMLElement;
  input: HTMLInputElement;
  refresh: () => void;
}
