import {
  scanMarkdownDocumentLines,
  type MarkdownDocumentLine,
} from './markdown-document-lines';

export interface MarkdownDocumentLineCacheFile {
  readonly path: string;
  readonly stat?: {
    readonly mtime?: number;
    readonly size?: number;
  };
}

export interface MarkdownDocumentLineReadSuccess<TFile> {
  readonly file: TFile;
  readonly ok: true;
  readonly lines: readonly MarkdownDocumentLine[];
  /** True when no new vault read was needed for this request. */
  readonly cacheHit: boolean;
}

export interface MarkdownDocumentLineReadFailure<TFile> {
  readonly file: TFile;
  readonly ok: false;
  readonly error: unknown;
}

export type MarkdownDocumentLineReadResult<TFile> =
  | MarkdownDocumentLineReadSuccess<TFile>
  | MarkdownDocumentLineReadFailure<TFile>;

export interface MarkdownDocumentLineReadBatch<TFile> {
  readonly results: readonly MarkdownDocumentLineReadResult<TFile>[];
  /** A stale render stopped scheduling files. Already-started reads finish safely. */
  readonly cancelled: boolean;
}

interface CachedLines {
  readonly fingerprint: string;
  readonly revision: number;
  readonly lines: readonly MarkdownDocumentLine[];
}

interface PendingLines {
  readonly fingerprint: string;
  readonly revision: number;
  readonly epoch: number;
  readonly promise: Promise<readonly MarkdownDocumentLine[]>;
}

const DEFAULT_READ_CONCURRENCY = 8;
const MAX_READ_CONCURRENCY = 16;

/**
 * Revision-safe parsed Markdown cache used by TPS Table's synthesized rows.
 *
 * File stat values make unchanged rerenders cheap. Explicit vault-event
 * invalidation is still authoritative: Obsidian can report a modify event
 * without changing mtime at the precision visible to a plugin. Revisions also
 * prevent an older in-flight read from repopulating the cache after a modify,
 * delete, or rename.
 */
export class MarkdownDocumentLineCache<TFile extends MarkdownDocumentLineCacheFile> {
  private readonly cachedByPath = new Map<string, CachedLines>();
  private readonly pendingByPath = new Map<string, PendingLines>();
  private readonly revisionByPath = new Map<string, number>();
  private epoch = 0;

  constructor(
    private readonly read: (file: TFile) => Promise<string>,
    private readonly scan: (content: string) => readonly MarkdownDocumentLine[] = scanMarkdownDocumentLines,
  ) {}

  get size(): number {
    return this.cachedByPath.size;
  }

  peek(file: TFile): readonly MarkdownDocumentLine[] | null {
    const cached = this.cachedByPath.get(file.path);
    if (!cached) return null;
    const revision = this.getRevision(file.path);
    if (cached.fingerprint !== getFileFingerprint(file) || cached.revision !== revision) return null;
    return cached.lines;
  }

  async readMany(
    files: readonly TFile[],
    options: {
      concurrency?: number;
      isCancelled?: () => boolean;
    } = {},
  ): Promise<MarkdownDocumentLineReadBatch<TFile>> {
    const concurrency = normalizeConcurrency(options.concurrency, files.length);
    const results: Array<MarkdownDocumentLineReadResult<TFile> | undefined> = new Array(files.length);
    let cursor = 0;
    let cancelled = options.isCancelled?.() === true;

    const worker = async (): Promise<void> => {
      while (!cancelled) {
        if (options.isCancelled?.() === true) {
          cancelled = true;
          return;
        }
        const index = cursor;
        cursor += 1;
        if (index >= files.length) return;
        const file = files[index];
        try {
          const resolved = await this.readOne(file);
          results[index] = {
            file,
            ok: true,
            lines: resolved.lines,
            cacheHit: resolved.cacheHit,
          };
        } catch (error) {
          results[index] = { file, ok: false, error };
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (options.isCancelled?.() === true) cancelled = true;
    return Object.freeze({
      results: Object.freeze(results.filter((result): result is MarkdownDocumentLineReadResult<TFile> => result != null)),
      cancelled,
    });
  }

  invalidate(path: string): void {
    const normalizedPath = String(path || '');
    if (!normalizedPath) return;
    this.revisionByPath.set(normalizedPath, this.getRevision(normalizedPath) + 1);
    this.cachedByPath.delete(normalizedPath);
  }

  invalidateRename(oldPath: string, newPath: string): void {
    this.invalidate(oldPath);
    if (newPath !== oldPath) this.invalidate(newPath);
  }

  /** Drops files outside the current scan without invalidating current files. */
  prune(files: readonly TFile[]): void {
    const activePaths = new Set(files.map((file) => file.path));
    for (const path of this.cachedByPath.keys()) {
      if (!activePaths.has(path)) this.cachedByPath.delete(path);
    }
    for (const path of this.pendingByPath.keys()) {
      if (!activePaths.has(path)) this.invalidate(path);
    }
  }

  clear(): void {
    this.epoch += 1;
    this.cachedByPath.clear();
    this.pendingByPath.clear();
    this.revisionByPath.clear();
  }

  private async readOne(file: TFile): Promise<{ lines: readonly MarkdownDocumentLine[]; cacheHit: boolean }> {
    const path = file.path;
    const fingerprint = getFileFingerprint(file);
    const revision = this.getRevision(path);
    const cached = this.cachedByPath.get(path);
    if (cached && cached.fingerprint === fingerprint && cached.revision === revision) {
      return { lines: cached.lines, cacheHit: true };
    }

    const pending = this.pendingByPath.get(path);
    if (pending && pending.fingerprint === fingerprint && pending.revision === revision && pending.epoch === this.epoch) {
      return { lines: await pending.promise, cacheHit: true };
    }

    const epoch = this.epoch;
    const promise = this.read(file).then((content) => this.scan(content));
    const nextPending: PendingLines = { fingerprint, revision, epoch, promise };
    this.pendingByPath.set(path, nextPending);
    try {
      const lines = await promise;
      if (
        this.epoch === epoch
        && this.getRevision(path) === revision
        && getFileFingerprint(file) === fingerprint
      ) {
        this.cachedByPath.set(path, { fingerprint, revision, lines });
      }
      return { lines, cacheHit: false };
    } finally {
      if (this.pendingByPath.get(path) === nextPending) this.pendingByPath.delete(path);
    }
  }

  private getRevision(path: string): number {
    return this.revisionByPath.get(path) ?? 0;
  }
}

function getFileFingerprint(file: MarkdownDocumentLineCacheFile): string {
  return `${finiteStat(file.stat?.mtime)}:${finiteStat(file.stat?.size)}`;
}

function finiteStat(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : '?';
}

function normalizeConcurrency(value: number | undefined, fileCount: number): number {
  if (fileCount <= 0) return 0;
  const parsed = Number(value);
  const requested = Number.isFinite(parsed) ? Math.floor(parsed) : DEFAULT_READ_CONCURRENCY;
  return Math.max(1, Math.min(MAX_READ_CONCURRENCY, requested, fileCount));
}
