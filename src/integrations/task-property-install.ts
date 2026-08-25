import type { CustomProperty } from '../types';
import { MIGRATED_TASK_STATUS } from '../constants/task-migration';

export const TASK_RECORD_PROPERTY_IDS = new Set([
  'status',
  'priority',
  'scheduled',
  'due',
  'time-estimate',
  'parents',
  'recurrence',
  'completed-date',
]);

const TASK_RECORD_PROPERTIES: CustomProperty[] = [
  {
    id: 'status', label: 'Status', key: 'status', type: 'selector', icon: 'circle-check',
    options: ['todo', 'working', 'holding', 'wont-do', 'complete', MIGRATED_TASK_STATUS],
    scopeKinds: ['task'], showInCollapsed: true, showInContextMenu: true, allowInlineSet: true,
  },
  {
    id: 'priority', label: 'Priority', key: 'priority', type: 'selector', icon: 'flag',
    options: ['high', 'medium', 'normal', 'low'], scopeKinds: ['task'],
    showInCollapsed: true, showInContextMenu: true, allowInlineSet: true,
  },
  {
    id: 'scheduled', label: 'Scheduled', key: 'scheduled', type: 'datetime', icon: 'calendar',
    scopeKinds: ['task'], showInCollapsed: true, showInContextMenu: true, allowInlineSet: true,
  },
  {
    id: 'due', label: 'Due', key: 'due', type: 'datetime', icon: 'calendar-clock',
    scopeKinds: ['task'], showInCollapsed: true, showInContextMenu: true, allowInlineSet: true,
  },
  {
    id: 'time-estimate', label: 'Time estimate', key: 'timeEstimate', type: 'number', icon: 'timer',
    scopeKinds: ['task'], showInCollapsed: true, showInContextMenu: true, allowInlineSet: true,
  },
  {
    id: 'parents', label: 'Parents', key: 'parents', type: 'list', listItemType: 'link', icon: 'git-branch',
    optionSources: ['entity'], optionsSource: 'manual', scopeKinds: ['task'],
    showInCollapsed: true, showInContextMenu: true, allowInlineSet: true,
  },
  {
    id: 'recurrence', label: 'Recurrence', key: 'recurrenceRule', type: 'recurrence', icon: 'repeat',
    scopeKinds: ['task'], showInCollapsed: true, showInContextMenu: true, allowInlineSet: true,
  },
  {
    id: 'completed-date', label: 'Completed', key: 'completedDate', type: 'datetime', icon: 'check-check',
    scopeKinds: ['task'], showInCollapsed: true, showInContextMenu: true, allowInlineSet: false,
  },
];

function keyOf(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase();
}

function union(values: Array<unknown[] | undefined>): string[] | undefined {
  const merged = Array.from(new Set(values.flatMap((value) => value || [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
  return merged.length > 0 ? merged : undefined;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

export interface TaskPropertyInstallResult {
  properties: CustomProperty[];
  added: number;
  updated: number;
}

/** Explicitly install/refresh the task-record field catalog without duplicating shared keys. */
export function installTaskRecordProperties(existingProperties: CustomProperty[]): TaskPropertyInstallResult {
  const normalizedExisting = existingProperties.map((property) => (
    keyOf(property.id) === 'recurrence' && keyOf(property.key) === 'recurrence'
      ? { ...property, key: 'recurrenceRule' }
      : property
  ));
  const existingByKey = new Map(normalizedExisting.map((property) => [keyOf(property.key), property]));
  let added = 0;
  let updated = 0;
  const replacements = new Map<string, CustomProperty>();
  for (const desired of TASK_RECORD_PROPERTIES) {
    const key = keyOf(desired.key);
    const existing = existingByKey.get(key);
    if (!existing) {
      replacements.set(key, { ...desired });
      added += 1;
      continue;
    }
    replacements.set(key, withoutUndefined({
      ...desired,
      ...existing,
      type: desired.type,
      listItemType: desired.listItemType || existing.listItemType,
      options: union([desired.options, existing.options]),
      optionSources: union([desired.optionSources, existing.optionSources]) as CustomProperty['optionSources'],
      scopeKinds: union([existing.scopeKinds, desired.scopeKinds]),
    }));
    updated += 1;
  }

  const retained = normalizedExisting.map((property) => replacements.get(keyOf(property.key)) || property);
  const retainedKeys = new Set(retained.map((property) => keyOf(property.key)));
  for (const [key, property] of replacements) {
    if (!retainedKeys.has(key)) retained.push(property);
  }
  return { properties: retained, added, updated };
}
