import {
  Notice,
  TFile,
  TFolder,
  normalizePath,
  parseYaml,
  stringifyYaml,
} from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';
import {
  casefold,
  deleteValueCaseInsensitive,
  findKeyCaseInsensitive,
  setValueCaseInsensitive,
} from '../core';
import { normalizeTagList } from '../utils/tag-utils';

export const FILE_PROPERTIES_ROOT = normalizePath('_assets/TPS File Properties');
export const FILE_PROPERTIES_BY_ID_ROOT = normalizePath(`${FILE_PROPERTIES_ROOT}/_by-id`);
export const FILE_PROPERTIES_SCHEMA_VERSION = 1;

/** Fast path-only guard for services that must exclude the managed catalog. */
export function isFilePropertiesCompanionPath(path: unknown): boolean {
  const normalized = normalizePath(String(path || '').trim().replace(/^\/+|\/+$/gu, ''));
  const rootPrefix = `${FILE_PROPERTIES_ROOT}/`;
  return normalized.toLocaleLowerCase().startsWith(rootPrefix.toLocaleLowerCase())
    && normalized.toLocaleLowerCase().endsWith('.md');
}

export const FILE_PROPERTY_KEYS = {
  schema: 'tpsGcmFileProperties',
  id: 'tpsGcmFileId',
  source: 'tpsGcmSource',
  sourcePath: 'tpsGcmSourcePath',
  sourceExtension: 'tpsGcmSourceExtension',
  sourceMissing: 'tpsGcmSourceMissing',
  tombstonedAt: 'tpsGcmTombstonedAt',
  pendingTargetPath: 'tpsGcmPendingTargetPath',
  needsMerge: 'tpsGcmNeedsMerge',
  importedCanvasAt: 'tpsGcmImportedCanvasAt',
} as const;

export const RESERVED_FILE_PROPERTY_KEYS: ReadonlySet<string> = new Set(
  Object.values(FILE_PROPERTY_KEYS).map((key) => casefold(key)),
);

/** Marker guard for moved companions when only cached frontmatter is available. */
export function isFilePropertiesCompanionRecord(value: unknown): value is FilePropertyRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as FilePropertyRecord;
  const schemaKey = findKeyCaseInsensitive(record, FILE_PROPERTY_KEYS.schema);
  const idKey = findKeyCaseInsensitive(record, FILE_PROPERTY_KEYS.id);
  const sourcePathKey = findKeyCaseInsensitive(record, FILE_PROPERTY_KEYS.sourcePath);
  return Number(schemaKey ? record[schemaKey] : undefined) === FILE_PROPERTIES_SCHEMA_VERSION
    && Boolean(String(idKey ? record[idKey] ?? '' : '').trim())
    && Boolean(String(sourcePathKey ? record[sourcePathKey] ?? '' : '').trim());
}

export type FilePropertyRecord = Record<string, unknown>;
export type FilePropertyMutator = (frontmatter: FilePropertyRecord) => void | Promise<void>;

export interface FilePropertiesMutationCause {
  kind: 'user' | 'automation';
  sourcePluginId?: string;
  surface?: string;
}

export interface FilePropertiesBulkMutationFailure {
  file: TFile;
  path: string;
  message: string;
}

export interface FilePropertiesBulkMutationResult {
  updated: TFile[];
  failures: FilePropertiesBulkMutationFailure[];
}

export type FilePropertiesChangeAction =
  | 'created'
  | 'updated'
  | 'initialized'
  | 'renamed'
  | 'orphaned'
  | 'tombstoned'
  | 'removed'
  | 'restored'
  | 'relinked'
  | 'reconciled';

export interface FilePropertyMutationResult {
  action: FilePropertiesChangeAction;
  sourceFile: TFile | null;
  sourcePath: string;
  companionFile: TFile;
  companionPath: string;
  frontmatter: FilePropertyRecord;
  cause?: FilePropertiesMutationCause;
}

export interface FilePropertiesServiceOptions {
  onChanged?: (result: FilePropertyMutationResult) => void | Promise<void>;
}

export interface EnsureFilePropertiesOptions {
  initialProperties?: FilePropertyRecord;
  importLegacyCanvas?: boolean;
  /** Internal identity snapshot used to reject stale queued mutations. */
  expectedSourcePath?: string;
}

export interface FilePropertiesRelinkCandidate {
  companionFile: TFile;
  companionPath: string;
  sourcePath: string;
  fileId: string;
  /** Bounded, display-safe user-property names. Property values are never exposed. */
  propertyNames: string[];
  propertyCount: number;
  pendingTargetPath: string | null;
}

export interface FilePropertiesReconcileReport {
  scanned: number;
  moved: number;
  updated: number;
  orphaned: number;
  restored: number;
  collisions: string[];
}

export interface FilePropertiesFolderLifecycleReport {
  matched: number;
  moved: number;
  updated: number;
  orphaned: number;
  conflicts: string[];
}

interface CachedCompanionRecord {
  raw: FilePropertyRecord;
  mtime: number | null;
}

interface EnsuredCompanion {
  companion: TFile;
  raw: FilePropertyRecord;
  user: FilePropertyRecord;
  changed: boolean;
  created: boolean;
}

interface LegacyCanvasRead {
  frontmatter: FilePropertyRecord;
  importedAt: string;
}

interface PendingMarkdownTargetIdentity {
  targetFile: TFile;
  companionFile: TFile;
  fileId: string;
  originalSourcePath: string;
}

interface ArchivedDestinationHistory {
  companion: TFile;
  previousRaw: FilePropertyRecord;
  tombstoneRaw: FilePropertyRecord;
  sourcePath: string;
  fileId: string;
}

class ActiveDestinationMappingError extends Error {
  constructor(
    message: string,
    readonly companion: TFile,
    readonly raw: FilePropertyRecord,
    readonly sourcePath: string,
    readonly fileId: string,
  ) {
    super(message);
    this.name = 'ActiveDestinationMappingError';
  }
}

/**
 * Native property storage for files that cannot carry Obsidian frontmatter.
 *
 * A non-Markdown source is never modified. Its user properties live at a
 * deterministic Markdown companion path so Obsidian Properties and Bases can
 * index them without any third-party file-format integration.
 */
export class FilePropertiesService {
  private readonly cachedRawByCompanionPath = new Map<string, CachedCompanionRecord>();
  private readonly companionsBySourcePath = new Map<string, Set<TFile>>();
  private readonly companionsByFileId = new Map<string, Set<TFile>>();
  private readonly indexedKeysByCompanion = new Map<TFile, { sourceKey: string; idKey: string }>();
  private readonly relinkCandidateCompanions = new Set<TFile>();
  private readonly globallyAvailableRelinkCandidates = new Set<TFile>();
  private readonly legacyCanvasBySourcePath = new Map<string, FilePropertyRecord>();
  private readonly pendingMarkdownTargetsByPath = new Map<string, PendingMarkdownTargetIdentity>();
  private companionIndexReady = false;
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly mutationQueuesBySourcePath = new Map<string, Promise<void>>();
  private metadataResolvedIndexReady = false;

  constructor(
    private readonly plugin: TPSGlobalContextMenuPlugin,
    private readonly options: FilePropertiesServiceOptions = {},
  ) {}

  /** Build the companion index without reading source-file contents. */
  async setup(): Promise<void> {
    await this.serialize(async () => {
      await this.rebuildCompanionIndexUnlocked();
    });
  }

  /** Performs the first authoritative index rebuild after MetadataCache resolves. */
  async handleMetadataResolved(): Promise<void> {
    if (this.metadataResolvedIndexReady) return;
    await this.serialize(async () => {
      if (this.metadataResolvedIndexReady) return;
      await this.rebuildCompanionIndexUnlocked(true);
      this.metadataResolvedIndexReady = true;
    });
  }

  /** Read-only migration preflight; this never creates companions or writes Canvas JSON. */
  async primeLegacyCanvasCache(files?: TFile[]): Promise<number> {
    return this.serialize(() => this.primeLegacyCanvasCacheUnlocked(files));
  }

  dispose(): void {
    this.cachedRawByCompanionPath.clear();
    this.companionsBySourcePath.clear();
    this.companionsByFileId.clear();
    this.indexedKeysByCompanion.clear();
    this.relinkCandidateCompanions.clear();
    this.globallyAvailableRelinkCandidates.clear();
    this.legacyCanvasBySourcePath.clear();
    this.pendingMarkdownTargetsByPath.clear();
    this.mutationQueuesBySourcePath.clear();
    this.companionIndexReady = false;
  }

  forgetCompanion(fileOrPath: TFile | string): void {
    const path = this.normalizeVaultPath(typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path);
    this.cachedRawByCompanionPath.delete(this.pathKey(path));
    for (const companion of Array.from(this.indexedKeysByCompanion.keys())) {
      if (companion === fileOrPath || this.pathKey(companion.path) === this.pathKey(path)) {
        this.removeCompanionFromIndex(companion);
      }
    }
  }

  isPropertyTarget(file: unknown): file is TFile {
    return this.plugin.settings?.dataArchitectureMode !== 'native-records'
      && file instanceof TFile
      && String(file.extension || '').toLocaleLowerCase() !== 'md'
      && !this.isManagedCatalogPath(file.path);
  }

  isCanvasFile(file: unknown): file is TFile {
    return this.isPropertyTarget(file)
      && String(file.extension || '').toLocaleLowerCase() === 'canvas';
  }

  isCompanionPath(path: unknown): boolean {
    return isFilePropertiesCompanionPath(path);
  }

  isCompanionFile(file: unknown): file is TFile {
    if (!(file instanceof TFile) || String(file.extension || '').toLocaleLowerCase() !== 'md') return false;
    if (this.isCompanionPath(file.path)) return true;
    const cached = this.cachedRawByCompanionPath.get(this.pathKey(file.path))?.raw;
    if (cached && this.isCompanionRecord(cached)) return true;
    const metadata = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!isFilePropertiesCompanionRecord(metadata)) return false;
    this.cacheRawFrontmatter(file, metadata);
    return true;
  }

  /** Classifies a rename using both the new file and its pre-rename identity. */
  isCompanionRename(file: unknown, oldPath: string): file is TFile {
    if (!(file instanceof TFile)) return false;
    if (this.isCompanionFile(file) || this.isCompanionPath(oldPath)) return true;
    if (this.indexedKeysByCompanion.has(file)) return true;
    const previous = this.cachedRawByCompanionPath.get(this.pathKey(oldPath))?.raw;
    return Boolean(previous && this.isCompanionRecord(previous));
  }

  getCompanionPath(file: TFile, fileId?: string): string {
    this.assertPropertyTarget(file);
    const mirrored = this.getMirroredCompanionPath(file.path);
    if (this.isSafeCompanionPath(mirrored)) return mirrored;
    const normalizedId = this.normalizeFileId(fileId);
    if (normalizedId) return normalizePath(`${FILE_PROPERTIES_BY_ID_ROOT}/${normalizedId}.md`);
    const indexed = this.getUniqueIndexedCompanion(file.path);
    return indexed?.path || mirrored;
  }

  private getCompanionPathForSourcePath(sourcePath: string, fileId?: string): string {
    const mirrored = this.getMirroredCompanionPath(sourcePath);
    if (this.isSafeCompanionPath(mirrored)) return mirrored;
    const normalizedId = this.normalizeFileId(fileId);
    if (normalizedId) return normalizePath(`${FILE_PROPERTIES_BY_ID_ROOT}/${normalizedId}.md`);
    return mirrored;
  }

  getCompanionFile(file: TFile): TFile | null {
    if (!this.isPropertyTarget(file)) return null;
    const entry = this.plugin.app.vault.getAbstractFileByPath(this.getCompanionPath(file));
    if (entry instanceof TFile) {
      const raw = this.readRawFrontmatterSync(entry);
      const fileId = raw ? this.readReservedString(raw, FILE_PROPERTY_KEYS.id) : '';
      const deterministic = raw
        && this.rawRecordMapsToSource(raw, file.path)
        && this.isUniqueIndexedIdentity(entry, file.path, fileId)
        ? entry
        : null;
      if (deterministic) return deterministic;
    }
    return this.getUniqueIndexedCompanion(file.path);
  }

  /**
   * Returns a unique missing companion that still names this exact path.
   * This is intentionally separate from getCompanionFile: a replacement file
   * must never inherit the deleted item's properties until the user relinks it.
   */
  getRelinkCandidate(file: TFile): TFile | null {
    if (!this.isPropertyTarget(file)) return null;
    const candidates = this.companionsBySourcePath.get(this.pathKey(file.path));
    if (!candidates || candidates.size !== 1) return null;
    const [companion] = candidates;
    const raw = this.readRawFrontmatterSync(companion);
    const fileId = raw ? this.readReservedString(raw, FILE_PROPERTY_KEYS.id) : '';
    if (!raw
      || !this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)
      || !fileId
      || !this.isUniqueIndexedIdentity(companion, file.path, fileId)) return null;
    return this.plugin.app.vault.getAbstractFileByPath(companion.path) === companion ? companion : null;
  }

  /**
   * Lists only unambiguous retained companions whose former source is still
   * missing. This is a read-only picker surface; relinkCompanion performs the
   * authoritative live-state validation immediately before any write.
   */
  listRelinkCandidates(target?: TFile): FilePropertiesRelinkCandidate[] {
    const candidates: FilePropertiesRelinkCandidate[] = [];
    const targetKey = target && this.isPropertyTarget(target) ? this.pathKey(target.path) : '';
    for (const companion of this.relinkCandidateCompanions) {
      if (this.plugin.app.vault.getAbstractFileByPath(companion.path) !== companion) continue;
      const raw = this.readRawFrontmatterSync(companion);
      if (!raw || !this.isCompanionRecord(raw)) continue;
      const sourcePath = this.normalizeVaultPath(this.readReservedString(raw, FILE_PROPERTY_KEYS.sourcePath));
      const fileId = this.readReservedString(raw, FILE_PROPERTY_KEYS.id);
      if (!sourcePath
        || !fileId
        || !this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)
        || !this.isUniqueIndexedIdentity(companion, sourcePath, fileId)) continue;
      const formerSource = this.plugin.app.vault.getAbstractFileByPath(sourcePath);
      if (formerSource instanceof TFile
        && this.isPropertyTarget(formerSource)
        && this.pathKey(sourcePath) !== targetKey) continue;

      const propertyKeys = Object.keys(this.extractUserProperties(raw));
      const propertyNames = propertyKeys
        .map((key) => String(key || '')
          .replace(/[\u0000-\u001F\u007F]/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim()
          .slice(0, 80))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
        .slice(0, 6);
      candidates.push({
        companionFile: companion,
        companionPath: companion.path,
        sourcePath,
        fileId,
        propertyNames,
        propertyCount: propertyKeys.length,
        pendingTargetPath: this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.needsMerge)
          ? this.safeRelinkDisplayText(this.readReservedString(raw, FILE_PROPERTY_KEYS.pendingTargetPath), 240) || null
          : null,
      });
    }
    return candidates.sort((left, right) => (
      left.sourcePath.localeCompare(right.sourcePath, undefined, { sensitivity: 'base' })
      || left.companionPath.localeCompare(right.companionPath, undefined, { sensitivity: 'base' })
    ));
  }

  /** Constant-time menu guard; candidate details are materialized only on invocation. */
  hasRelinkCandidates(target?: TFile): boolean {
    if (target && this.isPropertyTarget(target)) {
      const exact = this.companionsBySourcePath.get(this.pathKey(target.path));
      if (exact?.size === 1 && this.relinkCandidateCompanions.has(Array.from(exact)[0])) return true;
    }
    return this.globallyAvailableRelinkCandidates.size > 0;
  }

  hasCompanion(file: TFile): boolean {
    const companion = this.getCompanionFile(file);
    if (!companion) return false;
    const raw = this.readRawFrontmatterSync(companion);
    return Boolean(raw && this.rawRecordMapsToSource(raw, file.path));
  }

  getSourceFileForCompanion(companion: TFile): TFile | null {
    if (!this.isCompanionFile(companion)) return null;
    if (this.plugin.app.vault.getAbstractFileByPath(companion.path) !== companion) return null;
    const raw = this.readRawFrontmatterSync(companion);
    const sourcePath = raw ? this.readReservedString(raw, FILE_PROPERTY_KEYS.sourcePath) : '';
    const itemId = raw ? this.readReservedString(raw, FILE_PROPERTY_KEYS.id) : '';
    if (!sourcePath
      || !itemId
      || this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)
      || !this.isUniqueIndexedIdentity(companion, sourcePath, itemId)) return null;
    const source = this.plugin.app.vault.getAbstractFileByPath(this.normalizeVaultPath(sourcePath));
    return source instanceof TFile && this.isPropertyTarget(source) ? source : null;
  }

  resolveSourceFile(companion: TFile): TFile | null {
    return this.getSourceFileForCompanion(companion);
  }

  /**
   * Refreshes service-owned sync reads after Obsidian parses a direct YAML edit.
   * The owning plugin should call this from its metadata-cache `changed` event.
   */
  async handleCompanionMetadataChanged(file: TFile): Promise<boolean> {
    if (!(file instanceof TFile) || String(file.extension || '').toLocaleLowerCase() !== 'md') return false;
    return this.serialize(async () => {
      const key = this.pathKey(file.path);
      const previous = this.cachedRawByCompanionPath.get(key)?.raw || null;
      const previousWasValid = Boolean(previous && this.isCompanionRecord(previous));
      const previousSourcePath = previousWasValid && previous
        ? this.normalizeVaultPath(this.readReservedString(previous, FILE_PROPERTY_KEYS.sourcePath))
        : '';
      const previousSourceFile = previousWasValid && previous
        ? this.getUniqueLiveSourceForCompanion(file, previous)
        : null;
      const previousItemId = previousSourceFile && previous
        ? this.readReservedString(previous, FILE_PROPERTY_KEYS.id)
        : '';
      this.cachedRawByCompanionPath.delete(key);
      this.removeCompanionFromIndex(file);
      const raw = await this.readRawFrontmatterAsync(file);
      const belongsToCatalog = this.isCompanionPath(file.path)
        || previousWasValid
        || Boolean(raw && this.isCompanionRecord(raw));
      if (!belongsToCatalog) return false;
      if (!raw || !this.isCompanionRecord(raw)) {
        if (previousSourcePath) {
          await this.notifySourceInvalidated(file, previousSourcePath, previousItemId);
        }
        return true;
      }
      this.cacheRawFrontmatter(file, raw);
      this.indexCompanion(file, raw);
      if (previous && this.recordsEqual(previous, raw)) return true;

      const sourcePath = this.normalizeVaultPath(this.readReservedString(raw, FILE_PROPERTY_KEYS.sourcePath));
      if (previousSourcePath && this.pathKey(previousSourcePath) !== this.pathKey(sourcePath)) {
        await this.notifySourceInvalidated(file, previousSourcePath, previousItemId);
      }
      const sourceFile = this.getUniqueLiveSourceForCompanion(file, raw);
      await this.notifyChanged({
        action: 'updated',
        sourceFile,
        sourcePath,
        companionFile: file,
        companionPath: file.path,
        frontmatter: this.extractUserProperties(raw),
      }, {
        changedKeys: this.changedUserPropertyKeys(
          previous ? this.extractUserProperties(previous) : {},
          this.extractUserProperties(raw),
        ),
      });
      return true;
    });
  }

  /**
   * Invalidates a deleted companion's former source without recreating the
   * companion or re-indexing stale MetadataCache state from the deleted file.
   */
  async handleCompanionDelete(file: TFile): Promise<boolean> {
    if (!(file instanceof TFile) || String(file.extension || '').toLocaleLowerCase() !== 'md') return false;
    return this.serialize(async () => {
      const cachedRaw = this.cachedRawByCompanionPath.get(this.pathKey(file.path))?.raw;
      const metadata = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
      const raw = cachedRaw
        ? this.cloneRecord(cachedRaw)
        : metadata && typeof metadata === 'object' && !Array.isArray(metadata)
          ? this.cloneRecord(metadata as FilePropertyRecord)
          : null;
      if (raw) delete raw.position;
      const belongsToCatalog = this.isCompanionPath(file.path)
        || this.indexedKeysByCompanion.has(file)
        || Boolean(raw && this.isCompanionRecord(raw));
      if (!belongsToCatalog) return false;

      const sourcePath = raw
        ? this.normalizeVaultPath(this.readReservedString(raw, FILE_PROPERTY_KEYS.sourcePath))
        : '';
      const sourceFile = raw ? this.getUniqueLiveSourceForCompanion(file, raw) : null;
      const itemId = sourceFile && raw
        ? this.readReservedString(raw, FILE_PROPERTY_KEYS.id)
        : '';
      this.forgetCompanion(file);

      if (sourcePath) {
        await this.notifyChanged({
          action: 'removed',
          sourceFile,
          sourcePath,
          companionFile: file,
          companionPath: file.path,
          frontmatter: {},
        }, {
          activeSourceFile: sourceFile,
          emitLegacyCanvasEvent: false,
          itemId,
          skipCompanionRead: true,
        });
      }
      return true;
    });
  }

  /** Clears a moved record's old cache key; marker metadata identifies it at the new path. */
  async handleCompanionRename(file: TFile, oldPath: string): Promise<boolean> {
    if (String(file.extension || '').toLocaleLowerCase() !== 'md') {
      const normalizedOldPath = this.normalizeVaultPath(oldPath);
      return this.serialize(async () => {
        const previous = this.cachedRawByCompanionPath.get(this.pathKey(normalizedOldPath))?.raw || null;
        const previousSourcePath = previous && this.isCompanionRecord(previous)
          ? this.normalizeVaultPath(this.readReservedString(previous, FILE_PROPERTY_KEYS.sourcePath))
          : '';
        const previousSourceFile = previous && this.isCompanionRecord(previous)
          ? this.getUniqueLiveSourceForCompanion(file, previous)
          : null;
        const previousItemId = previousSourceFile && previous
          ? this.readReservedString(previous, FILE_PROPERTY_KEYS.id)
          : '';
        try {
          if (!normalizedOldPath) throw new Error('the prior companion path is unavailable');
          await this.plugin.app.vault.rename(file, normalizedOldPath);
          if (previous) this.cacheRawFrontmatter(file, previous);
          logger.warn('[TPS GCM] Restored a file-property companion after an unsupported extension rename', {
            companion: normalizedOldPath,
          });
          return true;
        } catch (error) {
          this.cachedRawByCompanionPath.delete(this.pathKey(normalizedOldPath));
          this.cachedRawByCompanionPath.delete(this.pathKey(file.path));
          this.removeCompanionFromIndex(file);
          if (previousSourcePath) {
            await this.notifySourceInvalidated(file, previousSourcePath, previousItemId);
          }
          throw new Error(
            `GCM file-property companions must remain Markdown files; restoring ${normalizedOldPath || oldPath} failed: ${String(error)}`,
          );
        }
      });
    }
    this.cachedRawByCompanionPath.delete(this.pathKey(oldPath));
    return this.handleCompanionMetadataChanged(file);
  }

  getFrontmatter(file: TFile): FilePropertyRecord {
    if (!this.isPropertyTarget(file)) return {};
    const companion = this.getCompanionFile(file);
    if (companion) {
      const raw = this.readRawFrontmatterSync(companion);
      if (raw && this.rawRecordMapsToSource(raw, file.path)) return this.extractUserProperties(raw);
      return {};
    }
    if (this.hasIndexedAmbiguity(file.path)) return {};
    if (this.isCanvasFile(file)) return this.readCanvasCompatibility(file);
    const deterministicCollision = this.plugin.app.vault.getAbstractFileByPath(this.getCompanionPath(file));
    if (deterministicCollision) return {};
    return {};
  }

  read(file: TFile): FilePropertyRecord {
    return this.getFrontmatter(file);
  }

  /** Compatibility read for consumers of the deprecated Canvas-only API. */
  readCanvasCompatibility(file: TFile): FilePropertyRecord {
    if (!this.isCanvasFile(file)) return {};
    const activeCompanion = this.getCompanionFile(file);
    if (activeCompanion) {
      const raw = this.readRawFrontmatterSync(activeCompanion);
      return raw ? this.extractUserProperties(raw) : {};
    }
    const indexed = this.companionsBySourcePath.get(this.pathKey(file.path));
    if (indexed && indexed.size > 0) return {};
    const primed = this.legacyCanvasBySourcePath.get(this.pathKey(file.path));
    if (primed) return this.cloneRecord(primed);
    const metadata = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? this.sortUserProperties(this.sanitizeUserProperties(metadata as FilePropertyRecord))
      : {};
  }

  async getFrontmatterAsync(file: TFile): Promise<FilePropertyRecord> {
    if (!this.isPropertyTarget(file)) return {};
    await this.awaitMetadataResolvedIndex();
    return this.serialize(async () => {
      const candidates = await this.findCompanionsForSourcePath(file.path);
      this.assertUnambiguousCandidates(file.path, candidates);
      if (candidates.length === 1) {
        const raw = await this.readAndValidateCompanion(candidates[0], file.path);
        if (this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)) return {};
        let user = this.extractUserProperties(raw);
        if (this.isCanvasFile(file) && !this.hasReservedKey(raw, FILE_PROPERTY_KEYS.importedCanvasAt)) {
          const legacy = await this.readLegacyCanvasFrontmatter(file);
          user = this.mergeMissingProperties(user, legacy.frontmatter);
        }
        return user;
      }

      if (this.isCanvasFile(file)) {
        return (await this.readLegacyCanvasFrontmatter(file)).frontmatter;
      }
      return {};
    });
  }

  async ensureCompanion(
    file: TFile,
    options: EnsureFilePropertiesOptions = {},
    cause: FilePropertiesMutationCause = { kind: 'user' },
  ): Promise<TFile> {
    const expectedSourcePath = this.normalizeVaultPath(options.expectedSourcePath || file.path);
    await this.awaitMetadataResolvedIndex();
    return this.serialize(async () => {
      this.assertLiveSourceAtPath(file, expectedSourcePath);
      const ensured = await this.ensureCompanionUnlocked(file, { ...options, expectedSourcePath });
      if (ensured.changed) {
        await this.notifyChanged({
          action: ensured.created ? 'created' : 'updated',
          sourceFile: file,
          sourcePath: file.path,
          companionFile: ensured.companion,
          companionPath: ensured.companion.path,
          frontmatter: ensured.user,
        }, {
          cause,
          changedKeys: Object.keys(ensured.user),
        });
      }
      return ensured.companion;
    });
  }

  async processFrontMatter(
    file: TFile,
    mutator: FilePropertyMutator,
    cause?: FilePropertiesMutationCause,
  ): Promise<boolean> {
    return this.process(file, mutator, cause);
  }

  async process(
    file: TFile,
    mutator: FilePropertyMutator,
    cause: FilePropertiesMutationCause = { kind: 'user' },
  ): Promise<boolean> {
    if (!this.isPropertyTarget(file)) return false;
    const expectedSourcePath = this.normalizeVaultPath(file.path);
    const normalizedCause = this.normalizeMutationCause(cause, 'user');
    await this.awaitMetadataResolvedIndex();
    return this.serializeSourceMutation(expectedSourcePath, async () => {
      const ensured = await this.serialize(async () => {
        this.assertLiveSourceAtPath(file, expectedSourcePath);
        return this.ensureCompanionUnlocked(file, {
          importLegacyCanvas: true,
          expectedSourcePath,
        });
      });
      const before = this.sortUserProperties(ensured.user);
      const next = this.cloneRecord(before);
      // Consumer code may be asynchronous, but it never occupies the global
      // lifecycle/index queue. Only this source's mutation queue is held.
      await mutator(next);
      const normalized = this.sortUserProperties(this.sanitizeUserProperties(next));
      const propertyChanged = !this.recordsEqual(before, normalized);
      return this.serialize(async () => {
        this.assertLiveSourceAtPath(file, expectedSourcePath);
        if (propertyChanged) {
          const raw = this.buildReservedRecord(file, ensured.raw, normalized);
          ensured.raw = await this.writeRawFrontmatter(ensured.companion, raw, ensured.raw);
          ensured.user = this.extractUserProperties(ensured.raw);
        }

        const changed = ensured.changed || propertyChanged;
        if (changed) {
          await this.notifyChanged({
            action: ensured.created ? 'created' : 'updated',
            sourceFile: file,
            sourcePath: expectedSourcePath,
            companionFile: ensured.companion,
            companionPath: ensured.companion.path,
            frontmatter: ensured.user,
          }, {
            cause: normalizedCause,
            changedKeys: ensured.created
              ? Object.keys(ensured.user)
              : this.changedUserPropertyKeys(before, ensured.user),
          });
        }
        return changed;
      });
    });
  }

  async initializeForConversion(file: TFile, properties: FilePropertyRecord): Promise<TFile> {
    const expectedSourcePath = this.normalizeVaultPath(file.path);
    await this.awaitMetadataResolvedIndex();
    return this.serialize(async () => {
      this.assertLiveSourceAtPath(file, expectedSourcePath);
      const ensured = await this.ensureCompanionUnlocked(file, {
        initialProperties: properties,
        importLegacyCanvas: true,
        expectedSourcePath,
      });
      if (ensured.changed) {
        await this.notifyChanged({
          action: 'initialized',
          sourceFile: file,
          sourcePath: file.path,
          companionFile: ensured.companion,
          companionPath: ensured.companion.path,
          frontmatter: ensured.user,
        }, {
          explicit: true,
          changedKeys: Object.keys(ensured.user),
        });
      }
      return ensured.companion;
    });
  }

  /**
   * Explicitly attaches a retained missing companion to a live non-Markdown
   * file. This is the only operation that clears tpsGcmSourceMissing.
   */
  async relinkCompanion(
    companion: TFile,
    file: TFile,
    cause: FilePropertiesMutationCause = { kind: 'user' },
  ): Promise<TFile> {
    this.assertPropertyTarget(file);
    this.assertLiveSource(file);
    const expectedSourcePath = this.normalizeVaultPath(file.path);
    const companionPath = companion.path;
    await this.awaitMetadataResolvedIndex();
    return this.serialize(async () => {
      this.assertLiveSourceAtPath(file, expectedSourcePath);
      if (!this.isCompanionFile(companion)) {
        throw new Error(`Not a GCM file-property companion: ${companionPath}`);
      }
      const raw = await this.readRawFrontmatterAsync(companion);
      if (!raw) throw new Error(`Cannot read GCM file-property companion ${companion.path}`);
      const previousSourcePath = this.validateCompanionRecord(raw, companion);
      const fileId = this.readReservedString(raw, FILE_PROPERTY_KEYS.id);
      if (!this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)) {
        throw new Error(`File-property companion ${companion.path} is not marked missing.`);
      }
      if (!this.isUniqueIndexedIdentity(companion, previousSourcePath, fileId)) {
        throw new Error(`GCM file-property identity ${fileId} is duplicated or ambiguous for ${previousSourcePath}`);
      }
      const targetCandidates = await this.findCompanionsForSourcePath(expectedSourcePath);
      this.assertLiveSourceAtPath(file, expectedSourcePath);
      if (targetCandidates.some((candidate) => candidate !== companion)) {
        throw new Error(`Another GCM file-property companion already maps to ${file.path}`);
      }

      this.assertLiveSourceAtPath(file, expectedSourcePath);
      const nextRaw = this.buildReservedRecord(file, raw, this.extractUserProperties(raw));
      const persistedRaw = await this.writeRawFrontmatter(companion, nextRaw, raw);
      let targetPath = this.getCompanionPath(file, fileId);
      const collision = this.plugin.app.vault.getAbstractFileByPath(targetPath);
      if (collision && collision !== companion) targetPath = companion.path;
      const oldPath = companion.path;
      if (oldPath !== targetPath) {
        try {
          await this.ensureParentFolder(targetPath);
          this.assertLiveSourceAtPath(file, expectedSourcePath);
          await this.plugin.app.vault.rename(companion, targetPath);
          this.cachedRawByCompanionPath.delete(this.pathKey(oldPath));
          this.cacheRawFrontmatter(companion, persistedRaw);
        } catch (error) {
          logger.warn('[TPS GCM] Relinked file properties but retained the companion at its current path', {
            source: file.path,
            companion: oldPath,
            target: targetPath,
            error,
          });
        }
      }
      await this.notifyChanged({
        action: 'relinked',
        sourceFile: file,
        sourcePath: expectedSourcePath,
        companionFile: companion,
        companionPath: companion.path,
        frontmatter: this.extractUserProperties(persistedRaw),
      }, {
        cause,
        changedKeys: Object.keys(this.extractUserProperties(persistedRaw)),
      });
      return companion;
    });
  }

  /**
   * Keeps an exact-path orphan as retained history and gives the live
   * replacement a new, independent property identity.
   */
  async startFreshCompanion(file: TFile): Promise<TFile> {
    this.assertPropertyTarget(file);
    this.assertLiveSource(file);
    const expectedSourcePath = this.normalizeVaultPath(file.path);
    await this.awaitMetadataResolvedIndex();
    return this.serialize(async () => {
      this.assertLiveSourceAtPath(file, expectedSourcePath);
      const candidates = await this.findCompanionsForSourcePath(expectedSourcePath);
      this.assertLiveSourceAtPath(file, expectedSourcePath);
      this.assertUnambiguousCandidates(expectedSourcePath, candidates);
      if (candidates.length !== 1) {
        throw new Error(`No unique retained file-property companion maps to ${file.path}.`);
      }

      const retained = candidates[0];
      const retainedRaw = await this.readAndValidateCompanion(retained, file.path);
      const retainedId = this.readReservedString(retainedRaw, FILE_PROPERTY_KEYS.id);
      if (!this.readReservedBoolean(retainedRaw, FILE_PROPERTY_KEYS.sourceMissing)) {
        throw new Error(`The file-property companion for ${file.path} is not retained as missing.`);
      }
      if (!this.isUniqueIndexedIdentity(retained, file.path, retainedId)) {
        throw new Error(`GCM file-property identity ${retainedId} is duplicated or ambiguous for ${file.path}`);
      }

      const tombstoneRaw = this.cloneRecord(retainedRaw);
      tombstoneRaw[FILE_PROPERTY_KEYS.sourceMissing] = true;
      tombstoneRaw[FILE_PROPERTY_KEYS.tombstonedAt] = new Date().toISOString();
      deleteValueCaseInsensitive(tombstoneRaw, FILE_PROPERTY_KEYS.source);
      this.assertLiveSourceAtPath(file, expectedSourcePath);
      await this.writeRawFrontmatter(retained, tombstoneRaw, retainedRaw);
      let ensured: EnsuredCompanion;
      try {
        this.assertLiveSourceAtPath(file, expectedSourcePath);
        ensured = await this.ensureCompanionUnlocked(file, {
          importLegacyCanvas: false,
          expectedSourcePath,
        });
        if (!ensured.created || this.readReservedString(ensured.raw, FILE_PROPERTY_KEYS.id) === retainedId) {
          throw new Error(`Could not create an independent file-property identity for ${file.path}.`);
        }
      } catch (error) {
        try {
          await this.writeRawFrontmatter(retained, retainedRaw, tombstoneRaw);
        } catch (restoreError) {
          logger.error('[TPS GCM] Could not restore retained file properties after start-fresh failed', {
            source: expectedSourcePath,
            companion: retained.path,
            error: restoreError,
          });
          throw new Error(`Could not start fresh or restore retained file properties for ${expectedSourcePath}: ${String(restoreError)}`);
        }
        throw error;
      }
      await this.notifyChanged({
        action: 'tombstoned',
        sourceFile: null,
        sourcePath: expectedSourcePath,
        companionFile: retained,
        companionPath: retained.path,
        frontmatter: {},
      }, {
        activeSourceFile: null,
        explicit: true,
        emitLegacyCanvasEvent: false,
        itemId: retainedId,
      });
      await this.notifyChanged({
        action: 'created',
        sourceFile: file,
        sourcePath: expectedSourcePath,
        companionFile: ensured.companion,
        companionPath: ensured.companion.path,
        frontmatter: ensured.user,
      }, {
        activeSourceFile: file,
        explicit: true,
        changedKeys: Object.keys(ensured.user),
      });
      return ensured.companion;
    });
  }

  async updateValues(
    files: TFile[],
    updates: FilePropertyRecord,
    cause?: FilePropertiesMutationCause,
  ): Promise<TFile[]> {
    return (await this.processMany(files, (frontmatter) => {
      for (const [key, value] of Object.entries(updates || {})) {
        if (value === undefined || value === null) deleteValueCaseInsensitive(frontmatter, key);
        else setValueCaseInsensitive(frontmatter, key, value);
      }
    }, cause)).updated;
  }

  async setListValues(
    files: TFile[],
    key: string,
    values: unknown[],
    cause?: FilePropertiesMutationCause,
  ): Promise<TFile[]> {
    return (await this.processMany(files, (frontmatter) => {
      const normalized = this.normalizeList(values);
      if (normalized.length === 0) deleteValueCaseInsensitive(frontmatter, key);
      else setValueCaseInsensitive(frontmatter, key, normalized);
    }, cause)).updated;
  }

  async addValuesToList(
    files: TFile[],
    key: string,
    values: unknown[],
    cause?: FilePropertiesMutationCause,
  ): Promise<TFile[]> {
    const additions = this.normalizeList(values);
    if (additions.length === 0) return [];
    return (await this.processMany(files, (frontmatter) => {
      const actual = findKeyCaseInsensitive(frontmatter, key) || key;
      const current = this.normalizeList(frontmatter[actual]);
      const seen = new Set(current.map((value) => casefold(String(value))));
      for (const value of additions) {
        const marker = casefold(String(value));
        if (seen.has(marker)) continue;
        seen.add(marker);
        current.push(value);
      }
      setValueCaseInsensitive(frontmatter, actual, current);
    }, cause)).updated;
  }

  async removeValuesFromList(
    files: TFile[],
    key: string,
    values: unknown[],
    cause?: FilePropertiesMutationCause,
  ): Promise<TFile[]> {
    const removals = new Set(this.normalizeList(values).map((value) => casefold(String(value))));
    if (removals.size === 0) return [];
    return (await this.processMany(files, (frontmatter) => {
      const actual = findKeyCaseInsensitive(frontmatter, key);
      if (!actual) return;
      const remaining = this.normalizeList(frontmatter[actual])
        .filter((value) => !removals.has(casefold(String(value))));
      if (remaining.length === 0) delete frontmatter[actual];
      else frontmatter[actual] = remaining;
    }, cause)).updated;
  }

  async deleteKeys(
    files: TFile[],
    keys: string[],
    cause?: FilePropertiesMutationCause,
  ): Promise<TFile[]> {
    const normalized = keys.map((key) => String(key || '').trim()).filter(Boolean);
    if (normalized.length === 0) return [];
    return (await this.processMany(files, (frontmatter) => {
      for (const key of normalized) deleteValueCaseInsensitive(frontmatter, key);
    }, cause)).updated;
  }

  /** Detailed bulk surface for callers that need per-file diagnostics. */
  async processMany(
    files: TFile[],
    mutator: FilePropertyMutator,
    cause: FilePropertiesMutationCause = { kind: 'user' },
  ): Promise<FilePropertiesBulkMutationResult> {
    const normalizedCause = this.normalizeMutationCause(cause, 'user');
    const targets = (files || []).filter((file): file is TFile => this.isPropertyTarget(file));
    const updated: TFile[] = [];
    const failures: FilePropertiesBulkMutationFailure[] = [];
    for (const file of targets) {
      try {
        if (await this.process(file, mutator, normalizedCause)) updated.push(file);
      } catch (error) {
        const message = this.safeMutationErrorMessage(error);
        failures.push({ file, path: file.path, message });
        logger.error('[TPS GCM] Native file-property mutation failed', {
          file: file.path,
          causeKind: normalizedCause.kind,
          sourcePluginId: normalizedCause.sourcePluginId,
          surface: normalizedCause.surface,
          error,
        });
      }
    }
    if (normalizedCause.kind === 'user' && targets.length > 1 && failures.length > 0) {
      const labels = failures.slice(0, 3).map(({ file, path }) => file.basename || path);
      const more = failures.length > labels.length ? ` and ${failures.length - labels.length} more` : '';
      new Notice(
        `Could not update file properties for ${failures.length} of ${targets.length} files: ${labels.join(', ')}${more}.`,
        8000,
      );
    }
    return { updated, failures };
  }

  /** Captures the unique pre-rename mapping before queued rename handlers run. */
  captureSourceRenameCompanion(sourcePath: string): TFile | null {
    const normalizedPath = this.normalizeVaultPath(sourcePath);
    const candidates = this.companionsBySourcePath.get(this.pathKey(normalizedPath));
    if (!candidates || candidates.size !== 1) return null;
    const [companion] = candidates;
    const raw = this.readRawFrontmatterSync(companion);
    const fileId = raw ? this.readReservedString(raw, FILE_PROPERTY_KEYS.id) : '';
    return raw
      && !this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)
      && this.pathKey(this.readReservedString(raw, FILE_PROPERTY_KEYS.sourcePath)) === this.pathKey(normalizedPath)
      && this.isUniqueIndexedIdentity(companion, normalizedPath, fileId)
      && this.plugin.app.vault.getAbstractFileByPath(companion.path) === companion
      ? companion
      : null;
  }

  invalidatePendingMarkdownTarget(fileOrPath: TFile | string): void {
    const pathKey = this.pathKey(typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path);
    for (const [key, identity] of this.pendingMarkdownTargetsByPath.entries()) {
      if (key === pathKey
        || (fileOrPath instanceof TFile
          && (identity.targetFile === fileOrPath || identity.companionFile === fileOrPath))) {
        this.pendingMarkdownTargetsByPath.delete(key);
      }
    }
  }

  invalidateLegacyCanvas(fileOrPath: TFile | string): void {
    const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
    this.legacyCanvasBySourcePath.delete(this.pathKey(path));
  }

  async handlePendingMarkdownTargetRename(
    file: TFile,
    oldPath: string,
    capturedNewPath: string = file.path,
  ): Promise<TFile | null> {
    const normalizedOldPath = this.normalizeVaultPath(oldPath);
    const renamedPath = this.normalizeVaultPath(capturedNewPath);
    if (!normalizedOldPath || this.extensionForPath(renamedPath) !== 'md') return null;
    return this.serialize(async () => {
      const identity = this.pendingMarkdownTargetsByPath.get(this.pathKey(normalizedOldPath));
      const liveIdentity = this.plugin.app.vault.getAbstractFileByPath(file.path) === file;
      if (!identity || identity.targetFile !== file || !liveIdentity) {
        if (identity) this.pendingMarkdownTargetsByPath.delete(this.pathKey(normalizedOldPath));
        return null;
      }
      const effectiveNewPath = this.normalizeVaultPath(file.path);
      if (this.extensionForPath(effectiveNewPath) !== 'md') return null;
      const companion = identity.companionFile;
      if (this.plugin.app.vault.getAbstractFileByPath(companion.path) !== companion) {
        this.invalidatePendingMarkdownTarget(file);
        return null;
      }
      const raw = await this.readRawFrontmatterAsync(companion);
      if (!raw
        || !this.isCompanionRecord(raw)
        || !this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)
        || !this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.needsMerge)
        || this.readReservedString(raw, FILE_PROPERTY_KEYS.id) !== identity.fileId
        || this.pathKey(this.readReservedString(raw, FILE_PROPERTY_KEYS.pendingTargetPath)) !== this.pathKey(normalizedOldPath)) {
        this.invalidatePendingMarkdownTarget(file);
        return null;
      }
      const nextRaw = this.cloneRecord(raw);
      nextRaw[FILE_PROPERTY_KEYS.pendingTargetPath] = effectiveNewPath;
      const persistedRaw = await this.writeRawFrontmatter(companion, nextRaw, raw);
      this.pendingMarkdownTargetsByPath.delete(this.pathKey(normalizedOldPath));
      this.pendingMarkdownTargetsByPath.set(this.pathKey(effectiveNewPath), identity);
      await this.notifyChanged({
        action: 'orphaned',
        sourceFile: null,
        sourcePath: identity.originalSourcePath,
        companionFile: companion,
        companionPath: companion.path,
        frontmatter: this.extractUserProperties(persistedRaw),
      }, { activeSourceFile: null });
      return companion;
    });
  }

  async handleSourceRename(
    file: TFile,
    oldPath: string,
    capturedNewPath: string = file.path,
    capturedCompanion: TFile | null = null,
  ): Promise<TFile | null> {
    const normalizedOldPath = this.normalizeVaultPath(oldPath);
    const renamedPath = this.normalizeVaultPath(capturedNewPath);
    if (!normalizedOldPath) return null;
    await this.awaitMetadataResolvedIndex();
    return this.serialize(async () => {
      const liveIdentity = this.plugin.app.vault.getAbstractFileByPath(file.path) === file;
      const effectiveNewPath = liveIdentity
        ? this.normalizeVaultPath(file.path)
        : renamedPath;
      this.legacyCanvasBySourcePath.delete(this.pathKey(normalizedOldPath));
      this.legacyCanvasBySourcePath.delete(this.pathKey(effectiveNewPath));
      let capturedCandidateValid = false;
      let candidates: TFile[] = [];
      if (capturedCompanion
        && this.plugin.app.vault.getAbstractFileByPath(capturedCompanion.path) === capturedCompanion) {
        const capturedRaw = await this.readRawFrontmatterAsync(capturedCompanion);
        const capturedId = capturedRaw ? this.readReservedString(capturedRaw, FILE_PROPERTY_KEYS.id) : '';
        const idCandidates = this.companionsByFileId.get(casefold(capturedId));
        capturedCandidateValid = Boolean(
          capturedRaw
          && !this.readReservedBoolean(capturedRaw, FILE_PROPERTY_KEYS.sourceMissing)
          && this.pathKey(this.readReservedString(capturedRaw, FILE_PROPERTY_KEYS.sourcePath)) === this.pathKey(normalizedOldPath)
          && idCandidates?.size === 1
          && idCandidates.has(capturedCompanion),
        );
        if (capturedCandidateValid) candidates = [capturedCompanion];
      }
      if (!capturedCandidateValid) {
        candidates = await this.findCompanionsForSourcePath(normalizedOldPath);
        this.assertUnambiguousCandidates(normalizedOldPath, candidates);
      }
      let restoringPendingTarget = false;
      let pendingIdentity: PendingMarkdownTargetIdentity | null = null;
      let pendingIdentityPathKey = '';
      if (candidates.length === 0
        && this.extensionForPath(normalizedOldPath) === 'md'
        && liveIdentity
        && this.isPropertyTargetPath(effectiveNewPath)) {
        const exactKey = this.pathKey(normalizedOldPath);
        const exact = this.pendingMarkdownTargetsByPath.get(exactKey);
        const matched = exact?.targetFile === file
          ? [exactKey, exact] as const
          : Array.from(this.pendingMarkdownTargetsByPath.entries()).find(([, identity]) => identity.targetFile === file);
        if (matched) {
          [pendingIdentityPathKey, pendingIdentity] = matched;
          if (this.plugin.app.vault.getAbstractFileByPath(pendingIdentity.companionFile.path) === pendingIdentity.companionFile) {
            candidates = [pendingIdentity.companionFile];
            restoringPendingTarget = true;
          }
        }
      }
      if (candidates.length === 0) return null;

      const companion = candidates[0];
      const raw = restoringPendingTarget || capturedCandidateValid
        ? await this.readRawFrontmatterAsync(companion)
        : await this.readAndValidateCompanion(companion, normalizedOldPath);
      if (!raw) throw new Error(`Cannot read GCM file-property companion ${companion.path}`);
      const mappedSourcePath = this.normalizeVaultPath(
        this.readReservedString(raw, FILE_PROPERTY_KEYS.sourcePath),
      );
      const fileId = this.readReservedString(raw, FILE_PROPERTY_KEYS.id);
      if (restoringPendingTarget && (!pendingIdentity
        || fileId !== pendingIdentity.fileId
        || !this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)
        || !this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.needsMerge)
        || this.pathKey(this.readReservedString(raw, FILE_PROPERTY_KEYS.pendingTargetPath)) !== pendingIdentityPathKey)) {
        this.invalidatePendingMarkdownTarget(file);
        return null;
      }
      const fileIdCandidates = this.companionsByFileId.get(casefold(fileId));
      const identityIsUnique = capturedCandidateValid
        ? fileIdCandidates?.size === 1 && fileIdCandidates.has(companion)
        : this.isUniqueIndexedIdentity(companion, mappedSourcePath, fileId);
      if (!identityIsUnique) {
        throw new Error(`GCM file-property identity ${fileId} is duplicated or ambiguous for ${mappedSourcePath}`);
      }
      if (this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing) && !restoringPendingTarget) return null;
      if (!liveIdentity) {
        const orphanRaw = this.buildReservedRecordForPath(
          mappedSourcePath,
          raw,
          this.extractUserProperties(raw),
          true,
        );
        await this.writeRawFrontmatter(companion, orphanRaw, raw);
        await this.notifyChanged({
          action: 'orphaned',
          sourceFile: null,
          sourcePath: mappedSourcePath,
          companionFile: companion,
          companionPath: companion.path,
          frontmatter: this.extractUserProperties(orphanRaw),
        });
        return companion;
      }
      if (!this.isPropertyTargetPath(effectiveNewPath)) {
        const orphanRaw = this.buildReservedRecordForPath(mappedSourcePath, raw, this.extractUserProperties(raw), true);
        if (this.extensionForPath(effectiveNewPath) === 'md') {
          orphanRaw[FILE_PROPERTY_KEYS.pendingTargetPath] = effectiveNewPath;
          orphanRaw[FILE_PROPERTY_KEYS.needsMerge] = true;
        }
        await this.writeRawFrontmatter(companion, orphanRaw, raw);
        await this.notifyChanged({
          action: 'orphaned',
          sourceFile: null,
          sourcePath: mappedSourcePath,
          companionFile: companion,
          companionPath: companion.path,
          frontmatter: this.extractUserProperties(orphanRaw),
        });
        if (this.extensionForPath(effectiveNewPath) === 'md') {
          this.invalidatePendingMarkdownTarget(file);
          this.pendingMarkdownTargetsByPath.set(this.pathKey(effectiveNewPath), {
            targetFile: file,
            companionFile: companion,
            fileId,
            originalSourcePath: mappedSourcePath,
          });
        }
        return companion;
      }

      let targetPath = this.getCompanionPathForSourcePath(
        effectiveNewPath,
        fileId,
      );
      const targetEntry = this.plugin.app.vault.getAbstractFileByPath(targetPath);
      if (targetEntry && targetEntry !== companion) targetPath = companion.path;
      const oldCompanionPath = companion.path;
      const nextRaw = this.buildReservedRecord(file, raw, this.extractUserProperties(raw));
      let archivedDestination: ArchivedDestinationHistory | null;
      try {
        archivedDestination = await this.archiveInactiveDestinationHistory(effectiveNewPath, companion);
      } catch (error) {
        await this.failClosedMoveCollision(companion, raw, mappedSourcePath, error);
        return companion;
      }
      let persistedRaw: FilePropertyRecord;
      try {
        this.assertLiveSourceAtPath(file, effectiveNewPath);
        persistedRaw = await this.writeRawFrontmatter(companion, nextRaw, raw);
      } catch (error) {
        await this.restoreArchivedDestinationHistory(archivedDestination, error);
        throw error;
      }
      await this.notifyArchivedDestinationHistory(archivedDestination);
      if (restoringPendingTarget) this.invalidatePendingMarkdownTarget(file);
      if (oldCompanionPath !== targetPath) {
        try {
          await this.ensureParentFolder(targetPath);
          await this.plugin.app.vault.rename(companion, targetPath);
          this.cachedRawByCompanionPath.delete(this.pathKey(oldCompanionPath));
          this.cacheRawFrontmatter(companion, persistedRaw);
        } catch (error) {
          logger.warn('[TPS GCM] File-property mapping updated but companion relocation failed; retaining current path', {
            source: file.path,
            companion: oldCompanionPath,
            target: targetPath,
            error,
          });
        }
      }

      await this.notifyChanged({
        action: 'renamed',
        sourceFile: file,
        sourcePath: effectiveNewPath,
        companionFile: companion,
        companionPath: companion.path,
        frontmatter: this.extractUserProperties(persistedRaw),
      }, {
        activeSourceFile: file,
      });
      return companion;
    });
  }

  async handleSourceDelete(fileOrPath: TFile | string): Promise<TFile | null> {
    const sourcePath = this.normalizeVaultPath(
      typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path,
    );
    if (!sourcePath || this.extensionForPath(sourcePath) === 'md') return null;
    await this.awaitMetadataResolvedIndex();
    return this.serialize(async () => {
      this.legacyCanvasBySourcePath.delete(this.pathKey(sourcePath));
      const candidates = await this.findCompanionsForSourcePath(sourcePath);
      this.assertUnambiguousCandidates(sourcePath, candidates);
      if (candidates.length === 0) return null;
      const companion = candidates[0];
      const raw = await this.readAndValidateCompanion(companion, sourcePath);
      const nextRaw = this.buildReservedRecordForPath(sourcePath, raw, this.extractUserProperties(raw), true);
      if (!this.recordsEqual(raw, nextRaw)) await this.writeRawFrontmatter(companion, nextRaw, raw);
      await this.notifyChanged({
        action: 'orphaned',
        sourceFile: null,
        sourcePath,
        companionFile: companion,
        companionPath: companion.path,
        frontmatter: this.extractUserProperties(nextRaw),
      });
      return companion;
    });
  }

  async handleSourceCreate(file: TFile): Promise<TFile | null> {
    if (!this.isPropertyTarget(file)) return null;
    this.invalidateLegacyCanvas(file);
    await this.awaitMetadataResolvedIndex();
    return this.serialize(async () => {
      const candidates = await this.findCompanionsForSourcePath(file.path);
      this.assertUnambiguousCandidates(file.path, candidates);
      const deterministic = this.plugin.app.vault.getAbstractFileByPath(this.getCompanionPath(file));
      if (candidates.length === 0) {
        if (deterministic) throw this.collisionError(file.path, this.getCompanionPath(file));
        return null;
      }

      let companion = candidates[0];
      const raw = await this.readAndValidateCompanion(companion, file.path);
      if (this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)) {
        return null;
      }
      let targetPath = this.getCompanionPath(file, this.readReservedString(raw, FILE_PROPERTY_KEYS.id));
      if (companion.path !== targetPath) {
        if (deterministic && deterministic !== companion) targetPath = companion.path;
      }
      const nextRaw = this.buildReservedRecord(file, raw, this.extractUserProperties(raw));
      const persistedRaw = !this.recordsEqual(raw, nextRaw)
        ? await this.writeRawFrontmatter(companion, nextRaw, raw)
        : raw;
      if (companion.path !== targetPath) {
        const oldPath = companion.path;
        try {
          await this.ensureParentFolder(targetPath);
          await this.plugin.app.vault.rename(companion, targetPath);
          this.cachedRawByCompanionPath.delete(this.pathKey(oldPath));
          this.cacheRawFrontmatter(companion, persistedRaw);
        } catch (error) {
          logger.warn('[TPS GCM] Restored file-property mapping but retained companion after relocation failed', {
            source: file.path,
            companion: oldPath,
            target: targetPath,
            error,
          });
        }
      }
      await this.notifyChanged({
        action: 'restored',
        sourceFile: file,
        sourcePath: file.path,
        companionFile: companion,
        companionPath: companion.path,
        frontmatter: this.extractUserProperties(persistedRaw),
      });
      return companion;
    });
  }

  async handleSourceFolderRename(
    folderOrNewPath: TFolder | string,
    oldFolderPath: string,
    capturedNewPath?: string,
  ): Promise<FilePropertiesFolderLifecycleReport> {
    await this.awaitMetadataResolvedIndex();
    return this.serialize(async () => {
      const report = this.createFolderLifecycleReport();
      const oldFolder = this.normalizeVaultPath(oldFolderPath);
      const folder = folderOrNewPath instanceof TFolder ? folderOrNewPath : null;
      const capturedFolderPath = this.normalizeVaultPath(
        capturedNewPath || (typeof folderOrNewPath === 'string' ? folderOrNewPath : folder?.path),
      );
      const resolveLiveFolderPath = (): string | null => {
        if (!folder) return capturedFolderPath || null;
        const livePath = this.normalizeVaultPath(folder.path);
        return livePath && this.plugin.app.vault.getAbstractFileByPath(livePath) === folder
          ? livePath
          : null;
      };
      if (!oldFolder || !capturedFolderPath) {
        report.conflicts.push('Folder rename reconciliation requires non-empty old and new paths.');
        return report;
      }
      await this.rebuildCompanionIndexUnlocked();
      const recordsBySource = await this.collectCompanionRecordsUnderFolder(oldFolder, report);
      for (const records of recordsBySource.values()) {
        if (records.length !== 1) {
          report.conflicts.push(
            `Multiple GCM file-property companions map to ${records[0].sourcePath}: ${records.map((entry) => entry.companion.path).join(', ')}`,
          );
          continue;
        }
        const { companion, raw, sourcePath } = records[0];
        if (this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)) {
          report.conflicts.push(`Cannot automatically relink missing file properties for ${sourcePath}`);
          continue;
        }
        const fileId = this.readReservedString(raw, FILE_PROPERTY_KEYS.id);
        if (!this.isUniqueIndexedIdentity(companion, sourcePath, fileId)) {
          report.conflicts.push(`GCM file-property identity ${fileId} is duplicated or ambiguous for ${sourcePath}`);
          continue;
        }
        const suffix = this.pathKey(sourcePath) === this.pathKey(oldFolder)
          ? ''
          : sourcePath.slice(oldFolder.length).replace(/^\/+/, '');
        let workingRaw = raw;
        let workingSourcePath = sourcePath;
        let recordUpdated = false;
        let recordMoved = false;
        let completed = false;
        const staleDestinationArchives: ArchivedDestinationHistory[] = [];

        for (let attempt = 0; attempt < 8; attempt += 1) {
          const liveFolderPath = resolveLiveFolderPath();
          if (!liveFolderPath) {
            const orphanRaw = this.buildReservedRecordForPath(
              workingSourcePath,
              workingRaw,
              this.extractUserProperties(workingRaw),
              true,
            );
            try {
              if (!this.recordsEqual(workingRaw, orphanRaw)) {
                workingRaw = await this.writeRawFrontmatter(companion, orphanRaw, workingRaw);
                recordUpdated = true;
              }
              if (resolveLiveFolderPath()) continue;
              report.orphaned += 1;
              this.legacyCanvasBySourcePath.delete(this.pathKey(sourcePath));
              await this.notifyChanged({
                action: 'orphaned',
                sourceFile: null,
                sourcePath: workingSourcePath,
                companionFile: companion,
                companionPath: companion.path,
                frontmatter: this.extractUserProperties(workingRaw),
              });
            } catch (error) {
              report.conflicts.push(`Cannot mark ${sourcePath} missing after folder rename: ${String(error)}`);
            }
            completed = true;
            break;
          }

          const newSourcePath = normalizePath(suffix ? `${liveFolderPath}/${suffix}` : liveFolderPath);
          const source = this.plugin.app.vault.getAbstractFileByPath(newSourcePath);
          const confirmedFolderPath = resolveLiveFolderPath();
          if (confirmedFolderPath !== liveFolderPath) continue;
          if (!(source instanceof TFile) || !this.isPropertyTarget(source)) {
            report.conflicts.push(`Cannot map ${sourcePath}; no live non-Markdown source exists at ${newSourcePath}`);
            const orphanRaw = this.buildReservedRecordForPath(
              workingSourcePath,
              workingRaw,
              this.extractUserProperties(workingRaw),
              true,
            );
            try {
              if (!this.recordsEqual(workingRaw, orphanRaw)) {
                workingRaw = await this.writeRawFrontmatter(companion, orphanRaw, workingRaw);
                recordUpdated = true;
              }
              if (resolveLiveFolderPath() !== liveFolderPath) continue;
              report.orphaned += 1;
              this.legacyCanvasBySourcePath.delete(this.pathKey(sourcePath));
              await this.notifyChanged({
                action: 'orphaned',
                sourceFile: null,
                sourcePath: workingSourcePath,
                companionFile: companion,
                companionPath: companion.path,
                frontmatter: this.extractUserProperties(workingRaw),
              });
            } catch (error) {
              report.conflicts.push(`Cannot mark ${sourcePath} missing after folder rename: ${String(error)}`);
            }
            completed = true;
            break;
          }

          let archivedDestination: ArchivedDestinationHistory | null = null;
          try {
            archivedDestination = await this.archiveInactiveDestinationHistory(newSourcePath, companion);
          } catch (error) {
            report.conflicts.push(`Cannot update ${sourcePath} to ${newSourcePath}: ${String(error)}`);
            try {
              await this.failClosedMoveCollision(companion, workingRaw, workingSourcePath, error);
              recordUpdated = true;
              report.orphaned += 1;
            } catch (failClosedError) {
              report.conflicts.push(`Cannot preserve ${sourcePath} after destination collision: ${String(failClosedError)}`);
            }
            completed = true;
            break;
          }
          if (resolveLiveFolderPath() !== liveFolderPath
            || this.plugin.app.vault.getAbstractFileByPath(newSourcePath) !== source) {
            try {
              await this.restoreArchivedDestinationHistory(archivedDestination, 'folder moved before mapping');
            } catch (error) {
              report.conflicts.push(String(error));
              completed = true;
              break;
            }
            continue;
          }

          const nextRaw = this.buildReservedRecord(source, workingRaw, this.extractUserProperties(workingRaw));
          try {
            workingRaw = await this.writeRawFrontmatter(companion, nextRaw, workingRaw);
            workingSourcePath = newSourcePath;
            recordUpdated = true;
          } catch (error) {
            try {
              await this.restoreArchivedDestinationHistory(archivedDestination, error);
            } catch (restoreError) {
              report.conflicts.push(String(restoreError));
              completed = true;
              break;
            }
            report.conflicts.push(`Cannot update ${sourcePath} to ${newSourcePath}: ${String(error)}`);
            completed = true;
            break;
          }

          if (resolveLiveFolderPath() !== liveFolderPath
            || this.plugin.app.vault.getAbstractFileByPath(newSourcePath) !== source) {
            if (archivedDestination) staleDestinationArchives.push(archivedDestination);
            continue;
          }

          let targetCompanionPath = this.getCompanionPath(source, fileId);
          const collision = this.plugin.app.vault.getAbstractFileByPath(targetCompanionPath);
          if (collision && collision !== companion) {
            report.conflicts.push(`Cannot move ${companion.path}; ${targetCompanionPath} already exists`);
            targetCompanionPath = companion.path;
          }
          const oldCompanionPath = companion.path;
          if (oldCompanionPath !== targetCompanionPath) {
            try {
              await this.ensureParentFolder(targetCompanionPath);
              await this.plugin.app.vault.rename(companion, targetCompanionPath);
              this.cachedRawByCompanionPath.delete(this.pathKey(oldCompanionPath));
              this.cacheRawFrontmatter(companion, workingRaw);
              recordMoved = true;
            } catch (error) {
              report.conflicts.push(
                `Updated ${sourcePath} to ${newSourcePath}, but kept ${oldCompanionPath}: ${String(error)}`,
              );
            }
          }

          if (resolveLiveFolderPath() !== liveFolderPath
            || this.plugin.app.vault.getAbstractFileByPath(newSourcePath) !== source) {
            if (archivedDestination) staleDestinationArchives.push(archivedDestination);
            continue;
          }

          for (const staleArchive of staleDestinationArchives) {
            try {
              await this.restoreArchivedDestinationHistory(staleArchive, 'folder advanced to its final path');
            } catch (error) {
              report.conflicts.push(String(error));
            }
          }
          await this.notifyArchivedDestinationHistory(archivedDestination);
          if (resolveLiveFolderPath() !== liveFolderPath
            || this.plugin.app.vault.getAbstractFileByPath(newSourcePath) !== source) {
            if (archivedDestination) staleDestinationArchives.push(archivedDestination);
            continue;
          }
          this.legacyCanvasBySourcePath.delete(this.pathKey(sourcePath));
          this.legacyCanvasBySourcePath.delete(this.pathKey(newSourcePath));
          await this.notifyChanged({
            action: 'renamed',
            sourceFile: source,
            sourcePath: newSourcePath,
            companionFile: companion,
            companionPath: companion.path,
            frontmatter: this.extractUserProperties(workingRaw),
          });
          completed = true;
          break;
        }

        if (recordUpdated) report.updated += 1;
        if (recordMoved) report.moved += 1;
        if (!completed) {
          report.conflicts.push(`Cannot settle ${sourcePath}; its folder continued moving during reconciliation`);
        }
      }
      return report;
    });
  }

  async handleSourceFolderDelete(folderPath: string): Promise<FilePropertiesFolderLifecycleReport> {
    await this.awaitMetadataResolvedIndex();
    return this.serialize(async () => {
      const report = this.createFolderLifecycleReport();
      const folder = this.normalizeVaultPath(folderPath);
      if (!folder) {
        report.conflicts.push('Folder delete reconciliation requires a non-empty path.');
        return report;
      }
      await this.rebuildCompanionIndexUnlocked();
      const recordsBySource = await this.collectCompanionRecordsUnderFolder(folder, report);
      for (const records of recordsBySource.values()) {
        if (records.length !== 1) {
          report.conflicts.push(
            `Multiple GCM file-property companions map to ${records[0].sourcePath}: ${records.map((entry) => entry.companion.path).join(', ')}`,
          );
          continue;
        }
        const { companion, raw, sourcePath } = records[0];
        const fileId = this.readReservedString(raw, FILE_PROPERTY_KEYS.id);
        if (!this.isUniqueIndexedIdentity(companion, sourcePath, fileId)) {
          report.conflicts.push(`GCM file-property identity ${fileId} is duplicated or ambiguous for ${sourcePath}`);
          continue;
        }
        const nextRaw = this.buildReservedRecordForPath(sourcePath, raw, this.extractUserProperties(raw), true);
        try {
          if (!this.recordsEqual(raw, nextRaw)) {
            await this.writeRawFrontmatter(companion, nextRaw, raw);
            report.updated += 1;
          }
        } catch (error) {
          report.conflicts.push(`Cannot mark ${sourcePath} missing: ${String(error)}`);
          continue;
        }
        this.legacyCanvasBySourcePath.delete(this.pathKey(sourcePath));
        report.orphaned += 1;
        await this.notifyChanged({
          action: 'orphaned',
          sourceFile: null,
          sourcePath,
          companionFile: companion,
          companionPath: companion.path,
          frontmatter: this.extractUserProperties(nextRaw),
        });
      }
      return report;
    });
  }

  async reconcileCompanions(): Promise<FilePropertiesReconcileReport> {
    await this.awaitMetadataResolvedIndex();
    return this.serialize(async () => {
      const report: FilePropertiesReconcileReport = {
        scanned: 0,
        moved: 0,
        updated: 0,
        orphaned: 0,
        restored: 0,
        collisions: [],
      };
      this.companionsBySourcePath.clear();
      this.companionsByFileId.clear();
      this.indexedKeysByCompanion.clear();
      this.relinkCandidateCompanions.clear();
      this.globallyAvailableRelinkCandidates.clear();
      const companions = this.getAllCompanionFiles();
      report.scanned = companions.length;
      const vaultFiles = (this.plugin.app.vault as any).getFiles?.() || [];
      for (const entry of vaultFiles) {
        if (!(entry instanceof TFile)
          || !this.isManagedCatalogPath(entry.path)
          || String(entry.extension || '').toLocaleLowerCase() === 'md') continue;
        report.collisions.push(
          `Non-Markdown file inside the managed GCM file-property catalog cannot be a property source: ${entry.path}`,
        );
      }
      const bySource = new Map<string, Array<{ companion: TFile; raw: FilePropertyRecord; sourcePath: string }>>();

      for (const companion of companions) {
        try {
          const raw = await this.readRawFrontmatterAuthoritative(companion);
          const sourcePath = raw ? this.validateCompanionRecord(raw, companion) : '';
          if (!raw || !sourcePath) throw new Error(`Missing GCM file-property metadata in ${companion.path}`);
          if (this.readReservedString(raw, FILE_PROPERTY_KEYS.tombstonedAt)) continue;
          const key = this.pathKey(sourcePath);
          const group = bySource.get(key) || [];
          group.push({ companion, raw, sourcePath });
          bySource.set(key, group);
        } catch (error) {
          report.collisions.push(error instanceof Error ? error.message : String(error));
        }
      }

      const duplicateIds = new Set<string>();
      for (const [fileId, candidates] of this.companionsByFileId.entries()) {
        if (candidates.size <= 1) continue;
        duplicateIds.add(fileId);
        report.collisions.push(
          `GCM file-property identity ${fileId} is shared by ${Array.from(candidates).map((file) => file.path).join(', ')}`,
        );
      }

      for (const records of bySource.values()) {
        if (records.length !== 1) {
          report.collisions.push(`Multiple GCM file-property companions map to ${records[0].sourcePath}`);
          continue;
        }
        let { companion, raw, sourcePath } = records[0];
        try {
          if (duplicateIds.has(casefold(this.readReservedString(raw, FILE_PROPERTY_KEYS.id)))) continue;
          const source = this.plugin.app.vault.getAbstractFileByPath(sourcePath);
          const sourceMissing = this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing);
          const sourceFile = !sourceMissing && source instanceof TFile && this.isPropertyTarget(source) ? source : null;
          let desiredPath = sourceFile
            ? this.getCompanionPath(sourceFile, this.readReservedString(raw, FILE_PROPERTY_KEYS.id))
            : companion.path;
          const collision = this.plugin.app.vault.getAbstractFileByPath(desiredPath);
          if (collision && collision !== companion) {
            if (!this.isTombstoneForSource(collision, sourcePath)) {
              report.collisions.push(`Cannot move ${companion.path}; ${desiredPath} already exists`);
            }
            desiredPath = companion.path;
          }

          const nextRaw = sourceFile
            ? this.buildReservedRecord(sourceFile, raw, this.extractUserProperties(raw))
            : this.buildReservedRecordForPath(sourcePath, raw, this.extractUserProperties(raw), true);
          if (!this.recordsEqual(raw, nextRaw)) {
            raw = await this.writeRawFrontmatter(companion, nextRaw, raw);
            report.updated += 1;
            if (sourceFile) report.restored += 1;
            else report.orphaned += 1;
          }
          if (companion.path !== desiredPath) {
            const oldPath = companion.path;
            await this.ensureParentFolder(desiredPath);
            await this.plugin.app.vault.rename(companion, desiredPath);
            this.cachedRawByCompanionPath.delete(this.pathKey(oldPath));
            this.cacheRawFrontmatter(companion, raw);
            report.moved += 1;
          }
          if (sourceFile || this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)) {
            await this.notifyChanged({
              action: 'reconciled',
              sourceFile,
              sourcePath,
              companionFile: companion,
              companionPath: companion.path,
              frontmatter: this.extractUserProperties(raw),
            });
          }
        } catch (error) {
          report.collisions.push(`Cannot reconcile ${sourcePath} via ${companion.path}: ${String(error)}`);
        }
      }
      return report;
    });
  }

  async listKnownPropertyNames(): Promise<string[]> {
    await this.awaitMetadataResolvedIndex();
    return this.serialize(async () => {
      const names = new Map<string, string>();
      for (const companion of this.getAllCompanionFiles()) {
        const raw = await this.readRawFrontmatterAsync(companion);
        if (!raw
          || !this.isCompanionRecord(raw)
          || !this.getUniqueLiveSourceForCompanion(companion, raw)) continue;
        for (const key of Object.keys(this.extractUserProperties(raw))) {
          const normalized = casefold(key);
          if (!names.has(normalized)) names.set(normalized, key);
        }
      }
      return Array.from(names.values()).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
    });
  }

  private async ensureCompanionUnlocked(
    file: TFile,
    options: EnsureFilePropertiesOptions,
  ): Promise<EnsuredCompanion> {
    this.assertPropertyTarget(file);
    const expectedSourcePath = this.normalizeVaultPath(options.expectedSourcePath || file.path);
    this.assertLiveSourceAtPath(file, expectedSourcePath);
    const candidates = await this.findCompanionsForSourcePath(expectedSourcePath);
    this.assertLiveSourceAtPath(file, expectedSourcePath);
    this.assertUnambiguousCandidates(expectedSourcePath, candidates);

    let companion: TFile;
    let raw: FilePropertyRecord;
    let created = false;
    let changed = false;

    if (candidates.length === 1) {
      companion = candidates[0];
      raw = await this.readAndValidateCompanion(companion, expectedSourcePath);
      this.assertLiveSourceAtPath(file, expectedSourcePath);
      if (this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)) {
        throw new Error(`File properties for ${file.path} are retained as missing; relink them explicitly before editing.`);
      }
      let expectedPath = this.getCompanionPath(file, this.readReservedString(raw, FILE_PROPERTY_KEYS.id));
      const deterministicEntry = this.plugin.app.vault.getAbstractFileByPath(expectedPath);
      if (deterministicEntry && deterministicEntry !== companion) {
        expectedPath = companion.path;
      }
      if (companion.path !== expectedPath) {
        const oldPath = companion.path;
        try {
          await this.ensureParentFolder(expectedPath);
          this.assertLiveSourceAtPath(file, expectedSourcePath);
          await this.plugin.app.vault.rename(companion, expectedPath);
          this.cachedRawByCompanionPath.delete(this.pathKey(oldPath));
          this.cacheRawFrontmatter(companion, raw);
          changed = true;
        } catch (error) {
          logger.warn('[TPS GCM] Keeping valid file-property companion at its current path after relocation failed', {
            source: file.path,
            companion: oldPath,
            target: expectedPath,
            error,
          });
        }
      }
    } else {
      let initialUser = this.sanitizeUserProperties(options.initialProperties || {});
      let importedAt: string | null = null;
      if (this.isCanvasFile(file) && options.importLegacyCanvas !== false) {
        const legacy = await this.readLegacyCanvasFrontmatter(file);
        this.assertLiveSourceAtPath(file, expectedSourcePath);
        initialUser = this.mergeMissingProperties(initialUser, legacy.frontmatter);
        importedAt = legacy.importedAt;
      }
      this.assertLiveSourceAtPath(file, expectedSourcePath);
      raw = this.buildReservedRecord(file, {
        [FILE_PROPERTY_KEYS.id]: this.createFileId(),
        ...(importedAt ? { [FILE_PROPERTY_KEYS.importedCanvasAt]: importedAt } : {}),
      }, initialUser);
      const fileId = this.readReservedString(raw, FILE_PROPERTY_KEYS.id);
      let expectedPath = this.getCompanionPath(file, fileId);
      if (this.plugin.app.vault.getAbstractFileByPath(expectedPath)) {
        expectedPath = this.getByIdCompanionPath(fileId);
      }
      await this.ensureParentFolder(expectedPath);
      this.assertLiveSourceAtPath(file, expectedSourcePath);
      const collision = this.plugin.app.vault.getAbstractFileByPath(expectedPath);
      if (collision) throw this.collisionError(file.path, expectedPath);
      companion = await this.plugin.app.vault.create(expectedPath, this.serializeCompanion(raw));
      if (!(companion instanceof TFile) || companion.path !== expectedPath) {
        throw new Error(`Obsidian did not create the expected GCM file-property companion at ${expectedPath}`);
      }
      this.cacheRawFrontmatter(companion, raw);
      created = true;
      changed = true;
    }

    let user = this.extractUserProperties(raw);
    let nextRaw = raw;
    if (this.isCanvasFile(file)
      && options.importLegacyCanvas !== false
      && !this.hasReservedKey(raw, FILE_PROPERTY_KEYS.importedCanvasAt)) {
      const legacy = await this.readLegacyCanvasFrontmatter(file);
      this.assertLiveSourceAtPath(file, expectedSourcePath);
      user = this.mergeMissingProperties(user, legacy.frontmatter);
      nextRaw = this.buildReservedRecord(file, {
        ...raw,
        [FILE_PROPERTY_KEYS.importedCanvasAt]: legacy.importedAt,
      }, user);
    }
    if (options.initialProperties) {
      user = this.mergeMissingProperties(user, this.sanitizeUserProperties(options.initialProperties));
      nextRaw = this.buildReservedRecord(file, nextRaw, user);
    } else {
      nextRaw = this.buildReservedRecord(file, nextRaw, user);
    }
    if (!this.recordsEqual(raw, nextRaw)) {
      this.assertLiveSourceAtPath(file, expectedSourcePath);
      raw = await this.writeRawFrontmatter(companion, nextRaw, raw);
      changed = true;
    } else {
      this.cacheRawFrontmatter(companion, raw);
    }

    return { companion, raw, user: this.extractUserProperties(raw), changed, created };
  }

  private async awaitMetadataResolvedIndex(): Promise<void> {
    if (this.metadataResolvedIndexReady) return;
    // Hot reload can happen after Obsidian's one-shot metadata event. The
    // first mutation therefore performs the same bounded authoritative scan
    // rather than waiting indefinitely or creating a duplicate companion.
    await this.handleMetadataResolved();
  }

  private serializeSourceMutation<T>(sourcePath: string, operation: () => Promise<T>): Promise<T> {
    const key = this.pathKey(sourcePath);
    const previous = this.mutationQueuesBySourcePath.get(key) || Promise.resolve();
    const run = previous.then(operation, operation);
    const tail = run.then(() => undefined, () => undefined);
    this.mutationQueuesBySourcePath.set(key, tail);
    void tail.finally(() => {
      if (this.mutationQueuesBySourcePath.get(key) === tail) {
        this.mutationQueuesBySourcePath.delete(key);
      }
    });
    return run;
  }

  private normalizeMutationCause(
    cause: FilePropertiesMutationCause | null | undefined,
    fallbackKind: FilePropertiesMutationCause['kind'],
  ): FilePropertiesMutationCause {
    const kind = cause?.kind === 'user' || cause?.kind === 'automation'
      ? cause.kind
      : fallbackKind;
    const sourcePluginId = String(cause?.sourcePluginId || this.plugin.manifest.id).trim().slice(0, 160)
      || this.plugin.manifest.id;
    const surface = String(cause?.surface || '').trim().slice(0, 160);
    return {
      kind,
      sourcePluginId,
      ...(surface ? { surface } : {}),
    };
  }

  private safeMutationErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown mutation failure');
    return message.replace(/\s+/gu, ' ').trim().slice(0, 240) || 'Unknown mutation failure';
  }

  private async findCompanionsForSourcePath(sourcePath: string): Promise<TFile[]> {
    const expectedKey = this.pathKey(sourcePath);
    if (this.companionIndexReady) {
      const indexed = this.companionsBySourcePath.get(expectedKey);
      return indexed
        ? Array.from(indexed).filter((companion) => this.plugin.app.vault.getAbstractFileByPath(companion.path) === companion)
        : [];
    }
    const candidates: TFile[] = [];
    for (const companion of this.getAllCompanionFiles()) {
      const raw = await this.readRawFrontmatterAsync(companion);
      if (!raw || !this.isCompanionRecord(raw)) continue;
      if (this.readReservedString(raw, FILE_PROPERTY_KEYS.tombstonedAt)) continue;
      const mappedPath = this.readReservedString(raw, FILE_PROPERTY_KEYS.sourcePath);
      if (mappedPath && this.pathKey(mappedPath) === expectedKey) candidates.push(companion);
    }
    this.companionIndexReady = true;
    return candidates;
  }

  private getAllCompanionFiles(): TFile[] {
    const vault = this.plugin.app.vault as any;
    const source = typeof vault.getMarkdownFiles === 'function'
      ? vault.getMarkdownFiles()
      : typeof vault.getFiles === 'function'
        ? vault.getFiles()
        : [];
    return source.filter((file: unknown): file is TFile => this.isCompanionFile(file));
  }

  private createFolderLifecycleReport(): FilePropertiesFolderLifecycleReport {
    return { matched: 0, moved: 0, updated: 0, orphaned: 0, conflicts: [] };
  }

  private async collectCompanionRecordsUnderFolder(
    folderPath: string,
    report: FilePropertiesFolderLifecycleReport,
  ): Promise<Map<string, Array<{ companion: TFile; raw: FilePropertyRecord; sourcePath: string }>>> {
    const folderKey = this.pathKey(folderPath);
    const recordsBySource = new Map<
      string,
      Array<{ companion: TFile; raw: FilePropertyRecord; sourcePath: string }>
    >();
    for (const companion of this.getAllCompanionFiles()) {
      try {
        const raw = await this.readRawFrontmatterAsync(companion);
        const sourcePath = raw ? this.validateCompanionRecord(raw, companion) : '';
        if (!raw || !sourcePath) continue;
        if (this.readReservedString(raw, FILE_PROPERTY_KEYS.tombstonedAt)) continue;
        const sourceKey = this.pathKey(sourcePath);
        if (sourceKey !== folderKey && !sourceKey.startsWith(`${folderKey}/`)) continue;
        report.matched += 1;
        const records = recordsBySource.get(sourceKey) || [];
        records.push({ companion, raw, sourcePath });
        recordsBySource.set(sourceKey, records);
      } catch (error) {
        if (this.isCompanionPath(companion.path)) {
          report.conflicts.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
    return recordsBySource;
  }

  private async rebuildCompanionIndexUnlocked(scanAllMarkdown = false): Promise<void> {
    this.companionsBySourcePath.clear();
    this.companionsByFileId.clear();
    this.indexedKeysByCompanion.clear();
    this.relinkCandidateCompanions.clear();
    this.globallyAvailableRelinkCandidates.clear();
    const vault = this.plugin.app.vault as any;
    const candidates: TFile[] = scanAllMarkdown
      ? (typeof vault.getMarkdownFiles === 'function'
        ? vault.getMarkdownFiles()
        : (vault.getFiles?.() || []).filter((file: unknown) => (
          file instanceof TFile && String(file.extension || '').toLocaleLowerCase() === 'md'
        )))
      : this.getAllCompanionFiles();
    for (const companion of candidates) {
      const raw = scanAllMarkdown
        ? await this.readRawFrontmatterAuthoritative(companion)
        : await this.readRawFrontmatterAsync(companion);
      if (raw && this.isCompanionRecord(raw)) this.indexCompanion(companion, raw);
    }
    this.companionIndexReady = true;
  }

  private async primeLegacyCanvasCacheUnlocked(files?: TFile[]): Promise<number> {
    const source: TFile[] = files || (this.plugin.app.vault as any).getFiles?.() || [];
    let primed = 0;
    for (const file of source) {
      if (!this.isCanvasFile(file)) continue;
      try {
        await this.readLegacyCanvasFrontmatter(file);
        primed += 1;
      } catch (error) {
        logger.warn('[TPS GCM] Could not prime legacy Canvas properties', { file: file.path, error });
      }
    }
    return primed;
  }

  private indexCompanion(companion: TFile, raw: FilePropertyRecord): void {
    if (!this.isCompanionRecord(raw)) {
      this.removeCompanionFromIndex(companion);
      return;
    }
    const sourcePath = this.readReservedString(raw, FILE_PROPERTY_KEYS.sourcePath);
    const fileId = this.readReservedString(raw, FILE_PROPERTY_KEYS.id);
    if (!sourcePath || !fileId) {
      this.removeCompanionFromIndex(companion);
      return;
    }
    const tombstonedAt = this.readReservedString(raw, FILE_PROPERTY_KEYS.tombstonedAt);
    const sourceKey = tombstonedAt
      ? `\u0000tps-gcm-tombstone:${casefold(fileId)}:${this.pathKey(companion.path)}`
      : this.pathKey(sourcePath);
    const idKey = casefold(fileId);
    const indexed = this.indexedKeysByCompanion.get(companion);
    if (indexed?.sourceKey === sourceKey
      && indexed.idKey === idKey
      && this.companionsBySourcePath.get(sourceKey)?.has(companion)
      && this.companionsByFileId.get(idKey)?.has(companion)) {
      this.refreshRelinkCandidateGroups(sourceKey, idKey);
      return;
    }
    this.removeCompanionFromIndex(companion);
    const sourceCandidates = this.companionsBySourcePath.get(sourceKey) || new Set<TFile>();
    sourceCandidates.add(companion);
    this.companionsBySourcePath.set(sourceKey, sourceCandidates);
    const idCandidates = this.companionsByFileId.get(idKey) || new Set<TFile>();
    idCandidates.add(companion);
    this.companionsByFileId.set(idKey, idCandidates);
    this.indexedKeysByCompanion.set(companion, { sourceKey, idKey });
    this.refreshRelinkCandidateGroups(sourceKey, idKey);
  }

  private removeCompanionFromIndex(companion: TFile): void {
    const indexed = this.indexedKeysByCompanion.get(companion);
    this.relinkCandidateCompanions.delete(companion);
    this.globallyAvailableRelinkCandidates.delete(companion);
    if (!indexed) return;
    const sourceCandidates = this.companionsBySourcePath.get(indexed.sourceKey);
    sourceCandidates?.delete(companion);
    if (sourceCandidates?.size === 0) this.companionsBySourcePath.delete(indexed.sourceKey);
    const idCandidates = this.companionsByFileId.get(indexed.idKey);
    idCandidates?.delete(companion);
    if (idCandidates?.size === 0) this.companionsByFileId.delete(indexed.idKey);
    this.indexedKeysByCompanion.delete(companion);
    this.refreshRelinkCandidateGroups(indexed.sourceKey, indexed.idKey);
  }

  private refreshRelinkCandidateGroups(sourceKey: string, idKey: string): void {
    const affected = new Set<TFile>([
      ...(this.companionsBySourcePath.get(sourceKey) || []),
      ...(this.companionsByFileId.get(idKey) || []),
    ]);
    for (const candidate of affected) this.refreshRelinkCandidate(candidate);
  }

  private refreshRelinkCandidate(companion: TFile): void {
    const indexed = this.indexedKeysByCompanion.get(companion);
    const raw = this.cachedRawByCompanionPath.get(this.pathKey(companion.path))?.raw;
    const sourceCandidates = indexed
      ? this.companionsBySourcePath.get(indexed.sourceKey)
      : undefined;
    const idCandidates = indexed
      ? this.companionsByFileId.get(indexed.idKey)
      : undefined;
    const eligible = Boolean(
      indexed
      && raw
      && this.isCompanionRecord(raw)
      && !this.readReservedString(raw, FILE_PROPERTY_KEYS.tombstonedAt)
      && this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)
      && sourceCandidates?.size === 1
      && sourceCandidates.has(companion)
      && idCandidates?.size === 1
      && idCandidates.has(companion)
      && this.plugin.app.vault.getAbstractFileByPath(companion.path) === companion,
    );
    if (!eligible || !raw) {
      this.relinkCandidateCompanions.delete(companion);
      this.globallyAvailableRelinkCandidates.delete(companion);
      return;
    }

    this.relinkCandidateCompanions.add(companion);
    const sourcePath = this.normalizeVaultPath(this.readReservedString(raw, FILE_PROPERTY_KEYS.sourcePath));
    const formerSource = this.plugin.app.vault.getAbstractFileByPath(sourcePath);
    if (!(formerSource instanceof TFile) || !this.isPropertyTarget(formerSource)) {
      this.globallyAvailableRelinkCandidates.add(companion);
    } else {
      this.globallyAvailableRelinkCandidates.delete(companion);
    }
  }

  private getUniqueIndexedCompanion(sourcePath: string): TFile | null {
    const candidates = this.companionsBySourcePath.get(this.pathKey(sourcePath));
    if (!candidates || candidates.size !== 1) return null;
    const [companion] = candidates;
    const raw = this.readRawFrontmatterSync(companion);
    const fileId = raw ? this.readReservedString(raw, FILE_PROPERTY_KEYS.id) : '';
    if (!raw
      || this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)
      || !fileId
      || !this.isUniqueIndexedIdentity(companion, sourcePath, fileId)) return null;
    return this.plugin.app.vault.getAbstractFileByPath(companion.path) === companion ? companion : null;
  }

  private hasIndexedAmbiguity(sourcePath: string): boolean {
    const sourceCandidates = this.companionsBySourcePath.get(this.pathKey(sourcePath));
    if (!sourceCandidates) return false;
    if (sourceCandidates.size !== 1) return true;
    const [companion] = sourceCandidates;
    const raw = this.readRawFrontmatterSync(companion);
    const fileId = raw ? this.readReservedString(raw, FILE_PROPERTY_KEYS.id) : '';
    return !fileId || this.companionsByFileId.get(casefold(fileId))?.size !== 1;
  }

  private isUniqueIndexedIdentity(companion: TFile, sourcePath: string, fileId: string): boolean {
    const sourceCandidates = this.companionsBySourcePath.get(this.pathKey(sourcePath));
    const idCandidates = this.companionsByFileId.get(casefold(fileId));
    return sourceCandidates?.size === 1
      && sourceCandidates.has(companion)
      && idCandidates?.size === 1
      && idCandidates.has(companion);
  }

  private async archiveInactiveDestinationHistory(
    sourcePath: string,
    movingCompanion: TFile,
  ): Promise<ArchivedDestinationHistory | null> {
    const normalizedPath = this.normalizeVaultPath(sourcePath);
    const candidates = (await this.findCompanionsForSourcePath(normalizedPath))
      .filter((candidate) => candidate !== movingCompanion);
    if (candidates.length === 0) return null;
    if (candidates.length !== 1) {
      throw new Error(
        `Multiple GCM file-property companions already map to rename destination ${normalizedPath}: ${candidates.map((file) => file.path).join(', ')}`,
      );
    }

    const companion = candidates[0];
    const previousRaw = await this.readRawFrontmatterAsync(companion);
    const fileId = previousRaw ? this.readReservedString(previousRaw, FILE_PROPERTY_KEYS.id) : '';
    const mappedPath = previousRaw
      ? this.normalizeVaultPath(this.readReservedString(previousRaw, FILE_PROPERTY_KEYS.sourcePath))
      : '';
    if (!previousRaw
      || !this.isCompanionRecord(previousRaw)
      || this.pathKey(mappedPath) !== this.pathKey(normalizedPath)
      || this.readReservedString(previousRaw, FILE_PROPERTY_KEYS.tombstonedAt)
      || !fileId
      || !this.isUniqueIndexedIdentity(companion, mappedPath, fileId)) {
      throw new Error(`Cannot replace an active or ambiguous file-property mapping at ${normalizedPath}`);
    }
    if (!this.readReservedBoolean(previousRaw, FILE_PROPERTY_KEYS.sourceMissing)) {
      throw new ActiveDestinationMappingError(
        `Cannot automatically replace an active file-property mapping at ${normalizedPath}`,
        companion,
        previousRaw,
        mappedPath,
        fileId,
      );
    }

    const tombstoneRaw = this.cloneRecord(previousRaw);
    tombstoneRaw[FILE_PROPERTY_KEYS.sourceMissing] = true;
    tombstoneRaw[FILE_PROPERTY_KEYS.tombstonedAt] = new Date().toISOString();
    deleteValueCaseInsensitive(tombstoneRaw, FILE_PROPERTY_KEYS.source);
    const persisted = await this.writeRawFrontmatter(companion, tombstoneRaw, previousRaw);
    return {
      companion,
      previousRaw,
      tombstoneRaw: persisted,
      sourcePath: mappedPath,
      fileId,
    };
  }

  private async restoreArchivedDestinationHistory(
    archived: ArchivedDestinationHistory | null,
    originalError: unknown,
  ): Promise<void> {
    if (!archived) return;
    try {
      await this.writeRawFrontmatter(
        archived.companion,
        archived.previousRaw,
        archived.tombstoneRaw,
      );
    } catch (restoreError) {
      logger.error('[TPS GCM] Could not restore retained destination history after rename failed', {
        source: archived.sourcePath,
        companion: archived.companion.path,
        error: restoreError,
      });
      throw new Error(
        `Rename failed (${String(originalError)}) and retained history for ${archived.sourcePath} could not be restored: ${String(restoreError)}`,
      );
    }
  }

  private async notifyArchivedDestinationHistory(
    archived: ArchivedDestinationHistory | null,
  ): Promise<void> {
    if (!archived) return;
    await this.notifyChanged({
      action: 'tombstoned',
      sourceFile: null,
      sourcePath: archived.sourcePath,
      companionFile: archived.companion,
      companionPath: archived.companion.path,
      frontmatter: {},
    }, {
      activeSourceFile: null,
      emitLegacyCanvasEvent: false,
      itemId: archived.fileId,
    });
  }

  private async failClosedMoveCollision(
    movingCompanion: TFile,
    movingRaw: FilePropertyRecord,
    movingSourcePath: string,
    error: unknown,
  ): Promise<void> {
    let destinationMissingRaw: FilePropertyRecord | null = null;
    if (error instanceof ActiveDestinationMappingError) {
      destinationMissingRaw = this.buildReservedRecordForPath(
        error.sourcePath,
        error.raw,
        this.extractUserProperties(error.raw),
        true,
      );
      if (!this.recordsEqual(error.raw, destinationMissingRaw)) {
        destinationMissingRaw = await this.writeRawFrontmatter(
          error.companion,
          destinationMissingRaw,
          error.raw,
        );
      }
    }

    const movingMissingRaw = this.buildReservedRecordForPath(
      movingSourcePath,
      movingRaw,
      this.extractUserProperties(movingRaw),
      true,
    );
    try {
      if (!this.recordsEqual(movingRaw, movingMissingRaw)) {
        await this.writeRawFrontmatter(movingCompanion, movingMissingRaw, movingRaw);
      }
    } catch (movingWriteError) {
      if (error instanceof ActiveDestinationMappingError && destinationMissingRaw) {
        try {
          await this.writeRawFrontmatter(error.companion, error.raw, destinationMissingRaw);
        } catch (restoreError) {
          throw new Error(
            `Could not fail closed for ${movingSourcePath} (${String(movingWriteError)}) or restore destination history ${error.sourcePath}: ${String(restoreError)}`,
          );
        }
      }
      throw movingWriteError;
    }

    if (error instanceof ActiveDestinationMappingError) {
      await this.notifyChanged({
        action: 'orphaned',
        sourceFile: null,
        sourcePath: error.sourcePath,
        companionFile: error.companion,
        companionPath: error.companion.path,
        frontmatter: {},
      }, {
        activeSourceFile: null,
        emitLegacyCanvasEvent: false,
        itemId: error.fileId,
      });
    }
    await this.notifyChanged({
      action: 'orphaned',
      sourceFile: null,
      sourcePath: movingSourcePath,
      companionFile: movingCompanion,
      companionPath: movingCompanion.path,
      frontmatter: {},
    }, {
      activeSourceFile: null,
      emitLegacyCanvasEvent: false,
      itemId: this.readReservedString(movingRaw, FILE_PROPERTY_KEYS.id),
    });
    logger.warn('[TPS GCM] Preserved colliding file-property identities for explicit recovery', {
      source: movingSourcePath,
      error,
    });
  }

  private getUniqueLiveSourceForCompanion(
    companion: TFile,
    raw: FilePropertyRecord,
  ): TFile | null {
    const sourcePath = this.normalizeVaultPath(this.readReservedString(raw, FILE_PROPERTY_KEYS.sourcePath));
    const fileId = this.readReservedString(raw, FILE_PROPERTY_KEYS.id);
    if (!sourcePath
      || !fileId
      || this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)
      || !this.isUniqueIndexedIdentity(companion, sourcePath, fileId)) return null;
    const source = this.plugin.app.vault.getAbstractFileByPath(sourcePath);
    return source instanceof TFile && this.isPropertyTarget(source) ? source : null;
  }

  private assertUnambiguousCandidates(sourcePath: string, candidates: TFile[]): void {
    if (candidates.length <= 1) return;
    throw new Error(
      `Multiple GCM file-property companions map to ${sourcePath}: ${candidates.map((file) => file.path).join(', ')}`,
    );
  }

  private async readAndValidateCompanion(companion: TFile, expectedSourcePath: string): Promise<FilePropertyRecord> {
    const raw = await this.readRawFrontmatterAsync(companion);
    if (!raw) throw this.collisionError(expectedSourcePath, companion.path);
    const mappedPath = this.validateCompanionRecord(raw, companion);
    if (this.pathKey(mappedPath) !== this.pathKey(expectedSourcePath)) {
      throw this.collisionError(expectedSourcePath, companion.path);
    }
    const fileId = this.readReservedString(raw, FILE_PROPERTY_KEYS.id);
    if (!this.isUniqueIndexedIdentity(companion, mappedPath, fileId)) {
      throw new Error(`GCM file-property identity ${fileId} is duplicated or ambiguous for ${mappedPath}`);
    }
    return raw;
  }

  private validateCompanionRecord(raw: FilePropertyRecord, companion: TFile): string {
    const schema = this.readReservedValue(raw, FILE_PROPERTY_KEYS.schema);
    const id = this.readReservedString(raw, FILE_PROPERTY_KEYS.id);
    const sourcePath = this.normalizeVaultPath(this.readReservedString(raw, FILE_PROPERTY_KEYS.sourcePath));
    if (Number(schema) !== FILE_PROPERTIES_SCHEMA_VERSION || !id || !sourcePath) {
      throw new Error(`Invalid or incomplete GCM file-property metadata in ${companion.path}`);
    }
    if (this.extensionForPath(sourcePath) === 'md') {
      throw new Error(`GCM file-property companion ${companion.path} maps to a Markdown source`);
    }
    return sourcePath;
  }

  private isCompanionRecord(raw: FilePropertyRecord): boolean {
    return isFilePropertiesCompanionRecord(raw);
  }

  private rawRecordMapsToSource(raw: FilePropertyRecord, sourcePath: string): boolean {
    return this.isCompanionRecord(raw)
      && !this.readReservedBoolean(raw, FILE_PROPERTY_KEYS.sourceMissing)
      && this.pathKey(this.readReservedString(raw, FILE_PROPERTY_KEYS.sourcePath)) === this.pathKey(sourcePath);
  }

  private isTombstoneForSource(entry: unknown, sourcePath: string): boolean {
    if (!(entry instanceof TFile)) return false;
    const raw = this.readRawFrontmatterSync(entry);
    return Boolean(
      raw
      && this.readReservedString(raw, FILE_PROPERTY_KEYS.tombstonedAt)
      && this.pathKey(this.readReservedString(raw, FILE_PROPERTY_KEYS.sourcePath)) === this.pathKey(sourcePath),
    );
  }

  private buildReservedRecord(
    file: TFile,
    previousRaw: FilePropertyRecord,
    userProperties: FilePropertyRecord,
  ): FilePropertyRecord {
    const raw = this.buildReservedRecordForPath(file.path, previousRaw, userProperties, false);
    raw[FILE_PROPERTY_KEYS.source] = this.buildSourceLink(file);
    return raw;
  }

  private buildReservedRecordForPath(
    sourcePath: string,
    previousRaw: FilePropertyRecord,
    userProperties: FilePropertyRecord,
    sourceMissing: boolean,
  ): FilePropertyRecord {
    const normalizedPath = this.normalizeVaultPath(sourcePath);
    const existingId = this.readReservedString(previousRaw, FILE_PROPERTY_KEYS.id);
    const importedCanvasAt = this.readReservedString(previousRaw, FILE_PROPERTY_KEYS.importedCanvasAt);
    const pendingTargetPath = this.readReservedString(previousRaw, FILE_PROPERTY_KEYS.pendingTargetPath);
    const needsMerge = this.readReservedBoolean(previousRaw, FILE_PROPERTY_KEYS.needsMerge);
    const raw: FilePropertyRecord = {
      [FILE_PROPERTY_KEYS.schema]: FILE_PROPERTIES_SCHEMA_VERSION,
      [FILE_PROPERTY_KEYS.id]: existingId || this.createFileId(),
      [FILE_PROPERTY_KEYS.sourcePath]: normalizedPath,
      [FILE_PROPERTY_KEYS.sourceExtension]: this.extensionForPath(normalizedPath),
    };
    if (!sourceMissing) raw[FILE_PROPERTY_KEYS.source] = this.buildSourceLinkForPath(normalizedPath);
    if (sourceMissing) raw[FILE_PROPERTY_KEYS.sourceMissing] = true;
    if (sourceMissing && pendingTargetPath && needsMerge) {
      raw[FILE_PROPERTY_KEYS.pendingTargetPath] = this.normalizeVaultPath(pendingTargetPath);
      raw[FILE_PROPERTY_KEYS.needsMerge] = true;
    }
    if (importedCanvasAt) raw[FILE_PROPERTY_KEYS.importedCanvasAt] = importedCanvasAt;
    Object.assign(raw, this.sortUserProperties(this.sanitizeUserProperties(userProperties)));
    return raw;
  }

  private extractUserProperties(raw: FilePropertyRecord): FilePropertyRecord {
    const user: FilePropertyRecord = {};
    for (const [key, value] of Object.entries(raw || {})) {
      if (key === 'position' || this.isReservedKey(key)) continue;
      user[key] = this.cloneValue(value);
    }
    return this.sortUserProperties(this.sanitizeUserProperties(user));
  }

  private sanitizeUserProperties(record: FilePropertyRecord): FilePropertyRecord {
    const user: FilePropertyRecord = {};
    for (const [rawKey, rawValue] of Object.entries(record || {})) {
      const key = String(rawKey || '').trim();
      if (!key || key === 'position' || this.isReservedKey(key)) continue;
      let value = this.cloneValue(rawValue);
      const isTagKey = casefold(key) === 'tags' || casefold(key) === 'tag';
      if (isTagKey) value = normalizeTagList(value);
      if (value === undefined || (isTagKey && Array.isArray(value) && value.length === 0)) continue;
      user[key] = value;
    }
    return user;
  }

  private sortUserProperties(record: FilePropertyRecord): FilePropertyRecord {
    const ordered: FilePropertyRecord = {};
    const entries = Object.entries(record || {});
    const claimed = new Set<string>();
    const configured = (this.plugin.settings?.properties || [])
      .map((property: any) => String(property?.key || '').trim())
      .filter(Boolean);
    for (const configuredKey of configured) {
      const match = entries.find(([key]) => casefold(key) === casefold(configuredKey));
      if (!match) continue;
      ordered[configuredKey] = this.cloneValue(match[1]);
      claimed.add(casefold(match[0]));
    }
    for (const [key, value] of entries
      .filter(([key]) => !claimed.has(casefold(key)))
      .sort((left, right) => left[0].localeCompare(right[0], undefined, { sensitivity: 'base' }))) {
      ordered[key] = this.cloneValue(value);
    }
    return ordered;
  }

  private mergeMissingProperties(
    preferred: FilePropertyRecord,
    missingOnly: FilePropertyRecord,
  ): FilePropertyRecord {
    const merged = this.cloneRecord(preferred);
    const seen = new Set(Object.keys(merged).map((key) => casefold(key)));
    for (const [key, value] of Object.entries(this.sanitizeUserProperties(missingOnly))) {
      const marker = casefold(key);
      if (seen.has(marker)) continue;
      seen.add(marker);
      merged[key] = this.cloneValue(value);
    }
    return this.sortUserProperties(merged);
  }

  private async readLegacyCanvasFrontmatter(file: TFile): Promise<LegacyCanvasRead> {
    if (!this.isCanvasFile(file)) return { frontmatter: {}, importedAt: new Date().toISOString() };
    try {
      const vault = this.plugin.app.vault as any;
      const content = await vault.read(file);
      const parsed = JSON.parse(String(content || '{}'));
      const metadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).metadata
        : null;
      const frontmatter = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).frontmatter
        : null;
      const normalized = this.sanitizeUserProperties(
          frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter)
            ? frontmatter as FilePropertyRecord
            : {},
        );
      this.legacyCanvasBySourcePath.set(this.pathKey(file.path), this.cloneRecord(normalized));
      return {
        frontmatter: normalized,
        importedAt: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Unable to read legacy Canvas properties from ${file.path}: ${String(error)}`);
    }
  }

  private async readRawFrontmatterAsync(companion: TFile): Promise<FilePropertyRecord | null> {
    const sync = this.readRawFrontmatterSync(companion);
    if (sync) return sync;
    try {
      const vault = this.plugin.app.vault as any;
      const content = typeof vault.cachedRead === 'function'
        ? await vault.cachedRead(companion)
        : await vault.read(companion);
      const raw = this.parseCompanionFrontmatter(String(content || ''));
      if (!raw) return null;
      this.cacheRawFrontmatter(companion, raw);
      return this.cloneRecord(raw);
    } catch (error) {
      logger.warn('[TPS GCM] Could not read file-property companion', { file: companion.path, error });
      return null;
    }
  }

  private async readRawFrontmatterAuthoritative(companion: TFile): Promise<FilePropertyRecord | null> {
    try {
      const vault = this.plugin.app.vault as any;
      const content = await vault.read(companion);
      const raw = this.parseCompanionFrontmatter(String(content || ''));
      if (!raw) return null;
      if (this.isCompanionRecord(raw)) {
        this.cacheRawFrontmatter(companion, raw);
      } else {
        this.cachedRawByCompanionPath.delete(this.pathKey(companion.path));
        this.removeCompanionFromIndex(companion);
      }
      return this.cloneRecord(raw);
    } catch (error) {
      logger.warn('[TPS GCM] Could not authoritatively inspect Markdown for file-property metadata', {
        file: companion.path,
        error,
      });
      return null;
    }
  }

  private readRawFrontmatterSync(companion: TFile): FilePropertyRecord | null {
    const cacheKey = this.pathKey(companion.path);
    const cached = this.cachedRawByCompanionPath.get(cacheKey);
    const currentMtime = this.getFileMtime(companion);
    if (cached && (cached.mtime === null || currentMtime === null || cached.mtime === currentMtime)) {
      if (this.isCompanionRecord(cached.raw)) this.indexCompanion(companion, cached.raw);
      return this.cloneRecord(cached.raw);
    }
    const metadata = this.plugin.app.metadataCache.getFileCache(companion)?.frontmatter;
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      const raw = this.cloneRecord(metadata as FilePropertyRecord);
      delete raw.position;
      this.cacheRawFrontmatter(companion, raw);
      return raw;
    }
    if (cached) this.cachedRawByCompanionPath.delete(cacheKey);
    return null;
  }

  private parseCompanionFrontmatter(content: string): FilePropertyRecord | null {
    const match = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
    if (!match) return null;
    try {
      const parsed = parseYaml(match[1]);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? this.cloneRecord(parsed as FilePropertyRecord)
        : {};
    } catch {
      return null;
    }
  }

  private async writeRawFrontmatter(
    companion: TFile,
    raw: FilePropertyRecord,
    expectedRaw: FilePropertyRecord,
  ): Promise<FilePropertyRecord> {
    const companionPath = companion.path;
    if (!this.isCompanionFile(companion)) {
      throw new Error(`Refusing to write properties outside ${FILE_PROPERTIES_ROOT}: ${companionPath}`);
    }
    const live = this.plugin.app.vault.getAbstractFileByPath(companion.path);
    if (live !== companion) throw new Error(`File-property companion is no longer live: ${companion.path}`);
    const writer = (this.plugin.app.fileManager as any)?.processFrontMatter;
    if (typeof writer !== 'function') {
      throw new Error('Obsidian processFrontMatter is unavailable for the file-property companion.');
    }
    const normalizedRaw = this.cloneRecord(raw);
    const normalizedExpected = this.cloneRecord(expectedRaw);
    let persistedRaw: FilePropertyRecord | null = null;
    await writer.call(this.plugin.app.fileManager, companion, (frontmatter: FilePropertyRecord) => {
      const liveRaw = this.cloneRecord(frontmatter || {});
      delete liveRaw.position;
      persistedRaw = this.mergeConcurrentRawFrontmatter(normalizedExpected, normalizedRaw, liveRaw);
      for (const key of Object.keys(frontmatter || {})) delete frontmatter[key];
      Object.assign(frontmatter, this.cloneRecord(persistedRaw));
    });
    if (!persistedRaw) throw new Error(`Obsidian did not apply file-property frontmatter to ${companion.path}`);
    this.cacheRawFrontmatter(companion, persistedRaw);
    return this.cloneRecord(persistedRaw);
  }

  private mergeConcurrentRawFrontmatter(
    expected: FilePropertyRecord,
    desired: FilePropertyRecord,
    live: FilePropertyRecord,
  ): FilePropertyRecord {
    const merged = this.cloneRecord(live);
    delete merged.position;
    const userKeys = new Map<string, string>();
    for (const key of [...Object.keys(expected || {}), ...Object.keys(desired || {})]) {
      if (key === 'position' || this.isReservedKey(key)) continue;
      const marker = casefold(key);
      if (!userKeys.has(marker) || findKeyCaseInsensitive(desired, key)) userKeys.set(marker, key);
    }

    for (const [marker, displayKey] of userKeys.entries()) {
      const expectedKey = Object.keys(expected || {}).find((key) => casefold(key) === marker) || null;
      const desiredKey = Object.keys(desired || {}).find((key) => casefold(key) === marker) || null;
      const liveKey = Object.keys(live || {}).find((key) => casefold(key) === marker) || null;
      const expectedPresent = Boolean(expectedKey);
      const desiredPresent = Boolean(desiredKey);
      const livePresent = Boolean(liveKey);
      const expectedValue = expectedKey ? expected[expectedKey] : undefined;
      const desiredValue = desiredKey ? desired[desiredKey] : undefined;
      const liveValue = liveKey ? live[liveKey] : undefined;
      const serviceChanged = expectedPresent !== desiredPresent
        || !this.valuesEqual(expectedValue, desiredValue)
        || (expectedKey != null && desiredKey != null && expectedKey !== desiredKey);
      if (!serviceChanged) continue;

      const liveChanged = expectedPresent !== livePresent
        || !this.valuesEqual(expectedValue, liveValue);
      const liveAlreadyDesired = desiredPresent === livePresent
        && this.valuesEqual(desiredValue, liveValue);
      if (liveChanged && !liveAlreadyDesired) {
        throw new Error(`Concurrent direct edit conflicts with GCM property mutation for ${displayKey}`);
      }
      deleteValueCaseInsensitive(merged, displayKey);
      if (desiredKey) merged[desiredKey] = this.cloneValue(desiredValue);
    }

    for (const key of Object.keys(merged)) {
      if (this.isReservedKey(key)) delete merged[key];
    }
    for (const reservedKey of Object.values(FILE_PROPERTY_KEYS)) {
      const desiredKey = findKeyCaseInsensitive(desired, reservedKey);
      if (desiredKey) merged[reservedKey] = this.cloneValue(desired[desiredKey]);
    }
    return merged;
  }

  private cacheRawFrontmatter(companion: TFile, raw: FilePropertyRecord): void {
    this.cachedRawByCompanionPath.set(this.pathKey(companion.path), {
      raw: this.cloneRecord(raw),
      mtime: this.getFileMtime(companion),
    });
    this.indexCompanion(companion, raw);
  }

  private getFileMtime(file: TFile): number | null {
    const value = Number((file as any)?.stat?.mtime);
    return Number.isFinite(value) ? value : null;
  }

  private serializeCompanion(raw: FilePropertyRecord): string {
    return `---\n${stringifyYaml(raw).trimEnd()}\n---\n\n`;
  }

  private async ensureParentFolder(filePath: string): Promise<void> {
    const normalized = this.normalizeVaultPath(filePath);
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash < 0) return;
    const folderPath = normalized.slice(0, lastSlash);
    const segments = folderPath.split('/').filter(Boolean);
    let current = '';
    for (const segment of segments) {
      current = normalizePath(current ? `${current}/${segment}` : segment);
      const existing = this.plugin.app.vault.getAbstractFileByPath(current);
      if (existing) {
        if (!(existing instanceof TFolder)) {
          throw new Error(`Cannot create GCM file-property folder; ${current} is a file`);
        }
        continue;
      }
      await this.plugin.app.vault.createFolder(current);
      const created = this.plugin.app.vault.getAbstractFileByPath(current);
      if (!(created instanceof TFolder)) {
        throw new Error(`Obsidian did not create the expected folder ${current}`);
      }
    }
  }

  private async notifyChanged(
    result: FilePropertyMutationResult,
    options: {
      explicit?: boolean;
      cause?: FilePropertiesMutationCause;
      changedKeys?: string[];
      activeSourceFile?: TFile | null;
      emitLegacyCanvasEvent?: boolean;
      itemId?: string;
      skipCompanionRead?: boolean;
    } = {},
  ): Promise<void> {
    const cause = this.normalizeMutationCause(
      options.cause,
      options.explicit === true ? 'user' : 'automation',
    );
    const sourcePluginId = cause.sourcePluginId || this.plugin.manifest.id;
    const paths = [result.sourcePath, result.companionPath];
    this.plugin.eventService?.emitFilesUpdated?.(paths, { sourcePluginId });
    if (cause.kind === 'user') {
      this.plugin.eventService?.emitExplicitAction?.([result.sourcePath], {
        sourcePluginId,
        source: cause.surface || 'file-properties',
      });
    }
    const raw = options.skipCompanionRead
      ? null
      : this.readRawFrontmatterSync(result.companionFile);
    const activeSourceFile = Object.prototype.hasOwnProperty.call(options, 'activeSourceFile')
      ? options.activeSourceFile || null
      : raw
        ? this.getUniqueLiveSourceForCompanion(result.companionFile, raw)
        : null;
    const itemId = options.itemId !== undefined
      ? options.itemId
      : raw
        ? this.readReservedString(raw, FILE_PROPERTY_KEYS.id)
        : '';
    const changedKeys = Array.from(new Set((options.changedKeys || []).map((key) => String(key || '').trim()).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
    this.plugin.app.workspace?.trigger?.('tps:gcm-file-properties-updated', {
      sourcePluginId,
      timestamp: Date.now(),
      targetPath: result.sourcePath,
      propertyFilePath: result.companionPath,
      itemId,
      action: result.action,
      changedKeys,
      ...(cause.surface ? { surface: cause.surface } : {}),
    });
    if (options.emitLegacyCanvasEvent !== false
      && activeSourceFile
      && this.extensionForPath(activeSourceFile.path) === 'canvas') {
      this.plugin.app.workspace?.trigger?.(
        'tps:gcm-canvas-properties-updated',
        activeSourceFile,
        this.cloneRecord(result.frontmatter),
        result.companionFile,
      );
    }
    await this.options.onChanged?.({
      ...result,
      cause,
      sourceFile: activeSourceFile,
      frontmatter: activeSourceFile ? result.frontmatter : {},
    });
  }

  private async notifySourceInvalidated(
    companion: TFile,
    sourcePath: string,
    itemId: string,
  ): Promise<void> {
    await this.notifyChanged({
      action: 'removed',
      sourceFile: null,
      sourcePath,
      companionFile: companion,
      companionPath: companion.path,
      frontmatter: {},
    }, {
      activeSourceFile: null,
      emitLegacyCanvasEvent: false,
      itemId,
      skipCompanionRead: true,
    });
  }

  private changedUserPropertyKeys(before: FilePropertyRecord, after: FilePropertyRecord): string[] {
    const keys = new Map<string, string>();
    for (const key of [...Object.keys(before || {}), ...Object.keys(after || {})]) {
      const marker = casefold(key);
      if (!keys.has(marker)) keys.set(marker, key);
    }
    const changed: string[] = [];
    for (const [marker, displayKey] of keys.entries()) {
      const beforeKey = Object.keys(before || {}).find((key) => casefold(key) === marker);
      const afterKey = Object.keys(after || {}).find((key) => casefold(key) === marker);
      const beforeValue = beforeKey ? before[beforeKey] : undefined;
      const afterValue = afterKey ? after[afterKey] : undefined;
      if (!this.valuesEqual(beforeValue, afterValue)) changed.push(afterKey || displayKey);
    }
    return changed;
  }

  private normalizeList(values: unknown): unknown[] {
    const source = Array.isArray(values) ? values : values == null ? [] : [values];
    return source
      .map((value) => typeof value === 'string' ? value.trim() : value)
      .filter((value) => value !== undefined && value !== null && String(value).trim() !== '');
  }

  private isReservedKey(key: string): boolean {
    return RESERVED_FILE_PROPERTY_KEYS.has(casefold(key));
  }

  private hasReservedKey(raw: FilePropertyRecord, key: string): boolean {
    return Boolean(findKeyCaseInsensitive(raw, key));
  }

  private readReservedValue(raw: FilePropertyRecord, key: string): unknown {
    const actual = findKeyCaseInsensitive(raw, key);
    return actual ? raw[actual] : undefined;
  }

  private readReservedString(raw: FilePropertyRecord, key: string): string {
    return String(this.readReservedValue(raw, key) ?? '').trim();
  }

  private readReservedBoolean(raw: FilePropertyRecord, key: string): boolean {
    return this.readReservedValue(raw, key) === true;
  }

  private buildSourceLink(file: TFile): string {
    const generateMarkdownLink = (this.plugin.app.fileManager as any)?.generateMarkdownLink;
    if (typeof generateMarkdownLink === 'function') {
      try {
        const generated = String(generateMarkdownLink.call(this.plugin.app.fileManager, file, '') || '').trim();
        if (generated) return generated;
      } catch {
        // Fall through to a deterministic escaped wikilink.
      }
    }
    return this.buildSourceLinkForPath(file.path);
  }

  private buildSourceLinkForPath(sourcePath: string): string {
    const escaped = String(sourcePath || '')
      .replace(/\\/gu, '\\\\')
      .replace(/([#\^|\[\]])/gu, '\\$1');
    return `[[${escaped}]]`;
  }

  private isManagedCatalogPath(path: unknown): boolean {
    const normalized = this.normalizeVaultPath(path);
    const key = this.pathKey(normalized);
    const rootKey = this.pathKey(FILE_PROPERTIES_ROOT);
    return key === rootKey || key.startsWith(`${rootKey}/`);
  }

  private extensionForPath(path: string): string {
    const name = this.normalizeVaultPath(path).split('/').pop() || '';
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLocaleLowerCase() : '';
  }

  private isPropertyTargetPath(path: string): boolean {
    const normalized = this.normalizeVaultPath(path);
    return Boolean(normalized)
      && this.extensionForPath(normalized) !== 'md'
      && !this.isManagedCatalogPath(normalized);
  }

  private getMirroredCompanionPath(sourcePath: string): string {
    return normalizePath(`${FILE_PROPERTIES_ROOT}/${this.normalizeVaultPath(sourcePath)}.md`);
  }

  private getByIdCompanionPath(fileId: string): string {
    const normalizedId = this.normalizeFileId(fileId);
    if (!normalizedId) throw new Error('Cannot create a fallback file-property companion without a valid ID.');
    return normalizePath(`${FILE_PROPERTIES_BY_ID_ROOT}/${normalizedId}.md`);
  }

  private isSafeCompanionPath(path: string): boolean {
    const normalized = this.normalizeVaultPath(path);
    if (this.utf8Length(normalized) > 850) return false;
    return normalized.split('/').every((segment) => this.utf8Length(segment) <= 220);
  }

  private utf8Length(value: string): number {
    return new TextEncoder().encode(String(value || '')).length;
  }

  private normalizeFileId(value: unknown): string {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/gu, '').slice(0, 120);
  }

  private normalizeVaultPath(value: unknown): string {
    return normalizePath(String(value || '').trim().replace(/^\/+|\/+$/gu, ''));
  }

  private safeRelinkDisplayText(value: unknown, maxLength: number): string {
    return String(value || '')
      .replace(/[\u0000-\u001F\u007F]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, maxLength);
  }

  private pathKey(value: unknown): string {
    return this.normalizeVaultPath(value).toLocaleLowerCase();
  }

  private collisionError(sourcePath: string, companionPath: string): Error {
    return new Error(
      `Refusing to replace ${companionPath}; it is not the unique GCM file-property companion for ${sourcePath}`,
    );
  }

  private assertPropertyTarget(file: unknown): asserts file is TFile {
    if (!this.isPropertyTarget(file)) {
      throw new Error('GCM file properties require a non-Markdown source file.');
    }
  }

  private assertLiveSource(file: TFile): void {
    const live = this.plugin.app.vault.getAbstractFileByPath(file.path);
    if (live !== file) throw new Error(`File-property source is no longer live: ${file.path}`);
  }

  private assertLiveSourceAtPath(file: TFile, expectedPath: string): void {
    const normalizedExpectedPath = this.normalizeVaultPath(expectedPath);
    if (this.normalizeVaultPath(file.path) !== normalizedExpectedPath) {
      throw new Error(`File-property source moved while its mutation was queued: ${normalizedExpectedPath}`);
    }
    this.assertPropertyTarget(file);
    const live = this.plugin.app.vault.getAbstractFileByPath(normalizedExpectedPath);
    if (live !== file) {
      throw new Error(`File-property source identity changed while its mutation was queued: ${normalizedExpectedPath}`);
    }
  }

  private createFileId(): string {
    const cryptoApi = (globalThis as any).crypto;
    const random = typeof cryptoApi?.randomUUID === 'function'
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    return `file_${String(random).replace(/[^a-zA-Z0-9_-]/gu, '')}`;
  }

  private recordsEqual(left: FilePropertyRecord, right: FilePropertyRecord): boolean {
    return this.valuesEqual(left, right);
  }

  private valuesEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(this.canonicalizeValue(left)) === JSON.stringify(this.canonicalizeValue(right));
  }

  private canonicalizeValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((entry) => this.canonicalizeValue(entry));
    if (value && typeof value === 'object') {
      if (value instanceof Date) return value.toISOString();
      const canonical: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        canonical[key] = this.canonicalizeValue((value as Record<string, unknown>)[key]);
      }
      return canonical;
    }
    return value;
  }

  private cloneRecord(value: unknown): FilePropertyRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const copy: FilePropertyRecord = {};
    for (const [key, entry] of Object.entries(value as FilePropertyRecord)) {
      copy[key] = this.cloneValue(entry);
    }
    return copy;
  }

  private cloneValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map((entry) => this.cloneValue(entry)) as T;
    if (value && typeof value === 'object') {
      if (value instanceof Date) return new Date(value.getTime()) as T;
      const copy: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        copy[key] = this.cloneValue(entry);
      }
      return copy as T;
    }
    return value;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}
