import { MarkdownView, Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { getTaskDisplayTitle, parseTaskLine } from '../utils/task-line-metadata';
import {
  extractTaskBlock,
  findCurrentTaskLineIndex,
  joinContent,
  splitContent,
} from '../utils/task-block-move';

export const TPS_TASK_LINE_MIME = 'application/x-tps-task-line';
export const TPS_TASK_LINE_POINTER_DROP_EVENT = 'tps-task-line-pointer-drop';
const KANBAN_TASK_MIME = 'application/x-kanban-task';

type TaskLineDragContext = {
  file: TFile;
  lineNumber: number;
  rawLine: string;
  checkboxToken: string;
  title: string;
};

type TaskLineDragPayload = {
  type: 'task-line';
  source: 'gcm-markdown';
  path: string;
  line: number;
  rawLine: string;
  checkboxState: string;
  text: string;
};

const TASK_CHECKBOX_SELECTOR = [
  'input.task-list-item-checkbox',
  '.task-list-item-checkbox',
  '.tps-gcm-linked-subitem-checkbox',
  'input[type="checkbox"]',
].join(', ');

export class TaskLineDragService {
  private preparedEl: HTMLElement | null = null;
  private preparedCleanupTimer: number | null = null;
  private activePointerDrag:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        payload: TaskLineDragPayload;
        sourceEl: HTMLElement;
        moved: boolean;
        ghostEl: HTMLElement | null;
      }
    | null = null;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  attach(): void {
    this.plugin.registerDomEvent(document, 'pointerdown', (evt: PointerEvent) => this.prepareDrag(evt), { capture: true });
    this.plugin.registerDomEvent(document, 'pointermove', (evt: PointerEvent) => this.handlePointerMove(evt), { capture: true });
    this.plugin.registerDomEvent(document, 'pointerup', (evt: PointerEvent) => void this.handlePointerUp(evt), { capture: true });
    this.plugin.registerDomEvent(document, 'pointercancel', () => this.clearPreparedDrag(), { capture: true, passive: true });
    this.plugin.registerDomEvent(document, 'dragstart', (evt: DragEvent) => this.handleDragStart(evt), { capture: true });
    this.plugin.registerDomEvent(document, 'dragend', () => this.clearPreparedDrag(), { capture: true });
    this.plugin.registerDomEvent(document, 'dragover', (evt: DragEvent) => this.handleMarkdownDragOver(evt), { capture: true });
    this.plugin.registerDomEvent(document, 'drop', (evt: DragEvent) => void this.handleMarkdownDrop(evt), { capture: true });
  }

  dispose(): void {
    this.clearPreparedDrag();
  }

  private prepareDrag(evt: PointerEvent): void {
    if (evt.button !== 0) return;
    const target = evt.target instanceof HTMLElement ? evt.target : null;
    const checkboxEl = target?.closest<HTMLElement>(TASK_CHECKBOX_SELECTOR) ?? null;
    if (!checkboxEl) {
      this.clearPreparedDrag();
      return;
    }
    const context = this.resolveTaskLineContext(checkboxEl);
    if (!context) return;
    const payload: TaskLineDragPayload = {
      type: 'task-line',
      source: 'gcm-markdown',
      path: context.file.path,
      line: context.lineNumber + 1,
      rawLine: context.rawLine,
      checkboxState: context.checkboxToken,
      text: context.title,
    };

    this.clearPreparedDrag();
    this.preparedEl = checkboxEl;
    this.activePointerDrag = {
      pointerId: evt.pointerId,
      startX: evt.clientX,
      startY: evt.clientY,
      payload,
      sourceEl: checkboxEl,
      moved: false,
      ghostEl: null,
    };
    checkboxEl.setAttribute('draggable', 'true');
    checkboxEl.dataset.tpsTaskDragPayload = JSON.stringify(payload);
    checkboxEl.addClass('tps-task-line-drag-source');
  }

  private handlePointerMove(evt: PointerEvent): void {
    const active = this.activePointerDrag;
    if (!active || active.pointerId !== evt.pointerId) return;
    const dx = evt.clientX - active.startX;
    const dy = evt.clientY - active.startY;
    if (!active.moved && Math.hypot(dx, dy) < 8) return;
    active.moved = true;
    evt.preventDefault();
    evt.stopPropagation();
    if (!active.ghostEl) {
      active.ghostEl = document.body.createDiv({ cls: 'tps-task-line-drag-ghost' });
      active.ghostEl.setText(active.payload.text || 'Task');
    }
    active.ghostEl.style.left = `${evt.clientX + 12}px`;
    active.ghostEl.style.top = `${evt.clientY + 12}px`;
  }

  private async handlePointerUp(evt: PointerEvent): Promise<void> {
    const active = this.activePointerDrag;
    if (!active || active.pointerId !== evt.pointerId) {
      this.schedulePreparedCleanup();
      return;
    }
    this.activePointerDrag = null;
    const payload = active.payload;
    const didMove = active.moved;
    this.removeGhost(active.ghostEl);
    if (!didMove) {
      this.schedulePreparedCleanup();
      return;
    }

    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();

    const dropEvent = new CustomEvent(TPS_TASK_LINE_POINTER_DROP_EVENT, {
      bubbles: true,
      cancelable: true,
      detail: {
        payload,
        x: evt.clientX,
        y: evt.clientY,
      },
    });
    document.dispatchEvent(dropEvent);
    if (dropEvent.defaultPrevented) {
      this.clearPreparedDrag();
      return;
    }

    const sourceFile = this.plugin.app.vault.getFileByPath(payload.path);
    const target = this.resolveMarkdownDropTarget(evt as unknown as DragEvent);
    if (sourceFile instanceof TFile && target) {
      await this.moveTaskBlock(sourceFile, payload, target.file, target.lineIndex);
    }
    this.clearPreparedDrag();
  }

  private handleDragStart(evt: DragEvent): void {
    const target = evt.target instanceof HTMLElement ? evt.target : null;
    const dragEl = target?.closest<HTMLElement>('[data-tps-task-drag-payload]') ?? this.preparedEl;
    const payloadRaw = dragEl?.dataset.tpsTaskDragPayload;
    if (!dragEl || !payloadRaw || !evt.dataTransfer) return;

    evt.dataTransfer.effectAllowed = 'move';
    evt.dataTransfer.setData(TPS_TASK_LINE_MIME, payloadRaw);
    evt.dataTransfer.setData(KANBAN_TASK_MIME, payloadRaw);
    try {
      const payload = JSON.parse(payloadRaw) as TaskLineDragPayload;
      evt.dataTransfer.setData('text/plain', `${payload.path}:${payload.line}`);
    } catch {
      evt.dataTransfer.setData('text/plain', 'Task line');
    }
    dragEl.addClass('is-dragging');
  }

  private handleMarkdownDragOver(evt: DragEvent): void {
    if (!evt.dataTransfer || !this.hasTaskPayload(evt.dataTransfer)) return;
    if (!this.resolveMarkdownDropTarget(evt)) return;
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'move';
  }

  private async handleMarkdownDrop(evt: DragEvent): Promise<void> {
    if (!evt.dataTransfer || !this.hasTaskPayload(evt.dataTransfer)) return;
    const target = this.resolveMarkdownDropTarget(evt);
    if (!target) return;
    const payload = this.parseTaskPayload(evt.dataTransfer);
    if (!payload) return;

    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();

    const sourceFile = this.plugin.app.vault.getFileByPath(payload.path);
    if (!(sourceFile instanceof TFile)) {
      new Notice('Could not find the source task file.');
      return;
    }

    const moved = await this.moveTaskBlock(sourceFile, payload, target.file, target.lineIndex);
    if (moved) {
      new Notice(target.file.path === sourceFile.path ? 'Moved task.' : `Moved task to ${target.file.basename}.`);
    }
  }

  private hasTaskPayload(dataTransfer: DataTransfer): boolean {
    const types = Array.from(dataTransfer.types || []);
    return types.includes(TPS_TASK_LINE_MIME) || types.includes(KANBAN_TASK_MIME);
  }

  private parseTaskPayload(dataTransfer: DataTransfer): TaskLineDragPayload | null {
    const raw = dataTransfer.getData(TPS_TASK_LINE_MIME) || dataTransfer.getData(KANBAN_TASK_MIME);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<TaskLineDragPayload>;
      const path = String(parsed.path || '').trim();
      const line = Math.max(1, Math.floor(Number(parsed.line || 1)));
      if (!path || !line) return null;
      return {
        type: 'task-line',
        source: 'gcm-markdown',
        path,
        line,
        rawLine: String(parsed.rawLine || ''),
        checkboxState: String(parsed.checkboxState || '[ ]'),
        text: String(parsed.text || ''),
      };
    } catch {
      return null;
    }
  }

  private resolveMarkdownDropTarget(evt: DragEvent): { file: TFile; lineIndex: number } | null {
    const target = evt.target instanceof HTMLElement ? evt.target : null;
    if (!target) return null;
    if (target.closest('.tps-kanban-container, .tps-kanban-board, .bases-calendar-wrapper, .fc, .bases-view')) return null;
    const markdownHost = target.closest('.markdown-source-view, .markdown-reading-view, .markdown-preview-view, .mod-cm6');
    if (!markdownHost) return null;

    const view = this.resolveMarkdownViewForElement(target);
    if (!(view instanceof MarkdownView) || !(view.file instanceof TFile)) return null;
    const lineIndex = this.resolveDropLineIndex(view, evt.clientX, evt.clientY, target);
    return { file: view.file, lineIndex };
  }

  private resolveDropLineIndex(view: MarkdownView, x: number, y: number, target: HTMLElement): number {
    const cm = (view.editor as any)?.cm;
    if (cm?.posAtCoords && cm?.state?.doc?.lineAt) {
      try {
        const pos = cm.posAtCoords({ x, y });
        if (typeof pos === 'number') {
          const line = cm.state.doc.lineAt(pos);
          return Math.max(0, Number(line.number || 1) - 1);
        }
      } catch {
        // Fall through to rendered/source DOM hints.
      }
    }

    const lineEl = target.closest<HTMLElement>('[data-line], .cm-line');
    const dataLine = Number(lineEl?.getAttribute('data-line'));
    if (Number.isFinite(dataLine) && dataLine >= 0) return Math.floor(dataLine);
    return Math.max(0, (view.editor?.lineCount?.() || 1) - 1);
  }

  private async moveTaskBlock(
    sourceFile: TFile,
    payload: TaskLineDragPayload,
    targetFile: TFile,
    targetLineIndex: number,
  ): Promise<boolean> {
    const sourceContent = await this.plugin.app.vault.cachedRead(sourceFile);
    const sourceLines = splitContent(sourceContent);
    const sourceIndex = findCurrentTaskLineIndex(sourceLines.lines, payload.line - 1, payload.rawLine, payload.text);
    if (sourceIndex < 0) {
      new Notice('Could not resolve the dragged task line.');
      return false;
    }
    const block = extractTaskBlock(sourceLines.lines, sourceIndex);
    if (!block.lines.length) return false;

    if (sourceFile.path === targetFile.path) {
      let changed = false;
      await this.plugin.app.vault.process(sourceFile, (content) => {
        const parts = splitContent(content);
        const currentIndex = findCurrentTaskLineIndex(parts.lines, sourceIndex, payload.rawLine, payload.text);
        if (currentIndex < 0) return content;
        const currentBlock = extractTaskBlock(parts.lines, currentIndex);
        if (targetLineIndex >= currentIndex && targetLineIndex <= currentBlock.endExclusive) return content;
        const nextLines = [...parts.lines];
        nextLines.splice(currentIndex, currentBlock.endExclusive - currentIndex);
        const adjustedTarget = targetLineIndex > currentIndex
          ? Math.max(0, targetLineIndex - (currentBlock.endExclusive - currentIndex))
          : targetLineIndex;
        nextLines.splice(Math.min(adjustedTarget, nextLines.length), 0, ...currentBlock.lines);
        changed = true;
        return joinContent(nextLines, parts.newline, parts.endsWithNewline);
      });
      if (changed) this.notifyMoved([sourceFile.path]);
      return changed;
    }

    let inserted = false;
    await this.plugin.app.vault.process(targetFile, (content) => {
      const parts = splitContent(content);
      const index = Math.min(Math.max(0, targetLineIndex), parts.lines.length);
      const nextLines = [...parts.lines];
      nextLines.splice(index, 0, ...block.lines);
      inserted = true;
      return joinContent(nextLines, parts.newline, true);
    });
    if (!inserted) return false;

    let removed = false;
    await this.plugin.app.vault.process(sourceFile, (content) => {
      const parts = splitContent(content);
      const currentIndex = findCurrentTaskLineIndex(parts.lines, sourceIndex, payload.rawLine, payload.text);
      if (currentIndex < 0) return content;
      const currentBlock = extractTaskBlock(parts.lines, currentIndex);
      const nextLines = [...parts.lines];
      nextLines.splice(currentIndex, currentBlock.endExclusive - currentIndex);
      removed = true;
      return joinContent(nextLines, parts.newline, parts.endsWithNewline);
    });

    this.notifyMoved([sourceFile.path, targetFile.path]);
    if (!removed) new Notice('Copied the task, but the original line changed before it could be removed.');
    return true;
  }

  private notifyMoved(paths: string[]): void {
    this.plugin.eventService.emitFilesUpdated(Array.from(new Set(paths)));
    this.plugin.overlayRenderingService?.invalidate({
      reason: 'task-line-drag-move',
      surfaces: ['menus', 'linked-subitems', 'live-preview-editors'],
      rebuildInlineSubitems: true,
      refreshLivePreviewEditors: true,
      delayMs: 80,
    });
  }

  private resolveTaskLineContext(targetEl: HTMLElement): TaskLineDragContext | null {
    const view = this.resolveMarkdownViewForElement(targetEl);
    if (!(view instanceof MarkdownView) || !(view.file instanceof TFile)) return null;
    return this.resolveTaskLineFromCodeMirror(view, targetEl) ?? this.resolveTaskLineFromRenderedHost(view, targetEl);
  }

  private resolveMarkdownViewForElement(targetEl: HTMLElement): MarkdownView | null {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      const containerEl = (view as any).containerEl as HTMLElement | undefined;
      const contentEl = view.contentEl as HTMLElement | undefined;
      const previewContainer = (view as any).previewMode?.containerEl as HTMLElement | undefined;
      if (containerEl?.contains(targetEl) || contentEl?.contains(targetEl) || previewContainer?.contains(targetEl)) {
        return view;
      }
    }
    return null;
  }

  private resolveTaskLineFromCodeMirror(view: MarkdownView, targetEl: HTMLElement): TaskLineDragContext | null {
    const cmLine = targetEl.closest('.cm-line, .tps-gcm-linked-subitem-cm-line, [data-line]') as HTMLElement | null;
    if (!cmLine) return null;
    const cm = (view.editor as any)?.cm;
    if (!cm?.posAtDOM || !cm?.state?.doc) return null;
    try {
      const pos = cm.posAtDOM(cmLine, 0);
      const line = cm.state.doc.lineAt(pos);
      return this.contextFromLine(view.file as TFile, line.number - 1, String(line.text || ''));
    } catch {
      return null;
    }
  }

  private resolveTaskLineFromRenderedHost(view: MarkdownView, targetEl: HTMLElement): TaskLineDragContext | null {
    const host = targetEl.closest('li.task-list-item, li') as HTMLElement | null;
    if (!host) return null;
    const source = view.getViewData();
    const lines = source.split('\n');
    const renderedLine = host.getAttribute('data-line');
    const dataLine = renderedLine == null || renderedLine.trim() === '' ? Number.NaN : Number(renderedLine);
    if (Number.isFinite(dataLine)) {
      const context = this.contextFromLine(view.file as TFile, dataLine, lines[dataLine] || '');
      if (context) return context;
    }

    const hostText = normalizeTaskText(host.innerText || host.textContent || '');
    if (!hostText) return null;
    const matches: TaskLineDragContext[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const context = this.contextFromLine(view.file as TFile, index, lines[index] || '');
      if (!context) continue;
      const lineText = normalizeTaskText(context.title || context.rawLine);
      if (lineText && (hostText.includes(lineText) || lineText.includes(hostText))) matches.push(context);
    }
    return matches.length === 1 ? matches[0] : null;
  }

  private contextFromLine(file: TFile, lineNumber: number, rawLine: string): TaskLineDragContext | null {
    const parsed = parseTaskLine(rawLine);
    if (!parsed) return null;
    return {
      file,
      lineNumber,
      rawLine,
      checkboxToken: parsed.token,
      title: getTaskDisplayTitle(rawLine),
    };
  }

  private schedulePreparedCleanup(): void {
    if (this.preparedCleanupTimer != null) window.clearTimeout(this.preparedCleanupTimer);
    this.preparedCleanupTimer = window.setTimeout(() => this.clearPreparedDrag(), 250);
  }

  private clearPreparedDrag(): void {
    if (this.preparedCleanupTimer != null) {
      window.clearTimeout(this.preparedCleanupTimer);
      this.preparedCleanupTimer = null;
    }
    if (this.preparedEl) {
      this.preparedEl.removeAttribute('draggable');
      delete this.preparedEl.dataset.tpsTaskDragPayload;
      this.preparedEl.removeClass('tps-task-line-drag-source');
      this.preparedEl.removeClass('is-dragging');
    }
    this.preparedEl = null;
    if (this.activePointerDrag?.ghostEl) this.removeGhost(this.activePointerDrag.ghostEl);
    this.activePointerDrag = null;
  }

  private removeGhost(ghostEl: HTMLElement | null): void {
    if (!ghostEl) return;
    ghostEl.detach();
  }
}

function normalizeTaskText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
