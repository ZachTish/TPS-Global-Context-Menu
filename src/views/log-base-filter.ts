import { evaluateOrderedFilterChildren } from '../tps-list/base-filter-roots';
import { parseTaskTagValues } from '../utils/task-line-metadata';
import { resolveTpsBaseDateExpression } from './base-line-creation-plan';
import {
  findPropertyKeyCaseInsensitive,
  normalizePropertyKeyIdentity,
} from '../utils/property-key-identity';
import { resolveConfiguredProperty } from '../utils/entity-property';
import type { CustomProperty } from '../types';
import {
  compareTpsFormulaValues,
  getTpsFormulaComparableValues,
  hasTpsFormulaReference,
  isTpsFormulaTruthy,
  type TpsFormulaResult,
  type TpsFormulaRowSession,
} from '../services/tps-base-formula-service';

export type LogBaseFilterFile = {
  path: string;
  name: string;
  basename: string;
  extension: string;
  folder: string;
  size?: number;
  ctime?: Date | number | string;
  mtime?: Date | number | string;
  tags: string[];
  links?: unknown[];
  frontmatter: Record<string, unknown>;
};

export type LogBaseFilterFailure = {
  code: string;
  message: string;
  expression?: string;
  property?: string;
  operator?: string;
};

export type LogBaseFilterValidation = {
  valid: boolean;
  diagnostics: LogBaseFilterFailure[];
};

export type LogBaseFilterContext = {
  fields: Record<string, unknown>;
  configuredProperties?: readonly CustomProperty[];
  file: LogBaseFilterFile;
  contextDate?: string | null;
  rowKind?: string | null;
  title?: string;
  rawLine?: string;
  lineNumber?: number;
  taskTags?: string[];
  formulaSession?: TpsFormulaRowSession;
  formulaFailed?: boolean;
  filterFailed?: boolean;
  onFormulaFailure?: (result: TpsFormulaResult) => void;
  onFilterFailure?: (failure: LogBaseFilterFailure) => void;
};

export function evaluateLogBaseFilterRoots(roots: unknown[], context: LogBaseFilterContext): boolean | null {
  context.formulaFailed = false;
  context.filterFailed = false;
  const result = evaluateOrderedFilterChildren(roots, 'and', (root) => evaluateLogBaseFilterNodeInternal(root, context));
  return context.formulaFailed || context.filterFailed ? false : result;
}

export function evaluateLogBaseFilterNode(node: unknown, context: LogBaseFilterContext): boolean | null {
  context.formulaFailed = false;
  context.filterFailed = false;
  const result = evaluateLogBaseFilterNodeInternal(node, context);
  return context.formulaFailed || context.filterFailed ? false : result;
}

/** Validate a persisted/runtime filter tree without evaluating vault data. */
export function validateLogBaseFilterRoots(
  roots: readonly unknown[],
  configuredProperties: readonly CustomProperty[] = [],
): LogBaseFilterValidation {
  const diagnostics: LogBaseFilterFailure[] = [];
  const report = (failure: LogBaseFilterFailure) => diagnostics.push(failure);
  for (const root of roots) validateFilterNode(root, configuredProperties, report);
  return { valid: diagnostics.length === 0, diagnostics };
}

function validateFilterNode(
  node: unknown,
  configuredProperties: readonly CustomProperty[],
  report: (failure: LogBaseFilterFailure) => void,
): void {
  if (!node) {
    report({ code: 'invalid-filter-node', message: 'Filter node is empty' });
    return;
  }
  if (typeof node === 'string') {
    validateFilterExpression(node, configuredProperties, report);
    return;
  }
  if (Array.isArray(node)) {
    if (!node.length) report({ code: 'empty-filter-group', message: 'Filter group has no children' });
    for (const child of node) validateFilterNode(child, configuredProperties, report);
    return;
  }
  if (typeof node !== 'object') {
    report({ code: 'invalid-filter-node', message: `Unsupported filter node type: ${typeof node}` });
    return;
  }
  const record = node as Record<string, unknown>;
  const logicalKeys = ['and', 'all', 'or', 'any', 'not'].filter((key) => Object.prototype.hasOwnProperty.call(record, key));
  if (logicalKeys.length > 1) {
    report({ code: 'ambiguous-filter-group', message: `Filter node contains multiple logical operators: ${logicalKeys.join(', ')}` });
    return;
  }
  if (logicalKeys.length === 1) {
    const key = logicalKeys[0];
    const children = key === 'not' ? [record[key]] : asArray(record[key]);
    if (!children.length || children.every((child) => child == null)) {
      report({ code: 'empty-filter-group', message: `${key} filter has no children` });
      return;
    }
    for (const child of children) validateFilterNode(child, configuredProperties, report);
    return;
  }
  const property = String(record.property ?? record.field ?? record.key ?? record.left ?? record.lhs ?? '').trim();
  const inline = record.expression ?? record.expr ?? record.text ?? record.raw;
  if (!property) {
    if (typeof inline === 'string') validateFilterExpression(inline, configuredProperties, report);
    else report({ code: 'invalid-filter-object', message: 'Filter object has no property or expression' });
    return;
  }
  if (parsePropertyPath(property) == null) {
    report({ code: 'invalid-filter-property', message: 'Filter property path contains invalid bracket syntax', property });
    return;
  }
  const operator = String(record.operator ?? record.op ?? record.comparison ?? record.condition ?? 'equals').trim();
  if (!isSupportedValueOperator(operator)) {
    report({ code: 'unsupported-filter-operator', message: `Unsupported filter operator: ${operator || '(empty)'}`, property, operator });
    return;
  }
  validateConfiguredOperator(property, operator, configuredProperties, report);
}

function validateFilterExpression(
  rawExpression: string,
  configuredProperties: readonly CustomProperty[],
  report: (failure: LogBaseFilterFailure) => void,
): void {
  const raw = String(rawExpression || '').trim();
  if (!raw) {
    report({ code: 'empty-filter-expression', message: 'Filter expression is empty' });
    return;
  }
  const expression = (raw.startsWith('!') ? raw.slice(1) : raw).trim();
  const call = parseMethodCall(expression);
  if (call) {
    if (!isSupportedFilterMethod(call.method)) {
      report({ code: 'unsupported-filter-operator', message: `Unsupported filter method: ${call.method}()`, expression: raw, property: call.property, operator: call.method });
      return;
    }
    const args = splitArguments(call.arguments);
    if (args == null) {
      report({ code: 'invalid-filter-arguments', message: 'Filter arguments contain an unclosed quote or bracket', expression: raw, property: call.property, operator: call.method });
      return;
    }
    if (!hasValidMethodArity(call.method, args.length)) {
      report({ code: 'invalid-filter-arity', message: `Filter method ${call.method}() received ${args.length} argument(s)`, expression: raw, property: call.property, operator: call.method });
      return;
    }
    if (parsePropertyPath(call.property) == null) {
      report({ code: 'invalid-filter-property', message: 'Filter property path contains invalid bracket syntax', expression: raw, property: call.property });
      return;
    }
    validateConfiguredOperator(call.property, call.method, configuredProperties, report);
    return;
  }
  const comparison = parseComparison(expression);
  if (comparison) {
    if (parsePropertyPath(comparison.property) == null) {
      report({ code: 'invalid-filter-property', message: 'Filter property path contains invalid bracket syntax', expression: raw, property: comparison.property });
    }
    return;
  }
  if (hasTpsFormulaReference(expression)) return;
  report({ code: 'unsupported-filter-syntax', message: 'Filter expression uses unsupported or invalid syntax', expression: raw });
}

function validateConfiguredOperator(
  property: string,
  operator: string,
  configuredProperties: readonly CustomProperty[],
  report: (failure: LogBaseFilterFailure) => void,
): void {
  const configured = resolveConfiguredProperty(configuredProperties, property);
  if (!configured || configured.type === 'list') return;
  const normalized = normalizeOperator(operator);
  if (!['containsall'].includes(normalized)) return;
  report({
    code: 'property-type-operator-mismatch',
    message: `${configured.key || property} is not a list property, so ${operator} is not supported`,
    property,
    operator,
  });
}

function evaluateLogBaseFilterNodeInternal(node: unknown, context: LogBaseFilterContext): boolean | null {
  if (!node) return failFilter(context, 'invalid-filter-node', 'Filter node is empty');
  if (typeof node === 'string') return evaluateStringFilter(node, context);
  if (Array.isArray(node)) {
    if (!node.length) return failFilter(context, 'empty-filter-group', 'Filter group has no children');
    return evaluateOrderedFilterChildren(node, 'and', (child) => evaluateLogBaseFilterNodeInternal(child, context));
  }
  if (typeof node !== 'object') return failFilter(context, 'invalid-filter-node', `Unsupported filter node type: ${typeof node}`);
  const record = node as Record<string, unknown>;
  const logicalKeys = ['and', 'all', 'or', 'any', 'not'].filter((key) => Object.prototype.hasOwnProperty.call(record, key));
  if (logicalKeys.length > 1) {
    return failFilter(context, 'ambiguous-filter-group', `Filter node contains multiple logical operators: ${logicalKeys.join(', ')}`);
  }
  if (logicalKeys[0] === 'and' || logicalKeys[0] === 'all') {
    const children = record[logicalKeys[0]];
    if (!asArray(children).length) return failFilter(context, 'empty-filter-group', `${logicalKeys[0]} filter has no children`);
    return evaluateOrderedFilterChildren(asArray(children), 'and', (child) => evaluateLogBaseFilterNodeInternal(child, context));
  }
  if (logicalKeys[0] === 'or' || logicalKeys[0] === 'any') {
    const children = record[logicalKeys[0]];
    if (!asArray(children).length) return failFilter(context, 'empty-filter-group', `${logicalKeys[0]} filter has no children`);
    return evaluateOrderedFilterChildren(asArray(children), 'or', (child) => evaluateLogBaseFilterNodeInternal(child, context));
  }
  if (logicalKeys[0] === 'not') {
    const result = evaluateLogBaseFilterNodeInternal(record.not, context);
    return result == null ? null : !result;
  }
  return evaluateObjectFilter(record, context);
}

function evaluateStringFilter(rawExpression: string, context: LogBaseFilterContext): boolean | null {
  const raw = String(rawExpression || '').trim();
  if (!raw) return failFilter(context, 'empty-filter-expression', 'Filter expression is empty');
  if (hasTpsFormulaReference(raw)) {
    if (!context.formulaSession) {
      markFormulaFailure(context, unavailableFormulaResult(raw));
      return null;
    }
    const result = context.formulaSession.evaluateExpression(raw, '$filter');
    if (result.status === 'error' || result.status === 'unsupported') {
      markFormulaFailure(context, result);
      return null;
    }
    return isTpsFormulaTruthy(result.value);
  }
  const negated = raw.startsWith('!');
  const expression = (negated ? raw.slice(1) : raw).trim();
  const call = parseMethodCall(expression);
  let result: boolean | null = null;
  if (call) {
    if (!isSupportedFilterMethod(call.method)) {
      return failFilter(context, 'unsupported-filter-operator', `Unsupported filter method: ${call.method}()`, {
        expression: raw,
        property: call.property,
        operator: call.method,
      });
    }
    const args = splitArguments(call.arguments);
    if (args == null) {
      return failFilter(context, 'invalid-filter-arguments', 'Filter arguments contain an unclosed quote or bracket', {
        expression: raw,
        property: call.property,
        operator: call.method,
      });
    }
    if (!hasValidMethodArity(call.method, args.length)) {
      return failFilter(context, 'invalid-filter-arity', `Filter method ${call.method}() received ${args.length} argument(s)`, {
        expression: raw,
        property: call.property,
        operator: call.method,
      });
    }
    const fileMethodResult = evaluateFileMethod(call.property, call.method, args, context);
    if (fileMethodResult !== undefined) {
      result = fileMethodResult;
    } else {
      const values = readComparableValues(call.property, context);
      if (values == null) return null;
      result = evaluateValues(
        values,
        call.method,
        args.map((value) => resolveLiteral(value, context)),
        isExactContainsProperty(call.property, context),
      );
    }
  } else {
    const comparison = parseComparison(expression);
    if (!comparison) {
      const failedBeforeFallback = context.filterFailed === true;
      const formulaResult = evaluateGeneralExpression(expression, context);
      if (formulaResult != null) return negated ? !formulaResult : formulaResult;
      if (!failedBeforeFallback && context.filterFailed) return null;
      return failFilter(context, 'unsupported-filter-syntax', 'Filter expression uses unsupported or invalid syntax', { expression: raw });
    }
    const values = readComparableValues(comparison.property, context);
    if (values == null) return null;
    result = evaluateValues(
      values,
      comparison.operator,
      [resolveLiteral(comparison.expected, context)],
      isExactContainsProperty(comparison.property, context),
    );
  }
  if (result == null) {
    return failFilter(context, 'unsupported-filter-operator', 'Filter operator is not supported', {
      expression: raw,
      ...(call ? { property: call.property, operator: call.method } : {}),
    });
  }
  return result == null ? null : negated ? !result : result;
}

function evaluateObjectFilter(record: Record<string, unknown>, context: LogBaseFilterContext): boolean | null {
  const property = String(record.property ?? record.field ?? record.key ?? record.left ?? record.lhs ?? '').trim();
  if (!property) {
    const inline = record.expression ?? record.expr ?? record.text ?? record.raw;
    return typeof inline === 'string'
      ? evaluateStringFilter(inline, context)
      : failFilter(context, 'invalid-filter-object', 'Filter object has no property or expression');
  }
  const values = readComparableValues(property, context);
  if (values == null) return null;
  const operator = String(record.operator ?? record.op ?? record.comparison ?? record.condition ?? 'equals').trim();
  const rawExpected = record.values ?? record.value ?? record.expected ?? record.right ?? record.rhs ?? record.target;
  const expected = asArray(rawExpected).map((value) => resolveLiteral(value, context));
  const result = evaluateValues(values, operator, expected, isExactContainsProperty(property, context));
  if (result == null && /^formula\./iu.test(property)) {
    markFormulaFailure(context, unsupportedFormulaFilterResult(property, operator));
  } else if (result == null) {
    return failFilter(context, 'unsupported-filter-operator', `Unsupported filter operator: ${operator || '(empty)'}`, {
      property,
      operator,
    });
  }
  const negated = record.negated === true || record.exclude === true;
  return result == null ? null : negated ? !result : result;
}

function readComparableValues(rawProperty: string, context: LogBaseFilterContext): unknown[] | null {
  const property = String(rawProperty || '').trim();
  const propertyIdentity = normalizePropertyKeyIdentity(property);
  if (!propertyIdentity) return failFilter(context, 'invalid-filter-property', 'Filter property is empty', { property });
  if (/^formula\./iu.test(property)) {
    if (!context.formulaSession) {
      markFormulaFailure(context, unavailableFormulaResult(property));
      return null;
    }
    const result = context.formulaSession.get(property);
    if (result.status === 'error' || result.status === 'unsupported') {
      markFormulaFailure(context, result);
      return null;
    }
    return getTpsFormulaComparableValues(result.value);
  }
  const propertyPath = parsePropertyPath(property);
  if (propertyPath == null) {
    return failFilter(context, 'invalid-filter-property', 'Filter property path contains invalid bracket syntax', { property });
  }
  const [namespace, ...path] = propertyPath;
  const normalizedNamespace = normalizeKey(namespace);
  const semanticProperty = normalizePropertyKeyIdentity(
    property.replace(/^(?:tps|kanban|task|line|heading)\./iu, ''),
  );
  if (['kind', 'itemkind', 'itemtype'].includes(semanticProperty) && context.rowKind) {
    if (semanticProperty === 'kind') {
      const structuralKind = normalizeKey(context.rowKind);
      const additiveKinds = structuralKind === 'task' || structuralKind === 'note'
        ? getExplicitKindValues(context)
        : [];
      return Array.from(new Set([
        ...getStructuralKindValues(context.rowKind),
        ...additiveKinds,
      ]));
    }
    return getStructuralKindValues(context.rowKind);
  }
  if (/^(?:task|line|heading)\.(?:path|file\.path)$/iu.test(property)) return [context.file.path];
  if (/^(?:title|text|task\.title|task\.text|line\.title|line\.text|heading\.title|heading\.text)$/iu.test(property)) {
    return context.title != null ? [context.title] : [];
  }
  if (/^(?:line\.)?(?:number|lineNumber)$/iu.test(property)) return context.lineNumber != null ? [context.lineNumber] : [];
  if (/^heading\.line$/iu.test(property)) return context.lineNumber != null ? [context.lineNumber] : [];
  if (/^heading\.level$/iu.test(property)) {
    const match = String(context.rowKind || '').trim().toLowerCase().match(/^h([1-6])$/u);
    return match ? [Number(match[1])] : [];
  }
  if (/^line\.raw$/iu.test(property)) return context.rawLine != null ? [context.rawLine] : [];
  // Obsidian's Base filter UI presents the source directory as bare
  // `folder`. Synthesized TPS rows keep file metadata outside the authored
  // line/frontmatter maps, so resolve this native alias before generic field
  // lookup instead of treating it as a missing user property.
  if (semanticProperty === 'folder' || semanticProperty === 'folderpath') {
    return [context.file.folder];
  }
  if (isTaskTagProperty(property, context)) return readTaskTagValues(context);
  if (/^task\.tags?$/iu.test(property)) return [];
  if (normalizedNamespace === 'file') {
    const fileKey = normalizeKey(path[0] ?? '');
    if (!fileKey && path.length === 0) {
      return failFilter(context, 'unsupported-filter-property', 'Use a file property or a supported file method', { property });
    }
    if (fileKey === 'path') return [context.file.path];
    if (fileKey === 'name') return [context.file.name];
    if (fileKey === 'basename') return [context.file.basename];
    if (fileKey === 'folder' || fileKey === 'folderpath') return [context.file.folder];
    if (fileKey === 'ext' || fileKey === 'extension') return [context.file.extension];
    if (fileKey === 'tag' || fileKey === 'tags') return context.file.tags;
    if (fileKey === 'size') return context.file.size == null ? [] : [context.file.size];
    if (fileKey === 'ctime') return context.file.ctime == null ? [] : [toComparableDate(context.file.ctime)];
    if (fileKey === 'mtime') return context.file.mtime == null ? [] : [toComparableDate(context.file.mtime)];
    if (fileKey === 'links') return toValues(context.file.links ?? []);
    if (fileKey === 'file') return [context.file.path];
    if (fileKey === 'properties' || fileKey === 'frontmatter') {
      if (path.length === 1) return [context.file.frontmatter];
      return readRecordPathValues(context.file.frontmatter, path.slice(1)) ?? [];
    }
    if (fileKey === 'backlinks' || fileKey === 'embeds') {
      return failFilter(
        context,
        'unsupported-file-index',
        `${property} requires a vault-wide index that TPS Table synthetic rows cannot evaluate`,
        { property },
      );
    }
    // Keep the historical `file.<frontmatter-key>` alias while preferring the
    // native file property set above.
    return readRecordPathValues(context.file.frontmatter, path) ?? [];
  }
  if (normalizedNamespace === 'note' || normalizedNamespace === 'frontmatter' || normalizedNamespace === 'properties') {
    return readRecordPathValues(context.file.frontmatter, path) ?? [];
  }
  // Exact virtual keys such as `task.status` must win over their bare-key
  // aliases so a row can carry both checkbox workflow state and a relational
  // `status` value. Native file and note namespaces above must never be
  // shadowed by an authored inline key with the same spelling.
  const exactLineKey = findPropertyKeyCaseInsensitive(context.fields, property);
  const exactLineValue = exactLineKey == null ? undefined : context.fields[exactLineKey];
  if (exactLineValue != null) return toValues(exactLineValue);
  if (['row', 'line', 'log', 'task', 'heading'].includes(normalizedNamespace) && path.length > 0) {
    const resolved = readRecordPathValues(context.fields, path);
    return resolved ?? [];
  }
  const lineValue = readRecordPathValues(context.fields, propertyPath);
  if (lineValue != null) return lineValue;
  return readRecordPathValues(context.file.frontmatter, propertyPath) ?? [];
}

function markFormulaFailure(context: LogBaseFilterContext, result: TpsFormulaResult): void {
  context.formulaFailed = true;
  context.onFormulaFailure?.(result);
}

function failFilter(
  context: LogBaseFilterContext,
  code: string,
  message: string,
  details: Omit<LogBaseFilterFailure, 'code' | 'message'> = {},
): null {
  context.filterFailed = true;
  context.onFilterFailure?.({ code, message, ...details });
  return null;
}

function unavailableFormulaResult(rawFormula: string): TpsFormulaResult {
  return {
    status: 'error',
    value: null,
    formula: String(rawFormula || '').replace(/^formula\./iu, ''),
    code: 'formula-session-unavailable',
    message: 'TPS formula context is unavailable for this filter',
  };
}

function unsupportedFormulaFilterResult(property: string, operator: string): TpsFormulaResult {
  return {
    status: 'unsupported',
    value: null,
    formula: String(property || '').replace(/^formula\./iu, ''),
    code: 'unsupported-formula-filter-operator',
    message: `Unsupported formula filter operator: ${String(operator || '(empty)')}`,
  };
}

type ParsedMethodCall = {
  property: string;
  method: string;
  arguments: string;
};

type ParsedComparison = {
  property: string;
  operator: string;
  expected: string;
};

const SUPPORTED_FILTER_METHODS = new Set([
  'contains',
  'containsany',
  'containsall',
  'startswith',
  'endswith',
  'equals',
  'isempty',
  'empty',
  'isnotempty',
  'exists',
  'hastag',
  'infolder',
  'haslink',
  'hasproperty',
]);

function parseMethodCall(expression: string): ParsedMethodCall | null {
  const match = expression.match(/^([\s\S]+)\.([\p{L}_$][\p{L}\p{N}_$-]*)\(([\s\S]*)\)$/u);
  if (!match) return null;
  const property = match[1].trim();
  const method = match[2].trim();
  return property && method ? { property, method, arguments: match[3] } : null;
}

function isSupportedFilterMethod(method: string): boolean {
  return SUPPORTED_FILTER_METHODS.has(normalizeOperator(method));
}

function isSupportedValueOperator(operator: string): boolean {
  return [
    'isempty', 'empty', 'isnotempty', 'exists',
    'contains', 'containsany', 'containsall', 'startswith', 'endswith',
    '!=', '!==', 'isnot', 'notequal', 'notequals', 'doesnotequal',
    '=', '==', 'is', 'equal', 'equals', '>', '>=', '<', '<=',
  ].includes(normalizeOperator(operator));
}

function hasValidMethodArity(method: string, count: number): boolean {
  const normalized = normalizeOperator(method);
  if (['isempty', 'empty', 'isnotempty', 'exists'].includes(normalized)) return count === 0;
  if (['containsany', 'containsall', 'hastag'].includes(normalized)) return count > 0;
  return count === 1;
}

function parseComparison(expression: string): ParsedComparison | null {
  const symbolic = findTopLevelOperator(expression, ['!==', '!=', '>=', '<=', '==', '>', '<', '=']);
  if (symbolic) {
    const property = expression.slice(0, symbolic.index).trim();
    const expected = expression.slice(symbolic.index + symbolic.operator.length).trim();
    return property && expected ? { property, operator: symbolic.operator, expected } : null;
  }
  const words = findTopLevelWordOperator(expression, ['is not', 'does not equal', 'not equals', 'equals', 'equal', 'is']);
  if (!words) return null;
  const property = expression.slice(0, words.index).trim();
  const expected = expression.slice(words.index + words.operator.length).trim();
  if (!property || !expected) return null;
  const operator = ['is not', 'does not equal', 'not equals'].includes(words.operator.toLocaleLowerCase())
    ? '!='
    : words.operator;
  return { property, operator, expected };
}

function findTopLevelOperator(
  expression: string,
  operators: string[],
): { index: number; operator: string } | null {
  const state = createScannerState();
  for (let index = 0; index < expression.length; index += 1) {
    updateScannerState(state, expression, index);
    if (!isScannerTopLevel(state)) continue;
    const operator = operators.find((candidate) => expression.startsWith(candidate, index));
    if (operator) return { index, operator };
  }
  return null;
}

function findTopLevelWordOperator(
  expression: string,
  operators: string[],
): { index: number; operator: string } | null {
  const lower = expression.toLocaleLowerCase();
  const state = createScannerState();
  for (let index = 0; index < expression.length; index += 1) {
    updateScannerState(state, expression, index);
    if (!isScannerTopLevel(state)) continue;
    for (const operator of operators) {
      if (!lower.startsWith(operator, index)) continue;
      const before = expression[index - 1] ?? ' ';
      const after = expression[index + operator.length] ?? ' ';
      if (/\s/u.test(before) && /\s/u.test(after)) return { index, operator };
    }
  }
  return null;
}

type ScannerState = {
  quote: string | null;
  escaped: boolean;
  round: number;
  square: number;
  curly: number;
};

function createScannerState(): ScannerState {
  return { quote: null, escaped: false, round: 0, square: 0, curly: 0 };
}

function updateScannerState(state: ScannerState, source: string, index: number): void {
  const character = source[index];
  if (state.quote) {
    if (state.escaped) {
      state.escaped = false;
      return;
    }
    if (character === '\\') {
      state.escaped = true;
      return;
    }
    if (character === state.quote) state.quote = null;
    return;
  }
  if (character === '"' || character === "'") {
    state.quote = character;
    return;
  }
  if (character === '(') state.round += 1;
  else if (character === ')') state.round = Math.max(0, state.round - 1);
  else if (character === '[') state.square += 1;
  else if (character === ']') state.square = Math.max(0, state.square - 1);
  else if (character === '{') state.curly += 1;
  else if (character === '}') state.curly = Math.max(0, state.curly - 1);
}

function isScannerTopLevel(state: ScannerState): boolean {
  return !state.quote && state.round === 0 && state.square === 0 && state.curly === 0;
}

function evaluateGeneralExpression(expression: string, context: LogBaseFilterContext): boolean | null {
  if (!context.formulaSession) return null;
  const result = context.formulaSession.evaluateExpression(expression, '$filter');
  if (result.status === 'error' || result.status === 'unsupported') {
    failFilter(context, result.code || 'unsupported-filter-expression', result.message || 'Filter expression could not be evaluated', {
      expression,
    });
    return null;
  }
  return isTpsFormulaTruthy(result.value);
}

function evaluateFileMethod(
  rawProperty: string,
  rawMethod: string,
  rawArguments: string[],
  context: LogBaseFilterContext,
): boolean | undefined {
  if (normalizeKey(rawProperty) !== 'file') return undefined;
  const method = normalizeOperator(rawMethod);
  const expected = rawArguments.map((argument) => resolveLiteral(argument, context));
  if (method === 'hastag') {
    const tags = context.file.tags.map((tag) => normalizeValue(tag));
    return expected.some((value) => {
      const target = normalizeValue(value);
      return tags.some((tag) => tag === target || tag.startsWith(`${target}/`));
    });
  }
  if (method === 'infolder') {
    const folder = normalizePathValue(context.file.folder);
    const target = normalizePathValue(expected[0]);
    return folder === target || folder.startsWith(`${target}/`);
  }
  if (method === 'haslink') {
    const target = normalizeLinkValue(expected[0]);
    return (context.file.links ?? []).some((link) => normalizeLinkValue(link) === target);
  }
  if (method === 'hasproperty') {
    return findRecordKey(context.file.frontmatter, String(expected[0] ?? '')) != null;
  }
  return undefined;
}

function getStructuralKindValues(rawKind: unknown): string[] {
  const kind = String(rawKind ?? '').trim().toLowerCase();
  const heading = kind.match(/^h([1-6])$/u);
  if (heading) return [kind, 'heading', 'headings', 'header', 'headers'];
  if (kind === 'heading') return ['heading', 'headings', 'header', 'headers', 'h1'];
  if (kind === 'task') return ['task', 'tasks'];
  if (kind === 'bullet') return ['bullet', 'bullets'];
  if (kind === 'note') return ['note', 'notes'];
  return kind ? [kind] : [];
}

function getExplicitKindValues(context: LogBaseFilterContext): string[] {
  const exact = Object.entries(context.fields)
    .find(([key]) => ['explicitkind', 'entitykind'].includes(normalizePropertyKeyIdentity(key)))?.[1];
  if (exact == null) return [];
  return String(exact)
    .replace(/^\[|\]$/gu, '')
    .split(/[,\n]/gu)
    .map((value) => value.trim().replace(/^(?:["'])|(?:["'])$/gu, ''))
    .filter(Boolean);
}

function isTaskTagProperty(rawProperty: string, context: LogBaseFilterContext): boolean {
  if (!/^(?:task\.)?tags?$/iu.test(String(rawProperty || '').trim())) return false;
  const rowKind = normalizeKey(context.rowKind ?? context.fields.kind);
  return rowKind === 'task' || Array.isArray(context.taskTags);
}

function isExactContainsProperty(rawProperty: string, context: LogBaseFilterContext): boolean {
  return isTaskTagProperty(rawProperty, context)
    || /^file\.tags?$/iu.test(String(rawProperty || '').trim())
    || resolveConfiguredProperty(context.configuredProperties, rawProperty)?.type === 'list'
    || (/^formula\./iu.test(String(rawProperty || '').trim())
      && Array.isArray(context.formulaSession?.get(rawProperty).value));
}

function readTaskTagValues(context: LogBaseFilterContext): string[] {
  const inlineTagFields = Object.entries(context.fields)
    .filter(([key]) => /^(?:tag|tags)$/u.test(normalizePropertyKeyIdentity(key)))
    .map(([, value]) => value);
  return parseTaskTagValues([context.taskTags ?? [], inlineTagFields]);
}

function findRecordKey(record: Record<string, unknown> | null | undefined, rawKey: string): string | null {
  return findPropertyKeyCaseInsensitive(record, rawKey);
}

function readRecordPathValues(record: Record<string, unknown>, path: string[]): unknown[] | null {
  if (!path.length) return [record];
  let value: unknown = record;
  for (const segment of path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const key = findRecordKey(value as Record<string, unknown>, segment);
    if (key == null) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return toValues(value);
}

function parsePropertyPath(rawProperty: string): string[] | null {
  const source = String(rawProperty || '').trim();
  if (!source) return null;
  const segments: string[] = [];
  let current = '';
  let index = 0;
  const pushCurrent = () => {
    const segment = current.trim();
    if (segment) segments.push(segment);
    current = '';
  };
  while (index < source.length) {
    const character = source[index];
    if (character === '.') {
      pushCurrent();
      index += 1;
      continue;
    }
    if (character !== '[') {
      current += character;
      index += 1;
      continue;
    }
    pushCurrent();
    index += 1;
    let quote: string | null = null;
    let escaped = false;
    let content = '';
    let closed = false;
    for (; index < source.length; index += 1) {
      const nested = source[index];
      if (quote) {
        if (escaped) {
          content += nested;
          escaped = false;
          continue;
        }
        if (nested === '\\') {
          escaped = true;
          continue;
        }
        if (nested === quote) {
          quote = null;
          continue;
        }
        content += nested;
        continue;
      }
      if (nested === '"' || nested === "'") {
        quote = nested;
        continue;
      }
      if (nested === ']') {
        closed = true;
        index += 1;
        break;
      }
      content += nested;
    }
    const segment = content.trim();
    if (!closed || quote || !segment) return null;
    segments.push(segment);
  }
  pushCurrent();
  return segments.length ? segments : null;
}

function evaluateValues(
  current: unknown[],
  rawOperator: string,
  expected: unknown[],
  exactContains = false,
): boolean | null {
  const operator = normalizeOperator(rawOperator);
  if (['isempty', 'empty'].includes(operator)) return current.length === 0 || current.every(isEmptyValue);
  if (['isnotempty', 'exists'].includes(operator)) return current.length > 0 && current.some((value) => !isEmptyValue(value));
  if (['contains', 'containsany', 'containsall'].includes(operator)) {
    const matches = (target: unknown) => current.some((value) => (
      exactContains
        ? normalizeValue(value) === normalizeValue(target)
        : normalizeValue(value).includes(normalizeValue(target))
    ));
    return operator === 'containsall' ? expected.every(matches) : expected.some(matches);
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
  if (
    left instanceof Date
    || right instanceof Date
    || (left && typeof left === 'object')
    || (right && typeof right === 'object')
  ) return compareTpsFormulaValues(left, right);
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

function splitArguments(raw: string): string[] | null {
  if (!raw.trim()) return [];
  const values: string[] = [];
  const state = createScannerState();
  let start = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === ',' && isScannerTopLevel(state)) {
      const value = raw.slice(start, index).trim();
      if (!value) return null;
      values.push(value);
      start = index + 1;
      continue;
    }
    updateScannerState(state, raw, index);
  }
  if (!isScannerTopLevel(state)) return null;
  const value = raw.slice(start).trim();
  if (!value) return null;
  values.push(value);
  return values;
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

function normalizeOperator(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase().replace(/[\s_-]+/gu, '');
}

function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function normalizeValue(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/^#/u, '');
}

function normalizePathValue(value: unknown): string {
  return String(value ?? '').trim().replace(/^\/+|\/+$/gu, '').toLocaleLowerCase();
}

function normalizeLinkValue(value: unknown): string {
  const raw = String(value ?? '').trim();
  const wikilink = raw.match(/^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/u);
  return String(wikilink?.[1] ?? raw).trim().replace(/\.md$/iu, '').toLocaleLowerCase();
}

function toComparableDate(value: Date | number | string): Date | number | string {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : value;
}
