import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const source = readFileSync(new URL('../src/services/heading-collapse-on-open-service.ts', import.meta.url), 'utf8');
const constantsSource = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');
globalThis.__tpsHeadingCollapsePlatform = { isMobile: false };
const serviceBuild = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/heading-collapse-on-open-service.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [{
    name: 'heading-collapse-obsidian-stub',
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'heading-collapse-stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'heading-collapse-stub' }, () => ({
        contents: [
          'export class Component { registerEvent() {} }',
          'export class MarkdownView {}',
          'export class TFile { constructor(path, extension = "md") { this.path = path; this.extension = extension; } }',
          'globalThis.__tpsHeadingCollapseTFile = TFile;',
          'export const Platform = globalThis.__tpsHeadingCollapsePlatform;',
        ].join('\n'),
      }));
    },
  }],
});
const serviceModule = await import(`data:text/javascript;base64,${Buffer.from(serviceBuild.outputFiles[0].text).toString('base64')}`);
const TestTFile = globalThis.__tpsHeadingCollapseTFile;

function makeEditor({ throwAt = null } = {}) {
  const calls = {
    exec: [],
    focus: 0,
    lineCount: 0,
    getLine: 0,
    getCursor: 0,
    getScrollInfo: 0,
    setCursor: 0,
    scrollTo: 0,
  };
  return {
    calls,
    editor: {
      focus() {
        calls.focus += 1;
        if (throwAt === 'focus') throw new Error('focus failed');
      },
      exec(command) {
        calls.exec.push(command);
        if (throwAt === 'exec') throw new Error('exec failed');
      },
      lineCount() {
        calls.lineCount += 1;
        return 3;
      },
      getLine(line) {
        calls.getLine += 1;
        return line === 0 ? '# First' : line === 2 ? '## Second' : 'Body';
      },
      getCursor() {
        calls.getCursor += 1;
        return { line: 1, ch: 2 };
      },
      getScrollInfo() {
        calls.getScrollInfo += 1;
        return { left: 3, top: 4 };
      },
      setCursor() {
        calls.setCursor += 1;
      },
      scrollTo() {
        calls.scrollTo += 1;
      },
    },
  };
}

function installFakeWindow() {
  const previousWindow = globalThis.window;
  const timers = new Map();
  let nextId = 1;
  globalThis.window = {
    setTimeout(callback, delay) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  return {
    timers,
    restore() {
      globalThis.window = previousWindow;
    },
    delays() {
      return [...timers.values()].map((timer) => timer.delay).sort((left, right) => left - right);
    },
    runTimerWithDelay(delay) {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `Expected a pending ${delay} ms timer`);
      const [id, timer] = entry;
      timers.delete(id);
      timer.callback();
      return timer.delay;
    },
  };
}

function createService({ activeView = null } = {}) {
  let currentActiveView = activeView;
  const workspace = {
    getActiveViewOfType: () => currentActiveView,
    iterateAllLeaves: () => {},
  };
  const service = new serviceModule.HeadingCollapseOnOpenService({
    app: { workspace },
    settings: { collapseHeadingsOnOpen: true },
  });
  return {
    service,
    setActiveView(view) {
      currentActiveView = view;
    },
  };
}

test('collapse-on-open is skipped on mobile before running fold automation', () => {
  assert.match(source, /import \{ Component, MarkdownView, Platform, TFile \} from 'obsidian';/);
  assert.match(source, /Platform\.isMobile \|\| this\.plugin\.settings\.collapseHeadingsOnOpen !== true \|\| wasAlreadyOpen/);
  assert.match(source, /Platform\.isMobile \|\| this\.plugin\.settings\.collapseHeadingsOnOpen !== true/);
  assert.match(settingsSource, /Desktop only\./);
  assert.match(settingsSource, /Mobile skips this automation/);
  assert.match(constantsSource, /collapseHeadingsOnOpen:\s*false/);
});

test('mobile native fold controls keep a real touch target', () => {
  assert.match(stylesSource, /--folding-offset: 32px/);
  assert.match(stylesSource, /\.cm-fold-indicator/);
  assert.match(stylesSource, /width: 28px !important/);
  assert.match(stylesSource, /\.collapse-indicator/);
  assert.match(stylesSource, /touch-action: manipulation !important/);
});

test('desktop collapse uses one supported Editor foldAll call without private command or cursor fallbacks', () => {
  const { editor, calls } = makeEditor();
  let privateCommandReads = 0;
  const view = { file: { path: 'Notes/Test.md' }, editor };
  const workspace = { getActiveViewOfType: () => view };
  const app = new Proxy({ workspace }, {
    get(target, property, receiver) {
      if (property === 'commands') {
        privateCommandReads += 1;
        return undefined;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const service = new serviceModule.HeadingCollapseOnOpenService({
    app,
    settings: { collapseHeadingsOnOpen: true },
  });

  const collapsed = service.collapseActiveMarkdownFile('Notes/Test.md');

  assert.equal(collapsed, true);
  assert.equal(privateCommandReads, 0, 'the public Editor API must not be preceded by an internal App.commands probe');
  assert.equal(calls.focus, 1);
  assert.deepEqual(calls.exec, ['foldAll']);
  assert.equal(calls.lineCount, 0);
  assert.equal(calls.getLine, 0);
  assert.equal(calls.getCursor, 0);
  assert.equal(calls.getScrollInfo, 0);
  assert.equal(calls.setCursor, 0);
  assert.equal(calls.scrollTo, 0);
  assert.doesNotMatch(source, /ObsidianCommandApi|executeCommandById|resolveFoldAllCommandId|collapseMarkdownHeadings/);
  assert.match(source, /editor\.exec\('foldAll'\)/);
  assert.match(source, /Requested heading collapse for newly opened note/);
});

test('desktop collapse refuses a wrong active path or missing editor without side effects', () => {
  const { editor, calls } = makeEditor();
  const { service, setActiveView } = createService({
    activeView: { file: { path: 'Notes/Other.md' }, editor },
  });

  assert.equal(service.collapseActiveMarkdownFile('Notes/Test.md'), false);
  assert.equal(calls.focus, 0);
  assert.deepEqual(calls.exec, []);

  setActiveView({ file: { path: 'Notes/Test.md' }, editor: null });
  assert.equal(service.collapseActiveMarkdownFile('Notes/Test.md'), false);
  assert.equal(calls.focus, 0);
  assert.deepEqual(calls.exec, []);
});

test('desktop collapse failure returns false so the bounded scheduler retry remains available', () => {
  for (const throwAt of ['focus', 'exec']) {
    const { editor, calls } = makeEditor({ throwAt });
    const { service } = createService({
      activeView: { file: { path: 'Notes/Test.md' }, editor },
    });

    assert.equal(service.collapseActiveMarkdownFile('Notes/Test.md'), false, throwAt);
    assert.equal(calls.focus, 1, throwAt);
    assert.deepEqual(calls.exec, throwAt === 'focus' ? [] : ['foldAll'], throwAt);
  }
});

test('new desktop notes retain the 700 ms delay and one 1200 ms wrong-view retry', () => {
  const fakeWindow = installFakeWindow();
  globalThis.__tpsHeadingCollapsePlatform.isMobile = false;
  try {
    const { editor, calls } = makeEditor();
    const { service, setActiveView } = createService({
      activeView: { file: { path: 'Notes/Other.md' }, editor },
    });
    service.knownOpenPaths = new Set();

    service.handleFileOpen(new TestTFile('Notes/Test.md'));
    assert.deepEqual(fakeWindow.delays(), [0, 700]);
    fakeWindow.runTimerWithDelay(0);
    assert.equal(fakeWindow.runTimerWithDelay(700), 700);
    assert.deepEqual(calls.exec, []);

    setActiveView({ file: { path: 'Notes/Test.md' }, editor });
    assert.equal(fakeWindow.runTimerWithDelay(1200), 1200);
    assert.deepEqual(calls.exec, ['foldAll']);
    assert.equal(fakeWindow.timers.size, 0);
  } finally {
    fakeWindow.restore();
  }
});

test('the delayed collapse follows an Obsidian TFile rename before the timer fires', () => {
  const fakeWindow = installFakeWindow();
  globalThis.__tpsHeadingCollapsePlatform.isMobile = false;
  try {
    const { editor, calls } = makeEditor();
    const file = new TestTFile('Inbox/Original.md');
    const view = { file, editor };
    const { service } = createService({ activeView: view });
    service.knownOpenPaths = new Set();

    service.handleFileOpen(file);
    file.path = 'Inbox/Renamed.md';
    fakeWindow.runTimerWithDelay(0);
    fakeWindow.runTimerWithDelay(700);

    assert.deepEqual(calls.exec, ['foldAll']);
    assert.equal(fakeWindow.timers.size, 0);
  } finally {
    fakeWindow.restore();
  }
});

test('mobile and already-open notes do not schedule collapse', () => {
  const fakeWindow = installFakeWindow();
  try {
    const { service } = createService();

    globalThis.__tpsHeadingCollapsePlatform.isMobile = true;
    service.knownOpenPaths = new Set();
    service.handleFileOpen(new TestTFile('Notes/Mobile.md'));
    assert.deepEqual(fakeWindow.delays(), [0]);
    fakeWindow.runTimerWithDelay(0);

    globalThis.__tpsHeadingCollapsePlatform.isMobile = false;
    service.knownOpenPaths = new Set(['Notes/Open.md']);
    service.handleFileOpen(new TestTFile('Notes/Open.md'));
    assert.deepEqual(fakeWindow.delays(), [0]);
    fakeWindow.runTimerWithDelay(0);
    assert.equal(fakeWindow.timers.size, 0);
  } finally {
    globalThis.__tpsHeadingCollapsePlatform.isMobile = false;
    fakeWindow.restore();
  }
});

test('a rapid A-to-B open cancels A and only folds the current B note', () => {
  const fakeWindow = installFakeWindow();
  globalThis.__tpsHeadingCollapsePlatform.isMobile = false;
  try {
    const first = makeEditor();
    const second = makeEditor();
    const { service, setActiveView } = createService({
      activeView: { file: { path: 'Notes/A.md' }, editor: first.editor },
    });
    service.knownOpenPaths = new Set();

    service.handleFileOpen(new TestTFile('Notes/A.md'));
    setActiveView({ file: { path: 'Notes/B.md' }, editor: second.editor });
    service.handleFileOpen(new TestTFile('Notes/B.md'));

    assert.deepEqual(fakeWindow.delays(), [0, 700]);
    fakeWindow.runTimerWithDelay(0);
    assert.equal(fakeWindow.runTimerWithDelay(700), 700);
    assert.deepEqual(first.calls.exec, []);
    assert.deepEqual(second.calls.exec, ['foldAll']);
    assert.equal(fakeWindow.timers.size, 0);
  } finally {
    fakeWindow.restore();
  }
});

test('unload cancels pending collapse, retry, and open-path refresh timers', () => {
  const fakeWindow = installFakeWindow();
  globalThis.__tpsHeadingCollapsePlatform.isMobile = false;
  try {
    const { service } = createService();
    service.knownOpenPaths = new Set();
    service.handleFileOpen(new TestTFile('Notes/Test.md'));
    service.pendingRetryTimer = globalThis.window.setTimeout(() => {}, 1200);
    service.scheduleKnownOpenPathsRefresh(1500);

    assert.equal(fakeWindow.timers.size, 3);
    service.onunload();
    assert.equal(fakeWindow.timers.size, 0);
    assert.equal(service.pendingCollapseTimer, null);
    assert.equal(service.pendingRetryTimer, null);
    assert.equal(service.pendingRefreshTimer, null);
  } finally {
    fakeWindow.restore();
  }
});
