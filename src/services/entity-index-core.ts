export interface EntityIndexDimensionDefinition {
  /**
   * Public dimension name used by queries and exposed on indexed records.
   * Names are matched case-insensitively.
   */
  name: string;
  /**
   * Frontmatter properties that contribute values to this dimension.
   * Property names are matched case-insensitively.
   */
  propertyKeys: readonly string[];
}

export type EntityIndexEntityType = 'note' | 'block';
export type EntityIndexLineKind = 'task' | 'bullet' | 'heading';
export type EntityIndexReferenceState = 'ready' | 'provisional';

export interface EntityIndexLocator {
  path: string;
  entityType?: EntityIndexEntityType;
  subpath?: string;
  blockId?: string;
  lineNumber?: number;
  lineKind?: EntityIndexLineKind;
  locatorKey?: string;
}

export interface EntityIndexSource {
  /**
   * Stable entity identifier. Note-backed callers normally use the note path.
   */
  id?: string;
  path: string;
  name?: string;
  basename?: string;
  frontmatter?: Readonly<Record<string, unknown>> | null;
  /**
   * Provider-derived dimension values that are not persisted properties.
   * Values are unioned with configured property-backed values by dimension
   * name. This lets structural providers contribute identity without
   * pretending that a synthetic value was written into Markdown.
   */
  dimensions?: Readonly<Record<string, unknown>> | null;
  /**
   * Raw semantic inline fields for a block-backed entity. Keys retain the
   * first authored casing, while values retain authored order (including
   * blanks and repeated fields). Note-backed sources never expose this data.
   */
  lineProperties?: Readonly<Record<string, unknown>> | null;
  /**
   * Physical Markdown source. It equals `path` for note-backed entities and
   * lets several line-backed records coexist inside the same note.
   */
  sourcePath?: string;
  entityType?: EntityIndexEntityType;
  subpath?: string;
  blockId?: string;
  lineKind?: EntityIndexLineKind;
  /** One-based source line, used only while a block reference is provisional. */
  lineNumber?: number;
  referenceState?: EntityIndexReferenceState;
  /**
   * Stable locator identity. Providers should supply this for provisional
   * entities that do not have a native Markdown subpath yet.
   */
  locatorKey?: string;
  /** Provider-owned replacement scope. Usually supplied to replaceSource(). */
  sourceKey?: string;
}

export interface EntityIndexRecord {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly displayName: string;
  readonly basename: string;
  readonly dimensions: Readonly<Record<string, readonly string[]>>;
  /** Raw semantic inline fields. Present only on block-backed records. */
  readonly lineProperties?: Readonly<Record<string, readonly string[]>>;
  readonly sourcePath: string;
  readonly entityType: EntityIndexEntityType;
  readonly subpath: string;
  readonly blockId: string;
  readonly lineKind?: EntityIndexLineKind;
  readonly lineNumber?: number;
  readonly referenceState: EntityIndexReferenceState;
  readonly locatorKey: string;
  readonly referenceTarget: string;
}

export interface EntityIndexDimensionPredicate {
  anyOf?: string | readonly string[];
  allOf?: string | readonly string[];
  noneOf?: string | readonly string[];
}

export type EntityIndexFilter = Readonly<
  Record<
    string,
    string
    | readonly string[]
    | EntityIndexDimensionPredicate
    | null
    | undefined
  >
>;

export interface EntityIndexQuery {
  /**
   * Every named dimension must match at least one requested value.
   * Multiple values inside one dimension are alternatives.
   */
  allOf?: EntityIndexFilter;
  /**
   * At least one named dimension must match a requested value.
   */
  anyOf?: EntityIndexFilter;
  /**
   * No named dimension may match any requested value.
   */
  noneOf?: EntityIndexFilter;
  /**
   * Convenience alias for `allOf`, useful for simple exact dimension queries.
   */
  dimensions?: EntityIndexFilter;
  /**
   * Optional case-insensitive substring match against name, basename, and path.
   */
  search?: string;
  /** Restrict results to note- or block-backed entities. */
  entityTypes?: EntityIndexEntityType | readonly EntityIndexEntityType[];
  /** Restrict block results to one or more structural Markdown line kinds. */
  lineKinds?: EntityIndexLineKind | readonly EntityIndexLineKind[];
  limit?: number;
}

export type EntityIndexChangeListener = (revision: number) => void;

interface NormalizedDimensionDefinition {
  readonly name: string;
  readonly normalizedName: string;
  readonly propertyKeys: readonly string[];
  readonly normalizedPropertyKeys: readonly string[];
}

interface NormalizedFilterClause {
  readonly dimensionName: string;
  readonly anyOf: readonly string[];
  readonly allOf: readonly string[];
  readonly noneOf: readonly string[];
}

interface NormalizedQuery {
  readonly allOf: readonly NormalizedFilterClause[];
  readonly anyOf: readonly NormalizedFilterClause[];
  readonly noneOf: readonly NormalizedFilterClause[];
  readonly search: string;
  readonly entityTypes: readonly EntityIndexEntityType[];
  readonly lineKinds: readonly EntityIndexLineKind[];
  readonly limit: number | null;
}

const EMPTY_RECORDS = Object.freeze([]) as readonly EntityIndexRecord[];
const MAX_QUERY_CACHE_ENTRIES = 256;

function normalizeLookupValue(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function compareText(left: string, right: string): number {
  const normalizedLeft = normalizeLookupValue(left);
  const normalizedRight = normalizeLookupValue(right);
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizePath(path: string): string {
  return normalizeLookupValue(path.replace(/\\/g, '/'));
}

function normalizeSubpath(subpath: string): string {
  const value = String(subpath || '').trim();
  if (!value) return '';
  if (value.startsWith('#')) return value;
  if (value.startsWith('^')) return `#${value}`;
  return `#${value}`;
}

function locatorKeyFor(
  locator: EntityIndexLocator,
): string {
  const explicit = normalizeLookupValue(locator.locatorKey);
  if (explicit) return explicit;
  const path = normalizePath(locator.path);
  if (!path) return '';
  const entityType = locator.entityType || (locator.blockId || locator.subpath ? 'block' : 'note');
  const blockId = normalizeLookupValue(locator.blockId).replace(/^\^/u, '');
  const subpath = blockId ? `#^${blockId}` : normalizeSubpath(locator.subpath || '').toLocaleLowerCase();
  if (entityType === 'block') {
    if (subpath) return `block:${path}${subpath}`;
    const lineNumber = Number.isFinite(Number(locator.lineNumber))
      ? Math.max(1, Math.floor(Number(locator.lineNumber)))
      : 0;
    const lineKind = normalizeLookupValue(locator.lineKind);
    return `block-provisional:${path}:${lineKind}:${lineNumber}`;
  }
  return `note:${path}`;
}

function uniqueDisplayValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const displayValue = String(value ?? '').trim();
    const normalizedValue = normalizeLookupValue(displayValue);
    if (!normalizedValue || seen.has(normalizedValue)) continue;
    seen.add(normalizedValue);
    result.push(displayValue);
  }
  return Object.freeze(result);
}

function flattenDimensionValue(value: unknown, target: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) flattenDimensionValue(item, target);
    return;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const normalized = String(value).trim();
    if (normalized) target.push(normalized);
  }
}

function normalizedDefinition(
  definition: EntityIndexDimensionDefinition,
): NormalizedDimensionDefinition {
  const name = String(definition?.name ?? '').trim();
  if (!name) throw new Error('Entity index dimensions require a non-empty name.');

  const normalizedKeys = new Set<string>();
  const propertyKeys: string[] = [];
  for (const rawKey of definition.propertyKeys ?? []) {
    const key = String(rawKey ?? '').trim();
    const normalizedKey = normalizeLookupValue(key);
    if (!normalizedKey || normalizedKeys.has(normalizedKey)) continue;
    normalizedKeys.add(normalizedKey);
    propertyKeys.push(key);
  }

  return Object.freeze({
    name,
    normalizedName: normalizeLookupValue(name),
    propertyKeys: Object.freeze(propertyKeys),
    normalizedPropertyKeys: Object.freeze(propertyKeys.map(normalizeLookupValue)),
  });
}

function definitionsEqual(
  left: readonly NormalizedDimensionDefinition[],
  right: readonly NormalizedDimensionDefinition[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((definition, index) => {
    const candidate = right[index];
    return definition.normalizedName === candidate.normalizedName
      && definition.name === candidate.name
      && definition.normalizedPropertyKeys.length === candidate.normalizedPropertyKeys.length
      && definition.normalizedPropertyKeys.every(
        (propertyKey, propertyIndex) =>
          propertyKey === candidate.normalizedPropertyKeys[propertyIndex],
      );
  });
}

function recordsEqual(left: EntityIndexRecord | undefined, right: EntityIndexRecord): boolean {
  if (!left) return false;
  if (
    left.id !== right.id
    || left.path !== right.path
    || left.name !== right.name
    || left.displayName !== right.displayName
    || left.basename !== right.basename
    || left.sourcePath !== right.sourcePath
    || left.entityType !== right.entityType
    || left.subpath !== right.subpath
    || left.blockId !== right.blockId
    || left.lineKind !== right.lineKind
    || left.lineNumber !== right.lineNumber
    || left.referenceState !== right.referenceState
    || left.locatorKey !== right.locatorKey
    || left.referenceTarget !== right.referenceTarget
  ) {
    return false;
  }

  const leftEntries = Object.entries(left.dimensions);
  const rightEntries = Object.entries(right.dimensions);
  if (leftEntries.length !== rightEntries.length) return false;
  const dimensionsEqual = leftEntries.every(([name, values], index) => {
    const [rightName, rightValues] = rightEntries[index] ?? [];
    return name === rightName
      && values.length === rightValues.length
      && values.every((value, valueIndex) => value === rightValues[valueIndex]);
  });
  if (!dimensionsEqual) return false;

  const leftLineProperties = Object.entries(left.lineProperties ?? {});
  const rightLineProperties = Object.entries(right.lineProperties ?? {});
  if (leftLineProperties.length !== rightLineProperties.length) return false;
  return leftLineProperties.every(([name, values], index) => {
    const [rightName, rightValues] = rightLineProperties[index] ?? [];
    return name === rightName
      && values.length === rightValues.length
      && values.every((value, valueIndex) => value === rightValues[valueIndex]);
  });
}

function normalizeLineProperties(
  value: Readonly<Record<string, unknown>> | null | undefined,
): Readonly<Record<string, readonly string[]>> | undefined {
  const properties = Object.create(null) as Record<string, readonly string[]>;
  const authoredKeyByIdentity = new Map<string, string>();

  for (const [rawKey, rawValues] of Object.entries(value ?? {})) {
    const key = String(rawKey || '').trim();
    const identity = normalizeLookupValue(key);
    if (!key || !identity) continue;
    const authoredKey = authoredKeyByIdentity.get(identity) ?? key;
    if (!authoredKeyByIdentity.has(identity)) authoredKeyByIdentity.set(identity, authoredKey);
    const priorValues = properties[authoredKey] ?? [];
    const nextValues = (Array.isArray(rawValues) ? rawValues : [rawValues])
      .filter((item) => item !== null && item !== undefined)
      .map((item) => String(item));
    properties[authoredKey] = Object.freeze([...priorValues, ...nextValues]);
  }

  return Object.keys(properties).length > 0
    ? Object.freeze(properties)
    : undefined;
}

function normalizeFilter(
  filter: EntityIndexFilter | undefined,
  dimensionNames: ReadonlyMap<string, string>,
): readonly NormalizedFilterClause[] {
  if (!filter) return Object.freeze([]);
  const clauses: NormalizedFilterClause[] = [];

  for (const [rawName, rawValues] of Object.entries(filter)) {
    const normalizedName = normalizeLookupValue(rawName);
    const dimensionName = dimensionNames.get(normalizedName) ?? normalizedName;
    const isPredicate = typeof rawValues === 'object'
      && rawValues !== null
      && !Array.isArray(rawValues);
    const predicate = isPredicate
      ? rawValues as EntityIndexDimensionPredicate
      : { anyOf: rawValues as string | readonly string[] | null | undefined };
    const normalizePredicateValues = (
      values: string | readonly string[] | null | undefined,
    ): readonly string[] => uniqueDisplayValues(
      (Array.isArray(values) ? values : [values])
        .filter((value): value is string => value !== null && value !== undefined)
        .map((value) => String(value)),
    ).map(normalizeLookupValue).sort(compareText);
    const anyOf = normalizePredicateValues(predicate.anyOf);
    const allOf = normalizePredicateValues(predicate.allOf);
    const noneOf = normalizePredicateValues(predicate.noneOf);
    if (
      !normalizedName
      || (anyOf.length === 0 && allOf.length === 0 && noneOf.length === 0)
    ) {
      continue;
    }
    clauses.push(Object.freeze({
      dimensionName,
      anyOf: Object.freeze(anyOf),
      allOf: Object.freeze(allOf),
      noneOf: Object.freeze(noneOf),
    }));
  }

  clauses.sort((left, right) => compareText(left.dimensionName, right.dimensionName));
  return Object.freeze(clauses);
}

function recordMatchesClause(
  record: EntityIndexRecord,
  clause: NormalizedFilterClause,
): boolean {
  const values = getRecordDimensionValues(record, clause.dimensionName);
  const normalizedValues = new Set(values.map(normalizeLookupValue));
  if (
    clause.anyOf.length > 0
    && !clause.anyOf.some((value) => normalizedValues.has(value))
  ) {
    return false;
  }
  if (
    clause.allOf.length > 0
    && !clause.allOf.every((value) => normalizedValues.has(value))
  ) {
    return false;
  }
  if (clause.noneOf.some((value) => normalizedValues.has(value))) return false;
  return true;
}

function getRecordDimensionValues(
  record: EntityIndexRecord,
  dimensionName: string,
): readonly string[] {
  if (!Object.prototype.hasOwnProperty.call(record.dimensions, dimensionName)) return [];
  const values = record.dimensions[dimensionName];
  return Array.isArray(values) ? values : [];
}

/**
 * A generic, synchronous, immutable entity index.
 *
 * The core deliberately knows nothing about Obsidian or specific dimensions. A
 * host supplies note-like sources and dimension definitions, while callers can
 * query any configured dimension with the same exact-match semantics.
 */
export class EntityIndexCore {
  private definitions: readonly NormalizedDimensionDefinition[] = Object.freeze([]);
  private readonly recordsById = new Map<string, EntityIndexRecord>();
  private readonly noteIdsByPath = new Map<string, string>();
  private readonly idsByLocator = new Map<string, string>();
  private readonly idsBySourcePath = new Map<string, Set<string>>();
  private readonly sourceKeyById = new Map<string, string>();
  private readonly idsBySourceKey = new Map<string, Set<string>>();
  private readonly queryCache = new Map<string, readonly EntityIndexRecord[]>();
  private readonly dimensionValueCache = new Map<string, readonly string[]>();
  private readonly listeners = new Set<EntityIndexChangeListener>();
  private mutationBatchDepth = 0;
  private mutationBatchChanged = false;
  private mutationBatchNotify = false;
  private revision = 0;

  configureDimensions(
    definitions: readonly EntityIndexDimensionDefinition[],
    notify = true,
  ): void {
    const byName = new Map<string, NormalizedDimensionDefinition>();
    for (const rawDefinition of definitions ?? []) {
      const definition = normalizedDefinition(rawDefinition);
      byName.set(definition.normalizedName, definition);
    }
    const nextDefinitions = Object.freeze(
      [...byName.values()].sort((left, right) =>
        compareText(left.normalizedName, right.normalizedName)),
    );
    if (definitionsEqual(this.definitions, nextDefinitions)) return;
    this.definitions = nextDefinitions;
    this.invalidate(notify);
  }

  registerDimension(definition: EntityIndexDimensionDefinition): void {
    const nextDefinition = normalizedDefinition(definition);
    const nextDefinitions = this.definitions
      .filter((candidate) => candidate.normalizedName !== nextDefinition.normalizedName)
      .map((candidate) => ({
        name: candidate.name,
        propertyKeys: candidate.propertyKeys,
      }));
    nextDefinitions.push({
      name: nextDefinition.name,
      propertyKeys: nextDefinition.propertyKeys,
    });
    this.configureDimensions(nextDefinitions);
  }

  getDimensionDefinitions(): readonly EntityIndexDimensionDefinition[] {
    return Object.freeze(
      this.definitions.map((definition) =>
        Object.freeze({
          name: definition.name,
          propertyKeys: Object.freeze([...definition.propertyKeys]),
        })),
    );
  }

  getRevision(): number {
    return this.revision;
  }

  onChanged(listener: EntityIndexChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Coalesces a synchronous set of provider mutations into one revision and
   * one listener notification. Mutations remain immediately visible inside
   * the callback; only publication is deferred until the complete snapshot.
   */
  batchMutations<T>(mutate: () => T, notify = true): T {
    const outermost = this.mutationBatchDepth === 0;
    if (outermost) {
      this.mutationBatchChanged = false;
      this.mutationBatchNotify = notify;
    }
    this.mutationBatchDepth += 1;
    try {
      return mutate();
    } finally {
      this.mutationBatchDepth -= 1;
      if (outermost) {
        const changed = this.mutationBatchChanged;
        const shouldNotify = this.mutationBatchNotify;
        this.mutationBatchChanged = false;
        this.mutationBatchNotify = false;
        if (changed) this.publishRevision(shouldNotify);
      }
    }
  }

  invalidate(notify = true): void {
    this.recordsById.clear();
    this.noteIdsByPath.clear();
    this.idsByLocator.clear();
    this.idsBySourcePath.clear();
    this.sourceKeyById.clear();
    this.idsBySourceKey.clear();
    this.clearDerivedCaches();
    this.bumpRevision(notify);
  }

  rebuild(sources: readonly EntityIndexSource[], forceRevision = false): void {
    const nextById = new Map<string, EntityIndexRecord>();
    const nextSourceKeyById = new Map<string, string>();
    const nextNoteIdsByPath = new Map<string, string>();
    const nextIdsByLocator = new Map<string, string>();
    const prepared = (sources || [])
      .map((source) => ({ source, record: this.createRecord(source) }))
      .filter((entry): entry is { source: EntityIndexSource; record: EntityIndexRecord } =>
        Boolean(entry.record));
    const blockIdCounts = new Map<string, number>();
    const blockLocatorCounts = new Map<string, number>();
    for (const { record } of prepared) {
      if (record.entityType !== 'block') continue;
      const id = normalizeLookupValue(record.id);
      blockIdCounts.set(id, (blockIdCounts.get(id) || 0) + 1);
      blockLocatorCounts.set(
        record.locatorKey,
        (blockLocatorCounts.get(record.locatorKey) || 0) + 1,
      );
    }

    for (const { source, record } of prepared) {
      const normalizedId = normalizeLookupValue(record.id);
      if (
        record.entityType === 'block'
        && (
          (blockIdCounts.get(normalizedId) || 0) !== 1
          || (blockLocatorCounts.get(record.locatorKey) || 0) !== 1
        )
      ) {
        continue;
      }
      const conflicts = new Set<string>();
      if (nextById.has(normalizedId)) conflicts.add(normalizedId);
      const locatorConflict = nextIdsByLocator.get(record.locatorKey);
      if (locatorConflict) conflicts.add(locatorConflict);
      if (record.entityType === 'note') {
        const pathConflict = nextNoteIdsByPath.get(normalizePath(record.path));
        if (pathConflict) conflicts.add(pathConflict);
      }
      for (const conflict of conflicts) {
        const prior = nextById.get(conflict);
        if (!prior) continue;
        nextById.delete(conflict);
        nextSourceKeyById.delete(conflict);
        nextIdsByLocator.delete(prior.locatorKey);
        if (prior.entityType === 'note') {
          nextNoteIdsByPath.delete(normalizePath(prior.path));
        }
      }
      nextById.set(normalizedId, record);
      nextSourceKeyById.set(normalizedId, this.getSourceKey(source, record));
      nextIdsByLocator.set(record.locatorKey, normalizedId);
      if (record.entityType === 'note') {
        nextNoteIdsByPath.set(normalizePath(record.path), normalizedId);
      }
    }

    const changed = this.recordsById.size !== nextById.size
      || [...nextById.entries()].some(([id, record]) =>
        !recordsEqual(this.recordsById.get(id), record)
        || this.sourceKeyById.get(id) !== nextSourceKeyById.get(id));

    this.recordsById.clear();
    this.noteIdsByPath.clear();
    this.idsByLocator.clear();
    this.idsBySourcePath.clear();
    this.sourceKeyById.clear();
    this.idsBySourceKey.clear();
    for (const [id, record] of nextById) this.recordsById.set(id, record);
    for (const [id, sourceKey] of nextSourceKeyById) this.sourceKeyById.set(id, sourceKey);
    this.rebuildSecondaryIndexes();
    this.clearDerivedCaches();
    if (changed || forceRevision) this.bumpRevision(true);
  }

  upsert(source: EntityIndexSource): EntityIndexRecord | null {
    const record = this.createRecord(source);
    if (!record) {
      this.removeByPath(source?.path ?? '');
      return null;
    }

    const normalizedId = normalizeLookupValue(record.id);
    const oldRecord = this.recordsById.get(normalizedId);
    const sourceKey = this.getSourceKey(source, record);
    const conflicts = new Set<string>();
    if (oldRecord) conflicts.add(normalizedId);
    const locatorConflict = this.idsByLocator.get(record.locatorKey);
    if (locatorConflict) conflicts.add(locatorConflict);
    if (record.entityType === 'note') {
      const pathConflict = this.noteIdsByPath.get(normalizePath(record.path));
      if (pathConflict) conflicts.add(pathConflict);
    }

    const changed = !recordsEqual(oldRecord, record)
      || this.sourceKeyById.get(normalizedId) !== sourceKey
      || [...conflicts].some((id) => id !== normalizedId);
    if (!changed) return oldRecord ?? record;

    for (const conflict of conflicts) this.removeRecordInternal(conflict);
    this.addRecordInternal(normalizedId, record, sourceKey);
    this.clearDerivedCaches();
    this.bumpRevision(true);
    return record;
  }

  /**
   * Atomically replaces every record owned by one provider/source snapshot.
   *
   * Duplicate IDs, locators, or note paths in the incoming snapshot are all
   * omitted. A collision with another source is omitted as well. This
   * fail-closed behavior prevents an ambiguous line from silently replacing a
   * different entity, while valid siblings still update in one revision.
   */
  replaceSource(
    sourceKey: string,
    sources: readonly EntityIndexSource[],
    notify = true,
  ): readonly EntityIndexRecord[] {
    const normalizedSourceKey = normalizeLookupValue(sourceKey);
    if (!normalizedSourceKey) {
      throw new Error('Entity index source replacement requires a non-empty source key.');
    }

    const candidates = (sources || [])
      .map((source) => this.createRecord(source))
      .filter((record): record is EntityIndexRecord => Boolean(record));
    const idCounts = new Map<string, number>();
    const locatorCounts = new Map<string, number>();
    const notePathCounts = new Map<string, number>();
    for (const record of candidates) {
      const id = normalizeLookupValue(record.id);
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
      locatorCounts.set(record.locatorKey, (locatorCounts.get(record.locatorKey) || 0) + 1);
      if (record.entityType === 'note') {
        const path = normalizePath(record.path);
        notePathCounts.set(path, (notePathCounts.get(path) || 0) + 1);
      }
    }

    const priorIds = this.idsBySourceKey.get(normalizedSourceKey) ?? new Set<string>();
    const accepted: EntityIndexRecord[] = [];
    for (const record of candidates) {
      const id = normalizeLookupValue(record.id);
      const notePath = normalizePath(record.path);
      if (
        (idCounts.get(id) || 0) !== 1
        || (locatorCounts.get(record.locatorKey) || 0) !== 1
        || (
          record.entityType === 'note'
          && (notePathCounts.get(notePath) || 0) !== 1
        )
      ) {
        continue;
      }

      const externalId = this.recordsById.has(id) && !priorIds.has(id);
      const locatorOwner = this.idsByLocator.get(record.locatorKey);
      const externalLocator = Boolean(locatorOwner && !priorIds.has(locatorOwner));
      const noteOwner = record.entityType === 'note'
        ? this.noteIdsByPath.get(notePath)
        : undefined;
      const externalNotePath = Boolean(noteOwner && !priorIds.has(noteOwner));
      if (externalId || externalLocator || externalNotePath) continue;
      accepted.push(record);
    }

    const nextById = new Map(
      accepted.map((record) => [normalizeLookupValue(record.id), record]),
    );
    const changed = priorIds.size !== nextById.size
      || [...nextById.entries()].some(([id, record]) =>
        !recordsEqual(this.recordsById.get(id), record)
        || this.sourceKeyById.get(id) !== normalizedSourceKey);
    if (!changed) {
      return Object.freeze(
        [...nextById.values()].sort((left, right) => compareText(left.id, right.id)),
      );
    }

    for (const id of [...priorIds]) this.removeRecordInternal(id);
    for (const [id, record] of nextById) {
      this.addRecordInternal(id, record, normalizedSourceKey);
    }
    this.clearDerivedCaches();
    this.bumpRevision(notify);
    return Object.freeze(
      [...nextById.values()].sort((left, right) => compareText(left.id, right.id)),
    );
  }

  removeSource(sourceKey: string, notify = true): boolean {
    const normalizedSourceKey = normalizeLookupValue(sourceKey);
    const ids = this.idsBySourceKey.get(normalizedSourceKey);
    if (!ids || ids.size === 0) return false;
    for (const id of [...ids]) this.removeRecordInternal(id);
    this.clearDerivedCaches();
    this.bumpRevision(notify);
    return true;
  }

  removeById(id: string): boolean {
    const normalizedId = normalizeLookupValue(id);
    if (!this.removeRecordInternal(normalizedId)) return false;
    this.clearDerivedCaches();
    this.bumpRevision(true);
    return true;
  }

  removeByPath(path: string): boolean {
    const normalizedRecordPath = normalizePath(path);
    const id = this.noteIdsByPath.get(normalizedRecordPath);
    if (!id || !this.removeRecordInternal(id)) return false;
    this.clearDerivedCaches();
    this.bumpRevision(true);
    return true;
  }

  getById(id: string): EntityIndexRecord | null {
    return this.recordsById.get(normalizeLookupValue(id)) ?? null;
  }

  /**
   * Backward-compatible note lookup. Line entities in the same file never
   * replace the note returned from this method.
   */
  getByPath(path: string): EntityIndexRecord | null {
    const id = this.noteIdsByPath.get(normalizePath(path));
    return id ? this.recordsById.get(id) ?? null : null;
  }

  getByLocator(locator: EntityIndexLocator | string): EntityIndexRecord | null {
    const key = typeof locator === 'string'
      ? normalizeLookupValue(locator)
      : locatorKeyFor(locator);
    const id = this.idsByLocator.get(key);
    if (id) return this.recordsById.get(id) ?? null;
    if (typeof locator !== 'string') {
      const path = normalizePath(locator.path);
      if (path && !/\.md$/iu.test(path)) {
        const markdownKey = locatorKeyFor({ ...locator, path: `${locator.path}.md` });
        const markdownId = this.idsByLocator.get(markdownKey);
        if (markdownId) return this.recordsById.get(markdownId) ?? null;
      }
    }
    return null;
  }

  getByReferenceTarget(target: string): EntityIndexRecord | null {
    const raw = String(target || '').trim();
    const inner = raw.match(/^!?\[\[([^\]]+)\]\]$/u)?.[1] || raw;
    const rawTarget = inner.split('|', 1)[0]?.trim().replace(/\\/gu, '/') || '';
    if (!rawTarget) return null;
    const hashIndex = rawTarget.indexOf('#');
    const path = hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget;
    const subpath = hashIndex >= 0 ? rawTarget.slice(hashIndex) : '';
    return this.getByLocator({
      path,
      entityType: subpath ? 'block' : 'note',
      subpath,
    });
  }

  getBySourcePath(path: string): readonly EntityIndexRecord[] {
    const ids = this.idsBySourcePath.get(normalizePath(path));
    if (!ids || ids.size === 0) return EMPTY_RECORDS;
    return Object.freeze(
      [...ids]
        .map((id) => this.recordsById.get(id))
        .filter((record): record is EntityIndexRecord => Boolean(record))
        .sort((left, right) =>
          compareText(left.name, right.name)
          || compareText(left.locatorKey, right.locatorKey)),
    );
  }

  getDimensionValues(dimensionName: string): readonly string[] {
    const canonicalName = this.getCanonicalDimensionName(dimensionName);
    const cacheKey = normalizeLookupValue(canonicalName);
    const cached = this.dimensionValueCache.get(cacheKey);
    if (cached) return cached;
    const values = new Map<string, string>();
    for (const record of this.recordsById.values()) {
      for (const value of getRecordDimensionValues(record, canonicalName)) {
        const normalizedValue = normalizeLookupValue(value);
        if (!values.has(normalizedValue)) values.set(normalizedValue, value);
      }
    }
    const result = Object.freeze([...values.values()].sort(compareText));
    this.dimensionValueCache.set(cacheKey, result);
    return result;
  }

  query(query: EntityIndexQuery = {}): readonly EntityIndexRecord[] {
    const normalizedQuery = this.normalizeQuery(query);
    const cacheKey = JSON.stringify(normalizedQuery);
    const cached = this.queryCache.get(cacheKey);
    if (cached) return cached;

    let records = [...this.recordsById.values()].filter((record) => {
      if (
        normalizedQuery.entityTypes.length > 0
        && !normalizedQuery.entityTypes.includes(record.entityType)
      ) {
        return false;
      }
      if (
        normalizedQuery.lineKinds.length > 0
        && (!record.lineKind || !normalizedQuery.lineKinds.includes(record.lineKind))
      ) {
        return false;
      }
      if (
        normalizedQuery.allOf.length > 0
        && !normalizedQuery.allOf.every((clause) => recordMatchesClause(record, clause))
      ) {
        return false;
      }
      if (
        normalizedQuery.anyOf.length > 0
        && !normalizedQuery.anyOf.some((clause) => recordMatchesClause(record, clause))
      ) {
        return false;
      }
      if (normalizedQuery.noneOf.some((clause) => recordMatchesClause(record, clause))) {
        return false;
      }
      if (normalizedQuery.search) {
        const haystack = normalizeLookupValue(
          `${record.name}\n${record.basename}\n${record.path}\n${record.subpath}\n${record.lineKind || ''}`,
        );
        if (!haystack.includes(normalizedQuery.search)) return false;
      }
      return true;
    });

    records.sort((left, right) =>
      compareText(left.name, right.name)
      || compareText(left.path, right.path)
      || compareText(left.id, right.id));
    if (normalizedQuery.limit !== null) {
      records = records.slice(0, normalizedQuery.limit);
    }

    const result = records.length > 0
      ? Object.freeze(records)
      : EMPTY_RECORDS;
    if (!this.queryCache.has(cacheKey) && this.queryCache.size >= MAX_QUERY_CACHE_ENTRIES) {
      const oldestKey = this.queryCache.keys().next().value as string | undefined;
      if (oldestKey !== undefined) this.queryCache.delete(oldestKey);
    }
    this.queryCache.set(cacheKey, result);
    return result;
  }

  private createRecord(source: EntityIndexSource): EntityIndexRecord | null {
    const path = String(source?.path ?? '').replace(/\\/g, '/').trim();
    if (!path) return null;

    const id = String(source.id ?? path).trim();
    if (!id) return null;
    const fallbackName = path.split('/').pop() ?? path;
    const basename = String(
      source.basename
      ?? fallbackName.replace(/\.[^.]+$/, ''),
    ).trim();
    const name = String(source.name ?? basename).trim() || basename || path;
    const sourcePath = String(source.sourcePath ?? path).replace(/\\/g, '/').trim() || path;
    const entityType: EntityIndexEntityType = source.entityType === 'block' ? 'block' : 'note';
    const blockId = String(source.blockId || '')
      .trim()
      .replace(/^\^/u, '');
    const subpath = blockId
      ? `#^${blockId}`
      : normalizeSubpath(source.subpath || '');
    const lineNumber = Number.isFinite(Number(source.lineNumber))
      ? Math.max(1, Math.floor(Number(source.lineNumber)))
      : undefined;
    const lineKind = ['task', 'bullet', 'heading'].includes(String(source.lineKind || ''))
      ? source.lineKind
      : undefined;
    const referenceState: EntityIndexReferenceState = source.referenceState === 'provisional'
      && entityType === 'block'
      && !subpath
      ? 'provisional'
      : 'ready';
    const locatorKey = locatorKeyFor({
      path,
      entityType,
      subpath,
      blockId,
      lineNumber,
      lineKind,
      locatorKey: source.locatorKey,
    });
    if (!locatorKey) return null;
    const frontmatter = source.frontmatter ?? {};
    const frontmatterByKey = new Map<string, unknown>();
    for (const [key, value] of Object.entries(frontmatter)) {
      frontmatterByKey.set(normalizeLookupValue(key), value);
    }
    const providedDimensionsByName = new Map<string, unknown>();
    for (const [name, value] of Object.entries(source.dimensions ?? {})) {
      providedDimensionsByName.set(normalizeLookupValue(name), value);
    }

    const dimensions = Object.create(null) as Record<string, readonly string[]>;
    for (const definition of this.definitions) {
      const values: string[] = [];
      for (const propertyKey of definition.normalizedPropertyKeys) {
        flattenDimensionValue(frontmatterByKey.get(propertyKey), values);
      }
      flattenDimensionValue(
        providedDimensionsByName.get(definition.normalizedName),
        values,
      );
      const uniqueValues = uniqueDisplayValues(values);
      if (uniqueValues.length > 0) dimensions[definition.name] = uniqueValues;
    }
    const lineProperties = entityType === 'block'
      ? normalizeLineProperties(source.lineProperties)
      : undefined;

    return Object.freeze({
      id,
      path,
      name,
      displayName: name,
      basename,
      dimensions: Object.freeze(dimensions),
      ...(lineProperties ? { lineProperties } : {}),
      sourcePath,
      entityType,
      subpath,
      blockId,
      ...(lineKind ? { lineKind } : {}),
      ...(lineNumber ? { lineNumber } : {}),
      referenceState,
      locatorKey,
      referenceTarget: referenceState === 'ready' ? `${path}${subpath}` : '',
    });
  }

  private getSourceKey(source: EntityIndexSource, record: EntityIndexRecord): string {
    const explicit = normalizeLookupValue(source.sourceKey);
    if (explicit) return explicit;
    return record.entityType === 'note'
      ? `note:${normalizePath(record.path)}`
      : `entity:${record.locatorKey}`;
  }

  private addRecordInternal(
    normalizedId: string,
    record: EntityIndexRecord,
    sourceKey: string,
  ): void {
    this.recordsById.set(normalizedId, record);
    this.sourceKeyById.set(normalizedId, sourceKey);
    this.idsByLocator.set(record.locatorKey, normalizedId);
    if (record.entityType === 'note') {
      this.noteIdsByPath.set(normalizePath(record.path), normalizedId);
    }
    this.addToSetMap(this.idsBySourcePath, normalizePath(record.sourcePath), normalizedId);
    this.addToSetMap(this.idsBySourceKey, sourceKey, normalizedId);
  }

  private removeRecordInternal(normalizedId: string): boolean {
    const record = this.recordsById.get(normalizedId);
    if (!record) return false;
    this.recordsById.delete(normalizedId);
    if (this.idsByLocator.get(record.locatorKey) === normalizedId) {
      this.idsByLocator.delete(record.locatorKey);
    }
    if (
      record.entityType === 'note'
      && this.noteIdsByPath.get(normalizePath(record.path)) === normalizedId
    ) {
      this.noteIdsByPath.delete(normalizePath(record.path));
    }
    this.removeFromSetMap(this.idsBySourcePath, normalizePath(record.sourcePath), normalizedId);
    const sourceKey = this.sourceKeyById.get(normalizedId);
    this.sourceKeyById.delete(normalizedId);
    if (sourceKey) this.removeFromSetMap(this.idsBySourceKey, sourceKey, normalizedId);
    return true;
  }

  private rebuildSecondaryIndexes(): void {
    for (const [id, record] of this.recordsById) {
      this.idsByLocator.set(record.locatorKey, id);
      if (record.entityType === 'note') {
        this.noteIdsByPath.set(normalizePath(record.path), id);
      }
      this.addToSetMap(this.idsBySourcePath, normalizePath(record.sourcePath), id);
      const sourceKey = this.sourceKeyById.get(id)
        || (record.entityType === 'note'
          ? `note:${normalizePath(record.path)}`
          : `entity:${record.locatorKey}`);
      this.sourceKeyById.set(id, sourceKey);
      this.addToSetMap(this.idsBySourceKey, sourceKey, id);
    }
  }

  private addToSetMap(
    map: Map<string, Set<string>>,
    key: string,
    value: string,
  ): void {
    const values = map.get(key) ?? new Set<string>();
    values.add(value);
    map.set(key, values);
  }

  private removeFromSetMap(
    map: Map<string, Set<string>>,
    key: string,
    value: string,
  ): void {
    const values = map.get(key);
    if (!values) return;
    values.delete(value);
    if (values.size === 0) map.delete(key);
  }

  private getCanonicalDimensionName(dimensionName: string): string {
    const normalizedName = normalizeLookupValue(dimensionName);
    return this.definitions.find(
      (definition) => definition.normalizedName === normalizedName,
    )?.name ?? normalizedName;
  }

  private normalizeQuery(query: EntityIndexQuery): NormalizedQuery {
    const dimensionNames = new Map(
      this.definitions.map((definition) => [
        definition.normalizedName,
        definition.name,
      ]),
    );
    const numericLimit = Number(query.limit);
    const limit = Number.isFinite(numericLimit) && numericLimit >= 0
      ? Math.floor(numericLimit)
      : null;
    const allOf = [
      ...normalizeFilter(query.dimensions, dimensionNames),
      ...normalizeFilter(query.allOf, dimensionNames),
    ].sort((left, right) => compareText(left.dimensionName, right.dimensionName));
    const entityTypes = [...new Set(
      (Array.isArray(query.entityTypes) ? query.entityTypes : [query.entityTypes])
        .filter((value): value is EntityIndexEntityType => value === 'note' || value === 'block'),
    )].sort(compareText);
    const lineKinds = [...new Set(
      (Array.isArray(query.lineKinds) ? query.lineKinds : [query.lineKinds])
        .filter((value): value is EntityIndexLineKind => (
          value === 'task' || value === 'bullet' || value === 'heading'
        )),
    )].sort(compareText);
    return Object.freeze({
      allOf: Object.freeze(allOf),
      anyOf: normalizeFilter(query.anyOf, dimensionNames),
      noneOf: normalizeFilter(query.noneOf, dimensionNames),
      search: normalizeLookupValue(query.search),
      entityTypes: Object.freeze(entityTypes),
      lineKinds: Object.freeze(lineKinds),
      limit,
    });
  }

  private clearDerivedCaches(): void {
    this.queryCache.clear();
    this.dimensionValueCache.clear();
  }

  private bumpRevision(notify: boolean): void {
    if (this.mutationBatchDepth > 0) {
      this.mutationBatchChanged = true;
      return;
    }
    this.publishRevision(notify);
  }

  private publishRevision(notify: boolean): void {
    this.revision += 1;
    if (!notify) return;
    for (const listener of this.listeners) {
      try {
        listener(this.revision);
      } catch (error) {
        console.error('[TPS GCM entity index] change listener failed', error);
      }
    }
  }
}
