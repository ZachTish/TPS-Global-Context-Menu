import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const managerSource = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');
const eventSource = readFileSync(new URL('../src/events/register-events.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');
const panelBuilderSource = readFileSync(new URL('../src/menu/panel-builder.ts', import.meta.url), 'utf8');
const propertyRowSource = readFileSync(new URL('../src/services/property-row-service.ts', import.meta.url), 'utf8');
const fieldInitializationSource = readFileSync(new URL('../src/services/field-initialization-service.ts', import.meta.url), 'utf8');
const webLinkUtilsSource = readFileSync(new URL('../src/utils/web-link-utils.ts', import.meta.url), 'utf8');
const contextTargetSource = readFileSync(new URL('../src/services/context-target-service.ts', import.meta.url), 'utf8');
const virtualBaseEmbedSource = readFileSync(new URL('../src/services/virtual-base-embed-service.ts', import.meta.url), 'utf8');
const constantsSource = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const dailyNavSource = readFileSync(new URL('../src/handlers/daily-note-nav-manager.ts', import.meta.url), 'utf8');
const refreshMenusSource = managerSource.slice(
  managerSource.indexOf('refreshMenusForFile(\n'),
  managerSource.indexOf('private shouldDeferStructuralRefreshForTyping'),
);
const responsiveRefreshSource = eventSource.slice(
  eventSource.indexOf('const scheduleResponsiveMenuRefresh ='),
  eventSource.indexOf("plugin.registerEvent(plugin.app.workspace.on('layout-change'"),
);
const viewModeTransitionSource = managerSource.slice(
  managerSource.indexOf('public handleViewModeMaybeChanged'),
  managerSource.indexOf('private removeGlobalStraysOutsideTarget'),
);
const activeModePollSource = eventSource.slice(
  eventSource.indexOf('let lastActiveModeSignature'),
  eventSource.indexOf("plugin.registerEvent(\n        plugin.app.workspace.on('editor-change'"),
);

test('mobile property selectors update their checked option immediately', () => {
  assert.match(propertyRowSource, /setCheckedStatus\(status\)/);
  assert.match(propertyRowSource, /setCheckedPriority\(priority\)/);
  assert.match(propertyRowSource, /setCheckedValue\(opt\)/);
  assert.match(propertyRowSource, /PropertySelector', 'status:checked-state/);
  assert.match(propertyRowSource, /PropertySelector', 'priority:checked-state/);
  assert.match(panelBuilderSource, /PropertySelector', 'stacked:checked-state/);
  assert.match(panelBuilderSource, /setCheckedValue\(option\)/);
  assert.match(panelBuilderSource, /refreshStackedPropertyValue\(anchor, entries, prop\)/);
  assert.match(panelBuilderSource, /afterStackedPropertyEdit\(files, \[key\], false\)/);
  assert.match(propertyRowSource, /PropertySelector', 'refresh:await-metadata-cache/);
  assert.doesNotMatch(propertyRowSource, /for \(const file of files\) \{\s*this\.plugin\.persistentMenuManager\?\.refreshMenusForFile\(file, true\);/);
});

test('stacked properties are not structurally rebuilt while typing', () => {
  assert.match(managerSource, /postTypingStructuralRefreshTimers/);
  assert.match(managerSource, /shouldDeferStructuralRefreshForTyping\(view, file\)/);
  assert.match(managerSource, /this\.schedulePostTypingStructuralRefresh\(file\)/);
  assert.match(managerSource, /continue;/);
  assert.ok(
    refreshMenusSource.indexOf('if (deferStructuralRefresh)') < refreshMenusSource.indexOf('this.applyPersistentMenuGeometry(view, instances.live)'),
    'typing defer check should run before menu geometry/header updates',
  );
  assert.ok(
    refreshMenusSource.indexOf('if (deferStructuralRefresh)') < refreshMenusSource.indexOf('this.removeInlineSubitemsPanel(view)'),
    'typing defer check should run before inline panel removal',
  );
  assert.match(managerSource, /getTypingQuietWindowMs\(\) \+ 120/);
  assert.match(managerSource, /isViewEditorFocused\(view\)/);
  assert.match(managerSource, /this\.isViewEditorFocused\(view\)/);
  assert.match(managerSource, /view\.contentEl\.contains\(editorRoot\)/);
  assert.match(eventSource, /\(plugin as any\)\.lastEditorChangeAt = Date\.now\(\)/);
  assert.match(eventSource, /\(plugin as any\)\.typingQuietWindowMs = 1600/);
  assert.match(eventSource, /canvas-node-content/);
  assert.match(responsiveRefreshSource, /reason: 'responsive-menu-refresh'/);
  assert.doesNotMatch(responsiveRefreshSource, /ensureMenus: true/);
});

test('reading/live preview mode switches do not repeatedly tear down properties', () => {
  assert.match(viewModeTransitionSource, /prepareForViewModeTransition\(view\)/);
  assert.match(viewModeTransitionSource, /this\.scheduleAttachRetry\(view, 120\)/);
  assert.doesNotMatch(viewModeTransitionSource, /cleanupForViewModeTransition/);
  assert.doesNotMatch(viewModeTransitionSource, /window\.setTimeout\(\(\) => this\.ensureMenus\(\), 120\)/);
  assert.doesNotMatch(viewModeTransitionSource, /window\.setTimeout\(\(\) => this\.ensureMenus\(\), 350\)/);
  assert.doesNotMatch(viewModeTransitionSource, /removeTopParentNav\(view\)/);
  assert.match(managerSource, /existing\.dataset\.signature === signature/);
  assert.match(managerSource, /this\.removeTopParentNav\(view, \{ reserveFootprint: false \}\)/);
  assert.match(activeModePollSource, /surfaces: \['daily-nav'\]/);
  assert.doesNotMatch(activeModePollSource, /ensureMenus: true/);
  assert.doesNotMatch(activeModePollSource, /refreshLivePreviewEditors: true/);
});

test('manual file renames force settled title sync from the new basename', () => {
  const renameHandlerSource = eventSource.slice(
    eventSource.indexOf("plugin.app.vault.on('rename'"),
    eventSource.indexOf("plugin.register(() => plugin.persistentMenuManager.detach())"),
  );

  assert.match(renameHandlerSource, /runAfterNavigationRenameSettles\(\(\) => \{/);
  assert.match(renameHandlerSource, /syncTitleFromFilename\(liveFile,\s*\{\s*force: true,\s*bypassCreationGrace: true,\s*\}\)/);
  assert.doesNotMatch(renameHandlerSource, /if \(plugin\.settings\.autoSyncTitleFromFilename\)[\s\S]*?syncTitleFromFilename/);
  assert.match(renameHandlerSource, /syncFileTimestamps\(liveFile,\s*\{\s*reason: 'rename',\s*force: true,\s*\}\)/);
  assert.match(eventSource, /isNavigationTextInputActive/);
});

test('plugin-owned file opens reuse existing tabs or the current unpinned tab without hijacking native opens', () => {
  const helperSource = mainSource.slice(
    mainSource.indexOf('async openFileInLeaf('),
    mainSource.indexOf('private isPinnedLeafForDifferentFile'),
  );
  const nativeOpenSource = mainSource.slice(
    mainSource.indexOf('WorkspaceLeaf.prototype.openFile = function'),
    mainSource.indexOf('WorkspaceLeaf.prototype.open = function'),
  );
  const baseLinkPreviewHandlerSource = mainSource.slice(
    mainSource.indexOf('private registerBasesLinkPreviewHandler('),
    mainSource.indexOf('private isBasesForcedLinkPreviewEnabled('),
  );
  const nativeSetViewStateSource = mainSource.slice(
    mainSource.indexOf('WorkspaceLeaf.prototype.setViewState = function'),
    mainSource.indexOf('if (typeof originalOpenLinkText ==='),
  );

  assert.match(helperSource, /reuseLeafIfNoExisting\?: boolean/);
  assert.match(helperSource, /const liveFile = requestedPath \? this\.app\.vault\.getAbstractFileByPath\(requestedPath\) : null/);
  assert.match(helperSource, /if \(!\(liveFile instanceof TFile\)\)/);
  assert.match(helperSource, /file = liveFile/);
  assert.doesNotMatch(helperSource, /const shouldOpenMissingDefaultInNewTab =/);
  assert.doesNotMatch(helperSource, /this\.detachStaleOpenLeavesForFile\(file\)/);
  assert.match(helperSource, /const existingLeaf = this\.findOpenLeafForFile\(file\)/);
  assert.doesNotMatch(helperSource, /this\.detachDuplicateOpenLeavesForFile\(file, existingLeaf\)/);
  assert.doesNotMatch(helperSource, /ensureMarkdownLeafRendered/);
  assert.match(mainSource, /const openActiveForMount = openActive \|\| this\.isBlankLeaf\(leaf\)/);
  assert.match(mainSource, /if \(!this\.isBlankLeaf\(leaf\) && leafViewType !== 'markdown'\)/);
  assert.match(mainSource, /this\.logOpenerDecision\('avoid-non-markdown-leaf'/);
  assert.match(mainSource, /leaf = this\.app\.workspace\.getLeaf\('tab'\)/);
  assert.match(mainSource, /routedFromNonMarkdownLeaf && file\.extension === 'md'/);
  assert.match(mainSource, /await leaf\.setViewState\(\{\s*type: 'markdown',\s*state: \{ file: file\.path \}/);
  assert.match(mainSource, /await leaf\.openFile\(file, \{ active: openActiveForMount \} as any\)/);
  assert.match(mainSource, /private isBlankLeaf\(leaf: WorkspaceLeaf\): boolean/);
  assert.match(mainSource, /viewType && viewType !== 'empty'/);
  assert.match(mainSource, /return !this\.getLeafViewStatePath\(leaf\)/);
  assert.match(mainSource, /private isMountedMarkdownLeaf\(leaf: WorkspaceLeaf\): boolean/);
  assert.match(mainSource, /private isUsableMarkdownLeaf\(leaf: WorkspaceLeaf\): boolean/);
  assert.doesNotMatch(mainSource, /private isRestoredEmptyPinnedLeaf\(leaf: WorkspaceLeaf\): boolean/);
  assert.doesNotMatch(mainSource, /async ensureMarkdownLeafRendered\(file: TFile, leaf: WorkspaceLeaf, active: boolean\): Promise<WorkspaceLeaf>/);
  assert.doesNotMatch(mainSource, /private readonly debouncedRepairBlankMarkdownLeaves = debounce/);
  assert.doesNotMatch(mainSource, /private scheduleBlankMarkdownLeafRepair\(reason: string, delayMs: number\): void/);
  assert.doesNotMatch(mainSource, /private async repairBlankMarkdownLeaves\(reason: string\): Promise<void>/);
  assert.doesNotMatch(mainSource, /this\.scheduleBlankMarkdownLeafRepair\('layout-ready', 900\)/);
  assert.doesNotMatch(mainSource, /this\.scheduleBlankMarkdownLeafRepair\('layout-ready-late', 2500\)/);
  assert.doesNotMatch(mainSource, /this\.scheduleBlankMarkdownLeafRepair\('layout-change', 900\)/);
  assert.doesNotMatch(mainSource, /this\.isRestoredEmptyPinnedLeaf\(leaf\) && leaf !== this\.app\.workspace\.activeLeaf/);
  assert.doesNotMatch(mainSource, /Left restored pinned empty leaf attached/);
  assert.doesNotMatch(mainSource, /Left inactive unrestored markdown leaf attached after same-leaf repair attempt/);
  assert.doesNotMatch(mainSource, /const replacementLeaf = this\.app\.workspace\.getLeaf\(true\)/);
  assert.doesNotMatch(mainSource, /await replacementLeaf\.openFile\(file, \{ active: true \} as any\)/);
  assert.doesNotMatch(mainSource, /Failed to detach blank markdown leaf after replacement open/);
  assert.doesNotMatch(mainSource, /this\.ensureLeafPinned\(replacement\)/);
  assert.doesNotMatch(mainSource, /defaultOpenCreatedLeaves/);
  assert.doesNotMatch(mainSource, /defaultMarkdownOpenPromises/);
  assert.doesNotMatch(mainSource, /recordDefaultOpenCreatedLeaf/);
  assert.doesNotMatch(mainSource, /getDefaultOpenSourceLeaf/);
  assert.doesNotMatch(mainSource, /consumeDefaultOpenCreatedLeaf/);
  assert.doesNotMatch(mainSource, /detachUnusedDefaultOpenLeaf/);
  assert.doesNotMatch(mainSource, /isMainWorkspaceLeaf/);
  assert.doesNotMatch(mainSource, /workspaceContainsLeaf/);
  assert.doesNotMatch(nativeOpenSource, /consumeDefaultOpenCreatedLeaf/);
  assert.doesNotMatch(nativeOpenSource, /rerouteDefaultMarkdownOpen/);
  assert.match(nativeOpenSource, /return originalLeafOpenFile\.apply\(this, args as any\)/);
  assert.doesNotMatch(mainSource, /Left unrestored markdown leaf attached after same-leaf repair attempt/);
  assert.doesNotMatch(mainSource, /private waitForWorkspaceRender\(delayMs: number\): Promise<void>/);
  assert.match(mainSource, /private getLeafViewStatePath\(leaf: WorkspaceLeaf\): string/);
  assert.match(mainSource, /private detachStaleOpenLeavesForFile\(file: TFile\): void/);
  assert.match(mainSource, /private detachDuplicateOpenLeavesForFile\(file: TFile, keepLeaf: WorkspaceLeaf\): void/);
  assert.doesNotMatch(mainSource, /this\.isRestoredEmptyPinnedLeaf\(leaf\) && leaf !== this\.app\.workspace\.activeLeaf/);
  assert.doesNotMatch(mainSource, /Left restored pinned empty leaf attached/);
  assert.doesNotMatch(mainSource, /if \(viewFile instanceof TFile && viewFile\.path !== file\.path\) return;\s*void leaf\.detach\(\)/);
  assert.match(mainSource, /if \(leaf === this\.app\.workspace\.activeLeaf && this\.isMountedMarkdownLeaf\(leaf\)\) return null;/);
  assert.doesNotMatch(mainSource, /if \(leaf === this\.app\.workspace\.activeLeaf && this\.isMountedMarkdownLeaf\(leaf\)\) return;\s*const statePath = this\.getLeafViewStatePath\(leaf\)/);
  assert.doesNotMatch(mainSource, /let matches = false/);
  assert.doesNotMatch(mainSource, /let hasViewFile = false/);
  const findOpenLeafSource = mainSource.slice(
    mainSource.indexOf('findOpenLeafForFile(file: TFile): WorkspaceLeaf | null'),
    mainSource.indexOf('collapseDuplicateOpenLeavesForFile'),
  );
  assert.match(findOpenLeafSource, /const viewFile = \(leaf\.view as any\)\?\.file/);
  assert.match(findOpenLeafSource, /if \(!\(viewFile instanceof TFile\) \|\| viewFile\.path !== file\.path\) return/);
  assert.doesNotMatch(findOpenLeafSource, /getLeafViewStatePath/);
  assert.match(mainSource, /const mounted = this\.isUsableMarkdownLeaf\(leaf\)/);
  assert.match(mainSource, /const score = \(mounted \? 100 : 0\) \+ \(active \? 20 : 0\)/);
  assert.match(mainSource, /return best\?\.leaf \?\? null/);
  assert.doesNotMatch(findOpenLeafSource, /statePath === file\.path/);
  assert.match(mainSource, /\.markdown-source-view, \.markdown-preview-view, \.markdown-reading-view/);
  assert.match(mainSource, /const markdownText = \(markdownRoot\.textContent \|\| ''\)\.trim\(\)\.length > 0/);
  assert.match(mainSource, /if \(!contentRoot\) return markdownText \|\| \(file instanceof TFile && file\.stat\.size === 0\)/);
  assert.match(mainSource, /if \(contentRect\.width < 10 \|\| contentRect\.height < 10\) return markdownText/);
  assert.match(mainSource, /if \(file instanceof TFile && file\.stat\.size > 0 && !hasRenderedText && !markdownText\) return false/);
  assert.match(mainSource, /return contentRoot\.childElementCount > 0 \|\| hasRenderedText \|\| markdownText \|\| \(file instanceof TFile && file\.stat\.size === 0\)/);
  assert.match(mainSource, /collapseDuplicateOpenLeavesForFile\(file: TFile, keepLeaf: WorkspaceLeaf\): void/);
  assert.doesNotMatch(mainSource, /this\.detachDuplicateOpenLeavesForFile\(file, keepLeaf\)/);
  assert.doesNotMatch(mainSource, /const focusOpenLeaf =/);
  assert.doesNotMatch(mainSource, /const rerouteDefaultMarkdownOpen =/);
  assert.ok(
    helperSource.indexOf('const existingLeaf = this.findOpenLeafForFile(file)') < helperSource.indexOf('let leaf = getLeaf()'),
    'existing file tabs should be reused before opening the requested leaf',
  );
  assert.match(helperSource, /let leaf = getLeaf\(\)/);
  assert.match(helperSource, /if \(this\.isPinnedLeafForDifferentFile\(leaf, file\)\)/);
  assert.doesNotMatch(helperSource, /await this\.ensureMarkdownLeafRendered\(file, openedLeaf, openActive\)/);
  assert.match(helperSource, /openActive\s*\?\s*await this\.commandQueueService\.executeOpenActiveFile\(file, openFile\)\s*:\s*await this\.commandQueueService\.executeOpenInNewContext\(file, 'tab', openFile\)/);
  assert.doesNotMatch(nativeOpenSource, /plugin\.shouldRerouteDefaultMarkdownOpen\(this, targetFile, args\[1\]\)/);
  assert.doesNotMatch(nativeOpenSource, /const rerouteDefaultMarkdownOpen =/);
  assert.doesNotMatch(nativeOpenSource, /plugin\.detachStaleOpenLeavesForFile\(file\)/);
  assert.doesNotMatch(nativeOpenSource, /plugin\.defaultMarkdownOpenPromises\.get\(file\.path\)/);
  assert.doesNotMatch(nativeOpenSource, /plugin\.defaultMarkdownOpenPromises\.set\(file\.path, promise\)/);
  assert.doesNotMatch(nativeOpenSource, /plugin\.defaultMarkdownOpenPromises\.delete\(file\.path\)/);
  assert.doesNotMatch(nativeOpenSource, /return pending\.then\(\(\) => focusOpenLeaf\(file\)\)/);
  assert.match(nativeOpenSource, /return originalLeafOpenFile\.apply\(this, args as any\)/);
  assert.doesNotMatch(mainSource, /const previousActiveLeaf = workspace\.activeLeaf \?\? null/);
  assert.doesNotMatch(mainSource, /const previousMostRecentLeaf = typeof workspace\.getMostRecentLeaf === 'function'/);
  assert.doesNotMatch(mainSource, /const sourceLeaf = plugin\.getDefaultOpenSourceLeaf\(previousActiveLeaf, previousMostRecentLeaf, leaf\)/);
  assert.doesNotMatch(mainSource, /plugin\.recordDefaultOpenCreatedLeaf\(leaf, sourceLeaf\)/);
  assert.doesNotMatch(mainSource, /const originalSetActiveLeaf = workspace\.setActiveLeaf/);
  assert.doesNotMatch(mainSource, /const originalRevealLeaf = workspace\.revealLeaf/);
  assert.doesNotMatch(mainSource, /workspace\.setActiveLeaf = function/);
  assert.doesNotMatch(mainSource, /workspace\.revealLeaf = function/);
  assert.doesNotMatch(mainSource, /logSuppressedOpen\(\s*'workspace\.setActiveLeaf'/);
  assert.doesNotMatch(mainSource, /logSuppressedOpen\(\s*'workspace\.revealLeaf'/);
  assert.doesNotMatch(nativeSetViewStateSource, /plugin\.app\.vault\.getAbstractFileByPath\(target\)/);
  assert.doesNotMatch(nativeSetViewStateSource, /plugin\.shouldRerouteDefaultMarkdownOpen\(this, targetFile, viewState\)/);
  assert.doesNotMatch(nativeSetViewStateSource, /const reroutedViewState = plugin\.withUnpinnedViewState\(viewState\)/);
  assert.match(nativeSetViewStateSource, /return originalLeafSetViewState\.apply\(this, args as any\)/);
  assert.doesNotMatch(mainSource, /private withUnpinnedViewState\(viewState: unknown\): unknown/);
  assert.doesNotMatch(nativeOpenSource, /sourceWasPinned/);
  assert.doesNotMatch(nativeOpenSource, /plugin\.ensureLeafUnpinned\(leaf\)/);
  assert.doesNotMatch(nativeOpenSource, /plugin\.ensureLeafPinned\(sourceLeaf\)/);
  assert.doesNotMatch(nativeOpenSource, /originalLeafOpenFile\.call\(sourceLeaf, sourceFile/);
  assert.match(mainSource, /private getLeafViewStatePath\(leaf: WorkspaceLeaf\): string/);
  assert.doesNotMatch(findOpenLeafSource, /const statePath = this\.getLeafViewStatePath\(leaf\)/);
  assert.doesNotMatch(mainSource, /private shouldRerouteDefaultMarkdownOpen/);
  assert.doesNotMatch(mainSource, /recentNotebookNavigatorOpenUntil/);
  assert.doesNotMatch(mainSource, /leafTargetsDifferentFile/);
  assert.doesNotMatch(mainSource, /native-inactive-reroute/);
  assert.doesNotMatch(mainSource, /source: 'occupied-leaf'/);
  assert.doesNotMatch(mainSource, /this\.logOpenerDecision\('native-pinned-reroute'/);
  assert.match(mainSource, /private getLeafMarkdownFile\(leaf: WorkspaceLeaf\): TFile \| null/);
  assert.match(baseLinkPreviewHandlerSource, /this\.clearRecentBaseLinkPreviewPointer\(\)/);
  assert.match(baseLinkPreviewHandlerSource, /registerDomEvent\(document, 'click'/);
  assert.match(baseLinkPreviewHandlerSource, /this\.isBasesForcedLinkPreviewEnabled\(\)/);
  assert.match(baseLinkPreviewHandlerSource, /this\.resolveBasesNoteLinkTarget\(target\)/);
  assert.match(baseLinkPreviewHandlerSource, /openBaseLinkInHoverEditor/);
  assert.match(baseLinkPreviewHandlerSource, /this\.basesLinkPreviewArmedUntil = now \+ 900/);
  assert.match(
    mainSource,
    /private shouldInstallWorkspaceOpenPatch\(\): boolean \{\s*return this\.settings\.enableCanvasOpenGuard === true;\s*\}/,
  );
  assert.doesNotMatch(mainSource, /shouldAllowNativeBaseLinkOpen/);
  assert.doesNotMatch(mainSource, /interceptNativeBaseLinkOpen/);
});

test('mobile gesture collapse keeps persistent note header properties visible', () => {
  assert.doesNotMatch(stylesSource, /body\.tps-gcm-gesture-collapsed \.tps-gcm-top-properties-placeholder/);
  assert.doesNotMatch(stylesSource, /body\.tps-gcm-gesture-collapsed \.tps-gcm-top-properties-list/);
  assert.doesNotMatch(stylesSource, /body\.tps-gcm-gesture-collapsed \.tps-gcm-top-property-row/);
  assert.doesNotMatch(stylesSource, /body\.tps-gcm-gesture-collapsed\.is-mobile \.tps-gcm-top-properties-panel/);
  assert.doesNotMatch(stylesSource, /body\.tps-gcm-gesture-collapsed\.is-phone \.tps-gcm-top-properties-panel/);
  assert.doesNotMatch(stylesSource, /tps-context-hidden-for-keyboard \.tps-gcm-title-icon/);
  assert.doesNotMatch(stylesSource, /tps-context-hidden-for-keyboard .*metadata-container/);
  assert.match(stylesSource, /tps-context-hidden-for-keyboard \.tps-gcm-top-parent-nav:not\(\.tps-gcm-top-parent-nav--with-properties\)/);
  assert.doesNotMatch(stylesSource, /tps-context-hidden-for-keyboard \.tps-gcm-top-parent-nav,\n/);
  assert.match(managerSource, /menuEl\.classList\.toggle\('tps-gcm-gesture-collapsed', this\.swipeCollapsed\)/);
  assert.match(managerSource, /if \(this\.swipeCollapsed \|\| keyboardHidden\)/);
  assert.doesNotMatch(managerSource, /isMobileStackedPropertiesMode/);
});

test('mobile note scroll is not intercepted by persistent menu touch gestures', () => {
  const swipeSource = managerSource.slice(
    managerSource.indexOf('private ensureSwipeGestureTracking'),
    managerSource.indexOf('private releaseSwipeGestureTracking'),
  );

  assert.match(swipeSource, /const isMobile = this\.isMobileLayout\(\)/);
  assert.match(swipeSource, /const HIDE_THRESHOLD = isMobile \? 96 : 36/);
  assert.match(swipeSource, /const SHOW_THRESHOLD = isMobile \? 64 : 6/);
  assert.match(swipeSource, /scroller\.addEventListener\('scroll', state\.listener, \{ passive: true \}\)/);
  assert.doesNotMatch(swipeSource, /addEventListener\('touchmove'/);
  assert.doesNotMatch(swipeSource, /TouchEvent|touchState|TOUCH_/);
});

test('daily note navigation reuses the active daily-note tab', () => {
  const goToDateSource = dailyNavSource.slice(
    dailyNavSource.indexOf('async goToDate'),
    dailyNavSource.indexOf('private async confirmCreateDailyNote'),
  );

  assert.match(goToDateSource, /const targetLeaf = sourceLeaf \?\? this\.getTargetLeaf\(\)\?\.leaf \?\? this\._currentLeaf/);
  assert.match(goToDateSource, /reuseLeafIfNoExisting: true/);
});

test('mobile collapsed inline property pills remain horizontally scrollable', () => {
  assert.match(panelBuilderSource, /className = 'tps-gcm-context-strip'/);
  assert.match(stylesSource, /body\.is-mobile \.tps-global-context-menu--persistent \.tps-gcm-context-strip/);
  assert.match(stylesSource, /body\.is-phone \.tps-global-context-menu--persistent \.tps-gcm-context-strip/);
  assert.match(stylesSource, /body\.is-tablet \.tps-global-context-menu--persistent \.tps-gcm-context-strip/);
  assert.match(stylesSource, /overflow-x: auto;/);
  assert.match(stylesSource, /overflow-y: hidden;/);
  assert.match(stylesSource, /-webkit-overflow-scrolling: touch;/);
  assert.match(stylesSource, /overscroll-behavior-x: contain;/);
  assert.match(stylesSource, /touch-action: pan-x;/);
  assert.match(stylesSource, /touch-action: pan-x !important;/);
  assert.match(stylesSource, /scroll-snap-type: x proximity;/);
  assert.match(stylesSource, /:has\(\.tps-gcm-context-strip\) \.tps-gcm-bottom-parent-nav/);
  assert.match(stylesSource, /display: none !important;/);
  assert.match(stylesSource, /body\.is-mobile \.tps-global-context-menu--persistent \.tps-gcm-context-strip > \*/);
  assert.match(stylesSource, /flex: 0 0 auto;/);
  assert.doesNotMatch(stylesSource, /body\.is-mobile \.tps-global-context-menu--persistent \.tps-gcm-context-strip \.tps-gcm-chip,[\s\S]{0,180}touch-action: auto !important/);
});

test('inline properties add existing fields before opening their editor', () => {
  assert.match(panelBuilderSource, /openAddPropertyMenu\(addPropertyButton, file, entries, frontmatter\)/);
  assert.match(panelBuilderSource, /setTitle\('Create new custom property'\)/);
  assert.match(panelBuilderSource, /const scopedProperties = resolveCustomProperties/);
  assert.match(panelBuilderSource, /showWhen: 'always' as const/);
  assert.match(panelBuilderSource, /insertConfiguredPropertyAndEdit/);
  assert.match(panelBuilderSource, /initializeIfMissing\(entries, key, this\.getDefaultPropertyValue\(prop\)\)/);
  assert.match(panelBuilderSource, /this\.openStackedPropertyEditor\(anchor, entries, prop\)/);
  assert.match(fieldInitializationSource, /async initializeIfMissing/);
});

test('TPS Health food notes can show stacked properties despite asset ignore rules', () => {
  assert.match(managerSource, /keepStackedPropertiesForIgnoredFile/);
  assert.match(managerSource, /this\.isTpsHealthFoodPropertyRecord\(file\)/);
  assert.match(managerSource, /kind === 'food'/);
  assert.match(managerSource, /includes\('tps\/food'\)/);
  assert.match(managerSource, /const showStackedProperties = wantsTopProperties && !this\.isStrictSourceMode\(view\)/);
  assert.doesNotMatch(managerSource, /shouldSuppressStackedPropertiesForNativeProperties/);
  assert.doesNotMatch(managerSource, /getPropertiesInDocumentConfig/);
  assert.match(
    stylesSource,
    /\.tps-gcm-stacked-properties-active \.metadata-container\s*\{[\s\S]{0,120}display: none !important/,
    'GCM stacked properties should hide the native metadata block to avoid duplicate property sections',
  );
});

test('custom property renderers recognize external web links', () => {
  assert.match(webLinkUtilsSource, /extractWebLink/);
  assert.match(webLinkUtilsSource, /https\?:\\\/\\\//);
  assert.match(panelBuilderSource, /populateTextOrWebLink/);
  assert.match(panelBuilderSource, /createLinkValueChip[\s\S]*extractWebLink\(link\)/);
  assert.match(propertyRowSource, /extractWebLink\(tag\)/);
  assert.match(stylesSource, /\.tps-gcm-external-link/);
  assert.match(stylesSource, /text-decoration:\s*underline/);
});

test('TPS Controller reminder rows are managed native menu targets', () => {
  assert.match(contextTargetSource, /TPS_NOTIFICATION_TARGET_SELECTOR/);
  assert.match(contextTargetSource, /\.tps-notification-item/);
  assert.match(contextTargetSource, /\[data-tps-notification-path\]/);
  assert.match(contextTargetSource, /resolveExplorerPath[\s\S]*tps-notification-item/);
});

test('frontmatter-driven virtual base embeds render at top, bottom, and hover placements', () => {
  assert.match(constantsSource, /enableVirtualBaseEmbeds:\s*true/);
  assert.match(constantsSource, /gcmBaseTop[\s\S]*placement:\s*'top'/);
  assert.match(constantsSource, /gcmBaseBottom[\s\S]*placement:\s*'bottom'/);
  assert.match(constantsSource, /gcmBaseHover[\s\S]*placement:\s*'hover'/);
  assert.match(mainSource, /new VirtualBaseEmbedService\(this\)/);
  assert.match(mainSource, /normalizeVirtualBaseEmbedProperties/);
  assert.match(virtualBaseEmbedSource, /metadataCache\.getFileCache\(file\)\?\.frontmatter/);
  assert.match(virtualBaseEmbedSource, /candidate\.toLowerCase\(\) === key\.toLowerCase\(\)/);
  assert.match(virtualBaseEmbedSource, /flattenFrontmatterValue/);
  assert.match(virtualBaseEmbedSource, /resolveBaseFile/);
  assert.match(virtualBaseEmbedSource, /!\[\[\$\{baseFile\.path\}\]\]/);
  assert.match(virtualBaseEmbedSource, /tps-gcm-virtual-base-embed-item/);
  assert.match(virtualBaseEmbedSource, /installBaseItemClassifier/);
  assert.match(virtualBaseEmbedSource, /classifyInlineEmptyStates/);
  assert.match(virtualBaseEmbedSource, /normalizeElementText/);
  assert.match(virtualBaseEmbedSource, /No notes to display/);
  assert.match(virtualBaseEmbedSource, /Add task/);
  assert.doesNotMatch(virtualBaseEmbedSource, /WidgetType/);
  assert.doesNotMatch(mainSource, /virtualBaseEmbedService\.getEditorExtension/);
  assert.match(virtualBaseEmbedSource, /resolveRenderSurface\(view\)/);
  assert.match(virtualBaseEmbedSource, /isVisibleRenderRoot/);
  assert.match(virtualBaseEmbedSource, /style\.display === 'none'/);
  assert.match(virtualBaseEmbedSource, /rect\.width > 0 && rect\.height > 0/);
  assert.match(virtualBaseEmbedSource, /if \(!surface\) \{[\s\S]*?this\.clearView\(view\);/);
  assert.match(virtualBaseEmbedSource, /\.metadata-container, \.metadata-properties, \.tps-gcm-top-parent-nav, \.inline-title, h1/);
  assert.match(virtualBaseEmbedSource, /marker\.insertAdjacentElement\('afterend', host\)/);
  assert.doesNotMatch(virtualBaseEmbedSource, /\.cm-contentContainer, \.cm-content, \.cm-sizer/);
  assert.match(virtualBaseEmbedSource, /MarkdownRenderer\.render\(this\.plugin\.app/);
  assert.doesNotMatch(virtualBaseEmbedSource, /writeDebugSnapshot/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed--top/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed--bottom/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed--hover/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed-item--empty/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-empty-state-inline/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed \.internal-embed:is\(\[src\$="\.base"\]/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed\s*\{[\s\S]*?background:\s*transparent;/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed\s*\{[\s\S]*?overflow:\s*visible;/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed:not\(\.tps-gcm-virtual-base-embed--hover\) \.bases-no-results/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed:not\(\.tps-gcm-virtual-base-embed--hover\) \.empty-state/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed:not\(\.tps-gcm-virtual-base-embed--hover\) \.bases-embed/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed:not\(\.tps-gcm-virtual-base-embed--hover\) \.bases-header/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed:not\(\.tps-gcm-virtual-base-embed--hover\) \.bases-toolbar\s*\{[\s\S]*?display:\s*flex !important;/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed:not\(\.tps-gcm-virtual-base-embed--hover\) \.markdown-preview-sizer/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed:not\(\.tps-gcm-virtual-base-embed--hover\) \.markdown-preview-section/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed:not\(\.tps-gcm-virtual-base-embed--hover\) \.tps-kanban-container/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed:not\(\.tps-gcm-virtual-base-embed--hover\) \.tps-kanban-reading-embed-section/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed:not\(\.tps-gcm-virtual-base-embed--hover\) \.tps-kanban-reading-embed-block\s*\{[\s\S]*?transform:\s*none !important;[\s\S]*?margin-bottom:\s*0 !important;/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed:not\(\.tps-gcm-virtual-base-embed--hover\) \.tps-kanban-lane--empty/);
  assert.doesNotMatch(stylesSource, /\.view-content > \.tps-gcm-virtual-base-embed/);
  assert.match(stylesSource, /position:\s*fixed/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed--hover\s*\{[\s\S]*?background:\s*color-mix/);
  assert.match(stylesSource, /\.tps-gcm-virtual-base-embed--hover\s*\{[\s\S]*?overflow:\s*auto/);
  assert.match(stylesSource, /tps-gcm-gesture-collapsed \.tps-gcm-virtual-base-embed--hover/);
});

test('canvas base embeds are bounded and keep base views usable without Home styling', () => {
  assert.match(stylesSource, /\.canvas-node-content:has\(\.internal-embed:is\(\[src\$="\.base"\]/);
  assert.match(stylesSource, /\.canvas-node-content:has\(:is\(\.bases-view, \.bases-embed, \.bases-table, \.bases-feed-container, \.tps-kanban-container, \.tps-health-food-log-base, \.bases-calendar-container--canvas-embedded\)\)/);
  assert.match(stylesSource, /\.canvas-node-content \.internal-embed:is\(\[src\$="\.base"\][\s\S]*height:\s*100% !important;[\s\S]*overflow:\s*hidden !important;/);
  assert.match(stylesSource, /\.canvas-node-content \.bases-header,[\s\S]*\.canvas-node-content \.base-view-header\s*\{[\s\S]*display:\s*flex !important;/);
  assert.match(stylesSource, /\.canvas-node-content \.bases-view,[\s\S]*\.canvas-node-content \.block-language-base\s*\{[\s\S]*display:\s*flex !important;[\s\S]*height:\s*100% !important;/);
  assert.match(stylesSource, /\.canvas-node-content \.bases-table,[\s\S]*\.canvas-node-content \.tps-health-food-log-base\s*\{[\s\S]*overflow:\s*auto !important;/);
  assert.match(stylesSource, /\.canvas-node-content \.tps-kanban-root,[\s\S]*\.canvas-node-content \.tps-kanban-container\s*\{[\s\S]*height:\s*100% !important;[\s\S]*overflow:\s*auto !important;/);
  assert.match(stylesSource, /\.canvas-node-content \.tps-kanban-board\s*\{[\s\S]*width:\s*max-content !important;[\s\S]*min-width:\s*100% !important;/);
  assert.match(stylesSource, /\.canvas-node-content \.bases-feed-container\s*\{[\s\S]*max-width:\s*none !important;/);
  assert.match(stylesSource, /\.canvas-node-content \.tps-health-food-log-entry\s*\{[\s\S]*padding:\s*8px !important;/);
  assert.match(stylesSource, /\.canvas-node-content \.tps-health-food-log-entry\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) !important;[\s\S]*"actions" !important;/);
  assert.match(stylesSource, /\.canvas-node-content \.tps-health-food-log-entry-source\s*\{[\s\S]*display:\s*none !important;/);
  assert.match(stylesSource, /\.canvas-node-content \.tps-health-food-log-entry-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\) !important;/);
  assert.match(stylesSource, /\.canvas-node-content \.tps-health-food-log-base \.tps-health-macro-empty\s*\{[\s\S]*display:\s*none !important;/);
  assert.match(stylesSource, /@container \(max-width:\s*560px\)\s*\{[\s\S]*\.canvas-node-content \.tps-health-food-log-entry-actions\s*\{[\s\S]*display:\s*none !important;/);
  assert.match(stylesSource, /\.canvas-node-content :is\(\.bases-view, \.bases-embed, \.bases-feed-container, \.tps-kanban-container, \.tps-health-food-log-base\) :is\(\.bases-empty-state, \.bases-no-results, \.empty-state, \.empty-state-container, \.bases-feed-empty\)/);
  assert.doesNotMatch(stylesSource, /\.canvas-node-content \.empty-state,/);
  assert.doesNotMatch(stylesSource, /\.canvas-node-content:has\(\.bases-view\)/);
  assert.doesNotMatch(stylesSource, /\.canvas-node-content[\s\S]{0,240}tps-home-/);
});
