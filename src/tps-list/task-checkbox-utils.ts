export type KanbanCheckboxMappingLike = {
  checkboxState: string;
  statuses: string[];
  toggleTargetStatus?: string;
};

export function normalizeKanbanCheckboxState(rawState: string): string {
  const raw = String(rawState ?? '').trim();
  if (raw.startsWith('[') && raw.endsWith(']')) return raw;
  return `[${raw}]`;
}

export function getKanbanStatusForCheckboxState(rawState: string, mappings: KanbanCheckboxMappingLike[]): string {
  const state = normalizeKanbanCheckboxState(rawState);
  const mapping = mappings.find((entry) => entry.checkboxState === state);
  if (mapping?.statuses?.[0]) return mapping.statuses[0];
  const marker = state.slice(1, -1).trim().toLowerCase();
  if (!marker) return 'todo';
  if (marker === 'x') return 'complete';
  if (marker === '/' || marker === '\\') return 'working';
  if (marker === '?') return 'holding';
  if (marker === '-' || marker === '~') return 'wont-do';
  return marker;
}

export function getKanbanCheckboxStateForStatus(rawStatus: string | null, mappings: KanbanCheckboxMappingLike[]): string | null {
  const status = String(rawStatus ?? '').trim().toLowerCase();
  if (!status) return null;
  const mapping = mappings.find((entry) => entry.statuses.includes(status));
  if (mapping?.checkboxState) return mapping.checkboxState;
  if (status === 'complete') return '[x]';
  if (status === 'working') return '[\\]';
  if (status === 'holding') return '[?]';
  if (status === 'wont-do') return '[-]';
  if (status === 'todo') return '[ ]';
  return null;
}

export function getKanbanToggleCheckboxState(
  rawState: string,
  mappings: KanbanCheckboxMappingLike[],
  doneStatuses: Set<string>,
): string {
  const currentState = normalizeKanbanCheckboxState(rawState || '[ ]');
  const currentStatus = getKanbanStatusForCheckboxState(currentState, mappings);
  const mapping = mappings.find((entry) => entry.checkboxState === currentState || entry.statuses.includes(currentStatus));
  const targetStatus = String(mapping?.toggleTargetStatus || '').trim().toLowerCase();
  return getKanbanCheckboxStateForStatus(targetStatus, mappings) || (doneStatuses.has(currentStatus) ? '[ ]' : '[x]');
}

export function replaceKanbanTaskLineCheckboxState(line: string, checkboxState: string): string {
  const nextState = normalizeKanbanCheckboxState(checkboxState);
  return String(line ?? '').replace(
    /^(\s*(?:[-*+]|\d+[.)])\s+)\[[^\]]*\](\s+)/u,
    `$1${nextState}$2`,
  );
}
