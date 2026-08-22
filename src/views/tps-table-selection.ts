import { parseTaskLine } from '../utils/task-line-metadata';

export interface TpsTableSelectionEntry {
  selectionId: string;
  line: string;
  entityKind?: 'line' | 'note';
}

export type TpsTableSelectionKind = 'task' | 'note';

export function isTpsTableTaskSelectionEntry(entry: Pick<TpsTableSelectionEntry, 'line'>): boolean {
  return parseTaskLine(entry.line) != null;
}

export function getTpsTableSelectionKind(
  entry: Pick<TpsTableSelectionEntry, 'line' | 'entityKind'>,
): TpsTableSelectionKind | null {
  if (entry.entityKind === 'note') return 'note';
  return isTpsTableTaskSelectionEntry(entry) ? 'task' : null;
}

export function getTpsTableSelectionOrder(
  entries: readonly TpsTableSelectionEntry[],
  kind: TpsTableSelectionKind,
): string[] {
  return entries
    .filter((entry) => getTpsTableSelectionKind(entry) === kind)
    .map((entry) => entry.selectionId);
}

export function constrainTpsTableSelection(
  selectedIds: Iterable<string>,
  order: readonly string[],
): Set<string> {
  const allowedIds = new Set(order);
  const constrained = new Set<string>();
  for (const id of selectedIds) {
    if (allowedIds.has(id)) constrained.add(id);
  }
  return constrained;
}

export function getTpsTableTaskSelectionOrder(entries: readonly TpsTableSelectionEntry[]): string[] {
  return getTpsTableSelectionOrder(entries, 'task');
}

export function constrainTpsTableTaskSelection(
  selectedIds: Iterable<string>,
  taskOrder: readonly string[],
): Set<string> {
  return constrainTpsTableSelection(selectedIds, taskOrder);
}
