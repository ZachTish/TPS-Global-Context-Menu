import { TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import {
  MarkdownDocumentLineCache,
  type MarkdownDocumentLineReadResult,
} from '../utils/markdown-document-line-cache';
import type { MarkdownDocumentLine } from '../utils/markdown-document-lines';

export type BaseRowIndexProgress = {
  completedFiles: number;
  totalFiles: number;
  complete: boolean;
  results: readonly MarkdownDocumentLineReadResult<TFile>[];
};

/**
 * One revision-safe Markdown row cache shared by every TPS Base view.
 *
 * The cache is intentionally source-oriented: query plans decide which row
 * families to project, while this service guarantees bounded reads, stable
 * path order, warm rerenders without I/O, and one-file lifecycle invalidation.
 */
export class BaseRowIndexService {
  private readonly cache: MarkdownDocumentLineCache<TFile>;
  private generation = 0;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {
    this.cache = new MarkdownDocumentLineCache<TFile>((file) => this.plugin.app.vault.cachedRead(file));
  }

  setup(): void {
    this.plugin.registerEvent(this.plugin.app.vault.on('modify', (file) => {
      if (file instanceof TFile && file.extension.toLocaleLowerCase() === 'md') this.invalidate(file.path);
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('create', (file) => {
      if (file instanceof TFile && file.extension.toLocaleLowerCase() === 'md') this.invalidate(file.path);
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('delete', (file) => {
      if (file instanceof TFile && file.extension.toLocaleLowerCase() === 'md') this.invalidate(file.path);
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('rename', (file, oldPath) => {
      if (!(file instanceof TFile)) return;
      if (file.extension.toLocaleLowerCase() === 'md' || String(oldPath).toLocaleLowerCase().endsWith('.md')) {
        this.generation += 1;
        this.cache.invalidateRename(oldPath, file.path);
      }
    }));
  }

  peek(file: TFile): readonly MarkdownDocumentLine[] | null {
    return this.cache.peek(file);
  }

  async readMany(
    files: readonly TFile[],
    options: { isCancelled?: () => boolean } = {},
  ) {
    return this.cache.readMany(this.normalizeFiles(files), {
      concurrency: 8,
      isCancelled: options.isCancelled,
    });
  }

  async readProgressive(
    files: readonly TFile[],
    options: {
      batchSize?: number;
      isCancelled?: () => boolean;
      onProgress?: (progress: BaseRowIndexProgress) => void | Promise<void>;
    } = {},
  ): Promise<{ cancelled: boolean; completedFiles: number; totalFiles: number }> {
    const normalized = this.normalizeFiles(files);
    const totalFiles = normalized.length;
    const batchSize = Math.max(8, Math.min(256, Math.floor(Number(options.batchSize) || 64)));
    let completedFiles = 0;
    for (let index = 0; index < normalized.length; index += batchSize) {
      if (options.isCancelled?.()) return { cancelled: true, completedFiles, totalFiles };
      const batch = normalized.slice(index, index + batchSize);
      const read = await this.cache.readMany(batch, { concurrency: 8, isCancelled: options.isCancelled });
      if (read.cancelled || options.isCancelled?.()) return { cancelled: true, completedFiles, totalFiles };
      completedFiles += read.results.length;
      await options.onProgress?.({
        completedFiles,
        totalFiles,
        complete: completedFiles >= totalFiles,
        results: read.results,
      });
    }
    return { cancelled: false, completedFiles, totalFiles };
  }

  prune(files: readonly TFile[]): void {
    this.cache.prune(files);
  }

  invalidate(path: string): void {
    this.generation += 1;
    this.cache.invalidate(path);
  }

  clear(): void {
    this.generation += 1;
    this.cache.clear();
  }

  getStats(): { cachedFiles: number; generation: number } {
    return { cachedFiles: this.cache.size, generation: this.generation };
  }

  private normalizeFiles(files: readonly TFile[]): TFile[] {
    const unique = new Map<string, TFile>();
    for (const file of files) {
      if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== 'md') continue;
      if (this.plugin.filePropertiesService?.isCompanionFile(file)) continue;
      unique.set(file.path, file);
    }
    return Array.from(unique.values()).sort((left, right) => left.path.localeCompare(right.path));
  }
}
