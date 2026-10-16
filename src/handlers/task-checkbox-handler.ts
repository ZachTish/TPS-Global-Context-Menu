import { App, MarkdownView, Menu, Notice, TFile } from 'obsidian';
import * as logger from '../logger';
import type TPSGlobalContextMenuPlugin from '../main';
import { TextInputModal } from '../modals/text-input-modal';
import { getNativeCheckboxMarker, normalizeCheckboxMenuStates, normalizeNativeCheckboxToken, replaceNativeCheckboxMarker, resolveNativeCheckboxLine } from '../utils/native-checkbox-marker';
import type { TaskLineContext } from '../services/task-line-context-menu-service';
import { getCheckboxStateMarker, normalizeCheckboxStateToken } from '../utils/checkbox-state';
import { findCurrentTaskLineIndex } from '../utils/task-block-move';
import {
    getTaskDisplayTitle,
    parseTaskLine,
    updateTaskCompletedDateForCheckboxState,
    updateTaskLineTimestamps,
} from '../utils/task-line-metadata';
import {
    getTaskCheckboxWorkflowMutationSignature,
    isTaskCheckboxWorkflowTokenCurrent,
    setTaskCheckboxWorkflowState,
    type TaskCheckboxWorkflowFieldOwnership,
} from '../utils/task-checkbox-workflow-mutation';
import {
    getLinkedSubitemMappingForState,
    getLinkedSubitemCompleteMarkers,
    normalizeLinkedSubitemMappings,
} from '../utils/linked-subitem-mapping';
import {
    abortDirectTaskHistory,
    beginDirectTaskHistory,
    commitDirectTaskHistory,
    ensureDirectTaskHistoryIdentity,
    type DirectTaskHistoryLocation,
    type DirectTaskHistoryLogContext,
} from '../utils/direct-task-history';

type TaskCheckboxContext = {
    file: TFile;
    lineNumber: number;
    rawLine: string;
    currentToken: string;
};

type NativeCheckboxContext = TaskCheckboxContext & { view: MarkdownView; checkboxEl: HTMLElement };

/**
 * Handles note-level checklist follow-up behavior.
 *
 * Whole-note mode exposes only a native Markdown marker menu. Retired line
 * metadata, status synchronization and recurrence remain behind their gates.
 */
export class TaskCheckboxHandler {
    private app: App;
    private checkboxLongPressTimer: number | null = null;
    private suppressedCheckbox: HTMLElement | null = null;
    private suppressedCheckboxUntil = 0;
    private disposed = false;

    constructor(private plugin: TPSGlobalContextMenuPlugin) {
        this.app = plugin.app;
    }

    dispose(): void {
        this.disposed = true;
        this.suppressedCheckbox = null;
        this.clearCheckboxLongPressTimer();
    }

    handleContextMenu(evt: MouseEvent): boolean {
        if (this.disposed) return false;
        if (this.plugin.settings.dataArchitectureMode === 'native-records') {
            const target = evt.target instanceof HTMLElement ? evt.target : null;
            if (this.isSuppressedCheckbox(target)) {
                this.consumeCheckboxEvent(evt);
                return true;
            }
            const context = this.resolveNativeCheckboxContext(target);
            if (!context) return false;
            if (this.checkboxLongPressTimer !== null) {
                this.suppressedCheckbox = context.checkboxEl;
                this.suppressedCheckboxUntil = Number.POSITIVE_INFINITY;
            }
            this.clearCheckboxLongPressTimer();
            this.consumeCheckboxEvent(evt);
            this.showNativeCheckboxMenu(context, evt.clientX, evt.clientY);
            return true;
        }
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
        if (this.disposed) return false;
        if (this.plugin.settings.dataArchitectureMode === 'native-records') {
            this.clearCheckboxLongPressTimer();
            if (evt.touches.length !== 1) return false;
            this.suppressedCheckbox = null;
            const context = this.resolveNativeCheckboxContext(evt.target instanceof HTMLElement ? evt.target : null);
            if (!context) return false;
            const { clientX, clientY } = evt.touches[0];
            this.checkboxLongPressTimer = window.setTimeout(() => {
                this.checkboxLongPressTimer = null;
                if (this.disposed || !context.checkboxEl.isConnected) return;
                const liveContext = this.resolveNativeCheckboxContext(context.checkboxEl);
                if (!liveContext || liveContext.file !== context.file || liveContext.lineNumber !== context.lineNumber
                    || liveContext.rawLine !== context.rawLine) return;
                this.suppressedCheckbox = context.checkboxEl;
                this.suppressedCheckboxUntil = Number.POSITIVE_INFINITY;
                this.showNativeCheckboxMenu(liveContext, clientX, clientY);
            }, 550);
            return true;
        }
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

    handleTouchCancel(evt?: TouchEvent): void {
        this.clearCheckboxLongPressTimer();
        if ((!evt || evt.touches.length === 0) && this.suppressedCheckbox && this.suppressedCheckboxUntil === Number.POSITIVE_INFINITY) {
            this.suppressedCheckboxUntil = Date.now() + 1500;
        }
    }

    /** Leave ordinary clicks to Obsidian; consume only the click following our long press. */
    handleClick(evt: MouseEvent): boolean {
        const target = evt.target instanceof HTMLElement ? evt.target : null;
        if (!this.isSuppressedCheckbox(target)) return false;
        this.suppressedCheckbox = null;
        this.consumeCheckboxEvent(evt);
        return true;
    }

    private isSuppressedCheckbox(target: HTMLElement | null): boolean {
        if (Date.now() > this.suppressedCheckboxUntil) this.suppressedCheckbox = null;
        return !!target && !!this.suppressedCheckbox
            && (target === this.suppressedCheckbox || this.suppressedCheckbox.contains(target));
    }

    private consumeCheckboxEvent(evt: MouseEvent): void {
        evt.preventDefault();
        evt.stopPropagation();
        evt.stopImmediatePropagation();
    }

    private resolveNativeCheckboxContext(target: HTMLElement | null): NativeCheckboxContext | null {
        const checkboxEl = target?.closest<HTMLElement>('.task-list-item-checkbox');
        if (!checkboxEl || checkboxEl.closest('.markdown-embed, .internal-embed, .cm-embed-block, .canvas-node-content, .tps-gcm-linked-subitem-task, .tps-gcm-linked-subitem-checkbox, .tps-gcm-checklist-toggle')) return null;
        const view = this.resolveMarkdownViewForElement(checkboxEl);
        if (!view || !(view.file instanceof TFile)) return null;
        let lineNumber: number;
        let source: string;
        if (view.getMode() === 'source') {
            const cmLine = checkboxEl.closest('.cm-line');
            const cm = (view.editor as any)?.cm;
            if (!cmLine || !cm?.posAtDOM || !cm?.state?.doc) return null;
            try {
                lineNumber = cm.state.doc.lineAt(cm.posAtDOM(cmLine, 0)).number - 1;
                source = view.editor.getValue();
            } catch { return null; }
        } else {
            // Use the same section-relative source position as Obsidian's own
            // Reading View checkbox click. Do not fuzzy-match rendered titles.
            const relativeLine = checkboxEl.getAttribute('data-line');
            if (relativeLine == null || !/^\d+$/u.test(relativeLine)) return null;
            const section = (view.previewMode as any)?.renderer?.getSectionInfo?.(checkboxEl);
            if (!section || !Number.isInteger(section.lineStart) || typeof section.text !== 'string') return null;
            lineNumber = section.lineStart + Number(relativeLine);
            source = section.text;
        }
        const line = resolveNativeCheckboxLine(source, lineNumber);
        const marker = line && getNativeCheckboxMarker(line.text);
        return line && marker ? { view, checkboxEl, file: view.file, lineNumber, rawLine: line.text, currentToken: marker.token } : null;
    }

    private showNativeCheckboxMenu(context: NativeCheckboxContext, x: number, y: number): void {
        const menu = new Menu();
        for (const token of normalizeCheckboxMenuStates(this.plugin.settings.checkboxMenuStates)) {
            menu.addItem(item => item.setTitle(token).setChecked(token === context.currentToken)
                .onClick(() => { void this.setNativeCheckboxMarker(context, token); }));
        }
        menu.addSeparator();
        menu.addItem(item => item.setTitle('Custom checkbox value…').setIcon('brackets').onClick(() => {
            if (this.disposed) return;
            new TextInputModal(this.app, 'Checkbox value', context.currentToken, async value => {
                const token = normalizeNativeCheckboxToken(value);
                if (!token) { new Notice('Use one checkbox character, such as /, ?, !, x, or blank.'); return; }
                await this.setNativeCheckboxMarker(context, token);
            }, { selectOnOpen: true }).open();
        }));
        menu.showAtPosition({ x, y });
    }

    private async setNativeCheckboxMarker(context: NativeCheckboxContext, token: string): Promise<void> {
        const nextToken = normalizeNativeCheckboxToken(token);
        if (this.disposed || !nextToken || nextToken === context.currentToken) return;
        if (context.view.file !== context.file || this.app.vault.getAbstractFileByPath(context.file.path) !== context.file) return;
        let result: 'changed' | 'stale' | 'unchanged' = 'stale';
        try {
            // Preserve unsaved changes and native undo whenever an editor owns
            // this note, including another open leaf of the same file.
            const editorViews = this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view)
                .filter(view => view instanceof MarkdownView && view.file === context.file && view.getMode() === 'source') as MarkdownView[];
            const editorView = editorViews.find(view => view === context.view) ?? editorViews[0];
            if (editorView) {
                const line = resolveNativeCheckboxLine(editorView.editor.getValue(), context.lineNumber, context.rawLine);
                if (line) {
                    const marker = getNativeCheckboxMarker(line.text)!;
                    editorView.editor.replaceRange(nextToken[1], { line: line.index, ch: marker.markerOffset }, { line: line.index, ch: marker.markerOffset + 1 });
                    result = 'changed';
                }
            } else {
                // A read-only preflight rejects stale/no-op selections before
                // entering the serialized queue. Fresh source is checked again
                // at Obsidian's existing atomic process boundary.
                const cached = await this.app.vault.cachedRead(context.file);
                if (this.disposed || context.view.file !== context.file
                    || this.app.vault.getAbstractFileByPath(context.file.path) !== context.file) return;
                const preflight = replaceNativeCheckboxMarker(cached, context.lineNumber, context.rawLine, nextToken);
                if (preflight !== null && preflight !== cached) {
                    const processPath = context.file.path;
                    await this.app.vault.process(context.file, source => {
                        if (this.disposed || context.view.file !== context.file || context.file.path !== processPath
                            || this.app.vault.getAbstractFileByPath(processPath) !== context.file) return source;
                        const updated = replaceNativeCheckboxMarker(source, context.lineNumber, context.rawLine, nextToken);
                        result = updated === null ? 'stale' : updated === source ? 'unchanged' : 'changed';
                        return updated ?? source;
                    });
                } else if (preflight === cached) result = 'unchanged';
            }
            logger.flow('MarkdownCheckboxMenu', 'marker:update', { path: context.file.path, line: context.lineNumber + 1, marker: nextToken, result });
            if (result === 'stale') new Notice('That checkbox changed. Reopen its menu and try again.');
        } catch (error) {
            logger.flowError('MarkdownCheckboxMenu', 'marker:failed', error, { path: context.file.path });
            new Notice('Could not change that checkbox.');
        }
    }

    private clearCheckboxLongPressTimer(): void {
        if (this.checkboxLongPressTimer == null) return;
        window.clearTimeout(this.checkboxLongPressTimer);
        this.checkboxLongPressTimer = null;
    }

    private showTaskStateMenu(context: TaskCheckboxContext, x: number, y: number): void {
        const menu = new Menu();
        const mappings = this.getCheckboxMappings();
        const expectedMappingSignature = this.getCheckboxMutationSignature(mappings);
        for (const mapping of mappings) {
            const label = String(mapping.label || mapping.statuses[0] || mapping.checkboxState).trim();
            menu.addItem((item) => {
                item
                    .setTitle(`${mapping.checkboxState} ${label}`)
                    .setIcon(mapping.icon || 'square');
                if (mapping.checkboxState === context.currentToken) {
                    item.setChecked(true);
                }
                item.onClick(() => {
                    void this.setTaskCheckboxState(context, mapping.checkboxState, expectedMappingSignature);
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
                    const ownedMapping = getLinkedSubitemMappingForState(mappings, token, { normalizedMappings: true });
                    if (!ownedMapping) {
                        new Notice('Configure a checkbox mapping for that marker before applying it to a task.');
                        return;
                    }
                    void this.setTaskCheckboxState(context, ownedMapping.checkboxState, expectedMappingSignature);
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

    private async setTaskCheckboxState(
        context: TaskCheckboxContext,
        token: string,
        expectedMappingSignature = this.getCheckboxMutationSignature(),
    ): Promise<void> {
        if (this.plugin.settings.dataArchitectureMode === 'native-records') return;
        const historyContext: DirectTaskHistoryLogContext = {
            action: 'task.checkbox',
            surface: 'checkbox-context-menu',
            path: context.file.path,
            lineNumber: context.lineNumber,
        };
        const historyHandle = await beginDirectTaskHistory(this.plugin.itemHistoryService, {
            action: 'task.checkbox',
            cause: {
                kind: 'user',
                sourcePluginId: 'tps-global-context-menu',
                surface: historyContext.surface,
            },
            before: {
                path: context.file.path,
                lineNumber: context.lineNumber,
                rawLine: context.rawLine,
            },
        });
        const nextMarker = getCheckboxStateMarker(token);
        let updatedLineIndex = -1;
        let didWrite = false;
        let unresolvedWrite = false;
        let mappingGuardBlocked = false;
        let updatedRawLine = context.rawLine;
        let historyReady = true;
        let confirmedHistoryBefore: DirectTaskHistoryLocation | undefined;

        try {
            await this.plugin.subitemRelationshipSyncService.mutateMarkdownBody(context.file, async (lines) => {
                const lineIndex = this.resolveCurrentTaskLineIndex(lines, context);
                if (lineIndex < 0) {
                    unresolvedWrite = true;
                    return false;
                }

                const currentLine = lines[lineIndex] || '';
                const currentParsed = parseTaskLine(currentLine);
                if (!currentParsed || !isTaskCheckboxWorkflowTokenCurrent(currentParsed.token, context.currentToken)) {
                    unresolvedWrite = true;
                    return false;
                }
                confirmedHistoryBefore = {
                    path: context.file.path,
                    lineNumber: lineIndex,
                    rawLine: currentLine,
                };
                const liveMappings = this.getCheckboxMappings();
                if (
                    this.getCheckboxMutationSignature(liveMappings) !== expectedMappingSignature
                    || !getLinkedSubitemMappingForState(liveMappings, currentParsed.token, { normalizedMappings: true })
                    || !getLinkedSubitemMappingForState(liveMappings, token, { normalizedMappings: true })
                ) {
                    mappingGuardBlocked = true;
                    return false;
                }
                let updatedLine = this.withTaskCheckboxToken(currentLine, token);
                updatedLine = updateTaskCompletedDateForCheckboxState(updatedLine, nextMarker, {
                    completeMarkers: this.getCompleteMarkers(liveMappings),
                });
                updatedLine = updateTaskLineTimestamps(updatedLine, {
                    enabled: this.plugin.settings.autoSyncFileTimestamps === true,
                    modifiedKey: this.plugin.settings.dateModifiedFrontmatterKey,
                    format: this.plugin.settings.fileTimestampFormat,
                    markModified: true,
                });
                if (updatedLine === currentLine) return false;
                const historyIdentity = ensureDirectTaskHistoryIdentity(
                    this.plugin.itemHistoryService,
                    historyHandle,
                    updatedLine,
                    historyContext,
                );
                updatedLine = historyIdentity.line;
                historyReady = historyReady && historyIdentity.ready;

                lines[lineIndex] = updatedLine;
                updatedLineIndex = lineIndex;
                updatedRawLine = updatedLine;
                didWrite = true;
                return true;
            });
        } catch (error) {
            await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
            throw error;
        }

        if (mappingGuardBlocked) {
            await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
            logger.flowWarn('TaskCheckboxMenu', 'write:mapping-changed', {
                path: context.file.path,
                renderedLineNumber: context.lineNumber + 1,
                nextCheckboxState: token,
            });
            new Notice('Task status mappings changed before the checkbox could be updated. Refresh and try again.');
            return;
        }
        if (unresolvedWrite) {
            await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
            logger.flowWarn('TaskCheckboxMenu', 'write:unresolved-task', {
                path: context.file.path,
                renderedLineNumber: context.lineNumber + 1,
                nextCheckboxState: token,
            });
            new Notice('That task changed before its checkbox could be updated. Refresh and try again.');
            return;
        }
        if (!didWrite) {
            await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
            return;
        }
        if (historyReady) {
            await commitDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, {
                ...(confirmedHistoryBefore ? { confirmedBefore: confirmedHistoryBefore } : {}),
                after: {
                    path: context.file.path,
                    lineNumber: updatedLineIndex,
                    rawLine: updatedRawLine,
                },
                sourceDisposition: 'retained',
                outcome: 'committed',
            }, historyContext);
        } else {
            await abortDirectTaskHistory(this.plugin.itemHistoryService, historyHandle, historyContext);
        }
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
        return setTaskCheckboxWorkflowState(line, token, this.getTaskWorkflowFieldOwnership());
    }

    private getTaskWorkflowFieldOwnership(): TaskCheckboxWorkflowFieldOwnership {
        const statusService = this.plugin.sharedServices?.status;
        return {
            workflowStatusKey: statusService?.getStatusPropertyKey?.() || 'status',
            relationalStatusKey: statusService?.getRelationalStatusPropertyKey?.(),
        };
    }

    private getCheckboxMappings() {
        return normalizeLinkedSubitemMappings(this.plugin.settings.linkedSubitemCheckboxMappings || [], {
            enforceStrictDefaults: false,
        });
    }

    private getClassificationOptions() {
        const statusService = this.plugin.sharedServices.status;
        return {
            completionStatuses: statusService.getDoneStatuses(),
            normalizeStatus: (value: unknown) => statusService.normalize(value),
        };
    }

    private getCompleteMarkers(mappings = this.getCheckboxMappings()): string[] {
        return getLinkedSubitemCompleteMarkers(mappings, this.getClassificationOptions());
    }

    private getCheckboxMutationSignature(mappings = this.getCheckboxMappings()): string {
        return getTaskCheckboxWorkflowMutationSignature(
            mappings,
            this.getTaskWorkflowFieldOwnership(),
            this.getCompleteMarkers(mappings),
        );
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

}
