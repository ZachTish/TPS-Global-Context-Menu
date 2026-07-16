import { App, Modal, Notice, Setting } from 'obsidian';
import * as logger from '../logger';

export class TextInputModal extends Modal {
    label: string;
    initialValue: string;
    onSubmit: (value: string) => void | Promise<void>;
    value: string = '';
    private submitting = false;

    constructor(app: App, label: string, initialValue: string, onSubmit: (value: string) => void | Promise<void>) {
        super(app);
        this.label = label;
        this.initialValue = initialValue || '';
        this.value = this.initialValue;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        this.modalEl.addClass('mod-tps-gcm');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: `Edit ${this.label}` });

        new Setting(contentEl).setName(this.label).addText((text) => {
            text.setValue(this.initialValue);
            text.setPlaceholder(`Enter ${this.label}...`);
            // Stop propagation to prevent menu from closing
            text.inputEl.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.preventDefault();
                    void this.submit();
                }
            });
            text.onChange((value) => {
                this.value = value;
            });
            // Focus the input
            setTimeout(() => text.inputEl.focus(), 50);
        });

        new Setting(contentEl).addButton((btn) => {
            btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    void this.submit();
                });
        }).addButton((btn) => {
            btn
                .setButtonText('Cancel')
                .onClick(() => {
                    this.close();
                });
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    private async submit(): Promise<void> {
        if (this.submitting) return;
        this.submitting = true;
        const value = this.value;
        this.close();
        try {
            await this.onSubmit(value);
        } catch (error) {
            logger.flowError('TextInputModal', 'submit:failed', error, { label: this.label });
            new Notice(`Could not save ${this.label}.`);
        } finally {
            this.submitting = false;
        }
    }
}
