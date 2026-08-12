import {
  findAfterFrontmatterIndex,
  getPlainTaskTitle,
  getTaskDisplayTitle,
  parseTaskLine,
  readInlineFieldValue,
  setInlineFieldValueOnTaskLine,
  setTaskCheckboxToken,
  stripTaskInlinePropsMetadata,
} from './task-line-metadata';
import { MIGRATED_TASK_CHECKBOX, MIGRATED_TO_FIELD } from '../constants/task-migration';

export interface ContentParts {
  lines: string[];
  newline: string;
  endsWithNewline: boolean;
}

export interface TaskBlock {
  lines: string[];
  startIndex: number;
  endExclusive: number;
}

export interface DailyNoteScratchpadMoveDetails {
  targetPath?: string;
  movedAt?: Date;
}

export function splitContent(content: string): ContentParts {
  const newline = content.match(/\r\n|\n|\r/u)?.[0] ?? '\n';
  const endsWithNewline = /(?:\r\n|\n|\r)$/u.test(content);
  const lines = content.split(/\r\n|\n|\r/u);
  if (endsWithNewline) lines.pop();
  return { lines, newline, endsWithNewline };
}

export function joinContent(lines: string[], newline: string, endsWithNewline: boolean): string {
  return `${lines.join(newline)}${endsWithNewline ? newline : ''}`;
}

export function findCurrentTaskLineIndex(lines: string[], preferredIndex: number, rawLine: string, title: string): number {
  const sourceRawLine = String(rawLine || '');
  if (sourceRawLine) {
    const exactMatches = findTaskLineIndexes(lines, (line) => line === sourceRawLine);
    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1) return -1;
  }

  let ambiguousIdentity = false;
  for (const key of ['tpsId', 'subitemId']) {
    const identity = readInlineFieldValue(sourceRawLine, key);
    if (!identity) continue;
    const identityMatches = findTaskLineIndexes(
      lines,
      (line) => readInlineFieldValue(line, key) === identity,
    );
    if (identityMatches.length === 1) return identityMatches[0];
    if (identityMatches.length > 1) ambiguousIdentity = true;
  }
  if (ambiguousIdentity) return -1;

  // Calendar rows can remain mounted while non-identity metadata on the task
  // line changes (for example an automatic modified timestamp). Re-resolve a
  // repeated-title task by its authored calendar locator before falling back
  // to title-only matching. Every populated locator must still match and the
  // result must be unique, so a moved/rescheduled or duplicated task fails
  // closed instead of receiving the mutation.
  const calendarIdentity = ['scheduled', 'start', 'date']
    .map((key) => [key, readInlineFieldValue(sourceRawLine, key)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
  if (calendarIdentity.length > 0) {
    const calendarMatches = findTaskLineIndexes(
      lines,
      (line) => calendarIdentity.every(([key, value]) => readInlineFieldValue(line, key) === value),
    );
    if (calendarMatches.length === 1) return calendarMatches[0];
    if (calendarMatches.length > 1) return -1;
  }

  const normalizedTitle = normalizeTaskText(getPlainTaskTitle(title));
  if (!normalizedTitle) return -1;
  const titleMatches = findTaskLineIndexes(
    lines,
    (line) => normalizeTaskText(getTaskDisplayTitle(line)) === normalizedTitle,
  );
  return titleMatches.length === 1 ? titleMatches[0] : -1;
}

export function extractTaskBlock(lines: string[], startIndex: number): TaskBlock {
  const sourceLine = lines[startIndex] || '';
  const parsed = parseTaskLine(sourceLine);
  if (!parsed) return { lines: [], startIndex, endExclusive: startIndex };
  const sourceIndent = getIndentWidth(sourceLine);
  let end = startIndex + 1;
  while (end < lines.length) {
    const line = lines[end] || '';
    if (!line.trim()) {
      const nextNonBlank = findNextNonBlank(lines, end + 1);
      if (nextNonBlank >= 0 && getIndentWidth(lines[nextNonBlank] || '') > sourceIndent) {
        end += 1;
        continue;
      }
      break;
    }
    if (getIndentWidth(line) > sourceIndent) {
      end += 1;
      continue;
    }
    break;
  }
  return { lines: lines.slice(startIndex, end), startIndex, endExclusive: end };
}

export function insertTaskBlockAfterFrontmatter(content: string, blockLines: string[]): { content: string; lineIndex: number } {
  const parts = splitContent(content);
  const cleanBlock = normalizeBlockLines(blockLines);
  if (!cleanBlock.length) return { content, lineIndex: -1 };
  const nextLines = [...parts.lines];
  const lineIndex = findAfterFrontmatterIndex(nextLines);
  nextLines.splice(lineIndex, 0, ...cleanBlock);
  return {
    content: joinContent(nextLines, parts.newline, true),
    lineIndex,
  };
}

export function insertTaskBlockAtEnd(content: string, blockLines: string[]): { content: string; lineIndex: number } {
  const parts = splitContent(content);
  const cleanBlock = normalizeBlockLines(blockLines);
  if (!cleanBlock.length) return { content, lineIndex: -1 };
  const nextLines = [...parts.lines];
  while (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() === '') nextLines.pop();
  const lineIndex = nextLines.length;
  nextLines.push(...cleanBlock);
  return {
    content: joinContent(nextLines, parts.newline, true),
    lineIndex,
  };
}

export function removeTaskBlockFromContent(
  content: string,
  preferredIndex: number,
  rawLine: string,
  title: string,
): { content: string; changed: boolean; block: TaskBlock; lineIndex: number } {
  const parts = splitContent(content);
  const lineIndex = findCurrentTaskLineIndex(parts.lines, preferredIndex, rawLine, title);
  if (lineIndex < 0 || !parseTaskLine(parts.lines[lineIndex] || '')) {
    return { content, changed: false, block: { lines: [], startIndex: lineIndex, endExclusive: lineIndex }, lineIndex };
  }
  const block = extractTaskBlock(parts.lines, lineIndex);
  if (!block.lines.length) return { content, changed: false, block, lineIndex };
  const nextLines = [...parts.lines];
  nextLines.splice(lineIndex, block.endExclusive - lineIndex);
  return {
    content: joinContent(nextLines, parts.newline, parts.endsWithNewline),
    changed: true,
    block,
    lineIndex,
  };
}

export function replaceTaskBlockInContent(
  content: string,
  preferredIndex: number,
  rawLine: string,
  title: string,
  replacementLines: string[],
): { content: string; changed: boolean; lineIndex: number } {
  const parts = splitContent(content);
  const lineIndex = findCurrentTaskLineIndex(parts.lines, preferredIndex, rawLine, title);
  if (lineIndex < 0 || !parseTaskLine(parts.lines[lineIndex] || '')) {
    return { content, changed: false, lineIndex };
  }
  const block = extractTaskBlock(parts.lines, lineIndex);
  if (!block.lines.length) return { content, changed: false, lineIndex };
  const nextLines = [...parts.lines];
  nextLines.splice(lineIndex, block.endExclusive - lineIndex, ...normalizeBlockLines(replacementLines));
  return {
    content: joinContent(nextLines, parts.newline, parts.endsWithNewline),
    changed: true,
    lineIndex,
  };
}

export function buildDailyNoteScratchpadMovedTaskBlock(
  blockLines: string[],
  details: DailyNoteScratchpadMoveDetails = {},
): string[] {
  const cleanBlock = normalizeBlockLines(blockLines);
  if (!cleanBlock.length) return cleanBlock;
  const scratchpadBlock = cleanBlock.map((line) => stripMovedTaskIdentity(line));
  const migratedLine = setInlineFieldValueOnTaskLine(
    setTaskCheckboxToken(scratchpadBlock[0], MIGRATED_TASK_CHECKBOX),
    MIGRATED_TO_FIELD,
    buildMigratedToLink(details.targetPath),
  );
  return [
    migratedLine,
    ...scratchpadBlock.slice(1),
  ];
}

export function getIndentWidth(line: string): number {
  return String(line || '').match(/^[\t ]*/)?.[0].replace(/\t/g, '    ').length ?? 0;
}

function normalizeBlockLines(lines: string[]): string[] {
  const next = [...lines];
  while (next.length > 0 && !next[0].trim()) next.shift();
  while (next.length > 0 && !next[next.length - 1].trim()) next.pop();
  return next;
}

function findNextNonBlank(lines: string[], startIndex: number): number {
  for (let i = startIndex; i < lines.length; i += 1) {
    if ((lines[i] || '').trim()) return i;
  }
  return -1;
}

function normalizeTaskText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function findTaskLineIndexes(lines: string[], predicate: (line: string, index: number) => boolean): number[] {
  const matches: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    if (parseTaskLine(line) && predicate(line, index)) matches.push(index);
  }
  return matches;
}

function stripMovedTaskIdentity(line: string): string {
  let next = stripTaskInlinePropsMetadata(line);
  if (!parseTaskLine(next)) return next;
  next = setInlineFieldValueOnTaskLine(next, 'tpsId', null);
  next = setInlineFieldValueOnTaskLine(next, 'subitemId', null);
  return next;
}

function buildMigratedToLink(targetPath?: string): string {
  const cleanTargetPath = String(targetPath || 'another file').trim() || 'another file';
  return `[[${cleanTargetPath.replace(/\.md$/i, '')}]]`;
}
