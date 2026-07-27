import { Notice, normalizePath, TFile, type WorkspaceLeaf } from 'obsidian';
import type TPSGlobalContextMenuPlugin from './main';
import type { VaultQueryService } from './services/vault-query-service';
import type { BodySubitemLink, ResolvedParentLink } from './services/subitem-types';
import { createSubitemForParentWithTitle, getDefaultSubitemFolderPath } from './services/subitem-creation-service';
import { mergeNormalizedTags, parseTagInput } from './utils/tag-utils';
import { executeCommandById, getInternalPlugin, getPluginById, hasCommand } from './core';
import { mapSubitemCheckboxStateToStatus } from './utils/linked-subitem-mapping';
import { TPS_EVENTS, TPS_LEGACY_EVENTS } from './tps-contracts';
import { findExistingDailyNoteForIsoDate, getDailyNotePathForIsoDate } from './utils/daily-note-task-schedule';

type ChecklistTaskState = string;

export interface ChecklistPromotionInput {
    lineNumber: number;
    rawLine?: string;
    text?: string;
}

type ChecklistPromotionMetadata = {
    title: string;
    tags: string[];
    scheduled: string | null;
};

type PromotedChecklistBlock = {
    startLine: number;
    endLineExclusive: number;
    body: string;
};

function parseChecklistLine(line: string): { prefix: string; state: ChecklistTaskState; text: string } | null {
    const match = line.match(/^(\s*(?:[-*+]|\d+\.)\s*)\[([^\]\r\n]?)\]\s*(.*)$/);
    if (!match) return null;
    return {
        prefix: match[1],
        state: match[2] as ChecklistTaskState,
        text: match[3] || '',
    };
}

function resolvePromotionStatusFromSource(
    plugin: TPSGlobalContextMenuPlugin,
    state: ChecklistTaskState,
    behavior: 'remove' | 'complete-and-link' | 'link-only',
): string | null {
    if (behavior === 'complete-and-link') return 'complete';
    const normalizedState = `[${String(state || ' ').trim()}]`;
    const mapped = mapSubitemCheckboxStateToStatus(plugin.settings.linkedSubitemCheckboxMappings || [], normalizedState);
    if (mapped) return mapped;
    return plugin.sharedServices.status.checkboxStateToStatus(normalizedState) || null;
}

function normalizeChecklistText(text: string): string {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function resolveChecklistLineIndex(lines: string[], item: Required<ChecklistPromotionInput>): number {
    const direct = lines[item.lineNumber];
    if (typeof direct === 'string' && direct === item.rawLine) {
        return item.lineNumber;
    }

    const normalizedTarget = normalizeChecklistText(item.text);
    if (!normalizedTarget) return -1;

    for (let i = 0; i < lines.length; i += 1) {
        const parsed = parseChecklistLine(lines[i]);
        if (!parsed) continue;
        if (normalizeChecklistText(parsed.text) === normalizedTarget) return i;
    }

    return -1;
}

function indentWidth(indent: string): number {
    let width = 0;
    for (const ch of indent) width += ch === '\t' ? 4 : 1;
    return width;
}

function findNextNonBlankLine(lines: string[], start: number): number {
    for (let i = start; i < lines.length; i += 1) {
        if ((lines[i] || '').trim()) return i;
    }
    return -1;
}

function removeIndentWidth(line: string, width: number): string {
    let remaining = width;
    let index = 0;
    while (index < line.length && remaining > 0) {
        const ch = line[index];
        if (ch === ' ') {
            remaining -= 1;
            index += 1;
            continue;
        }
        if (ch === '\t') {
            remaining -= 4;
            index += 1;
            continue;
        }
        break;
    }
    return line.slice(index);
}

function escapeRegExp(value: string): string {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimPromotedBody(body: string): string {
    const lines = String(body || '').split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.join('\n');
}

function getPromotedChecklistBlock(lines: string[], lineNumber: number): PromotedChecklistBlock {
    const rawLine = lines[lineNumber] || '';
    const baseIndent = indentWidth(rawLine.match(/^[ \t]*/)?.[0] ?? '');
    let end = lineNumber + 1;

    while (end < lines.length) {
        const line = lines[end] ?? '';
        if (!line.trim()) {
            const nextNonBlank = findNextNonBlankLine(lines, end + 1);
            if (nextNonBlank < 0) {
                end += 1;
                break;
            }
            if (indentWidth(lines[nextNonBlank].match(/^[ \t]*/)?.[0] ?? '') > baseIndent) {
                end += 1;
                continue;
            }
            break;
        }

        const indent = indentWidth(line.match(/^[ \t]*/)?.[0] ?? '');
        if (indent <= baseIndent) break;
        end += 1;
    }

    const outdentBy = baseIndent + 2;
    const body = lines
        .slice(lineNumber + 1, end)
        .map((line) => removeIndentWidth(line, outdentBy))
        .join('\n');

    return {
        startLine: lineNumber,
        endLineExclusive: end,
        body: trimPromotedBody(body),
    };
}

async function appendPromotedBodyToChild(plugin: TPSGlobalContextMenuPlugin, childFile: TFile, body: string): Promise<void> {
    const trimmedBody = trimPromotedBody(body);
    if (!trimmedBody) return;
    const current = await plugin.app.vault.read(childFile);
    const separator = current.endsWith('\n') ? '' : '\n';
    await plugin.app.vault.modify(childFile, `${current}${separator}${trimmedBody}\n`);
}

function getChecklistPromotionTitle(rawText: string): string {
    const source = String(rawText || '');
    if (!source.trim()) return '';
    if (/^\s*\[\[+\s*$/.test(source)) return '';

    const withoutCalendarMetadata = source
        .replace(/\s*(?:<!--\s*tps-calendar\s+[\s\S]*?-->|\s*%%\s*tps-calendar\s+[\s\S]*?%%)/gi, '')
        .replace(/@@\{[^}]*\}/g, '')
        .replace(/@\{[^}]*\}/g, '')
        .replace(/[\[(][a-zA-Z0-9_-]+::\s*[^\]\)]+[\]\)]/g, '');
    const withoutWiki = withoutCalendarMetadata.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, alias) => {
        const preferred = String(alias || target || '').trim();
        return preferred || '';
    });
    const withoutMarkdownLinks = withoutWiki.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
    return withoutMarkdownLinks
        .replace(/`([^`]*)`/g, '$1')
        .replace(/[*_~]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getPromotionParentDate(plugin: TPSGlobalContextMenuPlugin, rootFile: TFile): string | null {
    const moment = (window as any).moment;
    const scheduled = plugin.app.metadataCache.getFileCache(rootFile)?.frontmatter?.scheduled;
    if (scheduled) {
        const parsedScheduled = moment(scheduled);
        if (parsedScheduled?.isValid?.() && parsedScheduled.isValid()) return parsedScheduled.format('YYYY-MM-DD 00:00:00');
    }
    if (plugin.fileNamingService.isDateOnlyBasename(rootFile.basename)) {
        const parsedName = moment(rootFile.basename, [
            plugin.fileNamingService.getDailyNoteDateFormat(),
            'YYYY-MM-DD',
            'YYYY_MM_DD',
            'YYYYMMDD',
            'dddd, MMMM Do YYYY',
            'MMMM D, YYYY',
            'MMM D, YYYY',
        ], true);
        if (parsedName?.isValid?.() && parsedName.isValid()) return parsedName.format('YYYY-MM-DD 00:00:00');
    }
    return null;
}

function extractChecklistPromotionScheduled(plugin: TPSGlobalContextMenuPlugin, rootFile: TFile, text: string): string | null {
    const moment = (window as any).moment;
    const candidates: string[] = [];
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    if (!source || !moment) return null;

    const dateTimePattern = /\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat),?\s+[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+\d{4}(?:\s+(?:at\s+)?\d{1,2}(?::|\.)\d{2}\s*(?:am|pm)?)?/gi;
    const dateOnlyPattern = /\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat),?\s+[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+\d{4}\b/gi;
    const isoPattern = /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}(?::|\.)\d{2}(?::\d{2})?\s*(?:am|pm)?)?\b/gi;
    const timeOnlyPattern = /\b(?:at\s+)?(\d{1,2})(?::|\.)(\d{2})\s*(am|pm)?\b/i;

    for (const match of source.matchAll(dateTimePattern)) candidates.push(match[0]);
    for (const match of source.matchAll(isoPattern)) candidates.push(match[0]);
    for (const match of source.matchAll(dateOnlyPattern)) candidates.push(match[0]);

    const parseFormats = [
        'ddd, MMM D YYYY h:mma',
        'ddd, MMM D, YYYY h:mma',
        'ddd, MMM D YYYY h.mm a',
        'ddd, MMM D YYYY h.mma',
        'ddd, MMM D, YYYY h.mma',
        'ddd MMM D YYYY h:mma',
        'ddd MMM D YYYY h.mma',
        'dddd, MMMM D YYYY h:mma',
        'dddd, MMMM D, YYYY h:mma',
        'dddd, MMMM D YYYY h.mma',
        'dddd, MMMM D, YYYY h.mma',
        'ddd, MMM D YYYY',
        'ddd, MMM D, YYYY',
        'ddd MMM D YYYY',
        'dddd, MMMM D YYYY',
        'dddd, MMMM D, YYYY',
        'YYYY-MM-DD HH:mm:ss',
        'YYYY-MM-DD HH:mm',
        'YYYY-MM-DDTHH:mm:ss',
        'YYYY-MM-DD',
    ];

    for (const candidate of candidates) {
        const normalized = candidate.replace(/\bat\s+/i, '').replace(/\s+/g, ' ').trim();
        const parsed = moment(normalized, [moment.ISO_8601, ...parseFormats], true);
        if (parsed?.isValid?.() && parsed.isValid()) return parsed.format('YYYY-MM-DD HH:mm:ss');
    }

    const parentDate = getPromotionParentDate(plugin, rootFile);
    const timeMatch = source.match(timeOnlyPattern);
    if (parentDate && timeMatch) {
        const parsed = moment(`${parentDate} ${timeMatch[1]}:${timeMatch[2]}${timeMatch[3] || ''}`, ['YYYY-MM-DD h:mma', 'YYYY-MM-DD H:mm'], true);
        if (parsed?.isValid?.() && parsed.isValid()) return parsed.format('YYYY-MM-DD HH:mm:ss');
    }

    return parentDate;
}

function stripScheduledPhraseFromPromotionTitle(title: string, scheduled: string): string {
    const moment = (window as any).moment;
    const parsed = moment(scheduled);
    if (!parsed?.isValid?.() || !parsed.isValid()) return title;
    const phrases = [
        parsed.format('ddd, MMM D YYYY h:mma'),
        parsed.format('ddd, MMM D, YYYY h:mma'),
        parsed.format('ddd, MMM D YYYY h.mma'),
        parsed.format('ddd, MMM D, YYYY h.mma'),
        parsed.format('ddd, MMM D YYYY'),
        parsed.format('ddd, MMM D, YYYY'),
        parsed.format('dddd, MMMM D YYYY h:mma'),
        parsed.format('dddd, MMMM D, YYYY h:mma'),
        parsed.format('dddd, MMMM D YYYY h.mma'),
        parsed.format('dddd, MMMM D, YYYY h.mma'),
        parsed.format('dddd, MMMM D YYYY'),
        parsed.format('dddd, MMMM D, YYYY'),
        parsed.format('YYYY-MM-DD HH:mm:ss'),
        parsed.format('YYYY-MM-DD HH:mm'),
        parsed.format('YYYY-MM-DD'),
        parsed.format('h:mma'),
        parsed.format('h.mma'),
    ];
    let next = title;
    for (const phrase of phrases) {
        if (!phrase) continue;
        next = next.replace(new RegExp(`\\s*${escapeRegExp(phrase)}\\s*`, 'ig'), ' ');
    }
    return next.replace(/\s+/g, ' ').trim();
}

function extractChecklistPromotionMetadata(
    plugin: TPSGlobalContextMenuPlugin,
    rootFile: TFile,
    rawText: string,
): ChecklistPromotionMetadata {
    const text = getChecklistPromotionTitle(rawText);
    const tags = parseTagInput(text);
    const scheduled = extractChecklistPromotionScheduled(plugin, rootFile, text);
    let title = text
        .replace(/(^|\s)#[a-zA-Z0-9_/-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (scheduled) title = stripScheduledPhraseFromPromotionTitle(title, scheduled);

    return {
        title: title.replace(/\s+/g, ' ').trim(),
        tags,
        scheduled,
    };
}

async function applyChecklistPromotionMetadata(
    plugin: TPSGlobalContextMenuPlugin,
    created: TFile,
    promotion: ChecklistPromotionMetadata,
): Promise<void> {
    if (!promotion.scheduled && promotion.tags.length === 0) return;
    await plugin.bulkEditService.runSerializedFrontmatterWrite(created, async () => {
        await plugin.app.fileManager.processFrontMatter(created, (frontmatter) => {
            if (promotion.scheduled) frontmatter.scheduled = promotion.scheduled;
            if (promotion.tags.length > 0) frontmatter.tags = mergeNormalizedTags(frontmatter.tags, promotion.tags);
        });
    });
}

export async function promoteChecklistItemToChild(
    plugin: TPSGlobalContextMenuPlugin,
    rootFile: TFile,
    input: ChecklistPromotionInput,
): Promise<TFile | null> {
    const content = await plugin.app.vault.cachedRead(rootFile);
    const lines = content.split('\n');
    const rawLine = input.rawLine ?? lines[input.lineNumber] ?? '';
    const parsed = parseChecklistLine(rawLine);
    const text = String(input.text ?? parsed?.text ?? '').trim();
    const item = {
        lineNumber: input.lineNumber,
        rawLine,
        text,
    };

    const promotion = extractChecklistPromotionMetadata(plugin, rootFile, text);
    if (!promotion.title) {
        new Notice('Checklist item title is empty.');
        return null;
    }

    const created = await createSubitemForParentWithTitle(
        plugin,
        rootFile,
        promotion.title,
        getDefaultSubitemFolderPath(plugin, rootFile),
        {
            seedParentTags: true,
            seedVisualMetadata: false,
            insertParentBodyLink: false,
        },
    );
    if (!created) return null;

    await applyChecklistPromotionMetadata(plugin, created, promotion);

    const promotedLineIndex = resolveChecklistLineIndex(lines, {
        lineNumber: item.lineNumber,
        rawLine: item.rawLine,
        text: item.text,
    });
    const promotedBlock = promotedLineIndex >= 0
        ? getPromotedChecklistBlock(lines, promotedLineIndex)
        : { startLine: item.lineNumber, endLineExclusive: item.lineNumber + 1, body: '' };
    await appendPromotedBodyToChild(plugin, created, promotedBlock.body);

    const behavior = plugin.settings.checklistPromotionBehavior ?? 'remove';
    const linkPath = normalizePath(created.path.replace(/\.md$/i, ''));
    const wikilink = `[[${linkPath}|${text || created.basename}]]`;

    await plugin.subitemRelationshipSyncService.mutateMarkdownBody(rootFile, async (currentLines) => {
        const currentLineIndex = resolveChecklistLineIndex(currentLines, item);
        if (currentLineIndex < 0 || currentLineIndex >= currentLines.length) return false;
        const currentParsed = parseChecklistLine(currentLines[currentLineIndex]);
        if (!currentParsed) return false;

        const derivedStatus = resolvePromotionStatusFromSource(plugin, currentParsed.state, behavior);
        if (derivedStatus) {
            await plugin.sharedServices.status.setFileStatus(created, derivedStatus);
        }

        const currentBlock = getPromotedChecklistBlock(currentLines, currentLineIndex);

        if (behavior === 'link-only' || behavior === 'complete-and-link') {
            const nextLine = `${currentParsed.prefix}${wikilink}`;
            const hasNestedLines = currentBlock.endLineExclusive > currentLineIndex + 1;
            if ((currentLines[currentLineIndex] || '') === nextLine && !hasNestedLines) return false;
            currentLines[currentLineIndex] = nextLine;
            if (hasNestedLines) {
                currentLines.splice(currentLineIndex + 1, currentBlock.endLineExclusive - currentLineIndex - 1);
            }
            return true;
        }

        currentLines.splice(currentBlock.startLine, currentBlock.endLineExclusive - currentBlock.startLine);
        return true;
    });

    return created;
}

/**
 * Attaches the inter-plugin API object to the plugin instance as `plugin.api`.
 * Extracted from `onload` to keep main.ts concise.
 */
export function setupPluginApi(plugin: TPSGlobalContextMenuPlugin): void {
    const services = plugin.sharedServices;
    const eventsApi = {
        emitFilesUpdated: (paths: unknown, options?: { sourcePluginId?: string }) => {
            return plugin.eventService.emitFilesUpdated(paths, options);
        },
        onFilesUpdated: (callback: (paths: string[], payload: Record<string, unknown>) => void) => {
            return plugin.eventService.onFilesUpdated(callback);
        },
        emitExplicitAction: (paths: unknown, options?: { sourcePluginId?: string; source?: string }) => {
            return plugin.eventService.emitExplicitAction(paths, options);
        },
        onExplicitAction: (callback: (paths: string[], payload: Record<string, unknown>) => void) => {
            return plugin.eventService.onExplicitAction(callback);
        },
        emitCalendarRefresh: (paths: unknown, options?: { sourcePluginId?: string }) => {
            return plugin.eventService.emitCalendarRefresh(paths, options);
        },
        onCalendarRefresh: (callback: (paths: string[], payload: Record<string, unknown>) => void) => {
            return plugin.eventService.onCalendarRefresh(callback);
        },
        emitCalendarSettingsChanged: (options?: { sourcePluginId?: string }) => {
            return plugin.eventService.emitCalendarSettingsChanged(options);
        },
    };
    const frontmatterApi = {
        process: (
            file: TFile,
            mutator: (frontmatter: Record<string, unknown>) => void | Promise<void>,
        ) => plugin.frontmatterMutationService.process(file, mutator),
        setValues: (
            files: TFile[],
            updates: Record<string, unknown>,
        ) => plugin.frontmatterMutationService.updateValues(files, updates),
        setListValues: (
            files: TFile[],
            key: string,
            values: unknown[],
        ) => plugin.frontmatterMutationService.setListValues(files, key, values),
        addListValues: (
            files: TFile[],
            key: string,
            values: unknown[],
        ) => plugin.frontmatterMutationService.addValuesToList(files, key, values),
        removeListValues: (
            files: TFile[],
            key: string,
            values: unknown[],
        ) => plugin.frontmatterMutationService.removeValuesFromList(files, key, values),
        setDateValue: (
            files: TFile[],
            key: string,
            value: string | null,
        ) => plugin.frontmatterMutationService.setDateValue(files, key, value),
        deleteKeys: (
            files: TFile[],
            keys: string[],
        ) => plugin.frontmatterMutationService.deleteKeys(files, keys),
    };
    const canvasPropertiesApi = {
        read: (file: TFile) => plugin.canvasPropertiesService.read(file),
        process: (
            file: TFile,
            mutator: (frontmatter: Record<string, unknown>) => void | Promise<void>,
        ) => plugin.canvasPropertiesService.process(file, mutator),
        setValues: (
            files: TFile[],
            updates: Record<string, unknown>,
        ) => plugin.canvasPropertiesService.updateValues(files, updates),
        setListValues: (
            files: TFile[],
            key: string,
            values: unknown[],
        ) => plugin.canvasPropertiesService.setListValues(files, key, values),
        addListValues: (
            files: TFile[],
            key: string,
            values: unknown[],
        ) => plugin.canvasPropertiesService.addValuesToList(files, key, values),
        removeListValues: (
            files: TFile[],
            key: string,
            values: unknown[],
        ) => plugin.canvasPropertiesService.removeValuesFromList(files, key, values),
        deleteKeys: (
            files: TFile[],
            keys: string[],
        ) => plugin.canvasPropertiesService.deleteKeys(files, keys),
    };

    (plugin as any).api = {
        // ── Shared services ──────────────────────────────────────────────────
        services,
        contracts: {
            version: 1,
            TPS_EVENTS,
            TPS_LEGACY_EVENTS,
        },
        events: eventsApi,
        registry: {
            getPluginById: (pluginId: string) => getPluginById(plugin.app, pluginId),
            isPluginEnabled: (pluginId: string): boolean => {
                const appPlugins = (plugin.app as any)?.plugins;
                try {
                    if (typeof appPlugins?.enabledPlugins?.has === 'function') return appPlugins.enabledPlugins.has(pluginId);
                    if (Array.isArray(appPlugins?.enabledPlugins)) return appPlugins.enabledPlugins.includes(pluginId);
                    return Boolean(appPlugins?.plugins?.[pluginId]);
                } catch {
                    return false;
                }
            },
            getInternalPlugin: (pluginId: string) => getInternalPlugin(plugin.app, pluginId),
            hasCommand: (commandId: string) => hasCommand(plugin.app, commandId),
            executeCommandById: (commandId: string) => executeCommandById(plugin.app, commandId),
        },
        entityIndex: {
            version: 2,
            query: (criteria: Parameters<typeof plugin.entityIndexService.query>[0]) =>
                plugin.entityIndexService.query(criteria),
            queryAsync: (criteria: Parameters<typeof plugin.entityIndexService.queryAsync>[0]) =>
                plugin.entityIndexService.queryAsync(criteria),
            ensureReady: () => plugin.entityIndexService.ensureReady(),
            getById: (id: string) => plugin.entityIndexService.getById(id),
            getByPath: (path: string) => plugin.entityIndexService.getByPath(path),
            getByLocator: (
                locator: Parameters<typeof plugin.entityIndexService.getByLocator>[0],
            ) => plugin.entityIndexService.getByLocator(locator),
            getByReferenceTarget: (target: string) =>
                plugin.entityIndexService.getByReferenceTarget(target),
            getBySourcePath: (path: string) =>
                plugin.entityIndexService.getBySourcePath(path),
            materializeReference: (
                entityOrId: Parameters<typeof plugin.entityIndexService.materializeReference>[0],
            ) => plugin.entityIndexService.materializeReference(entityOrId),
            getDimensionValues: (dimension: string) =>
                plugin.entityIndexService.getDimensionValues(dimension),
            getRevision: () => plugin.entityIndexService.getRevision(),
            onChanged: (callback: Parameters<typeof plugin.entityIndexService.onChanged>[0]) =>
                plugin.entityIndexService.onChanged(callback),
            registerDimension: (
                definition: Parameters<typeof plugin.entityIndexService.registerDimension>[0],
            ) => plugin.entityIndexService.registerDimension(definition),
            invalidate: (paths?: string[]) => plugin.entityIndexService.invalidate(paths),
        },
        overlays: {
            version: 1,
            invalidate: (request: any) => plugin.overlayRenderingService.invalidate(request),
            scheduleMenus: (reason = 'api', delayMs?: number) =>
                plugin.overlayRenderingService.scheduleMenus(reason, delayMs),
            scheduleFileRefresh: (file: TFile, reason = 'api', options?: Record<string, unknown>) =>
                plugin.overlayRenderingService.scheduleFileRefresh(file, reason, {
                    force: options?.force === true,
                    rebuildInlineSubitems: options?.rebuildInlineSubitems === true,
                    ensureMenus: options?.ensureMenus === true,
                    delayMs: typeof options?.delayMs === 'number' ? options.delayMs : undefined,
                }),
            scheduleSubitemRefresh: (file: TFile, reason = 'api', options?: Record<string, unknown>) =>
                plugin.overlayRenderingService.scheduleSubitemRefresh(file, reason, {
                    refreshLivePreviewEditors: options?.refreshLivePreviewEditors !== false,
                    delayMs: typeof options?.delayMs === 'number' ? options.delayMs : undefined,
                }),
            scheduleDailyNavRefresh: (reason = 'api', delayMs?: number) =>
                plugin.overlayRenderingService.scheduleDailyNavRefresh(reason, delayMs),
            flushNow: (reason = 'api') => plugin.overlayRenderingService.flushNow(reason),
        },
        externalActions: {
            version: 1,
            register: (action: any) => plugin.registerExternalAction(action),
        },
        homeActions: {
            version: 1,
            register: (commandId: string, handler: any) => plugin.homeComponentActionService.register(commandId, handler),
            canExecute: (action: any) => plugin.homeComponentActionService.canExecute(action),
            execute: (action: any, context: any) => plugin.homeComponentActionService.execute(action, context),
        },
        dailyNotes: {
            version: 1,
            findForIsoDate: (isoDate: string) => findExistingDailyNoteForIsoDate(plugin.app, plugin.settings, isoDate),
            pathForIsoDate: (isoDate: string) => getDailyNotePathForIsoDate(plugin.app, plugin.settings, isoDate),
            ensureForIsoDate: (isoDate: string) => plugin.noteOperationService.ensureDailyNote(`${isoDate} 00:00:00`),
        },
        openFileInLeaf: (
            file: TFile,
            context: 'tab' | 'split' | 'window' | false,
            getLeaf: () => WorkspaceLeaf | null,
            options?: {
                revealLeaf?: boolean;
                active?: boolean;
                ignoreCanvasDragGuard?: boolean;
                reuseLeafIfNoExisting?: boolean;
            },
        ) => plugin.openFileInLeaf(file, context, getLeaf, options),
        status: services.status,
        schedule: services.schedule,
        identity: plugin.identityService,
        identityMigration: plugin.identityMigrationService,
        cardContent: plugin.cardContentService,
        timeTracking: plugin.timeTrackingService,
        tasks: plugin.taskApiService,
        ui: {
            shouldForceBaseLinkPreview: () => plugin.settings.enableBasesForcedLinkPreview === true,
        },
        diagnostics: {
            version: 1,
            getOpenerDecision: (targetPath?: string | null) => plugin.getOpenerDiagnostic(targetPath),
        },
        completedCheckboxes: {
            revealForFile: (filePath: string, lineNumber?: number) =>
                plugin.hideCompletedCheckboxesService?.revealCompletedForFile(filePath, lineNumber),
        },

        // ── Vault querying ────────────────────────────────────────────────────
        /** Synchronously query vault files by structured criteria. */
        queryFiles: (criteria: Parameters<VaultQueryService['query']>[0]) =>
            plugin.vaultQueryService.query(criteria),
        /** Async batched vault query — yields to event loop between batches. */
        queryFilesAsync: (criteria: Parameters<VaultQueryService['queryAsync']>[0]) =>
            plugin.vaultQueryService.queryAsync(criteria),
        /** Return the first matching file, or null. */
        queryOneFile: (criteria: Parameters<VaultQueryService['queryOne']>[0]) =>
            plugin.vaultQueryService.queryOne(criteria),
        /** Count matching files without building a result set. */
        countFiles: (criteria: Parameters<VaultQueryService['count']>[0]) =>
            plugin.vaultQueryService.count(criteria),
        /** Resolve a single file by vault path with pre-fetched frontmatter. */
        getFile: (path: string) =>
            plugin.vaultQueryService.getFile(path),
        /** Async file lookup. Reads canvas properties through Advanced Canvas metadata compatibility. */
        getFileAsync: (path: string) =>
            plugin.vaultQueryService.getFileAsync(path),

        /** Normalize a raw status value to lowercase-trimmed form. */
        normalizeStatus: (raw: unknown) => services.status.normalize(raw),
        /** Extract all normalized status strings from a frontmatter record. */
        getStatuses: (fm: Record<string, unknown>, property?: string) =>
            services.status.getStatuses(fm, property),
        /** True if a value represents an all-day (date-only) event. */
        isAllDayValue: (value: unknown, fm?: Record<string, unknown>) =>
            services.schedule.isAllDayValue(value, fm),
        /** Cycle status through GCM-owned status options, then apply NN visual/sort/tag rules. */
        cycleFileStatus: async (file: TFile) => {
            if (!plugin.notebookNavigatorRuleService.canApplyToFile(file)) return false;
            const statusKey = services.status.getStatusPropertyKey();
            const cache = plugin.app.metadataCache.getFileCache(file);
            const fm = (cache?.frontmatter || {}) as Record<string, unknown>;
            const raw = services.frontmatter.findKey(fm, statusKey)
                ? fm[services.frontmatter.findKey(fm, statusKey)!]
                : undefined;
            const current = services.status.normalize(raw);
            const options = services.status.getStatusOptions();
            const normalizedOptions = options.map((option) => services.status.normalize(option));
            const index = normalizedOptions.indexOf(current);
            const next = options[index >= 0 ? (index + 1) % options.length : 0] || 'todo';
            const changed = await services.status.setFileStatus(file, next);
            await plugin.notebookNavigatorRuleService.applyRulesToFile(file, {
                reason: 'gcm-status-cycle',
                force: true,
                bypassCreationGrace: true,
            });
            return changed;
        },

        // ── Frontmatter mutations ─────────────────────────────────────────────
        /** Bulk-update frontmatter on one or more files. */
        updateFrontmatter: (
            files: TFile[],
            updates: Record<string, unknown>,
        ) => plugin.bulkEditService.updateFrontmatter(files, updates),
        /** Canonical frontmatter mutation entrypoint with sorting/repair. */
        processFrontmatter: frontmatterApi.process,
        /** Replace one or more scalar/list values by key. */
        setFrontmatterValues: frontmatterApi.setValues,
        /** Replace an entire list field. */
        setFrontmatterListValues: frontmatterApi.setListValues,
        /** Append values to a list field without duplicating entries. */
        addFrontmatterListValues: frontmatterApi.addListValues,
        /** Remove values from a list field. */
        removeFrontmatterListValues: frontmatterApi.removeListValues,
        /** Set or clear a date/datetime field. */
        setFrontmatterDateValue: frontmatterApi.setDateValue,
        /** Delete one or more frontmatter keys. */
        deleteFrontmatterKeys: frontmatterApi.deleteKeys,
        /** Structured frontmatter API for other TPS plugins. */
        frontmatter: frontmatterApi,
        /** Canvas properties bridge backed by Advanced Canvas metadata compatibility. */
        canvasProperties: canvasPropertiesApi,
        /** Create `.canvas` files from markdown notes, preserving source notes and copying note frontmatter into canvas metadata. */
        convertNotesToCanvases: (files: TFile[], options?: { outputFolder?: string; openCreated?: boolean }) =>
            plugin.noteOperationService.convertNotesToCanvases(files, options),
        /** Create a single `.canvas` file from a markdown note. */
        createCanvasFromNote: (file: TFile, options?: { outputFolder?: string; openCreated?: boolean }) =>
            plugin.noteOperationService.createCanvasFromNote(file, options),
        scanBodySubitemLinks: (file: TFile): Promise<BodySubitemLink[]> =>
            plugin.bodySubitemLinkService.scanFile(file),
        reconcileMarkdownParentSubitems: (file: TFile) =>
            plugin.subitemRelationshipSyncService.reconcileMarkdownParent(file),
        addParentToChild: (child: TFile, parent: TFile) =>
            plugin.parentLinkResolutionService.addParentToChild(child, parent),
        removeParentFromChild: (child: TFile, parent: TFile) =>
            plugin.parentLinkResolutionService.removeParentFromChild(child, parent),
        getParentsForChild: (child: TFile): ResolvedParentLink[] =>
            plugin.parentLinkResolutionService.getParentsForChild(child),
        isBodyLinkedSubitem: (parent: TFile, child: TFile) =>
            plugin.bodySubitemLinkService.isBodyLinkedSubitem(parent, child),
        refreshLinkedSubitemReferences: (child: TFile) =>
            plugin.linkedSubitemCheckboxService.refreshReferencesForChild(child),
        promoteChecklistItemToChild: (rootFile: TFile, input: ChecklistPromotionInput) =>
            promoteChecklistItemToChild(plugin, rootFile, input),
        promoteChecklistItem: (rootFile: TFile, input: ChecklistPromotionInput) =>
            promoteChecklistItemToChild(plugin, rootFile, input),
        applyNotebookNavigatorRulesToFile: (file: TFile, options?: Record<string, unknown>) =>
            plugin.notebookNavigatorRuleService.applyRulesToFile(file, {
                reason: String(options?.reason || 'gcm-api-file'),
                force: options?.force === true,
                bypassCreationGrace: options?.bypassCreationGrace === true,
            }),
        applyNotebookNavigatorRulesToAllFiles: (options?: Record<string, unknown>) =>
            plugin.notebookNavigatorRuleService.applyRulesToAllFiles({
                reason: String(options?.reason || 'gcm-api-all'),
                force: options?.force !== false,
                bypassCreationGrace: options?.bypassCreationGrace !== false,
            }),
    };
}
