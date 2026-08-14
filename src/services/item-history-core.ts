import {
  parseTaskLine,
  parseTaskTagValues,
  readInlineFieldValue,
  readTaskInlineFields,
  readTaskLineTags,
  setInlineFieldValueOnTaskLine,
} from '../utils/task-line-metadata';

export type ItemHistoryEntityKind = 'task' | 'note';
export type ItemHistoryTaskAction =
  | 'task.create'
  | 'task.update'
  | 'task.checkbox'
  | 'task.move'
  | 'task.migrate'
  | 'task.delete';

export interface ItemHistoryUserCause {
  kind: 'user';
  sourcePluginId: string;
  surface: string;
  commandId?: string;
  interactionId?: string;
}

export interface ItemHistoryLocator {
  path: string;
  lineNumber: number;
}

export type ItemHistoryValueState =
  | { state: 'absent' }
  | { state: 'empty' }
  | { state: 'value'; value: string | string[] };

export interface ItemHistoryChange {
  field: string;
  before: ItemHistoryValueState;
  after: ItemHistoryValueState;
}

export interface ItemHistoryTaskSnapshot {
  checkbox: string;
  fields: Record<string, string>;
  tags: string[];
}

export interface ItemHistoryPendingRecord {
  schemaVersion: 1;
  operationId: string;
  entityId: string;
  entityKind: 'task';
  action: ItemHistoryTaskAction;
  cause: ItemHistoryUserCause;
  locatorBefore: ItemHistoryLocator;
  targetPath?: string;
  before: ItemHistoryTaskSnapshot;
  identityWasPresent: boolean;
  startedAt: number;
}

export interface ItemHistoryEvent {
  schemaVersion: 1;
  eventId: string;
  operationId: string;
  entityId: string;
  entityKind: 'task';
  action: ItemHistoryTaskAction;
  occurredAt: number;
  committedAt: number;
  cause: ItemHistoryUserCause;
  changes: ItemHistoryChange[];
  locatorBefore: ItemHistoryLocator;
  locatorAfter?: ItemHistoryLocator;
  sourceDisposition?: 'removed' | 'migrated' | 'retained';
  outcome: 'committed' | 'partial';
}

export interface ItemHistoryEntityRecord {
  entityId: string;
  entityKind: 'task';
  currentLocator?: ItemHistoryLocator;
  deletedAt?: number;
  lastSeenAt: number;
}

export interface ItemHistoryTaskMutationHandle {
  operationId: string;
  entityId: string;
  action: ItemHistoryTaskAction;
  cause: ItemHistoryUserCause;
  before: ItemHistoryTaskSnapshot;
  locatorBefore: ItemHistoryLocator;
  targetPath?: string;
  identityWasPresent: boolean;
  startedAt: number;
}

const SAFE_TASK_FIELD_KEYS = new Map<string, string>([
  ['priority', 'priority'],
  ['status', 'status'],
  ['tag', 'tags'],
  ['tags', 'tags'],
]);
const TASK_IDENTITY_FIELD_KEYS = new Set(['tpsid', 'subitemid']);
const SAFE_TASK_IDENTITY_RE = /^[A-Za-z0-9_-]{1,160}$/u;
const SAFE_CAUSE_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const SAFE_CAUSE_COMMAND_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._/:-]*$/u;

export function normalizeItemHistoryCause(cause: ItemHistoryUserCause | null | undefined): ItemHistoryUserCause | null {
  if (cause?.kind !== 'user') return null;
  const sourcePluginId = normalizeCauseToken(cause.sourcePluginId, 100, false);
  const surface = normalizeCauseToken(cause.surface, 120, false);
  if (!sourcePluginId || !surface) return null;
  const commandId = normalizeCauseToken(cause.commandId, 120, true);
  const interactionId = normalizeCauseToken(cause.interactionId, 160, true);
  return {
    kind: 'user',
    sourcePluginId,
    surface,
    ...(commandId ? { commandId } : {}),
    ...(interactionId ? { interactionId } : {}),
  };
}

export function getTaskHistoryIdentity(line: string): string {
  const tpsId = normalizeTaskHistoryIdentity(readInlineFieldValue(line, 'tpsId'));
  if (tpsId) return tpsId;
  return normalizeTaskHistoryIdentity(readInlineFieldValue(line, 'subitemId'));
}

export function ensureTaskHistoryIdentity(line: string, entityId: string): string {
  const expected = normalizeTaskHistoryIdentity(entityId);
  if (!expected) throw new Error('Task history identity is missing.');

  const liveIdentities = readTaskInlineFields(line)
    .filter((field) => TASK_IDENTITY_FIELD_KEYS.has(String(field.key || '').trim().toLowerCase()))
    .map((field) => String(field.value || '').trim());
  if (liveIdentities.some((identity) => normalizeTaskHistoryIdentity(identity) !== expected)) {
    throw new Error('Task history identity changed before the mutation was written.');
  }

  const tpsId = readInlineFieldValue(line, 'tpsId').trim();
  if (tpsId) return line;
  return setInlineFieldValueOnTaskLine(line, 'tpsId', expected);
}

export function snapshotTaskForHistory(
  line: string,
  configuredAliases: ReadonlyMap<string, 'status' | 'priority' | 'tags'> = SAFE_TASK_FIELD_KEYS as ReadonlyMap<string, 'status' | 'priority' | 'tags'>,
): ItemHistoryTaskSnapshot | null {
  const parsed = parseTaskLine(line);
  if (!parsed) return null;
  const safeAliases = new Map<string, 'status' | 'priority' | 'tags'>([
    ['priority', 'priority'],
    ['status', 'status'],
    ['tag', 'tags'],
    ['tags', 'tags'],
  ]);
  for (const [key, value] of configuredAliases) {
    const normalized = String(key || '').trim().toLowerCase();
    if (normalized && (value === 'status' || value === 'priority' || value === 'tags')) {
      safeAliases.set(normalized, value);
    }
  }
  const fields: Record<string, string> = {};
  for (const field of readTaskInlineFields(line)) {
    const normalized = String(field.key || '').trim().toLowerCase();
    const safeKey = safeAliases.get(normalized);
    if (!safeKey || safeKey === 'tags' || Object.prototype.hasOwnProperty.call(fields, safeKey)) continue;
    fields[safeKey] = sanitizeHistoryValue(field.value);
  }
  const rawTagFields = readTaskInlineFields(line)
    .filter((field) => safeAliases.get(String(field.key || '').trim().toLowerCase()) === 'tags');
  const protectedTagValues = new Set(
    rawTagFields
      .map((field) => sanitizeHistoryValue(field.value))
      .filter((value) => /^\[redacted-(?:link|url)\]$/u.test(value)),
  );
  if (/(?:^|\s)#(?:[a-z][a-z0-9+.-]*:(?:\/\/)?[^\s]+|www(?:\d{0,3})?\.[^\s]+)/iu.test(line)) {
    protectedTagValues.add('[redacted-url]');
  }
  return {
    checkbox: parsed.token,
    fields,
    tags: protectedTagValues.size > 0
      ? [...protectedTagValues]
      : [...new Set([
          ...readTaskLineTags(line),
          ...rawTagFields.flatMap((field) => parseTaskTagValues(field.value)),
        ])].slice(0, 50).map((tag) => sanitizeHistoryValue(tag)),
  };
}

export function diffTaskHistorySnapshots(
  before: ItemHistoryTaskSnapshot | null | undefined,
  after: ItemHistoryTaskSnapshot | null | undefined,
): ItemHistoryChange[] {
  const changes: ItemHistoryChange[] = [];
  pushChange(changes, 'checkbox', scalarState(before?.checkbox), scalarState(after?.checkbox));
  pushChange(changes, 'tags', listState(before?.tags), listState(after?.tags));

  const beforeFields = foldFields(before?.fields);
  const afterFields = foldFields(after?.fields);
  const keys = new Set([...beforeFields.keys(), ...afterFields.keys()]);
  for (const foldedKey of [...keys].sort()) {
    const previous = beforeFields.get(foldedKey);
    const next = afterFields.get(foldedKey);
    pushChange(
      changes,
      next?.key || previous?.key || foldedKey,
      previous ? scalarState(previous.value) : { state: 'absent' },
      next ? scalarState(next.value) : { state: 'absent' },
    );
  }
  return changes;
}

function foldFields(fields: Record<string, string> | null | undefined): Map<string, { key: string; value: string }> {
  const result = new Map<string, { key: string; value: string }>();
  for (const [key, value] of Object.entries(fields || {})) {
    const folded = key.trim().toLowerCase();
    if (folded && !result.has(folded)) result.set(folded, { key: key.trim(), value });
  }
  return result;
}

function scalarState(value: string | null | undefined): ItemHistoryValueState {
  if (value == null) return { state: 'absent' };
  const sanitized = sanitizeHistoryValue(value);
  return sanitized ? { state: 'value', value: sanitized } : { state: 'empty' };
}

function listState(values: string[] | null | undefined): ItemHistoryValueState {
  if (values == null) return { state: 'absent' };
  const sanitized = values.map((value) => sanitizeHistoryValue(value)).filter(Boolean);
  return sanitized.length ? { state: 'value', value: sanitized } : { state: 'empty' };
}

function pushChange(
  target: ItemHistoryChange[],
  field: string,
  before: ItemHistoryValueState,
  after: ItemHistoryValueState,
): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  target.push({ field: clipText(field, 120), before, after });
}

function sanitizeHistoryValue(value: unknown): string {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!text) return '';
  if (isUnsafeHistoryValue(text)) return '[redacted-url]';
  if (/\[\[[^\]]+\]\]/u.test(text) || /\[[^\]]*\]\([^)]+\)/u.test(text)) return '[redacted-link]';
  return clipText(text, 240);
}

function isUnsafeHistoryValue(value: unknown): boolean {
  const text = String(value ?? '').trim();
  return /\b[a-z][a-z0-9+.-]*:(?:\/\/)?[^\s]+/iu.test(text)
    || /(?:^|[\s("'])\/\/[^\s]+/u.test(text)
    || /\bwww(?:\d{0,3})?\.[^\s]+/iu.test(text)
    || /\b(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?(?:[/?#][^\s]*)?/iu.test(text)
    || /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#][^\s]*)?/u.test(text);
}

function clipText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

function normalizeTaskHistoryIdentity(value: unknown): string {
  const identity = String(value ?? '').trim();
  return SAFE_TASK_IDENTITY_RE.test(identity) ? identity : '';
}

function normalizeCauseToken(value: unknown, maxLength: number, allowColon: boolean): string {
  const token = String(value ?? '').trim();
  if (!token || token.length > maxLength || /\s/u.test(token)) return '';
  if (/\bwww(?:\d{0,3})?\./iu.test(token) || /:\/\//u.test(token)) return '';
  if (/^(?:data|file|ftp|https?|javascript|mailto|obsidian|tel):/iu.test(token)) return '';
  const pattern = allowColon ? SAFE_CAUSE_COMMAND_TOKEN_RE : SAFE_CAUSE_TOKEN_RE;
  return pattern.test(token) ? token : '';
}
