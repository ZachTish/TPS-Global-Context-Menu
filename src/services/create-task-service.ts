import { Notice, TFile, moment, normalizePath } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { CreateTaskModal, type CreateTaskModalResult } from '../modals/create-task-modal';
import { insertLineAfterFrontmatter, updateTaskLineTimestamps } from '../utils/task-line-metadata';
import * as logger from '../logger';

export class CreateTaskService {
  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  openCreateTaskModal(): void {
    const defaultTarget = this.getTodayDailyNoteIfExists();
    const defaultLabel = defaultTarget?.path || this.getTodayDailyNotePathLabel();
    new CreateTaskModal(this.plugin.app, {
      defaultTargetFile: defaultTarget,
      defaultTargetLabel: defaultLabel,
      defaultTimeEstimate: 30,
      onSubmit: async (result) => {
        await this.createTask(result);
      },
    }).open();
  }

  async createTask(result: CreateTaskModalResult): Promise<TFile | null> {
    const taskLine = String(result.taskLine || '').trim();
    if (!taskLine) {
      new Notice('Task title is required.');
      return null;
    }

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
      await this.plugin.app.vault.process(targetFile, (content) => insertLineAfterFrontmatter(content, stampedTaskLine));
      new Notice(`Created task in ${targetFile.basename}`);
      await this.focusLineBeforeInsertedTask(targetFile, stampedTaskLine);
      return targetFile;
    } catch (error) {
      logger.error('[TPS GCM] Failed to create task', error);
      new Notice('Unable to create task. Check console logs.');
      return null;
    }
  }

  private async ensureTodayDailyNote(): Promise<TFile | null> {
    const dateStr = this.getTodayDailyNoteDateString();
    return await this.plugin.noteOperationService.ensureDailyNote(dateStr);
  }

  private getTodayDailyNoteIfExists(): TFile | null {
    const path = this.getTodayDailyNotePathLabel();
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  private getTodayDailyNotePathLabel(): string {
    const folder = this.getDailyNoteFolder();
    return normalizePath(`${folder}/${this.getTodayDailyNoteDateString()}.md`);
  }

  private getTodayDailyNoteDateString(): string {
    const format = this.plugin.fileNamingService.getDailyNoteDateFormat();
    const momentLib = (window as any).moment || (moment as any);
    return momentLib().format(format || 'YYYY-MM-DD');
  }

  private getDailyNoteFolder(): string {
    try {
      const dailyNotesPlugin = (this.plugin.app as any).internalPlugins?.plugins?.['daily-notes'];
      const folder = String(dailyNotesPlugin?.instance?.options?.folder || '').trim();
      if (folder) return folder;
    } catch (error) {
      logger.warn('[TPS GCM] Failed to resolve Daily Notes folder for Create task', error);
    }
    return 'System/Dailynotes';
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
