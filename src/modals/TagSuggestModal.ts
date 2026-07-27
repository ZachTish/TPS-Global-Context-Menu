import {
  App,
  FuzzySuggestModal,
  Notice,
} from 'obsidian';
import type { FuzzyMatch } from 'obsidian';
import * as logger from '../logger';
import { normalizeTagValue } from '../utils/tag-utils';

export interface TagSuggestModalOptions {
  title?: string;
  placeholder?: string;
  emptyStateText?: string;
  selectedTags?: readonly string[];
}

/**
 * Search-only vault tag chooser used by typed Base cells.
 *
 * New tags can still be created through the task context menu. Base cells use
 * this constrained picker so a tap always exposes the real vault tag list and
 * never falls back to an ambiguous free-text property editor.
 */
export class TagSuggestModal extends FuzzySuggestModal<string> {
  private readonly items: string[];
  private readonly selected: Set<string>;

  constructor(
    app: App,
    tags: readonly string[],
    private readonly onChoose: (tag: string, selected: boolean) => void | Promise<void>,
    options: TagSuggestModalOptions = {},
  ) {
    super(app);
    this.modalEl.addClass('mod-tps-gcm');
    this.titleEl.setText(options.title || 'Choose tag');
    this.setPlaceholder(options.placeholder || 'Search vault tags…');
    this.emptyStateText = options.emptyStateText || 'No matching vault tags.';
    this.setInstructions([{ command: '↵', purpose: 'toggle tag' }]);
    this.limit = 500;
    this.selected = new Set(
      (options.selectedTags || [])
        .map((tag) => normalizeTagValue(tag).toLocaleLowerCase())
        .filter(Boolean),
    );
    const byIdentity = new Map<string, string>();
    for (const rawTag of tags || []) {
      const tag = normalizeTagValue(rawTag);
      const identity = tag.toLocaleLowerCase();
      if (!tag || byIdentity.has(identity)) continue;
      byIdentity.set(identity, tag);
    }
    this.items = [...byIdentity.values()].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' }));
  }

  getItems(): string[] {
    return this.items;
  }

  getItemText(tag: string): string {
    return `#${tag}`;
  }

  renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
    const tag = match.item;
    const selected = this.selected.has(tag.toLocaleLowerCase());
    el.createDiv({
      cls: 'tps-gcm-tag-suggest-label',
      text: `#${tag}`,
    });
    if (selected) {
      el.createEl('small', {
        cls: 'tps-gcm-tag-suggest-selected',
        text: 'Selected · choose to remove',
      });
    }
  }

  onChooseItem(tag: string, _evt: MouseEvent | KeyboardEvent): void {
    const selected = this.selected.has(tag.toLocaleLowerCase());
    void Promise.resolve(this.onChoose(tag, selected)).catch((error) => {
      logger.flowError('TagSuggestModal', 'choose:failed', error, { tag });
      new Notice('Could not add the selected tag.');
    });
  }
}
