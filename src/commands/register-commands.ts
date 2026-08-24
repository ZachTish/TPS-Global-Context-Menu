import { MarkdownView, Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { promptFilePropertiesRelink } from '../modals/file-properties-relink-modal';
import * as logger from '../logger';

/**
 * Registers all plugin commands on the given plugin instance.
 * Extracted from `onload` to keep main.ts concise.
 */
export function registerGcmCommands(plugin: TPSGlobalContextMenuPlugin): void {
    plugin.addCommand({
        id: 'open-home',
        name: 'Open TPS Home',
        callback: async () => {
            await plugin.openHomeView();
        },
    });

    plugin.addCommand({
        id: 'home-quick-capture',
        name: "Capture: Today's Daily Note",
        callback: () => {
            void plugin.homeCaptureService.openCaptureModal();
        },
    });

    plugin.addCommand({
        id: 'capture-to-current-note',
        name: 'Capture: Current note',
        callback: () => {
            void plugin.homeCaptureService.openCaptureModalForCurrentNote();
        },
    });

    plugin.addCommand({
        id: 'capture-to-home-note',
        name: 'Home: Capture to selected Daily Note',
        callback: () => {
            void plugin.homeCaptureService.openCaptureModal();
        },
    });

    plugin.addCommand({
        id: 'add-task-to-home-note',
        name: 'Home: Add task to selected Daily Note',
        callback: () => {
            void plugin.homeCaptureService.openCaptureModal(undefined, { task: true });
        },
    });

    plugin.addCommand({
        id: 'create-task',
        name: 'Create task',
        callback: () => {
            plugin.createTaskService.openCreateTaskModal();
        },
    });

    plugin.addCommand({
        id: 'promote-current-task-to-record',
        name: 'Tasks: Promote current task to tracked record',
        callback: async () => {
            if (!plugin.nativeRecordService.isEnabled()) {
                new Notice('TPS GCM: Enable Native Markdown records in Advanced settings, then reload Obsidian.');
                return;
            }
            const view = getActiveMarkdownEditor(plugin);
            const file = view?.file;
            if (!view || !(file instanceof TFile)) return;
            const lineNumber = view.editor.getCursor().line;
            const rawLine = view.editor.getLine(lineNumber);
            const result = await plugin.nativeRecordService.promoteTask({
                path: file.path,
                lineNumber,
                rawLine,
            }, { kind: 'user', surface: 'command-promote-task-record' });
            if (!result.ok) {
                new Notice(`TPS GCM: ${result.error || 'Could not promote this task.'}`);
                return;
            }
            new Notice(`Promoted task to ${result.record?.path || 'a tracked record'}.`);
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
        id: 'transfer-current-line-to-note',
        name: 'Transfer current line to note',
        callback: () => {
            const view = getActiveMarkdownEditor(plugin);
            if (!view) return;
            plugin.dailyInboxLineService.promptTransferCurrentEditorLine(view.editor, view);
        },
    });

    plugin.addCommand({
        id: 'link-current-task-line-to-note',
        name: 'Link current task line to note',
        callback: () => {
            const view = getActiveMarkdownEditor(plugin);
            if (!view) return;
            plugin.dailyInboxLineService.promptLinkCurrentEditorTaskLine(view.editor, view);
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
        id: 'open-file-properties-note',
        name: 'File properties: Open properties note for current file',
        callback: async () => {
            const file = plugin.app.workspace.getActiveFile();
            if (!(file instanceof TFile) || !plugin.filePropertiesService.isPropertyTarget(file)) {
                new Notice('TPS GCM: Open a non-Markdown file first.');
                return;
            }
            if (plugin.filePropertiesService.getRelinkCandidate(file)) {
                new Notice('TPS GCM: Retained properties exist for a missing file at this path. Use “File properties: Relink retained properties to current file” first.');
                return;
            }
            try {
                const companion = await plugin.filePropertiesService.ensureCompanion(file);
                await plugin.openFileInLeaf(companion, false, () => plugin.app.workspace.getLeaf(false), {
                    revealLeaf: true,
                    ignoreCanvasDragGuard: true,
                });
            } catch {
                new Notice(`TPS GCM: Could not create the properties note for ${file.name}.`);
            }
        },
    });

    plugin.addCommand({
        id: 'open-or-create-native-asset-record',
        name: 'Native records: Open or create asset record for current file',
        callback: async () => {
            const file = plugin.app.workspace.getActiveFile();
            if (!plugin.usesNativeRecordArchitecture()) {
                new Notice('TPS GCM: Native record mode is not enabled.');
                return;
            }
            if (!(file instanceof TFile) || file.extension.toLowerCase() === 'md') {
                new Notice('TPS GCM: Open a non-Markdown file first.');
                return;
            }
            try {
                const record = await plugin.nativeRecordService.ensureAsset(file, {}, {
                    cause: { kind: 'user', surface: 'native-asset-command' },
                });
                await plugin.openFileInLeaf(record.file, false, () => plugin.app.workspace.getLeaf(false), {
                    revealLeaf: true,
                    ignoreCanvasDragGuard: true,
                });
            } catch (error) {
                logger.warn('[TPS GCM] Could not open native asset record', { path: file.path, error });
                new Notice(`TPS GCM: Could not create the asset record for ${file.name}.`);
            }
        },
    });

    plugin.addCommand({
        id: 'relink-file-properties-note',
        name: 'File properties: Relink properties to current file…',
        callback: () => {
            const file = plugin.app.workspace.getActiveFile();
            if (!(file instanceof TFile) || !plugin.filePropertiesService.isPropertyTarget(file)) {
                new Notice('TPS GCM: Open the replacement non-Markdown file first.');
                return;
            }
            promptFilePropertiesRelink(plugin, file);
        },
    });

    plugin.addCommand({
        id: 'import-legacy-canvas-properties',
        name: 'File properties: Import legacy Canvas properties',
        callback: async () => {
            const canvases = plugin.app.vault.getFiles().filter((file) =>
                file instanceof TFile
                && file.extension?.toLowerCase() === 'canvas'
                && !plugin.filePropertiesService.hasCompanion(file),
            );
            let imported = 0;
            let failed = 0;
            for (const canvas of canvases) {
                try {
                    const legacy = await plugin.filePropertiesService.getFrontmatterAsync(canvas);
                    if (Object.keys(legacy).length === 0) continue;
                    await plugin.filePropertiesService.ensureCompanion(canvas, { importLegacyCanvas: true });
                    imported += 1;
                } catch {
                    failed += 1;
                }
            }
            new Notice(
                failed > 0
                    ? `Imported ${imported} Canvas property record(s); ${failed} could not be imported.`
                    : `Imported ${imported} Canvas property record(s).`,
            );
        },
    });

    plugin.addCommand({
        id: 'time-tracking-start-active-target',
        name: 'Time tracking: Start work session for current task or note',
        callback: async () => {
            const target = await plugin.timeTrackingService.resolveActiveTarget();
            await plugin.timeTrackingService.startTimer(target ?? undefined);
        },
    });

    plugin.addCommand({
        id: 'time-tracking-open-active-notes',
        name: 'Time tracking: Open active work-session notes',
        callback: async () => {
            const active = await plugin.timeTrackingService.getActiveTimer();
            const opened = active
                ? await plugin.timeTrackingService.openHydratedSessionNotes(active)
                : await plugin.timeTrackingService.openPausedTimerNotes();
            if (!opened) new Notice('TPS GCM: No active or paused work-session notes.');
        },
    });

    plugin.addCommand({
        id: 'time-tracking-stop-active',
        name: 'Time tracking: Stop active timer',
        callback: async () => {
            await plugin.timeTrackingService.stopActiveTimer();
        },
    });

}

function getActiveMarkdownEditor(plugin: TPSGlobalContextMenuPlugin): MarkdownView | null {
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.editor) {
        new Notice('TPS GCM: Open a markdown editor before running this line command.');
        return null;
    }
    return view;
}
