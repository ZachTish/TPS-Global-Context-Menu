import { App, TFile, Notice, FuzzySuggestModal, parseYaml, normalizePath } from "obsidian";
import TPSGlobalContextMenuPlugin from "./main";
import * as logger from "./logger";

export class NoteOperationService {
    app: App;
    plugin: TPSGlobalContextMenuPlugin;

    constructor(plugin: TPSGlobalContextMenuPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
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
            for (const file of files) {
                try {
                    const section = await this.buildSectionForNote(file);
                    sections.push(section);
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
            await this.app.vault.modify(picker, `${existing}${spacer}${sections.join("\n")}`);
            new Notice(`Added ${sections.length} note(s) to ${picker.basename}`);

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

            const grouped = new Map<string, string[]>();

            for (const file of files) {
                const parts = await this.extractNoteParts(file);
                const date = this.pickCreatedDate(parts.frontmatter, file);
                if (!date) {
                    logger.warn("No created date for file", file.path);
                    continue;
                }
                const section = await this.buildSectionForNote(file, parts);
                if (grouped.has(date)) {
                    grouped.get(date)?.push(section);
                } else {
                    grouped.set(date, [section]);
                }
            }

            if (!grouped.size) {
                new Notice("No usable created dates found");
                return;
            }

            for (const [date, sections] of grouped.entries()) {
                try {
                    const daily = await this.ensureDailyNote(date);
                    if (!daily) continue;

                    const existing = await this.app.vault.read(daily);
                    const spacer = existing.endsWith("\n") ? "\n" : "\n\n";
                    await this.app.vault.modify(
                        daily,
                        `${existing}${spacer}${sections.join("\n")}`,
                    );
                } catch (err) {
                    logger.error("Failed to append to daily note", date, err);
                }
            }

            new Notice(`Added ${files.length} note(s) to daily notes`);

        } catch (err) {
            logger.error("Add to daily note failed", err);
            new Notice("Unable to add to daily note");
        }
    }

    private async extractNoteParts(file: TFile) {
        const raw = await this.app.vault.read(file);
        const cache = this.app.metadataCache.getFileCache(file);
        let frontmatter: any = {};
        let body = raw;

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

        return `### ${title}\n\n#### Frontmatter\n${fmBlock}\n\n#### Body\n${bodyBlock}\n`;
    }

    private serializeFrontmatterForSection(fm: any): string {
        if (!fm || typeof fm !== "object") return "- (none)";
        const lines: string[] = [];
        for (const [key, val] of Object.entries(fm)) {
            if (val === undefined) continue;
            let displayVal: string;

            if (key.toLowerCase() === 'tags') {
                displayVal = this.normalizeTagsWithHash(val);
            } else if (Array.isArray(val)) {
                displayVal = val.map(v => (v === null ? "" : typeof v === 'object' ? JSON.stringify(v) : `${v}`))
                    .filter(Boolean).join(", ");
            } else if (val && typeof val === 'object') {
                displayVal = JSON.stringify(val);
            } else {
                displayVal = `${val}`;
            }
            lines.push(`- ${key}: ${displayVal}`);
        }
        return lines.length ? lines.join("\n") : "- (none)";
    }

    private normalizeTagsWithHash(tags: any): string {
        if (tags == null) return "";
        let values: string[] = [];
        if (Array.isArray(tags)) {
            values = tags.slice();
        } else if (typeof tags === 'string') {
            values = tags.split(/[\s,]+/).filter(Boolean);
        } else {
            values = [`${tags}`];
        }
        return values.map(t => {
            const raw = typeof t === 'string' ? t : `${t || ""}`;
            const clean = raw.replace(/^#/, "");
            return clean ? `#${clean}` : "";
        }).filter(Boolean).join(" ");
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

    private pickCreatedDate(fm: any, file: TFile): string | null {
        const candidates: any[] = [];
        fm = fm || {};

        // Check frontmatter keys
        for (const [key, val] of Object.entries(fm)) {
            const norm = key.replace(/\s+/g, "").toLowerCase();
            if (["createddate", "datecreated", "created"].includes(norm)) {
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

        // Fallback to file creation time
        if (file.stat.ctime) {
            const d = new Date(file.stat.ctime);
            return d.toISOString().split("T")[0];
        }
        return null;
    }

    private async ensureDailyNote(dateStr: string): Promise<TFile | null> {
        // Read from Core Daily Notes plugin settings
        let folder = "System/Dailynotes";
        let templatePath = "System/Dailynotes/Daily Note Template.md";

        try {
            const dailyNotesPlugin = (this.app as any).internalPlugins?.plugins?.["daily-notes"];
            if (dailyNotesPlugin?.enabled && dailyNotesPlugin?.instance?.options) {
                const opts = dailyNotesPlugin.instance.options;
                if (opts.folder) folder = opts.folder;
                if (opts.template) templatePath = opts.template;
                if (!templatePath.endsWith(".md")) templatePath += ".md";
            }
        } catch (err) {
            logger.warn("Failed to read core Daily Notes settings", err);
        }

        const path = normalizePath(`${folder}/${dateStr}.md`);
        const adapter = this.app.vault.adapter;

        if (await adapter.exists(path)) {
            const existing = this.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) return existing;
            return null;
        }

        // Create if missing
        // Ensure folder exists
        if (!(await adapter.exists(folder))) {
            await this.app.vault.createFolder(folder);
        }

        let content = "";
        let hasFrontmatter = false;

        try {
            const normalizedTemplatePath = normalizePath(templatePath);
            if (await adapter.exists(normalizedTemplatePath)) {
                content = await adapter.read(normalizedTemplatePath);
                hasFrontmatter = content.trimStart().startsWith("---");
            }
        } catch {
            content = "";
        }

        if (!content) {
            content = `---\ntitle: ${dateStr}\ntags: [dailynote]\n---\n\n`;
        } else if (hasFrontmatter) {
            // Simple regex replace for title
            if (/^title\s*:/m.test(content))
                content = content.replace(/^title\s*:.*$/m, `title: ${dateStr}`);
            else content = content.replace(/^---\n/, `---\ntitle: ${dateStr}\n`);
        } else {
            content = `---\ntitle: ${dateStr}\ntags: [dailynote]\n---\n\n${content}`;
        }

        return await this.app.vault.create(path, content);
    }
}
