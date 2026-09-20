/** Persisted names for integration fields; canonical names remain the API contract. */
export const MANAGED_NOTE_FIELDS = ['externalId', 'sourcePath', 'location', 'url', 'tpsCalendarOrphanCandidateAt', 'tpsCalendarCancelledAt'] as const;
export type ManagedNoteField = typeof MANAGED_NOTE_FIELDS[number];
export type ManagedNoteFieldSettings = {
  managedNoteFieldKeys?: Partial<Record<ManagedNoteField, string>>;
  managedNoteFieldAliases?: Partial<Record<ManagedNoteField, string[]>>;
};
const reserved = new Set(['tpsid', 'subitemid', 'kind', 'title', 'tags', 'aliases', 'status', 'scheduled', 'end', '__proto__', 'constructor', 'prototype']);
export function managedNoteFieldKey(settings: ManagedNoteFieldSettings, field: ManagedNoteField): string {
  return String(settings.managedNoteFieldKeys?.[field] || field).trim() || field;
}
export function managedNoteFieldNames(settings: ManagedNoteFieldSettings, field: ManagedNoteField): string[] {
  return [managedNoteFieldKey(settings, field).toLowerCase()];
}
export function validateManagedNoteFieldKey(settings: ManagedNoteFieldSettings, field: ManagedNoteField, value: string): string | null {
  const key = value.trim();
  if (!key || /[\r\n\[\]{}:#]/u.test(key) || reserved.has(key.toLowerCase())) return 'Choose a nonempty property name that does not overlap a core note field.';
  if (MANAGED_NOTE_FIELDS.some(other => other !== field && managedNoteFieldNames(settings, other).includes(key.toLowerCase()))) return 'This name is already used by another integration field.';
  return null;
}
export function configureManagedNoteField(settings: ManagedNoteFieldSettings, field: ManagedNoteField, value: string): void {
  const error = validateManagedNoteFieldKey(settings, field, value);
  if (error) throw new Error(error);
  settings.managedNoteFieldAliases = { ...settings.managedNoteFieldAliases, [field]: [] };
  settings.managedNoteFieldKeys = { ...settings.managedNoteFieldKeys, [field]: value.trim() };
}
export function readManagedNoteField(settings: ManagedNoteFieldSettings, field: ManagedNoteField, frontmatter: Record<string, unknown> | null | undefined): unknown {
  const error = validateManagedNoteFieldKey(settings, field, managedNoteFieldKey(settings, field));
  if (error) throw new Error(error);
  if (!frontmatter) return undefined;
  const names = managedNoteFieldNames(settings, field);
  const keys = Object.keys(frontmatter).filter(key => names.includes(key.toLowerCase()));
  const populated = keys.filter(key => frontmatter[key] !== null && frontmatter[key] !== undefined && frontmatter[key] !== '');
  if (new Set(populated.map(key => JSON.stringify(frontmatter[key]))).size > 1) throw new Error(`Conflicting ${field} aliases; reconcile the note before syncing it.`);
  const key = populated[0] || keys[0];
  return key === undefined ? undefined : frontmatter[key];
}
export function writeManagedNoteField(settings: ManagedNoteFieldSettings, field: ManagedNoteField, frontmatter: Record<string, unknown>, value: unknown): void {
  const key = managedNoteFieldKey(settings, field);
  const error = validateManagedNoteFieldKey(settings, field, key);
  if (error) throw new Error(error);
  // Fail closed on ambiguous historical values, before removing any key.
  readManagedNoteField(settings, field, frontmatter);
  const names = managedNoteFieldNames(settings, field);
  for (const existing of Object.keys(frontmatter)) if (names.includes(existing.toLowerCase())) delete frontmatter[existing];
  if (value !== null && value !== undefined) frontmatter[key] = value;
}
