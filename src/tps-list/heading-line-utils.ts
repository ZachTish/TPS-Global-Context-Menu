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
  return heading ? getPlainDisplayTitle(heading.text) : '';
}

export function setTpsListHeadingText(line: string, title: string): string {
  const source = String(line ?? '');
  const match = source.match(/^( {0,3}#{1,6}[\t ]+)(.*?)([\t ]+#+[\t ]*)?$/u);
  if (!match) return source;
  const currentText = String(match[2] || '').trim();
  const nextText = replaceLeadingLinkDisplayTitle(currentText, title);
  if (!nextText) return source;
  return `${match[1]}${nextText}${match[3] || ''}`;
}
