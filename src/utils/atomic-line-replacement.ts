export type AtomicLineReplacementRoute = 'exact' | 'relocated' | 'conflict';

export interface AtomicLineReplacementResult {
  content: string;
  route: AtomicLineReplacementRoute;
  resolvedLineIndex: number | null;
  conflictReason?: 'missing' | 'ambiguous';
}

/**
 * Replaces one exact source-line revision without rebuilding unrelated content.
 * Captured line separators are retained so mixed/CRLF notes are not normalized.
 */
export function replaceExactLineRevision(
  content: string,
  expectedLineIndex: number,
  expectedLine: string,
  nextLine: string,
): AtomicLineReplacementResult {
  const source = String(content ?? '');
  const segments = source.split(/(\r?\n)/);
  const lines: string[] = [];
  for (let index = 0; index < segments.length; index += 2) {
    lines.push(segments[index] ?? '');
  }

  const expectedIndexIsCurrent = Number.isInteger(expectedLineIndex)
    && expectedLineIndex >= 0
    && expectedLineIndex < lines.length
    && lines[expectedLineIndex] === expectedLine;
  let resolvedLineIndex = expectedIndexIsCurrent ? expectedLineIndex : -1;
  let route: AtomicLineReplacementRoute = expectedIndexIsCurrent ? 'exact' : 'relocated';

  if (!expectedIndexIsCurrent) {
    const matches = lines
      .map((line, index) => line === expectedLine ? index : -1)
      .filter((index) => index >= 0);
    if (matches.length !== 1) {
      return {
        content: source,
        route: 'conflict',
        resolvedLineIndex: null,
        conflictReason: matches.length === 0 ? 'missing' : 'ambiguous',
      };
    }
    resolvedLineIndex = matches[0];
  }

  segments[resolvedLineIndex * 2] = nextLine;
  return {
    content: segments.join(''),
    route,
    resolvedLineIndex,
  };
}
