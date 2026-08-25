import {
  TFile,
  TFolder,
  normalizePath,
  parseYaml,
  stringifyYaml,
} from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';
import type { GcmTaskRef, GcmTaskRecord } from './task-api-service';
import type { FilePropertiesMutationCause } from './file-properties-service';
import { parseStringListInput } from '../utils/list-utils';
import { joinContent, splitContent } from '../utils/task-block-move';
import { parseTaskLine, readInlineFieldValue } from '../utils/task-line-metadata';

export const TPS_NATIVE_RECORD_SCHEMA_VERSION = 1;
export const DEFAULT_NATIVE_RECORD_ROOT = '_records';

export type TpsNativeRecordKind =
  | 'task'
  | 'calendar-event'
  | 'food-entry'
  | 'activity-entry'
  | 'workout-session'
  | 'workout-exercise'
  | 'asset';

export interface TpsNativeRecordEnvelope extends Record<string, unknown> {
  tpsId: string;
  tpsSchemaVersion: number;
  kind: TpsNativeRecordKind;
  title: string;
  createdDate: string;
  modifiedDate: string;
}

export interface TpsNativeRecordHandle {
  file: TFile;
  path: string;
  id: string;
  kind: TpsNativeRecordKind;
  frontmatter: TpsNativeRecordEnvelope;
}

export interface TpsNativeRecordCreateOptions {
  id?: string;
  now?: Date;
  cause?: FilePropertiesMutationCause;
}

export interface TpsTaskPromotionResult {
  ok: boolean;
  changed: boolean;
  record: TpsNativeRecordHandle | null;
  sourcePath: string;
  sourceLine: number;
  error?: string;
}

type NativeRecordReference = string | TFile | { path?: string; id?: string; tpsId?: string };

interface ParsedNativeRecordDocument {
  bom: string;
  newline: string;
  closer: '---' | '...';
  body: string;
  frontmatter: Record<string, unknown>;
}

const RECORD_FOLDER_BY_KIND: Record<TpsNativeRecordKind, string> = {
  task: 'tasks',
  'calendar-event': 'calendar-events',
  'food-entry': 'food-entries',
  'activity-entry': 'activity-entries',
  'workout-session': 'workout-sessions',
  'workout-exercise': 'workout-exercises',
  asset: 'assets',
};

const IMMUTABLE_ENVELOPE_KEYS = new Set([
  'tpsid',
  'tpsschemaversion',
  'kind',
  'createddate',
]);

const SHARED_TASK_FIELDS = [
  'priority',
  'scheduled',
  'due',
  'timeEstimate',
  'parents',
  'recurrenceRule',
  'completedDate',
] as const;

export function normalizeNativeRecordRoot(value: unknown): string {
  const normalized = normalizePath(String(value || DEFAULT_NATIVE_RECORD_ROOT)
    .trim()
    .replace(/^\/+|\/+$/gu, ''));
  if (!normalized || normalized === '.' || normalized.toLocaleLowerCase() === '.obsidian') {
    return DEFAULT_NATIVE_RECORD_ROOT;
  }
  return normalized;
}

export function buildNativeRecordPath(
  root: string,
  kind: TpsNativeRecordKind,
  id: string,
): string {
  const safeId = String(id || '')
    .trim()
    .replace(/[\\/:*?"<>|#^\[\]]+/gu, '-')
    .replace(/\.{2,}/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180);
  if (!safeId) throw new Error('Native record ID cannot be represented as a filename.');
  return normalizePath(`${normalizeNativeRecordRoot(root)}/${RECORD_FOLDER_BY_KIND[kind]}/${safeId}.md`);
}

/**
 * Native mode keeps quick, undated reminders inline. Once a task carries a
 * scheduling boundary it needs an independently addressable record so Bases,
 * TishOS, and other file-backed consumers can track it without synthesizing a
 * line row.
 */
export function taskLineNeedsNativeRecord(rawLine: string): boolean {
  if (!parseTaskLine(rawLine)) return false;
  return ['scheduled', 'due'].some((key) => (
    String(readInlineFieldValue(rawLine, key) || '').trim().length > 0
  ));
}

export function parseNativeRecordDocument(content: string): ParsedNativeRecordDocument | null {
  const source = String(content || '');
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const withoutBom = bom ? source.slice(1) : source;
  const newline = withoutBom.match(/\r\n|\n|\r/u)?.[0] || '\n';
  const lines = withoutBom.split(/\r\n|\n|\r/u);
  if (String(lines[0] || '').trim() !== '---') return null;
  let closerIndex = -1;
  let closer: '---' | '...' = '---';
  for (let index = 1; index < lines.length; index += 1) {
    const marker = String(lines[index] || '').trim();
    if (marker !== '---' && marker !== '...') continue;
    closerIndex = index;
    closer = marker;
    break;
  }
  if (closerIndex < 0) return null;
  try {
    const parsed = parseYaml(lines.slice(1, closerIndex).join(newline));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return {
      bom,
      newline,
      closer,
      body: lines.slice(closerIndex + 1).join(newline),
      frontmatter: parsed as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export function serializeNativeRecordDocument(document: ParsedNativeRecordDocument): string {
  const yaml = stringifyYaml(document.frontmatter).trimEnd();
  const body = String(document.body || '');
  return `${document.bom}---${document.newline}${yaml}${document.newline}${document.closer}${document.newline}${body}`;
}

export function isNativeRecordEnvelope(value: unknown): value is TpsNativeRecordEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Number(record.tpsSchemaVersion) === TPS_NATIVE_RECORD_SCHEMA_VERSION
    && typeof record.tpsId === 'string'
    && record.tpsId.trim().length > 0
    && typeof record.kind === 'string'
    && Object.prototype.hasOwnProperty.call(RECORD_FOLDER_BY_KIND, record.kind)
    && typeof record.title === 'string'
    && typeof record.createdDate === 'string'
    && typeof record.modifiedDate === 'string';
}

/**
 * Authoritative Markdown record storage for the opt-in native TPS profile.
 * This service never writes a non-Markdown source file and never creates a
 * legacy companion note.
 */
export class NativeRecordService {
  readonly version = 1;
  private setupComplete = false;
  private readonly newlyCreatedFiles = new WeakSet<TFile>();
  private readonly draftEligibilityTimers = new WeakMap<TFile, ReturnType<typeof setTimeout>>();
  private readonly draftAdoptions = new WeakMap<TFile, Promise<void>>();
  private readonly idsByPath = new Map<string, string>();
  private readonly pathsById = new Map<string, Set<string>>();
  private readonly recordsByPath = new Map<string, TpsNativeRecordEnvelope>();
  private readonly assetPathsBySourcePath = new Map<string, Set<string>>();

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  setup(): void {
    if (this.setupComplete) return;
    this.setupComplete = true;
    this.rebuildIndex();
    this.plugin.registerEvent(this.plugin.app.metadataCache.on('changed', (file, _data, cache) => {
      this.indexFile(file, cache?.frontmatter);
      if (this.newlyCreatedFiles.has(file)) void this.adoptNewTaskDraft(file);
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('create', (file) => {
      if (!(file instanceof TFile)) return;
      this.newlyCreatedFiles.add(file);
      const timer = globalThis.setTimeout(() => {
        this.newlyCreatedFiles.delete(file);
        this.draftEligibilityTimers.delete(file);
      }, 10_000);
      (timer as unknown as { unref?: () => void }).unref?.();
      this.draftEligibilityTimers.set(file, timer);
      this.indexFile(file);
      void this.adoptNewTaskDraft(file);
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('delete', (file) => {
      if (file instanceof TFile) this.removePath(file.path);
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('rename', (file, oldPath) => {
      void this.handleRecordRename(file, oldPath);
    }));
  }

  isEnabled(): boolean {
    return this.plugin.settings.dataArchitectureMode === 'native-records';
  }

  getMode(): 'legacy' | 'native-records' {
    return this.isEnabled() ? 'native-records' : 'legacy';
  }

  getRootPath(): string {
    return normalizeNativeRecordRoot(this.plugin.settings.nativeRecordRootPath);
  }

  isRecordFile(file: unknown): file is TFile {
    if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== 'md') return false;
    const cached = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    return isNativeRecordEnvelope(cached) || this.idsByPath.has(file.path);
  }

  async create(
    kind: TpsNativeRecordKind,
    properties: Record<string, unknown>,
    options: TpsNativeRecordCreateOptions = {},
  ): Promise<TpsNativeRecordHandle> {
    this.assertEnabled();
    if (!Object.prototype.hasOwnProperty.call(RECORD_FOLDER_BY_KIND, kind)) {
      throw new Error(`Unsupported TPS native record kind: ${String(kind)}`);
    }
    const now = options.now instanceof Date ? options.now : new Date();
    const timestamp = now.toISOString();
    const id = String(options.id || this.generateId(kind)).trim();
    if (!id) throw new Error('TPS native record ID is required.');
    const existing = await this.resolve(id);
    if (existing) throw new Error(`TPS native record ID already exists: ${id}`);

    const title = String(properties.title || '').replace(/\s+/gu, ' ').trim();
    if (!title) throw new Error('TPS native records require a title.');
    const frontmatter: TpsNativeRecordEnvelope = {
      ...this.copyUserProperties(properties),
      tpsId: id,
      tpsSchemaVersion: TPS_NATIVE_RECORD_SCHEMA_VERSION,
      kind,
      title,
      createdDate: timestamp,
      modifiedDate: timestamp,
    };
    const path = buildNativeRecordPath(this.getRootPath(), kind, id);
    if (this.plugin.app.vault.getAbstractFileByPath(path)) {
      throw new Error(`TPS native record path already exists: ${path}`);
    }
    await this.ensureParentFolder(path);
    const content = serializeNativeRecordDocument({
      bom: '',
      newline: '\n',
      closer: '---',
      body: '',
      frontmatter,
    });
    const file = await this.plugin.app.vault.create(path, content);
    this.indexFile(file, frontmatter);
    this.plugin.entityIndexService?.upsertFile(file, frontmatter);
    this.notify([file.path], options.cause, 'native-record-create');
    logger.flow('NativeRecords', 'create:done', { kind, id, path: file.path });
    return this.toHandle(file, frontmatter);
  }

  async createAsset(
    source: TFile,
    properties: Record<string, unknown> = {},
    options: TpsNativeRecordCreateOptions = {},
  ): Promise<TpsNativeRecordHandle> {
    this.assertAssetSource(source);
    const existing = this.resolveAssetCached(source);
    if (existing) return existing;
    if ((this.assetPathsBySourcePath.get(normalizePath(source.path))?.size || 0) > 1) {
      throw new Error(`Multiple asset records refer to ${source.path}; resolve the duplicate records before writing.`);
    }
    return this.create('asset', {
      ...properties,
      title: String(properties.title || source.basename).trim() || source.basename,
      sourcePath: source.path,
      sourceExtension: source.extension.toLocaleLowerCase(),
    }, options);
  }

  ensureAsset(
    source: TFile,
    properties: Record<string, unknown> = {},
    options: TpsNativeRecordCreateOptions = {},
  ): Promise<TpsNativeRecordHandle> {
    return this.createAsset(source, properties, options);
  }

  resolveAssetCached(source: TFile): TpsNativeRecordHandle | null {
    if (!(source instanceof TFile)) return null;
    const paths = this.assetPathsBySourcePath.get(normalizePath(source.path));
    if (!paths || paths.size !== 1) return null;
    const [path] = paths;
    const file = this.plugin.app.vault.getFileByPath(path);
    const frontmatter = this.recordsByPath.get(path);
    return file instanceof TFile && frontmatter?.kind === 'asset'
      ? this.toHandle(file, frontmatter)
      : null;
  }

  async resolveAsset(source: TFile): Promise<TpsNativeRecordHandle | null> {
    if (!(source instanceof TFile)) return null;
    const cached = this.resolveAssetCached(source);
    if (cached) return cached;
    this.rebuildIndex();
    return this.resolveAssetCached(source);
  }

  async resolve(reference: NativeRecordReference): Promise<TpsNativeRecordHandle | null> {
    const directFile = reference instanceof TFile
      ? reference
      : typeof reference === 'string'
        ? this.plugin.app.vault.getFileByPath(normalizePath(reference))
        : reference?.path
          ? this.plugin.app.vault.getFileByPath(normalizePath(String(reference.path)))
          : null;
    if (directFile instanceof TFile) return this.readHandle(directFile);

    const id = typeof reference === 'string'
      ? reference.trim()
      : reference instanceof TFile
        ? ''
        : String(reference?.id || reference?.tpsId || '').trim();
    if (!id) return null;
    let candidates = this.pathsById.get(this.idKey(id));
    if (!candidates || candidates.size === 0) {
      this.rebuildIndex();
      candidates = this.pathsById.get(this.idKey(id));
    }
    if (!candidates || candidates.size !== 1) return null;
    const [path] = candidates;
    const file = this.plugin.app.vault.getFileByPath(path);
    return file instanceof TFile ? this.readHandle(file) : null;
  }

  async update(
    reference: NativeRecordReference,
    updates: Record<string, unknown>,
    cause: FilePropertiesMutationCause = { kind: 'user' },
  ): Promise<TpsNativeRecordHandle | null> {
    const record = await this.resolve(reference);
    if (!record) return null;
    let nextEnvelope: TpsNativeRecordEnvelope | null = null;
    let changed = false;
    await this.plugin.app.vault.process(record.file, (content) => {
      const parsed = parseNativeRecordDocument(content);
      if (!parsed || !isNativeRecordEnvelope(parsed.frontmatter)) return content;
      if (parsed.frontmatter.tpsId !== record.id || parsed.frontmatter.kind !== record.kind) return content;
      for (const [key, value] of Object.entries(updates || {})) {
        if (IMMUTABLE_ENVELOPE_KEYS.has(key.trim().toLocaleLowerCase())) continue;
        if (value === undefined || value === null) delete parsed.frontmatter[key];
        else parsed.frontmatter[key] = value;
      }
      parsed.frontmatter.modifiedDate = new Date().toISOString();
      const next = serializeNativeRecordDocument(parsed);
      if (next === content) return content;
      changed = true;
      nextEnvelope = parsed.frontmatter as TpsNativeRecordEnvelope;
      return next;
    });
    if (!changed || !nextEnvelope) return this.resolve(record.file);
    this.indexFile(record.file, nextEnvelope);
    this.plugin.entityIndexService?.upsertFile(record.file, nextEnvelope);
    this.notify([record.file.path], cause, 'native-record-update');
    return this.toHandle(record.file, nextEnvelope);
  }

  archive(
    reference: NativeRecordReference,
    cause: FilePropertiesMutationCause = { kind: 'user' },
  ): Promise<TpsNativeRecordHandle | null> {
    return this.update(reference, {
      archived: true,
      archivedDate: new Date().toISOString(),
    }, cause);
  }

  async promoteTask(
    reference: GcmTaskRef,
    cause: FilePropertiesMutationCause = { kind: 'user', surface: 'task-record-promotion' },
  ): Promise<TpsTaskPromotionResult> {
    if (!this.isEnabled()) {
      return { ok: false, changed: false, record: null, sourcePath: reference.path, sourceLine: -1, error: 'Native record mode is not enabled.' };
    }
    const task = await this.plugin.taskApiService.get(reference);
    if (!task) {
      return { ok: false, changed: false, record: null, sourcePath: reference.path, sourceLine: -1, error: 'Task line could not be resolved.' };
    }
    const recordProperties = this.buildTaskRecordProperties(task);
    let record = task.stableId ? await this.resolve(task.stableId) : null;
    let created = false;
    try {
      if (!record) {
        record = await this.create('task', recordProperties, {
          id: task.stableId || undefined,
          cause,
        });
        created = true;
      } else if (record.kind !== 'task') {
        return { ok: false, changed: false, record: null, sourcePath: task.path, sourceLine: task.lineNumber, error: `Existing record ${record.id} is not a task.` };
      } else {
        const priorSourcePath = String(record.frontmatter.sourcePath || '').trim();
        const priorSourceTaskId = String(record.frontmatter.sourceTaskId || '').trim();
        if (
          (priorSourcePath && priorSourcePath !== task.path)
          || (priorSourceTaskId && task.stableId && priorSourceTaskId !== task.stableId)
        ) {
          return {
            ok: false,
            changed: false,
            record: null,
            sourcePath: task.path,
            sourceLine: task.lineNumber,
            error: `Tracked task identity ${record.id} already belongs to a different source task.`,
          };
        }
      }

      const sourceFile = this.plugin.app.vault.getFileByPath(task.path);
      if (!(sourceFile instanceof TFile)) throw new Error('Task source file disappeared during promotion.');
      const replaced = await this.replaceTaskWithRecordLink(sourceFile, task, record.file);
      if (!replaced) {
        if (created) {
          record = await this.update(record.file, { promotionState: 'unlinked' }, cause) || record;
        }
        return {
          ok: false,
          changed: created,
          record,
          sourcePath: task.path,
          sourceLine: task.lineNumber,
          error: 'The task changed before its stable record link could be written. The new record was preserved for recovery.',
        };
      }
      if (record.frontmatter.promotionState === 'unlinked') {
        record = await this.update(record.file, { promotionState: null }, cause) || record;
      }
      this.notify([task.path, record.path], cause, 'task-record-promote');
      logger.flow('NativeRecords', 'task-promote:done', {
        sourcePath: task.path,
        sourceLine: task.lineNumber,
        recordPath: record.path,
        created,
      });
      return {
        ok: true,
        changed: true,
        record,
        sourcePath: task.path,
        sourceLine: task.lineNumber,
      };
    } catch (error) {
      logger.flowError('NativeRecords', 'task-promote:failed', error, {
        sourcePath: task.path,
        sourceLine: task.lineNumber,
        recordPath: record?.path || '',
      });
      return {
        ok: false,
        changed: created,
        record,
        sourcePath: task.path,
        sourceLine: task.lineNumber,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildTaskRecordProperties(task: GcmTaskRecord): Record<string, unknown> {
    const properties: Record<string, unknown> = {
      title: task.title,
      status: task.status || 'todo',
      tags: [...task.tags],
      sourcePath: task.path,
      sourceLine: task.line,
      sourceTaskId: task.stableId || undefined,
    };
    for (const key of SHARED_TASK_FIELDS) {
      const sourceKey = key === 'recurrenceRule' && !task.fields.recurrenceRule ? 'recurrence' : key;
      const raw = task.fields[sourceKey];
      if (raw == null || String(raw).trim() === '') continue;
      if (key === 'timeEstimate') {
        const numeric = Number(raw);
        properties[key] = Number.isFinite(numeric) ? numeric : raw;
      } else if (key === 'parents') {
        properties[key] = parseStringListInput(raw);
      } else {
        properties[key] = raw;
      }
    }
    return properties;
  }

  private async replaceTaskWithRecordLink(sourceFile: TFile, task: GcmTaskRecord, recordFile: TFile): Promise<boolean> {
    if (this.plugin.app.vault.getFileByPath(sourceFile.path) !== sourceFile) return false;
    let replaced = false;
    await this.plugin.app.vault.process(sourceFile, (content) => {
      const parts = splitContent(content);
      let index = task.lineNumber;
      if (parts.lines[index] !== task.rawLine) {
        const matches = parts.lines
          .map((line, candidate) => line === task.rawLine ? candidate : -1)
          .filter((candidate) => candidate >= 0);
        if (matches.length !== 1) return content;
        [index] = matches;
      }
      const parsed = parseTaskLine(parts.lines[index]);
      if (!parsed) return content;
      const link = this.plugin.app.fileManager.generateMarkdownLink(
        recordFile,
        sourceFile.path,
        undefined,
        task.title,
      );
      parts.lines[index] = `${parsed.prefix}${link}`;
      replaced = true;
      return joinContent(parts.lines, parts.newline, parts.endsWithNewline);
    });
    return replaced;
  }

  private copyUserProperties(properties: Record<string, unknown>): Record<string, unknown> {
    const copied: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties || {})) {
      if (!key.trim() || IMMUTABLE_ENVELOPE_KEYS.has(key.trim().toLocaleLowerCase())) continue;
      if (value !== undefined) copied[key] = value;
    }
    return copied;
  }

  /**
   * Core Bases creates a new Markdown file beside the Base, then materializes
   * positive property filters into its frontmatter. In the native TPS profile,
   * a task Base also filters by the canonical record folder, so that temporary
   * file would otherwise disappear from the view immediately. Adopt only files
   * observed through this session's Vault create event, and only while they are
   * still empty, unenveloped task drafts.
   */
  private adoptNewTaskDraft(file: TFile): Promise<void> {
    const existing = this.draftAdoptions.get(file);
    if (existing) return existing;
    const operation = this.adoptNewTaskDraftInternal(file)
      .catch((error) => {
        logger.flowError('NativeRecords', 'base-task-draft:adopt-failed', error, {
          path: file.path,
        });
      })
      .finally(() => {
        this.draftAdoptions.delete(file);
      });
    this.draftAdoptions.set(file, operation);
    return operation;
  }

  private async adoptNewTaskDraftInternal(file: TFile): Promise<void> {
    if (!this.isEnabled() || !this.newlyCreatedFiles.has(file)) return;
    if (file.extension.toLocaleLowerCase() !== 'md') return;
    if (this.plugin.app.vault.getFileByPath(file.path) !== file) return;

    const originalPath = file.path;
    const originalContent = await this.plugin.app.vault.cachedRead(file);
    const original = parseNativeRecordDocument(originalContent);
    if (!original || original.body.trim().length > 0) return;
    if (isNativeRecordEnvelope(original.frontmatter)) return;
    if (Object.prototype.hasOwnProperty.call(original.frontmatter, 'tpsId')) return;
    if (Object.prototype.hasOwnProperty.call(original.frontmatter, 'tpsSchemaVersion')) return;
    if (typeof original.frontmatter.kind !== 'string'
      || original.frontmatter.kind.trim().toLocaleLowerCase() !== 'task') return;

    const now = new Date().toISOString();
    const title = String(original.frontmatter.title || file.basename)
      .replace(/\s+/gu, ' ')
      .trim() || 'New task';
    const id = this.generateAvailableId('task');
    const canonicalPath = buildNativeRecordPath(this.getRootPath(), 'task', id);
    await this.ensureParentFolder(canonicalPath);

    let adopted: TpsNativeRecordEnvelope | null = null;
    await this.plugin.app.vault.process(file, (content) => {
      if (content !== originalContent) return content;
      const parsed = parseNativeRecordDocument(content);
      if (!parsed || parsed.body.trim().length > 0) return content;
      if (isNativeRecordEnvelope(parsed.frontmatter)) return content;
      if (Object.prototype.hasOwnProperty.call(parsed.frontmatter, 'tpsId')) return content;
      if (Object.prototype.hasOwnProperty.call(parsed.frontmatter, 'tpsSchemaVersion')) return content;
      if (typeof parsed.frontmatter.kind !== 'string'
        || parsed.frontmatter.kind.trim().toLocaleLowerCase() !== 'task') return content;
      const status = String(parsed.frontmatter.status || '').trim();
      parsed.frontmatter = {
        ...parsed.frontmatter,
        tpsId: id,
        tpsSchemaVersion: TPS_NATIVE_RECORD_SCHEMA_VERSION,
        kind: 'task',
        title,
        createdDate: now,
        modifiedDate: now,
        status: status || 'todo',
      };
      adopted = parsed.frontmatter as TpsNativeRecordEnvelope;
      return serializeNativeRecordDocument(parsed);
    });
    if (!adopted) return;
    if (this.plugin.app.vault.getFileByPath(originalPath) !== file) return;

    await this.plugin.app.vault.rename(file, canonicalPath);
    this.newlyCreatedFiles.delete(file);
    const timer = this.draftEligibilityTimers.get(file);
    if (timer != null) globalThis.clearTimeout(timer);
    this.draftEligibilityTimers.delete(file);
    this.indexFile(file, adopted);
    this.plugin.entityIndexService?.upsertFile(file, adopted);
    this.notify([originalPath, canonicalPath], { kind: 'user', surface: 'native-base-new-task' }, 'native-base-new-task');
    logger.flow('NativeRecords', 'base-task-draft:adopted', {
      originalPath,
      canonicalPath,
      recordId: id,
    });
  }

  private async readHandle(file: TFile): Promise<TpsNativeRecordHandle | null> {
    const cached = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    if (isNativeRecordEnvelope(cached)) return this.toHandle(file, cached);
    try {
      const parsed = parseNativeRecordDocument(await this.plugin.app.vault.cachedRead(file));
      if (!parsed || !isNativeRecordEnvelope(parsed.frontmatter)) return null;
      this.indexFile(file, parsed.frontmatter);
      return this.toHandle(file, parsed.frontmatter);
    } catch {
      return null;
    }
  }

  private toHandle(file: TFile, frontmatter: TpsNativeRecordEnvelope): TpsNativeRecordHandle {
    return {
      file,
      path: file.path,
      id: frontmatter.tpsId,
      kind: frontmatter.kind,
      frontmatter: { ...frontmatter },
    };
  }

  private rebuildIndex(): void {
    this.idsByPath.clear();
    this.pathsById.clear();
    this.recordsByPath.clear();
    this.assetPathsBySourcePath.clear();
    for (const file of this.plugin.app.vault.getMarkdownFiles()) this.indexFile(file);
  }

  private indexFile(file: TFile, frontmatter?: Record<string, unknown> | null): void {
    this.removePath(file.path);
    const resolved = frontmatter ?? this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!isNativeRecordEnvelope(resolved)) return;
    const id = this.idKey(resolved.tpsId);
    this.idsByPath.set(file.path, id);
    this.recordsByPath.set(file.path, { ...resolved });
    const paths = this.pathsById.get(id) || new Set<string>();
    paths.add(file.path);
    this.pathsById.set(id, paths);
    if (resolved.kind === 'asset') {
      const sourcePath = normalizePath(String(resolved.sourcePath || '').trim());
      if (sourcePath) {
        const assetPaths = this.assetPathsBySourcePath.get(sourcePath) || new Set<string>();
        assetPaths.add(file.path);
        this.assetPathsBySourcePath.set(sourcePath, assetPaths);
      }
    }
  }

  private removePath(path: string): void {
    const prior = this.recordsByPath.get(path);
    this.recordsByPath.delete(path);
    if (prior?.kind === 'asset') {
      const sourcePath = normalizePath(String(prior.sourcePath || '').trim());
      const assetPaths = this.assetPathsBySourcePath.get(sourcePath);
      assetPaths?.delete(path);
      if (!assetPaths || assetPaths.size === 0) this.assetPathsBySourcePath.delete(sourcePath);
    }
    const id = this.idsByPath.get(path);
    if (!id) return;
    this.idsByPath.delete(path);
    const paths = this.pathsById.get(id);
    paths?.delete(path);
    if (!paths || paths.size === 0) this.pathsById.delete(id);
  }

  private async handleRecordRename(file: unknown, oldPath: string): Promise<void> {
    const prior = this.recordsByPath.get(oldPath);
    this.removePath(oldPath);
    if (!(file instanceof TFile)) return;

    const cached = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    let envelope = isNativeRecordEnvelope(cached)
      ? cached
      : isNativeRecordEnvelope(prior)
        ? prior
        : null;
    if (!envelope) {
      try {
        const parsed = parseNativeRecordDocument(await this.plugin.app.vault.cachedRead(file));
        if (parsed && isNativeRecordEnvelope(parsed.frontmatter)) envelope = parsed.frontmatter;
      } catch {
        // A rename can race MetadataCache. If the authoritative read also fails,
        // leave the file untouched and let the next metadata event index it.
      }
    }
    if (!envelope) {
      this.indexFile(file);
      return;
    }

    const canonicalPath = buildNativeRecordPath(this.getRootPath(), envelope.kind, envelope.tpsId);
    if (file.path === canonicalPath) {
      this.indexFile(file, envelope);
      return;
    }
    if (this.plugin.app.vault.getFileByPath(file.path) !== file) return;

    const occupied = this.plugin.app.vault.getAbstractFileByPath(canonicalPath);
    if (occupied && occupied !== file) {
      this.indexFile(file, envelope);
      logger.warn('[TPS GCM] Native record filename restore blocked by an occupied canonical path', {
        recordId: envelope.tpsId,
        recordKind: envelope.kind,
        currentPath: file.path,
        canonicalPath,
      });
      return;
    }

    try {
      await this.ensureParentFolder(canonicalPath);
      if (this.plugin.app.vault.getFileByPath(file.path) !== file) return;
      await this.plugin.app.vault.rename(file, canonicalPath);
      this.indexFile(file, envelope);
      logger.flow('NativeRecords', 'canonical-path:restored', {
        recordId: envelope.tpsId,
        recordKind: envelope.kind,
        oldPath,
        canonicalPath,
      });
    } catch (error) {
      this.indexFile(file, envelope);
      logger.flowError('NativeRecords', 'canonical-path:restore-failed', error, {
        recordId: envelope.tpsId,
        recordKind: envelope.kind,
        currentPath: file.path,
        canonicalPath,
      });
    }
  }

  private idKey(id: string): string {
    return String(id || '').trim().toLocaleLowerCase();
  }

  private generateId(kind: TpsNativeRecordKind): string {
    const prefix = RECORD_FOLDER_BY_KIND[kind].replace(/-entries$|-sessions$|-exercises$|s$/gu, '');
    const uuid = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    return `${prefix}-${uuid}`;
  }

  private generateAvailableId(kind: TpsNativeRecordKind): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = this.generateId(kind);
      const path = buildNativeRecordPath(this.getRootPath(), kind, id);
      if (!this.plugin.app.vault.getAbstractFileByPath(path) && !this.pathsById.has(this.idKey(id))) return id;
    }
    throw new Error(`Unable to allocate a unique TPS native ${kind} record ID.`);
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const segments = normalizePath(path).split('/').slice(0, -1);
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.plugin.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`Cannot create TPS record folder because a file exists at ${current}.`);
      await this.plugin.app.vault.createFolder(current);
    }
  }

  private notify(paths: string[], cause: FilePropertiesMutationCause | undefined, source: string): void {
    const sourcePluginId = String(cause?.sourcePluginId || this.plugin.manifest.id);
    this.plugin.eventService.emitFilesUpdated(paths, { sourcePluginId });
    if (cause?.kind !== 'automation') {
      this.plugin.eventService.emitExplicitAction(paths, {
        sourcePluginId,
        source: String(cause?.surface || source),
      });
    }
  }

  private assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new Error('TPS native record creation requires the native-records data architecture mode.');
    }
  }

  private assertAssetSource(source: TFile): void {
    this.assertEnabled();
    if (!(source instanceof TFile)) throw new Error('Asset record source must be a vault file.');
    if (source.extension.toLocaleLowerCase() === 'md') {
      throw new Error('Asset records are only created for non-Markdown source files.');
    }
    if (this.plugin.app.vault.getFileByPath(source.path) !== source) {
      throw new Error('Asset record source is no longer the live file at that path.');
    }
  }
}
