import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { Menu, Notice, TFile } from 'obsidian';
import TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';
import { ScheduledModal } from '../modals/scheduled-modal';
import { TextInputModal } from '../modals/text-input-modal';
import type { CustomProperty } from '../types';
import {
  replaceExactLineRevision,
  type AtomicLineReplacementResult,
} from '../utils/atomic-line-replacement';
import {
  isEntityReferenceProperty,
  mergeEntityReferenceList,
  mergeMixedEntityReferenceList,
} from '../utils/entity-property';
import { openPropertyValueSuggestModal } from '../modals/PropertyValueSuggestModal';
import { isLinkListProperty, mergeLinkList, mergeMixedList } from '../utils/list-utils';
import { isStrictSourceEditorRoot } from '../utils/markdown-editor-mode';
import {
  parseTaskLine,
  readInlineFieldRanges,
  readInlineFieldValue,
  setInlineFieldValueOnLine,
} from '../utils/task-line-metadata';
import {
  isOwnedRenderedInlineElement,
  isOwnedRenderedInlineTextNode,
  RENDERED_INLINE_LINE_HOST_SELECTOR,
  resolveRenderedTextPosition,
} from '../utils/rendered-inline-property-dom';
import {
  abortDirectTaskHistory,
  beginDirectTaskHistory,
  commitDirectTaskHistory,
  ensureDirectTaskHistoryIdentity,
  type DirectTaskHistoryHandle,
  type DirectTaskHistoryLogContext,
} from '../utils/direct-task-history';

const HIDDEN_INLINE_METADATA_RE = /(?:\[\^\s*tps-inline:[^\]]+\](?::\s*\S+)?|<span\b[^>]*data-tps-inline-props="[^"]*"[^>]*>\s*<\/span>|<!--\s*tps-inline-props:[\s\S]*?\s*-->|\s*%%\s*tps-inline-props:[\s\S]*?\s*%%)/g;
const HIDDEN_INLINE_METADATA_LINE_RE = /^\s*(?:\[\^\s*tps-inline:[^\]]+\]:|tps-inline:[^\s:]+)\s*/;
const DEFAULT_INLINE_DENY_KEYS = new Set([
  'title',
  'parent',
  'parentof',
  'folderpath',
  'tpsid',
  'subitemid',
  'tpsinlineprops',
  'tps-inline-props',
]);
const HEALTH_FOOD_INLINE_KEYS = new Set([
  'food',
  'foodpath',
  'foodid',
  'qty',
  'unit',
  'servings',
  'amount',
  'amountunit',
  'cal',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'sugar',
  'alcohol',
  'sodium',
  'createddate',
  'completeddate',
]);
const HEALTH_FOOD_VISIBLE_INLINE_KEYS = new Set(['cal', 'protein', 'carbs', 'fat']);
const HEALTH_WORKOUT_INLINE_KEYS = new Set([
  'exercise',
  'exercisepath',
  'workout',
  'workoutpath',
  'workoutplan',
  'workoutplanpath',
  'setid',
  'createddate',
  'completeddate',
  'startedat',
  'endedat',
  'settype',
  'reps',
  'weight',
  'unit',
  'duration',
  'distance',
  'distanceunit',
  'rpe',
  'rest',
  'dropset',
  'superset',
  'note',
]);
const HEALTH_WORKOUT_VISIBLE_INLINE_KEYS = new Set([
  'settype',
  'reps',
  'weight',
  'unit',
  'duration',
  'distance',
  'distanceunit',
  'rpe',
  'rest',
  'dropset',
  'superset',
]);

type InlinePropertyLineTarget =
  | {
      kind: 'editor';
      view: EditorView;
      lineNumber: number;
      lineFrom: number;
      lineTo: number;
      lineText: string;
      file?: TFile;
    }
  | { kind: 'file'; file: TFile; lineIndex: number; lineText: string };

class InlinePropertyWidget extends WidgetType {
  constructor(
    private key: string,
    private value: string,
    private classToken: string,
  ) {
    super();
  }

  eq(other: InlinePropertyWidget): boolean {
    return other.key === this.key && other.value === this.value && other.classToken === this.classToken;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = [
      'tps-gcm-live-inline-property-chip',
      `tps-gcm-live-inline-property-chip--${this.classToken}`,
      this.value ? '' : 'tps-gcm-live-inline-property-chip--empty',
    ].filter(Boolean).join(' ');
    chip.dataset.tpsInlinePropertyKey = this.key;
    chip.dataset.tpsInlinePropertyValue = this.value;
    chip.setAttribute('aria-label', `${this.key}: ${this.value || 'empty'}`);

    const keyEl = chip.createSpan({ cls: 'tps-gcm-live-inline-property-chip-key', text: this.key });
    keyEl.setAttribute('aria-hidden', 'true');
    chip.createSpan({ cls: 'tps-gcm-live-inline-property-chip-separator', text: ':' });
    chip.createSpan({
      cls: 'tps-gcm-live-inline-property-chip-value',
      text: this.value || 'empty',
    });

    return chip;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class HiddenInlinePropertyWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'tps-gcm-hidden-inline-property';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}

export class InlinePropertyDecorationService {
  constructor(private plugin: TPSGlobalContextMenuPlugin) {}

  getEditorExtension(): Extension {
    const service = this;
    return [
      ViewPlugin.fromClass(
        class {
          decorations: DecorationSet;
          private normalizeTimer: number | null = null;
          private normalizing = false;

          constructor(view: EditorView) {
            this.decorations = service.buildDecorations(view);
          }

          update(update: ViewUpdate): void {
            if (
              update.docChanged ||
              update.viewportChanged ||
              update.selectionSet ||
              update.transactions.some((transaction) => transaction.reconfigured)
            ) {
              this.decorations = service.buildDecorations(update.view);
            }
            if (update.docChanged && !this.normalizing) {
              if (this.normalizeTimer !== null) window.clearTimeout(this.normalizeTimer);
              this.normalizeTimer = window.setTimeout(() => {
                this.normalizeTimer = null;
                this.normalizing = true;
                try {
                  service.normalizeInlineDateTimeValues(update.view);
                } finally {
                  this.normalizing = false;
                }
              }, 0);
            }
          }

          destroy(): void {
            if (this.normalizeTimer !== null) window.clearTimeout(this.normalizeTimer);
            this.normalizeTimer = null;
          }
        },
        {
          decorations: (pluginValue) => pluginValue.decorations,
        },
      ),
      EditorView.domEventHandlers({
        contextmenu(event, view) {
          return service.handleInlinePropertyContextMenu(event, view);
        },
        keydown(event, view) {
          return service.handleScheduledTaskContinuationKeydown(event, view);
        },
      }),
    ];
  }

  public handleRenderedInlinePropertyContextMenu(event: MouseEvent): boolean {
    return this.handleInlinePropertyContextMenu(event, null);
  }

  private handleInlinePropertyContextMenu(event: MouseEvent, view: EditorView | null): boolean {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const field = target?.closest<HTMLElement>(
      [
        '.tps-gcm-live-inline-property-chip',
        '.tps-gcm-rendered-inline-property-chip',
        '.dataview.inline-field',
      ].join(', '),
    );
    if (!field) return false;

    const key = this.readInlinePropertyElementKey(field);
    if (!key) return false;
    const property = this.getConfiguredInlineProperty(key);
    if (!property || !this.isInlinePropertyEditable(property)) return false;

    event.preventDefault();
    event.stopPropagation();

    if (!view) {
      void this.resolveRenderedInlinePropertyLine(field, key).then((targetLine) => {
        if (targetLine) {
          this.showInlinePropertyMenu(event, property, key, targetLine);
        } else {
          new Notice(`Could not locate the inline ${key} field in the source line.`);
        }
      });
      return true;
    }

    const targetLine = this.resolveEditorInlinePropertyLine(view, event, key);
    if (!targetLine) return false;
    this.showInlinePropertyMenu(event, property, key, targetLine);
    return true;
  }

  private showInlinePropertyMenu(
    event: MouseEvent,
    property: CustomProperty,
    key: string,
    targetLine: InlinePropertyLineTarget,
  ): void {
    const menu = new Menu();
    menu.addItem((item) => {
      const isDatetime = property.type === 'datetime';
      const isEntityReference = isEntityReferenceProperty(property);
      item
        .setTitle(`Edit ${property.label || key}`)
        .setIcon(isEntityReference ? 'file-search' : isDatetime ? 'calendar-clock' : 'pencil')
        .onClick(() => {
          if (isEntityReference) {
            const current = this.readInlineFieldValueFromLine(targetLine.lineText, key);
            openPropertyValueSuggestModal(this.plugin.app, this.plugin, property, current, async (choice) => {
              if (choice.kind === 'clear') {
                await this.replaceInlinePropertyLine(
                  targetLine,
                  this.setInlineFieldValue(targetLine.lineText, key, null),
                );
                return;
              }
              const current = this.readInlineFieldValueFromLine(targetLine.lineText, key);
              const nextValue = property.type === 'list'
                ? choice.kind === 'entity'
                  ? isLinkListProperty(property)
                    ? mergeEntityReferenceList(current, choice.value).join(', ')
                    : mergeMixedEntityReferenceList(current, choice.value).join(', ')
                  : isLinkListProperty(property)
                    ? mergeLinkList(current, choice.value).join(', ')
                    : mergeMixedList(current, choice.value).join(', ')
                : choice.value;
              await this.replaceInlinePropertyLine(
                targetLine,
                this.setInlineFieldValue(targetLine.lineText, key, nextValue),
              );
            });
          }
          else if (isDatetime) this.openInlineScheduledModal(targetLine, key);
          else this.openInlineValueModal(targetLine, property, key);
        });
    });
    if (property.type !== 'datetime' || isEntityReferenceProperty(property)) {
      menu.addItem((item) => {
        item
          .setTitle(`Clear ${property.label || key}`)
          .setIcon('x')
          .onClick(() => {
            void this.replaceInlinePropertyLine(targetLine, this.setInlineFieldValue(targetLine.lineText, key, null));
          });
      });
    }
    menu.showAtPosition({ x: event.pageX, y: event.pageY });
  }

  private resolveEditorInlinePropertyLine(
    view: EditorView,
    event: MouseEvent,
    key: string,
  ): Extract<InlinePropertyLineTarget, { kind: 'editor' }> | null {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return null;
    const clickedLine = view.state.doc.lineAt(pos);
    if (this.lineContainsInlineKey(clickedLine.text, key)) {
      return {
        kind: 'editor',
        view,
        lineNumber: clickedLine.number,
        lineFrom: clickedLine.from,
        lineTo: clickedLine.to,
        lineText: clickedLine.text,
        file: this.resolveEditorSourceFile(view) ?? undefined,
      };
    }

    const fromLine = Math.max(1, clickedLine.number - 3);
    const toLine = Math.min(view.state.doc.lines, clickedLine.number + 3);
    for (let lineNo = fromLine; lineNo <= toLine; lineNo += 1) {
      const line = view.state.doc.line(lineNo);
      if (this.lineContainsInlineKey(line.text, key)) {
        return {
          kind: 'editor',
          view,
          lineNumber: line.number,
          lineFrom: line.from,
          lineTo: line.to,
          lineText: line.text,
          file: this.resolveEditorSourceFile(view) ?? undefined,
        };
      }
    }
    return null;
  }

  private resolveEditorSourceFile(view: EditorView): TFile | null {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const markdownView = leaf.view as any;
      const editorView = markdownView?.editor?.cm;
      const containerEl = markdownView?.containerEl as HTMLElement | undefined;
      const contentEl = markdownView?.contentEl as HTMLElement | undefined;
      if (editorView === view || containerEl?.contains(view.dom) || contentEl?.contains(view.dom)) {
        return markdownView.file instanceof TFile ? markdownView.file : null;
      }
    }
    return null;
  }

  private resolveRenderedInlinePropertyLine(
    field: HTMLElement,
    key: string,
  ): Promise<{ kind: 'file'; file: TFile; lineIndex: number; lineText: string } | null> {
    const file = this.plugin.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') return Promise.resolve(null);

    const currentValue = this.readInlinePropertyElementValue(field);
    return this.plugin.app.vault.cachedRead(file).then((content) => {
      const lines = content.split(/\r?\n/);
      const candidates = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => this.lineContainsInlineKey(line, key));
      if (candidates.length === 1) {
        return { kind: 'file', file, lineIndex: candidates[0].index, lineText: candidates[0].line };
      }
      const exact = candidates.find(({ line }) => {
        const value = this.readInlineFieldValueFromLine(line, key);
        return currentValue && value === currentValue;
      });
      return exact ? { kind: 'file', file, lineIndex: exact.index, lineText: exact.line } : null;
    });
  }

  private openInlineScheduledModal(targetLine: InlinePropertyLineTarget, key: string): void {
    const lineText = targetLine.lineText;
    const scheduled = this.readInlineFieldValueFromLine(lineText, key);
    const timeEstimate = Number.parseInt(this.readInlineFieldValueFromLine(lineText, 'timeEstimate') || '0', 10) || 0;
    const allDay = /^true$/i.test(this.readInlineFieldValueFromLine(lineText, 'allDay') || '');

    new ScheduledModal(this.plugin.app, scheduled, timeEstimate, allDay, async (result) => {
      const clearing = !String(result.date || '').trim();
      let nextLine = lineText;
      nextLine = this.setInlineFieldValue(nextLine, key, clearing ? null : result.date);
      nextLine = this.setInlineFieldValue(nextLine, 'timeEstimate', clearing ? null : String(result.timeEstimate || 0));
      nextLine = this.setInlineFieldValue(nextLine, 'allDay', clearing || !result.allDay ? null : 'true');
      await this.replaceInlinePropertyLine(targetLine, nextLine);
    }).open();
  }

  private openInlineValueModal(targetLine: InlinePropertyLineTarget, property: CustomProperty, key: string): void {
    const current = this.readInlineFieldValueFromLine(targetLine.lineText, key);
    new TextInputModal(this.plugin.app, property.label || key, current, async (value) => {
      const nextValue = String(value || '').trim();
      if (property.type === 'number' && nextValue) {
        const parsed = Number(nextValue);
        if (!Number.isFinite(parsed)) {
          new Notice(`${property.label || key} must be a number.`);
          return;
        }
      }
      await this.replaceInlinePropertyLine(targetLine, this.setInlineFieldValue(targetLine.lineText, key, nextValue || null));
    }).open();
  }

  private isInlinePropertyEditable(property: CustomProperty): boolean {
    return isEntityReferenceProperty(property)
      || property.type === 'datetime'
      || property.type === 'number'
      || property.type === 'text';
  }

  private async replaceInlinePropertyLine(targetLine: InlinePropertyLineTarget, nextLine: string): Promise<void> {
    if (targetLine.kind === 'editor') {
      const requestedLineNumber = targetLine.lineNumber;
      try {
        const currentDoc = targetLine.view.state.doc;
        const replacement = replaceExactLineRevision(
          currentDoc.toString(),
          requestedLineNumber - 1,
          targetLine.lineText,
          nextLine,
        );
        if (replacement.route === 'conflict' || replacement.resolvedLineIndex === null) {
          logger.flowWarn('InlineProperty', 'editor-edit:conflict', {
            requestedLine: requestedLineNumber,
            reason: replacement.conflictReason || 'unresolved',
          });
          new Notice('Could not update inline property because the source line changed.');
          return;
        }

        const currentLine = currentDoc.line(replacement.resolvedLineIndex + 1);
        if (currentLine.text !== targetLine.lineText) {
          logger.flowWarn('InlineProperty', 'editor-edit:conflict', {
            requestedLine: requestedLineNumber,
            reason: 'revision-mismatch',
          });
          new Notice('Could not update inline property because the source line changed.');
          return;
        }
        if (nextLine === currentLine.text) return;
        targetLine.view.dispatch({
          changes: { from: currentLine.from, to: currentLine.to, insert: nextLine },
        });
        const settledLine = targetLine.view.state.doc.line(replacement.resolvedLineIndex + 1);
        if (settledLine.text !== nextLine) {
          logger.flowWarn('InlineProperty', 'editor-edit:conflict', {
            requestedLine: requestedLineNumber,
            reason: 'dispatch-not-confirmed',
          });
          new Notice('Could not confirm the inline property update.');
          return;
        }
        targetLine.lineNumber = settledLine.number;
        targetLine.lineFrom = settledLine.from;
        targetLine.lineTo = settledLine.to;
        targetLine.lineText = settledLine.text;
        logger.flow('InlineProperty', 'editor-edit:done', {
          requestedLine: requestedLineNumber,
          resolvedLine: settledLine.number,
          route: replacement.route,
        });
      } catch (error) {
        logger.flowError('InlineProperty', 'editor-edit:failed', error, {
          requestedLine: requestedLineNumber,
        });
        new Notice('Could not update inline property. The note was not changed.');
      }
      return;
    }

    const requestedLineIndex = targetLine.lineIndex;
    let replacement: AtomicLineReplacementResult | null = null;
    let committedLine = '';
    let historyReady = true;
    const historyContext: DirectTaskHistoryLogContext = {
      action: 'task.update',
      surface: 'inline-property',
      path: targetLine.file.path,
      lineNumber: requestedLineIndex,
    };
    const historyHandle = nextLine !== targetLine.lineText && parseTaskLine(targetLine.lineText)
      ? await beginDirectTaskHistory(this.plugin.itemHistoryService, {
          action: historyContext.action,
          cause: {
            kind: 'user',
            sourcePluginId: 'tps-global-context-menu',
            surface: historyContext.surface,
          },
          before: {
            path: targetLine.file.path,
            lineNumber: requestedLineIndex,
            rawLine: targetLine.lineText,
          },
        })
      : null;
    if (nextLine === targetLine.lineText) return;
    try {
      await this.plugin.app.vault.process(targetLine.file, (content) => {
        const candidate = replaceExactLineRevision(
          content,
          requestedLineIndex,
          targetLine.lineText,
          nextLine,
        );
        if (candidate.route === 'conflict' || candidate.resolvedLineIndex === null) {
          replacement = candidate;
          return candidate.content;
        }
        const ensured = ensureDirectTaskHistoryIdentity(
          this.plugin.itemHistoryService,
          historyHandle,
          nextLine,
          historyContext,
        );
        historyReady = ensured.ready;
        committedLine = ensured.line;
        replacement = ensured.line === nextLine
          ? candidate
          : replaceExactLineRevision(
              content,
              requestedLineIndex,
              targetLine.lineText,
              ensured.line,
            );
        return replacement.content;
      });
    } catch (error) {
      await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
      logger.flowError('InlineProperty', 'file-edit:failed', error, {
        path: targetLine.file.path,
        requestedLine: requestedLineIndex + 1,
      });
      new Notice('Could not update inline property. The note was not changed.');
      return;
    }

    const settled = replacement as AtomicLineReplacementResult | null;
    if (!settled || settled.route === 'conflict' || settled.resolvedLineIndex === null) {
      await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
      logger.flowWarn('InlineProperty', 'file-edit:conflict', {
        path: targetLine.file.path,
        requestedLine: requestedLineIndex + 1,
        reason: settled?.conflictReason || 'unresolved',
      });
      new Notice('Could not update inline property because the source line changed.');
      return;
    }

    if (historyReady && committedLine) {
      await commitDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, {
        confirmedBefore: {
          path: targetLine.file.path,
          lineNumber: settled.resolvedLineIndex,
          rawLine: targetLine.lineText,
        },
        after: {
          path: targetLine.file.path,
          lineNumber: settled.resolvedLineIndex,
          rawLine: committedLine,
        },
        sourceDisposition: 'retained',
        outcome: 'committed',
      }, historyContext);
    } else {
      await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
    }

    targetLine.lineIndex = settled.resolvedLineIndex;
    targetLine.lineText = committedLine || nextLine;
    logger.flow('InlineProperty', 'file-edit:done', {
      path: targetLine.file.path,
      requestedLine: requestedLineIndex + 1,
      resolvedLine: settled.resolvedLineIndex + 1,
      route: settled.route,
    });
  }

  private setInlineFieldValue(lineText: string, key: string, value: string | null): string {
    return setInlineFieldValueOnLine(lineText, key, value);
  }

  private lineContainsInlineKey(lineText: string, key: string): boolean {
    return readInlineFieldValue(lineText, key).length > 0
      || readInlineFieldRanges(lineText).some((field) => field.key.toLowerCase() === key.trim().toLowerCase());
  }

  private readInlineFieldValueFromLine(lineText: string, key: string): string {
    return readInlineFieldValue(lineText, key);
  }

  private readInlinePropertyElementKey(field: HTMLElement): string {
    const datasetKey =
      field.dataset.tpsInlinePropertyKey ||
      field.dataset.propertyKey ||
      field.dataset.propertyName ||
      field.getAttribute('data-tps-inline-property-key') ||
      field.getAttribute('data-property-key') ||
      field.getAttribute('data-property-name') ||
      '';
    if (datasetKey.trim()) return datasetKey.trim();
    return this.readRenderedInlineFieldKey(field);
  }

  private readInlinePropertyElementValue(field: HTMLElement): string {
    const datasetValue =
      field.dataset.tpsInlinePropertyValue ||
      field.dataset.propertyValue ||
      field.getAttribute('data-tps-inline-property-value') ||
      field.getAttribute('data-property-value') ||
      '';
    if (datasetValue.trim()) return datasetValue.trim();

    const valueEl = field.querySelector<HTMLElement>('.dataview.inline-field-value, .metadata-property-value, .tps-gcm-live-inline-property-chip-value');
    const raw = valueEl?.textContent || field.textContent || '';
    const inlineField = readInlineFieldRanges(raw)[0];
    if (inlineField) return inlineField.value.trim();
    const colonMatch = raw.match(/^[A-Za-z0-9_-]+\s*::?\s*(.+)$/);
    return colonMatch?.[1]?.trim() || raw.trim();
  }

  private getConfiguredInlineProperty(key: string): CustomProperty | null {
    const normalized = key.toLowerCase();
    return (this.plugin.settings.properties || []).find((property) => {
      const propertyKey = String(property?.key || '').trim().toLowerCase();
      return propertyKey === normalized && !property.disabled && !property.hidden && property.allowInlineSet !== false;
    }) || null;
  }

  private handleScheduledTaskContinuationKeydown(event: KeyboardEvent, view: EditorView): boolean {
    const root = view.dom.closest('.markdown-source-view.mod-cm6') as HTMLElement | null;
    if (isStrictSourceEditorRoot(root)) return false;
    if (event.defaultPrevented || event.isComposing) return false;
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if (view.state.selection.ranges.length !== 1) return false;
    const range = view.state.selection.main;
    if (!range.empty) return false;

    const printable = event.key.length === 1;
    if (event.key !== 'Enter' && !printable) return false;

    const line = view.state.doc.lineAt(range.from);
    if (!this.isContinuationCandidateLine(line.text, range.from - line.from)) return false;

    const childIndent = `${this.getLineIndent(line.text)}  - `;
    const insertedText = event.key === 'Enter'
      ? `\n${childIndent}`
      : `\n${childIndent}${event.key === ' ' ? '' : event.key}`;
    const insertAt = line.to;
    const cursor = insertAt + insertedText.length;

    event.preventDefault();
    view.dispatch({
      changes: { from: insertAt, to: insertAt, insert: insertedText },
      selection: { anchor: cursor },
      scrollIntoView: true,
    });
    return true;
  }

  private isContinuationCandidateLine(lineText: string, cursorCh: number): boolean {
    if (!/^\s*[-*]\s+\[[^\]]*]\s+/.test(lineText)) return false;
    const hasInlineField = readInlineFieldRanges(lineText).length > 0;
    if (
      !hasInlineField &&
      !/(?:\[\^\s*tps-inline:|^\s*tps-inline:|data-tps-inline-props=|<!--\s*tps-inline-props:|%%\s*tps-inline-props:)/.test(lineText)
    ) return false;
    const end = lineText.length;
    return cursorCh >= lineText.trimEnd().length && cursorCh <= end;
  }

  private getLineIndent(lineText: string): string {
    return lineText.match(/^\s*/)?.[0] || '';
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const root = view.dom.closest('.markdown-source-view.mod-cm6') as HTMLElement | null;
    if (isStrictSourceEditorRoot(root)) return Decoration.none;

    const inlineKeys = this.getInlinePropertyKeys();

    const builder = new RangeSetBuilder<Decoration>();
    const seenLines = new Set<number>();

    for (const range of view.visibleRanges) {
      let pos = range.from;
      while (pos <= range.to) {
        const line = view.state.doc.lineAt(pos);
        if (!seenLines.has(line.from)) {
          seenLines.add(line.from);
          this.addLineDecorations(builder, view, line.from, line.text, inlineKeys);
        }
        if (line.to >= range.to) break;
        pos = line.to + 1;
      }
    }

    return builder.finish();
  }

  private normalizeInlineDateTimeValues(view: EditorView): void {
    const root = view.dom.closest('.markdown-source-view.mod-cm6') as HTMLElement | null;
    if (isStrictSourceEditorRoot(root)) return;
    const dateTimeKeys = this.getInlineDateTimePropertyKeys();
    if (dateTimeKeys.size === 0) return;

    const changes: Array<{ from: number; to: number; insert: string }> = [];
    const seenLines = new Set<number>();

    for (const range of view.visibleRanges) {
      let pos = range.from;
      while (pos <= range.to) {
        const line = view.state.doc.lineAt(pos);
        if (!seenLines.has(line.from)) {
          seenLines.add(line.from);
          this.collectInlineDateTimeNormalizations(changes, view, line.from, line.text, dateTimeKeys);
        }
        if (line.to >= range.to) break;
        pos = line.to + 1;
      }
    }

    if (changes.length === 0) return;
    view.dispatch({ changes });
  }

  private collectInlineDateTimeNormalizations(
    changes: Array<{ from: number; to: number; insert: string }>,
    view: EditorView,
    lineFrom: number,
    lineText: string,
    dateTimeKeys: Set<string>,
  ): void {
    for (const field of readInlineFieldRanges(lineText)) {
      const propertyKey = field.key.trim();
      if (!dateTimeKeys.has(propertyKey.toLowerCase())) continue;

      const value = field.value;
      const normalized = this.normalizeInlineDateTimeValue(value);
      if (normalized === value) continue;

      const fieldSource = lineText.slice(field.start, field.end);
      const valueOffset = fieldSource.indexOf(value);
      if (valueOffset < 0) continue;
      const from = lineFrom + field.start + valueOffset;
      const to = from + value.length;
      if (this.selectionIntersects(view, from, to)) continue;
      changes.push({ from, to, insert: normalized });
    }
  }

  private normalizeInlineDateTimeValue(value: string): string {
    return String(value || '').replace(
      /^(\s*\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2}(?::\d{2})?(?:\s*)$)/,
      '$1 $2',
    );
  }

  private addLineDecorations(
    builder: RangeSetBuilder<Decoration>,
    view: EditorView,
    lineFrom: number,
    lineText: string,
    inlineKeys: Set<string>,
  ): void {
    const replacements: Array<{ from: number; to: number; decoration: Decoration }> = [];

    if (HIDDEN_INLINE_METADATA_LINE_RE.test(lineText)) {
      builder.add(
        lineFrom,
        lineFrom,
        Decoration.line({
          class: 'tps-gcm-hidden-inline-metadata-line',
        }),
      );
    }

    HIDDEN_INLINE_METADATA_RE.lastIndex = 0;
    let hiddenMatch: RegExpExecArray | null;
    while ((hiddenMatch = HIDDEN_INLINE_METADATA_RE.exec(lineText)) !== null) {
      const from = lineFrom + hiddenMatch.index;
      const to = from + hiddenMatch[0].length;
      replacements.push({
        from,
        to,
        decoration: Decoration.replace({
          widget: new HiddenInlinePropertyWidget(),
          inclusive: false,
        }),
      });
    }
    HIDDEN_INLINE_METADATA_RE.lastIndex = 0;

    const isHealthFoodLine = this.isHealthFoodInlineLine(lineText);
    const isHealthWorkoutSetLine = this.isHealthWorkoutSetInlineLine(lineText);
    for (const field of readInlineFieldRanges(lineText)) {
      const propertyKey = field.key.trim();
      const value = field.value.trim();
      const from = lineFrom + field.start;
      const to = lineFrom + field.end;
      const normalizedKey = propertyKey.toLowerCase();
      const isReservedMetadata = DEFAULT_INLINE_DENY_KEYS.has(normalizedKey)
        && (normalizedKey.startsWith('tps') || normalizedKey === 'subitemid');
      if (!isReservedMetadata && this.selectionIntersects(view, from, to)) continue;
      const isVisible =
        !isReservedMetadata &&
        inlineKeys.has(normalizedKey) &&
        (!isHealthFoodLine || this.isVisibleHealthFoodInlineKey(normalizedKey)) &&
        (!isHealthWorkoutSetLine || this.isVisibleHealthWorkoutInlineKey(normalizedKey));

      replacements.push({
        from,
        to,
        decoration: Decoration.replace({
          widget: isVisible
            ? new InlinePropertyWidget(propertyKey, value, this.toClassToken(propertyKey))
            : new HiddenInlinePropertyWidget(),
          inclusive: false,
        }),
      });
    }

    replacements
      .sort((a, b) => a.from - b.from || a.to - b.to)
      .forEach(({ from, to, decoration }) => builder.add(from, to, decoration));
  }

  private selectionIntersects(view: EditorView, from: number, to: number): boolean {
    for (const range of view.state.selection.ranges) {
      if (range.empty && range.from >= from && range.from <= to) return true;
      if (!range.empty && range.from < to && range.to > from) return true;
    }
    return false;
  }

  private getInlinePropertyKeys(): Set<string> {
    const keys = new Set<string>();
    if (this.plugin.settings.showCustomPropertiesInInlineUi === false) return keys;

    for (const property of this.plugin.settings.properties || []) {
      const key = this.normalizeInlinePropertyKey(property);
      if (key) keys.add(key.toLowerCase());
    }

    return keys;
  }

  processRenderedInlineProperties(root: HTMLElement): void {
    const visibleKeys = this.getInlinePropertyKeys();
    const fields = Array.from(root.querySelectorAll<HTMLElement>('.dataview.inline-field, .metadata-property'));
    for (const field of fields) {
      const key = this.readRenderedInlineFieldKey(field);
      if (!key) continue;
      const normalizedKey = key.toLowerCase();
      const isHealthFoodLogField = this.isRenderedHealthFoodLogField(field);
      const isHealthWorkoutSetField = this.isRenderedHealthWorkoutSetField(field);
      const isReservedMetadata = DEFAULT_INLINE_DENY_KEYS.has(normalizedKey);
      const isVisible =
        !isReservedMetadata &&
        visibleKeys.has(normalizedKey) &&
        (!isHealthFoodLogField || this.isVisibleHealthFoodInlineKey(normalizedKey)) &&
        (!isHealthWorkoutSetField || this.isVisibleHealthWorkoutInlineKey(normalizedKey));
      this.setRenderedInlineFieldVisibility(field, key, isVisible);
    }
    this.hideRenderedHiddenInlineMetadata(root);
    this.processRawRenderedInlineFields(root, visibleKeys);
    this.groupRenderedHealthFoodChips(root);
  }

  private setRenderedInlineFieldVisibility(field: HTMLElement, key: string, isVisible: boolean): void {
    const classToken = `tps-gcm-rendered-inline-property-chip--${this.toClassToken(key)}`;
    if (isVisible) {
      field.hidden = false;
      field.style.removeProperty('display');
      field.classList.add('tps-gcm-rendered-inline-property-chip', classToken);
      field.classList.remove('tps-gcm-hidden-inline-property-rendered');
      field.removeAttribute('aria-hidden');
    } else {
      field.hidden = true;
      field.style.setProperty('display', 'none', 'important');
      field.classList.add('tps-gcm-hidden-inline-property-rendered');
      field.classList.remove('tps-gcm-rendered-inline-property-chip', classToken);
      field.setAttribute('aria-hidden', 'true');
    }
  }

  private hideRenderedHiddenInlineMetadata(root: HTMLElement): void {
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(RENDERED_INLINE_LINE_HOST_SELECTOR));
    for (const block of blocks) {
      const text = this.getOwnedRenderedText(block);
      const hasOwnedMetadataElement = Array.from(block.querySelectorAll<HTMLElement>('[data-tps-inline-props]'))
        .some((element) => isOwnedRenderedInlineElement(block, element));
      if (!text.includes('tps-inline-props') && !text.includes('tps-inline:') && !hasOwnedMetadataElement) continue;
      if (!/(?:\[\^tps-inline:|data-tps-inline-props=|<!--\s*tps-inline-props:|%%\s*tps-inline-props:)/.test(text) && !hasOwnedMetadataElement) continue;
      block.classList.add('tps-gcm-hidden-inline-metadata-host');
      this.wrapRenderedTextPattern(block, HIDDEN_INLINE_METADATA_RE, 'tps-gcm-hidden-inline-property-rendered');
    }
  }

  private wrapRenderedTextPattern(block: HTMLElement, pattern: RegExp, className: string): void {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        return isOwnedRenderedInlineTextNode(block, parent)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    let current: Node | null;
    while ((current = walker.nextNode())) textNodes.push(current as Text);
    if (!textNodes.length) return;

    let combined = '';
    const ranges: Array<{ node: Text; start: number; end: number }> = [];
    for (const node of textNodes) {
      const start = combined.length;
      combined += node.nodeValue || '';
      ranges.push({ node, start, end: combined.length });
    }

    const matches: Array<{ from: number; to: number }> = [];
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(combined)) !== null) {
      matches.push({ from: match.index, to: match.index + match[0].length });
    }
    pattern.lastIndex = 0;

    for (const item of matches.reverse()) {
      const start = resolveRenderedTextPosition(ranges, item.from, 'start');
      const end = resolveRenderedTextPosition(ranges, item.to, 'end');
      if (!start || !end) continue;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const wrapper = document.createElement('span');
      wrapper.className = className;
      wrapper.hidden = true;
      wrapper.style.setProperty('display', 'none', 'important');
      wrapper.setAttribute('aria-hidden', 'true');
      wrapper.append(range.extractContents());
      range.insertNode(wrapper);
    }
  }

  private processRawRenderedInlineFields(root: HTMLElement, visibleKeys: Set<string>): void {
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(RENDERED_INLINE_LINE_HOST_SELECTOR));
    for (const block of blocks) {
      if (block.closest('pre, code, .tps-gcm-rendered-inline-property-chip, .tps-gcm-hidden-inline-property-rendered')) continue;
      if (!this.getOwnedRenderedText(block).includes('::')) continue;
      this.wrapRawInlineFieldsInBlock(block, visibleKeys);
    }
  }

  private wrapRawInlineFieldsInBlock(block: HTMLElement, visibleKeys: Set<string>): void {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        return isOwnedRenderedInlineTextNode(block, parent)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    let current: Node | null;
    while ((current = walker.nextNode())) {
      textNodes.push(current as Text);
    }
    if (textNodes.length === 0) return;

    let combined = '';
    const ranges: Array<{ node: Text; start: number; end: number }> = [];
    for (const node of textNodes) {
      const start = combined.length;
      combined += node.nodeValue || '';
      ranges.push({ node, start, end: combined.length });
    }
    if (!combined.includes('::')) return;
    const isHealthFoodLine = this.isHealthFoodInlineLine(combined);

    const matches = readInlineFieldRanges(combined)
      .map((field) => ({ from: field.start, to: field.end, key: field.key.trim() }))
      .filter((field) => field.key.length > 0);
    if (matches.length === 0) return;

    for (const item of matches.reverse()) {
      const start = resolveRenderedTextPosition(ranges, item.from, 'start');
      const end = resolveRenderedTextPosition(ranges, item.to, 'end');
      if (!start || !end) continue;

      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);

      const wrapper = document.createElement('span');
      const normalizedKey = item.key.toLowerCase();
      const isHealthWorkoutSetLine = this.isHealthWorkoutSetInlineLine(combined);
      const isReservedMetadata = DEFAULT_INLINE_DENY_KEYS.has(normalizedKey);
      const isVisible =
        !isReservedMetadata &&
        visibleKeys.has(normalizedKey) &&
        (!isHealthFoodLine || this.isVisibleHealthFoodInlineKey(normalizedKey)) &&
        (!isHealthWorkoutSetLine || this.isVisibleHealthWorkoutInlineKey(normalizedKey));
      if (isVisible) {
        wrapper.className = [
          'dataview',
          'inline-field',
          'tps-gcm-rendered-inline-property-chip',
          `tps-gcm-rendered-inline-property-chip--${this.toClassToken(item.key)}`,
        ].join(' ');
        wrapper.dataset.tpsInlinePropertyKey = item.key;
        const rawText = range.toString();
        const value = this.readInlineFieldValueFromRawText(rawText, item.key);
        wrapper.dataset.tpsInlinePropertyValue = value;
        wrapper.createSpan({ cls: 'dataview inline-field-key', text: item.key });
        wrapper.createSpan({ cls: 'dataview inline-field-value', text: value });
        range.deleteContents();
      } else {
        wrapper.className = 'tps-gcm-hidden-inline-property-rendered';
        wrapper.hidden = true;
        wrapper.style.setProperty('display', 'none', 'important');
        wrapper.setAttribute('aria-hidden', 'true');
        wrapper.append(range.extractContents());
      }

      range.insertNode(wrapper);
    }
  }

  private groupRenderedHealthFoodChips(root: HTMLElement): void {
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(RENDERED_INLINE_LINE_HOST_SELECTOR));
    for (const block of blocks) {
      if (!this.isRenderedHealthFoodLogBlock(block)) continue;

      block.classList.add('tps-gcm-health-food-log-line');

      let bucket = block.querySelector<HTMLElement>(':scope > .tps-gcm-health-food-chip-bucket');
      if (!bucket) {
        bucket = document.createElement('span');
        bucket.className = 'tps-gcm-health-food-chip-bucket';
        block.appendChild(bucket);
      }
      this.ensureRenderedHealthFoodLabel(block, bucket);

      const chips = Array.from(block.querySelectorAll<HTMLElement>('.tps-gcm-rendered-inline-property-chip'))
        .filter((chip) => isOwnedRenderedInlineElement(block, chip))
        .filter((chip) => this.isVisibleHealthFoodInlineKey(this.readInlinePropertyElementKey(chip).toLowerCase()));
      for (const chip of chips) {
        if (chip.parentElement !== bucket) bucket.appendChild(chip);
      }
    }
  }

  private ensureRenderedHealthFoodLabel(block: HTMLElement, bucket: HTMLElement): void {
    let label = block.querySelector<HTMLElement>(':scope > .tps-gcm-health-food-label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'tps-gcm-health-food-label';
      block.insertBefore(label, bucket);
    }

    const nodesToMove: ChildNode[] = [];
    for (const node of Array.from(block.childNodes)) {
      if (node === label || node === bucket) continue;
      if (node.nodeType === Node.TEXT_NODE && !(node.textContent || '').trim()) {
        node.remove();
        continue;
      }
      nodesToMove.push(node);
    }

    for (const node of nodesToMove) label.appendChild(node);
  }

  private isRenderedHealthFoodLogField(field: HTMLElement): boolean {
    const block = field.closest<HTMLElement>('li, p, div.task-list-item, div.HyperMD-list-line');
    return block ? this.isRenderedHealthFoodLogBlock(block) : false;
  }

  private isRenderedHealthWorkoutSetField(field: HTMLElement): boolean {
    const block = field.closest<HTMLElement>('li, p, div.task-list-item, div.HyperMD-list-line');
    return block ? this.isRenderedHealthWorkoutSetBlock(block) : false;
  }

  private isRenderedHealthFoodLogBlock(block: HTMLElement): boolean {
    const text = this.getOwnedRenderedText(block);
    if (this.isHealthFoodInlineLine(text)) return true;

    const keys = new Set<string>();
    const fields = Array.from(block.querySelectorAll<HTMLElement>('.dataview.inline-field, .metadata-property, .tps-gcm-rendered-inline-property-chip'));
    for (const field of fields) {
      if (!isOwnedRenderedInlineElement(block, field)) continue;
      const key = this.readInlinePropertyElementKey(field);
      if (key) keys.add(key.toLowerCase());
    }

    return (
      keys.has('food') &&
      Array.from(keys).some((key) => key !== 'food' && HEALTH_FOOD_INLINE_KEYS.has(key))
    );
  }

  private isRenderedHealthWorkoutSetBlock(block: HTMLElement): boolean {
    const text = this.getOwnedRenderedText(block);
    if (this.isHealthWorkoutSetInlineLine(text)) return true;

    const keys = new Set<string>();
    const fields = Array.from(block.querySelectorAll<HTMLElement>('.dataview.inline-field, .metadata-property, .tps-gcm-rendered-inline-property-chip'));
    for (const field of fields) {
      if (!isOwnedRenderedInlineElement(block, field)) continue;
      const key = this.readInlinePropertyElementKey(field);
      if (key) keys.add(key.toLowerCase());
    }

    return (
      keys.has('setid') &&
      Array.from(keys).some((key) => key !== 'setid' && HEALTH_WORKOUT_INLINE_KEYS.has(key))
    );
  }

  private isHealthFoodInlineLine(lineText: string): boolean {
    return /\[food::/i.test(lineText) && /\[(?:qty|unit|servings|amount|amountUnit|cal|protein|carbs|fat|fiber|sugar|alcohol|sodium|foodPath|foodId)::/i.test(lineText);
  }

  private isHealthWorkoutSetInlineLine(lineText: string): boolean {
    return /\[setId::/i.test(lineText) && /\[(?:exercise|exercisePath|workout|workoutPath|workoutPlan|workoutPlanPath|reps|weight|unit|duration|distance|distanceUnit|rpe|rest|setType|dropSet|superset)::/i.test(lineText);
  }

  private isVisibleHealthFoodInlineKey(normalizedKey: string): boolean {
    return HEALTH_FOOD_VISIBLE_INLINE_KEYS.has(normalizedKey.toLowerCase());
  }

  private isVisibleHealthWorkoutInlineKey(normalizedKey: string): boolean {
    return HEALTH_WORKOUT_VISIBLE_INLINE_KEYS.has(normalizedKey.toLowerCase());
  }

  private readInlineFieldValueFromRawText(rawText: string, key: string): string {
    return readInlineFieldValue(rawText, key);
  }

  private getOwnedRenderedText(block: HTMLElement): string {
    const values: string[] = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        return isOwnedRenderedInlineTextNode(block, parent)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    let current: Node | null;
    while ((current = walker.nextNode())) values.push(current.nodeValue || '');
    return values.join('');
  }

  private readRenderedInlineFieldKey(field: HTMLElement): string {
    const datasetKey =
      field.dataset.propertyKey ||
      field.dataset.propertyName ||
      field.getAttribute('data-property-key') ||
      field.getAttribute('data-property-name') ||
      '';
    if (datasetKey.trim()) return datasetKey.trim();

    const keyEl = field.querySelector<HTMLElement>('.dataview.inline-field-key, .metadata-property-key, .metadata-property-key-input');
    const raw = keyEl?.textContent || field.textContent || '';
    const match = raw.match(/^\s*([A-Za-z0-9_-]+)\s*::?/);
    return match?.[1]?.trim() || '';
  }

  private getInlineDateTimePropertyKeys(): Set<string> {
    const keys = new Set<string>();
    if (this.plugin.settings.showCustomPropertiesInInlineUi === false) return keys;

    for (const property of this.plugin.settings.properties || []) {
      const key = this.normalizeInlinePropertyKey(property);
      if (!key) continue;
      if (String(property?.type || '').toLowerCase() === 'datetime') {
        keys.add(key.toLowerCase());
      }
    }
    return keys;
  }

  private normalizeInlinePropertyKey(property: CustomProperty | null | undefined): string {
    if (!property || property.disabled || property.hidden || property.allowInlineSet === false) return '';
    const key = String(property.key || '').trim();
    if (!key) return '';
    if (DEFAULT_INLINE_DENY_KEYS.has(key.toLowerCase())) return '';
    if (property.allowInlineSet === undefined && DEFAULT_INLINE_DENY_KEYS.has(key.toLowerCase())) return '';
    return key;
  }

  private toClassToken(value: string): string {
    return String(value || '')
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'property';
  }
}
