import { App, Modal, Setting, TextComponent } from 'obsidian';

export class AddTagModal extends Modal {
    allTags: string[];
    onSubmit: (tag: string) => void;
    tag: string = '';
    title: string;
    settingName: string;
    placeholder: string;
    buttonText: string;

    constructor(
        app: App,
        allTags: string[],
        onSubmit: (tag: string) => void,
        options: { title?: string; settingName?: string; placeholder?: string; buttonText?: string } = {},
    ) {
        super(app);
        this.allTags = allTags;
        this.onSubmit = onSubmit;
        this.title = options.title || 'Add tag';
        this.settingName = options.settingName || 'Tag';
        this.placeholder = options.placeholder || 'tag1, tag2, tag3';
        this.buttonText = options.buttonText || 'Add';
    }

    onOpen() {
        this.modalEl.addClass('mod-tps-gcm');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: this.title });

        new Setting(contentEl).setName(this.settingName).addText((text) => {
            text.setPlaceholder(this.placeholder);
            const suggestions = Array.from(new Set(this.allTags.map((tag) => String(tag || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
            if (suggestions.length > 0) {
                const listId = `tps-gcm-add-tag-options-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const datalist = contentEl.createEl('datalist');
                datalist.id = listId;
                suggestions.slice(0, 300).forEach((tag) => {
                    datalist.createEl('option', { attr: { value: tag } });
                });
                text.inputEl.setAttr('list', listId);
            }
            // Fix for text input in modal: stop propagation
            text.inputEl.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    this.close();
                    this.onSubmit(this.tag);
                }
            });
            text.onChange((value) => {
                this.tag = value;
            });
            // Focus the input
            setTimeout(() => text.inputEl.focus(), 50);
        });

        new Setting(contentEl).addButton((btn) => {
            btn
                .setButtonText(this.buttonText)
                .setCta()
                .onClick(() => {
                    this.close();
                    this.onSubmit(this.tag);
                });
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
