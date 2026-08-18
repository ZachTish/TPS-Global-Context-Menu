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
