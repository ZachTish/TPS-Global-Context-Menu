import { getPlainTaskTitle } from './task-line-metadata';

export function getPlainDisplayTitle(rawTitle: unknown, fallback: unknown = ''): string {
  return getPlainTaskTitle(String(rawTitle ?? ''))
    || getPlainTaskTitle(String(fallback ?? ''));
}

export function replaceLeadingLinkDisplayTitle(rawTitle: unknown, nextTitle: unknown): string {
  const source = String(rawTitle ?? '').trim();
  const displayTitle = String(nextTitle ?? '').replace(/\s+/g, ' ').trim();
  if (!displayTitle) return source;

  const wikilink = source.match(/^(!?)\[\[([^\]]+?)\]\](?:\s+[\s\S]*)?$/u);
  if (wikilink) {
    const target = String(wikilink[2] || '').split('|', 1)[0]?.trim() || '';
    const alias = sanitizeWikilinkAlias(displayTitle);
    if (target && alias) return `${wikilink[1]}[[${target}|${alias}]]`;
  }

  const markdownLink = source.match(/^(!?)\[([^\]]*)\]\(([^)]+)\)(?:\s+[\s\S]*)?$/u);
  if (markdownLink) {
    const label = sanitizeMarkdownLinkLabel(displayTitle);
    if (label) return `${markdownLink[1]}[${label}](${markdownLink[3]})`;
  }

  return displayTitle;
}

function sanitizeWikilinkAlias(value: string): string {
  return value.replace(/[|\]]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeMarkdownLinkLabel(value: string): string {
  return value.replace(/[\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
}
