import { DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS, TPSGlobalContextMenuSettings } from './types';
import { MIGRATED_TASK_STATUS } from './constants/task-migration';
import { DEFAULT_LINKED_SUBITEM_MAPPINGS } from './utils/linked-subitem-mapping';
import { DEFAULT_DAILY_NAV_DAY_COUNT } from './utils/daily-note-nav-days';
import { DEFAULT_CHECKBOX_MENU_STATES } from './utils/native-checkbox-marker';

export const DEFAULT_SETTINGS: TPSGlobalContextMenuSettings = {
  dataArchitectureMode: 'native-records',
  nativeRecordRootPath: '_records',
  nativeRecordLayout: 'kind-folders',
  nativeRecordIdentityMode: 'property',
  nativeRecordIdentityPropertyKey: 'id',
  nativeRecordSchemaPropertyKey: '',
  nativeRecordIdentityTagPrefix: 'tps/record',
  nativeRecordKindPropertyKey: 'kind',
  nativeRecordKindPropertyKeys: {},
  nativeBaseCreateRoutes: [],
  nativeRecordTitlePropertyKey: 'title',
  nativeRecordCreatedPropertyKey: '',
  nativeRecordModifiedPropertyKey: '',
  nativeRecordStorageAliases: [],
  templateIdentificationMode: 'tag',
  templateIdentificationTag: 'template',
  templateIdentificationPropertyKey: 'tpsTemplate',
  templateIdentificationPropertyValue: 'true',
  templateIdentificationPropertyMatch: 'equals',
  enableLogging: false,
  logOpenerDecisions: false,
  enableInlinePersistentMenus: false,
  inlineMenuOnly: false,
  suppressMobileKeyboard: true,
  enableCanvasOpenGuard: false,
  notePostCreateBehavior: 'preview',
  noteOpenDestination: 'current-tab',
  enableBasesForcedLinkPreview: false,
  collapseHeadingsOnOpen: false,
  hideCompletedCheckboxes: false,
  completedTaskHidingScope: 'reading-and-live-preview',
  hideAllTaskLinesInReadingMode: false,
  taskHidingExclusionPatterns: '',
  persistTaskVisibilityStateToFrontmatter: false,
  taskVisibilityStateFrontmatterKey: 'gcmTaskVisibility',
  properties: [
    { id: 'kind', label: 'Kind', key: 'kind', type: 'list', listItemType: 'text', optionsSource: 'vault', icon: 'shapes', showInCollapsed: true, allowInlineSet: false },
    { id: 'status', label: 'Status', key: 'status', type: 'selector', options: ['todo', 'working', 'holding', 'wont-do', 'complete', MIGRATED_TASK_STATUS], icon: 'circle-check', showInCollapsed: true, allowInlineSet: true, scopeKinds: ['task'] },
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
  activeStatusValues: ['todo', 'working', 'holding'],
  recurrenceCompletionStatuses: ['complete', 'wont-do'],
  recurrenceDefaultStatus: 'todo', // Default status for new recurrence instances

  // File naming settings
  autoSyncFileTimestamps: false,
  dateCreatedFrontmatterKey: 'datecreated',
  dateModifiedFrontmatterKey: 'datemodified',
  fileTimestampFormat: 'YYYY-MM-DD HH:mm:ss',
  frontmatterAutoWriteExclusions: "",
  enableActivityLog: false,
  activityLogPropertyKey: 'activity',
  activityLogTrackedProperties: 'status, priority, tags, scheduled, due, start, end, completedDate',
  activityLogMaxEntries: 200,
  folderExclusions: "",
  checkOpenChecklistItems: true,
  checkboxMenuStates: [...DEFAULT_CHECKBOX_MENU_STATES],
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
  enableInlineManualViewMode: true,
  enableLinkedSubitemCheckboxes: false,
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
  archiveTag: 'archive',
  archiveFolderPath: 'System/Archive',
  lastArchiveTagSweepDate: '',

  workspaceRibbonButtons: false,
  workspaceRibbonIcons: {},
  enableDailyNoteNav: true,
  dailyNavDayCount: DEFAULT_DAILY_NAV_DAY_COUNT,
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
  inheritUnscheduledTasksFromDailyNotes: true,

  // Overlay ignore rules
  ignoredBacklinksFrontmatterKeys: ['dateModified'],
  ignoredSubitemTags: ['hide', 'dailynote', 'project'],
  subitems_IgnoreRules: [],
  inlineMenu_IgnoreRules: [],

  // Auto-embed ignore settings

  // Auto-insert blank line on note open

  // Default paths for new items
  defaultAttachmentsPath: '',
  checklistPromotionBehavior: 'remove',
  dailyNoteTaskMoveSourceBehavior: 'mark-migrated',
  enableItemHistory: false,
  itemHistoryRetentionDays: 90,
  itemHistoryMaxEntries: 25000,
  createTaskDefaultParentMode: 'standalone',
  tpsBaseWriteFallbackMode: 'today-daily-note',
  tpsBaseWriteFallbackPath: '',

  liveMenuPosition: 'center',
  liveMenuOffsetX: 0,
  liveMenuOffsetY: 0,
  dailyNavRestOpacity: 0,
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
