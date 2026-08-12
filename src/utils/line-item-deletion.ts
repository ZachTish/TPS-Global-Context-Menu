export type LineItemDeleteMode = 'delete-subtree' | 'promote-children';
export type LineItemDeleteBlockKind = 'indented' | 'heading-section';

export interface LineItemContentParts {
  lines: string[];
  newline: string;
  endsWithNewline: boolean;
}

export interface IndentedLineBlock {
  startIndex: number;
  endExclusive: number;
  lines: string[];
  nestedLineCount: number;
  nestedContentLineCount: number;
  promotionColumns: number;
}

export interface LineItemContentMutation {
  content: string;
  changed: boolean;
  block: IndentedLineBlock;
  mode: LineItemDeleteMode;
}

export function splitLineItemContent(content: string): LineItemContentParts {
  const source = String(content ?? '');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const endsWithNewline = /\r?\n$/u.test(source);
  const lines = source.split(/\r?\n/u);
  if (endsWithNewline) lines.pop();
  return { lines, newline, endsWithNewline };
}

export function resolveExactLineRevisionIndex(
  lines: readonly string[],
  preferredIndex: number,
  expectedLine: string,
): number {
  const matches: number[] = [];
  lines.forEach((line, index) => {
    if (line === expectedLine) matches.push(index);
  });
  // A matching hint is not sufficient identity: an indistinguishable line may
  // have been inserted at the old coordinate while the original moved. Exact
  // line consumers fail closed whenever the captured revision is not unique.
  return matches.length === 1 ? matches[0] : -1;
}

export function extractIndentedLineBlock(lines: readonly string[], startIndex: number): IndentedLineBlock {
  if (startIndex < 0 || startIndex >= lines.length) return emptyBlock(startIndex);
  const sourceLine = lines[startIndex] || '';
  if (!sourceLine.trim()) return emptyBlock(startIndex);

  const sourceIndent = getIndentColumns(sourceLine);
  let endExclusive = startIndex + 1;
  while (endExclusive < lines.length) {
    const line = lines[endExclusive] || '';
    if (!line.trim()) {
      const nextNonBlank = findNextNonBlank(lines, endExclusive + 1);
      if (nextNonBlank >= 0 && getIndentColumns(lines[nextNonBlank] || '') > sourceIndent) {
        endExclusive += 1;
        continue;
      }
      break;
    }
    if (getIndentColumns(line) <= sourceIndent) break;
    endExclusive += 1;
  }

  const blockLines = lines.slice(startIndex, endExclusive);
  const nestedLines = blockLines.slice(1);
  const nestedIndents = nestedLines
    .filter((line) => line.trim().length > 0)
    .map((line) => getIndentColumns(line))
    .filter((indent) => indent > sourceIndent);
  const minimumNestedIndent = nestedIndents.length > 0 ? Math.min(...nestedIndents) : sourceIndent;
  return {
    startIndex,
    endExclusive,
    lines: blockLines,
    nestedLineCount: nestedLines.length,
    nestedContentLineCount: nestedIndents.length,
    promotionColumns: Math.max(0, minimumNestedIndent - sourceIndent),
  };
}

export function extractHeadingSectionBlock(lines: readonly string[], startIndex: number): IndentedLineBlock {
  if (startIndex < 0 || startIndex >= lines.length) return emptyBlock(startIndex);
  const headingLevel = getMarkdownHeadingLevel(lines[startIndex] || '');
  if (!headingLevel) return emptyBlock(startIndex);

  let endExclusive = startIndex + 1;
  while (endExclusive < lines.length) {
    const candidateLevel = getMarkdownHeadingLevel(lines[endExclusive] || '');
    if (candidateLevel && candidateLevel <= headingLevel) break;
    endExclusive += 1;
  }

  const blockLines = lines.slice(startIndex, endExclusive);
  const nestedLines = blockLines.slice(1);
  return {
    startIndex,
    endExclusive,
    lines: blockLines,
    nestedLineCount: nestedLines.length,
    nestedContentLineCount: nestedLines.filter((line) => line.trim().length > 0).length,
    promotionColumns: 0,
  };
}

export function extractLineItemDeleteBlock(
  lines: readonly string[],
  startIndex: number,
  blockKind: LineItemDeleteBlockKind = 'indented',
): IndentedLineBlock {
  return blockKind === 'heading-section'
    ? extractHeadingSectionBlock(lines, startIndex)
    : extractIndentedLineBlock(lines, startIndex);
}

export function deleteLineItemAtIndex(
  content: string,
  lineIndex: number,
  mode: LineItemDeleteMode,
  blockKind: LineItemDeleteBlockKind = 'indented',
): LineItemContentMutation {
  const parts = splitLineItemContent(content);
  const block = extractLineItemDeleteBlock(parts.lines, lineIndex, blockKind);
  if (!block.lines.length) return { content, changed: false, block, mode };

  const replacement = mode === 'promote-children'
    ? block.lines.slice(1).map((line) => outdentLine(line, block.promotionColumns))
    : [];
  const nextLines = [...parts.lines];
  nextLines.splice(lineIndex, block.endExclusive - lineIndex, ...replacement);
  return {
    content: `${nextLines.join(parts.newline)}${parts.endsWithNewline ? parts.newline : ''}`,
    changed: true,
    block,
    mode,
  };
}

function getMarkdownHeadingLevel(line: string): number | null {
  const match = String(line || '').match(/^ {0,3}(#{1,6})(?:[\t ]+.*)?$/u);
  return match ? match[1].length : null;
}

export function getIndentColumns(line: string): number {
  let columns = 0;
  for (const character of String(line || '')) {
    if (character === ' ') columns += 1;
    else if (character === '\t') columns += 4;
    else break;
  }
  return columns;
}

function outdentLine(line: string, columnsToRemove: number): string {
  if (!line.trim()) return '';
  let remaining = Math.max(0, columnsToRemove);
  let index = 0;
  let retainedIndent = '';
  while (remaining > 0 && index < line.length) {
    const character = line[index];
    if (character !== ' ' && character !== '\t') break;
    const width = character === '\t' ? 4 : 1;
    if (width <= remaining) {
      remaining -= width;
    } else {
      retainedIndent += ' '.repeat(width - remaining);
      remaining = 0;
    }
    index += 1;
  }
  return `${retainedIndent}${line.slice(index)}`;
}

function findNextNonBlank(lines: readonly string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    if ((lines[index] || '').trim()) return index;
  }
  return -1;
}

function emptyBlock(startIndex: number): IndentedLineBlock {
  return {
    startIndex,
    endExclusive: startIndex,
    lines: [],
    nestedLineCount: 0,
    nestedContentLineCount: 0,
    promotionColumns: 0,
  };
}
