import { TFile, Platform, debounce, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { resolveLinkValueToFile } from '../handlers/parent-link-format';
import type TPSGlobalContextMenuPlugin from '../main';
import { ViewModeService } from '../services/view-mode-service';
import { RemoveHiddenSubitemsModal } from '../modals/remove-hidden-subitems-modal';
import { checkAndPromptForUnresolvedSubitems } from '../services/unresolved-subitem-modal';
import type { BodySubitemLink } from '../services/subitem-types';
import * as logger from '../logger';
import { getCompletedDateValue, setCompletedDateValue } from '../utils/completed-date-utils';
import {
    ChecklistHandler,
    markChecklistCompletionPromptHandled,
    wasChecklistCompletionPromptRecentlyHandled,
} from '../handlers/checklist-handler';

/**
 * Registers all workspace and vault event listeners on the given plugin instance.
 * Extracted from `onload` to keep main.ts concise.
 *
 * Also performs the initial `ensureMenus()` call at the end.
 */
export function registerGcmEvents(plugin: TPSGlobalContextMenuPlugin): void {
    // Track the previously active file so we can update its checklist property on leaf change
    let previousActiveFile: TFile | null = null;
    const recentEditorChangeAtByPath = new Map<string, number>();
    const timestampSyncEditorWindowMs = 15_000;
    const statusBeforeModifyByPath = new Map<string, string>();
    const lastKnownStatusByPath = new Map<string, string>();
    const checklistCompletionGuardTimers = new Map<string, number>();
    const checklistCompletionGuard = new ChecklistHandler(plugin.app);

    const readConfiguredStatus = (frontmatter: Record<string, any> | null | undefined): string => {
        if (!frontmatter || typeof frontmatter !== 'object') return '';
        const statusKey = plugin.sharedServices?.status?.getStatusPropertyKey?.() || 'status';
        const actualKey = Object.keys(frontmatter).find((key) => key.toLowerCase() === String(statusKey).toLowerCase());
        const raw = actualKey ? frontmatter[actualKey] : undefined;
        const value = Array.isArray(raw) ? raw.find((entry) => String(entry ?? '').trim()) : raw;
        return plugin.sharedServices?.status?.normalize?.(value) || String(value ?? '').trim().toLowerCase();
    };

    const isChecklistCompletionStatus = (status: string): boolean => {
        const normalized = plugin.sharedServices?.status?.normalize?.(status) || String(status || '').trim().toLowerCase();
        return normalized === 'complete' || normalized === 'completed' || normalized === 'done';
    };

    const writeConfiguredStatus = async (file: TFile, status: string): Promise<void> => {
        markChecklistCompletionPromptHandled(file);
        const statusKey = plugin.sharedServices?.status?.getStatusPropertyKey?.() || 'status';
        await plugin.frontmatterMutationService.process(file, (frontmatter) => {
            const actualKey = Object.keys(frontmatter).find((key) => key.toLowerCase() === String(statusKey).toLowerCase()) || statusKey;
            const completedDateKey = Object.keys(frontmatter).find((key) => key.toLowerCase() === 'completeddate');
            if (status) {
                frontmatter[actualKey] = status;
            } else {
                delete frontmatter[actualKey];
            }
            if (isChecklistCompletionStatus(status)) {
                const now = (window as any).moment
                    ? (window as any).moment().format('YYYY-MM-DD HH:mm:ss')
                    : new Date().toISOString().replace('T', ' ').slice(0, 19);
                frontmatter[completedDateKey || 'completedDate'] = frontmatter[completedDateKey || 'completedDate'] || now;
            } else if (completedDateKey) {
                delete frontmatter[completedDateKey];
            }
        });
    };

    const scheduleExternalChecklistCompletionGuard = (file: TFile, previousStatus: string, currentStatus: string): void => {
        if (!plugin.settings.checkOpenChecklistItems) return;
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        if (!isChecklistCompletionStatus(currentStatus) || isChecklistCompletionStatus(previousStatus)) return;
        if (wasChecklistCompletionPromptRecentlyHandled(file)) return;

        const existing = checklistCompletionGuardTimers.get(file.path);
        if (existing) window.clearTimeout(existing);
        const timer = window.setTimeout(async () => {
            checklistCompletionGuardTimers.delete(file.path);
            const liveFile = plugin.app.vault.getFileByPath(file.path);
            if (!(liveFile instanceof TFile)) return;
            const liveStatus = readConfiguredStatus(plugin.app.metadataCache.getFileCache(liveFile)?.frontmatter as Record<string, any> | undefined);
            if (!isChecklistCompletionStatus(liveStatus)) return;
            const incompleteItems = await checklistCompletionGuard.scanChecklistItems(liveFile);
            if (incompleteItems.length === 0) return;
            const restoreStatus = isChecklistCompletionStatus(previousStatus) ? '' : previousStatus;
            logger.log('[TPS GCM] External checklist completion guard prompting', {
                file: liveFile.path,
                previousStatus,
                restoreStatus,
                liveStatus,
                incompleteItems: incompleteItems.length,
            });
            await writeConfiguredStatus(liveFile, restoreStatus);
            plugin.eventService.emitFilesUpdated([liveFile.path]);
            void checklistCompletionGuard.handleChecklistCompletion(liveFile).then(async (canProceed) => {
                if (canProceed) {
                    await writeConfiguredStatus(liveFile, liveStatus);
                }
                plugin.eventService.emitFilesUpdated([liveFile.path]);
            });
        }, 250);
        checklistCompletionGuardTimers.set(file.path, timer);
    };
    plugin.register(() => {
        for (const timer of checklistCompletionGuardTimers.values()) {
            window.clearTimeout(timer);
        }
        checklistCompletionGuardTimers.clear();
    });
    // ── Native context menu injection ────────────────────────────────────────

    plugin.registerEvent(
        plugin.app.workspace.on('file-menu', (menu, file) => {
            if (plugin.settings.inlineMenuOnly) return;
            const targetEl = plugin.contextTargetService.peekRecentContextTarget(1200);
            // Upstream Notebook Navigator owns its native menus. GCM integrates
            // only with the co-installable TPS fork through its public API.
            if (plugin.contextTargetService.isNotebookNavigatorContextTarget(targetEl)) return;
            const linkTarget = plugin.contextTargetService.resolveMarkdownNoteLinkTarget(targetEl);
            if (linkTarget instanceof TFile) {
                plugin.menuController.addToNativeMenu(menu, [linkTarget]);
                return;
            }
            if (!plugin.contextTargetService.isNativeMenuManagedTarget(targetEl)) return;
            if (file instanceof TFile) {
                plugin.menuController.addToNativeMenu(menu, [file]);
            }
        }),
    );

    plugin.registerEvent(
        plugin.app.workspace.on('files-menu', (menu, files) => {
            if (plugin.settings.inlineMenuOnly) return;
            const targetEl = plugin.contextTargetService.peekRecentContextTarget(1200);
            if (plugin.contextTargetService.isNotebookNavigatorContextTarget(targetEl)) return;
            const fileList = files.filter((f: any) => f && f.path && typeof f.path === 'string') as TFile[];
            if (fileList.length > 0) {
                plugin.menuController.addToNativeMenu(menu, fileList);
            }
        }),
    );

    plugin.registerEvent(
        plugin.app.workspace.on('editor-menu', (menu, editor, info) => {
            if (plugin.settings.inlineMenuOnly) return;
            const targetEl = plugin.contextTargetService.peekRecentContextTarget(1200);
            const linkTarget = plugin.contextTargetService.resolveMarkdownNoteLinkTarget(targetEl);
            if (linkTarget instanceof TFile) {
                plugin.menuController.addToNativeMenu(menu, [linkTarget]);
            }
        }),
    );

    plugin.registerEvent(
        (plugin.app.workspace.on as any)('canvas:node-menu', (menu: any, node: any) => {
            if (plugin.settings.inlineMenuOnly) return;
            const canvasFile = node?.canvas?.view?.file ?? node?.canvas?.file ?? plugin.app.workspace.getActiveFile();
            if (canvasFile instanceof TFile && canvasFile.extension?.toLowerCase() === 'canvas') {
                plugin.menuController.addToNativeMenu(menu, [canvasFile]);
            }
        }),
    );

    // ── Persistent inline menu management ───────────────────────────────────

    const overlayRendering = plugin.overlayRenderingService;
    const throttledEnsureMenus = debounce(() => {
        overlayRendering.scheduleMenus('workspace-layout', 0);
    }, 500, false);

    // Unified subitem refresh function to consolidate multiple triggers
    const scheduleSubitemRefresh = (file: TFile | null, opts: { delay?: number } = {}) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        overlayRendering.scheduleSubitemRefresh(file, 'subitem-refresh', {
            delayMs: typeof opts.delay === 'number' ? opts.delay : 200,
            refreshLivePreviewEditors: true,
        });
    };

    const throttledEnsureLinkedSubitemCheckboxes = debounce(() => {
        overlayRendering.invalidate({
            reason: 'ensure-linked-subitems',
            surfaces: ['linked-subitems'],
            delayMs: 0,
        });
    }, 120, false);
    const debouncedLiveMarkdownParentReconcile = debounce((file: TFile, raw: string) => {
        if (!plugin.canRunBackgroundAutomation()) return;
        void plugin.subitemRelationshipSyncService?.reconcileMarkdownParentText(file, raw);
    }, 250, false);
    const scheduleResponsiveMenuRefresh = (
        file: TFile,
        opts: { ensureMenus?: boolean; force?: boolean; rebuildInlineSubitems?: boolean; delayMs?: number; lateDelayMs?: number } = {}
    ) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        overlayRendering.invalidate({
            reason: 'responsive-menu-refresh',
            file,
            surfaces: ['menus'],
            force: opts.force !== false,
            ensureMenus: opts.ensureMenus === true,
            rebuildInlineSubitems: opts.rebuildInlineSubitems === true,
            delayMs: typeof opts.delayMs === 'number' ? opts.delayMs : 200,
        });
    };

    plugin.registerEvent(plugin.app.workspace.on('layout-change', () => {
        throttledEnsureMenus();
    }));

    let lastActiveModeSignature = '';
    plugin.registerInterval(window.setInterval(() => {
        const leaf = plugin.app.workspace.activeLeaf;
        const view = leaf?.view;
        if (!(view instanceof MarkdownView) || view.getViewType() !== 'markdown') {
            lastActiveModeSignature = '';
            return;
        }
        const signature = plugin.persistentMenuManager?.getViewModeSignature?.(view) || '';
        if (!signature || signature === lastActiveModeSignature) return;
        lastActiveModeSignature = signature;
        plugin.persistentMenuManager?.handleViewModeMaybeChanged?.(view);
        overlayRendering.invalidate({
            reason: 'active-view-mode-transition',
            file: view.file instanceof TFile ? view.file : undefined,
            surfaces: ['daily-nav'],
            delayMs: 120,
        });
    }, 750));

    plugin.registerEvent(
        plugin.app.workspace.on('editor-change', (editor, info) => {
            const file = (info as any)?.file;
            if (!(file instanceof TFile) || file.extension !== 'md') return;
            const active = plugin.app.workspace.getActiveFile();
            if (!(active instanceof TFile) || active.path !== file.path) return;
            recentEditorChangeAtByPath.set(file.path, Date.now());
            (plugin as any).lastEditorChangeAt = Date.now();
            (plugin as any).typingQuietWindowMs = 1600;
            (plugin as any).isEditorFocused = () => {
                const activeElement = document.activeElement;
                return activeElement instanceof HTMLElement
                    && !!activeElement.closest('.cm-editor, .markdown-source-view.mod-cm6, .canvas-node-content');
            };
            plugin.notebookNavigatorRuleService.markUserEdited(file);
            const raw = typeof (editor as any)?.getValue === 'function' ? (editor as any).getValue() : null;
            if (typeof raw !== 'string') return;
            debouncedLiveMarkdownParentReconcile(file, raw);
        }),
    );

    plugin.registerEvent(
        plugin.app.workspace.on('active-leaf-change', () => {
            logger.perf('active-leaf-change', {
                active: plugin.app.workspace.getActiveFile()?.path || null,
                previous: previousActiveFile?.path || null,
            });
            throttledEnsureMenus();
            throttledEnsureLinkedSubitemCheckboxes();
            const activePath = plugin.app.workspace.getActiveFile()?.path || null;
            for (const path of Array.from((plugin as any).viewModeSuppressedPaths as Set<string>)) {
                if (path !== activePath) {
                    (plugin as any).viewModeSuppressedPaths.delete(path);
                }
            }
            // Update checklist property for the note being left
            if (previousActiveFile && previousActiveFile instanceof TFile) {
                plugin.taskCheckboxHandler.scheduleChecklistPropertyUpdate(previousActiveFile);
            }
            const activeFile = plugin.app.workspace.getActiveFile() ?? null;
            previousActiveFile = activeFile instanceof TFile ? activeFile : null;
        }),
    );

    // Helper to check if a leaf is in live preview mode
    const isLivePreviewMode = (leaf: WorkspaceLeaf | null): boolean => {
        if (!leaf) return false;
        const view = leaf.view;
        if (!(view instanceof MarkdownView)) return false;
        const state = view.getState();
        // Live preview is mode: "source" with source: false (or undefined)
        return state.mode === 'source' && state.source !== true;
    };

    // Helper to check for subitems matching hide rules and prompt user
    const checkForHiddenSubitems = async (file: TFile) => {
        if (!plugin.settings.subitems_IgnoreRules || plugin.settings.subitems_IgnoreRules.length === 0) return;
        if (file.extension?.toLowerCase() !== 'md') return;

        const bodyLinks = await plugin.bodySubitemLinkService.scanFile(file);
        if (bodyLinks.length === 0) return;

        const viewModeService = new ViewModeService();
        const matchingLinks: BodySubitemLink[] = [];

        for (const link of bodyLinks) {
            if (!link.childFile) continue;
            
            const cache = plugin.app.metadataCache.getFileCache(link.childFile);
            const fm = (cache?.frontmatter || {}) as Record<string, unknown>;
            
            // Build data object for condition evaluation
            const data: Record<string, unknown> = {
                ...fm,
                path: link.childFile.path,
                filePath: link.childFile.path,
            };

            // Check each rule
            for (const rule of plugin.settings.subitems_IgnoreRules) {
                const conditions = viewModeService.getRuleConditions(rule);
                const matchType = viewModeService.normalizeMatch(rule.match);
                
                if (viewModeService.evaluateConditions(matchType, conditions, data)) {
                    matchingLinks.push(link);
                    break; // Don't add the same link multiple times
                }
            }
        }

        if (matchingLinks.length === 0) return;

        // Show modal asking user if they want to remove the links
        new RemoveHiddenSubitemsModal(
            plugin.app,
            matchingLinks,
            async (linksToRemove: BodySubitemLink[]) => {
                // Remove each matching link from the parent file
                for (const link of linksToRemove) {
                    if (link.childFile) {
                        await plugin.subitemRelationshipSyncService.unlinkChildFromParent(link.childFile, file);
                    }
                }
            }
        ).open();
    };

    // Helper to insert blank line at beginning of file and position cursor
    const insertBlankLineAtBeginning = async (file: TFile) => {
        if (!plugin.settings.enableAutoInsertBlankLineOnOpen) return;
        if (file.extension !== 'md') return;

        // Get the active leaf
        const leaf = plugin.app.workspace.activeLeaf;
        if (!isLivePreviewMode(leaf)) return;

        const view = leaf?.view as MarkdownView | undefined;
        if (!view || !view.editor) return;

        // Read the file content
        const content = await plugin.app.vault.read(file);
        const lines = content.split('\n');
        
        // Check if first line is not empty
        if (lines.length > 0 && lines[0].trim() !== '') {
            // Insert blank line at beginning
            const newContent = '\n' + content;
            await plugin.app.vault.modify(file, newContent);
            
            // Position cursor at line 0 (the new blank line)
            // Use setTimeout to ensure the editor has updated
            setTimeout(() => {
                if (view.editor) {
                    view.editor.setCursor({ line: 0, ch: 0 });
                }
            }, 50);
        }
    };

    plugin.registerEvent(
        plugin.app.workspace.on('file-open', (file) => {
            logger.perf('file-open:start', { file: file instanceof TFile ? file.path : null });
            overlayRendering.scheduleMenus('file-open', 0);

            // Single unified subitem refresh call
            scheduleSubitemRefresh(file, { delay: 150 });

            if (file && Platform.isMobile) {
                setTimeout(() => {
                    overlayRendering.scheduleFileRefresh(file, 'mobile-file-open', { delayMs: 0 });
                    scheduleSubitemRefresh(file, { delay: 0 });
                }, 500);
            }
            if (file && plugin.canRunBackgroundAutomation() && plugin.fileNamingService.shouldProcess(file, { bypassCreationGrace: true, bypassProcessingLock: true })) {
                setTimeout(() => {
                    if (!plugin.canRunBackgroundAutomation()) return;
                    void logger.timeAsync('file-open:fileNamingService.processFileOnOpen', { file: file.path }, () =>
                        plugin.fileNamingService.processFileOnOpen(file, { bypassCreationGrace: true })
                    );
                }, 500);
            }
            // Update checklist property for the newly opened note
            if (file instanceof TFile) {
                if (plugin.notebookNavigatorRuleService.shouldAutoApplyOnFileOpen()) {
                    logger.perf('file-open:scheduleNotebookNavigatorRules', { file: file.path });
                    plugin.notebookNavigatorRuleService.scheduleApply(file, {
                        reason: 'file-open',
                        bypassCreationGrace: true,
                    });
                }
                if (plugin.canRunBackgroundAutomation()) {
                    plugin.taskCheckboxHandler.scheduleChecklistPropertyUpdate(file);
                }
                previousActiveFile = file;
                scheduleResponsiveMenuRefresh(file, {
                    ensureMenus: true,
                    force: false,
                    rebuildInlineSubitems: true,
                    delayMs: 300,
                });

                // ── Note-open reconciliation hooks ─────────────────────────────────
                // 0. Repair broken parent body links from childOf backlinks before any
                // other subitem reconciliation runs. This prevents transient broken
                // lines like `- [ ] [[` from stripping childOf links on open.
                if (plugin.canRunBackgroundAutomation()) {
                    void logger.timeAsync('file-open:repairBrokenBodyLinksForParent', { file: file.path }, () =>
                        plugin.subitemRelationshipSyncService?.repairBrokenBodyLinksForParent(file) ?? Promise.resolve(0)
                    );
                }

                // 1. Ensure missing subitem body links are inserted after frontmatter
                if (plugin.canRunBackgroundAutomation()) {
                    void logger.timeAsync('file-open:ensureBodyLinksForChild', { file: file.path }, () =>
                        plugin.subitemRelationshipSyncService?.ensureBodyLinksForChild(file) ?? Promise.resolve(0)
                    );
                }

                // 2. Check for unresolved/deleted subitem links and prompt user
                // Run after a short delay to let the file fully load
                setTimeout(() => {
                    if (!plugin.canRunBackgroundAutomation()) return;
                    void logger.timeAsync('file-open:checkAndPromptForUnresolvedSubitems', { file: file.path }, () =>
                        checkAndPromptForUnresolvedSubitems(plugin, file)
                    );
                }, 800);
            }
        }),
    );

    // ── Reactive completedDate sync ──────────────────────────────────────────
    // Watches for status changes from ANY source (direct edit, bases, notification modal,
    // kanban, canvas, etc.) and keeps completedDate aligned with current status.
    const pendingCompletedDateSyncFiles = new Map<string, TFile>();
    let completedDateSyncTimer: number | null = null;
    let completedDateSyncQueue: Promise<void> = Promise.resolve();
    let completedDateSyncDisposed = false;

    const getCompletedDateSyncAction = (
        frontmatter: Record<string, any>,
        doneStatuses: Set<string>,
    ): 'set' | 'remove' | null => {
        const currentStatus = readConfiguredStatus(frontmatter);
        const completedDateKey = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === 'completeddate');
        const completedDateValue = getCompletedDateValue(frontmatter);

        if (doneStatuses.has(currentStatus) && (!completedDateValue || (completedDateKey && Array.isArray(frontmatter[completedDateKey])))) {
            return 'set';
        }
        if (!doneStatuses.has(currentStatus) && completedDateValue && currentStatus) {
            return 'remove';
        }
        return null;
    };

    const reconcileCompletedDate = async (file: TFile, doneStatuses: Set<string>): Promise<boolean> => {
        if (!plugin.canRunBackgroundAutomation()) return false;
        if (!file || file.extension !== 'md') return false;

        const cache = plugin.app.metadataCache.getFileCache(file);
        const fm = (cache?.frontmatter || {}) as Record<string, any>;
        if (!getCompletedDateSyncAction(fm, doneStatuses)) return false;

        return await plugin.frontmatterMutationService.process(file, (frontmatter) => {
            const action = getCompletedDateSyncAction(frontmatter, doneStatuses);
            if (action === 'set') {
                setCompletedDateValue(frontmatter, getCompletedDateValue(frontmatter) || undefined);
            } else if (action === 'remove') {
                const key = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === 'completeddate');
                if (key) delete frontmatter[key];
            }
        });
    };

    const reconcileCompletedDateBatch = async (queuedFiles: TFile[]): Promise<void> => {
        if (completedDateSyncDisposed || queuedFiles.length === 0) return;
        const startedAt = performance.now();
        let changedCount = 0;
        let failedCount = 0;
        try {
            const processedPaths = new Set<string>();
            const doneStatuses = new Set(plugin.sharedServices.status.getDoneStatuses());
            for (const queuedFile of queuedFiles) {
                if (completedDateSyncDisposed || !plugin.canRunBackgroundAutomation()) break;
                const liveFile = plugin.app.vault.getFileByPath(queuedFile.path);
                if (!(liveFile instanceof TFile) || liveFile.extension !== 'md' || processedPaths.has(liveFile.path)) continue;
                processedPaths.add(liveFile.path);
                try {
                    if (await reconcileCompletedDate(liveFile, doneStatuses)) changedCount += 1;
                } catch (error) {
                    failedCount += 1;
                    logger.flowError('CompletedDateSync', 'failed', error, { file: liveFile.path });
                }
            }
        } catch (error) {
            failedCount += 1;
            logger.flowError('CompletedDateSync', 'batch-failed', error);
        } finally {
            logger.perf('completedDateSync:flush', {
                queued: queuedFiles.length,
                changed: changedCount,
                failed: failedCount,
                durationMs: Math.round(performance.now() - startedAt),
            });
        }
    };

    const scheduleCompletedDateSync = (file: TFile): void => {
        if (completedDateSyncDisposed || !(file instanceof TFile) || file.extension !== 'md') return;
        pendingCompletedDateSyncFiles.set(file.path, file);
        if (completedDateSyncTimer !== null) window.clearTimeout(completedDateSyncTimer);
        completedDateSyncTimer = window.setTimeout(() => {
            completedDateSyncTimer = null;
            const queuedFiles = Array.from(pendingCompletedDateSyncFiles.values());
            pendingCompletedDateSyncFiles.clear();
            completedDateSyncQueue = completedDateSyncQueue.then(
                () => reconcileCompletedDateBatch(queuedFiles),
            ).catch((error) => {
                logger.flowError('CompletedDateSync', 'queue-failed', error);
            });
        }, 400);
    };

    plugin.register(() => {
        completedDateSyncDisposed = true;
        if (completedDateSyncTimer !== null) {
            window.clearTimeout(completedDateSyncTimer);
            completedDateSyncTimer = null;
        }
        pendingCompletedDateSyncFiles.clear();
    });

    // ── Debounced frontmatter/filename sync ──────────────────────────────────

    const debouncedMenuRefresh = debounce((file: TFile) => {
        if (file && file.extension === 'md') {
            // Force refresh so frontmatter edits made while typing are reflected immediately.
            overlayRendering.scheduleFileRefresh(file, 'metadata-menu-refresh', { force: true, delayMs: 0 });

            const parentKey = String(plugin.settings.parentLinkFrontmatterKey || 'childOf').trim() || 'childOf';
            const fm = (plugin.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, any>;
            const fmParentKey = Object.keys(fm).find((k) => k.toLowerCase() === parentKey.toLowerCase());
            if (fmParentKey !== undefined) {
                const parentRaw = fm[fmParentKey];
                const parentValues = Array.isArray(parentRaw) ? parentRaw : [parentRaw];
                for (const pv of parentValues) {
                    const parentFile = resolveLinkValueToFile(plugin.app, pv, file.path);
                    if (parentFile instanceof TFile && parentFile.path !== file.path) {
                        overlayRendering.scheduleFileRefresh(parentFile, 'metadata-parent-menu-refresh', { force: true, delayMs: 0 });
                    }
                }
            }
        }
    }, 350, false);

    const debouncedFilenameSync = debounce((file: TFile) => {
        if (!file || file.extension !== 'md') return;
        const active = plugin.app.workspace.getActiveFile();
        if (!(active instanceof TFile) || active.path !== file.path) return;
        if (!plugin.fileNamingService.shouldProcess(file, { bypassCreationGrace: true })) return;
        if (plugin.settings.enableAutoRename) {
            void plugin.fileNamingService.updateFilenameIfNeeded(file, { bypassCreationGrace: true });
        }
        if (plugin.settings.autoSyncTitleFromFilename) {
            void plugin.fileNamingService.syncTitleFromFilename(file, {
                bypassCreationGrace: true,
                onlyIfTemplateDerived: plugin.settings.enableAutoRename,
            });
        }
    }, 1500, false);

    const scheduleActiveFilenameReconcile = (file: TFile, delayMs = 900): void => {
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        const path = file.path;
        window.setTimeout(() => {
            const active = plugin.app.workspace.getActiveFile();
            if (!(active instanceof TFile) || active.path !== path) return;
            const liveFile = plugin.app.vault.getFileByPath(path);
            if (!(liveFile instanceof TFile)) return;
            if (!plugin.fileNamingService.shouldProcess(liveFile, { bypassCreationGrace: true })) return;
            if (plugin.settings.enableAutoRename) {
                void plugin.fileNamingService.updateFilenameIfNeeded(liveFile, { bypassCreationGrace: true });
            }
        }, delayMs);
    };

    const debouncedTimestampSync = debounce((file: TFile, reason: 'modify' | 'create' | 'rename' | 'open') => {
        if (!plugin.canRunBackgroundAutomation()) return;
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        void plugin.fileNamingService.syncFileTimestamps(file, {
            reason,
            force: reason === 'create' || reason === 'rename',
        });
    }, 1200, false);

    const shouldSyncTimestampForModify = (file: TFile): boolean => {
        const active = plugin.app.workspace.getActiveFile();
        if (!(active instanceof TFile) || active.path !== file.path) return false;
        const lastEditorChangeAt = recentEditorChangeAtByPath.get(file.path) || 0;
        if (!lastEditorChangeAt || Date.now() - lastEditorChangeAt > timestampSyncEditorWindowMs) return false;
        return true;
    };

    plugin.registerEvent(
        plugin.app.metadataCache.on('changed', (file) => {
            logger.perf('metadataCache.changed', { file: file instanceof TFile ? file.path : null });
            // Clear the title cache when metadata changes to prevent stale titles
            if (file instanceof TFile) {
                plugin.menuController.panelBuilder?.clearFileTitleCache(file.path);
                plugin.noteTitleRenderService?.clearTitleCache(file.path);
            }
            debouncedMenuRefresh(file);
            debouncedFilenameSync(file);
            if (file instanceof TFile) {
                if (plugin.canRunBackgroundAutomation() && plugin.notebookNavigatorRuleService.shouldAutoApplyOnMetadataChange()) {
                    plugin.notebookNavigatorRuleService.scheduleApply(file, {
                        reason: 'metadata-change',
                        bypassCreationGrace: true,
                    });
                }
                if (plugin.canRunBackgroundAutomation()) {
                    plugin.taskCheckboxHandler.scheduleChecklistPropertyUpdate(file);
                }
                const currentStatus = readConfiguredStatus(plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, any> | undefined);
                const previousStatus = statusBeforeModifyByPath.get(file.path) ?? lastKnownStatusByPath.get(file.path) ?? '';
                statusBeforeModifyByPath.delete(file.path);
                lastKnownStatusByPath.set(file.path, currentStatus);
                scheduleExternalChecklistCompletionGuard(file, previousStatus, currentStatus);
                scheduleActiveFilenameReconcile(file, 1200);
                scheduleResponsiveMenuRefresh(file, { rebuildInlineSubitems: true, delayMs: 300 });
                if (plugin.canRunBackgroundAutomation()) {
                    scheduleCompletedDateSync(file);
                }
            }
        }),
    );

    plugin.registerEvent(
        plugin.app.vault.on('modify', (file) => {
            if (!(file instanceof TFile) || file.extension !== 'md') return;
            logger.perf('vault.modify:event', { file: file.path });
            const cachedStatus = readConfiguredStatus(plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, any> | undefined);
            if (!statusBeforeModifyByPath.has(file.path)) {
                statusBeforeModifyByPath.set(file.path, lastKnownStatusByPath.get(file.path) ?? cachedStatus);
            }
            if (!lastKnownStatusByPath.has(file.path)) {
                lastKnownStatusByPath.set(file.path, cachedStatus);
            }
            if (plugin.canRunBackgroundAutomation()) {
                plugin.taskCheckboxHandler.scheduleChecklistPropertyUpdate(file);
                void plugin.subitemRelationshipSyncService?.repairBrokenBodyLinksForParent(file);
                void plugin.subitemRelationshipSyncService?.reconcileMarkdownParent(file);
            }
            if (plugin.canRunBackgroundAutomation() && plugin.parentLinkResolutionService.getParentsForChild(file).length > 0) {
                void plugin.linkedSubitemCheckboxService?.refreshReferencesForChild(file);
            }
            if (plugin.canRunBackgroundAutomation() && shouldSyncTimestampForModify(file)) {
                debouncedTimestampSync(file, 'modify');
            }
            debouncedFilenameSync(file);
            scheduleActiveFilenameReconcile(file);
            scheduleResponsiveMenuRefresh(file, { rebuildInlineSubitems: true, delayMs: 400 });
        }),
    );

    plugin.register(plugin.eventService.onFilesUpdated((paths) => {
        for (const path of paths) {
            const f = plugin.app.vault.getFileByPath(path);
            if (!f) continue;
            scheduleResponsiveMenuRefresh(f, { rebuildInlineSubitems: true, delayMs: 50, lateDelayMs: 320 });
        }
    }));

    // ── Vault events ─────────────────────────────────────────────────────────

    const isNavigationTextInputActive = (): boolean => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return false;
        const isTextInput = active instanceof HTMLInputElement
            || active instanceof HTMLTextAreaElement
            || active.getAttribute('contenteditable') === 'true';
        if (!isTextInput) return false;
        return !!active.closest([
            '.workspace-leaf-content[data-type="file-explorer"]',
            '.nav-files-container',
            '.nav-file',
            '.nav-folder',
            '.tree-item',
            '.tree-item-self',
            '.nn-split',
            '.nn-pane',
            '.nn-navitem',
            '.nn-file',
        ].join(', '));
    };

    const runAfterNavigationRenameSettles = (callback: () => void, attempt = 0): void => {
        if (isNavigationTextInputActive()) {
            if (attempt >= 10) return;
            window.setTimeout(() => runAfterNavigationRenameSettles(callback, attempt + 1), 300);
            return;
        }
        window.setTimeout(callback, 1200);
    };

    plugin.registerEvent(
        plugin.app.vault.on('create', (file) => {
            if (file instanceof TFile && plugin.canRunBackgroundAutomation()) {
                plugin.notebookNavigatorRuleService.scheduleApply(file, {
                    reason: 'create',
                    force: true,
                });
                window.setTimeout(() => {
                    if (!plugin.canRunBackgroundAutomation()) return;
                    const liveFile = plugin.app.vault.getFileByPath(file.path);
                    if (!(liveFile instanceof TFile)) return;
                    void plugin.notebookNavigatorRuleService.applyRulesToFile(liveFile, {
                        reason: 'create',
                        force: true,
                        bypassCreationGrace: true,
                    });
                }, 3800);
            }
            if (file instanceof TFile && file.extension === 'md') {
                setTimeout(() => {
                    if (!plugin.canRunBackgroundAutomation()) return;
                    if (plugin.settings.autoSyncTitleFromFilename) {
                        plugin.fileNamingService.syncTitleFromFilename(file, {
                            force: true,
                            onlyIfMissing: true,
                            onlyIfHasFrontmatter: true,
                            bypassCreationGrace: true,
                        });
                    }
                    void plugin.fileNamingService.syncFileTimestamps(file, {
                        reason: 'create',
                        force: true,
                    });
                }, 1500);
            }
        }),
    );

    plugin.registerEvent(
        plugin.app.vault.on('rename', (file, oldPath) => {
            const renamedMarkdownIdentity =
                file instanceof TFile
                && (file.extension === 'md' || oldPath.toLocaleLowerCase().endsWith('.md'));
            if (renamedMarkdownIdentity) {
                // Rename can remove the old source path from resolvedLinks before
                // the metadata-change event for the new path arrives. Invalidate
                // both identities so an already-mounted source card cannot linger,
                // including when Markdown is renamed to a non-Markdown extension.
                plugin.persistentMenuManager.invalidateLinkedContextSourcePaths(
                    [oldPath, file.path],
                    { removedPaths: [oldPath] },
                );
            }
            if (file instanceof TFile && pendingCompletedDateSyncFiles.delete(oldPath)) {
                scheduleCompletedDateSync(file);
            }
            if (file instanceof TFile && plugin.canRunBackgroundAutomation()) {
                runAfterNavigationRenameSettles(() => {
                    const liveFile = plugin.app.vault.getFileByPath(file.path);
                    if (!(liveFile instanceof TFile)) return;
                    if (!plugin.canRunBackgroundAutomation()) return;
                    plugin.notebookNavigatorRuleService.scheduleApply(liveFile, {
                        reason: 'rename',
                        force: true,
                        bypassCreationGrace: true,
                    });
                });
            }
            if (file instanceof TFile && file.extension === 'md') {
                overlayRendering.scheduleFileRefresh(file, 'rename', { delayMs: 300 });
                runAfterNavigationRenameSettles(() => {
                    if (!plugin.canRunBackgroundAutomation()) return;
                    const liveFile = plugin.app.vault.getFileByPath(file.path);
                    if (!(liveFile instanceof TFile)) return;
                    void plugin.fileNamingService.syncTitleFromFilename(liveFile, {
                        force: true,
                        bypassCreationGrace: true,
                    });
                    void plugin.fileNamingService.syncFileTimestamps(liveFile, {
                        reason: 'rename',
                        force: true,
                    });
                });
            }
        }),
    );

    plugin.register(() => plugin.persistentMenuManager.detach());
    plugin.register(() => plugin.menuController.detach());
    plugin.registerEvent(
        plugin.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                // Deleted TFiles cannot be sent through scheduleFileRefresh, but
                // mounted linked context still remembers their former source path.
                plugin.persistentMenuManager.invalidateLinkedContextSourcePaths(
                    [file.path],
                    { removedPaths: [file.path] },
                );
                pendingCompletedDateSyncFiles.delete(file.path);
                void plugin.bulkEditService.cleanupLinksForDeletedFile(file.path).catch((error) => {
                    logger.flowError('DeletedLinkCleanup', 'failed', error, { deletedPath: file.path });
                });
            }
            try {
                if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur();
                }
            } catch { /* ignore */ }
            try {
                plugin.menuController?.hideMenu?.();
            } catch { /* ignore */ }
            try {
                plugin.eventService.emitDeleteComplete();
            } catch { /* ignore */ }
        }),
    );

    // Initial menu setup
    overlayRendering.invalidate({
        reason: 'initial-setup',
        surfaces: ['menus', 'inline-task-controls', 'linked-subitems'],
        delayMs: 0,
    });
}
