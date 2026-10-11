import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const handlerPath = fileURLToPath(new URL('../src/handlers/task-checkbox-handler.ts', import.meta.url));
const modulePromise = build({
  stdin: { contents: `export { TaskCheckboxHandler } from ${JSON.stringify(handlerPath)}; export * from 'obsidian';`, loader: 'ts', resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
  plugins: [{
    name: 'native-checkbox-obsidian-boundaries',
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'native-checkbox-test' }));
      builder.onLoad({ filter: /.*/u, namespace: 'native-checkbox-test' }, () => ({
        loader: 'js',
        contents: `
          export class App {}
          export class TFile { constructor(path) { this.path = path; this.extension = 'md'; this.basename = path.split('/').at(-1).replace(/\\.md$/u, ''); } }
          export class MarkdownView { constructor(file, mode) { this.file = file; this.mode = mode; } getMode() { return this.mode; } }
          class MenuItem {
            setTitle(value) { this.title = value; return this; }
            setChecked(value) { this.checked = value; return this; }
            setIcon(value) { this.icon = value; return this; }
            onClick(callback) { this.action = callback; return this; }
          }
          export class Menu {
            static opened = [];
            constructor() { this.items = []; }
            addItem(callback) { const item = new MenuItem(); callback(item); this.items.push(item); return this; }
            addSeparator() { this.items.push({ separator: true }); return this; }
            showAtPosition(position) { this.position = position; Menu.opened.push(this); }
          }
          export class Notice { static messages = []; constructor(message) { Notice.messages.push(message); } }
          export class Modal {
            static opened = [];
            constructor(app) { this.app = app; this.modalEl = { addClass() {} }; this.contentEl = { empty() {} }; }
            open() { Modal.opened.push(this); }
            close() {}
          }
          export class Setting {}
          export class TextComponent {}
        `,
      }));
    },
  }],
}).then(result => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`));

class FakeElement {
  constructor(classes = '', parent = null) {
    this.classes = new Set(classes.split(/\s+/u).filter(Boolean));
    this.parentElement = parent;
    this.attributes = new Map();
    this.isConnected = true;
  }
  matches(selector) { return selector.startsWith('.') && this.classes.has(selector.slice(1)); }
  closest(selector) {
    const selectors = selector.split(',').map(value => value.trim());
    for (let element = this; element; element = element.parentElement) {
      if (selectors.some(candidate => element.matches(candidate))) return element;
    }
    return null;
  }
  contains(target) {
    for (let element = target; element; element = element.parentElement) if (element === this) return true;
    return false;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
}

function eventFor(target, extra = {}) {
  const counts = { prevented: 0, stopped: 0, immediate: 0 };
  return {
    target, clientX: 17, clientY: 23, ...extra, counts,
    preventDefault() { counts.prevented += 1; },
    stopPropagation() { counts.stopped += 1; },
    stopImmediatePropagation() { counts.immediate += 1; },
  };
}

function fakeClock() {
  const oldWindow = globalThis.window;
  const oldElement = globalThis.HTMLElement;
  const originalNow = Date.now;
  const timers = new Map();
  let now = 100_000;
  let timerId = 0;
  globalThis.HTMLElement = FakeElement;
  globalThis.window = {
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  Date.now = () => now;
  return {
    timers,
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= now) { timers.delete(id); timer.callback(); }
      }
    },
    restore() { globalThis.window = oldWindow; globalThis.HTMLElement = oldElement; Date.now = originalNow; },
  };
}

async function fixture(options = {}) {
  const module = await modulePromise;
  const { TaskCheckboxHandler, TFile, MarkdownView, Menu, Notice, Modal } = module;
  Menu.opened.length = 0;
  Notice.messages.length = 0;
  Modal.opened.length = 0;
  const clock = fakeClock();
  const rawLine = options.rawLine ?? '- [ ] Keep [status:: todo] [scheduled:: 2099-01-01] ^stable-id  ';
  const initialSource = options.source ?? ['---', 'id: keep-me', 'status: todo', '---', '', rawLine, ''].join('\r\n');
  const lineNumber = options.lineNumber ?? 5;
  const counts = { cachedReads: 0, rawReads: 0, processes: 0, diskWrites: 0, editorReplacements: 0, sectionLookups: 0, cmLookups: 0, legacy: 0 };
  let diskSource = initialSource;
  let editorSource = options.editorSource ?? initialSource;
  const file = new TFile('Inbox/Native checkbox QA.md');
  const filesByPath = new Map([[file.path, file]]);
  let processedPath = null;
  const root = new FakeElement('markdown-preview-view');
  const lineHost = new FakeElement(options.mode === 'source' ? 'cm-line' : 'task-list-item', root);
  const checkbox = new FakeElement('task-list-item-checkbox', lineHost);
  checkbox.setAttribute('data-line', options.relativeLine ?? 0);
  const view = new MarkdownView(file, options.mode ?? 'preview');
  view.containerEl = root;
  view.contentEl = root;
  view.previewMode = {
    containerEl: root,
    renderer: {
      getSectionInfo(target) {
        counts.sectionLookups += 1;
        assert.equal(target, checkbox);
        return options.section === null ? null : options.section ?? { lineStart: lineNumber - Number(checkbox.getAttribute('data-line')), text: initialSource };
      },
    },
  };
  const editor = {
    getValue() { return editorSource; },
    cm: {
      posAtDOM(target, offset) { counts.cmLookups += 1; assert.equal(target, lineHost); assert.equal(offset, 0); return 101; },
      state: { doc: { lineAt(position) { assert.equal(position, 101); return { number: lineNumber + 1 }; } } },
    },
    replaceRange(value, from, to) {
      counts.editorReplacements += 1;
      assert.equal(from.line, lineNumber);
      assert.equal(to.line, lineNumber);
      assert.equal(to.ch, from.ch + 1);
      const lines = editorSource.split(/\r\n|\n|\r/u);
      const separators = [...editorSource.matchAll(/\r\n|\n|\r/gu)].map(match => match[0]);
      let start = 0;
      for (let index = 0; index < from.line; index += 1) start += lines[index].length + separators[index].length;
      editorSource = editorSource.slice(0, start + from.ch) + value + editorSource.slice(start + to.ch);
    },
  };
  view.editor = editor;
  const leaves = [{ view }];
  const legacyBoundary = () => { counts.legacy += 1; throw new Error('Retired checklist ownership must not run'); };
  const blockedService = new Proxy({}, { get: () => legacyBoundary });
  const plugin = {
    settings: { dataArchitectureMode: 'native-records', checkboxMenuStates: options.menuStates },
    app: {
      workspace: { getLeavesOfType(type) { assert.equal(type, 'markdown'); return leaves; } },
      vault: {
        getAbstractFileByPath(path) { return filesByPath.get(path) ?? null; },
        async cachedRead(target) { assert.equal(target, file); counts.cachedReads += 1; if (options.beforeCachedRead) await options.beforeCachedRead(); return diskSource; },
        async read() { counts.rawReads += 1; throw new Error('Native menu must not use fresh read'); },
        async process(target, updater) {
          assert.equal(target, file);
          counts.processes += 1;
          // Core captures the path before entering its serialized adapter queue.
          processedPath = target.path;
          if (options.beforeProcess) diskSource = options.beforeProcess(diskSource);
          const next = updater(diskSource);
          if (next !== diskSource) { diskSource = next; counts.diskWrites += 1; }
        },
      },
    },
    itemHistoryService: blockedService,
    taskRecurrenceService: blockedService,
    taskLineContextMenuService: blockedService,
    subitemRelationshipSyncService: blockedService,
    frontmatterMutationService: blockedService,
    sharedServices: { status: blockedService },
  };
  const handler = new TaskCheckboxHandler(plugin);
  return {
    handler, plugin, file, view, leaves, root, lineHost, checkbox, editor, rawLine, lineNumber, initialSource, counts, clock, Menu, Notice, Modal, MarkdownView, TFile,
    source: () => diskSource,
    editorSource: () => editorSource,
    setSource(value) { diskSource = value; },
    setEditorSource(value) { editorSource = value; },
    setFileRegistration(path, currentFile) { if (currentFile) filesByPath.set(path, currentFile); else filesByPath.delete(path); },
    processedPath: () => processedPath,
    menu() { return Menu.opened.at(-1); },
    openMenu() { const event = eventFor(checkbox); assert.equal(handler.handleContextMenu(event), true); return event; },
    async choose(token) {
      const item = Menu.opened.at(-1)?.items.find(candidate => candidate.title === token);
      assert.ok(item?.action, `Missing menu choice ${token}`);
      item.action();
      await new Promise(resolve => setImmediate(resolve));
    },
    close() { handler.dispose(); clock.restore(); },
  };
}

test('Reading right-click follows core section-relative positions and performs one guarded marker write', async () => {
  const f = await fixture({ relativeLine: 2 });
  try {
    const event = f.openMenu();
    assert.deepEqual(event.counts, { prevented: 1, stopped: 1, immediate: 1 });
    assert.deepEqual(f.menu().position, { x: 17, y: 23 });
    await f.choose('[/]');
    assert.equal(f.source(), f.initialSource.replace(f.rawLine, f.rawLine.replace('[ ]', '[/]')));
    assert.equal(f.counts.sectionLookups, 1);
    assert.equal(f.counts.cachedReads, 1);
    assert.equal(f.counts.processes, 1);
    assert.equal(f.counts.diskWrites, 1);
    assert.equal(f.counts.rawReads, 0);
    assert.equal(f.counts.editorReplacements, 0);
    assert.equal(f.counts.legacy, 0);
  } finally { f.close(); }
});

test('the menu respects configured order, indicates the selected marker, and retains custom entry', async () => {
  const f = await fixture({ menuStates: ['[!]', '[?]', '[ ]', '[!]', '[invalid]'] });
  try {
    f.openMenu();
    assert.deepEqual(f.menu().items.filter(item => !item.separator).map(item => item.title), ['[!]', '[?]', '[ ]', 'Custom checkbox value…']);
    assert.equal(f.menu().items.find(item => item.title === '[ ]').checked, true);
    assert.equal(f.menu().items.find(item => item.title === '[!]').checked, false);
    assert.equal(f.counts.cachedReads + f.counts.processes + f.counts.legacy, 0);
  } finally { f.close(); }
});

test('custom markers invoke the real submit callback without requiring a whole-note status mapping', async () => {
  const f = await fixture({ menuStates: [] });
  try {
    f.openMenu();
    const custom = f.menu().items.find(item => item.title === 'Custom checkbox value…');
    custom.action();
    const modal = f.Modal.opened.at(-1);
    assert.equal(modal.label, 'Checkbox value');
    assert.equal(modal.initialValue, '[ ]');
    await modal.onSubmit('!');
    assert.equal(f.source(), f.initialSource.replace(f.rawLine, f.rawLine.replace('[ ]', '[!]')));
    assert.equal(f.counts.legacy, 0);
    assert.equal(f.counts.processes, 1);
  } finally { f.close(); }
});

test('Live Preview changes only the marker through native replaceRange and preserves unsaved content', async () => {
  const rawLine = '  - [ ]\t Keep [status:: todo] ^native-block  ';
  const source = ['\uFEFF---', 'id: unchanged', '---', '', rawLine, 'Disk paragraph'].join('\r\n');
  const editorSource = source.replace('Disk paragraph', 'Unsaved paragraph with changes');
  const f = await fixture({ mode: 'source', source, rawLine, lineNumber: 4, editorSource });
  try {
    f.openMenu();
    await f.choose('[?]');
    assert.equal(f.editorSource(), editorSource.replace(rawLine, rawLine.replace('[ ]', '[?]')));
    assert.equal(f.source(), source);
    assert.equal(f.counts.cmLookups, 1);
    assert.equal(f.counts.editorReplacements, 1);
    assert.equal(f.counts.cachedReads + f.counts.rawReads + f.counts.processes + f.counts.legacy, 0);
  } finally { f.close(); }
});

test('a Reading menu respects an existing unsaved editor for the same note', async () => {
  const f = await fixture();
  try {
    const editorView = new f.MarkdownView(f.file, 'source');
    editorView.editor = f.editor;
    f.leaves.push({ view: editorView });
    f.setEditorSource(f.initialSource + 'Unsaved addition\r\n');
    f.openMenu();
    await f.choose('[!]');
    assert.equal(f.editorSource(), (f.initialSource + 'Unsaved addition\r\n').replace(f.rawLine, f.rawLine.replace('[ ]', '[!]')));
    assert.equal(f.source(), f.initialSource);
    assert.equal(f.counts.editorReplacements, 1);
    assert.equal(f.counts.cachedReads + f.counts.processes, 0);
  } finally { f.close(); }
});

test('the originating source editor owns the change ahead of an earlier duplicate source leaf', async () => {
  const f = await fixture({ mode: 'source' });
  try {
    const earlierView = new f.MarkdownView(f.file, 'source');
    let earlierEdits = 0;
    earlierView.containerEl = new FakeElement('unrelated-editor-root');
    earlierView.contentEl = earlierView.containerEl;
    earlierView.editor = {
      getValue: () => f.initialSource,
      replaceRange() { earlierEdits += 1; },
    };
    f.leaves.unshift({ view: earlierView });
    f.openMenu();
    await f.choose('[!]');
    assert.equal(earlierEdits, 0);
    assert.equal(f.counts.editorReplacements, 1);
    assert.equal(f.editorSource(), f.initialSource.replace(f.rawLine, f.rawLine.replace('[ ]', '[!]')));
    assert.equal(f.counts.cachedReads + f.counts.processes + f.counts.diskWrites + f.counts.legacy, 0);
  } finally { f.close(); }
});

test('stale Reading preflight refuses the action before the serialized queue', async () => {
  const f = await fixture();
  try {
    f.openMenu();
    f.setSource(f.initialSource.replace('Keep', 'Newer text'));
    await f.choose('[!]');
    assert.equal(f.source(), f.initialSource.replace('Keep', 'Newer text'));
    assert.equal(f.counts.cachedReads, 1);
    assert.equal(f.counts.processes, 0);
    assert.equal(f.counts.diskWrites, 0);
    assert.ok(f.Notice.messages.some(message => message.includes('checkbox changed')));
  } finally { f.close(); }
});

test('a newer edit at atomic process time wins over the earlier Reading preflight', async () => {
  const f = await fixture({ beforeProcess: source => source.replace('Keep', 'Concurrent edit') });
  try {
    f.openMenu();
    await f.choose('[!]');
    assert.equal(f.source(), f.initialSource.replace('Keep', 'Concurrent edit'));
    assert.equal(f.counts.cachedReads, 1);
    assert.equal(f.counts.processes, 1);
    assert.equal(f.counts.diskWrites, 0);
    assert.equal(f.counts.legacy, 0);
  } finally { f.close(); }
});

test('delete and same-path recreation during cachedRead cannot redirect a stale menu action', async () => {
  let f;
  f = await fixture({
    beforeCachedRead() { f.setFileRegistration(f.file.path, new f.TFile(f.file.path)); },
  });
  try {
    f.openMenu();
    await f.choose('[!]');
    assert.equal(f.counts.cachedReads, 1);
    assert.equal(f.counts.processes, 0);
    assert.equal(f.counts.diskWrites, 0);
    assert.equal(f.source(), f.initialSource);
  } finally { f.close(); }
});

test('same-path recreation after entering process preserves the replacement note', async () => {
  let f;
  f = await fixture({
    beforeProcess(source) {
      f.setFileRegistration(f.file.path, new f.TFile(f.file.path));
      return source;
    },
  });
  try {
    f.openMenu();
    await f.choose('[?]');
    assert.equal(f.counts.cachedReads, 1);
    assert.equal(f.counts.processes, 1);
    assert.equal(f.counts.diskWrites, 0);
    assert.equal(f.source(), f.initialSource);
    assert.equal(f.counts.legacy, 0);
  } finally { f.close(); }
});

test('a queued rename refuses the captured old path with or without a replacement file', async () => {
  for (const replacement of [false, true]) {
    let f;
    const oldPath = 'Inbox/Native checkbox QA.md';
    f = await fixture({
      beforeProcess(source) {
        f.file.path = 'Inbox/Renamed checkbox QA.md';
        f.setFileRegistration(f.file.path, f.file);
        f.setFileRegistration(oldPath, replacement ? new f.TFile(oldPath) : null);
        return source;
      },
    });
    try {
      f.openMenu();
      await f.choose('[/]');
      assert.equal(f.processedPath(), oldPath);
      assert.equal(f.counts.cachedReads, 1);
      assert.equal(f.counts.processes, 1);
      assert.equal(f.counts.diskWrites, 0, `replacement=${replacement}`);
      assert.equal(f.source(), f.initialSource, `replacement=${replacement}`);
    } finally { f.close(); }
  }
});

test('100 selections of the existing marker incur no reads, processes, or replacements', async () => {
  const f = await fixture();
  try {
    f.openMenu();
    const selected = f.menu().items.find(item => item.title === '[ ]');
    for (let index = 0; index < 100; index += 1) selected.action();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.source(), f.initialSource);
    assert.equal(f.counts.cachedReads + f.counts.rawReads + f.counts.processes + f.counts.editorReplacements + f.counts.legacy, 0);
  } finally { f.close(); }
});

test('ordinary clicks remain owned by Obsidian and do not read or write', async () => {
  const f = await fixture();
  try {
    const event = eventFor(f.checkbox);
    assert.equal(f.handler.handleClick(event), false);
    assert.deepEqual(event.counts, { prevented: 0, stopped: 0, immediate: 0 });
    assert.equal(f.Menu.opened.length, 0);
    assert.equal(f.counts.cachedReads + f.counts.processes, 0);
  } finally { f.close(); }
});

test('550ms long press opens once, consumes duplicate context menus, and suppresses the release click', async () => {
  const f = await fixture();
  try {
    const touch = eventFor(f.checkbox, { touches: [{ clientX: 40, clientY: 60 }] });
    assert.equal(f.handler.handleTouchStart(touch), true);
    assert.equal(touch.counts.prevented, 0);
    f.clock.advance(549);
    assert.equal(f.Menu.opened.length, 0);
    f.clock.advance(1);
    assert.equal(f.Menu.opened.length, 1);
    assert.deepEqual(f.menu().position, { x: 40, y: 60 });
    const duplicate = eventFor(f.checkbox);
    assert.equal(f.handler.handleContextMenu(duplicate), true);
    assert.equal(f.Menu.opened.length, 1);
    assert.equal(duplicate.counts.prevented, 1);
    f.handler.handleTouchCancel();
    const releaseClick = eventFor(f.checkbox);
    assert.equal(f.handler.handleClick(releaseClick), true);
    assert.equal(releaseClick.counts.prevented, 1);
    assert.equal(f.handler.handleClick(eventFor(f.checkbox)), false);
    assert.equal(f.counts.cachedReads + f.counts.processes, 0);
  } finally { f.close(); }
});

test('touch move, end, or cancellation before the hold threshold cancels the pending menu', async () => {
  for (const route of ['touchmove', 'touchend', 'touchcancel']) {
    const f = await fixture();
    try {
      assert.equal(f.handler.handleTouchStart(eventFor(f.checkbox, { touches: [{ clientX: 1, clientY: 2 }] })), true, route);
      f.clock.advance(200);
      // All three registered routes invoke this same cancellation owner.
      f.handler.handleTouchCancel();
      f.clock.advance(1000);
      assert.equal(f.Menu.opened.length, 0, route);
      assert.equal(f.clock.timers.size, 0, route);
      assert.equal(f.handler.handleClick(eventFor(f.checkbox)), false, route);
    } finally { f.close(); }
  }
});

test('suppression lasts for a long held finger and starts its expiry only after touch end', async () => {
  const f = await fixture();
  try {
    f.handler.handleTouchStart(eventFor(f.checkbox, { touches: [{ clientX: 0, clientY: 0 }] }));
    f.clock.advance(550);
    f.clock.advance(4000);
    assert.equal(f.handler.handleContextMenu(eventFor(f.checkbox)), true);
    assert.equal(f.Menu.opened.length, 1);
    f.handler.handleTouchCancel();
    f.clock.advance(1499);
    assert.equal(f.handler.handleClick(eventFor(f.checkbox)), true);
    assert.equal(f.Menu.opened.length, 1);
  } finally { f.close(); }
});

test('a second finger cannot clear long-press suppression or start expiry while the first remains held', async () => {
  const f = await fixture();
  try {
    const firstTouch = { clientX: 2, clientY: 3 };
    const secondTouch = { clientX: 5, clientY: 6 };
    assert.equal(f.handler.handleTouchStart(eventFor(f.checkbox, { touches: [firstTouch] })), true);
    f.clock.advance(550);
    assert.equal(f.Menu.opened.length, 1);
    assert.equal(f.handler.handleTouchStart(eventFor(f.checkbox, { touches: [firstTouch, secondTouch] })), false);
    f.handler.handleTouchCancel(eventFor(f.checkbox, { touches: [firstTouch] }));
    f.clock.advance(4000);
    assert.equal(f.handler.handleContextMenu(eventFor(f.checkbox)), true);
    assert.equal(f.Menu.opened.length, 1);
    f.handler.handleTouchCancel(eventFor(f.checkbox, { touches: [] }));
    f.clock.advance(1499);
    const release = eventFor(f.checkbox);
    assert.equal(f.handler.handleClick(release), true);
    assert.equal(release.counts.prevented, 1);
    assert.equal(f.counts.cachedReads + f.counts.processes, 0);
  } finally { f.close(); }
});

test('moving after the menu opens preserves suppression until the final touch ends', async () => {
  const f = await fixture();
  try {
    const touch = { clientX: 9, clientY: 11 };
    f.handler.handleTouchStart(eventFor(f.checkbox, { touches: [touch] }));
    f.clock.advance(550);
    // The registered touchmove route cancels a pending hold, but a held finger
    // must not start the release-click expiry of an already-open marker menu.
    f.handler.handleTouchCancel(eventFor(f.checkbox, { touches: [touch] }));
    f.clock.advance(4000);
    assert.equal(f.handler.handleContextMenu(eventFor(f.checkbox)), true);
    assert.equal(f.Menu.opened.length, 1);
    f.handler.handleTouchCancel(eventFor(f.checkbox, { touches: [] }));
    assert.equal(f.handler.handleClick(eventFor(f.checkbox)), true);
    assert.equal(f.handler.handleClick(eventFor(f.checkbox)), false);
    assert.equal(f.counts.cachedReads + f.counts.processes, 0);
  } finally { f.close(); }
});

test('expired release suppression does not consume a later deliberate click', async () => {
  const f = await fixture();
  try {
    f.handler.handleTouchStart(eventFor(f.checkbox, { touches: [{ clientX: 0, clientY: 0 }] }));
    f.clock.advance(550);
    f.handler.handleTouchCancel();
    f.clock.advance(1501);
    const later = eventFor(f.checkbox);
    assert.equal(f.handler.handleClick(later), false);
    assert.equal(later.counts.prevented, 0);
  } finally { f.close(); }
});

test('a platform context menu arriving before the hold timer cancels that timer and opens once', async () => {
  const f = await fixture();
  try {
    f.handler.handleTouchStart(eventFor(f.checkbox, { touches: [{ clientX: 3, clientY: 4 }] }));
    f.clock.advance(200);
    f.openMenu();
    f.clock.advance(1000);
    assert.equal(f.Menu.opened.length, 1);
    f.handler.handleTouchCancel();
    assert.equal(f.handler.handleClick(eventFor(f.checkbox)), true);
  } finally { f.close(); }
});

test('dispose invalidates both pending hold callbacks and already-open menu actions', async () => {
  const f = await fixture();
  try {
    f.openMenu();
    f.handler.handleTouchStart(eventFor(f.checkbox, { touches: [{ clientX: 0, clientY: 0 }] }));
    assert.equal(f.clock.timers.size, 1);
    f.handler.dispose();
    f.clock.advance(1000);
    await f.choose('[!]');
    assert.equal(f.Menu.opened.length, 1);
    assert.equal(f.clock.timers.size, 0);
    assert.equal(f.handler.handleContextMenu(eventFor(f.checkbox)), false);
    assert.equal(f.counts.cachedReads + f.counts.processes + f.counts.editorReplacements + f.counts.legacy, 0);
    assert.equal(f.source(), f.initialSource);
  } finally { f.close(); }
});

test('an old custom-menu action cannot open a modal after the handler is disposed', async () => {
  const f = await fixture();
  try {
    f.openMenu();
    const customAction = f.menu().items.find(item => item.title === 'Custom checkbox value…').action;
    f.handler.dispose();
    customAction();
    assert.equal(f.Modal.opened.length, 0);
    assert.equal(f.counts.cachedReads + f.counts.processes + f.counts.editorReplacements + f.counts.legacy, 0);
  } finally { f.close(); }
});

test('embedded checkboxes, property inputs, foreign surfaces, and text are not claimed', async () => {
  const f = await fixture();
  try {
    for (const excluded of ['markdown-embed', 'internal-embed', 'cm-embed-block', 'canvas-node-content', 'tps-gcm-linked-subitem-task', 'tps-gcm-linked-subitem-checkbox', 'tps-gcm-checklist-toggle']) {
      f.lineHost.classes.add(excluded);
      const event = eventFor(f.checkbox);
      assert.equal(f.handler.handleContextMenu(event), false, excluded);
      assert.equal(event.counts.prevented, 0, excluded);
      f.lineHost.classes.delete(excluded);
    }
    for (const target of [new FakeElement('metadata-property-value', f.root), new FakeElement('task-list-item-checkbox'), f.lineHost, null]) {
      assert.equal(f.handler.handleContextMenu(eventFor(target)), false);
    }
    assert.equal(f.Menu.opened.length, 0);
    assert.equal(f.counts.cachedReads + f.counts.processes, 0);
  } finally { f.close(); }
});

test('unresolvable section metadata and protected source blocks never open a checkbox menu', async () => {
  for (const options of [
    { section: null },
    { relativeLine: '-1' },
    { relativeLine: '1.5' },
    { source: '```\n- [ ] Example\n```', lineNumber: 1 },
    { source: '---\n- [ ] Example\n---', lineNumber: 1 },
  ]) {
    const f = await fixture(options);
    try {
      const event = eventFor(f.checkbox);
      assert.equal(f.handler.handleContextMenu(event), false, JSON.stringify(options));
      assert.equal(event.counts.prevented, 0);
      assert.equal(f.Menu.opened.length, 0);
      assert.equal(f.counts.cachedReads + f.counts.processes, 0);
    } finally { f.close(); }
  }
});
