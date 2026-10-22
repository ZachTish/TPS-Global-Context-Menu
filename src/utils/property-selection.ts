import type { CustomProperty } from '../types';
import { isLinkListProperty, isTagListProperty, parseLinkListInput, parseMixedListInput, parseStringListInput } from './list-utils';
import { propertyUsesEntityOptions } from './property-option-source';
import { getEntityReferenceTargetIdentity } from './entity-property';
import { parseTagInput } from './tag-utils';

export interface PropertySelection {
  total: number;
  empty: number;
  values: Array<{ value: string; count: number }>;
}

export function propertySelectionIdentity(property: CustomProperty, value: string): string {
  // Match the existing removal writer: text is case-sensitive; entity aliases share a target.
  if (propertyUsesEntityOptions(property)) {
    const target = getEntityReferenceTargetIdentity(value);
    if (target) return `link:${target}`;
  }
  return value;
}

export function selectedPropertyValues(property: CustomProperty, value: unknown): string[] {
  if (property.type !== 'list') return value === undefined || value === null || value === '' ? [] : [String(value)];
  if (isLinkListProperty(property)) return parseLinkListInput(value);
  if (propertyUsesEntityOptions(property)) return parseMixedListInput(value);
  if (isTagListProperty(property)) return parseTagInput(value);
  return parseStringListInput(value);
}

/** Selection-local metadata only. Each note contributes at most once per value. */
export function summarizePropertySelection(entries: readonly any[], property: CustomProperty): PropertySelection {
  const seen = new Set<string>();
  const values = new Map<string, { value: string; count: number }>();
  let total = 0, empty = 0;
  for (const [index, entry] of entries.entries()) {
    const path = entry?.file?.path || entry?.path || `entry:${index}`;
    if (seen.has(path)) continue;
    seen.add(path);
    total++;
    const fm = entry?.frontmatter || {};
    const key = Object.keys(fm).find(key => key.toLowerCase() === property.key.toLowerCase());
    const raw = key ? fm[key] : undefined;
    const legacyTagKey = property.key.toLowerCase() === 'tags'
      ? Object.keys(fm).find(key => key.toLowerCase() === 'tag') : undefined;
    const items = selectedPropertyValues(property, legacyTagKey && isTagListProperty(property) ? [raw, fm[legacyTagKey]] : raw);
    if (!items.length) empty++;
    const present = new Set<string>();
    for (const value of items) {
      const identity = propertySelectionIdentity(property, value);
      if (present.has(identity)) continue;
      present.add(identity);
      const current = values.get(identity);
      if (current) current.count++;
      else values.set(identity, { value, count: 1 });
    }
  }
  return { total, empty, values: [...values.values()] };
}

export function selectionCountLabel(label: string, count: number, total: number): string {
  return total > 1 ? `${label} — ${count}/${total} notes` : label;
}
