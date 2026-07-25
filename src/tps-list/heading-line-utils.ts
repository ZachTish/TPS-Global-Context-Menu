import { getPlainDisplayTitle, replaceLeadingLinkDisplayTitle } from '../utils/display-title';

export type TpsListHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type TpsListHeadingLine = {
  itemKind: 'heading';
  headingLevel: TpsListHeadingLevel;
  text: string;
};

export function parseTpsListHeadingLine(line: string): TpsListHeadingLine | null {
  const match = String(line ?? '').match(/^ {0,3}(#{1,6})(?:[\t ]+(.*?)[\t ]*|[\t ]*)$/u);
  if (!match) return null;
  const headingLevel = match[1].length as TpsListHeadingLevel;
  const text = String(match[2] ?? '').replace(/[\t ]+#+[\t ]*$/u, '').trim();
  if (!text) return null;
  return { itemKind: 'heading', headingLevel, text };
}

export function getTpsListHeadingDisplayTitle(line: string): string {
  const heading = parseTpsListHeadingLine(line);
  if (!heading) return '';
  const metadataStart = findHeadingMetadataStart(heading.text);
  return getPlainDisplayTitle(heading.text.slice(0, metadataStart).trim());
}

export function setTpsListHeadingText(line: string, title: string): string {
  const source = String(line ?? '');
  const match = source.match(/^( {0,3}#{1,6}[\t ]+)(.*?)([\t ]+#+[\t ]*)?$/u);
  if (!match) return source;
  const body = String(match[2] || '');
  const metadataStart = findHeadingMetadataStart(body);
  const currentTitle = body.slice(0, metadataStart).trim();
  const metadata = body.slice(metadataStart);
  const nextText = replaceLeadingLinkDisplayTitle(currentTitle, title);
  if (!nextText) return source;
  const metadataSeparator = metadata && !/^\s/u.test(metadata) ? ' ' : '';
  return `${match[1]}${nextText}${metadataSeparator}${metadata}${match[3] || ''}`;
}

function findHeadingMetadataStart(body: string): number {
  const source = String(body || '');
  const patterns = [
    /(?:^|\s)<!--/u,
    /(?:^|\s)\[[A-Za-z0-9_-]+::/u,
    /(?:^|\s)#[\p{L}\p{N}_/-]+/u,
    /(?:^|\s)\^[A-Za-z0-9-]+(?=\s|$)/u,
  ];
  let start = source.length;
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.index != null) start = Math.min(start, match.index);
  }
  while (start > 0 && /\s/u.test(source[start - 1] || '')) start -= 1;
  return start;
}
