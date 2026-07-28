import type { CustomProperty } from '../types';

export type ListItemType = 'tag' | 'text';
export type ExtendedListItemType = ListItemType | 'link';

export function getListItemType(property: Pick<CustomProperty, 'listItemType'> | null | undefined): ExtendedListItemType {
  const raw = String(property?.listItemType || '').trim().toLowerCase();
  if (raw === 'link') return 'link';
  return raw === 'text' ? 'text' : 'tag';
}

export function isTextListProperty(property: Pick<CustomProperty, 'type' | 'listItemType'> | null | undefined): boolean {
  return property?.type === 'list' && getListItemType(property) === 'text';
}

export function isLinkListProperty(property: Pick<CustomProperty, 'type' | 'listItemType'> | null | undefined): boolean {
  return property?.type === 'list' && getListItemType(property) === 'link';
}

export function isTagListProperty(property: Pick<CustomProperty, 'type' | 'listItemType'> | null | undefined): boolean {
  return property?.type === 'list' && getListItemType(property) === 'tag';
}

export function parseStringListInput(raw: unknown): string[] {
  const values: string[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || value === undefined || value === false) return;
    String(value)
      .split(/[,\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => values.push(item));
  };

  visit(raw);
  return Array.from(new Set(values));
}

export function mergeStringList(existing: unknown, incoming: unknown): string[] {
  return Array.from(new Set([...parseStringListInput(existing), ...parseStringListInput(incoming)]));
}

export function removeStringListValues(existing: unknown, valuesToRemove: unknown): string[] {
  const removeSet = new Set(parseStringListInput(valuesToRemove));
  return parseStringListInput(existing).filter((value) => !removeSet.has(value));
}

function splitLinkListText(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inWikiLink = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (!inWikiLink && char === '[' && next === '[') {
      inWikiLink = true;
      current += char;
      continue;
    }

    if (inWikiLink && char === ']' && next === ']') {
      inWikiLink = false;
      current += char;
      continue;
    }

    if (!inWikiLink && (char === ',' || char === '\n')) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) parts.push(trimmed);
  return parts;
}

/**
 * Parse a heterogeneous inline list without coercing plain values into links.
 *
 * Entity-enabled text lists may intentionally contain both literal values and
 * canonical wikilinks. Unlike `parseStringListInput`, this parser does not
 * split on commas that occur inside a wikilink.
 */
export function parseMixedListInput(raw: unknown): string[] {
  const values: string[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || value === undefined || value === false) return;
    splitLinkListText(String(value))
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => values.push(item));
  };

  visit(raw);
  return Array.from(new Set(values));
}

export function mergeMixedList(existing: unknown, incoming: unknown): string[] {
  return Array.from(new Set([
    ...parseMixedListInput(existing),
    ...parseMixedListInput(incoming),
  ]));
}

export function normalizeLinkListValue(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';

  const wiki = value.match(/^\[\[([^\]]+)\]\]$/);
  if (wiki) return `[[${wiki[1].trim()}]]`;

  const markdown = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (markdown) {
    const label = markdown[1].trim();
    const path = markdown[2].trim().replace(/\.md$/i, '');
    return label && label !== path ? `[[${path}|${label}]]` : `[[${path}]]`;
  }

  const bare = value.replace(/\.md$/i, '');
  return `[[${bare}]]`;
}

export function parseLinkListInput(raw: unknown): string[] {
  const values: string[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        const normalized = normalizeLinkListValue(item);
        if (normalized) values.push(normalized);
      });
      return;
    }
    if (value === null || value === undefined || value === false) return;
    splitLinkListText(String(value)).forEach((item) => {
      const normalized = normalizeLinkListValue(item);
      if (normalized) values.push(normalized);
    });
  };

  visit(raw);
  return Array.from(new Set(values));
}

export function mergeLinkList(existing: unknown, incoming: unknown): string[] {
  return Array.from(new Set([...parseLinkListInput(existing), ...parseLinkListInput(incoming)]));
}

export function removeLinkListValues(existing: unknown, valuesToRemove: unknown): string[] {
  const removeSet = new Set(parseLinkListInput(valuesToRemove));
  return parseLinkListInput(existing).filter((value) => !removeSet.has(value));
}

export function formatFileWikilink(path: string, basename?: string): string {
  const target = String(path || '').trim().replace(/\.md$/i, '');
  const label = String(basename || '').trim();
  if (!target) return '';
  return label && label !== target.split('/').pop() ? `[[${target}|${label}]]` : `[[${target}]]`;
}

export function getWikilinkDisplayText(value: string): string {
  const inner = String(value || '').trim().match(/^\[\[([^\]]+)\]\]$/)?.[1] || String(value || '').trim();
  const [target, alias] = inner.split('|');
  return (alias || target || '').trim().split('/').pop()?.replace(/\.md$/i, '') || inner;
}
