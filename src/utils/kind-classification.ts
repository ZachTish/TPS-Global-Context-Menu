/** Internal record types map to user-chosen frontmatter, with explicit read aliases. */
export interface PropertyKindClassification { key: string; value: string; parentKind: string }
export interface TagKindClassification { tag: string }
export interface ListKindClassification { kindList: { key: string; value: string } }
export interface ScalarKindClassification { scalar: { key: string; value: string } }
export type KindClassification = PropertyKindClassification | TagKindClassification | ListKindClassification | ScalarKindClassification;
export interface KindDiscriminator { key: string; value: string }
export interface KindMappingWithAliases { primary: KindClassification; aliases: KindClassification[]; discriminator?: KindDiscriminator; writeDisabled?: boolean }
export type KindMappings = Record<string, string | KindClassification | KindMappingWithAliases>;
const keyPattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/u;
const pathPattern = /^[\p{L}\p{M}\p{N}_-]+(?:\/[\p{L}\p{M}\p{N}_-]+)+$/u;
const reservedRecordKeys = new Set(['tags', 'tpsid', 'tpsschemaversion', 'title', 'createddate', 'modifieddate']);

export function normalizeClassificationTag(value: string): string {
  const tag = value.trim().replace(/^#/, '');
  if (!tag || tag.split('/').some(part => !part || !/^[\p{L}\p{M}\p{N}_-]+$/u.test(part)) || !/[\p{L}\p{M}_-]/u.test(tag)) {
    throw new Error('Choose a valid tag without spaces or empty subtags.');
  }
  return tag;
}

export function classificationTags(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === 'string') return value.split(/[\s,]+/u).filter(Boolean).map(tag => tag.replace(/^#/, ''));
  if (Array.isArray(value) && value.every(tag => typeof tag === 'string')) return value.map(tag => tag.replace(/^#/, ''));
  throw new Error('Tags must be a string or a list of strings.');
}

export function readClassificationProperty(fields: Record<string, unknown>, key: string): unknown {
  const found = Object.keys(fields).filter(candidate => candidate.toLowerCase() === key.toLowerCase());
  if (found.length > 1) throw new Error(`Ambiguous frontmatter property “${key}”.`);
  return found.length ? fields[found[0]] : undefined;
}

export function hasClassificationTag(fields: Record<string, unknown>, tag: string): boolean {
  try { return classificationTags(readClassificationProperty(fields, 'tags')).some(value => value.toLowerCase() === tag.toLowerCase()); }
  catch { return false; }
}

export function normalizeKindClassification(raw: KindClassification, kind = 'record'): KindClassification {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Invalid classification for ${kind}.`);
  if ('tag' in raw) return { tag: normalizeClassificationTag(raw.tag) };
  if ('kindList' in raw) {
    const { key, value } = raw.kindList || {};
    if (!keyPattern.test(key) || reservedRecordKeys.has(key.toLowerCase()) || !pathPattern.test(value)) {
      throw new Error(`Invalid kind list classification for ${kind}.`);
    }
    return { kindList: { key, value } };
  }
  if ('scalar' in raw) {
    const { key, value } = raw.scalar || {};
    if (!keyPattern.test(key) || reservedRecordKeys.has(key.toLowerCase()) || typeof value !== 'string' || !value.trim()) {
      throw new Error(`Invalid scalar classification for ${kind}.`);
    }
    return { scalar: { key, value: value.trim() } };
  }
  if (!keyPattern.test(raw.key) || ['kind', 'tpsid', 'title', 'tags'].includes(raw.key.toLowerCase())
    || !keyPattern.test(raw.parentKind) || !/^[a-zA-Z][a-zA-Z0-9-]*$/u.test(raw.value)) {
    throw new Error(`Invalid classification for ${kind}.`);
  }
  return { key: raw.key, value: raw.value, parentKind: raw.parentKind };
}

export function kindClassification(mappings: KindMappings | undefined, kind: string): KindClassification | null {
  const value = mappings?.[kind];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return normalizeKindClassification('primary' in value ? value.primary : value, kind);
}

export function kindReadClassifications(mappings: KindMappings | undefined, kind: string): KindClassification[] {
  const primary = kindClassification(mappings, kind);
  if (!primary) return [];
  const value = mappings?.[kind];
  const aliases = value && typeof value === 'object' && 'primary' in value && Array.isArray(value.aliases)
    ? value.aliases.map(alias => normalizeKindClassification(alias, kind)) : [];
  const seen = new Set<string>();
  return [primary, ...aliases].filter(definition => {
    const fingerprint = JSON.stringify(definition).toLowerCase();
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

export function kindWriterEnabled(mappings: KindMappings | undefined, kind: string): boolean {
  const value = mappings?.[kind];
  return !(value && typeof value === 'object' && 'primary' in value && value.writeDisabled === true);
}

/** An additional authored field distinguishes internal record types sharing one visible list path. */
export function kindDiscriminator(mappings: KindMappings | undefined, kind: string): KindDiscriminator | null {
  const entry = mappings?.[kind];
  if (!entry || typeof entry !== 'object' || !('primary' in entry) || !entry.discriminator) return null;
  const primary = kindClassification(mappings, kind);
  const { key, value } = entry.discriminator;
  if (!primary || !('kindList' in primary) || !keyPattern.test(key)
    || reservedRecordKeys.has(key.toLowerCase()) || key.toLowerCase() === 'kind'
    || key.toLowerCase() === primary.kindList.key.toLowerCase()
    || typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid shared kind discriminator for ${kind}.`);
  }
  return { key, value: value.trim() };
}

export function matchesKindClassification(definition: KindClassification, fields: Record<string, unknown>): boolean {
  if ('tag' in definition) return hasClassificationTag(fields, definition.tag);
  if ('kindList' in definition) {
    const value = readClassificationProperty(fields, definition.kindList.key);
    return Array.isArray(value) && value.some(item => typeof item === 'string' && item.toLowerCase() === definition.kindList.value.toLowerCase());
  }
  if ('scalar' in definition) return readClassificationProperty(fields, definition.scalar.key) === definition.scalar.value;
  return readClassificationProperty(fields, 'kind') === definition.parentKind
    && readClassificationProperty(fields, definition.key) === definition.value;
}

export function matchesKind(mappings: KindMappings | undefined, fields: Record<string, unknown>, kind: string): boolean {
  const definitions = kindReadClassifications(mappings, kind);
  const discriminator = kindDiscriminator(mappings, kind);
  if (!discriminator) return definitions.some(definition => matchesKindClassification(definition, fields));
  const value = readClassificationProperty(fields, discriminator.key);
  if (value !== undefined && value !== discriminator.value) return false;
  const primary = kindClassification(mappings, kind);
  if (primary && matchesKindClassification(primary, fields)) return value === discriminator.value;
  return definitions.slice(1).some(definition => matchesKindClassification(definition, fields));
}

/** The second argument preserves unrelated values of a multi-value kind list during updates. */
export function encodeKind(mappings: KindMappings | undefined, fields: Record<string, any>, existingRaw?: Record<string, unknown>): Record<string, any> {
  const kind = String(fields.kind || '');
  const definition = kindClassification(mappings, kind);
  if (!definition) return { ...fields };
  if (!kindWriterEnabled(mappings, kind)) throw new Error(`New ${kind} records are disabled until a writer is configured.`);
  const next = { ...fields };
  delete next.kind;
  if ('tag' in definition) {
    const tags = classificationTags(readClassificationProperty(next, 'tags'));
    if (!tags.some(tag => tag.toLowerCase() === definition.tag.toLowerCase())) tags.push(definition.tag);
    next.tags = tags;
  } else if ('kindList' in definition) {
    const current = readClassificationProperty(next, definition.kindList.key);
    const original = existingRaw ? readClassificationProperty(existingRaw, definition.kindList.key) : undefined;
    const isLegacyScalar = (value: unknown) => kindReadClassifications(mappings, kind).some(alias => 'scalar' in alias
      && alias.scalar.key.toLowerCase() === definition.kindList.key.toLowerCase()
      && value === alias.scalar.value);
    for (const value of [current, original]) {
      if (value !== undefined && (!Array.isArray(value) || !value.every(item => typeof item === 'string'))
        && !isLegacyScalar(value)) {
        throw new Error(`Record classification property “${definition.kindList.key}” must be a list of text values.`);
      }
    }
    const values: string[] = [...(Array.isArray(original) ? original : []), ...(Array.isArray(current) ? current : [])];
    const legacyPaths = kindReadClassifications(mappings, kind)
      .filter((alias): alias is ListKindClassification => 'kindList' in alias && alias.kindList.key.toLowerCase() === definition.kindList.key.toLowerCase())
      .map(alias => alias.kindList.value.toLowerCase());
    const kept = [...new Set(values.filter(value => !legacyPaths.includes(value.toLowerCase()) || value.toLowerCase() === definition.kindList.value.toLowerCase()))];
    if (!kept.some(value => value.toLowerCase() === definition.kindList.value.toLowerCase())) kept.push(definition.kindList.value);
    next[definition.kindList.key] = kept;
    // Retire only configured tag aliases for classifications that share this
    // visible list value. Otherwise an old tag can contradict the caller's
    // independent record type (for example two Finance transaction types).
    const retiredTags = new Set(Object.keys(mappings || {}).flatMap(candidate => {
      const candidatePrimary = kindClassification(mappings, candidate);
      if (!candidatePrimary || !('kindList' in candidatePrimary)
        || candidatePrimary.kindList.key.toLowerCase() !== definition.kindList.key.toLowerCase()
        || candidatePrimary.kindList.value.toLowerCase() !== definition.kindList.value.toLowerCase()) return [];
      return kindReadClassifications(mappings, candidate)
        .filter((alias): alias is TagKindClassification => 'tag' in alias)
        .map(alias => alias.tag.toLowerCase());
    }));
    if (retiredTags.size) {
      const tagKey = Object.keys(next).find(key => key.toLowerCase() === 'tags');
      if (tagKey) {
        const tags = classificationTags(readClassificationProperty(next, 'tags'));
        const retained = tags.filter(tag => !retiredTags.has(tag.toLowerCase()));
        if (retained.length !== tags.length) {
          if (retained.length) next[tagKey] = retained;
          else delete next[tagKey];
        }
      }
    }
  } else if ('scalar' in definition) {
    const current = readClassificationProperty(next, definition.scalar.key);
    if (current !== undefined && current !== definition.scalar.value) throw new Error(`Record classification property “${definition.scalar.key}” conflicts with an existing field.`);
    next[definition.scalar.key] = definition.scalar.value;
  } else {
    const occupied = Object.keys(next).find(key => key.toLowerCase() === definition.key.toLowerCase());
    if (occupied && (occupied !== definition.key || (next[occupied] !== undefined && next[occupied] !== definition.value))) {
      throw new Error(`Record classification property “${definition.key}” conflicts with an existing field.`);
    }
    next.kind = definition.parentKind;
    next[definition.key] = definition.value;
  }
  const discriminator = kindDiscriminator(mappings, kind);
  if (discriminator) {
    const current = readClassificationProperty(next, discriminator.key);
    const original = existingRaw ? readClassificationProperty(existingRaw, discriminator.key) : undefined;
    if ([current, original].some(value => value !== undefined && value !== discriminator.value)) {
      throw new Error(`Record discriminator property “${discriminator.key}” conflicts with an existing field.`);
    }
    const authoredKey = Object.keys(next).find(key => key.toLowerCase() === discriminator.key.toLowerCase());
    next[authoredKey || discriminator.key] = discriminator.value;
  }
  if (decodeKind(mappings, next, kind).kind !== kind) throw new Error('Record classification is ambiguous.');
  return next;
}

export function decodeKind(mappings: KindMappings | undefined, fields: Record<string, any>, expectedKind?: string): Record<string, any> {
  const matches = Object.keys(mappings || {}).map(kind => ({ kind, definitions: kindReadClassifications(mappings, kind)
    .filter(definition => matchesKindClassification(definition, fields)) })).filter(match => match.definitions.length);
  if (!matches.length) return { ...fields };
  const sharedList = matches.length > 1
    ? matches[0].definitions.find(definition => 'kindList' in definition && matches.every(match =>
      match.definitions.some(candidate => 'kindList' in candidate
        && candidate.kindList.key.toLowerCase() === definition.kindList.key.toLowerCase()
        && candidate.kindList.value.toLowerCase() === definition.kindList.value.toLowerCase())))
    : undefined;
  const discriminated = sharedList ? matches.filter(match => {
    const discriminator = kindDiscriminator(mappings, match.kind);
    return discriminator && readClassificationProperty(fields, discriminator.key) === discriminator.value;
  }) : [];
  if (discriminated.length > 1) throw new Error('Ambiguous frontmatter kind classification.');
  if (discriminated.length === 1) {
    const chosen = discriminated[0];
    if ((expectedKind && expectedKind !== chosen.kind) || matches.some(match => match.kind !== chosen.kind
      && match.definitions.some(definition => JSON.stringify(definition).toLowerCase() !== JSON.stringify(sharedList).toLowerCase()))) {
      throw new Error('Ambiguous frontmatter kind classification.');
    }
    return { ...fields, kind: chosen.kind };
  }
  if (matches.length > 1 && (!sharedList || (expectedKind && matches.some(match => match.kind !== expectedKind
    && match.definitions.some(definition => JSON.stringify(definition).toLowerCase() !== JSON.stringify(sharedList).toLowerCase()))))) {
    throw new Error('Ambiguous frontmatter kind classification.');
  }
  if (matches.length > 1 && !expectedKind) return { ...fields };
  const selected = expectedKind ? matches.find(match => match.kind === expectedKind) : matches[0];
  if (!selected) throw new Error('Expected record kind does not match its configured classification.');
  const discriminator = kindDiscriminator(mappings, selected.kind);
  if (discriminator) {
    const value = readClassificationProperty(fields, discriminator.key);
    const primary = kindClassification(mappings, selected.kind);
    if ((value !== undefined && value !== discriminator.value)
      || (primary && matchesKindClassification(primary, fields) && value !== discriminator.value)) {
      throw new Error('Record discriminator conflicts with its kind classification.');
    }
  }
  const decoded = { ...fields, kind: selected.kind };
  const matchedProperty = selected.definitions.find((definition): definition is PropertyKindClassification =>
    'key' in definition && matchesKindClassification(definition, fields));
  if (matchedProperty) delete decoded[matchedProperty.key];
  return decoded;
}
