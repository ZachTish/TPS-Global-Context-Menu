import { replaceKanbanTaskLineCheckboxState } from './task-checkbox-utils';
import { normalizePropertyKeyIdentity } from '../utils/property-key-identity';
import type { CustomProperty } from '../types';
import {
  isLinkListProperty,
  mergeLinkList,
  mergeMixedList,
  mergeStringList,
  removeLinkListValues,
  removeStringListValues,
} from '../utils/list-utils';
import {
  mergeEntityReferenceList,
  mergeMixedEntityReferenceList,
  removeEntityReferenceListValues,
  removeMixedEntityReferenceListValues,
} from '../utils/entity-property';
import { propertyUsesEntityOptions } from '../utils/property-option-source';
import {
  readInlineFieldCarrierValues,
  setLogInlineFieldValue,
} from '../views/log-line-utils';
import {
  addInlineTagToTaskLine,
  parseTaskTagValues,
  readTaskLineTags,
  removeInlineTagFromTaskLine,
} from '../utils/task-line-metadata';

export type KanbanTaskLineItemKind = 'task' | 'bullet';

export type KanbanTaskLineParseResult = {
  itemKind: KanbanTaskLineItemKind;
  checkboxState?: string;
  text: string;
};

export type BuildKanbanTaskDropLineOptions = {
  line: string;
  propName: string;
  value: string | null;
  sourceLaneValues?: string[];
  filterTags?: string[];
  statusCheckboxState?: string | null;
  filterCheckboxState?: string | null;
  statusFieldKeysToRemove?: readonly string[];
  configuredProperty?: CustomProperty | null;
  isStatusPropertyName: (propName: string | null | undefined) => boolean;
};

export function parseKanbanLineItem(line: string, includeBullets = true): KanbanTaskLineParseResult | null {
  const taskMatch = String(line ?? '').match(/^\s*(?:[-*+]|\d+[.)])\s+\[([^\]\r\n]?)\]\s+(.+)$/);
  if (taskMatch) {
    return {
      itemKind: 'task',
      checkboxState: `[${taskMatch[1] ?? ''}]`,
      text: taskMatch[2] ?? '',
    };
  }
  if (!includeBullets) return null;
  const bulletMatch = String(line ?? '').match(/^\s*(?:[-*+]|\d+[.)])\s+(?!\[[^\]\r\n]*\]\s+)(.+)$/);
  if (!bulletMatch) return null;
  return {
    itemKind: 'bullet',
    text: bulletMatch[1] ?? '',
  };
}

export function normalizeKanbanWritableTaskTag(value: string): string {
  return String(value ?? '')
    .replace(/^#+/u, '')
    .replace(/[^\p{L}\p{N}/_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

export function normalizeKanbanInlinePropertyKey(key: string): string {
  return normalizePropertyKeyIdentity(key);
}

export function updateKanbanInlineTaskTag(line: string, value: string, sourceLaneValues: string[] = []): string {
  const cleanTag = normalizeKanbanWritableTaskTag(value);
  const sourceTags = new Set(sourceLaneValues
    .map((sourceValue) => normalizeKanbanWritableTaskTag(sourceValue))
    .filter((sourceTag) => sourceTag && sourceTag.toLowerCase() !== cleanTag.toLowerCase())
    .map((sourceTag) => sourceTag.toLowerCase()));
  const inlineTags = parseTaskTagValues([
    readInlineFieldCarrierValues(line, 'tag'),
    readInlineFieldCarrierValues(line, 'tags'),
  ]);

  // Semantic task tags can be persisted as raw hashtags or singular/plural
  // inline carriers. Remove the source lane from both forms, then collapse
  // surviving inline-only values into one canonical plural carrier.
  let nextLine = removeKanbanInlineTaskProperties(String(line ?? ''), ['tag', 'tags']);
  for (const sourceTag of sourceTags) {
    nextLine = removeInlineTagFromTaskLine(nextLine, sourceTag);
  }

  if (cleanTag) nextLine = addInlineTagToTaskLine(nextLine, cleanTag);
  const rawTags = new Set(readTaskLineTags(nextLine).map((tag) => tag.toLowerCase()));
  const remainingInlineTags = inlineTags.filter((tag) => (
    !sourceTags.has(tag.toLowerCase())
    && tag.toLowerCase() !== cleanTag.toLowerCase()
    && !rawTags.has(tag.toLowerCase())
  ));
  if (remainingInlineTags.length > 0) {
    nextLine = setLogInlineFieldValue(
      nextLine,
      'tags',
      remainingInlineTags.map((tag) => `#${tag}`).join(', '),
    );
  }
  return nextLine;
}

export function updateKanbanInlineTaskPropertyText(
  line: string,
  propName: string,
  value: string | null,
  sourceLaneValues: string[] = [],
  configuredProperty: CustomProperty | null = null,
): string {
  const normalizedProp = normalizeKanbanInlinePropertyKey(propName);
  const normalizedValue = String(value ?? '').trim();
  if (normalizedProp === 'tags') {
    return updateKanbanInlineTaskTag(line, normalizedValue, sourceLaneValues);
  }

  if (configuredProperty?.type === 'list') {
    const current = readInlineFieldCarrierValues(line, configuredProperty.key).join(', ');
    let nextValues = readKanbanListValuesAfterRemoval(current, sourceLaneValues, configuredProperty);
    const removedLine = removeKanbanInlineTaskProperties(line, [configuredProperty.key]);
    if (normalizedValue) {
      const incomingIsEntity = propertyUsesEntityOptions(configuredProperty) && /^\s*\[\[/u.test(normalizedValue);
      nextValues = incomingIsEntity
        ? isLinkListProperty(configuredProperty)
          ? mergeEntityReferenceList(nextValues, normalizedValue)
          : mergeMixedEntityReferenceList(nextValues, normalizedValue)
        : isLinkListProperty(configuredProperty)
          ? mergeLinkList(nextValues, normalizedValue)
          : propertyUsesEntityOptions(configuredProperty)
            ? mergeMixedList(nextValues, normalizedValue)
            : mergeStringList(nextValues, normalizedValue);
    }
    if (!nextValues.length) return removedLine;
    return `${removedLine.replace(/\s+$/u, '')} [${configuredProperty.key}:: ${nextValues.join(', ')}]`;
  }

  // Remove every exact-key carrier with the balanced metadata parser. A flat
  // regular expression can leave malformed `]]` fragments or stale duplicate
  // scalar values behind.
  const withoutExisting = removeKanbanInlineTaskProperties(line, [propName]);
  if (!normalizedValue) return withoutExisting;
  return `${withoutExisting.replace(/\s+$/u, '')} [${propName}:: ${normalizedValue}]`;
}

function readKanbanListValuesAfterRemoval(
  current: string,
  sourceLaneValues: readonly string[],
  property: CustomProperty,
): string[] {
  let nextValues: string[] = mergeStringList([], current);
  for (const sourceValue of sourceLaneValues) {
    nextValues = propertyUsesEntityOptions(property)
      ? isLinkListProperty(property)
        ? removeEntityReferenceListValues(nextValues, sourceValue)
        : removeMixedEntityReferenceListValues(nextValues, sourceValue)
      : isLinkListProperty(property)
        ? removeLinkListValues(nextValues, sourceValue)
        : removeStringListValues(nextValues, sourceValue);
  }
  return nextValues;
}

/**
 * Remove persisted inline fields without treating field-shaped text inside a
 * closed inline-code span as metadata. Nested brackets in relational values
 * such as `[[Statuses/Working]]` remain balanced and are removed as one field.
 */
export function removeKanbanInlineTaskProperties(line: string, propNames: readonly string[]): string {
  const source = String(line ?? '');
  const targets = new Set(propNames
    .map(normalizeKanbanInlinePropertyKey)
    .filter(Boolean));
  if (!targets.size) return source;

  const codeRanges = readClosedInlineCodeRanges(source);
  const removalRanges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < source.length; index += 1) {
    const opener = source[index];
    if ((opener !== '[' && opener !== '(') || isInsideRange(index, codeRanges)) continue;
    const closer = opener === '[' ? ']' : ')';
    const separator = source.indexOf('::', index + 1);
    if (separator < 0) break;
    const firstCloser = source.indexOf(closer, index + 1);
    if (firstCloser >= 0 && firstCloser < separator) continue;
    const key = source.slice(index + 1, separator).trim();
    if (!targets.has(normalizeKanbanInlinePropertyKey(key))) continue;

    const stack = [closer];
    let cursor = separator + 2;
    for (; cursor < source.length && stack.length; cursor += 1) {
      const char = source[cursor];
      if (char === '[') stack.push(']');
      else if (char === '(') stack.push(')');
      else if (char === stack[stack.length - 1]) stack.pop();
    }
    if (stack.length) continue;
    let start = index;
    if (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) start -= 1;
    removalRanges.push({ start, end: cursor });
    index = cursor - 1;
  }
  if (!removalRanges.length) return source;

  let output = source;
  for (let index = removalRanges.length - 1; index >= 0; index -= 1) {
    const range = removalRanges[index];
    output = `${output.slice(0, range.start)}${output.slice(range.end)}`;
  }
  return output.trimEnd();
}

function readClosedInlineCodeRanges(source: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < source.length;) {
    if (source[index] !== '`') {
      index += 1;
      continue;
    }
    let runEnd = index;
    while (source[runEnd] === '`') runEnd += 1;
    const delimiter = source.slice(index, runEnd);
    const close = source.indexOf(delimiter, runEnd);
    if (close < 0) {
      index = runEnd;
      continue;
    }
    ranges.push({ start: index, end: close + delimiter.length });
    index = close + delimiter.length;
  }
  return ranges;
}

function isInsideRange(index: number, ranges: readonly { start: number; end: number }[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

export function buildKanbanTaskDropLine(options: BuildKanbanTaskDropLineOptions): string {
  const parsedLine = parseKanbanLineItem(options.line, true);
  if (!parsedLine) return String(options.line ?? '');
  const itemKind = parsedLine.itemKind;
  const normalizedProp = normalizeKanbanInlinePropertyKey(options.propName);
  let nextLine = String(options.line ?? '');
  let checkboxOwnsStatus = false;

  if (options.isStatusPropertyName(options.propName)) {
    if (itemKind !== 'bullet' && options.statusCheckboxState) {
      nextLine = replaceKanbanTaskLineCheckboxState(nextLine, options.statusCheckboxState);
      checkboxOwnsStatus = true;
    }
  } else if (normalizedProp === 'tags') {
    nextLine = updateKanbanInlineTaskPropertyText(
      nextLine,
      options.propName,
      options.value,
      options.sourceLaneValues ?? [],
      options.configuredProperty ?? null,
    );
  } else {
    nextLine = updateKanbanInlineTaskPropertyText(
      nextLine,
      options.propName,
      options.value,
      options.sourceLaneValues ?? [],
      options.configuredProperty ?? null,
    );
  }

  for (const tag of options.filterTags ?? []) {
    if (normalizedProp === 'tags' && normalizeKanbanTaskTag(String(options.value ?? '')) === tag) continue;
    nextLine = updateKanbanInlineTaskTag(nextLine, tag, []);
  }
  if (options.filterCheckboxState && itemKind !== 'bullet' && !options.isStatusPropertyName(options.propName)) {
    nextLine = replaceKanbanTaskLineCheckboxState(nextLine, options.filterCheckboxState);
    checkboxOwnsStatus = true;
  }
  if (checkboxOwnsStatus) {
    nextLine = removeKanbanInlineTaskProperties(nextLine, options.statusFieldKeysToRemove ?? []);
  }

  return nextLine;
}

function normalizeKanbanTaskTag(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('#') ? trimmed.toLowerCase() : `#${trimmed.toLowerCase()}`;
}
