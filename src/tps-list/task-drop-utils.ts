import { replaceKanbanTaskLineCheckboxState } from './task-checkbox-utils';

export type KanbanTaskLineItemKind = 'task' | 'bullet';

export type KanbanTaskLineParseResult = {
  itemKind: KanbanTaskLineItemKind;
  checkboxState?: string;
  text: string;
};

export type BuildKanbanTaskDropLineOptions = {
  line: string;
  propName: string;
  value: string | null;
  sourceLaneValues?: string[];
  filterTags?: string[];
  filterStatus?: string | null;
  getCheckboxStateForStatus: (status: string | null) => string | null;
  isStatusPropertyName: (propName: string | null | undefined) => boolean;
};

export function parseKanbanLineItem(line: string, includeBullets = true): KanbanTaskLineParseResult | null {
  const taskMatch = String(line ?? '').match(/^\s*(?:[-*+]|\d+[.)])\s+\[([^\]\r\n]?)\]\s+(.+)$/);
  if (taskMatch) {
    return {
      itemKind: 'task',
      checkboxState: `[${taskMatch[1] ?? ''}]`,
      text: taskMatch[2] ?? '',
    };
  }
  if (!includeBullets) return null;
  const bulletMatch = String(line ?? '').match(/^\s*(?:[-*+]|\d+[.)])\s+(?!\[[^\]\r\n]?\]\s+)(.+)$/);
  if (!bulletMatch) return null;
  return {
    itemKind: 'bullet',
    text: bulletMatch[1] ?? '',
  };
}

export function normalizeKanbanWritableTaskTag(value: string): string {
  return String(value ?? '')
    .replace(/^#+/u, '')
    .replace(/[^\p{L}\p{N}/_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

export function normalizeKanbanInlinePropertyKey(key: string): string {
  return String(key || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

export function updateKanbanInlineTaskTag(line: string, value: string, sourceLaneValues: string[] = []): string {
  const cleanTag = normalizeKanbanWritableTaskTag(value);
  const sourceTags = sourceLaneValues
    .map((sourceValue) => normalizeKanbanWritableTaskTag(sourceValue))
    .filter((sourceTag) => sourceTag && sourceTag.toLowerCase() !== cleanTag.toLowerCase());

  let nextLine = String(line ?? '');
  for (const sourceTag of sourceTags) {
    const escapedSource = sourceTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    nextLine = nextLine
      .replace(new RegExp(`(^|\\s)#${escapedSource}(?=\\s|$)`, 'giu'), '$1')
      .replace(/[ \t]{2,}/gu, ' ')
      .replace(/\s+$/u, '');
  }

  if (!cleanTag) return nextLine;
  const tag = `#${cleanTag}`;
  if (new RegExp(`(^|\\s)${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'iu').test(nextLine)) {
    return nextLine;
  }
  return `${nextLine.replace(/\s+$/u, '')} ${tag}`;
}

export function updateKanbanInlineTaskPropertyText(
  line: string,
  propName: string,
  value: string | null,
  sourceLaneValues: string[] = [],
): string {
  const normalizedProp = normalizeKanbanInlinePropertyKey(propName);
  const normalizedValue = String(value ?? '').trim();
  if (normalizedProp === 'tags') {
    return updateKanbanInlineTaskTag(line, normalizedValue, sourceLaneValues);
  }

  const escaped = propName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inlineField = new RegExp(`\\s*(?:\\[|\\()${escaped}\\s*::\\s*[^\\]\\)]+(?:\\]|\\))`, 'i');
  const withoutExisting = String(line ?? '').replace(inlineField, '').replace(/\s+$/u, '');
  if (!normalizedValue) return withoutExisting;
  return `${withoutExisting} [${propName}:: ${normalizedValue}]`;
}

export function buildKanbanTaskDropLine(options: BuildKanbanTaskDropLineOptions): string {
  const parsedLine = parseKanbanLineItem(options.line, true);
  const itemKind = parsedLine?.itemKind ?? 'task';
  const normalizedProp = normalizeKanbanInlinePropertyKey(options.propName);
  let nextLine = String(options.line ?? '');

  if (options.isStatusPropertyName(options.propName)) {
    if (itemKind !== 'bullet') {
      const checkbox = options.getCheckboxStateForStatus(options.value);
      if (checkbox) nextLine = replaceKanbanTaskLineCheckboxState(nextLine, checkbox);
    }
  } else if (normalizedProp === 'tags') {
    nextLine = updateKanbanInlineTaskPropertyText(
      nextLine,
      options.propName,
      options.value,
      options.sourceLaneValues ?? [],
    );
  } else {
    nextLine = updateKanbanInlineTaskPropertyText(
      nextLine,
      options.propName,
      options.value,
      options.sourceLaneValues ?? [],
    );
  }

  for (const tag of options.filterTags ?? []) {
    if (normalizedProp === 'tags' && normalizeKanbanTaskTag(String(options.value ?? '')) === tag) continue;
    nextLine = updateKanbanInlineTaskTag(nextLine, tag, []);
  }
  if (options.filterStatus && itemKind !== 'bullet' && !options.isStatusPropertyName(options.propName)) {
    const checkbox = options.getCheckboxStateForStatus(options.filterStatus);
    if (checkbox) nextLine = replaceKanbanTaskLineCheckboxState(nextLine, checkbox);
  }

  return nextLine;
}

function normalizeKanbanTaskTag(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('#') ? trimmed.toLowerCase() : `#${trimmed.toLowerCase()}`;
}
