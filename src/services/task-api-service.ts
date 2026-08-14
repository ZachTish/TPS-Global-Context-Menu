import { Notice, normalizePath } from 'obsidian';
import type { TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import {
  addInlineTagToTaskLine,
  findAfterFrontmatterIndex,
  getTaskDisplayTitle,
  insertLineAfterFrontmatter,
  parseTaskLine,
  readInlineFieldValue,
  readInlineTags,
  removeInlineTagFromTaskLine,
  setInlineFieldValueOnTaskLine,
  setTaskTitle,
  updateTaskCompletedDateForCheckboxState,
  updateTaskLineTimestamps,
} from '../utils/task-line-metadata';
import {
  clearTaskCheckboxOwnedWorkflowFields,
  getTaskCheckboxWorkflowMutationSignature,
  isTaskCheckboxOwnedWorkflowFieldKey,
  isTaskCheckboxWorkflowTokenCurrent,
  setTaskCheckboxWorkflowState,
  type TaskCheckboxWorkflowFieldOwnership,
} from '../utils/task-checkbox-workflow-mutation';
import {
  buildDailyNoteScratchpadMovedTaskBlock,
  extractTaskBlock,
  findCurrentTaskLineIndex,
  insertTaskBlockAtEnd,
  insertTaskBlockAfterFrontmatter,
  joinContent,
  removeTaskBlockFromContent,
  replaceTaskBlockInContent,
  splitContent,
} from '../utils/task-block-move';
import {
  getLinkedSubitemCompleteMarkers,
  getLinkedSubitemMappingForState,
  mapStatusToSubitemCheckboxState,
  normalizeLinkedSubitemCheckboxState,
  normalizeLinkedSubitemMappings,
} from '../utils/linked-subitem-mapping';
import * as logger from '../logger';
import { findRelationalStatusProperty } from '../utils/property-option-source';
import { classifyMappedTaskCheckboxState } from '../utils/task-checkbox-classification';
import { scanMarkdownDocumentLines } from '../utils/markdown-document-lines';
import type { ItemHistoryUserCause } from './item-history-service';
import { ensureTaskHistoryIdentity, getTaskHistoryIdentity } from './item-history-core';

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
  /** Stable history identity when the line already has a TPS-owned task or subitem ID. */
  stableId: string | null;
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

export interface GcmTaskMoveTarget {
  targetFile?: TFile;
  targetPath?: string;
  line?: number;
  lineNumber?: number;
  placement?: 'end' | 'after-frontmatter' | 'line';
  /**
   * `configured-daily-note` follows GCM's user setting for cross-file moves
   * from Daily Notes. The two legacy policies remain explicit and stable.
   */
  sourcePolicy?: 'remove' | 'migrate-if-daily-note' | 'configured-daily-note';
  resolution?: 'default' | 'exact-or-identity';
}

export interface GcmTaskMutationResult {
  ok: boolean;
  changed: boolean;
  task: GcmTaskRecord | null;
  before?: GcmTaskRecord | null;
  error?: string;
}

interface TaskUpdateExecutionOptions {
  checklistFollowup?: boolean;
  completionTarget?: boolean;
  historyAction?: 'task.update' | 'task.checkbox';
}

interface PostFollowupTaskIdentity {
  rawLine: string;
  title: string;
  marker: string | null;
}

interface TaskInputMappingPlan {
  checkboxMarker: string | null;
  statusMarker: string | null;
  rawLineMarker: string | null;
  fieldStatusMarkers: ReadonlyMap<string, string>;
  impliedCreateMarker: string | null;
  completeMarkers: readonly string[];
  mappingSignature: string;
  mutatesCheckboxWorkflow: boolean;
}

type TaskInputMappingPreflight =
  | { ok: true; plan: TaskInputMappingPlan }
  | { ok: false; error: string };

type RejectedWriteState = 'unchanged' | 'committed' | 'conflicted';
type TaskHistoryAction = 'task.update' | 'task.checkbox' | 'task.move' | 'task.migrate' | 'task.delete' | 'task.create';
type TaskHistoryLocator = { path: string; lineNumber: number; rawLine: string };
type TaskHistoryHandle = Awaited<ReturnType<TPSGlobalContextMenuPlugin['itemHistoryService']['beginTaskMutation']>>;
type TaskHistoryCommit = {
  confirmedBefore?: TaskHistoryLocator;
  after?: TaskHistoryLocator;
  sourceDisposition?: 'removed' | 'migrated' | 'retained';
  outcome?: 'committed' | 'partial';
};

export class TaskApiService {
  readonly version = 3;
  private readonly historyIdentityFailures = new WeakSet<object>();

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
      const documentLines = scanMarkdownDocumentLines(content);
      const lines = documentLines.map((line) => line.text);
      for (const line of documentLines) {
        if (!line.isContent) continue;
        const record = this.recordFromLine(file.path, line.index, line.text, lines);
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

  async create(input: GcmTaskCreateInput, cause?: ItemHistoryUserCause): Promise<GcmTaskMutationResult> {
    const title = String(input.title || '').replace(/\s+/g, ' ').trim();
    if (!title && !String(input.rawLine || '').trim()) {
      logger.flowWarn('TaskApi', 'create:invalid-input', { hasTitle: !!title, hasRawLine: !!String(input.rawLine || '').trim() });
      return { ok: false, changed: false, task: null, error: 'Task title is required.' };
    }
    const mappingPreflight = this.preflightTaskInputMappings(input, { create: true });
    if ('error' in mappingPreflight) {
      logger.flowWarn('TaskApi', 'create:unsupported-checkbox-mapping', { error: mappingPreflight.error });
      return { ok: false, changed: false, task: null, error: mappingPreflight.error };
    }
    const initialMarker = mappingPreflight.plan.checkboxMarker
      || mappingPreflight.plan.statusMarker
      || Array.from(mappingPreflight.plan.fieldStatusMarkers.values()).at(-1)
      || mappingPreflight.plan.impliedCreateMarker;
    if (!String(input.rawLine || '').trim() && !initialMarker) {
      return { ok: false, changed: false, task: null, error: 'A mapped checkbox state is required to create a task.' };
    }

    const hasExplicitTarget = input.targetFile != null || !!String(input.targetPath || '').trim();
    const targetFile = this.resolveMarkdownFile(input.targetFile)
      ?? this.resolveMarkdownFile(input.targetPath)
      ?? (hasExplicitTarget ? null : this.resolveMarkdownFile(await this.ensureTodayDailyNote()));
    if (!targetFile) {
      logger.flowWarn('TaskApi', 'create:target-unresolved', {
        targetPath: input.targetPath || '',
        hasTargetFile: input.targetFile != null,
      });
      return { ok: false, changed: false, task: null, error: 'Target markdown file could not be resolved.' };
    }
    if (!this.mappingPlanIsCurrent(mappingPreflight.plan)) {
      return {
        ok: false,
        changed: false,
        task: null,
        error: 'Task status mappings changed before the task could be created.',
      };
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
      String(input.rawLine || `- [${initialMarker}] ${title}`).trim(),
      input,
      { create: true },
      mappingPreflight.plan,
    );
    const historyHandle = await this.beginHistoryMutation('task.create', cause, {
      path: targetFile.path,
      lineNumber: 0,
      rawLine: line,
    });
    let insertedRawLine = line;
    let insertedLineNumber = -1;
    let writeAccepted = false;
    let writeCommitted = false;
    let createBeforeContent: string | null = null;
    let createExpectedContent: string | null = null;
    let mappingGuardBlocked = false;

    try {
      await this.plugin.app.vault.process(targetFile, (content) => {
        const liveMappings = this.getConfiguredTaskMappings();
        const parsedLine = parseTaskLine(line);
        if (
          !this.mappingPlanIsCurrent(mappingPreflight.plan, liveMappings)
          || !parsedLine
          || !getLinkedSubitemMappingForState(liveMappings, parsedLine.token, { normalizedMappings: true })
        ) {
          mappingGuardBlocked = true;
          return content;
        }
        writeAccepted = true;
        createBeforeContent = content;
        insertedRawLine = this.ensureHistoryIdentity(historyHandle, line);
        if (input.placement === 'end') {
          const newline = content.includes('\r\n') ? '\r\n' : '\n';
          const separator = content.endsWith('\n') || content.length === 0 ? '' : newline;
          const previousLines = content.length ? content.split(/\r?\n/).length - (content.endsWith('\n') ? 1 : 0) : 0;
          insertedLineNumber = previousLines;
          createExpectedContent = `${content}${separator}${insertedRawLine}${newline}`;
          return createExpectedContent;
        }
        const next = insertLineAfterFrontmatter(content, insertedRawLine);
        insertedLineNumber = this.findInsertedLineIndex(next, insertedRawLine);
        createExpectedContent = next;
        return next;
      });

      if (!writeAccepted) {
        await this.abortHistoryMutation(historyHandle);
        if (mappingGuardBlocked) {
          logger.flowWarn('TaskApi', 'create:mapping-changed', context);
        }
        return {
          ok: false,
          changed: false,
          task: null,
          error: mappingGuardBlocked
            ? 'Task status mappings changed before the task could be created.'
            : 'Task could not be inserted.',
        };
      }
      writeCommitted = true;

      const task = await this.get({
        path: targetFile.path,
        lineNumber: insertedLineNumber,
        rawLine: insertedRawLine,
        title,
      });
      await this.commitHistoryMutation(historyHandle, {
        after: {
          path: targetFile.path,
          lineNumber: insertedLineNumber,
          rawLine: insertedRawLine,
        },
        outcome: 'committed',
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
      const writeState = writeCommitted
        ? 'committed'
        : createBeforeContent != null && createExpectedContent != null
          ? await this.classifyRejectedWrite(targetFile, createBeforeContent, createExpectedContent)
          : 'unchanged';
      const contentChanged = writeState !== 'unchanged';
      if (writeState === 'committed') {
        await this.commitHistoryMutation(historyHandle, {
          after: {
            path: targetFile.path,
            lineNumber: Math.max(0, insertedLineNumber),
            rawLine: insertedRawLine,
          },
          outcome: 'partial',
        });
      } else {
        await this.abortHistoryMutation(historyHandle);
      }
      logger.flowError('TaskApi', 'create:failed', error, context);
      return { ok: false, changed: contentChanged, task: null, error: getErrorMessage(error) };
    }
  }

  async update(
    ref: GcmTaskRef,
    input: GcmTaskUpdateInput,
    cause?: ItemHistoryUserCause,
  ): Promise<GcmTaskMutationResult> {
    return this.updateTask(ref, input, {}, cause);
  }

  setCheckbox(ref: GcmTaskRef, checkbox: string, cause?: ItemHistoryUserCause): Promise<GcmTaskMutationResult> {
    return this.updateTask(ref, { checkbox }, { historyAction: 'task.checkbox' }, cause);
  }

  /**
   * Applies GCM's configured complete/todo mapping and runs the same note-level
   * recurrence, final-status, and checklist-property follow-up as GCM's UI.
   */
  setCompletion(ref: GcmTaskRef, completed: boolean, cause?: ItemHistoryUserCause): Promise<GcmTaskMutationResult> {
    return this.updateTask(ref, { status: completed ? 'complete' : 'todo' }, {
      checklistFollowup: true,
      completionTarget: completed,
      historyAction: 'task.checkbox',
    }, cause);
  }

  setStatus(ref: GcmTaskRef, status: string, cause?: ItemHistoryUserCause): Promise<GcmTaskMutationResult> {
    return this.update(ref, { status }, cause);
  }

  setScheduled(ref: GcmTaskRef, scheduled: string | null, cause?: ItemHistoryUserCause): Promise<GcmTaskMutationResult> {
    return this.update(ref, { fields: { scheduled } }, cause);
  }

  setField(
    ref: GcmTaskRef,
    key: string,
    value: string | number | boolean | null,
    cause?: ItemHistoryUserCause,
  ): Promise<GcmTaskMutationResult> {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) {
      return Promise.resolve({ ok: false, changed: false, task: null, error: 'Field key is required.' });
    }
    return this.update(ref, { fields: { [cleanKey]: value } }, cause);
  }

  setFields(
    ref: GcmTaskRef,
    fields: Record<string, string | number | boolean | null | undefined>,
    cause?: ItemHistoryUserCause,
  ): Promise<GcmTaskMutationResult> {
    if (!fields || typeof fields !== 'object' || !Object.keys(fields).length) {
      return Promise.resolve({ ok: false, changed: false, task: null, error: 'At least one field is required.' });
    }
    return this.update(ref, { fields }, cause);
  }

  private async updateTask(
    ref: GcmTaskRef,
    input: GcmTaskUpdateInput,
    options: TaskUpdateExecutionOptions = {},
    cause?: ItemHistoryUserCause,
  ): Promise<GcmTaskMutationResult> {
    const mappingPreflight = this.preflightTaskInputMappings(input);
    if ('error' in mappingPreflight) {
      logger.flowWarn('TaskApi', 'update:unsupported-checkbox-mapping', { error: mappingPreflight.error });
      return { ok: false, changed: false, task: null, error: mappingPreflight.error };
    }
    const resolved = await this.resolveTask(ref);
    if (!resolved) {
      logger.flowWarn('TaskApi', 'update:target-unresolved', this.summarizeRef(ref));
      return { ok: false, changed: false, task: null, error: 'Task line could not be resolved.' };
    }
    if (mappingPreflight.plan.mutatesCheckboxWorkflow && !this.mappingPlanIsCurrent(mappingPreflight.plan)) {
      return {
        ok: false,
        changed: false,
        task: null,
        error: 'Task status mappings changed before the task could be updated.',
      };
    }
    const before = resolved.record;
    const historyHandle = await this.beginHistoryMutation(options.historyAction || 'task.update', cause, {
      path: before.path,
      lineNumber: before.lineNumber,
      rawLine: before.rawLine,
    });
    let changed = false;
    let writeCommitted = false;
    let updateBeforeContent: string | null = null;
    let updateExpectedContent: string | null = null;
    let writeResolved = false;
    let resolvedLineNumber = before.lineNumber;
    let nextRawLine = before.rawLine;
    let confirmedHistoryBefore: TaskHistoryLocator | undefined;
    let previousMarker: string | null = null;
    let nextMarker: string | null = null;
    let updatedLines: string[] | null = null;
    let resolvedCurrentTask: GcmTaskRecord = before;
    let mappingGuardBlocked = false;
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
        const liveMappings = mappingPreflight.plan.mutatesCheckboxWorkflow
          ? this.getConfiguredTaskMappings()
          : null;
        if (
          liveMappings
          && !this.mappingPlanIsCurrent(mappingPreflight.plan, liveMappings)
        ) {
          mappingGuardBlocked = true;
          return content;
        }
        const currentResolution = this.resolveMutableTaskLine(
          content,
          before.lineNumber,
          before.rawLine,
          before.title,
        );
        if (!currentResolution) return content;
        const { parts, index } = currentResolution;
        resolvedLineNumber = index;
        const current = parts.lines[index] || '';
        confirmedHistoryBefore = {
          path: resolved.file.path,
          lineNumber: index,
          rawLine: current,
        };
        nextRawLine = current;
        const currentRecord = this.recordFromLine(resolved.file.path, index, current, parts.lines);
        if (currentRecord) resolvedCurrentTask = currentRecord;
        const currentParsed = options.checklistFollowup
          || options.completionTarget !== undefined
          || mappingPreflight.plan.mutatesCheckboxWorkflow
          ? parseTaskLine(current)
          : null;
        if (
          liveMappings
          && !isTaskCheckboxWorkflowTokenCurrent(currentParsed?.token, before.checkbox)
        ) return content;
        if (
          liveMappings
          && (
            !currentParsed
            || !getLinkedSubitemMappingForState(liveMappings, currentParsed.token, { normalizedMappings: true })
          )
        ) {
          mappingGuardBlocked = true;
          return content;
        }
        writeResolved = true;
        if (options.completionTarget !== undefined && currentParsed) {
          const currentState = classifyMappedTaskCheckboxState(
            this.plugin.settings.linkedSubitemCheckboxMappings || [],
            currentParsed.token,
            this.getTaskClassificationOptions(),
          );
          const alreadyAtTarget = options.completionTarget
            ? currentState.isComplete
            : currentState.isOpen || currentState.isMigrated;
          if (alreadyAtTarget) return content;
        }
        let next = this.applyTaskInputToLine(current, input, { update: true }, mappingPreflight.plan);
        const nextParsed = liveMappings ? parseTaskLine(next) : null;
        if (
          liveMappings
          && (
            !nextParsed
            || !getLinkedSubitemMappingForState(liveMappings, nextParsed.token, { normalizedMappings: true })
          )
        ) {
          mappingGuardBlocked = true;
          return content;
        }
        if (next === current) return content;
        next = this.ensureHistoryIdentity(historyHandle, next);
        parts.lines[index] = next;
        nextRawLine = next;
        if (options.checklistFollowup) {
          previousMarker = currentParsed?.marker ?? null;
          nextMarker = parseTaskLine(next)?.marker ?? null;
          updatedLines = [...parts.lines];
        }
        changed = true;
        updateBeforeContent = content;
        updateExpectedContent = joinContent(parts.lines, parts.newline, parts.endsWithNewline);
        return updateExpectedContent;
      });
      writeCommitted = changed;

      if (mappingGuardBlocked) {
        await this.abortHistoryMutation(historyHandle);
        logger.flowWarn('TaskApi', 'update:mapping-changed', context);
        return {
          ok: false,
          changed: false,
          task: null,
          before,
          error: 'Task status mappings changed before the task could be updated.',
        };
      }

      if (!writeResolved) {
        await this.abortHistoryMutation(historyHandle);
        logger.flowWarn('TaskApi', 'update:stale-target', context);
        return {
          ok: false,
          changed: false,
          task: null,
          before,
          error: 'Task line changed before it could be updated.',
        };
      }

      let task = changed
        ? await this.get({ path: resolved.file.path, lineNumber: resolvedLineNumber, rawLine: nextRawLine, title: getTaskDisplayTitle(nextRawLine) })
        : resolvedCurrentTask;
      let followupError: unknown = null;
      if (changed && options.checklistFollowup && updatedLines) {
        try {
          await this.plugin.taskCheckboxHandler.handleExternalChecklistStateMutation(
            resolved.file,
            previousMarker,
            nextMarker,
            updatedLines,
            resolvedLineNumber,
          );
        } catch (error) {
          followupError = error;
          logger.flowError('TaskApi', 'update:checkbox-followup-failed', error, {
            path: resolved.file.path,
            lineNumber: resolvedLineNumber,
          });
        }
        task = await this.readTaskAfterFollowup(resolved.file, {
          rawLine: nextRawLine,
          title: getTaskDisplayTitle(nextRawLine),
          marker: nextMarker,
        });
      }
      if (changed) this.notifyChanged([resolved.file.path], 'task-api-update');
      if (changed && options.checklistFollowup && !task) {
        await this.abortHistoryMutation(historyHandle);
      } else if (changed) {
        const confirmedHistoryAfter = options.checklistFollowup && task
          ? { lineNumber: task.lineNumber, rawLine: task.rawLine }
          : { lineNumber: resolvedLineNumber, rawLine: nextRawLine };
        await this.commitHistoryMutation(historyHandle, {
          ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
          after: {
            path: resolved.file.path,
            lineNumber: confirmedHistoryAfter.lineNumber,
            rawLine: confirmedHistoryAfter.rawLine,
          },
          sourceDisposition: 'retained',
          outcome: followupError ? 'partial' : 'committed',
        });
      } else {
        await this.abortHistoryMutation(historyHandle);
      }
      if (followupError) {
        logger.flowWarn('TaskApi', 'update:checkbox-followup-incomplete', {
          ...context,
          changed,
          resolved: !!task,
        });
        return {
          ok: false,
          changed: true,
          task,
          before,
          error: `Task checkbox changed, but its completion follow-up failed: ${getErrorMessage(followupError)}`,
        };
      }
      logger.flow('TaskApi', 'update:done', { ...context, changed, resolved: !!task });
      return { ok: true, changed, task, before };
    } catch (error) {
      const writeState = writeCommitted
        ? 'committed'
        : updateBeforeContent != null && updateExpectedContent != null
          ? await this.classifyRejectedWrite(resolved.file, updateBeforeContent, updateExpectedContent)
          : 'unchanged';
      if (writeState === 'committed') {
        await this.commitHistoryMutation(historyHandle, {
          ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
          after: {
            path: resolved.file.path,
            lineNumber: resolvedLineNumber,
            rawLine: nextRawLine,
          },
          sourceDisposition: 'retained',
          outcome: 'partial',
        });
      } else {
        await this.abortHistoryMutation(historyHandle);
      }
      logger.flowError('TaskApi', 'update:failed', error, context);
      return {
        ok: false,
        changed: writeState !== 'unchanged',
        task: null,
        before,
        error: getErrorMessage(error),
      };
    }
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
    target: GcmTaskMoveTarget,
    cause?: ItemHistoryUserCause,
  ): Promise<GcmTaskMutationResult> {
    const sourcePolicy = target?.sourcePolicy;
    if (
      sourcePolicy !== undefined
      && sourcePolicy !== 'remove'
      && sourcePolicy !== 'migrate-if-daily-note'
      && sourcePolicy !== 'configured-daily-note'
    ) {
      logger.flowWarn('TaskApi', 'move:unsupported-source-policy', {
        hasSourcePolicy: true,
      });
      return {
        ok: false,
        changed: false,
        task: null,
        error: 'Unsupported source policy. The task was not moved.',
      };
    }
    const strictResolution = target.resolution === 'exact-or-identity';
    const resolved = await this.resolveTask(ref);
    if (!resolved || (strictResolution && !this.moveRefMatchesLine(ref, resolved.record.rawLine))) {
      logger.flowWarn('TaskApi', 'move:source-unresolved', {
        ...this.summarizeRef(ref),
        resolution: target.resolution || 'default',
      });
      return { ok: false, changed: false, task: null, error: 'Task line could not be resolved exactly.' };
    }
    const hasExplicitTarget = target.targetFile != null || !!String(target.targetPath || '').trim();
    const targetFile = this.resolveMarkdownFile(target.targetFile)
      ?? this.resolveMarkdownFile(target.targetPath)
      ?? (hasExplicitTarget ? null : resolved.file);
    if (!targetFile) {
      logger.flowWarn('TaskApi', 'move:target-unresolved', {
        ...this.summarizeRef(ref),
        targetPath: target.targetPath || '',
        hasTargetFile: target.targetFile != null,
      });
      return { ok: false, changed: false, task: null, before: resolved.record, error: 'Target markdown file could not be resolved.' };
    }

    const sameFile = resolved.file.path === targetFile.path;
    const sourceIsDailyNote = !sameFile
      && target.sourcePolicy !== 'remove'
      && await this.plugin.fileNamingService.isDailyNoteFile(resolved.file);
    const migrateDailySource = sourceIsDailyNote && (
      target.sourcePolicy === 'migrate-if-daily-note'
      || (
        target.sourcePolicy === 'configured-daily-note'
        && this.plugin.settings.dailyNoteTaskMoveSourceBehavior !== 'remove'
      )
    );
    const configuredDailySourceRemoval = sourceIsDailyNote
      && target.sourcePolicy === 'configured-daily-note'
      && this.plugin.settings.dailyNoteTaskMoveSourceBehavior === 'remove';
    const context = {
      sourcePath: resolved.file.path,
      targetPath: targetFile.path,
      lineNumber: resolved.record.lineNumber,
      placement: target.placement || 'end',
      sameFile,
      sourcePolicy: migrateDailySource
        ? 'daily-note-migrate'
        : configuredDailySourceRemoval
          ? 'daily-note-remove'
          : 'remove',
      resolution: target.resolution || 'default',
    };
    logger.flow('TaskApi', 'move:start', context);
    const historyHandle = await this.beginHistoryMutation(
      migrateDailySource ? 'task.migrate' : 'task.move',
      cause,
      {
        path: resolved.file.path,
        lineNumber: resolved.record.lineNumber,
        rawLine: resolved.record.rawLine,
      },
      targetFile.path,
    );
    let confirmedHistoryBefore: TaskHistoryLocator | undefined;

    if (sameFile) {
      let insertedLineNumber = resolved.record.lineNumber;
      let movedRawLine = resolved.record.rawLine;
      let sourceResolved = false;
      let changed = false;
      let writeCommitted = false;
      let sameFileBeforeContent: string | null = null;
      let sameFileExpectedContent: string | null = null;
      try {
        await this.plugin.app.vault.process(resolved.file, (content) => {
          const currentResolution = this.resolveMutableTaskLine(
            content,
            resolved.record.lineNumber,
            resolved.record.rawLine,
            resolved.record.title,
          );
          if (!currentResolution) return content;
          const currentRawLine = currentResolution.parts.lines[currentResolution.index] || '';
          if (strictResolution && !this.moveRefMatchesLine(ref, currentRawLine)) return content;
          const currentBlock = extractTaskBlock(currentResolution.parts.lines, currentResolution.index);
          if (!currentBlock.lines.length) return content;
          confirmedHistoryBefore = {
            path: resolved.file.path,
            lineNumber: currentResolution.index,
            rawLine: currentRawLine,
          };
          sourceResolved = true;
          const requested = this.resolveTargetLineIndex(currentResolution.parts.lines, target);
          if (requested >= currentResolution.index && requested <= currentBlock.endExclusive) {
            insertedLineNumber = currentResolution.index;
            return content;
          }
          const nextLines = [...currentResolution.parts.lines];
          nextLines.splice(
            currentResolution.index,
            currentBlock.endExclusive - currentResolution.index,
          );
          const adjusted = requested > currentResolution.index
            ? requested - (currentBlock.endExclusive - currentResolution.index)
            : requested;
          insertedLineNumber = Math.min(Math.max(0, adjusted), nextLines.length);
          const movedBlock = [...currentBlock.lines];
          movedBlock[0] = this.ensureHistoryIdentity(historyHandle, movedBlock[0] || currentRawLine);
          movedRawLine = movedBlock[0];
          nextLines.splice(insertedLineNumber, 0, ...movedBlock);
          changed = true;
          sameFileBeforeContent = content;
          sameFileExpectedContent = joinContent(
            nextLines,
            currentResolution.parts.newline,
            currentResolution.parts.endsWithNewline,
          );
          return sameFileExpectedContent;
        });
        writeCommitted = changed;
      } catch (error) {
        const writeState = writeCommitted
          ? 'committed'
          : sameFileBeforeContent != null && sameFileExpectedContent != null
            ? await this.classifyRejectedWrite(resolved.file, sameFileBeforeContent, sameFileExpectedContent)
            : 'unchanged';
        if (writeState === 'committed') {
          await this.commitHistoryMutation(historyHandle, {
            ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
            after: {
              path: resolved.file.path,
              lineNumber: insertedLineNumber,
              rawLine: movedRawLine,
            },
            outcome: 'partial',
          });
          this.notifyChanged([resolved.file.path], 'task-api-move-partial');
        } else {
          await this.abortHistoryMutation(historyHandle);
        }
        logger.flowError('TaskApi', 'move:same-file-failed', error, context);
        return {
          ok: false,
          changed: writeState !== 'unchanged',
          task: null,
          before: resolved.record,
          error: getErrorMessage(error),
        };
      }
      if (!sourceResolved) {
        await this.abortHistoryMutation(historyHandle);
        logger.flowWarn('TaskApi', 'move:source-became-protected', context);
        return {
          ok: false,
          changed: false,
          task: null,
          before: resolved.record,
          error: 'Source task moved into protected Markdown before it could be moved.',
        };
      }
      if (!changed) {
        await this.abortHistoryMutation(historyHandle);
        const task = await this.get({
          path: resolved.file.path,
          lineNumber: insertedLineNumber,
          rawLine: movedRawLine,
          title: resolved.record.title,
        });
        logger.flow('TaskApi', 'move:no-op', context);
        return { ok: true, changed: false, task, before: resolved.record };
      }
      this.notifyChanged([resolved.file.path], 'task-api-move');
      let task: GcmTaskRecord | null = null;
      let refreshError = '';
      try {
        task = await this.get({
          path: resolved.file.path,
          lineNumber: insertedLineNumber,
          rawLine: resolved.record.rawLine,
          title: resolved.record.title,
        });
      } catch (error) {
        refreshError = getErrorMessage(error);
        logger.flowError('TaskApi', 'move:refresh-failed', error, context);
      }
      await this.commitHistoryMutation(historyHandle, {
        ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
        after: {
          path: resolved.file.path,
          lineNumber: insertedLineNumber,
          rawLine: movedRawLine,
        },
        sourceDisposition: 'retained',
        outcome: refreshError ? 'partial' : 'committed',
      });
      logger.flow('TaskApi', 'move:done', { ...context, insertedLineNumber, resolved: !!task });
      return {
        ok: true,
        changed: true,
        task,
        before: resolved.record,
        ...(refreshError ? { error: `Task moved, but the result could not be refreshed: ${refreshError}` } : {}),
      };
    }

    let capturedBlock: string[] = [];
    let capturedLineNumber = resolved.record.lineNumber;
    let capturedRawLine = resolved.record.rawLine;
    try {
      await this.plugin.app.vault.process(resolved.file, (content) => {
        const currentResolution = this.resolveMutableTaskLine(
          content,
          resolved.record.lineNumber,
          resolved.record.rawLine,
          resolved.record.title,
        );
        if (!currentResolution) return content;
        const currentRawLine = currentResolution.parts.lines[currentResolution.index] || '';
        if (strictResolution && !this.moveRefMatchesLine(ref, currentRawLine)) return content;
        const currentBlock = extractTaskBlock(currentResolution.parts.lines, currentResolution.index);
        if (!currentBlock.lines.length) return content;
        capturedBlock = [...currentBlock.lines];
        capturedLineNumber = currentResolution.index;
        capturedRawLine = currentRawLine;
        return content;
      });
    } catch (error) {
      await this.abortHistoryMutation(historyHandle);
      logger.flowError('TaskApi', 'move:source-capture-failed', error, context);
      return { ok: false, changed: false, task: null, before: resolved.record, error: getErrorMessage(error) };
    }
    if (!capturedBlock.length) {
      await this.abortHistoryMutation(historyHandle);
      logger.flowWarn('TaskApi', 'move:source-line-missing', context);
      return {
        ok: false,
        changed: false,
        task: null,
        before: resolved.record,
        error: 'Source task changed before it could be moved.',
      };
    }
    confirmedHistoryBefore = {
      path: resolved.file.path,
      lineNumber: capturedLineNumber,
      rawLine: capturedRawLine,
    };

    let insertedLineNumber = -1;
    let targetBlock = [...capturedBlock];
    let targetBeforeContent: string | null = null;
    let targetExpectedContent: string | null = null;
    try {
      await this.plugin.app.vault.process(targetFile, (content) => {
        targetBeforeContent = content;
        targetBlock = [...capturedBlock];
        targetBlock[0] = this.ensureHistoryIdentity(historyHandle, targetBlock[0] || capturedRawLine);
        if (target.placement !== 'line') {
          const inserted = target.placement === 'after-frontmatter'
            ? insertTaskBlockAfterFrontmatter(content, targetBlock)
            : insertTaskBlockAtEnd(content, targetBlock);
          insertedLineNumber = inserted.lineIndex;
          targetExpectedContent = inserted.content;
          return inserted.content;
        }
        const parts = splitContent(content);
        insertedLineNumber = this.resolveTargetLineIndex(parts.lines, target);
        const nextLines = [...parts.lines];
        nextLines.splice(insertedLineNumber, 0, ...targetBlock);
        targetExpectedContent = joinContent(nextLines, parts.newline, true);
        return targetExpectedContent;
      });
    } catch (error) {
      const targetWriteState = targetBeforeContent != null && targetExpectedContent != null
        ? await this.classifyRejectedWrite(targetFile, targetBeforeContent, targetExpectedContent)
        : 'unchanged';
      logger.flowError('TaskApi', 'move:target-write-failed', error, {
        ...context,
        targetWriteState,
      });
      if (targetWriteState !== 'committed') {
        const changed = targetWriteState === 'conflicted';
        if (changed) this.notifyChanged([targetFile.path], 'task-api-move-partial');
        // A conflicted target is neither the pre-write nor expected snapshot.
        // Its task/locator outcome is unconfirmed, so never fabricate history
        // from the expected target block.
        await this.abortHistoryMutation(historyHandle);
        return {
          ok: false,
          changed,
          task: null,
          before: resolved.record,
          error: changed
            ? `Target write failed and the target changed before its outcome could be reconciled: ${getErrorMessage(error)}`
            : getErrorMessage(error),
        };
      }
      logger.flow('TaskApi', 'move:target-write-reconciled', {
        ...context,
        targetWriteState,
      });
    }
    if (insertedLineNumber < 0 || targetBeforeContent == null || targetExpectedContent == null) {
      await this.abortHistoryMutation(historyHandle);
      return {
        ok: false,
        changed: false,
        task: null,
        before: resolved.record,
        error: 'Task could not be inserted into the target note.',
      };
    }

    let sourcePrepared = false;
    let sourceBeforeContent: string | null = null;
    let sourceExpectedContent: string | null = null;
    let sourceCommitted = false;
    let sourceWriteError: unknown = null;
    let sourceWriteState: RejectedWriteState | null = null;
    try {
      await this.plugin.app.vault.process(resolved.file, (content) => {
        const currentResolution = this.resolveMutableTaskLine(
          content,
          capturedLineNumber,
          capturedRawLine,
          resolved.record.title,
        );
        if (!currentResolution) return content;
        const currentBlock = extractTaskBlock(currentResolution.parts.lines, currentResolution.index);
        if (!this.taskBlocksMatch(currentBlock.lines, capturedBlock)) return content;
        confirmedHistoryBefore = {
          path: resolved.file.path,
          lineNumber: currentResolution.index,
          rawLine: currentResolution.parts.lines[currentResolution.index] || capturedRawLine,
        };

        if (migrateDailySource) {
          const migratedBlock = buildDailyNoteScratchpadMovedTaskBlock(capturedBlock, {
            targetPath: targetFile.path,
            movedAt: new Date(),
          });
          const replaced = replaceTaskBlockInContent(
            content,
            currentResolution.index,
            capturedRawLine,
            resolved.record.title,
            migratedBlock,
          );
          sourcePrepared = replaced.changed;
          if (replaced.changed) {
            sourceBeforeContent = content;
            sourceExpectedContent = replaced.content;
          }
          return replaced.content;
        }

        const removed = removeTaskBlockFromContent(
          content,
          currentResolution.index,
          capturedRawLine,
          resolved.record.title,
        );
        sourcePrepared = removed.changed;
        if (removed.changed) {
          sourceBeforeContent = content;
          sourceExpectedContent = removed.content;
        }
        return removed.content;
      });
      sourceCommitted = sourcePrepared;
    } catch (error) {
      sourceWriteError = error;
      sourceWriteState = sourceBeforeContent != null && sourceExpectedContent != null
        ? await this.classifyRejectedWrite(resolved.file, sourceBeforeContent, sourceExpectedContent)
        : 'unchanged';
      sourceCommitted = sourceWriteState === 'committed';
      if (sourceCommitted) {
        logger.flow('TaskApi', 'move:source-write-reconciled', {
          ...context,
          sourceWriteState,
        });
      }
    }

    if (!sourceCommitted) {
      if (sourceWriteState === 'conflicted') {
        logger.flowWarn('TaskApi', 'move:source-write-conflicted', {
          ...context,
          error: sourceWriteError ? getErrorMessage(sourceWriteError) : '',
        });
        this.notifyChanged([resolved.file.path, targetFile.path], 'task-api-move-partial');
        const confirmedTarget = historyHandle
          ? await this.confirmMovedTargetForHistory(targetFile, targetBlock[0] || capturedRawLine)
          : null;
        if (confirmedTarget) {
          await this.commitHistoryMutation(historyHandle, {
            ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
            after: {
              path: confirmedTarget.path,
              lineNumber: confirmedTarget.lineNumber,
              rawLine: confirmedTarget.rawLine,
            },
            outcome: 'partial',
          });
        } else {
          await this.abortHistoryMutation(historyHandle);
        }
        return {
          ok: false,
          changed: true,
          task: null,
          before: resolved.record,
          error: `Source write failed and the source changed before its outcome could be reconciled; the target copy was preserved to avoid data loss: ${getErrorMessage(sourceWriteError)}`,
        };
      }
      const rolledBackTarget = await this.rollbackTargetSnapshot(
        targetFile,
        targetBeforeContent,
        targetExpectedContent,
      );
      logger.flowWarn('TaskApi', sourceWriteError ? 'move:source-write-failed' : 'move:source-changed', {
        ...context,
        rolledBackTarget,
        sourceWriteState,
        error: sourceWriteError ? getErrorMessage(sourceWriteError) : '',
      });
      if (!rolledBackTarget) this.notifyChanged([targetFile.path], 'task-api-move-partial');
      if (rolledBackTarget) {
        await this.abortHistoryMutation(historyHandle);
      } else {
        const confirmedTarget = historyHandle
          ? await this.confirmMovedTargetForHistory(targetFile, targetBlock[0] || capturedRawLine)
          : null;
        if (confirmedTarget) {
          await this.commitHistoryMutation(historyHandle, {
            ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
            after: {
              path: confirmedTarget.path,
              lineNumber: confirmedTarget.lineNumber,
              rawLine: confirmedTarget.rawLine,
            },
            outcome: 'partial',
          });
        } else {
          await this.abortHistoryMutation(historyHandle);
        }
      }
      return {
        ok: false,
        changed: !rolledBackTarget,
        task: null,
        before: resolved.record,
        error: rolledBackTarget
          ? sourceWriteError
            ? `Source task could not be updated; the target copy was rolled back: ${getErrorMessage(sourceWriteError)}`
            : 'Source task changed before it could be moved; the target copy was rolled back.'
          : 'Source task changed before it could be updated and the target copy could not be rolled back.',
      };
    }

    this.notifyChanged([resolved.file.path, targetFile.path], 'task-api-move');
    let task: GcmTaskRecord | null = null;
    let refreshError = '';
    try {
      task = await this.get({
        path: targetFile.path,
        lineNumber: insertedLineNumber,
        rawLine: targetBlock[0] || resolved.record.rawLine,
        title: resolved.record.title,
      });
    } catch (error) {
      refreshError = getErrorMessage(error);
      logger.flowError('TaskApi', 'move:refresh-failed', error, context);
    }
    const confirmedHistoryTarget = historyHandle
      ? await this.confirmMovedTargetForHistory(targetFile, targetBlock[0] || capturedRawLine)
      : null;
    if (confirmedHistoryTarget) {
      await this.commitHistoryMutation(historyHandle, {
        ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
        after: {
          path: confirmedHistoryTarget.path,
          lineNumber: confirmedHistoryTarget.lineNumber,
          rawLine: confirmedHistoryTarget.rawLine,
        },
        sourceDisposition: migrateDailySource ? 'migrated' : 'removed',
        outcome: 'committed',
      });
    } else {
      await this.abortHistoryMutation(historyHandle);
    }
    logger.flow('TaskApi', 'move:done', {
      ...context,
      insertedLineNumber,
      blockLines: capturedBlock.length,
      resolved: !!task,
    });
    return {
      ok: true,
      changed: true,
      task,
      before: resolved.record,
      ...(refreshError ? { error: `Task moved, but the result could not be refreshed: ${refreshError}` } : {}),
    };
  }

  async delete(ref: GcmTaskRef, cause?: ItemHistoryUserCause): Promise<GcmTaskMutationResult> {
    const resolved = await this.resolveTask(ref);
    if (!resolved) {
      logger.flowWarn('TaskApi', 'delete:target-unresolved', this.summarizeRef(ref));
      return { ok: false, changed: false, task: null, error: 'Task line could not be resolved.' };
    }
    const historyHandle = await this.beginHistoryMutation('task.delete', cause, {
      path: resolved.file.path,
      lineNumber: resolved.record.lineNumber,
      rawLine: resolved.record.rawLine,
    });
    let changed = false;
    let writeCommitted = false;
    let deleteBeforeContent: string | null = null;
    let deleteExpectedContent: string | null = null;
    let confirmedHistoryBefore: TaskHistoryLocator | undefined;
    const context = {
      path: resolved.file.path,
      lineNumber: resolved.record.lineNumber,
      title: resolved.record.title,
    };
    logger.flow('TaskApi', 'delete:start', context);
    try {
      await this.plugin.app.vault.process(resolved.file, (content) => {
        const currentResolution = this.resolveMutableTaskLine(
          content,
          resolved.record.lineNumber,
          resolved.record.rawLine,
          resolved.record.title,
        );
        if (!currentResolution) return content;
        const currentRawLine = currentResolution.parts.lines[currentResolution.index] || '';
        confirmedHistoryBefore = {
          path: resolved.file.path,
          lineNumber: currentResolution.index,
          rawLine: currentRawLine,
        };
        const result = removeTaskBlockFromContent(
          content,
          currentResolution.index,
          resolved.record.rawLine,
          resolved.record.title,
        );
        changed = result.changed;
        if (result.changed) {
          deleteBeforeContent = content;
          deleteExpectedContent = result.content;
        }
        return result.content;
      });
      writeCommitted = changed;
      if (!changed) {
        await this.abortHistoryMutation(historyHandle);
        logger.flowWarn('TaskApi', 'delete:stale-target', context);
        return {
          ok: false,
          changed: false,
          task: null,
          before: resolved.record,
          error: 'Task line changed before it could be deleted.',
        };
      }
      await this.commitHistoryMutation(historyHandle, {
        ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
        sourceDisposition: 'removed',
        outcome: 'committed',
      });
      this.notifyChanged([resolved.file.path], 'task-api-delete');
      logger.flow('TaskApi', 'delete:done', { ...context, changed });
      return { ok: true, changed, task: null, before: resolved.record };
    } catch (error) {
      const writeState = writeCommitted
        ? 'committed'
        : deleteBeforeContent != null && deleteExpectedContent != null
          ? await this.classifyRejectedWrite(resolved.file, deleteBeforeContent, deleteExpectedContent)
          : 'unchanged';
      if (writeState === 'committed') {
        await this.commitHistoryMutation(historyHandle, {
          ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
          sourceDisposition: 'removed',
          outcome: 'partial',
        });
      } else {
        await this.abortHistoryMutation(historyHandle);
      }
      logger.flowError('TaskApi', 'delete:failed', error, context);
      return {
        ok: false,
        changed: writeState !== 'unchanged',
        task: null,
        before: resolved.record,
        error: getErrorMessage(error),
      };
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
    const classification = classifyMappedTaskCheckboxState(
      this.plugin.settings.linkedSubitemCheckboxMappings || [],
      checkbox,
      this.getTaskClassificationOptions(),
    );
    const status = classification.status || '';
    const blockLineCount = Array.isArray(allLines)
      ? Math.max(1, extractTaskBlock(allLines, lineNumber).lines.length)
      : 1;
    const stableId = readInlineFieldValue(rawLine, 'tpsId')
      || readInlineFieldValue(rawLine, 'subitemId')
      || null;
    return {
      type: 'task-line',
      id: `${path}:${lineNumber + 1}`,
      stableId,
      path,
      line: lineNumber + 1,
      lineNumber,
      rawLine,
      title: getTaskDisplayTitle(rawLine),
      checkbox,
      marker,
      status,
      inlineStatus,
      isComplete: classification.isComplete,
      tags: readInlineTags(rawLine),
      fields,
      blockLineCount,
    };
  }

  private resolveMutableTaskLine(
    content: string,
    preferredIndex: number,
    rawLine: string,
    title: string,
  ): { parts: ReturnType<typeof splitContent>; index: number } | null {
    const parts = splitContent(content);
    const index = findCurrentTaskLineIndex(parts.lines, preferredIndex, rawLine, title);
    if (index < 0) return null;
    const documentLine = scanMarkdownDocumentLines(content)[index];
    if (!documentLine?.isContent || documentLine.text !== (parts.lines[index] || '')) return null;
    return { parts, index };
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
    const file = this.resolveMarkdownFile(ref.path);
    if (!file) return null;
    const content = await this.plugin.app.vault.cachedRead(file);
    const documentLines = scanMarkdownDocumentLines(content);
    const lines = documentLines.map((line) => line.text);
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
    if (lineIndex < 0 || !documentLines[lineIndex]?.isContent) return null;
    const record = this.recordFromLine(file.path, lineIndex, lines[lineIndex] || '', lines);
    return record ? { file, record } : null;
  }

  private async readTaskAfterFollowup(
    file: TFile,
    identity: PostFollowupTaskIdentity,
  ): Promise<GcmTaskRecord | null> {
    try {
      const content = await this.plugin.app.vault.read(file);
      const parts = splitContent(content);
      const documentLines = scanMarkdownDocumentLines(content);
      const records = documentLines.reduce<GcmTaskRecord[]>((result, line) => {
        if (!line.isContent) return result;
        const record = this.recordFromLine(file.path, line.index, line.text, parts.lines);
        if (record) result.push(record);
        return result;
      }, []);

      const exactMatches = records.filter((record) => record.rawLine === identity.rawLine);
      if (exactMatches.length > 0) return exactMatches.length === 1 ? exactMatches[0] : null;

      for (const key of ['tpsId', 'subitemId', 'recurrenceTaskId']) {
        const value = readInlineFieldValue(identity.rawLine, key);
        if (!value) continue;
        const identityMatches = records.filter(
          (record) => readInlineFieldValue(record.rawLine, key) === value,
        );
        if (identityMatches.length > 0) return identityMatches.length === 1 ? identityMatches[0] : null;
      }

      const normalizedTitle = normalizeTaskIdentityTitle(identity.title);
      if (!normalizedTitle || identity.marker == null) return null;
      const titleAndMarkerMatches = records.filter(
        (record) => normalizeTaskIdentityTitle(record.title) === normalizedTitle
          && record.marker === identity.marker,
      );
      return titleAndMarkerMatches.length === 1 ? titleAndMarkerMatches[0] : null;
    } catch (error) {
      logger.flowError('TaskApi', 'update:post-followup-read-failed', error, {
        path: file.path,
      });
      return null;
    }
  }

  private applyTaskInputToLine(
    line: string,
    input: GcmTaskUpdateInput | GcmTaskCreateInput,
    options: { create?: boolean; update?: boolean } = {},
    mappingPlan: TaskInputMappingPlan,
  ): string {
    let next = line;
    const workflowFieldOwnership = this.getTaskWorkflowFieldOwnership();
    if (options.create === true && mappingPlan.rawLineMarker) {
      next = setTaskCheckboxWorkflowState(
        next,
        `[${mappingPlan.rawLineMarker}]`,
        workflowFieldOwnership,
      );
    }
    const title = 'title' in input ? input.title : undefined;
    if (typeof title === 'string' && title.trim()) next = setTaskTitle(next, title);

    const marker = mappingPlan.checkboxMarker || mappingPlan.statusMarker || '';
    if (marker) {
      next = setTaskCheckboxWorkflowState(next, `[${marker}]`, workflowFieldOwnership);
      next = updateTaskCompletedDateForCheckboxState(next, `[${marker}]`, {
        completeMarkers: [...mappingPlan.completeMarkers],
      });
    }

    if (input.fields && typeof input.fields === 'object') {
      for (const [key, value] of Object.entries(input.fields)) {
        if (!key.trim()) continue;
        if (isTaskCheckboxOwnedWorkflowFieldKey(key, workflowFieldOwnership)) {
          const status = value == null ? null : String(value).trim();
          if (status) {
            const statusMarker = mappingPlan.fieldStatusMarkers.get(key);
            if (!statusMarker) return line;
            next = setTaskCheckboxWorkflowState(next, `[${statusMarker}]`, workflowFieldOwnership);
            next = updateTaskCompletedDateForCheckboxState(next, `[${statusMarker}]`, {
              completeMarkers: [...mappingPlan.completeMarkers],
            });
          } else {
            next = clearTaskCheckboxOwnedWorkflowFields(next, workflowFieldOwnership);
          }
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
          .map((entry) => this.resolveMarkdownFile(entry))
          .filter((file): file is TFile => file !== null)
      : this.plugin.app.vault.getMarkdownFiles();
    const rawPrefix = String(filter.pathPrefix || '').trim();
    if (!rawPrefix) return files;
    const prefix = normalizePath(rawPrefix);
    return files.filter((file) => file.path.startsWith(prefix));
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

  private normalizeMarker(value: unknown): string {
    const token = normalizeLinkedSubitemCheckboxState(value);
    return token ? token.slice(1, -1) || ' ' : '';
  }

  private preflightTaskInputMappings(
    input: GcmTaskUpdateInput | GcmTaskCreateInput,
    options: { create?: boolean } = {},
  ): TaskInputMappingPreflight {
    const mappings = this.getConfiguredTaskMappings();
    const resolveOwnedMarker = (value: unknown, label: string): { marker: string } | { error: string } => {
      const checkboxState = normalizeLinkedSubitemCheckboxState(value);
      if (!checkboxState) {
        return { error: `${label} must be [ ] or exactly one marker character.` };
      }
      if (!getLinkedSubitemMappingForState(mappings, checkboxState, { normalizedMappings: true })) {
        return { error: `No checkbox mapping is configured for state "${checkboxState}".` };
      }
      return { marker: checkboxState.slice(1, -1) || ' ' };
    };
    const resolveStatusMarker = (value: unknown, label = 'status'): { marker: string } | { error: string } => {
      const status = String(value ?? '').trim();
      if (!status) return { error: `${label} must not be blank.` };
      const checkboxState = mapStatusToSubitemCheckboxState(mappings, status, {
        normalizeStatus: (entry) => this.plugin.sharedServices.status.normalize(entry),
        normalizedMappings: true,
      });
      if (!checkboxState) {
        return { error: `No checkbox mapping is configured for status "${status}".` };
      }
      return { marker: checkboxState.slice(1, -1) || ' ' };
    };

    let checkboxMarker: string | null = null;
    if ('checkbox' in input && input.checkbox != null) {
      const resolved = resolveOwnedMarker(input.checkbox, 'Checkbox state');
      if ('error' in resolved) return { ok: false, error: resolved.error };
      checkboxMarker = resolved.marker;
    }

    let statusMarker: string | null = null;
    if ('status' in input && input.status != null) {
      const resolved = resolveStatusMarker(input.status);
      if ('error' in resolved) return { ok: false, error: resolved.error };
      statusMarker = resolved.marker;
    }

    let rawLineMarker: string | null = null;
    const rawLine = 'rawLine' in input ? String(input.rawLine || '').trim() : '';
    if (rawLine) {
      const parsed = parseTaskLine(rawLine);
      if (!parsed) {
        return { ok: false, error: 'Raw task line must contain one checkbox marker, such as "- [ ] Task".' };
      }
      const resolved = resolveOwnedMarker(parsed.token, 'Raw task checkbox state');
      if ('error' in resolved) return { ok: false, error: resolved.error };
      rawLineMarker = resolved.marker;
    }

    const fieldStatusMarkers = new Map<string, string>();
    const workflowFieldOwnership = this.getTaskWorkflowFieldOwnership();
    const hasWorkflowFieldMutation = Boolean(
      input.fields
      && typeof input.fields === 'object'
      && Object.keys(input.fields).some((key) => (
        isTaskCheckboxOwnedWorkflowFieldKey(key, workflowFieldOwnership)
      )),
    );
    if (input.fields && typeof input.fields === 'object') {
      for (const [key, value] of Object.entries(input.fields)) {
        if (
          !isTaskCheckboxOwnedWorkflowFieldKey(key, workflowFieldOwnership)
          || value == null
          || !String(value).trim()
        ) continue;
        const resolved = resolveStatusMarker(value, `Task field "${key}"`);
        if ('error' in resolved) return { ok: false, error: resolved.error };
        fieldStatusMarkers.set(key, resolved.marker);
      }
    }

    let impliedCreateMarker: string | null = null;
    if (
      options.create === true
      && !rawLine
      && checkboxMarker == null
      && statusMarker == null
      && fieldStatusMarkers.size === 0
    ) {
      const resolved = resolveStatusMarker('todo', 'Default task status');
      if ('error' in resolved) return { ok: false, error: resolved.error };
      impliedCreateMarker = resolved.marker;
    }

    return {
      ok: true,
      plan: {
        checkboxMarker,
        statusMarker,
        rawLineMarker,
        fieldStatusMarkers,
        impliedCreateMarker,
        completeMarkers: Array.from(this.getCompleteMarkers(mappings)),
        mappingSignature: this.getCheckboxMutationSignature(mappings, workflowFieldOwnership),
        mutatesCheckboxWorkflow: options.create === true
          || checkboxMarker != null
          || statusMarker != null
          || hasWorkflowFieldMutation,
      },
    };
  }

  private getConfiguredTaskMappings() {
    return normalizeLinkedSubitemMappings(
      this.plugin.settings.linkedSubitemCheckboxMappings,
      {
        enforceStrictDefaults: false,
        normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value),
      },
    );
  }

  private getTaskWorkflowFieldOwnership(): TaskCheckboxWorkflowFieldOwnership {
    const relationalProperty = findRelationalStatusProperty(this.plugin.settings.properties);
    const configuredWorkflowProperty = (this.plugin.settings.properties || []).find((property) => {
      if (property === relationalProperty) return false;
      const id = String(property?.id || '').trim().toLowerCase();
      const key = String(property?.key || '').trim().toLowerCase();
      return id === 'status' || key === 'status';
    });
    const statusService = this.plugin.sharedServices?.status;
    return {
      workflowStatusKey: statusService?.getStatusPropertyKey?.()
        || configuredWorkflowProperty?.key
        || (relationalProperty ? 'taskStatus' : 'status'),
      relationalStatusKey: statusService?.getRelationalStatusPropertyKey?.()
        || relationalProperty?.key,
    };
  }

  private getCheckboxMutationSignature(
    mappings = this.getConfiguredTaskMappings(),
    ownership = this.getTaskWorkflowFieldOwnership(),
  ): string {
    return getTaskCheckboxWorkflowMutationSignature(
      mappings,
      ownership,
      Array.from(this.getCompleteMarkers(mappings)),
    );
  }

  private mappingPlanIsCurrent(
    plan: TaskInputMappingPlan,
    mappings = this.getConfiguredTaskMappings(),
  ): boolean {
    return plan.mappingSignature === this.getCheckboxMutationSignature(mappings);
  }

  private getCompleteMarkers(mappings = this.getConfiguredTaskMappings()): Set<string> {
    const statusService = this.plugin.sharedServices.status;
    return new Set(getLinkedSubitemCompleteMarkers(
      mappings,
      {
        completionStatuses: statusService.getDoneStatuses(),
        normalizeStatus: (value) => statusService.normalize(value),
      },
    ));
  }

  private getTaskClassificationOptions() {
    const statusService = this.plugin.sharedServices.status;
    return {
      completionStatuses: statusService.getDoneStatuses(),
      normalizeStatus: (value: unknown) => statusService.normalize(value),
    };
  }

  private resolveTargetLineIndex(lines: string[], target: GcmTaskMoveTarget): number {
    const lineCount = lines.length;
    if (target.placement === 'after-frontmatter') {
      return findAfterFrontmatterIndex(lines);
    }
    const raw = typeof target.lineNumber === 'number'
      ? target.lineNumber
      : typeof target.line === 'number'
        ? target.line - 1
        : lineCount;
    return Math.min(Math.max(0, Math.floor(raw)), lineCount);
  }

  private moveRefMatchesLine(ref: GcmTaskRef, rawLine: string): boolean {
    const expectedRawLine = String(ref.rawLine || '');
    if (expectedRawLine && rawLine === expectedRawLine) return true;
    for (const key of ['tpsId', 'subitemId']) {
      const expectedIdentity = readInlineFieldValue(expectedRawLine, key);
      if (expectedIdentity && readInlineFieldValue(rawLine, key) === expectedIdentity) return true;
    }
    return false;
  }

  private taskBlocksMatch(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((line, index) => line === right[index]);
  }

  private async classifyRejectedWrite(
    file: TFile,
    beforeContent: string,
    expectedContent: string,
  ): Promise<RejectedWriteState> {
    try {
      const currentContent = await this.plugin.app.vault.read(file);
      if (currentContent === beforeContent) return 'unchanged';
      if (currentContent === expectedContent) return 'committed';
      return 'conflicted';
    } catch (error) {
      logger.flowError('TaskApi', 'move:write-reconciliation-failed', error, {
        path: file.path,
      });
      return 'conflicted';
    }
  }

  private async rollbackTargetSnapshot(
    targetFile: TFile,
    beforeContent: string,
    expectedContent: string,
  ): Promise<boolean> {
    try {
      await this.plugin.app.vault.process(targetFile, (content) =>
        content === expectedContent ? beforeContent : content);
    } catch (error) {
      logger.flowError('TaskApi', 'move:rollback-failed', error, {
        targetPath: targetFile.path,
      });
    }
    try {
      return await this.plugin.app.vault.read(targetFile) === beforeContent;
    } catch (error) {
      logger.flowError('TaskApi', 'move:rollback-verification-failed', error, {
        targetPath: targetFile.path,
      });
      return false;
    }
  }

  private async confirmMovedTargetForHistory(
    targetFile: TFile,
    expectedRawLine: string,
  ): Promise<GcmTaskRecord | null> {
    const expectedIdentity = getTaskHistoryIdentity(expectedRawLine);
    if (!expectedIdentity) return null;
    try {
      const content = await this.plugin.app.vault.read(targetFile);
      const documentLines = scanMarkdownDocumentLines(content);
      const lines = documentLines.map((line) => line.text);
      const matches: GcmTaskRecord[] = [];
      for (const line of documentLines) {
        if (
          !line.isContent
          || line.text !== expectedRawLine
          || getTaskHistoryIdentity(line.text) !== expectedIdentity
        ) continue;
        try {
          // Reject a line that presents the expected primary identity alongside
          // a different secondary identity. The returned injection is ignored:
          // confirmation is read-only and requires a live identity above.
          ensureTaskHistoryIdentity(line.text, expectedIdentity);
        } catch {
          continue;
        }
        const record = this.recordFromLine(targetFile.path, line.index, line.text, lines);
        if (record) matches.push(record);
      }
      return matches.length === 1 ? matches[0] : null;
    } catch (error) {
      logger.flowError('TaskApi', 'move:history-target-confirmation-failed', error, {
        targetPath: targetFile.path,
      });
      return null;
    }
  }

  private async beginHistoryMutation(
    action: TaskHistoryAction,
    cause: ItemHistoryUserCause | undefined,
    before: TaskHistoryLocator,
    targetPath?: string,
  ): Promise<TaskHistoryHandle> {
    if (!cause || cause.kind !== 'user') return null;
    try {
      return await this.plugin.itemHistoryService?.beginTaskMutation({
        action,
        cause,
        before,
        ...(targetPath ? { targetPath } : {}),
      }) ?? null;
    } catch (error) {
      logger.flowError('TaskApi', 'history:begin-failed', error, {
        action,
        path: before.path,
        lineNumber: before.lineNumber,
      });
      return null;
    }
  }

  private ensureHistoryIdentity(handle: TaskHistoryHandle, line: string): string {
    if (!handle) return line;
    try {
      const ensured = this.plugin.itemHistoryService.ensureTaskIdentity(handle, line);
      if (typeof ensured === 'string') return ensured;
      this.historyIdentityFailures.add(handle);
      return line;
    } catch (error) {
      this.historyIdentityFailures.add(handle);
      logger.flowError('TaskApi', 'history:identity-failed', error, {});
      return line;
    }
  }

  private async commitHistoryMutation(handle: TaskHistoryHandle, result: TaskHistoryCommit): Promise<void> {
    if (!handle) return;
    if (this.historyIdentityFailures.has(handle)) {
      this.historyIdentityFailures.delete(handle);
      await this.abortHistoryMutation(handle);
      return;
    }
    try {
      await this.plugin.itemHistoryService.commitTaskMutation(handle, result);
    } catch (error) {
      logger.flowError('TaskApi', 'history:commit-failed', error, {});
      await this.abortHistoryMutation(handle);
    }
  }

  private async abortHistoryMutation(handle: TaskHistoryHandle): Promise<void> {
    if (!handle) return;
    this.historyIdentityFailures.delete(handle);
    try {
      await this.plugin.itemHistoryService.abortTaskMutation(handle);
    } catch (error) {
      logger.flowError('TaskApi', 'history:abort-failed', error, {});
    }
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
    const file = this.resolveMarkdownFile(task.path);
    if (!file) return;
    await this.plugin.openFileInLeaf(file, false, () => this.plugin.app.workspace.getLeaf(false), { revealLeaf: true });
    const leaf = this.plugin.findOpenLeafForFile(file);
    const editor = (leaf?.view as any)?.editor;
    if (!editor) return;
    editor.setCursor?.({ line: task.lineNumber, ch: 0 });
    editor.scrollIntoView?.({ from: { line: task.lineNumber, ch: 0 }, to: { line: task.lineNumber, ch: 0 } }, true);
    editor.focus?.();
  }

  /**
   * Canonicalize public API file inputs through this plugin's vault. Obsidian can
   * expose file objects from a different JavaScript realm, where constructor
   * identity is not stable even though the vault path is valid.
   */
  private resolveMarkdownFile(value: unknown): TFile | null {
    const rawPath = getFilePath(value);
    if (!rawPath) return null;
    const file = this.plugin.app.vault.getFileByPath(normalizePath(rawPath));
    return isMarkdownFileLike(file) ? file : null;
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

function getFilePath(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object') return null;
  const path = (value as { path?: unknown }).path;
  return typeof path === 'string' ? path.trim() || null : null;
}

function isMarkdownFileLike(value: unknown): value is TFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as { path?: unknown; extension?: unknown };
  return typeof file.path === 'string'
    && typeof file.extension === 'string'
    && file.extension.toLowerCase() === 'md';
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

function normalizeTaskIdentityTitle(value: string): string {
  return String(value || '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}
