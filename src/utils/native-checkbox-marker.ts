import { scanMarkdownDocumentLines, type MarkdownDocumentLine } from './markdown-document-lines';

export const DEFAULT_CHECKBOX_MENU_STATES = ['[ ]', '[x]', '[/]', '[?]', '[!]'];

/** A native Markdown checkbox has exactly one UTF-16 marker character. */
export function normalizeNativeCheckboxToken(value: string): string | null {
  if (/[\r\n]/u.test(String(value ?? ''))) return null;
  const text = String(value ?? '').trim();
  if (!text || text === '[]') return '[ ]';
  const marker = /^\[([^\]\r\n])\]$/u.exec(text)?.[1] ?? text;
  return marker.length === 1 && !/[\[\]\r\n]/u.test(marker) ? `[${marker}]` : null;
}

export function parseCheckboxMenuStates(input: string): string[] | null {
  const states: string[] = [];
  for (const entry of input.split(/\r?\n/u).filter(line => line.trim())) {
    const token = normalizeNativeCheckboxToken(entry);
    if (!token) return null;
    if (!states.includes(token)) states.push(token);
  }
  return states;
}

export function normalizeCheckboxMenuStates(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_CHECKBOX_MENU_STATES];
  const tokens = value.filter((entry): entry is string => typeof entry === 'string')
    .map(normalizeNativeCheckboxToken).filter((token): token is string => token !== null);
  return [...new Set(tokens)];
}

export function getNativeCheckboxMarker(line: string): { token: string; markerOffset: number; body: string } | null {
  const match = /^([ \t]*(?:>[ \t]*)*(?:[-*+]|\d+[.)])[ \t]+)\[([^\]\r\n])\](?:[ \t]+(.*)|$)/u.exec(line);
  return match ? { token: `[${match[2]}]`, markerOffset: match[1].length + 1, body: match[3] ?? '' } : null;
}

export function resolveNativeCheckboxLine(content: string, lineNumber: number, expectedRawLine?: string): MarkdownDocumentLine | null {
  if (!Number.isInteger(lineNumber) || lineNumber < 0) return null;
  const line = scanMarkdownDocumentLines(content)[lineNumber];
  return line?.isContent && getNativeCheckboxMarker(line.text)
    && (expectedRawLine === undefined || line.text === expectedRawLine) ? line : null;
}

/** Exact line and current-source validation; never rewrites surrounding Markdown. */
export function replaceNativeCheckboxMarker(content: string, lineNumber: number, expectedRawLine: string, token: string): string | null {
  const nextToken = normalizeNativeCheckboxToken(token);
  const line = resolveNativeCheckboxLine(content, lineNumber, expectedRawLine);
  if (!line || !nextToken) return null;
  const marker = getNativeCheckboxMarker(line.text)!;
  const offset = line.start + marker.markerOffset;
  return content.slice(0, offset) + nextToken[1] + content.slice(offset + 1);
}
