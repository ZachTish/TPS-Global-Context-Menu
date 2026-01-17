import { Plugin, TFile, WorkspaceLeaf, Menu, Platform, debounce } from 'obsidian';
import { TPSGlobalContextMenuSettings, BuildPanelOptions } from './types';
import { DEFAULT_SETTINGS, PLUGIN_STYLES } from './constants';
import { MenuController } from './menu-controller';
import { PersistentMenuManager } from './persistent-menu-manager';
import { TPSGlobalContextMenuSettingTab } from './settings-tab';
import { BulkEditService } from './bulk-edit-service';
import { RecurrenceService } from './recurrence-service';
import { FileNamingService } from './file-naming-service';
import { ViewModeManager } from './view-mode-manager';
import { ContextTargetService } from './context-target-service';
import { NoteOperationService } from './note-operation-service';
import { installConsoleErrorFilter, installDateContainsPolyfill } from './compat';
import * as logger from "./logger";


export default class TPSGlobalContextMenuPlugin extends Plugin {
  settings: TPSGlobalContextMenuSettings;
  menuController: MenuController;
  persistentMenuManager: PersistentMenuManager;
  bulkEditService: BulkEditService;
  recurrenceService: RecurrenceService;
  fileNamingService: FileNamingService;
  viewModeManager: ViewModeManager;
  contextTargetService: ContextTargetService;
  noteOperationService: NoteOperationService;
  styleEl: HTMLStyleElement | null = null;
  ignoreNextContext = false;
  keyboardVisible = false;
  private restoreConsoleError: (() => void) | null = null;
  private restoreMenuPatch: (() => void) | null = null;

  // Create a debounced save function
  private debouncedSave = debounce(async () => {
    await this.saveData(this.settings);
  }, 1000, true);

  async onload(): Promise<void> {
    this.ignoreNextContext = false;

    await this.loadSettings();
    logger.setLoggingEnabled(this.settings.enableLogging);

    installDateContainsPolyfill();
    this.restoreConsoleError = installConsoleErrorFilter();

    this.contextTargetService = new ContextTargetService(this);
    this.bulkEditService = new BulkEditService(this);
    this.recurrenceService = new RecurrenceService(this);
    this.fileNamingService = new FileNamingService(this);
    this.noteOperationService = new NoteOperationService(this);

    this.menuController = new MenuController(this);
    this.persistentMenuManager = new PersistentMenuManager(this);
    this.viewModeManager = new ViewModeManager(this);
    this.addChild(this.viewModeManager);

    // Initialize recurrence listener
    this.recurrenceService.setup();

    this.patchMenuMethods();

    this.injectStyles();

    this.keyboardVisible = false;

    // Register events
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile) {
          this.menuController.addToNativeMenu(menu, [file]);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('files-menu', (menu, files) => {
        // Relaxed check to handle potential non-instance objects from other plugins
        const fileList = files.filter((f: any) => f && f.path && typeof f.path === 'string') as TFile[];
        if (fileList.length > 0) {
          this.menuController.addToNativeMenu(menu, fileList);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, info) => {
        if (info && info.file instanceof TFile) {
          this.menuController.addToNativeMenu(menu, [info.file]);
        }
      })
    );

    this.addSettingTab(new TPSGlobalContextMenuSettingTab(this.app, this));

    const ensureMenus = this.persistentMenuManager.ensureMenus.bind(
      this.persistentMenuManager
    );

    // Debounced version for high-frequency events (mobile typing, bulk vault ops)
    // Using false (not immediate) to prevent jitter during typing
    const throttledEnsureMenus = debounce(ensureMenus, 500, false);

    this.registerEvent(this.app.workspace.on('layout-change', throttledEnsureMenus));
    this.registerEvent(this.app.workspace.on('active-leaf-change', throttledEnsureMenus));
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      // Immediate menu creation attempt
      ensureMenus();

      // On mobile, metadata cache may not have updated yet on rapid file switching.
      // Schedule a delayed refresh to ensure frontmatter values are current.
      if (file && Platform.isMobile) {
        setTimeout(() => {
          this.persistentMenuManager.refreshMenusForFile(file);
        }, 500); // Increased delay
      }

      if (file && this.fileNamingService.shouldProcess(file)) {
        // Longer delay to ensure frontmatter is fully indexed after creation/modification
        setTimeout(() => {
          this.fileNamingService.processFileOnOpen(file);
        }, 500);
      }
    }));
    // Don't listen to vault modify - this fires too often during typing
    // The metadataCache.on('changed') handler already handles this with better debouncing

    // Refresh inline menus when frontmatter changes (fixes stale menus)
    // Heavily debounced to prevent lag during typing
    // IMPORTANT: Third param (immediate) is false - we fire at END of delay, not start
    const debouncedMenuRefresh = debounce((file: TFile) => {
      if (file && file.extension === 'md') {
        this.persistentMenuManager.refreshMenusForFile(file);
      }
    }, 2000, false); // 2 second debounce, fires at END to avoid refresh during typing

    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        debouncedMenuRefresh(file);
      })
    );

    // Refresh menus on rename to keep title in sync
    this.registerEvent(
      // Note: Obsidian provides (file, oldPath); keep args flexible across versions.
      this.app.vault.on('rename', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.persistentMenuManager.refreshMenusForFile(file);

          // Ensure core renames propagate into frontmatter title (and apply normalization rules).
          // Run slightly delayed to allow metadata cache to settle after the rename.
          setTimeout(() => {
            this.fileNamingService.syncTitleFromFilename(file);
          }, 150);
        }
      })
    );

    this.register(() => this.persistentMenuManager.detach());
    this.register(() => this.menuController.detach());


    this.registerEvent(
      this.app.vault.on('delete', () => {
        logger.log('[TPS GCM] vault delete detected; blurring and closing menu');
        try {
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        } catch (err) {
          logger.warn('TPS GCM: blur after delete failed', err);
        }
        try {
          this.menuController?.hideMenu?.();
        } catch (err) {
          logger.warn('TPS GCM: hideMenu after delete failed', err);
        }
        try {
          this.app.workspace.trigger('tps-gcm-delete-complete');
        } catch (err) {
          logger.warn('TPS GCM: trigger delete-complete failed', err);
        }
      })
    );

    // Initial menu setup
    ensureMenus();

    // Mobile keyboard handling delegated to PersistentMenuManager

    // Check for missing recurrences on startup
    this.app.workspace.onLayoutReady(async () => {
      // Give a short delay to allow other plugins/cache to settle
      setTimeout(async () => {
        logger.log('[TPS GCM] Checking for missing recurrences on startup...');
        await this.bulkEditService.checkMissingRecurrences();
      }, 2000);
    });

    // Manual Context Menu for Sync Embeds (Reading Mode)
    // Global Context Menu Interceptor (Strict Mode & Sync Embeds)
    this.registerDomEvent(document, 'contextmenu', (evt: MouseEvent) => {
      // 1. Resolve Targets
      // We pass the event so the service can check specific click targets (embeds, etc.)
      const targets = this.contextTargetService.resolveTargets([], evt);
      if (targets.length === 0) return;

      const file = targets[0];
      const isSyncEmbed = !!this.contextTargetService.resolveEmbedTarget(evt.target as HTMLElement);

      // 2. Decide if we should intercept
      // Intercept if:
      // a) Strict Mode is ENABLED
      // b) It is a Sync Embed (Reading mode embeds don't trigger native file-menu usually, so we always handle them)
      if (this.settings.enableStrictMode || isSyncEmbed) {
        // Suppress Native Menu
        evt.preventDefault();
        evt.stopPropagation();

        const menu = new Menu();

        // 3. Populate Menu
        // If Strict Mode is on, we are responsible for the entire menu.
        // We add our own items via menuController.
        this.menuController.addToNativeMenu(menu, targets);

        // NOTE: In Strict Mode, we DO NOT trigger 'file-menu' or 'editor-menu' generically,
        // because that would allow other plugins to pollute our strict menu (unless we want that?).
        // For now, strict means STRICT - only what we define + system commands we enabled.
        // If the user wants other plugins, they might request a "Permissive Strict Mode" later.

        // 4. Show Menu
        menu.showAtPosition({ x: evt.pageX, y: evt.pageY });
      }
    }, { capture: true });

    // Sidebar Open Commands
    this.addCommand({
      id: 'open-in-right-sidebar',
      name: 'Open active file in Right Sidebar',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          if (!checking) {
            const leaf = this.app.workspace.getRightLeaf(true);
            if (leaf) {
              leaf.openFile(file);
              this.app.workspace.revealLeaf(leaf);
            }
          }
          return true;
        }
        return false;
      }
    });

    this.addCommand({
      id: 'open-in-left-sidebar',
      name: 'Open active file in Left Sidebar',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          if (!checking) {
            const leaf = this.app.workspace.getLeftLeaf(true);
            if (leaf) {
              leaf.openFile(file);
              this.app.workspace.revealLeaf(leaf);
            }
          }
          return true;
        }
        return false;
      }
    });
  }

  patchMenuMethods() {
    // Monkey patch Menu to enforce ordering right before display
    const originalShowAtPosition = Menu.prototype.showAtPosition;
    const originalShowAtMouseEvent = Menu.prototype.showAtMouseEvent;

    const reorderItems = (menu: Menu) => {
      // Check for items existence and if we likely tampered with it
      if ((menu as any).items) {
        const items = (menu as any).items as any[];
        const tpsItems: any[] = [];
        const otherItems: any[] = [];

        for (const item of items) {
          // Identify TPS items by our custom flag
          if ((item as any)._isTpsItem) {
            tpsItems.push(item);
          } else {
            otherItems.push(item);
          }
        }

        // Deduplicate: Remove items from otherItems that match TPS items by title
        const getTitle = (item: any) => {
          let t = item.title;
          if (!t && item.dom) {
            const titleEl = item.dom.querySelector('.menu-item-title');
            if (titleEl) t = titleEl.innerText;
            else t = item.dom.innerText;
          }
          // Normalize: trim, lowercase, remove ellipsis, replace NBSP
          return t ? t.toLowerCase().replace(/\.\.\.$/, '').replace(/\u00A0/g, ' ').trim() : '';
        };

        const tpsTitles = new Set();
        tpsItems.forEach(item => {
          const t = getTitle(item);
          if (!t) return;
          tpsTitles.add(t);

          // Add aliases
          if (t === 'reveal in system explorer') {
            tpsTitles.add('reveal in finder');
            tpsTitles.add('show in system explorer');
            tpsTitles.add('show in folder');
          }
          if (t === 'reveal in navigation') {
            tpsTitles.add('reveal file in navigation');
          }
          if (t === 'copy relative path') {
            tpsTitles.add('copy path');
          }
        });

        // Track seen titles to prevent duplicates in Native items too
        const seenTitles = new Set(tpsTitles);

        const uniqueOtherItems = otherItems.filter(item => {
          const t = getTitle(item);
          // Keep item if it has no title (separator?) 
          if (!t) return true;

          if (seenTitles.has(t)) return false;
          seenTitles.add(t);
          return true;
        });

        // Only reorder if we actually found TPS items
        if (tpsItems.length > 0) {
          (menu as any).items = [...tpsItems, ...uniqueOtherItems];
        }
      }
    };

    // We modify the prototype's method to intercept the call
    Menu.prototype.showAtPosition = function (pos) {
      reorderItems(this);
      return originalShowAtPosition.call(this, pos);
    };

    Menu.prototype.showAtMouseEvent = function (evt) {
      reorderItems(this);
      return originalShowAtMouseEvent.call(this, evt);
    };

    this.restoreMenuPatch = () => {
      Menu.prototype.showAtPosition = originalShowAtPosition;
      Menu.prototype.showAtMouseEvent = originalShowAtMouseEvent;
    };
  }

  onunload(): void {
    if (this.restoreMenuPatch) {
      this.restoreMenuPatch();
      this.restoreMenuPatch = null;
    }
    this.restoreConsoleError?.();
    this.restoreConsoleError = null;
    this.menuController?.detach();
    this.removeStyles();
    this.persistentMenuManager?.detach();
    this.recurrenceService?.cleanup();
    document.body?.classList?.remove('tps-context-hidden-for-keyboard');
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    logger.setLoggingEnabled(this.settings.enableLogging);
  }

  async saveSettings(): Promise<void> {
    logger.setLoggingEnabled(this.settings.enableLogging);
    this.debouncedSave();
  }

  injectStyles(): void {
    if (this.styleEl) return;
    const style = document.createElement('style');
    style.id = 'tps-global-context-style';
    style.textContent = PLUGIN_STYLES;
    document.head.appendChild(style);
    this.styleEl = style;
  }

  removeStyles(): void {
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }
  }

  createMenuHeader(file: TFile): HTMLElement {
    const div = document.createElement('div');
    div.className = 'tps-global-context-header';
    div.textContent = file.basename;
    return div;
  }

  createMultiMenuHeader(files: TFile[]): HTMLElement {
    const div = document.createElement('div');
    div.className = 'tps-global-context-header';
    div.textContent = `${files.length} files selected`;
    return div;
  }

  buildSpecialPanel(file: TFile | TFile[], options: BuildPanelOptions = {}): HTMLElement | null {
    const files = Array.isArray(file) ? file : [file];
    return this.menuController.buildSpecialPanel(files, options);
  }

  // Mobile keyboard watcher moved to PersistentMenuManager

}
