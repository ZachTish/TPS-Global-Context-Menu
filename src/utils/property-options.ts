import { App, getAllTags } from 'obsidian';
import type { CustomProperty } from '../types';
import { isLinkListProperty, isTagListProperty, isTextListProperty, parseLinkListInput, parseStringListInput } from './list-utils';
import { parseTagInput } from './tag-utils';

const MAX_VAULT_OPTIONS = 300;
const VAULT_OPTION_CACHE_TTL_MS = 3000;
const vaultOptionCache = new WeakMap<App, Map<string, { createdAt: number; values: string[] }>>();

function normalizeOption(value: unknown, property?: Pick<CustomProperty, 'type' | 'listItemType'>): string {
  if (value === null || value === undefined || value === false) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (isTagListProperty(property)) {
    return parseTagInput(raw)[0] || '';
  }
  if (isLinkListProperty(property)) {
    return parseLinkListInput(raw)[0] || '';
  }
  return raw;
}

function visitOptionValue(value: unknown, add: (value: string) => void, property?: Pick<CustomProperty, 'type' | 'listItemType'>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visitOptionValue(item, add, property));
    return;
  }
  if (isTextListProperty(property)) {
    parseStringListInput(value).forEach(add);
    return;
  }
  if (isLinkListProperty(property)) {
    parseLinkListInput(value).forEach(add);
    return;
  }
  const normalized = normalizeOption(value, property);
  if (normalized) add(normalized);
}

export function normalizeManualPropertyOptions(options: unknown, property?: Pick<CustomProperty, 'type' | 'listItemType'>): string[] {
  const values = new Map<string, string>();
  const add = (value: string) => {
    const key = value.toLowerCase();
    if (!values.has(key)) values.set(key, value);
  };

  if (Array.isArray(options)) {
    options.forEach((option) => visitOptionValue(option, add, property));
  } else if (typeof options === 'string') {
    options.split(/[,\n]+/).forEach((option) => visitOptionValue(option, add, property));
  }

  return Array.from(values.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function collectVaultPropertyOptions(app: App, property: Pick<CustomProperty, 'key' | 'type' | 'listItemType'>): string[] {
  const key = String(property.key || '').trim();
  if (!key) return [];
  const cacheKey = `${key.toLowerCase()}\u0000${String(property.type || '')}\u0000${String(property.listItemType || '')}`;
  let cache = vaultOptionCache.get(app);
  if (!cache) {
    cache = new Map();
    vaultOptionCache.set(app, cache);
  }
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.createdAt < VAULT_OPTION_CACHE_TTL_MS) {
    return [...cached.values];
  }

  const values = new Map<string, string>();
  const add = (value: string) => {
    const lower = value.toLowerCase();
    if (!values.has(lower)) values.set(lower, value);
  };
  const lowerKey = key.toLowerCase();

  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    if (frontmatter) {
      const actualKey = Object.keys(frontmatter).find((frontmatterKey) => frontmatterKey.toLowerCase() === lowerKey);
      if (actualKey) visitOptionValue(frontmatter[actualKey], add, property);
    }
    if (isTagListProperty(property) && lowerKey === 'tags') {
      (getAllTags(cache) || []).forEach((tag) => visitOptionValue(tag, add, property));
    }
  }

  const collected = Array.from(values.values())
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .slice(0, MAX_VAULT_OPTIONS);
  cache.set(cacheKey, { createdAt: now, values: collected });
  return [...collected];
}

export function getEffectivePropertyOptions(app: App, property: Pick<CustomProperty, 'key' | 'type' | 'listItemType' | 'options' | 'optionsSource'> | null | undefined): string[] {
  if (!property) return [];
  const manual = normalizeManualPropertyOptions(property.options || [], property);
  if (property.optionsSource !== 'vault') return manual;

  const merged = new Map<string, string>();
  const discovered = property.type === 'kind'
    ? getIndexedKindValues(app) ?? collectVaultPropertyOptions(app, property)
    : collectVaultPropertyOptions(app, property);
  for (const value of [...manual, ...discovered]) {
    const key = value.toLowerCase();
    if (!merged.has(key)) merged.set(key, value);
  }
  return Array.from(merged.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function getIndexedKindValues(app: App): string[] | null {
  const plugins = (app as any)?.plugins;
  const plugin = plugins?.getPlugin?.('tps-global-context-menu')
    || plugins?.plugins?.['tps-global-context-menu']
    || plugins?.getPlugin?.('TPS-Global-Context-Menu (Dev)')
    || plugins?.plugins?.['TPS-Global-Context-Menu (Dev)'];
  const index = plugin?.entityIndexService || plugin?.api?.entityIndex;
  if (typeof index?.getDimensionValues !== 'function') return null;
  return [...index.getDimensionValues('kind')];
}
