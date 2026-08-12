import { App, FuzzySuggestModal, Notice } from 'obsidian';
import type { FuzzyMatch } from 'obsidian';
import type { CustomProperty } from '../types';
import type {
  EntityIndexQueryable,
  EntityIndexSourceLike,
  EntityReferenceChoice,
} from '../utils/entity-property';
import {
  buildEntityReferenceChoices,
  normalizeAcceptsKind,
  resolveEntityIndexQueryable,
} from '../utils/entity-property';
import { getEffectivePropertyOptions } from '../utils/property-options';
import {
  propertyUsesEntityOptions,
  propertyUsesManualOptions,
} from '../utils/property-option-source';
import {
  isLinkListProperty,
  isTagListProperty,
  parseLinkListInput,
  parseMixedListInput,
  parseStringListInput,
} from '../utils/list-utils';
import { getEntityReferenceTargetIdentity } from '../utils/entity-property';
import { parseTagInput } from '../utils/tag-utils';
import {
  queryAcceptedEntityRecords,
  resolveCurrentEntityReferenceChoice,
} from './EntitySuggestModal';
import { TextInputModal } from './text-input-modal';
import * as logger from '../logger';

export type PropertyValueChoice =
  | { kind: 'clear'; value: ''; label: string; detail: string }
  | { kind: 'literal'; value: string; label: string; detail: string }
  | { kind: 'entity'; value: string; label: string; detail: string; entity: EntityReferenceChoice }
  | { kind: 'custom'; value: ''; label: string; detail: string };

export class PropertyValueSuggestModal extends FuzzySuggestModal<PropertyValueChoice> {
  private items: PropertyValueChoice[] = [];
  private readonly entityIndex: EntityIndexQueryable | null;
  private readonly acceptedKinds: string[];

  constructor(
    app: App,
    source: EntityIndexQueryable | EntityIndexSourceLike | null | undefined,
    private readonly property: CustomProperty,
    private readonly currentValue: string,
    private readonly onChoose: (choice: PropertyValueChoice) => void | Promise<void>,
  ) {
    super(app);
    this.entityIndex = resolveEntityIndexQueryable(source);
    this.acceptedKinds = normalizeAcceptsKind(property.acceptsKind);
    this.setPlaceholder(`Choose ${property.label || property.key}…`);
    this.emptyStateText = 'Loading property choices…';
    this.limit = 500;
    void this.loadItems();
  }

  getItems(): PropertyValueChoice[] {
    return this.items;
  }

  getItemText(item: PropertyValueChoice): string {
    return item.detail ? `${item.label} — ${item.detail}` : item.label;
  }

  renderSuggestion(match: FuzzyMatch<PropertyValueChoice>, el: HTMLElement): void {
    const selected = this.isCurrentListMember(match.item);
    el.createDiv({
      cls: 'tps-gcm-entity-suggest-label',
      text: selected ? `✓ ${match.item.label}` : match.item.label,
    });
    if (selected) {
      el.addClass('is-selected');
      el.setAttr('aria-selected', 'true');
    }
    if (match.item.detail) {
      el.createEl('small', {
        cls: 'tps-gcm-entity-suggest-path',
        text: match.item.detail,
      });
    }
  }

  private isCurrentListMember(item: PropertyValueChoice): boolean {
    if (this.property.type !== 'list' || (item.kind !== 'literal' && item.kind !== 'entity')) return false;
    const members = isLinkListProperty(this.property)
      ? parseLinkListInput(this.currentValue)
      : propertyUsesEntityOptions(this.property)
        ? parseMixedListInput(this.currentValue)
        : isTagListProperty(this.property)
          ? parseTagInput(this.currentValue)
          : parseStringListInput(this.currentValue);
    const identity = this.getListMemberIdentity(item.value);
    return Boolean(identity) && members.some((member) => this.getListMemberIdentity(member) === identity);
  }

  private getListMemberIdentity(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const linkTarget = getEntityReferenceTargetIdentity(raw);
    if (linkTarget) return `link:${linkTarget}`;
    if (isTagListProperty(this.property)) {
      const tag = parseTagInput(raw)[0] || '';
      return tag ? `tag:${tag}` : '';
    }
    return `literal:${raw.toLocaleLowerCase()}`;
  }

  onChooseItem(item: PropertyValueChoice, _evt: MouseEvent | KeyboardEvent): void {
    if (item.kind === 'custom') {
      const isList = this.property.type === 'list';
      new TextInputModal(
        this.app,
        isList
          ? `${this.property.label || this.property.key} — add new item`
          : this.property.label || this.property.key,
        isList ? '' : this.currentValue,
        (value) => {
          const next = String(value || '').trim();
          if (!next) {
            new Notice('Value cannot be empty.');
            return;
          }
          void this.onChoose({
            kind: 'literal',
            value: next,
            label: next,
            detail: 'Custom value',
          });
        },
      ).open();
      return;
    }
    if (item.kind === 'literal' || item.kind === 'clear') {
      void this.onChoose(item);
      return;
    }
    if (!this.entityIndex) {
      new Notice('The entity index is not available yet.');
      return;
    }
    void resolveCurrentEntityReferenceChoice(
      this.entityIndex,
      this.acceptedKinds,
      item.entity,
    ).then((resolved) => {
      if (!resolved) return;
      return this.onChoose({
        kind: 'entity',
        value: resolved.wikilink,
        label: resolved.label,
        detail: resolved.detail,
        entity: resolved,
      });
    }).catch((error) => {
      logger.flowError('PropertyValueSuggestModal', 'choose:failed', error, {
        property: this.property.key,
      });
      new Notice('Could not set the selected value.');
    });
  }

  private async loadItems(): Promise<void> {
    const items: PropertyValueChoice[] = [{
      kind: 'clear',
      value: '',
      label: '(none)',
      detail: 'Clear value',
    }];
    if (propertyUsesManualOptions(this.property)) {
      const isList = this.property.type === 'list';
      items.push({
        kind: 'custom',
        value: '',
        label: isList ? 'Add new list item…' : 'Set custom value…',
        detail: isList ? 'Create a manual list value' : 'Manual',
      });
    }
    for (const literal of getEffectivePropertyOptions(this.app, this.property)) {
      items.push({
        kind: 'literal',
        value: literal,
        label: literal,
        detail: 'Configured or vault value',
      });
    }
    if (
      propertyUsesEntityOptions(this.property)
      && this.entityIndex
      && this.acceptedKinds.length > 0
    ) {
      try {
        const entities = buildEntityReferenceChoices(
          await queryAcceptedEntityRecords(this.entityIndex, this.acceptedKinds),
        );
        entities.forEach((entity) => {
          items.push({
            kind: 'entity',
            value: entity.wikilink,
            label: entity.label,
            detail: entity.detail,
            entity,
          });
        });
      } catch (error) {
        logger.flowError('PropertyValueSuggestModal', 'load:failed', error, {
          property: this.property.key,
        });
      }
    }
    this.items = items;
    this.emptyStateText = items.length > 0 ? 'No matching values.' : 'No values are available.';
    this.inputEl?.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export function openPropertyValueSuggestModal(
  app: App,
  source: EntityIndexQueryable | EntityIndexSourceLike | null | undefined,
  property: CustomProperty,
  currentValue: string,
  onChoose: (choice: PropertyValueChoice) => void | Promise<void>,
): PropertyValueSuggestModal {
  const modal = new PropertyValueSuggestModal(app, source, property, currentValue, onChoose);
  modal.open();
  return modal;
}
