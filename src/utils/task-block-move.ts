import {
  findAfterFrontmatterIndex,
  getTaskDisplayTitle,
  parseTaskLine,
  setInlineFieldValueOnTaskLine,
  setTaskCheckboxToken,
  setTaskTitle,
} from './task-line-metadata';

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
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const endsWithNewline = /\r?\n$/.test(content);
  const lines = content.split(/\r?\n/);
  if (endsWithNewline) lines.pop();
  return { lines, newline, endsWithNewline };
}

export function joinContent(lines: string[], newline: string, endsWithNewline: boolean): string {
  return `${lines.join(newline)}${endsWithNewline ? newline : ''}`;
}

export function findCurrentTaskLineIndex(lines: string[], preferredIndex: number, rawLine: string, title: string): number {
  if (preferredIndex >= 0 && parseTaskLine(lines[preferredIndex] || '')) {
    if (!rawLine || lines[preferredIndex] === rawLine) return preferredIndex;
  }
  if (rawLine) {
    const exact = lines.findIndex((line) => line === rawLine);
    if (exact >= 0 && parseTaskLine(lines[exact] || '')) return exact;
  }
  const normalizedTitle = normalizeTaskText(title);
  if (!normalizedTitle) return -1;
  return lines.findIndex((line) => {
    if (!parseTaskLine(line || '')) return false;
    return normalizeTaskText(getTaskDisplayTitle(line || '')) === normalizedTitle;
  });
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
  const insertIndex = findAfterFrontmatterIndex(parts.lines);
  const before = parts.lines.slice(0, insertIndex);
  const after = parts.lines.slice(insertIndex);
  while (after.length > 0 && after[0].trim() === '') after.shift();
  const lineIndex = before.length > 0 ? before.length + 1 : 0;
  const nextLines = before.length > 0
    ? [...before, '', ...cleanBlock, ...(after.length > 0 ? ['', ...after] : [])]
    : [...cleanBlock, ...(after.length > 0 ? ['', ...after] : [])];
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
  return [
    setInlineFieldValueOnTaskLine(setTaskCheckboxToken(strikeThroughTaskLine(cleanBlock[0]), '[x]'), 'completedDate', 'null'),
    ...cleanBlock.slice(1).map(strikeThroughTaskBlockLine),
    buildMovedCommentLine(cleanBlock[0], details),
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

function strikeThroughTaskBlockLine(line: string): string {
  if (!String(line || '').trim()) return line;
  if (parseTaskLine(line)) return strikeThroughTaskLine(line);
  const indent = String(line || '').match(/^[\t ]*/)?.[0] ?? '';
  const body = String(line || '').slice(indent.length).trimEnd();
  if (!body.trim()) return line;
  return `${indent}${strikeThroughText(body)}`;
}

function strikeThroughTaskLine(line: string): string {
  const title = getTaskDisplayTitle(line);
  if (!title) return line;
  return setTaskTitle(line, strikeThroughText(title));
}

function strikeThroughText(text: string): string {
  const value = String(text || '').trim();
  if (!value) return text;
  if (value.startsWith('~~') && value.endsWith('~~')) return value;
  return `~~${value}~~`;
}

function buildMovedCommentLine(sourceLine: string, details: DailyNoteScratchpadMoveDetails): string {
  const indent = String(sourceLine || '').match(/^[\t ]*/)?.[0] ?? '';
  const targetPath = String(details.targetPath || 'another file').trim() || 'another file';
  const movedAt = formatMoveTimestamp(details.movedAt instanceof Date ? details.movedAt : new Date());
  return `${indent}%% Moved to ${targetPath} on ${movedAt} %%`;
}

function formatMoveTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(' ');
}
