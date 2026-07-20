import { App, TFile, TFolder, Notice, Setting, setIcon, WorkspaceLeaf, normalizePath, Menu, MarkdownView, getAllTags, Modal } from 'obsidian';
import TPSGlobalContextMenuPlugin from '../main';
import { BuildPanelOptions, CustomProperty } from '../types';
import { SYSTEM_COMMANDS, STATUSES, PRIORITIES } from '../constants';
import { PropertyRowService } from '../services/property-row-service';
import { FileSuggestModal } from '../modals/FileSuggestModal';
import { MultiFileSelectModal } from '../modals/MultiFileSelectModal';
import { addSafeClickListener } from './menu-controller';
import { mergeNormalizedTags, normalizeTagValue, parseTagInput } from '../utils/tag-utils';
import * as logger from '../logger';
import { resolveCustomProperties } from '../resolve-profiles';
import { ViewModeService } from '../services/view-mode-service';
import { parseLinksFromFrontmatterValue, resolveLinkTargetToFile } from '../services/link-target-service';
import { applyNotebookNavigatorRulesToFile, promptAndCreateSubitemForParent } from '../services/subitem-creation-service';
import { promoteChecklistItemToChild as promoteChecklistItemToChildFromApi } from '../plugin-api';
import { resolveLinkValueToFile } from '../handlers/parent-link-format';
import { PanelActionService } from './panel-action-service';
import { SubitemMetadataService, SubitemRelationEntry, SubitemRelationKind } from './subitem-metadata-service';
import { getEffectivePropertyOptions } from '../utils/property-options';
import { TextInputModal } from '../modals/text-input-modal';
import { getCheckboxStateMarker, normalizeCheckboxStateToken } from '../utils/checkbox-state';
import { getWikilinkDisplayText, isLinkListProperty, parseLinkListInput } from '../utils/list-utils';
import { extractWebLink } from '../utils/web-link-utils';
import { getPlainDisplayTitle } from '../utils/display-title';
import type { TPSHealthUiMetricRenderConfig } from '../tps-health-ui-contract';
import { isFrontmatterMutationReady } from '../services/frontmatter-mutation-outcome';
import {
  formatParentUnlinkAggregateNotice,
  formatSingleRelationshipUnlinkNotice,
} from '../services/relationship-outcome';
import type {
  AttachmentUnlinkOutcome,
  RelationshipUnlinkAggregateOutcome,
  RelationshipUnlinkOutcome,
} from '../services/subitem-types';

interface SubitemNode {
  file: TFile;
  relations: SubitemRelationKind[];
  children: SubitemNode[];
  hidden?: boolean;
}

type ChecklistTaskState = string;

interface ChecklistSubitem {
  lineNumber: number;
  rawLine: string;
  prefix: string;
  state: ChecklistTaskState;
  text: string;
}

export type ReferenceDirection = 'incoming' | 'outgoing';

export interface ReferenceOccurrence {
  sourceFile: TFile;
  targetFile: TFile;
  lineNumber: number;
  heading: string;
  previews: string[];
  matchedText?: string;
  /** When the match was found in a frontmatter field, stores the key name (e.g. "dateCreated") */
  frontmatterKey?: string;
}

export interface ReferenceGroup {
  file: TFile;
  direction: ReferenceDirection;
  occurrences: ReferenceOccurrence[];
}

export interface MentionGroup {
  file: TFile;
  occurrences: ReferenceOccurrence[];
}

export interface ReferenceData {
  outgoing: ReferenceGroup[];
  incoming: ReferenceGroup[];
  mentions: MentionGroup[];
}

interface GraphData {
  outgoing: TFile[];
  incoming: TFile[];
  mentions: TFile[];
}

type TPSHealthMetricState = 'good' | 'under' | 'over' | 'neutral';

interface TPSHealthMetricDisplay {
  state: TPSHealthMetricState;
  visualPercent: number;
  labelPercent: string;
  color: string;
}

const ATTACHMENTS_FRONTMATTER_KEY = 'attachments';
const MAX_SUBITEM_DEPTH = 8;
const SUBITEM_PANEL_REFRESH_DEBOUNCE_MS = 200;
const SUBITEM_LINK_RECONCILE_INTERVAL_MS = 3000;

type CreatablePropertyType = CustomProperty['type'];

const FALLBACK_ICON_PATHS: Record<string, string[]> = {
  plus: ['M12 5v14', 'M5 12h14'],
  paperclip: ['M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'],
  'more-horizontal': ['M12 12h.01', 'M19 12h.01', 'M5 12h.01'],
};

function setIconWithFallback(el: HTMLElement, iconId: string): void {
  el.empty();
  try {
    setIcon(el, iconId);
  } catch {
    // Fall back below.
  }
  if (el.querySelector('svg')) return;

  const paths = FALLBACK_ICON_PATHS[iconId];
  if (!paths) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  el.appendChild(svg);
}

class CreateCustomPropertyModal extends Modal {
  private label = '';
  private key = '';
  private type: CreatablePropertyType = 'text';
  private hidden = false;
  private showWhen: CustomProperty['showWhen'] = 'always';
  private inlineShowWhen: CustomProperty['inlineShowWhen'] | '' = '';
  private contextMenuShowWhen: CustomProperty['contextMenuShowWhen'] | '' = '';
  private initialValue = '';
  private keyInput: HTMLInputElement | null = null;
  private existingPropertyKey = '';

  constructor(
    app: App,
    private readonly plugin: TPSGlobalContextMenuPlugin,
    private readonly onCreate: (property: CustomProperty, initialValue: unknown, shouldWriteValue: boolean, isNewProperty: boolean) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('mod-tps-gcm');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Add property' });

    const existingProperties = (this.plugin.settings.properties || [])
      .filter((property) => String(property?.key || '').trim())
      .sort((left, right) => String(left.label || left.key).localeCompare(String(right.label || right.key), undefined, { sensitivity: 'base' }));

    if (existingProperties.length > 0) {
      new Setting(contentEl)
        .setName('Configured property')
        .setDesc('Choose an existing property to add a value to this note, or create a new reusable property.')
        .addDropdown((dropdown) => {
          dropdown.addOption('', 'Create new property');
          for (const property of existingProperties) {
            dropdown.addOption(String(property.key), String(property.label || property.key));
          }
          dropdown.setValue(this.existingPropertyKey).onChange((value) => {
            this.existingPropertyKey = value;
            const property = existingProperties.find((candidate) => String(candidate.key) === value);
            if (!property) return;
            this.label = String(property.label || property.key || '').trim();
            this.key = String(property.key || '').trim();
            this.type = property.type || 'text';
            this.hidden = property.hidden === true;
            this.showWhen = property.showWhen || 'always';
            this.inlineShowWhen = property.inlineShowWhen || '';
            this.contextMenuShowWhen = property.contextMenuShowWhen || '';
            if (this.keyInput) this.keyInput.value = this.key;
          });
        });
    }

    new Setting(contentEl)
      .setName('Label')
      .setDesc('Display name shown in the GCM property UI.')
      .addText((text) => text
        .setPlaceholder('Calories eaten')
        .setValue(this.label)
        .onChange((value) => {
          this.label = value.trim();
          if (!this.key) {
            this.key = this.normalizePropertyKey(this.label);
            if (this.keyInput) this.keyInput.value = this.key;
          }
        }));

    new Setting(contentEl)
      .setName('Frontmatter key')
      .setDesc('Stored key, for example caloriesEaten.')
      .addText((text) => {
        text
          .setPlaceholder('caloriesEaten')
          .setValue(this.key)
          .onChange((value) => {
            this.key = this.normalizePropertyKey(value);
            if (text.inputEl.value !== this.key) text.inputEl.value = this.key;
          });
        this.keyInput = text.inputEl;
      });

    new Setting(contentEl)
      .setName('Type')
      .addDropdown((dropdown) => dropdown
        .addOption('text', 'Text')
        .addOption('number', 'Number')
        .addOption('datetime', 'Date/Time')
        .addOption('selector', 'Selector')
        .addOption('list', 'List')
        .addOption('checkbox', 'Checkbox')
        .setValue(this.type)
        .onChange((value) => {
          this.type = value as CreatablePropertyType;
        }));

    new Setting(contentEl)
      .setName('Hidden property')
      .setDesc('Write the value to frontmatter but do not show it as a normal GCM property row.')
      .addToggle((toggle) => toggle
        .setValue(this.hidden)
        .onChange((value) => {
          this.hidden = value;
        }));

    new Setting(contentEl)
      .setName('Property visibility')
      .setDesc('Choose whether this row appears based on the frontmatter key and value state.')
      .addDropdown((dropdown) => dropdown
        .addOption('always', 'Always show')
        .addOption('populated', 'Only when key has value')
        .addOption('exists', 'Only when key exists')
        .addOption('blank', 'Only when key exists but is empty')
        .addOption('missing', 'Only when key is missing')
        .addOption('empty', 'Only when missing or empty')
        .addOption('never', 'Never show')
        .setValue(this.showWhen || 'always')
        .onChange((value: CustomProperty['showWhen']) => {
          this.showWhen = value || 'always';
          this.hidden = value === 'never';
        }));

    new Setting(contentEl)
      .setName('Inline visibility')
      .setDesc('Optional override for inline/header chips.')
      .addDropdown((dropdown) => dropdown
        .addOption('', 'Use property visibility')
        .addOption('always', 'Always show')
        .addOption('populated', 'Only when key has value')
        .addOption('exists', 'Only when key exists')
        .addOption('blank', 'Only when key exists but is empty')
        .addOption('missing', 'Only when key is missing')
        .addOption('empty', 'Only when missing or empty')
        .addOption('never', 'Never show')
        .setValue(this.inlineShowWhen || '')
        .onChange((value: '' | CustomProperty['showWhen']) => {
          this.inlineShowWhen = value || '';
        }));

    new Setting(contentEl)
      .setName('Context menu visibility')
      .setDesc('Optional override for right-click context menus.')
      .addDropdown((dropdown) => dropdown
        .addOption('', 'Use property visibility')
        .addOption('always', 'Always show')
        .addOption('populated', 'Only when key has value')
        .addOption('exists', 'Only when key exists')
        .addOption('blank', 'Only when key exists but is empty')
        .addOption('missing', 'Only when key is missing')
        .addOption('empty', 'Only when missing or empty')
        .addOption('never', 'Never show')
        .setValue(this.contextMenuShowWhen || '')
        .onChange((value: '' | CustomProperty['showWhen']) => {
          this.contextMenuShowWhen = value || '';
        }));

    new Setting(contentEl)
      .setName('Initial value')
      .setDesc('Optional. Leave blank to only create the reusable property definition.')
      .addText((text) => text
        .setPlaceholder('2200')
        .setValue(this.initialValue)
        .onChange((value) => {
          this.initialValue = value;
        }));

    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText('Create property')
        .setCta()
        .onClick(() => {
          void this.submit();
        }))
      .addButton((button) => button
        .setButtonText('Cancel')
        .onClick(() => this.close()));
  }

  private async submit(): Promise<void> {
    const existingProperty = this.existingPropertyKey
      ? (this.plugin.settings.properties || []).find((property) => String(property?.key || '') === this.existingPropertyKey)
      : null;
    if (existingProperty) {
      const rawExistingValue = this.initialValue.trim();
      const shouldWriteExistingValue = existingProperty.type === 'checkbox' || rawExistingValue.length > 0;
      await this.onCreate(existingProperty, this.coerceInitialValue(rawExistingValue, existingProperty.type), shouldWriteExistingValue, false);
      this.close();
      return;
    }

    const label = this.label.trim();
    const key = this.normalizePropertyKey(this.key || label);
    if (!label || !key) {
      new Notice('Property label and key are required.');
      return;
    }
    if (this.hasExistingPropertyKey(key)) {
      new Notice(`Property "${key}" already exists.`);
      return;
    }

    const property: CustomProperty = {
      id: `property-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      label,
      key,
      type: this.type,
      hidden: this.hidden || this.showWhen === 'never',
      showInCollapsed: !(this.hidden || this.showWhen === 'never'),
      showInContextMenu: !(this.hidden || this.showWhen === 'never'),
      allowInlineSet: !(this.hidden || this.showWhen === 'never'),
      showWhen: this.showWhen || 'always',
    };
    if (this.inlineShowWhen) property.inlineShowWhen = this.inlineShowWhen;
    if (this.contextMenuShowWhen) property.contextMenuShowWhen = this.contextMenuShowWhen;
    if (this.type === 'list') property.listItemType = 'text';

    const rawValue = this.initialValue.trim();
    const shouldWriteValue = this.type === 'checkbox' || rawValue.length > 0;
    await this.onCreate(property, this.coerceInitialValue(rawValue, this.type), shouldWriteValue, true);
    this.close();
  }

  private coerceInitialValue(value: string, type: CreatablePropertyType = this.type): unknown {
    if (type === 'number') {
      const numberValue = Number(value);
      return Number.isFinite(numberValue) ? numberValue : value;
    }
    if (type === 'checkbox') {
      return /^(true|yes|y|1|checked|on)$/i.test(value || 'true');
    }
    if (type === 'list') {
      return value.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean);
    }
    return value;
  }

  private hasExistingPropertyKey(key: string): boolean {
    return (this.plugin.settings.properties || []).some((property) =>
      String(property?.key || '').trim().toLowerCase() === key.toLowerCase(),
    );
  }

  private normalizePropertyKey(value: string): string {
    const words = String(value || '').trim().match(/[A-Za-z0-9]+/g) || [];
    return words
      .map((word, index) => {
        const lower = word.toLowerCase();
        return index === 0 ? lower : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
      })
      .join('');
  }
}

export class PanelBuilder {
  private plugin: TPSGlobalContextMenuPlugin;
  private propertyRowService: PropertyRowService;
  private actionService: PanelActionService;
  private subitemMetadataService: SubitemMetadataService;
  private delegates: {
    createFileEntries: (files: TFile[]) => any[];
    openAddTagModal: (entries: any[], key?: string) => void;
    openAddListValueModal: (entries: any[], key: string, label?: string) => void;
    openScheduledModal: (entries: any[], key?: string) => void;
    openRecurrenceModalNative: (entries: any[]) => void;
    formatDatetimeDisplay: (value: string | null | undefined) => string;
  };
  private subitemPanelRefreshTimers: Map<string, number> = new Map();
  private subitemLinkReconcileAt: Map<string, number> = new Map();
  private fileTitleCache: Map<string, string> = new Map();
  private stackedPropertiesCollapsedByPath: Map<string, boolean> = new Map();

  constructor(
    plugin: TPSGlobalContextMenuPlugin,
    propertyRowService: PropertyRowService,
    delegates: PanelBuilder['delegates']
  ) {
    this.plugin = plugin;
    this.propertyRowService = propertyRowService;
    this.delegates = delegates;
    this.actionService = new PanelActionService(plugin, {
      archiveEntries: async (entries) => this.archiveEntries(entries),
    });
    this.subitemMetadataService = new SubitemMetadataService(plugin, {
      createFileEntries: delegates.createFileEntries,
    });
  }

  private get app(): App {
    return this.plugin.app;
  }

  private showParentUnlinkResult(
    outcome: RelationshipUnlinkOutcome,
    childFile: TFile,
    parentFile: TFile,
  ): void {
    new Notice(formatSingleRelationshipUnlinkNotice(
      outcome.status,
      `parent link between ${childFile.basename} and ${parentFile.basename}`,
    ));
  }

  private showParentUnlinkAggregateResult(
    outcome: RelationshipUnlinkAggregateOutcome,
    childFile: TFile,
  ): void {
    new Notice(formatParentUnlinkAggregateNotice(outcome, childFile.basename));
  }

  private showAttachmentUnlinkResult(outcome: AttachmentUnlinkOutcome, attachmentFile: TFile): void {
    new Notice(formatSingleRelationshipUnlinkNotice(
      outcome.status,
      `attachment link for ${attachmentFile.basename}`,
    ));
  }

  private reportAsyncPanelActionFailure(action: string, error: unknown): void {
    logger.warn(`[TPS GCM] ${action} failed`, logger.errorSummary(error));
    new Notice(`${action} failed. No success was reported.`);
  }

  // ... (Archive helpers retained) ...
  private async archiveEntries(entries: any[]): Promise<void> {
    const archiveTag = normalizeTagValue(this.plugin.settings.archiveTag || 'archive');
    const archiveFolder = this.plugin.getArchiveFolderPath();
    if (!archiveFolder) {
      new Notice('Archive folder setting is not configured.');
      return;
    }

    const files = entries
      .map((entry: any) => entry?.file)
      .filter((candidate: unknown): candidate is TFile => candidate instanceof TFile);

    await this.ensureFolderPath(archiveFolder);

    let movedCount = 0;
    let taggedCount = 0;
    await this.plugin.runQueuedMove(files, async () => {
      for (const file of files) {
        const existing = this.app.vault.getAbstractFileByPath(file.path);
        const liveFile = existing instanceof TFile ? existing : file;
        if (this.isPathInFolder(liveFile.path, archiveFolder)) {
          continue;
        }

        try {
          if (liveFile.extension?.toLowerCase() === 'md' && archiveTag) {
            const originalFolder = liveFile.parent?.path ?? '';
            const outcome = await this.plugin.frontmatterMutationService.processGuardedWithOutcome(liveFile, (frontmatter: any) => {
              const nextTags = mergeNormalizedTags(frontmatter.tags, archiveTag);
              if (JSON.stringify(frontmatter.tags ?? []) === JSON.stringify(nextTags)
                && frontmatter.archiveOriginalFolder === originalFolder) return 'unchanged';
              frontmatter.tags = nextTags;
              frontmatter.archiveOriginalFolder = originalFolder;
              return true;
            });
            if (!isFrontmatterMutationReady(outcome)) {
              logger.warn('[TPS GCM] Archive stopped because its frontmatter update was not committed', liveFile.path);
              continue;
            }
            if (outcome === 'changed') taggedCount += 1;
          }

          const targetPath = this.getUniqueArchiveTargetPath(liveFile, archiveFolder);
          const targetFolder = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : '';
          if (targetFolder) {
            await this.ensureFolderPath(targetFolder);
          }
          await this.app.fileManager.renameFile(liveFile, targetPath);
          movedCount += 1;
        } catch (err) {
          logger.error('[TPS GCM] Failed archiving file', liveFile.path, err);
        }
      }
    });

    logger.log('[TPS GCM] Archive menu action complete', { movedCount, taggedCount, archiveFolder });
    new Notice(movedCount > 0
      ? (movedCount === 1 ? 'Archived 1 file' : `Archived ${movedCount} files`)
      : 'No files were archived.');
  }

  private isPathInFolder(path: string, folder: string): boolean {
    const normalizedPath = normalizePath(path);
    const normalizedFolder = normalizePath(folder).replace(/\/+$/g, '');
    return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
  }

  private async ensureFolderPath(folderPath: string): Promise<void> {
    let current = '';
    for (const part of normalizePath(folderPath).split('/').filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        await this.app.vault.createFolder(current);
      } else if (!(existing instanceof TFolder)) {
        throw new Error(`Archive folder path conflicts with an existing file: ${current}`);
      }
    }
  }

  private getUniqueArchiveTargetPath(file: TFile, archiveFolder: string): string {
    const sourceFolder = file.parent?.path ?? '';
    const relativeFolder = sourceFolder && sourceFolder !== '/'
      ? sourceFolder
      : '';
    const targetFolder = relativeFolder && !this.isPathInFolder(sourceFolder, archiveFolder)
      ? normalizePath(`${archiveFolder}/${relativeFolder}`)
      : archiveFolder;
    const extension = file.extension ? `.${file.extension}` : '';
    const baseTarget = normalizePath(`${targetFolder}/${file.basename}${extension}`);
    if (!this.app.vault.getAbstractFileByPath(baseTarget)) {
      return baseTarget;
    }

    let counter = 1;
    let targetPath = '';
    do {
      targetPath = normalizePath(`${targetFolder}/${file.basename} ${counter}${extension}`);
      counter += 1;
    } while (this.app.vault.getAbstractFileByPath(targetPath));
    return targetPath;
  }

  // --- NEW 2-ROW LAYOUT ---

  buildSpecialPanel(files: TFile[], options: BuildPanelOptions = {}): HTMLElement {
    const entries = this.delegates.createFileEntries(files);
    const panel = document.createElement('div');
    panel.className = 'tps-gcm-panel';

    addSafeClickListener(panel, (e) => {
      // e.stopPropagation();
    });

    if (files.length > 1) {
      const banner = document.createElement('div');
      banner.className = 'tps-gcm-multi-banner';
      banner.textContent = `${files.length} items selected`;
      panel.appendChild(banner);
    }

    // Single row: chips (scrolling) + buttons (fixed right)
    const row = document.createElement('div');
    row.className = 'tps-gcm-unified-row';

    // 1. Context Strip (Horizontal Scroll: Chips)
    // When stacked properties are collapsed under the title, keep them reachable
    // from the hover menu instead of hiding them from both places.
    if (this.shouldShowContextStripInPanel(files, options)) {
      const contextStrip = this.createContextStrip(entries);
      row.appendChild(contextStrip);
    }

    // 2. Action Toolbar (Compact: Tools + System Menu)
    const actionBar = this.createActionToolbar(entries);
    row.appendChild(actionBar);

    panel.appendChild(row);

    return panel;
  }

  private shouldShowContextStripInPanel(
    files: TFile[],
    options: BuildPanelOptions = {}
  ): boolean {
    if (this.plugin.settings.showCustomPropertiesInInlineUi === false) return false;
    if (this.plugin.settings.showCustomPropertiesUnderTitle !== true) return true;
    if (files.length !== 1) return false;
    return this.isStackedPropertiesCollapsed(files[0]);
  }

  public isStackedPropertiesCollapsed(file: TFile): boolean {
    return this.stackedPropertiesCollapsedByPath.get(file.path)
      ?? this.plugin.settings.defaultStackedPropertiesClosed === true;
  }

  /**
   * Creates the horizontal scrolling strip of property chips
   */
  createContextStrip(entries: any[]): HTMLElement {
    const strip = document.createElement('div');
    strip.className = 'tps-gcm-context-strip';

    let wheelScrollFrame: number | null = null;
    let pendingWheelDelta = 0;
    strip.addEventListener('wheel', (e) => {
      if (e.deltaY === 0 || e.shiftKey) return;

      const canScrollLeft = strip.scrollLeft > 0;
      const canScrollRight = strip.scrollLeft < Math.ceil(strip.scrollWidth - strip.clientWidth);

      const scrollingLeft = e.deltaY < 0;
      const scrollingRight = e.deltaY > 0;

      if ((scrollingLeft && canScrollLeft) || (scrollingRight && canScrollRight)) {
        pendingWheelDelta += e.deltaY;
        if (wheelScrollFrame !== null) return;
        wheelScrollFrame = window.requestAnimationFrame(() => {
          strip.scrollLeft += pendingWheelDelta;
          pendingWheelDelta = 0;
          wheelScrollFrame = null;
        });
      }
    }, { passive: true });

    const properties = resolveCustomProperties(this.plugin.settings.properties || [], entries, new ViewModeService(), 'inline');
    const showInlineProperties = this.plugin.settings.showCustomPropertiesInInlineUi !== false;
    const renderedProperties = new Set<string>();
    const markRendered = (prop: any) => {
      const id = String(prop?.id || '').trim().toLowerCase();
      const key = String(prop?.key || '').trim().toLowerCase();
      if (id) renderedProperties.add(id);
      if (key) renderedProperties.add(key);
    };
    const wasRendered = (prop: any): boolean => {
      const id = String(prop?.id || '').trim().toLowerCase();
      const key = String(prop?.key || '').trim().toLowerCase();
      return (!!id && renderedProperties.has(id)) || (!!key && renderedProperties.has(key));
    };

    // Status (if enabled)
    const statusProp = properties.find(p => p.id === 'status' || p.key === 'status');
    if (showInlineProperties && statusProp && statusProp.showInCollapsed !== false) {
      strip.appendChild(this.createStatusChip(entries, statusProp));
      markRendered(statusProp);
    }

    // Priority (if enabled)
    const priorityProp = properties.find(p => p.id === 'priority' || p.key === 'priority');
    if (showInlineProperties && priorityProp && priorityProp.showInCollapsed !== false) {
      strip.appendChild(this.createPriorityChip(entries, priorityProp));
      markRendered(priorityProp);
    }

    // Date (if enabled)
    const dateProp = properties.find(p => p.type === 'datetime' || p.key === 'scheduled');
    if (showInlineProperties && dateProp && dateProp.showInCollapsed !== false) {
      strip.appendChild(this.createDateChip(entries, dateProp));
      markRendered(dateProp);
    }

    // Tags (if enabled)
    const tagsProp = properties.find(p => p.id === 'tags' || p.key === 'tags');
    if (showInlineProperties && tagsProp && tagsProp.showInCollapsed !== false) {
      // Add the "+" button first
      strip.appendChild(this.createTagsChip(entries, tagsProp));

      // Then add the tags
      const tags = this.extractNormalizedTags(entries);
      if (tags.length > 0) {
        tags.forEach((tag) => {
          strip.appendChild(this.createTagValueChip(tag, entries));
        });
      }
      markRendered(tagsProp);
    }

    // Folder / Project (if enabled)
    const folderProp = properties.find(p => p.id === 'type' || p.type === 'folder');
    if (showInlineProperties && folderProp && folderProp.showInCollapsed !== false) {
      strip.appendChild(this.createFolderChip(entries));
      markRendered(folderProp);
    }

    if (showInlineProperties) {
      const frontmatter = (entries?.[0]?.frontmatter || {}) as Record<string, any>;
      for (const prop of properties) {
        if (!prop || prop.showInCollapsed === false || wasRendered(prop)) continue;
        const chip = this.createGenericContextPropertyChip(entries, prop, frontmatter);
        if (chip) {
          strip.appendChild(chip);
          markRendered(prop);
        }
      }
    }

    return strip;
  }

  createStackedPropertiesPanel(file: TFile): HTMLElement | null {
    if (this.plugin.settings.showCustomPropertiesUnderTitle !== true) return null;
    if (this.plugin.settings.showCustomPropertiesInInlineUi === false) return null;

    const entries = this.delegates.createFileEntries([file]);
    const entry = entries?.[0];
    const frontmatter = (entry?.frontmatter || {}) as Record<string, any>;
    const healthMetricConfigs = this.getHealthMetricRenderConfigs();
    const properties = this.withHealthMetricProperties(
      resolveCustomProperties(this.plugin.settings.properties || [], entries, new ViewModeService(), 'inline')
        .filter((prop) => prop && prop.showInCollapsed !== false),
      frontmatter,
      healthMetricConfigs,
    );

    const panel = document.createElement('section');
    panel.className = 'tps-gcm-top-properties-panel';
    const collapsed = this.isStackedPropertiesCollapsed(file);
    panel.classList.toggle('tps-gcm-top-properties-panel--collapsed', collapsed);

    const heading = document.createElement('button');
    heading.type = 'button';
    heading.className = 'tps-gcm-top-properties-heading';
    heading.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    heading.setAttribute('aria-label', collapsed ? 'Expand properties' : 'Collapse properties');

    const headingIcon = document.createElement('span');
    headingIcon.className = 'tps-gcm-top-properties-heading-icon';
    setIcon(headingIcon, collapsed ? 'chevron-right' : 'chevron-down');
    heading.appendChild(headingIcon);

    const headingLabel = document.createElement('span');
    headingLabel.textContent = 'Properties';
    heading.appendChild(headingLabel);
    panel.appendChild(heading);

    const addPropertyButton = document.createElement('button');
    addPropertyButton.type = 'button';
    addPropertyButton.className = 'tps-gcm-top-properties-add-button';
    addPropertyButton.title = 'Add property';
    addPropertyButton.setAttribute('aria-label', 'Add property');
    setIcon(addPropertyButton, 'plus');
    addSafeClickListener(addPropertyButton, (event) => {
      event.stopPropagation();
      this.openAddPropertyMenu(addPropertyButton, file, entries, frontmatter);
    });
    panel.appendChild(addPropertyButton);

    const list = document.createElement('div');
    list.className = 'tps-gcm-top-properties-list';
    list.style.display = collapsed ? 'none' : '';
    panel.appendChild(list);

    addSafeClickListener(heading, () => {
      const nextCollapsed = !panel.classList.contains('tps-gcm-top-properties-panel--collapsed');
      this.stackedPropertiesCollapsedByPath.set(file.path, nextCollapsed);
      panel.classList.toggle('tps-gcm-top-properties-panel--collapsed', nextCollapsed);
      heading.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
      heading.setAttribute('aria-label', nextCollapsed ? 'Expand properties' : 'Collapse properties');
      list.style.display = nextCollapsed ? 'none' : '';
      headingIcon.empty();
      setIcon(headingIcon, nextCollapsed ? 'chevron-right' : 'chevron-down');
      this.plugin.persistentMenuManager?.refreshMenusForFile(file, true);
    });

    for (const prop of properties) {
      const row = document.createElement('div');
      row.className = 'tps-gcm-top-property-row';
      row.dataset.tpsGcmPropertyKey = String(prop.key || '');
      row.dataset.tpsGcmPropertyId = String(prop.id || '');
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openStackedPropertyRowMenu(event, file, prop);
      });

      const icon = document.createElement('span');
      icon.className = 'tps-gcm-top-property-icon';
      setIcon(icon, this.getStackedPropertyIcon(prop));
      row.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'tps-gcm-top-property-label';
      label.textContent = String(prop.label || prop.key || prop.id || 'Property');
      row.appendChild(label);

      const value = document.createElement('div');
      value.className = 'tps-gcm-top-property-value';
      this.populateStackedPropertyValue(value, entries, prop, frontmatter, healthMetricConfigs);
      this.makeStackedPropertyValueEditable(value, entries, prop);
      row.appendChild(value);

      list.appendChild(row);
    }

    const pageBreak = document.createElement('div');
    pageBreak.className = 'tps-gcm-top-properties-page-break';
    pageBreak.setAttribute('aria-hidden', 'true');
    panel.appendChild(pageBreak);

    return panel;
  }

  private openStackedPropertyRowMenu(event: MouseEvent, file: TFile, prop: any): void {
    const menu = new Menu();
    const label = String(prop?.label || prop?.key || 'Property');
    const index = this.findPropertyIndex(prop);

    menu.addItem((item) => {
      item
        .setTitle('Move property up')
        .setIcon('arrow-up')
        .setDisabled(index <= 0)
        .onClick(() => void this.moveConfiguredProperty(prop, -1, file));
    });
    menu.addItem((item) => {
      item
        .setTitle('Move property down')
        .setIcon('arrow-down')
        .setDisabled(index < 0 || index >= (this.plugin.settings.properties || []).length - 1)
        .onClick(() => void this.moveConfiguredProperty(prop, 1, file));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle('Remove property from file')
        .setIcon('trash-2')
        .setDisabled(!String(prop?.key || '').trim())
        .onClick(() => void this.removePropertyFromFile(prop, file));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle('Add hide rule to property')
        .setIcon('eye-off')
        .onClick(() => void this.updateConfiguredPropertyVisibility(prop, { hidden: true }, file, `${label} hidden`));
    });
    menu.addItem((item) => {
      item
        .setTitle('Only show when missing or empty')
        .setIcon('circle')
        .setChecked(prop?.showWhen === 'empty')
        .onClick(() => void this.updateConfiguredPropertyVisibility(prop, { hidden: false, showWhen: 'empty' }, file, `${label} shown only when missing or empty`));
    });
    menu.addItem((item) => {
      item
        .setTitle('Only show when key exists')
        .setIcon('key')
        .setChecked(prop?.showWhen === 'exists')
        .onClick(() => void this.updateConfiguredPropertyVisibility(prop, { hidden: false, showWhen: 'exists' }, file, `${label} shown only when key exists`));
    });
    menu.addItem((item) => {
      item
        .setTitle('Only show when key exists but is empty')
        .setIcon('circle')
        .setChecked(prop?.showWhen === 'blank')
        .onClick(() => void this.updateConfiguredPropertyVisibility(prop, { hidden: false, showWhen: 'blank' }, file, `${label} shown only when key exists but is empty`));
    });
    menu.addItem((item) => {
      item
        .setTitle('Only show when key is missing')
        .setIcon('circle-slash')
        .setChecked(prop?.showWhen === 'missing')
        .onClick(() => void this.updateConfiguredPropertyVisibility(prop, { hidden: false, showWhen: 'missing' }, file, `${label} shown only when key is missing`));
    });
    menu.addItem((item) => {
      item
        .setTitle('Only show when populated')
        .setIcon('circle-dot')
        .setChecked(prop?.showWhen === 'populated')
        .onClick(() => void this.updateConfiguredPropertyVisibility(prop, { hidden: false, showWhen: 'populated' }, file, `${label} shown only when populated`));
    });
    menu.addItem((item) => {
      item
        .setTitle('Always show even when empty')
        .setIcon('eye')
        .setChecked(!prop?.hidden && (!prop?.showWhen || prop.showWhen === 'always'))
        .onClick(() => void this.updateConfiguredPropertyVisibility(prop, { hidden: false, showWhen: 'always' }, file, `${label} always shown`));
    });
    menu.addItem((item) => {
      item
        .setTitle('Never show')
        .setIcon('eye-off')
        .setChecked(prop?.hidden === true || prop?.showWhen === 'never')
        .onClick(() => void this.updateConfiguredPropertyVisibility(prop, { hidden: true, showWhen: 'never' }, file, `${label} hidden`));
    });
    menu.showAtMouseEvent(event);
  }

  private findPropertyIndex(prop: any): number {
    const properties = this.plugin.settings.properties || [];
    const id = String(prop?.id || '').trim();
    const key = String(prop?.key || '').trim().toLowerCase();
    return properties.findIndex((candidate: any) => {
      if (id && String(candidate?.id || '').trim() === id) return true;
      return !!key && String(candidate?.key || '').trim().toLowerCase() === key;
    });
  }

  private async moveConfiguredProperty(prop: any, direction: -1 | 1, file: TFile): Promise<void> {
    const properties = this.plugin.settings.properties || [];
    const index = this.findPropertyIndex(prop);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= properties.length) return;
    const [moved] = properties.splice(index, 1);
    properties.splice(nextIndex, 0, moved);
    this.plugin.settings.properties = properties;
    await this.plugin.saveSettings();
    this.plugin.persistentMenuManager?.refreshMenusForFile(file, true);
    new Notice(`Moved ${String(moved?.label || moved?.key || 'property')}.`);
  }

  private async updateConfiguredPropertyVisibility(
    prop: any,
    patch: Partial<CustomProperty>,
    file: TFile,
    notice: string,
  ): Promise<void> {
    const properties = this.plugin.settings.properties || [];
    const index = this.findPropertyIndex(prop);
    if (index < 0) return;
    properties[index] = { ...properties[index], ...patch };
    this.plugin.settings.properties = properties;
    await this.plugin.saveSettings();
    this.plugin.persistentMenuManager?.refreshMenusForFile(file, true);
    new Notice(notice);
  }

  private async removePropertyFromFile(prop: any, file: TFile): Promise<void> {
    const key = String(prop?.key || '').trim();
    if (!key) return;
    await this.plugin.frontmatterMutationService.deleteKeys([file], [key]);
    await this.afterStackedPropertyEdit([file], [key]);
    new Notice(`Removed ${String(prop?.label || key)} from ${file.basename}.`);
  }

  private openCreateCustomPropertyModal(file: TFile, entries: any[]): void {
    new CreateCustomPropertyModal(this.app, this.plugin, async (property, initialValue, shouldWriteValue, isNewProperty) => {
      if (isNewProperty) {
        if (!Array.isArray(this.plugin.settings.properties)) this.plugin.settings.properties = [];
        this.plugin.settings.properties.push(property);
        await this.plugin.saveSettings();
      }

      if (shouldWriteValue) {
        const files = this.filesFromEntries(entries);
        await this.plugin.bulkEditService.updateFrontmatter(files, { [property.key]: initialValue });
        await this.afterStackedPropertyEdit(files, [property.key]);
      } else {
        this.plugin.persistentMenuManager?.refreshMenusForFile(file, true);
      }
    }).open();
  }

  private openAddPropertyMenu(anchor: HTMLElement, file: TFile, entries: any[], frontmatter: Record<string, any>): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle('Create new custom property')
        .setIcon('plus-circle')
        .onClick(() => this.openCreateCustomPropertyModal(file, entries));
    });

    const scopedProperties = resolveCustomProperties(
      (this.plugin.settings.properties || []).map((property) => ({
        ...property,
        showWhen: 'always' as const,
        inlineShowWhen: undefined,
        contextMenuShowWhen: undefined,
      })),
      entries,
      new ViewModeService(),
      'any',
    );
    const properties = scopedProperties
      .filter((property) => {
        const key = String(property?.key || '').trim();
        if (!key) return false;
        return !this.hasFrontmatterKeyCaseInsensitive(frontmatter, key);
      })
      .sort((left, right) => String(left.label || left.key).localeCompare(String(right.label || right.key), undefined, { sensitivity: 'base' }));

    menu.addSeparator();
    if (properties.length === 0) {
      menu.addItem((item) => item.setTitle('No missing configured properties').setDisabled(true));
    } else {
      for (const property of properties) {
        menu.addItem((item) => {
          item
            .setTitle(String(property.label || property.key))
            .setIcon(this.getStackedPropertyIcon(property))
            .onClick(() => void this.insertConfiguredPropertyAndEdit(anchor, entries, property));
        });
      }
    }

    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
  }

  private async insertConfiguredPropertyAndEdit(anchor: HTMLElement, entries: any[], prop: any): Promise<void> {
    const key = String(prop?.key || '').trim();
    if (!key) return;
    await this.plugin.fieldInitializationService.initializeIfMissing(entries, key, this.getDefaultPropertyValue(prop));
    this.openStackedPropertyEditor(anchor, entries, prop);
  }

  private getDefaultPropertyValue(prop: any): unknown {
    if (prop?.type === 'checkbox' || prop?.type === 'boolean') return false;
    if (prop?.type === 'number') return '';
    if (prop?.type === 'list') return [];
    return '';
  }

  private makeStackedPropertyValueEditable(target: HTMLElement, entries: any[], prop: any): void {
    if (!this.isStackedPropertyEditable(prop)) return;
    target.classList.add('tps-gcm-top-property-value--clickable');
    target.tabIndex = 0;
    target.setAttribute('role', 'button');
    target.setAttribute('aria-label', `Edit ${String(prop?.label || prop?.key || 'property')}`);

    addSafeClickListener(target, (event) => {
      const eventTarget = event.target as HTMLElement | null;
      if (eventTarget?.closest('.tps-gcm-chip, button, input, select, textarea, a')) return;
      this.openStackedPropertyEditor(target, entries, prop);
    });
    target.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.openStackedPropertyEditor(target, entries, prop);
    });
  }

  private isStackedPropertyEditable(prop: any): boolean {
    const key = String(prop?.key || '').trim();
    return !!key || prop?.type === 'folder' || prop?.type === 'recurrence';
  }

  private openStackedPropertyEditor(anchor: HTMLElement, entries: any[], prop: any): void {
    const propId = String(prop?.id || '').toLowerCase();
    const propKey = String(prop?.key || '').trim();
    const propKeyLower = propKey.toLowerCase();

    if (propId === 'status' || propKeyLower === 'status') {
      this.propertyRowService.openStatusSubmenu(anchor, entries, () => {
        this.refreshStackedPropertyValue(anchor, entries, prop);
      }, prop?.options, async (files) => {
        for (const file of files) await applyNotebookNavigatorRulesToFile(this.plugin, file);
      });
      return;
    }
    if (propId === 'priority' || propKeyLower === 'priority') {
      this.propertyRowService.openPrioritySubmenu(anchor, entries, () => {
        this.refreshStackedPropertyValue(anchor, entries, prop);
      }, getEffectivePropertyOptions(this.app, prop), propKey || 'priority');
      return;
    }
    if (prop.type === 'datetime' || propKeyLower === 'scheduled' || propKeyLower === 'date') {
      this.delegates.openScheduledModal(entries, propKey || 'scheduled');
      return;
    }
    if (propId === 'tags' || propKeyLower === 'tags' || propKeyLower === 'tag') {
      this.delegates.openAddTagModal(entries, propKey || 'tags');
      return;
    }
    if (prop.type === 'list') {
      this.delegates.openAddListValueModal(entries, propKey, prop?.label || propKey || 'Value');
      return;
    }
    if (propId === 'type' || prop.type === 'folder') {
      this.propertyRowService.openTypeSubmenu(anchor, entries);
      return;
    }
    if (prop.type === 'recurrence' || propKeyLower === 'recurrence' || propKeyLower === 'recurrencerule') {
      this.delegates.openRecurrenceModalNative(entries);
      return;
    }
    if (prop.type === 'selector') {
      this.openStackedSelectorMenu(anchor, entries, prop);
      return;
    }
    if (prop.type === 'checkbox' || prop.type === 'boolean') {
      void this.toggleStackedBooleanProperty(entries, prop);
      return;
    }
    this.openStackedTextEditor(entries, prop);
  }

  private openStackedSelectorMenu(anchor: HTMLElement, entries: any[], prop: any): void {
    const key = String(prop?.key || '').trim();
    if (!key) return;
    const current = String(this.getFrontmatterValueCaseInsensitive(entries[0]?.frontmatter || {}, key) ?? '').trim();
    const files = this.filesFromEntries(entries);
    const menu = new Menu();
    const checkedItems: Array<{ item: any; value: string }> = [];
    const setCheckedValue = (value: string) => {
      for (const entry of checkedItems) entry.item.setChecked(entry.value === value);
      logger.flow('PropertySelector', 'stacked:checked-state', { key, value, files: files.length });
    };
    menu.addItem((item) => {
      checkedItems.push({ item, value: '' });
      item.setTitle('(none)').setChecked(!current).onClick(async () => {
        setCheckedValue('');
        this.removeEntryFrontmatterValue(entries, key);
        this.refreshStackedPropertyValue(anchor, entries, prop);
        await this.plugin.bulkEditService.removeFrontmatterKey(files, key);
        await this.afterStackedPropertyEdit(files, [key], false);
      });
    });
    menu.addItem((item) => item.setTitle('Set custom value...').setIcon('pencil').onClick(() => this.openStackedTextEditor(entries, prop)));
    const options = getEffectivePropertyOptions(this.app, prop);
    if (options.length) menu.addSeparator();
    for (const option of options) {
      menu.addItem((item) => {
        checkedItems.push({ item, value: option });
        item.setTitle(option).setChecked(current === option).onClick(async () => {
          setCheckedValue(option);
          this.setEntryFrontmatterValue(entries, key, option);
          this.refreshStackedPropertyValue(anchor, entries, prop);
          await this.plugin.bulkEditService.updateFrontmatter(files, { [key]: option });
          await this.afterStackedPropertyEdit(files, [key], false);
        });
      });
    }
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
  }

  private openStackedTextEditor(entries: any[], prop: any): void {
    const key = String(prop?.key || '').trim();
    if (!key) return;
    const current = this.formatStackedPropertyValue(this.getFrontmatterValueCaseInsensitive(entries[0]?.frontmatter || {}, key));
    new TextInputModal(this.app, String(prop?.label || key), current, async (value) => {
      const next = String(value ?? '').trim();
      const files = this.filesFromEntries(entries);
      if (!next) {
        this.removeEntryFrontmatterValue(entries, key);
        await this.plugin.bulkEditService.removeFrontmatterKey(files, key);
        await this.afterStackedPropertyEdit(files, [key]);
        return;
      }
      this.setEntryFrontmatterValue(entries, key, next);
      await this.plugin.bulkEditService.updateFrontmatter(files, { [key]: next });
      await this.afterStackedPropertyEdit(files, [key]);
    }).open();
  }

  private async toggleStackedBooleanProperty(entries: any[], prop: any): Promise<void> {
    const key = String(prop?.key || '').trim();
    if (!key) return;
    const next = this.getFrontmatterValueCaseInsensitive(entries[0]?.frontmatter || {}, key) !== true;
    const files = this.filesFromEntries(entries);
    this.setEntryFrontmatterValue(entries, key, next);
    await this.plugin.bulkEditService.updateFrontmatter(files, { [key]: next });
    await this.afterStackedPropertyEdit(files, [key]);
  }

  private filesFromEntries(entries: any[]): TFile[] {
    const files: TFile[] = [];
    const seen = new Set<string>();
    for (const entry of entries || []) {
      const file = entry?.file;
      if (!(file instanceof TFile) || seen.has(file.path)) continue;
      seen.add(file.path);
      files.push(file);
    }
    return files;
  }

  private setEntryFrontmatterValue(entries: any[], key: string, value: any): void {
    for (const entry of entries || []) {
      if (!entry.frontmatter || typeof entry.frontmatter !== 'object') entry.frontmatter = {};
      this.setFrontmatterValueCaseInsensitive(entry.frontmatter, key, value);
    }
  }

  private hasFrontmatterKeyCaseInsensitive(frontmatter: Record<string, any>, key: string): boolean {
    if (!frontmatter || !key) return false;
    if (key in frontmatter && frontmatter[key] !== undefined) return true;
    const lowerKey = key.toLowerCase();
    return Object.keys(frontmatter).some((candidate) => candidate.toLowerCase() === lowerKey && frontmatter[candidate] !== undefined);
  }

  private removeEntryFrontmatterValue(entries: any[], key: string): void {
    for (const entry of entries || []) {
      const frontmatter = entry?.frontmatter;
      if (!frontmatter || typeof frontmatter !== 'object') continue;
      const match = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      if (match) delete frontmatter[match];
    }
  }

  private refreshStackedPropertyValue(target: HTMLElement, entries: any[], prop: any): void {
    target.empty();
    this.populateStackedPropertyValue(target, entries, prop, (entries?.[0]?.frontmatter || {}) as Record<string, any>);
  }

  private async afterStackedPropertyEdit(files: TFile[], changedKeys: string[], refreshMenus = true): Promise<void> {
    await Promise.all(files.map((file) => this.plugin.notebookNavigatorRuleService.applyRulesToFile(file, {
      reason: 'whole-note-inline-property-edit',
      force: true,
      bypassCreationGrace: true,
    })));
    if (refreshMenus) {
      for (const file of files) this.plugin.persistentMenuManager?.refreshMenusForFile(file, true);
    } else {
      logger.flow('PropertySelector', 'refresh:await-metadata-cache', { files: files.length, changedKeys });
    }
    void this.plugin.viewModeManager?.handlePotentialFrontmatterChange(files, changedKeys);
  }

  private populateStackedPropertyValue(
    target: HTMLElement,
    entries: any[],
    prop: any,
    frontmatter: Record<string, any>,
    healthMetricConfigs = this.getHealthMetricRenderConfigs(),
  ): void {
    const propId = String(prop?.id || '').toLowerCase();
    const propKey = String(prop?.key || '').trim();
    const propKeyLower = propKey.toLowerCase();

    if (propId === 'status' || propKeyLower === 'status') {
      target.appendChild(this.createStatusChip(entries, prop));
      return;
    }

    if (propId === 'priority' || propKeyLower === 'priority') {
      target.appendChild(this.createPriorityChip(entries, prop));
      return;
    }

    if (prop.type === 'datetime' || propKeyLower === 'scheduled' || propKeyLower === 'date') {
      target.appendChild(this.createDateChip(entries, prop));
      return;
    }

    if (propId === 'tags' || propKeyLower === 'tags' || propKeyLower === 'tag') {
      target.appendChild(this.createTagsChip(entries, prop));
      const tags = this.extractNormalizedTags(entries);
      for (const tag of tags) {
        target.appendChild(this.createTagValueChip(tag, entries));
      }
      return;
    }

    if (propId === 'type' || prop.type === 'folder') {
      target.appendChild(this.createFolderChip(entries));
      return;
    }

    if (prop.type === 'list' && isLinkListProperty(prop)) {
      const raw = propKey ? this.getFrontmatterValueCaseInsensitive(frontmatter, propKey) : undefined;
      const links = parseLinkListInput(raw);
      for (const link of links) {
        target.appendChild(this.createLinkValueChip(link, entries, prop));
      }
      target.appendChild(this.createAddLinkChip(entries, prop));
      return;
    }

    const raw = propKey ? this.getFrontmatterValueCaseInsensitive(frontmatter, propKey) : undefined;
    const healthMetric = propKey ? this.getHealthMetricRenderConfig(propKey, healthMetricConfigs) : null;
    const numericValue = this.toFiniteNumber(raw);
    if (healthMetric && numericValue !== null) {
      target.appendChild(this.createHealthMetricPropertyValue(numericValue, healthMetric));
      return;
    }

    const text = this.formatStackedPropertyValue(raw);
    const value = document.createElement('span');
    value.className = text ? 'tps-gcm-top-property-text' : 'tps-gcm-top-property-empty';
    this.populateTextOrWebLink(value, raw, text || 'Empty');
    target.appendChild(value);
  }

  private populateTextOrWebLink(target: HTMLElement, raw: unknown, fallbackText: string): void {
    const webLink = extractWebLink(raw) || extractWebLink(fallbackText);
    if (!webLink) {
      target.textContent = fallbackText;
      return;
    }
    const link = document.createElement('a');
    link.className = 'tps-gcm-property-link tps-gcm-external-link';
    link.href = webLink.url;
    link.textContent = webLink.label;
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    addSafeClickListener(link, (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.open(webLink.url, '_blank', 'noopener,noreferrer');
    });
    target.appendChild(link);
  }

  private getHealthMetricRenderConfig(
    propKey: string,
    configs = this.getHealthMetricRenderConfigs(),
  ): Readonly<TPSHealthUiMetricRenderConfig> | null {
    const normalizedKey = String(propKey || '').trim().toLowerCase();
    if (!normalizedKey) return null;
    return configs.find((config) => config.propertyKey.toLowerCase() === normalizedKey) ?? null;
  }

  private getHealthMetricRenderConfigs(): readonly Readonly<TPSHealthUiMetricRenderConfig>[] {
    const api = this.plugin.getHealthUiApi();
    if (!api) return [];
    try {
      return api.getMetricRenderConfigs();
    } catch (error) {
      logger.warn('Failed to resolve TPS Health metric configs', error);
      return [];
    }
  }

  private withHealthMetricProperties(
    properties: any[],
    frontmatter: Record<string, any>,
    configs = this.getHealthMetricRenderConfigs(),
  ): any[] {
    if (configs.length === 0) return properties;

    const configuredKeys = new Set((this.plugin.settings.properties || []).map((prop) => String(prop?.key || '').toLowerCase()).filter(Boolean));
    const existingKeys = new Set(properties.map((prop) => String(prop?.key || '').toLowerCase()).filter(Boolean));
    const next = [...properties];
    for (const config of configs) {
      const key = String(config?.propertyKey || '').trim();
      if (!key || configuredKeys.has(key.toLowerCase()) || existingKeys.has(key.toLowerCase())) continue;
      const raw = this.getFrontmatterValueCaseInsensitive(frontmatter, key);
      if (this.toFiniteNumber(raw) === null) continue;
      next.push({
        id: `tps-health-${key}`,
        key,
        label: config.label || key,
        type: 'number',
        icon: 'activity',
      });
      existingKeys.add(key.toLowerCase());
    }
    return next;
  }

  private createHealthMetricPropertyValue(value: number, metric: Readonly<TPSHealthUiMetricRenderConfig>): HTMLElement {
    const display = this.getHealthMetricDisplay(value, metric);
    const roundedValue = this.roundHealthMetricValue(value);
    const goalText = this.formatHealthMetricGoalText(metric);
    const stateText = this.formatHealthMetricStateText(display.state);
    const wrapper = document.createElement('span');
    wrapper.className = `tps-gcm-health-metric tps-gcm-health-metric--${display.state}`;
    wrapper.style.setProperty('--tps-gcm-health-progress', `${display.visualPercent}%`);
    wrapper.style.setProperty('--tps-gcm-health-color', display.color);
    wrapper.setAttribute('data-tps-health-state', display.state);
    wrapper.setAttribute('aria-label', `${metric.label}: ${roundedValue} ${metric.unit}${goalText ? ` ${goalText}` : ''}${stateText ? `, ${stateText}` : ''}`);

    const ring = wrapper.createSpan({ cls: 'tps-gcm-health-metric-ring' });
    ring.createSpan({ cls: 'tps-gcm-health-metric-percent', text: display.labelPercent });

    const text = wrapper.createSpan({ cls: 'tps-gcm-health-metric-text' });
    text.createSpan({ cls: 'tps-gcm-health-metric-value', text: `${roundedValue}` });
    text.createSpan({ cls: 'tps-gcm-health-metric-goal', text: goalText ? ` ${goalText}` : ` ${metric.unit}` });
    return wrapper;
  }

  private getHealthMetricDisplay(value: number, metric: Readonly<TPSHealthUiMetricRenderConfig>): TPSHealthMetricDisplay {
    const min = this.finiteHealthMetricNumber(metric.min);
    const max = this.finiteHealthMetricNumber(metric.max);
    const goal = this.getHealthMetricProgressGoal(metric);
    const percent = goal > 0 ? Math.round((value / goal) * 100) : 0;
    const state = this.getHealthMetricState(value, metric, min, max);
    return {
      state,
      visualPercent: Math.max(0, Math.min(100, percent)),
      labelPercent: goal > 0 ? `${percent}%` : '--',
      color: this.getHealthMetricStateColor(state, metric),
    };
  }

  private getHealthMetricState(
    value: number,
    metric: Readonly<TPSHealthUiMetricRenderConfig>,
    min = this.finiteHealthMetricNumber(metric.min),
    max = this.finiteHealthMetricNumber(metric.max),
  ): TPSHealthMetricState {
    if (metric.kind === 'counter') return 'neutral';
    const hasMin = min !== null;
    const hasMax = max !== null;
    if (hasMin && hasMax) {
      if (value < Math.min(min, max)) return 'under';
      if (value > Math.max(min, max)) return 'over';
      return 'good';
    }
    if (hasMax) return value > max ? 'over' : 'good';
    if (hasMin) return value < min ? 'under' : 'good';
    return 'neutral';
  }

  private getHealthMetricStateColor(state: TPSHealthMetricState, metric: Readonly<TPSHealthUiMetricRenderConfig>): string {
    if (state === 'good') return 'var(--color-green)';
    if (state === 'under' || state === 'over') return 'var(--color-red)';
    return metric.color || 'var(--interactive-accent)';
  }

  private getHealthMetricProgressGoal(metric: Readonly<TPSHealthUiMetricRenderConfig>): number {
    const min = this.finiteHealthMetricNumber(metric.min);
    const max = this.finiteHealthMetricNumber(metric.max);
    if (metric.kind === 'counter') return 0;
    if (min !== null && max !== null) return Math.max(min, max, 0);
    if (max !== null && max > 0) return max;
    if (min !== null && min > 0) return min;
    const goal = this.finiteHealthMetricNumber(metric.goal);
    return goal && goal > 0 ? goal : 0;
  }

  private formatHealthMetricStateText(state: TPSHealthMetricState): string {
    if (state === 'good') return 'in target';
    if (state === 'under') return 'under target';
    if (state === 'over') return 'over target';
    return '';
  }

  private finiteHealthMetricNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private formatHealthMetricGoalText(metric: Readonly<TPSHealthUiMetricRenderConfig>): string {
    const unit = metric.unit || '';
    const min = this.finiteHealthMetricNumber(metric.min);
    const max = this.finiteHealthMetricNumber(metric.max);
    if (metric.kind === 'counter') return unit;
    if (min !== null && max !== null) {
      return `/ ${this.roundHealthMetricValue(Math.min(min, max))}-${this.roundHealthMetricValue(Math.max(min, max))} ${unit}`.trim();
    }
    if (max !== null) {
      return `/ max ${this.roundHealthMetricValue(max)} ${unit}`.trim();
    }
    if (min !== null) {
      return `/ min ${this.roundHealthMetricValue(min)} ${unit}`.trim();
    }
    if (Number.isFinite(metric.goal)) return `/ ${this.roundHealthMetricValue(Number(metric.goal))} ${unit}`.trim();
    return unit;
  }

  private toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  private roundHealthMetricValue(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private getStackedPropertyIcon(prop: any): string {
    const propId = String(prop?.id || '').toLowerCase();
    const propKey = String(prop?.key || '').toLowerCase();
    if (prop?.icon) return prop.icon;
    if (propId === 'status' || propKey === 'status') return 'list';
    if (propId === 'priority' || propKey === 'priority') return 'flag';
    if (prop?.type === 'datetime' || propKey === 'scheduled' || propKey === 'date') return 'clock';
    if (propId === 'tags' || propKey === 'tags' || propKey === 'tag') return 'tags';
    if (prop?.type === 'list' && isLinkListProperty(prop)) return 'link';
    if (prop?.type === 'folder') return 'folder';
    if (prop?.type === 'checkbox' || prop?.type === 'boolean') return 'square-check';
    if (prop?.type === 'recurrence') return 'repeat';
    return 'list';
  }

  private createGenericContextPropertyChip(entries: any[], prop: any, frontmatter: Record<string, any>): HTMLElement | null {
    const key = String(prop?.key || '').trim();
    if (!key) return null;

    const raw = this.getFrontmatterValueCaseInsensitive(frontmatter, key);
    const text = this.formatStackedPropertyValue(raw);
    if (!text) return null;

    const chip = document.createElement('div');
    chip.className = 'tps-gcm-chip tps-gcm-chip--generic-property';
    chip.tabIndex = 0;
    chip.setAttribute('role', 'button');
    chip.setAttribute('aria-label', `Edit ${String(prop?.label || key)}: ${text}`);

    const icon = document.createElement('span');
    icon.className = 'tps-gcm-chip-icon';
    setIcon(icon, this.getStackedPropertyIcon(prop));
    chip.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tps-gcm-chip-label';
    const webLink = extractWebLink(raw);
    if (webLink) {
      label.textContent = `${String(prop?.label || key)}: `;
      const link = document.createElement('a');
      link.className = 'tps-gcm-property-link tps-gcm-external-link';
      link.href = webLink.url;
      link.textContent = webLink.label;
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      addSafeClickListener(link, (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.open(webLink.url, '_blank', 'noopener,noreferrer');
      });
      label.appendChild(link);
    } else {
      label.textContent = `${String(prop?.label || key)}: ${text}`;
    }
    chip.appendChild(label);

    if (this.isStackedPropertyEditable(prop)) {
      addSafeClickListener(chip, (event) => {
        event.stopPropagation();
        this.openStackedPropertyEditor(chip, entries, prop);
      });
      chip.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.openStackedPropertyEditor(chip, entries, prop);
      });
    }

    return chip;
  }

  private createLinkValueChip(link: string, entries: any[], prop: any): HTMLElement {
    const chip = document.createElement('div');
    chip.className = 'tps-gcm-chip tps-gcm-chip--link-value';

    const icon = document.createElement('span');
    icon.className = 'tps-gcm-chip-icon';
    setIcon(icon, 'link');
    chip.appendChild(icon);

    const webLink = extractWebLink(link);
    const displayText = webLink?.label || this.getLinkListDisplayText(link);
    const label = document.createElement('a');
    label.className = webLink ? 'tps-gcm-chip-label tps-gcm-external-link' : 'tps-gcm-chip-label internal-link';
    label.textContent = displayText;
    if (webLink) {
      label.href = webLink.url;
      label.setAttribute('target', '_blank');
      label.setAttribute('rel', 'noopener noreferrer');
    } else {
      this.configureInternalLink(label, link);
    }
    label.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (webLink) {
        window.open(webLink.url, '_blank', 'noopener,noreferrer');
        return;
      }
      const file = this.resolveLinkListValueToFile(link);
      if (file) void this.plugin.openFileInLeaf(file, false, () => this.app.workspace.getLeaf(false), { revealLeaf: true });
    });
    chip.appendChild(label);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'tps-gcm-chip-tag-remove tps-gcm-link-chip-remove';
    removeButton.title = `Remove ${displayText}`;
    removeButton.setAttribute('aria-label', removeButton.title);
    setIcon(removeButton, 'x');
    removeButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const files = entries.map((entry: any) => entry.file).filter((file: any) => file instanceof TFile);
      await this.plugin.bulkEditService.removeListValues(files, link, prop.key);
      chip.remove();
    });
    chip.appendChild(removeButton);

    addSafeClickListener(chip, () => {
      if (webLink) {
        window.open(webLink.url, '_blank', 'noopener,noreferrer');
        return;
      }
      const file = this.resolveLinkListValueToFile(link);
      if (file) void this.plugin.openFileInLeaf(file, false, () => this.app.workspace.getLeaf(false), { revealLeaf: true });
    });

    return chip;
  }

  private createAddLinkChip(entries: any[], prop: any): HTMLElement {
    const chip = document.createElement('div');
    chip.className = 'tps-gcm-chip tps-gcm-chip--add-link';

    const icon = document.createElement('span');
    icon.className = 'tps-gcm-chip-icon';
    setIcon(icon, 'plus');
    chip.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tps-gcm-chip-label';
    label.textContent = 'Add Link';
    chip.appendChild(label);

    addSafeClickListener(chip, () => {
      this.delegates.openAddListValueModal(entries, prop.key, prop.label || prop.key || 'Link');
    });

    return chip;
  }

  private resolveLinkListValueToFile(value: string): TFile | null {
    const inner = String(value || '').trim().match(/^\[\[([^\]]+)\]\]$/)?.[1] || String(value || '').trim();
    const target = inner.split('|')[0]?.trim() || '';
    if (!target) return null;
    const direct = this.app.vault.getAbstractFileByPath(target.endsWith('.md') ? target : `${target}.md`);
    if (direct instanceof TFile && direct.extension.toLowerCase() === 'md') return direct;
    const resolved = this.app.metadataCache.getFirstLinkpathDest(target.replace(/\.md$/i, ''), '');
    return resolved instanceof TFile && resolved.extension.toLowerCase() === 'md' ? resolved : null;
  }

  private getLinkListDisplayText(value: string): string {
    const file = this.resolveLinkListValueToFile(value);
    if (file) {
      const title = String(this.app.metadataCache.getFileCache(file)?.frontmatter?.title || '').trim();
      if (title) return title;
    }
    return getWikilinkDisplayText(value);
  }

  private configureInternalLink(anchor: HTMLAnchorElement, value: string): void {
    const file = this.resolveLinkListValueToFile(value);
    const target = file?.path || String(value || '').replace(/^\[\[|\]\]$/g, '').split('|')[0]?.trim() || '';
    anchor.href = target || '#';
    anchor.setAttribute('data-href', target);
    if (file) anchor.setAttribute('data-path', file.path);
  }

  private formatStackedPropertyValue(value: any): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
      return value
        .map((item) => this.formatStackedPropertyValue(item))
        .filter(Boolean)
        .join(', ');
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value).trim();
  }

  createStatusChip(entries: any[], resolvedProp: any): HTMLElement {
    const fm = entries[0].frontmatter;
    const statusKey = String(resolvedProp?.key || 'status').trim() || 'status';
    const statusRaw = this.getFrontmatterValueCaseInsensitive(fm, statusKey);
    const rawStatus = Array.isArray(statusRaw)
      ? String(statusRaw.find((value) => String(value ?? '').trim()) ?? '').trim()
      : String(statusRaw ?? '').trim();
    const currentStatus = this.normalizeStatusDisplayValue(rawStatus);
    const hasStatus = !!currentStatus;

    const chip = document.createElement('div');
    chip.className = 'tps-gcm-chip';

    const icon = document.createElement('span');
    icon.className = 'tps-gcm-chip-icon';
    setIcon(icon, hasStatus ? this.getStatusIcon(currentStatus) : 'circle');
    chip.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tps-gcm-chip-label';
    label.textContent = hasStatus ? this.formatStatusLabel(currentStatus) : 'No Status';
    chip.appendChild(label);

    if (resolvedProp?.disabled) {
      chip.classList.add('tps-gcm-chip-disabled');
      chip.title = "Cannot edit mixed status values";
      return chip;
    }

    const options = resolvedProp?.options;

    addSafeClickListener(chip, (e) => {
      this.propertyRowService.openStatusSubmenu(chip, entries, (newVal) => {
        // Optimistic update
        const normalized = this.normalizeStatusDisplayValue(newVal);
        label.textContent = normalized ? this.formatStatusLabel(normalized) : 'No Status';
        setIcon(icon, normalized ? this.getStatusIcon(normalized) : 'circle');
      }, options, async (files) => {
        // Apply GCM-owned Notebook Navigator rules to update icon/color outputs.
        for (const file of files) {
          await applyNotebookNavigatorRulesToFile(this.plugin, file);
        }
      });
    });

    return chip;
  }

  getStatusIcon(status: string): string {
    switch (this.normalizeStatusDisplayValue(status)) {
      case 'complete': return 'circle-check';
      case 'working': return 'loader';
      case 'holding': return 'circle-help';
      case 'blocked': return 'circle-alert';
      case 'wont-do': return 'circle-x';
      case 'todo': return 'circle';
      default: return 'circle';
    }
  }

  private normalizeStatusDisplayValue(raw: unknown): string {
    const value = String(raw ?? '').trim();
    if (!value) return '';
    const shared = this.plugin.sharedServices?.status;
    if (/^\[[^\]]*]$/.test(value) || /^[xX/?\\\-\s]$/.test(value)) {
      if (shared?.checkboxStateToStatus) return shared.checkboxStateToStatus(value);
      const marker = getCheckboxStateMarker(normalizeCheckboxStateToken(value));
      if (marker === 'x') return 'complete';
      if (marker === '/' || marker === '\\') return 'working';
      if (marker === '?') return 'holding';
      if (marker === '-') return 'wont-do';
      return 'todo';
    }
    return shared?.normalize?.(value) || value.toLowerCase();
  }

  private formatStatusLabel(status: string): string {
    if (status === 'wont-do') return 'wont-do';
    return status;
  }

  createPriorityChip(entries: any[], resolvedProp: any): HTMLElement {
    const fm = entries[0].frontmatter;
    const priorityKey = String(resolvedProp?.key || 'priority').trim() || 'priority';
    const priorityRaw = this.getFrontmatterValueCaseInsensitive(fm, priorityKey);
    const currentPrio = typeof priorityRaw === 'string' ? priorityRaw.trim() : '';
    const hasPriority = !!currentPrio;

    const chip = document.createElement('div');
    chip.className = 'tps-gcm-chip';

    const icon = document.createElement('span');
    icon.className = 'tps-gcm-chip-icon';
    setIcon(icon, 'flag');
    chip.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tps-gcm-chip-label';
    label.textContent = hasPriority ? currentPrio : 'No Priority';
    chip.appendChild(label);

    if (resolvedProp?.disabled) {
      chip.classList.add('tps-gcm-chip-disabled');
      chip.title = "Cannot edit mixed priority values";
      return chip;
    }

    addSafeClickListener(chip, (e) => {
      this.propertyRowService.openPrioritySubmenu(chip, entries, (newVal) => {
        label.textContent = newVal || 'No Priority';
      }, getEffectivePropertyOptions(this.app, resolvedProp), priorityKey);
    });

    return chip;
  }

  createDateChip(entries: any[], resolvedProp: any): HTMLElement {
    const fm = entries[0].frontmatter;
    const dateKey = String(resolvedProp?.key || 'scheduled').trim() || 'scheduled';
    const primaryDateVal = this.getFrontmatterValueCaseInsensitive(fm, dateKey);
    const shouldUseDefaultDateFallback = dateKey.toLowerCase() === 'scheduled' || dateKey.toLowerCase() === 'date';
    const dateVal = primaryDateVal
      ?? (shouldUseDefaultDateFallback ? this.getFrontmatterValueCaseInsensitive(fm, 'scheduled') : undefined)
      ?? (shouldUseDefaultDateFallback ? this.getFrontmatterValueCaseInsensitive(fm, 'date') : undefined)
      ?? null;

    const chip = document.createElement('div');
    chip.className = 'tps-gcm-chip';

    const icon = document.createElement('span');
    icon.className = 'tps-gcm-chip-icon';
    setIcon(icon, 'calendar');
    chip.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tps-gcm-chip-label';
    label.textContent = dateVal ? this.delegates.formatDatetimeDisplay(dateVal) : 'No Date';
    chip.appendChild(label);

    if (resolvedProp?.disabled) {
      chip.classList.add('tps-gcm-chip-disabled');
      chip.title = "Cannot edit mixed date values";
      return chip;
    }

    addSafeClickListener(chip, (e) => {
      this.delegates.openScheduledModal(entries, dateKey);
    });

    return chip;
  }

  createTagsChip(entries: any[], resolvedProp: any): HTMLElement {
    const chip = document.createElement('div');
    chip.className = 'tps-gcm-chip';

    const icon = document.createElement('span');
    icon.className = 'tps-gcm-chip-icon';
    setIcon(icon, 'tag');
    chip.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tps-gcm-chip-label';
    label.textContent = 'Add Tag';
    chip.appendChild(label);

    if (resolvedProp?.disabled) {
      chip.classList.add('tps-gcm-chip-disabled');
      chip.title = "Cannot edit mixed tag values";
      return chip;
    }

    addSafeClickListener(chip, (e) => {
      this.delegates.openAddTagModal(entries);
    });

    return chip;
  }

  private extractNormalizedTags(entries: any[]): string[] {
    const entry = entries?.[0];
    const fm = (entry?.frontmatter || {}) as Record<string, any>;
    const tags = parseTagInput([fm.tags, fm.tag]);
    return Array.from(new Set(tags.map((tag) => normalizeTagValue(tag)).filter(Boolean)));
  }

  private createTagValueChip(tag: string, entries: any[]): HTMLElement {
    const normalizedTag = normalizeTagValue(tag);
    const chip = document.createElement('div');
    chip.className = 'tps-gcm-chip tps-gcm-chip--tag-value';
    this.applyNotebookNavigatorTagStyle(chip, normalizedTag);

    const icon = document.createElement('span');
    icon.className = 'tps-gcm-chip-icon';
    setIcon(icon, 'tag');
    chip.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tps-gcm-chip-label';
    label.textContent = `#${normalizedTag}`;
    chip.appendChild(label);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'tps-gcm-chip-tag-remove';
    removeButton.title = `Remove #${normalizedTag}`;
    removeButton.setAttribute('aria-label', `Remove #${normalizedTag}`);
    removeButton.style.color = 'currentColor';
    setIcon(removeButton, 'x');
    removeButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!normalizedTag) return;
      void this.plugin.bulkEditService.removeTag(
        entries.map((entry: any) => entry.file),
        normalizedTag,
        'tags'
      );
      chip.remove();
    });
    chip.appendChild(removeButton);

    addSafeClickListener(chip, () => {
      if (!normalizedTag) return;
      this.plugin.menuController?.triggerTagSearch(normalizedTag);
    });

    return chip;
  }

  private applyNotebookNavigatorTagStyle(chip: HTMLElement, normalizedTag: string): void {
    if (this.plugin.settings.inheritNotebookNavigatorTagColors === false) {
      chip.style.removeProperty('background');
      chip.style.removeProperty('background-color');
      chip.style.removeProperty('background-image');
      chip.style.removeProperty('color');
      chip.style.removeProperty('border');
      return;
    }

    const fallbackBackground = 'var(--nn-theme-file-tag-bg, var(--background-secondary-alt))';
    const fallbackText = 'var(--nn-theme-file-tag-color, var(--text-normal))';
    const fallbackBorder = 'var(--nn-theme-file-pill-border-color, var(--background-modifier-border))';

    chip.style.background = fallbackBackground;
    chip.style.color = fallbackText;
    chip.style.border = `1px solid ${fallbackBorder}`;

    if (!normalizedTag) return;

    const pluginApi: any = (this.app as any)?.plugins;
    const nnCandidates = Object.values(pluginApi?.plugins || {}) as any[];
    const nn: any =
      pluginApi?.plugins?.['notebook-navigator'] ??
      pluginApi?.getPlugin?.('notebook-navigator') ??
      nnCandidates.find((candidate) => String(candidate?.manifest?.id || '').trim() === 'notebook-navigator') ??
      nnCandidates.find((candidate) => String(candidate?.manifest?.name || '').trim().toLowerCase() === 'notebook navigator');
    const settings = nn?.settings ?? nn?.settingsController?.settings ?? nn?.api?.settings ?? null;

    const renderedColor = this.getNotebookNavigatorRenderedTagColor(normalizedTag);
    if (renderedColor) {
      chip.style.color = renderedColor;
      chip.style.backgroundColor = 'var(--nn-theme-file-tag-bg, transparent)';
      chip.style.backgroundImage = 'none';
      chip.style.border = '1px solid color-mix(in srgb, currentColor 30%, transparent)';
      return;
    }

    const keyCandidates = Array.from(new Set([
      normalizedTag,
      normalizedTag.toLowerCase(),
      `#${normalizedTag}`,
      `#${normalizedTag.toLowerCase()}`,
    ]));

    const colorMap = (settings?.tagColors && typeof settings.tagColors === 'object')
      ? settings.tagColors as Record<string, string>
      : {};
    const backgroundMap = (settings?.tagBackgroundColors && typeof settings.tagBackgroundColors === 'object')
      ? settings.tagBackgroundColors as Record<string, string>
      : {};

    const customColor = keyCandidates.map((k) => String(colorMap[k] || '').trim()).find(Boolean) || '';
    const customBackground = keyCandidates.map((k) => String(backgroundMap[k] || '').trim()).find(Boolean) || '';

    if (customBackground) {
      chip.style.backgroundColor = 'var(--nn-theme-nav-bg, var(--background-primary))';
      chip.style.backgroundImage = `linear-gradient(${customBackground}, ${customBackground})`;
      if (!customColor) {
        chip.style.color = 'var(--nn-theme-file-tag-custom-color-text-color, var(--text-normal))';
      }
    }
    if (customColor) {
      chip.style.color = customColor;
      if (!customBackground) {
        chip.style.backgroundColor = 'var(--nn-theme-file-tag-bg, transparent)';
        chip.style.backgroundImage = 'none';
      }
    }
    if (customBackground || customColor) {
      chip.style.border = '1px solid color-mix(in srgb, currentColor 30%, transparent)';
      return;
    }

    const apiColor = this.getNotebookNavigatorTagColorFromApi(normalizedTag, nn);
    if (apiColor) {
      chip.style.color = apiColor;
      chip.style.backgroundColor = 'var(--nn-theme-file-tag-bg, transparent)';
      chip.style.backgroundImage = 'none';
      chip.style.border = '1px solid color-mix(in srgb, currentColor 30%, transparent)';
      return;
    }

    const rainbowColor = this.resolveNotebookNavigatorRainbowTagColor(normalizedTag, settings);
    if (rainbowColor) {
      chip.style.color = rainbowColor;
      chip.style.backgroundColor = 'var(--nn-theme-file-tag-bg, transparent)';
      chip.style.backgroundImage = 'none';
      chip.style.border = '1px solid color-mix(in srgb, currentColor 30%, transparent)';
    }
  }

  private resolveNotebookNavigatorRainbowTagColor(normalizedTag: string, settings: any): string {
    if (!normalizedTag) {
      return '';
    }

    if (settings && settings.inheritTagColors === false) {
      return '';
    }

    const activeProfileName = String(settings?.vaultProfile || '').trim();
    const profiles = Array.isArray(settings?.vaultProfiles) ? settings.vaultProfiles : [];
    const activeProfile = profiles.find((profile: any) => String(profile?.name || '').trim() === activeProfileName);
    const navRainbow = activeProfile?.navRainbow;
    const tagRainbow = navRainbow?.tags;

    const rainbowEnabled = tagRainbow ? tagRainbow.enabled !== false : true;
    if (!rainbowEnabled) return '';

    const firstColor = this.parseHexColor(String(tagRainbow?.firstColor || '#ef4444').trim());
    const lastColor = this.parseHexColor(String(tagRainbow?.lastColor || '#8b5cf6').trim());
    if (!firstColor || !lastColor) {
      return '';
    }

    const ratio = this.getNotebookNavigatorRainbowRatio(normalizedTag, settings);
    const transitionStyle = String(tagRainbow?.transitionStyle || 'hue').toLowerCase();
    const color = transitionStyle === 'rgb'
      ? this.interpolateRgb(firstColor, lastColor, ratio)
      : this.interpolateHue(firstColor, lastColor, ratio);
    return this.formatHexColor(color);
  }

  private getNotebookNavigatorRainbowRatio(normalizedTag: string, settings?: any): number {
    const metadataCacheAny = this.app.metadataCache as any;
    const tagMap = typeof metadataCacheAny?.getTags === 'function'
      ? metadataCacheAny.getTags()
      : {};
    const entries = Object.entries(tagMap || {})
      .map(([rawTag, rawCount]) => ({
        tag: normalizeTagValue(String(rawTag || '')),
        count: Number(rawCount || 0),
      }))
      .filter((entry) => !!entry.tag);

    if (!entries.some((entry) => entry.tag === normalizedTag)) {
      entries.push({ tag: normalizedTag, count: 0 });
    }

    const sortOrder = String(settings?.tagSortOrder || settings?.defaultTagSort || 'alpha-asc').trim().toLowerCase();
    entries.sort((a, b) => {
      switch (sortOrder) {
        case 'frequency-desc': {
          const delta = b.count - a.count;
          return delta !== 0 ? delta : a.tag.localeCompare(b.tag);
        }
        case 'frequency-asc': {
          const delta = a.count - b.count;
          return delta !== 0 ? delta : a.tag.localeCompare(b.tag);
        }
        case 'alpha-desc':
          return b.tag.localeCompare(a.tag);
        case 'alpha-asc':
        default:
          return a.tag.localeCompare(b.tag);
      }
    });

    const tags = entries.map((entry) => entry.tag);
    if (tags.length <= 1) {
      return this.getDeterministicTagRatio(normalizedTag);
    }
    const index = Math.max(0, tags.indexOf(normalizedTag));
    return index / Math.max(1, tags.length - 1);
  }

  private getDeterministicTagRatio(tag: string): number {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
      hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
    }
    return (Math.abs(hash) % 1000) / 999;
  }

  private parseHexColor(value: string): { r: number; g: number; b: number } | null {
    const raw = value.trim();
    const short = /^#([0-9a-f]{3})$/i.exec(raw);
    if (short) {
      const [r, g, b] = short[1].split('').map((digit) => parseInt(digit + digit, 16));
      return { r, g, b };
    }

    const full = /^#([0-9a-f]{6})$/i.exec(raw);
    if (!full) return null;
    const hex = full[1];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  private interpolateRgb(
    start: { r: number; g: number; b: number },
    end: { r: number; g: number; b: number },
    ratio: number,
  ): { r: number; g: number; b: number } {
    const t = Math.max(0, Math.min(1, ratio));
    return {
      r: Math.round(start.r + (end.r - start.r) * t),
      g: Math.round(start.g + (end.g - start.g) * t),
      b: Math.round(start.b + (end.b - start.b) * t),
    };
  }

  private interpolateHue(
    start: { r: number; g: number; b: number },
    end: { r: number; g: number; b: number },
    ratio: number,
  ): { r: number; g: number; b: number } {
    const t = Math.max(0, Math.min(1, ratio));
    const startHsl = this.rgbToHsl(start.r, start.g, start.b);
    const endHsl = this.rgbToHsl(end.r, end.g, end.b);

    let hueDelta = endHsl.h - startHsl.h;
    if (Math.abs(hueDelta) > 180) {
      hueDelta -= Math.sign(hueDelta) * 360;
    }
    const h = (startHsl.h + hueDelta * t + 360) % 360;
    const s = startHsl.s + (endHsl.s - startHsl.s) * t;
    const l = startHsl.l + (endHsl.l - startHsl.l) * t;
    return this.hslToRgb(h, s, l);
  }

  private rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;

    if (max === min) {
      return { h: 0, s: 0, l };
    }

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
    return { h, s, l };
  }

  private hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    const hue = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = l - c / 2;
    let rp = 0;
    let gp = 0;
    let bp = 0;

    if (hue < 60) {
      rp = c; gp = x; bp = 0;
    } else if (hue < 120) {
      rp = x; gp = c; bp = 0;
    } else if (hue < 180) {
      rp = 0; gp = c; bp = x;
    } else if (hue < 240) {
      rp = 0; gp = x; bp = c;
    } else if (hue < 300) {
      rp = x; gp = 0; bp = c;
    } else {
      rp = c; gp = 0; bp = x;
    }

    return {
      r: Math.round((rp + m) * 255),
      g: Math.round((gp + m) * 255),
      b: Math.round((bp + m) * 255),
    };
  }

  private formatHexColor(color: { r: number; g: number; b: number }): string {
    const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
  }

  private getNotebookNavigatorTagColorFromApi(normalizedTag: string, nn: any): string {
    const candidates = [
      nn?.api?.navigation?.getTagColor,
      nn?.api?.getTagColor,
      nn?.getTagColor,
    ].filter((candidate): candidate is Function => typeof candidate === 'function');
    const args = Array.from(new Set([
      normalizedTag,
      normalizedTag.toLowerCase(),
      `#${normalizedTag}`,
      `#${normalizedTag.toLowerCase()}`,
    ]));
    for (const fn of candidates) {
      for (const arg of args) {
        try {
          const value = String(fn.call(nn, arg) || '').trim();
          if (value && this.isValidCssColor(value)) {
            return value;
          }
        } catch {
          // Best effort.
        }
      }
    }
    return '';
  }

  private getNotebookNavigatorRenderedTagColor(normalizedTag: string): string {
    if (typeof document === 'undefined' || !normalizedTag) {
      return '';
    }

    const rows = Array.from(
      document.querySelectorAll(
        '.nn-navitem[data-nav-item-type="tag"], .nn-navitem[data-drop-zone="tag"], .nn-file-tag, [data-tag], [data-tag-name]',
      ),
    );
    for (const row of rows) {
      const rowEl = row as HTMLElement;
      const nameEl = rowEl.querySelector('.nn-navitem-name, .nn-file-tag') as HTMLElement | null;
      const iconEl = rowEl.querySelector('.nn-navitem-icon, .nn-file-icon, .nn-file-tag svg, .nn-navitem svg') as HTMLElement | null;
      const attrTag = String(
        rowEl.getAttribute('data-tag-name') ||
        rowEl.getAttribute('data-tag') ||
        '',
      ).trim();
      const textRaw = String(attrTag || nameEl?.textContent || rowEl.textContent || '').trim();
      if (!textRaw) continue;

      const normalizedRowTag = normalizeTagValue(textRaw.replace(/\s+\d+$/, '').replace(/^#/, ''));
      if (normalizedRowTag !== normalizedTag) continue;

      const colorCandidates = [
        String(getComputedStyle(iconEl || rowEl).color || '').trim(),
        String(getComputedStyle(nameEl || rowEl).color || '').trim(),
      ];
      for (const color of colorCandidates) {
        if (color && this.isValidCssColor(color)) {
          return color;
        }
      }
    }
    return '';
  }

  private isValidCssColor(value: string): boolean {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    if (normalized.startsWith('var(')) return true;
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', normalized)) {
      return true;
    }
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(normalized);
  }

  createFolderChip(entries: any[]): HTMLElement {
    const file = entries[0].file;
    const parentName = file.parent?.name || '/';

    const chip = document.createElement('div');
    chip.className = 'tps-gcm-chip';

    const icon = document.createElement('span');
    icon.className = 'tps-gcm-chip-icon';
    setIcon(icon, 'folder');
    chip.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tps-gcm-chip-label';
    label.textContent = parentName;
    chip.appendChild(label);

    addSafeClickListener(chip, (e) => {
      this.propertyRowService.openTypeSubmenu(chip, entries);
    });

    return chip;
  }

  /**
   * Creates the compact bottom bar with tools and system commands
   */
  createActionToolbar(entries: any[]): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'tps-gcm-action-bar';

    // SINGLE GROUP: System Menu (Three Dots) only - other actions nested inside
    const group = document.createElement('div');
    group.className = 'tps-gcm-action-group';

    const menuBtn = this.createIconButton('more-horizontal', 'Options', (e) => {
      this.showOptionsMenu(e, entries);
    });
    group.appendChild(menuBtn);

    // Attachment button: only for single markdown file
    if (entries.length === 1 && (entries[0]?.file as TFile)?.extension?.toLowerCase() === 'md') {
      const currentFile = entries[0].file as TFile;
      const refreshAttachments = () => {
        void this.plugin.persistentMenuManager.refreshMenusForFile(currentFile, true, { rebuildInlineSubitems: true });
      };
      const attachBtn = this.createIconButton('paperclip', 'Embed attachment', (evt: MouseEvent) => {
        const menu = new Menu();
        menu.addItem((item) => {
          item.setTitle('Handwritten Note')
            .setIcon('pencil')
            .onClick(() => {
              void this.actionService.ensureEditModeAndExecute(() => this.actionService.triggerHandwriting());
              window.setTimeout(refreshAttachments, 1500);
            });
        });
        menu.addItem((item) => {
          item.setTitle('Audio Recording')
            .setIcon('mic')
            .onClick(() => {
              void this.actionService.ensureEditModeAndExecute(() => this.actionService.triggerVoiceRecording());
              window.setTimeout(refreshAttachments, 1500);
            });
        });
        menu.addItem((item) => {
          item.setTitle('Embed Note')
            .setIcon('file-text')
            .onClick(() => {
              void this.actionService.attachExistingNoteAsAttachment(currentFile)
                .then(refreshAttachments)
                .catch((error) => this.reportAsyncPanelActionFailure('Embed note', error));
            });
        });
        menu.showAtMouseEvent(evt);
      });
      group.appendChild(attachBtn);
    }

    bar.appendChild(group);

    return bar;
  }

  createIconButton(iconId: string, tooltip: string, onClick: (e: MouseEvent) => void): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'tps-gcm-icon-btn';
    btn.title = tooltip;
    setIconWithFallback(btn, iconId);
    addSafeClickListener(btn, onClick);
    return btn;
  }

  createSubitemsPanel(rootFile: TFile): HTMLElement {
    const section = document.createElement('div');
    section.className = 'tps-gcm-subitems-panel';

    // Collapse Handling
    const expandHandle = document.createElement('div');
    expandHandle.className = 'tps-gcm-expand-handle';
    expandHandle.title = 'Expand';
    const expandIcon = document.createElement('span');
    setIcon(expandIcon, 'chevron-up'); // Swapped to UP
    expandHandle.appendChild(expandIcon);
    const expandCount = document.createElement('span');
    expandCount.className = 'tps-gcm-expand-count';
    expandCount.textContent = '0';
    expandHandle.appendChild(expandCount);

    // Add expand handle (will be hidden unless collapsed)
    section.appendChild(expandHandle);

    const collapseHandle = document.createElement('div');
    logger.log('[TPS GCM] Creating V2 Collapse Button');
    collapseHandle.className = 'tps-gcm-collapse-overlay-btn-v2';
    collapseHandle.title = 'Collapse';
    const collapseIcon = document.createElement('span');
    setIcon(collapseIcon, 'chevron-down'); // Swapped to DOWN
    collapseHandle.appendChild(collapseIcon);

    addSafeClickListener(collapseHandle, (e) => {
      e.stopPropagation();
      section.classList.add('tps-gcm-subitems-panel--collapsed');
      this.plugin.persistentMenuManager.setSubitemsPanelCollapsed(rootFile.path, true);
    });
    addSafeClickListener(expandHandle, (e) => {
      e.stopPropagation();
      section.classList.remove('tps-gcm-subitems-panel--collapsed');
      this.plugin.persistentMenuManager.setSubitemsPanelCollapsed(rootFile.path, false);
    });

    // Add collapse handle at the top
    section.appendChild(collapseHandle);

    const parentNavContainer = document.createElement('div');
    parentNavContainer.className = 'tps-gcm-parent-nav-container';
    section.appendChild(parentNavContainer);

    // Children section
    const childrenSection = document.createElement('div');
    childrenSection.className = 'tps-gcm-subitems-section';
    childrenSection.dataset.showHidden = 'false';

    const childrenHeader = document.createElement('div');
    childrenHeader.className = 'tps-gcm-subitems-header';

    const childrenTitleWrap = document.createElement('div');
    childrenTitleWrap.className = 'tps-gcm-subitems-title-wrap';
    childrenTitleWrap.style.flexDirection = 'row';
    childrenTitleWrap.style.alignItems = 'center';
    childrenTitleWrap.style.gap = '6px';

    const childrenTitle = document.createElement('h4');
    childrenTitle.className = 'tps-gcm-subitems-title';
    childrenTitle.textContent = 'Children';
    childrenTitleWrap.appendChild(childrenTitle);

    const hiddenChildrenBadge = document.createElement('span');
    hiddenChildrenBadge.className = 'tps-gcm-subitems-hidden-badge';
    hiddenChildrenBadge.style.display = 'none';
    childrenTitleWrap.appendChild(hiddenChildrenBadge);

    childrenHeader.appendChild(childrenTitleWrap);

    const childrenActions = document.createElement('div');
    childrenActions.className = 'tps-gcm-subitems-header-actions';

    const addSubitemBtn = document.createElement('button');
    addSubitemBtn.type = 'button';
    addSubitemBtn.className = 'tps-gcm-subitems-header-btn';
    addSubitemBtn.title = 'Add subitem (linked task)';
    setIconWithFallback(addSubitemBtn, 'plus');
    addSafeClickListener(addSubitemBtn, () => {
      void promptAndCreateSubitemForParent(this.plugin, rootFile).then(async (created) => {
        if (created) {
          await this.refreshSubitemsPanel(rootFile, childrenBody, attachmentBody);
          window.setTimeout(() => {
            void this.refreshSubitemsPanel(rootFile, childrenBody, attachmentBody)
              .catch((error) => this.reportAsyncPanelActionFailure('Refresh subitems panel', error));
          }, 220);
        }
      }).catch((error) => this.reportAsyncPanelActionFailure('Create linked subitem', error));
    });
    childrenActions.appendChild(addSubitemBtn);

    const hiddenToggleBtn = document.createElement('button');
    hiddenToggleBtn.type = 'button';
    hiddenToggleBtn.className = 'tps-gcm-subitems-header-btn tps-gcm-subitems-hidden-toggle';
    hiddenToggleBtn.title = 'Show completed / archived children';
    hiddenToggleBtn.style.display = 'none';
    setIcon(hiddenToggleBtn, 'eye-off');
    addSafeClickListener(hiddenToggleBtn, () => {
      const showing = childrenSection.dataset.showHidden === 'true';
      const willShow = !showing;
      childrenSection.dataset.showHidden = willShow ? 'true' : 'false';
      hiddenToggleBtn.title = willShow
        ? 'Hide completed / archived children'
        : 'Show completed / archived children';
      setIcon(hiddenToggleBtn, willShow ? 'eye' : 'eye-off');
      void this.refreshSubitemsPanel(rootFile, childrenBody, attachmentBody);
    });
    childrenActions.appendChild(hiddenToggleBtn);

    childrenHeader.appendChild(childrenActions);

    const childrenBody = document.createElement('div');
    childrenBody.className = 'tps-gcm-subitems-body tps-gcm-subitems-body--children';

    childrenSection.appendChild(childrenHeader);
    childrenSection.appendChild(childrenBody);
    section.appendChild(childrenSection);

    // Attachments section
    const attachmentSection = document.createElement('div');
    attachmentSection.className = 'tps-gcm-subitems-section tps-gcm-subitems-section--attachments';

    const attachmentHeader = document.createElement('div');
    attachmentHeader.className = 'tps-gcm-subitems-header';

    const attachmentTitleWrap = document.createElement('div');
    attachmentTitleWrap.className = 'tps-gcm-subitems-title-wrap';

    const attachmentTitle = document.createElement('h4');
    attachmentTitle.className = 'tps-gcm-subitems-title';
    attachmentTitle.textContent = 'Attachments';
    attachmentTitleWrap.appendChild(attachmentTitle);

    attachmentHeader.appendChild(attachmentTitleWrap);

    const attachmentBody = document.createElement('div');
    attachmentBody.className = 'tps-gcm-subitems-body tps-gcm-subitems-body--attachments';

    attachmentSection.appendChild(attachmentHeader);
    attachmentSection.appendChild(attachmentBody);
    section.appendChild(attachmentSection);

    // Set up drop zones once — after both bodies are in the DOM
    const getBodyRefs = () => [childrenBody, attachmentBody] as [HTMLElement, HTMLElement];
    this.setupDropZone(childrenBody, 'child', rootFile, getBodyRefs);
    this.setupDropZone(attachmentBody, 'attachment', rootFile, getBodyRefs);

    // Initial load — fire immediately, then re-fire after a short delay so that any
    // in-flight metadata cache updates (e.g. from a just-committed frontmatter mutation)
    // are fully settled before the second render.
    void this.refreshSubitemsPanel(rootFile, childrenBody, attachmentBody);
    window.setTimeout(() => {
      void this.refreshSubitemsPanel(rootFile, childrenBody, attachmentBody);
    }, 400);
    return section;
  }

  createNoteReferencesPanel(rootFile: TFile): HTMLElement {
    const section = document.createElement('section');
    section.className = 'tps-gcm-note-references';
    section.dataset.filePath = rootFile.path;

    const header = document.createElement('div');
    header.className = 'tps-gcm-note-references-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'tps-gcm-note-references-title-wrap';

    const title = document.createElement('h3');
    title.className = 'tps-gcm-note-references-title';
    title.textContent = 'References';
    titleWrap.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'tps-gcm-note-references-subtitle';
    subtitle.textContent = 'Outgoing links, backlinks, and mentions';
    titleWrap.appendChild(subtitle);

    header.appendChild(titleWrap);
    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'tps-gcm-note-references-body';
    section.appendChild(body);

    void this.refreshNoteReferencesPanel(rootFile, body);
    window.setTimeout(() => {
      void this.refreshNoteReferencesPanel(rootFile, body);
    }, 250);

    return section;
  }

  createNoteGraphPanel(rootFile: TFile): HTMLElement {
    const section = document.createElement('aside');
    section.className = 'tps-gcm-note-graph';
    section.dataset.filePath = rootFile.path;
    section.setAttribute('aria-label', 'Reference graph');
    section.setAttribute('role', 'button');
    section.setAttribute('tabindex', '0');
    section.setAttribute('aria-description', 'Open the master graph focused on this note');

    const openMasterGraph = () => {
      void this.openMasterGraphForFile(rootFile);
    };
    section.addEventListener('click', () => openMasterGraph());
    section.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        openMasterGraph();
      }
    });

    const header = document.createElement('div');
    header.className = 'tps-gcm-note-graph-header';
    header.textContent = 'Graph';
    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'tps-gcm-note-graph-body';
    section.appendChild(body);

    void this.refreshNoteGraphPanel(rootFile, body);
    window.setTimeout(() => {
      void this.refreshNoteGraphPanel(rootFile, body);
    }, 250);

    return section;
  }

  async refreshNoteReferencesPanel(rootFile: TFile, body: HTMLElement): Promise<void> {
    if (!body.isConnected) return;
    const refreshToken = `${Date.now()}-${Math.random()}`;
    body.dataset.refreshToken = refreshToken;
    body.innerHTML = '';

    const references = await this.collectReferenceGroups(rootFile);
    if (!body.isConnected || body.dataset.refreshToken !== refreshToken) return;
    this.renderReferencesSection(body, references, rootFile, true); // pass true for standalone
  }

  async refreshNoteGraphPanel(rootFile: TFile, body: HTMLElement): Promise<void> {
    if (!body.isConnected) return;
    const refreshToken = `${Date.now()}-${Math.random()}`;
    body.dataset.refreshToken = refreshToken;
    body.innerHTML = '';

    const graphData = await this.collectGraphData(rootFile);
    if (!body.isConnected || body.dataset.refreshToken !== refreshToken) return;
    const totalNodes = graphData.incoming.length + graphData.outgoing.length + graphData.mentions.length;
    if (totalNodes === 0) {
      const empty = document.createElement('div');
      empty.className = 'tps-gcm-note-graph-empty';
      empty.textContent = 'No linked notes';
      body.appendChild(empty);
      return;
    }
    body.appendChild(this.createNoteGraphSvg(rootFile, graphData));
  }

  private async openMasterGraphForFile(rootFile: TFile): Promise<void> {
    const search = this.buildGraphFocusSearch(rootFile);
    const options = await this.loadMasterGraphOptions(search);
    let leaf = this.app.workspace.getLeavesOfType('graph')[0] ?? null;

    try {
      if (!leaf) {
        leaf = this.app.workspace.getLeaf('tab');
      }
      await this.applyMasterGraphViewState(leaf, options);
      this.app.workspace.setActiveLeaf(leaf, true, true);
    } catch (error) {
      logger.warn('[TPS GCM] Failed opening master graph via view state, falling back to command.', error);
      const opened = (this.app as any)?.commands?.executeCommandById?.('graph:Open graph view');
      if (!opened) {
        new Notice('Unable to open the graph view.');
        return;
      }
      window.setTimeout(async () => {
        const graphLeaf = this.app.workspace.getLeavesOfType('graph')[0];
        if (!graphLeaf) return;
        try {
          await this.applyMasterGraphViewState(graphLeaf, options);
          this.app.workspace.setActiveLeaf(graphLeaf, true, true);
        } catch (fallbackError) {
          logger.warn('[TPS GCM] Failed applying graph focus state after fallback open.', fallbackError);
        }
      }, 120);
    }
  }

  private buildGraphFocusSearch(rootFile: TFile): string {
    const escapedBasename = rootFile.basename.replace(/"/g, '\\"');
    const escapedPath = rootFile.path.replace(/"/g, '\\"');
    return `"${escapedBasename}" path:"${escapedPath}"`;
  }

  private async loadMasterGraphOptions(search: string): Promise<Record<string, unknown>> {
    const defaultOptions: Record<string, unknown> = { search };
    const graphConfigPath = normalizePath(`${this.app.vault.configDir}/graph.json`);

    try {
      if (!(await this.app.vault.adapter.exists(graphConfigPath))) {
        return defaultOptions;
      }
      const raw = await this.app.vault.adapter.read(graphConfigPath);
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return defaultOptions;
      }
      return {
        ...(parsed as Record<string, unknown>),
        search,
      };
    } catch (error) {
      logger.warn('[TPS GCM] Failed loading graph.json options, using focused defaults.', error);
      return defaultOptions;
    }
  }

  private async applyMasterGraphViewState(leaf: WorkspaceLeaf, options: Record<string, unknown>): Promise<void> {
    await leaf.setViewState({
      type: 'graph',
      active: true,
      state: options,
    });
  }

  private async populateParentNavButton(rootFile: TFile, container: HTMLElement): Promise<void> {
    container.innerHTML = '';

    const parentFiles = this.resolveParentFilesFor(rootFile);

    if (parentFiles.length === 0) return;

    const navButton = document.createElement('button');
    navButton.type = 'button';
    navButton.className = 'tps-gcm-parent-nav-button';
    navButton.title = parentFiles.length === 1 ? 'Go to parent' : 'Select parent';
    setIcon(navButton, 'arrow-up');

    const label = document.createElement('span');
    label.className = 'tps-gcm-parent-nav-label';
    label.textContent = parentFiles.length === 1 ? 'Parent' : `Parents (${parentFiles.length})`;
    navButton.appendChild(label);

    addSafeClickListener(navButton, () => {
      if (parentFiles.length === 1) {
        // Single parent: open directly
        void this.plugin.openFileInLeaf(parentFiles[0], false, () => this.app.workspace.getLeaf(false), {
          revealLeaf: true,
        });
      } else {
        // Multiple parents: show menu
        const menu = new Menu();
        for (const parentFile of parentFiles) {
          menu.addItem((item) => {
            item
              .setTitle(this.getFileDisplayTitle(parentFile))
              .setIcon('file-text')
              .onClick(() => {
                void this.plugin.openFileInLeaf(parentFile, false, () => this.app.workspace.getLeaf(false), {
                  revealLeaf: true,
                });
              });
          });
          menu.addItem((item) => {
            item
              .setTitle(`Unlink from "${this.getFileDisplayTitle(parentFile)}"`)
              .setIcon('unlink')
              .onClick(() => {
                void this.plugin.bulkEditService.unlinkFromParentWithOutcome(rootFile, parentFile).then(async (outcome) => {
                  this.showParentUnlinkResult(outcome, rootFile, parentFile);
                  await this.populateParentNavButton(rootFile, container);
                }).catch((error) => this.reportAsyncPanelActionFailure('Unlink from parent', error));
              });
          });
        }
        menu.addSeparator();
        menu.addItem((item) => {
          item
            .setTitle('Unlink from all parents')
            .setIcon('unlink-2')
            .onClick(() => {
              void this.plugin.bulkEditService.unlinkFromAllParentsWithOutcome(rootFile).then(async (outcome) => {
                this.showParentUnlinkAggregateResult(outcome, rootFile);
                await this.populateParentNavButton(rootFile, container);
              }).catch((error) => this.reportAsyncPanelActionFailure('Unlink from all parents', error));
            });
        });
        menu.showAtPosition({ x: navButton.getBoundingClientRect().left, y: navButton.getBoundingClientRect().bottom });
      }
    });

    navButton.addEventListener('contextmenu', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const menu = new Menu();
      for (const parentFile of parentFiles) {
        const unlinkTitle = parentFiles.length === 1 ? 'Unlink from parent' : `Unlink from "${this.getFileDisplayTitle(parentFile)}"`;
        menu.addItem((item) => {
          item
            .setTitle(unlinkTitle)
            .setIcon('unlink')
            .onClick(() => {
              void this.plugin.bulkEditService.unlinkFromParentWithOutcome(rootFile, parentFile).then(async (outcome) => {
                this.showParentUnlinkResult(outcome, rootFile, parentFile);
                await this.populateParentNavButton(rootFile, container);
              }).catch((error) => this.reportAsyncPanelActionFailure('Unlink from parent', error));
            });
        });
      }
      menu.addSeparator();
      menu.addItem((item) => {
        item
          .setTitle('Unlink from all parents')
          .setIcon('unlink-2')
          .onClick(() => {
            void this.plugin.bulkEditService.unlinkFromAllParentsWithOutcome(rootFile).then(async (outcome) => {
              this.showParentUnlinkAggregateResult(outcome, rootFile);
              await this.populateParentNavButton(rootFile, container);
            }).catch((error) => this.reportAsyncPanelActionFailure('Unlink from all parents', error));
          });
      });
      menu.showAtMouseEvent(evt);
    });

    container.appendChild(navButton);
  }

  private resolveParentFilesFor(rootFile: TFile): TFile[] {
    const parentByPath = new Map<string, TFile>();
    for (const entry of this.plugin.parentLinkResolutionService.getParentsForChild(rootFile)) {
      if (entry.file.path !== rootFile.path) {
        parentByPath.set(entry.file.path, entry.file);
      }
    }

    return Array.from(parentByPath.values());
  }

  private resolveParentValueToFile(value: any, sourcePath: string): TFile | null {
    return resolveLinkValueToFile(this.app, value, sourcePath);
  }

  private parentValueMatchesTarget(value: any, sourcePath: string, target: TFile): boolean {
    const file = this.resolveParentValueToFile(value, sourcePath);
    return file !== null && file.path === target.path;
  }

  private scheduleSubitemsPanelRefresh(
    rootFile: TFile,
    childrenBody: HTMLElement,
    attachmentBody: HTMLElement
  ): void {
    const key = rootFile.path;
    const existing = this.subitemPanelRefreshTimers.get(key);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    this.subitemPanelRefreshTimers.set(
      key,
      window.setTimeout(() => {
        this.subitemPanelRefreshTimers.delete(key);
        void this.refreshSubitemsPanel(rootFile, childrenBody, attachmentBody);
      }, SUBITEM_PANEL_REFRESH_DEBOUNCE_MS)
    );
  }

  private async refreshSubitemsPanel(
    rootFile: TFile,
    childrenBody: HTMLElement,
    attachmentBody: HTMLElement
  ): Promise<void> {
    const now = Date.now();
    const lastReconcileAt = this.subitemLinkReconcileAt.get(rootFile.path) ?? 0;
    if (now - lastReconcileAt >= SUBITEM_LINK_RECONCILE_INTERVAL_MS) {
      this.subitemLinkReconcileAt.set(rootFile.path, now);
      try {
        const repaired = await this.plugin.bulkEditService.reconcileParentChildLinksForParent(rootFile);
        if (repaired > 0) {
          logger.log(`[TPS GCM] Reconciled ${repaired} parent/child link update(s) for ${rootFile.path}`);
        }
      } catch (error) {
        logger.warn('[TPS GCM] Failed reconciling parent/child links for subitems panel:', rootFile.path, error);
      }
    }

    // Refresh the parent nav button alongside children/attachments so it stays in sync
    // after operations like linkToParent that change the parent frontmatter key.
    const panel = childrenBody.closest('.tps-gcm-subitems-panel');
    const navContainer = panel?.querySelector<HTMLElement>('.tps-gcm-parent-nav-container');
    if (navContainer) {
      const isCollapsed = panel?.classList.contains('tps-gcm-subitems-panel--collapsed') ?? false;
      navContainer.style.display = isCollapsed ? 'none' : '';
      void this.populateParentNavButton(rootFile, navContainer);
    }
    try {
      const tree = await this.buildSubitemTree(rootFile);

      // Separate children and attachments, track hidden children separately
      const visibleChildren: SubitemNode[] = [];
      const hiddenChildren: SubitemNode[] = [];
      const attachments: SubitemNode[] = [];

      tree.forEach((node) => {
        const isAttachmentOnly = node.relations.includes('attachment') && !node.relations.includes('child');
        if (isAttachmentOnly) {
          attachments.push(node);
        } else if (node.hidden) {
          hiddenChildren.push(node);
        } else {
          visibleChildren.push(node);
        }
      });

      // Read show-hidden state and update toggle button / badge
      const childrenSection = childrenBody.closest<HTMLElement>('.tps-gcm-subitems-section');
      const showHidden = childrenSection?.dataset.showHidden === 'true';

      const toggleBtn = panel?.querySelector<HTMLButtonElement>('.tps-gcm-subitems-hidden-toggle');
      const hiddenBadge = panel?.querySelector<HTMLElement>('.tps-gcm-subitems-hidden-badge');
      const checklistItems = await this.collectChecklistSubitems(rootFile);

      const hasHidden = hiddenChildren.length > 0;
      const totalChildren = visibleChildren.length + hiddenChildren.length;
      const totalAttachments = attachments.length;
      const totalChecklist = checklistItems.length;
      const totalItems = totalChildren + totalAttachments + totalChecklist;
      panel?.classList.toggle('tps-gcm-subitems-panel--has-note-subitems', totalChildren > 0);
      panel?.classList.toggle('tps-gcm-subitems-panel--has-checklist-subitems', totalChecklist > 0);
      const expandCountEl = panel?.querySelector<HTMLElement>('.tps-gcm-expand-count');
      if (expandCountEl) {
        const parts: string[] = [];
        if (totalChildren > 0) parts.push(`C:${totalChildren}`);
        if (totalAttachments > 0) parts.push(`A:${totalAttachments}`);
        if (totalChecklist > 0) parts.push(`K:${totalChecklist}`);
        expandCountEl.textContent = parts.length ? parts.join(' ') : '0';
        expandCountEl.title = `Children: ${totalChildren}, Attachments: ${totalAttachments}, Checklist: ${totalChecklist}, Total: ${totalItems}`;
      }

      if (toggleBtn) {
        toggleBtn.style.display = hasHidden ? '' : 'none';
        if (hasHidden) {
          toggleBtn.title = showHidden
            ? 'Hide completed / archived children'
            : 'Show completed / archived children';
          setIcon(toggleBtn, showHidden ? 'eye' : 'eye-off');
        }
      }
      if (hiddenBadge) {
        hiddenBadge.style.display = hasHidden ? '' : 'none';
        hiddenBadge.textContent = `${hiddenChildren.length} hidden`;
      }

      const childrenToRender = showHidden
        ? [...visibleChildren, ...hiddenChildren]
        : visibleChildren;

      const getBodyRefs = (): [HTMLElement, HTMLElement] => [childrenBody, attachmentBody];

      // Render children section
      this.renderSubitemsSection(
        childrenBody,
        childrenToRender,
        rootFile,
        'No linked children yet. Use + to create one.',
        getBodyRefs,
        checklistItems
      );

      // Render attachments section
      this.renderSubitemsSection(attachmentBody, attachments, rootFile, 'No embedded attachments yet. Use + to embed one.', getBodyRefs);

      // Auto-collapse: advance the state machine on each render pass.
      // 'pending' → 'ready' on first render; 'ready' → collapsed/expanded on second render.
      if (panel instanceof HTMLElement) {
        const ac = panel.dataset.autoCollapse;
        if (ac === 'pending') {
          panel.dataset.autoCollapse = 'ready';
        } else if (ac === 'ready') {
          delete panel.dataset.autoCollapse;
          const hasContent =
            visibleChildren.length > 0 ||
            hiddenChildren.length > 0 ||
            attachments.length > 0 ||
            checklistItems.length > 0;
          if (hasContent) {
            panel.classList.remove('tps-gcm-subitems-panel--collapsed');
            this.plugin.persistentMenuManager.setSubitemsPanelCollapsed(rootFile.path, false);
          } else {
            panel.classList.add('tps-gcm-subitems-panel--collapsed');
            this.plugin.persistentMenuManager.setSubitemsPanelCollapsed(rootFile.path, true);
          }
        }
      }
    } catch (error) {
      logger.error('[TPS GCM] Failed to render subitems panel:', error);
      childrenBody.innerHTML = '';
      attachmentBody.innerHTML = '';
      const err = document.createElement('div');
      err.className = 'tps-gcm-subitem-empty';
      err.textContent = 'Unable to render subitems.';
      childrenBody.appendChild(err);
    }
  }

  private setupDropZone(
    body: HTMLElement,
    targetRelation: 'child' | 'attachment',
    rootFile: TFile,
    getBodyRefs: () => [HTMLElement, HTMLElement]
  ): void {
    const rerender = () => {
      const [childrenBody, attachmentBody] = getBodyRefs();
      this.scheduleSubitemsPanelRefresh(rootFile, childrenBody, attachmentBody);
    };

    body.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('application/tps-gcm-subitem')) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      body.classList.add('tps-gcm-subitems-body--drop-target');
    });
    body.addEventListener('dragleave', (e) => {
      if (!body.contains(e.relatedTarget as Node)) {
        body.classList.remove('tps-gcm-subitems-body--drop-target');
      }
    });
    body.addEventListener('drop', (e) => {
      e.preventDefault();
      body.classList.remove('tps-gcm-subitems-body--drop-target');
      const raw = e.dataTransfer?.getData('application/tps-gcm-subitem');
      if (!raw) return;
      let dragData: { path: string; relation: string; rootPath: string };
      try { dragData = JSON.parse(raw); } catch { return; }

      // No-op if dropped on same section
      if (dragData.relation === targetRelation) return;
      // Must be from the same root file
      if (dragData.rootPath !== rootFile.path) return;

      const draggedFile = this.app.vault.getAbstractFileByPath(dragData.path);
      if (!(draggedFile instanceof TFile)) return;

      if (targetRelation === 'child') {
        // Dragging attachment → children: file must be markdown
        if (draggedFile.extension?.toLowerCase() !== 'md') {
          new Notice('Only markdown files can be subitems.');
          return;
        }
        void this.changeRelationToChild(rootFile, draggedFile)
          .then(rerender)
          .catch((error) => this.reportAsyncPanelActionFailure('Convert attachment to child', error));
      } else {
        // Dragging child → attachments
        void this.changeRelationToAttachment(rootFile, draggedFile)
          .then(rerender)
          .catch((error) => this.reportAsyncPanelActionFailure('Convert child to attachment', error));
      }
    });
  }

  private renderSubitemsSection(
    body: HTMLElement,
    nodes: SubitemNode[],
    rootFile: TFile,
    emptyMessage: string,
    getBodyRefs: () => [HTMLElement, HTMLElement],
    checklistItems: ChecklistSubitem[] = []
  ): void {
    // Smart update: Only clear and rebuild if the structure actually changed
    // This prevents flickering when only metadata (like titles) changed
    const currentPaths = new Set<string>();
    body.querySelectorAll<HTMLElement>('[data-path]').forEach(el => {
      currentPaths.add(el.dataset.path || '');
    });
    body.querySelectorAll<HTMLElement>('[data-checklist-line]').forEach(el => {
      currentPaths.add(`checklist:${el.dataset.checklistLine || ''}`);
    });

    const newPaths = new Set([
      ...nodes.map(n => n.file.path),
      ...checklistItems.map(item => `checklist:${item.lineNumber}:${item.state}:${item.text}`),
    ]);

    // Check if the structure has changed (different files or different order)
    const structureChanged = currentPaths.size !== newPaths.size ||
      !Array.from(currentPaths).every(p => newPaths.has(p));

    if (structureChanged) {
      // Structure changed, rebuild everything
      body.innerHTML = '';

      const rerender = () => {
        const [childrenBody, attachmentBody] = getBodyRefs();
        this.scheduleSubitemsPanelRefresh(rootFile, childrenBody, attachmentBody);
      };

      if (!nodes.length && checklistItems.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'tps-gcm-subitem-empty';
        empty.textContent = emptyMessage;
        body.appendChild(empty);
        return;
      }

      nodes.forEach((node) => this.createSubitemRow(body, node, 0, rootFile, rerender));
      if (checklistItems.length > 0) {
        this.renderChecklistSubitems(body, checklistItems, rootFile, rerender);
      }
    } else {
      // Structure unchanged, only update titles in place
      nodes.forEach((node) => {
        const row = body.querySelector<HTMLElement>(`[data-path="${node.file.path}"]`);
        if (row) {
          const titleButton = row.querySelector<HTMLButtonElement>('.tps-gcm-subitem-title');
          if (titleButton) {
            const newTitle = this.getFileDisplayTitle(node.file);
            // Only update if title actually changed
            if (titleButton.textContent !== newTitle) {
              titleButton.textContent = newTitle;
              titleButton.title = node.file.path;
            }
          }
        }
      });
    }
  }

  private async collectChecklistSubitems(rootFile: TFile): Promise<ChecklistSubitem[]> {
    if (rootFile.extension?.toLowerCase() !== 'md') return [];

    try {
      const content = await this.app.vault.cachedRead(rootFile);
      const lines = content.split('\n');
      const checklistItems: ChecklistSubitem[] = [];

      for (let i = 0; i < lines.length; i += 1) {
        const parsed = this.parseChecklistLine(lines[i]);
        if (!parsed) continue;
        // Hide completed and canceled checklist items from the checklist-child list.
        if (parsed.state === 'x' || parsed.state === 'X' || parsed.state === '-') continue;
        if (!parsed.text.trim()) continue;
        if (this.isBrokenSubitemPlaceholderText(parsed.text)) continue;
        checklistItems.push({
          lineNumber: i,
          rawLine: lines[i],
          prefix: parsed.prefix,
          state: parsed.state,
          text: parsed.text.trim(),
        });
      }

      return checklistItems;
    } catch (error) {
      logger.warn('[TPS GCM] Failed reading checklist subitems for', rootFile.path, error);
      return [];
    }
  }

  private parseChecklistLine(line: string): { prefix: string; state: ChecklistTaskState; text: string } | null {
    const match = line.match(/^(\s*(?:[-*+]|\d+\.)\s*)\[([^\]\r\n]?)\]\s*(.*)$/);
    if (!match) return null;
    return {
      prefix: match[1],
      state: match[2] as ChecklistTaskState,
      text: match[3] || '',
    };
  }

  private renderChecklistSubitems(
    body: HTMLElement,
    checklistItems: ChecklistSubitem[],
    rootFile: TFile,
    onRefresh: () => void
  ): void {
    const checklistWrap = document.createElement('div');
    checklistWrap.className = 'tps-gcm-checklist-subitems';
    body.appendChild(checklistWrap);

    const checklistTitle = document.createElement('div');
    checklistTitle.className = 'tps-gcm-checklist-subitems-title';
    checklistTitle.textContent = 'Checklist items';
    checklistWrap.appendChild(checklistTitle);

    const checklistList = document.createElement('div');
    checklistList.className = 'tps-gcm-checklist-subitems-list';
    checklistWrap.appendChild(checklistList);

    const fragment = document.createDocumentFragment();
    checklistItems.forEach((item) => {
      this.createChecklistSubitemRow(fragment, item, rootFile, onRefresh);
    });
    checklistList.appendChild(fragment);
  }

  private createChecklistSubitemRow(
    container: Node,
    item: ChecklistSubitem,
    rootFile: TFile,
    onRefresh: () => void
  ): void {
    const row = document.createElement('div');
    row.className = 'tps-gcm-subitem-row tps-gcm-subitem-row--checklist';
    row.dataset.checklistLine = `${item.lineNumber}:${item.state}:${item.text}`;
    row.style.setProperty('--tps-gcm-subitem-depth', '0');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-list-item-checkbox tps-gcm-checklist-toggle';
    checkbox.checked = false;
    checkbox.indeterminate = item.state === '?';
    checkbox.title = 'Complete (right-click for more options)';
    checkbox.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (checkbox.disabled) return;
      checkbox.disabled = true;
      void this.toggleChecklistItemFromPanel(rootFile, item, row, onRefresh).finally(() => {
        checkbox.disabled = false;
      });
    });

    const showChecklistStateMenu = (x: number, y: number) => {
      const menu = new Menu();
      menu.addItem((mi) => {
        mi.setTitle('Complete')
          .setIcon('check')
          .onClick(() => {
            void this.setChecklistItemStateFromPanel(rootFile, item, row, 'x', onRefresh);
          });
      });
      menu.addItem((mi) => {
        mi.setTitle('Cross out')
          .setIcon('minus')
          .onClick(() => {
            void this.setChecklistItemStateFromPanel(rootFile, item, row, '-', onRefresh);
          });
      });
      menu.addItem((mi) => {
        mi.setTitle('Question')
          .setIcon('help-circle')
          .onClick(() => {
            void this.setChecklistItemStateFromPanel(rootFile, item, row, '?', onRefresh);
          });
      });
      menu.addSeparator();
      menu.addItem((mi) => {
        mi.setTitle('Custom checkbox value...')
          .setIcon('brackets')
          .onClick(() => {
            this.openCustomChecklistStateModal(rootFile, item, row, onRefresh);
          });
      });
      menu.showAtPosition({ x, y });
    };

    checkbox.addEventListener('contextmenu', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      showChecklistStateMenu(evt.clientX, evt.clientY);
    });

    // Long-press for touch devices
    let longPressTimer: number | null = null;
    checkbox.addEventListener('touchstart', (evt) => {
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        const touch = evt.touches[0];
        showChecklistStateMenu(touch?.clientX ?? 0, touch?.clientY ?? 0);
      }, 500);
    }, { passive: true });
    const cancelLongPress = () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };
    checkbox.addEventListener('touchmove', cancelLongPress, { passive: true });
    checkbox.addEventListener('touchend', cancelLongPress, { passive: true });
    checkbox.addEventListener('touchcancel', cancelLongPress, { passive: true });

    const content = document.createElement('div');
    content.className = 'tps-gcm-subitem-content';

    const header = document.createElement('div');
    header.className = 'tps-gcm-subitem-header';
    header.appendChild(checkbox);

    const textWrap = document.createElement('div');
    textWrap.className = 'tps-gcm-subitem-text';

    const titleLine = document.createElement('div');
    titleLine.className = 'tps-gcm-subitem-title-line';
    const title = document.createElement('span');
    title.className = 'tps-gcm-subitem-title tps-gcm-subitem-title--checklist';
    title.textContent = item.text;
    title.title = `${rootFile.path}:${item.lineNumber + 1}`;
    addSafeClickListener(title, () => {
      void this.scrollToChecklistLine(rootFile, item);
    });
    titleLine.appendChild(title);

    const metaRow = document.createElement('div');
    metaRow.className = 'tps-gcm-subitem-meta';

    const stateBadge = document.createElement('span');
    stateBadge.className = 'tps-gcm-subitem-relation';
    stateBadge.textContent = item.state === '?' ? 'question' : item.state === '-' ? 'canceled' : 'open';
    metaRow.appendChild(stateBadge);

    const lineInfo = document.createElement('span');
    lineInfo.className = 'tps-gcm-subitem-path';
    lineInfo.textContent = `line ${item.lineNumber + 1}`;
    metaRow.appendChild(lineInfo);

    const actions = document.createElement('div');
    actions.className = 'tps-gcm-subitem-actions';
    const promoteBtn = this.createSubitemActionButton('Promote', () => {
      if (promoteBtn.disabled) return;
      promoteBtn.disabled = true;
      void this.promoteChecklistItemToChild(rootFile, item, onRefresh).finally(() => {
        promoteBtn.disabled = false;
      });
    });
    promoteBtn.title = 'Create a linked child note from this checklist item';
    actions.appendChild(promoteBtn);

    metaRow.appendChild(actions);
    textWrap.appendChild(titleLine);
    textWrap.appendChild(metaRow);
    header.appendChild(textWrap);
    content.appendChild(header);
    row.appendChild(content);

    container.appendChild(row);
  }

  private openCustomChecklistStateModal(
    rootFile: TFile,
    item: ChecklistSubitem,
    rowEl: HTMLElement,
    onRefresh: () => void
  ): void {
    new TextInputModal(this.app, 'Checkbox value', getCheckboxStateMarker(`[${item.state || ' '}]`), async (value) => {
      const token = normalizeCheckboxStateToken(value);
      if (!token) {
        new Notice('Use a single checkbox marker, for example ?, *, /, -, x, or blank.');
        return;
      }
      await this.setChecklistItemStateFromPanel(rootFile, item, rowEl, getCheckboxStateMarker(token), onRefresh);
    }).open();
  }

  private async toggleChecklistItemFromPanel(
    rootFile: TFile,
    item: ChecklistSubitem,
    rowEl: HTMLElement,
    onRefresh: () => void
  ): Promise<void> {
    // Standard toggle: mark complete. The item disappears (filtered by collectChecklistSubitems).
    await this.setChecklistItemStateFromPanel(rootFile, item, rowEl, 'x', onRefresh);
  }

  private async setChecklistItemStateFromPanel(
    rootFile: TFile,
    item: ChecklistSubitem,
    rowEl: HTMLElement,
    newState: ChecklistTaskState,
    onRefresh: () => void
  ): Promise<void> {
    try {
      const content = await this.app.vault.read(rootFile);
      const lines = content.split('\n');
      const lineIndex = this.resolveChecklistLineIndex(lines, item);
      if (lineIndex < 0) return;

      const currentLine = lines[lineIndex];
      const stateMatch = currentLine.match(/^(\s*(?:[-*+]|\d+\.)\s*)\[([^\]\r\n]?)\](\s*.*)$/);
      const previousState = stateMatch ? (stateMatch[2] as ChecklistTaskState) : null;
      const updatedLine = currentLine.replace(
        /^(\s*(?:[-*+]|\d+\.)\s*)\[[^\]\r\n]?\](\s*.*)$/,
        `$1[${newState}]$3`
      );
      if (updatedLine === currentLine) return;

      lines[lineIndex] = updatedLine;
      const updatedContent = lines.join('\n');
      if (updatedContent === content) return;

      await this.app.vault.modify(rootFile, updatedContent);
      await this.plugin.taskCheckboxHandler.handleExternalChecklistStateMutation(
        rootFile,
        previousState,
        newState,
        lines,
      );
      // x / X / - are filtered out of the panel — fade and remove the row
      if (newState === 'x' || newState === 'X' || newState === '-') {
        rowEl.style.opacity = '0';
        rowEl.style.pointerEvents = 'none';
        window.setTimeout(() => rowEl.remove(), 120);
      }
      window.setTimeout(() => onRefresh(), 180);
    } catch (error) {
      logger.warn('[TPS GCM] Failed setting checklist item state from subitems panel for', rootFile.path, error);
    }
  }

  private async promoteChecklistItemToChild(
    rootFile: TFile,
    item: ChecklistSubitem,
    onRefresh: () => void
  ): Promise<void> {
    const created = await promoteChecklistItemToChildFromApi(this.plugin, rootFile, {
      lineNumber: item.lineNumber,
      rawLine: item.rawLine,
      text: item.text,
    });
    if (created) onRefresh();
  }

  private isBrokenSubitemPlaceholderText(text: string): boolean {
    return /^\s*\[\[+\s*$/.test(String(text || ''));
  }

  private resolveChecklistLineIndex(lines: string[], item: ChecklistSubitem): number {
    const direct = lines[item.lineNumber];
    if (typeof direct === 'string' && direct === item.rawLine) {
      return item.lineNumber;
    }

    const normalizedTarget = this.normalizeChecklistText(item.text);
    if (!normalizedTarget) return -1;

    for (let i = 0; i < lines.length; i += 1) {
      const parsed = this.parseChecklistLine(lines[i]);
      if (!parsed) continue;
      if (this.normalizeChecklistText(parsed.text) === normalizedTarget) {
        return i;
      }
    }
    return -1;
  }

  private normalizeChecklistText(text: string): string {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private async scrollToChecklistLine(rootFile: TFile, item: ChecklistSubitem): Promise<void> {
    try {
      // Resolve the actual line index (may have shifted since panel was rendered)
      const content = await this.app.vault.cachedRead(rootFile);
      const lines = content.split('\n');
      const lineIndex = this.resolveChecklistLineIndex(lines, item);
      if (lineIndex < 0) return;

      // Find the leaf showing this file
      const leaf = this.app.workspace.getLeavesOfType('markdown')
        .find((l: any) => l?.view?.file?.path === rootFile.path);
      if (!leaf) return;

      const view = leaf.view as MarkdownView;
      const viewState = (view as any).getState?.() || {};
      const isReading = viewState.mode === 'preview';

      if (isReading) {
        this.scrollInReadingMode(view, lineIndex, item.text);
      } else {
        this.scrollInEditorMode(view, lineIndex);
      }
    } catch (error) {
      logger.warn('[TPS GCM] Failed scrolling to checklist line for', rootFile.path, error);
    }
  }

  private scrollInEditorMode(view: MarkdownView, lineIndex: number): void {
    const editor = view.editor;
    if (!editor || typeof editor.setCursor !== 'function') return;

    editor.setCursor({ line: lineIndex, ch: 0 });
    if (typeof editor.scrollIntoView === 'function') {
      editor.scrollIntoView(
        { from: { line: lineIndex, ch: 0 }, to: { line: lineIndex + 1, ch: 0 } },
        true
      );
    }

    // Flash-highlight after a short delay so CM6 updates the DOM
    window.setTimeout(() => {
      try {
        const cmEditor = (editor as any)?.cm;
        if (!cmEditor) return;
        const lineInfo = cmEditor.state?.doc?.line(lineIndex + 1);
        if (!lineInfo) return;

        const domResult = cmEditor.domAtPos?.(lineInfo.from);
        if (!domResult) return;
        const node = domResult.node;
        const lineEl = node instanceof HTMLElement
          ? (node.closest('.cm-line') || node)
          : node?.parentElement?.closest?.('.cm-line');

        if (lineEl instanceof HTMLElement) {
          lineEl.classList.add('tps-gcm-line-highlight');
          window.setTimeout(() => lineEl.classList.remove('tps-gcm-line-highlight'), 1500);
        }
      } catch {
        // Highlight is purely cosmetic
      }
    }, 80);
  }

  private scrollInReadingMode(view: MarkdownView, lineIndex: number, itemText: string): void {
    const previewEl = (view as any).previewMode?.containerEl
      || view.containerEl?.querySelector('.markdown-preview-view');
    if (!previewEl) return;

    // Reading mode renders checklist items as <li> with class "task-list-item"
    // We match by text content since line numbers aren't preserved in the DOM
    const taskItems = previewEl.querySelectorAll('li.task-list-item') as NodeListOf<HTMLElement>;
    const normalizedTarget = itemText.replace(/\s+/g, ' ').trim().toLowerCase();

    let matchedEl: HTMLElement | null = null;
    for (const li of Array.from(taskItems)) {
      const liText = (li.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (liText.includes(normalizedTarget)) {
        matchedEl = li as HTMLElement;
        break;
      }
    }

    if (!matchedEl) {
      // Fallback: try to find by position among all list items
      // Count all checklist lines up to lineIndex to get approximate position
      // This won't be perfect but provides a reasonable fallback
      return;
    }

    matchedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Flash highlight
    matchedEl.classList.add('tps-gcm-line-highlight');
    window.setTimeout(() => matchedEl!.classList.remove('tps-gcm-line-highlight'), 1500);
  }

  private flashHighlightLine(_cmEditor: any, _lineIndex: number): void {
    // Deprecated: highlighting is now handled inline by scrollInEditorMode / scrollInReadingMode
  }

  async collectReferenceGroups(rootFile: TFile): Promise<ReferenceData> {
    const outgoingOccurrences = await this.extractReferenceOccurrencesFromSource(rootFile);
    const outgoing = this.groupReferenceOccurrences(outgoingOccurrences, 'outgoing');

    const incomingSourceFiles = this.getIncomingReferenceSourceFiles(rootFile);
    const incomingBatches = await Promise.all(
      incomingSourceFiles.map(async (sourceFile) => this.extractReferenceOccurrencesFromSource(sourceFile, rootFile))
    );
    const incoming = this.groupReferenceOccurrences(incomingBatches.flat(), 'incoming');

    const mentions = await this.collectUnlinkedMentionGroups(rootFile);
    // Sort after collecting
    mentions.sort((a, b) => this.getFileDisplayTitle(a.file).localeCompare(this.getFileDisplayTitle(b.file)));
    outgoing.sort((a, b) => this.getFileDisplayTitle(a.file).localeCompare(this.getFileDisplayTitle(b.file)));

    return { outgoing, incoming, mentions };
  }

  private async collectGraphData(rootFile: TFile): Promise<GraphData> {
    const depth = 1;
    const maxIncoming = 3;
    const maxOutgoing = 3;
    const maxMentions = 0;

    const outgoing = await this.collectOutgoingGraphFiles(rootFile, depth, maxOutgoing);
    const incoming = await this.collectIncomingGraphFiles(rootFile, depth, maxIncoming);
    const mentionGroups = maxMentions > 0 ? await this.collectUnlinkedMentionGroups(rootFile) : [];
    const mentions = mentionGroups.slice(0, maxMentions).map((group) => group.file);

    return { outgoing, incoming, mentions };
  }

  private async collectOutgoingGraphFiles(rootFile: TFile, depth: number, limit: number): Promise<TFile[]> {
    const seen = new Set<string>([rootFile.path]);
    const collected: TFile[] = [];
    let frontier: TFile[] = [rootFile];

    for (let level = 0; level < depth && frontier.length > 0 && collected.length < limit; level += 1) {
      const nextFrontier: TFile[] = [];
      for (const file of frontier) {
        const occurrences = await this.extractReferenceOccurrencesFromSource(file);
        const targets = occurrences
          .map((occurrence) => occurrence.targetFile)
          .filter((target): target is TFile => target instanceof TFile && target.extension?.toLowerCase() === 'md');

        for (const target of targets) {
          if (seen.has(target.path)) continue;
          seen.add(target.path);
          collected.push(target);
          nextFrontier.push(target);
          if (collected.length >= limit) break;
        }

        if (collected.length >= limit) break;
      }
      frontier = nextFrontier;
    }

    return collected;
  }

  private async collectIncomingGraphFiles(rootFile: TFile, depth: number, limit: number): Promise<TFile[]> {
    const seen = new Set<string>([rootFile.path]);
    const collected: TFile[] = [];
    let frontier: TFile[] = [rootFile];

    for (let level = 0; level < depth && frontier.length > 0 && collected.length < limit; level += 1) {
      const nextFrontier: TFile[] = [];
      for (const file of frontier) {
        const sources = this.getIncomingReferenceSourceFiles(file);
        for (const source of sources) {
          if (seen.has(source.path)) continue;
          const occurrences = await this.extractReferenceOccurrencesFromSource(source, file);
          if (occurrences.length === 0) continue;
          seen.add(source.path);
          collected.push(source);
          nextFrontier.push(source);
          if (collected.length >= limit) break;
        }
        if (collected.length >= limit) break;
      }
      frontier = nextFrontier;
    }

    return collected;
  }

  private getIncomingReferenceSourceFiles(rootFile: TFile): TFile[] {
    const resolvedLinks = ((this.app.metadataCache as any)?.resolvedLinks || {}) as Record<string, Record<string, number>>;
    const seen = new Set<string>();
    const files: TFile[] = [];

    for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
      if (!targets || !Object.prototype.hasOwnProperty.call(targets, rootFile.path)) continue;
      if (sourcePath === rootFile.path || seen.has(sourcePath)) continue;
      const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(sourceFile instanceof TFile) || sourceFile.extension?.toLowerCase() !== 'md') continue;
      seen.add(sourcePath);
      files.push(sourceFile);
    }

    files.sort((a, b) => a.basename.localeCompare(b.basename));
    return files;
  }

  private async extractReferenceOccurrencesFromSource(
    sourceFile: TFile,
    onlyTarget?: TFile
  ): Promise<ReferenceOccurrence[]> {
    if (sourceFile.extension?.toLowerCase() !== 'md') return [];

    try {
      const raw = await this.app.vault.cachedRead(sourceFile);
      const lines = raw.split('\n');
      const frontmatterEndLine = this.getFrontmatterEndLine(sourceFile, raw);
      const headings = Array.isArray((this.app.metadataCache.getFileCache(sourceFile) as any)?.headings)
        ? ((this.app.metadataCache.getFileCache(sourceFile) as any)?.headings as any[])
        : [];

      const occurrences: ReferenceOccurrence[] = [];
      let inFence = false;
      for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
        if (lineNumber <= frontmatterEndLine) continue;
        const line = lines[lineNumber];
        if (String(line || '').trimStart().startsWith('```')) {
          inFence = !inFence;
          continue;
        }
        if (inFence || !line || line.indexOf('[') < 0) continue;

        for (const match of this.extractReferenceTargetsFromLine(line)) {
          const targetFile = resolveLinkTargetToFile(this.app, match.target, sourceFile.path);
          if (!(targetFile instanceof TFile) || targetFile.extension?.toLowerCase() !== 'md') continue;
          if (onlyTarget && targetFile.path !== onlyTarget.path) continue;

          // Use the full link syntax as focus text so the preview centers on it
          const linkSnippet = line.slice(match.start, match.end);
          occurrences.push({
            sourceFile,
            targetFile,
            lineNumber,
            heading: this.findHeadingForLine(headings, lineNumber),
            previews: this.buildReferencePreviewLevels(lines, lineNumber, linkSnippet),
            matchedText: linkSnippet,
          });
        }
      }

      return occurrences;
    } catch (error) {
      logger.warn('[TPS GCM] Failed extracting reference occurrences for', sourceFile.path, error);
      return [];
    }
  }

  private extractReferenceTargetsFromLine(line: string): Array<{ target: string; start: number; end: number }> {
    const matches: Array<{ target: string; start: number; end: number }> = [];
    const patterns = [
      /\[\[([^\]]+)\]\]/g,
      /\[[^\]]*\]\(([^)]+)\)/g,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null = null;
      while ((match = pattern.exec(line)) !== null) {
        if (match.index > 0 && line[match.index - 1] === '!') continue;
        const target = String(match[1] || '').trim();
        if (!target) continue;
        matches.push({
          target,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }

    return matches;
  }

  private getFrontmatterEndLine(file: TFile, raw: string): number {
    const cache = this.app.metadataCache.getFileCache(file) as any;
    const fmPosition = cache?.frontmatter?.position;
    if (fmPosition?.end?.line !== undefined) {
      return Number(fmPosition.end.line);
    }

    const lines = raw.split('\n');
    if (lines[0]?.trim() !== '---') return -1;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i]?.trim() === '---') return i;
    }
    return -1;
  }

  private findHeadingForLine(headings: any[], lineNumber: number): string {
    let activeHeading = '';
    for (const heading of headings) {
      const headingLine = Number(heading?.position?.start?.line);
      if (!Number.isFinite(headingLine) || headingLine > lineNumber) break;
      const value = String(heading?.heading || '').trim();
      if (value) activeHeading = value;
    }
    return activeHeading;
  }

  private buildReferencePreviewLevels(lines: string[], lineNumber: number, focusText?: string): string[] {
    const linePreview = this.cropPreviewText(lines[lineNumber] || '', 140, focusText);
    const paragraphPreview = this.cropPreviewText(this.extractParagraphPreview(lines, lineNumber), 320, focusText);
    const sectionPreview = this.cropPreviewText(this.extractSectionPreview(lines, lineNumber), 520, focusText);
    return Array.from(new Set([linePreview, paragraphPreview, sectionPreview].filter(Boolean)));
  }

  private cropPreviewText(text: string, maxLength = 140, focusText?: string): string {
    const normalized = String(text || '').replace(/\t/g, '  ').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxLength) return normalized;

    // If a focus string is provided, try to center the window around it
    if (focusText) {
      const idx = normalized.toLowerCase().indexOf(focusText.toLowerCase());
      if (idx >= 0) {
        const matchEnd = idx + focusText.length;
        const half = Math.floor((maxLength - focusText.length) / 2);
        let start = Math.max(0, idx - half);
        let end = Math.min(normalized.length, start + maxLength - 1);
        // If we hit the end, shift start back
        if (end >= normalized.length) {
          end = normalized.length;
          start = Math.max(0, end - maxLength + 1);
        }
        const prefix = start > 0 ? '…' : '';
        const suffix = end < normalized.length ? '…' : '';
        return `${prefix}${normalized.slice(start, end).trim()}${suffix}`;
      }
    }

    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }

  private extractParagraphPreview(lines: string[], lineNumber: number): string {
    let start = lineNumber;
    while (start - 1 >= 0) {
      const prev = lines[start - 1] || '';
      if (!prev.trim()) break;
      if (/^\s*#{1,6}\s/.test(prev)) break;
      if (/^\s*```/.test(prev)) break;
      start -= 1;
    }

    let end = lineNumber;
    while (end + 1 < lines.length) {
      const next = lines[end + 1] || '';
      if (!next.trim()) break;
      if (/^\s*#{1,6}\s/.test(next)) break;
      if (/^\s*```/.test(next)) break;
      end += 1;
    }

    return lines.slice(start, end + 1).join(' ');
  }

  private extractSectionPreview(lines: string[], lineNumber: number): string {
    let start = lineNumber;
    while (start - 1 >= 0) {
      const prev = lines[start - 1] || '';
      if (/^\s*#{1,6}\s/.test(prev)) {
        start -= 1;
        break;
      }
      start -= 1;
    }
    start = Math.max(0, start);

    let end = lineNumber;
    while (end + 1 < lines.length) {
      const next = lines[end + 1] || '';
      if (/^\s*#{1,6}\s/.test(next)) break;
      end += 1;
    }

    return lines.slice(start, end + 1).join(' ');
  }

  private groupReferenceOccurrences(
    occurrences: ReferenceOccurrence[],
    direction: ReferenceDirection
  ): ReferenceGroup[] {
    const grouped = new Map<string, ReferenceGroup>();

    for (const occurrence of occurrences) {
      const file = direction === 'outgoing' ? occurrence.targetFile : occurrence.sourceFile;
      const existing = grouped.get(file.path);
      if (existing) {
        existing.occurrences.push(occurrence);
        continue;
      }
      grouped.set(file.path, { file, direction, occurrences: [occurrence] });
    }

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        occurrences: group.occurrences.sort((a, b) => a.lineNumber - b.lineNumber),
      }))
      .sort((a, b) => this.getFileDisplayTitle(a.file).localeCompare(this.getFileDisplayTitle(b.file)));
  }

  private async collectUnlinkedMentionGroups(rootFile: TFile): Promise<MentionGroup[]> {
    const candidateTitles = this.getMentionCandidateTitles(rootFile);
    if (candidateTitles.length === 0) return [];

    const markdownFiles = this.app.vault.getMarkdownFiles();
    const groups: MentionGroup[] = [];

    for (const sourceFile of markdownFiles) {
      if (sourceFile.path === rootFile.path) continue;
      const occurrences = await this.extractUnlinkedMentionsFromSource(sourceFile, rootFile, candidateTitles);
      if (occurrences.length === 0) continue;
      groups.push({
        file: sourceFile,
        occurrences,
      });
    }

    return groups.sort((a, b) => this.getFileDisplayTitle(a.file).localeCompare(this.getFileDisplayTitle(b.file)));
  }

  private getMentionCandidateTitles(rootFile: TFile): string[] {
    const values = new Set<string>([rootFile.basename]);
    const cache = this.app.metadataCache.getFileCache(rootFile);
    const frontmatter = (cache?.frontmatter || {}) as Record<string, any>;
    const titleValue = this.getFrontmatterValueCaseInsensitive(frontmatter, 'title');
    if (typeof titleValue === 'string' && titleValue.trim()) {
      values.add(titleValue.trim());
    }

    return Array.from(values)
      .map((value) => String(value || '').trim())
      .filter((value) => value.length >= 3)
      .sort((a, b) => b.length - a.length);
  }

  private getFileDisplayTitle(file: TFile): string {
    // Check cache first to avoid metadata cache lookups
    const cached = this.fileTitleCache.get(file.path);
    if (cached !== undefined) {
      return cached;
    }

    const frontmatter = (this.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, any>;
    const titleValue = this.getFrontmatterValueCaseInsensitive(frontmatter, 'title');
    const title = getPlainDisplayTitle(titleValue, file.basename);

    // Cache the result
    this.fileTitleCache.set(file.path, title);
    return title;
  }

  /**
   * Clear the cached display title for a file when its metadata changes.
   * This prevents stale titles from being shown after frontmatter updates.
   */
  public clearFileTitleCache(filePath: string): void {
    this.fileTitleCache.delete(filePath);
  }

  private async extractUnlinkedMentionsFromSource(
    sourceFile: TFile,
    targetFile: TFile,
    candidateTitles: string[]
  ): Promise<ReferenceOccurrence[]> {
    if (sourceFile.extension?.toLowerCase() !== 'md') return [];

    try {
      const raw = await this.app.vault.cachedRead(sourceFile);
      const lines = raw.split('\n');
      const frontmatterEndLine = this.getFrontmatterEndLine(sourceFile, raw);
      const headings = Array.isArray((this.app.metadataCache.getFileCache(sourceFile) as any)?.headings)
        ? ((this.app.metadataCache.getFileCache(sourceFile) as any)?.headings as any[])
        : [];

      const existingReferenceLineNumbers = new Set(
        (await this.extractReferenceOccurrencesFromSource(sourceFile, targetFile)).map((occurrence) => occurrence.lineNumber)
      );

      const occurrences: ReferenceOccurrence[] = [];

      // Scan body lines
      let inFence = false;
      for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
        if (lineNumber <= frontmatterEndLine) continue;
        const line = lines[lineNumber] || '';
        if (line.trimStart().startsWith('```')) {
          inFence = !inFence;
          continue;
        }
        if (inFence || !line.trim() || existingReferenceLineNumbers.has(lineNumber)) continue;

        const matchedText = this.findMentionInLine(line, candidateTitles);
        if (!matchedText) continue;

        occurrences.push({
          sourceFile,
          targetFile,
          lineNumber,
          heading: this.findHeadingForLine(headings, lineNumber),
          previews: this.buildReferencePreviewLevels(lines, lineNumber, matchedText),
          matchedText,
        });
      }

      return occurrences;
    } catch (error) {
      logger.warn('[TPS GCM] Failed extracting unlinked mentions for', sourceFile.path, error);
      return [];
    }
  }

  private findMentionInLine(line: string, candidateTitles: string[]): string {
    const source = String(line || '');
    for (const candidate of candidateTitles) {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(^|[^\\w])(${escaped})(?=$|[^\\w])`, 'i');
      const match = source.match(regex);
      if (match?.[2]) {
        return match[2];
      }
    }
    return '';
  }

  private renderReferencesSection(
    body: HTMLElement,
    references: ReferenceData,
    rootFile: TFile,
    forceShowAll = false
  ): void {
    body.innerHTML = '';
    const showReferences = forceShowAll;
    const showMentions = forceShowAll;

    const bodyOutgoing = references.outgoing
      .map((group) => ({ ...group, occurrences: group.occurrences.filter((o) => !o.frontmatterKey) }))
      .filter((group) => group.occurrences.length > 0);
    const bodyIncoming = references.incoming
      .map((group) => ({ ...group, occurrences: group.occurrences.filter((o) => !o.frontmatterKey) }))
      .filter((group) => group.occurrences.length > 0);
    const bodyMentions = references.mentions
      .map((group) => ({ ...group, occurrences: group.occurrences.filter((o) => !o.frontmatterKey) }))
      .filter((group) => group.occurrences.length > 0);

    const fmByKey = new Map<string, Array<{ file: TFile; occurrence: ReferenceOccurrence }>>();
    const collectFrontmatter = (groups: Array<{ file: TFile; occurrences: ReferenceOccurrence[] }>) => {
      for (const group of groups) {
        for (const occurrence of group.occurrences) {
          if (!occurrence.frontmatterKey) continue;
          if (!fmByKey.has(occurrence.frontmatterKey)) {
            fmByKey.set(occurrence.frontmatterKey, []);
          }
          fmByKey.get(occurrence.frontmatterKey)?.push({ file: group.file, occurrence });
        }
      }
    };
    collectFrontmatter(references.outgoing);
    collectFrontmatter(references.incoming);
    collectFrontmatter(references.mentions);

    const ignoredKeys = new Set(
      (this.plugin.settings.ignoredBacklinksFrontmatterKeys || []).map((key: string) => key.toLowerCase())
    );
    for (const key of [...fmByKey.keys()]) {
      if (ignoredKeys.has(key.toLowerCase())) {
        fmByKey.delete(key);
      }
    }

    if (
      (!showReferences || (bodyOutgoing.length === 0 && bodyIncoming.length === 0 && fmByKey.size === 0))
      && (!showMentions || bodyMentions.length === 0)
    ) {
      const empty = document.createElement('div');
      empty.className = 'tps-gcm-subitem-empty';
      empty.textContent = 'No references yet.';
      body.appendChild(empty);
      return;
    }

    if (showReferences && bodyOutgoing.length > 0) {
      body.appendChild(this.createOutgoingReferenceSection(bodyOutgoing));
    }

    if (showReferences && bodyIncoming.length > 0) {
      body.appendChild(this.createReferenceDirectionSection('Incoming', bodyIncoming, 'incoming'));
    }

    if (showMentions && bodyMentions.length > 0) {
      body.appendChild(this.createMentionsSection(bodyMentions, rootFile));
    }

    if (showReferences && fmByKey.size > 0) {
      body.appendChild(this.createFrontmatterReferenceSection(fmByKey));
    }
  }

  private createReferenceDirectionSection(
    label: string,
    groups: ReferenceGroup[],
    mode: 'incoming'
  ): HTMLElement {
    const section = document.createElement('div');
    section.className = 'tps-gcm-reference-direction';

    const title = document.createElement('div');
    title.className = 'tps-gcm-reference-direction-title';
    title.textContent = label;
    section.appendChild(title);

    const fragment = document.createDocumentFragment();
    groups.forEach((group) => {
      fragment.appendChild(this.createReferenceGroup(group, mode));
    });
    section.appendChild(fragment);
    return section;
  }

  private createOutgoingReferenceSection(groups: ReferenceGroup[]): HTMLElement {
    const section = document.createElement('div');
    section.className = 'tps-gcm-reference-direction';

    const title = document.createElement('div');
    title.className = 'tps-gcm-reference-direction-title';
    title.textContent = 'Outgoing';
    section.appendChild(title);

    const list = document.createElement('div');
    list.className = 'tps-gcm-reference-simple-list';
    section.appendChild(list);

    const fragment = document.createDocumentFragment();
    groups.forEach((group) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tps-gcm-reference-simple-item tps-gcm-reference-link-target';
      button.textContent = this.getFileDisplayTitle(group.file);
      button.title = group.file.path;
      addSafeClickListener(button, () => {
        void this.plugin.openFileInLeaf(group.file, false, () => this.app.workspace.getLeaf(false), { revealLeaf: true });
      });
      fragment.appendChild(button);
    });
    list.appendChild(fragment);
    return section;
  }

  private createReferenceGroup(group: ReferenceGroup, mode: 'incoming'): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'tps-gcm-reference-group';

    const header = document.createElement('div');
    header.className = 'tps-gcm-reference-group-header';
    wrap.appendChild(header);

    const titleButton = document.createElement('button');
    titleButton.type = 'button';
    titleButton.className = 'tps-gcm-reference-group-title tps-gcm-reference-link-target';
    titleButton.textContent = this.getFileDisplayTitle(group.file);
    titleButton.title = group.file.path;
    addSafeClickListener(titleButton, () => {
      void this.openReferenceOccurrence(group.file, group.occurrences[0]);
    });
    header.appendChild(titleButton);

    const countBadge = document.createElement('span');
    countBadge.className = 'tps-gcm-reference-count';
    countBadge.textContent = `${group.occurrences.length}`;
    header.appendChild(countBadge);

    const occurrencesWrap = document.createElement('div');
    occurrencesWrap.className = 'tps-gcm-reference-occurrences';
    wrap.appendChild(occurrencesWrap);

    const fragment = document.createDocumentFragment();
    group.occurrences.forEach((occurrence) => {
      fragment.appendChild(this.createReferenceOccurrenceRow(occurrence, mode));
    });
    occurrencesWrap.appendChild(fragment);

    return wrap;
  }

  private createReferenceOccurrenceRow(occurrence: ReferenceOccurrence, mode: 'incoming' | 'mention'): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tps-gcm-reference-occurrence';

    const meta = document.createElement('div');
    meta.className = 'tps-gcm-reference-occurrence-meta';
    meta.textContent = occurrence.heading
      ? `${occurrence.heading} • line ${occurrence.lineNumber + 1}`
      : `line ${occurrence.lineNumber + 1}`;
    row.appendChild(meta);

    const preview = document.createElement('div');
    preview.className = 'tps-gcm-reference-preview';
    let previewIndex = 0;
    this.renderReferencePreview(preview, occurrence.previews[previewIndex] || '', occurrence);
    row.appendChild(preview);

    const actions = document.createElement('div');
    actions.className = 'tps-gcm-reference-actions';

    if (occurrence.previews.length > 1) {
      const moreBtn = this.createSubitemActionButton('More', () => {
        if (previewIndex < occurrence.previews.length - 1) {
          previewIndex += 1;
        } else {
          previewIndex = 0;
        }
        this.renderReferencePreview(preview, occurrence.previews[previewIndex] || '', occurrence);
        moreBtn.textContent = previewIndex < occurrence.previews.length - 1 ? 'More' : 'Less';
      });
      actions.appendChild(moreBtn);
    }

    const openBtn = this.createSubitemActionButton('Open', () => {
      void this.openReferenceOccurrence(occurrence.sourceFile, occurrence);
    });
    actions.appendChild(openBtn);
    row.appendChild(actions);

    return row;
  }

  private renderReferencePreview(container: HTMLElement, previewText: string, occurrence: ReferenceOccurrence): void {
    container.empty();
    const text = String(previewText || '');
    const matchedText = String(occurrence.matchedText || '').trim();
    const linkPattern = /(!?\[\[[^\]\n]+?\]\]|\[[^\]\n]+?\]\([^) \n]+(?:%20|[^)\n])*?\))/g;
    let cursor = 0;

    const appendHighlightedText = (value: string) => {
      if (!value) return;
      if (!matchedText) {
        container.appendChild(document.createTextNode(value));
        return;
      }
      const source = value.toLowerCase();
      const needle = matchedText.toLowerCase();
      let localCursor = 0;
      let index = source.indexOf(needle);
      while (index !== -1) {
        if (index > localCursor) {
          container.appendChild(document.createTextNode(value.slice(localCursor, index)));
        }
        const mark = document.createElement('mark');
        mark.className = 'tps-gcm-reference-match';
        mark.textContent = value.slice(index, index + matchedText.length);
        container.appendChild(mark);
        localCursor = index + matchedText.length;
        index = source.indexOf(needle, localCursor);
      }
      if (localCursor < value.length) {
        container.appendChild(document.createTextNode(value.slice(localCursor)));
      }
    };

    for (const match of text.matchAll(linkPattern)) {
      const token = match[0];
      const start = match.index ?? 0;
      appendHighlightedText(text.slice(cursor, start));
      container.appendChild(this.createReferencePreviewLink(token, occurrence));
      cursor = start + token.length;
    }
    appendHighlightedText(text.slice(cursor));
  }

  private createReferencePreviewLink(token: string, occurrence: ReferenceOccurrence): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tps-gcm-reference-preview-link';
    const label = this.getReferencePreviewLinkLabel(token);
    button.textContent = label;
    button.title = token;
    addSafeClickListener(button, () => {
      const targetFile = occurrence.targetFile || resolveLinkTargetToFile(this.app, label, occurrence.sourceFile.path);
      if (targetFile instanceof TFile) {
        void this.plugin.openFileInLeaf(targetFile, false, () => this.app.workspace.getLeaf(false), { revealLeaf: true });
        return;
      }
      void this.openReferenceOccurrence(occurrence.sourceFile, occurrence);
    });
    return button;
  }

  private getReferencePreviewLinkLabel(token: string): string {
    const wiki = token.match(/^!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]$/);
    if (wiki) return String(wiki[2] || wiki[1] || token).trim();
    const markdown = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (markdown) return String(markdown[1] || markdown[2] || token).trim();
    return token;
  }

  private createMentionsSection(groups: MentionGroup[], rootFile: TFile): HTMLElement {
    const section = document.createElement('div');
    section.className = 'tps-gcm-reference-direction';

    const title = document.createElement('div');
    title.className = 'tps-gcm-reference-direction-title';
    title.textContent = 'Mentions';
    section.appendChild(title);

    const fragment = document.createDocumentFragment();
    groups.forEach((group) => {
      const wrap = document.createElement('div');
      wrap.className = 'tps-gcm-reference-group';

      const header = document.createElement('div');
      header.className = 'tps-gcm-reference-group-header';
      wrap.appendChild(header);

      const titleButton = document.createElement('button');
      titleButton.type = 'button';
      titleButton.className = 'tps-gcm-reference-group-title tps-gcm-reference-link-target';
      titleButton.textContent = this.getFileDisplayTitle(group.file);
      titleButton.title = group.file.path;
      addSafeClickListener(titleButton, () => {
        void this.openReferenceOccurrence(group.file, group.occurrences[0]);
      });
      header.appendChild(titleButton);

      const countBadge = document.createElement('span');
      countBadge.className = 'tps-gcm-reference-count';
      countBadge.textContent = `${group.occurrences.length}`;
      header.appendChild(countBadge);

      const occurrencesWrap = document.createElement('div');
      occurrencesWrap.className = 'tps-gcm-reference-occurrences';
      wrap.appendChild(occurrencesWrap);

      const innerFragment = document.createDocumentFragment();
      group.occurrences.forEach((occurrence) => {
        const row = this.createReferenceOccurrenceRow(occurrence, 'mention');
        const actions = row.querySelector('.tps-gcm-reference-actions');
        if (actions instanceof HTMLElement) {
          const linkBtn = this.createSubitemActionButton('Link', () => {
            void this.convertMentionToLinkedReference(rootFile, occurrence, row);
          });
          actions.insertBefore(linkBtn, actions.firstChild);
        }
        innerFragment.appendChild(row);
      });
      occurrencesWrap.appendChild(innerFragment);
      fragment.appendChild(wrap);
    });

    section.appendChild(fragment);
    return section;
  }

  private createFrontmatterReferenceSection(
    fmByKey: Map<string, Array<{ file: TFile; occurrence: ReferenceOccurrence }>>
  ): HTMLElement {
    const section = document.createElement('div');
    section.className = 'tps-gcm-reference-direction tps-gcm-reference-direction--frontmatter';

    const title = document.createElement('div');
    title.className = 'tps-gcm-reference-direction-title';
    title.textContent = 'Frontmatter';
    section.appendChild(title);

    for (const [key, entries] of fmByKey) {
      const keySection = document.createElement('div');
      keySection.className = 'tps-gcm-reference-frontmatter-group';

      const keyTitle = document.createElement('div');
      keyTitle.className = 'tps-gcm-reference-frontmatter-title';
      keyTitle.textContent = key;
      keySection.appendChild(keyTitle);

      const chips = document.createElement('div');
      chips.className = 'tps-gcm-reference-frontmatter-chips';
      keySection.appendChild(chips);

      entries.forEach(({ file, occurrence }) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tps-gcm-reference-frontmatter-chip';
        chip.textContent = this.getFileDisplayTitle(file);
        chip.title = file.path;
        addSafeClickListener(chip, () => {
          void this.openReferenceOccurrence(occurrence.sourceFile, occurrence);
        });
        chips.appendChild(chip);
      });

      section.appendChild(keySection);
    }

    return section;
  }

  private createNoteGraphSvg(rootFile: TFile, references: GraphData): SVGSVGElement {
    const svgNs = 'http://www.w3.org/2000/svg';
    const width = 250;
    const height = 144;
    const centerX = 125;
    const centerY = 64;
    const centerRadius = 10;

    const incoming = references.incoming;
    const outgoing = references.outgoing;
    const mentions = references.mentions;

    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'tps-gcm-note-graph-svg');

    const lanes = [
      { items: incoming, x: 48, relation: 'incoming', color: 'var(--text-accent)' },
      { items: outgoing, x: 202, relation: 'outgoing', color: '#7fc7ff' },
      { items: mentions, x: 125, relation: 'mention', color: '#d6b8ff' },
    ] as const;

    const halo = document.createElementNS(svgNs, 'circle');
    halo.setAttribute('cx', String(centerX));
    halo.setAttribute('cy', String(centerY));
    halo.setAttribute('r', '32');
    halo.setAttribute('class', 'tps-gcm-note-graph-root-halo');
    svg.appendChild(halo);

    const makeNode = (item: TFile, relation: string, color: string, x: number, y: number) => {
      const edge = document.createElementNS(svgNs, 'path');
      const controlX = x < centerX ? centerX - 34 : x > centerX ? centerX + 34 : centerX;
      const controlY = (centerY + y) / 2;
      edge.setAttribute('d', `M ${centerX} ${centerY} Q ${controlX} ${controlY} ${x} ${y}`);
      edge.setAttribute('class', 'tps-gcm-note-graph-edge');
      edge.setAttribute('stroke', color);
      svg.appendChild(edge);

      const node = document.createElementNS(svgNs, 'circle');
      node.setAttribute('cx', String(x));
      node.setAttribute('cy', String(y));
      node.setAttribute('r', '5.5');
      node.setAttribute('fill', color);
      node.setAttribute('class', 'tps-gcm-note-graph-node');
      node.setAttribute('data-path', item.path);
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `${relation}: ${item.basename}`);
      const tooltip = document.createElementNS(svgNs, 'title');
      tooltip.textContent = `${relation}: ${item.basename}`;
      node.appendChild(tooltip);
      const openTarget = () => {
        void this.plugin.openFileInLeaf(item, false, () => this.app.workspace.getLeaf(false), { revealLeaf: true });
      };
      node.addEventListener('click', (evt) => {
        evt.stopPropagation();
        openTarget();
      });
      node.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault();
          openTarget();
        }
      });
      svg.appendChild(node);
    };

    lanes.forEach((lane) => {
      const count = lane.items.length;
      lane.items.forEach((item, index) => {
        const y = count <= 1
          ? (lane.x === centerX ? 110 : centerY)
          : 28 + (index * 72) / Math.max(1, count - 1);
        makeNode(item, lane.relation, lane.color, lane.x, y);
      });
    });

    const centerNode = document.createElementNS(svgNs, 'circle');
    centerNode.setAttribute('cx', String(centerX));
    centerNode.setAttribute('cy', String(centerY));
    centerNode.setAttribute('r', String(centerRadius));
    centerNode.setAttribute('class', 'tps-gcm-note-graph-root-node');
    svg.appendChild(centerNode);

    const rootLabel = document.createElementNS(svgNs, 'text');
    rootLabel.setAttribute('x', String(centerX));
    rootLabel.setAttribute('y', String(centerY + 30));
    rootLabel.setAttribute('text-anchor', 'middle');
    rootLabel.setAttribute('class', 'tps-gcm-note-graph-root-label');
    rootLabel.textContent = this.truncateGraphLabel(rootFile.basename, 18);
    svg.appendChild(rootLabel);

    const footer = document.createElementNS(svgNs, 'text');
    footer.setAttribute('x', String(centerX));
    footer.setAttribute('y', String(height - 8));
    footer.setAttribute('text-anchor', 'middle');
    footer.setAttribute('class', 'tps-gcm-note-graph-meta');
    footer.textContent = `${incoming.length} in • ${outgoing.length} out${mentions.length ? ` • ${mentions.length} mentions` : ''}`;
    svg.appendChild(footer);

    return svg;
  }

  private truncateGraphLabel(value: string, maxLength = 12): string {
    const normalized = String(value || '').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }

  async openReferenceOccurrence(file: TFile, occurrence: ReferenceOccurrence): Promise<void> {
    const opened = await this.plugin.openFileInLeaf(file, false, () => this.app.workspace.getLeaf(false), { revealLeaf: true });
    if (!opened) return;

    window.setTimeout(() => {
      const markdownView = this.app.workspace.getLeavesOfType('markdown')
        .map((leaf) => leaf.view)
        .find((view: any) => view?.file?.path === file.path) as any;
      const editor = markdownView?.editor;
      if (!editor || typeof editor.setCursor !== 'function') return;
      try {
        editor.setCursor({ line: occurrence.lineNumber, ch: 0 });
        if (typeof editor.scrollIntoView === 'function') {
          editor.scrollIntoView({ from: { line: occurrence.lineNumber, ch: 0 }, to: { line: occurrence.lineNumber + 1, ch: 0 } }, true);
        }
      } catch (error) {
        logger.warn('[TPS GCM] Failed focusing reference occurrence for', file.path, error);
      }
    }, 60);
  }

  async convertMentionToLinkedReference(
    targetFile: TFile,
    occurrence: ReferenceOccurrence,
    rowEl: HTMLElement
  ): Promise<void> {
    const matchedText = String(occurrence.matchedText || '').trim();
    if (!matchedText) return;

    try {
      const content = await this.app.vault.read(occurrence.sourceFile);
      const lines = content.split('\n');
      if (occurrence.lineNumber < 0 || occurrence.lineNumber >= lines.length) return;

      const currentLine = lines[occurrence.lineNumber] || '';
      const escaped = matchedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(^|[^\\w])(${escaped})(?=$|[^\\w])`);
      const markdownLink = this.app.fileManager.generateMarkdownLink(targetFile, occurrence.sourceFile.path, undefined, matchedText);
      const replacedLine = currentLine.replace(regex, (full, prefix) => `${prefix}${markdownLink}`);
      if (replacedLine === currentLine) return;

      lines[occurrence.lineNumber] = replacedLine;
      const updatedContent = lines.join('\n');
      if (updatedContent === content) return;

      await this.app.vault.modify(occurrence.sourceFile, updatedContent);
      rowEl.style.opacity = '0';
      rowEl.style.pointerEvents = 'none';
      window.setTimeout(() => {
        rowEl.remove();
      }, 120);
    } catch (error) {
      logger.warn('[TPS GCM] Failed converting mention to linked reference for', occurrence.sourceFile.path, error);
    }
  }

  private async buildSubitemTree(rootFile: TFile): Promise<SubitemNode[]> {
    const parentIndex = this.subitemMetadataService.buildParentToChildrenIndex();
    const visited = new Set<string>([normalizePath(rootFile.path)]);
    return this.buildSubitemTreeRecursive(rootFile, parentIndex, visited, 0);
  }

  private async buildSubitemTreeRecursive(
    file: TFile,
    parentIndex: Map<string, TFile[]>,
    visited: Set<string>,
    depth: number
  ): Promise<SubitemNode[]> {
    if (depth >= MAX_SUBITEM_DEPTH) return [];

    const relationMap = await this.collectDirectSubitemRelations(file, parentIndex);
    const identityCache = new Map<string, ReturnType<SubitemMetadataService['getTaskIdentityForFile']>>();
    const getIdentity = (targetFile: TFile) => {
      const cached = identityCache.get(targetFile.path);
      if (cached) return cached;
      const resolved = this.subitemMetadataService.getTaskIdentityForFile(targetFile);
      identityCache.set(targetFile.path, resolved);
      return resolved;
    };

    // Mark archived / completed children as hidden (they can be shown via the toggle)
    type MarkedEntry = SubitemRelationEntry & { hidden: boolean };
    const markedEntries: MarkedEntry[] = Array.from(relationMap.values())
      .filter((entry) => !this.shouldIgnoreSubitemFile(entry.file))
      .map((entry) => {
      const identity = getIdentity(entry.file);
      const isHidden =
        this.isArchived(entry.file) ||
        identity.isComplete ||
        identity.isWontDo;
      return { ...entry, hidden: isHidden };
    });

    const relationEntries = markedEntries.sort((a, b) => {
      // 1. Custom Sort Key from Companion (if configured)
      const sortField = this.getSortField();
      if (sortField) {
        const aCache = this.app.metadataCache.getFileCache(a.file);
        const bCache = this.app.metadataCache.getFileCache(b.file);

        // Case-insensitive lookup
        const getVal = (fm: any, key: string) => {
          if (!fm) return undefined;
          if (key in fm) return fm[key];
          const lowerKey = key.toLowerCase();
          for (const k of Object.keys(fm)) {
            if (k.toLowerCase() === lowerKey) return fm[k];
          }
          return undefined;
        };

        const aVal = getVal(aCache?.frontmatter, sortField);
        const bVal = getVal(bCache?.frontmatter, sortField);

        const hasA = aVal !== undefined && aVal !== null && aVal !== '';
        const hasB = bVal !== undefined && bVal !== null && bVal !== '';

        if (hasA && hasB) {
          // Both have sort value: compare them
          // Try numeric sort if both are numbers
          const aNum = Number(aVal);
          const bNum = Number(bVal);
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return aNum - bNum;
          }
          // Fallback to string sort
          return String(aVal).localeCompare(String(bVal));
        }
        if (hasA && !hasB) return -1; // A comes first
        if (!hasA && hasB) return 1;  // B comes first
      }

      // 2. Existing fallback logic
      const aChild = a.relations.has('child') ? 0 : 1;
      const bChild = b.relations.has('child') ? 0 : 1;
      if (aChild !== bChild) return aChild - bChild;
      const aMd = a.file.extension?.toLowerCase() === 'md' ? 0 : 1;
      const bMd = b.file.extension?.toLowerCase() === 'md' ? 0 : 1;
      // Status sort
      const statusWeight = (file: TFile) => {
        const identity = getIdentity(file);
        if (identity.isComplete || identity.isWontDo) return 4;
        if (identity.allStatuses.some((status) => status === 'working' || status === 'in-progress')) return 1;
        if (identity.allStatuses.includes('blocked')) return 2;
        if (identity.isPending || identity.allStatuses.length === 0) return 3;
        return 5;
      };

      const aStatus = statusWeight(a.file);
      const bStatus = statusWeight(b.file);
      if (aStatus !== bStatus) return aStatus - bStatus;

      return this.getFileDisplayTitle(a.file).localeCompare(this.getFileDisplayTitle(b.file));
    });

    const nodes: SubitemNode[] = [];
    for (const entry of relationEntries) {
      const targetPath = normalizePath(entry.file.path);
      if (visited.has(targetPath)) continue;

      const nextVisited = new Set(visited);
      nextVisited.add(targetPath);

      const childNodes = entry.file.extension?.toLowerCase() === 'md'
        ? await this.buildSubitemTreeRecursive(entry.file, parentIndex, nextVisited, depth + 1)
        : [];

      nodes.push({
        file: entry.file,
        relations: Array.from(entry.relations.values()),
        children: childNodes,
        hidden: entry.hidden,
      });
    }

    return nodes;
  }

  private getSortField(): string {
    return this.plugin.notebookNavigatorRuleService.getSortField();
  }

  private isArchived(file: TFile): boolean {
    const archiveFolder = this.plugin.getArchiveFolderPath();
    if (!archiveFolder) {
      return false;
    }
    if (file.path.startsWith(`${archiveFolder}/`)) {
      return true;
    }

    const archiveTag = normalizeTagValue(this.plugin.settings.archiveTag || 'archive');
    if (archiveTag) {
      const cache = this.app.metadataCache.getFileCache(file);
      const tags = getAllTags(cache) || [];
      // Check for exact tag or nested tag match
      if (tags.some(t => {
        const norm = normalizeTagValue(t);
        return norm === archiveTag || norm.startsWith(`${archiveTag}/`);
      })) {
        return true;
      }
    }

    return false;
  }

  private shouldIgnoreSubitemFile(file: TFile): boolean {
    const ignored = new Set(
      (this.plugin.settings.ignoredSubitemTags || [])
        .map((tag) => normalizeTagValue(tag))
        .filter(Boolean),
    );
    if (ignored.size === 0) return false;
    const cache = this.app.metadataCache.getFileCache(file);
    const normalizedTags = parseTagInput([
      ...(getAllTags(cache) || []),
      (cache?.frontmatter as Record<string, any> | undefined)?.tags,
      (cache?.frontmatter as Record<string, any> | undefined)?.tag,
    ])
      .map((tag) => normalizeTagValue(tag))
      .filter(Boolean);
    return normalizedTags.some((tag) => ignored.has(tag));
  }

  private async collectDirectSubitemRelations(
    file: TFile,
    parentIndex: Map<string, TFile[]>
  ): Promise<Map<string, SubitemRelationEntry>> {
    return this.subitemMetadataService.collectDirectSubitemRelations(file, parentIndex);
  }

  private getFrontmatterValueCaseInsensitive(
    frontmatter: Record<string, any> | null | undefined,
    key: string
  ): any {
    return this.subitemMetadataService.getFrontmatterValueCaseInsensitive(frontmatter, key);
  }

  private setFrontmatterValueCaseInsensitive(
    frontmatter: Record<string, any>,
    key: string,
    value: any
  ): void {
    this.subitemMetadataService.setFrontmatterValueCaseInsensitive(frontmatter, key, value);
  }

  private createSubitemRow(
    container: HTMLElement,
    node: SubitemNode,
    depth: number,
    rootFile: TFile,
    onRefresh: () => void
  ): void {
    const entry = this.delegates.createFileEntries([node.file])[0];
    const fm = this.subitemMetadataService.getResolvedFrontmatter(node.file, (entry?.frontmatter || {}) as Record<string, any>);
    const relationSet = new Set(node.relations || []);
    const isAttachmentOnly = relationSet.has('attachment') && !relationSet.has('child');
    const row = document.createElement('div');
    row.className = 'tps-gcm-subitem-row';
    row.style.setProperty('--tps-gcm-subitem-depth', String(depth));
    row.dataset.path = node.file.path;
    row.dataset.file = node.file.path;
    row.dataset.relation = isAttachmentOnly ? 'attachment' : 'child';
    if (isAttachmentOnly) {
      row.classList.add('tps-gcm-subitem-row--attachment');
    }
    if (node.hidden) {
      row.classList.add('tps-gcm-subitem-row--hidden');
    }

    // Drag support
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', node.file.path);
      e.dataTransfer?.setData('application/tps-gcm-subitem', JSON.stringify({
        path: node.file.path,
        relation: isAttachmentOnly ? 'attachment' : 'child',
        rootPath: rootFile.path,
      }));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      row.classList.add('tps-gcm-subitem-row--dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('tps-gcm-subitem-row--dragging');
    });

    row.addEventListener('contextmenu', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const menu = new Menu();
      if (isAttachmentOnly) {
        menu.addItem((item) => {
          item
            .setTitle('Remove attachment')
            .setIcon('unlink')
            .onClick(() => {
              void this.plugin.bulkEditService.unlinkAttachmentWithOutcome(rootFile, node.file).then((outcome) => {
                this.showAttachmentUnlinkResult(outcome, node.file);
                onRefresh();
              }).catch((error) => this.reportAsyncPanelActionFailure('Remove attachment', error));
            });
        });
      } else {
        menu.addItem((item) => {
          item
            .setTitle('Unlink from parent')
            .setIcon('unlink')
            .onClick(() => {
              void this.plugin.bulkEditService.unlinkFromParentWithOutcome(node.file, rootFile).then((outcome) => {
                this.showParentUnlinkResult(outcome, node.file, rootFile);
                onRefresh();
              }).catch((error) => this.reportAsyncPanelActionFailure('Unlink from parent', error));
            });
        });
        menu.addItem((item) => {
          item
            .setTitle('Unlink from all parents')
            .setIcon('unlink-2')
            .onClick(() => {
              void this.plugin.bulkEditService.unlinkFromAllParentsWithOutcome(node.file).then((outcome) => {
                this.showParentUnlinkAggregateResult(outcome, node.file);
                onRefresh();
              }).catch((error) => this.reportAsyncPanelActionFailure('Unlink from all parents', error));
            });
        });
      }
      menu.showAtMouseEvent(evt);
    });

    const content = document.createElement('div');
    content.className = 'tps-gcm-subitem-content';

    const header = document.createElement('div');
    header.className = 'tps-gcm-subitem-header';

    const iconEl = document.createElement('span');
    iconEl.className = 'tps-gcm-subitem-icon';
    this.subitemMetadataService.createSubitemIcon(iconEl, node.file, fm);
    header.appendChild(iconEl);

    const textWrap = document.createElement('div');
    textWrap.className = 'tps-gcm-subitem-text';

    const titleLine = document.createElement('div');
    titleLine.className = 'tps-gcm-subitem-title-line';

    const titleButton = document.createElement('button');
    titleButton.type = 'button';
    titleButton.className = 'tps-gcm-subitem-title';
    titleButton.textContent = this.getFileDisplayTitle(node.file);
    titleButton.title = node.file.path;
    addSafeClickListener(titleButton, () => this.openFileInPreferredLeaf(node.file));
    titleLine.appendChild(titleButton);

    if (!isAttachmentOnly) {
      const inlineStrip = this.createSubitemInlinePropertyStrip([entry]);
      if (inlineStrip && inlineStrip.childElementCount > 0) {
        titleLine.appendChild(inlineStrip);
      }
    }

    const metaRow = document.createElement('div');
    metaRow.className = 'tps-gcm-subitem-meta';

    if (isAttachmentOnly) {
      const relationBadge = document.createElement('span');
      relationBadge.className = 'tps-gcm-subitem-relation tps-gcm-subitem-relation--attachment';
      relationBadge.textContent = 'attachment';
      metaRow.appendChild(relationBadge);
    } else {
      const strip = this.createContextStrip([entry]);
      if (strip.childElementCount > 0) {
        strip.classList.add('tps-gcm-subitem-strip');
        metaRow.appendChild(strip);
      }
    }

    if (metaRow.childElementCount === 0) {
      const pathEl = document.createElement('span');
      pathEl.className = 'tps-gcm-subitem-path';
      pathEl.textContent = node.file.parent?.path || rootFile.parent?.path || '';
      if (pathEl.textContent) {
        metaRow.appendChild(pathEl);
      }
    }

    textWrap.appendChild(titleLine);
    if (metaRow.childElementCount > 0) {
      textWrap.appendChild(metaRow);
    }

    header.appendChild(textWrap);
    content.appendChild(header);

    row.appendChild(content);

    container.appendChild(row);

    if (node.children.length > 0) {
      const childrenWrap = document.createElement('div');
      childrenWrap.className = 'tps-gcm-subitem-children';
      container.appendChild(childrenWrap);
      node.children.forEach((child) => {
        this.createSubitemRow(childrenWrap, child, depth + 1, rootFile, onRefresh);
      });
    }
  }

  private createSubitemPillButton(label: string, kind: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tps-gcm-subitem-pill tps-gcm-subitem-pill--${kind}`;
    button.textContent = label;
    return button;
  }

  private createSubitemActionButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tps-gcm-subitem-action';
    button.textContent = label;
    addSafeClickListener(button, () => onClick());
    return button;
  }

  private createSubitemInlinePropertyStrip(entries: any[]): HTMLElement | null {
    const strip = document.createElement('div');
    strip.className = 'tps-gcm-subitem-strip tps-gcm-subitem-inline-strip';

    const properties = resolveCustomProperties(this.plugin.settings.properties || [], entries, new ViewModeService(), 'inline');
    const showInlineProperties = this.plugin.settings.showCustomPropertiesInInlineUi !== false;
    if (!showInlineProperties) return null;

    const entry = entries?.[0];
    const fm = (entry?.frontmatter || {}) as Record<string, any>;

    const statusProp = properties.find((p) => p.id === 'status' || p.key === 'status');
    const statusKey = String(statusProp?.key || 'status').trim() || 'status';
    const statusRaw = this.getFrontmatterValueCaseInsensitive(fm, statusKey);
    const currentStatus = Array.isArray(statusRaw)
      ? String(statusRaw.find((value) => String(value ?? '').trim()) ?? '').trim()
      : String(statusRaw ?? '').trim();
    if (statusProp && statusProp.showInCollapsed !== false && currentStatus) {
      strip.appendChild(this.createStatusChip(entries, statusProp));
    }

    const priorityProp = properties.find((p) => p.id === 'priority' || p.key === 'priority');
    const priorityKey = String(priorityProp?.key || 'priority').trim() || 'priority';
    const priorityRaw = this.getFrontmatterValueCaseInsensitive(fm, priorityKey);
    const currentPriority = Array.isArray(priorityRaw)
      ? String(priorityRaw.find((value) => String(value ?? '').trim()) ?? '').trim()
      : String(priorityRaw ?? '').trim();
    if (priorityProp && priorityProp.showInCollapsed !== false && currentPriority) {
      strip.appendChild(this.createPriorityChip(entries, priorityProp));
    }

    const dateProp = properties.find((p) => p.type === 'datetime' || p.key === 'scheduled');
    const dateKey = String(dateProp?.key || 'scheduled').trim() || 'scheduled';
    const dateRaw = this.getFrontmatterValueCaseInsensitive(fm, dateKey) ?? this.getFrontmatterValueCaseInsensitive(fm, 'date');
    if (dateProp && dateProp.showInCollapsed !== false && dateRaw) {
      strip.appendChild(this.createDateChip(entries, dateProp));
    }

    const tagsProp = properties.find((p) => p.id === 'tags' || p.key === 'tags');
    if (tagsProp && tagsProp.showInCollapsed !== false) {
      const tags = this.extractNormalizedTags(entries);
      for (const tag of tags) {
        strip.appendChild(this.createTagValueChip(tag, entries));
      }
    }

    const folderProp = properties.find((p) => p.id === 'type' || p.type === 'folder');
    if (folderProp && folderProp.showInCollapsed !== false) {
      strip.appendChild(this.createFolderChip(entries));
    }

    return strip.childElementCount > 0 ? strip : null;
  }

  private openFileInPreferredLeaf(file: TFile): void {
    this.actionService.openFileInPreferredLeaf(file);
  }

  private async promptLinkToParent(file: TFile, onRefresh: () => void): Promise<void> {
    new FileSuggestModal(this.app, async (parentFile: TFile) => {
      const linkedCount = await this.plugin.bulkEditService.linkToParent([file], parentFile);
      new Notice(linkedCount > 0
        ? `Linked ${file.basename} to parent: ${parentFile.basename}`
        : `No new parent link was added to ${parentFile.basename}.`);
      if (linkedCount > 0) onRefresh();
    }, { extensions: ['md', 'base'] }).open();
  }

  private async promptLinkChildren(file: TFile, onRefresh: () => void): Promise<void> {
    new MultiFileSelectModal(this.app, async (childFiles: TFile[]) => {
      const unique = childFiles.filter((candidate) => candidate.path !== file.path);
      if (!unique.length) return;
      const linkedCount = await this.plugin.bulkEditService.linkChildren(file, unique);
      new Notice(linkedCount > 0
        ? `Linked ${linkedCount} child item${linkedCount === 1 ? '' : 's'} to ${file.basename}.`
        : 'No new child links were added.');
      if (linkedCount > 0) onRefresh();
    }).open();
  }

  private async promptAttachFiles(parentFile: TFile, onRefresh: () => void): Promise<void> {
    await this.actionService.promptAttachFiles(parentFile, onRefresh);
  }

  private async changeRelationToAttachment(rootFile: TFile, childFile: TFile): Promise<void> {
    await this.actionService.changeRelationToAttachment(rootFile, childFile);
  }

  private async changeRelationToChild(rootFile: TFile, targetFile: TFile): Promise<void> {
    await this.actionService.changeRelationToChild(rootFile, targetFile);
  }

  private showSubitemAddMenu(event: MouseEvent, file: TFile): void {
    this.actionService.showSubitemAddMenu(event, file);
  }

  showInsertMenu(e: MouseEvent, entries: any[]) {
    this.actionService.showInsertMenu(e, entries);
  }

  showLinkMenu(e: MouseEvent, entries: any[]) {
    this.actionService.showLinkMenu(e, entries);
  }

  showOptionsMenu(e: MouseEvent, entries: any[]) {
    this.actionService.showOptionsMenu(e, entries);
  }

}
