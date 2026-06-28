import { Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { TaskRecurrenceTemplateModal } from '../modals/task-recurrence-template-modal';
import {
  buildNextTaskRecurrenceLine,
  buildTaskRecurrenceTemplateLine,
  calculateNextTaskScheduledValue,
  ensureTaskRecurrenceIdOnLine,
  extractTaskRecurrenceRule,
  findTaskBlockEndIndex,
  formatTaskScheduledDate,
  isCompletedTaskMarker,
  TASK_RECURRENCE_COMPLETED_DATE_KEY,
  TASK_RECURRENCE_ID_KEY,
} from '../utils/task-recurrence';
import { getLinkedSubitemCompleteMarkers } from '../utils/linked-subitem-mapping';
import { readInlineFieldValue, setInlineFieldValueOnTaskLine } from '../utils/task-line-metadata';
import * as logger from '../logger';

type TaskRecurrenceTemplateStore = {
  version: 1;
  templates: Record<string, TaskRecurrenceTemplateEntry>;
};

type TaskRecurrenceTemplateEntry = {
  line: string;
  updatedAt: string;
};

type CompletionContext = {
  file: TFile;
  previousState: string | null;
  nextState: string | null;
  updatedLines: string[];
};

export class TaskRecurrenceService {
  private storeLoaded = false;
  private store: TaskRecurrenceTemplateStore = { version: 1, templates: {} };

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  async handleTaskCompletion(context: CompletionContext): Promise<void> {
    if (!this.plugin.settings.enableRecurrence) return;
    if (isCompletedTaskMarker(context.previousState, this.getCompleteMarkers())) return;
    if (!isCompletedTaskMarker(context.nextState, this.getCompleteMarkers())) return;

    const completedAt = new Date();
    let created = false;

    await this.plugin.subitemRelationshipSyncService.mutateMarkdownBody(context.file, async (lines) => {
      const lineIndex = this.resolveCompletedLineIndex(lines, context.updatedLines);
      if (lineIndex < 0) return false;

      let completedLine = lines[lineIndex] || '';
      const recurrenceRule = extractTaskRecurrenceRule(completedLine);
      if (!recurrenceRule) return false;

      const scheduledValue = readInlineFieldValue(completedLine, 'scheduled');
      const nextScheduledValue = calculateNextTaskScheduledValue(recurrenceRule, {
        scheduledValue,
        completedAt,
      });
      if (!nextScheduledValue) {
        new Notice('Task recurrence rule could not produce a next scheduled value.');
        return false;
      }

      let recurrenceTaskId = readInlineFieldValue(completedLine, TASK_RECURRENCE_ID_KEY);
      if (!recurrenceTaskId) {
        recurrenceTaskId = this.createRecurrenceTaskId(context.file, lineIndex);
        completedLine = ensureTaskRecurrenceIdOnLine(completedLine, recurrenceTaskId);
      }

      const completedValue = formatTaskScheduledDate(completedAt);
      completedLine = setInlineFieldValueOnTaskLine(completedLine, TASK_RECURRENCE_COMPLETED_DATE_KEY, completedValue);
      lines[lineIndex] = completedLine;

      const templateLine = await this.getOrCreateTemplateLine(recurrenceTaskId, completedLine);
      const nextLine = ensureTaskRecurrenceIdOnLine(
        buildNextTaskRecurrenceLine(templateLine, nextScheduledValue),
        recurrenceTaskId,
      );
      const insertIndex = findTaskBlockEndIndex(lines, lineIndex);
      lines.splice(insertIndex, 0, nextLine);
      created = true;
      return true;
    });

    if (created) {
      this.plugin.eventService.emitFilesUpdated([context.file.path]);
      this.plugin.overlayRenderingService?.invalidate({
        reason: 'task-recurrence-created',
        file: context.file,
        surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
        rebuildInlineSubitems: true,
        refreshLivePreviewEditors: true,
        delayMs: 100,
      });
      new Notice('Created next recurring task instance.');
    }
  }

  async editTemplateForTaskLine(file: TFile, lineIndex: number, rawLine: string): Promise<void> {
    let recurrenceTaskId = readInlineFieldValue(rawLine, TASK_RECURRENCE_ID_KEY);
    let lineForTemplate = rawLine;
    if (!recurrenceTaskId) {
      recurrenceTaskId = this.createRecurrenceTaskId(file, lineIndex);
      lineForTemplate = ensureTaskRecurrenceIdOnLine(rawLine, recurrenceTaskId);
      await this.writeLineByIndex(file, lineIndex, lineForTemplate);
    }
    const current = await this.getOrCreateTemplateLine(recurrenceTaskId, lineForTemplate);
    new TaskRecurrenceTemplateModal(this.plugin.app, 'Edit task recurrence template', current, async (value) => {
      await this.setTemplateLine(recurrenceTaskId, buildTaskRecurrenceTemplateLine(ensureTaskRecurrenceIdOnLine(value, recurrenceTaskId)));
      new Notice('Task recurrence template saved.');
    }).open();
  }

  async openTemplatesCommand(): Promise<void> {
    await this.loadStore();
    const entries = Object.entries(this.store.templates);
    if (entries.length === 0) {
      new Notice('No task recurrence templates have been created yet.');
      return;
    }
    const labels = entries.map(([id, entry], index) => `${index + 1}. ${id}: ${entry.line}`).join('\n');
    const choice = window.prompt(`Edit which task recurrence template?\n${labels}`, '1');
    if (choice == null) return;
    const index = Number(choice.trim()) - 1;
    const selected = entries[index];
    if (!selected) {
      new Notice('No template matched that selection.');
      return;
    }
    const [id, entry] = selected;
    new TaskRecurrenceTemplateModal(this.plugin.app, 'Edit task recurrence template', entry.line, async (value) => {
      await this.setTemplateLine(id, buildTaskRecurrenceTemplateLine(ensureTaskRecurrenceIdOnLine(value, id)));
      new Notice('Task recurrence template saved.');
    }).open();
  }

  private resolveCompletedLineIndex(currentLines: string[], snapshotLines: string[]): number {
    for (let index = 0; index < snapshotLines.length; index += 1) {
      const snapshotLine = snapshotLines[index] || '';
      if (!extractTaskRecurrenceRule(snapshotLine)) continue;
      if (currentLines[index] === snapshotLine) return index;
      if (currentLines[index] && stripVolatileCompletedDate(currentLines[index]) === stripVolatileCompletedDate(snapshotLine)) return index;
    }
    return -1;
  }

  private async getOrCreateTemplateLine(recurrenceTaskId: string, rawLine: string): Promise<string> {
    await this.loadStore();
    const existing = this.store.templates[recurrenceTaskId]?.line;
    if (existing) {
      const withId = ensureTaskRecurrenceIdOnLine(existing, recurrenceTaskId);
      if (withId !== existing) {
        await this.setTemplateLine(recurrenceTaskId, withId);
      }
      return withId;
    }
    const templateLine = buildTaskRecurrenceTemplateLine(rawLine);
    await this.setTemplateLine(recurrenceTaskId, templateLine);
    return templateLine;
  }

  private async setTemplateLine(recurrenceTaskId: string, line: string): Promise<void> {
    await this.loadStore();
    this.store.templates[recurrenceTaskId] = {
      line,
      updatedAt: new Date().toISOString(),
    };
    await this.saveStore();
  }

  private async loadStore(): Promise<void> {
    if (this.storeLoaded) return;
    this.storeLoaded = true;
    try {
      const path = this.getStorePath();
      const exists = await this.plugin.app.vault.adapter.exists(path);
      if (!exists) return;
      const parsed = JSON.parse(await this.plugin.app.vault.adapter.read(path));
      if (parsed?.version === 1 && parsed.templates && typeof parsed.templates === 'object') {
        this.store = parsed;
      }
    } catch (error) {
      logger.warn('[TPS GCM] Failed loading task recurrence templates', error);
    }
  }

  private async saveStore(): Promise<void> {
    try {
      await this.plugin.app.vault.adapter.write(this.getStorePath(), JSON.stringify(this.store, null, 2));
    } catch (error) {
      logger.warn('[TPS GCM] Failed saving task recurrence templates', error);
      new Notice('Failed to save task recurrence template metadata.');
    }
  }

  private getStorePath(): string {
    return `${this.plugin.manifest.dir}/task-recurrence-templates.json`;
  }

  private createRecurrenceTaskId(file: TFile, lineIndex: number): string {
    const base = `${file.path}:${lineIndex + 1}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    let hash = 0;
    for (let index = 0; index < base.length; index += 1) {
      hash = ((hash << 5) - hash + base.charCodeAt(index)) | 0;
    }
    return `task-rec-${Math.abs(hash).toString(36)}`;
  }

  private async writeLineByIndex(file: TFile, lineIndex: number, nextLine: string): Promise<void> {
    await this.plugin.subitemRelationshipSyncService.mutateMarkdownBody(file, async (lines) => {
      if (lineIndex < 0 || lineIndex >= lines.length) return false;
      if (lines[lineIndex] === nextLine) return false;
      lines[lineIndex] = nextLine;
      return true;
    });
  }

  private getCompleteMarkers(): string[] {
    return getLinkedSubitemCompleteMarkers(this.plugin.settings.linkedSubitemCheckboxMappings || []);
  }
}

function stripVolatileCompletedDate(line: string): string {
  return setInlineFieldValueOnTaskLine(line, TASK_RECURRENCE_COMPLETED_DATE_KEY, null);
}
