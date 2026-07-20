export type NotebookNavigatorMultiSelectModifier = 'cmdCtrl' | 'optionAlt';

export interface NotebookNavigatorModifierState {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export function isNotebookNavigatorSelectionGesture(
  modifiers: NotebookNavigatorModifierState,
  configuredModifier: NotebookNavigatorMultiSelectModifier,
  isMacOS: boolean,
  isMobile = false,
): boolean {
  if (isMobile) return false;
  if (modifiers.shiftKey) return true;
  if (configuredModifier === 'optionAlt') return modifiers.altKey;
  return isMacOS ? modifiers.metaKey : modifiers.metaKey || modifiers.ctrlKey;
}

export function collectNotebookNavigatorSelectionPaths(
  currentSelection: unknown,
  resolvePath: (rawPath: string) => string | null,
): string[] {
  const paths = new Set<string>();
  const collect = (value: unknown, depth = 0): void => {
    if (depth > 3 || value == null) return;
    if (typeof value === 'string') {
      const path = resolvePath(value.trim());
      if (path) paths.add(path);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => collect(entry, depth + 1));
      return;
    }
    if (value instanceof Set) {
      value.forEach((entry) => collect(entry, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.path === 'string') collect(record.path, depth + 1);
    collect(record.files, depth + 1);
    collect(record.focused, depth + 1);
  };
  collect(currentSelection);
  return Array.from(paths);
}

export class NotebookNavigatorHomeIntentTracker<TLeaf extends object> {
  private readonly pendingSelectionUntilByPath = new Map<string, number>();
  private readonly selectionOnlyPathByLeaf = new Map<TLeaf, string>();

  constructor(private readonly pendingIntentMs = 1500) {}

  markSelection(paths: Iterable<string>, now = Date.now()): void {
    const until = now + this.pendingIntentMs;
    for (const rawPath of paths) {
      const path = String(rawPath || '').trim();
      if (path) this.pendingSelectionUntilByPath.set(path, until);
    }
  }

  markPlainOpen(path: string): void {
    const normalizedPath = String(path || '').trim();
    if (!normalizedPath) return;
    this.pendingSelectionUntilByPath.delete(normalizedPath);
    for (const [leaf, blockedPath] of this.selectionOnlyPathByLeaf) {
      if (blockedPath === normalizedPath) this.selectionOnlyPathByLeaf.delete(leaf);
    }
  }

  shouldSuppress(leaf: TLeaf, path: string, now = Date.now()): boolean {
    this.prunePending(now);
    const normalizedPath = String(path || '').trim();
    if (!normalizedPath) return false;

    const blockedPath = this.selectionOnlyPathByLeaf.get(leaf);
    if (blockedPath && blockedPath !== normalizedPath) {
      this.selectionOnlyPathByLeaf.delete(leaf);
    } else if (blockedPath === normalizedPath) {
      return true;
    }

    const pendingUntil = this.pendingSelectionUntilByPath.get(normalizedPath) ?? 0;
    if (pendingUntil < now) return false;
    this.pendingSelectionUntilByPath.delete(normalizedPath);
    this.selectionOnlyPathByLeaf.set(leaf, normalizedPath);
    return true;
  }

  reconcileLeaf(leaf: TLeaf, currentPath: string | null): void {
    const blockedPath = this.selectionOnlyPathByLeaf.get(leaf);
    if (!blockedPath) return;
    if (!currentPath || currentPath !== blockedPath) this.selectionOnlyPathByLeaf.delete(leaf);
  }

  retainLeaves(openLeaves: ReadonlySet<TLeaf>, now = Date.now()): void {
    this.prunePending(now);
    for (const leaf of this.selectionOnlyPathByLeaf.keys()) {
      if (!openLeaves.has(leaf)) this.selectionOnlyPathByLeaf.delete(leaf);
    }
  }

  clear(): void {
    this.pendingSelectionUntilByPath.clear();
    this.selectionOnlyPathByLeaf.clear();
  }

  private prunePending(now: number): void {
    for (const [path, until] of this.pendingSelectionUntilByPath) {
      if (until < now) this.pendingSelectionUntilByPath.delete(path);
    }
  }
}
