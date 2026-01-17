import { Component, MarkdownView, TFile, WorkspaceLeaf, debounce } from "obsidian";
import TPSGlobalContextMenuPlugin from "./main";
import * as logger from "./logger";

export class ViewModeManager extends Component {
    plugin: TPSGlobalContextMenuPlugin;

    constructor(plugin: TPSGlobalContextMenuPlugin) {
        super();
        this.plugin = plugin;
    }

    onload() {
        // Debounce the event handler to prevent rapid firing when switching modes triggers updates
        const debouncedHandler = debounce(this.handleActiveLeafable.bind(this), 500, false);
        this.registerEvent(this.plugin.app.workspace.on('active-leaf-change', debouncedHandler));

        // Listen to metadata changes (handling race conditions where cache isn't ready on open)
        // Use longer debounce to prevent lag during typing
        const metadataDebouncedHandler = debounce((file: TFile) => {
            const leaf = this.plugin.app.workspace.activeLeaf;
            if (leaf && leaf.view instanceof MarkdownView && leaf.view.file === file) {
                debouncedHandler(leaf);
            }
        }, 1500, false); // 1.5 second debounce to prevent checks during active typing

        this.plugin.registerEvent(this.plugin.app.metadataCache.on('changed', (file) => {
            metadataDebouncedHandler(file);
        }));

        this.plugin.addCommand({
            id: 'force-view-mode-check',
            name: 'Force View Mode Check',
            editorCallback: (editor, view) => {
                const leaf = this.plugin.app.workspace.activeLeaf;
                this.handleActiveLeafable(leaf ?? null);
            }
        });
    }

    async handleActiveLeafable(leaf: WorkspaceLeaf | null) {
        if (!this.plugin.settings.enableViewModeSwitching) {
            // logger.log('[TPS GCM] View Mode Switching Disabled via Settings');
            return;
        }

        // If no leaf passed (e.g. from file-open generic handler), try to get active leaf
        if (!leaf) {
            leaf = this.plugin.app.workspace.activeLeaf;
        }

        if (!leaf || !(leaf.view instanceof MarkdownView)) return;

        // Strict view type check to avoid interfering with custom views that inherit from MarkdownView (e.g. Kanban, Excalidraw, Feed Bases)
        if (leaf.view.getViewType() !== 'markdown') return;

        const view = leaf.view as MarkdownView;
        const file = view.file;
        if (!file) return;

        // Check excluded folders
        if (this.plugin.settings.viewModeIgnoredFolders) {
            const ignored = this.plugin.settings.viewModeIgnoredFolders.split('\n').map(p => p.trim()).filter(Boolean);
            if (ignored.some(path => file.path.startsWith(path))) {
                logger.log(`[TPS GCM] Skipping view mode check for ${file.basename} (Path ignored: ${file.path})`);
                return;
            }
        }

        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;

        if (!frontmatter) {
            // logger.log(`[TPS GCM] No frontmatter for ${file.basename}`);
            return;
        }

        let targetMode = null;

        // Check explicit key ONLY if enabled/configured
        if (this.plugin.settings.viewModeFrontmatterKey) {
            const key = this.plugin.settings.viewModeFrontmatterKey;
            const explicitMode = frontmatter[key];

            // Validate mode value
            const validModes = ['source', 'preview', 'reading', 'live'];
            if (explicitMode && validModes.includes(String(explicitMode).toLowerCase())) {
                targetMode = explicitMode;
            } else if (explicitMode) {
                logger.log(`[TPS GCM] Frontmatter key '${key}' found value '${explicitMode}' which is not a valid mode. Ignoring.`);
            }
        }

        // Fallback to generic rules if no explicit view mode is set
        if (!targetMode && this.plugin.settings.viewModeRules) {
            const rule = this.plugin.settings.viewModeRules.find(r => {
                // Loose equality check or string stringification for safe comparison
                const fmVal = frontmatter[r.key];
                const match = String(fmVal) === String(r.value);

                logger.log(`[TPS GCM] Checking rule: Key=${r.key}, RuleValue=${r.value}, FmValue=${fmVal}, Match=${match}`);
                return match;
            });
            if (rule) {
                targetMode = rule.mode;
                logger.log(`[TPS GCM] Rule matched! Setting mode to ${targetMode}`);
            }
        }

        if (!targetMode) return;

        // Normalize mode
        // obsidian uses 'source' (which can be live preview or actual source) and 'preview' (reading)

        const state = leaf.getViewState();
        let needsUpdate = false;

        logger.log(`[TPS GCM] Current State for ${file.basename}: mode=${state.state.mode}, source=${state.state.source}`);
        logger.log(`[TPS GCM] Target Mode: ${targetMode}`);

        if (targetMode === 'reading' || targetMode === 'preview') {
            if (state.state.mode !== 'preview') {
                state.state.mode = 'preview';
                needsUpdate = true;
            }
        } else if (targetMode === 'source') {
            if (state.state.mode !== 'source' || state.state.source !== true) {
                state.state.mode = 'source';
                state.state.source = true; // true = Source Mode (Legacy Editor)
                needsUpdate = true;
            }
        } else if (targetMode === 'live') {
            if (state.state.mode !== 'source' || state.state.source !== false) {
                state.state.mode = 'source';
                state.state.source = false; // false = Live Preview
                needsUpdate = true;
            }
        }


        if (needsUpdate) {
            logger.log(`[TPS GCM] Switching view mode for ${file.basename} to ${targetMode}`);
            try {
                // specific hack for the error "RangeError: Field is not present in this state"
                // which happens when setViewState interrupts a view that is trying to save history
                // We clone the state and ensure we are attending to the latest leaf version
                const newState = JSON.parse(JSON.stringify(state));
                await leaf.setViewState(newState);
            } catch (err) {
                logger.error(`[TPS GCM] Failed to set view state for ${file.basename}`, err);
            }
        } else {
            logger.log(`[TPS GCM] No update needed.`);
        }
    }
}
