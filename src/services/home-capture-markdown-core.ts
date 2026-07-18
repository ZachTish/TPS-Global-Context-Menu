import { getMarkdownIndentColumns } from '../tps-list/tps-list-hierarchy';

export type CaptureListKind = 'bullet' | 'task';

export interface CaptureLineMarker {
  kind: CaptureListKind;
  indent: string;
  prefixLength: number;
  body: string;
  checked: boolean;
}

export interface CaptureLineEdit {
  text: string;
  cursor: number;
}

export interface CaptureLineInsertion {
  from: number;
  to: number;
  insert: string;
  cursor: number;
}

export function parseCaptureLineMarker(line: string): CaptureLineMarker | null {
  const taskMatch = /^(\s*)[-*+] \[([ xX])\](?: |$)(.*)$/.exec(line);
  if (taskMatch) {
    return {
      kind: 'task',
      indent: taskMatch[1],
      prefixLength: line.length - taskMatch[3].length,
      body: taskMatch[3],
      checked: taskMatch[2].toLowerCase() === 'x',
    };
  }

  const bulletMatch = /^(\s*)[-*+](?: |$)(.*)$/.exec(line);
  if (!bulletMatch) return null;
  return {
    kind: 'bullet',
    indent: bulletMatch[1],
    prefixLength: line.length - bulletMatch[2].length,
    body: bulletMatch[2],
    checked: false,
  };
}

export function captureMarkdownHasContent(markdown: string): boolean {
  return markdown.split(/\r?\n/).some((line) => {
    const marker = parseCaptureLineMarker(line);
    return (marker?.body ?? line).trim().length > 0;
  });
}

export function formatCaptureMarkdownForWrite(markdown: string, timestamp: string): string {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length === 0) return '';
  const contentLines = lines.filter(captureLineHasContent);
  if (contentLines.length === 0) return '';
  const rootIndent = Math.min(...contentLines.map(getMarkdownIndentColumns));
  const suffix = String(timestamp || '').trim();
  for (let index = 0; index < lines.length; index += 1) {
    if (!captureLineHasContent(lines[index])) continue;
    if (getMarkdownIndentColumns(lines[index]) !== rootIndent) continue;
    lines[index] = suffix
      ? `${lines[index].trimEnd()} ${suffix}`
      : lines[index].trimEnd();
  }
  return `${lines.join('\n')}\n`;
}

function captureLineHasContent(line: string): boolean {
  const marker = parseCaptureLineMarker(line);
  return (marker?.body ?? line).trim().length > 0;
}

export function toggleCaptureTaskMarker(line: string): string {
  const marker = parseCaptureLineMarker(line);
  if (marker?.kind === 'task') return `${marker.indent}- ${marker.body}`;
  if (marker?.kind === 'bullet') return `${marker.indent}- [ ] ${marker.body}`;

  const indent = /^\s*/.exec(line)?.[0] ?? '';
  return `${indent}- [ ] ${line.slice(indent.length)}`;
}

export function toggleCaptureTaskMarkers(markdown: string, lineNumbers: readonly number[]): string {
  const selected = new Set(lineNumbers);
  return markdown
    .split('\n')
    .map((line, index) => selected.has(index + 1) ? toggleCaptureTaskMarker(line) : line)
    .join('\n');
}

export function removeCaptureListMarkerAtCursor(line: string, cursor: number): CaptureLineEdit | null {
  const marker = parseCaptureLineMarker(line);
  if (!marker || cursor !== marker.prefixLength) return null;
  return {
    text: `${marker.indent}${marker.body}`,
    cursor: marker.indent.length,
  };
}

export function continueCaptureListAtCursor(line: string, cursor: number): CaptureLineInsertion | null {
  const marker = parseCaptureLineMarker(line);
  if (!marker || cursor < marker.prefixLength) return null;

  if (marker.body.trim().length === 0) {
    return {
      from: 0,
      to: line.length,
      insert: marker.indent,
      cursor: marker.indent.length,
    };
  }

  const nextPrefix = marker.kind === 'task'
    ? `${marker.indent}- [ ] `
    : `${marker.indent}- `;
  const insert = `\n${nextPrefix}`;
  return {
    from: cursor,
    to: cursor,
    insert,
    cursor: cursor + insert.length,
  };
}
