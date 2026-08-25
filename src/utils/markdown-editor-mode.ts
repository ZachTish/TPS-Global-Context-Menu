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

  // A strict signal must fail closed. Obsidian Mobile can retain `source:false`
  // while mounting an editor root without `is-live-preview`; trusting that
  // stale flag caused TPS replacements to render over literal Source mode.
  // Conversely, `source:true` must stay literal while the DOM is transitioning.
  if (input.sourceState === true) return true;
  if (isStrictSourceEditorRoot(input.sourceRoot)) return true;
  if (isLivePreviewEditorRoot(input.sourceRoot)) return false;
  if (input.sourceState === false) return false;
  return isStrictSourceEditorRoot(input.sourceRoot);
}

export function shouldRepairStaleLivePreviewSnapshot(input: {
  reportedMode?: unknown;
  stateMode?: unknown;
  sourceState?: unknown;
  sourceRoot?: MarkdownEditorRootLike | null;
}): boolean {
  if (input.reportedMode === 'preview' || input.stateMode === 'preview') return false;
  return input.sourceState === false
    && (input.reportedMode === 'source' || input.stateMode === 'source')
    && isStrictSourceEditorRoot(input.sourceRoot);
}
