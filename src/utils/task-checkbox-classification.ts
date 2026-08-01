import type { LinkedSubitemCheckboxMapping } from '../types';
import { MIGRATED_TASK_CHECKBOX, MIGRATED_TASK_STATUS } from '../constants/task-migration';
import { parseTaskLine } from './task-line-metadata';
import {
  getLinkedSubitemCompleteMarkers,
  normalizeLinkedSubitemMappings,
} from './linked-subitem-mapping';

export interface MappedTaskCheckboxClassification {
  marker: string | null;
  status: string | null;
  isComplete: boolean;
  isMigrated: boolean;
  isOpen: boolean;
}

interface TaskCheckboxClassificationContext {
  completeMarkers: Set<string>;
  statusByToken: Map<string, string>;
}

/**
 * Resolve checkbox workflow meaning from the configured mapping table.
 *
 * Migrated Daily Note scratchpad records are intentionally neither complete
 * nor open: they stay available for reveal/history without recreating an open
 * task or receiving a completion date.
 */
export function classifyMappedTaskCheckboxState(
  mappings: LinkedSubitemCheckboxMapping[],
  state: string | null | undefined,
): MappedTaskCheckboxClassification {
  return classifyWithContext(createClassificationContext(mappings), state);
}

export function hasOpenMappedTaskLines(
  lines: string[],
  mappings: LinkedSubitemCheckboxMapping[],
): boolean {
  const context = createClassificationContext(mappings);
  return lines.some((line) => {
    const parsed = parseTaskLine(line);
    return parsed
      ? classifyWithContext(context, parsed.marker).isOpen
      : false;
  });
}

function classifyWithContext(
  context: TaskCheckboxClassificationContext,
  state: string | null | undefined,
): MappedTaskCheckboxClassification {
  const marker = readCheckboxMarker(state);
  if (marker == null) {
    return {
      marker: null,
      status: null,
      isComplete: false,
      isMigrated: false,
      isOpen: false,
    };
  }

  const token = `[${marker}]`;
  const status = context.statusByToken.get(token) || null;
  const normalizedStatus = normalizeStatus(status);
  const isMigrated = token === MIGRATED_TASK_CHECKBOX || normalizedStatus === MIGRATED_TASK_STATUS;
  const isComplete = !isMigrated && context.completeMarkers.has(marker);

  return {
    marker,
    status,
    isComplete,
    isMigrated,
    isOpen: !isMigrated && !isComplete,
  };
}

function createClassificationContext(
  mappings: LinkedSubitemCheckboxMapping[],
): TaskCheckboxClassificationContext {
  const normalizedMappings = normalizeLinkedSubitemMappings(mappings, { enforceStrictDefaults: false });
  const statusByToken = new Map<string, string>();
  for (const mapping of normalizedMappings) {
    if (!statusByToken.has(mapping.checkboxState)) {
      statusByToken.set(mapping.checkboxState, mapping.statuses[0] || '');
    }
  }
  return {
    completeMarkers: new Set(getLinkedSubitemCompleteMarkers(normalizedMappings)),
    statusByToken,
  };
}

function readCheckboxMarker(state: string | null | undefined): string | null {
  if (state == null) return null;
  const source = String(state);
  const trimmed = source.trim();
  const tokenMatch = trimmed.match(/^\[([^\]\r\n]?)\]$/u);
  if (tokenMatch) return tokenMatch[1] || ' ';
  if (source === ' ' || trimmed === '') return ' ';
  if (trimmed.length === 1 && trimmed !== '[' && trimmed !== ']') return trimmed;
  return null;
}

function normalizeStatus(value: unknown): string {
  return String(value ?? '')
    .replace(/^\[\[|\]\]$/gu, '')
    .replace(/^["']|["']$/gu, '')
    .trim()
    .toLowerCase();
}
