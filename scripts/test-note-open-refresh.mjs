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

test('turning off child-link rows clears mounted observers and decorations before skipping later refreshes', () => {
  const path = '../src/services/linked-subitem-checkbox-service.ts';
  const methods = ['ensureForAllMarkdownViews', 'ensureForView', 'removeForView'].map(name => method(path, name)).join('\n');
  const output = ts.transpileModule(`export class LinkedRows { ${methods} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = {};
  class MarkdownView {}
  const document = { body: { dataset: {} } };
  const clearedTimers = [];
  const window = { clearTimeout: id => clearedTimers.push(id) };
  new Function('exports', 'MarkdownView', 'TFile', 'document', 'window', output)(
    module, MarkdownView, exports.TFile, document, window,
  );

  const view = new MarkdownView();
  view.file = new exports.TFile('Inbox/Child links.md');
  view.file.extension = 'md';
  let disconnects = 0;
  const clearedViews = [];
  const settings = { enableLinkedSubitemCheckboxes: true };
  const service = Object.assign(new module.LinkedRows(), {
    plugin: {
      settings,
      app: { workspace: {
        getActiveViewOfType: () => view,
        getLeavesOfType: () => [{ view }],
      } },
    },
    observers: new Map([[view, { disconnect() { disconnects++; } }]]),
    refreshTimers: new Map([[view, 42]]),
    clearDecorations(target) { clearedViews.push(target); },
    taskTrace() {},
  });

  settings.enableLinkedSubitemCheckboxes = false;
  service.ensureForAllMarkdownViews();
  assert.equal(disconnects, 1);
  assert.deepEqual(clearedViews, [view]);
  assert.deepEqual(clearedTimers, [42]);
  assert.equal(service.observers.size, 0);
  assert.equal(service.refreshTimers.size, 0);

  const settingsSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(settingsSource, /Render child-note links as checkboxes/u);
  assert.match(mainSource, /this\.settings\.enableLinkedSubitemCheckboxes = false/u);
});

test('metadata refreshes batch every changed file and parent without a second delayed render', () => {
  const eventPath = '../src/events/register-events.ts';
  const sourceText = readFileSync(new URL(eventPath, import.meta.url), 'utf8');
  const source = ts.createSourceFile(eventPath, sourceText, ts.ScriptTarget.Latest, true);
  let initializer;
  let parentRefreshInitializer;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'scheduleMetadataMenuRefresh') initializer = node.initializer.getText(source);
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'refreshRelatedParentMenus') parentRefreshInitializer = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(initializer); assert.ok(parentRefreshInitializer);
  const overlay = readFileSync(new URL('../src/services/overlay-rendering-service.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  const output = ts.transpileModule(`
    class Component {}
    export class TFile { extension = 'md'; constructor(public path: string) {} }
    const logger = { perf() {}, taskTrace() {}, error() {} };
    ${overlay}
    export function metadataScheduler(plugin, overlayRendering) {
      const refreshRelatedParentMenus = ${parentRefreshInitializer};
      return ${initializer};
    }
  `, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = {}; let nextId = 0; const timers = new Map();
  const window = { setTimeout(fn) { const id = ++nextId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
  new Function('exports', 'window', output)(module, window);
  const a = new module.TFile('A.md'), b = new module.TFile('B.md'), parent = new module.TFile('Parent.md');
  const refreshed = [];
  const plugin = { settings: {}, app: { vault: { getFileByPath: path => path === parent.path ? parent : null } },
    persistentMenuManager: { refreshMenusForFile(file, force) { refreshed.push([file.path, force]); } } };
  const service = new module.OverlayRenderingService(plugin);
  const schedule = module.metadataScheduler(plugin, service);
  service.scheduleFileRefresh(a, 'vault-modify', { force: true, delayMs: 400 });
  schedule(a, [parent.path]); schedule(b, [parent.path]);
  assert.equal(timers.size, 1);
  for (const [id, run] of [...timers]) { timers.delete(id); run(); }
  assert.deepEqual(refreshed, [['A.md', true], ['Parent.md', true], ['B.md', true]]);
  assert.equal(timers.size, 0, 'there must be no second 350 ms debounce render');
  service.onunload();
  const openHandler = sourceText.slice(sourceText.indexOf("plugin.app.workspace.on('file-open'"), sourceText.indexOf('// ── Reactive completedDate sync'));
  assert.match(openHandler, /scheduleMenus\('file-open', 0\)/);
  assert.doesNotMatch(openHandler, /scheduleResponsiveMenuRefresh/);
});


test('retired panel cleanup removes existing remnants without creating footer hosts', () => {
  const output = ts.transpileModule(`export class Cleanup { ${method('../src/menu/persistent-menu-manager.ts', 'removeNoteReferencesPanel')} }`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  class Element {
    constructor(children = []) { this.children = children; this.removed = false; }
    remove() { this.removed = true; }
  }
  const module = {};
  new Function('exports', 'HTMLElement', output)(module, Element);
  const oldPanel = new Element(), stray = new Element(), emptyHost = new Element(), sharedHost = new Element([{}]);
  const view = { contentEl: { querySelectorAll(selector) {
    return selector === '.tps-gcm-note-references' ? [stray] : [emptyHost, sharedHost];
  } } };
  const cleanup = Object.assign(new module.Cleanup(), {
    noteReferencesPanels: new Map([[view, oldPanel]]),
    resolveNoteFooterParent() { assert.fail('cleanup must not create a footer'); },
  });
  cleanup.removeNoteReferencesPanel(view);
  assert.equal(oldPanel.removed, true); assert.equal(stray.removed, true);
  assert.equal(emptyHost.removed, true); assert.equal(sharedHost.removed, false);
  assert.equal(cleanup.noteReferencesPanels.size, 0);
});

test('linked-subitem mode resolution avoids style/layout reads when Obsidian reports its mode', () => {
  const source = method('../src/services/linked-subitem-checkbox-service.ts', 'getLinkedSubitemRenderMode');
  const output = ts.transpileModule(`export class Modes { ${source} }`, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module = {};
  new Function('exports','isStrictSourceMode','getViewMode',output)(module,view=>view.strict===true,()=>null);
  const service = new module.Modes();
  service.getVisiblePreviewContainer = () => assert.fail('reported mode must avoid computed style and layout reads');
  for (const mode of ['source','preview']) {
    const view = {getMode:()=>mode,contentEl:{querySelector:()=>assert.fail('mode must not query stale render wrappers')}};
    assert.equal(service.getLinkedSubitemRenderMode(view),mode);
    assert.equal(service.getLinkedSubitemRenderMode({...view,strict:true}),null);
  }
});

test('linked-subitem mode resolution retains DOM fallback for missing or throwing mode APIs', () => {
  const output=ts.transpileModule(`export class Modes { ${method('../src/services/linked-subitem-checkbox-service.ts','getLinkedSubitemRenderMode')} }`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={};new Function('exports','isStrictSourceMode','getViewMode',output)(module,()=>false,()=>null);
  const service=new module.Modes();service.getVisiblePreviewContainer=()=>({});
  assert.equal(service.getLinkedSubitemRenderMode({}), 'preview');
  assert.equal(service.getLinkedSubitemRenderMode({getMode(){throw Error('teardown');}}), 'preview');
  service.getVisiblePreviewContainer=()=>null;service.isVisibleRenderContainer=el=>!!el;
  assert.equal(service.getLinkedSubitemRenderMode({contentEl:{querySelector:()=>({})}}), 'source');
});

test('preview cleanup removes visible and hidden remnants without layout reads or touching editor widgets', () => {
  const path='../src/services/linked-subitem-checkbox-service.ts';
  const output=ts.transpileModule(`export class Cleanup { ${method(path,'clearDecorations')} ${method(path,'clearPreviewDecorations')} }`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={};class Input {}
  new Function('exports','HTMLInputElement',output)(module,Input);
  const service=new module.Cleanup();service.getVisiblePreviewContainer=()=>assert.fail('cleanup must never measure visibility');
  const checkbox=()=>({removed:false,remove(){this.removed=true;}});
  const shown=checkbox(),hidden=checkbox(),editor=checkbox();
  const wrapper=box=>({querySelectorAll:selector=>selector==='.tps-gcm-linked-subitem-checkbox'?[box]:[]});
  const view={contentEl:{querySelectorAll(selector){assert.equal(selector,'.markdown-preview-view, .markdown-reading-view');return [wrapper(shown),wrapper(hidden)];}}};
  service.clearDecorations(view);assert.equal(shown.removed,true);assert.equal(hidden.removed,true);assert.equal(editor.removed,false);
});


test('read-only subitem inspection uses cached content while explicit mutations retain fresh reads', async () => {
  const output = ts.transpileModule(`export class Reader { ${method('../src/services/subitem-relationship-sync-service.ts', 'readMarkdownText')} }`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = {};
  new Function('exports', 'TFile', output)(module, exports.TFile);
  const file = new exports.TFile('Inbox/Note.md'); file.extension = 'md';
  let cached = 0, raw = 0, view = null;
  const reader = Object.assign(new module.Reader(), {
    plugin: { app: { vault: {
      cachedRead: async () => { cached++; return 'cached'; },
      read: async () => { raw++; return 'fresh'; },
    } } },
    getOpenMarkdownViewForFile: () => view,
    readViewSource: () => view.source,
  });
  assert.equal(await reader.readMarkdownText(file, { cached: true }), 'cached');
  assert.equal(await reader.readMarkdownText(file), 'fresh');
  view = { source: 'unsaved editor content' };
  assert.equal(await reader.readMarkdownText(file, { cached: true }), view.source);
  view.source = '';
  assert.equal(await reader.readMarkdownText(file, { cached: true }), '');
  assert.deepEqual([cached, raw], [1, 1]);
  const prompt = readFileSync(new URL('../src/services/unresolved-subitem-modal.ts', import.meta.url), 'utf8');
  assert.match(prompt, /readMarkdownText\(parentFile, \{ cached: true \}\)/);
});


test('opening an already aligned daily note skips scheduled-field mutation work', async () => {
  const output = ts.transpileModule(`export class Naming { ${method('../src/services/file-naming-service.ts', 'repairDailyNoteScheduled')} }`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = {}; new Function('exports', output)(module);
  const counts = { protection: 0, safety: 0, process: 0 };
  const fm = { scheduled: '2026-09-27 00:00:00' };
  const service = Object.assign(new module.Naming(), {
    isDailyNoteFile: async () => true, parseDailyNoteBasenameToIso: () => '2026-09-27',
    isProcessRunFrontmatter: () => false, parseScheduledToIso: value => value.slice(0, 10),
    canAutomaticallyMutateTemplateSource: async () => { counts.protection++; return true; },
    canAutomaticallyMutateTemplateFrontmatter: () => true,
    plugin: { app: { metadataCache: { getFileCache: () => ({ frontmatter: fm }) } },
      bulkEditService: { canMutateFrontmatterSafely: async () => { counts.safety++; return true; }, runSerializedFrontmatterWrite: async (_f, run) => run() },
      frontmatterMutationService: { process: async (_f, run) => { counts.process++; run(fm); } },
    },
  });
  assert.equal(await service.repairDailyNoteScheduled({ basename: '2026-09-27' }), false);
  assert.deepEqual(counts, { protection: 0, safety: 0, process: 0 });
  fm.scheduled = '2026-09-26 00:00:00';
  assert.equal(await service.repairDailyNoteScheduled({ basename: '2026-09-27' }), true);
  assert.equal(fm.scheduled, '2026-09-27 00:00:00');
  assert.deepEqual(counts, { protection: 1, safety: 1, process: 1 });
});


test('retired parent maintenance emits no false change or render event', async () => {
  const output = ts.transpileModule(`export class Maintenance { ${method('../src/services/bulk-edit-service.ts', 'reconcileParentChildLinksForParent')} }`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = {};
  new Function('exports', 'setTimeout', output)(module, () => assert.fail('unchanged maintenance must not queue a render'));
  const fail = () => assert.fail('unchanged maintenance must not notify consumers');
  const service = Object.assign(new module.Maintenance(), {
    plugin: { subitemRelationshipSyncService: { reconcileMarkdownParent: async () => ({addedParents: 0, removedParents: 0, touchedChildren: []}) },
      viewModeManager: {handlePotentialFrontmatterChange: fail} },
    parentLinkHandler: {normalizeParentKey: fail}, notifyFilesChanged: fail,
  });
  for (let i = 0; i < 100; i++) assert.equal(await service.reconcileParentChildLinksForParent({path: `Parent${i}.md`}), 0);
});
