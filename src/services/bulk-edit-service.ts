import { TFile, Notice, normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import TPSGlobalContextMenuPlugin from '../main';
import { RRule } from 'rrule';
import * as logger from "../logger";
import { TRACKER_RECURRENCE_RULE } from '../constants';
import { normalizeTagValue, normalizeTagList, parseTagInput, mergeNormalizedTags } from '../utils/tag-utils';
import { mergeLinkList, mergeStringList, parseLinkListInput, parseStringListInput, removeLinkListValues, removeStringListValues } from '../utils/list-utils';
import { stripDatePrefix, stripDateSuffix } from '../utils/date-suffix-utils';
import { setCompletedDateValue } from '../utils/completed-date-utils';
import {
    didFrontmatterMutationChange,
    isFrontmatterMutationReady,
    type FrontmatterMutationOutcome,
} from './frontmatter-mutation-outcome';
import { normalizeLeadingWhitespaceBeforeFrontmatter as normalizeLeadingFrontmatter } from './leading-frontmatter-normalizer';
import { runFailClosedTwoSidedRemoval, summarizeRelationshipUnlinkStatuses } from './relationship-outcome';
import type {
    AttachmentUnlinkOutcome,
    RelationshipSideRemovalOutcome,
    RelationshipUnlinkAggregateOutcome,
    RelationshipUnlinkOutcome,
} from './subitem-types';
import { ChecklistHandler } from '../handlers/checklist-handler';
import { ParentLinkHandler } from '../handlers/parent-link-handler';
import { buildParentFrontmatterLinkValue, buildParentLinkValue, linkValueMatchesFile, extractLinkTarget, resolveLinkValueToFile } from '../handlers/parent-link-format';
import { findExistingDailyNoteForIsoDate } from '../utils/daily-note-task-schedule';
import { parseDateFromFilename } from '../utils/daily-file-date';
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

type RecurrenceMutationResult = {
    outcome: FrontmatterMutationOutcome;
    ready: boolean;
    changed: boolean;
};

type RecurrenceOpLease = {
    key: string;
    targetPath: string;
    leaseId: string;
};

type RecurrenceOpBeginResult =
    | { status: 'acquired'; lease: RecurrenceOpLease }
    | { status: 'exists' | 'inflight' | 'unavailable' };

type RecurrenceCreateExpectation = {
    expectedStatus?: string;
};

type RecurrenceSourceExpectation = {
    rule: string;
    scheduled: unknown;
    status?: unknown;
    templateFile?: TFile | null;
    seriesBaseName?: string;
};

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
    private recurrenceOpStateLoadSucceeded = false;
    private recurrenceOpStateChain: Promise<void> = Promise.resolve();
    private recurrenceOpState: {
        version: number;
        ops: Record<string, {
            state: 'creating' | 'complete';
            targetPath: string;
            updatedAt: number;
            leaseId?: string;
        }>;
    } = { version: 1, ops: {} };

    constructor(plugin: TPSGlobalContextMenuPlugin) {
        this.plugin = plugin;
        this.checklistHandler = new ChecklistHandler(plugin.app);
        this.parentLinkHandler = new ParentLinkHandler(plugin.app, () => plugin.settings);
    }

    private isChecklistCompletionStatus(status: unknown): boolean {
        const normalized = this.plugin.sharedServices?.status?.normalize?.(status) || String(status ?? '').trim().toLowerCase();
        return normalized === 'complete' || normalized === 'completed' || normalized === 'done';
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
        const { format, folder } = await this.getDailyNoteSettings();
        const normalizedFolder = normalizePath(folder).replace(/^\/+|\/+$/g, "");
        const fileFolder = normalizePath(file.parent?.path || "").replace(/^\/+|\/+$/g, "");
        if (normalizedFolder !== fileFolder) return false;

        const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        if (this.isProcessRunFrontmatter(frontmatter)) return false;
        const parsedScheduled = scheduled ? window.moment(scheduled) : null;
        const scheduledIso = parsedScheduled?.isValid?.() && parsedScheduled.isValid()
            ? parsedScheduled.format("YYYY-MM-DD")
            : null;

        const parseFormats = [
            format,
            "ddd, MMM DD YYYY",
            "ddd, MMM D YYYY",
            "YYYY-MM-DD",
            "YYYY_M_D",
            "YYYY_M_DD",
            "YYYY_MM_D",
            "YYYY_MM_DD",
            "YYYYMMDD",
        ].filter((candidate, index, all) => !!candidate && all.indexOf(candidate) === index);

        const basenameCandidates = [
            file.basename,
            stripDatePrefix(stripDateSuffix(file.basename)).trim(),
        ].filter((candidate, index, all) => !!candidate && all.indexOf(candidate) === index);
        const parsedBasename = basenameCandidates
            .map((candidate) => window.moment(candidate, parseFormats, true))
            .find((candidate) => candidate?.isValid?.() && candidate.isValid()) ?? null;
        const title = typeof frontmatter?.title === "string" ? frontmatter.title.trim() : "";
        const parsedTitle = title
            ? window.moment(title, parseFormats, true)
            : null;
        const titleIsDailyNoteDate = !!parsedTitle?.isValid?.() && parsedTitle.isValid();

        if (parseDateFromFilename(file.basename, format).isValid()) {
            return true;
        }

        if (this.hasDailyNoteMarker(frontmatter)) {
            if (!scheduledIso || !parsedBasename) return true;
            return parsedBasename.format("YYYY-MM-DD") === scheduledIso;
        }

        if (titleIsDailyNoteDate) return true;

        if (!parsedBasename?.isValid?.() || !parsedBasename.isValid()) {
            if (!normalizedFolder || !scheduledIso) return false;
            const expectedBasename = window.moment(scheduledIso, "YYYY-MM-DD", true).format(format);
            const normalizedBasename = String(file.basename || "").toLowerCase();
            return normalizedBasename.includes(expectedBasename.toLowerCase()) || normalizedBasename.includes(scheduledIso.toLowerCase());
        }

        const basenameScheduled = parsedBasename.format("YYYY-MM-DD");
        const expectedBasename = window.moment(parsedBasename).format(format);
        const matchesConfiguredName = file.basename === expectedBasename;
        if (!matchesConfiguredName && scheduled) {
            if (!scheduledIso || scheduledIso !== basenameScheduled) {
                return false;
            }
        }

        if (!scheduled) return true;
        return scheduledIso
            ? scheduledIso === parsedBasename.format("YYYY-MM-DD")
            : true;
    }

    private hasDailyNoteMarker(frontmatter: Record<string, unknown> | undefined): boolean {
        if (!frontmatter) return false;
        if (this.isProcessRunFrontmatter(frontmatter)) return false;
        const tags = this.normalizeStringList((frontmatter as any).tags || (frontmatter as any).tag)
            .map((tag) => tag.replace(/^#/, "").trim().toLowerCase());
        if (tags.some((tag) => tag === "type/note/daily" || tag === "dailynote")) return true;
        const type = this.normalizeStringList((frontmatter as any).type || (frontmatter as any).types)
            .map((value) => value.replace(/^#/, "").trim().toLowerCase());
        return type.some((value) => value === "daily" || value === "note/daily" || value === "type/note/daily");
    }

    private isProcessRunFrontmatter(frontmatter: Record<string, unknown> | undefined): boolean {
        if (!frontmatter) return false;
        const runKind = this.frontmatterString(frontmatter, "runKind").toLowerCase();
        const workflowKind = this.frontmatterString(frontmatter, "workflowKind").toLowerCase();
        const kind = this.frontmatterString(frontmatter, "kind").toLowerCase();
        const runType = this.frontmatterString(frontmatter, "runType").toLowerCase();
        const workflowType = this.frontmatterString(frontmatter, "workflowType").toLowerCase();
        return runKind === "run"
            || workflowKind === "workflow"
            || kind === "workout"
            || kind === "workout-plan"
            || Boolean(runType)
            || Boolean(workflowType);
    }

    private frontmatterString(frontmatter: Record<string, unknown>, key: string): string {
        const actualKey = findKeyCaseInsensitive(frontmatter, key);
        return actualKey ? String(frontmatter[actualKey] ?? "").trim() : "";
    }

    private normalizeStringList(value: unknown): string[] {
        const source = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
        return source
            .flatMap((item) => Array.isArray(item) ? item : [item])
            .map((item) => String(item ?? "").trim())
            .filter(Boolean);
    }

    private async isConfiguredDailyNoteTemplate(file: TFile): Promise<boolean> {
        const { template } = await this.getDailyNoteSettings();
        if (!template) return false;
        const templateFile = this.resolveDailyNoteTemplateFile(template);
        return templateFile instanceof TFile && normalizePath(templateFile.path) === normalizePath(file.path);
    }

    private async isDailyNoteRecurrenceDirectFile(file: TFile, scheduled?: string): Promise<boolean> {
        return await this.isDailyNoteLikeFile(file) || await this.isConfiguredDailyNote(file, scheduled) || await this.isConfiguredDailyNoteTemplate(file);
    }

    async shouldSkipNoteLevelRecurrence(file: TFile, scheduled?: string): Promise<boolean> {
        return await this.isDailyNoteRecurrenceDirectFile(file, scheduled);
    }

    private async isDailyNoteLikeFile(file: TFile): Promise<boolean> {
        const { format } = await this.getDailyNoteSettings();
        const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        if (this.isProcessRunFrontmatter(frontmatter)) return false;
        if (this.hasDailyNoteMarker(frontmatter)) return true;
        if (parseDateFromFilename(file.basename, format).isValid()) return true;

        const title = typeof frontmatter?.title === "string" ? frontmatter.title.trim() : "";
        return !!title && parseDateFromFilename(title, format).isValid();
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

    private async buildDailyNoteContent(date: Date, path: string): Promise<string> {
        const { template } = await this.getDailyNoteSettings();
        const title = path.split("/").pop()?.replace(/\.md$/i, "") || window.moment(date).format("YYYY-MM-DD");
        const templateFile = template ? this.resolveDailyNoteTemplateFile(template) : null;
        if (templateFile instanceof TFile) {
            try {
                return this.applyDailyNoteTemplateVariables(await this.plugin.app.vault.read(templateFile), date, title);
            } catch (error) {
                logger.warn("[TPS GCM] Failed reading Daily Notes template for recurrence:", error);
            }
        }
        return `---\ntitle: ${title}\nscheduled: ${window.moment(date).format("YYYY-MM-DD")} 00:00:00\n---\n`;
    }

    private async createNextDailyNoteRecurrenceInstance(file: TFile, frontmatter: any, nextDate: Date, recurrenceRule: string): Promise<boolean> {
        const newFilePath = await this.getDailyNotePath(nextDate);
        const newFileName = newFilePath.split("/").pop() || newFilePath;
        const newScheduled = window.moment(nextDate).format("YYYY-MM-DD 00:00:00");
        const nextIsoDate = window.moment(nextDate).format("YYYY-MM-DD");
        const expectedSourceScheduled = String(this.getFrontmatterValueCaseInsensitive(frontmatter, 'scheduled') ?? '').trim();
        const liveSource = await this.captureLiveFrontmatter(file, (candidate) => (
            String(this.getFrontmatterValueCaseInsensitive(candidate, 'scheduled') ?? '').trim() === expectedSourceScheduled
            && this.hasExpectedRecurrenceRule(candidate, recurrenceRule)
            && !this.isRecurrenceTemplateFrontmatter(candidate)
            && this.getFrontmatterValueCaseInsensitive(candidate, 'recurrenceTemplate') == null
        ));
        if (!liveSource) return false;
        const expectedSourceStatus = this.normalizeStatusValue(
            this.getFrontmatterValueCaseInsensitive(liveSource, 'status'),
        );

        const existingDailyNote = findExistingDailyNoteForIsoDate(this.plugin.app, this.plugin.settings, nextIsoDate);
        if (this.hasGeneratedRecurrence(liveSource, newScheduled) && existingDailyNote instanceof TFile) {
            const targetReady = await this.hasAtomicFrontmatterState(existingDailyNote, (targetFrontmatter) => (
                String(this.getFrontmatterValueCaseInsensitive(targetFrontmatter, 'scheduled') ?? '').trim() === newScheduled
                && this.hasExpectedRecurrenceRule(targetFrontmatter, recurrenceRule)
                && !this.isRecurrenceTemplateFrontmatter(targetFrontmatter)
                && this.getFrontmatterValueCaseInsensitive(targetFrontmatter, 'recurrenceTemplate') == null
            ));
            return targetReady && this.markRecurrenceGenerated(file, newScheduled, {
                rule: recurrenceRule,
                scheduled: expectedSourceScheduled,
                status: expectedSourceStatus,
                templateFile: null,
            });
        }
        const chainId = "daily-notes";
        const recurrenceOpKey = this.buildRecurrenceOpKey(chainId, newScheduled);
        const intendedTargetPath = existingDailyNote instanceof TFile ? existingDailyNote.path : newFilePath;
        const beginResult = await this.beginRecurrenceOp(recurrenceOpKey, intendedTargetPath);
        if (beginResult.status !== 'acquired') {
            if (beginResult.status === 'inflight') {
                logger.log("[TPS GCM] Daily-note recurrence operation already in flight for", newFilePath);
                return false;
            }
            if (beginResult.status !== 'exists') return false;
            const recordedTarget = this.getRecurrenceOpTarget(recurrenceOpKey);
            const existingTarget = findExistingDailyNoteForIsoDate(this.plugin.app, this.plugin.settings, nextIsoDate);
            if (!(existingTarget instanceof TFile) || normalizePath(existingTarget.path) !== recordedTarget) return false;
            const targetReady = await this.hasAtomicFrontmatterState(existingTarget, (targetFrontmatter) => (
                String(this.getFrontmatterValueCaseInsensitive(targetFrontmatter, 'scheduled') ?? '').trim() === newScheduled
                && this.hasExpectedRecurrenceRule(targetFrontmatter, recurrenceRule)
                && !this.isRecurrenceTemplateFrontmatter(targetFrontmatter)
                && this.getFrontmatterValueCaseInsensitive(targetFrontmatter, 'recurrenceTemplate') == null
            ));
            if (!targetReady || !(await this.markRecurrenceGenerated(file, newScheduled, {
                rule: recurrenceRule,
                scheduled: expectedSourceScheduled,
                status: expectedSourceStatus,
                templateFile: null,
            }))) return false;
            return true;
        }

        let acquiredLease: RecurrenceOpLease | null = beginResult.lease;
        try {
            const existingBeforeCreate = findExistingDailyNoteForIsoDate(this.plugin.app, this.plugin.settings, nextIsoDate);
            if (existingBeforeCreate instanceof TFile) {
                if (normalizePath(existingBeforeCreate.path) !== acquiredLease.targetPath) {
                    throw new Error(`Daily-note target path does not match acquired recurrence lease: ${existingBeforeCreate.path}`);
                }
                const targetReady = await this.hasAtomicFrontmatterState(existingBeforeCreate, (targetFrontmatter) => (
                    String(this.getFrontmatterValueCaseInsensitive(targetFrontmatter, 'scheduled') ?? '').trim() === newScheduled
                    && this.hasExpectedRecurrenceRule(targetFrontmatter, recurrenceRule)
                    && !this.isRecurrenceTemplateFrontmatter(targetFrontmatter)
                    && this.getFrontmatterValueCaseInsensitive(targetFrontmatter, 'recurrenceTemplate') == null
                ));
                if (!targetReady) {
                    throw new Error(`Existing daily note is not a ready recurrence target: ${existingBeforeCreate.path}`);
                }
                if (!(await this.markRecurrenceGenerated(file, newScheduled, {
                    rule: recurrenceRule,
                    scheduled: expectedSourceScheduled,
                    status: expectedSourceStatus,
                    templateFile: null,
                }))) {
                    throw new Error(`Failed to record generated recurrence on ${file.path}`);
                }
                if (!(await this.completeRecurrenceOp(acquiredLease, existingBeforeCreate.path))) {
                    throw new Error(`Failed to persist completed recurrence operation for ${existingBeforeCreate.path}`);
                }
                acquiredLease = null;
                new Notice(`Next daily note already exists: ${existingBeforeCreate.basename}.md`);
                return true;
            }

            const folder = newFilePath.includes("/") ? newFilePath.split("/").slice(0, -1).join("/") : "";
            if (folder && !(await this.plugin.app.vault.adapter.exists(folder))) {
                await this.plugin.app.vault.createFolder(folder);
            }

            const sourceContent = await this.buildDailyNoteContent(nextDate, newFilePath);
            const prepared = this.prepareRecurrenceCreateContent(sourceContent, (fm) => {
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
            if (!prepared.content || !isFrontmatterMutationReady(prepared.outcome)) {
                throw new Error(`Failed to prepare recurrence frontmatter for ${newFilePath}`);
            }
            const sourceStillReady = await this.captureLiveFrontmatter(file, (candidate) => (
                String(this.getFrontmatterValueCaseInsensitive(candidate, 'scheduled') ?? '').trim() === expectedSourceScheduled
                && this.hasExpectedRecurrenceRule(candidate, recurrenceRule)
                && this.normalizeStatusValue(this.getFrontmatterValueCaseInsensitive(candidate, 'status')) === expectedSourceStatus
                && !this.isRecurrenceTemplateFrontmatter(candidate)
                && this.getFrontmatterValueCaseInsensitive(candidate, 'recurrenceTemplate') == null
            ));
            if (!sourceStillReady) throw new Error(`Daily recurrence source changed before create: ${file.path}`);
            const newFile = await this.plugin.app.vault.create(newFilePath, prepared.content);
            if (!(newFile instanceof TFile)) throw new Error(`Failed to create recurrence target ${newFilePath}`);
            const targetReady = await this.hasAtomicFrontmatterState(newFile, (targetFrontmatter) => (
                String(this.getFrontmatterValueCaseInsensitive(targetFrontmatter, 'scheduled') ?? '').trim() === newScheduled
                && this.hasExpectedRecurrenceRule(targetFrontmatter, recurrenceRule)
                && !this.isRecurrenceTemplateFrontmatter(targetFrontmatter)
                && this.getFrontmatterValueCaseInsensitive(targetFrontmatter, 'recurrenceTemplate') == null
            ));
            if (!targetReady) throw new Error(`Created daily recurrence target failed validation: ${newFile.path}`);

            if (!(await this.markRecurrenceGenerated(file, newScheduled, {
                rule: recurrenceRule,
                scheduled: expectedSourceScheduled,
                status: expectedSourceStatus,
                templateFile: null,
            }))) {
                throw new Error(`Failed to record generated recurrence on ${file.path}`);
            }
            if (!(await this.completeRecurrenceOp(acquiredLease, newFilePath))) {
                throw new Error(`Failed to persist completed recurrence operation for ${newFilePath}`);
            }
            acquiredLease = null;
            new Notice(`Created next daily note: ${newFileName}`);
            return true;
        } catch (error) {
            logger.error("[TPS GCM] Failed to create next daily-note recurrence:", error);
            new Notice("Failed to create next daily note recurrence. Check console for details.");
            return false;
        } finally {
            if (acquiredLease) await this.failRecurrenceOp(acquiredLease);
        }
    }

    private getRecurrenceStatePath(): string {
        return `${this.plugin.manifest.dir}/recurrence-create-state.json`;
    }

    private hasGeneratedRecurrence(frontmatter: any, scheduledValue: string): boolean {
        const existing = String(this.getFrontmatterValueCaseInsensitive(frontmatter, this.recurrenceLastGeneratedKey) || '').trim();
        return !!existing && existing === scheduledValue;
    }

    private recurrenceMutationResult(outcome: FrontmatterMutationOutcome): RecurrenceMutationResult {
        return {
            outcome,
            ready: isFrontmatterMutationReady(outcome),
            changed: didFrontmatterMutationChange(outcome),
        };
    }

    /**
     * Captures the exact frontmatter revision observed by Vault.process without
     * committing a write. Returning `unchanged` is an explicit successful read,
     * while `guarded-abort` means the live precondition no longer matches.
     */
    private async captureLiveFrontmatter(
        file: TFile,
        predicate: (frontmatter: Record<string, any>) => boolean = () => true,
    ): Promise<Record<string, any> | null> {
        if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') return null;
        let snapshot: Record<string, any> | null = null;
        const outcome = await this.plugin.frontmatterMutationService.processGuardedWithOutcome(file, (frontmatter) => {
            if (!predicate(frontmatter)) return false;
            snapshot = Object.fromEntries(Object.entries(frontmatter).map(([key, value]) => [
                key,
                Array.isArray(value) ? [...value] : value,
            ]));
            return 'unchanged';
        });
        return outcome === 'unchanged' ? snapshot : null;
    }

    /**
     * Produces fully initialized Markdown before Vault.create is called. A failed
     * transform therefore cannot leave a partial recurrence file occupying the
     * target path.
     */
    private prepareRecurrenceCreateContent(
        sourceContent: string,
        mutator: (frontmatter: Record<string, any>) => void,
    ): { outcome: 'changed' | 'unchanged' | 'parse-failed' | 'write-refused'; content?: string } {
        try {
            const original = String(sourceContent ?? '');
            const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
            const body = bom ? original.slice(1) : original;
            const lineEnding = body.includes('\r\n') ? '\r\n' : '\n';
            const opening = body.match(/^---[ \t]*(?:\r?\n)/);
            let frontmatter: Record<string, any> = {};
            let markdownBody = body;

            if (opening) {
                const closingPattern = /^---[ \t]*(?:\r?\n|$)/gm;
                closingPattern.lastIndex = opening[0].length;
                const closing = closingPattern.exec(body);
                if (!closing) return { outcome: 'parse-failed' };
                const yamlSource = body.slice(opening[0].length, closing.index);
                const parsed = yamlSource.trim() ? parseYaml(yamlSource) : {};
                if (parsed == null) {
                    frontmatter = {};
                } else if (typeof parsed === 'object' && !Array.isArray(parsed)) {
                    frontmatter = parsed as Record<string, any>;
                } else {
                    return { outcome: 'parse-failed' };
                }
                markdownBody = body.slice(closing.index + closing[0].length);
            }

            mutator(frontmatter);
            const yaml = stringifyYaml(frontmatter).trimEnd();
            if (yaml) {
                const reparsed = parseYaml(yaml);
                if (!reparsed || typeof reparsed !== 'object' || Array.isArray(reparsed)) {
                    return { outcome: 'write-refused' };
                }
            }
            const nextContent = yaml
                ? `${bom}---${lineEnding}${yaml.replace(/\n/g, lineEnding)}${lineEnding}---${lineEnding}${markdownBody}`
                : `${bom}${markdownBody}`;
            return {
                outcome: nextContent === original ? 'unchanged' : 'changed',
                content: nextContent,
            };
        } catch (error) {
            logger.warn('[TPS GCM] Refusing recurrence create after frontmatter transform failed', {
                error: logger.errorSummary(error),
            });
            return { outcome: 'parse-failed' };
        }
    }

    private async markRecurrenceGenerated(
        file: TFile,
        scheduledValue: string,
        expectedSource: RecurrenceSourceExpectation,
    ): Promise<boolean> {
        if (!(await this.canMutateFrontmatterSafely(file))) return false;
        const outcome = await this.runSerializedFrontmatterWrite(file, () =>
            this.plugin.frontmatterMutationService.processGuardedWithOutcome(file, (fm) => {
                const liveScheduled = String(this.getFrontmatterValueCaseInsensitive(fm, 'scheduled') ?? '').trim();
                const expectedScheduled = String(expectedSource.scheduled ?? '').trim();
                if (liveScheduled !== expectedScheduled || !this.hasExpectedRecurrenceRule(fm, expectedSource.rule)) {
                    return false;
                }
                if (Object.prototype.hasOwnProperty.call(expectedSource, 'status')
                    && this.normalizeStatusValue(this.getFrontmatterValueCaseInsensitive(fm, 'status'))
                        !== this.normalizeStatusValue(expectedSource.status)) return false;
                if (Object.prototype.hasOwnProperty.call(expectedSource, 'templateFile')) {
                    if (expectedSource.templateFile instanceof TFile) {
                        if (!expectedSource.seriesBaseName
                            || !this.frontmatterReferencesSeriesTemplate(
                                fm,
                                expectedSource.seriesBaseName,
                                expectedSource.templateFile,
                                file.path,
                            )) return false;
                    } else if (this.getFrontmatterValueCaseInsensitive(fm, 'recurrenceTemplate') != null) {
                        return false;
                    }
                }
                this.setFrontmatterValueCaseInsensitive(fm, this.recurrenceLastGeneratedKey, scheduledValue);
                return true;
            })
        );
        return isFrontmatterMutationReady(outcome);
    }

    private async hasAtomicFrontmatterState(
        file: TFile,
        predicate: (frontmatter: Record<string, any>) => boolean,
    ): Promise<boolean> {
        let matches = false;
        try {
            const outcome = await this.plugin.frontmatterMutationService.processGuardedWithOutcome(file, (frontmatter) => {
                matches = predicate(frontmatter);
                return matches ? 'unchanged' : false;
            });
            return outcome === 'unchanged' && matches;
        } catch (error) {
            logger.warn('[TPS GCM] Failed validating recurrence target frontmatter', {
                file: file.path,
                error: logger.errorSummary(error),
            });
            return false;
        }
    }

    private hasExpectedRecurrenceRule(frontmatter: Record<string, any>, expectedRule: string): boolean {
        const actual = this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceRule')
            ?? this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrence');
        return this.normalizeRecurrenceRuleValue(actual) === this.normalizeRecurrenceRuleValue(expectedRule);
    }

    private async isValidatedRecurrenceTemplate(
        file: TFile,
        seriesBaseName: string,
        expectedRule?: string,
        expectedPath?: string,
    ): Promise<boolean> {
        if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') return false;
        if (casefold(file.basename) !== casefold(seriesBaseName)) return false;
        if (expectedPath && normalizePath(file.path) !== normalizePath(expectedPath)) return false;
        return this.hasAtomicFrontmatterState(file, (frontmatter) => (
            this.isRecurrenceTemplateFrontmatter(frontmatter)
            && !this.getFrontmatterValueCaseInsensitive(frontmatter, 'scheduled')
            && (!expectedRule || this.hasExpectedRecurrenceRule(frontmatter, expectedRule))
        ));
    }

    private async resolveValidatedRecurrenceTemplateFile(
        file: TFile,
        frontmatter: Record<string, any>,
        expectedRule: string,
    ): Promise<TFile | null> {
        const seriesBaseName = stripDateSuffix(file.basename).trim();
        if (!seriesBaseName) return null;
        const templateFolder = normalizePath((this.plugin.settings.recurringTemplateFolder || '').trim());
        const configuredPath = templateFolder
            ? normalizePath(`${templateFolder}/${seriesBaseName}.md`)
            : null;
        const rawTemplate = this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceTemplate');

        if (rawTemplate != null && rawTemplate !== '' && rawTemplate !== false) {
            if (rawTemplate === true) return null;
            const linked = resolveLinkValueToFile(this.plugin.app, rawTemplate, file.path);
            if (!(linked instanceof TFile) || linked.path === file.path) return null;
            return await this.isValidatedRecurrenceTemplate(
                linked,
                seriesBaseName,
                expectedRule,
                configuredPath ?? undefined,
            ) ? linked : null;
        }

        if (!configuredPath) return null;
        const configured = this.plugin.app.vault.getAbstractFileByPath(configuredPath);
        if (!(configured instanceof TFile) || configured.path === file.path) return null;
        return await this.isValidatedRecurrenceTemplate(
            configured,
            seriesBaseName,
            expectedRule,
            configuredPath,
        ) ? configured : null;
    }

    private async loadRecurrenceOpState(): Promise<boolean> {
        if (this.recurrenceOpStateLoaded) return this.recurrenceOpStateLoadSucceeded;
        this.recurrenceOpStateLoaded = true;

        try {
            const path = this.getRecurrenceStatePath();
            const exists = await this.plugin.app.vault.adapter.exists(path);
            if (exists) {
                const raw = await this.plugin.app.vault.adapter.read(path);
                const parsed = JSON.parse(raw);
                if (!parsed || parsed.version !== 1 || !parsed.ops || typeof parsed.ops !== 'object' || Array.isArray(parsed.ops)) {
                    throw new Error('Unsupported recurrence operation state');
                }
                for (const [key, op] of Object.entries(parsed.ops as Record<string, any>)) {
                    if (!key
                        || !op
                        || (op.state !== 'creating' && op.state !== 'complete')
                        || typeof op.targetPath !== 'string'
                        || !Number.isFinite(op.updatedAt)
                        || (op.leaseId != null && typeof op.leaseId !== 'string')) {
                        throw new Error(`Invalid recurrence operation state entry: ${key || '<empty>'}`);
                    }
                }
                this.recurrenceOpState = { version: 1, ops: parsed.ops };
            }
            this.recurrenceOpStateLoadSucceeded = true;
            return true;
        } catch (error) {
            logger.warn('[TPS GCM] Failed loading recurrence create state:', error);
            this.recurrenceOpStateLoadSucceeded = false;
            return false;
        }
    }

    /**
     * This state is an advisory cross-restart duplicate guard. Live source/target
     * validation remains authoritative. Persistence failure is still fail-closed:
     * callers cannot claim a lease or completion that was not written.
     */
    private async saveRecurrenceOpState(): Promise<boolean> {
        try {
            const path = this.getRecurrenceStatePath();
            await this.plugin.app.vault.adapter.write(path, JSON.stringify(this.recurrenceOpState, null, 2));
            return true;
        } catch (error) {
            logger.warn('[TPS GCM] Failed saving recurrence create state:', error);
            return false;
        }
    }

    private async runSerializedRecurrenceOpState<T>(action: () => Promise<T>): Promise<T> {
        const previous = this.recurrenceOpStateChain;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.recurrenceOpStateChain = previous.then(() => gate, () => gate);
        try {
            await previous;
            return await action();
        } finally {
            release();
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

    private createRecurrenceLease(opKey: string, targetPath: string): RecurrenceOpLease {
        const randomId = globalThis.crypto?.randomUUID?.()
            ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        return {
            key: opKey,
            targetPath: normalizePath(targetPath),
            leaseId: randomId,
        };
    }

    private async beginRecurrenceOp(opKey: string, targetPath: string): Promise<RecurrenceOpBeginResult> {
        return this.runSerializedRecurrenceOpState(async () => {
            if (!(await this.loadRecurrenceOpState())) return { status: 'unavailable' };
            const now = Date.now();
            const previousOps = Object.fromEntries(
                Object.entries(this.recurrenceOpState.ops).map(([key, value]) => [key, { ...value }]),
            );
            this.pruneRecurrenceOpState(now);

            const normalizedTarget = normalizePath(targetPath);
            const existing = this.recurrenceOpState.ops[opKey];
            if (existing && normalizePath(existing.targetPath) !== normalizedTarget) {
                logger.warn('[TPS GCM] Recurrence operation key points at an unexpected target', {
                    opKey,
                    expectedTarget: normalizedTarget,
                    recordedTarget: existing.targetPath,
                });
                return { status: 'unavailable' };
            }
            if (existing?.state === 'complete'
                && await this.plugin.app.vault.adapter.exists(normalizedTarget)) return { status: 'exists' };
            if (existing?.state === 'creating' && now - existing.updatedAt < 10 * 60 * 1000) {
                return { status: 'inflight' };
            }

            const lease = this.createRecurrenceLease(opKey, normalizedTarget);
            this.recurrenceOpState.ops[opKey] = {
                state: 'creating',
                targetPath: lease.targetPath,
                updatedAt: now,
                leaseId: lease.leaseId,
            };
            if (!(await this.saveRecurrenceOpState())) {
                this.recurrenceOpState.ops = previousOps;
                return { status: 'unavailable' };
            }
            return { status: 'acquired', lease };
        });
    }

    private async completeRecurrenceOp(lease: RecurrenceOpLease, targetPath: string): Promise<boolean> {
        return this.runSerializedRecurrenceOpState(async () => {
            if (!(await this.loadRecurrenceOpState())) return false;
            const normalizedTarget = normalizePath(targetPath);
            const existing = this.recurrenceOpState.ops[lease.key];
            if (
                normalizedTarget !== lease.targetPath
                || existing?.state !== 'creating'
                || existing.leaseId !== lease.leaseId
                || normalizePath(existing.targetPath) !== lease.targetPath
            ) return false;

            const previousOps = Object.fromEntries(
                Object.entries(this.recurrenceOpState.ops).map(([key, value]) => [key, { ...value }]),
            );
            this.recurrenceOpState.ops[lease.key] = {
                state: 'complete',
                targetPath: normalizedTarget,
                updatedAt: Date.now(),
            };
            this.pruneRecurrenceOpState();
            if (await this.saveRecurrenceOpState()) return true;
            this.recurrenceOpState.ops = previousOps;
            return false;
        });
    }

    private async failRecurrenceOp(lease: RecurrenceOpLease): Promise<boolean> {
        return this.runSerializedRecurrenceOpState(async () => {
            if (!(await this.loadRecurrenceOpState())) return false;
            const existing = this.recurrenceOpState.ops[lease.key];
            if (
                existing?.state !== 'creating'
                || existing.leaseId !== lease.leaseId
                || normalizePath(existing.targetPath) !== lease.targetPath
            ) return false;
            const previous = { ...existing };
            delete this.recurrenceOpState.ops[lease.key];
            if (await this.saveRecurrenceOpState()) return true;
            this.recurrenceOpState.ops[lease.key] = previous;
            return false;
        });
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

    private initializeRecurrenceTemplateFrontmatter(
        frontmatter: Record<string, any>,
        seriesBaseName: string,
        rule: string,
        endsOn: string | null,
    ): void {
        this.markRecurrenceTemplate(frontmatter);
        this.setFrontmatterValueCaseInsensitive(frontmatter, 'title', seriesBaseName);
        this.setFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceRule', rule);
        this.deleteFrontmatterValueCaseInsensitive(frontmatter, 'recurrence');
        if (endsOn) this.setFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceEnds', endsOn);
        else this.deleteFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceEnds');
        this.deleteFrontmatterValueCaseInsensitive(frontmatter, 'scheduled');
        this.deleteFrontmatterValueCaseInsensitive(frontmatter, 'status');
        this.deleteFrontmatterValueCaseInsensitive(frontmatter, 'completedDate');
        this.deleteFrontmatterValueCaseInsensitive(frontmatter, this.recurrenceLastGeneratedKey);
        for (const key of Object.keys(frontmatter)) {
            if (['sort', 'hidden', 'icon', 'color'].includes(key.toLowerCase())) delete frontmatter[key];
        }
    }

    private initializeRecurrenceInstanceFrontmatter(
        frontmatter: Record<string, any>,
        options: {
            rule: string;
            scheduled: string | null;
            status: string;
            templateFile: TFile | null;
            instancePath: string;
            seriesBaseName: string;
        },
    ): void {
        if (options.scheduled) this.setFrontmatterValueCaseInsensitive(frontmatter, 'scheduled', options.scheduled);
        else this.deleteFrontmatterValueCaseInsensitive(frontmatter, 'scheduled');
        if (options.status) this.setFrontmatterValueCaseInsensitive(frontmatter, 'status', options.status);
        else this.deleteFrontmatterValueCaseInsensitive(frontmatter, 'status');

        // A template clone must never retain its boolean ownership marker.
        this.deleteFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceTemplate');
        this.clearLegacyRecurrenceTemplateMarker(frontmatter);
        if (options.templateFile instanceof TFile) {
            this.setFrontmatterValueCaseInsensitive(
                frontmatter,
                'recurrenceTemplate',
                this.buildRecurrenceTemplateLink(options.templateFile, options.instancePath, options.seriesBaseName),
            );
        }
        this.setFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceRule', options.rule);
        this.deleteFrontmatterValueCaseInsensitive(frontmatter, 'recurrence');

        for (const key of Object.keys(frontmatter)) {
            if ([
                'sort',
                'hidden',
                'icon',
                'color',
                'completeddate',
                'endedat',
                'durationseconds',
                'previouscompleteddate',
                'secondssincepreviouscompletion',
                'lastcompleteddate',
                'lastsessionpath',
                'nextelegibledate',
                this.recurrenceLastGeneratedKey.toLowerCase(),
            ].includes(key.toLowerCase())) delete frontmatter[key];
        }
    }

    private buildRecurrenceTemplateLink(templateFile: TFile, instanceFile: TFile | string, seriesBaseName: string): string {
        try {
            const sourcePath = typeof instanceFile === 'string' ? instanceFile : instanceFile.path;
            const linktext = this.plugin.app.metadataCache.fileToLinktext(templateFile, sourcePath, true);
            if (linktext && linktext.trim()) {
                return `[[${linktext}]]`;
            }
        } catch {
            // Fall back below
        }
        return `[[${seriesBaseName}]]`;
    }

    private frontmatterReferencesSeriesTemplate(
        frontmatter: any,
        seriesName: string,
        templateFile?: TFile | null,
        sourcePath = '',
    ): boolean {
        if (!frontmatter) return false;
        const rawValue = this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceTemplate');
        if (rawValue === true) return false;
        const rawLink = String(rawValue ?? '').trim();
        if (!rawLink) return false;

        if (templateFile instanceof TFile) {
            const resolved = resolveLinkValueToFile(this.plugin.app, rawLink, sourcePath);
            return resolved instanceof TFile
                && normalizePath(resolved.path) === normalizePath(templateFile.path);
        }

        const normalizedSeries = String(seriesName || '').trim().toLowerCase();
        const target = (extractLinkTarget(rawLink) || '').toLowerCase();

        if (!target) {
            return rawLink.toLowerCase().includes(`[[${normalizedSeries}]]`);
        }

        const targetBase = target.split('/').pop()?.replace(/\.md$/i, '') || '';
        return targetBase === normalizedSeries;
    }

    private resolveRecurrenceRule(frontmatter: any): string {
        return this.normalizeRecurrenceRuleValue(
            this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceRule')
            ?? this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrence')
            ?? '',
        );
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

    async runSerializedFrontmatterWrite<T>(file: TFile, action: () => Promise<T>): Promise<T> {
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
            return await action();
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
        await normalizeLeadingFrontmatter(this.plugin.app, file);
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
        changedFilePaths?: Set<string>,
    ): Promise<number> {
        let count = 0;
        const updatedFiles: TFile[] = [];
        let skippedUnsupported = 0;
        let skippedUnsafe = 0;
        let failures = 0;
        logger.flow('BulkEdit', 'apply:start', { files: files.length });

        await runInBatches(files, async (file) => {
            try {
                const extension = file.extension?.toLowerCase();
                if (extension !== 'md' && !this.plugin.canvasPropertiesService?.isCanvasFile(file)) {
                    skippedUnsupported++;
                    return;
                }
                if (extension === 'md' && !(await this.canMutateFrontmatterSafely(file))) {
                    skippedUnsafe++;
                    return;
                }
                this.plugin.recurrenceService?.markFileAsModified(file.path);
                const changed = await this.plugin.frontmatterMutationService.process(file, (fm) => {
                    callback(fm, file);
                });
                if (!changed) return;
                updatedFiles.push(file);
                changedFilePaths?.add(file.path);
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

    async updateFrontmatter(files: TFile[], updates: Record<string, any>): Promise<number> {
        logger.flow('BulkEdit', 'frontmatter:update-start', {
            files: files.length,
            keys: Object.keys(updates || {}).sort(),
            status: updates?.status ?? '',
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
            this.isChecklistCompletionStatus(updates.status) &&
            files.length === 1
        ) {
            const canProceed = await this.checklistHandler.handleChecklistCompletion(files[0]);
            if (!canProceed) {
                logger.flow('BulkEdit', 'frontmatter:update-canceled', {
                    files: files.length,
                    reason: 'open-checklist-guard',
                    path: files[0]?.path || '',
                    status: updates.status,
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
                    if (fm.status === 'complete' || fm.status === 'wont-do') continue;

                    const changeKeys = Object.keys(updates);
                    if (changeKeys.includes('status')) continue;

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

        const recurrenceStatuses = this.plugin.settings.recurrenceCompletionStatuses?.length
            ? this.plugin.settings.recurrenceCompletionStatuses
            : ['complete', 'wont-do'];
        const recurrenceCompletionSet = new Set(
            recurrenceStatuses.map((status) => this.normalizeStatusValue(status)).filter(Boolean),
        );
        const hasStatusUpdate = Object.prototype.hasOwnProperty.call(updates, 'status');
        const targetStatus = hasStatusUpdate ? this.normalizeStatusValue(updates.status) : '';

        const shouldCreateRecurrenceOnStatusUpdate =
            this.plugin.settings.enableRecurrence &&
            hasStatusUpdate &&
            recurrenceCompletionSet.has(targetStatus);

        const recurrenceCandidates = new Map<string, {
            file: TFile;
            expectedRule: string;
            expectedScheduled: string;
        }>();
        const changedFilePaths = new Set<string>();
        const count = await this.applyToFiles(files, (fm, file) => {
            if (shouldCreateRecurrenceOnStatusUpdate && file.extension?.toLowerCase() === 'md') {
                const expectedRule = this.normalizeRecurrenceRuleValue(
                    this.getFrontmatterValueCaseInsensitive(fm, 'recurrenceRule')
                    ?? this.getFrontmatterValueCaseInsensitive(fm, 'recurrence'),
                );
                const previousStatus = this.normalizeStatusValue(this.getFrontmatterValueCaseInsensitive(fm, 'status'));
                if (expectedRule && !recurrenceCompletionSet.has(previousStatus)) {
                    recurrenceCandidates.set(file.path, {
                        file,
                        expectedRule,
                        expectedScheduled: String(this.getFrontmatterValueCaseInsensitive(fm, 'scheduled') ?? '').trim(),
                    });
                } else {
                    recurrenceCandidates.delete(file.path);
                }
            }
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
        }, changedFilePaths);

        if (recurrenceCandidates.size > 0) {
            for (const candidate of recurrenceCandidates.values()) {
                if (!changedFilePaths.has(candidate.file.path)) continue;
                const liveSource = await this.captureLiveFrontmatter(candidate.file, (fm) => (
                    this.normalizeStatusValue(this.getFrontmatterValueCaseInsensitive(fm, 'status')) === targetStatus
                    && this.hasExpectedRecurrenceRule(fm, candidate.expectedRule)
                    && String(this.getFrontmatterValueCaseInsensitive(fm, 'scheduled') ?? '').trim() === candidate.expectedScheduled
                ));
                if (!liveSource || await this.shouldSkipNoteLevelRecurrence(candidate.file, liveSource.scheduled)) continue;
                const handled = await this.createNextRecurrenceInstance(
                    candidate.file,
                    liveSource,
                    { expectedStatus: targetStatus },
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
            status: updates.status ?? '',
            recurrenceCandidates: recurrenceCandidates.size,
        });
        return count;
    }

    async setStatus(files: TFile[], status: string): Promise<number> {
        // Parent link prompt (single file to avoid spam)
        if (
            this.plugin.settings.checkParentLinkStatuses &&
            this.parentLinkHandler.isCompletionStatus(status) &&
            files.length === 1
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
            files.length === 1
        ) {
            const canProceed = await this.checklistHandler.handleChecklistCompletion(files[0]);
            if (!canProceed) {
                return 0;
            }
        }

        return this.updateFrontmatter(files, { status });
    }

    async setPriority(files: TFile[], priority: string): Promise<number> {
        return this.updateFrontmatter(files, { priority });
    }

    async addTag(files: TFile[], tag: string, key: string = 'tags'): Promise<number> {
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

                if (fm && (fm.recurrenceRule || fm.recurrence) && fm.status !== 'complete' && fm.status !== 'wont-do') {
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
        });
    }

    async addListValues(files: TFile[], value: string, key: string): Promise<number> {
        if (this.isProtectedIdentityKey(key)) {
            new Notice(`Blocked protected key edit: ${key}`);
            logger.warn('[TPS GCM] Blocked protected identity key edit in addListValues', { key });
            return 0;
        }

        const property = this.plugin.settings.properties?.find((prop) => String(prop.key || '').toLowerCase() === String(key || '').toLowerCase());
        const values = property?.listItemType === 'link' ? parseLinkListInput(value) : parseStringListInput(value);
        if (!values.length) return 0;

        if (this.plugin.settings.enableRecurrence && this.plugin.settings.promptOnRecurrenceEdit) {
            for (const file of files) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;

                if (fm && (fm.recurrenceRule || fm.recurrence) && fm.status !== 'complete' && fm.status !== 'wont-do') {
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
                ? mergeLinkList(fm[targetKey], values)
                : mergeStringList(fm[targetKey], values);
            if (targetKey !== key && key in fm) {
                delete fm[key];
            }
        });
    }

    async removeListValues(files: TFile[], value: string, key: string): Promise<number> {
        if (this.isProtectedIdentityKey(key)) {
            new Notice(`Blocked protected key edit: ${key}`);
            logger.warn('[TPS GCM] Blocked protected identity key edit in removeListValues', { key });
            return 0;
        }

        const property = this.plugin.settings.properties?.find((prop) => String(prop.key || '').toLowerCase() === String(key || '').toLowerCase());
        const values = property?.listItemType === 'link' ? parseLinkListInput(value) : parseStringListInput(value);
        if (!values.length) return 0;

        if (this.plugin.settings.enableRecurrence && this.plugin.settings.promptOnRecurrenceEdit) {
            for (const file of files) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;

                if (fm && (fm.recurrenceRule || fm.recurrence) && fm.status !== 'complete' && fm.status !== 'wont-do') {
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
                ? removeLinkListValues(fm[targetKey], values)
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

                if (fm && (fm.recurrenceRule || fm.recurrence) && fm.status !== 'complete' && fm.status !== 'wont-do') {
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
                if (file.extension?.toLowerCase() !== 'md') return;
                if (!(await this.canMutateFrontmatterSafely(file))) return;

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
                await this.runSerializedFrontmatterWrite(file, async () => {
                    const content = await this.plugin.app.vault.read(file);
                    const nextContent = removeInlineTagsSafely(content, normalizedTags);
                    if (nextContent !== content) {
                        await this.plugin.app.vault.modify(file, nextContent);
                        bodyChanged = true;
                    }
                });

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
        const normalizedRule = this.normalizeRecurrenceRuleValue(rule);
        const hasTemplateFolder = !!(this.plugin.settings.recurringTemplateFolder || '').trim();

        if (normalizedRule && hasTemplateFolder) {
            let count = 0;
            for (const file of files) {
                const liveSource = await this.captureLiveFrontmatter(file);
                if (!liveSource) continue;
                if (await this.isDailyNoteRecurrenceDirectFile(file, liveSource.scheduled)) {
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

        const changedFilePaths = new Set<string>();
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
        }, changedFilePaths);

        if (normalizedRule && this.plugin.settings.enableRecurrence) {
            const recurrenceStatuses = new Set((this.plugin.settings.recurrenceCompletionStatuses?.length
                ? this.plugin.settings.recurrenceCompletionStatuses
                : ['complete', 'wont-do'])
                .map((status) => this.normalizeStatusValue(status))
                .filter(Boolean));
            const changedFiles = files.filter((file) => changedFilePaths.has(file.path));
            for (const file of changedFiles) {
                const liveSource = await this.captureLiveFrontmatter(file, (fm) => this.hasExpectedRecurrenceRule(fm, normalizedRule));
                if (!liveSource || await this.shouldSkipNoteLevelRecurrence(file, liveSource.scheduled)) continue;
                const liveStatus = this.normalizeStatusValue(this.getFrontmatterValueCaseInsensitive(liveSource, 'status'));
                if (recurrenceStatuses.has(liveStatus)) {
                    await this.createNextRecurrenceInstance(file, liveSource, { expectedStatus: liveStatus });
                }
            }

            await this.ensureRecurrenceTemplate(changedFiles);
        }

        return count;
    }

    private async applyRecurrenceDirectly(file: TFile, rule: string, endsOn: string | null): Promise<boolean> {
        if (!(await this.canMutateFrontmatterSafely(file))) return false;
        return this.runSerializedFrontmatterWrite(file, () =>
            this.plugin.frontmatterMutationService.process(file, (fmw) => {
                this.setFrontmatterValueCaseInsensitive(fmw, 'recurrenceRule', rule);
                this.deleteFrontmatterValueCaseInsensitive(fmw, 'recurrence');
                this.deleteFrontmatterValueCaseInsensitive(fmw, 'recurrenceTemplate');
                this.clearLegacyRecurrenceTemplateMarker(fmw);
                if (endsOn) {
                    this.setFrontmatterValueCaseInsensitive(fmw, 'recurrenceEnds', endsOn);
                } else {
                    this.deleteFrontmatterValueCaseInsensitive(fmw, 'recurrenceEnds');
                }
            })
        );
    }

    private async setRecurrenceUsingSeriesTemplate(file: TFile, rule: string, endsOn: string | null): Promise<boolean> {
        if (!(file instanceof TFile) || file.extension?.toLowerCase() !== 'md') return false;

        const fm = await this.captureLiveFrontmatter(file);
        if (!fm) return false;
        if (this.isRecurrenceTemplateFrontmatter(fm)) {
            const seriesBaseName = stripDateSuffix(file.basename).trim() || file.basename;
            if (!(await this.canMutateFrontmatterSafely(file))) return false;
            const outcome = await this.runSerializedFrontmatterWrite(file, () =>
                this.plugin.frontmatterMutationService.processGuardedWithOutcome(file, (fmw) => {
                    if (!this.isRecurrenceTemplateFrontmatter(fmw)
                        || this.getFrontmatterValueCaseInsensitive(fmw, 'scheduled')) return false;
                    this.initializeRecurrenceTemplateFrontmatter(fmw, seriesBaseName, rule, endsOn);
                    return true;
                })
            );
            const result = this.recurrenceMutationResult(outcome);
            return result.ready && result.changed;
        }

        const templateFile = await this.createOrUpdateRecurrenceTemplateFromInstance(file, fm, rule, endsOn);
        if (!(templateFile instanceof TFile)) return false;

        if (!(await this.canMutateFrontmatterSafely(file))) return false;
        const seriesBaseName = templateFile.basename;
        const sourceOutcome = await this.runSerializedFrontmatterWrite(file, () =>
            this.plugin.frontmatterMutationService.processWithOutcome(file, (fmw) => {
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
            })
        );
        const sourceResult = this.recurrenceMutationResult(sourceOutcome);
        if (!sourceResult.ready) {
            logger.warn('[TPS GCM] Recurrence source was not linked after template readiness', {
                source: file.path,
                template: templateFile.path,
                outcome: sourceResult.outcome,
                partialCommit: true,
            });
            return false;
        }
        return sourceResult.changed;
    }

    private async createOrUpdateRecurrenceTemplateFromInstance(
        file: TFile,
        frontmatter: any,
        rule: string,
        endsOn: string | null,
    ): Promise<TFile | null> {
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

        const expectedSourceRule = this.normalizeRecurrenceRuleValue(
            this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceRule')
            ?? this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrence'),
        );
        const expectedSourceScheduled = String(this.getFrontmatterValueCaseInsensitive(frontmatter, 'scheduled') ?? '').trim();
        const sourcePrecondition = (candidate: Record<string, any>): boolean => (
            !this.isRecurrenceTemplateFrontmatter(candidate)
            && String(this.getFrontmatterValueCaseInsensitive(candidate, 'scheduled') ?? '').trim() === expectedSourceScheduled
            && (!expectedSourceRule || this.hasExpectedRecurrenceRule(candidate, expectedSourceRule))
        );
        const liveSource = await this.captureLiveFrontmatter(file, sourcePrecondition);
        if (!liveSource) return null;

        const folderExists = await this.plugin.app.vault.adapter.exists(destFolderPath);
        if (!folderExists) {
            await this.plugin.app.vault.createFolder(destFolderPath);
        }

        const occupied = this.plugin.app.vault.getAbstractFileByPath(destFilePath);
        if (occupied && !(occupied instanceof TFile)) {
            logger.warn('[TPS GCM] Refusing recurrence template path collision', {
                source: file.path,
                occupiedPath: occupied.path,
            });
            new Notice(`Cannot create recurrence template: ${destFilePath} is occupied.`);
            return null;
        }
        let templateFile: TFile;
        let templateResult: RecurrenceMutationResult;
        if (occupied instanceof TFile) {
            const templateOutcome = await this.plugin.frontmatterMutationService.processGuardedWithOutcome(occupied, (fmw) => {
                // The ownership marker and absence of instance scheduling are the
                // authoritative collision guard. An unrelated file is untouched.
                if (!this.isRecurrenceTemplateFrontmatter(fmw)
                    || this.getFrontmatterValueCaseInsensitive(fmw, 'scheduled')) return false;
                this.initializeRecurrenceTemplateFrontmatter(fmw, seriesBaseName, rule, endsOn);
                return true;
            });
            templateResult = this.recurrenceMutationResult(templateOutcome);
            templateFile = occupied;
        } else {
            const sourceContent = await this.plugin.app.vault.read(file);
            if (!(await this.captureLiveFrontmatter(file, sourcePrecondition))) return null;
            const prepared = this.prepareRecurrenceCreateContent(sourceContent, (fmw) => {
                this.initializeRecurrenceTemplateFrontmatter(fmw, seriesBaseName, rule, endsOn);
            });
            if (!prepared.content || !isFrontmatterMutationReady(prepared.outcome)) return null;
            const created = await this.plugin.app.vault.create(destFilePath, prepared.content);
            if (!(created instanceof TFile)) return null;
            templateFile = created;
            templateResult = this.recurrenceMutationResult('changed');
        }

        if (!templateResult.ready
            || !(await this.isValidatedRecurrenceTemplate(templateFile, seriesBaseName, rule, destFilePath))) {
            logger.warn('[TPS GCM] Recurrence template mutation was refused', {
                source: file.path,
                template: templateFile.path,
                outcome: templateResult.outcome,
            });
            if (occupied) {
                new Notice(`Cannot create recurrence template: ${destFilePath} is not the owned template for this series.`);
            }
            return null;
        }
        if (templateResult.changed) {
            logger.log(`[TPS GCM] Updated recurrence template ${templateFile.path} from ${file.path}`);
        }
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
            try {
                const liveSource = await this.captureLiveFrontmatter(file, (fm) => !this.isRecurrenceTemplateFrontmatter(fm));
                if (!liveSource) continue;
                const rule = this.normalizeRecurrenceRuleValue(
                    this.getFrontmatterValueCaseInsensitive(liveSource, 'recurrenceRule')
                    ?? this.getFrontmatterValueCaseInsensitive(liveSource, 'recurrence'),
                );
                if (!rule) continue;
                if (await this.isDailyNoteRecurrenceDirectFile(file, liveSource.scheduled)) continue;

                const seriesBaseName = stripDateSuffix(file.basename).trim();
                if (!seriesBaseName) continue;
                const destFolderPath = normalizePath(templateFolder);
                const destFilePath = normalizePath(`${destFolderPath}/${seriesBaseName}.md`);
                if (normalizePath(file.path) === destFilePath) continue;
                const folderExists = await this.plugin.app.vault.adapter.exists(destFolderPath);
                if (!folderExists) await this.plugin.app.vault.createFolder(destFolderPath);

                const occupied = this.plugin.app.vault.getAbstractFileByPath(destFilePath);
                let templateFile: TFile;
                let createdTemplate = false;
                if (occupied) {
                    if (!(occupied instanceof TFile)
                        || !(await this.isValidatedRecurrenceTemplate(occupied, seriesBaseName, rule, destFilePath))) {
                        logger.warn('[TPS GCM] Existing recurrence template path is not owned by this series; instance link skipped', {
                            source: file.path,
                            occupiedPath: occupied.path,
                        });
                        continue;
                    }
                    templateFile = occupied;
                } else {
                    const content = await this.plugin.app.vault.read(file);
                    const endsOn = String(this.getFrontmatterValueCaseInsensitive(liveSource, 'recurrenceEnds') ?? '').trim() || null;
                    const prepared = this.prepareRecurrenceCreateContent(content, (fmw) => {
                        this.initializeRecurrenceTemplateFrontmatter(fmw, seriesBaseName, rule, endsOn);
                    });
                    if (!prepared.content || !isFrontmatterMutationReady(prepared.outcome)) {
                        logger.warn('[TPS GCM] Recurrence template create content was not ready', {
                            source: file.path,
                            outcome: prepared.outcome,
                        });
                        continue;
                    }
                    const created = await this.plugin.app.vault.create(destFilePath, prepared.content);
                    if (!(created instanceof TFile)
                        || !(await this.isValidatedRecurrenceTemplate(created, seriesBaseName, rule, destFilePath))) {
                        logger.warn('[TPS GCM] Created recurrence template failed ownership validation', {
                            source: file.path,
                            template: destFilePath,
                        });
                        continue;
                    }
                    templateFile = created;
                    createdTemplate = true;
                }

                const backlinkOutcome = await this.runSerializedFrontmatterWrite(file, () =>
                    this.plugin.frontmatterMutationService.processGuardedWithOutcome(file, (fmw) => {
                        if (this.isRecurrenceTemplateFrontmatter(fmw)
                            || !this.hasExpectedRecurrenceRule(fmw, rule)
                            || String(this.getFrontmatterValueCaseInsensitive(fmw, 'scheduled') ?? '').trim()
                                !== String(this.getFrontmatterValueCaseInsensitive(liveSource, 'scheduled') ?? '').trim()) return false;
                        this.setFrontmatterValueCaseInsensitive(
                            fmw,
                            'recurrenceTemplate',
                            this.buildRecurrenceTemplateLink(templateFile, file, seriesBaseName),
                        );
                        return true;
                    })
                );
                const backlinkResult = this.recurrenceMutationResult(backlinkOutcome);
                if (!backlinkResult.ready) {
                    logger.warn('[TPS GCM] Recurrence template is ready but source backlink was refused', {
                        source: file.path,
                        template: templateFile.path,
                        outcome: backlinkResult.outcome,
                        partialCommit: createdTemplate,
                    });
                    if (createdTemplate) new Notice(`Recurring template created, but ${file.basename} changed before it could be linked.`);
                    continue;
                }

                if (createdTemplate) {
                    logger.log(`[TPS GCM] Created series template for ${file.path} at ${destFilePath}`);
                    new Notice(`Recurring series template created: ${seriesBaseName}.md`);
                }
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

    async updateScheduledDetails(files: TFile[], scheduled: string | null, timeEstimate: number | null, allDay: boolean, key: string = 'scheduled'): Promise<number> {
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
        });
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

    private async bootstrapTemplateInstanceFromToday(templateFile: TFile): Promise<boolean> {
        const seriesBaseName = stripDateSuffix(templateFile.basename).trim();
        if (!seriesBaseName) return false;
        const liveTemplate = await this.captureLiveFrontmatter(templateFile, (frontmatter) => (
            this.isRecurrenceTemplateFrontmatter(frontmatter)
            && !this.getFrontmatterValueCaseInsensitive(frontmatter, 'scheduled')
        ));
        if (!liveTemplate) return false;
        const recurrenceRule = this.normalizeRecurrenceRuleValue(
            this.getFrontmatterValueCaseInsensitive(liveTemplate, 'recurrenceRule')
            ?? this.getFrontmatterValueCaseInsensitive(liveTemplate, 'recurrence'),
        );
        if (!recurrenceRule) return false;

        for (const candidate of this.plugin.app.vault.getMarkdownFiles()) {
            if (candidate.path === templateFile.path) continue;
            const existingInstance = await this.captureLiveFrontmatter(candidate, (frontmatter) => (
                !this.isRecurrenceTemplateFrontmatter(frontmatter)
                && this.frontmatterReferencesSeriesTemplate(frontmatter, seriesBaseName, templateFile, candidate.path)
            ));
            if (existingInstance) return false;
        }

        const firstOccurrence = this.getFirstOccurrenceFromToday(recurrenceRule);
        if (!firstOccurrence) return false;

        const dateStr = window.moment(firstOccurrence).format(this.getDailyNoteDateFormat());
        const newFileName = `${seriesBaseName} ${dateStr}.md`;
        const parentPath = templateFile.parent?.path || '';
        const newFilePath = normalizePath(parentPath ? `${parentPath}/${newFileName}` : newFileName);

        const scheduled = window.moment(firstOccurrence).format('YYYY-MM-DD HH:mm:ss');
        if (this.plugin.app.vault.getAbstractFileByPath(newFilePath)) return false;

        const content = await this.plugin.app.vault.read(templateFile);
        if (!(await this.isValidatedRecurrenceTemplate(templateFile, seriesBaseName, recurrenceRule, templateFile.path))) {
            return false;
        }
        const prepared = this.prepareRecurrenceCreateContent(content, (fmw) => {
            this.initializeRecurrenceInstanceFrontmatter(fmw, {
                rule: recurrenceRule,
                scheduled,
                status: '',
                templateFile,
                instancePath: newFilePath,
                seriesBaseName,
            });
        });
        if (!prepared.content || !isFrontmatterMutationReady(prepared.outcome)) return false;
        const created = await this.plugin.app.vault.create(newFilePath, prepared.content);
        if (!(created instanceof TFile)) return false;
        const ready = await this.hasAtomicFrontmatterState(created, (frontmatter) => (
            !this.isRecurrenceTemplateFrontmatter(frontmatter)
            && String(this.getFrontmatterValueCaseInsensitive(frontmatter, 'scheduled') ?? '').trim() === scheduled
            && this.hasExpectedRecurrenceRule(frontmatter, recurrenceRule)
            && this.frontmatterReferencesSeriesTemplate(frontmatter, seriesBaseName, templateFile, created.path)
        ));
        if (!ready) return false;

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

    async createNextRecurrenceInstance(
        file: TFile,
        frontmatter: any,
        expectation?: RecurrenceCreateExpectation | string | null,
    ): Promise<boolean> {
        if (this.recurrenceCreationInProgress.has(file.path)) {
            logger.warn('[TPS GCM] Recurrence creation already in progress:', file.path);
            return false;
        }

        this.recurrenceCreationInProgress.add(file.path);
        let acquiredLease: RecurrenceOpLease | null = null;
        let recurrenceRuleForLog = '';
        let scheduledForLog = '';

        try {
            const expectedRule = this.normalizeRecurrenceRuleValue(
                this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrenceRule')
                ?? this.getFrontmatterValueCaseInsensitive(frontmatter, 'recurrence'),
            );
            const expectedScheduled = String(this.getFrontmatterValueCaseInsensitive(frontmatter, 'scheduled') ?? '').trim();
            const expectedStatus = this.normalizeStatusValue(
                typeof expectation === 'object' && expectation
                    ? expectation.expectedStatus
                    : expectation,
            );
            if (!expectedRule) return false;
            const liveSource = await this.captureLiveFrontmatter(file, (candidate) => (
                this.hasExpectedRecurrenceRule(candidate, expectedRule)
                && String(this.getFrontmatterValueCaseInsensitive(candidate, 'scheduled') ?? '').trim() === expectedScheduled
                && (!expectedStatus
                    || this.normalizeStatusValue(this.getFrontmatterValueCaseInsensitive(candidate, 'status')) === expectedStatus)
                && !this.isRecurrenceTemplateFrontmatter(candidate)
            ));
            if (!liveSource) return false;

            const recurrenceRule = this.normalizeRecurrenceRuleValue(
                this.getFrontmatterValueCaseInsensitive(liveSource, 'recurrenceRule')
                ?? this.getFrontmatterValueCaseInsensitive(liveSource, 'recurrence'),
            );
            const currentScheduled = String(this.getFrontmatterValueCaseInsensitive(liveSource, 'scheduled') ?? '').trim();
            const currentStatus = this.normalizeStatusValue(
                this.getFrontmatterValueCaseInsensitive(liveSource, 'status'),
            );
            recurrenceRuleForLog = recurrenceRule;
            scheduledForLog = currentScheduled;
            if (await this.shouldSkipNoteLevelRecurrence(file, currentScheduled)) {
                logger.warn('[TPS GCM] Skipping note-level recurrence creation for configured daily note:', file.path);
                if (
                    String(this.getFrontmatterValueCaseInsensitive(liveSource, 'recurrenceRule') ?? '').trim().toLowerCase() === 'dailynote'
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

            const baseName = stripDateSuffix(file.basename).trim();
            if (!baseName || baseName.length > 255) throw new Error(`Invalid recurrence series name: ${baseName}`);
            const recurrenceTemplateFolderSetting = normalizePath((this.plugin.settings.recurringTemplateFolder || '').trim());
            let contentSource: TFile = file;
            let seriesTemplateFile = await this.resolveValidatedRecurrenceTemplateFile(file, liveSource, recurrenceRule);
            let templateCreatedThisRun = false;
            const rawTemplate = this.getFrontmatterValueCaseInsensitive(liveSource, 'recurrenceTemplate');
            if (seriesTemplateFile instanceof TFile) {
                contentSource = seriesTemplateFile;
                logger.log('[TPS GCM] Using linked series template for next recurrence instance:', seriesTemplateFile.path);
            } else if (rawTemplate != null && rawTemplate !== '' && rawTemplate !== false) {
                logger.warn('[TPS GCM] Refusing recurrence creation from an invalid linked template', {
                    source: file.path,
                    template: String(rawTemplate),
                });
                return false;
            } else if (recurrenceTemplateFolderSetting) {
                const templatePath = normalizePath(`${recurrenceTemplateFolderSetting}/${baseName}.md`);
                const existingTemplate = this.plugin.app.vault.getAbstractFileByPath(templatePath);
                if (existingTemplate) {
                    logger.warn('[TPS GCM] Refusing recurrence creation because configured template path is not a validated series template', {
                        source: file.path,
                        template: existingTemplate.path,
                    });
                    return false;
                } else {
                    const endsOn = String(this.getFrontmatterValueCaseInsensitive(liveSource, 'recurrenceEnds') ?? '').trim() || null;
                    seriesTemplateFile = await this.createOrUpdateRecurrenceTemplateFromInstance(file, liveSource, recurrenceRule, endsOn);
                    if (!(seriesTemplateFile instanceof TFile)) return false;
                    templateCreatedThisRun = true;
                    contentSource = seriesTemplateFile;
                }
            }

            if (seriesTemplateFile instanceof TFile
                && !(await this.isValidatedRecurrenceTemplate(
                    seriesTemplateFile,
                    baseName,
                    recurrenceRule,
                    recurrenceTemplateFolderSetting
                        ? normalizePath(`${recurrenceTemplateFolderSetting}/${baseName}.md`)
                        : undefined,
                ))) return false;

            if (seriesTemplateFile instanceof TFile
                && !this.frontmatterReferencesSeriesTemplate(liveSource, baseName, seriesTemplateFile, file.path)) {
                const readyTemplate = seriesTemplateFile;
                const backlinkOutcome = await this.runSerializedFrontmatterWrite(file, () =>
                    this.plugin.frontmatterMutationService.processGuardedWithOutcome(file, (candidate) => {
                        if (!this.hasExpectedRecurrenceRule(candidate, recurrenceRule)
                            || String(this.getFrontmatterValueCaseInsensitive(candidate, 'scheduled') ?? '').trim() !== currentScheduled
                            || this.isRecurrenceTemplateFrontmatter(candidate)) return false;
                        this.setFrontmatterValueCaseInsensitive(
                            candidate,
                            'recurrenceTemplate',
                            this.buildRecurrenceTemplateLink(readyTemplate, file, baseName),
                        );
                        return true;
                    })
                );
                const backlinkResult = this.recurrenceMutationResult(backlinkOutcome);
                if (!backlinkResult.ready) {
                    logger.warn('[TPS GCM] Recurrence template is ready but source backlink was refused', {
                        source: file.path,
                        template: readyTemplate.path,
                        outcome: backlinkResult.outcome,
                        partialCommit: templateCreatedThisRun,
                    });
                    return false;
                }
            }

            const chainId = this.resolveRecurrenceChainId(file, liveSource, recurrenceRule);
            const parentPath = file.parent?.path || '';
            const newStatus = (this.plugin.settings.recurrenceDefaultStatus || '').trim();
            const targetIsReady = (targetFile: TFile, expectedScheduled: string | null): Promise<boolean> => (
                this.hasAtomicFrontmatterState(targetFile, (targetFrontmatter) => {
                    const scheduled = String(this.getFrontmatterValueCaseInsensitive(targetFrontmatter, 'scheduled') ?? '').trim();
                    const status = this.normalizeStatusValue(this.getFrontmatterValueCaseInsensitive(targetFrontmatter, 'status'));
                    const expectedStatus = this.normalizeStatusValue(newStatus);
                    if (expectedScheduled === null ? !!scheduled : scheduled !== expectedScheduled) return false;
                    if (!this.hasExpectedRecurrenceRule(targetFrontmatter, recurrenceRule)) return false;
                    if (this.isRecurrenceTemplateFrontmatter(targetFrontmatter)) return false;
                    if (this.getFrontmatterValueCaseInsensitive(targetFrontmatter, 'completedDate') != null) return false;
                    if (expectedStatus ? status !== expectedStatus : !!status) return false;
                    if (seriesTemplateFile instanceof TFile
                        && !this.frontmatterReferencesSeriesTemplate(
                            targetFrontmatter,
                            baseName,
                            seriesTemplateFile,
                            targetFile.path,
                        )) return false;
                    if (!(seriesTemplateFile instanceof TFile)
                        && this.getFrontmatterValueCaseInsensitive(targetFrontmatter, 'recurrenceTemplate') != null) return false;
                    return true;
                })
            );
            const trackerGeneratedPath = isTrackerRecurrence ? this.getGeneratedTrackerPath(liveSource) : null;
            if (trackerGeneratedPath && await this.plugin.app.vault.adapter.exists(trackerGeneratedPath)) {
                const trackerParent = trackerGeneratedPath.includes('/')
                    ? trackerGeneratedPath.split('/').slice(0, -1).join('/')
                    : '';
                const trackerBasename = trackerGeneratedPath.split('/').pop()?.replace(/\.md$/i, '') || '';
                if (normalizePath(trackerParent) !== normalizePath(parentPath)
                    || !(trackerBasename === baseName || trackerBasename.startsWith(`${baseName} `))) return false;
                const generatedFile = this.plugin.app.vault.getAbstractFileByPath(trackerGeneratedPath);
                if (!(generatedFile instanceof TFile) || !(await targetIsReady(generatedFile, null))) return false;
                return this.markRecurrenceGenerated(file, this.buildTrackerGeneratedValue(trackerGeneratedPath), {
                    rule: recurrenceRule,
                    scheduled: currentScheduled,
                    status: currentStatus,
                    templateFile: seriesTemplateFile,
                    seriesBaseName: baseName,
                });
            }

            const dateStr = nextDate ? window.moment(nextDate).format(this.getDailyNoteDateFormat()) : '';
            const newFileName = isTrackerRecurrence
                ? (await this.getAvailableUndatedRecurrencePath(parentPath, baseName)).name
                : `${baseName} ${dateStr}.md`;
            const newFilePath = normalizePath(parentPath ? `${parentPath}/${newFileName}` : newFileName);
            const newScheduled = nextDate ? window.moment(nextDate).format('YYYY-MM-DD HH:mm:ss') : this.buildTrackerGeneratedValue(newFilePath);
            if (!isTrackerRecurrence && this.hasGeneratedRecurrence(liveSource, newScheduled) && await this.plugin.app.vault.adapter.exists(newFilePath)) {
                const generatedFile = this.plugin.app.vault.getAbstractFileByPath(newFilePath);
                if (!(generatedFile instanceof TFile) || !(await targetIsReady(generatedFile, newScheduled))) return false;
                return this.markRecurrenceGenerated(file, newScheduled, {
                    rule: recurrenceRule,
                    scheduled: currentScheduled,
                    status: currentStatus,
                    templateFile: seriesTemplateFile,
                    seriesBaseName: baseName,
                });
            }
            const recurrenceOpKey = this.buildRecurrenceOpKey(chainId, newScheduled);

            const beginResult = await this.beginRecurrenceOp(recurrenceOpKey, newFilePath);
            if (beginResult.status !== 'acquired') {
                if (beginResult.status === 'inflight') {
                    logger.log('[TPS GCM] Recurrence operation already in flight for', newFilePath);
                    return false;
                }
                if (beginResult.status !== 'exists') return false;
                const opTarget = this.getRecurrenceOpTarget(recurrenceOpKey);
                if (opTarget === newFilePath && await this.plugin.app.vault.adapter.exists(opTarget)) {
                    const targetFile = this.plugin.app.vault.getAbstractFileByPath(opTarget);
                    if (!(targetFile instanceof TFile) || !(await targetIsReady(targetFile, isTrackerRecurrence ? null : newScheduled))) return false;
                    if (!(await this.markRecurrenceGenerated(file, newScheduled, {
                        rule: recurrenceRule,
                        scheduled: currentScheduled,
                        status: currentStatus,
                        templateFile: seriesTemplateFile,
                        seriesBaseName: baseName,
                    }))) return false;
                    logger.log('[TPS GCM] Next recurrence already created at', opTarget);
                    return true;
                }
                return false;
            }
            acquiredLease = beginResult.lease;

            if (await this.plugin.app.vault.adapter.exists(newFilePath)) {
                const targetFile = this.plugin.app.vault.getAbstractFileByPath(newFilePath);
                if (!(targetFile instanceof TFile) || !(await targetIsReady(targetFile, isTrackerRecurrence ? null : newScheduled))) {
                    throw new Error(`Existing path is not a ready recurrence target: ${newFilePath}`);
                }
                if (!(await this.markRecurrenceGenerated(file, newScheduled, {
                    rule: recurrenceRule,
                    scheduled: currentScheduled,
                    status: currentStatus,
                    templateFile: seriesTemplateFile,
                    seriesBaseName: baseName,
                }))) {
                    throw new Error(`Failed to record generated recurrence on ${file.path}`);
                }
                if (!(await this.completeRecurrenceOp(acquiredLease, newFilePath))) {
                    throw new Error(`Failed to persist completed recurrence operation for ${newFilePath}`);
                }
                acquiredLease = null;
                new Notice(`Next recurrence already exists: ${newFileName}`);
                return true;
            }

            const content = await this.plugin.app.vault.read(contentSource);
            if (seriesTemplateFile instanceof TFile
                && !(await this.isValidatedRecurrenceTemplate(seriesTemplateFile, baseName, recurrenceRule, seriesTemplateFile.path))) {
                throw new Error(`Recurrence template changed before clone: ${seriesTemplateFile.path}`);
            }
            const prepared = this.prepareRecurrenceCreateContent(content, (fm) => {
                this.initializeRecurrenceInstanceFrontmatter(fm, {
                    rule: recurrenceRule,
                    scheduled: isTrackerRecurrence ? null : newScheduled,
                    status: newStatus,
                    templateFile: seriesTemplateFile,
                    instancePath: newFilePath,
                    seriesBaseName: baseName,
                });
            });
            if (!prepared.content || !isFrontmatterMutationReady(prepared.outcome)) {
                throw new Error(`Failed to prepare recurrence frontmatter for ${newFilePath}`);
            }
            const sourceStillReady = await this.captureLiveFrontmatter(file, (candidate) => (
                this.hasExpectedRecurrenceRule(candidate, recurrenceRule)
                && String(this.getFrontmatterValueCaseInsensitive(candidate, 'scheduled') ?? '').trim() === currentScheduled
                && this.normalizeStatusValue(this.getFrontmatterValueCaseInsensitive(candidate, 'status')) === currentStatus
                && (seriesTemplateFile instanceof TFile
                    ? this.frontmatterReferencesSeriesTemplate(
                        candidate,
                        baseName,
                        seriesTemplateFile,
                        file.path,
                    )
                    : this.getFrontmatterValueCaseInsensitive(candidate, 'recurrenceTemplate') == null)
            ));
            if (!sourceStillReady) throw new Error(`Recurrence source changed before create: ${file.path}`);

            const newFile = await this.plugin.app.vault.create(newFilePath, prepared.content);
            if (!(newFile instanceof TFile)
                || !(await targetIsReady(newFile, isTrackerRecurrence ? null : newScheduled))) {
                throw new Error(`Created recurrence target failed validation: ${newFilePath}`);
            }

            if (!(await this.markRecurrenceGenerated(file, newScheduled, {
                rule: recurrenceRule,
                scheduled: currentScheduled,
                status: currentStatus,
                templateFile: seriesTemplateFile,
                seriesBaseName: baseName,
            }))) {
                throw new Error(`Failed to record generated recurrence on ${file.path}`);
            }
            if (!(await this.completeRecurrenceOp(acquiredLease, newFilePath))) {
                throw new Error(`Failed to persist completed recurrence operation for ${newFilePath}`);
            }
            acquiredLease = null;

            new Notice(isTrackerRecurrence ? `Created next tracker: ${newFileName}` : `Created next recurrence: ${newFileName}`);
            return true;
        } catch (error) {
            logger.error('[TPS GCM] Failed to create next recurrence instance for', file.path, ':', error);
            logger.error('[TPS GCM] Error details - Rule:', recurrenceRuleForLog, 'Scheduled:', scheduledForLog, 'Error type:', error instanceof Error ? error.constructor.name : typeof error);
            if (error instanceof Error && error.stack) {
                logger.error('[TPS GCM] Stack trace:', error.stack);
            }
            new Notice(`Failed to create next recurrence instance. Check console for details.`);
            return false;
        } finally {
            if (acquiredLease) await this.failRecurrenceOp(acquiredLease);
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
        const templateCache = this.plugin.app.metadataCache.getFileCache(templateFile);
        const templateFm = templateCache?.frontmatter;
        if (!templateFm) return 0;

        const seriesName = templateFile.basename.toLowerCase();

        // Fields that must NEVER be copied from the template to instances
        const SKIP_KEYS = new Set([
            'isrecurrencetemplate', 'recurrencestarted', 'recurrenceends',
            'recurrencetemplate', 'scheduled', 'status', 'completeddate',
            'sort', 'icon', 'color', 'hidden', 'datecreated', 'datemodified',
            'startedat', 'endedat', 'durationseconds', 'timeestimate',
            'previouscompleteddate', 'secondssincepreviouscompletion',
            'lastcompleteddate', 'lastsessionpath', 'nextelegibledate',
        ]);

        // Build propagatable update set from the template's frontmatter
        const updates: Record<string, any> = {};
        for (const [key, value] of Object.entries(templateFm)) {
            if (!SKIP_KEYS.has(key.toLowerCase())) {
                updates[key] = value;
            }
        }
        if (Object.keys(updates).length === 0) return 0;

        // Completion statuses — instances in these states are skipped
        const completionSet = new Set(
            (this.plugin.settings.recurrenceCompletionStatuses?.length
                ? this.plugin.settings.recurrenceCompletionStatuses
                : ['complete', 'wont-do']
            ).map((s: string) => s.trim().toLowerCase())
        );

        // Find all open instances that reference this series template
        const openInstances: TFile[] = [];
        for (const file of this.plugin.app.vault.getMarkdownFiles()) {
            if (file.path === templateFile.path) continue;

            const cache = this.plugin.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            if (!fm) continue;

            // Check recurrenceTemplate link — value may be wikilink format [[Name]]
            if (!this.frontmatterReferencesSeriesTemplate(fm, seriesName, templateFile, file.path)) continue;

            // Skip completed/wont-do instances
            const status = String(fm.status ?? '').trim().toLowerCase();
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
            const files = this.plugin.app.vault.getMarkdownFiles();
            let createdCount = 0;

            const recurrenceStatuses = (this.plugin.settings.recurrenceCompletionStatuses?.length
                ? this.plugin.settings.recurrenceCompletionStatuses
                : ['complete', 'wont-do']
            ).map((s: string) => s.trim().toLowerCase());

            // Collect active recurring notes that are missing a series template
            const needsTemplate: TFile[] = [];
            const needsRelink: Array<{
                file: TFile;
                templateFile: TFile;
                seriesBaseName: string;
                expectedRule: string;
                expectedScheduled: string;
            }> = [];

            for (const file of files) {
                const fm = await this.captureLiveFrontmatter(file);
                if (!fm) continue;

                const recurrenceRule = this.resolveRecurrenceRule(fm);
                if (!recurrenceRule) continue;
                if (await this.isConfiguredDailyNoteTemplate(file)) continue;
                if (await this.shouldSkipNoteLevelRecurrence(file, fm.scheduled)) continue;

                if (this.isFileInRecurrenceTemplateFolder(file)) {
                    // Folder placement alone is not ownership. Never convert an
                    // unmarked note into a recurrence template during background QA.
                    if (!this.isRecurrenceTemplateFrontmatter(fm)
                        || this.getFrontmatterValueCaseInsensitive(fm, 'scheduled')) continue;
                    const bootstrapped = await this.bootstrapTemplateInstanceFromToday(file);
                    if (bootstrapped) {
                        createdCount++;
                    }
                    continue;
                }

                // Skip template files themselves
                if (this.isRecurrenceTemplateFrontmatter(fm)) continue;

                const isCompleted = recurrenceStatuses.includes(
                    String(fm.status ?? '').trim().toLowerCase()
                );

                if (isCompleted) {
                    const handled = await this.createNextRecurrenceInstance(file, fm, {
                        expectedStatus: this.normalizeStatusValue(fm.status),
                    });
                    if (handled) {
                        createdCount++;
                    }
                } else {
                    // Active instance — check if its series template is missing
                    const templateFolderSetting = (this.plugin.settings.recurringTemplateFolder || '').trim();
                    if (templateFolderSetting) {
                        if (await this.isConfiguredDailyNote(file, fm.scheduled)) continue;
                        const seriesBaseName = stripDateSuffix(file.basename).trim();
                        const templatePath = normalizePath(`${templateFolderSetting}/${seriesBaseName}.md`);
                        const templateEntry = await this.resolveValidatedRecurrenceTemplateFile(file, fm, recurrenceRule);
                        if (!(templateEntry instanceof TFile)) {
                            if (!this.plugin.app.vault.getAbstractFileByPath(templatePath)) needsTemplate.push(file);
                        } else if (!this.frontmatterReferencesSeriesTemplate(fm, seriesBaseName, templateEntry, file.path)) {
                            needsRelink.push({
                                file,
                                templateFile: templateEntry,
                                seriesBaseName,
                                expectedRule: recurrenceRule,
                                expectedScheduled: String(this.getFrontmatterValueCaseInsensitive(fm, 'scheduled') ?? '').trim(),
                            });
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
                let templatesCreated = 0;
                const deduped = needsTemplate.filter(f => {
                    const key = stripDateSuffix(f.basename).trim().toLowerCase();
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                for (const file of deduped) {
                    const fm = await this.captureLiveFrontmatter(file, (candidate) => !this.isRecurrenceTemplateFrontmatter(candidate));
                    if (!fm) continue;
                    if (await this.isDailyNoteRecurrenceDirectFile(file, fm?.scheduled)) continue;
                    const recurrenceRule = this.resolveRecurrenceRule(fm);
                    if (recurrenceRule) {
                        const endsOn = String(this.getFrontmatterValueCaseInsensitive(fm, 'recurrenceEnds') || '').trim() || null;
                        if (await this.setRecurrenceUsingSeriesTemplate(file, recurrenceRule, endsOn)) {
                            templatesCreated += 1;
                        }
                    }
                }
                if (templatesCreated > 0) {
                    logger.log(`[TPS GCM] Created ${templatesCreated} missing series template(s).`);
                }
            }

            if (needsRelink.length > 0) {
                let relinkedCount = 0;
                for (const row of needsRelink) {
                    const { file, templateFile, seriesBaseName, expectedRule, expectedScheduled } = row;
                    if (!(await this.isValidatedRecurrenceTemplate(
                        templateFile,
                        seriesBaseName,
                        expectedRule,
                        templateFile.path,
                    ))) continue;
                    if (!(await this.canMutateFrontmatterSafely(file))) continue;
                    const relinkOutcome = await this.runSerializedFrontmatterWrite(file, () =>
                        this.plugin.frontmatterMutationService.processGuardedWithOutcome(file, (fmw) => {
                            if (!this.hasExpectedRecurrenceRule(fmw, expectedRule)
                                || String(this.getFrontmatterValueCaseInsensitive(fmw, 'scheduled') ?? '').trim() !== expectedScheduled
                                || this.isRecurrenceTemplateFrontmatter(fmw)) return false;
                            if (this.frontmatterReferencesSeriesTemplate(fmw, seriesBaseName, templateFile, file.path)) {
                                return 'unchanged';
                            }
                            this.setFrontmatterValueCaseInsensitive(
                                fmw,
                                'recurrenceTemplate',
                                this.buildRecurrenceTemplateLink(templateFile, file, seriesBaseName),
                            );
                            return true;
                        })
                    );
                    const relinkResult = this.recurrenceMutationResult(relinkOutcome);
                    if (relinkResult.changed) relinkedCount += 1;
                }
                if (relinkedCount > 0) {
                    logger.log(`[TPS GCM] Relinked ${relinkedCount} recurrence instance(s) to series templates.`);
                }
            }
        } finally {
            this.checkMissingRecurrencesRunning = false;
        }
    }

    async clearRecurrenceRule(file: TFile): Promise<void> {
        if (!(await this.canMutateFrontmatterSafely(file))) return;
        await this.runSerializedFrontmatterWrite(file, () =>
            this.plugin.frontmatterMutationService.processGuarded(file, (fm) => {
                const hasRule = this.findFrontmatterKeyCaseInsensitive(fm, 'recurrenceRule') != null;
                const hasLegacyRule = this.findFrontmatterKeyCaseInsensitive(fm, 'recurrence') != null;
                if (!hasRule && !hasLegacyRule) return false;
                this.deleteFrontmatterValueCaseInsensitive(fm, 'recurrenceRule');
                this.deleteFrontmatterValueCaseInsensitive(fm, 'recurrence');
                return true;
            })
        );
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

                const didChange = await this.runSerializedFrontmatterWrite(parentFile, () =>
                    this.plugin.frontmatterMutationService.processGuarded(parentFile, (fm) => {
                        if (!fm || typeof fm !== 'object') return false;

                        const existingTagKey = this.findFrontmatterKeyCaseInsensitive(fm, 'tags');
                        const existingRaw = existingTagKey ? fm[existingTagKey] : undefined;
                        const existingTags = normalizeTagList(existingRaw);
                        const mergedTags = mergeNormalizedTags(existingRaw, parentTags);
                        const unchanged =
                            existingTags.length === mergedTags.length &&
                            existingTags.every((tag, index) => tag === mergedTags[index]);

                        if (unchanged) return false;

                        this.setFrontmatterValueCaseInsensitive(fm, 'tags', mergedTags);
                        return true;
                    })
                );

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
        const cache = this.plugin.app.metadataCache.getFileCache(parentFile);
        const frontmatter = (cache?.frontmatter || {}) as Record<string, any>;
        const parentTags = parseTagInput([frontmatter.tags, frontmatter.tag]);
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
                    .filter((file): file is TFile => file instanceof TFile && file.extension?.toLowerCase() === 'md')
                    .map((file) => [file.path, file]),
            ).values(),
        );

        await runInBatches(uniqueChildren, async (childFile) => {
            try {
                if (!(await this.canMutateFrontmatterSafely(childFile))) return;

                const didChange = await this.runSerializedFrontmatterWrite(childFile, () =>
                    this.plugin.frontmatterMutationService.processGuarded(childFile, (fm) => {
                        if (!fm || typeof fm !== 'object') return false;

                        const existingTagKey = this.findFrontmatterKeyCaseInsensitive(fm, 'tags');
                        const existingRaw = existingTagKey ? fm[existingTagKey] : undefined;
                        const existingTags = normalizeTagList(existingRaw);
                        const mergedTags = mergeNormalizedTags(existingRaw, parentTags);
                        const unchanged =
                            existingTags.length === mergedTags.length &&
                            existingTags.every((tag, index) => tag === mergedTags[index]);

                        if (unchanged) return false;

                        this.setFrontmatterValueCaseInsensitive(fm, 'tags', mergedTags);
                        return true;
                    })
                );

                if (didChange) updatedFiles.push(childFile);
            } catch (error) {
                logger.error(`[TPS GCM] Failed inheriting parent tags into ${childFile.path}:`, error);
            }
        }, 20);

        return updatedFiles;
    }

    async linkToParent(files: TFile[], parentFile: TFile): Promise<number> {
        let count = 0;
        const changedFiles = new Map<string, TFile>();
        for (const file of files) {
            const changed = await this.plugin.subitemRelationshipSyncService.linkExistingChildToParent(file, parentFile, {
                insertBodyLink: false,
            });
            if (changed) {
                count += 1;
                changedFiles.set(file.path, file);
            }
            if (this.plugin.settings.autoSaveFolderPath) {
                const folderChanged = await this.plugin.frontmatterMutationService.process(file, (fm) => {
                    this.setFrontmatterValueCaseInsensitive(fm as Record<string, any>, 'folderPath', file.parent?.path || '/');
                });
                if (folderChanged) changedFiles.set(file.path, file);
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
            this.publishRelationshipFollowUp(affected, [parentKey, 'tags']);
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
        return this.runSerializedFrontmatterWrite(parentFile, () =>
            this.plugin.frontmatterMutationService.processGuarded(parentFile, (fm) => {
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
                    return false;
                }
                this.setFrontmatterValueCaseInsensitive(
                    fm,
                    parentKey,
                    dedupedValues,
                );
                return true;
            })
        );
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
        return this.runSerializedFrontmatterWrite(parentFile, () =>
            this.plugin.frontmatterMutationService.processGuarded(parentFile, (fm) => {
                const key = Object.keys(fm).find((k) => k.toLowerCase() === childKey.toLowerCase());
                if (!key) return false;
                const raw = fm[key];
                const arr: any[] = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
                const filtered = arr.filter((v: any) => !linkValueMatchesFile(this.plugin.app, v, parentFile.path, childFile));
                if (filtered.length === arr.length) return false;
                if (filtered.length === 0) {
                    delete fm[key];
                } else {
                    fm[key] = filtered;
                }
                return true;
            })
        );
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
            let pendingAdded = 0;
            const outcome = await this.plugin.subitemRelationshipSyncService.mutateMarkdownBodyWithOutcome(
                currentFile,
                (lines, content) => {
                    const existingEmbedTargets = this.collectEmbeddedTargetPaths(content, currentFile);
                    const embeds: string[] = [];
                    for (const file of uniqueFiles) {
                        if (existingEmbedTargets.has(file.path)) continue;
                        embeds.push(this.generateEmbedLink(file, currentFile));
                        existingEmbedTargets.add(file.path);
                    }
                    if (!embeds.length) return false;
                    const nextContent = `${content.trimEnd()}\n\n${embeds.join('\n')}\n`;
                    lines.splice(0, lines.length, ...nextContent.split('\n'));
                    pendingAdded = embeds.length;
                    return true;
                },
            );
            if (outcome === 'changed') added = pendingAdded;
        });

        if (added > 0) {
            this.publishRelationshipFollowUp([currentFile], [], 350);
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

    async hasAttachmentRelationAuthoritatively(parentFile: TFile, attachmentFile: TFile): Promise<boolean | null> {
        if (parentFile.extension?.toLowerCase() !== 'md') return false;
        try {
            const content = await this.plugin.subitemRelationshipSyncService.readMarkdownText(parentFile);
            return this.collectEmbeddedTargetPaths(content, parentFile).has(attachmentFile.path);
        } catch (error) {
            logger.flowWarn('AttachmentLink', 'live-postcondition-read-refused', {
                parent: parentFile.path,
                attachment: attachmentFile.path,
                error: logger.errorSummary(error),
            });
            return null;
        }
    }

    /**
     * Removes a frontmatter key+value from each of the given files.
     * The key match is case-insensitive so it works regardless of casing variation.
     */
    async removeFrontmatterKey(files: TFile[], key: string): Promise<number> {
        let count = 0;
        const updatedFiles: TFile[] = [];
        for (const file of files) {
            try {
                const outcome = await this.plugin.frontmatterMutationService.processGuardedWithOutcome(file, (fm) => {
                    const actualKey = Object.keys(fm).find(k => k.toLowerCase() === key.toLowerCase());
                    if (!actualKey) return 'unchanged';
                    delete fm[actualKey];
                    return true;
                });
                if (didFrontmatterMutationChange(outcome)) {
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
    async unlinkFromParent(childFile: TFile, parentFile: TFile): Promise<boolean> {
        return (await this.unlinkFromParentWithOutcome(childFile, parentFile)).status === 'removed';
    }

    async unlinkFromParentWithOutcome(childFile: TFile, parentFile: TFile): Promise<RelationshipUnlinkOutcome> {
        const result = await this.plugin.subitemRelationshipSyncService.unlinkChildFromParent(childFile, parentFile);
        const changedFiles = [
            result.child === 'removed' ? childFile : null,
            result.parent === 'removed' ? parentFile : null,
        ].filter((file): file is TFile => file instanceof TFile);
        if (changedFiles.length > 0) {
            const parentKey = this.parentLinkHandler.normalizeParentKey();
            this.publishRelationshipFollowUp(changedFiles, [parentKey]);
        }
        if (result.status === 'partial' || result.status === 'refused') {
            logger.flowWarn('RelationshipUnlink', 'not-authoritatively-absent', {
                child: childFile.path,
                parent: parentFile.path,
                outcome: result,
            });
        }
        return result;
    }

    async unlinkFromAllParents(childFile: TFile): Promise<number> {
        return (await this.unlinkFromAllParentsWithOutcome(childFile)).removedCount;
    }

    async unlinkFromAllParentsWithOutcome(childFile: TFile): Promise<RelationshipUnlinkAggregateOutcome> {
        const parentEntries = await this.plugin.parentLinkResolutionService.getParentsForChildAuthoritatively(childFile);
        if (parentEntries == null) {
            logger.flowWarn('RelationshipUnlink', 'live-parent-read-refused', { child: childFile.path });
            return summarizeRelationshipUnlinkStatuses('refused', []);
        }
        const parents = parentEntries.map((entry) => entry.file);
        if (!parents.length) {
            return summarizeRelationshipUnlinkStatuses('ready', []);
        }

        const statuses = [];
        for (const parent of parents) {
            const outcome = await this.unlinkFromParentWithOutcome(childFile, parent);
            statuses.push(outcome.status);
        }
        const aggregate = summarizeRelationshipUnlinkStatuses('ready', statuses);
        return aggregate;
    }

    /**
     * Removes an attachment from embedded body content and legacy `attachments` frontmatter.
     */
    async unlinkAttachment(parentFile: TFile, attachmentFile: TFile): Promise<boolean> {
        return (await this.unlinkAttachmentWithOutcome(parentFile, attachmentFile)).status === 'removed';
    }

    async unlinkAttachmentWithOutcome(parentFile: TFile, attachmentFile: TFile): Promise<AttachmentUnlinkOutcome> {
        const attachmentsKey = 'attachments';
        if (parentFile.extension?.toLowerCase() !== 'md') {
            return { status: 'refused', body: 'refused', frontmatter: 'refused' };
        }

        const result = await this.runSerializedFrontmatterWrite(parentFile, async (): Promise<AttachmentUnlinkOutcome> => {
            const removal = await runFailClosedTwoSidedRemoval(
                async () => {
                    let frontmatterPresent = false;
                    const frontmatterOutcome = await this.plugin.frontmatterMutationService.processGuardedWithOutcome(parentFile, (fm) => {
                        frontmatterPresent = false;
                        const key = Object.keys(fm).find(k => k.toLowerCase() === attachmentsKey.toLowerCase());
                        if (!key) return 'unchanged';
                        const raw = fm[key];
                        const values: unknown[] = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
                        const filtered = values.filter((value) =>
                            !linkValueMatchesFile(this.plugin.app, value, parentFile.path, attachmentFile));
                        frontmatterPresent = filtered.length !== values.length;
                        if (!frontmatterPresent) return 'unchanged';
                        if (filtered.length === 0) {
                            delete fm[key];
                        } else {
                            fm[key] = filtered;
                        }
                        return true;
                    });
                    return !isFrontmatterMutationReady(frontmatterOutcome)
                        ? 'refused'
                        : (frontmatterPresent && didFrontmatterMutationChange(frontmatterOutcome) ? 'removed' : 'absent');
                },
                async () => {
                    let bodyPresent = false;
                    let bodyUnverified = false;
                    const bodyOutcome = await this.plugin.subitemRelationshipSyncService.mutateMarkdownBodyWithOutcome(
                        parentFile,
                        (lines, content) => {
                            const removal = this.removeEmbeddedAttachmentReferences(content, parentFile, attachmentFile);
                            bodyUnverified = removal.unverified;
                            if (bodyUnverified) return false;
                            bodyPresent = removal.content !== content;
                            if (!bodyPresent) return false;
                            lines.splice(0, lines.length, ...removal.content.split('\n'));
                            return true;
                        },
                    );
                    return bodyOutcome === 'refused' || bodyUnverified
                        ? 'refused'
                        : (bodyOutcome === 'changed' && bodyPresent ? 'removed' : 'absent');
                },
            );
            return {
                status: removal.status,
                body: removal.second,
                frontmatter: removal.first,
            };
        });

        if (result.body === 'removed' || result.frontmatter === 'removed') {
            this.publishRelationshipFollowUp([parentFile], ['attachments'], 350);
        }
        if (result.status === 'partial' || result.status === 'refused') {
            logger.flowWarn('AttachmentUnlink', 'not-authoritatively-absent', {
                parent: parentFile.path,
                attachment: attachmentFile.path,
                outcome: result,
            });
        }
        return result;
    }

    private publishRelationshipFollowUp(files: TFile[], changedKeys: string[], delayMs: number = 200): void {
        setTimeout(() => {
            try {
                files.forEach((file) => this.plugin.persistentMenuManager?.refreshMenusForFile(file));
            } catch (error) {
                logger.flowWarn('RelationshipMutation', 'menu-refresh-failed-after-commit', {
                    files: files.map((file) => file.path),
                    error: logger.errorSummary(error),
                });
            }
        }, delayMs);
        try {
            this.notifyFilesChanged(files);
        } catch (error) {
            logger.flowWarn('RelationshipMutation', 'file-notification-failed-after-commit', {
                files: files.map((file) => file.path),
                error: logger.errorSummary(error),
            });
        }
        try {
            const refresh = this.plugin.viewModeManager?.handlePotentialFrontmatterChange(files, changedKeys);
            void Promise.resolve(refresh).catch((error) => {
                logger.flowWarn('RelationshipMutation', 'view-refresh-failed-after-commit', {
                    files: files.map((file) => file.path),
                    error: logger.errorSummary(error),
                });
            });
        } catch (error) {
            logger.flowWarn('RelationshipMutation', 'view-refresh-failed-after-commit', {
                files: files.map((file) => file.path),
                error: logger.errorSummary(error),
            });
        }
    }

    private removeEmbeddedAttachmentReferences(
        content: string,
        sourceFile: TFile,
        attachmentFile: TFile,
    ): { content: string; unverified: boolean } {
        let unverified = false;
        const matchesAttachment = (rawTarget: string): boolean => {
            const target = extractLinkTarget(rawTarget);
            if (!target) return false;
            const resolved = resolveLinkValueToFile(this.plugin.app, target, sourceFile.path);
            if (!(resolved instanceof TFile) && this.unresolvedLinkValueMayReferenceFile(target, attachmentFile)) {
                unverified = true;
            }
            return resolved?.path === attachmentFile.path;
        };

        const cleanLine = (line: string): { line: string; removed: boolean } => {
            const original = line;
            let next = line.replace(/!\[\[([^\]]+)\]\]/g, (full, target) => matchesAttachment(target) ? '' : full);
            next = next.replace(/!\[[^\]]*]\(([^)]+)\)/g, (full, target) => matchesAttachment(target) ? '' : full);
            return { line: next, removed: next !== original };
        };

        const lines = content.split('\n');
        let bodyStartIndex = 0;
        if (String(lines[0] || '').replace(/^\uFEFF/, '').trim() === '---') {
            const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
            bodyStartIndex = closingIndex >= 0 ? closingIndex + 1 : lines.length;
        }
        const cleaned = lines
            .map((line, index) => index < bodyStartIndex ? { line, removed: false } : cleanLine(line))
            .filter((entry) => entry.line.trim().length > 0 || !entry.removed)
            .map((entry) => entry.line);

        return { content: cleaned.join('\n'), unverified };
    }

    private unresolvedLinkValueMayReferenceFile(rawTarget: string, file: TFile): boolean {
        const target = normalizePath(String(rawTarget || '')).replace(/\.md$/i, '').toLowerCase();
        if (!target) return false;
        const filePath = normalizePath(file.path).replace(/\.md$/i, '').toLowerCase();
        return target === filePath || target === file.basename.toLowerCase();
    }

    /**
     * Scans all vault markdown files and removes stale parent/child/attachment links
     * that pointed to the given deleted file. Called from the vault delete handler.
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
        const attachmentsKey = 'attachments';
        const files = this.plugin.app.vault.getMarkdownFiles();
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
            if (resolvedFile && this.plugin.app.vault.getAbstractFileByPath(resolvedFile.path) instanceof TFile) return false;
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
            let frontmatterChanged = false;
            const frontmatterRemovedReferences = new Set<string>();

            try {
                frontmatterChanged = await this.plugin.frontmatterMutationService.processGuarded(file, (frontmatter) => {
                    let shouldCommit = false;
                    // Clean childOf (single parent ref)
                    const pk = Object.keys(frontmatter).find(k => k.toLowerCase() === parentKey.toLowerCase());
                    if (pk && isMatch(frontmatter[pk], file.path, frontmatterRemovedReferences)) {
                        delete frontmatter[pk];
                        shouldCommit = true;
                    }

                    // Clean attachments array
                    const ak = Object.keys(frontmatter).find(k => k.toLowerCase() === attachmentsKey.toLowerCase());
                    if (ak) {
                        const raw = frontmatter[ak];
                        const arr: any[] = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
                        const filtered = arr.filter(v => !isMatch(v, file.path, frontmatterRemovedReferences));
                        if (filtered.length !== arr.length) {
                            shouldCommit = true;
                            if (filtered.length === 0) delete frontmatter[ak];
                            else frontmatter[ak] = filtered;
                        }
                    }
                    return shouldCommit;
                });
                if (frontmatterChanged) {
                    for (const referenceKey of frontmatterRemovedReferences) removedReferenceKeys.add(referenceKey);
                }
            } catch (err) {
                logger.warn(`[TPS GCM] cleanupLinksForDeletedFile: failed to clean frontmatter for ${file.path}:`, err);
            }

            let bodyChanged = false;
            try {
                const raw = await this.plugin.app.vault.cachedRead(file);
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
