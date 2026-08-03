import {
  setInlineFieldValueOnTaskLine,
  setTaskCheckboxToken,
} from './task-line-metadata';
import { normalizeLinkedSubitemCheckboxState } from './linked-subitem-mapping';

export type TaskCheckboxWorkflowFieldOwnership = {
  workflowStatusKey?: unknown;
  relationalStatusKey?: unknown;
};

export type TaskCheckboxWorkflowMapping = {
  checkboxState?: unknown;
  statuses?: readonly unknown[];
  toggleTargetStatus?: unknown;
};

const VIRTUAL_WORKFLOW_FIELD_KEYS = [
  'status',
  'taskStatus',
  'task.status',
  'task.checkboxStatus',
  'checkboxStatus',
] as const;

function normalizeFieldKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function getTaskCheckboxOwnedWorkflowFieldKeys(
  ownership: TaskCheckboxWorkflowFieldOwnership,
): string[] {
  const relationalStatusKey = normalizeFieldKey(ownership.relationalStatusKey);
  const keys = [ownership.workflowStatusKey, ...VIRTUAL_WORKFLOW_FIELD_KEYS];
  const seen = new Set<string>();
  const owned: string[] = [];

  for (const rawKey of keys) {
    const key = String(rawKey ?? '').trim();
    const normalized = normalizeFieldKey(key);
    if (!normalized || normalized === relationalStatusKey || seen.has(normalized)) continue;
    seen.add(normalized);
    owned.push(key);
  }
  return owned;
}

export function isTaskCheckboxOwnedWorkflowFieldKey(
  key: unknown,
  ownership: TaskCheckboxWorkflowFieldOwnership,
): boolean {
  const normalized = normalizeFieldKey(key);
  return Boolean(normalized) && getTaskCheckboxOwnedWorkflowFieldKeys(ownership)
    .some((candidate) => normalizeFieldKey(candidate) === normalized);
}

export function clearTaskCheckboxOwnedWorkflowFields(
  line: string,
  ownership: TaskCheckboxWorkflowFieldOwnership,
): string {
  let next = String(line ?? '');
  for (const key of getTaskCheckboxOwnedWorkflowFieldKeys(ownership)) {
    next = setInlineFieldValueOnTaskLine(next, key, null);
  }
  return next;
}

export function setTaskCheckboxWorkflowState(
  line: string,
  checkboxState: string,
  ownership: TaskCheckboxWorkflowFieldOwnership,
): string {
  return clearTaskCheckboxOwnedWorkflowFields(
    setTaskCheckboxToken(line, checkboxState),
    ownership,
  );
}

export function isTaskCheckboxWorkflowTokenCurrent(
  currentToken: unknown,
  expectedToken: unknown,
): boolean {
  const current = normalizeLinkedSubitemCheckboxState(currentToken);
  const expected = normalizeLinkedSubitemCheckboxState(expectedToken);
  return current != null && expected != null && current === expected;
}

export function getTaskCheckboxWorkflowMutationSignature(
  mappings: readonly TaskCheckboxWorkflowMapping[],
  ownership: TaskCheckboxWorkflowFieldOwnership,
  completeMarkers: readonly unknown[] = [],
): string {
  return JSON.stringify({
    mappings: mappings.map((mapping) => ({
      checkboxState: String(mapping.checkboxState ?? '').trim(),
      statuses: (mapping.statuses || []).map((status) => String(status ?? '').trim()),
      toggleTargetStatus: String(mapping.toggleTargetStatus ?? '').trim(),
    })),
    ownedFields: getTaskCheckboxOwnedWorkflowFieldKeys(ownership)
      .map((key) => normalizeFieldKey(key)),
    relationalStatusKey: normalizeFieldKey(ownership.relationalStatusKey),
    completeMarkers: completeMarkers.map((marker) => String(marker ?? '')),
  });
}
