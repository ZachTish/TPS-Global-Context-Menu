import { normalizePath, TFile } from 'obsidian';
import TPSGlobalContextMenuPlugin from '../main';
import * as logger from "../logger";
import { extractDatePrefix, extractDateSuffix, stripDatePrefix, stripDateSuffix, FULL_DATE_REGEX } from '../utils/date-suffix-utils';
import { getDailyNotePathDateCandidate } from '../utils/daily-note-creation';

/**
 * Handles automatic file naming based on title and scheduled date
 */
export class FileNamingService {
    plugin: TPSGlobalContextMenuPlugin;
    private processingFiles: Set<string> = new Set();
    private recentFolderPathWrites: Map<string, { value: string; until: number }> = new Map();
    private recentTimestampWrites: Map<string, number> = new Map();
    private timestampWriteStateByPath: Map<string, { fingerprint: string; modifiedValue: string }> = new Map();
    private inferredDailyNoteFormat: string | null = null;
    private knownDailyNoteConfigurations = new Map<string, { folder: string; format: string }>();
    private dailyNoteConfigurationReady: Promise<void>;

    constructor(plugin: TPSGlobalContextMenuPlugin) {
        this.plugin = plugin;
        this.dailyNoteConfigurationReady = this.loadPersistedDailyNoteConfiguration();
    }

    private static readonly TEMPLATE_TITLE_MARKERS: RegExp[] = [
        /<%[\s\S]*%>/i,
        /\{\{[\s\S]*\}\}/i,
        /\btp\.[a-z0-9_]+\b/i,
        /\btemplater\b/i,
    ];

    public getDailyNoteDateFormat(): string {
        const configured = String((this.plugin as any)?.settings?.dailyNoteDateFormat || '').trim();
        if (configured) return configured;
        const dailyNotesFormat = String(this.getCoreDailyNoteOptions()?.format || '').trim();
        if (dailyNotesFormat) return dailyNotesFormat;
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
        try {
            const configDir = String((this.plugin.app.vault as any)?.configDir || '.obsidian').trim() || '.obsidian';
            const raw = await this.plugin.app.vault.adapter.read(normalizePath(`${configDir}/daily-notes.json`));
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                this.registerDailyNoteConfiguration(
                    (parsed as Record<string, unknown>).folder,
                    (parsed as Record<string, unknown>).format,
                );
            }
        } catch {
            // Core Daily Notes may be disabled or may not have written settings yet.
        }
    }

    public async isDailyNoteFile(file: TFile): Promise<boolean> {
        await this.dailyNoteConfigurationReady;
        return this.isConfiguredDailyNotePath(file);
    }

    private isConfiguredDailyNotePath(file: TFile): boolean {
        const coreOptions = this.getCoreDailyNoteOptions();
        const periodicOptions = this.getPeriodicDailyNoteOptions();
        if (coreOptions) {
            this.registerDailyNoteConfiguration(coreOptions.folder, coreOptions.format);
        }
        if (periodicOptions) {
            this.registerDailyNoteConfiguration(periodicOptions.folder, periodicOptions.format);
        }

        const configurations = Array.from(this.knownDailyNoteConfigurations.values());
        if (configurations.length === 0) {
            configurations.push({
                folder: '',
                format: String((this.plugin as any)?.settings?.dailyNoteDateFormat || '').trim()
                    || this.getDailyNoteDateFormat(),
            });
        }
        return configurations.some(({ folder, format }) => {
            const candidate = getDailyNotePathDateCandidate(file.path, folder);
            if (!candidate) return false;
            const formats = Array.from(new Set([
                format,
                String((this.plugin as any)?.settings?.dailyNoteDateFormat || '').trim(),
            ].filter(Boolean)));
            return formats.some((candidateFormat) => {
                const parsed = window.moment(candidate, candidateFormat, true);
                return Boolean(parsed?.isValid?.() && parsed.isValid());
            });
        });
    }

    private isDailyNoteFrontmatter(frontmatter: Record<string, unknown> | undefined | null): boolean {
        if (!frontmatter) return false;
        if (this.isProcessRunFrontmatter(frontmatter)) return false;
        const tags = this.normalizeFrontmatterStringList((frontmatter as any).tags || (frontmatter as any).tag)
            .map((tag) => tag.replace(/^#/, '').trim().toLowerCase());
        if (tags.some((tag) => tag === 'type/note/daily' || tag === 'dailynote')) return true;
        const types = this.normalizeFrontmatterStringList((frontmatter as any).type || (frontmatter as any).types)
            .map((value) => value.replace(/^#/, '').trim().toLowerCase());
        if (types.some((value) => value === 'daily' || value === 'note/daily' || value === 'type/note/daily')) return true;
        const kinds = this.normalizeFrontmatterStringList((frontmatter as any).kind || (frontmatter as any).kinds)
            .map((value) => value.replace(/^#/, '').trim().toLowerCase());
        return kinds.some((value) =>
            value === 'dailynote'
            || value === 'daily'
            || value === 'note/daily'
            || value === 'type/note/daily'
        );
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
        const expectedDate = this.parseDailyNoteBasenameToIso(file.basename);
        if (!expectedDate) return false;
        const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        if (this.isProcessRunFrontmatter(frontmatter)) return false;
        const expectedScheduled = `${expectedDate} 00:00:00`;
        if (!(await this.plugin.bulkEditService.canMutateFrontmatterSafely(file))) return false;

        let changed = false;
        await this.plugin.bulkEditService.runSerializedFrontmatterWrite(file, async () => {
            await this.plugin.frontmatterMutationService.process(file, (frontmatter) => {
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

    private getCanonicalTitleForScheduledFilename(title: string, scheduledDate: any): string {
        const normalizedTitle = String(title || '').replace(/\s+/g, ' ').trim();
        if (!normalizedTitle) return '';
        if (!scheduledDate || !scheduledDate.isValid || !scheduledDate.isValid()) {
            return stripDatePrefix(stripDateSuffix(normalizedTitle)).replace(/\s+/g, ' ').trim();
        }

        if (this.titleMatchesScheduledDate(normalizedTitle, scheduledDate)) {
            const stripped = this.stripKnownDateMarker(normalizedTitle, scheduledDate).replace(/\s+/g, ' ').trim();
            if (stripped) return stripped;
            return normalizedTitle;
        }

        return this.stripKnownDateMarker(normalizedTitle, scheduledDate).replace(/\s+/g, ' ').trim();
    }

    private buildExpectedBasename(title: string, scheduled: unknown): string {
        const normalizedTitle = String(title || '').replace(/\s+/g, ' ').trim();
        if (!normalizedTitle) return '';

        const scheduledRaw = String(scheduled ?? '').trim();
        if (!scheduledRaw) {
            return this.sanitizeFilename(this.getCanonicalTitleForScheduledFilename(normalizedTitle, null));
        }

        const scheduledDate = window.moment(scheduledRaw);
        if (!scheduledDate?.isValid?.() || !scheduledDate.isValid()) {
            return this.sanitizeFilename(this.getCanonicalTitleForScheduledFilename(normalizedTitle, null));
        }

        const canonicalTitle = this.getCanonicalTitleForScheduledFilename(normalizedTitle, scheduledDate);
        const dateStr = scheduledDate.format('YYYY-MM-DD');

        if (!canonicalTitle || this.titleMatchesScheduledDate(canonicalTitle, scheduledDate)) {
            return this.sanitizeFilename(dateStr);
        }

        return this.sanitizeFilename(`${dateStr} ${canonicalTitle}`);
    }

    /**
     * Process a file when it's opened - update filename and folder path
     */
    async processFileOnOpen(
        file: TFile,
        options: { bypassCreationGrace?: boolean; preserveDailyNoteIdentity?: boolean } = {},
    ): Promise<void> {
        await this.dailyNoteConfigurationReady;
        const started = performance.now();
        if (!this.shouldProcess(file, options)) return;
        const liveFile = this.getLiveFile(file);
        if (!liveFile || !this.shouldProcess(liveFile, options)) return;
        const lockKey = liveFile.path;
        const skipFrontmatterWrites = this.shouldSkipAutoFrontmatterWrite(liveFile);

        // Prevent recursive processing
        if (this.processingFiles.has(lockKey)) {
            return;
        }

        this.processingFiles.add(lockKey);

        try {
            logger.perf('fileNaming:processFileOnOpen:start', {
                file: liveFile.path,
                autoSaveFolderPath: this.plugin.settings.autoSaveFolderPath,
                autoSyncTitleFromFilename: this.plugin.settings.autoSyncTitleFromFilename,
                enableAutoRename: this.plugin.settings.enableAutoRename,
                enableAutoPopulateDailyNotes: this.plugin.settings.enableAutoPopulateDailyNotes,
                autoSyncFileTimestamps: this.plugin.settings.autoSyncFileTimestamps,
                skipFrontmatterWrites,
            });
            if (this.plugin.settings.autoSyncFileTimestamps && !skipFrontmatterWrites) {
                await logger.timeAsync('fileNaming:syncFileTimestamps', { file: liveFile.path }, () =>
                    this.syncFileTimestamps(liveFile, { reason: 'open' })
                );
            }

            // Update folder path if enabled
            if (this.plugin.settings.autoSaveFolderPath && !skipFrontmatterWrites) {
                await logger.timeAsync('fileNaming:_syncFolderPath', { file: liveFile.path }, () => this._syncFolderPath(liveFile));
            }

            if (!skipFrontmatterWrites) {
                await logger.timeAsync('fileNaming:repairDailyNoteScheduled', { file: liveFile.path }, () => this.repairDailyNoteScheduled(liveFile));
            }

            // Keep frontmatter title aligned with filename only when explicitly enabled.
            if (
                this.plugin.settings.autoSyncTitleFromFilename
                && !skipFrontmatterWrites
                && options.preserveDailyNoteIdentity !== true
            ) {
                await logger.timeAsync('fileNaming:syncTitleFromFilename', { file: liveFile.path }, () => this.syncTitleFromFilename(liveFile, {
                    bypassCreationGrace: options.bypassCreationGrace,
                    onlyIfTemplateDerived: this.plugin.settings.enableAutoRename,
                }));
            }

            if (this.plugin.settings.enableAutoRename && options.preserveDailyNoteIdentity !== true) {
                await logger.timeAsync('fileNaming:updateFilenameIfNeeded', { file: liveFile.path }, () => this.updateFilenameIfNeeded(liveFile, {
                    bypassCreationGrace: options.bypassCreationGrace,
                    bypassProcessingLock: true,
                }));
            }

            // Populate daily note with scheduled items if applicable
            const frontmatter = this.plugin.app.metadataCache.getFileCache(liveFile)?.frontmatter as Record<string, unknown> | undefined;
            if (this.plugin.settings.enableAutoPopulateDailyNotes && this.isDateOnlyBasename(liveFile.basename) && !this.isProcessRunFrontmatter(frontmatter)) {
                await logger.timeAsync('fileNaming:populateDailyNoteWithScheduledItems', { file: liveFile.path }, () =>
                    this.plugin.noteOperationService.populateDailyNoteWithScheduledItems(liveFile)
                );
            }
        } catch (error) {
            logger.error('[TPS GCM] Error processing file on open:', error);
        } finally {
            logger.perf('fileNaming:processFileOnOpen:end', {
                file: liveFile.path,
                durationMs: Math.round(performance.now() - started),
            });
            this.processingFiles.delete(lockKey);
        }
    }

    async syncFileTimestamps(file: TFile, options: { reason?: 'open' | 'create' | 'modify' | 'rename'; force?: boolean } = {}): Promise<void> {
        if (!this.plugin.settings.autoSyncFileTimestamps) return;
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        const liveFile = this.getLiveFile(file);
        if (!liveFile || liveFile.extension !== 'md') return;
        if (!options.force && this.hasRecentTimestampWrite(liveFile.path)) return;
        if (this.shouldSkipAutoFrontmatterWrite(liveFile)) return;
        if (!(await this.plugin.bulkEditService.canMutateFrontmatterSafely(liveFile))) {
            logger.warn(`[TPS GCM] Skipping timestamp sync due to malformed frontmatter: ${liveFile.path}`);
            return;
        }

        const createdKey = this.normalizeFrontmatterKey(this.plugin.settings.dateCreatedFrontmatterKey, 'datecreated');
        const modifiedKey = this.normalizeFrontmatterKey(this.plugin.settings.dateModifiedFrontmatterKey, 'datemodified');
        const format = String(this.plugin.settings.fileTimestampFormat || '').trim() || 'YYYY-MM-DD HH:mm:ss';
        const createdValue = this.formatFileTimestamp(liveFile.stat.ctime, format);
        const modifiedValue = this.formatFileTimestamp(liveFile.stat.mtime, format);
        const cache = this.plugin.app.metadataCache.getFileCache(liveFile);
        const fm = cache?.frontmatter || {};
        const persistedTimestampValues = await this.getPersistedFrontmatterStringValues(liveFile, [createdKey, modifiedKey]);

        const existingCreated = (
            persistedTimestampValues.get(createdKey.toLowerCase())
            ?? this.getFrontmatterStringValueCaseInsensitive(fm, createdKey)
        ).trim();
        const existingModified = (
            persistedTimestampValues.get(modifiedKey.toLowerCase())
            ?? this.getFrontmatterStringValueCaseInsensitive(fm, modifiedKey)
        ).trim();
        const fingerprint = await this.getTimestampContentFingerprint(liveFile, createdKey, modifiedKey);

        if (
            !options.force &&
            fingerprint &&
            this.isKnownTimestampOnlyMtimeDrift(liveFile.path, fingerprint, existingModified)
        ) {
            return;
        }
        if (
            !options.force &&
            this.isRecentTimestampOnlyMtimeDrift(existingModified, liveFile.stat.mtime)
        ) {
            if (fingerprint) {
                this.rememberTimestampWriteState(liveFile.path, fingerprint, existingModified);
            }
            return;
        }

        if (existingCreated === createdValue && existingModified === modifiedValue) return;

        this.rememberRecentTimestampWrite(liveFile.path);
        try {
            await this.plugin.bulkEditService.runSerializedFrontmatterWrite(liveFile, async () => {
                await this.plugin.frontmatterMutationService.process(liveFile, (frontmatter) => {
                    this.setFrontmatterValueCaseInsensitive(frontmatter, createdKey, createdValue);
                    this.setFrontmatterValueCaseInsensitive(frontmatter, modifiedKey, modifiedValue);
                });
            });
            if (fingerprint) {
                this.rememberTimestampWriteState(liveFile.path, fingerprint, modifiedValue);
            }
        } catch (error) {
            if (this.isLikelyMissingFileError(error) || this.isDuplicateYamlKeyError(error)) return;
            logger.error('[TPS GCM] Failed syncing file timestamps:', { file: liveFile.path, reason: options.reason, error });
            throw error;
        }
    }

    /**
     * Public method to sync folder path on demand (e.g. after move/rename)
     */
    async syncFolderPath(file: TFile): Promise<void> {
        logger.debug(`[FILE-DRAG] syncFolderPath called for: ${file.path}`);
        if (!this.plugin.settings.autoSaveFolderPath) {
            logger.debug(`[FILE-DRAG] autoSaveFolderPath disabled, skipping`);
            return;
        }
        if (!this.shouldProcess(file)) {
            logger.debug(`[FILE-DRAG] shouldProcess returned false, skipping`);
            return;
        }
        const liveFile = this.getLiveFile(file);
        if (!liveFile || !this.shouldProcess(liveFile)) {
            logger.debug(`[FILE-DRAG] liveFile check failed, skipping`);
            return;
        }
        if (this.shouldSkipAutoFrontmatterWrite(liveFile)) {
            logger.debug(`[FILE-DRAG] shouldSkipAutoFrontmatterWrite true, skipping`);
            return;
        }
        const lockKey = liveFile.path;

        // Use internal helper to avoid duplicate processing checks if called directly
        // But we should still use the lock to prevent races
        if (this.processingFiles.has(lockKey)) {
            logger.debug(`[FILE-DRAG] Already processing ${lockKey}, skipping`);
            return;
        }
        this.processingFiles.add(lockKey);
        logger.debug(`[FILE-DRAG] Acquired lock for ${lockKey}`);

        try {
            await this._syncFolderPath(liveFile);
        } finally {
            this.processingFiles.delete(lockKey);
            logger.debug(`[FILE-DRAG] Released lock for ${lockKey}`);
        }
    }

    private async _syncFolderPath(file: TFile): Promise<void> {
        logger.debug(`[FILE-DRAG] _syncFolderPath: ${file.path}`);
        const liveFile = this.getLiveFile(file);
        if (!liveFile) {
            logger.debug(`[FILE-DRAG] No live file found`);
            return;
        }
        if (this.shouldSkipAutoFrontmatterWrite(liveFile)) {
            logger.debug(`[FILE-DRAG] Skipping frontmatter write`);
            return;
        }
        if (!(await this.plugin.bulkEditService.canMutateFrontmatterSafely(liveFile))) {
            logger.warn(`[FILE-DRAG] Skipping folderPath write due to malformed frontmatter: ${liveFile.path}`);
            return;
        }
        const currentFolder = liveFile.parent?.path || '/';
        const cache = this.plugin.app.metadataCache.getFileCache(liveFile);
        const fm = cache?.frontmatter;
        const existingFolderPath = this.getFrontmatterStringValueCaseInsensitive(fm || {}, 'folderPath').trim();
        const persistedFolderPath = await this.getPersistedFolderPath(liveFile);
        const hasLegacyTypeKeys = Object.keys(fm || {}).some((key) => {
            const normalized = String(key || '').trim().toLowerCase();
            return normalized === 'type' || normalized === 'types';
        });

        logger.debug(`[FILE-DRAG] currentFolder=${currentFolder}, existingFolderPath=${existingFolderPath}, persistedFolderPath=${persistedFolderPath}, hasLegacyTypeKeys=${hasLegacyTypeKeys}`);

        if (this.hasRecentFolderPathWrite(liveFile.path, currentFolder)) {
            logger.debug(`[FILE-DRAG] Skipping repeated folderPath write for ${liveFile.path}`);
            return;
        }

        const effectiveFolderPath = persistedFolderPath || existingFolderPath;
        if (effectiveFolderPath === currentFolder && !hasLegacyTypeKeys) {
            logger.debug(`[FILE-DRAG] No update needed`);
            return;
        }

        try {
            logger.debug(`[FILE-DRAG] Writing folderPath to frontmatter: ${currentFolder}`);
            await this.plugin.bulkEditService.runSerializedFrontmatterWrite(liveFile, async () => {
                await this.plugin.frontmatterMutationService.process(liveFile, (frontmatter) => {
                    frontmatter.folderPath = currentFolder;
                    for (const key of Object.keys(frontmatter)) {
                        const normalized = String(key || '').trim().toLowerCase();
                        if (normalized === 'type' || normalized === 'types') {
                            delete frontmatter[key];
                        }
                    }
                });
            });
            this.rememberRecentFolderPathWrite(liveFile.path, currentFolder);
            logger.debug(`[FILE-DRAG] Frontmatter updated successfully`);
        } catch (error) {
            if (this.isLikelyMissingFileError(error)) {
                logger.debug(`[FILE-DRAG] Missing file error (expected during move)`);
                return;
            }
            if (this.isDuplicateYamlKeyError(error)) {
                logger.debug(`[FILE-DRAG] Duplicate YAML key error`);
                return;
            }
            logger.error(`[FILE-DRAG] Unexpected error:`, error);
            throw error;
        }
    }

    /**
     * When a file is renamed by Obsidian core, keep frontmatter.title in sync with the new basename.
     * Applies the same scheduled-date filename normalization used by auto-rename.
     */
    async syncTitleFromFilename(
        file: TFile,
        options: { onlyIfTemplateDerived?: boolean; onlyIfMissing?: boolean; onlyIfHasFrontmatter?: boolean; force?: boolean; bypassCreationGrace?: boolean } = {},
    ): Promise<void> {
        if (!options.force && !this.plugin.settings.autoSyncTitleFromFilename) {
            return;
        }
        await this.syncTitleFromFilenameWithOptions(file, options);
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
        if (!options.force && !this.plugin.settings.autoSyncTitleFromFilename) return "skipped";
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

            // Date-only files (daily notes) are owned by the Companion
            // plugin for title sync. Skip them here to avoid fighting over title values.
            const isProcessRun = this.isProcessRunFrontmatter(fm);
            if ((this.isDateOnlyBasename(rawBasename) || this.isConfiguredDailyNotePath(liveFile)) && !isProcessRun) return "skipped";
            if (this.isDailyNoteFrontmatter(fm) && !isProcessRun) return "skipped";
            if (await this.plugin.bulkEditService.shouldSkipNoteLevelRecurrence(liveFile, scheduled)) return "skipped";

            // Avoid writing clearly-stale template-derived titles
            if (rawBasename.toLowerCase().includes('template')) return "skipped";

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
            const templateDerivedTitle = this.isTemplateDerivedTitle(currentTitle, rawBasename);
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
                await this.plugin.bulkEditService.runSerializedFrontmatterWrite(targetFile, async () => {
                    await this.plugin.frontmatterMutationService.process(targetFile, (frontmatter) => {
                        const existingTitleKeys = Object.keys(frontmatter).filter(
                            (key) => key.trim().toLowerCase() === 'title',
                        );
                        if (existingTitleKeys.length === 0) {
                            frontmatter.title = nextTitle;
                        } else {
                            frontmatter[existingTitleKeys[0]] = nextTitle;
                            for (let i = 1; i < existingTitleKeys.length; i++) {
                                delete frontmatter[existingTitleKeys[i]];
                            }
                        }
                        this.addMeaningfulAliases(frontmatter, [currentTitle, rawBasename], nextTitle);
                    });
                });
                return "updated";
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
     * Update filename based on title and scheduled date
     */
    async updateFilenameIfNeeded(file: TFile, options: { bypassCreationGrace?: boolean; titleOverride?: string; bypassProcessingLock?: boolean } = {}): Promise<void> {
        await this.dailyNoteConfigurationReady;
        if (!this.shouldProcess(file, options)) return;
        const liveFile = this.getLiveFile(file);
        if (!liveFile || !this.shouldProcess(liveFile, options)) return;
        if (this.shouldSkipAutoFrontmatterWrite(liveFile)) return;

        const cache = this.plugin.app.metadataCache.getFileCache(liveFile);
        const fm = cache?.frontmatter;
        const persistedValues = await this.getPersistedFrontmatterStringValues(liveFile, ['title', 'scheduled']);
        const hasPersistedFrontmatter = await this.hasPersistedFrontmatterBlock(liveFile);
        const scheduled = hasPersistedFrontmatter
            ? (persistedValues.has('scheduled') ? persistedValues.get('scheduled') : '')
            : fm?.scheduled;

        if (!fm && !options.titleOverride && !persistedValues.has('title')) return;

        // Only proceed if there's a title in frontmatter
        const rawTitle = options.titleOverride ?? persistedValues.get('title') ?? fm?.title;
        if (!rawTitle) return;

        const title = String(rawTitle ?? '');
        if (!title.trim()) return;

        // Skip if title looks like a template name (stale cache data)
        // This prevents renaming newly created files with the template's title
        if (title.toLowerCase().includes('template')) {
            return;
        }

        // Date-only files (daily notes) should never be renamed based on
        // title/scheduled logic. Their filename IS the canonical identifier.
        const isProcessRun = this.isProcessRunFrontmatter(fm);
        if (
            (
                this.isDateOnlyBasename(String(liveFile.basename).trim())
                || this.isConfiguredDailyNotePath(liveFile)
            )
            && !isProcessRun
        ) return;
        if (this.isDailyNoteFrontmatter(fm) && !isProcessRun) return;

        const expectedBasename = this.buildExpectedBasename(title, scheduled);

        // Check if current filename already matches (case-insensitive and trimmed)
        if (!expectedBasename) return;
        const currentNormalized = this.normalizeBasenameForCompare(liveFile.basename);
        const expectedNormalized = this.normalizeBasenameForCompare(expectedBasename);

        if (currentNormalized === expectedNormalized) {
            return; // Already has correct name
        }

        // Additional safety check: if current filename already contains the date, don't rename
        if (scheduled) {
            const dateStr = window.moment(scheduled).format('YYYY-MM-DD');
            const datePattern = new RegExp(`\\s${dateStr.replace(/-/g, '\\-')}(?:\\s|$)`);

            if (datePattern.test(liveFile.basename)) {
                // Filename already contains this date, check if it just needs exact matching
                const currentWithoutExtras = liveFile.basename.replace(/\s+/g, ' ').trim();
                const expectedWithoutExtras = expectedBasename.replace(/\s+/g, ' ').trim();

                if (currentWithoutExtras === expectedWithoutExtras) {
                    return; // Already correct, just whitespace differences
                }
            }
        }

        // Check if a file with the expected name already exists
        const parentPath = liveFile.parent?.path && liveFile.parent.path !== '/'
            ? liveFile.parent.path
            : '';
        const expectedPath = parentPath
            ? `${parentPath}/${expectedBasename}.md`
            : `${expectedBasename}.md`;
        const currentPathNormalized = normalizePath(liveFile.path).toLowerCase();
        const expectedPathNormalized = normalizePath(expectedPath).toLowerCase();
        if (currentPathNormalized === expectedPathNormalized) {
            return;
        }

        const existingFile = this.plugin.app.vault.getAbstractFileByPath(expectedPath);

        if (existingFile && existingFile !== liveFile) {
            // A different file with this name already exists - don't overwrite
            logger.log(`[TPS GCM] File with name "${expectedBasename}" already exists, skipping rename`);
            return;
        }

        // Rename the file
        try {
            const previousBasename = liveFile.basename;
            const previousPath = liveFile.path;
            await this.plugin.app.fileManager.renameFile(liveFile, expectedPath);
            logger.log(`[TPS GCM] Renamed file from "${previousBasename}" to "${expectedBasename}" (${previousPath} -> ${expectedPath})`);
        } catch (error) {
            if (this.isLikelyMissingFileError(error)) return;
            logger.error(`[TPS GCM] Failed to rename file to "${expectedBasename}":`, error);
        }
    }

    /**
     * Sanitize filename to remove invalid characters
     */
    private sanitizeFilename(name: string): string {
        // Remove or replace invalid filename characters
        return name
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // Remove invalid characters
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }

    /**
     * Check if a file should be processed for auto-naming
     */
    shouldProcess(file: TFile, options: { bypassCreationGrace?: boolean; bypassProcessingLock?: boolean } = {}): boolean {
        // Only process markdown files
        if (file.extension !== 'md') return false;
        // Companion property notes are storage records for non-Markdown files,
        // not ordinary notes. Never add titles/timestamps or rename them.
        if (this.plugin.filePropertiesService?.isCompanionFile(file)) return false;
        // Native records use their TPS identity as the canonical filename. A
        // generic title-based rename would immediately be restored by the
        // native-record service and can trigger Obsidian's update-links prompt.
        if (this.plugin.nativeRecordService?.isRecordFile(file)) return false;

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

    private hasRecentFolderPathWrite(path: string, value: string): boolean {
        this.clearExpiredRecentFolderPathWrites();
        const record = this.recentFolderPathWrites.get(path);
        if (!record) return false;
        return record.value === value;
    }

    private rememberRecentFolderPathWrite(path: string, value: string): void {
        this.clearExpiredRecentFolderPathWrites();
        this.recentFolderPathWrites.set(path, {
            value,
            until: Date.now() + 5000,
        });
    }

    private clearExpiredRecentFolderPathWrites(): void {
        const now = Date.now();
        for (const [path, record] of this.recentFolderPathWrites.entries()) {
            if (record.until <= now) {
                this.recentFolderPathWrites.delete(path);
            }
        }
    }

    private async getPersistedFolderPath(file: TFile): Promise<string> {
        let content = '';
        try {
            content = await this.plugin.app.vault.cachedRead(file);
        } catch {
            return '';
        }

        if (!content) return '';

        const normalized = content.replace(/\r\n/g, '\n');
        const body = normalized.startsWith('\uFEFF') ? normalized.slice(1) : normalized;
        const trimmedLeading = body.replace(/^\s*/, '');
        const candidate = body.startsWith('---\n')
            ? body
            : trimmedLeading.startsWith('---\n')
                ? trimmedLeading
                : '';
        if (!candidate) return '';

        const closeIndex = candidate.indexOf('\n---\n', 4);
        if (closeIndex === -1) return '';

        const yamlBody = candidate.slice(4, closeIndex);
        for (const line of yamlBody.split('\n')) {
            const match = line.match(/^\s*([^:#]+?)\s*:\s*(.*)\s*$/);
            if (!match) continue;
            if (match[1].trim().toLowerCase() !== 'folderpath') continue;
            const rawValue = match[2].trim();
            if (!rawValue) return '';
            const quoted = rawValue.match(/^(['"])(.*)\1$/);
            return quoted ? quoted[2] : rawValue;
        }

        return '';
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
        const values = new Map<string, string>();
        let content = '';
        try {
            content = await this.plugin.app.vault.cachedRead(file);
        } catch {
            return values;
        }

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

    private normalizeFrontmatterKey(value: string | undefined, fallback: string): string {
        return String(value || '').trim().replace(/[\s:#[\]{}"'`]/g, '') || fallback;
    }

    private formatFileTimestamp(timestampMs: number, format: string): string {
        const parsed = window.moment(timestampMs);
        return parsed?.isValid?.() && parsed.isValid() ? parsed.format(format) : '';
    }

    private hasRecentTimestampWrite(path: string): boolean {
        this.clearExpiredRecentTimestampWrites();
        return this.recentTimestampWrites.has(path);
    }

    private rememberRecentTimestampWrite(path: string): void {
        this.clearExpiredRecentTimestampWrites();
        this.recentTimestampWrites.set(path, Date.now() + 5000);
    }

    private clearExpiredRecentTimestampWrites(): void {
        const now = Date.now();
        for (const [path, until] of this.recentTimestampWrites.entries()) {
            if (until <= now) {
                this.recentTimestampWrites.delete(path);
            }
        }
    }

    private isKnownTimestampOnlyMtimeDrift(path: string, fingerprint: string, existingModified: string): boolean {
        const state = this.timestampWriteStateByPath.get(path);
        return !!state && state.fingerprint === fingerprint && state.modifiedValue === existingModified;
    }

    private rememberTimestampWriteState(path: string, fingerprint: string, modifiedValue: string): void {
        this.timestampWriteStateByPath.set(path, { fingerprint, modifiedValue });
    }

    private isRecentTimestampOnlyMtimeDrift(existingModified: string, mtimeMs: number): boolean {
        const modifiedMs = this.parseTimestampValue(existingModified);
        if (!Number.isFinite(modifiedMs) || !Number.isFinite(mtimeMs)) return false;
        const driftMs = mtimeMs - modifiedMs;
        return driftMs > 0 && driftMs <= 5 * 60 * 1000;
    }

    private parseTimestampValue(value: string): number {
        const trimmed = String(value || '').trim();
        if (!trimmed) return Number.NaN;
        const momentFactory = (window as any)?.moment;
        if (typeof momentFactory === 'function') {
            const parsed = momentFactory(trimmed, [
                'YYYY-MM-DD HH:mm:ss',
                'YYYY-MM-DD HH:mm',
                'YYYY-MM-DDTHH:mm:ss',
                'YYYY-MM-DDTHH:mm',
                momentFactory.ISO_8601,
            ], true);
            if (parsed?.isValid?.() && parsed.isValid()) return parsed.valueOf();
        }
        const native = new Date(trimmed.replace(' ', 'T'));
        return native.getTime();
    }

    private async getTimestampContentFingerprint(file: TFile, createdKey: string, modifiedKey: string): Promise<string> {
        try {
            const content = await this.plugin.app.vault.cachedRead(file);
            return this.hashString(this.stripTimestampFrontmatterLines(content, [createdKey, modifiedKey]));
        } catch {
            return '';
        }
    }

    private stripTimestampFrontmatterLines(content: string, keys: string[]): string {
        const normalized = String(content || '').replace(/\r\n/g, '\n');
        const bom = normalized.startsWith('\uFEFF') ? '\uFEFF' : '';
        const body = bom ? normalized.slice(1) : normalized;
        if (!body.startsWith('---\n')) return normalized;
        const closeIndex = body.indexOf('\n---', 4);
        if (closeIndex === -1) return normalized;

        const keySet = new Set(keys.map((key) => key.trim().toLowerCase()).filter(Boolean));
        const frontmatter = body.slice(4, closeIndex);
        const rest = body.slice(closeIndex);
        const filteredFrontmatter = frontmatter
            .split('\n')
            .filter((line) => {
                const match = line.match(/^\s*([^:#\n]+?)\s*:/);
                if (!match) return true;
                return !keySet.has(match[1].trim().toLowerCase());
            })
            .join('\n');

        return `${bom}---\n${filteredFrontmatter}${rest}`;
    }

    private hashString(value: string): string {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    private isTemplateDerivedTitle(currentTitle: string, basename: string): boolean {
        const title = String(currentTitle || '').trim();
        if (!title) return true;

        if (FileNamingService.TEMPLATE_TITLE_MARKERS.some((pattern) => pattern.test(title))) {
            return true;
        }

        const normalizedTitle = this.normalizeBasenameForCompare(title);
        const normalizedBasename = this.normalizeBasenameForCompare(basename);
        if (normalizedTitle.includes('template') && !normalizedBasename.includes('template')) {
            return true;
        }

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
