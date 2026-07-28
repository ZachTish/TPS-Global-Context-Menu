import type { CustomProperty } from '../types';
import {
  readTaskInlineFields,
  setInlineFieldValueOnTaskLine,
} from '../utils/task-line-metadata';
import { isEntityReferenceProperty } from '../utils/entity-property';
import { propertyUsesEntityOptions } from '../utils/property-option-source';

export type TaskEditorPropertyType =
  | 'text'
  | 'number'
  | 'datetime'
  | 'selector'
  | 'list'
  | 'checkbox'
  | 'recurrence';

export interface TaskEditorPropertyDescriptor {
  key: string;
  label: string;
  type: TaskEditorPropertyType;
  value: string;
  property: CustomProperty | null;
}

export interface TaskEditorPropertyChange {
  key: string;
  value: string | null;
}

export interface TaskEditorScheduleResult {
  date: string;
  timeEstimate: number;
  allDay: boolean;
}

const PROTECTED_TASK_EDITOR_PROPERTY_KEYS = new Set([
  'title',
  'parent',
  'parentof',
  'folderpath',
  'tpsid',
  'subitemid',
  'tpsinlineprops',
  'tps-inline-props',
  'externalid',
  'externaleventid',
  'tpscalendaruid',
  'tpscalendarsourceurl',
  'recurrencetaskid',
  'migratedto',
  'associatednotepath',
  'stableid',
  'completeddate',
]);

const DATETIME_PROPERTY_KEYS = new Set([
  'scheduled',
  'date',
  'start',
  'end',
  'enddate',
  'completeddate',
  'createddate',
  'createdat',
  'updatedat',
  'datecreated',
  'datemodified',
]);

const NUMBER_PROPERTY_KEYS = new Set([
  'timeestimate',
  'durationminutes',
]);

const BOOLEAN_PROPERTY_KEYS = new Set([
  'allday',
]);

const RECURRENCE_PROPERTY_KEYS = new Set([
  'recurrence',
  'recurrencerule',
]);

const SUPPORTED_PROPERTY_TYPES = new Set<TaskEditorPropertyType>([
  'text',
  'number',
  'datetime',
  'selector',
  'list',
  'checkbox',
  'recurrence',
]);

export function collectTaskEditorProperties(
  line: string,
  configuredProperties: readonly CustomProperty[] = [],
  statusKey = 'status',
  additionalProtectedKeys: readonly string[] = [],
): TaskEditorPropertyDescriptor[] {
  const configuredByKey = new Map<string, CustomProperty>();
  for (const property of configuredProperties || []) {
    const key = String(property?.key || '').trim().toLowerCase();
    if (key && !configuredByKey.has(key)) configuredByKey.set(key, property);
  }

  const normalizedStatusKey = String(statusKey || 'status').trim().toLowerCase();
  const protectedKeys = new Set([
    ...PROTECTED_TASK_EDITOR_PROPERTY_KEYS,
    ...(additionalProtectedKeys || []).map((key) => String(key || '').trim().toLowerCase()).filter(Boolean),
  ]);
  const descriptors: TaskEditorPropertyDescriptor[] = [];
  const seen = new Set<string>();
  const inlineFields = readTaskInlineFields(line);
  const scheduledProperty = configuredByKey.get('scheduled') || null;
  const scheduledOwnsCompanions = inlineFields.some((field) => field.key.toLowerCase() === 'scheduled')
    && !isTaskEditorPropertyHidden(scheduledProperty);
  for (const field of inlineFields) {
    const normalizedKey = field.key.toLowerCase();
    const property = configuredByKey.get(normalizedKey) || null;
    if (
      seen.has(normalizedKey)
      || (
        normalizedKey === normalizedStatusKey
        && !propertyUsesEntityOptions(property)
      )
      || protectedKeys.has(normalizedKey)
      || (scheduledOwnsCompanions && (normalizedKey === 'timeestimate' || normalizedKey === 'allday'))
    ) continue;
    seen.add(normalizedKey);

    if (isTaskEditorPropertyHidden(property)) continue;

    descriptors.push({
      key: field.key,
      label: String(property?.label || field.key).trim() || field.key,
      type: resolveTaskEditorPropertyType(field.key, field.value, property),
      value: field.value,
      property,
    });
  }
  return descriptors;
}

export function applyTaskEditorPropertyChanges(
  line: string,
  changes: readonly TaskEditorPropertyChange[],
): string {
  let next = String(line || '');
  const applied = new Set<string>();
  for (const change of changes || []) {
    const key = String(change?.key || '').trim();
    const normalizedKey = key.toLowerCase();
    if (!key || applied.has(normalizedKey) || PROTECTED_TASK_EDITOR_PROPERTY_KEYS.has(normalizedKey)) continue;
    applied.add(normalizedKey);
    next = setInlineFieldValueOnTaskLine(next, key, change.value);
  }
  return next;
}

export function buildTaskEditorPropertyChange(
  descriptor: TaskEditorPropertyDescriptor,
  initialValue: string,
  draftValue: string,
): TaskEditorPropertyChange | null {
  const opening = normalizeTaskEditorPropertyValue(descriptor, initialValue);
  const draft = normalizeTaskEditorPropertyValue(descriptor, draftValue);
  if (draft === opening) return null;
  return { key: descriptor.key, value: draft || null };
}

export function applyTaskEditorScheduleResult<
  T extends { timeEstimate: string; allDay: string },
>(
  propertyKey: string,
  companions: T | null,
  result: TaskEditorScheduleResult,
): T | null {
  if (String(propertyKey || '').trim().toLowerCase() !== 'scheduled' || !companions) return companions;
  if (!result.date) return { ...companions, timeEstimate: '', allDay: '' };

  const currentEstimate = Number.parseInt(companions.timeEstimate || '0', 10) || 0;
  const currentAllDay = isTruthyTaskPropertyValue(companions.allDay);
  return {
    ...companions,
    timeEstimate: currentEstimate === result.timeEstimate
      ? companions.timeEstimate
      : String(result.timeEstimate || 0),
    allDay: currentAllDay === result.allDay
      ? companions.allDay
      : result.allDay ? 'true' : '',
  };
}

export function normalizeTaskEditorPropertyValue(
  descriptor: Pick<TaskEditorPropertyDescriptor, 'type'> & {
    property?: CustomProperty | null;
  },
  value: string,
): string {
  const raw = String(value ?? '').trim();
  if (isEntityReferenceProperty(descriptor.property)) return raw;
  if (descriptor.type === 'checkbox') return isTruthyTaskPropertyValue(raw) ? 'true' : 'false';
  if (descriptor.type === 'number' && raw) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? String(parsed) : raw;
  }
  if (descriptor.type === 'list') {
    const seen = new Set<string>();
    return raw
      .split(/[\n,]+/u)
      .map((entry) => entry.trim())
      .filter((entry) => {
        const normalized = entry.toLowerCase();
        if (!entry || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      })
      .join(', ');
  }
  return raw;
}

export function isTruthyTaskPropertyValue(value: string): boolean {
  return /^(?:true|yes|y|1|checked|on)$/iu.test(String(value || '').trim());
}

function resolveTaskEditorPropertyType(
  key: string,
  value: string,
  property: CustomProperty | null,
): TaskEditorPropertyType {
  const configuredType = String(property?.type || '').trim().toLowerCase() as TaskEditorPropertyType;
  if (SUPPORTED_PROPERTY_TYPES.has(configuredType)) return configuredType;

  const normalizedKey = String(key || '').trim().toLowerCase();
  if (DATETIME_PROPERTY_KEYS.has(normalizedKey)) return 'datetime';
  if (NUMBER_PROPERTY_KEYS.has(normalizedKey)) return 'number';
  if (BOOLEAN_PROPERTY_KEYS.has(normalizedKey) || /^(?:true|false)$/iu.test(String(value || '').trim())) return 'checkbox';
  if (RECURRENCE_PROPERTY_KEYS.has(normalizedKey)) return 'recurrence';
  return 'text';
}

function isTaskEditorPropertyHidden(property: CustomProperty | null): boolean {
  return Boolean(property && (
    property.hidden === true
    || property.disabled === true
    || property.showWhen === 'never'
    || property.type === 'folder'
    || property.type === 'snooze'
    || property.type === 'kind'
  ));
}
