import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const commandsSource = await readFile(
  fileURLToPath(new URL('../src/commands/register-commands.ts', import.meta.url)),
  'utf8',
);
const mainSource = await readFile(
  fileURLToPath(new URL('../src/main.ts', import.meta.url)),
  'utf8',
);
const contextTargetSource = await readFile(
  fileURLToPath(new URL('../src/services/context-target-service.ts', import.meta.url)),
  'utf8',
);

test('sidebar open commands are not registered in the streamlined command surface', () => {
  assert.doesNotMatch(commandsSource, /id: 'open-in-right-sidebar'/);
  assert.doesNotMatch(commandsSource, /id: 'open-in-left-sidebar'/);
  assert.doesNotMatch(commandsSource, /openActiveFileInSidebar/);
  assert.doesNotMatch(commandsSource, /findSidebarLeafForFile/);
  assert.doesNotMatch(commandsSource, /isSidebarLeaf/);
});

test('daily inbox line commands stay searchable and guard missing editor state at runtime', () => {
  assert.doesNotMatch(commandsSource, /id: 'archive-current-line-in-place'/);
  assert.doesNotMatch(commandsSource, /Archive current line in place/);
  for (const id of [
    'transfer-current-line-to-note',
    'link-current-task-line-to-note',
  ]) {
    assert.match(commandsSource, new RegExp(`id: '${id}'`));
  }
  assert.doesNotMatch(commandsSource, /checkCallback: \(checking\) => \{\s*const view = plugin\.app\.workspace\.getActiveViewOfType\(MarkdownView\)/);
  assert.match(commandsSource, /function getActiveMarkdownEditor\(plugin: TPSGlobalContextMenuPlugin\): MarkdownView \| null/);
  assert.match(commandsSource, /TPS GCM: Open a markdown editor before running this line command\./);
});

test('default note opens stay native while plugin-owned opens avoid pinned tabs', () => {
  const nativeOpenSource = mainSource.slice(
    mainSource.indexOf('WorkspaceLeaf.prototype.openFile = function'),
    mainSource.indexOf('WorkspaceLeaf.prototype.open = function'),
  );
  assert.doesNotMatch(mainSource, /recentNotebookNavigatorOpenUntil/);
  assert.doesNotMatch(mainSource, /source: isRecentNotebookNavigatorOpen \? 'notebook-navigator' : 'occupied-leaf'/);
  assert.doesNotMatch(mainSource, /source: 'occupied-leaf'/);
  assert.match(mainSource, /isPinnedLeafForDifferentFile\(leaf: WorkspaceLeaf, file: TFile \| null\)/);
  assert.match(mainSource, /if \(sourceLeaf && this\.isPinnedLeafForDifferentFile\(sourceLeaf, null\)\) \{\s*return this\.app\.workspace\.getLeaf\(true\);\s*\}/);
  assert.match(mainSource, /let leaf = getLeaf\(\)/);
  assert.match(mainSource, /leaf = this\.app\.workspace\.getLeaf\(true\)/);
  assert.doesNotMatch(mainSource, /plugin\.getDefaultOpenSourceLeaf\(previousActiveLeaf, previousMostRecentLeaf, leaf\)/);
  assert.doesNotMatch(mainSource, /plugin\.recordDefaultOpenCreatedLeaf\(leaf, sourceLeaf\)/);
  assert.doesNotMatch(mainSource, /private isMainWorkspaceLeaf\(leaf: WorkspaceLeaf\): boolean/);
  assert.doesNotMatch(mainSource, /defaultOpenCreatedLeaves/);
  assert.doesNotMatch(mainSource, /defaultMarkdownOpenPromises/);
  assert.doesNotMatch(nativeOpenSource, /plugin\.consumeDefaultOpenCreatedLeaf\(this, targetFile\)/);
  assert.doesNotMatch(nativeOpenSource, /plugin\.detachUnusedDefaultOpenLeaf\(this\)/);
  assert.match(nativeOpenSource, /return originalLeafOpenFile\.apply\(this, args as any\)/);
  assert.doesNotMatch(mainSource, /shouldOpenMissingDefaultInNewTab/);
});

test('context target diagnostics record concise resolution and selection decisions', () => {
  assert.match(contextTargetSource, /logger\.flow\('ContextTarget', 'resolve:done'/);
  for (const source of [
    'canvas',
    'kanban',
    'notebook-navigator-non-file',
    'explicit-selection',
    'embed',
    'explorer-selection',
    'active-file',
    'none',
  ]) {
    assert.match(contextTargetSource, new RegExp(`'${source}'`));
  }
  assert.match(contextTargetSource, /logger\.flow\('ContextTarget', 'selection:resolved'/);
  assert.match(contextTargetSource, /logger\.flowWarn\('ContextTarget', 'selection:mismatch-fallback'/);
  assert.doesNotMatch(contextTargetSource, /\[Target Service\]/);
  assert.doesNotMatch(contextTargetSource, /Selected Node/);
  assert.doesNotMatch(contextTargetSource, /NN source counts:/);
});
