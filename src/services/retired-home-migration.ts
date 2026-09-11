import { type App, Notice, TFile, type ViewState, type WorkspaceLeaf } from 'obsidian';
import * as logger from '../logger';

// Only persisted settings owned by the removed dashboard are retired.
export const RETIRED_HOME_SETTING_KEYS = [
  'enableDailyNoteHome', 'homeComponents', 'homeComponentLayouts', 'homeComponentActions',
  'homeCalendarBasePath', 'homeFoodBasePath', 'homeWorkoutBasePath', 'homeOpenTasksBasePath',
  'homeCaptureInsertPosition', 'homeCaptureAddHeading', 'homeCaptureHeading',
] as const;

export function retiredHomeReplacement(state: ViewState, hasMarkdownFile: (path: string) => boolean): ViewState | null {
  if (state.type !== 'tps-home') return null;
  const path = typeof state.state?.dailyNotePath === 'string' ? state.state.dailyNotePath : '';
  const { icon: _icon, title: _title, ...rest } = state as ViewState & { icon?: string; title?: string };
  return path && hasMarkdownFile(path)
    ? { ...rest, type: 'markdown', state: { file: path, mode: 'preview' } }
    : { ...rest, type: 'empty', state: {} };
}

/** One pass after restoration; no view registration, file creation, or ongoing interception. */
export async function restoreRetiredHomeTabs(app: App, isActive: () => boolean = () => true): Promise<void> {
  const leaves: WorkspaceLeaf[] = [];
  app.workspace.iterateAllLeaves((leaf) => { leaves.push(leaf); });
  let restored = 0;
  let unavailable = 0;
  let failed = 0;
  for (const leaf of leaves) {
    if (!isActive()) return;
    // Read at execution time: a prior tab restoration can yield to user navigation.
    const state = leaf.getViewState();
    const next = retiredHomeReplacement(state, (path) => {
      const file = app.vault.getAbstractFileByPath(path);
      return file instanceof TFile && file.extension.toLowerCase() === 'md';
    });
    if (!next) continue;
    try {
      await leaf.setViewState(next);
      restored += 1;
      if (state.state?.dailyNotePath && next.type === 'empty') unavailable += 1;
    } catch (error) {
      failed += 1;
      logger.flowError('RetiredHome', 'tab-restore-failed', error);
    }
  }
  if (restored || failed) logger.flow('RetiredHome', 'tabs-restored', { restored, unavailable, failed });
  if (unavailable || failed) {
    new Notice('TPS Home was removed. Some previous Home tabs could not reopen a backing note. Open those notes from your file browser; no files were changed.', 10000);
  }
}
