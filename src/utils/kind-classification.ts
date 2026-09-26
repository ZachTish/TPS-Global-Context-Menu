/** Internal record types map to a user-chosen property pair or a complete tag. */
export interface PropertyKindClassification { key: string; value: string; parentKind: string }
export interface TagKindClassification { tag: string }
export type KindClassification = PropertyKindClassification | TagKindClassification;
export type KindMappings = Record<string, string | KindClassification>;
const parents = new Set(['task', 'note', 'entity', 'collection', 'transaction']);

export function normalizeClassificationTag(value: string): string {
  const tag = value.trim().replace(/^#/, '');
  // Obsidian tag segments have no semantic meaning to TPS. Match complete tags,
  // including Unicode; do not interpret ancestors as another record type.
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
export function hasClassificationTag(fields: Record<string, any>, tag: string): boolean {
  try { return classificationTags(fields.tags).some(value => value.toLowerCase() === tag.toLowerCase()); }
  catch { return false; }
}
export function kindClassification(mappings: KindMappings | undefined, kind: string): KindClassification | null {
  const value = mappings?.[kind];
  if (!value || typeof value !== 'object') return null;
  if ('tag' in value) return { tag: normalizeClassificationTag(value.tag) };
  if (!parents.has(value.parentKind) || !/^([a-zA-Z_][a-zA-Z0-9_-]*)$/.test(value.key) || ['kind','tpsId','title','tags'].includes(value.key) || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(value.value)) throw new Error(`Invalid classification for ${kind}.`);
  return { key: value.key, value: value.value, parentKind: value.parentKind };
}
export function encodeKind(mappings: KindMappings | undefined, fields: Record<string, any>): Record<string, any> {
  const definition = kindClassification(mappings, String(fields.kind || ''));
  if (!definition) return { ...fields };
  if (!('tag' in definition)) return { ...fields, kind: definition.parentKind, [definition.key]: definition.value };
  const next = { ...fields };
  delete next.kind;
  const tags = classificationTags(next.tags);
  if (!hasClassificationTag(next, definition.tag)) tags.push(definition.tag);
  next.tags = tags;
  // Reject conflicting configured type tags; never silently remove user tags.
  decodeKind(mappings, next);
  return next;
}
export function decodeKind(mappings: KindMappings | undefined, fields: Record<string, any>): Record<string, any> {
  const matches = Object.keys(mappings || {}).filter(kind => {
    const definition = kindClassification(mappings, kind);
    return definition && ('tag' in definition ? hasClassificationTag(fields, definition.tag)
      : fields.kind === definition.parentKind && fields[definition.key] === definition.value);
  });
  if (matches.length > 1) throw new Error('Ambiguous frontmatter kind classification.');
  if (!matches.length) return { ...fields };
  const decoded = { ...fields, kind: matches[0] };
  const definition = kindClassification(mappings, matches[0])!;
  if (!('tag' in definition)) delete decoded[definition.key];
  return decoded;
}
