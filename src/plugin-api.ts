import { Notice, normalizePath, parseYaml, TFile, type WorkspaceLeaf } from 'obsidian';
import type TPSGlobalContextMenuPlugin from './main';
import type { VaultQueryService } from './services/vault-query-service';
import type { BodySubitemLink, ResolvedParentLink } from './services/subitem-types';
import { createSubitemForParentWithTitle, getDefaultSubitemFolderPath } from './services/subitem-creation-service';
import { parseTagInput } from './utils/tag-utils';
import * as logger from './logger';
import { executeCommandById, getInternalPlugin, getPluginById, hasCommand } from './core';
import {
    createLinkedSubitemCheckboxContract,
    mapSubitemCheckboxStateToStatus,
    normalizeLinkedSubitemMappings,
} from './utils/linked-subitem-mapping';
import { TPS_EVENTS, TPS_LEGACY_EVENTS } from './tps-contracts';
import {
    dailyNoteTaskScheduleInheritanceEnabled,
    findExistingDailyNoteForIsoDate,
    getDailyNotePathForIsoDate,
    parseDailyNoteFileDate,
} from './utils/daily-note-task-schedule';
import { tpsBaseFormulaService } from './services/tps-base-formula-service';
import {
    parseTaskTagValues,
} from './utils/task-line-metadata';
import { parseStringListInput } from './utils/list-utils';
import {
    parseLineEntityMetadata,
    readLineEntityInlineFieldValue,
} from './services/line-entity-source-provider';
import { getMarkdownContentLines } from './utils/markdown-document-lines';
import type {
    ItemHistoryQueryOptions,
    ItemHistoryTaskReference,
} from './services/item-history-service';
import type { FilePropertiesMutationCause } from './services/file-properties-service';

type ChecklistTaskState = string;

function getSharedLineDisplayTitle(line: string): string {
    return parseLineEntityMetadata(line)?.displayTitle || '';
}

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

type ChecklistPromotionSourcePlan = {
    lineNumber: number;
    rawLine: string;
    text: string;
    block: PromotedChecklistBlock;
    blockRevision: string;
    sourceStatus: string;
    targetStatus: string;
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
): { sourceStatus: string; targetStatus: string } | null {
    const normalizeStatus = (value: unknown): string => plugin.sharedServices.status.normalize(value);
    const mappings = normalizeLinkedSubitemMappings(
        plugin.settings.linkedSubitemCheckboxMappings || [],
        {
            enforceStrictDefaults: false,
            normalizeStatus,
        },
    );
    const normalizedState = `[${state || ' '}]`;
    const mapped = mapSubitemCheckboxStateToStatus(
        mappings,
        normalizedState,
        { normalizedMappings: true },
    );
    const sourceStatus = mapped ? normalizeStatus(mapped) : '';
    if (!sourceStatus) return null;
    if (behavior !== 'complete-and-link') {
        return { sourceStatus, targetStatus: sourceStatus };
    }

    for (const mapping of mappings) {
        for (const status of mapping.statuses) {
            const normalizedStatus = normalizeStatus(status);
            if (normalizedStatus && plugin.sharedServices.status.isDoneStatus(normalizedStatus)) {
                return { sourceStatus, targetStatus: normalizedStatus };
            }
        }
    }
    return null;
}

function normalizeChecklistText(text: string): string {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function resolveExactChecklistLineIndex(lines: string[], input: ChecklistPromotionInput): number {
    const rawLine = input.rawLine !== undefined
        ? String(input.rawLine)
        : lines[input.lineNumber];
    if (typeof rawLine !== 'string') return -1;

    const exactMatches: number[] = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (lines[index] === rawLine) exactMatches.push(index);
    }
    if (exactMatches.length !== 1) return -1;

    const lineNumber = exactMatches[0];
    const parsed = parseChecklistLine(lines[lineNumber]);
    if (!parsed) return -1;
    if (
        input.text !== undefined
        && normalizeChecklistText(input.text) !== normalizeChecklistText(parsed.text)
    ) return -1;
    return lineNumber;
}

function resolveChecklistPromotionSourcePlan(
    plugin: TPSGlobalContextMenuPlugin,
    lines: string[],
    input: ChecklistPromotionInput,
    behavior: 'remove' | 'complete-and-link' | 'link-only',
): ChecklistPromotionSourcePlan | null {
    const lineNumber = resolveExactChecklistLineIndex(lines, input);
    if (lineNumber < 0) return null;
    const rawLine = lines[lineNumber] || '';
    const parsed = parseChecklistLine(rawLine);
    if (!parsed) return null;
    const statuses = resolvePromotionStatusFromSource(plugin, parsed.state, behavior);
    if (!statuses) return null;
    const block = getPromotedChecklistBlock(lines, lineNumber);
    return {
        lineNumber,
        rawLine,
        text: String(parsed.text || '').trim(),
        block,
        blockRevision: lines.slice(block.startLine, block.endLineExclusive).join('\n'),
        ...statuses,
    };
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

async function compensateOwnedPromotedChild(
    plugin: TPSGlobalContextMenuPlugin,
    child: TFile,
): Promise<boolean> {
    const liveTarget = plugin.app.vault.getAbstractFileByPath(child.path);
    if (liveTarget !== child) {
        logger.flowWarn('ChecklistPromotion', 'rollback:ownership-lost', { childPath: child.path });
        return false;
    }
    try {
        await plugin.app.vault.delete(child, true);
        logger.flow('ChecklistPromotion', 'rollback:child-removed', { childPath: child.path });
        return true;
    } catch (error) {
        logger.error('[TPS GCM] Failed compensating an uncommitted checklist promotion:', child.path, error);
        return false;
    }
}

async function didPromotionParentWriteCommit(
    plugin: TPSGlobalContextMenuPlugin,
    rootFile: TFile,
    expectedContent: string | null,
): Promise<boolean> {
    if (expectedContent == null) return false;
    try {
        return await plugin.app.vault.read(rootFile) === expectedContent;
    } catch {
        return false;
    }
}

async function readPromotedChildWorkflowStatus(
    plugin: TPSGlobalContextMenuPlugin,
    child: TFile,
): Promise<string | null> {
    try {
        const content = await plugin.app.vault.read(child);
        const match = String(content || '').match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
        if (!match) return null;
        const frontmatter = parseYaml(match[1]) as Record<string, unknown> | null;
        if (!frontmatter || typeof frontmatter !== 'object') return null;
        const workflowKey = plugin.sharedServices.status.getStatusPropertyKey();
        const actualKey = Object.keys(frontmatter).find(
            (key) => key.trim().toLowerCase() === workflowKey.trim().toLowerCase(),
        );
        return actualKey
            ? plugin.sharedServices.status.normalize(frontmatter[actualKey]) || null
            : null;
    } catch {
        return null;
    }
}

export async function promoteChecklistItemToChild(
    plugin: TPSGlobalContextMenuPlugin,
    rootFile: TFile,
    input: ChecklistPromotionInput,
): Promise<TFile | null> {
    const content = await plugin.app.vault.cachedRead(rootFile);
    const lines = content.split('\n');
    const behavior = plugin.settings.checklistPromotionBehavior ?? 'remove';
    const sourcePlan = resolveChecklistPromotionSourcePlan(plugin, lines, input, behavior);
    if (!sourcePlan) {
        new Notice('Checklist promotion stopped because the exact source line is stale, duplicated, or has no checkbox mapping.');
        return null;
    }

    const promotion = extractChecklistPromotionMetadata(plugin, rootFile, sourcePlan.text);
    if (!promotion.title) {
        new Notice('Checklist item title is empty.');
        return null;
    }

    let created: TFile | null = null;
    let expectedParentContent: string | null = null;
    let parentChanged = false;
    let mutationError: unknown = null;
    try {
        parentChanged = await plugin.subitemRelationshipSyncService.mutateMarkdownBody(rootFile, async (currentLines) => {
            const currentPlan = resolveChecklistPromotionSourcePlan(
                plugin,
                currentLines,
                {
                    lineNumber: sourcePlan.lineNumber,
                    rawLine: sourcePlan.rawLine,
                    text: sourcePlan.text,
                },
                behavior,
            );
            if (
                !currentPlan
                || currentPlan.blockRevision !== sourcePlan.blockRevision
                || currentPlan.sourceStatus !== sourcePlan.sourceStatus
                || currentPlan.targetStatus !== sourcePlan.targetStatus
            ) return false;

            const nextChild = await createSubitemForParentWithTitle(
                plugin,
                rootFile,
                promotion.title,
                getDefaultSubitemFolderPath(plugin, rootFile),
                {
                    seedParentTags: true,
                    seedVisualMetadata: false,
                    insertParentBodyLink: false,
                    requireNewFile: true,
                    initialWorkflowStatus: currentPlan.targetStatus,
                    initialScheduled: promotion.scheduled,
                    initialTags: promotion.tags,
                    initialBody: currentPlan.block.body,
                    suppressCreatedNotice: true,
                },
            );
            if (!nextChild) return false;
            created = nextChild;

            const linkPath = normalizePath(nextChild.path.replace(/\.md$/i, ''));
            const wikilink = `[[${linkPath}|${currentPlan.text || nextChild.basename}]]`;
            const currentParsed = parseChecklistLine(currentPlan.rawLine);
            if (!currentParsed) return false;
            const liveStatuses = resolvePromotionStatusFromSource(plugin, currentParsed.state, behavior);
            if (
                !liveStatuses
                || liveStatuses.sourceStatus !== currentPlan.sourceStatus
                || liveStatuses.targetStatus !== currentPlan.targetStatus
            ) return false;
            if (await readPromotedChildWorkflowStatus(plugin, nextChild) !== currentPlan.targetStatus) {
                await plugin.sharedServices.status.setFileStatus(nextChild, currentPlan.targetStatus);
                if (await readPromotedChildWorkflowStatus(plugin, nextChild) !== currentPlan.targetStatus) {
                    return false;
                }
            }
            const currentLineIndex = currentPlan.lineNumber;
            const currentBlock = currentPlan.block;

            if (behavior === 'link-only' || behavior === 'complete-and-link') {
                currentLines[currentLineIndex] = `${currentParsed.prefix}${wikilink}`;
                if (currentBlock.endLineExclusive > currentLineIndex + 1) {
                    currentLines.splice(currentLineIndex + 1, currentBlock.endLineExclusive - currentLineIndex - 1);
                }
            } else {
                currentLines.splice(currentBlock.startLine, currentBlock.endLineExclusive - currentBlock.startLine);
            }
            expectedParentContent = currentLines.join('\n');
            return true;
        });
    } catch (error) {
        mutationError = error;
    }

    if (!created) {
        if (mutationError) logger.error('[TPS GCM] Checklist promotion failed before child creation:', mutationError);
        return null;
    }
    if (parentChanged || await didPromotionParentWriteCommit(plugin, rootFile, expectedParentContent)) {
        new Notice(`Created subitem: ${created.basename}`);
        return created;
    }

    const compensated = await compensateOwnedPromotedChild(plugin, created);
    logger.flowWarn('ChecklistPromotion', 'promotion:parent-uncommitted', {
        parentPath: rootFile.path,
        childPath: created.path,
        compensated,
        threw: mutationError != null,
    });
    new Notice(compensated
        ? 'Checklist promotion stopped before the parent changed; the temporary child was removed.'
        : 'Checklist promotion could not be completed or safely rolled back.');
    return null;
}

/**
 * Attaches the inter-plugin API object to the plugin instance as `plugin.api`.
 * Extracted from `onload` to keep main.ts concise.
 */
export function setupPluginApi(plugin: TPSGlobalContextMenuPlugin): void {
    const services = plugin.sharedServices;
    const publicMutationCause = (
        cause?: FilePropertiesMutationCause,
    ): FilePropertiesMutationCause => (
        cause?.kind === 'user' || cause?.kind === 'automation'
            ? cause
            : {
                kind: 'automation',
                sourcePluginId: plugin.manifest.id,
                surface: 'plugin-api',
            }
    );
    const normalizeTaskCheckboxStatus = (value: unknown): string => services.status.normalize(value);
    const taskCheckboxesApi = createLinkedSubitemCheckboxContract(
        () => plugin.settings.linkedSubitemCheckboxMappings || [],
        normalizeTaskCheckboxStatus,
    );
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
            cause?: FilePropertiesMutationCause,
        ) => plugin.frontmatterMutationService.process(file, mutator, publicMutationCause(cause)),
        setValues: (
            files: TFile[],
            updates: Record<string, unknown>,
            cause?: FilePropertiesMutationCause,
        ) => plugin.frontmatterMutationService.updateValues(files, updates, publicMutationCause(cause)),
        setListValues: (
            files: TFile[],
            key: string,
            values: unknown[],
            cause?: FilePropertiesMutationCause,
        ) => plugin.frontmatterMutationService.setListValues(files, key, values, publicMutationCause(cause)),
        addListValues: (
            files: TFile[],
            key: string,
            values: unknown[],
            cause?: FilePropertiesMutationCause,
        ) => plugin.frontmatterMutationService.addValuesToList(files, key, values, publicMutationCause(cause)),
        removeListValues: (
            files: TFile[],
            key: string,
            values: unknown[],
            cause?: FilePropertiesMutationCause,
        ) => plugin.frontmatterMutationService.removeValuesFromList(files, key, values, publicMutationCause(cause)),
        setDateValue: (
            files: TFile[],
            key: string,
            value: string | null,
            cause?: FilePropertiesMutationCause,
        ) => plugin.frontmatterMutationService.setDateValue(files, key, value, publicMutationCause(cause)),
        deleteKeys: (
            files: TFile[],
            keys: string[],
            cause?: FilePropertiesMutationCause,
        ) => plugin.frontmatterMutationService.deleteKeys(files, keys, publicMutationCause(cause)),
    };
    const filePropertiesApi = {
        version: 1,
        isTarget: (file: TFile) => plugin.filePropertiesService.isPropertyTarget(file),
        isCompanion: (file: TFile) => plugin.filePropertiesService.isCompanionFile(file),
        readCached: (file: TFile) => plugin.filePropertiesService.read(file),
        read: (file: TFile) => plugin.filePropertiesService.getFrontmatterAsync(file),
        process: (
            file: TFile,
            mutator: (frontmatter: Record<string, unknown>) => void | Promise<void>,
            cause?: FilePropertiesMutationCause,
        ) => plugin.filePropertiesService.process(file, mutator, publicMutationCause(cause)),
        processMany: (
            files: TFile[],
            mutator: (frontmatter: Record<string, unknown>) => void | Promise<void>,
            cause?: FilePropertiesMutationCause,
        ) => plugin.filePropertiesService.processMany(files, mutator, publicMutationCause(cause)),
        setValues: (
            files: TFile[],
            updates: Record<string, unknown>,
            cause?: FilePropertiesMutationCause,
        ) => plugin.filePropertiesService.updateValues(files, updates, publicMutationCause(cause)),
        setListValues: (
            files: TFile[],
            key: string,
            values: unknown[],
            cause?: FilePropertiesMutationCause,
        ) => plugin.filePropertiesService.setListValues(files, key, values, publicMutationCause(cause)),
        addListValues: (
            files: TFile[],
            key: string,
            values: unknown[],
            cause?: FilePropertiesMutationCause,
        ) => plugin.filePropertiesService.addValuesToList(files, key, values, publicMutationCause(cause)),
        removeListValues: (
            files: TFile[],
            key: string,
            values: unknown[],
            cause?: FilePropertiesMutationCause,
        ) => plugin.filePropertiesService.removeValuesFromList(files, key, values, publicMutationCause(cause)),
        deleteKeys: (
            files: TFile[],
            keys: string[],
            cause?: FilePropertiesMutationCause,
        ) => plugin.filePropertiesService.deleteKeys(files, keys, publicMutationCause(cause)),
        getCompanion: (file: TFile) => plugin.filePropertiesService.getCompanionFile(file),
        getRelinkCandidate: (file: TFile) => plugin.filePropertiesService.getRelinkCandidate(file),
        getTarget: (companion: TFile) => plugin.filePropertiesService.getSourceFileForCompanion(companion),
        ensure: (file: TFile, cause?: FilePropertiesMutationCause) => (
            plugin.filePropertiesService.ensureCompanion(file, {}, publicMutationCause(cause))
        ),
        relink: (companion: TFile, file: TFile, cause?: FilePropertiesMutationCause) => (
            plugin.filePropertiesService.relinkCompanion(companion, file, publicMutationCause(cause))
        ),
        reconcile: () => plugin.filePropertiesService.reconcileCompanions(),
        listKnownPropertyNames: () => plugin.filePropertiesService.listKnownPropertyNames(),
    };
    const canvasPropertiesApi = {
        read: (file: TFile) => plugin.filePropertiesService.readCanvasCompatibility(file),
        process: filePropertiesApi.process,
        setValues: filePropertiesApi.setValues,
        setListValues: filePropertiesApi.setListValues,
        addListValues: filePropertiesApi.addListValues,
        removeListValues: filePropertiesApi.removeListValues,
        deleteKeys: filePropertiesApi.deleteKeys,
    };

    (plugin as any).api = {
        // ── Shared services ──────────────────────────────────────────────────
        services,
        contracts: {
            version: 1,
            TPS_EVENTS,
            TPS_LEGACY_EVENTS,
        },
        formulas: {
            version: tpsBaseFormulaService.version,
            compile: (definitions: unknown, sourceId?: string) =>
                tpsBaseFormulaService.compile(definitions, sourceId),
            createSession: (
                compiled: Parameters<typeof tpsBaseFormulaService.createSession>[0],
                context: Parameters<typeof tpsBaseFormulaService.createSession>[1],
            ) => tpsBaseFormulaService.createSession(compiled, context),
            evaluate: (
                compiled: Parameters<typeof tpsBaseFormulaService.evaluate>[0],
                formula: string,
                context: Parameters<typeof tpsBaseFormulaService.evaluate>[2],
            ) => tpsBaseFormulaService.evaluate(compiled, formula, context),
            evaluateAll: (
                compiled: Parameters<typeof tpsBaseFormulaService.evaluateAll>[0],
                context: Parameters<typeof tpsBaseFormulaService.evaluateAll>[1],
            ) => tpsBaseFormulaService.evaluateAll(compiled, context),
            evaluateExpression: (
                compiled: Parameters<typeof tpsBaseFormulaService.evaluateExpression>[0],
                expression: string,
                context: Parameters<typeof tpsBaseFormulaService.evaluateExpression>[2],
            ) => tpsBaseFormulaService.evaluateExpression(compiled, expression, context),
            format: (value: unknown) => tpsBaseFormulaService.format(value),
            comparableValues: (value: unknown) => tpsBaseFormulaService.comparableValues(value),
            sortKey: (value: unknown) => tpsBaseFormulaService.sortKey(value),
            groupValues: (value: unknown) => tpsBaseFormulaService.groupValues(value),
            compare: (left: unknown, right: unknown) => tpsBaseFormulaService.compare(left, right),
            isTruthy: (value: unknown) => tpsBaseFormulaService.isTruthy(value),
            hasReference: (value: unknown) => tpsBaseFormulaService.hasReference(value),
        },
        lineMetadata: {
            version: 1,
            readInlineFields: (line: string) => parseLineEntityMetadata(line)?.fields ?? [],
            readInlineFieldValue: (line: string, key: string) => readLineEntityInlineFieldValue(line, key),
            readTags: (line: string) => parseLineEntityMetadata(line)?.tags ?? [],
            parseStringList: (value: unknown) => parseStringListInput(value),
            parseTags: (value: unknown) => parseTaskTagValues(value),
            getDisplayTitle: (line: string) => getSharedLineDisplayTitle(line),
            parseLine: (line: string) => {
                const parsed = parseLineEntityMetadata(line);
                return {
                    fields: parsed?.fields ?? [],
                    tags: parsed?.tags ?? [],
                    displayTitle: parsed?.displayTitle ?? '',
                };
            },
            scanDocument: (content: string) => Object.freeze(
                getMarkdownContentLines(content).map((line) => Object.freeze({
                    index: line.index,
                    lineNumber: line.lineNumber,
                    text: line.text,
                    start: line.start,
                    end: line.end,
                })),
            ),
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
            version: 3,
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
            version: 2,
            findForIsoDate: (isoDate: string) => findExistingDailyNoteForIsoDate(plugin.app, plugin.settings, isoDate),
            pathForIsoDate: (isoDate: string) => getDailyNotePathForIsoDate(plugin.app, plugin.settings, isoDate),
            ensureForIsoDate: (isoDate: string) => plugin.noteOperationService.ensureDailyNote(`${isoDate} 00:00:00`),
            getTaskSchedulePolicy: (file: Pick<TFile, 'path' | 'basename'>) => ({
                isDailyNote: parseDailyNoteFileDate(plugin.app, plugin.settings, file) !== null,
                inheritUnscheduled: dailyNoteTaskScheduleInheritanceEnabled(plugin.settings),
            }),
        },
        configuration: {
            version: 1,
            isInlinePropertyAllowed: (key: unknown): boolean => {
                const normalizedKey = String(key ?? '').trim().toLowerCase();
                if (!normalizedKey) return false;
                const property = (plugin.settings.properties || []).find((candidate) => {
                    const candidateKey = String(candidate?.key || '').trim().toLowerCase();
                    const candidateId = String(candidate?.id || '').trim().toLowerCase();
                    return candidateKey === normalizedKey || candidateId === normalizedKey;
                });
                return Boolean(
                    property
                    && !property.disabled
                    && !property.hidden
                    && property.allowInlineSet !== false
                    && property.type !== 'kind',
                );
            },
            getParentLinkPolicy: () => ({
                format: plugin.settings.parentLinkFormat,
                tag: String(plugin.settings.parentTagOnChildLink || '').trim(),
                autoSelfLink: plugin.settings.autoSelfLinkParentInParentKey === true,
            }),
        },
        itemProperties: {
            version: 1,
            listDefinitions: () => Object.freeze((plugin.settings.properties || [])
                .filter((property) => !property.disabled && !property.hidden)
                .map((property) => Object.freeze({
                    id: String(property.id || ''),
                    key: String(property.key || ''),
                    label: String(property.label || property.key || ''),
                    type: property.type,
                    listItemType: property.listItemType,
                    allowInlineSet: property.allowInlineSet !== false,
                }))),
            resolveDefinition: (keyOrId: unknown) => {
                const normalized = String(keyOrId ?? '').trim().toLowerCase();
                if (!normalized) return null;
                const property = (plugin.settings.properties || []).find((candidate) => (
                    String(candidate.key || '').trim().toLowerCase() === normalized
                    || String(candidate.id || '').trim().toLowerCase() === normalized
                ));
                if (!property || property.disabled || property.hidden) return null;
                return Object.freeze({
                    id: String(property.id || ''),
                    key: String(property.key || ''),
                    label: String(property.label || property.key || ''),
                    type: property.type,
                    listItemType: property.listItemType,
                    allowInlineSet: property.allowInlineSet !== false,
                });
            },
            applyToTaskLines: (
                refs: Parameters<typeof plugin.taskLineContextMenuService.applyItemPropertyMutation>[0],
                mutation: Parameters<typeof plugin.taskLineContextMenuService.applyItemPropertyMutation>[1],
                cause?: Parameters<typeof plugin.taskLineContextMenuService.applyItemPropertyMutation>[2],
            ) => plugin.taskLineContextMenuService.applyItemPropertyMutation(refs, mutation, cause),
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
        menus: {
            version: 1,
            addToNativeMenu: (
                menu: Parameters<typeof plugin.menuController.addToNativeMenu>[0],
                files: Parameters<typeof plugin.menuController.addToNativeMenu>[1],
                options?: Parameters<typeof plugin.menuController.addToNativeMenu>[2],
            ) => plugin.menuController.addToNativeMenu(menu, files, options),
        },
        taskLines: {
            version: 1,
            handleContextMenu: (event: MouseEvent): boolean =>
                plugin.taskLineContextMenuService.handleContextMenu(event),
            openQuickEditorForElement: (
                taskEl: HTMLElement,
                sourceEl: HTMLElement | null = taskEl,
            ): Promise<boolean> => plugin.taskLineContextMenuService.openQuickEditorForElement(taskEl, sourceEl),
            addMenuItems: (
                menu: Parameters<typeof plugin.taskLineContextMenuService.addTaskLineMenuItems>[0],
                context: Parameters<typeof plugin.taskLineContextMenuService.addTaskLineMenuItems>[1],
                options?: Parameters<typeof plugin.taskLineContextMenuService.addTaskLineMenuItems>[2],
            ) => plugin.taskLineContextMenuService.addTaskLineMenuItems(menu, context, options),
            createNoteForLine: (
                context: Parameters<typeof plugin.dailyInboxLineService.createNoteForLine>[0],
            ) => plugin.dailyInboxLineService.createNoteForLine(context),
        },
        taskCheckboxes: taskCheckboxesApi,
        tasks: plugin.taskApiService,
        history: {
            version: 1,
            resolveEntity: (reference: string | ItemHistoryTaskReference) =>
                plugin.itemHistoryService.resolveEntity(reference),
            query: (reference: string | ItemHistoryTaskReference, options?: ItemHistoryQueryOptions) =>
                plugin.itemHistoryService.query(reference, options),
            stats: () => plugin.itemHistoryService.stats(),
            prune: () => plugin.itemHistoryService.prune(),
            clear: () => plugin.itemHistoryService.clear(),
        },
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
        /** Async file lookup. Reads non-Markdown properties through GCM's native companion store. */
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
            const fm = file.extension?.toLowerCase() === 'md'
                ? (plugin.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, unknown>
                : plugin.filePropertiesService.read(file);
            const raw = services.frontmatter.findKey(fm, statusKey)
                ? fm[services.frontmatter.findKey(fm, statusKey)!]
                : undefined;
            const current = services.status.normalize(raw);
            const options = services.status.getStatusOptions();
            if (!options.length) return false;
            const normalizedOptions = options.map((option) => services.status.normalize(option));
            const index = normalizedOptions.indexOf(current);
            const next = options[index >= 0 ? (index + 1) % options.length : 0];
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
        /** Native property storage for Canvas, Base, PDF, media, and other non-Markdown files. */
        fileProperties: filePropertiesApi,
        /** @deprecated Compatibility alias backed by GCM's native file-property store. */
        canvasProperties: canvasPropertiesApi,
        /** Create `.canvas` files from markdown notes and copy properties into a native companion note. */
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
