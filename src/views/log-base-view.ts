import { BasesEntry, BasesView, Menu, Notice, QueryController, TFile, normalizePath, parseYaml } from 'obsidian';
import TPSGlobalContextMenuPlugin from '../main';
import { TextInputModal } from '../modals/text-input-modal';
import { ScheduledModal } from '../modals/scheduled-modal';
import { RecurrenceModal } from '../modals/recurrence-modal';
import { TagSuggestModal } from '../modals/TagSuggestModal';
import { FileSuggestModal } from '../modals/FileSuggestModal';
import * as logger from '../logger';
import {
  addLogLineSemanticTags,
  addLogLineTag,
  getLogEntryStableIdentity,
  normalizeInlineKey,
  readInlineFields,
  readInlineFieldCarrierValues,
  readInlineFieldValues,
  readLogLineTags,
  readLogLinePropertyTags,
  removeLogLineTag,
  resolveEntryLineNumber,
  mutateLogLineContent,
  setLogInlineFieldValue,
  setVisibleLineText,
  toggleLogLineSemanticTag,
  visibleLineText,
} from './log-line-utils';
import { getPlainDisplayTitle } from '../utils/display-title';
import { resolveHomeFoodLineDateKey } from './home-food-date';
import { composeEffectiveFilterRoots, extractFilterRootCandidates, extractPersistedFilterRoots } from '../tps-list/base-filter-roots';
import {
  evaluateLogBaseFilterRoots,
  type LogBaseFilterContext,
  type LogBaseFilterFailure,
} from './log-base-filter';
import { getCurrentBaseEmbedRenderContext, takePendingBaseEmbedRenderContext } from './base-embed-context';
import { calculateTpsTableTotals, normalizeTotalsRowPosition, type TpsTableTotalsRowPosition } from './log-base-totals';
import { getOrderedSelectionRange, toggleOrderedSelection } from '../utils/ordered-selection';
import { hashSelectionIdentity } from '../utils/selection-identity';
import { requestLineItemDelete } from '../services/line-item-delete-service';
import { normalizeTagValue } from '../utils/tag-utils';
import {
  findPropertyKeyCaseInsensitive,
  normalizePropertyKeyIdentity,
} from '../utils/property-key-identity';
import type { KanbanCheckboxMappingLike } from '../tps-list/task-checkbox-utils';
import {
  mapStatusToSubitemCheckboxState,
  mapSubitemCheckboxStateToStatus,
  normalizeLinkedSubitemMappings,
} from '../utils/linked-subitem-mapping';
import {
  getTpsListHeadingDisplayTitle,
  parseTpsListHeadingLine,
  setTpsListHeadingText,
} from '../tps-list/heading-line-utils';
import {
  getTaskDisplayTitle,
  parseTaskLine,
  parseTaskTagValues,
  readInlineFieldValue,
  readTaskLineTags,
} from '../utils/task-line-metadata';
import { getTaskLineIdentity } from '../utils/task-line-resolution';
import {
  getSourceNoteGroupValue,
  groupTpsBaseRows,
  isSourceNoteGroupProperty,
  resolveTpsBaseGroupDescriptor,
  type TpsBaseGroupDescriptor,
  type TpsBaseRowGroup,
} from './base-row-grouping';
import {
  compareTpsBaseValues,
  getTpsBaseAdditiveKindValues,
  resolveTpsBaseMultiValueGroupingMode,
  resolveTpsBaseValueSemantics,
  type TpsBaseValueSemantics,
} from './base-value-semantics';
import { resolveTpsBaseLineCreationPlan } from './base-line-creation-plan';
import {
  formatFileWikilink,
  getWikilinkDisplayText,
  isLinkListProperty,
  parseLinkListInput,
  parseMixedListInput,
  parseStringListInput,
} from '../utils/list-utils';
import {
  resolveConfiguredProperty,
} from '../utils/entity-property';
import type { CustomProperty } from '../types';
import { isTagListProperty } from '../utils/list-utils';
import { collectKnownVaultTags } from '../utils/known-tags';
import { getEffectivePropertyOptions } from '../utils/property-options';
import {
  findRelationalStatusProperty,
  propertyUsesEntityOptions,
  propertyUsesManualOptions,
} from '../utils/property-option-source';
import {
  addPropertyValueChoiceMenuItems,
  showPropertyValueChoiceMenuAtElement,
} from '../menu/property-value-choice-menu';
import { openPropertyValueSuggestModal } from '../modals/PropertyValueSuggestModal';
import { resolveExactLineRevisionIndex, splitLineItemContent } from '../utils/line-item-deletion';
import {
  abortDirectTaskHistory,
  beginDirectTaskHistory,
  commitDirectTaskHistory,
  ensureDirectTaskHistoryIdentity,
  type DirectTaskHistoryLocation,
  type DirectTaskHistoryLogContext,
} from '../utils/direct-task-history';
import { addLineEntityPropertyMenus } from '../menu/line-entity-property-menu';
import type { TaskLineContext } from '../services/task-line-context-menu-service';
import {
  addLogBaseListPropertyValue,
  applyLogBasePropertyValueChoice,
  removeLogBaseListPropertyValue,
} from './log-base-property-choice';
import {
  extractTpsBaseFormulaDefinitions,
  formatTpsFormulaValue,
  hasTpsFormulaReference,
  tpsBaseFormulaService,
  type TpsCompiledFormulaSet,
  type TpsFormulaRecordContext,
  type TpsFormulaResult,
  type TpsFormulaRowSession,
} from '../services/tps-base-formula-service';
import { getOwningWorkspaceFile } from './base-view-owner';
import {
  getBooleanPropertyPresentation,
  getNextBooleanPropertyValue,
  getReadOnlyBooleanFormulaPresentation,
  isBooleanPropertyType,
  normalizeInlineBooleanPropertyValue,
} from '../utils/boolean-property';
import { parseLineEntityMetadata } from '../services/line-entity-source-provider';
import { MarkdownDocumentLineCache } from '../utils/markdown-document-line-cache';
import { compileTpsBaseQueryPlan, type TpsBaseQueryPlan } from './tps-base-query-plan';
import {
  constrainTpsTableSelection,
  getTpsTableSelectionKind,
  getTpsTableSelectionOrder,
  getTpsTableTaskSelectionOrder,
  type TpsTableSelectionKind,
} from './tps-table-selection';
import {
  createPointerDragPreview,
  movePointerDragPreview,
  removePointerDragPreview,
  type PointerDragPreview,
} from '../utils/pointer-drag-preview';

export const TPS_TABLE_VIEW_TYPE = 'tps-table';
const TPS_TABLE_TITLE_ALIASES = new Set([
  'line',
  'title',
  'text',
  'linetext',
  'linetitle',
  'tasktext',
  'tasktitle',
  'headingtext',
  'headingtitle',
]);

/**
 * Authored inline keys preserve punctuation, but documented structural Table
 * columns use dotted namespaces. Resolve only that reserved virtual surface to
 * its synthesized query-field identity so `heading.level` stays distinct from
 * an arbitrary authored key such as `client-id`.
 */
function normalizeTpsTableVirtualKey(key: unknown): string {
  const raw = String(key ?? '').trim().toLocaleLowerCase();
  const aliases: Record<string, string> = {
    'task.title': 'tasktitle',
    'task.text': 'tasktext',
    'task.status': 'taskstatus',
    'task.checkboxstatus': 'taskcheckboxstatus',
    'line.title': 'linetitle',
    'line.text': 'linetext',
    'line.number': 'linenumber',
    'heading.title': 'headingtitle',
    'heading.text': 'headingtext',
    'heading.level': 'headinglevel',
    'heading.line': 'headingline',
  };
  return aliases[raw] ?? normalizePropertyKeyIdentity(raw);
}

interface LogLineEntry {
  id: string;
  selectionId: string;
  file: TFile;
  lineNumber: number;
  line: string;
  title: string;
  fields: Record<string, string>;
  fieldValues?: Record<string, string[]>;
  queryFields?: Record<string, string>;
  formulaSession?: TpsFormulaRowSession;
  entityKind?: 'line' | 'note';
}

interface RenderedLogLineRevision {
  path: string;
  lineNumber: number;
  rawLine: string;
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

function compareStableEntries(left: LogLineEntry, right: LogLineEntry): number {
  return left.file.path.localeCompare(right.file.path)
    || left.lineNumber - right.lineNumber
    || String(left.entityKind || 'line').localeCompare(String(right.entityKind || 'line'))
    || left.selectionId.localeCompare(right.selectionId);
}

function getTpsTableLineDisplayTitle(line: string): string {
  return parseLineEntityMetadata(line)?.displayTitle
    || (parseTaskLine(line) ? getTaskDisplayTitle(line) : '')
    || getTpsListHeadingDisplayTitle(line)
    || visibleLineText(line);
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
  private tableIndexProgress: { completedFiles: number; totalFiles: number; complete: boolean } | null = null;
  private activeContextRow: HTMLElement | null = null;
  private selectedEntryIds = new Set<string>();
  private selectionAnchorId: string | null = null;
  private suppressEntryClickUntil = 0;
  private renderedTaskEntryOrder: string[] = [];
  private renderedNoteEntryOrder: string[] = [];
  private columnWidths: Record<string, number> = {};
  private compiledFormulaSet: TpsCompiledFormulaSet = tpsBaseFormulaService.compile({}, 'tps-table:unresolved');
  private formulaDiagnostics = new Set<string>();
  private filterDiagnostics = new Map<string, LogBaseFilterFailure>();
  private formulaNow: Date | undefined;
  private sourceLineCache: MarkdownDocumentLineCache<TFile> | undefined;
  private activeQueryPlan: TpsBaseQueryPlan | null = null;
  private resolvedBaseViewName = '';
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
      if (file instanceof TFile && file.extension === 'md') this.sourceLineCache?.invalidate(file.path);
      if (file instanceof TFile && (file.extension === 'md' || file.extension === 'base')) this.queueRender();
    }));
    this.registerEvent(this.plugin.app.vault.on('create', (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        this.sourceLineCache?.invalidate(file.path);
        this.queueRender();
      }
    }));
    this.registerEvent(this.plugin.app.vault.on('delete', (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        this.sourceLineCache?.invalidate(file.path);
        this.queueRender();
      }
    }));
    this.registerEvent(this.plugin.app.vault.on('rename', (file, oldPath) => {
      if (!(file instanceof TFile)) return;
      const oldPathLower = String(oldPath || '').toLowerCase();
      const affectsMarkdown = file.extension === 'md' || oldPathLower.endsWith('.md');
      const affectsBase = file.extension === 'base' || oldPathLower.endsWith('.base');
      if (affectsMarkdown) {
        this.sourceLineCache?.invalidateRename(oldPath, file.path);
      }
      if (affectsMarkdown || affectsBase) this.queueRender();
    }));
    void this.render();
  }

  onDataUpdated(): void {
    this.queueRender();
  }

  onunload(): void {
    if (this.refreshTimer != null) window.clearTimeout(this.refreshTimer);
    this.renderGeneration += 1;
    this.sourceLineCache?.clear();
    this.sourceLineCache = undefined;
    this.plugin.taskLineContextMenuService?.releaseTpsTableSelection?.(this.containerEl);
    this.selectedEntryIds.clear();
    this.selectionAnchorId = null;
    this.renderedTaskEntryOrder = [];
    this.renderedNoteEntryOrder = [];
    const previousScroller = this.containerEl.querySelector<HTMLElement>('.tps-log-base-table-scroll');
    const previousScrollLeft = previousScroller?.scrollLeft ?? 0;
    const previousScrollTop = previousScroller?.scrollTop ?? 0;
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
    const queryPlan = compileTpsBaseQueryPlan({
      roots: filterRoots,
      viewName: this.getViewName(),
      configuredProperties: this.plugin.settings?.properties || [],
    });
    if (!queryPlan.valid) {
      const first = queryPlan.diagnostics[0];
      logger.flowWarn('TpsTableView', 'create-line:blocked', {
        reason: first?.code || 'invalid-filter',
        viewName: queryPlan.viewName,
      });
      new Notice(`Could not create an item because a Base filter is unsupported. ${first?.message || ''}`.trim());
      return true;
    }
    const statusService = this.plugin.sharedServices?.status;
    const relationalStatus = findRelationalStatusProperty(this.plugin.settings.properties);
    const taskCheckboxMappings = this.getTaskCheckboxMappings();
    const defaults = resolveTpsBaseLineCreationPlan(filterRoots, {
      resolveValue: (value) => this.resolveLineCreateToken(value),
      orderedMappedStatuses: taskCheckboxMappings.flatMap((mapping) => mapping.statuses),
      isDoneStatus: (status) => statusService?.isDoneStatus?.(status) ?? null,
      isWorkflowStatusProperty: (property) => {
        const normalized = String(property || '').trim().toLowerCase();
        return normalized === 'task.status'
          || normalized.endsWith('checkboxstatus')
          || !relationalStatus;
      },
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

    const title = await this.promptForLineTitle(defaults.kind, headingLevel);
    if (!title) {
      logger.flow('TpsTableView', 'create-line:cancelled', { kind: defaults.kind });
      return true;
    }

    const desiredTaskStatus = defaults.kind === 'task'
      ? (defaults.status || this.getDefaultMappedTaskStatus('open'))
      : null;
    const checkboxState = desiredTaskStatus
      ? mapStatusToSubitemCheckboxState(taskCheckboxMappings, desiredTaskStatus, {
          normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value),
          normalizedMappings: true,
        })
      : null;
    if (defaults.kind === 'task' && !checkboxState) {
      logger.flowWarn('TpsTableView', 'create-line:blocked', {
        reason: 'unmapped-status',
        status: desiredTaskStatus,
        base: this.getBaseFile()?.path || null,
        viewName: this.getViewName(),
      });
      new Notice(`Could not create the task because status "${desiredTaskStatus || '(unavailable)'}" has no checkbox mapping.`);
      return true;
    }
    const plannedDoneClassification = defaults.kind === 'task' && desiredTaskStatus
      ? this.classifyTaskDoneStatus(desiredTaskStatus)
      : null;

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
    const line = buildTpsTableMarkdownLine(defaults.kind, title, defaults.fields, {
      checkboxState,
      headingLevel,
      tags: defaults.tags,
    });
    const fields = readInlineFields(line);
    const rowKind = defaults.kind === 'heading' ? `h${headingLevel}` : defaults.kind;
    const explicitKind = String(fields.kind || '').trim();
    let queryFields: Record<string, string> = {
      ...fields,
      kind: rowKind,
      itemkind: rowKind,
      itemtype: rowKind,
      ...(explicitKind ? { explicitkind: explicitKind, entitykind: explicitKind } : {}),
    };
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
      queryFields = this.scrubTaskWorkflowOwnedFields(queryFields);
      const taskQueryFields = getTpsTableTaskQueryFields(
        line,
        (state) => {
          const mapped = mapSubitemCheckboxStateToStatus(this.getTaskCheckboxMappings(), state) || '';
          return statusService?.normalize?.(mapped) || mapped;
        },
        () => plannedDoneClassification,
      );
      queryFields = {
        ...queryFields,
        ...taskQueryFields,
      };
      if (relationalStatus) {
        const relationalKey = normalizePropertyKeyIdentity(relationalStatus.key);
        if (fields[relationalKey] == null) {
          delete queryFields[relationalKey];
        } else {
          queryFields[relationalKey] = fields[relationalKey];
        }
        if (taskQueryFields.status) queryFields['task.status'] = taskQueryFields.status;
        else delete queryFields['task.status'];
      }
    }
    queryFields = this.applyConfiguredSourceFileFields(queryFields, targetFile);
    logger.flow('TpsTableView', 'create-line:start', {
      kind: defaults.kind,
      targetPath,
      fieldKeys: Object.keys(defaults.fields),
      tagCount: defaults.tags.length,
      status: defaults.status || '',
      headingLevel: defaults.kind === 'heading' ? headingLevel : null,
      selectedBranches: defaults.diagnostics.selectedBranches,
    });
    this.formulaNow = new Date();
    const historyService = this.plugin.itemHistoryService;
    const historyContext: DirectTaskHistoryLogContext = {
      action: 'task.create',
      surface: 'tps-table',
      path: targetPath,
      lineNumber: 0,
    };
    const historyHandle = defaults.kind === 'task'
      ? await beginDirectTaskHistory(historyService, {
          action: historyContext.action,
          cause: {
            kind: 'user',
            sourcePluginId: 'tps-global-context-menu',
            surface: historyContext.surface,
          },
          before: {
            path: targetPath,
            lineNumber: 0,
            rawLine: line,
          },
        })
      : null;
    let blockedReason: 'mismatch' | 'formula-unresolved' | 'mapping-changed' | null = null;
    let insertedLine = line;
    let insertedLineIndex = -1;
    let historyReady = true;
    let writeAccepted = false;
    let processedContent = '';
    try {
      processedContent = await this.plugin.app.vault.process(targetFile, (content) => {
        if (defaults.kind === 'task') {
          const liveMappings = this.getTaskCheckboxMappings();
          const liveState = desiredTaskStatus
            ? mapStatusToSubitemCheckboxState(liveMappings, desiredTaskStatus, {
                normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value),
                normalizedMappings: true,
              })
            : null;
          const liveStatus = checkboxState
            ? mapSubitemCheckboxStateToStatus(liveMappings, checkboxState, { normalizedMappings: true })
            : null;
          if (
            !liveState
            || liveState !== checkboxState
            || this.plugin.sharedServices.status.normalize(liveStatus) !== this.plugin.sharedServices.status.normalize(desiredTaskStatus)
            || this.classifyTaskDoneStatus(desiredTaskStatus) !== plannedDoneClassification
          ) {
            blockedReason = 'mapping-changed';
            return content;
          }
        }
        const nextLineNumber = content.length === 0
          ? 1
          : content.split('\n').length + (content.endsWith('\n') ? 0 : 1);
        insertedLineIndex = nextLineNumber - 1;
        insertedLine = line;
        if (defaults.kind === 'task') {
          const historyIdentity = ensureDirectTaskHistoryIdentity(
            historyService,
            historyHandle,
            line,
            historyContext,
          );
          insertedLine = historyIdentity.line;
          historyReady = historyIdentity.ready;
        }
        const filterContext = this.createFilterContext(
          queryFields,
          targetFile,
          insertedLine,
          rowKind,
          nextLineNumber,
        );
        const prospectiveMatch = evaluateLogBaseFilterRoots(
          filterRoots,
          filterContext,
        );
        if (filterContext.formulaFailed) {
          blockedReason = 'formula-unresolved';
          return content;
        }
        if (prospectiveMatch === false) {
          blockedReason = 'mismatch';
          return content;
        }
        if (prospectiveMatch == null && hasTpsFormulaReference(filterRoots)) {
          blockedReason = 'formula-unresolved';
          return content;
        }
        if (prospectiveMatch == null) {
          logger.flowWarn('TpsTableView', 'create-line:filter-validation-partial', {
            kind: defaults.kind,
            targetPath,
            nextLineNumber,
            unsupportedFilters: defaults.diagnostics.unsupportedFilters,
          });
        }
        writeAccepted = true;
        historyContext.lineNumber = insertedLineIndex;
        return appendTpsTableMarkdownLine(content, insertedLine);
      });
    } catch (error) {
      let reconciled = false;
      if (writeAccepted && insertedLineIndex >= 0) {
        try {
          const currentContent = await this.plugin.app.vault.read(targetFile);
          const currentLines = String(currentContent || '').split(/\r?\n/u);
          const exactMatches = currentLines
            .map((currentLine, index) => currentLine === insertedLine ? index : -1)
            .filter((index) => index >= 0);
          const confirmedIndex = currentLines[insertedLineIndex] === insertedLine
            ? insertedLineIndex
            : historyHandle && historyReady && exactMatches.length === 1
              ? exactMatches[0]
              : -1;
          if (confirmedIndex >= 0) {
            insertedLineIndex = confirmedIndex;
            historyContext.lineNumber = confirmedIndex;
            processedContent = currentContent;
            reconciled = true;
            logger.flow('TpsTableView', 'create-line:write-reconciled', {
              kind: defaults.kind,
              targetPath,
              insertedLineNumber: confirmedIndex + 1,
            });
          }
        } catch (readError) {
          logger.flowError('TpsTableView', 'create-line:write-reconciliation-failed', readError, {
            kind: defaults.kind,
            targetPath,
          });
        }
      }
      if (!reconciled) {
        if (!writeAccepted || !historyHandle || !historyReady) {
          await abortDirectTaskHistory(historyService, historyHandle, historyContext);
        }
        logger.flowError('TpsTableView', 'create-line:write-failed', error, {
          kind: defaults.kind,
          targetPath,
          historyResolution: writeAccepted && historyHandle && historyReady ? 'pending-recovery' : 'aborted',
        });
        new Notice(`Could not create the ${defaults.kind}.`);
        return true;
      }
    }
    if (blockedReason) {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      logger.flowWarn('TpsTableView', 'create-line:blocked', {
        reason: blockedReason === 'mismatch'
          ? 'prospective-line-does-not-match-filters'
          : blockedReason === 'mapping-changed'
            ? 'checkbox-mapping-changed'
            : 'formula-filter-unresolved',
        kind: defaults.kind,
        targetPath,
      });
      new Notice(blockedReason === 'mismatch'
        ? 'TPS Table did not create the item because the resulting line would not match this view.'
        : blockedReason === 'mapping-changed'
          ? 'TPS Table did not create the task because its checkbox mapping changed before the write.'
          : 'TPS Table did not create the item because its formula filter could not be evaluated reliably.');
      return true;
    }
    const persistedLine = String(processedContent || '').split(/\r?\n/u)[insertedLineIndex] || '';
    if (!writeAccepted || insertedLineIndex < 0 || persistedLine !== insertedLine) {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      logger.flowWarn('TpsTableView', 'create-line:write-unconfirmed', {
        kind: defaults.kind,
        targetPath,
        insertedLineNumber: insertedLineIndex + 1,
      });
      new Notice(`Could not confirm the new ${defaults.kind}. Refresh and try again.`);
      return true;
    }
    if (defaults.kind === 'task') {
      if (historyReady) {
        await commitDirectTaskHistory(historyService, historyHandle, {
          after: {
            path: targetPath,
            lineNumber: insertedLineIndex,
            rawLine: persistedLine,
          },
          outcome: 'committed',
        }, historyContext);
      } else {
        await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      }
    }
    logger.flow('TpsTableView', 'create-line:done', { kind: defaults.kind, targetPath });
    this.queueRender();
    return true;
  }

  private async promptForLineTitle(
    kind: TpsTableLineKind,
    headingLevel: 1 | 2 | 3 | 4 | 5 | 6,
  ): Promise<string | null> {
    return await new Promise<string | null>((resolve) => {
      new TpsTableLineCreateModal(this.plugin.app, kind, headingLevel, resolve).open();
    });
  }

  private resolveLineCreateToken(value: string): string {
    const raw = String(value || '').trim();
    if (/^this\.file\.path$/iu.test(raw)) return this.getLineCreateContextPath() || '';
    if (/^this\.(?:scheduled|date)$/iu.test(raw)) return this.getHomeContextDate() || '';
    return raw;
  }

  private getLineCreateContextPath(): string | null {
    const contextHost = this.containerEl?.closest<HTMLElement>('[data-tps-context-path]');
    const candidates = [
      this.containerEl?.dataset?.tpsContextPath,
      contextHost?.dataset.tpsContextPath,
      getOwningWorkspaceFile(this.plugin.app, this.containerEl, 'md')?.path,
    ];
    for (const candidate of candidates) {
      const path = String(candidate || '').trim();
      if (path.toLowerCase().endsWith('.md')) return normalizePath(path).replace(/^\/+/, '');
    }
    return null;
  }

  private queueRender(): void {
    // Invalidate an active render immediately. The debounced replacement gets
    // its own generation when it starts.
    this.renderGeneration += 1;
    if (this.refreshTimer != null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.render();
    }, 150);
  }

  private async render(): Promise<void> {
    const generation = ++this.renderGeneration;
    const start = performance.now();
    this.formulaDiagnostics.clear();
    this.filterDiagnostics.clear();
    this.formulaNow = new Date();
    const entries = await this.loadEntries((partialEntries, progress) => {
      if (generation !== this.renderGeneration) return;
      this.renderEntries(partialEntries, generation, start, progress);
    });
    this.renderEntries(entries, generation, start, {
      completedFiles: 0,
      totalFiles: 0,
      complete: true,
    });
  }

  private renderEntries(
    entries: LogLineEntry[],
    generation: number,
    start: number,
    progress: { completedFiles: number; totalFiles: number; complete: boolean },
  ): void {
    if (generation !== this.renderGeneration) {
      logger.flow('TpsTableView', 'render:stale', { generation });
      return;
    }

    const columns = this.getColumns(entries);
    const groupBy = resolveTpsBaseGroupDescriptor(this.getConfigValue('groupBy'));
    const ungroupedPosition = String(this.getConfigValue('ungroupedPosition') || '').trim().toLowerCase() === 'first'
      ? 'first'
      : 'last';
    const multiValueGrouping = resolveTpsBaseMultiValueGroupingMode(this.getConfigValue('multiValueGrouping'));
    const groupSemantics = groupBy ? this.getOrderingSemantics(groupBy.property) : null;
    const entryGroups = groupBy
      ? groupTpsBaseRows(entries,
          (entry) => this.getEntryOrderingValue(entry, groupBy.property),
          groupBy.direction,
          ungroupedPosition,
          multiValueGrouping,
          groupSemantics!,
        )
      : [{ key: null, rows: entries }];
    const renderedEntries = entryGroups.flatMap((group) => group.rows);
    const totalsPosition = normalizeTotalsRowPosition(this.getConfigValue('totalsRow'));
    this.renderedResultCount = entries.length;
    this.tableIndexProgress = progress.totalFiles > 0 ? progress : null;
    this.renderedTaskEntryOrder = getTpsTableTaskSelectionOrder(renderedEntries);
    this.renderedNoteEntryOrder = getTpsTableSelectionOrder(renderedEntries, 'note');
    const visibleEntryIds = new Set(renderedEntries.map((entry) => entry.selectionId));
    this.selectedEntryIds = new Set([...this.selectedEntryIds].filter((id) => visibleEntryIds.has(id)));
    if (this.selectionAnchorId && !visibleEntryIds.has(this.selectionAnchorId)) this.selectionAnchorId = null;
    const previousScroller = this.containerEl.querySelector<HTMLElement>('.tps-log-base-table-scroll');
    const previousScrollLeft = previousScroller?.scrollLeft ?? 0;
    const previousScrollTop = previousScroller?.scrollTop ?? 0;
    this.containerEl.empty();

    this.syncNativeResultsCountSoon();

    if (!progress.complete && progress.totalFiles > 0) {
      this.containerEl.createDiv({
        cls: 'tps-log-base-index-progress',
        attr: { role: 'status', 'aria-live': 'polite' },
        text: `Indexing… ${progress.completedFiles}/${progress.totalFiles} files. Results are incomplete.`,
      });
    }

    if (this.filterDiagnostics.size > 0) {
      const diagnostics = Array.from(this.filterDiagnostics.values());
      const first = diagnostics[0];
      this.containerEl.createDiv({
        cls: 'tps-log-base-empty tps-log-base-filter-error',
        attr: { role: 'alert' },
        text: `TPS Table excluded rows because ${diagnostics.length === 1 ? 'a filter could not' : 'some filters could not'} be evaluated safely. ${first?.message || 'Review the Base filters.'}`,
      });
    }

    if (!entries.length) {
      if (this.filterDiagnostics.size === 0) {
        this.containerEl.createDiv({ cls: 'tps-log-base-empty', text: 'No matching log lines found.' });
      }
      this.reconcileRenderedTaskSelection();
      logger.flow('TpsTableView', 'render:empty', { durationMs: Math.round(performance.now() - start) });
      return;
    }

    this.columnWidths = this.loadColumnWidths(columns);
    const tableScroller = this.containerEl.createDiv({ cls: 'tps-log-base-table-scroll' });
    this.configureTableScroller(tableScroller);
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
    tableScroller.scrollLeft = Math.min(previousScrollLeft, Math.max(0, tableScroller.scrollWidth - tableScroller.clientWidth));
    tableScroller.scrollTop = Math.min(previousScrollTop, Math.max(0, tableScroller.scrollHeight - tableScroller.clientHeight));
    this.reconcileRenderedTaskSelection();

    logger.flow('TpsTableView', 'render:done', {
      entries: entries.length,
      columns: columns.length,
      groupBy: groupBy?.property ?? null,
      ungroupedPosition: groupBy ? ungroupedPosition : null,
      multiValueGrouping: groupBy ? multiValueGrouping : null,
      groups: groupBy ? entryGroups.length : 0,
      totalsPosition,
      totaledColumns,
      durationMs: Math.round(performance.now() - start),
    });
  }

  private async loadEntries(
    onProgress?: (
      entries: LogLineEntry[],
      progress: { completedFiles: number; totalFiles: number; complete: boolean },
    ) => void,
  ): Promise<LogLineEntry[]> {
    const entries: LogLineEntry[] = [];
    const loadGeneration = typeof this.renderGeneration === 'number' ? this.renderGeneration : null;
    const isCancelled = (): boolean => loadGeneration != null && loadGeneration !== this.renderGeneration;
    const filterRoots = await this.getEffectiveBaseFilterRoots();
    if (isCancelled()) return [];
    const queryPlan = compileTpsBaseQueryPlan({
      roots: filterRoots,
      viewName: this.getViewName(),
      configuredProperties: this.plugin.settings?.properties || [],
    });
    this.activeQueryPlan = queryPlan;
    if (!queryPlan.valid) {
      for (const failure of queryPlan.diagnostics) {
        const key = `${failure.code}:${failure.expression || failure.property || ''}:${failure.operator || ''}`;
        this.filterDiagnostics.set(key, failure);
      }
      logger.flowWarn('TpsTableView', 'filters:query-blocked', {
        viewName: queryPlan.viewName,
        code: queryPlan.diagnostics[0]?.code || 'invalid-filter',
      });
      return [];
    }
    const sourceFiles = (filterRoots.length ? this.plugin.app.vault.getMarkdownFiles() : this.getSourceFiles())
      .filter((file) => !this.plugin.filePropertiesService?.isCompanionFile(file));
    const nonMarkdownNoteFiles = queryPlan.rowFamilies.has('note')
      ? (typeof this.plugin.app.vault.getFiles === 'function' ? this.plugin.app.vault.getFiles() : [])
        .filter((file) => file.extension.toLocaleLowerCase() !== 'md')
        .filter((file) => this.plugin.filePropertiesService?.isPropertyTarget(file)
          && this.plugin.filePropertiesService.hasCompanion(file))
        .sort((left, right) => left.path.localeCompare(right.path))
      : [];
    const checkboxMappings = this.getTaskCheckboxMappings();
    let failedClosedFilterRows = 0;
    const sourceLineCache = this.plugin.baseRowIndexService || this.getSourceLineCache();
    sourceLineCache.prune(sourceFiles);
    const processSourceResults = (sourceResults: readonly any[]): boolean => {
      for (const sourceResult of sourceResults) {
      const file = sourceResult.file;
      if (sourceResult.ok === false) {
        logger.flowWarn('TpsTableView', 'source-read:failed', { path: file.path, error: logger.errorSummary(sourceResult.error) });
        continue;
      }
      if (queryPlan.rowFamilies.has('note')) {
        const noteEntry = this.createNoteProjection(file, filterRoots);
        if (noteEntry) entries.push(noteEntry);
      }
      for (const documentLine of sourceResult.lines) {
        if (!documentLine.isContent) continue;
        const { text: line, index } = documentLine;
        const fields = readInlineFields(line);
        const fieldValues = readInlineFieldValues(line);
        const heading = parseTpsListHeadingLine(line);
        const markdownKind = getTpsTableMarkdownLineKind(line);
        const rowKind = heading ? `h${heading.headingLevel}` : markdownKind;
        if (markdownKind === 'task' && !queryPlan.rowFamilies.has('task')) continue;
        if (markdownKind === 'bullet' && !queryPlan.rowFamilies.has('bullet')) continue;
        if (heading && !queryPlan.rowFamilies.has('heading')) continue;
        if (!markdownKind && !heading && !queryPlan.rowFamilies.has('line')) continue;
        const explicitKinds = getTpsBaseAdditiveKindValues(null, fieldValues.kind ?? fields.kind);
        const explicitKind = explicitKinds.join(', ');
        let queryFields = { ...fields };
        if (rowKind) {
          queryFields.kind = rowKind;
          queryFields.itemkind = rowKind;
          queryFields.itemtype = rowKind;
          if (explicitKind) {
            queryFields.explicitkind = explicitKind;
            queryFields.entitykind = explicitKind;
          }
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
          queryFields = this.scrubTaskWorkflowOwnedFields(queryFields);
          const taskQueryFields = getTpsTableTaskQueryFields(
            line,
            (checkboxState) => {
              const mappedStatus = mapSubitemCheckboxStateToStatus(checkboxMappings, checkboxState) || '';
              return statusService?.normalize?.(mappedStatus) || mappedStatus;
            },
            (status) => this.classifyTaskDoneStatus(status),
          );
          const relationalStatus = findRelationalStatusProperty(this.plugin.settings.properties);
          queryFields = {
            ...queryFields,
            ...taskQueryFields,
          };
          if (relationalStatus) {
            const relationalKey = normalizePropertyKeyIdentity(relationalStatus.key);
            if (fields[relationalKey] == null) {
              delete queryFields[relationalKey];
            } else {
              queryFields[relationalKey] = fields[relationalKey];
            }
            if (taskQueryFields.status) queryFields['task.status'] = taskQueryFields.status;
            else delete queryFields['task.status'];
          }
        }
        queryFields = this.applyConfiguredSourceFileFields(queryFields, file);
        if (!this.lineMatches(queryFields) && !(markdownKind && hasTpsTableLineKindFilter(filterRoots))) continue;
        const filterContext = this.createFilterContext(queryFields, file, line, rowKind, index + 1);
        const filterResult = evaluateLogBaseFilterRoots(filterRoots, filterContext);
        if (filterContext.filterFailed) failedClosedFilterRows += 1;
        if (filterResult === false) continue;
        if (filterResult == null && filterRoots.length) {
          failedClosedFilterRows += 1;
          continue;
        }
        if (!this.lineMatchesHomeDateContext(fields, file)) continue;
        entries.push({
          id: `${file.path}:${index}`,
          selectionId: getLogEntrySelectionId(file.path, index, line, fields),
          file,
          lineNumber: index,
          line,
          title: getTpsTableLineDisplayTitle(line),
          fields,
          fieldValues,
          queryFields,
          formulaSession: filterContext.formulaSession,
          entityKind: 'line',
        });
      }
        if (isCancelled()) return false;
      }
      return true;
    };
    if (typeof (sourceLineCache as any).readProgressive === 'function') {
      const progressive = await (sourceLineCache as any).readProgressive(sourceFiles, {
        batchSize: 64,
        isCancelled,
        onProgress: (progress: {
          completedFiles: number;
          totalFiles: number;
          complete: boolean;
          results: readonly any[];
        }) => {
          if (!processSourceResults(progress.results) || isCancelled()) return;
          if (!progress.complete) {
            onProgress?.(this.sortEntries([...entries]), {
              completedFiles: progress.completedFiles,
              totalFiles: progress.totalFiles,
              complete: false,
            });
          }
        },
      });
      if (progressive.cancelled || isCancelled()) return [];
    } else {
      const sourceBatch = await sourceLineCache.readMany(sourceFiles, { isCancelled });
      if (sourceBatch.cancelled || isCancelled()) return [];
      if (!processSourceResults(sourceBatch.results)) return [];
    }
    for (const file of nonMarkdownNoteFiles) {
      if (isCancelled()) return [];
      const noteEntry = this.createNoteProjection(file, filterRoots);
      if (noteEntry) entries.push(noteEntry);
    }
    if (failedClosedFilterRows) {
      logger.flowWarn('TpsTableView', 'filters:rows-failed-closed', {
        base: this.getBaseFile()?.path || null,
        viewName: this.getViewName(),
        rows: failedClosedFilterRows,
      });
    }
    return this.sortEntries(entries);
  }

  private createNoteProjection(file: TFile, filterRoots: readonly unknown[]): LogLineEntry | null {
    const logicalFrontmatter = file.extension.toLocaleLowerCase() === 'md'
      ? (this.plugin.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, unknown>
      : this.plugin.filePropertiesService?.read(file) || {};
    const frontmatter = this.applyConfiguredSourceFileFrontmatter(logicalFrontmatter, file);
    const noteFields = Object.fromEntries(Object.entries(frontmatter).map(([key, value]) => [
      normalizePropertyKeyIdentity(key),
      Array.isArray(value) ? value.map((entry) => String(entry ?? '')).join(', ') : String(value ?? ''),
    ]));
    const kindKey = findPropertyKeyCaseInsensitive(frontmatter, 'kind');
    const authoredKinds = kindKey == null
      ? []
      : (Array.isArray(frontmatter[kindKey]) ? frontmatter[kindKey] : [frontmatter[kindKey]])
        .map((value) => String(value ?? '').trim()).filter(Boolean);
    noteFields.kind = 'note';
    noteFields.itemkind = 'note';
    noteFields.itemtype = 'note';
    if (authoredKinds.length) noteFields.explicitkind = authoredKinds.join(', ');
    const noteContext = this.createFilterContext(noteFields, file, '', 'note', 0);
    if (evaluateLogBaseFilterRoots([...filterRoots], noteContext) !== true) return null;
    const titleKey = findPropertyKeyCaseInsensitive(frontmatter, 'title');
    return {
      id: `${file.path}:note`,
      selectionId: `${file.path}:note`,
      file,
      lineNumber: -1,
      line: '',
      title: String(titleKey == null ? file.basename : frontmatter[titleKey] || file.basename),
      fields: noteFields,
      queryFields: noteFields,
      formulaSession: noteContext.formulaSession,
      entityKind: 'note',
    };
  }

  private applyConfiguredSourceFileFields(fields: Record<string, string>, file: TFile): Record<string, string> {
    let resolved = fields;
    for (const property of this.plugin.settings?.properties || []) {
      if (property.type !== 'folder') continue;
      if (resolved === fields) resolved = { ...fields };
      resolved[normalizePropertyKeyIdentity(property.key)] = file.parent?.path || '/';
    }
    return resolved;
  }

  private applyConfiguredSourceFileFrontmatter(
    frontmatter: Record<string, unknown>,
    file: TFile,
  ): Record<string, unknown> {
    const folderProperties = (this.plugin.settings?.properties || []).filter((property) => property.type === 'folder');
    if (!folderProperties.length) return frontmatter;
    const resolved = { ...frontmatter };
    for (const property of folderProperties) {
      const authoredKey = findPropertyKeyCaseInsensitive(resolved, property.key);
      resolved[authoredKey || property.key] = file.parent?.path || '/';
    }
    return resolved;
  }

  private getSourceLineCache(): MarkdownDocumentLineCache<TFile> {
    if (!this.sourceLineCache) {
      this.sourceLineCache = new MarkdownDocumentLineCache<TFile>(
        (file) => this.plugin.app.vault.cachedRead(file),
      );
    }
    return this.sourceLineCache;
  }

  private getTaskCheckboxMappings(): KanbanCheckboxMappingLike[] {
    return normalizeLinkedSubitemMappings(this.plugin.settings?.linkedSubitemCheckboxMappings, {
      enforceStrictDefaults: false,
      normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value),
    });
  }

  private classifyTaskDoneStatus(rawStatus: unknown): boolean | null {
    const statusService = this.plugin.sharedServices?.status;
    if (typeof statusService?.isDoneStatus !== 'function') return null;
    const status = statusService.normalize(rawStatus);
    return status ? statusService.isDoneStatus(status) : null;
  }

  private getDefaultMappedTaskStatus(kind: 'open' | 'done'): string | null {
    for (const mapping of this.getTaskCheckboxMappings()) {
      for (const rawStatus of mapping.statuses) {
        const status = this.plugin.sharedServices.status.normalize(rawStatus);
        const done = this.classifyTaskDoneStatus(status);
        if (status && done != null && done === (kind === 'done')) return status;
      }
    }
    return null;
  }

  private getTaskWorkflowOwnedFieldKeys(): Set<string> {
    const relationalKey = normalizeInlineKey(
      findRelationalStatusProperty(this.plugin.settings.properties)?.key || '',
    );
    const workflowKey = normalizeInlineKey(
      this.plugin.sharedServices?.status?.getStatusPropertyKey?.() || 'status',
    );
    return new Set([
      workflowKey,
      'status',
      'task.status',
      'task.checkboxStatus',
      'checkboxStatus',
      'open',
      'isOpen',
      'done',
      'isDone',
      'completed',
      'complete',
    ].map((key) => normalizeInlineKey(key)).filter((key) => key && key !== relationalKey));
  }

  private scrubTaskWorkflowOwnedFields(fields: Record<string, string>): Record<string, string> {
    const owned = this.getTaskWorkflowOwnedFieldKeys();
    return Object.fromEntries(
      Object.entries(fields).filter(([key]) => !owned.has(normalizeInlineKey(key))),
    );
  }

  private async getEffectiveBaseFilterRoots(failOnReadError = false): Promise<unknown[]> {
    const runtimeRoots = this.getRuntimeBaseFilterRoots();
    const stampedRoots = this.getStampedBaseFilterRoots(failOnReadError);
    if (stampedRoots) {
      return composeEffectiveFilterRoots(
        this.runtimeBaseFiltersMatchResolvedView() ? runtimeRoots : [],
        stampedRoots,
      );
    }
    const baseFile = this.getBaseFile();
    if (!baseFile) {
      this.compiledFormulaSet = tpsBaseFormulaService.compile({}, 'tps-table:unresolved');
      if (failOnReadError) throw new Error('Could not resolve the Base definition for line creation');
      return composeEffectiveFilterRoots(runtimeRoots, []);
    }
    try {
      const parsed = parseYaml(await this.plugin.app.vault.cachedRead(baseFile)) as Record<string, unknown> | null | undefined;
      this.compiledFormulaSet = tpsBaseFormulaService.compile(
        extractTpsBaseFormulaDefinitions(parsed),
        `${baseFile.path}:${Number(baseFile.stat?.mtime || 0)}`,
      );
      const persisted = this.resolvePersistedFilterRoots(parsed);
      const roots = composeEffectiveFilterRoots(
        this.runtimeBaseFiltersMatchResolvedView() ? runtimeRoots : [],
        persisted.filters || [],
      );
      logger.flow('TpsTableView', 'filters:resolved', {
        base: baseFile.path,
        viewName: persisted.viewName || this.getViewName(),
        runtimeRoots: runtimeRoots.length,
        effectiveRoots: roots.length,
      });
      return roots;
    } catch (error) {
      this.compiledFormulaSet = tpsBaseFormulaService.compile({}, `tps-table:read-error:${baseFile.path}`);
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
      const source = this.containerEl.closest<HTMLElement>('[data-tps-base-path]')?.dataset.tpsBasePath
        || this.getBaseFile()?.path
        || 'embedded';
      this.compiledFormulaSet = tpsBaseFormulaService.compile(
        extractTpsBaseFormulaDefinitions(parsed),
        `tps-table:stamped:${source}`,
      );
      return this.resolvePersistedFilterRoots(parsed).filters;
    } catch (error) {
      this.compiledFormulaSet = tpsBaseFormulaService.compile({}, 'tps-table:stamped-invalid');
      logger.flowWarn('TpsTableView', 'filters:stamped-definition-invalid', { error: logger.errorSummary(error) });
      if (failOnReadError) throw error;
      return null;
    }
  }

  private getBaseFile(): TFile | null {
    const host = this.containerEl?.closest<HTMLElement>('[data-tps-base-path], [data-path$=".base"], [data-src$=".base"], .internal-embed[src$=".base"], .markdown-embed[src$=".base"]');
    const candidates = [
      host?.dataset.tpsBasePath,
      host?.dataset.path,
      host?.dataset.src,
      host?.getAttribute('src'),
    ];
    for (const candidate of candidates) {
      const path = normalizePath(String(candidate || '').trim()).replace(/^\/+/, '');
      if (!path.toLowerCase().endsWith('.base')) continue;
      const file = this.plugin.app.vault.getFileByPath(path);
      if (file instanceof TFile) return file;
    }
    return getOwningWorkspaceFile(this.plugin.app, this.containerEl, 'base');
  }

  private createFilterContext(
    fields: Record<string, string>,
    file: TFile,
    line = '',
    rowKind: string | null = null,
    oneBasedLineNumber = 1,
  ): LogBaseFilterContext {
    // Query fields contain virtual workflow aliases used by Base filters. Build
    // formulas from the authored line again so a virtual task status cannot
    // overwrite an inline relational `[status:: ...]` value.
    const parsedLine = line ? parseLineEntityMetadata(line) : null;
    const inlineGroups = new Map<string, { aliases: Set<string>; values: string[] }>();
    for (const field of parsedLine?.fields ?? []) {
      const key = String(field.key || '').trim();
      const normalized = normalizeInlineKey(key);
      if (!key || !normalized) continue;
      const group = inlineGroups.get(normalized) ?? { aliases: new Set<string>(), values: [] };
      group.aliases.add(key);
      group.values.push(String(field.value ?? '').trim());
      inlineGroups.set(normalized, group);
    }
    const formulaFields: Record<string, unknown> = { ...fields };
    const filterFields: Record<string, unknown> = { ...fields };
    for (const [normalized, group] of inlineGroups) {
      const aggregate: unknown = group.values.length > 1 ? [...group.values] : group.values[0] ?? '';
      formulaFields[normalized] = aggregate;
      for (const alias of group.aliases) formulaFields[alias] = aggregate;
      const configuredProperty = Array.from(group.aliases)
        .map((alias) => resolveConfiguredProperty(this.plugin.settings?.properties || [], alias))
        .find((property) => property?.type === 'list');
      if (configuredProperty) {
        const listValues = group.values.flatMap((value) => propertyUsesEntityOptions(configuredProperty)
          ? isLinkListProperty(configuredProperty) ? parseLinkListInput(value) : parseMixedListInput(value)
          : isLinkListProperty(configuredProperty) ? parseLinkListInput(value) : parseStringListInput(value));
        const aggregateList = Array.from(new Set(listValues.map((value) => value.trim()).filter(Boolean)));
        filterFields[normalized] = aggregateList;
        for (const alias of group.aliases) filterFields[alias] = aggregateList;
      }
    }
    if (rowKind === 'task') {
      const owned = this.getTaskWorkflowOwnedFieldKeys();
      for (const key of Object.keys(formulaFields)) {
        if (owned.has(normalizeInlineKey(key))) delete formulaFields[key];
      }
      for (const [key, value] of Object.entries(fields)) {
        if (owned.has(normalizeInlineKey(key))) formulaFields[key] = value;
      }
    }
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const frontmatter = this.applyConfiguredSourceFileFrontmatter(
      (cache?.frontmatter || {}) as Record<string, unknown>,
      file,
    );
    const frontmatterTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : frontmatter.tags ? [frontmatter.tags] : [];
    const tags = parseTaskTagValues([
      ...(cache?.tags || []).map((tag) => tag.tag),
      ...frontmatterTags.map((tag) => String(tag || '')),
    ]);
    const taskTags = rowKind ? parsedLine?.tags ?? readTaskLineTags(line) : [];
    const fileContext = {
      path: file.path,
      name: file.name,
      basename: file.basename,
      extension: file.extension,
      folder: file.parent?.path || '',
      size: Number(file.stat?.size || 0),
      ctime: Number(file.stat?.ctime || 0),
      mtime: Number(file.stat?.mtime || 0),
      tags,
      links: (cache?.links || []).map((link) => link.link),
      properties: frontmatter,
    };
    const contextPath = this.getLineCreateContextPath();
    const contextFile = contextPath ? this.plugin.app.vault.getFileByPath(contextPath) : this.getBaseFile();
    const contextCache = contextFile instanceof TFile
      ? this.plugin.app.metadataCache.getFileCache(contextFile)
      : null;
    const contextFrontmatter = contextFile instanceof TFile
      ? this.applyConfiguredSourceFileFrontmatter(
          (contextCache?.frontmatter || {}) as Record<string, unknown>,
          contextFile,
        )
      : (contextCache?.frontmatter || {}) as Record<string, unknown>;
    const contextDate = this.getHomeContextDate();
    const thisValue: Record<string, unknown> = {
      ...contextFrontmatter,
      ...(contextDate ? { scheduled: contextDate, date: contextDate } : {}),
      ...(contextFile instanceof TFile ? {
        file: {
          path: contextFile.path,
          name: contextFile.name,
          basename: contextFile.basename,
          extension: contextFile.extension,
          folder: contextFile.parent?.path || '',
          size: Number(contextFile.stat?.size || 0),
          ctime: Number(contextFile.stat?.ctime || 0),
          mtime: Number(contextFile.stat?.mtime || 0),
          tags: parseTaskTagValues([
            ...(contextCache?.tags || []).map((tag) => tag.tag),
            ...([contextFrontmatter.tags].flat().filter(Boolean)),
          ]),
          links: (contextCache?.links || []).map((link) => link.link),
          properties: contextFrontmatter,
        },
      } : {}),
    };
    const title = getTpsTableLineDisplayTitle(line);
    const authoredExplicitKinds = (parsedLine?.fields ?? [])
      .filter((field) => normalizeInlineKey(field.key) === 'kind')
      .flatMap((field) => parseStringListInput(field.value));
    const explicitKinds = Array.from(new Set(
      authoredExplicitKinds.length > 0
        ? authoredExplicitKinds
        : parseStringListInput(fields.explicitkind ?? fields.entitykind),
    ));
    const normalizeKind = (value: unknown): string => {
      const normalized = String(value ?? '').trim().toLowerCase();
      if (normalized === 'tasks') return 'task';
      if (normalized === 'bullets') return 'bullet';
      if (normalized === 'notes') return 'note';
      return normalized;
    };
    const kinds = Array.from(new Set(
      [...(rowKind ? [rowKind] : []), ...explicitKinds]
        .map(normalizeKind)
        .filter(Boolean),
    ));
    const workflowStatus = String(fields['task.status'] ?? fields.checkboxstatus ?? '').trim();
    const checkboxState = String(fields.checkboxstate ?? '').trim();
    const row: Record<string, unknown> = {
      ...formulaFields,
      ...(rowKind ? { kind: rowKind } : {}),
      ...(rowKind ? { itemKind: rowKind, itemType: rowKind } : {}),
      explicitKind: explicitKinds.length > 1 ? explicitKinds : explicitKinds[0] ?? null,
      kinds,
      title,
      text: title,
      line: oneBasedLineNumber,
      lineNumber: oneBasedLineNumber,
      path: file.path,
      tags: taskTags.length ? taskTags.map((tag) => `#${tag}`) : fields.tags,
    };
    if (rowKind === 'task') {
      const relationalStatusKey = normalizeInlineKey(
        findRelationalStatusProperty(this.plugin.settings.properties)?.key || '',
      );
      if (relationalStatusKey === 'status' && inlineGroups.has('status')) {
        row.status = formulaFields.status;
      } else {
        delete row.status;
      }
      row.checkboxState = checkboxState;
      if (workflowStatus) row.checkboxStatus = workflowStatus;
    }
    const lineContext: Record<string, unknown> = {
      ...row,
      number: oneBasedLineNumber,
      raw: line,
      file: fileContext,
    };
    const taskContext = rowKind === 'task' ? {
      ...row,
      ...(workflowStatus ? { status: workflowStatus, checkboxStatus: workflowStatus } : {}),
      checkboxState,
      ...(fields.open != null ? { open: fields.open === 'true' } : {}),
      ...(fields.done != null || fields.completed != null
        ? { done: fields.done === 'true' || fields.completed === 'true' }
        : {}),
      tags: taskTags.map((tag) => `#${tag}`),
      file: fileContext,
    } : null;
    const headingLevel = String(rowKind || '').match(/^h([1-6])$/u)?.[1];
    const formulaContext: TpsFormulaRecordContext = {
      row,
      note: frontmatter,
      file: fileContext,
      thisValue,
      task: taskContext,
      line: lineContext,
      heading: headingLevel ? {
        ...row,
        level: Number(headingLevel),
        text: title,
        title,
        file: fileContext,
      } : null,
      now: this.formulaNow,
    };
    return {
      fields: filterFields,
      configuredProperties: this.plugin.settings?.properties || [],
      contextDate,
      rowKind,
      title,
      rawLine: line,
      lineNumber: oneBasedLineNumber,
      taskTags: taskTags.length ? taskTags : undefined,
      file: {
        path: file.path,
        name: file.name,
        basename: file.basename,
        extension: file.extension,
        folder: file.parent?.path || '',
        size: Number(file.stat?.size || 0),
        ctime: Number(file.stat?.ctime || 0),
        mtime: Number(file.stat?.mtime || 0),
        tags,
        links: (cache?.links || []).map((link) => link.link),
        frontmatter,
      },
      formulaSession: tpsBaseFormulaService.createSession(
        this.compiledFormulaSet ?? tpsBaseFormulaService.compile({}, 'tps-table:test-harness'),
        formulaContext,
      ),
      onFormulaFailure: (result) => {
        this.reportFormulaFailureAt(file, oneBasedLineNumber, result);
      },
      onFilterFailure: (failure) => {
        this.reportFilterFailureAt(file, oneBasedLineNumber, failure);
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
    const nativeFiles = Array.from(byPath.values());
    // A filterless custom Base view can receive an empty native note dataset
    // even though its lineFilterKey intentionally targets synthesized Markdown
    // rows. With no native source constraint to preserve, scan the vault and
    // let the row-level key contract select the matching lines.
    return nativeFiles.length > 0
      ? nativeFiles
      : this.plugin.app.vault.getMarkdownFiles();
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
    const host = this.containerEl?.closest<HTMLElement>('[data-tps-context-source="home"][data-tps-context-date], [data-tps-context-source="home"][data-tps-context-scheduled]');
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
    const basePath = this.getBaseFile()?.path || '';
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

  private configureTableScroller(scroller: HTMLElement): void {
    scroller.tabIndex = 0;
    scroller.setAttribute('role', 'region');
    scroller.setAttribute('aria-label', `${this.getViewName()} table`);
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
    if (!descriptors.length) return [...entries].sort(compareStableEntries);
    return entries.map((entry, index) => ({ entry, index })).sort((a, b) => {
      for (const descriptor of descriptors) {
        const semantics = this.getOrderingSemantics(descriptor.key);
        const result = compareTpsBaseValues(
          this.getEntryOrderingValue(a.entry, descriptor.key),
          this.getEntryOrderingValue(b.entry, descriptor.key),
          semantics,
          descriptor.direction,
        );
        if (result !== 0) return result;
      }
      return compareStableEntries(a.entry, b.entry) || a.index - b.index;
    }).map(({ entry }) => entry);
  }

  private getOrderingSemantics(key: string): TpsBaseValueSemantics {
    const property = this.isExplicitTaskWorkflowStatusColumn(key)
      ? this.createTaskWorkflowStatusProperty({ key, label: labelForKey(key) })
      : resolveConfiguredProperty(this.plugin.settings?.properties || [], key);
    const normalized = normalizeTpsTableVirtualKey(key);
    if (normalized === 'kind') return { kind: 'choice', collection: true, itemKind: 'choice' };
    if (normalized === 'itemkind' || normalized === 'itemtype') return { kind: 'choice', collection: false };
    if (normalized === 'explicitkind' || normalized === 'entitykind') {
      return { kind: 'choice', collection: true, itemKind: 'choice' };
    }
    return resolveTpsBaseValueSemantics(key, property);
  }

  private getEntryOrderingValue(entry: LogLineEntry, key: string): unknown {
    if (/^formula\./iu.test(String(key || '').trim())) return this.getEntryRawValue(entry, key);
    const configuredProperty = resolveConfiguredProperty(this.plugin.settings?.properties || [], key);
    if (configuredProperty?.type === 'folder') return entry.file.parent?.path || '/';
    if (configuredProperty?.type === 'list') return this.getEntryConfiguredPropertyValueItems(entry, configuredProperty);
    const sourceNoteValue = getSourceNoteGroupValue(entry.file, key);
    if (sourceNoteValue !== undefined) return sourceNoteValue;
    const normalized = normalizeTpsTableVirtualKey(key);
    const rowKind = this.getEntryStructuralKind(entry);
    if (normalized === 'kind') {
      return getTpsBaseAdditiveKindValues(
        rowKind,
        entry.fields.explicitkind ?? entry.fieldValues?.kind ?? entry.fields.kind,
      );
    }
    if (normalized === 'itemkind' || normalized === 'itemtype') return rowKind;
    if (normalized === 'explicitkind' || normalized === 'entitykind') {
      const explicitKinds = getTpsBaseAdditiveKindValues(null, entry.fieldValues?.kind ?? entry.fields.kind);
      return explicitKinds.length > 1 ? explicitKinds : explicitKinds[0] ?? '';
    }
    if (TPS_TABLE_TITLE_ALIASES.has(normalized)) return entry.title;
    if (this.isFileLinkColumn(key)) return entry.file.path;
    if (normalized === 'source' || normalized === 'path') return `${entry.file.path}:${entry.lineNumber + 1}`;
    if (normalized === 'linenumber') return entry.lineNumber + 1;
    if (
      parseTaskLine(entry.line)
      && (normalized === 'status' || normalized === 'taskstatus' || normalized === 'taskcheckboxstatus' || normalized === 'checkboxstatus')
    ) {
      return entry.queryFields?.['task.status']
        ?? entry.queryFields?.taskstatus
        ?? entry.queryFields?.checkboxstatus
        ?? entry.queryFields?.status
        ?? '';
    }
    return entry.fields[normalized] ?? entry.queryFields?.[normalized] ?? '';
  }

  private getEntryStructuralKind(entry: Pick<LogLineEntry, 'line' | 'entityKind'>): string {
    if (entry.entityKind === 'note') return 'note';
    const heading = parseTpsListHeadingLine(entry.line);
    return heading ? `h${heading.headingLevel}` : getTpsTableMarkdownLineKind(entry.line) || '';
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
    if (entry.entityKind !== 'note') {
      row.dataset.line = String(entry.lineNumber + 1);
      (row as any).__tpsTableEntryRevision = {
        path: entry.file.path,
        lineNumber: entry.lineNumber,
        rawLine: entry.line,
      } satisfies RenderedLogLineRevision;
    }
    const selectionKind = getTpsTableSelectionKind(entry);
    if (selectionKind) {
      row.dataset.tpsTableBatchSelectable = 'true';
      row.dataset.tpsTableBatchKind = selectionKind;
    }
    if (selectionKind === 'task') {
      row.dataset.tpsGcmContext = 'table-task';
      row.dataset.taskPath = entry.file.path;
      row.dataset.taskLine = String(entry.lineNumber + 1);
      row.dataset.taskText = getTaskDisplayTitle(entry.line);
      row.dataset.taskLineIdentity = getTaskLineIdentity(entry.line);
      (row as HTMLElement & { __tpsGcmItemPropertyRef?: { path: string; lineNumber: number; rawLine: string } })
        .__tpsGcmItemPropertyRef = {
          path: entry.file.path,
          lineNumber: entry.lineNumber,
          rawLine: entry.line,
        };
      row.addEventListener('pointerdown', (event: PointerEvent) => this.beginExternalTaskPointerDrag(event, row));
    }
    (row as any).__tpsTableView = this;
    row.addEventListener('click', (evt: MouseEvent) => this.handleEntryModifierClick(evt, entry), { capture: true });
    row.addEventListener('click', (evt: MouseEvent) => this.handleEntryClick(evt, entry));
    row.addEventListener('contextmenu', (evt) => entry.entityKind === 'note'
      ? this.openNoteEntryContextMenu(evt, entry, row)
      : this.openEntryContextMenu(evt, entry, row, columns), { capture: true });
    for (const column of columns) {
      const cell = row.createEl('td', { cls: `bases-table-cell tps-log-base-cell tps-log-base-cell--${normalizeInlineKey(column.key)}` });
      cell.dataset.key = column.key;
      cell.dataset.label = column.label;
      cell.dataset.tpsTableCellIntent = 'navigation';
      if (/^formula\./iu.test(String(column.key || '').trim())) {
        cell.dataset.tpsTableCellIntent = 'formula';
        const formulaResult = this.getEntryFormulaResult(entry, column.key);
        if (formulaResult.status === 'error' || formulaResult.status === 'unsupported') {
          this.reportFormulaFailure(entry, formulaResult);
          cell.setText('⚠ Formula');
        } else if (getReadOnlyBooleanFormulaPresentation(formulaResult.value)) {
          this.renderTableBooleanCell(cell, column.label, formulaResult.value);
        } else {
          cell.setText(formatTpsFormulaValue(formulaResult.value));
        }
      } else if (this.isFileLinkColumn(column.key)) {
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
      } else if (entry.entityKind === 'note') {
        cell.dataset.tpsTableCellIntent = 'note-property';
        cell.setText(this.getEntryValue(entry, column.key));
      } else {
        const configuredProperty = this.isExplicitTaskWorkflowStatusColumn(column.key)
          ? this.createTaskWorkflowStatusProperty(column)
          : resolveConfiguredProperty(this.plugin.settings.properties || [], column.key);
        if (configuredProperty) {
          this.renderConfiguredPropertyCell(cell, entry, column, configuredProperty);
        } else if (this.isTagColumn(column, null)) {
          const currentTags = readLogLinePropertyTags(
            entry.line,
            column.key,
            entry.fields[normalizeInlineKey(column.key)]
              ?? entry.queryFields?.[normalizeInlineKey(column.key)]
              ?? '',
          );
          this.configureTypedCell(
            cell,
            `${column.label}: ${currentTags.length > 0 ? currentTags.map((tag) => `#${tag}`).join(', ') : 'empty'}`,
            currentTags.length > 0 ? currentTags.map((tag) => `#${tag}`).join(', ') : `+ ${column.label}`,
            () => this.openTagCellEditor(entry, column.key),
          );
        } else if (this.isDatetimeColumn(column, null)) {
          const current = entry.fields[normalizeInlineKey(column.key)]
            ?? entry.queryFields?.[normalizeInlineKey(column.key)]
            ?? '';
          this.configureTypedCell(
            cell,
            `${column.label}: ${current || 'empty'}`,
            this.getEntryValue(entry, column.key) || `+ ${column.label}`,
            () => this.openScheduledCellEditor(
              entry,
              this.createDatetimeColumnProperty(column),
            ),
          );
        } else if (this.getWritableInlineColumnKey(column.key)) {
          this.renderGenericInlinePropertyCell(cell, entry, column);
        } else {
          cell.setText(this.getEntryValue(entry, column.key));
        }
      }
    }
  }

  private renderConfiguredPropertyCell(
    cell: HTMLElement,
    entry: LogLineEntry,
    column: LogTableColumn,
    property: CustomProperty,
  ): void {
    const entityOptions = propertyUsesEntityOptions(property);
    if (property.type === 'folder') {
      const folder = entry.file.parent?.path || '/';
      cell.dataset.tpsTableCellIntent = 'source-folder';
      cell.setAttr('aria-label', `${property.label || column.label}: ${folder}`);
      cell.setText(folder);
      return;
    }
    if (!entityOptions && isBooleanPropertyType(property.type)) {
      const current = normalizeInlineBooleanPropertyValue(
        entry.fields[normalizePropertyKeyIdentity(property.key)]
          ?? entry.queryFields?.[normalizePropertyKeyIdentity(property.key)],
      );
      this.renderTableBooleanCell(
        cell,
        property.label || column.label,
        current,
        async (next) => {
          try {
            return await this.updateEntryLine(
              entry,
              (line) => setLogInlineFieldValue(line, property.key, String(next)),
            );
          } catch (error) {
            logger.flowError('TpsTableView', 'boolean-property-cell:update-failed', error, {
              path: entry.file.path,
              lineNumber: entry.lineNumber + 1,
              property: property.key,
            });
            new Notice(`Could not update ${property.label || property.key}.`);
            return false;
          }
        },
        async () => {
          try {
            return await this.updateEntryLine(
              entry,
              (line) => setLogInlineFieldValue(line, property.key, null),
            );
          } catch (error) {
            logger.flowError('TpsTableView', 'boolean-property-cell:clear-failed', error, {
              path: entry.file.path,
              lineNumber: entry.lineNumber + 1,
              property: property.key,
            });
            new Notice(`Could not clear ${property.label || property.key}.`);
            return false;
          }
        },
      );
      return;
    }
    if (!entityOptions && this.isTagColumn(column, property)) {
      const currentTags = readLogLinePropertyTags(
        entry.line,
        property.key,
        readInlineFieldCarrierValues(entry.line, property.key),
      );
      const display = currentTags.map((tag) => `#${tag}`).join(', ');
      this.configureTypedCell(
        cell,
        `${property.label || column.label}: ${display || 'empty'}`,
        display || `+ ${property.label || column.label}`,
        () => this.openTagCellEditor(entry, property.key),
      );
      return;
    }

    if (!entityOptions && this.isDatetimeColumn(column, property)) {
      const current = entry.fields[normalizePropertyKeyIdentity(property.key)]
        ?? entry.queryFields?.[normalizePropertyKeyIdentity(property.key)]
        ?? '';
      this.configureTypedCell(
        cell,
        `${property.label || column.label}: ${current || 'empty'}`,
        current || `+ ${property.label || column.label}`,
        () => this.openScheduledCellEditor(entry, property),
      );
      return;
    }

    const taskWorkflowStatus = this.isTaskStatusSelector(entry, property);
    const storedValues = this.getEntryConfiguredPropertyValues(entry, property);
    const current = taskWorkflowStatus
      ? entry.queryFields?.status ?? entry.queryFields?.checkboxstatus ?? ''
            : property.type === 'list'
                ? storedValues
              : propertyUsesEntityOptions(property)
                ? entry.fields[normalizePropertyKeyIdentity(property.key)] ?? ''
              : entry.fields[normalizePropertyKeyIdentity(property.key)]
          ?? entry.queryFields?.[normalizePropertyKeyIdentity(property.key)]
          ?? '';
    const display = this.formatConfiguredPropertyCellValue(current, property);
    this.configureTypedCell(
      cell,
      `${property.label || column.label}: ${display || 'empty'}`,
      display || `+ ${property.label || column.label}`,
      () => this.openConfiguredPropertyCellEditor(entry, column, property, cell),
    );
  }

  private renderTableBooleanCell(
    cell: HTMLElement,
    propertyLabel: string,
    rawValue: unknown,
    commit?: (next: boolean) => Promise<boolean>,
    clear?: () => Promise<boolean>,
  ): void {
    cell.empty();
    cell.dataset.tpsTableCellIntent = commit ? 'boolean-property' : 'formula';
    const control = cell.createEl('span', {
      cls: `tps-log-base-boolean-control${commit ? ' tps-log-base-boolean-control--editable' : ' tps-log-base-boolean-control--readonly'}`,
    });
    const checkbox = control.createEl('input', {
      cls: 'tps-log-base-boolean-checkbox',
      attr: {
        type: 'checkbox',
        ...(commit ? {} : { disabled: 'true', 'aria-readonly': 'true' }),
      },
    });
    const clearButton = commit && clear
      ? control.createEl('button', {
        cls: 'tps-log-base-boolean-clear',
        text: '×',
        attr: {
          type: 'button',
          title: `Clear ${propertyLabel}`,
          'aria-label': `Clear ${propertyLabel}`,
        },
      })
      : null;
    let currentValue = rawValue;
    const renderState = (value: unknown) => {
      const presentation = getBooleanPropertyPresentation(value);
      checkbox.checked = presentation.checked;
      checkbox.indeterminate = presentation.indeterminate;
      checkbox.setAttribute('aria-label', `${propertyLabel}: ${presentation.text}`);
      control.setAttribute('title', `${propertyLabel}: ${presentation.text}`);
      control.dataset.tpsBooleanState = presentation.state;
      if (presentation.state === 'invalid') checkbox.setAttribute('aria-invalid', 'true');
      else checkbox.removeAttribute('aria-invalid');
      if (clearButton) clearButton.disabled = presentation.state === 'unset';
    };
    renderState(currentValue);
    const stop = (event: Event) => event.stopPropagation();
    control.addEventListener('pointerdown', stop);
    control.addEventListener('click', stop);
    if (!commit) return;
    checkbox.addEventListener('change', (event) => {
      event.stopPropagation();
      if (checkbox.disabled) return;
      const previous = currentValue;
      const next = getNextBooleanPropertyValue(previous);
      currentValue = next;
      renderState(next);
      checkbox.disabled = true;
      if (clearButton) clearButton.disabled = true;
      void commit(next).then((changed) => {
        if (!changed) {
          currentValue = previous;
          renderState(previous);
        }
      }).finally(() => {
        checkbox.disabled = false;
        renderState(currentValue);
      });
    });
    clearButton?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (clearButton.disabled) return;
      const previous = currentValue;
      currentValue = undefined;
      renderState(currentValue);
      checkbox.disabled = true;
      clearButton.disabled = true;
      void clear().then((changed) => {
        if (!changed) {
          currentValue = previous;
          renderState(previous);
        }
      }).finally(() => {
        checkbox.disabled = false;
        renderState(currentValue);
      });
    });
  }

  private renderGenericInlinePropertyCell(
    cell: HTMLElement,
    entry: LogLineEntry,
    column: LogTableColumn,
  ): void {
    const propertyKey = this.getWritableInlineColumnKey(column.key);
    if (!propertyKey) {
      cell.setText(this.getEntryValue(entry, column.key));
      return;
    }
    const current = readInlineFieldValue(entry.line, propertyKey);
    const display = current || this.getEntryValue(entry, column.key);
    this.configureTypedCell(
      cell,
      `${column.label}: ${display || 'empty'}`,
      display || `+ ${column.label}`,
      () => {
        new TextInputModal(
          this.plugin.app,
          column.label || labelForKey(propertyKey),
          current,
          (value) => {
            const next = String(value || '').trim();
            void this.updateEntryLine(
              entry,
              (line) => setLogInlineFieldValue(line, propertyKey, next || null),
            ).then(() => {
              logger.flow('TpsTableView', 'generic-property-cell:set', {
                path: entry.file.path,
                lineNumber: entry.lineNumber + 1,
                property: propertyKey,
                cleared: !next,
              });
            });
          },
        ).open();
      },
    );
  }

  /**
   * Resolve a Base column to an ordinary inline field. Only synthesized,
   * computed, file, and structural task columns stay read-only/navigation
   * targets. Everything else remains editable even before it is added to the
   * custom-property registry.
   */
  private getWritableInlineColumnKey(rawColumnKey: string): string | null {
    const raw = String(rawColumnKey || '').trim();
    if (!raw || isSourceNoteGroupProperty(raw)) return null;
    if (/^(?:file|formula)\./iu.test(raw)) return null;
    if (/^task\.(?:status|checkboxstatus)$/iu.test(raw.replace(/[\s_-]+/gu, ''))) {
      return null;
    }
    const key = raw.replace(/^(?:note|task|line|log|tps|kanban)\./iu, '').trim();
    const normalized = normalizeTpsTableVirtualKey(raw);
    if (!normalized) return null;
    const readOnly = new Set([
      'title',
      'text',
      'linetext',
      'source',
      'path',
      'filepath',
      'filename',
      'basename',
      'filelink',
      'line',
      'linenumber',
      'kind',
      'itemkind',
      'itemtype',
      'headinglevel',
      'headingtext',
      'headingline',
      'headingpath',
      'open',
      'isopen',
      'done',
      'isdone',
      'completed',
      'complete',
      'checkboxstatus',
      'taskstatus',
      'tasktitle',
      'tasktext',
      'linetitle',
      'headingtitle',
      'tpsinlineprops',
    ]);
    return readOnly.has(normalized) ? null : key;
  }

  private formatConfiguredPropertyCellValue(value: string, property: CustomProperty): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (property.type === 'list') {
      const items = propertyUsesEntityOptions(property)
        ? isLinkListProperty(property)
          ? parseLinkListInput(raw)
          : parseMixedListInput(raw)
        : isLinkListProperty(property)
          ? parseLinkListInput(raw)
          : parseStringListInput(raw);
      return items
        .map((item) => /^\[\[/u.test(item)
          ? getWikilinkDisplayText(item)
          : item)
        .join(', ');
    }
    if (propertyUsesEntityOptions(property) && /^\[\[/u.test(raw)) {
      return getWikilinkDisplayText(raw);
    }
    if (property.type === 'checkbox') {
      return /^(?:true|yes|1|on)$/iu.test(raw) ? 'Yes' : 'No';
    }
    return raw;
  }

  private getEntryConfiguredPropertyValues(entry: LogLineEntry, property: CustomProperty): string {
    return this.getEntryConfiguredPropertyValueItems(entry, property).join(', ');
  }

  private getEntryConfiguredPropertyValueItems(entry: LogLineEntry, property: CustomProperty): string[] {
    const normalized = normalizePropertyKeyIdentity(property.key);
    const authored = entry.fieldValues?.[normalized] ?? [];
    const stored = authored.length > 0
      ? authored
      : [entry.fields[normalized] ?? entry.queryFields?.[normalized] ?? ''];
    const merged = stored.flatMap((value) => propertyUsesEntityOptions(property)
      ? isLinkListProperty(property) ? parseLinkListInput(value) : parseMixedListInput(value)
      : isLinkListProperty(property) ? parseLinkListInput(value) : parseStringListInput(value));
    return Array.from(new Set(merged.map((value) => value.trim()).filter(Boolean)));
  }

  private openConfiguredPropertyCellEditor(
    entry: LogLineEntry,
    column: LogTableColumn,
    property: CustomProperty,
    anchor: HTMLElement,
  ): void {
    if (property.type === 'folder') return;
    if (property.type === 'list') {
      this.openListCellEditor(entry, property, anchor);
      return;
    }
    if (propertyUsesEntityOptions(property)) {
      this.openConfiguredPropertyValuePicker(entry, property);
      return;
    }
    if (property.type === 'selector' && this.isTaskStatusSelector(entry, property)) {
      this.openSelectorCellEditor(entry, property, anchor);
      return;
    }
    if (
      property.type === 'selector'
      || property.type === 'kind'
    ) {
      this.openChoiceCellEditor(entry, property, anchor);
      return;
    }
    if (property.type === 'checkbox') {
      this.openCheckboxCellEditor(entry, property, anchor);
      return;
    }
    if (property.type === 'recurrence') {
      this.openRecurrenceCellEditor(entry, property);
      return;
    }

    const current = this.getEntryConfiguredPropertyValues(entry, property);
    new TextInputModal(
      this.plugin.app,
      property.label || column.label,
      current,
      (value) => {
        const next = String(value || '').trim();
        if (property.type === 'number' && next && !Number.isFinite(Number(next))) {
          new Notice('Enter a valid number.');
          return;
        }
        void this.setConfiguredCellValue(entry, property, next || null, 'text');
      },
    ).open();
  }

  private openConfiguredPropertyValuePicker(
    entry: LogLineEntry,
    property: CustomProperty,
  ): void {
    const currentValue = property.type === 'list'
      ? readInlineFieldCarrierValues(entry.line, property.key).join(', ')
      : readInlineFieldValue(entry.line, property.key);
    logger.flow('TpsTableView', 'property-picker:open', {
      path: entry.file.path,
      lineNumber: entry.lineNumber + 1,
      property: property.key,
      acceptedKind: property.acceptsKind || '',
      list: property.type === 'list',
    });
    openPropertyValueSuggestModal(
      this.plugin.app,
      this.plugin,
      property,
      currentValue,
      async (choice) => {
        if (choice.kind === 'custom') return;
        await this.updateEntryLine(
          entry,
          (line) => applyLogBasePropertyValueChoice(line, property, choice),
        );
        logger.flow('TpsTableView', 'property-picker:apply', {
          path: entry.file.path,
          lineNumber: entry.lineNumber + 1,
          property: property.key,
          source: choice.kind,
          cleared: choice.kind === 'clear',
          list: property.type === 'list',
        });
      },
    );
  }

  private openChoiceCellEditor(
    entry: LogLineEntry,
    property: CustomProperty,
    anchor: HTMLElement,
  ): void {
    const current = readInlineFieldCarrierValues(entry.line, property.key).join(', ');
    const menu = new Menu();
    addPropertyValueChoiceMenuItems({
      app: this.plugin.app,
      source: this.plugin,
      menu,
      property,
      currentValue: current,
      onClear: () => this.setConfiguredCellValue(entry, property, null, 'clear'),
      onChooseLiteral: (value) => this.setConfiguredCellValue(entry, property, value, 'literal'),
      onChooseEntity: (choice) => this.setConfiguredCellValue(
        entry,
        property,
        choice.wikilink,
        'entity',
      ),
    });
    showPropertyValueChoiceMenuAtElement(menu, anchor);
  }

  private openCheckboxCellEditor(
    entry: LogLineEntry,
    property: CustomProperty,
    anchor: HTMLElement,
  ): void {
    const current = readInlineFieldValue(entry.line, property.key).trim().toLowerCase();
    const menu = new Menu();
    const choices: Array<[string, string | null]> = [
      ['(none)', null],
      ['Yes', 'true'],
      ['No', 'false'],
    ];
    for (const [label, value] of choices) {
      menu.addItem((item) => {
        item
          .setTitle(label)
          .setChecked(value === null ? !current : current === value)
          .onClick(() => {
            void this.setConfiguredCellValue(entry, property, value, 'checkbox');
          });
      });
    }
    showPropertyValueChoiceMenuAtElement(menu, anchor);
  }

  private openListCellEditor(
    entry: LogLineEntry,
    property: CustomProperty,
    anchor: HTMLElement,
  ): void {
    const current = readInlineFieldCarrierValues(entry.line, property.key).join(', ');
    const items = propertyUsesEntityOptions(property)
      ? isLinkListProperty(property)
        ? parseLinkListInput(current)
        : parseMixedListInput(current)
      : isLinkListProperty(property)
        ? parseLinkListInput(current)
        : parseStringListInput(current);
    const menu = new Menu();
    addPropertyValueChoiceMenuItems({
      app: this.plugin.app,
      source: this.plugin,
      menu,
      property,
      currentValue: current,
      onClear: () => this.setConfiguredCellValue(entry, property, null, 'list-clear'),
      onChooseLiteral: (value) => this.addConfiguredListCellValue(entry, property, value, 'literal'),
      onChooseEntity: (choice) => this.addConfiguredListCellValue(
        entry,
        property,
        choice.wikilink,
        'entity',
      ),
    });
    if (isLinkListProperty(property) && propertyUsesManualOptions(property)) {
      menu.addItem((item) => {
        item
          .setTitle('Choose note…')
          .setIcon('file-search')
          .onClick(() => {
            new FileSuggestModal(this.plugin.app, (file) => {
              const title = String(
                this.plugin.app.metadataCache.getFileCache(file)?.frontmatter?.title || file.basename,
              ).trim();
              void this.addConfiguredListCellValue(
                entry,
                property,
                formatFileWikilink(file.path, title),
                'file',
              );
            }).open();
          });
      });
    }
    if (items.length > 0) {
      menu.addSeparator();
      for (const itemValue of items) {
        menu.addItem((item) => {
          item
            .setTitle(`Remove ${isLinkListProperty(property)
              ? getWikilinkDisplayText(itemValue)
              : itemValue}`)
            .setIcon('x')
            .onClick(() => {
              void this.removeConfiguredListCellValue(entry, property, itemValue);
            });
        });
      }
    }
    showPropertyValueChoiceMenuAtElement(menu, anchor);
  }

  private async addConfiguredListCellValue(
    entry: LogLineEntry,
    property: CustomProperty,
    value: string,
    route: 'literal' | 'entity' | 'file',
  ): Promise<void> {
    await this.updateEntryLine(
      entry,
      (line) => addLogBaseListPropertyValue(line, property, value, route),
    );
    logger.flow('TpsTableView', 'list-cell:add', {
      path: entry.file.path,
      lineNumber: entry.lineNumber + 1,
      property: property.key,
      route,
    });
  }

  private async removeConfiguredListCellValue(
    entry: LogLineEntry,
    property: CustomProperty,
    value: string,
  ): Promise<void> {
    await this.updateEntryLine(
      entry,
      (line) => removeLogBaseListPropertyValue(line, property, value),
    );
    logger.flow('TpsTableView', 'list-cell:remove', {
      path: entry.file.path,
      lineNumber: entry.lineNumber + 1,
      property: property.key,
    });
  }

  private async setConfiguredCellValue(
    entry: LogLineEntry,
    property: CustomProperty,
    value: string | null,
    route: string,
  ): Promise<void> {
    await this.updateEntryLine(
      entry,
      (line) => setLogInlineFieldValue(line, property.key, value),
    );
    logger.flow('TpsTableView', 'property-cell:set', {
      path: entry.file.path,
      lineNumber: entry.lineNumber + 1,
      property: property.key,
      cleared: value == null,
      route,
    });
  }

  private configureTypedCell(
    cell: HTMLElement,
    ariaLabel: string,
    text: string,
    activate: () => void,
  ): void {
    cell.dataset.tpsTableCellIntent = 'property';
    cell.addClass('tps-log-base-cell--editable');
    cell.setAttr('role', 'button');
    cell.setAttr('tabindex', '0');
    cell.setAttr('aria-label', ariaLabel);
    cell.setText(text);
    cell.toggleClass('is-empty', /^\+\s/u.test(text));
    cell.addEventListener('pointerdown', (event: PointerEvent) => event.stopPropagation());
    cell.addEventListener('click', (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      activate();
    });
    cell.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      activate();
    });
  }

  private isTagColumn(column: LogTableColumn, property: CustomProperty | null): boolean {
    return isTagListProperty(property)
      || /^(?:tag|tags)$/u.test(normalizeInlineKey(property?.key || column.key));
  }

  private isDatetimeColumn(column: LogTableColumn, property: CustomProperty | null): boolean {
    return property?.type === 'datetime'
      || property?.type === 'snooze'
      || normalizeInlineKey(property?.key || column.key) === 'scheduled';
  }

  private createDatetimeColumnProperty(column: LogTableColumn): CustomProperty {
    const key = String(column.key || 'scheduled').replace(/^note\./u, '').trim() || 'scheduled';
    return {
      id: key,
      key,
      label: column.label || labelForKey(key),
      type: 'datetime',
    };
  }

  private isExplicitTaskWorkflowStatusColumn(reference: unknown): boolean {
    const normalized = String(reference || '')
      .trim()
      .toLowerCase();
    return normalized === 'task.status'
      || normalized === 'task.checkboxstatus'
      || normalized === 'checkboxstatus';
  }

  private createTaskWorkflowStatusProperty(column: LogTableColumn): CustomProperty {
    return {
      id: 'task.status',
      key: 'task.status',
      label: column.label || 'Task status',
      type: 'selector',
      options: this.plugin.sharedServices?.status?.getStatusOptions?.() || [],
      optionSources: ['manual'],
    };
  }

  private openTagCellEditor(entry: LogLineEntry, key = 'tags'): void {
    const semanticTaskTags = /^(?:tag|tags)$/iu.test(normalizeInlineKey(key));
    const current = readLogLinePropertyTags(
      entry.line,
      key,
      readInlineFieldCarrierValues(entry.line, key),
    );
    const available = [...collectKnownVaultTags(this.plugin.app), ...current];
    new TagSuggestModal(this.plugin.app, available, async (tag, selected) => {
      await this.updateEntryLine(entry, (line) => (
        semanticTaskTags
          ? toggleLogLineSemanticTag(line, key, tag, selected)
          : setLogInlineFieldValue(
              line,
              key,
              selected
                ? removeLogLineTag(readInlineFieldCarrierValues(line, key), tag)
                : addLogLineTag(readInlineFieldCarrierValues(line, key), tag),
            )
      ));
      logger.flow('TpsTableView', 'tag-cell:toggle', {
        path: entry.file.path,
        lineNumber: entry.lineNumber + 1,
        key,
        tag,
        action: selected ? 'remove' : 'add',
      });
    }, {
      title: 'Choose tag',
      selectedTags: current,
    }).open();
  }

  private openScheduledCellEditor(entry: LogLineEntry, property: CustomProperty): void {
    const isScheduled = normalizePropertyKeyIdentity(property.key) === 'scheduled';
    const current = readInlineFieldValue(entry.line, property.key);
    const timeEstimate = Number.parseInt(readInlineFieldValue(entry.line, 'timeEstimate') || '0', 10) || 0;
    const allDay = /^true$/iu.test(readInlineFieldValue(entry.line, 'allDay'));
    new ScheduledModal(this.plugin.app, current, timeEstimate, allDay, async (result) => {
      await this.updateEntryLine(entry, (line) => {
        let next = setLogInlineFieldValue(line, property.key, result.date || null);
        if (isScheduled) {
          next = setLogInlineFieldValue(
            next,
            'timeEstimate',
            result.date ? String(result.timeEstimate || 0) : null,
          );
          next = setLogInlineFieldValue(
            next,
            'allDay',
            result.date && result.allDay ? 'true' : null,
          );
        }
        return next;
      });
      logger.flow('TpsTableView', 'datetime-cell:set', {
        path: entry.file.path,
        lineNumber: entry.lineNumber + 1,
        property: property.key,
        cleared: !result.date,
        allDay: result.allDay,
        timeEstimate: result.timeEstimate,
      });
    }, isScheduled ? {} : {
      title: `Set ${property.label || property.key}`,
      fieldLabel: property.label || property.key,
      showTimeDetails: false,
    }).open();
  }

  private openRecurrenceCellEditor(entry: LogLineEntry, property: CustomProperty): void {
    const current = readInlineFieldValue(entry.line, property.key);
    const scheduled = readInlineFieldValue(entry.line, 'scheduled');
    const startDate = scheduled ? new Date(scheduled.replace(' ', 'T')) : new Date();
    new RecurrenceModal(
      this.plugin.app,
      current,
      Number.isNaN(startDate.getTime()) ? new Date() : startDate,
      '',
      async (rule) => {
        await this.setConfiguredCellValue(entry, property, rule || null, 'recurrence');
      },
      { showEndsOn: false },
    ).open();
  }

  private openSelectorCellEditor(
    entry: LogLineEntry,
    property: CustomProperty,
    anchor: HTMLElement,
  ): void {
    const taskStatus = this.isTaskStatusSelector(entry, property);
    if (taskStatus) {
      const context = this.createTaskLineContext(entry);
      if (!context) {
        new Notice('Could not resolve the task status.');
        return;
      }
      this.plugin.taskLineContextMenuService.openTaskStatusPicker(
        context,
        anchor,
        () => this.queueRender(),
      );
      return;
    }
    const current = readInlineFieldValue(entry.line, property.key);
    const options = getEffectivePropertyOptions(this.plugin.app, property);
    const menu = new Menu();

    if (!taskStatus) {
      menu.addItem((item) => {
        item
          .setTitle('(none)')
          .setChecked(!current)
          .onClick(() => {
            void this.setSelectorCellValue(entry, property, null, 'clear');
          });
      });
    }
    menu.addItem((item) => {
      item
        .setTitle('Set custom value...')
        .setIcon('pencil')
        .onClick(() => {
          new TextInputModal(
            this.plugin.app,
            property.label || property.key,
            current,
            (value) => {
              const next = String(value || '').trim();
              if (!next) {
                new Notice('Value cannot be empty.');
                return;
              }
              void this.setSelectorCellValue(entry, property, next, 'custom');
            },
          ).open();
        });
    });
    if (options.length > 0) menu.addSeparator();
    for (const option of options) {
      menu.addItem((item) => {
        item
          .setTitle(option)
          .setChecked(current === option)
          .onClick(() => {
            void this.setSelectorCellValue(entry, property, option, 'option');
          });
      });
    }

    const positionedMenu = menu as Menu & { showAtElement?: (element: HTMLElement) => void };
    if (typeof positionedMenu.showAtElement === 'function') {
      positionedMenu.showAtElement(anchor);
    } else {
      const rect = anchor.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom });
    }
  }

  private async setSelectorCellValue(
    entry: LogLineEntry,
    property: CustomProperty,
    value: string | null,
    route: 'clear' | 'custom' | 'option',
  ): Promise<void> {
    await this.updateEntryLine(
      entry,
      (line) => setLogInlineFieldValue(line, property.key, value),
    );
    logger.flow('TpsTableView', 'selector-cell:set', {
      path: entry.file.path,
      lineNumber: entry.lineNumber + 1,
      property: property.key,
      cleared: value == null,
      route,
    });
  }

  private isTaskStatusSelector(entry: LogLineEntry, property: CustomProperty): boolean {
    if (propertyUsesEntityOptions(property)) return false;
    const normalizedKey = normalizePropertyKeyIdentity(property.key);
    const normalizedId = normalizeInlineKey(property.id);
    const configuredStatusKey = normalizeInlineKey(
      this.plugin.sharedServices?.status?.getStatusPropertyKey?.() || 'status',
    );
    return (
      this.isExplicitTaskWorkflowStatusColumn(property.key)
      || this.isExplicitTaskWorkflowStatusColumn(property.id)
      || normalizedId === 'status'
      || normalizedKey === 'status'
      || normalizedKey === 'checkboxstatus'
      || normalizedKey === configuredStatusKey
    ) && /^\s*(?:[-*+]|\d+[.)])\s+\[[^\]\r\n]?\]\s+/u.test(entry.line);
  }

  private createTaskLineContext(entry: LogLineEntry): TaskLineContext | null {
    const parsed = parseTaskLine(entry.line);
    if (!parsed) return null;
    return {
      file: entry.file,
      lineNumber: entry.lineNumber + 1,
      lineIndex: entry.lineNumber,
      rawLine: entry.line,
      title: getTaskDisplayTitle(entry.line),
      checkboxToken: parsed.token,
      isCalendarTask: false,
      calendarAllDay: false,
    };
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
    if (Date.now() < this.suppressEntryClickUntil) {
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }
    if (evt.defaultPrevented) return;
    const target = evt.target instanceof HTMLElement ? evt.target : null;
    if (target?.closest('[data-tps-table-cell-intent="property"]')) {
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }
    const selectionKind = getTpsTableSelectionKind(entry);
    if (evt.shiftKey && selectionKind) {
      evt.preventDefault();
      evt.stopPropagation();
      this.selectEntryRange(entry.selectionId, selectionKind);
      return;
    }
    if ((evt.metaKey || evt.ctrlKey) && selectionKind) {
      evt.preventDefault();
      evt.stopPropagation();
      this.toggleEntrySelection(entry.selectionId, selectionKind);
      return;
    }
    this.selectOnlyEntry(entry.selectionId);
    if (selectionKind !== 'task') this.plugin.taskLineContextMenuService?.releaseTpsTableSelection?.(this.containerEl);
    void this.openEntry(entry);
  }

  private beginExternalTaskPointerDrag(event: PointerEvent, row: HTMLElement): void {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('button, input, a, [role="button"], [data-tps-table-cell-intent="property"]')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let preview: PointerDragPreview | null = null;
    let previewItemCount: number | null = null;
    const ownerDocument = row.ownerDocument;
    const cleanup = () => {
      ownerDocument.removeEventListener('pointermove', onMove, true);
      ownerDocument.removeEventListener('pointerup', onUp, true);
      ownerDocument.removeEventListener('pointercancel', onCancel, true);
      row.removeClass('tps-log-base-row--dragging');
      removePointerDragPreview(preview);
      preview = null;
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      if (!moved && Math.max(Math.abs(moveEvent.clientX - startX), Math.abs(moveEvent.clientY - startY)) >= 8) {
        moved = true;
        row.addClass('tps-log-base-row--dragging');
      }
      if (moved) {
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        const entryId = row.dataset.entryId;
        if (previewItemCount == null) {
          previewItemCount = entryId && this.selectedEntryIds.has(entryId)
            ? Math.max(1, this.containerEl.querySelectorAll(
                '.tps-log-base-row--selected[data-tps-table-batch-kind="task"]',
              ).length)
            : 1;
        }
        if (!preview) {
          preview = createPointerDragPreview(
            ownerDocument,
            row.dataset.taskText || 'Task item',
            previewItemCount,
            moveEvent.clientX,
            moveEvent.clientY,
          );
        } else {
          movePointerDragPreview(preview, moveEvent.clientX, moveEvent.clientY);
        }
      }
    };
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      cleanup();
      if (!moved) return;
      upEvent.preventDefault();
      upEvent.stopPropagation();
      this.suppressEntryClickUntil = Date.now() + 400;
      const rowRef = (row as HTMLElement & { __tpsGcmItemPropertyRef?: { path: string; lineNumber: number; rawLine: string } })
        .__tpsGcmItemPropertyRef;
      if (!rowRef) return;
      const entryId = row.dataset.entryId;
      const selectedRefs = Array.from(this.containerEl.querySelectorAll<HTMLElement>(
        '.tps-log-base-row--selected[data-tps-table-batch-kind="task"]',
      )).map((selectedRow) => (
        selectedRow as HTMLElement & { __tpsGcmItemPropertyRef?: typeof rowRef }
      ).__tpsGcmItemPropertyRef).filter((ref): ref is typeof rowRef => !!ref);
      const items = entryId && this.selectedEntryIds.has(entryId) && selectedRefs.length > 0 ? selectedRefs : [rowRef];
      ownerDocument.dispatchEvent(new CustomEvent('tps-task-line-pointer-drop', {
        bubbles: true,
        cancelable: true,
        detail: {
          items,
          x: upEvent.clientX,
          y: upEvent.clientY,
        },
      }));
    };
    const onCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === event.pointerId) cleanup();
    };
    ownerDocument.addEventListener('pointermove', onMove, true);
    ownerDocument.addEventListener('pointerup', onUp, true);
    ownerDocument.addEventListener('pointercancel', onCancel, true);
  }

  private handleEntryModifierClick(evt: MouseEvent, entry: LogLineEntry): void {
    if (!evt.shiftKey && !evt.metaKey && !evt.ctrlKey) return;
    const selectionKind = getTpsTableSelectionKind(entry);
    if (!selectionKind) return;
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    if (evt.shiftKey) this.selectEntryRange(entry.selectionId, selectionKind);
    else this.toggleEntrySelection(entry.selectionId, selectionKind);
  }

  private selectOnlyEntry(id: string): void {
    this.selectedEntryIds.clear();
    this.selectedEntryIds.add(id);
    this.selectionAnchorId = id;
    this.syncEntrySelectionClasses();
  }

  private getSelectionOrder(kind: TpsTableSelectionKind): string[] {
    return kind === 'note' ? this.renderedNoteEntryOrder : this.renderedTaskEntryOrder;
  }

  private toggleEntrySelection(id: string, kind: TpsTableSelectionKind = 'task'): void {
    const order = this.getSelectionOrder(kind);
    const domainSelection = constrainTpsTableSelection(this.selectedEntryIds, order);
    const result = toggleOrderedSelection(domainSelection, id, order);
    this.selectedEntryIds = result.selected;
    this.selectionAnchorId = result.anchor;
    this.syncEntrySelectionClasses();
    logger.flow('TpsTableView', 'selection:changed', {
      mode: result.removed ? 'toggle-off' : 'toggle-on',
      selectedCount: this.selectedEntryIds.size,
    });
  }

  private selectEntryRange(id: string, kind: TpsTableSelectionKind = 'task'): void {
    const order = this.getSelectionOrder(kind);
    if (!this.selectionAnchorId || !order.includes(this.selectionAnchorId)) {
      this.selectOnlyEntry(id);
      logger.flow('TpsTableView', 'selection:changed', { mode: 'range-fallback', selectedCount: 1 });
      return;
    }
    const range = getOrderedSelectionRange(order, this.selectionAnchorId, id);
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

  private reconcileRenderedTaskSelection(): void {
    const selectedRows = Array.from(this.containerEl.querySelectorAll<HTMLElement>(
      '.tps-log-base-row--selected[data-entry-id][data-tps-table-batch-kind="task"]',
    ));
    const anchorRow = this.selectionAnchorId
      ? selectedRows.find((candidate) => candidate.dataset.entryId === this.selectionAnchorId) ?? null
      : null;
    const reconciliation = this.plugin.taskLineContextMenuService?.reconcileTpsTableSelectionRows?.(
      selectedRows,
      anchorRow,
      this.containerEl,
    );
    if (!reconciliation) return;
    void reconciliation.catch((error) => {
      logger.flowError('TpsTableView', 'selection:reconcile-failed', error, {
        selectedCount: selectedRows.length,
      });
    });
  }

  applyEntryContextSelection(evt: MouseEvent, row: HTMLElement): boolean {
    const entryId = row.dataset.entryId;
    if (!entryId) return false;
    const selectionKind = row.dataset.tpsTableBatchKind === 'note'
      ? 'note'
      : row.dataset.tpsTableBatchKind === 'task'
        ? 'task'
        : null;
    if (row.dataset.tpsTableBatchSelectable !== 'true' || !selectionKind) {
      this.selectOnlyEntry(entryId);
      this.plugin.taskLineContextMenuService?.releaseTpsTableSelection?.(this.containerEl);
      return true;
    }
    if (evt.shiftKey) {
      this.selectEntryRange(entryId, selectionKind);
    } else if (evt.metaKey || evt.ctrlKey) {
      this.toggleEntrySelection(entryId, selectionKind);
    } else if (!this.selectedEntryIds.has(entryId)) {
      this.selectOnlyEntry(entryId);
    }
    return true;
  }

  async applyTpsTableRowSelection(
    evt: MouseEvent,
    target: HTMLElement,
    preserveIfSelected = false,
  ): Promise<void> {
    const row = target.closest<HTMLElement>('.tps-log-base-row[data-entry-id]');
    if (!row || !this.containerEl.contains(row)) return;
    if (row.dataset.tpsTableBatchKind !== 'task') return;
    const entryId = row.dataset.entryId;
    if (!entryId) return;
    if (!(preserveIfSelected && this.selectedEntryIds.has(entryId) && !evt.shiftKey && !evt.metaKey && !evt.ctrlKey)) {
      this.applyEntryContextSelection(evt, row);
    }
    const selectedRows = Array.from(this.containerEl.querySelectorAll<HTMLElement>(
      '.tps-log-base-row--selected[data-entry-id][data-tps-table-batch-kind="task"]',
    ));
    const anchorRow = this.selectionAnchorId
      ? selectedRows.find((candidate) => candidate.dataset.entryId === this.selectionAnchorId) ?? null
      : null;
    await this.plugin.taskLineContextMenuService?.syncTpsTableSelectionRows?.(
      selectedRows,
      anchorRow,
      this.containerEl,
    );
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
    const renderedRevision = (row as any).__tpsTableEntryRevision as RenderedLogLineRevision | undefined;
    const path = String(renderedRevision?.path || row.dataset.path || '').trim();
    if (!path) return false;

    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();

    if (
      !renderedRevision
      || renderedRevision.path !== path
      || !Number.isInteger(renderedRevision.lineNumber)
      || renderedRevision.lineNumber < 0
      || typeof renderedRevision.rawLine !== 'string'
    ) {
      logger.flowWarn('TpsTableView', 'context-menu:missing-rendered-revision', { path });
      new Notice('That table row is out of date. Refresh the view and try again.');
      return true;
    }

    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Could not find source file: ${path}`);
      return true;
    }

    const columns = Array.from(row.querySelectorAll<HTMLElement>('.tps-log-base-cell[data-key]')).map((cell) => ({
      key: cell.dataset.key || '',
      label: cell.dataset.label || labelForKey(cell.dataset.key || ''),
    })).filter((column) => column.key);

    void this.plugin.app.vault.cachedRead(file).then((content) => {
      const parts = splitLineItemContent(content);
      const lineNumber = resolveExactLineRevisionIndex(
        parts.lines,
        renderedRevision.lineNumber,
        renderedRevision.rawLine,
      );
      if (lineNumber < 0) {
        logger.flowWarn('TpsTableView', 'context-menu:stale-target', {
          path: file.path,
          renderedLineNumber: renderedRevision.lineNumber + 1,
        });
        new Notice('That table row changed since it was rendered. Refresh the view and try again.');
        return;
      }
      const line = parts.lines[lineNumber] ?? '';
      const fields = readInlineFields(line);
      const fieldValues = readInlineFieldValues(line);
      this.openEntryContextMenu(evt, {
        id: `${file.path}:${lineNumber}`,
        selectionId: getLogEntrySelectionId(file.path, lineNumber, line, fields),
        file,
        lineNumber,
        line,
        title: getTpsTableLineDisplayTitle(line),
        fields,
        fieldValues,
      }, row, columns);
    }).catch((error) => {
      logger.flowError('TpsTableView', 'context-menu:source-read-failed', error, {
        path: file.path,
        lineNumber: renderedRevision.lineNumber + 1,
      });
      new Notice(`Could not read source file: ${path}`);
    });
    return true;
  }

  private getEntryValue(entry: LogLineEntry, key: string): string {
    if (/^formula\./iu.test(String(key || '').trim())) {
      const result = this.getEntryFormulaResult(entry, key);
      if (result.status === 'error' || result.status === 'unsupported') {
        this.reportFormulaFailure(entry, result);
        return '⚠ Formula';
      }
      return formatTpsFormulaValue(result.value);
    }
    const configuredProperty = resolveConfiguredProperty(this.plugin.settings?.properties || [], key);
    if (configuredProperty?.type === 'folder') return entry.file.parent?.path || '/';
    if (configuredProperty?.type === 'list') {
      return this.displayInlineValue(
        this.getEntryConfiguredPropertyValues(entry, configuredProperty),
        entry.file.path,
      );
    }
    const sourceNoteValue = getSourceNoteGroupValue(entry.file, key);
    if (sourceNoteValue !== undefined) return sourceNoteValue ?? '';
    const normalized = normalizeTpsTableVirtualKey(key);
    const rowKind = this.getEntryStructuralKind(entry);
    if (normalized === 'kind' && !configuredProperty) {
      return getTpsBaseAdditiveKindValues(rowKind, entry.fieldValues?.kind ?? entry.fields.kind).join(', ');
    }
    if (normalized === 'itemkind' || normalized === 'itemtype') return rowKind;
    if (normalized === 'explicitkind' || normalized === 'entitykind') {
      return getTpsBaseAdditiveKindValues(null, entry.fieldValues?.kind ?? entry.fields.kind).join(', ');
    }
    if (TPS_TABLE_TITLE_ALIASES.has(normalized)) return entry.title;
    if (this.isFileLinkColumn(key)) return entry.file.basename;
    if (normalized === 'source' || normalized === 'path') return `${entry.file.path}:${entry.lineNumber + 1}`;
    if (normalized === 'linenumber') return String(entry.lineNumber + 1);
    if (
      parseTaskLine(entry.line)
      && (normalized === 'status' || normalized === 'taskstatus' || normalized === 'taskcheckboxstatus' || normalized === 'checkboxstatus')
    ) {
      return this.displayInlineValue(
        entry.queryFields?.['task.status']
          ?? entry.queryFields?.taskstatus
          ?? entry.queryFields?.checkboxstatus
          ?? entry.queryFields?.status
          ?? '',
        entry.file.path,
      );
    }
    return this.displayInlineValue(entry.fields[normalized] ?? entry.queryFields?.[normalized] ?? '', entry.file.path);
  }

  private getEntryRawValue(entry: LogLineEntry, key: string): unknown {
    if (/^formula\./iu.test(String(key || '').trim())) {
      const result = this.getEntryFormulaResult(entry, key);
      if (result.status === 'error' || result.status === 'unsupported') {
        this.reportFormulaFailure(entry, result);
        return null;
      }
      return result.value;
    }
    return this.getEntryValue(entry, key);
  }

  private getEntryFormulaResult(entry: LogLineEntry, key: string): TpsFormulaResult {
    if (!entry.formulaSession) {
      const heading = parseTpsListHeadingLine(entry.line);
      const rowKind = heading ? `h${heading.headingLevel}` : getTpsTableMarkdownLineKind(entry.line);
      entry.formulaSession = this.createFilterContext(
        entry.queryFields ?? entry.fields,
        entry.file,
        entry.line,
        rowKind,
        entry.lineNumber + 1,
      ).formulaSession;
    }
    return entry.formulaSession?.get(key) ?? {
      status: 'error',
      value: null,
      formula: String(key || '').replace(/^formula\./iu, ''),
      code: 'formula-session-unavailable',
      message: 'TPS formula context is unavailable for this row',
    };
  }

  private reportFormulaFailure(entry: LogLineEntry, result: TpsFormulaResult): void {
    this.reportFormulaFailureAt(entry.file, entry.lineNumber + 1, result);
  }

  private reportFormulaFailureAt(file: TFile, oneBasedLineNumber: number, result: TpsFormulaResult): void {
    const key = `${this.compiledFormulaSet.revision}:${result.formula}:${result.code || result.status}`;
    this.formulaDiagnostics ??= new Set<string>();
    if (this.formulaDiagnostics.has(key)) return;
    this.formulaDiagnostics.add(key);
    logger.flowWarn('TpsTableView', 'formula:evaluation-failed', {
      base: this.getBaseFile()?.path || null,
      viewName: this.getViewName(),
      formula: result.formula,
      code: result.code || result.status,
      message: result.message || '',
      samplePath: file.path,
      sampleLine: oneBasedLineNumber,
    });
  }

  private reportFilterFailureAt(file: TFile, oneBasedLineNumber: number, failure: LogBaseFilterFailure): void {
    const key = [failure.code, failure.expression, failure.property, failure.operator].map((value) => String(value || '')).join(':');
    this.filterDiagnostics ??= new Map<string, LogBaseFilterFailure>();
    if (this.filterDiagnostics.has(key)) return;
    this.filterDiagnostics.set(key, failure);
    logger.flowWarn('TpsTableView', 'filters:evaluation-failed-closed', {
      base: this.getBaseFile()?.path || null,
      viewName: this.getViewName(),
      code: failure.code,
      message: failure.message,
      expression: failure.expression || '',
      property: failure.property || '',
      operator: failure.operator || '',
      samplePath: file.path,
      sampleLine: oneBasedLineNumber,
    });
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
    return this.resolvedBaseViewName || this.getConfiguredBaseViewName() || 'TPS Table';
  }

  private resolvePersistedFilterRoots(
    parsed: Record<string, unknown> | null | undefined,
  ): ReturnType<typeof extractPersistedFilterRoots> {
    const acceptedTypes = new Set([TPS_TABLE_VIEW_TYPE]);
    const known = extractPersistedFilterRoots(parsed, '', acceptedTypes).viewNames;
    const requestedViewName = this.resolveCurrentBaseViewName(new Set(known));
    const persisted = extractPersistedFilterRoots(parsed, requestedViewName, acceptedTypes);
    this.resolvedBaseViewName = persisted.viewName;
    return persisted;
  }

  private runtimeBaseFiltersMatchResolvedView(): boolean {
    if (!this.resolvedBaseViewName) return true;
    return this.getConfiguredBaseViewName() === this.resolvedBaseViewName;
  }

  private resolveCurrentBaseViewName(knownViewNames: ReadonlySet<string>): string {
    const configured = this.getConfiguredBaseViewName(knownViewNames);
    if (configured) return configured;
    return this.getVisibleBaseViewName(knownViewNames);
  }

  private getConfiguredBaseViewName(knownViewNames?: ReadonlySet<string>): string {
    const candidates = [
      (this.config as any)?.name,
      this.config?.get?.('name'),
      (this as any)?.view?.name,
      (this as any)?.controller?.viewConfig?.name,
      (this as any)?.controller?.config?.name,
      (this as any)?.queryController?.query?.name,
      (this as any)?.queryController?.view?.name,
    ];
    for (const candidate of candidates) {
      const value = String(candidate || '').trim();
      if (value && (!knownViewNames || knownViewNames.has(value))) return value;
    }
    return '';
  }

  private getRuntimeBaseFilterRoots(): unknown[] {
    return extractFilterRootCandidates([
      this.config?.get?.('filters'),
      (this.config as any)?.filters,
      (this as any)?.view?.filters,
      (this as any)?.controller?.viewConfig?.filters,
      (this as any)?.controller?.config?.filters,
      (this as any)?.queryController?.query?.filters,
    ]);
  }

  private getVisibleBaseViewName(knownViewNames: ReadonlySet<string>): string {
    if (!knownViewNames.size) return '';
    const header = this.getNearestBasesHeader();
    if (!header) return '';
    const selectors = [
      '.bases-toolbar-views-menu .text-button-label',
      '.bases-toolbar-views-menu [aria-label]',
      '.bases-toolbar-views-menu',
    ];
    for (const selector of selectors) {
      const elements = header.matches(selector)
        ? [header]
        : Array.from(header.querySelectorAll<HTMLElement>(selector));
      for (const element of elements) {
        if (element.hidden || element.getAttribute('aria-hidden') === 'true') continue;
        const text = String(element.textContent || element.getAttribute('aria-label') || '').trim();
        if (knownViewNames.has(text)) return text;
      }
    }
    return '';
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
    addLineEntityPropertyMenus({
      app: this.plugin.app,
      plugin: this.plugin,
      menu,
      file: entry.file,
      rawLine: entry.line,
      mutateLine: (updater) => this.updateEntryLine(entry, updater),
      excludePropertyKeys: [
        'tag',
        'tags',
        ...Object.keys(this.compiledFormulaSet.definitions).map((name) => `formula.${name}`),
      ],
    });

    const editableColumns = columns
      .map((column) => ({ ...column, normalized: normalizeInlineKey(column.key) }))
      .filter((column) => column.normalized
        && !/^formula\./iu.test(String(column.key || '').trim())
        && column.normalized !== 'line'
        && column.normalized !== 'title'
        && column.normalized !== 'source'
        && column.normalized !== 'path'
        && column.normalized !== 'linenumber'
        && column.normalized !== 'tags'
        && !resolveConfiguredProperty(this.plugin.settings.properties || [], column.key)
        && (entry.fields[column.normalized] != null || entry.queryFields?.[column.normalized] == null));

    for (const column of editableColumns) {
      const current = entry.fields[column.normalized] ?? '';
      menu.addItem((item) => {
        item
          .setTitle(current ? `${column.label}: ${current}` : `${column.label} (create field)`)
          .setIcon(this.isDatetimeColumn(column, null) ? 'calendar' : 'pencil')
          .onClick(() => {
            if (this.isDatetimeColumn(column, null)) {
              this.openScheduledCellEditor(
                entry,
                this.createDatetimeColumnProperty(column),
              );
              return;
            }
            this.promptEntryField(entry, column.key, column.label, current);
          });
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

  private getSelectedNoteFiles(fallbackFile: TFile): TFile[] {
    const files = new Map<string, TFile>();
    this.containerEl.querySelectorAll<HTMLElement>(
      '.tps-log-base-row--selected[data-entry-id][data-tps-table-batch-kind="note"][data-path]',
    ).forEach((row) => {
      const path = String(row.dataset.path || '').trim();
      const current = path ? this.plugin.app.vault.getFileByPath(path) : null;
      if (current instanceof TFile) files.set(current.path, current);
    });
    if (files.size === 0) {
      const current = this.plugin.app.vault.getFileByPath(fallbackFile.path);
      if (current instanceof TFile) files.set(current.path, current);
    }
    return [...files.values()];
  }

  private openNoteEntryContextMenu(evt: MouseEvent, entry: LogLineEntry, row: HTMLElement): void {
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    this.applyEntryContextSelection(evt, row);
    this.plugin.taskLineContextMenuService?.releaseTpsTableSelection?.(this.containerEl);

    const targets = this.getSelectedNoteFiles(entry.file);
    const menu = new Menu();
    this.plugin.menuController?.addToExactFileMenu?.(menu, targets, {
      includeTags: true,
      includeSingleTargetActions: targets.length === 1,
    });
    if (targets.length > 1) {
      this.plugin.app.workspace.trigger('files-menu', menu as any, targets as any);
    } else if (targets[0]) {
      this.plugin.app.workspace.trigger('file-menu', menu as any, targets[0] as any);
    }
    logger.flow('TpsTableView', 'note-context-menu', { selectedCount: targets.length });
    menu.showAtMouseEvent(evt);
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
    const current = readTaskLineTags(entry.line);
    menu.addItem((item) => {
      item
        .setTitle(current.length > 0 ? `Tags (${current.length})` : 'Tags')
        .setIcon('tag');
      const subMenu = (item as any).setSubmenu();
      subMenu.addItem((sub: any) => {
        sub.setTitle('Choose vault tag...').setIcon('search').onClick(() => {
          this.openTagCellEditor(entry, 'tags');
        });
      });
      subMenu.addItem((sub: any) => {
        sub.setTitle('Create tag...').setIcon('plus').onClick(() => {
          new TextInputModal(this.plugin.app, 'Tag', '', async (value) => {
            const tags = parseTaskTagValues(value);
            if (tags.length === 0) {
              new Notice('Enter a valid tag.');
              return;
            }
            await this.updateEntryLine(entry, (line) => (
              addLogLineSemanticTags(line, 'tags', tags)
            ));
          }, { suggestions: collectKnownVaultTags(this.plugin.app) }).open();
        });
      });
      if (current.length > 0) subMenu.addSeparator();
      for (const tag of current) {
        subMenu.addItem((sub: any) => {
          sub.setTitle(`Remove #${tag}`).setIcon('x').onClick(() => {
            void this.updateEntryLine(entry, (line) => (
              toggleLogLineSemanticTag(line, 'tags', tag, true)
            ));
          });
        });
      }
    });
  }

  private promptEntryField(entry: LogLineEntry, key: string, label: string, current: string): void {
    new TextInputModal(this.plugin.app, label, current, async (value) => {
      await this.updateEntryLine(entry, (line) => setLogInlineFieldValue(line, key, String(value || '').trim() || null));
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
    const isTask = parseTaskLine(entry.line) != null;
    await requestLineItemDelete({
      app: this.plugin.app,
      file: entry.file,
      lineIndex: entry.lineNumber,
      rawLine: entry.line,
      itemLabel: isHeading ? 'heading' : 'record',
      source: 'tps-table-menu',
      ...(isHeading ? { blockKind: 'heading-section' as const } : {}),
      ...(isTask ? {
        taskHistory: {
          service: this.plugin.itemHistoryService,
          cause: {
            kind: 'user' as const,
            sourcePluginId: 'tps-global-context-menu' as const,
            surface: 'delete',
          },
        },
      } : {}),
      resolveLineIndex: (lines) => resolveEntryLineNumber(lines, entry),
      onDeleted: () => this.queueRender(),
    });
  }

  private async updateEntryLine(entry: LogLineEntry, updater: (line: string) => string | null): Promise<boolean> {
    const expectedIsTask = parseTaskLine(entry.line) != null;
    const historyService = this.plugin.itemHistoryService;
    const historyContext: DirectTaskHistoryLogContext = {
      action: 'task.update',
      surface: 'tps-table',
      path: entry.file.path,
      lineNumber: entry.lineNumber,
    };
    const historyHandle = expectedIsTask
      ? await beginDirectTaskHistory(historyService, {
          action: historyContext.action,
          cause: {
            kind: 'user',
            sourcePluginId: 'tps-global-context-menu',
            surface: historyContext.surface,
          },
          before: {
            path: entry.file.path,
            lineNumber: entry.lineNumber,
            rawLine: entry.line,
          },
        })
      : null;
    let mutation: ReturnType<typeof mutateLogLineContent> = {
      content: '',
      outcome: 'unchanged',
      lineNumber: entry.lineNumber,
    };
    let committedLine = '';
    let historyReady = true;
    let confirmedHistoryBefore: DirectTaskHistoryLocation | undefined;
    try {
      await this.plugin.app.vault.process(entry.file, (content) => {
        mutation = mutateLogLineContent(content, entry, (currentLine) => {
          if (historyHandle && parseTaskLine(currentLine)) {
            confirmedHistoryBefore = {
              path: entry.file.path,
              lineNumber: mutation.lineNumber,
              rawLine: currentLine,
            };
          }
          const nextLine = updater(currentLine);
          if (!historyHandle || nextLine === null || nextLine === currentLine) {
            if (historyHandle && nextLine === null) historyReady = false;
            return nextLine;
          }
          if (!parseTaskLine(currentLine) || !parseTaskLine(nextLine)) {
            historyReady = false;
            return nextLine;
          }
          const ensured = ensureDirectTaskHistoryIdentity(
            historyService,
            historyHandle,
            nextLine,
            historyContext,
          );
          committedLine = ensured.line;
          historyReady = ensured.ready;
          return ensured.line;
        });
        return mutation.content;
      });
    } catch (error) {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      throw error;
    }
    if (mutation.outcome === 'stale') {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
      logger.flowWarn('TpsTableView', 'record-mutation:stale-target', {
        path: entry.file.path,
        renderedLineNumber: entry.lineNumber + 1,
        identity: getLogEntryStableIdentity(entry),
      });
      new Notice('That log row changed before it could be updated. Refresh and try again.');
      return false;
    }
    if (confirmedHistoryBefore) confirmedHistoryBefore.lineNumber = mutation.lineNumber;
    if (mutation.outcome === 'changed' && historyReady && committedLine) {
      await commitDirectTaskHistory(historyService, historyHandle, {
        ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
        after: {
          path: entry.file.path,
          lineNumber: mutation.lineNumber,
          rawLine: committedLine,
        },
        sourceDisposition: 'retained',
        outcome: 'committed',
      }, historyContext);
    } else {
      await abortDirectTaskHistory(historyService, historyHandle, historyContext);
    }
    logger.flow('TpsTableView', 'record-mutation:done', {
      path: entry.file.path,
      renderedLineNumber: entry.lineNumber + 1,
      outcome: mutation.outcome,
      identity: getLogEntryStableIdentity(entry),
    });
    this.queueRender();
    return true;
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
    const baseText = `${this.renderedResultCount} result${this.renderedResultCount === 1 ? '' : 's'}`;
    const progress = this.tableIndexProgress;
    const text = progress && !progress.complete
      ? `${baseText} · indexing ${progress.completedFiles}/${progress.totalFiles}`
      : baseText;
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
    const view = this.containerEl.closest<HTMLElement>('.bases-view');
    let sibling = view?.previousElementSibling as HTMLElement | null | undefined;
    while (sibling) {
      if (sibling.matches('.bases-view-header, .base-view-header, .bases-toolbar, .bases-header, .view-header')) {
        return sibling;
      }
      sibling = sibling.previousElementSibling as HTMLElement | null;
    }
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
