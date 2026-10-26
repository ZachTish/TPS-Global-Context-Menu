import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

class TFile { constructor(path) { this.path = path; } }
function load(path) {
  const source = readFileSync(path, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', code)(id => {
    if (id === 'obsidian') return { TFile };
    if (id === '../logger') return { flow() {} };
    throw Error(id);
  }, module, module.exports);
  return module.exports;
}
const { runNativeBaseRowMenu, bindNativeBaseRowMenu } = load('src/services/native-base-row-menu.ts');
const { ContextTargetService } = load('src/services/context-target-service.ts');
function fixture() {
  const files = [new TFile('Food A.md'), new TFile('Food B.md')];
  const map = new Map(files.map(f => [f.path, f]));
  const target = {}, cell = {}, menus = [];
  let lookups = 0;
  const view = {
    app: { vault: { getFileByPath: path => { lookups++; return map.get(path); } } },
    containerEl: { contains: el => el === target },
    getCellFromDom: el => el === target ? cell : null,
    getCellIndex: c => c === cell ? { groupIdx: 0, row: 1, column: 0 } : null,
    data: { groupedData: [{ entries: files.map(file => ({ file })) }], properties: ['formula.displayname', 'note.quantity'] },
  };
  const event = { defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  function coreMenu() {
    if (!this.selection) return;
    const { groupIdx, top, bottom } = this.selection;
    menus.push(this.data.groupedData[groupIdx].entries.slice(top, bottom + 1).map(e => e.file));
    event.preventDefault();
  }
  return { files, map, target, cell, menus, view, event, coreMenu, lookups: () => lookups };
}
test('an unselected touch/context press opens the exact row through the original native menu', () => {
  const f = fixture();
  f.coreMenu.call(f.view);
  assert.deepEqual(f.menus, [], 'reproduces the native prerequisite that allowed the parent embed menu');
  runNativeBaseRowMenu(f.view, f.coreMenu, f.event, f.target);
  assert.deepEqual(f.menus, [[f.files[1]]]);
  assert.equal(f.event.stopped, true);
});
test('a press inside a multi-row selection preserves precisely that selection', () => {
  const f = fixture();
  f.view.selection = { groupIdx: 0, top: 0, bottom: 1, start: 0, end: 1 };
  const before = f.view.selection;
  runNativeBaseRowMenu(f.view, f.coreMenu, f.event, f.target);
  assert.equal(f.view.selection, before);
  assert.deepEqual(f.menus, [f.files]);
});
test('a press outside the selection discards the unrelated selection', () => {
  const f = fixture();
  f.view.selection = { groupIdx: 0, top: 0, bottom: 0, start: 0, end: 1 };
  runNativeBaseRowMenu(f.view, f.coreMenu, f.event, f.target);
  assert.deepEqual(f.menus, [[f.files[1]]]);
});
test('sort/group changes use the current native row identity rather than DOM position or text', () => {
  const f = fixture();
  f.view.data.groupedData = [{ entries: [] }, { entries: [{ file: f.files[0] }] }];
  f.view.getCellIndex = () => ({ groupIdx: 1, row: 0, column: 1 });
  runNativeBaseRowMenu(f.view, f.coreMenu, f.event, f.target);
  assert.deepEqual(f.menus, [[f.files[0]]]);
});
test('unresolved, detached, deleted and replaced rows block the parent menu', () => {
  for (const change of [f => f.view.getCellFromDom = () => null, f => f.view.getCellIndex = () => null,
    f => f.view.containerEl.contains = () => false, f => f.map.delete(f.files[1].path),
    f => f.map.set(f.files[1].path, new TFile(f.files[1].path)),
    f => f.view.getCellIndex = () => ({ groupIdx: 0, row: 99, column: 0 })]) {
    const f = fixture(); change(f);
    runNativeBaseRowMenu(f.view, f.coreMenu, f.event, f.target);
    assert.equal(f.event.stopped, true);
    assert.deepEqual(f.menus, []);
  }
});
test('a stale member of a bulk selection fails closed without retargeting', () => {
  const f = fixture();
  f.view.selection = { groupIdx: 0, top: 0, bottom: 1, start: 0, end: 0 };
  f.map.delete(f.files[0].path);
  runNativeBaseRowMenu(f.view, f.coreMenu, f.event, f.target);
  assert.deepEqual(f.menus, []);
  assert.equal(f.event.stopped, true);
});
test('already handled editor/link events are left alone; incompatible native handlers cannot bubble', () => {
  const f = fixture(); f.event.defaultPrevented = true;
  runNativeBaseRowMenu(f.view, f.coreMenu, f.event, f.target);
  assert.deepEqual(f.menus, []); assert.equal(f.lookups(), 0);
  f.event.defaultPrevented = false;
  runNativeBaseRowMenu(f.view, () => {}, f.event, f.target);
  assert.equal(f.event.stopped, true);
});
test('repeated menu operations do only bounded current-file identity lookups', () => {
  const f = fixture();
  for (let i = 0; i < 1000; i++) {
    f.event.defaultPrevented = false;
    runNativeBaseRowMenu(f.view, f.coreMenu, f.event, f.target);
  }
  assert.equal(f.menus.length, 1000);
  assert.ok(f.lookups() <= 2000);
});
test('generic GCM table resolution never falls back to the enclosing Base, Canvas, or active note', () => {
  const previous = globalThis.HTMLElement;
  class Element { closest(selector) { return selector === '.bases-view[data-view-type="table"]' ? this : null; } }
  globalThis.HTMLElement = Element;
  try {
    const service = new ContextTargetService({ app: new Proxy({}, { get() { throw Error('No ambient file, vault scan or selection lookup'); } }) });
    service.isNotebookNavigatorContextTarget = () => false;
    service.resolveKanbanTarget = () => null;
    service.resolveLogicalPropertyFiles = files => files;
    service.summarizeFiles = files => files.map(f => f.path);
    const target = new Element(), file = new TFile('Row.md');
    assert.equal(service.isManualContextInterceptTarget(target), false);
    assert.deepEqual(service.resolveTargets([], { target }), []);
    assert.deepEqual(service.resolveTargets([file], { target }), [file]);
  } finally { globalThis.HTMLElement = previous; }
});

test('parent capture handles constructor-bound tables and unload removes the boundary', () => {
  const previous = globalThis.Element;
  try {
    const f = fixture();
    let listener, removed = 0, disposed = 0, registered;
    const boundary = {
      addEventListener(type, fn, capture) { assert.equal(type, 'contextmenu'); assert.equal(capture, true); listener = fn; },
      removeEventListener(type, fn, capture) { assert.equal(fn, listener); assert.equal(capture, true); removed++; },
    };
    f.view.containerEl.parentElement = boundary;
    f.view.register = fn => registered = fn;
    f.view.onTableCellContextmenu = f.coreMenu;
    // Core has already captured this function in its constructor.
    const boundCore = f.view.onTableCellContextmenu.bind(f.view);
    class Element { closest(selector) { return selector === '.bases-td' ? f.target : null; } }
    globalThis.Element = Element;
    f.target.closest = () => f.view.containerEl;
    f.event.target = new Element();
    const cleanup = bindNativeBaseRowMenu(f.view, () => disposed++);
    listener(f.event);
    if (!f.event.stopped) boundCore(f.event, f.target);
    assert.deepEqual(f.menus, [[f.files[1]]], 'one row menu, no constructor-bound duplicate');
    registered(); cleanup();
    assert.equal(removed, 1); assert.equal(disposed, 1);
  } finally { globalThis.Element = previous; }
});
