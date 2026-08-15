import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manager = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');
const panelBuilder = readFileSync(new URL('../src/menu/panel-builder.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');
const events = readFileSync(new URL('../src/events/register-events.ts', import.meta.url), 'utf8');

function methodSource(start, end) {
  const startIndex = manager.indexOf(start);
  const endIndex = manager.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return manager.slice(startIndex, endIndex);
}

test('linked context tasks publish exact task metadata for the canonical task menu', () => {
  assert.match(manager, /taskRow\.dataset\.tpsGcmContext = 'calendar-task'/);
  assert.match(manager, /taskRow\.dataset\.taskPath = item\.sourceFile\.path/);
  assert.match(manager, /taskRow\.dataset\.taskLine = String\(taskLine\.lineNumber \+ 1\)/);
});

test('linked context task long press cancels on scroll movement and opens contextmenu', () => {
  assert.match(manager, /Math\.hypot\(event\.clientX - startX, event\.clientY - startY\) > 10/);
  assert.match(manager, /new MouseEvent\('contextmenu'/);
  assert.match(manager, /}, 500\)/);
});

test('linked context has a compact coarse-pointer layout without resizing native checkboxes', () => {
  assert.match(styles, /@media \(max-width: 700px\), \(pointer: coarse\)/);
  assert.doesNotMatch(
    styles,
    /\.tps-gcm-linked-context-body input\[type="checkbox"\]\s*\{[^}]*width:\s*22px;/,
  );
  assert.match(styles, /\.tps-gcm-linked-context-task[\s\S]*touch-action: pan-y;/);
});

test('replacing linked context unmounts the old panel without invalidating the winning render', () => {
  const unmountSource = methodSource(
    'private unmountLinkedContextPanel',
    'private removeLinkedContextPanel',
  );
  const ensureSource = methodSource(
    'private async ensureLinkedContextPanel',
    'private async renderLinkedContextItem',
  );

  assert.doesNotMatch(
    unmountSource,
    /linkedContextRequestIds\.(?:set|delete)/,
    'DOM cleanup must not advance the latest-render generation',
  );
  assert.match(ensureSource, /this\.unmountLinkedContextPanel\(view, \{ preserveMountHosts: true \}\)/);
});

test('linked context rechecks freshness after asynchronous rendering and disposes stale candidates', () => {
  const ensureSource = methodSource(
    'private async ensureLinkedContextPanel',
    'private async renderLinkedContextItem',
  );
  const renderAwait = ensureSource.lastIndexOf('await this.renderLinkedContextItem');
  const commit = ensureSource.lastIndexOf('this.linkedContextPanels.set');
  assert.ok(renderAwait >= 0, 'linked context should render its cards asynchronously');
  assert.ok(commit > renderAwait, 'the candidate should be committed only after all cards render');

  const preCommitSource = ensureSource.slice(renderAwait, commit);
  assert.match(
    preCommitSource,
    /(?:linkedContextRequestIds\.get\(view\)\s*!==\s*requestId|isLinkedContextRenderCurrent\([^)]*\)|isCurrent\(\))/,
    'the latest request and active file must be rechecked immediately before commit',
  );
  assert.match(
    ensureSource,
    /(?:candidateComponent\?\.unload\(\)|component\.unload\(\)|disposeLinkedContextCandidate\([^)]*\))/,
    'a detached candidate needs an explicit disposal path',
  );
  assert.match(
    ensureSource,
    /(?:finally\s*\{|if\s*\([^)]*(?:stale|current|committed)[^)]*\))/,
    'candidate disposal must cover stale or failed asynchronous renders',
  );
});

test('linked context resolves its dedicated mount after rendering so top navigation cannot invalidate its anchor', () => {
  const ensureSource = methodSource(
    'private async ensureLinkedContextPanel',
    'private async renderLinkedContextItem',
  );
  const renderAwait = ensureSource.lastIndexOf('await this.renderLinkedContextItem');
  const mountResolution = Math.max(
    ensureSource.lastIndexOf('resolveLinkedContextMount'),
    ensureSource.lastIndexOf('resolveLinkedContextHost'),
  );
  const priorPanelUnmount = ensureSource.lastIndexOf('unmountLinkedContextPanel');
  const commit = ensureSource.lastIndexOf('this.linkedContextPanels.set');

  assert.ok(mountResolution > renderAwait, 'the live DOM mount must be resolved after detached rendering');
  assert.ok(priorPanelUnmount > mountResolution, 'the current panel must stay mounted until a replacement host is ready');
  assert.ok(commit > mountResolution, 'the panel must be committed after its final mount is resolved');
  assert.doesNotMatch(
    ensureSource,
    /resolveInlineSubitemsAnchor\(view\)/,
    'linked context must not reuse a transient sibling anchor owned by the Tasks/Mentions navigation',
  );
});

test('linked context live-preview mounts stay outside CodeMirror content', () => {
  const mountSource = methodSource(
    'private resolveLinkedContext',
    'private resolveNoteGraphHost',
  );

  assert.match(mountSource, /\.cm-sizer/);
  assert.doesNotMatch(
    mountSource,
    /querySelector<HTMLElement>\('\.cm-content'\)/,
    'plugin-owned linked context must never be appended directly to CodeMirror .cm-content',
  );
  assert.match(
    mountSource,
    /tps-gcm-top-parent-nav/,
    'top placement must define deterministic ordering relative to the shared navigation host',
  );
  assert.match(mountSource, /host\.prepend\(nav\)/);
  assert.match(manager, /topSurfaceHost\.prepend\(container\)/);
  assert.match(mountSource, /if \(!alreadyPositioned\) parent\.insertBefore\(host, reference\)/);
});

test('initial and forced Tasks/Mentions rebuilds preserve their shared mount host', () => {
  const ensureNavSource = methodSource(
    'public ensureTopParentNav',
    'private getTopParentNavPlacement',
  );
  const removeNavSource = methodSource(
    'private removeTopParentNav',
    'private reserveTopPropertiesFootprint',
  );

  assert.match(
    ensureNavSource,
    /removeTopParentNav\(view, \{ reserveFootprint: false, preserveTopHost: true \}\)/,
  );
  assert.match(removeNavSource, /options\.preserveTopHost !== true/);
});

test('creating the Mentions button does not launch a full reference scan during note open', () => {
  const relationshipButtonsSource = methodSource(
    'private createRelationshipNavButtons',
    'private createExternalActionButtons',
  );

  assert.doesNotMatch(relationshipButtonsSource, /refreshTopLinksButtonLabel\(/);
  assert.doesNotMatch(relationshipButtonsSource, /refreshNoteTasksButtonLabel\(/);
  assert.doesNotMatch(relationshipButtonsSource, /collectReferenceGroups\(/);
  assert.doesNotMatch(relationshipButtonsSource, /if \(totalLinks > 0\)/);
  assert.match(relationshipButtonsSource, /tasksLabel\.textContent = 'Tasks'/);
  assert.match(relationshipButtonsSource, /linksLabel\.textContent = 'Mentions'/);
});

test('repeated note-open ensures share one same-key linked-context render', () => {
  const ensureSource = methodSource(
    'private async ensureLinkedContextPanel',
    'private async renderLinkedContextPanel',
  );

  assert.match(ensureSource, /linkedContextRenders\.get\(view\)/);
  assert.match(ensureSource, /inFlight\?\.requestKey === requestKey/);
  assert.match(ensureSource, /await inFlight\.promise/);
});

test('a detached same-key panel is moved intact before any collection or render starts', () => {
  const ensureSource = methodSource(
    'private async ensureLinkedContextPanel',
    'private async renderLinkedContextPanel',
  );
  const sameKeyStart = ensureSource.indexOf('if (mounted?.requestKey === requestKey)');
  const inFlightStart = ensureSource.indexOf('const inFlight = this.linkedContextRenders.get(view)');
  const reattachSource = ensureSource.slice(sameKeyStart, inFlightStart);

  assert.ok(sameKeyStart >= 0, 'same-key mount recovery must have a dedicated fast path');
  assert.ok(inFlightStart > sameKeyStart, 'reattachment must happen before render coalescing starts');
  assert.match(reattachSource, /const parent = this\.resolveLinkedContextMount\(view, placement\)/);
  assert.match(reattachSource, /parent\.appendChild\(mounted\.el\)/);
  assert.match(reattachSource, /if \(this\.isLinkedContextPanelMounted\(view\)\) \{/);
  assert.doesNotMatch(reattachSource, /getLinkedContextItems|renderLinkedContextPanel|unmountLinkedContextPanel/);
  assert.match(reattachSource, /return;\s*\}/);
});

test('opening another note removes stale linked context before its replacement scan starts', () => {
  const ensureSource = methodSource(
    'private async ensureLinkedContextPanel',
    'private async renderLinkedContextPanel',
  );
  const mountedIndex = ensureSource.indexOf('const mounted = this.linkedContextPanels.get(view)');
  const staleGuardIndex = ensureSource.indexOf('mounted.filePath !== file.path');
  const requestKeyIndex = ensureSource.indexOf('const requestKey = this.getLinkedContextRequestKey');

  assert.ok(mountedIndex >= 0, 'the currently mounted panel must be inspected');
  assert.ok(staleGuardIndex > mountedIndex, 'the mounted panel must be checked against the newly opened file');
  assert.ok(
    requestKeyIndex > staleGuardIndex,
    'stale interactive content must be removed before the incoming-link revision scan starts',
  );
  assert.match(
    ensureSource.slice(staleGuardIndex, requestKeyIndex),
    /unmountLinkedContextPanel\(view, \{ preserveMountHosts: true \}\)/,
  );
  assert.match(manager, /filePath: file\.path/);
});

test('per-card linked-context freshness checks do not rescan the whole vault', () => {
  const renderSource = methodSource(
    'private async renderLinkedContextPanel',
    'private disposeLinkedContextCandidate',
  );
  const loopStart = renderSource.indexOf('for (const item of items)');
  const finalRevisionCheck = renderSource.indexOf(
    'if (!this.isLinkedContextRenderCurrent(view, file, requestId, requestKey)) return;',
    loopStart,
  );

  assert.ok(loopStart >= 0, 'linked-context items must render in a loop');
  assert.ok(finalRevisionCheck > loopStart, 'the full revision must be checked at the commit boundary');
  const perCardSource = renderSource.slice(loopStart, finalRevisionCheck);
  assert.match(perCardSource, /isLinkedContextRenderActive\(view, file, requestId\)/);
  assert.doesNotMatch(perCardSource, /isLinkedContextRenderCurrent|getLinkedContextRequestKey/);
});

test('canceling a linked-context render clears same-key coalescing for reactivation', () => {
  const cancelSource = methodSource(
    'private cancelLinkedContextRender',
    'private unmountLinkedContextPanel',
  );

  assert.match(cancelSource, /linkedContextRequestIds\.set/);
  assert.match(cancelSource, /linkedContextRenders\.delete\(view\)/);
});

test('linked context request identity and rendered DOM retain the configured stable order', () => {
  const keySource = methodSource(
    'private getLinkedContextRequestKey',
    'private isLinkedContextRenderCurrent',
  );
  const collectionSource = methodSource(
    'private getLinkedContextItems',
    'private async ensureLinkedContextPanel',
  );
  const renderSource = methodSource(
    'private async renderLinkedContextPanel',
    'private disposeLinkedContextCandidate',
  );

  assert.match(keySource, /normalizeLinkedContextSortOrder\(this\.plugin\.settings\.linkedContextSortOrder\)/);
  assert.match(keySource, /:\$\{sortOrder\}:/);
  assert.match(keySource, /linkedContextInvalidationVersions\.get\(view\)/);
  assert.match(keySource, /!this\.linkedContextRemovedSourcePaths\.has\(sourcePath\)/);
  assert.match(collectionSource, /this\.linkedContextService\.collect\(file, sortOrder, removedSourcePaths\)/);
  assert.match(renderSource, /candidatePanel\.dataset\.sortOrder/);
  assert.match(renderSource, /sourcePaths: new Set\(items\.map\(\(item\) => item\.sourceFile\.path\)\)/);
  assert.match(manager, /card\.dataset\.tpsGcmLinkedContextId = item\.id/);
});

test('linked context recovers a detached managed mount with coalesced bounded retries', () => {
  const observeSource = methodSource(
    'private ensureLinkedContextHostObserver',
    'private scheduleLinkedContextMountRecovery',
  );
  const recoverySource = methodSource(
    'private scheduleLinkedContextMountRecovery',
    'private releaseLinkedContextHostObserver',
  );
  const releaseSource = methodSource(
    'private releaseLinkedContextHostObserver',
    'private unmountLinkedContextPanel',
  );

  assert.match(manager, /linkedContextHostObservers: Map<MarkdownView/);
  assert.match(manager, /linkedContextRecoveryTimers: Map<MarkdownView, number>/);
  assert.match(observeSource, /new MutationObserver/);
  assert.match(observeSource, /observer\.observe\(view\.contentEl, \{ childList: true, subtree: true \}\)/);
  assert.match(observeSource, /this\.isLinkedContextPanelMounted\(view\)/);
  assert.match(observeSource, /this\.scheduleLinkedContextMountRecovery\(view\)/);
  assert.match(recoverySource, /const delays = \[40, 120, 300, 700, 1200\]/);
  assert.match(recoverySource, /this\.linkedContextRecoveryTimers\.has\(view\)/);
  assert.match(recoverySource, /shouldRecoverLinkedContextPanel/);
  assert.match(recoverySource, /this\.ensureLinkedContextPanel\(view\)\.finally/);
  assert.match(recoverySource, /attempt \+ 1 >= delays\.length/);
  assert.match(recoverySource, /this\.scheduleLinkedContextMountRecovery\(view, attempt \+ 1\)/);
  assert.match(releaseSource, /observer\.disconnect\(\)/);
  assert.match(releaseSource, /window\.clearTimeout\(timer\)/);
  assert.match(manager, /this\.releaseLinkedContextHostObserver\(view\)/);
});

test('source-file changes invalidate visible linked context without depending on the target view path', () => {
  const refreshSource = methodSource(
    'public invalidateLinkedContextSourcePaths',
    'private refreshLinkedContextForChangedFile',
  );
  const delegateSource = methodSource(
    'private refreshLinkedContextForChangedFile',
    'private shouldDeferStructuralRefreshForTyping',
  );
  const publicRefreshSource = methodSource(
    'refreshMenusForFile(',
    'private refreshLinkedContextForChangedFile',
  );

  assert.match(publicRefreshSource, /this\.refreshLinkedContextForChangedFile\(file\)/);
  assert.match(delegateSource, /this\.invalidateLinkedContextSourcePaths\(\[file\.path\]\)/);
  assert.match(refreshSource, /linkedContextHostObservers\.keys\(\)/);
  assert.match(refreshSource, /priorSourcePaths/);
  assert.match(refreshSource, /resolvedLinks\[changedPath\]\?\.\[targetFile\.path\]/);
  assert.match(refreshSource, /isLinkedContextSourceChangeRelevant/);
  assert.match(refreshSource, /linkedContextInvalidationVersions\.set/);
  assert.match(refreshSource, /linkedContextRemovedSourcePaths\.add/);
  assert.match(refreshSource, /card\.dataset\.tpsGcmSourcePath/);
  assert.match(refreshSource, /void this\.ensureLinkedContextPanel\(view\)/);
});

test('rename and delete invalidate prior linked-context source identities promptly', () => {
  const renameStart = events.indexOf("plugin.app.vault.on('rename'");
  const deleteStart = events.indexOf("plugin.app.vault.on('delete'");
  assert.ok(renameStart >= 0 && deleteStart > renameStart, 'vault rename/delete handlers must exist');

  const renameSource = events.slice(renameStart, deleteStart);
  const deleteSource = events.slice(deleteStart);
  assert.match(
    renameSource,
    /file\.extension === 'md' \|\| oldPath\.toLocaleLowerCase\(\)\.endsWith\('\.md'\)/,
    'renaming Markdown to a non-Markdown extension must still invalidate its old identity',
  );
  assert.match(
    renameSource,
    /invalidateLinkedContextSourcePaths\([\s\S]*?\[oldPath, file\.path\],[\s\S]*?\{ removedPaths: \[oldPath\] \}/,
    'rename must invalidate the old source path as well as its new identity',
  );
  assert.match(
    deleteSource,
    /invalidateLinkedContextSourcePaths\([\s\S]*?\[file\.path\],[\s\S]*?\{ removedPaths: \[file\.path\] \}/,
    'delete must invalidate the remembered source path without requiring a live TFile refresh',
  );
});

test('linked context uses central terminal-task semantics and explicit view-surface classes', () => {
  const itemSource = methodSource(
    'private async renderLinkedContextItem',
    'private enableLinkedContextTaskCheckboxes',
  );
  const renderSource = methodSource(
    'private async renderLinkedContextPanel',
    'private disposeLinkedContextCandidate',
  );

  assert.match(renderSource, /tps-gcm-linked-context-panel--\$\{surface\}/);
  assert.match(renderSource, /mode === 'preview'/);
  assert.match(renderSource, /!isStrictSourceMode\(view\)/);
  assert.match(itemSource, /isCompletedTaskSourceLine\(item\.markdown\)/);
  assert.match(itemSource, /tps-gcm-linked-context-card--terminal-task/);
  assert.match(itemSource, /classifyRenderedTaskRows\(body\)/);
  assert.match(manager, /taskRow\.setAttribute\('data-task', result\.task\.marker\)/);
  assert.match(manager, /checkbox\.disabled = false;\s*this\.ensureMenus\(\)/);
});

test('opening Mentions schedules one deferred full reference scan', () => {
  const start = panelBuilder.indexOf('createNoteReferencesPanel');
  const end = panelBuilder.indexOf('createNoteGraphPanel', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = panelBuilder.slice(start, end);

  assert.equal((source.match(/refreshNoteReferencesPanel\(/g) || []).length, 1);
  assert.match(source, /}, 0\)/);
  assert.doesNotMatch(source, /}, 250\)/);
});
