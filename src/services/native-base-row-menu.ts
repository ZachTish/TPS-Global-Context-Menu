import { TFile } from 'obsidian';

/** Core's table menu requires a selection, but a touch press never creates one.
 * Use the current table's own cell/data mapping; never infer a file from text,
 * DOM order, the enclosing embed, or the active workspace file.
 */
export function runNativeBaseRowMenu(
  view: any,
  original: (...args: any[]) => unknown,
  event: MouseEvent,
  target: HTMLElement,
): unknown {
  if (event.defaultPrevented) return;
  const block = () => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  try {
    const cell = view.getCellFromDom(target);
    const index = cell && view.getCellIndex(cell);
    const groups = view.data?.groupedData;
    const properties = view.data?.properties;
    const validIndex = index && [index.groupIdx, index.row, index.column].every(Number.isInteger)
      && index.groupIdx >= 0 && index.row >= 0 && index.column >= 0;
    if (!validIndex || !view.containerEl.contains(target) || !groups?.[index.groupIdx]
      || !properties?.[index.column]) return block();
    const entries = groups[index.groupIdx].entries;
    const live = (row: number) => {
      const file = entries?.[row]?.file;
      return file instanceof TFile && view.app.vault.getFileByPath(file.path) === file;
    };
    if (!live(index.row)) return block();

    const selection = view.selection;
    const containsTarget = selection && selection.groupIdx === index.groupIdx
      && [selection.top, selection.bottom, selection.start, selection.end].every(Number.isInteger)
      && selection.top >= 0 && selection.top <= index.row && index.row <= selection.bottom
      && selection.bottom < entries.length && selection.start >= 0
      && selection.start <= index.column && index.column <= selection.end
      && selection.end < properties.length;
    if (containsTarget) {
      // A stale selected row must not silently target a replacement at its path.
      for (let row = selection.top; row <= selection.bottom; row++) if (!live(row)) return block();
    } else {
      view.selection = {
        groupIdx: index.groupIdx, top: index.row, bottom: index.row,
        start: index.column, end: index.column,
      };
      view.activeCell = index;
    }
    return original.call(view, event, target);
  } finally {
    // A core compatibility change must never expose the parent Base/embed menu.
    block();
  }
}

/** Core binds its handler in the constructor. A parent capture boundary also
 * protects already-open tables when GCM is reloaded; no prototype replacement
 * can reach a previously bound callback. Each view owns its listener lifetime.
 */
export function bindNativeBaseRowMenu(view: any, onDispose: () => void): (() => void) | null {
  const boundary = view.containerEl?.parentElement;
  if (!boundary || typeof view.register !== 'function') return null;
  const original = view.onTableCellContextmenu;
  const listener = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest('.bases-td') : null;
    if (!target || target.closest('.bases-table-container') !== view.containerEl) return;
    runNativeBaseRowMenu(view, original, event, target as HTMLElement);
  };
  boundary.addEventListener('contextmenu', listener, true);
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    boundary.removeEventListener('contextmenu', listener, true);
    onDispose();
  };
  view.register(cleanup);
  return cleanup;
}
