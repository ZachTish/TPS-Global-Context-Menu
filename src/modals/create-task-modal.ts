import { App, ButtonComponent, Modal, Setting, TFile, TextComponent, ToggleComponent } from 'obsidian';
import { FileSuggestModal } from './FileSuggestModal';
import {
  buildCreatedTaskLine,
  parseCreateTaskInput,
  type ParsedCreateTaskInput,
} from '../utils/create-task-parser';

export interface CreateTaskModalResult {
  createTrackedRecord: boolean;
  parentMode: CreateTaskParentMode;
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

export type CreateTaskParentMode = 'standalone' | 'note';

export interface CreateTaskModalCopy {
  title: string;
  taskDescription: string;
  targetDescription: string;
  checkboxLabel: string;
  submitLabel: string;
}

export function resolveCreateTaskModalCopy(createTrackedRecord: boolean): CreateTaskModalCopy {
  return createTrackedRecord
    ? {
      title: 'Create task note',
      taskDescription: 'Creates a note-backed task. Natural language schedule text is parsed into its Scheduled field.',
      targetDescription: 'Standalone creates only the task note. Choose a parent note to place its stable link there.',
      checkboxLabel: 'Initial status',
      submitLabel: 'Create task note',
    }
    : {
      title: 'Create task',
      taskDescription: 'Natural language schedule text is parsed into the Scheduled field.',
      targetDescription: 'The containing note is the task parent.',
      checkboxLabel: 'Checkbox',
      submitLabel: 'Create task',
    };
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
  private parentMode: CreateTaskParentMode;
  private todayParentButton: ButtonComponent | null = null;
  private standaloneParentButton: ButtonComponent | null = null;
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
      defaultParentMode: CreateTaskParentMode;
      allowStandaloneParent: boolean;
      defaultTimeEstimate: number;
      checkboxOptions: readonly CreateTaskCheckboxOption[];
      defaultCheckboxMarker: string;
      createTrackedRecord: boolean;
      onSubmit: (result: CreateTaskModalResult) => void | Promise<void>;
    },
  ) {
    super(app);
    this.parentMode = options.allowStandaloneParent && options.defaultParentMode === 'standalone'
      ? 'standalone'
      : 'note';
    this.targetFile = this.parentMode === 'note' ? options.defaultTargetFile : null;
  }

  onOpen(): void {
    this.modalEl.addClass('mod-tps-gcm', 'tps-gcm-create-task-modal');
    const { contentEl } = this;
    const copy = resolveCreateTaskModalCopy(this.options.createTrackedRecord);
    contentEl.empty();
    contentEl.createEl('h2', { text: copy.title });

    new Setting(contentEl)
      .setName('Task')
      .setDesc(copy.taskDescription)
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

    const parentSetting = new Setting(contentEl)
      .setName(this.options.allowStandaloneParent ? 'Parent' : 'Write to')
      .setDesc(copy.targetDescription)
      .addButton((button) => {
        this.targetEl = button.buttonEl;
        this.renderTargetButton();
        button.setTooltip(this.options.allowStandaloneParent ? 'Choose parent note' : 'Choose containing note');
        button.onClick(() => {
          new FileSuggestModal(this.app, (file) => {
            this.parentMode = 'note';
            this.targetFile = file;
            this.renderTargetButton();
          }, { extensions: ['md'] }).open();
        });
      });
    parentSetting.settingEl.addClass('tps-gcm-create-task-parent');
    if (this.options.allowStandaloneParent) {
      parentSetting.addButton((button) => {
        this.todayParentButton = button;
        button
          .setButtonText('Today')
          .setTooltip("Use today's Daily Note as the parent")
          .onClick(() => {
            this.parentMode = 'note';
            this.targetFile = null;
            this.renderTargetButton();
          });
        this.renderTargetButton();
      });
      parentSetting.addButton((button) => {
        this.standaloneParentButton = button;
        button
          .setButtonText('Standalone')
          .setTooltip('Create without a parent note')
          .onClick(() => {
            this.parentMode = 'standalone';
            this.targetFile = null;
            this.renderTargetButton();
          });
        this.renderTargetButton();
      });
    }

    new Setting(contentEl)
      .setName(copy.checkboxLabel)
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
        button
          .setButtonText(copy.submitLabel)
          .setCta()
          .onClick(() => void this.submit());
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
    const standalone = this.options.allowStandaloneParent && this.parentMode === 'standalone';
    const today = this.options.allowStandaloneParent && this.parentMode === 'note' && !this.targetFile;
    this.targetEl.setText(standalone
      ? 'Choose parent note'
      : this.targetFile?.path || this.options.defaultTargetLabel || 'Today daily note');
    this.targetEl.setAttribute('aria-label', standalone
      ? 'Choose a parent note; current parent is Standalone'
      : `Choose parent note; current parent is ${this.targetFile?.path || this.options.defaultTargetLabel || 'Today daily note'}`);
    this.todayParentButton?.setDisabled(today);
    this.todayParentButton?.buttonEl.setAttribute('aria-pressed', String(today));
    this.standaloneParentButton?.setDisabled(standalone);
    this.standaloneParentButton?.buttonEl.setAttribute('aria-pressed', String(standalone));
  }

  private async submit(): Promise<void> {
    const taskLine = this.buildTaskLine();
    const checkboxMarker = this.checkboxInput?.value ?? '';
    const checkboxOption = this.options.checkboxOptions
      .find((option) => option.checkboxMarker === checkboxMarker);
    const result: CreateTaskModalResult = {
      createTrackedRecord: this.options.createTrackedRecord,
      parentMode: this.parentMode,
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
