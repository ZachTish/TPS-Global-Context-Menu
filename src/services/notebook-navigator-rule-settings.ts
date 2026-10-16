import { DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS, NotebookNavigatorRuleSettings } from '../types';

// Keep retired configuration opaque for preservation. Only these three fields
// still have consumers: manual appearance and manual property ordering.
export function normalizeStoredNavigatorFields(raw: unknown): NotebookNavigatorRuleSettings {
  const record = asRecord(raw);
  const sort = asRecord(record.smartSort);
  const defaults = DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS;
  return {
    ...defaults,
    ...record,
    frontmatterIconField: normalizeField(record.frontmatterIconField, defaults.frontmatterIconField),
    frontmatterColorField: normalizeField(record.frontmatterColorField, defaults.frontmatterColorField),
    smartSort: Array.isArray(record.smartSort)
      ? record.smartSort as unknown as NotebookNavigatorRuleSettings['smartSort']
      : {
      ...defaults.smartSort,
      ...sort,
      field: normalizeField(sort.field, defaults.smartSort.field),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeField(value: unknown, fallback: string): string {
  const field = (String(value ?? '').trim() || fallback).replace(/\s+/g, '');
  return ['externaleventid', 'tpscalendaruid'].includes(field.toLowerCase()) ? fallback : field;
}
