import type { LinkedSubitemCheckboxMapping } from '../types';
import { MIGRATED_TASK_MAPPING } from '../constants/task-migration';

export interface LinkedSubitemMappingOptions {
  enforceStrictDefaults?: boolean;
  normalizeStatus?: LinkedSubitemStatusNormalizer;
  normalizedMappings?: boolean;
}

export type LinkedSubitemStatusNormalizer = (value: unknown) => string;

export interface LinkedSubitemMappingTextIssue {
  line: number;
  message: string;
}

export interface LinkedSubitemMappingTextResult {
  mappings: LinkedSubitemCheckboxMapping[];
  errors: LinkedSubitemMappingTextIssue[];
  warnings: string[];
}

export interface LinkedSubitemMappingTextOptions {
  normalizeStatus?: LinkedSubitemStatusNormalizer;
  completionStatuses?: readonly string[];
}

export interface LinkedSubitemCompletionOptions {
  completionStatuses?: readonly string[];
  normalizeStatus?: LinkedSubitemStatusNormalizer;
}

export interface LinkedSubitemSemanticCheckboxPlan {
  checkboxState: string;
  status: string;
  statuses: readonly string[];
  resolution: 'state' | 'status';
}

type PublicLinkedSubitemCheckboxMapping = Readonly<
  Omit<LinkedSubitemCheckboxMapping, 'statuses'>
  & { statuses: readonly string[] }
>;

export const DEFAULT_LINKED_SUBITEM_MAPPINGS: LinkedSubitemCheckboxMapping[] = [
  { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete', icon: 'square', label: 'Todo' },
  { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo', icon: 'check', label: 'Complete' },
  { checkboxState: '[/]', statuses: ['working'], toggleTargetStatus: 'complete', icon: 'slash', label: 'Working' },
  { checkboxState: '[\\]', statuses: ['working'], toggleTargetStatus: 'complete', icon: 'slash', label: 'Working' },
  { checkboxState: '[?]', statuses: ['holding'], toggleTargetStatus: 'todo', icon: 'help-circle', label: 'Holding' },
  { checkboxState: '[-]', statuses: ['wont-do'], toggleTargetStatus: 'todo', icon: 'minus', label: 'Won’t Do' },
  MIGRATED_TASK_MAPPING,
];

function normalizeStatus(
  value: unknown,
  statusNormalizer?: LinkedSubitemStatusNormalizer,
): string {
  const normalized = String(value || '')
    .replace(/^\[\[|\]\]$/g, '')
    .replace(/^["']|["']$/g, '')
    .trim()
    .toLowerCase();
  if (!normalized || !statusNormalizer) return normalized;
  return String(statusNormalizer(normalized) || '').trim().toLowerCase();
}

export function normalizeLinkedSubitemCheckboxState(value: unknown): string | null {
  const source = String(value ?? '');
  if (source === ' ') return '[ ]';
  const trimmed = source.trim();
  const tokenMatch = trimmed.match(/^\[([^\]\r\n])\]$/u);
  if (tokenMatch && tokenMatch[1].length === 1) {
    return `[${tokenMatch[1] === 'X' ? 'x' : tokenMatch[1]}]`;
  }
  if (!trimmed || trimmed === '[' || trimmed === ']') return null;
  if (trimmed.length !== 1) return null;
  return `[${trimmed === 'X' ? 'x' : trimmed}]`;
}

/**
 * Return the one-character marker used for semantic comparisons. Obsidian
 * accepts both checked spellings, but TPS has one strict canonical identity:
 * `[X]` and `X` compare as the mapped `[x]` marker.
 */
export function normalizeLinkedSubitemCheckboxMarker(value: unknown): string | null {
  const checkboxState = normalizeLinkedSubitemCheckboxState(value);
  return checkboxState == null ? null : checkboxState.slice(1, -1);
}

function normalizeEntry(
  raw: unknown,
  statusNormalizer?: LinkedSubitemStatusNormalizer,
): LinkedSubitemCheckboxMapping | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const checkboxState = normalizeLinkedSubitemCheckboxState(candidate.checkboxState);
  const statuses = Array.isArray(candidate.statuses)
    ? Array.from(new Set(
        candidate.statuses
          .map((status) => normalizeStatus(status, statusNormalizer))
          .filter(Boolean),
      ))
    : [];
  if (!checkboxState || statuses.length === 0) return null;

  return {
    checkboxState,
    statuses,
    toggleTargetStatus: normalizeStatus(candidate.toggleTargetStatus, statusNormalizer) || undefined,
    icon: String(candidate.icon || '').trim() || undefined,
    label: String(candidate.label || '').trim() || undefined,
  };
}

export function normalizeLinkedSubitemMappings(
  mappings: unknown,
  options: LinkedSubitemMappingOptions = {},
): LinkedSubitemCheckboxMapping[] {
  const enforceStrictDefaults = options.enforceStrictDefaults !== false;
  const normalized: LinkedSubitemCheckboxMapping[] = [];
  const seenStates = new Set<string>();
  if (Array.isArray(mappings)) {
    for (const raw of mappings) {
      const entry = normalizeEntry(raw, options.normalizeStatus);
      if (!entry || seenStates.has(entry.checkboxState)) continue;
      seenStates.add(entry.checkboxState);
      normalized.push(entry);
    }
  }

  if (!enforceStrictDefaults) {
    return normalized;
  }

  const defaultsByState = new Map(
    DEFAULT_LINKED_SUBITEM_MAPPINGS.map((entry) => [entry.checkboxState, entry] as const),
  );
  const merged: LinkedSubitemCheckboxMapping[] = normalized.map((entry) => {
    const fallback = defaultsByState.get(entry.checkboxState);
    return {
      ...(fallback || {}),
      ...entry,
      statuses: [...entry.statuses],
      toggleTargetStatus: entry.toggleTargetStatus || fallback?.toggleTargetStatus,
      icon: entry.icon || fallback?.icon,
      label: entry.label || fallback?.label,
    };
  });
  const presentStates = new Set(merged.map((entry) => entry.checkboxState));
  for (const fallback of DEFAULT_LINKED_SUBITEM_MAPPINGS) {
    if (presentStates.has(fallback.checkboxState)) continue;
    merged.push({ ...fallback, statuses: [...fallback.statuses] });
  }
  return merged;
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

function normalizeCheckboxTokenForLookup(state: unknown): string {
  return normalizeLinkedSubitemCheckboxState(state) || '';
}

export function getLinkedSubitemMappingForState(
  mappings: LinkedSubitemCheckboxMapping[],
  state: unknown,
  options: Pick<LinkedSubitemMappingOptions, 'normalizedMappings'> = {},
): LinkedSubitemCheckboxMapping | null {
  const normalizedState = normalizeCheckboxTokenForLookup(state);
  if (!normalizedState) return null;
  const source = options.normalizedMappings
    ? mappings
    : normalizeLinkedSubitemMappings(mappings, { enforceStrictDefaults: false });
  return source
    .find((mapping) => mapping.checkboxState === normalizedState) || null;
}

export function mapStatusToSubitemCheckboxState(
  mappings: LinkedSubitemCheckboxMapping[],
  status: unknown,
  options: Pick<LinkedSubitemMappingOptions, 'normalizeStatus' | 'normalizedMappings'> = {},
): string | null {
  const normalizedStatus = normalizeStatus(status, options.normalizeStatus);
  if (!normalizedStatus) return null;
  const source = options.normalizedMappings
    ? mappings
    : normalizeLinkedSubitemMappings(mappings, { enforceStrictDefaults: false });
  for (const mapping of source) {
    if (mapping.statuses.some((entry) => normalizeStatus(entry, options.normalizeStatus) === normalizedStatus)) {
      return mapping.checkboxState;
    }
  }
  return null;
}

export function mapSubitemCheckboxStateToStatus(
  mappings: LinkedSubitemCheckboxMapping[],
  state: unknown,
  options: Pick<LinkedSubitemMappingOptions, 'normalizedMappings'> = {},
): string | null {
  return getLinkedSubitemMappingForState(mappings, state, options)?.statuses[0] || null;
}

/**
 * Capture the ordered mapping row selected by a semantic status. The reverse
 * lookup is intentional: a creation plan is valid only when the live primary
 * status resolution still lands on the same row with the same status order.
 */
export function resolveLinkedSubitemSemanticCheckboxPlanForStatus(
  mappings: LinkedSubitemCheckboxMapping[],
  status: unknown,
  options: Pick<LinkedSubitemMappingOptions, 'normalizeStatus' | 'normalizedMappings'> = {},
): LinkedSubitemSemanticCheckboxPlan | null {
  const normalizedStatus = normalizeStatus(status, options.normalizeStatus);
  if (!normalizedStatus) return null;
  const source = options.normalizedMappings
    ? mappings
    : normalizeLinkedSubitemMappings(mappings, {
        enforceStrictDefaults: false,
        normalizeStatus: options.normalizeStatus,
      });
  const checkboxState = mapStatusToSubitemCheckboxState(source, normalizedStatus, {
    normalizeStatus: options.normalizeStatus,
    normalizedMappings: true,
  });
  if (!checkboxState) return null;
  const mapping = getLinkedSubitemMappingForState(source, checkboxState, { normalizedMappings: true });
  const statuses = mapping?.statuses
    .map((entry) => normalizeStatus(entry, options.normalizeStatus))
    .filter(Boolean) || [];
  if (!mapping || !statuses.includes(normalizedStatus)) return null;
  return {
    checkboxState,
    status: normalizedStatus,
    statuses,
    resolution: 'status',
  };
}

/**
 * Capture the exact ordered row selected by a checkbox dropdown. This keeps
 * explicitly configured alternate markers valid even when another row is the
 * primary status-to-marker resolution.
 */
export function resolveLinkedSubitemSemanticCheckboxPlanForState(
  mappings: LinkedSubitemCheckboxMapping[],
  state: unknown,
  status: unknown,
  options: Pick<LinkedSubitemMappingOptions, 'normalizeStatus' | 'normalizedMappings'> = {},
): LinkedSubitemSemanticCheckboxPlan | null {
  const normalizedStatus = normalizeStatus(status, options.normalizeStatus);
  if (!normalizedStatus) return null;
  const source = options.normalizedMappings
    ? mappings
    : normalizeLinkedSubitemMappings(mappings, {
        enforceStrictDefaults: false,
        normalizeStatus: options.normalizeStatus,
      });
  const mapping = getLinkedSubitemMappingForState(source, state, { normalizedMappings: true });
  const statuses = mapping?.statuses
    .map((entry) => normalizeStatus(entry, options.normalizeStatus))
    .filter(Boolean) || [];
  if (!mapping || !statuses.includes(normalizedStatus)) return null;
  return {
    checkboxState: mapping.checkboxState,
    status: normalizedStatus,
    statuses,
    resolution: 'state',
  };
}

/**
 * Compare-and-swap guard for semantic task creation. Only the relevant
 * ordered mapping row participates, so unrelated mapping edits do not cancel
 * a write while marker/status reassignment always does.
 */
export function isLinkedSubitemSemanticCheckboxPlanCurrent(
  mappings: LinkedSubitemCheckboxMapping[],
  plan: LinkedSubitemSemanticCheckboxPlan,
  options: Pick<LinkedSubitemMappingOptions, 'normalizeStatus' | 'normalizedMappings'> = {},
): boolean {
  const current = plan.resolution === 'status'
    ? resolveLinkedSubitemSemanticCheckboxPlanForStatus(mappings, plan.status, options)
    : resolveLinkedSubitemSemanticCheckboxPlanForState(mappings, plan.checkboxState, plan.status, options);
  return Boolean(
    current
    && current.checkboxState === plan.checkboxState
    && current.status === plan.status
    && current.statuses.length === plan.statuses.length
    && current.statuses.every((status, index) => status === plan.statuses[index]),
  );
}

/**
 * Build the public, ordered checkbox/status contract from one settings source.
 * The normalized snapshot is cached by source-array identity, and consumers
 * receive the same deeply frozen view until settings replace that array.
 */
export function createLinkedSubitemCheckboxContract(
  getSource: () => unknown,
  statusNormalizer: LinkedSubitemStatusNormalizer,
) {
  let hasCachedSource = false;
  let cachedSource: unknown;
  let cachedMappings: LinkedSubitemCheckboxMapping[] = [];
  let cachedPublicMappings: ReadonlyArray<PublicLinkedSubitemCheckboxMapping> = [];

  const getMappings = (): LinkedSubitemCheckboxMapping[] => {
    const source = getSource();
    if (!hasCachedSource || source !== cachedSource) {
      hasCachedSource = true;
      cachedSource = source;
      cachedMappings = normalizeLinkedSubitemMappings(source, {
        // Runtime consumers receive only the canonical rows that actually
        // exist in settings. Initial/default population and legacy migration
        // are settings-layer responsibilities, not a read-time fallback.
        enforceStrictDefaults: false,
        normalizeStatus: statusNormalizer,
      });
      cachedPublicMappings = Object.freeze(cachedMappings.map((mapping) => Object.freeze({
        ...mapping,
        statuses: Object.freeze([...mapping.statuses]),
      })));
    }
    return cachedMappings;
  };

  return Object.freeze({
    version: 1 as const,
    contract: 'ordered-strict-v1' as const,
    getMappings: () => {
      getMappings();
      return cachedPublicMappings;
    },
    stateForStatus: (status: unknown): string => mapStatusToSubitemCheckboxState(
      getMappings(),
      status,
      { normalizeStatus: statusNormalizer, normalizedMappings: true },
    ) || '',
    statusForState: (state: unknown): string => {
      const configured = mapSubitemCheckboxStateToStatus(
        getMappings(),
        state,
        { normalizedMappings: true },
      );
      return configured ? normalizeStatus(configured, statusNormalizer) : '';
    },
  });
}

export function getLinkedSubitemCompleteMarkers(
  mappings: LinkedSubitemCheckboxMapping[],
  options: LinkedSubitemCompletionOptions = {},
): string[] {
  const rawCompletionStatuses = Array.isArray(options.completionStatuses)
    ? options.completionStatuses
    : ['complete', 'wont-do'];
  const completionStatuses = new Set(
    rawCompletionStatuses
      .map((status) => normalizeStatus(status, options.normalizeStatus))
      .filter(Boolean),
  );
  const mapped = new Set(
    normalizeLinkedSubitemMappings(mappings, { enforceStrictDefaults: false })
      .filter((entry) => (entry.statuses || []).some((status) =>
        completionStatuses.has(normalizeStatus(status, options.normalizeStatus))))
      .map((entry) => normalizeLinkedSubitemCheckboxMarker(entry.checkboxState))
      .filter((marker): marker is string => marker != null && marker.trim().length > 0),
  );
  return Array.from(mapped);
}

export function parseLinkedSubitemMappingsText(
  raw: unknown,
  options: LinkedSubitemMappingTextOptions = {},
): LinkedSubitemMappingTextResult {
  const mappings: LinkedSubitemCheckboxMapping[] = [];
  const errors: LinkedSubitemMappingTextIssue[] = [];
  const seenStates = new Map<string, number>();
  const sourceLines = String(raw ?? '').split(/\r?\n/u);

  for (let index = 0; index < sourceLines.length; index += 1) {
    const lineNumber = index + 1;
    const line = String(sourceLines[index] || '').trim();
    if (!line) continue;
    const match = line.match(/^(\[[^\]\r\n]*\]|[^\s:])\s*:\s*(.*?)(?:\s*=>\s*(.*))?$/u);
    if (!match) {
      errors.push({ line: lineNumber, message: 'Use "[marker]: status => toggle status".' });
      continue;
    }

    const checkboxState = normalizeLinkedSubitemCheckboxState(match[1]);
    if (!checkboxState) {
      errors.push({ line: lineNumber, message: 'Checkbox markers must contain exactly one character; use [ ] for open.' });
      continue;
    }
    const duplicateLine = seenStates.get(checkboxState);
    if (duplicateLine != null) {
      errors.push({ line: lineNumber, message: `${checkboxState} is already defined on line ${duplicateLine}.` });
      continue;
    }

    const statuses = Array.from(new Set(
      String(match[2] || '')
        .split(',')
        .map((value) => normalizeStatus(value, options.normalizeStatus))
        .filter(Boolean),
    ));
    if (statuses.length === 0) {
      errors.push({ line: lineNumber, message: 'Add at least one status after the colon.' });
      continue;
    }

    const hasToggleSeparator = line.includes('=>');
    const toggleTargetStatus = normalizeStatus(match[3], options.normalizeStatus) || undefined;
    if (hasToggleSeparator && !toggleTargetStatus) {
      errors.push({ line: lineNumber, message: 'Add a toggle target after => or remove the arrow.' });
      continue;
    }

    seenStates.set(checkboxState, lineNumber);
    mappings.push({ checkboxState, statuses, toggleTargetStatus });
  }

  if (mappings.length === 0 && errors.length === 0) {
    errors.push({ line: 1, message: 'Add at least one checkbox/status mapping.' });
  }

  const configuredStatuses = new Set(mappings.flatMap((mapping) => mapping.statuses));
  const doneStatuses = new Set(
    (Array.isArray(options.completionStatuses) ? options.completionStatuses : ['complete', 'wont-do'])
      .map((status) => normalizeStatus(status, options.normalizeStatus))
      .filter(Boolean),
  );
  for (let index = 0; index < mappings.length; index += 1) {
    const mappedDoneStates = new Set(mappings[index].statuses.map((status) => doneStatuses.has(status)));
    if (mappedDoneStates.size > 1) {
      errors.push({
        line: seenStates.get(mappings[index].checkboxState) || index + 1,
        message: 'One marker cannot mix completed and open statuses.',
      });
    }
    const target = mappings[index].toggleTargetStatus;
    if (target && !configuredStatuses.has(target)) {
      errors.push({
        line: seenStates.get(mappings[index].checkboxState) || index + 1,
        message: `Toggle target "${target}" is not mapped by any row.`,
      });
    }
  }

  const requiredStatuses = new Set(
    DEFAULT_LINKED_SUBITEM_MAPPINGS
      .flatMap((mapping) => mapping.statuses)
      .map((status) => normalizeStatus(status, options.normalizeStatus))
      .filter(Boolean),
  );
  for (const status of requiredStatuses) {
    if (configuredStatuses.has(status)) continue;
    errors.push({ line: 1, message: `Required system status "${status}" is not mapped by any row.` });
  }
  const migratedMapping = mappings.find((mapping) => mapping.checkboxState === MIGRATED_TASK_MAPPING.checkboxState);
  const migratedStatus = normalizeStatus(MIGRATED_TASK_MAPPING.statuses[0], options.normalizeStatus);
  if (migratedMapping && (
    migratedMapping.statuses.length !== 1
    || normalizeStatus(migratedMapping.statuses[0], options.normalizeStatus) !== migratedStatus
  )) {
    errors.push({
      line: seenStates.get(migratedMapping.checkboxState) || 1,
      message: `${MIGRATED_TASK_MAPPING.checkboxState} is reserved for the migrated system status.`,
    });
  }

  const openMapping = mappings.find((mapping) => mapping.checkboxState === '[ ]');
  if (openMapping?.statuses.some((status) => doneStatuses.has(status))) {
    errors.push({
      line: seenStates.get('[ ]') || 1,
      message: '[ ] is the reserved open checkbox and cannot map to a completed status.',
    });
  }
  const checkedMapping = mappings.find((mapping) => mapping.checkboxState === '[x]');
  if (checkedMapping && !checkedMapping.statuses.every((status) => doneStatuses.has(status))) {
    errors.push({
      line: seenStates.get('[x]') || 1,
      message: '[x] is the reserved checked checkbox and must map only to completed statuses.',
    });
  }

  const requiredStates = DEFAULT_LINKED_SUBITEM_MAPPINGS.map((mapping) => mapping.checkboxState);
  for (const state of requiredStates) {
    if (seenStates.has(state)) continue;
    errors.push({ line: 1, message: `Required system mapping ${state} is missing.` });
  }

  const rowsByStatus = new Map<string, string[]>();
  for (const mapping of mappings) {
    for (const status of mapping.statuses) {
      const states = rowsByStatus.get(status) || [];
      states.push(mapping.checkboxState);
      rowsByStatus.set(status, states);
    }
  }
  const warnings = Array.from(rowsByStatus.entries())
    .filter(([, states]) => states.length > 1)
    .map(([status, states]) => `${states[0]} is the primary marker for "${status}"; ${states.slice(1).join(', ')} remain valid alternates.`);

  return { mappings, errors, warnings };
}
