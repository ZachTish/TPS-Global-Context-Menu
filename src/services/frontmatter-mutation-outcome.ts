export type FrontmatterMutationOutcome =
  | 'changed'
  | 'unchanged'
  | 'guarded-abort'
  | 'parse-failed'
  | 'write-refused'
  | 'unsupported';

export function didFrontmatterMutationChange(outcome: FrontmatterMutationOutcome): boolean {
  return outcome === 'changed';
}

export function isFrontmatterMutationReady(outcome: FrontmatterMutationOutcome): boolean {
  return outcome === 'changed' || outcome === 'unchanged';
}
