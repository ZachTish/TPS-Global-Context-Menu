import { App, Modal, Setting } from 'obsidian';

export class PropertyMigrationModal extends Modal {
  private accepted = false;
  constructor(app: App, private title: string, private description: string, private paths: string[], private blocked: string[], private resolve: (confirmed: boolean) => void) { super(app); }
  onOpen(): void {
    this.modalEl.addClass('mod-tps-gcm');
    this.modalEl.addClass('tps-gcm-property-migration-modal');
    this.titleEl.setText(this.title);
    this.contentEl.createEl('p', { text: this.description });
    if (this.blocked.length) this.contentEl.createEl('p', { text: 'Resolve the listed conflicts before continuing.' });
    const list = this.contentEl.createEl('ul');
    list.style.maxHeight = '40vh'; list.style.overflowY = 'auto'; list.style.overflowWrap = 'anywhere';
    for (const path of this.blocked.length ? this.blocked : this.paths) list.createEl('li', { text: path });
    this.contentEl.createEl('p', { text: `${this.paths.length} affected notes${this.blocked.length ? ` · ${this.blocked.length} conflicts` : ''}`, attr: { 'aria-live': 'polite' } });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(button => button.setButtonText('Confirm update').setCta().setDisabled(this.blocked.length > 0).onClick(() => { this.accepted = true; this.close(); }));
  }
  onClose(): void { this.contentEl.empty(); this.resolve(this.accepted); }
  static confirm(app: App, title: string, description: string, paths: string[], blocked: string[] = []): Promise<boolean> {
    return new Promise(resolve => new PropertyMigrationModal(app, title, description, paths, blocked, resolve).open());
  }
}
