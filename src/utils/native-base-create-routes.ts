import type { NativeBaseCreateRoute } from '../types';

/** Routes are explicit because a Base filter can have multiple valid classifications. */
export function validateNativeBaseCreateRoute(value: unknown): NativeBaseCreateRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Base creation route must specify a Base file, view, and record type.');
  }
  const route = value as Record<string, unknown>;
  const basePath = typeof route.basePath === 'string' ? route.basePath.trim() : '';
  const viewName = typeof route.viewName === 'string' ? route.viewName.trim() : '';
  const recordKind = typeof route.recordKind === 'string' ? route.recordKind.trim() : '';
  if (!basePath || !basePath.endsWith('.base') || basePath.startsWith('/')
    || basePath.includes('\\') || basePath.includes('//')
    || basePath.split('/').some(part => part === '.' || part === '..' || !part)) {
    throw new Error('Choose a vault-relative .base file path for this route.');
  }
  if (!viewName) throw new Error('Choose a Base view name for this route.');
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(recordKind)) {
    throw new Error('Choose a valid configured record type for this route.');
  }
  return { basePath, viewName, recordKind };
}

/** A malformed matching route blocks creation; it must never fall back to native New. */
export function findNativeBaseCreateRoute(
  routes: unknown,
  basePath: string,
  viewName: string,
): NativeBaseCreateRoute | null {
  if (routes == null) return null;
  if (!Array.isArray(routes)) throw new Error('Base creation routes setting is invalid. Open GCM settings.');
  const matches = routes.filter(value => value && typeof value === 'object'
    && (value as Record<string, unknown>).basePath === basePath
    && (value as Record<string, unknown>).viewName === viewName);
  if (matches.length > 1) throw new Error(`More than one creation route matches ${basePath} / ${viewName}.`);
  return matches.length ? validateNativeBaseCreateRoute(matches[0]) : null;
}
