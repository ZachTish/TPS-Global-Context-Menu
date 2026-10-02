import { isMap, parseDocument, visit } from 'yaml';
import {
  classificationTags, decodeKind, kindClassification, normalizeClassificationTag,
  type KindClassification, type KindMappings,
} from './kind-classification';

export interface KindClassificationMigration {
  kind: 'classification';
  recordKind: string;
  from: KindClassification;
  to: KindClassification;
}

export function validateKindClassificationMigration(change: KindClassificationMigration, mappings: KindMappings): void {
  const current = kindClassification(mappings, change.recordKind);
  const from = kindClassification({ [change.recordKind]: change.from }, change.recordKind);
  if (!change.recordKind || !current || !from || JSON.stringify(current) !== JSON.stringify(from)) {
    throw new Error('The record classification changed. Reopen settings.');
  }
  const to = kindClassification({ [change.recordKind]: change.to }, change.recordKind);
  if (!to || JSON.stringify(from) === JSON.stringify(to)) throw new Error('Choose a different record classification.');
  if ('key' in to && ['kind', 'tags', 'tpsid', 'title'].includes(to.key.toLowerCase())) throw new Error('Choose a subkind property outside the shared record envelope.');
  for (const [kind] of Object.entries(mappings)) {
    if (kind === change.recordKind) continue;
    const other = kindClassification(mappings, kind);
    if (!other) continue;
    if ('tag' in to && 'tag' in other && normalizeClassificationTag(other.tag).toLowerCase() === to.tag.toLowerCase()) {
      throw new Error('Another record type already uses that tag.');
    }
    if ('key' in to && 'key' in other && to.parentKind === other.parentKind && to.key.toLowerCase() === other.key.toLowerCase() && to.value === other.value) {
      throw new Error('Another record type already uses that property pair.');
    }
  }
}

/** Convert only the selected frontmatter classification; never edit the note body. */
export function migrateNoteClassification(source: string, change: KindClassificationMigration, mappings: KindMappings): string {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(source);
  if (!opening) return source;
  const rest = source.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  const yaml = closing ? rest.slice(0, closing.index) : rest;
  const lowered = yaml.toLowerCase();
  const mayContain = 'tag' in change.from ? lowered.includes(change.from.tag.toLowerCase())
    : lowered.includes(change.from.key.toLowerCase()) && lowered.includes(change.from.value.toLowerCase());
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
  const from = change.from, to = change.to;
  const matches = 'tag' in from
    ? (() => { try { return classificationTags(raw.tags).some(tag => tag.toLowerCase() === from.tag.toLowerCase()); } catch { if (mayContain) throw new Error('Resolve the tags property before changing this record classification.'); return false; } })()
    : raw.kind === from.parentKind && raw[from.key] === from.value;
  if (!matches) return source;
  if (decodeKind(mappings, raw).kind !== change.recordKind) throw new Error('The note has conflicting record classifications.');

  let tags: string[];
  try { tags = classificationTags(raw.tags); }
  catch { throw new Error('Resolve the tags property before changing this record classification.'); }
  if ('tag' in from) {
    tags = tags.filter(tag => tag.toLowerCase() !== from.tag.toLowerCase());
    if (tags.length) doc.set('tags', tags); else doc.delete('tags');
  } else {
    doc.delete('kind');
    doc.delete(from.key);
  }
  if ('tag' in to) {
    if (!tags.some(tag => tag.toLowerCase() === to.tag.toLowerCase())) tags.push(to.tag);
    doc.set('tags', tags);
  } else {
    const keys = Object.keys(raw);
    const kindKey = keys.find(key => key.toLowerCase() === 'kind');
    const destinationKey = keys.find(key => key.toLowerCase() === to.key.toLowerCase());
    if (kindKey && kindKey !== 'kind') throw new Error('Destination kind property has a case-variant key.');
    if (destinationKey && destinationKey !== to.key && destinationKey !== ('key' in from ? from.key : '')) {
      throw new Error(`Destination property “${to.key}” has a case-variant key.`);
    }
    const previousKind = raw.kind;
    const previousValue = raw[to.key];
    if ('tag' in from && previousKind !== undefined && previousKind !== to.parentKind) throw new Error('Destination kind property has a different value.');
    if (previousValue !== undefined && previousValue !== to.value && to.key !== ('key' in from ? from.key : '')) throw new Error(`Destination property “${to.key}” has a different value.`);
    doc.set('kind', to.parentKind);
    doc.set(to.key, to.value);
  }
  let nextYaml = doc.toString({ lineWidth: 0 });
  if (yaml.includes('\r\n')) nextYaml = nextYaml.replace(/\n/g, '\r\n');
  const next = opening[0] + nextYaml + rest.slice(closing.index);
  const nextRaw = parseDocument(nextYaml).toJS() as Record<string, unknown>;
  if (decodeKind({ ...mappings, [change.recordKind]: change.to }, nextRaw).kind !== change.recordKind) {
    throw new Error('The destination record classification conflicts with another type.');
  }
  return next;
}
