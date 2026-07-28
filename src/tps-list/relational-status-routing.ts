import type { CustomProperty } from '../types';
import { findRelationalStatusProperty } from '../utils/property-option-source';

/**
 * A bare `status` property can be a user-owned relation while `task.status`
 * remains the synthesized checkbox workflow state.
 */
export function isRelationalStatusPropertyReference(
  reference: unknown,
  properties: readonly CustomProperty[] | null | undefined,
): boolean {
  const raw = String(reference || '').trim();
  if (!raw || /^task\./iu.test(raw)) return false;
  const normalized = raw
    .replace(/^(?:tps|kanban|property|properties)\./iu, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, '');
  return normalized === 'status' && Boolean(findRelationalStatusProperty(properties));
}

export function readTpsFilterExpressionProperty(expression: unknown): string {
  const raw = String(expression || '').trim().replace(/^!+\s*/u, '');
  if (!raw) return '';
  const callMatch = raw.match(
    /^([\w.\s-]+)\.(?:contains|containsAny|equals|isEmpty|empty|exists|isNotEmpty)\b/iu,
  );
  if (callMatch?.[1]) return callMatch[1].trim();
  const wordMatch = raw.match(
    /^([\w.\s-]+?)\s+(?:contains|has|is not empty|is empty|isNotEmpty|exists|empty|is|equals?)\b/iu,
  );
  if (wordMatch?.[1]) return wordMatch[1].trim();
  const comparisonMatch = raw.match(/^([\w.\s-]+?)\s*(?:==|=|!=|!==)\s*/iu);
  return comparisonMatch?.[1]?.trim() || '';
}

export function isRelationalStatusFilterExpression(
  expression: unknown,
  properties: readonly CustomProperty[] | null | undefined,
): boolean {
  return isRelationalStatusPropertyReference(
    readTpsFilterExpressionProperty(expression),
    properties,
  );
}
