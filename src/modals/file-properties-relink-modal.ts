import {
  FuzzySuggestModal,
  Modal,
  Notice,
  TFile,
} from 'obsidian';
import type { FuzzyMatch } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';
import type { FilePropertiesRelinkCandidate } from '../services/file-properties-service';

export function formatFilePropertiesRelinkSummary(candidate: FilePropertiesRelinkCandidate): string {
  if (candidate.propertyCount <= 0) return 'No user properties';
  const visible = candidate.propertyNames.join(', ');
  const remaining = Math.max(0, candidate.propertyCount - candidate.propertyNames.length);
  return remaining > 0 ? `${visible || 'Stored properties'} (+${remaining} more)` : visible;
}

/**
 * Opens the bounded retained-property relink flow for one live non-Markdown
 * target. The storage service revalidates identity and target collisions at
 * confirmation time; cancellation performs no mutation.
 */
export function promptFilePropertiesRelink(
  plugin: TPSGlobalContextMenuPlugin,
  target: TFile,
): void {
  const service = plugin.filePropertiesService;
  if (!service.isPropertyTarget(target)) {
    new Notice('TPS GCM: Choose a non-Markdown file to relink.');
    return;
  }

  const exact = service.getRelinkCandidate(target);
  if (!exact && service.hasCompanion(target)) {
    new Notice(`TPS GCM: ${target.name} already has an active properties note.`);
    return;
  }

  const candidates = service.listRelinkCandidates(target);
  if (candidates.length === 0) {
    new Notice('TPS GCM: No unique retained file properties are available to relink.');
    return;
  }

  const exactCandidate = exact
    ? candidates.find((candidate) => candidate.companionFile === exact) ?? null
    : null;
  if (exactCandidate && candidates.length === 1) {
    new FilePropertiesRelinkConfirmModal(plugin, target, exactCandidate).open();
    return;
  }

  new FilePropertiesRelinkSuggestModal(plugin, target, candidates).open();
}

export class FilePropertiesRelinkSuggestModal extends FuzzySuggestModal<FilePropertiesRelinkCandidate> {
  constructor(
    private readonly plugin: TPSGlobalContextMenuPlugin,
    private readonly target: TFile,
    private readonly candidates: readonly FilePropertiesRelinkCandidate[],
  ) {
    super(plugin.app);
    this.setPlaceholder('Choose retained file properties…');
    this.setInstructions([{ command: '↵', purpose: 'review and relink' }]);
    this.emptyStateText = 'No unique retained file properties are available.';
    this.limit = 200;
  }

  getItems(): FilePropertiesRelinkCandidate[] {
    return [...this.candidates];
  }

  getItemText(item: FilePropertiesRelinkCandidate): string {
    return `${item.sourcePath} ${item.pendingTargetPath || ''} ${item.propertyNames.join(' ')}`.trim();
  }

  renderSuggestion(match: FuzzyMatch<FilePropertiesRelinkCandidate>, el: HTMLElement): void {
    const candidate = match.item;
    el.createDiv({
      cls: 'tps-gcm-file-properties-relink-source',
      text: candidate.sourcePath,
    });
    el.createEl('small', {
      cls: 'tps-gcm-file-properties-relink-summary',
      text: formatFilePropertiesRelinkSummary(candidate),
    });
    if (candidate.pendingTargetPath) {
      el.createEl('small', {
        cls: 'tps-gcm-file-properties-relink-summary',
        text: `Pending Markdown merge: ${candidate.pendingTargetPath}`,
      });
    }
  }

  onChooseItem(candidate: FilePropertiesRelinkCandidate): void {
    new FilePropertiesRelinkConfirmModal(this.plugin, this.target, candidate).open();
  }
}

export class FilePropertiesRelinkConfirmModal extends Modal {
  private submitting = false;

  constructor(
    private readonly plugin: TPSGlobalContextMenuPlugin,
    private readonly target: TFile,
    private readonly candidate: FilePropertiesRelinkCandidate,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass('mod-tps-gcm');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Relink file properties?' });
    contentEl.createEl('p', {
      text: `Attach the retained properties from “${this.candidate.sourcePath}” to “${this.target.path}”?`,
    });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: formatFilePropertiesRelinkSummary(this.candidate),
    });
    if (this.candidate.pendingTargetPath) {
      contentEl.createEl('p', {
        cls: 'setting-item-description',
        text: `This retained record is waiting for an explicit merge into “${this.candidate.pendingTargetPath}”. Relinking it here will use this file instead.`,
      });
    }

    const actions = contentEl.createDiv({ cls: 'tps-gcm-confirm-buttons' });
    const exactPathReplacement = this.plugin.filePropertiesService.getRelinkCandidate(this.target)
      === this.candidate.companionFile;
    const startFreshButton = exactPathReplacement
      ? actions.createEl('button', { text: 'Start fresh' })
      : null;
    const cancelButton = actions.createEl('button', { text: 'Cancel' });
    const relinkButton = actions.createEl('button', { text: 'Relink', cls: 'mod-cta' });
    cancelButton.addEventListener('click', () => this.close());
    startFreshButton?.addEventListener('click', () => {
      if (this.submitting) return;
      this.submitting = true;
      startFreshButton.disabled = true;
      cancelButton.disabled = true;
      relinkButton.disabled = true;
      void this.plugin.filePropertiesService
        .startFreshCompanion(this.target)
        .then(() => {
          new Notice(`Created fresh file properties for ${this.target.name}; retained history was preserved.`);
          this.close();
        })
        .catch((error) => {
          logger.warn('[TPS GCM] Fresh file-property identity was rejected', {
            target: this.target.path,
            retainedCompanion: this.candidate.companionPath,
            error,
          });
          new Notice(`TPS GCM: Could not safely start fresh for ${this.target.name}.`);
          this.close();
        });
    });
    relinkButton.addEventListener('click', () => {
      if (this.submitting) return;
      this.submitting = true;
      if (startFreshButton) startFreshButton.disabled = true;
      cancelButton.disabled = true;
      relinkButton.disabled = true;
      void this.plugin.filePropertiesService
        .relinkCompanion(this.candidate.companionFile, this.target)
        .then(() => {
          new Notice(`Relinked retained properties to ${this.target.name}.`);
          this.close();
        })
        .catch((error) => {
          logger.warn('[TPS GCM] Retained file-property relink was rejected', {
            target: this.target.path,
            formerSource: this.candidate.sourcePath,
            companion: this.candidate.companionPath,
            error,
          });
          new Notice(`TPS GCM: Could not safely relink properties to ${this.target.name}.`);
          this.close();
        });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
