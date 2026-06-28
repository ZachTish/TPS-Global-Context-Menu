import type { LinkedSubitemCheckboxMapping } from '../types';
import { updateTaskCompletedDateForCheckboxState } from './task-line-metadata';
import { mapStatusToSubitemCheckboxState } from './linked-subitem-mapping';

const TASK_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([^\]\r\n]?)\](\s*)(.*)$/;

interface InlineFieldMatch {
  value: string;
  start: number;
  end: number;
}

export interface TaskStatusCheckboxReconcileResult {
  changed: boolean;
  line: string;
  status?: string;
  checkboxState?: string;
}

export function reconcileTaskStatusLine(
  line: string,
  statusKey: string,
  mappings: LinkedSubitemCheckboxMapping[],
  options: { completedAt?: Date; completeMarkers?: string[] } = {},
): TaskStatusCheckboxReconcileResult {
  const rawLine = String(line || '');
  const taskMatch = rawLine.match(TASK_LINE_RE);
  if (!taskMatch) return { changed: false, line: rawLine };

  const body = String(taskMatch[4] || '');
  const field = findInlineField(body, statusKey);
  if (!field) return { changed: false, line: rawLine };

  const status = normalizeInlineStatusValue(field.value);
  const checkboxState = mapStatusToCheckboxState(status, mappings);
  if (!checkboxState) return { changed: false, line: rawLine };

  const nextBody = removeInlineField(body, field);
  const withoutStatusLine = `${taskMatch[1]}${checkboxState}${nextBody ? ` ${nextBody}` : ''}`;
  const nextLine = updateTaskCompletedDateForCheckboxState(withoutStatusLine, checkboxState, options);
  return {
    changed: nextLine !== rawLine,
    line: nextLine,
    status,
    checkboxState,
  };
}

function mapStatusToCheckboxState(status: string, mappings: LinkedSubitemCheckboxMapping[]): string | null {
  return mapStatusToSubitemCheckboxState(mappings, status);
}

function findInlineField(line: string, key: string): InlineFieldMatch | null {
  const escapedKey = escapeRegExp(String(key || '').trim() || 'status');
  const patterns = [
    new RegExp(`(^|\\s)\\[\\s*${escapedKey}\\s*::\\s*([^\\]\\r\\n]*)\\]`, 'i'),
    new RegExp(`(^|\\s)\\(\\s*${escapedKey}\\s*::\\s*([^\\)\\r\\n]*)\\)`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (!match) continue;
    return {
      value: String(match[2] || ''),
      start: match.index,
      end: match.index + match[0].length,
    };
  }

  return null;
}

function removeInlineField(line: string, field: InlineFieldMatch): string {
  const before = line.slice(0, field.start).trimEnd();
  const after = line.slice(field.end).trimStart();
  if (!before) return after;
  if (!after) return before;
  return `${before} ${after}`.replace(/[ \t]{2,}/g, ' ').trimEnd();
}

function normalizeInlineStatusValue(value: string): string {
  return String(value || '')
    .replace(/^\[\[|\]\]$/g, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
