import type { PropertyValueChoice } from '../modals/PropertyValueSuggestModal';
import type { CustomProperty } from '../types';
import {
  mergeEntityReferenceList,
  mergeMixedEntityReferenceList,
  removeEntityReferenceListValues,
  removeMixedEntityReferenceListValues,
} from '../utils/entity-property';
import {
  isLinkListProperty,
  mergeLinkList,
  mergeMixedList,
  mergeStringList,
  removeLinkListValues,
  removeStringListValues,
} from '../utils/list-utils';
import { propertyUsesEntityOptions } from '../utils/property-option-source';
import { normalizePropertyKeyIdentity } from '../utils/property-key-identity';
import { readInlineFieldValues, setLogInlineFieldValue } from './log-line-utils';

/**
 * Apply one combined picker result to a TPS Table source line.
 *
 * Keeping this behavior pure makes scalar replacement, clear, and additive
 * list semantics executable without involving Obsidian's modal lifecycle.
 */
export function applyLogBasePropertyValueChoice(
  line: string,
  property: CustomProperty,
  choice: PropertyValueChoice,
): string {
  if (choice.kind === 'custom') return line;
  if (choice.kind === 'clear') {
    return setLogInlineFieldValue(line, property.key, null);
  }
  if (property.type !== 'list') {
    return setLogInlineFieldValue(line, property.key, choice.value);
  }

  const normalizedKey = normalizePropertyKeyIdentity(property.key);
  const currentValues = readInlineFieldValues(line)[normalizedKey] ?? [];
  const current = currentValues.join(', ');
  const next = choice.kind === 'entity'
    ? isLinkListProperty(property)
      ? mergeEntityReferenceList(current, choice.value)
      : mergeMixedEntityReferenceList(current, choice.value)
    : isLinkListProperty(property)
      ? mergeLinkList(current, choice.value)
      : propertyUsesEntityOptions(property)
        ? mergeMixedList(current, choice.value)
        : mergeStringList(current, choice.value);
  return setLogInlineFieldValue(line, property.key, next.join(', '));
}

/** Add one list member while preserving and canonicalizing repeated carriers. */
export function addLogBaseListPropertyValue(
  line: string,
  property: CustomProperty,
  value: string,
  route: 'literal' | 'entity' | 'file',
): string {
  const current = getCombinedListValue(line, property);
  const next = route === 'entity'
    ? isLinkListProperty(property)
      ? mergeEntityReferenceList(current, value)
      : mergeMixedEntityReferenceList(current, value)
    : isLinkListProperty(property)
      ? mergeLinkList(current, value)
      : propertyUsesEntityOptions(property)
        ? mergeMixedList(current, value)
        : mergeStringList(current, value);
  return setLogInlineFieldValue(line, property.key, next.join(', '));
}

/** Remove one list member while preserving every other repeated carrier. */
export function removeLogBaseListPropertyValue(
  line: string,
  property: CustomProperty,
  value: string,
): string {
  const current = getCombinedListValue(line, property);
  const next = propertyUsesEntityOptions(property)
    ? isLinkListProperty(property)
      ? removeEntityReferenceListValues(current, value)
      : removeMixedEntityReferenceListValues(current, value)
    : isLinkListProperty(property)
      ? removeLinkListValues(current, value)
      : removeStringListValues(current, value);
  return setLogInlineFieldValue(line, property.key, next.length > 0 ? next.join(', ') : null);
}

function getCombinedListValue(line: string, property: CustomProperty): string {
  const normalizedKey = normalizePropertyKeyIdentity(property.key);
  return (readInlineFieldValues(line)[normalizedKey] ?? []).join(', ');
}
