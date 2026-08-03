import { App, TFile, Notice, FuzzySuggestModal, Modal, parseYaml, stringifyYaml, normalizePath } from "obsidian";
import type TPSGlobalContextMenuPlugin from "../main";
import * as logger from "../logger";
import { mergeNormalizedTags, normalizeTagValue } from "../utils/tag-utils";
import { findExistingDailyNoteForIsoDate, getDailyNoteScheduledValueForIsoDate, getIsoDateFromScheduledValue } from "../utils/daily-note-task-schedule";
import type { CustomProperty } from "../types";
import { propertyUsesEntityOptions } from "../utils/property-option-source";
import { applyCoreDailyNoteTemplateVariables, ensureDailyNoteTitleFallback } from "../utils/daily-note-creation";

type HeaderTarget = {
    line: number;
    level: number;
    text: string;
    display: string;
};

type DailyNoteCreationSettings = {
    format: string;
    folder: string;
    template: string;
    templateDateFormat: string;
    templateTimeFormat: string;
};

const TEMPLATER_CREATE_HOOK_DELAY_MS = 300;
const TEMPLATER_CREATE_HOOK_SETTLE_BUFFER_MS = 100;
const TEMPLATER_CREATE_HOOK_POLL_MS = 25;
const TEMPLATER_CREATE_HOOK_TIMEOUT_MS = 5_000;
const TEMPLATER_COMMAND_PATTERN = /<%[\s\S]*?%>/u;

export interface NoteToCanvasOptions {
    outputFolder?: string;
    openCreated?: boolean;
}

export class NoteOperationService {
    app: App;
    plugin: TPSGlobalContextMenuPlugin;
    private readonly pendingDailyNoteEnsures = new Map<string, Promise<TFile | null>>();

    constructor(plugin: TPSGlobalContextMenuPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
    }

    public async populateDailyNoteWithScheduledItems(dailyNote: TFile): Promise<void> {
        let dailyNoteDateStr = '';
        const parsed = (window as any).moment(dailyNote.basename, [
            this.plugin.fileNamingService.getDailyNoteDateFormat(),
            "YYYY-MM-DD", "YYYY_MM_DD", "YYYYMMDD",
            "MMMM D, YYYY", "MMM D, YYYY"
        ], true);
        if (parsed.isValid()) {
            dailyNoteDateStr = parsed.format('YYYY-MM-DD');
        } else {
            return;
        }

        // Check if the note already has content - don't auto-populate if it does
        // This prevents repeated expensive scans and modifications
        const content = await this.plugin.subitemRelationshipSyncService.readMarkdownText(dailyNote);
        const lines = content.split('\n').filter(line => line.trim() && !line.trim().startsWith('---'));
        if (lines.length > 5) {
            // Note already has substantial content, skip auto-populate
            return;
        }

        const scheduledFiles: TFile[] = [];
        for (const file of this.app.vault.getMarkdownFiles()) {
            if (file.path === dailyNote.path) continue;
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            if (!fm) continue;

            const scheduled = String(fm.scheduled ?? '').trim();
            if (!scheduled) continue;

            const scheduledMillis = this.plugin.sharedServices?.schedule?.parseDateMillis(scheduled) ?? null;
            const scheduledDate = scheduledMillis == null ? null : (window as any).moment(scheduledMillis);
            if (scheduledDate?.isValid() && scheduledDate.format('YYYY-MM-DD') === dailyNoteDateStr) {
                // Ignore files that are themselves daily notes
                if (this.plugin.fileNamingService.isDateOnlyBasename(file.basename)) continue;
                scheduledFiles.push(file);
            }
        }

        if (scheduledFiles.length === 0) return;

        let modified = false;

        for (const childFile of scheduledFiles) {
            const result = await this.plugin.subitemRelationshipSyncService.insertBodyLinkForChildWorkflow(
                dailyNote,
                childFile,
            );
            if (result.blockedReason) {
                logger.warn('[TPS GCM] Skipped scheduled child body link because its workflow status is not safely mapped.', {
                    dailyNotePath: dailyNote.path,
                    childPath: childFile.path,
                    blockedReason: result.blockedReason,
                });
            }
            if (result.changed) {
                modified = true;
            }
        }

        if (modified) {
            logger.log(`[TPS GCM] Populated daily note ${dailyNote.basename} with scheduled item(s).`);
        }
    }

    async addNotesToAnotherNote(files: TFile[]) {
        try {
            if (!files.length) {
                new Notice("Select a file first");
                return;
            }

            // Fuzzy Picker to choose target note
            const picker = await new Promise<TFile | null>((resolve) => {
                let settled = false;
                const finish = (val: TFile | null) => {
                    if (settled) return;
                    settled = true;
                    resolve(val);
                };

                class Picker extends FuzzySuggestModal<TFile> {
                    constructor(app: App) {
                        super(app);
                        this.setPlaceholder("Choose note to append to...");
                    }

                    getItems(): TFile[] {
                        return this.app.vault.getMarkdownFiles();
                    }

                    getItemText(file: TFile): string {
                        return file.path;
                    }

                    onChooseItem(item: TFile, evt: MouseEvent | KeyboardEvent) {
                        finish(item);
                    }

                    onClose() {
                        finish(null);
                    }
                }
                new Picker(this.app).open();
            });

            if (!picker) return;

            const sections: string[] = [];
            const appendedSources: TFile[] = [];
            for (const file of files) {
                try {
                    const section = await this.buildSectionForNote(file);
                    sections.push(section);
                    appendedSources.push(file);
                } catch (err) {
                    logger.error("Failed to build section for", file.path, err);
                }
            }

            if (!sections.length) {
                new Notice("Nothing to append");
                return;
            }

            const existing = await this.app.vault.read(picker);
            const spacer = existing.endsWith("\n") ? "\n" : "\n\n";
            logger.log(`[NoteOperationService] Appending ${sections.length} note(s) → "${picker.basename}"`);
            await this.app.vault.modify(picker, `${existing}${spacer}${sections.join("\n")}`);

            const archiveResult = await this.archiveSourceNotes(appendedSources, new Set([picker.path]));
            const archivedSuffix = archiveResult.archived > 0
                ? ` and tagged ${archiveResult.archived} source note(s) for archive`
                : "";
            new Notice(`Added ${sections.length} note(s) to ${picker.basename}${archivedSuffix}`);

        } catch (err) {
            logger.error("Add to note failed", err);
            new Notice("Unable to add to note");
        }
    }

    async addNotesToDailyNotes(files: TFile[]) {
        try {
            if (!files.length) {
                new Notice("Select a file first");
                return;
            }

            const mode = await this.promptDailyMode();
            if (!mode) return;

            const grouped = new Map<string, Array<{ source: TFile; section: string }>>();

            for (const file of files) {
                const parts = await this.extractNoteParts(file);
                const date = this.pickDailyDate(mode, parts.frontmatter, file);
                if (!date) {
                    logger.warn("No daily date for file", file.path, mode);
                    continue;
                }
                const section = await this.buildSectionForNote(file, parts);
                if (grouped.has(date)) {
                    grouped.get(date)?.push({ source: file, section });
                } else {
                    grouped.set(date, [{ source: file, section }]);
                }
            }

            if (!grouped.size) {
                new Notice(`No usable ${mode} dates found`);
                return;
            }

            const appendedSourcePaths = new Set<string>();
            const dailyTargetPaths = new Set<string>();

            for (const [date, items] of grouped.entries()) {
                try {
                    const daily = await this.ensureDailyNote(date);
                    if (!daily) continue;
                    dailyTargetPaths.add(daily.path);

                    const existing = await this.app.vault.read(daily);
                    const spacer = existing.endsWith("\n") ? "\n" : "\n\n";
                    await this.app.vault.modify(
                        daily,
                        `${existing}${spacer}${items.map((item) => item.section).join("\n")}`,
                    );
                    for (const item of items) {
                        appendedSourcePaths.add(item.source.path);
                    }
                } catch (err) {
                    logger.error("Failed to append to daily note", date, err);
                }
            }

            if (appendedSourcePaths.size === 0) {
                new Notice("Unable to append notes to daily notes");
                return;
            }

            const appendedSources = files.filter((file) => appendedSourcePaths.has(file.path));
            const archiveResult = await this.archiveSourceNotes(appendedSources, dailyTargetPaths);
            const archivedSuffix = archiveResult.archived > 0
                ? ` and tagged ${archiveResult.archived} source note(s) for archive`
                : "";
            new Notice(`Added ${appendedSourcePaths.size} note(s) to daily notes by ${mode} date${archivedSuffix}`);

        } catch (err) {
            logger.error("Add to daily note failed", err);
            new Notice("Unable to add to daily note");
        }
    }

    async convertNotesToListItems(files: TFile[]) {
        try {
            const sourceFiles = files.filter((file): file is TFile =>
                file instanceof TFile && file.extension?.toLowerCase() === "md",
            );
            if (!sourceFiles.length) {
                new Notice("Select a markdown note first");
                return;
            }

            const target = await this.promptTargetNote(sourceFiles);
            if (!target) return;

            const targetContent = await this.app.vault.read(target);
            const headers = this.extractHeaders(targetContent);
            const header = headers.length ? await this.promptTargetHeader(headers, target.basename) : null;
            if (headers.length && !header) return;

            const blocks: string[] = [];
            const convertedSources: TFile[] = [];
            for (const file of sourceFiles) {
                if (file.path === target.path) continue;
                try {
                    const block = await this.buildListItemForNote(file);
                    blocks.push(block);
                    convertedSources.push(file);
                } catch (error) {
                    logger.error("[NoteOperationService] Failed building list item for note", file.path, error);
                }
            }

            if (!blocks.length) {
                new Notice("Nothing to convert");
                return;
            }

            const updated = this.insertListItemBlocks(targetContent, blocks, header);
            await this.app.vault.modify(target, updated);
            await this.plugin.openFileInLeaf(target, false, () => this.app.workspace.getLeaf(false), {
                revealLeaf: true,
                ignoreCanvasDragGuard: true,
            });

            const archiveResult = await this.archiveSourceNotes(convertedSources, new Set([target.path]));
            const archivedSuffix = archiveResult.archived > 0
                ? ` and tagged ${archiveResult.archived} source note(s) for archive`
                : "";
            new Notice(`Converted ${convertedSources.length} note(s) into list item(s) in ${target.basename}${archivedSuffix}`);
        } catch (error) {
            logger.error("[NoteOperationService] Convert to list item failed", error);
            new Notice("Unable to convert note to list item");
        }
    }

    async convertNotesToCanvases(files: TFile[], options: NoteToCanvasOptions = {}): Promise<TFile[]> {
        const sourceFiles = files.filter((file): file is TFile =>
            file instanceof TFile && file.extension?.toLowerCase() === "md",
        );
        if (!sourceFiles.length) {
            new Notice("Select a markdown note first");
            return [];
        }

        const createdFiles: TFile[] = [];
        for (const file of sourceFiles) {
            try {
                const created = await this.createCanvasFromNote(file, options);
                if (created) createdFiles.push(created);
            } catch (error) {
                logger.error("[NoteOperationService] Failed converting note to canvas", file.path, error);
            }
        }

        if (!createdFiles.length) {
            new Notice("Unable to convert note to canvas");
            return [];
        }

        if (options.openCreated !== false) {
            await this.plugin.openFileInLeaf(createdFiles[0], false, () => this.app.workspace.getLeaf(false), {
                revealLeaf: true,
                ignoreCanvasDragGuard: true,
            });
        }

        new Notice(`Created ${createdFiles.length} canvas file(s)`);
        return createdFiles;
    }

    async createCanvasFromNote(file: TFile, options: NoteToCanvasOptions = {}): Promise<TFile | null> {
        if (!(file instanceof TFile) || file.extension?.toLowerCase() !== "md") return null;

        const parts = await this.extractNoteParts(file);
        const frontmatter = this.cloneFrontmatterObject(parts.frontmatter || {});
        const title = this.getListItemTitle(file, frontmatter);
        const body = String(parts.body || "").trim();
        const nodeText = body ? `# ${title}\n\n${body}` : `# ${title}`;
        const targetPath = await this.getUniqueCanvasPathForNote(file, options.outputFolder);
        const document = this.buildCanvasDocument(frontmatter, nodeText);
        const created = await this.app.vault.create(targetPath, `${JSON.stringify(document, null, 2)}\n`);
        this.plugin.eventService?.emitExplicitAction?.([created.path], { source: "note-to-canvas" });
        this.plugin.eventService?.emitFilesUpdated?.([created.path], { sourcePluginId: this.plugin.manifest.id });
        return created;
    }

    private async extractNoteParts(file: TFile) {
        const raw = await this.app.vault.read(file);
        const cache = this.app.metadataCache.getFileCache(file);
        let frontmatter: any = {};
        let body = raw;
        const cacheFrontmatter = cache?.frontmatter ? this.cloneFrontmatterObject(cache.frontmatter) : {};

        try {
            if (cache?.frontmatter?.position) {
                const { start, end } = cache.frontmatter.position;
                const lines = raw.split("\n");
                const slice = lines.slice(start.line + 1, end.line).join("\n");
                frontmatter = parseYaml(slice) || {};
                body = lines.slice(end.line + 1).join("\n");
            }
        } catch (err) {
            logger.error("Failed to parse frontmatter for", file.path, err);
        }

        // Fallback: parse YAML frontmatter directly from file text when metadata cache
        // positions are unavailable or stale.
        if (!this.hasKeys(frontmatter)) {
            const parsed = this.extractYamlFrontmatter(raw);
            if (parsed) {
                frontmatter = parsed.frontmatter;
                body = parsed.body;
            } else if (this.hasKeys(cacheFrontmatter)) {
                frontmatter = cacheFrontmatter;
            }
        }

        return { frontmatter, body };
    }

    private async buildSectionForNote(file: TFile, parts?: { frontmatter: any, body: string }) {
        if (!parts) {
            parts = await this.extractNoteParts(file);
        }
        const title = file.basename || file.name;
        const fmBlock = this.serializeFrontmatterForSection(parts.frontmatter || {});
        let bodyBlock = this.demoteHeadingsForEmbed((parts.body || "").trim());

        if (!bodyBlock.trim()) bodyBlock = "_(empty)_";

        return `## ${title}\n\n### Frontmatter\n${fmBlock}\n\n### Body\n${bodyBlock}\n`;
    }

    private async buildListItemForNote(file: TFile): Promise<string> {
        const parts = await this.extractNoteParts(file);
        const frontmatter = parts.frontmatter || {};
        const title = this.getListItemTitle(file, frontmatter);
        const marker = this.getCheckboxMarkerForFrontmatter(frontmatter);
        const inlineProperties = this.buildInlinePropertiesForListItem(frontmatter);
        const line = `- [${marker}] ${title}${inlineProperties ? ` ${inlineProperties}` : ""}`.trimEnd();
        const body = this.formatNestedListItemBody(parts.body || "");
        return body ? `${line}\n${body}` : line;
    }

    private buildInlinePropertiesForListItem(frontmatter: Record<string, unknown>): string {
        const properties = this.getListItemInlineProperties(frontmatter);
        const parts: string[] = [];
        const emitted = new Set<string>();
        for (const property of properties) {
            const key = String(property.key || "").trim();
            const actualKey = this.findFrontmatterKey(frontmatter, key);
            if (!key || !actualKey || emitted.has(key.toLowerCase())) continue;
            const formatted = this.formatInlinePropertyValue(frontmatter[actualKey], property);
            if (!formatted) continue;
            if (property.type === "list" && property.listItemType === "tag") {
                parts.push(formatted);
            } else {
                parts.push(`[${key}:: ${formatted}]`);
            }
            emitted.add(key.toLowerCase());
        }
        return parts.join(" ");
    }

    private getListItemInlineProperties(frontmatter: Record<string, unknown>): CustomProperty[] {
        const configured = Array.isArray(this.plugin.settings.properties)
            ? this.plugin.settings.properties
            : [];
        const properties = configured.filter((property): property is CustomProperty => {
            if (!property || property.disabled || property.hidden || property.allowInlineSet === false) return false;
            const key = String(property.key || "").trim();
            if (!key) return false;
            if (
                ["title", "folderpath", "childof", "parentof"].includes(key.toLowerCase())
                || (key.toLowerCase() === "status" && !propertyUsesEntityOptions(property))
            ) return false;
            return !!this.findFrontmatterKey(frontmatter, key);
        });

        for (const fallbackKey of ["scheduled", "timeEstimate", "priority"]) {
            if (!this.findFrontmatterKey(frontmatter, fallbackKey)) continue;
            if (properties.some((property) => String(property.key || "").toLowerCase() === fallbackKey.toLowerCase())) continue;
            properties.push({
                id: fallbackKey,
                label: fallbackKey,
                key: fallbackKey,
                type: fallbackKey === "timeEstimate" ? "number" : fallbackKey === "scheduled" ? "datetime" : "text",
            });
        }
        return properties;
    }

    private findFrontmatterKey(frontmatter: Record<string, unknown>, key: string): string | null {
        const normalized = String(key || "").trim().toLowerCase();
        if (!normalized) return null;
        return Object.keys(frontmatter || {}).find((candidate) => candidate.trim().toLowerCase() === normalized) || null;
    }

    private formatInlinePropertyValue(value: unknown, property: CustomProperty): string {
        if (value === null || value === undefined) return "";
        if (Array.isArray(value)) {
            return value
                .map((entry) => this.formatInlinePropertyValue(entry, property))
                .filter(Boolean)
                .join(", ");
        }
        if (property.type === "datetime") {
            return this.formatInlineDateTimeValue(value);
        }
        if (property.type === "list" && property.listItemType === "tag") {
            return String(value).split(/[,\n]/).map((tag) => `#${normalizeTagValue(tag)}`).filter((tag) => tag !== "#").join(" ");
        }
        return this.sanitizeInlinePropertyText(String(value));
    }

    private formatInlineDateTimeValue(value: unknown): string {
        const raw = String(value || "").trim();
        if (!raw) return "";
        const moment = (window as any).moment;
        const parsed = typeof moment === "function" ? moment(raw) : null;
        if (parsed?.isValid?.()) {
            return parsed.format("YYYY-MM-DD HH:mm:ss");
        }
        return raw.replace("T", " ");
    }

    private sanitizeInlinePropertyText(value: string): string {
        return String(value || "")
            .replace(/\r?\n/g, " ")
            .replace(/\]/g, "\\]")
            .replace(/\s+/g, " ")
            .trim();
    }

    private getListItemTitle(file: TFile, frontmatter: Record<string, unknown>): string {
        const titleKey = Object.keys(frontmatter || {}).find((key) => key.toLowerCase() === "title");
        const rawTitle = titleKey ? frontmatter[titleKey] : null;
        const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
        return this.sanitizeInlineText(title || file.basename || file.name);
    }

    private getCheckboxMarkerForFrontmatter(frontmatter: Record<string, unknown>): string {
        const workflowStatusKey = String(
            this.plugin.sharedServices?.status?.getStatusPropertyKey?.() || "status",
        ).trim().toLowerCase();
        const statusKey = Object.keys(frontmatter || {}).find(
            (key) => key.toLowerCase() === workflowStatusKey,
        );
        if (!statusKey) return "*";
        const rawStatus = frontmatter[statusKey];
        const status = Array.isArray(rawStatus) ? rawStatus.find((value) => String(value || "").trim()) : rawStatus;
        const normalized = this.plugin.sharedServices?.status?.normalize?.(status) || String(status || "").trim().toLowerCase();
        if (!normalized) return "*";
        const mapped = this.plugin.sharedServices?.status?.statusToCheckboxState?.(normalized);
        return typeof mapped === "string" ? mapped : this.statusToCheckboxMarker(normalized);
    }

    private statusToCheckboxMarker(status: string): string {
        if (status === "complete" || status === "completed" || status === "done" || status === "x") return "x";
        if (status === "working" || status === "in-progress" || status === "inprogress" || status === "/") return "/";
        if (status === "holding" || status === "hold" || status === "waiting" || status === "?") return "?";
        if (status === "wont-do" || status === "wontdo" || status === "cancelled" || status === "canceled" || status === "-") return "-";
        return " ";
    }

    private sanitizeInlineText(value: string): string {
        return String(value || "")
            .replace(/\r?\n/g, " ")
            .replace(/[\[\]]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    private formatNestedListItemBody(body: string): string {
        const trimmed = this.stripHeadingsForNestedListBody(String(body || "").trim());
        if (!trimmed) return "";
        return trimmed
            .split("\n")
            .map((line) => line.trim() ? `  ${line}` : "  ")
            .join("\n")
            .trimEnd();
    }

    private stripHeadingsForNestedListBody(text: string): string {
        if (!text) return "";
        let inFence = false;
        const lines = text.split("\n");
        const output: string[] = [];
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const trimmed = line.trimStart();
            if (trimmed.startsWith("```")) {
                inFence = !inFence;
                output.push(line);
                continue;
            }
            if (inFence) {
                output.push(line);
                continue;
            }

            const setextMatch = line.match(/^\s*(?:=+|-+)\s*$/);
            const previous = output.length > 0 ? output[output.length - 1] : "";
            if (setextMatch && previous.trim() && !/^\s*[-*+]\s+/.test(previous)) {
                continue;
            }

            const match = line.match(/^(\s*)#{1,6}\s+(.+?)\s*#*\s*$/);
            output.push(match ? `${match[1]}${match[2]}`.trimEnd() : line);
        }
        return output.join("\n");
    }

    private buildCanvasDocument(frontmatter: Record<string, unknown>, text: string): Record<string, unknown> {
        const nodeHeight = Math.max(180, Math.min(520, 120 + Math.ceil(String(text || "").length / 4)));
        return {
            nodes: [
                {
                    id: "note",
                    type: "text",
                    text,
                    x: 0,
                    y: 0,
                    width: 520,
                    height: nodeHeight,
                },
            ],
            edges: [],
            metadata: {
                version: "1.0-1.0",
                frontmatter,
            },
        };
    }

    private async getUniqueCanvasPathForNote(file: TFile, outputFolder?: string): Promise<string> {
        const folder = normalizePath(
            String(outputFolder || file.parent?.path || "")
                .trim()
                .replace(/^\/+|\/+$/g, ""),
        );
        if (folder) await this.ensureFolderPath(folder);

        const baseName = this.sanitizeCanvasFileName(file.basename || file.name.replace(/\.md$/i, ""));
        const prefix = folder ? `${folder}/` : "";
        let targetPath = normalizePath(`${prefix}${baseName}.canvas`);
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(targetPath) || await this.app.vault.adapter.exists(targetPath)) {
            targetPath = normalizePath(`${prefix}${baseName} ${counter}.canvas`);
            counter += 1;
        }
        return targetPath;
    }

    private sanitizeCanvasFileName(value: string): string {
        return String(value || "Untitled")
            .replace(/[\\/:*?"<>|]/g, " ")
            .replace(/\s+/g, " ")
            .trim() || "Untitled";
    }

    private extractHeaders(content: string): HeaderTarget[] {
        const headers: HeaderTarget[] = [];
        const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
        let inFrontmatter = lines[0]?.trim() === "---";
        let inFence = false;
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const trimmed = line.trim();
            if (index > 0 && inFrontmatter && trimmed === "---") {
                inFrontmatter = false;
                continue;
            }
            if (inFrontmatter) continue;
            if (trimmed.startsWith("```")) {
                inFence = !inFence;
                continue;
            }
            if (inFence) continue;
            const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
            if (!match) continue;
            const level = match[1].length;
            const text = match[2].trim();
            headers.push({
                line: index,
                level,
                text,
                display: `${"  ".repeat(Math.max(0, level - 1))}${text}`,
            });
        }
        return headers;
    }

    private insertListItemBlocks(content: string, blocks: string[], header: HeaderTarget | null): string {
        const normalized = String(content || "").replace(/\r\n/g, "\n");
        const lines = normalized.split("\n");
        let insertAt = lines.length;

        if (header) {
            insertAt = lines.length;
            let inFence = false;
            for (let index = header.line + 1; index < lines.length; index += 1) {
                const trimmed = lines[index].trimStart();
                if (trimmed.startsWith("```")) {
                    inFence = !inFence;
                    continue;
                }
                if (inFence) continue;
                const match = lines[index].match(/^(#{1,6})\s+\S/);
                if (match) {
                    insertAt = index;
                    break;
                }
            }
            while (insertAt > header.line + 1 && lines[insertAt - 1].trim() === "") {
                insertAt -= 1;
            }
        } else {
            while (insertAt > 0 && lines[insertAt - 1].trim() === "") {
                insertAt -= 1;
            }
        }

        const before = lines.slice(0, insertAt);
        const after = lines.slice(insertAt);
        const insertion: string[] = [];
        if (before.length > 0 && before[before.length - 1].trim() !== "") insertion.push("");
        insertion.push(...blocks.join("\n").split("\n"));
        if (after.length > 0 && after[0].trim() !== "") insertion.push("");
        const next = [...before, ...insertion, ...after].join("\n");
        return normalized.endsWith("\n") ? `${next.replace(/\n*$/, "")}\n` : next.replace(/\n*$/, "");
    }

    private promptTargetNote(sourceFiles: TFile[]): Promise<TFile | null> {
        return new Promise<TFile | null>((resolve) => {
            const excludedPaths = new Set(sourceFiles.map((file) => file.path));
            new TargetNoteModal(this.app, excludedPaths, resolve).open();
        });
    }

    private promptTargetHeader(headers: HeaderTarget[], targetName: string): Promise<HeaderTarget | null> {
        return new Promise<HeaderTarget | null>((resolve) => {
            new HeaderSuggestModal(this.app, headers, targetName, resolve).open();
        });
    }

    private serializeFrontmatterForSection(fm: any): string {
        if (!fm || typeof fm !== "object" || !Object.keys(fm).length) {
            return "```yaml\n# (none)\n```";
        }
        const yaml = stringifyYaml(fm).trimEnd();
        return `\`\`\`yaml\n${yaml}\n\`\`\``;
    }


    private demoteHeadingsForEmbed(text: string): string {
        if (!text) return "";
        let inFence = false;
        return text.split("\n").map(line => {
            const trimmed = line.trimStart();
            if (trimmed.startsWith("```")) {
                inFence = !inFence;
                return line;
            }
            if (inFence) return line;

            const match = line.match(/^(#{1,6})\s+(.*)$/);
            if (!match) return line;

            const level = match[1].length;
            const content = match[2];
            // Demote significantly to avoid messing up target note outline
            const newLevel = Math.min(6, level + 3);
            return `${"#".repeat(newLevel)} ${content}`;
        }).join("\n");
    }

    private pickDailyDate(mode: 'created' | 'edited', fm: any, file: TFile): string | null {
        return mode === 'created'
            ? this.pickDateFromFrontmatterOrStat(
                fm,
                ["createddate", "datecreated", "created"],
                file.stat.ctime,
            )
            : this.pickDateFromFrontmatterOrStat(
                fm,
                ["modifieddate", "datemodified", "modified", "updated", "dateupdated"],
                file.stat.mtime,
            );
    }

    private pickDateFromFrontmatterOrStat(
        fm: any,
        normalizedKeys: string[],
        statFallback: number,
    ): string | null {
        const candidates: any[] = [];
        fm = fm || {};

        // Check frontmatter keys
        for (const [key, val] of Object.entries(fm)) {
            const norm = key.replace(/\s+/g, "").toLowerCase();
            if (normalizedKeys.includes(norm)) {
                candidates.push(val);
            }
        }

        const momentLib = (window as any).moment;
        for (const val of candidates) {
            try {
                if (momentLib) {
                    const m = momentLib(val);
                    if (m?.isValid && m.isValid()) return m.format("YYYY-MM-DD");
                }
                const parsed = Date.parse(`${val}`);
                if (!Number.isNaN(parsed)) {
                    const d = new Date(parsed);
                    // Simple ISO format
                    return d.toISOString().split("T")[0];
                }
            } catch { }
        }

        // Fallback to file stat time
        if (statFallback) {
            const d = new Date(statFallback);
            return d.toISOString().split("T")[0];
        }
        return null;
    }

    private async promptDailyMode(): Promise<'created' | 'edited' | null> {
        return await new Promise<'created' | 'edited' | null>((resolve) => {
            const modal = new DailyModeModal(this.app, resolve);
            modal.open();
        });
    }

    async ensureDailyNote(dateStr: string): Promise<TFile | null> {
        const isoDate = getIsoDateFromScheduledValue(dateStr);
        const operationKey = isoDate ? `iso:${isoDate}` : `value:${String(dateStr || '').trim()}`;
        const pending = this.pendingDailyNoteEnsures.get(operationKey);
        if (pending) return pending;

        const operation = this.ensureDailyNoteOnce(dateStr, isoDate).catch((error) => {
            logger.error('Daily Note creation failed', {
                date: isoDate ?? String(dateStr || '').trim(),
                error,
            });
            new Notice('TPS GCM: The Daily Note could not be created. Check the configured template and try again.');
            return null;
        });
        this.pendingDailyNoteEnsures.set(operationKey, operation);
        try {
            return await operation;
        } finally {
            if (this.pendingDailyNoteEnsures.get(operationKey) === operation) {
                this.pendingDailyNoteEnsures.delete(operationKey);
            }
        }
    }

    private async ensureDailyNoteOnce(dateStr: string, isoDate: string | null): Promise<TFile | null> {
        const settings = await this.getDailyNoteCreationSettings();
        this.plugin.fileNamingService.registerDailyNoteConfiguration(settings.folder, settings.format);
        const targetDate = isoDate
            ? (window as any).moment(isoDate, 'YYYY-MM-DD', true)
            : (window as any).moment(dateStr);
        const formattedBasename = targetDate?.isValid?.() && targetDate.isValid()
            ? targetDate.format(settings.format)
            : String(dateStr || '').trim();
        const path = normalizePath(
            settings.folder
                ? `${settings.folder}/${formattedBasename}.md`
                : `${formattedBasename}.md`,
        );
        const titleValue = isoDate
            ? (path.split('/').pop()?.replace(/\.md$/i, '') || isoDate)
            : dateStr;
        const targetFolder = path.includes('/')
            ? path.slice(0, path.lastIndexOf('/'))
            : '';
        const adapter = this.app.vault.adapter;
        const configuredTemplate = String(settings.template || '').trim();

        const exactExisting = this.app.vault.getAbstractFileByPath(path);
        const existingDailyNote = exactExisting instanceof TFile
            ? exactExisting
            : isoDate
            ? findExistingDailyNoteForIsoDate(this.app, this.plugin.settings, isoDate)
            : null;
        if (existingDailyNote instanceof TFile) {
            if (!(await this.finishPendingTemplaterTemplate(existingDailyNote))) {
                return null;
            }
            await this.normalizeCreatedDailyNote(
                existingDailyNote,
                titleValue,
                existingDailyNote.parent?.path || targetFolder,
                isoDate,
            );
            return existingDailyNote;
        }

        if (await adapter.exists(path)) {
            const existing = this.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) {
                if (!(await this.finishPendingTemplaterTemplate(existing))) {
                    return null;
                }
                await this.normalizeCreatedDailyNote(
                    existing,
                    titleValue,
                    existing.parent?.path || targetFolder,
                    isoDate,
                );
                return existing;
            }
            return null;
        }

        const templateFile = configuredTemplate
            ? this.resolveDailyNoteTemplateFile(configuredTemplate)
            : null;
        if (configuredTemplate && !(templateFile instanceof TFile)) {
            logger.warn('Configured Daily Notes template is unavailable; refusing to create a template-less note', {
                template: configuredTemplate,
                path,
            });
            new Notice(`TPS GCM: Daily Notes template not found: ${configuredTemplate}`);
            return null;
        }

        if (targetFolder && !(await adapter.exists(targetFolder))) {
            await this.ensureFolderPath(targetFolder);
        }

        let content = "";
        let hasFrontmatter = false;

        if (templateFile instanceof TFile) {
            try {
                content = await this.app.vault.read(templateFile);
                content = applyCoreDailyNoteTemplateVariables(
                    content,
                    targetDate,
                    titleValue,
                    (window as any).moment(),
                    {
                        dateFormat: settings.templateDateFormat,
                        timeFormat: settings.templateTimeFormat,
                    },
                );
                hasFrontmatter = content.trimStart().startsWith("---");
            } catch (error) {
                logger.warn('Configured Daily Notes template could not be read; refusing to create a template-less note', {
                    template: templateFile.path,
                    path,
                    error,
                });
                new Notice(`TPS GCM: Daily Notes template could not be read: ${templateFile.path}`);
                return null;
            }
        }

        if (!configuredTemplate) {
            content = `---\ntitle: ${JSON.stringify(titleValue)}\ntags: [dailynote]\n---\n\n`;
        } else if (hasFrontmatter) {
            // The template's title and body remain authoritative.
        } else {
            content = `---\ntitle: ${JSON.stringify(titleValue)}\ntags: [dailynote]\n---\n\n${content}`;
        }

        let created: TFile | null = null;
        let createdByThisCall = false;
        const createStartedAt = Date.now();
        try {
            created = await this.app.vault.create(path, content);
            createdByThisCall = true;
        } catch (err: any) {
            const msg = err instanceof Error ? err.message : String(err);
            if (typeof msg === 'string' && msg.toLowerCase().includes('already exists')) {
                const existing = this.app.vault.getAbstractFileByPath(path);
                if (existing instanceof TFile) {
                    created = existing;
                }
            }
            if (!created) throw err;
        }

        if (!(await this.finishPendingTemplaterTemplate(created, {
            awaitAutoCreateHook: true,
            createStartedAt,
        }))) {
            return null;
        }

        await this.normalizeCreatedDailyNote(
            created,
            titleValue,
            created.parent?.path || targetFolder,
            isoDate,
        );
        logger.flow('DailyNote', 'ensure:created', {
            path: created.path,
            date: isoDate,
            source: createdByThisCall ? 'manual-template' : 'create-race-existing',
            template: Boolean(configuredTemplate),
        });

        return created;
    }

    private async normalizeCreatedDailyNote(file: TFile, titleValue: string, folder: string, isoDate: string | null = getIsoDateFromScheduledValue(titleValue)): Promise<void> {
        const targetFolder = String(folder || file.parent?.path || '/').trim() || '/';
        const scheduledValue = isoDate ? getDailyNoteScheduledValueForIsoDate(isoDate) : `${titleValue} 00:00:00`;

        await this.normalizeLeadingWhitespaceBeforeFrontmatter(file);

        try {
            await this.plugin.frontmatterMutationService.process(file, (fm: any) => {
                ensureDailyNoteTitleFallback(fm, titleValue);
                const scheduled = String(fm?.scheduled ?? '').trim();
                if (!scheduled || /<%[\s\S]*%>/.test(scheduled) || /\{\{[\s\S]*\}\}/.test(scheduled)) {
                    fm.scheduled = scheduledValue;
                }
                if (this.plugin.settings.autoSaveFolderPath) {
                    fm.folderPath = targetFolder;
                }
            });
        } catch (error) {
            logger.warn('Failed normalizing created daily note frontmatter', { file: file.path, error });
        }

        try {
            await this.plugin.fileNamingService.processFileOnOpen(file, {
                bypassCreationGrace: true,
                preserveDailyNoteIdentity: true,
            });
        } catch (error) {
            logger.warn('Failed running file naming normalization for created daily note', { file: file.path, error });
        }

        try {
            await this.plugin.notebookNavigatorRuleService.applyRulesToFile(file, {
                reason: 'gcm-created-daily-note',
                force: true,
                bypassCreationGrace: true,
            });
        } catch (error) {
            logger.warn('Failed applying NN rules to created daily note', { file: file.path, error });
        }
    }

    private async getDailyNoteCreationSettings(): Promise<DailyNoteCreationSettings> {
        const templateFormats = await this.getCoreTemplateFormats();
        const internalPlugins = (this.app as any).internalPlugins;
        const corePlugin = internalPlugins?.getPluginById?.('daily-notes')
            ?? internalPlugins?.plugins?.['daily-notes'];
        const coreOptions = corePlugin?.instance?.options;
        if (coreOptions && typeof coreOptions === 'object') {
            const hasRuntimeFormat = typeof coreOptions.format === 'string';
            const hasRuntimeFolder = typeof coreOptions.folder === 'string';
            const hasRuntimeTemplate = typeof coreOptions.template === 'string';
            const persisted = await this.readPersistedDailyNoteSettings();
            return {
                format: (
                    hasRuntimeFormat
                        ? String(coreOptions.format || '').trim()
                        : String(persisted?.format || '').trim()
                ) || 'YYYY-MM-DD',
                folder: normalizePath(
                    hasRuntimeFolder
                        ? String(coreOptions.folder || '').trim()
                        : String(persisted?.folder || '').trim(),
                ).replace(/^\/+|\/+$/g, ''),
                template: hasRuntimeTemplate
                    ? String(coreOptions.template || '').trim()
                    : String(persisted?.template || '').trim(),
                ...templateFormats,
            };
        }

        const periodicPlugin = (this.app as any).plugins?.getPlugin?.('periodic-notes')
            ?? (this.app as any).plugins?.plugins?.['periodic-notes'];
        const periodicOptions = periodicPlugin?.settings?.daily;
        if (periodicOptions && typeof periodicOptions === 'object') {
            return {
                format: String(periodicOptions.format || '').trim() || 'YYYY-MM-DD',
                folder: normalizePath(String(periodicOptions.folder || '').trim()).replace(/^\/+|\/+$/g, ''),
                template: String(periodicOptions.template || '').trim(),
                ...templateFormats,
            };
        }

        const persisted = await this.readPersistedDailyNoteSettings();
        if (persisted) {
            return {
                format: String(persisted?.format || '').trim() || 'YYYY-MM-DD',
                folder: normalizePath(String(persisted?.folder || '').trim()).replace(/^\/+|\/+$/g, ''),
                template: String(persisted?.template || '').trim(),
                ...templateFormats,
            };
        }
        return {
            format: 'YYYY-MM-DD',
            folder: 'System/Dailynotes',
            template: '',
            ...templateFormats,
        };
    }

    private async readPersistedDailyNoteSettings(): Promise<Record<string, unknown> | null> {
        try {
            const configDir = String((this.app.vault as any)?.configDir || '.obsidian').trim() || '.obsidian';
            const raw = await this.app.vault.adapter.read(normalizePath(`${configDir}/daily-notes.json`));
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object'
                ? parsed as Record<string, unknown>
                : null;
        } catch {
            return null;
        }
    }

    private async getCoreTemplateFormats(): Promise<{ templateDateFormat: string; templateTimeFormat: string }> {
        const internalPlugins = (this.app as any).internalPlugins;
        const templatesPlugin = internalPlugins?.getPluginById?.('templates')
            ?? internalPlugins?.plugins?.templates;
        const runtime = templatesPlugin?.instance?.options;
        const hasRuntimeDateFormat = typeof runtime?.dateFormat === 'string';
        const hasRuntimeTimeFormat = typeof runtime?.timeFormat === 'string';
        let persisted: Record<string, unknown> | null = null;
        if (!hasRuntimeDateFormat || !hasRuntimeTimeFormat) {
            try {
                const configDir = String((this.app.vault as any)?.configDir || '.obsidian').trim() || '.obsidian';
                const raw = await this.app.vault.adapter.read(normalizePath(`${configDir}/templates.json`));
                const parsed = JSON.parse(raw);
                persisted = parsed && typeof parsed === 'object'
                    ? parsed as Record<string, unknown>
                    : null;
            } catch {
                persisted = null;
            }
        }
        return {
            templateDateFormat: (
                hasRuntimeDateFormat
                    ? String(runtime.dateFormat || '').trim()
                    : String(persisted?.dateFormat || '').trim()
            ) || 'YYYY-MM-DD',
            templateTimeFormat: (
                hasRuntimeTimeFormat
                    ? String(runtime.timeFormat || '').trim()
                    : String(persisted?.timeFormat || '').trim()
            ) || 'HH:mm',
        };
    }

    private resolveDailyNoteTemplateFile(templatePath: string): TFile | null {
        const normalized = normalizePath(String(templatePath || '').trim()).replace(/^\/+/, '');
        if (!normalized) return null;
        const candidates = normalized.toLowerCase().endsWith('.md')
            ? [normalized]
            : [normalized, `${normalized}.md`];
        for (const candidatePath of candidates) {
            const candidate = this.app.vault.getAbstractFileByPath(candidatePath);
            if (candidate instanceof TFile) return candidate;
        }
        const linked = this.app.metadataCache.getFirstLinkpathDest?.(normalized.replace(/\.md$/i, ''), '');
        return linked instanceof TFile ? linked : null;
    }

    /**
     * Finish any Templater expressions before a caller can normalize or append to
     * the Daily Note. When Templater owns file-creation processing, wait for its
     * delayed hook instead of also invoking the processor. Otherwise, run one
     * explicit pass.
     */
    private async finishPendingTemplaterTemplate(
        file: TFile,
        options: {
            awaitAutoCreateHook?: boolean;
            createStartedAt?: number;
        } = {},
    ): Promise<boolean> {
        let content = '';
        try {
            content = await this.app.vault.read(file);
        } catch (error) {
            logger.warn('[NoteOperationService] Could not inspect the Daily Note before Templater processing', {
                file: file.path,
                error,
            });
            return false;
        }

        const templater = (this.app as any)?.plugins?.getPlugin?.('templater-obsidian')
            ?? (this.app as any)?.plugins?.plugins?.['templater-obsidian'];
        const hasTemplaterCommands = TEMPLATER_COMMAND_PATTERN.test(content);
        if (!templater?.templater?.overwrite_file_commands) {
            if (!hasTemplaterCommands) return true;
            logger.warn('[NoteOperationService] Daily Note still contains Templater expressions, but Templater is unavailable', {
                file: file.path,
            });
            return false;
        }

        const autoCreateEnabled = this.isTemplaterAutoCreateEnabled(templater);
        const autoCreateEligible = autoCreateEnabled
            && this.isTemplaterAutoCreateEligible(file, templater);
        const observedCreateStart = options.awaitAutoCreateHook
            ? this.normalizeTemplaterCreateStart(options.createStartedAt)
            : this.getRecentTemplaterCreateStart(file, templater);
        if (autoCreateEligible && observedCreateStart !== null) {
            return this.waitForTemplaterCreateHook(file, templater, observedCreateStart);
        }
        if (!hasTemplaterCommands) return true;

        try {
            await templater.templater.overwrite_file_commands(file, false);
            await this.normalizeLeadingWhitespaceBeforeFrontmatter(file);
            const processed = await this.app.vault.read(file);
            if (TEMPLATER_COMMAND_PATTERN.test(processed)) {
                logger.warn('[NoteOperationService] Daily Note still contains unprocessed Templater expressions', {
                    file: file.path,
                });
                return false;
            }
            return true;
        } catch (error) {
            logger.warn('[NoteOperationService] Templater failed to process the Daily Note', {
                file: file.path,
                error,
            });
            return false;
        }
    }

    private isTemplaterAutoCreateEnabled(templaterPlugin: any): boolean {
        try {
            const localSettings = (this.app as any)?.loadLocalStorage?.('templater-local-settings');
            if (typeof localSettings?.trigger_on_file_creation === 'boolean') {
                return localSettings.trigger_on_file_creation;
            }
        } catch (error) {
            logger.warn('[NoteOperationService] Could not read Templater local creation settings; using the legacy setting', {
                error,
            });
        }
        return templaterPlugin?.settings?.trigger_on_file_creation === true;
    }

    private isTemplaterAutoCreateEligible(file: TFile, templaterPlugin: any): boolean {
        const settings = templaterPlugin?.settings
            ?? templaterPlugin?.templater?.plugin?.settings
            ?? {};
        const templateFolder = String(settings.templates_folder || '')
            .trim()
            .replace(/^\/+|\/+$/g, '');
        if (templateFolder && file.path.includes(templateFolder)) return false;

        const ignoredFolders = Array.isArray(settings.ignore_folders_on_creation)
            ? settings.ignore_folders_on_creation
            : [];
        return !ignoredFolders.some((entry: unknown) => {
            const raw = entry && typeof entry === 'object' && 'folder' in entry
                ? (entry as { folder?: unknown }).folder
                : entry;
            const ignoredPath = String(raw || '').trim().replace(/^\/+|\/+$/g, '');
            return Boolean(ignoredPath && file.path.startsWith(ignoredPath));
        });
    }

    private normalizeTemplaterCreateStart(value: unknown): number {
        const numeric = Number(value);
        const now = Date.now();
        return Number.isFinite(numeric) && numeric > 0 && numeric <= now
            ? numeric
            : now;
    }

    private getRecentTemplaterCreateStart(file: TFile, templaterPlugin: any): number | null {
        if (!this.isTemplaterAutoCreateEnabled(templaterPlugin)) return null;
        const pendingFiles = templaterPlugin?.templater?.files_with_pending_templates;
        const now = Date.now();
        const stat = (file as any)?.stat;
        const timestamps = [Number(stat?.ctime), Number(stat?.mtime)]
            .filter((value) => Number.isFinite(value) && value > 0 && value <= now);
        const newestTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : null;
        if (typeof pendingFiles?.has === 'function' && pendingFiles.has(file.path)) {
            return newestTimestamp ?? (now - TEMPLATER_CREATE_HOOK_DELAY_MS - TEMPLATER_CREATE_HOOK_SETTLE_BUFFER_MS);
        }
        if (
            newestTimestamp !== null
            && now - newestTimestamp <= TEMPLATER_CREATE_HOOK_DELAY_MS + TEMPLATER_CREATE_HOOK_SETTLE_BUFFER_MS
        ) {
            return newestTimestamp;
        }
        return null;
    }

    private async waitForTemplaterCreateHook(
        file: TFile,
        templaterPlugin: any,
        createStartedAt: number,
    ): Promise<boolean> {
        const templaterEngine = templaterPlugin?.templater;
        const pendingFiles = templaterEngine?.files_with_pending_templates;
        const startedAt = Date.now();
        const settleAfter = createStartedAt
            + TEMPLATER_CREATE_HOOK_DELAY_MS
            + TEMPLATER_CREATE_HOOK_SETTLE_BUFFER_MS;
        const deadline = startedAt + TEMPLATER_CREATE_HOOK_TIMEOUT_MS;
        let stableContent: string | null = null;

        while (Date.now() < deadline) {
            const now = Date.now();
            if (now < settleAfter) {
                await this.delayTemplaterPoll(Math.min(TEMPLATER_CREATE_HOOK_POLL_MS, settleAfter - now));
                continue;
            }

            const isPending = typeof pendingFiles?.has === 'function'
                ? pendingFiles.has(file.path)
                : false;
            if (!isPending) {
                try {
                    const processed = await this.app.vault.read(file);
                    if (!TEMPLATER_COMMAND_PATTERN.test(processed)) {
                        if (stableContent === processed) {
                            await this.normalizeLeadingWhitespaceBeforeFrontmatter(file);
                            logger.flow('DailyNote', 'templater:auto-create-settled', {
                                path: file.path,
                            });
                            return true;
                        }
                        stableContent = processed;
                    } else {
                        stableContent = null;
                    }
                } catch (error) {
                    logger.warn('[NoteOperationService] Could not inspect the Daily Note while waiting for Templater', {
                        file: file.path,
                        error,
                    });
                    return false;
                }
            } else {
                stableContent = null;
            }

            await this.delayTemplaterPoll(TEMPLATER_CREATE_HOOK_POLL_MS);
        }

        logger.warn('[NoteOperationService] Templater auto-create processing did not settle before the Daily Note timeout', {
            file: file.path,
        });
        return false;
    }

    private async delayTemplaterPoll(milliseconds: number): Promise<void> {
        await new Promise<void>((resolve) => {
            setTimeout(resolve, Math.max(0, milliseconds));
        });
    }

    private async normalizeLeadingWhitespaceBeforeFrontmatter(file: TFile): Promise<void> {
        let content = '';
        try {
            content = await this.app.vault.cachedRead(file);
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

        const liveFile = this.app.vault.getAbstractFileByPath(file.path);
        if (!(liveFile instanceof TFile)) return;

        await this.app.vault.modify(liveFile, `${bom}${trimmedLeading}`);
    }

    private hasKeys(value: unknown): boolean {
        return !!value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0;
    }

    private cloneFrontmatterObject(frontmatter: Record<string, unknown>): Record<string, unknown> {
        const cloned: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(frontmatter || {})) {
            if (key === "position") continue;
            cloned[key] = value;
        }
        return cloned;
    }

    private extractYamlFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } | null {
        const normalized = String(raw || "").replace(/\r\n/g, "\n");
        if (!normalized.startsWith("---\n")) {
            return null;
        }

        const closingMarker = normalized.indexOf("\n---\n", 4);
        const closingMarkerAtEnd = normalized.endsWith("\n---") ? normalized.length - 4 : -1;
        const closingIndex = closingMarker >= 0 ? closingMarker : closingMarkerAtEnd;
        if (closingIndex < 0) {
            return null;
        }

        const yamlBlock = normalized.slice(4, closingIndex);
        const bodyStart = closingMarker >= 0 ? closingIndex + 5 : normalized.length;
        const body = normalized.slice(bodyStart);

        try {
            const parsed = parseYaml(yamlBlock);
            const frontmatter = this.cloneFrontmatterObject((parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>);
            return { frontmatter, body };
        } catch (err) {
            logger.warn("Failed to parse YAML frontmatter block", err);
            return { frontmatter: {}, body };
        }
    }

    private async ensureFolderPath(path: string): Promise<void> {
        const clean = normalizePath(path).trim();
        if (!clean) return;
        const segments = clean.split("/").filter(Boolean);
        let current = "";
        for (const segment of segments) {
            current = current ? `${current}/${segment}` : segment;
            if (!this.app.vault.getAbstractFileByPath(current)) {
                try {
                    await this.app.vault.createFolder(current);
                } catch (error) {
                    if (!this.app.vault.getAbstractFileByPath(current)) throw error;
                }
            }
        }
    }

    private getUniqueArchiveTargetPath(file: TFile, archiveFolder: string): string {
        const targetBase = normalizePath(`${archiveFolder}/${file.name}`);
        let targetPath = targetBase;
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(targetPath)) {
            targetPath = normalizePath(`${archiveFolder}/${file.basename} ${counter}.${file.extension}`);
            counter += 1;
        }
        return targetPath;
    }

    private getEffectiveArchiveFolder(baseArchiveFolder: string): string {
        if (!this.plugin.settings.archiveUseDailyFolder) {
            return baseArchiveFolder;
        }
        const today = window.moment().format("YYYY-MM-DD");
        return normalizePath(`${baseArchiveFolder}/${today}`);
    }

    private flattenTagValues(value: unknown): string[] {
        if (typeof value === "string") {
            return value.split(",").map((entry) => entry.trim()).filter(Boolean);
        }
        if (Array.isArray(value)) {
            return value.flatMap((entry) => this.flattenTagValues(entry));
        }
        return [];
    }

    private fileHasArchiveTag(file: TFile, archiveTag: string): boolean {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const tags = this.flattenTagValues(frontmatter?.tags);
        return tags.some((tag) => {
            const normalized = normalizeTagValue(tag);
            return normalized === archiveTag || normalized.startsWith(`${archiveTag}/`);
        });
    }

    async sweepArchiveTaggedFiles(reason: "startup-catchup" | "scheduled" | "manual" = "manual"): Promise<{ archived: number; scanned: number }> {
        const archiveTag = normalizeTagValue(this.plugin.settings.archiveTag || "archive");
        const archiveRoot = this.plugin.getArchiveFolderPath();
        if (!archiveTag || !archiveRoot) {
            logger.warn("[TPS GCM] Archive sweep skipped: archive tag/folder settings are not configured");
            return { archived: 0, scanned: 0 };
        }

        const filesToArchive = this.app.vault.getMarkdownFiles().filter((file) => {
            if (file.path.startsWith(`${archiveRoot}/`)) return false;
            return this.fileHasArchiveTag(file, archiveTag);
        });

        if (filesToArchive.length === 0) {
            logger.log(`[TPS GCM] Archive sweep (${reason}) found no tagged files`);
            return { archived: 0, scanned: 0 };
        }

        const targetArchiveFolder = this.getEffectiveArchiveFolder(archiveRoot);
        await this.ensureFolderPath(targetArchiveFolder);

        let archived = 0;
        await this.plugin.runQueuedMove(filesToArchive, async () => {
            for (const file of filesToArchive) {
                const existing = this.app.vault.getAbstractFileByPath(file.path);
                const liveFile = existing instanceof TFile ? existing : file;
                if (liveFile.path.startsWith(`${archiveRoot}/`)) {
                    continue;
                }

                try {
                    const targetPath = this.getUniqueArchiveTargetPath(liveFile, targetArchiveFolder);
                    await this.app.fileManager.renameFile(liveFile, targetPath);
                    archived += 1;
                } catch (err) {
                    logger.error("[TPS GCM] Failed moving archive-tagged file during sweep", liveFile.path, err);
                }
            }
        });

        logger.log(`[TPS GCM] Archive sweep (${reason}) moved ${archived}/${filesToArchive.length} file(s) to "${targetArchiveFolder}"`);
        return { archived, scanned: filesToArchive.length };
    }

    private async archiveSourceNotes(files: TFile[], excludePaths: Set<string> = new Set()): Promise<{ archived: number }> {
        const archiveTag = normalizeTagValue(this.plugin.settings.archiveTag || "archive");
        if (!archiveTag) {
            logger.warn("[TPS GCM] Archive skipped: archive tag setting is not configured");
            return { archived: 0 };
        }

        const byPath = new Map<string, TFile>();
        for (const file of files) {
            if (!(file instanceof TFile)) continue;
            byPath.set(file.path, file);
        }

        let archived = 0;
        for (const [path, file] of byPath.entries()) {
            if (excludePaths.has(path)) {
                continue;
            }

            const existing = this.app.vault.getAbstractFileByPath(path);
            const liveFile = existing instanceof TFile ? existing : file;
            if (excludePaths.has(liveFile.path) || liveFile.extension?.toLowerCase() !== "md") {
                continue;
            }

            try {
                await this.plugin.frontmatterMutationService.process(liveFile, (frontmatter: any) => {
                    frontmatter.tags = mergeNormalizedTags(frontmatter.tags, archiveTag);
                });
                archived += 1;
            } catch (err) {
                logger.error("[TPS GCM] Failed adding archive tag after add-to-note", liveFile.path, err);
            }
        }

        logger.log(`[NoteOperationService] Archive complete: ${archived}/${files.length} file(s) tagged for archive`);
        return { archived };
    }
}

class TargetNoteModal extends FuzzySuggestModal<TFile> {
    private settled = false;

    constructor(
        app: App,
        private readonly excludedPaths: Set<string>,
        private readonly onResolve: (file: TFile | null) => void,
    ) {
        super(app);
        this.setPlaceholder("Choose list note...");
    }

    getItems(): TFile[] {
        return this.app.vault
            .getMarkdownFiles()
            .filter((file) => !this.excludedPaths.has(file.path));
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile): void {
        this.finish(file);
    }

    onClose(): void {
        window.setTimeout(() => this.finish(null), 0);
    }

    private finish(file: TFile | null): void {
        if (this.settled) return;
        this.settled = true;
        this.onResolve(file);
    }
}

class HeaderSuggestModal extends FuzzySuggestModal<HeaderTarget> {
    private settled = false;

    constructor(
        app: App,
        private readonly headers: HeaderTarget[],
        targetName: string,
        private readonly onResolve: (header: HeaderTarget | null) => void,
    ) {
        super(app);
        this.setPlaceholder(`Choose heading in ${targetName}...`);
    }

    getItems(): HeaderTarget[] {
        return this.headers;
    }

    getItemText(item: HeaderTarget): string {
        return item.display;
    }

    onChooseItem(item: HeaderTarget): void {
        this.finish(item);
    }

    onClose(): void {
        window.setTimeout(() => this.finish(null), 0);
    }

    private finish(header: HeaderTarget | null): void {
        if (this.settled) return;
        this.settled = true;
        this.onResolve(header);
    }
}

class DailyModeModal extends Modal {
    private resolved = false;
    private readonly onResolve: (value: 'created' | 'edited' | null) => void;

    constructor(app: App, onResolve: (value: 'created' | 'edited' | null) => void) {
        super(app);
        this.onResolve = onResolve;
    }

    onOpen(): void {
        this.modalEl.addClass('mod-tps-gcm');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: 'Add To Daily Note By' });

        const desc = contentEl.createEl('p', {
            text: 'Choose which timestamp should map each note to a daily note.',
        });
        desc.style.marginBottom = '12px';

        const actions = contentEl.createDiv();
        actions.style.display = 'flex';
        actions.style.gap = '8px';

        const createdBtn = actions.createEl('button', { text: 'Created' });
        createdBtn.addClass('mod-cta');
        createdBtn.onclick = () => this.finish('created');

        const editedBtn = actions.createEl('button', { text: 'Edited' });
        editedBtn.onclick = () => this.finish('edited');
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) {
            this.onResolve(null);
        }
    }

    private finish(value: 'created' | 'edited'): void {
        this.resolved = true;
        this.onResolve(value);
        this.close();
    }
}
