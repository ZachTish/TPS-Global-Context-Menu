import {
  getLinkedSubitemMappingForState,
  mapStatusToSubitemCheckboxState,
  mapSubitemCheckboxStateToStatus,
  normalizeLinkedSubitemCheckboxState,
} from '../utils/linked-subitem-mapping';

export type KanbanCheckboxMappingLike = {
  checkboxState: string;
  statuses: string[];
  toggleTargetStatus?: string;
};

export function normalizeKanbanCheckboxState(rawState: string): string {
  return normalizeLinkedSubitemCheckboxState(rawState) || '';
}

export function getKanbanStatusForCheckboxState(rawState: string, mappings: KanbanCheckboxMappingLike[]): string {
  return mapSubitemCheckboxStateToStatus(
    mappings,
    rawState,
    { normalizedMappings: true },
  ) || '';
}

export function getKanbanCheckboxStateForStatus(rawStatus: string | null, mappings: KanbanCheckboxMappingLike[]): string | null {
  return mapStatusToSubitemCheckboxState(
    mappings,
    rawStatus,
    { normalizedMappings: true },
  );
}

export function getKanbanToggleCheckboxState(
  rawState: string,
  mappings: KanbanCheckboxMappingLike[],
): string | null {
  const currentState = normalizeKanbanCheckboxState(rawState);
  if (!currentState) return null;
  const mapping = getLinkedSubitemMappingForState(mappings, currentState, { normalizedMappings: true });
  if (!mapping) return null;
  const targetStatus = String(mapping?.toggleTargetStatus || '').trim().toLowerCase();
  if (!targetStatus) return null;
  return mapStatusToSubitemCheckboxState(
    mappings,
    targetStatus,
    { normalizedMappings: true },
  );
}

export function replaceKanbanTaskLineCheckboxState(line: string, checkboxState: string): string {
  const nextState = normalizeKanbanCheckboxState(checkboxState);
  if (!nextState) return String(line ?? '');
  return String(line ?? '').replace(
    /^(\s*(?:[-*+]|\d+[.)])\s+)\[[^\]]*\](\s+)/u,
    `$1${nextState}$2`,
  );
}
