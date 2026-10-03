import { isMap, parseDocument, visit } from 'yaml';
import {
  classificationTags, decodeKind, kindClassification, kindReadClassifications,
  matchesKindClassification, normalizeKindClassification, readClassificationProperty,
  type KindClassification, type KindDiscriminator, type KindMappings,
} from './kind-classification';

export interface KindClassificationMigration {
  kind: 'classification';
  recordKind: string;
  from: KindClassification;
  to: KindClassification;
}

export interface KindDiscriminatorMigration {
  kind: 'discriminator';
  recordKind: string;
  primary: KindClassification;
  from: KindDiscriminator | null;
  to: KindDiscriminator | null;
}

/** A reviewed mapping edit changes only notes that the old mapping identifies. */
export function migrateNoteDiscriminator(source: string, change: KindDiscriminatorMigration, mappings: KindMappings): string {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/u.exec(source);
  if (!opening) return source;
  const rest = source.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/mu.exec(rest);
  const yaml = closing ? rest.slice(0, closing.index) : rest;
  const mayContain = [change.from?.key, change.primary && 'kindList' in change.primary ? change.primary.kindList.value : '']
    .filter(Boolean).some(value => yaml.toLowerCase().includes(String(value).toLowerCase()));
  if (!closing) {
    if (mayContain) throw new Error('Malformed frontmatter may contain this record identity.');
    return source;
  }
  const doc = parseDocument(yaml, { uniqueKeys: false, keepSourceTokens: true });
  if (doc.errors.length || !isMap(doc.contents)) {
    if (mayContain) throw new Error('Malformed frontmatter may contain this record identity.');
    return source;
  }
  let raw: Record<string, unknown>;
  try { raw = doc.toJS({ maxAliasCount: 0 }) as Record<string, unknown>; }
  catch {
    if (mayContain) throw new Error('YAML aliases require manual record identity migration.');
    return source;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return source;
  if (change.from && readClassificationProperty(raw, change.from.key) !== change.from.value) return source;
  if (!change.from && change.to && readClassificationProperty(raw, change.to.key) === change.to.value) return source;
  const matches = kindReadClassifications(mappings, change.recordKind)
    .some(definition => matchesKindClassification(definition, raw));
  if (!matches) return source;
  const decoded = decodeKind(mappings, raw);
  if (decoded.kind !== change.recordKind) {
    if (decoded.kind === undefined || Array.isArray(decoded.kind)) throw new Error('Shared kind path needs independent record identity before changing this field.');
    return source;
  }
  if (doc.contents.items.some(pair => pair.key?.toString() === '<<')) throw new Error('YAML merge keys require manual record identity migration.');
  const keys = new Set<string>();
  for (const pair of doc.contents.items) {
    const key = String((pair.key as any)?.value || '').toLowerCase();
    if (!key || keys.has(key)) throw new Error('Duplicate or complex YAML keys require manual record identity migration.');
    keys.add(key);
  }
  let special = false;
  visit(doc, { Node(_key, node: any) { if (node.anchor || node.tag || node.type === 'ALIAS') special = true; } });
  if (special) throw new Error('YAML anchors and explicit tags require manual record identity migration.');
  const destination = change.to && readClassificationProperty(raw, change.to.key);
  const sameField = change.from && change.to && change.from.key.toLowerCase() === change.to.key.toLowerCase();
  if (change.to && destination !== undefined && (!sameField || destination !== change.from?.value)) {
    throw new Error(`Destination identity property “${change.to.key}” already exists.`);
  }
  if (change.from) {
    const oldKey = Object.keys(raw).find(key => key.toLowerCase() === change.from!.key.toLowerCase());
    if (oldKey) doc.delete(oldKey);
  }
  if (change.to) doc.set(change.to.key, change.to.value);
  let nextYaml = doc.toString({ lineWidth: 0 });
  if (yaml.includes('\r\n')) nextYaml = nextYaml.replace(/\n/gu, '\r\n');
  const nextRaw = parseDocument(nextYaml).toJS() as Record<string, unknown>;
  const entry = mappings[change.recordKind];
  const future = { ...mappings, [change.recordKind]: {
    primary: change.primary,
    aliases: kindReadClassifications(mappings, change.recordKind).slice(1),
    ...(change.to ? { discriminator: change.to } : {}),
    ...(entry && typeof entry === 'object' && 'primary' in entry && entry.writeDisabled ? { writeDisabled: true } : {}),
  } };
  if (decodeKind(future, nextRaw).kind !== change.recordKind) throw new Error('The new identity conflicts with another record type.');
  return opening[0] + nextYaml + rest.slice(closing.index);
}

export function validateKindClassificationMigration(change: KindClassificationMigration, mappings: KindMappings): void {
  const current = kindClassification(mappings, change.recordKind);
  const from = normalizeKindClassification(change.from, change.recordKind);
  if (!change.recordKind || !current || JSON.stringify(current) !== JSON.stringify(from)) {
    throw new Error('The record classification changed. Reopen settings.');
  }
  const to = normalizeKindClassification(change.to, change.recordKind);
  if (JSON.stringify(from) === JSON.stringify(to)) throw new Error('Choose a different record classification.');
  for (const kind of Object.keys(mappings)) {
    if (kind === change.recordKind) continue;
    for (const other of kindReadClassifications(mappings, kind)) {
      if (JSON.stringify(other).toLowerCase() === JSON.stringify(to).toLowerCase()) {
        if ('kindList' in to) continue;
        throw new Error('Another record type already uses that classification.');
      }
    }
  }
}

function removeDefinition(doc: ReturnType<typeof parseDocument>, raw: Record<string, unknown>, definition: KindClassification): void {
  if ('tag' in definition) {
    const tags = classificationTags(raw.tags).filter(tag => tag.toLowerCase() !== definition.tag.toLowerCase());
    if (tags.length) doc.set('tags', tags); else doc.delete('tags');
  } else if ('kindList' in definition) {
    const values = raw[definition.kindList.key];
    if (!Array.isArray(values) || !values.every(value => typeof value === 'string')) throw new Error('Resolve the kind list before migration.');
    const remaining = values.filter(value => value.toLowerCase() !== definition.kindList.value.toLowerCase());
    if (remaining.length) doc.set(definition.kindList.key, remaining); else doc.delete(definition.kindList.key);
  } else if ('scalar' in definition) {
    doc.delete(definition.scalar.key);
  } else {
    doc.delete('kind');
    doc.delete(definition.key);
  }
}

function addDefinition(doc: ReturnType<typeof parseDocument>, definition: KindClassification): void {
  const state = doc.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
  const assertExactKey = (key: string) => {
    const variant = Object.keys(state).find(existing => existing.toLowerCase() === key.toLowerCase() && existing !== key);
    if (variant) throw new Error(`Destination “${key}” has a case-variant key.`);
  };
  if ('tag' in definition) {
    assertExactKey('tags');
    const tags = classificationTags(state.tags);
    if (!tags.some(tag => tag.toLowerCase() === definition.tag.toLowerCase())) tags.push(definition.tag);
    doc.set('tags', tags);
  } else if ('kindList' in definition) {
    assertExactKey(definition.kindList.key);
    const existing = state[definition.kindList.key];
    if (existing !== undefined && (!Array.isArray(existing) || !existing.every(value => typeof value === 'string'))) {
      throw new Error(`Destination “${definition.kindList.key}” must be a list of text values.`);
    }
    const values: string[] = Array.isArray(existing) ? [...existing] : [];
    if (!values.some(value => value.toLowerCase() === definition.kindList.value.toLowerCase())) values.push(definition.kindList.value);
    doc.set(definition.kindList.key, values);
  } else if ('scalar' in definition) {
    assertExactKey(definition.scalar.key);
    if (state[definition.scalar.key] !== undefined && state[definition.scalar.key] !== definition.scalar.value) {
      throw new Error(`Destination “${definition.scalar.key}” has a different value.`);
    }
    doc.set(definition.scalar.key, definition.scalar.value);
  } else {
    assertExactKey('kind');
    assertExactKey(definition.key);
    if (state.kind !== undefined && state.kind !== definition.parentKind) throw new Error('Destination kind has a different value.');
    if (state[definition.key] !== undefined && state[definition.key] !== definition.value) {
      throw new Error(`Destination “${definition.key}” has a different value.`);
    }
    doc.set('kind', definition.parentKind);
    doc.set(definition.key, definition.value);
  }
}

/** Convert only the selected configured classification; never edit the note body. */
export function migrateNoteClassification(source: string, change: KindClassificationMigration, mappings: KindMappings): string {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(source);
  if (!opening) return source;
  const rest = source.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  const yaml = closing ? rest.slice(0, closing.index) : rest;
  const from = normalizeKindClassification(change.from, change.recordKind);
  const target = 'tag' in from ? from.tag : 'kindList' in from ? from.kindList.value : 'scalar' in from ? from.scalar.value : from.value;
  const mayContain = yaml.toLowerCase().includes(target.toLowerCase());
  if (!closing) {
    if (mayContain) throw new Error('Malformed frontmatter may contain this record classification.');
    return source;
  }
  const doc = parseDocument(yaml, { uniqueKeys: false, keepSourceTokens: true });
  if (doc.errors.length || !isMap(doc.contents)) {
    if (mayContain) throw new Error('Malformed frontmatter may contain this record classification.');
    return source;
  }
  if (mayContain) {
    if (doc.contents.items.some(pair => pair.key?.toString() === '<<')) throw new Error('YAML merge keys require manual classification migration.');
    const keys = new Set<string>();
    for (const pair of doc.contents.items) {
      const key = String((pair.key as any)?.value || '').toLowerCase();
      if (!key || keys.has(key)) throw new Error('Duplicate or complex YAML keys require manual classification migration.');
      keys.add(key);
    }
    let special = false;
    visit(doc, { Node(_key, node: any) { if (node.anchor || node.tag || node.type === 'ALIAS') special = true; } });
    if (special) throw new Error('YAML anchors and explicit tags require manual classification migration.');
  }
  let raw: Record<string, unknown>;
  try { raw = doc.toJS({ maxAliasCount: 0 }) as Record<string, unknown>; }
  catch {
    if (mayContain) throw new Error('YAML aliases require manual classification migration.');
    return source;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return source;
  if ('tag' in from && mayContain) {
    try { classificationTags(raw.tags); }
    catch { throw new Error('Resolve the tags property before changing this record classification.'); }
  }
  if (!matchesKindClassification(from, raw)) return source;
  const decoded = decodeKind(mappings, raw);
  if (decoded.kind !== change.recordKind) {
    if (Array.isArray(decoded.kind)) throw new Error('This shared kind path needs a record-specific migration filter.');
    throw new Error('The note has conflicting record classifications.');
  }
  removeDefinition(doc, raw, from);
  addDefinition(doc, normalizeKindClassification(change.to, change.recordKind));
  let nextYaml = doc.toString({ lineWidth: 0 });
  if (yaml.includes('\r\n')) nextYaml = nextYaml.replace(/\n/g, '\r\n');
  const next = opening[0] + nextYaml + rest.slice(closing.index);
  const nextRaw = parseDocument(nextYaml).toJS() as Record<string, unknown>;
  if (decodeKind({ ...mappings, [change.recordKind]: change.to }, nextRaw).kind !== change.recordKind) {
    throw new Error('The destination record classification conflicts with another type.');
  }
  return next;
}
