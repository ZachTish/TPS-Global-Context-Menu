import { normalizePath, TFile } from 'obsidian';
import TPSGlobalContextMenuPlugin from '../main';
import * as logger from "../logger";
import { extractDatePrefix, extractDateSuffix, stripDatePrefix, stripDateSuffix, FULL_DATE_REGEX } from '../utils/date-suffix-utils';
import {
    clearDailyNoteConfigurationOverride,
    hasExplicitDailyNoteIdentity,
    hasPendingDailyNoteCandidatePathRefresh,
    invalidateDailyNoteCandidateIndex,
    markDailyNoteCandidateMetadataReady,
    markDailyNoteCandidatePathDirty,
    parseDailyNoteFileDate,
    refreshPendingDailyNoteCandidatePaths,
    registerDailyNoteConfigurationOverride,
} from '../utils/daily-note-task-schedule';
import {
    canAutomaticallyMutateTemplateFile,
    canAutomaticallyMutateTemplateFrontmatter,
} from '../utils/template-protection';

export type DailyNoteConfigurationSnapshot = {
    folder: string;
    format: string;
    template: string;
    source: 'core' | 'persisted-recovery' | 'periodic' | 'persisted' | 'default';
};

/**
 * Handles automatic file naming based on title and scheduled date
 */
export class FileNamingService {
    plugin: TPSGlobalContextMenuPlugin;
    private processingFiles: Set<string> = new Set();
    private inferredDailyNoteFormat: string | null = null;
    private knownDailyNoteConfigurations = new Map<string, { folder: string; format: string }>();
    private persistedDailyNoteConfiguration: Record<string, unknown> | null = null;
    private dailyNoteConfigurationSnapshot: DailyNoteConfigurationSnapshot | null = null;
    private persistedRecoveryRuntimeSignature: string | null = null;
    private dailyNoteConfigurationReady: Promise<void>;
    private dailyNoteConfigurationLoaded = false;
    private dailyNoteMetadataReady = false;
    private dailyNoteMetadataRefreshPending = false;
    private dailyNoteMetadataRefreshEpoch = 0;
    private dailyNoteMetadataReadyNotificationPending = false;
    private dailyNoteMetadataGlobalResolutionObserved = false;

    constructor(plugin: TPSGlobalContextMenuPlugin, metadataResolved = false) {
        this.plugin = plugin;
        // The public `resolved` event may arrive during onload's settings await,
        // before this constructor. A captured observation, or the authoritative
        // initialized flag on warm reload, seeds the same readiness proof.
        this.dailyNoteMetadataGlobalResolutionObserved = metadataResolved ||
            (this.plugin.app as any)?.metadataCache?.initialized === true;
        this.registerDailyNoteIndexInvalidation();
        this.dailyNoteConfigurationReady = this.loadPersistedDailyNoteConfiguration()
            .finally(() => {
                this.dailyNoteConfigurationLoaded = true;
            });
    }

    public isDailyNoteConfigurationReady(): boolean {
        return this.dailyNoteConfigurationLoaded;
    }

    public async whenDailyNoteConfigurationReady(): Promise<void> {
        await this.dailyNoteConfigurationReady;
    }

    public isDailyNoteMetadataCacheReady(): boolean {
        const metadataCache = (this.plugin.app as any)?.metadataCache;
        if (metadataCache?.initialized === false) {
            // A full metadata rebuild invalidates any resolution observed by a
            // prior generation. Wait for the next global `resolved` event.
            this.dailyNoteMetadataGlobalResolutionObserved = false;
            this.dailyNoteMetadataReady = false;
        }
        if (
            this.dailyNoteMetadataRefreshPending
            || metadataCache?.initialized === false
            || hasPendingDailyNoteCandidatePathRefresh(this.plugin.app)
        ) {
            // A provider consumer has now observed the API's temporary
            // cold-index state. Arm one readiness reannouncement so that the
            // first metadata completion which makes identity readable causes
            // that consumer to retry without polling or reloading the plugin.
            this.dailyNoteMetadataReadyNotificationPending = true;
            return false;
        }
        if (this.dailyNoteMetadataReady) return true;
        if (this.dailyNoteMetadataGlobalResolutionObserved) {
            this.dailyNoteMetadataReady = true;
            return true;
        }
        // Per-file startup callbacks can arrive after initialized changes but
        // before global resolution. The public resolved event owns readiness;
        // rescanning every file on each callback makes startup quadratic.
        this.dailyNoteMetadataReadyNotificationPending = true;
        return false;
    }

    public getDailyNoteConfigurationSnapshot(): DailyNoteConfigurationSnapshot | null {
        if (!this.dailyNoteConfigurationLoaded) return null;
        return { ...this.refreshDailyNoteConfigurationSnapshot() };
    }

    private registerDailyNoteIndexInvalidation(): void {
        const registerEvent = (this.plugin as any)?.registerEvent;
        if (typeof registerEvent !== 'function') return;
        for (const event of ['create', 'modify', 'delete', 'rename']) {
            const ref = (this.plugin.app.vault as any)?.on?.(event, (file: unknown, oldPath?: string) => {
                // Obsidian announces every existing file as created while loading.
                // Startup metadata owns that initial identity; only real creates
                // need the current-source refresh used for subsequent mutations.
                if (event === 'create' && this.plugin.app.workspace?.layoutReady === false) return;
                // The candidate index contains only Markdown files. A changed
                // Markdown path is checked after its current source is read.
                if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') return;
                if (event === 'delete') {
                    markDailyNoteCandidateMetadataReady(this.plugin.app, file, this.plugin.settings);
                } else {
                    if (event === 'rename' && oldPath) {
                        markDailyNoteCandidateMetadataReady(this.plugin.app, oldPath, this.plugin.settings);
                    }
                    markDailyNoteCandidatePathDirty(this.plugin.app, file);
                    // Only an identity consumer that observes blocked readiness
                    // needs an API reannouncement when this generation settles.
                }
                this.dailyNoteMetadataReady = false;
                if (event !== 'delete') this.dailyNoteMetadataRefreshPending = true;
            });
            if (ref) registerEvent.call(this.plugin, ref);
        }
        for (const event of ['changed', 'deleted', 'resolve', 'resolved']) {
            const ref = (this.plugin.app.metadataCache as any)?.on?.(event, async (file?: unknown) => {
                const refreshEpoch = ++this.dailyNoteMetadataRefreshEpoch;
                if ((this.plugin.app.metadataCache as any)?.initialized === false) {
                    // A whole-cache rebuild revokes the previous global proof
                    // even if no API consumer queries readiness during it.
                    this.dailyNoteMetadataGlobalResolutionObserved = false;
                    this.dailyNoteMetadataReady = false;
                }
                const firstGlobalResolution = event === 'resolved'
                    && !this.dailyNoteMetadataGlobalResolutionObserved;
                if (event === 'resolved') {
                    // Public MetadataCache contract: every file has completed
                    // resolution. Some empty files still intentionally have
                    // no CachedMetadata entry, so this event is stronger than
                    // scanning getFileCache() for universal non-null values.
                    // Later `resolved` events also follow ordinary file edits;
                    // those paths were already handled by per-file callbacks.
                    this.dailyNoteMetadataGlobalResolutionObserved = true;
                }
                if (file instanceof TFile) {
                    markDailyNoteCandidateMetadataReady(this.plugin.app, file, this.plugin.settings);
                } else if (firstGlobalResolution) {
                    markDailyNoteCandidateMetadataReady(this.plugin.app);
                } else if (event !== 'resolved') {
                    invalidateDailyNoteCandidateIndex(this.plugin.app);
                }
                this.dailyNoteMetadataReady = false;
                await refreshPendingDailyNoteCandidatePaths(
                    this.plugin.app,
                    this.plugin.settings,
                );
                // The refresh result itself may be an older failed read while
                // another owner (or mutation reconciliation) already drained
                // the same generation. Current dirty state is authoritative.
                const dirtyPathsReady = !hasPendingDailyNoteCandidatePathRefresh(this.plugin.app);
                if (dirtyPathsReady) {
                    // Any completion can prove readiness after draining the
                    // live generation, even if a newer callback failed first.
                    this.dailyNoteMetadataRefreshPending = false;
                    const identityReady = this.isDailyNoteMetadataCacheReady();
                    if (identityReady && this.dailyNoteMetadataReadyNotificationPending) {
                        this.dailyNoteMetadataReadyNotificationPending = false;
                        // Consumers cache provider readiness. Re-announce the
                        // same API once current-byte identity is observable.
                        (this.plugin as any).emitGcmApiChanged?.(true);
                    }
                } else if (refreshEpoch === this.dailyNoteMetadataRefreshEpoch) {
                    // Only the latest still-dirty callback may publish a
                    // blocked state; an older failure cannot re-block a newer
                    // in-flight/successful generation.
                    this.dailyNoteMetadataRefreshPending = true;
                }
            });
            if (ref) registerEvent.call(this.plugin, ref);
        }
    }

    private static readonly TEMPLATE_TITLE_MARKERS: RegExp[] = [
        /<%[\s\S]*%>/i,
        /\{\{[\s\S]*\}\}/i,
        /\btp\.[a-z0-9_]+\b/i,
        /\btemplater\b/i,
    ];

    public getDailyNoteDateFormat(): string {
        if (this.dailyNoteConfigurationLoaded) {
            return this.refreshDailyNoteConfigurationSnapshot().format;
        }
        const dailyNotesFormat = String(this.getCoreDailyNoteOptions()?.format || '').trim();
        if (dailyNotesFormat) return dailyNotesFormat;
        const configured = String((this.plugin as any)?.settings?.dailyNoteDateFormat || '').trim();
        if (configured) return configured;
        if (!this.inferredDailyNoteFormat) {
            const hasPrettyDaily = this.plugin.app.vault.getFiles().some((file) =>
                /\/Notes\/[A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2}(st|nd|rd|th)\s+\d{4}\.md$/.test(file.path),
            );
            this.inferredDailyNoteFormat = hasPrettyDaily ? 'dddd, MMMM Do YYYY' : 'YYYY-MM-DD';
        }
        return this.inferredDailyNoteFormat;
    }

    public isDateOnlyBasename(value: string): boolean {
        const basename = String(value || '').trim();
        if (!basename) return false;
        if (FULL_DATE_REGEX.test(basename)) return true;
        const preferred = this.getDailyNoteDateFormat();
        const parsed = window.moment(basename, this.getDailyNoteParseFormats(preferred), true);
        return !!parsed?.isValid?.() && parsed.isValid();
    }

    private getCoreDailyNoteOptions(): Record<string, unknown> | null {
        const internalPlugins = (this.plugin.app as any)?.internalPlugins;
        const dailyNotes = internalPlugins?.getPluginById?.('daily-notes')
            ?? internalPlugins?.plugins?.['daily-notes'];
        if (dailyNotes?.enabled === false) return null;
        const options = dailyNotes?.instance?.options;
        return options && typeof options === 'object'
            ? options as Record<string, unknown>
            : null;
    }

    public registerDailyNoteConfiguration(folder: unknown, format: unknown): void {
        const normalizedFolder = normalizePath(String(folder || '').trim()).replace(/^\/+|\/+$/g, '');
        const normalizedFormat = String(format || '').trim() || 'YYYY-MM-DD';
        this.knownDailyNoteConfigurations.clear();
        this.knownDailyNoteConfigurations.set(
            `${normalizedFolder}\u0000${normalizedFormat}`,
            { folder: normalizedFolder, format: normalizedFormat },
        );
    }

    private getPeriodicDailyNoteOptions(): Record<string, unknown> | null {
        const periodic = (this.plugin.app as any)?.plugins?.getPlugin?.('periodic-notes')
            ?? (this.plugin.app as any)?.plugins?.plugins?.['periodic-notes'];
        const options = periodic?.settings?.daily;
        return options && typeof options === 'object'
            ? options as Record<string, unknown>
            : null;
    }

    private async loadPersistedDailyNoteConfiguration(): Promise<void> {
        const coreBeforeRead = this.getCoreDailyNoteOptions();
        const runtimeSignatureBeforeRead = coreBeforeRead
            ? this.getCoreDailyNoteRuntimeSignature(coreBeforeRead)
            : null;
        try {
            const configDir = String((this.plugin.app.vault as any)?.configDir || '.obsidian').trim() || '.obsidian';
            const raw = await this.plugin.app.vault.adapter.read(normalizePath(`${configDir}/daily-notes.json`));
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                this.persistedDailyNoteConfiguration = parsed as Record<string, unknown>;
            }
        } catch {
            // Core Daily Notes may be disabled or may not have written settings yet.
        }
        const core = this.getCoreDailyNoteOptions();
        const persistedTemplate = String(this.persistedDailyNoteConfiguration?.template || '').trim();
        const runtimeSignatureAfterRead = core ? this.getCoreDailyNoteRuntimeSignature(core) : null;
        const runtimeFolder = normalizePath(String(core?.folder || '').trim()).replace(/^\/+|\/+$/g, '');
        const runtimeFormat = String(core?.format || '').trim() || 'YYYY-MM-DD';
        const runtimeTemplate = String(core?.template || '').trim();
        const persistedHasPathConfiguration = Boolean(
            this.persistedDailyNoteConfiguration
            && (
                typeof this.persistedDailyNoteConfiguration.folder === 'string'
                || typeof this.persistedDailyNoteConfiguration.format === 'string'
            ),
        );
        const coreHasExactStartupPlaceholder =
            runtimeFolder === ''
            && runtimeFormat === 'YYYY-MM-DD'
            && runtimeTemplate === '';
        if (
            core
            && !runtimeTemplate
            && (persistedTemplate || (persistedHasPathConfiguration && coreHasExactStartupPlaceholder))
            && runtimeSignatureBeforeRead === runtimeSignatureAfterRead
        ) {
            // Recovery is bound to the exact incomplete startup snapshot.
            // Core's root/YYYY-MM-DD/blank placeholder must recover a saved
            // folder and format even when the user intentionally has no Daily
            // Notes template. Once Core publishes any different signature, a
            // later blank template is intentional live state and must not
            // resurrect persisted data.
            this.persistedRecoveryRuntimeSignature = runtimeSignatureAfterRead;
        }
        this.refreshDailyNoteConfigurationSnapshot();
    }

    private getCoreDailyNoteRuntimeSignature(options: Record<string, unknown>): string {
        return [
            normalizePath(String(options.folder || '').trim()).replace(/^\/+|\/+$/g, ''),
            String(options.format || '').trim(),
            String(options.template || '').trim(),
        ].join('\u0000');
    }

    private refreshDailyNoteConfigurationSnapshot(): DailyNoteConfigurationSnapshot {
        const normalizeFolder = (value: unknown) => normalizePath(String(value || '').trim()).replace(/^\/+|\/+$/g, '');
        const normalizeFormat = (value: unknown) => String(value || '').trim() || 'YYYY-MM-DD';
        const core = this.getCoreDailyNoteOptions();
        const persisted = this.persistedDailyNoteConfiguration;
        const periodic = core ? null : this.getPeriodicDailyNoteOptions();
        const runtimeTemplate = String(core?.template || '').trim();
        const persistedTemplate = String(persisted?.template || '').trim();
        const runtimeSignature = core ? this.getCoreDailyNoteRuntimeSignature(core) : null;
        const recoverPersistedStartupSnapshot = Boolean(
            core
            && this.persistedRecoveryRuntimeSignature
            && runtimeSignature === this.persistedRecoveryRuntimeSignature,
        );
        if (core && this.persistedRecoveryRuntimeSignature && runtimeSignature !== this.persistedRecoveryRuntimeSignature) {
            this.persistedRecoveryRuntimeSignature = null;
        }

        let snapshot: DailyNoteConfigurationSnapshot;
        if (recoverPersistedStartupSnapshot) {
            snapshot = {
                folder: normalizeFolder(persisted?.folder),
                format: normalizeFormat(persisted?.format),
                template: persistedTemplate,
                source: 'persisted-recovery',
            };
        } else if (core) {
            snapshot = {
                folder: normalizeFolder(core.folder),
                format: normalizeFormat(core.format),
                template: runtimeTemplate,
                source: 'core',
            };
        } else if (periodic) {
            snapshot = {
                folder: normalizeFolder(periodic.folder),
                format: normalizeFormat(periodic.format),
                template: String(periodic.template || '').trim(),
                source: 'periodic',
            };
        } else if (persisted) {
            snapshot = {
                folder: normalizeFolder(persisted.folder),
                format: normalizeFormat(persisted.format),
                template: persistedTemplate,
                source: 'persisted',
            };
        } else {
            snapshot = {
                folder: 'System/Dailynotes',
                format: String((this.plugin as any)?.settings?.dailyNoteDateFormat || '').trim() || 'YYYY-MM-DD',
                template: '',
                source: 'default',
            };
        }

        if (snapshot.source === 'core') {
            clearDailyNoteConfigurationOverride(this.plugin.app);
        } else if (!registerDailyNoteConfigurationOverride(this.plugin.app, snapshot.folder, snapshot.format)) {
            // A settled Core runtime deliberately refused a stale startup
            // override. Commit that live Core snapshot locally too; never
            // return a split persisted view to creation while lookup uses Core.
            const liveCore = this.getCoreDailyNoteOptions();
            if (liveCore) {
                this.persistedRecoveryRuntimeSignature = null;
                snapshot = {
                    folder: normalizeFolder(liveCore.folder),
                    format: normalizeFormat(liveCore.format),
                    template: String(liveCore.template || '').trim(),
                    source: 'core',
                };
                clearDailyNoteConfigurationOverride(this.plugin.app);
            }
        }
        const previous = this.dailyNoteConfigurationSnapshot;
        const changed = !previous
            || previous.folder !== snapshot.folder
            || previous.format !== snapshot.format
            || previous.template !== snapshot.template
            || previous.source !== snapshot.source;
        this.dailyNoteConfigurationSnapshot = snapshot;
        this.registerDailyNoteConfiguration(snapshot.folder, snapshot.format);
        if (changed) invalidateDailyNoteCandidateIndex(this.plugin.app);
        return snapshot;
    }

    public async isDailyNoteFile(file: TFile): Promise<boolean> {
        await this.dailyNoteConfigurationReady;
        this.refreshDailyNoteConfigurationSnapshot();
        return parseDailyNoteFileDate(this.plugin.app, this.plugin.settings, file) !== null;
    }

    private isProcessRunFrontmatter(frontmatter: Record<string, unknown> | undefined | null): boolean {
        if (!frontmatter) return false;
        const runKind = this.getFrontmatterStringValueCaseInsensitive(frontmatter, 'runKind').toLowerCase();
        const workflowKind = this.getFrontmatterStringValueCaseInsensitive(frontmatter, 'workflowKind').toLowerCase();
        const kind = this.getFrontmatterStringValueCaseInsensitive(frontmatter, 'kind').toLowerCase();
        const runType = this.getFrontmatterStringValueCaseInsensitive(frontmatter, 'runType').toLowerCase();
        const workflowType = this.getFrontmatterStringValueCaseInsensitive(frontmatter, 'workflowType').toLowerCase();
        return runKind === 'run'
            || workflowKind === 'workflow'
            || kind === 'workout'
            || kind === 'workout-plan'
            || kind === 'workout-session'
            || kind === 'workout-exercise'
            || Boolean(runType)
            || Boolean(workflowType);
    }

    private normalizeFrontmatterStringList(value: unknown): string[] {
        const source = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
        return source
            .flatMap((item) => Array.isArray(item) ? item : [item])
            .map((item) => String(item ?? '').trim())
            .filter(Boolean);
    }

    private addMeaningfulAliases(frontmatter: Record<string, any>, candidates: string[], canonicalTitle: string): void {
        const canonical = this.normalizeAliasForCompare(canonicalTitle);
        const nextAliases = this.normalizeFrontmatterStringList((frontmatter as any).aliases ?? (frontmatter as any).alias);
        const seen = new Set(nextAliases.map((value) => this.normalizeAliasForCompare(value)).filter(Boolean));

        for (const candidate of candidates) {
            const alias = String(candidate || '').replace(/\s+/g, ' ').trim();
            const normalized = this.normalizeAliasForCompare(alias);
            if (!alias || !normalized || normalized === canonical || seen.has(normalized)) continue;
            if (FileNamingService.TEMPLATE_TITLE_MARKERS.some((marker) => marker.test(alias))) continue;
            nextAliases.push(alias);
            seen.add(normalized);
        }

        if (nextAliases.length === 0) return;
        const aliasKeys = Object.keys(frontmatter).filter((key) => {
            const normalized = key.trim().toLowerCase();
            return normalized === 'alias' || normalized === 'aliases';
        });
        const targetKey = aliasKeys.find((key) => key.trim().toLowerCase() === 'aliases') || aliasKeys[0] || 'aliases';
        frontmatter[targetKey] = nextAliases;
        for (const key of aliasKeys) {
            if (key !== targetKey) delete frontmatter[key];
        }
    }

    private normalizeAliasForCompare(value: string): string {
        return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    private getDailyNoteParseFormats(preferred = this.getDailyNoteDateFormat()): string[] {
        return [
            preferred,
            "YYYY-MM-DD",
            "YYYY_MM_DD",
            "YYYYMMDD",
            "ddd, MMM D YYYY",
            "dddd, MMMM D YYYY",
            "dddd, MMMM Do YYYY",
            "MMMM D, YYYY",
            "MMM D, YYYY",
        ].filter((format, index, all) => !!format && all.indexOf(format) === index);
    }

    private parseDailyNoteBasenameToIso(basename: string): string | null {
        const raw = String(basename || '').trim();
        if (!raw) return null;
        const parsed = window.moment(raw, this.getDailyNoteParseFormats(), true);
        return parsed?.isValid?.() && parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
    }

    private parseScheduledToIso(value: unknown): string | null {
        const raw = String(value ?? '').trim();
        if (!raw || FileNamingService.TEMPLATE_TITLE_MARKERS.some((marker) => marker.test(raw))) return null;
        const parsed = window.moment(raw, [
            window.moment.ISO_8601,
            ...this.getDailyNoteParseFormats(),
            "YYYY-MM-DD HH:mm",
            "YYYY-MM-DDTHH:mm:ss",
            "YYYY-MM-DDTHH:mm",
            "YYYY/MM/DD",
        ], true);
        return parsed?.isValid?.() && parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
    }

    private async repairDailyNoteScheduled(file: TFile): Promise<boolean> {
        if (!(await this.isDailyNoteFile(file))) return false;
        const expectedDate = this.parseDailyNoteBasenameToIso(file.basename);
        if (!expectedDate) return false;
        const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        if (this.isProcessRunFrontmatter(frontmatter)) return false;
        const expectedScheduled = `${expectedDate} 00:00:00`;
        if (String(frontmatter?.scheduled ?? '').trim() === expectedScheduled) return false;
        if (!(await this.canAutomaticallyMutateTemplateSource(file))) return false;
        if (!(await this.plugin.bulkEditService.canMutateFrontmatterSafely(file))) return false;

        let changed = false;
        await this.plugin.bulkEditService.runSerializedFrontmatterWrite(file, async () => {
            await this.plugin.frontmatterMutationService.process(file, (frontmatter) => {
                if (!this.canAutomaticallyMutateTemplateFrontmatter(frontmatter)) return;
                const currentRaw = String(frontmatter.scheduled ?? '').trim();
                const currentIso = this.parseScheduledToIso(currentRaw);
                if (currentIso === expectedDate && currentRaw === expectedScheduled) return;
                frontmatter.scheduled = expectedScheduled;
                changed = true;
            });
        });
        return changed;
    }

    private titleMatchesScheduledDate(title: string, scheduledDate: any): boolean {
        const normalizedTitle = String(title || '').replace(/\s+/g, ' ').trim();
        if (!normalizedTitle) return false;
        if (!scheduledDate || !scheduledDate.isValid || !scheduledDate.isValid()) return false;

        const preferredFormat = this.getDailyNoteDateFormat();
        const expectedIso = scheduledDate.format('YYYY-MM-DD');
        const expectedPreferred = scheduledDate.format(preferredFormat);

        const lowered = normalizedTitle.toLowerCase();
        if (lowered === expectedIso.toLowerCase() || lowered === expectedPreferred.toLowerCase()) return true;
        if (lowered.includes(expectedIso.toLowerCase()) || lowered.includes(expectedPreferred.toLowerCase())) return true;

        const parsed = window.moment(
            normalizedTitle,
            [preferredFormat, "YYYY-MM-DD", "dddd, MMMM Do YYYY", "MMMM D, YYYY", "MMM D, YYYY"],
            true,
        );
        return !!parsed?.isValid?.() && parsed.isValid() && parsed.format('YYYY-MM-DD') === expectedIso;
    }

    private stripKnownDateMarker(value: string, scheduledDate: any): string {
        let stripped = stripDatePrefix(stripDateSuffix(String(value || ''))).replace(/\s+/g, ' ').trim();
        if (!scheduledDate || !scheduledDate.isValid || !scheduledDate.isValid()) return stripped;

        const candidates = [
            scheduledDate.format('YYYY-MM-DD'),
            scheduledDate.format(this.getDailyNoteDateFormat()),
            scheduledDate.format('YYYY_MM_DD'),
            scheduledDate.format('YYYYMMDD'),
            scheduledDate.format('ddd, MMM D YYYY h.mma'),
            scheduledDate.format('ddd, MMM D YYYY h:mma'),
            scheduledDate.format('ddd, MMM D YYYY'),
            scheduledDate.format('ddd, MMM D'),
            scheduledDate.format('MMM D YYYY h.mma'),
            scheduledDate.format('MMM D YYYY h:mma'),
            scheduledDate.format('MMM D YYYY'),
        ].map((v) => String(v || '').trim()).filter(Boolean);

        for (const suffix of candidates) {
            const lowered = stripped.toLowerCase();
            const target = ` ${suffix.toLowerCase()}`;
            if (lowered.endsWith(target)) {
                stripped = stripped.slice(0, stripped.length - target.length).trim();
            }
        }

        for (const prefix of candidates) {
            const lowered = stripped.toLowerCase();
            const target = `${prefix.toLowerCase()} `;
            if (lowered.startsWith(target)) {
                stripped = stripped.slice(target.length).trim();
            }
        }

        return stripped;
    }

    private hasKnownScheduledDateMarker(value: string, scheduledDate: any): boolean {
        const normalized = String(value || '').replace(/\s+/g, ' ').trim();
        if (!normalized) return false;
        return this.stripKnownDateMarker(normalized, scheduledDate) !== normalized;
    }

    async repairTemplateDerivedTitlesAcrossVault(): Promise<{ scanned: number; updated: number; skipped: number; failed: number }> {
        const files = this.plugin.app.vault.getMarkdownFiles().filter((file) => this.shouldProcess(file));
        let scanned = 0;
        let updated = 0;
        let skipped = 0;
        let failed = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            scanned += 1;

            try {
                const result = await this.syncTitleFromFilenameWithOptions(file, {
                    onlyIfTemplateDerived: true,
                    force: true,
                });
                if (result === "updated") updated += 1;
                else skipped += 1;
            } catch {
                failed += 1;
            }

            if ((i + 1) % 50 === 0) {
                await this.yieldToEventLoop();
            }
        }

        return { scanned, updated, skipped, failed };
    }

    async repairMissingTitlesAcrossVault(): Promise<{ scanned: number; updated: number; skipped: number; failed: number }> {
        const files = this.plugin.app.vault.getMarkdownFiles().filter((file) => this.shouldProcess(file, { bypassCreationGrace: true }));
        let scanned = 0;
        let updated = 0;
        let skipped = 0;
        let failed = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            scanned += 1;

            try {
                const result = await this.syncTitleFromFilenameWithOptions(file, {
                    onlyIfMissing: true,
                    force: true,
                    bypassCreationGrace: true,
                });
                if (result === "updated") updated += 1;
                else skipped += 1;
            } catch {
                failed += 1;
            }

            if ((i + 1) % 50 === 0) {
                await this.yieldToEventLoop();
            }
        }

        return { scanned, updated, skipped, failed };
    }

    private async syncTitleFromFilenameWithOptions(
        file: TFile,
        options: { onlyIfTemplateDerived?: boolean; onlyIfMissing?: boolean; onlyIfHasFrontmatter?: boolean; force?: boolean; bypassCreationGrace?: boolean },
    ): Promise<"updated" | "skipped"> {
        await this.dailyNoteConfigurationReady;
        if (!this.shouldProcess(file, options)) return "skipped";
        const liveFile = this.getLiveFile(file);
        if (!liveFile || !this.shouldProcess(liveFile, options)) return "skipped";
        if (this.shouldSkipAutoFrontmatterWrite(liveFile)) return "skipped";
        const lockKey = liveFile.path;

        // Prevent recursion / duplicate work during vault operations
        if (this.processingFiles.has(lockKey)) return "skipped";
        this.processingFiles.add(lockKey);

        try {
            const cache = this.plugin.app.metadataCache.getFileCache(liveFile);
            const fm = cache?.frontmatter || {};
            const persistedValues = await this.getPersistedFrontmatterStringValues(liveFile, ['title', 'scheduled']);
            const hasPersistedFrontmatter = await this.hasPersistedFrontmatterBlock(liveFile);
            if (options.onlyIfHasFrontmatter && !hasPersistedFrontmatter) return "skipped";
            const scheduled = hasPersistedFrontmatter
                ? (persistedValues.has('scheduled') ? persistedValues.get('scheduled') : '')
                : fm.scheduled;

            const rawBasename = (liveFile.basename || '').trim();
            if (!rawBasename) return "skipped";

            // Only the unified identity classifier can grant the Daily Note
            // exception. A root date-only project/calendar/food record remains
            // an ordinary note when Core owns a different folder.
            if (await this.isDailyNoteFile(liveFile)) return "skipped";
            if (await this.plugin.bulkEditService.shouldSkipNoteLevelRecurrence(liveFile, scheduled)) return "skipped";

            const scheduledDate = scheduled ? window.moment(scheduled) : null;
            let nextTitle = scheduledDate?.isValid?.()
                ? this.stripKnownDateMarker(rawBasename, scheduledDate)
                : stripDatePrefix(stripDateSuffix(rawBasename));

            // Keep title canonical whether the scheduled date is stored as the old
            // suffix shape or the new sortable prefix shape.
            const suffix = extractDateSuffix(nextTitle);
            const prefix = extractDatePrefix(nextTitle);
            const extractedDate = suffix.dateStr ? suffix : prefix;
            if (extractedDate.dateStr) {

                if (scheduledDate) {
                    const markerDate = window.moment(extractedDate.dateStr, this.getDailyNoteParseFormats(), true);
                    if (scheduledDate.isValid() && markerDate.isValid()) {
                        const scheduledStr = scheduledDate.format('YYYY-MM-DD');
                        if (scheduledStr === markerDate.format('YYYY-MM-DD')) {
                            nextTitle = extractedDate.base;
                        }
                    } else {
                        nextTitle = extractedDate.base;
                    }
                } else {
                    nextTitle = extractedDate.base;
                }
            }

            nextTitle = nextTitle.replace(/\s+/g, ' ').trim();
            const currentTitle = (
                persistedValues.get('title')
                ?? this.getFrontmatterStringValueCaseInsensitive(fm, 'title')
            ).trim();
            if (!currentTitle && await this.isBlankGeneratedUntitledNote(liveFile, rawBasename)) return "skipped";
            const templateDerivedTitle = this.isTemplateDerivedTitle(currentTitle);
            if (options.onlyIfMissing && currentTitle && !templateDerivedTitle) {
                return "skipped";
            }
            const shouldNormalizeScheduledDateTitle = !!scheduledDate?.isValid?.()
                && this.hasKnownScheduledDateMarker(rawBasename, scheduledDate)
                && this.hasKnownScheduledDateMarker(currentTitle, scheduledDate);
            if (options.onlyIfTemplateDerived && !templateDerivedTitle && !shouldNormalizeScheduledDateTitle) {
                return "skipped";
            }

            if (nextTitle && nextTitle !== currentTitle) {
                const targetFile = this.getLiveFile(liveFile);
                if (!targetFile) return "skipped";
                if (!(await this.plugin.bulkEditService.canMutateFrontmatterSafely(targetFile))) {
                    logger.warn(`[TPS GCM] Skipping title sync due to malformed frontmatter: ${targetFile.path}`);
                    return "skipped";
                }
                let changed = false;
                await this.plugin.bulkEditService.runSerializedFrontmatterWrite(targetFile, async () => {
                    const currentFile = this.getLiveFile(targetFile);
                    if (!currentFile) return;
                    if (!(await this.canAutomaticallyMutateTemplateSource(currentFile))) return;
                    if (await this.hasWorkflowOwnedFilenameEvidence(currentFile)) return;
                    changed = await this.plugin.frontmatterMutationService.processOwnedKeysPreservingSource(currentFile, ['title', 'alias', 'aliases'], (frontmatter) => {
                        if (!this.canAutomaticallyMutateTemplateFrontmatter(frontmatter)) return;
                        if (currentFile.path !== lockKey || currentFile.basename.trim() !== rawBasename) return;
                        if (this.plugin.nativeRecordService?.hasRecordIdentityEvidenceInFrontmatter(frontmatter)
                            || this.isProcessRunFrontmatter(frontmatter)) return;
                        const existingTitleKeys = Object.keys(frontmatter).filter(
                            (key) => key.trim().toLowerCase() === 'title',
                        );
                        // Cached eligibility only avoids unnecessary work. The
                        // current title owns this decision after queueing, too.
                        const latestTitle = this.getFrontmatterStringValueCaseInsensitive(frontmatter, 'title').trim();
                        const templateDerivedTitle = this.isTemplateDerivedTitle(latestTitle);
                        if (options.onlyIfMissing && latestTitle && !templateDerivedTitle) return;
                        if (options.onlyIfTemplateDerived && !templateDerivedTitle) {
                            const scheduled = this.getFrontmatterStringValueCaseInsensitive(frontmatter, 'scheduled');
                            const scheduledDate = scheduled ? window.moment(scheduled) : null;
                            if (!scheduledDate?.isValid?.()
                                || !this.hasKnownScheduledDateMarker(rawBasename, scheduledDate)
                                || !this.hasKnownScheduledDateMarker(latestTitle, scheduledDate)) return;
                        }
                        if (existingTitleKeys.length === 0) {
                            frontmatter.title = nextTitle;
                        } else {
                            frontmatter[existingTitleKeys[0]] = nextTitle;
                            for (let i = 1; i < existingTitleKeys.length; i++) {
                                delete frontmatter[existingTitleKeys[i]];
                            }
                        }
                        this.addMeaningfulAliases(frontmatter, [latestTitle, rawBasename], nextTitle);
                    }, { kind: 'automation', surface: 'file-title-sync' });
                });
                return changed ? "updated" : "skipped";
            }
            return "skipped";
        } catch (error) {
            if (this.isLikelyMissingFileError(error)) return "skipped";
            if (this.isDuplicateYamlKeyError(error)) return "skipped";
            logger.error('[TPS GCM] Error syncing title from filename:', error);
            return "skipped";
        } finally {
            this.processingFiles.delete(lockKey);
        }
        return "skipped";
    }

    /**
     * Check if a file should be processed for auto-naming
     */
    shouldProcess(file: TFile, options: { bypassCreationGrace?: boolean; bypassProcessingLock?: boolean } = {}): boolean {
        if (this.plugin.propertyMigrationService?.active) return false;
        // Only process markdown files
        if (file.extension !== 'md') return false;
        // Companion property notes are storage records for non-Markdown files,
        // not ordinary notes. Never add titles/timestamps or rename them.
        if (this.plugin.filePropertiesService?.isCompanionFile(file)) return false;
        // Native-record filenames are owned by their creating workflow (or by
        // the user). Keep generic note auto-naming out of that contract.
        if (this.plugin.nativeRecordService?.isRecordFile(file)) return false;

        // Metadata cache is only a fast rejection. Every automatic mutation
        // path also rechecks current bytes at its write/rename boundary.
        const cachedFrontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!this.canAutomaticallyMutateTemplateFrontmatter(cachedFrontmatter || {})) return false;

        // Grace period for newly created files to allow other plugins (TPS-Controller, Templater) to finish initialization
        const age = Date.now() - file.stat.ctime;
        if (!options.bypassCreationGrace && age < 2000) return false;

        const baseName = String(file.basename || '').trim().toLowerCase();
        if (baseName === '__type__' || baseName === '__root__') return false;

        // Don't process if already processing
        if (!options.bypassProcessingLock && this.processingFiles.has(file.path)) return false;

        // Check folder exclusions
        if (this.plugin.settings.folderExclusions) {
            const exclusions = this.plugin.settings.folderExclusions
                .split('\n')
                .map(e => e.trim())
                .filter(e => e.length > 0);

            const normalizedPath = this.normalizeBasenameForCompare(file.path);
            const normalizedBasename = this.normalizeBasenameForCompare(file.basename);

            if (exclusions.some(pattern => this.plugin.matchesAutoFrontmatterExclusionPattern(normalizedPath, normalizedBasename, pattern))) {
                return false;
            }
        }

        // Check frontmatter auto-write exclusions (prevents auto-rename/title sync for excluded paths)
        if (this.shouldSkipAutoFrontmatterWrite(file)) {
            return false;
        }

        return true;
    }

    private getLiveFile(file: TFile): TFile | null {
        const latest = this.plugin.app.vault.getAbstractFileByPath(file.path);
        return latest instanceof TFile ? latest : null;
    }

    private normalizeBasenameForCompare(name: string): string {
        return String(name || '')
            .normalize('NFKC')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    private isLikelyMissingFileError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error ?? '');
        return /ENOENT|no such file or directory/i.test(message);
    }

    private isDuplicateYamlKeyError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error ?? '');
        return /map keys must be unique|duplicate key|duplicated mapping key/i.test(message);
    }

    private shouldSkipAutoFrontmatterWrite(file: TFile): boolean {
        return this.plugin.shouldIgnoreAutoFrontmatterWrite(file);
    }

    private canAutomaticallyMutateTemplateFrontmatter(frontmatter: unknown): boolean {
        return canAutomaticallyMutateTemplateFrontmatter(frontmatter, this.plugin.settings);
    }

    private async canAutomaticallyMutateTemplateSource(file: TFile): Promise<boolean> {
        return canAutomaticallyMutateTemplateFile(this.plugin.app.vault, file, this.plugin.settings);
    }

    private async hasPersistedFrontmatterBlock(file: TFile): Promise<boolean> {
        let content = '';
        try {
            content = await this.plugin.app.vault.cachedRead(file);
        } catch {
            return false;
        }

        const normalized = String(content || '').replace(/\r\n/g, '\n');
        const body = normalized.startsWith('\uFEFF') ? normalized.slice(1) : normalized;
        return body.startsWith('---\n') && body.indexOf('\n---', 4) !== -1;
    }

    private async getPersistedFrontmatterStringValues(file: TFile, keys: string[]): Promise<Map<string, string>> {
        let content = '';
        try {
            content = await this.plugin.app.vault.cachedRead(file);
        } catch {
            return new Map<string, string>();
        }

        return this.getFrontmatterStringValuesFromSource(content, keys);
    }

    private getFrontmatterStringValuesFromSource(content: string, keys: string[]): Map<string, string> {
        const values = new Map<string, string>();

        const normalized = String(content || '').replace(/\r\n/g, '\n');
        const body = normalized.startsWith('\uFEFF') ? normalized.slice(1) : normalized;
        if (!body.startsWith('---\n')) return values;

        const closeIndex = body.indexOf('\n---', 4);
        if (closeIndex === -1) return values;

        const keySet = new Set(keys.map((key) => key.trim().toLowerCase()).filter(Boolean));
        const yamlBody = body.slice(4, closeIndex);
        for (const line of yamlBody.split('\n')) {
            const match = line.match(/^\s*([^:#\n]+?)\s*:\s*(.*)\s*$/);
            if (!match) continue;
            const normalizedKey = match[1].trim().toLowerCase();
            if (!keySet.has(normalizedKey)) continue;
            const rawValue = match[2].trim();
            const quoted = rawValue.match(/^(['"])(.*)\1$/);
            values.set(normalizedKey, quoted ? quoted[2] : rawValue);
        }
        return values;
    }

    private async hasWorkflowOwnedFilenameEvidence(file: TFile): Promise<boolean> {
        let content = '';
        try {
            const vault = this.plugin.app.vault as typeof this.plugin.app.vault & {
                read?: (target: TFile) => Promise<string>;
            };
            content = await (typeof vault.read === 'function' ? vault.read(file) : vault.cachedRead(file));
        } catch {
            // A filename mutation is optional. If current bytes cannot be read,
            // keep the existing path instead of guessing that workflow ownership
            // is absent.
            return true;
        }

        if (await this.plugin.nativeRecordService?.hasRecordIdentityEvidence(file, content)) {
            return true;
        }

        const values = this.getFrontmatterStringValuesFromSource(content, [
            'runKind',
            'workflowKind',
            'kind',
            'runType',
            'workflowType',
        ]);
        return this.isProcessRunFrontmatter(Object.fromEntries(values));
    }

    private getFrontmatterStringValueCaseInsensitive(frontmatter: Record<string, any>, key: string): string {
        const normalized = key.trim().toLowerCase();
        const existingKey = Object.keys(frontmatter).find((k) => k.trim().toLowerCase() === normalized);
        if (!existingKey) return "";
        const value = frontmatter[existingKey];
        return typeof value === "string" ? value : String(value ?? "");
    }

    private setFrontmatterValueCaseInsensitive(frontmatter: Record<string, any>, key: string, value: string): void {
        const normalized = key.trim().toLowerCase();
        const existingKey = Object.keys(frontmatter).find((k) => k.trim().toLowerCase() === normalized);
        frontmatter[existingKey || key] = value;
    }

    private isTemplateDerivedTitle(currentTitle: string): boolean {
        const title = String(currentTitle || '').trim();
        if (!title) return true;

        if (FileNamingService.TEMPLATE_TITLE_MARKERS.some((pattern) => pattern.test(title))) {
            return true;
        }

        const normalizedTitle = this.normalizeBasenameForCompare(title);
        if (normalizedTitle === 'untitled' || normalizedTitle === 'new note') {
            return true;
        }

        return false;
    }

    private async isBlankGeneratedUntitledNote(file: TFile, basename: string): Promise<boolean> {
        if (!/^Untitled(?: \d+)?$/i.test(String(basename || '').trim())) return false;
        try {
            const content = await this.plugin.app.vault.cachedRead(file);
            const body = content.replace(/^\uFEFF?---\s*[\r\n][\s\S]*?[\r\n]---(?:[\r\n]|$)/, '');
            return body.trim().length === 0;
        } catch {
            return false;
        }
    }

    private async yieldToEventLoop(): Promise<void> {
        await new Promise<void>((resolve) => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => resolve());
                return;
            }
            setTimeout(resolve, 0);
        });
    }
}
