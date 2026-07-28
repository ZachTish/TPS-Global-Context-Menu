import type { CustomProperty } from '../types';
import { normalizeAcceptsKind } from './entity-property';
import {
  getPropertyOptionSources,
  isEntityOnlyProperty,
} from './property-option-source';

/**
 * Keep the persisted schema backward-compatible while accepting ergonomic
 * comma/newline input (and defensive array input from imported settings).
 */
export function normalizeAcceptedKindSetting(value: unknown): string {
  return normalizeAcceptsKind(value)
    .map((kind) => kind.toLowerCase())
    .join(', ');
}

/**
 * Commit the accepted Kinds for one custom property without relying on the
 * legacy inference that only exists for loading older settings.
 *
 * The first accepted Kind set intentionally starts as entity-only. Changing an
 * existing set preserves the configured source mix, and clearing the set
 * removes only the entity source.
 */
export function applyAcceptedKindSetting(
  property: CustomProperty,
  value: unknown,
): void {
  const previousKinds = normalizeAcceptedKindSetting(property.acceptsKind);
  const previousSources = getPropertyOptionSources(property);
  const acceptedKinds = normalizeAcceptedKindSetting(value);

  if (acceptedKinds) {
    property.acceptsKind = acceptedKinds;
    property.optionSources = previousKinds
      ? previousSources
      : ['entity'];
  } else {
    delete property.acceptsKind;
    property.optionSources = previousSources.filter((source) => source !== 'entity');
    if (property.optionSources.length === 0) property.optionSources = ['manual'];
  }

  property.optionsSource = property.optionSources.includes('vault')
    ? 'vault'
    : 'manual';
  if (property.type === 'list' && isEntityOnlyProperty(property)) {
    property.listItemType = 'link';
  }
}
