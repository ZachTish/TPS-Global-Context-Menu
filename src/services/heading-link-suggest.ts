import { Component, Editor, MarkdownView, TFile } from 'obsidian';
import TPSGlobalContextMenuPlugin from '../main';

type HeadingLinkSuggestion = {
  file: TFile;
  display: string;
  detail: string;
  score: number;
};

type HeadingLinkContext = {
  editor: Editor;
  file: TFile;
  line: number;
  startCh: number;
  endCh: number;
};

export class HeadingLinkSuggest extends Component {
  private popoverEl: HTMLElement | null = null;
  private suggestions: HeadingLinkSuggestion[] = [];
  private context: HeadingLinkContext | null = null;
  private selectedIndex = 0;

  constructor(private plugin: TPSGlobalContextMenuPlugin) {
    super();
  }

  onload(): void {
    this.registerDomEvent(document, 'keyup', () => this.refresh());
    this.registerDomEvent(document, 'input', () => this.refresh(), true);
    this.registerDomEvent(document, 'click', (event) => {
      if (this.popoverEl?.contains(event.target as Node)) return;
      this.close();
    }, true);
    this.registerDomEvent(document, 'keydown', (event: KeyboardEvent) => {
      if (this.handleKeydown(event)) return;
      window.setTimeout(() => this.refresh(), 0);
    }, true);
  }

  onunload(): void {
    this.close();
  }

  private refresh(): void {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!view || !file || file.extension.toLowerCase() !== 'md') {
      this.close();
      return;
    }

    const editor = view.editor;
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line) || '';
    const beforeCursor = line.slice(0, cursor.ch).replace(/[\u200B-\u200D\uFEFF]/g, '');
    const match = beforeCursor.match(/^(#{1,6})\s+(.{2,})$/);
    if (!match) {
      this.close();
      return;
    }

    const query = (match[2] || '').trimStart();
    if (!query || query.startsWith('#') || query.includes('[[') || query.includes('](')) {
      this.close();
      return;
    }

    const suggestions = this.getSuggestions(file, query);
    if (suggestions.length === 0) {
      this.close();
      return;
    }

    this.context = {
      editor,
      file,
      line: cursor.line,
      startCh: beforeCursor.length - match[2].length,
      endCh: cursor.ch,
    };
    this.suggestions = suggestions;
    this.selectedIndex = Math.min(this.selectedIndex, suggestions.length - 1);
    this.render(view, cursor);
  }

  private getSuggestions(currentFile: TFile, query: string): HeadingLinkSuggestion[] {
    const normalizedQuery = this.normalize(query);
    if (normalizedQuery.length < 2) return [];

    const suggestions: HeadingLinkSuggestion[] = [];
    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      if (file.path === currentFile.path) continue;
      const candidate = this.buildSuggestion(file, normalizedQuery);
      if (candidate) suggestions.push(candidate);
    }

    return suggestions
      .sort((a, b) => a.score - b.score || a.display.localeCompare(b.display, undefined, { sensitivity: 'base' }))
      .slice(0, 12);
  }

  private render(view: MarkdownView, cursor: { line: number; ch: number }): void {
    if (!this.popoverEl) {
      this.popoverEl = document.body.createDiv({ cls: 'tps-gcm-heading-link-suggest' });
    }
    this.popoverEl.empty();

    this.suggestions.forEach((suggestion, index) => {
      const item = this.popoverEl!.createDiv({
        cls: `tps-gcm-heading-link-suggest-item${index === this.selectedIndex ? ' is-selected' : ''}`,
      });
      item.createDiv({ cls: 'tps-gcm-heading-link-suggest-title', text: suggestion.display });
      item.createDiv({ cls: 'tps-gcm-heading-link-suggest-detail', text: suggestion.detail });
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.select(index);
      });
    });

    const coords = this.getCursorCoords(view, cursor);
    this.popoverEl.style.left = `${coords.left}px`;
    this.popoverEl.style.top = `${coords.top}px`;
  }

  private getCursorCoords(view: MarkdownView, cursor: { line: number; ch: number }): { left: number; top: number } {
    const cm = (view.editor as any).cm;
    try {
      const line = cm?.state?.doc?.line(cursor.line + 1);
      const coords = line && cm?.coordsAtPos?.(line.from + cursor.ch);
      if (coords) return { left: coords.left, top: coords.bottom + 4 };
    } catch {
      // Fall through to view-relative placement.
    }
    const rect = view.contentEl.getBoundingClientRect();
    return { left: rect.left + 48, top: rect.top + 120 };
  }

  private handleKeydown(event: KeyboardEvent): boolean {
    if (!this.popoverEl || this.suggestions.length === 0) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return true;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.suggestions.length;
      this.renderSelectedState();
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + this.suggestions.length) % this.suggestions.length;
      this.renderSelectedState();
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.select(this.selectedIndex);
      return true;
    }
    return false;
  }

  private renderSelectedState(): void {
    if (!this.popoverEl) return;
    Array.from(this.popoverEl.children).forEach((child, index) => {
      child.classList.toggle('is-selected', index === this.selectedIndex);
    });
  }

  private select(index: number): void {
    const context = this.context;
    const suggestion = this.suggestions[index];
    if (!context || !suggestion) return;

    const link = this.plugin.app.fileManager.generateMarkdownLink(
      suggestion.file,
      context.file.path,
      undefined,
      suggestion.display,
    );
    context.editor.replaceRange(
      link,
      { line: context.line, ch: context.startCh },
      { line: context.line, ch: context.endCh },
    );
    context.editor.setCursor({ line: context.line, ch: context.startCh + link.length });
    this.close();
  }

  private close(): void {
    this.popoverEl?.remove();
    this.popoverEl = null;
    this.context = null;
    this.suggestions = [];
    this.selectedIndex = 0;
  }

  private buildSuggestion(file: TFile, normalizedQuery: string): HeadingLinkSuggestion | null {
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const title = String(cache?.frontmatter?.title ?? '').trim();
    const names = [
      { value: title, kind: 'title' },
      { value: file.basename, kind: 'filename' },
      ...this.getAliases(cache?.frontmatter).map((value) => ({ value, kind: 'alias' })),
    ].filter((entry) => entry.value.trim());

    let best: { value: string; kind: string; score: number } | null = null;
    for (const entry of names) {
      const score = this.matchScore(entry.value, normalizedQuery);
      if (score == null) continue;
      if (!best || score < best.score) best = { ...entry, score };
    }
    if (!best) return null;

    const display = title || best.value || file.basename;
    return {
      file,
      display,
      detail: `${best.kind} - ${file.path}`,
      score: best.score,
    };
  }

  private getAliases(frontmatter: Record<string, unknown> | undefined): string[] {
    if (!frontmatter) return [];
    const raw = (frontmatter as any).aliases ?? (frontmatter as any).alias;
    const source = Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw];
    return source
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
  }

  private matchScore(value: string, normalizedQuery: string): number | null {
    const normalizedValue = this.normalize(value);
    if (!normalizedValue) return null;
    if (normalizedValue === normalizedQuery) return 0;
    if (normalizedValue.startsWith(normalizedQuery)) return 1;
    if (normalizedValue.includes(normalizedQuery)) return 2;

    const compactValue = normalizedValue.replace(/[^a-z0-9]/g, '');
    const compactQuery = normalizedQuery.replace(/[^a-z0-9]/g, '');
    if (compactQuery.length >= 3 && compactValue.includes(compactQuery)) return 3;
    return null;
  }

  private normalize(value: string): string {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
}
