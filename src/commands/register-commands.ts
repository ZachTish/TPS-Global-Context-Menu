import { MarkdownView, Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';

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
