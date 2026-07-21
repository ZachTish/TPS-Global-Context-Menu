import { MarkdownView, Notice, TFile, normalizePath, parseYaml } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { deleteValueCaseInsensitive, findKeyCaseInsensitive, setValueCaseInsensitive } from '../core';
import {
  getTaskDisplayTitle,
  parseTaskLine,
  readInlineFieldValue,
  insertLineAfterFrontmatter,
  setInlineFieldValueOnTaskLine,
  updateTaskLineTimestamps,
} from '../utils/task-line-metadata';
import { findCurrentTaskLineIndex } from '../utils/task-block-move';
import {
  normalizeTimeTrackingRecord,
  normalizeTimeTrackingRecordList,
  resolveTimeTrackingStorageKind,
  timeTrackingSessionOverlapsRange,
  type TimeTrackingSessionRecord,
  type TimeTrackingStorageMode,
  type TimeTrackingTargetType,
} from './time-tracking-format';
import type { TimeTrackingPausedSessionState } from '../types';
import * as logger from '../logger';

export type {
  TimeTrackingSessionRecord,
  TimeTrackingStorageMode,
  TimeTrackingTargetType,
} from './time-tracking-format';

export interface TimeTrackingTargetInput {
  file?: TFile;
  filePath?: string;
  lineNumber?: number;
  rawLine?: string;
  type?: TimeTrackingTargetType;
  title?: string;
}

export interface TimeTrackingRangeInput {
  start?: Date | string | number | null;
  end?: Date | string | number | null;
}

export interface TimeTrackingSession extends TimeTrackingSessionRecord {
  title: string;
  isActive: boolean;
  storageMode: 'frontmatter';
  storagePath: string;
  storageLineNumber?: number;
  targetPath: string;
  targetLineNumber?: number;
}

export interface TimeTrackingRuntimeStatus {
  active: TimeTrackingSession | null;
  paused: TimeTrackingPausedSessionState | null;
}

interface ResolvedTimeTrackingTarget {
  file: TFile;
  type: TimeTrackingTargetType;
  lineNumber?: number;
  title: string;
  tpsId: string;
}

interface TimeTrackingTargetReference {
  file: TFile;
  type: TimeTrackingTargetType;
  lineNumber?: number;
  rawLine?: string;
  title: string;
}

interface StoredSession {
  record: TimeTrackingSessionRecord;
  storageMode: 'frontmatter';
  storageFile: TFile;
  storageLineNumber?: number;
}

const TPS_ID_FIELD = 'tpsId';
const RUNNING_SCHEDULE_AHEAD_MINUTES = 5;
const RUNNING_SCHEDULE_SYNC_INTERVAL_MS = 60_000;

export class TimeTrackingService {
  private activeTimerCountsByPath = new Map<string, number>();

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  setup(): void {
    this.plugin.registerInterval(window.setInterval(() => {
      void this.syncRunningScheduledMetadata();
    }, RUNNING_SCHEDULE_SYNC_INTERVAL_MS));
    this.plugin.app.workspace.onLayoutReady(() => {
      window.setTimeout(() => void this.syncRunningScheduledMetadata(), 2000);
      window.setTimeout(() => void this.refreshActiveTimerCache(), 2000);
    });
  }

  isEnabled(): boolean {
    return this.plugin.settings.enableTimeTracking !== false;
  }

  getPropertyKey(): string {
    const key = String(this.plugin.settings.timeTrackingPropertyKey || 'timeTracking').trim() || 'timeTracking';
    return key.toLowerCase() === 'scheduled' ? 'timeTracking' : key;
  }

  getStorageMode(): TimeTrackingStorageMode {
    const mode = this.plugin.settings.timeTrackingStorageMode;
    return mode === 'source-note' || mode === 'dedicated-note' || mode === 'daily-note'
      ? mode
      : 'daily-note';
  }

  async startTimer(input?: TimeTrackingTargetInput): Promise<TimeTrackingSession | null> {
    if (!this.ensureEnabled()) return null;

    const target = await this.resolveAndEnsureTarget(input);
    if (!target) return null;

    const active = this.plugin.settings.timeTrackingSingleActiveSession === false
      ? null
      : await this.getActiveSession();
    if (active) {
      const shouldStartAdditional = confirm(
        `A timer is already running for "${active.title}". Start another running timer?`,
      );
      if (!shouldStartAdditional) return active;
    }

    const now = new Date();
    const timestamp = this.formatDateTime(now);
    const record: TimeTrackingSessionRecord = {
      id: this.createId('tt'),
      targetId: target.tpsId,
      targetType: target.type,
      sourcePath: target.file.path,
      lineNumber: target.lineNumber,
      start: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const storageFile = await this.resolveStorageFileForNewSession(target, now);
    await this.writeNewSession(target, record, storageFile);
    const resolvedTarget = await this.resolveTargetForRecord(record, { storageFile });
    await this.syncTargetScheduledMetadata(resolvedTarget ?? target, record, { mode: 'running' });
    await this.clearPausedTimer({ silent: true });
    await this.refreshActiveTimerCache();
    this.refreshStatusBar();
    this.refreshFileUi((resolvedTarget ?? target).file);
    new Notice(`Started timer: ${target.title}`);
    const storageMode = this.resolveSessionStorageKind(target);
    return this.hydrateStoredSession({
      record,
      storageMode,
      storageFile,
    });
  }

  async startBlankDailyTaskTimer(): Promise<TimeTrackingSession | null> {
    return this.startDailyTaskTimer('Untitled timer');
  }

  async promptStartDailyTaskTimer(defaultTitle?: string): Promise<TimeTrackingSession | null> {
    return this.promptStartTaskTimerForNote(null, 'daily-note', defaultTitle);
  }

  async startDailyTaskTimer(title: string): Promise<TimeTrackingSession | null> {
    return this.startTaskTimerForNote(title, null, 'daily-note');
  }

  async promptStartTaskTimerForNote(
    noteFile: TFile | null | undefined,
    target: 'daily-note' | 'source-note',
    defaultTitle?: string,
  ): Promise<TimeTrackingSession | null> {
    if (!this.ensureEnabled()) return null;
    const fallbackTitle = String(defaultTitle || (noteFile ? this.getNoteTitle(noteFile) : this.getActiveNoteTitle()) || 'Tracked work').trim() || 'Tracked work';
    const title = window.prompt('Task to track', fallbackTitle);
    if (title == null) return null;
    return this.startTaskTimerForNote(title, noteFile, target);
  }

  async startTaskTimerForNote(
    title: string,
    noteFile: TFile | null | undefined,
    target: 'daily-note' | 'source-note',
  ): Promise<TimeTrackingSession | null> {
    if (!this.ensureEnabled()) return null;

    const now = new Date();
    const targetFile = target === 'source-note' && noteFile instanceof TFile
      ? noteFile
      : await this.ensureMarkdownFile(this.getDailyNotePath(now), this.getDailyNoteTitle(now));
    const tpsId = this.createId('task');
    const taskTitle = String(title || '').replace(/\s+/g, ' ').trim() || 'Untitled timer';
    const lineNumber = await this.insertTimerTask(targetFile, tpsId, taskTitle);
    const rawLine = (await this.plugin.app.vault.cachedRead(targetFile).catch(() => ''))
      .split(/\r?\n/)[lineNumber] || '';
    return this.startTimer({
      file: targetFile,
      type: 'task',
      lineNumber,
      rawLine,
      title: taskTitle,
    });
  }

  async stopActiveTimer(endInput?: Date | string | number | null): Promise<TimeTrackingSession | null> {
    if (!this.ensureEnabled()) return null;

    const active = await this.getActiveStoredSession();
    if (!active) {
      const clearedPaused = await this.clearPausedTimer({ silent: false });
      if (clearedPaused) return null;
      new Notice('No active time tracking timer.');
      return null;
    }

    const end = this.normalizeDateInput(endInput) ?? new Date();
    let updated = this.withUpdatedTimes(active.record, active.record.start, this.formatDateTime(end));
    const target = await this.resolveTargetForRecord(updated, active);
    updated = this.withResolvedLineNumber(updated, target);
    await this.replaceStoredSession(active, updated);

    const hydrated = await this.hydrateStoredSession({ ...active, record: updated });
    if (target?.file instanceof TFile) {
      await this.syncTargetScheduledMetadata(target, updated, { mode: 'stopped', end });
      this.refreshFileUi(target.file);
    }
    await this.clearPausedTimer({ silent: true });
    await this.refreshActiveTimerCache();
    this.refreshStatusBar();
    new Notice(`Stopped timer: ${hydrated.title}`);
    return hydrated;
  }

  async stopActiveTimerForFile(file: TFile, endInput?: Date | string | number | null): Promise<TimeTrackingSession | null> {
    if (!this.ensureEnabled()) return null;

    const active = await this.getActiveStoredSessionForFile(file);
    if (!active) {
      new Notice(`No active timer for ${file.basename}.`);
      await this.refreshActiveTimerCache();
      return null;
    }

    const end = this.normalizeDateInput(endInput) ?? new Date();
    let updated = this.withUpdatedTimes(active.record, active.record.start, this.formatDateTime(end));
    const target = await this.resolveTargetForRecord(updated, active);
    updated = this.withResolvedLineNumber(updated, target);
    await this.replaceStoredSession(active, updated);

    const hydrated = await this.hydrateStoredSession({ ...active, record: updated });
    if (target?.file instanceof TFile) {
      await this.syncTargetScheduledMetadata(target, updated, { mode: 'stopped', end });
      this.refreshFileUi(target.file);
    }
    await this.refreshActiveTimerCache();
    this.refreshStatusBar();
    new Notice(`Stopped timer: ${hydrated.title}`);
    return hydrated;
  }

  async pauseActiveTimer(endInput?: Date | string | number | null): Promise<TimeTrackingSession | null> {
    if (!this.ensureEnabled()) return null;

    const active = await this.getActiveStoredSession();
    if (!active) {
      new Notice('No active time tracking timer to pause.');
      return null;
    }

    const end = this.normalizeDateInput(endInput) ?? new Date();
    let updated = this.withUpdatedTimes(active.record, active.record.start, this.formatDateTime(end));
    const target = await this.resolveTargetForRecord(updated, active);
    updated = this.withResolvedLineNumber(updated, target);
    await this.replaceStoredSession(active, updated);
    const hydrated = await this.hydrateStoredSession({ ...active, record: updated });
    if (target?.file instanceof TFile) {
      await this.syncTargetScheduledMetadata(target, updated, { mode: 'stopped', end });
      this.refreshFileUi(target.file);
    }

    this.plugin.settings.timeTrackingPausedSession = {
      targetId: hydrated.targetId,
      targetType: hydrated.targetType,
      sourcePath: hydrated.targetPath || hydrated.sourcePath,
      lineNumber: hydrated.targetLineNumber ?? hydrated.lineNumber,
      title: hydrated.title,
      pausedAt: this.formatDateTime(end),
      elapsedMs: Math.max(0, end.getTime() - (this.normalizeDateInput(active.record.start)?.getTime() ?? end.getTime())),
      lastSessionId: hydrated.id,
    };
    await this.persistTimeTrackingState();
    await this.refreshActiveTimerCache();
    this.refreshStatusBar();

    new Notice(`Paused timer: ${hydrated.title}`);
    return hydrated;
  }

  async resumePausedTimer(): Promise<TimeTrackingSession | null> {
    if (!this.ensureEnabled()) return null;

    const paused = this.getPausedTimer();
    if (!paused) {
      new Notice('No paused time tracking timer.');
      return null;
    }

    const target = await this.resolveTargetForPausedState(paused);
    if (!target) {
      new Notice('Could not find the paused timer target.');
      return null;
    }

    const started = await this.startTimer({
      file: target.file,
      lineNumber: target.lineNumber,
      rawLine: target.rawLine,
      type: paused.targetType,
      title: target.title || paused.title,
    });
    if (started) {
      await this.clearPausedTimer({ silent: true });
    }
    return started;
  }

  async clearPausedTimer(options?: { silent?: boolean }): Promise<boolean> {
    const paused = this.getPausedTimer();
    if (!paused) return false;
    this.plugin.settings.timeTrackingPausedSession = null;
    await this.persistTimeTrackingState();
    this.refreshStatusBar();
    if (!options?.silent) {
      new Notice(`Stopped paused timer: ${paused.title || 'Tracked time'}`);
    }
    return true;
  }

  async addManualSession(
    input: TimeTrackingTargetInput | undefined,
    startInput: Date | string | number,
    endInput: Date | string | number,
  ): Promise<TimeTrackingSession | null> {
    if (!this.ensureEnabled()) return null;

    const target = await this.resolveAndEnsureTarget(input);
    if (!target) {
      logger.warn('[TimeTracking] Manual session skipped because target could not be resolved.', {
        filePath: input?.filePath || input?.file?.path || null,
        type: input?.type || null,
        title: input?.title || null,
      });
      return null;
    }

    const start = this.normalizeDateInput(startInput);
    const end = this.normalizeDateInput(endInput);
    if (!start || !end || end.getTime() <= start.getTime()) {
      new Notice('Time tracking session needs a valid start and end.');
      return null;
    }

    const now = this.formatDateTime(new Date());
    const record = this.withUpdatedTimes({
      id: this.createId('tt'),
      targetId: target.tpsId,
      targetType: target.type,
      sourcePath: target.file.path,
      lineNumber: target.lineNumber,
      start: this.formatDateTime(start),
      createdAt: now,
      updatedAt: now,
    }, start, end);

    const storageFile = await this.resolveStorageFileForNewSession(target, start);
    const storageMode = this.resolveSessionStorageKind(target);
    logger.log('[TimeTracking] Writing manual session.', {
      id: record.id,
      targetPath: target.file.path,
      targetType: target.type,
      storagePath: storageFile.path,
      storageMode,
      start: record.start,
      end: record.end,
    });
    await this.writeNewSession(target, record, storageFile);
    const resolvedTarget = await this.resolveTargetForRecord(record, { storageFile });
    if (resolvedTarget?.file instanceof TFile) {
      await this.syncTargetScheduledMetadata(resolvedTarget, record, { mode: 'stopped', end });
      this.refreshFileUi(resolvedTarget.file);
    }
    const hydrated = await this.hydrateStoredSession({
      record,
      storageMode,
      storageFile,
    });
    new Notice(`Added time session: ${hydrated.title}`);
    return hydrated;
  }

  async listSessions(range?: TimeTrackingRangeInput): Promise<TimeTrackingSession[]> {
    if (!this.isEnabled()) return [];

    const rangeStart = this.normalizeDateInput(range?.start ?? null)?.getTime() ?? null;
    const rangeEnd = this.normalizeDateInput(range?.end ?? null)?.getTime() ?? null;
    const stored = await this.scanStoredSessions();
    const hydrated: TimeTrackingSession[] = [];

    for (const item of stored) {
      if (!this.sessionOverlapsRange(item.record, rangeStart, rangeEnd)) continue;
      hydrated.push(await this.hydrateStoredSession(item));
    }

    return hydrated.sort((a, b) => {
      const startDelta = (this.normalizeDateInput(a.start)?.getTime() ?? 0) - (this.normalizeDateInput(b.start)?.getTime() ?? 0);
      if (startDelta !== 0) return startDelta;
      return a.id.localeCompare(b.id);
    });
  }

  async updateSessionTimes(
    id: string,
    startInput: Date | string | number,
    endInput?: Date | string | number | null,
  ): Promise<TimeTrackingSession | null> {
    if (!this.ensureEnabled()) return null;

    const stored = await this.findStoredSession(id);
    if (!stored) {
      new Notice('Time tracking session not found.');
      return null;
    }

    const start = this.normalizeDateInput(startInput);
    const end = this.normalizeDateInput(endInput ?? null);
    if (!start) {
      new Notice('Time tracking session needs a valid start.');
      return null;
    }
    if (end && end.getTime() <= start.getTime()) {
      new Notice('Time tracking session end must be after start.');
      return null;
    }

    const updated = this.withUpdatedTimes(stored.record, start, end);
    await this.replaceStoredSession(stored, updated);
    return this.hydrateStoredSession({ ...stored, record: updated });
  }

  async deleteSession(id: string): Promise<boolean> {
    if (!this.ensureEnabled()) return false;

    const stored = await this.findStoredSession(id);
    if (!stored) {
      new Notice('Time tracking session not found.');
      return false;
    }

    await this.removeStoredSession(stored);
    new Notice('Deleted time tracking session.');
    return true;
  }

  async openSessionTarget(id: string): Promise<boolean> {
    const stored = await this.findStoredSession(id);
    if (!stored) return false;

    const resolved = await this.resolveTargetForRecord(stored.record, stored);
    if (!resolved) return false;

    return this.openResolvedTarget(resolved);
  }

  async openHydratedSessionTarget(session: TimeTrackingSession): Promise<boolean> {
    const file = this.resolveFile(session.targetPath) ?? this.resolveFile(session.sourcePath);
    if (file) {
      return this.openResolvedTarget({
        file,
        lineNumber: session.targetLineNumber ?? session.lineNumber,
      });
    }
    return this.openSessionTarget(session.id);
  }

  async openPausedTimerTarget(): Promise<boolean> {
    const paused = this.getPausedTimer();
    if (!paused) return false;
    const resolved = await this.resolveTargetForPausedState(paused);
    if (!resolved) return false;
    return this.openResolvedTarget(resolved);
  }

  async getActiveTimer(): Promise<TimeTrackingSession | null> {
    if (!this.isEnabled()) return null;
    return this.getActiveSession();
  }

  async getActiveTimers(): Promise<TimeTrackingSession[]> {
    if (!this.isEnabled()) return [];
    const active = (await this.scanStoredSessions()).filter((session) => !session.record.end);
    const output: TimeTrackingSession[] = [];
    for (const item of active) {
      if (await this.shouldIgnoreStoredSession(item)) continue;
      output.push(await this.hydrateStoredSession(item));
    }
    return output.sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
  }

  async getActiveTimersForFile(file: TFile): Promise<TimeTrackingSession[]> {
    if (!this.isEnabled()) return [];
    const stored = await this.scanStoredSessions();
    const active = stored.filter((session) => !session.record.end);
    const output: TimeTrackingSession[] = [];
    for (const item of active) {
      if (await this.shouldIgnoreStoredSession(item)) continue;
      const hydrated = await this.hydrateStoredSession(item);
      if (hydrated.targetPath === file.path || hydrated.sourcePath === file.path) {
        output.push(hydrated);
      }
    }
    return output.sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
  }

  getActiveTimerCountForFileSync(file: TFile): number {
    return this.activeTimerCountsByPath.get(file.path) ?? 0;
  }

  getElapsedMsForSession(session: Pick<TimeTrackingSessionRecord, 'start'>): number {
    const start = this.normalizeDateInput(session.start);
    if (!start) return 0;
    return Math.max(0, Date.now() - start.getTime());
  }

  formatElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  getPausedTimer(): TimeTrackingPausedSessionState | null {
    if (!this.isEnabled()) return null;
    return this.normalizePausedState(this.plugin.settings.timeTrackingPausedSession);
  }

  async getRuntimeStatus(): Promise<TimeTrackingRuntimeStatus> {
    if (!this.isEnabled()) return { active: null, paused: null };
    return {
      active: await this.getActiveSession(),
      paused: this.getPausedTimer(),
    };
  }

  async resolveActiveTarget(): Promise<ResolvedTimeTrackingTarget | null> {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file ?? this.plugin.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') return null;
    const editor = view?.editor;
    if (editor && typeof editor.getCursor === 'function' && typeof editor.getLine === 'function') {
      const lineNumber = editor.getCursor().line;
      const rawLine = editor.getLine(lineNumber);
      if (parseTaskLine(rawLine)) {
        return this.resolveAndEnsureTarget({
          file,
          type: 'task',
          lineNumber,
          rawLine,
          title: getTaskDisplayTitle(rawLine) || file.basename,
        });
      }
    }
    return this.resolveAndEnsureTarget({ file, type: 'note' });
  }

  async promptAddManualSession(input?: TimeTrackingTargetInput): Promise<TimeTrackingSession | null> {
    const now = new Date();
    const startDefault = new Date(now.getTime() - 30 * 60 * 1000);
    const startRaw = window.prompt('Start time', this.formatDateTime(startDefault));
    if (startRaw == null) return null;
    const endRaw = window.prompt('End time', this.formatDateTime(now));
    if (endRaw == null) return null;
    return this.addManualSession(input, startRaw, endRaw);
  }

  async syncRunningScheduledMetadata(): Promise<void> {
    if (!this.isEnabled()) return;
    const active = (await this.scanStoredSessions()).filter((session) => !session.record.end);
    await this.refreshActiveTimerCache(active);
    const syncedFiles = new Set<string>();
    for (const stored of active) {
      if (await this.shouldIgnoreStoredSession(stored)) continue;
      const target = await this.resolveTargetForRecord(stored.record, stored);
      if (!(target?.file instanceof TFile)) continue;
      await this.syncTargetScheduledMetadata(target, stored.record, { mode: 'running' });
      syncedFiles.add(target.file.path);
    }
    for (const path of syncedFiles) {
      const file = this.resolveFile(path);
      if (file) this.refreshFileUi(file);
    }
    if (syncedFiles.size > 0) this.refreshStatusBar();
  }

  private ensureEnabled(): boolean {
    if (this.isEnabled()) return true;
    new Notice('Time tracking is disabled in TPS Global Context Menu settings.');
    return false;
  }

  private async persistTimeTrackingState(): Promise<void> {
    await this.plugin.persistRuntimeSettingsState();
  }

  private refreshStatusBar(): void {
    this.plugin.timeTrackingStatusBarService?.refresh();
  }

  private refreshFileUi(file: TFile): void {
    this.plugin.eventService.emitFilesUpdated([file.path]);
  }

  private async syncTargetScheduledMetadata(
    target: TFile | TimeTrackingTargetReference,
    record: TimeTrackingSessionRecord,
    options: { mode: 'running' | 'stopped'; end?: Date },
  ): Promise<void> {
    const start = this.normalizeDateInput(record.start);
    if (!start) return;

    const end = options.mode === 'stopped'
      ? options.end ?? this.normalizeDateInput(record.end) ?? new Date()
      : this.getRunningProjectedEnd(start);
    const durationRawMinutes = (end.getTime() - start.getTime()) / 60_000;
    const durationMinutes = Math.max(
      1,
      options.mode === 'running'
        ? Math.ceil(durationRawMinutes)
        : Math.round(durationRawMinutes),
    );
    const scheduledValue = this.formatDateTime(start);
    const endValue = this.formatDateTime(end);
    const file = target instanceof TFile ? target : target.file;

    if (record.targetType === 'task') {
      if (!(target instanceof TFile) && target.type === 'task' && typeof target.lineNumber === 'number') {
        await this.syncTaskLineScheduledMetadata(file, target.lineNumber, record.targetId, scheduledValue, durationMinutes, endValue);
      } else {
        logger.warn('[TimeTracking] Skipped task schedule sync because the task line could not be resolved.', {
          id: record.id,
          targetId: record.targetId,
          sourcePath: record.sourcePath,
          lineNumber: record.lineNumber,
        });
      }
      return;
    }

    await this.plugin.frontmatterMutationService.process(file, (frontmatter) => {
      if (isProcessRunFrontmatter(frontmatter)) {
        deleteValueCaseInsensitive(frontmatter, 'scheduled');
      } else {
        setValueCaseInsensitive(frontmatter, 'scheduled', scheduledValue);
      }
      setValueCaseInsensitive(frontmatter, 'timeEstimate', durationMinutes);

      const endKey =
        findKeyCaseInsensitive(frontmatter, 'end')
        || findKeyCaseInsensitive(frontmatter, 'endDate')
        || findKeyCaseInsensitive(frontmatter, 'ends');
      if (endKey) {
        setValueCaseInsensitive(frontmatter, endKey, endValue);
      }
    });
  }

  private async syncTaskLineScheduledMetadata(
    file: TFile,
    lineNumber: number,
    targetId: string,
    scheduledValue: string,
    durationMinutes: number,
    endValue: string,
  ): Promise<void> {
    await this.plugin.app.vault.process(file, (content) => {
      const newline = content.includes('\r\n') ? '\r\n' : '\n';
      const endsWithNewline = /\r?\n$/.test(content);
      const lines = content.split(/\r?\n/);
      if (endsWithNewline) lines.pop();
      const resolvedLineNumber = this.findTaskLineIndex(lines, lineNumber, targetId);
      if (resolvedLineNumber < 0) return content;
      const line = lines[resolvedLineNumber] || '';
      if (!parseTaskLine(line)) return content;
      let next = setInlineFieldValueOnTaskLine(line, 'scheduled', scheduledValue);
      next = setInlineFieldValueOnTaskLine(next, 'timeEstimate', String(durationMinutes));
      if (readInlineFieldValue(next, 'end')) {
        next = setInlineFieldValueOnTaskLine(next, 'end', endValue);
      }
      next = updateTaskLineTimestamps(next, {
        enabled: this.plugin.settings.autoSyncFileTimestamps === true,
        modifiedKey: this.plugin.settings.dateModifiedFrontmatterKey,
        format: this.plugin.settings.fileTimestampFormat,
        markModified: true,
      });
      lines[resolvedLineNumber] = next;
      return `${lines.join(newline)}${endsWithNewline ? newline : ''}`;
    });
  }

  private async insertTimerTask(file: TFile, tpsId: string, title: string): Promise<number> {
    const safeTitle = String(title || '').replace(/\s+/g, ' ').trim() || 'Untitled timer';
    const taskLine = updateTaskLineTimestamps(`- [ ] ${safeTitle} [${TPS_ID_FIELD}:: ${tpsId}]`, {
      enabled: this.plugin.settings.autoSyncFileTimestamps === true,
      createdKey: this.plugin.settings.dateCreatedFrontmatterKey,
      modifiedKey: this.plugin.settings.dateModifiedFrontmatterKey,
      format: this.plugin.settings.fileTimestampFormat,
      markCreated: true,
      markModified: true,
    });
    let insertedLineNumber = -1;
    await this.plugin.app.vault.process(file, (content) => {
      const nextContent = insertLineAfterFrontmatter(content, taskLine);
      const lines = nextContent.split(/\r?\n/);
      insertedLineNumber = lines.findIndex((line) => readInlineFieldValue(line, TPS_ID_FIELD) === tpsId);
      return nextContent;
    });
    if (insertedLineNumber < 0) {
      const content = await this.plugin.app.vault.cachedRead(file);
      insertedLineNumber = content.split(/\r?\n/).findIndex((line) => readInlineFieldValue(line, TPS_ID_FIELD) === tpsId);
    }
    if (insertedLineNumber < 0) {
      throw new Error(`Failed to create blank timer task in ${file.path}`);
    }
    return insertedLineNumber;
  }

  private getRunningProjectedEnd(start: Date): Date {
    const stepMs = RUNNING_SCHEDULE_AHEAD_MINUTES * 60_000;
    const now = Date.now();
    return new Date(Math.max(start.getTime() + stepMs, now + stepMs));
  }

  private async resolveAndEnsureTarget(input?: TimeTrackingTargetInput): Promise<ResolvedTimeTrackingTarget | null> {
    let file = input?.file ?? null;
    if (!file && input?.filePath) {
      const abstractFile = this.plugin.app.vault.getAbstractFileByPath(normalizePath(input.filePath));
      if (abstractFile instanceof TFile) file = abstractFile;
    }
    if (!file) file = this.plugin.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') {
      new Notice('Time tracking requires a markdown note.');
      return null;
    }

    const type = input?.type === 'task' ? 'task' : 'note';

    if (type === 'note') {
      const tpsId = await this.ensureNoteTpsId(file);
      const title = input?.title?.trim() || this.getNoteTitle(file);
      return { file, type, title, tpsId };
    }

    const preferredLineNumber = typeof input?.lineNumber === 'number' ? Math.max(0, Math.floor(input.lineNumber)) : -1;
    if (preferredLineNumber < 0) {
      new Notice('Time tracking requires a task line.');
      return null;
    }
    const content = await this.plugin.app.vault.cachedRead(file);
    const lines = content.split(/\r?\n/);
    const sourceRawLine = String(input?.rawLine || '');
    const sourceTitle = String(input?.title || '').trim()
      || getTaskDisplayTitle(sourceRawLine);
    const lineNumber = findCurrentTaskLineIndex(
      lines,
      preferredLineNumber,
      sourceRawLine,
      sourceTitle,
    );
    const line = lineNumber >= 0 ? lines[lineNumber] || '' : '';
    const parsed = parseTaskLine(line);
    if (!parsed) {
      logger.warn('[TimeTracking] Task target resolution failed.', {
        path: file.path,
        preferredLineNumber,
        hasRawLine: !!sourceRawLine,
        title: sourceTitle || null,
      });
      new Notice('Time tracking could not uniquely find the task line.');
      return null;
    }
    const title = getTaskDisplayTitle(line) || sourceTitle || parsed.body || file.basename;
    const existingId = readInlineFieldValue(line, TPS_ID_FIELD) || readInlineFieldValue(line, 'subitemId');
    const tpsId = existingId || this.createTaskTargetId(file, lineNumber, line);
    const ensured = await this.ensureTaskLineTpsId(file, lineNumber, line, title, tpsId);
    if (!ensured) {
      new Notice('Time tracking could not attach a stable id to the task line.');
      return null;
    }
    logger.log('[TimeTracking] Task target resolved.', {
      path: file.path,
      preferredLineNumber,
      resolvedLineNumber: ensured.lineNumber,
      reusedStableId: !!existingId,
    });
    return {
      file,
      type,
      lineNumber: ensured.lineNumber,
      title: getTaskDisplayTitle(ensured.rawLine) || title,
      tpsId: ensured.tpsId,
    };
  }

  private async ensureTaskLineTpsId(
    file: TFile,
    preferredLineNumber: number,
    rawLine: string,
    title: string,
    tpsId: string,
  ): Promise<{ tpsId: string; lineNumber: number; rawLine: string } | null> {
    const wanted = String(tpsId || '').trim();
    if (!wanted) return null;
    let resolved: { tpsId: string; lineNumber: number; rawLine: string } | null = null;
    try {
      await this.plugin.app.vault.process(file, (content) => {
        const newline = content.includes('\r\n') ? '\r\n' : '\n';
        const endsWithNewline = /\r?\n$/.test(content);
        const lines = content.split(/\r?\n/);
        if (endsWithNewline) lines.pop();
        const lineNumber = findCurrentTaskLineIndex(lines, preferredLineNumber, rawLine, title);
        const line = lineNumber >= 0 ? lines[lineNumber] || '' : '';
        if (!parseTaskLine(line)) return content;
        const existing = readInlineFieldValue(line, TPS_ID_FIELD) || readInlineFieldValue(line, 'subitemId');
        if (existing) {
          resolved = { tpsId: existing, lineNumber, rawLine: line };
          return content;
        }
        const nextLine = updateTaskLineTimestamps(setInlineFieldValueOnTaskLine(line, TPS_ID_FIELD, wanted), {
          enabled: this.plugin.settings.autoSyncFileTimestamps === true,
          modifiedKey: this.plugin.settings.dateModifiedFrontmatterKey,
          format: this.plugin.settings.fileTimestampFormat,
          markModified: true,
        });
        lines[lineNumber] = nextLine;
        resolved = { tpsId: wanted, lineNumber, rawLine: nextLine };
        return `${lines.join(newline)}${endsWithNewline ? newline : ''}`;
      });
    } catch (error) {
      logger.warn('[TimeTracking] Failed attaching stable id to task target.', {
        path: file.path,
        preferredLineNumber,
        error,
      });
      return null;
    }
    if (!resolved) {
      logger.warn('[TimeTracking] Task target became stale before stable-id write.', {
        path: file.path,
        preferredLineNumber,
        title: title || null,
      });
    }
    return resolved;
  }

  private createTaskTargetId(file: TFile, lineNumber: number, line: string): string {
    const source = `${file.path}:${lineNumber}:${line}`;
    let hash = 0;
    for (let i = 0; i < source.length; i++) {
      hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
    }
    return `task-${Math.abs(hash).toString(36)}`;
  }

  private async ensureNoteTpsId(file: TFile): Promise<string> {
    let resolved = this.getFrontmatterTpsId(file);
    if (resolved) return resolved;

    resolved = this.createId('item');
    await this.plugin.frontmatterMutationService.process(file, (frontmatter) => {
      setValueCaseInsensitive(frontmatter, TPS_ID_FIELD, resolved);
    });
    return resolved;
  }

  private getFrontmatterTpsId(file: TFile): string | null {
    const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    if (!frontmatter) return null;
    const key = findKeyCaseInsensitive(frontmatter, TPS_ID_FIELD) || findKeyCaseInsensitive(frontmatter, 'subitemId');
    const value = key ? String(frontmatter[key] ?? '').trim() : '';
    return value || null;
  }

  private resolveSessionStorageKind(target: ResolvedTimeTrackingTarget): 'frontmatter' {
    return resolveTimeTrackingStorageKind(this.getStorageMode(), target.type);
  }

  private async writeNewSession(
    target: ResolvedTimeTrackingTarget,
    record: TimeTrackingSessionRecord,
    resolvedStorageFile?: TFile,
  ): Promise<void> {
    const storageMode = this.resolveSessionStorageKind(target);
    const file = resolvedStorageFile ?? await this.resolveStorageFileForNewSession(target, this.normalizeDateInput(record.start) ?? new Date());
    await this.appendFrontmatterSession(file, record);
    if (target.type === 'note' && file.path !== target.file.path && this.getStorageMode() === 'daily-note') {
      await this.ensureTrackedNoteDailyLink(target.file, file);
    }
    await this.refreshActiveTimerCache();
  }

  private async appendFrontmatterSession(file: TFile, record: TimeTrackingSessionRecord): Promise<void> {
    const key = this.getPropertyKey();
    await this.plugin.frontmatterMutationService.process(file, (frontmatter) => {
      const existingKey = findKeyCaseInsensitive(frontmatter, key) || key;
      const current = this.normalizeRecordList(frontmatter[existingKey]);
      current.push(record);
      setValueCaseInsensitive(frontmatter, existingKey, current);
    });
  }

  private async ensureTrackedNoteDailyLink(sourceFile: TFile, dailyNote: TFile): Promise<void> {
    const key = 'timeTrackingDailyNotes';
    const link = this.plugin.app.fileManager.generateMarkdownLink(dailyNote, sourceFile.path);
    await this.plugin.frontmatterMutationService.process(sourceFile, (frontmatter) => {
      const existingKey = findKeyCaseInsensitive(frontmatter, key) || key;
      const current = this.normalizeStringList(frontmatter[existingKey]);
      if (current.includes(link) || current.includes(dailyNote.path) || current.includes(dailyNote.basename)) return;
      current.push(link);
      setValueCaseInsensitive(frontmatter, existingKey, current);
    });
  }

  private normalizeStringList(value: unknown): string[] {
    const source = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
    return source
      .flatMap((item) => Array.isArray(item) ? item : [item])
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
  }

  private async replaceStoredSession(stored: StoredSession, nextRecord: TimeTrackingSessionRecord): Promise<void> {
    await this.replaceFrontmatterSession(stored.storageFile, stored.record.id, nextRecord);
  }

  private async replaceFrontmatterSession(file: TFile, id: string, nextRecord: TimeTrackingSessionRecord): Promise<void> {
    const key = this.getPropertyKey();
    await this.plugin.frontmatterMutationService.process(file, (frontmatter) => {
      const existingKey = findKeyCaseInsensitive(frontmatter, key) || key;
      const current = this.normalizeRecordList(frontmatter[existingKey]);
      const next = current.map((record) => record.id === id ? nextRecord : record);
      setValueCaseInsensitive(frontmatter, existingKey, next);
    });
  }

  private async removeStoredSession(stored: StoredSession): Promise<void> {
    await this.removeFrontmatterSession(stored.storageFile, stored.record.id);
  }

  private async removeFrontmatterSession(file: TFile, id: string): Promise<void> {
    const key = this.getPropertyKey();
    await this.plugin.frontmatterMutationService.process(file, (frontmatter) => {
      const existingKey = findKeyCaseInsensitive(frontmatter, key);
      if (!existingKey) return;
      const next = this.normalizeRecordList(frontmatter[existingKey]).filter((record) => record.id !== id);
      if (next.length > 0) {
        setValueCaseInsensitive(frontmatter, existingKey, next);
      } else {
        deleteValueCaseInsensitive(frontmatter, existingKey);
      }
    });
  }

  private async resolveStorageFileForNewSession(
    target: ResolvedTimeTrackingTarget,
    start: Date,
  ): Promise<TFile> {
    const mode = this.getStorageMode();
    if (mode === 'source-note') return target.file;
    if (mode === 'dedicated-note') {
      return this.ensureMarkdownFile(
        normalizePath(this.plugin.settings.timeTrackingDedicatedNotePath || 'Time Tracking.md'),
        'Time Tracking',
      );
    }
    return this.ensureMarkdownFile(this.getDailyNotePath(start), this.getDailyNoteTitle(start));
  }

  private async ensureMarkdownFile(path: string, title: string): Promise<TFile> {
    let normalized = normalizePath(String(path || '').trim() || 'Time Tracking.md');
    if (!normalized.toLowerCase().endsWith('.md')) normalized = `${normalized}.md`;
    normalized = normalized.replace(/^\/+/, '');

    const existing = this.plugin.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) return existing;

    await this.ensureFolder(normalized.includes('/') ? normalized.split('/').slice(0, -1).join('/') : '');
    const escapedTitle = title.replace(/"/g, '\\"');
    const created = await this.plugin.app.vault.create(normalized, `---\ntitle: "${escapedTitle}"\n---\n\n`);
    if (!(created instanceof TFile)) {
      throw new Error(`Failed to create time tracking note: ${normalized}`);
    }
    return created;
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const clean = normalizePath(folderPath || '').replace(/^\/+/, '');
    if (!clean) return;
    const parts = clean.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.plugin.app.vault.getAbstractFileByPath(current)) {
        await this.plugin.app.vault.createFolder(current);
      }
    }
  }

  private getDailyNoteTitle(date: Date): string {
    const moment = (window as any).moment;
    const format = this.getDailyNoteFormat();
    return moment ? moment(date).format(format) : this.formatYmd(date);
  }

  private getDailyNotePath(date: Date): string {
    const daily = this.getDailyNoteOptions();
    const title = this.getDailyNoteTitle(date);
    const folder = normalizePath(String(daily?.folder || '').trim()).replace(/^\/+|\/+$/g, '');
    return normalizePath(`${folder ? `${folder}/` : ''}${title}.md`);
  }

  private getDailyNoteFormat(): string {
    const daily = this.getDailyNoteOptions();
    return String(daily?.format || 'YYYY-MM-DD').trim() || 'YYYY-MM-DD';
  }

  private getDailyNoteOptions(): Record<string, unknown> | null {
    const dailyPlugin = (this.plugin.app as any)?.internalPlugins?.plugins?.['daily-notes']?.instance;
    return dailyPlugin?.options || null;
  }

  private async scanStoredSessions(): Promise<StoredSession[]> {
    const key = this.getPropertyKey();
    const output: StoredSession[] = [];

    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      if (this.shouldIgnoreTimeTrackingPath(file.path)) continue;
      const frontmatter = await this.readFrontmatterForTimeTrackingScan(file);
      const existingKey = frontmatter ? findKeyCaseInsensitive(frontmatter, key) : null;
      if (frontmatter && existingKey) {
        for (const record of this.normalizeRecordList(frontmatter[existingKey])) {
          output.push({ record, storageMode: 'frontmatter', storageFile: file });
        }
      }
    }

    return output;
  }

  private async readFrontmatterForTimeTrackingScan(file: TFile): Promise<Record<string, unknown> | undefined> {
    const cached = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    if (cached && findKeyCaseInsensitive(cached, this.getPropertyKey())) return cached;

    let raw = '';
    try {
      raw = await this.plugin.app.vault.cachedRead(file);
    } catch {
      return cached;
    }
    if (!raw.startsWith('---')) return cached;
    const normalized = raw.replace(/\r\n/g, '\n');
    const closing = normalized.indexOf('\n---', 3);
    if (closing < 0) return cached;
    try {
      const parsed = parseYaml(normalized.slice(4, closing));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : cached;
    } catch {
      return cached;
    }
  }

  private async findStoredSession(id: string): Promise<StoredSession | null> {
    const targetId = String(id || '').trim();
    if (!targetId) return null;
    return (await this.scanStoredSessions()).find((session) => session.record.id === targetId) ?? null;
  }

  private async getActiveStoredSession(): Promise<StoredSession | null> {
    const stored = await this.scanStoredSessions();
    stored.sort((a, b) => String(a.record.start || '').localeCompare(String(b.record.start || '')));
    for (const session of stored) {
      if (session.record.end) continue;
      if (await this.shouldIgnoreStoredSession(session)) continue;
      return session;
    }
    return null;
  }

  private async getActiveStoredSessionForFile(file: TFile): Promise<StoredSession | null> {
    const stored = (await this.scanStoredSessions()).filter((session) => !session.record.end);
    const matches: StoredSession[] = [];
    for (const session of stored) {
      if (await this.shouldIgnoreStoredSession(session)) continue;
      const target = await this.resolveTargetForRecord(session.record, session);
      if (target?.file.path === file.path || session.record.sourcePath === file.path) {
        matches.push(session);
      }
    }
    matches.sort((a, b) => String(a.record.start || '').localeCompare(String(b.record.start || '')));
    return matches[0] ?? null;
  }

  private async refreshActiveTimerCache(activeSessions?: StoredSession[]): Promise<void> {
    const active = activeSessions ?? (await this.scanStoredSessions()).filter((session) => !session.record.end);
    const next = new Map<string, number>();
    for (const session of active) {
      if (await this.shouldIgnoreStoredSession(session)) continue;
      if (session.record.targetType !== 'note') continue;
      const target = await this.resolveTargetForRecord(session.record, session);
      const path = String(target?.file.path || session.record.sourcePath || '').trim();
      if (path) {
        next.set(path, (next.get(path) ?? 0) + 1);
      }
    }
    this.activeTimerCountsByPath = next;
  }

  private shouldIgnoreTimeTrackingPath(path: string | null | undefined): boolean {
    if (this.plugin.settings.timeTrackingIgnoreArchivedFiles === false) return false;
    const archiveFolder = normalizePath(String(this.plugin.getArchiveFolderPath?.() || '').trim()).replace(/^\/+|\/+$/g, '');
    if (!archiveFolder) return false;
    const normalizedPath = normalizePath(String(path || '').trim()).replace(/^\/+/, '');
    return normalizedPath === archiveFolder || normalizedPath.startsWith(`${archiveFolder}/`);
  }

  private async shouldIgnoreStoredSession(stored: StoredSession): Promise<boolean> {
    if (this.shouldIgnoreTimeTrackingPath(stored.storageFile.path)) return true;
    if (this.shouldIgnoreTimeTrackingPath(stored.record.sourcePath)) return true;
    const target = await this.resolveTargetForRecord(stored.record, stored);
    return this.shouldIgnoreTimeTrackingPath(target?.file.path);
  }

  private async getActiveSession(): Promise<TimeTrackingSession | null> {
    const active = await this.getActiveStoredSession();
    return active ? this.hydrateStoredSession(active) : null;
  }

  private normalizePausedState(value: unknown): TimeTrackingPausedSessionState | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    const targetId = String(raw.targetId || '').trim();
    const sourcePath = String(raw.sourcePath || '').trim();
    const title = String(raw.title || '').trim() || 'Tracked time';
    const pausedAt = String(raw.pausedAt || '').trim();
    const typeRaw = String(raw.targetType || '').trim() as TimeTrackingTargetType;
    const targetType: TimeTrackingPausedSessionState['targetType'] =
      typeRaw === 'heading' || typeRaw === 'bullet' || typeRaw === 'task' || typeRaw === 'line'
        ? typeRaw
        : 'note';
    if (!targetId || !sourcePath || !pausedAt) return null;
    const lineNumber = Number(raw.lineNumber);
    const elapsedMs = Number(raw.elapsedMs);
    return {
      targetId,
      targetType,
      sourcePath,
      lineNumber: Number.isFinite(lineNumber) ? lineNumber : undefined,
      title,
      pausedAt,
      elapsedMs: Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0,
      lastSessionId: String(raw.lastSessionId || '').trim() || undefined,
    };
  }

  private sessionOverlapsRange(record: TimeTrackingSessionRecord, rangeStart: number | null, rangeEnd: number | null): boolean {
    return timeTrackingSessionOverlapsRange(
      record,
      rangeStart,
      rangeEnd,
      Date.now(),
      (value) => this.normalizeDateInput(value),
    );
  }

  private async hydrateStoredSession(stored: StoredSession): Promise<TimeTrackingSession> {
    const target = await this.resolveTargetForRecord(stored.record, stored);
    const isActive = !stored.record.end;
    const title = target?.title || this.getFallbackTitle(stored.record);
    return {
      ...stored.record,
      title,
      isActive,
      storageMode: stored.storageMode,
      storagePath: stored.storageFile.path,
      storageLineNumber: stored.storageLineNumber,
      targetPath: target?.file.path || stored.record.sourcePath || stored.storageFile.path,
      targetLineNumber: target?.lineNumber ?? stored.record.lineNumber,
    };
  }

  private async resolveTargetForRecord(
    record: TimeTrackingSessionRecord,
    stored?: Pick<StoredSession, 'storageFile' | 'storageLineNumber'>,
  ): Promise<TimeTrackingTargetReference | null> {
    if (record.targetType === 'note') {
      const sourceFile = this.resolveFile(record.sourcePath);
      const sourceId = sourceFile ? this.getFrontmatterTpsId(sourceFile) : null;
      const file = sourceFile && (!sourceId || sourceId === record.targetId || sourceFile.path === stored?.storageFile?.path)
        ? sourceFile
        : this.findNoteByTpsId(record.targetId) ?? sourceFile ?? stored?.storageFile ?? null;
      if (!(file instanceof TFile)) return null;
      return { file, type: 'note', title: this.getNoteTitle(file) };
    }

    const fallbackFile = this.resolveFile(record.sourcePath) ?? stored?.storageFile ?? null;
    const fallbackLine = typeof record.lineNumber === 'number'
      ? record.lineNumber
      : stored?.storageLineNumber;
    if (record.targetType === 'task') {
      if (!(fallbackFile instanceof TFile)) return null;
      const content = await this.plugin.app.vault.cachedRead(fallbackFile).catch(() => '');
      const lines = content.split(/\r?\n/);
      const resolvedLine = this.findTaskLineIndex(lines, typeof fallbackLine === 'number' ? fallbackLine : -1, record.targetId);
      if (resolvedLine < 0) return null;
      const rawLine = lines[resolvedLine] || '';
      return {
        file: fallbackFile,
        type: 'task',
        lineNumber: resolvedLine,
        rawLine,
        title: getTaskDisplayTitle(rawLine) || fallbackFile.basename,
      };
    }

    if (fallbackFile instanceof TFile && typeof fallbackLine === 'number') {
      const content = await this.plugin.app.vault.cachedRead(fallbackFile).catch(() => '');
      const rawLine = content.split(/\r?\n/)[fallbackLine] || '';
      return {
        file: fallbackFile,
        type: record.targetType,
        lineNumber: fallbackLine,
        title: getTaskDisplayTitle(rawLine) || fallbackFile.basename,
      };
    }

    return null;
  }

  private findTaskLineIndex(lines: string[], preferredLineNumber: number, targetId: string): number {
    const wanted = String(targetId || '').trim();
    const preferred = Number.isFinite(preferredLineNumber) ? Math.max(0, Math.floor(preferredLineNumber)) : -1;
    if (preferred >= 0) {
      const line = lines[preferred] || '';
      if (parseTaskLine(line)) {
        const id = readInlineFieldValue(line, TPS_ID_FIELD) || readInlineFieldValue(line, 'subitemId');
        if (!wanted || id === wanted) return preferred;
      }
    }
    if (!wanted) return -1;
    for (let index = 0; index < lines.length; index++) {
      if (index === preferred) continue;
      const line = lines[index] || '';
      if (!parseTaskLine(line)) continue;
      const id = readInlineFieldValue(line, TPS_ID_FIELD) || readInlineFieldValue(line, 'subitemId');
      if (id === wanted) return index;
    }
    return -1;
  }

  private withResolvedLineNumber(
    record: TimeTrackingSessionRecord,
    target: TimeTrackingTargetReference | null,
  ): TimeTrackingSessionRecord {
    if (record.targetType !== 'task' || typeof target?.lineNumber !== 'number') return record;
    if (record.lineNumber === target.lineNumber) return record;
    return { ...record, lineNumber: target.lineNumber };
  }

  private async resolveTargetForPausedState(
    paused: TimeTrackingPausedSessionState,
  ): Promise<TimeTrackingTargetReference | null> {
    return this.resolveTargetForRecord({
      id: paused.lastSessionId || 'paused',
      targetId: paused.targetId,
      targetType: paused.targetType,
      sourcePath: paused.sourcePath,
      lineNumber: paused.lineNumber,
      start: paused.pausedAt,
      createdAt: paused.pausedAt,
      updatedAt: paused.pausedAt,
    });
  }

  private async openResolvedTarget(resolved: { file: TFile; lineNumber?: number }): Promise<boolean> {
    const opened = await this.plugin.openFileInLeaf(
      resolved.file,
      false,
      () => this.plugin.app.workspace.getLeaf(false),
      { revealLeaf: true },
    );
    if (!opened) return false;

    if (typeof resolved.lineNumber === 'number') {
      const leaf = this.plugin.findOpenLeafForFile(resolved.file) ?? this.plugin.app.workspace.activeLeaf;
      if (!leaf) return true;
      const view = leaf.view;
      if (view instanceof MarkdownView) {
        view.editor.setCursor({ line: resolved.lineNumber, ch: 0 });
        view.editor.focus();
        view.editor.scrollIntoView(
          { from: { line: resolved.lineNumber, ch: 0 }, to: { line: resolved.lineNumber + 1, ch: 0 } },
          true,
        );
      }
    }

    return true;
  }

  private findNoteByTpsId(tpsId: string): TFile | null {
    const wanted = String(tpsId || '').trim();
    if (!wanted) return null;
    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      if (this.getFrontmatterTpsId(file) === wanted) return file;
    }
    return null;
  }

  private resolveFile(path: string | null | undefined): TFile | null {
    const normalized = normalizePath(String(path || '').trim());
    if (!normalized) return null;
    const file = this.plugin.app.vault.getAbstractFileByPath(normalized);
    return file instanceof TFile ? file : null;
  }

  private normalizeRecordList(value: unknown): TimeTrackingSessionRecord[] {
    return normalizeTimeTrackingRecordList(value);
  }

  private normalizeRecord(value: unknown): TimeTrackingSessionRecord | null {
    return normalizeTimeTrackingRecord(value);
  }

  private withUpdatedTimes(
    record: TimeTrackingSessionRecord,
    startInput: Date | string | number,
    endInput?: Date | string | number | null,
  ): TimeTrackingSessionRecord {
    const start = this.normalizeDateInput(startInput) ?? new Date();
    const end = this.normalizeDateInput(endInput ?? null);
    const next: TimeTrackingSessionRecord = {
      ...record,
      start: this.formatDateTime(start),
      updatedAt: this.formatDateTime(new Date()),
    };
    if (end) {
      next.end = this.formatDateTime(end);
      next.durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    } else {
      delete next.end;
      delete next.durationMinutes;
    }
    return next;
  }

  private getNoteTitle(file: TFile): string {
    const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    const titleKey = frontmatter ? findKeyCaseInsensitive(frontmatter, 'title') : null;
    const title = titleKey ? String(frontmatter?.[titleKey] ?? '').trim() : '';
    return title || file.basename;
  }

  private getActiveNoteTitle(): string {
    const file = this.plugin.app.workspace.getActiveFile();
    return file instanceof TFile ? this.getNoteTitle(file) : '';
  }

  private getFallbackTitle(record: TimeTrackingSessionRecord): string {
    if (record.targetType === 'task') {
      const sourcePath = String(record.sourcePath || '').trim();
      const basename = sourcePath.split('/').pop()?.replace(/\.md$/i, '') || '';
      return basename ? `Task in ${basename}` : 'Tracked task';
    }
    const sourcePath = String(record.sourcePath || '').trim();
    if (!sourcePath) return 'Tracked time';
    return sourcePath.split('/').pop()?.replace(/\.md$/i, '') || 'Tracked time';
  }

  private normalizeDateInput(input: Date | string | number | null | undefined): Date | null {
    if (input == null || input === '') return null;
    if (input instanceof Date) return Number.isFinite(input.getTime()) ? input : null;
    if (typeof input === 'number') {
      const parsed = new Date(input);
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }
    const schedule = this.plugin.sharedServices?.schedule;
    const parsed = schedule?.parseDate?.(input);
    if (parsed && Number.isFinite(parsed.getTime())) return parsed;
    const fallback = new Date(String(input));
    return Number.isFinite(fallback.getTime()) ? fallback : null;
  }

  private formatDateTime(date: Date): string {
    const schedule = this.plugin.sharedServices?.schedule;
    if (schedule?.formatDateTimeForFrontmatter) {
      return schedule.formatDateTimeForFrontmatter(date);
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  }

  private formatYmd(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private createId(prefix: string): string {
    const random =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${random}`;
  }
}

function isProcessRunFrontmatter(frontmatter: Record<string, unknown>): boolean {
  const runKind = frontmatterValue(frontmatter, 'runKind');
  const workflowKind = frontmatterValue(frontmatter, 'workflowKind');
  const kind = frontmatterValue(frontmatter, 'kind');
  const runType = frontmatterValue(frontmatter, 'runType');
  const workflowType = frontmatterValue(frontmatter, 'workflowType');
  return runKind === 'run'
    || workflowKind === 'workflow'
    || kind === 'workout'
    || kind === 'workout-plan'
    || Boolean(runType)
    || Boolean(workflowType);
}

function frontmatterValue(frontmatter: Record<string, unknown>, key: string): string {
  const actualKey = findKeyCaseInsensitive(frontmatter, key);
  return actualKey ? String(frontmatter[actualKey] ?? '').trim().toLowerCase() : '';
}
