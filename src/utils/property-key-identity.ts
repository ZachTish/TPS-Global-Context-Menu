export interface PropertyKeyDefinitionLike {
  key?: unknown;
}

export type PropertyKeyDiagnosticCode = 'blank' | 'duplicate';

export interface PropertyKeyDiagnostic {
  code: PropertyKeyDiagnosticCode;
  index: number;
  key: string;
  duplicateIndexes: number[];
}

/**
 * Property keys are authored identifiers, not slugs. Matching trims accidental
 * edge whitespace and ignores case, but deliberately preserves punctuation and
 * interior whitespace so `client-id`, `client_id`, and `client id` stay distinct.
 */
export function normalizePropertyKeyIdentity(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase();
}

export function propertyKeysEqual(left: unknown, right: unknown): boolean {
  const leftIdentity = normalizePropertyKeyIdentity(left);
  return !!leftIdentity && leftIdentity === normalizePropertyKeyIdentity(right);
}

/** Resolve an authored record key without rewriting its original casing. */
export function findPropertyKeyCaseInsensitive(
  record: Record<string, unknown> | null | undefined,
  target: unknown,
): string | null {
  const identity = normalizePropertyKeyIdentity(target);
  if (!identity) return null;
  return Object.keys(record ?? {}).find((key) => normalizePropertyKeyIdentity(key) === identity) ?? null;
}

/** Collect values from repeated inline carriers using exact key identity. */
export function collectPropertyValuesByKey(
  entries: readonly { key?: unknown; value?: unknown }[] | null | undefined,
  target: unknown,
): string[] {
  const identity = normalizePropertyKeyIdentity(target);
  if (!identity) return [];
  return (entries ?? [])
    .filter((entry) => normalizePropertyKeyIdentity(entry?.key) === identity)
    .map((entry) => String(entry?.value ?? '').trim());
}

export function collectPropertyKeyDiagnostics(
  properties: readonly PropertyKeyDefinitionLike[] | null | undefined,
): PropertyKeyDiagnostic[] {
  const source = properties ?? [];
  const indexesByIdentity = new Map<string, number[]>();
  source.forEach((property, index) => {
    const identity = normalizePropertyKeyIdentity(property?.key);
    if (!identity) return;
    const indexes = indexesByIdentity.get(identity) ?? [];
    indexes.push(index);
    indexesByIdentity.set(identity, indexes);
  });

  return source.flatMap((property, index): PropertyKeyDiagnostic[] => {
    const key = String(property?.key ?? '').trim();
    const identity = normalizePropertyKeyIdentity(key);
    if (!identity) return [{ code: 'blank', index, key, duplicateIndexes: [] }];
    const duplicates = (indexesByIdentity.get(identity) ?? []).filter((candidate) => candidate !== index);
    return duplicates.length > 0
      ? [{ code: 'duplicate', index, key, duplicateIndexes: duplicates }]
      : [];
  });
}

export function getPropertyKeyDiagnostic(
  properties: readonly PropertyKeyDefinitionLike[] | null | undefined,
  index: number,
  candidate: unknown = properties?.[index]?.key,
): PropertyKeyDiagnostic | null {
  const key = String(candidate ?? '').trim();
  const identity = normalizePropertyKeyIdentity(key);
  if (!identity) return { code: 'blank', index, key, duplicateIndexes: [] };
  const duplicateIndexes = (properties ?? [])
    .map((property, candidateIndex) => ({ property, candidateIndex }))
    .filter(({ property, candidateIndex }) => (
      candidateIndex !== index
      && normalizePropertyKeyIdentity(property?.key) === identity
    ))
    .map(({ candidateIndex }) => candidateIndex);
  return duplicateIndexes.length > 0
    ? { code: 'duplicate', index, key, duplicateIndexes }
    : null;
}

/** Generate a stable, case-insensitively unique default without changing saved keys. */
export function createUniquePropertyKey(
  preferred: unknown,
  properties: readonly PropertyKeyDefinitionLike[] | null | undefined,
): string {
  const base = String(preferred ?? '').trim() || 'new_prop';
  const used = new Set(
    (properties ?? [])
      .map((property) => normalizePropertyKeyIdentity(property?.key))
      .filter(Boolean),
  );
  if (!used.has(normalizePropertyKeyIdentity(base))) return base;
  for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!used.has(normalizePropertyKeyIdentity(candidate))) return candidate;
  }
  return `${base}_${Date.now()}`;
}
