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
  EntityIndexQuery,
  EntityIndexRecord,
  EntityIndexSource,
} from './entity-index-core';

export type {
  EntityIndexChangeListener,
  EntityIndexDimensionPredicate,
  EntityIndexDimensionDefinition,
  EntityIndexFilter,
  EntityIndexQuery,
  EntityIndexRecord,
  EntityIndexSource,
} from './entity-index-core';

export interface EntityIndexPluginHost {
  readonly app: App;
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
  private configuredDimensions: readonly EntityIndexDimensionDefinition[] = [];
  private readonly registeredDimensions = new Map<string, EntityIndexDimensionDefinition>();
  private isBuilt = false;
  private isSetup = false;

  constructor(private readonly plugin: EntityIndexPluginHost) {}

  setup(): void {
    if (this.isSetup) return;
    this.isSetup = true;
    const { metadataCache, vault } = this.plugin.app;

    this.plugin.registerEvent(
      metadataCache.on('changed', (file, _data, cache) => {
        if (!this.isBuilt || !isMarkdownFile(file)) return;
        this.upsertFile(file, cache?.frontmatter);
      }),
    );
    this.plugin.registerEvent(
      metadataCache.on('resolved', () => {
        // `resolved` can fire again after ordinary file changes. The matching
        // `changed` event already upserts those notes, so only use this broad
        // signal to recover an index that has not been built yet.
        if (!this.isBuilt) this.rebuild();
      }),
    );
    this.plugin.registerEvent(
      vault.on('create', (file) => {
        if (this.isBuilt && isMarkdownFile(file)) this.upsertFile(file);
      }),
    );
    this.plugin.registerEvent(
      vault.on('modify', (file) => {
        if (this.isBuilt && isMarkdownFile(file)) this.upsertFile(file);
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
        if (isMarkdownFile(file)) this.upsertFile(file);
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
    }
  }

  invalidate(paths?: readonly string[]): void {
    if (paths && paths.length > 0 && this.isBuilt) {
      for (const path of paths) {
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (isMarkdownFile(file)) {
          this.upsertFile(file);
        } else {
          this.core.removeByPath(path);
        }
      }
      return;
    }
    this.rebuild(true);
  }

  rebuild(
    forceRevision = false,
    frontmatterOverrides?: ReadonlyMap<string, Readonly<Record<string, unknown>> | null>,
  ): void {
    const sources = this.plugin.app.vault.getMarkdownFiles().map(
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
    if (!isMarkdownFile(file)) return null;
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
    return this.core.query(query);
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
  }
}
