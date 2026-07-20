import type { FrontmatterMutationOutcome } from '../services/frontmatter-mutation-outcome';

export type GuardedStatusWriteResult = 'changed' | 'unchanged' | 'stale' | 'refused';

type StatusNormalizer = (value: unknown) => string;

export function readChecklistStatus(
  frontmatter: Record<string, unknown> | null | undefined,
  statusKey: string,
  normalizeStatus: StatusNormalizer,
): string {
  if (!frontmatter || typeof frontmatter !== 'object') return '';
  const actualKey = Object.keys(frontmatter).find((key) => key.toLowerCase() === statusKey.toLowerCase());
  const raw = actualKey ? frontmatter[actualKey] : undefined;
  const value = Array.isArray(raw) ? raw.find((entry) => String(entry ?? '').trim()) : raw;
  return normalizeStatus(value);
}

/**
 * Applies a status transition only when the frontmatter revision still has the
 * status that was observed by the caller. This function runs inside Vault.process.
 */
export function applyGuardedChecklistStatusTransition(
  frontmatter: Record<string, unknown>,
  options: {
    statusKey: string;
    expectedStatus: string;
    targetStatus: string;
    normalizeStatus: StatusNormalizer;
    completedAt: string;
  },
): boolean {
  const normalize = options.normalizeStatus;
  if (readChecklistStatus(frontmatter, options.statusKey, normalize) !== normalize(options.expectedStatus)) {
    return false;
  }

  const actualKey = Object.keys(frontmatter)
    .find((key) => key.toLowerCase() === options.statusKey.toLowerCase()) || options.statusKey;
  const completedDateKey = Object.keys(frontmatter).find((key) => key.toLowerCase() === 'completeddate');
  if (options.targetStatus) frontmatter[actualKey] = options.targetStatus;
  else delete frontmatter[actualKey];

  const normalizedTarget = normalize(options.targetStatus);
  if (normalizedTarget === 'complete' || normalizedTarget === 'completed' || normalizedTarget === 'done') {
    const targetKey = completedDateKey || 'completedDate';
    frontmatter[targetKey] = frontmatter[targetKey] || options.completedAt;
  } else if (completedDateKey) {
    delete frontmatter[completedDateKey];
  }
  return true;
}

export function classifyGuardedStatusWriteOutcome(
  outcome: FrontmatterMutationOutcome,
  guardWasStale: boolean,
): GuardedStatusWriteResult {
  if (outcome === 'changed' || outcome === 'unchanged') return outcome;
  if (outcome === 'guarded-abort' && guardWasStale) return 'stale';
  return 'refused';
}

export async function recoverExternalChecklistCompletionAfterScanFailure(options: {
  previousStatus: string;
  liveStatus: string;
  isCompletionStatus: (status: string) => boolean;
  writeStatus: (targetStatus: string, expectedStatus: string) => Promise<GuardedStatusWriteResult>;
}): Promise<{ restoreStatus: string; outcome: GuardedStatusWriteResult }> {
  const restoreStatus = options.isCompletionStatus(options.previousStatus) ? '' : options.previousStatus;
  const outcome = await options.writeStatus(restoreStatus, options.liveStatus);
  return { restoreStatus, outcome };
}
