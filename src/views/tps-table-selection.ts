import { parseTaskLine } from '../utils/task-line-metadata';

export interface TpsTableSelectionEntry {
  selectionId: string;
  line: string;
}

export function isTpsTableTaskSelectionEntry(entry: Pick<TpsTableSelectionEntry, 'line'>): boolean {
  return parseTaskLine(entry.line) != null;
}

export function getTpsTableTaskSelectionOrder(entries: readonly TpsTableSelectionEntry[]): string[] {
  return entries
    .filter((entry) => isTpsTableTaskSelectionEntry(entry))
    .map((entry) => entry.selectionId);
}

export function constrainTpsTableTaskSelection(
  selectedIds: Iterable<string>,
  taskOrder: readonly string[],
): Set<string> {
  const taskIds = new Set(taskOrder);
  const constrained = new Set<string>();
  for (const id of selectedIds) {
    if (taskIds.has(id)) constrained.add(id);
  }
  return constrained;
}
