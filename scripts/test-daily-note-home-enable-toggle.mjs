import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import * as esbuild from 'esbuild';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const constantsSource = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/services/daily-note-home-service.ts', import.meta.url), 'utf8');

async function loadDailyNoteHomeService() {
  const build = await esbuild.build({
    entryPoints: [
      fileURLToPath(new URL('../src/services/daily-note-home-service.ts', import.meta.url)),
    ],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'daily-note-home-behavior-stubs',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({
          path: 'obsidian',
          namespace: 'daily-note-home-test',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'daily-note-home-test' }, () => ({
          loader: 'js',
          contents: `
            export class Component {
              constructor() {
                this.loaded = false;
                this.children = [];
                this.cleanups = [];
              }

              load() {
                if (this.loaded) return;
                this.loaded = true;
                this.onload?.();
                for (const child of this.children) child.load();
              }

              unload() {
                if (!this.loaded) return;
                for (const child of [...this.children].reverse()) child.unload();
                this.children = [];
                this.onunload?.();
                for (const cleanup of [...this.cleanups].reverse()) cleanup();
                this.cleanups = [];
                this.loaded = false;
              }

              addChild(child) {
                this.children.push(child);
                if (this.loaded) child.load();
                return child;
              }

              removeChild(child) {
                const index = this.children.indexOf(child);
                if (index >= 0) this.children.splice(index, 1);
                child.unload();
              }

              register(cleanup) {
                this.cleanups.push(cleanup);
                return cleanup;
              }

              registerDomEvent(target, type, callback, options) {
                target.addEventListener(type, callback, options);
                this.register(() => target.removeEventListener(type, callback, options));
              }

              registerEvent(ref) {
                this.register(() => ref?.off?.());
                return ref;
              }

              registerInterval(id) {
                this.register(() => window.clearInterval(id));
                return id;
              }
            }

            export class TFile {
              constructor(path) {
                this.path = path;
                this.extension = path.includes('.') ? path.split('.').pop() : '';
                this.basename = path.split('/').pop().replace(/\\.[^.]+$/, '');
                this.dailyNoteDate = null;
              }
            }

            export class TFolder {
              constructor(path) { this.path = path; }
            }

            export class MarkdownView {
              constructor(file, mode = 'preview') {
                this.file = file;
                this.mode = mode;
              }
              getViewType() {
                return 'markdown';
              }
              getMode() {
                return this.mode;
              }
            }

            export class WorkspaceLeaf {}

            export const Platform = {
              isMacOS: false,
              isMobile: false,
            };

            export function debounce(callback, wait) {
              let timer = null;
              let latestArgs = [];
              const debounced = (...args) => {
                latestArgs = args;
                if (timer !== null) window.clearTimeout(timer);
                timer = window.setTimeout(() => {
                  timer = null;
                  callback(...latestArgs);
                }, wait);
              };
              debounced.cancel = () => {
                if (timer !== null) window.clearTimeout(timer);
                timer = null;
                return debounced;
              };
              debounced.run = () => {
                if (timer === null) return;
                window.clearTimeout(timer);
                timer = null;
                return callback(...latestArgs);
              };
              return debounced;
            }

            globalThis.__dailyNoteHomeTestTypes = { Component, TFile, TFolder, MarkdownView };
          `,
        }));

        builder.onResolve({ filter: /^\.\.\/utils\/daily-note-task-schedule$/ }, () => ({
          path: 'daily-note-task-schedule',
          namespace: 'daily-note-home-test-support',
        }));
        builder.onLoad(
          { filter: /^daily-note-task-schedule$/, namespace: 'daily-note-home-test-support' },
          () => ({
            loader: 'js',
            contents: `
              export function parseDailyNoteFileDate(_app, _settings, file) {
                return file?.dailyNoteDate || null;
              }
            `,
          }),
        );

        builder.onResolve({ filter: /^\.\.\/utils\/notebook-navigator-home-intent$/ }, () => ({
          path: 'notebook-navigator-home-intent',
          namespace: 'daily-note-home-test-support',
        }));
        builder.onLoad(
          { filter: /^notebook-navigator-home-intent$/, namespace: 'daily-note-home-test-support' },
          () => ({
            loader: 'js',
            contents: `
              export function collectNotebookNavigatorSelectionPaths() { return []; }
              export function isNotebookNavigatorSelectionGesture() { return false; }
              export class NotebookNavigatorHomeIntentTracker {
                clear() {}
                markPlainOpen() {}
                markSelection() {}
                reconcileLeaf() {}
                retainLeaves() {}
                shouldSuppress() { return false; }
              }
            `,
          }),
        );

        builder.onResolve({ filter: /^\.\.\/views\/home-view$/ }, () => ({
          path: 'home-view',
          namespace: 'daily-note-home-test-support',
        }));
        builder.onLoad(
          { filter: /^home-view$/, namespace: 'daily-note-home-test-support' },
          () => ({
            loader: 'js',
            contents: `
              export const TPS_HOME_VIEW_TYPE = 'tps-home';
              export class TpsHomeView {}
            `,
          }),
        );

        builder.onResolve({ filter: /^\.\.\/logger$/ }, () => ({
          path: 'logger',
          namespace: 'daily-note-home-test-support',
        }));
        builder.onLoad(
          { filter: /^logger$/, namespace: 'daily-note-home-test-support' },
          () => ({
            loader: 'js',
            contents: `
              export function flow() {}
              export function flowError() {}
              export function flowWarn() {}
            `,
          }),
        );
      },
    }],
  });

  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

const serviceModule = await loadDailyNoteHomeService();
const {
  TFile: TestTFile,
  TFolder: TestTFolder,
  MarkdownView: TestMarkdownView,
} = globalThis.__dailyNoteHomeTestTypes;

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }

  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
  }

  emit(type, event = {}) {
    for (const callback of [...(this.listeners.get(type) || [])]) callback(event);
  }

  count(type) {
    return this.listeners.get(type)?.size || 0;
  }

  total() {
    return [...this.listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0);
  }
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function createLeaf({ file = null, state, active = false } = {}) {
  let currentState = cloneState(state);
  let fileLookup = (path) => file?.path === path ? file : null;
  let nextSetViewStateGate = null;
  const setViewStateErrors = [];
  const setViewStatePostCommitErrors = [];
  let nextOpenFileError = null;
  const setViewStateCalls = [];
  const openFileCalls = [];
  const leaf = {
    view: null,
    active,
    sourceFile: file,
    setViewStateCalls,
    openFileCalls,
    getViewState() {
      return cloneState(currentState);
    },
    async setViewState(nextState) {
      setViewStateCalls.push(cloneState(nextState));
      const gate = nextSetViewStateGate;
      nextSetViewStateGate = null;
      if (gate) {
        gate.markStarted();
        await gate.promise;
      }
      const error = setViewStateErrors.shift() || null;
      if (error) throw error;
      currentState = cloneState(nextState);
      syncView();
      const postCommitError = setViewStatePostCommitErrors.shift() || null;
      if (postCommitError) throw postCommitError;
    },
    async openFile(nextFile) {
      openFileCalls.push(nextFile);
      const error = nextOpenFileError;
      nextOpenFileError = null;
      if (error) throw error;
      currentState = {
        type: nextFile.extension || 'empty',
        state: { file: nextFile.path },
      };
      syncView();
    },
    setFileLookup(nextLookup) {
      fileLookup = nextLookup;
      syncView();
    },
    deferNextSetViewState() {
      assert.equal(nextSetViewStateGate, null, 'only one deferred view-state mutation may be armed');
      let release;
      let markStarted;
      const promise = new Promise((resolve) => { release = resolve; });
      const started = new Promise((resolve) => { markStarted = resolve; });
      nextSetViewStateGate = { promise, markStarted };
      return { started, release };
    },
    rejectNextSetViewState(error = new Error('transient setViewState failure')) {
      setViewStateErrors.push(error);
    },
    rejectNextSetViewStates(count, error = new Error('persistent setViewState failure')) {
      for (let index = 0; index < count; index += 1) setViewStateErrors.push(error);
    },
    rejectNextSetViewStateAfterCommit(error = new Error('post-commit setViewState failure')) {
      setViewStatePostCommitErrors.push(error);
    },
    rejectNextOpenFile(error = new Error('transient openFile failure')) {
      nextOpenFileError = error;
    },
    navigateToState(nextState) {
      currentState = cloneState(nextState);
      syncView();
    },
  };

  function syncView() {
    if (currentState.type === 'markdown') {
      const path = String(currentState.state?.file || file?.path || '');
      const markdownFile = fileLookup(path) || (file?.path === path ? file : null);
      leaf.view = new TestMarkdownView(markdownFile, currentState.state?.mode || 'source');
      return;
    }
    if (currentState.type === 'tps-home') {
      const dailyNotePath = String(currentState.state?.dailyNotePath || '');
      const dailyNoteBacked = Boolean(dailyNotePath && fileLookup(dailyNotePath));
      leaf.view = {
        getViewType: () => currentState.type,
        isDailyNoteBacked: () => dailyNoteBacked,
      };
      return;
    }
    const statePath = String(currentState.state?.file || '');
    leaf.view = {
      getViewType: () => currentState.type,
      ...(statePath && fileLookup(statePath) ? { file: fileLookup(statePath) } : {}),
    };
  }

  syncView();
  return leaf;
}

function createHarness({ enableDailyNoteHome, leaves = [], layoutReady = false } = {}) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const documentTarget = new FakeEventTarget();
  const intervals = new Map();
  const timeouts = new Map();
  const mutableLeaves = [...leaves];
  const files = new Map();
  let nextTimerId = 1;
  let disposed = false;

  globalThis.document = documentTarget;
  globalThis.window = {
    setInterval(callback, delay) {
      const id = nextTimerId++;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timeouts.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
  };

  const workspaceHandlers = new Map();
  const vaultHandlers = new Map();
  const layoutReadyCallbacks = [];
  let layoutReadyRegistrationCount = 0;
  let isLayoutReady = layoutReady;
  const workspace = {
    activeLeaf: mutableLeaves.find((leaf) => leaf.active) || mutableLeaves[0] || null,
    on(type, callback) {
      if (!workspaceHandlers.has(type)) workspaceHandlers.set(type, new Set());
      workspaceHandlers.get(type).add(callback);
      return {
        off() {
          workspaceHandlers.get(type)?.delete(callback);
        },
      };
    },
    onLayoutReady(callback) {
      layoutReadyRegistrationCount += 1;
      if (isLayoutReady) callback();
      else layoutReadyCallbacks.push(callback);
    },
    iterateAllLeaves(callback) {
      for (const leaf of mutableLeaves) callback(leaf);
    },
  };

  function registerLeafFiles(leaf) {
    const path = leaf.view?.file?.path || leaf.getViewState().state?.dailyNotePath;
    if (path) {
      const registeredFile = leaf.view?.file instanceof TestTFile ? leaf.view.file : new TestTFile(path);
      if (!registeredFile.dailyNoteDate) {
        registeredFile.dailyNoteDate = path.match(/\d{4}-\d{2}-\d{2}/u)?.[0] || null;
      }
      files.set(path, registeredFile);
    }
    leaf.setFileLookup((candidatePath) => files.get(candidatePath) || null);
  }
  for (const leaf of mutableLeaves) registerLeafFiles(leaf);

  const settings = {};
  if (enableDailyNoteHome !== undefined) settings.enableDailyNoteHome = enableDailyNoteHome;
  const vault = {
    on(type, callback) {
      if (!vaultHandlers.has(type)) vaultHandlers.set(type, new Set());
      vaultHandlers.get(type).add(callback);
      return {
        off() {
          vaultHandlers.get(type)?.delete(callback);
        },
      };
    },
    getAbstractFileByPath(path) {
      return files.get(path) || null;
    },
    getFiles() {
      return [...files.values()];
    },
  };
  const plugin = {
    settings,
    app: {
      workspace,
      vault,
      plugins: {},
    },
    contextTargetService: {
      getSelectedFiles() { return []; },
      isNotebookNavigatorFileContextTarget() { return false; },
      resolveNotebookNavigatorFileTarget() { return null; },
    },
    async saveSettings() {},
  };
  const service = new serviceModule.DailyNoteHomeService(plugin);

  return {
    service,
    documentTarget,
    intervals,
    timeouts,
    workspace,
    workspaceHandlers,
    layoutReadyCallbacks,
    files,
    addLeaf(leaf, { registerFile = true } = {}) {
      mutableLeaves.push(leaf);
      if (registerFile) registerLeafFiles(leaf);
      else leaf.setFileLookup((candidatePath) => files.get(candidatePath) || null);
      if (leaf.active) workspace.activeLeaf = leaf;
    },
    removeLeaf(leaf) {
      const index = mutableLeaves.indexOf(leaf);
      if (index >= 0) mutableLeaves.splice(index, 1);
      if (workspace.activeLeaf === leaf) workspace.activeLeaf = mutableLeaves[0] || null;
    },
    fireLayoutReady() {
      if (isLayoutReady) return;
      isLayoutReady = true;
      for (const callback of layoutReadyCallbacks.splice(0)) callback();
    },
    layoutReadyRegistrationCount() {
      return layoutReadyRegistrationCount;
    },
    workspaceListenerCount(type) {
      return workspaceHandlers.get(type)?.size || 0;
    },
    totalWorkspaceListeners() {
      return [...workspaceHandlers.values()].reduce((sum, handlers) => sum + handlers.size, 0);
    },
    vaultListenerCount(type) {
      return vaultHandlers.get(type)?.size || 0;
    },
    totalVaultListeners() {
      return [...vaultHandlers.values()].reduce((sum, handlers) => sum + handlers.size, 0);
    },
    emitWorkspace(type, ...args) {
      for (const callback of [...(workspaceHandlers.get(type) || [])]) callback(...args);
    },
    emitVault(type, ...args) {
      for (const callback of [...(vaultHandlers.get(type) || [])]) callback(...args);
    },
    renameFile(file, nextPath, dailyNoteDate = null) {
      const oldPath = file.path;
      files.delete(oldPath);
      file.path = nextPath;
      file.extension = nextPath.includes('.') ? nextPath.split('.').pop() : '';
      file.basename = nextPath.split('/').pop().replace(/\.[^.]+$/, '');
      file.dailyNoteDate = dailyNoteDate;
      files.set(nextPath, file);
      return oldPath;
    },
    deleteFile(file) {
      if (files.get(file.path) === file) files.delete(file.path);
    },
    renameFolder(folder, nextPath) {
      const oldPath = folder.path;
      const oldPrefix = `${oldPath}/`;
      const nextPrefix = `${nextPath}/`;
      for (const [path, file] of [...files.entries()]) {
        if (!path.startsWith(oldPrefix)) continue;
        files.delete(path);
        file.path = `${nextPrefix}${path.slice(oldPrefix.length)}`;
        file.extension = file.path.includes('.') ? file.path.split('.').pop() : '';
        file.basename = file.path.split('/').pop().replace(/\.[^.]+$/, '');
        files.set(file.path, file);
      }
      folder.path = nextPath;
      return oldPath;
    },
    addFile(file) {
      files.set(file.path, file);
      return file;
    },
    replaceFileAtPath(path, file) {
      files.set(path, file);
      return file;
    },
    runAllTimeouts() {
      let guard = 0;
      while (timeouts.size > 0) {
        assert.ok(guard++ < 20, 'timer queue should settle');
        const pending = [...timeouts.entries()];
        timeouts.clear();
        for (const [, timer] of pending) timer.callback();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      service.unload();
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    },
  };
}

async function settleAsyncWork() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

test('legacy settings stay enabled without polling and startup-disabled restoration waits for layout', async (t) => {
  assert.match(constantsSource, /enableDailyNoteHome:\s*true/);
  assert.match(mainSource, /this\.settings\.enableDailyNoteHome = this\.settings\.enableDailyNoteHome !== false/);
  assert.doesNotMatch(serviceSource, /(?:registerInterval|setInterval)\(/u);

  const legacyFile = new TestTFile('Daily Notes/2026-07-31.md');
  legacyFile.dailyNoteDate = '2026-07-31';
  const legacyLeaf = createLeaf({
    file: legacyFile,
    state: { type: 'markdown', state: { file: legacyFile.path, mode: 'preview' } },
    active: true,
  });
  const legacy = createHarness({ leaves: [legacyLeaf] });
  t.after(() => legacy.dispose());
  legacy.service.load();

  assert.equal(legacy.service.isEnabled(), true);
  assert.equal(legacy.documentTarget.count('click'), 1);
  assert.equal(legacy.documentTarget.count('dragstart'), 1);
  assert.equal(legacy.totalWorkspaceListeners(), 3);
  assert.equal(legacy.vaultListenerCount('rename'), 1);
  assert.equal(legacy.vaultListenerCount('delete'), 1);
  assert.equal(legacy.vaultListenerCount('create'), 1);
  assert.equal(legacy.intervals.size, 0);
  assert.equal(legacy.layoutReadyRegistrationCount(), 1);

  legacy.dispose();

  const disabled = createHarness({ enableDailyNoteHome: false });
  t.after(() => disabled.dispose());
  disabled.service.load();

  assert.equal(disabled.service.isEnabled(), false);
  assert.equal(disabled.documentTarget.total(), 0);
  assert.equal(disabled.totalWorkspaceListeners(), 0);
  assert.equal(disabled.vaultListenerCount('rename'), 1, 'disabled startup keeps one transient rename listener until restoration');
  assert.equal(disabled.vaultListenerCount('delete'), 1, 'disabled startup also tracks a deleted backing file until restoration');
  assert.equal(disabled.intervals.size, 0);
  assert.equal(disabled.layoutReadyRegistrationCount(), 1);

  const dailyPath = 'Daily Notes/2026-08-01.md';
  const disabledLeaf = createLeaf({
    state: {
      type: 'tps-home',
      pinned: true,
      state: { dailyNotePath: dailyPath, dateIso: '2026-08-01' },
    },
    active: true,
  });
  const standaloneLeaf = createLeaf({ state: { type: 'tps-home', state: {} } });
  disabled.addLeaf(disabledLeaf);
  disabled.addLeaf(standaloneLeaf);
  assert.equal(disabledLeaf.setViewStateCalls.length, 0, 'restoration must not run before layout is ready');

  disabled.fireLayoutReady();
  await settleAsyncWork();

  assert.deepEqual(disabledLeaf.getViewState(), {
    type: 'markdown',
    active: true,
    pinned: true,
    state: { file: dailyPath, mode: 'preview' },
  });
  assert.equal(standaloneLeaf.setViewStateCalls.length, 0);
  assert.equal(disabled.totalVaultListeners(), 0, 'disabled steady state removes the transient rename listener');
});

test('supported workspace events cannot reconcile before layout-ready', async (t) => {
  const file = new TestTFile('Daily Notes/2026-08-01.md');
  file.dailyNoteDate = '2026-08-01';
  const leaf = createLeaf({
    file,
    state: { type: 'markdown', state: { file: file.path, mode: 'preview' } },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: false });
  t.after(() => harness.dispose());
  harness.service.load();

  harness.emitWorkspace('layout-change');
  harness.runAllTimeouts();
  await settleAsyncWork();
  assert.equal(leaf.setViewStateCalls.length, 0);

  harness.fireLayoutReady();
  await settleAsyncWork();
  assert.equal(leaf.getViewState().type, 'tps-home');
  assert.equal(leaf.setViewStateCalls.length, 1);
});

test('runtime enable installs exactly one supported-event scope and is idempotent', async (t) => {
  const file = new TestTFile('Daily Notes/2026-08-02.md');
  file.dailyNoteDate = '2026-08-02';
  const leaf = createLeaf({
    file,
    state: { type: 'markdown', state: { file: file.path, mode: 'preview' }, pinned: true },
    active: true,
  });
  const harness = createHarness({ enableDailyNoteHome: false, leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  await harness.service.setEnabled(true);
  await settleAsyncWork();
  assert.equal(harness.service.isEnabled(), true);
  assert.equal(harness.documentTarget.count('click'), 1);
  assert.equal(harness.documentTarget.count('dragstart'), 1);
  assert.equal(harness.workspaceListenerCount('active-leaf-change'), 1);
  assert.equal(harness.workspaceListenerCount('file-open'), 1);
  assert.equal(harness.workspaceListenerCount('layout-change'), 1);
  assert.equal(harness.totalWorkspaceListeners(), 3);
  assert.equal(harness.vaultListenerCount('rename'), 1);
  assert.equal(harness.vaultListenerCount('delete'), 1);
  assert.equal(harness.vaultListenerCount('create'), 1);
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.timeouts.size, 0);

  await harness.service.setEnabled(true);
  assert.equal(harness.documentTarget.total(), 2);
  assert.equal(harness.totalWorkspaceListeners(), 3);
  assert.equal(harness.totalVaultListeners(), 3);
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.timeouts.size, 0);

  assert.equal(leaf.setViewStateCalls.length, 1);
  assert.deepEqual(leaf.setViewStateCalls[0], {
    type: 'tps-home',
    active: true,
    pinned: true,
    state: {
      dailyNotePath: file.path,
      dateIso: '2026-08-02',
    },
  });
});

test('runtime disable disposes its scope and restores only date-backed Home leaves', async (t) => {
  const dailyPath = 'Daily Notes/2026-08-03.md';
  const dateBackedLeaf = createLeaf({
    state: {
      type: 'tps-home',
      pinned: true,
      state: { dailyNotePath: dailyPath, dateIso: '2026-08-03' },
    },
    active: true,
  });
  const standaloneLeaf = createLeaf({
    state: { type: 'tps-home', pinned: false, state: {} },
  });
  const harness = createHarness({ leaves: [dateBackedLeaf, standaloneLeaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  await harness.service.setEnabled(false);

  assert.equal(harness.service.isEnabled(), false);
  assert.equal(harness.documentTarget.total(), 0);
  assert.equal(harness.totalWorkspaceListeners(), 0);
  assert.equal(harness.totalVaultListeners(), 0);
  assert.equal(harness.intervals.size, 0);
  assert.equal(dateBackedLeaf.setViewStateCalls.length, 1);
  assert.deepEqual(dateBackedLeaf.setViewStateCalls[0], {
    type: 'markdown',
    active: true,
    pinned: true,
    state: {
      file: dailyPath,
      mode: 'preview',
    },
  });
  assert.equal(standaloneLeaf.setViewStateCalls.length, 0);
  assert.deepEqual(standaloneLeaf.getViewState(), {
    type: 'tps-home',
    pinned: false,
    state: {},
  });

  await harness.service.setEnabled(false);
  assert.equal(dateBackedLeaf.setViewStateCalls.length, 1);
  assert.equal(standaloneLeaf.setViewStateCalls.length, 0);
});

test('rapid disable then enable reconciles an in-flight restoration to the newest generation', async (t) => {
  const dailyPath = 'Daily Notes/2026-08-04.md';
  const leaf = createLeaf({
    state: {
      type: 'tps-home',
      pinned: true,
      state: { dailyNotePath: dailyPath, dateIso: '2026-08-04' },
    },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const gate = leaf.deferNextSetViewState();
  const disabling = harness.service.setEnabled(false);
  await gate.started;
  await harness.service.setEnabled(true);
  gate.release();
  await disabling;
  await settleAsyncWork();

  assert.deepEqual(leaf.setViewStateCalls.map((state) => state.type), ['markdown', 'tps-home']);
  assert.equal(leaf.getViewState().type, 'tps-home');
  assert.equal(harness.totalWorkspaceListeners(), 3);
  assert.equal(harness.intervals.size, 0);
});

test('rapid enable then disable reconciles an in-flight conversion to Markdown', async (t) => {
  const file = new TestTFile('Daily Notes/2026-08-05.md');
  file.dailyNoteDate = '2026-08-05';
  const leaf = createLeaf({
    file,
    state: { type: 'markdown', state: { file: file.path, mode: 'preview' } },
    active: true,
  });
  const harness = createHarness({ enableDailyNoteHome: false, leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const gate = leaf.deferNextSetViewState();
  const enabling = harness.service.setEnabled(true);
  await gate.started;
  const disabling = harness.service.setEnabled(false);
  gate.release();
  await Promise.all([enabling, disabling]);
  await settleAsyncWork();

  assert.deepEqual(leaf.setViewStateCalls.map((state) => state.type), ['tps-home', 'markdown']);
  assert.equal(leaf.getViewState().type, 'markdown');
  assert.equal(harness.documentTarget.total(), 0);
  assert.equal(harness.totalWorkspaceListeners(), 0);
  assert.equal(harness.totalVaultListeners(), 0);
  assert.equal(harness.intervals.size, 0);
});

test('an event during an in-flight conversion queues one follow-up scan without polling', async (t) => {
  const firstFile = new TestTFile('Daily Notes/2026-08-06.md');
  firstFile.dailyNoteDate = '2026-08-06';
  const firstLeaf = createLeaf({
    file: firstFile,
    state: { type: 'markdown', state: { file: firstFile.path, mode: 'preview' } },
    active: true,
  });
  const gate = firstLeaf.deferNextSetViewState();
  const harness = createHarness({ leaves: [firstLeaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await gate.started;

  const secondFile = new TestTFile('Daily Notes/2026-08-07.md');
  secondFile.dailyNoteDate = '2026-08-07';
  const secondLeaf = createLeaf({
    file: secondFile,
    state: { type: 'markdown', state: { file: secondFile.path, mode: 'preview' } },
  });
  harness.addLeaf(secondLeaf);
  harness.emitWorkspace('layout-change');
  assert.equal(harness.timeouts.size, 1);
  harness.runAllTimeouts();

  gate.release();
  await settleAsyncWork();

  assert.equal(firstLeaf.getViewState().type, 'tps-home');
  assert.equal(secondLeaf.getViewState().type, 'tps-home');
  assert.equal(firstLeaf.setViewStateCalls.length, 1);
  assert.equal(secondLeaf.setViewStateCalls.length, 1);
  assert.equal(harness.intervals.size, 0);
});

test('renaming an open preview note into a Daily Note path triggers conversion without polling', async (t) => {
  const file = new TestTFile('Inbox/Rename me.md');
  const leaf = createLeaf({
    file,
    state: { type: 'markdown', state: { file: file.path, mode: 'preview' } },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  assert.equal(leaf.getViewState().type, 'markdown');
  assert.equal(leaf.setViewStateCalls.length, 0);

  const dailyPath = 'Daily Notes/2026-08-08.md';
  const oldPath = harness.renameFile(file, dailyPath, '2026-08-08');
  harness.emitVault('rename', file, oldPath);
  await settleAsyncWork();

  assert.deepEqual(leaf.getViewState(), {
    type: 'tps-home',
    active: true,
    state: {
      dailyNotePath: dailyPath,
      dateIso: '2026-08-08',
    },
  });
  assert.equal(leaf.setViewStateCalls.length, 1);
  assert.equal(harness.intervals.size, 0);
});

test('renaming a date-backed Home between Daily Note paths updates its exact backing state', async (t) => {
  const originalPath = 'Daily Notes/2026-08-09.md';
  const leaf = createLeaf({
    state: {
      type: 'tps-home',
      pinned: true,
      state: { dailyNotePath: originalPath, dateIso: '2026-08-09' },
    },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const file = harness.files.get(originalPath);
  const nextPath = 'Daily Notes/2026-08-10.md';
  const oldPath = harness.renameFile(file, nextPath, '2026-08-10');
  harness.emitVault('rename', file, oldPath);
  await settleAsyncWork();

  assert.deepEqual(leaf.getViewState(), {
    type: 'tps-home',
    active: true,
    pinned: true,
    state: { dailyNotePath: nextPath, dateIso: '2026-08-10' },
  });
  assert.equal(leaf.setViewStateCalls.length, 1);
  assert.equal(harness.intervals.size, 0);
});

test('renaming a date-backed Home outside Daily Notes restores the renamed Markdown file', async (t) => {
  const originalPath = 'Daily Notes/2026-08-11.md';
  const leaf = createLeaf({
    state: {
      type: 'tps-home',
      pinned: true,
      state: { dailyNotePath: originalPath, dateIso: '2026-08-11' },
    },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const file = harness.files.get(originalPath);
  const nextPath = 'Inbox/Renamed daily note.md';
  const oldPath = harness.renameFile(file, nextPath, null);
  harness.emitVault('rename', file, oldPath);
  await settleAsyncWork();

  assert.deepEqual(leaf.getViewState(), {
    type: 'markdown',
    active: true,
    pinned: true,
    state: { file: nextPath, mode: 'preview' },
  });
  assert.equal(leaf.setViewStateCalls.length, 1);
  assert.equal(harness.intervals.size, 0);
});

test('cross-file path rotation keeps each Home leaf bound to its exact file identity', async (t) => {
  const firstPath = 'Daily Notes/2026-08-20.md';
  const secondPath = 'Daily Notes/2026-08-21.md';
  const firstLeaf = createLeaf({
    state: {
      type: 'tps-home',
      state: { dailyNotePath: firstPath, dateIso: '2026-08-20' },
    },
  });
  const secondLeaf = createLeaf({
    state: {
      type: 'tps-home',
      state: { dailyNotePath: secondPath, dateIso: '2026-08-21' },
    },
  });
  const blockerFile = new TestTFile('Daily Notes/2026-08-22.md');
  blockerFile.dailyNoteDate = '2026-08-22';
  const blockerLeaf = createLeaf({
    file: blockerFile,
    state: { type: 'markdown', state: { file: blockerFile.path, mode: 'preview' } },
    active: true,
  });
  const gate = blockerLeaf.deferNextSetViewState();
  const harness = createHarness({ leaves: [firstLeaf, secondLeaf, blockerLeaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await gate.started;

  const firstFile = harness.files.get(firstPath);
  const secondFile = harness.files.get(secondPath);
  let oldPath = harness.renameFile(firstFile, 'Daily Notes/first-intermediate.md', '2026-08-23');
  harness.emitVault('rename', firstFile, oldPath);
  oldPath = harness.renameFile(secondFile, firstPath, '2026-08-20');
  harness.emitVault('rename', secondFile, oldPath);
  oldPath = harness.renameFile(firstFile, secondPath, '2026-08-21');
  harness.emitVault('rename', firstFile, oldPath);

  gate.release();
  await settleAsyncWork();

  assert.equal(firstLeaf.getViewState().state.dailyNotePath, secondPath);
  assert.equal(secondLeaf.getViewState().state.dailyNotePath, firstPath);
  assert.equal(firstLeaf.setViewStateCalls.length, 1);
  assert.equal(secondLeaf.setViewStateCalls.length, 1);
});

test('a transient rename transition failure retries once without polling or losing intent', async (t) => {
  const originalPath = 'Daily Notes/2026-08-23.md';
  const leaf = createLeaf({
    state: {
      type: 'tps-home',
      state: { dailyNotePath: originalPath, dateIso: '2026-08-23' },
    },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  leaf.rejectNextSetViewState();
  const file = harness.files.get(originalPath);
  const nextPath = 'Daily Notes/2026-08-24.md';
  const oldPath = harness.renameFile(file, nextPath, '2026-08-24');
  harness.emitVault('rename', file, oldPath);
  await settleAsyncWork();

  assert.equal(leaf.setViewStateCalls.length, 2);
  assert.equal(leaf.getViewState().state.dailyNotePath, nextPath);
  assert.equal(harness.intervals.size, 0);
});

test('a transient native-view open failure retains exact rename intent for one retry', async (t) => {
  const originalPath = 'Daily Notes/2026-08-25.md';
  const leaf = createLeaf({
    state: {
      type: 'tps-home',
      state: { dailyNotePath: originalPath, dateIso: '2026-08-25' },
    },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  leaf.rejectNextOpenFile();
  const file = harness.files.get(originalPath);
  const nextPath = 'Boards/Renamed.canvas';
  const oldPath = harness.renameFile(file, nextPath, null);
  harness.emitVault('rename', file, oldPath);
  await settleAsyncWork();

  assert.equal(leaf.openFileCalls.length, 2);
  assert.equal(leaf.getViewState().type, 'canvas');
  assert.equal(leaf.getViewState().state.file, nextPath);
});

test('startup-disabled restoration tracks a rename before layout-ready and then removes its listener', async (t) => {
  const originalPath = 'Daily Notes/2026-08-26.md';
  const leaf = createLeaf({
    state: {
      type: 'tps-home',
      state: { dailyNotePath: originalPath, dateIso: '2026-08-26' },
    },
    active: true,
  });
  const harness = createHarness({ enableDailyNoteHome: false, leaves: [leaf], layoutReady: false });
  t.after(() => harness.dispose());
  harness.service.load();

  assert.equal(harness.vaultListenerCount('rename'), 1);
  const file = harness.files.get(originalPath);
  const nextPath = 'Daily Notes/2026-08-27.md';
  const oldPath = harness.renameFile(file, nextPath, '2026-08-27');
  harness.emitVault('rename', file, oldPath);
  await settleAsyncWork();
  assert.equal(leaf.setViewStateCalls.length, 0, 'pre-layout rename capture must not mutate a leaf');

  harness.fireLayoutReady();
  await settleAsyncWork();
  assert.deepEqual(leaf.getViewState(), {
    type: 'markdown',
    active: true,
    state: { file: nextPath, mode: 'preview' },
  });
  assert.equal(harness.totalVaultListeners(), 0);
});

test('startup rename records bind a Home leaf materialized only after the rename event', async (t) => {
  const harness = createHarness({ enableDailyNoteHome: false, layoutReady: false });
  t.after(() => harness.dispose());
  const file = harness.addFile(new TestTFile('Daily Notes/2026-09-22.md'));
  file.dailyNoteDate = '2026-09-22';
  harness.service.load();

  const originalPath = file.path;
  const nextPath = 'Daily Notes/2026-09-23.md';
  const oldPath = harness.renameFile(file, nextPath, '2026-09-23');
  harness.emitVault('rename', file, oldPath);
  const lateLeaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: originalPath, dateIso: '2026-09-22' } },
    active: true,
  });
  harness.addLeaf(lateLeaf, { registerFile: false });
  await settleAsyncWork();
  assert.equal(lateLeaf.setViewStateCalls.length, 0);

  harness.fireLayoutReady();
  await settleAsyncWork();
  assert.deepEqual(lateLeaf.getViewState(), {
    type: 'markdown',
    active: true,
    state: { file: nextPath, mode: 'preview' },
  });
  assert.equal(harness.totalVaultListeners(), 0);
});

test('deleting the exact file behind an open Home makes it standalone and never blocks disabling', async (t) => {
  const dailyPath = 'Daily Notes/2026-09-24.md';
  const leaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: dailyPath, dateIso: '2026-09-24' } },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const file = harness.files.get(dailyPath);
  harness.deleteFile(file);
  harness.emitVault('delete', file);
  await settleAsyncWork();

  assert.deepEqual(leaf.getViewState(), {
    type: 'tps-home',
    active: true,
    state: {},
  });
  assert.equal(await harness.service.setEnabled(false), true);
  assert.equal(leaf.getViewState().type, 'tps-home', 'standalone Home remains available while substitution is off');
  assert.equal(harness.totalVaultListeners(), 0);
});

test('a pre-layout delete is replayed for a Home leaf materialized after the event', async (t) => {
  const dailyPath = 'Daily Notes/2026-09-25.md';
  const harness = createHarness({ layoutReady: false });
  t.after(() => harness.dispose());
  const file = harness.addFile(new TestTFile(dailyPath));
  file.dailyNoteDate = '2026-09-25';
  harness.service.load();

  harness.deleteFile(file);
  harness.emitVault('delete', file);
  const lateLeaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: dailyPath, dateIso: '2026-09-25' } },
    active: true,
  });
  harness.addLeaf(lateLeaf, { registerFile: false });
  harness.fireLayoutReady();
  await settleAsyncWork();

  assert.deepEqual(lateLeaf.getViewState(), {
    type: 'tps-home',
    active: true,
    state: {},
  });
  assert.equal(await harness.service.setEnabled(false), true);
});

test('startup folder rename records never bind a path-reused replacement file', async (t) => {
  const originalPath = 'Daily Notes/2026-09-26.md';
  const renamedPath = 'Moved Daily Notes/2026-09-26.md';
  const harness = createHarness({ layoutReady: false });
  t.after(() => harness.dispose());
  const originalFile = harness.addFile(new TestTFile(originalPath));
  originalFile.dailyNoteDate = '2026-09-26';
  harness.service.load();

  const folder = new TestTFolder('Daily Notes');
  const oldPath = harness.renameFolder(folder, 'Moved Daily Notes');
  harness.emitVault('rename', folder, oldPath);
  harness.deleteFile(originalFile);
  harness.emitVault('delete', originalFile);
  const replacement = harness.addFile(new TestTFile(renamedPath));
  replacement.dailyNoteDate = '2026-09-26';
  const lateLeaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: originalPath, dateIso: '2026-09-26' } },
    active: true,
  });
  harness.addLeaf(lateLeaf, { registerFile: false });

  harness.fireLayoutReady();
  await settleAsyncWork();
  assert.deepEqual(lateLeaf.getViewState(), {
    type: 'tps-home',
    active: true,
    state: {},
  });
  assert.notEqual(lateLeaf.getViewState().state.dailyNotePath, replacement.path);
});

test('enabled startup restores a persisted Home whose file no longer qualifies as a Daily Note', async (t) => {
  const formerDailyPath = 'Archive/Former Daily Note.md';
  const leaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: formerDailyPath, dateIso: '2026-09-27' } },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.files.get(formerDailyPath).dailyNoteDate = null;
  harness.service.load();
  await settleAsyncWork();

  assert.deepEqual(leaf.getViewState(), {
    type: 'markdown',
    active: true,
    state: { file: formerDailyPath, mode: 'preview' },
  });
});

test('cold-start missing Home paths stay unresolved while enabled but become standalone when disabled', async (t) => {
  const missingPath = 'Daily Notes/2026-09-28.md';
  const leaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: missingPath, dateIso: '2026-09-28' } },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.deleteFile(harness.files.get(missingPath));
  harness.service.load();
  await settleAsyncWork();

  assert.equal(leaf.getViewState().state.dailyNotePath, missingPath, 'enabled startup preserves a possibly delayed sync path');
  assert.equal(await harness.service.setEnabled(false), true);
  assert.deepEqual(leaf.getViewState(), {
    type: 'tps-home',
    active: true,
    state: {},
  });
});

test('a supported create event rebinds an unresolved Home when its exact Daily Note arrives', async (t) => {
  const delayedPath = 'Daily Notes/2026-10-01.md';
  const leaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: delayedPath, dateIso: '2026-10-01' } },
    active: true,
  });
  const harness = createHarness({ layoutReady: true });
  t.after(() => harness.dispose());
  harness.addLeaf(leaf, { registerFile: false });
  harness.service.load();
  await settleAsyncWork();
  assert.equal(leaf.view.isDailyNoteBacked(), false);
  assert.equal(leaf.setViewStateCalls.length, 0);

  const delayedFile = harness.addFile(new TestTFile(delayedPath));
  delayedFile.dailyNoteDate = '2026-10-01';
  harness.emitVault('create', delayedFile);
  await settleAsyncWork();

  assert.equal(leaf.view.isDailyNoteBacked(), true);
  assert.equal(leaf.setViewStateCalls.length, 1);
  assert.equal(leaf.getViewState().state.dailyNotePath, delayedPath);
});

test('enabled startup opens a persisted non-Markdown Home backing file in its native view', async (t) => {
  const canvasPath = 'Daily Notes/2026-09-29.canvas';
  const leaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: canvasPath, dateIso: '2026-09-29' } },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  assert.equal(leaf.getViewState().type, 'canvas');
  assert.equal(leaf.getViewState().state.file, canvasPath);
  assert.equal(leaf.openFileCalls.length, 1);
});

test('disabled startup also resolves a persisted non-Markdown Home through its native view', async (t) => {
  const canvasPath = 'Daily Notes/2026-09-30.canvas';
  const leaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: canvasPath, dateIso: '2026-09-30' } },
    active: true,
  });
  const harness = createHarness({ enableDailyNoteHome: false, leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  assert.equal(leaf.getViewState().type, 'canvas');
  assert.equal(leaf.getViewState().state.file, canvasPath);
  assert.equal(harness.totalVaultListeners(), 0);
});

test('folder rename updates exact Home descendants and ignores similarly prefixed siblings', async (t) => {
  const dailyPath = 'Daily Notes/2026-08-28.md';
  const siblingPath = 'Daily Notes Extra/2026-08-29.md';
  const dailyLeaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: dailyPath, dateIso: '2026-08-28' } },
    active: true,
  });
  const siblingLeaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: siblingPath, dateIso: '2026-08-29' } },
  });
  const harness = createHarness({ leaves: [dailyLeaf, siblingLeaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const folder = new TestTFolder('Daily Notes');
  const oldPath = harness.renameFolder(folder, 'Archive/Daily Notes');
  harness.emitVault('rename', folder, oldPath);
  await settleAsyncWork();

  assert.equal(dailyLeaf.getViewState().state.dailyNotePath, 'Archive/Daily Notes/2026-08-28.md');
  assert.equal(siblingLeaf.getViewState().state.dailyNotePath, siblingPath);
  assert.equal(siblingLeaf.setViewStateCalls.length, 0);
});

test('a second rename revision arriving during the first update reaches the latest path', async (t) => {
  const originalPath = 'Daily Notes/2026-08-30.md';
  const leaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: originalPath, dateIso: '2026-08-30' } },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const gate = leaf.deferNextSetViewState();
  const file = harness.files.get(originalPath);
  let oldPath = harness.renameFile(file, 'Daily Notes/2026-08-31.md', '2026-08-31');
  harness.emitVault('rename', file, oldPath);
  await gate.started;
  oldPath = harness.renameFile(file, 'Daily Notes/2026-09-01.md', '2026-09-01');
  harness.emitVault('rename', file, oldPath);
  gate.release();
  await settleAsyncWork();

  assert.deepEqual(leaf.setViewStateCalls.map((state) => state.state.dailyNotePath), [
    'Daily Notes/2026-08-31.md',
    'Daily Notes/2026-09-01.md',
  ]);
  assert.equal(leaf.getViewState().state.dailyNotePath, 'Daily Notes/2026-09-01.md');
});

test('a failed in-flight update retains a newer rename revision from either source state', async (t) => {
  const originalPath = 'Daily Notes/2026-09-08.md';
  const leaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: originalPath, dateIso: '2026-09-08' } },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const gate = leaf.deferNextSetViewState();
  leaf.rejectNextSetViewState();
  const file = harness.files.get(originalPath);
  let oldPath = harness.renameFile(file, 'Daily Notes/2026-09-09.md', '2026-09-09');
  harness.emitVault('rename', file, oldPath);
  await gate.started;
  oldPath = harness.renameFile(file, 'Daily Notes/2026-09-10.md', '2026-09-10');
  harness.emitVault('rename', file, oldPath);
  gate.release();
  await settleAsyncWork();

  assert.deepEqual(leaf.setViewStateCalls.map((state) => state.state.dailyNotePath), [
    'Daily Notes/2026-09-09.md',
    'Daily Notes/2026-09-10.md',
  ]);
  assert.equal(leaf.getViewState().state.dailyNotePath, 'Daily Notes/2026-09-10.md');
});

test('a failed disabled restoration still follows a rename that arrived in flight', async (t) => {
  const originalPath = 'Daily Notes/2026-09-11.md';
  const leaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: originalPath, dateIso: '2026-09-11' } },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const gate = leaf.deferNextSetViewState();
  leaf.rejectNextSetViewState();
  const disabling = harness.service.setEnabled(false);
  await gate.started;
  const file = harness.files.get(originalPath);
  const nextPath = 'Daily Notes/2026-09-12.md';
  const oldPath = harness.renameFile(file, nextPath, '2026-09-12');
  harness.emitVault('rename', file, oldPath);
  gate.release();
  await disabling;
  await settleAsyncWork();

  assert.deepEqual(leaf.setViewStateCalls.map((state) => state.state.file), [originalPath, nextPath]);
  assert.deepEqual(leaf.getViewState(), {
    type: 'markdown',
    active: true,
    state: { file: nextPath, mode: 'preview' },
  });
  assert.equal(harness.totalVaultListeners(), 0);
});

test('a newer rename after user navigation cannot bind that destination to the old file', async (t) => {
  const originalPath = 'Daily Notes/2026-09-13.md';
  const leaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: originalPath, dateIso: '2026-09-13' } },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  const userFile = harness.addFile(new TestTFile('Inbox/User destination.md'));
  harness.service.load();
  await settleAsyncWork();

  const gate = leaf.deferNextSetViewState();
  leaf.rejectNextSetViewState();
  const renamedFile = harness.files.get(originalPath);
  let oldPath = harness.renameFile(renamedFile, 'Daily Notes/2026-09-14.md', '2026-09-14');
  harness.emitVault('rename', renamedFile, oldPath);
  await gate.started;
  leaf.navigateToState({ type: 'markdown', state: { file: userFile.path, mode: 'source' } });
  oldPath = harness.renameFile(renamedFile, 'Daily Notes/2026-09-15.md', '2026-09-15');
  harness.emitVault('rename', renamedFile, oldPath);
  gate.release();
  await settleAsyncWork();

  assert.deepEqual(leaf.getViewState(), {
    type: 'markdown',
    state: { file: userFile.path, mode: 'source' },
  });
  assert.equal(leaf.setViewStateCalls.length, 1);
});

test('a stale binding is replaced only by the current live file at the same path', async (t) => {
  const originalPath = 'Daily Notes/2026-09-16.md';
  const leaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: originalPath, dateIso: '2026-09-16' } },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const replacement = new TestTFile(originalPath);
  replacement.dailyNoteDate = '2026-09-16';
  harness.replaceFileAtPath(originalPath, replacement);
  const nextPath = 'Daily Notes/2026-09-17.md';
  const oldPath = harness.renameFile(replacement, nextPath, '2026-09-17');
  harness.emitVault('rename', replacement, oldPath);
  await settleAsyncWork();

  assert.equal(leaf.getViewState().state.dailyNotePath, nextPath);
  assert.equal(leaf.getViewState().state.dateIso, '2026-09-17');
});

test('retry exhaustion is surfaced and a repeated disable can recover cleanly', async (t) => {
  const originalPath = 'Daily Notes/2026-09-18.md';
  const leaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: originalPath, dateIso: '2026-09-18' } },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  leaf.rejectNextSetViewStates(2);
  assert.equal(await harness.service.setEnabled(false), false);
  assert.equal(leaf.getViewState().type, 'tps-home');
  assert.equal(harness.totalVaultListeners(), 0);

  assert.equal(await harness.service.setEnabled(false), true);
  assert.equal(leaf.getViewState().type, 'markdown');
  assert.equal(harness.service.pendingHomeLeafRenames.size, 0);
  assert.equal(harness.totalVaultListeners(), 0);
});

test('closed leaves are pruned from retained rename work before later events', async (t) => {
  const originalPath = 'Daily Notes/2026-09-19.md';
  const leaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: originalPath, dateIso: '2026-09-19' } },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  leaf.rejectNextSetViewStates(2);
  const file = harness.files.get(originalPath);
  let oldPath = harness.renameFile(file, 'Daily Notes/2026-09-20.md', '2026-09-20');
  harness.emitVault('rename', file, oldPath);
  await settleAsyncWork();
  assert.equal(leaf.setViewStateCalls.length, 2);

  harness.removeLeaf(leaf);
  oldPath = harness.renameFile(file, 'Daily Notes/2026-09-21.md', '2026-09-21');
  harness.emitVault('rename', file, oldPath);
  await settleAsyncWork();
  assert.equal(leaf.setViewStateCalls.length, 2, 'detached leaves must never receive retained mutations');
});

test('conversion snapshots recheck that each later leaf is still open before mutation', async (t) => {
  const firstFile = new TestTFile('Daily Notes/2026-10-02.md');
  firstFile.dailyNoteDate = '2026-10-02';
  const secondFile = new TestTFile('Daily Notes/2026-10-03.md');
  secondFile.dailyNoteDate = '2026-10-03';
  const firstLeaf = createLeaf({
    file: firstFile,
    state: { type: 'markdown', state: { file: firstFile.path, mode: 'preview' } },
    active: true,
  });
  const secondLeaf = createLeaf({
    file: secondFile,
    state: { type: 'markdown', state: { file: secondFile.path, mode: 'preview' } },
  });
  const gate = firstLeaf.deferNextSetViewState();
  const harness = createHarness({ leaves: [firstLeaf, secondLeaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await gate.started;
  harness.removeLeaf(secondLeaf);
  gate.release();
  await settleAsyncWork();

  assert.equal(firstLeaf.getViewState().type, 'tps-home');
  assert.equal(secondLeaf.setViewStateCalls.length, 0);
});

test('rename snapshots recheck that each later leaf is still open before mutation', async (t) => {
  const firstPath = 'Daily Notes/2026-10-04.md';
  const secondPath = 'Daily Notes/2026-10-05.md';
  const firstLeaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: firstPath, dateIso: '2026-10-04' } },
    active: true,
  });
  const secondLeaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: secondPath, dateIso: '2026-10-05' } },
  });
  const harness = createHarness({ leaves: [firstLeaf, secondLeaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const gate = firstLeaf.deferNextSetViewState();
  const folder = new TestTFolder('Daily Notes');
  const oldPath = harness.renameFolder(folder, 'Moved Daily Notes');
  harness.emitVault('rename', folder, oldPath);
  await gate.started;
  harness.removeLeaf(secondLeaf);
  gate.release();
  await settleAsyncWork();

  assert.equal(firstLeaf.getViewState().state.dailyNotePath, 'Moved Daily Notes/2026-10-04.md');
  assert.equal(secondLeaf.setViewStateCalls.length, 0);
});

test('restoration snapshots recheck that each later leaf is still open before mutation', async (t) => {
  const firstPath = 'Daily Notes/2026-10-06.md';
  const secondPath = 'Daily Notes/2026-10-07.md';
  const firstLeaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: firstPath, dateIso: '2026-10-06' } },
    active: true,
  });
  const secondLeaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: secondPath, dateIso: '2026-10-07' } },
  });
  const harness = createHarness({ leaves: [firstLeaf, secondLeaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const gate = firstLeaf.deferNextSetViewState();
  const disabling = harness.service.setEnabled(false);
  await gate.started;
  harness.removeLeaf(secondLeaf);
  gate.release();
  assert.equal(await disabling, true);
  await settleAsyncWork();

  assert.equal(firstLeaf.getViewState().type, 'markdown');
  assert.equal(secondLeaf.setViewStateCalls.length, 0);
});

test('rename reconciliation revalidates later leaves after earlier async work', async (t) => {
  const firstPath = 'Daily Notes/2026-09-02.md';
  const secondPath = 'Daily Notes/2026-09-03.md';
  const firstLeaf = createLeaf({ state: { type: 'tps-home', state: { dailyNotePath: firstPath, dateIso: '2026-09-02' } } });
  const secondLeaf = createLeaf({ state: { type: 'tps-home', state: { dailyNotePath: secondPath, dateIso: '2026-09-03' } } });
  const harness = createHarness({ leaves: [firstLeaf, secondLeaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const gate = firstLeaf.deferNextSetViewState();
  const folder = new TestTFolder('Daily Notes');
  const oldPath = harness.renameFolder(folder, 'Moved Daily Notes');
  harness.emitVault('rename', folder, oldPath);
  await gate.started;

  secondLeaf.navigateToState({ type: 'markdown', state: { file: 'Inbox/User choice.md', mode: 'source' } });
  gate.release();
  await settleAsyncWork();

  assert.equal(firstLeaf.getViewState().state.dailyNotePath, 'Moved Daily Notes/2026-09-02.md');
  assert.deepEqual(secondLeaf.getViewState(), {
    type: 'markdown',
    state: { file: 'Inbox/User choice.md', mode: 'source' },
  });
  assert.equal(secondLeaf.setViewStateCalls.length, 0);
});

test('conversion and disabled restoration revalidate each leaf immediately before mutation', async (t) => {
  const firstFile = new TestTFile('Daily Notes/2026-09-04.md');
  firstFile.dailyNoteDate = '2026-09-04';
  const secondFile = new TestTFile('Daily Notes/2026-09-05.md');
  secondFile.dailyNoteDate = '2026-09-05';
  const firstLeaf = createLeaf({
    file: firstFile,
    state: { type: 'markdown', state: { file: firstFile.path, mode: 'preview' } },
    active: true,
  });
  const secondLeaf = createLeaf({
    file: secondFile,
    state: { type: 'markdown', state: { file: secondFile.path, mode: 'preview' } },
  });
  const gate = firstLeaf.deferNextSetViewState();
  const conversion = createHarness({ leaves: [firstLeaf, secondLeaf], layoutReady: true });
  t.after(() => conversion.dispose());
  conversion.service.load();
  await gate.started;
  secondLeaf.navigateToState({ type: 'markdown', state: { file: secondFile.path, mode: 'source' } });
  gate.release();
  await settleAsyncWork();
  assert.equal(firstLeaf.getViewState().type, 'tps-home');
  assert.equal(secondLeaf.getViewState().type, 'markdown');
  assert.equal(secondLeaf.getViewState().state.mode, 'source');
  assert.equal(secondLeaf.setViewStateCalls.length, 0);

  conversion.dispose();

  const restoreOnePath = 'Daily Notes/2026-09-06.md';
  const restoreTwoPath = 'Daily Notes/2026-09-07.md';
  const restoreOne = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: restoreOnePath, dateIso: '2026-09-06' } },
    active: true,
  });
  const restoreTwo = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: restoreTwoPath, dateIso: '2026-09-07' } },
  });
  const restoration = createHarness({ leaves: [restoreOne, restoreTwo], layoutReady: true });
  t.after(() => restoration.dispose());
  restoration.service.load();
  await settleAsyncWork();
  const restoreGate = restoreOne.deferNextSetViewState();
  const disabling = restoration.service.setEnabled(false);
  await restoreGate.started;
  restoreTwo.navigateToState({ type: 'markdown', state: { file: 'Inbox/User restore choice.md', mode: 'source' } });
  restoreGate.release();
  await disabling;
  await settleAsyncWork();

  assert.equal(restoreOne.getViewState().type, 'markdown');
  assert.deepEqual(restoreTwo.getViewState(), {
    type: 'markdown',
    state: { file: 'Inbox/User restore choice.md', mode: 'source' },
  });
  assert.equal(restoreTwo.setViewStateCalls.length, 0);
});

test('a rename during in-flight conversion reconciles the final Home state', async (t) => {
  const file = new TestTFile('Daily Notes/2026-08-12.md');
  file.dailyNoteDate = '2026-08-12';
  const leaf = createLeaf({
    file,
    state: { type: 'markdown', state: { file: file.path, mode: 'preview' } },
    active: true,
  });
  const gate = leaf.deferNextSetViewState();
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await gate.started;

  const nextPath = 'Daily Notes/2026-08-13.md';
  const oldPath = harness.renameFile(file, nextPath, '2026-08-13');
  harness.emitVault('rename', file, oldPath);
  gate.release();
  await settleAsyncWork();

  assert.deepEqual(leaf.setViewStateCalls.map((state) => state.type), ['tps-home', 'tps-home']);
  assert.deepEqual(leaf.getViewState(), {
    type: 'tps-home',
    active: true,
    state: { dailyNotePath: nextPath, dateIso: '2026-08-13' },
  });
  assert.equal(harness.intervals.size, 0);
});

test('disable during an in-flight Home rename restores the same file at its latest path', async (t) => {
  const originalPath = 'Daily Notes/2026-08-14.md';
  const leaf = createLeaf({
    state: {
      type: 'tps-home',
      pinned: true,
      state: { dailyNotePath: originalPath, dateIso: '2026-08-14' },
    },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const file = harness.files.get(originalPath);
  const firstGate = leaf.deferNextSetViewState();
  const intermediatePath = 'Daily Notes/2026-08-15.md';
  const firstOldPath = harness.renameFile(file, intermediatePath, '2026-08-15');
  harness.emitVault('rename', file, firstOldPath);
  await firstGate.started;

  const disabling = harness.service.setEnabled(false);
  const finalPath = 'Inbox/Renamed during disable.md';
  const secondOldPath = harness.renameFile(file, finalPath, null);
  harness.emitVault('rename', file, secondOldPath);
  firstGate.release();
  await disabling;
  await settleAsyncWork();

  assert.deepEqual(leaf.setViewStateCalls.map((state) => state.type), ['tps-home', 'markdown']);
  assert.deepEqual(leaf.getViewState(), {
    type: 'markdown',
    active: true,
    pinned: true,
    state: { file: finalPath, mode: 'preview' },
  });
  assert.equal(harness.totalVaultListeners(), 0);
  assert.equal(harness.intervals.size, 0);
});

test('scope disposal cancels pending debounce work and stale layout-ready callbacks', async (t) => {
  const harness = createHarness({ enableDailyNoteHome: false, layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  await harness.service.setEnabled(true);
  harness.emitWorkspace('layout-change');
  assert.equal(harness.timeouts.size, 1);
  await harness.service.setEnabled(false);
  assert.equal(harness.timeouts.size, 0, 'removing the runtime scope should cancel its debouncer');
  assert.equal(harness.totalVaultListeners(), 0);
  harness.dispose();

  const staleLayout = createHarness();
  t.after(() => staleLayout.dispose());
  staleLayout.service.load();
  const disabling = staleLayout.service.setEnabled(false);
  assert.equal(staleLayout.layoutReadyRegistrationCount(), 2);
  staleLayout.fireLayoutReady();
  await disabling;
  await settleAsyncWork();

  assert.equal(staleLayout.service.isEnabled(), false);
  assert.equal(staleLayout.timeouts.size, 0);
  assert.equal(staleLayout.totalWorkspaceListeners(), 0);
  assert.equal(staleLayout.totalVaultListeners(), 0);
  assert.equal(staleLayout.intervals.size, 0);
});

test('service unload compensates an in-flight Home conversion and rejects new lifecycle scopes', async (t) => {
  const file = new TestTFile('Daily Notes/2026-10-08.md');
  file.dailyNoteDate = '2026-10-08';
  const leaf = createLeaf({
    file,
    state: { type: 'markdown', state: { file: file.path, mode: 'preview' } },
    active: true,
  });
  const gate = leaf.deferNextSetViewState();
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await gate.started;

  harness.service.unload();
  gate.release();
  await settleAsyncWork();

  assert.deepEqual(leaf.setViewStateCalls.map((state) => state.type), ['tps-home', 'markdown']);
  assert.equal(leaf.getViewState().type, 'markdown');
  assert.equal(await harness.service.setEnabled(true), false);
  assert.equal(harness.totalWorkspaceListeners(), 0);
  assert.equal(harness.totalVaultListeners(), 0);
});

test('service unload also compensates a conversion that commits Home before rejecting', async (t) => {
  const file = new TestTFile('Daily Notes/2026-10-09.md');
  file.dailyNoteDate = '2026-10-09';
  const leaf = createLeaf({
    file,
    state: { type: 'markdown', state: { file: file.path, mode: 'preview' } },
    active: true,
  });
  const gate = leaf.deferNextSetViewState();
  leaf.rejectNextSetViewStateAfterCommit();
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await gate.started;

  harness.service.unload();
  gate.release();
  await settleAsyncWork();

  assert.deepEqual(leaf.setViewStateCalls.map((state) => state.type), ['tps-home', 'markdown']);
  assert.equal(leaf.getViewState().type, 'markdown');
  assert.equal(harness.totalVaultListeners(), 0);
});

test('service unload compensates a rejected in-flight disabled restoration', async (t) => {
  const dailyPath = 'Daily Notes/2026-10-10.md';
  const leaf = createLeaf({
    state: { type: 'tps-home', state: { dailyNotePath: dailyPath, dateIso: '2026-10-10' } },
    active: true,
  });
  const harness = createHarness({ leaves: [leaf], layoutReady: true });
  t.after(() => harness.dispose());
  harness.service.load();
  await settleAsyncWork();

  const gate = leaf.deferNextSetViewState();
  leaf.rejectNextSetViewState();
  const disabling = harness.service.setEnabled(false);
  await gate.started;
  harness.service.unload();
  gate.release();
  await disabling;
  await settleAsyncWork();

  assert.deepEqual(leaf.setViewStateCalls.map((state) => state.type), ['markdown', 'markdown']);
  assert.equal(leaf.getViewState().type, 'markdown');
  assert.equal(harness.totalVaultListeners(), 0);
});
