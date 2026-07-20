import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const serviceSource = readFileSync(
  new URL('../src/services/daily-note-home-service.ts', import.meta.url),
  'utf8',
);

async function importIntentUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/notebook-navigator-home-intent.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

test('Notebook Navigator selection gestures follow its configured modifier', async () => {
  const { isNotebookNavigatorSelectionGesture } = await importIntentUtility();
  const modifiers = (overrides = {}) => ({
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  });

  assert.equal(isNotebookNavigatorSelectionGesture(modifiers({ shiftKey: true }), 'cmdCtrl', true), true);
  assert.equal(isNotebookNavigatorSelectionGesture(modifiers({ metaKey: true }), 'cmdCtrl', true), true);
  assert.equal(isNotebookNavigatorSelectionGesture(modifiers({ ctrlKey: true }), 'cmdCtrl', true), false);
  assert.equal(isNotebookNavigatorSelectionGesture(modifiers({ ctrlKey: true }), 'cmdCtrl', false), true);
  assert.equal(isNotebookNavigatorSelectionGesture(modifiers({ metaKey: true }), 'cmdCtrl', false), true);
  assert.equal(isNotebookNavigatorSelectionGesture(modifiers({ altKey: true }), 'optionAlt', true), true);
  assert.equal(isNotebookNavigatorSelectionGesture(modifiers({ metaKey: true }), 'optionAlt', true), false);
  assert.equal(isNotebookNavigatorSelectionGesture(modifiers({ shiftKey: true }), 'cmdCtrl', true, true), false);
  assert.equal(isNotebookNavigatorSelectionGesture(modifiers({ altKey: true }), 'optionAlt', false, true), false);
});

test('Notebook Navigator current selection includes the surviving focused file after deselection', async () => {
  const { collectNotebookNavigatorSelectionPaths } = await importIntentUtility();
  const knownPaths = new Set([
    'Daily/2026-07-20.md',
    'Daily/2026-07-21.md',
  ]);
  const paths = collectNotebookNavigatorSelectionPaths({
    files: ['Daily/2026-07-20.md'],
    focused: { path: 'Daily/2026-07-21.md' },
  }, (rawPath) => knownPaths.has(rawPath) ? rawPath : null);

  assert.deepEqual(paths.sort(), [
    'Daily/2026-07-20.md',
    'Daily/2026-07-21.md',
  ]);
});

test('selection-only Daily Note suppression persists for the exact leaf and path', async () => {
  const { NotebookNavigatorHomeIntentTracker } = await importIntentUtility();
  const tracker = new NotebookNavigatorHomeIntentTracker(1000);
  const selectedLeaf = {};
  const otherLeaf = {};

  tracker.markSelection(['Daily/2026-07-21.md'], 100);
  assert.equal(tracker.shouldSuppress(selectedLeaf, 'Daily/2026-07-21.md', 101), true);
  assert.equal(tracker.shouldSuppress(otherLeaf, 'Daily/2026-07-21.md', 101), false);
  assert.equal(tracker.shouldSuppress(otherLeaf, 'Daily/2026-07-22.md', 101), false);
  assert.equal(tracker.shouldSuppress(selectedLeaf, 'Daily/2026-07-21.md', 5000), true);

  tracker.reconcileLeaf(selectedLeaf, 'Daily/2026-07-22.md');
  assert.equal(tracker.shouldSuppress(selectedLeaf, 'Daily/2026-07-21.md', 5000), false);
});

test('a later plain Notebook Navigator open clears selection-only suppression', async () => {
  const { NotebookNavigatorHomeIntentTracker } = await importIntentUtility();
  const tracker = new NotebookNavigatorHomeIntentTracker(1000);
  const leaf = {};

  tracker.markSelection(['Daily/2026-07-21.md'], 100);
  assert.equal(tracker.shouldSuppress(leaf, 'Daily/2026-07-21.md', 101), true);
  tracker.markPlainOpen('Daily/2026-07-21.md');
  assert.equal(tracker.shouldSuppress(leaf, 'Daily/2026-07-21.md', 102), false);

  tracker.markSelection(['Daily/2026-07-22.md'], 200);
  tracker.retainLeaves(new Set(), 201);
  assert.equal(tracker.shouldSuppress(leaf, 'Daily/2026-07-22.md', 2000), false);
});

test('Daily Note Home observes Notebook Navigator without taking over its events', () => {
  assert.match(serviceSource, /registerDomEvent\(document, 'click',[\s\S]*true\);/);
  assert.match(serviceSource, /registerDomEvent\(document, 'dragstart',[\s\S]*true\);/);
  assert.match(serviceSource, /isNotebookNavigatorFileContextTarget\(target\)/);
  assert.match(serviceSource, /resolveNotebookNavigatorFileTarget\(target\)/);
  assert.match(serviceSource, /multiSelectModifier/);
  assert.match(serviceSource, /Platform\.isMacOS && event\.ctrlKey && !event\.metaKey/);
  assert.match(serviceSource, /getSelectedFiles\(target\.scopeRoot\)/);
  assert.match(serviceSource, /selectionApi\?\.getCurrent/);
  assert.match(serviceSource, /collectNotebookNavigatorSelectionPaths\(currentSelection/);
  assert.match(serviceSource, /notebookNavigatorHomeIntent\.shouldSuppress\(candidate\.leaf, candidate\.file\.path\)/);
  assert.match(serviceSource, /\.nn-quick-action-item/);
  assert.doesNotMatch(serviceSource, /preventDefault\(|stopPropagation\(|stopImmediatePropagation\(/);
});
