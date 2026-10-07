import { TFile, TFolder, normalizePath } from 'obsidian';
import type { CachedMetadata, MarkdownView } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { buildParentFrontmatterLinkValue, extractLinkTarget, resolveLinkValueToFile } from '../handlers/parent-link-format';
import type { ParentLinkKind, ResolvedParentLink } from './subitem-types';
import * as logger from '../logger';
import {
  matchesParentChildIgnoreRule,
  type ParentChildIgnoreSettings,
} from './parent-child-ignore-service';

type RelationshipIndexBuild = {
  kind: 'initial' | 'settings' | 'resolved';
  epoch: number;
  signature: string;
  pending: Set<TFile>;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  legacyPrerequisite: Promise<void> | null;
};

export class ParentLinkResolutionService {
  private childrenByParentPath = new Map<string, Set<TFile>>();
  private parentPathsByChild = new Map<TFile, Set<string>>();
  private targetNamesByChild = new Map<TFile, Set<string>>();
  private childrenByTargetName = new Map<string, Set<TFile>>();
  private knownFilePaths = new Map<TFile, string>();
  private knownFilesByPath = new Map<string, TFile>();
  private indexReady = false;
  private disposed = false;
  private indexSettingsSignature = '';
  private initialBuild: Promise<void> | null = null;
  private indexBuild: RelationshipIndexBuild | null = null;
  private buildEpoch = 0;
  private lastAttemptSignature = '';
  private metadataResolvedObserved = false;
  private provisionalStartupSeed = false;
  private resolutionScheduled = false;
  private pendingResolutionChildren = new Set<TFile>();
  private seedingIndex = false;
  private seedDirectCacheLookups = 0;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  /** Seed once during plugin startup, after the legacy companion catalog when used. */
  setup(options: { afterLayout?: boolean; metadataResolved?: () => boolean } = {}): void {
    let layoutReady = !options.afterLayout || this.plugin.app.workspace.layoutReady === true;
    let resolvedObserved = options.metadataResolved?.() || (this.plugin.app.metadataCache as any).initialized === true;
    this.metadataResolvedObserved ||= resolvedObserved;
    let startupFallbackPending = false;
    const initialize = (fromStartupFallback = false) => {
      if (this.disposed || this.initialBuild) return;
      if (!layoutReady) {
        startupFallbackPending ||= fromStartupFallback;
        return;
      }
      this.provisionalStartupSeed = fromStartupFallback && !this.metadataResolvedObserved;
      const owner = this.startIndexBuild('initial');
      // Install the one-shot join before catalog work can announce changes.
      this.initialBuild = owner.promise.catch((error) => {
        if (!this.disposed) logger.error('[TPS GCM] Could not build parent relationship index', { error });
      });
      void this.buildInitialIndex(owner, fromStartupFallback ? 'startup-fallback' : 'resolved');
    };
    this.plugin.registerEvent(this.plugin.app.metadataCache.on('resolved', () => {
      if (this.disposed) return;
      resolvedObserved = true;
      this.metadataResolvedObserved = true;
      if (this.provisionalStartupSeed && !this.resolutionScheduled) {
        this.resolutionScheduled = true;
        this.provisionalStartupSeed = false;
        if (this.indexBuild) {
          for (const child of this.pendingResolutionChildren) this.indexBuild.pending.add(child);
          this.pendingResolutionChildren.clear();
        } else if (this.indexReady) {
          const owner = this.startIndexBuild('resolved');
          for (const child of this.pendingResolutionChildren) owner.pending.add(child);
          this.pendingResolutionChildren.clear();
          void this.finishResolvedIndex(owner);
        }
      } else {
        initialize();
      }
    }));
    if (resolvedObserved) initialize();
    // Hot reload may miss `resolved`, and some Obsidian versions do not expose
    // `initialized`. Seed on our own startup tick, independent of note/layout
    // navigation. A later `resolved` revisits files with pending metadata or
    // relationship values whose link targets may have settled.
    if (typeof (this.plugin.app.metadataCache as any).initialized !== 'boolean') {
      const timer = setTimeout(() => initialize(true), 0);
      this.plugin.register(() => clearTimeout(timer));
    }
    if (!layoutReady) this.plugin.app.workspace.onLayoutReady(() => {
      if (this.disposed) return;
      layoutReady = true;
      resolvedObserved ||= options.metadataResolved?.() || (this.plugin.app.metadataCache as any).initialized === true;
      this.metadataResolvedObserved ||= resolvedObserved;
      if (resolvedObserved) initialize();
      else if (startupFallbackPending) initialize(true);
    });
    this.plugin.register(() => {
      this.disposed = true;
      this.cancelIndexBuild();
      this.clearRelationshipIndex();
    });
  }

  /** A single metadata-only inventory, owned by startup or a relationship setting change. */
  rebuildRelationshipIndex(source: 'resolved' | 'startup-fallback' | 'settings' = 'settings'): void {
    this.cancelIndexBuild();
    this.provisionalStartupSeed = false;
    this.resolutionScheduled = false;
    this.lastAttemptSignature = this.relationshipSettingsSignature();
    this.scanRelationshipIndex(source);
  }

  private scanRelationshipIndex(source: 'resolved' | 'startup-fallback' | 'settings', owner?: RelationshipIndexBuild): void {
    const startedAt = performance.now();
    this.clearRelationshipIndex();
    const candidates = this.plugin.app.vault.getAllLoadedFiles();
    this.seedDirectCacheLookups = 0;
    for (const item of candidates) {
      if (owner && !this.ownsIndexBuild(owner)) return;
      if (!(item instanceof TFile)) continue;
      this.reindexSeedChild(item);
    }
    if (owner && !this.ownsIndexBuild(owner)) return;
    if (!owner) {
      this.indexSettingsSignature = this.relationshipSettingsSignature();
      this.indexReady = true;
    }
    logger.perf('parent-relationship-index:seed', {
      source,
      candidates: candidates.length,
      files: this.knownFilePaths.size,
      directMetadataCacheLookups: this.seedDirectCacheLookups,
      pendingResolution: this.pendingResolutionChildren.size,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }

  async onRelationshipSettingsChanged(): Promise<void> {
    if (this.disposed) return;
    const signature = this.relationshipSettingsSignature();
    const previousOwner = this.indexBuild;
    if (previousOwner?.signature === signature) {
      if (previousOwner.kind === 'initial') await this.initialBuild;
      else await previousOwner.promise;
      return;
    }
    // A save is not startup proof or a retry of a failed identical attempt.
    if ((!this.initialBuild && !this.indexReady)
      || this.lastAttemptSignature === signature || this.indexSettingsSignature === signature) return;
    const previousSignature = previousOwner?.signature || this.indexSettingsSignature || this.lastAttemptSignature;
    const useLegacy = this.plugin.settings.dataArchitectureMode !== 'native-records';
    const prerequisite = useLegacy ? previousOwner?.legacyPrerequisite || null : null;
    const needsLegacySetup = useLegacy && !prerequisite && previousSignature.endsWith('\u0000native-records');
    const owner = this.startIndexBuild('settings');
    owner.legacyPrerequisite = prerequisite;
    this.clearRelationshipIndex();
    this.provisionalStartupSeed = !this.metadataResolvedObserved;
    this.resolutionScheduled = false;
    void this.buildSettingsIndex(owner, needsLegacySetup);
    await owner.promise;
  }

  private startIndexBuild(kind: RelationshipIndexBuild['kind']): RelationshipIndexBuild {
    this.cancelIndexBuild();
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const owner: RelationshipIndexBuild = {
      kind, epoch: this.buildEpoch, signature: this.relationshipSettingsSignature(),
      pending: new Set(), promise, resolve, reject, legacyPrerequisite: null,
    };
    // Catch-up has no external waiter; settings waiters still receive rejection.
    void promise.catch(() => {});
    this.indexBuild = owner;
    this.lastAttemptSignature = owner.signature;
    return owner;
  }

  private cancelIndexBuild(): void {
    this.buildEpoch++;
    const previous = this.indexBuild;
    this.indexBuild = null;
    previous?.resolve();
  }

  private ownsIndexBuild(owner: RelationshipIndexBuild): boolean {
    return !this.disposed && this.indexBuild === owner && this.buildEpoch === owner.epoch
      && owner.signature === this.relationshipSettingsSignature();
  }

  private finishIndexBuild(owner: RelationshipIndexBuild, failure?: { error: unknown }): void {
    if (!this.ownsIndexBuild(owner)) return;
    this.indexBuild = null;
    if (failure) {
      if (owner.kind !== 'resolved') this.indexReady = false;
      owner.reject(failure.error);
    }
    else owner.resolve();
  }

  private reindexSeedChild(child: TFile): void {
    this.seedingIndex = true;
    try { this.reindexChild(child); }
    finally { this.seedingIndex = false; }
  }

  private async buildInitialIndex(owner: RelationshipIndexBuild, source: 'resolved' | 'startup-fallback'): Promise<void> {
    const startedAt = performance.now();
    try {
      if (this.plugin.settings.dataArchitectureMode !== 'native-records') {
        owner.legacyPrerequisite = this.plugin.filePropertiesService.handleMetadataResolved();
        await owner.legacyPrerequisite;
      }
      if (!this.ownsIndexBuild(owner)) return;
      let sliceStarted = performance.now();
      this.clearRelationshipIndex();
      const candidates = this.plugin.app.vault.getAllLoadedFiles();
      this.seedDirectCacheLookups = 0;
      const checkpoint = async () => {
        if (performance.now() - sliceStarted < 8) return;
        await this.yieldIndexBuild();
        sliceStarted = performance.now();
      };
      // Inventory is atomic, but its cost belongs to the same work budget.
      if (performance.now() - sliceStarted >= 8) await checkpoint();
      for (const item of candidates) {
        if (!this.ownsIndexBuild(owner)) return;
        if (item instanceof TFile) {
          owner.pending.delete(item);
          this.reindexSeedChild(item);
        }
        // Await only an elapsed checkpoint; cheap paths incur no host tasks.
        // Folder-only stretches must still give the host a task boundary.
        if (performance.now() - sliceStarted >= 8) await checkpoint();
      }
      while (this.ownsIndexBuild(owner) && owner.pending.size) {
        const child = owner.pending.values().next().value as TFile;
        owner.pending.delete(child);
        this.reindexSeedChild(child);
        if (performance.now() - sliceStarted >= 8) await checkpoint();
      }
      if (!this.ownsIndexBuild(owner)) return;
      this.indexSettingsSignature = owner.signature;
      this.indexReady = true;
      logger.perf('parent-relationship-index:seed', {
        source, candidates: candidates.length, files: this.knownFilePaths.size,
        directMetadataCacheLookups: this.seedDirectCacheLookups,
        pendingResolution: this.pendingResolutionChildren.size,
        durationMs: Math.round(performance.now() - startedAt),
      });
      this.refreshMenusAfterIndexReady('parent-relationship-index-ready');
      this.finishIndexBuild(owner);
    } catch (error) { this.finishIndexBuild(owner, { error }); }
    finally { this.settleSupersededConfiguration(owner); }
  }

  private async buildSettingsIndex(owner: RelationshipIndexBuild, needsLegacySetup: boolean): Promise<void> {
    try {
      if (needsLegacySetup) owner.legacyPrerequisite = this.plugin.filePropertiesService.setup();
      if (owner.legacyPrerequisite) await owner.legacyPrerequisite;
      if (!this.ownsIndexBuild(owner)) return;
      // Do not call the external rebuild: it would settle this owner before a
      // failed synchronous scan could reject every same-signature settings join.
      this.scanRelationshipIndex('settings', owner);
      while (this.ownsIndexBuild(owner) && owner.pending.size) {
        const child = owner.pending.values().next().value as TFile;
        owner.pending.delete(child);
        this.reindexSeedChild(child);
      }
      if (!this.ownsIndexBuild(owner)) return;
      this.indexSettingsSignature = owner.signature;
      this.indexReady = true;
      this.refreshMenusAfterIndexReady('parent-relationship-index-settings');
      this.finishIndexBuild(owner);
    } catch (error) { this.finishIndexBuild(owner, { error }); }
    finally { this.settleSupersededConfiguration(owner); }
  }

  private async finishResolvedIndex(owner: RelationshipIndexBuild): Promise<void> {
    let sliceStarted = performance.now();
    const hadPending = owner.pending.size > 0;
    try {
      while (this.ownsIndexBuild(owner) && owner.pending.size) {
        const child = owner.pending.values().next().value as TFile;
        owner.pending.delete(child);
        this.reindexChild(child);
        if (performance.now() - sliceStarted >= 8) {
          await this.yieldIndexBuild();
          sliceStarted = performance.now();
        }
      }
      if (!this.ownsIndexBuild(owner)) return;
      if (hadPending) this.refreshMenusAfterIndexReady('parent-relationship-index-resolved');
      this.finishIndexBuild(owner);
    } catch (error) {
      if (this.ownsIndexBuild(owner)) logger.error('[TPS GCM] Could not refresh the resolved parent relationship index', { error });
      this.finishIndexBuild(owner, { error });
    } finally { this.settleSupersededConfiguration(owner); }
  }

  private settleSupersededConfiguration(owner: RelationshipIndexBuild): void {
    if (this.indexBuild === owner && !this.ownsIndexBuild(owner)) this.cancelIndexBuild();
  }

  private yieldIndexBuild(): Promise<void> {
    const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (typeof scheduler?.yield === 'function') return scheduler.yield();
    if (typeof globalThis.MessageChannel === 'function') return new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.onmessage = null;
        channel.port1.close(); channel.port2.close(); resolve();
      };
      channel.port2.postMessage(null);
    });
    return new Promise(resolve => globalThis.setTimeout(resolve, 0));
  }

  /** Current stored children are filtered against current ignore rules at query time. */
  getChildrenForParent(parentFile: TFile): TFile[] {
    if (!this.indexReady || this.indexSettingsSignature !== this.relationshipSettingsSignature()) return [];
    const candidates = this.childrenByParentPath.get(parentFile.path);
    if (!candidates?.size || this.isIgnoredFile(parentFile)) return [];
    const result: TFile[] = [];
    for (const child of candidates) {
      if (child.path === parentFile.path || !this.isLiveFile(child)) continue;
      const frontmatter = this.getLogicalFrontmatter(child);
      if (this.isIgnoredFrontmatter(frontmatter)) continue;
      if (this.getStoredParentsForChild(child, frontmatter).some((entry) => entry.file.path === parentFile.path)) {
        result.push(child);
      }
    }
    return result.sort((left, right) => left.path.localeCompare(right.path));
  }

  /** Return both old and current parent paths for the owning event to refresh. */
  onMetadataChanged(file: TFile): string[] {
    if (!(file instanceof TFile)) return [];
    if (this.indexBuild && !this.indexReady) { this.indexBuild.pending.add(file); return []; }
    if (!this.indexReady) return [];
    return Array.from(this.reindexChild(file));
  }

  onFileCreated(file: TFile): string[] {
    if (!(file instanceof TFile)) return [];
    if (this.indexBuild && !this.indexReady) {
      this.indexBuild.pending.add(file);
      this.collectRelatedChildren(file.path, this.indexBuild.pending);
      return [];
    }
    if (!this.indexReady) return [];
    return this.refreshRelatedChildren(file, file.path);
  }

  onFileDeleted(item: TFile | TFolder): string[] {
    if (this.queueIndexBuildLifecycle(item, item.path)) return [];
    if (!this.indexReady) return [];
    const removed = item instanceof TFile
      ? (this.knownFilePaths.has(item) ? [item] : [])
      : Array.from(this.knownFilePaths.entries())
        .filter(([, path]) => path === item.path || path.startsWith(`${item.path}/`))
        .map(([file]) => file);
    const affected = new Set<TFile>();
    const parentPaths = new Set<string>();
    for (const file of removed) {
      const oldPath = this.knownFilePaths.get(file) || file.path;
      this.collectRelatedChildren(oldPath, affected);
      for (const path of this.dropChild(file)) parentPaths.add(path);
      this.knownFilePaths.delete(file);
      if (this.knownFilesByPath.get(oldPath) === file) this.knownFilesByPath.delete(oldPath);
      affected.delete(file);
    }
    for (const child of affected) {
      for (const path of this.reindexChild(child)) parentPaths.add(path);
    }
    return Array.from(parentPaths);
  }

  onFileRenamed(item: TFile | TFolder, oldPath: string): string[] {
    if (this.queueIndexBuildLifecycle(item, oldPath)) return [];
    if (!this.indexReady) return [];
    const renamed = item instanceof TFile
      ? [[item, oldPath] as const]
      : Array.from(this.knownFilePaths.entries()).filter(([, path]) => (
        path === oldPath || path.startsWith(`${oldPath}/`)
      ));
    const affected = new Set<TFile>();
    for (const [file, previousPath] of renamed) {
      this.collectRelatedChildren(previousPath, affected);
      this.collectRelatedChildren(file.path, affected);
      affected.add(file);
    }
    const parentPaths = new Set<string>();
    for (const child of affected) {
      for (const path of this.reindexChild(child)) parentPaths.add(path);
    }
    return Array.from(parentPaths);
  }

  private queueIndexBuildLifecycle(item: TFile | TFolder, oldPath: string): boolean {
    const owner = this.indexBuild;
    if (!owner || this.indexReady) return false;
    if (item instanceof TFile) {
      owner.pending.add(item);
      this.collectRelatedChildren(this.knownFilePaths.get(item) || oldPath, owner.pending);
      this.collectRelatedChildren(oldPath, owner.pending);
      this.collectRelatedChildren(item.path, owner.pending);
    } else {
      // An unvisited target has no known old path. Reconsider the already-read
      // relationship bearers, not the whole inventory or frontmatter snapshots.
      for (const child of this.targetNamesByChild.keys()) owner.pending.add(child);
      for (const [file, path] of this.knownFilePaths) {
        if (path === oldPath || path.startsWith(`${oldPath}/`)
          || path === item.path || path.startsWith(`${item.path}/`)) owner.pending.add(file);
      }
    }
    return true;
  }

  private refreshRelatedChildren(file: TFile, path: string): string[] {
    const affected = new Set<TFile>([file]);
    this.collectRelatedChildren(path, affected);
    const parentPaths = new Set<string>();
    for (const child of affected) {
      for (const parentPath of this.reindexChild(child)) parentPaths.add(parentPath);
    }
    return Array.from(parentPaths);
  }

  private collectRelatedChildren(path: string, affected: Set<TFile>): void {
    for (const child of this.childrenByParentPath.get(path) || []) affected.add(child);
    for (const name of this.targetNameKeys(path)) {
      for (const child of this.childrenByTargetName.get(name) || []) affected.add(child);
    }
  }

  private reindexChild(child: TFile): Set<string> {
    const changedParents = this.dropChild(child);
    const oldPath = this.knownFilePaths.get(child);
    if (oldPath && oldPath !== child.path && this.knownFilesByPath.get(oldPath) === child) {
      this.knownFilesByPath.delete(oldPath);
    }
    if (!this.isLiveFile(child)) {
      this.knownFilePaths.delete(child);
      if (this.knownFilesByPath.get(child.path) === child) this.knownFilesByPath.delete(child.path);
      return changedParents;
    }
    const replaced = this.knownFilesByPath.get(child.path);
    if (replaced && replaced !== child) {
      for (const path of this.dropChild(replaced)) changedParents.add(path);
      this.knownFilePaths.delete(replaced);
    }
    this.knownFilesByPath.set(child.path, child);
    this.knownFilePaths.set(child, child.path);
    if (String(child.extension || '').trim().toLowerCase() !== 'md'
      && this.plugin.filePropertiesService?.isPropertyTarget(child) !== true) return changedParents;
    const frontmatter = this.getLogicalFrontmatter(child);
    const values = this.getParentValuesFromFrontmatter(frontmatter);
    if (!values.length) return changedParents;

    const names = new Set(values.flatMap((value) => {
      const target = extractLinkTarget(value);
      return target ? Array.from(this.targetNameKeys(target)) : [];
    }));
    if (names.size) {
      this.targetNamesByChild.set(child, names);
      for (const name of names) {
        const bucket = this.childrenByTargetName.get(name) || new Set<TFile>();
        bucket.add(child);
        this.childrenByTargetName.set(name, bucket);
      }
    }

    const parentPaths = new Set<string>();
    const resolvedParents = this.getStoredParentsForChild(child, frontmatter);
    // Link destinations can settle after their source metadata is indexed.
    // Revisit every relationship-bearing child when the provisional seed's
    // first full `resolved` event arrives, even if its early target existed.
    if (this.provisionalStartupSeed) this.pendingResolutionChildren.add(child);
    for (const parent of resolvedParents) {
      if (!this.isLiveFile(parent.file)) continue;
      parentPaths.add(parent.file.path);
      const bucket = this.childrenByParentPath.get(parent.file.path) || new Set<TFile>();
      bucket.add(child);
      this.childrenByParentPath.set(parent.file.path, bucket);
      changedParents.add(parent.file.path);
    }
    if (parentPaths.size) this.parentPathsByChild.set(child, parentPaths);
    return changedParents;
  }

  private dropChild(child: TFile): Set<string> {
    this.pendingResolutionChildren.delete(child);
    const oldParents = this.parentPathsByChild.get(child) || new Set<string>();
    this.parentPathsByChild.delete(child);
    for (const path of oldParents) {
      const bucket = this.childrenByParentPath.get(path);
      bucket?.delete(child);
      if (bucket?.size === 0) this.childrenByParentPath.delete(path);
    }
    const oldNames = this.targetNamesByChild.get(child) || new Set<string>();
    this.targetNamesByChild.delete(child);
    for (const name of oldNames) {
      const bucket = this.childrenByTargetName.get(name);
      bucket?.delete(child);
      if (bucket?.size === 0) this.childrenByTargetName.delete(name);
    }
    return new Set(oldParents);
  }

  private targetNameKeys(pathOrTarget: string): Set<string> {
    const last = String(pathOrTarget || '').split('/').pop()?.trim().toLowerCase() || '';
    if (!last) return new Set();
    const withoutExtension = last.replace(/\.[^.]+$/, '');
    return new Set([last, withoutExtension].filter(Boolean));
  }

  private isLiveFile(file: TFile): boolean {
    return this.plugin.app.vault.getAbstractFileByPath(file.path) === file;
  }

  private relationshipSettingsSignature(): string {
    return `${this.getParentKey().toLowerCase()}\u0000${this.plugin.settings.dataArchitectureMode || 'legacy'}`;
  }

  private clearRelationshipIndex(): void {
    this.childrenByParentPath.clear();
    this.parentPathsByChild.clear();
    this.targetNamesByChild.clear();
    this.childrenByTargetName.clear();
    this.knownFilePaths.clear();
    this.knownFilesByPath.clear();
    this.pendingResolutionChildren.clear();
    this.indexReady = false;
    this.indexSettingsSignature = '';
  }

  getParentKey(): string {
    return String(this.plugin.settings.parentLinkFrontmatterKey || 'parent').trim() || 'parent';
  }

  getParentKind(file: TFile): ParentLinkKind {
    const ext = String(file.extension || '').trim().toLowerCase();
    if (ext === 'md') return 'markdown-parent';
    if (ext === 'base') return 'base-parent';
    return 'other-parent';
  }

  /**
   * Resolve the frontmatter that belongs to the logical vault item. Markdown
   * reads its own cache; every supported non-Markdown item reads its GCM
   * companion without exposing the companion as a relationship candidate.
   */
  getLogicalFrontmatter(file: TFile): Record<string, unknown> {
    if (!(file instanceof TFile)) return {};
    let cache: CachedMetadata | null | undefined;
    let cacheRead = false;
    const readCache = () => {
      if (!cacheRead) {
        cacheRead = true;
        if (this.seedingIndex) this.seedDirectCacheLookups++;
        cache = this.plugin.app.metadataCache.getFileCache(file);
      }
      return cache;
    };
    if (this.plugin.filePropertiesService?.isCompanionFile(file, () => readCache()?.frontmatter)) return {};
    if (this.plugin.filePropertiesService?.isPropertyTarget(file)) {
      return this.plugin.filePropertiesService.read(file) as Record<string, unknown>;
    }
    cache = readCache();
    if (this.provisionalStartupSeed && !cache) this.pendingResolutionChildren.add(file);
    return (cache?.frontmatter || {}) as Record<string, unknown>;
  }

  private refreshMenusAfterIndexReady(reason: string): void {
    const active = this.plugin.app.workspace.getActiveFile();
    const visibleFiles = this.plugin.app.workspace.getLeavesOfType('markdown')
      .map((leaf) => (leaf.view as MarkdownView).file)
      .filter((file): file is TFile => file instanceof TFile && file.extension === 'md');
    if (active instanceof TFile && active.extension === 'md') visibleFiles.push(active);
    const mountedFiles = Array.from(new Map(visibleFiles.map((file) => [file.path, file])).values())
      .filter((file) => this.plugin.persistentMenuManager?.hasMountedMenuForFile(file));
    const activeIsMounted = active instanceof TFile
      && active.extension === 'md'
      && this.plugin.persistentMenuManager?.hasMountedMenuForFile(active);
    this.plugin.overlayRenderingService.invalidate({
      reason,
      files: mountedFiles,
      surfaces: ['menus'],
      ensureMenus: !activeIsMounted,
      force: mountedFiles.length > 0,
      delayMs: 0,
    });
  }

  isRelationshipTarget(file: unknown): file is TFile {
    if (!(file instanceof TFile)) return false;
    if (this.plugin.filePropertiesService?.isCompanionFile(file)) return false;
    return String(file.extension || '').trim().toLowerCase() === 'md'
      || this.plugin.filePropertiesService?.isPropertyTarget(file) === true;
  }

  /** Enumerate logical relationship targets; managed companion notes stay hidden. */
  getRelationshipCandidates(options: { includeIgnored?: boolean } = {}): TFile[] {
    return this.plugin.app.vault.getAllLoadedFiles().filter(
      (file): file is TFile => this.isRelationshipTarget(file)
        && (options.includeIgnored === true || !this.isIgnoredFile(file)),
    );
  }

  getAllFileTargets(): TFile[] {
    return this.getRelationshipCandidates();
  }

  isIgnoredFrontmatter(frontmatter: Record<string, unknown> | null | undefined): boolean {
    return matchesParentChildIgnoreRule(
      frontmatter,
      this.plugin.settings as unknown as ParentChildIgnoreSettings,
    );
  }

  isIgnoredFile(file: TFile): boolean {
    if (!(file instanceof TFile)) return false;
    if (this.plugin.filePropertiesService?.isCompanionFile(file)) return true;
    return this.isIgnoredFrontmatter(this.getLogicalFrontmatter(file));
  }

  getParentsForChild(childFile: TFile): ResolvedParentLink[] {
    const frontmatter = this.getLogicalFrontmatter(childFile);
    if (this.isIgnoredFrontmatter(frontmatter)) return [];
    return this.getStoredParentsForChild(childFile, frontmatter)
      .filter((entry) => !this.isIgnoredFile(entry.file));
  }

  /** Read persisted relationships without applying the display/automation ignore rule. */
  getStoredParentsForChild(
    childFile: TFile,
    frontmatter: Record<string, unknown> = this.getLogicalFrontmatter(childFile),
  ): ResolvedParentLink[] {
    const values = this.getParentValuesFromFrontmatter(frontmatter);
    const results = new Map<string, ResolvedParentLink>();
    for (const file of this.resolveFilesFromFrontmatterValue(values, childFile.path)) {
      if (file.path === childFile.path) continue;
      results.set(file.path, {
        file,
        kind: this.getParentKind(file),
        source: 'child-frontmatter',
      });
    }
    return Array.from(results.values());
  }

  hasParent(childFile: TFile, parentFile: TFile): boolean {
    return this.getParentsForChild(childFile).some((entry) => entry.file.path === parentFile.path);
  }

  async addParentToChild(childFile: TFile, parentFile: TFile): Promise<boolean> {
    if (this.isIgnoredFile(childFile) || this.isIgnoredFile(parentFile)) return false;
    const key = this.getParentKey();
    const linkValue = buildParentFrontmatterLinkValue(this.plugin.app, parentFile, childFile.path);
    let changed = false;

    await this.plugin.frontmatterMutationService.process(childFile, (fm) => {
      if (this.isIgnoredFrontmatter(fm as Record<string, unknown>) || this.isIgnoredFile(parentFile)) return;
      const values = this.getParentValuesFromFrontmatter(fm as Record<string, unknown>);
      const existingFiles = this.resolveFilesFromFrontmatterValue(values, childFile.path);
      const alreadyLinked = existingFiles.some((file) => file.path === parentFile.path);

      if (!alreadyLinked) values.push(linkValue);

      const normalizedValues = values.map((value) => {
        const resolved = resolveLinkValueToFile(this.plugin.app, value, childFile.path);
        return resolved instanceof TFile
          ? buildParentFrontmatterLinkValue(this.plugin.app, resolved, childFile.path)
          : String(value || '').trim();
      });
      const deduped = this.dedupeValuesForSource(normalizedValues, childFile.path);
      const hasAliasKey = this.getParentKeyAliases().some((alias) => {
        if (alias.toLowerCase() === key.toLowerCase()) return false;
        return Object.keys(fm as Record<string, unknown>).some((candidate) => candidate.toLowerCase() === alias.toLowerCase());
      });
      const existingKey = Object.keys(fm as Record<string, unknown>).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      const existingRaw = existingKey ? (fm as Record<string, unknown>)[existingKey] : undefined;
      const existingExactValues = existingKey
        ? this.normalizeFrontmatterValues(existingRaw)
        : [];
      const exactUnchanged = Array.isArray(existingRaw)
        && existingExactValues.length === deduped.length
        && existingExactValues.every((value, index) => value === deduped[index]);

      if (alreadyLinked && exactUnchanged && !hasAliasKey) return;

      this.deleteParentAliasKeys(fm as Record<string, unknown>);
      this.setCaseInsensitive(fm as Record<string, unknown>, key, deduped);
      changed = true;
    });

    const selfChanged = await this.ensureSelfLinkForParent(parentFile);
    return changed || selfChanged;
  }

  async ensureSelfLinkForParent(parentFile: TFile): Promise<boolean> {
    if (!this.plugin.settings.autoSelfLinkParentInParentKey) return false;
    if (!(parentFile instanceof TFile) || parentFile.extension?.toLowerCase() !== 'md') return false;
    if (this.isIgnoredFile(parentFile)) return false;

    const key = this.getParentKey();
    const selfLink = buildParentFrontmatterLinkValue(this.plugin.app, parentFile, parentFile.path);
    let changed = false;

    await this.plugin.frontmatterMutationService.process(parentFile, (fm) => {
      if (this.isIgnoredFrontmatter(fm as Record<string, unknown>)) return;
      const values = this.getParentValuesFromFrontmatter(fm as Record<string, unknown>);
      const normalizedValues = values.map((value) => {
        const resolved = resolveLinkValueToFile(this.plugin.app, value, parentFile.path);
        return resolved instanceof TFile
          ? buildParentFrontmatterLinkValue(this.plugin.app, resolved, parentFile.path)
          : String(value || '').trim();
      }).filter(Boolean);

      const hasSelf = normalizedValues.some((value) => this.valueMatchesFile(value, parentFile.path, parentFile));
      if (!hasSelf) normalizedValues.push(selfLink);
      const deduped = this.dedupeValuesForSource(normalizedValues, parentFile.path);

      const existingKey = Object.keys(fm as Record<string, unknown>).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      const hasAliasKey = this.getParentKeyAliases().some((alias) => {
        if (alias.toLowerCase() === key.toLowerCase()) return false;
        return Object.keys(fm as Record<string, unknown>).some((candidate) => candidate.toLowerCase() === alias.toLowerCase());
      });
      const existingRaw = existingKey ? (fm as Record<string, unknown>)[existingKey] : undefined;
      const existingExactValues = existingKey ? this.normalizeFrontmatterValues(existingRaw) : [];
      const exactUnchanged = Array.isArray(existingRaw)
        && existingExactValues.length === deduped.length
        && existingExactValues.every((value, index) => value === deduped[index]);
      if (hasSelf && exactUnchanged && !hasAliasKey) return;

      this.deleteParentAliasKeys(fm as Record<string, unknown>);
      this.setCaseInsensitive(fm as Record<string, unknown>, key, deduped);
      changed = true;
    });

    return changed;
  }

  async removeParentFromChild(childFile: TFile, parentFile: TFile): Promise<boolean> {
    const key = this.getParentKey();
    let changed = false;

    await this.plugin.frontmatterMutationService.process(childFile, (fm) => {
      const values = this.getParentValuesFromFrontmatter(fm as Record<string, unknown>);
      if (!values.length) return;
      const filtered = values.filter((value) => !this.valueMatchesFile(value, childFile.path, parentFile));
      if (filtered.length === values.length) return;
      changed = true;
      this.deleteParentAliasKeys(fm as Record<string, unknown>);
      if (filtered.length === 0) {
        return;
      } else {
        (fm as Record<string, unknown>)[key] = filtered;
      }
    });

    return changed;
  }

  resolveFilesFromFrontmatterValue(value: unknown, sourcePath: string): TFile[] {
    const values = this.normalizeFrontmatterValues(value);
    const files = new Map<string, TFile>();
    for (const raw of values) {
      const resolved = resolveLinkValueToFile(this.plugin.app, raw, sourcePath);
      if (resolved instanceof TFile) {
        files.set(resolved.path, resolved);
      }
    }
    return Array.from(files.values());
  }

  private normalizeFrontmatterValues(value: unknown): string[] {
    const output: string[] = [];
    const visit = (current: unknown): void => {
      if (current == null) return;
      if (Array.isArray(current)) {
        current.forEach(visit);
        return;
      }
      if (typeof current === 'object') {
        Object.values(current as Record<string, unknown>).forEach(visit);
        return;
      }
      const raw = String(current || '').trim();
      if (raw) output.push(raw);
    };
    visit(value);
    return output;
  }

  private getParentValuesFromFrontmatter(frontmatter: Record<string, unknown>): string[] {
    const values: string[] = [];
    const seenKeys = new Set<string>();
    for (const key of this.getParentKeyAliases()) {
      const existingKey = Object.keys(frontmatter || {}).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      if (!existingKey || seenKeys.has(existingKey.toLowerCase())) continue;
      seenKeys.add(existingKey.toLowerCase());
      values.push(...this.normalizeFrontmatterValues(frontmatter[existingKey]));
    }
    return values;
  }

  private deleteParentAliasKeys(frontmatter: Record<string, unknown>): void {
    for (const key of this.getParentKeyAliases()) {
      const existingKey = Object.keys(frontmatter || {}).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      if (existingKey) delete frontmatter[existingKey];
    }
  }

  private getParentKeyAliases(): string[] {
    const canonical = this.getParentKey();
    return Array.from(new Set([canonical, 'parents', 'parent', 'childOf'].map((key) => key.trim()).filter(Boolean)));
  }

  private dedupeValuesForSource(values: string[], sourcePath: string): string[] {
    const exactSeen = new Set<string>();
    const fileSeen = new Set<string>();
    const deduped: string[] = [];
    for (const value of values) {
      const trimmed = String(value || '').trim();
      if (!trimmed) continue;
      const exactKey = trimmed.toLowerCase();
      const resolved = resolveLinkValueToFile(this.plugin.app, trimmed, sourcePath);
      if (resolved instanceof TFile) {
        const pathKey = normalizePath(resolved.path).toLowerCase();
        if (fileSeen.has(pathKey)) continue;
        fileSeen.add(pathKey);
      } else if (exactSeen.has(exactKey)) {
        continue;
      }
      exactSeen.add(exactKey);
      deduped.push(trimmed);
    }
    return deduped;
  }

  private valueMatchesFile(value: string, sourcePath: string, targetFile: TFile): boolean {
    const resolved = resolveLinkValueToFile(this.plugin.app, value, sourcePath);
    if (resolved instanceof TFile) {
      return normalizePath(resolved.path) === normalizePath(targetFile.path);
    }
    return normalizePath(String(value || '')) === normalizePath(targetFile.path);
  }

  private setCaseInsensitive(frontmatter: Record<string, unknown>, key: string, value: unknown): void {
    const existingKey = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (existingKey && existingKey !== key) delete frontmatter[existingKey];
    frontmatter[key] = value;
  }

}
