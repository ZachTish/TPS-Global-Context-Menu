import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState, type Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  captureMarkdownHasContent,
  continueCaptureListAtCursor,
  parseCaptureLineMarker,
  removeCaptureListMarkerAtCursor,
  toggleCaptureTaskMarker,
} from './home-capture-markdown-core';

interface CaptureMarkdownEditorOptions {
  parentEl: HTMLElement;
  initialValue?: string;
  onChange: (markdown: string, hasContent: boolean) => void;
  onSubmit: () => void;
}

class CaptureListMarkerWidget extends WidgetType {
  constructor(
    private readonly kind: 'bullet' | 'task',
    private readonly checked: boolean,
  ) {
    super();
  }

  eq(other: CaptureListMarkerWidget): boolean {
    return this.kind === other.kind && this.checked === other.checked;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement('span');
    marker.className = `tps-home-capture-marker mod-${this.kind}`;
    marker.setAttribute('aria-hidden', 'true');
    if (this.kind === 'task') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = this.checked;
      checkbox.tabIndex = -1;
      checkbox.setAttribute('aria-hidden', 'true');
      marker.appendChild(checkbox);
    }
    return marker;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class CapturePlaceholderWidget extends WidgetType {
  toDOM(): HTMLElement {
    const placeholder = document.createElement('span');
    placeholder.className = 'tps-home-capture-editor-placeholder';
    placeholder.textContent = 'Write a note or thought...';
    placeholder.setAttribute('aria-hidden', 'true');
    return placeholder;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function selectionTouches(view: EditorView, from: number, to: number): boolean {
  return view.state.selection.ranges.some((range) => {
    if (!range.empty) return range.from < to && range.to > from;
    return range.head > from && range.head < to;
  });
}

function addDelimitedDecorations(
  ranges: Array<Range<Decoration>>,
  view: EditorView,
  lineText: string,
  lineFrom: number,
  expression: RegExp,
  className: string,
): void {
  expression.lastIndex = 0;
  for (const match of lineText.matchAll(expression)) {
    const index = match.index ?? 0;
    const delimiter = match[1];
    const body = match[2];
    if (!delimiter || body === undefined) continue;

    const from = lineFrom + index;
    const to = from + match[0].length;
    const bodyFrom = from + delimiter.length;
    const bodyTo = bodyFrom + body.length;
    if (selectionTouches(view, from, to)) continue;

    ranges.push(Decoration.replace({}).range(from, bodyFrom));
    ranges.push(Decoration.mark({ class: className }).range(bodyFrom, bodyTo));
    ranges.push(Decoration.replace({}).range(bodyTo, to));
  }
}

function buildCaptureDecorations(view: EditorView): DecorationSet {
  const ranges: Array<Range<Decoration>> = [];
  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    const marker = parseCaptureLineMarker(line.text);
    const bodyOffset = marker?.prefixLength ?? 0;

    if (marker) {
      ranges.push(Decoration.replace({
        widget: new CaptureListMarkerWidget(marker.kind, marker.checked),
      }).range(line.from + marker.indent.length, line.from + marker.prefixLength));

      if (marker.body.length === 0) {
        ranges.push(Decoration.widget({
          widget: new CapturePlaceholderWidget(),
          side: 1,
        }).range(line.from + marker.prefixLength));
      }
    }

    const bodyText = line.text.slice(bodyOffset);
    const bodyFrom = line.from + bodyOffset;
    addDelimitedDecorations(ranges, view, bodyText, bodyFrom, /(\*\*|__)(.+?)\1/g, 'tps-home-capture-md-strong');
    addDelimitedDecorations(ranges, view, bodyText, bodyFrom, /(`)([^`\n]+)\1/g, 'tps-home-capture-md-code');
    addDelimitedDecorations(ranges, view, bodyText, bodyFrom, /(==)(.+?)\1/g, 'tps-home-capture-md-highlight');
    addDelimitedDecorations(ranges, view, bodyText, bodyFrom, /(~~)(.+?)\1/g, 'tps-home-capture-md-strike');

    for (const match of bodyText.matchAll(/\[\[([^\]\n]+)\]\]|\[([^\]\n]+)\]\(([^)\n]+)\)/g)) {
      const index = match.index ?? 0;
      const from = bodyFrom + index;
      const to = from + match[0].length;
      ranges.push(Decoration.mark({ class: 'tps-home-capture-md-link' }).range(from, to));
    }
  }
  return Decoration.set(ranges, true);
}

const captureDecorations = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildCaptureDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = buildCaptureDecorations(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
});

const captureHighlightStyle = HighlightStyle.define([
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--link-color)', textDecoration: 'underline' },
  { tag: tags.monospace, fontFamily: 'var(--font-monospace)', color: 'var(--code-normal)' },
  { tag: tags.heading, fontWeight: '700', color: 'var(--text-normal)' },
  { tag: tags.quote, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--text-faint)' },
]);

const captureTheme = EditorView.theme({
  '&': {
    width: '100%',
    backgroundColor: 'transparent',
    color: 'var(--text-normal)',
    fontSize: 'var(--font-text-size)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'visible',
    fontFamily: 'var(--font-text)',
    lineHeight: 'var(--line-height-normal)',
  },
  '.cm-content': {
    minHeight: 'calc(var(--line-height-normal) * 1em)',
    padding: 'var(--size-4-2) var(--size-4-3)',
    caretColor: 'var(--caret-color)',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--caret-color)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--text-selection)',
  },
  '.tps-home-capture-marker': {
    display: 'inline-flex',
    width: '1.25em',
    marginRight: '0.15em',
    justifyContent: 'center',
    alignItems: 'center',
    verticalAlign: 'middle',
  },
  '.tps-home-capture-marker.mod-bullet::before': {
    content: '"\\2022"',
    fontSize: '1.15em',
    lineHeight: '1',
  },
  '.tps-home-capture-marker input': {
    width: 'var(--checkbox-size)',
    height: 'var(--checkbox-size)',
    margin: '0',
    pointerEvents: 'none',
  },
  '.tps-home-capture-editor-placeholder': { color: 'var(--text-faint)' },
  '.tps-home-capture-md-strong': { fontWeight: '700' },
  '.tps-home-capture-md-code': {
    padding: '0 0.2em',
    borderRadius: 'var(--radius-s)',
    backgroundColor: 'var(--code-background)',
    color: 'var(--code-normal)',
    fontFamily: 'var(--font-monospace)',
  },
  '.tps-home-capture-md-highlight': { backgroundColor: 'var(--text-highlight-bg)' },
  '.tps-home-capture-md-strike': { textDecoration: 'line-through' },
  '.tps-home-capture-md-link': { color: 'var(--link-color)', textDecoration: 'underline' },
});

export class CaptureMarkdownEditor {
  private readonly view: EditorView;

  constructor(private readonly options: CaptureMarkdownEditorOptions) {
    const toggleTask = (view: EditorView): boolean => {
      const lineNumbers = new Set<number>();
      for (const range of view.state.selection.ranges) {
        const first = view.state.doc.lineAt(range.from).number;
        const candidate = range.to > range.from && range.to === view.state.doc.lineAt(range.to).from
          ? range.to - 1
          : range.to;
        const last = view.state.doc.lineAt(Math.max(range.from, candidate)).number;
        for (let line = first; line <= last; line += 1) lineNumbers.add(line);
      }

      const changes = [...lineNumbers]
        .sort((a, b) => a - b)
        .map((lineNumber) => {
          const line = view.state.doc.line(lineNumber);
          return { from: line.from, to: line.to, insert: toggleCaptureTaskMarker(line.text) };
        });
      view.dispatch({ changes });
      return true;
    };

    const removeMarker = (view: EditorView): boolean => {
      const selection = view.state.selection.main;
      if (!selection.empty) return false;
      const line = view.state.doc.lineAt(selection.head);
      const edit = removeCaptureListMarkerAtCursor(line.text, selection.head - line.from);
      if (!edit) return false;
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: edit.text },
        selection: { anchor: line.from + edit.cursor },
      });
      return true;
    };

    const continueList = (view: EditorView): boolean => {
      const selection = view.state.selection.main;
      if (!selection.empty) return false;
      const line = view.state.doc.lineAt(selection.head);
      const edit = continueCaptureListAtCursor(line.text, selection.head - line.from);
      if (!edit) return false;
      view.dispatch({
        changes: {
          from: line.from + edit.from,
          to: line.from + edit.to,
          insert: edit.insert,
        },
        selection: { anchor: line.from + edit.cursor },
      });
      return true;
    };

    const state = EditorState.create({
      doc: options.initialValue ?? '- ',
      extensions: [
        history(),
        markdown(),
        syntaxHighlighting(captureHighlightStyle),
        captureDecorations,
        captureTheme,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          'aria-label': 'Capture text',
          'aria-multiline': 'true',
          role: 'textbox',
        }),
        keymap.of([
          { key: 'Mod-l', run: toggleTask, preventDefault: true },
          { key: 'Mod-Enter', run: () => { options.onSubmit(); return true; }, preventDefault: true },
          { key: 'Backspace', run: removeMarker },
          { key: 'Enter', run: continueList },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const value = update.state.doc.toString();
          options.onChange(value, captureMarkdownHasContent(value));
        }),
      ],
    });

    this.view = new EditorView({ state, parent: options.parentEl });
    options.onChange(this.value, captureMarkdownHasContent(this.value));
  }

  get value(): string {
    return this.view.state.doc.toString();
  }

  focus(): void {
    this.view.focus();
    const position = this.view.state.doc.length;
    this.view.dispatch({ selection: { anchor: position } });
  }

  destroy(): void {
    this.view.destroy();
  }
}
