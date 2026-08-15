import { App, Menu, TFile } from "obsidian";
import TPSGlobalContextMenuPlugin from "../main";
import { normalizeTagValue, parseTagInput } from '../utils/tag-utils';
import {
  getWikilinkDisplayText,
  isLinkListProperty,
  isTextListProperty,
  parseLinkListInput,
  parseMixedListInput,
  parseStringListInput,
} from '../utils/list-utils';
import { getEffectivePropertyOptions } from '../utils/property-options';
import { TextInputModal } from '../modals/text-input-modal';
import { extractWebLink } from '../utils/web-link-utils';
import { isEntityReferenceProperty } from '../utils/entity-property';
import { openPropertyValueSuggestModal } from '../modals/PropertyValueSuggestModal';
import * as logger from '../logger';

type Delegates = {
  addSafeClickListener: (element: HTMLElement, handler: (e: MouseEvent) => void) => void;
  showMenuAtAnchor: (menu: Menu, anchor: HTMLElement | MouseEvent | KeyboardEvent) => void;
  openAddTagModal: (entries: any[], key?: string) => void;
  openAddListValueModal: (entries: any[], key: string, label?: string) => void;
  triggerTagSearch: (tag: string) => void;
  openScheduledModal: (entries: any[], key?: string) => void;
  openRecurrenceModalNative: (entries: any[]) => void;
  moveFiles: (entries: any[], folderPath: string, writeGuard?: () => boolean) => Promise<void>;
  getTypeFolderOptions: () => { path: string; label: string }[];
  getRecurrenceValue: (fm: any) => string;
  formatDatetimeDisplay: (value: string | null | undefined) => string;
  hashStringToHue: (str: string) => number;
};

export class PropertyRowService {
  constructor(
    private app: App,
    private plugin: TPSGlobalContextMenuPlugin,
    private d: Delegates
  ) { }

  private getValueCaseInsensitive(frontmatter: any, key: string): any {
    if (!frontmatter || !key) return undefined;
    if (key in frontmatter) return frontmatter[key];
    const lowerKey = key.toLowerCase();
    const match = Object.keys(frontmatter).find(k => k.toLowerCase() === lowerKey);
    return match ? frontmatter[match] : undefined;
  }

  private hasKeyCaseInsensitive(frontmatter: any, key: string): boolean {
    if (!frontmatter || !key) return false;
    if (key in frontmatter) return true;
    const lowerKey = key.toLowerCase();
    return Object.keys(frontmatter).some((k) => k.toLowerCase() === lowerKey);
  }

  private setEntryFrontmatterValue(entries: any[], key: string, value: any): void {
    for (const entry of entries) {
      if (!entry.frontmatter || typeof entry.frontmatter !== 'object') entry.frontmatter = {};
      const existingKey = Object.keys(entry.frontmatter).find((candidate) => candidate.toLowerCase() === key.toLowerCase()) ?? key;
      entry.frontmatter[existingKey] = value;
    }
  }

  private removeEntryFrontmatterValue(entries: any[], key: string): void {
    for (const entry of entries) {
      if (!entry.frontmatter || typeof entry.frontmatter !== 'object') continue;
      const existingKey = Object.keys(entry.frontmatter).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      if (existingKey) delete entry.frontmatter[existingKey];
    }
  }

  private filesFromEntries(entries: any[]): TFile[] {
    const files: TFile[] = [];
    const seen = new Set<string>();

    for (const entry of entries || []) {
      const file = this.resolveEntryFile(entry?.file ?? entry);
      if (!file || seen.has(file.path)) continue;
      seen.add(file.path);
      files.push(file);
    }

    if (files.length > 0) return files;

    const activeFile = this.app.workspace.getActiveFile();
    return activeFile instanceof TFile && this.isPropertyFile(activeFile)
      ? [activeFile]
      : [];
  }

  private isPropertyFile(file: TFile): boolean {
    const extension = file.extension?.toLowerCase();
    return extension === 'md' || extension === 'canvas';
  }

  private resolveEntryFile(candidate: unknown): TFile | null {
    if (candidate instanceof TFile && this.isPropertyFile(candidate)) {
      return candidate;
    }

    const path = typeof candidate === 'string'
      ? candidate
      : typeof (candidate as any)?.path === 'string'
        ? (candidate as any).path
        : '';

    if (!path) return null;
    const liveFile = this.app.vault.getAbstractFileByPath(path);
    return liveFile instanceof TFile && this.isPropertyFile(liveFile)
      ? liveFile
      : null;
  }

  private resolveLinkListValueToFile(value: string): TFile | null {
    const inner = String(value || '').trim().match(/^\[\[([^\]]+)\]\]$/)?.[1] || String(value || '').trim();
    const target = inner.split('|')[0]?.trim() || '';
    if (!target) return null;
    const direct = this.app.vault.getAbstractFileByPath(target);
    if (direct instanceof TFile && this.isPropertyFile(direct)) return direct;
    const directCanvas = this.app.vault.getAbstractFileByPath(target.endsWith('.canvas') ? target : `${target}.canvas`);
    if (directCanvas instanceof TFile && this.isPropertyFile(directCanvas)) return directCanvas;
    const directMd = this.app.vault.getAbstractFileByPath(target.endsWith('.md') ? target : `${target}.md`);
    if (directMd instanceof TFile && this.isPropertyFile(directMd)) return directMd;
    const resolved = this.app.metadataCache.getFirstLinkpathDest(target.replace(/\.md$/i, ''), '');
    return resolved instanceof TFile && this.isPropertyFile(resolved) ? resolved : null;
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
    anchor.classList.add('internal-link');
    anchor.href = target || '#';
    anchor.setAttribute('data-href', target);
    if (file) anchor.setAttribute('data-path', file.path);
  }

  private async afterWholeNotePropertyEdit(files: TFile[], changedKeys: string[]): Promise<void> {
    if (files.length === 0) return;
    await Promise.all(files.map((file) =>
      this.plugin.notebookNavigatorRuleService.applyRulesToFile(file, {
        reason: 'whole-note-inline-property-edit',
        force: true,
        bypassCreationGrace: true,
      }),
    ));
    logger.flow('PropertySelector', 'refresh:await-metadata-cache', {
      files: files.length,
      changedKeys,
    });
    void this.plugin.viewModeManager?.handlePotentialFrontmatterChange(files, changedKeys);
  }

  private promptForCustomPropertyValue(
    label: string,
    initialValue: string,
    onSubmit: (value: string) => Promise<void>,
  ): void {
    new TextInputModal(this.app, label, initialValue, async (value) => {
      const next = String(value ?? '').trim();
      if (!next) return;
      await onSubmit(next);
    }).open();
  }

  createSelectorRow(entries: any[], prop: any): HTMLElement {
    const row = document.createElement("div");
    row.className = "tps-gcm-row";
    const label = document.createElement("label");
    label.textContent = prop.label;

    const valueEl = document.createElement("div");
    valueEl.className = "tps-gcm-value tps-gcm-input-button";

    const updateDisplay = () => {
      const allValues = entries.map((e: any) => this.getValueCaseInsensitive(e.frontmatter, prop.key) || "");
      const uniqueValues = new Set(allValues);
      const current = uniqueValues.size === 1 ? allValues[0] : "Mixed";
      const isUndefined = entries.every((e: any) => !this.plugin.fieldInitializationService.isFieldDefinedForEntries([e], prop.key));

      valueEl.textContent = current
        && current !== 'Mixed'
        && isEntityReferenceProperty(prop)
        && /^\[\[/u.test(String(current))
        ? getWikilinkDisplayText(String(current))
        : current || "Select...";
      if (isUndefined) {
        valueEl.style.color = "var(--text-muted)";
        valueEl.style.fontStyle = "italic";
      } else {
        valueEl.style.color = "";
        valueEl.style.fontStyle = "";
      }
    };

    updateDisplay();

    this.d.addSafeClickListener(valueEl, async (e) => {
      const allValues = entries.map((e: any) => this.getValueCaseInsensitive(e.frontmatter, prop.key) || "");
      const uniqueValues = new Set(allValues);
      const current = uniqueValues.size === 1 ? allValues[0] : "Mixed";
      const allHaveKey = entries.every((entry: any) => this.hasKeyCaseInsensitive(entry.frontmatter, prop.key));
      const allWithoutKey = entries.every((entry: any) => !this.hasKeyCaseInsensitive(entry.frontmatter, prop.key));
      const allEmpty = allHaveKey && entries.every((entry: any) => {
        const value = this.getValueCaseInsensitive(entry.frontmatter, prop.key);
        return value === '' || value === null || value === undefined;
      });
      const files = this.filesFromEntries(entries);

      if (isEntityReferenceProperty(prop)) {
        openPropertyValueSuggestModal(
          this.app,
          this.plugin,
          prop,
          current === 'Mixed' ? '' : String(current || ''),
          async (choice) => {
          if (choice.kind === 'clear') {
            this.removeEntryFrontmatterValue(entries, prop.key);
            updateDisplay();
            await this.plugin.bulkEditService.removeFrontmatterKey(files, prop.key);
            await this.afterWholeNotePropertyEdit(files, [prop.key]);
            updateDisplay();
            return;
          }
          this.setEntryFrontmatterValue(entries, prop.key, choice.value);
          updateDisplay();
          await this.plugin.bulkEditService.updateFrontmatter(files, { [prop.key]: choice.value });
          await this.afterWholeNotePropertyEdit(files, [prop.key]);
          updateDisplay();
          },
        );
        return;
      }

      const menu = new Menu();
      const checkedItems: Array<{ item: any; value: string }> = [];
      const setCheckedValue = (value: string) => {
        for (const entry of checkedItems) entry.item.setChecked(entry.value === value);
      };
      menu.addItem((item) => {
        checkedItems.push({ item, value: '' });
        item
          .setTitle("(none)")
          .setChecked(allWithoutKey)
          .onClick(async () => {
            setCheckedValue('');
            this.removeEntryFrontmatterValue(entries, prop.key);
            updateDisplay();
            await this.plugin.bulkEditService.removeFrontmatterKey(files, prop.key);
            await this.afterWholeNotePropertyEdit(files, [prop.key]);
            updateDisplay();
          });
      });
      menu.addItem((item) => {
        item
          .setTitle("Set custom value...")
          .setIcon("pencil")
          .setChecked(allEmpty)
          .onClick(() => {
            this.promptForCustomPropertyValue(prop.label || prop.key, current === "Mixed" ? "" : String(current || ""), async (next) => {
              this.setEntryFrontmatterValue(entries, prop.key, next);
              updateDisplay();
              await this.plugin.bulkEditService.updateFrontmatter(files, { [prop.key]: next });
              await this.afterWholeNotePropertyEdit(files, [prop.key]);
              updateDisplay();
            });
          });
      });
      menu.addSeparator();
      getEffectivePropertyOptions(this.app, prop).forEach((opt: string) => {
        menu.addItem((item) => {
          checkedItems.push({ item, value: opt });
          item
            .setTitle(opt)
            .setChecked(current === opt)
            .onClick(async () => {
              setCheckedValue(opt);
              this.setEntryFrontmatterValue(entries, prop.key, opt);
              updateDisplay();
              await this.plugin.bulkEditService.updateFrontmatter(files, { [prop.key]: opt });
              await this.afterWholeNotePropertyEdit(files, [prop.key]);
              updateDisplay();
            });
        });
      });
      this.d.showMenuAtAnchor(menu, e);
    });
    valueEl.addEventListener("mousedown", (e) => e.stopPropagation());

    row.appendChild(label);
    row.appendChild(valueEl);
    return row;
  }

  createListRow(entries: any[], prop: any): HTMLElement {
    const row = document.createElement("div");
    row.className = "tps-gcm-row tps-gcm-tags-row";
    const label = document.createElement("label");
    label.textContent = prop.label;

    const container = document.createElement("div");
    container.className = "tps-gcm-tags-container tps-gcm-tags-inline";

    const refreshTags = () => {
      container.innerHTML = "";
      const entryFile = this.resolveEntryFile(entries[0]?.file ?? entries[0]);
      const freshFm = entryFile && this.plugin.canvasPropertiesService?.isCanvasFile(entryFile)
        ? this.plugin.canvasPropertiesService.read(entryFile)
        : this.app.metadataCache.getFileCache(entryFile ?? entries[0].file)?.frontmatter || {};
      const isTextList = isTextListProperty(prop);
      const isLinkList = isLinkListProperty(prop);
      const isEntityList = isEntityReferenceProperty(prop);
      const rawListValue = this.getValueCaseInsensitive(freshFm, prop.key);
      const tagList = isLinkList
        ? parseLinkListInput(rawListValue)
        : isEntityList
        ? parseMixedListInput(rawListValue)
        : isTextList
        ? parseStringListInput(rawListValue)
        : parseTagInput([
          rawListValue,
          prop.key === 'tags' ? this.getValueCaseInsensitive(freshFm, 'tag') : undefined,
        ]);
      const isUndefined = entries.every((e: any) => !this.plugin.fieldInitializationService.isFieldDefinedForEntries([e], prop.key));

      const normalizedMap = new Map<string, string>();
      for (const tag of tagList) {
        const normalized = isTextList || isLinkList || isEntityList ? String(tag).trim() : normalizeTagValue(tag);
        if (!normalized) continue;
        if (!normalizedMap.has(normalized)) normalizedMap.set(normalized, isTextList || isLinkList || isEntityList ? String(tag).trim() : `#${normalized}`);
      }

      Array.from(normalizedMap.values()).forEach((tag: string) => {
        const tagEl = document.createElement("span");
        tagEl.className = "tps-gcm-tag tps-gcm-tag-removable";

        const tagText = document.createElement("a");
        tagText.className = "tps-gcm-tag-text tps-gcm-tag-link";
        const webLink = extractWebLink(tag);
        tagText.href = webLink?.url || "#";
        const entityLink = isEntityList && /^\[\[/u.test(tag);
        tagText.textContent = webLink?.label || (isLinkList || entityLink ? this.getLinkListDisplayText(tag) : tag);
        if (webLink) {
          tagText.classList.add('tps-gcm-external-link');
          tagText.setAttribute('target', '_blank');
          tagText.setAttribute('rel', 'noopener noreferrer');
        } else if (isLinkList || entityLink) {
          this.configureInternalLink(tagText, tag);
        }
        this.d.addSafeClickListener(tagText, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (webLink) {
            window.open(webLink.url, '_blank', 'noopener,noreferrer');
            return;
          }
          if (isLinkList || entityLink) {
            const file = this.resolveLinkListValueToFile(tag);
            if (file) void this.plugin.openFileInLeaf(file, false, () => this.app.workspace.getLeaf(false), { revealLeaf: true });
            return;
          }
          if (!isTextList && !isEntityList) this.d.triggerTagSearch(normalizeTagValue(tag));
        });
        tagEl.appendChild(tagText);

        const removeBtn = document.createElement("button");
        removeBtn.className = "tps-gcm-tag-remove";
        removeBtn.innerHTML = "×";
        removeBtn.title = `Remove ${tag}`;
        this.d.addSafeClickListener(removeBtn, async (e) => {
          e.stopPropagation();
          tagEl.remove();
          const files = this.filesFromEntries(entries);
          if (isTextList || isLinkList || isEntityList) {
            await this.plugin.bulkEditService.removeListValues(
              files,
              tag,
              prop.key
            );
          } else {
            await this.plugin.bulkEditService.removeTag(
              files,
              tag,
              prop.key
            );
          }
          await this.afterWholeNotePropertyEdit(files, [prop.key, 'tags']);
          refreshTags();
        });
        tagEl.appendChild(removeBtn);

        if (!isTextList && !isLinkList && !isEntityList) this.applyNotebookNavigatorTagStyle(tagEl, normalizeTagValue(tag));
        if (isLinkList || entityLink) tagEl.classList.add('tps-gcm-tag-link-value');

        container.appendChild(tagEl);
      });

      const addBtn = document.createElement("button");
      addBtn.innerHTML = "+";
      addBtn.className = "tps-gcm-tag-add";
      if (isUndefined) {
        addBtn.style.fontStyle = "italic";
        addBtn.title = isEntityList ? "Create field and choose value" : isLinkList ? "Create field and add link" : isTextList ? "Create field and add value" : "Create field and add tag";
      } else {
        addBtn.style.fontStyle = "";
        addBtn.title = isEntityList ? "Choose value" : isLinkList ? "Add link" : isTextList ? "Add value" : "Add tag";
      }
      this.d.addSafeClickListener(addBtn, async () => {
        // Initialize the field if it doesn't exist yet, then immediately open the modal.
        // (No two-click required — the label difference "Create" vs "Set" is cosmetic only.)
        await this.plugin.fieldInitializationService.checkAndInitialize(entries, prop.key, []);
        refreshTags();
        if (isEntityList) {
          openPropertyValueSuggestModal(this.app, this.plugin, prop, '', async (choice) => {
            const files = this.filesFromEntries(entries);
            if (choice.kind === 'clear') {
              await this.plugin.bulkEditService.removeFrontmatterKey(files, prop.key);
            } else {
              await this.plugin.bulkEditService.addListValues(
                files,
                choice.value,
                prop.key,
                choice.kind === 'entity',
              );
            }
            await this.afterWholeNotePropertyEdit(files, [prop.key]);
            refreshTags();
          });
        } else if (isTextList || isLinkList) {
          this.d.openAddListValueModal(entries, prop.key, prop.label);
        } else {
          this.d.openAddTagModal(entries, prop.key);
        }
      });
      addBtn.addEventListener("mousedown", (e) => e.stopPropagation());
      container.appendChild(addBtn);
    };

    refreshTags();
    row.appendChild(label);
    row.appendChild(container);
    return row;
  }

  createDatetimeRow(entries: any[], prop: any): HTMLElement {
    if (isEntityReferenceProperty(prop)) return this.createSelectorRow(entries, prop);
    const row = document.createElement("div");
    row.className = "tps-gcm-row";
    const label = document.createElement("label");
    label.textContent = prop.label;

    const valueEl = document.createElement("div");
    valueEl.className = "tps-gcm-value tps-gcm-input-button";

    const updateDisplay = () => {
      const rawValue = entries[0].frontmatter[prop.key];
      const formatted = this.d.formatDatetimeDisplay(rawValue);
      const isUndefined = entries.every((e: any) => !this.plugin.fieldInitializationService.isFieldDefinedForEntries([e], prop.key));

      if (formatted) {
        valueEl.textContent = formatted;
        valueEl.style.color = "";
        valueEl.style.fontStyle = "";
      } else {
        valueEl.textContent = isUndefined ? "Create field..." : "Set date...";
        valueEl.style.color = "var(--text-muted)";
        valueEl.style.fontStyle = isUndefined ? "italic" : "";
      }
    };

    updateDisplay();

    this.d.addSafeClickListener(valueEl, async () => {
      if (await this.plugin.fieldInitializationService.checkAndInitialize(entries, prop.key, "")) {
        updateDisplay();
      }
      this.d.openScheduledModal(entries, prop.key);
    });
    valueEl.addEventListener("mousedown", (e) => e.stopPropagation());
    row.appendChild(label);
    row.appendChild(valueEl);
    return row;
  }

  createTextRow(entries: any[], prop: any): HTMLElement {
    if (isEntityReferenceProperty(prop)) return this.createSelectorRow(entries, prop);
    const row = document.createElement("div");
    row.className = "tps-gcm-row";
    const label = document.createElement("label");
    label.textContent = prop.label;

    const input = document.createElement("input");
    input.type = "text";
    input.value = entries[0].frontmatter[prop.key] || "";
    input.placeholder = "Empty";
    input.addEventListener("change", async () => {
      const files = this.filesFromEntries(entries);
      this.setEntryFrontmatterValue(entries, prop.key, input.value);
      await this.plugin.bulkEditService.updateFrontmatter(
        files,
        { [prop.key]: input.value }
      );
      await this.afterWholeNotePropertyEdit(this.filesFromEntries(entries), [prop.key]);

      const normalizedKey = String(prop?.key || '').trim().toLowerCase();
      if (normalizedKey === 'title') {
        const nextTitle = String(input.value || '').trim();
        await Promise.all(
          files.map((file: any) =>
            this.plugin.fileNamingService.updateFilenameIfNeeded(file, { bypassCreationGrace: true, titleOverride: nextTitle })
          )
        );
      }
    });
    this.d.addSafeClickListener(input, (e) => e.stopPropagation());
    input.addEventListener("mousedown", (e) => e.stopPropagation());

    row.appendChild(label);
    row.appendChild(input);
    return row;
  }

  createNumberRow(entries: any[], prop: any): HTMLElement {
    if (isEntityReferenceProperty(prop)) return this.createSelectorRow(entries, prop);
    const row = document.createElement("div");
    row.className = "tps-gcm-row";
    const label = document.createElement("label");
    label.textContent = prop.label;

    const input = document.createElement("input");
    input.type = "number";
    input.value = entries[0].frontmatter[prop.key] || "";
    input.addEventListener("change", async () => {
      const val = input.value ? Number(input.value) : null;
      this.setEntryFrontmatterValue(entries, prop.key, val);
      await this.plugin.bulkEditService.updateFrontmatter(
        this.filesFromEntries(entries),
        { [prop.key]: val }
      );
      await this.afterWholeNotePropertyEdit(this.filesFromEntries(entries), [prop.key]);
    });
    this.d.addSafeClickListener(input, (e) => e.stopPropagation());
    input.addEventListener("mousedown", (e) => e.stopPropagation());

    row.appendChild(label);
    row.appendChild(input);
    return row;
  }

  createRecurrenceRow(entries: any[], prop?: any): HTMLElement {
    if (isEntityReferenceProperty(prop)) return this.createSelectorRow(entries, prop);
    const row = document.createElement("div");
    row.className = "tps-gcm-row";
    const label = document.createElement("label");
    label.textContent = prop ? prop.label : "Recurrence";

    const valueEl = document.createElement("div");
    valueEl.className = "tps-gcm-value";
    const rule = this.d.getRecurrenceValue(entries[0].frontmatter);
    valueEl.textContent = rule || "Empty";
    if (!rule) valueEl.style.color = "var(--text-muted)";
    valueEl.title = "Recurrence is read-only in GCM.";

    row.appendChild(label);
    row.appendChild(valueEl);
    return row;
  }

  createTypeRow(entries: any[], prop?: any): HTMLElement {
    if (isEntityReferenceProperty(prop)) return this.createSelectorRow(entries, prop);
    const row = document.createElement("div");
    row.className = "tps-gcm-row";
    const label = document.createElement("label");
    label.textContent = prop ? prop.label : "Type";

    const select = document.createElement("select");
    select.className = "tps-gcm-value tps-gcm-input-select";
    const currentPath = entries[0].file.parent?.path || "/";

    const options = this.d.getTypeFolderOptions();
    for (const { path, label: optionLabel } of options) {
      const option = document.createElement("option");
      option.value = path;
      option.textContent = optionLabel;
      select.appendChild(option);
    }
    select.value = currentPath;
    select.addEventListener("change", async () => this.d.moveFiles(entries, select.value));
    select.addEventListener("mousedown", (e) => e.stopPropagation());

    row.appendChild(label);
    row.appendChild(select);
    return row;
  }

  /**
   * Opens a submenu for status selection (used by chips)
   */
  openStatusSubmenu(
    anchor: HTMLElement,
    entries: any[],
    onUpdate?: (newVal: string) => void,
    overrideOptions?: string[],
    onAfterUpdate?: (files: any[]) => Promise<void>,
    writeGuard?: () => boolean,
  ): void {
    const menu = new Menu();
    const key = 'status';
    const fm = entries[0].frontmatter;
    const statusRaw = this.getValueCaseInsensitive(fm, key);
    const currentStatus = typeof statusRaw === 'string' ? statusRaw.trim() : '';
    const allWithoutKey = entries.every((entry: any) => !this.hasKeyCaseInsensitive(entry.frontmatter, key));
    const allEmpty = !allWithoutKey && entries.every((entry: any) => {
      const value = this.getValueCaseInsensitive(entry.frontmatter, key);
      return value === '' || value === null || value === undefined;
    });
    const files = this.filesFromEntries(entries);
    const checkedItems: Array<{ item: any; value: string }> = [];
    const setCheckedStatus = (value: string) => {
      for (const entry of checkedItems) entry.item.setChecked(entry.value === value);
      logger.flow('PropertySelector', 'status:checked-state', { value, files: files.length });
    };

    menu.addItem(item => {
      checkedItems.push({ item, value: '' });
      item
        .setTitle('(none)')
        .setChecked(allWithoutKey)
        .onClick(async () => {
          if (writeGuard?.() === false) return;
          const updatedCount = await this.plugin.bulkEditService.removeFrontmatterKey(files, key, { writeGuard });
          if (writeGuard && updatedCount <= 0) return;
          setCheckedStatus('');
          this.removeEntryFrontmatterValue(entries, key);
          if (onUpdate) onUpdate('');
          if (updatedCount > 0) await this.afterWholeNotePropertyEdit(files, [key, 'completedDate']);
          if (onAfterUpdate) await onAfterUpdate(files);
        });
    });
    menu.addItem(item => {
      item
        .setTitle('Set custom value...')
        .setIcon('pencil')
        .setChecked(allEmpty)
        .onClick(() => {
          this.promptForCustomPropertyValue('Status', currentStatus, async (next) => {
            if (writeGuard?.() === false) return;
            const updatedCount = await this.plugin.bulkEditService.setStatus(files, next, { writeGuard });
            if (writeGuard && updatedCount <= 0) return;
            this.setEntryFrontmatterValue(entries, key, next);
            if (onUpdate) onUpdate(next);
            if (updatedCount > 0) await this.afterWholeNotePropertyEdit(files, [key, 'completedDate']);
            if (onAfterUpdate) await onAfterUpdate(files);
          });
        });
    });
    menu.addSeparator();

    const statuses = overrideOptions && overrideOptions.length > 0 ? overrideOptions : ['todo', 'working', 'holding', 'wont-do', 'complete'];
    statuses.forEach(status => {
      menu.addItem(item => {
        checkedItems.push({ item, value: status });
        item
          .setTitle(status)
          .setChecked(currentStatus === status)
          .onClick(async () => {
            if (writeGuard?.() === false) return;
            const updatedCount = await this.plugin.bulkEditService.setStatus(files, status, { writeGuard });
            if (writeGuard && updatedCount <= 0) return;
            setCheckedStatus(status);
            this.setEntryFrontmatterValue(entries, key, status);
            if (onUpdate) onUpdate(status);
            if (updatedCount > 0) await this.afterWholeNotePropertyEdit(files, [key, 'completedDate']);
            if (onAfterUpdate) await onAfterUpdate(files);
          });
      });
    });

    this.d.showMenuAtAnchor(menu, anchor);
  }

  /**
   * Opens a submenu for priority selection (used by chips)
   */
  openPrioritySubmenu(
    anchor: HTMLElement,
    entries: any[],
    onUpdate?: (newVal: string) => void,
    overrideOptions?: string[],
    propertyKey = 'priority',
    writeGuard?: () => boolean,
  ): void {
    const menu = new Menu();
    const key = String(propertyKey || 'priority').trim() || 'priority';
    const fm = entries[0].frontmatter;
    const priorityRaw = this.getValueCaseInsensitive(fm, key);
    const currentPrio = typeof priorityRaw === 'string' ? priorityRaw.trim() : '';
    const allWithoutKey = entries.every((entry: any) => !this.hasKeyCaseInsensitive(entry.frontmatter, key));
    const allEmpty = !allWithoutKey && entries.every((entry: any) => {
      const value = this.getValueCaseInsensitive(entry.frontmatter, key);
      return value === '' || value === null || value === undefined;
    });
    const files = this.filesFromEntries(entries);
    const checkedItems: Array<{ item: any; value: string }> = [];
    const setCheckedPriority = (value: string) => {
      for (const entry of checkedItems) entry.item.setChecked(entry.value === value);
      logger.flow('PropertySelector', 'priority:checked-state', { value, files: files.length });
    };

    menu.addItem(item => {
      checkedItems.push({ item, value: '' });
      item
        .setTitle('(none)')
        .setChecked(allWithoutKey)
        .onClick(async () => {
          if (writeGuard?.() === false) return;
          const updatedCount = await this.plugin.bulkEditService.removeFrontmatterKey(files, key, { writeGuard });
          if (writeGuard && updatedCount <= 0) return;
          setCheckedPriority('');
          this.removeEntryFrontmatterValue(entries, key);
          if (onUpdate) onUpdate('');
          if (updatedCount > 0) await this.afterWholeNotePropertyEdit(files, [key]);
        });
    });
    menu.addItem(item => {
      item
        .setTitle('Set custom value...')
        .setIcon('pencil')
        .setChecked(allEmpty)
        .onClick(() => {
          this.promptForCustomPropertyValue('Priority', currentPrio, async (next) => {
            if (writeGuard?.() === false) return;
            const updatedCount = await this.plugin.bulkEditService.updateFrontmatter(
              files,
              { [key]: next },
              { writeGuard },
            );
            if (writeGuard && updatedCount <= 0) return;
            this.setEntryFrontmatterValue(entries, key, next);
            if (onUpdate) onUpdate(next);
            if (updatedCount > 0) await this.afterWholeNotePropertyEdit(files, [key]);
          });
        });
    });
    menu.addSeparator();

    const priorities = overrideOptions && overrideOptions.length > 0 ? overrideOptions : ['high', 'medium', 'normal', 'low'];
    priorities.forEach(priority => {
      menu.addItem(item => {
        checkedItems.push({ item, value: priority });
        item
          .setTitle(priority)
          .setChecked(currentPrio === priority)
          .onClick(async () => {
            if (writeGuard?.() === false) return;
            const updatedCount = await this.plugin.bulkEditService.updateFrontmatter(
              files,
              { [key]: priority },
              { writeGuard },
            );
            if (writeGuard && updatedCount <= 0) return;
            setCheckedPriority(priority);
            this.setEntryFrontmatterValue(entries, key, priority);
            if (onUpdate) onUpdate(priority);
            if (updatedCount > 0) await this.afterWholeNotePropertyEdit(files, [key]);
          });
      });
    });

    this.d.showMenuAtAnchor(menu, anchor);
  }

  /**
   * Opens a submenu for folder/type selection (used by chips)
   */
  openTypeSubmenu(anchor: HTMLElement, entries: any[], writeGuard?: () => boolean): void {
    const menu = new Menu();
    const currentPath = entries[0].file.parent?.path || '/';
    const options = this.d.getTypeFolderOptions();

    options.forEach(({ path, label }) => {
      menu.addItem(item => {
        item
          .setTitle(label)
          .setChecked(currentPath === path)
          .onClick(async () => {
            if (writeGuard?.() === false) return;
            await this.d.moveFiles(entries, path, writeGuard);
          });
      });
    });

    this.d.showMenuAtAnchor(menu, anchor);
  }

  private applyNotebookNavigatorTagStyle(tagEl: HTMLElement, normalizedTag: string): void {
    if (this.plugin.settings.inheritNotebookNavigatorTagColors === false) {
      const hue = this.d.hashStringToHue(normalizedTag || "");
      tagEl.style.backgroundColor = `hsla(${hue}, 40%, 20%, 0.4)`;
      tagEl.style.color = `hsl(${hue}, 60%, 85%)`;
      tagEl.style.border = `1px solid hsla(${hue}, 40%, 30%, 0.5)`;
      return;
    }

    tagEl.style.backgroundColor = 'var(--nn-theme-file-tag-bg, transparent)';
    tagEl.style.backgroundImage = 'none';
    tagEl.style.color = 'var(--nn-theme-file-tag-color, var(--text-normal))';
    tagEl.style.border = '1px solid var(--nn-theme-file-tag-border-color, var(--background-modifier-border))';

    if (!normalizedTag) return;

    const rendered = this.getNotebookNavigatorRenderedTagColor(normalizedTag);
    if (rendered) {
      tagEl.style.color = rendered;
      tagEl.style.border = '1px solid color-mix(in srgb, currentColor 30%, transparent)';
      return;
    }

    const nn = this.getNotebookNavigatorPlugin();
    const settings = nn?.settings ?? nn?.settingsController?.settings ?? nn?.api?.settings ?? null;
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
      tagEl.style.backgroundImage = `linear-gradient(${customBackground}, ${customBackground})`;
      if (!customColor) {
        tagEl.style.color = 'var(--nn-theme-file-tag-custom-color-text-color, var(--text-normal))';
      }
    }
    if (customColor) {
      tagEl.style.color = customColor;
    }
    if (customColor || customBackground) {
      tagEl.style.border = '1px solid color-mix(in srgb, currentColor 30%, transparent)';
      return;
    }

    const apiColor = this.getNotebookNavigatorTagColorFromApi(normalizedTag, nn);
    if (apiColor) {
      tagEl.style.color = apiColor;
      tagEl.style.border = '1px solid color-mix(in srgb, currentColor 30%, transparent)';
      return;
    }

    const rainbowColor = this.resolveNotebookNavigatorRainbowTagColor(normalizedTag, settings);
    if (rainbowColor) {
      tagEl.style.color = rainbowColor;
      tagEl.style.border = '1px solid color-mix(in srgb, currentColor 30%, transparent)';
    }
  }

  private getNotebookNavigatorPlugin(): any {
    const pluginApi: any = (this.app as any)?.plugins;
    const candidates = Object.values(pluginApi?.plugins || {}) as any[];
    return (
      pluginApi?.plugins?.['notebook-navigator'] ??
      pluginApi?.getPlugin?.('notebook-navigator') ??
      candidates.find((candidate) => String(candidate?.manifest?.id || '').trim() === 'notebook-navigator') ??
      candidates.find((candidate) => String(candidate?.manifest?.name || '').trim().toLowerCase() === 'notebook navigator') ??
      null
    );
  }

  private getNotebookNavigatorRenderedTagColor(normalizedTag: string): string {
    if (typeof document === 'undefined' || !normalizedTag) return '';
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
        if (color && this.isValidCssColor(color)) return color;
      }
    }
    return '';
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

  private resolveNotebookNavigatorRainbowTagColor(normalizedTag: string, settings: any): string {
    if (!normalizedTag) return '';
    if (settings && settings.inheritTagColors === false) return '';

    const activeProfileName = String(settings?.vaultProfile || '').trim();
    const profiles = Array.isArray(settings?.vaultProfiles) ? settings.vaultProfiles : [];
    const activeProfile = profiles.find((profile: any) => String(profile?.name || '').trim() === activeProfileName);
    const navRainbow = activeProfile?.navRainbow;
    const tagRainbow = navRainbow?.tags;

    const rainbowEnabled = tagRainbow ? tagRainbow.enabled !== false : true;
    if (!rainbowEnabled) return '';

    const firstColor = this.parseHexColor(String(tagRainbow?.firstColor || '#ef4444').trim());
    const lastColor = this.parseHexColor(String(tagRainbow?.lastColor || '#8b5cf6').trim());
    if (!firstColor || !lastColor) return '';

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

  private isValidCssColor(value: string): boolean {
    if (!value) return false;
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
      return CSS.supports('color', value);
    }
    const style = document.createElement('span').style;
    style.color = '';
    style.color = value;
    return style.color !== '';
  }
}
