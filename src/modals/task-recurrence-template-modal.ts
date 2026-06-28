import { App, Modal, Notice, Setting } from 'obsidian';

export class TaskRecurrenceTemplateModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly initialValue: string,
    private readonly onSubmit: (value: string) => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('mod-tps-gcm');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: this.title || 'Edit task recurrence template' });

    const textarea = contentEl.createEl('textarea');
    textarea.value = this.initialValue || '';
    textarea.rows = 6;
    textarea.style.width = '100%';
    textarea.style.resize = 'vertical';
    textarea.addEventListener('keydown', (evt) => {
      evt.stopPropagation();
      if ((evt.metaKey || evt.ctrlKey) && evt.key === 'Enter') {
        void this.submit(textarea.value);
      }
    });

    new Setting(contentEl)
      .setDesc('This template is stored in plugin metadata. The next instance is created from this task line with the checkbox reset and a new scheduled value.')
      .addButton((button) => {
        button
          .setButtonText('Cancel')
          .onClick(() => this.close());
      })
      .addButton((button) => {
        button
          .setButtonText('Save')
          .setCta()
          .onClick(() => {
            void this.submit(textarea.value);
          });
      });

    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(0, textarea.value.length);
    }, 0);
  }

  private async submit(value: string): Promise<void> {
    const next = String(value || '').trim();
    if (!/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]\r\n]?\]\s+/.test(next)) {
      new Notice('Use a markdown task line, for example: - [ ] Task title [recurrence:: ...]');
      return;
    }
    this.close();
    await this.onSubmit(next);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
