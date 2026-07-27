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

export interface EntityIndexSource {
  /**
   * Stable entity identifier. Note-backed callers normally use the note path.
   */
  id?: string;
  path: string;
  name?: string;
  basename?: string;
  frontmatter?: Readonly<Record<string, unknown>> | null;
}

export interface EntityIndexRecord {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly displayName: string;
  readonly basename: string;
  readonly dimensions: Readonly<Record<string, readonly string[]>>;
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
  ) {
    return false;
  }

  const leftEntries = Object.entries(left.dimensions);
  const rightEntries = Object.entries(right.dimensions);
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([name, values], index) => {
    const [rightName, rightValues] = rightEntries[index] ?? [];
    return name === rightName
      && values.length === rightValues.length
      && values.every((value, valueIndex) => value === rightValues[valueIndex]);
  });
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
  private readonly idsByPath = new Map<string, string>();
  private readonly queryCache = new Map<string, readonly EntityIndexRecord[]>();
  private readonly dimensionValueCache = new Map<string, readonly string[]>();
  private readonly listeners = new Set<EntityIndexChangeListener>();
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

  invalidate(notify = true): void {
    this.recordsById.clear();
    this.idsByPath.clear();
    this.clearDerivedCaches();
    this.bumpRevision(notify);
  }

  rebuild(sources: readonly EntityIndexSource[], forceRevision = false): void {
    const nextById = new Map<string, EntityIndexRecord>();
    const nextIdsByPath = new Map<string, string>();

    for (const source of sources ?? []) {
      const record = this.createRecord(source);
      if (!record) continue;
      const normalizedId = normalizeLookupValue(record.id);
      const normalizedRecordPath = normalizePath(record.path);

      const priorRecordForId = nextById.get(normalizedId);
      if (
        priorRecordForId
        && normalizePath(priorRecordForId.path) !== normalizedRecordPath
      ) {
        nextIdsByPath.delete(normalizePath(priorRecordForId.path));
      }
      const priorIdForPath = nextIdsByPath.get(normalizedRecordPath);
      if (priorIdForPath && priorIdForPath !== normalizedId) {
        nextById.delete(priorIdForPath);
      }
      nextById.set(normalizedId, record);
      nextIdsByPath.set(normalizedRecordPath, normalizedId);
    }

    const changed = this.recordsById.size !== nextById.size
      || [...nextById.entries()].some(([id, record]) =>
        !recordsEqual(this.recordsById.get(id), record));

    this.recordsById.clear();
    this.idsByPath.clear();
    for (const [id, record] of nextById) this.recordsById.set(id, record);
    for (const [path, id] of nextIdsByPath) this.idsByPath.set(path, id);
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
    const normalizedRecordPath = normalizePath(record.path);
    const oldIdAtPath = this.idsByPath.get(normalizedRecordPath);
    const oldRecord = this.recordsById.get(normalizedId);

    if (oldIdAtPath && oldIdAtPath !== normalizedId) {
      this.recordsById.delete(oldIdAtPath);
    }
    if (oldRecord && normalizePath(oldRecord.path) !== normalizedRecordPath) {
      this.idsByPath.delete(normalizePath(oldRecord.path));
    }

    this.recordsById.set(normalizedId, record);
    this.idsByPath.set(normalizedRecordPath, normalizedId);
    const changed = oldIdAtPath !== normalizedId || !recordsEqual(oldRecord, record);
    if (changed) {
      this.clearDerivedCaches();
      this.bumpRevision(true);
    }
    return record;
  }

  removeById(id: string): boolean {
    const normalizedId = normalizeLookupValue(id);
    const record = this.recordsById.get(normalizedId);
    if (!record) return false;
    this.recordsById.delete(normalizedId);
    this.idsByPath.delete(normalizePath(record.path));
    this.clearDerivedCaches();
    this.bumpRevision(true);
    return true;
  }

  removeByPath(path: string): boolean {
    const normalizedRecordPath = normalizePath(path);
    const id = this.idsByPath.get(normalizedRecordPath);
    if (!id) return false;
    this.idsByPath.delete(normalizedRecordPath);
    this.recordsById.delete(id);
    this.clearDerivedCaches();
    this.bumpRevision(true);
    return true;
  }

  getById(id: string): EntityIndexRecord | null {
    return this.recordsById.get(normalizeLookupValue(id)) ?? null;
  }

  getByPath(path: string): EntityIndexRecord | null {
    const id = this.idsByPath.get(normalizePath(path));
    return id ? this.recordsById.get(id) ?? null : null;
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
          `${record.name}\n${record.basename}\n${record.path}`,
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
    const frontmatter = source.frontmatter ?? {};
    const frontmatterByKey = new Map<string, unknown>();
    for (const [key, value] of Object.entries(frontmatter)) {
      frontmatterByKey.set(normalizeLookupValue(key), value);
    }

    const dimensions = Object.create(null) as Record<string, readonly string[]>;
    for (const definition of this.definitions) {
      const values: string[] = [];
      for (const propertyKey of definition.normalizedPropertyKeys) {
        flattenDimensionValue(frontmatterByKey.get(propertyKey), values);
      }
      const uniqueValues = uniqueDisplayValues(values);
      if (uniqueValues.length > 0) dimensions[definition.name] = uniqueValues;
    }

    return Object.freeze({
      id,
      path,
      name,
      displayName: name,
      basename,
      dimensions: Object.freeze(dimensions),
    });
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
    return Object.freeze({
      allOf: Object.freeze(allOf),
      anyOf: normalizeFilter(query.anyOf, dimensionNames),
      noneOf: normalizeFilter(query.noneOf, dimensionNames),
      search: normalizeLookupValue(query.search),
      limit,
    });
  }

  private clearDerivedCaches(): void {
    this.queryCache.clear();
    this.dimensionValueCache.clear();
  }

  private bumpRevision(notify: boolean): void {
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
