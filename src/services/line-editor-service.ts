import { Modal, Notice, TFile, setIcon } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { createLineRangeSnapshot, resolveLineRange, replaceLineRangeIfUnchanged } from './line-editor-core';
import { CaptureMarkdownEditor } from './line-editor-markdown-editor';
import { parseTaskLine, preserveTpsInlinePropsMetadata, stripTaskInlinePropsMetadata } from '../utils/task-line-metadata';
import { MAX_BASE_LINE_SOURCE_BYTES, isWithinUtf8ByteLimit, resolveUniqueBaseLineFingerprint, sha256BaseLine } from './base-line-edit-protocol-core';
import { ensureTaskHistoryIdentity, getTaskHistoryIdentity } from './item-history-core';
import { abortDirectTaskHistory, beginDirectTaskHistory, commitDirectTaskHistory, ensureDirectTaskHistoryIdentity, type DirectTaskHistoryAction, type DirectTaskHistoryHandle, type DirectTaskHistoryLogContext } from '../utils/direct-task-history';
import * as logger from '../logger';

interface LineEditorOptions { expectedFingerprint?: string; redactDiagnostics?: boolean; }

export function classifyLineHistoryAction(
  beforeRawLine: string,
  nextRawLine: string,
): DirectTaskHistoryAction | null {
  if (beforeRawLine === nextRawLine) return null;
  const beforeTask = parseTaskLine(beforeRawLine) !== null;
  const nextTask = parseTaskLine(nextRawLine) !== null;
  if (beforeTask && nextTask) return 'task.update';
  if (beforeTask) return 'task.delete';
  if (nextTask) return 'task.create';
  return null;
}

export class LineEditorService {
  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  async openLineEditor(
    file: TFile,
    zeroBasedLine: number,
    options: LineEditorOptions = {},
  ): Promise<boolean> {
    if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') return false;
    const content = await this.plugin.app.vault.read(file);
    const range = resolveLineRange(content, zeroBasedLine);
    if (!range) {
      logger.flowWarn('LineEditor', 'line-editor:unresolved', this.getLineEditorDiagnostics(file, zeroBasedLine, options));
      new Notice('Could not resolve the selected line.');
      return false;
    }
    const expectedFingerprint = String(options.expectedFingerprint || '');
    if (expectedFingerprint) {
      if (!isWithinUtf8ByteLimit(content, MAX_BASE_LINE_SOURCE_BYTES)) {
        logger.flowWarn('LineEditor', 'line-editor:source-too-large', this.getLineEditorDiagnostics(file, zeroBasedLine, options));
        new Notice('The selected note is too large to open safely from a widget.', 8000);
        return false;
      }
      const actualFingerprint = await sha256BaseLine(content.slice(range.from, range.to), zeroBasedLine === 0);
      if (!/^[0-9a-f]{64}$/u.test(expectedFingerprint) || actualFingerprint !== expectedFingerprint) {
        logger.flowWarn('LineEditor', 'line-editor:digest-conflict', this.getLineEditorDiagnostics(file, zeroBasedLine, options));
        new Notice('The selected line changed. Refresh the widget and try again.', 8000);
        return false;
      }
    }
    const snapshot = createLineRangeSnapshot(content, range.from, range.to);
    logger.flow('LineEditor', 'line-editor:open', this.getLineEditorDiagnostics(file, zeroBasedLine, options));
    return new LineEditModal(
      this.plugin,
      file,
      zeroBasedLine,
      snapshot,
      expectedFingerprint || null,
      options.redactDiagnostics === true,
    ).openAndWait();
  }

  private getLineEditorDiagnostics(
    file: TFile,
    zeroBasedLine: number,
    options: LineEditorOptions,
  ): Record<string, unknown> {
    return options.redactDiagnostics === true
      ? { route: 'external-base-line' }
      : { path: file.path, line: zeroBasedLine + 1 };
  }

}

class LineEditModal extends Modal {
  private resolveResult: ((saved: boolean) => void) | null = null;
  private saved = false;
  private markdownEditor: CaptureMarkdownEditor | null = null;

  constructor(
    private readonly plugin: TPSGlobalContextMenuPlugin,
    private readonly file: TFile,
    private readonly zeroBasedLine: number,
    private readonly snapshot: { prefix: string; value: string; suffix: string },
    private readonly expectedFingerprint: string | null,
    private readonly redactDiagnostics: boolean,
  ) {
    super(plugin.app);
  }

  openAndWait(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveResult = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass('mod-tps-gcm', 'tps-gcm-line-capture-modal', 'tps-gcm-line-line-edit-modal', 'tps-keyboard-aware-modal');
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Edit line' });
    contentEl.createDiv({
      cls: 'tps-gcm-line-context-capture-target',
      text: `${this.file.basename} · line ${this.zeroBasedLine + 1}`,
    });
    const editorHost = contentEl.createDiv({ cls: 'tps-gcm-line-context-capture-live-editor' });
    const actions = contentEl.createDiv({ cls: 'tps-gcm-line-context-capture-actions' });
    const saveButton = actions.createEl('button', { cls: 'mod-cta', attr: { type: 'button' } });
    setIcon(saveButton, 'save');
    saveButton.createSpan({ text: 'Save changes' });
    const cancelButton = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });

    let value = stripTaskInlinePropsMetadata(this.snapshot.value);
    let hasContent = true;
    let saving = false;
    const update = () => {
      saveButton.disabled = saving || !hasContent || /[\r\n]/.test(value);
    };
    const save = async () => {
      if (saveButton.disabled || saving) return;
      let replacement = preserveTpsInlinePropsMetadata(this.snapshot.value, value.trim());
      if (!replacement || /[\r\n]/.test(replacement)) {
        new Notice('Line editing supports one non-empty line.');
        return;
      }
      saving = true;
      update();
      if (this.expectedFingerprint) {
        try {
          const current = await this.plugin.app.vault.read(this.file);
          if (!isWithinUtf8ByteLimit(current, MAX_BASE_LINE_SOURCE_BYTES)) {
            saving = false;
            update();
            logger.flowWarn('LineEditor', 'line-editor:source-too-large', this.getDiagnostics());
            new Notice('The selected note is too large to edit safely from a widget.', 8000);
            return;
          }
          const resolution = await resolveUniqueBaseLineFingerprint(
            current,
            this.expectedFingerprint,
            this.zeroBasedLine + 1,
          );
          if (resolution.status !== 'unique') {
            saving = false;
            update();
            logger.flowWarn('LineEditor', 'line-editor:digest-conflict', this.getDiagnostics());
            new Notice('The selected line changed. Refresh the widget and try again.', 8000);
            return;
          }
        } catch (error) {
          saving = false;
          update();
          if (this.redactDiagnostics) {
            logger.flowWarn('LineEditor', 'line-editor:digest-check-failed', {
              ...this.getDiagnostics(),
              reason: 'digest-check-failed',
            });
          } else {
            logger.flowError('LineEditor', 'line-editor:digest-check-failed', error, this.getDiagnostics());
          }
          new Notice('The selected line could not be rechecked. Nothing was changed.', 8000);
          return;
        }
      }
      const historyAction = classifyLineHistoryAction(this.snapshot.value, replacement);
      const historyContext: DirectTaskHistoryLogContext | null = historyAction
        ? {
            action: historyAction,
            surface: 'line-editor',
            path: this.file.path,
            lineNumber: this.zeroBasedLine,
          }
        : null;
      let historyHandle: DirectTaskHistoryHandle | null = null;
      if (historyAction && historyContext) {
        const historyBefore = historyAction === 'task.create' ? replacement : this.snapshot.value;
        historyHandle = await beginDirectTaskHistory(this.plugin.itemHistoryService, {
          action: historyAction,
          cause: {
            kind: 'user',
            sourcePluginId: 'tps-global-context-menu',
            surface: historyContext.surface,
          },
          before: {
            path: this.file.path,
            lineNumber: this.zeroBasedLine,
            rawLine: historyBefore,
          },
        });
        if (historyAction !== 'task.delete') {
          const ensured = ensureDirectTaskHistoryIdentity(
            this.plugin.itemHistoryService,
            historyHandle,
            replacement,
            historyContext,
          );
          if (ensured.ready) {
            replacement = ensured.line;
          } else {
            await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
            historyHandle = null;
          }
        }
      }
      let changed = false;
      let processed = '';
      try {
        processed = await this.plugin.app.vault.process(this.file, (current) => {
          const next = replaceLineRangeIfUnchanged(current, this.snapshot, [this.snapshot.value], replacement);
          if (next == null) return current;
          changed = next !== current;
          return next;
        });
      } catch (error) {
        if (historyContext) {
          await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
        }
        saving = false;
        update();
        logger.flowError('LineEditor', 'line-editor:write-failed', error, this.getDiagnostics());
        new Notice('The selected line could not be saved. Nothing was changed.', 8000);
        return;
      }
      if (!changed) {
        if (historyContext) {
          await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
        }
        saving = false;
        update();
        logger.flowWarn('LineEditor', 'line-editor:conflict', this.getDiagnostics());
        new Notice('The line changed outside the editor. Refresh the view and try again.', 8000);
        return;
      }
      if (historyAction && historyContext && historyHandle) {
        if (historyAction === 'task.delete') {
          await commitDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, {
            outcome: 'committed',
          }, historyContext);
        } else {
          const persistedLine = String(processed || '').split(/\r?\n/u)[this.zeroBasedLine] || '';
          const expectedIdentity = getTaskHistoryIdentity(replacement);
          let confirmed = persistedLine === replacement
            && parseTaskLine(persistedLine) !== null
            && expectedIdentity.length > 0
            && getTaskHistoryIdentity(persistedLine) === expectedIdentity;
          if (confirmed) {
            try {
              ensureTaskHistoryIdentity(persistedLine, expectedIdentity);
            } catch {
              confirmed = false;
            }
          }
          if (confirmed) {
            await commitDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, {
              after: {
                path: this.file.path,
                lineNumber: this.zeroBasedLine,
                rawLine: persistedLine,
              },
              ...(historyAction === 'task.update' ? { sourceDisposition: 'retained' as const } : {}),
              outcome: 'committed',
            }, historyContext);
          } else {
            await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
          }
        }
      }
      this.plugin.eventService.emitFilesUpdated([this.file.path]);
      this.plugin.overlayRenderingService?.invalidate({
        reason: 'line-editor-save',
        file: this.file,
        surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
        rebuildInlineSubitems: true,
        refreshLivePreviewEditors: true,
        delayMs: 80,
      });
      logger.flow('LineEditor', 'line-editor:saved', this.getDiagnostics());
      this.saved = true;
      this.close();
    };

    this.markdownEditor = new CaptureMarkdownEditor({
      parentEl: editorHost,
      initialValue: stripTaskInlinePropsMetadata(this.snapshot.value),
      onChange: (markdown, nextHasContent) => {
        value = markdown;
        hasContent = nextHasContent;
        update();
      },
      onSubmit: () => void save(),
    });
    saveButton.addEventListener('click', () => void save());
    cancelButton.addEventListener('click', () => this.close());
    update();
    window.requestAnimationFrame(() => this.markdownEditor?.focus());
  }

  private getDiagnostics(): Record<string, unknown> {
    return this.redactDiagnostics
      ? { route: 'external-base-line' }
      : { path: this.file.path, line: this.zeroBasedLine + 1 };
  }

  onClose(): void {
    this.markdownEditor?.destroy();
    this.markdownEditor = null;
    this.contentEl.empty();
    this.resolveResult?.(this.saved);
    this.resolveResult = null;
  }
}
