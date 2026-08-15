import {
  App,
  EventRef,
  TAbstractFile,
  TFile,
} from 'obsidian';
import {
  EntityIndexChangeListener,
  EntityIndexDimensionPredicate,
  EntityIndexCore,
  EntityIndexDimensionDefinition,
  EntityIndexLocator,
  EntityIndexQuery,
  EntityIndexRecord,
  EntityIndexSource,
} from './entity-index-core';
import {
  LineEntityResolutionError,
  LineEntitySourceProvider,
} from './line-entity-source-provider';
import * as logger from '../logger';

const LINE_SCAN_CONCURRENCY = 8;
const LINE_SCAN_ATTEMPTS_PER_READINESS = 2;

interface LineFileSnapshot {
  readonly path: string;
  readonly pathIdentity: string;
  readonly content: string;
  readonly generation: number;
}

export class EntityIndexIncompleteError extends Error {
  readonly code = 'entity-index-incomplete';

  constructor(readonly failedPaths: readonly string[]) {
    super(`The line entity index is incomplete for ${failedPaths.length} Markdown source(s).`);
    this.name = 'EntityIndexIncompleteError';
  }
}

export type {
  EntityIndexChangeListener,
  EntityIndexDimensionPredicate,
  EntityIndexDimensionDefinition,
  EntityIndexFilter,
  EntityIndexLocator,
  EntityIndexQuery,
  EntityIndexRecord,
  EntityIndexSource,
} from './entity-index-core';

export interface EntityIndexPluginHost {
  readonly app: App;
  readonly filePropertiesService?: { isCompanionFile(file: TFile): boolean };
  registerEvent(eventRef: EventRef): void;
}

function isMarkdownFile(file: TAbstractFile | null | undefined): file is TFile {
  return file instanceof TFile && file.extension.toLocaleLowerCase() === 'md';
}

function getEntityDisplayName(
  file: TFile,
  frontmatter: Readonly<Record<string, unknown>> | null | undefined,
): string {
  const titleKey = Object.keys(frontmatter || {}).find((key) => key.trim().toLowerCase() === 'title');
  const title = titleKey ? String(frontmatter?.[titleKey] ?? '').trim() : '';
  return title || file.basename;
}

/**
 * Obsidian-backed note entity index.
 *
 * `setup()` attaches incremental metadata/vault listeners. Queries remain
 * synchronous: the first read builds once from MetadataCache, while subsequent
 * reads reuse the immutable core and its revision-scoped query cache.
 */
export class EntityIndexService {
  private readonly core = new EntityIndexCore();
  private readonly lineSourceProvider = new LineEntitySourceProvider();
  private configuredDimensions: readonly EntityIndexDimensionDefinition[] = [];
  private readonly registeredDimensions = new Map<string, EntityIndexDimensionDefinition>();
  private isBuilt = false;
  private isSetup = false;
  private hasObservedMetadataResolution = false;
  private isLineIndexReady = false;
  private lineBuildPromise: Promise<void> | null = null;
  private lineBuildEpoch = 0;
  private readonly lineRefreshGeneration = new Map<string, number>();
  private readonly failedLineScanPaths = new Set<string>();
  private readonly pendingLineRefreshes = new Set<Promise<void>>();
  private readonly noteQueryViews = new WeakMap<
    readonly EntityIndexRecord[],
    readonly EntityIndexRecord[]
  >();

  constructor(private readonly plugin: EntityIndexPluginHost) {}

  private isIndexableMarkdownFile(file: TAbstractFile | null | undefined): file is TFile {
    return isMarkdownFile(file) && this.plugin.filePropertiesService?.isCompanionFile(file) !== true;
  }

  setup(): void {
    if (this.isSetup) return;
    this.isSetup = true;
    const { metadataCache, vault } = this.plugin.app;

    this.plugin.registerEvent(
      metadataCache.on('changed', (file, data, cache) => {
        if (!this.isBuilt || !this.isIndexableMarkdownFile(file)) return;
        this.upsertFile(file, cache?.frontmatter);
        if (this.isLineTrackingActive()) {
          this.scheduleLineRefresh(file, typeof data === 'string' ? data : undefined);
        }
      }),
    );
    this.plugin.registerEvent(
      metadataCache.on('resolved', () => {
        const isFirstResolution = !this.hasObservedMetadataResolution;
        this.hasObservedMetadataResolution = true;
        if (!isFirstResolution) {
          // `resolved` can fire again after ordinary file changes. The matching
          // `changed` event already upserts those notes, so later broad signals
          // only need to recover an index that is currently stale.
          if (!this.isBuilt) this.rebuild();
          return;
        }

        // A Base or picker can query during startup before MetadataCache has
        // populated every file's frontmatter. That lazy read still marks the
        // index built, so the first authoritative resolution must rebuild even
        // when records already exist or those early empty dimensions persist.
        const wasLineTracking = this.isLineTrackingActive();
        this.rebuild();
        if (wasLineTracking) void this.ensureReady();
      }),
    );
    this.plugin.registerEvent(
      vault.on('create', (file) => {
        if (this.isBuilt && this.isIndexableMarkdownFile(file)) {
          this.upsertFile(file);
          if (this.isLineTrackingActive()) this.scheduleLineRefresh(file);
        }
      }),
    );
    this.plugin.registerEvent(
      vault.on('modify', (file) => {
        if (this.isBuilt && this.isIndexableMarkdownFile(file)) {
          this.upsertFile(file);
          if (this.isLineTrackingActive()) this.scheduleLineRefresh(file);
        }
      }),
    );
    this.plugin.registerEvent(
      vault.on('delete', (file) => {
        if (this.isBuilt) this.removeFile(file);
      }),
    );
    this.plugin.registerEvent(
      vault.on('rename', (file, oldPath) => {
        if (!this.isBuilt) return;
        this.core.removeByPath(oldPath);
        this.removeLineSource(oldPath);
        if (this.isIndexableMarkdownFile(file)) {
          this.upsertFile(file);
          if (this.isLineTrackingActive()) this.scheduleLineRefresh(file);
        }
      }),
    );
  }

  configureDimensions(definitions: readonly EntityIndexDimensionDefinition[]): void {
    this.configuredDimensions = [...(definitions || [])];
    this.applyDimensionConfiguration();
  }

  registerDimension(definition: EntityIndexDimensionDefinition): () => void {
    const token = `${String(definition?.name || '').trim().toLowerCase()}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    this.registeredDimensions.set(token, definition);
    this.applyDimensionConfiguration();
    return () => {
      if (!this.registeredDimensions.delete(token)) return;
      this.applyDimensionConfiguration();
    };
  }

  private applyDimensionConfiguration(): void {
    const combined = new Map<string, { name: string; propertyKeys: string[] }>();
    for (const definition of [
      ...this.configuredDimensions,
      ...this.registeredDimensions.values(),
    ]) {
      const name = String(definition?.name || '').trim();
      if (!name) continue;
      const identity = name.toLowerCase();
      const current = combined.get(identity) || { name, propertyKeys: [] };
      const knownKeys = new Set(current.propertyKeys.map((key) => key.toLowerCase()));
      for (const rawKey of definition.propertyKeys || []) {
        const key = String(rawKey || '').trim();
        if (!key || knownKeys.has(key.toLowerCase())) continue;
        knownKeys.add(key.toLowerCase());
        current.propertyKeys.push(key);
      }
      combined.set(identity, current);
    }
    const wasBuilt = this.isBuilt;
    const wasLineTracking = this.isLineTrackingActive();
    const previousRevision = this.core.getRevision();
    // Mark the service stale before clearing the core. If this service already
    // had records, rebuild before emitting a single final-state notification so
    // listeners never observe the intentionally empty reconfiguration state.
    this.isBuilt = false;
    this.core.configureDimensions([...combined.values()], false);
    if (this.core.getRevision() === previousRevision) {
      this.isBuilt = wasBuilt;
    } else if (wasBuilt) {
      this.rebuild(true);
      if (wasLineTracking) void this.ensureReady();
    }
  }

  invalidate(paths?: readonly string[]): void {
    if (paths && paths.length > 0 && this.isBuilt) {
      for (const path of paths) {
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (this.isIndexableMarkdownFile(file)) {
          this.upsertFile(file);
          if (this.isLineTrackingActive()) this.scheduleLineRefresh(file);
        } else {
          this.core.removeByPath(path);
          this.removeLineSource(path);
        }
      }
      return;
    }
    const wasLineTracking = this.isLineTrackingActive();
    this.rebuild(true);
    if (wasLineTracking) void this.ensureReady();
  }

  rebuild(
    forceRevision = false,
    frontmatterOverrides?: ReadonlyMap<string, Readonly<Record<string, unknown>> | null>,
  ): void {
    this.resetLineIndexState();
    const sources = this.plugin.app.vault.getMarkdownFiles()
      .filter((file) => this.isIndexableMarkdownFile(file))
      .map(
      (file): EntityIndexSource => {
        const frontmatter = frontmatterOverrides?.has(file.path)
          ? frontmatterOverrides.get(file.path)
          : this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        return {
          id: file.path,
          path: file.path,
          name: getEntityDisplayName(file, frontmatter),
          basename: file.basename,
          frontmatter,
        };
      },
    );
    this.isBuilt = true;
    try {
      this.core.rebuild(sources, forceRevision);
    } catch (error) {
      this.isBuilt = false;
      throw error;
    }
  }

  upsertFile(
    file: TFile,
    frontmatter?: Readonly<Record<string, unknown>> | null,
  ): EntityIndexRecord | null {
    if (!this.isIndexableMarkdownFile(file)) return null;
    if (!this.isBuilt) {
      const overrides = frontmatter !== undefined
        ? new Map([[file.path, frontmatter]])
        : undefined;
      this.rebuild(false, overrides);
      return this.core.getByPath(file.path);
    }
    const resolvedFrontmatter = frontmatter
      ?? this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    return this.core.upsert({
      id: file.path,
      path: file.path,
      name: getEntityDisplayName(file, resolvedFrontmatter),
      basename: file.basename,
      frontmatter: resolvedFrontmatter,
    });
  }

  query(query: EntityIndexQuery = {}): readonly EntityIndexRecord[] {
    this.ensureBuilt();
    const records = this.core.query(query);
    const cached = this.noteQueryViews.get(records);
    if (cached) return cached;
    const notes = records.filter((record) => record.entityType === 'note');
    const result = notes.length === records.length
      ? records
      : Object.freeze(notes);
    this.noteQueryViews.set(records, result);
    return result;
  }

  async queryAsync(query: EntityIndexQuery = {}): Promise<readonly EntityIndexRecord[]> {
    await this.ensureReady();
    return this.core.query(query);
  }

  /**
   * Resolves the content-backed index before a picker exposes line choices.
   * Note-only synchronous callers remain backward compatible through query().
   */
  async ensureReady(): Promise<void> {
    this.ensureBuilt();
    // A dimension reconfiguration can cancel a build while a caller awaits it.
    // Restart only for a genuinely newer epoch; source read failures are
    // bounded and surface explicitly instead of spinning or returning partial.
    for (let restart = 0; restart < 8; restart += 1) {
      const epoch = this.lineBuildEpoch;
      if (!this.isLineIndexReady && !this.lineBuildPromise) {
        const filesByPath = new Map(
          this.plugin.app.vault.getMarkdownFiles()
            .filter((file) => this.isIndexableMarkdownFile(file))
            .map((file) => [normalizePath(file.path), file]),
        );
        const files = this.failedLineScanPaths.size > 0
          ? [...this.failedLineScanPaths]
              .map((path) => filesByPath.get(path))
              .filter((file): file is TFile => Boolean(file))
          : [...filesByPath.values()];
        for (const path of [...this.failedLineScanPaths]) {
          if (!filesByPath.has(path)) this.failedLineScanPaths.delete(path);
        }
        this.startLineBuild(files, epoch, true);
      }
      const activeBuild = this.lineBuildPromise;
      if (activeBuild) await activeBuild;
      if (epoch !== this.lineBuildEpoch) continue;
      await this.awaitPendingLineRefreshes();
      if (epoch !== this.lineBuildEpoch) continue;
      if (this.failedLineScanPaths.size === 0 && this.isLineIndexReady) return;
      throw new EntityIndexIncompleteError(
        Object.freeze([...this.failedLineScanPaths].sort()),
      );
    }
    throw new EntityIndexIncompleteError(
      Object.freeze([...this.failedLineScanPaths].sort()),
    );
  }

  getRevision(): number {
    return this.core.getRevision();
  }

  getById(id: string): EntityIndexRecord | null {
    this.ensureBuilt();
    return this.core.getById(id);
  }

  getByPath(path: string): EntityIndexRecord | null {
    this.ensureBuilt();
    return this.core.getByPath(path);
  }

  getByLocator(locator: EntityIndexLocator | string): EntityIndexRecord | null {
    this.ensureBuilt();
    return this.core.getByLocator(locator);
  }

  getByReferenceTarget(target: string): EntityIndexRecord | null {
    this.ensureBuilt();
    return this.core.getByReferenceTarget(target);
  }

  getBySourcePath(path: string): readonly EntityIndexRecord[] {
    this.ensureBuilt();
    return this.core.getBySourcePath(path);
  }

  async materializeReference(
    entityOrId: EntityIndexRecord | string,
  ): Promise<EntityIndexRecord | null> {
    await this.ensureReady();
    const record = typeof entityOrId === 'string'
      ? this.core.getById(entityOrId)
      : this.core.getById(entityOrId?.id);
    if (!record) return null;
    if (record.entityType === 'note') return record;

    const file = this.plugin.app.vault.getAbstractFileByPath(record.sourcePath);
    if (!this.isIndexableMarkdownFile(file)) return null;
    try {
      const result = await this.lineSourceProvider.materialize(
        file,
        record,
        this.plugin.app.vault,
      );
      this.applyLineSnapshot(file.path, result.content);
      return this.core.getByLocator({
        path: file.path,
        entityType: 'block',
        blockId: result.blockId,
      });
    } catch (error) {
      const resolutionCode = error instanceof LineEntityResolutionError
        ? error.code
        : 'write-failed';
      const context = {
          path: record.sourcePath,
          lineKind: record.lineKind || 'unknown',
          resolutionCode,
        };
      if (error instanceof LineEntityResolutionError) {
        logger.flowWarn('EntityIndex', 'line-reference:rejected', context);
      } else {
        logger.flowError('EntityIndex', 'line-reference:failed', error, context);
      }
      return null;
    }
  }

  getDimensionValues(dimensionName: string): readonly string[] {
    this.ensureBuilt();
    return this.core.getDimensionValues(dimensionName);
  }

  onChanged(listener: EntityIndexChangeListener): () => void {
    return this.core.onChanged(listener);
  }

  private ensureBuilt(): void {
    if (!this.isBuilt) this.rebuild();
  }

  private removeFile(file: TAbstractFile): void {
    this.core.removeByPath(file.path);
    this.removeLineSource(file.path);
  }

  private resetLineIndexState(): void {
    this.lineBuildEpoch += 1;
    this.isLineIndexReady = false;
    this.lineBuildPromise = null;
    this.lineRefreshGeneration.clear();
    this.failedLineScanPaths.clear();
    this.pendingLineRefreshes.clear();
    this.lineSourceProvider.reset();
  }

  private startLineBuild(
    files: readonly TFile[],
    epoch: number,
    markReady: boolean,
  ): void {
    const build = (async () => {
      const snapshots = new Map<string, LineFileSnapshot>();
      let pending = [...files];
      for (let attempt = 1; attempt <= LINE_SCAN_ATTEMPTS_PER_READINESS && pending.length > 0; attempt += 1) {
        const failed: TFile[] = [];
        await runBounded(pending, LINE_SCAN_CONCURRENCY, async (file) => {
          try {
            const snapshot = await this.readLineFileSnapshot(file, undefined, epoch);
            if (snapshot) snapshots.set(snapshot.pathIdentity, snapshot);
          } catch (error) {
            failed.push(file);
            logger.flowError('EntityIndex', 'line-scan:failed', error, {
              path: file.path,
              attempt,
              maxAttempts: LINE_SCAN_ATTEMPTS_PER_READINESS,
              retryPending: attempt < LINE_SCAN_ATTEMPTS_PER_READINESS,
            });
          }
        });
        if (this.lineBuildEpoch !== epoch) return;
        pending = failed;
      }
      if (this.lineBuildEpoch !== epoch) return;
      this.core.batchMutations(() => {
        for (const snapshot of snapshots.values()) {
          if (
            this.lineBuildEpoch !== epoch
            || this.lineRefreshGeneration.get(snapshot.pathIdentity) !== snapshot.generation
          ) {
            continue;
          }
          this.applyLineSnapshot(snapshot.path, snapshot.content);
        }
      });
      if (markReady && this.lineBuildEpoch === epoch) {
        this.isLineIndexReady = this.failedLineScanPaths.size === 0;
      }
    })().finally(() => {
      if (this.lineBuildPromise === build) this.lineBuildPromise = null;
    });
    this.lineBuildPromise = build;
  }

  private isLineTrackingActive(): boolean {
    return this.isLineIndexReady
      || this.lineBuildPromise !== null
      || this.pendingLineRefreshes.size > 0;
  }

  private scheduleLineRefresh(file: TFile, suppliedContent?: string): void {
    const refresh = this.refreshLineFile(file, suppliedContent)
      .then(() => {
        if (this.failedLineScanPaths.size === 0 && this.lineBuildPromise === null) {
          this.isLineIndexReady = true;
        }
      })
      .catch((error) => {
        this.isLineIndexReady = false;
        logger.flowError('EntityIndex', 'line-refresh:failed', error, {
          path: file.path,
        });
      })
      .finally(() => {
        this.pendingLineRefreshes.delete(refresh);
      });
    this.pendingLineRefreshes.add(refresh);
  }

  private async awaitPendingLineRefreshes(): Promise<void> {
    while (this.pendingLineRefreshes.size > 0) {
      await Promise.all([...this.pendingLineRefreshes]);
    }
  }

  private async refreshLineFile(
    file: TFile,
    suppliedContent?: string,
    epoch = this.lineBuildEpoch,
  ): Promise<void> {
    const snapshot = await this.readLineFileSnapshot(file, suppliedContent, epoch);
    if (!snapshot) return;
    this.applyLineSnapshot(snapshot.path, snapshot.content);
  }

  private async readLineFileSnapshot(
    file: TFile,
    suppliedContent?: string,
    epoch = this.lineBuildEpoch,
  ): Promise<LineFileSnapshot | null> {
    const pathIdentity = normalizePath(file.path);
    const generation = (this.lineRefreshGeneration.get(pathIdentity) || 0) + 1;
    this.lineRefreshGeneration.set(pathIdentity, generation);
    let content: string;
    try {
      content = suppliedContent !== undefined
        ? suppliedContent
        : await this.readFileContent(file);
    } catch (error) {
      if (
        epoch === this.lineBuildEpoch
        && this.lineRefreshGeneration.get(pathIdentity) === generation
      ) {
        this.failedLineScanPaths.add(pathIdentity);
      }
      throw error;
    }
    if (
      epoch !== this.lineBuildEpoch
      || this.lineRefreshGeneration.get(pathIdentity) !== generation
    ) {
      return;
    }
    return Object.freeze({
      path: file.path,
      pathIdentity,
      content,
      generation,
    });
  }

  private applyLineSnapshot(path: string, content: string): void {
    const sources = this.lineSourceProvider.scanFile(
      path,
      content,
      this.core.getDimensionDefinitions(),
    );
    this.core.replaceSource(lineSourceKey(path), sources);
    this.failedLineScanPaths.delete(normalizePath(path));
  }

  private removeLineSource(path: string): void {
    const identity = normalizePath(path);
    this.lineRefreshGeneration.set(
      identity,
      (this.lineRefreshGeneration.get(identity) || 0) + 1,
    );
    this.failedLineScanPaths.delete(identity);
    this.lineSourceProvider.forgetFile(path);
    this.core.removeSource(lineSourceKey(path));
  }

  private async readFileContent(file: TFile): Promise<string> {
    const vault = this.plugin.app.vault as typeof this.plugin.app.vault & {
      cachedRead?: (target: TFile) => Promise<string>;
      read?: (target: TFile) => Promise<string>;
    };
    if (typeof vault.cachedRead === 'function') return vault.cachedRead(file);
    if (typeof vault.read === 'function') return vault.read(file);
    return '';
  }
}

function normalizePath(path: string): string {
  return String(path || '').replace(/\\/gu, '/').trim().toLocaleLowerCase();
}

function lineSourceKey(path: string): string {
  return `lines:${normalizePath(path)}`;
}

async function runBounded<T>(
  items: readonly T[],
  concurrency: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.floor(Number(concurrency) || 1)),
  );
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await run(items[index]);
    }
  });
  await Promise.all(workers);
}
