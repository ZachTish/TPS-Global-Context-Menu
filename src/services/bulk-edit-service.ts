import { TFile, Notice, normalizePath } from 'obsidian';
import TPSGlobalContextMenuPlugin from '../main';
import * as logger from "../logger";
import { normalizeTagValue, normalizeTagList, parseTagInput, mergeNormalizedTags } from '../utils/tag-utils';
import {
    mergeLinkList,
    mergeMixedList,
    mergeStringList,
    parseLinkListInput,
    parseMixedListInput,
    parseStringListInput,
    removeLinkListValues,
    removeStringListValues,
} from '../utils/list-utils';
import {
    mergeEntityReferenceList,
    mergeMixedEntityReferenceList,
    removeEntityReferenceListValues,
    removeMixedEntityReferenceListValues,
} from '../utils/entity-property';
import { propertyUsesEntityOptions } from '../utils/property-option-source';
import { setCompletedDateValue } from '../utils/completed-date-utils';
import { normalizeObsidianDateTimeValue } from '../utils/obsidian-date-time';
import { ChecklistHandler } from '../handlers/checklist-handler';
import { ParentLinkHandler } from '../handlers/parent-link-handler';
import { buildParentFrontmatterLinkValue, buildParentLinkValue, linkValueMatchesFile, extractLinkTarget, resolveLinkValueToFile } from '../handlers/parent-link-format';
import {
    canAutomaticallyMutateTemplateFile,
    canAutomaticallyMutateTemplateFrontmatter,
    canAutomaticallyMutateTemplateSource,
    canAutomaticallyMutatePathWithExclusions,
} from '../utils/template-protection';
import {
    casefold,
    deleteValueCaseInsensitive,
    findKeyCaseInsensitive,
    mutateFrontmatterTagFields,
    removeInlineTagsSafely,
    runInBatches,
    setValueCaseInsensitive,
    showNotice,
} from '../core';

export class BulkEditService {
    plugin: TPSGlobalContextMenuPlugin;
    private frontmatterWriteChains: Map<string, Promise<void>> = new Map();
    private malformedFrontmatterWarnedPaths: Set<string> = new Set();
    private checklistHandler: ChecklistHandler;
    private parentLinkHandler: ParentLinkHandler;

    constructor(plugin: TPSGlobalContextMenuPlugin) {
        this.plugin = plugin;
        this.checklistHandler = new ChecklistHandler(plugin.app, plugin.settings.dataArchitectureMode !== 'native-records');
        this.parentLinkHandler = new ParentLinkHandler(
            plugin.app,
            () => plugin.settings,
            () => plugin.parentLinkResolutionService,
            (frontmatter) => this.getWorkflowStatusValue(frontmatter),
        );
    }

    private isChecklistCompletionStatus(status: unknown): boolean {
        const normalized = this.plugin.sharedServices?.status?.normalize?.(status) || String(status ?? '').trim().toLowerCase();
        return normalized === 'complete' || normalized === 'completed' || normalized === 'done';
    }

    private getWorkflowStatusKey(): string {
        return String(
            this.plugin.sharedServices?.status?.getStatusPropertyKey?.() || 'status',
        ).trim() || 'status';
    }

    private getWorkflowStatusValue(frontmatter: Record<string, any> | null | undefined): unknown {
        if (!frontmatter) return undefined;
        const key = this.findFrontmatterKeyCaseInsensitive(frontmatter, this.getWorkflowStatusKey());
        return key ? frontmatter[key] : undefined;
    }

    private async getDailyNoteSettings(): Promise<{ format: string; folder: string; template: string }> {
        let format = "YYYY-MM-DD";
        let folder = "";
        let template = "";

        try {
            const dailyNotesPlugin = (this.plugin.app as any).internalPlugins?.getPluginById?.("daily-notes")
                || (this.plugin.app as any).internalPlugins?.plugins?.["daily-notes"];
            const options = dailyNotesPlugin?.instance?.options;
            if (typeof options?.format === "string" && options.format.trim()) format = options.format.trim();
            if (typeof options?.folder === "string" && options.folder.trim()) folder = options.folder.trim();
            if (typeof options?.template === "string" && options.template.trim()) template = options.template.trim();
        } catch {
            // Fall through to persisted Daily Notes settings.
        }

        try {
            const configDir = (this.plugin.app.vault as any)?.configDir || ".obsidian";
            const raw = await this.plugin.app.vault.adapter.read(normalizePath(`${configDir}/daily-notes.json`));
            const parsed = JSON.parse(raw);
            if (typeof parsed?.format === "string" && parsed.format.trim()) format = parsed.format.trim();
            if (typeof parsed?.folder === "string" && parsed.folder.trim()) folder = parsed.folder.trim();
            if (typeof parsed?.template === "string" && parsed.template.trim()) template = parsed.template.trim();
        } catch {
            // Daily Notes may not have a persisted config yet.
        }

        return {
            format,
            folder: normalizePath(folder).replace(/^\/+|\/+$/g, ""),
            template,
        };
    }

    private async isConfiguredDailyNote(file: TFile, scheduled?: string): Promise<boolean> {
        void scheduled;
        return this.plugin.fileNamingService.isDailyNoteFile(file);
    }

    private async isConfiguredDailyNoteTemplate(file: TFile): Promise<boolean> {
        const { template } = await this.getDailyNoteSettings();
        if (!template) return false;
        const templateFile = this.resolveDailyNoteTemplateFile(template);
        return templateFile instanceof TFile && normalizePath(templateFile.path) === normalizePath(file.path);
    }

    private async isDailyNoteRecurrenceDirectFile(file: TFile, scheduled?: string): Promise<boolean> {
        return await this.isConfiguredDailyNote(file, scheduled) || await this.isConfiguredDailyNoteTemplate(file);
    }

    async shouldSkipNoteLevelRecurrence(file: TFile, scheduled?: string): Promise<boolean> {
        return await this.isDailyNoteRecurrenceDirectFile(file, scheduled);
    }

    private resolveDailyNoteTemplateFile(templatePath: string): TFile | null {
        const normalizedPath = normalizePath(templatePath);
        const direct = this.plugin.app.vault.getAbstractFileByPath(normalizedPath);
        if (direct instanceof TFile) return direct;
        if (!normalizedPath.toLowerCase().endsWith(".md")) {
            const withExtension = this.plugin.app.vault.getAbstractFileByPath(`${normalizedPath}.md`);
            if (withExtension instanceof TFile) return withExtension;
        }
        return null;
    }

    getDailyNoteDateFormat(): string {
        try {
            const periodicNotes = (this.plugin.app as any)?.plugins?.getPlugin?.("periodic-notes");
            const periodicFormat = periodicNotes?.settings?.daily?.format;
            if (typeof periodicFormat === "string" && periodicFormat.trim()) {
                return periodicFormat.trim();
            }
            const dailyNotes = (this.plugin.app as any)?.internalPlugins?.getPluginById?.("daily-notes");
            const coreFormat = dailyNotes?.instance?.options?.format;
            if (typeof coreFormat === "string" && coreFormat.trim()) {
                return coreFormat.trim();
            }
        } catch {
            // ignore
        }
        return "YYYY-MM-DD";
    }

    private normalizeFrontmatterKey(key: string): string {
        return casefold(String(key || ''));
    }

    private normalizeStatusValue(value: unknown): string {
        return String(value ?? '').trim().toLowerCase();
    }

    private getProtectedIdentityKeys(): Set<string> {
        const keys = new Set<string>(['externaleventid', 'tpscalendaruid']);
        const pluginsApi: any = (this.plugin.app as any)?.plugins;
        const controller: any = pluginsApi?.getPlugin?.('tps-controller');
        const calendarBase: any = pluginsApi?.getPlugin?.('tps-calendar-base');

        const addIfString = (value: unknown) => {
            const normalized = this.normalizeFrontmatterKey(String(value ?? ''));
            if (normalized) keys.add(normalized);
        };

        addIfString(controller?.settings?.eventIdKey);
        addIfString(controller?.settings?.uidKey);
        addIfString(calendarBase?.settings?.eventIdKey);
        addIfString(calendarBase?.settings?.uidKey);

        return keys;
    }

    private isProtectedIdentityKey(key: string): boolean {
        const normalized = this.normalizeFrontmatterKey(key);
        if (!normalized) return false;
        return this.getProtectedIdentityKeys().has(normalized);
    }

    private findFrontmatterKeyCaseInsensitive(target: Record<string, any>, key: string): string | null {
        return findKeyCaseInsensitive(target || {}, key);
    }

    private setFrontmatterValueCaseInsensitive(target: Record<string, any>, key: string, value: any): void {
        setValueCaseInsensitive(target, key, value);
    }

    private deleteFrontmatterValueCaseInsensitive(target: Record<string, any>, key: string): void {
        deleteValueCaseInsensitive(target, key);
    }

    private getFrontmatterValueCaseInsensitive(target: Record<string, any> | null | undefined, key: string): any {
        if (!target) return undefined;
        const actualKey = this.findFrontmatterKeyCaseInsensitive(target, key);
        return actualKey ? target[actualKey] : undefined;
    }

    private isTagFrontmatterKey(key: string): boolean {
        const normalized = this.normalizeFrontmatterKey(key);
        return normalized === 'tags' || normalized === 'tag';
    }

    private isAliasFrontmatterKey(key: string): boolean {
        const normalized = this.normalizeFrontmatterKey(key);
        return normalized === 'alias' || normalized === 'aliases';
    }

    private filterTagsForRemoval(rawValue: unknown, normalizedTags: Set<string>): { changed: boolean; nextValue?: string[] } {
        const currentTags = normalizeTagList(rawValue);
        if (!currentTags.length) {
            return { changed: false, nextValue: currentTags };
        }

        const filtered = currentTags.filter((rawTag) => !normalizedTags.has(normalizeTagValue(rawTag)));
        if (filtered.length === currentTags.length) {
            return { changed: false, nextValue: currentTags };
        }

        if (filtered.length === 0) {
            return { changed: true };
        }

        return { changed: true, nextValue: filtered };
    }

    private notifyFilesChanged(files: TFile[]): void {
        try {
            const paths = files.map((f) => f.path);
            this.plugin.eventService.emitFilesUpdated(paths);
        } catch (e) {
            logger.warn('[TPS GCM] Failed to trigger files-updated event:', e);
        }
    }

    async runSerializedFrontmatterWrite(file: TFile, action: () => Promise<void>): Promise<void> {
        const key = file.path;
        const previous = this.frontmatterWriteChains.get(key) ?? Promise.resolve();

        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        const queued = previous.then(() => gate).catch(() => gate);
        this.frontmatterWriteChains.set(key, queued);

        try {
            await previous;
            await this.normalizeLeadingWhitespaceBeforeFrontmatter(file);
            await action();
        } finally {
            release();
            if (this.frontmatterWriteChains.get(key) === queued) {
                this.frontmatterWriteChains.delete(key);
            }
        }
    }

    async canMutateFrontmatterSafely(file: TFile): Promise<boolean> {
        if (!(file instanceof TFile)) return false;
        if (file.extension?.toLowerCase() !== 'md') return false;

        await this.normalizeLeadingWhitespaceBeforeFrontmatter(file);
        const issue = await this.getUnsafeFrontmatterIssue(file);
        if (!issue) {
            return true;
        }

        if (!this.malformedFrontmatterWarnedPaths.has(file.path)) {
            this.malformedFrontmatterWarnedPaths.add(file.path);
            const message = issue === 'frontmatter-not-at-top'
                ? `Skipped frontmatter update for "${file.basename}" (frontmatter is not at the top of the note).`
                : `Skipped frontmatter update for "${file.basename}" (duplicate YAML blocks detected).`;
            new Notice(message);
            logger.warn('[TPS GCM] Skipping frontmatter mutation: unsafe frontmatter structure detected', {
                file: file.path,
                issue,
            });
        }
        return false;
    }

    private async getUnsafeFrontmatterIssue(file: TFile): Promise<'frontmatter-not-at-top' | 'duplicate-frontmatter' | null> {
        let content = '';
        try {
            content = await this.plugin.app.vault.cachedRead(file);
        } catch (error) {
            logger.warn('[TPS GCM] Failed reading file for frontmatter safety check', { file: file.path, error });
            return null;
        }

        if (!content) return null;
        const normalized = content.replace(/\r\n/g, '\n');
        const bomOffset = normalized.startsWith('\uFEFF') ? 1 : 0;
        const body = normalized.slice(bomOffset);

        const trimmedLeading = body.replace(/^\s*/, '');
        const leadingOffset = body.length - trimmedLeading.length;
        const leadingWhitespaceOnly = leadingOffset > 0 && !/\S/.test(body.slice(0, leadingOffset));
        const frontmatterCandidate = body.startsWith('---\n')
            ? body
            : leadingWhitespaceOnly && trimmedLeading.startsWith('---\n')
                ? trimmedLeading
                : null;

        if (frontmatterCandidate) {
            const firstBlock = this.findFrontmatterBlock(frontmatterCandidate, 0);
            if (!firstBlock) return null;

            const trimmedAfterFirst = frontmatterCandidate.slice(firstBlock.end).replace(/^\s*/, '');
            if (!trimmedAfterFirst.startsWith('---\n')) return null;

            const secondBlock = this.findFrontmatterBlock(trimmedAfterFirst, 0);
            if (secondBlock && this.looksLikeYamlFrontmatter(secondBlock.body)) {
                return 'duplicate-frontmatter';
            }

            return null;
        }

        if (trimmedLeading.startsWith('---\n')) {
            const nestedBlock = this.findFrontmatterBlock(body, leadingOffset);
            if (nestedBlock && this.looksLikeYamlFrontmatter(nestedBlock.body)) {
                return 'frontmatter-not-at-top';
            }
        }

        return null;
    }

    private async normalizeLeadingWhitespaceBeforeFrontmatter(file: TFile): Promise<void> {
        let content = '';
        try {
            content = await this.plugin.app.vault.cachedRead(file);
        } catch {
            return;
        }

        if (!content) return;

        const normalized = content.replace(/\r\n/g, '\n');
        const bom = normalized.startsWith('\uFEFF') ? '\uFEFF' : '';
        const body = bom ? normalized.slice(1) : normalized;
        if (body.startsWith('---\n')) return;

        const trimmedLeading = body.replace(/^\s*/, '');
        const leadingOffset = body.length - trimmedLeading.length;
        if (leadingOffset <= 0 || !trimmedLeading.startsWith('---\n')) return;

        const prefix = body.slice(0, leadingOffset);
        if (/\S/.test(prefix)) return;

        const liveFile = this.plugin.app.vault.getAbstractFileByPath(file.path);
        if (!(liveFile instanceof TFile)) return;

        await this.plugin.app.vault.modify(liveFile, `${bom}${trimmedLeading}`);
    }

    private findFrontmatterBlock(content: string, startIndex: number): { body: string; end: number } | null {
        if (!content.startsWith('---\n', startIndex)) {
            return null;
        }

        const closeIndex = content.indexOf('\n---\n', startIndex + 4);
        if (closeIndex === -1) {
            return null;
        }

        return {
            body: content.slice(startIndex + 4, closeIndex),
            end: closeIndex + '\n---\n'.length,
        };
    }

    private looksLikeYamlFrontmatter(body: string): boolean {
        return body
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .some((line) => /^[A-Za-z0-9_"'.-]+\s*:/.test(line));
    }

    async applyToFiles(
        files: TFile[],
        callback: (fm: any, file: TFile) => void | Promise<void>,
        options: { writeGuard?: (file: TFile) => boolean } = {},
    ): Promise<number> {
        let count = 0;
        const updatedPropertyTargets: TFile[] = [];
        let skippedUnsupported = 0;
        let skippedUnsafe = 0;
        let failures = 0;
        logger.flow('BulkEdit', 'apply:start', { files: files.length });

        await runInBatches(files, async (file) => {
            try {
                if (options.writeGuard?.(file) === false) return;
                const extension = file.extension?.toLowerCase();
                if (
                    this.plugin.filePropertiesService?.isCompanionFile(file)
                    || (extension !== 'md' && !this.plugin.filePropertiesService?.isPropertyTarget(file))
                ) {
                    skippedUnsupported++;
                    return;
                }
                if (extension === 'md' && !(await this.canMutateFrontmatterSafely(file))) {
                    skippedUnsafe++;
                    return;
                }
                const changed = await this.plugin.frontmatterMutationService.process(file, (fm) => {
                    if (options.writeGuard?.(file) === false) return;
                    return callback(fm, file);
                }, { kind: 'user' }, options.writeGuard ? () => options.writeGuard?.(file) !== false : undefined);
                if (!changed) return;
                if (extension !== 'md') updatedPropertyTargets.push(file);
                count++;
            } catch (e) {
                failures++;
                logger.flowError('BulkEdit', 'apply:file-failed', e, { path: file.path });
            }
        }, 40);

        // Mutation services publish their own events. Markdown overlays consume
        // those events; attachment menus still require this direct refresh.
        if (updatedPropertyTargets.length > 0) {
            setTimeout(() => {
                for (const file of updatedPropertyTargets) {
                    this.plugin.persistentMenuManager?.refreshMenusForFile(file);
                }
            }, 350);
        }

        logger.flow('BulkEdit', 'apply:done', {
            files: files.length,
            changed: count,
            skippedUnsupported,
            skippedUnsafe,
            failures,
        });
        if (failures > 0) {
            new Notice(`Could not finish updating properties for ${failures} ${failures === 1 ? 'note' : 'notes'}.`);
        }
        return count;
    }

    async updateFrontmatter(
        files: TFile[],
        updates: Record<string, any>,
        options: { writeGuard?: (file: TFile) => boolean } = {},
    ): Promise<number> {
        if (options.writeGuard && files.some((file) => options.writeGuard?.(file) === false)) return 0;
        const workflowStatusKey = this.getWorkflowStatusKey();
        const workflowStatusUpdate = Object.entries(updates || {}).find(
            ([key]) => key.trim().toLowerCase() === workflowStatusKey.toLowerCase(),
        );
        const hasStatusUpdate = workflowStatusUpdate !== undefined;
        const statusUpdateValue = workflowStatusUpdate?.[1];
        logger.flow('BulkEdit', 'frontmatter:update-start', {
            files: files.length,
            keys: Object.keys(updates || {}).sort(),
            status: statusUpdateValue ?? '',
            statusKey: workflowStatusKey,
        });
        const blockedKeys = Object.keys(updates).filter((key) => this.isProtectedIdentityKey(key));
        if (blockedKeys.length > 0) {
            blockedKeys.forEach((key) => delete updates[key]);
            new Notice(`Blocked protected key edit: ${blockedKeys.join(', ')}`);
            logger.flowWarn('BulkEdit', 'frontmatter:blocked-protected-keys', { keys: blockedKeys });
            if (Object.keys(updates).length === 0) {
                logger.flow('BulkEdit', 'frontmatter:update-done', {
                    files: files.length,
                    changed: 0,
                    reason: 'only-protected-keys',
                });
                return 0;
            }
        }

        // Checklist Prompt Logic (Single file only to avoid spam)
        if (
            this.plugin.settings.checkOpenChecklistItems &&
            hasStatusUpdate &&
            this.isChecklistCompletionStatus(statusUpdateValue) &&
            files.length === 1 &&
            files[0].extension?.toLowerCase() === 'md'
        ) {
            const canProceed = await this.checklistHandler.handleChecklistCompletion(
                files[0],
                options.writeGuard ? () => options.writeGuard?.(files[0]) !== false : undefined,
            );
            if (!canProceed) {
                logger.flow('BulkEdit', 'frontmatter:update-canceled', {
                    files: files.length,
                    reason: 'open-checklist-guard',
                    path: files[0]?.path || '',
                    status: statusUpdateValue,
                });
                return 0;
            }
        }

        const recurrenceStatuses = Array.isArray(this.plugin.settings.recurrenceCompletionStatuses)
            ? this.plugin.settings.recurrenceCompletionStatuses
            : ['complete', 'wont-do'];
        const recurrenceCompletionSet = new Set(
            recurrenceStatuses.map((status) => this.normalizeStatusValue(status)).filter(Boolean),
        );
        const targetStatus = hasStatusUpdate ? this.normalizeStatusValue(statusUpdateValue) : '';

        const count = await this.applyToFiles(files, (fm) => {
            for (const [key, value] of Object.entries(updates)) {
                if (value === null || value === undefined) {
                    this.deleteFrontmatterValueCaseInsensitive(fm, key);
                    continue;
                }

                if (this.isTagFrontmatterKey(key)) {
                    const normalizedTags = normalizeTagList(value);
                    if (!normalizedTags.length) {
                        this.deleteFrontmatterValueCaseInsensitive(fm, key);
                    } else {
                        this.setFrontmatterValueCaseInsensitive(fm, key, normalizedTags);
                    }
                    continue;
                }

                this.setFrontmatterValueCaseInsensitive(fm, key, value);
            }

            if (hasStatusUpdate) {
                if (recurrenceCompletionSet.has(targetStatus)) {
                    setCompletedDateValue(fm);
                } else if (targetStatus) {
                    this.deleteFrontmatterValueCaseInsensitive(fm, 'completedDate');
                }
            }
        }, options);

        logger.flow('BulkEdit', 'frontmatter:update-done', {
            files: files.length,
            changed: count,
            keys: Object.keys(updates).sort(),
            status: statusUpdateValue ?? '',
            statusKey: workflowStatusKey,
        });
        return count;
    }

    async setStatus(
        files: TFile[],
        status: string,
        options: { writeGuard?: (file: TFile) => boolean } = {},
    ): Promise<number> {
        if (options.writeGuard && files.some((file) => options.writeGuard?.(file) === false)) return 0;
        // Parent link prompt (single file to avoid spam)
        if (
            this.plugin.settings.checkParentLinkStatuses &&
            this.parentLinkHandler.isCompletionStatus(status) &&
            files.length === 1 &&
            this.plugin.parentLinkResolutionService.isRelationshipTarget(files[0])
        ) {
            const canProceed = await this.parentLinkHandler.handleParentLinkCompletion(
                files[0],
                !!this.plugin.settings.enableLogging
            );
            if (!canProceed) {
                return 0;
            }
        }

        // The shared writer owns the checklist decision for every status route.
        return this.updateFrontmatter(
            files,
            { [this.getWorkflowStatusKey()]: status },
            options,
        );
    }

    async setPriority(files: TFile[], priority: string): Promise<number> {
        return this.updateFrontmatter(files, { priority });
    }

    async addTag(
        files: TFile[],
        tag: string,
        key: string = 'tags',
        options: { writeGuard?: (file: TFile) => boolean } = {},
    ): Promise<number> {
        if (this.isProtectedIdentityKey(key)) {
            new Notice(`Blocked protected key edit: ${key}`);
            logger.warn('[TPS GCM] Blocked protected identity key edit in addTag', { key });
            return 0;
        }

        const normalizedTags = parseTagInput(tag);
        if (!normalizedTags.length) return 0;
        const storedTags = normalizedTags.map((value) => `#${value}`);

        return this.applyToFiles(files, (fm) => {
            const targetKey = this.findFrontmatterKeyCaseInsensitive(fm, key) || key;
            fm[targetKey] = mergeNormalizedTags(fm[targetKey], normalizedTags);
            if (targetKey !== key && key in fm) {
                delete fm[key];
            }
        }, options);
    }

    async addListValues(
        files: TFile[],
        value: string,
        key: string,
        entityReference = false,
        options: { writeGuard?: (file: TFile) => boolean } = {},
    ): Promise<number> {
        if (this.isProtectedIdentityKey(key)) {
            new Notice(`Blocked protected key edit: ${key}`);
            logger.warn('[TPS GCM] Blocked protected identity key edit in addListValues', { key });
            return 0;
        }

        const property = this.plugin.settings.properties?.find((prop) => String(prop.key || '').toLowerCase() === String(key || '').toLowerCase());
        const values = property?.listItemType === 'link' || entityReference
            ? parseLinkListInput(value)
            : propertyUsesEntityOptions(property)
                ? parseMixedListInput(value)
                : parseStringListInput(value);
        if (!values.length) return 0;

        return this.applyToFiles(files, (fm) => {
            const targetKey = this.findFrontmatterKeyCaseInsensitive(fm, key) || key;
            fm[targetKey] = property?.listItemType === 'link'
                ? entityReference && propertyUsesEntityOptions(property)
                    ? mergeEntityReferenceList(fm[targetKey], values)
                    : mergeLinkList(fm[targetKey], values)
                : entityReference && propertyUsesEntityOptions(property)
                    ? mergeMixedEntityReferenceList(fm[targetKey], values)
                    : propertyUsesEntityOptions(property)
                        ? mergeMixedList(fm[targetKey], values)
                        : mergeStringList(fm[targetKey], values);
            if (targetKey !== key && key in fm) {
                delete fm[key];
            }
        }, options);
    }

    async removeListValues(files: TFile[], value: string, key: string): Promise<number> {
        if (this.isProtectedIdentityKey(key)) {
            new Notice(`Blocked protected key edit: ${key}`);
            logger.warn('[TPS GCM] Blocked protected identity key edit in removeListValues', { key });
            return 0;
        }

        const property = this.plugin.settings.properties?.find((prop) => String(prop.key || '').toLowerCase() === String(key || '').toLowerCase());
        const values = property?.listItemType === 'link'
            ? parseLinkListInput(value)
            : propertyUsesEntityOptions(property)
                ? parseMixedListInput(value)
                : parseStringListInput(value);
        if (!values.length) return 0;

        const parse = (raw: unknown) => property?.listItemType === 'link' ? parseLinkListInput(raw)
            : propertyUsesEntityOptions(property) ? parseMixedListInput(raw) : parseStringListInput(raw);
        const remove = (raw: unknown) => property?.listItemType === 'link'
            ? propertyUsesEntityOptions(property) ? removeEntityReferenceListValues(raw, values) : removeLinkListValues(raw, values)
            : propertyUsesEntityOptions(property) ? removeMixedEntityReferenceListValues(raw, values) : removeStringListValues(raw, values);
        const openPaths = new Set(this.plugin.app.workspace?.getLeavesOfType?.('markdown').map(leaf => (leaf.view as any)?.file?.path) || []);
        const affected = files.filter(file => {
            if (file.extension?.toLowerCase() !== 'md' || openPaths.has(file.path)) return true;
            const fm = this.plugin.app.metadataCache?.getFileCache(file)?.frontmatter;
            if (!fm) return true;
            const raw = this.getFrontmatterValueCaseInsensitive(fm, key);
            return parse(raw).length !== remove(raw).length;
        });
        return this.applyToFiles(affected, (fm) => {
            const targetKey = this.findFrontmatterKeyCaseInsensitive(fm, key) || key;
            const original = fm[targetKey];
            const nextValues = remove(original);
            if (nextValues.length === parse(original).length) return;
            if (nextValues.length === 0) {
                delete fm[targetKey];
            } else {
                // Preserve authored representations and duplicate unrelated members.
                fm[targetKey] = Array.isArray(original)
                    ? original.flatMap(item => parse(item).length === remove(item).length ? [item] : remove(item))
                    : nextValues;
            }
            if (targetKey !== key && key in fm) {
                delete fm[key];
            }
        });
    }

    async removeTag(files: TFile[], tag: string, key: string = 'tags'): Promise<number> {
        if (this.isProtectedIdentityKey(key)) {
            new Notice(`Blocked protected key edit: ${key}`);
            logger.warn('[TPS GCM] Blocked protected identity key edit in removeTag', { key });
            return 0;
        }

        const normalizedTags = parseTagInput(tag);
        if (!normalizedTags.length) return 0;

        const normalizedTagSet = new Set(normalizedTags);
        const normalizedField = this.normalizeFrontmatterKey(key);
        const updatedFiles: TFile[] = [];
        let count = 0;

        await runInBatches(files, async (file) => {
            try {
                const isMarkdown = file.extension?.toLowerCase() === 'md';
                if (
                    this.plugin.filePropertiesService?.isCompanionFile(file)
                    || (!isMarkdown && !this.plugin.filePropertiesService?.isPropertyTarget(file))
                ) return;
                if (isMarkdown && !(await this.canMutateFrontmatterSafely(file))) return;


                const frontmatterChanged = await this.plugin.frontmatterMutationService.process(file, (fm) => {
                    if (!fm || typeof fm !== 'object') return;

                    if (this.isTagFrontmatterKey(normalizedField) || this.isAliasFrontmatterKey(normalizedField)) {
                        mutateFrontmatterTagFields(fm, (field) => {
                            if (field.lowerKey !== normalizedField && !(normalizedField === 'tags' && field.lowerKey === 'tag')) {
                                return;
                            }

                            const result = this.filterTagsForRemoval(field.value, normalizedTagSet);
                            if (!result.changed) {
                                return;
                            }
                            if (!result.nextValue || result.nextValue.length === 0) {
                                field.remove();
                                return;
                            }
                            field.set(result.nextValue);
                        });
                        return;
                    }

                    const targetKey = this.findFrontmatterKeyCaseInsensitive(fm, key) || key;
                    const result = this.filterTagsForRemoval(fm[targetKey], normalizedTagSet);
                    if (!result.changed) {
                        return;
                    }
                    if (!result.nextValue || result.nextValue.length === 0) {
                        delete fm[targetKey];
                    } else {
                        fm[targetKey] = result.nextValue;
                    }
                    if (targetKey !== key && key in fm) {
                        delete fm[key];
                    }
                });

                let bodyChanged = false;
                if (isMarkdown) {
                    await this.runSerializedFrontmatterWrite(file, async () => {
                        const content = await this.plugin.app.vault.read(file);
                        const nextContent = removeInlineTagsSafely(content, normalizedTags);
                        if (nextContent !== content) {
                            await this.plugin.app.vault.modify(file, nextContent);
                            bodyChanged = true;
                        }
                    });
                }

                if (frontmatterChanged || bodyChanged) {
                    updatedFiles.push(file);
                    count++;
                }
            } catch (e) {
                logger.error(`[TPS GCM] Failed to remove tag from ${file.path}:`, e);
            }
        }, 40);

        setTimeout(() => {
            for (const file of updatedFiles) {
                this.plugin.persistentMenuManager?.refreshMenusForFile(file);
            }
        }, 100);

        if (updatedFiles.length > 0) {
            this.notifyFilesChanged(updatedFiles);
        }

        return count;
    }

    async setScheduled(files: TFile[], date: string | null): Promise<number> {
        return this.applyToFiles(files, (fm) => {
            const normalized = normalizeObsidianDateTimeValue(date);
            if (normalized) {
                this.setFrontmatterValueCaseInsensitive(fm, 'scheduled', normalized);
            } else {
                this.deleteFrontmatterValueCaseInsensitive(fm, 'scheduled');
            }
        });
    }

    async updateScheduledDetails(
        files: TFile[],
        scheduled: string | null,
        timeEstimate: number | null,
        allDay: boolean,
        key: string = 'scheduled',
        options: { writeGuard?: (file: TFile) => boolean } = {},
    ): Promise<number> {
        return this.applyToFiles(files, (fm) => {
            const normalizedScheduled = normalizeObsidianDateTimeValue(scheduled);
            if (normalizedScheduled) {
                this.setFrontmatterValueCaseInsensitive(fm, key, normalizedScheduled);
            } else {
                this.deleteFrontmatterValueCaseInsensitive(fm, key);
            }

            if (timeEstimate !== null && timeEstimate !== undefined && !isNaN(timeEstimate)) {
                this.setFrontmatterValueCaseInsensitive(fm, 'timeEstimate', timeEstimate);
            } else {
                this.deleteFrontmatterValueCaseInsensitive(fm, 'timeEstimate');
            }

            if (allDay) {
                this.setFrontmatterValueCaseInsensitive(fm, 'allDay', true);
            } else {
                this.deleteFrontmatterValueCaseInsensitive(fm, 'allDay');
            }
        }, options);
    }

    showNotice(action: string, detail: string, suffix: string, count: number): void {
        const msg = `${detail} ${suffix} on ${count} file${count !== 1 ? 's' : ''}`;
        showNotice(msg);
    }

    private getInheritableParentTags(parentFile: TFile): string[] {
        const frontmatter = this.plugin.parentLinkResolutionService.getLogicalFrontmatter(parentFile);
        const parentTags = parseTagInput([
            this.getFrontmatterValueCaseInsensitive(frontmatter, 'tags'),
            this.getFrontmatterValueCaseInsensitive(frontmatter, 'tag'),
        ]);
        const ignored = new Set(
            (this.plugin.settings.ignoredSubitemTags || [])
                .map((tag) => String(tag || '').trim().replace(/^#/, '').toLowerCase())
                .filter(Boolean),
        );
        return parentTags.filter((tag) => !ignored.has(String(tag || '').trim().replace(/^#/, '').toLowerCase()));
    }

    private async mergeParentTagsIntoChildren(childFiles: TFile[], parentFile: TFile): Promise<TFile[]> {
        const parentTags = this.getInheritableParentTags(parentFile);
        if (!parentTags.length) return [];

        const updatedFiles: TFile[] = [];
        const uniqueChildren = Array.from(
            new Map(
                childFiles
                    .filter((file): file is TFile => (
                        this.plugin.parentLinkResolutionService.isRelationshipTarget(file)
                        && !this.plugin.parentLinkResolutionService.isIgnoredFile(file)
                    ))
                    .map((file) => [file.path, file]),
            ).values(),
        );

        await runInBatches(uniqueChildren, async (childFile) => {
            try {
                const isMarkdown = childFile.extension?.toLowerCase() === 'md';
                if (isMarkdown && !(await this.canMutateFrontmatterSafely(childFile))) return;

                let didChange = false;
                const mergeTags = async () => {
                    await this.plugin.frontmatterMutationService.process(childFile, (fm) => {
                        if (!fm || typeof fm !== 'object') return;

                        const existingTagKey = this.findFrontmatterKeyCaseInsensitive(fm, 'tags');
                        const existingRaw = existingTagKey ? fm[existingTagKey] : undefined;
                        const existingTags = normalizeTagList(existingRaw);
                        const mergedTags = mergeNormalizedTags(existingRaw, parentTags);
                        const unchanged =
                            existingTags.length === mergedTags.length &&
                            existingTags.every((tag, index) => tag === mergedTags[index]);

                        if (unchanged) return;

                        this.setFrontmatterValueCaseInsensitive(fm, 'tags', mergedTags);
                        didChange = true;
                    });
                };
                if (isMarkdown) {
                    await this.runSerializedFrontmatterWrite(childFile, mergeTags);
                } else {
                    await mergeTags();
                }

                if (didChange) updatedFiles.push(childFile);
            } catch (error) {
                logger.error(`[TPS GCM] Failed inheriting parent tags into ${childFile.path}:`, error);
            }
        }, 20);

        return updatedFiles;
    }

    async linkToParent(files: TFile[], parentFile: TFile): Promise<number> {
        if (this.plugin.parentLinkResolutionService.isIgnoredFile(parentFile)) return 0;
        let count = 0;
        const changedFiles = new Map<string, TFile>();
        for (const file of files) {
            if (this.plugin.parentLinkResolutionService.isIgnoredFile(file)) continue;
            const changed = await this.plugin.subitemRelationshipSyncService.linkExistingChildToParent(file, parentFile, {
                insertBodyLink: false,
            });
            if (changed) {
                count += 1;
                changedFiles.set(file.path, file);
            }
        }
        const tagUpdatedFiles = await this.mergeParentTagsIntoChildren(Array.from(changedFiles.values()), parentFile);
        for (const file of tagUpdatedFiles) {
            changedFiles.set(file.path, file);
        }
        if (changedFiles.size > 0) {
            const parentKey = this.parentLinkHandler.normalizeParentKey();
            const affected = Array.from(changedFiles.values());
            affected.push(parentFile);
            setTimeout(() => affected.forEach((file) => this.plugin.persistentMenuManager?.refreshMenusForFile(file)), 200);
            this.notifyFilesChanged(affected);
        }
        return count;
    }

    async linkChildren(currentFile: TFile, childFiles: TFile[]): Promise<number> {
        return this.linkToParent(childFiles, currentFile);
    }

    async linkAttachments(currentFile: TFile, attachmentFiles: TFile[]): Promise<number> {
        if (currentFile.extension?.toLowerCase() !== 'md') return 0;

        const uniqueFiles = attachmentFiles.filter((file, index) =>
            file.path !== currentFile.path &&
            attachmentFiles.findIndex((candidate) => candidate.path === file.path) === index
        );
        if (!uniqueFiles.length) return 0;

        let added = 0;
        await this.runSerializedFrontmatterWrite(currentFile, async () => {
            const content = await this.plugin.app.vault.cachedRead(currentFile);
            const existingEmbedTargets = this.collectEmbeddedTargetPaths(content, currentFile);
            const embeds: string[] = [];
            for (const file of uniqueFiles) {
                if (existingEmbedTargets.has(file.path)) continue;
                embeds.push(this.generateEmbedLink(file, currentFile));
                existingEmbedTargets.add(file.path);
            }
            if (!embeds.length) return;
            const nextContent = `${content.trimEnd()}\n\n${embeds.join('\n')}\n`;
            await this.plugin.app.vault.modify(currentFile, nextContent);
            added = embeds.length;
        });

        if (added > 0) {
            setTimeout(() => this.plugin.persistentMenuManager?.refreshMenusForFile(currentFile), 350);
            this.notifyFilesChanged([currentFile]);
        }

        return added;
    }

    private generateEmbedLink(file: TFile, sourceFile: TFile): string {
        const link = this.plugin.app.fileManager.generateMarkdownLink(file, sourceFile.path);
        return link.startsWith('!') ? link : `!${link}`;
    }

    private collectEmbeddedTargetPaths(content: string, sourceFile: TFile): Set<string> {
        const paths = new Set<string>();
        const pushTarget = (rawTarget: string) => {
            const target = extractLinkTarget(rawTarget);
            if (!target) return;
            const resolved = resolveLinkValueToFile(this.plugin.app, target, sourceFile.path);
            if (resolved) paths.add(resolved.path);
        };

        for (const match of content.matchAll(/!\[\[([^\]]+)\]\]/g)) {
            pushTarget(match[1]);
        }
        for (const match of content.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)) {
            pushTarget(match[1]);
        }

        return paths;
    }

    /**
     * Removes a frontmatter key+value from each of the given files.
     * The key match is case-insensitive so it works regardless of casing variation.
     */
    async removeFrontmatterKey(
        files: TFile[],
        key: string,
        options: { writeGuard?: (file: TFile) => boolean } = {},
    ): Promise<number> {
        let count = 0;
        const updatedFiles: TFile[] = [];
        for (const file of files) {
            try {
                if (options.writeGuard?.(file) === false) continue;
                const changed = await this.plugin.frontmatterMutationService.process(file, (fm) => {
                    if (options.writeGuard?.(file) === false) return;
                    const actualKey = Object.keys(fm).find(k => k.toLowerCase() === key.toLowerCase()) ?? key;
                    if (actualKey in fm) {
                        delete fm[actualKey];
                    }
                });
                if (changed) {
                    updatedFiles.push(file);
                    count++;
                }
            } catch (err) {
                logger.warn(`[TPS GCM] removeFrontmatterKey failed for ${file.path}:`, err);
            }
        }
        if (updatedFiles.length > 0) {
            this.notifyFilesChanged(updatedFiles);
        }
        return count;
    }

    /**
     * Removes the bidirectional parent↔child link between childFile and parentFile.
     * - Removes the selected parent reference from childFile's parent key (`childOf` by default)
     * - Removes childFile from the `parentOf` array in parentFile's frontmatter
     */
    async unlinkFromParent(childFile: TFile, parentFile: TFile): Promise<void> {
        const result = await this.plugin.subitemRelationshipSyncService.unlinkChildFromParent(childFile, parentFile);
        const changedFiles = [result.childChanged ? childFile : null, result.parentChanged ? parentFile : null].filter((file): file is TFile => file instanceof TFile);
        if (changedFiles.length === 0) return;
        const parentKey = this.parentLinkHandler.normalizeParentKey();
        setTimeout(() => changedFiles.forEach((file) => this.plugin.persistentMenuManager?.refreshMenusForFile(file)), 200);
        this.notifyFilesChanged(changedFiles);
    }

    async unlinkFromAllParents(childFile: TFile): Promise<number> {
        const parentKey = String(this.plugin.settings.parentLinkFrontmatterKey || 'childOf').trim() || 'childOf';
        const parents = this.plugin.parentLinkResolutionService.getStoredParentsForChild(childFile).map((entry) => entry.file);
        if (!parents.length) {
            return 0;
        }

        for (const parent of parents) {
            await this.unlinkFromParent(childFile, parent);
        }
        return parents.length;
    }

    /**
     * Removes an attachment from embedded body content and legacy `attachments` frontmatter.
     */
    async unlinkAttachment(parentFile: TFile, attachmentFile: TFile): Promise<void> {
        const attachmentsKey = 'attachments';
        if (parentFile.extension?.toLowerCase() === 'md') {
            await this.runSerializedFrontmatterWrite(parentFile, async () => {
                const content = await this.plugin.app.vault.cachedRead(parentFile);
                const nextContent = this.removeEmbeddedAttachmentReferences(content, parentFile, attachmentFile);
                if (nextContent !== content) {
                    await this.plugin.app.vault.modify(parentFile, nextContent);
                }
                if (await this.canMutateFrontmatterSafely(parentFile)) {
                    await this.plugin.frontmatterMutationService.process(parentFile, (fm) => {
                        const key = Object.keys(fm).find(k => k.toLowerCase() === attachmentsKey.toLowerCase());
                        if (!key) return;
                        const raw = fm[key];
                        const arr: any[] = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
                        const filtered = arr.filter((v: any) => !linkValueMatchesFile(this.plugin.app, v, parentFile.path, attachmentFile));
                        if (filtered.length === 0) {
                            delete fm[key];
                        } else {
                            fm[key] = filtered;
                        }
                    });
                }
            });
            setTimeout(() => this.plugin.persistentMenuManager?.refreshMenusForFile(parentFile), 350);
            this.notifyFilesChanged([parentFile]);
        }
    }

    private removeEmbeddedAttachmentReferences(content: string, sourceFile: TFile, attachmentFile: TFile): string {
        const matchesAttachment = (rawTarget: string): boolean => {
            const target = extractLinkTarget(rawTarget);
            if (!target) return false;
            const resolved = resolveLinkValueToFile(this.plugin.app, target, sourceFile.path);
            return resolved?.path === attachmentFile.path;
        };

        const cleanLine = (line: string): { line: string; removed: boolean } => {
            const original = line;
            let next = line.replace(/!\[\[([^\]]+)\]\]/g, (full, target) => matchesAttachment(target) ? '' : full);
            next = next.replace(/!\[[^\]]*]\(([^)]+)\)/g, (full, target) => matchesAttachment(target) ? '' : full);
            return { line: next, removed: next !== original };
        };

        const lines = content.split('\n');
        const cleaned = lines
            .map(cleanLine)
            .filter((entry) => entry.line.trim().length > 0 || !entry.removed)
            .map((entry) => entry.line);

        return cleaned.join('\n');
    }

}
