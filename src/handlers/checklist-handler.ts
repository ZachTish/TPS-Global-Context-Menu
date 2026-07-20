import { App, TFile } from 'obsidian';
import { ChecklistPromptModal } from '../modals/checklist-prompt-modal';
import * as logger from '../logger';

const RECENT_COMPLETION_PROMPT_WINDOW_MS = 4_000;
const recentCompletionPrompts = new Map<string, number>();

export function markChecklistCompletionPromptHandled(fileOrPath: TFile | string): void {
  const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
  if (!path) return;
  recentCompletionPrompts.set(path, Date.now());
}

export function wasChecklistCompletionPromptRecentlyHandled(fileOrPath: TFile | string): boolean {
  const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
  if (!path) return false;
  const timestamp = recentCompletionPrompts.get(path) || 0;
  if (!timestamp) return false;
  if (Date.now() - timestamp <= RECENT_COMPLETION_PROMPT_WINDOW_MS) return true;
  recentCompletionPrompts.delete(path);
  return false;
}

export class ChecklistHandler {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Scan a file for incomplete checklist items
   */
  async scanChecklistItems(file: TFile): Promise<{ ok: true; items: string[] } | { ok: false; items: [] }> {
    try {
      const content = await this.app.vault.read(file);
      const lines = content.split('\n');
      const incompleteItems: string[] = [];

      const regex = /^\s*[-*+]\s*\[ \]\s*(.*)$/;

      for (const line of lines) {
        const match = line.match(regex);
        if (match) {
          incompleteItems.push(match[1].trim());
        }
      }
      return { ok: true, items: incompleteItems };
    } catch (error) {
      logger.error(`[TPS GCM] Failed to scan checklist items for ${file.path}:`, error);
      return { ok: false, items: [] };
    }
  }

  /**
   * Update checklist items in a file based on action
   */
  async updateChecklistItems(file: TFile, action: 'complete' | 'canceled'): Promise<boolean> {
    try {
      await this.app.vault.process(file, (content) => action === 'complete'
        ? content.replace(/^(\s*[-*+]\s*)\[ \]/gm, '$1[x]')
        : content.replace(/^(\s*[-*+]\s*)\[ \]/gm, '$1[-]'));
      return true;
    } catch (error) {
      logger.error(`[TPS GCM] Failed to update checklist items for ${file.path}:`, error);
      return false;
    }
  }

  /**
   * Prompt user about incomplete checklist items before completing a task.
   * Returns true if the status change should proceed, false to abort.
   */
  async handleChecklistCompletion(file: TFile): Promise<boolean> {
    const scan = await this.scanChecklistItems(file);
    if (!scan.ok) return false;
    markChecklistCompletionPromptHandled(file);
    const incompleteItems = scan.items;

    if (incompleteItems.length === 0) {
      return true;
    }

    const userAction = await new Promise<string>((resolve) => {
      new ChecklistPromptModal(this.app, incompleteItems, (result) => {
        resolve(result);
      }).open();
    });

    if (userAction === 'cancel') {
      return false;
    }

    if (userAction === 'open') {
      const leaf = this.app.workspace.getLeaf(false);
      if (leaf) {
        await leaf.openFile(file);
      }
      return false;
    }

    if (userAction === 'complete') {
      if (!(await this.updateChecklistItems(file, 'complete'))) return false;
    } else if (userAction === 'canceled') {
      if (!(await this.updateChecklistItems(file, 'canceled'))) return false;
    }
    // 'ignore' falls through to set status
    return true;
  }
}
