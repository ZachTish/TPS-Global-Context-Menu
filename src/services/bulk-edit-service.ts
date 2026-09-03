import { TFile, Notice, normalizePath } from 'obsidian';
import TPSGlobalContextMenuPlugin from '../main';
import { RRule } from 'rrule';
import * as logger from "../logger";
import { TRACKER_RECURRENCE_RULE } from '../constants';
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
import { stripDateSuffix } from '../utils/date-suffix-utils';
import { setCompletedDateValue } from '../utils/completed-date-utils';
import { ChecklistHandler } from '../handlers/checklist-handler';
import { ParentLinkHandler } from '../handlers/parent-link-handler';
import { buildParentFrontmatterLinkValue, buildParentLinkValue, linkValueMatchesFile, extractLinkTarget, resolveLinkValueToFile } from '../handlers/parent-link-format';
import { reconcileExistingDailyNoteForIsoDate } from '../utils/daily-note-task-schedule';
import {
    canAutomaticallyMutateTemplateFile,
    canAutomaticallyMutateTemplateFrontmatter,
    canAutomaticallyMutateTemplateSource,
    inspectTemplateProtectionSource,
    removeTemplateProtectionTagFromFrontmatter,
    stripTemplateProtectionTagFromSource,
} from '../utils/template-protection';
import {
    classifyDeletedMarkdownLink,
    createDeletedMarkdownLinkContext,
} from '../utils/deleted-link-cleanup';
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
    private readonly recurrenceLastGeneratedKey = 'recurrenceLastGenerated';
    private readonly dailyRecurrenceRule = 'FREQ=DAILY';
    private recurrenceCreationInProgress: Set<string> = new Set();
    private checkMissingRecurrencesRunning = false;
    private frontmatterWriteChains: Map<string, Promise<void>> = new Map();
    private deletedLinkCleanupChain: Promise<void> = Promise.resolve();
    private deletedLinkCleanupPending = 0;
    private malformedFrontmatterWarnedPaths: Set<string> = new Set();
    private checklistHandler: ChecklistHandler;
    private parentLinkHandler: ParentLinkHandler;
    private recurrenceOpStateLoaded = false;
    private recurrenceOpState: {
        version: number;
        ops: Record<string, { state: 'creating' | 'complete'; targetPath: string; updatedAt: number }>;
    } = { version: 1, ops: {} };

    constructor(plugin: TPSGlobalContextMenuPlugin) {
        this.plugin = plugin;
        this.checklistHandler = new ChecklistHandler(plugin.app);
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

    private setWorkflowStatusValue(frontmatter: Record<string, any>, value: unknown): void {
        this.setFrontmatterValueCaseInsensitive(frontmatter, this.getWorkflowStatusKey(), value);
    }

    private deleteWorkflowStatusValue(frontmatter: Record<string, any>): void {
        this.deleteFrontmatterValueCaseInsensitive(frontmatter, this.getWorkflowStatusKey());
    }

    private isEasterRecurrenceRule(recurrenceRule: string): boolean {
        return String(recurrenceRule || '').trim().toUpperCase() === 'GCM-HOLIDAY:EASTER';
    }

    private normalizeRecurrenceRuleValue(recurrenceRule: unknown): string {
        const value = String(recurrenceRule ?? '').trim();
        return value.toLowerCase() === 'dailynote' ? this.dailyRecurrenceRule : value;
    }

    private getEasterDate(year: number, timeSource: Date): Date {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31);
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(year, month - 1, day, timeSource.getHours(), timeSource.getMinutes(), timeSource.getSeconds(), timeSource.getMilliseconds());
    }

    private getNextEasterOccurrence(seedDate: Date, inclusive: boolean): Date {
        let year = seedDate.getFullYear();
        let occurrence = this.getEasterDate(year, seedDate);
        if (inclusive ? occurrence < seedDate : occurrence <= seedDate) {
            occurrence = this.getEasterDate(year + 1, seedDate);
        }
        return occurrence;
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

    private async getDailyNotePath(date: Date): Promise<string> {
        const { format, folder } = await this.getDailyNoteSettings();
        const basename = window.moment(date).format(format);
        return normalizePath(folder ? `${folder}/${basename}.md` : `${basename}.md`);
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

    private applyDailyNoteTemplateVariables(content: string, date: Date, title: string): string {
        const momentDate = window.moment(date);
        return String(content || "")
            .replace(/<%\s*tp\.file\.title\s*%>/g, title)
            .replace(/<%\s*moment\(tp\.file\.title\s*,\s*["']([^"']+)["']\)\.format\(["']([^"']+)["']\)\s*%>/g, (_match, inputFormat, outputFormat) => {
                const parsed = window.moment(title, inputFormat, true);
                return parsed?.isValid?.() && parsed.isValid()
                    ? parsed.format(outputFormat)
                    : momentDate.format(outputFormat);
            })
            .replace(/\{\{date:([^}]+)\}\}/g, (_match, format) => momentDate.format(format))
            .replace(/\{\{time:([^}]+)\}\}/g, (_match, format) => momentDate.format(format))
            .replace(/\{\{date\}\}/g, momentDate.format("YYYY-MM-DD"))
            .replace(/\{\{time\}\}/g, momentDate.format("HH:mm"))
            .replace(/\{\{title\}\}/g, title);
    }

    private async buildDailyNoteContent(date: Date, path: string): Promise<string | null> {
        const { template } = await this.getDailyNoteSettings();
        const title = path.split("/").pop()?.replace(/\.md$/i, "") || window.moment(date).format("YYYY-MM-DD");
        const templateFile = template ? this.resolveDailyNoteTemplateFile(template) : null;
        if (templateFile instanceof TFile) {
            try {
                const templateSource = this.sanitizeRecurrenceInstanceSource(
                    await this.plugin.app.vault.read(templateFile),
                    templateFile,
                    'daily-note recurrence template',
                );
                if (templateSource === null) return null;
                const content = this.applyDailyNoteTemplateVariables(
                    templateSource,
                    date,
                    title,
                );
                return this.sanitizeRecurrenceInstanceSource(
                    content,
                    templateFile,
                    'daily-note recurrence template',
                );
            } catch (error) {
                logger.warn("[TPS GCM] Failed reading Daily Notes template for recurrence:", error);
                return null;
            }
        }
        if (template) {
            logger.warn('[TPS GCM] Configured Daily Notes template is unavailable for recurrence:', template);
            return null;
        }
        return `---\ntitle: ${title}\nscheduled: ${window.moment(date).format("YYYY-MM-DD")} 00:00:00\n---\n`;
    }

    private async createNextDailyNoteRecurrenceInstance(file: TFile, frontmatter: any, nextDate: Date, recurrenceRule: string): Promise<boolean> {
        if (!(await canAutomaticallyMutateTemplateFile(this.plugin.app.vault, file, this.plugin.settings))) {
            logger.warn('[TPS GCM] Skipping automatic Daily Note recurrence for an excluded or unverifiable source:', file.path);
            return false;
        }
        const newFilePath = await this.getDailyNotePath(nextDate);
        const newFileName = newFilePath.split("/").pop() || newFilePath;
        const newScheduled = window.moment(nextDate).format("YYYY-MM-DD 00:00:00");
        const nextIsoDate = window.moment(nextDate).format("YYYY-MM-DD");
        const existingResolution = await reconcileExistingDailyNoteForIsoDate(
            this.plugin.app,
            this.plugin.settings,
            nextIsoDate,
        );
        if (existingResolution.status === 'blocked') {
            logger.flowWarn('DailyNoteRecurrence', 'identity-blocked', {
                date: nextIsoDate,
                reason: existingResolution.reason,
            });
            return false;
        }
        const existingDailyNote = existingResolution.status === 'found'
            ? existingResolution.file
            : null;
        if (this.hasGeneratedRecurrence(frontmatter, newScheduled) && existingDailyNote instanceof TFile) {
            return await this.isVerifiedRecurrenceInstance(existingDailyNote, 'existing daily-note recurrence');
        }

        // Resolve, transform, and sanitize the configured Daily Notes template
        // before acquiring durable generation state when a note still needs to be
        // created. An unsafe/unreadable template therefore creates neither a note
        // nor an in-flight recurrence record.
        const content = existingDailyNote instanceof TFile
            ? null
            : await this.buildDailyNoteContent(nextDate, newFilePath);
        if (!(existingDailyNote instanceof TFile) && content === null) return false;
        if (!(await canAutomaticallyMutateTemplateFile(this.plugin.app.vault, file, this.plugin.settings))) {
            logger.warn('[TPS GCM] Daily Note recurrence source became excluded or unverifiable before generation:', file.path);
            return false;
        }
        const chainId = "daily-notes";
        const recurrenceOpKey = this.buildRecurrenceOpKey(chainId, newScheduled);

        const opStatus = await this.beginRecurrenceOp(recurrenceOpKey, newFilePath);
        if (opStatus !== "acquired") {
            if (await this.plugin.app.vault.adapter.exists(newFilePath)) {
                if (!(await this.isVerifiedRecurrenceInstancePath(newFilePath, 'existing daily-note recurrence'))) {
                    return false;
                }
                await this.completeRecurrenceOp(recurrenceOpKey, newFilePath);
                await this.markRecurrenceGenerated(file, newScheduled);
                return true;
            }
            logger.log("[TPS GCM] Daily-note recurrence operation already in flight for", newFilePath, "- status:", opStatus);
            return false;
        }

        try {
            const beforeCreateResolution = await reconcileExistingDailyNoteForIsoDate(
                this.plugin.app,
                this.plugin.settings,
                nextIsoDate,
            );
            if (beforeCreateResolution.status === 'blocked') {
                logger.flowWarn('DailyNoteRecurrence', 'identity-blocked', {
                    date: nextIsoDate,
                    reason: beforeCreateResolution.reason,
                });
                await this.failRecurrenceOp(recurrenceOpKey);
                return false;
            }
            const existingBeforeCreate = beforeCreateResolution.status === 'found'
                ? beforeCreateResolution.file
                : null;
            if (existingBeforeCreate instanceof TFile) {
                if (!(await this.isVerifiedRecurrenceInstance(existingBeforeCreate, 'existing daily-note recurrence'))) {
                    await this.failRecurrenceOp(recurrenceOpKey);
                    return false;
                }
                await this.completeRecurrenceOp(recurrenceOpKey, newFilePath);
                await this.markRecurrenceGenerated(file, newScheduled);
                new Notice(`Next daily note already exists: ${existingBeforeCreate.basename}.md`);
                return true;
            }

            const folder = newFilePath.includes("/") ? newFilePath.split("/").slice(0, -1).join("/") : "";
            if (folder && !(await this.plugin.app.vault.adapter.exists(folder))) {
                await this.plugin.app.vault.createFolder(folder);
            }

            if (content === null) {
                await this.failRecurrenceOp(recurrenceOpKey);
                return false;
            }
            const newFile = await this.plugin.app.vault.create(newFilePath, content);
            if (!(newFile instanceof TFile)) {
                await this.failRecurrenceOp(recurrenceOpKey);
                return false;
            }

            await this.plugin.frontmatterMutationService.process(newFile, (fm) => {
                removeTemplateProtectionTagFromFrontmatter(fm, this.plugin.settings);
                this.setFrontmatterValueCaseInsensitive(fm, "scheduled", newScheduled);
                this.setFrontmatterValueCaseInsensitive(fm, "recurrenceRule", recurrenceRule);
                this.deleteFrontmatterValueCaseInsensitive(fm, "recurrence");
                this.deleteFrontmatterValueCaseInsensitive(fm, "completedDate");
                this.deleteFrontmatterValueCaseInsensitive(fm, "recurrenceTemplate");
                this.clearLegacyRecurrenceTemplateMarker(fm);
                this.deleteFrontmatterValueCaseInsensitive(fm, this.recurrenceLastGeneratedKey);
                for (const key of Object.keys(fm)) {
                    if (["sort", "hidden"].includes(key.toLowerCase())) {
                        delete fm[key];
                    }
                }
            });

            if (!(await this.isVerifiedRecurrenceInstance(newFile, 'daily-note recurrence creation'))) {
                await this.failRecurrenceOp(recurrenceOpKey);
                return false;
            }

            await this.completeRecurrenceOp(recurrenceOpKey, newFilePath);
            await this.markRecurrenceGenerated(file, newScheduled);
            new Notice(`Created next daily note: ${newFileName}`);
            return true;
        } catch (error) {
            await this.failRecurrenceOp(recurrenceOpKey);
            logger.error("[TPS GCM] Failed to create next daily-note recurrence:", error);
            new Notice("Failed to create next daily note recurrence. Check console for details.");
            return false;
        }
    }

    private getRecurrenceStatePath(): string {
        return `${this.plugin.manifest.dir}/recurrence-create-state.json`;
    }

    private hasGeneratedRecurrence(frontmatter: any, scheduledValue: string): boolean {
        const existing = String(this.getFrontmatterValueCaseInsensitive(frontmatter, this.recurrenceLastGeneratedKey) || '').trim();
        return !!existing && existing === scheduledValue;
    }

    private async markRecurrenceGenerated(file: TFile, scheduledValue: string): Promise<void> {
        if (!(await canAutomaticallyMutateTemplateFile(this.plugin.app.vault, file, this.plugin.settings))) return;
        if (!(await this.canMutateFrontmatterSafely(file))) return;
        await this.runSerializedFrontmatterWrite(file, async () => {
            await this.plugin.frontmatterMutationService.process(file, (fm) => {
                if (!canAutomaticallyMutateTemplateFrontmatter(fm, this.plugin.settings)) return;
                this.setFrontmatterValueCaseInsensitive(fm, this.recurrenceLastGeneratedKey, scheduledValue);
            });
        });
    }

    private sanitizeRecurrenceInstanceSource(source: string, file: TFile, context: string): string | null {
        const sourceState = inspectTemplateProtectionSource(source, this.plugin.settings);
        if (sourceState === 'unsafe') {
            logger.warn(`[TPS GCM] Skipping ${context}: source template identity could not be verified`, {
                file: file.path,
            });
            return null;
        }

        const instanceSource = stripTemplateProtectionTagFromSource(source, this.plugin.settings);
        if (inspectTemplateProtectionSource(instanceSource, this.plugin.settings) !== 'unprotected') {
            logger.warn(`[TPS GCM] Skipping ${context}: source template marker could not be removed safely`, {
                file: file.path,
            });
            return null;
        }
        return instanceSource;
    }

    private async readRecurrenceInstanceSource(file: TFile, context: string): Promise<string | null> {
        try {
            return this.sanitizeRecurrenceInstanceSource(
                await this.plugin.app.vault.read(file),
                file,
                context,
            );
        } catch (error) {
            logger.warn(`[TPS GCM] Skipping ${context}: source could not be read`, {
                file: file.path,
                error,
            });
            return null;
        }
    }

    private async isVerifiedRecurrenceInstance(file: TFile, context: string): Promise<boolean> {
        try {
            const source = await this.plugin.app.vault.read(file);
            const verified = inspectTemplateProtectionSource(source, this.plugin.settings) === 'unprotected';
            if (!verified) {
                logger.warn(`[TPS GCM] ${context} did not produce a safely untagged recurrence instance`, {
                    file: file.path,
                });
            }
            return verified;
        } catch (error) {
            logger.warn(`[TPS GCM] Could not verify ${context} output`, {
                file: file.path,
                error,
            });
            return false;
        }
    }

    private async isVerifiedRecurrenceInstancePath(path: string, context: string): Promise<boolean> {
        const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(path));
        return file instanceof TFile && await this.isVerifiedRecurrenceInstance(file, context);
    }

    private async loadRecurrenceOpState(): Promise<void> {
        if (this.recurrenceOpStateLoaded) return;
        this.recurrenceOpStateLoaded = true;

        try {
            const path = this.getRecurrenceStatePath();
            const exists = await this.plugin.app.vault.adapter.exists(path);
            if (!exists) return;
            const raw = await this.plugin.app.vault.adapter.read(path);
            const parsed = JSON.parse(raw);
            if (parsed && parsed.version === 1 && parsed.ops && typeof parsed.ops === 'object') {
                this.recurrenceOpState = {
                    version: 1,
                    ops: parsed.ops,
                };
            }
        } catch (error) {
            logger.warn('[TPS GCM] Failed loading recurrence create state:', error);
        }
    }

    private async saveRecurrenceOpState(): Promise<void> {
        try {
            const path = this.getRecurrenceStatePath();
            await this.plugin.app.vault.adapter.write(path, JSON.stringify(this.recurrenceOpState, null, 2));
        } catch (error) {
            logger.warn('[TPS GCM] Failed saving recurrence create state:', error);
        }
    }

    private pruneRecurrenceOpState(now: number = Date.now()): void {
        // Keep completed entries for 14 days (idempotency across device sync delay).
        const completeTtlMs = 14 * 24 * 60 * 60 * 1000;
        // Treat in-flight entries older than 10 minutes as stale.
        const creatingTtlMs = 10 * 60 * 1000;

        for (const [key, op] of Object.entries(this.recurrenceOpState.ops)) {
            if (!op || !op.updatedAt) {
                delete this.recurrenceOpState.ops[key];
                continue;
            }
            const age = now - op.updatedAt;
            if (op.state === 'complete' && age > completeTtlMs) {
                delete this.recurrenceOpState.ops[key];
                continue;
            }
            if (op.state === 'creating' && age > creatingTtlMs) {
                delete this.recurrenceOpState.ops[key];
            }
        }
    }

    private resolveRecurrenceChainId(file: TFile, frontmatter: any, recurrenceRule: string): string {
        const explicitKey = this.findFrontmatterKeyCaseInsensitive(frontmatter || {}, 'recurrenceChainId');
        const explicit = explicitKey ? String(frontmatter?.[explicitKey] ?? '').trim() : '';
        if (explicit) return explicit;

        const baseName = stripDateSuffix(file.basename || '').trim().toLowerCase();
        return baseName;
    }

    private buildRecurrenceOpKey(chainId: string, scheduled: string): string {
        return `${chainId}|${scheduled}`;
    }

    private isTrackerRecurrenceRule(rule: string): boolean {
        return String(rule || '').trim().toUpperCase() === TRACKER_RECURRENCE_RULE;
    }

    private buildTrackerGeneratedValue(path: string): string {
        return `${TRACKER_RECURRENCE_RULE}:${normalizePath(path)}`;
    }

    private getGeneratedTrackerPath(frontmatter: any): string | null {
        const existing = String(this.getFrontmatterValueCaseInsensitive(frontmatter, this.recurrenceLastGeneratedKey) || '').trim();
        const prefix = `${TRACKER_RECURRENCE_RULE}:`;
        return existing.toUpperCase().startsWith(prefix) ? normalizePath(existing.slice(prefix.length)) : null;
    }

    private async getAvailableUndatedRecurrencePath(parentPath: string, baseName: string): Promise<{ path: string; name: string }> {
        const safeBaseName = (baseName || 'Tracker').trim() || 'Tracker';
        for (let index = 1; index < 1000; index += 1) {
            const candidateName = index === 1 ? `${safeBaseName}.md` : `${safeBaseName} ${index}.md`;
            const candidatePath = normalizePath(parentPath ? `${parentPath}/${candidateName}` : candidateName);
            if (!(await this.plugin.app.vault.adapter.exists(candidatePath))) {
                return { path: candidatePath, name: candidateName };
            }
        }
        throw new Error(`Could not find available tracker recurrence filename for ${safeBaseName}`);
    }

    private async beginRecurrenceOp(opKey: string, targetPath: string): Promise<'acquired' | 'exists' | 'inflight'> {
        await this.loadRecurrenceOpState();
        const now = Date.now();
        this.pruneRecurrenceOpState(now);

        const normalizedTarget = normalizePath(targetPath);
        const existing = this.recurrenceOpState.ops[opKey];
        if (!existing) {
            this.recurrenceOpState.ops[opKey] = {
                state: 'creating',
                targetPath: normalizedTarget,
                updatedAt: now,
            };
            await this.saveRecurrenceOpState();
            return 'acquired';
        }

        if (existing.state === 'complete') {
            return 'exists';
        }

        const inflightAge = now - existing.updatedAt;
        if (inflightAge < 10 * 60 * 1000) {
            return 'inflight';
        }

        // Stale in-flight op; reclaim lock.
        this.recurrenceOpState.ops[opKey] = {
            state: 'creating',
            targetPath: normalizedTarget,
            updatedAt: now,
        };
        await this.saveRecurrenceOpState();
        return 'acquired';
    }

    private async completeRecurrenceOp(opKey: string, targetPath: string): Promise<void> {
        await this.loadRecurrenceOpState();
        this.recurrenceOpState.ops[opKey] = {
            state: 'complete',
            targetPath: normalizePath(targetPath),
            updatedAt: Date.now(),
        };
        this.pruneRecurrenceOpState();
        await this.saveRecurrenceOpState();
    }

    private async failRecurrenceOp(opKey: string): Promise<void> {
        await this.loadRecurrenceOpState();
        const existing = this.recurrenceOpState.ops[opKey];
        if (existing?.state === 'creating') {
            delete this.recurrenceOpState.ops[opKey];
            await this.saveRecurrenceOpState();
        }
    }

    private getRecurrenceOpTarget(opKey: string): string | null {
        const existing = this.recurrenceOpState.ops[opKey];
        return existing?.targetPath ? normalizePath(existing.targetPath) : null;
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

    isRecurrenceTemplateFrontmatter(frontmatter: unknown): boolean {
        if (!frontmatter || typeof frontmatter !== 'object') return false;
        const record = frontmatter as Record<string, any>;
        return this.getFrontmatterValueCaseInsensitive(record, 'recurrenceTemplate') === true
            || this.getFrontmatterValueCaseInsensitive(record, 'isRecurrenceTemplate') === true;
    }

    private clearLegacyRecurrenceTemplateMarker(frontmatter: Record<string, any>): void {
        this.deleteFrontmatterValueCaseInsensitive(frontmatter, 'isRecurrenceTemplate');
    }

    private markRecurrenceTemplate(frontmatter: Record<string, any>): void {
        this.setFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceTemplate', true);
        this.clearLegacyRecurrenceTemplateMarker(frontmatter);
    }

    private buildRecurrenceTemplateLink(templateFile: TFile, instanceFile: TFile, seriesBaseName: string): string {
        try {
            const linktext = this.plugin.app.metadataCache.fileToLinktext(templateFile, instanceFile.path, true);
            if (linktext && linktext.trim()) {
                return `[[${linktext}]]`;
            }
        } catch {
            // Fall back below
        }
        return `[[${seriesBaseName}]]`;
    }

    private frontmatterReferencesSeriesTemplate(frontmatter: any, seriesName: string, templateFile?: TFile | null): boolean {
        if (!frontmatter) return false;
        const rawValue = this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceTemplate');
        if (rawValue === true) return false;
        const rawLink = String(rawValue ?? '').trim();
        if (!rawLink) return false;

        const normalizedSeries = String(seriesName || '').trim().toLowerCase();
        const target = extractLinkTarget(rawLink).toLowerCase();
        const templatePath = templateFile?.path ? normalizePath(templateFile.path).toLowerCase() : '';

        if (templatePath && (target === templatePath || target.endsWith(`/${templatePath.split('/').pop()}`))) {
            return true;
        }

        if (!target) {
            return rawLink.toLowerCase().includes(`[[${normalizedSeries}]]`);
        }

        const targetBase = target.split('/').pop()?.replace(/\.md$/i, '') || '';
        return targetBase === normalizedSeries;
    }

    private resolveRecurrenceTemplateFile(file: TFile, frontmatter: any): TFile | null {
        const rawTemplate = this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceTemplate');
        if (rawTemplate === true) return null;
        const linkedTemplate = rawTemplate ? resolveLinkValueToFile(this.plugin.app, rawTemplate, file.path) : null;
        if (linkedTemplate instanceof TFile && linkedTemplate.path !== file.path) return linkedTemplate;

        const templateFolder = normalizePath((this.plugin.settings.recurringTemplateFolder || '').trim());
        if (!templateFolder) return null;
        const seriesBaseName = stripDateSuffix(file.basename).trim();
        if (!seriesBaseName) return null;
        const templatePath = normalizePath(`${templateFolder}/${seriesBaseName}.md`);
        const templateFile = this.plugin.app.vault.getAbstractFileByPath(templatePath);
        return templateFile instanceof TFile && templateFile.path !== file.path ? templateFile : null;
    }

    private resolveRecurrenceInfo(file: TFile, frontmatter: any): {
        rule: string;
        templateFile: TFile | null;
        seriesBaseName: string;
    } {
        const templateFile = this.resolveRecurrenceTemplateFile(file, frontmatter);
        const templateFm = templateFile
            ? this.plugin.app.metadataCache.getFileCache(templateFile)?.frontmatter
            : null;
        const localRule = this.normalizeRecurrenceRuleValue(
            this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceRule')
            ?? this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrence')
            ?? '',
        );
        const templateRule = this.normalizeRecurrenceRuleValue(
            this.getFrontmatterValueCaseInsensitive(templateFm, 'recurrenceRule')
            ?? this.getFrontmatterValueCaseInsensitive(templateFm, 'recurrence')
            ?? '',
        );
        return {
            rule: localRule || templateRule,
            templateFile,
            seriesBaseName: (templateFile?.basename || stripDateSuffix(file.basename)).trim(),
        };
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
        callback: (fm: any, file: TFile) => void,
        options: { writeGuard?: (file: TFile) => boolean } = {},
    ): Promise<number> {
        let count = 0;
        const updatedFiles: TFile[] = [];
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
                this.plugin.recurrenceService?.markFileAsModified(file.path);
                const changed = await this.plugin.frontmatterMutationService.process(file, (fm) => {
                    if (options.writeGuard?.(file) === false) return;
                    callback(fm, file);
                });
                if (!changed) return;
                updatedFiles.push(file);
                count++;
            } catch (e) {
                failures++;
                logger.flowError('BulkEdit', 'apply:file-failed', e, { path: file.path });
            }
        }, 40);

        setTimeout(() => {
            for (const file of updatedFiles) {
                this.plugin.persistentMenuManager?.refreshMenusForFile(file);
            }
        }, 350);

        if (updatedFiles.length > 0) {
            this.notifyFilesChanged(updatedFiles);
        }

        logger.flow('BulkEdit', 'apply:done', {
            files: files.length,
            changed: count,
            skippedUnsupported,
            skippedUnsafe,
            failures,
        });
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

        // Check if any files have recurrence rules (if prompting is enabled)
        if (this.plugin.settings.enableRecurrence && this.plugin.settings.promptOnRecurrenceEdit) {
            for (const file of files) {
                if (file.extension?.toLowerCase() !== 'md') continue;
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;

                if (fm && (fm.recurrenceRule || fm.recurrence)) {
                    const currentStatus = this.normalizeStatusValue(this.getWorkflowStatusValue(fm));
                    if (currentStatus === 'complete' || currentStatus === 'wont-do') continue;

                    const changeKeys = Object.keys(updates);
                    if (hasStatusUpdate) continue;

                    let changeDesc = 'updating';
                    if (changeKeys.includes('scheduled')) changeDesc = 'changing the scheduled time of';
                    else if (changeKeys.includes('priority')) changeDesc = 'changing the priority of';
                    else if (changeKeys.some(k => k.includes('tag'))) changeDesc = 'modifying tags on';

                    const result = await this.plugin.recurrenceService.promptForFrontmatterChange(file, changeDesc);

                    if (result === 'cancel') {
                        logger.flow('BulkEdit', 'frontmatter:update-canceled', {
                            files: files.length,
                            reason: 'recurrence-prompt',
                            path: file.path,
                        });
                        return 0;
                    }
                }
            }
        }

        const recurrenceStatuses = Array.isArray(this.plugin.settings.recurrenceCompletionStatuses)
            ? this.plugin.settings.recurrenceCompletionStatuses
            : ['complete', 'wont-do'];
        const recurrenceCompletionSet = new Set(
            recurrenceStatuses.map((status) => this.normalizeStatusValue(status)).filter(Boolean),
        );
        const targetStatus = hasStatusUpdate ? this.normalizeStatusValue(statusUpdateValue) : '';

        const shouldCreateRecurrenceOnStatusUpdate =
            this.plugin.settings.enableRecurrence &&
            hasStatusUpdate &&
            recurrenceCompletionSet.has(targetStatus);

        const recurrenceCandidates: Array<{ file: TFile; frontmatter: any; previousStatus: string | null }> = [];
        if (shouldCreateRecurrenceOnStatusUpdate) {
            for (const file of files) {
                if (file.extension?.toLowerCase() !== 'md') continue;
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;
                if (!fm) continue;
                const recurrenceInfo = this.resolveRecurrenceInfo(file, fm);
                if (!recurrenceInfo.rule) continue;
                if (await this.shouldSkipNoteLevelRecurrence(file, fm.scheduled)) continue;

                const rawPreviousStatus = this.getWorkflowStatusValue(fm);
                const previousStatus = this.normalizeStatusValue(rawPreviousStatus);
                if (recurrenceCompletionSet.has(previousStatus)) continue;

                recurrenceCandidates.push({
                    file,
                    frontmatter: fm,
                    previousStatus: typeof rawPreviousStatus === 'string' ? rawPreviousStatus : null,
                });
            }
        }

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

        if (count > 0 && recurrenceCandidates.length > 0) {
            for (const candidate of recurrenceCandidates) {
                const handled = await this.createNextRecurrenceInstance(
                    candidate.file,
                    candidate.frontmatter,
                    candidate.previousStatus,
                );
                if (!handled) {
                    logger.warn('[TPS GCM] Recurrence instance was not created; preserving recurrence rule on', candidate.file.path);
                }
            }
        }

        const keys = Object.keys(updates);
        if (count > 0 && keys.length > 0) {
            void this.plugin.viewModeManager?.handlePotentialFrontmatterChange(files, keys);
        }
        logger.flow('BulkEdit', 'frontmatter:update-done', {
            files: files.length,
            changed: count,
            keys: Object.keys(updates).sort(),
            status: statusUpdateValue ?? '',
            statusKey: workflowStatusKey,
            recurrenceCandidates: recurrenceCandidates.length,
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

        // Checklist Prompt Logic (Single file only to avoid spam)
        if (
            this.plugin.settings.checkOpenChecklistItems &&
            this.isChecklistCompletionStatus(status) &&
            files.length === 1 &&
            files[0].extension?.toLowerCase() === 'md'
        ) {
            const canProceed = await this.checklistHandler.handleChecklistCompletion(
                files[0],
                options.writeGuard ? () => options.writeGuard?.(files[0]) !== false : undefined,
            );
            if (!canProceed) {
                return 0;
            }
        }

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

        if (this.plugin.settings.enableRecurrence && this.plugin.settings.promptOnRecurrenceEdit) {
            for (const file of files) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;

                const workflowStatus = this.normalizeStatusValue(this.getWorkflowStatusValue(fm));
                if (fm && (fm.recurrenceRule || fm.recurrence) && workflowStatus !== 'complete' && workflowStatus !== 'wont-do') {
                    const result = await this.plugin.recurrenceService.promptForFrontmatterChange(file, `adding tag(s) "${storedTags.join(', ')}" to`);
                    if (result === 'cancel') {
                        return 0;
                    }
                    break;
                }
            }
        }

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

        if (this.plugin.settings.enableRecurrence && this.plugin.settings.promptOnRecurrenceEdit) {
            for (const file of files) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;

                const workflowStatus = this.normalizeStatusValue(this.getWorkflowStatusValue(fm));
                if (fm && (fm.recurrenceRule || fm.recurrence) && workflowStatus !== 'complete' && workflowStatus !== 'wont-do') {
                    const result = await this.plugin.recurrenceService.promptForFrontmatterChange(
                        file,
                        `adding value(s) "${values.join(', ')}" to ${key} on`
                    );
                    if (result === 'cancel') {
                        return 0;
                    }
                    break;
                }
            }
        }

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

        if (this.plugin.settings.enableRecurrence && this.plugin.settings.promptOnRecurrenceEdit) {
            for (const file of files) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;

                const workflowStatus = this.normalizeStatusValue(this.getWorkflowStatusValue(fm));
                if (fm && (fm.recurrenceRule || fm.recurrence) && workflowStatus !== 'complete' && workflowStatus !== 'wont-do') {
                    const result = await this.plugin.recurrenceService.promptForFrontmatterChange(
                        file,
                        `removing value(s) "${values.join(', ')}" from ${key} on`
                    );
                    if (result === 'cancel') {
                        return 0;
                    }
                    break;
                }
            }
        }

        return this.applyToFiles(files, (fm) => {
            const targetKey = this.findFrontmatterKeyCaseInsensitive(fm, key) || key;
            const nextValues = property?.listItemType === 'link'
                ? propertyUsesEntityOptions(property)
                    ? removeEntityReferenceListValues(fm[targetKey], values)
                    : removeLinkListValues(fm[targetKey], values)
                : propertyUsesEntityOptions(property)
                    ? removeMixedEntityReferenceListValues(fm[targetKey], values)
                    : removeStringListValues(fm[targetKey], values);
            if (nextValues.length === 0) {
                delete fm[targetKey];
            } else {
                fm[targetKey] = nextValues;
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

        if (this.plugin.settings.enableRecurrence && this.plugin.settings.promptOnRecurrenceEdit) {
            for (const file of files) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;

                const workflowStatus = this.normalizeStatusValue(this.getWorkflowStatusValue(fm));
                if (fm && (fm.recurrenceRule || fm.recurrence) && workflowStatus !== 'complete' && workflowStatus !== 'wont-do') {
                    const result = await this.plugin.recurrenceService.promptForFrontmatterChange(
                        file,
                        `removing tag(s) "${normalizedTags.map((value) => `#${value}`).join(', ')}" from`
                    );
                    if (result === 'cancel') {
                        return 0;
                    }
                    break;
                }
            }
        }

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

                this.plugin.recurrenceService?.markFileAsModified(file.path);

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

    async setRecurrence(files: TFile[], rule: string | null, endsOn?: string | null): Promise<number> {
        files = files.filter((file) => !this.plugin.filePropertiesService?.isCompanionFile(file));
        const normalizedRule = this.normalizeRecurrenceRuleValue(rule);
        const hasTemplateFolder = !!(this.plugin.settings.recurringTemplateFolder || '').trim();

        if (normalizedRule && hasTemplateFolder) {
            let count = 0;
            for (const file of files) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                if (await this.isDailyNoteRecurrenceDirectFile(file, cache?.frontmatter?.scheduled)) {
                    if (await this.applyRecurrenceDirectly(file, normalizedRule, endsOn ?? null)) {
                        count += 1;
                    }
                    continue;
                }
                if (await this.setRecurrenceUsingSeriesTemplate(file, normalizedRule, endsOn ?? null)) {
                    count += 1;
                }
            }
            return count;
        }

        const count = await this.applyToFiles(files, (fm) => {
            if (normalizedRule) {
                this.setFrontmatterValueCaseInsensitive(fm, 'recurrenceRule', normalizedRule);
                this.deleteFrontmatterValueCaseInsensitive(fm, 'recurrence');
                if (endsOn) {
                    this.setFrontmatterValueCaseInsensitive(fm, 'recurrenceEnds', endsOn);
                } else {
                    this.deleteFrontmatterValueCaseInsensitive(fm, 'recurrenceEnds');
                }
            } else {
                this.deleteFrontmatterValueCaseInsensitive(fm, 'recurrenceRule');
                this.deleteFrontmatterValueCaseInsensitive(fm, 'recurrence');
                this.deleteFrontmatterValueCaseInsensitive(fm, 'recurrenceEnds');
            }
        });

        if (normalizedRule && this.plugin.settings.enableRecurrence) {
            const recurrenceStatuses = Array.isArray(this.plugin.settings.recurrenceCompletionStatuses)
                ? this.plugin.settings.recurrenceCompletionStatuses
                : ['complete', 'wont-do'];

            for (const file of files) {
                setTimeout(async () => {
                    const cache = this.plugin.app.metadataCache.getFileCache(file);
                    const fm = cache?.frontmatter;
                    const workflowStatus = this.normalizeStatusValue(this.getWorkflowStatusValue(fm));
                    if (fm && recurrenceStatuses.includes(workflowStatus) && !(await this.shouldSkipNoteLevelRecurrence(file, fm.scheduled))) {
                        await this.createNextRecurrenceInstance(file, fm);
                    }
                }, 200);
            }

            // Copy files to recurring template folder (creates template on first set)
            await this.ensureRecurrenceTemplate(files);
        }

        return count;
    }

    private async applyRecurrenceDirectly(file: TFile, rule: string, endsOn: string | null): Promise<boolean> {
        if (this.plugin.filePropertiesService?.isCompanionFile(file)) return false;
        if (!(await this.canMutateFrontmatterSafely(file))) return false;
        await this.runSerializedFrontmatterWrite(file, async () => {
            await this.plugin.frontmatterMutationService.process(file, (fmw) => {
                this.setFrontmatterValueCaseInsensitive(fmw, 'recurrenceRule', rule);
                this.deleteFrontmatterValueCaseInsensitive(fmw, 'recurrence');
                this.deleteFrontmatterValueCaseInsensitive(fmw, 'recurrenceTemplate');
                this.clearLegacyRecurrenceTemplateMarker(fmw);
                if (endsOn) {
                    this.setFrontmatterValueCaseInsensitive(fmw, 'recurrenceEnds', endsOn);
                } else {
                    this.deleteFrontmatterValueCaseInsensitive(fmw, 'recurrenceEnds');
                }
            });
        });
        return true;
    }

    private async setRecurrenceUsingSeriesTemplate(file: TFile, rule: string, endsOn: string | null): Promise<boolean> {
        if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') return false;
        if (this.plugin.filePropertiesService?.isCompanionFile(file)) return false;

        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter || {};
        if (this.isRecurrenceTemplateFrontmatter(fm)) {
            const seriesBaseName = stripDateSuffix(file.basename).trim() || file.basename;
            if (!(await this.canMutateFrontmatterSafely(file))) return false;
            await this.runSerializedFrontmatterWrite(file, async () => {
                await this.plugin.frontmatterMutationService.process(file, (fmw) => {
                    this.markRecurrenceTemplate(fmw);
                    this.setFrontmatterValueCaseInsensitive(fmw, 'title', seriesBaseName);
                    this.setFrontmatterValueCaseInsensitive(fmw, 'recurrenceRule', rule);
                    this.deleteFrontmatterValueCaseInsensitive(fmw, 'recurrence');
                    if (endsOn) {
                        this.setFrontmatterValueCaseInsensitive(fmw, 'recurrenceEnds', endsOn);
                    } else {
                        this.deleteFrontmatterValueCaseInsensitive(fmw, 'recurrenceEnds');
                    }
                    this.deleteFrontmatterValueCaseInsensitive(fmw, 'scheduled');
                    this.deleteWorkflowStatusValue(fmw);
                    this.deleteFrontmatterValueCaseInsensitive(fmw, 'completedDate');
                });
            });
            return true;
        }

        const templateFile = await this.createOrUpdateRecurrenceTemplateFromInstance(file, fm, rule, endsOn);
        if (!(templateFile instanceof TFile)) return false;

        if (!(await this.canMutateFrontmatterSafely(file))) return false;
        const seriesBaseName = templateFile.basename;
        await this.runSerializedFrontmatterWrite(file, async () => {
            await this.plugin.frontmatterMutationService.process(file, (fmw) => {
                this.setFrontmatterValueCaseInsensitive(
                    fmw,
                    'recurrenceTemplate',
                    this.buildRecurrenceTemplateLink(templateFile, file, seriesBaseName),
                );
                this.setFrontmatterValueCaseInsensitive(fmw, 'recurrenceRule', rule);
                this.deleteFrontmatterValueCaseInsensitive(fmw, 'recurrence');
                if (endsOn) {
                    this.setFrontmatterValueCaseInsensitive(fmw, 'recurrenceEnds', endsOn);
                } else {
                    this.deleteFrontmatterValueCaseInsensitive(fmw, 'recurrenceEnds');
                }
                this.clearLegacyRecurrenceTemplateMarker(fmw);
            });
        });

        return true;
    }

    private async createOrUpdateRecurrenceTemplateFromInstance(
        file: TFile,
        frontmatter: any,
        rule: string,
        endsOn: string | null,
    ): Promise<TFile | null> {
        if (this.plugin.filePropertiesService?.isCompanionFile(file)) return null;
        const templateFolder = normalizePath((this.plugin.settings.recurringTemplateFolder || '').trim());
        if (!templateFolder) return null;

        const seriesBaseName = stripDateSuffix(file.basename).trim();
        if (!seriesBaseName) return null;

        const destFolderPath = templateFolder;
        const destFilePath = normalizePath(`${destFolderPath}/${seriesBaseName}.md`);
        if (normalizePath(file.path) === destFilePath) {
            logger.warn('[TPS GCM] Refusing to mark scheduled instance as its own recurrence template:', file.path);
            new Notice('Cannot use the scheduled note itself as its recurrence template. Move it out of the template folder or rename it with a date suffix.');
            return null;
        }

        const folderExists = await this.plugin.app.vault.adapter.exists(destFolderPath);
        if (!folderExists) {
            await this.plugin.app.vault.createFolder(destFolderPath);
        }

        let templateFile = this.plugin.app.vault.getAbstractFileByPath(destFilePath);
        if (!(templateFile instanceof TFile)) {
            const content = await this.plugin.app.vault.read(file);
            templateFile = await this.plugin.app.vault.create(destFilePath, content);
        }
        if (!(templateFile instanceof TFile)) return null;

        await this.plugin.frontmatterMutationService.process(templateFile, (fmw) => {
            this.markRecurrenceTemplate(fmw);
            this.setFrontmatterValueCaseInsensitive(fmw, 'title', seriesBaseName);
            this.setFrontmatterValueCaseInsensitive(fmw, 'recurrenceRule', rule);
            this.deleteFrontmatterValueCaseInsensitive(fmw, 'recurrence');
            if (endsOn) {
                this.setFrontmatterValueCaseInsensitive(fmw, 'recurrenceEnds', endsOn);
            } else {
                this.deleteFrontmatterValueCaseInsensitive(fmw, 'recurrenceEnds');
            }
            this.deleteFrontmatterValueCaseInsensitive(fmw, 'scheduled');
            this.deleteWorkflowStatusValue(fmw);
            this.deleteFrontmatterValueCaseInsensitive(fmw, 'completedDate');
            for (const key of Object.keys(fmw)) {
                if (['sort', 'hidden', 'icon', 'color'].includes(key.toLowerCase())) {
                    delete fmw[key];
                }
            }
        });

        logger.log(`[TPS GCM] Updated recurrence template ${templateFile.path} from ${file.path}`);
        return templateFile;
    }

    /**
     * Copies recurring event files to the recurring template folder the first time
     * a recurrence rule is set on them, if the folder is configured. The template
     * is a permanent reference copy with `recurrenceTemplate: true` in its frontmatter.
     * Instance files gain a `recurrenceTemplate` link pointing to the template.
     */
    async ensureRecurrenceTemplate(files: TFile[]): Promise<void> {
        const templateFolder = (this.plugin.settings.recurringTemplateFolder || '').trim();
        if (!templateFolder) return;

        for (const file of files) {
            if (this.plugin.filePropertiesService?.isCompanionFile(file)) continue;
            try {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;
                // Skip if this is already a template
                if (this.isRecurrenceTemplateFrontmatter(fm)) continue;
                if (await this.isDailyNoteRecurrenceDirectFile(file, fm?.scheduled)) continue;

                // Build destination path — template is named after the series (date suffix stripped)
                // so all instances of the same recurring event share one template.
                const seriesBaseName = stripDateSuffix(file.basename).trim();
                const destFolderPath = normalizePath(templateFolder);
                const destFilePath = normalizePath(`${destFolderPath}/${seriesBaseName}.md`);

                // Create folder if needed
                const folderExists = await this.plugin.app.vault.adapter.exists(destFolderPath);
                if (!folderExists) {
                    await this.plugin.app.vault.createFolder(destFolderPath);
                }

                // Skip if template already exists
                const templateExists = await this.plugin.app.vault.adapter.exists(destFilePath);
                if (templateExists) {
                    const existingTemplate = this.plugin.app.vault.getAbstractFileByPath(destFilePath);
                    // Just ensure the instance links to the series template if not already
                    if (fm && existingTemplate instanceof TFile && !this.frontmatterReferencesSeriesTemplate(fm, seriesBaseName, existingTemplate)) {
                        if (await this.canMutateFrontmatterSafely(file)) {
                            await this.runSerializedFrontmatterWrite(file, async () => {
                                await this.plugin.frontmatterMutationService.process(file, (fmw) => {
                                    this.setFrontmatterValueCaseInsensitive(
                                        fmw,
                                        'recurrenceTemplate',
                                        this.buildRecurrenceTemplateLink(existingTemplate, file, seriesBaseName),
                                    );
                                });
                            });
                        }
                    }
                    continue;
                }

                // Copy file content to template location
                const content = await this.plugin.app.vault.read(file);
                await this.plugin.app.vault.create(destFilePath, content);

                const templateFile = this.plugin.app.vault.getAbstractFileByPath(destFilePath);
                if (!(templateFile instanceof TFile)) continue;

                // Mark the template copy — strip all instance-specific fields so it
                // represents a clean "blueprint" for every future instance in this series.
                await this.plugin.frontmatterMutationService.process(templateFile, (fmw) => {
                    this.markRecurrenceTemplate(fmw);
                    // Remove fields that belong to a specific instance, not the series
                    this.deleteFrontmatterValueCaseInsensitive(fmw, 'scheduled');
                    this.deleteWorkflowStatusValue(fmw);
                    this.deleteFrontmatterValueCaseInsensitive(fmw, 'completedDate');
                    // Strip Companion display properties — recalculated fresh for each instance
                    for (const key of Object.keys(fmw)) {
                        if (['sort', 'hidden', 'icon', 'color'].includes(key.toLowerCase())) {
                            delete fmw[key];
                        }
                    }
                    // Explicitly store the recurrence rule — the copied content may not yet be
                    // flushed to disk when vault.read runs, so read it from the metadata cache.
                    const rule = fm?.recurrenceRule || fm?.recurrence;
                    if (rule) {
                        this.setFrontmatterValueCaseInsensitive(fmw, 'recurrenceRule', rule);
                        this.deleteFrontmatterValueCaseInsensitive(fmw, 'recurrence');
                    }
                });

                // Add back-link from instance to the series template
                if (await this.canMutateFrontmatterSafely(file)) {
                    await this.runSerializedFrontmatterWrite(file, async () => {
                        await this.plugin.frontmatterMutationService.process(file, (fmw) => {
                            this.setFrontmatterValueCaseInsensitive(
                                fmw,
                                'recurrenceTemplate',
                                this.buildRecurrenceTemplateLink(templateFile, file, seriesBaseName),
                            );
                        });
                    });
                }

                logger.log(`[TPS GCM] Created series template for ${file.path} at ${destFilePath}`);
                new Notice(`Recurring series template created: ${seriesBaseName}.md`);
            } catch (err) {
                logger.error(`[TPS GCM] Failed to create recurring template for ${file.path}:`, err);
            }
        }
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

    // --- Recurrence ---

    getNextOccurrence(recurrenceRule: string, currentDate?: string): Date | null {
        try {
            // Use moment to parse so date-only strings (e.g. "2026-03-02") are
            // interpreted as local midnight rather than UTC midnight. Without this,
            // in timezones behind UTC the "next" occurrence can fall on the same
            // local calendar day as the seed date.
            const startDate = currentDate
                ? window.moment(currentDate).toDate()
                : new Date();

            if (this.isEasterRecurrenceRule(recurrenceRule)) {
                return this.getNextEasterOccurrence(startDate, false);
            }

            const options = RRule.parseString(recurrenceRule);
            options.dtstart = startDate;

            const rule = new RRule(options);
            const nextDate = rule.after(startDate, false);

            return nextDate;
        } catch (error) {
            logger.error('[TPS GCM] Failed to calculate next recurrence:', error);
            return null;
        }
    }

    private isFileInRecurrenceTemplateFolder(file: TFile): boolean {
        const templateFolder = normalizePath((this.plugin.settings.recurringTemplateFolder || '').trim());
        if (!templateFolder) return false;
        const filePath = normalizePath(file.path);
        return filePath === templateFolder || filePath.startsWith(`${templateFolder}/`);
    }

    private getFirstOccurrenceFromToday(recurrenceRule: string): Date | null {
        try {
            const todayStart = window.moment().startOf('day').toDate();
            if (this.isEasterRecurrenceRule(recurrenceRule)) {
                return this.getNextEasterOccurrence(todayStart, true);
            }
            const options = RRule.parseString(recurrenceRule);
            options.dtstart = todayStart;
            const rule = new RRule(options);
            return rule.after(todayStart, true);
        } catch (error) {
            logger.error('[TPS GCM] Failed to calculate first occurrence from today:', error);
            return null;
        }
    }

    private async bootstrapTemplateInstanceFromToday(templateFile: TFile, frontmatter: any): Promise<boolean> {
        if (this.plugin.filePropertiesService?.isCompanionFile(templateFile)) return false;
        const recurrenceRule = frontmatter?.recurrenceRule || frontmatter?.recurrence;
        if (!recurrenceRule) return false;

        const seriesBaseName = stripDateSuffix(templateFile.basename).trim();
        if (!seriesBaseName) return false;

        const existingInstances = this.plugin.app.vault.getMarkdownFiles().filter((candidate) => {
            if (candidate.path === templateFile.path) return false;
            if (this.plugin.filePropertiesService?.isCompanionFile(candidate)) return false;
            const cache = this.plugin.app.metadataCache.getFileCache(candidate);
            const fm = cache?.frontmatter;
            if (!fm || this.isRecurrenceTemplateFrontmatter(fm)) return false;
            return this.frontmatterReferencesSeriesTemplate(fm, seriesBaseName, templateFile);
        });

        if (existingInstances.length > 0) {
            return false;
        }

        const firstOccurrence = this.getFirstOccurrenceFromToday(recurrenceRule);
        if (!firstOccurrence) return false;

        const dateStr = window.moment(firstOccurrence).format(this.getDailyNoteDateFormat());
        const newFileName = `${seriesBaseName} ${dateStr}.md`;
        const parentPath = templateFile.parent?.path || '';
        const newFilePath = normalizePath(parentPath ? `${parentPath}/${newFileName}` : newFileName);

        const exists = this.plugin.app.vault.getAbstractFileByPath(newFilePath);
        if (exists instanceof TFile) {
            return false;
        }

        const content = await this.readRecurrenceInstanceSource(
            templateFile,
            'recurrence-template bootstrap',
        );
        if (content === null) return false;
        const created = await this.plugin.app.vault.create(newFilePath, content);
        if (!(created instanceof TFile)) return false;

        const scheduled = window.moment(firstOccurrence).format('YYYY-MM-DD HH:mm:ss');
        await this.plugin.frontmatterMutationService.process(created, (fmw) => {
            removeTemplateProtectionTagFromFrontmatter(fmw, this.plugin.settings);
            this.setFrontmatterValueCaseInsensitive(fmw, 'scheduled', scheduled);
            this.setFrontmatterValueCaseInsensitive(
                fmw,
                'recurrenceTemplate',
                this.buildRecurrenceTemplateLink(templateFile, created, seriesBaseName),
            );
            this.clearLegacyRecurrenceTemplateMarker(fmw);
            this.deleteFrontmatterValueCaseInsensitive(fmw, 'completedDate');
            this.deleteWorkflowStatusValue(fmw);
        });

        if (!(await this.isVerifiedRecurrenceInstance(created, 'recurrence-template bootstrap'))) {
            return false;
        }

        logger.log(`[TPS GCM] Bootstrapped recurring series from template ${templateFile.path} -> ${created.path}`);
        return true;
    }

    private advanceOccurrenceToFuture(recurrenceRule: string, seedDate: string | undefined): Date | null {
        const now = new Date();
        let nextDate = this.getNextOccurrence(recurrenceRule, seedDate);
        if (!nextDate) return null;

        // If the next computed recurrence is still in the past, keep advancing until
        // we land on a future instance. This prevents startup/device-open scans from
        // creating historical "open" notes that can retrigger reminders.
        let guard = 0;
        while (nextDate && nextDate <= now && guard < 500) {
            nextDate = this.getNextOccurrence(recurrenceRule, nextDate.toISOString());
            guard += 1;
        }

        if (guard >= 500) {
            logger.warn('[TPS GCM] Recurrence advance guard reached while seeking future occurrence');
        }

        return nextDate;
    }

    getNextRecurrenceOccurrence(recurrenceRule: string, seedDate?: string): Date | null {
        return this.advanceOccurrenceToFuture(recurrenceRule, seedDate);
    }

    async createNextRecurrenceInstance(file: TFile, frontmatter: any, carryStatus?: string | null): Promise<boolean> {
        if (this.plugin.filePropertiesService?.isCompanionFile(file)) return false;
        if (!(await canAutomaticallyMutateTemplateFile(this.plugin.app.vault, file, this.plugin.settings))) {
            logger.warn('[TPS GCM] Skipping automatic recurrence creation for an excluded or unverifiable source:', file.path);
            return false;
        }
        if (this.recurrenceCreationInProgress.has(file.path)) {
            logger.warn('[TPS GCM] Recurrence creation already in progress:', file.path);
            return true;
        }

        this.recurrenceCreationInProgress.add(file.path);

        try {
            const recurrenceInfo = this.resolveRecurrenceInfo(file, frontmatter);
            const recurrenceRule = recurrenceInfo.rule;
            if (!recurrenceRule) return false;

            const currentScheduled = frontmatter.scheduled;
            if (await this.shouldSkipNoteLevelRecurrence(file, currentScheduled)) {
                logger.warn('[TPS GCM] Skipping note-level recurrence creation for configured daily note:', file.path);
                if (
                    String(this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceRule') ?? '').trim().toLowerCase() === 'dailynote'
                    && await this.canMutateFrontmatterSafely(file)
                ) {
                    await this.applyRecurrenceDirectly(file, this.dailyRecurrenceRule, null);
                }
                return false;
            }

            const isTrackerRecurrence = this.isTrackerRecurrenceRule(recurrenceRule);
            const nextDate = isTrackerRecurrence
                ? null
                : this.advanceOccurrenceToFuture(recurrenceRule, currentScheduled);

            if (!isTrackerRecurrence && !nextDate) {
                logger.warn('[TPS GCM] Could not calculate next recurrence date for', file.path, '- rule:', recurrenceRule, 'scheduled:', currentScheduled);
                new Notice('Could not calculate next recurrence date. Recurrence rule preserved.');
                return false;
            }

            const baseName = recurrenceInfo.seriesBaseName || stripDateSuffix(file.basename);

            // Prefer the series template as the content source so each new instance
            // starts from a clean blueprint rather than cloning the completing file.
            const recurrenceTemplateFolderSetting = (this.plugin.settings.recurringTemplateFolder || '').trim();
            let contentSource: TFile = file;
            let seriesTemplateFile: TFile | null = recurrenceInfo.templateFile;
            if (seriesTemplateFile instanceof TFile) {
                contentSource = seriesTemplateFile;
                logger.log('[TPS GCM] Using linked series template for next recurrence instance:', seriesTemplateFile.path);
            } else if (recurrenceTemplateFolderSetting) {
                const templatePath = normalizePath(`${recurrenceTemplateFolderSetting}/${baseName}.md`);
                const existingTemplate = this.plugin.app.vault.getAbstractFileByPath(templatePath);
                if (existingTemplate instanceof TFile) {
                    seriesTemplateFile = existingTemplate;
                    contentSource = seriesTemplateFile;
                    logger.log('[TPS GCM] Using series template for next recurrence instance:', templatePath);
                } else {
                    logger.log('[TPS GCM] No series template found at', templatePath, '— creating/relinking template now');
                    await this.ensureRecurrenceTemplate([file]);
                    const createdTemplate = this.plugin.app.vault.getAbstractFileByPath(templatePath);
                    if (createdTemplate instanceof TFile) {
                        seriesTemplateFile = createdTemplate;
                        contentSource = seriesTemplateFile;
                    } else {
                        logger.log('[TPS GCM] Template still missing after ensureRecurrenceTemplate, cloning completing instance instead');
                    }
                }
            }

            // Capture and sanitize the clone bytes before acquiring the durable
            // generation lock. Unsafe YAML fails closed without creating either a
            // note or recurrence operation state, while a series template remains
            // read-only and contributes an untagged instance body.
            if (!(await canAutomaticallyMutateTemplateFile(this.plugin.app.vault, file, this.plugin.settings))) {
                logger.warn('[TPS GCM] Recurrence source became excluded or unverifiable before instance creation:', file.path);
                return false;
            }
            const content = await this.readRecurrenceInstanceSource(
                contentSource,
                'recurrence instance creation',
            );
            if (content === null) return false;

            const chainId = this.resolveRecurrenceChainId(file, frontmatter, recurrenceRule);
            const parentPath = file.parent?.path || '';
            const trackerGeneratedPath = isTrackerRecurrence ? this.getGeneratedTrackerPath(frontmatter) : null;
            if (trackerGeneratedPath && await this.plugin.app.vault.adapter.exists(trackerGeneratedPath)) {
                return await this.isVerifiedRecurrenceInstancePath(
                    trackerGeneratedPath,
                    'existing tracker recurrence',
                );
            }

            const dateStr = nextDate ? window.moment(nextDate).format(this.getDailyNoteDateFormat()) : '';
            const newFileName = isTrackerRecurrence
                ? (await this.getAvailableUndatedRecurrencePath(parentPath, baseName)).name
                : `${baseName} ${dateStr}.md`;
            const newFilePath = isTrackerRecurrence
                ? normalizePath(parentPath ? `${parentPath}/${newFileName}` : newFileName)
                : normalizePath(parentPath ? `${parentPath}/${newFileName}` : newFileName);
            const newScheduled = nextDate ? window.moment(nextDate).format('YYYY-MM-DD HH:mm:ss') : this.buildTrackerGeneratedValue(newFilePath);
            if (!isTrackerRecurrence && this.hasGeneratedRecurrence(frontmatter, newScheduled) && await this.plugin.app.vault.adapter.exists(newFilePath)) {
                return await this.isVerifiedRecurrenceInstancePath(
                    newFilePath,
                    'existing recurrence',
                );
            }
            const recurrenceOpKey = this.buildRecurrenceOpKey(chainId, newScheduled);

            const opStatus = await this.beginRecurrenceOp(recurrenceOpKey, newFilePath);
            if (opStatus !== 'acquired') {
                const opTarget = this.getRecurrenceOpTarget(recurrenceOpKey);
                if (opTarget && await this.plugin.app.vault.adapter.exists(opTarget)) {
                    if (!(await this.isVerifiedRecurrenceInstancePath(opTarget, 'existing recurrence'))) {
                        return false;
                    }
                    logger.log('[TPS GCM] Next recurrence already created at', opTarget);
                    await this.markRecurrenceGenerated(file, newScheduled);
                    return true;
                }
                if (await this.plugin.app.vault.adapter.exists(newFilePath)) {
                    if (!(await this.isVerifiedRecurrenceInstancePath(newFilePath, 'existing recurrence'))) {
                        return false;
                    }
                    logger.log('[TPS GCM] Next recurrence already exists at', newFilePath);
                    await this.completeRecurrenceOp(recurrenceOpKey, newFilePath);
                    await this.markRecurrenceGenerated(file, newScheduled);
                    return true;
                }
                // Another device/process is likely creating this recurrence.
                logger.log('[TPS GCM] Recurrence operation already in flight for', newFilePath, '- status:', opStatus);
                return true;
            }

            if (await this.plugin.app.vault.adapter.exists(newFilePath)) {
                if (!(await this.isVerifiedRecurrenceInstancePath(newFilePath, 'existing recurrence'))) {
                    await this.failRecurrenceOp(recurrenceOpKey);
                    return false;
                }
                logger.warn('[TPS GCM] Next recurrence already exists, skipping creation:', newFilePath);
                await this.completeRecurrenceOp(recurrenceOpKey, newFilePath);
                await this.markRecurrenceGenerated(file, newScheduled);
                new Notice(`Next recurrence already exists: ${newFileName}`);
                return true;
            }

            const newFile = await this.plugin.app.vault.create(newFilePath, content);

            if (!(newFile instanceof TFile)) {
                logger.error('[TPS GCM] Could not get newly created file');
                return false;
            }

            // Only use a configured default status — never fall back to a hardcoded value.
            // If the setting is empty the new instance inherits whatever the template had
            // (or nothing, if the template has no status field).
            const newStatus = (this.plugin.settings.recurrenceDefaultStatus || '').trim();

            // Validate inputs before writing to frontmatter
            if (!isTrackerRecurrence && (!newScheduled || typeof newScheduled !== 'string')) {
                throw new Error(`Invalid scheduled value: ${newScheduled}`);
            }
            if (!baseName || typeof baseName !== 'string' || baseName.length > 255) {
                throw new Error(`Invalid title value: ${baseName}`);
            }

            await this.plugin.frontmatterMutationService.process(newFile, (fm) => {
                removeTemplateProtectionTagFromFrontmatter(fm, this.plugin.settings);
                if (isTrackerRecurrence) {
                    this.deleteFrontmatterValueCaseInsensitive(fm, 'scheduled');
                } else {
                    this.setFrontmatterValueCaseInsensitive(fm, 'scheduled', newScheduled);
                }
                // Only write status if a default was explicitly configured
                if (newStatus) {
                    this.setWorkflowStatusValue(fm, newStatus);
                } else {
                    // Ensure no stale status is inherited from the template file content
                    this.deleteWorkflowStatusValue(fm);
                }

                // Restore the recurrenceTemplate back-link (may be absent if content
                // was read from the series template which intentionally omits it).
                if (recurrenceTemplateFolderSetting && seriesTemplateFile instanceof TFile) {
                    this.setFrontmatterValueCaseInsensitive(
                        fm,
                        'recurrenceTemplate',
                        this.buildRecurrenceTemplateLink(seriesTemplateFile, newFile, baseName),
                    );
                    this.setFrontmatterValueCaseInsensitive(fm, 'recurrenceRule', recurrenceRule);
                    this.deleteFrontmatterValueCaseInsensitive(fm, 'recurrence');
                }

                // Strip all stale/computed fields so the new instance starts clean.
                for (const key of Object.keys(fm)) {
                    if ([
                        'sort',
                        'hidden',
                        'icon',
                        'color',
                        'isrecurrencetemplate',
                        'completeddate',
                        'endedat',
                        'durationseconds',
                        'previouscompleteddate',
                        'secondssincepreviouscompletion',
                        'lastcompleteddate',
                        'lastsessionpath',
                        'nextelegibledate',
                        this.recurrenceLastGeneratedKey.toLowerCase(),
                    ].includes(key.toLowerCase())) {
                        delete fm[key];
                    }
                }
            });

            if (!(await this.isVerifiedRecurrenceInstance(newFile, 'recurrence instance creation'))) {
                await this.failRecurrenceOp(recurrenceOpKey);
                return false;
            }

            await this.completeRecurrenceOp(recurrenceOpKey, newFilePath);
            await this.markRecurrenceGenerated(file, newScheduled);

            new Notice(isTrackerRecurrence ? `Created next tracker: ${newFileName}` : `Created next recurrence: ${newFileName}`);
            return true;
        } catch (error) {
            const recurrenceInfo = this.resolveRecurrenceInfo(file, frontmatter);
            const recurrenceRule = recurrenceInfo.rule;
            const currentScheduled = frontmatter?.scheduled;
            const nextDate = recurrenceRule ? this.advanceOccurrenceToFuture(recurrenceRule, currentScheduled) : null;
            if (nextDate && recurrenceRule) {
                const chainId = this.resolveRecurrenceChainId(file, frontmatter, recurrenceRule);
                const newScheduled = window.moment(nextDate).format('YYYY-MM-DD HH:mm:ss');
                const recurrenceOpKey = this.buildRecurrenceOpKey(chainId, newScheduled);
                await this.failRecurrenceOp(recurrenceOpKey);
            }
            logger.error('[TPS GCM] Failed to create next recurrence instance for', file.path, ':', error);
            logger.error('[TPS GCM] Error details - Rule:', recurrenceRule, 'Scheduled:', currentScheduled, 'Error type:', error instanceof Error ? error.constructor.name : typeof error);
            if (error instanceof Error && error.stack) {
                logger.error('[TPS GCM] Stack trace:', error.stack);
            }
            new Notice(`Failed to create next recurrence instance. Check console for details.`);
            return false;
        } finally {
            this.recurrenceCreationInProgress.delete(file.path);
        }
    }

    /**
     * Propagate changes from an edited series template to all open (non-completed)
     * instances that reference it via `recurrenceTemplate: [[SeriesName]]`.
     *
     * Only fields that belong to the series (not the individual instance) are copied.
     * Instance-specific fields such as scheduled, status, completedDate, sort, icon,
     * color, dateCreated, dateModified, and the template meta-fields are never touched.
     */
    async applyTemplateToOpenInstances(templateFile: TFile): Promise<number> {
        if (this.plugin.filePropertiesService?.isCompanionFile(templateFile)) return 0;
        const templateCache = this.plugin.app.metadataCache.getFileCache(templateFile);
        const templateFm = templateCache?.frontmatter;
        if (!templateFm) return 0;

        const seriesName = templateFile.basename.toLowerCase();

        // Fields that must NEVER be copied from the template to instances
        const SKIP_KEYS = new Set([
            'isrecurrencetemplate', 'recurrencestarted', 'recurrenceends',
            'recurrencetemplate', 'scheduled', 'completeddate',
            'sort', 'icon', 'color', 'hidden', 'datecreated', 'datemodified',
            'startedat', 'endedat', 'durationseconds', 'timeestimate',
            'previouscompleteddate', 'secondssincepreviouscompletion',
            'lastcompleteddate', 'lastsessionpath', 'nextelegibledate',
        ]);
        SKIP_KEYS.add(this.getWorkflowStatusKey().toLowerCase());

        // Build propagatable update set from the template's frontmatter. A source
        // template marker identifies the blueprint itself and never propagates to
        // its instances; every other user tag remains eligible for propagation.
        const propagatableFrontmatter: Record<string, any> = { ...templateFm };
        removeTemplateProtectionTagFromFrontmatter(propagatableFrontmatter, this.plugin.settings);
        const updates: Record<string, any> = {};
        for (const [key, value] of Object.entries(propagatableFrontmatter)) {
            if (!SKIP_KEYS.has(key.toLowerCase())) {
                updates[key] = value;
            }
        }
        if (Object.keys(updates).length === 0) return 0;

        // Completion statuses — instances in these states are skipped
        const completionSet = new Set(
            (Array.isArray(this.plugin.settings.recurrenceCompletionStatuses)
                ? this.plugin.settings.recurrenceCompletionStatuses
                : ['complete', 'wont-do']
            ).map((s: string) => s.trim().toLowerCase())
        );

        // Find all open instances that reference this series template
        const openInstances: TFile[] = [];
        for (const file of this.plugin.app.vault.getMarkdownFiles()) {
            if (file.path === templateFile.path) continue;
            if (this.plugin.filePropertiesService?.isCompanionFile(file)) continue;

            const cache = this.plugin.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            if (!fm) continue;

            // Check recurrenceTemplate link — value may be wikilink format [[Name]]
            if (!this.frontmatterReferencesSeriesTemplate(fm, seriesName, templateFile)) continue;

            // Skip completed/wont-do instances
            const status = this.normalizeStatusValue(this.getWorkflowStatusValue(fm));
            if (completionSet.has(status)) continue;

            openInstances.push(file);
        }

        if (openInstances.length === 0) return 0;

        return this.applyToFiles(openInstances, (fm) => {
            for (const [key, value] of Object.entries(updates)) {
                if (value === null || value === undefined) {
                    this.deleteFrontmatterValueCaseInsensitive(fm, key);
                } else {
                    this.setFrontmatterValueCaseInsensitive(fm, key, value);
                }
            }
        });
    }

    async checkMissingRecurrences(): Promise<void> {
        if (this.checkMissingRecurrencesRunning) return;
        if (!this.plugin.settings.enableRecurrence) return;

        this.checkMissingRecurrencesRunning = true;
        try {
            const files = this.plugin.app.vault.getMarkdownFiles()
                .filter((file) => !this.plugin.filePropertiesService?.isCompanionFile(file));
            let createdCount = 0;

            const recurrenceStatuses = (Array.isArray(this.plugin.settings.recurrenceCompletionStatuses)
                ? this.plugin.settings.recurrenceCompletionStatuses
                : ['complete', 'wont-do']
            ).map((s: string) => s.trim().toLowerCase());

            // Collect active recurring notes that are missing a series template
            const needsTemplate: TFile[] = [];
            const needsRelink: Array<{ file: TFile; templateFile: TFile; seriesBaseName: string }> = [];

            for (const file of files) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;

                if (!fm) continue;

                // Classify template identity from current bytes for the narrow
                // recurrence-blueprint bootstrap path. Identity alone does not
                // grant automatic-write protection; those mutation boundaries
                // use the explicit Global auto-write exclusions below.
                let templateProtectionState: ReturnType<typeof inspectTemplateProtectionSource>;
                try {
                    const source = await this.plugin.app.vault.read(file);
                    templateProtectionState = inspectTemplateProtectionSource(source, this.plugin.settings);
                } catch (error) {
                    logger.warn('[TPS GCM] Skipping startup recurrence check because current source could not be read', {
                        file: file.path,
                        error,
                    });
                    continue;
                }
                const recurrenceInfo = this.resolveRecurrenceInfo(file, fm);
                if (!recurrenceInfo.rule) continue;

                const isRecurrenceTemplateCandidate = this.isFileInRecurrenceTemplateFolder(file)
                    && (this.isRecurrenceTemplateFrontmatter(fm) || !fm.scheduled);

                if (templateProtectionState === 'unsafe') {
                    logger.warn('[TPS GCM] Skipping startup recurrence check for unsafe frontmatter', {
                        file: file.path,
                    });
                    continue;
                }

                if (isRecurrenceTemplateCandidate && templateProtectionState === 'protected') {
                    // An identified recurrence blueprint may be read solely to
                    // bootstrap its first instance. This is template selection,
                    // not an implicit prohibition on unrelated note mutations.
                    if (
                        !(await this.isConfiguredDailyNoteTemplate(file))
                        && !(await this.shouldSkipNoteLevelRecurrence(file, fm.scheduled))
                    ) {
                        const bootstrapped = await this.bootstrapTemplateInstanceFromToday(file, fm);
                        if (bootstrapped) createdCount++;
                    }
                    continue;
                }

                if (await this.isConfiguredDailyNoteTemplate(file)) continue;
                if (await this.shouldSkipNoteLevelRecurrence(file, fm.scheduled)) continue;

                if (isRecurrenceTemplateCandidate) {
                    if (!this.isRecurrenceTemplateFrontmatter(fm)) {
                        if (
                            await canAutomaticallyMutateTemplateFile(this.plugin.app.vault, file, this.plugin.settings)
                            && await this.canMutateFrontmatterSafely(file)
                        ) {
                            await this.runSerializedFrontmatterWrite(file, async () => {
                                await this.plugin.frontmatterMutationService.process(file, (fmw) => {
                                    if (!canAutomaticallyMutateTemplateFrontmatter(fmw, this.plugin.settings)) return;
                                    this.markRecurrenceTemplate(fmw);
                                    this.deleteFrontmatterValueCaseInsensitive(fmw, 'scheduled');
                                    this.deleteWorkflowStatusValue(fmw);
                                    this.deleteFrontmatterValueCaseInsensitive(fmw, 'completedDate');
                                });
                            });
                        }
                    }
                    const bootstrapped = await this.bootstrapTemplateInstanceFromToday(file, fm);
                    if (bootstrapped) {
                        createdCount++;
                    }
                    continue;
                }

                // Skip template files themselves
                if (this.isRecurrenceTemplateFrontmatter(fm)) continue;

                const isCompleted = recurrenceStatuses.includes(
                    this.normalizeStatusValue(this.getWorkflowStatusValue(fm))
                );

                if (isCompleted) {
                    const handled = await this.createNextRecurrenceInstance(file, fm);
                    if (handled) {
                        createdCount++;
                    }
                } else {
                    // Active instance — check if its series template is missing
                    const templateFolderSetting = (this.plugin.settings.recurringTemplateFolder || '').trim();
                    if (templateFolderSetting) {
                        if (await this.isConfiguredDailyNote(file, fm.scheduled)) continue;
                        const seriesBaseName = recurrenceInfo.seriesBaseName || stripDateSuffix(file.basename).trim();
                        const templatePath = normalizePath(`${templateFolderSetting}/${seriesBaseName}.md`);
                        const templateEntry = recurrenceInfo.templateFile || this.plugin.app.vault.getAbstractFileByPath(templatePath);
                        if (!(templateEntry instanceof TFile)) {
                            needsTemplate.push(file);
                        } else if (!this.frontmatterReferencesSeriesTemplate(fm, seriesBaseName, templateEntry)) {
                            needsRelink.push({ file, templateFile: templateEntry, seriesBaseName });
                        }
                    }
                }
            }

            if (createdCount > 0) {
                logger.log(`[TPS GCM] Healed ${createdCount} recurring event chains.`);
            }

            // Create any missing series templates (deduped by series name)
            if (needsTemplate.length > 0) {
                const seen = new Set<string>();
                const deduped = needsTemplate.filter(f => {
                    const key = stripDateSuffix(f.basename).trim().toLowerCase();
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                for (const file of deduped) {
                    if (!(await canAutomaticallyMutateTemplateFile(this.plugin.app.vault, file, this.plugin.settings))) continue;
                    const cache = this.plugin.app.metadataCache.getFileCache(file);
                    const fm = cache?.frontmatter;
                    if (await this.isDailyNoteRecurrenceDirectFile(file, fm?.scheduled)) continue;
                    const recurrenceInfo = this.resolveRecurrenceInfo(file, fm);
                    if (recurrenceInfo.rule) {
                        const endsOn = String(this.getFrontmatterValueCaseInsensitive(fm, 'recurrenceEnds') || '').trim() || null;
                        await this.setRecurrenceUsingSeriesTemplate(file, recurrenceInfo.rule, endsOn);
                    }
                }
                logger.log(`[TPS GCM] Created ${deduped.length} missing series template(s).`);
            }

            if (needsRelink.length > 0) {
                for (const row of needsRelink) {
                    const { file, templateFile, seriesBaseName } = row;
                    if (!(await canAutomaticallyMutateTemplateFile(this.plugin.app.vault, file, this.plugin.settings))) continue;
                    if (!(await this.canMutateFrontmatterSafely(file))) continue;
                    await this.runSerializedFrontmatterWrite(file, async () => {
                        await this.plugin.frontmatterMutationService.process(file, (fmw) => {
                            if (!canAutomaticallyMutateTemplateFrontmatter(fmw, this.plugin.settings)) return;
                            this.setFrontmatterValueCaseInsensitive(
                                fmw,
                                'recurrenceTemplate',
                                this.buildRecurrenceTemplateLink(templateFile, file, seriesBaseName),
                            );
                        });
                    });
                }
                logger.log(`[TPS GCM] Relinked ${needsRelink.length} recurrence instance(s) to series templates.`);
            }
        } finally {
            this.checkMissingRecurrencesRunning = false;
        }
    }

    async clearRecurrenceRule(file: TFile): Promise<void> {
        if (!(await this.canMutateFrontmatterSafely(file))) return;
        await this.runSerializedFrontmatterWrite(file, async () => {
            await this.plugin.frontmatterMutationService.process(file, (fm) => {
                this.deleteFrontmatterValueCaseInsensitive(fm, 'recurrenceRule');
                this.deleteFrontmatterValueCaseInsensitive(fm, 'recurrence');
            });
        });
    }

    // --- Link operations (delegated to parent-link-handler) ---

    private async tagParentsForLinkedChildren(parentFiles: TFile[]): Promise<void> {
        const parentTags = parseTagInput(this.plugin.settings.parentTagOnChildLink || '');
        if (!parentTags.length) return;

        const dedupedParents = Array.from(
            new Map(
                parentFiles
                    .filter((file): file is TFile => file instanceof TFile)
                    .map((file) => [file.path, file]),
            ).values(),
        );

        if (!dedupedParents.length) return;

        const updatedFiles: TFile[] = [];

        await runInBatches(dedupedParents, async (parentFile) => {
            try {
                if (parentFile.extension?.toLowerCase() !== 'md') return;
                if (!(await this.canMutateFrontmatterSafely(parentFile))) return;

                let didChange = false;
                await this.runSerializedFrontmatterWrite(parentFile, async () => {
                    await this.plugin.frontmatterMutationService.process(parentFile, (fm) => {
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
                });

                if (didChange) {
                    updatedFiles.push(parentFile);
                }
            } catch (error) {
                logger.error(`[TPS GCM] Failed tagging parent ${parentFile.path} after child link:`, error);
            }
        }, 20);

        if (!updatedFiles.length) return;

        setTimeout(() => {
            for (const file of updatedFiles) {
                this.plugin.persistentMenuManager?.refreshMenusForFile(file);
            }
        }, 200);

        this.notifyFilesChanged(updatedFiles);
        void this.plugin.viewModeManager?.handlePotentialFrontmatterChange(updatedFiles, ['tags']);
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
            if (this.plugin.settings.autoSaveFolderPath) {
                await this.plugin.frontmatterMutationService.process(file, (fm) => {
                    this.setFrontmatterValueCaseInsensitive(fm as Record<string, any>, 'folderPath', file.parent?.path || '/');
                });
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
            void this.plugin.viewModeManager?.handlePotentialFrontmatterChange(affected, [parentKey, 'tags']);
        }
        return count;
    }

    async linkChildren(currentFile: TFile, childFiles: TFile[]): Promise<number> {
        return this.linkToParent(childFiles, currentFile);
    }

    async reconcileParentChildLinksForParent(parentFile: TFile): Promise<number> {
        const result = await this.plugin.subitemRelationshipSyncService.reconcileMarkdownParent(parentFile);
        const touched = [parentFile, ...result.touchedChildren];
        if (touched.length > 0) {
            const parentKey = this.parentLinkHandler.normalizeParentKey();
            setTimeout(() => touched.forEach((file) => this.plugin.persistentMenuManager?.refreshMenusForFile(file)), 200);
            this.notifyFilesChanged(touched);
            void this.plugin.viewModeManager?.handlePotentialFrontmatterChange(touched, [parentKey]);
        }
        return result.addedParents + result.removedParents;
    }

    async ensureParentSelfLinkForParent(parentFile: TFile): Promise<boolean> {
        if (!(parentFile instanceof TFile) || parentFile.extension?.toLowerCase() !== 'md') {
            return false;
        }
        if (this.plugin.parentLinkResolutionService.isIgnoredFile(parentFile)) return false;
        const parentKey = this.parentLinkHandler.normalizeParentKey();
        const changed = await this.ensureParentSelfLink(parentFile, parentKey);
        if (!changed) {
            return false;
        }
        setTimeout(() => this.plugin.persistentMenuManager?.refreshMenusForFile(parentFile), 200);
        this.notifyFilesChanged([parentFile]);
        void this.plugin.viewModeManager?.handlePotentialFrontmatterChange([parentFile], [parentKey]);
        return true;
    }

    private async ensureParentSelfLink(
        parentFile: TFile,
        parentKey: string,
    ): Promise<boolean> {
        if (!this.plugin.settings.autoSelfLinkParentInParentKey) {
            return false;
        }
        if (!(await this.canMutateFrontmatterSafely(parentFile))) {
            return false;
        }
        let changed = false;
        await this.runSerializedFrontmatterWrite(parentFile, async () => {
            await this.plugin.frontmatterMutationService.process(parentFile, (fm) => {
                if (this.plugin.parentLinkResolutionService.isIgnoredFrontmatter(fm as Record<string, unknown>)) return;
                const existingKey = this.findFrontmatterKeyCaseInsensitive(fm, parentKey);
                const existingRaw = existingKey ? fm[existingKey] : undefined;
                const currentValues: string[] = [];
                if (Array.isArray(existingRaw)) {
                    currentValues.push(...existingRaw.map(String).map((v) => v.trim()).filter(Boolean));
                } else if (existingRaw != null && String(existingRaw).trim()) {
                    currentValues.push(String(existingRaw).trim());
                }

                const selfLink = buildParentFrontmatterLinkValue(this.plugin.app, parentFile, parentFile.path);
                const hasSelf = currentValues.some((value) =>
                    linkValueMatchesFile(this.plugin.app, value, parentFile.path, parentFile),
                );
                const normalizedValues = currentValues.map((value) => {
                    const resolved = resolveLinkValueToFile(this.plugin.app, value, parentFile.path);
                    return resolved instanceof TFile
                        ? buildParentFrontmatterLinkValue(this.plugin.app, resolved, parentFile.path)
                        : String(value || '').trim();
                }).filter(Boolean);
                if (!hasSelf) {
                    normalizedValues.push(selfLink);
                }
                const dedupedValues: string[] = [];
                const seen = new Set<string>();
                for (const value of normalizedValues) {
                    const key = String(value || '').trim().toLowerCase();
                    if (!key || seen.has(key)) continue;
                    seen.add(key);
                    dedupedValues.push(value);
                }
                const unchanged = Array.isArray(existingRaw)
                    && currentValues.length === dedupedValues.length
                    && currentValues.every((value, index) => value === dedupedValues[index]);
                if (hasSelf && unchanged && existingKey === parentKey) {
                    return;
                }
                this.setFrontmatterValueCaseInsensitive(
                    fm,
                    parentKey,
                    dedupedValues,
                );
                changed = true;
            });
        });
        return changed;
    }

    private resolveLinkedFilesFromFrontmatterValue(value: unknown, sourcePath: string): TFile[] {
        const values = Array.isArray(value) ? value : (value != null ? [value] : []);
        const files: TFile[] = [];
        const seen = new Set<string>();
        for (const raw of values) {
            const file = resolveLinkValueToFile(this.plugin.app, raw, sourcePath);
            if (!(file instanceof TFile)) continue;
            if (seen.has(file.path)) continue;
            seen.add(file.path);
            files.push(file);
        }
        return files;
    }

    private async removeChildFromParentReverseList(parentFile: TFile, childFile: TFile, childKey: string): Promise<boolean> {
        if (!(await this.canMutateFrontmatterSafely(parentFile))) return false;
        let changed = false;
        await this.runSerializedFrontmatterWrite(parentFile, async () => {
            await this.plugin.frontmatterMutationService.process(parentFile, (fm) => {
                const key = Object.keys(fm).find((k) => k.toLowerCase() === childKey.toLowerCase());
                if (!key) return;
                const raw = fm[key];
                const arr: any[] = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
                const filtered = arr.filter((v: any) => !linkValueMatchesFile(this.plugin.app, v, parentFile.path, childFile));
                if (filtered.length === arr.length) return;
                changed = true;
                if (filtered.length === 0) {
                    delete fm[key];
                } else {
                    fm[key] = filtered;
                }
            });
        });
        return changed;
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
            this.plugin.recurrenceService?.markFileAsModified(currentFile.path);
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
            void this.plugin.viewModeManager?.handlePotentialFrontmatterChange([currentFile], []);
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
            void this.plugin.viewModeManager?.handlePotentialFrontmatterChange(updatedFiles, [key]);
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
        void this.plugin.viewModeManager?.handlePotentialFrontmatterChange(changedFiles, [parentKey]);
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
        void this.plugin.viewModeManager?.handlePotentialFrontmatterChange([childFile], [parentKey]);
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

    /**
     * Scans every logical property target and removes stale
     * parent/child/attachment links that pointed to the deleted file. Markdown
     * body links remain a Markdown-only cleanup surface.
     */
    async cleanupLinksForDeletedFile(deletedPath: string): Promise<{
        scannedFiles: number;
        touchedFiles: number;
        removedReferences: number;
        preservedAmbiguousReferences: number;
    }> {
        const queuedBehind = this.deletedLinkCleanupPending;
        this.deletedLinkCleanupPending += 1;
        if (queuedBehind > 0) {
            logger.flow('DeletedLinkCleanup', 'queued', { deletedPath, queuedBehind });
        }

        const run = this.deletedLinkCleanupChain
            .catch(() => undefined)
            .then(() => this.runDeletedLinkCleanup(deletedPath));
        const tracked = run.finally(() => {
            this.deletedLinkCleanupPending = Math.max(0, this.deletedLinkCleanupPending - 1);
        });
        this.deletedLinkCleanupChain = tracked.then(() => undefined, () => undefined);
        return tracked;
    }

    private async runDeletedLinkCleanup(deletedPath: string): Promise<{
        scannedFiles: number;
        touchedFiles: number;
        removedReferences: number;
        preservedAmbiguousReferences: number;
    }> {
        const parentKey = String(this.plugin.settings.parentLinkFrontmatterKey || 'childOf').trim() || 'childOf';
        const parentKeys = Array.from(new Set([parentKey, 'parents', 'parent', 'childOf'].map((key) => key.toLowerCase())));
        const attachmentsKey = 'attachments';
        const normalizedDeletedPath = normalizePath(deletedPath).toLowerCase();
        const files = this.plugin.parentLinkResolutionService
            .getRelationshipCandidates({ includeIgnored: true })
            .filter((file) => (
                normalizePath(file.path).toLowerCase() !== normalizedDeletedPath
                && !this.plugin.filePropertiesService?.isCompanionFile(file)
            ));
        const matchContext = createDeletedMarkdownLinkContext(deletedPath, files.map((file) => file.path));
        const emptyResult = {
            scannedFiles: files.length,
            touchedFiles: 0,
            removedReferences: 0,
            preservedAmbiguousReferences: 0,
        };
        if (!matchContext) {
            logger.flowWarn('DeletedLinkCleanup', 'skip:invalid-path', { deletedPath });
            return emptyResult;
        }
        const removedReferenceKeys = new Set<string>();
        const ambiguousReferenceKeys = new Set<string>();

        const isMatch = (linkValue: unknown, sourcePath: string, pendingRemovedReferences: Set<string>): boolean => {
            const resolvedFile = resolveLinkValueToFile(this.plugin.app, linkValue, sourcePath);
            const liveResolvedFile = resolvedFile
                ? this.plugin.app.vault.getAbstractFileByPath(resolvedFile.path)
                : null;
            if (
                liveResolvedFile instanceof TFile
                && normalizePath(resolvedFile.path).toLowerCase() !== normalizedDeletedPath
            ) {
                return false;
            }
            const decision = classifyDeletedMarkdownLink(linkValue, sourcePath, matchContext);
            const referenceKey = `${sourcePath}\n${String(linkValue ?? '')}`;
            if (decision === 'ambiguous') {
                ambiguousReferenceKeys.add(referenceKey);
                return false;
            }
            if (decision === 'match') {
                pendingRemovedReferences.add(referenceKey);
                return true;
            }
            return false;
        };

        logger.flow('DeletedLinkCleanup', 'start', {
            deletedPath,
            scannedFiles: files.length,
            hasRemainingBasenameMatch: matchContext.hasRemainingBasenameMatch,
        });
        const touchedFiles: TFile[] = [];
        for (const file of files) {
            const isMarkdown = file.extension?.toLowerCase() === 'md';
            if (
                isMarkdown
                && !(await canAutomaticallyMutateTemplateFile(
                    this.plugin.app.vault,
                    file,
                    this.plugin.settings,
                ))
            ) {
                continue;
            }
            const fm = this.plugin.parentLinkResolutionService.getLogicalFrontmatter(file);
            const hasPk = Object.keys(fm).some((key) => parentKeys.includes(key.toLowerCase()));
            const hasAk = !!fm && Object.keys(fm).some(k => k.toLowerCase() === attachmentsKey.toLowerCase());
            let frontmatterChanged = false;
            const frontmatterRemovedReferences = new Set<string>();

            if (hasPk || hasAk) {
                try {
                    await this.plugin.frontmatterMutationService.process(file, (frontmatter) => {
                        if (
                            isMarkdown
                            && !canAutomaticallyMutateTemplateFrontmatter(frontmatter, this.plugin.settings)
                        ) return;
                        // Parent fields may be scalar or arrays. Remove only the
                        // deleted member and preserve unrelated parents.
                        for (const configuredParentKey of parentKeys) {
                            const pk = Object.keys(frontmatter).find((key) => key.toLowerCase() === configuredParentKey);
                            if (!pk) continue;
                            const raw = frontmatter[pk];
                            const values = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
                            const filtered = values.filter((value) => !isMatch(value, file.path, frontmatterRemovedReferences));
                            if (filtered.length === values.length) continue;
                            frontmatterChanged = true;
                            if (filtered.length === 0) delete frontmatter[pk];
                            else frontmatter[pk] = Array.isArray(raw) ? filtered : filtered[0];
                        }

                        // Clean attachments array
                        const ak = Object.keys(frontmatter).find(k => k.toLowerCase() === attachmentsKey.toLowerCase());
                        if (ak) {
                            const raw = frontmatter[ak];
                            const arr: any[] = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
                            const filtered = arr.filter(v => !isMatch(v, file.path, frontmatterRemovedReferences));
                            if (filtered.length !== arr.length) {
                                frontmatterChanged = true;
                                if (filtered.length === 0) delete frontmatter[ak];
                                else frontmatter[ak] = filtered;
                            }
                        }
                    });
                    for (const referenceKey of frontmatterRemovedReferences) removedReferenceKeys.add(referenceKey);
                } catch (err) {
                    logger.warn(`[TPS GCM] cleanupLinksForDeletedFile: failed to clean frontmatter for ${file.path}:`, err);
                }
            }

            let bodyChanged = false;
            if (!isMarkdown) {
                if (frontmatterChanged) touchedFiles.push(file);
                continue;
            }
            try {
                const raw = await this.plugin.app.vault.cachedRead(file);
                if (!canAutomaticallyMutateTemplateSource(raw, this.plugin.settings)) continue;
                const lines = raw.split('\n');
                const preflightRemovedReferences = new Set<string>();
                const preflight = lines.filter((line) => {
                    const parsed = this.plugin.bodySubitemLinkService.parseLine(line);
                    if (!parsed) return true;
                    return !isMatch(parsed.linkTarget, file.path, preflightRemovedReferences)
                        && !isMatch(parsed.wikilink, file.path, preflightRemovedReferences);
                });
                if (preflight.length !== lines.length) {
                    const bodyRemovedReferences = new Set<string>();
                    await this.plugin.app.vault.process(file, (current) => {
                        if (!canAutomaticallyMutateTemplateSource(current, this.plugin.settings)) return current;
                        const currentLines = current.split('\n');
                        const filtered = currentLines.filter((line) => {
                            const parsed = this.plugin.bodySubitemLinkService.parseLine(line);
                            if (!parsed) return true;
                            return !isMatch(parsed.linkTarget, file.path, bodyRemovedReferences)
                                && !isMatch(parsed.wikilink, file.path, bodyRemovedReferences);
                        });
                        if (filtered.length === currentLines.length) return current;
                        bodyChanged = true;
                        return filtered.join('\n');
                    });
                    if (bodyChanged) {
                        for (const referenceKey of bodyRemovedReferences) removedReferenceKeys.add(referenceKey);
                    }
                }
            } catch (err) {
                logger.warn(`[TPS GCM] cleanupLinksForDeletedFile: failed to clean body links for ${file.path}:`, err);
            }

            if (frontmatterChanged || bodyChanged) {
                touchedFiles.push(file);
            }
        }

        if (touchedFiles.length > 0) {
            setTimeout(() => touchedFiles.forEach((file) => this.plugin.persistentMenuManager?.refreshMenusForFile(file)), 200);
            this.notifyFilesChanged(touchedFiles);
        }
        const result = {
            scannedFiles: files.length,
            touchedFiles: touchedFiles.length,
            removedReferences: removedReferenceKeys.size,
            preservedAmbiguousReferences: ambiguousReferenceKeys.size,
        };
        logger.flow('DeletedLinkCleanup', 'done', {
            deletedPath,
            ...result,
        });
        return result;
    }
}

function normalizeObsidianDateTimeValue(value: string | null): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    const dateTime = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (dateTime) {
        return `${dateTime[1]} ${dateTime[2].padStart(2, '0')}:${dateTime[3]}:${dateTime[4] ?? '00'}`;
    }
    return trimmed;
}
