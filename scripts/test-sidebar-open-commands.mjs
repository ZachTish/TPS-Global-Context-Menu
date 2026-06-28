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

test('sidebar open commands use a sidebar-specific leaf resolver', () => {
  assert.match(commandsSource, /id: 'open-in-right-sidebar'[\s\S]*openActiveFileInSidebar\(plugin, file, 'right'\)/);
  assert.match(commandsSource, /id: 'open-in-left-sidebar'[\s\S]*openActiveFileInSidebar\(plugin, file, 'left'\)/);
  assert.doesNotMatch(
    commandsSource,
    /id: 'open-in-right-sidebar'[\s\S]*?plugin\.openFileInLeaf[\s\S]*?id: 'open-in-left-sidebar'/,
  );
});

test('sidebar open helper only reuses leaves in the requested side dock', () => {
  assert.match(commandsSource, /function findSidebarLeafForFile\(/);
  assert.match(commandsSource, /function isSidebarLeaf\(/);
  assert.match(commandsSource, /container\.closest\(selector\)/);
  assert.match(commandsSource, /\.workspace-split\.mod-right-split/);
  assert.match(commandsSource, /\.workspace-split\.mod-left-split/);
});

test('sidebar open helper creates side leaves without stealing editor focus', () => {
  assert.match(commandsSource, /getRightLeaf\(false\) \?\? plugin\.app\.workspace\.getRightLeaf\(true\)/);
  assert.match(commandsSource, /getLeftLeaf\(false\) \?\? plugin\.app\.workspace\.getLeftLeaf\(true\)/);
  assert.match(commandsSource, /await leaf\.openFile\(file, \{ active: false \} as any\)/);
  assert.match(commandsSource, /plugin\.app\.workspace\.revealLeaf\(leaf\)/);
});

test('default note opens preserve pinned source leaves by routing missing notes to a new tab', () => {
  assert.match(mainSource, /if \(this\.isPinnedLeafForDifferentFile\(leaf, file\)\) return true/);
  assert.match(mainSource, /isPinnedLeafForDifferentFile\(leaf: WorkspaceLeaf, file: TFile \| null\)/);
  assert.match(mainSource, /if \(sourceLeaf && this\.isPinnedLeafForDifferentFile\(sourceLeaf, null\)\) \{\s*return this\.app\.workspace\.getLeaf\(true\);\s*\}/);
  assert.match(mainSource, /leaf = this\.app\.workspace\.getLeaf\(true\)/);
});
