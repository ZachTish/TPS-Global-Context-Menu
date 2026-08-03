import { normalizePath } from 'obsidian';
import { normalizeLinkedSubitemCheckboxState } from '../utils/linked-subitem-mapping';

export type KanbanTaskCreationDefaultsLike = {
  status?: string | null;
  targetPath?: string | null;
  inlineFields: Map<string, { key: string; value: string }>;
  tags: Set<string>;
  excludedTags: Set<string>;
};

export type KanbanRootLineKind = 'task' | 'bullet' | 'heading';

export function getKanbanRootLineKind(mode: unknown): KanbanRootLineKind | null {
  const normalized = String(mode ?? '').trim().toLowerCase();
  if (normalized === 'task' || normalized === 'tasks') return 'task';
  if (normalized === 'bullet' || normalized === 'bullets') return 'bullet';
  if (/^(?:heading|headings|header|headers|h[1-6])$/u.test(normalized)) return 'heading';
  return null;
}

export type BuildKanbanRootTaskLineOptions = {
  title: string;
  propName: string | null;
  laneValue: string | null;
  itemKind?: KanbanRootLineKind;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  defaults: KanbanTaskCreationDefaultsLike;
  getCheckboxStateForStatus: (status: string | null) => string | null;
  isStatusPropertyName?: (propName: string | null | undefined) => boolean;
};

export type KanbanLaneAddMode = 'task' | 'note';

export type KanbanLaneAddPresentation = {
  shouldCreateTask: boolean;
  buttonText: string;
  title: string;
  ariaLabel: string;
};

export function normalizeKanbanTaskTargetPath(value: unknown): string | null {
  let raw = String(value || '').trim();
  const markdownLinkMatch = raw.match(/^\[[^\]]*]\(([^)]+)\)$/);
  if (markdownLinkMatch) raw = markdownLinkMatch[1];
  raw = raw
    .replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    .split('#')[0]
    .replace(/^"+|"+$/g, '')
    .replace(/^'+|'+$/g, '')
    .replace(/^\/+/, '');
  if (!raw) return null;
  const normalized = normalizePath(raw)
    .replace(/^\/+/, '')
    .trim();
  if (!normalized) return null;
  return normalized.toLowerCase().endsWith('.md') ? normalized : `${normalized}.md`;
}

export function resolveKanbanRootTaskTargetPath(defaultsTargetPath?: string | null, configuredTargetPath?: string | null): string | null {
  return normalizeKanbanTaskTargetPath(defaultsTargetPath) || normalizeKanbanTaskTargetPath(configuredTargetPath) || null;
}

export function buildKanbanRootTaskLine(options: BuildKanbanRootTaskLineOptions): string | null {
  const writablePropName = options.propName ? getTaskInlinePropertyName(options.propName) : '';
  const normalizedProp = writablePropName ? normalizeInlinePropertyKey(writablePropName) : '';
  const isStatusProperty = options.isStatusPropertyName ?? isDefaultStatusPropertyName;
  const itemKind = options.itemKind === 'bullet' || options.itemKind === 'heading' ? options.itemKind : 'task';
  const title = String(options.title || '').trim()
    || (itemKind === 'bullet' ? 'Untitled bullet' : itemKind === 'heading' ? 'Untitled heading' : 'Untitled task');
  const headingLevel = Math.max(1, Math.min(6, Number(options.headingLevel) || 1));
  const taskCheckboxState = itemKind === 'task'
    ? getLaneOrDefaultCheckboxState({
        propName: options.propName,
        laneValue: options.laneValue,
        defaults: options.defaults,
        getCheckboxStateForStatus: options.getCheckboxStateForStatus,
        isStatusPropertyName: isStatusProperty,
      })
    : null;
  if (itemKind === 'task' && !taskCheckboxState) return null;
  const parts = [itemKind === 'bullet'
    ? `- ${title}`
    : itemKind === 'heading'
      ? `${'#'.repeat(headingLevel)} ${title}`
      : `- [${getCheckboxMarker(taskCheckboxState!)}] ${title}`];
  const tags = new Set<string>();

  for (const tag of options.defaults.tags) {
    if (options.defaults.excludedTags.has(tag)) continue;
    const writableTag = normalizeWritableTaskTag(tag);
    if (writableTag) tags.add(writableTag);
  }
  if (normalizedProp === 'tags' && options.laneValue) {
    const laneTag = normalizeTaskTag(options.laneValue);
    const writableLaneTag = normalizeWritableTaskTag(laneTag);
    if (writableLaneTag && !options.defaults.excludedTags.has(laneTag)) tags.add(writableLaneTag);
  }
  for (const tag of tags) parts.push(`#${tag}`);

  if (
    writablePropName
    && options.laneValue != null
    && options.laneValue !== ''
    && normalizedProp !== 'tags'
    && !isStatusProperty(writablePropName)
  ) {
    parts.push(`[${writablePropName}:: ${options.laneValue}]`);
  }
  for (const [defaultProp, field] of options.defaults.inlineFields) {
    if (
      !field.value
      || defaultProp === normalizedProp
      || defaultProp === 'tags'
      || isStatusProperty(field.key)
    ) continue;
    parts.push(`[${field.key}:: ${field.value}]`);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function getKanbanRootTaskCheckboxMarker(options: Omit<BuildKanbanRootTaskLineOptions, 'title'>): string | null {
  const checkboxState = getLaneOrDefaultCheckboxState({
    propName: options.propName,
    laneValue: options.laneValue,
    defaults: options.defaults,
    getCheckboxStateForStatus: options.getCheckboxStateForStatus,
    isStatusPropertyName: options.isStatusPropertyName ?? isDefaultStatusPropertyName,
  });
  return checkboxState ? getCheckboxMarker(checkboxState) : null;
}

export function resolveKanbanLaneAddPresentation(mode: KanbanLaneAddMode, laneLabel: string): KanbanLaneAddPresentation {
  const shouldCreateTask = mode === 'task';
  const noun = shouldCreateTask ? 'task' : 'card';
  const label = String(laneLabel || '').trim() || 'lane';
  return {
    shouldCreateTask,
    buttonText: `+ Add ${noun}`,
    title: `Add ${noun}`,
    ariaLabel: `Add ${noun} to ${label}`,
  };
}

function getLaneOrDefaultCheckboxState(options: {
  propName: string | null;
  laneValue: string | null;
  defaults: KanbanTaskCreationDefaultsLike;
  getCheckboxStateForStatus: (status: string | null) => string | null;
  isStatusPropertyName: (propName: string | null | undefined) => boolean;
}): string | null {
  const laneStatus = options.propName
    && options.isStatusPropertyName(options.propName)
    && String(options.laneValue || '').trim()
      ? options.laneValue
      : null;
  const desiredStatus = laneStatus || options.defaults.status || null;
  if (!desiredStatus) return null;
  return options.getCheckboxStateForStatus(desiredStatus);
}

function getCheckboxMarker(rawState: string): string {
  const state = normalizeLinkedSubitemCheckboxState(rawState);
  return state ? state.slice(1, -1) : '';
}

function normalizeInlinePropertyKey(key: string): string {
  return String(key || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function getTaskInlinePropertyName(propName: string | null | undefined): string {
  return String(propName || '').trim().replace(/^(?:task|note)\./i, '');
}

function isDefaultStatusPropertyName(propName: string | null | undefined): boolean {
  const normalized = normalizeInlinePropertyKey(getTaskInlinePropertyName(propName));
  return normalized === 'status' || normalized === 'checkboxstatus';
}

function normalizeTaskTag(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('#') ? trimmed.toLowerCase() : `#${trimmed.toLowerCase()}`;
}

function normalizeWritableTaskTag(value: string): string {
  return value
    .replace(/^#+/u, '')
    .replace(/[^\p{L}\p{N}/_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}
