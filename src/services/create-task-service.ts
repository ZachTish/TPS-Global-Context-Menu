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
import { ensureTaskHistoryIdentity, getTaskHistoryIdentity } from './item-history-core';
import {
  isLinkedSubitemSemanticCheckboxPlanCurrent,
  mapStatusToSubitemCheckboxState,
  normalizeLinkedSubitemMappings,
  resolveLinkedSubitemSemanticCheckboxPlanForState,
} from '../utils/linked-subitem-mapping';
import * as logger from '../logger';

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
    const createTrackedRecord = this.plugin.nativeRecordService?.isEnabled() === true;
    const defaultParentMode = createTrackedRecord
      && this.plugin.settings.createTaskDefaultParentMode !== 'today-daily-note'
      ? 'standalone'
      : 'note';
    new CreateTaskModal(this.plugin.app, {
      defaultTargetFile: null,
      defaultTargetLabel: "Today's Daily Note",
      defaultParentMode,
      allowStandaloneParent: createTrackedRecord,
      defaultTimeEstimate: 30,
      checkboxOptions,
      defaultCheckboxMarker,
      createTrackedRecord,
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

    const nativeRecordModeEnabled = this.plugin.nativeRecordService?.isEnabled() === true;
    if (result.createTrackedRecord !== nativeRecordModeEnabled) {
      logger.flowWarn('CreateTask', 'route:mode-changed', {
        expected: result.createTrackedRecord ? 'native-records' : 'legacy',
        current: nativeRecordModeEnabled ? 'native-records' : 'legacy',
      });
      new Notice('Task creation mode changed while this dialog was open. Reopen Create task and try again.');
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

    if (!nativeRecordModeEnabled && result.parentMode === 'standalone') {
      logger.flowWarn('CreateTask', 'route:standalone-unavailable', { mode: 'legacy' });
      new Notice('Standalone task notes require Native Markdown records. Choose a containing note and try again.');
      return null;
    }

    if (nativeRecordModeEnabled && result.parentMode === 'standalone') {
      try {
        const record = await this.plugin.nativeRecordService.createStandaloneTask(
          taskLine,
          {
            kind: 'user',
            sourcePluginId: 'tps-global-context-menu',
            surface: 'create-task-modal:standalone-native-task-record',
          },
          () => isLinkedSubitemSemanticCheckboxPlanCurrent(
            this.getConfiguredMappings(),
            creationPlan,
            {
              normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value),
              normalizedMappings: true,
            },
          ),
        );
        try {
          await this.plugin.openFileInLeaf(
            record.file,
            false,
            () => this.plugin.app.workspace.getLeaf(false),
            { revealLeaf: true },
          );
          new Notice(`Created standalone task note ${record.path}`);
        } catch (error) {
          logger.flowWarn('CreateTask', 'standalone-task:open-failed', {
            recordPath: record.path,
            error: error instanceof Error ? error.message : String(error),
          });
          new Notice(`Created standalone task note ${record.path}, but it could not be opened automatically.`);
        }
        return record.file;
      } catch (error) {
        logger.flowError('CreateTask', 'standalone-task:create-failed', error);
        if (error instanceof Error && /checkbox mapping changed/iu.test(error.message)) {
          new Notice('The selected task checkbox is no longer configured.');
        } else {
          new Notice('Unable to create the standalone task note. Check console logs.');
        }
        return null;
      }
    }

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
      const nativeTaskIdentity = nativeRecordModeEnabled
        ? String(historyHandle?.entityId || '').trim() || this.plugin.identityService.createInternalId()
        : '';
      let mappingChanged = false;
      let modeChanged = false;
      let writeAccepted = false;
      let historyReady = true;
      let insertedTaskLine = stampedTaskLine;
      let insertedLineNumber = 0;
      await this.plugin.app.vault.process(targetFile, (content) => {
        if ((this.plugin.nativeRecordService?.isEnabled() === true) !== nativeRecordModeEnabled) {
          modeChanged = true;
          return content;
        }
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
        if (nativeRecordModeEnabled && !getTaskHistoryIdentity(insertedTaskLine)) {
          insertedTaskLine = ensureTaskHistoryIdentity(insertedTaskLine, nativeTaskIdentity);
        }
        historyReady = historyReady && historyIdentity.ready;
        const trimmedContent = String(content || '').replace(/\s+$/gu, '');
        insertedLineNumber = trimmedContent ? trimmedContent.split(/\r?\n/u).length : 0;
        return insertLineAfterFrontmatter(content, insertedTaskLine);
      });
      if (modeChanged) {
        await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
        historySettled = true;
        logger.flowWarn('CreateTask', 'write:mode-changed', {
          expected: nativeRecordModeEnabled ? 'native-records' : 'legacy',
          current: this.plugin.nativeRecordService?.isEnabled() === true ? 'native-records' : 'legacy',
          targetPath: targetFile.path,
        });
        new Notice('Task creation mode changed while this dialog was open. Reopen Create task and try again.');
        return null;
      }
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
      if (nativeRecordModeEnabled) {
        const promotion = await this.plugin.nativeRecordService.promoteTask({
          path: targetFile.path,
          lineNumber: insertedLineNumber,
          rawLine: insertedTaskLine,
        }, {
          kind: 'user',
          sourcePluginId: 'tps-global-context-menu',
          surface: 'create-task-modal:native-task-record',
        });
        if (promotion.ok && promotion.record) {
          try {
            await this.plugin.openFileInLeaf(
              promotion.record.file,
              false,
              () => this.plugin.app.workspace.getLeaf(false),
              { revealLeaf: true },
            );
            new Notice(`Created task note ${promotion.record.path}`);
          } catch (error) {
            logger.flowWarn('CreateTask', 'native-task:open-failed', {
              recordPath: promotion.record.path,
              error: error instanceof Error ? error.message : String(error),
            });
            new Notice(`Created task note ${promotion.record.path}, but it could not be opened automatically.`);
          }
          return promotion.record.file;
        }
        logger.flowWarn('CreateTask', 'native-task:promotion-failed', {
          path: targetFile.path,
          lineNumber: insertedLineNumber + 1,
          error: promotion.error || 'unknown',
        });
        if (promotion.record) {
          new Notice(`Task note ${promotion.record.path} was created, but its stable link could not be written. The task checkbox was preserved for recovery: ${promotion.error || 'unknown error'}`);
        } else {
          new Notice(`The task checkbox was preserved for recovery, but task-note creation could not be completed: ${promotion.error || 'unknown error'}`);
        }
        return null;
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
