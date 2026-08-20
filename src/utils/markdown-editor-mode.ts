export type MarkdownEditorRootLike = {
  matches(selector: string): boolean;
  classList: {
    contains(token: string): boolean;
  };
};

export function isLivePreviewEditorRoot(
  root: MarkdownEditorRootLike | null | undefined,
): boolean {
  return !!root
    && root.matches('.markdown-source-view')
    && root.classList.contains('is-live-preview');
}

export function isStrictSourceEditorRoot(
  root: MarkdownEditorRootLike | null | undefined,
): boolean {
  return !!root
    && root.matches('.markdown-source-view')
    && !root.classList.contains('is-live-preview');
}

export function isStrictSourceModeSnapshot(input: {
  reportedMode?: unknown;
  stateMode?: unknown;
  sourceState?: unknown;
  sourceRoot?: MarkdownEditorRootLike | null;
}): boolean {
  if (input.reportedMode === 'preview') return false;

  const reportsSource = input.reportedMode === 'source'
    || input.stateMode === 'source'
    || !!input.sourceRoot;
  if (!reportsSource) return false;

  // Desktop commonly persists this boolean, but mobile builds can omit it.
  // When it exists it is the strongest signal and avoids trusting stale DOM
  // during a mode transition. Otherwise the actual editor root distinguishes
  // strict Source from Live Preview reliably.
  if (input.sourceState === true) return true;
  if (input.sourceState === false) return false;
  return isStrictSourceEditorRoot(input.sourceRoot);
}
