export type TpsBaseLineCreationKind = 'task' | 'bullet' | 'heading';

export type TpsBaseLineCreationSource = {
  rootIndex: number;
  path: string;
  expression: string;
};

export type TpsBaseLineCreationProvenance = {
  kind: TpsBaseLineCreationSource | null;
  headingLevel: TpsBaseLineCreationSource | null;
  status: TpsBaseLineCreationSource | null;
  targetPath: TpsBaseLineCreationSource | null;
  fields: Record<string, TpsBaseLineCreationSource>;
  tags: Record<string, TpsBaseLineCreationSource>;
};

export type TpsBaseLineCreationDiagnostics = {
  nodeVisits: number;
  maxConcurrentStates: number;
  searchLimited: boolean;
  selectedBranches: string[];
  unsupportedFilters: string[];
  conflicts: string[];
};

export type TpsBaseLineCreationPlan = {
  kind: TpsBaseLineCreationKind | null;
  headingLevel: number | null;
  status: string | null;
  targetPath: string | null;
  targetPathSpecified: boolean;
  fields: Record<string, string>;
  tags: string[];
  blockedReason: string | null;
  diagnostics: TpsBaseLineCreationDiagnostics;
  provenance: TpsBaseLineCreationProvenance;
};

export type TpsBaseLineCreationOptions = {
  resolveValue?: (value: string) => string;
  today?: string;
  maxStates?: number;
  maxNodeVisits?: number;
  defaultOpenStatus?: string;
  defaultDoneStatus?: string;
  isDoneStatus?: (status: string) => boolean | null;
  nonTaskStatusAsField?: boolean;
};

type SourceValue = {
  value: string;
  source: TpsBaseLineCreationSource;
};

type DateBounds = {
  min: number | null;
  max: number | null;
  excluded: Set<number>;
  source: TpsBaseLineCreationSource;
};

type SolverState = {
  kind: TpsBaseLineCreationKind | null;
  kindSource: TpsBaseLineCreationSource | null;
  headingLevel: number | null;
  headingLevelSource: TpsBaseLineCreationSource | null;
  forbiddenKinds: Set<TpsBaseLineCreationKind>;
  forbiddenHeadingLevels: Set<number>;
  status: string | null;
  statusDisplay: string | null;
  statusSource: TpsBaseLineCreationSource | null;
  done: boolean | null;
  forbiddenStatuses: Set<string>;
  targetPath: string | null;
  comparableTargetPath: string | null;
  targetPathSpecified: boolean;
  targetPathSource: TpsBaseLineCreationSource | null;
  forbiddenTargetPaths: Set<string>;
  fields: Map<string, SourceValue>;
  forbiddenFields: Map<string, Set<string>>;
  emptyFields: Set<string>;
  requiredFields: Set<string>;
  tags: Map<string, SourceValue>;
  forbiddenTags: Set<string>;
  dates: Map<string, DateBounds>;
  selectedBranches: string[];
  unsupportedFilters: string[];
};

type ResolvedLiteral = {
  value: string;
  supported: boolean;
};

type SolverContext = {
  options: Required<Pick<TpsBaseLineCreationOptions, 'maxStates' | 'maxNodeVisits' | 'defaultOpenStatus' | 'defaultDoneStatus'>> & TpsBaseLineCreationOptions;
  nodeVisits: number;
  maxConcurrentStates: number;
  searchLimited: boolean;
  unsupportedFilters: Set<string>;
  conflicts: Set<string>;
};

type ParsedCondition = {
  property: string;
  operator: string;
  values: string[];
  expression: string;
};

const EQUALITY_OPERATORS = new Set(['=', '==', 'is', 'equal', 'equals']);
const NEGATED_EQUALITY_OPERATORS = new Set(['!=', '!==', 'isnot', 'notequal', 'notequals', 'doesnotequal']);
const DONE_STATUS_NAMES = new Set(['complete', 'completed', 'done', 'wont-do', 'wontdo', 'cancelled', 'canceled']);
const OPEN_STATUS_NAMES = new Set(['todo', 'open', 'working', 'holding', 'in-progress', 'inprogress', 'backlog']);
const KIND_PROPERTIES = new Set(['kind', 'itemkind', 'itemtype']);
const STATUS_PROPERTIES = new Set(['status', 'checkboxstatus']);
const OPEN_PROPERTIES = new Set(['open', 'isopen']);
const DONE_PROPERTIES = new Set(['done', 'isdone', 'complete', 'completed']);
const TAG_PROPERTIES = new Set(['tag', 'tags']);

/**
 * Resolves the ordered active-view and whole-Base filters into one safe line
 * creation plan. Roots are a conjunction. OR/ANY alternatives retain source
 * order, but the solver backtracks when an earlier alternative conflicts with
 * a later filter, preserving branch correlation.
 */
export function resolveTpsBaseLineCreationPlan(
  roots: unknown[],
  options: TpsBaseLineCreationOptions = {},
): TpsBaseLineCreationPlan {
  const context: SolverContext = {
    options: {
      ...options,
      maxStates: clampLimit(options.maxStates, 64),
      maxNodeVisits: clampLimit(options.maxNodeVisits, 256),
      defaultOpenStatus: normalizeValue(options.defaultOpenStatus || 'todo') || 'todo',
      defaultDoneStatus: normalizeValue(options.defaultDoneStatus || 'complete') || 'complete',
    },
    nodeVisits: 0,
    maxConcurrentStates: 1,
    searchLimited: false,
    unsupportedFilters: new Set(),
    conflicts: new Set(),
  };

  let states: SolverState[] = [createInitialState()];
  for (let rootIndex = 0; rootIndex < roots.length && states.length > 0; rootIndex += 1) {
    states = expandAcrossStates(roots[rootIndex], states, true, context, rootIndex, `root[${rootIndex}]`);
  }

  const finalized = states
    .map((state) => finalizeState(state, context))
    .filter((state): state is SolverState => state != null)
    .map((state, index) => ({ state, index }))
    .sort((left, right) => (
      left.state.unsupportedFilters.length - right.state.unsupportedFilters.length
      || left.index - right.index
    ))[0]?.state;
  if (!finalized) {
    return emptyPlan(
      context.searchLimited
        ? 'filter-search-limit'
        : context.conflicts.values().next().value || 'no-satisfiable-creation-defaults',
      context,
    );
  }

  const fields = Object.fromEntries(Array.from(finalized.fields, ([key, entry]) => [key, entry.value]));

  const tags = Array.from(finalized.tags.values()).map((entry) => entry.value);
  const fieldProvenance = Object.fromEntries(Array.from(finalized.fields, ([key, entry]) => [key, entry.source]));
  const tagProvenance = Object.fromEntries(Array.from(finalized.tags, ([key, entry]) => [key, entry.source]));

  return {
    kind: finalized.kind,
    headingLevel: finalized.kind === 'heading' ? finalized.headingLevel ?? 1 : null,
    status: finalized.status,
    targetPath: finalized.targetPath,
    targetPathSpecified: finalized.targetPathSpecified,
    fields,
    tags,
    blockedReason: null,
    diagnostics: diagnosticsFor(finalized, context),
    provenance: {
      kind: finalized.kindSource,
      headingLevel: finalized.headingLevelSource,
      status: finalized.statusSource,
      targetPath: finalized.targetPathSource,
      fields: fieldProvenance,
      tags: tagProvenance,
    },
  };
}

function expandAcrossStates(
  node: unknown,
  states: SolverState[],
  positive: boolean,
  context: SolverContext,
  rootIndex: number,
  path: string,
): SolverState[] {
  const expanded: SolverState[] = [];
  for (const state of states) {
    if (context.searchLimited) break;
    expanded.push(...expandNode(node, state, positive, context, rootIndex, path));
    if (expanded.length >= context.options.maxStates) {
      if (expanded.length > context.options.maxStates) context.searchLimited = true;
      break;
    }
  }
  const limited = expanded.slice(0, context.options.maxStates);
  context.maxConcurrentStates = Math.max(context.maxConcurrentStates, limited.length);
  return limited;
}

function expandNode(
  node: unknown,
  state: SolverState,
  positive: boolean,
  context: SolverContext,
  rootIndex: number,
  path: string,
): SolverState[] {
  context.nodeVisits += 1;
  if (context.nodeVisits > context.options.maxNodeVisits) {
    context.searchLimited = true;
    return [];
  }
  if (node == null || node === '') return [state];
  if (typeof node === 'string') {
    let expression = node.trim();
    let effectivePositive = positive;
    while (expression.startsWith('!') && !expression.startsWith('!=')) {
      effectivePositive = !effectivePositive;
      expression = expression.slice(1).trim();
    }
    const condition = parseStringCondition(expression);
    if (!condition) {
      return [markUnsupported(state, context, `${path}: ${expression}`)];
    }
    return applyCondition(state, condition, effectivePositive, context, rootIndex, path);
  }
  if (Array.isArray(node)) {
    return expandGroup(node, state, positive ? 'and' : 'or', positive, context, rootIndex, path);
  }
  if (typeof node !== 'object') {
    return [markUnsupported(state, context, `${path}: ${String(node)}`)];
  }

  const record = node as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, 'not')) {
    return expandNode(record.not, state, !positive, context, rootIndex, `${path}.not`);
  }
  const explicitGroup = normalizeOperator(record.operator ?? record.op ?? record.type);
  const groupEntry = findGroupEntry(record, explicitGroup);
  if (groupEntry) {
    const logical = positive ? groupEntry.logical : invertLogical(groupEntry.logical);
    return expandGroup(
      asArray(groupEntry.children),
      state,
      logical,
      positive,
      context,
      rootIndex,
      `${path}.${groupEntry.key}`,
    );
  }

  const condition = parseObjectCondition(record);
  if (!condition) {
    const inline = record.expression ?? record.expr ?? record.text ?? record.raw;
    if (typeof inline === 'string') {
      return expandNode(inline, state, positive, context, rootIndex, `${path}.expression`);
    }
    return [markUnsupported(state, context, `${path}: ${safeStringify(record)}`)];
  }
  const effectivePositive = record.negated === true || record.exclude === true ? !positive : positive;
  return applyCondition(state, condition, effectivePositive, context, rootIndex, path);
}

function expandGroup(
  children: unknown[],
  state: SolverState,
  logical: 'and' | 'or',
  childPositive: boolean,
  context: SolverContext,
  rootIndex: number,
  path: string,
): SolverState[] {
  if (logical === 'and') {
    let states = [state];
    for (let index = 0; index < children.length && states.length > 0; index += 1) {
      states = expandAcrossStates(
        children[index],
        states,
        childPositive,
        context,
        rootIndex,
        `${path}[${index}]`,
      );
    }
    return states;
  }

  const branches: SolverState[] = [];
  for (let index = 0; index < children.length; index += 1) {
    if (branches.length >= context.options.maxStates || context.searchLimited) {
      if (index < children.length) context.searchLimited = true;
      break;
    }
    const branchState = cloneState(state);
    branchState.selectedBranches.push(`${path}[${index}]`);
    const resolved = expandNode(
      children[index],
      branchState,
      childPositive,
      context,
      rootIndex,
      `${path}[${index}]`,
    );
    branches.push(...resolved.slice(0, context.options.maxStates - branches.length));
  }
  context.maxConcurrentStates = Math.max(context.maxConcurrentStates, branches.length);
  return branches;
}

function applyCondition(
  state: SolverState,
  condition: ParsedCondition,
  positive: boolean,
  context: SolverContext,
  rootIndex: number,
  path: string,
): SolverState[] {
  const operator = normalizeOperator(condition.operator);
  let effectivePositive = positive;
  let semanticOperator = operator;
  if (NEGATED_EQUALITY_OPERATORS.has(operator)) {
    effectivePositive = !effectivePositive;
    semanticOperator = 'equals';
  }
  const source: TpsBaseLineCreationSource = {
    rootIndex,
    path,
    expression: condition.expression,
  };
  const property = normalizeProperty(condition.property);
  const semanticProperty = normalizeSemanticProperty(property);
  const literalResults = condition.values.map((value) => resolveLiteral(value, context.options));
  const resolvedValues = literalResults.filter((entry) => entry.supported).map((entry) => entry.value).filter((value) => value !== '');
  if (literalResults.some((entry) => !entry.supported) && resolvedValues.length === 0) {
    return [markUnsupported(state, context, `${path}: ${condition.expression}`)];
  }

  if (KIND_PROPERTIES.has(semanticProperty) && EQUALITY_OPERATORS.has(semanticOperator)) {
    return applyAlternatives(state, resolvedValues, source, context, path, (candidate, rawValue) => (
      applyKind(candidate, rawValue, effectivePositive, source, context)
    ));
  }

  if (property === 'file.path' || property === 'task.path') {
    if (!EQUALITY_OPERATORS.has(semanticOperator)) {
      return [markUnsupported(state, context, `${path}: ${condition.expression}`)];
    }
    return applyAlternatives(state, resolvedValues.length ? resolvedValues : [''], source, context, path, (candidate, rawValue) => (
      applyTargetPath(candidate, rawValue, effectivePositive, source, context)
    ));
  }

  if (isFileOrNoteMetadata(property)) {
    return [markUnsupported(state, context, `${path}: ${condition.expression}`)];
  }

  if (OPEN_PROPERTIES.has(semanticProperty) || DONE_PROPERTIES.has(semanticProperty)) {
    if (!EQUALITY_OPERATORS.has(semanticOperator) || resolvedValues.length === 0) {
      return [markUnsupported(state, context, `${path}: ${condition.expression}`)];
    }
    return applyAlternatives(state, resolvedValues, source, context, path, (candidate, rawValue) => {
      const boolean = parseBoolean(rawValue);
      if (boolean == null) return null;
      const done = OPEN_PROPERTIES.has(semanticProperty) ? !boolean : boolean;
      return applyDoneConstraint(candidate, effectivePositive ? done : !done, source, context);
    });
  }

  if (STATUS_PROPERTIES.has(semanticProperty) && EQUALITY_OPERATORS.has(semanticOperator)) {
    return applyAlternatives(state, resolvedValues, source, context, path, (candidate, rawValue) => (
      applyStatus(candidate, rawValue, effectivePositive, source, context)
    ));
  }

  if (TAG_PROPERTIES.has(semanticProperty) && ['equals', '=', '==', 'is', 'equal', 'contains', 'containsany'].includes(semanticOperator)) {
    return applyAlternatives(state, resolvedValues, source, context, path, (candidate, rawValue) => (
      applyTag(candidate, rawValue, effectivePositive, source, context)
    ));
  }

  const fieldKey = sanitizeFieldKey(semanticProperty);
  if (!fieldKey || ['title', 'line', 'source', 'extension', 'ext'].includes(semanticProperty)) {
    return [markUnsupported(state, context, `${path}: ${condition.expression}`)];
  }

  if (['isempty', 'empty'].includes(semanticOperator)) {
    return applyEmptyConstraint(state, fieldKey, effectivePositive, source, context);
  }
  if (['isnotempty', 'exists'].includes(semanticOperator)) {
    return applyRequiredConstraint(state, fieldKey, effectivePositive, source, context);
  }

  const dateOperator = normalizedDateOperator(semanticOperator, effectivePositive);
  if (dateOperator && resolvedValues.length > 0 && isIsoDate(resolvedValues[0])) {
    return applyAlternatives(state, resolvedValues, source, context, path, (candidate, rawValue) => (
      applyDateConstraint(candidate, fieldKey, dateOperator, rawValue, source, context)
    ));
  }

  if (EQUALITY_OPERATORS.has(semanticOperator) || ['contains', 'containsany'].includes(semanticOperator)) {
    return applyAlternatives(state, resolvedValues, source, context, path, (candidate, rawValue) => (
      applyField(candidate, fieldKey, rawValue, effectivePositive, source, context)
    ));
  }

  return [markUnsupported(state, context, `${path}: ${condition.expression}`)];
}

function applyAlternatives(
  state: SolverState,
  values: string[],
  source: TpsBaseLineCreationSource,
  context: SolverContext,
  path: string,
  apply: (state: SolverState, value: string) => SolverState | null,
): SolverState[] {
  if (values.length === 0) {
    return [markUnsupported(state, context, `${path}: ${source.expression}`)];
  }
  const results: SolverState[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (results.length >= context.options.maxStates) {
      context.searchLimited = true;
      break;
    }
    const candidate = cloneState(state);
    if (values.length > 1) candidate.selectedBranches.push(`${path}.value[${index}]`);
    const next = apply(candidate, values[index]);
    if (next) results.push(next);
  }
  context.maxConcurrentStates = Math.max(context.maxConcurrentStates, results.length);
  return results;
}

function applyKind(
  state: SolverState,
  rawValue: string,
  positive: boolean,
  source: TpsBaseLineCreationSource,
  context: SolverContext,
): SolverState | null {
  const parsed = parseKind(rawValue);
  if (!parsed) return state;
  if (!positive) {
    if (parsed.kind === 'heading' && parsed.headingLevel != null) {
      if (state.kind === 'heading' && state.headingLevel === parsed.headingLevel) return conflict(context, `kind-conflict:${rawValue}`);
      state.forbiddenHeadingLevels.add(parsed.headingLevel);
      return state;
    }
    if (state.kind === parsed.kind) return conflict(context, `kind-conflict:${rawValue}`);
    state.forbiddenKinds.add(parsed.kind);
    return state;
  }
  if (state.forbiddenKinds.has(parsed.kind)) return conflict(context, `kind-conflict:${rawValue}`);
  if (state.kind && state.kind !== parsed.kind) return conflict(context, `kind-conflict:${state.kind}:${parsed.kind}`);
  if (parsed.kind === 'heading' && parsed.headingLevel != null) {
    if (state.forbiddenHeadingLevels.has(parsed.headingLevel)) return conflict(context, `heading-level-conflict:${parsed.headingLevel}`);
    if (state.headingLevel != null && state.headingLevel !== parsed.headingLevel) {
      return conflict(context, `heading-level-conflict:${state.headingLevel}:${parsed.headingLevel}`);
    }
    state.headingLevel = parsed.headingLevel;
    state.headingLevelSource = source;
  }
  state.kind = parsed.kind;
  state.kindSource ??= source;
  return state;
}

function applyTargetPath(
  state: SolverState,
  rawValue: string,
  positive: boolean,
  source: TpsBaseLineCreationSource,
  context: SolverContext,
): SolverState | null {
  const comparable = normalizeComparableTargetPath(rawValue);
  if (!positive) {
    if (!comparable) return state;
    if (state.comparableTargetPath === comparable) return conflict(context, `target-path-conflict:${comparable}`);
    state.forbiddenTargetPaths.add(comparable);
    return state;
  }
  if (!comparable) return conflict(context, 'unresolved-target-path');
  if (state.forbiddenTargetPaths.has(comparable)) return conflict(context, `target-path-conflict:${comparable}`);
  if (state.targetPathSpecified && state.comparableTargetPath !== comparable) {
    return conflict(context, `target-path-conflict:${state.comparableTargetPath || 'empty'}:${comparable}`);
  }
  if (!state.targetPathSpecified) {
    state.targetPath = rawValue.trim();
    state.comparableTargetPath = comparable;
    state.targetPathSpecified = true;
    state.targetPathSource = source;
  }
  return state;
}

function applyDoneConstraint(
  state: SolverState,
  done: boolean,
  source: TpsBaseLineCreationSource,
  context: SolverContext,
): SolverState | null {
  if (state.done != null && state.done !== done) return conflict(context, `task-completion-conflict:${state.done}:${done}`);
  if (state.status) {
    const classified = classifyDoneStatus(state.status, context.options);
    if (classified != null && classified !== done) return conflict(context, `status-completion-conflict:${state.status}`);
  }
  state.done = done;
  state.statusSource ??= source;
  return state;
}

function applyStatus(
  state: SolverState,
  rawValue: string,
  positive: boolean,
  source: TpsBaseLineCreationSource,
  context: SolverContext,
): SolverState | null {
  const status = normalizeValue(rawValue);
  if (!status) return state;
  if (!positive) {
    if (state.status === status) return conflict(context, `status-conflict:${status}`);
    state.forbiddenStatuses.add(status);
    return state;
  }
  if (state.forbiddenStatuses.has(status)) return conflict(context, `status-conflict:${status}`);
  if (state.status && state.status !== status) return conflict(context, `status-conflict:${state.status}:${status}`);
  const classified = classifyDoneStatus(status, context.options);
  if (state.done != null && classified != null && state.done !== classified) {
    return conflict(context, `status-completion-conflict:${status}`);
  }
  state.status = status;
  state.statusDisplay = String(rawValue || '').trim() || status;
  state.statusSource = source;
  return state;
}

function applyTag(
  state: SolverState,
  rawValue: string,
  positive: boolean,
  source: TpsBaseLineCreationSource,
  context: SolverContext,
): SolverState | null {
  const display = normalizeTagDisplay(rawValue);
  const comparable = normalizeTag(display);
  if (!comparable) return state;
  if (!positive) {
    if (state.tags.has(comparable)) return conflict(context, `tag-conflict:${display}`);
    state.forbiddenTags.add(comparable);
    return state;
  }
  if (state.forbiddenTags.has(comparable)) return conflict(context, `tag-conflict:${display}`);
  if (!state.tags.has(comparable)) state.tags.set(comparable, { value: display, source });
  return state;
}

function applyField(
  state: SolverState,
  key: string,
  rawValue: string,
  positive: boolean,
  source: TpsBaseLineCreationSource,
  context: SolverContext,
): SolverState | null {
  const value = String(rawValue || '').trim();
  const comparable = normalizeValue(value);
  if (!value) return state;
  if (!positive) {
    if (normalizeValue(state.fields.get(key)?.value) === comparable) return conflict(context, `field-conflict:${key}:${value}`);
    const forbidden = state.forbiddenFields.get(key) ?? new Set<string>();
    forbidden.add(comparable);
    state.forbiddenFields.set(key, forbidden);
    return state;
  }
  if (state.emptyFields.has(key)) return conflict(context, `field-empty-conflict:${key}`);
  if (state.forbiddenFields.get(key)?.has(comparable)) return conflict(context, `field-conflict:${key}:${value}`);
  const current = state.fields.get(key);
  if (current && normalizeValue(current.value) !== comparable) {
    return conflict(context, `field-conflict:${key}:${current.value}:${value}`);
  }
  if (!current) state.fields.set(key, { value, source });
  state.requiredFields.delete(key);
  return state;
}

function applyEmptyConstraint(
  state: SolverState,
  key: string,
  empty: boolean,
  source: TpsBaseLineCreationSource,
  context: SolverContext,
): SolverState[] {
  if (!empty) return applyRequiredConstraint(state, key, true, source, context);
  if (state.fields.has(key) || state.dates.has(key) || state.requiredFields.has(key)) {
    conflict(context, `field-empty-conflict:${key}`);
    return [];
  }
  const next = cloneState(state);
  next.emptyFields.add(key);
  return [next];
}

function applyRequiredConstraint(
  state: SolverState,
  key: string,
  required: boolean,
  source: TpsBaseLineCreationSource,
  context: SolverContext,
): SolverState[] {
  if (!required) return applyEmptyConstraint(state, key, true, source, context);
  if (state.emptyFields.has(key)) {
    conflict(context, `field-empty-conflict:${key}`);
    return [];
  }
  const next = cloneState(state);
  if (!next.fields.has(key) && !next.dates.has(key)) {
    if (isDateLikeProperty(key)) {
      const today = resolveToday(context.options);
      const applied = applyDateConstraint(next, key, '==', today, source, context);
      return applied ? [applied] : [];
    }
    next.requiredFields.add(key);
  }
  return [next];
}

function applyDateConstraint(
  state: SolverState,
  key: string,
  operator: string,
  rawValue: string,
  source: TpsBaseLineCreationSource,
  context: SolverContext,
): SolverState | null {
  if (state.emptyFields.has(key)) return conflict(context, `field-empty-conflict:${key}`);
  const day = isoDayNumber(rawValue);
  if (day == null) return state;
  const current = state.dates.get(key) ?? { min: null, max: null, excluded: new Set<number>(), source };
  const bounds: DateBounds = {
    min: current.min,
    max: current.max,
    excluded: new Set(current.excluded),
    source: current.source,
  };
  if (operator === '==') {
    bounds.min = maxNullable(bounds.min, day);
    bounds.max = minNullable(bounds.max, day);
  } else if (operator === '!=') {
    bounds.excluded.add(day);
  } else if (operator === '>=') {
    bounds.min = maxNullable(bounds.min, day);
  } else if (operator === '>') {
    bounds.min = maxNullable(bounds.min, day + 1);
  } else if (operator === '<=') {
    bounds.max = minNullable(bounds.max, day);
  } else if (operator === '<') {
    bounds.max = minNullable(bounds.max, day - 1);
  }
  if (bounds.min != null && bounds.max != null && bounds.min > bounds.max) {
    return conflict(context, `date-range-conflict:${key}`);
  }
  if (bounds.min != null && bounds.max === bounds.min && bounds.excluded.has(bounds.min)) {
    return conflict(context, `date-range-conflict:${key}`);
  }
  state.dates.set(key, bounds);
  state.requiredFields.delete(key);
  return state;
}

function finalizeState(state: SolverState, context: SolverContext): SolverState | null {
  const result = cloneState(state);
  if (result.kind && result.kind !== 'task' && result.done != null) {
    return conflict(context, `status-kind-conflict:${result.kind}`);
  }
  if (result.kind && result.kind !== 'task' && result.status != null) {
    if (!context.options.nonTaskStatusAsField || !result.statusSource) {
      return conflict(context, `status-kind-conflict:${result.kind}`);
    }
    if (!applyField(result, 'status', result.statusDisplay || result.status, true, result.statusSource, context)) return null;
    result.status = null;
    result.statusDisplay = null;
    result.statusSource = null;
  }
  if (result.kind === 'heading') {
    if (result.headingLevel == null) {
      result.headingLevel = [1, 2, 3, 4, 5, 6].find((level) => !result.forbiddenHeadingLevels.has(level)) ?? null;
      if (result.headingLevel == null) return conflict(context, 'heading-level-conflict:all-levels');
    }
  }

  if (result.done != null && result.status == null) {
    result.status = chooseStatusForDone(result.done, result.forbiddenStatuses, context.options);
    if (!result.status) return conflict(context, `status-conflict:${result.done ? 'done' : 'open'}`);
  }
  if (result.status && result.forbiddenStatuses.has(result.status)) return conflict(context, `status-conflict:${result.status}`);

  for (const [key, bounds] of result.dates) {
    let day = bounds.min ?? bounds.max ?? isoDayNumber(resolveToday(context.options));
    if (day == null) return conflict(context, `date-default-conflict:${key}`);
    if (bounds.max != null && day > bounds.max) return conflict(context, `date-range-conflict:${key}`);
    while (bounds.excluded.has(day) && (bounds.max == null || day < bounds.max)) day += 1;
    if (bounds.excluded.has(day) || (bounds.max != null && day > bounds.max)) return conflict(context, `date-range-conflict:${key}`);
    const value = isoDateFromDayNumber(day);
    const existing = result.fields.get(key);
    if (existing && existing.value !== value) return conflict(context, `field-conflict:${key}:${existing.value}:${value}`);
    result.fields.set(key, { value, source: bounds.source });
  }

  for (const key of result.requiredFields) {
    if (!result.fields.has(key)) {
      markUnsupported(result, context, `required-field-without-default:${key}`);
    }
  }
  return result;
}

function createInitialState(): SolverState {
  return {
    kind: null,
    kindSource: null,
    headingLevel: null,
    headingLevelSource: null,
    forbiddenKinds: new Set(),
    forbiddenHeadingLevels: new Set(),
    status: null,
    statusDisplay: null,
    statusSource: null,
    done: null,
    forbiddenStatuses: new Set(),
    targetPath: null,
    comparableTargetPath: null,
    targetPathSpecified: false,
    targetPathSource: null,
    forbiddenTargetPaths: new Set(),
    fields: new Map(),
    forbiddenFields: new Map(),
    emptyFields: new Set(),
    requiredFields: new Set(),
    tags: new Map(),
    forbiddenTags: new Set(),
    dates: new Map(),
    selectedBranches: [],
    unsupportedFilters: [],
  };
}

function cloneState(state: SolverState): SolverState {
  return {
    ...state,
    forbiddenKinds: new Set(state.forbiddenKinds),
    forbiddenHeadingLevels: new Set(state.forbiddenHeadingLevels),
    forbiddenStatuses: new Set(state.forbiddenStatuses),
    forbiddenTargetPaths: new Set(state.forbiddenTargetPaths),
    fields: new Map(state.fields),
    forbiddenFields: new Map(Array.from(state.forbiddenFields, ([key, values]) => [key, new Set(values)])),
    emptyFields: new Set(state.emptyFields),
    requiredFields: new Set(state.requiredFields),
    tags: new Map(state.tags),
    forbiddenTags: new Set(state.forbiddenTags),
    dates: new Map(Array.from(state.dates, ([key, bounds]) => [key, {
      ...bounds,
      excluded: new Set(bounds.excluded),
    }])),
    selectedBranches: [...state.selectedBranches],
    unsupportedFilters: [...state.unsupportedFilters],
  };
}

function parseStringCondition(expression: string): ParsedCondition | null {
  const call = expression.match(/^([\w.\s-]+)\.(containsAny|contains|isEmpty|empty|isNotEmpty|exists)\((.*)\)$/iu);
  if (call) {
    return {
      property: call[1].trim(),
      operator: call[2],
      values: splitArguments(call[3]),
      expression,
    };
  }
  const comparison = expression.match(/^([\w.\s-]+)\s*(===|!==|==|!=|>=|<=|>|<|=|is\s+not|is|equals?|does\s+not\s+equal)\s*(.+)$/iu);
  if (!comparison) return null;
  return {
    property: comparison[1].trim(),
    operator: comparison[2],
    values: [comparison[3].trim()],
    expression,
  };
}

function parseObjectCondition(record: Record<string, unknown>): ParsedCondition | null {
  const property = String(record.property ?? record.field ?? record.key ?? record.left ?? record.lhs ?? '').trim();
  if (!property) return null;
  const operator = String(record.operator ?? record.op ?? record.comparison ?? record.condition ?? 'equals').trim();
  const rawValues = record.values ?? record.value ?? record.expected ?? record.right ?? record.rhs ?? record.target;
  return {
    property,
    operator,
    values: asArray(rawValues).map((value) => String(value ?? '').trim()),
    expression: safeStringify(record),
  };
}

function findGroupEntry(
  record: Record<string, unknown>,
  explicitOperator: string,
): { key: string; logical: 'and' | 'or'; children: unknown } | null {
  for (const key of ['and', 'all', 'or', 'any', 'filters', 'children', 'data']) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const logical = key === 'or' || key === 'any' || (['children', 'data'].includes(key) && ['or', 'any'].includes(explicitOperator))
      ? 'or'
      : 'and';
    return { key, logical, children: record[key] };
  }
  return null;
}

function parseKind(rawValue: string): { kind: TpsBaseLineCreationKind; headingLevel: number | null } | null {
  const value = normalizeValue(rawValue).replace(/\s+/gu, '');
  if (value === 'task' || value === 'tasks') return { kind: 'task', headingLevel: null };
  if (value === 'bullet' || value === 'bullets') return { kind: 'bullet', headingLevel: null };
  if (value === 'header' || value === 'headers' || value === 'heading' || value === 'headings') {
    return { kind: 'heading', headingLevel: null };
  }
  const heading = value.match(/^h([1-6])$/u);
  return heading ? { kind: 'heading', headingLevel: Number(heading[1]) } : null;
}

function normalizedDateOperator(operator: string, positive: boolean): string | null {
  const normalized = EQUALITY_OPERATORS.has(operator) ? '==' : operator;
  if (!['==', '>', '>=', '<', '<='].includes(normalized)) return null;
  if (positive) return normalized;
  if (normalized === '==') return '!=';
  if (normalized === '>') return '<=';
  if (normalized === '>=') return '<';
  if (normalized === '<') return '>=';
  return '>';
}

function resolveLiteral(rawValue: string, options: TpsBaseLineCreationOptions): ResolvedLiteral {
  const stripped = stripWrappingQuotes(String(rawValue ?? '').trim());
  const dateValue = resolveTpsBaseDateExpression(stripped, options);
  if (dateValue) return { value: dateValue, supported: true };
  if (/^(?:today|date)\s*\(/iu.test(stripped)) {
    return { value: '', supported: false };
  }
  return {
    value: normalizeResolvedLiteral(options.resolveValue?.(stripped) ?? stripped),
    supported: true,
  };
}

export function resolveTpsBaseDateExpression(
  rawValue: string,
  options: Pick<TpsBaseLineCreationOptions, 'resolveValue' | 'today'> = {},
): string | null {
  const expression = String(rawValue ?? '').trim();
  let baseValue = '';
  let remainder = '';
  const todayMatch = expression.match(/^today\(\)([\s\S]*)$/iu);
  if (todayMatch) {
    baseValue = resolveToday(options);
    remainder = todayMatch[1] || '';
  } else {
    const dateMatch = expression.match(/^date\(\s*("[^"]*"|'[^']*'|[^)]*?)\s*\)([\s\S]*)$/iu);
    if (!dateMatch) return null;
    const inner = stripWrappingQuotes(dateMatch[1] || '');
    baseValue = normalizeResolvedLiteral(options.resolveValue?.(inner) ?? inner);
    remainder = dateMatch[2] || '';
  }
  let day = isoDayNumber(baseValue);
  if (day == null) return null;
  while (remainder.trim()) {
    const shift = remainder.match(/^\s*([+-])\s*["']?(\d+)\s*(d|w)["']?([\s\S]*)$/iu);
    if (!shift) return null;
    const amount = Number(shift[2]) * (shift[3].toLowerCase() === 'w' ? 7 : 1);
    day += shift[1] === '-' ? -amount : amount;
    remainder = shift[4] || '';
  }
  return isoDateFromDayNumber(day);
}

function resolveToday(options: TpsBaseLineCreationOptions): string {
  const supplied = String(options.today || '').trim();
  if (isIsoDate(supplied)) return supplied.slice(0, 10);
  const now = new Date();
  return [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function normalizeResolvedLiteral(value: unknown): string {
  const normalized = stripWrappingQuotes(String(value ?? '').trim());
  if (/^(true|false)$/iu.test(normalized)) return normalized.toLowerCase();
  return normalized;
}

function classifyDoneStatus(status: string, options: TpsBaseLineCreationOptions): boolean | null {
  const custom = options.isDoneStatus?.(status);
  if (custom != null) return custom;
  const normalized = normalizeValue(status);
  if (DONE_STATUS_NAMES.has(normalized)) return true;
  if (OPEN_STATUS_NAMES.has(normalized)) return false;
  return null;
}

function chooseStatusForDone(
  done: boolean,
  forbidden: Set<string>,
  options: SolverContext['options'],
): string | null {
  const preferred = done
    ? [options.defaultDoneStatus, 'complete', 'wont-do']
    : [options.defaultOpenStatus, 'todo', 'working', 'holding'];
  return preferred.map(normalizeValue).find((status) => status && !forbidden.has(status)) ?? null;
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

function normalizeProperty(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/gu, '');
}

function normalizeSemanticProperty(property: string): string {
  return property.replace(/^(?:tps|kanban|task)\./u, '');
}

function isFileOrNoteMetadata(property: string): boolean {
  return property.startsWith('file.')
    || property.startsWith('note.')
    || property === 'task.file.path';
}

function normalizeOperator(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/gu, '');
}

function normalizeValue(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeTagDisplay(value: string): string {
  const normalized = String(value || '').trim().replace(/^#+/u, '');
  return normalized ? `#${normalized}` : '';
}

function normalizeTag(value: string): string {
  return String(value || '').trim().replace(/^#+/u, '').toLowerCase();
}

function sanitizeFieldKey(value: string): string {
  return String(value || '').trim().replace(/[\[\]:]+/gu, '').replace(/\s+/gu, ' ');
}

function parseBoolean(value: string): boolean | null {
  const normalized = normalizeValue(value);
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
}

function splitArguments(raw: string): string[] {
  const values: string[] = [];
  let current = '';
  let quote = '';
  let depth = 0;
  for (const character of String(raw || '')) {
    if (quote) {
      current += character;
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') depth = Math.max(0, depth - 1);
    if (character === ',' && depth === 0) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim() || values.length > 0) values.push(current.trim());
  return values;
}

function stripWrappingQuotes(value: string): string {
  const raw = String(value || '').trim();
  if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
    return raw.slice(1, -1).trim();
  }
  return raw;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/u.test(String(value || '').trim()) && isoDayNumber(value) != null;
}

function isoDayNumber(value: string): number | null {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(time / 86_400_000);
}

function isoDateFromDayNumber(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function isDateLikeProperty(key: string): boolean {
  return /(?:^|[-_.])(scheduled|schedule|date|due|start|end)(?:$|[-_.])/iu.test(key)
    || ['scheduled', 'schedule', 'date', 'due', 'start', 'end'].includes(key.toLowerCase());
}

function maxNullable(left: number | null, right: number): number {
  return left == null ? right : Math.max(left, right);
}

function minNullable(left: number | null, right: number): number {
  return left == null ? right : Math.min(left, right);
}

function invertLogical(logical: 'and' | 'or'): 'and' | 'or' {
  return logical === 'and' ? 'or' : 'and';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function clampLimit(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.min(fallback, Math.floor(numeric)) : fallback;
}

function conflict(context: SolverContext, reason: string): null {
  context.conflicts.add(reason);
  return null;
}

function markUnsupported(state: SolverState, context: SolverContext, message: string): SolverState {
  context.unsupportedFilters.add(message);
  if (!state.unsupportedFilters.includes(message)) state.unsupportedFilters.push(message);
  return state;
}

function diagnosticsFor(state: SolverState, context: SolverContext): TpsBaseLineCreationDiagnostics {
  return {
    nodeVisits: Math.min(context.nodeVisits, context.options.maxNodeVisits),
    maxConcurrentStates: Math.min(context.maxConcurrentStates, context.options.maxStates),
    searchLimited: context.searchLimited,
    selectedBranches: [...state.selectedBranches],
    unsupportedFilters: [...state.unsupportedFilters],
    conflicts: Array.from(context.conflicts),
  };
}

function emptyPlan(blockedReason: string, context: SolverContext): TpsBaseLineCreationPlan {
  return {
    kind: null,
    headingLevel: null,
    status: null,
    targetPath: null,
    targetPathSpecified: false,
    fields: {},
    tags: [],
    blockedReason,
    diagnostics: diagnosticsFor(createInitialState(), context),
    provenance: {
      kind: null,
      headingLevel: null,
      status: null,
      targetPath: null,
      fields: {},
      tags: {},
    },
  };
}
