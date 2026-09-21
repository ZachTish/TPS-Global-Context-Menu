import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function method(path, name) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  let result;
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === name) result = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(result, name);
  return result;
}
const output = ts.transpileModule(`
export class TFile { constructor(public path: string) {} }
const logger = {log() {}, error() {}};
const getErrorMessage = () => 'error';
class Notice {}
export class Opener { ${method('../src/main.ts', 'openFileInLeaf')} }
export class Hiding { ${method('../src/services/hide-completed-checkboxes-service.ts', 'refreshAllEditors')} }
`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const exports = {};
new Function('exports', output)(exports);

function openerFixture({ nativeActivates = true, existing = false } = {}) {
  const file = new exports.TFile('Inbox/Note.md'); file.extension = 'md';
  let activations = 0, opens = 0, reveals = 0;
  const workspace = { activeLeaf: null, setActiveLeaf(leaf) { this.activeLeaf = leaf; activations++; }, revealLeaf() { reveals++; } };
  const leaf = { view: { getViewType: () => 'markdown' }, async openFile(_file, options) { opens++; if (nativeActivates && options.active) workspace.setActiveLeaf(leaf); } };
  const opener = Object.assign(new exports.Opener(), {
    app: { vault: { getAbstractFileByPath: () => file }, workspace },
    settings: {}, shouldSuppressOpenForRecentCanvasDrag: () => false, logOpenerDecision() {},
    findOpenLeafForFile: () => existing ? leaf : null, describeOpenerLeaf: () => ({}),
    isPinnedLeafForDifferentFile: () => false, isBlankLeaf: () => false,
    commandQueueService: { async executeOpenActiveFile(_file, run) { await run(); return { success: true }; }, async executeOpenInNewContext(_file, _context, run) { await run(); return { success: true }; } }
  });
  return { opener, file, leaf, counts: () => ({ activations, opens, reveals }) };
}

test('a normal foreground open lets Obsidian focus the leaf once', async () => {
  const f = openerFixture();
  assert.equal(await f.opener.openFileInLeaf(f.file, false, () => f.leaf), true);
  assert.deepEqual(f.counts(), { activations: 1, opens: 1, reveals: 1 });
});
test('fallback activation remains when the native opener did not activate', async () => {
  const f = openerFixture({ nativeActivates: false });
  await f.opener.openFileInLeaf(f.file, false, () => f.leaf);
  assert.equal(f.counts().activations, 1);
});
test('explicit reuse still focuses an already open note without reopening it', async () => {
  const f = openerFixture({ existing: true });
  await f.opener.openFileInLeaf(f.file, false, () => f.leaf);
  assert.deepEqual(f.counts(), { activations: 1, opens: 0, reveals: 1 });
});
test('background opening preserves the current focus', async () => {
  const f = openerFixture();
  await f.opener.openFileInLeaf(f.file, false, () => f.leaf, { active: false, revealLeaf: false });
  assert.deepEqual(f.counts(), { activations: 0, opens: 1, reveals: 0 });
});
test('navigation refreshes widget roots without reconfiguring other editors; settings still reconfigure', () => {
  let configurations = 0, liveRoots = 0, readingRoots = 0, refreshes = 0;
  const service = Object.assign(new exports.Hiding(), {
    plugin: { app: { workspace: { updateOptions() { configurations++; } } } },
    discoverLivePreviewRoots() { liveRoots++; }, discoverRenderedRoots() { readingRoots++; }, scheduleRefresh() { refreshes++; }
  });
  service.refreshAllEditors({ reconfigureEditors: false });
  assert.deepEqual([configurations, liveRoots, readingRoots, refreshes], [0, 1, 1, 1]);
  service.refreshAllEditors();
  assert.deepEqual([configurations, liveRoots, readingRoots, refreshes], [1, 2, 2, 2]);
  const events = readFileSync(new URL('../src/events/register-events.ts', import.meta.url), 'utf8');
  const poll = events.slice(events.indexOf('let lastActiveModeSignature'), events.indexOf("plugin.app.workspace.on('editor-change'"));
  assert.doesNotMatch(poll, /workspace\.updateOptions/);
  assert.match(poll, /refreshAllEditors\(\{ reconfigureEditors: false \}\)/);
});
