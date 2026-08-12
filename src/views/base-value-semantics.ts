import type { CustomProperty } from '../types';
import { isEntityReferenceProperty } from '../utils/entity-property';
import {
  getListItemType,
  parseMixedListInput,
  parseStringListInput,
} from '../utils/list-utils';
import {
  compareTpsFormulaValues,
  formatTpsFormulaValue,
  getTpsFormulaComparableValues,
} from '../services/tps-base-formula-service';

export type TpsBaseSortDirection = 'asc' | 'desc';
export type TpsBaseMultiValueGroupingMode = 'separate' | 'combined';
export type TpsBaseScalarValueKind =
  | 'auto'
  | 'text'
  | 'number'
  | 'datetime'
  | 'boolean'
  | 'choice'
  | 'tag'
  | 'link'
  | 'formula';

export type TpsBaseValueSemantics = {
  kind: TpsBaseScalarValueKind;
  collection: boolean;
  itemKind?: Exclude<TpsBaseScalarValueKind, 'formula'>;
};

const NATURAL_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const EMPTY_TEXT_VALUES = new Set(['', 'null', 'undefined']);

export function resolveTpsBaseMultiValueGroupingMode(raw: unknown): TpsBaseMultiValueGroupingMode {
  const normalized = String(raw ?? '').trim().toLocaleLowerCase();
  return normalized === 'combined' || normalized === 'combine' || normalized === 'single'
    ? 'combined'
    : 'separate';
}

export function normalizeTpsBaseKindIdentity(value: unknown): string {
  const normalized = String(value ?? '').trim().toLocaleLowerCase();
  if (normalized === 'tasks') return 'task';
  if (normalized === 'bullets') return 'bullet';
  if (normalized === 'notes') return 'note';
  if (normalized === 'headers' || normalized === 'headings') return 'heading';
  return normalized;
}

/**
 * Bare `kind` is an additive identity: a synthesized row keeps its structural
 * kind while also exposing every authored Kind value. `itemKind` and
 * `explicitKind` remain separate scalar/collection projections at call sites.
 */
export function getTpsBaseAdditiveKindValues(
  structuralKind: unknown,
  authoredKinds: unknown,
): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown, structural = false): void => {
    const text = String(value ?? '').trim();
    const identity = normalizeTpsBaseKindIdentity(text);
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    values.push(structural ? identity : text);
  };
  add(structuralKind, true);
  const addAuthored = (value: unknown): void => {
    if (value instanceof Set) {
      value.forEach(addAuthored);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(addAuthored);
      return;
    }
    if (typeof value === 'string') {
      const parsed = parseStringListInput(value);
      (parsed.length ? parsed : [value]).forEach((item) => add(item));
      return;
    }
    if (value != null) add(value);
  };
  addAuthored(authoredKinds);
  return values;
}

export function resolveTpsBaseValueSemantics(
  propertyId: unknown,
  property?: CustomProperty | null,
): TpsBaseValueSemantics {
  const reference = String(propertyId ?? '').trim();
  const normalized = normalizePropertyReference(property?.key || reference);
  if (/^formula\./iu.test(reference)) return { kind: 'formula', collection: false };

  const entityReference = isEntityReferenceProperty(property);
  if (property?.type === 'list') {
    const listItemType = getListItemType(property);
    return {
      kind: entityReference || listItemType === 'link' ? 'link' : listItemType === 'tag' ? 'tag' : 'text',
      collection: true,
      itemKind: entityReference || listItemType === 'link' ? 'link' : listItemType === 'tag' ? 'tag' : 'text',
    };
  }
  if (entityReference) return { kind: 'link', collection: false };

  if (property?.type === 'number') return { kind: 'number', collection: false };
  if (property?.type === 'datetime') return { kind: 'datetime', collection: false };
  if (property?.type === 'checkbox') return { kind: 'boolean', collection: false };
  if (property?.type === 'selector' || property?.type === 'kind') return { kind: 'choice', collection: false };
  if (property?.type === 'text' || property?.type === 'folder' || property?.type === 'recurrence') {
    return { kind: 'text', collection: false };
  }
  if (property?.type === 'snooze') return { kind: 'datetime', collection: false };

  if (normalized === 'tag' || normalized === 'tags' || normalized === 'filetags') {
    return { kind: 'tag', collection: true, itemKind: 'tag' };
  }
  if (isDateLikeProperty(normalized)) return { kind: 'datetime', collection: false };
  return { kind: 'auto', collection: false };
}

/**
 * Compare values with one contract for native Bases values and synthesized
 * TPS rows. Empty values always sort after populated values in both
 * directions; callers can therefore use the returned zero to retain their
 * original order for stable ties.
 */
export function compareTpsBaseValues(
  left: unknown,
  right: unknown,
  semantics: TpsBaseValueSemantics,
  direction: TpsBaseSortDirection = 'asc',
): number {
  const effectiveSemantics = semantics.kind === 'auto'
    && !semantics.collection
    && (isCollectionLike(left) || isCollectionLike(right))
    ? { kind: 'auto', collection: true, itemKind: 'auto' } satisfies TpsBaseValueSemantics
    : semantics;
  const leftValues = getComparableValues(left, effectiveSemantics);
  const rightValues = getComparableValues(right, effectiveSemantics);
  const leftEmpty = leftValues.length === 0;
  const rightEmpty = rightValues.length === 0;
  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) return 0;
    return leftEmpty ? 1 : -1;
  }

  const itemSemantics: TpsBaseValueSemantics = effectiveSemantics.collection
    ? { kind: effectiveSemantics.itemKind || effectiveSemantics.kind, collection: false }
    : effectiveSemantics;
  const count = Math.min(leftValues.length, rightValues.length);
  for (let index = 0; index < count; index += 1) {
    const result = compareScalarValues(leftValues[index], rightValues[index], itemSemantics.kind);
    if (result !== 0) return direction === 'desc' ? -result : result;
  }
  const lengthResult = leftValues.length === rightValues.length
    ? 0
    : leftValues.length < rightValues.length ? -1 : 1;
  return direction === 'desc' ? -lengthResult : lengthResult;
}

export function isTpsBaseEmptyValue(value: unknown, semantics: TpsBaseValueSemantics): boolean {
  return getComparableValues(value, semantics).length === 0;
}

export function getTpsBaseGroupValues(
  value: unknown,
  semantics: TpsBaseValueSemantics,
  mode: TpsBaseMultiValueGroupingMode = 'separate',
): string[] {
  const rawValues = semantics.collection
    ? getComparableValues(value, semantics)
    : getFormulaCompatibleValues(value);
  const values: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of rawValues) {
    const itemKind = semantics.collection ? semantics.itemKind || semantics.kind : semantics.kind;
    const label = formatGroupValue(rawValue, itemKind);
    const identity = itemKind === 'tag'
      ? normalizeTagIdentity(label)
      : itemKind === 'link'
        ? normalizeLinkValue(label)
        : label.toLocaleLowerCase();
    if (!label || EMPTY_TEXT_VALUES.has(identity) || seen.has(identity)) continue;
    seen.add(identity);
    values.push(label);
  }
  if (mode === 'combined' && values.length > 1) return [values.join(', ')];
  return values;
}

function getComparableValues(value: unknown, semantics: TpsBaseValueSemantics): unknown[] {
  if (semantics.collection) {
    return extractCollectionValues(value, semantics)
      .filter((item) => !isEmptyScalar(item));
  }
  if (semantics.kind === 'formula') {
    const comparable = getFormulaCompatibleValues(value).filter((item) => !isEmptyScalar(item));
    return comparable.length ? [value] : [];
  }
  const values = getFormulaCompatibleValues(value);
  const first = values.find((item) => !isEmptyScalar(item));
  return first === undefined ? [] : [first];
}

function extractCollectionValues(value: unknown, semantics: TpsBaseValueSemantics): unknown[] {
  if (value instanceof Set) return Array.from(value.values()).flatMap((item) => extractCollectionValues(item, semantics));
  if (Array.isArray(value)) return value.flatMap((item) => extractCollectionValues(item, semantics));

  const normalized = getFormulaCompatibleValues(value);
  if (normalized.length > 1 || (normalized.length === 1 && normalized[0] !== value)) {
    return normalized.flatMap((item) => extractCollectionValues(item, semantics));
  }

  const raw = normalized[0] ?? value;
  if (raw == null) return [];
  if (typeof raw !== 'string') return [raw];
  if (semantics.itemKind === 'link' || semantics.kind === 'link') {
    return parseMixedListInput(raw);
  }
  if (semantics.itemKind === 'tag' || semantics.kind === 'tag') {
    const hashtagValues = Array.from(raw.matchAll(/(?:^|\s)(#[^\s,#;]+)/gu)).map((match) => match[1]);
    const values = hashtagValues.length > 1 ? hashtagValues : parseStringListInput(raw);
    return values.filter(Boolean);
  }
  return parseStringListInput(raw);
}

function getFormulaCompatibleValues(value: unknown): unknown[] {
  if (value instanceof Set) return Array.from(value.values());
  try {
    return getTpsFormulaComparableValues(value);
  } catch {
    return value == null ? [] : [value];
  }
}

function isCollectionLike(value: unknown): boolean {
  if (Array.isArray(value) || value instanceof Set) return true;
  return !!value
    && typeof value === 'object'
    && String((value as any)?.constructor?.type || '').trim().toLocaleLowerCase() === 'list';
}

function compareScalarValues(left: unknown, right: unknown, kind: TpsBaseScalarValueKind): number {
  if (kind === 'formula') {
    try {
      return compareTpsFormulaValues(left, right);
    } catch {
      return compareText(left, right);
    }
  }
  if (kind === 'number') {
    const leftNumber = parseNumber(left);
    const rightNumber = parseNumber(right);
    if (leftNumber != null && rightNumber != null) return compareNumbers(leftNumber, rightNumber);
    return compareText(left, right);
  }
  if (kind === 'datetime') {
    const leftTime = parseDateTime(left);
    const rightTime = parseDateTime(right);
    if (leftTime != null && rightTime != null) return compareNumbers(leftTime, rightTime);
    return compareText(left, right);
  }
  if (kind === 'boolean') {
    const leftBoolean = parseBoolean(left);
    const rightBoolean = parseBoolean(right);
    if (leftBoolean != null && rightBoolean != null) return compareNumbers(Number(leftBoolean), Number(rightBoolean));
    return compareText(left, right);
  }
  if (kind === 'link') return NATURAL_COLLATOR.compare(normalizeLinkValue(left), normalizeLinkValue(right));
  if (kind === 'tag') return NATURAL_COLLATOR.compare(normalizeTagIdentity(left), normalizeTagIdentity(right));
  if (kind === 'auto') return compareAutoValues(left, right);
  return compareText(left, right);
}

function compareAutoValues(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) return compareNumbers(left.getTime(), right.getTime());
  if (typeof left === 'boolean' && typeof right === 'boolean') return compareNumbers(Number(left), Number(right));
  if (typeof left === 'number' && typeof right === 'number') return compareNumbers(left, right);

  const leftText = String(left ?? '').trim();
  const rightText = String(right ?? '').trim();
  if (looksLikeLink(leftText) && looksLikeLink(rightText)) {
    return NATURAL_COLLATOR.compare(normalizeLinkValue(leftText), normalizeLinkValue(rightText));
  }
  const leftNumber = parseNumber(leftText);
  const rightNumber = parseNumber(rightText);
  if (leftNumber != null && rightNumber != null) return compareNumbers(leftNumber, rightNumber);
  if (looksLikeDate(leftText) && looksLikeDate(rightText)) {
    const leftTime = parseDateTime(leftText);
    const rightTime = parseDateTime(rightText);
    if (leftTime != null && rightTime != null) return compareNumbers(leftTime, rightTime);
  }
  return NATURAL_COLLATOR.compare(leftText, rightText);
}

function compareText(left: unknown, right: unknown): number {
  return NATURAL_COLLATOR.compare(formatTpsFormulaValue(left).trim(), formatTpsFormulaValue(right).trim());
}

function compareNumbers(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function parseDateTime(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  if (!looksLikeDate(text)) return null;
  const time = Date.parse(text.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/u, '$1T$2'));
  return Number.isFinite(time) ? time : null;
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  const normalized = String(value ?? '').trim().toLocaleLowerCase();
  if (['true', 'yes', 'on', 'checked', '[x]'].includes(normalized)) return true;
  if (['false', 'no', 'off', 'unchecked', '[ ]'].includes(normalized)) return false;
  return null;
}

function formatGroupValue(value: unknown, kind: TpsBaseScalarValueKind): string {
  if (kind === 'link') return canonicalLinkValue(value);
  if (kind === 'tag') {
    const tag = stripTagValue(value);
    return tag ? `#${tag}` : '';
  }
  if (kind === 'formula' && isFormulaLinkValue(value)) return String(value.path ?? '').trim();
  return formatTpsFormulaValue(value).trim();
}

function canonicalLinkValue(value: unknown): string {
  const raw = String(value ?? '').trim();
  const wikilink = raw.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/u);
  if (wikilink) return wikilink[1].trim();
  const markdown = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/u);
  if (markdown) return markdown[2].trim();
  if (value && typeof value === 'object' && '__tpsFormulaType' in value) {
    const item = value as { __tpsFormulaType?: string; path?: unknown; display?: unknown };
    if (item.__tpsFormulaType === 'link' || item.__tpsFormulaType === 'file') {
      return String(item.path ?? '').trim();
    }
  }
  return raw;
}

function isFormulaLinkValue(value: unknown): value is { __tpsFormulaType?: string; path?: unknown } {
  return !!value
    && typeof value === 'object'
    && ['link', 'file'].includes(String((value as any).__tpsFormulaType || '').trim());
}

function normalizeLinkValue(value: unknown): string {
  if (value && typeof value === 'object' && '__tpsFormulaType' in value) {
    const item = value as { __tpsFormulaType?: string; path?: unknown };
    if (item.__tpsFormulaType === 'link' || item.__tpsFormulaType === 'file') value = item.path;
  }
  const raw = String(value ?? '').trim();
  const wikilink = raw.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/u);
  const markdown = raw.match(/^\[[^\]]+\]\(([^)]+)\)$/u);
  return String(wikilink?.[1] || markdown?.[1] || raw)
    .trim()
    .replace(/\.md(?=(?:#|$))/iu, '')
    .replace(/\\/gu, '/')
    .toLocaleLowerCase();
}

function stripTagValue(value: unknown): string {
  return String(value ?? '').trim().replace(/^#+/u, '');
}

function normalizeTagIdentity(value: unknown): string {
  return stripTagValue(value).toLocaleLowerCase();
}

function isEmptyScalar(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== 'string') return false;
  return EMPTY_TEXT_VALUES.has(value.trim().toLocaleLowerCase());
}

function normalizePropertyReference(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/^(?:note|task|file)\./u, '')
    .replace(/[\s_-]+/gu, '');
}

function isDateLikeProperty(value: string): boolean {
  return value === 'scheduled'
    || value === 'due'
    || value === 'start'
    || value === 'end'
    || value === 'date'
    || value === 'created'
    || value === 'modified'
    || value === 'ctime'
    || value === 'mtime'
    || value.endsWith('date')
    || value.endsWith('time')
    || value.endsWith('at');
}

function looksLikeDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u.test(value);
}

function looksLikeLink(value: string): boolean {
  return /^\[\[[^\]]+\]\]$/u.test(value) || /^\[[^\]]+\]\([^)]+\)$/u.test(value);
}
