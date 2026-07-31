import { Component, MarkdownView, Platform, TFile, TFolder, WorkspaceLeaf, debounce } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { parseDailyNoteFileDate } from '../utils/daily-note-task-schedule';
import {
  collectNotebookNavigatorSelectionPaths,
  isNotebookNavigatorSelectionGesture,
  NotebookNavigatorHomeIntentTracker,
  type NotebookNavigatorMultiSelectModifier,
} from '../utils/notebook-navigator-home-intent';
import { TPS_HOME_VIEW_TYPE } from '../views/home-view';
import * as logger from '../logger';

type NotebookNavigatorFileInteraction = { file: TFile; scopeRoot: HTMLElement };
type BoundLeafView = 'home' | 'home-unresolved' | 'markdown' | 'native';
type HomeLeafFileBinding = {
  file: TFile;
  expectedPath: string;
  expectedView: BoundLeafView;
};
type PendingHomeLeafRename = HomeLeafFileBinding & {
  alternateExpectedState?: Pick<HomeLeafFileBinding, 'expectedPath' | 'expectedView'>;
  immediateRetriesRemaining: number;
};
type PendingHomeLeafDelete = {
  deletedPath: string;
  expectedPath: string;
  immediateRetriesRemaining: number;
};
type StartupRenameRecord =
  | { kind: 'file'; file: TFile; oldPath: string; newPath: string }
  | {
    kind: 'folder';
    oldPath: string;
    newPath: string;
    descendants: Array<{ file: TFile; oldPath: string; newPath: string }>;
  };

export class DailyNoteHomeService extends Component {
  private readonly applyingLeaves = new WeakSet<WorkspaceLeaf>();
  private readonly applyingLeafSourceBindings = new WeakMap<WorkspaceLeaf, HomeLeafFileBinding>();
  private readonly notebookNavigatorHomeIntent = new NotebookNavigatorHomeIntentTracker<WorkspaceLeaf>();
  private notebookNavigatorInteractionGeneration = 0;
  private livePreviewOverride: { leaf: WorkspaceLeaf; path: string } | null = null;
  private runtimeScope: Component | null = null;
  private restorationScope: Component | null = null;
  private runtimeGeneration = 0;
  private reconciliationPromise: Promise<void> | null = null;
  private reconciliationRequested = false;
  private readonly homeLeafFileBindings = new WeakMap<WorkspaceLeaf, HomeLeafFileBinding>();
  private readonly pendingHomeLeafRenames = new Map<WorkspaceLeaf, PendingHomeLeafRename>();
  private readonly pendingHomeLeafDeletes = new Map<WorkspaceLeaf, PendingHomeLeafDelete>();
  private readonly knownDeletedPaths = new Map<string, boolean>();
  private readonly startupRenameRecords: StartupRenameRecord[] = [];
  private lifecycleInitialized = false;
  private enabled = false;
  private serviceUnloaded = false;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {
    super();
  }

  onload(): void {
    this.serviceUnloaded = false;
    void this.initializeEnabledState().catch((error) => {
      logger.flowError('DailyNoteHome', 'setting:startup-initialize-failed', error);
    });
  }

  private async initializeEnabledState(): Promise<void> {
    const requestedEnabled = this.plugin.settings.enableDailyNoteHome !== false;
    const applied = await this.setEnabled(requestedEnabled);
    if (requestedEnabled || applied) return;

    this.plugin.settings.enableDailyNoteHome = true;
    await this.setEnabled(true);
    try {
      await this.plugin.saveSettings();
    } catch (error) {
      logger.flowError('DailyNoteHome', 'setting:startup-rollback-save-failed', error);
    }
    logger.flowWarn('DailyNoteHome', 'setting:startup-disable-rolled-back');
  }

  onunload(): void {
    this.serviceUnloaded = true;
    this.enabled = false;
    this.runtimeGeneration += 1;
    this.runtimeScope = null;
    this.restorationScope = null;
    this.reconciliationPromise = null;
    this.reconciliationRequested = false;
    this.pendingHomeLeafRenames.clear();
    this.pendingHomeLeafDeletes.clear();
    this.knownDeletedPaths.clear();
    this.startupRenameRecords.length = 0;
    this.lifecycleInitialized = false;
    this.livePreviewOverride = null;
    this.notebookNavigatorInteractionGeneration += 1;
    this.notebookNavigatorHomeIntent.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isAvailable(): boolean {
    return !this.serviceUnloaded;
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    if (this.serviceUnloaded) return false;
    const nextEnabled = enabled === true;
    if (
      this.lifecycleInitialized
      && this.enabled === nextEnabled
      && Boolean(this.runtimeScope) === nextEnabled
      && (nextEnabled || !this.hasDateBackedHomeLeaves())
    ) return true;

    this.lifecycleInitialized = true;
    this.enabled = nextEnabled;
    const generation = ++this.runtimeGeneration;
    if (this.restorationScope) {
      this.removeChild(this.restorationScope);
      this.restorationScope = null;
    }
    let restorationScope: Component | null = null;
    let restorationReady = false;
    if (!nextEnabled) {
      restorationScope = this.addChild(new Component());
      this.restorationScope = restorationScope;
      this.registerRenameListener(
        restorationScope,
        generation,
        false,
        () => restorationReady,
        () => !restorationReady,
      );
      this.registerDeleteListener(
        restorationScope,
        generation,
        false,
        () => restorationReady,
      );
    }
    if (this.runtimeScope) {
      this.removeChild(this.runtimeScope);
      this.runtimeScope = null;
    }
    this.livePreviewOverride = null;
    this.notebookNavigatorInteractionGeneration += 1;
    this.notebookNavigatorHomeIntent.clear();

    if (!nextEnabled) {
      try {
        await new Promise<void>((resolve) => this.plugin.app.workspace.onLayoutReady(resolve));
        if (!this.isRuntimeGenerationCurrent(generation, false)) return true;
        restorationReady = true;
        this.bindStartupRenamedHomeLeaves();
        await this.requestReconciliation();
        if (!this.isRuntimeGenerationCurrent(generation, false)) return true;
        const remaining = this.countDateBackedHomeLeaves();
        if (remaining > 0) {
          this.lifecycleInitialized = false;
          logger.flowWarn('DailyNoteHome', 'setting:disable-incomplete', { remaining });
          return false;
        }
        logger.flow('DailyNoteHome', 'setting:disabled', { restored: true });
      } finally {
        if (this.restorationScope === restorationScope && restorationScope) {
          this.removeChild(restorationScope);
          this.restorationScope = null;
        }
      }
      return true;
    }

    const scope = new Component();
    this.runtimeScope = this.addChild(scope);
    let layoutReady = false;
    const schedule = debounce(() => {
      if (!layoutReady) return;
      if (!this.isRuntimeGenerationCurrent(generation, true)) return;
      void this.requestReconciliation();
    }, 60, false);
    scope.register(() => schedule.cancel());
    scope.registerDomEvent(document, 'click', (event) => {
      this.handleNotebookNavigatorClick(event, schedule);
    }, true);
    scope.registerDomEvent(document, 'dragstart', (event) => {
      this.handleNotebookNavigatorDragStart(event, schedule);
    }, true);
    scope.register(() => {
      this.notebookNavigatorInteractionGeneration += 1;
      this.notebookNavigatorHomeIntent.clear();
    });
    scope.registerEvent(this.plugin.app.workspace.on('active-leaf-change', (leaf) => {
      if (this.livePreviewOverride && leaf !== this.livePreviewOverride.leaf) {
        this.livePreviewOverride = null;
      }
      schedule();
    }));
    scope.registerEvent(this.plugin.app.workspace.on('file-open', schedule));
    scope.registerEvent(this.plugin.app.workspace.on('layout-change', schedule));
    this.registerRenameListener(
      scope,
      generation,
      true,
      () => layoutReady,
      () => !layoutReady,
    );
    this.registerDeleteListener(scope, generation, true, () => layoutReady);
    scope.registerEvent(this.plugin.app.vault.on('create', (created) => {
      if (!this.isRuntimeGenerationCurrent(generation, true) || !(created instanceof TFile)) return;
      this.knownDeletedPaths.delete(created.path);
      if (layoutReady) void this.requestReconciliation();
    }));
    this.plugin.app.workspace.onLayoutReady(() => {
      if (!this.isRuntimeGenerationCurrent(generation, true)) return;
      layoutReady = true;
      this.bindStartupRenamedHomeLeaves();
      void this.requestReconciliation();
    });
    logger.flow('DailyNoteHome', 'setting:enabled');
    return true;
  }

  private hasDateBackedHomeLeaves(): boolean {
    return this.countDateBackedHomeLeaves() > 0;
  }

  private countDateBackedHomeLeaves(): number {
    let count = 0;
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (this.getHomeLeafState(leaf)) count += 1;
    });
    return count;
  }

  private isRuntimeGenerationCurrent(generation: number, expectedEnabled: boolean): boolean {
    return generation === this.runtimeGeneration && this.enabled === expectedEnabled;
  }

  private registerRenameListener(
    scope: Component,
    generation: number,
    expectedEnabled: boolean,
    shouldRequestReconciliation: () => boolean = () => true,
    shouldRecordStartupRename: () => boolean = () => false,
  ): void {
    scope.registerEvent(this.plugin.app.vault.on('rename', (file, oldPath) => {
      if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) return;
      const previousPath = String(oldPath || '').trim();
      const currentPath = String(file.path || '').trim();
      if (!previousPath || !currentPath || previousPath === currentPath) return;

      if (file instanceof TFile) {
        if (shouldRecordStartupRename()) {
          this.startupRenameRecords.push({
            kind: 'file',
            file,
            oldPath: previousPath,
            newPath: currentPath,
          });
        }
        this.captureRenamedFile(file, previousPath);
        if (shouldRequestReconciliation()) void this.requestReconciliation();
      } else if (file instanceof TFolder) {
        if (shouldRecordStartupRename()) {
          this.startupRenameRecords.push(
            this.createStartupFolderRenameRecord(previousPath, currentPath),
          );
        }
        this.captureRenamedFolder(file, previousPath);
        if (shouldRequestReconciliation()) void this.requestReconciliation();
      }
    }));
  }

  private registerDeleteListener(
    scope: Component,
    generation: number,
    expectedEnabled: boolean,
    shouldRequestReconciliation: () => boolean,
  ): void {
    scope.registerEvent(this.plugin.app.vault.on('delete', (deleted) => {
      if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) return;
      if (deleted instanceof TFile) {
        this.captureDeletedPath(deleted.path, deleted);
      } else if (deleted instanceof TFolder) {
        this.captureDeletedPath(deleted.path, null, true);
      } else {
        return;
      }
      if (shouldRequestReconciliation()) void this.requestReconciliation();
    }));
  }

  private createStartupFolderRenameRecord(oldPath: string, newPath: string): StartupRenameRecord {
    const oldPrefix = `${oldPath.replace(/\/$/u, '')}/`;
    const newPrefix = `${newPath.replace(/\/$/u, '')}/`;
    const descendants = this.plugin.app.vault.getFiles()
      .filter((file) => file.path.startsWith(newPrefix))
      .map((file) => ({
        file,
        oldPath: `${oldPrefix}${file.path.slice(newPrefix.length)}`,
        newPath: file.path,
      }));
    return { kind: 'folder', oldPath, newPath, descendants };
  }

  private captureDeletedPath(deletedPath: string, deletedFile: TFile | null, folder = false): void {
    const normalizedPath = String(deletedPath || '').replace(/\/$/u, '');
    if (!normalizedPath) return;
    this.knownDeletedPaths.set(normalizedPath, folder);
    const prefix = `${normalizedPath}/`;

    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      const home = this.getHomeLeafState(leaf);
      const source = this.applyingLeafSourceBindings.get(leaf);
      const binding = this.homeLeafFileBindings.get(leaf);
      const pendingRename = this.pendingHomeLeafRenames.get(leaf);
      const exactFileMatch = deletedFile !== null && (
        source?.file === deletedFile
        || binding?.file === deletedFile
        || pendingRename?.file === deletedFile
      );
      const homePathMatch = Boolean(home) && (
        folder ? home!.path.startsWith(prefix) : home!.path === normalizedPath
      );
      if (!exactFileMatch && !homePathMatch) return;

      const expectedPath = home?.path
        ?? source?.expectedPath
        ?? binding?.expectedPath
        ?? pendingRename?.expectedPath
        ?? normalizedPath;
      this.pendingHomeLeafDeletes.set(leaf, {
        deletedPath: normalizedPath,
        expectedPath,
        immediateRetriesRemaining: 1,
      });
      this.pendingHomeLeafRenames.delete(leaf);
      this.homeLeafFileBindings.delete(leaf);
    });
  }

  private bindStartupRenamedHomeLeaves(): void {
    const records = this.startupRenameRecords.splice(0);
    if (records.length === 0) return;

    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (this.homeLeafFileBindings.has(leaf) || this.pendingHomeLeafRenames.has(leaf)) return;
      const home = this.getHomeLeafState(leaf);
      if (!home) return;

      let trackedPath = home.path;
      let trackedFile: TFile | null = null;
      let matched = false;
      for (const record of records) {
        if (record.kind === 'file') {
          if (trackedFile) {
            if (record.file !== trackedFile || record.oldPath !== trackedPath) continue;
          } else if (record.oldPath !== trackedPath) {
            continue;
          }
          trackedFile = record.file;
          trackedPath = record.newPath;
          matched = true;
          continue;
        }

        const descendant = record.descendants.find((candidate) => trackedFile
          ? candidate.file === trackedFile && candidate.oldPath === trackedPath
          : candidate.oldPath === trackedPath);
        if (!descendant) continue;
        trackedFile = descendant.file;
        trackedPath = descendant.newPath;
        matched = true;
      }
      if (!matched) return;

      const file = trackedFile
        ? this.isLiveFile(trackedFile) ? trackedFile : null
        : this.plugin.app.vault.getAbstractFileByPath(trackedPath);
      if (!(file instanceof TFile)) {
        if (trackedFile) {
          this.pendingHomeLeafDeletes.set(leaf, {
            deletedPath: trackedPath,
            expectedPath: home.path,
            immediateRetriesRemaining: 1,
          });
        }
        logger.flowWarn('DailyNoteHome', 'startup-rename:target-missing', {
          previousPath: home.path,
          path: trackedPath,
        });
        return;
      }
      const binding: HomeLeafFileBinding = {
        file,
        expectedPath: home.path,
        expectedView: this.isUnresolvedHomeView(leaf) ? 'home-unresolved' : 'home',
      };
      this.homeLeafFileBindings.set(leaf, binding);
      this.queueBoundLeafRename(leaf, binding);
    });
  }

  private captureRenamedFile(file: TFile, oldPath: string): void {
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      const binding = this.resolveBindingForRename(leaf);
      if (binding?.file === file) {
        this.queueBoundLeafRename(leaf, binding);
        return;
      }

      if (binding) return;
      const home = this.getHomeLeafState(leaf);
      if (!home || home.path !== oldPath) return;
      const nextBinding: HomeLeafFileBinding = {
        file,
        expectedPath: home.path,
        expectedView: this.isUnresolvedHomeView(leaf) ? 'home-unresolved' : 'home',
      };
      this.homeLeafFileBindings.set(leaf, nextBinding);
      this.queueBoundLeafRename(leaf, nextBinding);
    });
  }

  private captureRenamedFolder(folder: TFolder, oldPath: string): void {
    const oldPrefix = `${oldPath.replace(/\/$/u, '')}/`;
    const newPrefix = `${String(folder.path || '').replace(/\/$/u, '')}/`;
    if (oldPrefix === '/' || newPrefix === '/') return;

    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      const binding = this.resolveBindingForRename(leaf);
      if (binding && binding.file.path.startsWith(newPrefix)) {
        this.queueBoundLeafRename(leaf, binding);
        return;
      }
      if (binding) return;

      const home = this.getHomeLeafState(leaf);
      if (!home?.path.startsWith(oldPrefix)) return;
      const nextPath = `${newPrefix}${home.path.slice(oldPrefix.length)}`;
      const file = this.plugin.app.vault.getAbstractFileByPath(nextPath);
      if (!(file instanceof TFile)) return;
      const nextBinding: HomeLeafFileBinding = {
        file,
        expectedPath: home.path,
        expectedView: this.isUnresolvedHomeView(leaf) ? 'home-unresolved' : 'home',
      };
      this.homeLeafFileBindings.set(leaf, nextBinding);
      this.queueBoundLeafRename(leaf, nextBinding);
    });
  }

  private resolveBindingForRename(leaf: WorkspaceLeaf): HomeLeafFileBinding | null {
    const existing = this.homeLeafFileBindings.get(leaf) ?? null;
    if (this.applyingLeaves.has(leaf) && existing && this.isLiveFile(existing.file)) return existing;

    const pending = this.pendingHomeLeafRenames.get(leaf);
    if (pending && this.isLiveFile(pending.file) && this.isLeafAtPendingRename(leaf, pending)) {
      this.homeLeafFileBindings.set(leaf, pending);
      return pending;
    }
    if (pending) this.pendingHomeLeafRenames.delete(leaf);

    if (existing && this.isLiveFile(existing.file) && this.isLeafAtBinding(leaf, existing)) return existing;
    const home = this.getHomeLeafState(leaf);
    if (!home) {
      this.homeLeafFileBindings.delete(leaf);
      return null;
    }
    const file = this.plugin.app.vault.getAbstractFileByPath(home.path);
    if (!(file instanceof TFile)) {
      this.homeLeafFileBindings.delete(leaf);
      return null;
    }
    const binding: HomeLeafFileBinding = {
      file,
      expectedPath: home.path,
      expectedView: this.isUnresolvedHomeView(leaf) ? 'home-unresolved' : 'home',
    };
    this.homeLeafFileBindings.set(leaf, binding);
    return binding;
  }

  private queueBoundLeafRename(leaf: WorkspaceLeaf, binding: HomeLeafFileBinding): void {
    const source = this.applyingLeafSourceBindings.get(leaf);
    const alternateExpectedState = source?.file === binding.file
      && (source.expectedView !== binding.expectedView || source.expectedPath !== binding.expectedPath)
      ? { expectedView: source.expectedView, expectedPath: source.expectedPath }
      : undefined;
    this.pendingHomeLeafRenames.set(leaf, {
      file: binding.file,
      expectedPath: binding.expectedPath,
      expectedView: binding.expectedView,
      ...(alternateExpectedState ? { alternateExpectedState } : {}),
      immediateRetriesRemaining: 1,
    });
  }

  private async requestReconciliation(): Promise<void> {
    this.reconciliationRequested = true;
    if (this.reconciliationPromise) return this.reconciliationPromise;
    this.reconciliationPromise = this.drainReconciliations();
    return this.reconciliationPromise;
  }

  private async drainReconciliations(): Promise<void> {
    try {
      await this.runReconciliationLoop();
    } finally {
      this.reconciliationPromise = null;
      if (this.reconciliationRequested) await this.requestReconciliation();
    }
  }

  private async runReconciliationLoop(): Promise<void> {
    while (this.reconciliationRequested) {
      this.reconciliationRequested = false;
      const generation = this.runtimeGeneration;
      const expectedEnabled = this.enabled;
      try {
        await this.reconcileDeletedHomeLeaves(generation, expectedEnabled);
        if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) continue;
        await this.reconcileRenamedHomeLeaves(generation, expectedEnabled);
        if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) continue;
        if (expectedEnabled) {
          await this.convertReadingDailyNotes(generation);
        } else {
          await this.restoreDateBackedHomeLeaves(generation);
        }
      } catch (error) {
        logger.flowError('DailyNoteHome', 'reconcile:failed', error, {
          enabled: this.enabled,
          generation,
        });
      }
    }
  }

  private async reconcileDeletedHomeLeaves(
    generation: number,
    expectedEnabled: boolean,
  ): Promise<void> {
    if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) return;
    this.queueDeletedOrDisabledMissingHomeLeaves(expectedEnabled);
    this.knownDeletedPaths.clear();
    const openLeaves = new Set<WorkspaceLeaf>();
    this.plugin.app.workspace.iterateAllLeaves((leaf) => openLeaves.add(leaf));
    for (const leaf of this.pendingHomeLeafDeletes.keys()) {
      if (!openLeaves.has(leaf)) this.pendingHomeLeafDeletes.delete(leaf);
    }

    const candidates = [...this.pendingHomeLeafDeletes.entries()];
    for (const [leaf, pending] of candidates) {
      if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) return;
      if (this.pendingHomeLeafDeletes.get(leaf) !== pending) continue;
      if (!this.isWorkspaceLeafOpen(leaf)) {
        this.pendingHomeLeafDeletes.delete(leaf);
        continue;
      }
      if (this.applyingLeaves.has(leaf)) continue;
      const home = this.getHomeLeafState(leaf);
      if (!home || home.path !== pending.expectedPath) {
        this.pendingHomeLeafDeletes.delete(leaf);
        continue;
      }
      await this.applyDeletedHomeLeaf(leaf, pending, generation, expectedEnabled);
    }
  }

  private queueDeletedOrDisabledMissingHomeLeaves(expectedEnabled: boolean): void {
    for (const [path, folder] of this.knownDeletedPaths) {
      const live = this.plugin.app.vault.getAbstractFileByPath(path);
      if ((folder && live instanceof TFolder) || (!folder && live instanceof TFile)) {
        this.knownDeletedPaths.delete(path);
      }
    }
    if (expectedEnabled && this.knownDeletedPaths.size === 0) return;

    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (this.pendingHomeLeafDeletes.has(leaf)) return;
      const home = this.getHomeLeafState(leaf);
      if (!home) return;
      if (this.plugin.app.vault.getAbstractFileByPath(home.path) instanceof TFile) return;
      const pendingRename = this.pendingHomeLeafRenames.get(leaf);
      if (pendingRename && this.isLiveFile(pendingRename.file) && this.isLeafAtPendingRename(leaf, pendingRename)) {
        return;
      }
      const binding = this.homeLeafFileBindings.get(leaf);
      if (binding && this.isLiveFile(binding.file) && this.isLeafAtBinding(leaf, binding)) return;
      const matchedPath = [...this.knownDeletedPaths.entries()].find(([path, folder]) =>
        folder ? home.path.startsWith(`${path}/`) : home.path === path)?.[0];
      if (!matchedPath && expectedEnabled) return;
      this.pendingHomeLeafDeletes.set(leaf, {
        deletedPath: matchedPath ?? home.path,
        expectedPath: home.path,
        immediateRetriesRemaining: 1,
      });
      this.pendingHomeLeafRenames.delete(leaf);
      this.homeLeafFileBindings.delete(leaf);
    });
  }

  private async applyDeletedHomeLeaf(
    leaf: WorkspaceLeaf,
    pending: PendingHomeLeafDelete,
    generation: number,
    expectedEnabled: boolean,
  ): Promise<void> {
    if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) return;
    if (!this.isWorkspaceLeafOpen(leaf)) return;
    if (this.pendingHomeLeafDeletes.get(leaf) !== pending) return;
    const home = this.getHomeLeafState(leaf);
    if (!home || home.path !== pending.expectedPath) return;

    const current = leaf.getViewState();
    this.applyingLeaves.add(leaf);
    try {
      await leaf.setViewState({
        type: TPS_HOME_VIEW_TYPE,
        active: leaf === this.plugin.app.workspace.activeLeaf,
        pinned: current.pinned,
        state: {},
      });
      if (this.serviceUnloaded) {
        await this.recoverLeafAfterServiceUnload(leaf, null, current.pinned);
        return;
      }
      if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) return;
      if (this.pendingHomeLeafDeletes.get(leaf) !== pending) return;
      if (this.isStandaloneHomeLeaf(leaf)) {
        this.pendingHomeLeafDeletes.delete(leaf);
        this.pendingHomeLeafRenames.delete(leaf);
        this.homeLeafFileBindings.delete(leaf);
        logger.flow('DailyNoteHome', 'delete:open-home-became-standalone', {
          path: pending.expectedPath,
          deletedPath: pending.deletedPath,
        });
      } else {
        this.retainFailedPendingDelete(leaf, pending);
      }
    } catch (error) {
      if (this.serviceUnloaded) {
        await this.recoverLeafAfterServiceUnload(leaf, null, current.pinned);
        return;
      }
      if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) return;
      if (this.pendingHomeLeafDeletes.get(leaf) === pending) {
        this.retainFailedPendingDelete(leaf, pending);
      }
      logger.flowError('DailyNoteHome', 'delete:standalone-home-failed', error, {
        path: pending.expectedPath,
        deletedPath: pending.deletedPath,
      });
    } finally {
      this.applyingLeaves.delete(leaf);
    }
  }

  private retainFailedPendingDelete(leaf: WorkspaceLeaf, pending: PendingHomeLeafDelete): void {
    if (this.pendingHomeLeafDeletes.get(leaf) !== pending) return;
    if (pending.immediateRetriesRemaining <= 0) return;
    this.pendingHomeLeafDeletes.set(leaf, {
      ...pending,
      immediateRetriesRemaining: pending.immediateRetriesRemaining - 1,
    });
    this.reconciliationRequested = true;
  }

  private isStandaloneHomeLeaf(leaf: WorkspaceLeaf): boolean {
    const current = leaf.getViewState();
    return current.type === TPS_HOME_VIEW_TYPE
      && !String(current.state?.dailyNotePath || '').trim();
  }

  private isWorkspaceLeafOpen(target: WorkspaceLeaf): boolean {
    let found = false;
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf === target) found = true;
    });
    return found;
  }

  private async reconcileRenamedHomeLeaves(
    generation: number,
    expectedEnabled: boolean,
  ): Promise<void> {
    if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) return;
    this.refreshHomeLeafBindings();
    const candidates = [...this.pendingHomeLeafRenames.entries()];

    for (const [leaf, pending] of candidates) {
      if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) return;
      if (this.pendingHomeLeafRenames.get(leaf) !== pending) continue;
      if (!this.isWorkspaceLeafOpen(leaf)) {
        this.pendingHomeLeafRenames.delete(leaf);
        continue;
      }
      if (this.applyingLeaves.has(leaf)) continue;
      if (!this.isLeafAtPendingRename(leaf, pending)) {
        this.discardPendingRenameAndRefreshBinding(leaf, pending);
        continue;
      }
      if (!this.isLiveFile(pending.file)) {
        logger.flowWarn('DailyNoteHome', 'rename:target-missing', {
          previousPath: pending.expectedPath,
          path: pending.file.path,
        });
        continue;
      }

      await this.applyPendingRename(leaf, pending, generation, expectedEnabled);
    }
  }

  private refreshHomeLeafBindings(): void {
    const openLeaves = new Set<WorkspaceLeaf>();
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      openLeaves.add(leaf);
      if (this.applyingLeaves.has(leaf)) return;
      const pending = this.pendingHomeLeafRenames.get(leaf);
      if (pending && this.isLiveFile(pending.file) && this.isLeafAtPendingRename(leaf, pending)) {
        this.homeLeafFileBindings.set(leaf, pending);
        return;
      }
      if (pending) this.pendingHomeLeafRenames.delete(leaf);

      const existing = this.homeLeafFileBindings.get(leaf);
      if (existing && this.isLiveFile(existing.file) && this.isLeafAtBinding(leaf, existing)) {
        if ((existing.expectedView === 'home' || existing.expectedView === 'home-unresolved') && (
          existing.expectedView === 'home-unresolved'
          || existing.expectedPath !== existing.file.path
          || !this.getDailyNoteDate(existing.file)
        )) {
          this.queueBoundLeafRename(leaf, existing);
        }
        return;
      }

      const home = this.getHomeLeafState(leaf);
      if (!home) {
        this.homeLeafFileBindings.delete(leaf);
        return;
      }
      const file = this.plugin.app.vault.getAbstractFileByPath(home.path);
      if (!(file instanceof TFile)) {
        this.homeLeafFileBindings.delete(leaf);
        return;
      }
      const binding: HomeLeafFileBinding = {
        file,
        expectedPath: home.path,
        expectedView: this.isUnresolvedHomeView(leaf) ? 'home-unresolved' : 'home',
      };
      this.homeLeafFileBindings.set(leaf, binding);
      if (binding.expectedView === 'home-unresolved' || !this.getDailyNoteDate(file)) {
        this.queueBoundLeafRename(leaf, binding);
      }
    });
    for (const leaf of this.pendingHomeLeafRenames.keys()) {
      if (!openLeaves.has(leaf)) this.pendingHomeLeafRenames.delete(leaf);
    }
  }

  private isLiveFile(file: TFile): boolean {
    return this.plugin.app.vault.getAbstractFileByPath(file.path) === file;
  }

  private getDailyNoteDate(file: TFile): string | null {
    if (file.extension.toLowerCase() !== 'md') return null;
    return parseDailyNoteFileDate(this.plugin.app, this.plugin.settings, file);
  }

  private getHomeLeafState(leaf: WorkspaceLeaf): { path: string; pinned?: boolean } | null {
    const current = leaf.getViewState();
    if (current.type !== TPS_HOME_VIEW_TYPE) return null;
    const path = String(current.state?.dailyNotePath || '').trim();
    return path ? { path, pinned: current.pinned } : null;
  }

  private isLeafAtBinding(leaf: WorkspaceLeaf, binding: HomeLeafFileBinding): boolean {
    const current = leaf.getViewState();
    if (binding.expectedView === 'home' || binding.expectedView === 'home-unresolved') {
      const stateMatches = current.type === TPS_HOME_VIEW_TYPE
        && String(current.state?.dailyNotePath || '').trim() === binding.expectedPath;
      if (!stateMatches) return false;
      const backed = this.getHomeViewBackedState(leaf);
      if (backed === null) return true;
      return binding.expectedView === 'home' ? backed : !backed;
    }
    if (binding.expectedView === 'markdown') {
      return current.type === 'markdown'
        && String(current.state?.file || '').trim() === binding.expectedPath;
    }
    return (leaf.view as { file?: unknown } | null)?.file === binding.file;
  }

  private getHomeViewBackedState(leaf: WorkspaceLeaf): boolean | null {
    const view = leaf.view as { isDailyNoteBacked?: () => boolean } | null;
    if (typeof view?.isDailyNoteBacked !== 'function') return null;
    return view.isDailyNoteBacked();
  }

  private isUnresolvedHomeView(leaf: WorkspaceLeaf): boolean {
    return this.getHomeViewBackedState(leaf) === false;
  }

  private isLeafAtPendingRename(leaf: WorkspaceLeaf, pending: PendingHomeLeafRename): boolean {
    return this.getMatchedPendingRenameBinding(leaf, pending) !== null;
  }

  private getMatchedPendingRenameBinding(
    leaf: WorkspaceLeaf,
    pending: PendingHomeLeafRename,
  ): HomeLeafFileBinding | null {
    const pendingMatch = this.getMatchedBindingState(leaf, pending);
    if (pendingMatch) return pendingMatch;
    const alternate = pending.alternateExpectedState;
    const alternateBinding: HomeLeafFileBinding | null = alternate ? {
      file: pending.file,
      ...alternate,
    } : null;
    return alternateBinding ? this.getMatchedBindingState(leaf, alternateBinding) : null;
  }

  private getMatchedBindingState(
    leaf: WorkspaceLeaf,
    binding: HomeLeafFileBinding,
  ): HomeLeafFileBinding | null {
    if (this.isLeafAtBinding(leaf, binding)) return binding;
    if (binding.expectedView !== 'home' && binding.expectedView !== 'home-unresolved') return null;
    const current = leaf.getViewState();
    if (
      current.type !== TPS_HOME_VIEW_TYPE
      || String(current.state?.dailyNotePath || '').trim() !== binding.expectedPath
    ) return null;
    const backed = this.getHomeViewBackedState(leaf);
    if (backed === null) return binding;
    return {
      ...binding,
      expectedView: backed ? 'home' : 'home-unresolved',
    };
  }

  private discardPendingRenameAndRefreshBinding(
    leaf: WorkspaceLeaf,
    pending: PendingHomeLeafRename,
  ): void {
    if (this.pendingHomeLeafRenames.get(leaf) === pending) {
      this.pendingHomeLeafRenames.delete(leaf);
    }
    this.homeLeafFileBindings.delete(leaf);
    const home = this.getHomeLeafState(leaf);
    if (!home) return;
    const file = this.plugin.app.vault.getAbstractFileByPath(home.path);
    if (!(file instanceof TFile)) return;
    this.homeLeafFileBindings.set(leaf, {
      file,
      expectedPath: home.path,
      expectedView: 'home',
    });
  }

  private async applyPendingRename(
    leaf: WorkspaceLeaf,
    pending: PendingHomeLeafRename,
    generation: number,
    expectedEnabled: boolean,
  ): Promise<void> {
    if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) return;
    if (!this.isWorkspaceLeafOpen(leaf)) return;
    if (this.pendingHomeLeafRenames.get(leaf) !== pending) return;
    const sourceBinding = this.getMatchedPendingRenameBinding(leaf, pending);
    if (!sourceBinding) return;

    const file = pending.file;
    const targetPath = String(file.path || '').trim();
    const dateIso = this.getDailyNoteDate(file);
    const current = leaf.getViewState();
    const pinned = current.pinned;
    const targetBinding: HomeLeafFileBinding = expectedEnabled && dateIso
      ? { file, expectedPath: targetPath, expectedView: 'home' }
      : file.extension.toLowerCase() === 'md'
        ? { file, expectedPath: targetPath, expectedView: 'markdown' }
        : { file, expectedPath: targetPath, expectedView: 'native' };

    if (this.isLeafAtBinding(leaf, targetBinding)) {
      this.finishPendingRename(leaf, pending, targetBinding);
      return;
    }

    this.applyingLeaves.add(leaf);
    this.applyingLeafSourceBindings.set(leaf, sourceBinding);
    this.homeLeafFileBindings.set(leaf, targetBinding);
    try {
      if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) return;
      if (targetBinding.expectedView === 'home') {
        await leaf.setViewState({
          type: TPS_HOME_VIEW_TYPE,
          active: leaf === this.plugin.app.workspace.activeLeaf,
          pinned,
          state: { dailyNotePath: targetPath, dateIso },
        });
      } else if (targetBinding.expectedView === 'markdown') {
        await leaf.setViewState({
          type: 'markdown',
          active: leaf === this.plugin.app.workspace.activeLeaf,
          pinned,
          state: { file: targetPath, mode: 'preview' },
        });
      } else {
        await leaf.openFile(file, {
          active: leaf === this.plugin.app.workspace.activeLeaf,
        });
      }

      if (this.serviceUnloaded) {
        if (targetBinding.expectedView === 'home') {
          await this.recoverLeafAfterServiceUnload(leaf, file, pinned);
        }
        return;
      }
      if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) return;
      const currentPending = this.pendingHomeLeafRenames.get(leaf);
      if (currentPending === pending) {
        if (this.isLeafAtBinding(leaf, targetBinding)) {
          this.finishPendingRename(leaf, pending, targetBinding);
        } else {
          this.retainFailedPendingRename(leaf, pending);
        }
      }
      logger.flow('DailyNoteHome', targetBinding.expectedView === 'home'
        ? 'rename:update-home'
        : targetBinding.expectedView === 'markdown'
          ? 'rename:restore-markdown'
          : 'rename:open-native-view', {
        previousPath: pending.expectedPath,
        path: targetPath,
        ...(dateIso ? { dateIso } : {}),
      });
    } catch (error) {
      if (this.serviceUnloaded) {
        if (leaf.getViewState().type === TPS_HOME_VIEW_TYPE) {
          await this.recoverLeafAfterServiceUnload(leaf, file, pinned);
        }
        return;
      }
      if (!this.isRuntimeGenerationCurrent(generation, expectedEnabled)) return;
      if (this.pendingHomeLeafRenames.get(leaf) === pending) {
        if (this.isLeafAtBinding(leaf, targetBinding)) {
          this.finishPendingRename(leaf, pending, targetBinding);
        } else {
          this.homeLeafFileBindings.set(leaf, pending);
          this.retainFailedPendingRename(leaf, pending);
        }
      }
      logger.flowError('DailyNoteHome', 'rename:reconcile-failed', error, {
        previousPath: pending.expectedPath,
        path: targetPath,
      });
    } finally {
      this.applyingLeafSourceBindings.delete(leaf);
      this.applyingLeaves.delete(leaf);
    }
  }

  private finishPendingRename(
    leaf: WorkspaceLeaf,
    pending: PendingHomeLeafRename,
    target: HomeLeafFileBinding,
  ): void {
    if (this.pendingHomeLeafRenames.get(leaf) !== pending) return;
    this.pendingHomeLeafRenames.delete(leaf);
    if (target.expectedView === 'home') this.homeLeafFileBindings.set(leaf, target);
    else this.homeLeafFileBindings.delete(leaf);
  }

  private retainFailedPendingRename(leaf: WorkspaceLeaf, pending: PendingHomeLeafRename): void {
    if (this.pendingHomeLeafRenames.get(leaf) !== pending) return;
    if (pending.immediateRetriesRemaining <= 0) return;
    this.pendingHomeLeafRenames.set(leaf, {
      ...pending,
      immediateRetriesRemaining: pending.immediateRetriesRemaining - 1,
    });
    this.reconciliationRequested = true;
  }

  private handleNotebookNavigatorClick(event: MouseEvent, schedule: () => void): void {
    if (event.button !== 0) return;
    if (Platform.isMacOS && event.ctrlKey && !event.metaKey) return;
    const target = this.resolveNotebookNavigatorFileInteraction(event.target);
    if (!target) return;

    const generation = ++this.notebookNavigatorInteractionGeneration;
    const configuredModifier = this.getNotebookNavigatorMultiSelectModifier();
    const isSelectionGesture = isNotebookNavigatorSelectionGesture(
      event,
      configuredModifier,
      Platform.isMacOS,
      Platform.isMobile,
    );

    if (!isSelectionGesture) {
      this.notebookNavigatorHomeIntent.markPlainOpen(target.file.path);
      logger.flow('DailyNoteHome', 'notebook-navigator:plain-open', {
        path: target.file.path,
      });
      schedule();
      return;
    }

    this.notebookNavigatorHomeIntent.markSelection([target.file.path]);
    this.scheduleNotebookNavigatorSelectionReconciliation(
      target,
      generation,
      'notebook-navigator:selection-only',
      schedule,
    );
    schedule();
  }

  private handleNotebookNavigatorDragStart(event: DragEvent, schedule: () => void): void {
    const target = this.resolveNotebookNavigatorFileInteraction(event.target);
    if (!target) return;

    const generation = ++this.notebookNavigatorInteractionGeneration;
    this.notebookNavigatorHomeIntent.markSelection([target.file.path]);
    this.scheduleNotebookNavigatorSelectionReconciliation(
      target,
      generation,
      'notebook-navigator:drag-selection',
      schedule,
    );
    schedule();
  }

  private scheduleNotebookNavigatorSelectionReconciliation(
    target: NotebookNavigatorFileInteraction,
    generation: number,
    eventName: string,
    schedule: () => void,
  ): void {
    window.setTimeout(() => {
      if (generation !== this.notebookNavigatorInteractionGeneration) return;
      const selectedFiles = this.plugin.contextTargetService.getSelectedFiles(target.scopeRoot);
      const paths = new Set(selectedFiles.map((file) => file.path));
      paths.add(target.file.path);
      for (const path of this.getNotebookNavigatorCurrentSelectionPaths()) paths.add(path);
      this.notebookNavigatorHomeIntent.markSelection(paths);
      logger.flow('DailyNoteHome', eventName, {
        path: target.file.path,
        selectedCount: paths.size,
      });
      schedule();
    }, 0);
  }

  private resolveNotebookNavigatorFileInteraction(
    eventTarget: EventTarget | null,
  ): NotebookNavigatorFileInteraction | null {
    const target = eventTarget instanceof HTMLElement
      ? eventTarget
      : eventTarget instanceof Element
        ? eventTarget.parentElement
        : null;
    if (!target) return null;
    if (target.closest('.nn-quick-action-item, .nn-parent-folder-content[data-reveal="true"]')) return null;
    if (!this.plugin.contextTargetService.isNotebookNavigatorFileContextTarget(target)) return null;
    const file = this.plugin.contextTargetService.resolveNotebookNavigatorFileTarget(target);
    if (!(file instanceof TFile)) return null;
    const scopeRoot = target.closest<HTMLElement>(
      '.workspace-leaf-content[data-type="notebook-navigator"], .view-content.notebook-navigator',
    );
    return scopeRoot ? { file, scopeRoot } : null;
  }

  private getNotebookNavigatorMultiSelectModifier(): NotebookNavigatorMultiSelectModifier {
    const notebookNavigator = this.getNotebookNavigatorPlugin();
    const raw = notebookNavigator?.settings?.multiSelectModifier
      ?? notebookNavigator?.instance?.settings?.multiSelectModifier
      ?? notebookNavigator?.plugin?.settings?.multiSelectModifier;
    return String(raw || '').trim().toLowerCase() === 'optionalt' ? 'optionAlt' : 'cmdCtrl';
  }

  private getNotebookNavigatorCurrentSelectionPaths(): string[] {
    const notebookNavigator = this.getNotebookNavigatorPlugin();
    const selectionApi = notebookNavigator?.api?.selection
      ?? notebookNavigator?.instance?.api?.selection
      ?? notebookNavigator?.plugin?.api?.selection;
    const getCurrent = selectionApi?.getCurrent;
    if (typeof getCurrent !== 'function') return [];
    let currentSelection: unknown;
    try {
      currentSelection = getCurrent.call(selectionApi);
    } catch {
      return [];
    }
    return collectNotebookNavigatorSelectionPaths(currentSelection, (rawPath) => {
      const file = this.plugin.app.vault.getAbstractFileByPath(rawPath);
      return file instanceof TFile ? file.path : null;
    });
  }

  private getNotebookNavigatorPlugin(): any {
    const plugins = (this.plugin.app as any)?.plugins;
    return plugins?.getPlugin?.('notebook-navigator')
      ?? plugins?.plugins?.['notebook-navigator'];
  }

  allowLivePreview(leaf: WorkspaceLeaf, path: string): void {
    if (!this.enabled) return;
    this.livePreviewOverride = { leaf, path };
  }

  isLivePreviewOverride(leaf: WorkspaceLeaf): boolean {
    const override = this.livePreviewOverride;
    if (!override || override.leaf !== leaf) return false;
    const view = leaf.view;
    const state = leaf.getViewState();
    return view instanceof MarkdownView
      && view.file?.path === override.path
      && state.state?.mode === 'source'
      && state.state?.source !== true;
  }

  private async convertReadingDailyNotes(generation: number): Promise<void> {
    if (!this.isRuntimeGenerationCurrent(generation, true)) return;
    const candidates: Array<{ leaf: WorkspaceLeaf; file: TFile }> = [];
    const openLeaves = new Set<WorkspaceLeaf>();
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      openLeaves.add(leaf);
      if (this.applyingLeaves.has(leaf)) return;
      if (!(leaf.view instanceof MarkdownView) || leaf.view.getViewType() !== 'markdown') {
        this.notebookNavigatorHomeIntent.reconcileLeaf(leaf, null);
        return;
      }
      const file = leaf.view.file;
      if (!(file instanceof TFile)) {
        this.notebookNavigatorHomeIntent.reconcileLeaf(leaf, null);
        return;
      }
      this.notebookNavigatorHomeIntent.reconcileLeaf(leaf, file.path);
      if (leaf.view.getMode() !== 'preview') return;
      const dateIso = this.getDailyNoteDate(file);
      if (!dateIso) return;
      candidates.push({ leaf, file });
    });
    this.notebookNavigatorHomeIntent.retainLeaves(openLeaves);
    candidates.sort((left, right) =>
      Number(right.leaf === this.plugin.app.workspace.activeLeaf)
      - Number(left.leaf === this.plugin.app.workspace.activeLeaf));

    for (const candidate of candidates) {
      if (!this.isRuntimeGenerationCurrent(generation, true)) return;
      await this.convertLeaf(candidate.leaf, candidate.file, generation);
    }
  }

  private async convertLeaf(
    leaf: WorkspaceLeaf,
    file: TFile,
    generation: number,
  ): Promise<void> {
    if (!this.isRuntimeGenerationCurrent(generation, true)) return;
    if (!this.isWorkspaceLeafOpen(leaf)) return;
    if (this.applyingLeaves.has(leaf)) return;
    const view = leaf.view;
    const current = leaf.getViewState();
    if (!(view instanceof MarkdownView) || view.getViewType() !== 'markdown') return;
    if (view.file !== file || view.getMode() !== 'preview') return;
    if (this.plugin.app.vault.getAbstractFileByPath(file.path) !== file) return;
    if (this.notebookNavigatorHomeIntent.shouldSuppress(leaf, file.path)) return;
    const dateIso = this.getDailyNoteDate(file);
    if (!dateIso) return;

    const targetPath = file.path;
    const targetBinding: HomeLeafFileBinding = {
      file,
      expectedPath: targetPath,
      expectedView: 'home',
    };
    const sourceBinding: HomeLeafFileBinding = {
      file,
      expectedPath: String(current.state?.file || targetPath).trim() || targetPath,
      expectedView: 'markdown',
    };
    this.applyingLeaves.add(leaf);
    this.applyingLeafSourceBindings.set(leaf, sourceBinding);
    if (this.livePreviewOverride?.leaf === leaf) this.livePreviewOverride = null;
    this.homeLeafFileBindings.set(leaf, targetBinding);
    try {
      if (!this.isRuntimeGenerationCurrent(generation, true)) return;
      await leaf.setViewState({
        type: TPS_HOME_VIEW_TYPE,
        active: leaf === this.plugin.app.workspace.activeLeaf,
        pinned: current.pinned,
        state: {
          dailyNotePath: targetPath,
          dateIso,
        },
      });
      if (this.serviceUnloaded) {
        await this.recoverLeafAfterServiceUnload(leaf, file, current.pinned);
        return;
      }
      if (!this.isRuntimeGenerationCurrent(generation, true)) return;
      logger.flow('DailyNoteHome', 'reading:render-home', {
        path: targetPath,
        dateIso,
      });
    } catch (error) {
      if (this.serviceUnloaded) {
        if (leaf.getViewState().type === TPS_HOME_VIEW_TYPE) {
          await this.recoverLeafAfterServiceUnload(leaf, file, current.pinned);
        }
        return;
      }
      if (!this.isRuntimeGenerationCurrent(generation, true)) return;
      if (this.pendingHomeLeafRenames.get(leaf)?.file !== file) {
        this.homeLeafFileBindings.delete(leaf);
      }
      logger.flowError('DailyNoteHome', 'reading:render-home-failed', error, {
        path: targetPath,
        dateIso,
      });
    } finally {
      this.applyingLeafSourceBindings.delete(leaf);
      this.applyingLeaves.delete(leaf);
    }
  }

  private async restoreDateBackedHomeLeaves(generation: number): Promise<void> {
    if (!this.isRuntimeGenerationCurrent(generation, false)) return;
    const candidates: Array<{
      leaf: WorkspaceLeaf;
      file: TFile;
      expectedPath: string;
      expectedView: 'home' | 'home-unresolved';
    }> = [];
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (this.applyingLeaves.has(leaf)) return;
      const home = this.getHomeLeafState(leaf);
      if (!home) return;
      const binding = this.homeLeafFileBindings.get(leaf);
      const file = binding
        && this.isLiveFile(binding.file)
        && (binding.expectedView === 'home' || binding.expectedView === 'home-unresolved')
        && binding.expectedPath === home.path
        ? binding.file
        : this.plugin.app.vault.getAbstractFileByPath(home.path);
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') return;
      const expectedView = this.isUnresolvedHomeView(leaf) ? 'home-unresolved' : 'home';
      this.homeLeafFileBindings.set(leaf, {
        file,
        expectedPath: home.path,
        expectedView,
      });
      candidates.push({ leaf, file, expectedPath: home.path, expectedView });
    });

    for (const candidate of candidates) {
      if (!this.isRuntimeGenerationCurrent(generation, false)) return;
      await this.restoreHomeLeaf(candidate, generation);
    }
  }

  private async restoreHomeLeaf(
    candidate: {
      leaf: WorkspaceLeaf;
      file: TFile;
      expectedPath: string;
      expectedView: 'home' | 'home-unresolved';
    },
    generation: number,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.isRuntimeGenerationCurrent(generation, false)) return;
      if (!this.isWorkspaceLeafOpen(candidate.leaf)) return;
      if (this.applyingLeaves.has(candidate.leaf)) return;
      const sourceBinding: HomeLeafFileBinding = {
        file: candidate.file,
        expectedPath: candidate.expectedPath,
        expectedView: candidate.expectedView,
      };
      if (!this.isLeafAtBinding(candidate.leaf, sourceBinding)) return;
      if (this.homeLeafFileBindings.get(candidate.leaf)?.file !== candidate.file) return;
      if (this.plugin.app.vault.getAbstractFileByPath(candidate.file.path) !== candidate.file) return;

      const current = candidate.leaf.getViewState();
      const targetPath = candidate.file.path;
      const targetBinding: HomeLeafFileBinding = {
        file: candidate.file,
        expectedPath: targetPath,
        expectedView: 'markdown',
      };
      this.applyingLeaves.add(candidate.leaf);
      this.applyingLeafSourceBindings.set(candidate.leaf, sourceBinding);
      this.homeLeafFileBindings.set(candidate.leaf, targetBinding);
      try {
        await candidate.leaf.setViewState({
          type: 'markdown',
          active: candidate.leaf === this.plugin.app.workspace.activeLeaf,
          pinned: current.pinned,
          state: { file: targetPath, mode: 'preview' },
        });
        if (!this.isRuntimeGenerationCurrent(generation, false)) return;
        if (this.pendingHomeLeafRenames.get(candidate.leaf)?.file !== candidate.file) {
          this.homeLeafFileBindings.delete(candidate.leaf);
        }
        if (this.pendingHomeLeafRenames.get(candidate.leaf)?.file === candidate.file) {
          this.pendingHomeLeafRenames.delete(candidate.leaf);
        }
        this.pendingHomeLeafDeletes.delete(candidate.leaf);
        logger.flow('DailyNoteHome', 'setting:restore-markdown', { path: targetPath });
        return;
      } catch (error) {
        if (this.serviceUnloaded) {
          if (candidate.leaf.getViewState().type === TPS_HOME_VIEW_TYPE) {
            await this.recoverLeafAfterServiceUnload(
              candidate.leaf,
              candidate.file,
              current.pinned,
            );
          }
          return;
        }
        if (!this.isRuntimeGenerationCurrent(generation, false)) return;
        if (this.isLeafAtBinding(candidate.leaf, targetBinding)) {
          this.homeLeafFileBindings.delete(candidate.leaf);
          return;
        }
        if (this.pendingHomeLeafRenames.get(candidate.leaf)?.file === candidate.file) return;
        this.homeLeafFileBindings.set(candidate.leaf, sourceBinding);
        if (attempt === 1) {
          logger.flowError('DailyNoteHome', 'setting:restore-markdown-failed', error, {
            path: candidate.file.path,
            attempts: 2,
          });
        }
      } finally {
        this.applyingLeafSourceBindings.delete(candidate.leaf);
        this.applyingLeaves.delete(candidate.leaf);
      }
    }
  }

  private async recoverLeafAfterServiceUnload(
    leaf: WorkspaceLeaf,
    file: TFile | null,
    pinned: boolean | undefined,
  ): Promise<void> {
    try {
      if (file && this.plugin.app.vault.getAbstractFileByPath(file.path) === file) {
        await leaf.setViewState({
          type: 'markdown',
          active: leaf === this.plugin.app.workspace.activeLeaf,
          pinned,
          state: { file: file.path, mode: 'preview' },
        });
      } else {
        await leaf.setViewState({
          type: 'empty',
          active: leaf === this.plugin.app.workspace.activeLeaf,
          pinned,
          state: {},
        });
      }
      logger.flow('DailyNoteHome', 'unload:recovered-in-flight-home');
    } catch (error) {
      logger.flowError('DailyNoteHome', 'unload:recover-in-flight-home-failed', error);
    }
  }
}
