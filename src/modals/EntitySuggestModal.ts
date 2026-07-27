import {
  App,
  FuzzySuggestModal,
  Notice,
} from 'obsidian';
import type { FuzzyMatch } from 'obsidian';
import * as logger from '../logger';
import type { CustomProperty } from '../types';
import {
  buildEntityReferenceChoices,
  normalizeAcceptsKind,
  resolveEntityIndexQueryable,
} from '../utils/entity-property';
import type {
  EntityIndexQueryable,
  EntityIndexRecordLike,
  EntityIndexSourceLike,
  EntityReferenceChoice,
} from '../utils/entity-property';

export interface EntitySuggestModalOptions {
  placeholder?: string;
  emptyStateText?: string;
  noticeOnUnavailable?: boolean;
}

type AcceptsKindSource = unknown | Pick<CustomProperty, 'acceptsKind'>;

/**
 * Search-only picker for indexed entity references. It intentionally exposes no
 * "create" or arbitrary-value route: every returned value is a canonical
 * wikilink to a note accepted by the configured Kind constraint.
 */
export class EntitySuggestModal extends FuzzySuggestModal<EntityReferenceChoice> {
  private items: EntityReferenceChoice[] | null = null;

  constructor(
    app: App,
    private readonly entityIndex: EntityIndexQueryable,
    private readonly acceptedKinds: readonly string[],
    private readonly onChoose: (choice: EntityReferenceChoice) => void | Promise<void>,
    options: EntitySuggestModalOptions = {},
  ) {
    super(app);
    const kinds = acceptedKinds.join(', ');
    this.setPlaceholder(options.placeholder || `Search ${kinds || 'matching'} notes…`);
    this.emptyStateText = options.emptyStateText || `No notes match Kind ${formatKindList(acceptedKinds)}.`;
    this.setInstructions([{ command: '↵', purpose: 'select note' }]);
    this.limit = 500;
  }

  getItems(): EntityReferenceChoice[] {
    if (this.items) return this.items;

    try {
      const result = this.entityIndex.query({
        dimensions: {
          kind: {
            anyOf: [...this.acceptedKinds],
          },
        },
      });
      this.items = buildEntityReferenceChoices(readQueryEntities(result));
    } catch (error) {
      logger.flowError('EntitySuggestModal', 'query:failed', error, {
        acceptedKindCount: this.acceptedKinds.length,
      });
      this.items = [];
    }

    return this.items;
  }

  getItemText(item: EntityReferenceChoice): string {
    return item.detail && item.detail !== item.label
      ? `${item.label} — ${item.detail}`
      : item.label;
  }

  renderSuggestion(match: FuzzyMatch<EntityReferenceChoice>, el: HTMLElement): void {
    const item = match.item;
    el.createDiv({
      cls: 'tps-gcm-entity-suggest-label',
      text: item.label,
    });
    if (item.detail && item.detail !== item.label) {
      el.createEl('small', {
        cls: 'tps-gcm-entity-suggest-path',
        text: item.detail,
      });
    }
  }

  onChooseItem(item: EntityReferenceChoice, _evt: MouseEvent | KeyboardEvent): void {
    void Promise.resolve(this.onChoose(item)).catch((error) => {
      logger.flowError('EntitySuggestModal', 'choose:failed', error, {
        path: item.path,
      });
      new Notice('Could not set the selected note.');
    });
  }
}

export function openEntitySuggestModal(
  app: App,
  source: EntityIndexQueryable | EntityIndexSourceLike | null | undefined,
  propertyOrKinds: AcceptsKindSource,
  onChoose: (choice: EntityReferenceChoice) => void | Promise<void>,
  options: EntitySuggestModalOptions = {},
): EntitySuggestModal | null {
  const acceptedKinds = normalizeAcceptsKind(
    propertyOrKinds && typeof propertyOrKinds === 'object' && 'acceptsKind' in propertyOrKinds
      ? (propertyOrKinds as Pick<CustomProperty, 'acceptsKind'>).acceptsKind
      : propertyOrKinds,
  );
  if (acceptedKinds.length === 0) {
    if (options.noticeOnUnavailable !== false) {
      new Notice('Choose an accepted Kind for this property first.');
    }
    return null;
  }

  const entityIndex = resolveEntityIndexQueryable(source);
  if (!entityIndex) {
    if (options.noticeOnUnavailable !== false) {
      new Notice('The entity index is not available yet.');
    }
    return null;
  }

  const modal = new EntitySuggestModal(app, entityIndex, acceptedKinds, onChoose, options);
  modal.open();
  return modal;
}

function readQueryEntities(
  result: ReturnType<EntityIndexQueryable['query']>,
): readonly EntityIndexRecordLike[] {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];
  const collection = result as {
    entities?: readonly EntityIndexRecordLike[];
    items?: readonly EntityIndexRecordLike[];
  };
  return Array.isArray(collection.entities)
    ? collection.entities
    : Array.isArray(collection.items)
      ? collection.items
      : [];
}

function formatKindList(kinds: readonly string[]): string {
  if (kinds.length === 0) return 'constraint';
  if (kinds.length === 1) return `"${kinds[0]}"`;
  return kinds.map((kind) => `"${kind}"`).join(' or ');
}
