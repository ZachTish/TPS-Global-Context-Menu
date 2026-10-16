import { Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { TaskRecurrenceTemplateModal } from '../modals/task-recurrence-template-modal';
import {
  buildTaskRecurrenceTemplateLine,
  ensureTaskRecurrenceIdOnLine,
  TASK_RECURRENCE_ID_KEY,
} from '../utils/task-recurrence';
import {
  isLinkedSubitemSemanticCheckboxPlanCurrent,
  resolveLinkedSubitemSemanticCheckboxPlanForStatus,
  type LinkedSubitemSemanticCheckboxPlan,
} from '../utils/linked-subitem-mapping';
import {
  getTaskDisplayTitle,
  readInlineFieldValue,
} from '../utils/task-line-metadata';
import { findCurrentTaskLineIndex } from '../utils/task-block-move';
import * as logger from '../logger';

type TaskRecurrenceTemplateStore = {
  version: 1;
  templates: Record<string, TaskRecurrenceTemplateEntry>;
};

type TaskRecurrenceTemplateEntry = {
  line: string;
  updatedAt: string;
};

type RecurrenceTaskCreationMapping = LinkedSubitemSemanticCheckboxPlan & {
  statusKey: string;
};

export class TaskRecurrenceService {
  private storeLoaded = false;
  private store: TaskRecurrenceTemplateStore = { version: 1, templates: {} };

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  async editTemplateForTaskLine(file: TFile, lineIndex: number, rawLine: string): Promise<void> {
    const creationMapping = this.resolveRecurrenceTaskCreationMapping();
    if (!creationMapping) {
      this.reportUnavailableCreationMapping('edit-template');
      return;
    }
    let resolved: { recurrenceTaskId: string; lineForTemplate: string; lineIndex: number } | null = null;
    try {
      await this.plugin.subitemRelationshipSyncService.mutateMarkdownBody(file, async (lines) => {
        if (!this.recurrenceTaskCreationMappingIsCurrent(creationMapping)) return false;
        const currentLineIndex = findCurrentTaskLineIndex(
          lines,
          lineIndex,
          rawLine,
          getTaskDisplayTitle(rawLine),
        );
        if (currentLineIndex < 0) return false;
        const currentLine = lines[currentLineIndex] || '';
        let recurrenceTaskId = readInlineFieldValue(currentLine, TASK_RECURRENCE_ID_KEY);
        if (!recurrenceTaskId) {
          recurrenceTaskId = this.createRecurrenceTaskId(file, currentLineIndex);
        }
        const lineForTemplate = ensureTaskRecurrenceIdOnLine(currentLine, recurrenceTaskId);
        resolved = { recurrenceTaskId, lineForTemplate, lineIndex: currentLineIndex };
        if (lineForTemplate === currentLine) return false;
        lines[currentLineIndex] = lineForTemplate;
        return true;
      });
    } catch (error) {
      logger.warn('[TaskRecurrence] Template target resolution failed.', {
        path: file.path,
        preferredLineIndex: lineIndex,
        error,
      });
      new Notice('Could not update the recurrence template task.');
      return;
    }
    if (!resolved) {
      logger.warn('[TaskRecurrence] Template target was stale or ambiguous.', {
        path: file.path,
        preferredLineIndex: lineIndex,
        title: getTaskDisplayTitle(rawLine) || null,
      });
      new Notice('Could not uniquely find the recurrence template task.');
      return;
    }
    const { recurrenceTaskId, lineForTemplate, lineIndex: resolvedLineIndex } = resolved;
    logger.log('[TaskRecurrence] Template target resolved.', {
      path: file.path,
      preferredLineIndex: lineIndex,
      resolvedLineIndex,
    });
    const current = await this.resolveTemplateLine(recurrenceTaskId, lineForTemplate, creationMapping);
    if (!this.recurrenceTaskCreationMappingIsCurrent(creationMapping)) {
      this.reportChangedCreationMapping('edit-template-open');
      return;
    }
    new TaskRecurrenceTemplateModal(this.plugin.app, 'Edit task recurrence template', current, async (value) => {
      const saved = await this.setTemplateLine(recurrenceTaskId, buildTaskRecurrenceTemplateLine(
        ensureTaskRecurrenceIdOnLine(value, recurrenceTaskId),
        creationMapping.checkboxState,
        creationMapping.statusKey,
      ), creationMapping);
      if (saved) new Notice('Task recurrence template saved.');
      else this.reportChangedCreationMapping('edit-template-save');
    }).open();
  }

  async openTemplatesCommand(): Promise<void> {
    const creationMapping = this.resolveRecurrenceTaskCreationMapping();
    if (!creationMapping) {
      this.reportUnavailableCreationMapping('open-templates');
      return;
    }
    await this.loadStore();
    if (!this.recurrenceTaskCreationMappingIsCurrent(creationMapping)) {
      this.reportChangedCreationMapping('open-templates');
      return;
    }
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
      const saved = await this.setTemplateLine(id, buildTaskRecurrenceTemplateLine(
        ensureTaskRecurrenceIdOnLine(value, id),
        creationMapping.checkboxState,
        creationMapping.statusKey,
      ), creationMapping);
      if (saved) new Notice('Task recurrence template saved.');
      else this.reportChangedCreationMapping('open-templates-save');
    }).open();
  }

  private async resolveTemplateLine(
    recurrenceTaskId: string,
    rawLine: string,
    creationMapping: RecurrenceTaskCreationMapping,
  ): Promise<string> {
    await this.loadStore();
    const existing = this.store.templates[recurrenceTaskId]?.line;
    if (existing) {
      const normalized = buildTaskRecurrenceTemplateLine(
        ensureTaskRecurrenceIdOnLine(existing, recurrenceTaskId),
        creationMapping.checkboxState,
        creationMapping.statusKey,
      );
      return normalized;
    }
    const templateLine = buildTaskRecurrenceTemplateLine(
      rawLine,
      creationMapping.checkboxState,
      creationMapping.statusKey,
    );
    return templateLine;
  }

  private async setTemplateLine(
    recurrenceTaskId: string,
    line: string,
    creationMapping: RecurrenceTaskCreationMapping,
  ): Promise<boolean> {
    await this.loadStore();
    if (!this.recurrenceTaskCreationMappingIsCurrent(creationMapping)) return false;
    const nextStore: TaskRecurrenceTemplateStore = {
      version: 1,
      templates: {
        ...this.store.templates,
        [recurrenceTaskId]: {
          line,
          updatedAt: new Date().toISOString(),
        },
      },
    };
    const saved = await this.saveStore(nextStore);
    if (saved) this.store = nextStore;
    return saved;
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

  private async saveStore(store: TaskRecurrenceTemplateStore): Promise<boolean> {
    try {
      await this.plugin.app.vault.adapter.write(this.getStorePath(), JSON.stringify(store, null, 2));
      return true;
    } catch (error) {
      logger.warn('[TPS GCM] Failed saving task recurrence templates', error);
      new Notice('Failed to save task recurrence template metadata.');
      return false;
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

  private resolveRecurrenceTaskCreationMapping(): RecurrenceTaskCreationMapping | null {
    const status = this.plugin.sharedServices.status.normalize(
      this.plugin.settings.recurrenceDefaultStatus,
    );
    if (!status) return null;
    const plan = resolveLinkedSubitemSemanticCheckboxPlanForStatus(
      this.plugin.settings.linkedSubitemCheckboxMappings || [],
      status,
      { normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value) },
    );
    if (!plan) return null;
    return {
      ...plan,
      statusKey: this.plugin.sharedServices.status.getStatusPropertyKey(),
    };
  }

  private recurrenceTaskCreationMappingIsCurrent(mapping: RecurrenceTaskCreationMapping): boolean {
    return mapping.status === this.plugin.sharedServices.status.normalize(
      this.plugin.settings.recurrenceDefaultStatus,
    )
      && mapping.statusKey === this.plugin.sharedServices.status.getStatusPropertyKey()
      && isLinkedSubitemSemanticCheckboxPlanCurrent(
        this.plugin.settings.linkedSubitemCheckboxMappings || [],
        mapping,
        { normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value) },
      );
  }

  private reportUnavailableCreationMapping(source: string): void {
    const status = this.plugin.sharedServices.status.normalize(
      this.plugin.settings.recurrenceDefaultStatus,
    );
    logger.warn('[TaskRecurrence] Creation blocked because the default status has no checkbox mapping.', {
      source,
      status: status || null,
    });
    new Notice('Could not create the recurring task because its default status has no checkbox mapping.');
  }

  private reportChangedCreationMapping(source: string): void {
    logger.warn('[TaskRecurrence] Creation blocked because the default checkbox mapping changed before write.', {
      source,
    });
    new Notice('The recurring task checkbox mapping changed. Review the task and try again.');
  }
}
