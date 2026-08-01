import { App, Modal } from 'obsidian';

export class StatusChoiceModal extends Modal {
  private readonly statuses: string[];
  private readonly onChoose: (status: string | null) => void;
  private settled = false;

  constructor(app: App, statuses: string[], onChoose: (status: string | null) => void) {
    super(app);
    this.statuses = statuses;
    this.onChoose = onChoose;
  }

  onOpen(): void {
    this.modalEl.addClass('mod-tps-gcm');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'All checklist items are resolved' });
    contentEl.createEl('p', { text: 'Set a status for this note:' });

    const buttonWrap = contentEl.createDiv({ cls: 'tps-gcm-status-choice-buttons' });
    for (const status of this.statuses) {
      const btn = buttonWrap.createEl('button', { text: status });
      btn.addEventListener('click', () => {
        this.finish(status);
      });
    }

    const cancelBtn = contentEl.createEl('button', { text: 'Cancel' });
    cancelBtn.style.marginTop = '12px';
    cancelBtn.addEventListener('click', () => {
      this.finish(null);
    });
  }

  onClose(): void {
    try {
      this.settle(null);
    } finally {
      this.contentEl.empty();
    }
  }

  private finish(status: string | null): void {
    try {
      this.settle(status);
    } finally {
      this.close();
    }
  }

  private settle(status: string | null): void {
    if (this.settled) return;
    this.settled = true;
    this.onChoose(status);
  }
}
