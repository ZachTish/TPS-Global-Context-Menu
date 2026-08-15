import { App, Menu, MenuItem, TFile, Notice, normalizePath } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { TextInputModal } from '../modals/text-input-modal';
import { FileSuggestModal } from '../modals/FileSuggestModal';
import { MultiFileSelectModal } from '../modals/MultiFileSelectModal';
import { normalizeTagList, normalizeTagValue } from '../utils/tag-utils';
import {
  getWikilinkDisplayText,
  isLinkListProperty,
  isTextListProperty,
  parseLinkListInput,
  parseMixedListInput,
  parseStringListInput,
} from '../utils/list-utils';
import * as logger from '../logger';
import { resolveCustomProperties } from '../resolve-profiles';
import { ViewModeService } from '../services/view-mode-service';
import { parseLinksFromFrontmatterValue } from '../services/link-target-service';
import { promptAndCreateSubitemForParent } from '../services/subitem-creation-service';
import { getPlainDisplayTitle } from '../utils/display-title';
import { isEntityReferenceProperty } from '../utils/entity-property';
import { addPropertyValueChoiceMenuItems } from './property-value-choice-menu';
import { propertyUsesEntityOptions } from '../utils/property-option-source';
import { isPathInArchiveFolder } from '../services/archive-file-service';
import { createCustomPropertyMenuExclusionPredicate } from '../services/custom-property-menu-filter';

export interface NativeMenuLabelOptions {
  archiveLabel?: string;
  deleteLabel?: string;
  includeTitle?: boolean;
  includeTags?: boolean;
  includeDelete?: boolean;
  excludeStandardTagProperties?: boolean;
  includeSingleTargetActions?: boolean;
  excludeCustomPropertyKeys?: readonly string[];
}

/** Minimal synchronous menu surface shared with guarded third-party hosts. */
export interface GcmMenuSink {
  addItem(callback: (item: MenuItem) => void): unknown;
  addSeparator(): unknown;
}

export class MenuBuilder {
  private plugin: TPSGlobalContextMenuPlugin;
  private delegates: {
    createFileEntries: (files: TFile[]) => any[];
    openAddTagModal: (entries: any[], key?: string) => void;
    openAddListValueModal: (entries: any[], key: string, label?: string) => void;
    openScheduledModal: (entries: any[], key?: string) => void;
    openRecurrenceModalNative: (entries: any[]) => void;
    openSnoozeModal: (entries: any[], key?: string) => void;
    getRecurrenceValue: (fm: any) => string;
    moveFiles: (entries: any[], folderPath: string) => Promise<void>;
    getTypeFolderOptions: () => { path: string; label: string }[];
  };

  constructor(
    plugin: TPSGlobalContextMenuPlugin,
    delegates: MenuBuilder['delegates']
  ) {
    this.plugin = plugin;
    this.delegates = delegates;
  }

  private get app(): App {
    return this.plugin.app;
  }

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

  private resolveParentFilesFor(file: TFile): TFile[] {
    const parents = new Map<string, TFile>();
    for (const entry of this.plugin.parentLinkResolutionService.getParentsForChild(file)) {
      if (entry.file.path !== file.path) parents.set(entry.file.path, entry.file);
    }
    return Array.from(parents.values());
  }

  private resolveChildFilesFor(file: TFile): TFile[] {
    const children = new Map<string, TFile>();
    const indexed = this.plugin.app.vault.getMarkdownFiles().filter((candidate) =>
      this.plugin.parentLinkResolutionService.hasParent(candidate, file),
    );
    for (const child of indexed) {
      if (child.path !== file.path) children.set(child.path, child);
    }

    return Array.from(children.values());
  }

  private getFileDisplayTitle(file: TFile): string {
    return getPlainDisplayTitle(this.plugin.noteTitleRenderService.getDisplayTitle(file), file.basename);
  }

  private getFileIconMeta(file: TFile): { icon: string; color?: string } {
    const frontmatter = (this.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, any>;
    const rawIcon = typeof frontmatter.icon === 'string' ? frontmatter.icon.trim() : '';
    const rawColor = typeof frontmatter.color === 'string' ? frontmatter.color.trim() : '';
    const icon = rawIcon.replace(/^lucide:/i, '') || 'file-text';
    return {
      icon,
      color: rawColor || undefined,
    };
  }

  private isPropertyFile(file: TFile): boolean {
    const extension = file.extension?.toLowerCase();
    return extension === 'md' || extension === 'canvas';
  }

  private getPropertyFiles(entries: any[]): TFile[] {
    const files: TFile[] = [];
    const seen = new Set<string>();
    for (const entry of entries || []) {
      const candidate = entry?.file ?? entry;
      const file = candidate instanceof TFile
        ? candidate
        : typeof candidate?.path === 'string'
          ? this.app.vault.getFileByPath(candidate.path)
          : null;
      if (!(file instanceof TFile)) continue;
      if (!this.isPropertyFile(file)) continue;
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      files.push(file);
    }
    return files;
  }

  private async updatePropertyFiles(entries: any[], updates: Record<string, unknown>): Promise<number> {
    const files = this.getPropertyFiles(entries);
    if (files.length === 0) return 0;
    return this.plugin.bulkEditService.updateFrontmatter(files, updates);
  }

  private async finalizeContextPropertyWrite(files: TFile[], keys: string[], reason: string, count: number): Promise<void> {
    if (files.length === 0) {
      new Notice('No file target was resolved for this menu action.');
      logger.warn('[TPS GCM] Context menu write skipped: no property file targets', { reason, keys });
      return;
    }

    if (count <= 0) {
      logger.warn('[TPS GCM] Context menu write made no changes', {
        reason,
        keys,
        files: files.map((file) => file.path),
      });
      return;
    }

    await Promise.all(files.map((file: TFile) =>
      this.plugin.notebookNavigatorRuleService.applyRulesToFile(file, {
        reason,
        force: true,
        bypassCreationGrace: true,
      }),
    ));

    for (const file of files) {
      this.plugin.persistentMenuManager?.refreshMenusForFile(file, true);
    }

    try {
      const paths = files.map((file) => file.path);
      this.plugin.eventService.emitFilesUpdated(paths);
    } catch (error) {
      logger.warn('[TPS GCM] Failed to trigger context menu refresh after property write', { reason, error });
    }
  }

  private async setContextPropertyValue(entries: any[], prop: any, value: unknown, reason: string): Promise<number> {
    const files = this.getPropertyFiles(entries);
    if (files.length === 0) {
      await this.finalizeContextPropertyWrite(files, [String(prop.key || '')], reason, 0);
      return 0;
    }

    const key = String(prop.key || '');
    const count = key.toLowerCase() === 'status' && !propertyUsesEntityOptions(prop)
      ? await this.plugin.bulkEditService.setStatus(files, String(value ?? '').trim())
      : await this.plugin.bulkEditService.updateFrontmatter(files, { [key]: value });
    await this.finalizeContextPropertyWrite(files, [key], reason, count);
    return count;
  }

  private async removeContextProperty(entries: any[], key: string, reason: string): Promise<number> {
    const files = this.getPropertyFiles(entries);
    if (files.length === 0) {
      await this.finalizeContextPropertyWrite(files, [key], reason, 0);
      return 0;
    }

    const count = await this.plugin.bulkEditService.removeFrontmatterKey(files, key);
    await this.finalizeContextPropertyWrite(files, [key], reason, count);
    return count;
  }

  private async addContextListValue(
    entries: any[],
    prop: any,
    value: string,
    entityReference: boolean,
    reason: string,
  ): Promise<number> {
    const files = this.getPropertyFiles(entries);
    const key = String(prop?.key || '').trim();
    if (files.length === 0 || !key) {
      await this.finalizeContextPropertyWrite(files, [key], reason, 0);
      return 0;
    }
    const count = await this.plugin.bulkEditService.addListValues(
      files,
      value,
      key,
      entityReference,
    );
    await this.finalizeContextPropertyWrite(files, [key], reason, count);
    return count;
  }

  private async removeContextListValue(
    entries: any[],
    prop: any,
    value: string,
    reason: string,
  ): Promise<number> {
    const files = this.getPropertyFiles(entries);
    const key = String(prop?.key || '').trim();
    if (files.length === 0 || !key) {
      await this.finalizeContextPropertyWrite(files, [key], reason, 0);
      return 0;
    }
    const count = await this.plugin.bulkEditService.removeListValues(files, value, key);
    await this.finalizeContextPropertyWrite(files, [key], reason, count);
    return count;
  }

  private async addContextTagValue(
    entries: any[],
    prop: any,
    value: string,
    reason: string,
  ): Promise<number> {
    const files = this.getPropertyFiles(entries);
    const key = String(prop?.key || '').trim();
    if (files.length === 0 || !key) {
      await this.finalizeContextPropertyWrite(files, [key], reason, 0);
      return 0;
    }
    const count = await this.plugin.bulkEditService.addTag(files, value, key);
    await this.finalizeContextPropertyWrite(files, [key], reason, count);
    return count;
  }

  private async removeContextTagValue(
    entries: any[],
    prop: any,
    value: string,
    reason: string,
  ): Promise<number> {
    const files = this.getPropertyFiles(entries);
    const key = String(prop?.key || '').trim();
    if (files.length === 0 || !key) {
      await this.finalizeContextPropertyWrite(files, [key], reason, 0);
      return 0;
    }
    const count = await this.plugin.bulkEditService.removeTag(files, value, key);
    await this.finalizeContextPropertyWrite(files, [key], reason, count);
    return count;
  }

  private populateParentRelationSubmenu(menu: Menu, file: TFile): void {
    const parentFiles = this.resolveParentFilesFor(file);

    menu.addItem((sub) => {
      sub.setTitle(parentFiles.length > 0 ? 'Add another parent...' : 'Link existing parent...')
        .setIcon('plus')
        .onClick(() => {
          new FileSuggestModal(this.app, async (parentFile: TFile) => {
            const linked = await this.plugin.bulkEditService.linkToParent([file], parentFile);
            new Notice(linked > 0
              ? `Linked to parent: ${parentFile.basename}`
              : 'The relationship is no longer available.');
          }, {
            extensions: ['md', 'base'],
            filter: (candidate) => (
              candidate.path !== file.path
              && !this.plugin.parentLinkResolutionService.isIgnoredFile(candidate)
            ),
          }).open();
        });
    });

    menu.addSeparator();

    if (parentFiles.length === 0) {
      menu.addItem((sub) => {
        sub.setTitle('No linked parents')
          .setIcon('info')
          .setDisabled(true);
      });
      return;
    }

    parentFiles.forEach((parentFile) => {
      menu.addItem((sub) => {
        sub.setTitle(this.getFileDisplayTitle(parentFile))
          .setIcon(this.getFileIconMeta(parentFile).icon || 'file-text')
          .onClick(() => {
            void this.plugin.openFileInLeaf(parentFile, false, () => this.app.workspace.getLeaf(false), {
              revealLeaf: true,
              ignoreCanvasDragGuard: true,
            });
          });
      });

      menu.addItem((sub) => {
        sub.setTitle(this.getFileDisplayTitle(parentFile))
          .setIcon('x')
          .onClick(async () => {
            await this.plugin.bulkEditService.unlinkFromParent(file, parentFile);
            new Notice(`Removed parent link: ${this.getFileDisplayTitle(parentFile)}`);
          });
      });
    });
  }

  private populateChildRelationSubmenu(menu: Menu, file: TFile): void {
    const childFiles = this.resolveChildFilesFor(file);

    menu.addItem((sub) => {
      sub.setTitle('Create new child...')
        .setIcon('plus')
        .onClick(() => {
          void promptAndCreateSubitemForParent(this.plugin, file);
        });
    });

    menu.addItem((sub) => {
      sub.setTitle('Link existing child...')
        .setIcon('link')
        .onClick(() => {
          new MultiFileSelectModal(this.app, async (childFilesToAdd: TFile[]) => {
            if (childFilesToAdd.length > 0) {
              const linked = await this.plugin.bulkEditService.linkChildren(file, childFilesToAdd);
              new Notice(`Linked ${linked} children to this note.`);
            }
          }, {
            filter: (candidate) => (
              candidate.path !== file.path
              && !this.plugin.parentLinkResolutionService.isIgnoredFile(candidate)
            ),
          }).open();
        });
    });

    menu.addSeparator();

    if (childFiles.length === 0) {
      menu.addItem((sub) => {
        sub.setTitle('No linked children')
          .setIcon('info')
          .setDisabled(true);
      });
      return;
    }

    childFiles.forEach((childFile) => {
      menu.addItem((sub) => {
        sub.setTitle(this.getFileDisplayTitle(childFile))
          .setIcon(this.getFileIconMeta(childFile).icon || 'file-text')
          .onClick(() => {
            void this.plugin.openFileInLeaf(childFile, false, () => this.app.workspace.getLeaf(false), {
              revealLeaf: true,
              ignoreCanvasDragGuard: true,
            });
          });
      });

      menu.addItem((sub) => {
        sub.setTitle(this.getFileDisplayTitle(childFile))
          .setIcon('x')
          .onClick(async () => {
            await this.plugin.bulkEditService.unlinkFromParent(childFile, file);
            new Notice(`Removed child link: ${this.getFileDisplayTitle(childFile)}`);
          });
      });
    });
  }

  private setFrontmatterValueCaseInsensitive(frontmatter: Record<string, any>, key: string, value: any): void {
    if (!frontmatter || typeof frontmatter !== 'object') return;
    if (key in frontmatter) {
      frontmatter[key] = value;
      return;
    }
    const lowerKey = key.toLowerCase();
    const existingKey = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === lowerKey);
    frontmatter[existingKey ?? key] = value;
  }

  private async archiveFiles(files: TFile[]): Promise<void> {
    await this.plugin.archiveFileService.archiveFiles(files, 'native-context-menu');
  }

  private async unarchiveFiles(files: TFile[]): Promise<void> {
    await this.plugin.archiveFileService.unarchiveFiles(files, 'native-context-menu');
  }

  private isFileInArchive(files: TFile[]): boolean {
    const archiveFolder = this.plugin.getArchiveFolderPath();
    if (!archiveFolder) return false;
    return files.some(file => file instanceof TFile && isPathInArchiveFolder(file.path, archiveFolder));
  }

  private buildRenameTargetPath(file: TFile, rawName: string): string | null {
    const trimmed = String(rawName || '').trim();
    if (!trimmed) return null;

    let baseName = trimmed.replace(/[\\/]/g, ' ').trim();
    if (!baseName) return null;

    if (file.extension) {
      const extSuffix = `.${file.extension.toLowerCase()}`;
      if (baseName.toLowerCase().endsWith(extSuffix)) {
        baseName = baseName.slice(0, -extSuffix.length).trim();
      }
    }
    if (!baseName) return null;

    const targetName = file.extension ? `${baseName}.${file.extension}` : baseName;
    const parentPath = file.parent?.path ?? '';
    return normalizePath(parentPath ? `${parentPath}/${targetName}` : targetName);
  }

  private async promptRenameFile(file: TFile): Promise<void> {
    await this.plugin.noteTitleRenderService.promptRenameTitle(file);
  }

  addToNativeMenu(menu: Menu, files: TFile[], options: NativeMenuLabelOptions = {}) {
    // Prevent duplicate additions to the same menu instance
    if ((menu as any)._tpsHandled) return;
    (menu as any)._tpsHandled = true;

    // Delegate resolution to service
    const resolvedFiles = this.plugin.contextTargetService.resolveTargets(files);
    this.addResolvedFilesToMenu(menu, resolvedFiles, options, true);
  }

  /**
   * Adds canonical GCM note actions for only the supplied, currently-live files.
   * This deliberately bypasses ContextTargetService so an integration-owned row
   * cannot inherit an unrelated active editor or explorer selection.
   */
  addToExactFileMenu(menu: GcmMenuSink, files: readonly TFile[], options: NativeMenuLabelOptions = {}): void {
    const exactFiles = new Map<string, TFile>();
    for (const candidate of files) {
      if (!(candidate instanceof TFile)) continue;
      const path = normalizePath(String(candidate.path || '').trim());
      if (!path || exactFiles.has(path)) continue;
      const current = this.app.vault.getFileByPath(path);
      // A deleted/recreated file can reuse the same path with a different
      // TFile identity. Treat that foreign row snapshot as stale rather than
      // silently retargeting its actions to the replacement note.
      if (!(current instanceof TFile) || current !== candidate) continue;
      exactFiles.set(path, candidate);
    }
    this.addResolvedFilesToMenu(menu, [...exactFiles.values()], options, false);
  }

  private addResolvedFilesToMenu(
    targetMenu: GcmMenuSink,
    resolvedFiles: readonly TFile[],
    options: NativeMenuLabelOptions,
    markTpsItems: boolean,
  ): void {
    const menu: GcmMenuSink = markTpsItems
      ? {
          addItem: (callback) => targetMenu.addItem((item) => {
            callback(item);
            (item as any)._isTpsItem = true;
          }),
          addSeparator: () => targetMenu.addSeparator(),
        }
      : targetMenu;

    // Create entries for ALL resolved files
    const entries = this.delegates.createFileEntries([...resolvedFiles]);
    if (!entries.length) return;

    // Filter for markdown-specific features
    const markdownEntries = entries.filter(e => e.file.extension?.toLowerCase() === 'md');
    const markdownFiles = this.getPropertyFiles(markdownEntries).filter((candidate) => candidate.extension?.toLowerCase() === 'md');
    const propertyEntries = entries.filter((entry) => this.isPropertyFile(entry.file));
    const allEntriesSupportProperties = propertyEntries.length === entries.length;
    const allEntriesAreMarkdown = markdownEntries.length === entries.length;

    const file = entries[0].file;
    const includeSingleTargetActions = options.includeSingleTargetActions !== false;

    if (options.includeTitle !== false) {
      menu.addItem((item) => {
        if (entries.length > 1) {
          item
            .setTitle(`Title: ${entries.length} items selected`)
            .setIcon('pencil')
            .setSection('tps-title')
            .setDisabled(true);
          return;
        }
        const displayTitle = this.getFileDisplayTitle(file) || '(untitled)';
        item
          .setTitle(`Title: ${displayTitle}`)
          .setIcon('pencil')
          .setSection('tps-title');
        if (file.extension?.toLowerCase() !== 'md') {
          item.setDisabled(true);
          return;
        }
        item.onClick(() => {
          void this.promptRenameFile(file);
        });
      });
    }

    // Handwriting / PDF Integration
    if (includeSingleTargetActions && file.extension === 'pdf') {
      menu.addItem((item) => {
        item.setTitle('Write on PDF')
          .setIcon('pencil')
          .setSection('tps-file-ops')
          .onClick(async () => {
            const app = (this.app as any);
            if (app.openWithDefaultApp && file instanceof TFile) {
              app.openWithDefaultApp(file.path);
              return;
            }
            new Notice("Could not open PDF with the system default app.");
          });
      });
    }

    // Dynamic Properties
    if (allEntriesSupportProperties && this.plugin.settings.showCustomPropertiesInContextMenu !== false) {
      const properties = resolveCustomProperties(this.plugin.settings.properties || [], propertyEntries, new ViewModeService(), 'context');
      const isExcludedCustomProperty = createCustomPropertyMenuExclusionPredicate({
        excludeCustomPropertyKeys: options.excludeCustomPropertyKeys,
        excludeStandardTagProperties: options.excludeStandardTagProperties === true || options.includeTags === true,
      });

      properties.forEach(prop => {
        if (prop.showInContextMenu === false) return;
        if (String(prop.key || '').trim().toLowerCase() === 'title' || String(prop.id || '').trim().toLowerCase() === 'title') return;
        if (isExcludedCustomProperty(prop)) return;

        if (isEntityReferenceProperty(prop)) {
          this.addEntityReferenceToMenu(menu, propertyEntries, prop, 'tps-props');
          return;
        }

        if (prop.key === 'snooze' || prop.type === 'snooze') {
          menu.addItem((item) => {
            const val = this.getValueCaseInsensitive(propertyEntries[0].frontmatter, prop.key);
            const isUndefined = !this.plugin.fieldInitializationService.isFieldDefinedForEntries(propertyEntries, prop.key);
            const title = isUndefined ? `${prop.label} (create field)` : (val ? `Snooze: ${val}` : 'Snooze...');

            item.setTitle(title)
              .setIcon(prop.icon || 'clock')
              .setSection('tps-props');

            if (prop.disabled) {
              item.setDisabled(true);
              (item as any).setTitle(`${title} (Mixed Profiles)`);
              return;
            }

            item.onClick(async () => {
              if (await this.plugin.fieldInitializationService.checkAndInitialize(propertyEntries, prop.key, '')) {
                return; // Field initialized, skip modal
              }
              this.delegates.openSnoozeModal(propertyEntries, prop.key);
            });
          });
          return;
        }

        if (prop.type === 'selector' || prop.type === 'kind') {
          this.addSelectorToMenu(menu, propertyEntries, prop, 'tps-props');
        } else if (prop.type === 'list') {
          this.addListToMenu(menu, propertyEntries, prop, 'tps-props');
        } else if (prop.type === 'datetime') {
          this.addDatetimeToMenu(menu, propertyEntries, prop, 'tps-props');
        } else if (prop.type === 'recurrence') {
          this.addRecurrenceToMenu(menu, propertyEntries, prop, 'tps-props');
        } else if (prop.type === 'folder') {
          this.addFolderToMenu(menu, propertyEntries, prop, 'tps-props');
        }
        else if (prop.type === 'text' || prop.type === 'number') {
          menu.addItem((item) => {
            const val = this.getValueCaseInsensitive(propertyEntries[0].frontmatter, prop.key);
            const isUndefined = !this.plugin.fieldInitializationService.isFieldDefinedForEntries(propertyEntries, prop.key);
            const title = isUndefined ? `${prop.label} (create field)` : `${prop.label}: ${val || 'Empty'}`;

            item.setTitle(title)
              .setIcon(prop.icon || 'pencil')
              .setSection('tps-props');
            if (prop.disabled) {
              item.setDisabled(true);
              (item as any).setTitle(`${title} (Mixed Profiles)`);
              return;
            }

            item.onClick(async () => {
              const defaultValue = prop.type === 'number' ? 0 : '';
              if (await this.plugin.fieldInitializationService.checkAndInitialize(propertyEntries, prop.key, defaultValue)) {
                return; // Field initialized, skip modal
              }

              new TextInputModal(
                this.app,
                prop.label,
                val ?? '',
                async (newVal) => {
                  if (newVal !== null && newVal !== undefined) {
                    const finalVal = prop.type === 'number' ? Number(newVal) : newVal;
                    const files = this.getPropertyFiles(propertyEntries);
                    await this.updatePropertyFiles(propertyEntries, { [prop.key]: finalVal });

                    const normalizedKey = String(prop?.key || '').trim().toLowerCase();
                    if (normalizedKey === 'title') {
                      const nextTitle = String(finalVal ?? '').trim();
                      await Promise.all(
                        files.map((entryFile) =>
                          this.plugin.fileNamingService.updateFilenameIfNeeded(entryFile, { bypassCreationGrace: true, titleOverride: nextTitle })
                        )
                      );
                    }
                  }
                }
              ).open();
            });
          });
        }

      });

    }

    // Base note rows always expose Tags even when the broader custom-property
    // context-menu surface is disabled. Skip the configured Tags row above so
    // this opt-in path remains singular and predictable.
    if (allEntriesSupportProperties && options.includeTags === true) {
      this.addListToMenu(menu, propertyEntries, {
        id: 'tags',
        label: 'Tags',
        key: 'tags',
        type: 'list',
        listItemType: 'tag',
        icon: 'tag',
      }, 'tps-props');
    }

    // Relationship and tracking operations are note actions, not custom properties.
    if (allEntriesAreMarkdown) {
      if (includeSingleTargetActions) {
        if (!this.plugin.parentLinkResolutionService.isIgnoredFile(file)) {
          const parentCount = this.resolveParentFilesFor(file).length;
          const childCount = this.resolveChildFilesFor(file).length;

          menu.addItem((item) => {
            item.setTitle(parentCount > 0 ? `Link to Parent (${parentCount})` : 'Link to Parent')
              .setIcon('link')
              .setSection('tps-props');

            const subMenu = (item as any).setSubmenu();
            this.populateParentRelationSubmenu(subMenu, file);
          });

          menu.addItem((item) => {
            item.setTitle(childCount > 0 ? `Link Children (${childCount})` : 'Link Children')
              .setIcon('network')
              .setSection('tps-props');

            const subMenu = (item as any).setSubmenu();
            this.populateChildRelationSubmenu(subMenu, file);
          });
        }

        menu.addItem((item) => {
          item.setTitle('Embed Attachments')
            .setIcon('paperclip')
            .setSection('tps-props')
            .onClick(() => {
              new MultiFileSelectModal(this.app, async (attachmentFiles: TFile[]) => {
                if (attachmentFiles.length > 0) {
                  const added = await this.plugin.bulkEditService.linkAttachments(file, attachmentFiles);
                  new Notice(`Embedded ${added} attachment(s) in this note.`);
                }
              }).open();
            });
        });
      }

      menu.addItem((item) => {
        const label = markdownEntries.length > 1
          ? `Convert to list items (${markdownEntries.length})`
          : 'Convert to list item';
        item.setTitle(label)
          .setIcon('list-plus')
          .setSection('tps-props')
          .onClick(async () => {
            await this.plugin.noteOperationService.convertNotesToListItems(markdownFiles);
          });
      });

      menu.addItem((item) => {
        const label = markdownEntries.length > 1
          ? `Convert to canvases (${markdownEntries.length})`
          : 'Convert to canvas';
        item.setTitle(label)
          .setIcon('layout-dashboard')
          .setSection('tps-props')
          .onClick(async () => {
            await this.plugin.noteOperationService.convertNotesToCanvases(markdownFiles);
          });
      });

      if (includeSingleTargetActions && this.plugin.settings.enableTimeTracking !== false) {
        const activeTimerCount = this.plugin.timeTrackingService.getActiveTimerCountForFileSync(file);
        menu.addItem((item) => {
          item.setTitle('Time Tracking')
            .setIcon('timer')
            .setSection('tps-props');

          const subMenu = (item as any).setSubmenu();
          if (activeTimerCount > 0) {
            subMenu.addItem((sub: any) => {
              sub.setTitle('Open work-session notes')
                .setIcon('notebook-pen')
                .onClick(async () => {
                  const opened = await this.plugin.timeTrackingService.openActiveSessionNotesForFile(file);
                  if (!opened) new Notice('Could not open work-session notes.');
                });
            });
            subMenu.addItem((sub: any) => {
              sub.setTitle(activeTimerCount > 1 ? `End timer (${activeTimerCount})` : 'End timer')
                .setIcon('square')
                .onClick(async () => {
                  await this.plugin.timeTrackingService.stopActiveTimerForFile(file);
                });
            });
          } else {
            subMenu.addItem((sub: any) => {
              sub.setTitle('Start work session')
                .setIcon('play')
                .onClick(async () => {
                  await this.plugin.timeTrackingService.startTimer({ file, type: 'note' });
                });
            });
          }
          subMenu.addItem((sub: any) => {
            sub.setTitle('Add manual session')
              .setIcon('clock')
              .onClick(async () => {
                await this.plugin.timeTrackingService.promptAddManualSession({ file, type: 'note' });
              });
          });
        });
      }
    }

    // Archive / Unarchive
    {
      const archiveFiles = entries.map((entry) => entry.file);
      const inArchive = this.isFileInArchive(archiveFiles);
      menu.addItem((item) => {
        const fileCount = entries.length;
        if (inArchive) {
          const unarchiveLabel = options.archiveLabel || (fileCount > 1 ? `Unarchive (${fileCount} items)` : 'Unarchive');
          item.setTitle(unarchiveLabel)
            .setIcon('inbox')
            .setSection('tps-delete')
            .onClick(async () => {
              await this.unarchiveFiles(archiveFiles);
            });
        } else {
          const archiveLabel = options.archiveLabel || (fileCount > 1 ? `Archive (${fileCount} items)` : 'Archive');
          item.setTitle(archiveLabel)
            .setIcon('archive')
            .setSection('tps-delete')
            .onClick(async () => {
              await this.archiveFiles(archiveFiles);
            });
        }
      });

      if (options.includeDelete !== false) {
        menu.addItem((item) => {
          const fileCount = entries.length;
          const deleteLabel = options.deleteLabel || (fileCount > 1 ? `Delete (${fileCount} items)` : 'Delete');
          item.setTitle(deleteLabel)
            .setIcon('trash')
            .setSection('tps-delete')
            .setWarning(true)
            .onClick(async () => {
              if (fileCount === 1 && this.app.fileManager.promptForDeletion) {
                this.app.fileManager.promptForDeletion(entries[0].file);
              } else {
                const confirmMsg = fileCount === 1
                  ? `Are you sure you want to delete "${entries[0].file.name}"?`
                  : `Are you sure you want to delete ${fileCount} items?`;
                if (confirm(confirmMsg)) {
                  const filesToDelete = entries
                    .map((entry: any) => entry.file)
                    .filter((candidate: unknown): candidate is TFile => candidate instanceof TFile);
                  await this.plugin.runQueuedDelete(filesToDelete, async () => {
                    for (const entry of entries) {
                      await this.app.vault.trash(entry.file, true);
                    }
                  });
                }
              }
            });
        });
      }
    }

  }

  addSelectorToMenu(menu: GcmMenuSink, entries: any[], prop: any, sectionId: string) {
    menu.addItem((item) => {
      const allValues = entries.map((e: any) => this.getValueCaseInsensitive(e.frontmatter, prop.key) || '');
      const uniqueValues = new Set(allValues);
      const current = uniqueValues.size === 1 ? allValues[0] : 'Mixed';
      const allWithoutKey = entries.every((e: any) => !this.hasKeyCaseInsensitive(e.frontmatter, prop.key));
      const isUndefined = allWithoutKey;
      const title = isUndefined ? `${prop.label} (create field)` : `${prop.label}: ${current}`;

      item.setTitle(title)
        .setIcon(prop.icon || 'hash')
        .setSection(sectionId);

      if (prop.disabled) {
        item.setDisabled(true);
        (item as any).setTitle(`${title} (Mixed Profiles)`);
        return;
      }

      const subMenu = (item as any).setSubmenu();
      addPropertyValueChoiceMenuItems({
        app: this.app,
        source: this.plugin,
        menu: subMenu,
        property: prop,
        currentValue: current === 'Mixed' ? '' : String(current || ''),
        onClear: () => this.removeContextProperty(entries, prop.key, 'context-selector-clear'),
        onChooseLiteral: (value) => this.setContextPropertyValue(
          entries,
          prop,
          value,
          'context-selector-literal',
        ),
        onChooseEntity: (choice) => this.setContextPropertyValue(
          entries,
          prop,
          choice.wikilink,
          'context-selector-entity',
        ),
      });
    });
  }

  addEntityReferenceToMenu(menu: GcmMenuSink, entries: any[], prop: any, sectionId: string) {
    menu.addItem((item) => {
      const isList = prop.type === 'list';
      const allValues = entries.map((entry: any) => this.getValueCaseInsensitive(entry.frontmatter, prop.key) || '');
      const uniqueValues = new Set(allValues);
      const current = uniqueValues.size === 1 ? String(allValues[0] || '') : 'Mixed';
      const currentItems = isList
        ? isLinkListProperty(prop)
          ? parseLinkListInput(allValues[0])
          : parseMixedListInput(allValues[0])
        : [];
      const title = isList
        ? `${prop.label}${currentItems.length > 0 ? ` (${currentItems.length})` : ' (create field)'}`
        : current && current !== 'Mixed'
          ? `${prop.label}: ${/^\[\[/u.test(current) ? getWikilinkDisplayText(current) : current}`
        : current === 'Mixed'
          ? `${prop.label}: Mixed`
          : `${prop.label} (create field)`;
      item
        .setTitle(title)
        .setIcon(prop.icon || 'file-search')
        .setSection(sectionId);
      if (prop.disabled) {
        item.setDisabled(true);
        return;
      }
      const subMenu = (item as any).setSubmenu();
      addPropertyValueChoiceMenuItems({
        app: this.app,
        source: this.plugin,
        menu: subMenu,
        property: prop,
        currentValue: isList ? currentItems : current === 'Mixed' ? '' : current,
        onClear: () => this.removeContextProperty(entries, prop.key, 'context-entity-clear'),
        onChooseLiteral: (value) => isList
          ? this.addContextListValue(entries, prop, value, false, 'context-list-literal-option')
          : this.setContextPropertyValue(entries, prop, value, 'context-literal-option'),
        onChooseEntity: (choice) => isList
          ? this.addContextListValue(
              entries,
              prop,
              choice.wikilink,
              true,
              'context-list-entity-option',
            )
          : this.setContextPropertyValue(entries, prop, choice.wikilink, 'context-entity-option'),
      });
      if (isList && currentItems.length > 0) {
        subMenu.addSeparator();
        currentItems.forEach((value) => {
          subMenu.addItem((sub) => sub
            .setTitle(`Remove ${/^\[\[/u.test(value) ? getWikilinkDisplayText(value) : value}`)
            .setIcon('x')
            .onClick(() => {
              void this.removeContextListValue(entries, prop, value, 'context-list-remove');
            }));
        });
      }
    });
  }

  addListToMenu(menu: GcmMenuSink, entries: any[], prop: any, sectionId: string) {
    menu.addItem((item) => {
      const listValues = this.getValueCaseInsensitive(entries[0].frontmatter, prop.key) || [];
      const items = isTextListProperty(prop)
        ? parseStringListInput(listValues)
        : isLinkListProperty(prop)
          ? parseLinkListInput(listValues)
          : normalizeTagList(listValues);
      const count = items.length;
      const isUndefined = !this.plugin.fieldInitializationService.isFieldDefinedForEntries(entries, prop.key);
      const title = isUndefined ? `${prop.label} (create field)` : `${prop.label} (${count})`;

      item.setTitle(title)
        .setIcon(prop.icon || 'list')
        .setSection(sectionId);

      if (prop.disabled) {
        item.setDisabled(true);
        (item as any).setTitle(`${title} (Mixed Profiles)`);
        return;
      }

      const subMenu = (item as any).setSubmenu();
      this.populateListSubmenu(subMenu, entries, prop, items);
    });
  }

  populateListSubmenu(menu: Menu, entries: any[], prop: any, items: string[]) {
    const isTags = !isTextListProperty(prop) && !isLinkListProperty(prop);
    const addLiteral = (value: string): Promise<number> => isTags
      ? this.addContextTagValue(entries, prop, value, 'context-list-tag-option')
      : this.addContextListValue(entries, prop, value, false, 'context-list-literal-option');
    addPropertyValueChoiceMenuItems({
      app: this.app,
      source: this.plugin,
      menu,
      property: prop,
      currentValue: items.length > 0 ? items.join(', ') : '',
      onClear: () => this.removeContextProperty(entries, prop.key, 'context-list-clear'),
      onChooseLiteral: addLiteral,
      onChooseEntity: (choice) => this.addContextListValue(
        entries,
        prop,
        choice.wikilink,
        true,
        'context-list-entity-option',
      ),
    });
    if (items.length > 0) menu.addSeparator();
    items.forEach((value) => {
      menu.addItem((sub: any) => {
        sub
          .setTitle(`Remove ${String(value)}`)
          .setIcon('x')
          .onClick(() => {
            void (isTags
              ? this.removeContextTagValue(entries, prop, value, 'context-list-tag-remove')
              : this.removeContextListValue(entries, prop, value, 'context-list-remove'));
          });
      });
    });
  }

  addDatetimeToMenu(menu: GcmMenuSink, entries: any[], prop: any, sectionId: string) {
    const val = this.getValueCaseInsensitive(entries[0].frontmatter, prop.key);
    const isUndefined = !this.plugin.fieldInitializationService.isFieldDefinedForEntries(entries, prop.key);
    const title = isUndefined ? `${prop.label} (create field)` : (val ? `${prop.label}: ${val}` : `Set ${prop.label}...`);

    menu.addItem((item) => {
      item.setTitle(title)
        .setIcon(prop.icon || 'calendar')
        .setSection(sectionId);

      if (prop.disabled) {
        item.setDisabled(true);
        (item as any).setTitle(`${title} (Mixed Profiles)`);
        return;
      }

      item.onClick(async () => {
        if (await this.plugin.fieldInitializationService.checkAndInitialize(entries, prop.key, '')) {
          return; // Field initialized, user can click again to set date
        }
        this.delegates.openScheduledModal(entries, prop.key);
      });
    });
  }

  addRecurrenceToMenu(menu: GcmMenuSink, entries: any[], prop: any, sectionId: string) {
    menu.addItem((item) => {
      item.setTitle(`${prop.label} (read-only)`)
        .setIcon(prop.icon || 'repeat')
        .setSection(sectionId)
        .setDisabled(true);
    });
  }

  addFolderToMenu(menu: GcmMenuSink, entries: any[], prop: any, sectionId: string) {
    const files = entries.map((e: any) => e.file);
    const inArchive = this.isFileInArchive(files);

    menu.addItem((item) => {
      const folder = entries[0].file.parent?.path || '/';
      item.setTitle(`${prop.label}: ${folder}`)
        .setIcon(prop.icon || 'folder')
        .setSection(sectionId);

      if (prop.disabled) {
        item.setDisabled(true);
        (item as any).setTitle(`${prop.label}: ${folder} (Mixed Profiles)`);
        return;
      }

      if (inArchive) {
        item.setDisabled(true);
        (item as any).setTitle(`${prop.label}: ${folder} (unarchive to move)`);
        return;
      }

      const subMenu = (item as any).setSubmenu();
      this.populateFolderMenu(subMenu, entries);
    });
  }

  populateFolderMenu(menu: Menu, entries: any[]) {
    const options = this.delegates.getTypeFolderOptions();
    options.forEach(({ path, label }) => {
      menu.addItem(item => {
        item.setTitle(label)
          .setChecked(entries[0].file.parent?.path === path)
          .onClick(async () => {
            await this.delegates.moveFiles(entries, path);
          });
      });
    });
  }
}
