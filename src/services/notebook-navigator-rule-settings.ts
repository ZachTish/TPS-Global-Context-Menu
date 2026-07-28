import {
  DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS,
  ConditionGroup,
  HideRule,
  IconColorRule,
  NotebookNavigatorRuleConditionSource,
  NotebookNavigatorRuleMatchMode,
  NotebookNavigatorRuleOperator,
  NotebookNavigatorRuleSettings,
  NotebookNavigatorSmartRuleOperator,
  RuleCondition,
  SmartSortSettings,
  SortBucket,
  SortCriteria,
  SortFieldType,
  SortSegmentRule,
  SortValueMapping,
  createDefaultSortSegment,
  createRuleId,
  createSortBucketId,
  createSortSegmentId,
} from '../types';
import * as logger from '../logger';

const PROTECTED_FRONTMATTER_KEYS = new Set(['externaleventid', 'tpscalendaruid']);

export function sanitizeNotebookNavigatorRuleSettings(raw: unknown): NotebookNavigatorRuleSettings {
  const record = asRecord(raw);
  const rawSmartSort = record.smartSort;
  const smartSortRecord = asRecord(rawSmartSort);
  const hasLegacySortRules = Array.isArray(record.sortRules);
  const migratedSmartSort = Array.isArray(rawSmartSort)
    ? { buckets: rawSmartSort }
    : {
        ...smartSortRecord,
        segments: Array.isArray(smartSortRecord.segments)
          ? smartSortRecord.segments
          : hasLegacySortRules
            ? record.sortRules
            : smartSortRecord.segments,
      };

  return {
    enabled: asBoolean(record.enabled, DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.enabled),
    autoApplyOnFileOpen: asBoolean(record.autoApplyOnFileOpen, DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.autoApplyOnFileOpen),
    autoApplyOnMetadataChange: asBoolean(record.autoApplyOnMetadataChange, DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.autoApplyOnMetadataChange),
    applyOnStartup: asBoolean(record.applyOnStartup, DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.applyOnStartup),
    startupDelayMs: asNumber(record.startupDelayMs, DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.startupDelayMs, 0, 30000),
    metadataDebounceMs: asNumber(record.metadataDebounceMs, DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.metadataDebounceMs, 0, 5000),
    frontmatterIconField: normalizeSafeFrontmatterField(
      record.frontmatterIconField,
      DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.frontmatterIconField,
    ),
    frontmatterColorField: normalizeSafeFrontmatterField(
      record.frontmatterColorField,
      DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.frontmatterColorField,
    ),
    frontmatterWriteExclusions: normalizeMultilineString(
      record.frontmatterWriteExclusions,
      DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.frontmatterWriteExclusions,
    ),
    clearIconWhenNoMatch: asBoolean(record.clearIconWhenNoMatch, DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.clearIconWhenNoMatch),
    clearColorWhenNoMatch: asBoolean(record.clearColorWhenNoMatch, DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.clearColorWhenNoMatch),
    autoRemoveHiddenWhenNoMatch: asBoolean(
      record.autoRemoveHiddenWhenNoMatch,
      DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.autoRemoveHiddenWhenNoMatch,
    ),
    rules: sanitizeRules(record.rules),
    smartSort: sanitizeSmartSort(migratedSmartSort),
    hideRules: sanitizeHideRules(record.hideRules),
  };
}

function sanitizeHideRules(rawRules: unknown): HideRule[] {
  if (!Array.isArray(rawRules)) return [];
  return rawRules.map((rawRule): HideRule => {
    const record = asRecord(rawRule);
    return {
      id: normalizeString(record.id, `hide-rule-${Date.now()}`),
      name: normalizeString(record.name, ''),
      enabled: asBoolean(record.enabled, true),
      match: normalizeMatchMode(record.match),
      conditions: sanitizeConditions(record.conditions),
      mode: record.mode === 'remove' ? 'remove' : 'add',
      tagName: normalizeString(record.tagName, 'hide'),
    };
  });
}

function sanitizeRules(rawRules: unknown): IconColorRule[] {
  if (!Array.isArray(rawRules)) return [];
  return rawRules.map((rawRule): IconColorRule => {
    const record = asRecord(rawRule);
    return {
      id: normalizeString(record.id, createRuleId()),
      name: normalizeOptionalString(record.name),
      enabled: asBoolean(record.enabled, true),
      property: normalizeString(record.property, ''),
      operator: normalizeRuleOperator(record.operator),
      value: normalizeString(record.value, ''),
      pathPrefix: normalizePathPrefix(normalizeString(record.pathPrefix, '')),
      icon: normalizeString(record.icon, ''),
      color: normalizeString(record.color, ''),
      match: normalizeMatchMode(record.match),
      conditions: sanitizeConditions(record.conditions),
    };
  });
}

function sanitizeConditions(rawConditions: unknown): RuleCondition[] {
  if (!Array.isArray(rawConditions)) return [];
  const conditions: RuleCondition[] = [];
  for (const rawCondition of rawConditions) {
    const record = asRecord(rawCondition);
    const source = normalizeConditionSource(record.source);
    const operator = normalizeSmartOperator(record.operator);
    if (!source || !operator) continue;
    conditions.push({
      source,
      field: normalizeString(record.field, ''),
      operator,
      value: normalizeString(record.value, ''),
    });
  }
  return conditions;
}

function sanitizeSmartSort(rawSort: unknown): SmartSortSettings {
  const rawBuckets = Array.isArray(rawSort)
    ? rawSort
    : asRecord(rawSort).buckets ?? asRecord(rawSort).segments;
  const record = asRecord(rawSort);
  return {
    enabled: asBoolean(record.enabled, DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.smartSort.enabled),
    field: normalizeSafeFrontmatterField(record.field, DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.smartSort.field),
    separator: normalizeSeparator(record.separator, DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.smartSort.separator),
    appendBasename: asBoolean(record.appendBasename, DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.smartSort.appendBasename),
    relationshipGrouping: record.relationshipGrouping === 'children-under-parent' ? 'children-under-parent' : 'none',
    clearWhenNoMatch: asBoolean(record.clearWhenNoMatch, DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS.smartSort.clearWhenNoMatch),
    buckets: sanitizeSortBuckets(rawBuckets),
  };
}

function sanitizeSortBuckets(rawBuckets: unknown): SortBucket[] {
  if (!Array.isArray(rawBuckets)) return [];
  const buckets: SortBucket[] = [];
  for (const rawBucket of rawBuckets) {
    const record = asRecord(rawBucket);
    const isLegacySegment = record.fallback !== undefined && record.sortCriteria === undefined;
    const match = normalizeMatchMode(record.match);
    const conditions = sanitizeConditions(record.conditions);

    if (isLegacySegment) {
      const source = normalizeConditionSource(record.source) ?? createDefaultSortSegment().source;
      const field = normalizeString(record.field, '');
      buckets.push({
        id: normalizeString(record.id, createSortBucketId()),
        enabled: asBoolean(record.enabled, true),
        name: `Migrated: ${field || 'Unnamed'}`,
        match,
        conditions,
        conditionGroups: sanitizeConditionGroups(record.conditionGroups),
        sortCriteria: [{
          source,
          field,
          type: inferFieldType(field),
          direction: 'asc',
          mappings: sanitizeValueMappings(record.mappings ?? record.map),
          missingValuePlacement: 'last',
        }],
      });
      continue;
    }

    buckets.push({
      id: normalizeString(record.id, createSortBucketId()),
      enabled: asBoolean(record.enabled, true),
      name: normalizeString(record.name, 'Unnamed Bucket'),
      match,
      conditions,
      conditionGroups: sanitizeConditionGroups(record.conditionGroups),
      sortCriteria: sanitizeSortCriteria(record.sortCriteria),
    });
  }
  return buckets;
}

function sanitizeConditionGroups(rawGroups: unknown): ConditionGroup[] {
  if (!Array.isArray(rawGroups)) return [];
  return rawGroups.map((rawGroup, index): ConditionGroup => {
    const record = asRecord(rawGroup);
    return {
      id: normalizeString(record.id, `condition-group-${index + 1}`),
      match: normalizeMatchMode(record.match),
      conditions: sanitizeConditions(record.conditions),
    };
  });
}

function sanitizeSortSegments(rawSegments: unknown): SortSegmentRule[] {
  if (!Array.isArray(rawSegments)) return [];
  return rawSegments.map((rawSegment): SortSegmentRule => {
    const record = asRecord(rawSegment);
    const source = normalizeConditionSource(record.source) ?? createDefaultSortSegment().source;
    return {
      id: normalizeString(record.id, createSortSegmentId()),
      enabled: asBoolean(record.enabled, true),
      source,
      field: normalizeString(record.field, source === 'frontmatter' ? 'status' : ''),
      fallback: normalizeString(record.fallback, ''),
      mappings: sanitizeValueMappings(record.mappings ?? record.map),
      match: normalizeMatchMode(record.match),
      conditions: sanitizeConditions(record.conditions),
    };
  });
}

function sanitizeSortCriteria(rawCriteria: unknown): SortCriteria[] {
  if (!Array.isArray(rawCriteria)) return [];
  return rawCriteria.map((rawCriterion): SortCriteria => {
    const record = asRecord(rawCriterion);
    const field = normalizeString(record.field, '');
    return {
      source: normalizeConditionSource(record.source) ?? 'frontmatter',
      field,
      type: normalizeFieldType(record.type),
      direction: record.direction === 'desc' ? 'desc' : 'asc',
      mappings: sanitizeValueMappings(record.mappings),
      missingValuePlacement: record.missingValuePlacement === 'first' ? 'first' : 'last',
    };
  });
}

function sanitizeValueMappings(rawMappings: unknown): SortValueMapping[] {
  if (Array.isArray(rawMappings)) {
    return rawMappings
      .map((rawMapping) => {
        const record = asRecord(rawMapping);
        return {
          input: normalizeString(record.input, ''),
          output: normalizeString(record.output, ''),
        };
      })
      .filter((mapping) => mapping.input.length > 0 && mapping.output.length > 0);
  }

  if (typeof rawMappings === 'string') {
    return rawMappings
      .split(',')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .flatMap((pair) => {
        const separator = pair.includes('=') ? '=' : pair.includes(':') ? ':' : '';
        if (!separator) return [];
        const [rawInput, rawOutput] = pair.split(separator);
        const input = String(rawInput || '').trim();
        const output = String(rawOutput || '').trim();
        return input && output ? [{ input, output }] : [];
      });
  }

  return Object.entries(asRecord(rawMappings))
    .map(([input, output]) => ({
      input: String(input || '').trim(),
      output: String(output ?? '').trim(),
    }))
    .filter((mapping) => mapping.input.length > 0 && mapping.output.length > 0);
}

function normalizeRuleOperator(value: unknown): NotebookNavigatorRuleOperator {
  return value === 'is' || value === '!is' || value === 'contains' || value === '!contains' || value === 'exists' || value === '!exists'
    ? value
    : 'is';
}

function normalizeSmartOperator(value: unknown): NotebookNavigatorSmartRuleOperator | null {
  return value === 'is' ||
    value === 'contains' ||
    value === 'exists' ||
    value === '!is' ||
    value === '!contains' ||
    value === '!exists' ||
    value === 'is-not-empty' ||
    value === 'starts' ||
    value === '!starts' ||
    value === 'within-next-days' ||
    value === '!within-next-days' ||
    value === 'has-open-checkboxes' ||
    value === '!has-open-checkboxes' ||
    value === 'is-today' ||
    value === '!is-today' ||
    value === 'is-before-today' ||
    value === '!is-before-today' ||
    value === 'is-after-today' ||
    value === '!is-after-today'
    ? value
    : null;
}

function normalizeConditionSource(value: unknown): NotebookNavigatorRuleConditionSource | null {
  return value === 'frontmatter' ||
    value === 'path' ||
    value === 'extension' ||
    value === 'name' ||
    value === 'tag' ||
    value === 'body' ||
    value === 'checkbox-state' ||
    value === 'date-created' ||
    value === 'date-modified' ||
    value === 'parent-frontmatter' ||
    value === 'parent-tag' ||
    value === 'parent-name' ||
    value === 'parent-path'
    ? value
    : null;
}

function normalizeFieldType(value: unknown): SortFieldType {
  return value === 'date' || value === 'status' || value === 'priority' || value === 'text' || value === 'number'
    ? value
    : 'text';
}

function inferFieldType(field: string): SortFieldType {
  const lower = field.toLowerCase();
  if (lower.includes('date') || lower === 'scheduled' || lower === 'due' || lower === 'deadline') return 'date';
  if (lower === 'status') return 'status';
  if (lower === 'priority') return 'priority';
  return 'text';
}

function normalizeMatchMode(value: unknown): NotebookNavigatorRuleMatchMode {
  return value === 'any' ? 'any' : 'all';
}

function normalizeSafeFrontmatterField(value: unknown, fallback: string): string {
  const normalized = normalizeFrontmatterField(value, fallback);
  if (!PROTECTED_FRONTMATTER_KEYS.has(normalized.toLowerCase())) return normalized;
  logger.warn('[TPS GCM] Blocked protected Notebook Navigator frontmatter field in settings', {
    requested: normalized,
    fallback,
  });
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && !Number.isNaN(value)
    ? Math.min(Math.max(value, min), max)
    : fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeOptionalString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeFrontmatterField(value: unknown, fallback: string): string {
  return normalizeString(value, fallback).replace(/\s+/g, '');
}

function normalizeMultilineString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function normalizeSeparator(value: unknown, fallback: string): string {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 3) : fallback;
}

function normalizePathPrefix(value: string): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}
