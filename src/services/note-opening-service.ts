import { Notice, Platform, TFile, type App, type WorkspaceLeaf } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';

export type NotePostCreateBehavior = 'preview' | 'open' | 'stay';
export interface CreatedNoteRequest {
  filePath: string;
  sourcePluginId: string;
  anchorEl?: HTMLElement | null;
  sourceLeaf?: WorkspaceLeaf | null;
  renameTitle?: boolean;
  explicitDestination?: 'tab' | 'split' | 'window';
}

export function normalizeNoteOpeningSettings(value: Record<string, unknown>) {
  return {
    notePostCreateBehavior: (['preview', 'open', 'stay'].includes(String(value.notePostCreateBehavior))
      ? value.notePostCreateBehavior : 'preview') as NotePostCreateBehavior,
    noteOpenDestination: value.noteOpenDestination === 'new-tab' ? 'new-tab' as const : 'current-tab' as const,
  };
}

/** Read legacy preferences once, independently of plugin startup order. */
export async function migrateNoteOpeningSettings(app: App, loaded: Record<string, unknown>) {
  const result = normalizeNoteOpeningSettings(loaded);
  const readPreference = async (id: string): Promise<Record<string, unknown>> => {
    const path = `${app.vault.configDir}/plugins/${id}/data.json`;
    try {
      if (!await app.vault.adapter.exists(path)) return {};
      return JSON.parse(await app.vault.adapter.read(path)) ?? {};
    }
    catch { return {}; }
  };
  if (!Object.prototype.hasOwnProperty.call(loaded, 'notePostCreateBehavior')) {
    const calendar = await readPreference('tps-calendar-base');
    if (['preview', 'open', 'stay'].includes(String(calendar.postCreateBehavior))) {
      result.notePostCreateBehavior = calendar.postCreateBehavior as NotePostCreateBehavior;
    } else if (calendar.openTaskDestinationAfterCreate === false) result.notePostCreateBehavior = 'stay';
  }
  if (!Object.prototype.hasOwnProperty.call(loaded, 'noteOpenDestination')) {
    const navigator = await readPreference('tps-notebook-navigator');
    if (navigator.createNewNotesInNewTab === true) result.noteOpenDestination = 'new-tab';
  }
  return result;
}

export class NoteOpeningService {
  constructor(private plugin: TPSGlobalContextMenuPlugin) {}

  async present(request: CreatedNoteRequest): Promise<boolean> {
    if (!request || typeof request.filePath !== 'string' || typeof request.sourcePluginId !== 'string') return false;
    const { app } = this.plugin;
    const file = app.vault.getAbstractFileByPath(request.filePath);
    if (!(file instanceof TFile)) return false;
    const behavior = request.explicitDestination ? 'open' : this.plugin.settings.notePostCreateBehavior;
    logger.flow('NoteOpening', 'created:route', { path: file.path, source: request.sourcePluginId, behavior });
    if (behavior === 'open' || file.extension !== 'md') {
      const context = request.explicitDestination ?? (this.plugin.settings.noteOpenDestination === 'new-tab' ? 'tab' : false);
      const opened = await this.open(file, context);
      if (opened && request.renameTitle) this.plugin.findOpenLeafForFile(file)?.view.setEphemeralState({ rename: 'all' });
      return true;
    }
    if (behavior === 'stay') return true;
    const anchor = request.anchorEl?.isConnected ? request.anchorEl
      : request.sourceLeaf?.view.containerEl?.isConnected ? request.sourceLeaf.view.containerEl
      : app.workspace.activeLeaf?.view.containerEl;
    try {
      if (anchor?.isConnected && await this.plugin.persistentMenuManager.showBaseLinkEditablePreview(file, anchor, {
        focusEditor: !Platform.isMobile && !request.renameTitle,
        focusTitle: request.renameTitle === true,
        openNote: () => this.open(file),
      })) return true;
    } catch (error) {
      logger.flowError('NoteOpening', 'created:preview-failed', error, { path: file.path });
    }
    const message = document.createDocumentFragment();
    message.append('Note created. Editable preview is unavailable. ');
    const button = document.createElement('button');
    button.textContent = 'Open note';
    button.addEventListener('click', () => { void this.open(file); });
    message.append(button);
    new Notice(message, 10000);
    return true; // Creation was handled; callers must not open a second surface.
  }

  async open(file: TFile, context: 'tab' | 'split' | 'window' | false = this.plugin.settings.noteOpenDestination === 'new-tab' ? 'tab' : false): Promise<boolean> {
    try {
      if (await this.plugin.openFileInLeaf(file, context, () => this.plugin.app.workspace.getLeaf(context), { revealLeaf: true })) return true;
    } catch (error) {
      logger.flowError('NoteOpening', 'created:open-failed', error, { path: file.path });
    }
    new Notice(`Note created, but could not open ${file.basename}. Open it from Navigator or the file explorer.`);
    return false;
  }
}
