import { Component, MarkdownView, Menu, Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';

type FoldContext = {
  view: MarkdownView;
  lineIndex: number;
  endLineExclusive: number;
};

type LineKind = {
  type: 'heading' | 'list' | null;
  level: number;
};

const FOLD_EXPAND_RETRY_DELAYS_MS = [80, 240, 520];

export class FoldExpansionContextMenuService extends Component {
  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {
    super();
  }

  addMenuItemForTarget(menu: Menu, eventTarget: EventTarget | null | undefined, evt?: MouseEvent | null): void {
    const targetEl = this.resolveElement(eventTarget);
    if (!targetEl) return;

    const context = this.resolveFoldContext(targetEl, evt ?? null);
    if (!context) return;

    menu.addItem((item) => {
      (item as any)._isTpsItem = true;
      item
        .setTitle('Expand all under this line')
        .setIcon('list-tree')
        .setSection('tps-folds')
        .onClick(() => {
          const expanded = this.expandFoldTree(context);
          if (!expanded) {
            new Notice('No collapsed content found under this line.');
          }
        });
    });
  }

  private resolveElement(target: EventTarget | null | undefined): HTMLElement | null {
    if (target instanceof HTMLElement) return target;
    if (target instanceof Element) return target.closest<HTMLElement>('*');
    return null;
  }

  private resolveFoldContext(targetEl: HTMLElement, evt: MouseEvent | null): FoldContext | null {
    if (targetEl.closest('.workspace-leaf.mod-hidden, .menu, .modal, .suggestion-container')) return null;

    const view = this.resolveMarkdownViewForElement(targetEl);
    if (!(view instanceof MarkdownView) || !(view.file instanceof TFile) || view.file.extension !== 'md') {
      return null;
    }

    const lineIndex = this.resolveLineIndex(view, targetEl, evt);
    if (lineIndex === null) return null;

    const endLineExclusive = this.resolveFoldTreeEndLine(view, lineIndex);
    if (endLineExclusive <= lineIndex + 1) return null;

    return { view, lineIndex, endLineExclusive };
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

  private resolveLineIndex(view: MarkdownView, targetEl: HTMLElement, evt: MouseEvent | null): number | null {
    const cm = (view.editor as any)?.cm;
    if (evt && cm?.posAtCoords && cm?.state?.doc?.lineAt) {
      try {
        const pos = cm.posAtCoords({ x: evt.clientX, y: evt.clientY });
        if (typeof pos === 'number') {
          const line = cm.state.doc.lineAt(pos);
          return Math.max(0, Number(line.number || 1) - 1);
        }
      } catch {
        // Fall through to DOM hints.
      }
    }

    const cmLine = targetEl.closest<HTMLElement>('.cm-line, [data-line]');
    const dataLine = Number(cmLine?.getAttribute('data-line'));
    if (Number.isFinite(dataLine) && dataLine >= 0) return Math.floor(dataLine);

    if (cmLine && cm?.posAtDOM && cm?.state?.doc?.lineAt) {
      try {
        const pos = cm.posAtDOM(cmLine, 0);
        const line = cm.state.doc.lineAt(pos);
        return Math.max(0, Number(line.number || 1) - 1);
      } catch {
        // Fall through to no match.
      }
    }

    return null;
  }

  private resolveFoldTreeEndLine(view: MarkdownView, lineIndex: number): number {
    const lines = this.getEditorLines(view);
    if (lineIndex < 0 || lineIndex >= lines.length) return -1;

    const current = this.getLineKind(lines[lineIndex] || '');
    if (current.type === 'heading') {
      for (let index = lineIndex + 1; index < lines.length; index += 1) {
        const candidate = this.getLineKind(lines[index] || '');
        if (candidate.type === 'heading' && candidate.level <= current.level) return index;
      }
      return lines.length;
    }

    if (current.type === 'list') {
      for (let index = lineIndex + 1; index < lines.length; index += 1) {
        const line = lines[index] || '';
        if (!line.trim()) continue;
        if (this.getIndentWidth(line) <= current.level) return index;
      }
      return lines.length;
    }

    return -1;
  }

  private expandFoldTree(context: FoldContext): boolean {
    let didExpand = this.expandVisibleCollapsedLines(context);
    for (const delayMs of FOLD_EXPAND_RETRY_DELAYS_MS) {
      const timer = window.setTimeout(() => {
        if (this.expandVisibleCollapsedLines(context)) didExpand = true;
      }, delayMs);
      this.register(() => window.clearTimeout(timer));
    }
    return didExpand;
  }

  private expandVisibleCollapsedLines(context: FoldContext): boolean {
    const { view, lineIndex, endLineExclusive } = context;
    if (!(view.file instanceof TFile)) return false;
    const editor = view.editor;
    if (!editor) return false;

    const foldStartLines = this.getFoldStartLines(view, lineIndex, endLineExclusive)
      .filter((line) => this.isLineVisiblyCollapsed(view, line));
    if (!foldStartLines.length) return false;

    const cursor = editor.getCursor();
    const scroll = editor.getScrollInfo();
    editor.focus();

    for (const line of foldStartLines) {
      editor.setCursor({ line, ch: 0 });
      editor.exec('toggleFold');
    }

    editor.setCursor(cursor);
    editor.scrollTo(scroll.left, scroll.top);
    return true;
  }

  private getFoldStartLines(view: MarkdownView, startLine: number, endLineExclusive: number): number[] {
    const lines = this.getEditorLines(view);
    const result: number[] = [];
    for (let index = startLine; index < Math.min(endLineExclusive, lines.length); index += 1) {
      const childEnd = this.resolveFoldTreeEndLine(view, index);
      if (childEnd > index + 1) result.push(index);
    }
    return result;
  }

  private isLineVisiblyCollapsed(view: MarkdownView, lineIndex: number): boolean {
    const lineEl = this.resolveCodeMirrorLineElement(view, lineIndex) ?? this.resolveRenderedLineElement(view, lineIndex);
    if (!lineEl) return false;
    if (lineEl.matches('[aria-label*="unfold" i], [title*="unfold" i]')) return true;
    if (lineEl.querySelector('[aria-label*="unfold" i], [title*="unfold" i]')) return true;
    if (lineEl.querySelector('.cm-foldPlaceholder, .cm-foldplaceholder, .fold-placeholder')) return true;
    return Array.from(lineEl.querySelectorAll<HTMLElement>('*')).some((el) =>
      (el.innerText || el.textContent || '').trim() === '…'
    );
  }

  private resolveCodeMirrorLineElement(view: MarkdownView, lineIndex: number): HTMLElement | null {
    const cm = (view.editor as any)?.cm;
    if (!cm?.state?.doc || typeof cm.domAtPos !== 'function') return null;
    try {
      const line = cm.state.doc.line(lineIndex + 1);
      const domResult = cm.domAtPos(line.from);
      const node = domResult?.node;
      const element = node instanceof HTMLElement
        ? node.closest<HTMLElement>('.cm-line') || node
        : node?.parentElement?.closest?.('.cm-line');
      return element instanceof HTMLElement ? element : null;
    } catch {
      return null;
    }
  }

  private resolveRenderedLineElement(view: MarkdownView, lineIndex: number): HTMLElement | null {
    const previewEl = (view as any).previewMode?.containerEl as HTMLElement | undefined;
    const root = previewEl ?? view.contentEl;
    return root.querySelector<HTMLElement>(`[data-line="${lineIndex}"]`);
  }

  private getEditorLines(view: MarkdownView): string[] {
    const editor = view.editor as any;
    if (typeof editor?.lineCount === 'function' && typeof editor?.getLine === 'function') {
      const lines: string[] = [];
      for (let index = 0; index < editor.lineCount(); index += 1) {
        lines.push(String(editor.getLine(index) || ''));
      }
      return lines;
    }
    return String((view as any)?.data || '').split(/\r?\n/);
  }

  private getLineKind(line: string): LineKind {
    const headingMatch = line.match(/^(#{1,6})\s+\S/);
    if (headingMatch) return { type: 'heading', level: headingMatch[1].length };

    if (/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX/?\\-]\]\s+)?\S/.test(line)) {
      return { type: 'list', level: this.getIndentWidth(line) };
    }

    return { type: null, level: -1 };
  }

  private getIndentWidth(line: string): number {
    const leading = line.match(/^\s*/)?.[0] ?? '';
    return leading.replace(/\t/g, '    ').length;
  }
}
