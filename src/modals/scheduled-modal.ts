import { App, Modal, Notice, Setting, ToggleComponent, TextComponent } from 'obsidian';
import * as logger from '../logger';

export interface ScheduledResult {
    date: string;
    timeEstimate: number;
    allDay: boolean;
}

export interface ScheduledModalOptions {
    title?: string;
    fieldLabel?: string;
    showTimeDetails?: boolean;
}

export class ScheduledModal extends Modal {
    currentDate: string;
    currentTimeEstimate: number;
    currentAllDay: boolean;
    onSubmit: (result: ScheduledResult) => void | Promise<void>;
    private readonly options: Required<ScheduledModalOptions>;
    private submitting = false;

    // UI Elements
    dateComponent?: TextComponent;
    timeEstimateComponent?: TextComponent;
    endTimeComponent?: TextComponent;
    allDayToggle?: ToggleComponent;

    constructor(
        app: App,
        currentDate: string,
        currentTimeEstimate: number,
        currentAllDay: boolean,
        onSubmit: (result: ScheduledResult) => void | Promise<void>,
        options: ScheduledModalOptions = {},
    ) {
        super(app);
        this.currentDate = currentDate;
        this.currentTimeEstimate = currentTimeEstimate || 0;
        this.currentAllDay = currentAllDay || false;
        this.onSubmit = onSubmit;
        this.options = {
            title: String(options.title || 'Set Scheduled Date'),
            fieldLabel: String(options.fieldLabel || 'Scheduled'),
            showTimeDetails: options.showTimeDetails !== false,
        };
    }

    onOpen() {
        this.modalEl.addClass('mod-tps-gcm');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: this.options.title });

        // Normalize stored frontmatter dates to datetime-local input shape.
        let initialDate = this.currentDate;
        if (/^\d{4}-\d{2}-\d{2}$/.test(initialDate)) {
            initialDate = `${initialDate}T00:00`;
        } else if (/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}/.test(initialDate)) {
            initialDate = initialDate.replace(' ', 'T').slice(0, 16);
        } else if (/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}/.test(initialDate)) {
            initialDate = initialDate.slice(0, 16);
        }

        // 1. Scheduled Date Input
        new Setting(contentEl)
            .setName(this.options.fieldLabel)
            .addText((text) => {
                text.inputEl.type = 'datetime-local';
                text.setValue(initialDate);
                this.dateComponent = text;

                text.inputEl.addEventListener('input', () => this.recalculateEndTime());
                text.inputEl.addEventListener('click', e => e.stopPropagation());
                text.inputEl.addEventListener('keydown', e => e.stopPropagation());
            });

        if (this.options.showTimeDetails) {
            // 2. All Day Toggle
            new Setting(contentEl)
                .setName('All Day')
                .addToggle((toggle) => {
                    toggle.setValue(this.currentAllDay);
                    this.allDayToggle = toggle;
                });

            // 3. Time Estimate (Minutes)
            new Setting(contentEl)
                .setName('Time Estimate (minutes)')
                .addText((text) => {
                    text.inputEl.type = 'number';
                    text.setValue(String(this.currentTimeEstimate));
                    this.timeEstimateComponent = text;

                    text.inputEl.addEventListener('input', () => this.recalculateEndTime());
                    text.inputEl.addEventListener('click', e => e.stopPropagation());
                    text.inputEl.addEventListener('keydown', e => e.stopPropagation());
                });

            // 4. End Time (Computed / Editable)
            new Setting(contentEl)
                .setName('End Time')
                .setDesc('Modifying this updates Time Estimate')
                .addText((text) => {
                    text.inputEl.type = 'datetime-local';
                    this.endTimeComponent = text;

                    text.inputEl.addEventListener('input', () => this.recalculateTimeEstimate());
                    text.inputEl.addEventListener('click', e => e.stopPropagation());
                    text.inputEl.addEventListener('keydown', e => e.stopPropagation());
                });

            this.recalculateEndTime();
        }

        // Footer Actions
        const footer = contentEl.createDiv('tps-gcm-modal-footer');
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.gap = '8px';
        footer.style.marginTop = '16px';

        const clearBtn = footer.createEl('button', { text: 'Clear' });
        clearBtn.classList.add('mod-warning');
        clearBtn.addEventListener('click', () => {
            void this.submit({ date: '', timeEstimate: 0, allDay: false }, [clearBtn, saveBtn]);
        });

        const saveBtn = footer.createEl('button', { text: 'Save' });
        saveBtn.classList.add('mod-cta');
        saveBtn.addEventListener('click', () => {
            // Normalize datetime-local format to the Obsidian Bases-compatible datetime string.
            let dateValue = this.dateComponent?.getValue() || '';
            if (dateValue) {
                // Ensure seconds are present
                if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateValue)) {
                    dateValue += ':00';
                }
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
                    dateValue += ' 00:00:00';
                } else {
                    dateValue = dateValue.replace('T', ' ');
                }
            }
            void this.submit({
                date: dateValue,
                timeEstimate: parseInt(this.timeEstimateComponent?.getValue() || String(this.currentTimeEstimate), 10) || 0,
                allDay: this.allDayToggle?.getValue() ?? this.currentAllDay,
            }, [clearBtn, saveBtn]);
        });
    }

    private async submit(result: ScheduledResult, buttons: HTMLButtonElement[]): Promise<void> {
        if (this.submitting) return;
        this.submitting = true;
        buttons.forEach((button) => { button.disabled = true; });
        try {
            await this.onSubmit(result);
            this.close();
        } catch (error) {
            logger.flowError('ScheduledModal', 'submit:failed', error, {
                fieldLabel: this.options.fieldLabel,
                hasValue: Boolean(result.date),
            });
            new Notice(`Could not update ${this.options.fieldLabel.toLowerCase()}.`);
            this.submitting = false;
            buttons.forEach((button) => { button.disabled = false; });
        }
    }

    recalculateEndTime() {
        if (!this.dateComponent || !this.timeEstimateComponent || !this.endTimeComponent) return;

        const startDateStr = this.dateComponent.getValue();
        const minutes = parseInt(this.timeEstimateComponent.getValue()) || 0;

        if (!startDateStr) {
            this.endTimeComponent.setValue('');
            return;
        }

        const startDate = new Date(startDateStr);
        if (isNaN(startDate.getTime())) return;

        const endDate = new Date(startDate.getTime() + minutes * 60000);

        // Format for datetime-local: YYYY-MM-DDTHH:mm (Local Time)
        // toISOString() gives UTC. We need to adjust for timezone offset to get "Local ISO".
        const offsetMs = endDate.getTimezoneOffset() * 60000;
        const localDate = new Date(endDate.getTime() - offsetMs);
        const iso = localDate.toISOString().substring(0, 16);

        this.endTimeComponent.setValue(iso);
    }

    recalculateTimeEstimate() {
        if (!this.dateComponent || !this.timeEstimateComponent || !this.endTimeComponent) return;

        const startDateStr = this.dateComponent.getValue();
        const endDateStr = this.endTimeComponent.getValue();

        if (!startDateStr || !endDateStr) return;

        const startDate = new Date(startDateStr);
        const endDate = new Date(endDateStr);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return;

        const diffMs = endDate.getTime() - startDate.getTime();
        const diffMins = Math.round(diffMs / 60000);

        if (diffMins >= 0) {
            this.timeEstimateComponent.setValue(String(diffMins));
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
