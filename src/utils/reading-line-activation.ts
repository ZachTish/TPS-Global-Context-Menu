import { getLineEntityKind } from '../services/line-entity-source-provider';
import { scanMarkdownDocumentLines } from './markdown-document-lines';

export interface ReadingBulletSourceLine {
  lineIndex: number;
  rawLine: string;
}

/** Map a rendered Reading View list ordinal back to an actionable source bullet. */
export function resolveReadingBulletSourceLine(
  content: string,
  renderedOrdinal: number,
  renderedLineHint: number | null = null,
): ReadingBulletSourceLine | null {
  const lines = scanMarkdownDocumentLines(content);
  if (Number.isInteger(renderedLineHint) && renderedLineHint != null && renderedLineHint >= 0) {
    const hinted = lines[renderedLineHint];
    if (hinted?.isContent && getLineEntityKind(hinted.text) === 'bullet') {
      return { lineIndex: hinted.index, rawLine: hinted.text };
    }
  }

  if (!Number.isInteger(renderedOrdinal) || renderedOrdinal < 0) return null;
  const renderedListLines = lines.filter((line) => {
    if (!line.isContent) return false;
    const kind = getLineEntityKind(line.text);
    return kind === 'task' || kind === 'bullet';
  });
  const resolved = renderedListLines[renderedOrdinal];
  if (!resolved || getLineEntityKind(resolved.text) !== 'bullet') return null;
  return { lineIndex: resolved.index, rawLine: resolved.text };
}
