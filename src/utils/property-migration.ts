import { MANAGED_NOTE_FIELDS, managedNoteFieldKey, configureManagedNoteField } from './managed-note-fields';
import { isAlias, isMap, isScalar, isSeq, parseDocument, visit } from 'yaml';

export type PropertyMigration =
  | { kind: 'key'; from: string; to: string; previousKeys?: string[] }
  | { kind: 'value'; key: string; from: string; to: string };
export interface SettingsPatch { key: string; before: unknown; after: unknown }
export const MIGRATABLE_KEY_SETTINGS = {
  dateCreatedFrontmatterKey: 'datecreated',
  dateModifiedFrontmatterKey: 'datemodified',
  viewModeFrontmatterKey: 'viewmode',
  timeTrackingPropertyKey: 'timeTracking',
  taskVisibilityStateFrontmatterKey: 'gcmTaskVisibility',
  parentLinkFrontmatterKey: 'parent',
  nativeRecordKindPropertyKey: 'kind',
  nativeRecordTitlePropertyKey: 'title',
} as const;
const fold = (value: string) => value.trim().toLowerCase();
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
export function validateMigration(change: PropertyMigration): void {
  const key = change.kind === 'key' ? change.to : change.key;
  if (!key.trim() || /[\r\n\x00-\x1f]/.test(key) || forbidden.has(fold(key))) throw new Error('Enter a non-empty property name without control characters.');
  if (!change.from.trim() || !change.to.trim()) throw new Error('Both the old and new name or value are required.');
  if (change.from === change.to) throw new Error('The old and new values are identical.');
}

export function validateMigrationSettings(settings: any, change: PropertyMigration): void {
  if (change.kind !== 'key' || fold(change.from) === fold(change.to)) return;
  if (['tpsid', 'tags', 'aliases'].includes(fold(change.to)) || fold(change.from) === 'tpsid') throw new Error('This property is reserved and cannot be used for this mapping.');
  const configured = [
    ...(settings.properties || []).map((property: any) => property.key),
    ...Object.entries(MIGRATABLE_KEY_SETTINGS).map(([key, fallback]) => settings[key] || fallback),
    ...MANAGED_NOTE_FIELDS.map(field => managedNoteFieldKey(settings, field)),
  ];
  if (configured.some(key => typeof key === 'string' && fold(key) === fold(change.to))) {
    throw new Error(`Another GCM mapping already uses "${change.to}". Choose a different property name.`);
  }
}

/** Patch source ranges, never serialize the document or alter the Markdown body. */
export function migrateNoteProperties(source: string, change: PropertyMigration): string {
  validateMigration(change);
  if (change.kind === 'key' && change.previousKeys?.length) {
    let next = source;
    for (const from of [...new Set([change.from, ...change.previousKeys])]) {
      if (from !== change.to) next = migrateNoteProperties(next, { kind: 'key', from, to: change.to });
    }
    return next;
  }
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(source);
  if (!opening) return source;
  const rest = source.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  const yaml = closing ? rest.slice(0, closing.index) : rest;
  const wanted = fold(change.kind === 'key' ? change.from : change.key);
  const doc = parseDocument(yaml, { uniqueKeys: false, keepSourceTokens: true });
  const map = isMap(doc.contents) ? doc.contents : null;
  const matches = map?.items.filter(pair => isScalar(pair.key) && fold(String(pair.key.value)) === wanted) || [];
  if (map?.items.some(pair => isScalar(pair.key) && pair.key.value === '<<')) {
    let mayInheritSource = matches.length > 0;
    visit(doc, { Pair(_key, pair) { if (isScalar(pair.key) && fold(String(pair.key.value)) === wanted) mayInheritSource = true; } });
    if (mayInheritSource) throw new Error('YAML merge keys require manual migration.');
  }
  if (!matches.length) {
    // A parse failure may have hidden the source key; don't silently skip a potential match.
    if ((!closing || doc.errors.length) && yaml.toLowerCase().includes(wanted)) throw new Error('Malformed frontmatter may contain the source property.');
    return source;
  }
  if (!closing || doc.errors.length) throw new Error('Repair malformed frontmatter before migrating this note.');
  const seen = new Set<string>();
  for (const pair of map!.items) {
    if (!isScalar(pair.key)) throw new Error('Complex YAML keys require manual migration.');
    const key = fold(String(pair.key.value));
    if (seen.has(key)) throw new Error(`Duplicate property "${String(pair.key.value)}" must be resolved first.`);
    seen.add(key);
    if (key === '<<') throw new Error('YAML merge keys require manual migration.');
  }
  const pair = matches[0];
  const edits: { start: number; end: number; text: string }[] = [];
  const replace = (node: any, text: string) => {
    if (!node?.range || node.anchor || node.tag) throw new Error('Anchored or explicitly tagged properties require manual migration.');
    edits.push({ start: opening[0].length + node.range[0], end: opening[0].length + node.range[1], text });
  };
  if (change.kind === 'key') {
    if (wanted !== fold(change.to) && seen.has(fold(change.to))) throw new Error(`Destination property "${change.to}" already exists. No values will be overwritten.`);
    replace(pair.key, JSON.stringify(change.to.trim()));
  } else {
    const value = pair.value;
    const visit = (node: any) => {
      if (isAlias(node)) throw new Error('Aliased property values require manual migration.');
      if (isScalar(node) && typeof node.value === 'string' && node.value === change.from) {
        if (node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED') throw new Error('Multiline property values require manual migration.');
        replace(node, JSON.stringify(change.to));
      }
    };
    if (isSeq(value)) {
      if (value.anchor || value.tag) throw new Error('Anchored or explicitly tagged lists require manual migration.');
      value.items.forEach(visit);
    } else visit(value);
  }
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

/** Update known GCM references, not arbitrary text, formulas, or other plugins. */
export function updateMigrationReferences(settings: any, change: PropertyMigration): void {
  const key = change.kind === 'key' ? change.from : change.key;
  const renameKey = (value: any) => typeof value === 'string' && fold(value) === fold(key) ? change.to : value;
  const renameValue = (value: any) => value === change.from ? change.to : value;
  const condition = (item: any) => {
    if (!item || typeof item.key !== 'string' || fold(item.key) !== fold(key)) return;
    if (change.kind === 'key') item.key = change.to;
    else if (!item.operator || ['equals', 'not-equals'].includes(item.operator)) item.value = renameValue(item.value);
  };
  const renamesKindValue = change.kind === 'value' && (settings.properties || []).some((property: any) => property.type === 'kind' && fold(property.key || '') === fold(key));
  for (const property of settings.properties || []) {
    if (change.kind === 'key') property.key = renameKey(property.key);
    else if (fold(property.key || '') === fold(key)) property.options = property.options?.map(renameValue);
    if (renamesKindValue) {
      if (typeof property.acceptsKind === 'string') property.acceptsKind = property.acceptsKind.split(',').map((value: string) => renameValue(value.trim())).join(', ');
      for (const field of ['scopeKinds', 'hideKinds']) if (Array.isArray(property[field])) property[field] = property[field].map(renameValue);
    }
    property.scopeProperties?.forEach(condition);
    property.hideWhenProperties?.forEach(condition);
  }
  if (change.kind === 'key') {
    for (const field of MANAGED_NOTE_FIELDS) {
      if (fold(managedNoteFieldKey(settings, field)) === fold(key)) configureManagedNoteField(settings, field, change.to);
    }
    for (const [field, fallback] of Object.entries(MIGRATABLE_KEY_SETTINGS)) {
      if (fold(settings[field] || fallback) === fold(key)) settings[field] = change.to;
    }
    for (const field of ['activityLogPropertyKey', 'checklistCompletionPropertyKey', 'childLinkFrontmatterKey', 'parentChildIgnoreFrontmatterKey', 'templateIdentificationPropertyKey']) {
      if (typeof settings[field] === 'string') settings[field] = renameKey(settings[field]);
    }
    if (Array.isArray(settings.ignoredBacklinksFrontmatterKeys)) settings.ignoredBacklinksFrontmatterKeys = settings.ignoredBacklinksFrontmatterKeys.map(renameKey);
    for (const field of settings.virtualBaseEmbedProperties || []) field.key = renameKey(field.key);
  }
  const ruleCondition = (item: any) => {
    if (!item || !['frontmatter', 'parent-frontmatter'].includes(item.source) || fold(item.field || '') !== fold(key)) return;
    if (change.kind === 'key') item.field = change.to;
    else {
      if (['is', '!is'].includes(item.operator)) item.value = renameValue(item.value);
      for (const mapping of item.mappings || []) mapping.input = renameValue(mapping.input);
    }
  };
  const navigator = settings.notebookNavigatorRules;
  if (navigator) {
    for (const rule of [...(navigator.rules || []), ...(navigator.hideRules || []), ...(navigator.smartSort?.buckets || [])]) {
      rule.conditions?.forEach(ruleCondition);
      rule.conditionGroups?.forEach((group: any) => group.conditions?.forEach(ruleCondition));
      rule.sortCriteria?.forEach(ruleCondition);
      if (fold(rule.property || '') === fold(key)) {
        if (change.kind === 'key') rule.property = change.to;
        else if (['is', '!is'].includes(rule.operator)) rule.value = renameValue(rule.value);
      }
    }
  }
  for (const rule of settings.viewModeRules || []) {
    condition(rule);
    rule.conditions?.filter((item: any) => item.type === 'frontmatter').forEach(condition);
  }
  for (const [keyField, valueField] of [['parentChildIgnoreFrontmatterKey', 'parentChildIgnoreFrontmatterValue'], ['templateIdentificationPropertyKey', 'templateIdentificationPropertyValue']]) {
    if (change.kind === 'value' && fold(settings[keyField] || '') === fold(key)
      && (keyField !== 'templateIdentificationPropertyKey' || settings.templateIdentificationPropertyMatch !== 'contains')) settings[valueField] = renameValue(settings[valueField]);
  }
  if (change.kind === 'value' && (settings.properties || []).some((p: any) => p.id === 'status' && fold(p.key) === fold(key))) {
    for (const field of ['activeStatusValues', 'recurrenceCompletionStatuses', 'parentCompletionStatuses', 'checklistFinalPromptStatuses']) {
      if (Array.isArray(settings[field])) settings[field] = settings[field].map(renameValue);
    }
    settings.recurrenceDefaultStatus = renameValue(settings.recurrenceDefaultStatus);
    for (const mapping of settings.linkedSubitemCheckboxMappings || []) {
      mapping.statuses = mapping.statuses?.map(renameValue);
      mapping.toggleTargetStatus = renameValue(mapping.toggleTargetStatus);
    }
  }
}
export function settingsPatches(before: any, after: any): SettingsPatch[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(key => ({ key, before: before[key], after: after[key] }));
}
