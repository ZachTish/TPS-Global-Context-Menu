import { Component, MarkdownRenderer, Modal, Notice, TFile, normalizePath, setIcon } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import type { HomeActionContext } from '../types';
import {
  createHomeCaptureRangeSnapshot,
  formatHomeCaptureBlock,
  insertHomeCaptureBlock,
  insertHomeCaptureBlockUnderHeading,
  listHomeCaptureHeadings,
  replaceHomeCaptureRangeIfUnchanged,
  resolveHomeCaptureLineRange,
  type HomeCaptureHeadingTarget,
} from './home-capture-block';
import { CaptureMarkdownEditor } from './home-capture-markdown-editor';
import { formatCaptureMarkdownForWrite } from './home-capture-markdown-core';
import { formatFileWikilink } from '../utils/list-utils';
import {
  parseTaskLine,
  preserveTpsInlinePropsMetadata,
  stripTaskInlinePropsMetadata,
} from '../utils/task-line-metadata';
import {
  MAX_BASE_LINE_SOURCE_BYTES,
  isWithinUtf8ByteLimit,
  resolveUniqueBaseLineFingerprint,
  sha256BaseLine,
} from './base-line-edit-protocol-core';
import * as logger from '../logger';
import { scanMarkdownDocumentLines } from '../utils/markdown-document-lines';
import { ensureTaskHistoryIdentity, getTaskHistoryIdentity } from './item-history-core';
import {
  abortDirectTaskHistory,
  beginDirectTaskHistory,
  commitDirectTaskHistory,
  ensureDirectTaskHistoryIdentity,
  type DirectTaskHistoryAction,
  type DirectTaskHistoryCause,
  type DirectTaskHistoryHandle,
  type DirectTaskHistoryLogContext,
} from '../utils/direct-task-history';

const getMoment = (): any => (window as any).moment;

interface DailyNotePreviewHandle {
  refresh(): Promise<void>;
  unload(): void;
}

interface HomeCaptureOptions {
  task?: boolean;
  targetPath?: string;
  preserveMarkdown?: boolean;
  headingTarget?: HomeCaptureHeadingTarget;
  historyCause?: DirectTaskHistoryCause;
}

interface HomeCaptureTaskHistoryIntent {
  handle: DirectTaskHistoryHandle | null;
  context: DirectTaskHistoryLogContext;
  blockLineOffset: number;
  rawLine: string;
  ready: boolean;
}

interface HomeCaptureModalOptions extends HomeCaptureOptions {
  headingTargets?: HomeCaptureHeadingTarget[];
  targetLabel?: string;
}

interface HomeCaptureEditorHandle {
  getValue(): string;
  setValue(value: string): void;
  clear(): void;
  focus(): void;
  unload(): void;
}

interface HomeCaptureLineEditorOptions {
  expectedFingerprint?: string;
  redactDiagnostics?: boolean;
}

type HomeCaptureSuggestion =
  | { type: 'tag'; value: string; label: string }
  | { type: 'note'; file: TFile; matchedText: string; display: string; label: string; replaceStart: number; replaceEnd: number };

export function classifyHomeCaptureLineHistoryAction(
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

export class HomeCaptureService {
  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  async openLineEditor(
    file: TFile,
    zeroBasedLine: number,
    options: HomeCaptureLineEditorOptions = {},
  ): Promise<boolean> {
    if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') return false;
    const content = await this.plugin.app.vault.read(file);
    const range = resolveHomeCaptureLineRange(content, zeroBasedLine);
    if (!range) {
      logger.flowWarn('HomeCapture', 'line-editor:unresolved', this.getLineEditorDiagnostics(file, zeroBasedLine, options));
      new Notice('Could not resolve the selected line.');
      return false;
    }
    const expectedFingerprint = String(options.expectedFingerprint || '');
    if (expectedFingerprint) {
      if (!isWithinUtf8ByteLimit(content, MAX_BASE_LINE_SOURCE_BYTES)) {
        logger.flowWarn('HomeCapture', 'line-editor:source-too-large', this.getLineEditorDiagnostics(file, zeroBasedLine, options));
        new Notice('The selected note is too large to open safely from a widget.', 8000);
        return false;
      }
      const actualFingerprint = await sha256BaseLine(content.slice(range.from, range.to), zeroBasedLine === 0);
      if (!/^[0-9a-f]{64}$/u.test(expectedFingerprint) || actualFingerprint !== expectedFingerprint) {
        logger.flowWarn('HomeCapture', 'line-editor:digest-conflict', this.getLineEditorDiagnostics(file, zeroBasedLine, options));
        new Notice('The selected line changed. Refresh the widget and try again.', 8000);
        return false;
      }
    }
    const snapshot = createHomeCaptureRangeSnapshot(content, range.from, range.to);
    logger.flow('HomeCapture', 'line-editor:open', this.getLineEditorDiagnostics(file, zeroBasedLine, options));
    return new HomeCaptureLineEditModal(
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
    options: HomeCaptureLineEditorOptions,
  ): Record<string, unknown> {
    return options.redactDiagnostics === true
      ? { route: 'external-base-line' }
      : { path: file.path, line: zeroBasedLine + 1 };
  }

  async openCaptureModal(date = getMoment()(), options: HomeCaptureOptions = {}): Promise<boolean> {
    const requestedPath = normalizePath(String(options.targetPath || '').trim()).replace(/^\/+/, '');
    if (requestedPath) {
      const requested = this.plugin.app.vault.getAbstractFileByPath(requestedPath);
      if (!(requested instanceof TFile) || requested.extension !== 'md') {
        new Notice('TPS GCM: The capture target is not an available Markdown note.');
        return false;
      }
      return this.openCaptureModalForTarget(requested, date, options);
    }
    try {
      return this.openCaptureModalForTarget(await this.ensureDailyNote(date), date, options);
    } catch (error) {
      logger.flowError('HomeCapture', 'capture-modal:daily-note-unavailable', error, {
        date: date.format?.('YYYY-MM-DD') ?? null,
      });
      return false;
    }
  }

  async openCaptureModalForCurrentNote(): Promise<boolean> {
    const file = this.plugin.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== 'md') {
      new Notice('TPS GCM: Open a Markdown note before capturing to the current note.');
      return false;
    }
    return this.openCaptureModalForTarget(file, getMoment()(), {}, file.path);
  }

  async openCaptureModalForContext(
    context: HomeActionContext,
    options: HomeCaptureOptions = {},
  ): Promise<boolean> {
    const targetPath = normalizePath(String(context.dailyNotePath || '').trim()).replace(/^\/+/, '');
    const target = targetPath ? this.plugin.app.vault.getAbstractFileByPath(targetPath) : null;
    const date = getMoment()(context.dateIso, 'YYYY-MM-DD', true);
    if (!(target instanceof TFile) || target.extension !== 'md' || !date?.isValid?.()) {
      logger.flowWarn('HomeCapture', 'context-modal:invalid-target', {
        targetPath: targetPath || null,
        dateIso: context.dateIso,
        componentId: context.componentId,
      });
      new Notice('The selected Home Daily Note is unavailable. Refresh Home and try again.', 8000);
      return false;
    }
    logger.flow('HomeCapture', 'context-modal:open', {
      targetPath,
      dateIso: context.dateIso,
      task: options.task === true,
      componentId: context.componentId,
    });
    return this.openCaptureModalForTarget(target, date, options);
  }

  private async openCaptureModalForTarget(
    file: TFile | null,
    date: any,
    options: HomeCaptureOptions,
    targetLabel?: string,
  ): Promise<boolean> {
    let headingTargets: HomeCaptureHeadingTarget[] = [];
    if (file) {
      try {
        headingTargets = listHomeCaptureHeadings(await this.plugin.app.vault.cachedRead(file));
      } catch (error) {
        logger.flowError('HomeCapture', 'capture-modal:target-read-failed', error, { path: file.path });
        new Notice('TPS GCM: The capture target could not be read. Nothing was written.');
        return false;
      }
    }
    logger.flow('HomeCapture', 'capture-modal:open', {
      path: file?.path ?? null,
      date: date.format?.('YYYY-MM-DD') ?? null,
      task: options.task === true,
      headingCount: headingTargets.length,
    });
    return new HomeCaptureModal(this.plugin, this, date, {
      ...options,
      targetPath: file?.path,
      headingTargets,
      targetLabel,
    }).openAndWait();
  }

  async getDailyNoteForCapture(date = getMoment()()): Promise<TFile> {
    return this.ensureDailyNote(date);
  }

  formatCaptureValue(text: string, task = false): string {
    return formatHomeCaptureBlock(text, getMoment()().format('YYYY-MM-DD HH:mm:ss'), { task }).trimEnd();
  }

  validateCaptureValue(text: string, date = getMoment()(), options: HomeCaptureOptions = {}): boolean {
    const value = String(text || '').trim();
    if (!value) return false;
    if (!this.containsMarkdownHeading(value)) return true;
    new Notice('Quick capture does not support headings yet.');
    logger.flowWarn('HomeCapture', 'capture:blocked-heading', {
      date: date.format?.('YYYY-MM-DD') ?? null,
      task: options.task === true,
    });
    return false;
  }

  renderCaptureForm(
    parent: HTMLElement,
    options: {
      className?: string;
      rows?: number;
      autoFocus?: boolean;
      date?: any;
      onCaptured?: () => void | Promise<void>;
      showOpenDailyNoteButton?: boolean;
      onDailyNoteOpened?: () => void | Promise<void>;
      showLivePreview?: boolean;
      component?: Component;
      targetPath?: string;
    } = {},
  ): void {
    const root = parent.createDiv({ cls: options.className || 'tps-home-capture' });
    const editor = new HomeCaptureEditor(this.plugin, root, {
      rows: options.rows ?? 3,
      placeholder: 'Write a note or thought…',
    });
    const livePreview = options.showLivePreview
      ? this.renderCaptureLivePreview(root, editor, options.component)
      : null;
    const actions = root.createDiv({ cls: 'tps-home-capture-actions' });
    const capture = actions.createEl('button', {
      cls: 'tps-home-primary-button',
      attr: { type: 'button', title: 'Add to daily note' },
    });
    setIcon(capture, 'send');
    capture.createSpan({ text: 'Add to day' });
    const captureTask = actions.createEl('button', {
      cls: 'tps-home-secondary-button',
      attr: { type: 'button', title: 'Add as an unchecked task' },
    });
    setIcon(captureTask, 'list-checks');
    captureTask.createSpan({ text: 'Add task' });
    actions.createSpan({ cls: 'tps-home-capture-shortcut', text: '⌘↵ Add to day' });
    if (options.showOpenDailyNoteButton) {
      const openDailyNote = actions.createEl('button', {
        cls: 'tps-home-secondary-button',
        attr: { type: 'button', title: 'Open daily note' },
      });
      setIcon(openDailyNote, 'calendar-days');
      openDailyNote.createSpan({ text: 'Open daily note' });
      openDailyNote.addEventListener('click', () => {
        void (async () => {
          await this.openDailyNote(options.date ?? getMoment()());
          await options.onDailyNoteOpened?.();
        })();
      });
    }

    const submit = async (captureOptions: HomeCaptureOptions = {}) => {
      const value = editor.getValue().trim();
      if (!value) return;
      const saved = await this.capture(value, options.date ?? getMoment()(), {
        ...captureOptions,
        targetPath: options.targetPath,
        historyCause: {
          kind: 'user',
          sourcePluginId: 'tps-global-context-menu',
          surface: 'home-capture-form',
        },
      });
      if (!saved) return;
      editor.clear();
      updateSubmitState();
      await options.onCaptured?.();
    };

    const updateSubmitState = () => {
      const disabled = !editor.getValue().trim();
      capture.disabled = disabled;
      captureTask.disabled = disabled;
    };
    editor.inputEl.addEventListener('input', () => {
      updateSubmitState();
      void livePreview?.refresh();
    });
    updateSubmitState();

    capture.addEventListener('click', () => {
      void submit();
    });
    captureTask.addEventListener('click', () => {
      void submit({ task: true });
    });
    editor.inputEl.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void submit();
      }
    });
    if (options.autoFocus) {
      window.setTimeout(() => editor.focus(), 0);
    }
  }

  private renderCaptureLivePreview(
    parent: HTMLElement,
    editor: HomeCaptureEditorHandle,
    component?: Component,
  ): { refresh(): Promise<void> } {
    const preview = parent.createDiv({ cls: 'tps-home-capture-live-preview is-empty' });
    preview.createDiv({ cls: 'tps-home-capture-live-preview-label', text: 'As saved' });
    const body = preview.createDiv({ cls: 'tps-home-capture-live-preview-body markdown-rendered' });
    let renderToken = 0;

    return {
      refresh: async () => {
        const value = editor.getValue().trim();
        const token = ++renderToken;
        preview.classList.toggle('is-empty', !value);
        body.empty();
        if (!value) return;
        const captureLine = formatHomeCaptureBlock(value, '').trimEnd();
        const rendered = document.createElement('div');
        await MarkdownRenderer.render(this.plugin.app, captureLine, rendered, '', component ?? new Component());
        if (token !== renderToken) return;
        body.replaceChildren(...Array.from(rendered.childNodes));
      },
    };
  }

  async capture(text: string, date = getMoment()(), options: HomeCaptureOptions = {}): Promise<TFile | null> {
    const value = String(text || '').trim();
    if (!this.validateCaptureValue(value, date, options)) return null;
    const requestedPath = normalizePath(String(options.targetPath || '').trim()).replace(/^\/+/, '');
    const requestedFile = requestedPath ? this.plugin.app.vault.getAbstractFileByPath(requestedPath) : null;
    if (requestedPath && (!(requestedFile instanceof TFile) || requestedFile.extension !== 'md')) {
      logger.flowWarn('HomeCapture', 'capture:target-unavailable', {
        requestedPath,
        date: date.format?.('YYYY-MM-DD') ?? null,
        task: options.task === true,
      });
      new Notice('The capture target no longer exists. Nothing was written.', 8000);
      return null;
    }
    let file: TFile;
    try {
      file = requestedFile instanceof TFile ? requestedFile : await this.ensureDailyNote(date);
    } catch (error) {
      logger.flowError('HomeCapture', 'capture:daily-note-unavailable', error, {
        date: date.format?.('YYYY-MM-DD') ?? null,
        task: options.task === true,
      });
      return null;
    }
    const timestamp = getMoment()().format('YYYY-MM-DD HH:mm:ss');
    const block = options.preserveMarkdown === true
      ? formatCaptureMarkdownForWrite(value, timestamp)
      : formatHomeCaptureBlock(value, timestamp, { task: options.task === true });
    const historyIntents = await this.beginCaptureTaskHistory(file, block, options.historyCause);
    let headingConflict = false;
    let resolvedHeadingLine: number | null = null;
    let processed = '';
    try {
      processed = await this.plugin.app.vault.process(file, (current) => {
        const writeBlock = this.applyCaptureTaskHistoryIdentities(block, historyIntents);
        if (options.headingTarget) {
          const inserted = insertHomeCaptureBlockUnderHeading(
            current,
            writeBlock,
            options.headingTarget,
            this.plugin.settings.homeCaptureInsertPosition,
          );
          if (!inserted) {
            headingConflict = true;
            return current;
          }
          resolvedHeadingLine = inserted.headingLine;
          return inserted.content;
        }
        return insertHomeCaptureBlock(current, writeBlock, {
          insertPosition: this.plugin.settings.homeCaptureInsertPosition,
          addHeading: false,
        });
      });
    } catch (error) {
      await this.abortCaptureTaskHistory(historyIntents);
      logger.flowError('HomeCapture', 'capture:write-failed', error, {
        path: file.path,
        headingSelected: Boolean(options.headingTarget),
      });
      new Notice('TPS GCM: Capture could not be saved. Nothing was written.', 8000);
      return null;
    }
    if (headingConflict) {
      await this.abortCaptureTaskHistory(historyIntents);
      logger.flowWarn('HomeCapture', 'capture:heading-unavailable', {
        path: file.path,
        headingLevel: options.headingTarget?.level ?? null,
        headingLine: options.headingTarget ? options.headingTarget.line + 1 : null,
      });
      new Notice('The selected heading changed or no longer exists. Nothing was written.', 8000);
      return null;
    }
    await this.commitCaptureTaskHistory(historyIntents, processed);
    logger.flow('HomeCapture', 'capture:written', {
      path: file.path,
      date: date.format('YYYY-MM-DD'),
      task: options.task === true,
      explicitTarget: Boolean(requestedPath),
      format: options.preserveMarkdown === true ? 'markdown' : 'legacy',
      insertPosition: this.plugin.settings.homeCaptureInsertPosition,
      headingSelected: Boolean(options.headingTarget),
      headingLevel: options.headingTarget?.level ?? null,
      headingLine: resolvedHeadingLine === null ? null : resolvedHeadingLine + 1,
    });
    const destination = requestedPath ? file.basename : date.format('YYYY-MM-DD');
    new Notice(`${options.task === true ? 'Added task' : 'Added'} to ${destination}.`);
    return file;
  }

  private async beginCaptureTaskHistory(
    file: TFile,
    block: string,
    cause: DirectTaskHistoryCause | undefined,
  ): Promise<HomeCaptureTaskHistoryIntent[]> {
    if (!cause || cause.kind !== 'user') return [];
    const lines = String(block || '').replace(/\r\n?/gu, '\n').split('\n');
    const intents: HomeCaptureTaskHistoryIntent[] = [];
    for (let blockLineOffset = 0; blockLineOffset < lines.length; blockLineOffset += 1) {
      const rawLine = lines[blockLineOffset] || '';
      if (!parseTaskLine(rawLine)) continue;
      const context: DirectTaskHistoryLogContext = {
        action: 'task.create',
        surface: cause.surface,
        path: file.path,
        lineNumber: blockLineOffset,
      };
      const handle = await beginDirectTaskHistory(this.plugin.itemHistoryService, {
        action: 'task.create',
        cause,
        before: {
          path: file.path,
          lineNumber: blockLineOffset,
          rawLine,
        },
      });
      intents.push({ handle, context, blockLineOffset, rawLine, ready: true });
    }
    return intents;
  }

  private applyCaptureTaskHistoryIdentities(
    block: string,
    intents: HomeCaptureTaskHistoryIntent[],
  ): string {
    if (intents.length === 0) return block;
    const lines = String(block || '').replace(/\r\n?/gu, '\n').split('\n');
    for (const intent of intents) {
      const ensured = ensureDirectTaskHistoryIdentity(
        this.plugin.itemHistoryService,
        intent.handle,
        lines[intent.blockLineOffset] ?? intent.rawLine,
        intent.context,
      );
      intent.ready = intent.ready && ensured.ready;
      intent.rawLine = ensured.line;
      lines[intent.blockLineOffset] = ensured.line;
    }
    return lines.join('\n');
  }

  private async commitCaptureTaskHistory(
    intents: HomeCaptureTaskHistoryIntent[],
    currentContent: string,
  ): Promise<void> {
    if (intents.length === 0) return;
    const documentLines = scanMarkdownDocumentLines(currentContent);
    for (const intent of intents) {
      if (!intent.handle || !intent.ready) {
        await abortDirectTaskHistory(this.plugin.itemHistoryService, intent.handle, intent.context);
        continue;
      }
      const expectedIdentity = getTaskHistoryIdentity(intent.rawLine);
      const matches = expectedIdentity
        ? documentLines.filter((line) => {
            if (!line.isContent || !parseTaskLine(line.text) || getTaskHistoryIdentity(line.text) !== expectedIdentity) {
              return false;
            }
            try {
              ensureTaskHistoryIdentity(line.text, expectedIdentity);
              return true;
            } catch {
              return false;
            }
          })
        : [];
      if (matches.length !== 1) {
        await abortDirectTaskHistory(this.plugin.itemHistoryService, intent.handle, intent.context);
        continue;
      }
      const after = matches[0];
      await commitDirectTaskHistory(this.plugin.itemHistoryService, intent.handle, {
        after: {
          path: intent.context.path,
          lineNumber: after.index,
          rawLine: after.text,
        },
        outcome: 'committed',
      }, intent.context);
    }
  }

  private async abortCaptureTaskHistory(intents: HomeCaptureTaskHistoryIntent[]): Promise<void> {
    await Promise.all(intents.map((intent) =>
      abortDirectTaskHistory(this.plugin.itemHistoryService, intent.handle, intent.context)));
  }

  private containsMarkdownHeading(value: string): boolean {
    return String(value || '')
      .split(/\r?\n/)
      .some((line) => /^\s{0,3}#{1,6}\s+\S/.test(line));
  }

  async openDailyNote(date = getMoment()()): Promise<void> {
    const file = await this.ensureDailyNote(date);
    await this.plugin.openFileInLeaf(file, false, () => this.plugin.app.workspace.getLeaf(false), { revealLeaf: true });
  }

  async getDailyNotePreview(date = getMoment()()): Promise<{ file: TFile; content: string }> {
    const file = await this.ensureDailyNote(date);
    return {
      file,
      content: await this.plugin.app.vault.read(file),
    };
  }

  renderDailyNotePreview(
    parent: HTMLElement,
    options: {
      className?: string;
      date?: any;
      component?: Component;
      headerText?: string;
      onLineClick?: (file: TFile, line: number) => void;
    } = {},
  ): DailyNotePreviewHandle {
    let previewEl: HTMLElement | null = null;
    let previewRenderToken = 0;
    const component = options.component ?? new Component();
    const ownsComponent = !options.component;
    if (ownsComponent) component.load();

    const preview = parent.createDiv({ cls: options.className || 'tps-home-capture-preview' });
    const header = preview.createDiv({ cls: 'tps-home-capture-preview-header' });
    header.createSpan({ text: options.headerText || 'Daily note' });
    const previewBodyClasses = ['tps-home-capture-preview-body', 'markdown-rendered'];
    if ((options.className || '').includes('tps-home-capture-preview--home')) {
      previewBodyClasses.push('tps-home-scroll-host');
    }
    previewEl = preview.createDiv({ cls: previewBodyClasses.join(' ') });
    if (previewEl.hasClass('tps-home-scroll-host')) {
      previewEl.tabIndex = 0;
      previewEl.setAttr('role', 'region');
      previewEl.setAttr('aria-label', 'Daily note preview scroll area');
    }

    const refresh = async () => {
      const body = previewEl;
      if (!body) return;
      const renderToken = ++previewRenderToken;
      body.empty();
      body.createDiv({ cls: 'tps-home-capture-preview-loading', text: 'Loading daily note...' });
      try {
        const { file, content } = await this.getDailyNotePreview(options.date ?? getMoment()());
        if (renderToken !== previewRenderToken || !previewEl) return;
        const cleanContent = await this.removeMissingWorkoutSummaries(file, content);
        body.empty();
        await MarkdownRenderer.render(this.plugin.app, cleanContent, body, file.path, component);
        this.formatWorkoutLogPreview(body);
        if (options.onLineClick) this.enableDailyNoteLineLoading(body, file, cleanContent, options.onLineClick);
      } catch (error) {
        if (renderToken !== previewRenderToken || !previewEl) return;
        body.empty();
        body.createDiv({ cls: 'tps-home-capture-preview-error', text: 'Daily note could not be rendered.' });
        logger.flowError('HomeCapture', 'render-daily-note-preview-failed', error, {
          date: options.date?.format?.('YYYY-MM-DD') ?? null,
        });
      }
    };

    void refresh();
    return {
      refresh,
      unload: () => {
        previewEl = null;
        if (ownsComponent) component.unload();
      },
    };
  }

  private enableDailyNoteLineLoading(
    body: HTMLElement,
    file: TFile,
    content: string,
    onLineClick: (file: TFile, line: number) => void,
  ): void {
    const lines = content.split(/\r?\n/);
    const candidates = Array.from(body.querySelectorAll<HTMLElement>('li, p, blockquote, h1, h2, h3, h4, h5, h6'));
    let nextSourceLine = 0;
    for (const element of candidates) {
      if (element.closest('button, a, .tps-home-workout-card')) continue;
      const dataLine = Number(element.dataset.line ?? element.closest<HTMLElement>('[data-line]')?.dataset.line);
      const visibleText = this.normalizePreviewLine(element.textContent || '');
      const orderedLine = lines.findIndex((source, index) => index >= nextSourceLine && this.normalizePreviewLine(source) === visibleText);
      const line = Number.isInteger(dataLine) && dataLine >= 0
        ? dataLine
        : orderedLine >= 0 ? orderedLine : lines.findIndex((source) => this.normalizePreviewLine(source) === visibleText);
      if (line < 0) continue;
      nextSourceLine = Math.max(nextSourceLine, line + 1);
      const isTaskLine = element.matches('li.task-list-item') || !!element.querySelector('input.task-list-item-checkbox, input[type="checkbox"]');
      if (isTaskLine) {
        element.dataset.taskPath = file.path;
        element.dataset.taskLine = String(line + 1);
        element.dataset.taskText = visibleText;
        element.dataset.tpsGcmContext = 'markdown-task';
        continue;
      }
      element.addClass('tps-home-daily-note-load-line');
      element.setAttr('title', 'Edit this line in Quick Capture');
      element.addEventListener('click', (event) => {
        if ((event.target as HTMLElement | null)?.closest('a, button, input, select')) return;
        event.preventDefault();
        event.stopPropagation();
        onLineClick(file, line);
      });
    }
  }

  private normalizePreviewLine(line: string): string {
    return String(line || '')
      .replace(/%%[\s\S]*?%%/g, '')
      .replace(/^\s*(?:[-*+]\s+)?(?:\[[^\]]?\]\s+)?/, '')
      .replace(/\[[A-Za-z][A-Za-z0-9_-]*::[^\]]*\]/g, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/!?\[\[([^\]]+)\]\]/g, '$1')
      .replace(/(`+)(.*?)\1/g, '$2')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/(^|[^\p{L}\p{N}])__([^_\n]+)__(?![\p{L}\p{N}])/gu, '$1$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/==(.*?)==/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/(^|[^\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu, '$1$2')
      .replace(/\\([\\`*{}\[\]()#+.!_>~-])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async removeMissingWorkoutSummaries(file: TFile, content: string): Promise<string> {
    const lines = content.split('\n');
    let changed = false;
    const nextLines = lines.filter((line) => {
      const match = line.match(/\[tps-health:workout\s+([^\]]+)\]/);
      if (!match) return true;
      const path = this.getWorkoutAttribute(match[1], 'path');
      if (!path) return true;
      const target = this.plugin.app.vault.getAbstractFileByPath(path);
      if (target instanceof TFile) return true;
      changed = true;
      return false;
    });
    if (!changed) return content;
    const next = nextLines.join('\n');
    await this.plugin.app.vault.modify(file, next);
    return next;
  }

  private formatWorkoutLogPreview(body: HTMLElement): void {
    const candidates = Array.from(body.querySelectorAll<HTMLElement>('li, p'));
    for (const element of candidates) {
      const text = element.textContent || '';
      const match = text.match(/\[tps-health:workout\s+([^\]]+)\]/);
      if (!match) continue;

      const path = this.getWorkoutAttribute(match[1], 'path');
      const startedAt = this.getWorkoutAttribute(match[1], 'startedAt');
      if (!path) continue;

      const target = this.plugin.app.vault.getAbstractFileByPath(path);
      const frontmatter = target instanceof TFile
        ? this.plugin.app.metadataCache.getFileCache(target)?.frontmatter
        : null;
      const title = String(frontmatter?.title || path.split('/').pop()?.replace(/\.md$/i, '') || 'Workout');
      const workflowStatusKey = this.plugin.sharedServices?.status?.getStatusPropertyKey?.() || 'status';
      const actualStatusKey = frontmatter
        ? Object.keys(frontmatter).find((key) => key.toLowerCase() === workflowStatusKey.toLowerCase())
        : undefined;
      const workflowStatus = actualStatusKey
        ? frontmatter?.[actualStatusKey]
        : workflowStatusKey.toLowerCase() === 'status'
          ? frontmatter?.status
          : undefined;
      const normalizedWorkflowStatus = this.plugin.sharedServices?.status?.normalize(workflowStatus)
        ?? String(workflowStatus || '').trim().toLowerCase();
      const abandoned = normalizedWorkflowStatus === 'wont-do';
      const startedLabel = this.formatWorkoutStart(startedAt);
      element.addClass('tps-home-workout-log-item');
      element.empty();

      const card = element.createDiv({ cls: 'tps-home-workout-card' });
      if (abandoned) card.addClass('is-abandoned');
      const icon = card.createDiv({ cls: 'tps-home-workout-card-icon' });
      setIcon(icon, 'dumbbell');
      const main = card.createDiv({ cls: 'tps-home-workout-card-main' });
      const titleEl = main.createEl('button', {
        cls: 'tps-home-workout-card-title',
        attr: { type: 'button' },
        text: title,
      });
      titleEl.addEventListener('click', () => {
        void this.openWorkoutPath(path);
      });
      const meta = main.createDiv({ cls: 'tps-home-workout-card-meta' });
      if (abandoned) meta.createSpan({ cls: 'tps-home-workout-card-status', text: 'Abandoned' });
      if (startedLabel) meta.createSpan({ text: startedLabel });
      meta.createSpan({ text: path.replace(/\.md$/i, '') });
      const open = card.createEl('button', {
        cls: 'tps-home-workout-card-open',
        attr: { type: 'button', title: 'Open workout' },
      });
      setIcon(open, 'arrow-up-right');
      open.addEventListener('click', () => {
        void this.openWorkoutPath(path);
      });
    }
  }

  private getWorkoutAttribute(source: string, key: string): string | null {
    const quoted = source.match(new RegExp(`${key}="([^"]+)"`));
    if (quoted) return quoted[1];
    const bare = source.match(new RegExp(`${key}=([^\\s]+)`));
    return bare?.[1] ?? null;
  }

  private formatWorkoutStart(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return `Started ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }

  private async openWorkoutPath(path: string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.plugin.openFileInLeaf(file, false, () => this.plugin.app.workspace.getLeaf(false), { revealLeaf: true });
    }
  }

  private async ensureDailyNote(date: any): Promise<TFile> {
    const isoDate = date?.format?.('YYYY-MM-DD');
    if (!isoDate) throw new Error('Home capture could not resolve the Daily Note date.');
    const file = await this.plugin.noteOperationService.ensureDailyNote(`${isoDate} 00:00:00`);
    if (!(file instanceof TFile)) {
      throw new Error(`Daily Note creation failed for ${isoDate}.`);
    }
    return file;
  }

}

class HomeCaptureEditor implements HomeCaptureEditorHandle {
  readonly inputEl: HTMLElement;
  private readonly suggestionsEl: HTMLElement;
  private selectedSuggestion = 0;
  private suggestions: HomeCaptureSuggestion[] = [];

  constructor(
    private readonly plugin: TPSGlobalContextMenuPlugin,
    parent: HTMLElement,
    options: { rows: number; placeholder: string },
  ) {
    const shell = parent.createDiv({ cls: 'tps-home-capture-editor-shell' });
    this.inputEl = shell.createDiv({
      cls: 'tps-home-capture-editor markdown-source-view mod-cm6 is-live-preview',
      attr: {
        contenteditable: 'true',
        role: 'textbox',
        'aria-label': options.placeholder,
        'aria-multiline': 'true',
        'data-placeholder': options.placeholder,
        spellcheck: 'true',
      },
    });
    this.inputEl.style.setProperty('--tps-home-capture-editor-rows', String(Math.max(2, options.rows || 3)));
    this.suggestionsEl = shell.createDiv({ cls: 'tps-home-capture-tag-suggest' });
    this.suggestionsEl.style.display = 'none';

    this.inputEl.addEventListener('keydown', (event) => this.handleKeydown(event));
    this.inputEl.addEventListener('input', () => this.refreshSuggestions());
    this.inputEl.addEventListener('blur', () => {
      window.setTimeout(() => this.hideSuggestions(), 120);
    });
  }

  getValue(): string {
    return this.htmlToMarkdown(this.inputEl).trim();
  }

  setValue(value: string): void {
    this.setPlainText(String(value || ''));
  }

  clear(): void {
    this.inputEl.empty();
    this.hideSuggestions();
  }

  focus(): void {
    this.inputEl.focus();
  }

  unload(): void {
    this.hideSuggestions();
    this.inputEl.empty();
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (this.suggestions.length > 0 && this.suggestionsEl.style.display !== 'none') {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.selectedSuggestion = Math.min(this.suggestions.length - 1, this.selectedSuggestion + 1);
        this.renderSuggestions();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.selectedSuggestion = Math.max(0, this.selectedSuggestion - 1);
        this.renderSuggestions();
        return;
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        this.applySuggestion(this.suggestions[this.selectedSuggestion]);
        return;
      }
      if (event.key === 'Escape') {
        this.hideSuggestions();
        return;
      }
    }

    if (event.key === '[' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const text = this.getPlainText();
      const offset = this.getCursorTextOffset();
      if (text.slice(0, offset).endsWith('[')) {
        event.preventDefault();
        this.setPlainText(`${text.slice(0, offset)}[]]${text.slice(offset)}`);
        this.setCursorTextOffset(offset + 1);
        this.refreshSuggestions();
        this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }

    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'b') {
      event.preventDefault();
      document.execCommand('bold');
      return;
    }
    if (key === 'i') {
      event.preventDefault();
      document.execCommand('italic');
      return;
    }
    if (key === 't' && event.shiftKey) {
      event.preventDefault();
      this.toggleCurrentLineTask();
    }
  }

  private toggleCurrentLineTask(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !this.inputEl.contains(selection.anchorNode)) return;
    const text = this.getPlainText();
    const offset = this.getCursorTextOffset();
    const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
    const lineEndIndex = text.indexOf('\n', offset);
    const lineEnd = lineEndIndex >= 0 ? lineEndIndex : text.length;
    const line = text.slice(lineStart, lineEnd);
    const nextLine = /^(\s*)- \[ \]\s+/.test(line)
      ? line.replace(/^(\s*)- \[ \]\s+/, '$1')
      : line.replace(/^(\s*)/, '$1- [ ] ');
    const next = `${text.slice(0, lineStart)}${nextLine}${text.slice(lineEnd)}`;
    this.setPlainText(next);
    this.setCursorTextOffset(lineStart + Math.min(nextLine.length, offset - lineStart + (nextLine.length - line.length)));
  }

  private refreshSuggestions(): void {
    const token = this.getTagTokenBeforeCursor();
    if (token) {
      const query = token.slice(1).toLowerCase();
      const tags = Object.keys((this.plugin.app.metadataCache as any).getTags?.() || {})
        .map((tag) => tag.replace(/^#/, ''))
        .filter((tag) => tag && tag.toLowerCase().startsWith(query))
        .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
        .slice(0, 8)
        .map((tag): HomeCaptureSuggestion => ({ type: 'tag', value: tag, label: `#${tag}` }));
      this.setSuggestions(tags);
      return;
    }
    this.setSuggestions(this.getWikilinkSuggestionsBeforeCursor());
  }

  private getWikilinkSuggestionsBeforeCursor(): HomeCaptureSuggestion[] {
    const text = this.getPlainText();
    const offset = this.getCursorTextOffset();
    const match = text.slice(0, offset).match(/\[\[([^\]\n]*)$/);
    if (!match) return [];
    const query = this.normalizeLookupText(match[1]);
    const replaceStart = offset - match[0].length;
    return this.plugin.app.vault.getMarkdownFiles()
      .filter((file) => !this.plugin.filePropertiesService?.isCompanionFile(file))
      .map((file) => ({ file, display: file.basename, normalized: this.normalizeLookupText(file.basename) }))
      .filter((entry) => !query || entry.normalized.includes(query))
      .sort((left, right) => {
        const leftPrefix = left.normalized.startsWith(query) ? 0 : 1;
        const rightPrefix = right.normalized.startsWith(query) ? 0 : 1;
        return leftPrefix - rightPrefix || left.display.localeCompare(right.display, undefined, { sensitivity: 'base' });
      })
      .slice(0, 8)
      .map(({ file, display }): HomeCaptureSuggestion => ({
        type: 'note',
        file,
        matchedText: display,
        display,
        label: display,
        replaceStart,
        replaceEnd: offset,
      }));
  }

  private setSuggestions(suggestions: HomeCaptureSuggestion[]): void {
    if (suggestions.length === 0) {
      this.hideSuggestions();
      return;
    }

    this.suggestions = suggestions;
    this.selectedSuggestion = 0;
    this.renderSuggestions();
  }

  private renderSuggestions(): void {
    this.suggestionsEl.empty();
    for (const [index, suggestion] of this.suggestions.entries()) {
      const item = this.suggestionsEl.createEl('button', {
        cls: `tps-home-capture-tag-suggest-item${index === this.selectedSuggestion ? ' is-selected' : ''}`,
        attr: { type: 'button' },
        text: suggestion.label,
      });
      if (suggestion.type === 'note') {
        item.createSpan({ cls: 'tps-home-capture-suggest-path', text: suggestion.file.path });
      }
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.applySuggestion(suggestion);
      });
    }
    this.suggestionsEl.style.display = '';
  }

  private hideSuggestions(): void {
    this.suggestions = [];
    this.selectedSuggestion = 0;
    this.suggestionsEl.empty();
    this.suggestionsEl.style.display = 'none';
  }

  private getTagTokenBeforeCursor(): string | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !this.inputEl.contains(selection.anchorNode)) return null;
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(this.inputEl);
    range.setEnd(selection.anchorNode!, selection.anchorOffset);
    const before = range.toString();
    const match = before.match(/(?:^|\s)(#[\p{L}\p{N}_/-]*)$/u);
    return match?.[1] ?? null;
  }

  private applySuggestion(suggestion: HomeCaptureSuggestion): void {
    const text = this.getPlainText();
    const offset = this.getCursorTextOffset();
    if (suggestion.type === 'tag') {
      const token = this.getTagTokenBeforeCursor();
      if (!token) return;
      const start = Math.max(0, offset - token.length);
      this.setPlainText(`${text.slice(0, start)}#${suggestion.value} ${text.slice(offset)}`);
      this.setCursorTextOffset(start + suggestion.value.length + 2);
      this.hideSuggestions();
      return;
    }

    const link = formatFileWikilink(suggestion.file.path, suggestion.display);
    this.setPlainText(`${text.slice(0, suggestion.replaceStart)}${link} ${text.slice(suggestion.replaceEnd)}`);
    this.setCursorTextOffset(suggestion.replaceStart + link.length + 1);
    this.hideSuggestions();
  }

  private getNoteSuggestionsBeforeCursor(): HomeCaptureSuggestion[] {
    const query = this.getNoteQueryBeforeCursor();
    if (!query || query.text.length < 2 || query.text.startsWith('#') || query.text.includes('[[')) return [];

    const normalizedQuery = this.normalizeLookupText(query.text);
    if (!normalizedQuery) return [];

    const seen = new Set<string>();
    const matches: Array<Extract<HomeCaptureSuggestion, { type: 'note' }>> = [];
    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      if (this.plugin.filePropertiesService?.isCompanionFile(file)) continue;
      const best = this.getBestNoteMatch(file, normalizedQuery);
      if (!best) continue;
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      matches.push({
        type: 'note',
        file,
        matchedText: best.matchedText,
        display: best.display,
        replaceStart: query.start,
        replaceEnd: query.end,
        label: best.display,
      });
      if (matches.length >= 8) break;
    }
    return matches.sort((left, right) => {
      const exactLeft = this.normalizeLookupText(left.matchedText) === normalizedQuery ? 0 : 1;
      const exactRight = this.normalizeLookupText(right.matchedText) === normalizedQuery ? 0 : 1;
      return exactLeft - exactRight || left.display.localeCompare(right.display, undefined, { sensitivity: 'base' });
    });
  }

  private getNoteQueryBeforeCursor(): { text: string; start: number; end: number } | null {
    const text = this.getPlainText();
    const end = this.getCursorTextOffset();
    const before = text.slice(0, end);
    const boundary = Math.max(
      before.lastIndexOf('\n'),
      before.lastIndexOf('.'),
      before.lastIndexOf(','),
      before.lastIndexOf(';'),
      before.lastIndexOf(':'),
      before.lastIndexOf('('),
      before.lastIndexOf('['),
    );
    const segmentStart = boundary + 1;
    const segment = before.slice(segmentStart);
    const wordMatches = Array.from(segment.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu));
    if (wordMatches.length === 0) return null;

    const recentWords = wordMatches.slice(-4);
    for (let index = recentWords.length - 1; index >= 0; index -= 1) {
      const first = recentWords[index];
      const start = segmentStart + (first.index ?? 0);
      const value = before.slice(start, end).trim();
      if (value.length >= 2) {
        return { text: value, start, end };
      }
    }
    return null;
  }

  private getBestNoteMatch(file: TFile, normalizedQuery: string): { matchedText: string; display: string } | null {
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter || {};
    const values = [
      this.frontmatterString(frontmatter, 'title'),
      file.basename,
      ...this.frontmatterStringList(frontmatter, 'aliases'),
      ...this.frontmatterStringList(frontmatter, 'alias'),
    ].filter((value): value is string => !!value);
    for (const value of values) {
      const normalized = this.normalizeLookupText(value);
      if (!normalized) continue;
      if (normalized === normalizedQuery || normalized.startsWith(normalizedQuery)) {
        return {
          matchedText: value,
          display: this.frontmatterString(frontmatter, 'title') || file.basename,
        };
      }
    }
    return null;
  }

  private frontmatterString(frontmatter: Record<string, any>, key: string): string | null {
    const actualKey = Object.keys(frontmatter || {}).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    const value = actualKey ? frontmatter[actualKey] : null;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private frontmatterStringList(frontmatter: Record<string, any>, key: string): string[] {
    const actualKey = Object.keys(frontmatter || {}).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    const value = actualKey ? frontmatter[actualKey] : null;
    if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    return [];
  }

  private normalizeLookupText(value: string): string {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private getPlainText(): string {
    return this.inputEl.innerText.replace(/\u00a0/g, ' ');
  }

  private setPlainText(value: string): void {
    this.inputEl.textContent = value;
  }

  private getCursorTextOffset(): number {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !this.inputEl.contains(selection.anchorNode)) return this.getPlainText().length;
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(this.inputEl);
    range.setEnd(selection.anchorNode!, selection.anchorOffset);
    return range.toString().length;
  }

  private setCursorTextOffset(offset: number): void {
    const target = Math.max(0, offset);
    const walker = document.createTreeWalker(this.inputEl, NodeFilter.SHOW_TEXT);
    let remaining = target;
    let node = walker.nextNode();
    while (node) {
      const length = node.textContent?.length || 0;
      if (remaining <= length) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      remaining -= length;
      node = walker.nextNode();
    }
    const range = document.createRange();
    range.selectNodeContents(this.inputEl);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  private htmlToMarkdown(root: HTMLElement): string {
    const lines: string[] = [];
    let current = '';
    const flush = () => {
      lines.push(current.trimEnd());
      current = '';
    };
    const walk = (node: Node, marks: { bold?: boolean; italic?: boolean } = {}) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (!text) return;
        current += this.applyMarks(text, marks);
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      const tag = node.tagName.toLowerCase();
      if (tag === 'br') {
        flush();
        return;
      }
      const nextMarks = {
        bold: marks.bold || tag === 'b' || tag === 'strong',
        italic: marks.italic || tag === 'i' || tag === 'em',
      };
      if (tag === 'div' || tag === 'p') {
        if (current) flush();
        node.childNodes.forEach((child) => walk(child, nextMarks));
        flush();
        return;
      }
      node.childNodes.forEach((child) => walk(child, nextMarks));
    };
    root.childNodes.forEach((child) => walk(child));
    if (current.trim()) flush();
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  private applyMarks(text: string, marks: { bold?: boolean; italic?: boolean }): string {
    if (!text.trim()) return text;
    if (marks.bold && marks.italic) return `***${text}***`;
    if (marks.bold) return `**${text}**`;
    if (marks.italic) return `*${text}*`;
    return text;
  }
}

class HomeCaptureModal extends Modal {
  private resolveResult: ((saved: boolean) => void) | null = null;
  private saved = false;
  private markdownEditor: CaptureMarkdownEditor | null = null;

  constructor(
    private readonly plugin: TPSGlobalContextMenuPlugin,
    private readonly captureService: HomeCaptureService,
    private readonly date: any,
    private readonly options: HomeCaptureModalOptions,
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
    this.modalEl.addClass('mod-tps-gcm', 'tps-home-capture-modal', 'tps-home-context-capture-modal', 'tps-keyboard-aware-modal');
    // Obsidian's default dialog height leaves a large, scrollable empty body on
    // mobile. This capture surface should only occupy its editable lines and controls.
    this.modalEl.style.setProperty('height', 'auto');
    this.modalEl.style.setProperty('min-height', '0');
    this.modalEl.style.setProperty('max-height', 'calc(100dvh - var(--size-4-8))');
    contentEl.empty();
    contentEl.createEl('h2', { text: this.options.task === true ? 'Add task' : 'Capture' });
    contentEl.createDiv({
      cls: 'tps-home-context-capture-target',
      text: this.options.targetLabel
        || `${this.date.format('ddd, MMM D YYYY')} · ${this.options.targetPath || 'Daily Note'}`,
    });
    const headingTargets = this.options.headingTargets || [];
    let selectedHeadingTarget: HomeCaptureHeadingTarget | undefined;
    if (headingTargets.length > 0) {
      const sectionRow = contentEl.createDiv({ cls: 'tps-home-context-capture-section' });
      sectionRow.createEl('label', { text: 'Place under' });
      const sectionSelect = sectionRow.createEl('select', {
        attr: { 'aria-label': 'Capture destination section' },
      });
      const noteBody = sectionSelect.createEl('option', { text: 'Note body' });
      noteBody.value = '';
      headingTargets.forEach((heading, index) => {
        const duplicate = heading.matchingCount > 1 ? ` · ${heading.occurrence + 1} of ${heading.matchingCount}` : '';
        const option = sectionSelect.createEl('option', {
          text: `H${heading.level} · ${heading.text}${duplicate}`,
        });
        option.value = String(index);
      });
      sectionSelect.addEventListener('change', () => {
        const index = Number(sectionSelect.value);
        selectedHeadingTarget = sectionSelect.value !== '' && Number.isInteger(index)
          ? headingTargets[index]
          : undefined;
      });
    }
    const inputShell = contentEl.createDiv({ cls: 'tps-home-context-capture-input-shell' });
    const editorHost = inputShell.createDiv({ cls: 'tps-home-context-capture-live-editor' });
    const actions = contentEl.createDiv({ cls: 'tps-home-context-capture-actions' });
    const submitButton = actions.createEl('button', { attr: { type: 'button' } });
    setIcon(submitButton, this.options.task === true ? 'list-checks' : 'send');
    submitButton.createSpan({ text: this.options.task === true ? 'Add task' : 'Capture' });
    const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
    submitButton.addClass('mod-cta');

    let submitting = false;
    let value = '';
    const update = () => {
      submitButton.disabled = submitting || !value.trim();
    };
    const submit = async () => {
      if (submitting) return;
      const markdown = value.trim();
      if (!markdown) return;
      submitting = true;
      update();
      try {
        const file = await this.captureService.capture(markdown, this.date, {
          task: false,
          targetPath: this.options.targetPath,
          preserveMarkdown: true,
          headingTarget: selectedHeadingTarget,
          historyCause: {
            kind: 'user',
            sourcePluginId: 'tps-global-context-menu',
            surface: 'home-capture-modal',
          },
        });
        if (!file) return;
        this.saved = true;
        logger.flow('HomeCapture', 'context-modal:saved', {
          targetPath: file.path,
          dateIso: this.date.format('YYYY-MM-DD'),
          task: markdown.split('\n').some((line) => /^\s*[-*+] \[[ xX]\](?: |$)/.test(line)),
          format: 'markdown',
        });
        this.close();
      } finally {
        submitting = false;
        if (this.contentEl.isConnected) update();
      }
    };
    this.markdownEditor = new CaptureMarkdownEditor({
      parentEl: editorHost,
      initialValue: this.options.task === true ? '- [ ] ' : '- ',
      onChange: (markdown, hasContent) => {
        value = hasContent ? markdown : '';
        update();
      },
      onSubmit: () => {
        if (!submitButton.disabled) void submit();
      },
    });
    inputShell.addEventListener('pointerdown', (event) => {
      if (editorHost.contains(event.target as Node)) return;
      event.preventDefault();
      this.markdownEditor?.focus();
    }, { capture: true });
    submitButton.addEventListener('click', () => void submit());
    cancel.addEventListener('click', () => this.close());
    update();
    window.requestAnimationFrame(() => {
      this.markdownEditor?.focus();
    });
  }

  onClose(): void {
    this.markdownEditor?.destroy();
    this.markdownEditor = null;
    this.contentEl.empty();
    this.resolveResult?.(this.saved);
    this.resolveResult = null;
  }
}

class HomeCaptureLineEditModal extends Modal {
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
    this.modalEl.addClass('mod-tps-gcm', 'tps-home-capture-modal', 'tps-home-line-edit-modal', 'tps-keyboard-aware-modal');
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Edit line' });
    contentEl.createDiv({
      cls: 'tps-home-context-capture-target',
      text: `${this.file.basename} · line ${this.zeroBasedLine + 1}`,
    });
    const editorHost = contentEl.createDiv({ cls: 'tps-home-context-capture-live-editor' });
    const actions = contentEl.createDiv({ cls: 'tps-home-context-capture-actions' });
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
            logger.flowWarn('HomeCapture', 'line-editor:source-too-large', this.getDiagnostics());
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
            logger.flowWarn('HomeCapture', 'line-editor:digest-conflict', this.getDiagnostics());
            new Notice('The selected line changed. Refresh the widget and try again.', 8000);
            return;
          }
        } catch (error) {
          saving = false;
          update();
          if (this.redactDiagnostics) {
            logger.flowWarn('HomeCapture', 'line-editor:digest-check-failed', {
              ...this.getDiagnostics(),
              reason: 'digest-check-failed',
            });
          } else {
            logger.flowError('HomeCapture', 'line-editor:digest-check-failed', error, this.getDiagnostics());
          }
          new Notice('The selected line could not be rechecked. Nothing was changed.', 8000);
          return;
        }
      }
      const historyAction = classifyHomeCaptureLineHistoryAction(this.snapshot.value, replacement);
      const historyContext: DirectTaskHistoryLogContext | null = historyAction
        ? {
            action: historyAction,
            surface: 'home-line-editor',
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
          const next = replaceHomeCaptureRangeIfUnchanged(current, this.snapshot, [this.snapshot.value], replacement);
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
        logger.flowError('HomeCapture', 'line-editor:write-failed', error, this.getDiagnostics());
        new Notice('The selected line could not be saved. Nothing was changed.', 8000);
        return;
      }
      if (!changed) {
        if (historyContext) {
          await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
        }
        saving = false;
        update();
        logger.flowWarn('HomeCapture', 'line-editor:conflict', this.getDiagnostics());
        new Notice('The line changed outside the editor. Refresh the feed and try again.', 8000);
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
        reason: 'home-line-editor-save',
        file: this.file,
        surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
        rebuildInlineSubitems: true,
        refreshLivePreviewEditors: true,
        delayMs: 80,
      });
      logger.flow('HomeCapture', 'line-editor:saved', this.getDiagnostics());
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
