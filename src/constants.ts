import { DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS, TPSGlobalContextMenuSettings } from './types';
import { MIGRATED_TASK_STATUS } from './constants/task-migration';
import { DEFAULT_LINKED_SUBITEM_MAPPINGS } from './utils/linked-subitem-mapping';

export const HOME_DAILY_NOTE_FEED_BASE_PATH = 'Daily Note Feed.base';
export const HOME_DAILY_NOTE_FEED_BASE_CONTENT = `model:
  version: 1
  kind: Table
  columns: []
pluginVersion: 1.0.0
filters:
  and:
    - file.path == this.file.path
    - task.path == this.file.path
views:
  - type: tps-list
    name: Daily note
    createAction: default
    filters:
      or:
        - kind == "task"
        - kind == "bullet"
    order:
      - title
`;

export const DEFAULT_SETTINGS: TPSGlobalContextMenuSettings = {
  dataArchitectureMode: 'legacy',
  nativeRecordRootPath: '_records',
  nativeRecordLayout: 'kind-folders',
  enableLogging: false,
  logOpenerDecisions: false,
  enableInlinePersistentMenus: false,
  enableInLivePreview: false,
  enableInPreview: false,
  enableInSidePanels: false,
  inlineMenuOnly: false,
  nativeMenuPlacement: 'tps-last',
  suppressMobileKeyboard: true,
  enableCanvasOpenGuard: false,
  enableBasesForcedLinkPreview: false,
  collapseHeadingsOnOpen: false,
  enableDailyNoteHome: true,
  homeComponents: [
    { type: 'base', path: HOME_DAILY_NOTE_FEED_BASE_PATH },
    'calendar',
    'open-unscheduled-tasks',
  ],
  homeComponentLayouts: {},
  homeComponentActions: {
    'base:daily note feed.base': [
      {
        id: 'capture',
        commandId: 'tps-global-context-menu:capture-to-home-note',
        label: 'Capture',
        icon: 'send',
        target: 'home-note',
      },
    ],
  },
  homeCalendarBasePath: 'home-schedule.base',
  homeFoodBasePath: 'Food Log.base',
  homeWorkoutBasePath: 'Activity Log.base',
  homeOpenTasksBasePath: 'Open Unscheduled Tasks.base',
  homeCaptureInsertPosition: 'bottom',
  hideCompletedCheckboxes: false,
  completedTaskHidingScope: 'reading-and-live-preview',
  hideAllTaskLinesInReadingMode: false,
  taskHidingExclusionPatterns: '',
  persistTaskVisibilityStateToFrontmatter: false,
  taskVisibilityStateFrontmatterKey: 'gcmTaskVisibility',
  properties: [
    { id: 'kind', label: 'Kind', key: 'kind', type: 'kind', optionsSource: 'vault', icon: 'shapes', showInCollapsed: true, allowInlineSet: false },
    { id: 'status', label: 'Status', key: 'status', type: 'selector', options: ['todo', 'working', 'holding', 'wont-do', 'complete', MIGRATED_TASK_STATUS], icon: 'circle-check', showInCollapsed: true, allowInlineSet: true, scopeKinds: ['task'] },
    { id: 'priority', label: 'Priority', key: 'priority', type: 'selector', options: ['high', 'medium', 'normal', 'low'], icon: 'flag', showInCollapsed: true, allowInlineSet: true, scopeKinds: ['task'] },
    { id: 'tags', label: 'Tags', key: 'tags', type: 'list', listItemType: 'tag', icon: 'tag', showInCollapsed: true, allowInlineSet: true },
    { id: 'recurrence', label: 'Recurrence', key: 'recurrenceRule', type: 'recurrence', icon: 'repeat', showInCollapsed: true, allowInlineSet: true, scopeKinds: ['task'] },
    { id: 'scheduled', label: 'Scheduled', key: 'scheduled', type: 'datetime', icon: 'calendar', showInCollapsed: true, allowInlineSet: true, scopeKinds: ['task'] },
    { id: 'type', label: 'Folder', key: 'folderPath', type: 'folder', icon: 'folder', showInCollapsed: false, allowInlineSet: false },
  ],
  showCustomPropertiesInInlineUi: false,
  showCustomPropertiesUnderTitle: false,
  defaultStackedPropertiesClosed: false,
  enableVirtualBaseEmbeds: true,
  virtualBaseEmbedProperties: [
    { key: 'gcmBaseTop', placement: 'top' },
    { key: 'gcmBaseBottom', placement: 'bottom' },
    { key: 'gcmBaseHover', placement: 'hover' },
  ],
  showCustomPropertiesInContextMenu: false,
  inheritNotebookNavigatorTagColors: false,
  notebookNavigatorRules: DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS,

  // Time tracking
  enableTimeTracking: false,
  timeTrackingPropertyKey: 'timeTracking',
  timeTrackingStorageMode: 'daily-note',
  timeTrackingDedicatedNotePath: 'Time Tracking.md',
  timeTrackingDailyNoteHeading: 'Time Tracking',
  timeTrackingDailyNotePlacement: 'top',
  timeTrackingSingleActiveSession: true,
  timeTrackingIgnoreArchivedFiles: true,
  timeTrackingPausedSession: null,

  // Recurrence settings
  enableRecurrence: true,
  promptOnRecurrenceEdit: true,
  recurrencePromptTimeout: 30, // 30 minutes (syncs across devices)
  activeStatusValues: ['todo', 'working', 'holding'],
  recurrenceCompletionStatuses: ['complete', 'wont-do'],
  recurrenceDefaultStatus: 'todo', // Default status for new recurrence instances
  recurringTemplateFolder: 'Recurring Templates', // Folder to store recurring event templates

  // File naming settings
  enableAutoRename: true,
  autoSyncTitleFromFilename: true,
  autoSaveFolderPath: false,
  autoSyncFileTimestamps: false,
  dateCreatedFrontmatterKey: 'datecreated',
  dateModifiedFrontmatterKey: 'datemodified',
  fileTimestampFormat: 'YYYY-MM-DD HH:mm:ss',
  applyNotebookNavigatorRulesOnSubitemCreate: false,
  frontmatterAutoWriteExclusions: "",
  enableActivityLog: false,
  activityLogPropertyKey: 'activity',
  activityLogTrackedProperties: 'status, priority, tags, scheduled, due, start, end, completedDate',
  activityLogMaxEntries: 200,
  folderExclusions: "",
  checkOpenChecklistItems: true,
  checkParentLinkStatuses: false,
  parentLinkFrontmatterKey: 'parent',
  enableParentChildIgnoreRule: false,
  parentChildIgnoreFrontmatterKey: '',
  parentChildIgnoreFrontmatterValue: '',
  childLinkFrontmatterKey: 'parentOf',
  autoSelfLinkParentInParentKey: false,
  parentLinkFormat: 'wikilink',
  parentTagOnChildLink: 'project',
  parentCompletionStatuses: ['complete', 'wont-do'],
  enableViewModeSwitching: true,
  enableInlineManualViewMode: true,
  viewModeFrontmatterKey: 'viewmode',
  viewModeIgnoredFolders: '',
  viewModeRules: [],
  enableChecklistCompletionProperty: false,
  checklistCompletionPropertyKey: 'hasOpenChecklist',
  checklistFinalPromptStatuses: ['complete', 'wont-do'],
  reconcileTaskStatusToCheckbox: true,
  enableLinkedSubitemCheckboxes: true,
  linkedSubitemCheckboxStyle: 'soft-link',
  linkedSubitemCheckboxMappings: DEFAULT_LINKED_SUBITEM_MAPPINGS.map((mapping) => ({
    ...mapping,
    statuses: [...mapping.statuses],
  })),
  linkedSubitemDefaultOpenState: '[ ]',
  linkedSubitemUncheckedStatuses: ['todo'],
  linkedSubitemCheckedStatuses: ['complete'],
  linkedSubitemCanceledStatuses: ['wont-do'],
  linkedSubitemToggleCheckedStatus: 'complete',
  linkedSubitemToggleUncheckedStatus: 'todo',
  enableArchiveTagMove: false,
  archiveTag: 'archive',
  archiveFolderPath: 'System/Archive',
  archiveUseDailyFolder: false,
  lastArchiveTagSweepDate: '',

  workspaceRibbonButtons: false,
  workspaceRibbonIcons: {},
  enableDailyNoteNav: true,
  enableTopParentNav: true,
  topParentNavPlacement: 'top',
  showCalendarNavButton: true,
  showTasksNavButton: true,
  showMentionsNavButton: true,
  ignoreEmbeddedChildrenInTopLinks: true,
  enableLinkedContextPanel: false,
  linkedContextPlacement: 'bottom',
  linkedContextOpenBehavior: 'same-tab',
  linkedContextSortOrder: 'source-asc',
  dailyNavShowToday: true,
  enableAutoPopulateDailyNotes: true,
  inheritUnscheduledTasksFromDailyNotes: true,

  // Overlay ignore rules
  ignoredBacklinksFrontmatterKeys: ['dateModified'],
  ignoredSubitemTags: ['hide', 'dailynote', 'project'],
  subitems_IgnoreRules: [],
  inlineMenu_IgnoreRules: [],

  // Auto-embed ignore settings
  autoEmbedIgnoreFolders: ['Archive'],
  autoEmbedIgnoreTags: ['archive'],

  // Auto-insert blank line on note open
  enableAutoInsertBlankLineOnOpen: true,

  // Default paths for new items
  defaultAttachmentsPath: '',
  checklistPromotionBehavior: 'remove',
  dailyNoteTaskMoveSourceBehavior: 'mark-migrated',
  enableItemHistory: true,
  itemHistoryRetentionDays: 90,
  itemHistoryMaxEntries: 25000,
  tpsBaseWriteFallbackMode: 'today-daily-note',
  tpsBaseWriteFallbackPath: '',

  menuTextScale: 1,
  buttonScale: 1,
  controlScale: 1,
  menuDensity: 1,
  menuRadiusScale: 1,
  inlinePanelMaxWidth: 700,
  liveMenuPosition: 'center',
  liveMenuOffsetX: 0,
  liveMenuOffsetY: 0,
  modalWidth: 520,
  modalMaxHeightVh: 80,
  subitemsMarginBottom: 0,
  dailyNavScale: 1,
  dailyNavRestOpacity: 0,
  appearanceSyncModes: {},
};

export const SYSTEM_COMMANDS = [
  { id: 'open-in-new-tab', label: 'Open in New Tab', icon: 'plus-square' },
  { id: 'open-in-same-tab', label: 'Open in Same Tab', icon: 'file' },
  { id: 'duplicate', label: 'Duplicate File', icon: 'copy' },
  { id: 'get-relative-path', label: 'Copy Relative Path', icon: 'link' },
] as const;

export const STATUSES = ['todo', 'working', 'holding', 'wont-do', 'complete', MIGRATED_TASK_STATUS] as const;

/**
 * Available priority levels
 */
export const PRIORITIES = ['high', 'medium', 'normal', 'low'] as const;

/**
 * Recurrence rule quick options
 */
export const TRACKER_RECURRENCE_RULE = 'GCM-TRACKER';

export const RECURRENCE_OPTIONS = [
  { label: 'Tracker (no date)', value: TRACKER_RECURRENCE_RULE },
  { label: 'Daily', value: 'RRULE:FREQ=DAILY' },
  { label: 'Weekdays', value: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Weekly', value: 'RRULE:FREQ=WEEKLY' },
  { label: 'Monthly', value: 'RRULE:FREQ=MONTHLY' },
  { label: 'Yearly', value: 'RRULE:FREQ=YEARLY' },
  { label: "Mother's Day", value: 'RRULE:FREQ=YEARLY;BYMONTH=5;BYDAY=2SU' },
  { label: 'Easter', value: 'GCM-HOLIDAY:EASTER' },
  { label: 'After completion: 6 hours', value: 'GCM-AFTER-COMPLETION:PT6H' },
  { label: 'After completion: 1 day', value: 'GCM-AFTER-COMPLETION:P1D' },
  { label: 'After completion: 1 week', value: 'GCM-AFTER-COMPLETION:P1W' },
] as const;
