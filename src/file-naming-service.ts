import { TFile } from 'obsidian';
import TPSGlobalContextMenuPlugin from './main';
import * as logger from "./logger";

/**
 * Handles automatic file naming based on title and scheduled date
 */
export class FileNamingService {
    plugin: TPSGlobalContextMenuPlugin;
    private processingFiles: Set<string> = new Set();

    constructor(plugin: TPSGlobalContextMenuPlugin) {
        this.plugin = plugin;
    }

    /**
     * Process a file when it's opened - update filename and folder path
     */
    async processFileOnOpen(file: TFile): Promise<void> {
        // Prevent recursive processing
        if (this.processingFiles.has(file.path)) {
            return;
        }

        this.processingFiles.add(file.path);

        try {
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;

            if (!fm) {
                this.processingFiles.delete(file.path);
                return;
            }

            let needsUpdate = false;
            const updates: Record<string, any> = {};

            // Save folder path if enabled and if not already set or if it's different
            if (this.plugin.settings.autoSaveFolderPath) {
                const currentFolder = file.parent?.path || '/';
                if (fm.folderPath !== currentFolder) {
                    updates.folderPath = currentFolder;
                    needsUpdate = true;
                }
            }

            // Update frontmatter if needed
            if (needsUpdate) {
                await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                    Object.assign(frontmatter, updates);
                });
            }

            // Check if filename needs updating (if enabled)
            if (this.plugin.settings.enableAutoRename) {
                await this.updateFilenameIfNeeded(file);
            }
        } catch (error) {
            logger.error('[TPS GCM] Error processing file on open:', error);
        } finally {
            this.processingFiles.delete(file.path);
        }
    }

    /**
     * When a file is renamed by Obsidian core, keep frontmatter.title in sync with the new basename.
     * Applies the same "date suffix" normalization rules used by auto-rename (title excludes YYYY-MM-DD).
     */
    async syncTitleFromFilename(file: TFile): Promise<void> {
        if (!this.shouldProcess(file)) return;

        // Prevent recursion / duplicate work during vault operations
        if (this.processingFiles.has(file.path)) return;
        this.processingFiles.add(file.path);

        try {
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            if (!fm) return;

            const rawBasename = (file.basename || '').trim();
            if (!rawBasename) return;

            // Avoid writing clearly-stale template-derived titles
            if (rawBasename.toLowerCase().includes('template')) return;

            const scheduled = fm.scheduled;
            let nextTitle = rawBasename;

            // If the filename ends with a YYYY-MM-DD suffix, strip it from the title.
            // This keeps the "title" canonical and allows the filename to carry the date.
            const dateSuffixMatch = nextTitle.match(/^(.*)\s(\d{4}-\d{2}-\d{2})$/);
            if (dateSuffixMatch) {
                const [, before, dateStr] = dateSuffixMatch;

                if (scheduled) {
                    const scheduledDate = window.moment(scheduled);
                    const suffixDate = window.moment(dateStr, 'YYYY-MM-DD', true);
                    if (scheduledDate.isValid() && suffixDate.isValid()) {
                        const scheduledStr = scheduledDate.format('YYYY-MM-DD');
                        if (scheduledStr === dateStr) {
                            nextTitle = before;
                        }
                    } else {
                        nextTitle = before;
                    }
                } else {
                    nextTitle = before;
                }
            }

            nextTitle = nextTitle.replace(/\s+/g, ' ').trim();
            const currentTitle = typeof fm.title === 'string' ? fm.title.trim() : '';

            if (nextTitle && nextTitle !== currentTitle) {
                await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                    frontmatter.title = nextTitle;
                });
            }
        } catch (error) {
            logger.error('[TPS GCM] Error syncing title from filename:', error);
        } finally {
            this.processingFiles.delete(file.path);
        }
    }

    /**
     * Update filename based on title and scheduled date
     */
    async updateFilenameIfNeeded(file: TFile): Promise<void> {
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;

        if (!fm) return;

        // Only proceed if there's a title in frontmatter
        if (!fm.title) return;

        const title = fm.title;

        // Skip if title looks like a template name (stale cache data)
        // This prevents renaming newly created files with the template's title
        if (title.toLowerCase().includes('template')) {
            return;
        }

        const scheduled = fm.scheduled;

        // Generate the expected filename
        let expectedBasename: string;
        if (scheduled) {
            // Parse the scheduled date
            const scheduledDate = window.moment(scheduled);
            if (!scheduledDate.isValid()) {
                expectedBasename = this.sanitizeFilename(title);
            } else {
                const dateStr = scheduledDate.format('YYYY-MM-DD');

                // If the title IS the date, just use the date (prevent "2025-01-01 2025-01-01")
                if (title.trim() === dateStr) {
                    expectedBasename = dateStr;
                } else {
                    // Remove any existing date suffix from title to prevent duplication
                    const titleWithoutDate = title.replace(/ \d{4}-\d{2}-\d{2}$/, '');
                    expectedBasename = this.sanitizeFilename(`${titleWithoutDate} ${dateStr}`);
                }
            }
        } else {
            // Remove any existing date suffix if no scheduled date
            const titleWithoutDate = title.replace(/ \d{4}-\d{2}-\d{2}$/, '');
            expectedBasename = this.sanitizeFilename(titleWithoutDate);
        }

        // Check if current filename already matches (case-insensitive and trimmed)
        const currentNormalized = file.basename.trim().toLowerCase();
        const expectedNormalized = expectedBasename.trim().toLowerCase();

        if (currentNormalized === expectedNormalized) {
            return; // Already has correct name
        }

        // Additional safety check: if current filename already contains the date, don't rename
        if (scheduled) {
            const dateStr = window.moment(scheduled).format('YYYY-MM-DD');
            const datePattern = new RegExp(`\\s${dateStr.replace(/-/g, '\\-')}(?:\\s|$)`);

            if (datePattern.test(file.basename)) {
                // Filename already contains this date, check if it just needs exact matching
                const currentWithoutExtras = file.basename.replace(/\s+/g, ' ').trim();
                const expectedWithoutExtras = expectedBasename.replace(/\s+/g, ' ').trim();

                if (currentWithoutExtras === expectedWithoutExtras) {
                    return; // Already correct, just whitespace differences
                }
            }
        }

        // Check if a file with the expected name already exists
        const expectedPath = file.parent
            ? `${file.parent.path}/${expectedBasename}.md`
            : `${expectedBasename}.md`;

        const existingFile = this.plugin.app.vault.getAbstractFileByPath(expectedPath);

        if (existingFile && existingFile !== file) {
            // A different file with this name already exists - don't overwrite
            logger.log(`[TPS GCM] File with name "${expectedBasename}" already exists, skipping rename`);
            return;
        }

        // Rename the file
        try {
            await this.plugin.app.fileManager.renameFile(file, expectedPath);
            logger.log(`[TPS GCM] Renamed file from "${file.basename}" to "${expectedBasename}"`);
        } catch (error) {
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
    shouldProcess(file: TFile): boolean {
        // Only process markdown files
        if (file.extension !== 'md') return false;

        // Don't process if already processing
        if (this.processingFiles.has(file.path)) return false;

        // Check folder exclusions
        if (this.plugin.settings.folderExclusions) {
            const exclusions = this.plugin.settings.folderExclusions
                .split('\n')
                .map(e => e.trim())
                .filter(e => e.length > 0);

            if (exclusions.some(excludedPath => file.path.startsWith(excludedPath))) {
                logger.log(`[TPS GCM] Skipping ${file.path} due to folder exclusion`);
                return false;
            }
        }

        return true;
    }
}
