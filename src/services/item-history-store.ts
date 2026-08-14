import type {
  ItemHistoryEntityRecord,
  ItemHistoryEvent,
  ItemHistoryPendingRecord,
} from './item-history-core';

export interface ItemHistoryStoreStats {
  events: number;
  entities: number;
  pending: number;
}

export interface ItemHistoryPruneOptions {
  minOccurredAt: number;
  maxEntries: number;
  maxPerEntity: number;
  pendingBefore: number;
}

export type ItemHistoryCommitResult = 'committed' | 'idempotent' | 'missing-pending';

export interface ItemHistoryStore {
  setup(): Promise<void>;
  putPending(record: ItemHistoryPendingRecord): Promise<void>;
  getPending(operationId: string): Promise<ItemHistoryPendingRecord | null>;
  listPending(): Promise<ItemHistoryPendingRecord[]>;
  abort(operationId: string): Promise<void>;
  commit(
    operationId: string,
    event: ItemHistoryEvent,
    entity: ItemHistoryEntityRecord,
  ): Promise<ItemHistoryCommitResult>;
  query(entityId: string, limit: number, before?: number, beforeEventId?: string): Promise<ItemHistoryEvent[]>;
  prune(options: ItemHistoryPruneOptions): Promise<void>;
  stats(): Promise<ItemHistoryStoreStats>;
  clearPending(): Promise<void>;
  clear(): Promise<void>;
  dispose(): void;
}

const EVENTS_STORE = 'events';
const ENTITIES_STORE = 'entities';
const PENDING_STORE = 'pending';
const DAY_MS = 86_400_000;
const HARD_MAX_RETENTION_DAYS = 365;
const HARD_MAX_GLOBAL_ENTRIES = 25_000;
const HARD_MAX_PER_ENTITY = 200;

export class IndexedDbItemHistoryStore implements ItemHistoryStore {
  private db: IDBDatabase | null = null;

  constructor(private readonly databaseName: string) {}

  async setup(): Promise<void> {
    if (this.db) return;
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable.');
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onerror = () => reject(request.error ?? new Error('Could not open item history.'));
      request.onblocked = () => reject(new Error('Item history database upgrade was blocked.'));
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(EVENTS_STORE)) {
          const events = db.createObjectStore(EVENTS_STORE, { keyPath: 'eventId' });
          events.createIndex('entityId', 'entityId', { unique: false });
          events.createIndex('occurredAt', 'occurredAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(ENTITIES_STORE)) {
          db.createObjectStore(ENTITIES_STORE, { keyPath: 'entityId' });
        }
        if (!db.objectStoreNames.contains(PENDING_STORE)) {
          db.createObjectStore(PENDING_STORE, { keyPath: 'operationId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  async putPending(record: ItemHistoryPendingRecord): Promise<void> {
    const transaction = this.transaction([PENDING_STORE], 'readwrite');
    transaction.objectStore(PENDING_STORE).put(record);
    await transactionDone(transaction);
  }

  async listPending(): Promise<ItemHistoryPendingRecord[]> {
    const transaction = this.transaction([PENDING_STORE], 'readonly');
    const records = await requestResult<ItemHistoryPendingRecord[]>(
      transaction.objectStore(PENDING_STORE).getAll(),
    );
    await transactionDone(transaction);
    return records.sort((left, right) => left.startedAt - right.startedAt);
  }

  async getPending(operationId: string): Promise<ItemHistoryPendingRecord | null> {
    const transaction = this.transaction([PENDING_STORE], 'readonly');
    const record = await requestResult<ItemHistoryPendingRecord | undefined>(
      transaction.objectStore(PENDING_STORE).get(operationId),
    );
    await transactionDone(transaction);
    return record ?? null;
  }

  async abort(operationId: string): Promise<void> {
    const transaction = this.transaction([PENDING_STORE], 'readwrite');
    transaction.objectStore(PENDING_STORE).delete(operationId);
    await transactionDone(transaction);
  }

  async commit(
    operationId: string,
    event: ItemHistoryEvent,
    entity: ItemHistoryEntityRecord,
  ): Promise<ItemHistoryCommitResult> {
    return new Promise<ItemHistoryCommitResult>((resolve, reject) => {
      const transaction = this.transaction([EVENTS_STORE, ENTITIES_STORE, PENDING_STORE], 'readwrite');
      const eventsStore = transaction.objectStore(EVENTS_STORE);
      const entitiesStore = transaction.objectStore(ENTITIES_STORE);
      const pendingStore = transaction.objectStore(PENDING_STORE);
      const eventRequest = eventsStore.get(event.eventId);
      const pendingRequest = pendingStore.get(operationId);
      let eventRead = false;
      let pendingRead = false;
      let existing: ItemHistoryEvent | undefined;
      let pending: ItemHistoryPendingRecord | undefined;
      let result: ItemHistoryCommitResult = 'missing-pending';
      let explicitError: Error | null = null;

      const abortWith = (error: Error): void => {
        explicitError = error;
        try {
          transaction.abort();
        } catch {
          reject(error);
        }
      };
      const applyCommit = (): void => {
        if (!eventRead || !pendingRead) return;
        if (existing && !recordsEqual(existing, event)) {
          abortWith(new Error(`Item history event ${event.eventId} already exists with different content.`));
          return;
        }
        if (existing && !pending) {
          result = 'idempotent';
          return;
        }
        if (!pending) {
          result = 'missing-pending';
          return;
        }
        if (!pendingMatchesCommit(pending, operationId, event, entity)) {
          abortWith(new Error(`Item history pending operation ${operationId} does not match the event.`));
          return;
        }

        // IndexedDB guarantees the transaction is active inside request
        // callbacks. Enqueue every dependent write here without an await so
        // WebKit cannot auto-commit between the reads and writes.
        if (!existing) eventsStore.add(event);
        entitiesStore.put(entity);
        pendingStore.delete(operationId);
        result = existing ? 'idempotent' : 'committed';
      };

      eventRequest.onsuccess = () => {
        existing = eventRequest.result as ItemHistoryEvent | undefined;
        eventRead = true;
        applyCommit();
      };
      pendingRequest.onsuccess = () => {
        pending = pendingRequest.result as ItemHistoryPendingRecord | undefined;
        pendingRead = true;
        applyCommit();
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(
        explicitError ?? transaction.error ?? new Error('Item history transaction failed.'),
      );
      transaction.onabort = () => reject(
        explicitError ?? transaction.error ?? new Error('Item history transaction was aborted.'),
      );
    });
  }

  async query(entityId: string, limit: number, before?: number, beforeEventId?: string): Promise<ItemHistoryEvent[]> {
    const transaction = this.transaction([EVENTS_STORE], 'readonly');
    const rows = await requestResult<ItemHistoryEvent[]>(
      transaction.objectStore(EVENTS_STORE).index('entityId').getAll(entityId),
    );
    await transactionDone(transaction);
    return rows
      .filter((event) => eventPrecedesCursor(event, before, beforeEventId))
      .sort(compareEventsNewestFirst)
      .slice(0, Math.max(1, Math.min(200, Math.floor(limit || 50))));
  }

  async prune(options: ItemHistoryPruneOptions): Promise<void> {
    const bounded = normalizePruneOptions(options);
    return new Promise<void>((resolve, reject) => {
      const transaction = this.transaction([EVENTS_STORE, ENTITIES_STORE, PENDING_STORE], 'readwrite');
      const eventsStore = transaction.objectStore(EVENTS_STORE);
      const entitiesStore = transaction.objectStore(ENTITIES_STORE);
      const pendingStore = transaction.objectStore(PENDING_STORE);
      const retainedEntities = new Set<string>();
      const perEntity = new Map<string, number>();
      let retainedTotal = 0;
      let explicitError: Error | null = null;

      const abortWith = (error: unknown): void => {
        explicitError = toError(error, 'Item history pruning failed.');
        try {
          transaction.abort();
        } catch {
          reject(explicitError);
        }
      };
      const pruneEntities = (): void => {
        const request = entitiesStore.openCursor();
        request.onsuccess = () => {
          try {
            const cursor = request.result;
            if (!cursor) return;
            const entity = cursor.value as ItemHistoryEntityRecord;
            if (!retainedEntities.has(entity.entityId)) cursor.delete();
            cursor.continue();
          } catch (error) {
            abortWith(error);
          }
        };
      };
      const prunePending = (): void => {
        const request = pendingStore.openCursor();
        request.onsuccess = () => {
          try {
            const cursor = request.result;
            if (!cursor) {
              pruneEntities();
              return;
            }
            const record = cursor.value as ItemHistoryPendingRecord;
            if (record.startedAt < bounded.pendingBefore) cursor.delete();
            cursor.continue();
          } catch (error) {
            abortWith(error);
          }
        };
      };
      const eventRequest = eventsStore.index('occurredAt').openCursor(null, 'prev');
      eventRequest.onsuccess = () => {
        try {
          const cursor = eventRequest.result;
          if (!cursor) {
            prunePending();
            return;
          }
          const event = cursor.value as ItemHistoryEvent;
          const count = perEntity.get(event.entityId) ?? 0;
          const retain = event.occurredAt >= bounded.minOccurredAt
            && retainedTotal < bounded.maxEntries
            && count < bounded.maxPerEntity;
          if (retain) {
            retainedEntities.add(event.entityId);
            perEntity.set(event.entityId, count + 1);
            retainedTotal += 1;
          } else {
            cursor.delete();
          }
          cursor.continue();
        } catch (error) {
          abortWith(error);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(
        explicitError ?? transaction.error ?? new Error('Item history transaction failed.'),
      );
      transaction.onabort = () => reject(
        explicitError ?? transaction.error ?? new Error('Item history transaction was aborted.'),
      );
    });
  }

  async stats(): Promise<ItemHistoryStoreStats> {
    const transaction = this.transaction([EVENTS_STORE, ENTITIES_STORE, PENDING_STORE], 'readonly');
    const result = await Promise.all([
      requestResult<number>(transaction.objectStore(EVENTS_STORE).count()),
      requestResult<number>(transaction.objectStore(ENTITIES_STORE).count()),
      requestResult<number>(transaction.objectStore(PENDING_STORE).count()),
    ]);
    await transactionDone(transaction);
    return { events: result[0], entities: result[1], pending: result[2] };
  }

  async clear(): Promise<void> {
    const transaction = this.transaction([EVENTS_STORE, ENTITIES_STORE, PENDING_STORE], 'readwrite');
    transaction.objectStore(EVENTS_STORE).clear();
    transaction.objectStore(ENTITIES_STORE).clear();
    transaction.objectStore(PENDING_STORE).clear();
    await transactionDone(transaction);
  }

  async clearPending(): Promise<void> {
    const transaction = this.transaction([PENDING_STORE], 'readwrite');
    transaction.objectStore(PENDING_STORE).clear();
    await transactionDone(transaction);
  }

  dispose(): void {
    this.db?.close();
    this.db = null;
  }

  private transaction(stores: string[], mode: IDBTransactionMode): IDBTransaction {
    if (!this.db) throw new Error('Item history is not initialized.');
    return this.db.transaction(stores, mode);
  }
}

export class MemoryItemHistoryStore implements ItemHistoryStore {
  readonly events = new Map<string, ItemHistoryEvent>();
  readonly entities = new Map<string, ItemHistoryEntityRecord>();
  readonly pending = new Map<string, ItemHistoryPendingRecord>();

  async setup(): Promise<void> {}

  async putPending(record: ItemHistoryPendingRecord): Promise<void> {
    this.pending.set(record.operationId, structuredCloneSafe(record));
  }

  async listPending(): Promise<ItemHistoryPendingRecord[]> {
    return [...this.pending.values()]
      .sort((left, right) => left.startedAt - right.startedAt)
      .map(structuredCloneSafe);
  }

  async getPending(operationId: string): Promise<ItemHistoryPendingRecord | null> {
    const record = this.pending.get(operationId);
    return record ? structuredCloneSafe(record) : null;
  }

  async abort(operationId: string): Promise<void> {
    this.pending.delete(operationId);
  }

  async commit(
    operationId: string,
    event: ItemHistoryEvent,
    entity: ItemHistoryEntityRecord,
  ): Promise<ItemHistoryCommitResult> {
    const existing = this.events.get(event.eventId);
    if (existing && !recordsEqual(existing, event)) {
      throw new Error(`Item history event ${event.eventId} already exists with different content.`);
    }
    const pending = this.pending.get(operationId);
    if (existing && !pending) return 'idempotent';
    if (!pending) return 'missing-pending';
    if (!pendingMatchesCommit(pending, operationId, event, entity)) {
      throw new Error(`Item history pending operation ${operationId} does not match the event.`);
    }
    if (!existing) this.events.set(event.eventId, structuredCloneSafe(event));
    this.entities.set(entity.entityId, structuredCloneSafe(entity));
    this.pending.delete(operationId);
    return existing ? 'idempotent' : 'committed';
  }

  async query(entityId: string, limit: number, before?: number, beforeEventId?: string): Promise<ItemHistoryEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.entityId === entityId && eventPrecedesCursor(event, before, beforeEventId))
      .sort(compareEventsNewestFirst)
      .slice(0, Math.max(1, Math.min(200, Math.floor(limit || 50))))
      .map(structuredCloneSafe);
  }

  async prune(options: ItemHistoryPruneOptions): Promise<void> {
    const bounded = normalizePruneOptions(options);
    const retained = [...this.events.values()]
      .sort(compareEventsNewestFirst)
      .filter((event) => event.occurredAt >= bounded.minOccurredAt);
    const counts = new Map<string, number>();
    const keep = new Set<string>();
    for (const event of retained) {
      const count = counts.get(event.entityId) ?? 0;
      if (keep.size >= bounded.maxEntries || count >= bounded.maxPerEntity) continue;
      keep.add(event.eventId);
      counts.set(event.entityId, count + 1);
    }
    for (const eventId of this.events.keys()) {
      if (!keep.has(eventId)) this.events.delete(eventId);
    }
    for (const [operationId, record] of this.pending) {
      if (record.startedAt < bounded.pendingBefore) this.pending.delete(operationId);
    }
    const retainedEntities = new Set([...this.events.values()].map((event) => event.entityId));
    for (const entityId of this.entities.keys()) {
      if (!retainedEntities.has(entityId)) this.entities.delete(entityId);
    }
  }

  async stats(): Promise<ItemHistoryStoreStats> {
    return { events: this.events.size, entities: this.entities.size, pending: this.pending.size };
  }

  async clear(): Promise<void> {
    this.events.clear();
    this.entities.clear();
    this.pending.clear();
  }

  async clearPending(): Promise<void> {
    this.pending.clear();
  }

  dispose(): void {}
}

function compareEventsNewestFirst(left: ItemHistoryEvent, right: ItemHistoryEvent): number {
  return right.occurredAt - left.occurredAt || right.eventId.localeCompare(left.eventId);
}

function eventPrecedesCursor(
  event: ItemHistoryEvent,
  before: number | undefined,
  beforeEventId: string | undefined,
): boolean {
  if (before == null) return true;
  if (event.occurredAt !== before) return event.occurredAt < before;
  const cursorId = String(beforeEventId || '').trim();
  return cursorId ? event.eventId.localeCompare(cursorId) < 0 : false;
}

function normalizePruneOptions(options: ItemHistoryPruneOptions): ItemHistoryPruneOptions {
  const now = Date.now();
  const oldestAllowed = now - HARD_MAX_RETENTION_DAYS * DAY_MS;
  return {
    minOccurredAt: Math.max(finiteNumber(options.minOccurredAt, oldestAllowed), oldestAllowed),
    maxEntries: Math.min(
      HARD_MAX_GLOBAL_ENTRIES,
      Math.max(0, Math.floor(finiteNumber(options.maxEntries, HARD_MAX_GLOBAL_ENTRIES))),
    ),
    maxPerEntity: Math.min(
      HARD_MAX_PER_ENTITY,
      Math.max(0, Math.floor(finiteNumber(options.maxPerEntity, HARD_MAX_PER_ENTITY))),
    ),
    pendingBefore: Math.max(finiteNumber(options.pendingBefore, now - DAY_MS), now - DAY_MS),
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pendingMatchesCommit(
  pending: ItemHistoryPendingRecord,
  operationId: string,
  event: ItemHistoryEvent,
  entity: ItemHistoryEntityRecord,
): boolean {
  return pending.operationId === operationId
    && event.eventId === operationId
    && event.operationId === operationId
    && pending.entityKind === 'task'
    && event.entityKind === pending.entityKind
    && entity.entityKind === pending.entityKind
    && event.entityId === pending.entityId
    && entity.entityId === pending.entityId
    && event.action === pending.action
    && event.occurredAt === pending.startedAt
    && recordsEqual(event.cause, pending.cause)
    // A stable task identity may relocate within the same source note between
    // rendering and the atomic write. The service confirms that exact live
    // revision; the pending record still constrains the source path.
    && event.locatorBefore.path === pending.locatorBefore.path;
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  const message = String(error ?? '').trim();
  return new Error(message || fallback);
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Item history transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Item history transaction was aborted.'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Item history request failed.'));
  });
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function recordsEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
