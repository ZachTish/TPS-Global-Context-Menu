import { App, Modal, Notice, Setting, TextComponent } from 'obsidian';
import * as logger from '../logger';

export class TextInputModal extends Modal {
    label: string;
    initialValue: string;
    onSubmit: (value: string) => void | Promise<void>;
    value: string = '';
    private submitting = false;
    private readonly suggestions: string[];

    constructor(app: App, label: string, initialValue: string, onSubmit: (value: string) => void | Promise<void>, options: { suggestions?: readonly string[] } = {}) {
        super(app);
        this.label = label;
        this.initialValue = initialValue || '';
        this.value = this.initialValue;
        this.onSubmit = onSubmit;
        const identities = new Set<string>();
        this.suggestions = (options.suggestions ?? []).map(value => String(value || '').trim()).filter(value => {
            const identity = value.toLocaleLowerCase();
            if (!identity || identities.has(identity)) return false;
            identities.add(identity);
            return true;
        }).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
    }

    onOpen() {
        this.modalEl.addClass('mod-tps-gcm');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: `Edit ${this.label}` });

        const suggestionEl = contentEl.createDiv({ cls: 'tps-gcm-text-input-suggestions' });
        let textComponent: TextComponent | null = null;
        const renderSuggestions = (query: string) => {
            suggestionEl.empty();
            const normalizedQuery = query.trim().replace(/^#/u, '').toLocaleLowerCase();
            const matches = this.suggestions.filter(value => !normalizedQuery || value.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 12);
            suggestionEl.hidden = matches.length === 0;
            matches.forEach(value => {
                const option = suggestionEl.createEl('button', { cls: 'tps-gcm-text-input-suggestion', text: `#${value}`, attr: { type: 'button' } });
                option.addEventListener('pointerdown', event => event.preventDefault());
                option.addEventListener('click', () => {
                    textComponent?.setValue(value);
                    this.value = value;
                    suggestionEl.hidden = true;
                    textComponent?.inputEl.focus();
                });
            });
        };

        new Setting(contentEl).setName(this.label).addText((text) => {
            textComponent = text;
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
                renderSuggestions(value);
            });
            text.inputEl.addEventListener('focus', () => renderSuggestions(this.value));
            renderSuggestions(this.initialValue);
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
