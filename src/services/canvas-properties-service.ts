import { Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';
import { casefold, deleteValueCaseInsensitive, findKeyCaseInsensitive, setValueCaseInsensitive } from '../core';
import { normalizeTagList } from '../utils/tag-utils';
import {
  didFrontmatterMutationChange,
  type FrontmatterMutationOutcome,
} from './frontmatter-mutation-outcome';

type CanvasFrontmatterRecord = Record<string, unknown>;
type CanvasFrontmatterMutator = (frontmatter: CanvasFrontmatterRecord) => void;
type GuardedCanvasFrontmatterMutator = (frontmatter: CanvasFrontmatterRecord) => boolean | 'unchanged';
type CanvasDocumentRecord = Record<string, unknown>;
type CanvasMutationAbortKind =
  | 'async-mutator'
  | 'guarded-abort'
  | 'invalid-document'
  | 'invalid-frontmatter'
  | 'invalid-metadata'
  | 'malformed-json'
  | 'missing-version'
  | 'no-change'
  | 'postcondition-failed'
  | 'unsupported-version';

const SUPPORTED_CANVAS_METADATA_VERSION = '1.0-1.0';

class CanvasMutationAbort extends Error {
  constructor(
    readonly kind: CanvasMutationAbortKind,
    readonly reason: string,
    readonly detail?: unknown,
  ) {
    super(reason);
    this.name = 'CanvasMutationAbort';
  }
}

interface ParsedCanvasDocument {
  document: CanvasDocumentRecord;
  frontmatter: CanvasFrontmatterRecord;
  metadata: CanvasDocumentRecord;
}

interface PendingCanvasFrontmatter {
  frontmatter: CanvasFrontmatterRecord;
  sourceFrontmatter: CanvasFrontmatterRecord;
  cacheFrontmatter: CanvasFrontmatterRecord;
}

interface CanvasMetadataCacheSnapshot {
  frontmatter: CanvasFrontmatterRecord;
}

/**
 * Reads cached canvas properties and performs writes against the exact JSON
 * revision supplied by Obsidian's atomic Vault.process API.
 */
export class CanvasPropertiesService {
  /**
   * File identity is intentional: a rename retains the pending revision while a
   * new file reusing the old path cannot inherit it. Weak ownership also keeps
   * an unavailable cache from turning this compatibility bridge into a path
   * registry that outlives Obsidian's TFile lifecycle.
   */
  private readonly pendingCommittedFrontmatter = new WeakMap<TFile, PendingCanvasFrontmatter>();
  private warnedReadCapabilityUnavailable = false;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {
    this.plugin.registerEvent(this.plugin.app.metadataCache.on('changed', (file, _data, cache) => {
      if (file instanceof TFile) this.handleMetadataCacheChanged(file, cache);
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('delete', (file) => {
      if (file instanceof TFile) this.pendingCommittedFrontmatter.delete(file);
    }));
  }

  isCanvasFile(file: unknown): file is TFile {
    return file instanceof TFile && file.extension?.toLowerCase() === 'canvas';
  }

  read(file: TFile): CanvasFrontmatterRecord {
    if (!this.isCanvasFile(file)) return {};
    const cached = this.getCanvasMetadataCacheSnapshot(file)?.frontmatter ?? null;
    const pending = this.pendingCommittedFrontmatter.get(file);
    if (!pending) return this.cloneFrontmatter(cached);

    if (cached && this.jsonValuesEqual(cached, pending.frontmatter)) {
      this.pendingCommittedFrontmatter.delete(file);
      return this.cloneFrontmatter(cached);
    }
    return this.cloneFrontmatter(pending.frontmatter);
  }

  async process(file: TFile, mutator: CanvasFrontmatterMutator): Promise<boolean> {
    return didFrontmatterMutationChange(await this.processWithOutcome(file, mutator));
  }

  async processGuarded(file: TFile, mutator: GuardedCanvasFrontmatterMutator): Promise<boolean> {
    return didFrontmatterMutationChange(await this.processGuardedWithOutcome(file, mutator));
  }

  async processWithOutcome(
    file: TFile,
    mutator: CanvasFrontmatterMutator,
  ): Promise<FrontmatterMutationOutcome> {
    return this.processInternal(file, mutator, false);
  }

  async processGuardedWithOutcome(
    file: TFile,
    mutator: GuardedCanvasFrontmatterMutator,
  ): Promise<FrontmatterMutationOutcome> {
    return this.processInternal(file, mutator, true);
  }

  private async processInternal(
    file: TFile,
    mutator: (frontmatter: CanvasFrontmatterRecord) => unknown,
    guarded: boolean,
  ): Promise<FrontmatterMutationOutcome> {
    if (!this.isCanvasFile(file)) return 'unsupported';
    const cacheBeforeWrite = this.getCanvasMetadataCacheSnapshot(file);
    if (!cacheBeforeWrite) {
      this.warnReadCapabilityUnavailable(file);
      return 'unsupported';
    }
    if (typeof this.plugin.app.vault.process !== 'function') {
      logger.warn('[TPS GCM] Atomic canvas property writer unavailable', { file: file.path });
      return 'unsupported';
    }

    let committedFrontmatter: CanvasFrontmatterRecord | undefined;
    let sourceFrontmatter: CanvasFrontmatterRecord | undefined;
    try {
      await this.plugin.app.vault.process(file, (data) => {
        const parsed = this.parseCanvasDocument(data);
        const originalFrontmatter = this.cloneFrontmatter(parsed.frontmatter);
        sourceFrontmatter = this.cloneFrontmatter(parsed.frontmatter);
        const nextFrontmatter = this.cloneFrontmatter(parsed.frontmatter);
        const before = JSON.stringify(this.sortFrontmatter(parsed.frontmatter));
        const result = mutator(nextFrontmatter);
        this.assertSynchronousMutatorResult(result);
        if (guarded && result === 'unchanged') {
          throw new CanvasMutationAbort('no-change', 'Canvas frontmatter was already in the requested state.');
        }
        if (guarded && result !== true) {
          throw new CanvasMutationAbort('guarded-abort', 'Canvas frontmatter mutation guard declined.');
        }

        this.normalizeTagValues(nextFrontmatter);
        this.removeEmptyValuesChangedByMutation(nextFrontmatter, originalFrontmatter);
        if (!this.isJsonValue(nextFrontmatter)) {
          throw new CanvasMutationAbort(
            'invalid-frontmatter',
            'Canvas frontmatter mutation produced a non-JSON value.',
          );
        }
        if (!this.hasPortableChangedValues(nextFrontmatter, originalFrontmatter)) {
          throw new CanvasMutationAbort(
            'invalid-frontmatter',
            'Changed Canvas frontmatter values must be strings, finite numbers, booleans, or primitive arrays.',
          );
        }

        const sorted = this.sortFrontmatter(nextFrontmatter);
        const after = JSON.stringify(sorted);
        if (before === after) {
          throw new CanvasMutationAbort('no-change', 'Canvas frontmatter was unchanged.');
        }

        const nextMetadata: CanvasDocumentRecord = {
          ...parsed.metadata,
          frontmatter: sorted,
        };
        const nextDocument: CanvasDocumentRecord = {
          ...parsed.document,
          metadata: nextMetadata,
        };
        const serialized = this.serializeCanvasDocument(nextDocument);
        this.assertCanvasPostcondition(serialized, parsed, sorted);
        committedFrontmatter = sorted;
        return serialized;
      });
    } catch (error) {
      if (!(error instanceof CanvasMutationAbort)) throw error;
      if (error.kind !== 'no-change' && error.kind !== 'guarded-abort') {
        logger.warn('[TPS GCM] Canvas property mutation refused', {
          file: file.path,
          reason: error.kind,
          detail: error.reason,
        });
      }
      if (error.kind === 'no-change') return 'unchanged';
      if (error.kind === 'guarded-abort') return 'guarded-abort';
      if (error.kind === 'malformed-json') return 'parse-failed';
      return 'write-refused';
    }

    const committed = committedFrontmatter;
    const source = sourceFrontmatter;
    if (!committed || !source) return 'write-refused';
    this.pendingCommittedFrontmatter.set(file, {
      frontmatter: this.cloneFrontmatter(committed),
      sourceFrontmatter: this.cloneFrontmatter(source),
      cacheFrontmatter: this.cloneFrontmatter(cacheBeforeWrite.frontmatter),
    });
    this.runPostCommitNotification(file, 'explicit-action', () => {
      this.plugin.eventService?.emitExplicitAction?.([file.path], { source: 'advanced-canvas-properties' });
    });
    this.runPostCommitNotification(file, 'files-updated', () => {
      this.plugin.eventService?.emitFilesUpdated?.([file.path], { sourcePluginId: this.plugin.manifest.id });
    });
    this.runPostCommitNotification(file, 'workspace-event', () => {
      this.plugin.app.workspace.trigger(
        'tps:gcm-canvas-properties-updated',
        file,
        this.cloneFrontmatter(committed),
      );
    });
    return 'changed';
  }

  async updateValues(files: TFile[], updates: Record<string, unknown>): Promise<TFile[]> {
    return this.applyToFiles(files, (frontmatter) => {
      for (const [key, value] of Object.entries(updates || {})) {
        if (value === undefined || value === null) {
          deleteValueCaseInsensitive(frontmatter, key);
        } else {
          setValueCaseInsensitive(frontmatter, key, value);
        }
      }
    });
  }

  async setListValues(files: TFile[], key: string, values: unknown[]): Promise<TFile[]> {
    return this.applyToFiles(files, (frontmatter) => {
      const normalized = this.normalizeList(values);
      if (normalized.length === 0) {
        deleteValueCaseInsensitive(frontmatter, key);
      } else {
        setValueCaseInsensitive(frontmatter, key, normalized);
      }
    });
  }

  async addValuesToList(files: TFile[], key: string, values: unknown[]): Promise<TFile[]> {
    const additions = this.normalizeList(values);
    if (additions.length === 0) return [];
    return this.applyToFiles(files, (frontmatter) => {
      const existingKey = findKeyCaseInsensitive(frontmatter, key) || key;
      const current = this.normalizeList(frontmatter[existingKey]);
      const merged = [...current];
      const seen = new Set(current.map((value) => casefold(String(value))));
      for (const value of additions) {
        const marker = casefold(String(value));
        if (seen.has(marker)) continue;
        seen.add(marker);
        merged.push(value);
      }
      setValueCaseInsensitive(frontmatter, existingKey, merged);
    });
  }

  async removeValuesFromList(files: TFile[], key: string, values: unknown[]): Promise<TFile[]> {
    const removals = new Set(this.normalizeList(values).map((value) => casefold(String(value))));
    if (removals.size === 0) return [];
    return this.applyToFiles(files, (frontmatter) => {
      const existingKey = findKeyCaseInsensitive(frontmatter, key);
      if (!existingKey) return;
      const current = this.normalizeList(frontmatter[existingKey]);
      const filtered = current.filter((value) => !removals.has(casefold(String(value))));
      if (filtered.length === 0) delete frontmatter[existingKey];
      else setValueCaseInsensitive(frontmatter, existingKey, filtered);
    });
  }

  async deleteKeys(files: TFile[], keys: string[]): Promise<TFile[]> {
    const normalizedKeys = keys.map((key) => String(key || '').trim()).filter(Boolean);
    if (normalizedKeys.length === 0) return [];
    return this.applyToFiles(files, (frontmatter) => {
      for (const key of normalizedKeys) deleteValueCaseInsensitive(frontmatter, key);
    });
  }

  private async applyToFiles(files: TFile[], mutator: CanvasFrontmatterMutator): Promise<TFile[]> {
    const updated: TFile[] = [];
    for (const file of files) {
      if (!this.isCanvasFile(file)) continue;
      try {
        if (await this.process(file, mutator)) updated.push(file);
      } catch (error) {
        logger.error('[TPS GCM] Canvas property mutation failed', { file: file.path, error });
      }
    }
    return updated;
  }

  private cloneFrontmatter(value: unknown): CanvasFrontmatterRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    try {
      const clone = JSON.parse(JSON.stringify(value));
      return this.isRecord(clone) ? clone : {};
    } catch {
      return {};
    }
  }

  private normalizeList(values: unknown): unknown[] {
    const source = Array.isArray(values) ? values : values == null ? [] : [values];
    return source
      .map((value) => typeof value === 'string' ? value.trim() : value)
      .filter((value) => value !== undefined && value !== null && String(value).trim() !== '');
  }

  private normalizeTagValues(frontmatter: CanvasFrontmatterRecord): void {
    for (const key of ['tags', 'tag']) {
      const actual = findKeyCaseInsensitive(frontmatter, key);
      if (!actual) continue;
      const normalized = normalizeTagList(frontmatter[actual]);
      if (normalized.length === 0) delete frontmatter[actual];
      else frontmatter[actual] = normalized;
    }
  }

  private removeEmptyValuesChangedByMutation(
    frontmatter: CanvasFrontmatterRecord,
    originalFrontmatter: CanvasFrontmatterRecord,
  ): void {
    for (const [key, value] of Object.entries(frontmatter)) {
      const isEmpty = value === undefined || value === null || (Array.isArray(value) && value.length === 0);
      const wasUnchanged = this.hasOwn(originalFrontmatter, key)
        && this.jsonValuesEqual(value, originalFrontmatter[key]);
      if (isEmpty && !wasUnchanged) {
        delete frontmatter[key];
      }
    }
  }

  private sortFrontmatter(frontmatter: CanvasFrontmatterRecord): CanvasFrontmatterRecord {
    const ordered: CanvasFrontmatterRecord = {};
    const entries = Object.entries(frontmatter || {});
    const claimed = new Set<string>();
    const propertyKeys = (this.plugin.settings.properties || [])
      .map((property) => String(property?.key || '').trim())
      .filter(Boolean);

    for (const configuredKey of propertyKeys) {
      const match = entries.find(([key]) => casefold(key) === casefold(configuredKey));
      if (!match) continue;
      this.defineOwnProperty(ordered, configuredKey, match[1]);
      claimed.add(casefold(match[0]));
    }

    const remainder = entries
      .filter(([key]) => !claimed.has(casefold(key)))
      .sort((left, right) => left[0].localeCompare(right[0], undefined, { sensitivity: 'base' }));

    for (const [key, value] of remainder) this.defineOwnProperty(ordered, key, value);
    return ordered;
  }

  private jsonValuesEqual(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  private hasPortableChangedValues(
    frontmatter: CanvasFrontmatterRecord,
    originalFrontmatter: CanvasFrontmatterRecord,
  ): boolean {
    for (const [key, value] of Object.entries(frontmatter)) {
      if (this.hasOwn(originalFrontmatter, key) && this.jsonValuesEqual(value, originalFrontmatter[key])) continue;
      if (!this.isPortableFrontmatterValue(value)) return false;
    }
    return true;
  }

  private isPortableFrontmatterValue(value: unknown): boolean {
    if (typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (!Array.isArray(value)) return false;
    return value.every((entry) => (
      typeof entry === 'string'
      || typeof entry === 'boolean'
      || (typeof entry === 'number' && Number.isFinite(entry))
    ));
  }

  private defineOwnProperty(target: CanvasFrontmatterRecord, key: string, value: unknown): void {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  private parseCanvasDocument(data: string): ParsedCanvasDocument {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      throw new CanvasMutationAbort('malformed-json', 'Canvas file is not valid JSON.', error);
    }

    if (!this.isRecord(parsed)) {
      throw new CanvasMutationAbort('invalid-document', 'Canvas file must contain a JSON object.');
    }
    if (!this.isJsonValue(parsed)) {
      throw new CanvasMutationAbort(
        'invalid-document',
        'Canvas file must contain finite JSON values before GCM can rewrite it.',
      );
    }
    if (this.hasOwn(parsed, 'nodes') && !Array.isArray(parsed.nodes)) {
      throw new CanvasMutationAbort('invalid-document', 'Canvas nodes must be an array when present.');
    }
    if (this.hasOwn(parsed, 'edges') && !Array.isArray(parsed.edges)) {
      throw new CanvasMutationAbort('invalid-document', 'Canvas edges must be an array when present.');
    }

    const metadataWasPresent = this.hasOwn(parsed, 'metadata');
    if (metadataWasPresent && !this.isRecord(parsed.metadata)) {
      throw new CanvasMutationAbort('invalid-metadata', 'Canvas metadata must be an object when present.');
    }
    const metadata = metadataWasPresent
      ? parsed.metadata as CanvasDocumentRecord
      : {};
    if (!this.hasOwn(metadata, 'version')) {
      throw new CanvasMutationAbort(
        'missing-version',
        'Canvas metadata must be migrated by its owning plugin before GCM can edit properties.',
      );
    }
    if (metadata.version !== SUPPORTED_CANVAS_METADATA_VERSION) {
      throw new CanvasMutationAbort(
        'unsupported-version',
        `Canvas metadata version must be ${SUPPORTED_CANVAS_METADATA_VERSION}.`,
      );
    }

    const frontmatterWasPresent = this.hasOwn(metadata, 'frontmatter');
    if (frontmatterWasPresent && !this.isRecord(metadata.frontmatter)) {
      throw new CanvasMutationAbort('invalid-frontmatter', 'Canvas metadata.frontmatter must be an object when present.');
    }

    return {
      document: parsed,
      metadata,
      frontmatter: frontmatterWasPresent
        ? metadata.frontmatter as CanvasFrontmatterRecord
        : {},
    };
  }

  private assertSynchronousMutatorResult(result: unknown): void {
    if (!result || (typeof result !== 'object' && typeof result !== 'function')) return;
    if (typeof (result as PromiseLike<unknown>).then !== 'function') return;
    void Promise.resolve(result).catch(() => undefined);
    throw new CanvasMutationAbort(
      'async-mutator',
      'Canvas frontmatter mutators must complete synchronously inside Vault.process.',
    );
  }

  private serializeCanvasDocument(document: CanvasDocumentRecord): string {
    try {
      return `${JSON.stringify(document, null, 2)}\n`;
    } catch (error) {
      throw new CanvasMutationAbort(
        'invalid-frontmatter',
        'Canvas frontmatter mutation could not be serialized safely.',
        error,
      );
    }
  }

  private assertCanvasPostcondition(
    serialized: string,
    original: ParsedCanvasDocument,
    expectedFrontmatter: CanvasFrontmatterRecord,
  ): void {
    let persisted: ParsedCanvasDocument;
    try {
      persisted = this.parseCanvasDocument(serialized);
    } catch (error) {
      throw new CanvasMutationAbort(
        'postcondition-failed',
        'Serialized canvas failed schema validation.',
        error,
      );
    }

    const originalDocumentSiblings = { ...original.document };
    const persistedDocumentSiblings = { ...persisted.document };
    delete originalDocumentSiblings.metadata;
    delete persistedDocumentSiblings.metadata;

    const expectedMetadataSiblings = { ...original.metadata };
    const persistedMetadataSiblings = { ...persisted.metadata };
    delete expectedMetadataSiblings.frontmatter;
    delete persistedMetadataSiblings.frontmatter;
    const documentSiblingsPreserved = JSON.stringify(originalDocumentSiblings)
      === JSON.stringify(persistedDocumentSiblings);
    const metadataSiblingsPreserved = JSON.stringify(expectedMetadataSiblings)
      === JSON.stringify(persistedMetadataSiblings);
    const frontmatterMatches = JSON.stringify(expectedFrontmatter)
      === JSON.stringify(persisted.frontmatter);
    if (!documentSiblingsPreserved || !metadataSiblingsPreserved || !frontmatterMatches) {
      throw new CanvasMutationAbort(
        'postcondition-failed',
        'Serialized canvas did not preserve its document or metadata contract.',
      );
    }
  }

  private isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object') return false;
    if (ancestors.has(value)) return false;

    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;

    ancestors.add(value);
    const valid = Array.isArray(value)
      ? value.every((entry) => this.isJsonValue(entry, ancestors))
      : Object.values(value as Record<string, unknown>)
        .every((entry) => this.isJsonValue(entry, ancestors));
    ancestors.delete(value);
    return valid;
  }

  private isRecord(value: unknown): value is CanvasDocumentRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * Advanced Canvas' compatibility index is identified by the complete cache
   * signature it publishes for Canvas files. A cache object or frontmatter
   * object alone is not evidence that the compatibility patch is active.
   */
  private getCanvasMetadataCacheSnapshot(file: TFile): CanvasMetadataCacheSnapshot | null {
    return this.toCanvasMetadataCacheSnapshot(this.plugin.app.metadataCache.getFileCache(file));
  }

  private toCanvasMetadataCacheSnapshot(value: unknown): CanvasMetadataCacheSnapshot | null {
    if (!this.isRecord(value) || value.v !== 1) return null;
    if (!this.isZeroCanvasPositionRange(value.frontmatterPosition)) return null;
    if (!Array.isArray(value.frontmatterLinks)) return null;
    if (!Array.isArray(value.links) || !Array.isArray(value.embeds) || !this.isRecord(value.nodes)) return null;

    const frontmatter = value.frontmatter;
    if (frontmatter !== undefined && !this.isRecord(frontmatter)) return null;
    return {
      frontmatter: this.cloneFrontmatter(frontmatter),
    };
  }

  private isZeroCanvasPositionRange(value: unknown): boolean {
    if (!this.isRecord(value)) return false;
    return this.isZeroCanvasPosition(value.start) && this.isZeroCanvasPosition(value.end);
  }

  private isZeroCanvasPosition(value: unknown): boolean {
    return this.isRecord(value)
      && value.line === 0
      && value.col === 0
      && value.offset === 0;
  }

  private handleMetadataCacheChanged(file: TFile, cache: unknown): void {
    const pending = this.pendingCommittedFrontmatter.get(file);
    if (!pending) return;
    const snapshot = this.toCanvasMetadataCacheSnapshot(cache);
    if (!snapshot) return;

    const observed = snapshot.frontmatter;
    if (this.jsonValuesEqual(observed, pending.frontmatter)) {
      this.pendingCommittedFrontmatter.delete(file);
      return;
    }

    // A queued pre-commit index may arrive after Vault.process resolves. Keep
    // serving the committed value through that phase. Any other compatible
    // cache revision is a later divergent write and supersedes our pending one.
    if (
      this.jsonValuesEqual(observed, pending.sourceFrontmatter)
      || this.jsonValuesEqual(observed, pending.cacheFrontmatter)
    ) return;
    this.pendingCommittedFrontmatter.delete(file);
  }

  private warnReadCapabilityUnavailable(file: TFile): void {
    if (!this.warnedReadCapabilityUnavailable) {
      this.warnedReadCapabilityUnavailable = true;
      new Notice('Canvas property editing requires current Advanced Canvas metadata and its metadata-cache compatibility setting.');
    }
    logger.warn('[TPS GCM] Canvas property mutation refused because readable metadata-cache compatibility is unavailable', {
      file: file.path,
    });
  }

  private runPostCommitNotification(file: TFile, notification: string, action: () => void): void {
    try {
      action();
    } catch (error) {
      logger.warn('[TPS GCM] Canvas property write committed but a follow-up notification failed', {
        file: file.path,
        notification,
        error: logger.errorSummary(error),
      });
    }
  }

  private hasOwn(target: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(target, key);
  }
}
