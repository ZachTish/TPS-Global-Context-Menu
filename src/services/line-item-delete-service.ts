import { App, Notice, TFile } from 'obsidian';
import { promptNestedLineDelete } from '../modals/nested-line-delete-modal';
import * as logger from '../logger';
import {
  deleteLineItemAtIndex,
  extractLineItemDeleteBlock,
  resolveExactLineRevisionIndex,
  splitLineItemContent,
  type LineItemDeleteBlockKind,
  type LineItemDeleteMode,
} from '../utils/line-item-deletion';
import { parseTaskLine } from '../utils/task-line-metadata';
import {
  abortDirectTaskHistory,
  beginDirectTaskHistory,
  commitDirectTaskHistory,
  ensureDirectTaskHistoryIdentity,
  type DirectTaskHistoryCause,
  type DirectTaskHistoryLocation,
  type DirectTaskHistoryLogContext,
  type DirectTaskHistoryService,
} from '../utils/direct-task-history';

export interface LineItemDeleteTaskHistory {
  service: DirectTaskHistoryService;
  cause: DirectTaskHistoryCause;
}

export interface LineItemDeleteTarget {
  app: App;
  file: TFile;
  lineIndex: number;
  rawLine: string;
  itemLabel: string;
  source: string;
  blockKind?: LineItemDeleteBlockKind;
  resolveLineIndex?: (lines: string[]) => number;
  taskHistory?: LineItemDeleteTaskHistory;
  onDeleted?: (details: { mode: LineItemDeleteMode; nestedContentLineCount: number }) => void | Promise<void>;
}

export interface LineItemDeleteInspection {
  lineIndex: number;
  nestedLineCount: number;
  nestedContentLineCount: number;
}

export interface LineItemDeleteResult {
  outcome: 'deleted' | 'cancelled' | 'stale' | 'nested-changed' | 'failed';
  mode: LineItemDeleteMode | null;
  nestedContentLineCount: number;
}

export async function inspectLineItemDeleteTarget(
  target: LineItemDeleteTarget,
): Promise<LineItemDeleteInspection | null> {
  const content = await target.app.vault.cachedRead(target.file);
  const lines = splitLineItemContent(content).lines;
  const lineIndex = resolveTargetLineIndex(target, lines);
  if (lineIndex < 0) return null;
  const block = extractLineItemDeleteBlock(lines, lineIndex, target.blockKind);
  if (!block.lines.length) return null;
  return {
    lineIndex,
    nestedLineCount: block.nestedLineCount,
    nestedContentLineCount: block.nestedContentLineCount,
  };
}

export async function requestLineItemDelete(
  target: LineItemDeleteTarget,
  options: { showNotices?: boolean } = {},
): Promise<LineItemDeleteResult> {
  let inspection: LineItemDeleteInspection | null = null;
  try {
    inspection = await inspectLineItemDeleteTarget(target);
  } catch (error) {
    logger.flowError('LineItemDelete', 'inspect:failed', error, targetLogContext(target));
    if (options.showNotices !== false) new Notice(`Could not inspect the ${target.itemLabel} before deleting it.`);
    return { outcome: 'failed', mode: null, nestedContentLineCount: 0 };
  }
  if (!inspection) {
    logger.flowWarn('LineItemDelete', 'inspect:stale-target', targetLogContext(target));
    if (options.showNotices !== false) new Notice(`That ${target.itemLabel} changed before it could be deleted. Refresh and try again.`);
    return { outcome: 'stale', mode: null, nestedContentLineCount: 0 };
  }

  let mode: LineItemDeleteMode = 'delete-subtree';
  if (inspection.nestedContentLineCount > 0) {
    logger.flow('LineItemDelete', 'choice:open', {
      ...targetLogContext(target),
      nestedContentLineCount: inspection.nestedContentLineCount,
    });
    const choice = await promptNestedLineDelete(target.app, {
      itemLabel: target.itemLabel,
      nestedContentLineCount: inspection.nestedContentLineCount,
      preserveNestedContentLabel: target.blockKind === 'heading-section' ? 'Delete heading only' : undefined,
    });
    if (!choice) {
      logger.flow('LineItemDelete', 'choice:cancelled', targetLogContext(target));
      return {
        outcome: 'cancelled',
        mode: null,
        nestedContentLineCount: inspection.nestedContentLineCount,
      };
    }
    mode = choice;
  }

  return performLineItemDelete(target, mode, {
    refuseUnexpectedNestedContent: inspection.nestedContentLineCount === 0,
    showNotices: options.showNotices,
  });
}

export async function performLineItemDelete(
  target: LineItemDeleteTarget,
  mode: LineItemDeleteMode,
  options: { refuseUnexpectedNestedContent?: boolean; showNotices?: boolean } = {},
): Promise<LineItemDeleteResult> {
  const mutationState: { outcome: LineItemDeleteResult['outcome'] } = { outcome: 'stale' };
  let nestedContentLineCount = 0;
  let historyReady = true;
  let confirmedHistoryBefore: DirectTaskHistoryLocation | undefined;
  const historyService = target.taskHistory?.service;
  const historyContext: DirectTaskHistoryLogContext = {
    action: 'task.delete',
    surface: target.taskHistory?.cause.surface || 'delete',
    path: target.file.path,
    lineNumber: target.lineIndex,
  };
  const historyHandle = target.taskHistory && parseTaskLine(target.rawLine)
    ? await beginDirectTaskHistory(historyService, {
        action: historyContext.action,
        cause: target.taskHistory.cause,
        before: {
          path: target.file.path,
          lineNumber: target.lineIndex,
          rawLine: target.rawLine,
        },
      })
    : null;
  try {
    await target.app.vault.process(target.file, (content) => {
      const lines = splitLineItemContent(content).lines;
      const lineIndex = resolveTargetLineIndex(target, lines);
      if (lineIndex < 0) {
        mutationState.outcome = 'stale';
        return content;
      }
      const block = extractLineItemDeleteBlock(lines, lineIndex, target.blockKind);
      if (!block.lines.length) {
        mutationState.outcome = 'stale';
        return content;
      }
      nestedContentLineCount = block.nestedContentLineCount;
      if (options.refuseUnexpectedNestedContent && nestedContentLineCount > 0) {
        mutationState.outcome = 'nested-changed';
        return content;
      }
      if (historyHandle) {
        const currentLine = lines[lineIndex] || '';
        if (!parseTaskLine(currentLine)) {
          historyReady = false;
        } else {
          confirmedHistoryBefore = {
            path: target.file.path,
            lineNumber: lineIndex,
            rawLine: currentLine,
          };
          const ensured = ensureDirectTaskHistoryIdentity(
            historyService,
            historyHandle,
            currentLine,
            historyContext,
          );
          historyReady = ensured.ready;
          historyContext.lineNumber = lineIndex;
        }
      }
      const mutation = deleteLineItemAtIndex(content, lineIndex, mode, target.blockKind);
      if (!mutation.changed) {
        mutationState.outcome = 'stale';
        return content;
      }
      mutationState.outcome = 'deleted';
      return mutation.content;
    });
  } catch (error) {
    await abortDirectTaskHistory(historyService, historyHandle, historyContext);
    logger.flowError('LineItemDelete', 'mutation:failed', error, {
      ...targetLogContext(target),
      mode,
    });
    if (options.showNotices !== false) new Notice(`Could not delete the ${target.itemLabel}.`);
    return { outcome: 'failed', mode, nestedContentLineCount };
  }

  const outcome = mutationState.outcome;
  if (outcome === 'deleted') {
    if (historyReady) {
      await commitDirectTaskHistory(historyService, historyHandle, {
        ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
        sourceDisposition: 'removed',
        outcome: 'committed',
      }, historyContext);
    } else {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
    }
    try {
      await target.onDeleted?.({ mode, nestedContentLineCount });
    } catch (error) {
      logger.flowError('LineItemDelete', 'post-delete:failed', error, {
        ...targetLogContext(target),
        mode,
      });
    }
    logger.flow('LineItemDelete', 'mutation:done', {
      ...targetLogContext(target),
      mode,
      nestedContentLineCount,
    });
    if (options.showNotices !== false) {
      new Notice(mode === 'promote-children'
        ? target.blockKind === 'heading-section'
          ? `Deleted ${target.itemLabel}; kept nested content.`
          : `Deleted ${target.itemLabel}; moved nested content up one level.`
        : `Deleted ${target.itemLabel}${nestedContentLineCount > 0 ? ' and nested content' : ''}.`);
    }
  } else if (outcome === 'nested-changed') {
    await abortDirectTaskHistory(historyService, historyHandle, historyContext);
    logger.flowWarn('LineItemDelete', 'mutation:nested-content-appeared', {
      ...targetLogContext(target),
      nestedContentLineCount,
    });
    if (options.showNotices !== false) {
      new Notice(`Nested content appeared under that ${target.itemLabel}. Delete it again to choose how to handle the nested content.`);
    }
  } else {
    await abortDirectTaskHistory(historyService, historyHandle, historyContext);
    logger.flowWarn('LineItemDelete', 'mutation:stale-target', targetLogContext(target));
    if (options.showNotices !== false) {
      new Notice(`That ${target.itemLabel} changed before it could be deleted. Refresh and try again.`);
    }
  }

  return { outcome, mode, nestedContentLineCount };
}

function resolveTargetLineIndex(target: LineItemDeleteTarget, lines: string[]): number {
  return target.resolveLineIndex
    ? target.resolveLineIndex(lines)
    : resolveExactLineRevisionIndex(lines, target.lineIndex, target.rawLine);
}

function targetLogContext(target: LineItemDeleteTarget): Record<string, unknown> {
  return {
    source: target.source,
    path: target.file.path,
    renderedLineNumber: target.lineIndex + 1,
    itemLabel: target.itemLabel,
    blockKind: target.blockKind || 'indented',
  };
}
