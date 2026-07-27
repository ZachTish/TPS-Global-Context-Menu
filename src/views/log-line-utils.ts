import { replaceLeadingLinkDisplayTitle } from '../utils/display-title';
import { parseStringListInput } from '../utils/list-utils';
import { normalizeTagValue } from '../utils/tag-utils';
import {
  preserveTpsInlinePropsMetadata,
  readInlineFieldRanges,
  readTaskInlineFields,
  stripTaskInlinePropsMetadata,
} from '../utils/task-line-metadata';

export interface LogLineReference {
  lineNumber: number;
  line: string;
  fields: Record<string, string>;
}

export function normalizeInlineKey(key: string): string {
  return String(key || '').replace(/^note\./, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

export function readInlineFields(line: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of readTaskInlineFields(line)) {
    const key = normalizeInlineKey(field.key);
    if (key) fields[key] = field.value.trim();
  }
  return fields;
}

export function readLogLineTags(raw: unknown): string[] {
  return Array.from(new Set(
    parseStringListInput(raw)
      .map((tag) => normalizeTagValue(tag))
      .filter(Boolean),
  ));
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

export function setLogInlineFieldValue(
  line: string,
  key: string,
  value: string | null,
): string {
  const source = String(line || '');
  const cleanKey = String(key || '').replace(/^note\./u, '').trim();
  if (!cleanKey) return source;
  const normalizedKey = cleanKey.toLocaleLowerCase();
  const indentation = source.match(/^[\t ]*/u)?.[0] || '';
  let withoutExisting = source;
  const matchingRanges = readInlineFieldRanges(source)
    .filter((field) => field.key.toLocaleLowerCase() === normalizedKey)
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

  let body = withoutExisting.slice(indentation.length)
    .replace(/[ \t]*<!--[ \t]*-->[ \t]*/gu, ' ')
    .replace(/[ \t]+(?=-->)/gu, ' ')
    .trimEnd();
  if (value === null) return `${indentation}${body}`;

  const nextField = `[${cleanKey}:: ${String(value || '').trim()}]`;
  const trailingComment = body.match(/<!--([\s\S]*?)-->[ \t]*$/u);
  if (trailingComment) {
    body = body.replace(
      /<!--([\s\S]*?)-->[ \t]*$/u,
      (_match, commentBody: string) =>
        `<!--${commentBody.trimEnd()} ${nextField} -->`,
    );
  } else {
    body = `${body} <!-- ${nextField} -->`;
  }
  return `${indentation}${body}`;
}

export function visibleLineText(line: string): string {
  const withoutHiddenMetadata = stripTaskInlinePropsMetadata(String(line || ''))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*[-*+]\s+(?:\[[^\]\r\n]{0,2}\]\s+)?/, '');
  return removeInlineFields(withoutHiddenMetadata)
    .replace(/\s+/g, ' ')
    .trim();
}

export function setVisibleLineText(line: string, title: string): string {
  const raw = String(line || '');
  const visibleRaw = stripTaskInlinePropsMetadata(raw);
  const prefixMatch = visibleRaw.match(/^(\s*(?:[-*+]\s+|\d+[.)]\s+)(?:\[[^\]\r\n]{0,2}\]\s+)?)/);
  const prefix = prefixMatch?.[1] ?? '- ';
  const body = prefixMatch ? visibleRaw.slice(prefix.length) : visibleRaw;
  const commentIndex = body.indexOf('<!--');
  const outsideComment = commentIndex >= 0 ? body.slice(0, commentIndex) : body;
  const comment = commentIndex >= 0 ? body.slice(commentIndex).trim() : '';
  const fields = readInlineFieldRanges(outsideComment)
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
  const ranges = readInlineFieldRanges(source);
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
  if (entry.line && lines[entry.lineNumber] === entry.line) return entry.lineNumber;
  const identity = getLogEntryStableIdentity(entry);
  if (!identity) return -1;
  const matches = lines.reduce<number[]>((indexes, line, index) => {
    if (readInlineFields(line)[identity.key] === identity.value) indexes.push(index);
    return indexes;
  }, []);
  return matches.length === 1 ? matches[0] : -1;
}
