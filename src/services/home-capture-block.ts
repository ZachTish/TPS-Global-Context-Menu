export type HomeCaptureInsertPosition = 'top' | 'bottom';

export interface HomeCaptureBlockOptions {
  insertPosition?: HomeCaptureInsertPosition;
  addHeading?: boolean;
  heading?: string;
}

export interface HomeCaptureFormatOptions {
  task?: boolean;
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
  const value = String(text || '').trim();
  if (!value) return '';
  const marker = options.task === true ? '- [ ] ' : '- ';
  return `${marker}${value.replace(/\r?\n/g, '\n  ')} ${timeLabel}\n`;
}

export function insertHomeCaptureBlock(content: string, block: string, options: HomeCaptureBlockOptions = {}): string {
  const position = options.insertPosition === 'top' ? 'top' : 'bottom';
  if (options.addHeading === true) {
    const heading = String(options.heading || 'Capture').trim() || 'Capture';
    return insertUnderHeading(content, heading, block, position);
  }
  return insertAtNotePosition(content, block, position);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function offsetForLine(lines: string[], line: number): number {
  let offset = 0;
  for (let index = 0; index < line; index += 1) offset += (lines[index]?.length || 0) + 1;
  return offset;
}
