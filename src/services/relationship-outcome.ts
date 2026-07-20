import type {
  RelationshipUnlinkAggregateOutcome,
  RelationshipSideRemovalOutcome,
  RelationshipUnlinkStatus,
} from './subitem-types';

export function classifyTwoSidedRemovalStatus(
  left: RelationshipSideRemovalOutcome,
  right: RelationshipSideRemovalOutcome,
): RelationshipUnlinkStatus {
  if (left === 'refused' || right === 'refused') {
    return left === 'removed' || right === 'removed' ? 'partial' : 'refused';
  }
  return left === 'removed' || right === 'removed' ? 'removed' : 'absent';
}

export function isAuthoritativelyAbsentAfterUnlink(status: RelationshipUnlinkStatus): boolean {
  return status === 'removed' || status === 'absent';
}

export async function runFailClosedTwoSidedRemoval(
  removeFirstSide: () => Promise<RelationshipSideRemovalOutcome>,
  removeSecondSide: () => Promise<RelationshipSideRemovalOutcome>,
): Promise<{
  status: RelationshipUnlinkStatus;
  first: RelationshipSideRemovalOutcome;
  second: RelationshipSideRemovalOutcome;
}> {
  const first = await removeFirstSide();
  if (first === 'refused') {
    return { status: 'refused', first, second: 'refused' };
  }
  const second = await removeSecondSide();
  return {
    status: classifyTwoSidedRemovalStatus(first, second),
    first,
    second,
  };
}

export type RelationshipConversionStatus = 'converted' | 'unlink-refused' | 'replacement-refused';
export type RelationshipReplacementOutcome = 'created' | 'present' | 'refused';

export async function runGuardedRelationshipConversion(
  unlinkOldRelationship: () => Promise<{ status: RelationshipUnlinkStatus }>,
  createReplacement: () => Promise<RelationshipReplacementOutcome>,
): Promise<RelationshipConversionStatus> {
  const unlinkOutcome = await unlinkOldRelationship();
  if (!isAuthoritativelyAbsentAfterUnlink(unlinkOutcome.status)) return 'unlink-refused';

  const replacementOutcome = await createReplacement();
  return replacementOutcome === 'created' || replacementOutcome === 'present'
    ? 'converted'
    : 'replacement-refused';
}

export function formatSingleRelationshipUnlinkNotice(
  status: RelationshipUnlinkStatus,
  relationLabel: string,
): string {
  if (status === 'removed') return `Removed ${relationLabel}.`;
  if (status === 'absent') return `No ${relationLabel} existed.`;
  if (status === 'partial') {
    return `Only part of ${relationLabel} was removed; the other representation could not be verified or removed.`;
  }
  return `Couldn’t remove ${relationLabel}; the current state could not be verified.`;
}

export function formatParentUnlinkAggregateNotice(
  outcome: RelationshipUnlinkAggregateOutcome,
  childName: string,
): string {
  if (outcome.discovery === 'refused') {
    return `Couldn’t read the current parent links for ${childName}; nothing was reported as removed.`;
  }
  if (outcome.partialCount > 0 || outcome.refusedCount > 0) {
    return [
      `Fully removed ${outcome.removedCount} parent link${outcome.removedCount === 1 ? '' : 's'} from ${childName}.`,
      `${outcome.partialCount} partial; ${outcome.refusedCount} refused.`,
    ].join(' ');
  }
  if (outcome.removedCount > 0) {
    return `Removed ${outcome.removedCount} parent link${outcome.removedCount === 1 ? '' : 's'} from ${childName}.`;
  }
  return `No parent links existed for ${childName}.`;
}

export function summarizeRelationshipUnlinkStatuses(
  discovery: RelationshipUnlinkAggregateOutcome['discovery'],
  statuses: RelationshipUnlinkStatus[],
): RelationshipUnlinkAggregateOutcome {
  const outcome: RelationshipUnlinkAggregateOutcome = {
    discovery,
    removedCount: 0,
    absentCount: 0,
    partialCount: 0,
    refusedCount: 0,
  };
  if (discovery === 'refused') return outcome;
  for (const status of statuses) {
    if (status === 'removed') outcome.removedCount += 1;
    else if (status === 'absent') outcome.absentCount += 1;
    else if (status === 'partial') outcome.partialCount += 1;
    else outcome.refusedCount += 1;
  }
  return outcome;
}
