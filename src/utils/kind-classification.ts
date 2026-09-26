export interface KindClassification { key: string; value: string; parentKind: string }
export type KindMappings = Record<string, string | KindClassification>;
const parents = new Set(['task', 'note', 'entity', 'collection', 'transaction']);
export function kindClassification(mappings: KindMappings | undefined, kind: string): KindClassification | null {
  const value = mappings?.[kind];
  if (!value || typeof value !== 'object') return null;
  if (!parents.has(value.parentKind) || !/^([a-zA-Z_][a-zA-Z0-9_-]*)$/.test(value.key) || ["kind","tpsId","title","tags"].includes(value.key) || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(value.value)) throw new Error(`Invalid classification for ${kind}.`);
  return { key: value.key, value: value.value, parentKind: value.parentKind };
}
export function encodeKind(mappings: KindMappings | undefined, fields: Record<string, any>): Record<string, any> {
  const definition = kindClassification(mappings, String(fields.kind || ''));
  return definition ? { ...fields, kind: definition.parentKind, [definition.key]: definition.value } : { ...fields };
}
export function decodeKind(mappings: KindMappings | undefined, fields: Record<string, any>): Record<string, any> {
  const matches = Object.keys(mappings || {}).filter(kind => {
    const definition = kindClassification(mappings, kind);
    return definition && fields.kind === definition.parentKind && fields[definition.key] === definition.value;
  });
  if (matches.length > 1) throw new Error('Ambiguous frontmatter kind classification.');
  if (!matches.length) return { ...fields };
  const decoded = { ...fields, kind: matches[0] };
  delete decoded[kindClassification(mappings, matches[0])!.key];
  return decoded;
}
