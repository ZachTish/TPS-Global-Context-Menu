import { RRule } from 'rrule';
import {
  readInlineFieldValue,
  setInlineFieldValueOnTaskLine,
  setTaskCheckboxToken,
  stripTaskInlinePropsMetadata,
} from './task-line-metadata';
import {
  normalizeLinkedSubitemCheckboxMarker,
  normalizeLinkedSubitemCheckboxState,
} from './linked-subitem-mapping';

export const TASK_RECURRENCE_AFTER_COMPLETION_PREFIX = 'GCM-AFTER-COMPLETION:';
export const TASK_RECURRENCE_ID_KEY = 'recurrenceTaskId';
export const TASK_RECURRENCE_COMPLETED_DATE_KEY = 'completedDate';
const TASK_RECURRENCE_INSTANCE_ONLY_KEYS = [
  TASK_RECURRENCE_COMPLETED_DATE_KEY,
  'tpsId',
  'subitemId',
  'child',
  'childOf',
  'linkedSubitem',
  'linkedSubitemPath',
  'parentPath',
  'icon',
  'iconColor',
  'color',
  'sort',
  'sortKey',
  'hidden',
];

export type TaskRecurrenceRule =
  | { kind: 'after-completion'; durationMs: number; duration: string }
  | { kind: 'rrule'; rule: string };

export function parseTaskRecurrenceRule(rawRule: string): TaskRecurrenceRule | null {
  const rule = String(rawRule || '').trim();
  if (!rule) return null;
  const upper = rule.toUpperCase();
  if (upper.startsWith(TASK_RECURRENCE_AFTER_COMPLETION_PREFIX)) {
    const duration = rule.slice(TASK_RECURRENCE_AFTER_COMPLETION_PREFIX.length).trim();
    const durationMs = parseIsoDurationToMs(duration);
    return durationMs > 0 ? { kind: 'after-completion', durationMs, duration } : null;
  }
  return { kind: 'rrule', rule };
}

export function isAfterCompletionRecurrenceRule(rawRule: string): boolean {
  return parseTaskRecurrenceRule(rawRule)?.kind === 'after-completion';
}

export function formatAfterCompletionRule(duration: string): string {
  return `${TASK_RECURRENCE_AFTER_COMPLETION_PREFIX}${String(duration || '').trim().toUpperCase()}`;
}

export function calculateNextTaskScheduledValue(rawRule: string, options: {
  scheduledValue?: string;
  completedAt: Date;
}): string | null {
  const parsed = parseTaskRecurrenceRule(rawRule);
  if (!parsed) return null;

  if (parsed.kind === 'after-completion') {
    return formatTaskScheduledDate(new Date(options.completedAt.getTime() + parsed.durationMs));
  }

  const seed = parseTaskDate(options.scheduledValue || '') || options.completedAt;
  try {
    const normalizedRule = parsed.rule.replace(/^RRULE:/i, '');
    const ruleOptions = RRule.parseString(normalizedRule);
    ruleOptions.dtstart = seed;
    const rule = new RRule(ruleOptions);
    const next = rule.after(seed, false);
    return next ? formatTaskScheduledDate(next) : null;
  } catch (_error) {
    return null;
  }
}

export function buildTaskRecurrenceTemplateLine(
  rawLine: string,
  checkboxState: string,
  statusKey = 'status',
): string {
  const normalizedCheckboxState = requireTaskRecurrenceCheckboxState(checkboxState);
  let line = setTaskCheckboxToken(rawLine, normalizedCheckboxState);
  line = setInlineFieldValueOnTaskLine(line, statusKey, null);
  line = stripTaskRecurrenceInstanceFields(line);
  return line;
}

export function buildNextTaskRecurrenceLine(
  templateLine: string,
  scheduledValue: string,
  checkboxState: string,
  statusKey = 'status',
): string {
  const normalizedCheckboxState = requireTaskRecurrenceCheckboxState(checkboxState);
  let line = setTaskCheckboxToken(templateLine, normalizedCheckboxState);
  line = setInlineFieldValueOnTaskLine(line, statusKey, null);
  line = stripTaskRecurrenceInstanceFields(line);
  line = setInlineFieldValueOnTaskLine(line, 'scheduled', scheduledValue);
  return line;
}

export function ensureTaskRecurrenceIdOnLine(rawLine: string, id: string): string {
  if (readInlineFieldValue(rawLine, TASK_RECURRENCE_ID_KEY)) return rawLine;
  return setInlineFieldValueOnTaskLine(rawLine, TASK_RECURRENCE_ID_KEY, id);
}

export function findTaskBlockEndIndex(lines: string[], lineIndex: number): number {
  const sourceLine = lines[lineIndex] || '';
  const sourceIndent = getLineIndent(sourceLine);
  let index = lineIndex + 1;
  while (index < lines.length) {
    const line = lines[index] || '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    if (getLineIndent(line) <= sourceIndent) break;
    index += 1;
  }
  return index;
}

export function isCompletedTaskMarker(marker: string | null | undefined, completeMarkers: string[] = ['x', 'X']): boolean {
  const normalized = normalizeLinkedSubitemCheckboxMarker(marker);
  if (normalized == null || normalized.trim().length === 0) return false;
  return completeMarkers.some((markerValue) => (
    normalizeLinkedSubitemCheckboxMarker(markerValue) === normalized
  ));
}

export function extractTaskRecurrenceRule(rawLine: string): string {
  return readInlineFieldValue(rawLine, 'recurrence') || readInlineFieldValue(rawLine, 'recurrenceRule');
}

export function stripTaskRecurrenceInstanceFields(rawLine: string): string {
  return TASK_RECURRENCE_INSTANCE_ONLY_KEYS.reduce(
    (line, key) => setInlineFieldValueOnTaskLine(line, key, null),
    stripTaskInlinePropsMetadata(rawLine),
  );
}

export function parseTaskDate(rawValue: string): Date | null {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatTaskScheduledDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(' ');
}

function parseIsoDurationToMs(rawDuration: string): number {
  const value = String(rawDuration || '').trim().toUpperCase();
  const match = value.match(/^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?)?$/);
  if (!match) return 0;
  const weeks = Number(match[1] || 0);
  const days = Number(match[2] || 0);
  const hours = Number(match[3] || 0);
  const minutes = Number(match[4] || 0);
  if (![weeks, days, hours, minutes].every(Number.isFinite)) return 0;
  return (((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 * 1000;
}

function getLineIndent(line: string): number {
  return String(line || '').match(/^\s*/)?.[0]?.length || 0;
}

function requireTaskRecurrenceCheckboxState(rawState: unknown): string {
  const checkboxState = normalizeLinkedSubitemCheckboxState(rawState);
  if (!checkboxState) {
    throw new Error('Task recurrence requires a valid mapped checkbox state.');
  }
  return checkboxState;
}
