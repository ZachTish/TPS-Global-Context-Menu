import { App, TFile, TFolder, Modal, Notice } from 'obsidian';
import TPSGlobalContextMenuPlugin from './main';
import * as logger from "./logger";
import { RecurrenceModal } from './recurrence-modal';

/**
 * Tracks which files have been modified in this session to avoid repeated prompts
 */
class SessionTracker {
    private modifiedFiles: Map<string, number> = new Map();
    private sessionDuration: number;

    constructor(durationMinutes: number = 5) {
        this.sessionDuration = durationMinutes * 60 * 1000;
    }

    updateDuration(durationMinutes: number): void {
        this.sessionDuration = durationMinutes * 60 * 1000;
    }

    markAsModified(filePath: string): void {
        this.modifiedFiles.set(filePath, Date.now());
    }

    wasRecentlyModified(filePath: string): boolean {
        const lastModified = this.modifiedFiles.get(filePath);
        if (!lastModified) return false;

        const elapsed = Date.now() - lastModified;
        if (elapsed > this.sessionDuration) {
            this.modifiedFiles.delete(filePath);
            return false;
        }
        return true;
    }

    clear(): void {
        this.modifiedFiles.clear();
    }
}

/**
 * Service to handle recurrence logic, including creating next instances,
 * stripping rules, and prompting users on edit.
 */
export class RecurrenceService {
    plugin: TPSGlobalContextMenuPlugin;
    sessionTracker: SessionTracker;
    private contentChangeListeners: Map<string, () => void> = new Map();

    constructor(plugin: TPSGlobalContextMenuPlugin) {
        this.plugin = plugin;
        this.sessionTracker = new SessionTracker(plugin.settings.recurrencePromptTimeout);
    }

    updateSettings(): void {
        this.sessionTracker.updateDuration(this.plugin.settings.recurrencePromptTimeout);
    }

    markFileAsModified(filePath: string): void {
        this.sessionTracker.markAsModified(filePath);
    }

    /**
     * Start listening for edits to recurring files.
     * Replaces the old "Focus Prompt" with a passive "Edit Listener".
     */
    setup(): void {
        // Remove old listeners if any
        this.cleanup();

        // 1. Listen for Active Leaf Change (Focus Prompt)
        this.plugin.registerEvent(
            this.plugin.app.workspace.on('active-leaf-change', async (leaf) => {
                const file = this.plugin.app.workspace.getActiveFile();
                if (file instanceof TFile && file.extension === 'md') {
                    await this.handleFileFocus(file);
                }
            })
        );

        // 2. Listen for File Modification (Edit Prompt)
        // We listen to the vault modify event globally.
        this.plugin.registerEvent(
            this.plugin.app.vault.on('modify', async (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    await this.handleFileModification(file);
                }
            })
        );
    }

    cleanup(): void {
        this.sessionTracker.clear();
        // Global listener is registered to plugin, so it cleans up automatically on plugin unload.
    }

    /**
     * Handle a file modification event.
     * Checks if the file is recurring and if we should prompt the user.
     */
    /**
     * Handle a file focus event.
     * Checks if the file is recurring and prompts if not recently interacted with.
     */
    private async handleFileFocus(file: TFile): Promise<void> {
        // 1. Quick check: Is this file currently being tracked/ignored by session?
        if (this.sessionTracker.wasRecentlyModified(file.path)) return;

        // 2. Check for Recurrence Rule
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (!fm || (!fm.recurrenceRule && !fm.recurrence)) return;

        // 3. Ignore completed/wont-do items
        if (fm.status === 'complete' || fm.status === 'wont-do') return;

        // 4. Prompt the user
        // We use a specific "Focus" prompt logic
        await this.promptOnFocus(file);
    }

    /**
     * Prompt when focusing a recurring note
     */
    async promptOnFocus(file: TFile): Promise<void> {
        return new Promise((resolve) => {
            // We can reuse RecurrenceUpdateModal but with specific messaging?
            // Or construct a specific choice 'Choice': Next Instance vs Allow Edit
            // The previous logic used 'RecurrenceFocusModal'. I need to recreate/restore that or adapt UpdateModal.
            // Adapting UpdateModal is cleaner.
            new RecurrenceUpdateModal(this.plugin.app, 'focus', async (result) => {
                if (result === 'update-all') {
                    // "Edit Series" -> Allow focusing this file for this session
                    this.sessionTracker.markAsModified(file.path);
                } else if (result === 'split') {
                    // "Create Next"
                    await this.splitInstance(file);
                    this.sessionTracker.markAsModified(file.path);
                }
                // If cancel, we effectively do nothing, but don't mark as modified?
                // So next focus will prompt again? That can be annoying if switching tabs.
                // Maybe Cancel also suppresses for session?
                else if (result === 'cancel') {
                    // Treat cancel as "Just looking, don't bother me for a bit"
                    this.sessionTracker.markAsModified(file.path);
                }
                resolve();
            }).open();
        });
    }

    /**
     * Handle a file modification event.
     * Checks if the file is recurring and if we should prompt the user.
     */
    private async handleFileModification(file: TFile): Promise<void> {
        // 1. Quick check: Is this file currently being tracked/ignored by session?
        if (this.sessionTracker.wasRecentlyModified(file.path)) return;

        // 2. Check for Recurrence Rule
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (!fm || (!fm.recurrenceRule && !fm.recurrence)) return;

        // 3. Ignore completed/wont-do items
        if (fm.status === 'complete' || fm.status === 'wont-do') return;

        // 4. Prompt the user
        await this.promptForContentChange(file);
    }

    /**
     * Prompt user about content changes to recurring task.
     */
    async promptForContentChange(file: TFile): Promise<void> {
        const result = await this.promptUser('editing', file);

        if (result === 'update-all') {
            // User chose to edit the series. Mark as modified so we don't ask again.
            this.sessionTracker.markAsModified(file.path);
        } else if (result === 'split') {
            // User chose to split. 
            // We create the next recurrence (clone original), 
            // and then STRIP the recurrence from THIS file (the one being edited).
            await this.splitInstance(file);
            this.sessionTracker.markAsModified(file.path);
        }
        else {
            // Cancel logic? Or just treat as "update-all" implicitly if they keep typing?
            // Usually cancel means "I didn't mean to edit", but we can't easily undo the edit here without text buffer access.
            // For now, we assume they acknowledge the prompt. We won't mark as modified, so next edit triggers again?
            // That might be annoying. Let's assume Cancel = "Don't do anything special, but stop bugging me for a bit"
            // or actually, maybe we just mark as modified to suppress further prompts for this session.
            this.sessionTracker.markAsModified(file.path);
        }
    }

    /**
     * Prompt user about frontmatter changes to recurring task
     */
    async promptForFrontmatterChange(file: TFile, changeDescription: string): Promise<'update-all' | 'split' | 'cancel'> {
        // Don't prompt if already modified in this session
        if (this.sessionTracker.wasRecentlyModified(file.path)) {
            return 'update-all'; // Allow the change without prompting
        }

        const result = await this.promptUser(changeDescription, file);

        if (result === 'update-all') {
            this.sessionTracker.markAsModified(file.path);
        } else if (result === 'split') {
            await this.splitInstance(file);
            this.sessionTracker.markAsModified(file.path);
        }

        return result;
    }

    /**
     * Split this instance: Create NEXT recurrence now, and remove recurrence info from CURRENT file.
     */
    async splitInstance(file: TFile): Promise<void> {
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (!fm) return;

        // 1. Create the NEXT instance (clone of this one, moved to next date)
        await this.plugin.bulkEditService.createNextRecurrenceInstance(file, fm);

        // 2. Remove recurrence rule from THIS file (making it a single instance exception)
        // createNextRecurrenceInstance checks 'status', but here we are splitting an *active* task.
        // We just want to remove the rrule.
        await this.plugin.bulkEditService.updateFrontmatter([file], {
            recurrenceRule: null,
            recurrence: null
        });

        new Notice(`Split recurring event. Next instance created.`);
    }

    /**
     * Show modal to prompt user
     */
    private promptUser(changeType: string, file: TFile): Promise<'update-all' | 'split' | 'cancel'> {
        return new Promise((resolve) => {
            new RecurrenceUpdateModal(this.plugin.app, changeType, resolve).open();
        });
    }
}

class RecurrenceUpdateModal extends Modal {
    private resolve: (value: 'update-all' | 'split' | 'cancel') => void;
    private changeType: string;

    constructor(app: App, changeType: string, resolve: (value: 'update-all' | 'split' | 'cancel') => void) {
        super(app);
        this.changeType = changeType;
        this.resolve = resolve;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('tps-recurrence-update-modal');

        let titleText = 'Update Recurring Task?';
        let msgText = `You are editing a recurring task. How should this change apply?`;
        let option1Title = 'Edit Series (All Future)';
        let option1Desc = 'Changes apply to this and all future instances.';
        let option2Title = 'Edit Only This Instance';
        let option2Desc = 'This becomes a standalone task. A new recurring instance is generated for the schedule.';

        if (this.changeType === 'focus') {
            titleText = 'Recurring Task Detected';
            msgText = 'You have opened a recurring task. What would you like to do?';
            option1Title = 'View/Edit This Series';
            option1Desc = 'Enter the note to view or make changes to the existing series.';
            option2Title = 'Create Next Instance Now';
            option2Desc = 'Mark this instance as effectively complete/split and generate the next occurrence immediately.';
        }

        contentEl.createEl('h3', { text: titleText });

        const message = contentEl.createEl('p', { text: msgText });
        message.style.marginBottom = '16px';
        message.style.color = 'var(--text-muted)';

        const optionsContainer = contentEl.createEl('div');
        optionsContainer.style.display = 'flex';
        optionsContainer.style.flexDirection = 'column';
        optionsContainer.style.gap = '8px';

        this.createOption(optionsContainer,
            option1Title,
            option1Desc,
            () => this.resolveAndClose('update-all')
        );

        this.createOption(optionsContainer,
            option2Title,
            option2Desc,
            () => this.resolveAndClose('split')
        );

        const cancelBtn = contentEl.createEl('button', { text: 'Cancel' });
        cancelBtn.style.marginTop = '10px';
        cancelBtn.style.width = '100%';
        cancelBtn.addEventListener('click', () => this.resolveAndClose('cancel'));
    }

    createOption(container: HTMLElement, title: string, desc: string, onClick: () => void) {
        const el = container.createDiv('tps-recurrence-option');
        el.style.padding = '10px';
        el.style.border = '1px solid var(--background-modifier-border)';
        el.style.borderRadius = '6px';
        el.style.cursor = 'pointer';

        const t = el.createDiv();
        t.style.fontWeight = 'bold';
        t.textContent = title;

        const d = el.createDiv();
        d.style.fontSize = '0.9em';
        d.style.color = 'var(--text-muted)';
        d.textContent = desc;

        el.addEventListener('click', onClick);
        el.addEventListener('mouseenter', () => el.style.backgroundColor = 'var(--background-modifier-hover)');
        el.addEventListener('mouseleave', () => el.style.backgroundColor = 'transparent');

        container.appendChild(el);
    }

    resolveAndClose(val: 'update-all' | 'split' | 'cancel') {
        this.resolve(val);
        this.close();
    }

    onClose() {
        this.contentEl.empty();
    }
}
