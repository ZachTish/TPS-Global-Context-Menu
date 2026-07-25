import { BasesEntry, BasesView, Menu, Notice, QueryController, TFile, normalizePath, parseYaml } from 'obsidian';
import TPSGlobalContextMenuPlugin from '../main';
import { TextInputModal } from '../modals/text-input-modal';
import * as logger from '../logger';
import {
  addLogLineTag,
  getLogEntryStableIdentity,
  normalizeInlineKey,
  readInlineFields,
  readLogLineTags,
  removeLogLineTag,
  resolveEntryLineNumber,
  setVisibleLineText,
  visibleLineText,
} from './log-line-utils';
import { getPlainDisplayTitle } from '../utils/display-title';
import { resolveHomeFoodLineDateKey } from './home-food-date';
import { composeEffectiveFilterRoots, extractFilterRootCandidates, extractPersistedFilterRoots } from '../tps-list/base-filter-roots';
import { evaluateLogBaseFilterRoots, type LogBaseFilterContext } from './log-base-filter';
import { getCurrentBaseEmbedRenderContext, takePendingBaseEmbedRenderContext } from './base-embed-context';
import { calculateTpsTableTotals, normalizeTotalsRowPosition, type TpsTableTotalsRowPosition } from './log-base-totals';
import { getOrderedSelectionRange, toggleOrderedSelection } from '../utils/ordered-selection';
import { hashSelectionIdentity } from '../utils/selection-identity';
import { requestLineItemDelete } from '../services/line-item-delete-service';
import { normalizeTagValue } from '../utils/tag-utils';
import {
  getKanbanCheckboxStateForStatus,
  getKanbanStatusForCheckboxState,
  normalizeKanbanCheckboxState,
  type KanbanCheckboxMappingLike,
} from '../tps-list/task-checkbox-utils';
import {
  getTpsListHeadingDisplayTitle,
  parseTpsListHeadingLine,
  setTpsListHeadingText,
} from '../tps-list/heading-line-utils';
import { getTaskDisplayTitle, parseTaskTagValues, readTaskLineTags } from '../utils/task-line-metadata';
import { getTaskLineIdentity } from '../utils/task-line-resolution';
import {
  getSourceNoteGroupValue,
  groupTpsBaseRows,
  isSourceNoteGroupProperty,
  resolveTpsBaseGroupDescriptor,
  type TpsBaseGroupDescriptor,
  type TpsBaseRowGroup,
} from './base-row-grouping';
import { resolveTpsBaseLineCreationPlan } from './base-line-creation-plan';

export const TPS_TABLE_VIEW_TYPE = 'tps-table';

interface LogLineEntry {
  id: string;
  selectionId: string;
  file: TFile;
  lineNumber: number;
  line: string;
  title: string;
  fields: Record<string, string>;
  queryFields?: Record<string, string>;
}

function getLogEntrySelectionId(
  filePath: string,
  lineNumber: number,
  line: string,
  fields: Record<string, string>,
): string {
  const stable = getLogEntryStableIdentity({ fields });
  if (stable) return `${filePath}:stable:${stable.key}:${hashSelectionIdentity(stable.value)}`;
  return `${filePath}:line:${lineNumber}:${hashSelectionIdentity(line)}`;
}

interface HealthFoodLogApiLike {
  openFoodLogEntryMenuFromLine?: (event: MouseEvent, filePath: string, lineNumber: number, line: string) => Promise<void>;
}

interface LogTableColumn {
  key: string;
  label: string;
}

import { Modal } from 'obsidian';
import {
  appendTpsTableMarkdownLine,
  buildTpsTableMarkdownLine,
  getTpsTableMarkdownLineKind,
  getTpsTableTaskQueryFields,
  hasTpsTableLineKindFilter,
  type TpsTableLineKind,
} from './log-base-create';

class TpsTableLineCreateModal extends Modal {
  private settled = false;

  constructor(
    app: any,
    private readonly kind: TpsTableLineKind,
    private readonly headingLevel: 1 | 2 | 3 | 4 | 5 | 6,
    private readonly resolveResult: (value: string | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('mod-tps-gcm');
    this.modalEl.addClass('mod-tps-gcm-tps-table-create');
    this.contentEl.empty();
    const noun = this.kind === 'task' ? 'task' : this.kind === 'heading' ? `H${this.headingLevel} heading` : 'bullet';
    this.contentEl.createEl('h3', { text: `Add ${noun}` });
    const input = this.contentEl.createEl('input', {
      type: 'text',
      attr: {
        placeholder: this.kind === 'task' ? 'Task title' : this.kind === 'heading' ? 'Heading title' : 'Bullet text',
        'aria-label': this.kind === 'task' ? 'Task title' : this.kind === 'heading' ? 'Heading title' : 'Bullet text',
      },
    });
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    const submit = actions.createEl('button', { cls: 'mod-cta', text: `Add ${noun}` });
    cancel.addEventListener('click', () => this.finish(null));
    submit.addEventListener('click', () => this.finish(input.value));
    input.addEventListener('keydown', (evt: KeyboardEvent) => {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        this.finish(input.value);
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        this.finish(null);
      }
    });
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolveResult(null);
    }
  }

  private finish(value: string | null): void {
    if (this.settled) return;
    const normalized = value == null ? null : value.trim();
    if (value != null && !normalized) return;
    this.settled = true;
    this.resolveResult(normalized);
    this.close();
  }
}

export class TpsTableView extends BasesView {
  type = TPS_TABLE_VIEW_TYPE;
  private containerEl: HTMLElement;
  private refreshTimer: number | null = null;
  private renderGeneration = 0;
  private renderedResultCount = 0;
  private activeContextRow: HTMLElement | null = null;
  private selectedEntryIds = new Set<string>();
  private selectionAnchorId: string | null = null;
  private renderedEntryOrder: string[] = [];
  private columnWidths: Record<string, number> = {};
  private panSession: {
    pointerId: number;
    scroller: HTMLElement;
    startX: number;
    startY: number;
    startScrollLeft: number;
    active: boolean;
  } | null = null;

  constructor(controller: QueryController, containerEl: HTMLElement, private plugin: TPSGlobalContextMenuPlugin) {
    super(controller);
    this.containerEl = containerEl;
    this.containerEl.removeClass('tps-list-scroll');
    delete (this.containerEl as any).__tpsListView;
    const renderContext = getCurrentBaseEmbedRenderContext() || takePendingBaseEmbedRenderContext(TPS_TABLE_VIEW_TYPE);
    if (renderContext) {
      this.containerEl.dataset.tpsBasePath = renderContext.path;
      this.containerEl.dataset.tpsBaseDefinition = renderContext.definition;
      if (renderContext.sourcePath) this.containerEl.dataset.tpsContextPath = renderContext.sourcePath;
    }
    this.containerEl.addClass('tps-log-base');
    (this.containerEl as any).__tpsTableView = this;
  }

  onload(): void {
    this.registerEvent(this.plugin.app.vault.on('modify', (file) => {
      if (file instanceof TFile && file.extension === 'md') this.queueRender();
    }));
    this.registerEvent(this.plugin.app.vault.on('create', (file) => {
      if (file instanceof TFile && file.extension === 'md') this.queueRender();
    }));
    this.registerEvent(this.plugin.app.vault.on('delete', (file) => {
      if (file instanceof TFile && file.extension === 'md') this.queueRender();
    }));
    this.registerDomEvent(window, 'wheel', (evt) => this.handleWindowWheel(evt), { capture: true, passive: false });
    this.registerDomEvent(window, 'pointerdown', (evt) => this.handleWindowPointerDown(evt), { capture: true });
    this.registerDomEvent(window, 'pointermove', (evt) => this.handleWindowPointerMove(evt), { capture: true, passive: false });
    this.registerDomEvent(window, 'pointerup', (evt) => this.finishWindowPan(evt), { capture: true });
    this.registerDomEvent(window, 'pointercancel', (evt) => this.finishWindowPan(evt), { capture: true });
    void this.render();
  }

  onDataUpdated(): void {
    this.queueRender();
  }

  onunload(): void {
    if (this.refreshTimer != null) window.clearTimeout(this.refreshTimer);
    this.selectedEntryIds.clear();
    this.selectionAnchorId = null;
    this.renderedEntryOrder = [];
    this.containerEl.empty();
    this.containerEl.removeClass('tps-log-base');
    if ((this.containerEl as any).__tpsTableView === this) delete (this.containerEl as any).__tpsTableView;
  }

  async createFileForView(baseFileName?: string, frontmatterProcessor?: (frontmatter: Record<string, unknown>) => void): Promise<void> {
    if (await this.runCreateCommandOverride()) return;
    if (await this.createLineForView()) return;
    await super.createFileForView(baseFileName, frontmatterProcessor);
  }

  private async createLineForView(): Promise<boolean> {
    let filterRoots: unknown[];
    try {
      filterRoots = await this.getEffectiveBaseFilterRoots(true);
    } catch (error) {
      logger.flowWarn('TpsTableView', 'create-line:blocked', {
        reason: 'filter-read-failed',
        base: this.getBaseFile()?.path || null,
        viewName: this.getViewName(),
        error: logger.errorSummary(error),
      });
      new Notice('Could not read the Base filters, so TPS Table did not create anything.');
      return true;
    }
    const statusService = this.plugin.sharedServices?.status;
    const defaults = resolveTpsBaseLineCreationPlan(filterRoots, {
      resolveValue: (value) => this.resolveLineCreateToken(value),
      defaultOpenStatus: 'todo',
      defaultDoneStatus: 'complete',
      isDoneStatus: (status) => statusService?.isDoneStatus?.(status)
        ?? (status === 'complete' || status === 'wont-do'),
      nonTaskStatusAsField: true,
    });
    if (defaults.blockedReason) {
      logger.flowWarn('TpsTableView', 'create-line:blocked', {
        reason: defaults.blockedReason,
        base: this.getBaseFile()?.path || null,
        viewName: this.getViewName(),
        selectedBranches: defaults.diagnostics.selectedBranches,
      });
      new Notice('Could not create an item because the active-view and whole-Base filters do not have a compatible default.');
      return true;
    }
    if (!defaults.kind) return false;
    const headingLevel = Math.max(1, Math.min(6, Number(defaults.headingLevel) || 1)) as 1 | 2 | 3 | 4 | 5 | 6;

    const title = await new Promise<string | null>((resolve) => {
      new TpsTableLineCreateModal(this.plugin.app, defaults.kind!, headingLevel, resolve).open();
    });
    if (!title) {
      logger.flow('TpsTableView', 'create-line:cancelled', { kind: defaults.kind });
      return true;
    }

    const targetResolution = await this.plugin.resolveTpsBaseWriteFile({
      explicitTargetPath: defaults.targetPath,
      explicitTargetSpecified: defaults.targetPathSpecified,
      createExplicitIfMissing: false,
    });
    const targetFile = targetResolution.file;
    if (!(targetFile instanceof TFile)) {
      logger.flowWarn('TpsTableView', 'create-line:blocked', {
        reason: targetResolution.reason,
        kind: defaults.kind,
        source: targetResolution.source,
        targetPath: targetResolution.path,
        base: this.getBaseFile()?.path || null,
        viewName: this.getViewName(),
      });
      if (targetResolution.reason === 'filter-required') {
        new Notice('Choose a TPS List/Table fallback write note in GCM Tasks settings, or add an exact file.path/task.path filter.');
      } else if (targetResolution.source === 'filter') {
        new Notice(targetResolution.path
          ? `Line target not found: ${targetResolution.path}`
          : 'The Base write-target filter did not resolve to a Markdown note.');
      } else {
        new Notice('The configured TPS List/Table fallback write note is unavailable.');
      }
      return true;
    }
    const targetPath = targetFile.path;

    const checkboxState = defaults.kind === 'task' && defaults.status
      ? getKanbanCheckboxStateForStatus(defaults.status, this.getTaskCheckboxMappings())
      : defaults.kind === 'task' ? '[ ]' : null;
    if (defaults.kind === 'task' && defaults.status && !checkboxState) {
      logger.flowWarn('TpsTableView', 'create-line:blocked', {
        reason: 'unmapped-status',
        status: defaults.status,
        base: this.getBaseFile()?.path || null,
        viewName: this.getViewName(),
      });
      new Notice(`Could not create the task because status "${defaults.status}" has no checkbox mapping.`);
      return true;
    }
    const line = buildTpsTableMarkdownLine(defaults.kind, title, defaults.fields, {
      checkboxState,
      headingLevel,
      tags: defaults.tags,
    });
    const fields = readInlineFields(line);
    const rowKind = defaults.kind === 'heading' ? `h${headingLevel}` : defaults.kind;
    let queryFields: Record<string, string> = { ...fields, kind: rowKind };
    const prospectiveTags = readTaskLineTags(line);
    if (prospectiveTags.length > 0 && queryFields.tags == null) {
      queryFields.tags = prospectiveTags.map((tag) => `#${tag}`).join(', ');
    }
    if (defaults.kind === 'heading') {
      queryFields.headinglevel = String(headingLevel);
      queryFields.headingtext = getTpsListHeadingDisplayTitle(line);
      queryFields.headingpath = targetFile.path;
    }
    if (defaults.kind === 'task') {
      queryFields = {
        ...queryFields,
        ...getTpsTableTaskQueryFields(
          line,
          (state) => {
            const mapped = getKanbanStatusForCheckboxState(state, this.getTaskCheckboxMappings())
              || statusService?.checkboxStateToStatus?.(state)
              || '';
            return statusService?.normalize?.(mapped) || mapped;
          },
          (status) => statusService?.isDoneStatus?.(status)
            ?? (status === 'complete' || status === 'wont-do'),
        ),
      };
    }
    const prospectiveMatch = evaluateLogBaseFilterRoots(
      filterRoots,
      this.createFilterContext(queryFields, targetFile, line, rowKind),
    );
    if (prospectiveMatch === false) {
      logger.flowWarn('TpsTableView', 'create-line:blocked', {
        reason: 'prospective-line-does-not-match-filters',
        kind: defaults.kind,
        targetPath,
      });
      new Notice('TPS Table did not create the item because the resulting line would not match this view.');
      return true;
    }
    if (prospectiveMatch == null) {
      logger.flowWarn('TpsTableView', 'create-line:filter-validation-partial', {
        kind: defaults.kind,
        targetPath,
        unsupportedFilters: defaults.diagnostics.unsupportedFilters,
      });
    }
    logger.flow('TpsTableView', 'create-line:start', {
      kind: defaults.kind,
      targetPath,
      fieldKeys: Object.keys(defaults.fields),
      tagCount: defaults.tags.length,
      status: defaults.status || '',
      headingLevel: defaults.kind === 'heading' ? headingLevel : null,
      selectedBranches: defaults.diagnostics.selectedBranches,
    });
    await this.plugin.app.vault.process(targetFile, (content) => appendTpsTableMarkdownLine(content, line));
    logger.flow('TpsTableView', 'create-line:done', { kind: defaults.kind, targetPath });
    this.queueRender();
    return true;
  }

  private resolveLineCreateToken(value: string): string {
    const raw = String(value || '').trim();
    if (/^this\.file\.path$/iu.test(raw)) return this.getLineCreateContextPath() || '';
    if (/^this\.(?:scheduled|date)$/iu.test(raw)) return this.getHomeContextDate() || '';
    return raw;
  }

  private getLineCreateContextPath(): string | null {
    const controller = (this as any)?.controller;
    const queryController = (this as any)?.queryController;
    const contextHost = this.containerEl.closest<HTMLElement>('[data-tps-context-path]');
    const candidates = [
      this.containerEl.dataset.tpsContextPath,
      contextHost?.dataset.tpsContextPath,
      controller?.context?.file?.path,
      controller?.sourceFile?.path,
      queryController?.context?.file?.path,
      queryController?.currentFile?.path,
      this.plugin.app.workspace.getActiveFile?.()?.path,
    ];
    for (const candidate of candidates) {
      const path = String(candidate || '').trim();
      if (path.toLowerCase().endsWith('.md')) return normalizePath(path).replace(/^\/+/, '');
    }
    return null;
  }

  private queueRender(): void {
    if (this.refreshTimer != null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.render();
    }, 150);
  }

  private async render(): Promise<void> {
    const generation = ++this.renderGeneration;
    const start = performance.now();
    const entries = await this.loadEntries();
    if (generation !== this.renderGeneration) {
      logger.flow('TpsTableView', 'render:stale', { generation });
      return;
    }

    const columns = this.getColumns(entries);
    const groupBy = resolveTpsBaseGroupDescriptor(this.getConfigValue('groupBy'));
    const entryGroups = groupBy
      ? groupTpsBaseRows(entries, (entry) => this.getEntryValue(entry, groupBy.property), groupBy.direction)
      : [{ key: null, rows: entries }];
    const renderedEntries = entryGroups.flatMap((group) => group.rows);
    const totalsPosition = normalizeTotalsRowPosition(this.getConfigValue('totalsRow'));
    this.renderedResultCount = entries.length;
    this.renderedEntryOrder = renderedEntries.map((entry) => entry.selectionId);
    const visibleEntryIds = new Set(this.renderedEntryOrder);
    this.selectedEntryIds = new Set([...this.selectedEntryIds].filter((id) => visibleEntryIds.has(id)));
    if (this.selectionAnchorId && !visibleEntryIds.has(this.selectionAnchorId)) this.selectionAnchorId = null;
    this.containerEl.empty();

    this.syncNativeResultsCountSoon();

    if (!entries.length) {
      this.containerEl.createDiv({ cls: 'tps-log-base-empty', text: 'No matching log lines found.' });
      logger.flow('TpsTableView', 'render:empty', { durationMs: Math.round(performance.now() - start) });
      return;
    }

    this.columnWidths = this.loadColumnWidths(columns);
    const tableScroller = this.containerEl.createDiv({ cls: 'tps-log-base-table-scroll' });
    this.registerHorizontalScroll(tableScroller);
    const table = tableScroller.createEl('table', { cls: 'bases-table tps-log-base-table' });
    this.applyTableWidth(table, columns);
    const colgroup = table.createEl('colgroup');
    for (const column of columns) {
      colgroup.createEl('col', {
        attr: {
          'data-key': this.columnStorageKey(column),
          style: `width: ${this.getColumnWidth(column)}px;`,
        },
      });
    }
    const thead = table.createEl('thead', { cls: 'bases-table-header tps-log-base-head' });
    const headerRow = thead.createEl('tr', { cls: 'bases-table-row tps-log-base-row tps-log-base-row--header' });
    for (const column of columns) {
      const th = headerRow.createEl('th', { cls: 'bases-table-cell bases-table-header-cell tps-log-base-cell tps-log-base-cell--header' });
      th.dataset.key = column.key;
      th.createSpan({ cls: 'tps-log-base-header-label', text: column.label });
      const resizeHandle = th.createSpan({
        cls: 'tps-log-base-column-resize',
        attr: {
          role: 'separator',
          'aria-orientation': 'vertical',
          title: `Resize ${column.label}`,
        },
      });
      this.registerColumnResize(resizeHandle, column);
    }
    const tbody = table.createEl('tbody', { cls: 'tps-log-base-body' });
    let totaledColumns = 0;
    if (totalsPosition === 'top') totaledColumns = this.renderTotalsRow(tbody, entries, columns, totalsPosition);
    for (const group of entryGroups) {
      if (groupBy) this.renderGroupRow(tbody, groupBy, group, columns);
      for (const entry of group.rows) this.renderEntry(tbody, entry, columns);
    }
    if (totalsPosition === 'bottom') totaledColumns = this.renderTotalsRow(tbody, entries, columns, totalsPosition);

    logger.flow('TpsTableView', 'render:done', {
      entries: entries.length,
      columns: columns.length,
      groupBy: groupBy?.property ?? null,
      groups: groupBy ? entryGroups.length : 0,
      totalsPosition,
      totaledColumns,
      durationMs: Math.round(performance.now() - start),
    });
  }

  private async loadEntries(): Promise<LogLineEntry[]> {
    const entries: LogLineEntry[] = [];
    const filterRoots = await this.getEffectiveBaseFilterRoots();
    const sourceFiles = filterRoots.length ? this.plugin.app.vault.getMarkdownFiles() : this.getSourceFiles();
    const checkboxMappings = this.getTaskCheckboxMappings();
    let unknownFilterRows = 0;
    for (const file of sourceFiles) {
      let content = '';
      try {
        content = await this.plugin.app.vault.cachedRead(file);
      } catch (error) {
        logger.flowWarn('TpsTableView', 'source-read:failed', { path: file.path, error: logger.errorSummary(error) });
        continue;
      }
      content.split('\n').forEach((line, index) => {
        const fields = readInlineFields(line);
        const heading = parseTpsListHeadingLine(line);
        const markdownKind = getTpsTableMarkdownLineKind(line);
        const rowKind = heading ? `h${heading.headingLevel}` : markdownKind;
        if (rowKind && !fields.kind) fields.kind = rowKind;
        let queryFields = { ...fields };
        if (rowKind) {
          queryFields.kind = rowKind;
        } else if (/^(?:tasks?|bullets?|headings?|headers?|h[1-6])$/iu.test(String(queryFields.kind || '').trim())) {
          // `kind` is the structural Base discriminator for synthesized rows.
          // A plain line cannot opt into task/bullet behavior with editable
          // inline metadata such as `[kind:: task]`.
          delete queryFields.kind;
        }
        const structuralTags = rowKind ? readTaskLineTags(line) : [];
        if (structuralTags.length > 0 && queryFields.tags == null) {
          queryFields.tags = structuralTags.map((tag) => `#${tag}`).join(', ');
        }
        if (heading) {
          queryFields.headinglevel = String(heading.headingLevel);
          queryFields.headingtext = getTpsListHeadingDisplayTitle(line);
          queryFields.headingline = String(index + 1);
          queryFields.headingpath = file.path;
        }
        if (markdownKind === 'task') {
          const statusService = this.plugin.sharedServices?.status;
          queryFields = {
            ...queryFields,
            ...getTpsTableTaskQueryFields(
              line,
              (checkboxState) => {
                const mappedStatus = getKanbanStatusForCheckboxState(checkboxState, checkboxMappings)
                  || statusService?.checkboxStateToStatus?.(checkboxState)
                  || '';
                return statusService?.normalize?.(mappedStatus) || mappedStatus;
              },
              (status) => statusService?.isDoneStatus?.(status)
                ?? (status === 'complete' || status === 'wont-do'),
            ),
          };
        }
        if (!this.lineMatches(queryFields) && !(markdownKind && hasTpsTableLineKindFilter(filterRoots))) return;
        const filterResult = evaluateLogBaseFilterRoots(
          filterRoots,
          this.createFilterContext(queryFields, file, line, rowKind),
        );
        if (filterResult === false) return;
        if (filterResult == null && filterRoots.length) unknownFilterRows += 1;
        if (!this.lineMatchesHomeDateContext(fields, file)) return;
        entries.push({
          id: `${file.path}:${index}`,
          selectionId: getLogEntrySelectionId(file.path, index, line, fields),
          file,
          lineNumber: index,
          line,
          title: heading ? getTpsListHeadingDisplayTitle(line) : visibleLineText(line),
          fields,
          queryFields,
        });
      });
    }
    if (unknownFilterRows) {
      logger.flowWarn('TpsTableView', 'filters:unsupported-rows-included', {
        base: this.getBaseFile()?.path || null,
        viewName: this.getViewName(),
        rows: unknownFilterRows,
      });
    }
    return this.sortEntries(entries);
  }

  private getTaskCheckboxMappings(): KanbanCheckboxMappingLike[] {
    const configured = this.plugin.settings?.linkedSubitemCheckboxMappings;
    if (!Array.isArray(configured)) return [];
    return configured
      .map((entry) => ({
        checkboxState: normalizeKanbanCheckboxState(String(entry?.checkboxState || '[ ]')),
        statuses: Array.isArray(entry?.statuses)
          ? entry.statuses.map((status) => String(status || '').trim().toLowerCase()).filter(Boolean)
          : [],
        toggleTargetStatus: String(entry?.toggleTargetStatus || '').trim() || undefined,
      }))
      .filter((entry) => entry.checkboxState && entry.statuses.length > 0);
  }

  private async getEffectiveBaseFilterRoots(failOnReadError = false): Promise<unknown[]> {
    const runtimeRoots = extractFilterRootCandidates([
      this.config?.get?.('filters'),
      (this.config as any)?.filters,
      (this as any)?.view?.filters,
      (this as any)?.controller?.viewConfig?.filters,
      (this as any)?.controller?.config?.filters,
      (this as any)?.queryController?.query?.filters,
      (this as any)?.queryController?.queryState,
    ]);
    const stampedRoots = this.getStampedBaseFilterRoots(failOnReadError);
    if (stampedRoots) return composeEffectiveFilterRoots(runtimeRoots, stampedRoots);
    const baseFile = this.getBaseFile();
    if (!baseFile) {
      if (failOnReadError) throw new Error('Could not resolve the Base definition for line creation');
      return composeEffectiveFilterRoots(runtimeRoots, []);
    }
    try {
      const parsed = parseYaml(await this.plugin.app.vault.cachedRead(baseFile)) as Record<string, unknown> | null | undefined;
      const persisted = extractPersistedFilterRoots(parsed, this.getViewName(), new Set([TPS_TABLE_VIEW_TYPE]));
      const roots = composeEffectiveFilterRoots(runtimeRoots, persisted.filters || []);
      logger.flow('TpsTableView', 'filters:resolved', {
        base: baseFile.path,
        viewName: persisted.viewName || this.getViewName(),
        runtimeRoots: runtimeRoots.length,
        effectiveRoots: roots.length,
      });
      return roots;
    } catch (error) {
      logger.flowWarn('TpsTableView', 'filters:read-failed', { path: baseFile.path, error: logger.errorSummary(error) });
      if (failOnReadError) throw error;
      return composeEffectiveFilterRoots(runtimeRoots, []);
    }
  }

  private getStampedBaseFilterRoots(failOnReadError = false): unknown[] | null {
    const host = this.containerEl.closest<HTMLElement>('[data-tps-base-definition]');
    const serialized = host?.dataset.tpsBaseDefinition;
    if (!serialized) return null;
    try {
      const parsed = JSON.parse(serialized) as Record<string, unknown>;
      return extractPersistedFilterRoots(parsed, this.getViewName(), new Set([TPS_TABLE_VIEW_TYPE])).filters;
    } catch (error) {
      logger.flowWarn('TpsTableView', 'filters:stamped-definition-invalid', { error: logger.errorSummary(error) });
      if (failOnReadError) throw error;
      return null;
    }
  }

  private getBaseFile(): TFile | null {
    const host = this.containerEl.closest<HTMLElement>('[data-tps-base-path], [data-path$=".base"], [data-src$=".base"], .internal-embed[src$=".base"], .markdown-embed[src$=".base"]');
    const controller = (this as any)?.controller;
    const queryController = (this as any)?.queryController;
    const candidates = [
      host?.dataset.tpsBasePath,
      host?.dataset.path,
      host?.dataset.src,
      host?.getAttribute('src'),
      controller?.file?.path,
      controller?.baseFile?.path,
      controller?.source?.path,
      queryController?.query?.file?.path,
      queryController?.currentFile?.path,
      this.plugin.app.workspace.getActiveFile?.()?.path,
    ];
    for (const candidate of candidates) {
      const path = normalizePath(String(candidate || '').trim()).replace(/^\/+/, '');
      if (!path.toLowerCase().endsWith('.base')) continue;
      const file = this.plugin.app.vault.getFileByPath(path);
      if (file instanceof TFile) return file;
    }
    return null;
  }

  private createFilterContext(
    fields: Record<string, string>,
    file: TFile,
    line = '',
    rowKind: string | null = null,
  ): LogBaseFilterContext {
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter || {}) as Record<string, unknown>;
    const frontmatterTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : frontmatter.tags ? [frontmatter.tags] : [];
    const tags = parseTaskTagValues([
      ...(cache?.tags || []).map((tag) => tag.tag),
      ...frontmatterTags.map((tag) => String(tag || '')),
    ]);
    return {
      fields,
      contextDate: this.getHomeContextDate(),
      rowKind,
      taskTags: rowKind ? readTaskLineTags(line) : undefined,
      file: {
        path: file.path,
        name: file.name,
        basename: file.basename,
        extension: file.extension,
        folder: file.parent?.path || '',
        tags,
        frontmatter,
      },
    };
  }

  private getSourceFiles(): TFile[] {
    const byPath = new Map<string, TFile>();
    const rows = (this.data as any)?.data;
    if (Array.isArray(rows)) {
      for (const entry of rows as BasesEntry[]) {
        if (entry?.file instanceof TFile && entry.file.extension === 'md') byPath.set(entry.file.path, entry.file);
      }
    }
    const groups = (this.data as any)?.groupedData;
    if (Array.isArray(groups)) {
      for (const group of groups) {
        const entries = Array.isArray(group?.entries) ? group.entries : [];
        for (const entry of entries as BasesEntry[]) {
          if (entry?.file instanceof TFile && entry.file.extension === 'md') byPath.set(entry.file.path, entry.file);
        }
      }
    }
    return Array.from(byPath.values());
  }

  private lineMatchesHomeDateContext(fields: Record<string, string>, file: TFile): boolean {
    const host = this.containerEl.closest<HTMLElement>('[data-tps-home-food-date], [data-tps-home-activity-date]');
    const contextDate = host?.dataset.tpsHomeFoodDate || host?.dataset.tpsHomeActivityDate || '';
    if (!contextDate) return true;
    const isActivity = Boolean(host?.dataset.tpsHomeActivityDate);
    const lineDate = isActivity
      ? this.normalizeDateKey(fields.completeddate || fields.startedat || fields.workoutdate || '')
        || file.path.match(/\d{4}-\d{2}-\d{2}/)?.[0]
        || null
      : resolveHomeFoodLineDateKey(fields, file.path);
    const matches = lineDate === contextDate;
    if (!matches) {
      logger.flow('TpsTableView', 'home-date-filter:skip-line', {
        kind: isActivity ? 'activity' : 'food',
        contextDate,
        lineDate,
        path: file.path,
      });
    }
    return matches;
  }

  private getHomeContextDate(): string | null {
    const host = this.containerEl.closest<HTMLElement>('[data-tps-context-source="home"][data-tps-context-date], [data-tps-context-source="home"][data-tps-context-scheduled]');
    if (!host) return null;
    return this.normalizeDateKey(host.dataset.tpsContextDate || host.dataset.tpsContextScheduled || '');
  }

  private normalizeDateKey(value: unknown): string | null {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const direct = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (direct) return direct;
    const moment = (window as any).moment;
    if (typeof moment === 'function') {
      const parsed = moment(raw, ['YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DDTHH:mm:ss.SSSZ', 'MM/DD/YYYY', 'MMM D YYYY', 'ddd, MMM D YYYY'], true);
      if (parsed?.isValid?.()) return parsed.format('YYYY-MM-DD');
    }
    return null;
  }

  private lineMatches(fields: Record<string, string>): boolean {
    const any = this.getLineFilterAnyKeys();
    if (any.length && !any.some((key) => fields[normalizeInlineKey(key)] != null)) return false;
    const required = this.getLineFilterKeys();
    if (!required.length) return Object.keys(fields).length > 0;
    return required.every((key) => fields[normalizeInlineKey(key)] != null);
  }

  private getLineFilterAnyKeys(): string[] {
    const raw = this.getConfigValue('lineFilterAnyKeys');
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return values.map((value) => String(value || '').trim()).filter(Boolean);
  }

  private getLineFilterKeys(): string[] {
    const raw = this.getConfigValue('lineFilterKey')
      ?? this.getConfigValue('lineProperty')
      ?? this.getConfigValue('requiredProperty')
      ?? this.getConfigValue('lineFilterKeys');
    const values = Array.isArray(raw) ? raw : raw ? [raw] : ['food'];
    return values.map((value) => String(value || '').trim()).filter(Boolean);
  }

  private getColumns(entries: LogLineEntry[]): LogTableColumn[] {
    const configured = this.getConfiguredColumnKeys();
    const keys = configured.length ? configured : inferColumnKeys(entries);
    if (this.isHomeFoodSummary()) {
      const labels: Record<string, string> = { food: 'Food', cal: 'Cal', protein: 'P', carbs: 'C', fat: 'F' };
      return ['food', 'cal', 'protein', 'carbs', 'fat']
        .filter((key) => keys.some((candidate) => normalizeInlineKey(candidate) === key))
        .map((key) => ({ key, label: labels[key] }));
    }
    if (configured.length) return keys.map((key) => ({ key, label: labelForKey(key) }));
    return [
      ...keys.map((key) => ({ key, label: labelForKey(key) })),
      { key: 'source', label: 'Source' },
      { key: 'line', label: 'Line' },
    ];
  }

  private isHomeFoodSummary(): boolean {
    return Boolean(this.containerEl.closest('.tps-home-component-food-tracker'));
  }

  private getColumnWidth(column: LogTableColumn): number {
    const stored = this.columnWidths[this.columnStorageKey(column)];
    if (Number.isFinite(stored) && stored > 0) return stored;
    const normalized = normalizeInlineKey(column.key);
    if (normalized === 'line' || normalized === 'title') return 240;
    if (normalized === 'source' || normalized === 'path') return 150;
    if (normalized === 'food') return 180;
    if (normalized === 'qty' || normalized === 'cal' || normalized === 'protein' || normalized === 'carbs' || normalized === 'fat') return 90;
    if (normalized === 'unit' || normalized === 'amountunit') return 110;
    return 120;
  }

  private loadColumnWidths(columns: LogTableColumn[]): Record<string, number> {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.columnWidthStorageKey()) || '{}') as Record<string, unknown>;
      const allowed = new Set(columns.map((column) => this.columnStorageKey(column)));
      const widths: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed)) {
        const width = Number(value);
        if (allowed.has(key) && Number.isFinite(width) && width >= 56) widths[key] = Math.min(800, Math.round(width));
      }
      return widths;
    } catch {
      return {};
    }
  }

  private saveColumnWidths(): void {
    try {
      localStorage.setItem(this.columnWidthStorageKey(), JSON.stringify(this.columnWidths));
    } catch (error) {
      logger.flowWarn('TpsTableView', 'column-width:save-failed', { error: logger.errorSummary(error) });
    }
  }

  private columnWidthStorageKey(): string {
    const controller = (this as any).controller;
    const basePath = String(controller?.file?.path || controller?.path || '').trim();
    const viewName = this.getViewName();
    return `tps-gcm:tps-table:column-widths:${basePath || 'unknown'}:${viewName}`;
  }

  private columnStorageKey(column: LogTableColumn): string {
    return normalizeInlineKey(column.key) || column.key;
  }

  private registerColumnResize(handle: HTMLElement, column: LogTableColumn): void {
    handle.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    handle.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 0) return;
      evt.preventDefault();
      evt.stopPropagation();
      const key = this.columnStorageKey(column);
      const startX = evt.clientX;
      const startWidth = this.getColumnWidth(column);
      const pointerId = evt.pointerId;
      handle.setPointerCapture?.(pointerId);
      this.containerEl.addClass('tps-log-base--resizing');

      const onMove = (moveEvt: PointerEvent) => {
        const nextWidth = Math.max(56, Math.min(800, Math.round(startWidth + moveEvt.clientX - startX)));
        this.columnWidths[key] = nextWidth;
        this.applyColumnWidth(key, nextWidth);
      };
      const onUp = () => {
        handle.releasePointerCapture?.(pointerId);
        this.containerEl.removeClass('tps-log-base--resizing');
        this.saveColumnWidths();
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onUp, true);
        logger.flow('TpsTableView', 'column-width:resize', { key, width: this.columnWidths[key] });
      };

      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
    });
  }

  private registerHorizontalScroll(scroller: HTMLElement): void {
    scroller.tabIndex = 0;
    scroller.setAttribute('role', 'region');
    scroller.setAttribute('aria-label', `${this.getViewName()} table`);
    scroller.addEventListener('wheel', (evt) => {
      this.routeHorizontalWheel(evt, scroller);
    }, { passive: false });
    scroller.addEventListener('keydown', (evt) => {
      if (evt.key !== 'ArrowLeft' && evt.key !== 'ArrowRight') return;
      const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
      if (maxScrollLeft <= 0) return;
      const before = scroller.scrollLeft;
      const next = Math.max(0, Math.min(maxScrollLeft, before + (evt.key === 'ArrowRight' ? 80 : -80)));
      if (next === before) return;
      evt.preventDefault();
      evt.stopPropagation();
      scroller.scrollLeft = next;
    });
  }

  private handleWindowWheel(evt: WheelEvent): void {
    const target = evt.target instanceof HTMLElement ? evt.target : null;
    if (!target || !this.containerEl.contains(target)) return;
    const scroller = target.closest<HTMLElement>('.tps-log-base-table-scroll')
      ?? this.containerEl.querySelector<HTMLElement>('.tps-log-base-table-scroll');
    if (!scroller) return;
    this.routeHorizontalWheel(evt, scroller);
  }

  private routeHorizontalWheel(evt: WheelEvent, scroller: HTMLElement): void {
    const maxScrollLeft = this.getTableMaxScrollLeft(scroller);
    if (maxScrollLeft <= 0) return;
    const rawDelta = Math.abs(evt.deltaX) >= Math.abs(evt.deltaY) ? evt.deltaX : evt.shiftKey ? evt.deltaY : 0;
    if (!rawDelta) return;
    const before = this.getTableScrollLeft(scroller);
    const next = Math.max(0, Math.min(maxScrollLeft, before + rawDelta));
    if (next === before) return;
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation?.();
    this.setTableScrollLeft(scroller, next);
    logger.flow('TpsTableView', 'table-scroll:horizontal', {
      left: Math.round(next),
      max: Math.round(maxScrollLeft),
      embedded: Boolean(scroller.closest('.canvas-node-content, .markdown-embed, .internal-embed')),
    });
  }

  private handleWindowPointerDown(evt: PointerEvent): void {
    if (evt.button !== 0) return;
    const target = evt.target instanceof HTMLElement ? evt.target : null;
    if (!target || !this.containerEl.contains(target) || target.closest('.tps-log-base-column-resize')) return;
    const scroller = target.closest<HTMLElement>('.tps-log-base-table-scroll');
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    this.panSession = {
      pointerId: evt.pointerId,
      scroller,
      startX: evt.clientX,
      startY: evt.clientY,
      startScrollLeft: this.getTableScrollLeft(scroller),
      active: false,
    };
  }

  private handleWindowPointerMove(evt: PointerEvent): void {
    const session = this.panSession;
    if (!session || session.pointerId !== evt.pointerId) return;
    const dx = evt.clientX - session.startX;
    const dy = evt.clientY - session.startY;
    if (!session.active) {
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
      session.active = true;
      this.containerEl.addClass('tps-log-base--panning');
    }
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation?.();
    this.setTableScrollLeft(session.scroller, session.startScrollLeft - dx);
  }

  private finishWindowPan(evt: PointerEvent): void {
    const session = this.panSession;
    if (!session || session.pointerId !== evt.pointerId) return;
    const wasActive = session.active;
    const scroller = session.scroller;
    this.panSession = null;
    this.containerEl.removeClass('tps-log-base--panning');
    if (wasActive) {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation?.();
      logger.flow('TpsTableView', 'table-scroll:pan', {
        left: Math.round(this.getTableScrollLeft(scroller)),
        max: Math.round(this.getTableMaxScrollLeft(scroller)),
        embedded: Boolean(scroller.closest('.canvas-node-content, .markdown-embed, .internal-embed')),
      });
    }
  }

  private getTableScrollLeft(scroller: HTMLElement): number {
    const value = Number(scroller.dataset.tpsTableScrollLeft);
    return Number.isFinite(value) ? value : scroller.scrollLeft;
  }

  private setTableScrollLeft(scroller: HTMLElement, rawLeft: number): number {
    const table = scroller.querySelector<HTMLElement>('.tps-log-base-table');
    const maxScrollLeft = this.getTableMaxScrollLeft(scroller);
    const next = Math.max(0, Math.min(maxScrollLeft, rawLeft));
    scroller.dataset.tpsTableScrollLeft = String(next);
    scroller.scrollLeft = 0;
    if (table) {
      table.style.setProperty('transform', next ? `translateX(${-next}px)` : 'none');
      table.style.setProperty('will-change', next ? 'transform' : 'auto');
    }
    return next;
  }

  private getTableMaxScrollLeft(scroller: HTMLElement): number {
    const table = scroller.querySelector<HTMLElement>('.tps-log-base-table');
    const tableRect = table?.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const tableWidth = Math.max(scroller.scrollWidth, table?.offsetWidth ?? 0, tableRect?.width ?? 0);
    const viewportWidth = Math.max(1, Math.min(scroller.clientWidth || scrollerRect.width, this.containerEl.clientWidth || scrollerRect.width, scrollerRect.width));
    return Math.max(0, tableWidth - viewportWidth);
  }

  private applyColumnWidth(key: string, width: number): void {
    const selector = `col[data-key="${escapeAttrValue(key)}"]`;
    const col = this.containerEl.querySelector<HTMLElement>(selector);
    if (col) col.style.width = `${width}px`;
    this.applyTableWidth();
  }

  private applyTableWidth(table?: HTMLElement | null, columns?: LogTableColumn[]): void {
    const tableEl = table ?? this.containerEl.querySelector<HTMLElement>('.tps-log-base-table');
    if (!tableEl) return;
    const sourceColumns = columns ?? this.getRenderedColumns();
    if (!sourceColumns.length) return;
    const width = sourceColumns.reduce((total, column) => total + this.getColumnWidth(column), 0);
    tableEl.style.setProperty('--tps-log-base-table-width', `${width}px`);
    tableEl.style.setProperty('width', `${width}px`, 'important');
    tableEl.style.setProperty('min-width', '100%', 'important');
  }

  private getRenderedColumns(): LogTableColumn[] {
    return Array.from(this.containerEl.querySelectorAll<HTMLElement>('.tps-log-base-cell--header')).map((header) => ({
      key: header.dataset.key || '',
      label: header.textContent?.trim() || header.dataset.key || '',
    })).filter((column) => column.key);
  }

  private getConfiguredColumnKeys(): string[] {
    const raw = (this.config as any)?.order ?? this.config?.getOrder?.() ?? this.getConfigValue('columns') ?? [];
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return values
      .map((item) => typeof item === 'string'
        ? item
        : String((item as any)?.property ?? (item as any)?.key ?? (item as any)?.field ?? '').trim())
      .map((key) => key.replace(/^note\./, '').trim())
      .filter(Boolean);
  }

  private sortEntries(entries: LogLineEntry[]): LogLineEntry[] {
    const descriptors = this.getSortDescriptors();
    if (!descriptors.length) return entries;
    return [...entries].sort((a, b) => {
      for (const descriptor of descriptors) {
        const av = this.getEntryValue(a, descriptor.key).toLowerCase();
        const bv = this.getEntryValue(b, descriptor.key).toLowerCase();
        if (av < bv) return descriptor.direction === 'desc' ? 1 : -1;
        if (av > bv) return descriptor.direction === 'desc' ? -1 : 1;
      }
      return b.id.localeCompare(a.id);
    });
  }

  private getSortDescriptors(): Array<{ key: string; direction: 'asc' | 'desc' }> {
    const raw = (this.config as any)?.sort ?? this.config?.getSort?.() ?? this.getConfigValue('sortBy') ?? [];
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return values
      .map((item) => {
        const key = typeof item === 'string'
          ? item
          : String((item as any)?.property ?? (item as any)?.key ?? (item as any)?.field ?? '').trim();
        if (!key) return null;
        const direction = String((item as any)?.direction ?? '').toLowerCase() === 'desc' ? 'desc' : 'asc';
        return { key: key.replace(/^note\./, ''), direction } as { key: string; direction: 'asc' | 'desc' };
      })
      .filter((item): item is { key: string; direction: 'asc' | 'desc' } => !!item);
  }

  private renderEntry(parent: HTMLElement, entry: LogLineEntry, columns: LogTableColumn[]): void {
    const selected = this.selectedEntryIds.has(entry.selectionId);
    const row = parent.createEl('tr', {
      cls: `bases-table-row tps-log-base-row${selected ? ' tps-log-base-row--selected' : ''}`,
      attr: { 'aria-selected': selected ? 'true' : 'false' },
    });
    row.dataset.entryId = entry.selectionId;
    row.dataset.path = entry.file.path;
    row.dataset.line = String(entry.lineNumber + 1);
    if (/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]\r\n]?\]\s+/u.test(entry.line)) {
      row.dataset.tpsGcmContext = 'table-task';
      row.dataset.taskPath = entry.file.path;
      row.dataset.taskLine = String(entry.lineNumber + 1);
      row.dataset.taskText = getTaskDisplayTitle(entry.line);
      row.dataset.taskLineIdentity = getTaskLineIdentity(entry.line);
    }
    (row as any).__tpsTableView = this;
    row.addEventListener('click', (evt: MouseEvent) => this.handleEntryModifierClick(evt, entry), { capture: true });
    row.addEventListener('click', (evt: MouseEvent) => this.handleEntryClick(evt, entry));
    row.addEventListener('contextmenu', (evt) => this.openEntryContextMenu(evt, entry, row, columns), { capture: true });
    for (const column of columns) {
      const cell = row.createEl('td', { cls: `bases-table-cell tps-log-base-cell tps-log-base-cell--${normalizeInlineKey(column.key)}` });
      cell.dataset.key = column.key;
      cell.dataset.label = column.label;
      if (this.isFileLinkColumn(column.key)) {
        const link = cell.createEl('a', {
          cls: 'internal-link tps-log-base-file-link',
          text: entry.file.basename,
          attr: {
            href: entry.file.path,
            'data-href': entry.file.path,
            'data-linkpath': entry.file.path,
            title: entry.file.path,
            draggable: 'false',
          },
        });
        link.addEventListener('click', (event: MouseEvent) => {
          if (event.shiftKey || event.metaKey || event.ctrlKey) return;
          if (this.plugin.openBaseNotePreviewFromClick(event, entry.file, link, true)) return;
          event.preventDefault();
          event.stopPropagation();
          void this.openEntry(entry);
        });
      } else {
        cell.setText(this.getEntryValue(entry, column.key));
      }
    }
  }

  private renderGroupRow(
    parent: HTMLElement,
    descriptor: TpsBaseGroupDescriptor,
    group: TpsBaseRowGroup<LogLineEntry>,
    columns: LogTableColumn[],
  ): void {
    const label = this.formatGroupLabel(descriptor.property, group.key);
    const row = parent.createEl('tr', {
      cls: 'bases-table-row tps-log-base-group-row',
      attr: {
        'data-group-property': descriptor.property,
        'aria-label': label,
      },
    });
    const cell = row.createEl('th', {
      cls: 'bases-table-cell tps-log-base-cell tps-log-base-cell--group',
      attr: {
        colspan: String(Math.max(1, columns.length)),
        scope: 'rowgroup',
      },
    });
    const content = cell.createDiv({ cls: 'tps-log-base-group-content' });
    content.createSpan({ cls: 'tps-log-base-group-label', text: label });
    content.createSpan({
      cls: 'tps-log-base-group-count',
      text: `${group.rows.length} ${group.rows.length === 1 ? 'row' : 'rows'}`,
    });
  }

  private formatGroupLabel(property: string, value: string | null): string {
    const displayName = String((this.config as any)?.getDisplayName?.(property) ?? '').trim();
    const fallback = isSourceNoteGroupProperty(property)
      ? 'Note'
      : property.replace(/^note\./iu, '').replace(/[._-]+/gu, ' ').trim();
    return `${displayName || fallback || 'Group'} ${value || 'No value'}`;
  }

  private handleEntryClick(evt: MouseEvent, entry: LogLineEntry): void {
    if (evt.defaultPrevented) return;
    if (evt.shiftKey) {
      evt.preventDefault();
      evt.stopPropagation();
      this.selectEntryRange(entry.selectionId);
      return;
    }
    if (evt.metaKey || evt.ctrlKey) {
      evt.preventDefault();
      evt.stopPropagation();
      this.toggleEntrySelection(entry.selectionId);
      return;
    }
    this.selectOnlyEntry(entry.selectionId);
    void this.openEntry(entry);
  }

  private handleEntryModifierClick(evt: MouseEvent, entry: LogLineEntry): void {
    if (!evt.shiftKey && !evt.metaKey && !evt.ctrlKey) return;
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    if (evt.shiftKey) this.selectEntryRange(entry.selectionId);
    else this.toggleEntrySelection(entry.selectionId);
  }

  private selectOnlyEntry(id: string): void {
    this.selectedEntryIds.clear();
    this.selectedEntryIds.add(id);
    this.selectionAnchorId = id;
    this.syncEntrySelectionClasses();
  }

  private toggleEntrySelection(id: string): void {
    const result = toggleOrderedSelection(this.selectedEntryIds, id, this.renderedEntryOrder);
    this.selectedEntryIds = result.selected;
    this.selectionAnchorId = result.anchor;
    this.syncEntrySelectionClasses();
    logger.flow('TpsTableView', 'selection:changed', {
      mode: result.removed ? 'toggle-off' : 'toggle-on',
      selectedCount: this.selectedEntryIds.size,
    });
  }

  private selectEntryRange(id: string): void {
    if (!this.selectionAnchorId || !this.renderedEntryOrder.includes(this.selectionAnchorId)) {
      this.selectOnlyEntry(id);
      logger.flow('TpsTableView', 'selection:changed', { mode: 'range-fallback', selectedCount: 1 });
      return;
    }
    const range = getOrderedSelectionRange(this.renderedEntryOrder, this.selectionAnchorId, id);
    this.selectedEntryIds.clear();
    for (const selectedId of range) this.selectedEntryIds.add(selectedId);
    this.syncEntrySelectionClasses();
    logger.flow('TpsTableView', 'selection:changed', {
      mode: 'range',
      selectedCount: this.selectedEntryIds.size,
      visibleRangeCount: range.length,
    });
  }

  private syncEntrySelectionClasses(): void {
    this.containerEl.querySelectorAll<HTMLElement>('.tps-log-base-row[data-entry-id]').forEach((row) => {
      const selected = !!row.dataset.entryId && this.selectedEntryIds.has(row.dataset.entryId);
      row.classList.toggle('tps-log-base-row--selected', selected);
      row.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  applyEntryContextSelection(evt: MouseEvent, row: HTMLElement): boolean {
    const entryId = row.dataset.entryId;
    if (!entryId) return false;
    if (evt.shiftKey) {
      this.selectEntryRange(entryId);
    } else if (evt.metaKey || evt.ctrlKey) {
      this.toggleEntrySelection(entryId);
    } else if (!this.selectedEntryIds.has(entryId)) {
      this.selectOnlyEntry(entryId);
    }
    return true;
  }

  private renderTotalsRow(
    parent: HTMLElement,
    entries: LogLineEntry[],
    columns: LogTableColumn[],
    position: TpsTableTotalsRowPosition,
  ): number {
    const totals = calculateTpsTableTotals(columns.map((column) => ({
      key: column.key,
      values: entries.map((entry) => this.getEntryValue(entry, column.key)),
    })));
    const row = parent.createEl('tr', {
      cls: 'bases-table-row tps-log-base-row tps-log-base-row--totals',
      attr: {
        'aria-label': 'Totals',
        'data-position': position,
      },
    });
    for (const column of columns) {
      const total = totals.values.get(column.key);
      const isLabel = total == null && column.key === totals.labelKey;
      const cell = row.createEl('td', {
        cls: `bases-table-cell tps-log-base-cell tps-log-base-cell--${normalizeInlineKey(column.key)}${total != null ? ' tps-log-base-cell--total-value' : ''}${isLabel ? ' tps-log-base-cell--total-label' : ''}`,
        text: total ?? (isLabel ? 'Total' : ''),
      });
      cell.dataset.key = column.key;
      cell.dataset.label = column.label;
    }
    return totals.values.size;
  }

  handleExternalRowContextMenu(evt: MouseEvent, row: HTMLElement): boolean {
    const path = row.dataset.path;
    const oneBasedLine = Number(row.dataset.line || '0');
    if (!path || !Number.isInteger(oneBasedLine) || oneBasedLine < 1) return false;

    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();

    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Could not find source file: ${path}`);
      return true;
    }

    void this.plugin.app.vault.cachedRead(file).then((content) => {
      const lineNumber = oneBasedLine - 1;
      const line = content.split('\n')[lineNumber] ?? '';
      const fields = readInlineFields(line);
      const columns = Array.from(row.querySelectorAll<HTMLElement>('.tps-log-base-cell[data-key]')).map((cell) => ({
        key: cell.dataset.key || '',
        label: cell.dataset.label || labelForKey(cell.dataset.key || ''),
      })).filter((column) => column.key);
      this.openEntryContextMenu(evt, {
        id: `${file.path}:${lineNumber}`,
        selectionId: getLogEntrySelectionId(file.path, lineNumber, line, fields),
        file,
        lineNumber,
        line,
        title: getTpsListHeadingDisplayTitle(line) || visibleLineText(line),
        fields,
      }, row, columns);
    }).catch((error) => {
      logger.flowError('TpsTableView', 'context-menu:source-read-failed', error, { path: file.path, lineNumber: oneBasedLine });
      new Notice(`Could not read source file: ${path}`);
    });
    return true;
  }

  private getEntryValue(entry: LogLineEntry, key: string): string {
    const sourceNoteValue = getSourceNoteGroupValue(entry.file, key);
    if (sourceNoteValue !== undefined) return sourceNoteValue ?? '';
    const normalized = normalizeInlineKey(key);
    if (normalized === 'line' || normalized === 'title') return entry.title;
    if (this.isFileLinkColumn(key)) return entry.file.basename;
    if (normalized === 'source' || normalized === 'path') return `${entry.file.path}:${entry.lineNumber + 1}`;
    if (normalized === 'linenumber') return String(entry.lineNumber + 1);
    return this.displayInlineValue(entry.fields[normalized] ?? entry.queryFields?.[normalized] ?? '', entry.file.path);
  }

  private isFileLinkColumn(key: string): boolean {
    const raw = String(key || '').replace(/^note\./, '').trim().toLowerCase();
    return raw === 'file.name'
      || raw === 'file.basename'
      || raw === 'file.link'
      || raw === 'filename'
      || raw === 'basename';
  }

  private displayInlineValue(value: string, sourcePath: string): string {
    const raw = String(value || '').trim();
    const link = raw.match(/^\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]$/);
    if (!link) return raw;
    if (link[2]) return link[2].trim();
    const target = this.plugin.app.metadataCache.getFirstLinkpathDest(link[1], sourcePath);
    if (target instanceof TFile) {
      const frontmatter = this.plugin.app.metadataCache.getFileCache(target)?.frontmatter || {};
      const label = String(frontmatter.accountName || frontmatter.title || '').trim();
      if (label) return label;
      return target.basename;
    }
    return (link[1].split('/').at(-1) || link[1]).trim();
  }

  private async openEntry(entry: LogLineEntry): Promise<void> {
    await this.plugin.openFileInLeaf(
      entry.file,
      false,
      () => this.plugin.app.workspace.getLeaf(false),
      { revealLeaf: true },
    );
  }

  private getViewName(): string {
    return String((this.config as any)?.name || this.config?.get?.('name') || 'TPS Table').trim() || 'TPS Table';
  }

  hasCreateCommandOverride(): boolean {
    return this.getCreateCommandOverride() != null;
  }

  private getCreateCommandOverride(): { id: string; name: string } | null {
    const rawAction = this.getConfigValue('createAction') ?? (this.getConfigValue('create') as any)?.action;
    if (String(rawAction || '').trim().toLowerCase() !== 'command') return null;
    const commandId = String(this.getConfigValue('createCommandId') ?? (this.getConfigValue('create') as any)?.commandId ?? '').trim();
    if (!commandId) return null;
    const commands = (this.plugin.app as any)?.commands;
    const command = commands?.findCommand?.(commandId);
    return { id: commandId, name: String(command?.name || commandId) };
  }

  async runCreateCommandOverride(): Promise<boolean> {
    const command = this.getCreateCommandOverride();
    if (!command) return false;
    if (this.runHomeScopedFoodLogCommand(command.id)) return true;
    const commands = (this.plugin.app as any)?.commands;
    if (typeof commands?.executeCommandById !== 'function') return false;
    try {
      const executed = commands.executeCommandById.call(commands, command.id);
      if (executed !== false) {
        logger.flow('TpsTableView', 'create-command', { commandId: command.id, executed: true, route: 'executeCommandById' });
        return true;
      }

      const commandRecord = commands.findCommand?.(command.id) ?? commands.commands?.[command.id];
      if (typeof commandRecord?.callback === 'function') {
        await commandRecord.callback();
        logger.flow('TpsTableView', 'create-command', { commandId: command.id, executed: true, route: 'callback-fallback' });
        return true;
      }

      new Notice(`Command unavailable: ${command.name}`);
      logger.flowWarn('TpsTableView', 'create-command-unavailable', { commandId: command.id });
      return true;
    } catch (error) {
      logger.flowError('TpsTableView', 'create-command-failed', error, { commandId: command.id });
      new Notice(`Command failed: ${command.name}`);
      return true;
    }
  }

  private runHomeScopedFoodLogCommand(commandId: string): boolean {
    if (String(commandId || '').trim() !== 'tps-health:log-food') return false;
    const contextDate = this.getHomeContextDate();
    if (!contextDate) return false;
    const appAny = this.plugin.app as any;
    const healthCandidates = [
      appAny.tpsHealth,
      appAny.plugins?.getPlugin?.('tps-health'),
      appAny.plugins?.plugins?.['tps-health'],
      appAny.plugins?.getPlugin?.('TPS-health (Dev)'),
      appAny.plugins?.plugins?.['TPS-health (Dev)'],
    ];
    const health = healthCandidates.find((candidate) => typeof candidate?.openFoodLogger === 'function');
    if (!health) return false;
    const moment = (window as any).moment;
    const selected = typeof moment === 'function' ? moment(contextDate, 'YYYY-MM-DD', true) : null;
    const current = typeof moment === 'function' ? moment().startOf('day') : null;
    const dateContext = {
      dateIso: contextDate,
      label: selected?.isValid?.() ? selected.format('ddd, MMM D YYYY') : contextDate,
      isToday: Boolean(selected?.isValid?.() && current?.isValid?.() && selected.isSame(current, 'day')),
      foodLogTarget: 'daily-note',
      focusAfterLog: false,
    };
    health.openFoodLogger(dateContext);
    logger.flow('TpsTableView', 'create-command:home-food-log', { commandId, dateIso: contextDate });
    return true;
  }

  private openEntryContextMenu(evt: MouseEvent, entry: LogLineEntry, row: HTMLElement, columns: LogTableColumn[]): void {
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();

    this.applyEntryContextSelection(evt, row);

    const healthApi = this.getHealthFoodLogApi();
    if (isFoodLogEntry(entry) && typeof healthApi?.openFoodLogEntryMenuFromLine === 'function') {
      logger.flow('TpsTableView', 'context-menu:health-food-handoff', {
        path: entry.file.path,
        lineNumber: entry.lineNumber + 1,
        foodId: entry.fields.foodid || '',
      });
      void healthApi.openFoodLogEntryMenuFromLine(evt, entry.file.path, entry.lineNumber, entry.line);
      return;
    }

    this.setActiveContextRow(row);
    const isHeading = parseTpsListHeadingLine(entry.line) != null;
    const menu = new Menu();
    menu.onHide(() => this.setActiveContextRow(null));

    menu.addItem((item) => {
      item
        .setTitle(`Title: ${getPlainDisplayTitle(entry.title) || '(empty)'}`)
        .setIcon('pencil')
        .setSection('tps-title')
        .onClick(() => this.promptEntryTitle(entry));
    });

    this.addEntryTagsMenu(menu, entry);

    const editableColumns = columns
      .map((column) => ({ ...column, normalized: normalizeInlineKey(column.key) }))
      .filter((column) => column.normalized
        && column.normalized !== 'line'
        && column.normalized !== 'title'
        && column.normalized !== 'source'
        && column.normalized !== 'path'
        && column.normalized !== 'linenumber'
        && column.normalized !== 'tags'
        && (entry.fields[column.normalized] != null || entry.queryFields?.[column.normalized] == null));

    for (const column of editableColumns) {
      const current = entry.fields[column.normalized] ?? '';
      menu.addItem((item) => {
        item
          .setTitle(current ? `${column.label}: ${current}` : `${column.label} (create field)`)
          .setIcon('pencil')
          .onClick(() => this.promptEntryField(entry, column.key, column.label, current));
      });
    }

    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle('Open source line')
        .setIcon('file-text')
        .onClick(() => void this.openEntryAtLine(entry));
    });
    menu.addItem((item) => {
      item
        .setTitle(isHeading ? 'Delete heading' : 'Delete record')
        .setIcon('trash-2')
        .onClick(() => void this.deleteEntry(entry));
      (item as any).setWarning?.(true);
    });

    logger.flow('TpsTableView', 'context-menu', {
      path: entry.file.path,
      lineNumber: entry.lineNumber + 1,
      fields: Object.keys(entry.fields),
      selectedCount: this.selectedEntryIds.size,
    });
    menu.showAtPosition({ x: evt.pageX, y: evt.pageY });
  }

  private setActiveContextRow(row: HTMLElement | null): void {
    if (this.activeContextRow && this.activeContextRow !== row) this.activeContextRow.removeClass('tps-log-base-row--active');
    this.activeContextRow = row;
    if (row) row.addClass('tps-log-base-row--active');
  }

  private promptEntryTitle(entry: LogLineEntry): void {
    const displayTitle = getPlainDisplayTitle(entry.title);
    logger.flow('TpsTableView', 'title-rename:prompt', {
      path: entry.file.path,
      lineNumber: entry.lineNumber + 1,
      linkedTitle: displayTitle !== entry.title,
    });
    new TextInputModal(this.plugin.app, 'Title', displayTitle, async (value) => {
      const title = String(value || '').replace(/\s+/g, ' ').trim();
      if (!title) return;
      await this.updateEntryLine(entry, (line) => (
        parseTpsListHeadingLine(line)
          ? setTpsListHeadingText(line, title)
          : setVisibleLineText(line, title)
      ));
    }).open();
  }

  private addEntryTagsMenu(menu: Menu, entry: LogLineEntry): void {
    const current = readLogLineTags(entry.fields.tags);
    menu.addItem((item) => {
      item
        .setTitle(current.length > 0 ? `Tags (${current.length})` : 'Tags')
        .setIcon('tag');
      const subMenu = (item as any).setSubmenu();
      subMenu.addItem((sub: any) => {
        sub.setTitle('Add tag...').setIcon('plus').onClick(() => {
          new TextInputModal(this.plugin.app, 'Tag', '', async (value) => {
            const tag = normalizeTagValue(String(value || ''));
            if (!tag) {
              new Notice('Enter a valid tag.');
              return;
            }
            await this.updateEntryLine(entry, (line) => setInlineFieldValue(
              line,
              'tags',
              addLogLineTag(readInlineFields(line).tags, tag),
            ));
          }).open();
        });
      });
      if (current.length > 0) subMenu.addSeparator();
      for (const tag of current) {
        subMenu.addItem((sub: any) => {
          sub.setTitle(`Remove #${tag}`).setIcon('x').onClick(() => {
            void this.updateEntryLine(entry, (line) => setInlineFieldValue(
              line,
              'tags',
              removeLogLineTag(readInlineFields(line).tags, tag),
            ));
          });
        });
      }
    });
  }

  private promptEntryField(entry: LogLineEntry, key: string, label: string, current: string): void {
    new TextInputModal(this.plugin.app, label, current, async (value) => {
      await this.updateEntryLine(entry, (line) => setInlineFieldValue(line, key, String(value || '').trim() || null));
    }).open();
  }

  private async openEntryAtLine(entry: LogLineEntry): Promise<void> {
    await this.openEntry(entry);
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    const leaf = this.plugin.app.workspace.activeLeaf;
    const editor = (leaf?.view as any)?.editor;
    if (!editor || typeof editor.setCursor !== 'function') return;
    editor.setCursor({ line: entry.lineNumber, ch: 0 });
    editor.scrollIntoView?.({ from: { line: entry.lineNumber, ch: 0 }, to: { line: entry.lineNumber + 1, ch: 0 } }, true);
    editor.focus?.();
  }

  private async deleteEntry(entry: LogLineEntry): Promise<void> {
    const isHeading = parseTpsListHeadingLine(entry.line) != null;
    await requestLineItemDelete({
      app: this.plugin.app,
      file: entry.file,
      lineIndex: entry.lineNumber,
      rawLine: entry.line,
      itemLabel: isHeading ? 'heading' : 'record',
      source: 'tps-table-menu',
      ...(isHeading ? { blockKind: 'heading-section' as const } : {}),
      resolveLineIndex: (lines) => resolveEntryLineNumber(lines, entry),
      onDeleted: () => this.queueRender(),
    });
  }

  private async updateEntryLine(entry: LogLineEntry, updater: (line: string) => string | null): Promise<void> {
    const mutation: { outcome: 'changed' | 'unchanged' | 'stale' } = { outcome: 'unchanged' };
    await this.plugin.app.vault.process(entry.file, (content) => {
      const lines = content.split('\n');
      const lineNumber = resolveEntryLineNumber(lines, entry);
      if (lineNumber < 0) {
        mutation.outcome = 'stale';
        return content;
      }
      const current = lines[lineNumber] ?? '';
      const nextLine = updater(current);
      if (nextLine === null) {
        lines.splice(lineNumber, 1);
      } else {
        lines[lineNumber] = nextLine;
      }
      if (nextLine === current) return content;
      mutation.outcome = 'changed';
      return lines.join('\n');
    });
    if (mutation.outcome === 'stale') {
      logger.flowWarn('TpsTableView', 'record-mutation:stale-target', {
        path: entry.file.path,
        renderedLineNumber: entry.lineNumber + 1,
        identity: getLogEntryStableIdentity(entry),
      });
      new Notice('That log row changed before it could be updated. Refresh and try again.');
      return;
    }
    logger.flow('TpsTableView', 'record-mutation:done', {
      path: entry.file.path,
      renderedLineNumber: entry.lineNumber + 1,
      outcome: mutation.outcome,
      identity: getLogEntryStableIdentity(entry),
    });
    this.queueRender();
  }

  private getHealthFoodLogApi(): HealthFoodLogApiLike | null {
    const appAny = this.plugin.app as any;
    const candidates = [
      appAny.tpsHealth,
      appAny.plugins?.getPlugin?.('tps-health')?.api,
      appAny.plugins?.plugins?.['tps-health']?.api,
      appAny.plugins?.getPlugin?.('TPS-health (Dev)')?.api,
      appAny.plugins?.plugins?.['TPS-health (Dev)']?.api,
    ];
    return candidates.find((candidate) => typeof candidate?.openFoodLogEntryMenuFromLine === 'function') ?? null;
  }

  private getConfigValue(key: string): unknown {
    const getterValue = this.config?.get?.(key);
    if (getterValue != null) return getterValue;
    return (this.config as any)?.[key];
  }

  private syncNativeResultsCountSoon(): void {
    this.syncNativeResultsCount();
    window.setTimeout(() => this.syncNativeResultsCount(), 0);
    window.setTimeout(() => this.syncNativeResultsCount(), 180);
  }

  private syncNativeResultsCount(): void {
    const header = this.getNearestBasesHeader();
    if (!header) return;
    const text = `${this.renderedResultCount} result${this.renderedResultCount === 1 ? '' : 's'}`;
    const countEl =
      header.querySelector<HTMLElement>('.view-header-count') ??
      header.querySelector<HTMLElement>('.bases-view-results-count') ??
      header.querySelector<HTMLElement>('.bases-results-count') ??
      header.querySelector<HTMLElement>('.bases-view-result-count') ??
      header.querySelector<HTMLElement>('.bases-result-count') ??
      header.querySelector<HTMLElement>('[class*="results-count"]') ??
      header.querySelector<HTMLElement>('[class*="result-count"]');
    if (countEl && countEl.textContent?.trim() !== text) countEl.textContent = text;
  }

  private getNearestBasesHeader(): HTMLElement | null {
    const root = this.containerEl.closest('.workspace-leaf, .internal-embed, .markdown-embed, .cm-embed-block') as HTMLElement | null;
    if (!root) return null;
    const headers = Array.from(root.querySelectorAll<HTMLElement>('.bases-view-header, .base-view-header, .bases-toolbar, .bases-header, .view-header'));
    return headers[headers.length - 1] ?? null;
  }
}

function isFoodLogEntry(entry: LogLineEntry): boolean {
  const type = String(entry.fields.type || '').replace(/[\s_-]+/g, '').toLowerCase();
  return Boolean(entry.fields.foodid || entry.fields.food || type === 'foodlog');
}


function setInlineFieldValue(line: string, key: string, value: string | null): string {
  const cleanKey = String(key || '').replace(/^note\./, '').trim();
  if (!cleanKey) return line;
  const escaped = cleanKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\[${escaped}\\s*::\\s*(?:\\[\\[[^\\]]+\\]\\]|[^\\]]*)\\]`, 'i');
  if (value === null) {
    return String(line || '')
      .replace(pattern, '')
      .replace(/<!--\s*-->/g, '')
      .replace(/\s+(?=-->)/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trimEnd();
  }
  const nextField = `[${cleanKey}:: ${value}]`;
  if (pattern.test(line)) return String(line || '').replace(pattern, nextField);
  const commentMatch = String(line || '').match(/<!--([\s\S]*?)-->\s*$/);
  if (commentMatch) {
    return String(line || '').replace(/<!--([\s\S]*?)-->\s*$/, (_match, body: string) => `<!--${body.trimEnd()} ${nextField} -->`);
  }
  return `${String(line || '').trimEnd()} <!-- ${nextField} -->`;
}

function escapeAttrValue(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function labelForKey(key: string): string {
  const clean = String(key || '').replace(/^note\./, '').trim();
  if (!clean || clean === 'line') return 'Line';
  if (clean === 'title') return 'Title';
  if (/^file\.(?:name|basename|link)$/i.test(clean) || /^(?:filename|basename)$/i.test(clean)) return 'File';
  return clean.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function inferColumnKeys(entries: LogLineEntry[]): string[] {
  const preferred = ['food', 'qty', 'unit', 'servings', 'amount', 'amountUnit', 'cal', 'protein', 'carbs', 'fat', 'completedDate'];
  const available = new Set<string>();
  for (const entry of entries) Object.keys(entry.fields).forEach((key) => available.add(key));
  const ordered = preferred.filter((key) => available.has(normalizeInlineKey(key)));
  for (const key of available) {
    if (!ordered.includes(key)) ordered.push(key);
  }
  return ordered.slice(0, 10);
}
