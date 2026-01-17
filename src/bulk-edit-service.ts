import { TFile, Notice } from 'obsidian';
import TPSGlobalContextMenuPlugin from './main';
import { RRule, RRuleSet, rrulestr } from 'rrule';
import { ChecklistPromptModal } from './checklist-prompt-modal';
import * as logger from "./logger";

export class BulkEditService {
    plugin: TPSGlobalContextMenuPlugin;

    constructor(plugin: TPSGlobalContextMenuPlugin) {
        this.plugin = plugin;
    }

    async applyToFiles(files: TFile[], callback: (fm: any, file: TFile) => void): Promise<number> {
        let count = 0;
        for (const file of files) {
            try {
                if (file.extension?.toLowerCase() !== 'md') continue;
                this.plugin.recurrenceService?.markFileAsModified(file.path);
                await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
                    callback(fm, file);
                });
                count++;
            } catch (e) {
                logger.error(`[TPS GCM] Failed to update ${file.path}:`, e);
            }
        }

        // Delay menu refresh slightly to ensure metadata cache has updated
        // This fixes stale data appearing in inline tag menus after edits
        setTimeout(() => {
            for (const file of files) {
                this.plugin.persistentMenuManager?.refreshMenusForFile(file);
            }
        }, 100);

        return count;
    }

    async updateFrontmatter(files: TFile[], updates: Record<string, any>): Promise<number> {
        // Check if any files have recurrence rules (if prompting is enabled)
        if (this.plugin.settings.enableRecurrence && this.plugin.settings.promptOnRecurrenceEdit) {
            for (const file of files) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;

                if (fm && (fm.recurrenceRule || fm.recurrence)) {
                    // Skip if status is complete/wont-do (will be handled by setStatus)
                    if (fm.status === 'complete' || fm.status === 'wont-do') continue;

                    // Determine change description
                    const changeKeys = Object.keys(updates);

                    // Skip recurrence prompt if we are changing status (User Exception)
                    // Status changes logic handles state transitions/recurrence creation elsewhere
                    if (changeKeys.includes('status')) continue;

                    let changeDesc = 'updating';
                    if (changeKeys.includes('scheduled')) changeDesc = 'changing the scheduled time of';
                    else if (changeKeys.includes('priority')) changeDesc = 'changing the priority of';
                    else if (changeKeys.some(k => k.includes('tag'))) changeDesc = 'modifying tags on';

                    // Prompt user
                    const result = await this.plugin.recurrenceService.promptForFrontmatterChange(file, changeDesc);

                    if (result === 'cancel') {
                        return 0; // Cancel the operation
                    }
                    // If 'update-all', continue with the update
                    // If 'split', the handler already created next instance and stripped rule
                }
            }
        }

        return this.applyToFiles(files, (fm) => {
            for (const key in updates) {
                if (updates[key] === null || updates[key] === undefined) {
                    delete fm[key];
                } else {
                    fm[key] = updates[key];
                }
            }
        });
    }

    async setStatus(files: TFile[], status: string): Promise<number> {
        // Check for recurrence statuses
        const recurrenceStatuses = this.plugin.settings.recurrenceCompletionStatuses?.length
            ? this.plugin.settings.recurrenceCompletionStatuses
            : ['complete', 'wont-do'];

        // Checklist Prompt Logic (Single file only to avoid spam)
        if (
            this.plugin.settings.checkOpenChecklistItems &&
            status === 'complete' &&
            files.length === 1
        ) {
            const file = files[0];
            const incompleteItems = await this.scanChecklistItems(file);

            if (incompleteItems.length > 0) {
                // Must wrap in a promise to await the modal result
                const userAction = await new Promise<string>((resolve) => {
                    new ChecklistPromptModal(this.plugin.app, incompleteItems, (result) => {
                        resolve(result);
                    }).open();
                });

                if (userAction === 'cancel') {
                    return 0; // Abort status change
                }

                if (userAction === 'open') {
                    // Open the file and abort status change
                    const leaf = this.plugin.app.workspace.getLeaf(false);
                    if (leaf) {
                        await leaf.openFile(file);
                    }
                    return 0;
                }

                if (userAction === 'complete') {
                    await this.updateChecklistItems(file, 'complete');
                    // Continue to set status
                } else if (userAction === 'progress') {
                    await this.updateChecklistItems(file, 'progress');
                    // Continue to set status
                }
                // 'ignore' falls through to set status
            }
        }

        if (this.plugin.settings.enableRecurrence && recurrenceStatuses.includes(status)) {
            for (const file of files) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;

                if (fm && (fm.recurrenceRule || fm.recurrence)) {
                    const previousStatus = fm.status || null;
                    // Create next instance before updating current file
                    const handled = await this.createNextRecurrenceInstance(file, fm, previousStatus);
                    // Ensure recurrence is cleared on the completed instance even if creation was skipped
                    if (!handled) {
                        await this.clearRecurrenceRule(file);
                    }
                }
            }
        }

        // Use updateFrontmatter to handle the actual write and any necessary prompting for non-complete statuses
        return this.updateFrontmatter(files, { status });
    }

    async setPriority(files: TFile[], priority: string): Promise<number> {
        return this.updateFrontmatter(files, { priority });
    }

    async addTag(files: TFile[], tag: string, key: string = 'tags'): Promise<number> {
        // Check for recurrence and prompt (if enabled)
        if (this.plugin.settings.enableRecurrence && this.plugin.settings.promptOnRecurrenceEdit) {
            for (const file of files) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;

                if (fm && (fm.recurrenceRule || fm.recurrence) && fm.status !== 'complete' && fm.status !== 'wont-do') {
                    const result = await this.plugin.recurrenceService.promptForFrontmatterChange(file, `adding tag "${tag}" to`);
                    if (result === 'cancel') {
                        return 0;
                    }
                    break; // Only prompt once for bulk operations
                }
            }
        }

        return this.applyToFiles(files, (fm) => {
            let tags = fm[key] || [];
            if (!Array.isArray(tags)) {
                tags = [tags].filter((t: any) => t);
            }
            if (!tags.includes(tag)) {
                tags.push(tag);
                fm[key] = tags;
            }
        });
    }

    async removeTag(files: TFile[], tag: string, key: string = 'tags'): Promise<number> {
        // Check for recurrence and prompt (if enabled)
        if (this.plugin.settings.enableRecurrence && this.plugin.settings.promptOnRecurrenceEdit) {
            for (const file of files) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;

                if (fm && (fm.recurrenceRule || fm.recurrence) && fm.status !== 'complete' && fm.status !== 'wont-do') {
                    const result = await this.plugin.recurrenceService.promptForFrontmatterChange(file, `removing tag "${tag}" from`);
                    if (result === 'cancel') {
                        return 0;
                    }
                    break; // Only prompt once for bulk operations
                }
            }
        }

        return this.applyToFiles(files, (fm) => {
            if (!fm[key]) return;
            let tags = Array.isArray(fm[key]) ? fm[key] : [fm[key]];
            fm[key] = tags.filter((t: any) => t !== tag);
        });
    }

    async setRecurrence(files: TFile[], rule: string | null): Promise<number> {
        const count = await this.applyToFiles(files, (fm) => {
            if (rule) {
                fm.recurrenceRule = rule;
                delete fm.recurrence;
            } else {
                delete fm.recurrenceRule;
                delete fm.recurrence;
            }
        });

        // If we just set a rule on a completed file, we should immediately generate the next instance
        // and clear the rule from this one (standard recurrence behavior)
        if (rule && this.plugin.settings.enableRecurrence) {
            const recurrenceStatuses = this.plugin.settings.recurrenceCompletionStatuses?.length
                ? this.plugin.settings.recurrenceCompletionStatuses
                : ['complete', 'wont-do'];

            for (const file of files) {
                // We need to re-read the cache/fm because applyToFiles just wrote it
                // Allow a tiny tick for cache update or just read file?
                // checkMissingRecurrences relies on cache. processFrontMatter writes to file.
                // We can just manually check the file's current frontmatter from cache (might be slightly stale)
                // or trust that we just set it.

                // Let's rely on checkMissingRecurrences logic but scoped to these files.
                // However, cache might not be updated yet from applyToFiles.
                // So we'll pass the 'rule' explicitly or wait.

                // Better strategy: triggering createNextRecurrenceInstance requires the file to have the rule.
                // We just wrote it.

                // Let's use a slight delay to ensure cache consistency, then check these specific files.
                setTimeout(async () => {
                    const cache = this.plugin.app.metadataCache.getFileCache(file);
                    const fm = cache?.frontmatter;
                    if (fm && recurrenceStatuses.includes(fm.status)) {
                        // It has the rule (we just set it) and it's completed.
                        // Create next instance.
                        await this.createNextRecurrenceInstance(file, fm);
                    }
                }, 200);
            }
        }

        return count;
    }

    async setScheduled(files: TFile[], date: string | null): Promise<number> {
        return this.applyToFiles(files, (fm) => {
            if (date) {
                fm.scheduled = date;
            } else {
                delete fm.scheduled;
            }
        });
    }

    async updateScheduledDetails(files: TFile[], scheduled: string | null, timeEstimate: number | null, allDay: boolean, key: string = 'scheduled'): Promise<number> {
        return this.applyToFiles(files, (fm) => {
            if (scheduled) {
                fm[key] = scheduled;
            } else {
                delete fm[key];
            }

            if (timeEstimate !== null && timeEstimate !== undefined && !isNaN(timeEstimate)) {
                fm.timeEstimate = timeEstimate;
            } else {
                delete fm.timeEstimate;
            }

            if (allDay) {
                fm.allDay = true;
            } else {
                delete fm.allDay;
            }
        });
    }

    showNotice(action: string, detail: string, suffix: string, count: number): void {
        const msg = `${detail} ${suffix} on ${count} file${count !== 1 ? 's' : ''}`;
        new Notice(msg);
    }

    /**
     * Calculate the next occurrence date based on a recurrence rule
     */
    getNextOccurrence(recurrenceRule: string, currentDate?: string): Date | null {
        try {
            // Get the starting date (either from scheduled date or now)
            const startDate = currentDate
                ? new Date(currentDate)
                : new Date();

            // Parse options and force dtstart to be the current event's date
            // This ensures relative calculations (e.g. "Monthly") match the event's anchor
            const options = RRule.parseString(recurrenceRule);
            options.dtstart = startDate;

            const rule = new RRule(options);

            // Get the next occurrence strictly after the start date
            // We use 'after' with inc=false (default) to get the next one
            const nextDate = rule.after(startDate, false);

            return nextDate;
        } catch (error) {
            logger.error('[TPS GCM] Failed to calculate next recurrence:', error);
            return null;
        }
    }

    /**
     * Create the next instance of a recurring task
     * Preserves original frontmatter formatting (property order, multi-line arrays)
     */
    async createNextRecurrenceInstance(file: TFile, frontmatter: any, carryStatus?: string | null): Promise<boolean> {
        try {
            const recurrenceRule = frontmatter.recurrenceRule || frontmatter.recurrence;
            if (!recurrenceRule) return false;

            // Calculate next occurrence date
            const currentScheduled = frontmatter.scheduled;
            const nextDate = this.getNextOccurrence(recurrenceRule, currentScheduled);

            if (!nextDate) {
                logger.warn('[TPS GCM] Could not calculate next recurrence date');
                // Clear the rule so we do not repeatedly attempt on every status change
                await this.clearRecurrenceRule(file);
                return true;
            }

            // Generate new filename with date
            const baseName = file.basename.replace(/ \d{4}-\d{2}-\d{2}$/, ''); // Remove existing date suffix if any
            const dateStr = window.moment(nextDate).format('YYYY-MM-DD');
            const newFileName = `${baseName} ${dateStr}.md`;
            const newFilePath = file.parent ? `${file.parent.path}/${newFileName}` : newFileName;

            // If the target file already exists, avoid duplicating and just clear the rule on the current file
            if (await this.plugin.app.vault.adapter.exists(newFilePath)) {
                logger.warn('[TPS GCM] Next recurrence already exists, skipping creation:', newFilePath);
                await this.clearRecurrenceRule(file);
                return true;
            }

            // Read the current file content (preserves original formatting)
            const content = await this.plugin.app.vault.read(file);

            // Create the new file with original content (preserves frontmatter formatting)
            await this.plugin.app.vault.create(newFilePath, content);

            // Get the newly created file
            const newFile = this.plugin.app.vault.getAbstractFileByPath(newFilePath);
            if (!(newFile instanceof TFile)) {
                logger.error('[TPS GCM] Could not get newly created file');
                return false;
            }

            // Use processFrontMatter to update ONLY the changed fields
            // This preserves property order and array formatting
            const newScheduled = window.moment(nextDate).format('YYYY-MM-DDTHH:mm:ss');
            // Use the configured default status for new recurrence instances
            const newStatus = this.plugin.settings.recurrenceDefaultStatus || 'open';

            await this.plugin.app.fileManager.processFrontMatter(newFile, (fm) => {
                fm.scheduled = newScheduled;
                fm.title = baseName;
                fm.status = newStatus;
            });

            // Remove recurrence rule from the original (now completed) file
            await this.clearRecurrenceRule(file);

            new Notice(`Created next recurrence: ${newFileName}`);
            return true;
        } catch (error) {
            logger.error('[TPS GCM] Failed to create next recurrence instance:', error);
            new Notice('Failed to create next recurrence instance');
            return false;
        }
    }

    /**
     * Scans the vault for completed files with recurrence rules where the next instance has not been created.
     */
    async checkMissingRecurrences(): Promise<void> {
        if (!this.plugin.settings.enableRecurrence) return;


        // We rely on the caller (main.ts onLayoutReady) to ensure basic readiness,
        // but waiting for 'resolved' event ensures we have the latest cache.
        if (this.plugin.app.metadataCache.on) {
            // Optional: we could listen for 'resolved' here if we wanted to be super sure,
            // but actually just proceeding is often fine if invoked after layout ready.
        }


        const files = this.plugin.app.vault.getMarkdownFiles();
        let createdCount = 0;

        const recurrenceStatuses = this.plugin.settings.recurrenceCompletionStatuses?.length
            ? this.plugin.settings.recurrenceCompletionStatuses
            : ['complete', 'wont-do'];

        for (const file of files) {
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;

            if (!fm) continue;

            // Check if file has recurrence rule and is completed
            const hasRule = fm.recurrenceRule || fm.recurrence;
            const isCompleted = recurrenceStatuses.includes(fm.status);

            if (hasRule && isCompleted) {
                // If the user manually cleared the rrule, we wouldn't be here (hasRule would be false).
                // So if we are here, we have a completed task with an active rule.

                // We utilize createNextRecurrenceInstance which has logic to:
                // 1. Calculate next date
                // 2. Check if file exists (and skip if so)
                // 3. Clear the rule from THIS file if next instance exists or is created

                // This effectively "heals" the state:
                // - If next instance missing -> create it, clear old rule.
                // - If next instance exists -> clear old rule.
                const handled = await this.createNextRecurrenceInstance(file, fm);

                if (handled) {
                    createdCount++;
                }
            }
        }

        if (createdCount > 0) {
            logger.log(`[TPS GCM] Healed ${createdCount} recurring event chains.`);
        }
    }

    /**
     * Remove recurrence fields from a file
     */
    async clearRecurrenceRule(file: TFile): Promise<void> {
        await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
            delete fm.recurrenceRule;
            delete fm.recurrence;
        });
    }

    /**
     * Convert frontmatter object to YAML string
     */
    stringifyFrontmatter(fm: any): string {
        const lines: string[] = [];

        for (const key in fm) {
            const value = fm[key];

            if (value === null || value === undefined) {
                continue;
            }

            if (Array.isArray(value)) {
                lines.push(`${key}:`);
                value.forEach((item: any) => {
                    lines.push(`  - ${item}`);
                });
            } else if (typeof value === 'object') {
                // Skip complex objects for now
                continue;
            } else if (typeof value === 'string') {
                // Escape strings with special characters
                if (value.includes(':') || value.includes('#') || value.includes('\n')) {
                    lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
                } else {
                    lines.push(`${key}: ${value}`);
                }
            } else {
                lines.push(`${key}: ${value}`);
            }
        }

        return lines.join('\n') + '\n';
    }

    /**
     * Scan a file for incomplete checklist items
     */
    async scanChecklistItems(file: TFile): Promise<string[]> {
        const content = await this.plugin.app.vault.read(file);
        const lines = content.split('\n');
        const incompleteItems: string[] = [];

        // Regex for incomplete items: - [ ] ... (ignoring [x], [-], etc.)
        // We match strict "- [ ]"
        const regex = /^\s*-\s*\[ \]\s+(.*)$/;

        for (const line of lines) {
            const match = line.match(regex);
            if (match) {
                incompleteItems.push(match[1].trim());
            }
        }
        return incompleteItems;
    }

    /**
     * Update checklist items in a file based on action
     */
    async updateChecklistItems(file: TFile, action: 'complete' | 'progress'): Promise<void> {
        let content = await this.plugin.app.vault.read(file);

        if (action === 'complete') {
            // Replace "- [ ]" with "- [x]"
            // Use regex with global flag
            content = content.replace(/^(\s*-\s*)\[ \]/gm, '$1[x]');
        } else if (action === 'progress') {
            // Replace "- [ ]" with "- [?]"
            content = content.replace(/^(\s*-\s*)\[ \]/gm, '$1[?]');
        }

        await this.plugin.app.vault.modify(file, content);
    }
}
