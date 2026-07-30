import type { PropertyValueChoice } from '../modals/PropertyValueSuggestModal';
import type { CustomProperty } from '../types';
import {
  mergeEntityReferenceList,
  mergeMixedEntityReferenceList,
} from '../utils/entity-property';
import {
  isLinkListProperty,
  mergeLinkList,
  mergeMixedList,
  mergeStringList,
} from '../utils/list-utils';
import { propertyUsesEntityOptions } from '../utils/property-option-source';
import { readInlineFieldValue } from '../utils/task-line-metadata';
import { setLogInlineFieldValue } from './log-line-utils';

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

  const current = readInlineFieldValue(line, property.key);
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
