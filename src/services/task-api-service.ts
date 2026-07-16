import { Notice, normalizePath, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import {
  addInlineTagToTaskLine,
  getTaskDisplayTitle,
  insertLineAfterFrontmatter,
  parseTaskLine,
  readInlineFieldValue,
  readInlineTags,
  removeInlineTagFromTaskLine,
  setInlineFieldValueOnTaskLine,
  setTaskCheckboxToken,
  setTaskTitle,
  updateTaskCompletedDateForCheckboxState,
  updateTaskLineTimestamps,
} from '../utils/task-line-metadata';
import {
  extractTaskBlock,
  findCurrentTaskLineIndex,
  insertTaskBlockAfterFrontmatter,
  joinContent,
  removeTaskBlockFromContent,
  splitContent,
} from '../utils/task-block-move';
import { getLinkedSubitemCompleteMarkers, mapStatusToSubitemCheckboxState } from '../utils/linked-subitem-mapping';
import * as logger from '../logger';

const INLINE_FIELD_GLOBAL_RE = /(?:^|\s)([\[(])\s*([A-Za-z0-9_-]+)\s*::\s*([^\]\)]*)[\])]/g;

export interface GcmTaskRef {
  path: string;
  /** One-based line number. */
  line?: number;
  /** Zero-based line number, accepted for callers already using editor indexes. */
  lineNumber?: number;
  rawLine?: string;
  title?: string;
}

export interface GcmTaskRecord {
  type: 'task-line';
  id: string;
  path: string;
  line: number;
  lineNumber: number;
  rawLine: string;
  title: string;
  checkbox: string;
  marker: string;
  status: string;
  inlineStatus: string;
  isComplete: boolean;
  tags: string[];
  fields: Record<string, string>;
  blockLineCount: number;
}

export interface GcmTaskListFilter {
  files?: Array<TFile | string>;
  paths?: string[];
  pathPrefix?: string;
  query?: string;
  text?: string;
  tags?: string[];
  anyTags?: string[];
  checkbox?: string;
  status?: string;
  includeCompleted?: boolean;
  fields?: Record<string, string | string[] | null>;
  maxResults?: number;
}

export interface GcmTaskCreateInput {
  title: string;
  targetFile?: TFile;
  targetPath?: string;
  checkbox?: string;
  status?: string;
  fields?: Record<string, string | number | boolean | null | undefined>;
  tags?: string[];
  rawLine?: string;
  placement?: 'after-frontmatter' | 'end';
  focus?: boolean;
  notice?: boolean;
}

export interface GcmTaskUpdateInput {
  title?: string;
  checkbox?: string;
  status?: string;
  fields?: Record<string, string | number | boolean | null | undefined>;
  addTags?: string[];
  removeTags?: string[];
  replaceTags?: string[];
}

export interface GcmTaskMutationResult {
  ok: boolean;
  changed: boolean;
  task: GcmTaskRecord | null;
  before?: GcmTaskRecord | null;
  error?: string;
}

export class TaskApiService {
  readonly version = 1;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  parseLine(path: string, lineNumber: number, rawLine: string): GcmTaskRecord | null {
    return this.recordFromLine(path, lineNumber, rawLine);
  }

  async list(filter: GcmTaskListFilter = {}): Promise<GcmTaskRecord[]> {
    const results: GcmTaskRecord[] = [];
    const maxResults = Number.isFinite(Number(filter.maxResults))
      ? Math.max(1, Math.floor(Number(filter.maxResults)))
      : 1000;
    const files = this.resolveListFiles(filter);

    for (const file of files) {
      const content = await this.plugin.app.vault.cachedRead(file);
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const record = this.recordFromLine(file.path, index, lines[index] || '', lines);
        if (!record) continue;
        if (!this.matchesFilter(record, filter)) continue;
        results.push(record);
        if (results.length >= maxResults) return results;
      }
    }

    return results;
  }

  async get(ref: GcmTaskRef): Promise<GcmTaskRecord | null> {
    const resolved = await this.resolveTask(ref);
    return resolved?.record ?? null;
  }

  async create(input: GcmTaskCreateInput): Promise<GcmTaskMutationResult> {
    const title = String(input.title || '').replace(/\s+/g, ' ').trim();
    if (!title && !String(input.rawLine || '').trim()) {
      logger.flowWarn('TaskApi', 'create:invalid-input', { hasTitle: !!title, hasRawLine: !!String(input.rawLine || '').trim() });
      return { ok: false, changed: false, task: null, error: 'Task title is required.' };
    }

    const targetFile = input.targetFile instanceof TFile
      ? input.targetFile
      : input.targetPath
        ? this.plugin.app.vault.getFileByPath(normalizePath(input.targetPath))
        : await this.ensureTodayDailyNote();
    if (!(targetFile instanceof TFile) || targetFile.extension !== 'md') {
      logger.flowWarn('TaskApi', 'create:target-unresolved', {
        targetPath: input.targetPath || '',
        hasTargetFile: input.targetFile instanceof TFile,
      });
      return { ok: false, changed: false, task: null, error: 'Target markdown file could not be resolved.' };
    }
    const context = {
      targetPath: targetFile.path,
      placement: input.placement || 'after-frontmatter',
      focus: input.focus === true,
      notice: input.notice !== false,
      fieldKeys: Object.keys(input.fields || {}).sort(),
      tags: input.tags?.length || 0,
      hasRawLine: !!String(input.rawLine || '').trim(),
    };
    logger.flow('TaskApi', 'create:start', context);

    const line = this.applyTaskInputToLine(
      String(input.rawLine || `- [${this.normalizeMarker(input.checkbox ?? input.status ?? ' ')}] ${title}`).trim(),
      input,
      { create: true },
    );
    let insertedLineNumber = -1;

    try {
      await this.plugin.app.vault.process(targetFile, (content) => {
        if (input.placement === 'end') {
          const newline = content.includes('\r\n') ? '\r\n' : '\n';
          const separator = content.endsWith('\n') || content.length === 0 ? '' : newline;
          const previousLines = content.length ? content.split(/\r?\n/).length - (content.endsWith('\n') ? 1 : 0) : 0;
          insertedLineNumber = previousLines;
          return `${content}${separator}${line}${newline}`;
        }
        const next = insertLineAfterFrontmatter(content, line);
        insertedLineNumber = this.findInsertedLineIndex(next, line);
        return next;
      });

      const task = await this.get({
        path: targetFile.path,
        lineNumber: insertedLineNumber,
        rawLine: line,
        title,
      });
      this.notifyChanged([targetFile.path], 'task-api-create');
      if (input.notice !== false) new Notice(`Created task in ${targetFile.basename}`);
      if (input.focus === true && task) await this.focusTask(task);
      logger.flow('TaskApi', 'create:done', {
        ...context,
        lineNumber: task?.lineNumber ?? insertedLineNumber,
        resolved: !!task,
      });
      return { ok: true, changed: true, task };
    } catch (error) {
      logger.flowError('TaskApi', 'create:failed', error, context);
      return { ok: false, changed: false, task: null, error: getErrorMessage(error) };
    }
  }

  async update(ref: GcmTaskRef, input: GcmTaskUpdateInput): Promise<GcmTaskMutationResult> {
    const resolved = await this.resolveTask(ref);
    if (!resolved) {
      logger.flowWarn('TaskApi', 'update:target-unresolved', this.summarizeRef(ref));
      return { ok: false, changed: false, task: null, error: 'Task line could not be resolved.' };
    }
    const before = resolved.record;
    let changed = false;
    let writeResolved = false;
    let resolvedLineNumber = before.lineNumber;
    let nextRawLine = before.rawLine;
    const context = {
      path: resolved.file.path,
      lineNumber: before.lineNumber,
      titleChanged: input.title !== undefined,
      checkboxChanged: input.checkbox !== undefined,
      statusChanged: input.status !== undefined,
      fieldKeys: Object.keys(input.fields || {}).sort(),
      addTags: input.addTags?.length || 0,
      removeTags: input.removeTags?.length || 0,
      replaceTags: input.replaceTags?.length || 0,
    };
    logger.flow('TaskApi', 'update:start', context);

    try {
      await this.plugin.app.vault.process(resolved.file, (content) => {
        const parts = splitContent(content);
        const index = findCurrentTaskLineIndex(parts.lines, before.lineNumber, before.rawLine, before.title);
        if (index < 0) return content;
        writeResolved = true;
        resolvedLineNumber = index;
        const current = parts.lines[index] || '';
        const next = this.applyTaskInputToLine(current, input, { update: true });
        if (next === current) return content;
        parts.lines[index] = next;
        nextRawLine = next;
        changed = true;
        return joinContent(parts.lines, parts.newline, parts.endsWithNewline);
      });

      if (!writeResolved) {
        logger.flowWarn('TaskApi', 'update:stale-target', context);
        return {
          ok: false,
          changed: false,
          task: null,
          before,
          error: 'Task line changed before it could be updated.',
        };
      }

      const task = changed
        ? await this.get({ path: resolved.file.path, lineNumber: resolvedLineNumber, rawLine: nextRawLine, title: getTaskDisplayTitle(nextRawLine) })
        : before;
      if (changed) this.notifyChanged([resolved.file.path], 'task-api-update');
      logger.flow('TaskApi', 'update:done', { ...context, changed, resolved: !!task });
      return { ok: true, changed, task, before };
    } catch (error) {
      logger.flowError('TaskApi', 'update:failed', error, context);
      return { ok: false, changed: false, task: null, before, error: getErrorMessage(error) };
    }
  }

  setCheckbox(ref: GcmTaskRef, checkbox: string): Promise<GcmTaskMutationResult> {
    return this.update(ref, { checkbox });
  }

  setStatus(ref: GcmTaskRef, status: string): Promise<GcmTaskMutationResult> {
    return this.update(ref, { status });
  }

  setScheduled(ref: GcmTaskRef, scheduled: string | null): Promise<GcmTaskMutationResult> {
    return this.update(ref, { fields: { scheduled } });
  }

  setField(ref: GcmTaskRef, key: string, value: string | number | boolean | null): Promise<GcmTaskMutationResult> {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) {
      return Promise.resolve({ ok: false, changed: false, task: null, error: 'Field key is required.' });
    }
    return this.update(ref, { fields: { [cleanKey]: value } });
  }

  setFields(ref: GcmTaskRef, fields: Record<string, string | number | boolean | null | undefined>): Promise<GcmTaskMutationResult> {
    if (!fields || typeof fields !== 'object' || !Object.keys(fields).length) {
      return Promise.resolve({ ok: false, changed: false, task: null, error: 'At least one field is required.' });
    }
    return this.update(ref, { fields });
  }

  findByField(key: string, value: string | string[] | null, filter: GcmTaskListFilter = {}): Promise<GcmTaskRecord[]> {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) return Promise.resolve([]);
    return this.list({
      ...filter,
      fields: {
        ...filter.fields,
        [cleanKey]: value,
      },
    });
  }

  async move(
    ref: GcmTaskRef,
    target: { targetFile?: TFile; targetPath?: string; line?: number; lineNumber?: number; placement?: 'after-frontmatter' | 'line' },
  ): Promise<GcmTaskMutationResult> {
    const resolved = await this.resolveTask(ref);
    if (!resolved) {
      logger.flowWarn('TaskApi', 'move:source-unresolved', this.summarizeRef(ref));
      return { ok: false, changed: false, task: null, error: 'Task line could not be resolved.' };
    }
    const targetFile = target.targetFile instanceof TFile
      ? target.targetFile
      : target.targetPath
        ? this.plugin.app.vault.getFileByPath(normalizePath(target.targetPath))
        : resolved.file;
    if (!(targetFile instanceof TFile) || targetFile.extension !== 'md') {
      logger.flowWarn('TaskApi', 'move:target-unresolved', {
        ...this.summarizeRef(ref),
        targetPath: target.targetPath || '',
        hasTargetFile: target.targetFile instanceof TFile,
      });
      return { ok: false, changed: false, task: null, before: resolved.record, error: 'Target markdown file could not be resolved.' };
    }
    const context = {
      sourcePath: resolved.file.path,
      targetPath: targetFile.path,
      lineNumber: resolved.record.lineNumber,
      placement: target.placement || 'after-frontmatter',
      sameFile: resolved.file.path === targetFile.path,
    };
    logger.flow('TaskApi', 'move:start', context);

    try {
      const sourceContent = await this.plugin.app.vault.cachedRead(resolved.file);
      const sourceParts = splitContent(sourceContent);
      const sourceIndex = findCurrentTaskLineIndex(sourceParts.lines, resolved.record.lineNumber, resolved.record.rawLine, resolved.record.title);
      if (sourceIndex < 0) {
        logger.flowWarn('TaskApi', 'move:source-line-missing', context);
        return { ok: false, changed: false, task: null, before: resolved.record, error: 'Source task moved before it could be edited.' };
      }
      const block = extractTaskBlock(sourceParts.lines, sourceIndex);
      if (!block.lines.length) {
        logger.flowWarn('TaskApi', 'move:empty-block', context);
        return { ok: false, changed: false, task: null, before: resolved.record, error: 'Source task block is empty.' };
      }

      let insertedLineNumber = -1;
      if (resolved.file.path === targetFile.path) {
        await this.plugin.app.vault.process(resolved.file, (content) => {
          const parts = splitContent(content);
          const currentIndex = findCurrentTaskLineIndex(parts.lines, sourceIndex, resolved.record.rawLine, resolved.record.title);
          if (currentIndex < 0) return content;
          const currentBlock = extractTaskBlock(parts.lines, currentIndex);
          const requested = this.resolveTargetLineIndex(parts.lines.length, target);
          if (requested >= currentIndex && requested <= currentBlock.endExclusive) return content;
          const nextLines = [...parts.lines];
          nextLines.splice(currentIndex, currentBlock.endExclusive - currentIndex);
          const adjusted = requested > currentIndex ? requested - (currentBlock.endExclusive - currentIndex) : requested;
          insertedLineNumber = Math.min(Math.max(0, adjusted), nextLines.length);
          nextLines.splice(insertedLineNumber, 0, ...currentBlock.lines);
          return joinContent(nextLines, parts.newline, parts.endsWithNewline);
        });
      } else {
        await this.plugin.app.vault.process(targetFile, (content) => {
          if (target.placement !== 'line') {
            const inserted = insertTaskBlockAfterFrontmatter(content, block.lines);
            insertedLineNumber = inserted.lineIndex;
            return inserted.content;
          }
          const parts = splitContent(content);
          insertedLineNumber = this.resolveTargetLineIndex(parts.lines.length, target);
          const nextLines = [...parts.lines];
          nextLines.splice(insertedLineNumber, 0, ...block.lines);
          return joinContent(nextLines, parts.newline, true);
        });
        await this.plugin.app.vault.process(resolved.file, (content) => {
          return removeTaskBlockFromContent(content, sourceIndex, resolved.record.rawLine, resolved.record.title).content;
        });
      }

      const task = await this.get({
        path: targetFile.path,
        lineNumber: insertedLineNumber,
        rawLine: block.lines[0] || resolved.record.rawLine,
        title: resolved.record.title,
      });
      this.notifyChanged([resolved.file.path, targetFile.path], 'task-api-move');
      logger.flow('TaskApi', 'move:done', { ...context, insertedLineNumber, blockLines: block.lines.length, resolved: !!task });
      return { ok: true, changed: true, task, before: resolved.record };
    } catch (error) {
      logger.flowError('TaskApi', 'move:failed', error, context);
      return { ok: false, changed: false, task: null, before: resolved.record, error: getErrorMessage(error) };
    }
  }

  async delete(ref: GcmTaskRef): Promise<GcmTaskMutationResult> {
    const resolved = await this.resolveTask(ref);
    if (!resolved) {
      logger.flowWarn('TaskApi', 'delete:target-unresolved', this.summarizeRef(ref));
      return { ok: false, changed: false, task: null, error: 'Task line could not be resolved.' };
    }
    let changed = false;
    const context = {
      path: resolved.file.path,
      lineNumber: resolved.record.lineNumber,
      title: resolved.record.title,
    };
    logger.flow('TaskApi', 'delete:start', context);
    try {
      await this.plugin.app.vault.process(resolved.file, (content) => {
        const result = removeTaskBlockFromContent(content, resolved.record.lineNumber, resolved.record.rawLine, resolved.record.title);
        changed = result.changed;
        return result.content;
      });
      if (!changed) {
        logger.flowWarn('TaskApi', 'delete:stale-target', context);
        return {
          ok: false,
          changed: false,
          task: null,
          before: resolved.record,
          error: 'Task line changed before it could be deleted.',
        };
      }
      this.notifyChanged([resolved.file.path], 'task-api-delete');
      logger.flow('TaskApi', 'delete:done', { ...context, changed });
      return { ok: true, changed, task: null, before: resolved.record };
    } catch (error) {
      logger.flowError('TaskApi', 'delete:failed', error, context);
      return { ok: false, changed: false, task: null, before: resolved.record, error: getErrorMessage(error) };
    }
  }

  async focus(ref: GcmTaskRef): Promise<boolean> {
    const task = await this.get(ref);
    if (!task) return false;
    await this.focusTask(task);
    return true;
  }

  private recordFromLine(path: string, lineNumber: number, rawLine: string, allLines?: string[]): GcmTaskRecord | null {
    const parsed = parseTaskLine(rawLine);
    if (!parsed) return null;
    const fields = readInlineFields(rawLine);
    const marker = parsed.marker || ' ';
    const checkbox = parsed.token;
    const inlineStatus = fields.status || '';
    const status = this.plugin.sharedServices?.status?.checkboxStateToStatus(marker) || checkboxMarkerToStatus(marker);
    const blockLineCount = Array.isArray(allLines)
      ? Math.max(1, extractTaskBlock(allLines, lineNumber).lines.length)
      : 1;
    return {
      type: 'task-line',
      id: `${path}:${lineNumber + 1}`,
      path,
      line: lineNumber + 1,
      lineNumber,
      rawLine,
      title: getTaskDisplayTitle(rawLine),
      checkbox,
      marker,
      status,
      inlineStatus,
      isComplete: this.getCompleteMarkers().has(marker),
      tags: readInlineTags(rawLine),
      fields,
      blockLineCount,
    };
  }

  private summarizeRef(ref: GcmTaskRef): Record<string, unknown> {
    return {
      path: ref.path || '',
      line: ref.line ?? null,
      lineNumber: ref.lineNumber ?? null,
      hasRawLine: !!ref.rawLine,
      title: ref.title || '',
    };
  }

  private async resolveTask(ref: GcmTaskRef): Promise<{ file: TFile; record: GcmTaskRecord } | null> {
    const path = normalizePath(String(ref.path || '').trim());
    const file = this.plugin.app.vault.getFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== 'md') return null;
    const content = await this.plugin.app.vault.cachedRead(file);
    const lines = content.split(/\r?\n/);
    const preferred = typeof ref.lineNumber === 'number'
      ? Math.floor(ref.lineNumber)
      : typeof ref.line === 'number'
        ? Math.max(0, Math.floor(ref.line) - 1)
        : -1;
    const lineIndex = findCurrentTaskLineIndex(
      lines,
      preferred,
      String(ref.rawLine || ''),
      String(ref.title || (preferred >= 0 ? getTaskDisplayTitle(lines[preferred] || '') : '')),
    );
    if (lineIndex < 0) return null;
    const record = this.recordFromLine(file.path, lineIndex, lines[lineIndex] || '', lines);
    return record ? { file, record } : null;
  }

  private applyTaskInputToLine(
    line: string,
    input: GcmTaskUpdateInput | GcmTaskCreateInput,
    options: { create?: boolean; update?: boolean } = {},
  ): string {
    let next = line;
    const title = 'title' in input ? input.title : undefined;
    if (typeof title === 'string' && title.trim()) next = setTaskTitle(next, title);

    const requestedCheckbox = 'checkbox' in input ? input.checkbox : undefined;
    const requestedStatus = 'status' in input ? input.status : undefined;
    const marker = requestedCheckbox != null
      ? this.normalizeMarker(requestedCheckbox)
      : requestedStatus != null
        ? this.statusToCheckboxMarker(requestedStatus)
        : '';
    if (marker) {
      next = setTaskCheckboxToken(next, `[${marker}]`);
      next = updateTaskCompletedDateForCheckboxState(next, `[${marker}]`, {
        completeMarkers: Array.from(this.getCompleteMarkers()),
      });
      next = setInlineFieldValueOnTaskLine(next, 'status', null);
    }

    if (input.fields && typeof input.fields === 'object') {
      for (const [key, value] of Object.entries(input.fields)) {
        if (!key.trim()) continue;
        if (key.trim().toLowerCase() === 'status') {
          const status = value == null ? null : String(value);
          if (status) {
            const statusMarker = this.statusToCheckboxMarker(status);
            next = setTaskCheckboxToken(next, `[${statusMarker}]`);
            next = updateTaskCompletedDateForCheckboxState(next, `[${statusMarker}]`, {
              completeMarkers: Array.from(this.getCompleteMarkers()),
            });
          }
          next = setInlineFieldValueOnTaskLine(next, key, null);
          continue;
        }
        const cleanValue = value == null ? null : String(value).trim();
        next = setInlineFieldValueOnTaskLine(next, key, cleanValue);
      }
    }

    if ('replaceTags' in input && Array.isArray(input.replaceTags)) {
      for (const tag of readInlineTags(next)) next = removeInlineTagFromTaskLine(next, tag);
      for (const tag of input.replaceTags) next = addInlineTagToTaskLine(next, tag);
    }
    if ('removeTags' in input && Array.isArray(input.removeTags)) {
      for (const tag of input.removeTags) next = removeInlineTagFromTaskLine(next, tag);
    }
    if ('addTags' in input && Array.isArray(input.addTags)) {
      for (const tag of input.addTags) next = addInlineTagToTaskLine(next, tag);
    }
    if ('tags' in input && Array.isArray(input.tags)) {
      for (const tag of input.tags) next = addInlineTagToTaskLine(next, tag);
    }

    if (options.create === true) {
      next = updateTaskLineTimestamps(next, {
        enabled: this.plugin.settings.autoSyncFileTimestamps === true,
        createdKey: this.plugin.settings.dateCreatedFrontmatterKey,
        modifiedKey: this.plugin.settings.dateModifiedFrontmatterKey,
        format: this.plugin.settings.fileTimestampFormat,
        markCreated: true,
        markModified: true,
      });
    } else if (options.update === true && next !== line) {
      next = updateTaskLineTimestamps(next, {
        enabled: this.plugin.settings.autoSyncFileTimestamps === true,
        modifiedKey: this.plugin.settings.dateModifiedFrontmatterKey,
        format: this.plugin.settings.fileTimestampFormat,
        markModified: true,
      });
    }

    return next.trimEnd();
  }

  private resolveListFiles(filter: GcmTaskListFilter): TFile[] {
    const explicit = [...(filter.files || []), ...(filter.paths || [])];
    const files = explicit.length
      ? explicit
          .map((entry) => entry instanceof TFile ? entry : this.plugin.app.vault.getFileByPath(normalizePath(String(entry || ''))))
          .filter((file): file is TFile => file instanceof TFile && file.extension === 'md')
      : this.plugin.app.vault.getMarkdownFiles();
    const prefix = normalizePath(String(filter.pathPrefix || '').trim());
    return prefix ? files.filter((file) => file.path.startsWith(prefix)) : files;
  }

  private matchesFilter(record: GcmTaskRecord, filter: GcmTaskListFilter): boolean {
    if (filter.includeCompleted === false && record.isComplete) return false;
    const query = String(filter.query || filter.text || '').trim().toLowerCase();
    if (query && !record.title.toLowerCase().includes(query) && !record.rawLine.toLowerCase().includes(query)) return false;
    if (filter.checkbox && this.normalizeMarker(record.checkbox) !== this.normalizeMarker(filter.checkbox)) return false;
    if (filter.status && this.plugin.sharedServices.status.normalize(record.status) !== this.plugin.sharedServices.status.normalize(filter.status)) return false;
    const tags = record.tags.map((tag) => tag.toLowerCase());
    const requiredTags = (filter.tags || []).map(normalizeTagForCompare).filter(Boolean);
    if (requiredTags.some((tag) => !tags.includes(tag))) return false;
    const anyTags = (filter.anyTags || []).map(normalizeTagForCompare).filter(Boolean);
    if (anyTags.length && !anyTags.some((tag) => tags.includes(tag))) return false;
    if (filter.fields && typeof filter.fields === 'object') {
      for (const [key, expected] of Object.entries(filter.fields)) {
        const actual = readInlineFieldValue(record.rawLine, key);
        if (expected == null) {
          if (actual) return false;
          continue;
        }
        const values = Array.isArray(expected) ? expected : [expected];
        if (!values.map((value) => String(value).trim()).includes(actual)) return false;
      }
    }
    return true;
  }

  private statusToCheckboxMarker(status: string): string {
    const mappings = Array.isArray(this.plugin.settings.linkedSubitemCheckboxMappings)
      ? this.plugin.settings.linkedSubitemCheckboxMappings
      : [];
    const mapped = mapStatusToSubitemCheckboxState(mappings, this.plugin.sharedServices.status.normalize(status));
    if (mapped) {
      return this.normalizeMarker(mapped);
    }
    return this.plugin.sharedServices.status.statusToCheckboxState(status);
  }

  private normalizeMarker(value: unknown): string {
    const raw = String(value ?? '').trim();
    const tokenMatch = raw.match(/^\[([^\]\r\n]?)\]$/);
    if (tokenMatch) return tokenMatch[1] || ' ';
    if (raw.length <= 1) return raw || ' ';
    return this.statusToCheckboxMarker(raw);
  }

  private getCompleteMarkers(): Set<string> {
    return new Set(['x', 'X', ...getLinkedSubitemCompleteMarkers(this.plugin.settings.linkedSubitemCheckboxMappings || [])]);
  }

  private resolveTargetLineIndex(lineCount: number, target: { line?: number; lineNumber?: number }): number {
    const raw = typeof target.lineNumber === 'number'
      ? target.lineNumber
      : typeof target.line === 'number'
        ? target.line - 1
        : lineCount;
    return Math.min(Math.max(0, Math.floor(raw)), lineCount);
  }

  private async ensureTodayDailyNote(): Promise<TFile | null> {
    const format = this.plugin.fileNamingService.getDailyNoteDateFormat();
    const momentLib = (window as any).moment;
    const dateStr = momentLib().format(format || 'YYYY-MM-DD');
    return this.plugin.noteOperationService.ensureDailyNote(dateStr);
  }

  private findInsertedLineIndex(content: string, rawLine: string): number {
    const wanted = rawLine.trim();
    const lines = content.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (lines[index]?.trim() === wanted) return index;
    }
    return -1;
  }

  private async focusTask(task: GcmTaskRecord): Promise<void> {
    const file = this.plugin.app.vault.getFileByPath(task.path);
    if (!(file instanceof TFile)) return;
    await this.plugin.openFileInLeaf(file, false, () => this.plugin.app.workspace.getLeaf(false), { revealLeaf: true });
    const leaf = this.plugin.findOpenLeafForFile(file);
    const editor = (leaf?.view as any)?.editor;
    if (!editor) return;
    editor.setCursor?.({ line: task.lineNumber, ch: 0 });
    editor.scrollIntoView?.({ from: { line: task.lineNumber, ch: 0 }, to: { line: task.lineNumber, ch: 0 } }, true);
    editor.focus?.();
  }

  private notifyChanged(paths: string[], reason: string): void {
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
    this.plugin.eventService.emitFilesUpdated(uniquePaths, { sourcePluginId: this.plugin.manifest.id });
    this.plugin.eventService.emitCalendarRefresh(uniquePaths, { sourcePluginId: this.plugin.manifest.id });
    this.plugin.overlayRenderingService?.invalidate({
      reason,
      surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
      rebuildInlineSubitems: true,
      refreshLivePreviewEditors: true,
      delayMs: 80,
    });
  }
}

function readInlineFields(line: string): Record<string, string> {
  const fields: Record<string, string> = {};
  INLINE_FIELD_GLOBAL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_FIELD_GLOBAL_RE.exec(line)) !== null) {
    const key = String(match[2] || '').trim();
    if (key) fields[key] = String(match[3] || '').trim();
  }
  INLINE_FIELD_GLOBAL_RE.lastIndex = 0;
  return fields;
}

function normalizeTagForCompare(tag: string): string {
  return String(tag || '').trim().replace(/^#/, '').toLowerCase();
}

function checkboxMarkerToStatus(marker: string): string {
  const normalized = String(marker || '').trim().toLowerCase();
  if (!normalized) return 'todo';
  if (normalized === 'x') return 'complete';
  if (normalized === '/' || normalized === '\\') return 'working';
  if (normalized === '?') return 'holding';
  if (normalized === '-') return 'wont-do';
  return normalized;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}
