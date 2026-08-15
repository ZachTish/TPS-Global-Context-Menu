import { replaceLeadingLinkDisplayTitle } from '../utils/display-title';
import { splitLineItemContent } from '../utils/line-item-deletion';
import { normalizeTagValue } from '../utils/tag-utils';
import { normalizePropertyKeyIdentity } from '../utils/property-key-identity';
import {
  appendLineBlockId,
  parseTaskTagValues,
  preserveTpsInlinePropsMetadata,
  readLineBlockId,
  readSemanticInlineFieldRanges,
  readTaskLineTags,
  readTaskInlineFields,
  removeInlineTagFromTaskLine,
  stripLineBlockId,
  stripTaskInlinePropsMetadata,
} from '../utils/task-line-metadata';

export interface LogLineReference {
  lineNumber: number;
  line: string;
  fields: Record<string, string>;
}

export interface LogLineContentMutation {
  content: string;
  outcome: 'changed' | 'unchanged' | 'stale';
  lineNumber: number;
}

export function normalizeInlineKey(key: string): string {
  return normalizePropertyKeyIdentity(String(key || '').replace(/^note\./iu, ''));
}

export function readInlineFields(line: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of readTaskInlineFields(line)) {
    const key = normalizePropertyKeyIdentity(field.key);
    if (key) fields[key] = field.value.trim();
  }
  return fields;
}

/**
 * Preserve every authored carrier for list-aware Table display, sorting, and
 * grouping. Scalar callers continue to use `readInlineFields`, whose
 * last-authored value remains the compatibility contract.
 */
export function readInlineFieldValues(line: string): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const field of readTaskInlineFields(line)) {
    const key = normalizePropertyKeyIdentity(field.key);
    if (!key) continue;
    const values = fields[key] ?? [];
    values.push(field.value.trim());
    fields[key] = values;
  }
  return fields;
}

/** Return every authored carrier for one case-insensitive inline property. */
export function readInlineFieldCarrierValues(line: string, key: string): string[] {
  return readInlineFieldValues(line)[normalizePropertyKeyIdentity(key)] ?? [];
}

export function readLogLineTags(raw: unknown): string[] {
  return parseTaskTagValues(raw)
    .map((tag) => normalizeTagValue(tag))
    .filter(Boolean);
}

/**
 * Resolve the value shown by a tag-like Base cell. The built-in `tag` and
 * `tags` columns represent the task's complete semantic tag set, which may be
 * split between visible hashtags and singular/plural inline carriers. Custom
 * tag fields remain isolated to their configured value.
 */
export function readLogLinePropertyTags(
  line: string,
  key: string,
  rawValue: unknown,
): string[] {
  return /^(?:tag|tags)$/iu.test(normalizeInlineKey(key))
    ? readTaskLineTags(line)
    : readLogLineTags(rawValue);
}

export function addLogLineTag(raw: unknown, tag: string): string {
  const normalized = normalizeTagValue(tag);
  const tags = readLogLineTags(raw);
  if (normalized && !tags.includes(normalized)) tags.push(normalized);
  return tags.map((value) => `#${value}`).join(', ');
}

export function removeLogLineTag(raw: unknown, tag: string): string | null {
  const normalized = normalizeTagValue(tag);
  const tags = readLogLineTags(raw).filter((value) => value !== normalized);
  return tags.length > 0 ? tags.map((value) => `#${value}`).join(', ') : null;
}

/**
 * Toggle one semantic task tag while keeping raw hashtags and [tag(s)::]
 * fields in sync. Replacing only the inline field is insufficient when the
 * selected value also exists as a raw hashtag because the task parser would
 * immediately surface that tag again.
 */
export function toggleLogLineSemanticTag(
  line: string,
  key: string,
  tag: string,
  selected: boolean,
): string {
  const normalized = normalizeTagValue(tag);
  if (!normalized) return String(line || '');
  const current = readTaskLineTags(line);
  const nextTags = selected
    ? current.filter((value) => value.toLocaleLowerCase() !== normalized)
    : Array.from(new Set([...current, normalized]));
  const withoutSelectedRawTag = selected
    ? removeInlineTagFromTaskLine(line, normalized)
    : line;
  const withoutSingularCarrier = setLogInlineFieldValue(
    withoutSelectedRawTag,
    'tag',
    null,
  );
  const withoutPluralCarrier = setLogInlineFieldValue(
    withoutSingularCarrier,
    'tags',
    null,
  );
  const canonicalKey = normalizeInlineKey(key) === 'tag' ? 'tag' : 'tags';
  return setLogInlineFieldValue(
    withoutPluralCarrier,
    canonicalKey,
    nextTags.length > 0 ? nextTags.map((value) => `#${value}`).join(', ') : null,
  );
}

/** Add a normalized multi-tag entry while emitting one final line value. */
export function addLogLineSemanticTags(
  line: string,
  key: string,
  rawTags: unknown,
): string {
  return parseTaskTagValues(rawTags).reduce(
    (nextLine, tag) => toggleLogLineSemanticTag(nextLine, key, tag, false),
    String(line || ''),
  );
}

export function setLogInlineFieldValue(
  line: string,
  key: string,
  value: string | null,
): string {
  const blockId = readLineBlockId(line);
  const source = blockId ? stripLineBlockId(line) : String(line || '');
  const cleanKey = String(key || '').replace(/^note\./u, '').trim();
  if (!cleanKey) return String(line || '');
  const normalizedKey = normalizePropertyKeyIdentity(cleanKey);
  const indentation = source.match(/^[\t ]*/u)?.[0] || '';
  let withoutExisting = source;
  const matchingFields = readSemanticInlineFieldRanges(source)
    .filter((field) => normalizePropertyKeyIdentity(field.key) === normalizedKey);
  const matchingRanges = collapseEmptiedInlineFieldComments(source, matchingFields)
    .sort((left, right) => right.start - left.start);
  for (const range of matchingRanges) {
    let end = range.end;
    if (
      range.start > indentation.length
      && /[ \t]/u.test(withoutExisting[range.start - 1] || '')
      && /[ \t]/u.test(withoutExisting[end] || '')
    ) {
      end += 1;
    }
    withoutExisting = `${withoutExisting.slice(0, range.start)}${withoutExisting.slice(end)}`;
  }

  let body = withoutExisting.slice(indentation.length).trimEnd();
  if (value === null) {
    const updated = `${indentation}${body}`;
    return blockId ? appendLineBlockId(updated, blockId) : updated;
  }

  const nextField = `[${cleanKey}:: ${String(value || '').trim()}]`;
  const trailingComment = body.match(/<!--([\s\S]*?)-->[ \t]*$/u);
  if (trailingComment && isInlineFieldOnlyComment(trailingComment[1] || '')) {
    body = body.replace(
      /<!--([\s\S]*?)-->[ \t]*$/u,
      (_match, commentBody: string) =>
        `<!--${commentBody.trimEnd()} ${nextField} -->`,
    );
  } else {
    body = `${body} <!-- ${nextField} -->`;
  }
  const updated = `${indentation}${body}`;
  return blockId ? appendLineBlockId(updated, blockId) : updated;
}

export function visibleLineText(line: string): string {
  const withoutHiddenMetadata = stripLineBlockId(
    stripTaskInlinePropsMetadata(String(line || '')),
  )
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*[-*+]\s+(?:\[[^\]\r\n]{0,2}\]\s+)?/, '');
  return removeInlineFields(withoutHiddenMetadata)
    .replace(/\s+/g, ' ')
    .trim();
}

export function setVisibleLineText(line: string, title: string): string {
  const raw = String(line || '');
  const visibleRaw = stripLineBlockId(stripTaskInlinePropsMetadata(raw));
  const prefixMatch = visibleRaw.match(/^(\s*(?:[-*+]\s+|\d+[.)]\s+)(?:\[[^\]\r\n]{0,2}\]\s+)?)/);
  const prefix = prefixMatch?.[1] ?? '- ';
  const body = prefixMatch ? visibleRaw.slice(prefix.length) : visibleRaw;
  const commentIndex = body.indexOf('<!--');
  const outsideComment = commentIndex >= 0 ? body.slice(0, commentIndex) : body;
  const comment = commentIndex >= 0 ? body.slice(commentIndex).trim() : '';
  const fields = readSemanticInlineFieldRanges(outsideComment)
    .map((field) => outsideComment.slice(field.start, field.end));
  const currentVisibleTitle = removeInlineFields(outsideComment)
    .replace(/\s+/g, ' ')
    .trim();
  const nextVisibleTitle = replaceLeadingLinkDisplayTitle(currentVisibleTitle, title);
  const edited = [
    `${prefix}${nextVisibleTitle}`.trimEnd(),
    ...fields,
    comment,
  ].filter(Boolean).join(' ');
  return preserveTpsInlinePropsMetadata(raw, edited);
}

function removeInlineFields(source: string): string {
  const ranges = readSemanticInlineFieldRanges(source);
  if (ranges.length === 0) return source;
  let result = source;
  for (const range of [...ranges].sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, range.start)}${result.slice(range.end)}`;
  }
  return result;
}

export function getLogEntryStableIdentity(entry: Pick<LogLineReference, 'fields'>): { key: string; value: string } | null {
  for (const key of ['foodid', 'setid', 'tpsid', 'logid', 'workoutid', 'financeid']) {
    const value = String(entry.fields[key] || '').trim();
    if (value) return { key, value };
  }
  return null;
}

export function resolveEntryLineNumber(lines: string[], entry: LogLineReference): number {
  if (entry.line) {
    const exactMatches = lines.reduce<number[]>((indexes, line, index) => {
      if (line === entry.line) indexes.push(index);
      return indexes;
    }, []);
    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1) return -1;
  }
  const identity = getLogEntryStableIdentity(entry);
  if (!identity) return -1;
  const matches = lines.reduce<number[]>((indexes, line, index) => {
    if (readInlineFields(line)[identity.key] === identity.value) indexes.push(index);
    return indexes;
  }, []);
  return matches.length === 1 ? matches[0] : -1;
}

/**
 * Apply one stale-safe row mutation without changing the note's newline style
 * or final-newline state.
 */
export function mutateLogLineContent(
  content: string,
  entry: LogLineReference,
  updater: (line: string) => string | null,
): LogLineContentMutation {
  const parts = splitLineItemContent(content);
  const lineNumber = resolveEntryLineNumber(parts.lines, entry);
  if (lineNumber < 0) {
    return { content, outcome: 'stale', lineNumber: -1 };
  }
  const current = parts.lines[lineNumber] ?? '';
  const nextLine = updater(current);
  if (nextLine === current) {
    return { content, outcome: 'unchanged', lineNumber };
  }
  if (nextLine === null) parts.lines.splice(lineNumber, 1);
  else parts.lines[lineNumber] = nextLine;
  return {
    content: `${parts.lines.join(parts.newline)}${parts.endsWithNewline ? parts.newline : ''}`,
    outcome: 'changed',
    lineNumber,
  };
}

function isInlineFieldOnlyComment(commentBody: string): boolean {
  let remainder = String(commentBody || '');
  const ranges = readSemanticInlineFieldRanges(remainder)
    .sort((left, right) => right.start - left.start);
  if (ranges.length === 0) return false;
  for (const range of ranges) {
    remainder = `${remainder.slice(0, range.start)}${remainder.slice(range.end)}`;
  }
  return remainder.trim().length === 0;
}

function collapseEmptiedInlineFieldComments<T extends { start: number; end: number }>(
  source: string,
  matchingFields: readonly T[],
): Array<{ start: number; end: number }> {
  const covered = new Set<T>();
  const ranges: Array<{ start: number; end: number }> = [];
  const comments = /<!--([\s\S]*?)-->/gu;
  let comment: RegExpExecArray | null;
  while ((comment = comments.exec(source)) !== null) {
    const start = comment.index;
    const end = start + String(comment[0] || '').length;
    const contained = matchingFields.filter(
      (field) => field.start >= start && field.end <= end,
    );
    if (contained.length === 0) continue;
    let remainder = String(comment[1] || '');
    const bodyStart = start + 4;
    for (const field of [...contained].sort((left, right) => right.start - left.start)) {
      const localStart = field.start - bodyStart;
      const localEnd = field.end - bodyStart;
      remainder = `${remainder.slice(0, localStart)}${remainder.slice(localEnd)}`;
    }
    if (remainder.trim()) continue;
    contained.forEach((field) => covered.add(field));
    ranges.push({ start, end });
  }
  for (const field of matchingFields) {
    if (!covered.has(field)) ranges.push({ start: field.start, end: field.end });
  }
  return ranges;
}
