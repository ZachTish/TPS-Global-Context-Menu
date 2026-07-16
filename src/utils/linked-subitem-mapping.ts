import type { LinkedSubitemCheckboxMapping } from '../types';
import { MIGRATED_TASK_MAPPING } from '../constants/task-migration';

export interface LinkedSubitemMappingOptions {
  enforceStrictDefaults?: boolean;
}

export const DEFAULT_LINKED_SUBITEM_MAPPINGS: LinkedSubitemCheckboxMapping[] = [
  { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete', icon: 'square', label: 'Todo' },
  { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo', icon: 'check', label: 'Complete' },
  { checkboxState: '[/]', statuses: ['working'], toggleTargetStatus: 'complete', icon: 'slash', label: 'Working' },
  { checkboxState: '[\\]', statuses: ['working'], toggleTargetStatus: 'complete', icon: 'slash', label: 'Working' },
  { checkboxState: '[?]', statuses: ['holding'], toggleTargetStatus: 'todo', icon: 'help-circle', label: 'Holding' },
  { checkboxState: '[-]', statuses: ['wont-do'], toggleTargetStatus: 'todo', icon: 'minus', label: 'Won’t Do' },
  MIGRATED_TASK_MAPPING,
];

function normalizeStatus(value: unknown): string {
  return String(value || '')
    .replace(/^\[\[|\]\]$/g, '')
    .replace(/^"|"$/g, '')
    .trim()
    .toLowerCase();
}

function normalizeCheckboxState(value: unknown): string {
  return String(value || '').trim();
}

function normalizeEntry(raw: unknown): LinkedSubitemCheckboxMapping | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const checkboxState = normalizeCheckboxState(candidate.checkboxState);
  const statuses = Array.isArray(candidate.statuses)
    ? candidate.statuses.map((status) => normalizeStatus(status)).filter(Boolean)
    : [];
  if (!checkboxState || statuses.length === 0) return null;

  return {
    checkboxState,
    statuses,
    toggleTargetStatus: normalizeStatus(candidate.toggleTargetStatus) || undefined,
    icon: normalizeCheckboxState(candidate.icon) || undefined,
    label: String(candidate.label || '').trim() || undefined,
  };
}

export function normalizeLinkedSubitemMappings(
  mappings: unknown,
  options: LinkedSubitemMappingOptions = {},
): LinkedSubitemCheckboxMapping[] {
  const enforceStrictDefaults = options.enforceStrictDefaults !== false;
  const normalized = Array.isArray(mappings)
    ? mappings.map((entry) => normalizeEntry(entry)).filter((entry): entry is LinkedSubitemCheckboxMapping => !!entry)
    : [];

  if (!enforceStrictDefaults) {
    return normalized;
  }

  const byState = new Map<string, LinkedSubitemCheckboxMapping>(
    normalized.map((entry) => [entry.checkboxState, entry]),
  );

  const strictStates = new Set(DEFAULT_LINKED_SUBITEM_MAPPINGS.map((entry) => entry.checkboxState));
  const custom = Array.from(byState.values()).filter((entry) => !strictStates.has(entry.checkboxState));

  return [
    ...DEFAULT_LINKED_SUBITEM_MAPPINGS.map((entry) => {
      const existing = byState.get(entry.checkboxState);
      return {
        ...entry,
        statuses: existing?.statuses?.length ? existing.statuses : entry.statuses,
        toggleTargetStatus: existing?.toggleTargetStatus || entry.toggleTargetStatus,
        icon: existing?.icon || entry.icon,
        label: existing?.label || entry.label,
      };
    }),
    ...custom,
  ];
}

export function mergeLinkedSubitemMappingPresentation(
  mappings: unknown,
  sourceMappings: unknown,
): LinkedSubitemCheckboxMapping[] {
  const normalized = normalizeLinkedSubitemMappings(mappings, { enforceStrictDefaults: false });
  const sourceByState = new Map(
    normalizeLinkedSubitemMappings(sourceMappings, { enforceStrictDefaults: true })
      .map((entry) => [entry.checkboxState, entry] as const),
  );

  return normalized.map((entry) => {
    const source = sourceByState.get(entry.checkboxState);
    return {
      ...entry,
      icon: entry.icon || source?.icon,
      label: entry.label || source?.label,
    };
  });
}

function normalizeCheckboxTokenForLookup(state: string): string {
  const normalized = normalizeCheckboxState(state);
  if (!normalized) return '';
  return normalized.startsWith('[') && normalized.endsWith(']') ? normalized : `[${normalized}]`;
}

export function mapStatusToSubitemCheckboxState(
  mappings: LinkedSubitemCheckboxMapping[],
  status: string,
): string | null {
  const normalizedStatus = normalizeStatus(status);
  for (const mapping of normalizeLinkedSubitemMappings(mappings, { enforceStrictDefaults: false })) {
    if (mapping.statuses.some((entry) => normalizeStatus(entry) === normalizedStatus)) {
      return mapping.checkboxState;
    }
  }
  return null;
}

export function mapSubitemCheckboxStateToStatus(
  mappings: LinkedSubitemCheckboxMapping[],
  state: string,
): string | null {
  const normalizedState = normalizeCheckboxTokenForLookup(state);
  for (const mapping of normalizeLinkedSubitemMappings(mappings, { enforceStrictDefaults: false })) {
    if (mapping.checkboxState === normalizedState) return mapping.statuses[0] || null;
  }
  return null;
}

export function getLinkedSubitemCompleteMarkers(mappings: LinkedSubitemCheckboxMapping[]): string[] {
  const completionStatuses = new Set(['complete', 'wont-do']);
  const mapped = new Set(
    normalizeLinkedSubitemMappings(mappings, { enforceStrictDefaults: false })
      .filter((entry) => (entry.statuses || []).some((status) => completionStatuses.has(normalizeStatus(status))))
      .map((entry) => entry.checkboxState.replace(/^\[|\]$/g, '').trim())
      .filter(Boolean),
  );
  mapped.add('x');
  mapped.add('X');
  return Array.from(mapped);
}
