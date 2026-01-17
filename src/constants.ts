import { TPSGlobalContextMenuSettings } from './types';

export const DEFAULT_SETTINGS: TPSGlobalContextMenuSettings = {
  enableLogging: false,
  enableInLivePreview: true,
  enableInPreview: true,
  enableInSidePanels: true,
  enableStrictMode: false,
  enableLineItems: false, // LINE-ITEMS: Feature flag
  suppressMobileKeyboard: true,
  properties: [
    { id: 'status', label: 'Status', key: 'status', type: 'selector', options: ['open', 'working', 'blocked', 'wont-do', 'complete'], icon: 'check-circle', showInCollapsed: true },
    { id: 'priority', label: 'Priority', key: 'priority', type: 'selector', options: ['high', 'medium', 'normal', 'low'], icon: 'flag', showInCollapsed: true },
    { id: 'tags', label: 'Tags', key: 'tags', type: 'list', icon: 'tag', showInCollapsed: true },
    { id: 'recurrence', label: 'Recurrence', key: 'recurrence', type: 'recurrence', icon: 'repeat', showInCollapsed: true },
    { id: 'scheduled', label: 'Scheduled', key: 'scheduled', type: 'datetime', icon: 'calendar', showInCollapsed: true },
    { id: 'type', label: 'Type', key: 'type', type: 'folder', icon: 'folder', showInCollapsed: false },
  ],

  // Recurrence settings
  enableRecurrence: true,
  promptOnRecurrenceEdit: true,
  recurrencePromptTimeout: 5, // 5 minutes
  recurrenceCompletionStatuses: ['complete', 'wont-do'],
  recurrenceDefaultStatus: 'open', // Default status for new recurrence instances

  // File naming settings
  enableAutoRename: true,
  autoSaveFolderPath: true,
  folderExclusions: "",
  checkOpenChecklistItems: true,
  enableViewModeSwitching: true,
  viewModeFrontmatterKey: 'viewmode',
  viewModeIgnoredFolders: '',
  viewModeRules: [],
  systemCommands: ['open-in-new-tab', 'duplicate', 'get-relative-path'],
  snoozeOptions: [],
};

export const SYSTEM_COMMANDS = [
  { id: 'open-in-new-tab', label: 'Open in New Tab', icon: 'plus-square' },
  { id: 'open-in-same-tab', label: 'Open in Same Tab', icon: 'file' },
  { id: 'duplicate', label: 'Duplicate File', icon: 'copy' },
  { id: 'get-relative-path', label: 'Copy Relative Path', icon: 'link' },
] as const;

export const STATUSES = ['open', 'working', 'blocked', 'wont-do', 'complete'] as const;

/**
 * Available priority levels
 */
export const PRIORITIES = ['high', 'medium', 'normal', 'low'] as const;

/**
 * Recurrence rule quick options
 */
export const RECURRENCE_OPTIONS = [
  { label: 'Daily', value: 'RRULE:FREQ=DAILY' },
  { label: 'Weekdays', value: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Weekly', value: 'RRULE:FREQ=WEEKLY' },
  { label: 'Monthly', value: 'RRULE:FREQ=MONTHLY' },
] as const;

/**
 * CSS styles for the plugin
 */
export const PLUGIN_STYLES = `
      .tps-global-context-menu {
        position: fixed;
        min-width: 220px;
        background-color: var(--background-secondary);
        color: var(--text-normal);
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
        z-index: 9999;
        padding: 6px 0;
        font-size: 14px;
        backdrop-filter: blur(6px);
        animation: tps-context-fade 120ms ease-out;
      }
      @keyframes tps-context-fade {
        from { opacity: 0; transform: translateY(4px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .tps-global-context-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        width: 100%;
        border: none;
        background: transparent;
        padding: 6px 14px;
        text-align: left;
        cursor: pointer;
        color: inherit;
      }
      .tps-global-context-item:hover,
      .tps-global-context-item:focus {
        background-color: var(--background-modifier-hover);
        outline: none;
      }
      .tps-global-context-item-label {
        font-weight: 500;
      }
      .tps-global-context-item-desc {
        font-size: 12px;
        color: var(--text-muted);
      }
      .tps-global-context-header {
        padding: 4px 14px 8px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-faint);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .tps-gcm-header-left {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
      }
      .tps-gcm-file-title {
        font-weight: 600;
        color: var(--text-normal);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px; /* Match header size but bold/color makes it pop */
      }
      .tps-gcm-header-right {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }
      .tps-gcm-panel {
        padding: 8px 14px 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .tps-gcm-multi-banner {
        font-size: 12px;
        color: var(--text-muted);
        background: var(--background-modifier-hover);
        padding: 4px 8px;
        border-radius: 6px;
      }
      .tps-gcm-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .tps-gcm-row label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-muted);
      }
      .tps-gcm-input-wrapper {
        position: relative;
        width: 100%;
        display: flex;
        flex-direction: column;
      }
      .tps-gcm-row select,
      .tps-gcm-row input[type="text"],
      .tps-gcm-row input[type="datetime-local"],
      .tps-gcm-row input[type="date"] {
        width: 100%;
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        padding: 4px 8px;
      }
      .tps-global-context-menu--persistent {
        margin-bottom: 12px;
      }
      /* Reading view: full-size panel at the top of the note body.
         It scrolls away with the content (no sticky behavior). 
         Removed card styling to fit readable line length. */
      .tps-global-context-menu--reading {
        position: static;
        top: auto;
        z-index: auto;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        width: 100% !important;
        max-width: 100% !important;
        padding: 0 !important;
        margin-bottom: 1em;
      }
      
      /* Indent the panel content in reading mode to differentiate it slightly */
      .tps-global-context-menu--reading .tps-gcm-panel {
        padding: 8px 0 !important;
        margin-left: 4px;
        border-left: 2px solid var(--background-modifier-border);
        padding-left: 12px !important;
      }
      /* Live preview: compact toolbar fixed at the bottom of the viewport.
         Uses fixed positioning to avoid affecting readable line length. */
      .tps-global-context-menu--live {
        position: fixed;
        bottom: 20px;
        left: 0;
        right: 0;
        margin-left: auto;
        margin-right: auto;
        z-index: 100;
        padding: 4px 8px;
        width: min(92vw, 420px);
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 32px);
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        border-radius: 10px;
        pointer-events: auto;
      }

      .tps-global-context-menu--live .tps-gcm-panel {
        max-height: calc(100vh - 160px);
        overflow-y: auto;
        scrollbar-width: thin;
      }

      @media (max-width: 640px) {
        .tps-global-context-menu--live {
          position: fixed;
          bottom: 12px;
          width: calc(100vw - 32px);
          max-width: calc(100vw - 32px);
        }

        .tps-global-context-menu--live .tps-gcm-panel {
          max-height: calc(100vh - 180px);
        }

        /* Collapsed state on mobile - constrain width to leave room for Obsidian's reading mode toggle */
        .tps-global-context-menu--collapsed.tps-global-context-menu--live {
          max-width: calc(100vw - 80px); /* Leave ~60px for Obsidian's floating button on right */
          margin-right: 80px; /* Push left to avoid overlap with Obsidian's buttons */
        }

        /* Allow header badges to wrap to second line on mobile */
        .tps-global-context-menu--collapsed.tps-global-context-menu--live .tps-global-context-header {
          flex-wrap: wrap;
          gap: 4px;
        }

        .tps-global-context-menu--collapsed.tps-global-context-menu--live .tps-gcm-header-right {
          flex-wrap: wrap;
          overflow: visible;
          max-width: 100%;
        }
      }
      .tps-gcm-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .tps-gcm-toolbar .tps-gcm-row {
        margin: 0;
        padding: 0;
      }
      .tps-gcm-toolbar .tps-gcm-row > label {
        display: none;
      }
      .tps-gcm-toolbar select,
      .tps-gcm-toolbar input,
      .tps-gcm-toolbar .tps-gcm-actions-row button {
        font-size: 11px;
        padding: 2px 6px;
      }
      .tps-gcm-toolbar .tps-gcm-actions-row {
        gap: 4px;
      }
      .tps-global-context-menu--persistent.tps-global-context-menu--reading {
        position: static !important;
        top: auto !important;
        bottom: auto !important;
        left: auto !important;
        right: auto !important;
        transform: none !important;
      }
      .tps-context-hidden-for-keyboard .tps-global-context-menu {
        opacity: 0;
        pointer-events: none;
      }

      /* Hide persistent inline menus when keyboard is visible on mobile */
      /* Use visibility instead of display:none to prevent layout thrashing and flicker */
      .tps-context-hidden-for-keyboard .tps-global-context-menu--persistent {
        visibility: hidden;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease, visibility 0.15s ease;
      }
      
      /* Add transition for smoother show/hide */
      .tps-global-context-menu--persistent {
        transition: opacity 0.15s ease, visibility 0.15s ease;
      }
      .tps-gcm-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      
      /* Inline tags container */
      .tps-gcm-tags-inline {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
      }
      
      .tps-gcm-tag {
        background: var(--background-modifier-hover);
        border-radius: 4px;
        padding: 2px 6px;
        font-size: 10px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        line-height: 1.2;
        text-transform: uppercase;
        font-weight: 600;
        color: var(--text-muted);
      }
      
      .tps-gcm-tag-removable {
        padding-right: 3px;
      }
      
      .tps-gcm-tag-text {
        display: inline;
      }
      
      .tps-gcm-tag-remove {
        border: none;
        background: transparent;
        color: inherit;
        opacity: 0.6;
        cursor: pointer;
        font-size: 14px;
        padding: 0 2px;
        line-height: 1;
        font-weight: normal;
        transition: opacity 0.15s ease;
      }
      
      .tps-gcm-tag-remove:hover {
        opacity: 1;
      }
      
      .tps-gcm-tag-add {
        border: 1px dashed var(--text-muted);
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 4px;
        font-weight: bold;
        transition: all 0.15s ease;
      }
      
      .tps-gcm-tag-add:hover {
        border-color: var(--interactive-accent);
        color: var(--interactive-accent);
      }
      
      .tps-gcm-tag button {
        border: none;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 11px;
        padding: 0;
      }
      
      /* File operations row */
      .tps-gcm-file-ops-row {
        padding-top: 8px;
        border-top: 1px solid var(--background-modifier-border);
        margin-top: 4px;
      }
      
      .tps-gcm-file-ops {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      
      .tps-gcm-file-op-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        background: var(--background-primary);
        color: var(--text-muted);
        cursor: pointer;
        font-size: 11px;
        transition: all 0.15s ease;
      }
      
      .tps-gcm-file-op-btn:hover {
        background: var(--background-modifier-hover);
        color: var(--text-normal);
        border-color: var(--interactive-accent);
      }
      
      .tps-gcm-file-op-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      
      .tps-gcm-file-op-icon svg {
        width: 12px;
        height: 12px;
      }
      
      .tps-gcm-file-op-label {
        white-space: nowrap;
      }
      
      .tps-gcm-panel--hidden {
        display: none;
      }
      .tps-gcm-panel-toggle {
        display: flex;
        justify-content: flex-end;
        padding: 6px 14px 10px;
      }
      .tps-gcm-panel-toggle button {
        font-size: 12px;
        border: none;
        cursor: pointer;
        color: var(--interactive-accent);
        background: transparent;
      }
      .tps-gcm-add-row {
        display: flex;
        gap: 6px;
      }
      .tps-gcm-add-row .tps-gcm-input-wrapper {
        flex: 1;
      }
      .tps-gcm-add-row button {
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-modifier-hover);
        padding: 4px 8px;
        cursor: pointer;
        white-space: nowrap;
      }
      .tps-gcm-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-primary);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
        max-height: 200px;
        overflow-y: auto;
        z-index: 10000;
      }
      .tps-gcm-dropdown-item {
        padding: 6px 10px;
        cursor: pointer;
      }
      .tps-gcm-dropdown-item:hover {
        background: var(--background-modifier-hover);
      }
      .tps-gcm-input-button {
        width: 100%;
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        padding: 6px 8px;
        text-align: left;
        cursor: pointer;
      }
      .tps-gcm-recurrence-modal {
        position: fixed;
        top: 0;
        left: 0;
        transform: none;
        width: min(320px, calc(100vw - 32px));
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 10px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35);
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 10001;
        max-height: calc(100vh - 32px);
        overflow-y: auto;
      }
      .tps-gcm-recurrence-options {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .tps-gcm-recurrence-options button {
        flex: 1 1 40%;
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        padding: 6px;
        cursor: pointer;
        font-size: 12px;
      }
      .tps-gcm-recurrence-header {
        font-size: 11px;
        text-transform: uppercase;
        color: var(--text-muted);
        letter-spacing: 0.1em;
      }
      .tps-gcm-recurrence-actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
      }
      .tps-gcm-recurrence-actions button {
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-modifier-hover);
        color: var(--text-normal);
        padding: 6px 12px;
        cursor: pointer;
      }
      .tps-gcm-actions-row {
        display: flex;
        justify-content: space-between;
        gap: 6px;
        margin-top: 4px;
      }
      .tps-gcm-actions-row button {
        flex: 1;
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-modifier-hover);
        color: var(--text-normal);
        padding: 6px 8px;
        cursor: pointer;
      }
      .tps-gcm-actions-row button.tps-gcm-actions-delete {
        color: var(--text-accent);
      }
      .tps-gcm-native-menu-section {
        border-top: 1px solid var(--background-modifier-border);
        padding: 8px 0;
        margin-top: 4px;
      }
      .tps-gcm-section-header {
        padding: 4px 14px 8px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-muted);
      }
      .tps-gcm-native-items {
        display: flex;
        flex-direction: column;
      }
      .tps-gcm-native-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        border: none;
        background: transparent;
        padding: 6px 14px;
        text-align: left;
        cursor: pointer;
        color: var(--text-normal);
        font-size: 13px;
      }
      .tps-gcm-native-item:hover:not(:disabled),
      .tps-gcm-native-item:focus:not(:disabled) {
        background-color: var(--background-modifier-hover);
        outline: none;
      }
      .tps-gcm-native-item:disabled,
      .tps-gcm-native-item.is-disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .tps-gcm-item-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }
      .tps-gcm-item-icon svg {
        width: 16px;
        height: 16px;
      }
      .tps-gcm-separator {
        height: 1px;
        background: var(--background-modifier-border);
        margin: 4px 8px;
      }
      
      /* Collapsed state styles */
      .tps-global-context-menu--collapsed .tps-gcm-panel {
        display: none;
      }
      
      .tps-global-context-menu--persistent .tps-global-context-header {
        cursor: pointer;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        user-select: none;
        gap: 8px;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
      }
      
      .tps-global-context-menu--persistent .tps-global-context-header:hover {
        color: var(--text-normal);
      }

      .tps-gcm-header-left {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }

      .tps-gcm-header-right {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 6px;
        flex-wrap: nowrap;
        flex: 1;
        overflow: hidden;
        min-width: 0;
        padding-left: 2px;
      }
      
      .tps-gcm-header-right::-webkit-scrollbar {
        display: none;
      }

      .tps-gcm-header-title {
        font-weight: 600;
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 160px;
      }

      .tps-gcm-collapse-button {
        min-width: 28px;
        min-height: 28px;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
        padding: 0;
        flex-shrink: 0;
        position: relative;
        z-index: 10;
        transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        image-rendering: -webkit-optimize-contrast;
        -webkit-font-smoothing: antialiased;
      }

      .tps-gcm-collapse-button:hover {
        background: var(--background-modifier-hover);
        color: var(--text-normal);
        border-color: var(--interactive-accent);
      }

      .tps-gcm-collapse-button:active {
        background: var(--background-modifier-active-hover);
      }

      @media (max-width: 768px) {
        .tps-gcm-collapse-button {
          min-width: 36px;
          min-height: 36px;
          width: 36px;
          height: 36px;
        }
      }

      .tps-gcm-collapse-button::before {
        content: '';
        width: 10px;
        height: 10px;
        border-left: 2px solid currentColor;
        border-bottom: 2px solid currentColor;
        transform: rotate(-45deg);
        transition: transform 0.2s ease;
        image-rendering: crisp-edges;
      }

      .tps-gcm-collapse-button[aria-expanded='true']::before {
        transform: rotate(135deg);
      }

      .tps-gcm-collapse-button:focus-visible {
        outline: 2px solid var(--interactive-accent);
        outline-offset: 2px;
      }

      .tps-global-context-menu--collapsed.tps-global-context-menu--live {
        width: fit-content;
        display: block;
        min-width: 0;
        border-top-left-radius: 8px;
        border-top-right-radius: 8px;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        padding: 4px 8px !important;
      }

      .tps-global-context-menu--collapsed.tps-global-context-menu--live .tps-global-context-header {
        justify-content: flex-start;
        padding: 0;
        gap: 8px;
      }
      
      .tps-gcm-nav-group {
        display: flex;
        align-items: center;
        gap: 2px;
      }

      .tps-gcm-nav-button {
        min-width: 24px;
        min-height: 24px;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        border: none;
        background: transparent;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
        padding: 0;
        flex-shrink: 0;
        transition: color 0.15s ease, background-color 0.15s ease;
      }

      .tps-gcm-nav-button:hover {
        color: var(--text-normal);
        background: var(--background-modifier-hover);
      }
      
      .tps-gcm-nav-button svg {
        width: 14px;
        height: 14px;
      }

      /* Hide navigation buttons on very small screens or when constrained */
      @media (max-width: 400px) {
        .tps-gcm-nav-group {
          display: none;
        }
      }

      .tps-global-context-menu--collapsed.tps-global-context-menu--live .tps-gcm-header-right {
        margin-right: 0;
        flex: 0 0 auto;
      }
      
      /* Hide title text when collapsed, but keep the collapse button */
      .tps-global-context-menu--collapsed .tps-gcm-file-title {
        display: none;
      }

      /* Fix overlap: Ensure left section (button only) takes natural width in collapsed mode */
      .tps-global-context-menu--collapsed .tps-gcm-header-left {
        flex: 0 0 auto !important;
      }
      
      /* Recurrence preview section */
      .tps-gcm-recurrence-preview {
        margin-top: 12px;
        padding: 8px;
        background: var(--background-primary);
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
      }
      
      .tps-gcm-recurrence-preview-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-muted);
        margin-bottom: 6px;
      }
      
      .tps-gcm-recurrence-preview-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      
      .tps-gcm-recurrence-preview-item {
        font-size: 12px;
        color: var(--text-normal);
        padding: 2px 0;
      }
      

      .tps-gcm-badge {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        background: var(--background-modifier-hover);
        color: var(--text-muted);
        text-transform: uppercase;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        line-height: 1.3;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
        letter-spacing: 0.02em;
      }
      
      .tps-gcm-badge:hover {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
      }

      .tps-gcm-badge-add-tag {
        background: var(--interactive-accent) !important;
        color: var(--text-on-accent) !important;
        border: none !important;
        font-size: 11px;
        font-weight: 700;
        min-width: 18px;
        text-align: center;
      }

      .tps-gcm-badge-add-tag:hover {
        background: var(--interactive-accent-hover) !important;
        transform: scale(1.05);
      }

      .tps-gcm-badge-add-tag:active {
        transform: scale(0.95);
      }

      /* Seamless integration for Reading Mode Collapsed State */
      .tps-global-context-menu--reading.tps-global-context-menu--collapsed {
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        padding: 0 !important;
        margin-bottom: 12px !important;
        min-width: 0 !important;
        width: 100% !important;
      }

      .tps-global-context-menu--reading.tps-global-context-menu--collapsed .tps-global-context-header {
        padding: 0 !important;
        color: var(--text-muted) !important;
        font-size: 0.9em !important;
        justify-content: flex-start !important; /* Align badges to left */
        gap: 8px;
      }

      /* Reset the right container to flow naturally */
      .tps-global-context-menu--reading.tps-global-context-menu--collapsed .tps-gcm-header-right {
        margin-right: 0 !important;
      }

      /* Prevent spreading in Reading Mode */
      .tps-global-context-menu--reading.tps-global-context-menu--collapsed .tps-gcm-header-left {
        flex: 0 0 auto !important;
      }

      /* ===== MOBILE-SPECIFIC COMPACT STYLING ===== */
      @media (max-width: 640px) {
        /* Smaller, more compact badges on mobile */
        .tps-gcm-badge {
          font-size: 9px;
          padding: 2px 4px;
        }
        
        /* Keep badges inline - prevent stacking */
        .tps-gcm-header-right {
          gap: 3px;
          flex-wrap: nowrap;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
          max-width: calc(100vw - 120px); /* Constrain width to prevent overflow */
        }
        
        .tps-gcm-header-right::-webkit-scrollbar {
          display: none;
        }

        /* Ensure header is properly laid out on mobile collapsed */
        .tps-global-context-menu--collapsed.tps-global-context-menu--live .tps-global-context-header {
          flex-wrap: nowrap;
          overflow: hidden;
          max-width: 100%;
        }
        
        /* Reduce panel padding on mobile */
        .tps-global-context-menu--live .tps-gcm-panel {
          padding: 6px 10px 8px;
          gap: 6px;
        }
        
        /* Compact header on mobile */
        .tps-global-context-menu--live .tps-global-context-header {
          padding: 3px 10px 6px;
        }
        
        /* Smaller collapse button on mobile */
        .tps-gcm-collapse-button {
          min-width: 28px;
          min-height: 28px;
          width: 28px;
          height: 28px;
        }
        
        /* More compact tags */
        .tps-gcm-tags {
          gap: 3px;
          flex-wrap: nowrap;
          overflow-x: auto;
        }
        
        .tps-gcm-tag {
          font-size: 8px;
          padding: 1px 4px;
          flex-shrink: 0;
        }
      }
      
      /* Keyboard hiding - use display: none for reliable hiding */
      .tps-context-hidden-for-keyboard .tps-global-context-menu--persistent {
        display: none !important;
      }

    `;
