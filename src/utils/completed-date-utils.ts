import { findKeyCaseInsensitive, setValueCaseInsensitive } from '../core';

export function currentCompletedDateStamp(): string {
  const momentFactory = (window as any)?.moment;
  if (typeof momentFactory === 'function') {
    return momentFactory().format('YYYY-MM-DDTHH:mm:ss');
  }
  return new Date().toISOString().slice(0, 19);
}

export function getCompletedDateValue(frontmatter: Record<string, unknown> | null | undefined): string {
  if (!frontmatter || typeof frontmatter !== 'object') return '';
  const key = findKeyCaseInsensitive(frontmatter, 'completedDate');
  if (!key) return '';
  return normalizeCompletedDateValue(frontmatter[key]);
}

export function setCompletedDateValue(
  frontmatter: Record<string, unknown>,
  stamp = currentCompletedDateStamp(),
): void {
  const actualKey = findKeyCaseInsensitive(frontmatter, 'completedDate') || 'completedDate';
  const next = String(stamp || '').trim();
  if (!next) return;
  setValueCaseInsensitive(frontmatter, actualKey, next);
}

export function normalizeCompletedDateValue(value: unknown): string {
  const source = Array.isArray(value) ? value : value == null ? [] : [value];
  const values = source
    .flatMap((entry) => Array.isArray(entry) ? entry : [entry])
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);
  return values[values.length - 1] || '';
}
