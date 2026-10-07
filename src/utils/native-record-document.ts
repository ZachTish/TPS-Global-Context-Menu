import { parseYaml } from 'obsidian';

export interface ParsedNativeRecordDocument {
  bom: string;
  newline: string;
  closer: '---' | '...';
  body: string;
  frontmatter: Record<string, unknown>;
}

export function parseNativeRecordDocument(content: string): ParsedNativeRecordDocument | null {
  const source = String(content || '');
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const withoutBom = bom ? source.slice(1) : source;
  const newline = withoutBom.match(/\r\n|\n|\r/u)?.[0] || '\n';
  const lines = withoutBom.split(/\r\n|\n|\r/u);
  if (!/^---[\t ]*$/u.test(String(lines[0] || ''))) return null;
  let closerIndex = -1;
  let closer: '---' | '...' = '---';
  for (let index = 1; index < lines.length; index += 1) {
    const markerMatch = String(lines[index] || '').match(/^(---|\.\.\.)[\t ]*$/u);
    if (!markerMatch) continue;
    closerIndex = index;
    closer = markerMatch[1] as '---' | '...';
    break;
  }
  if (closerIndex < 0) return null;
  try {
    const parsed = parseYaml(lines.slice(1, closerIndex).join(newline));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return {
      bom,
      newline,
      closer,
      body: lines.slice(closerIndex + 1).join(newline),
      frontmatter: parsed as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}
