import * as logger from '../logger';

export type DirectTaskHistoryAction =
  | 'task.update'
  | 'task.checkbox'
  | 'task.move'
  | 'task.migrate'
  | 'task.delete'
  | 'task.create';

export interface DirectTaskHistoryCause {
  kind: 'user';
  sourcePluginId: 'tps-global-context-menu';
  surface: string;
  commandId?: string;
}

export interface DirectTaskHistoryLocation {
  path: string;
  lineNumber: number;
  rawLine: string;
}

export interface DirectTaskHistoryBeginInput {
  action: DirectTaskHistoryAction;
  cause: DirectTaskHistoryCause;
  before: DirectTaskHistoryLocation;
  targetPath?: string;
}

export interface DirectTaskHistoryCommitInput {
  confirmedBefore?: DirectTaskHistoryLocation;
  after?: DirectTaskHistoryLocation;
  sourceDisposition?: 'removed' | 'migrated' | 'retained';
  outcome?: 'committed' | 'partial';
}

export interface DirectTaskHistoryLogContext extends Record<string, unknown> {
  action: DirectTaskHistoryAction;
  surface: string;
  path: string;
  lineNumber: number;
}

export type DirectTaskHistoryHandle = any;
export type DirectTaskHistoryService = any;

export async function beginDirectTaskHistory(
  service: DirectTaskHistoryService,
  input: DirectTaskHistoryBeginInput,
): Promise<DirectTaskHistoryHandle | null> {
  if (typeof service?.beginTaskMutation !== 'function') return null;
  try {
    return await service.beginTaskMutation(input) ?? null;
  } catch (error) {
    logger.flowError('ItemHistory', 'direct-mutation:begin-failed', error, toSafeLogContext(input));
    return null;
  }
}

export function ensureDirectTaskHistoryIdentity(
  service: DirectTaskHistoryService,
  handle: DirectTaskHistoryHandle | null,
  line: string,
  context: DirectTaskHistoryLogContext,
): { line: string; ready: boolean } {
  if (!handle) return { line, ready: true };
  if (typeof service?.ensureTaskIdentity !== 'function') return { line, ready: false };
  try {
    const ensured = service.ensureTaskIdentity(handle, line);
    return { line: typeof ensured === 'string' ? ensured : line, ready: typeof ensured === 'string' };
  } catch (error) {
    logger.flowError('ItemHistory', 'direct-mutation:identity-failed', error, context);
    return { line, ready: false };
  }
}

export async function commitDirectTaskHistory(
  service: DirectTaskHistoryService,
  handle: DirectTaskHistoryHandle | null,
  input: DirectTaskHistoryCommitInput,
  context: DirectTaskHistoryLogContext,
): Promise<void> {
  if (!handle) return;
  try {
    if (typeof service?.commitTaskMutation !== 'function') throw new Error('Item history commit is unavailable.');
    await service.commitTaskMutation(handle, input);
  } catch (error) {
    logger.flowError('ItemHistory', 'direct-mutation:commit-failed', error, context);
    await abortDirectTaskHistory(service, handle, context);
  }
}

export async function abortDirectTaskHistory(
  service: DirectTaskHistoryService,
  handle: DirectTaskHistoryHandle | null,
  context: DirectTaskHistoryLogContext,
): Promise<void> {
  if (!handle || typeof service?.abortTaskMutation !== 'function') return;
  try {
    await service.abortTaskMutation(handle);
  } catch (error) {
    logger.flowError('ItemHistory', 'direct-mutation:abort-failed', error, context);
  }
}

function toSafeLogContext(input: DirectTaskHistoryBeginInput): DirectTaskHistoryLogContext {
  return {
    action: input.action,
    surface: input.cause.surface,
    path: input.before.path,
    lineNumber: input.before.lineNumber,
  };
}
