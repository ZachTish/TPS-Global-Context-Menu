import { App, Menu, TFile, TFolder, Notice, Platform, WorkspaceLeaf } from 'obsidian';
import TPSGlobalContextMenuPlugin from '../main';
import { AddTagModal } from '../modals/add-tag-modal';
import { FileSuggestModal } from '../modals/FileSuggestModal';
import { ScheduledModal } from '../modals/scheduled-modal';
import { SnoozeModal } from '../modals/snooze-modal';
import { BuildPanelOptions } from '../types';
import { STATUSES, PRIORITIES } from '../constants';
import * as logger from "../logger";
import { PropertyRowService } from '../services/property-row-service';
import { normalizeTagValue, parseTagInput } from '../utils/tag-utils';
import { formatFileWikilink, isLinkListProperty, parseStringListInput } from '../utils/list-utils';
import { isEntityReferenceProperty } from '../utils/entity-property';
import { openPropertyValueSuggestModal } from '../modals/PropertyValueSuggestModal';
import { getEffectivePropertyOptions } from '../utils/property-options';
import { BadgeRenderer, hashStringToHue } from './badge-renderer';
import { PanelBuilder } from './panel-builder';
import { MenuBuilder, type GcmMenuSink, type NativeMenuLabelOptions } from './menu-builder';

export function addSafeClickListener(element: HTMLElement, handler: (e: MouseEvent) => void) {
  element.addEventListener('click', (e) => {
    e.stopPropagation();
    handler(e as MouseEvent);
  });
  element.addEventListener('mousedown', (e) => e.stopPropagation());
  element.addEventListener('pointerdown', (e) => {
    if (Platform.isMobile) return;
    e.stopPropagation();
  });
  element.addEventListener('touchstart', (e) => {
    if (Platform.isMobile) return;
    e.stopPropagation();
  }, { passive: true });
}

/**
 * Thin facade coordinating MenuBuilder (native menus), PanelBuilder (custom panels),
 * and BadgeRenderer (header badges). Owns shared utilities like modal openers,
 * menu positioning, tag search, and folder resolution.
 */
export class MenuController {
  plugin: TPSGlobalContextMenuPlugin;
  private propertyRowService: PropertyRowService;
  private badgeRenderer: BadgeRenderer;
  public panelBuilder: PanelBuilder;
  private menuBuilder: MenuBuilder;

  constructor(plugin: TPSGlobalContextMenuPlugin) {
    this.plugin = plugin;
    this.propertyRowService = new PropertyRowService(this.app, this.plugin, {
      addSafeClickListener,
      showMenuAtAnchor: this.showMenuAtAnchor.bind(this),
      openAddTagModal: this.openAddTagModal.bind(this),
      openAddListValueModal: this.openAddListValueModal.bind(this),
      triggerTagSearch: this.triggerTagSearch.bind(this),
      openScheduledModal: this.openScheduledModal.bind(this),
      openRecurrenceModalNative: this.openRecurrenceModalNative.bind(this),
      moveFiles: this.moveFiles.bind(this),
      getTypeFolderOptions: this.getTypeFolderOptions.bind(this),
      getRecurrenceValue: this.getRecurrenceValue.bind(this),
      formatDatetimeDisplay: this.formatDatetimeDisplay.bind(this),
      hashStringToHue,
    });

    this.badgeRenderer = new BadgeRenderer(this.plugin, {
      createFileEntries: this.createFileEntries.bind(this),
      getRecurrenceValue: this.getRecurrenceValue.bind(this),
      openAddTagModal: this.openAddTagModal.bind(this),
      openAddListValueModal: this.openAddListValueModal.bind(this),
      openRecurrenceModalNative: this.openRecurrenceModalNative.bind(this),
      openScheduledModal: this.openScheduledModal.bind(this),
      openTypeSubmenu: this.openTypeSubmenu.bind(this),
      showMenuAtAnchor: this.showMenuAtAnchor.bind(this),
      triggerTagSearch: this.triggerTagSearch.bind(this),
    });

    this.panelBuilder = new PanelBuilder(this.plugin, this.propertyRowService, {
      createFileEntries: this.createFileEntries.bind(this),
      openAddTagModal: this.openAddTagModal.bind(this),
      openAddListValueModal: this.openAddListValueModal.bind(this),
      openScheduledModal: this.openScheduledModal.bind(this),
      openRecurrenceModalNative: this.openRecurrenceModalNative.bind(this),
      formatDatetimeDisplay: this.formatDatetimeDisplay.bind(this),
    });

    this.menuBuilder = new MenuBuilder(this.plugin, {
      createFileEntries: this.createFileEntries.bind(this),
      openAddTagModal: this.openAddTagModal.bind(this),
      openAddListValueModal: this.openAddListValueModal.bind(this),
      openScheduledModal: this.openScheduledModal.bind(this),
      openRecurrenceModalNative: this.openRecurrenceModalNative.bind(this),
      openSnoozeModal: this.openSnoozeModal.bind(this),
      getRecurrenceValue: this.getRecurrenceValue.bind(this),
      moveFiles: this.moveFiles.bind(this),
      getTypeFolderOptions: this.getTypeFolderOptions.bind(this),
    });
  }

  private resolvePreferredContentLeaf(): WorkspaceLeaf | null {
    const activeLeaf = this.app.workspace.activeLeaf;
    const activeType = activeLeaf?.view?.getViewType?.();

    if (activeLeaf && activeType !== 'notebook-navigator') {
      return activeLeaf;
    }

    const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
    if (markdownLeaves.length > 0) return markdownLeaves[0];

    const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
    if (canvasLeaves.length > 0) return canvasLeaves[0];

    const mostRecentLeaf = (this.app.workspace as any)?.getMostRecentLeaf?.();
    const mostRecentType = mostRecentLeaf?.view?.getViewType?.();
    if (mostRecentLeaf && mostRecentType !== 'notebook-navigator') {
      return mostRecentLeaf;
    }

    return this.app.workspace.getLeaf('tab');
  }

  detach() {
    // No-op
  }

  hideMenu() {
    // No-op
  }

  // --- Delegated public API ---

  addToNativeMenu(menu: Menu, files: TFile[], options: NativeMenuLabelOptions = {}) {
    if (this.plugin.settings.inlineMenuOnly) return;
    this.menuBuilder.addToNativeMenu(menu, files, options);
  }

  /** Adds GCM actions for exactly these live files without consulting ambient UI selection. */
  addToExactFileMenu(menu: GcmMenuSink, files: readonly TFile[], options: NativeMenuLabelOptions = {}) {
    if (this.plugin.settings.inlineMenuOnly) return;
    this.menuBuilder.addToExactFileMenu(menu, files, options);
  }

  buildSpecialPanel(files: TFile[], options: BuildPanelOptions = {}): HTMLElement {
    return this.panelBuilder.buildSpecialPanel(files, options);
  }

  createSubitemsPanel(file: TFile): HTMLElement {
    return this.panelBuilder.createSubitemsPanel(file);
  }

  createNoteReferencesPanel(file: TFile): HTMLElement {
    return this.panelBuilder.createNoteReferencesPanel(file);
  }

  createNoteGraphPanel(file: TFile): HTMLElement {
    return this.panelBuilder.createNoteGraphPanel(file);
  }

  getPanelBuilder(): PanelBuilder {
    return this.panelBuilder;
  }

  createSummaryHeader(file: TFile, leaf?: WorkspaceLeaf): HTMLElement {
    return this.badgeRenderer.createSummaryHeader(file, leaf);
  }

  createHeaderBadges(file: TFile, leaf?: WorkspaceLeaf): HTMLElement {
    return this.badgeRenderer.createHeaderBadges(file, leaf);
  }

  // --- Shared utilities (used by delegates) ---

  createFileEntries(files: TFile[]) {
    return files.flatMap((candidate) => {
      const f = this.plugin.filePropertiesService?.isCompanionFile(candidate)
        ? this.plugin.filePropertiesService.getSourceFileForCompanion(candidate)
        : candidate;
      if (!(f instanceof TFile)) return [];
      if (
        this.plugin.usesNativeRecordArchitecture()
        && f.extension?.toLowerCase() !== 'md'
        && !this.plugin.filePropertiesService?.isCompanionFile(f)
      ) {
        return [{ file: f, frontmatter: {}, nativeAssetSource: true }];
      }
      if (!this.isPropertyFile(f)) return [];
      const frontmatter = f.extension?.toLowerCase() !== 'md' && this.plugin.filePropertiesService?.isPropertyTarget(f)
        ? this.plugin.filePropertiesService.read(f)
        : this.app.metadataCache.getFileCache(f)?.frontmatter || {};
      return [{
        file: f,
        frontmatter,
      }];
    });
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
    if (this.plugin.filePropertiesService?.isCompanionFile(file)) return false;
    return file.extension?.toLowerCase() === 'md'
      || this.plugin.filePropertiesService?.isPropertyTarget(file) === true;
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

  getRecurrenceValue(fm: any): string {
    return fm.recurrenceRule || fm.recurrence || '';
  }

  private getTypeFolderOptions(): { path: string; label: string }[] {
    const allFiles = this.app.vault.getAllLoadedFiles();
    const folders = allFiles.filter(f => f instanceof TFolder) as TFolder[];
    const files = allFiles.filter(f => f instanceof TFile) as TFile[];

    const normalizedPaths = folders
      .map(f => f.path)
      .filter(p => p && p !== '/')
      .map(p => p.replace(/\/+$/, ''));
    const folderSet = new Set(normalizedPaths);

    const leafPaths = normalizedPaths
      .filter(path => !normalizedPaths.some(other => other !== path && other.startsWith(path + '/')));

    const directFileCounts = new Map<string, number>();
    for (const file of files) {
      const parentPath = file.parent?.path;
      if (!parentPath || parentPath === '/') continue;
      if (!folderSet.has(parentPath)) continue;
      directFileCounts.set(parentPath, (directFileCounts.get(parentPath) || 0) + 1);
    }

    const includedSet = new Set<string>(leafPaths);
    for (const [path, count] of directFileCounts.entries()) {
      if (count > 0) includedSet.add(path);
    }

    const includedPaths = Array.from(includedSet).sort((a, b) => a.localeCompare(b));

    const findNearestIncludedAncestor = (path: string): string | null => {
      let current = path;
      while (current.includes('/')) {
        current = current.substring(0, current.lastIndexOf('/'));
        if (includedSet.has(current)) return current;
      }
      return null;
    };

    return includedPaths.map(path => {
      const ancestor = findNearestIncludedAncestor(path);
      if (!ancestor) {
        return { path, label: path.split('/').pop() || path };
      }
      const ancestorLabel = ancestor.split('/').pop() || ancestor;
      const suffix = path.slice(ancestor.length + 1);
      return { path, label: `${ancestorLabel}/${suffix}` };
    });
  }

  async moveFiles(entries: any[], folderPath: string, writeGuard?: () => boolean) {
    const files = this.filesFromEntries(entries);

    await this.plugin.runQueuedMove(files, async () => {
      for (const entry of entries) {
        if (writeGuard?.() === false) return;
        const newPath = `${folderPath === '/' ? '' : folderPath}/${entry.file.name}`;
        if (newPath !== entry.file.path) {
          try {
            await this.app.fileManager.renameFile(entry.file, newPath);
          } catch (e: any) {
            logger.error(`Failed to move file to ${newPath}`, e);
            new Notice(`Failed to move file: ${e?.message ?? 'Unknown error'}`);
          }
        }
      }
    });
  }

  // --- Submenu openers (used by PropertyRowService and BadgeRenderer) ---

  openStatusSubmenu(anchor: HTMLElement | MouseEvent | KeyboardEvent, entries: any[], onUpdate?: (val: string) => void) {
    const menu = new Menu();
    const statusKey = this.plugin.sharedServices?.status?.getStatusPropertyKey?.() || 'status';
    const readStatus = (entry: any): unknown => {
      const frontmatter = entry?.frontmatter;
      if (!frontmatter || typeof frontmatter !== 'object') return undefined;
      const actualKey = Object.keys(frontmatter)
        .find((key) => key.toLowerCase() === statusKey.toLowerCase());
      return actualKey ? frontmatter[actualKey] : undefined;
    };
    const hasStatus = (entry: any): boolean => {
      const frontmatter = entry?.frontmatter;
      return !!frontmatter
        && typeof frontmatter === 'object'
        && Object.keys(frontmatter).some((key) => key.toLowerCase() === statusKey.toLowerCase());
    };
    const currentValue = readStatus(entries[0]);
    const currentStatus = typeof currentValue === 'string'
      ? currentValue.trim()
      : '';
    const files = this.filesFromEntries(entries);
    const allWithoutKey = entries.every((entry: any) => !hasStatus(entry));
    const allEmpty = !allWithoutKey && entries.every((entry: any) => {
      const value = readStatus(entry);
      return value === '' || value === null || value === undefined;
    });

    menu.addItem(item => {
      item.setTitle('(none)')
        .setChecked(allWithoutKey)
        .onClick(async () => {
          await this.plugin.bulkEditService.removeFrontmatterKey(files, statusKey);
          entries.forEach((entry: any) => {
            if (!entry.frontmatter || typeof entry.frontmatter !== 'object') return;
            const actualKey = Object.keys(entry.frontmatter)
              .find((key) => key.toLowerCase() === statusKey.toLowerCase());
            if (actualKey) delete entry.frontmatter[actualKey];
          });
          if (onUpdate) onUpdate('');
          await this.afterWholeNotePropertyEdit(files, [statusKey, 'completedDate']);
        });
    });
    menu.addItem(item => {
      item.setTitle('(empty)')
        .setChecked(allEmpty)
        .onClick(async () => {
          await this.plugin.bulkEditService.updateFrontmatter(files, { [statusKey]: '' });
          entries.forEach((entry: any) => {
            if (!entry.frontmatter || typeof entry.frontmatter !== 'object') entry.frontmatter = {};
            entry.frontmatter[statusKey] = '';
          });
          if (onUpdate) onUpdate('');
          await this.afterWholeNotePropertyEdit(files, [statusKey, 'completedDate']);
        });
    });
    menu.addSeparator();

    STATUSES.forEach(status => {
      menu.addItem(item => {
        item.setTitle(status)
          .setChecked(currentStatus === status)
          .onClick(async () => {
            entries.forEach((entry: any) => {
              if (!entry.frontmatter || typeof entry.frontmatter !== 'object') entry.frontmatter = {};
              entry.frontmatter[statusKey] = status;
            });
            if (onUpdate) onUpdate(status);
            await this.plugin.bulkEditService.setStatus(files, status);
            await this.afterWholeNotePropertyEdit(files, [statusKey, 'completedDate']);
          });
      });
    });
    this.showMenuAtAnchor(menu, anchor);
  }

  openPrioritySubmenu(anchor: HTMLElement | MouseEvent | KeyboardEvent, entries: any[], onUpdate?: (val: string) => void) {
    const menu = new Menu();
    const currentPriority = typeof entries[0]?.frontmatter?.priority === 'string'
      ? String(entries[0].frontmatter.priority).trim()
      : '';
    const files = this.filesFromEntries(entries);
    const allWithoutKey = entries.every((entry: any) => !Object.prototype.hasOwnProperty.call(entry?.frontmatter || {}, 'priority'));
    const allEmpty = !allWithoutKey && entries.every((entry: any) => {
      const value = entry?.frontmatter?.priority;
      return value === '' || value === null || value === undefined;
    });

    menu.addItem(item => {
      item.setTitle('(none)')
        .setChecked(allWithoutKey)
        .onClick(async () => {
          await this.plugin.bulkEditService.removeFrontmatterKey(files, 'priority');
          entries.forEach((entry: any) => {
            if (!entry.frontmatter || typeof entry.frontmatter !== 'object') return;
            delete entry.frontmatter.priority;
          });
          if (onUpdate) onUpdate('');
          await this.afterWholeNotePropertyEdit(files, ['priority']);
        });
    });
    menu.addItem(item => {
      item.setTitle('(empty)')
        .setChecked(allEmpty)
        .onClick(async () => {
          await this.plugin.bulkEditService.updateFrontmatter(files, { priority: '' });
          entries.forEach((entry: any) => {
            if (!entry.frontmatter || typeof entry.frontmatter !== 'object') entry.frontmatter = {};
            entry.frontmatter.priority = '';
          });
          if (onUpdate) onUpdate('');
          await this.afterWholeNotePropertyEdit(files, ['priority']);
        });
    });
    menu.addSeparator();

    PRIORITIES.forEach(prio => {
      menu.addItem(item => {
        item.setTitle(prio)
          .setChecked(currentPriority === prio)
          .onClick(async () => {
            entries.forEach((entry: any) => {
              if (!entry.frontmatter || typeof entry.frontmatter !== 'object') entry.frontmatter = {};
              entry.frontmatter.priority = prio;
            });
            if (onUpdate) onUpdate(prio);
            await this.plugin.bulkEditService.setPriority(files, prio);
            await this.afterWholeNotePropertyEdit(files, ['priority']);
          });
      });
    });
    this.showMenuAtAnchor(menu, anchor);
  }

  openTypeSubmenu(anchor: HTMLElement | MouseEvent | KeyboardEvent, entries: any[], onUpdate?: (val: string) => void) {
    const menu = new Menu();
    const options = this.getTypeFolderOptions();
    const currentPath = entries[0]?.file?.parent?.path || '/';
    options.forEach(({ path, label }) => {
      menu.addItem(item => {
        item.setTitle(label)
          .setChecked(currentPath === path)
          .onClick(async () => {
            if (onUpdate) onUpdate(path);
            await this.moveFiles(entries, path);
          });
      });
    });
    this.showMenuAtAnchor(menu, anchor);
  }

  private activeMenu: Menu | null = null;

  showMenuAtAnchor(menu: Menu, anchor: HTMLElement | MouseEvent | KeyboardEvent) {
    // Ensure primitive menu stacking (close previous if exists)
    if (this.activeMenu) {
      this.activeMenu.hide();
    }
    this.activeMenu = menu;
    menu.onHide(() => {
      if (this.activeMenu === menu) {
        this.activeMenu = null;
      }
    });

    if (anchor instanceof MouseEvent) {
      // @ts-ignore
      menu.showAtMouseEvent(anchor);
      return;
    }

    let element: HTMLElement | null = null;
    if (anchor instanceof HTMLElement) {
      element = anchor;
    } else if (anchor instanceof Event && anchor.target instanceof HTMLElement) {
      element = anchor.target as HTMLElement;
    }

    if (element) {
      // Try native positioning first (best for collision detection)
      // @ts-ignore
      if (typeof menu.showAtElement === 'function') {
        // @ts-ignore
        menu.showAtElement(element);
        return;
      }

      // Fallback manual positioning
      if (element.getBoundingClientRect) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const viewportW = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
          const viewportH = Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0);

          // Reduced estimates to avoid aggressive vertical shifting
          const estimatedWidth = Platform.isMobile ? Math.min(340, Math.floor(viewportW * 0.9)) : 200;
          // Estimate smaller height (e.g. 5 items = ~180px) instead of 360
          const estimatedHeight = Platform.isMobile ? Math.min(420, Math.floor(viewportH * 0.7)) : 200;
          const margin = Platform.isMobile ? 10 : 8;

          let x = rect.left;
          let y = rect.bottom + 4;

          // Clamp logic
          x = Math.max(margin, Math.min(x, viewportW - estimatedWidth - margin));

          // If the menu would fall off the bottom, flip it to top
          if (y + estimatedHeight > viewportH - margin) {
            y = rect.top - 4;
            // Note: showAtPosition anchors top-left. 
            // If we want it to extend UPWARDS from 'y', we assume Obsidian handles it?
            // No, Obsidian Menu always extends DOWN from x,y.
            // So if we want it above, we specifically position 'y' so the MENU TOP is at 'y'.
            // Wait, if we want bottom of menu at rect.top..
            // y = rect.top - actualHeight. But we don't know height.
            // This is why showAtElement is crucial.

            // Best effort: set y such that it is on screen, but clearly separate.
            // If we set y = rect.top - estimatedHeight?
            y = Math.max(margin, rect.top - estimatedHeight);
          }

          menu.showAtPosition({ x, y });
          return;
        }
      }
    }

    // Fallback
    // @ts-ignore
    if (this.app.workspace.activeLeaf) {
      // @ts-ignore
      const mouse = this.app.workspace.activeLeaf.view.contentEl.getBoundingClientRect();
      menu.showAtPosition({ x: mouse.left + 100, y: mouse.top + 100 });
    } else {
      menu.showAtPosition({ x: 0, y: 0 });
    }
  }

  // --- Modal openers ---

  openAddTagModal(entries: any[], key = 'tags', writeGuard?: () => boolean) {
    logger.log(`[TPS GCM] openAddTagModal called with ${entries.length} entries`);
    new AddTagModal(this.app, this.getAllKnownTags(), async (tag) => {
      if (writeGuard?.() === false) return;
      const files = this.filesFromEntries(entries);
      logger.log(`[TPS GCM] Adding tag '${tag}' to ${files.length} files`);
      const current = parseTagInput(entries[0]?.frontmatter?.[key]);
      const nextTags = Array.from(new Set([...current, ...parseTagInput(tag)]));
      const count = await this.plugin.bulkEditService.addTag(files, tag, key, { writeGuard });
      if (count > 0) {
        const normalized = parseTagInput(tag);
        const display = normalized.length ? normalized.map((value) => `#${value}`).join(' ') : `#${tag}`;
        this.plugin.bulkEditService.showNotice('added', `Tag ${display}`, '', count);
        await this.afterWholeNotePropertyEdit(files, [key, 'tags']);
      }
    }).open();
  }

  openAddListValueModal(entries: any[], key: string, label = 'Value') {
    logger.log(`[TPS GCM] openAddListValueModal called with ${entries.length} entries`);
    const property = this.plugin.settings.properties?.find((prop) => prop.key.toLowerCase() === key.toLowerCase());
    if (isEntityReferenceProperty(property)) {
      openPropertyValueSuggestModal(this.app, this.plugin, property!, '', async (choice) => {
        const files = this.filesFromEntries(entries);
        if (choice.kind === 'clear') {
          const count = await this.plugin.bulkEditService.removeFrontmatterKey(files, key);
          if (count > 0) await this.afterWholeNotePropertyEdit(files, [key]);
          return;
        }
        const count = await this.plugin.bulkEditService.addListValues(
          files,
          choice.value,
          key,
          choice.kind === 'entity',
        );
        if (count > 0) {
          this.plugin.bulkEditService.showNotice('added', `${label} ${choice.label}`, '', count);
          await this.afterWholeNotePropertyEdit(files, [key]);
        }
      });
      return;
    }
    if (isLinkListProperty(property)) {
      new FileSuggestModal(this.app, async (file) => {
        const files = this.filesFromEntries(entries);
        const frontmatter = file.extension?.toLowerCase() !== 'md' && this.plugin.filePropertiesService?.isPropertyTarget(file)
          ? this.plugin.filePropertiesService.read(file)
          : this.app.metadataCache.getFileCache(file)?.frontmatter;
        const title = String(frontmatter?.title || file.basename).trim();
        const link = formatFileWikilink(file.path, title || file.basename);
        const count = await this.plugin.bulkEditService.addListValues(files, link, key);
        if (count > 0) {
          this.plugin.bulkEditService.showNotice('added', `${label} ${link}`, '', count);
          await this.afterWholeNotePropertyEdit(files, [key]);
        }
      }, {
        extensions: Array.from(new Set(
          this.app.vault.getFiles()
            .map((file) => String(file.extension || '').trim())
            .filter(Boolean),
        )),
        filter: (file) => !this.plugin.filePropertiesService?.isCompanionFile(file),
      }).open();
      return;
    }
    const suggestions = getEffectivePropertyOptions(this.app, property);
    new AddTagModal(this.app, suggestions, async (value) => {
      const files = this.filesFromEntries(entries);
      const current = parseStringListInput(entries[0]?.frontmatter?.[key]);
      const nextValues = Array.from(new Set([...current, ...parseStringListInput(value)]));
      const count = await this.plugin.bulkEditService.addListValues(files, value, key);
      if (count > 0) {
        const values = parseStringListInput(value);
        const display = values.length ? values.join(', ') : value;
        this.plugin.bulkEditService.showNotice('added', `${label} ${display}`, '', count);
        await this.afterWholeNotePropertyEdit(files, [key]);
      }
    }, {
      title: `Add ${label}`,
      settingName: label,
      placeholder: 'value1, value2, value3',
    }).open();
  }

  openRecurrenceModalNative(entries: any[]) {
    new Notice('Recurrence is read-only in GCM. Edit the frontmatter property directly if needed.');
  }

  openScheduledModal(entries: any[], key = 'scheduled', writeGuard?: () => boolean) {
    const fm = entries[0].frontmatter;
    new ScheduledModal(
      this.app,
      fm[key] || '',
      fm.timeEstimate || 0,
      fm.allDay || false,
      async (result) => {
        if (writeGuard?.() === false) return;
        const files = this.filesFromEntries(entries);
        const clearing = !String(result.date || '').trim();
        const count = await this.plugin.bulkEditService.updateScheduledDetails(
          files,
          result.date,
          clearing ? null : result.timeEstimate,
          clearing ? false : result.allDay,
          key,
          { writeGuard },
        );
        if (writeGuard && count <= 0) return;
        entries.forEach((entry: any) => {
          if (!entry.frontmatter || typeof entry.frontmatter !== 'object') entry.frontmatter = {};
          if (clearing) {
            delete entry.frontmatter[key];
            delete entry.frontmatter.timeEstimate;
            delete entry.frontmatter.allDay;
          } else {
            entry.frontmatter[key] = result.date;
            entry.frontmatter.timeEstimate = result.timeEstimate;
            if (result.allDay) entry.frontmatter.allDay = true;
            else delete entry.frontmatter.allDay;
          }
        });
        await this.afterWholeNotePropertyEdit(files, [key, 'timeEstimate', 'allDay']);
      }
    ).open();
  }

  openSnoozeModal(entries: any[], key = 'snooze') {
    const controller: any = (this.app as any)?.plugins?.plugins?.['tps-controller']
      || (this.app as any)?.plugins?.plugins?.['TPS-Controller (Dev)'];
    const controllerSettings = controller?.settings || controller?.api?.getSettings?.() || {};
    const options = Array.isArray(controllerSettings.snoozeOptions) ? controllerSettings.snoozeOptions : [];
    const resolvedKey = typeof controllerSettings.snoozeProperty === 'string' && controllerSettings.snoozeProperty.trim()
      ? controllerSettings.snoozeProperty.trim()
      : (key || 'reminderSnooze');
    new SnoozeModal(
      this.app,
      this.filesFromEntries(entries),
      options,
      async (minutes) => {
        const files = this.filesFromEntries(entries);
        const snoozeDate = window.moment().add(minutes, 'minutes').format('YYYY-MM-DDTHH:mm:ss');
        await this.plugin.bulkEditService.updateFrontmatter(files, { [resolvedKey]: snoozeDate });
        new Notice(`Snoozed for ${minutes} minutes`);
        await this.afterWholeNotePropertyEdit(files, [resolvedKey]);
      }
    ).open();
  }

  // --- Tag utilities ---

  getAllKnownTags(): string[] {
    // @ts-ignore
    const cache = this.app.metadataCache;
    // @ts-ignore
    const tags = typeof cache.getTags === 'function' ? cache.getTags() : {};
    return Array.from(new Set(Object.keys(tags || {}).map(t => normalizeTagValue(t)).filter(Boolean)));
  }

  triggerTagSearch(tag: string): void {
    const cleanTag = normalizeTagValue(tag);
    const fallbackToNotebookNavigator = () => {
      const pluginManager = (this.app as any)?.plugins;
      const notebookNavigator =
        pluginManager?.getPlugin?.('notebook-navigator') ??
        pluginManager?.plugins?.['notebook-navigator'];
      const notebookNavigatorNavigateToTag = notebookNavigator?.api?.navigation?.navigateToTag;

      if (typeof notebookNavigatorNavigateToTag === 'function') {
        Promise.resolve(notebookNavigatorNavigateToTag.call(notebookNavigator.api.navigation, cleanTag))
          .catch((error: unknown) => {
            logger.error('[TPS GCM] Notebook Navigator tag navigation failed:', error);
            new Notice('Tag Canvas and Notebook Navigator tag navigation are unavailable.');
          });
        return;
      }
      new Notice('Tag Canvas and Notebook Navigator tag navigation are unavailable.');
    };

    try {
      const anyWindow = window as any;
      const globalOpenForTag = anyWindow?._tps_tagCanvas?.openForTag;
      if (typeof globalOpenForTag === 'function') {
        Promise.resolve(globalOpenForTag.call(anyWindow._tps_tagCanvas, cleanTag))
          .catch((error: unknown) => {
            logger.warn('[TPS GCM] Tag Canvas API (window).openForTag failed; falling back:', error);
            fallbackToNotebookNavigator();
          });
        return;
      }

      const pluginManager = (this.app as any)?.plugins;
      const tagCanvas =
        pluginManager?.getPlugin?.('tps-tag-canvas') ??
        pluginManager?.plugins?.['tps-tag-canvas'];
      const tagCanvasOpenForTag = tagCanvas?.api?.openForTag;
      if (typeof tagCanvasOpenForTag === 'function') {
        Promise.resolve(tagCanvasOpenForTag.call(tagCanvas.api, cleanTag))
          .catch((error: unknown) => {
            logger.warn('[TPS GCM] Tag Canvas API (plugin).openForTag failed; falling back:', error);
            fallbackToNotebookNavigator();
          });
        return;
      }

      // Fallback: if openForTag isn't available, use sync->getCanvasPath->openFile as before
      const globalApiSyncForTag = anyWindow?._tps_tagCanvas?.syncForTag;
      const globalApiGetCanvasPath = anyWindow?._tps_tagCanvas?.getCanvasPath;
      if (typeof globalApiSyncForTag === 'function' && typeof globalApiGetCanvasPath === 'function') {
        Promise.resolve((async () => {
          await globalApiSyncForTag(cleanTag);
          const canvasPath = String(globalApiGetCanvasPath(cleanTag) || '').trim();
          if (!canvasPath) throw new Error('No canvas path returned for tag');
          const canvasFile = this.app.vault.getAbstractFileByPath(canvasPath);
          if (!(canvasFile instanceof TFile)) throw new Error(`Canvas file not found: ${canvasPath}`);
          const leaf = this.resolvePreferredContentLeaf();
          if (!leaf) throw new Error('No target leaf available');
          await leaf.openFile(canvasFile);
        })())
          .catch((error: unknown) => {
            logger.error('[TPS GCM] Tag Canvas API (window) failed; falling back to Notebook Navigator:', error);
            fallbackToNotebookNavigator();
          });
        return;
      }

      const tagCanvasSyncForTag = tagCanvas?.api?.syncForTag;
      const tagCanvasGetCanvasPath = tagCanvas?.api?.getCanvasPath;
      if (typeof tagCanvasSyncForTag === 'function' && typeof tagCanvasGetCanvasPath === 'function') {
        Promise.resolve((async () => {
          await tagCanvasSyncForTag.call(tagCanvas.api, cleanTag);
          const canvasPath = String(tagCanvasGetCanvasPath.call(tagCanvas.api, cleanTag) || '').trim();
          if (!canvasPath) throw new Error('No canvas path returned for tag');
          const canvasFile = this.app.vault.getAbstractFileByPath(canvasPath);
          if (!(canvasFile instanceof TFile)) throw new Error(`Canvas file not found: ${canvasPath}`);
          const leaf = this.resolvePreferredContentLeaf();
          if (!leaf) throw new Error('No target leaf available');
          await leaf.openFile(canvasFile);
        })())
          .catch((error: unknown) => {
            logger.error('[TPS GCM] Tag Canvas API (plugin) failed; falling back to Notebook Navigator:', error);
            fallbackToNotebookNavigator();
          });
        return;
      }

      const notebookNavigator =
        pluginManager?.getPlugin?.('notebook-navigator') ??
        pluginManager?.plugins?.['notebook-navigator'];
      const notebookNavigatorNavigateToTag = notebookNavigator?.api?.navigation?.navigateToTag;

      if (typeof notebookNavigatorNavigateToTag === 'function') {
        Promise.resolve(notebookNavigatorNavigateToTag.call(notebookNavigator.api.navigation, cleanTag))
          .catch((error: unknown) => logger.error('[TPS GCM] Notebook Navigator tag navigation failed:', error));
        return;
      }
      new Notice('Tag Canvas and Notebook Navigator tag navigation are unavailable.');
    } catch (error) {
      logger.error('[TPS GCM] Failed to navigate tag from context menu:', error);
      new Notice('Tag Canvas and Notebook Navigator tag navigation are unavailable.');
    }
  }

  formatDatetimeDisplay(value: string | null | undefined): string {
    if (!value) return '';
    const momentLib = (window as any).moment;
    if (momentLib) {
      const parsed = momentLib(value);
      if (parsed.isValid()) {
        if (value.length <= 10 || parsed.format('HH:mm:ss') === '00:00:00') {
          return parsed.format('ddd, MMM D, YYYY');
        }
        return parsed.format('ddd, MMM D, YYYY [at] h:mm A');
      }
    }
    const parsedDate = new Date(value);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
    return value;
  }

  private async applyNotebookNavigatorRulesToFile(file: TFile): Promise<void> {
    try {
      await this.plugin.notebookNavigatorRuleService.applyRulesToFile(file, {
        reason: 'whole-note-inline-property-edit',
        force: true,
        bypassCreationGrace: true,
      });
    } catch (error) {
      logger.warn('[TPS GCM] Failed applying Notebook Navigator rules after property update:', file.path, error);
    }
  }

  private async afterWholeNotePropertyEdit(files: TFile[], changedKeys: string[]): Promise<void> {
    await Promise.all(files.map((file) => this.applyNotebookNavigatorRulesToFile(file)));
    for (const file of files) {
      this.plugin.persistentMenuManager?.refreshMenusForFile(file, true);
    }
    void this.plugin.viewModeManager?.handlePotentialFrontmatterChange(files, changedKeys);
  }

  get app() {
    return this.plugin.app;
  }
}
