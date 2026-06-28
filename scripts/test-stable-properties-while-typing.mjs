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

test('manual file renames force title sync from the new basename', () => {
  const renameHandlerSource = eventSource.slice(
    eventSource.indexOf("plugin.app.vault.on('rename'"),
    eventSource.indexOf("plugin.register(() => plugin.persistentMenuManager.detach())"),
  );

  assert.match(renameHandlerSource, /syncTitleFromFilename\(file,\s*\{\s*force: true,\s*bypassCreationGrace: true,\s*\}\)/);
  assert.doesNotMatch(renameHandlerSource, /if \(plugin\.settings\.autoSyncTitleFromFilename\)[\s\S]*?syncTitleFromFilename/);
  assert.match(renameHandlerSource, /\}, 500\)/);
});

test('default app file opens reuse existing tabs or create a focused new tab', () => {
  const helperSource = mainSource.slice(
    mainSource.indexOf('async openFileInLeaf('),
    mainSource.indexOf('private isPinnedLeafForDifferentFile'),
  );
  const nativeOpenSource = mainSource.slice(
    mainSource.indexOf('const rerouteDefaultMarkdownOpen ='),
    mainSource.indexOf('WorkspaceLeaf.prototype.open = function'),
  );
  const rerouteSource = mainSource.slice(
    mainSource.indexOf('private shouldRerouteDefaultMarkdownOpen('),
    mainSource.indexOf('matchesAutoFrontmatterExclusionPattern'),
  );
  const nativeSetViewStateSource = mainSource.slice(
    mainSource.indexOf('WorkspaceLeaf.prototype.setViewState = function'),
    mainSource.indexOf('if (typeof originalOpenLinkText ==='),
  );

  assert.match(helperSource, /reuseLeafIfNoExisting\?: boolean/);
  assert.match(helperSource, /const shouldOpenMissingDefaultInNewTab =/);
  assert.match(helperSource, /context === false/);
  assert.match(helperSource, /&& openActive/);
  assert.match(helperSource, /&& revealLeaf/);
  assert.match(helperSource, /options\?\.reuseLeafIfNoExisting !== true/);
  assert.match(helperSource, /const existingLeaf = this\.findOpenLeafForFile\(file\)/);
  assert.ok(
    helperSource.indexOf('const existingLeaf = this.findOpenLeafForFile(file)') < helperSource.indexOf('let leaf = shouldOpenMissingDefaultInNewTab'),
    'existing file tabs should be reused before creating a new tab',
  );
  assert.match(helperSource, /shouldOpenMissingDefaultInNewTab\s*\?\s*this\.app\.workspace\.getLeaf\(true\)\s*:\s*getLeaf\(\)/);
  assert.match(nativeOpenSource, /plugin\.shouldRerouteDefaultMarkdownOpen\(this, targetFile, args\[1\]\)/);
  assert.match(nativeOpenSource, /const rerouteDefaultMarkdownOpen =/);
  assert.match(nativeOpenSource, /plugin\.defaultMarkdownOpenPromises\.get\(file\.path\)/);
  assert.match(nativeOpenSource, /plugin\.defaultMarkdownOpenPromises\.set\(file\.path, promise\)/);
  assert.match(nativeOpenSource, /plugin\.defaultMarkdownOpenPromises\.delete\(file\.path\)/);
  assert.match(nativeOpenSource, /return pending\.then\(\(\) => focusOpenLeaf\(file\)\)/);
  assert.match(nativeOpenSource, /originalLeafOpenFile\.apply\(leaf, args as any\)/);
  assert.match(nativeSetViewStateSource, /plugin\.app\.vault\.getAbstractFileByPath\(target\)/);
  assert.match(nativeSetViewStateSource, /viewState\?\.type === 'markdown'/);
  assert.match(nativeSetViewStateSource, /plugin\.shouldRerouteDefaultMarkdownOpen\(this, targetFile, viewState\)/);
  assert.match(nativeSetViewStateSource, /originalLeafSetViewState\.apply\(leaf, args as any\)/);
  assert.match(mainSource, /const statePath = typeof state\?\.state\?\.file === 'string'/);
  assert.match(mainSource, /state\?\.type === 'markdown' && statePath === file\.path/);
  assert.match(rerouteSource, /file\.extension !== 'md'/);
  assert.match(rerouteSource, /openStateRecord\?\.active === false/);
  assert.match(rerouteSource, /leafAny\.hoverPopover/);
  assert.match(rerouteSource, /viewFile\.path !== file\.path/);
  assert.match(rerouteSource, /leaf\.getViewState\?\.\(\)/);
  assert.match(rerouteSource, /path\.length > 0 && path !== file\.path/);
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
  assert.match(panelBuilderSource, /insertConfiguredPropertyAndEdit/);
  assert.match(panelBuilderSource, /initializeIfMissing\(entries, key, this\.getDefaultPropertyValue\(prop\)\)/);
  assert.match(panelBuilderSource, /this\.openStackedPropertyEditor\(anchor, entries, prop\)/);
  assert.match(fieldInitializationSource, /async initializeIfMissing/);
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
