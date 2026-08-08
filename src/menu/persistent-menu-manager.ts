import { Component, MarkdownRenderer, MarkdownView, TFile, WorkspaceLeaf, Platform, debounce, setIcon, Menu, normalizePath, Notice } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import type { GcmExternalActionContext, GcmExternalActionRegistration } from '../main';
import {
  isCompatibleMarkdownView,
  getViewMode,
  getCompatibleMarkdownViewFromLeaf,
  isStrictSourceMode,
  resolvePrimaryMarkdownView,
  pickBestMarkdownLeaf,
  scoreMarkdownLeaf,
  isLeafActiveInDom,
  isLeafVisible,
  isSideDockLeaf,
} from '../services/leaf-resolver';
import { MenuController, addSafeClickListener } from './menu-controller';
import { CustomProperty, MenuInstances } from '../types';
import { ViewModeService } from '../services/view-mode-service';
import { resolveCustomProperties } from '../resolve-profiles';
import {
  applyCustomPropertyVisibilityUpdate,
  createCustomPropertySurfaceVisibilityPatch,
  getCustomPropertySurfaceVisibilityMode,
  refreshMountedCustomPropertyPresentationViews,
} from '../services/custom-property-visibility';
import { getTaskDisplayTitle, parseTaskLine, readInlineFieldValue } from '../utils/task-line-metadata';
import { resolveTaskScheduledValue } from '../utils/daily-note-task-schedule';
import * as logger from '../logger';
import { KeyboardAwareOverlay } from '../utils/mobile-overlay';
import { LinkedContextItem, LinkedContextService } from '../services/linked-context-service';
// scroll-direction hide/reveal is handled inline â€” no gesture-handler import needed.

// Get the LIVE mode constant if available

type CalendarPopoverItem = {
  title: string;
  subtitle: string;
  sortTime: number;
  file?: TFile;
  lineNumber?: number;
  completed?: boolean;
  rawLine?: string;
  kind?: 'note' | 'task' | 'external';
  icon?: string;
  color?: string;
  location?: string;
  description?: string;
  externalKey?: string;
  uidDayKey?: string;
  localSlotKey?: string;
};

type NoteTaskPopoverItem = {
  title: string;
  lineNumber: number;
  completed: boolean;
  rawLine: string;
  scheduledValue?: string;
};

type ExternalCalendarLikeEvent = {
  id?: string;
  uid?: string;
  title?: string;
  sourceUrl?: string;
  startDate?: Date | string | number;
  endDate?: Date | string | number;
  location?: string;
  description?: string;
  color?: string;
};

type CalendarButtonTimerState = {
  file: TFile;
  scheduledDate: Date;
  labelEl: HTMLElement;
  buttonEl: HTMLElement;
  count: number | null;
  sessionStart: string | null;
  activeCount: number;
  lastFetchAt: number;
  fetchInFlight: boolean;
};

const NATIVE_PROPERTIES_ALWAYS_HIDDEN = new Set(['icon', 'color', 'sort']);

/**
 * Manages persistent menus in reading and live preview modes
 */
export class PersistentMenuManager {
  plugin: TPSGlobalContextMenuPlugin;
  menus: Map<MarkdownView, MenuInstances> = new Map();
  private inlineSubitemsPanels: Map<MarkdownView, HTMLElement> = new Map();
  private noteReferencesPanels: Map<MarkdownView, HTMLElement> = new Map();
  private noteGraphPanels: Map<MarkdownView, HTMLElement> = new Map();
  private titleIcons: Map<MarkdownView, HTMLElement> = new Map();
  private topParentNavs: Map<MarkdownView, HTMLElement> = new Map();
  private bottomParentNavs: Map<MarkdownView, HTMLElement> = new Map();
  private linkedContextPanels: Map<MarkdownView, { el: HTMLElement; component: Component; signature: string }> = new Map();
  private linkedContextRequestIds: Map<MarkdownView, number> = new Map();
  private readonly linkedContextService: LinkedContextService;
  private nativePropertyInitializationInFlight: Set<string> = new Set();
  private nativePropertyObservers: Map<MarkdownView, MutationObserver> = new Map();
  private nativePropertyClickHandlers: Map<MarkdownView, EventListener> = new Map();
  private nativePropertyRefreshTimers: Map<MarkdownView, number> = new Map();
  private nativePropertiesExpandedStateByView: Map<MarkdownView, boolean | undefined> = new Map();
  private liveResizeObservers: Map<MarkdownView, ResizeObserver> = new Map();
  private geometryResizeObservers: Map<MarkdownView, ResizeObserver> = new Map();
  private liveHeights: Map<MarkdownView, number> = new Map();
  private attachRetryTimers: Map<MarkdownView, number> = new Map();
  private scrollListeners: Map<MarkdownView, { container: HTMLElement; listener: (evt: Event) => void; timer?: number }> = new Map();
  public collapsedStateByPath: Map<string, boolean> = new Map();

  private handleResize: (() => void) | null = null;
  private handleFocus: (() => void) | null = null;
  private handleWindowResize: (() => void) | null = null;
  private visualViewportResizeHandler: (() => void) | null = null;
  private visualViewportScrollHandler: (() => void) | null = null;
  private keyboardFocusInHandler: ((evt: Event) => void) | null = null;
  private keyboardFocusOutHandler: (() => void) | null = null;
  private mobileOverlayInteractionUntil = 0;
  private keyboardFocusTimer: number | null = null;
  private baseHeight: number = window.innerHeight;
  private isCurrentlyHidden: boolean = false;
  private keyboardVisible: boolean = false;
  private editableFocused: boolean = false;
  private swipeCollapsed: boolean = false;
  private scrollHideListeners: Map<MarkdownView, { scroller: HTMLElement; listener: () => void; lastTop: number; accum: number }> = new Map();
  private topLinkPreviewArmedPath: string | null = null;
  private topLinkPreviewArmedUntil = 0;
  private topLinkPreviewEl: HTMLElement | null = null;
  private topLinkPreviewTextCache: Map<string, string> = new Map();
  private topLinkPreviewHideTimer: number | null = null;
  private topLinksPopoverEl: HTMLElement | null = null;
  private topLinksPopoverOutsideHandler: ((evt: MouseEvent) => void) | null = null;
  private calendarOpenArmedKey: string | null = null;
  private calendarOpenArmedUntil = 0;
  private selectedCalendarPopoverPath: string | null = null;
  private calendarButtonTimerStates: Set<CalendarButtonTimerState> = new Set();
  private calendarButtonTimerInterval: number | null = null;
  private baseLinkPreviewEl: HTMLElement | null = null;
  private baseLinkPreviewComponent: Component | null = null;
  private baseLinkPreviewBodyEl: HTMLElement | null = null;
  private baseLinkPreviewEditorEl: HTMLTextAreaElement | null = null;
  private baseLinkPreviewFile: TFile | null = null;
  private baseLinkPreviewLastSavedBody = '';
  private baseLinkPreviewSaveTimer: number | null = null;
  private baseLinkPreviewRenderTimer: number | null = null;
  private baseLinkPreviewRenderInFlight = false;
  private baseLinkPreviewSaveInFlight = false;
  private baseLinkPreviewOutsideHandler: ((evt: MouseEvent) => void) | null = null;
  private baseLinkPreviewOverlay: KeyboardAwareOverlay | null = null;
  private viewModeSignatures: WeakMap<MarkdownView, string> = new WeakMap();
  private topPropertiesPlaceholderTimers: Map<MarkdownView, number> = new Map();
  private postTypingStructuralRefreshTimers: Map<string, number> = new Map();

  constructor(plugin: TPSGlobalContextMenuPlugin) {
    this.plugin = plugin;
    this.linkedContextService = new LinkedContextService(plugin.app);
    this.setupKeyboardDetection();
    this.setupNativePropertyGlobalClickSync();
    this.updateMobileBottomOffsets();
  }

  private getNativePropertiesControlSelector(): string {
    return [
      '.metadata-properties-heading',
      '.metadata-container .metadata-properties-heading',
      '.metadata-container [aria-expanded]',
      '.metadata-container [role="button"]',
      '.metadata-container button',
      'button',
      'button[aria-label*="properties" i]',
      '[role="button"][aria-label*="properties" i]',
      '[role="button"]',
      '[aria-label*="collapse properties" i]',
      '[aria-label*="expand properties" i]',
    ].join(', ');
  }

  private getNativePropertiesControlText(control: HTMLElement | null): string {
    if (!control) return '';
    const ariaLabel = control.getAttribute('aria-label') || '';
    const title = control.getAttribute('title') || '';
    const text = control.textContent || '';
    return `${text} ${ariaLabel} ${title}`.toLowerCase();
  }

  private isLikelyNativePropertiesControl(control: HTMLElement | null): boolean {
    if (!control) return false;
    if (control.matches('.metadata-properties-heading') || control.matches('.metadata-container [aria-expanded]')) return true;

    const text = this.getNativePropertiesControlText(control);
    if (!text) return false;

    if (/collapse\s+properties/.test(text) || /expand\s+properties/.test(text)) return true;
    if (control.matches('.metadata-container button') || control.matches('.metadata-container [role="button"]')) return /properties/.test(text);
    return /properties/.test(text);
  }

  private setupNativePropertyGlobalClickSync(): void {
    this.plugin.registerDomEvent(document, 'click', (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const control = target?.closest<HTMLElement>(
        this.getNativePropertiesControlSelector()
      );
      if (!this.isLikelyNativePropertiesControl(control)) return;

      for (const delay of [0, 50, 150]) {
        window.setTimeout(() => {
          const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
          const file = view?.file;
          if (!view || !(file instanceof TFile)) return;
          this.applyNativePropertyVisibilityIfCurrent(view, file);
          this.syncPersistentMenuForNativeProperties(view, file);
          this.applyPersistentContextStripVisibility(view);
        }, delay);
      }
    }, true);
  }

  /**
   * Public setter to update collapse state from PanelBuilder or other components
   */
  public setSubitemsPanelCollapsed(path: string, collapsed: boolean): void {
    this.collapsedStateByPath.set(path, collapsed);
    // Keep top nav buttons in sync with collapse state changes in real time.
    for (const view of this.menus.keys()) {
      if (view.file?.path === path) {
        this.ensureTopParentNav(view);
      }
    }
  }

  /**
   * Check if a file matches any ignore rules
   */
  private fileMatchesIgnoreRules(file: TFile, ignoreRules: any[]): boolean {
    if (!ignoreRules || ignoreRules.length === 0) return false;

    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter || {};

    for (const rule of ignoreRules) {
      if (!rule.conditions || rule.conditions.length === 0) continue;

      const matchMode = rule.match === 'any' ? 'some' : 'every';
      const conditionsMatch = (rule.conditions as any[])[matchMode]((condition: any) => {
        const type = condition.type || 'frontmatter';
        const operator = condition.operator || 'equals';

        if (type === 'path') {
          const path = file.path;
          const match = this.pathConditionMatches(path, operator, condition.value || '');

          logger.debug(`[fileMatchesIgnoreRules] path eval: ${path} vs ${condition.value} with ${operator} -> ${match}`);
          return match;
        }

        if (type === 'frontmatter') {
          const key = String(condition.key || '').toLowerCase();
          const fmKeys = Object.keys(fm);
          const fmKey = fmKeys.find((k) => k.toLowerCase() === key);
          const value = fmKey ? fm[fmKey] : null;

          let match = false;
          if (operator === 'exists') match = value != null && value !== '';
          if (operator === 'missing') match = value == null || value === '';
          if (operator === 'equals') match = String(value || '') === (condition.value || '');
          if (operator === 'not-equals') match = String(value || '') !== (condition.value || '');
          if (operator === 'contains') match = String(value || '').includes(condition.value || '');
          if (operator === 'not-contains') match = !String(value || '').includes(condition.value || '');

          logger.debug(`[fileMatchesIgnoreRules] frontmatter eval: key=${key}, value=${value} vs ${condition.value} with ${operator} -> ${match}`);
          return match;
        }

        return false;
      });

      if (conditionsMatch) return true;
    }

    return false;
  }

  private pathConditionMatches(filePath: string, operator: string, rawValue: string): boolean {
    const path = this.normalizePathForMatch(filePath);
    const value = this.normalizePathForMatch(rawValue);
    if (!path) return operator === 'missing';
    if (!value) return operator === 'exists' ? true : operator === 'missing';

    const candidates = this.getPathMatchCandidates(path);
    const hasWildcard = value.includes('*');
    const positiveMatch = hasWildcard
      ? candidates.some((candidate) => this.matchesWildcardPath(value, candidate))
      : candidates.some((candidate) => {
        if (operator === 'equals') return candidate === value;
        if (operator === 'starts-with') return candidate.startsWith(value);
        if (operator === 'ends-with') return candidate.endsWith(value);
        return candidate.includes(value);
      });

    if (operator === 'not-contains' || operator === 'not-equals') return !positiveMatch;
    return positiveMatch;
  }

  private normalizePathForMatch(value: string): string {
    return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
  }

  private getPathMatchCandidates(path: string): string[] {
    const parts = path.split('/').filter(Boolean);
    const candidates = new Set<string>([path]);
    for (let i = 0; i < parts.length; i += 1) {
      candidates.add(parts.slice(i).join('/'));
      candidates.add(parts[i]);
    }
    return Array.from(candidates);
  }

  private matchesWildcardPath(pattern: string, value: string): boolean {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 'i').test(value);
  }

  setupKeyboardDetection() {
    if (!Platform.isMobile) return;
    if (typeof window === 'undefined') return;

    // Mobile platforms differ: sometimes visualViewport shrinks, sometimes window.innerHeight shrinks
    const getViewportHeight = () => window.visualViewport?.height || window.innerHeight;

    this.baseHeight = Math.max(window.innerHeight || 0, getViewportHeight() || 0);

    const evaluateKeyboardState = () => {
      if (this.isMobileOverlayInteractionActive()) return;
      const currentHeight = getViewportHeight();
      if (!currentHeight) return;

      // Keep baseline resilient after orientation/UI chrome changes.
      if (currentHeight > this.baseHeight) {
        this.baseHeight = currentHeight;
      }

      const delta = this.baseHeight - currentHeight;
      const ratio = this.baseHeight > 0 ? delta / this.baseHeight : 0;
      const visible = delta > 140 || ratio > 0.18;

      if (visible === this.keyboardVisible) return;
      this.keyboardVisible = visible;
      this.plugin.keyboardVisible = visible;
      this.handleKeyboardVisibilityChange(visible);
    };

    this.visualViewportResizeHandler = () => evaluateKeyboardState();
    this.visualViewportScrollHandler = () => evaluateKeyboardState();

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.visualViewportResizeHandler);
      window.visualViewport.addEventListener('scroll', this.visualViewportScrollHandler);
    }
    // Critical fallback for Obsidian Mobile where visualViewport doesn't always fire
    window.addEventListener('resize', this.visualViewportResizeHandler);

    // focusin/focusout: most reliable keyboard-appear signal on mobile.
    // When the user taps into a text editor the keyboard animates in over ~300ms;
    // we re-evaluate after that delay so the viewport has finished shrinking.
    this.keyboardFocusInHandler = (evt: Event) => {
      if (!this.isKeyboardSuppressionEnabled()) return;
      const target = evt.target as HTMLElement | null;
      if (!target) return;
      if (this.isInsideMobileStableOverlay(target)) {
        this.markMobileOverlayInteraction();
        this.editableFocused = false;
        document.body?.classList?.remove('tps-context-hidden-for-keyboard');
        this.applyAllMenuVisibility();
        return;
      }
      const isInteractiveChrome = !!target.closest([
        'button',
        '[role="button"]',
        '[aria-expanded]',
        '[aria-haspopup]',
        '.metadata-properties-heading',
        '.metadata-property',
        '.metadata-property-container',
        '.tps-gcm-top-properties-heading',
      ].join(', '));
      const focusedCodeMirrorContent = !!target.closest('.cm-content[contenteditable="true"]');
      const isEditable =
        !isInteractiveChrome && (
          target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          focusedCodeMirrorContent
        );
      if (!isEditable) return;
      // Immediately hide menus before the keyboard animation begins — don't wait
      // for the viewport-height delta to cross the threshold (that's too late).
      this.editableFocused = true;
      document.body?.classList?.add('tps-context-hidden-for-keyboard');
      this.applyAllMenuVisibility();
      if (this.keyboardFocusTimer !== null) window.clearTimeout(this.keyboardFocusTimer);
      // Re-evaluate after keyboard animation completes (~350 ms on most phones).
      this.keyboardFocusTimer = window.setTimeout(() => {
        this.keyboardFocusTimer = null;
        evaluateKeyboardState();
      }, 350);
    };
    this.keyboardFocusOutHandler = () => {
      if (!this.isKeyboardSuppressionEnabled()) return;
      if (this.isMobileOverlayInteractionActive()) {
        this.editableFocused = false;
        document.body?.classList?.remove('tps-context-hidden-for-keyboard');
        this.applyAllMenuVisibility();
        return;
      }
      // Clear the anticipation flag immediately so the menu can restore as soon
      // as the keyboard-gone evaluation confirms the viewport is full-height again.
      this.editableFocused = false;
      if (!this.keyboardVisible) {
        document.body?.classList?.remove('tps-context-hidden-for-keyboard');
        this.applyAllMenuVisibility();
      }
      if (this.keyboardFocusTimer !== null) window.clearTimeout(this.keyboardFocusTimer);
      // Keyboard dismissal is faster; 100 ms is enough.
      this.keyboardFocusTimer = window.setTimeout(() => {
        this.keyboardFocusTimer = null;
        evaluateKeyboardState();
      }, 100);
    };
    document.addEventListener('focusin', this.keyboardFocusInHandler, { passive: true, capture: true });
    document.addEventListener('focusout', this.keyboardFocusOutHandler, { passive: true, capture: true });

    document.addEventListener('touchstart', (evt) => {
      const target = evt.target as HTMLElement | null;
      if (target && this.isInsideMobileStableOverlay(target)) this.markMobileOverlayInteraction();
    }, { passive: true, capture: true });

    document.addEventListener('pointerdown', (evt) => {
      const target = evt.target as HTMLElement | null;
      if (target && this.isInsideMobileStableOverlay(target)) this.markMobileOverlayInteraction();
    }, { passive: true, capture: true });

    evaluateKeyboardState();
  }

  teardownKeyboardDetection() {
    if (typeof window === 'undefined') return;

    if (window.visualViewport) {
      if (this.visualViewportResizeHandler) {
        window.visualViewport.removeEventListener('resize', this.visualViewportResizeHandler);
      }
      if (this.visualViewportScrollHandler) {
        window.visualViewport.removeEventListener('scroll', this.visualViewportScrollHandler);
      }
    }

    if (this.visualViewportResizeHandler) {
      window.removeEventListener('resize', this.visualViewportResizeHandler);
    }

    if (this.keyboardFocusInHandler) {
      document.removeEventListener('focusin', this.keyboardFocusInHandler, { capture: true });
      this.keyboardFocusInHandler = null;
    }
    if (this.keyboardFocusOutHandler) {
      document.removeEventListener('focusout', this.keyboardFocusOutHandler, { capture: true });
      this.keyboardFocusOutHandler = null;
    }
    if (this.keyboardFocusTimer !== null) {
      window.clearTimeout(this.keyboardFocusTimer);
      this.keyboardFocusTimer = null;
    }

    this.visualViewportResizeHandler = null;
    this.visualViewportScrollHandler = null;
    this.keyboardVisible = false;
    this.editableFocused = false;
    this.plugin.keyboardVisible = false;
    document.body?.classList?.remove('tps-context-hidden-for-keyboard');
    document.documentElement.style.setProperty('--tps-gcm-mobile-toolbar-offset', '0px');
  }

  private applyAuxElementVisibility(el: HTMLElement, keyboardVisible: boolean): void {
    if (keyboardVisible) {
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
    } else {
      el.style.removeProperty('visibility');
      el.style.removeProperty('opacity');
      el.style.removeProperty('pointer-events');
    }
  }

  private handleKeyboardVisibilityChange(visible: boolean): void {
    const suppressForKeyboard = this.isKeyboardSuppressionEnabled();
    const shouldHide = suppressForKeyboard && (visible || this.editableFocused);
    // Keep class for compatibility with existing selectors.
    document.body?.classList?.toggle('tps-context-hidden-for-keyboard', shouldHide);
    this.updateMobileBottomOffsets();

    for (const [view, instances] of this.menus.entries()) {
      if (instances.reading?.isConnected) {
        this.applyPersistentMenuGeometry(view, instances.reading);
        this.applyMenuVisibility(instances.reading);
      }
      if (instances.live?.isConnected) {
        this.applyPersistentMenuGeometry(view, instances.live);
        this.applyMenuVisibility(instances.live);
      }

      const panel = this.inlineSubitemsPanels.get(view);
      if (panel?.isConnected) {
        this.applyInlinePanelVisibility(panel);
      }
    }

    // Also hide/show floating overlay elements that aren't tracked in `menus`.
    for (const el of this.noteGraphPanels.values()) {
      if (el.isConnected) this.applyAuxElementVisibility(el, shouldHide);
    }
    for (const [view, topNav] of this.topParentNavs.entries()) {
      if (!topNav.isConnected) continue;
      const propertiesPanel = topNav.querySelector<HTMLElement>('.tps-gcm-top-properties-panel');
      if (!propertiesPanel) {
        this.applyAuxElementVisibility(topNav, shouldHide);
      }
    }
    for (const el of this.bottomParentNavs.values()) {
      if (el.isConnected) this.applyAuxElementVisibility(el, shouldHide);
    }
    for (const el of this.noteReferencesPanels.values()) {
      if (el.isConnected) this.applyInlinePanelVisibility(el);
    }
  }

  /**
   * Ensure menus exist only for the active markdown view.
   * Rendering fixed menus for every markdown leaf causes off-screen overlays.
   */
  ensureMenus(): void {
    if (!this.plugin?.app?.workspace) return;
    this.updateMobileBottomOffsets();

    if (!this.plugin.settings.enableInlinePersistentMenus) {
      for (const view of Array.from(this.menus.keys())) {
        this.cleanup(view);
      }
      for (const view of Array.from(this.inlineSubitemsPanels.keys())) {
        this.removeInlineSubitemsPanel(view);
      }
      for (const view of Array.from(this.noteReferencesPanels.keys())) {
        this.removeNoteReferencesPanel(view);
      }
      for (const view of Array.from(this.noteGraphPanels.keys())) {
        this.removeNoteGraphPanel(view);
      }
      for (const view of Array.from(this.titleIcons.keys())) {
        this.removeInlineTitleIcon(view);
      }
      for (const view of Array.from(this.topParentNavs.keys())) {
        this.removeTopParentNav(view);
      }
      for (const view of Array.from(this.bottomParentNavs.keys())) {
        this.removeBottomParentNav(view);
      }
      for (const view of Array.from(this.linkedContextPanels.keys())) {
        this.removeLinkedContextPanel(view);
      }
      return;
    }

    const activeViews = new Set<MarkdownView>();
    const targetView = resolvePrimaryMarkdownView(this.plugin.app);

    if (targetView && isCompatibleMarkdownView(targetView)) {
      this.reconcileViewModeTransition(targetView);
      activeViews.add(targetView);
      try {
        this.ensureReadingMenu(targetView);
      } catch (error) {
        logger.error('[TPS GCM] Failed to ensure reading menu:', error);
      }
      try {
        this.ensureLiveMenu(targetView);
      } catch (error) {
        logger.error('[TPS GCM] Failed to ensure live menu:', error);
      }
      try {
        this.removeInlineSubitemsPanel(targetView);
        this.removeNoteGraphPanel(targetView);
        this.removeNoteReferencesPanel(targetView);
      } catch (error) {
        logger.error('[TPS GCM] Failed to remove retired inline panels:', error);
      }
      try {
        this.plugin.noteTitleRenderService?.scheduleInlineTitleRefresh?.(targetView);
        this.ensureInlineTitleIcon(targetView);
      } catch (error) {
        logger.error('[TPS GCM] Failed to ensure inline title icon:', error);
      }
      try {
        this.ensureTopParentNav(targetView);
      } catch (error) {
        logger.error('[TPS GCM] Failed to ensure top parent nav:', error);
      }
      void this.ensureLinkedContextPanel(targetView);
    }

    if (targetView) {
      this.removeGlobalStraysOutsideTarget(targetView);
    }

    // Clean up menus for views that no longer exist
    for (const view of Array.from(this.menus.keys())) {
      if (!activeViews.has(view)) {
        this.cleanup(view);
      }
    }

    for (const view of Array.from(this.inlineSubitemsPanels.keys())) {
      if (!activeViews.has(view)) {
        this.removeInlineSubitemsPanel(view);
      }
    }

    for (const view of Array.from(this.noteReferencesPanels.keys())) {
      if (!activeViews.has(view)) {
        this.removeNoteReferencesPanel(view);
      }
    }

    for (const view of Array.from(this.noteGraphPanels.keys())) {
      if (!activeViews.has(view)) {
        this.removeNoteGraphPanel(view);
      }
    }

    for (const view of Array.from(this.titleIcons.keys())) {
      if (!activeViews.has(view)) {
        this.removeInlineTitleIcon(view);
      }
    }
    for (const view of Array.from(this.topParentNavs.keys())) {
      if (!activeViews.has(view)) {
        this.removeTopParentNav(view);
      }
    }
    for (const view of Array.from(this.bottomParentNavs.keys())) {
      if (!activeViews.has(view)) {
        this.removeBottomParentNav(view);
      }
    }
    for (const view of Array.from(this.linkedContextPanels.keys())) {
      if (!activeViews.has(view)) this.removeLinkedContextPanel(view);
    }
  }

  private removeLinkedContextPanel(view: MarkdownView): void {
    this.linkedContextRequestIds.set(view, (this.linkedContextRequestIds.get(view) || 0) + 1);
    const mounted = this.linkedContextPanels.get(view);
    mounted?.component.unload();
    mounted?.el.remove();
    this.linkedContextPanels.delete(view);
    view.contentEl?.querySelectorAll<HTMLElement>('.tps-gcm-linked-context-panel').forEach((el) => el.remove());
  }

  private async ensureLinkedContextPanel(view: MarkdownView): Promise<void> {
    const file = view.file;
    if (!this.plugin.settings.enableLinkedContextPanel || !(file instanceof TFile)) {
      this.removeLinkedContextPanel(view);
      return;
    }
    const requestId = (this.linkedContextRequestIds.get(view) || 0) + 1;
    this.linkedContextRequestIds.set(view, requestId);
    try {
      const items = await this.linkedContextService.collect(file);
      if (this.linkedContextRequestIds.get(view) !== requestId || view.file?.path !== file.path) return;
      if (items.length === 0) {
        this.removeLinkedContextPanel(view);
        return;
      }
      const signature = `${file.path}:${this.plugin.settings.linkedContextPlacement}:${this.plugin.settings.linkedContextOpenBehavior}:${items.map((item) => `${item.id}:${item.sourceFile.stat.mtime}`).join('|')}`;
      const current = this.linkedContextPanels.get(view);
      if (current?.signature === signature && current.el.isConnected) return;
      this.removeLinkedContextPanel(view);

      const placement = this.plugin.settings.linkedContextPlacement === 'top' ? 'top' : 'bottom';
      const anchor = placement === 'top' ? this.resolveInlineSubitemsAnchor(view) : null;
      const parent = anchor?.parent || this.resolveNoteFooterParent(view);
      if (!parent) return;
      const component = new Component();
      component.load();
      const panel = document.createElement('section');
      panel.className = `tps-gcm-linked-context-panel tps-gcm-linked-context-panel--${placement}`;
      panel.contentEditable = 'false';
      panel.setAttribute('aria-label', 'Linked context');
      panel.createEl('h4', { text: 'Linked context', cls: 'tps-gcm-linked-context-heading' });
      for (const item of items) await this.renderLinkedContextItem(panel, component, item, file);
      if (anchor) anchor.parent.insertBefore(panel, anchor.reference);
      else parent.appendChild(panel);
      this.linkedContextPanels.set(view, { el: panel, component, signature });
    } catch (error) {
      logger.warn('[TPS GCM] Failed to render linked context', { file: file.path, error });
    }
  }

  private async renderLinkedContextItem(
    panel: HTMLElement,
    component: Component,
    item: LinkedContextItem,
    targetFile: TFile,
  ): Promise<void> {
    const card = panel.createDiv({ cls: 'tps-gcm-linked-context-card' });
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Open source ${item.sourceFile.basename}, line ${item.startLine + 1}`);
    const meta = card.createDiv({ cls: 'tps-gcm-linked-context-meta' });
    meta.createSpan({ text: item.sourceFile.basename, cls: 'tps-gcm-linked-context-source' });
    meta.createSpan({ text: item.kind === 'note' ? 'whole note' : item.kind, cls: 'tps-gcm-linked-context-kind' });
    const body = card.createDiv({ cls: 'tps-gcm-linked-context-body' });
    await MarkdownRenderer.render(this.plugin.app, item.markdown || '\n', body, item.sourceFile.path, component);

    const activate = (event: MouseEvent | KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.plugin.settings.linkedContextOpenBehavior === 'hover-preview') {
        this.plugin.app.workspace.trigger('hover-link', {
          event,
          source: 'tps-global-context-menu-linked-context',
          hoverParent: this.plugin.app.workspace.activeLeaf || this.plugin.app.workspace.getMostRecentLeaf(),
          targetEl: card,
          linktext: item.sourceFile.path,
          sourcePath: targetFile.path,
        });
        return;
      }
      void this.openLinkedContextSource(item);
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') activate(event);
    });
    if (this.plugin.settings.linkedContextOpenBehavior === 'hover-preview') {
      card.addEventListener('mouseenter', (event) => activate(event));
      card.addEventListener('focus', (event) => activate(event as unknown as KeyboardEvent));
    }
  }

  private async openLinkedContextSource(item: LinkedContextItem): Promise<void> {
    const newTab = this.plugin.settings.linkedContextOpenBehavior === 'new-tab';
    let opened = false;
    if (newTab) {
      const newLeaf = this.plugin.app.workspace.getLeaf('tab');
      await newLeaf.openFile(item.sourceFile, { active: true });
      this.plugin.app.workspace.revealLeaf(newLeaf);
      opened = true;
    } else {
      opened = await this.plugin.openFileInLeaf(
        item.sourceFile,
        false,
        () => this.plugin.app.workspace.getLeaf(false),
        { revealLeaf: true },
      );
    }
    if (!opened) return;
    const leaf = this.plugin.findOpenLeafForFile(item.sourceFile) ?? this.plugin.app.workspace.activeLeaf;
    const sourceView = leaf?.view;
    if (!(sourceView instanceof MarkdownView)) return;
    sourceView.editor.setCursor({ line: item.startLine, ch: 0 });
    sourceView.editor.focus();
    sourceView.editor.scrollIntoView?.({
      from: { line: item.startLine, ch: 0 },
      to: { line: Math.max(item.startLine + 1, item.endLine), ch: 0 },
    }, true);
  }

  public getViewModeSignature(view: MarkdownView): string {
    const mode = getViewMode(view) || 'unknown';
    const state = typeof (view as any)?.getState === 'function' ? (view as any).getState() : {};
    const sourceFlag = state?.source === true ? 'strict' : 'live';
    const hasSource = !!view.contentEl?.querySelector('.markdown-source-view');
    const hasPreview = !!view.contentEl?.querySelector('.markdown-preview-view');
    const livePreview = !!view.contentEl?.querySelector('.markdown-source-view.is-live-preview');
    return `${mode}:${sourceFlag}:source=${hasSource ? 1 : 0}:preview=${hasPreview ? 1 : 0}:live=${livePreview ? 1 : 0}`;
  }

  public handleViewModeMaybeChanged(view: MarkdownView): void {
    if (!isCompatibleMarkdownView(view)) return;
    const previous = this.viewModeSignatures.get(view);
    const current = this.getViewModeSignature(view);
    if (previous === current) return;
    this.viewModeSignatures.set(view, current);
    this.prepareForViewModeTransition(view);
    this.scheduleAttachRetry(view, 120);
  }

  private reconcileViewModeTransition(view: MarkdownView): void {
    const previous = this.viewModeSignatures.get(view);
    const current = this.getViewModeSignature(view);
    if (!previous) {
      this.viewModeSignatures.set(view, current);
      return;
    }
    if (previous === current) return;
    this.viewModeSignatures.set(view, current);
    this.prepareForViewModeTransition(view);
    this.scheduleAttachRetry(view, 120);
  }

  private prepareForViewModeTransition(view: MarkdownView): void {
    this.clearAttachRetry(view);
    this.detachNativePropertyObserver(view);
    this.detachGeometryObserver(view);
  }

  private removeGlobalStraysOutsideTarget(targetView: MarkdownView | null): void {
    const targetRoot = targetView?.contentEl || null;
    const targetContainer = ((targetView as any)?.containerEl as HTMLElement | undefined) || null;
    // Live preview panels live in document.body â€” keep the one owned by the target view
    const ownedBodyPanel = targetView ? (this.inlineSubitemsPanels.get(targetView) ?? null) : null;

    const removeIfOutsideTarget = (selector: string) => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
      for (const node of nodes) {
        if (node === ownedBodyPanel) continue; // keep live preview panel in body
        if (targetRoot && targetRoot.contains(node)) continue;
        if (targetContainer && targetContainer.contains(node)) continue;
        node.remove();
      }
    };

    removeIfOutsideTarget('.tps-global-context-menu--persistent');
    removeIfOutsideTarget('.tps-gcm-subitems-panel--title-inline');
    removeIfOutsideTarget('.tps-gcm-note-title-icon');
  }

  private scheduleAttachRetry(view: MarkdownView, delayMs: number = 120): void {
    if (this.attachRetryTimers.has(view)) return;

    const timerId = window.setTimeout(() => {
      this.attachRetryTimers.delete(view);

      const leaves = this.plugin.app.workspace.getLeavesOfType('markdown');
      const stillPresent = leaves.some((leaf) => leaf.view === view);
      if (!stillPresent) {
        this.cleanup(view);
        return;
      }
      this.ensureMenus();
    }, Math.max(40, delayMs));

    this.attachRetryTimers.set(view, timerId);
  }

  private clearAttachRetry(view: MarkdownView): void {
    const timerId = this.attachRetryTimers.get(view);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      this.attachRetryTimers.delete(view);
    }
  }

  /**
   * Ensure reading mode menu exists
   */
  ensureReadingMenu(view: MarkdownView): void {
    if (!isCompatibleMarkdownView(view)) return;

    const file = view.file;
    if (file instanceof TFile && this.fileMatchesIgnoreRules(file, this.plugin.settings.inlineMenu_IgnoreRules)) {
      this.removeReadingMenu(view);
      return;
    }

    const mode = getViewMode(view);
    // Strict mode check: Only show in Preview mode
    if (mode !== 'preview') {
      this.removeReadingMenu(view);
      return;
    }

    // Robustly find the preview view container
    const previewView = view.contentEl?.querySelector('.markdown-preview-view');

    if (!previewView) {
      this.scheduleAttachRetry(view, 120);
      return;
    }

    const instances = this.menus.get(view) || {};
    const mobileHost = this.resolveMobileMenuHost(view);
    const attachContainer = mobileHost ?? (previewView as HTMLElement);
    attachContainer.toggleClass('tps-gcm-mobile-menu-host', !!mobileHost);

    // Defensive cleanup: remove any stray persistent menus in this container
    this.removeStrayMenus(attachContainer, 'reading', instances.reading ?? null);

    // Check if file path matches - if not, remove old menu
    if (instances.reading && instances.filePath !== view.file?.path) {
      this.removeReadingMenu(view);
    } else if (instances.reading && attachContainer.contains(instances.reading)) {
      // Valid menu already exists and is attached
      this.ensureBottomParentNav(view, instances.reading);
      this.applyPersistentMenuGeometry(view, instances.reading);
      this.applyMenuVisibility(instances.reading);
      this.ensureSwipeGestureTracking(view);
      this.attachGeometryObserver(view);
      return;
    }

    this.removeReadingMenu(view);

    const menu = this.createPersistentMenu(view, 'reading');
    if (menu) {
      this.ensureBottomParentNav(view, menu);
      attachContainer.appendChild(menu);
      this.applyPersistentMenuGeometry(view, menu);
      this.applyMenuVisibility(menu);
      instances.reading = menu;
      instances.filePath = view.file.path; // Track which file this menu belongs to
      this.menus.set(view, instances);
      this.ensureSwipeGestureTracking(view);
      this.attachGeometryObserver(view);
    }
  }

  /**
   * Ensure live preview menu exists
   */
  ensureLiveMenu(view: MarkdownView): void {
    if (!isCompatibleMarkdownView(view)) return;

    const file = view.file;
    if (file instanceof TFile && this.fileMatchesIgnoreRules(file, this.plugin.settings.inlineMenu_IgnoreRules)) {
      this.removeLiveMenu(view);
      return;
    }

    const mode = getViewMode(view);
    // Strict mode check: Only show in Source mode (Live Preview is a type of Source mode)
    if (mode !== 'source') {
      this.removeLiveMenu(view);
      return;
    }
    if (this.isStrictSourceMode(view)) {
      this.removeLiveMenu(view);
      return;
    }

    // Robustly find the source view container
    const sourceContainer = view.contentEl?.querySelector('.markdown-source-view');

    // Check if we are in Live Preview mode
    if (!sourceContainer) {
      this.scheduleAttachRetry(view, 120);
      return;
    }

    const instances = this.menus.get(view) || {};
    const mobileHost = this.resolveMobileMenuHost(view);
    const attachContainer = mobileHost ?? sourceContainer;
    attachContainer.toggleClass('tps-gcm-mobile-menu-host', !!mobileHost);

    // Defensive cleanup: remove any stray persistent menus in this container
    this.removeStrayMenus(attachContainer, 'live', instances.live ?? null);

    // Check if file path matches - if not, remove old menu
    if (instances.live && instances.filePath !== view.file?.path) {
      this.removeLiveMenu(view);
    } else if (instances.live && attachContainer.contains(instances.live)) {
      // Valid menu already exists and is attached
      this.ensureBottomParentNav(view, instances.live);
      this.applyPersistentMenuGeometry(view, instances.live);
      this.applyMenuVisibility(instances.live);
      this.ensureSwipeGestureTracking(view);
      this.attachGeometryObserver(view);
      if (!this.liveResizeObservers.has(view)) {
        this.attachLiveHeightObserver(view, instances.live, null);
      }
      return;
    }

    this.removeLiveMenu(view);

    const menu = this.createPersistentMenu(view, 'live');
    if (menu) {
      this.ensureBottomParentNav(view, menu);
      attachContainer.appendChild(menu);
      this.applyPersistentMenuGeometry(view, menu);
      this.applyMenuVisibility(menu);
      instances.live = menu;
      instances.filePath = view.file.path; // Track which file this menu belongs to
      this.menus.set(view, instances);
      this.ensureSwipeGestureTracking(view);
      this.attachGeometryObserver(view);
      this.attachLiveHeightObserver(view, menu, null);
    }
  }

  private attachGeometryObserver(view: MarkdownView): void {
    if (this.geometryResizeObservers.has(view)) return;
    if (typeof ResizeObserver !== 'function') return;

    const contentEl = view.contentEl as HTMLElement | undefined;
    const containerEl = (view as any).containerEl as HTMLElement | undefined;
    if (!contentEl && !containerEl) return;

    const applyGeometry = () => {
      const instances = this.menus.get(view);
      if (!instances) return;
      if (instances.reading?.isConnected) {
        this.applyPersistentMenuGeometry(view, instances.reading);
      }
      if (instances.live?.isConnected) {
        this.applyPersistentMenuGeometry(view, instances.live);
      }
    };

    const observer = new ResizeObserver(() => applyGeometry());
    if (contentEl) observer.observe(contentEl);
    if (containerEl && containerEl !== contentEl) observer.observe(containerEl);
    this.geometryResizeObservers.set(view, observer);
    applyGeometry();
  }

  private detachGeometryObserver(view: MarkdownView): void {
    const observer = this.geometryResizeObservers.get(view);
    if (!observer) return;
    observer.disconnect();
    this.geometryResizeObservers.delete(view);
  }

  private removeStrayMenus(
    container: ParentNode,
    mode: 'reading' | 'live',
    tracked: HTMLElement | null
  ): void {
    const selector = `.tps-global-context-menu--persistent.tps-global-context-menu--${mode}`;
    const menus = Array.from(container.querySelectorAll<HTMLElement>(selector));
    for (const menu of menus) {
      if (tracked && menu === tracked) continue;
      menu.remove();
    }
  }

  private shouldShowInlineSubitems(view: MarkdownView): boolean {
    return false;
  }

  private shouldRenderInlineNotePanels(view: MarkdownView): boolean {
    return false;
  }

  private resolveInlineSubitemsAnchor(view: MarkdownView): { parent: HTMLElement; reference: Element | null; titleEl?: Element | null } | null {
    const contentRoot = view.contentEl;
    if (!contentRoot) return null;

    const mode = getViewMode(view);
    if (!mode) return null;

    if (mode === 'preview') {
      const previewView = contentRoot.querySelector<HTMLElement>('.markdown-preview-view');
      if (!previewView) return null;
      const previewSizer = previewView.querySelector<HTMLElement>('.markdown-preview-sizer');
      if (!previewSizer) return null;

      // In reading mode the panel is in-document-flow, directly after the title.
      // Walk direct children of previewSizer to find the title/heading element.
      const directChildren = Array.from(previewSizer.children) as HTMLElement[];

      // Prefer inline-title as the anchor (Obsidian's inline-title feature)
      const inlineTitleEl = directChildren.find(
        (el) => el.classList.contains('inline-title') || el.dataset.type === 'inline-title'
      );
      if (inlineTitleEl) {
        const idx = directChildren.indexOf(inlineTitleEl);
        const nextSibling = directChildren[idx + 1] || null;
        // Skip over any existing panel that might already be there
        const refEl = (nextSibling && nextSibling.classList.contains('tps-gcm-subitems-panel'))
          ? (directChildren[directChildren.indexOf(nextSibling) + 1] || null)
          : nextSibling;
        return { parent: previewSizer, reference: refEl, titleEl: inlineTitleEl };
      }

      // Fallback: after first h1 or h2
      const firstHeading = directChildren.find(
        (el) => el.tagName === 'H1' || el.tagName === 'H2'
      );
      if (firstHeading) {
        const idx = directChildren.indexOf(firstHeading);
        const nextSibling = directChildren[idx + 1] || null;
        const refEl = (nextSibling && nextSibling.classList.contains('tps-gcm-subitems-panel'))
          ? (directChildren[directChildren.indexOf(nextSibling) + 1] || null)
          : nextSibling;
        return { parent: previewSizer, reference: refEl, titleEl: firstHeading };
      }

      // Last fallback: prepend at top of preview sizer (no title found yet, retry later)
      return {
        parent: previewSizer,
        reference: directChildren[0] || null,
        titleEl: null,
      };
    }

    if (mode === 'source') {
      const sourceView = contentRoot.querySelector<HTMLElement>('.markdown-source-view');
      if (!sourceView) return null;

      const sizer = sourceView.querySelector<HTMLElement>('.cm-sizer') ||
        sourceView.querySelector<HTMLElement>('.cm-content');

      if (!sizer) return null;

      // Search for the Inline Title within the CodeMirror sizer/content
      const inlineTitleEl =
        sizer.querySelector<HTMLElement>('.inline-title') ||
        sizer.querySelector<HTMLElement>('.cm-line.inline-title');

      if (inlineTitleEl) {
        // If we found the title, we want to insert AFTER it.
        // Note for CodeMirror: We are inserting into the DOM managed by CM.
        // This is visually correct but might be fragile. 
        // We anchor to the parent container (.cm-sizer usually)
        return {
          parent: inlineTitleEl.parentElement as HTMLElement,
          reference: inlineTitleEl.nextElementSibling, // Insert before the next sibling (line 1)
          titleEl: inlineTitleEl
        };
      }

      // Fallback: no inline title found? Prepend to top of sizer
      return {
        parent: sizer,
        reference: sizer.firstElementChild,
        titleEl: null
      };
    }

    return null;
  }

  private resolveNoteFooterParent(view: MarkdownView): HTMLElement | null {
    const contentRoot = view.contentEl;
    if (!contentRoot) return null;

    const mode = getViewMode(view);
    if (mode === 'preview') {
      return contentRoot.querySelector<HTMLElement>('.markdown-preview-view .markdown-preview-sizer');
    }

    if (mode === 'source') {
      // In live preview, prefer mounting under CM content so we can place references
      // relative to the last rendered line (instead of viewport bottom).
      const hostRoot =
        contentRoot.querySelector<HTMLElement>('.cm-content') ||
        contentRoot.querySelector<HTMLElement>('.cm-sizer') ||
        contentRoot.querySelector<HTMLElement>('.cm-contentContainer') ||
        contentRoot.querySelector<HTMLElement>('.cm-scroller');
      if (!hostRoot) return null;

      let footerHost = hostRoot.querySelector<HTMLElement>(':scope > .tps-gcm-note-footer-host');
      if (!footerHost) {
        footerHost = document.createElement('div');
        footerHost.className = 'tps-gcm-note-footer-host';
        hostRoot.appendChild(footerHost);
      }
      // CRITICAL: Prevent CodeMirror from parsing our DOM nodes as user-typed text
      footerHost.contentEditable = 'false';
      return footerHost;
    }

    return null;
  }

  private resolveNoteGraphHost(view: MarkdownView): HTMLElement | null {
    const contentRoot = view.contentEl;
    if (!contentRoot) return null;

    const mode = getViewMode(view);
    if (mode === 'preview') {
      return contentRoot.querySelector<HTMLElement>('.markdown-preview-view .markdown-preview-sizer')
        || contentRoot.querySelector<HTMLElement>('.markdown-preview-view');
    }

    if (mode === 'source') {
      const sourceView = contentRoot.querySelector<HTMLElement>('.markdown-source-view');
      if (!sourceView) return null;
      return sourceView.querySelector<HTMLElement>('.cm-sizer')
        || sourceView.querySelector<HTMLElement>('.cm-contentContainer')
        || sourceView.querySelector<HTMLElement>('.cm-scroller')
        || sourceView;
    }

    return null;
  }

  private positionNoteGraphPanel(view: MarkdownView, panel: HTMLElement, host: HTMLElement): void {
    const titleEl = this.resolveInlineTitleElement(view);
    window.requestAnimationFrame(() => {
      if (!panel.isConnected || !host.isConnected) return;
      const hostRect = host.getBoundingClientRect();
      const titleRect = titleEl?.getBoundingClientRect();
      const top = titleRect
        ? Math.max(8, Math.round(titleRect.top - hostRect.top))
        : 12;
      panel.style.top = `${top}px`;
      panel.style.right = '12px';
    });
  }

  private resolveMenuHostRect(view: MarkdownView, menuEl: HTMLElement): DOMRect | null {
    const root = view.contentEl;
    if (!root) return null;

    let hostEl: HTMLElement | null = null;
    if (menuEl.classList.contains('tps-global-context-menu--reading')) {
      hostEl =
        root.querySelector<HTMLElement>('.markdown-preview-view') ||
        root.querySelector<HTMLElement>('.markdown-preview-sizer');
    } else {
      hostEl =
        root.querySelector<HTMLElement>('.markdown-source-view.is-live-preview') ||
        root.querySelector<HTMLElement>('.markdown-source-view');
    }

    const el = hostEl || root;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    // If readable line width is active, clamp the rect to the content width.
    const isReadable =
      root.classList.contains('is-readable-line-width') ||
      root.querySelector('.is-readable-line-width') !== null;

    if (isReadable) {
      const computed = getComputedStyle(root);
      const fileLineWidth = computed.getPropertyValue('--file-line-width')?.trim();
      const lineWidthVar = computed.getPropertyValue('--line-width')?.trim();
      const rawValue = fileLineWidth || lineWidthVar;

      if (rawValue) {
        const parsed = parseFloat(rawValue);
        if (parsed > 0 && parsed < rect.width) {
          const centerX = rect.left + rect.width / 2;
          return new DOMRect(centerX - parsed / 2, rect.top, parsed, rect.height);
        }
      }
    }

    return rect;
  }

  private isMobileLayout(): boolean {
    return Platform.isMobile
      || Platform.isPhone
      || Platform.isTablet
      || document.body.classList.contains('is-mobile')
      || document.body.classList.contains('is-phone');
  }

  private resolveMobileMenuHost(view: MarkdownView): HTMLElement | null {
    if (!this.isMobileLayout()) return null;
    const contentEl = view.contentEl as HTMLElement | undefined;
    const containerEl = (view as any).containerEl as HTMLElement | undefined;
    if (!contentEl?.isConnected) return null;

    const host =
      containerEl?.closest<HTMLElement>('.workspace-leaf-content')
      || contentEl.closest<HTMLElement>('.workspace-leaf-content')
      || containerEl
      || contentEl;
    return host?.isConnected ? host : null;
  }

  private applyPersistentMenuGeometry(view: MarkdownView, menuEl: HTMLElement): void {
    const hostRect = this.resolveMenuHostRect(view, menuEl);
    if (!hostRect || hostRect.width <= 0) return;

    const horizontalPadding = 12;
    const availableWidth = Math.max(120, Math.floor(hostRect.width - horizontalPadding * 2));
    const maxWidth = availableWidth;
    menuEl.style.setProperty('--tps-gcm-pane-width', `${maxWidth}px`);
    menuEl.style.setProperty('--tps-inline-bar-width', `${maxWidth}px`);

    const isReadingMenu = menuEl.classList.contains('tps-global-context-menu--reading');
    const offsetX = isReadingMenu ? 0 : Math.round(this.plugin.settings?.liveMenuOffsetX ?? 0);
    // Apply vertical offset to both reading + live persistent bars.
    let offsetY = Math.round(this.plugin.settings?.liveMenuOffsetY ?? 0);

    // Note: the subitems panel sits BELOW the context menu bar via flexbox order â€” no offsetY adjustment needed here.
    const position = isReadingMenu ? 'center' : (this.plugin.settings?.liveMenuPosition || 'center');

    // Only restore visibility if not gesture-collapsed AND not keyboard-suppressed.
    // Do NOT restore visibility when the keyboard is up or anticipated: the ResizeObserver
    // fires this method continuously during the keyboard animation and would fight the
    // keyboard-hidden state, causing the menu to flash visible as the keyboard slides in.
    if (!this.swipeCollapsed && !this.shouldHideForKeyboard()) {
      menuEl.style.visibility = 'visible';
      menuEl.style.opacity = '1';
      menuEl.style.pointerEvents = 'auto';
    }

    if (menuEl.classList.contains('tps-global-context-menu--mobile-pane')) {
      menuEl.style.position = 'absolute';
      menuEl.style.left = 'max(10px, env(safe-area-inset-left, 0px))';
      menuEl.style.right = 'max(10px, env(safe-area-inset-right, 0px))';
      menuEl.style.bottom = 'calc(58px + env(safe-area-inset-bottom, 0px))';
      menuEl.style.top = 'auto';
      menuEl.style.width = 'auto';
      menuEl.style.maxWidth = 'none';
      menuEl.style.minWidth = '0';
      menuEl.style.transform = 'none';
      menuEl.style.zIndex = '100002';
      return;
    }

    const leftEdge = Math.max(0, Math.round(hostRect.left + horizontalPadding));
    const rightEdge = Math.max(leftEdge, Math.round(hostRect.right - horizontalPadding));
    const centerX = Math.round(hostRect.left + hostRect.width / 2);

    // Always span the active note pane width; this keeps the bar visible in split layouts.
    const effectiveWidth = maxWidth;
    menuEl.style.width = `${effectiveWidth}px`;
    menuEl.style.maxWidth = `${effectiveWidth}px`;
    menuEl.style.minWidth = `${Math.min(220, effectiveWidth)}px`;

    let desiredLeft: number;
    if (position === 'left') {
      desiredLeft = leftEdge + offsetX;
    } else if (position === 'right') {
      desiredLeft = rightEdge - effectiveWidth + offsetX;
    } else {
      desiredLeft = centerX - effectiveWidth / 2 + offsetX;
    }

    const minLeft = leftEdge;
    const maxLeft = Math.max(leftEdge, rightEdge - effectiveWidth);
    const clampedLeft = Math.min(Math.max(desiredLeft, minLeft), maxLeft);

    const targetViewportLeft = Math.round(clampedLeft);
    menuEl.style.left = `${targetViewportLeft}px`;
    menuEl.style.right = 'auto';
    if (this.keyboardVisible && Platform.isMobile) {
      // Keyboard visible: anchor to viewport top for unobstructed interaction.
      const vv = window.visualViewport;
      const topAnchor = Math.round((vv?.offsetTop ?? 0) + 8);
      menuEl.style.top = `${Math.max(0, topAnchor)}px`;
      menuEl.style.bottom = 'auto';
      menuEl.style.transform = 'translate(0px, 0px)';
    } else {
      menuEl.style.top = 'auto';
      menuEl.style.bottom = this.isMobileLayout()
        ? 'calc(max(var(--tps-auto-base-embed-bottom, var(--tps-gcm-live-bottom, 16px)), var(--tps-gcm-mobile-toolbar-offset, clamp(112px, 13vh, 176px))) + env(safe-area-inset-bottom, 0px) + var(--tps-auto-base-embed-height, 0px) + 8px)'
        : 'calc(max(var(--tps-auto-base-embed-bottom, var(--tps-gcm-live-bottom, 16px)), var(--tps-gcm-mobile-toolbar-offset, 0px)) + env(safe-area-inset-bottom, 0px) + var(--tps-auto-base-embed-height, 0px) + 8px)';
      menuEl.style.transform = `translate(0px, ${offsetY}px)`;
    }

    // Obsidian pane/layout transforms can change the coordinate space for fixed elements.
    // Calibrate once so the final rendered left edge matches the intended viewport position.
    const renderedRect = menuEl.getBoundingClientRect();
    if (renderedRect.width > 0) {
      const delta = targetViewportLeft - renderedRect.left;
      if (Math.abs(delta) > 1) {
        menuEl.style.left = `${Math.round(targetViewportLeft + delta)}px`;
      }
    }
  }

  private resolveInlineTitleElement(view: MarkdownView): HTMLElement | null {
    const contentRoot = view.contentEl;
    if (!contentRoot) return null;
    const scopedInlineTitle = () => (
      contentRoot.querySelector<HTMLElement>(':scope > .inline-title')
      || contentRoot.querySelector<HTMLElement>('.inline-title')
    );

    const mode = getViewMode(view);
    if (!mode) return null;
    if (mode === 'preview') {
      const previewView = contentRoot.querySelector<HTMLElement>('.markdown-preview-view');
      if (!previewView) return scopedInlineTitle();
      const previewSizer =
        previewView.querySelector<HTMLElement>('.markdown-preview-sizer') ||
        previewView;
      const inlineTitle =
        previewSizer.querySelector<HTMLElement>(':scope > .inline-title') ||
        previewSizer.querySelector<HTMLElement>('.inline-title');
      if (inlineTitle) return inlineTitle;

      const mobileInlineTitle = scopedInlineTitle();
      if (mobileInlineTitle) return mobileInlineTitle;

      // Fallback when inline title is disabled: use the first heading as visual title.
      return (
        previewSizer.querySelector<HTMLElement>(':scope > h1') ||
        previewSizer.querySelector<HTMLElement>('h1')
      );
    }

    if (mode === 'source') {
      const sourceView = contentRoot.querySelector<HTMLElement>('.markdown-source-view');
      if (!sourceView) return scopedInlineTitle();

      const inlineTitleInSourceView =
        sourceView.querySelector<HTMLElement>('.inline-title') ||
        sourceView.querySelector<HTMLElement>('.cm-line.inline-title');
      if (inlineTitleInSourceView) return inlineTitleInSourceView;

      const sourceSizer =
        sourceView.querySelector<HTMLElement>('.cm-content') ||
        sourceView.querySelector<HTMLElement>('.cm-sizer') ||
        sourceView;

      const inlineTitle =
        sourceSizer.querySelector<HTMLElement>(':scope > .cm-line.inline-title') ||
        sourceSizer.querySelector<HTMLElement>('.cm-line.inline-title') ||
        sourceSizer.querySelector<HTMLElement>('.inline-title');
      if (inlineTitle) return inlineTitle;

      const headingToken = sourceSizer.querySelector<HTMLElement>('.cm-line.HyperMD-header-1, .cm-line .cm-header-1');
      const headingLine = headingToken?.classList.contains('cm-line')
        ? headingToken
        : headingToken?.closest<HTMLElement>('.cm-line');
      if (headingLine) return headingLine;

      const containerEl = (view as any)?.containerEl as HTMLElement | undefined;
      const fallbackInlineTitle =
        containerEl?.querySelector<HTMLElement>('.inline-title') ||
        scopedInlineTitle();
      return fallbackInlineTitle || null;
    }

    return null;
  }

  private getFrontmatterValueCaseInsensitive(frontmatter: Record<string, any>, key: string): any {
    const normalized = String(key || '').trim().toLowerCase();
    if (!normalized) return undefined;
    const match = Object.keys(frontmatter || {}).find((candidate) => candidate.toLowerCase() === normalized);
    return match ? frontmatter[match] : undefined;
  }

  private resolveTitleIconColor(frontmatter: Record<string, any>, file?: TFile): string {
    // First, prefer explicit frontmatter color values.
    const colorKeys = ['iconColor', 'color', 'accentColor', 'accent'];
    for (const key of colorKeys) {
      const raw = this.getFrontmatterValueCaseInsensitive(frontmatter, key);
      if (typeof raw !== 'string') continue;
      const value = raw.trim();
      if (!value) continue;
      const cssColor = this.normalizeCssColorValue(value);
      if (cssColor) return cssColor;
    }

    if (file) {
      const ruleColor = this.resolveNotebookNavigatorRuleColor(file, frontmatter);
      if (ruleColor) {
        return ruleColor;
      }
    }
    return '';
  }

  private resolveNotebookNavigatorRuleColor(file: TFile, frontmatter: Record<string, any>): string {
    try {
      const visual = this.plugin.notebookNavigatorRuleService.getVisualOutputsForFile(file, frontmatter);
      const colorValue = String(visual?.color?.value || '').trim();
      if (colorValue) {
        const cssColor = this.normalizeCssColorValue(colorValue);
        if (cssColor) return cssColor;
      }
    } catch (error) {
      logger.warn('[TPS GCM] Failed resolving Notebook Navigator rule color for inline title:', file.path, error);
    }
    return '';
  }

  private normalizeCssColorValue(rawValue: string): string {
    const value = String(rawValue || '').trim();
    if (!value || /[<>{}\n\r;]/.test(value)) return '';
    const bareHex = value.match(/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
    if (bareHex) return `#${bareHex[1]}`;
    if (value.startsWith('var(')) return value;
    try {
      if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', value)) {
        return value;
      }
    } catch {
      // Fall through.
    }
    return '';
  }

  private resolveInlineTitleIconValue(file: TFile, frontmatter: Record<string, any>): string {
    const pickString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

    // First, check the icon field
    const fromIconField = pickString(frontmatter?.icon);
    if (fromIconField) return fromIconField;

    // Then, check Notebook Navigator configured icon field and GCM-owned rules.
    const configuredIconField = pickString(this.plugin.settings.notebookNavigatorRules?.frontmatterIconField);
    if (configuredIconField) {
      const configuredValue = pickString(this.getFrontmatterValueCaseInsensitive(frontmatter, configuredIconField));
      if (configuredValue) return configuredValue;
    }

    try {
      const visual = this.plugin.notebookNavigatorRuleService.getVisualOutputsForFile(file, frontmatter);
      const ruleIcon = pickString(visual?.icon?.value);
      if (ruleIcon) return ruleIcon;
    } catch (error) {
      logger.warn('[TPS GCM] Failed resolving Notebook Navigator rule icon for inline title:', file.path, error);
    }

    return '';
  }

  private renderInlineTitleIcon(iconEl: HTMLElement, iconValue: string, file: TFile): void {
    iconEl.classList.remove('tps-gcm-note-title-icon--emoji');
    iconEl.textContent = '';

    const normalized = String(iconValue || '').trim();
    if (normalized && /[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u.test(normalized)) {
      iconEl.textContent = normalized;
      iconEl.classList.add('tps-gcm-note-title-icon--emoji');
      return;
    }

    const normalizedIconName = normalized.replace(/^(lucide|icon):/i, '').trim();

    try {
      setIcon(iconEl, normalizedIconName || 'file-text');
      if (!iconEl.querySelector('svg')) {
        setIcon(iconEl, 'file-text');
      }
    } catch {
      setIcon(iconEl, file.extension?.toLowerCase() === 'md' ? 'file-text' : 'paperclip');
    }
  }

  refreshInlineTitleIcon(view: MarkdownView): void {
    this.ensureInlineTitleIcon(view);
  }

  private ensureInlineTitleIcon(view: MarkdownView): void {
    if (!this.plugin.settings.enableInlinePersistentMenus) {
      this.removeInlineTitleIcon(view);
      return;
    }
    const file = view.file;
    if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') {
      this.removeInlineTitleIcon(view);
      return;
    }

    if (isStrictSourceMode(view)) {
      this.removeInlineTitleIcon(view);
      return;
    }

    const titleEl = this.resolveInlineTitleElement(view);
    if (!titleEl) {
      this.removeInlineTitleIcon(view);
      return;
    }
    if (document.activeElement instanceof HTMLElement && titleEl.contains(document.activeElement)) return;

    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter || {}) as Record<string, any>;
    const resolvedIconValue = this.resolveInlineTitleIconValue(file, frontmatter);
    const resolvedIcon = resolvedIconValue || 'file-text';
    const resolvedColor = this.resolveTitleIconColor(frontmatter, file);

    const existing = this.titleIcons.get(view) || null;
    if (
      existing &&
      existing.isConnected &&
      existing.parentElement === titleEl &&
      existing.dataset.filePath === file.path &&
      existing.dataset.iconValue === resolvedIcon &&
      (existing.dataset.iconColor || '') === resolvedColor
    ) {
      if (titleEl.firstElementChild !== existing) {
        titleEl.prepend(existing);
      }
      return;
    }

    this.removeInlineTitleIcon(view);

    const iconEl = document.createElement('span');
    iconEl.className = 'tps-gcm-note-title-icon';
    iconEl.dataset.filePath = file.path;
    iconEl.dataset.iconValue = resolvedIcon;
    iconEl.dataset.iconColor = resolvedColor;
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.setAttribute('contenteditable', 'false');
    iconEl.setAttribute('draggable', 'false');
    if (resolvedColor) {
      iconEl.style.color = resolvedColor;
    } else {
      iconEl.style.removeProperty('color');
    }
    this.renderInlineTitleIcon(iconEl, resolvedIcon, file);
    titleEl.prepend(iconEl);
    this.titleIcons.set(view, iconEl);
  }

  private removeInlineTitleIcon(view: MarkdownView): void {
    const iconEl = this.titleIcons.get(view);
    if (iconEl) {
      iconEl.remove();
      this.titleIcons.delete(view);
    }

    const titleEl = this.resolveInlineTitleElement(view);
    titleEl?.querySelectorAll('.tps-gcm-note-title-icon').forEach((node) => node.remove());
    view.contentEl?.querySelectorAll('.tps-gcm-note-title-icon').forEach((node) => node.remove());
  }

  private getDirectLinks(file: TFile): { incoming: TFile[], outgoing: TFile[] } {
    const app = this.plugin.app;

    // Outgoing
    const resolvedLinks = app.metadataCache.resolvedLinks[file.path] || {};
    const outgoingPaths = Object.keys(resolvedLinks);
    const outgoing: TFile[] = [];
    for (const p of outgoingPaths) {
      if (p === file.path) continue; // skip self-references
      const f = app.vault.getAbstractFileByPath(p);
      if (f instanceof TFile) outgoing.push(f);
    }

    // Incoming
    const allLinks = app.metadataCache.resolvedLinks || {};
    const incoming: TFile[] = [];
    for (const sourcePath in allLinks) {
      if (sourcePath === file.path) continue;
      if (allLinks[sourcePath][file.path] !== undefined) {
        const f = app.vault.getAbstractFileByPath(sourcePath);
        if (f instanceof TFile) incoming.push(f);
      }
    }

    outgoing.sort((a, b) => this.getFileDisplayTitle(a).localeCompare(this.getFileDisplayTitle(b)));
    incoming.sort((a, b) => this.getFileDisplayTitle(a).localeCompare(this.getFileDisplayTitle(b)));

    return { incoming, outgoing };
  }

  private getFrontmatterLinkLabel(sourceFile: TFile, targetFile: TFile): string | null {
    const frontmatter = (this.plugin.app.metadataCache.getFileCache(sourceFile)?.frontmatter || {}) as Record<string, any>;
    for (const [key, value] of Object.entries(frontmatter)) {
      if (key === 'position') continue;
      if (this.frontmatterValueLinksToFile(value, sourceFile.path, targetFile)) {
        return key;
      }
    }
    return null;
  }

  private frontmatterValueLinksToFile(value: any, sourcePath: string, targetFile: TFile): boolean {
    if (value == null) return false;

    if (Array.isArray(value)) {
      return value.some((entry) => this.frontmatterValueLinksToFile(entry, sourcePath, targetFile));
    }

    if (typeof value === 'object') {
      return Object.values(value).some((entry) => this.frontmatterValueLinksToFile(entry, sourcePath, targetFile));
    }

    const raw = String(value).trim();
    if (!raw) return false;

    const candidates = new Set<string>();
    const addCandidate = (candidate: string | null | undefined) => {
      const normalized = String(candidate || '').trim();
      if (normalized) candidates.add(normalized);
    };

    const direct = this.resolveParentValueToFile(raw, sourcePath);
    if (direct?.path === targetFile.path) {
      return true;
    }

    const wikiMatches = raw.matchAll(/\[\[([^\]]+)\]\]/g);
    for (const match of wikiMatches) {
      addCandidate(match[1]);
    }

    const markdownMatches = raw.matchAll(/\[[^\]]*\]\(([^)]+)\)/g);
    for (const match of markdownMatches) {
      addCandidate(match[1]);
    }

    if (candidates.size === 0) {
      addCandidate(raw);
    }

    for (const candidate of candidates) {
      const resolved = this.resolveParentValueToFile(candidate, sourcePath);
      if (resolved?.path === targetFile.path) {
        return true;
      }
    }

    return false;
  }

  private isSubitemsPanelCollapsed(file: TFile, view: MarkdownView): boolean {
    const trackedPanel = this.inlineSubitemsPanels.get(view);
    if (
      trackedPanel instanceof HTMLElement &&
      trackedPanel.isConnected &&
      trackedPanel.dataset.filePath === file.path
    ) {
      return trackedPanel.classList.contains('tps-gcm-subitems-panel--collapsed');
    }
    return this.collapsedStateByPath.get(file.path) ?? false;
  }

  private renderTopLinkPopoverRow(
    popover: HTMLElement,
    linkedFile: TFile,
    sourceFile: TFile,
    direction: 'outgoing' | 'incoming',
    frontmatterKey?: string | null
  ): void {
    const row = document.createElement('button');
    row.type = 'button';
    row.style.width = '100%';
    row.style.textAlign = 'left';
    row.style.padding = '8px 10px';
    row.style.border = 'none';
    row.style.borderRadius = '8px';
    row.style.background = 'transparent';
    row.style.color = 'inherit';
    row.style.cursor = 'pointer';
    row.style.display = 'block';
    row.textContent = this.getFileDisplayTitle(linkedFile);

    row.addEventListener('mouseenter', (evt) => {
      const previewSource = direction === 'outgoing' ? sourceFile : linkedFile;
      const previewTarget = direction === 'outgoing' ? linkedFile : sourceFile;
      void this.showTopLinkPreviewCard(previewTarget, previewSource, row, evt as MouseEvent, frontmatterKey || null);
    });
    row.addEventListener('mouseleave', () => this.scheduleHideTopLinkPreviewCard(300));

    addSafeClickListener(row, (evt) => {
      const now = Date.now();
      const isSecondTap =
        this.topLinkPreviewArmedPath === linkedFile.path &&
        now <= this.topLinkPreviewArmedUntil;
      if (!isSecondTap) {
        this.topLinkPreviewArmedPath = linkedFile.path;
        this.topLinkPreviewArmedUntil = now + 8000;
        const previewSource = direction === 'outgoing' ? sourceFile : linkedFile;
        const previewTarget = direction === 'outgoing' ? linkedFile : sourceFile;
        void this.showTopLinkPreviewCard(previewTarget, previewSource, row, evt as MouseEvent, frontmatterKey || null);
        return;
      }

      this.topLinkPreviewArmedPath = null;
      this.topLinkPreviewArmedUntil = 0;
      this.hideTopLinkPreviewCard();
      this.hideTopLinksPopover();
      void this.plugin.openFileInLeaf(linkedFile, false, () => this.plugin.app.workspace.getLeaf(false), { revealLeaf: true });
    });

    popover.appendChild(row);
  }

  private addTopLinkMenuItem(
    menu: Menu,
    sourceFile: TFile,
    targetFile: TFile,
    labelText: string,
    iconName: string
  ): void {
    menu.addItem((item: any) => {
      item.setTitle(labelText).setIcon(iconName).onClick((evt: MouseEvent) => {
        const now = Date.now();
        const isSecondTap =
          this.topLinkPreviewArmedPath === targetFile.path &&
          now <= this.topLinkPreviewArmedUntil;

        if (!isSecondTap) {
          this.topLinkPreviewArmedPath = targetFile.path;
          this.topLinkPreviewArmedUntil = now + 8000;
          void this.showTopLinkPreviewCard(targetFile, sourceFile, this.resolveMenuItemElement(item), evt);
          return;
        }

        this.topLinkPreviewArmedPath = null;
        this.topLinkPreviewArmedUntil = 0;
        this.hideTopLinkPreviewCard();
        void this.plugin.openFileInLeaf(targetFile, false, () => this.plugin.app.workspace.getLeaf(false), { revealLeaf: true });
      });

      // Desktop hover support for contextual note preview.
      window.setTimeout(() => {
        const el = this.resolveMenuItemElement(item);
        if (!el || el.dataset.tpsTopLinkHoverBound === 'true') return;
        el.dataset.tpsTopLinkHoverBound = 'true';
        el.addEventListener('mouseover', (evt: MouseEvent) => {
          void this.showTopLinkPreviewCard(targetFile, sourceFile, el, evt);
        });
        el.addEventListener('mouseleave', () => {
          this.scheduleHideTopLinkPreviewCard(350);
        });
      }, 0);
    });
  }

  private resolveMenuItemElement(item: any): HTMLElement | null {
    const direct = item?.dom;
    if (direct instanceof HTMLElement) return direct;
    const domEl = item?.dom?.el;
    if (domEl instanceof HTMLElement) return domEl;
    const el = item?.el;
    if (el instanceof HTMLElement) return el;
    const titleEl = item?.titleEl;
    if (titleEl instanceof HTMLElement) return titleEl.closest('.menu-item') as HTMLElement | null;
    return null;
  }

  private async showTopLinkPreviewCard(
    targetFile: TFile,
    sourceFile: TFile,
    targetEl: HTMLElement | null,
    event: MouseEvent | null,
    frontmatterKey?: string | null,
  ): Promise<void> {
    const anchor = targetEl ?? (event?.currentTarget as HTMLElement | null) ?? (event?.target as HTMLElement | null);
    if (!anchor) return;
    const previewText = await this.getTopLinkPreviewText(targetFile);
    const detectedFrontmatterKey =
      String(frontmatterKey || '').trim() || this.getFrontmatterLinkLabel(sourceFile, targetFile);
    const referenceSnippet = await this.getSourceReferenceSnippet(sourceFile, targetFile, {
      suppressHighlight: !!detectedFrontmatterKey,
      frontmatterKey: detectedFrontmatterKey || null,
    });
    const normalizedSnippet = referenceSnippet
      || (detectedFrontmatterKey
        ? {
          before: '',
          match: `Frontmatter field: ${detectedFrontmatterKey}`,
          after: '',
          suppressHighlight: true,
        }
        : null);
    this.renderTopLinkPreviewCard(
      this.getFileDisplayTitle(targetFile),
      this.getFileDisplayTitle(sourceFile),
      previewText,
      normalizedSnippet,
      anchor
    );
  }

  private async getTopLinkPreviewText(file: TFile): Promise<string> {
    const cached = this.topLinkPreviewTextCache.get(file.path);
    if (cached) return cached;
    try {
      const raw = await this.plugin.app.vault.cachedRead(file);
      const text = this.extractTopLinkPreviewText(raw);
      this.topLinkPreviewTextCache.set(file.path, text);
      return text;
    } catch {
      return 'Unable to load note preview.';
    }
  }

  private extractTopLinkPreviewText(rawContent: string): string {
    let content = String(rawContent || '');
    if (content.startsWith('---')) {
      const end = content.indexOf('\n---', 3);
      if (end >= 0) {
        content = content.slice(end + 4);
      }
    }
    const normalized = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('```'))
      .join(' ');
    if (!normalized) return 'No body text.';
    return normalized.length > 320 ? `${normalized.slice(0, 320)}...` : normalized;
  }

  private getFileDisplayTitle(file: TFile): string {
    const fm = (this.plugin.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, any>;
    const title = typeof fm.title === 'string' ? fm.title.trim() : '';
    return title || file.basename;
  }

  private async getSourceReferenceSnippet(
    sourceFile: TFile,
    targetFile: TFile,
    options?: { suppressHighlight?: boolean; frontmatterKey?: string | null }
  ): Promise<{ before: string; match: string; after: string; suppressHighlight?: boolean } | null> {
    try {
      const raw = await this.plugin.app.vault.cachedRead(sourceFile);
      const lines = raw.split('\n');
      const frontmatterEndLine = this.getFrontmatterEndLine(raw);
      const regex = /!?\[\[([^[\]]+)\]\]|!?\[[^\]]*]\(([^)]+)\)/g;
      let fallbackFrontmatter: { before: string; match: string; after: string; suppressHighlight?: boolean } | null = null;

      for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
        const line = lines[lineNumber] || '';
        regex.lastIndex = 0;
        let match: RegExpExecArray | null = null;
        while ((match = regex.exec(line)) !== null) {
          const full = match[0] || '';
          const linkTargetRaw = (match[1] || match[2] || '').trim();
          if (!linkTargetRaw) continue;
          const normalizedLink = this.normalizeLinkTarget(linkTargetRaw);
          if (!normalizedLink) continue;
          const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(normalizedLink, sourceFile.path);
          if (!(resolved instanceof TFile) || resolved.path !== targetFile.path) continue;

          const snippet = this.extractInlineReferenceSnippet(line, match.index ?? 0, full, sourceFile.path);
          if (lineNumber > frontmatterEndLine) {
            return snippet;
          }
          if (!fallbackFrontmatter) {
            fallbackFrontmatter = { ...snippet, suppressHighlight: true };
          }
        }
      }

      if (fallbackFrontmatter) {
        if (options?.suppressHighlight) {
          fallbackFrontmatter.suppressHighlight = true;
        }
        if (options?.frontmatterKey) {
          fallbackFrontmatter.before = '';
          fallbackFrontmatter.match = `Frontmatter field: ${options.frontmatterKey}`;
          fallbackFrontmatter.after = '';
          fallbackFrontmatter.suppressHighlight = true;
        }
      }
      return fallbackFrontmatter;
    } catch {
      return null;
    }
  }

  private getFrontmatterEndLine(rawContent: string): number {
    const lines = String(rawContent || '').split('\n');
    if (lines[0]?.trim() !== '---') return -1;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i]?.trim() === '---') return i;
    }
    return -1;
  }

  private extractInlineReferenceSnippet(
    line: string,
    startIndex: number,
    rawMatch: string,
    sourcePath: string
  ): { before: string; match: string; after: string } {
    const sourceLine = String(line || '');
    const matchText = this.linkTokenDisplayText(rawMatch, sourcePath);
    const endIndex = startIndex + rawMatch.length;
    const beforeRaw = sourceLine.slice(Math.max(0, startIndex - 80), startIndex);
    const afterRaw = sourceLine.slice(endIndex, Math.min(sourceLine.length, endIndex + 80));
    const before = beforeRaw.replace(/\s+/g, ' ').trim();
    const after = afterRaw.replace(/\s+/g, ' ').trim();
    return {
      before: before ? `…${before}` : '',
      match: matchText,
      after: after ? `${after}…` : '',
    };
  }

  private normalizeLinkTarget(rawTarget: string): string {
    let target = String(rawTarget || '').trim();
    if (!target) return '';
    if (target.startsWith('<') && target.endsWith('>')) {
      target = target.slice(1, -1).trim();
    }
    target = target.replace(/^!/, '').trim();
    target = target.replace(/^['"]|['"]$/g, '').trim();
    const pipeIndex = target.indexOf('|');
    if (pipeIndex >= 0) target = target.slice(0, pipeIndex).trim();
    const hashIndex = target.indexOf('#');
    if (hashIndex >= 0) target = target.slice(0, hashIndex).trim();
    return target;
  }

  private linkTokenDisplayText(rawToken: string, sourcePath: string): string {
    const wiki = rawToken.match(/^!?\[\[([^\]]+)\]\]$/);
    if (wiki) {
      const inner = wiki[1];
      if (inner.includes('|')) {
        const alias = inner.split('|')[1]?.trim();
        if (alias) return alias;
      }
      const target = inner.split('|')[0].split('#')[0].trim();
      const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
      if (resolved instanceof TFile) return this.getFileDisplayTitle(resolved);
      return target;
    }
    const markdown = rawToken.match(/^!?\[([^\]]*)\]\(([^)]+)\)$/);
    if (markdown) {
      const label = String(markdown[1] || '').trim();
      if (label) return label;
      const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(this.normalizeLinkTarget(markdown[2]), sourcePath);
      if (resolved instanceof TFile) return this.getFileDisplayTitle(resolved);
    }
    return rawToken;
  }

  private renderTopLinkPreviewCard(
    targetName: string,
    sourceName: string,
    previewText: string,
    referenceSnippet: { before: string; match: string; after: string; suppressHighlight?: boolean } | null,
    targetEl: HTMLElement | null
  ): void {
    if (!targetEl) return;
    if (this.topLinkPreviewHideTimer !== null) {
      window.clearTimeout(this.topLinkPreviewHideTimer);
      this.topLinkPreviewHideTimer = null;
    }
    if (!this.topLinkPreviewEl) {
      const card = document.createElement('div');
      card.className = 'tps-gcm-top-link-preview';
      card.style.position = 'fixed';
      card.style.zIndex = '100000';
      card.style.maxWidth = '420px';
      card.style.minWidth = '260px';
      card.style.padding = '10px 12px';
      card.style.borderRadius = '10px';
      card.style.border = '1px solid var(--background-modifier-border)';
      card.style.background = 'var(--background-primary)';
      card.style.boxShadow = '0 12px 30px rgba(0,0,0,0.35)';
      card.style.pointerEvents = 'none';
      this.topLinkPreviewEl = card;
      document.body.appendChild(card);
    }

    this.topLinkPreviewEl.innerHTML = '';
    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.marginBottom = '6px';
    title.textContent = targetName;
    const subtitle = document.createElement('div');
    subtitle.style.opacity = '0.75';
    subtitle.style.fontSize = '12px';
    subtitle.style.marginBottom = '8px';
    subtitle.textContent = `Linked from ${sourceName}`;
    const body = document.createElement('div');
    body.style.fontSize = '13px';
    body.style.lineHeight = '1.45';
    body.textContent = previewText;

    const referenceWrap = document.createElement('div');
    referenceWrap.style.marginTop = '10px';
    referenceWrap.style.paddingTop = '8px';
    referenceWrap.style.borderTop = '1px solid var(--background-modifier-border)';
    const referenceLabel = document.createElement('div');
    referenceLabel.style.opacity = '0.75';
    referenceLabel.style.fontSize = '12px';
    referenceLabel.style.marginBottom = '4px';
    referenceLabel.textContent = 'Reference context';
    const referenceBody = document.createElement('div');
    referenceBody.style.fontSize = '12px';
    referenceBody.style.lineHeight = '1.4';
    if (referenceSnippet) {
      if (referenceSnippet.before) {
        const before = document.createElement('span');
        before.textContent = `${referenceSnippet.before} `;
        referenceBody.appendChild(before);
      }
      if (referenceSnippet.suppressHighlight) {
        const plain = document.createElement('span');
        plain.textContent = referenceSnippet.match || 'Frontmatter reference';
        referenceBody.appendChild(plain);
      } else {
        const highlight = document.createElement('mark');
        highlight.textContent = referenceSnippet.match;
        referenceBody.appendChild(highlight);
      }
      if (referenceSnippet.after) {
        const after = document.createElement('span');
        after.textContent = ` ${referenceSnippet.after}`;
        referenceBody.appendChild(after);
      }
    } else {
      referenceBody.style.opacity = '0.75';
      referenceBody.textContent = 'No direct inline reference found.';
    }
    referenceWrap.appendChild(referenceLabel);
    referenceWrap.appendChild(referenceBody);
    this.topLinkPreviewEl.appendChild(title);
    this.topLinkPreviewEl.appendChild(subtitle);
    this.topLinkPreviewEl.appendChild(body);
    this.topLinkPreviewEl.appendChild(referenceWrap);

    const rect = targetEl.getBoundingClientRect();
    const cardWidth = 420;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - cardWidth - 12));
    const top = Math.min(window.innerHeight - 120, rect.bottom + 8);
    this.topLinkPreviewEl.style.left = `${left}px`;
    this.topLinkPreviewEl.style.top = `${top}px`;
    this.topLinkPreviewEl.style.display = 'block';
  }

  private scheduleHideTopLinkPreviewCard(delayMs: number): void {
    if (this.topLinkPreviewHideTimer !== null) {
      window.clearTimeout(this.topLinkPreviewHideTimer);
    }
    this.topLinkPreviewHideTimer = window.setTimeout(() => {
      this.hideTopLinkPreviewCard();
    }, Math.max(0, delayMs));
  }

  private hideTopLinkPreviewCard(): void {
    if (this.topLinkPreviewHideTimer !== null) {
      window.clearTimeout(this.topLinkPreviewHideTimer);
      this.topLinkPreviewHideTimer = null;
    }
    if (this.topLinkPreviewEl) {
      this.topLinkPreviewEl.style.display = 'none';
    }
  }

  private toggleTopLinksPopover(anchorEl: HTMLElement, sourceFile: TFile, outgoing: TFile[], incoming: TFile[]): void {
    const existingSourcePath = this.topLinksPopoverEl?.dataset.sourcePath || '';
    const existingPopoverType = this.topLinksPopoverEl?.dataset.popoverType || '';
    if (this.topLinksPopoverEl && existingSourcePath === sourceFile.path && existingPopoverType === 'references') {
      this.hideTopLinksPopover();
      return;
    }

    this.hideTopLinksPopover();

    const popover = document.createElement('div');
    popover.className = 'tps-gcm-top-links-popover';
    popover.dataset.sourcePath = sourceFile.path;
    popover.dataset.popoverType = 'references';
    popover.style.position = 'fixed';
    popover.style.zIndex = '100000';
    popover.style.minWidth = '320px';
    popover.style.maxWidth = '560px';
    popover.style.maxHeight = '60vh';
    popover.style.overflowY = 'auto';
    popover.style.borderRadius = '12px';
    popover.style.border = '1px solid var(--background-modifier-border)';
    popover.style.background = 'var(--background-primary)';
    popover.style.boxShadow = '0 16px 32px rgba(0,0,0,0.35)';
    popover.style.padding = '8px';

    const referencesPanel = this.plugin.menuController.createNoteReferencesPanel(sourceFile);
    referencesPanel.classList.add('tps-gcm-note-references--top-popover');
    popover.appendChild(referencesPanel);

    document.body.appendChild(popover);
    this.topLinksPopoverEl = popover;

    const rect = anchorEl.getBoundingClientRect();
    const width = Math.min(560, Math.max(320, rect.width + 260));
    popover.style.width = `${width}px`;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = Math.min(window.innerHeight - 24, rect.bottom + 8);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;

    this.topLinksPopoverOutsideHandler = (evt: MouseEvent) => {
      const target = evt.target as Node | null;
      if (!target) return;
      if (popover.contains(target)) return;
      if (anchorEl.contains(target)) return;
      this.hideTopLinksPopover();
    };
    window.setTimeout(() => {
      if (this.topLinksPopoverOutsideHandler) {
        document.addEventListener('mousedown', this.topLinksPopoverOutsideHandler, true);
      }
    }, 0);
  }

  private async toggleTopChildrenPopover(anchorEl: HTMLElement, sourceFile: TFile): Promise<void> {
    const existingSourcePath = this.topLinksPopoverEl?.dataset.sourcePath || '';
    const existingPopoverType = this.topLinksPopoverEl?.dataset.popoverType || '';
    if (this.topLinksPopoverEl && existingSourcePath === sourceFile.path && existingPopoverType === 'children') {
      this.hideTopLinksPopover();
      return;
    }

    this.hideTopLinksPopover();
    const childFiles = await this.resolveChildFilesForTopButton(sourceFile);
    if (!anchorEl.isConnected || childFiles.length === 0) return;

    const popover = document.createElement('div');
    popover.className = 'tps-gcm-top-links-popover tps-gcm-top-children-popover';
    popover.dataset.sourcePath = sourceFile.path;
    popover.dataset.popoverType = 'children';
    popover.style.position = 'fixed';
    popover.style.zIndex = '100000';
    popover.style.minWidth = '360px';
    popover.style.maxWidth = '640px';
    popover.style.maxHeight = '70vh';
    popover.style.overflowY = 'auto';
    popover.style.borderRadius = '12px';
    popover.style.border = '1px solid var(--background-modifier-border)';
    popover.style.background = 'var(--background-primary)';
    popover.style.boxShadow = '0 16px 32px rgba(0,0,0,0.35)';
    popover.style.padding = '8px';

    popover.appendChild(this.createTopChildrenPanel(sourceFile, childFiles));

    document.body.appendChild(popover);
    this.topLinksPopoverEl = popover;

    const rect = anchorEl.getBoundingClientRect();
    const width = Math.min(640, Math.max(360, rect.width + 300));
    popover.style.width = `${width}px`;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = Math.min(window.innerHeight - 24, rect.bottom + 8);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;

    this.topLinksPopoverOutsideHandler = (evt: MouseEvent) => {
      const target = evt.target as Node | null;
      if (!target) return;
      if (popover.contains(target)) return;
      if (anchorEl.contains(target)) return;
      this.hideTopLinksPopover();
    };
    window.setTimeout(() => {
      if (this.topLinksPopoverOutsideHandler) {
        document.addEventListener('mousedown', this.topLinksPopoverOutsideHandler, true);
      }
    }, 0);
  }

  private createTopChildrenPanel(sourceFile: TFile, childFiles: TFile[]): HTMLElement {
    const sortedChildren = [...childFiles].sort((a, b) => this.getFileDisplayTitle(a).localeCompare(this.getFileDisplayTitle(b)));
    const section = document.createElement('section');
    section.className = 'tps-gcm-note-references tps-gcm-note-references--top-popover tps-gcm-note-children';
    section.dataset.filePath = sourceFile.path;

    const header = document.createElement('div');
    header.className = 'tps-gcm-note-references-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'tps-gcm-note-references-title-wrap';

    const title = document.createElement('h3');
    title.className = 'tps-gcm-note-references-title';
    title.textContent = 'Children';
    titleWrap.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'tps-gcm-note-references-subtitle';
    subtitle.textContent = sortedChildren.length === 1 ? '1 child note' : `${sortedChildren.length} child notes`;
    titleWrap.appendChild(subtitle);

    header.appendChild(titleWrap);
    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'tps-gcm-note-references-body';
    section.appendChild(body);

    const direction = document.createElement('div');
    direction.className = 'tps-gcm-reference-direction';
    body.appendChild(direction);

    const list = document.createElement('div');
    list.className = 'tps-gcm-reference-simple-list';
    direction.appendChild(list);

    const fragment = document.createDocumentFragment();
    for (const child of sortedChildren) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tps-gcm-reference-simple-item tps-gcm-reference-link-target';
      button.textContent = this.getFileDisplayTitle(child);
      button.title = child.path;
      addSafeClickListener(button, () => {
        void this.plugin.openFileInLeaf(child, false, () => this.plugin.app.workspace.getLeaf(false), { revealLeaf: true });
        this.hideTopLinksPopover();
      });
      fragment.appendChild(button);
    }
    list.appendChild(fragment);

    return section;
  }

  private async showCalendarItemsPopover(anchorEl: HTMLElement, date: Date, sourceFile: TFile): Promise<void> {
    const dateKey = this.formatScheduledIsoDate(date);
    const existingSourcePath = this.topLinksPopoverEl?.dataset.sourcePath || '';
    const existingPopoverType = this.topLinksPopoverEl?.dataset.popoverType || '';
    const existingDate = this.topLinksPopoverEl?.dataset.calendarDate || '';
    if (this.topLinksPopoverEl && existingSourcePath === sourceFile.path && existingPopoverType === 'calendar-items' && existingDate === dateKey) {
      return;
    }

    this.hideTopLinksPopover();
    const items = await this.getCalendarItemsOnDay(date);
    if (!anchorEl.isConnected) return;

    const popover = document.createElement('div');
    popover.className = 'tps-gcm-top-links-popover tps-gcm-top-calendar-popover';
    popover.dataset.sourcePath = sourceFile.path;
    popover.dataset.popoverType = 'calendar-items';
    popover.dataset.calendarDate = dateKey;
    popover.style.position = 'fixed';
    popover.style.zIndex = '100000';
    popover.style.width = 'min(460px, calc(100vw - 24px))';

    popover.appendChild(this.createCalendarItemsPanel(date, items, sourceFile, () => {
      this.calendarOpenArmedKey = null;
      this.calendarOpenArmedUntil = 0;
      this.hideTopLinksPopover();
      void this.openDefaultCalendarAt(date);
    }));

    document.body.appendChild(popover);
    this.topLinksPopoverEl = popover;

    const rect = anchorEl.getBoundingClientRect();
    const width = Math.min(460, window.innerWidth - 24);
    const leftAnchor = rect.left + rect.width / 2 - width / 2;
    const left = Math.max(12, Math.min(leftAnchor, window.innerWidth - width - 12));
    const renderedHeight = Math.min(popover.getBoundingClientRect().height || 420, window.innerHeight - 24);
    const isBottomToolbarAnchor = !!anchorEl.closest('.tps-gcm-bottom-parent-nav, .tps-gcm-action-bar, .tps-global-context-menu--persistent');
    const availableAbove = rect.top - 12;
    const availableBelow = window.innerHeight - rect.bottom - 12;
    const openAbove = isBottomToolbarAnchor || availableBelow < Math.min(renderedHeight, 220);
    const top = openAbove
      ? Math.max(12, rect.top - renderedHeight - 10)
      : Math.min(window.innerHeight - renderedHeight - 12, rect.bottom + 10);
    const maxHeight = Math.max(180, Math.min(420, openAbove ? availableAbove - 10 : availableBelow - 10));
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.maxHeight = `${maxHeight}px`;
    popover.style.setProperty('--tps-gcm-calendar-popover-body-max-height', `${Math.max(120, maxHeight - 92)}px`);

    this.topLinksPopoverOutsideHandler = (evt: MouseEvent) => {
      const target = evt.target as Node | null;
      if (!target) return;
      if (popover.contains(target)) return;
      if (anchorEl.contains(target)) return;
      this.hideTopLinksPopover();
    };
    window.setTimeout(() => {
      if (this.topLinksPopoverOutsideHandler) {
        document.addEventListener('mousedown', this.topLinksPopoverOutsideHandler, true);
      }
    }, 0);
  }

  private createCalendarItemsPanel(
    date: Date,
    items: CalendarPopoverItem[],
    sourceFile: TFile,
    onOpenCalendar: () => void,
  ): HTMLElement {
    const section = document.createElement('section');
    section.className = 'tps-gcm-note-references tps-gcm-note-references--top-popover tps-gcm-calendar-items';

    const header = document.createElement('div');
    header.className = 'tps-gcm-note-references-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'tps-gcm-note-references-title-wrap';

    const title = document.createElement('h3');
    title.className = 'tps-gcm-note-references-title';
    title.textContent = this.formatScheduledDayLabel(date);
    titleWrap.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'tps-gcm-note-references-subtitle';
    subtitle.textContent = items.length === 1 ? '1 calendar item' : `${items.length} calendar items`;
    titleWrap.appendChild(subtitle);

    header.appendChild(titleWrap);

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'tps-gcm-calendar-open-button';
    openButton.title = 'Open calendar';
    setIcon(openButton, 'external-link');
    const openLabel = document.createElement('span');
    openLabel.textContent = 'Open';
    openButton.appendChild(openLabel);
    addSafeClickListener(openButton, (event) => {
      event.preventDefault();
      onOpenCalendar();
    });
    header.appendChild(openButton);

    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'tps-gcm-note-references-body';
    section.appendChild(body);

    const list = document.createElement('div');
    list.className = 'tps-gcm-reference-simple-list';
    body.appendChild(list);

    const actionHost = document.createElement('div');
    actionHost.className = 'tps-gcm-calendar-selection-actions';
    actionHost.hidden = true;
    body.appendChild(actionHost);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tps-gcm-reference-empty';
      empty.textContent = 'No calendar items on this day.';
      list.appendChild(empty);
      return section;
    }

    for (const item of items) {
      const isCurrentNote = !!item.file && item.file.path === sourceFile.path;
      const row = document.createElement('button');
      row.className = 'tps-gcm-reference-simple-item tps-gcm-calendar-item';
      if (item.file) {
        row.classList.add('tps-gcm-reference-link-target', 'is-note');
      } else {
        row.classList.add('is-external-event');
      }
      if (item.kind === 'task') {
        row.classList.add('is-task-item');
      }
      row.type = 'button';
      row.title = item.file
        ? `${item.title} - click for details, double-click to ${item.kind === 'task' ? 'open task line' : 'open note'}`
        : item.title;
      row.setAttribute('aria-selected', 'false');
      row.classList.toggle('is-current-note', isCurrentNote);
      if (isCurrentNote) {
        row.style.setProperty('--tps-gcm-calendar-item-color', 'var(--interactive-accent)');
        row.setAttribute('aria-current', 'true');
      } else if (item.color) {
        row.style.setProperty('--tps-gcm-calendar-item-color', item.color);
      }

      const icon = document.createElement('span');
      icon.className = 'tps-gcm-calendar-item-icon';
      this.renderCalendarPopoverItemIcon(icon, item.icon || (item.file ? 'file-text' : 'calendar-days'), isCurrentNote ? undefined : item.color);
      row.appendChild(icon);

      const time = document.createElement('span');
      time.className = 'tps-gcm-calendar-item-time';
      time.textContent = this.getCalendarItemTimeLabel(item.subtitle);
      row.appendChild(time);

      const rowTitle = document.createElement('span');
      rowTitle.className = 'tps-gcm-reference-title';
      rowTitle.textContent = item.title;
      row.appendChild(rowTitle);

      const rowSubtitle = document.createElement('span');
      rowSubtitle.className = 'tps-gcm-reference-context';
      rowSubtitle.textContent = this.getCalendarItemKindLabel(item.subtitle);
      row.appendChild(rowSubtitle);

      if (item.file) {
        row.dataset.path = item.file.path;
        row.dataset.file = item.file.path;
        if (item.kind === 'task' && typeof item.lineNumber === 'number') {
          row.dataset.tpsGcmContext = 'calendar-task';
          row.dataset.taskPath = item.file.path;
          row.dataset.taskLine = String(item.lineNumber + 1);
          row.dataset.tpsCalendarTaskText = item.title;
          row.classList.add('tps-calendar-task-entry');
          this.bindCompletedTaskPreviewReveal(row, item.file, item.lineNumber, item.completed === true);
        }
        row.addEventListener('mousedown', (evt: MouseEvent) => {
          if (evt.button === 0 || evt.button === 2) {
            this.plugin.contextTargetService.recordContextTarget(row);
          }
        }, { capture: true });
      }

      addSafeClickListener(row, (evt) => {
        if (item.file && (evt.metaKey || evt.ctrlKey || evt.detail >= 2)) {
          if (item.kind === 'task' && typeof item.lineNumber === 'number') {
            void this.openTaskLine(item.file, item.lineNumber, item.completed === true);
          } else {
            void this.plugin.openFileInLeaf(item.file, false, () => this.plugin.app.workspace.getLeaf(false), { revealLeaf: true });
          }
          this.hideTopLinksPopover();
          return;
        }
        this.selectCalendarPopoverItem(row, item);
      });
      list.appendChild(row);
    }

    return section;
  }

  private async showNoteTasksPopover(anchorEl: HTMLElement, sourceFile: TFile): Promise<void> {
    const existingSourcePath = this.topLinksPopoverEl?.dataset.sourcePath || '';
    const existingPopoverType = this.topLinksPopoverEl?.dataset.popoverType || '';
    if (this.topLinksPopoverEl && existingSourcePath === sourceFile.path && existingPopoverType === 'note-tasks') {
      return;
    }

    this.hideTopLinksPopover();
    const tasks = await this.collectTasksInFile(sourceFile);
    if (!anchorEl.isConnected) return;

    const popover = document.createElement('div');
    popover.className = 'tps-gcm-top-links-popover tps-gcm-top-calendar-popover tps-gcm-note-tasks-popover';
    popover.dataset.sourcePath = sourceFile.path;
    popover.dataset.popoverType = 'note-tasks';
    popover.style.position = 'fixed';
    popover.style.zIndex = '100000';
    popover.style.width = 'min(460px, calc(100vw - 24px))';
    popover.appendChild(this.createNoteTasksPanel(sourceFile, tasks));

    document.body.appendChild(popover);
    this.topLinksPopoverEl = popover;

    const rect = anchorEl.getBoundingClientRect();
    const width = Math.min(460, window.innerWidth - 24);
    const leftAnchor = rect.left + rect.width / 2 - width / 2;
    const left = Math.max(12, Math.min(leftAnchor, window.innerWidth - width - 12));
    const renderedHeight = Math.min(popover.getBoundingClientRect().height || 420, window.innerHeight - 24);
    const isBottomToolbarAnchor = !!anchorEl.closest('.tps-gcm-bottom-parent-nav, .tps-gcm-action-bar, .tps-global-context-menu--persistent');
    const availableAbove = rect.top - 12;
    const availableBelow = window.innerHeight - rect.bottom - 12;
    const openAbove = isBottomToolbarAnchor || availableBelow < Math.min(renderedHeight, 220);
    const top = openAbove
      ? Math.max(12, rect.top - renderedHeight - 10)
      : Math.min(window.innerHeight - renderedHeight - 12, rect.bottom + 10);
    const maxHeight = Math.max(180, Math.min(420, openAbove ? availableAbove - 10 : availableBelow - 10));
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.maxHeight = `${maxHeight}px`;
    popover.style.setProperty('--tps-gcm-calendar-popover-body-max-height', `${Math.max(120, maxHeight - 92)}px`);

    this.topLinksPopoverOutsideHandler = (evt: MouseEvent) => {
      const target = evt.target as Node | null;
      if (!target) return;
      if (popover.contains(target)) return;
      if (anchorEl.contains(target)) return;
      this.hideTopLinksPopover();
    };
    window.setTimeout(() => {
      if (this.topLinksPopoverOutsideHandler) {
        document.addEventListener('mousedown', this.topLinksPopoverOutsideHandler, true);
      }
    }, 0);
  }

  private createNoteTasksPanel(sourceFile: TFile, tasks: NoteTaskPopoverItem[]): HTMLElement {
    const section = document.createElement('section');
    section.className = 'tps-gcm-note-references tps-gcm-note-references--top-popover tps-gcm-note-tasks';

    const header = document.createElement('div');
    header.className = 'tps-gcm-note-references-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'tps-gcm-note-references-title-wrap';

    const title = document.createElement('h3');
    title.className = 'tps-gcm-note-references-title';
    title.textContent = 'Tasks';
    titleWrap.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'tps-gcm-note-references-subtitle';
    subtitle.textContent = tasks.length === 1 ? '1 task in this note' : `${tasks.length} tasks in this note`;
    titleWrap.appendChild(subtitle);
    header.appendChild(titleWrap);
    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'tps-gcm-note-references-body';
    section.appendChild(body);

    const list = document.createElement('div');
    list.className = 'tps-gcm-reference-simple-list';
    body.appendChild(list);

    if (tasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tps-gcm-reference-empty';
      empty.textContent = 'No tasks in this note.';
      list.appendChild(empty);
      return section;
    }

    for (const task of tasks) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tps-gcm-reference-simple-item tps-gcm-calendar-item tps-gcm-note-task-item tps-calendar-task-entry';
      row.dataset.path = sourceFile.path;
      row.dataset.file = sourceFile.path;
      row.dataset.tpsGcmContext = 'calendar-task';
      row.dataset.taskPath = sourceFile.path;
      row.dataset.taskLine = String(task.lineNumber + 1);
      row.dataset.tpsCalendarTaskText = task.title;
      row.title = `${sourceFile.path}:${task.lineNumber + 1}`;
      row.style.setProperty('--tps-gcm-calendar-item-color', task.completed ? 'var(--text-muted)' : 'var(--interactive-accent)');
      this.bindCompletedTaskPreviewReveal(row, sourceFile, task.lineNumber, task.completed);

      const icon = document.createElement('span');
      icon.className = 'tps-gcm-calendar-item-icon';
      this.renderCalendarPopoverItemIcon(icon, task.completed ? 'check-square' : 'square', undefined);
      row.appendChild(icon);

      const line = document.createElement('span');
      line.className = 'tps-gcm-calendar-item-time';
      line.textContent = `L${task.lineNumber + 1}`;
      row.appendChild(line);

      const rowTitle = document.createElement('span');
      rowTitle.className = 'tps-gcm-reference-title';
      rowTitle.textContent = task.title;
      row.appendChild(rowTitle);

      const rowSubtitle = document.createElement('span');
      rowSubtitle.className = 'tps-gcm-reference-context';
      rowSubtitle.textContent = task.scheduledValue ? `scheduled ${task.scheduledValue}` : (task.completed ? 'completed task' : 'open task');
      row.appendChild(rowSubtitle);

      row.addEventListener('mousedown', (evt: MouseEvent) => {
        if (evt.button === 0 || evt.button === 2) {
          this.plugin.contextTargetService.recordContextTarget(row);
        }
      }, { capture: true });

      addSafeClickListener(row, (evt) => {
        evt.preventDefault();
        void this.openTaskLine(sourceFile, task.lineNumber, task.completed);
        this.hideTopLinksPopover();
      });
      list.appendChild(row);
    }

    return section;
  }

  private getCalendarItemTimeLabel(subtitle: string): string {
    return String(subtitle || '').split('·')[0].trim() || 'All day';
  }

  private getCalendarItemKindLabel(subtitle: string): string {
    const parts = String(subtitle || '').split('·');
    return (parts[1] || parts[0] || '').trim();
  }

  private selectCalendarPopoverItem(row: HTMLElement, item: CalendarPopoverItem): void {
    this.selectedCalendarPopoverPath = item.file?.path || null;
    const root = this.topLinksPopoverEl;
    if (!root) return;

    root.querySelectorAll<HTMLElement>('.tps-gcm-calendar-item.is-selected').forEach((el) => {
      el.classList.remove('is-selected');
      el.setAttribute('aria-selected', 'false');
    });

    row.classList.add('is-selected');
    row.setAttribute('aria-selected', 'true');
    this.renderCalendarPopoverDetailPanel(item);
  }

  private renderCalendarPopoverDetailPanel(item: CalendarPopoverItem): void {
    const root = this.topLinksPopoverEl;
    if (!root) return;

    const host = root.querySelector<HTMLElement>('.tps-gcm-calendar-selection-actions');
    if (!host) return;

    host.replaceChildren();
    host.hidden = false;

    const detail = document.createElement('div');
    detail.className = 'tps-gcm-calendar-detail-card';
    if (item.color) {
      detail.style.setProperty('--tps-gcm-calendar-item-color', item.color);
    }

    const icon = document.createElement('span');
    icon.className = 'tps-gcm-calendar-detail-icon';
    this.renderCalendarPopoverItemIcon(icon, item.icon || (item.file ? 'file-text' : 'calendar-days'), item.color);
    detail.appendChild(icon);

    const content = document.createElement('div');
    content.className = 'tps-gcm-calendar-detail-content';
    detail.appendChild(content);

    const title = document.createElement('div');
    title.className = 'tps-gcm-calendar-detail-title';
    title.textContent = item.title;
    content.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'tps-gcm-calendar-detail-meta';
    meta.textContent = [this.getCalendarItemTimeLabel(item.subtitle), this.getCalendarItemKindLabel(item.subtitle)]
      .filter(Boolean)
      .join(' · ');
    content.appendChild(meta);

    this.appendCalendarDetailField(content, 'Location', item.location);
    this.appendCalendarDetailField(content, 'Details', item.description);

    if (item.file) {
      const path = document.createElement('div');
      path.className = 'tps-gcm-calendar-detail-path';
      path.textContent = typeof item.lineNumber === 'number'
        ? `${item.file.path}:${item.lineNumber + 1}`
        : item.file.path;
      content.appendChild(path);

      const actions = document.createElement('div');
      actions.className = 'tps-gcm-calendar-detail-actions';
      content.appendChild(actions);

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'tps-gcm-calendar-detail-open-button';
      setIcon(openButton, 'external-link');
      const openText = document.createElement('span');
      openText.textContent = item.kind === 'task' ? 'Open task line' : 'Open note';
      openButton.appendChild(openText);
      addSafeClickListener(openButton, () => {
        const file = item.file;
        if (!file) return;
        if (item.kind === 'task' && typeof item.lineNumber === 'number') {
          void this.openTaskLine(file, item.lineNumber, item.completed === true);
        } else {
          void this.plugin.openFileInLeaf(file, false, () => this.plugin.app.workspace.getLeaf(false), { revealLeaf: true });
        }
        this.hideTopLinksPopover();
      });
      actions.appendChild(openButton);
    }

    host.appendChild(detail);
    window.setTimeout(() => this.clampCalendarPopoverToViewport(), 0);
  }

  private clampCalendarPopoverToViewport(): void {
    const popover = this.topLinksPopoverEl;
    if (!popover?.classList.contains('tps-gcm-top-calendar-popover')) return;

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (viewportHeight <= 0) return;

    const margin = 12;
    const currentTop = Number.parseFloat(popover.style.top || '') || popover.getBoundingClientRect().top;
    const maxHeight = Math.max(180, viewportHeight - margin * 2);
    const top = Math.max(margin, Math.min(currentTop, viewportHeight - margin - Math.min(popover.getBoundingClientRect().height, maxHeight)));
    const availableHeight = Math.max(180, viewportHeight - top - margin);

    popover.style.top = `${top}px`;
    popover.style.maxHeight = `${Math.min(maxHeight, availableHeight)}px`;
    popover.style.setProperty('--tps-gcm-calendar-popover-body-max-height', `${Math.max(120, Math.min(maxHeight, availableHeight) - 92)}px`);
  }

  private appendCalendarDetailField(parent: HTMLElement, label: string, value: unknown): void {
    const text = String(value || '').trim();
    if (!text) return;

    const field = document.createElement('div');
    field.className = 'tps-gcm-calendar-detail-field';

    const labelEl = document.createElement('span');
    labelEl.className = 'tps-gcm-calendar-detail-field-label';
    labelEl.textContent = `${label}: `;
    field.appendChild(labelEl);

    if (/^https?:\/\//i.test(text)) {
      const link = document.createElement('a');
      link.href = text;
      link.textContent = text;
      link.target = '_blank';
      link.rel = 'noopener';
      field.appendChild(link);
    } else {
      const valueEl = document.createElement('span');
      valueEl.textContent = text;
      field.appendChild(valueEl);
    }

    parent.appendChild(field);
  }

  private renderCalendarPopoverItemIcon(iconEl: HTMLElement, iconValue: string, color?: string): void {
    const normalized = String(iconValue || '').trim();
    iconEl.textContent = '';
    if (color) {
      iconEl.style.color = color;
    } else {
      iconEl.style.removeProperty('color');
    }

    if (normalized && /[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u.test(normalized)) {
      iconEl.textContent = normalized;
      return;
    }

    try {
      setIcon(iconEl, normalized.replace(/^(lucide|icon):/i, '').trim() || 'file-text');
      if (!iconEl.querySelector('svg')) setIcon(iconEl, 'file-text');
    } catch {
      setIcon(iconEl, 'file-text');
    }
  }

  private bindCompletedTaskPreviewReveal(row: HTMLElement, file: TFile, lineNumber: number, completed: boolean): void {
    if (!completed || typeof lineNumber !== 'number') return;
    const reveal = () => {
      this.plugin.hideCompletedCheckboxesService?.revealCompletedForFile(file.path, lineNumber);
    };
    row.addEventListener('mouseenter', reveal);
    row.addEventListener('mouseover', reveal, { capture: true });
    row.addEventListener('focus', reveal);
  }

  private async openTaskLine(file: TFile, lineNumber: number, revealCompleted = false): Promise<void> {
    if (revealCompleted) {
      this.plugin.hideCompletedCheckboxesService?.revealCompletedForFile(file.path, lineNumber);
      await this.delay(90);
    }

    const opened = await this.plugin.openFileInLeaf(
      file,
      false,
      () => this.plugin.app.workspace.getLeaf(false),
      { revealLeaf: true },
    );
    if (!opened) return;

    const leaf = this.plugin.findOpenLeafForFile(file) ?? this.plugin.app.workspace.activeLeaf;
    const view = leaf?.view;
    if (!(view instanceof MarkdownView)) return;

    try {
      const line = Math.max(0, Math.floor(lineNumber));
      view.editor.setCursor({ line, ch: 0 });
      view.editor.focus();
      view.editor.scrollIntoView?.(
        { from: { line, ch: 0 }, to: { line: line + 1, ch: 0 } },
        true,
      );
    } catch (error) {
      logger.warn('[TPS GCM] Failed opening task line from popover', { file: file.path, lineNumber, error });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private hideTopLinksPopover(): void {
    if (this.topLinksPopoverOutsideHandler) {
      document.removeEventListener('mousedown', this.topLinksPopoverOutsideHandler, true);
      this.topLinksPopoverOutsideHandler = null;
    }
    if (this.topLinksPopoverEl) {
      this.topLinksPopoverEl.remove();
      this.topLinksPopoverEl = null;
    }
    this.selectedCalendarPopoverPath = null;
  }

  public async showBaseLinkEditablePreview(file: TFile, anchorEl: HTMLElement): Promise<void> {
    if (!anchorEl.isConnected) return;
    const raw = await this.plugin.app.vault.cachedRead(file);
    if (!anchorEl.isConnected) return;
    const parts = this.splitMarkdownFrontmatter(raw);

    this.hideTopLinkPreviewCard();
    this.hideBaseLinkEditablePreview();

    const popover = document.createElement('div');
    popover.className = 'tps-gcm-base-link-preview';
    popover.dataset.path = file.path;
    popover.dataset.tpsGcmPreviewStable = 'true';
    popover.style.position = 'fixed';
    popover.style.zIndex = '40';

    const header = document.createElement('div');
    header.className = 'tps-gcm-base-link-preview-header';

    const headerMain = document.createElement('div');
    headerMain.className = 'tps-gcm-base-link-preview-header-main';

    const frontmatter = (this.plugin.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, any>;
    const resolvedIcon = this.resolveInlineTitleIconValue(file, frontmatter) || 'file-text';
    const resolvedColor = this.resolveTitleIconColor(frontmatter, file);
    const iconEl = document.createElement('span');
    iconEl.className = 'tps-gcm-base-link-preview-file-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    if (resolvedColor) {
      iconEl.style.color = resolvedColor;
    }
    this.renderInlineTitleIcon(iconEl, resolvedIcon, file);
    headerMain.appendChild(iconEl);

    const titleWrap = document.createElement('div');
    titleWrap.className = 'tps-gcm-base-link-preview-title-wrap';

    const title = document.createElement('div');
    title.className = 'tps-gcm-base-link-preview-title';
    title.textContent = this.getFileDisplayTitle(file);
    titleWrap.appendChild(title);

    const path = document.createElement('div');
    path.className = 'tps-gcm-base-link-preview-path';
    path.textContent = file.path;
    titleWrap.appendChild(path);
    headerMain.appendChild(titleWrap);
    header.appendChild(headerMain);

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'tps-gcm-base-link-preview-open';
    openButton.title = 'Open note';
    setIcon(openButton, 'external-link');
    addSafeClickListener(openButton, () => {
      this.hideBaseLinkEditablePreview();
      void this.plugin.openFileInLeaf(file, false, () => this.plugin.app.workspace.getLeaf(false), { revealLeaf: true });
    });
    header.appendChild(openButton);
    popover.appendChild(header);

    const propertiesPanel = this.plugin.menuController.getPanelBuilder().createStackedPropertiesPanel(file);
    if (propertiesPanel) {
      propertiesPanel.classList.add('tps-gcm-base-link-preview-properties');
      popover.appendChild(propertiesPanel);
    }

    const bodyScroller = document.createElement('div');
    bodyScroller.className = 'tps-gcm-base-link-preview-body markdown-preview-view markdown-rendered';
    const bodySizer = document.createElement('div');
    bodySizer.className = 'markdown-preview-sizer markdown-preview-section tps-gcm-base-link-preview-rendered-body';
    bodySizer.dataset.path = file.path;
    bodySizer.dataset.file = file.path;
    bodySizer.tabIndex = 0;
    bodySizer.contentEditable = 'true';
    bodySizer.spellcheck = true;
    bodySizer.setAttribute('role', 'textbox');
    bodySizer.setAttribute('aria-multiline', 'true');
    bodySizer.setAttribute('aria-label', 'Edit note body');
    bodyScroller.appendChild(bodySizer);
    const sourceEditor = document.createElement('textarea');
    sourceEditor.className = 'tps-gcm-base-link-preview-source-editor';
    sourceEditor.value = parts.body;
    sourceEditor.spellcheck = true;
    sourceEditor.setAttribute('aria-label', 'Edit note body');
    sourceEditor.style.display = 'none';
    bodyScroller.appendChild(sourceEditor);
    popover.appendChild(bodyScroller);

    const status = document.createElement('div');
    status.className = 'tps-gcm-base-link-preview-status';
    status.textContent = 'Click again to open';
    popover.appendChild(status);

    this.baseLinkPreviewEl = popover;
    this.baseLinkPreviewBodyEl = bodySizer;
    this.baseLinkPreviewEditorEl = sourceEditor;
    this.baseLinkPreviewFile = file;
    this.baseLinkPreviewLastSavedBody = parts.body;

    document.body.appendChild(popover);
    this.baseLinkPreviewOverlay = new KeyboardAwareOverlay(popover, anchorEl, {
      maxWidth: 620,
      maxHeight: 560,
    });
    this.baseLinkPreviewOverlay.connect();

    const component = new Component();
    component.load();
    this.baseLinkPreviewComponent = component;
    await MarkdownRenderer.render(this.plugin.app, parts.body || '\n', bodySizer, file.path, component);
    this.baseLinkPreviewOverlay?.schedule();

    bodySizer.addEventListener('keydown', (evt: KeyboardEvent) => {
      evt.stopPropagation();
      if (evt.key === 'Enter') {
        evt.preventDefault();
        this.insertEditablePreviewNewLine(bodySizer, evt.shiftKey);
        status.textContent = 'Unsaved changes';
        this.scheduleBaseLinkPreviewBodySave(status);
        return;
      }
      if (evt.key === 'Tab') {
        evt.preventDefault();
        document.execCommand('insertText', false, '  ');
        status.textContent = 'Unsaved changes';
        this.scheduleBaseLinkPreviewBodySave(status);
      }
    });
    bodySizer.addEventListener('input', () => {
      status.textContent = 'Unsaved changes';
      this.scheduleBaseLinkPreviewBodySave(status);
    });
    bodySizer.addEventListener('blur', () => {
      void this.flushBaseLinkPreviewBodySave(status, { preserveActiveBlank: false, renderAfterSave: false });
    });
    sourceEditor.addEventListener('keydown', (evt: KeyboardEvent) => {
      if (evt.isComposing) return;
      evt.stopPropagation();
      if (evt.key === 'Enter') {
        this.handleBaseLinkPreviewEditorEnter(sourceEditor, evt);
        status.textContent = 'Unsaved changes';
        this.scheduleBaseLinkPreviewBodySave(status);
        return;
      }
      if (evt.key === 'Tab') {
        this.handleBaseLinkPreviewEditorTab(sourceEditor, evt);
        status.textContent = 'Unsaved changes';
        this.scheduleBaseLinkPreviewBodySave(status);
      }
    });
    sourceEditor.addEventListener('input', () => {
      status.textContent = 'Unsaved changes';
      this.scheduleBaseLinkPreviewBodySave(status);
      this.scheduleBaseLinkPreviewBodyRender();
      this.baseLinkPreviewOverlay?.schedule();
    });
    sourceEditor.addEventListener('blur', () => {
      void this.flushBaseLinkPreviewBodySave(status, { preserveActiveBlank: false, renderAfterSave: true });
    });

    this.baseLinkPreviewOutsideHandler = (evt: MouseEvent) => {
      const target = evt.target as Node | null;
      if (!target) return;
      if (popover.contains(target)) return;
      if (anchorEl.contains(target)) return;
      if (target instanceof HTMLElement && target.closest('.menu, .modal, .suggestion-container, .prompt, .popover, .hover-popover')) return;
      this.hideBaseLinkEditablePreview();
    };
    window.setTimeout(() => {
      if (this.baseLinkPreviewOutsideHandler) {
        document.addEventListener('mousedown', this.baseLinkPreviewOutsideHandler, true);
      }
    }, 0);
  }

  private splitMarkdownFrontmatter(rawContent: string): { frontmatter: string; body: string } {
    const raw = String(rawContent || '');
    if (!raw.startsWith('---')) return { frontmatter: '', body: raw };
    const end = raw.indexOf('\n---', 3);
    if (end < 0) return { frontmatter: '', body: raw };
    const frontmatter = raw.slice(0, end + 4);
    const body = raw.slice(end + 4).replace(/^\r?\n/, '');
    return { frontmatter, body };
  }

  private getEditablePreviewBodyText(): string {
    const editorEl = this.baseLinkPreviewEditorEl;
    if (editorEl && editorEl.style.display !== 'none') {
      return editorEl.value.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trimEnd();
    }
    const bodyEl = this.baseLinkPreviewBodyEl;
    if (!bodyEl) return '';
    return this.serializeEditablePreviewMarkdown(bodyEl).replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trimEnd();
  }

  private activateBaseLinkPreviewSourceEditor(): void {
    const previewEl = this.baseLinkPreviewBodyEl;
    const editorEl = this.baseLinkPreviewEditorEl;
    if (!previewEl || !editorEl) return;
    if (editorEl.style.display !== 'none') return;

    editorEl.value = this.getEditablePreviewBodyText();
    previewEl.parentElement?.classList.add('is-editing');
    editorEl.style.display = 'block';
    window.requestAnimationFrame(() => {
      editorEl.focus();
      const end = editorEl.value.length;
      editorEl.setSelectionRange(end, end);
    });
  }

  private deactivateBaseLinkPreviewSourceEditor(): void {
    const previewEl = this.baseLinkPreviewBodyEl;
    const editorEl = this.baseLinkPreviewEditorEl;
    if (!previewEl || !editorEl) return;
    editorEl.style.display = 'none';
    previewEl.parentElement?.classList.remove('is-editing');
    previewEl.style.display = '';
  }

  private handleBaseLinkPreviewEditorEnter(editorEl: HTMLTextAreaElement, evt: KeyboardEvent): void {
    const start = editorEl.selectionStart ?? editorEl.value.length;
    const end = editorEl.selectionEnd ?? start;
    const beforeLineStart = editorEl.value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const currentLine = editorEl.value.slice(beforeLineStart, start);
    const listMatch = currentLine.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);

    evt.preventDefault();
    if (evt.shiftKey || !listMatch) {
      this.replaceBaseLinkPreviewEditorSelection(editorEl, '\n', start, end);
      return;
    }

    const [, indent, marker, text] = listMatch;
    if (!text.trim()) {
      const removeFrom = beforeLineStart;
      const removeTo = start;
      editorEl.value = `${editorEl.value.slice(0, removeFrom)}${editorEl.value.slice(end)}`;
      editorEl.setSelectionRange(removeFrom, removeFrom);
      editorEl.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const nextMarker = /^\d+[.)]$/.test(marker)
      ? marker.replace(/\d+/, (value) => String(Number(value) + 1))
      : marker;
    this.replaceBaseLinkPreviewEditorSelection(editorEl, `\n${indent}${nextMarker} `, start, end);
  }

  private handleBaseLinkPreviewEditorTab(editorEl: HTMLTextAreaElement, evt: KeyboardEvent): void {
    evt.preventDefault();
    const start = editorEl.selectionStart ?? 0;
    const end = editorEl.selectionEnd ?? start;
    const lineStart = editorEl.value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    if (evt.shiftKey) {
      const removable = editorEl.value.slice(lineStart, lineStart + 2) === '  '
        ? 2
        : editorEl.value.slice(lineStart, lineStart + 1) === '\t'
          ? 1
          : 0;
      if (removable > 0) {
        editorEl.value = `${editorEl.value.slice(0, lineStart)}${editorEl.value.slice(lineStart + removable)}`;
        editorEl.setSelectionRange(Math.max(lineStart, start - removable), Math.max(lineStart, end - removable));
        editorEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }
    editorEl.value = `${editorEl.value.slice(0, lineStart)}  ${editorEl.value.slice(lineStart)}`;
    editorEl.setSelectionRange(start + 2, end + 2);
    editorEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private replaceBaseLinkPreviewEditorSelection(editorEl: HTMLTextAreaElement, text: string, start: number, end: number): void {
    editorEl.value = `${editorEl.value.slice(0, start)}${text}${editorEl.value.slice(end)}`;
    const cursor = start + text.length;
    editorEl.setSelectionRange(cursor, cursor);
    editorEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private serializeEditablePreviewMarkdown(root: HTMLElement): string {
    const lines: string[] = [];
    const direct = Array.from(root.childNodes);
    const nodes = direct.length > 0 ? direct : [root];

    const textOf = (node: Node): string => String(node.textContent || '').replace(/\s+\n/g, '\n').trim();
    const walkList = (list: Element, ordered: boolean): void => {
      Array.from(list.children).forEach((child, index) => {
        if (!(child instanceof HTMLElement) || child.tagName.toLowerCase() !== 'li') return;
        const marker = ordered ? `${index + 1}.` : '-';
        const clone = child.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('ul, ol').forEach((nested) => nested.remove());
        const own = textOf(clone);
        if (own) lines.push(`${marker} ${own}`);
        child.querySelectorAll(':scope > ul, :scope > ol').forEach((nested) => {
          const before = lines.length;
          walkList(nested, nested.tagName.toLowerCase() === 'ol');
          for (let i = before; i < lines.length; i += 1) {
            lines[i] = `  ${lines[i]}`;
          }
        });
      });
    };

    const serializeNode = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = textOf(node);
        if (text) lines.push(text);
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      const tag = node.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1));
        const text = textOf(node);
        if (text) lines.push(`${'#'.repeat(level)} ${text}`);
        return;
      }
      if (tag === 'ul' || tag === 'ol') {
        walkList(node, tag === 'ol');
        return;
      }
      if (tag === 'blockquote') {
        const text = textOf(node);
        if (text) lines.push(text.split('\n').map((line) => `> ${line}`).join('\n'));
        return;
      }
      if (tag === 'pre') {
        const text = textOf(node);
        lines.push(`\`\`\`\n${text}\n\`\`\``);
        return;
      }
      if (tag === 'hr') {
        lines.push('---');
        return;
      }
      if (tag === 'br') {
        lines.push('');
        return;
      }
      const text = textOf(node);
      if (text) lines.push(text);
    };

    nodes.forEach(serializeNode);
    return lines.join('\n\n');
  }

  private insertEditablePreviewNewLine(root: HTMLElement, softBreak: boolean): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createElement('br'));
      root.appendChild(paragraph);
      this.placeCaretAtStart(paragraph);
      return;
    }

    if (softBreak) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const br = document.createElement('br');
      range.insertNode(br);
      range.setStartAfter(br);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    const listItem = this.findEditablePreviewAncestor(root, selection.anchorNode, 'li');
    if (listItem) {
      this.insertEditablePreviewListItem(root, listItem);
      return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const block = this.findEditablePreviewBlock(root, selection.anchorNode);
    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createElement('br'));

    if (block && block.parentElement) {
      block.parentElement.insertBefore(paragraph, block.nextSibling);
    } else {
      root.appendChild(paragraph);
    }
    this.placeCaretAtStart(paragraph);
  }

  private insertEditablePreviewListItem(root: HTMLElement, listItem: HTMLElement): void {
    const list = listItem.parentElement;
    if (!list || !['ul', 'ol'].includes(list.tagName.toLowerCase())) {
      return;
    }

    const isEmptyItem = String(listItem.textContent || '').trim().length === 0;
    if (isEmptyItem) {
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createElement('br'));
      if (list.parentElement) {
        list.parentElement.insertBefore(paragraph, list.nextSibling);
      } else {
        root.appendChild(paragraph);
      }
      listItem.remove();
      if (list.children.length === 0) {
        list.remove();
      }
      this.placeCaretAtStart(paragraph);
      return;
    }

    const nextItem = document.createElement('li');
    nextItem.appendChild(document.createElement('br'));
    list.insertBefore(nextItem, listItem.nextSibling);
    this.placeCaretAtStart(nextItem);
  }

  private findEditablePreviewAncestor(root: HTMLElement, node: Node | null, tagName: string): HTMLElement | null {
    const normalized = tagName.toLowerCase();
    let current: Node | null = node;
    while (current && current !== root) {
      if (current instanceof HTMLElement && current.tagName.toLowerCase() === normalized) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  private findEditablePreviewBlock(root: HTMLElement, node: Node | null): HTMLElement | null {
    let current: Node | null = node;
    while (current && current !== root) {
      if (current instanceof HTMLElement && current.parentElement === root) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  private placeCaretAtStart(el: HTMLElement): void {
    el.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private hasTrailingEditablePreviewBlankBlock(root: HTMLElement): boolean {
    const last = Array.from(root.children).at(-1);
    if (!(last instanceof HTMLElement)) return false;
    const tag = last.tagName.toLowerCase();
    if (['ul', 'ol'].includes(tag)) {
      const lastItem = Array.from(last.children).at(-1);
      return lastItem instanceof HTMLElement
        && lastItem.tagName.toLowerCase() === 'li'
        && String(lastItem.textContent || '').trim().length === 0;
    }
    if (!['p', 'div', 'li'].includes(tag)) return false;
    return String(last.textContent || '').trim().length === 0;
  }

  private isEditablePreviewSelectionInBlankBlock(root: HTMLElement): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) return false;
    const listItem = this.findEditablePreviewAncestor(root, selection.anchorNode, 'li');
    if (listItem && String(listItem.textContent || '').trim().length === 0) {
      return true;
    }
    const block = this.findEditablePreviewBlock(root, selection.anchorNode);
    if (!block) return false;
    const tag = block.tagName.toLowerCase();
    if (!['p', 'div'].includes(tag)) return false;
    return String(block.textContent || '').trim().length === 0;
  }

  private scheduleBaseLinkPreviewBodySave(statusEl: HTMLElement): void {
    if (this.baseLinkPreviewSaveTimer !== null) {
      window.clearTimeout(this.baseLinkPreviewSaveTimer);
    }
    this.baseLinkPreviewSaveTimer = window.setTimeout(() => {
      void this.flushBaseLinkPreviewBodySave(statusEl);
    }, 2200);
  }

  private scheduleBaseLinkPreviewBodyRender(): void {
    const sourceEditorActive = this.baseLinkPreviewEditorEl?.style.display !== 'none';
    const focusedInsidePreview =
      !!this.baseLinkPreviewEl &&
      document.activeElement instanceof Node &&
      this.baseLinkPreviewEl.contains(document.activeElement);
    if (
      !sourceEditorActive &&
      this.baseLinkPreviewBodyEl &&
      (this.hasTrailingEditablePreviewBlankBlock(this.baseLinkPreviewBodyEl) ||
        this.isEditablePreviewSelectionInBlankBlock(this.baseLinkPreviewBodyEl))
    ) {
      return;
    }
    if (this.baseLinkPreviewRenderTimer !== null) {
      window.clearTimeout(this.baseLinkPreviewRenderTimer);
    }
    this.baseLinkPreviewRenderTimer = window.setTimeout(() => {
      void this.renderBaseLinkPreviewBodyFromEditableText();
    }, sourceEditorActive && focusedInsidePreview ? 1200 : sourceEditorActive ? 450 : focusedInsidePreview ? 1200 : 300);
  }

  private async renderBaseLinkPreviewBodyFromEditableText(): Promise<void> {
    if (this.baseLinkPreviewRenderTimer !== null) {
      window.clearTimeout(this.baseLinkPreviewRenderTimer);
      this.baseLinkPreviewRenderTimer = null;
    }
    const bodyEl = this.baseLinkPreviewBodyEl;
    const file = this.baseLinkPreviewFile;
    if (!bodyEl || !(file instanceof TFile)) return;
    if (this.baseLinkPreviewRenderInFlight) {
      this.scheduleBaseLinkPreviewBodyRender();
      return;
    }
    this.baseLinkPreviewRenderInFlight = true;
    const markdown = this.getEditablePreviewBodyText();

    try {
      this.baseLinkPreviewComponent?.unload();
      const component = new Component();
      component.load();
      this.baseLinkPreviewComponent = component;
      bodyEl.replaceChildren();
      const sourceEditorActive = this.baseLinkPreviewEditorEl?.style.display !== 'none';
      await MarkdownRenderer.render(this.plugin.app, markdown || '\n', bodyEl, file.path, component);
      if (!sourceEditorActive) {
        this.deactivateBaseLinkPreviewSourceEditor();
      }

      if (!sourceEditorActive && (document.activeElement === bodyEl || bodyEl.contains(document.activeElement))) {
        this.focusEditablePreviewEnd(bodyEl);
      }
    } finally {
      this.baseLinkPreviewRenderInFlight = false;
    }
  }

  private focusEditablePreviewEnd(el: HTMLElement): void {
    el.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private async flushBaseLinkPreviewBodySave(
    statusEl?: HTMLElement | null,
    options: { preserveActiveBlank?: boolean; renderAfterSave?: boolean } = {}
  ): Promise<void> {
    if (this.baseLinkPreviewSaveTimer !== null) {
      window.clearTimeout(this.baseLinkPreviewSaveTimer);
      this.baseLinkPreviewSaveTimer = null;
    }
    if (this.baseLinkPreviewRenderTimer !== null) {
      window.clearTimeout(this.baseLinkPreviewRenderTimer);
      this.baseLinkPreviewRenderTimer = null;
    }

    const file = this.baseLinkPreviewFile;
    if (!(file instanceof TFile)) return;
    if (this.baseLinkPreviewSaveInFlight) {
      if (statusEl) {
        statusEl.textContent = 'Saving...';
        this.scheduleBaseLinkPreviewBodySave(statusEl);
      }
      return;
    }

    const bodyEl = this.baseLinkPreviewBodyEl;
    const preserveActiveBlank = options.preserveActiveBlank ?? true;
    const sourceEditorActive = this.baseLinkPreviewEditorEl?.style.display !== 'none';
    if (!sourceEditorActive && preserveActiveBlank && statusEl && bodyEl && this.isEditablePreviewSelectionInBlankBlock(bodyEl)) {
      statusEl.textContent = 'Unsaved changes';
      this.scheduleBaseLinkPreviewBodySave(statusEl);
      return;
    }

    const nextBody = this.getEditablePreviewBodyText();
    if (nextBody === this.baseLinkPreviewLastSavedBody) {
      if (statusEl) statusEl.textContent = 'Saved';
      if (options.renderAfterSave) {
        await this.renderBaseLinkPreviewBodyFromEditableText();
      }
      return;
    }

    try {
      this.baseLinkPreviewSaveInFlight = true;
      const currentRaw = await this.plugin.app.vault.cachedRead(file);
      const currentParts = this.splitMarkdownFrontmatter(currentRaw);
      const nextContent = currentParts.frontmatter
        ? `${currentParts.frontmatter}\n${nextBody}${nextBody ? '\n' : ''}`
        : `${nextBody}${nextBody ? '\n' : ''}`;
      await this.plugin.app.vault.modify(file, nextContent);
      if (this.baseLinkPreviewFile?.path !== file.path || !this.baseLinkPreviewEl?.isConnected) return;
      this.baseLinkPreviewLastSavedBody = nextBody;
      this.topLinkPreviewTextCache.delete(file.path);
      if (statusEl) statusEl.textContent = 'Saved';
      if (!this.isBaseLinkEditablePreviewOpen(file.path)) {
        void this.refreshMenusForFile(file, true);
      }
      if (options.renderAfterSave) {
        await this.renderBaseLinkPreviewBodyFromEditableText();
      }
    } catch (error) {
      logger.error('[TPS GCM] Failed saving Base link editable preview:', error);
      if (statusEl) statusEl.textContent = 'Save failed';
      new Notice(`Failed to save ${file.basename}.`);
    } finally {
      this.baseLinkPreviewSaveInFlight = false;
    }
  }

  public hideBaseLinkEditablePreview(): void {
    void this.flushBaseLinkPreviewBodySave();
    this.baseLinkPreviewOverlay?.disconnect();
    this.baseLinkPreviewOverlay = null;
    if (this.baseLinkPreviewOutsideHandler) {
      document.removeEventListener('mousedown', this.baseLinkPreviewOutsideHandler, true);
      this.baseLinkPreviewOutsideHandler = null;
    }
    if (this.baseLinkPreviewSaveTimer !== null) {
      window.clearTimeout(this.baseLinkPreviewSaveTimer);
      this.baseLinkPreviewSaveTimer = null;
    }
    this.baseLinkPreviewComponent?.unload();
    this.baseLinkPreviewComponent = null;
    this.baseLinkPreviewEl?.remove();
    this.baseLinkPreviewEl = null;
    this.baseLinkPreviewBodyEl = null;
    this.baseLinkPreviewEditorEl = null;
    this.baseLinkPreviewFile = null;
    this.baseLinkPreviewLastSavedBody = '';
    this.baseLinkPreviewRenderInFlight = false;
    this.baseLinkPreviewSaveInFlight = false;
  }

  public isBaseLinkEditablePreviewOpen(path?: string | null): boolean {
    if (!this.baseLinkPreviewEl?.isConnected) return false;
    if (!path) return true;
    return this.baseLinkPreviewFile?.path === path;
  }

  public ensureTopParentNav(view: MarkdownView, options: { force?: boolean } = {}): void {
    const wantsTopProperties = this.plugin.settings.showCustomPropertiesUnderTitle === true
      && this.plugin.settings.showCustomPropertiesInInlineUi !== false;
    const showStackedProperties = wantsTopProperties && !this.isStrictSourceMode(view);
    const showTopNavigation = this.plugin.settings.enableTopParentNav === true;
    const relationshipPlacement = this.getTopParentNavPlacement();
    if (!showTopNavigation || relationshipPlacement !== 'bottom') {
      this.removeBottomParentNav(view);
    }

    const file = view.file;
    const ignoredByInlineRules = file instanceof TFile
      && this.fileMatchesIgnoreRules(file, this.plugin.settings.inlineMenu_IgnoreRules);
    const keepStackedPropertiesForIgnoredFile = ignoredByInlineRules
      && file instanceof TFile
      && showStackedProperties
      && this.isTpsHealthFoodPropertyRecord(file);
    if (ignoredByInlineRules && !keepStackedPropertiesForIgnoredFile) {
      this.clearNativePropertyVisibility(view);
      this.removeTopParentNav(view);
      this.removeBottomParentNav(view);
      return;
    }

    this.clearNativePropertyVisibility(view);

    if (!showTopNavigation && !showStackedProperties) {
      this.removeTopParentNav(view);
      this.removeBottomParentNav(view);
      return;
    }

    if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') {
      this.clearNativePropertyVisibility(view);
      this.removeTopParentNav(view);
      this.removeBottomParentNav(view);
      return;
    }

    const titleEl = this.resolveInlineTitleElement(view);
    if (!titleEl) {
      this.removeTopParentNav(view, { reserveFootprint: false });
      if (relationshipPlacement === 'bottom') {
        this.ensureBottomParentNav(view);
      }
      return;
    }

    const scheduledDate = this.getScheduledDateForFile(file);
    const showScheduledButton = showTopNavigation && relationshipPlacement === 'top' && scheduledDate !== null;
    const currentCache = this.plugin.app.metadataCache.getFileCache(file);
    const isCurrentDailyNote = this.isDailyNoteFile(file, currentCache);
    const mode = getViewMode(view) || 'unknown';
    const signature = [
      file.path,
      mode,
      showTopNavigation ? 'nav' : 'no-nav',
      relationshipPlacement,
      showScheduledButton && scheduledDate ? scheduledDate.toISOString() : 'no-scheduled',
      isCurrentDailyNote ? 'daily' : 'not-daily',
      showStackedProperties ? 'stacked' : 'no-stacked',
      'custom',
    ].join('|');
    const existing = this.topParentNavs.get(view) || null;
    if (
      !options.force &&
      existing?.isConnected &&
      existing.dataset.filePath === file.path &&
      existing.dataset.signature === signature &&
      existing.parentElement === titleEl.parentElement &&
      existing.previousElementSibling === titleEl
    ) {
      this.ensureBottomParentNav(view);
      return;
    }

    this.removeTopParentNav(view, { reserveFootprint: false });

    const container = document.createElement('div');
    container.className = 'tps-gcm-top-parent-nav';
    container.dataset.filePath = file.path;
    container.dataset.signature = signature;
    container.style.display = showScheduledButton ? '' : 'none';

    if (showScheduledButton && scheduledDate) {
      for (const button of this.createScheduledNavButtons(view, file, scheduledDate, isCurrentDailyNote, 'top')) {
        container.appendChild(button);
      }
    }

    if (showTopNavigation && relationshipPlacement === 'top') {
      const relationshipButtons = this.createRelationshipNavButtons(view, file, 'top');
      for (const button of relationshipButtons) {
        container.appendChild(button);
      }
      if (relationshipButtons.length > 0) {
        container.style.display = '';
      }
    }

    const stackedPropertiesPanel = showStackedProperties
      ? this.plugin.menuController.getPanelBuilder().createStackedPropertiesPanel(file)
      : null;
    if (stackedPropertiesPanel) {
      container.classList.add('tps-gcm-top-parent-nav--with-properties');
      view.contentEl.classList.add('tps-gcm-stacked-properties-active');
      container.style.display = '';
      container.appendChild(stackedPropertiesPanel);
    } else {
      view.contentEl.classList.remove('tps-gcm-stacked-properties-active');
    }

    titleEl.parentElement?.insertBefore(container, titleEl.nextElementSibling);
    this.topParentNavs.set(view, container);
    this.ensureBottomParentNav(view);
  }

  private getTopParentNavPlacement(): 'top' | 'bottom' {
    return this.plugin.settings.topParentNavPlacement === 'bottom' ? 'bottom' : 'top';
  }

  private isTpsHealthFoodPropertyRecord(file: TFile): boolean {
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter || {}) as Record<string, unknown>;
    const kind = String(frontmatter.kind || '').trim().toLowerCase();
    if (kind === 'food') return true;

    const frontmatterTags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags
      : typeof frontmatter.tags === 'string'
        ? frontmatter.tags.split(/[,\s]+/)
        : [];
    const bodyTags = (cache?.tags || []).map((entry) => entry?.tag);
    return [...frontmatterTags, ...bodyTags]
      .map((tag) => String(tag || '').trim().replace(/^#/, '').toLowerCase())
      .includes('tps/food');
  }

  private ensureBottomParentNav(view: MarkdownView, menuEl?: HTMLElement | null): void {
    const existing = this.bottomParentNavs.get(view);
    if (existing) {
      existing.remove();
      this.bottomParentNavs.delete(view);
    }

    const file = view.file;
    if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') return;
    if (this.plugin.settings.enableTopParentNav !== true) return;
    if (this.fileMatchesIgnoreRules(file, this.plugin.settings.inlineMenu_IgnoreRules)) return;
    const renderFullParentNav = this.getTopParentNavPlacement() === 'bottom';
    const renderMobileExternalActions = Platform.isMobile || document.body.classList.contains('is-mobile') || document.body.classList.contains('is-phone');
    if (!renderFullParentNav && !renderMobileExternalActions) return;

    const targets = menuEl
      ? [menuEl]
      : [this.menus.get(view)?.live, this.menus.get(view)?.reading].filter((el): el is HTMLElement => !!el?.isConnected);

    for (const targetMenu of targets) {
      targetMenu.querySelectorAll('.tps-gcm-bottom-parent-nav').forEach((node) => node.remove());
      const actionBar = targetMenu.querySelector<HTMLElement>('.tps-gcm-action-bar');
      if (!actionBar) continue;

      const buttons = renderFullParentNav
        ? [
          ...this.createScheduledNavButtonsForFile(view, file, 'bottom'),
          ...this.createRelationshipNavButtons(view, file, 'bottom'),
        ]
        : this.createExternalActionButtons(file, 'bottom', 'tps-gcm-parent-nav-button tps-gcm-parent-nav-button--bottom');
      if (!buttons.length) continue;

      const group = document.createElement('div');
      group.className = 'tps-gcm-bottom-parent-nav';
      group.dataset.filePath = file.path;
      for (const button of buttons) {
        group.appendChild(button);
      }
      actionBar.insertBefore(group, actionBar.firstChild);
      this.bottomParentNavs.set(view, group);
    }
  }

  private createScheduledNavButtonsForFile(view: MarkdownView, file: TFile, placement: 'top' | 'bottom'): HTMLElement[] {
    const scheduledDate = this.getScheduledDateForFile(file);
    if (!scheduledDate) return [];
    const currentCache = this.plugin.app.metadataCache.getFileCache(file);
    return this.createScheduledNavButtons(view, file, scheduledDate, this.isDailyNoteFile(file, currentCache), placement);
  }

  private createScheduledNavButtons(
    view: MarkdownView,
    file: TFile,
    scheduledDate: Date,
    isCurrentDailyNote: boolean,
    placement: 'top' | 'bottom',
  ): HTMLElement[] {
    const className = `tps-gcm-parent-nav-button tps-gcm-parent-nav-button--${placement}`;
    const buttons: HTMLElement[] = [];

    const calendarButton = document.createElement('button');
    calendarButton.type = 'button';
    calendarButton.className = className;
    calendarButton.title = 'Open calendar at scheduled time';
    setIcon(calendarButton, 'calendar-clock');

    const calendarLabel = document.createElement('span');
    calendarLabel.className = 'tps-gcm-parent-nav-label';
    calendarLabel.textContent = 'Calendar';
    calendarButton.appendChild(calendarLabel);
    this.trackCalendarButtonTimer(file, scheduledDate, calendarLabel, calendarButton);

    addSafeClickListener(calendarButton, (evt) => {
      evt.preventDefault();
      void this.showCalendarItemsPopover(calendarButton, scheduledDate, file);
    });

    buttons.push(calendarButton);

    if (!isCurrentDailyNote) {
      const dailyNoteButton = document.createElement('button');
      dailyNoteButton.type = 'button';
      dailyNoteButton.className = className;
      dailyNoteButton.title = `Open daily note for ${this.formatScheduledDayLabel(scheduledDate)}`;
      setIcon(dailyNoteButton, 'calendar-days');

      const dailyNoteLabel = document.createElement('span');
      dailyNoteLabel.className = 'tps-gcm-parent-nav-label';
      dailyNoteLabel.textContent = this.formatScheduledDayLabel(scheduledDate);
      dailyNoteButton.appendChild(dailyNoteLabel);

      addSafeClickListener(dailyNoteButton, () => {
        this.plugin.dailyNoteNavManager?.goToDate?.(this.formatScheduledIsoDate(scheduledDate), 0, view.leaf);
      });

      buttons.push(dailyNoteButton);
    }

    return buttons;
  }

  private createRelationshipNavButtons(view: MarkdownView, file: TFile, placement: 'top' | 'bottom'): HTMLElement[] {
    const parentFiles = this.resolveParentFiles(file);
    const childFiles = this.resolveChildFiles(file);
    const relationshipPaths = this.getParentChildRelationshipPaths(file, parentFiles);
    const embeddedTargets = this.getEmbeddedMarkdownTargetPaths(file);
    const promotedChecklistTargets = this.plugin.settings.ignoreEmbeddedChildrenInTopLinks
      ? this.getPromotedChecklistLinkedTargetPaths(file)
      : null;
    const { incoming: rawIncoming, outgoing: rawOutgoing } = this.getDirectLinks(file);
    const incoming = rawIncoming.filter((linkFile) => !relationshipPaths.has(linkFile.path));
    const outgoing = rawOutgoing.filter((linkFile) => {
      if (relationshipPaths.has(linkFile.path)) return false;
      if (embeddedTargets?.has(linkFile.path)) return false;
      if (promotedChecklistTargets?.has(linkFile.path)) return false;
      return true;
    });
    const totalLinks = incoming.length + outgoing.length;
    const className = `tps-gcm-parent-nav-button tps-gcm-parent-nav-button--${placement}`;
    const buttons: HTMLElement[] = [];

    const tasksButton = document.createElement('button');
    tasksButton.type = 'button';
    tasksButton.className = className;
    tasksButton.title = 'View tasks in this note';
    setIcon(tasksButton, 'list-checks');

    const tasksLabel = document.createElement('span');
    tasksLabel.className = 'tps-gcm-parent-nav-label';
    tasksLabel.textContent = 'Tasks';
    tasksButton.appendChild(tasksLabel);

    addSafeClickListener(tasksButton, () => {
      void this.showNoteTasksPopover(tasksButton, file);
    });

    buttons.push(tasksButton);
    void this.refreshNoteTasksButtonLabel(file, tasksLabel, tasksButton);

    buttons.push(...this.createExternalActionButtons(file, placement, className));

    if (childFiles.length > 0) {
      const childrenButton = document.createElement('button');
      childrenButton.type = 'button';
      childrenButton.className = className;
      childrenButton.title = 'View child notes';
      setIcon(childrenButton, 'list-tree');

      const childrenLabel = document.createElement('span');
      childrenLabel.className = 'tps-gcm-parent-nav-label';
      childrenLabel.textContent = childFiles.length === 1 ? '1 Child' : `${childFiles.length} Children`;
      childrenButton.appendChild(childrenLabel);

      addSafeClickListener(childrenButton, () => {
        void this.toggleTopChildrenPopover(childrenButton, file);
      });

      buttons.push(childrenButton);
      void this.refreshTopChildrenButtonLabel(file, childrenLabel, childrenButton);
    }

    if (totalLinks > 0) {
      const linksButton = document.createElement('button');
      linksButton.type = 'button';
      linksButton.className = className;
      linksButton.title = 'View links and mentions';
      setIcon(linksButton, 'link');

      const linksLabel = document.createElement('span');
      linksLabel.className = 'tps-gcm-parent-nav-label';
      linksLabel.textContent = totalLinks === 1 ? '1 Mention' : `${totalLinks} Mentions`;
      linksButton.appendChild(linksLabel);

      addSafeClickListener(linksButton, () => {
        const latestParents = this.resolveParentFiles(file);
        const latestRelationshipPaths = this.getParentChildRelationshipPaths(file, latestParents);
        const latestEmbeddedTargets = this.getEmbeddedMarkdownTargetPaths(file);
        const latestPromotedChecklistTargets = this.plugin.settings.ignoreEmbeddedChildrenInTopLinks
          ? this.getPromotedChecklistLinkedTargetPaths(file)
          : null;
        const { incoming: refreshedIncoming, outgoing: refreshedOutgoing } = this.getDirectLinks(file);
        const currentIncoming = refreshedIncoming.filter((linkFile) => !latestRelationshipPaths.has(linkFile.path));
        const currentOutgoing = refreshedOutgoing.filter((linkFile) => {
          if (latestRelationshipPaths.has(linkFile.path)) return false;
          if (latestEmbeddedTargets?.has(linkFile.path)) return false;
          if (latestPromotedChecklistTargets?.has(linkFile.path)) return false;
          return true;
        });
        this.toggleTopLinksPopover(linksButton, file, currentOutgoing, currentIncoming);
      });

      buttons.push(linksButton);
      void this.refreshTopLinksButtonLabel(file, linksLabel, linksButton);
    }

    if (parentFiles.length > 0) {
      const parentButton = document.createElement('button');
      parentButton.type = 'button';
      parentButton.className = className;
      parentButton.title = parentFiles.length === 1 ? 'Go to parent' : 'Select parent';
      setIcon(parentButton, 'arrow-up');

      const parentLabel = document.createElement('span');
      parentLabel.className = 'tps-gcm-parent-nav-label';
      parentLabel.textContent = parentFiles.length === 1 ? 'Parent' : `${parentFiles.length} Parents`;
      parentButton.appendChild(parentLabel);

      addSafeClickListener(parentButton, () => {
        const latestParents = this.resolveParentFiles(file);
        if (latestParents.length === 1) {
          void this.plugin.openFileInLeaf(latestParents[0], false, () => this.plugin.app.workspace.getLeaf(false), {
            revealLeaf: true,
            ignoreCanvasDragGuard: true,
          });
          return;
        }
        const menu = new Menu();
        for (const parentFile of latestParents) {
          menu.addItem((item) => {
            item
              .setTitle(this.getFileDisplayTitle(parentFile))
              .setIcon('file-text')
              .onClick(() => {
                void this.plugin.openFileInLeaf(parentFile, false, () => this.plugin.app.workspace.getLeaf(false), {
                  revealLeaf: true,
                  ignoreCanvasDragGuard: true,
                });
              });
          });
        }
        const rect = parentButton.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom });
      });
      parentButton.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        const latestParents = this.resolveParentFiles(file);
        if (!latestParents.length) return;
        const menu = new Menu();
        for (const parentFile of latestParents) {
          menu.addItem((item) => {
            item
              .setTitle(latestParents.length === 1
                ? 'Break connection with parent'
                : `Break connection with ${this.getFileDisplayTitle(parentFile)}`)
              .setIcon('unlink')
              .onClick(() => {
                void this.plugin.bulkEditService.unlinkFromParent(file, parentFile).then(() => {
                  new Notice(`Removed parent link: ${this.getFileDisplayTitle(parentFile)}`);
                  this.ensureTopParentNav(view, { force: true });
                });
              });
          });
        }
        menu.showAtMouseEvent(evt);
      });

      buttons.push(parentButton);
    }

    return buttons;
  }

  private createExternalActionButtons(file: TFile, placement: 'top' | 'bottom', className: string): HTMLElement[] {
    const actions = this.plugin.getExternalActions?.() || [];
    if (!actions.length) return [];

    return actions.map((action) => {
      const context: GcmExternalActionContext = { file, placement };
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `${className} tps-gcm-parent-nav-button--external`;
      button.dataset.tpsGcmExternalActionId = `${action.pluginId}:${action.id}`;
      button.dataset.tpsGcmExternalPluginId = action.pluginId;
      button.dataset.tpsGcmExternalActionKey = action.id;
      button.title = typeof action.title === 'string' ? action.title : String(action.label || action.id);
      button.toggleClass('is-hidden', true);
      button.style.display = 'none';

      const icon = document.createElement('span');
      icon.className = 'tps-gcm-parent-nav-icon';
      button.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'tps-gcm-parent-nav-label';
      label.textContent = typeof action.label === 'string' ? action.label : action.id;
      button.appendChild(label);

      addSafeClickListener(button, (evt) => {
        evt.preventDefault();
        void action.onClick(context);
      });

      void this.refreshExternalActionButton(action, context, button, icon, label);
      return button;
    });
  }

  private async refreshExternalActionButton(
    action: GcmExternalActionRegistration,
    context: GcmExternalActionContext,
    button: HTMLElement,
    iconEl: HTMLElement,
    labelEl: HTMLElement,
  ): Promise<void> {
    try {
      const visible = typeof action.isVisible === 'function' ? await action.isVisible(context) : true;
      button.toggleClass('is-hidden', visible !== true);
      if (!visible) {
        button.style.display = 'none';
        button.remove();
        return;
      }
      button.style.removeProperty('display');

      const [icon, label, title] = await Promise.all([
        this.resolveExternalActionValue(action.icon, context, ''),
        this.resolveExternalActionValue(action.label, context, action.id),
        this.resolveExternalActionValue(action.title, context, String(action.label || action.id)),
      ]);
      if (icon) setIcon(iconEl, icon);
      else iconEl.empty();
      labelEl.textContent = label || action.id;
      button.title = title || label || action.id;
    } catch (error) {
      logger.warn('[TPS GCM] Failed to refresh external action button', action.id, error);
      button.toggleClass('is-hidden', true);
    }
  }

  private async resolveExternalActionValue(
    value: string | ((context: GcmExternalActionContext) => string | Promise<string>) | undefined,
    context: GcmExternalActionContext,
    fallback: string,
  ): Promise<string> {
    if (typeof value === 'function') return String(await value(context) || fallback);
    if (typeof value === 'string') return value;
    return fallback;
  }

  private async ensureNativePropertyRows(file: TFile): Promise<void> {
    if (this.nativePropertyInitializationInFlight.has(file.path)) return;

    const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const entries = [{ file, frontmatter }];
    const applicableProperties = resolveCustomProperties(
      this.plugin.settings.properties || [],
      entries,
      new ViewModeService(),
      'inline',
    ).filter((property) => property && property.showInCollapsed !== false);

    const updates: Record<string, unknown> = {};
    for (const property of applicableProperties) {
      const key = String(property?.key || '').trim();
      if (!key || property?.type === 'folder') continue;
      if (this.hasFrontmatterKey(frontmatter, key)) continue;
      updates[key] = this.getNativePropertyDefaultValue(property);
    }

    if (Object.keys(updates).length === 0) return;

    this.nativePropertyInitializationInFlight.add(file.path);
    try {
      await this.plugin.bulkEditService.updateFrontmatter([file], updates);
      this.scheduleNativePropertyVisibilityForFile(file);
    } catch (error) {
      logger.error('[TPS GCM] Failed to initialize native property rows:', file.path, error);
    } finally {
      this.nativePropertyInitializationInFlight.delete(file.path);
    }
  }

  private getNativePropertyDefaultValue(property: any): unknown {
    if (property?.type === 'checkbox' || property?.type === 'boolean') return false;
    return '';
  }

  private hasFrontmatterKey(frontmatter: Record<string, unknown>, key: string): boolean {
    if (!frontmatter || !key) return false;
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) return true;
    const lower = key.toLowerCase();
    return Object.keys(frontmatter).some((candidate) => candidate.toLowerCase() === lower);
  }

  private scheduleNativePropertyVisibility(view: MarkdownView, file: TFile): void {
    this.attachNativePropertyObserver(view, file);
    this.applyNativePropertyVisibility(view, file);
    this.syncPersistentMenuForNativeProperties(view, file);
    for (const delay of [50, 150, 350, 900, 1600]) {
      window.setTimeout(() => {
        this.applyNativePropertyVisibilityIfCurrent(view, file);
        this.syncPersistentMenuForNativeProperties(view, file);
      }, delay);
    }
  }

  private scheduleNativePropertyVisibilityForFile(file: TFile): void {
    window.setTimeout(() => {
      for (const [view] of this.menus.entries()) {
        if (view.file?.path === file.path) {
          this.applyNativePropertyVisibility(view, file);
          this.syncPersistentMenuForNativeProperties(view, file);
        }
      }
    }, 150);
  }

  private applyNativePropertyVisibility(view: MarkdownView, file: TFile): void {
    this.clearNativePropertyVisibility(view);
  }

  private syncPersistentMenuForNativeProperties(view: MarkdownView, file: TFile): void {
    if (!this.shouldMirrorNativePropertyExpansionInPersistentMenu()) {
      this.setNativePropertiesExpandedClass(view, undefined);
      this.nativePropertiesExpandedStateByView.delete(view);
      return;
    }
    if (view.file?.path !== file.path) return;

    const expanded = this.getNativePropertiesExpandedState(view);
    this.setNativePropertiesExpandedClass(view, expanded);
    const previous = this.nativePropertiesExpandedStateByView.get(view);
    if (previous === expanded) return;

    this.nativePropertiesExpandedStateByView.set(view, expanded);
    this.rebuildPersistentPanelsForFile(view, file);
  }

  private setNativePropertiesExpandedClass(view: MarkdownView, expanded: boolean | undefined): void {
    const expandedClass = expanded === true;
    view.contentEl.classList.toggle('tps-gcm-native-properties-expanded', expandedClass);
    this.applyNativePropertiesExpandedClassToPersistentMenus(view, expandedClass);
    this.applyPersistentContextStripVisibility(view, expanded);
  }

  private applyNativePropertiesExpandedClassToPersistentMenus(view: MarkdownView, expanded: boolean): void {
    const menus = this.getPersistentMenusForView(view);
    if (menus.length === 0) return;
    for (const menu of menus) {
      menu.classList.toggle('tps-gcm-native-properties-expanded', expanded);
    }
  }

  private applyPersistentContextStripVisibility(
    view: MarkdownView,
    expanded: boolean | undefined = this.getNativePropertiesExpandedState(view),
  ): void {
    const shouldHide = expanded === true;
    const menus = this.getPersistentMenusForView(view);
    if (menus.length > 0) {
      for (const menu of menus) {
        const strip = menu.querySelector<HTMLElement>('.tps-gcm-context-strip');
        if (strip) {
          strip.style.display = shouldHide ? 'none' : '';
        }
      }
      return;
    }

    view.contentEl
      .querySelectorAll<HTMLElement>('.tps-global-context-menu--persistent .tps-gcm-context-strip')
      .forEach((strip) => {
        strip.style.display = shouldHide ? 'none' : '';
      });
  }

  private shouldMirrorNativePropertyExpansionInPersistentMenu(): boolean {
    return false;
  }

  private getNativePropertiesExpandedState(view: MarkdownView): boolean | undefined {
    const root = view.contentEl;
    if (!root) return undefined;

    const propertiesHeadingCandidates = Array.from(
      root.querySelectorAll<HTMLElement>(
        this.getNativePropertiesControlSelector()
      ),
    ).filter((candidate) => this.isLikelyNativePropertiesControl(candidate));

    const expandedHeading = propertiesHeadingCandidates.find((candidate) => candidate.getAttribute('aria-expanded') === 'true');
    if (expandedHeading) return true;
    const collapsedHeading = propertiesHeadingCandidates.find((candidate) => candidate.getAttribute('aria-expanded') === 'false');
    if (collapsedHeading) return false;

    const collapsedHintCandidate = propertiesHeadingCandidates.find((candidate) => {
      const text = this.getNativePropertiesControlText(candidate);
      return /collapse/.test(text);
    });
    if (collapsedHintCandidate) return true;

    const expandedHintCandidate = propertiesHeadingCandidates.find((candidate) => {
      const text = this.getNativePropertiesControlText(candidate);
      return /expand/.test(text);
    });
    if (expandedHintCandidate) return false;

    const visibleRows = Array.from(
      root.querySelectorAll<HTMLElement>(
        [
          '.metadata-container .metadata-property',
          '.metadata-container .metadata-property-container',
          '.metadata-properties .metadata-property',
          '.metadata-properties .metadata-property-container',
          '.metadata-container .metadata-add-button',
        ].join(', '),
      )
    ).filter((row) => this.isNativePropertyNodeVisible(row));
    if (visibleRows.length > 0) return true;

    const metadataContainer = root.querySelector<HTMLElement>('.metadata-container, .metadata-properties');
    if (!metadataContainer) return undefined;
    const metadataStyle = window.getComputedStyle(metadataContainer);
    if (metadataStyle.display === 'none' || metadataStyle.visibility === 'hidden') return false;

    return undefined;
  }

  private isNativePropertyNodeVisible(node: HTMLElement): boolean {
    if (!node.isConnected) return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = node.getClientRects()[0];
    if (!rect) return false;
    return rect.width > 0 && rect.height > 0;
  }

  private getPersistentMenusForView(view: MarkdownView): HTMLElement[] {
    const cached = this.menus.get(view);
    const candidates = [
      cached?.reading,
      cached?.live,
    ].filter((menu): menu is HTMLElement => !!menu);
    if (candidates.length > 0) return candidates;

    if (!view.contentEl) return [];
    return Array.from(view.contentEl.querySelectorAll<HTMLElement>('.tps-global-context-menu--persistent'));
  }

  private rebuildPersistentPanelsForFile(
    view: MarkdownView,
    file: TFile,
  ): void {
    const instances = this.menus.get(view);
    if (!instances) return;

    const rebuild = (menuEl: HTMLElement | null | undefined): void => {
      if (!menuEl?.isConnected) return;
      const panel = this.plugin.buildSpecialPanel(file, {
        recurrenceRoot: menuEl,
        closeAfterRecurrence: false,
      });
      const existingPanel = menuEl.querySelector<HTMLElement>('.tps-gcm-panel');
      if (existingPanel) {
        existingPanel.replaceWith(panel);
      } else {
        menuEl.appendChild(panel);
      }
      this.applyPersistentMenuGeometry(view, menuEl);
    };

    rebuild(instances.reading);
    rebuild(instances.live);
  }

  private reorderNativePropertyRows(rows: HTMLElement[]): void {
    const order = new Map<string, number>();
    (this.plugin.settings.properties || []).forEach((property: any, index: number) => {
      const key = String(property?.key || '').trim().toLowerCase();
      if (key && !order.has(key)) order.set(key, index);
    });
    if (order.size === 0) return;

    const grouped = new Map<HTMLElement, HTMLElement[]>();
    for (const row of rows) {
      const key = this.readNativePropertyRowKey(row).toLowerCase();
      if (!order.has(key) || !row.parentElement) continue;
      const siblings = grouped.get(row.parentElement) || [];
      siblings.push(row);
      grouped.set(row.parentElement, siblings);
    }

    for (const [parent, siblings] of grouped.entries()) {
      const sorted = [...siblings].sort((a, b) => {
        const aOrder = order.get(this.readNativePropertyRowKey(a).toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
        const bOrder = order.get(this.readNativePropertyRowKey(b).toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder;
      });
      for (const row of sorted) parent.appendChild(row);
    }
  }

  private attachNativePropertyRowContextMenu(row: HTMLElement, file: TFile): void {
    if (row.dataset.tpsGcmPropertyContextMenu === 'true') return;
    row.dataset.tpsGcmPropertyContextMenu = 'true';
    row.addEventListener('contextmenu', (event) => {
      const key = this.readNativePropertyRowKey(row);
      const property = this.findConfiguredPropertyByKey(key);
      if (!property) return;
      event.preventDefault();
      event.stopPropagation();
      this.openNativePropertyContextMenu(event, file, property);
    });
  }

  private openNativePropertyContextMenu(event: MouseEvent, file: TFile, property: any): void {
    const menu = new Menu();
    const label = String(property?.label || property?.key || 'Property');
    const index = this.findConfiguredPropertyIndex(property);
    const visibilityMode = getCustomPropertySurfaceVisibilityMode(property, 'inline');
    const visibilityPatch = (mode: NonNullable<CustomProperty['showWhen']>) =>
      createCustomPropertySurfaceVisibilityPatch('inline', mode);

    menu.addItem((item) => {
      item
        .setTitle('Move property up')
        .setIcon('arrow-up')
        .setDisabled(index <= 0)
        .onClick(() => void this.moveConfiguredProperty(property, -1, file));
    });
    menu.addItem((item) => {
      item
        .setTitle('Move property down')
        .setIcon('arrow-down')
        .setDisabled(index < 0 || index >= (this.plugin.settings.properties || []).length - 1)
        .onClick(() => void this.moveConfiguredProperty(property, 1, file));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle('Remove property from file')
        .setIcon('trash-2')
        .setDisabled(!String(property?.key || '').trim())
        .onClick(() => void this.removePropertyFromFile(property, file));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle('Use property visibility')
        .setIcon('undo-2')
        .setChecked(!property?.inlineShowWhen)
        .onClick(() => void this.updateConfiguredProperty(
          property,
          { hidden: false, showInCollapsed: true, inlineShowWhen: undefined },
          file,
          `${label} uses property visibility inline`,
        ));
    });
    menu.addItem((item) => {
      item
        .setTitle('Add hide rule to property')
        .setIcon('eye-off')
        .onClick(() => void this.updateConfiguredProperty(property, visibilityPatch('never'), file, `${label} hidden inline`));
    });
    menu.addItem((item) => {
      item
        .setTitle('Only show when missing or empty')
        .setIcon('circle')
        .setChecked(visibilityMode === 'empty')
        .onClick(() => void this.updateConfiguredProperty(property, visibilityPatch('empty'), file, `${label} shown inline only when missing or empty`));
    });
    menu.addItem((item) => {
      item
        .setTitle('Only show when key exists')
        .setIcon('key')
        .setChecked(visibilityMode === 'exists')
        .onClick(() => void this.updateConfiguredProperty(property, visibilityPatch('exists'), file, `${label} shown inline only when key exists`));
    });
    menu.addItem((item) => {
      item
        .setTitle('Only show when key exists but is empty')
        .setIcon('circle')
        .setChecked(visibilityMode === 'blank')
        .onClick(() => void this.updateConfiguredProperty(property, visibilityPatch('blank'), file, `${label} shown inline only when key exists but is empty`));
    });
    menu.addItem((item) => {
      item
        .setTitle('Only show when key is missing')
        .setIcon('circle-slash')
        .setChecked(visibilityMode === 'missing')
        .onClick(() => void this.updateConfiguredProperty(property, visibilityPatch('missing'), file, `${label} shown inline only when key is missing`));
    });
    menu.addItem((item) => {
      item
        .setTitle('Only show when populated')
        .setIcon('circle-dot')
        .setChecked(visibilityMode === 'populated')
        .onClick(() => void this.updateConfiguredProperty(property, visibilityPatch('populated'), file, `${label} shown inline only when populated`));
    });
    menu.addItem((item) => {
      item
        .setTitle('Always show even when empty')
        .setIcon('eye')
        .setChecked(visibilityMode === 'always')
        .onClick(() => void this.updateConfiguredProperty(property, visibilityPatch('always'), file, `${label} always shown inline`));
    });
    menu.addItem((item) => {
      item
        .setTitle('Never show')
        .setIcon('eye-off')
        .setChecked(visibilityMode === 'never')
        .onClick(() => void this.updateConfiguredProperty(property, visibilityPatch('never'), file, `${label} hidden inline`));
    });
    menu.showAtMouseEvent(event);
  }

  private findConfiguredPropertyByKey(key: string): any | null {
    const normalized = String(key || '').trim().toLowerCase();
    if (!normalized) return null;
    return (this.plugin.settings.properties || []).find((property: any) =>
      String(property?.key || '').trim().toLowerCase() === normalized,
    ) || null;
  }

  private findConfiguredPropertyIndex(property: any): number {
    const id = String(property?.id || '').trim();
    const key = String(property?.key || '').trim().toLowerCase();
    return (this.plugin.settings.properties || []).findIndex((candidate: any) => {
      if (id && String(candidate?.id || '').trim() === id) return true;
      return !!key && String(candidate?.key || '').trim().toLowerCase() === key;
    });
  }

  private async moveConfiguredProperty(property: any, direction: -1 | 1, file: TFile): Promise<void> {
    const properties = this.plugin.settings.properties || [];
    const index = this.findConfiguredPropertyIndex(property);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= properties.length) return;
    const [moved] = properties.splice(index, 1);
    properties.splice(nextIndex, 0, moved);
    this.plugin.settings.properties = properties;
    await this.plugin.saveSettings();
    this.scheduleNativePropertyVisibilityForFile(file);
    this.refreshMenusForFile(file, true);
    new Notice(`Moved ${String(moved?.label || moved?.key || 'property')}.`);
  }

  private async updateConfiguredProperty(property: any, patch: Partial<CustomProperty>, file: TFile, notice: string): Promise<void> {
    const properties = this.plugin.settings.properties || [];
    const index = this.findConfiguredPropertyIndex(property);
    if (index < 0) return;
    await applyCustomPropertyVisibilityUpdate({
      properties,
      index,
      patch,
      commit: (nextProperties) => {
        this.plugin.settings.properties = nextProperties;
      },
      refresh: () => this.refreshCustomPropertyPresentations(),
      persist: () => this.plugin.saveSettings(),
      onRefreshError: (error) => {
        logger.warn('[TPS GCM] Immediate property visibility refresh failed', {
          path: file.path,
          error,
        });
      },
    });
    new Notice(notice);
  }

  /** Rebuilds the current file's custom-property panel before async persistence fans out. */
  refreshCustomPropertyPresentations(): void {
    refreshMountedCustomPropertyPresentationViews(
      [this.menus.keys(), this.topParentNavs.keys()],
      (view, options) => this.ensureTopParentNav(view, options),
      (view, error) => {
        logger.warn('[TPS GCM] Failed refreshing mounted property presentation', {
          path: view.file?.path || null,
          error,
        });
      },
    );
    try {
      this.refreshBaseLinkPreviewProperties();
    } catch (error) {
      logger.warn('[TPS GCM] Failed refreshing editable Base-link preview properties', { error });
    }
    try {
      this.plugin.refreshCustomPropertyPreviewSurfaces();
    } catch (error) {
      logger.warn('[TPS GCM] Failed refreshing Bases/hover preview properties', { error });
    }
  }

  private refreshBaseLinkPreviewProperties(): void {
    const popover = this.baseLinkPreviewEl;
    const file = this.baseLinkPreviewFile;
    if (!popover?.isConnected || !(file instanceof TFile)) return;

    const existing = popover.querySelector<HTMLElement>('.tps-gcm-base-link-preview-properties');
    const replacement = this.plugin.menuController.getPanelBuilder().createStackedPropertiesPanel(file);
    if (!replacement) {
      existing?.remove();
      return;
    }
    replacement.classList.add('tps-gcm-base-link-preview-properties');
    if (existing) {
      existing.replaceWith(replacement);
    } else {
      const header = popover.querySelector<HTMLElement>('.tps-gcm-base-link-preview-header');
      if (header) header.insertAdjacentElement('afterend', replacement);
      else popover.prepend(replacement);
    }
    this.baseLinkPreviewOverlay?.schedule();
  }

  private async removePropertyFromFile(property: any, file: TFile): Promise<void> {
    const key = String(property?.key || '').trim();
    if (!key) return;
    await this.plugin.frontmatterMutationService.deleteKeys([file], [key]);
    this.scheduleNativePropertyVisibilityForFile(file);
    this.refreshMenusForFile(file, true);
    void this.plugin.viewModeManager?.handlePotentialFrontmatterChange([file], [key]);
    new Notice(`Removed ${String(property?.label || key)} from ${file.basename}.`);
  }

  private applyNativePropertyVisibilityIfCurrent(view: MarkdownView, file: TFile): void {
    if (view.file?.path !== file.path) return;
    this.applyNativePropertyVisibility(view, file);
  }

  private attachNativePropertyObserver(view: MarkdownView, file: TFile): void {
    if (typeof MutationObserver === 'undefined') return;
    if (this.nativePropertyObservers.has(view)) return;
    const root = view.contentEl as HTMLElement | undefined;
    if (!root) return;

    const schedule = () => {
      const existing = this.nativePropertyRefreshTimers.get(view);
      if (existing !== undefined) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        this.nativePropertyRefreshTimers.delete(view);
        this.applyNativePropertyVisibilityIfCurrent(view, file);
        this.syncPersistentMenuForNativeProperties(view, file);
      }, 40);
      this.nativePropertyRefreshTimers.set(view, timer);
    };

    const clickHandler: EventListener = (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const control = target?.closest<HTMLElement>(
        this.getNativePropertiesControlSelector()
      );
      if (!this.isLikelyNativePropertiesControl(control)) return;
      schedule();
      window.setTimeout(schedule, 100);
    };
    root.addEventListener('click', clickHandler, true);
    this.nativePropertyClickHandlers.set(view, clickHandler);

    const isRelevant = (mutation: MutationRecord): boolean => {
      const nodes: Node[] = [mutation.target, ...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
      return nodes.some((node) => {
        const el = node instanceof HTMLElement
          ? node
          : node.parentElement instanceof HTMLElement
            ? node.parentElement
            : null;
        if (!el) return false;
        return !!el.closest([
          '.metadata-container',
          '.metadata-properties',
          '.metadata-property',
          '.metadata-property-container',
        ].join(', '));
      });
    };

    const observer = new MutationObserver((mutations) => {
      if (mutations.some(isRelevant)) schedule();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-property-key', 'data-property-name', 'aria-expanded', 'aria-label'],
    });
    this.nativePropertyObservers.set(view, observer);
  }

  private detachNativePropertyObserver(view: MarkdownView): void {
    const observer = this.nativePropertyObservers.get(view);
    if (observer) {
      observer.disconnect();
      this.nativePropertyObservers.delete(view);
    }
    const timer = this.nativePropertyRefreshTimers.get(view);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.nativePropertyRefreshTimers.delete(view);
    }
    const clickHandler = this.nativePropertyClickHandlers.get(view);
    if (clickHandler) {
      view.contentEl.removeEventListener('click', clickHandler, true);
      this.nativePropertyClickHandlers.delete(view);
    }
  }

  private clearNativePropertyVisibility(view: MarkdownView): void {
    view.contentEl.classList.remove('tps-gcm-native-properties-active');
    this.setNativePropertiesExpandedClass(view, undefined);
    this.applyNativePropertiesExpandedClassToPersistentMenus(view, false);
    this.detachNativePropertyObserver(view);
    view.contentEl
      .querySelectorAll<HTMLElement>('.tps-gcm-native-property-hidden')
      .forEach((row) => row.classList.remove('tps-gcm-native-property-hidden'));
  }

  private readNativePropertyRowKey(row: HTMLElement): string {
    return String(
      row.dataset.propertyKey
      || row.dataset.propertyName
      || row.getAttribute('data-property-key')
      || row.getAttribute('data-property-name')
      || row.querySelector<HTMLElement>('[data-property-key]')?.dataset.propertyKey
      || row.querySelector<HTMLElement>('[data-property-name]')?.dataset.propertyName
      || row.querySelector<HTMLElement>('.metadata-property-key, .metadata-property-key-input')?.textContent
      || '',
    ).trim();
  }

  private isStrictSourceMode(view: MarkdownView): boolean {
    return isStrictSourceMode(view);
  }

  private async refreshTopLinksButtonLabel(file: TFile, labelEl: HTMLElement, buttonEl: HTMLElement): Promise<void> {
    try {
      const references = await this.plugin.menuController.getPanelBuilder().collectReferenceGroups(file);
      if (!labelEl.isConnected || !buttonEl.isConnected) return;
      const groupCount = references.outgoing.length + references.incoming.length + references.mentions.length;
      const occurrenceCount = [...references.outgoing, ...references.incoming, ...references.mentions]
        .reduce((count, group) => count + group.occurrences.length, 0);
      const count = occurrenceCount || groupCount;
      if (count > 0) {
        buttonEl.parentElement?.style.removeProperty('display');
        buttonEl.style.display = '';
        labelEl.textContent = count === 1 ? '1 Mention' : `${count} Mentions`;
        buttonEl.title = 'View links and mentions';
      } else {
        buttonEl.style.display = 'none';
        if (buttonEl.parentElement?.querySelectorAll('button').length === 1) {
          buttonEl.parentElement.style.display = 'none';
        }
        labelEl.textContent = '';
        buttonEl.title = 'View links and mentions';
      }
    } catch (error) {
      logger.warn('[TPS GCM] Failed refreshing top links label', { file: file.path, error });
    }
  }

  private async refreshTopChildrenButtonLabel(file: TFile, labelEl: HTMLElement, buttonEl: HTMLElement): Promise<void> {
    try {
      const children = await this.resolveChildFilesForTopButton(file);
      if (!labelEl.isConnected || !buttonEl.isConnected) return;
      const count = children.length;
      if (count > 0) {
        buttonEl.parentElement?.style.removeProperty('display');
        buttonEl.style.display = '';
        labelEl.textContent = count === 1 ? '1 Child' : `${count} Children`;
        buttonEl.title = 'View child notes';
      } else {
        buttonEl.style.display = 'none';
        labelEl.textContent = '';
        buttonEl.title = 'View child notes';
      }
    } catch (error) {
      logger.warn('[TPS GCM] Failed refreshing top children label', { file: file.path, error });
    }
  }

  private getScheduledDateForFile(file: TFile): Date | null {
    const fm = (this.plugin.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, unknown>;
    const raw = this.getFrontmatterValueCaseInsensitive(fm, 'scheduled')
      ?? this.getFrontmatterValueCaseInsensitive(fm, 'start')
      ?? this.getFrontmatterValueCaseInsensitive(fm, 'date');
    const millis = this.plugin.sharedServices?.schedule?.parseDateMillis(raw) ?? null;
    if (millis == null) return null;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private formatScheduledIsoDate(date: Date): string {
    const moment = (window as any).moment;
    if (moment) return moment(date).format('YYYY-MM-DD');
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatScheduledDayLabel(date: Date): string {
    const moment = (window as any).moment;
    if (moment) return moment(date).format('MMM D');
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  private async refreshCalendarButtonCount(date: Date, labelEl: HTMLElement, buttonEl: HTMLElement): Promise<void> {
    try {
      const count = await this.countCalendarItemsOnDay(date);
      if (!labelEl.isConnected || !buttonEl.isConnected) return;
      labelEl.textContent = count > 0 ? `Calendar (${count})` : 'Calendar';
      buttonEl.title = count > 0
        ? `Open calendar at scheduled time (${count} ${count === 1 ? 'item' : 'items'} on ${this.formatScheduledDayLabel(date)})`
        : 'Open calendar at scheduled time';
    } catch (error) {
      logger.warn('[TPS GCM] Failed counting calendar items for scheduled day', { date, error });
    }
  }

  private async refreshNoteTasksButtonLabel(file: TFile, labelEl: HTMLElement, buttonEl: HTMLElement): Promise<void> {
    try {
      const tasks = await this.collectTasksInFile(file);
      if (!labelEl.isConnected || !buttonEl.isConnected) return;
      if (tasks.length > 0) {
        labelEl.textContent = tasks.length === 1 ? '1 Task' : `${tasks.length} Tasks`;
        buttonEl.title = `View ${tasks.length} task${tasks.length === 1 ? '' : 's'} in this note`;
        buttonEl.style.display = '';
      } else {
        labelEl.textContent = 'Tasks';
        buttonEl.title = 'No tasks in this note';
        buttonEl.style.display = 'none';
      }
    } catch (error) {
      logger.warn('[TPS GCM] Failed counting note tasks', { file: file.path, error });
    }
  }

  private trackCalendarButtonTimer(file: TFile, date: Date, labelEl: HTMLElement, buttonEl: HTMLElement): void {
    const state: CalendarButtonTimerState = {
      file,
      scheduledDate: date,
      labelEl,
      buttonEl,
      count: null,
      sessionStart: null,
      activeCount: 0,
      lastFetchAt: 0,
      fetchInFlight: false,
    };
    this.calendarButtonTimerStates.add(state);
    void this.refreshCalendarButtonTimerState(state, true);
    this.ensureCalendarButtonTimerInterval();
  }

  private ensureCalendarButtonTimerInterval(): void {
    if (this.calendarButtonTimerInterval != null) return;
    this.calendarButtonTimerInterval = window.setInterval(() => {
      this.tickCalendarButtonTimers();
    }, 1000);
  }

  private tickCalendarButtonTimers(): void {
    if (this.calendarButtonTimerStates.size === 0) {
      this.stopCalendarButtonTimerInterval();
      return;
    }

    for (const state of Array.from(this.calendarButtonTimerStates)) {
      if (!state.labelEl.isConnected || !state.buttonEl.isConnected) {
        this.calendarButtonTimerStates.delete(state);
        continue;
      }
      this.renderCalendarButtonTimerState(state);
      if (Date.now() - state.lastFetchAt > 10_000) {
        void this.refreshCalendarButtonTimerState(state, false);
      }
    }
  }

  private stopCalendarButtonTimerInterval(): void {
    if (this.calendarButtonTimerInterval == null) return;
    window.clearInterval(this.calendarButtonTimerInterval);
    this.calendarButtonTimerInterval = null;
  }

  private async refreshCalendarButtonTimerState(state: CalendarButtonTimerState, force: boolean): Promise<void> {
    if (state.fetchInFlight) return;
    state.fetchInFlight = true;
    try {
      const [count, activeTimers] = await Promise.all([
        this.countCalendarItemsOnDay(state.scheduledDate),
        this.plugin.timeTrackingService.getActiveTimersForFile(state.file),
      ]);
      if (!state.labelEl.isConnected || !state.buttonEl.isConnected) {
        this.calendarButtonTimerStates.delete(state);
        return;
      }
      state.count = count;
      state.activeCount = activeTimers.length;
      state.sessionStart = activeTimers[0]?.start ?? null;
      state.lastFetchAt = Date.now();
      this.renderCalendarButtonTimerState(state);
    } catch (error) {
      if (force) {
        logger.warn('[TPS GCM] Failed refreshing calendar timer label', { file: state.file.path, error });
      }
      state.lastFetchAt = Date.now();
    } finally {
      state.fetchInFlight = false;
    }
  }

  private renderCalendarButtonTimerState(state: CalendarButtonTimerState): void {
    if (!state.labelEl.isConnected || !state.buttonEl.isConnected) return;
    const base = state.count != null && state.count > 0 ? `Calendar (${state.count})` : 'Calendar';
    if (state.sessionStart) {
      const elapsed = this.plugin.timeTrackingService.formatElapsed(
        this.plugin.timeTrackingService.getElapsedMsForSession({ start: state.sessionStart }),
      );
      state.labelEl.textContent = state.activeCount > 1 ? `${elapsed} +${state.activeCount - 1}` : elapsed;
      state.buttonEl.title = `${base} • running ${elapsed}${state.activeCount > 1 ? ` plus ${state.activeCount - 1} more` : ''}`;
      state.buttonEl.classList.add('is-running-time');
      return;
    }
    state.labelEl.textContent = base;
    state.buttonEl.title = state.count != null && state.count > 0
      ? `Open calendar at scheduled time (${state.count} ${state.count === 1 ? 'item' : 'items'} on ${this.formatScheduledDayLabel(state.scheduledDate)})`
      : 'Open calendar at scheduled time';
    state.buttonEl.classList.remove('is-running-time');
  }

  private async countCalendarItemsOnDay(date: Date): Promise<number> {
    return (await this.getCalendarItemsOnDay(date)).length;
  }

  private async getCalendarItemsOnDay(date: Date): Promise<CalendarPopoverItem[]> {
    const calendarBase = this.getCalendarBasePlugin();
    const settings = calendarBase?.api?.getSettings?.() ?? calendarBase?.settings ?? {};
    const externalEvents = (await this.getExternalCalendarEventsForDay(calendarBase, date))
      .filter((event) => !this.isExternalCalendarEventHidden(calendarBase, event))
      .filter((event) => !this.isExternalCalendarEventFiltered(calendarBase, event));
    const matchedExternalKeys = new Set<string>();
    const matchedUidDayKeys = new Set<string>();
    const items: CalendarPopoverItem[] = [];

    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      const scheduledTasks = await this.collectScheduledTasksForCalendarItem(file, date, settings);
      for (const task of scheduledTasks) {
        const localExternal = this.matchExternalEventForTaskMetadata(
          task.inlineProperties,
          task.title,
          task.date,
          externalEvents,
          settings,
        );
        const externalKey = localExternal
          ? this.buildExternalEventIdentityKey(localExternal.id, localExternal.sourceUrl)
          : '';
        const uid = localExternal
          ? this.normalizeIdentityValue(localExternal.uid || this.extractUidFromCompositeEventId(localExternal.id))
          : '';
        const uidDayKey = uid ? this.buildExternalUidDayKey(uid, localExternal?.sourceUrl, localExternal?.startDate) : '';
        items.push({
          title: task.title,
          subtitle: this.formatCalendarItemTime(task.date, false, 'Scheduled task'),
          sortTime: task.date.getTime(),
          file,
          lineNumber: task.lineNumber,
          completed: task.completed,
          rawLine: task.rawLine,
          kind: 'task',
          icon: task.completed ? 'square-check' : 'list-checks',
          color: task.completed ? 'var(--text-muted)' : 'var(--interactive-accent)',
          externalKey,
          uidDayKey,
          localSlotKey: this.buildCalendarPopoverLocalSlotKey(task.title, task.date),
        });

        if (localExternal) {
          matchedExternalKeys.add(externalKey);
          if (uid) matchedUidDayKeys.add(this.buildExternalUidDayKey(uid, localExternal.sourceUrl, localExternal.startDate));
        }
      }

      if (this.isDailyNoteFile(file, cache)) continue;
      const frontmatter = (cache?.frontmatter || {}) as Record<string, unknown>;
      const localDate = this.getScheduledDateFromFrontmatter(frontmatter);
      if (!localDate || !this.isDateOnSameLocalDay(localDate, date)) continue;
      const localExternal = this.matchExternalEventForLocalFrontmatter(
        frontmatter,
        localDate,
        externalEvents,
        settings,
        file,
      );
      const displayTitle = this.getFileDisplayTitle(file);
      items.push({
        title: displayTitle,
        subtitle: this.formatCalendarItemTime(localDate),
        sortTime: localDate.getTime(),
        file,
        kind: 'note',
        icon: this.resolveInlineTitleIconValue(file, frontmatter) || 'file-text',
        color: this.resolveTitleIconColor(frontmatter, file),
        externalKey: localExternal ? this.buildExternalEventIdentityKey(localExternal.id, localExternal.sourceUrl) : '',
        uidDayKey: localExternal
          ? this.buildExternalUidDayKey(
            this.normalizeIdentityValue(localExternal.uid || this.extractUidFromCompositeEventId(localExternal.id)),
            localExternal.sourceUrl,
            localExternal.startDate,
          )
          : '',
        localSlotKey: this.buildCalendarPopoverLocalSlotKey(displayTitle, localDate),
      });

      if (localExternal) {
        matchedExternalKeys.add(this.buildExternalEventIdentityKey(localExternal.id, localExternal.sourceUrl));
        const uid = this.normalizeIdentityValue(localExternal.uid || this.extractUidFromCompositeEventId(localExternal.id));
        if (uid) matchedUidDayKeys.add(this.buildExternalUidDayKey(uid, localExternal.sourceUrl, localExternal.startDate));
      }
    }

    const countedExternalKeys = new Set<string>();
    for (const event of externalEvents) {
      if (!this.doesEventOverlapLocalDay(event.startDate, event.endDate, date)) continue;
      const eventKey = this.buildExternalEventIdentityKey(event.id, event.sourceUrl);
      const uid = this.normalizeIdentityValue(event.uid || this.extractUidFromCompositeEventId(event.id));
      const uidDayKey = uid ? this.buildExternalUidDayKey(uid, event.sourceUrl, event.startDate) : '';
      if (matchedExternalKeys.has(eventKey) || (uidDayKey && matchedUidDayKeys.has(uidDayKey))) continue;
      if (countedExternalKeys.has(eventKey)) continue;
      countedExternalKeys.add(eventKey);
      const eventStart = new Date(event.startDate);
      items.push({
        title: String(event.title || 'Untitled event'),
        subtitle: this.formatCalendarItemTime(eventStart, true),
        sortTime: Number.isNaN(eventStart.getTime()) ? 0 : eventStart.getTime(),
        kind: 'external',
        icon: 'calendar-days',
        color: this.getExternalCalendarEventColor(calendarBase, event),
        location: event.location,
        description: event.description,
        externalKey: eventKey,
        uidDayKey,
        localSlotKey: this.buildCalendarPopoverLocalSlotKey(event.title, eventStart),
      });
    }

    return this.dedupeCalendarPopoverItems(items)
      .sort((a, b) => a.sortTime - b.sortTime || a.title.localeCompare(b.title));
  }

  private dedupeCalendarPopoverItems(items: CalendarPopoverItem[]): CalendarPopoverItem[] {
    const byKey = new Map<string, CalendarPopoverItem>();

    const consider = (key: string, item: CalendarPopoverItem) => {
      if (!key) return;
      const existing = byKey.get(key);
      if (!existing || this.getCalendarPopoverItemPriority(item) > this.getCalendarPopoverItemPriority(existing)) {
        byKey.set(key, item);
      }
    };

    for (const item of items) {
      if (item.externalKey) consider(`external:${item.externalKey}`, item);
      if (item.uidDayKey) consider(`uid-day:${item.uidDayKey}`, item);
      if (item.kind !== 'external' && item.localSlotKey) consider(`local-slot:${item.localSlotKey}`, item);
    }

    const winners = new Set(byKey.values());
    const output: CalendarPopoverItem[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const keys = [
        item.externalKey ? `external:${item.externalKey}` : '',
        item.uidDayKey ? `uid-day:${item.uidDayKey}` : '',
        item.kind !== 'external' && item.localSlotKey ? `local-slot:${item.localSlotKey}` : '',
      ].filter(Boolean);
      const hasDedupedKey = keys.length > 0;
      if (hasDedupedKey && !winners.has(item)) continue;

      const ownKey = keys[0]
        || `${item.kind || 'note'}:${item.file?.path || ''}:${item.lineNumber ?? ''}:${item.localSlotKey || item.title}`;
      if (seen.has(ownKey)) continue;
      seen.add(ownKey);
      output.push(item);
    }

    return output;
  }

  private getCalendarPopoverItemPriority(item: CalendarPopoverItem): number {
    if (item.kind === 'task') return 30;
    if (item.kind === 'note') return 20;
    if (item.kind === 'external') return 10;
    return 0;
  }

  private buildCalendarPopoverLocalSlotKey(title: unknown, date: Date): string {
    if (!date || Number.isNaN(date.getTime())) return '';
    const normalizedTitle = this.normalizeExternalMatchTitle(title);
    if (!normalizedTitle) return '';
    const roundedMinute = new Date(date);
    roundedMinute.setSeconds(0, 0);
    return `${this.formatScheduledIsoDate(roundedMinute)}T${String(roundedMinute.getHours()).padStart(2, '0')}:${String(roundedMinute.getMinutes()).padStart(2, '0')}::${normalizedTitle}`;
  }

  private async collectScheduledTasksForCalendarItem(
    file: TFile,
    date: Date,
    settings: Record<string, unknown>,
  ): Promise<Array<NoteTaskPopoverItem & { date: Date; inlineProperties: Map<string, string> }>> {
    const tasks = await this.collectTasksInFile(file);
    const scheduledKeys = this.getCalendarTaskScheduledKeys(settings);
    const results: Array<NoteTaskPopoverItem & { date: Date; inlineProperties: Map<string, string> }> = [];
    for (const task of tasks) {
      const inlineProperties = this.parseInlineTaskProperties(task.rawLine);
      const scheduledValue = scheduledKeys
        .map((key) => inlineProperties.get(key))
        .find((value): value is string => !!value?.trim());
      if (!scheduledValue) continue;
      const scheduledDate = this.parseScheduledValue(scheduledValue);
      if (!scheduledDate || !this.isDateOnSameLocalDay(scheduledDate, date)) continue;
      results.push({
        ...task,
        scheduledValue,
        date: scheduledDate,
        inlineProperties,
      });
    }
    return results;
  }

  private async collectTasksInFile(file: TFile): Promise<NoteTaskPopoverItem[]> {
    const content = await this.plugin.app.vault.cachedRead(file);
    return this.extractTasksFromContent(content, file);
  }

  private extractTasksFromContent(content: string, file: TFile): NoteTaskPopoverItem[] {
    const lines = String(content || '').split(/\r?\n/);
    const tasks: NoteTaskPopoverItem[] = [];
    for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
      const rawLine = lines[lineNumber] || '';
      const parsed = parseTaskLine(rawLine);
      if (!parsed) continue;
      const title = getTaskDisplayTitle(rawLine) || 'Task';
      const scheduledValue = resolveTaskScheduledValue(this.plugin.app, this.plugin.settings, file, rawLine)
        || undefined;
      tasks.push({
        title,
        lineNumber,
        completed: parsed.marker.trim().toLowerCase() === 'x',
        rawLine,
        scheduledValue,
      });
    }
    return tasks;
  }

  private getCalendarTaskScheduledKeys(settings: Record<string, unknown>): string[] {
    const keys = [
      settings.startProperty,
      settings.startDateProperty,
      settings.scheduledKey,
      'scheduled',
      'start',
      'date',
    ]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    return Array.from(new Set(keys));
  }

  private parseInlineTaskProperties(line: string): Map<string, string> {
    const props = new Map<string, string>();
    const regex = /(?:^|\s)[\[(]\s*([A-Za-z0-9_-]+)\s*::\s*([^\]\)]*)[\])]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      props.set(String(match[1] || '').trim().toLowerCase(), String(match[2] || '').trim());
    }
    return props;
  }

  private parseScheduledValue(value: unknown): Date | null {
    const millis = this.plugin.sharedServices?.schedule?.parseDateMillis(value) ?? null;
    if (millis == null) return null;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private getExternalCalendarEventColor(calendarBase: any, event: any): string {
    const sourceUrl = String(event?.sourceUrl || '').trim();
    const color =
      calendarBase?.api?.getCalendarColor?.(sourceUrl)
      || calendarBase?.getCalendarColor?.(sourceUrl)
      || event?.color
      || '#3b82f6';
    return this.normalizeCssColorValue(String(color || '')) || '#3b82f6';
  }

  private isExternalCalendarEventHidden(calendarBase: any, event: ExternalCalendarLikeEvent): boolean {
    if (typeof calendarBase?.api?.isExternalEventHiddenAnywhere === 'function') {
      try {
        return calendarBase.api.isExternalEventHiddenAnywhere(event) === true;
      } catch {
        // Fall through to local settings check.
      }
    }

    const settings = calendarBase?.api?.getSettings?.() ?? calendarBase?.settings ?? {};
    const hiddenMap = settings?.hiddenExternalEventsByBase;
    if (!hiddenMap || typeof hiddenMap !== 'object') return false;

    const key = this.getExternalCalendarEventHideKey(calendarBase, event);
    if (!key) return false;
    return Object.values(hiddenMap).some((entries: unknown) =>
      Array.isArray(entries) && entries.some((entry) => String(entry) === key),
    );
  }

  private getExternalCalendarEventHideKey(calendarBase: any, event: ExternalCalendarLikeEvent): string {
    if (typeof calendarBase?.api?.getExternalEventHideKey === 'function') {
      try {
        return String(calendarBase.api.getExternalEventHideKey(event) || '').trim();
      } catch {
        // Fall through to local key construction.
      }
    }
    const sourceUrl = this.normalizeCalendarUrl(String(event?.sourceUrl || ''));
    const id = String(event?.id || '').trim();
    return id ? `${sourceUrl}::${id}` : '';
  }

  private isExternalCalendarEventFiltered(calendarBase: any, event: ExternalCalendarLikeEvent): boolean {
    const terms = this.parseExternalCalendarFilterTerms(this.getExternalCalendarFilter(calendarBase));
    if (terms.length === 0) return false;
    const title = String(event?.title || '').toLowerCase();
    if (!title) return false;
    return terms.some((term) => title.includes(term));
  }

  private getExternalCalendarFilter(calendarBase: any): string {
    const candidates = [
      calendarBase?.api?.getExternalCalendarFilter,
      calendarBase?.getExternalCalendarFilter,
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== 'function') continue;
      try {
        const value = candidate.call(calendarBase);
        if (typeof value === 'string') return value;
      } catch {
        // Fall through to settings snapshots.
      }
    }
    const settings = calendarBase?.api?.getSettings?.() ?? calendarBase?.settings ?? {};
    return typeof settings?.externalCalendarFilter === 'string' ? settings.externalCalendarFilter : '';
  }

  private parseExternalCalendarFilterTerms(raw: unknown): string[] {
    if (typeof raw !== 'string' || !raw.trim()) return [];
    return raw
      .split(/[\n,]/)
      .map((segment) => segment.trim().toLowerCase())
      .filter(Boolean);
  }

  private formatCalendarItemTime(date: Date, external = false, kindLabel = 'Scheduled note'): string {
    if (Number.isNaN(date.getTime())) return external ? 'External event' : kindLabel;
    const moment = (window as any).moment;
    const time = moment
      ? moment(date).format('h:mm A')
      : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return external ? `${time} · External event` : `${time} · ${kindLabel}`;
  }

  private getCalendarBasePlugin(): any {
    const pluginsApi = (this.plugin.app as any)?.plugins;
    return pluginsApi?.getPlugin?.('tps-calendar-base')
      ?? pluginsApi?.getPlugin?.('TPS-Calendar-Base (Dev)')
      ?? pluginsApi?.plugins?.['tps-calendar-base']
      ?? pluginsApi?.plugins?.['TPS-Calendar-Base (Dev)'];
  }

  private async getExternalCalendarEventsForDay(calendarBase: any, date: Date): Promise<any[]> {
    const service = calendarBase?.api?.getExternalCalendarService?.();
    if (!service?.fetchEvents) return [];
    const urls = Array.isArray(calendarBase?.api?.getExternalCalendarUrls?.())
      ? calendarBase.api.getExternalCalendarUrls()
      : [];
    if (urls.length === 0) return [];
    const { start, end } = this.getLocalDayRange(date);
    const results = await Promise.allSettled(
      urls.map((url: string) => service.fetchEvents(url, start, end, false, false)),
    );
    return results.flatMap((result) => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);
  }

  private getScheduledDateFromFrontmatter(frontmatter: Record<string, unknown>): Date | null {
    const raw = this.getFrontmatterValueCaseInsensitive(frontmatter, 'scheduled')
      ?? this.getFrontmatterValueCaseInsensitive(frontmatter, 'start')
      ?? this.getFrontmatterValueCaseInsensitive(frontmatter, 'date');
    const millis = this.plugin.sharedServices?.schedule?.parseDateMillis(raw) ?? null;
    if (millis == null) return null;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private matchExternalEventForLocalFrontmatter(
    frontmatter: Record<string, unknown>,
    localDate: Date,
    externalEvents: any[],
    settings: Record<string, unknown>,
    file?: TFile,
  ): any | null {
    const eventIdKey = String(settings.eventIdKey || 'externalEventId');
    const uidKey = String(settings.uidKey || 'tpsCalendarUid');
    const eventId = this.getFrontmatterStringCaseInsensitive(frontmatter, eventIdKey);
    const uid = this.normalizeIdentityValue(
      this.getFrontmatterStringCaseInsensitive(frontmatter, uidKey) || this.extractUidFromCompositeEventId(eventId),
    );
    const sourceUrl = this.getFrontmatterStringCaseInsensitive(frontmatter, 'tpsCalendarSourceUrl');
    const normalizedTitle = this.normalizeExternalMatchTitle(
      this.getFrontmatterStringCaseInsensitive(frontmatter, 'title') || file?.basename || '',
    );

    if (eventId) {
      const sourceScopedKey = this.buildExternalEventIdentityKey(eventId, sourceUrl);
      const exact = externalEvents.find((event) => this.buildExternalEventIdentityKey(event.id, event.sourceUrl) === sourceScopedKey);
      if (exact) return exact;
      if (!sourceUrl) {
        const byId = externalEvents.find((event) => this.normalizeIdentityValue(event.id) === this.normalizeIdentityValue(eventId));
        if (byId) return byId;
      }
      const noteUid = this.extractUidFromCompositeEventId(eventId) || eventId;
      const noteSuffix = eventId.includes('-') ? eventId.substring(eventId.lastIndexOf('-') + 1) : '';
      const noteSuffixTs = noteSuffix ? Number.parseInt(noteSuffix, 10) : NaN;
      const fuzzy = externalEvents.find((event) => {
        if (sourceUrl && this.normalizeCalendarUrl(event.sourceUrl || '') !== this.normalizeCalendarUrl(sourceUrl)) return false;
        if (this.normalizeIdentityValue(event.uid) !== this.normalizeIdentityValue(noteUid)) return false;
        if (!noteSuffix || !String(event.id || '').includes('-')) return false;
        const eventSuffix = String(event.id || '').substring(String(event.id || '').lastIndexOf('-') + 1);
        const eventSuffixTs = Number.parseInt(eventSuffix, 10);
        return Number.isFinite(noteSuffixTs)
          && Number.isFinite(eventSuffixTs)
          && this.areTimestampsLikelySameSlot(noteSuffixTs, eventSuffixTs);
      });
      if (fuzzy) return fuzzy;
    }

    if (uid) {
      const byUid = externalEvents.find((event) => {
        if (sourceUrl && this.normalizeCalendarUrl(event.sourceUrl || '') !== this.normalizeCalendarUrl(sourceUrl)) return false;
        const eventUid = this.normalizeIdentityValue(event.uid || this.extractUidFromCompositeEventId(event.id));
        return eventUid === uid && this.areDatesLikelySameSlot(new Date(event.startDate), localDate);
      });
      if (byUid) return byUid;
    }

    if (normalizedTitle) {
      return externalEvents.find((event) => {
        if (sourceUrl && this.normalizeCalendarUrl(event.sourceUrl || '') !== this.normalizeCalendarUrl(sourceUrl)) return false;
        return this.normalizeExternalMatchTitle(event.title) === normalizedTitle
          && this.areDatesLikelySameSlot(new Date(event.startDate), localDate);
      }) ?? null;
    }

    return null;
  }

  private matchExternalEventForTaskMetadata(
    inlineProperties: Map<string, string>,
    taskTitle: string,
    localDate: Date,
    externalEvents: any[],
    settings: Record<string, unknown>,
  ): any | null {
    const eventIdKey = String(settings.eventIdKey || 'externalEventId').trim().toLowerCase();
    const uidKey = String(settings.uidKey || 'tpsCalendarUid').trim().toLowerCase();
    const eventId = this.normalizeIdentityValue(
      inlineProperties.get(eventIdKey)
      || inlineProperties.get('externaleventid')
      || '',
    );
    const uid = this.normalizeIdentityValue(
      inlineProperties.get(uidKey)
      || inlineProperties.get('tpscalendaruid')
      || this.extractUidFromCompositeEventId(eventId),
    );
    const sourceUrl = this.normalizeIdentityValue(inlineProperties.get('tpscalendarsourceurl') || '');

    if (eventId) {
      const sourceScopedKey = this.buildExternalEventIdentityKey(eventId, sourceUrl);
      const exact = externalEvents.find((event) => this.buildExternalEventIdentityKey(event.id, event.sourceUrl) === sourceScopedKey);
      if (exact) return exact;
      if (!sourceUrl) {
        const byId = externalEvents.find((event) => this.normalizeIdentityValue(event.id) === eventId);
        if (byId) return byId;
      }
    }

    if (uid) {
      const byUid = externalEvents.find((event) => {
        if (sourceUrl && this.normalizeCalendarUrl(event.sourceUrl || '') !== this.normalizeCalendarUrl(sourceUrl)) return false;
        const eventUid = this.normalizeIdentityValue(event.uid || this.extractUidFromCompositeEventId(event.id));
        return eventUid === uid && this.areDatesLikelySameSlot(new Date(event.startDate), localDate);
      });
      if (byUid) return byUid;
    }

    const normalizedTitle = this.normalizeExternalMatchTitle(taskTitle);
    if (normalizedTitle) {
      return externalEvents.find((event) => {
        if (sourceUrl && this.normalizeCalendarUrl(event.sourceUrl || '') !== this.normalizeCalendarUrl(sourceUrl)) return false;
        return this.normalizeExternalMatchTitle(event.title) === normalizedTitle
          && this.areDatesLikelySameSlot(new Date(event.startDate), localDate);
      }) ?? null;
    }

    return null;
  }

  private isDailyNoteFile(file: TFile, cache: { tags?: Array<{ tag: string }>; frontmatter?: Record<string, unknown> } | null | undefined): boolean {
    if (cache?.tags?.some((tag) => String(tag.tag || '').toLowerCase() === '#dailynote')) return true;
    const frontmatterTags = this.getFrontmatterValueCaseInsensitive((cache?.frontmatter || {}) as Record<string, unknown>, 'tags');
    const tagValues = Array.isArray(frontmatterTags)
      ? frontmatterTags
      : String(frontmatterTags ?? '').split(/[,\s]+/).filter(Boolean);
    if (tagValues.some((tag) => String(tag).replace(/^#/, '').trim().toLowerCase() === 'dailynote')) return true;
    return this.plugin.fileNamingService?.isDateOnlyBasename?.(file.basename) === true;
  }

  private normalizeExternalMatchTitle(value: unknown): string {
    return String(value || '')
      .replace(/%%[\s\S]*?%%/g, ' ')
      .replace(/\[[A-Za-z0-9_-]+\s*::[^\]]*]/g, ' ')
      .replace(/\([A-Za-z0-9_-]+\s*::[^)]*\)/g, ' ')
      .replace(/^\s*[-*]\s+\[[^\]]*]\s*/, ' ')
      .replace(/!?\[([^\]]+)]\([^)]+\)/g, '$1')
      .replace(/!?\[\[([^\]|#]+)(?:[#|][^\]]*)?]]/g, '$1')
      .replace(/@\{[^}]+}/g, '')
      .replace(/@@\{[^}]+}/g, '')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
      .replace(/\b\d{1,2}[.:]\d{2}\s*(?:am|pm)?\b/gi, '')
      .replace(/#[\p{L}\p{N}_/-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private areDatesLikelySameSlot(left: Date, right: Date): boolean {
    if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return false;
    return this.areTimestampsLikelySameSlot(left.getTime(), right.getTime());
  }

  private areTimestampsLikelySameSlot(leftMs: number, rightMs: number): boolean {
    if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return false;
    const left = new Date(leftMs);
    const right = new Date(rightMs);
    left.setSeconds(0, 0);
    right.setSeconds(0, 0);
    const leftTs = left.getTime();
    const rightTs = right.getTime();
    if (Math.abs(leftTs - rightTs) <= 65 * 60 * 1000) return true;
    return left.getUTCDate() === right.getUTCDate()
      && left.getUTCHours() === right.getUTCHours()
      && left.getUTCMinutes() === right.getUTCMinutes();
  }

  private getLocalDayRange(date: Date): { start: Date; end: Date } {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  private doesEventOverlapLocalDay(startRaw: unknown, endRaw: unknown, day: Date): boolean {
    const start = new Date(startRaw as any);
    if (Number.isNaN(start.getTime())) return false;
    const end = new Date(endRaw as any);
    const effectiveEnd = Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()
      ? new Date(start.getTime() + 1)
      : end;
    const range = this.getLocalDayRange(day);
    return start < range.end && effectiveEnd > range.start;
  }

  private isDateOnSameLocalDay(left: Date, right: Date): boolean {
    return left.getFullYear() === right.getFullYear()
      && left.getMonth() === right.getMonth()
      && left.getDate() === right.getDate();
  }

  private buildExternalEventIdentityKey(eventId: unknown, sourceUrl: unknown): string {
    return `${this.normalizeCalendarUrl(sourceUrl)}::${this.normalizeIdentityValue(eventId)}`;
  }

  private buildExternalUidDayKey(uid: string, sourceUrl: unknown, date: Date): string {
    return `${this.normalizeCalendarUrl(sourceUrl)}::${uid}::${this.formatScheduledIsoDate(date)}`;
  }

  private normalizeIdentityValue(value: unknown): string {
    return String(value || '').trim();
  }

  private normalizeCalendarUrl(value: unknown): string {
    return String(value || '').trim().replace(/\s+/g, '').replace(/\/+$/g, '').toLowerCase();
  }

  private extractUidFromCompositeEventId(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const lastDash = raw.lastIndexOf('-');
    return lastDash > 0 ? raw.slice(0, lastDash) : raw;
  }

  private getFrontmatterStringCaseInsensitive(frontmatter: Record<string, unknown>, key: string): string {
    const value = this.getFrontmatterValueCaseInsensitive(frontmatter, key);
    return String(value || '').trim();
  }

  private async openDefaultCalendarAt(date: Date): Promise<void> {
    const calendarBase = this.getCalendarBasePlugin();
    const opened = await calendarBase?.api?.openDefaultCalendarAt?.(date);
    if (!opened) {
      new Notice('Calendar Base default calendar is not available.');
      return;
    }
    await this.focusOpenCalendarAt(date, calendarBase);
  }

  private async focusOpenCalendarAt(date: Date, calendarBase?: any): Promise<void> {
    const targetKey = this.formatScheduledIsoDate(date);
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const leaves = this.findCalendarLeaves(calendarBase);
      const primaryLeaf = leaves[0] ?? null;
      if (primaryLeaf) {
        this.plugin.app.workspace.revealLeaf(primaryLeaf);
        try {
          this.plugin.app.workspace.setActiveLeaf(primaryLeaf, { focus: true } as any);
        } catch {
          this.plugin.app.workspace.setActiveLeaf(primaryLeaf);
        }
      }
      for (const leaf of leaves) {
        const view = leaf.view as any;
        if (typeof view?.jumpToDateTime === 'function') {
          view.jumpToDateTime(new Date(date));
        }
      }
      if (leaves.some((leaf) => this.calendarLeafShowsDate(leaf, targetKey))) {
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
  }

  private calendarLeafShowsDate(leaf: WorkspaceLeaf, isoDate: string): boolean {
    const view = leaf.view as any;
    const container = view?.containerEl as HTMLElement | undefined;
    if (!(container instanceof HTMLElement)) return false;
    const matches = Array.from(container.querySelectorAll<HTMLElement>('[data-date]'))
      .filter((el) => el.getAttribute('data-date') === isoDate);
    return matches.some((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < window.innerHeight
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    });
  }

  private findCalendarLeaf(calendarBase?: any): WorkspaceLeaf | null {
    return this.findCalendarLeaves(calendarBase)[0] ?? null;
  }

  private findCalendarLeaves(calendarBase?: any): WorkspaceLeaf[] {
    const defaultPath = normalizePath(String(calendarBase?.settings?.sidebarBasePath || '').trim());
    const leaves: WorkspaceLeaf[] = [];
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      leaves.push(leaf);
    });

    const isDefaultCalendarLeaf = (leaf: WorkspaceLeaf): boolean => {
      const view = leaf.view as any;
      if (defaultPath && typeof view?.isDefaultCalendarBasePath === 'function' && view.isDefaultCalendarBasePath(defaultPath)) {
        return true;
      }
      const viewFilePath = typeof view?.file?.path === 'string' ? normalizePath(view.file.path) : '';
      return !!defaultPath && viewFilePath === defaultPath;
    };

    const isAnyCalendarLeaf = (leaf: WorkspaceLeaf): boolean => {
      const view = leaf.view as any;
      return typeof view?.jumpToDateTime === 'function';
    };

    const activeLeaf = this.plugin.app.workspace.activeLeaf;
    const ordered: WorkspaceLeaf[] = [];
    const add = (leaf: WorkspaceLeaf | undefined | null) => {
      if (leaf && !ordered.includes(leaf)) ordered.push(leaf);
    };
    add(leaves.find((leaf) => leaf === activeLeaf && isDefaultCalendarLeaf(leaf)));
    leaves.filter((leaf) => isDefaultCalendarLeaf(leaf) && isLeafVisible(leaf)).forEach(add);
    leaves.filter(isDefaultCalendarLeaf).forEach(add);
    add(leaves.find((leaf) => leaf === activeLeaf && isAnyCalendarLeaf(leaf)));
    leaves.filter((leaf) => isAnyCalendarLeaf(leaf) && isLeafVisible(leaf)).forEach(add);
    leaves.filter(isAnyCalendarLeaf).forEach(add);
    return ordered;
  }

  private removeTopParentNav(view: MarkdownView, options: { reserveFootprint?: boolean } = {}): void {
    this.hideTopLinkPreviewCard();
    this.hideTopLinksPopover();
    const navEl = this.topParentNavs.get(view);
    if (navEl) {
      if (options.reserveFootprint !== false) {
        this.reserveTopPropertiesFootprint(view, navEl);
      }
      navEl.remove();
      this.topParentNavs.delete(view);
    }
    // Clean up any remaining ones just in case
    const titleEl = this.resolveInlineTitleElement(view);
    titleEl?.parentElement?.querySelectorAll('.tps-gcm-top-parent-nav').forEach(node => node.remove());
    view.contentEl.classList.remove('tps-gcm-stacked-properties-active');
  }

  private reserveTopPropertiesFootprint(view: MarkdownView, navEl: HTMLElement): void {
    if (!navEl.querySelector('.tps-gcm-top-properties-panel, .metadata-container')) return;
    const titleEl = this.resolveInlineTitleElement(view);
    const parent = titleEl?.parentElement;
    if (!parent) return;

    const existing = parent.querySelector<HTMLElement>('.tps-gcm-top-properties-placeholder');
    existing?.remove();
    const previousTimer = this.topPropertiesPlaceholderTimers.get(view);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);

    const placeholder = document.createElement('div');
    placeholder.className = 'tps-gcm-top-properties-placeholder';
    placeholder.style.height = `${Math.max(38, Math.min(180, navEl.getBoundingClientRect().height || 0))}px`;
    titleEl.insertAdjacentElement('afterend', placeholder);

    const timer = window.setTimeout(() => {
      placeholder.remove();
      this.topPropertiesPlaceholderTimers.delete(view);
    }, 220);
    this.topPropertiesPlaceholderTimers.set(view, timer);
  }

  private removeBottomParentNav(view: MarkdownView): void {
    const navEl = this.bottomParentNavs.get(view);
    if (navEl) {
      navEl.remove();
      this.bottomParentNavs.delete(view);
    }
    const instances = this.menus.get(view);
    instances?.live?.querySelectorAll('.tps-gcm-bottom-parent-nav').forEach((node) => node.remove());
    instances?.reading?.querySelectorAll('.tps-gcm-bottom-parent-nav').forEach((node) => node.remove());
  }

  private getParentChildRelationshipPaths(file: TFile, knownParents?: TFile[]): Set<string> {
    const relationshipPaths = new Set<string>();

    const parentFiles = knownParents ?? this.resolveParentFiles(file);
    for (const parentFile of parentFiles) {
      relationshipPaths.add(parentFile.path);
    }

    // Include reverse-only relationships if one direction is missing.
    for (const candidate of this.plugin.app.vault.getMarkdownFiles()) {
      if (candidate.path === file.path) continue;
      if (this.plugin.parentLinkResolutionService.hasParent(candidate, file)) {
        relationshipPaths.add(candidate.path);
      }
    }

    return relationshipPaths;
  }

  private resolveChildFiles(file: TFile): TFile[] {
    const childFiles = new Map<string, TFile>();
    for (const candidate of this.plugin.app.vault.getMarkdownFiles()) {
      if (candidate.path === file.path) continue;
      if (this.plugin.parentLinkResolutionService.hasParent(candidate, file)) {
        childFiles.set(candidate.path, candidate);
      }
    }
    return Array.from(childFiles.values());
  }

  private async resolveChildFilesForTopButton(file: TFile): Promise<TFile[]> {
    const childFiles = new Map<string, TFile>();
    try {
      const bodyLinks = await this.plugin.bodySubitemLinkService.scanFile(file);
      for (const link of bodyLinks) {
        if (link.childFile instanceof TFile && link.childFile.path !== file.path) {
          childFiles.set(link.childFile.path, link.childFile);
        }
      }
    } catch (error) {
      logger.warn('[TPS GCM] Failed scanning body child links for top button', { file: file.path, error });
    }

    for (const child of this.resolveChildFiles(file)) {
      childFiles.set(child.path, child);
    }

    return Array.from(childFiles.values());
  }

  private getEmbeddedMarkdownTargetPaths(file: TFile): Set<string> {
    const result = new Set<string>();
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const embeds = cache?.embeds || [];
    for (const embed of embeds) {
      const linkPath = String((embed as any)?.link || '').trim();
      if (!linkPath) continue;
      const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
      if (resolved instanceof TFile && resolved.extension?.toLowerCase() === 'md') {
        result.add(resolved.path);
      }
    }
    return result;
  }

  private getPromotedChecklistLinkedTargetPaths(file: TFile): Set<string> {
    const result = new Set<string>();
    const cache = this.plugin.app.metadataCache.getFileCache(file) as any;
    const links = Array.isArray(cache?.links) ? cache.links : [];
    const listItems = Array.isArray(cache?.listItems) ? cache.listItems : [];
    if (links.length === 0 || listItems.length === 0) return result;

    const completedChecklistLines = new Set<number>();
    for (const item of listItems) {
      const line = Number(item?.position?.start?.line);
      const taskState = String(item?.task ?? '');
      if (!Number.isFinite(line)) continue;
      if (this.isResolvedChecklistTaskState(taskState)) {
        completedChecklistLines.add(line);
      }
    }

    if (completedChecklistLines.size === 0) return result;

    for (const link of links) {
      const line = Number(link?.position?.start?.line);
      if (!Number.isFinite(line) || !completedChecklistLines.has(line)) continue;
      const linkPath = String(link?.link || '').trim();
      if (!linkPath) continue;
      const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
      if (resolved instanceof TFile && resolved.extension?.toLowerCase() === 'md') {
        result.add(resolved.path);
      }
    }

    return result;
  }

  private isResolvedChecklistTaskState(taskState: string): boolean {
    const normalized = String(taskState ?? '').trim().toLowerCase();
    return normalized.length > 0 && normalized !== ' ';
  }

  private extractLinkedFilesFromFrontmatterValue(value: any, sourcePath: string): TFile[] {
    const results = new Map<string, TFile>();
    const visitedObjects = new Set<any>();

    const addCandidate = (candidate: string): void => {
      const resolved = this.resolveParentValueToFile(candidate, sourcePath);
      if (resolved) {
        results.set(resolved.path, resolved);
      }
    };

    const visit = (current: any): void => {
      if (current === null || current === undefined) return;
      if (Array.isArray(current)) {
        if (visitedObjects.has(current)) return;
        visitedObjects.add(current);
        current.forEach((entry) => visit(entry));
        return;
      }
      if (typeof current === 'object') {
        if (visitedObjects.has(current)) return;
        visitedObjects.add(current);
        Object.values(current).forEach((entry) => visit(entry));
        return;
      }

      const raw = String(current).trim();
      if (!raw) return;

      let matchedStructuredLink = false;
      const wikiMatches = raw.matchAll(/\[\[([^\]]+)\]\]/g);
      for (const match of wikiMatches) {
        matchedStructuredLink = true;
        addCandidate(match[1]);
      }

      const markdownMatches = raw.matchAll(/\[[^\]]*\]\(([^)]+)\)/g);
      for (const match of markdownMatches) {
        matchedStructuredLink = true;
        addCandidate(match[1]);
      }

      if (!matchedStructuredLink) {
        addCandidate(raw);
      }
    };

    visit(value);
    return Array.from(results.values());
  }

  private resolveParentFiles(file: TFile): TFile[] {
    const parentFiles = new Map<string, TFile>();
    for (const entry of this.plugin.parentLinkResolutionService.getParentsForChild(file)) {
      if (entry.file.path !== file.path) {
        parentFiles.set(entry.file.path, entry.file);
      }
    }

    return Array.from(parentFiles.values());
  }

  private resolveParentValueToFile(value: any, sourcePath: string): TFile | null {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const candidates = this.extractParentLinkCandidates(raw);
    for (const candidate of candidates) {
      const cleaned = this.normalizeParentLinkTarget(candidate);
      if (!cleaned || this.isLikelyExternalParentLink(cleaned)) continue;

      const dest = this.plugin.app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath);
      if (dest instanceof TFile) return dest;

      const normalizedPath = normalizePath(cleaned);
      const file = this.plugin.app.vault.getAbstractFileByPath(normalizedPath);
      if (file instanceof TFile) return file;

      const withMd = normalizedPath.endsWith('.md') ? normalizedPath : `${normalizedPath}.md`;
      const fileWithMd = this.plugin.app.vault.getAbstractFileByPath(withMd);
      if (fileWithMd instanceof TFile) return fileWithMd;
    }

    return null;
  }

  private extractParentLinkCandidates(rawValue: string): string[] {
    const raw = String(rawValue || '').trim();
    if (!raw) return [];

    const candidates: string[] = [];
    const seen = new Set<string>();
    const push = (candidate: string) => {
      const value = String(candidate || '').trim();
      if (!value) return;
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(value);
    };

    const variants = [raw];
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded && decoded !== raw) variants.push(decoded);
    } catch {
      // ignore invalid URI sequences
    }

    for (const value of variants) {
      let matchedStructuredLink = false;
      const wikiMatches = value.matchAll(/\[\[([^\]]+)\]\]/g);
      for (const match of wikiMatches) {
        matchedStructuredLink = true;
        if (match[1]) push(match[1]);
      }

      const markdownMatches = value.matchAll(/\[[^\]]*]\(([^)]+)\)/g);
      for (const match of markdownMatches) {
        matchedStructuredLink = true;
        if (match[1]) push(match[1]);
      }

      if (!matchedStructuredLink) {
        push(value);
      }
    }

    return candidates;
  }

  private normalizeParentLinkTarget(rawTarget: string): string {
    let target = String(rawTarget || '').trim();
    if (!target) return '';

    if (target.startsWith('<') && target.endsWith('>')) {
      target = target.slice(1, -1).trim();
    }
    target = target.replace(/^!/, '').trim();
    target = target.replace(/^['"]|['"]$/g, '').trim();

    const pipeIndex = target.indexOf('|');
    if (pipeIndex >= 0) target = target.slice(0, pipeIndex).trim();
    const hashIndex = target.indexOf('#');
    if (hashIndex >= 0) target = target.slice(0, hashIndex).trim();

    try {
      target = decodeURIComponent(target);
    } catch {
      // ignore invalid URI sequences
    }

    return target.trim();
  }

  private isLikelyExternalParentLink(value: string): boolean {
    return /^(https?:|mailto:|tel:|file:|data:)/i.test(String(value || '').trim());
  }

  private ensureInlineSubitemsPanel(view: MarkdownView): void {
    this.removeInlineSubitemsPanel(view);
    this.removeStrayInlineSubitemsPanels(view, null);
  }

  private getScrollerForView(view: MarkdownView): HTMLElement {
    const mode = getViewMode(view);
    if (mode === 'preview') {
      // In Reading Mode, the .markdown-preview-view is often the scroll container
      // Try finding it within contentEl if previewMode container isn't reliable
      // In Reading Mode, ensure we get the scrollable preview view
      const strictPreview = view.contentEl?.querySelector('.markdown-preview-view') as HTMLElement;
      if (strictPreview) return strictPreview;
      return view.previewMode?.containerEl?.querySelector('.markdown-preview-view') as HTMLElement || view.contentEl;
    } else {
      // Source/Live Preview
      return view.contentEl?.querySelector('.cm-scroller') as HTMLElement ||
        view.contentEl?.querySelector('.markdown-source-view') as HTMLElement ||
        view.contentEl;
    }
  }

  /**
   * Position the inline subitems panel just above the live context menu bar (position:fixed).
   */
  private applyInlinePanelGeometry(view: MarkdownView, panel: HTMLElement): void {
    const instances = this.menus.get(view);
    const activeMenu = instances?.live || instances?.reading;

    // Flexbox Layout (Panel inside Menu Container)
    if (activeMenu && panel.parentElement === activeMenu) {
      // Panel should span the full width of the menu container (which spans the note)
      panel.style.width = '100%';

      let maxWidth = '100%';
      if (view && view.contentEl) {
        // Only apply RLL if the class is present on the view or editor
        const isReadable =
          view.contentEl.classList.contains('is-readable-line-width') ||
          view.contentEl.querySelector('.is-readable-line-width') !== null;

        if (isReadable) {
          const computed = getComputedStyle(view.contentEl);
          const fileLineWidth = computed.getPropertyValue('--file-line-width')?.trim();
          const lineWidth = computed.getPropertyValue('--line-width')?.trim();

          if (fileLineWidth && fileLineWidth !== 'initial' && fileLineWidth !== 'none') {
            maxWidth = fileLineWidth;
          } else if (lineWidth && lineWidth !== 'initial' && lineWidth !== 'none') {
            maxWidth = lineWidth;
          }
        }
      }
      panel.style.maxWidth = maxWidth;
      panel.style.minWidth = 'unset';

      // Ensure panel doesn't try to position itself
      panel.style.position = 'static';
      panel.style.left = 'auto';
      panel.style.top = 'auto';
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
      panel.style.transform = 'none';
      panel.style.marginTop = '1px';

      if (!this.swipeCollapsed) {
        panel.style.removeProperty('opacity');
        panel.style.removeProperty('visibility');
      }
      return;
    }

    // Legacy/Fallback Logic (Body Attached)
    if (!activeMenu || !activeMenu.isConnected || !view.contentEl) return;

    if (!activeMenu.style.left) {
      this.applyPersistentMenuGeometry(view, activeMenu);
    }

    // Use layout based on the pane metrics for horizontal stability
    const menuRect = activeMenu.getBoundingClientRect();
    const paneRect = view.contentEl.getBoundingClientRect();

    if (menuRect.top > 0 && paneRect.width > 0) {
      const isMobile = window.innerWidth < 500;
      const horizontalPadding = isMobile ? 16 : 24;

      // Calculate width based on PANE width + constraints
      const idealWidth = isMobile ? (paneRect.width - 32) : 450;
      const maxPanelWidth = Math.min(600, paneRect.width - (horizontalPadding * 2));

      let panelWidth = Math.min(idealWidth, maxPanelWidth);
      panelWidth = Math.max(panelWidth, 300);

      // Explicitly prevent overflow of pane
      if (panelWidth > paneRect.width - 32) {
        panelWidth = Math.max(300, paneRect.width - 32);
      }

      panel.style.width = `${panelWidth}px`;
      panel.style.maxWidth = `${panelWidth}px`;
      panel.style.minWidth = 'unset';

      const position = this.plugin.settings?.liveMenuPosition || 'center';

      let leftParams: number;
      if (position === 'left') {
        leftParams = paneRect.left + horizontalPadding;
      } else if (position === 'right') {
        leftParams = paneRect.right - panelWidth - horizontalPadding;
      } else {
        // Center in pane
        const paneCenter = paneRect.left + (paneRect.width / 2);
        leftParams = paneCenter - (panelWidth / 2);
      }

      // Clamp to stay within viewport
      const minLeft = 16;
      const maxLeft = window.innerWidth - panelWidth - 16;
      leftParams = Math.max(minLeft, Math.min(leftParams, maxLeft));

      panel.style.left = `${leftParams}px`;

      // Vertical Layout: Smart positioning based on menu location
      const gap = isMobile ? 24 : 12;

      const isTopMenu = menuRect.top < (window.innerHeight / 2);

      if (isTopMenu) {
        // Menu is at TOP -> Panel goes BELOW
        panel.style.top = `${menuRect.bottom + gap}px`;
        panel.style.bottom = 'auto';
        panel.style.transformOrigin = 'center top';
      } else {
        // Menu is at BOTTOM -> Panel goes ABOVE (default)
        const bottomOffset = window.innerHeight - menuRect.top;

        let safeBottom = bottomOffset + gap;
        if (bottomOffset <= 0 || bottomOffset > window.innerHeight) {
          safeBottom = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tps-gcm-live-bottom') || '16') + 60);
        }

        panel.style.bottom = `${safeBottom}px`;
        panel.style.top = 'auto';
        panel.style.transformOrigin = 'center bottom';
      }

      panel.style.right = 'auto';
      panel.style.transform = 'none';
    } else {
      // Fallback if no rects available
      const liveBottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tps-gcm-live-bottom') || '16');
      panel.style.bottom = `${liveBottom + 60}px`;
      panel.style.left = '50%';
      panel.style.transform = 'translateX(-50%)';
    }

    panel.style.removeProperty('opacity');
    panel.style.removeProperty('visibility');
  }

  private applyMenuVisibility(menuEl: HTMLElement): void {
    const keyboardHidden = this.shouldHideForKeyboard();
    menuEl.classList.toggle('tps-gcm-gesture-collapsed', this.swipeCollapsed);
    menuEl.classList.toggle('tps-gcm-menu--keyboard-hidden', keyboardHidden);

    // Also set inline styles for collapsed/keyboard-hidden state to ensure consistency.
    // Persistent note-header content is managed separately; this menu is transient chrome.
    if (this.swipeCollapsed || keyboardHidden) {
      menuEl.style.visibility = 'hidden';
      menuEl.style.opacity = '0';
      menuEl.style.pointerEvents = 'none';
    } else {
      menuEl.style.visibility = 'visible';
      menuEl.style.opacity = '1';
      menuEl.style.pointerEvents = 'auto';
    }
  }

  private applyInlinePanelVisibility(panelEl: HTMLElement): void {
    // When keyboard appears (or is anticipated), force-hide panel so it does not cover the viewport.
    const keyboardHidden = this.shouldHideForKeyboard();
    panelEl.classList.toggle('tps-gcm-subitems-panel--keyboard-hidden', keyboardHidden);
    panelEl.classList.toggle('tps-gcm-gesture-collapsed', this.swipeCollapsed);

    // Also set inline styles for collapsed state to ensure consistency
    if (this.swipeCollapsed || keyboardHidden) {
      panelEl.style.visibility = 'hidden';
      panelEl.style.opacity = '0';
      panelEl.style.pointerEvents = 'none';
    } else {
      panelEl.style.visibility = 'visible';
      panelEl.style.opacity = '1';
      panelEl.style.pointerEvents = 'auto';
    }
  }

  private setSwipeCollapsed(collapsed: boolean): void {
    if (this.swipeCollapsed === collapsed) return;
    this.swipeCollapsed = collapsed;
    document.body?.classList?.toggle('tps-gcm-gesture-collapsed', collapsed);
    this.applyAllMenuVisibility();
  }

  /**
   * Returns true when the menu should be hidden due to the keyboard being up
   * or a focused editable signalling the keyboard is about to appear.
   */
  private shouldHideForKeyboard(): boolean {
    if (!this.isKeyboardSuppressionEnabled()) return false;
    return this.keyboardVisible || this.editableFocused;
  }

  private isKeyboardSuppressionEnabled(): boolean {
    return Platform.isMobile && (this.plugin.settings.suppressMobileKeyboard ?? true);
  }

  private markMobileOverlayInteraction(): void {
    if (!Platform.isMobile) return;
    this.mobileOverlayInteractionUntil = Date.now() + 900;
  }

  private isMobileOverlayInteractionActive(): boolean {
    return Platform.isMobile && Date.now() < this.mobileOverlayInteractionUntil;
  }

  private isInsideMobileStableOverlay(target: HTMLElement): boolean {
    if (!Platform.isMobile) return false;
    return !!target.closest([
      '.tps-global-context-menu',
      '.tps-gcm-panel',
      '.tps-gcm-top-properties-panel',
      '.tps-gcm-note-references',
      '.tps-gcm-top-calendar-popover',
      '.tps-gcm-base-link-preview',
      '.metadata-container',
      '.metadata-properties',
      '.modal.mod-tps-gcm',
      '.menu',
      '.suggestion-container',
      '.prompt',
      '.popover',
      '.hover-popover',
    ].join(', '));
  }

  /**
   * Push the current visibility state to all tracked menus and panels without
   * triggering a geometry recalculation. Used for fast state changes (keyboard
   * appear/disappear, focus in/out).
   */
  private applyAllMenuVisibility(): void {
    const keyboardHidden = this.shouldHideForKeyboard();
    const overlaysHidden = keyboardHidden || this.swipeCollapsed;
    for (const instances of this.menus.values()) {
      if (instances.reading?.isConnected) this.applyMenuVisibility(instances.reading);
      if (instances.live?.isConnected) this.applyMenuVisibility(instances.live);
    }
    for (const panel of this.inlineSubitemsPanels.values()) {
      if (panel.isConnected) this.applyInlinePanelVisibility(panel);
    }
    for (const panel of this.noteReferencesPanels.values()) {
      if (panel.isConnected) this.applyInlinePanelVisibility(panel);
    }
    for (const panel of this.noteGraphPanels.values()) {
      if (panel.isConnected) this.applyAuxElementVisibility(panel, overlaysHidden);
    }
    for (const [view, nav] of this.topParentNavs.entries()) {
      if (!nav.isConnected) continue;
      const propertiesPanel = nav.querySelector<HTMLElement>('.tps-gcm-top-properties-panel');
      if (propertiesPanel) {
        this.applyAuxElementVisibility(nav, false);
        this.applyAuxElementVisibility(propertiesPanel, false);
      } else {
        this.applyAuxElementVisibility(nav, overlaysHidden);
      }
    }
    document.querySelectorAll<HTMLElement>('.tps-gcm-top-properties-panel').forEach((panel) => {
      const isInManagedNav = Array.from(this.topParentNavs.values()).some((nav) => nav.isConnected && nav.contains(panel));
      if (!isInManagedNav) {
        this.applyAuxElementVisibility(panel, false);
      }
    });
    for (const nav of this.bottomParentNavs.values()) {
      if (nav.isConnected) this.applyAuxElementVisibility(nav, overlaysHidden);
    }
    for (const icon of this.titleIcons.values()) {
      if (icon.isConnected) this.applyAuxElementVisibility(icon, false);
    }
  }

  private updateMobileBottomOffsets(): void {
    if (typeof document === 'undefined') return;
    if (!Platform.isMobile) {
      document.documentElement.style.setProperty('--tps-gcm-mobile-toolbar-offset', '0px');
      return;
    }
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    let maxObstruction = 0;
    const candidates = Array.from(document.body?.querySelectorAll<HTMLElement>('*') || []);

    for (const el of candidates) {
      if (!el.isConnected) continue;
      if (
        el.closest('.tps-global-context-menu') ||
        el.closest('.tps-gcm-panel') ||
        el.closest('.tps-auto-base-embed') ||
        el.closest('.menu') ||
        el.closest('.modal')
      ) {
        continue;
      }

      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;

      const rect = el.getBoundingClientRect();
      if (!Number.isFinite(rect.height) || rect.height <= 0) continue;
      if (viewportHeight > 0 && rect.bottom < viewportHeight - 4) continue;
      if (rect.top > viewportHeight - Math.max(160, viewportHeight * 0.4)) {
        maxObstruction = Math.max(maxObstruction, Math.ceil(rect.height));
      }
    }

    const offset = maxObstruction > 0 ? maxObstruction + 12 : 0;
    document.documentElement.style.setProperty('--tps-gcm-mobile-toolbar-offset', `${offset}px`);
  }

  private ensureSwipeGestureTracking(view: MarkdownView): void {
    const scroller = this.resolveScrollContainer(view);
    const existing = this.scrollHideListeners.get(view);
    if (existing) {
      if (existing.scroller === scroller) return;
      existing.scroller.removeEventListener('scroll', existing.listener);
      this.scrollHideListeners.delete(view);
    }

    if (!scroller) return;

    const isMobile = this.isMobileLayout();
    const HIDE_THRESHOLD = isMobile ? 96 : 36;
    const SHOW_THRESHOLD = isMobile ? 64 : 6;

    const state = { scroller, lastTop: scroller.scrollTop, accum: 0, listener: () => { } };

    state.listener = () => {
      if (this.keyboardVisible) return;

      const top = scroller.scrollTop;
      const delta = top - state.lastTop;
      state.lastTop = top;
      if (Math.abs(delta) < 1) return;
      if (top <= 8) {
        if (this.swipeCollapsed) this.setSwipeCollapsed(false);
        state.accum = 0;
        return;
      }

      if (!isMobile && this.swipeCollapsed && delta < 0) {
        this.setSwipeCollapsed(false);
        state.accum = 0;
        return;
      }

      // Direction changed â€” reset accumulator.
      if ((delta > 0 && state.accum < 0) || (delta < 0 && state.accum > 0)) {
        state.accum = 0;
      }
      state.accum += delta;

      if (!this.swipeCollapsed && state.accum > HIDE_THRESHOLD) {
        this.setSwipeCollapsed(true);
        state.accum = 0;
      } else if (this.swipeCollapsed && state.accum < -SHOW_THRESHOLD) {
        this.setSwipeCollapsed(false);
        state.accum = 0;
      }
    };

    scroller.addEventListener('scroll', state.listener, { passive: true });
    this.scrollHideListeners.set(view, state);
  }

  private releaseSwipeGestureTracking(view: MarkdownView): void {
    const instances = this.menus.get(view);
    if (instances?.reading || instances?.live) return;

    const state = this.scrollHideListeners.get(view);
    if (!state) return;
    state.scroller.removeEventListener('scroll', state.listener);
    this.scrollHideListeners.delete(view);

  }

  private resolveScrollContainer(view: MarkdownView): HTMLElement | null {
    const mode = getViewMode(view);
    if (mode === 'preview') {
      return (
        view.contentEl?.querySelector<HTMLElement>('.markdown-preview-view') ??
        view.contentEl?.querySelector<HTMLElement>('.markdown-reading-view') ??
        view.contentEl?.querySelector<HTMLElement>('.view-content') ??
        view.contentEl
      );
    }
    return view.contentEl?.querySelector<HTMLElement>('.cm-scroller') ??
      view.contentEl?.querySelector<HTMLElement>('.view-content') ??
      view.contentEl?.querySelector<HTMLElement>('.markdown-source-view') ??
      null;
  }

  private removeInlineSubitemsPanel(view: MarkdownView): void {
    const panel = this.inlineSubitemsPanels.get(view);
    if (panel) {
      panel.remove();
      this.inlineSubitemsPanels.delete(view);
    }
    this.detachPanelScrollListener(view);
  }

  private ensureNoteReferencesPanel(view: MarkdownView): void {
    this.removeNoteReferencesPanel(view);
  }

  private removeNoteReferencesPanel(view: MarkdownView): void {
    const panel = this.noteReferencesPanels.get(view);
    if (panel) {
      panel.remove();
      this.noteReferencesPanels.delete(view);
    }

    const parent = this.resolveNoteFooterParent(view);
    parent?.querySelectorAll('.tps-gcm-note-references').forEach((node) => node.remove());
    if (parent instanceof HTMLElement && parent.classList.contains('tps-gcm-note-footer-host') && !parent.children.length) {
      parent.remove();
    }
    view.contentEl?.querySelectorAll('.tps-gcm-note-footer-host').forEach((node) => {
      if (node instanceof HTMLElement && !node.children.length) {
        node.remove();
      }
    });
  }

  private ensureNoteGraphPanel(view: MarkdownView): void {
    this.removeNoteGraphPanel(view);
  }

  private removeNoteGraphPanel(view: MarkdownView): void {
    const panel = this.noteGraphPanels.get(view);
    if (panel) {
      panel.remove();
      this.noteGraphPanels.delete(view);
    }

    this.resolveNoteGraphHost(view)?.classList.remove('tps-gcm-note-graph-host');
    view.contentEl?.querySelectorAll('.tps-gcm-note-graph').forEach((node) => node.remove());
    this.syncInlineNotePanelLayout(view);
  }

  private syncInlineNotePanelLayout(view: MarkdownView): void {
    window.requestAnimationFrame(() => {
      const referencesPanel = this.noteReferencesPanels.get(view);
      if (!referencesPanel?.isConnected) return;

      referencesPanel.style.removeProperty('margin-top');
      referencesPanel.style.removeProperty('margin-right');
      referencesPanel.style.removeProperty('max-width');

      const mode = getViewMode(view);
      if (mode === 'source') {
        const sourceView = view.contentEl?.querySelector<HTMLElement>('.markdown-source-view');
        const cmContent = sourceView?.querySelector<HTMLElement>('.cm-content') || null;
        if (!cmContent || !cmContent.contains(referencesPanel)) return;

        const lines = Array.from(cmContent.querySelectorAll<HTMLElement>(':scope > .cm-line'));
        const lastLine =
          [...lines].reverse().find((line) => (line.textContent || '').trim().length > 0) ||
          lines[lines.length - 1] ||
          null;
        if (!lastLine) return;

        const contentRect = cmContent.getBoundingClientRect();
        const lastLineRect = lastLine.getBoundingClientRect();
        const trailingSlack = Math.max(0, Math.round(contentRect.bottom - lastLineRect.bottom));
        const targetGap = 50;
        const adjusted = Math.max(-600, Math.min(120, targetGap - trailingSlack));
        referencesPanel.style.marginTop = `${adjusted}px`;
      }
    });
  }

  private removeStrayInlineSubitemsPanels(view: MarkdownView, keep?: HTMLElement | null): void {
    // Search within the view's contentEl
    const root = view.contentEl;
    if (root) {
      for (const panel of Array.from(root.querySelectorAll<HTMLElement>('.tps-gcm-subitems-panel--title-inline'))) {
        if (keep && panel === keep) continue;
        panel.remove();
      }
    }
    // Also remove body-hosted (live preview) stray panels belonging to this view's file
    for (const panel of Array.from(document.body.children)) {
      if (!(panel instanceof HTMLElement)) continue;
      if (!panel.classList.contains('tps-gcm-subitems-panel--title-inline')) continue;
      if (keep && panel === keep) continue;
      const fp = panel.dataset?.filePath;
      if (!fp || fp === view.file?.path) panel.remove();
    }
  }

  // ... (live height observer methods unchanged) ...

  // Helper inside createPersistentMenu or others can remain ...

  // Updated attachPanelScrollListener to be simpler since it's always fixed now
  private attachPanelScrollListener(view: MarkdownView, panel: HTMLElement, container: HTMLElement): void {
    this.detachPanelScrollListener(view);

    const hidePanel = () => {
      panel.classList.add('tps-gcm-subitems-panel--hidden');
      // Re-apply geometry to the main menu if needed (so it doesn't jump).
      // If the panel affects the menu geometry (e.g. by padding), we might need to recalc.
      // But typically for fixed overlay, we just hide the overlay.
    };

    const showPanel = () => {
      if (!panel.isConnected) return;
      if (this.swipeCollapsed) return;
      panel.classList.remove('tps-gcm-subitems-panel--hidden');
      window.requestAnimationFrame(() => {
        if (panel.isConnected) this.applyInlinePanelGeometry(view, panel);
      });
    };

    const listener = (evt: Event) => {
      // Check if scroll target is within the menu or panel
      const target = evt.target instanceof Node ? evt.target as HTMLElement : null;
      if (target) {
        // If scrolling the panel itself or elements within it
        if (target === panel || panel.contains(target)) return;

        // If scrolling the menu container (activeMenu) or its children
        const menu = panel.closest('.tps-global-context-menu');
        if (menu && (target === menu || menu.contains(target))) return;
      }

      const existing = this.scrollListeners.get(view);
      if (existing?.timer) window.clearTimeout(existing.timer);

      hidePanel();

      const timer = window.setTimeout(() => {
        if (this.scrollListeners.get(view)) showPanel();
      }, 400);

      const data = this.scrollListeners.get(view);
      if (data) data.timer = timer;
    };

    // Use capture phase to ensure we catch scroll events from children (like preview view)
    // even if they don't bubble (scroll events usually don't bubble, but capture works)
    container.addEventListener('scroll', listener, { passive: true, capture: true });
    this.scrollListeners.set(view, { container, listener, timer: undefined });
  }

  /**
   * Detach scroll listener from panel
   */
  private detachPanelScrollListener(view: MarkdownView): void {
    const data = this.scrollListeners.get(view);
    if (!data) return;

    data.container.removeEventListener('scroll', data.listener, { passive: true, capture: true } as any);
    if (data.timer) {
      window.clearTimeout(data.timer);
    }
    this.scrollListeners.delete(view);
  }

  private updateLiveHeightVar(): void {
    if (this.liveHeights.size === 0) {
      document.documentElement.style.removeProperty('--tps-gcm-live-height');
      return;
    }
    const maxHeight = Math.max(...this.liveHeights.values());
    document.documentElement.style.setProperty('--tps-gcm-live-height', `${Math.ceil(maxHeight)}px`);
  }

  private attachLiveHeightObserver(
    view: MarkdownView,
    menuEl: HTMLElement,
    headerEl?: HTMLElement | null
  ): void {
    this.detachLiveHeightObserver(view);
    if (typeof ResizeObserver !== 'function') return;

    const updateHeight = () => {
      const measuredHeight = menuEl.getBoundingClientRect().height;
      if (!measuredHeight || !Number.isFinite(measuredHeight)) return;
      // Cap the published height so stacked bars conserve space.
      const cappedHeight = measuredHeight; // Platform.isMobile check removed
      this.liveHeights.set(view, cappedHeight);
      this.updateLiveHeightVar();

      const header = headerEl ?? menuEl.querySelector<HTMLElement>('.tps-gcm-header');
      if (header) {
        const headerHeight = header.getBoundingClientRect().height;
        if (headerHeight && Number.isFinite(headerHeight)) {
          document.documentElement.style.setProperty(
            '--tps-gcm-live-header-height',
            `${Math.ceil(headerHeight)}px`
          );
        }
      }
    };

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(menuEl);
    if (headerEl) {
      observer.observe(headerEl);
    }
    this.liveResizeObservers.set(view, observer);
    updateHeight();
  }

  private detachLiveHeightObserver(view: MarkdownView): void {
    const observer = this.liveResizeObservers.get(view);
    if (observer) {
      observer.disconnect();
      this.liveResizeObservers.delete(view);
    }
    if (this.liveHeights.delete(view)) {
      this.updateLiveHeightVar();
    }
  }

  /**
   * Create a persistent menu element (just the chip strip, no header)
   */
  createPersistentMenu(
    view: MarkdownView,
    mode: 'reading' | 'live'
  ): HTMLElement | null {
    const file = view.file;
    if (!file) return null;

    const menuEl = document.createElement('div');
    menuEl.className = `tps-global-context-menu tps-global-context-menu--persistent tps-global-context-menu--${mode}`;
    if (this.resolveMobileMenuHost(view)) {
      menuEl.addClass('tps-global-context-menu--mobile-pane');
    }
    menuEl.setAttribute('role', 'presentation');
    // Build the panel directly (no header, no collapse logic)
    try {
      const panel = this.plugin.buildSpecialPanel(file, {
        recurrenceRoot: menuEl,
        closeAfterRecurrence: false,
      });
      if (panel) {
        menuEl.appendChild(panel);
        this.ensureMobileExternalActions(view, menuEl);
      }
    } catch (error) {
      logger.error('[TPS GCM] Failed to build persistent panel:', error);
    }

    return menuEl;
  }

  private ensureMobileExternalActions(view: MarkdownView, menuEl: HTMLElement): void {
    if (!(Platform.isMobile || document.body.classList.contains('is-mobile') || document.body.classList.contains('is-phone'))) return;
    const file = view.file;
    if (!(file instanceof TFile)) return;
    const actionBar = menuEl.querySelector<HTMLElement>('.tps-gcm-action-bar');
    if (!actionBar) return;
    actionBar.querySelectorAll('.tps-gcm-parent-nav-button--external').forEach((node) => node.remove());
    const buttons = this.createExternalActionButtons(file, 'bottom', 'tps-gcm-parent-nav-button tps-gcm-parent-nav-button--bottom');
    const firstNativeAction = actionBar.querySelector<HTMLElement>(':scope > button, :scope > .clickable-icon, :scope > .tps-gcm-action-button');
    for (const button of buttons) {
      button.addClass('tps-gcm-mobile-action-bar-external');
      actionBar.insertBefore(button, firstNativeAction);
    }
  }

  /**
   * Remove reading menu from view
   */
  removeReadingMenu(view: MarkdownView): void {
    const instances = this.menus.get(view);
    if (instances?.reading) {
      instances.reading.remove();
      instances.reading = null;
    }
    view.contentEl
      ?.querySelectorAll<HTMLElement>('.tps-global-context-menu--persistent.tps-global-context-menu--reading')
      .forEach((el) => el.remove());

    if (!instances?.live) {
      this.menus.delete(view);
      this.releaseSwipeGestureTracking(view);
      return;
    }

    this.menus.set(view, instances);
  }

  /**
   * Remove live menu from view
   */
  removeLiveMenu(view: MarkdownView): void {
    const instances = this.menus.get(view);
    this.detachLiveHeightObserver(view);
    if (instances?.live) {
      instances.live.remove();
      instances.live = null;
    }
    view.contentEl
      ?.querySelectorAll<HTMLElement>('.tps-global-context-menu--persistent.tps-global-context-menu--live')
      .forEach((el) => el.remove());

    if (!instances?.reading) {
      this.menus.delete(view);
      this.releaseSwipeGestureTracking(view);
      return;
    }

    this.menus.set(view, instances);
  }

  /**
   * Clean up all menus for a view
   */
  cleanup(view: MarkdownView): void {
    this.nativePropertiesExpandedStateByView.delete(view);
    this.clearAttachRetry(view);
    this.detachGeometryObserver(view);
    this.detachNativePropertyObserver(view);
    this.removeInlineSubitemsPanel(view);
    this.removeNoteReferencesPanel(view);
    this.removeNoteGraphPanel(view);
    this.removeLinkedContextPanel(view);
    this.removeStrayInlineSubitemsPanels(view, null);
    this.removeInlineTitleIcon(view);
    const instances = this.menus.get(view);
    if (!instances) {
      this.releaseSwipeGestureTracking(view);
      return;
    }

    if (instances.reading) {
      instances.reading.remove();
    }
    if (instances.live) {
      this.detachLiveHeightObserver(view);
      instances.live.remove();
    }
    this.menus.delete(view);
    this.releaseSwipeGestureTracking(view);
  }

  /**
   * Refresh menus for views showing a specific file.
   * Called when frontmatter changes to update stale inline menus.
   * Updates just the header badges in-place to avoid visual jitter.
   */
  refreshMenusForFile(
    file: TFile,
    force: boolean = false,
    options: { rebuildInlineSubitems?: boolean } = {}
  ): void {
    if (force && this.swipeCollapsed) {
      this.setSwipeCollapsed(false);
    }
    const lastEdit = (this.plugin as any)?.lastEditorChangeAt as number | undefined;
    const quietMs = (this.plugin as any)?.typingQuietWindowMs as number | undefined;
    if (!force && lastEdit && quietMs && Date.now() - lastEdit < quietMs) {
      return;
    }
    if (!force && typeof (this.plugin as any)?.isEditorFocused === "function") {
      if ((this.plugin as any).isEditorFocused()) {
        return;
      }
    }
    const shouldRebuildInlineSubitems = options.rebuildInlineSubitems === true;

    for (const [view, instances] of this.menus.entries()) {
      if (view.file?.path === file.path) {
        const deferStructuralRefresh = this.shouldDeferStructuralRefreshForTyping(view, file);
        if (deferStructuralRefresh) {
          this.schedulePostTypingStructuralRefresh(file);
          continue;
        }
        // Update header badges in-place instead of recreating the entire menu
        // This prevents visual jitter/movement

        if (instances.live) {
          this.applyPersistentMenuGeometry(view, instances.live);
          this.applyMenuVisibility(instances.live);
          this.ensureSwipeGestureTracking(view);
          const headerRight = instances.live.querySelector('.tps-gcm-header-right');
          if (headerRight) {
            // Get updated badges from the controller
            const newBadges = this.plugin.menuController.createHeaderBadges(file, view.leaf);
            headerRight.innerHTML = '';
            headerRight.appendChild(newBadges);
          }
        }

        if (instances.reading) {
          this.applyPersistentMenuGeometry(view, instances.reading);
          this.applyMenuVisibility(instances.reading);
          this.ensureSwipeGestureTracking(view);
          const headerRight = instances.reading.querySelector('.tps-gcm-header-right');
          if (headerRight) {
            // Get updated badges from the controller
            const newBadges = this.plugin.menuController.createHeaderBadges(file, view.leaf);
            headerRight.innerHTML = '';
            headerRight.appendChild(newBadges);
          }
        }

        if (shouldRebuildInlineSubitems) {
          this.removeInlineSubitemsPanel(view);
          this.removeStrayInlineSubitemsPanels(view, null);
        }
        this.removeNoteReferencesPanel(view);
        this.removeNoteGraphPanel(view);
        this.ensureInlineTitleIcon(view);
        this.ensureTopParentNav(view, { force: true });
      }
    }
  }

  private shouldDeferStructuralRefreshForTyping(view: MarkdownView, file: TFile): boolean {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile) || activeFile.path !== file.path) return false;

    const quietMs = this.getTypingQuietWindowMs();
    const lastEdit = this.getLastEditorChangeAt();
    if (lastEdit && Date.now() - lastEdit < quietMs) return true;

    return this.isViewEditorFocused(view);
  }

  private isViewEditorFocused(view: MarkdownView): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    const editorRoot = active.closest('.cm-editor, .markdown-source-view.mod-cm6, .canvas-node-content');
    return !!editorRoot && view.contentEl.contains(editorRoot);
  }

  private getLastEditorChangeAt(): number {
    return Number((this.plugin as any)?.lastEditorChangeAt || 0);
  }

  private getTypingQuietWindowMs(): number {
    const configured = Number((this.plugin as any)?.typingQuietWindowMs || 0);
    return Number.isFinite(configured) && configured > 0 ? configured : 1600;
  }

  private schedulePostTypingStructuralRefresh(file: TFile): void {
    const existing = this.postTypingStructuralRefreshTimers.get(file.path);
    if (existing !== undefined) window.clearTimeout(existing);

    const timer = window.setTimeout(() => {
      this.postTypingStructuralRefreshTimers.delete(file.path);
      const activeFile = this.plugin.app.workspace.getActiveFile();
      if (!(activeFile instanceof TFile) || activeFile.path !== file.path) return;
      const lastEdit = this.getLastEditorChangeAt();
      const quietMs = this.getTypingQuietWindowMs();
      if (lastEdit && Date.now() - lastEdit < quietMs) {
        this.schedulePostTypingStructuralRefresh(file);
        return;
      }
      for (const [view] of this.menus.entries()) {
        if (view.file?.path === file.path && this.isViewEditorFocused(view)) {
          this.schedulePostTypingStructuralRefresh(file);
          return;
        }
      }
      for (const [view] of this.menus.entries()) {
        if (view.file?.path !== file.path) continue;
        this.removeNoteReferencesPanel(view);
        this.removeNoteGraphPanel(view);
        this.ensureInlineTitleIcon(view);
        this.ensureTopParentNav(view, { force: true });
      }
    }, this.getTypingQuietWindowMs() + 120);

    this.postTypingStructuralRefreshTimers.set(file.path, timer);
  }

  /**
   * Detach all menus
   */
  detach(): void {
    this.teardownKeyboardDetection();
    this.hideBaseLinkEditablePreview();
    for (const timerId of this.attachRetryTimers.values()) {
      window.clearTimeout(timerId);
    }
    this.attachRetryTimers.clear();
    for (const view of Array.from(this.scrollListeners.keys())) {
      this.detachPanelScrollListener(view);
    }
    for (const view of Array.from(this.liveResizeObservers.keys())) {
      this.detachLiveHeightObserver(view);
    }
    for (const view of Array.from(this.geometryResizeObservers.keys())) {
      this.detachGeometryObserver(view);
    }
    for (const view of Array.from(this.inlineSubitemsPanels.keys())) {
      this.removeInlineSubitemsPanel(view);
    }
    for (const view of Array.from(this.noteReferencesPanels.keys())) {
      this.removeNoteReferencesPanel(view);
    }
    for (const view of Array.from(this.noteGraphPanels.keys())) {
      this.removeNoteGraphPanel(view);
    }
    for (const view of Array.from(this.titleIcons.keys())) {
      this.removeInlineTitleIcon(view);
    }
    for (const view of Array.from(this.topParentNavs.keys())) {
      this.removeTopParentNav(view);
    }
    for (const timer of Array.from(this.topPropertiesPlaceholderTimers.values())) {
      window.clearTimeout(timer);
    }
    this.topPropertiesPlaceholderTimers.clear();
    for (const timer of Array.from(this.postTypingStructuralRefreshTimers.values())) {
      window.clearTimeout(timer);
    }
    this.postTypingStructuralRefreshTimers.clear();
    for (const view of Array.from(this.bottomParentNavs.keys())) {
      this.removeBottomParentNav(view);
    }
    this.calendarButtonTimerStates.clear();
    this.stopCalendarButtonTimerInterval();
    for (const view of Array.from(this.menus.keys())) {
      this.cleanup(view);
    }
    for (const [view, state] of this.scrollHideListeners.entries()) {
      state.scroller.removeEventListener('scroll', state.listener);
      this.scrollHideListeners.delete(view);
    }
  }
}
