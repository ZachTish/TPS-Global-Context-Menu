import { TFile, MarkdownView } from 'obsidian';

/**
 * Plugin settings interface
 */
export interface CustomProperty {
  id: string;
  label: string;
  key: string;
  type: 'text' | 'number' | 'datetime' | 'selector' | 'list' | 'recurrence' | 'folder' | 'snooze';
  options?: string[]; // For selector
  icon?: string;
  showInCollapsed?: boolean; // Whether to show this property in the collapsed inline header
  showInContextMenu?: boolean; // Whether to show this property in the right-click context menu
}

export interface TPSGlobalContextMenuSettings {
  enableLogging: boolean;
  enableInLivePreview: boolean;
  enableInPreview: boolean;
  enableInSidePanels: boolean;
  enableStrictMode: boolean;
  enableLineItems: boolean; // LINE-ITEMS: Feature flag
  suppressMobileKeyboard: boolean;
  properties: CustomProperty[];

  // Recurrence settings
  enableRecurrence: boolean;
  promptOnRecurrenceEdit: boolean;
  recurrencePromptTimeout: number; // Minutes
  recurrenceCompletionStatuses: string[];
  recurrenceDefaultStatus: string; // Default status for new recurrence instances

  // File naming settings

  enableAutoRename: boolean;
  autoSaveFolderPath: boolean;
  folderExclusions: string;
  checkOpenChecklistItems: boolean;

  // View Mode Settings
  enableViewModeSwitching: boolean;
  viewModeFrontmatterKey: string;
  viewModeIgnoredFolders: string;
  viewModeRules: { key: string; value: string; mode: string }[];

  // System commands
  systemCommands: string[];

  // Snooze Settings
  snoozeOptions: { label: string; minutes: number }[];
}

/**
 * Frontmatter data structure for TPS notes
 */
export interface FrontmatterData {
  status?: string;
  priority?: string;
  prio?: string;
  title?: string;
  scheduled?: string;
  sheduledEnd?: string;
  timeEstimate?: number;
  tags?: string | string[];
  recurrenceRule?: string;
  recurrence?: string;
  [key: string]: any;
}

/**
 * File entry with associated frontmatter
 */
export interface FileEntry {
  file: TFile;
  frontmatter: FrontmatterData;
}

/**
 * Context event data for reopening native menus
 */
export interface ContextEventData {
  target: HTMLElement;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  button: number;
}

/**
 * Options for showing menu
 */
export interface ShowMenuOptions {
  files: TFile[];
  event: MouseEvent;
  sourceEl: HTMLElement;
}

/**
 * Options for building special panel
 */
export interface BuildPanelOptions {
  recurrenceRoot?: HTMLElement | null;
  closeAfterRecurrence?: boolean;
}

/**
 * Folder option for type dropdown
 */
export interface FolderOption {
  path: string;
  display: string;
}

/**
 * Recurrence rule button option
 */
export interface RecurrenceOption {
  label: string;
  value: string;
}

/**
 * Parsed recurrence rule structure
 */
export interface ParsedRecurrence {
  freq: string | null;
  interval: number;
  byDay: string[];
}

/**
 * Menu instances for a markdown view
 */
export interface MenuInstances {
  reading?: HTMLElement | null;
  live?: HTMLElement | null;
  filePath?: string;
}

/**
 * Date row creation result
 */
export interface DateRowResult {
  row: HTMLElement;
  input: HTMLInputElement;
}

/**
 * End row creation result
 */
export interface EndRowResult {
  row: HTMLElement;
  input: HTMLInputElement;
  refresh: () => void;
}
