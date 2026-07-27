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
  entityMatchesAcceptedKinds,
  entityToReferenceChoice,
  normalizeAcceptsKind,
  resolveEntityIndexQueryable,
} from '../utils/entity-property';
import type {
  EntityIndexQueryable,
  EntityIndexQueryResult,
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
 * wikilink to a note or line accepted by the configured Kind constraint.
 */
export class EntitySuggestModal extends FuzzySuggestModal<EntityReferenceChoice> {
  private items: EntityReferenceChoice[] | null = null;
  private readonly noMatchesText: string;

  constructor(
    app: App,
    private readonly entityIndex: EntityIndexQueryable,
    private readonly acceptedKinds: readonly string[],
    private readonly onChoose: (choice: EntityReferenceChoice) => void | Promise<void>,
    options: EntitySuggestModalOptions = {},
  ) {
    super(app);
    const kinds = acceptedKinds.join(', ');
    this.setPlaceholder(options.placeholder || `Search ${kinds || 'matching'} entities…`);
    this.noMatchesText = options.emptyStateText
      || `No notes or lines match Kind ${formatKindList(acceptedKinds)}.`;
    this.emptyStateText = 'Loading matching entities…';
    this.setInstructions([{ command: '↵', purpose: 'select entity' }]);
    this.limit = 500;
    void this.loadItems();
  }

  getItems(): EntityReferenceChoice[] {
    return this.items ?? [];
  }

  private async loadItems(): Promise<void> {
    try {
      this.items = buildEntityReferenceChoices(await this.queryAcceptedEntities());
      this.emptyStateText = this.noMatchesText;
    } catch (error) {
      logger.flowError('EntitySuggestModal', 'query:failed', error, {
        acceptedKindCount: this.acceptedKinds.length,
      });
      this.items = [];
      this.emptyStateText = 'Could not load matching entities.';
    }
    this.refreshSuggestions();
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
    void this.chooseResolvedItem(item).catch((error) => {
      logger.flowError('EntitySuggestModal', 'choose:failed', error, {
        path: item.path,
      });
      new Notice('Could not set the selected entity.');
    });
  }

  private async chooseResolvedItem(item: EntityReferenceChoice): Promise<void> {
    const currentEntity = (await this.queryAcceptedEntities()).find(
      (entity) => String(entity.id || '').toLocaleLowerCase() === item.id.toLocaleLowerCase(),
    );
    if (!currentEntity) {
      new Notice('That entity was deleted or no longer matches this property. Nothing was updated.');
      return;
    }

    let resolvedEntity = currentEntity;
    const isLineEntity = currentEntity.entityType === 'block';
    if (isLineEntity || currentEntity.referenceState === 'provisional') {
      if (typeof this.entityIndex.materializeReference !== 'function') {
        if (currentEntity.referenceState !== 'provisional') {
          resolvedEntity = currentEntity;
        } else {
          new Notice('This line cannot be referenced until the entity index is fully available.');
          return;
        }
      } else {
        const materialized = await this.entityIndex.materializeReference(currentEntity);
        if (!materialized) {
          new Notice('That line changed or has a duplicate identity. Nothing was updated.');
          return;
        }
        resolvedEntity = materialized;
      }
    }
    if (!entityMatchesAcceptedKinds(resolvedEntity, this.acceptedKinds)) {
      new Notice('That entity no longer matches this property’s accepted Kind. Nothing was updated.');
      return;
    }
    const resolvedChoice = entityToReferenceChoice(resolvedEntity);
    if (!resolvedChoice?.wikilink || resolvedChoice.referenceState !== 'ready') {
      if (currentEntity.referenceState === 'provisional') {
        new Notice('This line cannot be referenced until the entity index is fully available.');
      }
      return;
    }
    await this.onChoose(resolvedChoice);
  }

  private async queryAcceptedEntities(): Promise<readonly EntityIndexRecordLike[]> {
    const query = {
      dimensions: {
        kind: {
          anyOf: [...this.acceptedKinds],
        },
      },
    };
    let result: EntityIndexQueryResult;
    if (typeof this.entityIndex.queryAsync === 'function') {
      result = await this.entityIndex.queryAsync(query);
    } else {
      if (typeof this.entityIndex.ensureReady === 'function') {
        await this.entityIndex.ensureReady();
      }
      result = this.entityIndex.query(query);
    }
    return readQueryEntities(result);
  }

  private refreshSuggestions(): void {
    if (!this.inputEl) return;
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
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
  result: EntityIndexQueryResult,
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
