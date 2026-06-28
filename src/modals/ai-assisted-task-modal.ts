import { App, Modal, Notice, Setting } from 'obsidian';
import type { AiAssistedTaskService, AiTaskCreationProposal } from '../services/ai-assisted-task-service';

export class AiAssistedTaskModal extends Modal {
  private inputEl!: HTMLTextAreaElement;
  private followUpEl?: HTMLTextAreaElement;
  private statusEl!: HTMLElement;
  private proposalEl!: HTMLElement;
  private proposal: AiTaskCreationProposal | null = null;
  private followUpMessages: string[] = [];
  private lastInputValue = '';
  private lastFollowUpValue = '';

  constructor(app: App, private readonly service: AiAssistedTaskService) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('mod-tps-gcm', 'tps-gcm-ai-task-modal');
    this.render();
    setTimeout(() => this.inputEl?.focus(), 50);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'AI assisted task creator' });

    const requestSetting = new Setting(contentEl)
      .setName('Request')
      .setDesc('Describe the task and where it should go.');
    this.inputEl = requestSetting.controlEl.createEl('textarea', {
      cls: 'tps-gcm-ai-task-input',
      attr: {
        rows: '4',
      },
    });
    this.inputEl.addEventListener('keydown', (evt) => {
      evt.stopPropagation();
      if ((evt.metaKey || evt.ctrlKey) && evt.key === 'Enter') {
        evt.preventDefault();
        void this.generateProposal();
      }
    });
    this.inputEl.addEventListener('input', () => {
      this.lastInputValue = this.readElementText(this.inputEl);
    });
    this.inputEl.addEventListener('change', () => {
      this.lastInputValue = this.readElementText(this.inputEl);
    });

    this.statusEl = contentEl.createDiv({ cls: 'tps-gcm-ai-task-status' });
    this.proposalEl = contentEl.createDiv({ cls: 'tps-gcm-ai-task-proposal' });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => this.close());
      })
      .addButton((button) => {
        button.setButtonText('Generate proposal').setCta().onClick(() => void this.generateProposal());
      });
  }

  private renderProposal(): void {
    if (!this.proposalEl) return;
    this.proposalEl.empty();
    if (!this.proposal) return;

    const taskLine = this.service.buildTaskLine(this.proposal);
    this.proposalEl.createEl('h3', { text: 'Proposed change' });
    const summary = this.proposalEl.createDiv({ cls: 'tps-gcm-ai-task-summary' });
    summary.createDiv({ text: `Write to: ${this.proposal.targetFilePath}` });
    summary.createDiv({
      text: this.proposal.insertionStrategy === 'under_heading' && this.proposal.heading
        ? `Place under heading: ${this.proposal.heading}`
        : 'Place after frontmatter',
    });
    summary.createDiv({ text: `Confidence: ${Math.round(this.proposal.confidence * 100)}%` });

    const lineWrap = this.proposalEl.createDiv({ cls: 'tps-gcm-ai-task-line-wrap' });
    lineWrap.createDiv({ cls: 'tps-gcm-create-task-label', text: 'Task line' });
    lineWrap.createDiv({ cls: 'tps-gcm-create-task-line', text: taskLine });

    if (this.proposal.rationale) {
      this.proposalEl.createDiv({ cls: 'tps-gcm-ai-task-rationale', text: this.proposal.rationale });
    }
    if (this.proposal.warnings.length) {
      const warnings = this.proposalEl.createDiv({ cls: 'tps-gcm-ai-task-warnings' });
      warnings.createDiv({ text: 'Warnings' });
      for (const warning of this.proposal.warnings) warnings.createDiv({ text: warning });
    }

    const followUpSetting = new Setting(this.proposalEl)
      .setName('Follow-up')
      .setDesc('Add a short correction and regenerate the proposal.');
    this.followUpEl = followUpSetting.controlEl.createEl('textarea', {
      cls: 'tps-gcm-ai-task-follow-up',
      attr: {
        rows: '3',
      },
    });
    this.followUpEl.addEventListener('keydown', (evt) => evt.stopPropagation());
    this.followUpEl.addEventListener('input', () => {
      this.lastFollowUpValue = this.readElementText(this.followUpEl);
    });
    this.followUpEl.addEventListener('change', () => {
      this.lastFollowUpValue = this.readElementText(this.followUpEl);
    });

    new Setting(this.proposalEl)
      .addButton((button) => {
        button.setButtonText('Add follow-up message').onClick(() => void this.addFollowUp());
      })
      .addButton((button) => {
        button.setButtonText('Accept').setCta().onClick(() => void this.acceptProposal());
      });
  }

  private async generateProposal(): Promise<void> {
    const input = this.readTextAreaValue(this.inputEl, this.lastInputValue);
    this.setStatus('Asking model for a task proposal...');
    try {
      this.proposal = await this.service.propose(input, this.followUpMessages, this.proposal);
      this.setStatus('Review the proposed change before applying it.');
      this.renderProposal();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(`Task proposal failed: ${message}`);
      new Notice(`AI task proposal failed: ${message}`);
    }
  }

  private async addFollowUp(): Promise<void> {
    const followUp = this.readTextAreaValue(this.followUpEl, this.lastFollowUpValue).trim();
    if (!followUp) {
      new Notice('Add a follow-up message first.');
      return;
    }
    this.followUpMessages.push(followUp);
    this.lastFollowUpValue = '';
    if (this.followUpEl) this.followUpEl.value = '';
    await this.generateProposal();
  }

  private async acceptProposal(): Promise<void> {
    if (!this.proposal) return;
    const created = await this.service.accept(this.proposal);
    if (created) this.close();
  }

  private setStatus(text: string): void {
    if (!this.statusEl) return;
    this.statusEl.setText(text);
  }

  private readTextAreaValue(element: HTMLTextAreaElement | undefined, cachedValue: string): string {
    const direct = this.readElementText(element);
    return direct.trim() ? direct : String(cachedValue || '');
  }

  private readElementText(element: HTMLTextAreaElement | undefined): string {
    if (!element) return '';
    return String(element.value || element.textContent || element.getAttribute('value') || '');
  }
}
