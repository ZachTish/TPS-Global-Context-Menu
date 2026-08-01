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
    splitStringListText(String(value))
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => values.push(item));
  };

  visit(raw);
  return Array.from(new Set(values));
}

/**
 * Split persisted list text without cutting commas inside wikilinks, Markdown
 * links, nested collection syntax, or quoted text. A single balanced outer
 * `[ ... ]` pair is treated as list notation, while `[[ ... ]]` remains a
 * scalar wikilink. Exact spelling and case are preserved; only exact duplicate
 * values are removed by `parseStringListInput`.
 */
function splitStringListText(value: string): string[] {
  let source = String(value || '').trim();
  if (hasBalancedOuterListBrackets(source)) source = source.slice(1, -1).trim();
  if (!source) return [];

  const parts: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  let squareDepth = 0;
  let roundDepth = 0;
  let curlyDepth = 0;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      current += character;
      quote = character;
      continue;
    }
    if (character === '[') squareDepth += 1;
    else if (character === ']') squareDepth = Math.max(0, squareDepth - 1);
    else if (character === '(') roundDepth += 1;
    else if (character === ')') roundDepth = Math.max(0, roundDepth - 1);
    else if (character === '{') curlyDepth += 1;
    else if (character === '}') curlyDepth = Math.max(0, curlyDepth - 1);

    if (
      (character === ',' || character === '\n')
      && squareDepth === 0
      && roundDepth === 0
      && curlyDepth === 0
    ) {
      const item = current.trim();
      if (item) parts.push(item);
      current = '';
      continue;
    }
    current += character;
  }
  const item = current.trim();
  if (item) parts.push(item);
  return parts;
}

function hasBalancedOuterListBrackets(value: string): boolean {
  if (!value.startsWith('[') || !value.endsWith(']') || value.startsWith('[[')) return false;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[') depth += 1;
    else if (character === ']') depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
    if (depth < 0) return false;
  }
  return depth === 0 && !quote && !escaped;
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
