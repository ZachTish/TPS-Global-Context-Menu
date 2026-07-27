import {
  readTaskInlineFields,
  readTaskLineTags,
} from '../utils/task-line-metadata';

export interface TpsListInlineField {
  key: string;
  value: string;
}

/**
 * Read the complete persisted property surface before display cleanup removes
 * hidden HTML carriers. TPS List uses the returned values for rendering,
 * filtering, grouping, and subsequent typed-cell edits.
 */
export function collectTpsListInlineFields(text: string): TpsListInlineField[] {
  const fields = readTaskInlineFields(String(text || ''))
    .map((field) => ({
      key: String(field.key || '').trim(),
      value: String(field.value || '').trim(),
    }))
    .filter((field) => field.key && field.value);
  const seenTags = new Set(
    fields
      .filter((field) => /^(?:tag|tags)$/iu.test(field.key))
      .flatMap((field) => readTaskLineTags(`[${field.key}:: ${field.value}]`)),
  );

  for (const tag of readTaskLineTags(String(text || ''))) {
    if (seenTags.has(tag)) continue;
    fields.push({ key: 'tag', value: `#${tag}` });
    seenTags.add(tag);
  }
  return fields;
}
