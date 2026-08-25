import { Notice, TFile, moment } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import {
  CreateTaskModal,
  type CreateTaskCheckboxOption,
  type CreateTaskModalResult,
} from '../modals/create-task-modal';
import { buildCreatedTaskLine } from '../utils/create-task-parser';
import { insertLineAfterFrontmatter, updateTaskLineTimestamps } from '../utils/task-line-metadata';
import {
  abortDirectTaskHistory,
  beginDirectTaskHistory,
  commitDirectTaskHistory,
  ensureDirectTaskHistoryIdentity,
  type DirectTaskHistoryHandle,
  type DirectTaskHistoryLogContext,
} from '../utils/direct-task-history';
import {
  isLinkedSubitemSemanticCheckboxPlanCurrent,
  mapStatusToSubitemCheckboxState,
  normalizeLinkedSubitemMappings,
  resolveLinkedSubitemSemanticCheckboxPlanForState,
} from '../utils/linked-subitem-mapping';
import * as logger from '../logger';
import { taskLineNeedsNativeRecord } from './native-record-service';

export class CreateTaskService {
  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  openCreateTaskModal(): void {
    void this.openCreateTaskModalWithCanonicalTarget();
  }

  private async openCreateTaskModalWithCanonicalTarget(): Promise<void> {
    const checkboxOptions = this.getCheckboxOptions();
    const defaultCheckboxMarker = this.resolveCheckboxMarkerForStatus('todo');
    if (!defaultCheckboxMarker || checkboxOptions.length === 0) {
      logger.warn('[TPS GCM] Create task blocked because the todo checkbox mapping is unavailable');
      new Notice('Create task is unavailable until Todo has a valid checkbox mapping.');
      return;
    }
    const defaultTarget = await this.ensureTodayDailyNote();
    const defaultLabel = defaultTarget?.path || "Today's Daily Note";
    new CreateTaskModal(this.plugin.app, {
      defaultTargetFile: defaultTarget,
      defaultTargetLabel: defaultLabel,
      defaultTimeEstimate: 30,
      checkboxOptions,
      defaultCheckboxMarker,
      onSubmit: async (result) => {
        await this.createTask(result);
      },
    }).open();
  }

  async createTask(result: CreateTaskModalResult): Promise<TFile | null> {
    const title = String(result.title || '').trim();
    if (!title) {
      new Notice('Task title is required.');
      return null;
    }

    const configuredMappings = this.getConfiguredMappings();
    const creationPlan = resolveLinkedSubitemSemanticCheckboxPlanForState(
      configuredMappings,
      result.checkboxMarker,
      result.checkboxStatus,
      {
        normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value),
        normalizedMappings: true,
      },
    );
    const selectedStatuses = Array.isArray(result.checkboxStatuses)
      ? result.checkboxStatuses.map((status) => this.plugin.sharedServices.status.normalize(status))
      : [];
    if (
      !creationPlan
      || selectedStatuses.length !== creationPlan.statuses.length
      || selectedStatuses.some((status, index) => status !== creationPlan.statuses[index])
    ) {
      logger.warn('[TPS GCM] Create task blocked because the selected checkbox mapping is unavailable', {
        checkboxMarker: String(result.checkboxMarker ?? ''),
        checkboxStatus: String(result.checkboxStatus ?? ''),
      });
      new Notice('The selected task checkbox is no longer configured.');
      return null;
    }
    const checkboxMarker = creationPlan.checkboxState.slice(1, -1);

    const taskLine = buildCreatedTaskLine({
      title,
      checkboxMarker,
      priority: result.priority,
      scheduledValue: result.scheduledValue,
      allDay: result.allDay,
      timeEstimate: result.timeEstimate,
    });

    let historyHandle: DirectTaskHistoryHandle | null = null;
    let historyContext: DirectTaskHistoryLogContext | null = null;
    let historySettled = false;

    try {
      const targetFile = result.targetFile ?? await this.ensureTodayDailyNote();
      if (!(targetFile instanceof TFile)) {
        new Notice('Could not resolve the target note for the task.');
        return null;
      }

      const stampedTaskLine = updateTaskLineTimestamps(taskLine, {
        enabled: this.plugin.settings.autoSyncFileTimestamps === true,
        createdKey: this.plugin.settings.dateCreatedFrontmatterKey,
        modifiedKey: this.plugin.settings.dateModifiedFrontmatterKey,
        format: this.plugin.settings.fileTimestampFormat,
        markCreated: true,
        markModified: true,
      });
      historyContext = {
        action: 'task.create',
        surface: 'create-task-modal',
        path: targetFile.path,
        lineNumber: 0,
      };
      historyHandle = await beginDirectTaskHistory(this.plugin.itemHistoryService, {
        action: 'task.create',
        cause: {
          kind: 'user',
          sourcePluginId: 'tps-global-context-menu',
          surface: historyContext.surface,
        },
        before: {
          path: targetFile.path,
          lineNumber: 0,
          rawLine: stampedTaskLine,
        },
      });
      let mappingChanged = false;
      let writeAccepted = false;
      let historyReady = true;
      let insertedTaskLine = stampedTaskLine;
      let insertedLineNumber = 0;
      await this.plugin.app.vault.process(targetFile, (content) => {
        if (!isLinkedSubitemSemanticCheckboxPlanCurrent(
          this.getConfiguredMappings(),
          creationPlan,
          {
            normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value),
            normalizedMappings: true,
          },
        )) {
          mappingChanged = true;
          return content;
        }
        writeAccepted = true;
        const historyIdentity = ensureDirectTaskHistoryIdentity(
          this.plugin.itemHistoryService,
          historyHandle,
          stampedTaskLine,
          historyContext!,
        );
        insertedTaskLine = historyIdentity.line.trim();
        historyReady = historyReady && historyIdentity.ready;
        const trimmedContent = String(content || '').replace(/\s+$/gu, '');
        insertedLineNumber = trimmedContent ? trimmedContent.split(/\r?\n/u).length : 0;
        return insertLineAfterFrontmatter(content, insertedTaskLine);
      });
      if (mappingChanged || !writeAccepted) {
        await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
        historySettled = true;
        logger.warn('[TPS GCM] Create task blocked because the selected checkbox mapping changed before write', {
          checkboxMarker,
          checkboxStatus: creationPlan.status,
          targetPath: targetFile.path,
        });
        new Notice('The selected task checkbox mapping changed. Review the task and try again.');
        return null;
      }
      if (historyReady) {
        await commitDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, {
          after: {
            path: targetFile.path,
            lineNumber: insertedLineNumber,
            rawLine: insertedTaskLine,
          },
          outcome: 'committed',
        }, historyContext);
      } else {
        await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
      }
      historySettled = true;
      if (
        this.plugin.nativeRecordService?.isEnabled()
        && taskLineNeedsNativeRecord(insertedTaskLine)
      ) {
        const promotion = await this.plugin.nativeRecordService.promoteTask({
          path: targetFile.path,
          lineNumber: insertedLineNumber,
          rawLine: insertedTaskLine,
        }, {
          kind: 'user',
          sourcePluginId: 'tps-global-context-menu',
          surface: 'create-task-modal:instantiate-dated-task',
        });
        if (promotion.ok && promotion.record) {
          new Notice(`Created tracked task in ${promotion.record.path}`);
          await this.plugin.openFileInLeaf(
            promotion.record.file,
            false,
            () => this.plugin.app.workspace.getLeaf(false),
            { revealLeaf: true },
          );
          return promotion.record.file;
        }
        logger.flowWarn('CreateTask', 'dated-task:promotion-failed', {
          path: targetFile.path,
          lineNumber: insertedLineNumber + 1,
          error: promotion.error || 'unknown',
        });
        new Notice(`Task was created, but its tracked record could not be created: ${promotion.error || 'unknown error'}`);
      }
      new Notice(`Created task in ${targetFile.basename}`);
      await this.focusLineBeforeInsertedTask(targetFile, insertedTaskLine);
      return targetFile;
    } catch (error) {
      if (!historySettled && historyContext) {
        await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
      }
      logger.error('[TPS GCM] Failed to create task', error);
      new Notice('Unable to create task. Check console logs.');
      return null;
    }
  }

  private getCheckboxOptions(): CreateTaskCheckboxOption[] {
    return this.getConfiguredMappings().map((mapping) => {
      const checkboxMarker = mapping.checkboxState.slice(1, -1);
      const status = mapping.statuses[0];
      const description = mapping.label || status;
      return {
        checkboxMarker,
        status,
        statuses: [...mapping.statuses],
        label: `${description} ${mapping.checkboxState}`,
      };
    });
  }

  private resolveCheckboxMarkerForStatus(status: unknown): string | null {
    const mappings = this.getConfiguredMappings();
    const state = mapStatusToSubitemCheckboxState(mappings, status, {
      normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value),
      normalizedMappings: true,
    });
    return state ? state.slice(1, -1) : null;
  }

  private getConfiguredMappings() {
    return normalizeLinkedSubitemMappings(
      this.plugin.settings.linkedSubitemCheckboxMappings,
      {
        enforceStrictDefaults: false,
        normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value),
      },
    );
  }

  private async ensureTodayDailyNote(): Promise<TFile | null> {
    const momentLib = (window as any).moment || (moment as any);
    return this.plugin.noteOperationService.ensureDailyNote(
      `${momentLib().format('YYYY-MM-DD')} 00:00:00`,
    );
  }

  private async focusLineBeforeInsertedTask(file: TFile, taskLine: string): Promise<void> {
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    const content = await this.plugin.app.vault.cachedRead(file);
    const lineIndex = content.split(/\r?\n/).findIndex((line) => line.trim() === taskLine.trim());
    const cursorLine = Math.max(0, (lineIndex < 0 ? 0 : lineIndex) - 1);
    await this.plugin.openFileInLeaf(file, false, () => this.plugin.app.workspace.getLeaf(false), { revealLeaf: true });
    const leaf = this.plugin.findOpenLeafForFile(file);
    const view = leaf?.view as any;
    const editor = view?.editor;
    if (!editor || typeof editor.setCursor !== 'function') return;
    editor.setCursor({ line: cursorLine, ch: 0 });
    editor.scrollIntoView?.({ from: { line: cursorLine, ch: 0 }, to: { line: cursorLine, ch: 0 } }, true);
    editor.focus?.();
  }
}
