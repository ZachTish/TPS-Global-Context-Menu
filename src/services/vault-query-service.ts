/**
 * VaultQueryService — Central vault file scanning and structured querying.
 *
 * Provides configurable, criteria-based querying of vault files. Designed to be consumed by GCM features and
 * exposed via GCM's inter-plugin API so that Controller / Notifier / Companion
 * can delegate their vault-scanning loops here instead of reimplementing them.
 *
 * Sync queries use the metadata cache and GCM's non-Markdown property records.
 * Async queries may also read markdown body text or `.canvas` JSON when a
 * content filter is requested.
 */
import { App, TFile, CachedMetadata } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { runInBatches } from '../core/operation-batch-utils';
import * as logger from '../logger';

// ─────────────────────────────────────────────────────────────────────────────
// Filter types
// ─────────────────────────────────────────────────────────────────────────────

/** Filter by vault folder path prefix. */
export interface FolderQueryFilter {
    /**
     * Only return files whose vault path starts with one of these prefixes.
     * A trailing "/" is added automatically if missing.
     */
    include?: string[];
    /**
     * Skip files whose vault path starts with one of these prefixes.
     * A trailing "/" is added automatically if missing.
     */
    exclude?: string[];
}

/** Filter by the normalized value of a status frontmatter property. */
export interface StatusQueryFilter {
    /**
     * Case-insensitive statuses to require.
     * A file is excluded unless its resolved status matches at least one entry.
     */
    include?: string[];
    /**
     * Case-insensitive statuses to reject.
     * A file is excluded if its resolved status matches any entry.
     */
    exclude?: string[];
    /** Frontmatter key used as the status field. Default: 'status'. */
    property?: string;
}

/** Filter by frontmatter / cache tags. */
export interface TagQueryFilter {
    /**
     * File must have at least one of these tags.
     * Leading "#" is stripped before comparison (case-insensitive).
     */
    include?: string[];
    /**
     * File must NOT have any of these tags.
     */
    exclude?: string[];
}

/** Supported comparison operators for a single frontmatter property. */
export type PropertyOperator =
    | 'exists'
    | 'missing'
    | 'equals'
    | 'not-equals'
    | 'contains'
    | 'starts-with'
    | 'ends-with';

/** Filter by a specific frontmatter property value. */
export interface PropertyQueryFilter {
    /** Frontmatter key to inspect. */
    key: string;
    /** Comparison operator. */
    operator: PropertyOperator;
    /**
     * Comparison value (not used for 'exists' / 'missing').
     * Converted to lowercase string before comparison.
     */
    value?: string | number | boolean;
}

/** Filter by a date/time frontmatter property within a Unix-ms range. */
export interface DateRangeQueryFilter {
    /** Frontmatter key whose value is read as a date/time string or Unix ms. */
    property: string;
    /** Inclusive start — only files where the property timestamp >= start. */
    start?: number;
    /** Inclusive end — only files where the property timestamp <= end. */
    end?: number;
}

export type CanvasNodeContentType = 'text' | 'file' | 'group' | 'link';

/** Filter by markdown body text or searchable content inside canvas nodes. */
export interface ContentQueryFilter {
    /**
     * Every value must be present in the markdown body or selected canvas nodes.
     * Matching is case-insensitive unless `caseSensitive` is true.
     */
    include?: string[];
    /** Reject files whose searchable body/node content contains any value. */
    exclude?: string[];
    /**
     * Restrict `.canvas` matching to these node types. Markdown files ignore this.
     * Canvas search inspects text.text, file.file/subpath, group.label, and link.url.
     */
    canvasNodeTypes?: CanvasNodeContentType[];
    /** Default: false. */
    caseSensitive?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Criteria + result types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Composite query criteria for `VaultQueryService`.
 * All specified filters must match (AND logic).
 */
export interface VaultQueryCriteria {
    /** Include `.canvas` files. Retained for backward compatibility. */
    includeCanvasFiles?: boolean;
    /** Include all non-Markdown property targets (`.canvas`, `.base`, PDFs, media, and other files). */
    includeNonMarkdownFiles?: boolean;
    folders?: FolderQueryFilter;
    statuses?: StatusQueryFilter;
    tags?: TagQueryFilter;
    /**
     * All entries must match.
     * Multiple entries use AND logic.
     */
    properties?: PropertyQueryFilter[];
    dateRange?: DateRangeQueryFilter;
    /**
     * Content filters require `queryAsync()` because markdown and canvas bodies
     * must be read from disk. Sync `query()`/`count()` intentionally return no
     * matches when this is supplied instead of returning stale false positives.
     */
    content?: ContentQueryFilter;
    /**
     * Maximum results to return (applied after filtering).
     * 0 or undefined means no limit.
     */
    limit?: number;
}

/** One matching vault file with its pre-fetched metadata. */
export interface QueryResult {
    file: TFile;
    /** Frontmatter record (empty object when file has no frontmatter). */
    frontmatter: Record<string, unknown>;
    /** Full cached metadata (may be null for files not yet indexed). */
    metadata: CachedMetadata | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class VaultQueryService {
    private readonly app: App;
    private readonly plugin: TPSGlobalContextMenuPlugin | null;

    constructor(appOrPlugin: App | TPSGlobalContextMenuPlugin) {
        const candidate = appOrPlugin as TPSGlobalContextMenuPlugin;
        this.plugin = candidate?.app instanceof App ? candidate : null;
        this.app = this.plugin?.app ?? appOrPlugin as App;
    }

    // ── Public query methods ─────────────────────────────────────────────────

    /**
     * Synchronously scan all vault markdown files and return matches.
     *
     * Uses only the metadata cache — suitable for real-time operations.
     * Yields to the event loop every 50 files when `async` behaviour is needed;
     * for large vaults prefer `queryAsync()`.
     */
    query(criteria: VaultQueryCriteria = {}): QueryResult[] {
        const files = this.getCandidateFiles(criteria);
        const results: QueryResult[] = [];
        const limit = criteria.limit ?? 0;

        for (const file of files) {
            if (limit > 0 && results.length >= limit) break;

            const match = this.evaluate(file, criteria);
            if (match) results.push(match);
        }

        logger.log(`[VaultQueryService] Metadata scan returned ${results.length} / ${files.length} matching files`);
        return results;
    }

    /**
     * Async batched variant — yields to the event loop between batches.
     * Prefer for background / startup scans in large vaults.
     */
    async queryAsync(criteria: VaultQueryCriteria = {}): Promise<QueryResult[]> {
        const files = this.getCandidateFiles(criteria);
        const results: QueryResult[] = [];
        const limit = criteria.limit ?? 0;
        await runInBatches(files, async (file) => {
            if (limit > 0 && results.length >= limit) return;
            const match = await this.evaluateAsync(file, criteria);
            if (match) results.push(match);
        });
        logger.log(`[VaultQueryService] Async metadata scan returned ${results.length} / ${files.length} matching files`);
        return results;
    }

    /**
     * Return the first match, or null. Stops scanning after the first hit.
     */
    queryOne(criteria: VaultQueryCriteria): QueryResult | null {
        const results = this.query({ ...criteria, limit: 1 });
        return results[0] ?? null;
    }

    /**
     * Count matching files without materialising the full result set.
     */
    count(criteria: VaultQueryCriteria = {}): number {
        const files = this.getCandidateFiles(criteria);
        let count = 0;
        for (const file of files) {
            if (this.evaluate(file, criteria)) count += 1;
        }
        return count;
    }

    /**
     * Look up a single file by its vault path and get its frontmatter.
     * Returns null if the file is not found.
     */
    getFile(path: string): QueryResult | null {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || !this.isQueryableFile(file)) return null;
        const metadata = this.app.metadataCache.getFileCache(file);
        const frontmatter = this.getFrontmatter(file, metadata);
        return { file, frontmatter, metadata };
    }

    async getFileAsync(path: string): Promise<QueryResult | null> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || !this.isQueryableFile(file)) return null;
        const metadata = this.app.metadataCache.getFileCache(file);
        const frontmatter = await this.getFrontmatterAsync(file, metadata);
        return { file, frontmatter, metadata };
    }

    // ── Core evaluator ───────────────────────────────────────────────────────

    private getCandidateFiles(
        criteria: Pick<VaultQueryCriteria, 'includeCanvasFiles' | 'includeNonMarkdownFiles'>,
    ): TFile[] {
        const includeAllNonMarkdown = criteria.includeNonMarkdownFiles === true;
        const includeCanvas = includeAllNonMarkdown || criteria.includeCanvasFiles === true;
        const candidates = includeCanvas ? this.app.vault.getFiles() : this.app.vault.getMarkdownFiles();
        return candidates.filter((file) => {
            if (this.plugin?.filePropertiesService?.isCompanionFile(file)) return false;
            const extension = file.extension?.toLowerCase();
            if (extension === 'md') return true;
            if (!includeCanvas) return false;
            if (!includeAllNonMarkdown) return extension === 'canvas';
            return this.plugin?.filePropertiesService?.isPropertyTarget(file) ?? true;
        });
    }

    private async evaluateAsync(file: TFile, criteria: VaultQueryCriteria): Promise<QueryResult | null> {
        const metadata = this.app.metadataCache.getFileCache(file);
        const fm = await this.getFrontmatterAsync(file, metadata);
        const result = this.evaluateWithFrontmatter(file, metadata, fm, criteria, { allowContentRead: true });
        if (!result) return null;
        if (criteria.content && !(await this.matchesContentFilterAsync(file, criteria.content))) return null;
        return result;
    }

    private evaluate(file: TFile, criteria: VaultQueryCriteria): QueryResult | null {
        const metadata = this.app.metadataCache.getFileCache(file);
        const fm = this.getFrontmatter(file, metadata);
        return this.evaluateWithFrontmatter(file, metadata, fm, criteria, { allowContentRead: false });
    }

    private evaluateWithFrontmatter(
        file: TFile,
        metadata: CachedMetadata | null,
        fm: Record<string, unknown>,
        criteria: VaultQueryCriteria,
        options: { allowContentRead: boolean },
    ): QueryResult | null {
        if (criteria.folders && !this.matchesFolderFilter(file.path, criteria.folders)) return null;
        if (criteria.statuses && !this.matchesStatusFilter(fm, criteria.statuses)) return null;
        const tagMetadata = file.extension?.toLowerCase() === 'md' ? metadata : null;
        if (criteria.tags && !this.matchesTagFilter(fm, tagMetadata, criteria.tags)) return null;

        if (criteria.properties) {
            for (const pf of criteria.properties) {
                if (!this.matchesPropertyFilter(fm, pf)) return null;
            }
        }

        if (criteria.dateRange && !this.matchesDateRangeFilter(fm, criteria.dateRange)) return null;
        if (criteria.content && !options.allowContentRead) return null;

        return { file, frontmatter: fm, metadata };
    }

    private async getFrontmatterAsync(file: TFile, metadata: CachedMetadata | null): Promise<Record<string, unknown>> {
        if (file.extension?.toLowerCase() !== 'md' && this.plugin?.filePropertiesService?.isPropertyTarget(file)) {
            return await this.plugin.filePropertiesService.getFrontmatterAsync(file);
        }
        return this.getFrontmatter(file, metadata);
    }

    private getFrontmatter(file: TFile, metadata: CachedMetadata | null): Record<string, unknown> {
        if (file.extension?.toLowerCase() !== 'md' && this.plugin?.filePropertiesService?.isPropertyTarget(file)) {
            return this.plugin.filePropertiesService.read(file);
        }
        return (metadata?.frontmatter as Record<string, unknown>) ?? {};
    }

    private isQueryableFile(file: TFile): boolean {
        if (this.plugin?.filePropertiesService?.isCompanionFile(file)) return false;
        if (file.extension?.toLowerCase() === 'md') return true;
        return this.plugin?.filePropertiesService?.isPropertyTarget(file) ?? true;
    }

    private async matchesContentFilterAsync(file: TFile, filter: ContentQueryFilter): Promise<boolean> {
        const haystack = await this.getSearchableContentAsync(file, filter);
        if (!haystack) return false;

        const normalize = (value: unknown) => {
            const text = String(value ?? '');
            return filter.caseSensitive ? text : text.toLowerCase();
        };
        const searchable = normalize(haystack);
        const includes = (filter.include || []).map(normalize).filter(Boolean);
        const excludes = (filter.exclude || []).map(normalize).filter(Boolean);

        if (includes.length > 0 && !includes.every((needle) => searchable.includes(needle))) return false;
        if (excludes.length > 0 && excludes.some((needle) => searchable.includes(needle))) return false;
        return true;
    }

    private async getSearchableContentAsync(file: TFile, filter: ContentQueryFilter): Promise<string> {
        const extension = file.extension?.toLowerCase();
        if (extension === 'canvas') return this.getSearchableCanvasNodeContentAsync(file, filter);
        if (extension === 'md') {
            try {
                const content = await this.app.vault.cachedRead(file);
                return stripMarkdownFrontmatter(content);
            } catch (error) {
                logger.warn('[VaultQueryService] Failed reading markdown content', { file: file.path, error });
                return '';
            }
        }
        return '';
    }

    private async getSearchableCanvasNodeContentAsync(file: TFile, filter: ContentQueryFilter): Promise<string> {
        try {
            const content = await this.app.vault.read(file);
            const parsed = JSON.parse(content || '{}');
            return getCanvasNodeSearchText(parsed, filter.canvasNodeTypes);
        } catch (error) {
            logger.warn('[VaultQueryService] Failed reading canvas node content', { file: file.path, error });
            return '';
        }
    }

    // ── Folder filter ────────────────────────────────────────────────────────

    private matchesFolderFilter(filePath: string, filter: FolderQueryFilter): boolean {
        const normalizePrefix = (p: string) => (p.endsWith('/') ? p : `${p}/`);

        if (filter.include && filter.include.length > 0) {
            const included = filter.include.some((prefix) => {
                const norm = normalizePrefix(prefix);
                return filePath.startsWith(norm) || filePath === prefix;
            });
            if (!included) return false;
        }

        if (filter.exclude && filter.exclude.length > 0) {
            const excluded = filter.exclude.some((prefix) => {
                const norm = normalizePrefix(prefix);
                return filePath.startsWith(norm) || filePath === prefix;
            });
            if (excluded) return false;
        }

        return true;
    }

    // ── Status filter ────────────────────────────────────────────────────────

    private matchesStatusFilter(
        fm: Record<string, unknown>,
        filter: StatusQueryFilter,
    ): boolean {
        const statuses = resolveStatuses(fm, filter.property ?? 'status');

        if (filter.include && filter.include.length > 0) {
            const normalized = filter.include.map(normalizeStatusValue);
            if (!statuses.some((s) => normalized.includes(s))) return false;
        }

        if (filter.exclude && filter.exclude.length > 0) {
            const normalized = filter.exclude.map(normalizeStatusValue);
            if (statuses.some((s) => normalized.includes(s))) return false;
        }

        return true;
    }

    // ── Tag filter ───────────────────────────────────────────────────────────

    private matchesTagFilter(
        fm: Record<string, unknown>,
        metadata: CachedMetadata | null,
        filter: TagQueryFilter,
    ): boolean {
        const tags = resolveTags(fm, metadata);
        const normalize = (t: string) => t.trim().replace(/^#/, '').toLowerCase();

        if (filter.include && filter.include.length > 0) {
            const normalized = filter.include.map(normalize);
            if (!tags.some((t) => normalized.includes(t))) return false;
        }

        if (filter.exclude && filter.exclude.length > 0) {
            const normalized = filter.exclude.map(normalize);
            if (tags.some((t) => normalized.includes(t))) return false;
        }

        return true;
    }

    // ── Property filter ──────────────────────────────────────────────────────

    private matchesPropertyFilter(
        fm: Record<string, unknown>,
        filter: PropertyQueryFilter,
    ): boolean {
        const raw = fm[filter.key];
        const str = String(raw ?? '').trim().toLowerCase();
        const compareStr = String(filter.value ?? '').trim().toLowerCase();

        switch (filter.operator) {
            case 'exists':      return raw != null && str !== '';
            case 'missing':     return raw == null || str === '';
            case 'equals':      return str === compareStr;
            case 'not-equals':  return str !== compareStr;
            case 'contains':    return str.includes(compareStr);
            case 'starts-with': return str.startsWith(compareStr);
            case 'ends-with':   return str.endsWith(compareStr);
            default:            return true;
        }
    }

    // ── Date-range filter ────────────────────────────────────────────────────

    private matchesDateRangeFilter(
        fm: Record<string, unknown>,
        filter: DateRangeQueryFilter,
    ): boolean {
        const raw = fm[filter.property];
        if (raw == null) return false;

        const ts = parseTimestampValue(raw);
        if (ts == null) return false;

        if (filter.start != null && ts < filter.start) return false;
        if (filter.end != null && ts > filter.end) return false;

        return true;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared pure utility functions (exported for use elsewhere in GCM)
// ─────────────────────────────────────────────────────────────────────────────

/** Normalize a status value: trim + lowercase. */
function normalizeStatusValue(raw: unknown): string {
    return String(raw ?? '').trim().toLowerCase();
}

/** Resolve all status strings from a frontmatter record. */
function resolveStatuses(fm: Record<string, unknown>, property = 'status'): string[] {
    const raw = fm[property];
    if (raw == null) return [];
    if (Array.isArray(raw)) return raw.map(normalizeStatusValue).filter(Boolean);
    const single = normalizeStatusValue(raw);
    return single ? [single] : [];
}

/** Collect all tags: prefer metadata cache (handles inline tags), fall back to frontmatter. */
function resolveTags(fm: Record<string, unknown>, metadata: CachedMetadata | null): string[] {
    const cacheTags =
        metadata?.tags?.map((t) => t.tag.replace(/^#/, '').toLowerCase()) ?? [];
    if (cacheTags.length > 0) return cacheTags;

    const raw = fm['tags'];
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : String(raw).split(',');
    return arr.map((t) => String(t).trim().replace(/^#/, '').toLowerCase()).filter(Boolean);
}

/**
 * Parse a frontmatter value into a Unix-millisecond timestamp.
 * Accepts ISO date strings, datetime strings, and plain numeric ms values.
 * Returns null if the value cannot be parsed.
 */
export function parseTimestampValue(value: unknown): number | null {
    if (value == null) return null;
    const str = String(value).trim();
    if (!str) return null;

    // Already a numeric timestamp
    const asNum = Number(str);
    if (Number.isFinite(asNum) && asNum > 0) return asNum;

    // Date/datetime string (ISO 8601, "YYYY-MM-DD HH:mm", etc.)
    const ms = Date.parse(str);
    return isNaN(ms) ? null : ms;
}

export function stripMarkdownFrontmatter(content: string): string {
    const normalized = String(content || '').replace(/\r\n/g, '\n');
    if (!normalized.startsWith('---\n')) return normalized;
    const closingMarker = normalized.indexOf('\n---\n', 4);
    const closingMarkerAtEnd = normalized.endsWith('\n---') ? normalized.length - 4 : -1;
    const closingIndex = closingMarker >= 0 ? closingMarker : closingMarkerAtEnd;
    if (closingIndex < 0) return normalized;
    return closingMarker >= 0 ? normalized.slice(closingIndex + 5) : '';
}

export function getCanvasNodeSearchText(
    document: unknown,
    nodeTypes?: CanvasNodeContentType[],
): string {
    if (!document || typeof document !== 'object' || Array.isArray(document)) return '';
    const nodes = (document as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodes)) return '';

    const allowedTypes = new Set((nodeTypes || []).map((type) => String(type).toLowerCase()));
    const values: string[] = [];
    for (const node of nodes) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
        const record = node as Record<string, unknown>;
        const type = String(record.type || '').toLowerCase();
        if (allowedTypes.size > 0 && !allowedTypes.has(type as CanvasNodeContentType)) continue;

        if (type === 'text') {
            pushStringValue(values, record.text);
        } else if (type === 'file') {
            pushStringValue(values, record.file);
            pushStringValue(values, record.subpath);
        } else if (type === 'group') {
            pushStringValue(values, record.label);
        } else if (type === 'link') {
            pushStringValue(values, record.url);
        }
    }
    return values.join('\n');
}

function pushStringValue(values: string[], value: unknown): void {
    const text = String(value ?? '').trim();
    if (text) values.push(text);
}
