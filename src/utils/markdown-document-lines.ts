import { parser as markdownParser } from '@lezer/markdown';

const EXCLUDED_BLOCK_NODES = new Set([
  'CodeBlock',
  'CommentBlock',
  'FencedCode',
  'HTMLBlock',
]);

export type MarkdownLineExclusion = 'frontmatter' | 'protected-block' | null;

export interface MarkdownDocumentLine {
  /** Zero-based physical line index. */
  readonly index: number;
  /** One-based physical line number. */
  readonly lineNumber: number;
  readonly text: string;
  /** UTF-16 source offset at the start of the physical line. */
  readonly start: number;
  /** UTF-16 source offset immediately after the line text, before its newline. */
  readonly end: number;
  readonly exclusion: MarkdownLineExclusion;
  readonly isContent: boolean;
}

/**
 * Classifies physical Markdown lines using Lezer's CommonMark block parser.
 *
 * Stateless line parsers cannot tell a real nested task from task-shaped text
 * inside indented or fenced code. This document-level boundary is therefore
 * the single authority used before TPS synthesizes tasks, bullets, headings,
 * generic line records, or native block IDs.
 */
export function scanMarkdownDocumentLines(content: string): readonly MarkdownDocumentLine[] {
  const source = String(content ?? '');
  const physicalLines = splitPhysicalLines(source);
  const exclusions: MarkdownLineExclusion[] = new Array(physicalLines.length).fill(null);

  markFrontmatterLines(physicalLines, exclusions);
  if (mayContainProtectedBlock(source)) {
    // Lezer treats LF and CRLF as line breaks. Normalize the uncommon classic
    // Mac CR form one-for-one so parser offsets remain identical to the source.
    const parseSource = source.includes('\r') ? source.replace(/\r(?!\n)/gu, '\n') : source;
    const tree = markdownParser.parse(parseSource);
    tree.iterate({
      enter(node) {
        if (!EXCLUDED_BLOCK_NODES.has(node.name)) return;
        markOffsetRange(physicalLines, exclusions, node.from, node.to, 'protected-block');
      },
    });
  }

  return Object.freeze(physicalLines.map((line, index) => Object.freeze({
    ...line,
    exclusion: exclusions[index],
    isContent: exclusions[index] === null,
  })));
}

export function getMarkdownContentLines(content: string): readonly MarkdownDocumentLine[] {
  return Object.freeze(scanMarkdownDocumentLines(content).filter((line) => line.isContent));
}

interface PhysicalLine {
  readonly index: number;
  readonly lineNumber: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function splitPhysicalLines(content: string): PhysicalLine[] {
  const lines: PhysicalLine[] = [];
  const newline = /\r\n|\n|\r/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = newline.exec(content)) !== null) {
    lines.push({
      index: lines.length,
      lineNumber: lines.length + 1,
      text: content.slice(cursor, match.index),
      start: cursor,
      end: match.index,
    });
    cursor = match.index + match[0].length;
  }
  lines.push({
    index: lines.length,
    lineNumber: lines.length + 1,
    text: content.slice(cursor),
    start: cursor,
    end: content.length,
  });
  return lines;
}

function markFrontmatterLines(
  lines: readonly PhysicalLine[],
  exclusions: MarkdownLineExclusion[],
): void {
  if (!lines.length || stripLeadingBom(lines[0].text).trim() !== '---') return;
  for (let index = 0; index < lines.length; index += 1) {
    exclusions[index] = 'frontmatter';
    if (index === 0) continue;
    const trimmed = lines[index].text.trim();
    if (trimmed === '---' || trimmed === '...') return;
  }
}

function markOffsetRange(
  lines: readonly PhysicalLine[],
  exclusions: MarkdownLineExclusion[],
  from: number,
  to: number,
  exclusion: Exclude<MarkdownLineExclusion, null>,
): void {
  if (!lines.length || to <= from) return;
  const first = findLineAtOffset(lines, from);
  const last = findLineAtOffset(lines, Math.max(from, to - 1));
  for (let index = first; index <= last; index += 1) {
    if (exclusions[index] === null) exclusions[index] = exclusion;
  }
}

function findLineAtOffset(lines: readonly PhysicalLine[], offset: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (lines[middle].start <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

function stripLeadingBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

/**
 * Every protected CommonMark block handled above requires at least one of
 * these source tokens. False positives only take the full parser path; a false
 * negative would be unsafe, so the probe intentionally treats any HTML-like
 * text and any four-column physical indent as a candidate.
 */
function mayContainProtectedBlock(content: string): boolean {
  return content.includes('```')
    || content.includes('~~~')
    || content.includes('<')
    // Indented code can follow list or blockquote markers, so looking only at
    // physical-line prefixes is not safe. Any tab or four-space run is an
    // intentionally broad (false-positive-only) reason to invoke the parser.
    || content.includes('\t')
    || content.includes('    ');
}
