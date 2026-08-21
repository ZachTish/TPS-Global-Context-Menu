import { EditorSelection, Prec, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isLivePreviewEditorRoot } from '../utils/markdown-editor-mode';

export type MarkdownBodySelectionRange = {
  from: number;
  to: number;
};

export function findMarkdownBodySelectionRange(source: string): MarkdownBodySelectionRange | null {
  const text = String(source || '');
  const firstBreak = text.indexOf('\n');
  if (firstBreak < 0) return null;
  const firstLine = text.slice(0, firstBreak).replace(/^\uFEFF/u, '').replace(/\r$/u, '');
  if (firstLine !== '---') return null;

  let lineStart = firstBreak + 1;
  while (lineStart <= text.length) {
    const nextBreak = text.indexOf('\n', lineStart);
    const lineEnd = nextBreak >= 0 ? nextBreak : text.length;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/u, '');
    if (line === '---' || line === '...') {
      return {
        from: nextBreak >= 0 ? nextBreak + 1 : text.length,
        to: text.length,
      };
    }
    if (nextBreak < 0) break;
    lineStart = nextBreak + 1;
  }

  return null;
}

export function isSelectAllShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing'>): boolean {
  return event.key.toLowerCase() === 'a'
    && (event.ctrlKey || event.metaKey)
    && !event.altKey
    && !event.shiftKey
    && !event.isComposing;
}

export function createLivePreviewBodySelectionExtension(): Extension {
  return Prec.highest(EditorView.domEventHandlers({
    keydown(event, view) {
      if (!isSelectAllShortcut(event)) return false;
      const sourceRoot = view.dom.closest('.markdown-source-view');
      if (!(sourceRoot instanceof HTMLElement) || !isLivePreviewEditorRoot(sourceRoot)) return false;
      const range = findMarkdownBodySelectionRange(view.state.doc.toString());
      if (!range) return false;

      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        selection: EditorSelection.single(range.from, range.to),
        userEvent: 'select',
      });
      return true;
    },
  }));
}
