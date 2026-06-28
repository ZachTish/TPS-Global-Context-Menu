import { MarkdownView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import * as logger from '../logger';
import type TPSGlobalContextMenuPlugin from '../main';

/**
 * Registers all plugin commands on the given plugin instance.
 * Extracted from `onload` to keep main.ts concise.
 */
export function registerGcmCommands(plugin: TPSGlobalContextMenuPlugin): void {
    plugin.addCommand({
        id: 'create-task',
        name: 'Create task',
        callback: () => {
            plugin.createTaskService.openCreateTaskModal();
        },
    });

    plugin.addCommand({
        id: 'ai-assisted-task-creator',
        name: 'AI assisted task creator',
        callback: () => {
            plugin.aiAssistedTaskService.openAiAssistedTaskModal();
        },
    });

    plugin.addCommand({
        id: 'archive-current-line-in-place',
        name: 'Archive current line in place',
        checkCallback: (checking) => {
            const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view?.editor) {
                return false;
            }
            if (!checking) {
                plugin.dailyInboxLineService.promptArchiveCurrentEditorLine(view.editor, view);
            }
            return true;
        },
    });

    plugin.addCommand({
        id: 'transfer-current-line-to-note',
        name: 'Transfer current line to note',
        checkCallback: (checking) => {
            const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view?.editor) {
                return false;
            }
            if (!checking) {
                plugin.dailyInboxLineService.promptTransferCurrentEditorLine(view.editor, view);
            }
            return true;
        },
    });

    plugin.addCommand({
        id: 'link-current-task-line-to-note',
        name: 'Link current task line to note',
        checkCallback: (checking) => {
            const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view?.editor) {
                return false;
            }
            if (!checking) {
                plugin.dailyInboxLineService.promptLinkCurrentEditorTaskLine(view.editor, view);
            }
            return true;
        },
    });

    plugin.addCommand({
        id: 'edit-task-recurrence-templates',
        name: 'Edit task recurrence templates',
        callback: () => {
            void plugin.taskRecurrenceService.openTemplatesCommand();
        },
    });

    plugin.addCommand({
        id: 'open-in-right-sidebar',
        name: 'Open active file in Right Sidebar',
        checkCallback: (checking: boolean) => {
            const file = plugin.app.workspace.getActiveFile();
            if (file) {
                if (!checking) {
                    void openActiveFileInSidebar(plugin, file, 'right');
                }
                return true;
            }
            return false;
        },
    });

    plugin.addCommand({
        id: 'open-in-left-sidebar',
        name: 'Open active file in Left Sidebar',
        checkCallback: (checking: boolean) => {
            const file = plugin.app.workspace.getActiveFile();
            if (file) {
                if (!checking) {
                    void openActiveFileInSidebar(plugin, file, 'left');
                }
                return true;
            }
            return false;
        },
    });

    plugin.addCommand({
        id: 'repair-template-derived-titles',
        name: 'Repair template-derived titles from filenames',
        callback: async () => {
            new Notice('TPS GCM: Repairing template-derived titles...');
            try {
                const result = await plugin.fileNamingService.repairTemplateDerivedTitlesAcrossVault();
                new Notice(
                    `TPS GCM: Title repair complete. Updated ${result.updated} of ${result.scanned} scanned notes${result.failed > 0 ? ` (${result.failed} failed)` : ''}.`,
                );
            } catch (error) {
                logger.error('[TPS GCM] Failed to repair template-derived titles', error);
                new Notice('TPS GCM: Title repair failed. Check console logs.');
            }
        },
    });

    plugin.addCommand({
        id: 'repair-missing-titles',
        name: 'Repair missing titles from filenames',
        callback: async () => {
            new Notice('TPS GCM: Repairing missing titles...');
            try {
                const result = await plugin.fileNamingService.repairMissingTitlesAcrossVault();
                new Notice(
                    `TPS GCM: Missing-title repair complete. Updated ${result.updated} of ${result.scanned} scanned notes${result.failed > 0 ? ` (${result.failed} failed)` : ''}.`,
                );
            } catch (error) {
                logger.error('[TPS GCM] Failed to repair missing titles', error);
                new Notice('TPS GCM: Missing-title repair failed. Check console logs.');
            }
        },
    });

    plugin.addCommand({
        id: 'reconcile-active-filename-from-title',
        name: 'Reconcile active filename from title',
        callback: async () => {
            const file = plugin.app.workspace.getActiveFile();
            if (!(file instanceof TFile) || file.extension !== 'md') {
                new Notice('TPS GCM: No active markdown note to reconcile.');
                return;
            }
            const title = plugin.noteTitleRenderService.getDisplayTitle(file);
            await plugin.fileNamingService.updateFilenameIfNeeded(file, {
                bypassCreationGrace: true,
                bypassProcessingLock: true,
                titleOverride: title,
            });
        },
    });

    plugin.addCommand({
        id: 'rename-active-note-title',
        name: 'Rename active note title',
        callback: async () => {
            const file = plugin.app.workspace.getActiveFile();
            if (!(file instanceof TFile) || file.extension !== 'md') {
                new Notice('TPS GCM: No active markdown note to rename.');
                return;
            }
            await plugin.noteTitleRenderService.promptRenameTitle(file);
        },
    });

    plugin.addCommand({
        id: 'toggle-inline-ui',
        name: 'Toggle inline context menu UI',
        callback: async () => {
            plugin.settings.enableInlinePersistentMenus = !plugin.settings.enableInlinePersistentMenus;
            await plugin.saveSettings();
            new Notice(
                plugin.settings.enableInlinePersistentMenus
                    ? 'TPS GCM inline UI enabled'
                    : 'TPS GCM inline UI hidden',
            );
        },
    });

    plugin.addCommand({
        id: 'time-tracking-start-active-target',
        name: 'Time tracking: Start timer for current note or line',
        callback: async () => {
            const target = await plugin.timeTrackingService.resolveActiveTarget();
            await plugin.timeTrackingService.startTimer(target ?? undefined);
        },
    });

    plugin.addCommand({
        id: 'time-tracking-stop-active',
        name: 'Time tracking: Stop active timer',
        callback: async () => {
            await plugin.timeTrackingService.stopActiveTimer();
        },
    });

    plugin.addCommand({
        id: 'time-tracking-pause-active',
        name: 'Time tracking: Pause active timer',
        callback: async () => {
            await plugin.timeTrackingService.pauseActiveTimer();
        },
    });

    plugin.addCommand({
        id: 'time-tracking-resume-paused',
        name: 'Time tracking: Resume paused timer',
        callback: async () => {
            await plugin.timeTrackingService.resumePausedTimer();
        },
    });

    plugin.addCommand({
        id: 'time-tracking-add-manual-active-target',
        name: 'Time tracking: Add manual session for current note or line',
        callback: async () => {
            const target = await plugin.timeTrackingService.resolveActiveTarget();
            await plugin.timeTrackingService.promptAddManualSession(target ?? undefined);
        },
    });

    plugin.addCommand({
        id: 'dry-run-legacy-calendar-identity-migration',
        name: 'Dry run legacy calendar identity migration',
        callback: async () => {
            new Notice('TPS GCM: Scanning legacy calendar identity fields...');
            try {
                const result = await plugin.identityMigrationService.dryRunLegacyCalendarIdentityMigration();
                console.table(result.candidates);
                logger.log('[TPS GCM] Legacy calendar identity migration dry run', result);
                new Notice(`TPS GCM: Dry run found ${result.candidates.length} legacy calendar note${result.candidates.length === 1 ? '' : 's'} across ${result.scanned} scanned notes. See console for file list.`);
            } catch (error) {
                logger.error('[TPS GCM] Legacy calendar identity migration dry run failed', error);
                new Notice('TPS GCM: Identity migration dry run failed. Check console logs.');
            }
        },
    });

    plugin.addCommand({
        id: 'unlink-active-note-from-all-parents',
        name: 'Unlink active note from all parents',
        checkCallback: (checking: boolean) => {
            const file = plugin.app.workspace.getActiveFile();
            if (!file || file.extension?.toLowerCase() !== 'md') {
                return false;
            }
            if (!checking) {
                void (async () => {
                    const removed = await plugin.bulkEditService.unlinkFromAllParents(file);
                    if (removed > 0) {
                        new Notice(`Unlinked ${file.basename} from ${removed} parent link${removed === 1 ? '' : 's'}.`);
                    } else {
                        new Notice(`${file.basename} has no parent links to remove.`);
                    }
                })();
            }
            return true;
        },
    });
}

async function openActiveFileInSidebar(
    plugin: TPSGlobalContextMenuPlugin,
    file: TFile,
    side: 'left' | 'right',
): Promise<void> {
    const existing = findSidebarLeafForFile(plugin, file, side);
    const leaf = existing
        ?? (side === 'right'
            ? plugin.app.workspace.getRightLeaf(false) ?? plugin.app.workspace.getRightLeaf(true)
            : plugin.app.workspace.getLeftLeaf(false) ?? plugin.app.workspace.getLeftLeaf(true));

    if (!leaf) {
        new Notice(`Could not open the ${side} sidebar.`);
        return;
    }

    try {
        if (!existing) {
            await leaf.openFile(file, { active: false } as any);
        }
        plugin.app.workspace.revealLeaf(leaf);
    } catch (error) {
        logger.error('[TPS GCM] Failed to open active file in sidebar', {
            file: file.path,
            side,
            error,
        });
        new Notice(`Could not open ${file.basename} in the ${side} sidebar.`);
    }
}

function findSidebarLeafForFile(
    plugin: TPSGlobalContextMenuPlugin,
    file: TFile,
    side: 'left' | 'right',
): WorkspaceLeaf | null {
    let match: WorkspaceLeaf | null = null;
    plugin.app.workspace.iterateAllLeaves((leaf) => {
        if (match) return;
        const viewFile = (leaf.view as any)?.file;
        if (!(viewFile instanceof TFile) || viewFile.path !== file.path) return;
        if (!isSidebarLeaf(leaf, side)) return;
        match = leaf;
    });
    return match;
}

function isSidebarLeaf(leaf: WorkspaceLeaf, side: 'left' | 'right'): boolean {
    const container = (leaf.view as any)?.containerEl as HTMLElement | undefined;
    if (!container) return false;
    const selector = side === 'right'
        ? '.workspace-split.mod-right-split, .workspace-sidedock.mod-right'
        : '.workspace-split.mod-left-split, .workspace-sidedock.mod-left';
    return Boolean(container.closest(selector));
}
