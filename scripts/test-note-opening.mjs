import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

class TFile { constructor(path = 'Inbox/New.md') { this.path = path; this.extension = path.split('.').at(-1); } }
const notices = [];
const platform = { isMobile: false };
const logger = { flow() {}, flowWarn() {}, flowError() {}, warn() {} };
function load(path, extra = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', code)(id => {
    if (id === 'obsidian') return { TFile, Platform: platform, Notice: class { constructor(message) { notices.push(message); } }, QueryController: class {} };
    if (id === '../logger') return logger;
    if (id === '../utils/native-base-create-routes') return routeExports;
    if (id === 'monkey-around') return extra;
    throw new Error(id);
  }, module, module.exports);
  return module.exports;
}
const { NoteOpeningService, migrateNoteOpeningSettings, normalizeNoteOpeningSettings } = load('../src/services/note-opening-service.ts');
const routeExports = load('../src/utils/native-base-create-routes.ts');
const { findNativeBaseCreateRoute, validateNativeBaseCreateRoute } = routeExports;
const { runNativeCreateWithoutOpening, supportsNativeCreateBoundary, NativeBaseNoteOpening } = load('../src/services/native-base-note-opening.ts', {
  around(prototype, wrappers) {
    const old = {};
    for (const key of Object.keys(wrappers)) { old[key] = prototype[key]; prototype[key] = wrappers[key](old[key]); }
    return () => Object.assign(prototype, old);
  }
});
function fixture() {
  const file = new TFile();
  const opened = [], previewed = [], viewStates = [], renameStates = [];
  let viewState = { type: 'markdown', state: { file: file.path, mode: 'preview' } };
  const leaf = {
    view: { containerEl: { isConnected: true }, setEphemeralState: state => renameStates.push(state) },
    getViewState: () => viewState,
    setViewState: async state => { viewStates.push(state); viewState = state; },
  };
  const plugin = {
    nativeRecordService: { prepareCreatedNote: async () => {} },
    settings: { notePostCreateBehavior: 'open', noteOpenDestination: 'current-tab' },
    app: { vault: { getAbstractFileByPath: path => path === file.path ? file : null }, workspace: { activeLeaf: leaf, getLeaf: context => ({ context }) } },
    openFileInLeaf: async (...args) => { opened.push(args); return true; },
    findOpenLeafForFile: () => leaf,
    showNativeNotePreview: (...args) => { previewed.push(args); return true; },
  };
  return { plugin, file, leaf, opened, previewed, viewStates, renameStates, service: new NoteOpeningService(plugin) };
}
test('desktop preview uses a connected caller anchor and event; unavailable and mobile preview use native Open', async () => {
  const f = fixture();
  f.plugin.settings.notePostCreateBehavior = 'preview';
  const anchorEl = { isConnected: true }, event = { type: 'click' };
  assert.equal(await f.service.present({ filePath: f.file.path, sourcePluginId: 'test', anchorEl, event, sourceLeaf: f.leaf }), true);
  assert.deepEqual(f.previewed, [[f.file, anchorEl, f.leaf, event]]);
  assert.equal(f.opened.length, 0);
  assert.equal(await f.service.present({ filePath: f.file.path, sourcePluginId: 'test', anchorEl: { isConnected: false } }), true);
  assert.equal(f.opened[0][1], false);
  assert.equal(await f.service.present({ filePath: f.file.path, sourcePluginId: 'test', sourceLeaf: f.leaf }), true);
  assert.equal(f.opened.length, 2, 'no caller anchor cannot open a preview over an unrelated note area');
  platform.isMobile = true;
  assert.equal(await f.service.present({ filePath: f.file.path, sourcePluginId: 'test', anchorEl }), true);
  platform.isMobile = false;
  assert.equal(f.opened.length, 3);
  assert.equal(f.previewed.length, 1);
});
test('Open always selects Obsidian Markdown Editing mode even when the reused leaf was in Reading mode', async () => {
  const f = fixture();
  f.plugin.settings.noteOpenDestination = 'new-tab';
  assert.equal(await f.service.present({ filePath: f.file.path, sourcePluginId: 'test' }), true);
  assert.equal(f.opened[0][1], 'tab');
  assert.equal(f.viewStates.length, 1);
  assert.equal(f.viewStates[0].state.mode, 'source');
  assert.equal(f.viewStates[0].state.file, f.file.path);
  assert.equal(await f.service.open(f.file), true);
  assert.equal(f.viewStates.length, 1, 'already Editing mode should not set view state again');
});
test('stay is silent, open follows destination, explicit new tab overrides stay', async () => {
  const f = fixture(); const request = { filePath: f.file.path, sourcePluginId: 'test' };
  f.plugin.settings.notePostCreateBehavior = 'stay';
  assert.equal(await f.service.present(request), true);
  assert.equal(f.opened.length, 0);
  await f.service.present({ ...request, explicitDestination: 'tab' });
  assert.equal(f.opened[0][1], 'tab');
  f.plugin.settings.notePostCreateBehavior = 'open';
  await f.service.present(request);
  assert.equal(f.opened[1][1], false);
  assert.equal(await f.service.present({ ...request, filePath: 'missing' }), false);
  assert.equal(await f.service.present(null), false);
});
test('legacy preferences migrate only missing keys without writing other plugins', async () => {
  let reads = 0;
  const app = { vault: { configDir: '.obsidian', adapter: {
    exists: async () => true,
    read: async path => { reads++; return JSON.stringify(path.includes('calendar') ? { postCreateBehavior: 'stay' } : { createNewNotesInNewTab: true }); }
  } } };
  assert.deepEqual(await migrateNoteOpeningSettings(app, {}), { notePostCreateBehavior: 'stay', noteOpenDestination: 'new-tab' });
  assert.equal(reads, 2);
  assert.deepEqual(await migrateNoteOpeningSettings(app, { notePostCreateBehavior: 'open', noteOpenDestination: 'current-tab' }), { notePostCreateBehavior: 'open', noteOpenDestination: 'current-tab' });
  assert.equal(reads, 2);
  assert.deepEqual(normalizeNoteOpeningSettings({ notePostCreateBehavior: 'preview' }), { notePostCreateBehavior: 'preview', noteOpenDestination: 'current-tab' });
  app.vault.adapter.read = async () => JSON.stringify({ postCreateBehavior: 'preview' });
  assert.deepEqual(await migrateNoteOpeningSettings(app, {}), { notePostCreateBehavior: 'preview', noteOpenDestination: 'current-tab' });
  app.vault.adapter.read = async () => '{bad';
  assert.deepEqual(await migrateNoteOpeningSettings(app, {}), { notePostCreateBehavior: 'preview', noteOpenDestination: 'current-tab' });
});
function nativeFixture() {
  const writes = [], openings = [];
  const file = new TFile();
  const app = { vault: { getAbstractFileByPath: () => null }, fileManager: {
    createNewFile: async (...args) => { writes.push(args); return file; },
    processFrontMatter: async (created, callback) => { const fm = { template: true }; callback(fm, created); writes.push(fm); }
  }, workspace: { getLeaf: () => ({ openFile: async f => openings.push(f) }) } };
  class Menu {
    constructor() { this.app = app; this.query = {}; this.viewConfig = {}; }
    async open(name, callback) {
      const file = await this.app.fileManager.createNewFile('native-folder', name);
      await this.app.fileManager.processFrontMatter(file, fm => { fm.kind = 'note'; callback?.(fm, file); });
      await this.app.workspace.getLeaf('tab').openFile(file);
    }
  }
  return { menu: new Menu(), app, file, writes, openings };
}
test('native boundary preserves creation arguments, template and callback before suppressing phone open', async () => {
  const f = nativeFixture(); const originalManager = f.app.fileManager;
  assert.equal(supportsNativeCreateBoundary(f.menu.open), true);
  assert.equal(await runNativeCreateWithoutOpening(f.menu, f.menu.open, ['Untitled', fm => { fm.status = 'todo'; }]), f.file);
  assert.deepEqual(f.writes, [['native-folder', 'Untitled'], { template: true, kind: 'note', status: 'todo' }]);
  assert.equal(f.openings.length, 0);
  assert.equal(f.app.fileManager, originalManager);
  await f.app.workspace.getLeaf().openFile(f.file);
  assert.equal(f.openings.length, 1);
});
test('cancellation and failures do not present or retry a partially created file', async () => {
  const f = nativeFixture();
  assert.equal(await runNativeCreateWithoutOpening(f.menu, async () => {}, []), null);
  f.app.fileManager.processFrontMatter = async () => { throw new Error('write failed'); };
  await assert.rejects(runNativeCreateWithoutOpening(f.menu, f.menu.open, ['One']), /write failed/);
  assert.equal(f.writes.length, 1);
  assert.equal(f.openings.length, 0);
  assert.equal(supportsNativeCreateBoundary(async () => {}), false);
});
test('adapter deduplicates repeated create taps and restores native behavior on unload', async () => {
  const f = nativeFixture(); let presented = 0;
  const adapter = new NativeBaseNoteOpening({ app: f.app, noteOpeningService: { present: async () => { presented++; } } });
  assert.equal(adapter.attach({ newItemMenu: f.menu }), true);
  assert.equal(adapter.attach({ newItemMenu: f.menu }), true);
  await Promise.all([f.menu.open('One'), f.menu.open('Two')]);
  assert.equal(presented, 1);
  assert.equal(f.writes.length, 2);
  adapter.dispose();
  await f.menu.open('Three');
  assert.equal(f.openings.length, 1);
});

test('Base route validation requires exact vault-relative file, view, and configured type', () => {
  assert.deepEqual(validateNativeBaseCreateRoute({ basePath: ' Inbox/Food.base ', viewName: ' Food Log ', recordKind: ' food-entry ' }),
    { basePath: 'Inbox/Food.base', viewName: 'Food Log', recordKind: 'food-entry' });
  for (const basePath of ['/Inbox/Food.base', '../Food.base', 'Inbox\\Food.base', 'Inbox/Food.md']) {
    assert.throws(() => validateNativeBaseCreateRoute({ basePath, viewName: 'Food Log', recordKind: 'food-entry' }));
  }
  assert.equal(findNativeBaseCreateRoute([{ basePath: 'Inbox/Food.base', viewName: 'Food Log', recordKind: 'food-entry' }],
    'Inbox/Food.base', 'Other'), null);
  assert.throws(() => findNativeBaseCreateRoute([
    { basePath: 'Inbox/Food.base', viewName: 'Food Log', recordKind: 'food-entry' },
    { basePath: 'Inbox/Food.base', viewName: 'Food Log', recordKind: 'task' },
  ], 'Inbox/Food.base', 'Food Log'), /More than one/);
});

test('exact routed Base New creates one complete native record and presents through shared mobile-safe opening', async () => {
  const f = nativeFixture();
  const base = new TFile('Inbox/Food.base');
  f.menu.query = { file: base };
  f.menu.viewConfig = { name: 'Food Log' };
  f.app.vault.getAbstractFileByPath = path => path === base.path ? base : null;
  const created = [], presented = [];
  const plugin = {
    app: f.app,
    settings: { nativeBaseCreateRoutes: [{ basePath: base.path, viewName: 'Food Log', recordKind: 'food-entry' }] },
    nativeRecordService: { createFresh: async (...args) => {
      created.push(args);
      return { path: '_records/food-entries/Untitled.md' };
    } },
    noteOpeningService: { present: async request => { presented.push(request); } },
  };
  const adapter = new NativeBaseNoteOpening(plugin);
  assert.equal(adapter.attach({ newItemMenu: f.menu }), true);
  await Promise.all([f.menu.open('One'), f.menu.open('Two')]);
  assert.deepEqual(created, [['food-entry', { title: 'Untitled' }, { fileName: 'Untitled', cause: { kind: 'user' } }]]);
  assert.equal(f.writes.length, 0, 'routed creation never creates a core draft');
  assert.equal(f.openings.length, 0);
  assert.equal(presented.length, 1);
  assert.equal(presented[0].filePath, '_records/food-entries/Untitled.md');
  assert.equal(presented[0].renameTitle, true);
  adapter.dispose();
});

test('changing a saved Base route selects the new record writer on the next New action', async () => {
  const f = nativeFixture();
  const base = new TFile('Inbox/Food.base');
  f.menu.query = { file: base };
  f.menu.viewConfig = { name: 'Food Log' };
  f.app.vault.getAbstractFileByPath = () => base;
  const kinds = [];
  const plugin = {
    app: f.app,
    settings: { nativeBaseCreateRoutes: [{ basePath: base.path, viewName: 'Food Log', recordKind: 'food-entry' }] },
    nativeRecordService: { createFresh: async kind => {
      kinds.push(kind);
      return { path: `_records/${kind}/Untitled.md` };
    } },
    noteOpeningService: { present: async () => {} },
  };
  const adapter = new NativeBaseNoteOpening(plugin);
  adapter.attach({ newItemMenu: f.menu });
  await f.menu.open();
  plugin.settings.nativeBaseCreateRoutes = [{ basePath: base.path, viewName: 'Food Log', recordKind: 'food-log' }];
  await f.menu.open();
  assert.deepEqual(kinds, ['food-entry', 'food-log']);
  assert.equal(f.writes.length, 0);
  adapter.dispose();
});

test('invalid configured route blocks native New before any file is created', async () => {
  const f = nativeFixture();
  const base = new TFile('Inbox/Food.base');
  f.menu.query = { file: base };
  f.menu.viewConfig = { name: 'Food Log' };
  f.app.vault.getAbstractFileByPath = () => base;
  let attempts = 0;
  const plugin = {
    app: f.app,
    settings: { nativeBaseCreateRoutes: [{ basePath: base.path, viewName: 'Food Log', recordKind: 'missing-writer' }] },
    nativeRecordService: { createFresh: async () => { attempts++; throw new Error('writer not configured'); } },
    noteOpeningService: { present: async () => assert.fail('must not present') },
  };
  const adapter = new NativeBaseNoteOpening(plugin);
  adapter.attach({ newItemMenu: f.menu });
  await f.menu.open('One');
  assert.equal(attempts, 1);
  assert.equal(f.writes.length, 0);
  assert.match(notices.at(-1), /writer not configured/);
  f.menu.query.newItemTemplate = 'Templates/Food.md';
  await f.menu.open('Two');
  assert.equal(attempts, 1, 'a configured template blocks before the record creator');
  assert.equal(f.writes.length, 0);
  adapter.dispose();
});

test('nonmatching Base view keeps core New unchanged', async () => {
  const f = nativeFixture();
  f.menu.query = { file: new TFile('Inbox/Food.base') };
  f.menu.viewConfig = { name: 'Other' };
  let presented = 0;
  const adapter = new NativeBaseNoteOpening({ app: f.app,
    settings: { nativeBaseCreateRoutes: [{ basePath: 'Inbox/Food.base', viewName: 'Food Log', recordKind: 'food-entry' }] },
    nativeRecordService: { createFresh: async () => assert.fail('wrong view') },
    noteOpeningService: { present: async () => { presented++; } },
  });
  adapter.attach({ newItemMenu: f.menu });
  await f.menu.open('One');
  assert.equal(f.writes.length, 2);
  assert.equal(presented, 1);
  adapter.dispose();
});

test('a failed open is acknowledged without authorizing a second caller opening', async () => {
  const f = fixture();
  f.plugin.settings.notePostCreateBehavior = 'open';
  f.plugin.openFileInLeaf = async () => { throw new Error('open failed'); };
  assert.equal(await f.service.present({ filePath: f.file.path, sourcePluginId: 'test' }), true);
  assert.equal(notices.at(-1).includes('could not open'), true);
});
test('open can focus the created file name after the existing navigation service resolves', async () => {
  const f = fixture();
  f.plugin.settings.notePostCreateBehavior = 'open';
  await f.service.present({ filePath: f.file.path, sourcePluginId: 'test', renameTitle: true });
  assert.deepEqual(f.renameStates, [{ rename: 'all' }]);
});

test('every created-note route awaits preparation and presents the final file', async () => {
  for (const behavior of ['open', 'stay', 'explicit-tab']) {
    const f = fixture();
    f.plugin.settings.notePostCreateBehavior = behavior === 'explicit-tab' ? 'stay' : behavior;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let prepared = false, settled = false;
    f.plugin.nativeRecordService.prepareCreatedNote = async file => {
      await gate;
      file.path = '_records/tasks/final.md';
      prepared = true;
    };
    const pending = f.service.present({ filePath: f.file.path, sourcePluginId: 'test',
      ...(behavior === 'explicit-tab' ? { explicitDestination: 'tab' } : {})
    }).then(result => { settled = true; return result; });
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(f.opened.length, 0);
    release();
    assert.equal(await pending, true);
    assert.equal(prepared, true);
    const presented = f.opened;
    assert.equal(presented.length, behavior === 'stay' ? 0 : 1);
    if (presented.length) assert.equal(presented[0][0].path, '_records/tasks/final.md');
  }
});

test('failed preparation preserves the created file without opening or permitting caller fallback', async () => {
  const f = fixture();
  f.plugin.nativeRecordService.prepareCreatedNote = async () => { throw new Error('write failed'); };
  assert.equal(await f.service.present({ filePath: f.file.path, sourcePluginId: 'test' }), true);
  assert.equal(f.opened.length, 0);
  assert.match(notices.at(-1), /task preparation failed/);
  assert.match(notices.at(-1), /Inbox\/New.md/);
});

test('ordinary note opening never prepares or mutates a created draft', async () => {
  const f = fixture();
  f.plugin.nativeRecordService.prepareCreatedNote = async () => { assert.fail('ordinary navigation must not prepare'); };
  assert.equal(await f.service.open(f.file), true);
  assert.equal(f.opened.length, 1);
});
