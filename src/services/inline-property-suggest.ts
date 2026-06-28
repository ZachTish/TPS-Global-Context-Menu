import {
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  Notice,
  TFile,
} from 'obsidian';
import TPSGlobalContextMenuPlugin from '../main';
import type { CustomProperty } from '../types';

type InlinePropertySuggestion = {
  label: string;
  key: string;
  icon: string;
  type: string;
  action?: 'insert' | 'create';
};

const TASK_LINE_RE = /^\s*[-*+]\s+\[[^\]]\]\s+/;
const DEFAULT_INLINE_DENY_KEYS = new Set(['title', 'parent', 'parentof', 'folderpath', 'tpsinlineprops', 'tps-inline-props']);

export class InlinePropertySuggest extends EditorSuggest<InlinePropertySuggestion> {
  private lastQuery = '';

  constructor(private plugin: TPSGlobalContextMenuPlugin) {
    super(plugin.app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    if (!file || file.extension.toLowerCase() !== 'md') return null;

    const line = editor.getLine(cursor.line) || '';
    const beforeCursor = line.slice(0, cursor.ch);
    if (!this.canSetInlineOnLine(line, cursor, file)) return null;

    const match = beforeCursor.match(/@{2,}([A-Za-z0-9_-]*)$/);
    if (!match) return null;

    this.lastQuery = match[1] || '';
    return {
      start: { line: cursor.line, ch: cursor.ch - match[0].length },
      end: cursor,
      query: this.lastQuery,
    };
  }

  getSuggestions(context: EditorSuggestContext): InlinePropertySuggestion[] {
    const rawQuery = String(context.query || this.lastQuery || '').trim();
    const query = rawQuery.toLowerCase();
    const suggestions: InlinePropertySuggestion[] = this.getConfiguredProperties()
      .filter((property) => {
        const key = property.key.toLowerCase();
        const label = property.label.toLowerCase();
        return !query || key.includes(query) || label.includes(query);
      })
      .map((property) => ({
        label: property.label,
        key: property.key,
        icon: property.icon || 'braces',
        type: property.type,
        action: 'insert' as const,
      }));

    const normalizedCreateKey = this.normalizeNewPropertyKey(rawQuery);
    const hasExactProperty = normalizedCreateKey
      ? this.getConfiguredProperties().some((property) => property.key.toLowerCase() === normalizedCreateKey.toLowerCase())
      : true;
    if (normalizedCreateKey && !hasExactProperty && !DEFAULT_INLINE_DENY_KEYS.has(normalizedCreateKey.toLowerCase())) {
      suggestions.unshift({
        label: `Create "${normalizedCreateKey}"`,
        key: normalizedCreateKey,
        icon: 'plus',
        type: 'new text property',
        action: 'create',
      });
    }

    return suggestions;
  }

  renderSuggestion(suggestion: InlinePropertySuggestion, el: HTMLElement): void {
    el.createEl('div', {
      cls: 'tps-gcm-inline-property-suggest-title',
      text: suggestion.label,
    });
    el.createEl('small', {
      cls: 'tps-gcm-inline-property-suggest-detail',
      text: suggestion.action === 'create'
        ? `Create custom property · ${suggestion.key}`
        : `${suggestion.key} · ${suggestion.type}`,
    });
  }

  async selectSuggestion(suggestion: InlinePropertySuggestion): Promise<void> {
    const context = this.context;
    if (!context) return;

    if (suggestion.action === 'create') {
      await this.createInlineProperty(suggestion.key);
    }

    const insertion = `[${suggestion.key}:: ]`;
    context.editor.replaceRange(insertion, context.start, context.end);
    context.editor.setCursor({
      line: context.start.line,
      ch: context.start.ch + insertion.length - 1,
    });
  }

  private async createInlineProperty(key: string): Promise<void> {
    const normalizedKey = this.normalizeNewPropertyKey(key);
    if (!normalizedKey) return;
    const existing = (this.plugin.settings.properties || []).some((property) =>
      String(property?.key || '').trim().toLowerCase() === normalizedKey.toLowerCase(),
    );
    if (existing) return;

    if (!Array.isArray(this.plugin.settings.properties)) this.plugin.settings.properties = [];
    this.plugin.settings.properties.push({
      id: `inline-property-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      label: this.labelFromKey(normalizedKey),
      key: normalizedKey,
      type: 'text',
      showInCollapsed: true,
      showInContextMenu: true,
      allowInlineSet: true,
      showWhen: 'populated',
    });
    await this.plugin.saveSettings();
    new Notice(`Created custom property: ${normalizedKey}`);
  }

  private getConfiguredProperties(): InlinePropertySuggestion[] {
    const seen = new Set<string>();
    const properties: InlinePropertySuggestion[] = [];

    for (const property of this.plugin.settings.properties || []) {
      const normalized = this.normalizeProperty(property);
      if (!normalized) continue;
      const dedupeKey = normalized.key.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      properties.push(normalized);
    }

    return properties.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }

  private normalizeProperty(property: CustomProperty | null | undefined): InlinePropertySuggestion | null {
    if (!property || property.disabled || property.hidden || property.allowInlineSet === false) return null;
    const key = String(property.key || '').trim();
    if (!key) return null;
    if (DEFAULT_INLINE_DENY_KEYS.has(key.toLowerCase())) return null;
    if (property.allowInlineSet === undefined && DEFAULT_INLINE_DENY_KEYS.has(key.toLowerCase())) return null;
    return {
      label: String(property.label || key).trim() || key,
      key,
      icon: String(property.icon || '').trim() || 'braces',
      type: String(property.type || 'text').trim() || 'text',
    };
  }

  private normalizeNewPropertyKey(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const words = raw.match(/[A-Za-z0-9]+/g) || [];
    return words
      .map((word, index) => {
        const lower = word.toLowerCase();
        return index === 0 ? lower : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
      })
      .join('');
  }

  private labelFromKey(key: string): string {
    const spaced = String(key || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim();
    return spaced ? `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}` : key;
  }

  private canSetInlineOnLine(line: string, cursor: EditorPosition, file: TFile): boolean {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed === '---' || trimmed.startsWith('#') || trimmed.startsWith('```')) return false;
    if (/^[A-Za-z0-9_-]+\s*:/.test(trimmed)) return false;
    if (TASK_LINE_RE.test(line)) return true;

    const cache = this.app.metadataCache.getFileCache(file);
    const listItem = (cache?.listItems || []).find((item: any) => item?.position?.start?.line === cursor.line);
    if (listItem && typeof listItem.task === 'string') return true;

    return trimmed.includes('@@{') || /\[[A-Za-z0-9_-]+::\s*[^\]]*]/.test(trimmed);
  }
}
