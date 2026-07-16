import { App, Modal } from 'obsidian';
import type { LineItemDeleteMode } from '../utils/line-item-deletion';

export interface NestedLineDeletePromptOptions {
  itemLabel: string;
  nestedContentLineCount: number;
  preserveNestedContentLabel?: string;
}

export function promptNestedLineDelete(
  app: App,
  options: NestedLineDeletePromptOptions,
): Promise<LineItemDeleteMode | null> {
  return new Promise((resolve) => {
    new NestedLineDeleteModal(app, options, resolve).open();
  });
}

class NestedLineDeleteModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly options: NestedLineDeletePromptOptions,
    private readonly resolveResult: (mode: LineItemDeleteMode | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('mod-tps-gcm');
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: 'Delete item with nested content?' });
    const count = Math.max(1, this.options.nestedContentLineCount);
    this.contentEl.createEl('p', {
      text: `This ${this.options.itemLabel} has ${count} nested content line${count === 1 ? '' : 's'}. Choose what should happen to them.`,
    });

    const actions = this.contentEl.createDiv({ cls: 'tps-gcm-confirm-buttons' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.finish(null));
    actions.createEl('button', {
      text: this.options.preserveNestedContentLabel || 'Move nested content up',
    }).addEventListener('click', () => {
      this.finish('promote-children');
    });
    actions.createEl('button', { text: 'Delete item and nested content', cls: 'mod-warning' }).addEventListener('click', () => {
      this.finish('delete-subtree');
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.resolveResult(null);
  }

  private finish(mode: LineItemDeleteMode | null): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveResult(mode);
    this.close();
  }
}
