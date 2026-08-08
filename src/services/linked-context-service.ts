import { App, CachedMetadata, TFile } from 'obsidian';

export type LinkedContextKind = 'line' | 'heading' | 'note';

export interface LinkedContextItem {
  id: string;
  sourceFile: TFile;
  kind: LinkedContextKind;
  startLine: number;
  endLine: number;
  markdown: string;
}

type LinePosition = { start: { line: number }; end: { line: number } };

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

export class LinkedContextService {
  constructor(private readonly app: App) {}

  async collect(targetFile: TFile): Promise<LinkedContextItem[]> {
    const resolvedLinks = this.app.metadataCache.resolvedLinks || {};
    const sourcePaths = Object.keys(resolvedLinks)
      .filter((sourcePath) => sourcePath !== targetFile.path && resolvedLinks[sourcePath]?.[targetFile.path] > 0)
      .sort((a, b) => a.localeCompare(b));
    const items: LinkedContextItem[] = [];

    for (const sourcePath of sourcePaths) {
      const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(sourceFile instanceof TFile) || sourceFile.extension !== 'md') continue;
      const cache = this.app.metadataCache.getFileCache(sourceFile);
      if (!cache) continue;
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
          markdown: lines.slice(range.startLine, range.endLine + 1).join('\n'),
        });
        if (range.kind === 'note') break;
      }
    }

    return items;
  }
}
