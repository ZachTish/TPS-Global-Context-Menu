import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

class TFile { constructor(path = 'Inbox/New.md') { this.path = path; this.extension = 'md'; } }
const Platform = { isMobile: false };
const notices = [];
const logger = { flow() {}, flowError() {}, warn() {} };
function load(path, extra = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', code)(id => {
    if (id === 'obsidian') return { TFile, Platform, Notice: class { constructor(message) { notices.push(message); } }, QueryController: class {} };
    if (id === '../logger') return logger;
    if (id === 'monkey-around') return extra;
    throw new Error(id);
  }, module, module.exports);
  return module.exports;
}
const { NoteOpeningService, migrateNoteOpeningSettings } = load('../src/services/note-opening-service.ts');
const { runNativeCreateWithoutOpening, supportsNativeCreateBoundary, NativeBaseNoteOpening } = load('../src/services/native-base-note-opening.ts', {
  around(prototype, wrappers) {
    const old = {};
    for (const key of Object.keys(wrappers)) { old[key] = prototype[key]; prototype[key] = wrappers[key](old[key]); }
    return () => Object.assign(prototype, old);
  }
});
function fixture() {
  const file = new TFile();
  const opened = [], previews = [];
  const leaf = { view: { containerEl: { isConnected: true } } };
  const plugin = {
    settings: { notePostCreateBehavior: 'preview', noteOpenDestination: 'current-tab' },
    app: { vault: { getAbstractFileByPath: path => path === file.path ? file : null }, workspace: { activeLeaf: leaf, getLeaf: context => ({ context }) } },
    openFileInLeaf: async (...args) => { opened.push(args); return true; },
    persistentMenuManager: { showBaseLinkEditablePreview: async (...args) => { previews.push(args); return true; } }
  };
  return { plugin, file, opened, previews, service: new NoteOpeningService(plugin) };
}
test('desktop and phone preview keep the current leaf and focus the new note name', async () => {
  for (const mobile of [false, true]) {
    Platform.isMobile = mobile;
    const f = fixture();
    assert.equal(await f.service.present({ filePath: f.file.path, sourcePluginId: 'test', renameTitle: true }), true);
    assert.equal(f.opened.length, 0);
    assert.equal(f.previews[0][2].focusTitle, true);
    assert.equal(f.previews[0][2].focusEditor, false);
    f.plugin.settings.noteOpenDestination = 'new-tab';
    await f.previews[0][2].openNote();
    assert.equal(f.opened[0][1], 'tab');
  }
});
test('stay is silent, open follows destination, explicit new tab overrides stay', async () => {
  const f = fixture(); const request = { filePath: f.file.path, sourcePluginId: 'test' };
  f.plugin.settings.notePostCreateBehavior = 'stay';
  assert.equal(await f.service.present(request), true);
  assert.equal(f.opened.length + f.previews.length, 0);
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
  app.vault.adapter.read = async () => '{bad';
  assert.deepEqual(await migrateNoteOpeningSettings(app, {}), { notePostCreateBehavior: 'preview', noteOpenDestination: 'current-tab' });
});
function nativeFixture() {
  const writes = [], openings = [];
  const file = new TFile();
  const app = { fileManager: {
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

test('a failed open is acknowledged without authorizing a second caller opening', async () => {
  const f = fixture();
  f.plugin.settings.notePostCreateBehavior = 'open';
  f.plugin.openFileInLeaf = async () => { throw new Error('open failed'); };
  assert.equal(await f.service.present({ filePath: f.file.path, sourcePluginId: 'test' }), true);
  assert.equal(notices.at(-1).includes('could not open'), true);
});
test('open can focus the created file name after the existing navigation service resolves', async () => {
  const f = fixture(); const states = [];
  f.plugin.settings.notePostCreateBehavior = 'open';
  f.plugin.findOpenLeafForFile = () => ({ view: { setEphemeralState: state => states.push(state) } });
  await f.service.present({ filePath: f.file.path, sourcePluginId: 'test', renameTitle: true });
  assert.deepEqual(states, [{ rename: 'all' }]);
});
