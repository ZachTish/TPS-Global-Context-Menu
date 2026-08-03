export type LinkedSubitemParentMutationResult = 'changed' | 'unchanged' | 'blocked';
export type LinkedSubitemChildVerificationResult = 'target' | 'previous' | 'diverged';
export type LinkedSubitemParentVerificationResult = 'previous' | 'updated' | 'diverged';

export interface GuardedLinkedSubitemMutationOptions {
  needsChildWrite: boolean;
  writeParent: () => Promise<LinkedSubitemParentMutationResult>;
  writeChild: () => Promise<void>;
  readAuthoritativeChild: () => Promise<LinkedSubitemChildVerificationResult>;
  restoreParent: () => Promise<void>;
  readAuthoritativeParent: () => Promise<LinkedSubitemParentVerificationResult>;
}

export interface LinkedSubitemMutationSourceLine {
  parentPath: string;
  lineNumber: number;
  rawLine: string;
}

export interface GuardedLinkedSubitemMutationResult {
  ok: boolean;
  changed: boolean;
  parentChanged: boolean;
  childChanged: boolean;
  parentRolledBack: boolean;
  reason:
    | 'done'
    | 'unchanged'
    | 'parent-blocked'
    | 'parent-failed'
    | 'child-blocked'
    | 'child-failed'
    | 'child-diverged'
    | 'child-verification-failed'
    | 'parent-rollback-failed';
  error?: unknown;
}

/**
 * Coordinates the two-file linked-subitem mutation without pretending Obsidian
 * offers a cross-file transaction. The reversible parent-line write happens
 * first; a blocked child write compensates that parent write before returning.
 */
export async function runGuardedLinkedSubitemMutation(
  options: GuardedLinkedSubitemMutationOptions,
): Promise<GuardedLinkedSubitemMutationResult> {
  let parentResult: LinkedSubitemParentMutationResult;
  try {
    parentResult = await options.writeParent();
  } catch (error) {
    return buildResult('parent-failed', false, false, false, false, error);
  }

  if (parentResult === 'blocked') {
    return buildResult('parent-blocked', false, false, false, false);
  }
  const parentChanged = parentResult === 'changed';
  if (!options.needsChildWrite) {
    return parentChanged
      ? buildResult('done', true, true, false, false)
      : buildResult('unchanged', true, false, false, false);
  }

  let childWriteError: unknown;
  try {
    await options.writeChild();
  } catch (error) {
    childWriteError = error;
  }

  let childState: LinkedSubitemChildVerificationResult;
  try {
    childState = await options.readAuthoritativeChild();
  } catch (error) {
    return buildResult(
      'child-verification-failed',
      false,
      parentChanged,
      false,
      false,
      childWriteError ?? error,
    );
  }
  if (!isChildVerificationResult(childState)) {
    return buildResult(
      'child-verification-failed',
      false,
      parentChanged,
      false,
      false,
      childWriteError ?? new Error(`Invalid authoritative child state: ${String(childState)}`),
    );
  }
  if (childState === 'target') {
    return buildResult('done', true, parentChanged, true, false);
  }

  let parentRolledBack = !parentChanged;
  let parentRollbackError: unknown;
  if (parentChanged) {
    try {
      await options.restoreParent();
    } catch (error) {
      parentRollbackError = error;
    }

    try {
      parentRolledBack = await options.readAuthoritativeParent() === 'previous';
    } catch (error) {
      parentRollbackError ??= error;
      parentRolledBack = false;
    }
  }
  if (!parentRolledBack) {
    return buildResult(
      'parent-rollback-failed',
      false,
      parentChanged,
      false,
      false,
      parentRollbackError ?? childWriteError,
    );
  }
  return buildResult(
    childState === 'diverged'
      ? 'child-diverged'
      : childWriteError === undefined
        ? 'child-blocked'
        : 'child-failed',
    false,
    parentChanged,
    false,
    parentRolledBack,
    childWriteError,
  );
}

function isChildVerificationResult(value: unknown): value is LinkedSubitemChildVerificationResult {
  return value === 'target' || value === 'previous' || value === 'diverged';
}

export function resolveLinkedSubitemMutationLineIndex(
  lines: readonly string[],
  parentPath: string,
  sourceLine: LinkedSubitemMutationSourceLine | undefined,
  isLineForChild: (line: string) => boolean,
): number {
  if (sourceLine) {
    if (
      sourceLine.parentPath !== parentPath
      || !Number.isInteger(sourceLine.lineNumber)
      || sourceLine.lineNumber < 0
      || typeof lines[sourceLine.lineNumber] !== 'string'
      || lines[sourceLine.lineNumber] !== sourceLine.rawLine
      || !isLineForChild(lines[sourceLine.lineNumber] || '')
    ) {
      return -1;
    }
    return sourceLine.lineNumber;
  }

  let resolvedIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (!isLineForChild(lines[index] || '')) continue;
    if (resolvedIndex >= 0) return -1;
    resolvedIndex = index;
  }
  return resolvedIndex;
}

function buildResult(
  reason: GuardedLinkedSubitemMutationResult['reason'],
  ok: boolean,
  parentChanged: boolean,
  childChanged: boolean,
  parentRolledBack: boolean,
  error?: unknown,
): GuardedLinkedSubitemMutationResult {
  return {
    ok,
    changed: ok && (parentChanged || childChanged),
    parentChanged,
    childChanged,
    parentRolledBack,
    reason,
    ...(error === undefined ? {} : { error }),
  };
}
