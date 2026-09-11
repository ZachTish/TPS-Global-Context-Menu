export interface LineRange {
  from: number;
  to: number;
}

export interface LineRangeSnapshot {
  prefix: string;
  value: string;
  suffix: string;
}

export function createLineRangeSnapshot(
  content: string,
  from: number,
  to: number,
): LineRangeSnapshot {
  const safeFrom = Math.max(0, Math.min(Math.trunc(from), content.length));
  const safeTo = Math.max(safeFrom, Math.min(Math.trunc(to), content.length));
  return {
    prefix: content.slice(0, safeFrom),
    value: content.slice(safeFrom, safeTo),
    suffix: content.slice(safeTo),
  };
}

export function resolveLineRange(content: string, zeroBasedLine: number): LineRange | null {
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

export function replaceLineRangeIfUnchanged(
  content: string,
  snapshot: LineRangeSnapshot,
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
