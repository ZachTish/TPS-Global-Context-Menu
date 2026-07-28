import type { CustomProperty, PropertyOptionSource } from '../types';

const SOURCE_ORDER: readonly PropertyOptionSource[] = ['manual', 'vault', 'entity'];

type PropertySourceShape = Pick<
  CustomProperty,
  'acceptsKind' | 'optionSources' | 'optionsSource' | 'type'
>;

function hasAcceptedKind(property: Partial<PropertySourceShape> | null | undefined): boolean {
  return String(property?.acceptsKind || '').trim().length > 0;
}

/**
 * Return the canonical, ordered source flags for one property.
 *
 * Legacy compatibility is intentional:
 * - acceptsKind with no new source array was entity-only;
 * - legacy `vault` meant manual + vault;
 * - every other legacy property was manual-only.
 */
export function getPropertyOptionSources(
  property: Partial<PropertySourceShape> | null | undefined,
): PropertyOptionSource[] {
  const configured = Array.isArray(property?.optionSources)
    ? new Set(
        property.optionSources.filter(
          (source): source is PropertyOptionSource => SOURCE_ORDER.includes(source),
        ),
      )
    : null;

  let sources: PropertyOptionSource[];
  if (configured && configured.size > 0) {
    sources = SOURCE_ORDER.filter((source) => configured.has(source));
  } else if (hasAcceptedKind(property) && property?.type !== 'kind') {
    sources = ['entity'];
  } else if (property?.optionsSource === 'vault') {
    sources = ['manual', 'vault'];
  } else {
    sources = ['manual'];
  }

  if (property?.type === 'kind' || !hasAcceptedKind(property)) {
    sources = sources.filter((source) => source !== 'entity');
  }
  return sources.length > 0 ? sources : ['manual'];
}

export function propertyUsesOptionSource(
  property: Partial<PropertySourceShape> | null | undefined,
  source: PropertyOptionSource,
): boolean {
  return getPropertyOptionSources(property).includes(source);
}

export function propertyUsesEntityOptions(
  property: Partial<PropertySourceShape> | null | undefined,
): boolean {
  return propertyUsesOptionSource(property, 'entity');
}

export function propertyUsesManualOptions(
  property: Partial<PropertySourceShape> | null | undefined,
): boolean {
  return propertyUsesOptionSource(property, 'manual');
}

export function propertyUsesVaultOptions(
  property: Partial<PropertySourceShape> | null | undefined,
): boolean {
  return propertyUsesOptionSource(property, 'vault');
}

export function isEntityOnlyProperty(
  property: Partial<PropertySourceShape> | null | undefined,
): boolean {
  const sources = getPropertyOptionSources(property);
  return sources.length === 1 && sources[0] === 'entity';
}

export function encodePropertyOptionSources(
  sources: readonly PropertyOptionSource[],
): string {
  const selected = new Set(sources);
  return SOURCE_ORDER.filter((source) => selected.has(source)).join('+');
}

export function decodePropertyOptionSources(value: unknown): PropertyOptionSource[] {
  const selected = new Set(
    String(value || '')
      .split('+')
      .map((source) => source.trim())
      .filter((source): source is PropertyOptionSource => (
        SOURCE_ORDER.includes(source as PropertyOptionSource)
      )),
  );
  return SOURCE_ORDER.filter((source) => selected.has(source));
}

export function normalizePropertyOptionSources(
  property: Partial<PropertySourceShape>,
): PropertyOptionSource[] {
  return getPropertyOptionSources(property);
}

export function findRelationalStatusProperty(
  properties: readonly CustomProperty[] | null | undefined,
): CustomProperty | null {
  return (properties || []).find((property) => {
    const id = String(property?.id || '').trim().toLowerCase();
    const key = String(property?.key || '').trim().toLowerCase();
    return (id === 'status' || key === 'status')
      && propertyUsesEntityOptions(property);
  }) || null;
}
