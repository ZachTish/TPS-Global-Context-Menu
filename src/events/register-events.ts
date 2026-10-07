import { TFile, TFolder, Platform, debounce, MarkdownView, Notice, WorkspaceLeaf } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { ViewModeService } from '../services/view-mode-service';
import { RemoveHiddenSubitemsModal } from '../modals/remove-hidden-subitems-modal';
import type { BodySubitemLink } from '../services/subitem-types';
import * as logger from '../logger';
import { getViewMode, isStrictSourceMode } from '../services/leaf-resolver';
import { DailyNoteTemplateInstanceCleanupService } from '../services/daily-note-template-instance-cleanup-service';

/**
 * Registers all workspace and vault event listeners on the given plugin instance.
 * Extracted from `onload` to keep main.ts concise.
 *
 * Also performs the initial `ensureMenus()` call at the end.
 */
export function registerGcmEvents(plugin: TPSGlobalContextMenuPlugin): void {
    const recentEditorChangeAtByPath = new Map<string, number>();
    const timestampSyncEditorWindowMs = 15_000;
    const dailyNoteTemplateInstanceCleanup = new DailyNoteTemplateInstanceCleanupService(plugin);
    plugin.register(() => dailyNoteTemplateInstanceCleanup.dispose());

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

    // ── Persistent inline menu management ───────────────────────────────────

    const overlayRendering = plugin.overlayRenderingService;
    const throttledEnsureMenus = debounce(() => {
        overlayRendering.scheduleMenus('workspace-layout', 0);
    }, 500, false);
    const refreshActiveInlineTitle = () => {
        const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.file instanceof TFile) plugin.noteTitleRenderService.refreshInlineTitle(view);
    };
    plugin.app.workspace.onLayoutReady(refreshActiveInlineTitle);

    // Unified subitem refresh function to consolidate multiple triggers
    const scheduleSubitemRefresh = (file: TFile | null, opts: { delay?: number } = {}) => {
        if (!(file instanceof TFile) || file.extension !== 'md' || plugin.settings.enableLinkedSubitemCheckboxes === false) return;
        overlayRendering.scheduleSubitemRefresh(file, 'subitem-refresh', {
            delayMs: typeof opts.delay === 'number' ? opts.delay : 200,
            refreshLivePreviewEditors: true,
        });
    };

    const throttledEnsureLinkedSubitemCheckboxes = debounce(() => {
        if (plugin.settings.enableLinkedSubitemCheckboxes === false) return;
        overlayRendering.invalidate({
            reason: 'ensure-linked-subitems',
            surfaces: ['linked-subitems'],
            delayMs: 0,
        });
    }, 120, false);
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
        refreshActiveInlineTitle();
    }));

    let lastActiveModeSignature = '';
    plugin.registerInterval(window.setInterval(() => {
        const leaf = plugin.app.workspace.activeLeaf;
        const view = leaf?.view;
        if (!(view instanceof MarkdownView) || view.getViewType() !== 'markdown') {
            lastActiveModeSignature = '';
            return;
        }
        const filePath = view.file instanceof TFile ? view.file.path : '';
        const mode = getViewMode(view) || 'unknown';
        const signature = `${filePath}\u0000${mode}\u0000${isStrictSourceMode(view) ? 'strict-source' : 'rendered'}`;
        if (!signature || signature === lastActiveModeSignature) return;
        lastActiveModeSignature = signature;
        throttledEnsureMenus();
        // Obsidian already configures the newly opened/switched editor. Refresh
        // our DOM surfaces without reconfiguring every Markdown tab twice.
        plugin.hideCompletedCheckboxesService?.refreshAllEditors({ reconfigureEditors: false });
        plugin.virtualBaseEmbedService?.scheduleRefresh(0);
        overlayRendering.invalidate({
            reason: 'active-view-mode-transition',
            file: view.file instanceof TFile ? view.file : undefined,
            surfaces: ['daily-nav'],
            delayMs: 120,
        });
    }, 750));

    plugin.registerEvent(
        plugin.app.workspace.on('editor-change', (_editor, info) => {
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
        }),
    );

    plugin.registerEvent(
        plugin.app.workspace.on('active-leaf-change', () => {
            logger.perf('active-leaf-change', {
                active: plugin.app.workspace.getActiveFile()?.path || null,
            });
            throttledEnsureMenus();
            refreshActiveInlineTitle();
            throttledEnsureLinkedSubitemCheckboxes();
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
            refreshActiveInlineTitle();
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
            // Navigation mounts UI; checklist maintenance belongs to content changes.
            if (file instanceof TFile) {
                if (plugin.notebookNavigatorRuleService.shouldAutoApplyOnFileOpen()) {
                    logger.perf('file-open:scheduleNotebookNavigatorRules', { file: file.path });
                    plugin.notebookNavigatorRuleService.scheduleApply(file, {
                        reason: 'file-open',
                        bypassCreationGrace: true,
                    });
                }
            }
        }),
    );

    // ── Debounced frontmatter/filename sync ──────────────────────────────────

    const refreshRelatedParentMenus = (paths: readonly string[], reason: string) => {
        for (const path of new Set(paths)) {
            const parent = plugin.app.vault.getFileByPath(path);
            if (parent instanceof TFile && parent.extension === 'md') {
                overlayRendering.scheduleFileRefresh(parent, reason, { force: true, delayMs: 300 });
            }
        }
    };

    const scheduleMetadataMenuRefresh = (file: TFile, parentPaths: readonly string[]) => {
        if (file && file.extension === 'md') {
            // Force refresh so frontmatter edits made while typing are reflected immediately.
            overlayRendering.scheduleFileRefresh(file, 'metadata-menu-refresh', { force: true, rebuildInlineSubitems: true, delayMs: 300 });
        }
        refreshRelatedParentMenus(parentPaths, 'metadata-parent-menu-refresh');
    };

    const debouncedFilenameSync = debounce((file: TFile) => {
        if (!file || file.extension !== 'md') return;
        const active = plugin.app.workspace.getActiveFile();
        if ((!(active instanceof TFile) || active.path !== file.path) && !plugin.fileNamingService.isCalendarEventFile(file)) return;
        if (!plugin.fileNamingService.shouldProcess(file, { bypassCreationGrace: true, allowCalendarEventFilename: true })) return;
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
            if (plugin.propertyMigrationService?.active) return;
            const useLegacyFileProperties = plugin.settings.dataArchitectureMode !== 'native-records';
            if (useLegacyFileProperties
                && file instanceof TFile && file.extension?.toLocaleLowerCase() === 'canvas') {
                plugin.filePropertiesService.invalidateLegacyCanvas(file);
            }
            const changedParentPaths = file instanceof TFile
                ? plugin.parentLinkResolutionService.onMetadataChanged(file)
                : [];
            logger.perf('metadataCache.changed', { file: file instanceof TFile ? file.path : null });
            if (file instanceof TFile && plugin.filePropertiesService?.isCompanionFile(file)) {
                if (!useLegacyFileProperties) return;
                void plugin.filePropertiesService.handleCompanionMetadataChanged(file)
                    .then((handled) => {
                        if (!handled || !plugin.canRunBackgroundAutomation()) return;
                        const logicalSource = plugin.filePropertiesService.getSourceFileForCompanion(file);
                        if (!(logicalSource instanceof TFile)) return;
                        plugin.notebookNavigatorRuleService.scheduleApply(logicalSource, {
                            reason: 'metadata-change',
                            bypassCreationGrace: true,
                        });
                    })
                    .catch((error) => {
                        logger.warn('[TPS GCM] Could not refresh a directly edited file-property companion', {
                            companion: file.path,
                            error,
                        });
                    });
                return;
            }
            // Refresh saved titles when their metadata arrives.
            if (file instanceof TFile) {
                plugin.menuController.panelBuilder?.clearFileTitleCache(file.path);
                plugin.noteTitleRenderService?.handleMetadataChanged(file);
            }
            // Queue each file in the shared batch; a single-argument debounce
            // both lost earlier files and caused a second delayed forced render.
            scheduleMetadataMenuRefresh(file, changedParentPaths);
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
            }
        }),
    );

    plugin.registerEvent(
        plugin.app.vault.on('modify', (file) => {
            if (plugin.propertyMigrationService?.active) return;
            if (plugin.settings.dataArchitectureMode !== 'native-records'
                && file instanceof TFile && file.extension?.toLocaleLowerCase() === 'canvas') {
                plugin.filePropertiesService.invalidateLegacyCanvas(file);
                if (plugin.filePropertiesService.hasCompanion(file)) {
                    refreshRelatedParentMenus(plugin.parentLinkResolutionService.onMetadataChanged(file), 'canvas-parent-menu-refresh');
                } else {
                    // Canvas JSON has no Markdown metadata event. Its modify event
                    // owns the authoritative compatibility read before reindexing.
                    void plugin.filePropertiesService.primeLegacyCanvasCache([file]).then(() => {
                        if (plugin.app.vault.getFileByPath(file.path) !== file) return;
                        refreshRelatedParentMenus(plugin.parentLinkResolutionService.onMetadataChanged(file), 'canvas-parent-menu-refresh');
                    }).catch((error) => {
                        logger.error('[TPS GCM] Could not index modified Canvas parent links', { file: file.path, error });
                    });
                }
            }
            if (!(file instanceof TFile) || file.extension !== 'md') return;
            if (plugin.filePropertiesService?.isCompanionFile(file)) return;
            logger.perf('vault.modify:event', { file: file.path });
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
            scheduleResponsiveMenuRefresh(file, { rebuildInlineSubitems: true, delayMs: 400 });
        }),
    );

    plugin.register(plugin.eventService.onFilesUpdated((paths) => {
        for (const path of paths) {
            const f = plugin.app.vault.getFileByPath(path);
            if (!f) continue;
            if (plugin.parentLinkResolutionService.isRelationshipTarget(f)) {
                refreshRelatedParentMenus(plugin.parentLinkResolutionService.onMetadataChanged(f), 'file-update-parent-menu-refresh');
            }
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

    const scheduleCreatedFileAutomation = (file: TFile): void => {
        if (!plugin.canRunBackgroundAutomation()) return;
        plugin.notebookNavigatorRuleService.scheduleApply(file, {
            reason: 'create',
            force: true,
        });
        if (file.extension !== 'md') return;
        window.setTimeout(() => {
            if (!plugin.canRunBackgroundAutomation()) return;
            const liveFile = plugin.app.vault.getFileByPath(file.path);
            if (!(liveFile instanceof TFile) || liveFile !== file) return;
            if (plugin.settings.autoSyncTitleFromFilename) {
                void plugin.fileNamingService.syncTitleFromFilename(liveFile, {
                    force: true,
                    onlyIfMissing: true,
                    onlyIfHasFrontmatter: true,
                    bypassCreationGrace: true,
                });
            }
            void plugin.fileNamingService.syncFileTimestamps(liveFile, {
                reason: 'create',
                force: true,
            });
        }, 1500);
    };

    plugin.registerEvent(
        plugin.app.vault.on('create', (file) => {
            if (file instanceof TFile) {
                refreshRelatedParentMenus(plugin.parentLinkResolutionService.onFileCreated(file), 'created-parent-menu-refresh');
            }
            // Initial vault loading announces existing files as creates. Their
            // startup indexes already have owners; they are not new-note work.
            if (plugin.app.workspace.layoutReady === false) return;
            if (file instanceof TFile && plugin.filePropertiesService?.isCompanionFile(file)) return;
            if (file instanceof TFile && plugin.filePropertiesService?.isPropertyTarget(file)) {
                void plugin.filePropertiesService.handleSourceCreate(file).catch((error) => {
                    logger.warn('[TPS GCM] Could not refresh retained file-property availability after source creation', {
                        source: file.path,
                        error,
                    });
                });
            }
            if (!(file instanceof TFile)) return;
            if (file.extension !== 'md') {
                scheduleCreatedFileAutomation(file);
                return;
            }
            // Gate the ordinary post-create writers behind template-instance
            // identity cleanup. A configured Daily Note may be
            // created empty and filled by Core/Periodic Notes or Templater a
            // moment later; running automatic writers first would race those
            // bytes or leave the inherited identity marker in place forever.
            dailyNoteTemplateInstanceCleanup.schedule(file, (result) => {
                const liveFile = result.file;
                if (!(liveFile instanceof TFile)) return;
                if (result.status === 'stripped') {
                    plugin.eventService.emitFilesUpdated([liveFile.path]);
                }
                scheduleCreatedFileAutomation(liveFile);
            });
        }),
    );

    plugin.registerEvent(
        plugin.app.vault.on('rename', (file, oldPath) => {
            if (file instanceof TFile || file instanceof TFolder) {
                refreshRelatedParentMenus(plugin.parentLinkResolutionService.onFileRenamed(file, oldPath), 'renamed-parent-menu-refresh');
            }
            // Match startup ownership: native records do not use the legacy
            // companion index. Keep ordinary title/link handling below active.
            const useLegacyFileProperties = plugin.settings.dataArchitectureMode !== 'native-records';
            if (file instanceof TFolder) {
                if (!useLegacyFileProperties) return;
                const capturedNewPath = file.path;
                void plugin.filePropertiesService.handleSourceFolderRename(file, oldPath, capturedNewPath).catch((error) => {
                    logger.warn('[TPS GCM] Could not reconcile file properties after folder rename', {
                        folder: capturedNewPath,
                        oldPath,
                        error,
                    });
                });
                return;
            }
            if (file instanceof TFile && plugin.filePropertiesService?.isCompanionRename(file, oldPath)) {
                if (!useLegacyFileProperties) return;
                const rejectedExtensionRename = file.extension?.toLocaleLowerCase() !== 'md';
                void plugin.filePropertiesService.handleCompanionRename(file, oldPath).then(() => {
                    if (rejectedExtensionRename) {
                        new Notice('GCM file-property companions must remain Markdown files. The .md extension was restored.');
                    }
                }).catch((error) => {
                    logger.warn('[TPS GCM] Could not refresh a moved file-property companion', {
                        companion: file.path,
                        oldPath,
                        error,
                    });
                    if (rejectedExtensionRename) {
                        new Notice('GCM file-property companions must remain Markdown files. The rename could not be restored; the prior source was invalidated.');
                    }
                });
                return;
            }
            if (file instanceof TFile
                && file.extension?.toLocaleLowerCase() === 'md'
                && oldPath.toLocaleLowerCase().endsWith('.md')) {
                const capturedNewPath = file.path;
                if (useLegacyFileProperties) {
                    void plugin.filePropertiesService.handlePendingMarkdownTargetRename(file, oldPath, capturedNewPath)
                        .catch((error) => {
                            logger.warn('[TPS GCM] Could not advance a pending Markdown file-property target', {
                                source: capturedNewPath,
                                oldPath,
                                error,
                            });
                        });
                }
                // Finish the synchronous rename event before refreshing: a
                // later core view listener can replace the title with its basename.
                // Do not wait for renameFile's unrelated incoming link rewrites.
                if (oldPath.split('/').pop() !== file.path.split('/').pop()) {
                    queueMicrotask(() => plugin.noteTitleRenderService?.handleMetadataChanged(file));
                }
                // Companion bookkeeping must not swallow ordinary filename edits.
                // The committed rename owns title synchronization; no navigation
                // settlement timer or unrelated maintenance is needed here.
                if (plugin.canRunBackgroundAutomation() && plugin.settings.autoSyncTitleFromFilename) {
                    void plugin.fileNamingService.syncTitleFromFilename(file, {
                        bypassCreationGrace: true,
                        renamedFromPath: oldPath,
                    });
                }
                return;
            }
            if (useLegacyFileProperties && file instanceof TFile && (
                file.extension?.toLowerCase() !== 'md'
                || !oldPath.toLowerCase().endsWith('.md')
            )) {
                const capturedNewPath = file.path;
                const capturedCompanion = plugin.filePropertiesService.captureSourceRenameCompanion(oldPath);
                void plugin.filePropertiesService.handleSourceRename(file, oldPath, capturedNewPath, capturedCompanion)
                    .then((companion) => {
                        if (companion
                            && capturedNewPath.toLocaleLowerCase().endsWith('.md')
                            && !oldPath.toLocaleLowerCase().endsWith('.md')) {
                            const capturedName = capturedNewPath.split('/').pop() || capturedNewPath;
                            new Notice(`TPS GCM retained the prior file properties separately for ${capturedName}. A pending Markdown target was recorded; automatic merge is disabled.`);
                        }
                    })
                    .catch((error) => {
                        logger.warn('[TPS GCM] Could not reconcile file properties after source rename', {
                            source: file.path,
                            oldPath,
                            error,
                        });
                    });
            }
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
            if (file instanceof TFile || file instanceof TFolder) {
                refreshRelatedParentMenus(plugin.parentLinkResolutionService.onFileDeleted(file), 'deleted-parent-menu-refresh');
            }
            const useLegacyFileProperties = plugin.settings.dataArchitectureMode !== 'native-records';
            if (useLegacyFileProperties && !(file instanceof TFile)) {
                void plugin.filePropertiesService.handleSourceFolderDelete(file.path).catch((error) => {
                    logger.warn('[TPS GCM] Could not mark file properties missing after folder deletion', {
                        folder: file.path,
                        error,
                    });
                });
            }
            const deletedCompanion = file instanceof TFile && plugin.filePropertiesService?.isCompanionFile(file);
            if (useLegacyFileProperties && file instanceof TFile) {
                plugin.filePropertiesService.invalidatePendingMarkdownTarget(file);
            }
            if (useLegacyFileProperties && deletedCompanion && file instanceof TFile) {
                void plugin.filePropertiesService.handleCompanionDelete(file).catch((error) => {
                    logger.warn('[TPS GCM] Could not invalidate a deleted file-property companion', {
                        companion: file.path,
                        error,
                    });
                });
            }
            if (useLegacyFileProperties && !deletedCompanion && file instanceof TFile && file.extension?.toLowerCase() !== 'md') {
                void plugin.filePropertiesService.handleSourceDelete(file.path).catch((error) => {
                    logger.warn('[TPS GCM] Could not mark file properties missing after source deletion', {
                        source: file.path,
                        error,
                    });
                });
            }
            if (!deletedCompanion && file instanceof TFile) {
                void plugin.bulkEditService.cleanupLinksForDeletedFile(file.path).catch((error) => {
                    logger.flowError('DeletedLinkCleanup', 'failed', error, { deletedPath: file.path });
                });
            }
            if (!deletedCompanion && file instanceof TFile && file.extension === 'md') {
                // Deleted TFiles cannot be sent through scheduleFileRefresh, but
                // mounted linked context still remembers their former source path.
                plugin.persistentMenuManager.invalidateLinkedContextSourcePaths(
                    [file.path],
                    { removedPaths: [file.path] },
                );
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
        surfaces: plugin.settings.enableLinkedSubitemCheckboxes === false
            ? ['menus', 'inline-task-controls']
            : ['menus', 'inline-task-controls', 'linked-subitems'],
        delayMs: 0,
    });
}
