export type TimeTrackingDailyNotePlacement = 'top' | 'bottom';

export interface EnsureTimeTrackingSessionSectionInput {
  heading: string;
  placement: TimeTrackingDailyNotePlacement;
  sessionHeading: string;
  blockId: string;
}

export interface TimeTrackingSessionSectionResult {
  content: string;
  headingLine: number;
  contentLine: number;
  created: boolean;
}

interface MarkdownLine {
  text: string;
  start: number;
  end: number;
  endWithBreak: number;
  lineNumber: number;
}

interface MarkdownHeading {
  level: number;
  text: string;
  line: MarkdownLine;
}

interface MarkdownScan {
  lines: MarkdownLine[];
  headings: MarkdownHeading[];
  bodyStart: number;
  eol: '\n' | '\r\n';
}

interface FenceState {
  marker: '`' | '~';
  length: number;
}

function normalizeHeading(value: unknown, fallback = 'Time Tracking'): string {
  const clean = String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || fallback;
}

function normalizeBlockId(value: unknown): string {
  const clean = String(value ?? '')
    .trim()
    .replace(/^\^+/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-');
  return clean || 'tps-time-session';
}

function splitMarkdownLines(content: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;
  let lineNumber = 0;
  while (start < content.length) {
    const newlineIndex = content.indexOf('\n', start);
    if (newlineIndex < 0) {
      lines.push({ text: content.slice(start), start, end: content.length, endWithBreak: content.length, lineNumber });
      return lines;
    }
    const end = newlineIndex > start && content[newlineIndex - 1] === '\r' ? newlineIndex - 1 : newlineIndex;
    lines.push({ text: content.slice(start, end), start, end, endWithBreak: newlineIndex + 1, lineNumber });
    start = newlineIndex + 1;
    lineNumber += 1;
  }
  if (content.length === 0 || /\n$/.test(content)) {
    lines.push({ text: '', start: content.length, end: content.length, endWithBreak: content.length, lineNumber });
  }
  return lines;
}

function stripBlockquotePrefix(line: string): string {
  let remaining = line;
  while (/^\s{0,3}>/.test(remaining)) {
    remaining = remaining.replace(/^\s{0,3}>[ \t]?/, '');
  }
  return remaining;
}

function parseFence(line: string): { marker: '`' | '~'; length: number; rest: string } | null {
  const candidate = stripBlockquotePrefix(line);
  const match = candidate.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  return {
    marker: match[1][0] as '`' | '~',
    length: match[1].length,
    rest: match[2] || '',
  };
}

function scanMarkdown(content: string): MarkdownScan {
  const eol: '\n' | '\r\n' = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = splitMarkdownLines(content);
  let bodyStart = 0;
  let frontmatterEndLine = -1;
  const first = lines[0]?.text.replace(/^\uFEFF/, '') ?? '';
  if (first.trim() === '---') {
    for (let index = 1; index < lines.length; index += 1) {
      if (/^(?:---|\.\.\.)\s*$/.test(lines[index].text)) {
        frontmatterEndLine = index;
        bodyStart = lines[index].endWithBreak;
        break;
      }
    }
  }

  const headings: MarkdownHeading[] = [];
  let fence: FenceState | null = null;
  for (let index = frontmatterEndLine >= 0 ? frontmatterEndLine + 1 : 0; index < lines.length; index += 1) {
    const line = lines[index];
    const parsedFence = parseFence(line.text);
    if (fence) {
      if (
        parsedFence
        && parsedFence.marker === fence.marker
        && parsedFence.length >= fence.length
        && parsedFence.rest.trim() === ''
      ) {
        fence = null;
      }
      continue;
    }
    if (parsedFence) {
      fence = { marker: parsedFence.marker, length: parsedFence.length };
      continue;
    }

    const match = line.text.match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/);
    if (!match) continue;
    const headingText = match[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
    headings.push({ level: match[1].length, text: headingText, line });
  }

  return { lines, headings, bodyStart, eol };
}

function findSessionAnchor(scan: MarkdownScan, blockId: string): MarkdownLine | null {
  const wanted = normalizeBlockId(blockId);
  const suffix = new RegExp(`(?:^|\\s)\\^${escapeRegExp(wanted)}\\s*$`);
  for (const heading of scan.headings) {
    if (heading.level === 3 && suffix.test(heading.line.text)) return heading.line;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineNumberAtOffset(content: string, offset: number): number {
  let count = 0;
  for (let index = 0; index < Math.min(offset, content.length); index += 1) {
    if (content[index] === '\n') count += 1;
  }
  return count;
}

function appendPrefix(before: string, eol: string): string {
  if (!before) return '';
  if (before.endsWith(`${eol}${eol}`)) return '';
  if (before.endsWith(eol)) return eol;
  return `${eol}${eol}`;
}

function insertAt(content: string, offset: number, insertion: string): string {
  return `${content.slice(0, offset)}${insertion}${content.slice(offset)}`;
}

export function resolveTimeTrackingSessionAnchor(
  content: string,
  blockId: string,
): { headingLine: number; contentLine: number } | null {
  const anchor = findSessionAnchor(scanMarkdown(content), blockId);
  if (!anchor) return null;
  return { headingLine: anchor.lineNumber, contentLine: anchor.lineNumber + 1 };
}

export function ensureTimeTrackingSessionSection(
  content: string,
  input: EnsureTimeTrackingSessionSectionInput,
): TimeTrackingSessionSectionResult {
  const heading = normalizeHeading(input.heading);
  const sessionHeading = normalizeHeading(input.sessionHeading, 'Tracked work');
  const blockId = normalizeBlockId(input.blockId);
  const placement: TimeTrackingDailyNotePlacement = input.placement === 'bottom' ? 'bottom' : 'top';
  const initialScan = scanMarkdown(content);
  const existingAnchor = findSessionAnchor(initialScan, blockId);
  if (existingAnchor) {
    return {
      content,
      headingLine: existingAnchor.lineNumber,
      contentLine: existingAnchor.lineNumber + 1,
      created: false,
    };
  }

  const sessionBlock = `### ${sessionHeading} ^${blockId}${initialScan.eol}${initialScan.eol}`;
  const wantedHeading = heading.toLocaleLowerCase();
  const containerHeading = initialScan.headings.find((candidate) => (
    candidate.level === 2 && candidate.text.toLocaleLowerCase() === wantedHeading
  ));

  let nextContent: string;
  let insertedAt: number;
  if (containerHeading) {
    const nextBoundary = initialScan.headings.find((candidate) => (
      candidate.line.start > containerHeading.line.start && candidate.level <= 2
    ));
    if (placement === 'top') {
      insertedAt = containerHeading.line.endWithBreak;
      const leading = containerHeading.line.endWithBreak === containerHeading.line.end ? initialScan.eol : '';
      nextContent = insertAt(content, insertedAt, `${leading}${sessionBlock}`);
      insertedAt += leading.length;
    } else {
      insertedAt = nextBoundary?.line.start ?? content.length;
      const before = content.slice(containerHeading.line.endWithBreak, insertedAt);
      const prefix = appendPrefix(before, initialScan.eol);
      nextContent = insertAt(content, insertedAt, `${prefix}${sessionBlock}`);
      insertedAt += prefix.length;
    }
  } else {
    const sectionBlock = `## ${heading}${initialScan.eol}${initialScan.eol}${sessionBlock}`;
    if (placement === 'top') {
      insertedAt = initialScan.bodyStart;
      const leading = insertedAt > 0 && !content.slice(0, insertedAt).endsWith(initialScan.eol)
        ? initialScan.eol
        : '';
      nextContent = insertAt(content, insertedAt, `${leading}${sectionBlock}`);
      insertedAt += leading.length + `## ${heading}${initialScan.eol}${initialScan.eol}`.length;
    } else {
      const prefix = appendPrefix(content, initialScan.eol);
      insertedAt = content.length + prefix.length + `## ${heading}${initialScan.eol}${initialScan.eol}`.length;
      nextContent = `${content}${prefix}${sectionBlock}`;
    }
  }

  const resolved = resolveTimeTrackingSessionAnchor(nextContent, blockId);
  const headingLine = resolved?.headingLine ?? lineNumberAtOffset(nextContent, insertedAt);
  return {
    content: nextContent,
    headingLine,
    contentLine: resolved?.contentLine ?? headingLine + 1,
    created: true,
  };
}

export function removeEmptyTimeTrackingSessionAnchor(content: string, blockId: string): string {
  const scan = scanMarkdown(content);
  const anchor = findSessionAnchor(scan, blockId);
  if (!anchor) return content;
  const nextLine = scan.lines[anchor.lineNumber + 1];
  if (nextLine && nextLine.text.trim() !== '') return content;
  const removalEnd = nextLine?.endWithBreak ?? anchor.endWithBreak;
  return `${content.slice(0, anchor.start)}${content.slice(removalEnd)}`;
}
