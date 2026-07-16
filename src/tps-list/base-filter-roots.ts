export type PersistedFilterRootResult = {
  viewName: string;
  viewNames: string[];
  filters: unknown[] | null;
};

export function extractPersistedFilterRoots(
  parsed: Record<string, unknown> | null | undefined,
  requestedViewName: string,
  acceptedViewTypes: ReadonlySet<string>,
): PersistedFilterRootResult {
  if (!parsed || typeof parsed !== 'object') {
    return { viewName: requestedViewName, viewNames: [], filters: null };
  }

  const views = Array.isArray(parsed.views) ? parsed.views : [];
  const acceptedViews = views.filter((view): view is Record<string, unknown> => {
    if (!view || typeof view !== 'object') return false;
    return acceptedViewTypes.has(String((view as Record<string, unknown>).type || '').trim());
  });
  const viewNames = views
    .map((view) => typeof view === 'object' && view ? String((view as Record<string, unknown>).name || '').trim() : '')
    .filter(Boolean);
  const viewName = requestedViewName || String(acceptedViews[0]?.name || '').trim();
  const activeView = acceptedViews.find((view) => {
    const candidate = String(view.name || '').trim();
    return viewName ? candidate === viewName : acceptedViews.length === 1;
  });

  const filters: unknown[] = [];
  if (activeView?.filters) filters.push(activeView.filters);
  if (parsed.filters) filters.push(parsed.filters);
  return { viewName, viewNames, filters: filters.length ? filters : null };
}

export function composeEffectiveFilterRoots(runtimeRoots: unknown[], persistedRoots: unknown[]): unknown[] {
  const roots: unknown[] = [];
  const seen = new Set<string>();
  for (const root of [...runtimeRoots, ...persistedRoots]) {
    if (root == null) continue;
    let key: string;
    try {
      key = JSON.stringify(root) ?? String(root);
    } catch {
      key = String(root);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(root);
  }
  return roots;
}

export function combineEffectiveFilterResults(results: Array<boolean | null>): boolean | null {
  return combineFilterTreeResults(results, 'and');
}

export function combineFilterTreeResults(results: Array<boolean | null>, mode: 'and' | 'or'): boolean | null {
  if (!results.length) return null;
  if (mode === 'and') {
    if (results.some((result) => result === false)) return false;
    return results.some((result) => result == null) ? null : true;
  }
  if (results.some((result) => result === true)) return true;
  return results.some((result) => result == null) ? null : false;
}

export function extractFilterRootCandidates(candidates: unknown[]): unknown[] {
  const roots: unknown[] = [];
  for (const candidate of candidates) collectFilterRootCandidates(candidate, roots);
  return roots;
}

function collectFilterRootCandidates(root: unknown, roots: unknown[]): void {
  if (!root) return;
  if (isDirectFilterRoot(root)) {
    roots.push(root);
    return;
  }
  if (Array.isArray(root)) {
    for (const item of root) collectFilterRootCandidates(item, roots);
    return;
  }
  if (typeof root !== 'object') return;
  const record = root as Record<string, unknown>;
  for (const key of ['filters', 'children', 'data', 'query', 'queryState']) {
    collectFilterRootCandidates(record[key], roots);
  }
}

function isDirectFilterRoot(root: unknown): boolean {
  if (!root) return false;
  if (typeof root === 'string') return !!root.trim();
  if (Array.isArray(root)) return root.some((item) => isDirectFilterRoot(item));
  if (typeof root !== 'object') return false;
  const record = root as Record<string, unknown>;
  return ['and', 'or', 'all', 'any', 'not', 'property', 'field']
    .some((key) => Object.prototype.hasOwnProperty.call(record, key));
}
