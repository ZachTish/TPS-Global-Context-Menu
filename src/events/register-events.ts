import { TFile, TFolder, Platform, debounce, MarkdownView, WorkspaceLeaf } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { ViewModeService } from '../services/view-mode-service';
import { RemoveHiddenSubitemsModal } from '../modals/remove-hidden-subitems-modal';
import type { BodySubitemLink } from '../services/subitem-types';
import * as logger from '../logger';
import { getViewMode, isStrictSourceMode } from '../services/leaf-resolver';

/**
 * Registers all workspace and vault event listeners on the given plugin instance.
 * Extracted from `onload` to keep main.ts concise.
 *
 * Also performs the initial `ensureMenus()` call at the end.
 */
export function registerGcmEvents(plugin: TPSGlobalContextMenuPlugin): void {

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
            (plugin as any).lastEditorChangeAt = Date.now();
            (plugin as any).typingQuietWindowMs = 1600;
            (plugin as any).isEditorFocused = () => {
                const activeElement = document.activeElement;
                return activeElement instanceof HTMLElement
                    && !!activeElement.closest('.cm-editor, .markdown-source-view.mod-cm6, .canvas-node-content');
            };
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
        }),
    );

    // ── Read-only metadata menu refresh ─────────────────────────────────────

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

    plugin.registerEvent(
        plugin.app.vault.on('create', (file) => {
            if (file instanceof TFile) {
                refreshRelatedParentMenus(plugin.parentLinkResolutionService.onFileCreated(file), 'created-parent-menu-refresh');
            }
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
            if (file instanceof TFolder) return;
            if (file instanceof TFile && plugin.filePropertiesService?.isCompanionRename(file, oldPath)) {
                if (!useLegacyFileProperties) return;
                void plugin.filePropertiesService.handleCompanionRename(file, oldPath).catch((error) => {
                    logger.warn('[TPS GCM] Could not invalidate moved companion metadata', { oldPath, error });
                });
                return;
            }
            if (file instanceof TFile
                && file.extension?.toLocaleLowerCase() === 'md'
                && oldPath.toLocaleLowerCase().endsWith('.md')) {
                // Finish the synchronous rename event before refreshing: a
                // later core view listener can replace the title with its basename.
                // Do not wait for renameFile's unrelated incoming link rewrites.
                if (oldPath.split('/').pop() !== file.path.split('/').pop()) {
                    queueMicrotask(() => plugin.noteTitleRenderService?.handleMetadataChanged(file));
                }
                return;
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
            if (file instanceof TFile && file.extension === 'md') {
                overlayRendering.scheduleFileRefresh(file, 'rename', { delayMs: 300 });
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
            const deletedCompanion = file instanceof TFile && plugin.filePropertiesService?.isCompanionFile(file);
            if (useLegacyFileProperties && deletedCompanion && file instanceof TFile) {
                void plugin.filePropertiesService.handleCompanionDelete(file).catch((error) => {
                    logger.warn('[TPS GCM] Could not invalidate a deleted file-property companion', {
                        companion: file.path,
                        error,
                    });
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
