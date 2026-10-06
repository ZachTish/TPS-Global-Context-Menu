import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const suggestSource = readFileSync(new URL('../src/services/heading-link-suggest.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const fileNamingSource = readFileSync(new URL('../src/services/file-naming-service.ts', import.meta.url), 'utf8');

const suggestAst = ts.createSourceFile('heading-link-suggest.ts', suggestSource, ts.ScriptTarget.Latest, true);
const suggestClass = suggestAst.statements.find((node) => ts.isClassDeclaration(node));
const suggestCode = ts.transpileModule(
  `${suggestClass.getText(suggestAst).replace('export class', 'class')}\nHeadingLinkSuggest;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

function createSuggestHarness({ noteCount = 3 } = {}) {
  const handlers = new Map();
  const workspaceHandlers = new Map();
  const timers = [];
  const counts = { inventories: 0, metadata: 0 };
  const edits = [];
  const cursors = [];
  class Node {
    parentElement = null;
  }
  class Element extends Node {
    children = [];
    style = {};
    listeners = new Map();
    classList = { toggle() {} };
    constructor(cls = '') {
      super();
      this.cls = cls;
    }
    contains(node) {
      return node === this || this.children.some((child) => child.contains(node));
    }
    closest(selector) {
      if (selector.split(',').some((part) => this.cls.split(' ').includes(part.trim().slice(1)))) return this;
      return this.parentElement?.closest(selector) ?? null;
    }
    createDiv({ cls = '', text = '' } = {}) {
      const child = new Element(cls);
      child.text = text;
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    empty() { this.children = []; }
    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      }
    }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    getBoundingClientRect() { return { left: 0, top: 0 }; }
  }
  class Component {
    registeredEvents = [];
    registerDomEvent(_target, name, callback) { handlers.set(name, callback); }
    registerEvent(ref) { this.registeredEvents.push(ref); }
    unload() {
      this.onunload();
      handlers.clear();
      for (const ref of this.registeredEvents) workspaceHandlers.delete(ref.name);
    }
  }
  const document = { body: new Element('body'), activeElement: null };
  const Suggest = vm.runInNewContext(suggestCode, {
    Component, Node, Element, MarkdownView: class {}, TFile: class {}, document,
    window: { setTimeout: (callback) => timers.push(callback) },
  });
  const contentEl = document.body.createDiv({ cls: 'markdown-view' });
  const editorRoot = contentEl.createDiv({ cls: 'cm-editor' });
  const editorContent = editorRoot.createDiv({ cls: 'cm-content' });
  const editorLine = editorContent.createDiv({ cls: 'cm-line' });
  const file = { path: 'Active.md', basename: 'Active', extension: 'md' };
  const state = { focused: true, mode: 'source', line: '# Heading', cursor: null, view: null };
  const editor = {
    hasFocus: () => state.focused,
    getCursor: () => state.cursor ?? ({ line: 0, ch: state.line.length }),
    getLine: () => state.line,
    replaceRange: (text, from, to) => edits.push({ text, from, to }),
    setCursor: (cursor) => cursors.push(cursor),
  };
  const view = { file, editor, contentEl, getMode: () => state.mode };
  state.view = view;
  document.activeElement = editorContent;
  const files = Array.from({ length: noteCount }, (_, index) => ({
    path: `Fixture/Heading ${index}.md`, basename: `Heading ${index}`, extension: 'md',
  }));
  const plugin = {
    app: {
      workspace: {
        getActiveViewOfType: () => state.view,
        on: (name, callback) => { workspaceHandlers.set(name, callback); return { name }; },
      },
      vault: { getMarkdownFiles: () => { counts.inventories++; return files; } },
      metadataCache: { getFileCache: () => { counts.metadata++; return {}; } },
      fileManager: { generateMarkdownLink: (target, _source, _subpath, display) => `[${display}](${target.path})` },
    },
    filePropertiesService: { isCompanionFile: () => false },
  };
  const suggest = new Suggest(plugin);
  suggest.onload();
  function event(target = editorContent, key = 'x', options = {}) {
    return { ...options, target, key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  }
  function dispatch(name, target = editorContent, key = 'x', options = {}) {
    const dispatched = event(target, key, options);
    handlers.get(name)?.(dispatched);
    return dispatched;
  }
  function editorChange(changedEditor = editor, info = view) {
    workspaceHandlers.get('editor-change')?.(changedEditor, info);
  }
  function editHeading(line = state.line) {
    dispatch('input');
    state.line = line;
    editorChange();
  }
  return {
    suggest, state, view, counts, edits, cursors, document, editorContent, editorLine, event, dispatch,
    editorChange, editHeading,
    unrelatedInput: (cls) => document.body.createDiv({ cls }),
    flushTimers() { for (const callback of timers.splice(0)) callback(); },
    get popover() { return document.body.children.find((child) => child.cls === 'tps-gcm-heading-link-suggest'); },
  };
}

for (const surface of ['sidebar-search', 'modal-input', 'global-search']) {
  test(`unrelated ${surface} input does no vault work with a retained heading cursor`, () => {
    const harness = createSuggestHarness({ noteCount: 4000 });
    const input = harness.unrelatedInput(surface);
    harness.state.focused = false;
    harness.document.activeElement = input;
    harness.dispatch('keydown', input);
    harness.dispatch('input', input);
    harness.dispatch('keyup', input);
    harness.flushTimers();
    assert.deepEqual(harness.counts, { inventories: 0, metadata: 0 });
    assert.equal(harness.popover, undefined);
  });
}

test('an event outside the focused editor does no vault work even with stale focus state', () => {
  const harness = createSuggestHarness();
  const otherEditor = harness.unrelatedInput('cm-content');
  harness.dispatch('input', otherEditor);
  harness.dispatch('keyup', otherEditor);
  assert.deepEqual(harness.counts, { inventories: 0, metadata: 0 });
});

for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']) {
  test(`a stale heading popup cannot consume unrelated ${key}`, () => {
    const harness = createSuggestHarness();
    harness.editHeading();
    assert.ok(harness.popover);
    const input = harness.unrelatedInput('global-search');
    harness.state.focused = false;
    harness.document.activeElement = input;
    const dispatched = harness.dispatch('keydown', input, key);
    harness.flushTimers();
    assert.equal(dispatched.defaultPrevented, false);
    assert.equal(harness.popover, undefined);
    assert.equal(harness.edits.length, 0);
    assert.equal(harness.counts.inventories, 1);
  });
}

for (const key of ['Enter', 'Tab']) {
  test(`a focused heading still searches, navigates and selects with ${key}`, () => {
    const harness = createSuggestHarness();
    harness.editHeading();
    assert.deepEqual(harness.counts, { inventories: 1, metadata: 3 });
    assert.ok(harness.popover);
    assert.equal(harness.dispatch('keydown', harness.editorContent, 'ArrowDown').defaultPrevented, true);
    assert.equal(harness.dispatch('keydown', harness.editorContent, key).defaultPrevented, true);
    assert.equal(harness.edits.length, 1);
    assert.equal(harness.edits[0].text, '[Heading 1](Fixture/Heading 1.md)');
    assert.equal(harness.edits[0].from.ch, 2);
    assert.equal(harness.edits[0].to.ch, 9);
    assert.equal(harness.cursors.length, 1);
    assert.equal(harness.popover, undefined);
  });
}

test('a focused heading supports mouse selection without moving focus to the popup', () => {
  const harness = createSuggestHarness();
  harness.editHeading();
  const item = harness.popover.children[0];
  const mousedown = harness.event(item);
  item.listeners.get('mousedown')(mousedown);
  assert.equal(mousedown.defaultPrevented, true);
  assert.equal(harness.edits.length, 1);
  assert.equal(harness.edits[0].text, '[Heading 0](Fixture/Heading 0.md)');
  assert.equal(harness.popover, undefined);
});

for (const change of ['focus', 'file', 'editor', 'reading-mode']) {
  test(`stale mouse selection cannot edit after ${change} changes`, () => {
    const harness = createSuggestHarness();
    harness.editHeading();
    const item = harness.popover.children[0];
    if (change === 'focus') harness.state.focused = false;
    if (change === 'file') harness.state.view = { ...harness.view, file: { path: 'Other.md', extension: 'md' } };
    if (change === 'editor') harness.state.view = { ...harness.view, editor: { ...harness.view.editor } };
    if (change === 'reading-mode') harness.state.mode = 'preview';
    item.listeners.get('mousedown')(harness.event(item));
    assert.equal(harness.edits.length, 0);
    assert.equal(harness.popover, undefined);
  });
}

test('reading mode does no heading search even if the retained editor reports focus', () => {
  const harness = createSuggestHarness();
  harness.state.mode = 'preview';
  harness.dispatch('keydown');
  harness.dispatch('input');
  harness.dispatch('keyup');
  harness.editorChange();
  harness.flushTimers();
  assert.deepEqual(harness.counts, { inventories: 0, metadata: 0 });
  assert.equal(harness.popover, undefined);
});

test('keydown cannot leave a refresh that scans or reopens the popup after unload', () => {
  const harness = createSuggestHarness();
  harness.dispatch('keydown');
  harness.suggest.unload();
  harness.flushTimers();
  assert.deepEqual(harness.counts, { inventories: 0, metadata: 0 });
  assert.equal(harness.popover, undefined);
});

for (const withKeydown of [false, true]) {
  test(`after-commit editor changes find the final heading without keyup (keydown=${withKeydown})`, () => {
    const harness = createSuggestHarness();
    harness.state.line = '# H';
    if (withKeydown) harness.dispatch('keydown', harness.editorContent, 'Process');
    harness.dispatch('input');
    assert.deepEqual(harness.counts, { inventories: 0, metadata: 0 });
    harness.state.line = '# Heading';
    harness.editorChange();
    assert.deepEqual(harness.counts, { inventories: 1, metadata: 3 });
    assert.ok(harness.popover);
    harness.flushTimers();
    assert.equal(harness.counts.inventories, 1);
  });
}

test('post-commit events from another editor or an unfocused active editor do no vault work', () => {
  const harness = createSuggestHarness();
  harness.editorChange({ ...harness.view.editor });
  harness.editorChange(harness.view.editor, { file: { path: 'Other.md' } });
  harness.state.focused = false;
  harness.editorChange();
  assert.deepEqual(harness.counts, { inventories: 0, metadata: 0 });
});

test('unrelated input alone closes a stale popup without re-searching the heading', () => {
  const harness = createSuggestHarness();
  harness.editHeading();
  harness.state.focused = false;
  harness.dispatch('input', harness.unrelatedInput('modal-input'));
  assert.equal(harness.popover, undefined);
  assert.equal(harness.counts.inventories, 1);
});

test('unload removes the after-commit subscription as well as DOM handlers', () => {
  const harness = createSuggestHarness();
  harness.suggest.unload();
  harness.editorChange();
  harness.dispatch('keyup');
  harness.flushTimers();
  assert.deepEqual(harness.counts, { inventories: 0, metadata: 0 });
  assert.equal(harness.popover, undefined);
});

test('focused editor keyup still searches after cursor navigation without a text change', () => {
  const harness = createSuggestHarness();
  harness.dispatch('keyup', harness.editorLine, 'ArrowRight');
  assert.deepEqual(harness.counts, { inventories: 1, metadata: 3 });
  assert.ok(harness.popover);
});

test('a typed letter searches once after editor commit and not again on keyup', () => {
  const harness = createSuggestHarness({ noteCount: 4000 });
  harness.state.line = '# H';
  harness.dispatch('keydown', harness.editorContent, 'e');
  harness.editHeading('# Heading');
  harness.dispatch('keyup', harness.editorContent, 'e');
  assert.deepEqual(harness.counts, { inventories: 1, metadata: 4000 });
  assert.ok(harness.popover);
});

test('Escape closes the popup through the complete keydown and keyup sequence', () => {
  const harness = createSuggestHarness();
  harness.editHeading();
  assert.equal(harness.dispatch('keydown', harness.editorContent, 'Escape').defaultPrevented, true);
  assert.equal(harness.popover, undefined);
  harness.dispatch('keyup', harness.editorContent, 'Escape');
  assert.equal(harness.popover, undefined);
  assert.equal(harness.counts.inventories, 1);
});

for (const [key, selected] of [['ArrowDown', 1], ['ArrowUp', 2]]) {
  test(`popup ${key} selects without searching again on keyup`, () => {
    const harness = createSuggestHarness();
    harness.editHeading();
    assert.equal(harness.dispatch('keydown', harness.editorContent, key).defaultPrevented, true);
    harness.dispatch('keyup', harness.editorContent, key);
    assert.equal(harness.counts.inventories, 1);
    harness.dispatch('keydown', harness.editorContent, 'Enter');
    assert.equal(harness.edits[0].text, `[Heading ${selected}](Fixture/Heading ${selected}.md)`);
  });
}

test('text, acceptance, dismissal, IME and modifier keyups never start a heading search', () => {
  for (const key of ['a', 'Backspace', 'Delete', 'Enter', 'Tab', 'Escape', 'Process', 'Shift', 'Control', 'Alt', 'Meta']) {
    const harness = createSuggestHarness();
    harness.dispatch('keyup', harness.editorContent, key);
    assert.deepEqual(harness.counts, { inventories: 0, metadata: 0 }, key);
    assert.equal(harness.popover, undefined, key);
  }
});

const cursorNavigationKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
test('cursor-navigation keyups can search a focused heading when no popup exists', () => {
  for (const key of cursorNavigationKeys) {
    const harness = createSuggestHarness();
    harness.state.cursor = { line: 0, ch: 0 };
    assert.equal(harness.dispatch('keydown', harness.editorContent, key).defaultPrevented, false, key);
    harness.state.cursor = { line: 0, ch: 9 };
    harness.dispatch('keyup', harness.editorContent, key);
    assert.deepEqual(harness.counts, { inventories: 1, metadata: 3 }, key);
    assert.ok(harness.popover, key);
  }
});

test('modified cursor navigation stays editor-owned and refreshes a changed heading cursor', () => {
  for (const modifier of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey']) {
    for (const key of cursorNavigationKeys) {
      const harness = createSuggestHarness();
      harness.editHeading();
      const options = { [modifier]: true };
      assert.equal(harness.dispatch('keydown', harness.editorContent, key, options).defaultPrevented, false, `${modifier}+${key}`);
      harness.state.cursor = { line: 0, ch: 8 };
      harness.dispatch('keyup', harness.editorContent, key, options);
      assert.equal(harness.counts.inventories, 2, `${modifier}+${key}`);
      assert.ok(harness.popover);
    }
  }
});

test('cursor refresh remains correct when a navigation modifier is released before its arrow', () => {
  const harness = createSuggestHarness();
  harness.editHeading();
  assert.equal(harness.dispatch('keydown', harness.editorContent, 'ArrowDown', { shiftKey: true }).defaultPrevented, false);
  harness.state.cursor = { line: 0, ch: 8 };
  harness.dispatch('keyup', harness.editorContent, 'Shift');
  assert.equal(harness.counts.inventories, 1);
  harness.dispatch('keyup', harness.editorContent, 'ArrowDown');
  assert.equal(harness.counts.inventories, 2);
});

test('a navigation keyup does not repeat a search when the popup cursor has not moved', () => {
  for (const key of cursorNavigationKeys) {
    const harness = createSuggestHarness();
    harness.editHeading();
    harness.dispatch('keydown', harness.editorContent, key);
    harness.dispatch('keyup', harness.editorContent, key);
    assert.equal(harness.counts.inventories, 1, key);
  }
});

test('composition owns its keys while after-commit changes still update suggestions', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']) {
    const harness = createSuggestHarness();
    harness.editHeading();
    const options = { isComposing: true };
    assert.equal(harness.dispatch('keydown', harness.editorContent, key, options).defaultPrevented, false, key);
    harness.dispatch('keyup', harness.editorContent, key, options);
    assert.equal(harness.counts.inventories, 1, key);
    assert.equal(harness.edits.length, 0, key);
    harness.editHeading('# Heading 1');
    assert.equal(harness.counts.inventories, 2, key);
    assert.ok(harness.popover, key);
  }
});

test('heading link suggest only triggers from markdown headings and inserts markdown links', () => {
  assert.match(mainSource, /import \{ HeadingLinkSuggest \} from '\.\/services\/heading-link-suggest'/);
  assert.match(mainSource, /addChild\(new HeadingLinkSuggest\(this\)\)/);
  assert.match(suggestSource, /extends Component/);
  assert.match(suggestSource, /registerDomEvent\(document, 'keyup'/);
  assert.match(suggestSource, /registerDomEvent\(document, 'input'/);
  assert.match(suggestSource, /registerDomEvent\(document, 'keydown'/);
  assert.match(suggestSource, /registerEvent\(this\.plugin\.app\.workspace\.on\('editor-change'/);
  assert.doesNotMatch(suggestSource, /setTimeout/);
  assert.match(suggestSource, /beforeCursor\.match\(/);
  assert.match(suggestSource, /#\{1,6\}/);
  assert.match(suggestSource, /\{2,\}/);
  assert.match(suggestSource, /replace\(\/\[\\u200B-\\u200D\\uFEFF\]\/g, ''\)/);
  assert.match(suggestSource, /query\.startsWith\('#'\)/);
  assert.match(suggestSource, /query\.includes\('\[\['\)/);
  assert.match(suggestSource, /generateMarkdownLink\(/);
  assert.match(suggestSource, /replaceRange\(\s*link,/);
  assert.match(suggestSource, /event\.key === 'Enter' \|\| event\.key === 'Tab'/);
  assert.match(suggestSource, /private handleKeydown\(event: KeyboardEvent\): boolean/);
});

test('heading link suggest matches title filename and aliases', () => {
  assert.match(suggestSource, /frontmatter\?\.title/);
  assert.match(suggestSource, /file\.basename/);
  assert.match(suggestSource, /getAliases\(cache\?\.frontmatter\)/);
  assert.match(suggestSource, /\(frontmatter as any\)\.aliases \?\? \(frontmatter as any\)\.alias/);
  assert.match(suggestSource, /normalizedValue\.startsWith\(normalizedQuery\)/);
  assert.match(suggestSource, /compactValue\.includes\(compactQuery\)/);
});

test('title sync preserves meaningful previous title and basename aliases', () => {
  const writeSource = fileNamingSource.slice(
    fileNamingSource.indexOf('private addMeaningfulAliases'),
    fileNamingSource.indexOf('private getDailyNoteParseFormats'),
  );
  const syncSource = fileNamingSource.slice(
    fileNamingSource.indexOf('private async syncTitleFromFilenameWithOptions'),
    fileNamingSource.indexOf('/**\n     * Update filename based on title'),
  );

  assert.match(writeSource, /aliases \?\? \(frontmatter as any\)\.alias/);
  assert.match(writeSource, /targetKey = aliasKeys\.find/);
  assert.match(writeSource, /normalized === 'alias' \|\| normalized === 'aliases'/);
  assert.match(writeSource, /TEMPLATE_TITLE_MARKERS\.some/);
  assert.match(syncSource, /this\.addMeaningfulAliases\(frontmatter, \[latestTitle, rawBasename\], nextTitle\)/);
});
