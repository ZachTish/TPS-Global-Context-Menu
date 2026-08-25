import { BasesView, Plugin, QueryController, TFile, WorkspaceLeaf, Menu, Notice, normalizePath, Platform, type BasesViewConfig, type ViewOption } from 'obsidian';
import {
  BuildPanelOptions,
  HideRule,
  IconColorRule,
  TPSGlobalContextMenuSettings,
  createDefaultHideRule,
  createDefaultRule,
  createDefaultSortBucket,
  createDefaultSortSegment,
} from './types';
import { DEFAULT_SETTINGS, HOME_DAILY_NOTE_FEED_BASE_PATH } from './constants';
import { PLUGIN_STYLES } from './plugin-styles';
import { MenuController } from './menu/menu-controller';
import { PersistentMenuManager } from './menu/persistent-menu-manager';
import { setupMenuPatch } from './menu/menu-patcher';
import { removeLegacyNotebookNavigatorRuleSettingsStyle, TPSGlobalContextMenuSettingTab } from './settings-tab';
import { BulkEditService } from './services/bulk-edit-service';
import { RecurrenceService } from './services/recurrence-service';
import { FileNamingService } from './services/file-naming-service';
import { AutoFrontmatterExclusionService } from './services/file-exclusion-service';
import { ViewModeManager } from './handlers/view-mode-manager';
import { DailyNoteHomeService } from './services/daily-note-home-service';
import { DailyNoteNavManager } from './handlers/daily-note-nav-manager';
import { TaskCheckboxHandler } from './handlers/task-checkbox-handler';
import { ContextTargetService } from './services/context-target-service';
import { NoteOperationService } from './services/note-operation-service';
import { FieldInitializationService } from './services/field-initialization-service';
import { installDateContainsPolyfill } from './compat';
import * as logger from './logger';
import { CommandQueueService, getErrorMessage, getPluginById } from './core';
import { VaultQueryService } from './services/vault-query-service';
import { EntityIndexService } from './services/entity-index-service';
import { TaskIdentityService } from './services/task-identity-service';
import { WorkspaceRibbonService } from './services/workspace-ribbon-service';
import { LinkedSubitemCheckboxService } from './services/linked-subitem-checkbox-service';
import { FrontmatterMutationService } from './services/frontmatter-mutation-service';
import { ParentLinkResolutionService } from './services/parent-link-resolution-service';
import { BodySubitemLinkService } from './services/body-subitem-link-service';
import { SubitemRelationshipSyncService } from './services/subitem-relationship-sync-service';
import { SubitemReferenceIndexService } from './services/subitem-reference-index-service';
import { TimeTrackingService } from './services/time-tracking-service';
import { TimeTrackingStatusBarService } from './services/time-tracking-status-bar-service';
import { NotebookNavigatorRuleService } from './services/notebook-navigator-rule-service';
import { OverlayRenderingService } from './services/overlay-rendering-service';
import { HideCompletedCheckboxesService } from './services/hide-completed-checkboxes-service';
import { InlinePropertyDecorationService } from './services/inline-property-decoration-service';
import { InlinePropertySuggest } from './services/inline-property-suggest';
import { HeadingLinkSuggest } from './services/heading-link-suggest';
import { TaskStatusCheckboxReconcileService } from './services/task-status-checkbox-reconcile-service';
import { TaskLineContextMenuService } from './services/task-line-context-menu-service';
import { DailyInboxLineService } from './services/daily-inbox-line-service';
import { TaskLineDragService } from './services/task-line-drag-service';
import { CreateTaskService } from './services/create-task-service';
import { AiAssistedTaskService } from './services/ai-assisted-task-service';
import { TaskRecurrenceService } from './services/task-recurrence-service';
import { TaskApiService } from './services/task-api-service';
import { GcmEventService } from './services/gcm-event-service';
import { TpsIdentityService } from './services/tps-identity-service';
import { CardContentService } from './services/card-content-service';
import { IdentityMigrationService } from './services/identity-migration-service';
import { FilePropertiesService } from './services/file-properties-service';
import { NativeRecordService, normalizeNativeRecordLayout, normalizeNativeRecordRoot } from './services/native-record-service';
import { TemplateIdentityService } from './services/template-identity-service';
import { NoteTitleRenderService } from './services/note-title-render-service';
import { VirtualBaseEmbedService } from './services/virtual-base-embed-service';
import { HeadingCollapseOnOpenService } from './services/heading-collapse-on-open-service';
import { FoldExpansionContextMenuService } from './services/fold-expansion-context-menu-service';
import { HomeCaptureService } from './services/home-capture-service';
import { BaseLineEditProtocolService } from './services/base-line-edit-protocol-service';
import {
  HOME_ADD_TASK_COMMAND_ID,
  HOME_CAPTURE_COMMAND_ID,
  HomeComponentActionService,
} from './services/home-component-action-service';
import { normalizeHomeComponentActions } from './services/home-component-action-core';
import { TPS_HOME_VIEW_TYPE, TpsHomeView } from './views/home-view';
import { TPS_TABLE_VIEW_TYPE, TpsTableView } from './views/log-base-view';
import { TPS_LIST_VIEW_TYPE, createTpsListView, createTpsListViewOptions } from './views/tps-list-bridge-view';
import { BaseRowIndexService } from './services/base-row-index-service';
import {
  getTpsBaseNativeCreateEventTarget,
  isTpsBaseNativeCreateTarget,
} from './views/native-base-create-owner';
import { sanitizeNotebookNavigatorRuleSettings } from './services/notebook-navigator-rule-settings';
import { registerGcmEvents } from './events/register-events';
import { registerGcmCommands } from './commands/register-commands';
import { setupPluginApi } from './plugin-api';
import { TPS_EVENTS } from './tps-contracts';
import { createSharedServices, type GcmSharedServices } from './services/shared';
import { ViewModeService } from './services/view-mode-service';
import { resolveCustomProperties } from './resolve-profiles';
import { normalizeParentLinkFormat } from './handlers/parent-link-format';
import { installVisibleViewportContract } from './utils/mobile-overlay';
import {
  normalizeLinkedSubitemCheckboxState,
  normalizeLinkedSubitemMappings,
} from './utils/linked-subitem-mapping';
import {
  reconcilePersistedSettingsInPlace,
  SettingsPersistenceCoordinator,
  type SettingsRecord,
} from './settings-persistence';
import {
  normalizeTpsBaseWriteFallbackMode,
  normalizeTpsBaseWriteNotePath,
  resolveTpsBaseWriteTarget,
  type ResolveTpsBaseWriteTargetOptions,
  type TpsBaseWriteTargetResolution,
} from './services/tps-base-write-target-service';
import { normalizePropertyOptionSources } from './utils/property-option-source';
import { normalizeAcceptedKindSetting } from './utils/property-option-setting';
import {
  collectPropertyKeyDiagnostics,
  normalizePropertyKeyIdentity,
} from './utils/property-key-identity';
import { ArchiveFileService } from './services/archive-file-service';
import { TpsNotebookNavigatorMenuBridge } from './services/tps-notebook-navigator-menu-bridge';
import { shouldReuseCustomPropertyPreviewPanel } from './services/custom-property-visibility';
import { ItemHistoryService } from './services/item-history-service';
import { createLivePreviewBodySelectionExtension } from './services/live-preview-body-selection-service';

const NATIVE_PROPERTIES_ALWAYS_HIDDEN = new Set(['allday', 'color', 'folderpath', 'icon', 'sort']);
const DEFAULT_INLINE_PROPERTY_DENY_KEYS = new Set(['title', 'parent', 'parentof', 'folderpath']);
const AUTHORITATIVE_HOME_SETTING_KEYS: readonly (keyof TPSGlobalContextMenuSettings)[] = [
  'enableDailyNoteHome',
  'homeCalendarBasePath',
  'homeFoodBasePath',
  'homeWorkoutBasePath',
  'homeOpenTasksBasePath',
];
const CUSTOM_PROPERTY_TYPES = new Set([
  'text',
  'number',
  'datetime',
  'selector',
  'list',
  'checkbox',
  'recurrence',
  'folder',
  'snooze',
  'kind',
]);
const LEGACY_HEALTH_CUSTOM_PROPERTY_IDS = new Set([
  'nutrition-food',
  'nutrition-qty',
  'nutrition-unit',
  'nutrition-servings',
  'nutrition-amount',
  'nutrition-amount-unit',
  'nutrition-cal',
  'nutrition-protein',
  'nutrition-carbs',
  'nutrition-fat',
  'nutrition-fiber',
  'nutrition-sugar',
  'nutrition-alcohol',
  'nutrition-sodium',
  'workout-exercise',
  'workout-exercise-path',
  'workout-workout',
  'workout-workout-path',
  'workout-plan',
  'workout-plan-path',
  'workout-set-id',
  'workout-set-type',
  'workout-reps',
  'workout-weight',
  'workout-weight-unit',
  'workout-duration',
  'workout-distance',
  'workout-distance-unit',
  'workout-rpe',
  'workout-rest',
  'workout-drop-set',
  'workout-superset',
]);

function normalizeTpsTableKey(key: string): string {
  return String(key || '').replace(/^note\./, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function getCommandOptionValues(plugin: TPSGlobalContextMenuPlugin): Record<string, string> {
  const commands = (plugin.app as any)?.commands?.commands;
  const options: Record<string, string> = {};
  const entries = Object.values(commands || {})
    .map((command: any) => ({
      id: String(command?.id || '').trim(),
      name: String(command?.name || command?.id || '').trim(),
    }))
    .filter((command) => command.id && command.name)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  for (const command of entries) {
    options[command.id] = `${command.name} (${command.id})`;
  }
  return options;
}

function createTpsTableViewOptions(plugin: TPSGlobalContextMenuPlugin): ViewOption[] {
  return [
    {
      type: 'group',
      displayName: 'Table records',
      items: [
        {
          key: 'groupBy',
          type: 'property',
          displayName: 'Group by',
          default: '',
          placeholder: 'No grouping',
        },
        {
          key: 'groupDirection',
          type: 'dropdown',
          displayName: 'Group order',
          default: 'asc',
          options: {
            asc: 'Ascending',
            desc: 'Descending',
          },
          shouldHide: (config) => !String(config.get('groupBy') || '').trim(),
        },
        {
          key: 'lineFilterKey',
          type: 'text',
          displayName: 'Required inline field',
          default: 'food',
          placeholder: 'food',
        },
        {
          key: 'totalsRow',
          type: 'dropdown',
          displayName: 'Totals row',
          default: 'off',
          options: {
            off: 'Off',
            top: 'Top',
            bottom: 'Bottom',
          },
        },
        {
          key: 'ungroupedPosition',
          type: 'dropdown',
          displayName: 'Items without a group',
          default: 'last',
          options: {
            first: 'Top',
            last: 'Bottom',
          },
        },
        {
          key: 'multiValueGrouping',
          type: 'dropdown',
          displayName: 'Items with multiple values',
          default: 'separate',
          options: {
            separate: 'Show in every matching group',
            combined: 'Show in one combined group',
          },
        },
      ],
    },
    createBaseCreateButtonOptions(plugin),
  ];
}

function createBaseCreateButtonOptions(plugin: TPSGlobalContextMenuPlugin): ViewOption {
  return {
    type: 'group',
    displayName: 'Create button',
    items: [
      {
        key: 'createAction',
        type: 'dropdown',
        displayName: 'Action',
        default: 'default',
        options: {
          default: 'Default',
          command: 'Run command',
        },
      },
      {
        key: 'createCommandId',
        type: 'dropdown',
        displayName: 'Command',
        default: '',
        options: getCommandOptionValues(plugin),
        shouldHide: (config: BasesViewConfig) => String(config.get('createAction') || '').trim() !== 'command',
      },
    ],
  };
}

export interface GcmExternalActionContext {
  file: TFile;
  placement: 'top' | 'bottom';
}

export interface GcmExternalActionRegistration {
  id: string;
  pluginId: string;
  order?: number;
  icon?: string | ((context: GcmExternalActionContext) => string | Promise<string>);
  label: string | ((context: GcmExternalActionContext) => string | Promise<string>);
  title?: string | ((context: GcmExternalActionContext) => string | Promise<string>);
  isVisible?: (context: GcmExternalActionContext) => boolean | Promise<boolean>;
  onClick: (context: GcmExternalActionContext) => void | Promise<void>;
}

export interface GcmOpenerLeafDiagnostic {
  path: string | null;
  statePath: string;
  viewType: string;
  active: boolean;
  pinned: boolean;
  blank: boolean;
  usableMarkdown: boolean;
}

export interface GcmOpenerDiagnostic {
  targetPath: string | null;
  activePath: string | null;
  existingTargetLeaf: GcmOpenerLeafDiagnostic | null;
  activeLeaf: GcmOpenerLeafDiagnostic | null;
  markdownLeaves: GcmOpenerLeafDiagnostic[];
}

export default class TPSGlobalContextMenuPlugin extends Plugin {
  private static readonly BUILD_STAMP = '2026-07-13 base-create-owner-0.1.9';
  private static readonly BASE_LINK_PREVIEW_SOURCE = 'tps-gcm-base-link-preview';
  private readonly startupTimestamp = Date.now();
  settings: TPSGlobalContextMenuSettings;
  menuController: MenuController;
  persistentMenuManager: PersistentMenuManager;
  bulkEditService: BulkEditService;
  recurrenceService: RecurrenceService;
  fileNamingService: FileNamingService;
  viewModeManager: ViewModeManager;
  dailyNoteHomeService: DailyNoteHomeService;
  dailyNoteNavManager: DailyNoteNavManager;
  contextTargetService: ContextTargetService;
  noteOperationService: NoteOperationService;
  fieldInitializationService: FieldInitializationService;
  commandQueueService: CommandQueueService;
  vaultQueryService: VaultQueryService;
  entityIndexService: EntityIndexService;
  baseRowIndexService: BaseRowIndexService;
  taskIdentityService: TaskIdentityService;
  workspaceRibbonService: WorkspaceRibbonService;
  linkedSubitemCheckboxService: LinkedSubitemCheckboxService;
  frontmatterMutationService: FrontmatterMutationService;
  parentLinkResolutionService: ParentLinkResolutionService;
  bodySubitemLinkService: BodySubitemLinkService;
  subitemRelationshipSyncService: SubitemRelationshipSyncService;
  subitemReferenceIndexService: SubitemReferenceIndexService;
  timeTrackingService: TimeTrackingService;
  timeTrackingStatusBarService: TimeTrackingStatusBarService;
  notebookNavigatorRuleService: NotebookNavigatorRuleService;
  overlayRenderingService: OverlayRenderingService;
  hideCompletedCheckboxesService: HideCompletedCheckboxesService;
  inlinePropertyDecorationService: InlinePropertyDecorationService;
  taskStatusCheckboxReconcileService: TaskStatusCheckboxReconcileService;
  taskLineContextMenuService: TaskLineContextMenuService;
  dailyInboxLineService: DailyInboxLineService;
  taskLineDragService: TaskLineDragService;
  createTaskService: CreateTaskService;
  aiAssistedTaskService: AiAssistedTaskService;
  taskRecurrenceService: TaskRecurrenceService;
  taskApiService: TaskApiService;
  itemHistoryService: ItemHistoryService;
  eventService: GcmEventService;
  identityService: TpsIdentityService;
  cardContentService: CardContentService;
  identityMigrationService: IdentityMigrationService;
  filePropertiesService: FilePropertiesService;
  nativeRecordService: NativeRecordService;
  templateIdentityService: TemplateIdentityService;
  /** @deprecated Use filePropertiesService. Kept for one compatibility release. */
  canvasPropertiesService: FilePropertiesService;
  noteTitleRenderService: NoteTitleRenderService;
  virtualBaseEmbedService: VirtualBaseEmbedService;
  headingCollapseOnOpenService: HeadingCollapseOnOpenService;
  foldExpansionContextMenuService: FoldExpansionContextMenuService;
  homeCaptureService: HomeCaptureService;
  baseLineEditProtocolService: BaseLineEditProtocolService;
  homeComponentActionService: HomeComponentActionService;
  archiveFileService: ArchiveFileService;
  tpsNotebookNavigatorMenuBridge: TpsNotebookNavigatorMenuBridge;
  sharedServices: GcmSharedServices;
  styleEl: HTMLStyleElement | null = null;
  ignoreNextContext = false;
  keyboardVisible = false;
  private archiveSweepTimerId: number | null = null;
  private restoreMenuPatch: (() => void) | null = null;
  private restoreCanvasOpenGuard: (() => void) | null = null;
  private basesPreviewPropertiesObserver: MutationObserver | null = null;
  private basesPreviewPropertiesRefreshTimer: number | null = null;
  private basesPreviewPropertiesRetryTimers: number[] = [];
  private viewModeSuppressedPaths: Set<string> = new Set();
  private externalActionRegistrations: Map<string, GcmExternalActionRegistration> = new Map();
  private basesLinkPreviewArmedPath: string | null = null;
  private basesLinkPreviewArmedUntil = 0;
  private basesLinkPreviewSuppressClickUntil = 0;
  private recentBaseLinkPreviewAnchorEl: HTMLElement | null = null;
  private recentBaseLinkPreviewPointerUntil = 0;
  private recentBaseLinkPreviewPointerPoint: { x: number; y: number } | null = null;
  private baseLinkHoverEditorLeaf: WorkspaceLeaf | null = null;
  private baseLinkPreviewSourceLeaf: WorkspaceLeaf | null = null;
  private openingBaseLinkHoverEditorPath: string | null = null;
  private canvasPointerSession:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        moved: boolean;
      }
    | null = null;
  private canvasMouseSession:
    | {
        startX: number;
        startY: number;
        moved: boolean;
      }
    | null = null;
  private recentCanvasDragUntil = 0;
  taskCheckboxHandler: TaskCheckboxHandler;
  private fileExclusionService: AutoFrontmatterExclusionService;

  private settingsPersistence: SettingsPersistenceCoordinator | null = null;

  private isCanvasOrBasesInteractionTarget(target: EventTarget | null): target is HTMLElement {
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest(
      [
        '.canvas-wrapper',
        '.canvas-node',
        '.canvas-node-content',
        '.bases-feed-entry',
        '.bases-calendar-event-content',
        '.tps-calendar-entry',
      ].join(', '),
    );
  }

  registerExternalAction(action: GcmExternalActionRegistration): () => void {
    const id = String(action?.id || '').trim();
    const pluginId = String(action?.pluginId || '').trim();
    if (!id || !pluginId || typeof action?.onClick !== 'function') {
      throw new Error('GCM external action requires id, pluginId, and onClick.');
    }
    const key = `${pluginId}:${id}`;
    this.externalActionRegistrations.set(key, { ...action, id, pluginId });
    this.overlayRenderingService?.scheduleMenus?.('external-action-registered', 0);
    return () => {
      if (this.externalActionRegistrations.delete(key)) {
        this.overlayRenderingService?.scheduleMenus?.('external-action-unregistered', 0);
      }
    };
  }

  getExternalActions(): GcmExternalActionRegistration[] {
    return Array.from(this.externalActionRegistrations.values())
      .sort((left, right) => (left.order ?? 100) - (right.order ?? 100));
  }

  async openHomeView(): Promise<void> {
    let homeLeaf: WorkspaceLeaf | null = null;
    let created = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!homeLeaf && leaf.view instanceof TpsHomeView && !leaf.view.isDailyNoteBacked()) {
        homeLeaf = leaf;
      }
    });

    if (!homeLeaf) {
      homeLeaf = this.app.workspace.getLeaf('tab' as any);
      created = true;
      await homeLeaf.setViewState({ type: TPS_HOME_VIEW_TYPE, active: true });
    }

    this.app.workspace.setActiveLeaf(homeLeaf, { focus: true });
    if (!created && homeLeaf.view instanceof TpsHomeView) {
      await homeLeaf.view.render();
    }
    logger.flow('HomeView', 'open-command', {
      route: created ? 'created' : 'reused',
      refreshed: !created,
    });
  }

  private emitGcmApiChanged(available: boolean): void {
    const api = available ? (this as any).api ?? null : null;
    this.app.workspace.trigger(TPS_EVENTS.GCM_API_CHANGED, {
      source: 'tps-global-context-menu',
      sourcePluginId: this.manifest.id,
      timestamp: Date.now(),
      available: available && api !== null,
      api,
      formulasVersion: Number(api?.formulas?.version) || null,
      lineMetadataVersion: Number(api?.lineMetadata?.version) || null,
      entityIndexVersion: Number(api?.entityIndex?.version) || null,
      configurationVersion: Number(api?.configuration?.version) || null,
      dailyNotesVersion: Number(api?.dailyNotes?.version) || null,
      taskLinesVersion: Number(api?.taskLines?.version) || null,
      taskCheckboxesVersion: Number(api?.taskCheckboxes?.version) || null,
      tasksVersion: Number(api?.tasks?.version) || null,
      nativeRecordsVersion: Number(api?.nativeRecords?.version) || null,
      itemHistoryVersion: Number(api?.history?.version) || null,
      filePropertiesVersion: Number(api?.fileProperties?.version) || null,
      itemPropertiesVersion: Number(api?.itemProperties?.version) || null,
    });
  }

  async onload(): Promise<void> {
    this.ignoreNextContext = false;
    this.removeLegacyNotebookNavigatorRuleSettingsStyles();
    this.registerEvent(this.app.workspace.on('window-open', (_workspaceWindow, targetWindow) => {
      removeLegacyNotebookNavigatorRuleSettingsStyle(targetWindow.document);
    }));

    await this.loadSettings();
    logger.setLoggingEnabled(this.settings.enableLogging);

    installDateContainsPolyfill();
    this.register(installVisibleViewportContract());
    this.homeComponentActionService = new HomeComponentActionService(this);
    this.registerView(TPS_HOME_VIEW_TYPE, (leaf) => new TpsHomeView(leaf, this));
    if (!this.usesNativeRecordArchitecture()) {
      this.registerBasesView(TPS_TABLE_VIEW_TYPE, {
        name: 'TPS Table',
        icon: 'table',
        factory: (controller: QueryController, containerEl: HTMLElement): BasesView =>
          new TpsTableView(controller, containerEl, this),
        options: () => createTpsTableViewOptions(this),
      });
      this.registerBasesView(TPS_LIST_VIEW_TYPE, {
        name: 'tps list',
        icon: 'list',
        factory: (controller: QueryController, containerEl: HTMLElement): BasesView =>
          createTpsListView(controller, containerEl, this),
        options: () => createTpsListViewOptions(createBaseCreateButtonOptions(this)),
      });
    }

    this.contextTargetService = new ContextTargetService(this);
    this.bulkEditService = new BulkEditService(this);
    this.recurrenceService = new RecurrenceService(this);
    this.fileNamingService = new FileNamingService(this);
    this.noteOperationService = new NoteOperationService(this);
    this.fieldInitializationService = new FieldInitializationService(this);
    this.commandQueueService = new CommandQueueService();
    this.vaultQueryService = new VaultQueryService(this);
    this.baseRowIndexService = new BaseRowIndexService(this);
    if (!this.usesNativeRecordArchitecture()) this.baseRowIndexService.setup();
    this.entityIndexService = new EntityIndexService(this);
    this.configureEntityIndexDimensions();
    this.entityIndexService.setup();
    this.taskIdentityService = new TaskIdentityService();
    this.workspaceRibbonService = new WorkspaceRibbonService(this);
    this.parentLinkResolutionService = new ParentLinkResolutionService(this);
    this.bodySubitemLinkService = new BodySubitemLinkService(this);
    this.subitemRelationshipSyncService = new SubitemRelationshipSyncService(this);
    this.subitemReferenceIndexService = new SubitemReferenceIndexService(this);
    this.timeTrackingService = new TimeTrackingService(this);
    this.timeTrackingStatusBarService = new TimeTrackingStatusBarService(this);
    this.notebookNavigatorRuleService = new NotebookNavigatorRuleService(this);
    this.overlayRenderingService = new OverlayRenderingService(this);
    this.addChild(this.overlayRenderingService);
    this.hideCompletedCheckboxesService = new HideCompletedCheckboxesService(this);
    this.inlinePropertyDecorationService = new InlinePropertyDecorationService(this);
    this.taskStatusCheckboxReconcileService = new TaskStatusCheckboxReconcileService(this);
    this.addChild(this.taskStatusCheckboxReconcileService);
    this.taskLineContextMenuService = new TaskLineContextMenuService(this);
    this.dailyInboxLineService = new DailyInboxLineService(this);
    this.taskLineDragService = new TaskLineDragService(this);
    this.createTaskService = new CreateTaskService(this);
    this.aiAssistedTaskService = new AiAssistedTaskService(this);
    this.taskRecurrenceService = new TaskRecurrenceService(this);
    this.eventService = new GcmEventService(this);
    this.identityService = new TpsIdentityService(this);
    this.itemHistoryService = new ItemHistoryService(this);
    await this.itemHistoryService.setup();
    this.taskApiService = new TaskApiService(this);
    this.cardContentService = new CardContentService();
    this.identityMigrationService = new IdentityMigrationService(this);
    this.filePropertiesService = new FilePropertiesService(this);
    this.canvasPropertiesService = this.filePropertiesService;
    if (!this.usesNativeRecordArchitecture()) {
      this.registerEvent(this.app.metadataCache.on('resolved', () => {
        void this.filePropertiesService.handleMetadataResolved().then(() => {
          this.entityIndexService?.invalidate();
        }).catch((error) => {
          logger.warn('[TPS GCM] Post-metadata file-property catalog rebuild failed', { error });
        });
      }));
      if ((this.app.metadataCache as any).initialized === true) {
        void this.filePropertiesService.handleMetadataResolved().catch((error) => {
          logger.warn('[TPS GCM] Initialized file-property catalog rebuild failed', { error });
        });
      }
      this.app.workspace.onLayoutReady(() => {
        void this.filePropertiesService.setup().then(() => {
          this.entityIndexService?.invalidate();
        }).catch((error) => {
          logger.warn('[TPS GCM] Native file-property catalog setup failed', { error });
        });
      });
    }
    this.register(() => this.filePropertiesService.dispose());
    this.noteTitleRenderService = new NoteTitleRenderService(this);
    this.virtualBaseEmbedService = new VirtualBaseEmbedService(this);
    if (!this.usesNativeRecordArchitecture()) this.addChild(this.virtualBaseEmbedService);
    this.headingCollapseOnOpenService = new HeadingCollapseOnOpenService(this);
    this.addChild(this.headingCollapseOnOpenService);
    this.foldExpansionContextMenuService = new FoldExpansionContextMenuService(this);
    this.homeCaptureService = new HomeCaptureService(this);
    this.baseLineEditProtocolService = new BaseLineEditProtocolService(this);
    if (!this.usesNativeRecordArchitecture()) this.baseLineEditProtocolService.register();
    this.archiveFileService = new ArchiveFileService(this);
    this.register(this.homeComponentActionService.register(HOME_CAPTURE_COMMAND_ID, (context) => (
      this.homeCaptureService.openCaptureModalForContext(context)
    )));
    this.register(this.homeComponentActionService.register(HOME_ADD_TASK_COMMAND_ID, (context) => (
      this.homeCaptureService.openCaptureModalForContext(context, { task: true })
    )));
    this.addChild(this.foldExpansionContextMenuService);
    this.linkedSubitemCheckboxService = new LinkedSubitemCheckboxService(this);
    this.frontmatterMutationService = new FrontmatterMutationService(this);
    this.nativeRecordService = new NativeRecordService(this);
    this.nativeRecordService.setup();
    this.templateIdentityService = new TemplateIdentityService(this);
    this.sharedServices = createSharedServices(this);
    this.registerEditorExtension(createLivePreviewBodySelectionExtension());
    this.registerEditorExtension(this.linkedSubitemCheckboxService.getEditorExtension());
    this.registerEditorExtension(this.hideCompletedCheckboxesService.getEditorExtension());
    this.registerEditorExtension(this.inlinePropertyDecorationService.getEditorExtension());
    this.registerMarkdownPostProcessor((el, ctx) => {
      this.inlinePropertyDecorationService.processRenderedInlineProperties(el);
      this.noteTitleRenderService.processRenderedNoteLinks(el, ctx.sourcePath);
    });
    this.registerDomEvent(document, 'pointerdown', (event: PointerEvent) => {
      this.noteTitleRenderService.handleInlineTitleActivation(event);
    }, { capture: true });
    this.registerDomEvent(document, 'click', (event: MouseEvent) => {
      this.noteTitleRenderService.handleInlineTitleActivation(event);
    }, { capture: true });
    this.registerDomEvent(document, 'keydown', (event: KeyboardEvent) => {
      this.noteTitleRenderService.handleInlineTitleKeydown(event);
    }, { capture: true });
    this.registerDomEvent(document, 'keyup', (event: KeyboardEvent) => {
      this.noteTitleRenderService.handleInlineTitleKeyup(event);
    }, { capture: true });
    this.registerInterval(window.setInterval(() => {
      this.noteTitleRenderService.refreshInlineTitles();
    }, 900));
    this.registerEditorSuggest(new InlinePropertySuggest(this));
    this.addChild(new HeadingLinkSuggest(this));
    this.app.workspace.updateOptions();

    this.menuController = new MenuController(this);
    this.tpsNotebookNavigatorMenuBridge = new TpsNotebookNavigatorMenuBridge(this);
    this.persistentMenuManager = new PersistentMenuManager(this);
    this.viewModeManager = new ViewModeManager(this);
    this.addChild(this.viewModeManager);
    this.dailyNoteHomeService = new DailyNoteHomeService(this);
    this.addChild(this.dailyNoteHomeService);
    this.dailyNoteNavManager = new DailyNoteNavManager(this);
    this.addChild(this.dailyNoteNavManager);

    this.taskCheckboxHandler = new TaskCheckboxHandler(this);
    this.fileExclusionService = new AutoFrontmatterExclusionService(
      () => this.settings.frontmatterAutoWriteExclusions,
    );

    // Initialize recurrence listener
    this.recurrenceService.setup();

    this.restoreMenuPatch = setupMenuPatch(this);
    this.restoreCanvasOpenGuard = this.shouldInstallWorkspaceOpenPatch()
      ? this.installCanvasOpenGuard()
      : () => {};

    this.injectStyles();
    this.hideCompletedCheckboxesService.attach();
    this.taskLineDragService.attach();
    this.hideCompletedCheckboxesService.applyBodyClass();
    this.registerHoverLinkSource(TPSGlobalContextMenuPlugin.BASE_LINK_PREVIEW_SOURCE, {
      display: 'TPS Base link preview',
      defaultMod: false,
    });

    this.keyboardVisible = false;

    this.addSettingTab(new TPSGlobalContextMenuSettingTab(this.app, this));

    logger.log('[TPS GCM] Runtime build loaded', {
      build: TPSGlobalContextMenuPlugin.BUILD_STAMP,
      dir: this.manifest.dir,
    });

    // Register all workspace/vault events (includes initial ensureMenus call)
    registerGcmEvents(this);
    if (this.canRunBackgroundAutomation()) {
      this.startArchiveTagAutomation();
    }

    // Expose inter-plugin API
    setupPluginApi(this);
    this.tpsNotebookNavigatorMenuBridge.start();
    this.registerEvent(this.app.workspace.on(TPS_EVENTS.GCM_API_REQUEST as any, () => {
      this.emitGcmApiChanged(true);
    }));
    this.emitGcmApiChanged(true);
    this.timeTrackingService.setup();
    this.timeTrackingStatusBarService.setup();
    if (!this.usesNativeRecordArchitecture()) {
      this.registerEvent(this.app.metadataCache.on('resolved', () => {
        this.virtualBaseEmbedService.scheduleRefresh(0);
      }));
      this.registerEvent(this.app.workspace.on('file-open', () => {
        this.virtualBaseEmbedService.scheduleRefresh(80);
      }));
      this.registerEvent(this.app.workspace.on('layout-change', () => {
        this.virtualBaseEmbedService.scheduleRefresh(80);
      }));
      this.app.workspace.onLayoutReady(() => {
        this.virtualBaseEmbedService.scheduleRefresh(0);
        window.setTimeout(() => this.virtualBaseEmbedService.scheduleRefresh(0), 350);
        window.setTimeout(() => this.virtualBaseEmbedService.scheduleRefresh(0), 1200);
      });
    }
    this.app.workspace.onLayoutReady(() => {
      if (!this.canRunBackgroundAutomation()) return;
      if (!this.notebookNavigatorRuleService.shouldApplyOnStartup()) return;
      window.setTimeout(() => {
        if (!this.canRunBackgroundAutomation()) return;
        void this.notebookNavigatorRuleService.applyRulesToAllFiles({
          reason: 'gcm-startup-auto',
          force: true,
          bypassCreationGrace: true,
        });
      }, 1000);
    });
    // Check for missing recurrences on startup; build workspace ribbon buttons
    this.app.workspace.onLayoutReady(async () => {
      this.workspaceRibbonService.setup();
      // Wait for metadataCache to finish initial indexing before scanning for
      // missing recurrences. 'resolved' fires once indexing completes; the
      // 6-second fallback handles edge cases where the event fires before we
      // register (already-resolved vaults).
      let startupCheckDone = false;
      const runStartupCheck = async () => {
        if (!this.canRunBackgroundAutomation()) return;
        if (startupCheckDone) return;
        startupCheckDone = true;
        logger.log('[TPS GCM] Checking for missing recurrences on startup...');
        await this.bulkEditService.checkMissingRecurrences();
      };
      this.registerEvent(
        this.app.metadataCache.on('resolved', () => void runStartupCheck())
      );
      setTimeout(() => void runStartupCheck(), 6000);
    });

    // Capture right-click targets early so file-menu/files-menu can expand accurately.
    this.registerDomEvent(document, 'mousedown', (evt: MouseEvent) => {
      if (evt.button !== 2) return;
      this.contextTargetService.recordContextTarget(evt.target);
    }, { capture: true });

    if (this.shouldInstallWorkspaceOpenPatch()) {
      this.registerDomEvent(document, 'mousedown', (evt: MouseEvent) => {
        if (evt.button !== 0) return;
        if (!this.isCanvasOrBasesInteractionTarget(evt.target)) {
          this.canvasMouseSession = null;
          return;
        }
        this.canvasMouseSession = {
          startX: evt.clientX,
          startY: evt.clientY,
          moved: false,
        };
      }, { capture: true });

      this.registerDomEvent(document, 'pointerdown', (evt: PointerEvent) => {
        if (evt.button !== 0) return;
        if (!this.isCanvasOrBasesInteractionTarget(evt.target)) {
          this.canvasPointerSession = null;
          return;
        }
        this.canvasPointerSession = {
          pointerId: evt.pointerId,
          startX: evt.clientX,
          startY: evt.clientY,
          moved: false,
        };
      }, { capture: true });

      this.registerDomEvent(document, 'pointermove', (evt: PointerEvent) => {
        const session = this.canvasPointerSession;
        if (!session || session.pointerId !== evt.pointerId) return;
        const dx = evt.clientX - session.startX;
        const dy = evt.clientY - session.startY;
        if (!session.moved && Math.hypot(dx, dy) >= 6) {
          session.moved = true;
          this.markRecentCanvasDrag(1500);
        }
      }, { capture: true, passive: true });

      this.registerDomEvent(document, 'mousemove', (evt: MouseEvent) => {
        const session = this.canvasMouseSession;
        if (!session || (evt.buttons & 1) === 0) return;
        const dx = evt.clientX - session.startX;
        const dy = evt.clientY - session.startY;
        if (!session.moved && Math.hypot(dx, dy) >= 6) {
          session.moved = true;
          this.markRecentCanvasDrag(1500);
        }
      }, { capture: true, passive: true });

      const finishCanvasPointerSession = (evt: PointerEvent) => {
        const session = this.canvasPointerSession;
        if (!session || session.pointerId !== evt.pointerId) return;
        if (session.moved) {
          this.markRecentCanvasDrag(1200);
        }
        this.canvasPointerSession = null;
      };

      const finishCanvasMouseSession = () => {
        const session = this.canvasMouseSession;
        if (!session) return;
        if (session.moved) {
          this.markRecentCanvasDrag(1200);
        }
        this.canvasMouseSession = null;
      };

      this.registerDomEvent(document, 'pointerup', finishCanvasPointerSession, { capture: true, passive: true });
      this.registerDomEvent(document, 'pointercancel', finishCanvasPointerSession, { capture: true, passive: true });
      this.registerDomEvent(document, 'mouseup', finishCanvasMouseSession, { capture: true, passive: true });
      this.registerDomEvent(document, 'dragstart', (evt: DragEvent) => {
        if (this.isCanvasOrBasesInteractionTarget(evt.target)) {
          this.markRecentCanvasDrag(1800);
        }
      }, { capture: true });
      this.registerDomEvent(document, 'dragend', (evt: DragEvent) => {
        if (this.isCanvasOrBasesInteractionTarget(evt.target)) {
          this.markRecentCanvasDrag(1400);
        }
        this.canvasMouseSession = null;
        this.canvasPointerSession = null;
      }, { capture: true });
    }

    this.registerBasesLinkPreviewHandler();
    this.registerInteractionHandlers();
    this.installBasesPreviewPropertiesBridge();

    registerGcmCommands(this);
  }

  private registerInteractionHandlers(): void {
    if (!this.usesNativeRecordArchitecture()) {
      this.registerTpsListNativeCreateHandler();
      this.registerTpsTableNativeCreateHandler();
    }
    this.registerLinkedSubitemHandlers();
    this.registerManualContextMenuHandler();
  }

  private registerTpsListNativeCreateHandler(): void {
    this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
      void this.handleTpsListNativeCreateClick(evt);
    }, { capture: true });
    this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
      if (evt.key !== 'Enter' && evt.key !== ' ') return;
      void this.handleTpsListNativeCreateClick(evt);
    }, { capture: true });
  }

  private async handleTpsListNativeCreateClick(evt: MouseEvent | KeyboardEvent): Promise<void> {
    if (evt.defaultPrevented || (evt instanceof MouseEvent && evt.button !== 0)) return;
    const target = getTpsBaseNativeCreateEventTarget(evt.target);
    if (!target) return;

    const scope = this.getTpsListNativeCreateScope(target);
    if (!scope) return;
    const listRoot = this.getVisibleTpsBaseCreateRoot(scope, '.tps-list-scroll');
    const view = (listRoot as any)?.__tpsListView as { createFileForView: () => Promise<void> } | undefined;
    if (!listRoot || !view || typeof view.createFileForView !== 'function') return;
    if (!isTpsBaseNativeCreateTarget(target, scope)) return;

    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    if (listRoot.dataset.tpsNativeCreateInFlight === 'true') return;

    listRoot.dataset.tpsNativeCreateInFlight = 'true';
    logger.flow('TpsListView', 'native-create-click:owned-view', {
      activation: evt instanceof KeyboardEvent ? `key:${evt.key}` : 'pointer',
      targetText: target.textContent?.trim().slice(0, 80) || null,
      contextPath: listRoot.dataset.tpsContextPath || null,
      homeComponent: listRoot.closest<HTMLElement>('.tps-home-panel')?.dataset.tpsHomeComponentKey || null,
    });
    try {
      await view.createFileForView();
    } catch (error) {
      console.error('[TPS GCM] Native TPS List create failed', error);
      new Notice('Could not create an item from this base.');
    } finally {
      delete listRoot.dataset.tpsNativeCreateInFlight;
    }
  }

  private registerTpsTableNativeCreateHandler(): void {
    this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
      void this.handleTpsTableNativeCreateClick(evt);
    }, { capture: true });
  }

  private async handleTpsTableNativeCreateClick(evt: MouseEvent): Promise<void> {
    if (evt.defaultPrevented || evt.button !== 0) return;
    const target = getTpsBaseNativeCreateEventTarget(evt.target);
    if (!target) return;

    const scope = this.getTpsTableNativeCreateScope(target);
    if (!scope) return;
    const tableRoot = this.getVisibleTpsBaseCreateRoot(scope, '.tps-log-base');
    const view = (tableRoot as any)?.__tpsTableView as TpsTableView | undefined;
    if (!tableRoot || !view || typeof view.createFileForView !== 'function') return;
    if (!isTpsBaseNativeCreateTarget(target, scope)) return;

    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    const hasCommandOverride = typeof view.hasCreateCommandOverride === 'function' && view.hasCreateCommandOverride();
    logger.flow('TpsTableView', 'native-create-click:owned-view', {
      targetText: target.textContent?.trim().slice(0, 80) || null,
      basePath: tableRoot.dataset.tpsBasePath || null,
      homeComponent: tableRoot.closest<HTMLElement>('.tps-home-panel')?.dataset.tpsHomeComponentKey || null,
      route: hasCommandOverride ? 'command-override' : 'filter-default',
    });
    if (typeof view.hasCreateCommandOverride === 'function' && !view.hasCreateCommandOverride()) {
      await view.createFileForView();
      return;
    }
    if (hasCommandOverride && typeof view.runCreateCommandOverride === 'function') {
      await view.runCreateCommandOverride();
      return;
    }
    await view.createFileForView();
  }

  private getTpsListNativeCreateScope(target: Element): HTMLElement | null {
    return this.getTpsBaseNativeCreateScope(target, '.tps-list-scroll');
  }

  private getTpsTableNativeCreateScope(target: Element): HTMLElement | null {
    return this.getTpsBaseNativeCreateScope(target, '.tps-log-base');
  }

  private getTpsBaseNativeCreateScope(target: Element, rootSelector: string): HTMLElement | null {
    const boundedOwner = target.closest<HTMLElement>([
      '.tps-home-panel',
      '.tps-home-base-host',
      '.internal-embed',
      '.markdown-embed',
      '.cm-embed-block',
      '.canvas-node-content',
      '.bases-embed',
    ].join(', '));
    if (boundedOwner) {
      return this.getVisibleTpsBaseCreateRoot(boundedOwner, rootSelector) ? boundedOwner : null;
    }
    const leaf = target.closest<HTMLElement>('.workspace-leaf-content');
    if (!leaf) return null;
    return this.getVisibleTpsBaseCreateRoot(leaf, rootSelector) ? leaf : null;
  }

  private getVisibleTpsBaseCreateRoot(scope: HTMLElement, selector: string): HTMLElement | null {
    const roots = [
      ...(scope.matches(selector) ? [scope] : []),
      ...Array.from(scope.querySelectorAll<HTMLElement>(selector)),
    ]
      .filter((root) => root.isConnected && root.getClientRects().length > 0);
    return roots.length === 1 ? roots[0] : null;
  }

  private registerLinkedSubitemHandlers(): void {
    this.registerDomEvent(document, 'contextmenu', (evt: MouseEvent) => {
      if (this.handleTpsTableRowContextMenu(evt)) return;
      if (this.taskCheckboxHandler.handleContextMenu(evt)) return;
      if (this.taskLineContextMenuService.handleContextMenu(evt)) return;
      if (this.inlinePropertyDecorationService.handleRenderedInlinePropertyContextMenu(evt)) return;
      void this.linkedSubitemCheckboxService.handleContextMenu(evt);
    }, { capture: true });

    this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
      if (this.taskLineContextMenuService.handleClick(evt)) return;
      void this.linkedSubitemCheckboxService.handleClick(evt);
    }, { capture: true });

    this.registerDomEvent(document, 'touchstart', (evt: TouchEvent) => {
      if (!this.linkedSubitemCheckboxService.handleTouchStart(evt)) {
        this.taskCheckboxHandler.handleTouchStart(evt);
      }
    }, { capture: true, passive: true });
    this.registerDomEvent(document, 'touchmove', () => {
      this.linkedSubitemCheckboxService.handleTouchCancel();
      this.taskCheckboxHandler.handleTouchCancel();
    }, { capture: true, passive: true });
    this.registerDomEvent(document, 'touchend', () => {
      this.linkedSubitemCheckboxService.handleTouchCancel();
      this.taskCheckboxHandler.handleTouchCancel();
    }, { capture: true, passive: true });
    this.registerDomEvent(document, 'touchcancel', () => {
      this.linkedSubitemCheckboxService.handleTouchCancel();
      this.taskCheckboxHandler.handleTouchCancel();
    }, { capture: true, passive: true });
  }

  private handleTpsTableRowContextMenu(evt: MouseEvent): boolean {
    const target = evt.target instanceof Element ? evt.target : null;
    const row = target?.closest<HTMLElement>('.tps-log-base-row[data-path][data-line]');
    if (!row) return false;

    if (this.handleTpsHealthFoodTableRowContextMenu(evt, row)) return true;
    if (
      row.dataset.tpsGcmContext === 'table-task'
      || (Boolean(row.dataset.taskPath) && Boolean(row.dataset.taskLine))
    ) {
      logger.flow('TpsTableView', 'context-menu:task-handoff', {
        path: row.dataset.taskPath || row.dataset.path || '',
        lineNumber: Number(row.dataset.taskLine || row.dataset.line || '0'),
      });
      return false;
    }

    const view = (row as any).__tpsTableView;
    if (!view || typeof view.handleExternalRowContextMenu !== 'function') return false;
    return view.handleExternalRowContextMenu(evt, row) === true;
  }

  private handleTpsHealthFoodTableRowContextMenu(evt: MouseEvent, row: HTMLElement): boolean {
    const api = (this.app as any)?.tpsHealth;
    if (typeof api?.openFoodLogEntryMenuFromLine !== 'function') return false;
    if (!this.isTpsTableFoodRow(row)) return false;
    const path = row.dataset.path || '';
    const oneBasedLine = Number(row.dataset.line || '0');
    if (!path || !Number.isInteger(oneBasedLine) || oneBasedLine < 1) return false;
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    void api.openFoodLogEntryMenuFromLine(evt, path, oneBasedLine - 1, '');
    logger.flow('TpsTableView', 'context-menu:health-food-handoff', { path, lineNumber: oneBasedLine });
    return true;
  }

  private isTpsTableFoodRow(row: HTMLElement): boolean {
    return Array.from(row.querySelectorAll<HTMLElement>('.tps-log-base-cell[data-key]'))
      .some((cell) => normalizeTpsTableKey(cell.dataset.key || '') === 'food' && Boolean(cell.textContent?.trim()));
  }

  private registerManualContextMenuHandler(): void {
    this.registerDomEvent(document, 'contextmenu', (evt: MouseEvent) => {
      if (this.settings.inlineMenuOnly) return;
      const targetEl = evt.target instanceof Element ? evt.target.closest<HTMLElement>('*') : null;
      this.contextTargetService.recordContextTarget(targetEl);

      if (!this.contextTargetService.isManualContextInterceptTarget(targetEl)) return;
      if (this.contextTargetService.isMarkdownNoteLinkTarget(targetEl)) return;

      const targets = this.contextTargetService.resolveTargets([], evt);
      if (targets.length === 0) return;

      evt.preventDefault();
      evt.stopPropagation();

      const menu = new Menu();
      this.menuController.addToNativeMenu(menu, targets);
      menu.showAtPosition({ x: evt.pageX, y: evt.pageY });
    }, { capture: true });
  }

  private registerBasesLinkPreviewHandler(): void {
    this.clearRecentBaseLinkPreviewPointer();
    this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
      const target = evt.target instanceof HTMLElement ? evt.target : null;
      const resolved = this.resolveBasesNoteLinkTarget(target);
      if (!resolved) return;
      const listRow = target?.closest<HTMLElement>(
        '.tps-list-native-row--note[data-tps-list-selection-id]',
      );
      const listView = (listRow?.closest<HTMLElement>('.tps-list-scroll') as any)?.__tpsListView as {
        applyTpsListRowSelection?: (event: MouseEvent, target: HTMLElement) => Promise<void>;
      } | undefined;
      if (listRow && evt.button === 0 && !evt.shiftKey && !evt.metaKey && !evt.ctrlKey && !evt.altKey) {
        void listView?.applyTpsListRowSelection?.(evt, listRow);
      }
      this.openBaseNotePreviewFromClick(evt, resolved.file, resolved.linkEl);
    }, { capture: true });
  }

  openBaseNotePreviewFromClick(evt: MouseEvent, file: TFile, anchorEl: HTMLElement, force = false): boolean {
    if ((!force && !this.isBasesForcedLinkPreviewEnabled()) || evt.button !== 0) return false;
    if (evt.metaKey || evt.ctrlKey || evt.shiftKey || evt.altKey) return false;
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    const now = Date.now();
    const repeatedClick = this.basesLinkPreviewArmedPath === file.path
      && now <= this.basesLinkPreviewArmedUntil;
    if (repeatedClick) {
      this.basesLinkPreviewArmedPath = null;
      this.basesLinkPreviewArmedUntil = 0;
      this.closeBaseLinkHoverEditor(getPluginById(this.app, 'obsidian-hover-editor') as any);
      void this.openFileInLeaf(file, false, () => this.getBaseLinkPreviewOpenLeaf(), { revealLeaf: true });
      logger.flow('BasesLinkPreview', 'open-note', { path: file.path });
      return true;
    }

    this.basesLinkPreviewArmedPath = file.path;
    this.basesLinkPreviewArmedUntil = now + 900;
    void this.openBaseLinkInHoverEditor(file, anchorEl).then((opened) => {
      if (!opened) this.showNativeBaseLinkPreview(evt, file, anchorEl);
      logger.flow('BasesLinkPreview', opened ? 'hover-editor-open' : 'native-preview-open', {
        path: file.path,
      });
    });
    return true;
  }

  private isBasesForcedLinkPreviewEnabled(): boolean {
    return this.settings.enableBasesForcedLinkPreview === true;
  }

  private shouldInstallWorkspaceOpenPatch(): boolean {
    return this.settings.enableCanvasOpenGuard === true;
  }

  private getActiveBaseLeafRootForTarget(target: HTMLElement | null): HTMLElement | null {
    if (!target) return null;
    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile) || activeFile.extension.toLowerCase() !== 'base') return null;

    const activeLeafEl = (this.app.workspace.activeLeaf as any)?.containerEl as HTMLElement | undefined;
    const leafRoot = target.closest<HTMLElement>('.workspace-leaf-content');
    if (!activeLeafEl || !leafRoot || !activeLeafEl.contains(leafRoot)) return null;
    return leafRoot;
  }

  private getAllowedBaseLinkPreviewRoot(target: HTMLElement | null): HTMLElement | null {
    if (!target) return null;
    return target.closest<HTMLElement>(
      [
        '.bases-calendar-event-content',
        '.tps-calendar-entry',
        '.tps-kanban-card[data-path]',
        '.tps-kanban-card .internal-link',
        '.tps-kanban-card [data-path]',
        '.tps-list-native-row--note[data-path]',
        '.tps-list-native-property--source.internal-link',
        '.tps-log-base-row a.internal-link',
      ].join(', '),
    );
  }

  private getBaseLinkPreviewOpenLeaf(): WorkspaceLeaf | null {
    const sourceLeaf = this.baseLinkPreviewSourceLeaf;
    if (sourceLeaf && this.isPinnedLeafForDifferentFile(sourceLeaf, null)) {
      return this.app.workspace.getLeaf(true);
    }
    if (sourceLeaf && sourceLeaf !== this.baseLinkHoverEditorLeaf) return sourceLeaf;
    return this.app.workspace.getLeaf(false);
  }

  private clearRecentBaseLinkPreviewPointer(): void {
    this.recentBaseLinkPreviewAnchorEl = null;
    this.recentBaseLinkPreviewPointerUntil = 0;
    this.recentBaseLinkPreviewPointerPoint = null;
  }

  private getBaseLinkPreviewEventPoint(evt: MouseEvent | PointerEvent | TouchEvent): { x: number; y: number } | null {
    if (evt instanceof TouchEvent) {
      const touch = evt.changedTouches[0] ?? evt.touches[0];
      return touch ? { x: touch.clientX, y: touch.clientY } : null;
    }
    return { x: evt.clientX, y: evt.clientY };
  }

  private async openBaseLinkInHoverEditor(file: TFile, anchorEl: HTMLElement): Promise<boolean> {
    const hoverEditorPlugin = getPluginById(this.app, 'obsidian-hover-editor') as any;
    const spawnPopover = hoverEditorPlugin?.spawnPopover;
    if (typeof spawnPopover !== 'function') {
      try {
        await this.persistentMenuManager.showBaseLinkEditablePreview(file, anchorEl);
        logger.flow('BasesLinkPreview', 'local-editor-open', { path: file.path });
        return true;
      } catch (error) {
        logger.warn('Failed to open local editable Base preview', {
          path: file.path,
          error: getErrorMessage(error),
        });
        return false;
      }
    }

    try {
      this.closeBaseLinkHoverEditor(hoverEditorPlugin);
      let popoverLeaf: WorkspaceLeaf | null = null;
      popoverLeaf = spawnPopover.call(hoverEditorPlugin, anchorEl, () => {
        if (popoverLeaf) {
          this.app.workspace.setActiveLeaf(popoverLeaf, { focus: true });
        }
      }) as WorkspaceLeaf;

      if (!popoverLeaf) return false;
      this.baseLinkHoverEditorLeaf = popoverLeaf;
      this.markBaseLinkHoverEditorPopover(popoverLeaf);

      this.openingBaseLinkHoverEditorPath = file.path;
      try {
        await popoverLeaf.openFile(file, { active: true });
      } finally {
        this.openingBaseLinkHoverEditorPath = null;
      }

      this.markBaseLinkHoverEditorPopover(popoverLeaf);
      return true;
    } catch (error) {
      logger.warn('Failed to open Bases link in Hover Editor', {
        path: file.path,
        error: getErrorMessage(error),
      });
      return false;
    }
  }

  private closeBaseLinkHoverEditor(hoverEditorPlugin?: any): void {
    const activePopovers = Array.isArray(hoverEditorPlugin?.activePopovers)
      ? hoverEditorPlugin.activePopovers
      : [];

    for (const popover of activePopovers) {
      const hoverEl = popover?.hoverEl as HTMLElement | undefined;
      if (!hoverEl?.hasClass?.('tps-gcm-hover-editor-note-scale')) continue;
      try {
        popover.hide?.();
      } catch (error) {
        logger.debug('Failed to hide previous GCM Hover Editor popover', { error: getErrorMessage(error) });
      }
    }

    if (this.baseLinkHoverEditorLeaf) {
      try {
        this.baseLinkHoverEditorLeaf.detach();
      } catch (error) {
        logger.debug('Failed to detach previous GCM Hover Editor leaf', { error: getErrorMessage(error) });
      }
      this.baseLinkHoverEditorLeaf = null;
    }
  }

  private markBaseLinkHoverEditorPopover(leaf: WorkspaceLeaf): void {
    const containerEl = (leaf as any).containerEl as HTMLElement | undefined;
    if (!containerEl) return;
    containerEl.addClass('tps-gcm-hover-editor-note-scale');
    const popoverEl = containerEl.closest<HTMLElement>('.hover-editor, .hover-popover, .popover');
    popoverEl?.addClass('tps-gcm-hover-editor-note-scale');
  }

  private scheduleBaseLinkHoverEditorPropertyCollapse(leaf: WorkspaceLeaf): void {
    [0, 80, 220, 500].forEach((delay) => {
      window.setTimeout(() => this.collapseBaseLinkHoverEditorProperties(leaf), delay);
    });
  }

  private collapseBaseLinkHoverEditorProperties(leaf: WorkspaceLeaf): void {
    if (leaf !== this.baseLinkHoverEditorLeaf) return;
    const containerEl = (leaf as any).containerEl as HTMLElement | undefined;
    if (!containerEl?.isConnected) return;

    const root = containerEl.closest<HTMLElement>('.tps-gcm-hover-editor-note-scale') ?? containerEl;
    const expandedHeading = root.querySelector<HTMLElement>(
      [
        '.metadata-properties-heading[aria-expanded="true"]',
        '.metadata-container .metadata-properties-heading[aria-expanded="true"]',
        '.metadata-container [aria-label="Collapse properties"]',
        '.metadata-container [aria-label="Collapse Properties"]',
      ].join(', '),
    );

    if (expandedHeading) {
      expandedHeading.click();
      return;
    }

    const metadataContainer = root.querySelector<HTMLElement>('.metadata-container, .metadata-properties');
    const hasVisibleRows = !!metadataContainer?.querySelector<HTMLElement>('.metadata-property, .metadata-add-button');
    const fallbackHeading = metadataContainer?.querySelector<HTMLElement>('.metadata-properties-heading');
    if (hasVisibleRows && fallbackHeading) fallbackHeading.click();
  }

  private showNativeBaseLinkPreview(evt: MouseEvent, file: TFile, linkEl: HTMLElement): void {
    const hoverParent = (this.app.workspace.activeLeaf || this.app.workspace.getMostRecentLeaf()) as any;
    if (!hoverParent) {
      void this.openFileInLeaf(file, false, () => this.app.workspace.getLeaf(false), { revealLeaf: true });
      return;
    }

    this.app.workspace.trigger('hover-link', {
      event: evt,
      source: TPSGlobalContextMenuPlugin.BASE_LINK_PREVIEW_SOURCE,
      hoverParent,
      targetEl: linkEl,
      linktext: file.path,
      sourcePath: this.app.workspace.getActiveFile()?.path || '',
    });
  }

  private resolveBasesNoteLinkTarget(target: HTMLElement | null): { file: TFile; linkEl: HTMLElement } | null {
    if (!target) return null;
    if (target.closest('.tps-gcm-base-link-preview, .tps-global-context-menu, .menu, .modal')) return null;
    if (this.isBaseLinkPreviewExcludedTarget(target)) return null;

    const taskSurface = target.closest<HTMLElement>(
      '[data-tps-gcm-context="kanban-task"], [data-tps-gcm-context="calendar-task"], [data-tps-gcm-context="table-task"], .tps-list-native-row--task',
    );
    const explicitNoteLink = target.closest<HTMLElement>('a.internal-link, .tps-list-native-property--source.internal-link');
    if (taskSurface && !explicitNoteLink) return null;

    const basesRoot = this.getAllowedBaseLinkPreviewRoot(target);
    if (!basesRoot) return null;

    let linkEl = target.closest<HTMLElement>(
      [
        'a.internal-link',
        '.internal-link',
        '[data-href]',
        '[data-linkpath]',
        '[data-file]',
        '[data-file-path]',
        '[data-filepath]',
        '[data-path]',
        '.tps-kanban-card[data-path]',
        '[data-path].internal-link',
        'a[data-path]',
      ].join(', '),
    );

    const interactiveControl = target.closest<HTMLElement>(
      'button, input, textarea, select, [aria-haspopup], [aria-expanded], .clickable-icon',
    );
    if (
      interactiveControl
      && (!linkEl || interactiveControl !== linkEl)
      && !interactiveControl.matches('a.internal-link, .internal-link')
      && this.isBasesNonNoteControl(interactiveControl)
    ) {
      return null;
    }

    const resolveElement = (el: HTMLElement): { file: TFile; linkEl: HTMLElement } | null => {
      const candidates = [
        el.dataset.path,
        el.dataset.file,
        (el.dataset as any).filePath,
        (el.dataset as any).filepath,
        el.dataset.href,
        el.dataset.linkpath,
        el.getAttribute('href'),
        el.getAttribute('data-path'),
        el.getAttribute('data-file'),
        el.getAttribute('data-file-path'),
        el.getAttribute('data-filepath'),
        el.getAttribute('data-href'),
        el.getAttribute('data-linkpath'),
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.textContent,
      ];

      for (const raw of candidates) {
        const file = this.resolveLinkCandidateToMarkdownFile(raw);
        if (file) return { file, linkEl: el };
      }

      return null;
    };

    if (linkEl) {
      const resolved = resolveElement(linkEl);
      if (resolved) return resolved;
    }

    let ancestor: HTMLElement | null = target;
    while (ancestor && ancestor !== basesRoot) {
      if (!linkEl) linkEl = ancestor;
      const resolved = resolveElement(ancestor);
      if (resolved) return resolved;
      ancestor = ancestor.parentElement;
    }

    return null;
  }

  private isBaseLinkPreviewExcludedTarget(target: HTMLElement | null): boolean {
    if (!target) return true;
    return !!target.closest(
      [
        '.metadata-container',
        '.metadata-properties',
        '.metadata-property',
        '.metadata-property-container',
        '.metadata-property-key',
        '.metadata-property-value',
        '.metadata-property-value-input',
        '.metadata-add-button',
        '.tps-gcm-top-properties-panel',
        '.tps-gcm-top-property-row',
        '.tps-gcm-top-property-value',
        '.tps-gcm-chip',
        '[data-tps-table-cell-intent="property"]',
        '.workspace-ribbon',
        '.side-dock-ribbon',
        '.workspace-tabs',
        '.workspace-tab-header',
        '.workspace-sidedock-vault-profile',
        '.view-header',
        '.view-actions',
        '.nav-header',
        '.nav-buttons-container',
        '.nav-files-container',
        '.nav-folder',
        '.nav-file',
        '.tree-item',
        '.status-bar',
        '.titlebar',
        'button',
        'input',
        'textarea',
        'select',
        '[role="button"]',
        '[aria-haspopup]',
        '[aria-expanded]',
        '.clickable-icon',
      ].join(', '),
    );
  }

  private resolveLinkCandidateToMarkdownFile(rawCandidate: string | null | undefined): TFile | null {
    let raw = String(rawCandidate || '').trim();
    if (!raw) return null;

    try {
      raw = decodeURI(raw);
    } catch {
      // Keep the original candidate if it is not URI encoded.
    }

    raw = raw
      .replace(/^obsidian:\/\//i, '')
      .replace(/^#/, '')
      .replace(/^!?\[\[/, '')
      .replace(/\]\]$/, '')
      .replace(/^!?\[[^\]]*]\(([^)]+)\)$/, '$1')
      .split('|')[0]
      .split('#')[0]
      .trim();
    if (!raw) return null;

    const embeddedMarkdownPath = raw.match(/(?:^|[\s"'([{])([^"'()[\]{}<>]+?\.md)(?:$|[\s"')\]}])/i)?.[1];
    if (embeddedMarkdownPath) {
      raw = embeddedMarkdownPath.trim();
    }

    const direct = this.app.vault.getAbstractFileByPath(raw);
    if (this.isOrdinaryMarkdownFile(direct)) return direct;

    const withMd = raw.toLowerCase().endsWith('.md') ? raw : `${raw}.md`;
    const directMd = this.app.vault.getAbstractFileByPath(withMd);
    if (this.isOrdinaryMarkdownFile(directMd)) return directMd;

    const basename = raw.replace(/\.md$/i, '');
    const basenameMatch = this.app.vault.getMarkdownFiles().find((file) => (
      this.isOrdinaryMarkdownFile(file) && (
        file.path === withMd ||
        file.name.toLowerCase() === withMd.toLowerCase() ||
        file.basename.toLowerCase() === basename.toLowerCase()
      )
    ));
    if (basenameMatch) return basenameMatch;

    const normalizedCandidate = raw.toLowerCase().replace(/\s+/g, '');
    const cardTextPrefixMatch = this.app.vault.getMarkdownFiles().find((file) => {
      if (!this.isOrdinaryMarkdownFile(file)) return false;
      const normalizedBasename = file.basename.toLowerCase().replace(/\s+/g, '');
      return (
        normalizedBasename.length >= 3 &&
        normalizedCandidate.startsWith(normalizedBasename) &&
        normalizedCandidate.length <= normalizedBasename.length + 48
      );
    });
    if (cardTextPrefixMatch) return cardTextPrefixMatch;

    const linked = this.app.metadataCache.getFirstLinkpathDest(raw.replace(/\.md$/i, ''), '');
    return this.isOrdinaryMarkdownFile(linked)
      ? linked
      : null;
  }

  private isOrdinaryMarkdownFile(file: unknown): file is TFile {
    return file instanceof TFile
      && file.extension.toLowerCase() === 'md'
      && this.filePropertiesService?.isCompanionFile(file) !== true;
  }

  private isBasesNonNoteControl(control: HTMLElement): boolean {
    if (control.matches('input, textarea, select')) return true;
    const label = [
      control.getAttribute('aria-label'),
      control.getAttribute('title'),
      control.textContent,
    ].filter(Boolean).join(' ').toLowerCase();

    return [
      'add subitem',
      'expand subitems',
      'collapse subitems',
      'reorder lane',
      'rename lane',
      'add card',
      'switch to list',
      'switch to table',
      'dynamic width',
      'sort',
      'filter',
      'properties',
      'search',
      'new',
    ].some((needle) => label.includes(needle));
  }

  private installBasesPreviewPropertiesBridge(): void {
    if (typeof MutationObserver === 'undefined') return;
    if (this.settings.showCustomPropertiesUnderTitle !== true) return;

    const scheduleRefresh = (force = false) => {
      if (this.basesPreviewPropertiesRefreshTimer !== null) {
        window.clearTimeout(this.basesPreviewPropertiesRefreshTimer);
      }
      this.basesPreviewPropertiesRefreshTimer = window.setTimeout(() => {
        this.basesPreviewPropertiesRefreshTimer = null;
        this.refreshBasesPreviewProperties(force);
      }, 60);
    };

    const scheduleRefreshBurst = (force = false) => {
      scheduleRefresh(force);
      for (const delay of [250, 900]) {
        const timer = window.setTimeout(() => {
          this.basesPreviewPropertiesRetryTimers = this.basesPreviewPropertiesRetryTimers.filter((id) => id !== timer);
          this.refreshBasesPreviewProperties(force);
        }, delay);
        this.basesPreviewPropertiesRetryTimers.push(timer);
      }
    };

    const isRelevantPreviewMutation = (mutation: MutationRecord): boolean => {
      const candidates: Node[] = [mutation.target, ...Array.from(mutation.addedNodes)];
      return candidates.some((node) => {
        const el = node instanceof HTMLElement
          ? node
          : node.parentElement instanceof HTMLElement
            ? node.parentElement
            : null;
        if (!el) return false;
        if (this.isCalendarBaseEmbedElement(el)) return false;
        return !!el.closest([
          '.hover-popover',
          '.popover.hover-popover',
          '.markdown-hover-popover',
          '.bases-hover-popover',
          '.bases-preview',
          '.bases-table-cell-popover',
          '.metadata-container',
          '.metadata-properties',
        ].join(', '));
      });
    };

    this.basesPreviewPropertiesObserver = new MutationObserver((mutations) => {
      if (mutations.some(isRelevantPreviewMutation)) {
        scheduleRefreshBurst(false);
      }
    });
    this.basesPreviewPropertiesObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    this.registerEvent(this.app.metadataCache.on('changed', () => scheduleRefreshBurst(true)));
    this.registerEvent(this.app.vault.on('create', () => scheduleRefreshBurst(true)));
    this.registerEvent(this.app.vault.on('modify', () => scheduleRefreshBurst(true)));
    this.app.workspace.onLayoutReady(() => scheduleRefreshBurst(false));
  }

  /** Rebuilds non-leaf stacked property panels after an interactive rule change. */
  public refreshCustomPropertyPreviewSurfaces(): void {
    this.refreshBasesPreviewProperties(true);
  }

  private refreshBasesPreviewProperties(force = false): void {
    if (this.settings.showCustomPropertiesUnderTitle !== true) return;
    if (this.settings.showCustomPropertiesInInlineUi === false) return;
    if (!this.menuController?.getPanelBuilder) return;

    const roots = new Set<HTMLElement>();
    document
      .querySelectorAll<HTMLElement>('.hover-popover, .popover.hover-popover, .markdown-hover-popover, .bases-hover-popover, .bases-preview, .bases-table-cell-popover')
      .forEach((root) => {
        if (root.closest('.tps-gcm-base-link-preview, .tps-gcm-hover-editor-note-scale')) return;
        roots.add(root);
      });
    document
      .querySelectorAll<HTMLElement>('.metadata-container, .metadata-properties')
      .forEach((metadata) => {
        if (metadata.closest('.tps-gcm-base-link-preview, .tps-gcm-hover-editor-note-scale')) return;
        if (this.isCalendarBaseEmbedElement(metadata)) return;
        const root =
          metadata.closest<HTMLElement>('.hover-popover, .popover.hover-popover, .markdown-hover-popover, .bases-hover-popover, .bases-preview, .bases-table-cell-popover')
          || metadata.closest<HTMLElement>('.markdown-preview-view, .markdown-rendered, .markdown-embed-content')
          || metadata.parentElement;
        if (root && this.isCalendarBaseEmbedElement(root)) return;
        if (root && !root.closest('.workspace-leaf-content[data-type="markdown"]')) roots.add(root);
      });

    for (const root of roots) {
      if (this.isCalendarBaseEmbedElement(root)) continue;
      try {
        this.enhanceBasesPreviewProperties(root, force);
      } catch (error) {
        logger.warn('[TPS GCM] Failed refreshing one Bases/hover preview property panel', { error });
      }
    }
  }

  private isCalendarBaseEmbedElement(element: HTMLElement | null | undefined): boolean {
    if (!element) return false;
    const selector = [
      '.tps-calendar-base-embed',
      '.bases-calendar-scroll',
      '.bases-calendar-container',
      '.bases-calendar-wrapper',
      '.fc.fc-media-screen',
    ].join(', ');
    return element.matches(selector) || !!element.closest(selector) || !!element.querySelector(selector);
  }

  private sanitizeNativePreviewMetadataRows(root: HTMLElement): void {
    if (this.isCalendarBaseEmbedElement(root)) return;
    const metadataRows = root.querySelectorAll<HTMLElement>('.metadata-property, .metadata-property-container');
    if (metadataRows.length === 0) return;

    root.classList.add('tps-gcm-native-preview-properties-active');
    metadataRows.forEach((row) => {
      const key = this.readNativePreviewPropertyRowKey(row).toLowerCase();
      if (NATIVE_PROPERTIES_ALWAYS_HIDDEN.has(key)) {
        row.classList.add('tps-gcm-native-property-hidden');
      }
    });
  }

  private enhanceBasesPreviewProperties(root: HTMLElement, force = false): void {
    if (root.closest('.tps-gcm-base-link-preview') || root.matches('.tps-gcm-base-link-preview')) return;
    if (root.closest('.tps-gcm-hover-editor-note-scale') || root.matches('.tps-gcm-hover-editor-note-scale')) return;
    if (this.isCalendarBaseEmbedElement(root)) return;
    const preview = root.querySelector<HTMLElement>('.markdown-preview-view, .markdown-rendered, .markdown-embed-content')
      || root.querySelector<HTMLElement>('.metadata-container, .metadata-properties')?.closest<HTMLElement>('.markdown-preview-view, .markdown-rendered, .markdown-embed-content')
      || root;
    if (!preview) return;
    if (preview.closest('.tps-gcm-base-link-preview')) return;
    if (preview.closest('.tps-gcm-hover-editor-note-scale')) return;
    if (this.isCalendarBaseEmbedElement(preview)) return;
    if (preview.closest('.markdown-source-view, .cm-editor')) return;

    const file = this.resolveMarkdownFileFromPreview(root, preview);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') {
      logger.debug('[TPS GCM] Could not resolve file for Bases preview properties', {
        rootClasses: root.className,
        title: this.readPreviewTitle(root, preview),
      });
      return;
    }

    const metadata = preview.querySelector<HTMLElement>('.metadata-container, .metadata-properties')
      || root.querySelector<HTMLElement>('.metadata-container, .metadata-properties');

    const existing = root.querySelector<HTMLElement>('.tps-gcm-bases-preview-properties');
    const signature = this.getPreviewPropertiesSignature(file);
    const existingIsCurrent =
      !!existing &&
      root.dataset.tpsGcmPreviewPropertiesPath === file.path &&
      existing.dataset.tpsGcmPreviewPropertiesSignature === signature;
    if (shouldReuseCustomPropertyPreviewPanel({
      hasExistingPanel: !!existing,
      isCurrentSignature: existingIsCurrent,
      isCurrentPath: root.dataset.tpsGcmPreviewPropertiesPath === file.path,
      force,
    })) {
      if (metadata && !metadata.contains(existing) && !metadata.closest('.markdown-source-view, .cm-editor')) {
        metadata.classList.add('tps-gcm-bases-preview-metadata-host');
        metadata.empty();
        metadata.appendChild(existing);
      }
      this.removeLateNativePreviewMetadata(root, existing);
      return;
    }
    existing?.remove();

    const panel = this.menuController.getPanelBuilder().createStackedPropertiesPanel(file);
    if (!panel) return;

    panel.classList.add('tps-gcm-bases-preview-properties');
    panel.dataset.tpsGcmPreviewPropertiesSignature = signature;
    root.dataset.tpsGcmPreviewPropertiesPath = file.path;
    root.classList.add('tps-gcm-bases-preview-properties-active');

    if (metadata) {
      if (metadata.closest('.markdown-source-view, .cm-editor')) return;
      metadata.classList.add('tps-gcm-bases-preview-metadata-host');
      metadata.empty();
      metadata.appendChild(panel);
      this.removeLateNativePreviewMetadata(root, panel);
      return;
    }

    const title = preview.querySelector<HTMLElement>('.inline-title, h1, .markdown-preview-section > h1');
    if (title?.parentElement) {
      title.parentElement.insertBefore(panel, title.nextSibling);
      this.removeLateNativePreviewMetadata(root, panel);
      return;
    }

    preview.prepend(panel);
    this.removeLateNativePreviewMetadata(root, panel);
  }

  private getPreviewPropertiesSignature(file: TFile): string {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const propertyKeys = (this.settings.properties || [])
      .filter((property) => property && property.showInCollapsed !== false)
      .map((property) => String(property.key || property.id || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const values: Record<string, unknown> = {};
    for (const key of propertyKeys) {
      values[key] = (frontmatter as Record<string, unknown>)[key];
    }
    return JSON.stringify(values);
  }

  private applyNativePreviewPropertyVisibility(root: HTMLElement, file: TFile, isNativeHoverPopover: boolean): void {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const entries = [{ file, frontmatter }];
    const configuredKeys = new Set<string>();
    for (const property of this.settings.properties || []) {
      const key = String(property?.key || '').trim().toLowerCase();
      if (key) configuredKeys.add(key);
    }

    const visibleKeys = new Set(
      resolveCustomProperties(this.settings.properties || [], entries, new ViewModeService(), 'inline')
        .filter((property) => property && property.showInCollapsed !== false)
        .map((property) => String(property?.key || '').trim().toLowerCase())
        .filter(Boolean),
    );

    root.classList.add('tps-gcm-native-preview-properties-active');
    root.classList.toggle('tps-gcm-native-hover-properties-active', isNativeHoverPopover);
    root.dataset.tpsGcmPreviewPropertiesPath = file.path;

    root.querySelectorAll<HTMLElement>('.metadata-property, .metadata-property-container').forEach((row) => {
      const key = this.readNativePreviewPropertyRowKey(row).toLowerCase();
      const shouldHide =
        !key ||
        NATIVE_PROPERTIES_ALWAYS_HIDDEN.has(key) ||
        !configuredKeys.has(key) ||
        !visibleKeys.has(key);
      row.classList.toggle('tps-gcm-native-property-hidden', shouldHide);
    });
  }

  private readNativePreviewPropertyRowKey(row: HTMLElement): string {
    return String(
      row.dataset.propertyKey
      || row.dataset.propertyName
      || row.getAttribute('data-property-key')
      || row.getAttribute('data-property-name')
      || row.querySelector<HTMLElement>('[data-property-key]')?.dataset.propertyKey
      || row.querySelector<HTMLElement>('[data-property-name]')?.dataset.propertyName
      || row.querySelector<HTMLElement>('.metadata-property-key, .metadata-property-key-input')?.textContent
      || '',
    ).trim();
  }

  private getPreviewFileDisplayTitle(file: TFile): string {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const title = String(frontmatter?.title ?? '').trim();
    return title || file.basename;
  }

  private removeLateNativePreviewMetadata(root: HTMLElement, panel: HTMLElement): void {
    if (this.isCalendarBaseEmbedElement(root)) return;
    root
      .querySelectorAll<HTMLElement>('.metadata-container, .metadata-properties')
      .forEach((metadata) => {
        if (metadata.contains(panel)) return;
        if (metadata.closest('.markdown-source-view, .cm-editor')) return;
        if (metadata.closest('.workspace-leaf-content[data-type="markdown"]')) return;
        if (this.isCalendarBaseEmbedElement(metadata)) return;
        metadata.classList.add('tps-gcm-bases-preview-metadata-host');
        metadata.empty();
      });
  }

  private resolveMarkdownFileFromPreview(root: HTMLElement, preview: HTMLElement): TFile | null {
    const directPath = this.readFilePathFromPreviewElement(preview)
      || this.readFilePathFromPreviewElement(root)
      || this.readFilePathFromPreviewElement(root.querySelector<HTMLElement>('[data-path], [data-file], [data-file-path], [data-filepath], [data-linkpath], [data-href]'));

    const byPath = this.resolveMarkdownFilePath(directPath);
    if (byPath) return byPath;

    const titleText = this.readPreviewTitle(root, preview);
    if (!titleText) return null;

    const byLink = this.app.metadataCache.getFirstLinkpathDest(titleText, '');
    if (byLink instanceof TFile && byLink.extension.toLowerCase() === 'md') return byLink;

    const byTitle = this.resolveMarkdownFileByTitle(titleText);
    if (byTitle) return byTitle;

    const recentByTitle = this.resolveRecentMarkdownFileByTitle(titleText);
    if (recentByTitle) return recentByTitle;

    return null;
  }

  private readPreviewTitle(root: HTMLElement, preview: HTMLElement): string {
    const directTitle = (
      preview.querySelector<HTMLElement>('.inline-title')?.textContent
      || preview.querySelector<HTMLElement>('h1')?.textContent
      || root.querySelector<HTMLElement>('.popover-title')?.textContent
      || root.querySelector<HTMLElement>('.markdown-preview-title')?.textContent
      || ''
    ).trim();
    if (directTitle) return directTitle;

    const titleRow = Array.from(root.querySelectorAll<HTMLElement>('.metadata-property, .metadata-property-container'))
      .find((row) => {
        const key = (
          row.querySelector<HTMLElement>('.metadata-property-key, .metadata-property-key-input, [data-property-key]')?.textContent
          || row.getAttribute('data-property-key')
          || ''
        ).trim().toLowerCase();
        return key === 'title';
      });
    return (
      titleRow?.querySelector<HTMLElement>('.metadata-property-value, .metadata-property-value-input')?.textContent
      || ''
    ).trim();
  }

  private readFilePathFromPreviewElement(element: HTMLElement | null): string {
    if (!element) return '';
    return (
      element.dataset.path
      || element.dataset.src
      || element.dataset.file
      || (element.dataset as Record<string, string | undefined>).filePath
      || (element.dataset as Record<string, string | undefined>).filepath
      || element.dataset.linkpath
      || element.dataset.href
      || element.dataset.url
      || element.getAttribute('data-path')
      || element.getAttribute('data-src')
      || element.getAttribute('data-file')
      || element.getAttribute('data-file-path')
      || element.getAttribute('data-filepath')
      || element.getAttribute('data-linkpath')
      || element.getAttribute('data-href')
      || element.getAttribute('data-url')
      || ''
    );
  }

  private resolveMarkdownFilePath(pathLike: string | null | undefined): TFile | null {
    const raw = String(pathLike || '').trim();
    if (!raw) return null;

    const direct = this.app.vault.getAbstractFileByPath(raw);
    if (this.isOrdinaryMarkdownFile(direct)) return direct;

    const withMd = raw.toLowerCase().endsWith('.md') ? raw : `${raw}.md`;
    const mdFile = this.app.vault.getAbstractFileByPath(withMd);
    if (this.isOrdinaryMarkdownFile(mdFile)) return mdFile;

    const linkTarget = this.app.metadataCache.getFirstLinkpathDest(raw.replace(/\.md$/i, ''), '');
    return this.isOrdinaryMarkdownFile(linkTarget)
      ? linkTarget
      : null;
  }

  private resolveMarkdownFileByTitle(title: string): TFile | null {
    const normalizedTitle = title.trim().toLowerCase();
    if (!normalizedTitle) return null;

    return this.app.vault.getMarkdownFiles()
      .filter((file) => {
        if (!this.isOrdinaryMarkdownFile(file)) return false;
        if (file.basename.trim().toLowerCase() === normalizedTitle) return true;
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const fmTitle = String(frontmatter?.title ?? '').trim().toLowerCase();
        return fmTitle === normalizedTitle;
      })
      .sort((a, b) => b.stat.mtime - a.stat.mtime)[0] ?? null;
  }

  private resolveRecentMarkdownFileByTitle(title: string): TFile | null {
    const normalizedTitle = title.trim().toLowerCase();
    if (!normalizedTitle) return null;

    const candidates = this.app.vault.getMarkdownFiles()
      .filter((file) => {
        if (!this.isOrdinaryMarkdownFile(file)) return false;
        const fmTitle = String(this.app.metadataCache.getFileCache(file)?.frontmatter?.title ?? '').trim().toLowerCase();
        return file.basename.trim().toLowerCase() === normalizedTitle || fmTitle === normalizedTitle;
      })
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    return candidates[0] ?? null;
  }

  onunload(): void {
    if (this.basesPreviewPropertiesRefreshTimer !== null) {
      window.clearTimeout(this.basesPreviewPropertiesRefreshTimer);
      this.basesPreviewPropertiesRefreshTimer = null;
    }
    for (const timer of this.basesPreviewPropertiesRetryTimers) {
      window.clearTimeout(timer);
    }
    this.basesPreviewPropertiesRetryTimers = [];
    this.basesPreviewPropertiesObserver?.disconnect();
    this.basesPreviewPropertiesObserver = null;
    this.closeBaseLinkHoverEditor(getPluginById(this.app, 'obsidian-hover-editor') as any);
    this.tpsNotebookNavigatorMenuBridge?.stop();
    this.workspaceRibbonService?.teardown();
    delete (this as any).api;
    this.emitGcmApiChanged(false);
    if (this.restoreCanvasOpenGuard) {
      this.restoreCanvasOpenGuard();
      this.restoreCanvasOpenGuard = null;
    }
    if (this.restoreMenuPatch) {
      this.restoreMenuPatch();
      this.restoreMenuPatch = null;
    }
    this.menuController?.detach();
    this.removeStyles();
    this.removeLegacyNotebookNavigatorRuleSettingsStyles();
    this.persistentMenuManager?.detach();
    this.recurrenceService?.cleanup();
    this.timeTrackingStatusBarService?.detach();
    this.taskLineDragService?.dispose();
    this.taskCheckboxHandler?.dispose();
    this.taskLineContextMenuService?.dispose();
    this.itemHistoryService?.dispose();
    this.linkedSubitemCheckboxService?.detach();
    this.hideCompletedCheckboxesService?.detach();
    this.notebookNavigatorRuleService?.dispose();
    this.stopArchiveTagAutomation();
    document.body?.classList?.remove('tps-context-hidden-for-keyboard');
  }

  private reconcilePersistedSettings(
    requested: SettingsRecord,
    persisted: SettingsRecord,
  ): void {
    reconcilePersistedSettingsInPlace(
      this.settings as unknown as SettingsRecord,
      requested,
      persisted,
    );
  }

  private ensureSettingsPersistence(initialBaseline?: SettingsRecord): SettingsPersistenceCoordinator {
    if (!this.settingsPersistence) {
      this.settingsPersistence = new SettingsPersistenceCoordinator(
        async () => (await this.loadData()) as SettingsRecord | null,
        async (settings) => this.saveData(settings),
        (requested, persisted) => this.reconcilePersistedSettings(requested, persisted),
      );
      this.settingsPersistence.setBaseline(
        initialBaseline ?? this.settings as unknown as SettingsRecord,
      );
    }
    return this.settingsPersistence;
  }

  private persistSettingsSnapshot(): Promise<void> {
    return this.ensureSettingsPersistence().request(this.settings as unknown as SettingsRecord);
  }

  async persistRuntimeSettingsState(): Promise<void> {
    await this.persistSettingsSnapshot();
  }

  usesNativeRecordArchitecture(): boolean {
    return this.settings?.dataArchitectureMode === 'native-records';
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<TPSGlobalContextMenuSettings> & {
      enableShiftClickCancel?: boolean;
      archiveFolder?: string;
    } | null;
    const hadRetiredHomeCaptureHeadingSettings = Boolean(
      loaded && (
        Object.prototype.hasOwnProperty.call(loaded, 'homeCaptureAddHeading') ||
        Object.prototype.hasOwnProperty.call(loaded, 'homeCaptureHeading')
      ),
    );
    const needsActivityBasePathMigration = String(loaded?.homeWorkoutBasePath || '').trim().toLowerCase() === 'workout log.base';
    let notebookNavigatorRulePayload = this.resolveNotebookNavigatorRuleSettingsPayload(loaded);
    if (!notebookNavigatorRulePayload) {
      notebookNavigatorRulePayload = this.resolveNotebookNavigatorRuleSettingsPayload(
        await this.loadLegacyNotebookNavigatorCompanionSettings(),
      );
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
    this.settings.dataArchitectureMode = loaded?.dataArchitectureMode === 'native-records'
      ? 'native-records'
      : 'legacy';
    this.settings.nativeRecordRootPath = normalizeNativeRecordRoot(
      loaded?.nativeRecordRootPath ?? DEFAULT_SETTINGS.nativeRecordRootPath,
    );
    this.settings.nativeRecordLayout = normalizeNativeRecordLayout(loaded?.nativeRecordLayout);
    this.settings.templateIdentificationMode = loaded?.templateIdentificationMode === 'tag'
      || loaded?.templateIdentificationMode === 'property'
      ? loaded.templateIdentificationMode
      : 'templater-folder';
    this.settings.templateIdentificationTag = String(
      loaded?.templateIdentificationTag ?? DEFAULT_SETTINGS.templateIdentificationTag,
    ).trim().replace(/^#+/, '');
    this.settings.templateIdentificationPropertyKey = String(
      loaded?.templateIdentificationPropertyKey ?? DEFAULT_SETTINGS.templateIdentificationPropertyKey,
    ).trim();
    this.settings.templateIdentificationPropertyValue = String(
      loaded?.templateIdentificationPropertyValue ?? DEFAULT_SETTINGS.templateIdentificationPropertyValue,
    ).trim();
    this.settings.templateIdentificationPropertyMatch = loaded?.templateIdentificationPropertyMatch === 'contains'
      ? 'contains'
      : 'equals';
    const preNormalizationSettings = JSON.parse(JSON.stringify(this.settings)) as SettingsRecord;
    const loadedSettingsRecord = (loaded ?? {}) as SettingsRecord;
    for (const key of AUTHORITATIVE_HOME_SETTING_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(loadedSettingsRecord, key)) {
        delete preNormalizationSettings[key];
      }
    }
    this.stripLegacySettingsFields(this.settings as unknown as Record<string, unknown>);
    const normalizedProperties = this.normalizeCustomProperties(this.settings.properties);
    this.settings.properties = this.removeRetiredBundledCustomProperties(normalizedProperties);
    const removedRetiredPropertyCount = normalizedProperties.length - this.settings.properties.length;
    this.settings.enableVirtualBaseEmbeds = this.settings.enableVirtualBaseEmbeds !== false;
    this.settings.virtualBaseEmbedProperties = this.normalizeVirtualBaseEmbedProperties(this.settings.virtualBaseEmbedProperties);
    if (
      typeof loaded?.applyNotebookNavigatorRulesOnSubitemCreate !== 'boolean' &&
      typeof (loaded as Record<string, unknown> | null | undefined)?.applyCompanionRulesOnSubitemCreate === 'boolean'
    ) {
      this.settings.applyNotebookNavigatorRulesOnSubitemCreate = Boolean(
        (loaded as Record<string, unknown>).applyCompanionRulesOnSubitemCreate,
      );
    }
    this.settings.notebookNavigatorRules = sanitizeNotebookNavigatorRuleSettings(
      notebookNavigatorRulePayload ?? DEFAULT_SETTINGS.notebookNavigatorRules,
    );
    if (!this.settings.workspaceRibbonIcons || typeof this.settings.workspaceRibbonIcons !== 'object') {
      this.settings.workspaceRibbonIcons = {};
    }
    const legacyArchiveFolder = typeof loaded?.archiveFolder === 'string' ? loaded.archiveFolder.trim() : '';
    if (!this.settings.archiveFolderPath && legacyArchiveFolder) {
      this.settings.archiveFolderPath = legacyArchiveFolder;
    }
    if (
      this.settings.checklistPromotionBehavior !== 'remove' &&
      this.settings.checklistPromotionBehavior !== 'complete-and-link' &&
      this.settings.checklistPromotionBehavior !== 'link-only'
    ) {
      this.settings.checklistPromotionBehavior = DEFAULT_SETTINGS.checklistPromotionBehavior;
    }
    if (
      this.settings.dailyNoteTaskMoveSourceBehavior !== 'mark-migrated'
      && this.settings.dailyNoteTaskMoveSourceBehavior !== 'remove'
    ) {
      this.settings.dailyNoteTaskMoveSourceBehavior = DEFAULT_SETTINGS.dailyNoteTaskMoveSourceBehavior;
    }
    this.settings.enableItemHistory = this.settings.enableItemHistory !== false;
    const itemHistoryRetentionDays = Number(this.settings.itemHistoryRetentionDays);
    this.settings.itemHistoryRetentionDays = Number.isFinite(itemHistoryRetentionDays)
      ? Math.min(365, Math.max(1, Math.floor(itemHistoryRetentionDays)))
      : DEFAULT_SETTINGS.itemHistoryRetentionDays;
    const itemHistoryMaxEntries = Number(this.settings.itemHistoryMaxEntries);
    this.settings.itemHistoryMaxEntries = Number.isFinite(itemHistoryMaxEntries)
      ? Math.min(25000, Math.max(100, Math.floor(itemHistoryMaxEntries)))
      : DEFAULT_SETTINGS.itemHistoryMaxEntries;
    if (this.settings.topParentNavPlacement !== 'top' && this.settings.topParentNavPlacement !== 'bottom') {
      this.settings.topParentNavPlacement = DEFAULT_SETTINGS.topParentNavPlacement;
    }
    if (this.settings.linkedContextPlacement !== 'top' && this.settings.linkedContextPlacement !== 'bottom') {
      this.settings.linkedContextPlacement = DEFAULT_SETTINGS.linkedContextPlacement;
    }
    if (!['same-tab', 'new-tab', 'hover-preview'].includes(this.settings.linkedContextOpenBehavior)) {
      this.settings.linkedContextOpenBehavior = DEFAULT_SETTINGS.linkedContextOpenBehavior;
    }
    this.settings.linkedContextSortOrder = this.settings.linkedContextSortOrder === 'source-desc'
      ? 'source-desc'
      : 'source-asc';
    this.settings.parentLinkFormat = normalizeParentLinkFormat(this.settings.parentLinkFormat);
    this.settings.enableParentChildIgnoreRule = this.settings.enableParentChildIgnoreRule === true;
    this.settings.parentChildIgnoreFrontmatterKey = String(this.settings.parentChildIgnoreFrontmatterKey ?? '').trim();
    this.settings.parentChildIgnoreFrontmatterValue = String(this.settings.parentChildIgnoreFrontmatterValue ?? '').trim();
    this.settings.enableBasesForcedLinkPreview = this.settings.enableBasesForcedLinkPreview === true;
    this.settings.collapseHeadingsOnOpen = this.settings.collapseHeadingsOnOpen === true;
    this.settings.enableDailyNoteHome = this.settings.enableDailyNoteHome !== false;
    this.settings.homeComponents = this.normalizeHomeComponents(this.settings.homeComponents);
    this.settings.homeComponentLayouts = this.normalizeHomeComponentLayouts(this.settings.homeComponentLayouts);
    this.settings.homeComponentActions = normalizeHomeComponentActions(this.settings.homeComponentActions);
    this.settings.homeCalendarBasePath =
      typeof this.settings.homeCalendarBasePath === 'string' && this.settings.homeCalendarBasePath.trim()
        ? normalizePath(this.settings.homeCalendarBasePath.trim())
        : DEFAULT_SETTINGS.homeCalendarBasePath;
    this.settings.homeFoodBasePath =
      typeof this.settings.homeFoodBasePath === 'string' && this.settings.homeFoodBasePath.trim()
        ? normalizePath(this.settings.homeFoodBasePath.trim())
        : DEFAULT_SETTINGS.homeFoodBasePath;
    const configuredActivityBasePath = typeof this.settings.homeWorkoutBasePath === 'string'
      ? normalizePath(this.settings.homeWorkoutBasePath.trim())
      : '';
    this.settings.homeWorkoutBasePath = !configuredActivityBasePath || configuredActivityBasePath.toLowerCase() === 'workout log.base'
      ? DEFAULT_SETTINGS.homeWorkoutBasePath
      : configuredActivityBasePath;
    this.settings.homeOpenTasksBasePath =
      typeof this.settings.homeOpenTasksBasePath === 'string' && this.settings.homeOpenTasksBasePath.trim()
        ? normalizePath(this.settings.homeOpenTasksBasePath.trim())
        : DEFAULT_SETTINGS.homeOpenTasksBasePath;
    this.settings.homeCaptureInsertPosition =
      this.settings.homeCaptureInsertPosition === 'top' ? 'top' : 'bottom';
    this.settings.hideCompletedCheckboxes = this.settings.hideCompletedCheckboxes === true;
    this.settings.completedTaskHidingScope = this.settings.completedTaskHidingScope === 'reading-only'
      ? 'reading-only'
      : 'reading-and-live-preview';
    this.settings.hideAllTaskLinesInReadingMode = this.settings.hideAllTaskLinesInReadingMode === true;
    this.settings.taskHidingExclusionPatterns = String(this.settings.taskHidingExclusionPatterns ?? '').trim();
    this.settings.persistTaskVisibilityStateToFrontmatter = this.settings.persistTaskVisibilityStateToFrontmatter === true;
    this.settings.taskVisibilityStateFrontmatterKey = String(this.settings.taskVisibilityStateFrontmatterKey || DEFAULT_SETTINGS.taskVisibilityStateFrontmatterKey).trim() || DEFAULT_SETTINGS.taskVisibilityStateFrontmatterKey;
    this.settings.tpsBaseWriteFallbackMode = normalizeTpsBaseWriteFallbackMode(this.settings.tpsBaseWriteFallbackMode);
    this.settings.tpsBaseWriteFallbackPath = normalizeTpsBaseWriteNotePath(this.settings.tpsBaseWriteFallbackPath) || '';
    this.settings.defaultStackedPropertiesClosed = this.settings.defaultStackedPropertiesClosed === true;
    this.settings.timeTrackingPropertyKey = String(this.settings.timeTrackingPropertyKey || 'timeTracking').trim() || 'timeTracking';
    if (this.settings.timeTrackingPropertyKey.toLowerCase() === 'scheduled') {
      this.settings.timeTrackingPropertyKey = DEFAULT_SETTINGS.timeTrackingPropertyKey;
    }
    if (
      this.settings.timeTrackingStorageMode !== 'daily-note' &&
      this.settings.timeTrackingStorageMode !== 'source-note' &&
      this.settings.timeTrackingStorageMode !== 'dedicated-note'
    ) {
      this.settings.timeTrackingStorageMode = DEFAULT_SETTINGS.timeTrackingStorageMode;
    }
    this.settings.timeTrackingDedicatedNotePath =
      String(this.settings.timeTrackingDedicatedNotePath || 'Time Tracking.md').trim() || 'Time Tracking.md';
    this.settings.timeTrackingDailyNoteHeading =
      String(this.settings.timeTrackingDailyNoteHeading || DEFAULT_SETTINGS.timeTrackingDailyNoteHeading)
        .replace(/[\r\n]+/g, ' ')
        .replace(/^\s*#{1,6}\s*/, '')
        .trim()
      || DEFAULT_SETTINGS.timeTrackingDailyNoteHeading;
    this.settings.timeTrackingDailyNotePlacement =
      this.settings.timeTrackingDailyNotePlacement === 'bottom' ? 'bottom' : 'top';
    this.settings.timeTrackingSingleActiveSession = this.settings.timeTrackingSingleActiveSession !== false;
    this.settings.timeTrackingIgnoreArchivedFiles = this.settings.timeTrackingIgnoreArchivedFiles !== false;
    this.settings.activityLogPropertyKey = String(this.settings.activityLogPropertyKey || 'activity').trim() || 'activity';
    this.settings.activityLogTrackedProperties = String(
      this.settings.activityLogTrackedProperties ?? DEFAULT_SETTINGS.activityLogTrackedProperties,
    ).trim();
    const activityMax = Number(this.settings.activityLogMaxEntries);
    this.settings.activityLogMaxEntries = Number.isFinite(activityMax) && activityMax > 0 ? Math.floor(activityMax) : DEFAULT_SETTINGS.activityLogMaxEntries;
    const legacyUnchecked = Array.isArray(loaded?.linkedSubitemUncheckedStatuses)
      ? loaded?.linkedSubitemUncheckedStatuses.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const legacyChecked = Array.isArray(loaded?.linkedSubitemCheckedStatuses)
      ? loaded?.linkedSubitemCheckedStatuses.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const legacyCanceled = Array.isArray(loaded?.linkedSubitemCanceledStatuses)
      ? loaded?.linkedSubitemCanceledStatuses.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const hasPersistedMappings = Object.prototype.hasOwnProperty.call(
      loadedSettingsRecord,
      'linkedSubitemCheckboxMappings',
    );
    const persistedMappings = Array.isArray(loaded?.linkedSubitemCheckboxMappings)
      ? loaded.linkedSubitemCheckboxMappings
      : [];
    const hasLegacyMappingSettings = [
      'linkedSubitemUncheckedStatuses',
      'linkedSubitemCheckedStatuses',
      'linkedSubitemCanceledStatuses',
      'linkedSubitemToggleCheckedStatus',
      'linkedSubitemToggleUncheckedStatus',
    ].some((key) => Object.prototype.hasOwnProperty.call(loadedSettingsRecord, key));
    const mappingSource = persistedMappings.length > 0
      ? persistedMappings
      : hasLegacyMappingSettings
        ? [
        {
          checkboxState: '[ ]',
          statuses: legacyUnchecked.length > 0 ? legacyUnchecked : ['todo'],
          toggleTargetStatus: String(loaded?.linkedSubitemToggleCheckedStatus || 'complete').trim() || 'complete',
          icon: 'square',
          label: 'Todo',
        },
        {
          checkboxState: '[x]',
          statuses: legacyChecked.length > 0 ? legacyChecked : ['complete'],
          toggleTargetStatus: String(loaded?.linkedSubitemToggleUncheckedStatus || 'todo').trim() || 'todo',
          icon: 'check',
          label: 'Complete',
        },
        {
          checkboxState: '[-]',
          statuses: legacyCanceled.length > 0 ? legacyCanceled : ['wont-do'],
          toggleTargetStatus: String(loaded?.linkedSubitemToggleUncheckedStatus || 'todo').trim() || 'todo',
          icon: 'minus',
          label: 'Won’t Do',
        },
      ]
        : DEFAULT_SETTINGS.linkedSubitemCheckboxMappings;
    this.settings.linkedSubitemCheckboxMappings = normalizeLinkedSubitemMappings(mappingSource, {
      enforceStrictDefaults: true,
    });
    this.settings.linkedSubitemDefaultOpenState = normalizeLinkedSubitemCheckboxState(
      this.settings.linkedSubitemDefaultOpenState,
    ) || '[ ]';
    const needsCheckboxMappingMigration = Boolean(loaded) && (
      hasLegacyMappingSettings
      || (hasPersistedMappings && JSON.stringify(persistedMappings) !== JSON.stringify(this.settings.linkedSubitemCheckboxMappings))
      || (
        Object.prototype.hasOwnProperty.call(loadedSettingsRecord, 'linkedSubitemDefaultOpenState')
        && loaded?.linkedSubitemDefaultOpenState !== this.settings.linkedSubitemDefaultOpenState
      )
    );
    logger.setLoggingEnabled(this.settings.enableLogging);
    const propertyKeyDiagnostics = collectPropertyKeyDiagnostics(this.settings.properties);
    if (propertyKeyDiagnostics.length > 0) {
      logger.flowWarn('Settings', 'custom-property-keys:invalid', {
        blankCount: propertyKeyDiagnostics.filter((diagnostic) => diagnostic.code === 'blank').length,
        duplicateKeys: Array.from(new Set(
          propertyKeyDiagnostics
            .filter((diagnostic) => diagnostic.code === 'duplicate')
            .map((diagnostic) => normalizePropertyKeyIdentity(diagnostic.key)),
        )),
        action: 'preserved-for-manual-repair',
      });
    }
    const normalizedAuthoritativeHomeSettingKeys = AUTHORITATIVE_HOME_SETTING_KEYS.filter((key) =>
      !Object.prototype.hasOwnProperty.call(loadedSettingsRecord, key)
      || loadedSettingsRecord[key] !== this.settings[key],
    );
    const needsSettingsMigration =
      hadRetiredHomeCaptureHeadingSettings ||
      needsActivityBasePathMigration ||
      needsCheckboxMappingMigration ||
      normalizedAuthoritativeHomeSettingKeys.length > 0 ||
      removedRetiredPropertyCount > 0;
    this.settingsPersistence = null;
    this.ensureSettingsPersistence(
      needsSettingsMigration
        ? preNormalizationSettings
        : this.settings as unknown as SettingsRecord,
    );
    if (needsSettingsMigration) await this.persistSettingsSnapshot();
    if (hadRetiredHomeCaptureHeadingSettings) {
      logger.flow('Settings', 'migration:removed-home-capture-heading');
    }
    if (needsActivityBasePathMigration) {
      logger.flow('Settings', 'migration:activity-base-path');
    }
    if (needsCheckboxMappingMigration) {
      logger.flow('Settings', 'migration:checkbox-status-mappings', {
        count: this.settings.linkedSubitemCheckboxMappings.length,
      });
    }
    if (normalizedAuthoritativeHomeSettingKeys.length > 0) {
      logger.flow('Settings', 'migration:authoritative-home-settings', {
        count: normalizedAuthoritativeHomeSettingKeys.length,
      });
    }
    if (removedRetiredPropertyCount > 0) {
      logger.flow('Settings', 'migration:removed-retired-bundled-properties', {
        count: removedRetiredPropertyCount,
      });
    }
  }

  private normalizeHomeComponents(components: unknown): TPSGlobalContextMenuSettings['homeComponents'] {
    const allowed = new Set([
      'quick-capture',
      'calendar',
      'food-tracker',
      'workout-tracker',
      'open-unscheduled-tasks',
    ]);
    const source = Array.isArray(components) && components.length > 0
      ? components
      : DEFAULT_SETTINGS.homeComponents;
    const seen = new Set<string>();
    const normalized: TPSGlobalContextMenuSettings['homeComponents'] = [];
    for (const value of source) {
      let component: TPSGlobalContextMenuSettings['homeComponents'][number] | null = null;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === 'quick-capture') {
          component = { type: 'base', path: HOME_DAILY_NOTE_FEED_BASE_PATH };
        } else if (allowed.has(trimmed)) {
          component = trimmed as TPSGlobalContextMenuSettings['homeComponents'][number];
        } else if (trimmed.toLowerCase().endsWith('.base')) {
          component = { type: 'base', path: normalizePath(trimmed).replace(/^\/+/, '') };
        }
      } else if (
        value &&
        typeof value === 'object' &&
        (value as { type?: unknown }).type === 'base'
      ) {
        const path = normalizePath(String((value as { path?: unknown }).path || '').trim()).replace(/^\/+/, '');
        if (path) component = { type: 'base', path };
      } else if (
        value &&
        typeof value === 'object' &&
        (value as { type?: unknown }).type === 'command'
      ) {
        const commandId = String((value as { commandId?: unknown }).commandId || '').trim();
        const title = String((value as { title?: unknown }).title || '').trim();
        const icon = String((value as { icon?: unknown }).icon || '').trim();
        if (commandId) {
          component = {
            type: 'command',
            commandId,
            ...(title ? { title } : {}),
            ...(icon ? { icon } : {}),
          };
        }
      }
      if (!component) continue;
      const key = typeof component === 'string'
        ? component
        : component.type === 'base'
          ? `base:${component.path.toLowerCase()}`
          : `command:${component.commandId.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(component);
    }
    return normalized.length > 0 ? normalized : [...DEFAULT_SETTINGS.homeComponents];
  }

  private normalizeHomeComponentLayouts(value: unknown): TPSGlobalContextMenuSettings['homeComponentLayouts'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const normalized: TPSGlobalContextMenuSettings['homeComponentLayouts'] = {};
    for (const [rawKey, rawLayout] of Object.entries(value as Record<string, unknown>)) {
      const key = String(rawKey || '').trim();
      if (!key || !rawLayout || typeof rawLayout !== 'object' || Array.isArray(rawLayout)) continue;
      const source = rawLayout as Record<string, unknown>;
      const height = this.normalizeHomeLayoutNumber(source.height, 220, 1200);
      const capturePreviewHeight = this.normalizeHomeLayoutNumber(source.capturePreviewHeight, 120, 900);
      const span: 2 | undefined = Number(source.span) === 2 ? 2 : undefined;
      const layout: TPSGlobalContextMenuSettings['homeComponentLayouts'][string] = {
        ...(height != null ? { height } : {}),
        ...(span ? { span } : {}),
        ...(capturePreviewHeight != null ? { capturePreviewHeight } : {}),
      };
      if (Object.keys(layout).length > 0) normalized[key] = layout;
    }
    return normalized;
  }

  private normalizeHomeLayoutNumber(value: unknown, min: number, max: number): number | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.max(min, Math.min(max, Math.round(parsed)));
  }

  private normalizeCustomProperties(properties: unknown): TPSGlobalContextMenuSettings['properties'] {
    const source = Array.isArray(properties) ? properties : DEFAULT_SETTINGS.properties;
    return source.map((property) => {
      const normalized = { ...(property as TPSGlobalContextMenuSettings['properties'][number] & { profiles?: unknown }) };
      delete normalized.profiles;
      const normalizedKey = String(normalized.key || '').trim().toLowerCase();
      const normalizedId = String(normalized.id || '').trim().toLowerCase();
      const normalizedType = String(normalized.type || '').trim().toLowerCase();
      normalized.type = (
        (normalizedKey === 'kind' || normalizedId === 'kind') && normalizedType !== 'kind'
          ? 'kind'
          : CUSTOM_PROPERTY_TYPES.has(normalizedType)
            ? normalizedType
            : 'text'
      ) as TPSGlobalContextMenuSettings['properties'][number]['type'];
      if (
        normalized.id === 'type' &&
        normalized.key === 'folderPath' &&
        normalized.type === 'folder' &&
        normalized.label === 'Type'
      ) {
        normalized.label = 'Folder';
      }
      const acceptsKind = normalizeAcceptedKindSetting(normalized.acceptsKind);
      if (normalized.type === 'kind') {
        delete normalized.acceptsKind;
        normalized.allowInlineSet = false;
      } else if (acceptsKind) {
        normalized.acceptsKind = acceptsKind;
      } else {
        delete normalized.acceptsKind;
      }
      normalized.optionSources = normalizePropertyOptionSources(normalized);
      normalized.optionsSource = normalized.optionSources.includes('vault')
        ? 'vault'
        : 'manual';
      if (normalized.type === 'list') {
        normalized.listItemType = normalized.listItemType === 'text'
          ? 'text'
          : normalized.listItemType === 'link'
            ? 'link'
            : 'tag';
        if (
          normalized.acceptsKind
          && normalized.optionSources.length === 1
          && normalized.optionSources[0] === 'entity'
        ) {
          normalized.listItemType = 'link';
        }
      } else {
        delete normalized.listItemType;
      }
      if (normalized.allowInlineSet === undefined) {
        normalized.allowInlineSet = !DEFAULT_INLINE_PROPERTY_DENY_KEYS.has(String(normalized.key || '').trim().toLowerCase());
      }
      for (const key of ['scopeKinds', 'excludeKinds'] as const) {
        const values = Array.isArray(normalized[key])
          ? normalized[key]
          : String(normalized[key] || '').split(/[\n,]/u);
        const normalizedKinds = Array.from(new Set(values
          .map((value) => String(value || '').trim().toLocaleLowerCase())
          .filter(Boolean)));
        if (normalizedKinds.length > 0) normalized[key] = normalizedKinds;
        else delete normalized[key];
      }
      return normalized;
    });
  }

  private normalizeVirtualBaseEmbedProperties(properties: unknown): TPSGlobalContextMenuSettings['virtualBaseEmbedProperties'] {
    const source = Array.isArray(properties) && properties.length > 0
      ? properties
      : DEFAULT_SETTINGS.virtualBaseEmbedProperties;
    return source
      .map((entry) => ({
        key: String((entry as any)?.key || '').trim(),
        placement: (entry as any)?.placement,
      }))
      .filter((entry): entry is TPSGlobalContextMenuSettings['virtualBaseEmbedProperties'][number] =>
        !!entry.key && (entry.placement === 'top' || entry.placement === 'bottom' || entry.placement === 'hover'),
      );
  }

  private removeRetiredBundledCustomProperties(
    properties: TPSGlobalContextMenuSettings['properties'],
  ): TPSGlobalContextMenuSettings['properties'] {
    return (properties || []).filter((property) => {
      const id = String(property?.id || '').trim().toLowerCase();
      return !id.startsWith('tps-health-') && !LEGACY_HEALTH_CUSTOM_PROPERTY_IDS.has(id);
    });
  }

  private async loadLegacyNotebookNavigatorCompanionSettings(): Promise<unknown | null> {
    const adapter = this.app.vault.adapter;
    const candidatePaths = [
      '.obsidian/plugins/TPS-Notebook-Navigator-Companion (Dev)/data.json',
      '.obsidian/plugins/tps-notebook-navigator-companion/data.json',
    ];

    for (const path of candidatePaths) {
      try {
        if (!(await adapter.exists(path))) continue;
        const raw = await adapter.read(path);
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (error) {
        logger.warn('[TPS GCM] Failed reading legacy Notebook Navigator Companion rule settings', { path, error });
      }
    }

    const pluginsRegistry = (this.app as any)?.plugins;
    const companion =
      pluginsRegistry?.getPlugin?.('tps-notebook-navigator-companion') ||
      pluginsRegistry?.plugins?.['tps-notebook-navigator-companion'] ||
      pluginsRegistry?.getPlugin?.('TPS-Notebook-Navigator-Companion (Dev)') ||
      pluginsRegistry?.plugins?.['TPS-Notebook-Navigator-Companion (Dev)'];
    return companion?.settings ?? null;
  }

  private resolveNotebookNavigatorRuleSettingsPayload(raw: unknown): unknown | null {
    const record = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : null;
    if (!record) return null;

    const nested = record.notebookNavigatorRules;
    if (
      nested &&
      typeof nested === 'object' &&
      !Array.isArray(nested) &&
      (
        Object.prototype.hasOwnProperty.call(nested, 'rules') ||
        Object.prototype.hasOwnProperty.call(nested, 'smartSort') ||
        Object.prototype.hasOwnProperty.call(nested, 'hideRules') ||
        Object.prototype.hasOwnProperty.call(nested, 'frontmatterIconField')
      )
    ) {
      return nested;
    }

    const legacyRules = Array.isArray(nested) ? nested : record.rules;
    const hasLegacyPayload = Array.isArray(legacyRules) ||
      Array.isArray(record.notebookNavigatorHideRules) ||
      typeof record.notebookNavigatorSmartSort === 'object' ||
      typeof record.notebookNavigatorIconField === 'string' ||
      typeof record.frontmatterIconField === 'string' ||
      Array.isArray(record.hideRules) ||
      typeof record.smartSort === 'object';
    if (!hasLegacyPayload) return null;

    return {
      enabled: record.enabled,
      autoApplyOnFileOpen: record.autoApplyOnFileOpen,
      autoApplyOnMetadataChange: record.autoApplyOnMetadataChange,
      applyOnStartup: record.applyOnStartup,
      startupDelayMs: record.startupDelayMs,
      metadataDebounceMs: record.metadataDebounceMs,
      frontmatterIconField: record.frontmatterIconField ?? record.notebookNavigatorIconField,
      frontmatterColorField: record.frontmatterColorField ?? record.notebookNavigatorColorField,
      frontmatterWriteExclusions: record.frontmatterWriteExclusions ?? record.notebookNavigatorFrontmatterWriteExclusions,
      clearIconWhenNoMatch: record.clearIconWhenNoMatch ?? record.notebookNavigatorClearIconWhenNoMatch,
      clearColorWhenNoMatch: record.clearColorWhenNoMatch ?? record.notebookNavigatorClearColorWhenNoMatch,
      autoRemoveHiddenWhenNoMatch: record.autoRemoveHiddenWhenNoMatch ?? record.notebookNavigatorAutoRemoveHiddenWhenNoMatch,
      rules: legacyRules,
      smartSort: this.resolveLegacyNotebookNavigatorSmartSort(record),
      hideRules: record.hideRules ?? record.notebookNavigatorHideRules,
    };
  }

  private resolveLegacyNotebookNavigatorSmartSort(record: Record<string, unknown>): unknown {
    const nestedSmartSort = record.smartSort;
    if (nestedSmartSort && typeof nestedSmartSort === 'object' && !Array.isArray(nestedSmartSort)) {
      return nestedSmartSort;
    }

    const legacySmartSort = record.notebookNavigatorSmartSort;
    if (Array.isArray(legacySmartSort)) {
      return { buckets: legacySmartSort };
    }

    return legacySmartSort;
  }

  private stripLegacySettingsFields(record: Record<string, unknown>): void {
    delete record.enableShiftClickCancel;
    delete record.archiveFolder;
    delete record.rules;
    delete record.smartSort;
    delete record.hideRules;
    delete record.enabled;
    delete record.autoApplyOnFileOpen;
    delete record.autoApplyOnMetadataChange;
    delete record.applyOnStartup;
    delete record.startupDelayMs;
    delete record.metadataDebounceMs;
    delete record.frontmatterIconField;
    delete record.frontmatterColorField;
    delete record.frontmatterWriteExclusions;
    delete record.clearIconWhenNoMatch;
    delete record.clearColorWhenNoMatch;
    delete record.autoRemoveHiddenWhenNoMatch;
    delete record.notebookNavigatorHideRules;
    delete record.notebookNavigatorSmartSort;
    delete record.notebookNavigatorIconField;
    delete record.notebookNavigatorColorField;
    delete record.notebookNavigatorFrontmatterWriteExclusions;
    delete record.notebookNavigatorClearIconWhenNoMatch;
    delete record.notebookNavigatorClearColorWhenNoMatch;
    delete record.notebookNavigatorAutoRemoveHiddenWhenNoMatch;
    delete record.enableTypeProfiles;
    delete record.autoCreateTypeTemplates;
    delete record.typeTemplateFolderPath;
    delete record.typeTemplateIgnoreFolders;
    delete record.typeSystemLimits;
    delete record.defaultSubtypePropertyKey;
    delete record.subtypeTemplateTag;
    delete record.homeCaptureAddHeading;
    delete record.homeCaptureHeading;
  }

  createDefaultRule(): IconColorRule {
    return createDefaultRule();
  }

  createDefaultSortBucket() {
    return createDefaultSortBucket();
  }

  createDefaultSortSegment() {
    return createDefaultSortSegment();
  }

  createDefaultHideRule(): HideRule {
    return createDefaultHideRule();
  }

  async applyRulesToActiveFile(showNotice = false): Promise<boolean> {
    const file = this.app.workspace.getActiveFile();
    if (!this.notebookNavigatorRuleService.canApplyToFile(file)) {
      if (showNotice) new Notice('No active markdown or canvas file.');
      return false;
    }
    const noteChanged = await this.notebookNavigatorRuleService.applyRulesToFile(file, {
      reason: 'gcm-manual-active',
      force: true,
      bypassCreationGrace: true,
    });
    if (showNotice) {
      new Notice(noteChanged ? 'Notebook Navigator rules applied.' : 'No Notebook Navigator note rule changes.');
    }
    return noteChanged;
  }

  async applyRulesToAllFiles(silent = false): Promise<number> {
    const changed = await this.notebookNavigatorRuleService.applyRulesToAllFiles({
      reason: 'gcm-manual-all',
      force: true,
      bypassCreationGrace: true,
    });
    if (!silent) {
      new Notice(`GCM processed Notebook Navigator rules, updated ${changed} files.`);
    }
    return changed;
  }

  getSmartSortPreviewForActiveFile(): string | null {
    const file = this.app.workspace.getActiveFile();
    return file instanceof TFile ? this.notebookNavigatorRuleService.getSmartSortPreviewForFile(file) : null;
  }

  getRulePreviewForActiveFile(): Record<string, unknown> | null {
    const file = this.app.workspace.getActiveFile();
    return file instanceof TFile ? this.notebookNavigatorRuleService.getRulePreviewForFile(file) : null;
  }

  getRuleMatchForActiveFile(rule: IconColorRule | HideRule): boolean | null {
    const file = this.app.workspace.getActiveFile();
    return file instanceof TFile ? this.notebookNavigatorRuleService.getRuleMatchForFile(file, rule) : null;
  }

  private getControllerArchiveFolderPath(): string {
    const plugin = getPluginById(this.app, 'tps-controller') as any;
    const settings = typeof plugin?.api?.getSettings === 'function'
      ? plugin.api.getSettings()
      : plugin?.settings;
    const sourceFolder = settings?.twoStageArchive && typeof settings.twoStageArchive.sourceFolder === 'string'
      ? settings.twoStageArchive.sourceFolder
      : '';
    if (sourceFolder.trim()) {
      return sourceFolder.trim();
    }
    const raw = typeof settings?.archiveFolder === 'string' ? settings.archiveFolder : '';
    return raw.trim();
  }

  getControllerDeviceRole(): 'controller' | 'user' | null {
    const plugin = getPluginById(this.app, 'tps-controller') as any;
    const localRole = this.getStoredControllerDeviceRole();
    if (!plugin) return localRole;
    const apiRole = typeof plugin?.api?.getRole === 'function' ? plugin.api.getRole() : null;
    if (apiRole === 'controller' || apiRole === 'user') return apiRole;
    const managerRole = plugin?.deviceRoleManager?.role;
    if (managerRole === 'controller' || managerRole === 'user') return managerRole;
    const isController = typeof plugin?.api?.isController === 'function'
      ? plugin.api.isController()
      : typeof plugin?.deviceRoleManager?.isController === 'function'
        ? plugin.deviceRoleManager.isController()
        : null;
    if (isController === true) return 'controller';
    if (isController === false) return 'user';
    return localRole;
  }

  canRunBackgroundAutomation(): boolean {
    if (Platform.isMobile) return false;
    const role = this.getControllerDeviceRole() ?? this.getStoredControllerDeviceRole();
    if (role) return role === 'controller';
    if (this.isControllerPluginEnabled()) return false;
    return !Platform.isMobile;
  }

  private getStoredControllerDeviceRole(): 'controller' | 'user' | null {
    try {
      const stored = window.localStorage.getItem(`tps-device-role-${this.app.vault.getName()}`);
      return stored === 'controller' || stored === 'user' ? stored : null;
    } catch {
      return null;
    }
  }

  private isControllerPluginEnabled(): boolean {
    const plugins = (this.app as any)?.plugins;
    try {
      if (typeof plugins?.enabledPlugins?.has === 'function' && plugins.enabledPlugins.has('tps-controller')) return true;
      if (Array.isArray(plugins?.enabledPlugins) && plugins.enabledPlugins.includes('tps-controller')) return true;
      if (plugins?.plugins?.['tps-controller']) return true;
    } catch {
      return false;
    }
    return false;
  }

  getArchiveFolderPath(): string {
    const configured = typeof this.settings.archiveFolderPath === 'string'
      ? this.settings.archiveFolderPath.trim()
      : '';
    const legacy = typeof (this.settings as any)?.archiveFolder === 'string'
      ? String((this.settings as any).archiveFolder).trim()
      : '';
    const controller = this.getControllerArchiveFolderPath();
    const resolved = controller || configured || legacy;
    return resolved ? normalizePath(resolved) : '';
  }

  async resolveTpsBaseWriteFile(
    options: Omit<ResolveTpsBaseWriteTargetOptions, 'todayIsoDate'> = {},
  ): Promise<TpsBaseWriteTargetResolution> {
    const result = await resolveTpsBaseWriteTarget(this, {
      ...options,
      todayIsoDate: () => {
        const momentLib = (window as any)?.moment;
        if (typeof momentLib === 'function') return momentLib().format('YYYY-MM-DD');
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      },
    });
    const details = {
      source: result.source,
      reason: result.reason,
      path: result.path,
      explicitTargetSpecified: options.explicitTargetSpecified === true,
      createExplicitIfMissing: options.createExplicitIfMissing === true,
    };
    if (result.file) {
      logger.flow('TpsBaseWriteTarget', 'resolve:done', details);
    } else if (result.error) {
      logger.flowError('TpsBaseWriteTarget', 'resolve:failed', result.error, details);
    } else {
      logger.flowWarn('TpsBaseWriteTarget', 'resolve:blocked', details);
    }
    return result;
  }

  async saveSettings(): Promise<void> {
    this.settings.parentLinkFormat = normalizeParentLinkFormat(this.settings.parentLinkFormat);
    this.settings.linkedSubitemCheckboxMappings = normalizeLinkedSubitemMappings(
      this.settings.linkedSubitemCheckboxMappings,
      { enforceStrictDefaults: true },
    );
    this.settings.linkedSubitemDefaultOpenState = normalizeLinkedSubitemCheckboxState(
      this.settings.linkedSubitemDefaultOpenState,
    ) || '[ ]';
    this.stripLegacySettingsFields(this.settings as unknown as Record<string, unknown>);
    this.configureEntityIndexDimensions();
    logger.setLoggingEnabled(this.settings.enableLogging);
    if (this.settings.enableChecklistCompletionProperty !== true) {
      this.taskCheckboxHandler?.cancelChecklistPropertyUpdates();
    }
    this.workspaceRibbonService?.refresh();
    this.timeTrackingStatusBarService?.refresh();
    this.hideCompletedCheckboxesService?.applyBodyClass();
    this.hideCompletedCheckboxesService?.refreshAllEditors();
    if (this.canRunBackgroundAutomation()) {
      this.startArchiveTagAutomation();
    } else {
      this.stopArchiveTagAutomation();
    }
    await this.persistSettingsSnapshot();
    this.tpsNotebookNavigatorMenuBridge?.refresh();
    this.overlayRenderingService?.invalidate({
      reason: 'settings-save',
      surfaces: ['menus', 'linked-subitems', 'daily-nav'],
      delayMs: 0,
    });
    const seen = new Set<string>();
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const file = (leaf.view as any)?.file;
      if (!(file instanceof TFile) || seen.has(file.path)) continue;
      seen.add(file.path);
      this.overlayRenderingService?.scheduleFileRefresh(file, 'settings-save-file', {
        force: true,
        rebuildInlineSubitems: true,
        delayMs: 0,
      });
    }
  }

  private configureEntityIndexDimensions(): void {
    if (!this.entityIndexService) return;
    const propertyKeys = (this.settings.properties || [])
      .filter((property) => property?.type === 'kind')
      .map((property) => String(property.key || '').trim())
      .filter(Boolean);
    this.entityIndexService.configureDimensions([
      { name: 'kind', propertyKeys },
    ]);
  }

  isInMobileStartupGracePeriod(): boolean {
    return Platform.isMobile && Date.now() - this.startupTimestamp < 45_000;
  }

  private markRecentCanvasDrag(durationMs: number): void {
    const until = Date.now() + durationMs;
    if (until > this.recentCanvasDragUntil) {
      this.recentCanvasDragUntil = until;
    }
  }

  private shouldSuppressOpenForRecentCanvasDrag(): boolean {
    return this.settings.enableCanvasOpenGuard === true && Date.now() < this.recentCanvasDragUntil;
  }

  private installCanvasOpenGuard(): () => void {
    const workspace = this.app.workspace as any;
    const workspaceMethodOwnership = new Map<string, boolean>();
    const captureWorkspaceMethod = (name: string): any => {
      workspaceMethodOwnership.set(name, Object.prototype.hasOwnProperty.call(workspace, name));
      return workspace[name];
    };
    const originalOpenLinkText = captureWorkspaceMethod('openLinkText');
    const originalGetLeaf = captureWorkspaceMethod('getLeaf');
    const originalGetUnpinnedLeaf = captureWorkspaceMethod('getUnpinnedLeaf');
    const originalGetRightLeaf = captureWorkspaceMethod('getRightLeaf');
    const originalGetLeftLeaf = captureWorkspaceMethod('getLeftLeaf');
    const originalCreateLeafBySplit = captureWorkspaceMethod('createLeafBySplit');
    const originalCreateLeafInParent = captureWorkspaceMethod('createLeafInParent');
    const originalSplitActiveLeaf = captureWorkspaceMethod('splitActiveLeaf');
    const originalDuplicateLeaf = captureWorkspaceMethod('duplicateLeaf');
    const originalOpenPopoutLeaf = captureWorkspaceMethod('openPopoutLeaf');
    const originalLeafOpenFile = WorkspaceLeaf.prototype.openFile;
    const originalLeafOpen = WorkspaceLeaf.prototype.open;
    const originalLeafSetViewState = WorkspaceLeaf.prototype.setViewState;
    const plugin = this;

    const logSuppressedOpen = (
      source:
        | 'openLinkText'
        | 'leaf.openFile'
        | 'leaf.open'
        | 'leaf.setViewState'
        | 'workspace.getLeaf'
        | 'workspace.getUnpinnedLeaf'
        | 'workspace.getRightLeaf'
        | 'workspace.getLeftLeaf'
        | 'workspace.createLeafBySplit'
        | 'workspace.createLeafInParent'
        | 'workspace.splitActiveLeaf'
        | 'workspace.duplicateLeaf'
        | 'workspace.openPopoutLeaf',
      target?: string,
    ) => {
      logger.log('[TPS GCM] Suppressed file open during recent canvas drag', {
        source,
        target,
      });
    };

    const fallbackLeaf = (): WorkspaceLeaf | null => {
      try {
        const leaf = (typeof originalGetUnpinnedLeaf === 'function'
          ? originalGetUnpinnedLeaf.call(workspace)
          : undefined)
          ?? (typeof originalGetLeaf === 'function' ? originalGetLeaf.call(workspace, 'tab') : undefined)
          ?? workspace.activeLeaf;
        return leaf ?? null;
      } catch {
        return workspace.activeLeaf
          ?? (typeof originalGetLeaf === 'function' ? originalGetLeaf.call(workspace, 'tab') : null)
          ?? null;
      }
    };

    const leafLooksEmpty = (leaf: WorkspaceLeaf): boolean => {
      try {
        const viewState = typeof leaf.getViewState === 'function' ? leaf.getViewState() as any : null;
        const state = viewState?.state;
        const path = typeof state?.file === 'string'
          ? state.file
          : typeof state?.path === 'string'
            ? state.path
            : typeof (leaf as any)?.view?.file?.path === 'string'
              ? (leaf as any).view.file.path
              : '';
        return !path;
      } catch {
        return !((leaf as any)?.view?.file?.path);
      }
    };

    const cleanupSuppressedLeaf = (leaf: WorkspaceLeaf): void => {
      if (!leaf || leaf === workspace.activeLeaf) return;
      if (!leafLooksEmpty(leaf)) return;
      window.setTimeout(() => {
        try {
          if (leaf !== workspace.activeLeaf && leafLooksEmpty(leaf)) {
            logger.log('[TPS GCM] Left suppressed blank leaf attached after recent canvas drag');
          }
        } catch (error) {
          logger.warn('[TPS GCM] Failed to inspect suppressed leaf', error);
        }
      }, 0);
    };

    if (typeof originalGetLeaf === 'function') {
      workspace.getLeaf = function (...args: any[]) {
        const target = args[0];
        if (
          plugin.shouldSuppressOpenForRecentCanvasDrag()
          && (target === true || target === 'tab' || target === 'split' || target === 'window')
        ) {
          logSuppressedOpen('workspace.getLeaf', String(target));
          return fallbackLeaf();
        }
        return originalGetLeaf.apply(workspace, args);
      };
    }

    if (typeof originalGetUnpinnedLeaf === 'function') {
      workspace.getUnpinnedLeaf = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
          logSuppressedOpen('workspace.getUnpinnedLeaf', 'tab');
          try {
            const fb = fallbackLeaf();
            if (fb) return fb;
          } catch (_e) {
            // ignore and return safe active leaf below
          }
          return workspace.activeLeaf
            ?? (typeof originalGetLeaf === 'function' ? originalGetLeaf.call(workspace, 'tab') : null);
        }
        return originalGetUnpinnedLeaf.apply(workspace, args);
      };
    }

    if (typeof originalGetRightLeaf === 'function') {
      workspace.getRightLeaf = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag() && args[0] === true) {
          logSuppressedOpen('workspace.getRightLeaf', 'split');
          return fallbackLeaf();
        }
        return originalGetRightLeaf.apply(workspace, args);
      };
    }

    if (typeof originalGetLeftLeaf === 'function') {
      workspace.getLeftLeaf = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag() && args[0] === true) {
          logSuppressedOpen('workspace.getLeftLeaf', 'split');
          return fallbackLeaf();
        }
        return originalGetLeftLeaf.apply(workspace, args);
      };
    }

    if (typeof originalCreateLeafBySplit === 'function') {
      workspace.createLeafBySplit = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
          logSuppressedOpen('workspace.createLeafBySplit', String(args[1] ?? 'split'));
          return fallbackLeaf();
        }
        return originalCreateLeafBySplit.apply(workspace, args);
      };
    }

    if (typeof originalCreateLeafInParent === 'function') {
      workspace.createLeafInParent = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
          logSuppressedOpen('workspace.createLeafInParent', 'parent');
          return fallbackLeaf();
        }
        return originalCreateLeafInParent.apply(workspace, args);
      };
    }

    if (typeof originalSplitActiveLeaf === 'function') {
      workspace.splitActiveLeaf = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
          logSuppressedOpen('workspace.splitActiveLeaf', String(args[0] ?? 'split'));
          return fallbackLeaf();
        }
        return originalSplitActiveLeaf.apply(workspace, args);
      };
    }

    if (typeof originalDuplicateLeaf === 'function') {
      workspace.duplicateLeaf = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
          logSuppressedOpen('workspace.duplicateLeaf', String(args[1] ?? 'duplicate'));
          return Promise.resolve(fallbackLeaf());
        }
        return originalDuplicateLeaf.apply(workspace, args);
      };
    }

    if (typeof originalOpenPopoutLeaf === 'function') {
      workspace.openPopoutLeaf = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
          logSuppressedOpen('workspace.openPopoutLeaf', 'window');
          return fallbackLeaf();
        }
        return originalOpenPopoutLeaf.apply(workspace, args);
      };
    }

    WorkspaceLeaf.prototype.openFile = function (...args: any[]) {
      const targetFile = args[0] instanceof TFile ? args[0] as TFile : null;
      const target = targetFile?.path;
      if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
        logSuppressedOpen('leaf.openFile', target);
        cleanupSuppressedLeaf(this);
        return Promise.resolve(undefined as any);
      }
      return originalLeafOpenFile.apply(this, args as any);
    } as typeof WorkspaceLeaf.prototype.openFile;

    WorkspaceLeaf.prototype.open = function (...args: any[]) {
      if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
        logSuppressedOpen('leaf.open', (args[0] as any)?.getViewType?.() ?? 'view');
        cleanupSuppressedLeaf(this);
        return Promise.resolve(this.view);
      }
      return originalLeafOpen.apply(this, args as any);
    } as typeof WorkspaceLeaf.prototype.open;

    WorkspaceLeaf.prototype.setViewState = function (...args: any[]) {
      const viewState = args[0] as any;
      const target = typeof viewState?.state?.file === 'string'
        ? viewState.state.file
        : typeof viewState?.state?.path === 'string'
          ? viewState.state.path
          : typeof viewState?.type === 'string'
            ? viewState.type
            : undefined;
      if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
        logSuppressedOpen('leaf.setViewState', target);
        cleanupSuppressedLeaf(this);
        return Promise.resolve(undefined as any);
      }
      return originalLeafSetViewState.apply(this, args as any);
    } as typeof WorkspaceLeaf.prototype.setViewState;

    if (typeof originalOpenLinkText === 'function') {
      workspace.openLinkText = function (...args: any[]) {
        const target = typeof args[0] === 'string' ? args[0] : undefined;
        if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
          logSuppressedOpen('openLinkText', target);
          return Promise.resolve(undefined);
        }
        return originalOpenLinkText.apply(workspace, args);
      };
    }

    const restoreWorkspaceMethod = (name: string, original: any): void => {
      if (workspaceMethodOwnership.get(name)) {
        workspace[name] = original;
      } else {
        delete workspace[name];
      }
    };

    return () => {
      WorkspaceLeaf.prototype.openFile = originalLeafOpenFile;
      WorkspaceLeaf.prototype.open = originalLeafOpen;
      WorkspaceLeaf.prototype.setViewState = originalLeafSetViewState;
      if (typeof originalGetLeaf === 'function') {
        restoreWorkspaceMethod('getLeaf', originalGetLeaf);
      }
      if (typeof originalGetUnpinnedLeaf === 'function') {
        restoreWorkspaceMethod('getUnpinnedLeaf', originalGetUnpinnedLeaf);
      }
      if (typeof originalGetRightLeaf === 'function') {
        restoreWorkspaceMethod('getRightLeaf', originalGetRightLeaf);
      }
      if (typeof originalGetLeftLeaf === 'function') {
        restoreWorkspaceMethod('getLeftLeaf', originalGetLeftLeaf);
      }
      if (typeof originalCreateLeafBySplit === 'function') {
        restoreWorkspaceMethod('createLeafBySplit', originalCreateLeafBySplit);
      }
      if (typeof originalCreateLeafInParent === 'function') {
        restoreWorkspaceMethod('createLeafInParent', originalCreateLeafInParent);
      }
      if (typeof originalSplitActiveLeaf === 'function') {
        restoreWorkspaceMethod('splitActiveLeaf', originalSplitActiveLeaf);
      }
      if (typeof originalDuplicateLeaf === 'function') {
        restoreWorkspaceMethod('duplicateLeaf', originalDuplicateLeaf);
      }
      if (typeof originalOpenPopoutLeaf === 'function') {
        restoreWorkspaceMethod('openPopoutLeaf', originalOpenPopoutLeaf);
      }
      if (typeof originalOpenLinkText === 'function') {
        restoreWorkspaceMethod('openLinkText', originalOpenLinkText);
      }
    };
  }

  private stopArchiveTagAutomation(): void {
    if (this.archiveSweepTimerId !== null) {
      window.clearTimeout(this.archiveSweepTimerId);
      this.archiveSweepTimerId = null;
    }
  }

  private startArchiveTagAutomation(): void {
    this.stopArchiveTagAutomation();
    if (!this.canRunBackgroundAutomation()) {
      return;
    }
    if (!this.settings.enableArchiveTagMove) {
      return;
    }
    void this.runArchiveTagSweepIfDue('startup-catchup');
    this.scheduleNextArchiveTagSweep();
  }

  private getArchiveSweepTodayKey(): string {
    return window.moment().format('YYYY-MM-DD');
  }

  private isPastArchiveSweepTime(): boolean {
    const now = window.moment();
    const sweepTime = now.clone().startOf('day').hour(0).minute(5).second(0).millisecond(0);
    return !now.isBefore(sweepTime);
  }

  private scheduleNextArchiveTagSweep(): void {
    if (!this.canRunBackgroundAutomation()) {
      return;
    }
    if (!this.settings.enableArchiveTagMove) {
      return;
    }
    const now = window.moment();
    const nextSweep = now.clone().startOf('day').hour(0).minute(5).second(0).millisecond(0);
    if (!nextSweep.isAfter(now)) {
      nextSweep.add(1, 'day');
    }
    const delayMs = Math.max(1000, nextSweep.diff(now));
    this.archiveSweepTimerId = window.setTimeout(() => {
      this.archiveSweepTimerId = null;
      void this.runArchiveTagSweepIfDue('scheduled').finally(() => {
        this.scheduleNextArchiveTagSweep();
      });
    }, delayMs);
  }

  private async runArchiveTagSweepIfDue(reason: 'startup-catchup' | 'scheduled'): Promise<void> {
    if (!this.canRunBackgroundAutomation()) {
      return;
    }
    if (!this.settings.enableArchiveTagMove) {
      return;
    }
    const todayKey = this.getArchiveSweepTodayKey();
    if (this.settings.lastArchiveTagSweepDate === todayKey) {
      return;
    }
    if (!this.isPastArchiveSweepTime()) {
      return;
    }

    const result = await this.noteOperationService.sweepArchiveTaggedFiles(reason);
    this.settings.lastArchiveTagSweepDate = todayKey;
    await this.persistSettingsSnapshot();
    logger.log(`[TPS GCM] Archive tag sweep complete (${reason})`, result);
  }

  injectStyles(): void {
    if (this.styleEl) return;
    const style = document.createElement('style');
    style.id = 'tps-global-context-style';
    style.textContent = PLUGIN_STYLES;
    document.head.appendChild(style);
    this.styleEl = style;
  }

  removeStyles(): void {
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }
  }

  private removeLegacyNotebookNavigatorRuleSettingsStyles(): void {
    const ownerDocuments = new Set<Document>([document]);
    this.app.workspace.iterateAllLeaves((leaf) => {
      ownerDocuments.add(leaf.getContainer().doc);
    });
    for (const ownerDocument of ownerDocuments) {
      removeLegacyNotebookNavigatorRuleSettingsStyle(ownerDocument);
    }
  }

  createMenuHeader(file: TFile): HTMLElement {
    const div = document.createElement('div');
    div.className = 'tps-global-context-header';
    div.textContent = file.basename;
    return div;
  }

  createMultiMenuHeader(files: TFile[]): HTMLElement {
    const div = document.createElement('div');
    div.className = 'tps-global-context-header';
    div.textContent = `${files.length} files selected`;
    return div;
  }

  buildSpecialPanel(file: TFile | TFile[], options: BuildPanelOptions = {}): HTMLElement | null {
    const files = Array.isArray(file) ? file : [file];
    return this.menuController.buildSpecialPanel(files, options);
  }

  suppressViewModeSwitchForPathUntilFocusChange(path: string): void {
    if (!path) return;
    this.viewModeSuppressedPaths.add(path);
  }

  shouldSkipViewModeSwitch(): boolean {
    const activePath = this.app.workspace.getActiveFile()?.path;
    if (!activePath) return false;
    return this.viewModeSuppressedPaths.has(activePath);
  }

  shouldIgnoreAutoFrontmatterWrite(file: TFile): boolean {
    return this.fileExclusionService.shouldIgnore(file);
  }

  private getLeafMarkdownFile(leaf: WorkspaceLeaf): TFile | null {
    const viewFile = (leaf.view as any)?.file;
    if (viewFile instanceof TFile) return viewFile;
    if (leaf === this.app.workspace.activeLeaf && this.isMountedMarkdownLeaf(leaf)) return null;
    try {
      const state = leaf.getViewState?.() as any;
      const path = typeof state?.state?.file === 'string'
        ? state.state.file
        : typeof state?.state?.path === 'string'
          ? state.state.path
          : '';
      const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
      return file instanceof TFile ? file : null;
    } catch {
      return null;
    }
  }

  getOpenerDiagnostic(targetPath?: string | null): GcmOpenerDiagnostic {
    const targetFile = targetPath
      ? this.app.vault.getAbstractFileByPath(targetPath)
      : null;
    const file = targetFile instanceof TFile ? targetFile : null;
    const markdownLeaves: GcmOpenerLeafDiagnostic[] = [];

    this.app.workspace.iterateAllLeaves((leaf) => {
      const diagnostic = this.describeOpenerLeaf(leaf);
      if (diagnostic.viewType === 'markdown' || diagnostic.path || diagnostic.statePath) {
        markdownLeaves.push(diagnostic);
      }
    });

    return {
      targetPath: file?.path ?? targetPath ?? null,
      activePath: this.app.workspace.getActiveFile()?.path ?? null,
      existingTargetLeaf: file ? this.describeOpenerLeaf(this.findOpenLeafForFile(file)) : null,
      activeLeaf: this.describeOpenerLeaf(this.app.workspace.activeLeaf ?? null),
      markdownLeaves,
    };
  }

  private describeOpenerLeaf(leaf: WorkspaceLeaf | null | undefined): GcmOpenerLeafDiagnostic | null {
    if (!leaf) return null;
    const viewFile = (leaf.view as any)?.file;
    const path = viewFile instanceof TFile ? viewFile.path : null;
    let viewType = '';
    try {
      viewType = String(leaf.getViewState?.()?.type ?? '');
    } catch {
      viewType = '';
    }
    return {
      path,
      statePath: this.getLeafViewStatePath(leaf),
      viewType,
      active: leaf === this.app.workspace.activeLeaf,
      pinned: this.isPinnedLeafForDifferentFile(leaf, null),
      blank: this.isBlankLeaf(leaf),
      usableMarkdown: this.isUsableMarkdownLeaf(leaf),
    };
  }

  private logOpenerDecision(reason: string, details: Record<string, unknown>): void {
    if (this.settings.logOpenerDecisions !== true) return;
    logger.log('[TPS GCM] Opener decision', {
      reason,
      ...details,
    });
  }

  matchesAutoFrontmatterExclusionPattern(
    normalizedPath: string,
    normalizedBasename: string,
    rawPattern: string,
  ): boolean {
    return this.fileExclusionService.matchesPattern(normalizedPath, normalizedBasename, rawPattern);
  }

  async openFileInLeaf(
    file: TFile,
    context: 'tab' | 'split' | 'window' | false,
    getLeaf: () => WorkspaceLeaf | null,
    options?: {
      revealLeaf?: boolean;
      active?: boolean;
      ignoreCanvasDragGuard?: boolean;
      reuseLeafIfNoExisting?: boolean;
    },
  ): Promise<boolean> {
    const requestedPath = String(file?.path || '').trim();
    const liveFile = requestedPath ? this.app.vault.getAbstractFileByPath(requestedPath) : null;
    if (!(liveFile instanceof TFile)) {
      this.logOpenerDecision('missing-live-file', { requestedPath, context });
      return false;
    }
    file = liveFile;
    if (!options?.ignoreCanvasDragGuard && this.shouldSuppressOpenForRecentCanvasDrag()) {
      logger.log('[TPS GCM] Suppressed openFileInLeaf before context creation', {
        file: file.path,
        context,
      });
      return false;
    }

    const openActive = options?.active ?? true;
    const revealLeaf = options?.revealLeaf !== false;
    const existingLeaf = this.findOpenLeafForFile(file);
    if (existingLeaf) {
      this.logOpenerDecision('reuse-existing-leaf', {
        file: file.path,
        context,
        openActive,
        revealLeaf,
        leaf: this.describeOpenerLeaf(existingLeaf),
      });
      if (openActive) {
        this.app.workspace.setActiveLeaf(existingLeaf, { focus: true } as any);
      }
      if (revealLeaf) {
        this.app.workspace.revealLeaf(existingLeaf);
      }
      return true;
    }

    const openFile = async () => {
      let leaf = getLeaf();
      let routedFromNonMarkdownLeaf = false;
      if (!leaf) {
        throw new Error('No workspace leaf available');
      }
      if (this.isPinnedLeafForDifferentFile(leaf, file)) {
        this.logOpenerDecision('avoid-pinned-leaf', {
          file: file.path,
          context,
          leaf: this.describeOpenerLeaf(leaf),
        });
        leaf = this.app.workspace.getLeaf(true);
      }
      const leafViewType = leaf.view?.getViewType?.() || '';
      if (!this.isBlankLeaf(leaf) && leafViewType !== 'markdown') {
        this.logOpenerDecision('avoid-non-markdown-leaf', {
          file: file.path,
          context,
          leafViewType,
          leaf: this.describeOpenerLeaf(leaf),
        });
        leaf = this.app.workspace.getLeaf('tab');
        routedFromNonMarkdownLeaf = true;
      }
      const openActiveForMount = openActive || this.isBlankLeaf(leaf);
      this.logOpenerDecision('open-missing-file', {
        file: file.path,
        context,
        openActive,
        revealLeaf,
        openActiveForMount,
        leaf: this.describeOpenerLeaf(leaf),
      });
      if (routedFromNonMarkdownLeaf && file.extension === 'md' && typeof leaf.setViewState === 'function') {
        await leaf.setViewState({
          type: 'markdown',
          state: { file: file.path },
          active: openActiveForMount,
        } as any);
      } else {
        await leaf.openFile(file, { active: openActiveForMount } as any);
      }
      const openedLeaf = this.findOpenLeafForFile(file) ?? leaf;
      if (openActive) {
        this.app.workspace.setActiveLeaf(openedLeaf, { focus: true } as any);
      }
      if (revealLeaf) {
        this.app.workspace.revealLeaf(openedLeaf);
      }
    };

    const result = context === false
      ? openActive
        ? await this.commandQueueService.executeOpenActiveFile(file, openFile)
        : await this.commandQueueService.executeOpenInNewContext(file, 'tab', openFile)
      : await this.commandQueueService.executeOpenInNewContext(file, context, openFile);

    if (!result.success) {
      const message = getErrorMessage(result.error, 'Could not open file');
      logger.error('[TPS GCM] File open failed', { file: file.path, context, message, error: result.error });
      new Notice(message);
      return false;
    }

    return true;
  }

  private isPinnedLeafForDifferentFile(leaf: WorkspaceLeaf, file: TFile | null): boolean {
    const viewFile = (leaf.view as any)?.file;
    if (file && viewFile instanceof TFile && viewFile.path === file.path) return false;
    const leafAny = leaf as any;
    if (leafAny.pinned === true) return true;
    try {
      return leafAny.getViewState?.()?.pinned === true || leafAny.getEphemeralState?.()?.pinned === true;
    } catch {
      return false;
    }
  }

  private isBlankLeaf(leaf: WorkspaceLeaf): boolean {
    const viewType = leaf.getViewState?.()?.type;
    if (viewType && viewType !== 'empty') return false;
    const viewFile = (leaf.view as any)?.file;
    if (viewFile instanceof TFile) return false;
    return !this.getLeafViewStatePath(leaf);
  }

  findOpenLeafForFile(file: TFile): WorkspaceLeaf | null {
    let best: { leaf: WorkspaceLeaf; score: number } | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const viewFile = (leaf.view as any)?.file;
      if (!(viewFile instanceof TFile) || viewFile.path !== file.path) return;

      const mounted = this.isUsableMarkdownLeaf(leaf);
      const active = leaf === this.app.workspace.activeLeaf;
      const score = (mounted ? 100 : 0) + (active ? 20 : 0);
      if (!best || score > best.score) {
        best = { leaf, score };
      }
    });
    return best?.leaf ?? null;
  }

  collapseDuplicateOpenLeavesForFile(file: TFile, keepLeaf: WorkspaceLeaf): void {
    logger.log('[TPS GCM] Skipped duplicate leaf collapse; automatic tab closing is disabled', {
      file: file.path,
      keep: this.getLeafViewStatePath(keepLeaf),
    });
  }

  private getLeafViewStatePath(leaf: WorkspaceLeaf): string {
    try {
      const state = leaf.getViewState?.() as any;
      if (state?.type !== 'markdown') return '';
      return typeof state?.state?.file === 'string'
        ? state.state.file
        : typeof state?.state?.path === 'string'
          ? state.state.path
          : '';
    } catch {
      return '';
    }
  }

  private isMountedMarkdownLeaf(leaf: WorkspaceLeaf): boolean {
    const contentEl = (leaf.view as any)?.contentEl as HTMLElement | undefined;
    const containerEl = (leaf as any)?.containerEl as HTMLElement | undefined;
    const root = contentEl ?? containerEl;
    if (!root?.isConnected) return false;
    return !!root.querySelector?.('.markdown-source-view, .markdown-preview-view, .markdown-reading-view');
  }

  private isUsableMarkdownLeaf(leaf: WorkspaceLeaf): boolean {
    const file = this.getLeafMarkdownFile(leaf);
    const contentEl = (leaf.view as any)?.contentEl as HTMLElement | undefined;
    const containerEl = (leaf as any)?.containerEl as HTMLElement | undefined;
    const root = contentEl ?? containerEl;
    if (!root?.isConnected) return false;
    const markdownRoot = root.querySelector<HTMLElement>('.markdown-source-view, .markdown-preview-view, .markdown-reading-view');
    if (!markdownRoot) return false;
    const rect = markdownRoot.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return false;
    const contentRoot = root.querySelector<HTMLElement>('.cm-content, .markdown-preview-sizer, .markdown-preview-section');
    const markdownText = (markdownRoot.textContent || '').trim().length > 0;
    if (!contentRoot) return markdownText || (file instanceof TFile && file.stat.size === 0);
    const contentRect = contentRoot.getBoundingClientRect();
    if (contentRect.width < 10 || contentRect.height < 10) return markdownText;
    const hasRenderedText = (contentRoot.textContent || '').trim().length > 0;
    if (file instanceof TFile && file.stat.size > 0 && !hasRenderedText && !markdownText) return false;
    return contentRoot.childElementCount > 0 || hasRenderedText || markdownText || (file instanceof TFile && file.stat.size === 0);
  }

  private detachStaleOpenLeavesForFile(file: TFile): void {
    logger.log('[TPS GCM] Skipped stale leaf detach; automatic tab closing is disabled', { file: file.path });
  }

  private detachDuplicateOpenLeavesForFile(file: TFile, keepLeaf: WorkspaceLeaf): void {
    logger.log('[TPS GCM] Skipped duplicate leaf detach; automatic tab closing is disabled', {
      file: file.path,
      keep: this.getLeafViewStatePath(keepLeaf),
    });
  }

  async runQueuedMove(files: TFile[], performMove: () => Promise<void>): Promise<boolean> {
    const result = await this.commandQueueService.executeMoveFiles(files, performMove);
    if (!result.success) {
      const message = getErrorMessage(result.error, 'Move failed');
      logger.error('[TPS GCM] Move operation failed', { files: files.map((file) => file.path), message, error: result.error });
      new Notice(message);
      return false;
    }
    return true;
  }

  async runQueuedDelete(files: TFile[], performDelete: () => Promise<void>): Promise<boolean> {
    const result = await this.commandQueueService.executeDeleteFiles(files, performDelete);
    if (!result.success) {
      const message = getErrorMessage(result.error, 'Delete failed');
      logger.error('[TPS GCM] Delete operation failed', { files: files.map((file) => file.path), message, error: result.error });
      new Notice(message);
      return false;
    }
    return true;
  }
}
