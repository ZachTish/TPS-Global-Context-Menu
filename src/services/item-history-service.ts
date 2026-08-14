import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';
import {
  diffTaskHistorySnapshots,
  ensureTaskHistoryIdentity,
  getTaskHistoryIdentity,
  normalizeItemHistoryCause,
  snapshotTaskForHistory,
  type ItemHistoryEntityRecord,
  type ItemHistoryEvent,
  type ItemHistoryPendingRecord,
  type ItemHistoryTaskSnapshot,
  type ItemHistoryTaskAction,
  type ItemHistoryTaskMutationHandle,
  type ItemHistoryUserCause,
} from './item-history-core';
import {
  IndexedDbItemHistoryStore,
  type ItemHistoryStore,
  type ItemHistoryStoreStats,
} from './item-history-store';

export type {
  ItemHistoryChange,
  ItemHistoryEntityRecord,
  ItemHistoryEvent,
  ItemHistoryLocator,
  ItemHistoryTaskAction,
  ItemHistoryTaskMutationHandle,
  ItemHistoryUserCause,
  ItemHistoryValueState,
} from './item-history-core';
export type { ItemHistoryStoreStats } from './item-history-store';

export interface BeginTaskHistoryMutationInput {
  action: ItemHistoryTaskAction;
  cause?: ItemHistoryUserCause | null;
  before: {
    path: string;
    lineNumber: number;
    rawLine: string;
  };
  targetPath?: string;
}

export interface CommitTaskHistoryMutationInput {
  confirmedBefore?: {
    path: string;
    lineNumber: number;
    rawLine: string;
  };
  after?: {
    path: string;
    lineNumber: number;
    rawLine: string;
  };
  sourceDisposition?: 'removed' | 'migrated' | 'retained';
  outcome?: 'committed' | 'partial';
}

export interface ItemHistoryQueryOptions {
  limit?: number;
  before?: number;
  /** Tie-breaker for events sharing the `before` millisecond. */
  beforeEventId?: string;
}

export interface ItemHistoryTaskReference {
  path?: string;
  lineNumber?: number;
  rawLine?: string;
  entityId?: string;
}

const DAY_MS = 86_400_000;
const DEFAULT_RETENTION_DAYS = 90;
const MAX_RETENTION_DAYS = 365;
const MAX_GLOBAL_ENTRIES = 25_000;
const MAX_PER_ENTITY = 200;
const PENDING_RETENTION_MS = DAY_MS;
const PRUNE_INTERVAL_MS = 5 * 60_000;
const PRUNE_COMMIT_INTERVAL = 100;
const PENDING_INVALIDATION_STORAGE_KEY = 'item-history:discard-pending-on-enable';
const CLEAR_ALL_STORAGE_KEY = 'item-history:clear-all-on-setup';
const DATABASE_NAMESPACE_STORAGE_KEY = 'item-history:database-namespace';

type PendingTaskObservation =
  | { state: 'absent' }
  | { state: 'missing-file' }
  | { state: 'ambiguous' }
  | { state: 'unreadable' }
  | {
    state: 'found';
    path: string;
    lineNumber: number;
    rawLine: string;
    snapshot: ItemHistoryTaskSnapshot;
  };

type PendingTaskResolution =
  | { state: 'aborted' }
  | { state: 'uncertain' }
  | {
    state: 'committed';
    after: { path: string; lineNumber: number; rawLine: string };
    sourceDisposition?: 'removed' | 'migrated' | 'retained';
    outcome: 'committed' | 'partial';
  };

/**
 * Local, redacted, user-action-only item journal.
 *
 * Content writes never depend on this service succeeding. A pending intent is
 * written before an opted-in mutation and removed atomically with its event
 * after the content commit. Uncertain intents are retained for up to 24 hours
 * as crash evidence and are never presented as successful history.
 */
export class ItemHistoryService {
  private store: ItemHistoryStore | null;
  private readonly providedStore: ItemHistoryStore | null;
  private ready: Promise<boolean> | null = null;
  private warnedUnavailable = false;
  private disposed = false;
  private pruneInFlight: Promise<void> | null = null;
  private pruneTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private successfulCommitsSincePrune = 0;
  private lastPrunedAt = 0;
  private mutationEpoch = 0;
  private readonly operationEpochs = new Map<string, number>();
  private discardPendingOnNextSetup = false;
  private clearAllOnNextSetup = false;
  private clearAllInFlight: Promise<boolean> | null = null;
  private activationMaintenance: Promise<void> | null = null;

  constructor(
    private readonly plugin: TPSGlobalContextMenuPlugin,
    store?: ItemHistoryStore,
  ) {
    this.providedStore = store ?? null;
    this.store = this.providedStore;
  }

  async setup(): Promise<void> {
    const setupEpoch = this.mutationEpoch;
    if (!(await this.ensureReady(true))) return;
    if (setupEpoch !== this.mutationEpoch || !this.store) return;
    const recordingEnabled = isItemHistoryEnabled(this.plugin);
    if (this.shouldDiscardPendingOnSetup() || !recordingEnabled) {
      try {
        await this.store.clearPending();
        if (setupEpoch !== this.mutationEpoch) return;
        this.discardPendingOnNextSetup = false;
        this.savePendingInvalidationMarker(false);
      } catch (error) {
        this.warnUnavailable(error, 'pending-invalidation-failed');
        return;
      }
    } else {
      await this.reconcilePendingAtStartup(setupEpoch);
    }
    if (setupEpoch !== this.mutationEpoch || !this.store) return;
    await this.pruneReadyStore();
  }

  updateEnabled(enabled: boolean): void {
    if (enabled) {
      const maintenance = this.setup();
      this.activationMaintenance = maintenance;
      void maintenance.finally(() => {
        if (this.activationMaintenance === maintenance) this.activationMaintenance = null;
      });
      return;
    }
    this.mutationEpoch += 1;
    this.operationEpochs.clear();
    this.discardPendingOnNextSetup = true;
    this.savePendingInvalidationMarker(true);
    if (this.pruneTimer != null) globalThis.clearTimeout(this.pruneTimer);
    this.pruneTimer = null;
    this.ready = null;
    const store = this.store;
    this.store = null;
    store?.dispose();
  }

  async beginTaskMutation(
    input: BeginTaskHistoryMutationInput,
  ): Promise<ItemHistoryTaskMutationHandle | null> {
    if (this.activationMaintenance) await this.activationMaintenance;
    const cause = normalizeItemHistoryCause(input.cause);
    const before = this.snapshotTask(input.before.rawLine);
    if (this.plugin.settings.enableItemHistory === false || !cause || !before) return null;
    if (!(await this.ensureReady()) || !this.store) return null;

    const existingEntityId = getTaskHistoryIdentity(input.before.rawLine);
    const entityId = existingEntityId || createItemHistoryId('item');
    const operationId = createItemHistoryId('op');
    const startedAt = Date.now();
    const mutationEpoch = this.mutationEpoch;
    const handle: ItemHistoryTaskMutationHandle = {
      operationId,
      entityId,
      action: input.action,
      cause,
      before,
      locatorBefore: normalizeLocator(input.before.path, input.before.lineNumber),
      ...(String(input.targetPath || '').trim() ? { targetPath: String(input.targetPath).trim() } : {}),
      identityWasPresent: Boolean(existingEntityId),
      startedAt,
    };

    try {
      await this.store.putPending({ schemaVersion: 1, entityKind: 'task', ...handle });
      if (
        !isItemHistoryEnabled(this.plugin)
        || mutationEpoch !== this.mutationEpoch
      ) {
        await this.store.abort(operationId);
        return null;
      }
      this.operationEpochs.set(operationId, mutationEpoch);
      return handle;
    } catch (error) {
      this.warnUnavailable(error, 'pending-write-failed');
      return null;
    }
  }

  ensureTaskIdentity(handle: ItemHistoryTaskMutationHandle | null | undefined, line: string): string {
    if (!handle) return line;
    return ensureTaskHistoryIdentity(line, handle.entityId);
  }

  async commitTaskMutation(
    handle: ItemHistoryTaskMutationHandle | null | undefined,
    input: CommitTaskHistoryMutationInput = {},
  ): Promise<void> {
    await this.commitTaskMutationInternal(handle, input, false);
  }

  private async commitTaskMutationInternal(
    handle: ItemHistoryTaskMutationHandle | null | undefined,
    input: CommitTaskHistoryMutationInput,
    recovery: boolean,
  ): Promise<void> {
    if (!handle || !this.store) return;
    const store = this.store;
    const commitEpoch = this.mutationEpoch;
    const operationEpoch = this.operationEpochs.get(handle.operationId);
    if (
      !recovery
      && (
        this.plugin.settings.enableItemHistory === false
        || operationEpoch !== commitEpoch
      )
    ) {
      return;
    }
    let pending: ItemHistoryPendingRecord | null;
    try {
      pending = await store.getPending(handle.operationId);
    } catch (error) {
      this.operationEpochs.delete(handle.operationId);
      this.warnUnavailable(error, 'pending-read-failed');
      return;
    }
    if (
      this.store !== store
      || !isItemHistoryEnabled(this.plugin)
      || commitEpoch !== this.mutationEpoch
      || (!recovery && operationEpoch !== this.mutationEpoch)
    ) {
      this.operationEpochs.delete(handle.operationId);
      try {
        await store.abort(handle.operationId);
      } catch {
        // A persisted invalidation marker still prevents later reconciliation.
      }
      return;
    }
    if (!pending) {
      this.operationEpochs.delete(handle.operationId);
      return;
    }
    if (!mutationHandleMatchesPending(handle, pending)) {
      this.operationEpochs.delete(handle.operationId);
      return;
    }
    handle = pending;
    const confirmedBefore = input.confirmedBefore
      ? this.snapshotTask(input.confirmedBefore.rawLine)
      : null;
    if (input.confirmedBefore && !confirmedBefore) {
      await this.abortTaskMutation(handle);
      logger.flow('ItemHistory', 'event:before-invalid', {
        action: handle.action,
        consequence: 'history-event-skipped',
      });
      return;
    }
    if (input.confirmedBefore) {
      const liveIdentity = getTaskHistoryIdentity(input.confirmedBefore.rawLine);
      let identityIsConsistent = true;
      try {
        ensureTaskHistoryIdentity(input.confirmedBefore.rawLine, handle.entityId);
      } catch {
        identityIsConsistent = false;
      }
      if (
        String(input.confirmedBefore.path || '').trim() !== handle.locatorBefore.path
        || (liveIdentity && liveIdentity !== handle.entityId)
        || (handle.identityWasPresent && liveIdentity !== handle.entityId)
        || !identityIsConsistent
      ) {
        await this.abortTaskMutation(handle);
        logger.flow('ItemHistory', 'event:before-identity-mismatch', {
          action: handle.action,
          consequence: 'history-event-skipped',
        });
        return;
      }
    }
    const after = input.after ? this.snapshotTask(input.after.rawLine) : null;
    if (input.after) {
      let identityIsConsistent = true;
      try {
        ensureTaskHistoryIdentity(input.after.rawLine, handle.entityId);
      } catch {
        identityIsConsistent = false;
      }
      if (!after || getTaskHistoryIdentity(input.after.rawLine) !== handle.entityId || !identityIsConsistent) {
        await this.abortTaskMutation(handle);
        logger.flow('ItemHistory', 'event:identity-mismatch', {
          action: handle.action,
          consequence: 'history-event-skipped',
        });
        return;
      }
    }
    const before = confirmedBefore ?? handle.before;
    const changes = diffTaskHistorySnapshots(before, after);
    if (
      changes.length === 0
      && input.after
      && (handle.action === 'task.update' || handle.action === 'task.checkbox')
    ) {
      changes.push({
        field: 'content',
        before: { state: 'value', value: '[changed]' },
        after: { state: 'value', value: '[changed]' },
      });
    }
    const locatorBefore = input.confirmedBefore
      ? normalizeLocator(input.confirmedBefore.path, input.confirmedBefore.lineNumber)
      : handle.locatorBefore;
    const locatorAfter = input.after
      ? normalizeLocator(input.after.path, input.after.lineNumber)
      : undefined;
    const isLocatorChange = locatorAfter != null
      && (locatorAfter.path !== locatorBefore.path || locatorAfter.lineNumber !== locatorBefore.lineNumber);
    const recordsLifecycle = handle.action === 'task.create'
      || handle.action === 'task.delete'
      || handle.action === 'task.move'
      || handle.action === 'task.migrate';

    if (!changes.length && !isLocatorChange && !recordsLifecycle && input.outcome !== 'partial') {
      await this.abortTaskMutation(handle);
      return;
    }

    const committedAt = Date.now();
    const event: ItemHistoryEvent = {
      schemaVersion: 1,
      eventId: handle.operationId,
      operationId: handle.operationId,
      entityId: handle.entityId,
      entityKind: 'task',
      action: handle.action,
      occurredAt: handle.startedAt,
      committedAt,
      cause: handle.cause,
      changes,
      locatorBefore,
      ...(locatorAfter ? { locatorAfter } : {}),
      ...(input.sourceDisposition ? { sourceDisposition: input.sourceDisposition } : {}),
      outcome: input.outcome ?? 'committed',
    };
    const entity: ItemHistoryEntityRecord = {
      entityId: handle.entityId,
      entityKind: 'task',
      ...(locatorAfter ? { currentLocator: locatorAfter } : {}),
      ...(!locatorAfter ? { deletedAt: committedAt } : {}),
      lastSeenAt: committedAt,
    };

    try {
      const result = await store.commit(handle.operationId, event, entity);
      if (result === 'missing-pending') {
        this.operationEpochs.delete(handle.operationId);
        return;
      }
      this.operationEpochs.delete(handle.operationId);
      if (result === 'committed') {
        logger.flow('ItemHistory', 'event:committed', {
          action: event.action,
          sourcePluginId: event.cause.sourcePluginId,
          surface: event.cause.surface,
          changedFields: changes.map((change) => change.field),
          outcome: event.outcome,
        });
      }
    } catch (error) {
      this.operationEpochs.delete(handle.operationId);
      this.warnUnavailable(error, 'commit-failed');
      return;
    }
    this.schedulePruneAfterCommit();
  }

  async abortTaskMutation(handle: ItemHistoryTaskMutationHandle | null | undefined): Promise<void> {
    if (!handle || !this.store) return;
    this.operationEpochs.delete(handle.operationId);
    try {
      await this.store.abort(handle.operationId);
    } catch (error) {
      this.warnUnavailable(error, 'abort-failed');
    }
  }

  async resolveEntity(reference: string | ItemHistoryTaskReference): Promise<string | null> {
    if (typeof reference === 'string') return String(reference || '').trim() || null;
    const explicit = String(reference.entityId || '').trim();
    if (explicit) return explicit;
    const rawLine = String(reference.rawLine || '');
    const direct = getTaskHistoryIdentity(rawLine);
    if (direct) return direct;

    const path = String(reference.path || '').trim();
    const lineNumber = Number(reference.lineNumber);
    if (!path || !Number.isFinite(lineNumber)) return null;
    const file = this.plugin.app.vault.getFileByPath(path);
    if (!file) return null;
    try {
      const content = await this.plugin.app.vault.cachedRead(file);
      const lines = content.split(/\r?\n/u);
      return getTaskHistoryIdentity(lines[Math.max(0, Math.floor(lineNumber))] || '') || null;
    } catch {
      return null;
    }
  }

  async query(
    reference: string | ItemHistoryTaskReference,
    options: ItemHistoryQueryOptions = {},
  ): Promise<ItemHistoryEvent[]> {
    if (!(await this.ensureReady(true)) || !this.store) return [];
    await this.pruneReadyStore();
    const entityId = await this.resolveEntity(reference);
    if (!entityId) return [];
    try {
      return await this.store.query(entityId, options.limit ?? 50, options.before, options.beforeEventId);
    } catch (error) {
      this.warnUnavailable(error, 'query-failed');
      return [];
    }
  }

  async prune(): Promise<void> {
    if (!(await this.ensureReady(true)) || !this.store) return;
    await this.pruneReadyStore();
  }

  private async pruneReadyStore(): Promise<void> {
    if (!this.store) return;
    if (this.pruneTimer != null) {
      globalThis.clearTimeout(this.pruneTimer);
      this.pruneTimer = null;
    }
    if (this.pruneInFlight) return this.pruneInFlight;
    const store = this.store;
    const includedCommitCount = this.successfulCommitsSincePrune;
    const prune = (async () => {
      const retentionDays = clampNumber(
        this.plugin.settings.itemHistoryRetentionDays,
        DEFAULT_RETENTION_DAYS,
        1,
        MAX_RETENTION_DAYS,
      );
      const maxEntries = clampNumber(
        this.plugin.settings.itemHistoryMaxEntries,
        MAX_GLOBAL_ENTRIES,
        100,
        MAX_GLOBAL_ENTRIES,
      );
      const now = Date.now();
      try {
        await store.prune({
          minOccurredAt: now - retentionDays * DAY_MS,
          maxEntries,
          maxPerEntity: MAX_PER_ENTITY,
          pendingBefore: now - PENDING_RETENTION_MS,
        });
        this.successfulCommitsSincePrune = Math.max(
          0,
          this.successfulCommitsSincePrune - includedCommitCount,
        );
        this.lastPrunedAt = Date.now();
      } catch (error) {
        this.warnUnavailable(error, 'prune-failed');
      }
    })();
    this.pruneInFlight = prune;
    try {
      await prune;
    } finally {
      if (this.pruneInFlight === prune) this.pruneInFlight = null;
    }
  }

  async stats(): Promise<ItemHistoryStoreStats> {
    if (!(await this.ensureReady(true)) || !this.store) return { events: 0, entities: 0, pending: 0 };
    try {
      return await this.store.stats();
    } catch (error) {
      this.warnUnavailable(error, 'stats-failed');
      return { events: 0, entities: 0, pending: 0 };
    }
  }

  async clear(): Promise<void> {
    this.mutationEpoch += 1;
    this.operationEpochs.clear();
    this.discardPendingOnNextSetup = true;
    this.clearAllOnNextSetup = true;
    this.savePendingInvalidationMarker(true);
    this.saveClearAllMarker(true);
    await this.ensureReady(true);
  }

  dispose(): void {
    this.disposed = true;
    if (this.pruneTimer != null) globalThis.clearTimeout(this.pruneTimer);
    this.pruneTimer = null;
    this.store?.dispose();
    this.store = null;
    this.ready = null;
    this.operationEpochs.clear();
  }

  private shouldDiscardPendingOnSetup(): boolean {
    if (this.discardPendingOnNextSetup) return true;
    try {
      return this.plugin.app.loadLocalStorage(this.pendingInvalidationStorageKey()) === true;
    } catch {
      return false;
    }
  }

  private savePendingInvalidationMarker(invalidated: boolean): void {
    try {
      this.plugin.app.saveLocalStorage(
        this.pendingInvalidationStorageKey(),
        invalidated ? true : null,
      );
    } catch {
      // The in-memory flag still protects this plugin session.
    }
  }

  private pendingInvalidationStorageKey(): string {
    return `${this.plugin.manifest.id}:${PENDING_INVALIDATION_STORAGE_KEY}`;
  }

  private shouldClearAllOnSetup(): boolean {
    if (this.clearAllOnNextSetup) return true;
    try {
      return this.plugin.app.loadLocalStorage(this.clearAllStorageKey()) === true;
    } catch {
      return false;
    }
  }

  private saveClearAllMarker(clearRequested: boolean): void {
    try {
      this.plugin.app.saveLocalStorage(
        this.clearAllStorageKey(),
        clearRequested ? true : null,
      );
    } catch {
      // The in-memory flag still protects this plugin session.
    }
  }

  private clearAllStorageKey(): string {
    return `${this.plugin.manifest.id}:${CLEAR_ALL_STORAGE_KEY}`;
  }

  private async satisfyClearAllIntent(): Promise<boolean> {
    if (!this.shouldClearAllOnSetup()) return true;
    if (this.clearAllInFlight) return this.clearAllInFlight;
    if (!this.store) return false;

    const store = this.store;
    const clearEpoch = this.mutationEpoch;
    const clearing = (async () => {
      try {
        await store.clear();
      } catch (error) {
        this.warnUnavailable(error, 'clear-failed');
        return false;
      }
      if (
        this.disposed
        || clearEpoch !== this.mutationEpoch
        || this.store !== store
      ) {
        return false;
      }
      this.clearAllOnNextSetup = false;
      this.discardPendingOnNextSetup = false;
      this.saveClearAllMarker(false);
      this.savePendingInvalidationMarker(false);
      return true;
    })();
    this.clearAllInFlight = clearing;
    try {
      return await clearing;
    } finally {
      if (this.clearAllInFlight === clearing) this.clearAllInFlight = null;
    }
  }

  private schedulePruneAfterCommit(): void {
    this.successfulCommitsSincePrune += 1;
    const now = Date.now();
    if (
      this.pruneInFlight
      || this.pruneTimer != null
      || (this.lastPrunedAt > 0
        && now - this.lastPrunedAt < PRUNE_INTERVAL_MS
        && this.successfulCommitsSincePrune < PRUNE_COMMIT_INTERVAL)
    ) {
      return;
    }
    this.pruneTimer = globalThis.setTimeout(() => {
      this.pruneTimer = null;
      void this.pruneReadyStore();
    }, 0);
  }

  private async reconcilePendingAtStartup(expectedEpoch: number): Promise<void> {
    if (!this.store || !this.isCurrentRecordingEpoch(expectedEpoch)) return;
    const store = this.store;
    let pending: ItemHistoryPendingRecord[];
    try {
      pending = await store.listPending();
    } catch (error) {
      this.warnUnavailable(error, 'pending-read-failed');
      return;
    }
    if (this.store !== store || !this.isCurrentRecordingEpoch(expectedEpoch)) return;

    for (const record of pending) {
      if (this.store !== store || !this.isCurrentRecordingEpoch(expectedEpoch)) return;
      try {
        const resolution = await this.resolvePendingRecord(record);
        if (this.store !== store || !this.isCurrentRecordingEpoch(expectedEpoch)) return;
        if (resolution.state === 'aborted') {
          await store.abort(record.operationId);
          logger.flow('ItemHistory', 'pending:reconciled', {
            action: record.action,
            resolution: 'aborted',
          });
          continue;
        }
        if (resolution.state === 'committed') {
          await this.commitTaskMutationInternal(record, {
            after: resolution.after,
            ...(resolution.sourceDisposition
              ? { sourceDisposition: resolution.sourceDisposition }
              : {}),
            outcome: resolution.outcome,
          }, true);
          if (this.store !== store || !this.isCurrentRecordingEpoch(expectedEpoch)) return;
          const stillPending = await store.getPending(record.operationId);
          if (!stillPending) {
            logger.flow('ItemHistory', 'pending:reconciled', {
              action: record.action,
              resolution: resolution.outcome,
            });
          }
        }
        // Uncertain records remain pending for up to 24 hours. A successful
        // event is never fabricated from ambiguous vault state.
      } catch {
        // Treat inspection or recovery failures as uncertain and retain the
        // pending record. Content writes must never depend on recovery.
      }
    }
  }

  private async resolvePendingRecord(record: ItemHistoryPendingRecord): Promise<PendingTaskResolution> {
    const source = await this.observePendingTask(record.locatorBefore.path, record.entityId);
    const target = record.targetPath && record.targetPath !== record.locatorBefore.path
      ? await this.observePendingTask(record.targetPath, record.entityId)
      : source;
    const sourceUnchanged = source.state === 'found'
      && source.lineNumber === record.locatorBefore.lineNumber
      && taskSnapshotsEqual(source.snapshot, record.before);
    const targetMatchesBefore = target.state === 'found'
      && taskSnapshotsEqual(target.snapshot, record.before);

    if (record.action === 'task.create') {
      if (
        record.identityWasPresent !== false
        || source.state !== 'found'
        || !taskSnapshotsEqual(source.snapshot, record.before)
      ) {
        return { state: 'uncertain' };
      }
      return {
        state: 'committed',
        after: observationToMutationInput(source),
        outcome: 'committed',
      };
    }

    if (record.action === 'task.move' || record.action === 'task.migrate') {
      if (target.state === 'found' && target !== source) {
        if (
          record.identityWasPresent === true
          && source.state === 'absent'
          && targetMatchesBefore
        ) {
          return {
            state: 'committed',
            after: observationToMutationInput(target),
            sourceDisposition: record.action === 'task.migrate' ? 'migrated' : 'removed',
            outcome: 'committed',
          };
        }
        return { state: 'uncertain' };
      }
      if (
        sourceUnchanged
        && (target.state === 'absent' || target.state === 'missing-file')
      ) return { state: 'aborted' };
      return { state: 'uncertain' };
    }

    if (
      (record.action === 'task.update' || record.action === 'task.checkbox')
      && record.identityWasPresent === false
      && source.state === 'found'
    ) {
      return {
        state: 'committed',
        after: observationToMutationInput(source),
        sourceDisposition: 'retained',
        outcome: 'committed',
      };
    }

    if (sourceUnchanged) return { state: 'aborted' };
    return { state: 'uncertain' };
  }

  private async observePendingTask(path: string, entityId: string): Promise<PendingTaskObservation> {
    const file = this.plugin.app.vault.getFileByPath(path);
    if (!file) return { state: 'missing-file' };
    try {
      const content = await this.plugin.app.vault.cachedRead(file);
      const matches: Array<Extract<PendingTaskObservation, { state: 'found' }>> = [];
      const lines = content.split(/\r?\n/u);
      for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
        const rawLine = lines[lineNumber] || '';
        if (getTaskHistoryIdentity(rawLine) !== entityId) continue;
        try {
          ensureTaskHistoryIdentity(rawLine, entityId);
        } catch {
          return { state: 'ambiguous' };
        }
        const snapshot = this.snapshotTask(rawLine);
        if (!snapshot) continue;
        matches.push({ state: 'found', path, lineNumber, rawLine, snapshot });
        if (matches.length > 1) return { state: 'ambiguous' };
      }
      return matches[0] ?? { state: 'absent' };
    } catch {
      return { state: 'unreadable' };
    }
  }

  private async ensureReady(allowDisabled = false): Promise<boolean> {
    if (this.disposed || (!allowDisabled && this.plugin.settings.enableItemHistory === false)) return false;
    let available: boolean;
    if (this.ready) {
      available = await this.ready;
    } else {
      const readinessEpoch = this.mutationEpoch;
      const readiness = (async () => {
        let store = this.store;
        try {
          if (!store) {
            if (this.providedStore) {
              store = this.providedStore;
            } else {
              const namespace = await createVaultHistoryNamespace(this.plugin);
              store = new IndexedDbItemHistoryStore(namespace);
            }
            if (this.disposed || readinessEpoch !== this.mutationEpoch) {
              store.dispose();
              return false;
            }
            this.store = store;
          }
          await store.setup();
          if (this.disposed || readinessEpoch !== this.mutationEpoch || this.store !== store) {
            store.dispose();
            if (this.store === store) this.store = null;
            return false;
          }
          return true;
        } catch (error) {
          this.warnUnavailable(error, 'setup-failed');
          store?.dispose();
          if (this.store === store) this.store = null;
          return false;
        }
      })();
      this.ready = readiness;
      available = await readiness;
      if (!available && this.ready === readiness && !this.disposed) this.ready = null;
    }
    if (!available) return false;
    return this.satisfyClearAllIntent();
  }

  private snapshotTask(rawLine: string): ItemHistoryTaskSnapshot | null {
    const aliases = new Map<string, 'status' | 'priority' | 'tags'>();
    const configured = Array.isArray(this.plugin.settings.properties)
      ? this.plugin.settings.properties
      : [];
    for (const property of configured) {
      const id = String(property?.id || '').trim().toLowerCase();
      const key = String(property?.key || '').trim().toLowerCase();
      const canonical = id === 'status'
        ? 'status'
        : id === 'priority'
          ? 'priority'
          : id === 'tag' || id === 'tags'
            ? 'tags'
            : null;
      if (key && canonical) aliases.set(key, canonical);
    }
    const workflowStatusKey = String(
      this.plugin.sharedServices?.status?.getStatusPropertyKey?.() || '',
    ).trim().toLowerCase();
    if (workflowStatusKey) aliases.set(workflowStatusKey, 'status');
    return snapshotTaskForHistory(rawLine, aliases);
  }

  private isCurrentRecordingEpoch(expectedEpoch: number): boolean {
    return !this.disposed
      && isItemHistoryEnabled(this.plugin)
      && expectedEpoch === this.mutationEpoch
      && this.store != null;
  }

  private warnUnavailable(error: unknown, event: string): void {
    if (this.warnedUnavailable) return;
    this.warnedUnavailable = true;
    logger.flowError('ItemHistory', event, error, {
      consequence: 'content-mutation-continues-without-history',
    });
  }
}

function normalizeLocator(path: string, lineNumber: number) {
  return {
    path: String(path || '').trim(),
    lineNumber: Math.max(0, Math.floor(Number(lineNumber) || 0)),
  };
}

function isItemHistoryEnabled(plugin: TPSGlobalContextMenuPlugin): boolean {
  return plugin.settings.enableItemHistory !== false;
}

function observationToMutationInput(
  observation: Extract<PendingTaskObservation, { state: 'found' }>,
): { path: string; lineNumber: number; rawLine: string } {
  return {
    path: observation.path,
    lineNumber: observation.lineNumber,
    rawLine: observation.rawLine,
  };
}

function taskSnapshotsEqual(
  left: ItemHistoryTaskSnapshot,
  right: ItemHistoryTaskSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mutationHandleMatchesPending(
  handle: ItemHistoryTaskMutationHandle,
  pending: ItemHistoryPendingRecord,
): boolean {
  return handle.operationId === pending.operationId
    && handle.entityId === pending.entityId
    && handle.action === pending.action
    && handle.startedAt === pending.startedAt
    && handle.identityWasPresent === pending.identityWasPresent
    && String(handle.targetPath || '') === String(pending.targetPath || '')
    && JSON.stringify(handle.cause) === JSON.stringify(pending.cause)
    && JSON.stringify(handle.before) === JSON.stringify(pending.before)
    && JSON.stringify(handle.locatorBefore) === JSON.stringify(pending.locatorBefore);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

function createItemHistoryId(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}_${random.replace(/[^a-zA-Z0-9_-]/gu, '')}`;
}

export async function createVaultHistoryNamespace(plugin: TPSGlobalContextMenuPlugin): Promise<string> {
  const pinned = readPinnedHistoryNamespace(plugin);
  if (pinned) return pinned;

  const adapter = plugin.app.vault.adapter as any;
  const basePath = typeof adapter?.getBasePath === 'function'
    ? String(adapter.getBasePath() || '')
    : '';
  const appId = String((plugin.app as any).appId || '').trim();
  const vaultScopedId = getOrCreateVaultScopedHistoryId(plugin);
  const vaultName = String(plugin.app.vault.getName?.() || 'vault');
  const source = [plugin.manifest.id, appId, vaultScopedId, basePath, vaultName].join('\u0000');
  const hash = await hashNamespace(source);
  const legacyCompatible = `${plugin.manifest.id}-item-history-${hash}`;
  if (pinHistoryNamespace(plugin, legacyCompatible)) return legacyCompatible;

  // The local-storage pin normally preserves the exact database name used by
  // early history builds. If that write is unavailable, prefer identities that
  // remain stable across a vault folder/name change before using the legacy
  // path-based isolation fallback.
  const stableSource = vaultScopedId
    ? [plugin.manifest.id, 'vault-id', vaultScopedId].join('\u0000')
    : appId
      ? [plugin.manifest.id, 'app-id', appId].join('\u0000')
      : source;
  const stableHash = await hashNamespace(stableSource);
  return `${plugin.manifest.id}-item-history-${stableHash}`;
}

function readPinnedHistoryNamespace(plugin: TPSGlobalContextMenuPlugin): string {
  try {
    const value = String(plugin.app.loadLocalStorage(historyNamespaceStorageKey(plugin)) || '').trim();
    const prefix = `${plugin.manifest.id}-item-history-`;
    return value.startsWith(prefix) && /^[a-f0-9]{8,32}$/u.test(value.slice(prefix.length))
      ? value
      : '';
  } catch {
    return '';
  }
}

function pinHistoryNamespace(plugin: TPSGlobalContextMenuPlugin, namespace: string): boolean {
  try {
    plugin.app.saveLocalStorage(historyNamespaceStorageKey(plugin), namespace);
    return plugin.app.loadLocalStorage(historyNamespaceStorageKey(plugin)) === namespace;
  } catch {
    return false;
  }
}

function historyNamespaceStorageKey(plugin: TPSGlobalContextMenuPlugin): string {
  return `${plugin.manifest.id}:${DATABASE_NAMESPACE_STORAGE_KEY}`;
}

function getOrCreateVaultScopedHistoryId(plugin: TPSGlobalContextMenuPlugin): string {
  const storageKey = `${plugin.manifest.id}:item-history:vault-id`;
  try {
    const existing = String(plugin.app.loadLocalStorage(storageKey) || '').trim();
    if (existing) return existing;
    const created = createItemHistoryId('vault');
    plugin.app.saveLocalStorage(storageKey, created);
    return created;
  } catch {
    return '';
  }
}

async function hashNamespace(value: string): Promise<string> {
  try {
    if (globalThis.crypto?.subtle) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
      return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // Use the deterministic fallback below.
  }
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
