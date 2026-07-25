import { replaceLeadingLinkDisplayTitle } from '../utils/display-title';
import { parseStringListInput } from '../utils/list-utils';
import { normalizeTagValue } from '../utils/tag-utils';
import {
  preserveTpsInlinePropsMetadata,
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
  const pattern = /\[([A-Za-z0-9_-]+)::\s*(\[\[[^\]]+\]\]|[^\]]*?)\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    fields[normalizeInlineKey(match[1])] = match[2].trim();
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

export function visibleLineText(line: string): string {
  return stripTaskInlinePropsMetadata(String(line || ''))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*[-*+]\s+(?:\[[^\]\r\n]{0,2}\]\s+)?/, '')
    .replace(/\[[A-Za-z0-9_-]+::\s*(?:\[\[[^\]]+\]\]|[^\]]*?)\]/g, '')
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
  const fields = Array.from(outsideComment.matchAll(/\[[A-Za-z0-9_-]+::\s*(?:\[\[[^\]]+\]\]|[^\]]*?)\]/g), (match) => match[0]);
  const currentVisibleTitle = outsideComment
    .replace(/\[[A-Za-z0-9_-]+::\s*(?:\[\[[^\]]+\]\]|[^\]]*?)\]/g, '')
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
