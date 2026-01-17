import { App, Menu, TFile, Notice, Platform, TFolder, setIcon, WorkspaceLeaf } from 'obsidian';
import TPSGlobalContextMenuPlugin from './main';
import { MenuInterceptor } from './menu-interceptor';
import { AddTagModal } from './add-tag-modal';
import { FolderSelectionModal } from './folder-selection-modal';
import { RecurrenceModal } from './recurrence-modal';
import { ScheduledModal } from './scheduled-modal';
import { TextInputModal } from './text-input-modal';
import { SnoozeModal } from './snooze-modal';
import { BuildPanelOptions } from './types';
import { STATUSES, PRIORITIES, SYSTEM_COMMANDS } from './constants';
import * as logger from "./logger";

/**
 * Generate a consistent hue (0-360) from a string using a simple hash.
 * This ensures the same tag always gets the same color.
 */
function hashStringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) % 360;
}

export function addSafeClickListener(element: HTMLElement, handler: (e: MouseEvent) => void) {
  element.addEventListener('click', (e) => {
    e.stopPropagation();
    handler(e as MouseEvent);
  });
  element.addEventListener('mousedown', (e) => e.stopPropagation());
}

export class MenuController {
  plugin: TPSGlobalContextMenuPlugin;

  constructor(plugin: TPSGlobalContextMenuPlugin) {
    this.plugin = plugin;
  }

  detach() {
    // No-op
  }

  hideMenu() {
    // No-op
  }

  /**
   * Expand provided files with any multi-selection from Explorer 2 (Smart Explorer) or core explorer DOM.
   * Falls back to the original list when no DOM selection is present.
   */
  addToNativeMenu(menu: Menu, files: TFile[]) {
    // Prevent duplicate additions to the same menu instance
    if ((menu as any)._tpsHandled) return;
    (menu as any)._tpsHandled = true;

    // Capture initial item count to allow reordering later
    const initialItemCount = (menu as any).items ? (menu as any).items.length : 0;

    // Delegate resolution to service
    const resolvedFiles = this.plugin.contextTargetService.resolveTargets(files);

    // Create entries for ALL resolved files
    const entries = this.createFileEntries(resolvedFiles);
    if (!entries.length) return;

    // Filter for markdown-specific features
    const markdownEntries = entries.filter(e => e.file.extension?.toLowerCase() === 'md');
    const markdownFiles = markdownEntries.map(e => e.file);

    // Add Note Operations (Markdown Only)
    // Wrap addItem to tag all items added by this plugin
    const originalAddItem = menu.addItem;

    menu.addItem = (callback: (item: any) => any) => {
      return originalAddItem.call(menu, (item: any) => {
        callback(item);
        (item as any)._isTpsItem = true;
      });
    };

    // Dynamic Properties (Markdown Only)
    if (markdownEntries.length > 0) {
      const properties = this.plugin.settings.properties || [];

      properties.forEach(prop => {
        // Skip if explicitly set to not show in context menu
        if (prop.showInContextMenu === false) return;

        if (prop.key === 'snooze' || prop.type === 'snooze') {
          menu.addItem((item) => {
            // Use markdownEntries[0] for context
            const val = markdownEntries[0].frontmatter[prop.key];
            item.setTitle(val ? `Snooze: ${val}` : 'Snooze...')
              .setIcon(prop.icon || 'clock')
              .setSection('tps-props')
              .onClick(() => {
                this.openSnoozeModal(markdownEntries, prop.key);
              });
          });
          return;
        }

        if (prop.type === 'selector') {
          this.addSelectorToMenu(menu, markdownEntries, prop, 'tps-props');
        } else if (prop.type === 'list') {
          this.addListToMenu(menu, markdownEntries, prop, 'tps-props');
        } else if (prop.type === 'datetime') {
          this.addDatetimeToMenu(menu, markdownEntries, prop, 'tps-props');
        } else if (prop.type === 'recurrence') {
          this.addRecurrenceToMenu(menu, markdownEntries, prop, 'tps-props');
        } else if (prop.type === 'folder') {
          this.addFolderToMenu(menu, markdownEntries, prop, 'tps-props');
        }
        // Text/Number: show a proper modal for input
        else if (prop.type === 'text' || prop.type === 'number') {
          menu.addItem((item) => {
            const val = markdownEntries[0].frontmatter[prop.key];
            item.setTitle(`${prop.label}: ${val || 'Empty'}`)
              .setIcon(prop.icon || 'pencil')
              .setSection('tps-props')
              .onClick(() => {
                new TextInputModal(
                  this.app,
                  prop.label,
                  val ?? '',
                  async (newVal) => {
                    if (newVal !== null && newVal !== undefined) {
                      const finalVal = prop.type === 'number' ? Number(newVal) : newVal;
                      await this.plugin.bulkEditService.updateFrontmatter(markdownEntries.map(e => e.file), { [prop.key]: finalVal });
                    }
                  }
                ).open();
              });
          });
        }
      });

      // System Commands (All Files)
      // We add these if enabled in settings.
      const enabledCommands = this.plugin.settings.systemCommands || [];
      const file = entries[0].file; // Primary file target

      if (enabledCommands.includes('open-in-new-tab')) {
        menu.addItem((item) => {
          item.setTitle('Open in new tab')
            .setIcon('file-plus')
            .setSection('tps-file-ops')
            .onClick(() => {
              this.app.workspace.getLeaf('tab').openFile(file);
            });
        });
      }

      if (enabledCommands.includes('open-to-right')) {
        menu.addItem((item) => {
          item.setTitle('Open to the right')
            .setIcon('separator-vertical')
            .setSection('tps-file-ops')
            .onClick(() => {
              this.app.workspace.getLeaf('split').openFile(file);
            });
        });
      }

      if (enabledCommands.includes('open-in-new-window')) {
        menu.addItem((item) => {
          item.setTitle('Open in new window')
            .setIcon('maximize')
            .setSection('tps-file-ops')
            .onClick(() => {
              this.app.workspace.getLeaf('window').openFile(file);
            });
        });
      }

      if (enabledCommands.includes('open-in-same-tab')) {
        menu.addItem((item) => {
          item.setTitle('Open in same tab')
            .setIcon('file')
            .setSection('tps-file-ops')
            .onClick(() => {
              this.app.workspace.getLeaf(false).openFile(file);
            });
        });
      }

      // --- File Operations ---

      if (enabledCommands.includes('rename')) {
        menu.addItem((item) => {
          item.setTitle('Rename...')
            .setIcon('pencil')
            .setSection('tps-file-ops')
            .onClick(() => {
              // @ts-ignore
              if (typeof this.app.fileManager.promptForFileRename === 'function') {
                // @ts-ignore
                this.app.fileManager.promptForFileRename(file);
              } else {
                new Notice("Rename not supported in this version via context menu");
              }
            });
        });
      }

      if (enabledCommands.includes('bookmark')) {
        menu.addItem((item) => {
          // @ts-ignore
          const bookmarksPlugin = this.app.internalPlugins.getPluginById('bookmarks');
          const isBookmarked = bookmarksPlugin?.instance?.items?.some((i: any) => i.path === file.path);

          item.setTitle(isBookmarked ? 'Remove bookmark' : 'Bookmark')
            .setIcon('bookmark')
            .setSection('tps-file-ops')
            .onClick(() => {
              if (bookmarksPlugin && bookmarksPlugin.instance) {
                if (isBookmarked) {
                  bookmarksPlugin.instance.removeItemByPath(file.path);
                } else {
                  bookmarksPlugin.instance.addItem({ type: 'file', path: file.path });
                }
              }
            });
        });
      }

      if (enabledCommands.includes('move-file')) {
        menu.addItem((item) => {
          item.setTitle('Move file to...')
            .setIcon('folder-input')
            .setSection('tps-file-ops')
            .onClick(() => {
              // @ts-ignore
              if (typeof this.app.fileManager.promptForFileMove === 'function') {
                // @ts-ignore
                this.app.fileManager.promptForFileMove(file);
              } else {
                (this.app as any).commands.executeCommandById('app:move-file');
              }
            });
        });
      }

      if (enabledCommands.includes('duplicate')) {
        menu.addItem((item) => {
          item.setTitle('Duplicate')
            .setIcon('copy')
            .setSection('tps-file-ops')
            .onClick(async () => {
              // ... duplication logic ...
              const baseName = file.basename;
              const ext = file.extension;
              const folder = file.parent?.path || '';
              const isFolder = !ext; // Basic check
              const name = isFolder ? file.name : baseName;

              let newPath = folder ? `${folder}/${name} copy` : `${name} copy`;
              if (ext) newPath += `.${ext}`;

              let counter = 2;
              while (this.app.vault.getAbstractFileByPath(newPath)) {
                newPath = folder ? `${folder}/${name} copy ${counter}` : `${name} copy ${counter}`;
                if (ext) newPath += `.${ext}`;
                counter++;
              }

              if (file instanceof TFile) {
                const content = await this.app.vault.read(file);
                await this.app.vault.create(newPath, content);
              } else {
                // Folder duplication logic if needed or skip
                new Notice("Folder duplication not supported yet");
                return;
              }
              new Notice(`Created ${newPath}`);
            });
        });
      }

      if (enabledCommands.includes('copy-url')) {
        menu.addItem((item) => {
          item.setTitle('Copy Obsidian URL')
            .setIcon('link')
            .setSection('tps-file-ops')
            .onClick(() => {
              // @ts-ignore
              const url = this.app.getObsidianUrl(file);
              navigator.clipboard.writeText(url);
              new Notice('Obsidian URL copied');
            });
        });
      }

      if (enabledCommands.includes('get-relative-path')) {
        menu.addItem((item) => {
          item.setTitle('Copy relative path')
            .setIcon('link')
            .setSection('tps-file-ops')
            .onClick(() => {
              navigator.clipboard.writeText(file.path);
              new Notice('Path copied to clipboard');
            });
        });
      }

      // --- Reveal Operations ---

      if (enabledCommands.includes('reveal-finder')) {
        menu.addItem((item) => {
          item.setTitle('Reveal in system explorer')
            .setIcon('monitor') // closest match
            .setSection('tps-reveal-ops')
            .onClick(() => {
              // @ts-ignore
              this.app.showInFolder(file.path);
            });
        });
      }

      if (enabledCommands.includes('reveal-nav')) {
        menu.addItem((item) => {
          item.setTitle('Reveal in navigation')
            .setIcon('folder-open')
            .setSection('tps-reveal-ops')
            .onClick(() => {
              const leaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
              if (leaf && leaf.view) {
                // @ts-ignore
                leaf.view.revealInFolder(file);
              }
            });
        });
      }

      // Add Note Operations (Markdown Only)
      if (markdownFiles.length > 0) {
        menu.addItem((item) =>
          item
            .setTitle("Add to note...")
            .setIcon("file-plus")
            .setSection('tps-note-ops')
            .onClick(() => {
              this.plugin.noteOperationService.addNotesToAnotherNote(markdownFiles);
            })
        );

        menu.addItem((item) =>
          item
            .setTitle("Put back into daily note")
            .setIcon("calendar-plus")
            .setSection('tps-note-ops')
            .onClick(() => {
              this.plugin.noteOperationService.addNotesToDailyNotes(markdownFiles);
            })
        );

      }

      // Delete
      menu.addItem((item) => {
        const fileCount = entries.length;
        const deleteLabel = fileCount > 1 ? `Delete (${fileCount} items)` : 'Delete';
        item.setTitle(deleteLabel)
          .setIcon('trash')
          .setSection('tps-delete')
          .setWarning(true)
          .onClick(async () => {
            // For single file, use native prompt; for multiple files, use custom confirm and delete all
            if (fileCount === 1 && this.app.fileManager.promptForDeletion) {
              this.app.fileManager.promptForDeletion(entries[0].file);
            } else {
              const confirmMsg = fileCount === 1
                ? `Are you sure you want to delete "${entries[0].file.name}"?`
                : `Are you sure you want to delete ${fileCount} items?`;
              if (confirm(confirmMsg)) {
                for (const entry of entries) {
                  await this.app.vault.trash(entry.file, true);
                }
              }
            }
          });
      });

      // Restore original methods
      menu.addItem = originalAddItem;
    }
  }

  addSelectorToMenu(menu: Menu, entries: any[], prop: any, sectionId: string) {
    menu.addItem((item) => {
      const allValues = entries.map((e: any) => e.frontmatter[prop.key] || '');
      const uniqueValues = new Set(allValues);
      const current = uniqueValues.size === 1 ? allValues[0] : 'Mixed';

      item.setTitle(`${prop.label}: ${current}`)
        .setIcon(prop.icon || 'hash')
        .setSection(sectionId);

      // Native submenu works well on Mobile too (sliding menu)
      const subMenu = (item as any).setSubmenu();
      (prop.options || []).forEach((opt: string) => {
        subMenu.addItem((sub: any) => {
          sub.setTitle(opt)
            .setChecked(current === opt)
            .onClick(async () => {
              await this.plugin.bulkEditService.updateFrontmatter(entries.map((e: any) => e.file), { [prop.key]: opt });
            });
        });
      });
    });
  }

  addListToMenu(menu: Menu, entries: any[], prop: any, sectionId: string) {
    menu.addItem((item) => {
      const tags = entries[0].frontmatter[prop.key] || [];
      const count = Array.isArray(tags) ? tags.length : 0;
      item.setTitle(`${prop.label} (${count})`)
        .setIcon(prop.icon || 'list')
        .setSection(sectionId);

      // Native submenu
      const subMenu = (item as any).setSubmenu();
      this.populateListSubmenu(subMenu, entries, prop, tags);
    });
  }

  populateListSubmenu(menu: Menu, entries: any[], prop: any, tags: string[]) {
    menu.addItem((sub) => {
      sub.setTitle(`Add ${prop.label}...`)
        .setIcon('plus')
        .onClick(() => {
          this.openAddTagModal(entries, prop.key);
        });
    });
    if (Array.isArray(tags)) {
      tags.forEach(tag => {
        menu.addItem((sub: any) => {
          sub.setTitle(tag)
            .setIcon('cross')
            .onClick(async () => {
              await this.plugin.bulkEditService.removeTag(entries.map((e: any) => e.file), tag, prop.key);
            });
        });
      });
    }
  }

  addDatetimeToMenu(menu: Menu, entries: any[], prop: any, sectionId: string) {
    const val = entries[0].frontmatter[prop.key];
    menu.addItem((item) => {
      item.setTitle(val ? `${prop.label}: ${val}` : `Set ${prop.label}...`)
        .setIcon(prop.icon || 'calendar')
        .setSection(sectionId)
        .onClick(() => {
          this.openScheduledModal(entries, prop.key);
        });
    });
  }

  addRecurrenceToMenu(menu: Menu, entries: any[], prop: any, sectionId: string) {
    const recurrenceRule = this.getRecurrenceValue(entries[0].frontmatter);
    menu.addItem((item) => {
      item.setTitle(recurrenceRule ? `Edit ${prop.label}...` : `Add ${prop.label}...`)
        .setIcon(prop.icon || 'repeat')
        .setSection(sectionId)
        .onClick(() => {
          this.openRecurrenceModalNative(entries);
        });
    });
  }

  addFolderToMenu(menu: Menu, entries: any[], prop: any, sectionId: string) {
    menu.addItem((item) => {
      const folder = entries[0].file.parent?.path || '/';
      item.setTitle(`${prop.label}: ${folder}`)
        .setIcon(prop.icon || 'folder')
        .setSection(sectionId);

      // Native submenu
      const subMenu = (item as any).setSubmenu();
      this.populateFolderMenu(subMenu, entries);
    });
  }

  createFileEntries(files: TFile[]) {
    return files.map(f => ({
      file: f,
      frontmatter: this.app.metadataCache.getFileCache(f)?.frontmatter || {}
    }));
  }

  getRecurrenceValue(fm: any): string {
    return fm.recurrenceRule || fm.recurrence || '';
  }

  populateFolderMenu(menu: Menu, entries: any[]) {
    const folders = this.app.vault.getAllLoadedFiles()
      .filter(f => f instanceof TFolder) as TFolder[];

    // Sort folders by path
    folders.sort((a, b) => a.path.localeCompare(b.path));

    // Add Root
    menu.addItem(item => {
      item.setTitle('/')
        .setChecked(entries[0].file.parent?.path === '/')
        .onClick(async () => {
          await this.moveFiles(entries, '/');
        });
    });

    folders.forEach((folder) => {
      if (folder.path === '/') return; // Already added
      menu.addItem(item => {
        item.setTitle(folder.path)
          .setChecked(entries[0].file.parent?.path === folder.path)
          .onClick(async () => {
            await this.moveFiles(entries, folder.path);
          });
      });
    });
  }

  async moveFiles(entries: any[], folderPath: string) {
    for (const entry of entries) {
      const newPath = `${folderPath === '/' ? '' : folderPath}/${entry.file.name}`;
      if (newPath !== entry.file.path) {
        try {
          await this.app.fileManager.renameFile(entry.file, newPath);
        } catch (e) {
          logger.error(`Failed to move file to ${newPath}`, e);
          new Notice(`Failed to move file: ${e.message}`);
        }
      }
    }
  }

  openStatusSubmenu(anchor: HTMLElement | MouseEvent | KeyboardEvent, entries: any[], onUpdate?: (val: string) => void) {
    const menu = new Menu();
    STATUSES.forEach(status => {
      menu.addItem(item => {
        item.setTitle(status)
          .setChecked(entries[0].frontmatter.status === status)
          .onClick(async () => {
            await this.plugin.bulkEditService.setStatus(entries.map(e => e.file), status);
            if (onUpdate) onUpdate(status);
          });
      });
    });
    this.showMenuAtAnchor(menu, anchor);
  }

  openPrioritySubmenu(anchor: HTMLElement | MouseEvent | KeyboardEvent, entries: any[], onUpdate?: (val: string) => void) {
    const menu = new Menu();
    PRIORITIES.forEach(prio => {
      menu.addItem(item => {
        item.setTitle(prio)
          .setChecked(entries[0].frontmatter.priority === prio)
          .onClick(async () => {
            await this.plugin.bulkEditService.setPriority(entries.map(e => e.file), prio);
            if (onUpdate) onUpdate(prio);
          });
      });
    });
    this.showMenuAtAnchor(menu, anchor);
  }

  openTypeSubmenu(anchor: HTMLElement | MouseEvent | KeyboardEvent, entries: any[], onUpdate?: (val: string) => void) {
    const menu = new Menu();
    this.populateFolderMenu(menu, entries);
    this.showMenuAtAnchor(menu, anchor);
  }

  showMenuAtAnchor(menu: Menu, anchor: HTMLElement | MouseEvent | KeyboardEvent) {
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

    if (element && element.getBoundingClientRect) {
      const rect = element.getBoundingClientRect();
      // On desktop, if we click a button, we want the menu to appear below it
      // On mobile, or if it's a context menu item, we might want different behavior
      // But for the custom panel buttons, bottom-left align is standard
      if (rect.width > 0 && rect.height > 0) {
        if (Platform.isMobile) {
          // On mobile, prevent off-screen positioning
          const { innerHeight, innerWidth } = window;
          const x = Math.min(rect.left, innerWidth - 250); // Ensure width for menu
          const y = Math.min(rect.bottom, innerHeight - 300); // Ensure height
          menu.showAtPosition({ x: Math.max(0, x), y: Math.max(0, y) });
        } else {
          menu.showAtPosition({ x: rect.left, y: rect.bottom });
        }
        return;
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

  openAddTagModal(entries: any[], key = 'tags') {
    logger.log(`[TPS GCM] openAddTagModal called with ${entries.length} entries`);
    new AddTagModal(this.app, this.getAllKnownTags(), async (tag) => {
      // Ensure we are targeting all files in the entries list
      const files = entries.map(e => e.file);
      logger.log(`[TPS GCM] Adding tag '${tag}' to ${files.length} files`);
      const count = await this.plugin.bulkEditService.addTag(files, tag, key);
      if (count > 0) {
        this.plugin.bulkEditService.showNotice('added', `Tag #${tag}`, '', count);
      }
    }).open();
  }

  openRecurrenceModalNative(entries: any[]) {
    const fm = entries[0].frontmatter;
    const dateStr = fm.scheduled || fm.start || fm.date || fm.day;
    let startDate = new Date();

    if (dateStr) {
      const parsed = window.moment(dateStr, ["YYYY-MM-DD HH:mm", "YYYY-MM-DD"]).toDate();
      if (!isNaN(parsed.getTime())) {
        startDate = parsed;
      }
    }

    new RecurrenceModal(this.app, this.getRecurrenceValue(fm), startDate, async (rule) => {
      await this.plugin.bulkEditService.setRecurrence(entries.map(e => e.file), rule);
    }).open();
  }

  openScheduledModal(entries: any[], key = 'scheduled') {
    const fm = entries[0].frontmatter;
    new ScheduledModal(
      this.app,
      fm[key] || '',
      fm.timeEstimate || 0,
      fm.allDay || false,
      async (result) => {
        await this.plugin.bulkEditService.updateScheduledDetails(
          entries.map(e => e.file),
          result.date,
          result.timeEstimate,
          result.allDay,
          key
        );
      }
    ).open();
  }

  openSnoozeModal(entries: any[], key = 'snooze') {
    const options = this.plugin.settings.snoozeOptions || [];
    new SnoozeModal(
      this.app,
      entries.map(e => e.file),
      options,
      async (minutes) => {
        const snoozeDate = window.moment().add(minutes, 'minutes').format('YYYY-MM-DD HH:mm');
        await this.plugin.bulkEditService.updateFrontmatter(entries.map(e => e.file), { [key]: snoozeDate });
        new Notice(`Snoozed for ${minutes} minutes`);
      }
    ).open();
  }


  getAllKnownTags(): string[] {
    // @ts-ignore
    const cache = this.app.metadataCache;
    // @ts-ignore
    const tags = typeof cache.getTags === 'function' ? cache.getTags() : {};
    return Object.keys(tags || {}).map(t => t.replace('#', ''));
  }

  triggerTagSearch(tag: string): void {
    // Normalize tag format (remove # if present, then add it back)
    const cleanTag = tag.replace(/^#/, '');
    const searchQuery = `tag:#${cleanTag}`;

    try {
      // Primary method: Use global-search plugin
      const globalSearch = (this.app as any).internalPlugins.getPluginById('global-search');
      if (globalSearch && globalSearch.instance) {
        globalSearch.instance.openGlobalSearch(searchQuery);
        return;
      }

      // Fallback method: Use workspace setViewState (avoid creating a new leaf)
      const leaf = this.app.workspace.getLeaf(false);
      if (!leaf) return;
      leaf.setViewState({
        type: 'search',
        state: { query: searchQuery }
      });
    } catch (error) {
      logger.error('[TPS GCM] Failed to trigger tag search:', error);
      new Notice('Failed to search for tag');
    }
  }

  get app() {
    return this.plugin.app;
  }

  // --- Custom Panel Logic ---

  buildSpecialPanel(files: TFile[], options: BuildPanelOptions = {}): HTMLElement {
    const entries = this.createFileEntries(files);
    const panel = document.createElement('div');
    panel.className = 'tps-gcm-panel';

    addSafeClickListener(panel, (e) => {
      // e.stopPropagation(); 
    });

    if (files.length === 1) {
      panel.appendChild(this.createTitleRow(entries));
    }

    const properties = this.plugin.settings.properties || [];
    properties.forEach(prop => {
      if (prop.type === 'selector') {
        panel.appendChild(this.createSelectorRow(entries, prop));
      } else if (prop.type === 'list') {
        panel.appendChild(this.createListRow(entries, prop));
      } else if (prop.type === 'datetime') {
        panel.appendChild(this.createDatetimeRow(entries, prop));
      } else if (prop.type === 'recurrence') {
        panel.appendChild(this.createRecurrenceRow(entries, prop));
      } else if (prop.type === 'folder') {
        panel.appendChild(this.createTypeRow(entries, prop));
      } else if (prop.type === 'text') {
        panel.appendChild(this.createTextRow(entries, prop));
      } else if (prop.type === 'number') {
        panel.appendChild(this.createNumberRow(entries, prop));
      }
    });

    // Add file operations from settings
    const fileOpsRow = this.createFileOperationsRow(entries);
    if (fileOpsRow) {
      panel.appendChild(fileOpsRow);
    }

    panel.appendChild(this.createActionsRow(entries));

    return panel;
  }

  createFileOperationsRow(entries: any[]): HTMLElement | null {
    const enabledCommands = this.plugin.settings.systemCommands || [];
    if (enabledCommands.length === 0) return null;

    const row = document.createElement('div');
    row.className = 'tps-gcm-row tps-gcm-file-ops-row';

    const container = document.createElement('div');
    container.className = 'tps-gcm-file-ops';

    const file = entries[0].file;

    enabledCommands.forEach((cmdId: string) => {
      const cmd = SYSTEM_COMMANDS.find(c => c.id === cmdId);
      if (!cmd) return;

      const btn = document.createElement('button');
      btn.className = 'tps-gcm-file-op-btn';
      btn.title = cmd.label;

      // Add icon
      const iconSpan = document.createElement('span');
      iconSpan.className = 'tps-gcm-file-op-icon';
      setIcon(iconSpan, cmd.icon);
      btn.appendChild(iconSpan);

      // Add label
      const labelSpan = document.createElement('span');
      labelSpan.className = 'tps-gcm-file-op-label';
      labelSpan.textContent = cmd.label;
      btn.appendChild(labelSpan);

      addSafeClickListener(btn, async (e) => {
        e.stopPropagation();
        switch (cmd.id) {
          case 'open-in-new-tab':
            const newLeaf = this.app.workspace.getLeaf('tab');
            await newLeaf.openFile(file);
            break;
          case 'open-in-same-tab':
            const leaf = this.app.workspace.getLeaf(false);
            await leaf.openFile(file);
            break;
          case 'duplicate':
            const newPath = file.path.replace(/\.md$/, ' copy.md');
            const content = await this.app.vault.read(file);
            await this.app.vault.create(newPath, content);
            new Notice(`Duplicated to ${newPath}`);
            break;
          case 'get-relative-path':
            await navigator.clipboard.writeText(file.path);
            new Notice('Path copied to clipboard');
            break;
        }
      });

      container.appendChild(btn);
    });

    row.appendChild(container);
    return row;
  }

  createTitleRow(entries: any[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tps-gcm-row tps-gcm-title-row';
    const input = document.createElement('input');
    input.type = 'text';
    // Use title from frontmatter if available, otherwise fallback to basename
    const fmTitle = entries[0].frontmatter.title;
    input.value = (typeof fmTitle === 'string' && fmTitle.trim()) ? fmTitle : entries[0].file.basename;
    input.className = 'tps-gcm-title-input';

    // GUARANTEE SAFETY: Only allow quick-renaming via this input for Markdown files.
    // For other files (Canvas, PDF, Images), user should use the "Rename" command in the menu.
    // This prevents any accidental conversion or frontmatter injection (corruption).
    const isMarkdown = entries[0].file.extension?.toLowerCase() === 'md';
    if (!isMarkdown) {
      input.disabled = true;
      input.title = "Renaming via this box is disabled for non-markdown files. Use the 'Rename' option in the menu logic below.";
      input.style.opacity = '0.7';
      // Ensure value still shows name
      input.value = entries[0].file.basename;
    }

    const handleRename = async () => {
      const newName = input.value.trim();

      // Double check safety in handler
      const isMd = entries[0].file.extension?.toLowerCase() === 'md';
      if (!isMd || !newName) return;

      // 1. Update Frontmatter Title (Only for Markdown files)
      const isMarkdown = entries[0].file.extension?.toLowerCase() === 'md';
      if (isMarkdown && entries[0].frontmatter.title !== newName) {
        await this.plugin.bulkEditService.updateFrontmatter(entries.map(e => e.file), { title: newName });
      }

      // 2. Rename File (if different from current basename)
      // Note: We only rename if the specific file being edited is the main one (entries[0])
      // For bulk edits, we generally don't rename all files to the same name (that would conflict).
      // Since createTitleRow currently assumes single-file context (entries[0]), we check if we should rename it.
      if (newName !== entries[0].file.basename) {
        // Basic sanitization for filename
        // Obsidian's renameFile handles some collisions, but we should be careful.
        // For now, we trust the user input but catch errors.
        try {
          // Check if exact path already exists (collision)
          // Use string replacement on the full path to guarantee parent path and extension preservation
          const oldPath = entries[0].file.path;
          const oldName = entries[0].file.name; // e.g. "MyCanvas.canvas"
          const parentDir = oldPath.substring(0, oldPath.length - oldName.length);
          const ext = entries[0].file.extension;

          const newPath = parentDir + newName + '.' + ext;

          logger.log(`[TPS GCM] Renaming: ${oldPath} -> ${newPath} (Ext: ${ext})`);
          if (this.app.vault.getAbstractFileByPath(newPath)) {
            // Collision: Just keep the title update, don't rename, or show notice?
            // We'll skip rename to be safe, but notify.
            new Notice(`Cannot rename to "${newName}": File already exists.`);
          } else {
            await this.app.fileManager.renameFile(entries[0].file, newPath);
          }
        } catch (e) {
          logger.error("Failed to rename file:", e);
        }
      }
    };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        input.blur(); // This will trigger the blur handler
      }
    });

    input.addEventListener('blur', (e) => {
      e.stopPropagation();
      handleRename();
    });

    addSafeClickListener(input, e => e.stopPropagation());
    input.addEventListener('mousedown', e => e.stopPropagation());

    row.appendChild(input);
    return row;
  }

  createSelectorRow(entries: any[], prop: any): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tps-gcm-row';
    const label = document.createElement('label');
    label.textContent = prop.label;

    const valueEl = document.createElement('div');
    valueEl.className = 'tps-gcm-value tps-gcm-input-button';

    const allValues = entries.map((e: any) => e.frontmatter[prop.key] || '');
    const uniqueValues = new Set(allValues);
    const current = uniqueValues.size === 1 ? allValues[0] : 'Mixed';
    valueEl.textContent = current || 'Select...';

    addSafeClickListener(valueEl, (e) => {
      const menu = new Menu();
      (prop.options || []).forEach((opt: string) => {
        menu.addItem(item => {
          item.setTitle(opt)
            .setChecked(current === opt)
            .onClick(async () => {
              await this.plugin.bulkEditService.updateFrontmatter(entries.map((e: any) => e.file), { [prop.key]: opt });
              valueEl.textContent = opt;
            });
        });
      });
      this.showMenuAtAnchor(menu, e);
    });
    valueEl.addEventListener('mousedown', e => e.stopPropagation());

    row.appendChild(label);
    row.appendChild(valueEl);
    return row;
  }

  createListRow(entries: any[], prop: any): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tps-gcm-row tps-gcm-tags-row';
    const label = document.createElement('label');
    label.textContent = prop.label;

    const container = document.createElement('div');
    container.className = 'tps-gcm-tags-container tps-gcm-tags-inline';

    const refreshTags = () => {
      container.innerHTML = '';
      // Re-read fresh frontmatter from metadataCache to avoid stale data
      const freshFm = this.app.metadataCache.getFileCache(entries[0].file)?.frontmatter || {};
      const rawTags = freshFm[prop.key];
      // Robust filtering: only include valid string values
      const tagList = Array.isArray(rawTags)
        ? rawTags.filter((t: any) => typeof t === 'string' && t.trim())
        : (typeof rawTags === 'string' && rawTags.trim() ? [rawTags] : []);

      tagList.forEach((tag: string) => {
        const tagEl = document.createElement('span');
        tagEl.className = 'tps-gcm-tag tps-gcm-tag-removable';

        const tagText = document.createElement('span');
        tagText.className = 'tps-gcm-tag-text';
        tagText.textContent = tag;
        tagEl.appendChild(tagText);

        // X button for removal
        const removeBtn = document.createElement('button');
        removeBtn.className = 'tps-gcm-tag-remove';
        removeBtn.innerHTML = '×';
        removeBtn.title = `Remove ${tag}`;
        addSafeClickListener(removeBtn, async (e) => {
          e.stopPropagation();
          await this.plugin.bulkEditService.removeTag(entries.map((e: any) => e.file), tag, prop.key);
        });
        tagEl.appendChild(removeBtn);

        // Consistent color based on tag hash
        const hue = hashStringToHue(tag);
        tagEl.style.backgroundColor = `hsla(${hue}, 40%, 20%, 0.4)`;
        tagEl.style.color = `hsl(${hue}, 60%, 85%)`;
        tagEl.style.border = `1px solid hsla(${hue}, 40%, 30%, 0.5)`;

        container.appendChild(tagEl);
      });

      // Add button (compact)
      const addBtn = document.createElement('button');
      addBtn.innerHTML = '+';
      addBtn.className = 'tps-gcm-tag-add';
      addBtn.title = 'Add tag';
      addSafeClickListener(addBtn, (e) => {
        this.openAddTagModal(entries, prop.key);
      });
      addBtn.addEventListener('mousedown', e => e.stopPropagation());
      container.appendChild(addBtn);
    };

    refreshTags();

    row.appendChild(label);
    row.appendChild(container);
    return row;
  }

  createDatetimeRow(entries: any[], prop: any): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tps-gcm-row';
    const label = document.createElement('label');
    label.textContent = prop.label;

    const valueEl = document.createElement('div');
    valueEl.className = 'tps-gcm-value tps-gcm-input-button';
    const rawValue = entries[0].frontmatter[prop.key];
    const formatted = this.formatDatetimeDisplay(rawValue);
    if (formatted) {
      valueEl.textContent = formatted;
    } else {
      valueEl.textContent = 'Set date...';
      valueEl.style.color = 'var(--text-muted)';
    }

    addSafeClickListener(valueEl, (e) => {
      this.openScheduledModal(entries, prop.key);
    });
    valueEl.addEventListener('mousedown', e => e.stopPropagation());

    row.appendChild(label);
    row.appendChild(valueEl);
    return row;
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

  createTextRow(entries: any[], prop: any): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tps-gcm-row';
    const label = document.createElement('label');
    label.textContent = prop.label;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = entries[0].frontmatter[prop.key] || '';
    input.placeholder = 'Empty';

    input.addEventListener('change', async () => {
      await this.plugin.bulkEditService.updateFrontmatter(entries.map((e: any) => e.file), { [prop.key]: input.value });
    });
    addSafeClickListener(input, e => e.stopPropagation());
    input.addEventListener('mousedown', e => e.stopPropagation());

    row.appendChild(label);
    row.appendChild(input);
    return row;
  }

  createNumberRow(entries: any[], prop: any): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tps-gcm-row';
    const label = document.createElement('label');
    label.textContent = prop.label;

    const input = document.createElement('input');
    input.type = 'number';
    input.value = entries[0].frontmatter[prop.key] || '';

    input.addEventListener('change', async () => {
      const val = input.value ? Number(input.value) : null;
      await this.plugin.bulkEditService.updateFrontmatter(entries.map((e: any) => e.file), { [prop.key]: val });
    });
    addSafeClickListener(input, e => e.stopPropagation());
    input.addEventListener('mousedown', e => e.stopPropagation());

    row.appendChild(label);
    row.appendChild(input);
    return row;
  }

  createRecurrenceRow(entries: any[], prop?: any): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tps-gcm-row';
    const label = document.createElement('label');
    label.textContent = prop ? prop.label : 'Recurrence';

    const valueEl = document.createElement('div');
    valueEl.className = 'tps-gcm-value tps-gcm-input-button';
    const rule = this.getRecurrenceValue(entries[0].frontmatter);
    valueEl.textContent = rule || 'Set recurrence...';
    if (!rule) valueEl.style.color = 'var(--text-muted)';

    addSafeClickListener(valueEl, (e) => {
      this.openRecurrenceModalNative(entries);
    });
    valueEl.addEventListener('mousedown', e => e.stopPropagation());

    row.appendChild(label);
    row.appendChild(valueEl);
    return row;
  }

  createTypeRow(entries: any[], prop?: any): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tps-gcm-row';
    const label = document.createElement('label');
    label.textContent = prop ? prop.label : 'Type';

    const div = document.createElement('div');
    div.textContent = entries[0].file.parent?.path || '/';
    div.className = 'tps-gcm-value tps-gcm-input-button';

    addSafeClickListener(div, (e) => {
      this.openTypeSubmenu(e, entries, (newPath) => {
        // Optional: update text, though moving file might refresh everything
      });
    });
    div.addEventListener('mousedown', e => e.stopPropagation());

    row.appendChild(label);
    row.appendChild(div);
    return row;
  }

  createActionsRow(entries: any[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tps-gcm-actions-row';

    const collapseBtn = document.createElement('button');
    collapseBtn.textContent = 'Collapse';
    addSafeClickListener(collapseBtn, (e) => {
      // Find the parent menu and trigger collapse
      const menuEl = (e.target as HTMLElement).closest('.tps-global-context-menu');
      if (menuEl) {
        menuEl.classList.add('tps-global-context-menu--collapsed');
        const collapseButton = menuEl.querySelector<HTMLButtonElement>('.tps-gcm-collapse-button');
        if (collapseButton) {
          collapseButton.setAttribute('aria-expanded', 'false');
          collapseButton.setAttribute('title', 'Expand inline controls');
        }
      }
    });

    const deleteBtn = document.createElement('button');
    const fileCount = entries.length;
    deleteBtn.textContent = fileCount > 1 ? `Delete (${fileCount})` : 'Delete';
    deleteBtn.className = 'mod-warning tps-gcm-actions-delete';
    addSafeClickListener(deleteBtn, async () => {
      // For single file, use native prompt; for multiple files, use custom confirm and delete all
      if (fileCount === 1 && this.app.fileManager.promptForDeletion) {
        this.app.fileManager.promptForDeletion(entries[0].file);
      } else {
        const confirmMsg = fileCount === 1
          ? `Are you sure you want to delete "${entries[0].file.basename}"?`
          : `Are you sure you want to delete ${fileCount} files?`;
        if (confirm(confirmMsg)) {
          for (const entry of entries) {
            await this.app.vault.trash(entry.file, true);
          }
        }
      }
    });

    row.appendChild(collapseBtn);
    row.appendChild(deleteBtn);
    return row;
  }

  // Legacy wrappers for compatibility if needed
  createStatusRow(entries: any[]) { return this.createSelectorRow(entries, { label: 'Status', key: 'status', options: STATUSES }); }
  createPriorityRow(entries: any[]) { return this.createSelectorRow(entries, { label: 'Priority', key: 'priority', options: PRIORITIES }); }
  createTagsRow(entries: any[]) { return this.createListRow(entries, { label: 'Tags', key: 'tags' }); }
  createScheduledRow(entries: any[]) { return this.createDatetimeRow(entries, { label: 'Scheduled', key: 'scheduled' }); }

  createSummaryHeader(file: TFile, leaf?: WorkspaceLeaf): HTMLElement {
    const entries = this.createFileEntries([file]);
    const fm = entries[0].frontmatter;

    const header = document.createElement('div');
    header.className = 'tps-global-context-header';

    // Left container with collapse button
    const left = document.createElement('div');
    left.className = 'tps-gcm-header-left';

    const collapseButton = document.createElement('button');
    collapseButton.type = 'button';
    collapseButton.className = 'tps-gcm-collapse-button';
    collapseButton.setAttribute('aria-expanded', 'false');
    collapseButton.setAttribute('aria-label', 'Expand inline menu controls');
    left.appendChild(collapseButton);



    const title = document.createElement('span');
    title.className = 'tps-gcm-file-title';

    // Logic: Title (Filename) if different, otherwise just Title/Filename
    let displayTitle = fm.title && fm.title !== file.basename
      ? `${fm.title} (${file.basename})`
      : (fm.title || file.basename || 'Untitled');

    // Hide date suffix if present (e.g. "Note Title 2025-12-12" -> "Note Title")
    // Use regex that looks for space + date at end, but ignores pure dates (daily notes)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(displayTitle)) {
      displayTitle = displayTitle.replace(/ \d{4}-\d{2}-\d{2}$/, '');
    }

    title.textContent = displayTitle;
    title.setAttribute('aria-label', file.path);
    left.appendChild(title);

    header.appendChild(left);

    // Container for badges (right side)
    const right = this.createHeaderBadges(file, leaf);
    header.appendChild(right);

    return header;
  }

  /**
   * Create just the header badges container.
   * This is separated so we can update badges in-place without recreating the whole menu.
   */
  createHeaderBadges(file: TFile, leaf?: WorkspaceLeaf): HTMLElement {
    const entries = this.createFileEntries([file]);
    const fm = entries[0].frontmatter;

    const right = document.createElement('div');
    right.className = 'tps-gcm-header-right';

    // Helper to create badge
    const createBadge = (text: string, type: string, icon: string | null, onClick: (e: MouseEvent) => void) => {
      const badge = document.createElement('span');
      badge.className = `tps-gcm-badge tps-gcm-badge-${type}`;
      badge.textContent = text;
      addSafeClickListener(badge, onClick);
      return badge;
    };

    // Collect badges in two arrays: non-tags first, then tags
    const nonTagBadges: HTMLElement[] = [];
    const tagBadges: HTMLElement[] = [];

    // Dynamically create badges based on configured properties
    const properties = this.plugin.settings.properties || [];
    properties.forEach(prop => {
      // Skip if property shouldn't be shown in collapsed view
      if (prop.showInCollapsed === false) return;
      if (prop.type === 'selector') {
        // Selector properties (like status, priority)
        const value = fm[prop.key] || (prop.options && prop.options.length > 0 ? prop.options[0] : '');
        if (value) {
          const badge = createBadge(value, `${prop.key} tps-gcm-badge-${value}`, null, (e) => {
            e.stopPropagation();
            const menu = new Menu();
            (prop.options || []).forEach((opt: string) => {
              menu.addItem((item: any) => {
                item.setTitle(opt)
                  .setChecked(fm[prop.key] === opt)
                  .onClick(async () => {
                    await this.plugin.bulkEditService.updateFrontmatter(entries.map((entry: any) => entry.file), { [prop.key]: opt });
                    (e.target as HTMLElement).textContent = opt;
                    (e.target as HTMLElement).className = `tps-gcm-badge tps-gcm-badge-${prop.key} tps-gcm-badge-${opt}`;
                  });
              });
            });
            this.showMenuAtAnchor(menu, e);
          });
          nonTagBadges.push(badge);
        }
      } else if (prop.type === 'list') {
        // List properties (like tags) - collect separately to add last
        const listValues = fm[prop.key];

        // Add "+" button first
        const addBadge = createBadge('+', 'add-tag', null, (e) => {
          e.stopPropagation();
          this.openAddTagModal(entries, prop.key);
        });
        tagBadges.push(addBadge);

        // Then add tag badges - robust filtering to exclude false, null, non-strings
        if (listValues && listValues !== false && listValues !== null) {
          const rawItems = Array.isArray(listValues) ? listValues : [listValues];
          const items = rawItems.filter((v: any) => typeof v === 'string' && v.trim());
          items.slice(0, 4).forEach((item: string) => {
            const cleanItem = item.replace('#', '');
            const badge = createBadge(cleanItem, 'tag', null, (e) => {
              e.stopPropagation();
              this.triggerTagSearch(cleanItem);
            });

            // Consistent color based on tag hash
            const hue = hashStringToHue(cleanItem);
            badge.style.backgroundColor = `hsla(${hue}, 40%, 20%, 0.4)`;
            badge.style.color = `hsl(${hue}, 60%, 85%)`;
            badge.style.border = `1px solid hsla(${hue}, 40%, 30%, 0.5)`;

            tagBadges.push(badge);
          });
          if (items.length > 4) {
            tagBadges.push(createBadge(`+${items.length - 4}`, 'tag-more', null, (e) => {
              e.stopPropagation();
              this.openAddTagModal(entries, prop.key);
            }));
          }
        }
      } else if (prop.type === 'recurrence') {
        // Recurrence properties
        const recurrence = this.getRecurrenceValue(fm);
        if (recurrence) {
          let label = 'Recur';
          if (recurrence.includes('FREQ=DAILY')) label = 'Daily';
          else if (recurrence.includes('FREQ=WEEKLY')) label = 'Weekly';
          else if (recurrence.includes('FREQ=MONTHLY')) label = 'Monthly';
          else if (recurrence.includes('FREQ=YEARLY')) label = 'Yearly';

          nonTagBadges.push(createBadge(label, 'recurrence', null, (e) => {
            e.stopPropagation();
            this.openRecurrenceModalNative(entries);
          }));
        }
      } else if (prop.type === 'datetime') {
        // DateTime properties (like scheduled)
        const dateValue = fm[prop.key];
        if (dateValue) {
          // Format date to be shorter? e.g. YYYY-MM-DD
          const dateStr = dateValue.split('T')[0];
          nonTagBadges.push(createBadge(dateStr, prop.key, null, (e) => {
            e.stopPropagation();
            this.openScheduledModal(entries, prop.key);
          }));
        }
      } else if (prop.type === 'folder') {
        // Folder properties (like type)
        const folderPath = file.parent?.path || '/';
        nonTagBadges.push(createBadge(folderPath, 'folder', null, (e) => {
          e.stopPropagation();
          this.openTypeSubmenu(e, entries);
        }));
      }
      // Note: text and number types are typically not shown in the collapsed summary header
    });

    // Append non-tag badges first
    nonTagBadges.forEach(badge => right.appendChild(badge));

    // Append tag badges last
    tagBadges.forEach(badge => right.appendChild(badge));

    return right;
  }
}
