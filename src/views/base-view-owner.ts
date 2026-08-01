import { FileView, TFile, type App } from 'obsidian';

/**
 * Resolve the file owned by the workspace view that actually contains a custom
 * Bases view. This deliberately uses only Obsidian's public workspace, View,
 * and FileView surfaces so split panes cannot be confused by global focus.
 */
export function getOwningWorkspaceFile(
  app: App,
  containerEl: HTMLElement,
  extension: string,
): TFile | null {
  const expectedExtension = extension.trim().replace(/^\./, '').toLowerCase();
  if (!expectedExtension) return null;
  if (typeof app?.workspace?.iterateAllLeaves !== 'function') return null;

  let result: TFile | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if (result) return;
    const view = leaf.view;
    if (!(view instanceof FileView) || !view.containerEl.contains(containerEl)) return;
    const file = view.file;
    if (file instanceof TFile && file.extension.toLowerCase() === expectedExtension) result = file;
  });
  return result;
}
