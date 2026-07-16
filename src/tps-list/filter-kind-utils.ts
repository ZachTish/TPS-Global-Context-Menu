const STRUCTURAL_KIND_VALUES = new Set([
  'task',
  'tasks',
  'bullet',
  'bullets',
  'note',
  'notes',
  'all',
  'mixed',
  'heading',
  'headings',
  'header',
  'headers',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

export type TpsListLineItemKind = 'task' | 'bullet' | 'heading';

export function normalizeTpsListHeadingKind(value: unknown): 'heading' | `h${1 | 2 | 3 | 4 | 5 | 6}` | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['heading', 'headings', 'header', 'headers'].includes(normalized)) return 'heading';
  return /^h[1-6]$/u.test(normalized) ? normalized as `h${1 | 2 | 3 | 4 | 5 | 6}` : null;
}

export function matchesTpsListStructuralKind(
  value: unknown,
  itemKind: TpsListLineItemKind,
  headingLevel?: number,
): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (itemKind === 'heading') {
    const headingKind = normalizeTpsListHeadingKind(normalized);
    return headingKind === 'heading' || headingKind === `h${headingLevel}`;
  }
  if (itemKind === 'task') return normalized === 'task' || normalized === 'tasks';
  return normalized === 'bullet' || normalized === 'bullets';
}

export function isKanbanStructuralKindValue(value: unknown): boolean {
  return STRUCTURAL_KIND_VALUES.has(String(value ?? '').trim().toLowerCase());
}

export function isBareSemanticKindFilter(property: unknown, values: unknown[]): boolean {
  if (String(property ?? '').trim().toLowerCase() !== 'kind') return false;
  const normalized = values
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return normalized.length > 0 && normalized.some((value) => !isKanbanStructuralKindValue(value));
}

export function parseBareSemanticKindExpression(expression: unknown): string | null {
  const raw = String(expression ?? '').trim().replace(/^!+\s*/u, '');
  const match = raw.match(/^kind\s*(?:==|=|!=|!==|is|equals?)\s*(?:"([^"]+)"|'([^']+)'|([^\s].*?))\s*$/i);
  const value = String(match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
  return value && !isKanbanStructuralKindValue(value) ? value : null;
}

export function filterTreeIncludesStructuralKind(node: unknown, expectedKind: TpsListLineItemKind): boolean {
  if (!node) return false;
  if (Array.isArray(node)) return node.some((child) => filterTreeIncludesStructuralKind(child, expectedKind));
  if (typeof node === 'string') {
    const match = node.trim().replace(/^!+\s*/u, '').match(
      /^(?:(?:tps|kanban)\.)?(?:itemtype|itemkind|kind)\s*(?:==|=|is|equals?)\s*["']?([a-z0-9-]+)["']?$/i,
    );
    const value = String(match?.[1] || '');
    return expectedKind === 'heading'
      ? normalizeTpsListHeadingKind(value) != null
      : matchesTpsListStructuralKind(value, expectedKind);
  }
  if (typeof node !== 'object') return false;

  const record = node as Record<string, unknown>;
  const property = String(record.property ?? record.field ?? '')
    .trim()
    .toLowerCase()
    .replace(/^(?:tps|kanban)\./u, '');
  if (['itemtype', 'itemkind', 'kind'].includes(property)) {
    const rawValues = record.values ?? record.value;
    const values = Array.isArray(rawValues) ? rawValues : rawValues == null ? [] : [rawValues];
    if (values.some((value) => expectedKind === 'heading'
      ? normalizeTpsListHeadingKind(value) != null
      : matchesTpsListStructuralKind(value, expectedKind))) return true;
  }
  return Object.values(record).some((value) => filterTreeIncludesStructuralKind(value, expectedKind));
}
