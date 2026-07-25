import { getMarkdownIndentColumns } from '../tps-list/tps-list-hierarchy';
import { parseTpsListHeadingLine, type TpsListHeadingLevel } from '../tps-list/heading-line-utils';
import { mergeTpsInlinePropsMetadata } from '../utils/task-line-metadata';

export type HomeCaptureInsertPosition = 'top' | 'bottom';

export interface HomeCaptureBlockOptions {
  insertPosition?: HomeCaptureInsertPosition;
  addHeading?: boolean;
  heading?: string;
}

export interface HomeCaptureFormatOptions {
  task?: boolean;
}

export interface HomeCaptureHeadingTarget {
  line: number;
  level: TpsListHeadingLevel;
  text: string;
  occurrence: number;
  matchingCount: number;
}

export interface HomeCaptureHeadingInsertionResult {
  content: string;
  headingLine: number;
  headingLevel: TpsListHeadingLevel;
}

export interface HomeCapturePreparedDraft {
  content: string;
  startLine: number;
  startOffset: number;
}

export interface HomeCaptureResolvedDraftRange {
  from: number;
  to: number;
}

export interface HomeCaptureLineRange {
  from: number;
  to: number;
}

export interface HomeCaptureRangeSnapshot {
  prefix: string;
  value: string;
  suffix: string;
}

export function formatHomeCaptureBlock(text: string, timeLabel: string, options: HomeCaptureFormatOptions = {}): string {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length === 0) return '';
  const contentLines = lines.filter((line) => line.trim());
  if (contentLines.length === 0) return '';
  const rootIndent = Math.min(...contentLines.map(getMarkdownIndentColumns));
  const marker = options.task === true ? '- [ ] ' : '- ';
  const createdDate = String(timeLabel || '').trim();
  const formatted = lines.map((line) => {
    if (!line.trim()) return '';
    const dedented = removeMarkdownIndentColumns(line, rootIndent).trimEnd();
    if (getMarkdownIndentColumns(dedented) > 0) return `  ${dedented}`;
    const rootLine = `${marker}${dedented}`;
    return createdDate
      ? mergeTpsInlinePropsMetadata(rootLine, { createdDate })
      : rootLine;
  });
  return `${formatted.join('\n')}\n`;
}

function removeMarkdownIndentColumns(line: string, columnsToRemove: number): string {
  if (columnsToRemove <= 0) return line;
  let index = 0;
  let columns = 0;
  while (index < line.length && columns < columnsToRemove && (line[index] === ' ' || line[index] === '\t')) {
    const nextColumns = line[index] === '\t' ? columns + (4 - (columns % 4)) : columns + 1;
    index += 1;
    if (nextColumns > columnsToRemove) {
      return `${' '.repeat(nextColumns - columnsToRemove)}${line.slice(index)}`;
    }
    columns = nextColumns;
  }
  return line.slice(index);
}

export function insertHomeCaptureBlock(content: string, block: string, options: HomeCaptureBlockOptions = {}): string {
  const position = options.insertPosition === 'top' ? 'top' : 'bottom';
  if (options.addHeading === true) {
    const heading = String(options.heading || 'Capture').trim() || 'Capture';
    return insertUnderHeading(content, heading, block, position);
  }
  return insertAtNotePosition(content, block, position);
}

export function listHomeCaptureHeadings(content: string): HomeCaptureHeadingTarget[] {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
  const headings: Array<Omit<HomeCaptureHeadingTarget, 'occurrence' | 'matchingCount'>> = [];
  let inFrontmatter = lines[0]?.trim() === '---';
  let fence: { marker: '`' | '~'; length: number } | null = null;

  for (let line = 0; line < lines.length; line += 1) {
    const sourceLine = lines[line] || '';
    if (inFrontmatter) {
      if (line > 0 && sourceLine.trim() === '---') inFrontmatter = false;
      continue;
    }
    if (fence) {
      if (isClosingMarkdownFence(sourceLine, fence)) fence = null;
      continue;
    }
    const openingFence = parseOpeningMarkdownFence(sourceLine);
    if (openingFence) {
      fence = openingFence;
      continue;
    }
    const parsed = parseTpsListHeadingLine(sourceLine);
    if (!parsed) continue;
    headings.push({ line, level: parsed.headingLevel, text: parsed.text });
  }

  const totals = new Map<string, number>();
  for (const heading of headings) {
    const key = getCaptureHeadingIdentity(heading.level, heading.text);
    totals.set(key, (totals.get(key) || 0) + 1);
  }
  const seen = new Map<string, number>();
  return headings.map((heading) => {
    const key = getCaptureHeadingIdentity(heading.level, heading.text);
    const occurrence = seen.get(key) || 0;
    seen.set(key, occurrence + 1);
    return {
      ...heading,
      occurrence,
      matchingCount: totals.get(key) || 1,
    };
  });
}

export function insertHomeCaptureBlockUnderHeading(
  content: string,
  block: string,
  target: HomeCaptureHeadingTarget,
  position: HomeCaptureInsertPosition = 'bottom',
): HomeCaptureHeadingInsertionResult | null {
  const cleanBlock = String(block || '').trimEnd();
  if (!cleanBlock) return null;
  const headings = listHomeCaptureHeadings(content);
  const matches = headings.filter((heading) => (
    heading.level === target.level && heading.text === target.text
  ));
  if (matches.length !== target.matchingCount) return null;
  const resolved = matches[target.occurrence];
  if (!resolved) return null;
  if (target.matchingCount > 1 && resolved.line !== target.line) return null;

  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
  const nextBoundary = headings.find((heading) => (
    heading.line > resolved.line && heading.level <= resolved.level
  ));
  const sectionEnd = nextBoundary?.line ?? lines.length;
  let insertAt = position === 'top' ? resolved.line + 1 : sectionEnd;
  if (position === 'top') {
    while (insertAt < sectionEnd && !lines[insertAt]?.trim()) insertAt += 1;
  } else {
    while (insertAt > resolved.line + 1 && !lines[insertAt - 1]?.trim()) insertAt -= 1;
  }
  const blockLines = cleanBlock.split('\n');
  const previousLine = lines[insertAt - 1] || '';
  const nextLine = lines[insertAt] || '';
  const leadingGap = shouldSeparateMarkdownBlocks(previousLine, blockLines[0] || '') ? [''] : [];
  const trailingGap = shouldSeparateMarkdownBlocks(blockLines[blockLines.length - 1] || '', nextLine) ? [''] : [];
  lines.splice(insertAt, 0, ...leadingGap, ...blockLines, ...trailingGap);
  return {
    content: `${lines.join('\n').replace(/\s+$/u, '')}\n`,
    headingLine: resolved.line,
    headingLevel: resolved.level,
  };
}

export function prepareHomeCaptureDraft(
  content: string,
  insertPosition: HomeCaptureInsertPosition = 'bottom',
): HomeCapturePreparedDraft {
  const normalized = String(content || '').replace(/\r\n?/g, '\n');
  if (insertPosition !== 'top') {
    const next = normalized && !normalized.endsWith('\n') ? `${normalized}\n` : normalized;
    const lines = next.split('\n');
    return {
      content: next,
      startLine: Math.max(0, lines.length - 1),
      startOffset: next.length,
    };
  }

  const lines = normalized.split('\n');
  const hasFrontmatter = lines[0]?.trim() === '---';
  const frontmatterEnd = hasFrontmatter
    ? lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    : -1;
  const blankRunStart = frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0;
  let blankRunEnd = blankRunStart;
  while (blankRunEnd < lines.length && lines[blankRunEnd] === '') blankRunEnd += 1;

  const requiredBlankLines = frontmatterEnd >= 0 ? 3 : 2;
  const existingBlankLines = blankRunEnd - blankRunStart;
  if (existingBlankLines < requiredBlankLines) {
    lines.splice(blankRunEnd, 0, ...Array(requiredBlankLines - existingBlankLines).fill(''));
  }

  const startLine = frontmatterEnd >= 0 ? blankRunStart + 1 : blankRunStart;
  const next = lines.join('\n');
  return {
    content: next,
    startLine,
    startOffset: offsetForLine(lines, startLine),
  };
}

export function resolveHomeCaptureDraftRange(
  content: string,
  startLine: number,
  value: string,
): HomeCaptureResolvedDraftRange | null {
  const normalized = String(content || '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (!Number.isInteger(startLine) || startLine < 0 || startLine >= lines.length) return null;
  const from = offsetForLine(lines, startLine);
  const captureValue = String(value || '');
  if (!captureValue && lines[startLine] !== '') return null;
  if (normalized.slice(from, from + captureValue.length) !== captureValue) return null;
  const to = from + captureValue.length;
  if (to < normalized.length && normalized[to] !== '\n') return null;
  return { from, to };
}

export function createHomeCaptureRangeSnapshot(
  content: string,
  from: number,
  to: number,
): HomeCaptureRangeSnapshot {
  const safeFrom = Math.max(0, Math.min(Math.trunc(from), content.length));
  const safeTo = Math.max(safeFrom, Math.min(Math.trunc(to), content.length));
  return {
    prefix: content.slice(0, safeFrom),
    value: content.slice(safeFrom, safeTo),
    suffix: content.slice(safeTo),
  };
}

export function resolveHomeCaptureLineRange(content: string, zeroBasedLine: number): HomeCaptureLineRange | null {
  if (!Number.isInteger(zeroBasedLine) || zeroBasedLine < 0) return null;
  let from = 0;
  for (let line = 0; line < zeroBasedLine; line += 1) {
    const newline = content.indexOf('\n', from);
    if (newline < 0) return null;
    from = newline + 1;
  }
  const newline = content.indexOf('\n', from);
  const rawTo = newline < 0 ? content.length : newline;
  const to = rawTo > from && content[rawTo - 1] === '\r' ? rawTo - 1 : rawTo;
  return { from, to };
}

export function replaceHomeCaptureRangeIfUnchanged(
  content: string,
  snapshot: HomeCaptureRangeSnapshot,
  allowedValues: Iterable<string>,
  replacement: string,
): string | null {
  for (const allowedValue of allowedValues) {
    if (content === `${snapshot.prefix}${allowedValue}${snapshot.suffix}`) {
      return `${snapshot.prefix}${replacement}${snapshot.suffix}`;
    }
  }
  return null;
}

function insertUnderHeading(content: string, heading: string, block: string, position: HomeCaptureInsertPosition): string {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'i').test(line.trim()));
  if (headingIndex < 0) {
    const section = `## ${heading}\n\n${block.trimEnd()}\n`;
    return insertAtNotePosition(content, section, position);
  }

  const cleanBlock = block.trimEnd();
  let insertAt = headingIndex + 1;
  if (position === 'top') {
    while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt += 1;
    lines.splice(insertAt, 0, cleanBlock);
    return `${lines.join('\n').replace(/\s+$/u, '')}\n`;
  }

  insertAt = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+\S/);
    if (match && match[1].length <= 2) {
      insertAt = index;
      break;
    }
  }
  while (insertAt > headingIndex + 1 && lines[insertAt - 1].trim() === '') insertAt -= 1;
  const needsSectionGap = insertAt < lines.length && lines[insertAt]?.match(/^#{1,6}\s+\S/);
  lines.splice(insertAt, 0, cleanBlock, ...(needsSectionGap ? [''] : []));
  return `${lines.join('\n').replace(/\s+$/u, '')}\n`;
}

function insertAtNotePosition(content: string, block: string, position: HomeCaptureInsertPosition): string {
  const cleanBlock = block.trimEnd();
  if (!cleanBlock) return content;
  if (position === 'bottom') {
    const separator = content.trimEnd() ? '\n\n' : '';
    return `${content.trimEnd()}${separator}${cleanBlock}\n`;
  }

  const lines = content.split(/\r?\n/);
  let insertAt = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end >= 0) insertAt = end + 1;
  }
  while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt += 1;
  lines.splice(insertAt, 0, cleanBlock, '');
  return `${lines.join('\n').replace(/\s+$/u, '')}\n`;
}

function getCaptureHeadingIdentity(level: TpsListHeadingLevel, text: string): string {
  return `${level}\u0000${text}`;
}

function parseOpeningMarkdownFence(line: string): { marker: '`' | '~'; length: number } | null {
  const match = String(line || '').match(/^ {0,3}(`{3,}|~{3,})/u);
  if (!match) return null;
  const token = match[1];
  return { marker: token[0] as '`' | '~', length: token.length };
}

function isClosingMarkdownFence(line: string, fence: { marker: '`' | '~'; length: number }): boolean {
  const match = String(line || '').match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/u);
  return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
}

function shouldSeparateMarkdownBlocks(left: string, right: string): boolean {
  if (!left.trim() || !right.trim()) return false;
  return !(isMarkdownListItemLine(left) && isMarkdownListItemLine(right));
}

function isMarkdownListItemLine(line: string): boolean {
  return /^\s{0,3}(?:[-+*]|\d+[.)])[\t ]+\S/u.test(String(line || ''));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function offsetForLine(lines: string[], line: number): number {
  let offset = 0;
  for (let index = 0; index < line; index += 1) offset += (lines[index]?.length || 0) + 1;
  return offset;
}
