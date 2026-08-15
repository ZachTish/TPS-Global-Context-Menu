import type { CustomProperty } from '../types';
import {
  addInlineTagsToTaskLine,
  readInlineFieldValue,
  readInlineTags,
  removeInlineTagFromTaskLine,
  setInlineFieldValueOnTaskLine,
} from './task-line-metadata';
import {
  isLinkListProperty,
  mergeLinkList,
  mergeStringList,
  parseLinkListInput,
  parseStringListInput,
  removeLinkListValues,
  removeStringListValues,
} from './list-utils';

export type ItemPropertyMutation = {
  key: string;
  action: 'set' | 'add' | 'remove' | 'clear';
  values?: unknown[];
};

export function applyTaskItemPropertyMutation(
  line: string,
  property: CustomProperty,
  mutation: ItemPropertyMutation,
): string {
  const values = (mutation.values || []).map((value) => String(value ?? '').trim()).filter(Boolean);
  const isTags = property.type === 'list'
    && (String(property.key || '').trim().toLowerCase() === 'tags' || property.listItemType === 'tag');
  if (mutation.action === 'clear') {
    if (isTags) return readInlineTags(line).reduce((next, tag) => removeInlineTagFromTaskLine(next, tag), line);
    return setInlineFieldValueOnTaskLine(line, property.key, null);
  }
  if (isTags) {
    if (mutation.action === 'remove') {
      return values.reduce((next, tag) => removeInlineTagFromTaskLine(next, tag), line);
    }
    return addInlineTagsToTaskLine(line, values.join(', '));
  }
  if (property.type === 'list') {
    const existing = readInlineFieldValue(line, property.key);
    if (mutation.action === 'remove') {
      const remaining = isLinkListProperty(property)
        ? removeLinkListValues(existing, values)
        : removeStringListValues(existing, values);
      return setInlineFieldValueOnTaskLine(line, property.key, remaining.length > 0 ? remaining.join(', ') : null);
    }
    if (mutation.action === 'add') {
      const merged = values.reduce<string[]>((current, value) => (
        isLinkListProperty(property)
          ? mergeLinkList(current.join(', '), value)
          : mergeStringList(current.join(', '), value)
      ), isLinkListProperty(property) ? parseLinkListInput(existing) : parseStringListInput(existing));
      return setInlineFieldValueOnTaskLine(line, property.key, merged.join(', '));
    }
  }
  const value = values[0] ?? '';
  return setInlineFieldValueOnTaskLine(line, property.key, value || null);
}
