import type { App } from 'obsidian';
import { normalizeTagValue } from './tag-utils';

/**
 * Return every tag currently known to Obsidian's metadata cache.
 *
 * The result is normalized without a leading `#`, de-duplicated
 * case-insensitively, and sorted for stable picker behavior.
 */
export function collectKnownVaultTags(app: App): string[] {
  const rawTags = typeof (app.metadataCache as any)?.getTags === 'function'
    ? (app.metadataCache as any).getTags()
    : {};
  const byIdentity = new Map<string, string>();
  for (const rawTag of Object.keys(rawTags || {})) {
    const tag = normalizeTagValue(rawTag);
    const identity = tag.toLocaleLowerCase();
    if (!tag || byIdentity.has(identity)) continue;
    byIdentity.set(identity, tag);
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: 'base' }));
}
