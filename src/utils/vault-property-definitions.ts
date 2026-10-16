import type { App } from 'obsidian';
import type { CustomProperty } from '../types';
import { normalizePropertyKeyIdentity } from './property-key-identity';

type PropertyShape = 'text' | 'number' | 'checkbox' | 'list';

function propertyShape(value: unknown): PropertyShape | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  return 'text';
}

function isSyntheticPosition(key: string, value: unknown): boolean {
  if (key !== 'position' || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, any>;
  return ['start', 'end'].every(boundary => record[boundary] &&
    ['line', 'col', 'offset'].every(part => typeof record[boundary][part] === 'number' && Number.isFinite(record[boundary][part])));
}

/** One on-demand cached-metadata inventory. Candidates remain display-only until explicitly defined. */
export function collectUndefinedVaultProperties(app: App, configured: readonly CustomProperty[]): CustomProperty[] {
  const known = new Set(configured.map(property => normalizePropertyKeyIdentity(property.key)).filter(Boolean));
  const discovered = new Map<string, { key: string; type: PropertyShape | null }>();
  for (const file of app.vault.getMarkdownFiles()) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    for (const [rawKey, value] of Object.entries(frontmatter ?? {})) {
      const key = rawKey.trim();
      const identity = normalizePropertyKeyIdentity(key);
      if (!identity || known.has(identity) || isSyntheticPosition(rawKey, value)) continue;
      const type = propertyShape(value);
      const existing = discovered.get(identity);
      if (!existing) discovered.set(identity, { key, type });
      else if (type) existing.type = !existing.type || existing.type === type ? type : 'text';
    }
  }
  return [...discovered.entries()].map(([identity, { key, type }]) => ({
    id: `vault-property:${identity}`, key, label: key, type: type ?? 'text',
    ...(type === 'list' ? { listItemType: 'text' as const } : {}),
    showInCollapsed: false, showInContextMenu: false,
  })).sort((left, right) => left.key.localeCompare(right.key, undefined, { sensitivity: 'base', numeric: true }));
}
