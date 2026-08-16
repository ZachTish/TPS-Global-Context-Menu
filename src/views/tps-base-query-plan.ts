import type { CustomProperty } from '../types';
import { normalizePropertyKeyIdentity } from '../utils/property-key-identity';
import {
  validateLogBaseFilterRoots,
  type LogBaseFilterFailure,
} from './log-base-filter';

export type TpsBaseRowFamily = 'note' | 'task' | 'bullet' | 'heading' | 'line';

export type TpsBaseQueryPlan = {
  roots: readonly unknown[];
  viewName: string;
  signature: string;
  valid: boolean;
  diagnostics: readonly LogBaseFilterFailure[];
  rowFamilies: ReadonlySet<TpsBaseRowFamily>;
};

const ALL_ROW_FAMILIES = new Set<TpsBaseRowFamily>(['note', 'task', 'bullet', 'heading', 'line']);
const QUERY_PLAN_CACHE_LIMIT = 128;
const queryPlanCache = new Map<string, TpsBaseQueryPlan>();

export function compileTpsBaseQueryPlan(input: {
  roots: readonly unknown[];
  viewName?: string;
  configuredProperties?: readonly CustomProperty[];
}): TpsBaseQueryPlan {
  const roots = Object.freeze([...input.roots]);
  const schema = (input.configuredProperties ?? []).map((property) => ({
    id: property.id,
    key: property.key,
    type: property.type,
  }));
  const cacheKey = stableSerialize({ roots, viewName: String(input.viewName || '').trim(), schema });
  const cached = queryPlanCache.get(cacheKey);
  if (cached) {
    queryPlanCache.delete(cacheKey);
    queryPlanCache.set(cacheKey, cached);
    return cached;
  }
  const validation = validateLogBaseFilterRoots(roots, input.configuredProperties ?? []);
  const rowFamilies = inferRootFamilies(roots);
  const plan = Object.freeze({
    roots,
    viewName: String(input.viewName || '').trim(),
    signature: cacheKey,
    valid: validation.valid,
    diagnostics: Object.freeze([...validation.diagnostics]),
    rowFamilies,
  });
  queryPlanCache.set(cacheKey, plan);
  while (queryPlanCache.size > QUERY_PLAN_CACHE_LIMIT) {
    const oldest = queryPlanCache.keys().next().value as string | undefined;
    if (oldest == null) break;
    queryPlanCache.delete(oldest);
  }
  return plan;
}

function inferRootFamilies(roots: readonly unknown[]): ReadonlySet<TpsBaseRowFamily> {
  if (!roots.length) return new Set(ALL_ROW_FAMILIES);
  let current = new Set(ALL_ROW_FAMILIES);
  for (const root of roots) current = intersectFamilies(current, inferNodeFamilies(root));
  return current;
}

function inferNodeFamilies(node: unknown): Set<TpsBaseRowFamily> {
  if (!node) return new Set(ALL_ROW_FAMILIES);
  if (Array.isArray(node)) return intersectMany(node.map(inferNodeFamilies));
  if (typeof node === 'string') return inferExpressionFamilies(node);
  if (typeof node !== 'object') return new Set(ALL_ROW_FAMILIES);
  const record = node as Record<string, unknown>;
  if ('not' in record) return new Set(ALL_ROW_FAMILIES);
  const andChildren = 'and' in record ? asArray(record.and) : 'all' in record ? asArray(record.all) : null;
  if (andChildren) return intersectMany(andChildren.map(inferNodeFamilies));
  const orChildren = 'or' in record ? asArray(record.or) : 'any' in record ? asArray(record.any) : null;
  if (orChildren) return unionMany(orChildren.map(inferNodeFamilies));
  const property = String(record.property ?? record.field ?? record.key ?? record.left ?? record.lhs ?? '').trim();
  const expected = record.values ?? record.value ?? record.expected ?? record.right ?? record.rhs ?? record.target;
  return inferPropertyFamilies(property, asArray(expected));
}

function inferExpressionFamilies(rawExpression: string): Set<TpsBaseRowFamily> {
  const expression = String(rawExpression || '').trim().replace(/^!+\s*/u, '');
  if (!expression || rawExpression.trim().startsWith('!')) return new Set(ALL_ROW_FAMILIES);
  const comparison = expression.match(/^([\s\S]+?)\s*(?:===|==|=|\bis\b|\bequals?\b)\s*(?:["']([^"']+)["']|([^\s]+))\s*$/iu);
  if (!comparison) {
    const property = expression.match(/^([\s\S]+?)\.[\p{L}_$][\p{L}\p{N}_$-]*\s*\(/u)?.[1] || '';
    return inferPropertyFamilies(property, []);
  }
  return inferPropertyFamilies(comparison[1], [comparison[2] || comparison[3]]);
}

function inferPropertyFamilies(rawProperty: string, expected: unknown[]): Set<TpsBaseRowFamily> {
  const property = String(rawProperty || '').trim().toLocaleLowerCase();
  const normalized = normalizePropertyKeyIdentity(property);
  if (property.startsWith('note.') || property.startsWith('frontmatter.') || property.startsWith('properties.')) {
    return new Set(['note']);
  }
  if (property.startsWith('task.')) return new Set(['task']);
  if (property.startsWith('heading.')) return new Set(['heading']);
  if (property.startsWith('line.')) return new Set(['task', 'bullet', 'heading', 'line']);
  if (['itemkind', 'itemtype'].includes(normalized)) {
    return familiesForKindValues(expected, false);
  }
  if (normalized === 'kind') return familiesForKindValues(expected, true);
  return new Set(ALL_ROW_FAMILIES);
}

function familiesForKindValues(values: unknown[], additive: boolean): Set<TpsBaseRowFamily> {
  if (!values.length) return new Set(ALL_ROW_FAMILIES);
  const families = new Set<TpsBaseRowFamily>();
  for (const raw of values.flatMap((value) => Array.isArray(value) ? value : [value])) {
    const value = String(raw ?? '').trim().toLocaleLowerCase();
    if (['task', 'tasks'].includes(value)) families.add('task');
    else if (['bullet', 'bullets'].includes(value)) families.add('bullet');
    else if (['heading', 'headings', 'header', 'headers'].includes(value) || /^h[1-6]$/u.test(value)) families.add('heading');
    else if (['note', 'notes'].includes(value)) families.add('note');
    else if (additive) {
      // Authored record kinds such as `project` are note records, while task
      // rows may add the same authored identity beside their structural task
      // kind. Bullets/headings are not record candidates unless a structural
      // clause or formula explicitly asks for those families.
      families.add('note');
      families.add('task');
      families.add('line');
    }
  }
  return families.size ? families : new Set(ALL_ROW_FAMILIES);
}

function intersectMany(sets: Set<TpsBaseRowFamily>[]): Set<TpsBaseRowFamily> {
  if (!sets.length) return new Set(ALL_ROW_FAMILIES);
  return sets.slice(1).reduce((result, set) => intersectFamilies(result, set), new Set(sets[0]));
}

function unionMany(sets: Set<TpsBaseRowFamily>[]): Set<TpsBaseRowFamily> {
  if (!sets.length) return new Set(ALL_ROW_FAMILIES);
  const result = new Set<TpsBaseRowFamily>();
  for (const set of sets) for (const family of set) result.add(family);
  return result;
}

function intersectFamilies(left: Set<TpsBaseRowFamily>, right: Set<TpsBaseRowFamily>): Set<TpsBaseRowFamily> {
  return new Set(Array.from(left).filter((family) => right.has(family)));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}
