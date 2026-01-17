import { MarkdownView, TFile, Platform, debounce } from 'obsidian';
import type TPSGlobalContextMenuPlugin from './main';
import { MenuController, addSafeClickListener } from './menu-controller';
import { MenuInstances } from './types';

// Get the LIVE mode constant if available


/**
 * Manages persistent menus in reading and live preview modes
 */
export class PersistentMenuManager {
  plugin: TPSGlobalContextMenuPlugin;
  menus: Map<MarkdownView, MenuInstances> = new Map();

  private handleResize: (() => void) | null = null;

  constructor(plugin: TPSGlobalContextMenuPlugin) {
    this.plugin = plugin;
    this.setupKeyboardDetection();
  }

  private baseHeight: number = window.innerHeight;

  private isCurrentlyHidden: boolean = false;

  setupKeyboardDetection() {
    // Use Obsidian's workspace events for reliable detection of editing state
    // maximum height we've seen to use as a baseline
    this.baseHeight = window.visualViewport?.height || window.innerHeight;

    // Core detection function - Debounced to prevent resize loops
    this.handleResize = debounce(() => {
      const viewport = window.visualViewport;

      // Update baseline if viewport grows significantly (e.g. orientation change or keyboard closed)
      if (viewport && viewport.height > this.baseHeight) {
        this.baseHeight = viewport.height;
      }

      // Check if we're on mobile
      const isMobile = Platform.isMobile ||
        document.body.classList.contains('is-mobile') ||
        document.body.classList.contains('is-phone') ||
        window.innerWidth < 768;

      if (!isMobile) {
        if (this.isCurrentlyHidden) {
          document.body.classList.remove('tps-context-hidden-for-keyboard');
          this.isCurrentlyHidden = false;
        }
        return;
      }

      // Check if we're in reading mode - never hide in reading mode
      // Use Obsidian's workspace API for accurate detection
      const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
      const isInReadingMode = activeView?.getMode() === 'preview';
      if (isInReadingMode) {
        if (this.isCurrentlyHidden) {
          document.body.classList.remove('tps-context-hidden-for-keyboard');
          this.isCurrentlyHidden = false;
        }
        return;
      }

      // Check if any editable element is focused
      const activeElement = document.activeElement;

      // CRITICAL FIX: If focus is inside our own menu/panel, NEVER hide it.
      if (activeElement && activeElement.closest('.tps-global-context-menu')) {
        if (this.isCurrentlyHidden) {
          document.body.classList.remove('tps-context-hidden-for-keyboard');
          this.isCurrentlyHidden = false;
        }
        return;
      }
      const isFocusInEditor = activeElement && (
        activeElement.classList.contains('cm-content') ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.tagName === 'INPUT' ||
        (activeElement as HTMLElement).isContentEditable ||
        activeElement.closest('.markdown-source-view') ||
        activeElement.closest('.cm-editor')
      );

      // On mobile in editing mode with focus in editor, hide the menu
      const shouldHide = !!isFocusInEditor;

      // Only update if state has changed
      if (shouldHide !== this.isCurrentlyHidden) {
        this.isCurrentlyHidden = shouldHide;
        document.body.classList.toggle('tps-context-hidden-for-keyboard', shouldHide);
        if (shouldHide) {
          this.plugin.menuController?.hideMenu();
        }
      }
    }, 300, true); // Longer debounce to prevent flicker

    // Listen to visualViewport if available - this is the proper API for keyboard detection
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.handleResize);
    }

    // NOTE: We intentionally DON'T listen to focusin/focusout/resize as they fire too frequently
    // and cause flickering. visualViewport.resize is sufficient for keyboard detection.

    this.plugin.registerEvent(
      this.plugin.app.workspace.on('active-leaf-change', () => {
        // User switched views - recheck with delay
        setTimeout(this.handleResize!, 200);
      })
    );
  }

  teardownKeyboardDetection() {
    if (this.handleResize) {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', this.handleResize);
      }
      this.handleResize = null;
    }
    this.isCurrentlyHidden = false;
    document.body.classList.remove('tps-context-hidden-for-keyboard');
  }

  /**
   * Ensure menus exist for all active markdown views
   */
  ensureMenus(): void {
    if (!this.plugin?.app?.workspace) return;

    const activeViews = new Set<MarkdownView>();

    this.plugin.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
      const view = leaf.view as MarkdownView;
      if (!view || !view.file) return;

      activeViews.add(view);
      this.ensureReadingMenu(view);
      this.ensureLiveMenu(view);
    });

    // Clean up menus for views that no longer exist
    for (const view of Array.from(this.menus.keys())) {
      if (!activeViews.has(view)) {
        this.cleanup(view);
      }
    }
  }

  /**
   * Ensure reading mode menu exists
   */
  ensureReadingMenu(view: MarkdownView): void {
    // Strict mode check: Only show in Preview mode
    if (view.getMode() !== 'preview') {
      this.removeReadingMenu(view);
      return;
    }

    // Target the sizer specifically to respect readable line length
    const container = view.contentEl?.querySelector('.markdown-preview-sizer');

    if (!container) {
      this.removeReadingMenu(view);
      return;
    }

    const instances = this.menus.get(view) || {};

    // Check if file path matches - if not, remove old menu
    if (instances.reading && instances.filePath !== view.file?.path) {
      this.removeReadingMenu(view);
    } else if (instances.reading && container.contains(instances.reading)) {
      // Valid menu already exists and is attached
      return;
    }

    this.removeReadingMenu(view);

    const menu = this.createPersistentMenu(view, 'reading');
    if (menu) {
      // Insert at the top of the sizer, or after the inline title if it exists within the sizer
      const inlineTitle = container.querySelector('.inline-title');
      if (inlineTitle) {
        inlineTitle.after(menu);
      } else {
        container.prepend(menu);
      }
      instances.reading = menu;
      instances.filePath = view.file.path; // Track which file this menu belongs to
      this.menus.set(view, instances);
    }
  }

  /**
   * Ensure live preview menu exists
   */
  ensureLiveMenu(view: MarkdownView): void {
    // Strict mode check: Only show in Source mode (Live Preview is a type of Source mode)
    if (view.getMode() !== 'source') {
      this.removeLiveMenu(view);
      return;
    }

    // Robustly find the source view container
    const sourceContainer = view.contentEl?.querySelector('.markdown-source-view');

    // Check if we are in Live Preview mode
    if (!sourceContainer || !sourceContainer.classList.contains('is-live-preview')) {
      this.removeLiveMenu(view);
      return;
    }

    const instances = this.menus.get(view) || {};

    // Check if file path matches - if not, remove old menu
    if (instances.live && instances.filePath !== view.file?.path) {
      this.removeLiveMenu(view);
    } else if (instances.live && sourceContainer.contains(instances.live)) {
      // Valid menu already exists and is attached
      return;
    }

    this.removeLiveMenu(view);

    const menu = this.createPersistentMenu(view, 'live');
    if (menu) {
      sourceContainer.appendChild(menu);
      instances.live = menu;
      instances.filePath = view.file.path; // Track which file this menu belongs to
      this.menus.set(view, instances);
    }
  }

  /**
   * Create a persistent menu element
   */
  createPersistentMenu(
    view: MarkdownView,
    mode: 'reading' | 'live'
  ): HTMLElement | null {
    const file = view.file;
    if (!file) return null;

    const menuEl = document.createElement('div');
    menuEl.className = `tps-global-context-menu tps-global-context-menu--persistent tps-global-context-menu--${mode} tps-global-context-menu--collapsed`;
    menuEl.setAttribute('role', 'presentation');

    const header = this.plugin.menuController.createSummaryHeader(file, view.leaf);
    const collapseButton = header.querySelector<HTMLButtonElement>('.tps-gcm-collapse-button');

    const setToggleState = (expanded: boolean) => {
      if (collapseButton) {
        collapseButton.setAttribute('aria-expanded', expanded.toString());
        collapseButton.setAttribute('title', expanded ? 'Collapse inline controls' : 'Expand inline controls');
      }
    };

    const toggleCollapse = () => {
      const collapsed = menuEl.classList.toggle('tps-global-context-menu--collapsed');
      setToggleState(!collapsed);
    };

    const handleHeaderToggle = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      toggleCollapse();
    };

    addSafeClickListener(header, handleHeaderToggle);
    if (collapseButton) {
      addSafeClickListener(collapseButton, (e) => {
        toggleCollapse();
      });
    }

    setToggleState(false);
    menuEl.appendChild(header);

    const panel = this.plugin.buildSpecialPanel(file, {
      recurrenceRoot: menuEl,
      closeAfterRecurrence: false,
    });

    if (!panel) return null;

    menuEl.appendChild(panel);
    return menuEl;
  }

  /**
   * Remove reading menu from view
   */
  removeReadingMenu(view: MarkdownView): void {
    const instances = this.menus.get(view);
    if (!instances?.reading) return;

    instances.reading.remove();
    instances.reading = null;

    if (!instances.live) {
      this.menus.delete(view);
      return;
    }

    this.menus.set(view, instances);
  }

  /**
   * Remove live menu from view
   */
  removeLiveMenu(view: MarkdownView): void {
    const instances = this.menus.get(view);
    if (!instances?.live) return;

    instances.live.remove();
    instances.live = null;

    if (!instances.reading) {
      this.menus.delete(view);
      return;
    }

    this.menus.set(view, instances);
  }

  /**
   * Clean up all menus for a view
   */
  cleanup(view: MarkdownView): void {
    const instances = this.menus.get(view);
    if (!instances) return;

    instances.reading?.remove();
    instances.live?.remove();
    this.menus.delete(view);
  }

  /**
   * Refresh menus for views showing a specific file.
   * Called when frontmatter changes to update stale inline menus.
   * Updates just the header badges in-place to avoid visual jitter.
   */
  refreshMenusForFile(file: TFile): void {
    for (const [view, instances] of this.menus.entries()) {
      if (view.file?.path === file.path) {
        // Update header badges in-place instead of recreating the entire menu
        // This prevents visual jitter/movement

        if (instances.live) {
          const headerRight = instances.live.querySelector('.tps-gcm-header-right');
          if (headerRight) {
            // Get updated badges from the controller
            const newBadges = this.plugin.menuController.createHeaderBadges(file, view.leaf);
            headerRight.innerHTML = '';
            headerRight.appendChild(newBadges);
          }
        }

        if (instances.reading) {
          const headerRight = instances.reading.querySelector('.tps-gcm-header-right');
          if (headerRight) {
            // Get updated badges from the controller
            const newBadges = this.plugin.menuController.createHeaderBadges(file, view.leaf);
            headerRight.innerHTML = '';
            headerRight.appendChild(newBadges);
          }
        }
      }
    }
  }

  /**
   * Detach all menus
   */
  detach(): void {
    this.teardownKeyboardDetection();
    for (const view of Array.from(this.menus.keys())) {
      this.cleanup(view);
    }
  }
}
