import type { TFile } from 'obsidian';
import type { EntityIndexQuery as EntityIndexQueryContract } from '../services/entity-index-core';
import type { CustomProperty } from '../types';
import { formatFileWikilink, parseLinkListInput } from './list-utils';

const PROPERTY_PREFIXES = new Set([
  'task',
  'note',
  'file',
  'frontmatter',
  'property',
  'properties',
]);

export interface EntityIndexRecordLike {
  id?: string;
  path?: string;
  title?: string;
  label?: string;
  displayName?: string;
  name?: string;
  basename?: string;
  file?: TFile | null;
  dimensions?: Record<string, unknown>;
}

export interface EntityReferenceChoice {
  id: string;
  path: string;
  label: string;
  detail: string;
  wikilink: string;
  file: TFile | null;
  entity: EntityIndexRecordLike;
}

export type EntityIndexQuery = EntityIndexQueryContract;

export interface EntityIndexQueryable {
  query(query: EntityIndexQueryContract): readonly EntityIndexRecordLike[] | {
    entities?: readonly EntityIndexRecordLike[];
    items?: readonly EntityIndexRecordLike[];
  };
}

export interface EntityIndexSourceLike {
  query?: EntityIndexQueryable['query'];
  entityIndexService?: EntityIndexQueryable | null;
  entityIndex?: EntityIndexQueryable | null;
  api?: {
    entities?: EntityIndexQueryable | null;
    entityIndex?: EntityIndexQueryable | null;
  } | null;
}

type PropertyCollectionSource =
  | readonly CustomProperty[]
  | {
      properties?: readonly CustomProperty[];
      settings?: { properties?: readonly CustomProperty[] } | null;
    }
  | null
  | undefined;

/**
 * Normalizes the persisted acceptsKind value into an ordered, case-insensitively
 * de-duplicated list. Arrays and comma/newline-delimited legacy values are
 * accepted so callers can use the entity index's generic anyOf query contract.
 */
export function normalizeAcceptsKind(value: unknown): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (item === null || item === undefined || item === false) return;

    String(item)
      .split(/[,\n]+/u)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const identity = entry.toLocaleLowerCase();
        if (seen.has(identity)) return;
        seen.add(identity);
        normalized.push(entry);
      });
  };

  visit(value);
  return normalized;
}

export function isEntityReferenceProperty(
  property: Pick<CustomProperty, 'acceptsKind'> | null | undefined,
): boolean {
  return normalizeAcceptsKind(property?.acceptsKind).length > 0;
}

/**
 * Resolves a configured property from a Base/inline property reference. Exact
 * IDs and keys win before recognized surface prefixes (for example
 * `task.projects`, `note.projects`, or `properties["projects"]`) are removed.
 */
export function resolveConfiguredProperty(
  source: PropertyCollectionSource,
  reference: unknown,
): CustomProperty | null {
  const properties = getConfiguredProperties(source);
  if (properties.length === 0) return null;

  const candidates = getPropertyReferenceCandidates(reference);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const identity = candidate.toLocaleLowerCase();
    const exact = properties.find((property) => {
      return String(property.id || '').trim().toLocaleLowerCase() === identity
        || String(property.key || '').trim().toLocaleLowerCase() === identity;
    });
    if (exact) return exact;
  }

  return null;
}

export function getPropertyReferenceCandidates(reference: unknown): string[] {
  const rawValues = getRawPropertyReferences(reference);
  const candidates: string[] = [];
  const seen = new Set<string>();

  const add = (value: unknown): void => {
    const candidate = String(value ?? '').trim();
    const identity = candidate.toLocaleLowerCase();
    if (!candidate || seen.has(identity)) return;
    seen.add(identity);
    candidates.push(candidate);
  };

  rawValues.forEach((rawValue) => {
    add(rawValue);

    const bracketMatch = rawValue.match(
      /^(task|note|file|frontmatter|property|properties)\s*\[\s*(['"])(.*?)\2\s*\]$/iu,
    );
    if (bracketMatch) add(bracketMatch[3]);

    let remainder = rawValue;
    while (remainder.includes('.')) {
      const separator = remainder.indexOf('.');
      const prefix = remainder.slice(0, separator).trim().toLocaleLowerCase();
      if (!PROPERTY_PREFIXES.has(prefix)) break;
      remainder = remainder.slice(separator + 1).trim();
      add(remainder);
    }
  });

  return candidates;
}

export function getEntityPath(entity: EntityIndexRecordLike | null | undefined): string {
  return String(entity?.file?.path || entity?.path || '').trim();
}

export function getEntityDisplayLabel(entity: EntityIndexRecordLike | null | undefined): string {
  const path = getEntityPath(entity);
  const fallback = getPathBasename(path);
  return String(
    entity?.displayName
      || entity?.label
      || entity?.title
      || entity?.basename
      || entity?.file?.basename
      || String(entity?.name || '').replace(/\.md$/iu, '')
      || fallback,
  ).trim();
}

export function getEntityDisplayPath(entity: EntityIndexRecordLike | null | undefined): string {
  return getEntityPath(entity).replace(/\.md$/iu, '');
}

export function formatEntityReference(entity: EntityIndexRecordLike | null | undefined): string {
  const path = getEntityPath(entity);
  if (!path) return '';
  return formatFileWikilink(path, sanitizeEntityReferenceAlias(getEntityDisplayLabel(entity)));
}

/**
 * Merge entity-reference lists by their vault target rather than by serialized
 * alias text. A newly selected canonical link replaces an older alias for the
 * same target while preserving the surrounding list order.
 */
export function mergeEntityReferenceList(existing: unknown, incoming: unknown): string[] {
  const merged: string[] = [];
  const indexByTarget = new Map<string, number>();
  for (const value of parseLinkListInput(existing)) {
    const target = getEntityReferenceTargetIdentity(value);
    if (!target || indexByTarget.has(target)) continue;
    indexByTarget.set(target, merged.length);
    merged.push(value);
  }
  for (const value of parseLinkListInput(incoming)) {
    const target = getEntityReferenceTargetIdentity(value);
    if (!target) continue;
    const currentIndex = indexByTarget.get(target);
    if (currentIndex === undefined) {
      indexByTarget.set(target, merged.length);
      merged.push(value);
    } else {
      merged[currentIndex] = value;
    }
  }
  return merged;
}

export function removeEntityReferenceListValues(existing: unknown, valuesToRemove: unknown): string[] {
  const removals = new Set(
    parseLinkListInput(valuesToRemove)
      .map(getEntityReferenceTargetIdentity)
      .filter(Boolean),
  );
  return parseLinkListInput(existing)
    .filter((value) => !removals.has(getEntityReferenceTargetIdentity(value)));
}

export function entityToReferenceChoice(
  entity: EntityIndexRecordLike | null | undefined,
): EntityReferenceChoice | null {
  if (!entity) return null;
  const path = getEntityPath(entity);
  if (!path || !isMarkdownEntity(entity, path)) return null;

  const label = getEntityDisplayLabel(entity) || getPathBasename(path);
  const detail = getEntityDisplayPath(entity);
  const wikilink = formatFileWikilink(path, sanitizeEntityReferenceAlias(label));
  if (!wikilink) return null;

  return {
    id: String(entity.id || path),
    path,
    label,
    detail,
    wikilink,
    file: entity.file || null,
    entity,
  };
}

export function buildEntityReferenceChoices(
  entities: readonly EntityIndexRecordLike[] | null | undefined,
): EntityReferenceChoice[] {
  const choices: EntityReferenceChoice[] = [];
  const seenPaths = new Set<string>();

  for (const entity of entities || []) {
    const choice = entityToReferenceChoice(entity);
    if (!choice) continue;
    const pathIdentity = choice.path.toLocaleLowerCase();
    if (seenPaths.has(pathIdentity)) continue;
    seenPaths.add(pathIdentity);
    choices.push(choice);
  }

  return choices.sort((left, right) => {
    return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
      || left.detail.localeCompare(right.detail, undefined, { sensitivity: 'base' });
  });
}

export function resolveEntityIndexQueryable(
  source: EntityIndexQueryable | EntityIndexSourceLike | null | undefined,
): EntityIndexQueryable | null {
  if (!source) return null;
  if (typeof (source as EntityIndexQueryable).query === 'function') {
    return source as EntityIndexQueryable;
  }

  const owner = source as EntityIndexSourceLike;
  const candidates = [
    owner.entityIndexService,
    owner.entityIndex,
    owner.api?.entities,
    owner.api?.entityIndex,
  ];
  return candidates.find((candidate) => typeof candidate?.query === 'function') || null;
}

function getConfiguredProperties(source: PropertyCollectionSource): readonly CustomProperty[] {
  if (Array.isArray(source)) return source;
  if (!source || typeof source !== 'object') return [];
  const owner = source as Exclude<PropertyCollectionSource, readonly CustomProperty[] | null | undefined>;
  if (Array.isArray(owner.properties)) return owner.properties;
  return Array.isArray(owner.settings?.properties) ? owner.settings!.properties! : [];
}

function getRawPropertyReferences(reference: unknown): string[] {
  if (reference === null || reference === undefined) return [];
  if (typeof reference !== 'object') return [String(reference).trim()].filter(Boolean);

  const record = reference as Record<string, unknown>;
  return [
    record.id,
    record.key,
    record.property,
    record.field,
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
}

function getPathBasename(path: string): string {
  return String(path || '')
    .replace(/\\/gu, '/')
    .split('/')
    .pop()
    ?.replace(/\.md$/iu, '') || '';
}

function sanitizeEntityReferenceAlias(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n]+/gu, ' ')
    .replace(/\|/gu, ' - ')
    .replace(/[\[\]]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function getEntityReferenceTargetIdentity(value: string): string {
  const inner = String(value || '').trim().match(/^!?\[\[([^\]]+)\]\]$/u)?.[1] || '';
  if (!inner) return '';
  const rawTarget = inner.split('|', 1)[0]?.trim().replace(/\\/gu, '/') || '';
  if (!rawTarget) return '';
  const hashIndex = rawTarget.indexOf('#');
  const path = (hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget)
    .replace(/\.md$/iu, '')
    .replace(/\/{2,}/gu, '/')
    .toLocaleLowerCase();
  const anchor = hashIndex >= 0 ? rawTarget.slice(hashIndex).trim().toLocaleLowerCase() : '';
  return `${path}${anchor}`;
}

function isMarkdownEntity(entity: EntityIndexRecordLike, path: string): boolean {
  const extension = String(entity.file?.extension || '').trim().toLocaleLowerCase();
  if (extension) return extension === 'md';
  const fileName = path.split('/').pop() || '';
  return !fileName.includes('.') || /\.md$/iu.test(fileName);
}
