export type BooleanPropertyValueState = 'yes' | 'no' | 'unset' | 'invalid';

export interface BooleanPropertyPresentation {
  state: BooleanPropertyValueState;
  checked: boolean;
  indeterminate: boolean;
  text: 'Yes' | 'No' | 'Not set' | 'Invalid';
}

/**
 * BasesEntry.getValue() returns Obsidian Value objects. BooleanValue exposes
 * its type and truthiness through the public Value API, so normalize that
 * wrapper without reaching into private fields such as `data` or `value`.
 */
export function normalizeBooleanPropertyValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const constructorType = String((value as any)?.constructor?.type || '').trim().toLocaleLowerCase();
  if (constructorType !== 'boolean' || typeof (value as any).isTruthy !== 'function') return value;
  try {
    return Boolean((value as any).isTruthy());
  } catch {
    return value;
  }
}

export function isBooleanPropertyType(type: unknown): boolean {
  return type === 'checkbox' || type === 'boolean';
}

export function getBooleanPropertyPresentation(value: unknown): BooleanPropertyPresentation {
  const normalized = normalizeBooleanPropertyValue(value);
  if (normalized === true) {
    return { state: 'yes', checked: true, indeterminate: false, text: 'Yes' };
  }
  if (normalized === false) {
    return { state: 'no', checked: false, indeterminate: false, text: 'No' };
  }
  if (normalized === null || normalized === undefined) {
    return { state: 'unset', checked: false, indeterminate: true, text: 'Not set' };
  }
  return { state: 'invalid', checked: false, indeterminate: true, text: 'Invalid' };
}

/**
 * Formula booleans are display-only. Return a checkbox presentation only for
 * an actual boolean (including the public Bases BooleanValue adapter); null,
 * empty, error, and opaque values stay on their normal rendering paths.
 */
export function getReadOnlyBooleanFormulaPresentation(
  value: unknown,
): BooleanPropertyPresentation | null {
  const normalized = normalizeBooleanPropertyValue(value);
  return typeof normalized === 'boolean'
    ? getBooleanPropertyPresentation(normalized)
    : null;
}

/**
 * A boolean property has only two writable values. Unset or invalid legacy
 * values enter the affirmative state on the first user toggle.
 */
export function getNextBooleanPropertyValue(value: unknown): boolean {
  return normalizeBooleanPropertyValue(value) !== true;
}

/**
 * Line properties persist booleans as the explicit lowercase strings `true`
 * and `false`. Convert only those authoritative spellings for typed controls;
 * guesses such as yes/1/on remain visibly invalid.
 */
export function normalizeInlineBooleanPropertyValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return value;
}
