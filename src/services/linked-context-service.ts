import { App, CachedMetadata, TFile } from 'obsidian';
import type { LinkedContextSortOrder } from '../types';

export type LinkedContextKind = 'line' | 'heading' | 'note';

export interface LinkedContextItem {
  id: string;
  sourceFile: TFile;
  kind: LinkedContextKind;
  startLine: number;
  endLine: number;
  renderStartLine: number;
  markdown: string;
}

type LinePosition = { start: { line: number }; end: { line: number } };

export interface LinkedContextRecoveryState {
  enabled: boolean;
  panelConnected: boolean;
  activeFilePath: string;
  mountedFilePath: string;
}

function compareSourcePaths(left: string, right: string): number {
  const foldedLeft = left.toLowerCase();
  const foldedRight = right.toLowerCase();
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function normalizeLinkedContextSortOrder(value: unknown): LinkedContextSortOrder {
  return value === 'source-desc' ? 'source-desc' : 'source-asc';
}

export function shouldRecoverLinkedContextPanel(state: LinkedContextRecoveryState): boolean {
  return state.enabled
    && !state.panelConnected
    && state.activeFilePath.length > 0
    && state.activeFilePath === state.mountedFilePath;
}

export function isLinkedContextSourceChangeRelevant(
  changedPath: string,
  targetPath: string,
  priorSourcePaths: ReadonlySet<string>,
  currentLinkCount: number,
): boolean {
  return changedPath === targetPath
    || priorSourcePaths.has(changedPath)
    || currentLinkCount > 0;
}

function containsLine(position: LinePosition | undefined, line: number): boolean {
  return Boolean(position && line >= position.start.line && line <= position.end.line);
}

export function resolveLinkedContextRange(
  line: number,
  lineCount: number,
  cache: CachedMetadata,
): { kind: LinkedContextKind; startLine: number; endLine: number } {
  const frontmatterPosition = cache.frontmatterPosition as LinePosition | undefined;
  if (containsLine(frontmatterPosition, line)) {
    return { kind: 'note', startLine: 0, endLine: Math.max(0, lineCount - 1) };
  }

  const heading = (cache.headings || []).find((candidate) => candidate.position.start.line === line);
  if (!heading) return { kind: 'line', startLine: line, endLine: line };

  const nextBoundary = (cache.headings || []).find((candidate) =>
    candidate.position.start.line > line && candidate.level <= heading.level
  );
  return {
    kind: 'heading',
    startLine: line,
    endLine: Math.max(line, (nextBoundary?.position.start.line ?? lineCount) - 1),
  };
}

export function extractLinkedContextMarkdown(
  lines: readonly string[],
  range: { kind: LinkedContextKind; startLine: number; endLine: number },
): string {
  const excerptStartLine = range.kind === 'heading' ? range.startLine + 1 : range.startLine;
  return lines.slice(excerptStartLine, range.endLine + 1).join('\n');
}

function isFilePropertiesCompanionFrontmatter(frontmatter: unknown): boolean {
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return false;
  const record = frontmatter as Record<string, unknown>;
  const markerKey = Object.keys(record).find((key) => key.trim().toLowerCase() === 'tpsgcmfileproperties');
  return markerKey !== undefined && Number(record[markerKey]) === 1;
}

export class LinkedContextService {
  constructor(private readonly app: App) {}

  async collect(
    targetFile: TFile,
    sortOrder: LinkedContextSortOrder = 'source-asc',
    excludedSourcePaths: ReadonlySet<string> = new Set<string>(),
  ): Promise<LinkedContextItem[]> {
    if (isFilePropertiesCompanionFrontmatter(this.app.metadataCache.getFileCache(targetFile)?.frontmatter)) {
      return [];
    }
    const resolvedLinks = this.app.metadataCache.resolvedLinks || {};
    const direction = normalizeLinkedContextSortOrder(sortOrder) === 'source-desc' ? -1 : 1;
    const sourcePaths = Object.keys(resolvedLinks)
      .filter((sourcePath) =>
        sourcePath !== targetFile.path
        && !excludedSourcePaths.has(sourcePath)
        && resolvedLinks[sourcePath]?.[targetFile.path] > 0
      )
      .sort((a, b) => direction * compareSourcePaths(a, b));
    const items: LinkedContextItem[] = [];

    for (const sourcePath of sourcePaths) {
      const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(sourceFile instanceof TFile) || sourceFile.extension !== 'md') continue;
      const cache = this.app.metadataCache.getFileCache(sourceFile);
      if (!cache) continue;
      if (isFilePropertiesCompanionFrontmatter(cache.frontmatter)) continue;
      const matchingLinks = [...(cache.links || []), ...(cache.embeds || [])]
        .filter((link) => this.app.metadataCache.getFirstLinkpathDest(link.link, sourceFile.path)?.path === targetFile.path)
        .sort((a, b) => a.position.start.line - b.position.start.line);
      if (matchingLinks.length === 0) continue;

      const content = await this.app.vault.cachedRead(sourceFile);
      const lines = content.split(/\r?\n/);
      const seen = new Set<string>();
      for (const link of matchingLinks) {
        const range = resolveLinkedContextRange(link.position.start.line, lines.length, cache);
        const key = `${range.kind}:${range.startLine}:${range.endLine}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: `${sourceFile.path}:${key}`,
          sourceFile,
          ...range,
          renderStartLine: range.kind === 'heading' ? range.startLine + 1 : range.startLine,
          markdown: extractLinkedContextMarkdown(lines, range),
        });
        if (range.kind === 'note') break;
      }
    }

    return items;
  }
}
