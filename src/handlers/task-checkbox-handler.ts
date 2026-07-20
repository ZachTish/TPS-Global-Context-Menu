import { App, MarkdownView, Menu, Notice, TFile } from 'obsidian';
import * as logger from '../logger';
import type TPSGlobalContextMenuPlugin from '../main';
import { StatusChoiceModal } from '../modals/status-choice-modal';
import type { TaskLineContext } from '../services/task-line-context-menu-service';
import { getCheckboxStateMarker, normalizeCheckboxStateToken } from '../utils/checkbox-state';
import { findCurrentTaskLineIndex } from '../utils/task-block-move';
import {
    getTaskDisplayTitle,
    parseTaskLine,
    setTaskCheckboxToken,
    updateTaskCompletedDateForCheckboxState,
    updateTaskLineTimestamps,
} from '../utils/task-line-metadata';
import {
    getLinkedSubitemCompleteMarkers,
    normalizeLinkedSubitemMappings,
} from '../utils/linked-subitem-mapping';

type TaskCheckboxContext = {
    file: TFile;
    lineNumber: number;
    rawLine: string;
    currentToken: string;
};

/**
 * Handles note-level checklist follow-up behavior.
 *
 * Direct checkbox/line context menus were intentionally removed from GCM. The
 * remaining responsibilities are note-scoped: optional open-checklist
 * property sync and the final note status prompt after external checklist edits.
 */
export class TaskCheckboxHandler {
    private app: App;
    private pendingPropertyUpdateTimers: Map<string, number> = new Map();
    private recentPropertyWriteUntilByPath: Map<string, number> = new Map();
    private fullVaultSyncToken = 0;
    private checkboxLongPressTimer: number | null = null;

    constructor(private plugin: TPSGlobalContextMenuPlugin) {
        this.app = plugin.app;
    }

    dispose(): void {
        for (const timerId of this.pendingPropertyUpdateTimers.values()) {
            window.clearTimeout(timerId);
        }
        this.pendingPropertyUpdateTimers.clear();
        this.recentPropertyWriteUntilByPath.clear();
        this.fullVaultSyncToken += 1;
        this.clearCheckboxLongPressTimer();
    }

    handleContextMenu(evt: MouseEvent): boolean {
        const targetEl = evt.target instanceof HTMLElement ? evt.target : null;
        const context = this.resolveTaskCheckboxContext(targetEl);
        if (!context) return false;

        evt.preventDefault();
        evt.stopPropagation();
        evt.stopImmediatePropagation();

        this.showTaskStateMenu(context, evt.clientX, evt.clientY);
        return true;
    }

    handleTouchStart(evt: TouchEvent): boolean {
        const targetEl = evt.target instanceof HTMLElement ? evt.target : null;
        const context = this.resolveTaskCheckboxContext(targetEl);
        if (!context) return false;

        this.clearCheckboxLongPressTimer();
        const touch = evt.touches[0];
        this.checkboxLongPressTimer = window.setTimeout(() => {
            this.checkboxLongPressTimer = null;
            this.showTaskStateMenu(context, touch?.clientX ?? 0, touch?.clientY ?? 0);
        }, 550);
        return true;
    }

    handleTouchCancel(): void {
        this.clearCheckboxLongPressTimer();
    }

    private clearCheckboxLongPressTimer(): void {
        if (this.checkboxLongPressTimer == null) return;
        window.clearTimeout(this.checkboxLongPressTimer);
        this.checkboxLongPressTimer = null;
    }

    private showTaskStateMenu(context: TaskCheckboxContext, x: number, y: number): void {
        const menu = new Menu();
        for (const mapping of this.getCheckboxMappings()) {
            const label = String(mapping.label || mapping.statuses[0] || mapping.checkboxState).trim();
            menu.addItem((item) => {
                item
                    .setTitle(`${mapping.checkboxState} ${label}`)
                    .setIcon(mapping.icon || 'square');
                if (mapping.checkboxState === context.currentToken) {
                    item.setChecked(true);
                }
                item.onClick(() => {
                    void this.setTaskCheckboxState(context, mapping.checkboxState);
                });
            });
        }
        menu.addSeparator();
        menu.addItem((item) => {
            item
                .setTitle('Custom checkbox value...')
                .setIcon('brackets')
                .onClick(() => {
                    const initial = getCheckboxStateMarker(context.currentToken);
                    const value = window.prompt('Checkbox value', initial);
                    if (value == null) return;
                    const token = normalizeCheckboxStateToken(value);
                    if (!token) {
                        new Notice('Use a single checkbox marker, for example ?, *, /, -, x, or blank.');
                        return;
                    }
                    void this.setTaskCheckboxState(context, token);
                });
        });
        const taskLineContext = this.toTaskLineContext(context);
        if (taskLineContext) {
            menu.addSeparator();
            this.plugin.taskLineContextMenuService.addTaskLineMenuItems(menu, taskLineContext, {
                includeTitle: true,
                includeStatus: false,
            });
        }
        menu.showAtPosition({ x, y });
    }

    private toTaskLineContext(context: TaskCheckboxContext): TaskLineContext | null {
        if (!parseTaskLine(context.rawLine)) return null;
        return {
            file: context.file,
            lineNumber: context.lineNumber + 1,
            lineIndex: context.lineNumber,
            rawLine: context.rawLine,
            title: getTaskDisplayTitle(context.rawLine),
            checkboxToken: context.currentToken,
            isCalendarTask: false,
            calendarAllDay: false,
        };
    }

    private async setTaskCheckboxState(context: TaskCheckboxContext, token: string): Promise<void> {
        const previousMarker = getCheckboxStateMarker(context.currentToken);
        const nextMarker = getCheckboxStateMarker(token);
        let updatedLines: string[] | null = null;
        let didWrite = false;
        let unresolvedWrite = false;

        await this.plugin.subitemRelationshipSyncService.mutateMarkdownBody(context.file, async (lines) => {
            const lineIndex = this.resolveCurrentTaskLineIndex(lines, context);
            if (lineIndex < 0) {
                unresolvedWrite = true;
                return false;
            }

            const currentLine = lines[lineIndex] || '';
            let updatedLine = this.withTaskCheckboxToken(currentLine, token);
            updatedLine = updateTaskCompletedDateForCheckboxState(updatedLine, nextMarker, {
                completeMarkers: this.getCompleteMarkers(),
            });
            updatedLine = updateTaskLineTimestamps(updatedLine, {
                enabled: this.plugin.settings.autoSyncFileTimestamps === true,
                modifiedKey: this.plugin.settings.dateModifiedFrontmatterKey,
                format: this.plugin.settings.fileTimestampFormat,
                markModified: true,
            });
            if (updatedLine === currentLine) return false;

            lines[lineIndex] = updatedLine;
            updatedLines = [...lines];
            didWrite = true;
            return true;
        });

        if (unresolvedWrite) {
            logger.flowWarn('TaskCheckboxMenu', 'write:unresolved-task', {
                path: context.file.path,
                renderedLineNumber: context.lineNumber + 1,
                nextCheckboxState: token,
            });
            new Notice('That task changed before its checkbox could be updated. Refresh and try again.');
            return;
        }
        if (!didWrite || !updatedLines) return;
        await this.handleExternalChecklistStateMutation(context.file, previousMarker, nextMarker, updatedLines);
        new Notice(`Set checkbox to ${token}.`);
    }

    private resolveCurrentTaskLineIndex(lines: string[], context: TaskCheckboxContext): number {
        const exactMatches = lines.reduce<number[]>((indexes, line, index) => {
            if (line === context.rawLine && parseTaskLine(line || '')) indexes.push(index);
            return indexes;
        }, []);
        if (exactMatches.length === 1 || exactMatches.includes(context.lineNumber)) {
            return findCurrentTaskLineIndex(lines, context.lineNumber, context.rawLine, '');
        }
        if (exactMatches.length > 1) return -1;

        const title = getTaskDisplayTitle(context.rawLine);
        const normalizedTitle = this.normalizeTaskText(title);
        if (!normalizedTitle) return -1;
        const titleMatches = lines.reduce<number[]>((indexes, line, index) => {
            if (
                parseTaskLine(line || '')
                && this.normalizeTaskText(getTaskDisplayTitle(line || '')) === normalizedTitle
            ) {
                indexes.push(index);
            }
            return indexes;
        }, []);
        if (titleMatches.length !== 1) return -1;

        const resolved = findCurrentTaskLineIndex(lines, context.lineNumber, context.rawLine, title);
        return resolved === titleMatches[0] ? resolved : -1;
    }

    private withTaskCheckboxToken(line: string, token: string): string {
        return setTaskCheckboxToken(line, token);
    }

    private getCheckboxMappings() {
        return normalizeLinkedSubitemMappings(this.plugin.settings.linkedSubitemCheckboxMappings || [], {
            enforceStrictDefaults: false,
        });
    }

    private getCompleteMarkers(): string[] {
        return getLinkedSubitemCompleteMarkers(this.getCheckboxMappings());
    }

    private resolveTaskCheckboxContext(targetEl: HTMLElement | null): TaskCheckboxContext | null {
        const checkboxEl = this.resolveTaskCheckboxElement(targetEl);
        if (!checkboxEl) return null;
        if (checkboxEl.closest('.tps-gcm-linked-subitem-task, .tps-gcm-linked-subitem-checkbox, .tps-gcm-checklist-toggle')) return null;

        const view = this.resolveMarkdownViewForElement(checkboxEl);
        if (!(view instanceof MarkdownView) || !(view.file instanceof TFile)) return null;

        return this.resolveTaskLineFromCodeMirror(view, checkboxEl)
            ?? this.resolveTaskLineFromRenderedHost(view, checkboxEl);
    }

    private resolveTaskCheckboxElement(targetEl: HTMLElement | null): HTMLElement | null {
        if (!targetEl) return null;
        const checkboxEl = targetEl.closest<HTMLElement>(
            'input.task-list-item-checkbox, .task-list-item-checkbox, input[type="checkbox"]',
        );
        if (!checkboxEl) return null;
        return checkboxEl;
    }

    private resolveMarkdownViewForElement(targetEl: HTMLElement): MarkdownView | null {
        for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (!(view instanceof MarkdownView)) continue;
            const containerEl = (view as any).containerEl as HTMLElement | undefined;
            const contentEl = view.contentEl as HTMLElement | undefined;
            const previewContainer = (view as any).previewMode?.containerEl as HTMLElement | undefined;
            if (containerEl?.contains(targetEl) || contentEl?.contains(targetEl) || previewContainer?.contains(targetEl)) {
                return view;
            }
        }
        return null;
    }

    private resolveTaskLineFromCodeMirror(view: MarkdownView, targetEl: HTMLElement): TaskCheckboxContext | null {
        const cmLine = targetEl.closest('.cm-line') as HTMLElement | null;
        if (!cmLine) return null;
        const cm = (view.editor as any)?.cm;
        if (!cm?.posAtDOM || !cm?.state?.doc) return null;
        try {
            const pos = cm.posAtDOM(cmLine, 0);
            const line = cm.state.doc.lineAt(pos);
            const rawLine = String(line.text || '');
            const parsed = parseTaskLine(rawLine);
            if (!parsed) return null;
            return {
                file: view.file as TFile,
                lineNumber: line.number - 1,
                rawLine,
                currentToken: parsed.token,
            };
        } catch (_error) {
            return null;
        }
    }

    private resolveTaskLineFromRenderedHost(view: MarkdownView, targetEl: HTMLElement): TaskCheckboxContext | null {
        const host = targetEl.closest('li.task-list-item, li') as HTMLElement | null;
        if (!host) return null;
        const source = this.getViewSource(view);
        const lines = source.split('\n');

        const renderedLine = host.getAttribute('data-line');
        const dataLine = renderedLine == null || renderedLine.trim() === '' ? Number.NaN : Number(renderedLine);
        if (Number.isFinite(dataLine) && dataLine >= 0 && dataLine < lines.length) {
            const rawLine = lines[dataLine] || '';
            const parsed = parseTaskLine(rawLine);
            if (parsed) {
                return {
                    file: view.file as TFile,
                    lineNumber: dataLine,
                    rawLine,
                    currentToken: parsed.token,
                };
            }
        }

        const hostText = this.normalizeTaskText(host.innerText || host.textContent || '');
        if (!hostText) return null;
        const matches: TaskCheckboxContext[] = [];
        for (let index = 0; index < lines.length; index += 1) {
            const rawLine = lines[index] || '';
            const parsed = parseTaskLine(rawLine);
            if (!parsed) continue;
            const lineText = this.normalizeTaskText(getTaskDisplayTitle(rawLine) || rawLine);
            if (lineText && (hostText.includes(lineText) || lineText.includes(hostText))) {
                matches.push({
                    file: view.file as TFile,
                    lineNumber: index,
                    rawLine,
                    currentToken: parsed.token,
                });
            }
        }
        return matches.length === 1 ? matches[0] : null;
    }

    private getViewSource(view: MarkdownView): string {
        const editor = view.editor as any;
        if (typeof editor?.getValue === 'function') return String(editor.getValue() || '');
        return String((view as any)?.data || '');
    }

    private normalizeTaskText(value: string): string {
        const parsed = parseTaskLine(value);
        return String(parsed?.body ?? (value || ''))
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    async handleExternalChecklistStateMutation(
        file: TFile,
        previousState: string | null,
        nextState: string | null,
        updatedLines: string[],
    ): Promise<void> {
        await this.plugin.taskRecurrenceService?.handleTaskCompletion({
            file,
            previousState,
            nextState,
            updatedLines,
        });
        await this.maybePromptToCompleteNote(file, previousState, nextState, updatedLines);
        this.scheduleChecklistPropertyUpdate(file);
    }

    private async maybePromptToCompleteNote(
        file: TFile,
        previousState: string | null,
        nextState: string | null,
        updatedLines: string[],
    ): Promise<void> {
        if (previousState !== ' ') return;
        if (nextState === ' ') return;
        if (this.hasOpenChecklistItems(updatedLines)) return;
        const cache = this.app.metadataCache.getFileCache(file);
        const status = String(cache?.frontmatter?.status ?? '').trim().toLowerCase();
        if (!status || status === 'complete' || status === 'wont-do') return;
        const statusChoices = this.getChecklistFinalPromptStatuses();
        if (statusChoices.length === 0) return;
        const chosenStatus = await this.promptForFinalChecklistStatus(statusChoices);
        if (!chosenStatus) return;
        try {
            await this.plugin.bulkEditService.setStatus([file], chosenStatus);
        } catch (error) {
            logger.warn('[TPS GCM] Failed auto-completing note after last checkbox completion', { file: file.path, error });
        }
    }

    private hasOpenChecklistItems(lines: string[]): boolean {
        return lines.some((line) => /^\s*(?:[-*+]|\d+\.)\s*\[ \]/.test(line));
    }

    private getChecklistFinalPromptStatuses(): string[] {
        const configured = Array.isArray(this.plugin.settings.checklistFinalPromptStatuses)
            ? this.plugin.settings.checklistFinalPromptStatuses
            : [];
        const normalized = configured
            .map((value) => String(value || '').trim())
            .filter(Boolean);
        if (normalized.length > 0) return normalized;
        return ['complete', 'wont-do'];
    }

    private async promptForFinalChecklistStatus(statuses: string[]): Promise<string | null> {
        return await new Promise<string | null>((resolve) => {
            new StatusChoiceModal(this.app, statuses, (status) => resolve(status)).open();
        });
    }

    scheduleChecklistPropertyUpdate(file: TFile): void {
        if (!this.plugin.canRunBackgroundAutomation()) {
            this.clearPendingChecklistPropertyUpdate(file.path);
            return;
        }
        if (!this.isChecklistCompletionPropertyEnabled()) {
            this.clearPendingChecklistPropertyUpdate(file.path);
            return;
        }
        if (this.isRecentChecklistPropertySelfWrite(file.path)) return;
        const key = file.path;
        const existing = this.pendingPropertyUpdateTimers.get(key);
        if (typeof existing === 'number') window.clearTimeout(existing);
        const timerId = window.setTimeout(() => {
            this.pendingPropertyUpdateTimers.delete(key);
            void this.runChecklistPropertyUpdate(key);
        }, 300);
        this.pendingPropertyUpdateTimers.set(key, timerId);
    }

    private async runChecklistPropertyUpdate(filePath: string): Promise<void> {
        if (!this.isChecklistCompletionPropertyEnabled()) {
            this.clearPendingChecklistPropertyUpdate(filePath);
            return;
        }
        const af = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (!(af instanceof TFile) || af.extension !== 'md') return;
        await this.updateChecklistPropertyForFile(af, filePath);
    }

    async synchronizeChecklistPropertyForAllMarkdownFiles(): Promise<void> {
        if (!this.plugin.canRunBackgroundAutomation()) return;
        if (!this.isChecklistCompletionPropertyEnabled()) return;
        const syncToken = ++this.fullVaultSyncToken;
        const files = this.plugin.app.vault.getMarkdownFiles();
        for (let index = 0; index < files.length; index += 1) {
            if (syncToken !== this.fullVaultSyncToken) return;
            if (!this.isChecklistCompletionPropertyEnabled()) return;
            await this.updateChecklistPropertyForFile(files[index], files[index].path);
            if ((index + 1) % 25 === 0) {
                await new Promise((resolve) => window.setTimeout(resolve, 25));
            }
        }
    }

    private async updateChecklistPropertyForFile(file: TFile, filePath = file.path): Promise<void> {
        const propKey = this.plugin.settings.checklistCompletionPropertyKey?.trim();
        if (!propKey) return;

        let content: string;
        try {
            content = await this.plugin.app.vault.cachedRead(file);
        } catch (error) {
            logger.warn('[TPS GCM] Failed to read file for checklist property update', { filePath, error });
            return;
        }

        let hasOpenChecklistItem = false;
        for (const line of content.split('\n')) {
            if (/^\s*(?:[-*+]|\d+\.)\s*\[ \]/.test(line)) {
                hasOpenChecklistItem = true;
                break;
            }
        }

        const cache = this.plugin.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.[propKey] === hasOpenChecklistItem) return;
        if (!(await this.plugin.bulkEditService.canMutateFrontmatterSafely(file))) {
            logger.warn('[TPS GCM] Skipping checklist property update due to malformed frontmatter', { filePath });
            return;
        }

        try {
            await this.plugin.bulkEditService.runSerializedFrontmatterWrite(file, async () => {
                await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
                    fm[propKey] = hasOpenChecklistItem;
                });
            });
            this.rememberChecklistPropertySelfWrite(file.path);
        } catch (error) {
            logger.warn('[TPS GCM] Failed to write checklist open-item property', { filePath, error });
        }
    }

    cancelChecklistPropertyUpdates(): void {
        for (const timerId of this.pendingPropertyUpdateTimers.values()) {
            window.clearTimeout(timerId);
        }
        this.pendingPropertyUpdateTimers.clear();
        this.fullVaultSyncToken += 1;
    }

    private clearPendingChecklistPropertyUpdate(filePath: string): void {
        const existing = this.pendingPropertyUpdateTimers.get(filePath);
        if (typeof existing === 'number') window.clearTimeout(existing);
        this.pendingPropertyUpdateTimers.delete(filePath);
    }

    private isChecklistCompletionPropertyEnabled(): boolean {
        return this.plugin.settings.enableChecklistCompletionProperty === true;
    }

    private rememberChecklistPropertySelfWrite(filePath: string): void {
        this.recentPropertyWriteUntilByPath.set(filePath, Date.now() + 3000);
    }

    private isRecentChecklistPropertySelfWrite(filePath: string): boolean {
        const until = this.recentPropertyWriteUntilByPath.get(filePath) || 0;
        if (until <= Date.now()) {
            this.recentPropertyWriteUntilByPath.delete(filePath);
            return false;
        }
        return true;
    }
}
