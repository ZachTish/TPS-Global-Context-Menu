import type { App, TFile } from 'obsidian';

/**
 * Removes whitespace accidentally inserted before a leading YAML block while
 * preserving every other byte from the exact revision committed by Vault.process.
 */
export async function normalizeLeadingWhitespaceBeforeFrontmatter(
  app: App,
  file: TFile,
): Promise<boolean> {
  let changed = false;
  await app.vault.process(file, (current) => {
    const content = String(current ?? '');
    if (!content) return content;
    const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
    const body = bom ? content.slice(1) : content;
    if (/^---[ \t]*(?:\r?\n)/.test(body)) return content;

    const leadingWhitespace = body.match(/^\s+/)?.[0] ?? '';
    if (!leadingWhitespace || /\S/.test(leadingWhitespace)) return content;
    const trimmed = body.slice(leadingWhitespace.length);
    if (!/^---[ \t]*(?:\r?\n)/.test(trimmed)) return content;

    changed = true;
    return `${bom}${trimmed}`;
  });
  return changed;
}
