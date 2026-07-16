export type TpsListHierarchyInput = {
  kind: 'note' | 'task' | 'heading';
  nativeIndex: number;
  taskKey?: string;
  parentTaskKey?: string;
};

export type TpsListHierarchyOutput<T> = {
  row: T;
  depth: number;
};

type HierarchyNode<T> = {
  row: T;
  children: HierarchyNode<T>[];
};

export function getMarkdownIndentColumns(line: string): number {
  const leadingWhitespace = String(line ?? '').match(/^[\t ]*/u)?.[0] ?? '';
  let columns = 0;
  for (const character of leadingWhitespace) {
    columns = character === '\t' ? columns + (4 - (columns % 4)) : columns + 1;
  }
  return columns;
}

export function orderTpsListHierarchy<T extends TpsListHierarchyInput>(
  rows: T[],
  compare: (a: T, b: T) => number,
): Array<TpsListHierarchyOutput<T>> {
  const nodes = rows.map((row) => ({ row, children: [] as HierarchyNode<T>[] }));
  const taskNodes = new Map<string, HierarchyNode<T>>();
  for (const node of nodes) {
    if (node.row.kind === 'task' && node.row.taskKey) taskNodes.set(node.row.taskKey, node);
  }

  const roots: HierarchyNode<T>[] = [];
  for (const node of nodes) {
    const parent = node.row.kind === 'task' && node.row.parentTaskKey
      ? taskNodes.get(node.row.parentTaskKey)
      : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  const sortNodes = (items: HierarchyNode<T>[]): HierarchyNode<T>[] =>
    [...items].sort((a, b) => compare(a.row, b.row));
  const ordered: Array<TpsListHierarchyOutput<T>> = [];
  const append = (node: HierarchyNode<T>, depth: number, ancestry: Set<HierarchyNode<T>>): void => {
    if (ancestry.has(node)) return;
    ordered.push({ row: node.row, depth });
    const nextAncestry = new Set(ancestry).add(node);
    for (const child of sortNodes(node.children)) append(child, depth + 1, nextAncestry);
  };
  for (const root of sortNodes(roots)) append(root, 0, new Set());
  return ordered;
}
