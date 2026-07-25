import { parseTpsListHeadingLine } from '../tps-list/heading-line-utils';

export type TpsTableLineKind = 'bullet' | 'task' | 'heading';

export type TpsTableLineCreateDefaults = {
  kind: TpsTableLineKind | null;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  targetPath: string | null;
  targetPathSpecified: boolean;
  fields: Record<string, string>;
};

type PartialLineCreateDefaults = Partial<Omit<TpsTableLineCreateDefaults, 'fields'>> & {
  fields?: Record<string, string>;
};

type ResolveValue = (value: string) => string;

export function resolveTpsTableLineCreateDefaults(
  roots: unknown[],
  resolveValue: ResolveValue = (value) => value,
): TpsTableLineCreateDefaults {
  let resolved: PartialLineCreateDefaults = {};
  for (const root of roots) resolved = mergePreferred(resolved, inferNodeDefaults(root, resolveValue));
  return {
    kind: resolved.kind ?? null,
    ...(resolved.headingLevel ? { headingLevel: resolved.headingLevel } : {}),
    targetPath: resolved.targetPath ?? null,
    targetPathSpecified: resolved.targetPathSpecified === true,
    fields: resolved.fields ?? {},
  };
}

export function hasTpsTableLineKindFilter(roots: unknown[]): boolean {
  return roots.some((root) => nodeHasLineKindFilter(root));
}

export function getTpsTableMarkdownLineKind(line: string): TpsTableLineKind | null {
  if (parseTpsListHeadingLine(line)) return 'heading';
  if (/^\s*[-+*]\s+\[[^\]]\]\s*/u.test(line)) return 'task';
  if (/^\s*[-+*]\s+/u.test(line)) return 'bullet';
  return null;
}

export function getTpsTableTaskQueryFields(
  line: string,
  resolveStatus: (checkboxState: string) => string = defaultStatusForCheckboxState,
  isDoneStatus: (status: string) => boolean = defaultIsDoneStatus,
): Record<string, string> {
  const markerMatch = String(line || '').match(/^\s*[-+*]\s+\[([^\]])\]\s*/u);
  if (!markerMatch) return {};
  const checkboxState = `[${markerMatch[1]}]`;
  const status = String(resolveStatus(checkboxState) || defaultStatusForCheckboxState(checkboxState))
    .trim()
    .toLowerCase();
  const done = isDoneStatus(status);
  return {
    status,
    checkboxstatus: status,
    open: String(!done),
    isopen: String(!done),
    done: String(done),
    isdone: String(done),
    completed: String(done),
    complete: String(done),
  };
}

export function buildTpsTableMarkdownLine(
  kind: TpsTableLineKind,
  title: string,
  fields: Record<string, string>,
  options: {
    checkboxState?: string | null;
    headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
    tags?: Iterable<string>;
  } = {},
): string {
  const normalizedTitle = String(title || '').replace(/\s*\n\s*/gu, ' ').trim();
  const checkboxState = normalizeCheckboxState(options.checkboxState || '[ ]');
  const headingLevel = Math.max(1, Math.min(6, Number(options.headingLevel) || 1));
  const prefix = kind === 'task' ? `- ${checkboxState} ` : kind === 'heading' ? `${'#'.repeat(headingLevel)} ` : '- ';
  const tags = Array.from(options.tags ?? [])
    .map((tag) => normalizeWritableTag(tag))
    .filter(Boolean)
    .map((tag) => `#${tag}`);
  const inlineFields = Object.entries(fields)
    .map(([key, value]) => [sanitizeFieldKey(key), String(value || '').trim()] as const)
    .filter(([key, value]) => Boolean(key && value))
    .map(([key, value]) => `[${key}:: ${value}]`);
  return [ `${prefix}${normalizedTitle}`.trimEnd(), ...tags, ...inlineFields ].filter(Boolean).join(' ');
}

export function appendTpsTableMarkdownLine(content: string, line: string): string {
  const separator = !content || content.endsWith('\n') ? '' : '\n';
  return `${content}${separator}${line}\n`;
}

function inferNodeDefaults(node: unknown, resolveValue: ResolveValue): PartialLineCreateDefaults {
  if (!node) return {};
  if (typeof node === 'string') return inferConditionDefaults(node, resolveValue);
  if (Array.isArray(node)) return mergeConjunction(node, resolveValue);
  if (typeof node !== 'object') return {};

  const record = node as Record<string, unknown>;
  for (const branchKey of ['or', 'any']) {
    if (!Object.prototype.hasOwnProperty.call(record, branchKey)) continue;
    for (const child of asArray(record[branchKey])) {
      const branchDefaults = inferNodeDefaults(child, resolveValue);
      if (hasDefaults(branchDefaults)) return branchDefaults;
    }
    return {};
  }
  if (Object.prototype.hasOwnProperty.call(record, 'not')) return {};
  for (const groupKey of ['and', 'all', 'filters', 'children', 'data']) {
    if (!Object.prototype.hasOwnProperty.call(record, groupKey)) continue;
    return mergeConjunction(asArray(record[groupKey]), resolveValue);
  }
  return inferObjectConditionDefaults(record, resolveValue);
}

function mergeConjunction(nodes: unknown[], resolveValue: ResolveValue): PartialLineCreateDefaults {
  let merged: PartialLineCreateDefaults = {};
  for (const node of nodes) merged = mergeConjunctive(merged, inferNodeDefaults(node, resolveValue));
  return merged;
}

function inferConditionDefaults(expression: string, resolveValue: ResolveValue): PartialLineCreateDefaults {
  const raw = String(expression || '').trim();
  if (!raw || raw.startsWith('!')) return {};
  const match = raw.match(/^([A-Za-z_][\w.-]*)\s*(==|=|is|equals?)\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/iu);
  if (!match) return {};
  return defaultsForProperty(match[1] || '', match[3] ?? match[4] ?? match[5] ?? '', resolveValue);
}

function inferObjectConditionDefaults(record: Record<string, unknown>, resolveValue: ResolveValue): PartialLineCreateDefaults {
  const property = String(record.property ?? record.field ?? '').trim();
  const operator = String(record.operator ?? record.op ?? '==').trim().toLowerCase();
  if (!property || !['==', '=', 'is', 'equals', 'equal'].includes(operator)) return {};
  const values = asArray(record.value ?? record.values ?? record.right);
  return defaultsForProperty(property, String(values[0] ?? ''), resolveValue);
}

function defaultsForProperty(property: string, rawValue: string, resolveValue: ResolveValue): PartialLineCreateDefaults {
  const lowerProperty = String(property || '').trim().toLowerCase();
  const semanticProperty = lowerProperty.replace(/^(?:tps|kanban|task)\./u, '');
  const value = resolveValue(stripWrappingQuotes(rawValue)).trim();

  if (['kind', 'itemkind', 'itemtype'].includes(semanticProperty)) {
    if (!value) return {};
    const normalizedKind = value.toLowerCase();
    if (normalizedKind === 'bullet' || normalizedKind === 'bullets') return { kind: 'bullet' };
    if (normalizedKind === 'task' || normalizedKind === 'tasks') return { kind: 'task' };
    const headingMatch = normalizedKind.match(/^(?:heading|headings|header|headers|h([1-6]))$/u);
    if (headingMatch) {
      const headingLevel = Number(headingMatch[1] || 1) as 1 | 2 | 3 | 4 | 5 | 6;
      return { kind: 'heading', headingLevel };
    }
    return {};
  }

  if (lowerProperty === 'file.path' || lowerProperty === 'task.path') {
    return { targetPath: value || null, targetPathSpecified: true };
  }

  if (!value) return {};
  if (lowerProperty.startsWith('file.') || lowerProperty.startsWith('note.') || lowerProperty === 'task.file.path') return {};
  if (['title', 'line', 'source', 'extension', 'ext'].includes(semanticProperty)) return {};
  return { fields: { [sanitizeFieldKey(semanticProperty)]: value } };
}

function nodeHasLineKindFilter(node: unknown): boolean {
  if (!node) return false;
  if (typeof node === 'string') {
    if (node.trim().startsWith('!')) return false;
    return /^(?:(?:tps|kanban|task)\.)?(?:kind|itemkind|itemtype)\s*(?:==|=|is|equals?)\s*["']?(?:bullet|bullets|task|tasks|heading|headings|header|headers|h[1-6])["']?\s*$/iu.test(node.trim());
  }
  if (Array.isArray(node)) return node.some((child) => nodeHasLineKindFilter(child));
  if (typeof node !== 'object') return false;
  const record = node as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, 'not')) return false;
  const property = String(record.property ?? record.field ?? '').trim().toLowerCase().replace(/^(?:tps|kanban|task)\./u, '');
  const values = asArray(record.value ?? record.values ?? record.right).map((value) => String(value || '').trim().toLowerCase());
  if (
    ['kind', 'itemkind', 'itemtype'].includes(property)
    && values.some((value) => /^(?:bullet|bullets|task|tasks|heading|headings|header|headers|h[1-6])$/u.test(value))
  ) return true;
  return Object.values(record).some((value) => nodeHasLineKindFilter(value));
}

function mergePreferred(current: PartialLineCreateDefaults, incoming: PartialLineCreateDefaults): PartialLineCreateDefaults {
  const currentOwnsTarget = current.targetPathSpecified === true;
  return {
    kind: current.kind ?? incoming.kind,
    headingLevel: current.headingLevel ?? incoming.headingLevel,
    targetPath: currentOwnsTarget ? current.targetPath ?? null : incoming.targetPath,
    targetPathSpecified: currentOwnsTarget || incoming.targetPathSpecified === true,
    fields: { ...(incoming.fields ?? {}), ...(current.fields ?? {}) },
  };
}

function mergeConjunctive(current: PartialLineCreateDefaults, incoming: PartialLineCreateDefaults): PartialLineCreateDefaults {
  const currentOwnsTarget = current.targetPathSpecified === true;
  const incomingOwnsTarget = incoming.targetPathSpecified === true;
  let targetPath = currentOwnsTarget ? current.targetPath ?? null : incoming.targetPath;
  if (currentOwnsTarget && incomingOwnsTarget) {
    const currentPath = normalizeComparableTargetPath(current.targetPath);
    const incomingPath = normalizeComparableTargetPath(incoming.targetPath);
    targetPath = currentPath && incomingPath && currentPath === incomingPath
      ? current.targetPath ?? incoming.targetPath ?? null
      : null;
  }
  return {
    kind: current.kind ?? incoming.kind,
    headingLevel: current.headingLevel ?? incoming.headingLevel,
    targetPath,
    targetPathSpecified: currentOwnsTarget || incomingOwnsTarget,
    fields: { ...(incoming.fields ?? {}), ...(current.fields ?? {}) },
  };
}

function hasDefaults(defaults: PartialLineCreateDefaults): boolean {
  return Boolean(defaults.kind || defaults.targetPathSpecified || Object.keys(defaults.fields ?? {}).length);
}

function normalizeComparableTargetPath(value: unknown): string | null {
  let raw = String(value ?? '').trim();
  const markdownLink = raw.match(/^\[[^\]]*\]\(([^)]+)\)$/u);
  if (markdownLink) raw = markdownLink[1] ?? '';
  raw = raw
    .replace(/^\[\[|\]\]$/gu, '')
    .split('|')[0]
    .split('#')[0]
    .replace(/^"+|"+$/gu, '')
    .replace(/^'+|'+$/gu, '')
    .replace(/\\/gu, '/')
    .replace(/\/+/gu, '/')
    .replace(/^\/+/u, '')
    .trim();
  if (!raw || raw.endsWith('/')) return null;
  return /\.[^/]+$/u.test(raw) ? raw : `${raw}.md`;
}

function sanitizeFieldKey(value: string): string {
  return String(value || '').trim().replace(/[\[\]:]+/gu, '').replace(/\s+/gu, ' ');
}

function normalizeCheckboxState(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (/^\[[^\]]\]$/u.test(raw)) return raw;
  const marker = raw.replace(/^\[|\]$/gu, '').slice(0, 1);
  return `[${marker}]`;
}

function normalizeWritableTag(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^#+/u, '')
    .replace(/[^\p{L}\p{N}/_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function stripWrappingQuotes(value: string): string {
  return String(value || '').trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, '$1$2').trim();
}

function defaultStatusForCheckboxState(rawState: string): string {
  const marker = String(rawState || '').trim().replace(/^\[|\]$/gu, '').trim().toLowerCase();
  if (!marker) return 'todo';
  if (marker === 'x') return 'complete';
  if (marker === '/' || marker === '\\') return 'working';
  if (marker === '?') return 'holding';
  if (marker === '-' || marker === '~') return 'wont-do';
  return marker;
}

function defaultIsDoneStatus(status: string): boolean {
  return status === 'complete' || status === 'wont-do';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}
