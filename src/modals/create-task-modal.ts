import { App, Modal, Setting, TFile, TextComponent, ToggleComponent } from 'obsidian';
import { FileSuggestModal } from './FileSuggestModal';
import {
  buildCreatedTaskLine,
  parseCreateTaskInput,
  type ParsedCreateTaskInput,
} from '../utils/create-task-parser';

export interface CreateTaskModalResult {
  title: string;
  targetFile: TFile | null;
  checkboxMarker: string;
  checkboxStatus: string;
  checkboxStatuses: string[];
  priority: string;
  scheduledValue: string;
  allDay: boolean;
  timeEstimate: number;
  taskLine: string;
}

export interface CreateTaskCheckboxOption {
  checkboxMarker: string;
  label: string;
  status: string;
  statuses: readonly string[];
}

export class CreateTaskModal extends Modal {
  private titleInput!: TextComponent;
  private scheduledInput!: TextComponent;
  private timeEstimateInput!: TextComponent;
  private allDayToggle!: ToggleComponent;
  private priorityInput!: HTMLSelectElement;
  private checkboxInput!: HTMLSelectElement;
  private targetFile: TFile | null;
  private parsed: ParsedCreateTaskInput = parseCreateTaskInput('');
  private previewEl!: HTMLElement;
  private taskLineEl!: HTMLElement;
  private scheduledHintEl!: HTMLElement;
  private targetEl!: HTMLElement;
  private lastAutoScheduledValue = '';

  constructor(
    app: App,
    private readonly options: {
      defaultTargetFile: TFile | null;
      defaultTargetLabel: string;
      defaultTimeEstimate: number;
      checkboxOptions: readonly CreateTaskCheckboxOption[];
      defaultCheckboxMarker: string;
      onSubmit: (result: CreateTaskModalResult) => void | Promise<void>;
    },
  ) {
    super(app);
    this.targetFile = options.defaultTargetFile;
  }

  onOpen(): void {
    this.modalEl.addClass('mod-tps-gcm', 'tps-gcm-create-task-modal');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Create task' });

    new Setting(contentEl)
      .setName('Task')
      .setDesc('Natural language schedule text is parsed into the Scheduled field.')
      .addText((text) => {
        this.titleInput = text;
        text.setPlaceholder('go for a run tomorrow at 5pm #health');
        text.inputEl.addClass('tps-gcm-create-task-title');
        text.inputEl.addEventListener('keydown', (evt) => {
          evt.stopPropagation();
          if (evt.key === 'Enter') {
            evt.preventDefault();
            void this.submit();
          }
        });
        text.onChange(() => this.reparseFromTitle());
      });

    const previewWrap = contentEl.createDiv({ cls: 'tps-gcm-create-task-preview-wrap' });
    previewWrap.createDiv({ cls: 'tps-gcm-create-task-label', text: 'Detected schedule' });
    this.previewEl = previewWrap.createDiv({ cls: 'tps-gcm-create-task-detected' });
    this.scheduledHintEl = previewWrap.createDiv({ cls: 'tps-gcm-create-task-scheduled-hint' });

    new Setting(contentEl)
      .setName('Write to')
      .setDesc('The containing note is the task parent.')
      .addButton((button) => {
        this.targetEl = button.buttonEl;
        this.renderTargetButton();
        button.onClick(() => {
          new FileSuggestModal(this.app, (file) => {
            this.targetFile = file;
            this.renderTargetButton();
          }, { extensions: ['md'] }).open();
        });
      });

    new Setting(contentEl)
      .setName('Checkbox')
      .addDropdown((dropdown) => {
        this.checkboxInput = dropdown.selectEl;
        for (const option of this.options.checkboxOptions) {
          dropdown.addOption(option.checkboxMarker, option.label);
        }
        dropdown.setValue(this.options.defaultCheckboxMarker);
        dropdown.onChange(() => this.updateTaskLinePreview());
      });

    new Setting(contentEl)
      .setName('Priority')
      .addDropdown((dropdown) => {
        this.priorityInput = dropdown.selectEl;
        dropdown
          .addOption('', 'None')
          .addOption('low', 'Low')
          .addOption('normal', 'Normal')
          .addOption('medium', 'Medium')
          .addOption('high', 'High');
        dropdown.onChange(() => this.updateTaskLinePreview());
      });

    new Setting(contentEl)
      .setName('Scheduled')
      .addText((text) => {
        this.scheduledInput = text;
        text.setPlaceholder('YYYY-MM-DD HH:mm:ss');
        text.inputEl.addEventListener('keydown', (evt) => evt.stopPropagation());
        text.onChange(() => this.updateTaskLinePreview());
      });

    new Setting(contentEl)
      .setName('All day')
      .addToggle((toggle) => {
        this.allDayToggle = toggle;
        toggle.setValue(false);
        toggle.onChange(() => this.updateTaskLinePreview());
      });

    new Setting(contentEl)
      .setName('Time estimate')
      .setDesc('Minutes; only written for timed tasks.')
      .addText((text) => {
        this.timeEstimateInput = text;
        text.inputEl.type = 'number';
        text.setValue(String(this.options.defaultTimeEstimate || 30));
        text.inputEl.addEventListener('keydown', (evt) => evt.stopPropagation());
        text.onChange(() => this.updateTaskLinePreview());
      });

    const taskLineWrap = contentEl.createDiv({ cls: 'tps-gcm-create-task-line-wrap' });
    taskLineWrap.createDiv({ cls: 'tps-gcm-create-task-label', text: 'Task line' });
    this.taskLineEl = taskLineWrap.createDiv({ cls: 'tps-gcm-create-task-line' });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => this.close());
      })
      .addButton((button) => {
        button.setButtonText('Create task').setCta().onClick(() => void this.submit());
      });

    this.reparseFromTitle();
    setTimeout(() => this.titleInput?.inputEl.focus(), 50);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private reparseFromTitle(): void {
    const previousScheduled = this.scheduledInput?.getValue?.() || '';
    this.parsed = parseCreateTaskInput(this.titleInput?.getValue?.() || '');
    if (this.parsed.scheduledValue && (!previousScheduled || previousScheduled === this.lastAutoScheduledValue)) {
      this.scheduledInput?.setValue(this.parsed.scheduledValue);
      this.allDayToggle?.setValue(this.parsed.allDay);
      this.lastAutoScheduledValue = this.parsed.scheduledValue;
    } else if (!this.parsed.scheduledValue && (!previousScheduled || previousScheduled === this.lastAutoScheduledValue)) {
      this.scheduledInput?.setValue('');
      this.allDayToggle?.setValue(false);
      this.lastAutoScheduledValue = '';
    }
    this.renderDetectedPreview();
    this.updateTaskLinePreview();
  }

  private renderDetectedPreview(): void {
    if (!this.previewEl || !this.scheduledHintEl) return;
    this.previewEl.empty();
    const raw = this.parsed.rawInput;
    if (this.parsed.detectedDateStart >= 0 && this.parsed.detectedDateEnd > this.parsed.detectedDateStart) {
      this.previewEl.appendText(raw.slice(0, this.parsed.detectedDateStart));
      this.previewEl.createEl('mark', { text: raw.slice(this.parsed.detectedDateStart, this.parsed.detectedDateEnd) });
      this.previewEl.appendText(raw.slice(this.parsed.detectedDateEnd));
      this.scheduledHintEl.setText(`Scheduled: ${this.parsed.scheduledValue}`);
    } else {
      this.previewEl.setText(raw || 'No schedule phrase detected');
      this.scheduledHintEl.setText('Scheduled: not set');
    }
  }

  private updateTaskLinePreview(): void {
    if (!this.taskLineEl) return;
    this.taskLineEl.setText(this.buildTaskLine());
  }

  private buildTaskLine(): string {
    return buildCreatedTaskLine({
      title: this.parsed.title || this.titleInput?.getValue?.() || '',
      checkboxMarker: this.checkboxInput?.value ?? '',
      priority: this.priorityInput?.value || '',
      scheduledValue: this.scheduledInput?.getValue?.() || '',
      allDay: this.allDayToggle?.getValue?.() || false,
      timeEstimate: Number(this.timeEstimateInput?.getValue?.() || 0),
    });
  }

  private renderTargetButton(): void {
    if (!this.targetEl) return;
    this.targetEl.setText(this.targetFile?.path || this.options.defaultTargetLabel || 'Today daily note');
  }

  private async submit(): Promise<void> {
    const taskLine = this.buildTaskLine();
    const checkboxMarker = this.checkboxInput?.value ?? '';
    const checkboxOption = this.options.checkboxOptions
      .find((option) => option.checkboxMarker === checkboxMarker);
    const result: CreateTaskModalResult = {
      title: this.parsed.title || this.titleInput?.getValue?.() || 'Untitled task',
      targetFile: this.targetFile,
      checkboxMarker,
      checkboxStatus: checkboxOption?.status ?? '',
      checkboxStatuses: [...(checkboxOption?.statuses ?? [])],
      priority: this.priorityInput?.value || '',
      scheduledValue: this.scheduledInput?.getValue?.() || '',
      allDay: this.allDayToggle?.getValue?.() || false,
      timeEstimate: Number(this.timeEstimateInput?.getValue?.() || 0),
      taskLine,
    };
    this.close();
    await this.options.onSubmit(result);
  }
}
