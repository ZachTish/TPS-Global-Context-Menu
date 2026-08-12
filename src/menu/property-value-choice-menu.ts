import { App, Menu, Notice } from 'obsidian';
import type { CustomProperty } from '../types';
import { openEntitySuggestModal } from '../modals/EntitySuggestModal';
import { TextInputModal } from '../modals/text-input-modal';
import type {
  EntityIndexQueryable,
  EntityIndexSourceLike,
  EntityReferenceChoice,
} from '../utils/entity-property';
import {
  getEntityReferenceTargetIdentity,
  normalizeAcceptsKind,
} from '../utils/entity-property';
import {
  isLinkListProperty,
  isTagListProperty,
  parseLinkListInput,
  parseMixedListInput,
  parseStringListInput,
} from '../utils/list-utils';
import { getEffectivePropertyOptions } from '../utils/property-options';
import {
  propertyUsesEntityOptions,
  propertyUsesManualOptions,
} from '../utils/property-option-source';
import { parseTagInput } from '../utils/tag-utils';

export interface PropertyValueChoiceMenuOptions {
  app: App;
  source: EntityIndexQueryable | EntityIndexSourceLike | null | undefined;
  menu: Menu;
  property: CustomProperty;
  currentValue?: unknown;
  onClear: () => unknown | Promise<unknown>;
  onChooseLiteral: (value: string) => unknown | Promise<unknown>;
  onChooseEntity: (choice: EntityReferenceChoice) => unknown | Promise<unknown>;
}

/**
 * Populate any Obsidian Menu with the literal/entity choices declared by a
 * custom property. Storage stays with the caller so the same contract works
 * for frontmatter, task lines, bullets, headings, TPS List, and TPS Table.
 */
export function addPropertyValueChoiceMenuItems(
  options: PropertyValueChoiceMenuOptions,
): void {
  const {
    app,
    source,
    menu,
    property,
    currentValue = '',
    onClear,
    onChooseLiteral,
    onChooseEntity,
  } = options;
  const current = String(currentValue || '').trim();
  const literals = getEffectivePropertyOptions(app, property);
  const allowManual = propertyUsesManualOptions(property);
  const allowEntities = propertyUsesEntityOptions(property);
  const isList = property.type === 'list';
  const selectedListValues = isList
    ? getSelectedListValues(property, currentValue)
    : [];
  const selectedListIdentities = new Set(
    selectedListValues
      .map((value) => getListValueIdentity(property, value))
      .filter(Boolean),
  );

  menu.addItem((item) => {
    item
      .setTitle('(none)')
      .setChecked(isList ? selectedListValues.length === 0 : !current)
      .onClick(() => { void onClear(); });
  });

  if (allowManual) {
    menu.addItem((item) => {
      item
        .setTitle(isList ? 'Add new list item…' : 'Set custom value…')
        .setIcon('pencil')
        .onClick(() => {
          new TextInputModal(
            app,
            isList
              ? `${property.label || property.key} — add new item`
              : property.label || property.key,
            isList ? '' : current,
            (value) => {
              const next = String(value || '').trim();
              if (!next) {
                new Notice('Value cannot be empty.');
                return;
              }
              void onChooseLiteral(next);
            },
          ).open();
        });
    });
  }

  if (literals.length > 0) menu.addSeparator();
  for (const literal of literals) {
    menu.addItem((item) => {
      item
        .setTitle(literal)
        .setChecked(isList
          ? selectedListIdentities.has(getListValueIdentity(property, literal))
          : current === literal)
        .onClick(() => { void onChooseLiteral(literal); });
    });
  }

  if (allowEntities) {
    if (literals.length > 0 || allowManual) menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle(formatEntityPickerTitle(property))
        .setIcon('file-search')
        .onClick(() => {
          openEntitySuggestModal(app, source, property, async (choice) => {
            await onChooseEntity(choice);
          });
        });
    });
  }
}

function getSelectedListValues(property: CustomProperty, value: unknown): string[] {
  if (isLinkListProperty(property)) return parseLinkListInput(value);
  if (propertyUsesEntityOptions(property)) return parseMixedListInput(value);
  if (isTagListProperty(property)) return parseTagInput(value);
  return parseStringListInput(value);
}

function getListValueIdentity(property: CustomProperty, value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const linkTarget = getEntityReferenceTargetIdentity(raw);
  if (linkTarget) return `link:${linkTarget}`;
  if (isLinkListProperty(property)) {
    const normalizedLink = parseLinkListInput(raw)[0] || '';
    const normalizedTarget = getEntityReferenceTargetIdentity(normalizedLink);
    return normalizedTarget ? `link:${normalizedTarget}` : '';
  }
  if (isTagListProperty(property)) {
    const normalizedTag = parseTagInput(raw)[0] || '';
    return normalizedTag ? `tag:${normalizedTag}` : '';
  }
  return `literal:${raw.toLocaleLowerCase()}`;
}

function formatEntityPickerTitle(property: CustomProperty): string {
  const acceptedKinds = normalizeAcceptsKind(property.acceptsKind);
  if (acceptedKinds.length === 1) {
    return `Choose ${acceptedKinds[0]} entity…`;
  }
  if (acceptedKinds.length > 1) {
    return `Choose matching entity (${acceptedKinds.join(' or ')})…`;
  }
  return `Choose ${property.label || 'matching'} entity…`;
}

export function showPropertyValueChoiceMenuAtElement(
  menu: Menu,
  anchor: HTMLElement,
): void {
  const positioned = menu as Menu & { showAtElement?: (element: HTMLElement) => void };
  if (typeof positioned.showAtElement === 'function') {
    positioned.showAtElement(anchor);
    return;
  }
  const rect = anchor.getBoundingClientRect();
  menu.showAtPosition({ x: rect.left, y: rect.bottom });
}
