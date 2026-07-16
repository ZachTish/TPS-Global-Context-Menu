export function getOrderedSelectionRange<T>(order: readonly T[], anchor: T | null, target: T): T[] {
  const targetIndex = order.indexOf(target);
  if (anchor == null || targetIndex < 0) return [target];
  const anchorIndex = order.indexOf(anchor);
  if (anchorIndex < 0) return [target];
  const [from, to] = anchorIndex < targetIndex
    ? [anchorIndex, targetIndex]
    : [targetIndex, anchorIndex];
  return order.slice(from, to + 1);
}

export interface OrderedSelectionToggle<T> {
  selected: Set<T>;
  anchor: T | null;
  removed: boolean;
}

/**
 * Toggle one item while keeping the range anchor on an item that is still selected.
 * A removed item must not survive as a phantom Shift-click anchor.
 */
export function toggleOrderedSelection<T>(
  selectedValues: Iterable<T>,
  target: T,
  order: readonly T[],
): OrderedSelectionToggle<T> {
  const selected = new Set(selectedValues);
  const removed = selected.delete(target);
  if (!removed) {
    selected.add(target);
    return { selected, anchor: target, removed: false };
  }

  const anchor = [...order].reverse().find((candidate) => selected.has(candidate)) ?? null;
  return { selected, anchor, removed: true };
}
