import { Plugin, TFile, WorkspaceLeaf, Menu, debounce, Notice, normalizePath, Platform } from 'obsidian';
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
import { DEFAULT_SETTINGS } from './constants';
import { PLUGIN_STYLES } from './plugin-styles';
import { MenuController } from './menu/menu-controller';
import { PersistentMenuManager } from './menu/persistent-menu-manager';
import { setupMenuPatch } from './menu/menu-patcher';
import { TPSGlobalContextMenuSettingTab } from './settings-tab';
import { BulkEditService } from './services/bulk-edit-service';
import { RecurrenceService } from './services/recurrence-service';
import { FileNamingService } from './services/file-naming-service';
import { AutoFrontmatterExclusionService } from './services/file-exclusion-service';
import { ViewModeManager } from './handlers/view-mode-manager';
import { DailyNoteNavManager } from './handlers/daily-note-nav-manager';
import { TaskCheckboxHandler } from './handlers/task-checkbox-handler';
import { ContextTargetService } from './services/context-target-service';
import { NoteOperationService } from './services/note-operation-service';
import { FieldInitializationService } from './services/field-initialization-service';
import { installDateContainsPolyfill } from './compat';
import * as logger from './logger';
import { CommandQueueService, getErrorMessage, getPluginById } from './core';
import { VaultQueryService } from './services/vault-query-service';
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
import { AutoPinActiveNoteService } from './services/auto-pin-active-note-service';
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
import { CanvasPropertiesService } from './services/canvas-properties-service';
import { NoteTitleRenderService } from './services/note-title-render-service';
import { VirtualBaseEmbedService } from './services/virtual-base-embed-service';
import { sanitizeNotebookNavigatorRuleSettings } from './services/notebook-navigator-rule-settings';
import { registerGcmEvents } from './events/register-events';
import { registerGcmCommands } from './commands/register-commands';
import { setupPluginApi } from './plugin-api';
import { createSharedServices, type GcmSharedServices } from './services/shared';
import { ViewModeService } from './services/view-mode-service';
import { resolveCustomProperties } from './resolve-profiles';
import { normalizeParentLinkFormat } from './handlers/parent-link-format';

const NATIVE_PROPERTIES_ALWAYS_HIDDEN = new Set(['allday', 'color', 'folderpath', 'icon', 'sort']);
const DEFAULT_INLINE_PROPERTY_DENY_KEYS = new Set(['title', 'parent', 'parentof', 'folderpath']);
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

export default class TPSGlobalContextMenuPlugin extends Plugin {
  private static readonly BUILD_STAMP = '2026-03-11 18:12';
  private static readonly BASE_LINK_PREVIEW_SOURCE = 'tps-gcm-base-link-preview';
  private readonly startupTimestamp = Date.now();
  settings: TPSGlobalContextMenuSettings;
  menuController: MenuController;
  persistentMenuManager: PersistentMenuManager;
  bulkEditService: BulkEditService;
  recurrenceService: RecurrenceService;
  fileNamingService: FileNamingService;
  viewModeManager: ViewModeManager;
  dailyNoteNavManager: DailyNoteNavManager;
  contextTargetService: ContextTargetService;
  noteOperationService: NoteOperationService;
  fieldInitializationService: FieldInitializationService;
  commandQueueService: CommandQueueService;
  vaultQueryService: VaultQueryService;
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
  autoPinActiveNoteService: AutoPinActiveNoteService;
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
  eventService: GcmEventService;
  identityService: TpsIdentityService;
  cardContentService: CardContentService;
  identityMigrationService: IdentityMigrationService;
  canvasPropertiesService: CanvasPropertiesService;
  noteTitleRenderService: NoteTitleRenderService;
  virtualBaseEmbedService: VirtualBaseEmbedService;
  sharedServices: GcmSharedServices;
  styleEl: HTMLStyleElement | null = null;
  ignoreNextContext = false;
  keyboardVisible = false;
  private archiveSweepTimerId: number | null = null;
  private restoreMenuPatch: (() => void) | null = null;
  private restoreCanvasOpenGuard: (() => void) | null = null;
  private restoreProcessFrontmatterPatch: (() => void) | null = null;
  private nativeProcessFrontmatterDelegate: ((file: TFile, mutator: (frontmatter: Record<string, unknown>) => void | Promise<void>, options?: unknown) => Promise<unknown>) | null = null;
  private basesPreviewPropertiesObserver: MutationObserver | null = null;
  private basesPreviewPropertiesRefreshTimer: number | null = null;
  private basesPreviewPropertiesRetryTimers: number[] = [];
  private viewModeSuppressedPaths: Set<string> = new Set();
  private defaultMarkdownOpenPromises: Map<string, Promise<void>> = new Map();
  private externalActionRegistrations: Map<string, GcmExternalActionRegistration> = new Map();
  private basesLinkPreviewArmedPath: string | null = null;
  private basesLinkPreviewArmedUntil = 0;
  private basesLinkPreviewSuppressClickUntil = 0;
  private basesLinkPreviewNativeOpenPath: string | null = null;
  private basesLinkPreviewNativeOpenUntil = 0;
  private recentBaseLinkPreviewAnchorEl: HTMLElement | null = null;
  private recentBaseLinkPreviewPointerUntil = 0;
  private recentBaseLinkPreviewPointerPoint: { x: number; y: number } | null = null;
  private recentNotebookNavigatorOpenUntil = 0;
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

  // Create a debounced save function
  private debouncedSave = debounce(async () => {
    await this.saveData(this.settings);
  }, 1000, false);

  private getStrictLinkedSubitemMappings() {
    return [
      { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete', icon: 'square', label: 'Todo' },
      { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo', icon: 'check', label: 'Complete' },
      { checkboxState: '[\\]', statuses: ['working'], toggleTargetStatus: 'complete', icon: 'slash', label: 'Working' },
      { checkboxState: '[?]', statuses: ['holding'], toggleTargetStatus: 'todo', icon: 'help-circle', label: 'Holding' },
      { checkboxState: '[-]', statuses: ['wont-do'], toggleTargetStatus: 'todo', icon: 'minus', label: 'Won’t Do' },
    ];
  }

  private normalizeStrictLinkedSubitemMappings(
    current: Array<{ checkboxState?: string; statuses?: string[]; toggleTargetStatus?: string; icon?: string; label?: string }> | undefined,
  ) {
    const byState = new Map(
      (current || [])
        .map((entry) => ({
          checkboxState: String(entry?.checkboxState || '').trim(),
          statuses: Array.isArray(entry?.statuses)
            ? entry.statuses.map((value) => String(value || '').trim()).filter(Boolean)
            : [],
          toggleTargetStatus: String(entry?.toggleTargetStatus || '').trim() || undefined,
          icon: String(entry?.icon || '').trim() || undefined,
          label: String(entry?.label || '').trim() || undefined,
        }))
        .filter((entry) => entry.checkboxState)
        .map((entry) => [entry.checkboxState, entry] as const),
    );
    const strictStates = new Set(this.getStrictLinkedSubitemMappings().map((entry) => entry.checkboxState));
    const custom = Array.from(byState.values()).filter((entry) => !strictStates.has(entry.checkboxState) && entry.statuses.length > 0);
    return [
      ...this.getStrictLinkedSubitemMappings().map((entry) => {
        const existing = byState.get(entry.checkboxState);
        return {
          ...entry,
          statuses: existing?.statuses?.length ? existing.statuses : entry.statuses,
          toggleTargetStatus: existing?.toggleTargetStatus || entry.toggleTargetStatus,
          icon: existing?.icon || entry.icon,
          label: existing?.label || entry.label,
        };
      }),
      ...custom,
    ];
  }

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

  private suppressCanvasActivationEvent(evt: MouseEvent): boolean {
    if (!this.shouldSuppressOpenForRecentCanvasDrag()) return false;
    if (!this.isCanvasOrBasesInteractionTarget(evt.target)) return false;

    evt.preventDefault();
    evt.stopImmediatePropagation();
    evt.stopPropagation();

    logger.log('[TPS GCM] Suppressed click activation after recent canvas drag', {
      eventType: evt.type,
      target: evt.target instanceof HTMLElement ? evt.target.className : null,
    });
    return true;
  }

  async onload(): Promise<void> {
    this.ignoreNextContext = false;

    await this.loadSettings();
    logger.setLoggingEnabled(this.settings.enableLogging);

    installDateContainsPolyfill();

    this.contextTargetService = new ContextTargetService(this);
    this.bulkEditService = new BulkEditService(this);
    this.recurrenceService = new RecurrenceService(this);
    this.fileNamingService = new FileNamingService(this);
    this.noteOperationService = new NoteOperationService(this);
    this.fieldInitializationService = new FieldInitializationService(this);
    this.commandQueueService = new CommandQueueService();
    this.vaultQueryService = new VaultQueryService(this);
    this.taskIdentityService = new TaskIdentityService();
    this.workspaceRibbonService = new WorkspaceRibbonService(this);
    this.parentLinkResolutionService = new ParentLinkResolutionService(this);
    this.bodySubitemLinkService = new BodySubitemLinkService(this);
    this.subitemRelationshipSyncService = new SubitemRelationshipSyncService(this);
    this.subitemReferenceIndexService = new SubitemReferenceIndexService(this);
    this.timeTrackingService = new TimeTrackingService(this);
    this.timeTrackingStatusBarService = new TimeTrackingStatusBarService(this);
    this.autoPinActiveNoteService = new AutoPinActiveNoteService(this);
    this.addChild(this.autoPinActiveNoteService);
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
    this.taskApiService = new TaskApiService(this);
    this.eventService = new GcmEventService(this);
    this.identityService = new TpsIdentityService(this);
    this.cardContentService = new CardContentService();
    this.identityMigrationService = new IdentityMigrationService(this);
    this.canvasPropertiesService = new CanvasPropertiesService(this);
    this.noteTitleRenderService = new NoteTitleRenderService(this);
    this.virtualBaseEmbedService = new VirtualBaseEmbedService(this);
    this.addChild(this.virtualBaseEmbedService);
    this.linkedSubitemCheckboxService = new LinkedSubitemCheckboxService(this);
    this.frontmatterMutationService = new FrontmatterMutationService(this);
    this.sharedServices = createSharedServices(this);
    this.restoreProcessFrontmatterPatch = this.installProcessFrontmatterPatch();
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
    this.registerInterval(window.setInterval(() => {
      this.noteTitleRenderService.refreshInlineTitles();
    }, 900));
    this.registerEditorSuggest(new InlinePropertySuggest(this));
    this.addChild(new HeadingLinkSuggest(this));
    this.app.workspace.updateOptions();

    this.menuController = new MenuController(this);
    this.persistentMenuManager = new PersistentMenuManager(this);
    this.viewModeManager = new ViewModeManager(this);
    this.addChild(this.viewModeManager);
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
    this.timeTrackingService.setup();
    this.timeTrackingStatusBarService.setup();
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

    this.registerBasesLinkPreviewHandler();
    this.registerInteractionHandlers();
    this.installBasesPreviewPropertiesBridge();

    registerGcmCommands(this);
  }

  private registerInteractionHandlers(): void {
    this.registerLinkedSubitemHandlers();
    this.registerManualContextMenuHandler();
  }

  private registerLinkedSubitemHandlers(): void {
    this.registerDomEvent(document, 'contextmenu', (evt: MouseEvent) => {
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
    if (Platform.isMobile) return;

    const handledEvents = new WeakSet<Event>();
    const handleBaseLinkPreviewEvent = (evt: MouseEvent | PointerEvent | TouchEvent) => {
      if (!this.isBasesForcedLinkPreviewEnabled()) {
        this.clearRecentBaseLinkPreviewPointer();
        return;
      }
      if (handledEvents.has(evt)) return;
      handledEvents.add(evt);

      if (evt instanceof MouseEvent && (evt.button !== 0 || evt.metaKey || evt.ctrlKey || evt.shiftKey || evt.altKey)) return;
      if (evt instanceof PointerEvent && (evt.button !== 0 || evt.metaKey || evt.ctrlKey || evt.shiftKey || evt.altKey)) return;
      if (evt instanceof TouchEvent && evt.touches.length > 1) return;
      const isPrimaryDownEvent = evt.type === 'pointerdown' || evt.type === 'touchstart';
      if (!isPrimaryDownEvent && Date.now() <= this.basesLinkPreviewSuppressClickUntil) {
        evt.preventDefault();
        evt.stopPropagation();
        evt.stopImmediatePropagation();
        return;
      }

      const targetNode = evt.target instanceof Node ? evt.target : null;
      const targetEl = targetNode instanceof HTMLElement
        ? targetNode
        : targetNode instanceof Element
          ? targetNode.closest<HTMLElement>('*') ?? targetNode.parentElement
          : targetNode?.parentElement ?? null;
      if (this.contextTargetService.isNotebookNavigatorContextTarget(targetEl)) {
        this.recentNotebookNavigatorOpenUntil = Date.now() + 1500;
        this.clearRecentBaseLinkPreviewPointer();
        return;
      }
      if (!this.getAllowedBaseLinkPreviewRoot(targetEl)) {
        this.clearRecentBaseLinkPreviewPointer();
        return;
      }
      if (this.isBaseLinkPreviewExcludedTarget(targetEl)) return;
      if (targetEl) {
        this.recentBaseLinkPreviewAnchorEl = targetEl;
        this.recentBaseLinkPreviewPointerUntil = Date.now() + 1200;
        this.recentBaseLinkPreviewPointerPoint = this.getBaseLinkPreviewEventPoint(evt);
      }
      const resolved = this.resolveBasesNoteLinkTarget(targetEl);
      if (!resolved) return;

      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      if (evt.type === 'pointerdown' || evt.type === 'touchstart' || evt.type === 'mousedown') {
        this.basesLinkPreviewSuppressClickUntil = Date.now() + 650;
      }

      const now = Date.now();
      const isSecondClick =
        this.basesLinkPreviewArmedPath === resolved.file.path &&
        now <= this.basesLinkPreviewArmedUntil;

      if (isSecondClick) {
        this.basesLinkPreviewArmedPath = null;
        this.basesLinkPreviewArmedUntil = 0;
        this.persistentMenuManager.hideBaseLinkEditablePreview();
        this.basesLinkPreviewNativeOpenPath = resolved.file.path;
        this.basesLinkPreviewNativeOpenUntil = now + 1000;
        void this.openFileInLeaf(resolved.file, false, () => this.getBaseLinkPreviewOpenLeaf(), { revealLeaf: true });
        return;
      }

      this.basesLinkPreviewArmedPath = resolved.file.path;
      this.basesLinkPreviewArmedUntil = now + 9000;
      this.baseLinkPreviewSourceLeaf = this.app.workspace.activeLeaf;
      this.contextTargetService.recordContextTarget(resolved.linkEl);
      this.persistentMenuManager.hideBaseLinkEditablePreview();
      void this.openBaseLinkInHoverEditor(resolved.file, resolved.linkEl).then((opened) => {
        if (!opened) {
          this.showNativeBaseLinkPreview(evt as MouseEvent, resolved.file, resolved.linkEl);
        }
      });
    };

    window.addEventListener('pointerdown', handleBaseLinkPreviewEvent as EventListener, { capture: true });
    window.addEventListener('touchstart', handleBaseLinkPreviewEvent as EventListener, { capture: true, passive: false });
    this.register(() => {
      window.removeEventListener('pointerdown', handleBaseLinkPreviewEvent as EventListener, { capture: true } as any);
      window.removeEventListener('touchstart', handleBaseLinkPreviewEvent as EventListener, { capture: true } as any);
    });
    this.registerDomEvent(document, 'pointerdown', handleBaseLinkPreviewEvent, { capture: true });
    this.registerDomEvent(document, 'touchstart', handleBaseLinkPreviewEvent, { capture: true, passive: false });
    this.registerDomEvent(document, 'mousedown', handleBaseLinkPreviewEvent, { capture: true });
    this.registerDomEvent(document, 'click', handleBaseLinkPreviewEvent, { capture: true });
  }

  private isBasesForcedLinkPreviewEnabled(): boolean {
    return !Platform.isMobile && this.settings.enableBasesForcedLinkPreview === true;
  }

  private shouldInstallWorkspaceOpenPatch(): boolean {
    return this.settings.enableCanvasOpenGuard === true || this.isBasesForcedLinkPreviewEnabled();
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

  private shouldAllowNativeBaseLinkOpen(file: TFile): boolean {
    if (!this.isBasesForcedLinkPreviewEnabled()) return true;
    if (Date.now() <= this.recentNotebookNavigatorOpenUntil) return true;
    if (this.openingBaseLinkHoverEditorPath === file.path) return true;
    return (
      this.basesLinkPreviewNativeOpenPath === file.path &&
      Date.now() <= this.basesLinkPreviewNativeOpenUntil
    );
  }

  private interceptNativeBaseLinkOpen(file: TFile, leaf: WorkspaceLeaf): boolean {
    if (!this.isBasesForcedLinkPreviewEnabled()) return false;
    if (file.extension.toLowerCase() !== 'md') return false;

    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile) || activeFile.extension.toLowerCase() !== 'base') return false;

    const activeLeaf = this.app.workspace.activeLeaf;
    if (leaf !== activeLeaf) return false;

    const now = Date.now();
    const isSecondClick =
      this.basesLinkPreviewArmedPath === file.path &&
      now <= this.basesLinkPreviewArmedUntil;

    if (isSecondClick) {
      this.basesLinkPreviewArmedPath = null;
      this.basesLinkPreviewArmedUntil = 0;
      this.persistentMenuManager.hideBaseLinkEditablePreview();
      this.basesLinkPreviewNativeOpenPath = file.path;
      this.basesLinkPreviewNativeOpenUntil = now + 1000;
      return false;
    }

    if (now > this.recentBaseLinkPreviewPointerUntil) return false;
    this.basesLinkPreviewArmedPath = file.path;
    this.basesLinkPreviewArmedUntil = now + 9000;
    const leafEl = (leaf as any).containerEl as HTMLElement | undefined;
    const recentAnchor = this.recentBaseLinkPreviewAnchorEl;
    const recentPoint = this.recentBaseLinkPreviewPointerPoint;
    const currentPointTarget = recentPoint
      ? document.elementFromPoint(recentPoint.x, recentPoint.y)
      : null;
    const currentPointEl = currentPointTarget instanceof HTMLElement
      ? currentPointTarget
      : currentPointTarget instanceof Element
        ? currentPointTarget.closest<HTMLElement>('*')
        : null;
    if (
      !recentAnchor?.isConnected
      || !this.getAllowedBaseLinkPreviewRoot(recentAnchor)
      || !this.getAllowedBaseLinkPreviewRoot(currentPointEl)
      || (leafEl && !leafEl.contains(recentAnchor))
    ) {
      return false;
    }
    const resolvedAnchor = this.resolveBasesNoteLinkTarget(recentAnchor);
    if (resolvedAnchor?.file.path !== file.path) return false;
    const anchorEl = recentAnchor?.isConnected && (!leafEl || leafEl.contains(recentAnchor))
      ? recentAnchor
      : leafEl ?? document.body;
    this.contextTargetService.recordContextTarget(anchorEl);
    this.persistentMenuManager.hideBaseLinkEditablePreview();
    void this.openBaseLinkInHoverEditor(file, anchorEl).then((opened) => {
      if (!opened) {
        const fallbackEvent = new MouseEvent('mouseover', { bubbles: true, cancelable: true });
        this.showNativeBaseLinkPreview(fallbackEvent, file, anchorEl);
      }
    });
    return true;
  }

  private async openBaseLinkInHoverEditor(file: TFile, anchorEl: HTMLElement): Promise<boolean> {
    const hoverEditorPlugin = getPluginById(this.app, 'obsidian-hover-editor') as any;
    const spawnPopover = hoverEditorPlugin?.spawnPopover;
    if (typeof spawnPopover !== 'function') return false;

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
    if (direct instanceof TFile && direct.extension.toLowerCase() === 'md') return direct;

    const withMd = raw.toLowerCase().endsWith('.md') ? raw : `${raw}.md`;
    const directMd = this.app.vault.getAbstractFileByPath(withMd);
    if (directMd instanceof TFile && directMd.extension.toLowerCase() === 'md') return directMd;

    const basename = raw.replace(/\.md$/i, '');
    const basenameMatch = this.app.vault.getMarkdownFiles().find((file) => (
      file.path === withMd ||
      file.name.toLowerCase() === withMd.toLowerCase() ||
      file.basename.toLowerCase() === basename.toLowerCase()
    ));
    if (basenameMatch) return basenameMatch;

    const normalizedCandidate = raw.toLowerCase().replace(/\s+/g, '');
    const cardTextPrefixMatch = this.app.vault.getMarkdownFiles().find((file) => {
      const normalizedBasename = file.basename.toLowerCase().replace(/\s+/g, '');
      return (
        normalizedBasename.length >= 3 &&
        normalizedCandidate.startsWith(normalizedBasename) &&
        normalizedCandidate.length <= normalizedBasename.length + 48
      );
    });
    if (cardTextPrefixMatch) return cardTextPrefixMatch;

    const linked = this.app.metadataCache.getFirstLinkpathDest(raw.replace(/\.md$/i, ''), '');
    return linked instanceof TFile && linked.extension.toLowerCase() === 'md'
      ? linked
      : null;
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
      this.enhanceBasesPreviewProperties(root, force);
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
    if (existing && (existingIsCurrent || (!force && root.dataset.tpsGcmPreviewPropertiesPath === file.path))) {
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
    if (direct instanceof TFile && direct.extension.toLowerCase() === 'md') return direct;

    const withMd = raw.toLowerCase().endsWith('.md') ? raw : `${raw}.md`;
    const mdFile = this.app.vault.getAbstractFileByPath(withMd);
    if (mdFile instanceof TFile && mdFile.extension.toLowerCase() === 'md') return mdFile;

    const linkTarget = this.app.metadataCache.getFirstLinkpathDest(raw.replace(/\.md$/i, ''), '');
    return linkTarget instanceof TFile && linkTarget.extension.toLowerCase() === 'md'
      ? linkTarget
      : null;
  }

  private resolveMarkdownFileByTitle(title: string): TFile | null {
    const normalizedTitle = title.trim().toLowerCase();
    if (!normalizedTitle) return null;

    return this.app.vault.getMarkdownFiles()
      .filter((file) => {
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
    this.workspaceRibbonService?.teardown();
    delete (this as any).api;
    if (this.restoreCanvasOpenGuard) {
      this.restoreCanvasOpenGuard();
      this.restoreCanvasOpenGuard = null;
    }
    if (this.restoreProcessFrontmatterPatch) {
      this.restoreProcessFrontmatterPatch();
      this.restoreProcessFrontmatterPatch = null;
    }
    if (this.restoreMenuPatch) {
      this.restoreMenuPatch();
      this.restoreMenuPatch = null;
    }
    this.menuController?.detach();
    this.removeStyles();
    this.persistentMenuManager?.detach();
    this.recurrenceService?.cleanup();
    this.timeTrackingStatusBarService?.detach();
    this.taskLineDragService?.dispose();
    this.taskCheckboxHandler?.dispose();
    this.linkedSubitemCheckboxService?.detach();
    this.hideCompletedCheckboxesService?.detach();
    this.notebookNavigatorRuleService?.dispose();
    this.stopArchiveTagAutomation();
    document.body?.classList?.remove('tps-context-hidden-for-keyboard');
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<TPSGlobalContextMenuSettings> & {
      enableShiftClickCancel?: boolean;
      archiveFolder?: string;
    } | null;
    let notebookNavigatorRulePayload = this.resolveNotebookNavigatorRuleSettingsPayload(loaded);
    if (!notebookNavigatorRulePayload) {
      notebookNavigatorRulePayload = this.resolveNotebookNavigatorRuleSettingsPayload(
        await this.loadLegacyNotebookNavigatorCompanionSettings(),
      );
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
    this.stripLegacySettingsFields(this.settings as unknown as Record<string, unknown>);
    this.settings.properties = this.removeHealthCustomProperties(this.normalizeCustomProperties(this.settings.properties));
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
    if (this.settings.topParentNavPlacement !== 'top' && this.settings.topParentNavPlacement !== 'bottom') {
      this.settings.topParentNavPlacement = DEFAULT_SETTINGS.topParentNavPlacement;
    }
    this.settings.parentLinkFormat = normalizeParentLinkFormat(this.settings.parentLinkFormat);
    this.settings.enableBasesForcedLinkPreview = this.settings.enableBasesForcedLinkPreview === true;
    this.settings.hideCompletedCheckboxes = this.settings.hideCompletedCheckboxes === true;
    this.settings.hideAllTaskLinesInReadingMode = this.settings.hideAllTaskLinesInReadingMode === true;
    this.settings.taskHidingExclusionPatterns = String(this.settings.taskHidingExclusionPatterns ?? '').trim();
    this.settings.persistTaskVisibilityStateToFrontmatter = this.settings.persistTaskVisibilityStateToFrontmatter === true;
    this.settings.taskVisibilityStateFrontmatterKey = String(this.settings.taskVisibilityStateFrontmatterKey || DEFAULT_SETTINGS.taskVisibilityStateFrontmatterKey).trim() || DEFAULT_SETTINGS.taskVisibilityStateFrontmatterKey;
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
    this.settings.timeTrackingSingleActiveSession = this.settings.timeTrackingSingleActiveSession !== false;
    this.settings.enableAutoPinActiveNotes = this.settings.enableAutoPinActiveNotes === true;
    this.settings.autoPinActiveScheduledNotes = this.settings.autoPinActiveScheduledNotes !== false;
    const autoPinDefaultMinutes = Number(this.settings.autoPinScheduledDefaultMinutes);
    this.settings.autoPinScheduledDefaultMinutes = Number.isFinite(autoPinDefaultMinutes) && autoPinDefaultMinutes > 0
      ? Math.round(autoPinDefaultMinutes)
      : DEFAULT_SETTINGS.autoPinScheduledDefaultMinutes;
    this.settings.autoPinFrontmatterRules = String(this.settings.autoPinFrontmatterRules || '').trim();
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
    const migratedMappings = Array.isArray(this.settings.linkedSubitemCheckboxMappings)
      ? this.settings.linkedSubitemCheckboxMappings
      : [];
    if (migratedMappings.length === 0) {
      this.settings.linkedSubitemCheckboxMappings = this.normalizeStrictLinkedSubitemMappings([
        {
          checkboxState: '[ ]',
          toggleTargetStatus: String(loaded?.linkedSubitemToggleCheckedStatus || 'complete').trim() || 'complete',
          icon: 'square',
          label: 'Todo',
        },
        {
          checkboxState: '[x]',
          toggleTargetStatus: String(loaded?.linkedSubitemToggleUncheckedStatus || 'todo').trim() || 'todo',
          icon: 'check',
          label: 'Complete',
        },
        {
          checkboxState: '[-]',
          toggleTargetStatus: String(loaded?.linkedSubitemToggleUncheckedStatus || 'todo').trim() || 'todo',
          icon: 'minus',
          label: 'Won’t Do',
        },
      ]);
    }
    this.settings.linkedSubitemDefaultOpenState = String(this.settings.linkedSubitemDefaultOpenState || '[ ]').trim() || '[ ]';
    this.settings.linkedSubitemCheckboxMappings = this.normalizeStrictLinkedSubitemMappings(
      this.settings.linkedSubitemCheckboxMappings
        .map((entry) => ({
        checkboxState: String(entry?.checkboxState || '').trim(),
        statuses: Array.isArray(entry?.statuses)
          ? entry.statuses.map((value) => String(value || '').trim()).filter(Boolean)
          : [],
        toggleTargetStatus: String(entry?.toggleTargetStatus || '').trim() || undefined,
        icon: String(entry?.icon || '').trim() || undefined,
        label: String(entry?.label || '').trim() || undefined,
      }))
      .filter((entry) => entry.checkboxState && entry.statuses.length > 0),
    );
    if (this.settings.linkedSubitemCheckboxMappings.length === 0) {
      this.settings.linkedSubitemCheckboxMappings = this.getStrictLinkedSubitemMappings();
    }
    logger.setLoggingEnabled(this.settings.enableLogging);
  }

  private normalizeCustomProperties(properties: unknown): TPSGlobalContextMenuSettings['properties'] {
    const source = Array.isArray(properties) ? properties : DEFAULT_SETTINGS.properties;
    return source.map((property) => {
      const normalized = { ...(property as TPSGlobalContextMenuSettings['properties'][number] & { profiles?: unknown }) };
      delete normalized.profiles;
      if (
        normalized.id === 'type' &&
        normalized.key === 'folderPath' &&
        normalized.type === 'folder' &&
        normalized.label === 'Type'
      ) {
        normalized.label = 'Folder';
      }
      if (normalized.type === 'list') {
        normalized.listItemType = normalized.listItemType === 'text'
          ? 'text'
          : normalized.listItemType === 'link'
            ? 'link'
            : 'tag';
      } else {
        delete normalized.listItemType;
      }
      if (normalized.allowInlineSet === undefined) {
        normalized.allowInlineSet = !DEFAULT_INLINE_PROPERTY_DENY_KEYS.has(String(normalized.key || '').trim().toLowerCase());
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

  private removeHealthCustomProperties(
    properties: TPSGlobalContextMenuSettings['properties'],
  ): TPSGlobalContextMenuSettings['properties'] {
    return (properties || []).filter((property) => !LEGACY_HEALTH_CUSTOM_PROPERTY_IDS.has(String(property?.id || '').trim()));
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
    const raw = typeof plugin?.settings?.archiveFolder === 'string' ? plugin.settings.archiveFolder : '';
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
    const resolved = configured || legacy || controller;
    return resolved ? normalizePath(resolved) : '';
  }

  async saveSettings(): Promise<void> {
    this.settings.parentLinkFormat = normalizeParentLinkFormat(this.settings.parentLinkFormat);
    this.stripLegacySettingsFields(this.settings as unknown as Record<string, unknown>);
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
    this.debouncedSave();
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
    const originalOpenLinkText = workspace.openLinkText?.bind(workspace);
    const originalGetLeaf = workspace.getLeaf?.bind(workspace);
    const originalGetUnpinnedLeaf = workspace.getUnpinnedLeaf?.bind(workspace);
    const originalGetRightLeaf = workspace.getRightLeaf?.bind(workspace);
    const originalGetLeftLeaf = workspace.getLeftLeaf?.bind(workspace);
    const originalCreateLeafBySplit = workspace.createLeafBySplit?.bind(workspace);
    const originalCreateLeafInParent = workspace.createLeafInParent?.bind(workspace);
    const originalSplitActiveLeaf = workspace.splitActiveLeaf?.bind(workspace);
    const originalDuplicateLeaf = workspace.duplicateLeaf?.bind(workspace);
    const originalOpenPopoutLeaf = workspace.openPopoutLeaf?.bind(workspace);
    const originalSetActiveLeaf = workspace.setActiveLeaf?.bind(workspace);
    const originalRevealLeaf = workspace.revealLeaf?.bind(workspace);
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
        | 'workspace.openPopoutLeaf'
        | 'workspace.setActiveLeaf'
        | 'workspace.revealLeaf',
      target?: string,
    ) => {
      logger.log('[TPS GCM] Suppressed file open during recent canvas drag', {
        source,
        target,
      });
    };

    const fallbackLeaf = (): WorkspaceLeaf | null => {
      try {
        const leaf = (typeof originalGetUnpinnedLeaf === 'function' ? originalGetUnpinnedLeaf() : undefined)
          ?? (typeof workspace.getLeaf === 'function' ? workspace.getLeaf('tab') : undefined)
          ?? workspace.activeLeaf;
        return leaf ?? null;
      } catch {
        return workspace.activeLeaf ?? (workspace.getLeaf ? workspace.getLeaf('tab') : null) ?? null;
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
            leaf.detach();
            logger.log('[TPS GCM] Detached suppressed blank leaf after recent canvas drag');
          }
        } catch (error) {
          logger.warn('[TPS GCM] Failed to detach suppressed leaf', error);
        }
      }, 0);
    };

    const focusOpenLeaf = (file: TFile, preferredLeaf?: WorkspaceLeaf | null): void => {
      const openedLeaf = plugin.findOpenLeafForFile(file) ?? preferredLeaf ?? null;
      if (!openedLeaf) return;
      plugin.app.workspace.setActiveLeaf(openedLeaf, { focus: true } as any);
      plugin.app.workspace.revealLeaf(openedLeaf);
    };

    const rerouteDefaultMarkdownOpen = (
      file: TFile,
      openNative: (leaf: WorkspaceLeaf) => Promise<unknown>,
    ): Promise<void> => {
      const existingLeaf = plugin.findOpenLeafForFile(file);
      if (existingLeaf) {
        focusOpenLeaf(file, existingLeaf);
        return Promise.resolve();
      }

      const pending = plugin.defaultMarkdownOpenPromises.get(file.path);
      if (pending) {
        return pending.then(() => focusOpenLeaf(file));
      }

      const leaf = plugin.app.workspace.getLeaf(true);
      const promise = Promise.resolve(openNative(leaf))
        .then(() => focusOpenLeaf(file, leaf))
        .finally(() => {
          if (plugin.defaultMarkdownOpenPromises.get(file.path) === promise) {
            plugin.defaultMarkdownOpenPromises.delete(file.path);
          }
        });
      plugin.defaultMarkdownOpenPromises.set(file.path, promise);
      return promise;
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
        return originalGetLeaf(...args);
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
          return workspace.activeLeaf ?? (typeof originalGetLeaf === 'function' ? originalGetLeaf('tab') : null);
        }
        return originalGetUnpinnedLeaf(...args);
      };
    }

    if (typeof originalGetRightLeaf === 'function') {
      workspace.getRightLeaf = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag() && args[0] === true) {
          logSuppressedOpen('workspace.getRightLeaf', 'split');
          return fallbackLeaf();
        }
        return originalGetRightLeaf(...args);
      };
    }

    if (typeof originalGetLeftLeaf === 'function') {
      workspace.getLeftLeaf = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag() && args[0] === true) {
          logSuppressedOpen('workspace.getLeftLeaf', 'split');
          return fallbackLeaf();
        }
        return originalGetLeftLeaf(...args);
      };
    }

    if (typeof originalCreateLeafBySplit === 'function') {
      workspace.createLeafBySplit = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
          logSuppressedOpen('workspace.createLeafBySplit', String(args[1] ?? 'split'));
          return fallbackLeaf();
        }
        return originalCreateLeafBySplit(...args);
      };
    }

    if (typeof originalCreateLeafInParent === 'function') {
      workspace.createLeafInParent = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
          logSuppressedOpen('workspace.createLeafInParent', 'parent');
          return fallbackLeaf();
        }
        return originalCreateLeafInParent(...args);
      };
    }

    if (typeof originalSplitActiveLeaf === 'function') {
      workspace.splitActiveLeaf = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
          logSuppressedOpen('workspace.splitActiveLeaf', String(args[0] ?? 'split'));
          return fallbackLeaf();
        }
        return originalSplitActiveLeaf(...args);
      };
    }

    if (typeof originalDuplicateLeaf === 'function') {
      workspace.duplicateLeaf = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
          logSuppressedOpen('workspace.duplicateLeaf', String(args[1] ?? 'duplicate'));
          return Promise.resolve(fallbackLeaf());
        }
        return originalDuplicateLeaf(...args);
      };
    }

    if (typeof originalOpenPopoutLeaf === 'function') {
      workspace.openPopoutLeaf = function (...args: any[]) {
        if (plugin.shouldSuppressOpenForRecentCanvasDrag()) {
          logSuppressedOpen('workspace.openPopoutLeaf', 'window');
          return fallbackLeaf();
        }
        return originalOpenPopoutLeaf(...args);
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
      if (targetFile && !plugin.shouldAllowNativeBaseLinkOpen(targetFile) && plugin.interceptNativeBaseLinkOpen(targetFile, this)) {
        return Promise.resolve(undefined as any);
      }
      if (targetFile && plugin.shouldRerouteDefaultMarkdownOpen(this, targetFile, args[1])) {
        return rerouteDefaultMarkdownOpen(
          targetFile,
          (leaf) => originalLeafOpenFile.apply(leaf, args as any),
        ) as Promise<any>;
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
      const targetFile = typeof target === 'string'
        ? plugin.app.vault.getAbstractFileByPath(target)
        : null;
      if (
        targetFile instanceof TFile
        && viewState?.type === 'markdown'
        && plugin.shouldRerouteDefaultMarkdownOpen(this, targetFile, viewState)
      ) {
        return rerouteDefaultMarkdownOpen(
          targetFile,
          (leaf) => originalLeafSetViewState.apply(leaf, args as any),
        ) as Promise<any>;
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
        return originalOpenLinkText(...args);
      };
    }

    if (typeof originalSetActiveLeaf === 'function') {
      workspace.setActiveLeaf = function (...args: any[]) {
        const targetLeaf = args[0] as WorkspaceLeaf | null | undefined;
        if (
          plugin.shouldSuppressOpenForRecentCanvasDrag()
          && targetLeaf
          && targetLeaf !== workspace.activeLeaf
        ) {
          logSuppressedOpen(
            'workspace.setActiveLeaf',
            (targetLeaf as any)?.view?.getViewType?.() ?? 'unknown',
          );
          return undefined;
        }
        return originalSetActiveLeaf(...args);
      };
    }

    if (typeof originalRevealLeaf === 'function') {
      workspace.revealLeaf = function (...args: any[]) {
        const targetLeaf = args[0] as WorkspaceLeaf | null | undefined;
        if (
          plugin.shouldSuppressOpenForRecentCanvasDrag()
          && targetLeaf
          && targetLeaf !== workspace.activeLeaf
        ) {
          logSuppressedOpen(
            'workspace.revealLeaf',
            (targetLeaf as any)?.view?.getViewType?.() ?? 'unknown',
          );
          return Promise.resolve(undefined);
        }
        return originalRevealLeaf(...args);
      };
    }

    return () => {
      WorkspaceLeaf.prototype.openFile = originalLeafOpenFile;
      WorkspaceLeaf.prototype.open = originalLeafOpen;
      WorkspaceLeaf.prototype.setViewState = originalLeafSetViewState;
      if (typeof originalGetLeaf === 'function') {
        workspace.getLeaf = originalGetLeaf;
      }
      if (typeof originalGetUnpinnedLeaf === 'function') {
        workspace.getUnpinnedLeaf = originalGetUnpinnedLeaf;
      }
      if (typeof originalGetRightLeaf === 'function') {
        workspace.getRightLeaf = originalGetRightLeaf;
      }
      if (typeof originalGetLeftLeaf === 'function') {
        workspace.getLeftLeaf = originalGetLeftLeaf;
      }
      if (typeof originalCreateLeafBySplit === 'function') {
        workspace.createLeafBySplit = originalCreateLeafBySplit;
      }
      if (typeof originalCreateLeafInParent === 'function') {
        workspace.createLeafInParent = originalCreateLeafInParent;
      }
      if (typeof originalSplitActiveLeaf === 'function') {
        workspace.splitActiveLeaf = originalSplitActiveLeaf;
      }
      if (typeof originalDuplicateLeaf === 'function') {
        workspace.duplicateLeaf = originalDuplicateLeaf;
      }
      if (typeof originalOpenPopoutLeaf === 'function') {
        workspace.openPopoutLeaf = originalOpenPopoutLeaf;
      }
      if (typeof originalOpenLinkText === 'function') {
        workspace.openLinkText = originalOpenLinkText;
      }
      if (typeof originalSetActiveLeaf === 'function') {
        workspace.setActiveLeaf = originalSetActiveLeaf;
      }
      if (typeof originalRevealLeaf === 'function') {
        workspace.revealLeaf = originalRevealLeaf;
      }
    };
  }

  private installProcessFrontmatterPatch(): () => void {
    const fileManager = this.app.fileManager as any;
    const original = fileManager.processFrontMatter?.bind(fileManager);
    if (typeof original !== 'function') {
      return () => {};
    }
    this.nativeProcessFrontmatterDelegate = original;

    const plugin = this;
    const gcmProcessFrontmatterPatch = async function (
      file: TFile,
      mutator: (frontmatter: Record<string, unknown>) => void | Promise<void>,
    ) {
      return await plugin.frontmatterMutationService.process(file, mutator);
    };
    (gcmProcessFrontmatterPatch as any).__tpsGcmFrontmatterPatch = true;
    fileManager.processFrontMatter = gcmProcessFrontmatterPatch;

    return () => {
      fileManager.processFrontMatter = original;
      this.nativeProcessFrontmatterDelegate = null;
    };
  }

  async processFrontmatterWithNativeDelegate(
    file: TFile,
    mutator: (frontmatter: Record<string, unknown>) => void | Promise<void>,
    options?: unknown,
  ): Promise<unknown> {
    if (typeof this.nativeProcessFrontmatterDelegate !== 'function') {
      throw new Error('Native frontmatter delegate is not available.');
    }
    return await this.nativeProcessFrontmatterDelegate(file, mutator, options);
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
    await this.saveData(this.settings);
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

  private shouldRerouteDefaultMarkdownOpen(leaf: WorkspaceLeaf, file: TFile, openState: unknown): boolean {
    if (file.extension !== 'md') return false;

    const openStateRecord = openState && typeof openState === 'object'
      ? openState as Record<string, unknown>
      : null;
    if (openStateRecord?.active === false) return false;
    if (openStateRecord?.openState === 'hover') return false;

    const leafAny = leaf as any;
    if (leafAny.hoverPopover) return false;
    if (leafAny.containerEl instanceof HTMLElement && leafAny.containerEl.closest('.popover, .hover-popover')) {
      return false;
    }

    if (this.isPinnedLeafForDifferentFile(leaf, file)) return true;

    const viewFile = (leaf.view as any)?.file;
    if (viewFile instanceof TFile) return viewFile.path !== file.path;

    try {
      const state = leaf.getViewState?.() as any;
      const path = typeof state?.state?.file === 'string'
        ? state.state.file
        : typeof state?.state?.path === 'string'
          ? state.state.path
          : '';
      return path.length > 0 && path !== file.path;
    } catch {
      return false;
    }
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
    if (!options?.ignoreCanvasDragGuard && this.shouldSuppressOpenForRecentCanvasDrag()) {
      logger.log('[TPS GCM] Suppressed openFileInLeaf before context creation', {
        file: file.path,
        context,
      });
      return false;
    }

    const openActive = options?.active ?? true;
    const revealLeaf = options?.revealLeaf !== false;
    const shouldOpenMissingDefaultInNewTab =
      context === false
      && openActive
      && revealLeaf
      && options?.reuseLeafIfNoExisting !== true;
    const existingLeaf = this.findOpenLeafForFile(file);
    if (existingLeaf) {
      if (openActive) {
        this.app.workspace.setActiveLeaf(existingLeaf, { focus: true } as any);
      }
      if (revealLeaf) {
        this.app.workspace.revealLeaf(existingLeaf);
      }
      return true;
    }

    const openFile = async () => {
      let leaf = shouldOpenMissingDefaultInNewTab
        ? this.app.workspace.getLeaf(true)
        : getLeaf();
      if (!leaf) {
        throw new Error('No workspace leaf available');
      }
      if (this.isPinnedLeafForDifferentFile(leaf, file)) {
        leaf = this.app.workspace.getLeaf(true);
      }
      await leaf.openFile(file, { active: openActive } as any);
      const openedLeaf = this.findOpenLeafForFile(file) ?? leaf;
      if (openActive) {
        this.app.workspace.setActiveLeaf(openedLeaf, { focus: true } as any);
      }
      if (revealLeaf) {
        this.app.workspace.revealLeaf(openedLeaf);
      }
    };

    const result = context === false
      ? await this.commandQueueService.executeOpenActiveFile(file, openFile)
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

  findOpenLeafForFile(file: TFile): WorkspaceLeaf | null {
    let match: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (match) return;
      const viewFile = (leaf.view as any)?.file;
      if (viewFile instanceof TFile && viewFile.path === file.path) {
        match = leaf;
        return;
      }
      try {
        const state = leaf.getViewState?.() as any;
        const statePath = typeof state?.state?.file === 'string'
          ? state.state.file
          : typeof state?.state?.path === 'string'
            ? state.state.path
            : '';
        if (state?.type === 'markdown' && statePath === file.path) {
          match = leaf;
        }
      } catch {
        // Fall through; not every leaf exposes a stable state during layout changes.
      }
    });
    return match;
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

  // Mobile keyboard watcher moved to PersistentMenuManager

}
