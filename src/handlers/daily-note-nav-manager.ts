import { App, Component, Modal, TFile, WorkspaceLeaf, setIcon, normalizePath, Notice, Platform } from "obsidian";
import TPSGlobalContextMenuPlugin from "../main";
import * as logger from "../logger";
import { findExistingDailyNoteForIsoDate, getDailyNoteScheduledValueForIsoDate } from "../utils/daily-note-task-schedule";
import { isFrontmatterMutationReady } from "../services/frontmatter-mutation-outcome";
import { normalizeLeadingWhitespaceBeforeFrontmatter as normalizeLeadingFrontmatter } from "../services/leading-frontmatter-normalizer";

type DailyNavTarget = {
    leaf: WorkspaceLeaf;
    isoDate: string;
    kind: "daily-note" | "scheduled-note";
};

export class DailyNoteNavManager extends Component {
    plugin: TPSGlobalContextMenuPlugin;
    currentNav: HTMLElement | null = null;
    private currentHost: HTMLElement | null = null;
    private _refreshTimer: ReturnType<typeof setTimeout> | null = null;
    private _layoutRetryTimers: ReturnType<typeof setTimeout>[] = [];
    private _navAbortController: AbortController | null = null;
    private _currentLeaf: WorkspaceLeaf | null = null;
    private _currentIsoDate: string | null = null;
    private _currentKind: DailyNavTarget["kind"] | null = null;

    constructor(plugin: TPSGlobalContextMenuPlugin) {
        super();
        this.plugin = plugin;
    }

    onload() {
        this.registerEvent(
            this.plugin.app.workspace.on("active-leaf-change", () => this._scheduleRefresh())
        );
        this.registerEvent(
            this.plugin.app.workspace.on("file-open", () => this._scheduleRefresh())
        );
        this.registerEvent(
            this.plugin.app.workspace.on("layout-change", () => this._scheduleRefresh())
        );
        this.plugin.app.workspace.onLayoutReady(() => {
            for (const delay of [100, 500, 1200]) {
                const timer = setTimeout(() => {
                    this._layoutRetryTimers = this._layoutRetryTimers.filter((candidate) => candidate !== timer);
                    this._scheduleRefresh();
                }, delay);
                this._layoutRetryTimers.push(timer);
            }
        });
        // Initial refresh
        this.refresh();
    }

    /** Debounce rapid back-to-back events (active-leaf-change + file-open fire together). */
    private _scheduleRefresh() {
        if (this.plugin.overlayRenderingService) {
            this.plugin.overlayRenderingService.scheduleDailyNavRefresh("daily-note-nav-event", 30);
            return;
        }
        this._scheduleRefreshDirect();
    }

    private _scheduleRefreshDirect() {
        if (this._refreshTimer !== null) clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = null;
            this.refresh();
        }, 30);
    }

    onunload() {
        if (this._refreshTimer !== null) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = null;
        }
        for (const timer of this._layoutRetryTimers) clearTimeout(timer);
        this._layoutRetryTimers = [];
        this.detachNav();
    }

    getDailyNoteSettings() {
        try {
            // 1. Try Periodic Notes plugin (community plugin)
            // @ts-ignore
            const periodicNotes = this.plugin.app.plugins.getPlugin("periodic-notes");
            if (periodicNotes && periodicNotes.settings?.daily) {
                return {
                    format: periodicNotes.settings.daily.format || "YYYY-MM-DD",
                    folder: periodicNotes.settings.daily.folder || "",
                    template: periodicNotes.settings.daily.template || ""
                };
            }

            // 2. Try Core Daily Notes plugin (internal plugin)
            // @ts-ignore - internal API
            const internalPlugins = (this.plugin.app as any).internalPlugins;
            const dailyNotes = internalPlugins.getPluginById("daily-notes");
            if (dailyNotes && dailyNotes.instance && dailyNotes.instance.options) {
                return {
                    format: dailyNotes.instance.options.format || "YYYY-MM-DD",
                    folder: dailyNotes.instance.options.folder || "",
                    template: dailyNotes.instance.options.template || ""
                };
            }
        } catch (e) {
            logger.error("Failed to load daily note settings", e);
        }
        return { format: "YYYY-MM-DD", folder: "", template: "" };
    }

    refresh() {
        if (!this.plugin.settings.enableDailyNoteNav) {
            this.detachNav();
            return;
        }

        const target = this.getTargetLeaf();
        this.removeStrayMobileNavs();
        if (!target) {
            this.detachNav();
            return;
        }

        if (
            this.currentNav?.isConnected &&
            this._currentLeaf === target.leaf &&
            this._currentIsoDate === target.isoDate &&
            this._currentKind === target.kind
        ) {
            return;
        }

        this.detachNav();
        this._currentLeaf = target.leaf;
        this._currentIsoDate = target.isoDate;
        this._currentKind = target.kind;
        if (target.kind === "daily-note") {
            this.injectNav(target.leaf, target.isoDate);
        } else {
            this.injectScheduledDailyNoteButton(target.leaf, target.isoDate);
        }
    }

    private detachNav(): void {
        this._navAbortController?.abort();
        this._navAbortController = null;
        if (this.currentNav) {
            this.currentNav.remove();
            this.currentNav = null;
        }
        if (this.currentHost) {
            this.currentHost.removeClass("tps-daily-note-nav-host");
            this.currentHost.removeClass("tps-daily-note-nav-anchor");
            this.currentHost.removeClass("tps-daily-note-nav-header-host");
            this.currentHost.removeClass("tps-daily-note-nav-mobile-host");
            this.currentHost.removeClass("tps-scheduled-daily-note-link-host");
            this.currentHost.style.removeProperty("--tps-daily-nav-reserved-width");
        }
        this.currentHost = null;
        this._currentLeaf = null;
        this._currentIsoDate = null;
        this._currentKind = null;
    }

    private getTargetLeaf(): DailyNavTarget | null {
        const activeLeaf = this.plugin.app.workspace.activeLeaf;
        const activeTarget = this.getDailyNoteLeafInfo(activeLeaf);
        if (activeTarget) return activeTarget;

        const scheduledTarget = this.getScheduledNoteLeafInfo(activeLeaf);
        if (scheduledTarget) return scheduledTarget;

        if (!this.isMobileLayout()) {
            const currentTarget = this.getDailyNoteLeafInfo(this._currentLeaf);
            if (currentTarget && this.isLeafVisible(currentTarget.leaf)) {
                return currentTarget;
            }

            for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
                const candidate = this.getDailyNoteLeafInfo(leaf);
                if (candidate && this.isLeafVisible(leaf)) return candidate;
            }
        }

        return null;
    }

    private getDailyNoteLeafInfo(leaf: WorkspaceLeaf | null | undefined): DailyNavTarget | null {
        if (!leaf?.view || leaf.getViewState().type !== "markdown") return null;
        const file = (leaf.view as any).file;
        if (!(file instanceof TFile)) return null;

        const { format } = this.getDailyNoteSettings();
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;
        const basenameDate = this.parseDailyNoteBasename(file.basename, format);
        const hasDailyNoteType = this.hasDailyNoteType(frontmatter);
        if (!basenameDate && !hasDailyNoteType) return null;
        const date = this.resolveDailyNoteDate(file, format, frontmatter, basenameDate);
        if (!date) return null;
        return { leaf, isoDate: date.format("YYYY-MM-DD"), kind: "daily-note" };
    }

    private getScheduledNoteLeafInfo(leaf: WorkspaceLeaf | null | undefined): DailyNavTarget | null {
        if (!leaf?.view || leaf.getViewState().type !== "markdown") return null;
        const file = (leaf.view as any).file;
        if (!(file instanceof TFile)) return null;

        const { format } = this.getDailyNoteSettings();
        const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        const scheduledDate = this.parseDailyNoteDateValue(frontmatter?.scheduled, format);
        if (!scheduledDate) return null;
        if (this.getDailyNoteLeafInfo(leaf)) return null;

        return { leaf, isoDate: scheduledDate.format("YYYY-MM-DD"), kind: "scheduled-note" };
    }

    private hasDailyNoteType(frontmatter: Record<string, any> | null | undefined): boolean {
        if (!frontmatter) return false;
        return this.frontmatterValueContains(frontmatter.types, "dailynote")
            || this.frontmatterValueContains(frontmatter.type, "dailynote")
            || this.frontmatterValueContains(frontmatter.tags, "dailynote")
            || this.frontmatterValueContains(frontmatter.tag, "dailynote");
    }

    private frontmatterValueContains(value: unknown, expected: string): boolean {
        const normalizedExpected = this.normalizeDailyNoteMarker(expected);
        return this.flattenFrontmatterValue(value).some((entry) => this.normalizeDailyNoteMarker(entry) === normalizedExpected);
    }

    private flattenFrontmatterValue(value: unknown): string[] {
        if (Array.isArray(value)) return value.flatMap((entry) => this.flattenFrontmatterValue(entry));
        if (value && typeof value === "object") {
            return Object.values(value as Record<string, unknown>).flatMap((entry) => this.flattenFrontmatterValue(entry));
        }
        if (typeof value === "string") {
            return value.split(/[,;]/).map((entry) => entry.trim()).filter(Boolean);
        }
        if (value == null) return [];
        return [String(value)];
    }

    private normalizeDailyNoteMarker(value: unknown): string {
        return String(value ?? "").trim().replace(/^#/, "").replace(/[\s_-]+/g, "").toLowerCase();
    }

    private resolveDailyNoteDate(
        file: TFile,
        format: string | undefined,
        frontmatter: Record<string, any> | null | undefined,
        basenameDate: any | null,
    ): any | null {
        if (frontmatter) {
            for (const key of ["scheduled", "date", "day", "daily", "title"]) {
                const parsed = this.parseDailyNoteDateValue(frontmatter[key], format);
                if (parsed) return parsed;
            }
        }
        return basenameDate ?? this.parseDailyNoteBasename(file.basename, format);
    }

    private isLeafVisible(leaf: WorkspaceLeaf | null | undefined): boolean {
        const view = leaf?.view as any;
        const el = (view?.containerEl || (leaf as any)?.containerEl) as HTMLElement | undefined;
        if (!el?.isConnected) return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    injectNav(leaf: WorkspaceLeaf, isoDateStr: string) {
        const view = leaf.view as any;
        const container = view?.contentEl as HTMLElement | undefined;
        if (!container) return;

        // Fresh AbortController for this nav's event listeners
        this._navAbortController = new AbortController();

        // Desktop uses the view header. Mobile attaches to the active leaf shell
        // so it remains visible without escaping the note's lifecycle.
        const mobilePlacement = this.resolveMobileBottomNavPlacement(leaf);
        const headerHost = mobilePlacement ? null : this.resolveHeaderNavHost(leaf);
        const titleAnchor = this.resolveTitleAnchor(leaf);
        const host = mobilePlacement?.host ?? headerHost ?? container;
        this.currentHost = host;

        // Create the nav element
        const nav = document.createElement("div");
        nav.className = "tps-daily-note-nav";
        this.hardenNavControl(nav);
        if (mobilePlacement) {
            nav.addClass("tps-daily-note-nav--mobile-bottom");
            mobilePlacement.host.addClass("tps-daily-note-nav-mobile-host");
            mobilePlacement.host.insertBefore(nav, mobilePlacement.before);
        } else if (headerHost) {
            nav.addClass("tps-daily-note-nav--header");
            headerHost.addClass("tps-daily-note-nav-header-host");
            headerHost.appendChild(nav);
        } else if (titleAnchor) {
            nav.addClass("tps-daily-note-nav--under-title");
            host.addClass("tps-daily-note-nav-anchor");
            titleAnchor.insertAdjacentElement("beforebegin", nav);
        } else {
            nav.addClass("tps-daily-note-nav--floating");
            host.appendChild(nav);
        }
        this.currentNav = nav;

        // Mark as always-interactive when rest opacity > 0
        if ((this.plugin.settings.dailyNavRestOpacity ?? 0) > 0) {
            nav.dataset.restVisible = "true";
        }

        const m = (window as any).moment;
        const activeDate = m(isoDateStr, "YYYY-MM-DD");
        const todayIso = m().format("YYYY-MM-DD");
        const isTodayActive = isoDateStr === todayIso;
        const weekStart = activeDate.clone().isoWeekday(1);

        const timeline = nav.createDiv({ cls: "tps-daily-nav-timeline" });
        this.hardenNavControl(timeline);
        for (let offset = 0; offset < 7; offset++) {
            const day = weekStart.clone().add(offset, "days");
            const dayIso = day.format("YYYY-MM-DD");
            const dayBtn = timeline.createEl("button", {
                cls: "tps-daily-nav-day",
                text: day.format("ddd D")
            });
            dayBtn.type = "button";
            dayBtn.toggleClass("is-active", dayIso === isoDateStr);
            dayBtn.setAttribute("aria-label", `Open ${day.format("dddd, MMMM D, YYYY")}`);
            dayBtn.setAttribute("aria-current", dayIso === isoDateStr ? "date" : "false");
            this.hardenNavControl(dayBtn);
            this.attachTapNavigation(dayBtn, (event) => {
                this.suppressNavEvent(event);
                this.goToDate(dayIso, 0, leaf);
            });
        }

        const controls = nav.createDiv({ cls: "tps-daily-nav-controls" });
        this.hardenNavControl(controls);

        // Left Arrow (Prev)
        const prevBtn = controls.createEl("button", { cls: "tps-daily-nav-btn" });
        prevBtn.type = "button";
        setIcon(prevBtn, "chevron-left");
        this.hardenNavControl(prevBtn);
        this.attachTapNavigation(prevBtn, (e) => {
            this.suppressNavEvent(e);
            this.goToDate(isoDateStr, -1, leaf);
        });

        // Today Button (optional)
        if (this.plugin.settings.dailyNavShowToday !== false) {
            const todayBtn = controls.createEl("button", {
                cls: "tps-daily-nav-today",
                text: "Today"
            });
            todayBtn.type = "button";
            todayBtn.toggleClass("is-active", isTodayActive);
            todayBtn.setAttribute("aria-current", isTodayActive ? "date" : "false");
            this.hardenNavControl(todayBtn);
            this.attachTapNavigation(todayBtn, (e) => {
                this.suppressNavEvent(e);
                this.goToDate(null, 0, leaf);
            });
        }

        // Right Arrow (Next)
        const nextBtn = controls.createEl("button", { cls: "tps-daily-nav-btn" });
        nextBtn.type = "button";
        setIcon(nextBtn, "chevron-right");
        this.hardenNavControl(nextBtn);
        this.attachTapNavigation(nextBtn, (e) => {
            this.suppressNavEvent(e);
            this.goToDate(isoDateStr, 1, leaf);
        });
    }

    private injectScheduledDailyNoteButton(leaf: WorkspaceLeaf, isoDateStr: string): void {
        if (this.plugin.settings.enableTopParentNav) return;

        const view = leaf.view as any;
        const container = view?.contentEl as HTMLElement | undefined;
        if (!container) return;

        this._navAbortController = new AbortController();

        const mobilePlacement = this.resolveMobileBottomNavPlacement(leaf);
        const titleAnchor = this.resolveTitleAnchor(leaf);
        const headerHost = mobilePlacement || titleAnchor ? null : this.resolveHeaderNavHost(leaf);
        const host = mobilePlacement?.host ?? titleAnchor?.parentElement ?? headerHost ?? container;
        this.currentHost = host;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "tps-scheduled-daily-note-link tps-gcm-parent-nav-button tps-gcm-parent-nav-button--top";

        const m = (window as any).moment;
        const date = m?.(isoDateStr, "YYYY-MM-DD");
        const hasValidDate = date?.isValid?.() === true;
        const label = hasValidDate ? `Open daily note for ${date.format("MMM D")}` : "Open daily note";
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
        this.hardenNavControl(button);

        setIcon(button, "calendar-days");
        const text = button.createSpan({ cls: "tps-scheduled-daily-note-link-label" });
        text.setText(hasValidDate ? date.format("MMM D") : "Daily");

        if (mobilePlacement) {
            button.addClass("tps-scheduled-daily-note-link--mobile-bottom");
            mobilePlacement.host.addClass("tps-daily-note-nav-mobile-host");
            mobilePlacement.host.insertBefore(button, mobilePlacement.before);
        } else if (headerHost) {
            button.addClass("tps-scheduled-daily-note-link--header");
            headerHost.addClass("tps-scheduled-daily-note-link-host");
            headerHost.appendChild(button);
        } else if (titleAnchor) {
            button.addClass("tps-scheduled-daily-note-link--under-title");
            host.addClass("tps-scheduled-daily-note-link-host");
            titleAnchor.insertAdjacentElement("afterend", button);
        } else {
            button.addClass("tps-scheduled-daily-note-link--floating");
            host.appendChild(button);
        }

        this.currentNav = button;

        this.attachTapNavigation(button, (event) => {
            this.suppressNavEvent(event);
            this.goToDate(isoDateStr, 0, leaf);
        });
    }

    private isMobileLayout(): boolean {
        return Platform.isMobile
            || Platform.isPhone
            || Platform.isTablet
            || !!(this.plugin.app as any)?.isMobile
            || document.body.classList.contains("is-mobile")
            || document.body.classList.contains("is-phone");
    }

    private getDailyNoteDateFormats(primaryFormat?: string): string[] {
        const formats = [
            primaryFormat,
            "ddd, MMM D YYYY",
            "ddd, MMM DD YYYY",
            "dddd, MMMM D YYYY",
            "dddd, MMMM DD YYYY",
            "YYYY-MM-DD",
            "YYYY_MM_DD",
            "YYYYMMDD",
            "MMMM D, YYYY",
            "MMM D, YYYY",
        ];
        return Array.from(new Set(formats.map((format) => String(format || "").trim()).filter(Boolean)));
    }

    private parseDailyNoteBasename(basename: string, primaryFormat?: string): any | null {
        const m = (window as any).moment;
        if (!m) return null;
        const parsed = m(String(basename || "").trim(), this.getDailyNoteDateFormats(primaryFormat), true);
        return parsed?.isValid?.() ? parsed : null;
    }

    private parseDailyNoteDateValue(value: unknown, primaryFormat?: string): any | null {
        const m = (window as any).moment;
        if (!m || value == null) return null;
        if (value instanceof Date) {
            const parsed = m(value);
            return parsed?.isValid?.() ? parsed : null;
        }

        const raw = Array.isArray(value) ? value[0] : value;
        const text = String(raw ?? "").trim();
        if (!text) return null;

        const formats = [
            "YYYY-MM-DD HH:mm:ss",
            "YYYY-MM-DD HH:mm",
            "YYYY-MM-DDTHH:mm:ss",
            "YYYY-MM-DDTHH:mm",
            ...this.getDailyNoteDateFormats(primaryFormat),
        ];
        const parsed = m(text, Array.from(new Set(formats)), true);
        if (parsed?.isValid?.()) return parsed;

        if (!this.looksLikeDateValue(text)) return null;
        const fallback = m(text);
        return fallback?.isValid?.() ? fallback : null;
    }

    private looksLikeDateValue(text: string): boolean {
        return /^\d{4}[-_/]\d{1,2}[-_/]\d{1,2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(text)
            || /^\d{8}$/.test(text)
            || /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?[, ]/i.test(text)
            || /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}$/i.test(text);
    }

    private resolveMobileBottomNavPlacement(
        leaf: WorkspaceLeaf,
    ): { host: HTMLElement; before: ChildNode | null } | null {
        if (!this.isMobileLayout()) return null;

        const view = leaf.view as any;
        const contentEl = view?.contentEl as HTMLElement | undefined;
        const viewContainer = view?.containerEl as HTMLElement | undefined;
        const leafContainer = (leaf as any)?.containerEl as HTMLElement | undefined;
        if (!contentEl?.isConnected) return null;

        const leafShell =
            viewContainer?.closest<HTMLElement>(".workspace-leaf-content")
            || contentEl.closest<HTMLElement>(".workspace-leaf-content")
            || leafContainer?.querySelector<HTMLElement>(".workspace-leaf-content")
            || viewContainer
            || contentEl;
        if (!leafShell?.isConnected) return null;

        return {
            host: leafShell,
            before: null,
        };
    }

    private removeStrayMobileNavs(): void {
        const navs = Array.from(document.querySelectorAll<HTMLElement>(
            ".tps-daily-note-nav--mobile-bottom, .tps-scheduled-daily-note-link--mobile-bottom"
        ));
        for (const nav of navs) {
            if (nav === this.currentNav) continue;
            nav.remove();
        }
        const hosts = Array.from(document.querySelectorAll<HTMLElement>(".tps-daily-note-nav-mobile-host"));
        for (const host of hosts) {
            if (host === this.currentHost) continue;
            if (!host.querySelector(".tps-daily-note-nav--mobile-bottom, .tps-scheduled-daily-note-link--mobile-bottom")) {
                host.removeClass("tps-daily-note-nav-mobile-host");
            }
        }
    }

    private resolveHeaderNavHost(leaf: WorkspaceLeaf): HTMLElement | null {
        const view = leaf.view as any;
        const roots = [
            (leaf as any)?.containerEl as HTMLElement | undefined,
            view?.containerEl?.closest?.(".workspace-leaf-content") as HTMLElement | undefined,
            view?.containerEl as HTMLElement | undefined,
        ].filter((root): root is HTMLElement => root instanceof HTMLElement);

        for (const root of roots) {
            const header = root.querySelector<HTMLElement>(".view-header");
            if (header) return header;
        }

        return null;
    }

    private resolveTitleAnchor(leaf: WorkspaceLeaf): HTMLElement | null {
        const view = leaf.view as any;
        const container = view?.contentEl as HTMLElement | undefined;
        const root = view?.containerEl as HTMLElement | undefined;
        const file = view?.file as TFile | undefined;
        if (!container) return null;

        const scopedRoot = root ?? container;
        const expectedTitleValues = new Set<string>();
        const normalizeForCompare = (value: string): string => String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '')
            .trim();
        if (file?.basename) expectedTitleValues.add(normalizeForCompare(file.basename));
        if (file) {
            const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, any> | undefined;
            const fmTitle = typeof fm?.title === "string" ? fm.title.trim() : "";
            if (fmTitle) expectedTitleValues.add(normalizeForCompare(fmTitle));
        }
        const matchesExpectedTitle = (el: HTMLElement | null): boolean => {
            if (!el) return false;
            if (expectedTitleValues.size === 0) return true;
            const text = normalizeForCompare(el.textContent || "");
            return !!text && expectedTitleValues.has(text);
        };

        const inlineTitles = Array.from(scopedRoot.querySelectorAll<HTMLElement>(".inline-title"));
        const previewH1Candidates = Array.from(
            scopedRoot.querySelectorAll<HTMLElement>(
                ".markdown-preview-view .markdown-preview-sizer > h1, .markdown-reading-view .markdown-preview-sizer > h1, .markdown-preview-view h1"
            )
        );
        const titleCandidates = [...inlineTitles, ...previewH1Candidates]
            .filter((el) => {
                const text = String(el.textContent || '').trim().toLowerCase();
                return text.length > 0 && !text.includes('subitems');
            })
            .sort((a, b) => {
                const pos = a.compareDocumentPosition(b);
                return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
            });

        const matchedCandidate = titleCandidates.find((el) => matchesExpectedTitle(el));
        if (matchedCandidate) return matchedCandidate;
        if (titleCandidates.length > 0) return titleCandidates[0];

        const sourceHeading =
            scopedRoot.querySelector<HTMLElement>(".markdown-source-view .cm-line.HyperMD-header-1") ||
            scopedRoot.querySelector<HTMLElement>(".markdown-source-view .cm-header-1");
        if (sourceHeading) {
            return sourceHeading.classList.contains("cm-line")
                ? sourceHeading
                : (sourceHeading.closest<HTMLElement>(".cm-line") || sourceHeading);
        }

        return null;
    }

    private suppressNavEvent(event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        if (typeof (event as any).stopImmediatePropagation === "function") {
            (event as any).stopImmediatePropagation();
        }
    }

    private attachTapNavigation(el: HTMLElement, handler: (event: Event) => void): void {
        let touchStart: { x: number; y: number } | null = null;
        let suppressNextClickUntil = 0;
        const signal = this._navAbortController?.signal;

        el.addEventListener("touchstart", (event: TouchEvent) => {
            const touch = event.touches[0];
            touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
        }, { passive: true, signal } as any);

        el.addEventListener("touchend", (event: TouchEvent) => {
            const changed = event.changedTouches[0];
            const start = touchStart;
            touchStart = null;
            if (start && changed) {
                const dx = changed.clientX - start.x;
                const dy = changed.clientY - start.y;
                if (Math.hypot(dx, dy) > 12) return;
            }
            suppressNextClickUntil = Date.now() + 700;
            handler(event);
        }, { passive: false, signal } as any);

        el.addEventListener("click", (event: MouseEvent) => {
            if (Date.now() < suppressNextClickUntil) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            handler(event);
        }, { signal } as any);
    }

    private hardenNavControl(el: HTMLElement): void {
        el.setAttribute("contenteditable", "false");
        el.setAttribute("spellcheck", "false");
        el.setAttribute("draggable", "false");
        el.tabIndex = -1;
        el.addClass("tps-daily-note-nav-control");

        const signal = this._navAbortController?.signal;
        const suppressPointerDown = (event: Event) => {
            if (this.isMobileLayout()) return;
            this.suppressNavEvent(event);
        };
        el.addEventListener("pointerdown", suppressPointerDown, { capture: true, signal });
        el.addEventListener("mousedown", suppressPointerDown, { capture: true, signal });
        el.addEventListener("touchstart", suppressPointerDown, { capture: true, passive: false, signal } as any);
    }

    private async ensureFolderPath(path: string): Promise<void> {
        const clean = normalizePath(path).trim();
        if (!clean) return;
        const parts = clean.split("/").filter(Boolean);
        let current = "";
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!this.plugin.app.vault.getAbstractFileByPath(current)) {
                await this.plugin.app.vault.createFolder(current);
            }
        }
    }

    private async createViaCorePlugin(targetDate: any): Promise<TFile | null> {
        try {
            // Try core Daily Notes internal plugin first
            const internalPlugins = (this.plugin.app as any).internalPlugins;
            const dailyNotes = internalPlugins?.getPluginById("daily-notes");
            if (dailyNotes?.instance?.createNote) {
                const file = await dailyNotes.instance.createNote(targetDate);
                if (file instanceof TFile) return file;
            }

            // Try Periodic Notes community plugin
            // @ts-ignore
            const periodicNotes = this.plugin.app.plugins.getPlugin("periodic-notes");
            if (periodicNotes?.createDailyNote) {
                const file = await periodicNotes.createDailyNote(targetDate);
                if (file instanceof TFile) return file;
            }
        } catch (err) {
            logger.warn("Core plugin daily note creation failed, falling back to manual", err);
        }
        return null;
    }

    private async ensureDailyNoteExists(targetPath: string, titleValue: string, targetDate: any): Promise<TFile | null> {
        const normalizedPath = normalizePath(targetPath);
        const isoDate = targetDate?.format?.("YYYY-MM-DD") ?? null;
        const existingEquivalent = isoDate
            ? findExistingDailyNoteForIsoDate(this.plugin.app, this.plugin.settings, isoDate)
            : null;
        if (existingEquivalent instanceof TFile) {
            const slash = existingEquivalent.path.lastIndexOf("/");
            const folder = slash >= 0 ? existingEquivalent.path.substring(0, slash) : "";
            await this.normalizeCreatedDailyNote(existingEquivalent, titleValue, folder, isoDate);
            return existingEquivalent;
        }

        const existing = this.plugin.app.vault.getAbstractFileByPath(normalizedPath);
        if (existing instanceof TFile) {
            const slash = normalizedPath.lastIndexOf("/");
            const folder = slash >= 0 ? normalizedPath.substring(0, slash) : "";
            await this.normalizeCreatedDailyNote(existing, titleValue, folder, isoDate);
            return existing;
        }

        // Prefer delegating to the core/periodic plugin so folder, template, and
        // Templater/Dataview hooks are all respected correctly.
        const coreFile = await this.createViaCorePlugin(targetDate);
        if (coreFile instanceof TFile) {
            const slash = normalizedPath.lastIndexOf("/");
            const folder = slash >= 0 ? normalizedPath.substring(0, slash) : "";
            await this.normalizeCreatedDailyNote(coreFile, titleValue, folder, isoDate);
            return coreFile;
        }

        // Fallback: manual creation
        const slash = normalizedPath.lastIndexOf("/");
        const folder = slash >= 0 ? normalizedPath.substring(0, slash) : "";
        if (folder) {
            await this.ensureFolderPath(folder);
        }

        const { template } = this.getDailyNoteSettings();
        let content = "";
        let hasFrontmatter = false;
        const adapter = this.plugin.app.vault.adapter as any;

        try {
            // Core plugin stores template path without .md extension — resolve both forms
            let templatePath = normalizePath(template || "");
            if (templatePath) {
                const withMd = templatePath.endsWith(".md") ? templatePath : templatePath + ".md";
                const resolvedPath = (await adapter.exists(withMd)) ? withMd
                    : (await adapter.exists(templatePath)) ? templatePath
                    : null;
                if (resolvedPath) {
                    content = await adapter.read(resolvedPath);
                    hasFrontmatter = content.trimStart().startsWith("---");
                }
            }
        } catch (err) {
            logger.warn("Failed reading daily note template", err);
        }

        if (!content) {
            content = `---\ntitle: ${titleValue}\ntags: [dailynote]\n---\n\n`;
        } else if (hasFrontmatter) {
            // Preserve the template text exactly; the normalizer below owns metadata.
        } else {
            content = `---\ntitle: ${titleValue}\ntags: [dailynote]\n---\n\n${content}`;
        }

        try {
            const created = await this.plugin.app.vault.create(normalizedPath, content);

            // Run Templater explicitly so <% tp.* %> expressions in the template are evaluated.
            await this.runTemplaterOnFile(created);

            await this.normalizeCreatedDailyNote(created, titleValue, folder, isoDate);
            return created;
        } catch (err) {
            logger.error("Failed creating daily note from template", normalizedPath, err);
            new Notice(`Failed to create daily note: ${normalizedPath}`);
            return null;
        }
    }

    /**
     * Explicitly invoke Templater's "Replace templates in file" on a newly-created
     * file so <% tp.* %> expressions are evaluated in-place.
     * Safe no-op when Templater is not installed.
     *
     * Uses overwrite_file_commands(file, false) — same code path as "Replace templates
     * in the active file" but works on any file object without an active editor view.
     */
    private async runTemplaterOnFile(file: TFile): Promise<void> {
        const templater = (this.plugin.app as any)?.plugins?.plugins?.['templater-obsidian'];
        if (!templater?.templater) return;
        try {
            await templater.templater.overwrite_file_commands(file, false);
            await this.normalizeLeadingWhitespaceBeforeFrontmatter(file);
        } catch (e) {
            logger.warn('[DailyNoteNavManager] Templater failed to process file (non-fatal):', file.path, e);
        }
    }

    private async normalizeCreatedDailyNote(file: TFile, titleValue: string, folder: string, isoDate: string | null = null): Promise<boolean> {
        const targetFolder = String(folder || file.parent?.path || '/').trim() || '/';
        const scheduledValue = isoDate ? getDailyNoteScheduledValueForIsoDate(isoDate) : `${titleValue} 00:00:00`;

        try {
            await this.normalizeLeadingWhitespaceBeforeFrontmatter(file);
            const outcome = await this.plugin.frontmatterMutationService.processGuardedWithOutcome(file, (fm: any) => {
                let mutationNeeded = false;
                if (fm.title !== titleValue) {
                    fm.title = titleValue;
                    mutationNeeded = true;
                }
                const scheduled = String(fm?.scheduled ?? '').trim();
                if (!scheduled || /<%[\s\S]*%>/.test(scheduled) || /\{\{[\s\S]*\}\}/.test(scheduled)) {
                    if (fm.scheduled !== scheduledValue) {
                        fm.scheduled = scheduledValue;
                        mutationNeeded = true;
                    }
                }
                if (this.plugin.settings.autoSaveFolderPath && fm.folderPath !== targetFolder) {
                    fm.folderPath = targetFolder;
                    mutationNeeded = true;
                }
                return mutationNeeded ? true : 'unchanged';
            });
            if (!isFrontmatterMutationReady(outcome)) {
                logger.warn('Daily note normalization stopped because its frontmatter update was not committed', {
                    file: file.path,
                    outcome,
                });
                new Notice(`Daily note ${file.basename} exists, but its required properties could not be saved. Filename and Notebook Navigator rule updates were skipped.`);
                return false;
            }
        } catch (error) {
            logger.warn('Failed normalizing daily note after creation', { file: file.path, error });
            new Notice(`Daily note ${file.basename} exists, but its required properties could not be saved. Filename and Notebook Navigator rule updates were skipped.`);
            return false;
        }

        try {
            await this.plugin.fileNamingService.processFileOnOpen(file, { bypassCreationGrace: true });
        } catch (error) {
            logger.warn('Failed running file naming normalization for daily note', { file: file.path, error });
        }

        try {
            await this.plugin.notebookNavigatorRuleService.applyRulesToFile(file, {
                reason: 'gcm-daily-note-normalize',
                force: true,
                bypassCreationGrace: true,
            });
        } catch (error) {
            logger.warn('Failed applying NN rules to daily note', { file: file.path, error });
        }
        return true;
    }

    private async normalizeLeadingWhitespaceBeforeFrontmatter(file: TFile): Promise<void> {
        await normalizeLeadingFrontmatter(this.plugin.app, file);
    }

    async goToDate(baseIsoDateStr: string | null, offset: number, sourceLeaf?: WorkspaceLeaf | null) {
        try {
            const m = (window as any).moment;
            const targetDate = baseIsoDateStr === null
                ? m().startOf("day")
                : m(baseIsoDateStr, "YYYY-MM-DD").add(offset, "days");

            const { format, folder } = this.getDailyNoteSettings();
            const targetFilename = targetDate.format(format);

            // 1. Construct the canonical path
            let targetPath = folder ? `${folder}/${targetFilename}` : targetFilename;
            if (!targetPath.endsWith(".md")) targetPath += ".md";
            targetPath = normalizePath(targetPath);

            // 2. Exact vault path lookup (correct API — avoids cross-folder collisions)
            let file: TFile | null =
                (this.plugin.app.vault.getAbstractFileByPath(targetPath) as TFile | null) ?? null;

            // 3. Fallback: search all accepted daily-note filename formats.
            if (!(file instanceof TFile)) {
                for (const candidateFormat of this.getDailyNoteDateFormats(format)) {
                    const candidateFilename = targetDate.format(candidateFormat);
                    let candidatePath = folder ? `${folder}/${candidateFilename}` : candidateFilename;
                    if (!candidatePath.endsWith(".md")) candidatePath += ".md";
                    const candidate = this.plugin.app.vault.getAbstractFileByPath(normalizePath(candidatePath));
                    if (candidate instanceof TFile) {
                        file = candidate;
                        break;
                    }
                }
            }

            // 4. Fallback: search by filename only (handles files moved out of configured folder)
            if (!(file instanceof TFile)) {
                for (const candidateFormat of this.getDailyNoteDateFormats(format)) {
                    const justName = targetDate.format(candidateFormat) + ".md";
                    const found = this.plugin.app.metadataCache.getFirstLinkpathDest(justName, folder || "");
                    if (found instanceof TFile) {
                        file = found;
                        break;
                    }
                }
            }

            if (!(file instanceof TFile)) {
                const shouldCreate = await this.confirmCreateDailyNote(targetFilename, targetPath);
                if (!shouldCreate) return;
                file = await this.ensureDailyNoteExists(targetPath, targetFilename, targetDate);
                if (!(file instanceof TFile)) return;
            }

            if (file instanceof TFile) {
                const targetLeaf = sourceLeaf ?? this.getTargetLeaf()?.leaf ?? this._currentLeaf;
                const opened = await this.plugin.openFileInLeaf(
                    file,
                    false,
                    () => targetLeaf ?? this.plugin.app.workspace.getLeaf(false),
                    { revealLeaf: true, active: true, reuseLeafIfNoExisting: true },
                );
                if (!opened) return;
            }
        } catch (err) {
            logger.error("goToDate failed", err);
            new Notice("Failed to navigate to daily note.");
        }
    }

    private async confirmCreateDailyNote(title: string, path: string): Promise<boolean> {
        return await new Promise<boolean>((resolve) => {
            new CreateDailyNoteConfirmModal(this.plugin.app, title, path, resolve).open();
        });
    }
}

class CreateDailyNoteConfirmModal extends Modal {
    private resolved = false;

    constructor(
        app: App,
        private readonly titleValue: string,
        private readonly path: string,
        private readonly resolve: (value: boolean) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        this.modalEl.addClass("mod-tps-gcm");
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "Create daily note?" });
        contentEl.createEl("p", {
            text: `"${this.titleValue}" does not exist yet. Create it now?`,
        });
        const pathEl = contentEl.createEl("p", { text: this.path });
        pathEl.style.color = "var(--text-muted)";
        pathEl.style.fontSize = "0.9em";

        const actions = contentEl.createDiv();
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.justifyContent = "flex-end";
        actions.style.marginTop = "16px";

        const cancelButton = actions.createEl("button", { text: "Cancel" });
        cancelButton.addEventListener("click", () => this.finish(false, true));

        const createButton = actions.createEl("button", { text: "Create" });
        createButton.addClass("mod-cta");
        createButton.addEventListener("click", () => this.finish(true, true));
    }

    onClose(): void {
        this.contentEl.empty();
        this.finish(false, false);
    }

    private finish(value: boolean, close: boolean): void {
        if (this.resolved) return;
        this.resolved = true;
        this.resolve(value);
        if (close) this.close();
    }
}
