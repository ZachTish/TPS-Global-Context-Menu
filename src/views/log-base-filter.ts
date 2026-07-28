import { combineFilterTreeResults } from '../tps-list/base-filter-roots';
import { parseTaskTagValues } from '../utils/task-line-metadata';
import { resolveTpsBaseDateExpression } from './base-line-creation-plan';

export type LogBaseFilterFile = {
  path: string;
  name: string;
  basename: string;
  extension: string;
  folder: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
};

export type LogBaseFilterContext = {
  fields: Record<string, string>;
  file: LogBaseFilterFile;
  contextDate?: string | null;
  rowKind?: string | null;
  taskTags?: string[];
};

export function evaluateLogBaseFilterRoots(roots: unknown[], context: LogBaseFilterContext): boolean | null {
  return combineFilterTreeResults(roots.map((root) => evaluateLogBaseFilterNode(root, context)), 'and');
}

export function evaluateLogBaseFilterNode(node: unknown, context: LogBaseFilterContext): boolean | null {
  if (!node) return null;
  if (typeof node === 'string') return evaluateStringFilter(node, context);
  if (Array.isArray(node)) return combineFilterTreeResults(node.map((child) => evaluateLogBaseFilterNode(child, context)), 'and');
  if (typeof node !== 'object') return null;
  const record = node as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, 'and') || Object.prototype.hasOwnProperty.call(record, 'all')) {
    const children = Object.prototype.hasOwnProperty.call(record, 'and') ? record.and : record.all;
    return combineFilterTreeResults(asArray(children).map((child) => evaluateLogBaseFilterNode(child, context)), 'and');
  }
  if (Object.prototype.hasOwnProperty.call(record, 'or') || Object.prototype.hasOwnProperty.call(record, 'any')) {
    const children = Object.prototype.hasOwnProperty.call(record, 'or') ? record.or : record.any;
    return combineFilterTreeResults(asArray(children).map((child) => evaluateLogBaseFilterNode(child, context)), 'or');
  }
  if (Object.prototype.hasOwnProperty.call(record, 'not')) {
    const result = evaluateLogBaseFilterNode(record.not, context);
    return result == null ? null : !result;
  }
  return evaluateObjectFilter(record, context);
}

function evaluateStringFilter(rawExpression: string, context: LogBaseFilterContext): boolean | null {
  const raw = String(rawExpression || '').trim();
  if (!raw) return null;
  const negated = raw.startsWith('!');
  const expression = (negated ? raw.slice(1) : raw).trim();
  const call = expression.match(/^([\w.\s-]+)\.(containsAny|contains|startsWith|endsWith|equals|isEmpty|empty|isNotEmpty|exists)\((.*)\)$/i);
  let result: boolean | null = null;
  if (call) {
    const values = readComparableValues(call[1], context);
    if (values == null) return null;
    result = evaluateValues(
      values,
      call[2],
      splitArguments(call[3]).map((value) => resolveLiteral(value, context)),
      isExactContainsProperty(call[1], context),
    );
  } else {
    const comparison = expression.match(/^([\w.\s-]+)\s*(==|=|!=|!==|>=|<=|>|<|is|equals?)\s*(.+)$/i);
    if (!comparison) return null;
    const values = readComparableValues(comparison[1], context);
    if (values == null) return null;
    result = evaluateValues(
      values,
      comparison[2],
      [resolveLiteral(comparison[3], context)],
      isExactContainsProperty(comparison[1], context),
    );
  }
  return result == null ? null : negated ? !result : result;
}

function evaluateObjectFilter(record: Record<string, unknown>, context: LogBaseFilterContext): boolean | null {
  const property = String(record.property ?? record.field ?? record.key ?? record.left ?? record.lhs ?? '').trim();
  if (!property) {
    const inline = record.expression ?? record.expr ?? record.text ?? record.raw;
    return typeof inline === 'string' ? evaluateStringFilter(inline, context) : null;
  }
  const values = readComparableValues(property, context);
  if (values == null) return null;
  const operator = String(record.operator ?? record.op ?? record.comparison ?? record.condition ?? 'equals').trim();
  const rawExpected = record.values ?? record.value ?? record.expected ?? record.right ?? record.rhs ?? record.target;
  const expected = asArray(rawExpected).map((value) => resolveLiteral(value, context));
  const result = evaluateValues(values, operator, expected, isExactContainsProperty(property, context));
  const negated = record.negated === true || record.exclude === true;
  return result == null ? null : negated ? !result : result;
}

function readComparableValues(rawProperty: string, context: LogBaseFilterContext): unknown[] | null {
  const property = String(rawProperty || '').trim();
  const normalized = normalizeKey(property);
  if (!normalized) return null;
  const semanticProperty = normalizeKey(property.replace(/^(?:tps|kanban|task|line|heading)\./iu, ''));
  if (['kind', 'itemkind', 'itemtype'].includes(semanticProperty) && context.rowKind) {
    return getStructuralKindValues(context.rowKind);
  }
  if (/^(?:task|line|heading)\.(?:path|file\.path)$/iu.test(property)) return [context.file.path];
  if (isTaskTagProperty(property, context)) return readTaskTagValues(context);
  if (/^task\.tags?$/iu.test(property)) return [];
  if (normalized.startsWith('file')) {
    const fileKey = normalized.slice(4);
    if (fileKey === 'path') return [context.file.path];
    if (fileKey === 'name') return [context.file.name];
    if (fileKey === 'basename') return [context.file.basename];
    if (fileKey === 'folder' || fileKey === 'folderpath') return [context.file.folder];
    if (fileKey === 'ext' || fileKey === 'extension') return [context.file.extension];
    if (fileKey === 'tag' || fileKey === 'tags') return context.file.tags;
    return readRecordValues(context.file.frontmatter, property.replace(/^file\./i, ''));
  }
  // Exact virtual keys such as `task.status` must win over their bare-key
  // aliases so a row can carry both checkbox workflow state and a relational
  // `status` value. Structural Kind and task-tag aliases stay above this check
  // because they intentionally synthesize additional comparable values.
  const exactLineValue = Object.entries(context.fields)
    .find(([key]) => normalizeKey(key) === normalized)?.[1];
  if (exactLineValue != null) return toValues(exactLineValue);
  const lineKey = normalizeKey(property.replace(/^(?:note|line|log|task)\./i, ''));
  const lineValue = Object.entries(context.fields).find(([key]) => normalizeKey(key) === lineKey)?.[1];
  if (lineValue != null) return toValues(lineValue);
  return readRecordValues(context.file.frontmatter, property.replace(/^note\./i, '')) ?? [];
}

function getStructuralKindValues(rawKind: unknown): string[] {
  const kind = String(rawKind ?? '').trim().toLowerCase();
  const heading = kind.match(/^h([1-6])$/u);
  if (heading) return [kind, 'heading', 'headings', 'header', 'headers'];
  if (kind === 'heading') return ['heading', 'headings', 'header', 'headers', 'h1'];
  if (kind === 'task') return ['task', 'tasks'];
  if (kind === 'bullet') return ['bullet', 'bullets'];
  return kind ? [kind] : [];
}

function isTaskTagProperty(rawProperty: string, context: LogBaseFilterContext): boolean {
  if (!/^(?:task\.)?tags?$/iu.test(String(rawProperty || '').trim())) return false;
  const rowKind = normalizeKey(context.rowKind ?? context.fields.kind);
  return rowKind === 'task' || Array.isArray(context.taskTags);
}

function isExactContainsProperty(rawProperty: string, context: LogBaseFilterContext): boolean {
  return isTaskTagProperty(rawProperty, context)
    || /^file\.tags?$/iu.test(String(rawProperty || '').trim());
}

function readTaskTagValues(context: LogBaseFilterContext): string[] {
  const inlineTagFields = Object.entries(context.fields)
    .filter(([key]) => /^(?:tag|tags)$/u.test(normalizeKey(key)))
    .map(([, value]) => value);
  return parseTaskTagValues([context.taskTags ?? [], inlineTagFields]);
}

function readRecordValues(record: Record<string, unknown>, rawKey: string): unknown[] | null {
  const normalized = normalizeKey(rawKey);
  const entry = Object.entries(record || {}).find(([key]) => normalizeKey(key) === normalized);
  return entry ? toValues(entry[1]) : null;
}

function evaluateValues(
  current: unknown[],
  rawOperator: string,
  expected: unknown[],
  exactContains = false,
): boolean | null {
  const operator = String(rawOperator || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['isempty', 'empty'].includes(operator)) return current.length === 0 || current.every(isEmptyValue);
  if (['isnotempty', 'exists'].includes(operator)) return current.length > 0 && current.some((value) => !isEmptyValue(value));
  if (['contains', 'containsany'].includes(operator)) {
    return expected.some((target) => current.some((value) => (
      exactContains
        ? normalizeValue(value) === normalizeValue(target)
        : normalizeValue(value).includes(normalizeValue(target))
    )));
  }
  if (operator === 'startswith') return expected.some((target) => current.some((value) => normalizeValue(value).startsWith(normalizeValue(target))));
  if (operator === 'endswith') return expected.some((target) => current.some((value) => normalizeValue(value).endsWith(normalizeValue(target))));
  if (['!=', '!==', 'isnot', 'notequal', 'notequals', 'doesnotequal'].includes(operator)) return expected.every((target) => current.every((value) => compareValues(value, target) !== 0));
  if (['=', '==', 'is', 'equal', 'equals'].includes(operator)) return expected.some((target) => current.some((value) => compareValues(value, target) === 0));
  if (['>', '>=', '<', '<='].includes(operator)) {
    return expected.some((target) => current.some((value) => {
      const comparison = compareValues(value, target);
      return operator === '>' ? comparison > 0 : operator === '>=' ? comparison >= 0 : operator === '<' ? comparison < 0 : comparison <= 0;
    }));
  }
  return null;
}

function compareValues(left: unknown, right: unknown): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (String(left).trim() !== '' && String(right).trim() !== '' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  return normalizeValue(left).localeCompare(normalizeValue(right));
}

function resolveLiteral(rawValue: unknown, context: LogBaseFilterContext): unknown {
  if (typeof rawValue !== 'string') return rawValue;
  const raw = rawValue.trim();
  if (/^this\.(?:scheduled|date)$/i.test(raw)) return context.contextDate || '';
  const deterministicDate = resolveTpsBaseDateExpression(raw, {
    resolveValue: (value) => /^this\.(?:scheduled|date)$/i.test(value) ? context.contextDate || '' : value,
  });
  if (deterministicDate) return deterministicDate;
  const dateCall = raw.match(/^date\(\s*["']?([^"')]+)["']?\s*\)$/i);
  if (dateCall) return dateCall[1];
  if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw.replace(/^(["'])(.*)\1$/, '$2');
}

function splitArguments(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw.split(',').map((value) => value.trim()).filter(Boolean);
}

function toValues(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => toValues(entry));
  return [value];
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function isEmptyValue(value: unknown): boolean {
  return value == null || String(value).trim() === '';
}

function normalizeKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeValue(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/^#/, '');
}
