import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/hide-completed-checkboxes-service.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const pluginApiSource = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const constantsSource = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const refreshRootSource = source.slice(
  source.indexOf('private refreshLivePreviewRoot'),
  source.indexOf('private clearLivePreviewRoot'),
);
const observeRootSource = source.slice(
  source.indexOf('private observeRoot'),
  source.indexOf('private scheduleRefresh'),
);
const syncRevealButtonSource = source.slice(
  source.indexOf('private syncRevealButton'),
  source.indexOf('private revealTemporarily'),
);
const liveRevealStyles = styles.slice(
  styles.indexOf('.markdown-source-view.mod-cm6.is-live-preview > .tps-gcm-completed-checkbox-reveal'),
  styles.indexOf('.markdown-preview-view .tps-gcm-completed-checkbox-reveal'),
);
const renderedRevealStyles = styles.slice(
  styles.indexOf('.markdown-preview-view .tps-gcm-completed-checkbox-reveal'),
  styles.indexOf('.markdown-source-view.mod-cm6.is-live-preview .tps-gcm-completed-checkbox-reveal button'),
);
const mobileRevealStyles = styles.slice(
  styles.indexOf('body.is-mobile .markdown-source-view.mod-cm6.is-live-preview > .tps-gcm-completed-checkbox-reveal'),
  styles.indexOf('.markdown-source-view.mod-cm6.is-live-preview .tps-gcm-completed-checkbox-reveal button:hover'),
);

test('completed checkbox hiding is scoped and idle-aware to avoid typing jitter', () => {
  assert.match(source, /private rootObservers = new WeakMap/);
  assert.match(source, /private pendingRoots = new Set<HTMLElement>/);
  assert.match(source, /private pendingRenderedRoots = new Set<HTMLElement>/);
  assert.match(source, /private initializedRoots = new WeakSet<HTMLElement>/);
  assert.match(source, /getEditorExtension\(\): Extension/);
  assert.match(source, /revealCompletedForFile\(filePath: string, lineNumber\?: number\): void/);
  assert.match(source, /getMarkdownRootsForFile\(filePath: string\): HTMLElement\[\]/);
  assert.match(source, /ViewPlugin\.fromClass/);
  assert.match(source, /buildCompletedLineDecorations\(view: EditorView\)/);
  assert.match(source, /Decoration\.line\(\{ class: HIDDEN_LINE_CLASS \}\)/);
  assert.match(source, /getHiddenCompletedLines\(view: EditorView\)/);
  assert.match(source, /collectCompletedTaskBlockLines/);
  assert.match(source, /findNextNonBlankDocLine/);
  assert.match(source, /this\.getIndentWidth\(line\.text\) <= baseIndent/);
  assert.match(source, /this\.plugin\.app\.workspace\.updateOptions\(\)/);
  assert.match(pluginApiSource, /completedCheckboxes/);
  assert.match(pluginApiSource, /revealCompletedForFile\(filePath, lineNumber\)/);
  assert.match(mainSource, /this\.registerEditorExtension\(this\.hideCompletedCheckboxesService\.getEditorExtension\(\)\)/);
  assert.match(source, /EDITING_ROOT_CLASS/);
  assert.match(source, /EDITING_QUIET_WINDOW_MS = 1200/);
  assert.match(source, /private rootLastInputAt = new WeakMap<HTMLElement, number>/);
  assert.match(source, /private editingClearTimerIds = new Set<number>/);
  assert.match(source, /mutationsAddedEditorRoot\(mutations\)/);
  assert.match(source, /discoverRenderedRoots\(\)/);
  assert.match(source, /refreshRenderedViews\(\)/);
  assert.match(source, /refreshRenderedRoot\(root: HTMLElement\)/);
  assert.match(source, /getRenderedRoots\(\): HTMLElement\[\]/);
  assert.match(source, /\.markdown-preview-view, \.markdown-rendered, \.markdown-reading-view/);
  assert.match(source, /getRevealButtonMount\(root: HTMLElement\): HTMLElement/);
  assert.match(source, /lastEditorInputAt/);
  assert.match(source, /document\.addEventListener\('keydown', this\.boundMarkEditorInput, true\)/);
  assert.match(source, /document\.addEventListener\('input', this\.boundMarkEditorInput, true\)/);
  assert.match(source, /document\.addEventListener\('focusout', this\.boundEditorFocusOut, true\)/);
  assert.match(source, /isRootActivelyBeingEdited\(root\)/);
  assert.match(source, /isRootRecentlyEdited\(root\)/);
  assert.match(source, /this\.scheduleRefreshAfterQuiet\(root\)/);
  assert.match(source, /this\.markRootEditing\(root\)/);
  assert.match(refreshRootSource, /if \(this\.isRootRecentlyEdited\(root\)\)/);
  assert.doesNotMatch(refreshRootSource, /isRootActivelyBeingEdited/);
  assert.match(observeRootSource, /if \(this\.isRootRecentlyEdited\(root\)\)/);
  assert.doesNotMatch(observeRootSource, /isRootActivelyBeingEdited/);
  assert.match(syncRevealButtonSource, /if \(this\.isRootRecentlyEdited\(root\) && wrap\.parentElement === mount\) return;/);
  assert.match(syncRevealButtonSource, /if \(wrap\.parentElement !== mount\) mount\.prepend\(wrap\)/);
  assert.match(syncRevealButtonSource, /button\.addEventListener\('pointerdown', suppressPress\)/);
  assert.match(syncRevealButtonSource, /button\.addEventListener\('touchstart', suppressPress, \{ passive: false \}\)/);
  assert.match(syncRevealButtonSource, /button\.addEventListener\('touchend', toggleReveal, \{ passive: false \}\)/);
  assert.match(syncRevealButtonSource, /lastTouchToggleAt/);
  assert.match(syncRevealButtonSource, /event\.type === 'click' && Date\.now\(\) - lastTouchToggleAt < 700/);
  assert.doesNotMatch(syncRevealButtonSource, /isRootActivelyBeingEdited/);
  assert.match(source, /root\.classList\.add\(EDITING_ROOT_CLASS\)/);
  assert.match(source, /root\.classList\.remove\(EDITING_ROOT_CLASS\)/);
  assert.match(source, /this\.initializedRoots\.add\(root\)/);
  assert.match(source, /REVEALED_ROOT_CLASS/);
  assert.match(source, /HAS_REVEAL_WIDGET_CLASS/);
  assert.match(source, /root\.classList\.toggle\(REVEALED_ROOT_CLASS, revealed\)/);
  assert.match(source, /root\.classList\.add\(HAS_REVEAL_WIDGET_CLASS\)/);
  assert.match(source, /root\.classList\.remove\(HAS_REVEAL_WIDGET_CLASS\)/);
  assert.match(source, /root\.contains\(active\)/);
  assert.match(source, /line\.matches\('\[data-task="x"\], \[data-task="X"\], \[data-task="-"\]'\)/);
  assert.match(source, /line\.querySelector\('\[aria-checked="true"\]'\)/);
  assert.match(source, /private isLivePreviewRoot\(root: HTMLElement\): boolean/);
  assert.match(source, /root\.classList\.contains\('is-source-mode'\)/);
  assert.match(source, /EDITING_QUIET_WINDOW_MS - \(Date\.now\(\) - this\.lastEditorInputAt\)/);
  assert.match(source, /Date\.now\(\) - this\.lastEditorInputAt < EDITING_QUIET_WINDOW_MS/);
  assert.doesNotMatch(source, /attributes: true/);
  assert.doesNotMatch(source, /completedLines\.includes\(line\)/);
  assert.doesNotMatch(refreshRootSource, /classList\.toggle\(HIDDEN_LINE_CLASS/);
  assert.doesNotMatch(styles, /\.cm-line:has/);
  assert.doesNotMatch(styles, /\.cm-line\[data-task=/);
  assert.match(styles, /\.markdown-source-view\.mod-cm6:not\(\.is-source-mode\) \.cm-line\.tps-gcm-hidden-completed-checkbox-line/);
  assert.match(styles, /not\(\.is-source-mode\)\.tps-gcm-completed-checkboxes-revealed \.cm-line\.tps-gcm-hidden-completed-checkbox-line/);
  assert.match(styles, /\.markdown-preview-view\.tps-gcm-completed-checkboxes-revealed li\.task-list-item\.is-checked/);
  assert.match(styles, /hide-all-task-lines-reading-mode \.markdown-reading-view li\.task-list-item \{/);
  assert.match(styles, /hide-all-task-lines-reading-mode \.markdown-reading-view\.tps-gcm-completed-checkboxes-revealed li\.task-list-item \{/);
  assert.match(styles, /\.markdown-rendered\.tps-gcm-completed-checkboxes-revealed li\.task-list-item\[data-task="x"\]/);
  assert.match(styles, /\.markdown-preview-view \.tps-gcm-completed-checkbox-reveal/);
  assert.match(styles, /\.markdown-reading-view \.tps-gcm-completed-checkbox-reveal/);
  assert.match(styles, /\.markdown-source-view\.mod-cm6\.is-live-preview \{/);
  assert.match(styles, /\.markdown-source-view\.mod-cm6\.is-live-preview\.tps-gcm-completed-checkboxes-has-reveal \.inline-title/);
  assert.match(styles, /\.markdown-source-view\.mod-cm6\.is-live-preview > \.tps-gcm-completed-checkbox-reveal/);
  assert.match(liveRevealStyles, /position: absolute;/);
  assert.match(liveRevealStyles, /width: auto;/);
  assert.match(liveRevealStyles, /min-width: max-content;/);
  assert.match(liveRevealStyles, /right: max\(12px, calc\(\(100% - var\(--file-line-width, 700px\)\) \/ 2\)\);/);
  assert.doesNotMatch(liveRevealStyles, /width: 100%;/);
  assert.doesNotMatch(liveRevealStyles, /position: sticky;/);
  assert.doesNotMatch(styles, /\.cm-contentContainer > \.tps-gcm-completed-checkbox-reveal/);
  assert.match(renderedRevealStyles, /position: sticky;/);
  assert.match(mobileRevealStyles, /body\.is-mobile \.markdown-source-view\.mod-cm6\.is-live-preview > \.tps-gcm-completed-checkbox-reveal/);
  assert.match(mobileRevealStyles, /body\.is-mobile \.markdown-reading-view \.tps-gcm-completed-checkbox-reveal/);
  assert.match(mobileRevealStyles, /position: fixed;/);
  assert.match(mobileRevealStyles, /left: max\(12px, env\(safe-area-inset-left, 0px\)\);/);
  assert.match(mobileRevealStyles, /right: max\(12px, env\(safe-area-inset-right, 0px\)\);/);
  assert.match(mobileRevealStyles, /bottom: calc\(188px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(mobileRevealStyles, /min-height: 44px;/);
  assert.match(mobileRevealStyles, /touch-action: manipulation !important;/);
  assert.match(mobileRevealStyles, /pointer-events: auto !important;/);
  assert.match(liveRevealStyles, /min-height: 24px;/);
  assert.match(renderedRevealStyles, /min-height: 24px;/);
  assert.doesNotMatch(liveRevealStyles, /height: 0;/);
  assert.doesNotMatch(renderedRevealStyles, /height: 0;/);
  assert.doesNotMatch(styles, /is-live-preview:not\(\.tps-gcm-completed-checkboxes-editing\):not\(\.tps-gcm-completed-checkboxes-revealed\)/);
});

test('task reveal state can optionally persist to one frontmatter property', () => {
  assert.match(typesSource, /persistTaskVisibilityStateToFrontmatter: boolean/);
  assert.match(typesSource, /taskVisibilityStateFrontmatterKey: string/);
  assert.match(constantsSource, /persistTaskVisibilityStateToFrontmatter: false/);
  assert.match(constantsSource, /taskVisibilityStateFrontmatterKey: 'gcmTaskVisibility'/);
  assert.match(settingsSource, /Persist task reveal state to frontmatter/);
  assert.match(settingsSource, /Task reveal frontmatter key/);
  assert.match(syncRevealButtonSource, /this\.shouldPersistRevealState\(\)/);
  assert.match(syncRevealButtonSource, /void this\.setPersistedRevealState\(root, revealAllTasks, !revealed\)/);
  assert.match(source, /type TaskVisibilityState = \{ showCompleted\?: boolean; showTasks\?: boolean \}/);
  assert.match(source, /getEffectiveRevealState\(root: HTMLElement, revealAllTasks: boolean\): boolean/);
  assert.match(source, /getPersistedRevealState\(root: HTMLElement\): TaskVisibilityState \| null/);
  assert.match(source, /setPersistedRevealState\(root: HTMLElement, revealAllTasks: boolean, revealed: boolean\): Promise<void>/);
  assert.match(source, /this\.plugin\.frontmatterMutationService\.process\(file, \(frontmatter\) =>/);
  assert.match(source, /next\[revealAllTasks \? 'showTasks' : 'showCompleted'\] = revealed/);
  assert.match(source, /frontmatter\[key\] = next/);
  assert.match(source, /private getFileForRoot\(root: HTMLElement\): TFile \| null/);
  assert.match(source, /container\?\.contains\(root\)/);
  assert.match(source, /const persisted = revealAllTasks \? state\?\.showTasks : state\?\.showCompleted/);
});

test('task hiding exclusions bypass completed and all-task hiding by file pattern', () => {
  assert.match(typesSource, /taskHidingExclusionPatterns: string/);
  assert.match(constantsSource, /taskHidingExclusionPatterns: ''/);
  assert.match(settingsSource, /Task hiding exclusions/);
  assert.match(settingsSource, /Files or folders where completed\/all-task hiding is disabled/);
  assert.match(settingsSource, /name:<basename>/);
  assert.match(settingsSource, /re:<regex>/);
  assert.match(settingsSource, /setValue\(this\.plugin\.settings\.taskHidingExclusionPatterns \?\? ''\)/);
  assert.doesNotMatch(settingsSource, /setValue\(this\.plugin\.settings\.taskHidingExclusionPatterns \?\? 'Inbox\/'\)/);
  assert.match(settingsSource, /this\.plugin\.settings\.taskHidingExclusionPatterns = value/);
  assert.match(mainSource, /taskHidingExclusionPatterns = String\(this\.settings\.taskHidingExclusionPatterns \?\? ''\)\.trim\(\)/);
  assert.match(source, /TASK_HIDING_EXCLUDED_ROOT_CLASS = 'tps-gcm-task-hiding-excluded'/);
  assert.match(source, /private clearTaskHidingRoot\(root: HTMLElement\): void/);
  assert.match(source, /private isRootTaskHidingExcluded\(root: HTMLElement\): boolean/);
  assert.match(source, /private isTaskHidingExcludedFile\(file: TFile\): boolean/);
  assert.match(source, /private getTaskHidingExclusionPatterns\(\): string\[\]/);
  assert.match(source, /\.split\(\/\\r\?\\n\|,\/\)/);
  assert.match(source, /this\.plugin\.matchesAutoFrontmatterExclusionPattern\(normalizedPath, normalizedBasename, pattern\)/);
  assert.match(source, /if \(root && this\.isRootTaskHidingExcluded\(root\)\) return Decoration\.none/);
  assert.match(source, /this\.plugin\.settings\.hideCompletedCheckboxes === true \|\|[\s\S]*this\.plugin\.settings\.hideAllTaskLinesInReadingMode === true/);
  assert.match(source, /if \(this\.isRootTaskHidingExcluded\(root\)\) \{\s*this\.clearTaskHidingRoot\(root\);\s*continue;/);
  assert.match(source, /if \(this\.isRootTaskHidingExcluded\(root\)\) \{\s*this\.clearTaskHidingRoot\(root\);\s*return;/);
  assert.match(styles, /tps-gcm-task-hiding-excluded/);
  assert.match(styles, /hide-completed-checkboxes \.markdown-reading-view\.tps-gcm-task-hiding-excluded li\.task-list-item\.is-checked/);
  assert.match(styles, /hide-all-task-lines-reading-mode \.markdown-reading-view\.tps-gcm-task-hiding-excluded li\.task-list-item \{/);
});
