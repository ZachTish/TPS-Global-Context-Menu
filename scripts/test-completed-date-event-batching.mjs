import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function loadRegisterEvents() {
  const build = await esbuild.build({
    entryPoints: [
      fileURLToPath(new URL('../src/events/register-events.ts', import.meta.url)),
    ],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'gcm-event-batching-test-stubs',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({
          path: 'obsidian',
          namespace: 'gcm-event-batching-test-stub',
        }));
        builder.onResolve({
          filter: /^\.\.\/(handlers\/parent-link-format|services\/view-mode-service|modals\/remove-hidden-subitems-modal|services\/unresolved-subitem-modal|logger|utils\/completed-date-utils|handlers\/checklist-handler)$/,
        }, (args) => ({
          path: args.path,
          namespace: 'gcm-event-batching-test-stub',
        }));
        builder.onLoad(
          { filter: /.*/, namespace: 'gcm-event-batching-test-stub' },
          (args) => {
            if (args.path === 'obsidian') {
              return {
                loader: 'js',
                contents: `
                  export class TFile {
                    constructor(path, frontmatter = {}) {
                      this.path = path;
                      this.extension = path.split('.').pop() || '';
                      this.basename = path.split('/').pop().replace(/\\.[^.]+$/, '');
                      this.frontmatter = frontmatter;
                    }
                  }
                  export class TFolder {
                    constructor(path) {
                      this.path = path;
                      this.name = path.split('/').pop() || '';
                    }
                  }
                  export class Notice {
                    constructor() {}
                  }
                  globalThis.__GcmEventBatchingTestTFile = TFile;
                  export class MarkdownView {}
                  export class WorkspaceLeaf {}
                  export const Platform = { isMobile: false };
                  export function normalizePath(value) {
                    return String(value ?? '')
                      .replace(/\\\\/g, '/')
                      .replace(/\\/{2,}/g, '/')
                      .replace(/^\\.\\//, '');
                  }
                  export function moment(value) {
                    return {
                      isValid() { return false; },
                      format() { return String(value ?? ''); },
                    };
                  }
                  export function debounce(callback, wait, immediate) {
                    let timer = null;
                    return function (...args) {
                      const callNow = immediate && timer === null;
                      if (timer !== null) window.clearTimeout(timer);
                      timer = window.setTimeout(() => {
                        timer = null;
                        if (!immediate) callback.apply(this, args);
                      }, wait);
                      if (callNow) callback.apply(this, args);
                    };
                  }
                `,
              };
            }
            if (args.path.endsWith('parent-link-format')) {
              return { loader: 'js', contents: 'export function resolveLinkValueToFile() { return null; }' };
            }
            if (args.path.endsWith('view-mode-service')) {
              return {
                loader: 'js',
                contents: 'export class ViewModeService { getRuleConditions() { return []; } normalizeMatch() { return \"all\"; } evaluateConditions() { return false; } }',
              };
            }
            if (args.path.endsWith('remove-hidden-subitems-modal')) {
              return { loader: 'js', contents: 'export class RemoveHiddenSubitemsModal { open() {} }' };
            }
            if (args.path.endsWith('unresolved-subitem-modal')) {
              return { loader: 'js', contents: 'export async function checkAndPromptForUnresolvedSubitems() {}' };
            }
            if (args.path === '../logger') {
              return {
                loader: 'js',
                contents: `
                  export function perf() {}
                  export function log() {}
                  export function warn() {}
                  export function error() {}
                  export function flowError() {}
                  export async function timeAsync(_name, _context, callback) { return await callback(); }
                `,
              };
            }
            if (args.path.endsWith('completed-date-utils')) {
              return {
                loader: 'js',
                contents: `
                  const findKey = (frontmatter) => Object.keys(frontmatter || {}).find((key) => key.toLowerCase() === 'completeddate');
                  export function getCompletedDateValue(frontmatter) {
                    const key = findKey(frontmatter);
                    if (!key) return '';
                    const source = Array.isArray(frontmatter[key]) ? frontmatter[key] : [frontmatter[key]];
                    return source.map((value) => String(value ?? '').trim()).filter(Boolean).at(-1) || '';
                  }
                  export function currentCompletedDateStamp() { return '2026-07-30T12:34:56'; }
                  export function setCompletedDateValue(frontmatter, stamp = '2026-07-30T12:34:56') {
                    const key = findKey(frontmatter) || 'completedDate';
                    const value = String(stamp || '').trim();
                    if (value) frontmatter[key] = value;
                  }
                `,
              };
            }
            return {
              loader: 'js',
              contents: `
                export class ChecklistHandler { async scanChecklistItems() { return []; } async handleChecklistCompletion() { return false; } }
                export function markChecklistCompletionPromptHandled() {}
                export function wasChecklistCompletionPromptRecentlyHandled() { return false; }
              `,
            };
          },
        );
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

const { registerGcmEvents } = await loadRegisterEvents();
const TFile = globalThis.__GcmEventBatchingTestTFile;

class FakeHtmlElement {}
globalThis.HTMLElement = FakeHtmlElement;
globalThis.document = { activeElement: null };

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createHarness({
  failedPaths = [],
  completionStatuses = ['complete', 'wont-do'],
  mutationGates = new Map(),
} = {}) {
  const listeners = new Map();
  const cleanups = [];
  const filesByPath = new Map();
  const cachedFrontmatterByFile = new Map();
  const mutations = [];
  const failures = new Set(failedPaths);
  const scaledSetTimeout = (callback, delay = 0) => setTimeout(callback, Math.max(1, Math.ceil(delay / 100)));
  const normalizeStatus = (value) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    return {
      done: 'complete',
      completed: 'complete',
      finished: 'complete',
      canceled: 'wont-do',
      cancelled: 'wont-do',
      skipped: 'wont-do',
    }[normalized] || normalized;
  };

  globalThis.window = {
    setTimeout: scaledSetTimeout,
    clearTimeout,
    setInterval() {
      return 1;
    },
    clearInterval() {},
  };

  const on = (scope) => (event, callback) => {
    const key = `${scope}:${event}`;
    const callbacks = listeners.get(key) || [];
    callbacks.push(callback);
    listeners.set(key, callbacks);
    return () => {};
  };
  const mutate = async (source, file, mutator) => {
    mutations.push({ source, path: file.path, file });
    if (source === 'service' && failures.has(file.path)) {
      throw new Error(`Synthetic mutation failure: ${file.path}`);
    }
    const gate = source === 'service' ? mutationGates.get(file.path) : null;
    if (gate) {
      gate.entered.resolve();
      await gate.release.promise;
    }
    const before = JSON.stringify(file.frontmatter);
    await mutator(file.frontmatter);
    return before !== JSON.stringify(file.frontmatter);
  };
  const noop = () => {};

  const plugin = {
    settings: {
      inlineMenuOnly: false,
      parentLinkFrontmatterKey: 'childOf',
      recurrenceCompletionStatuses: completionStatuses,
      checkOpenChecklistItems: false,
      subitems_IgnoreRules: [],
      enableAutoRename: false,
      autoSyncTitleFromFilename: false,
      enableAutoInsertBlankLineOnOpen: false,
    },
    viewModeSuppressedPaths: new Set(),
    registerEvent() {},
    register(cleanup) {
      cleanups.push(cleanup);
    },
    registerInterval() {},
    canRunBackgroundAutomation() {
      return true;
    },
    app: {
      workspace: {
        on: on('workspace'),
        activeLeaf: null,
        getActiveFile() {
          return null;
        },
      },
      metadataCache: {
        on: on('metadata'),
        getFileCache(file) {
          return { frontmatter: cachedFrontmatterByFile.get(file) || file.frontmatter };
        },
      },
      vault: {
        on: on('vault'),
        getFileByPath(path) {
          return filesByPath.get(path) || null;
        },
        async read() {
          return '';
        },
        async modify() {},
      },
      fileManager: {
        processFrontMatter: (file, mutator) => mutate('native', file, mutator),
      },
    },
    frontmatterMutationService: {
      process: (file, mutator) => mutate('service', file, mutator),
    },
    filePropertiesService: {
      isCompanionFile: () => false,
      isCompanionRename: () => false,
      isPropertyTarget: () => false,
      captureSourceRenameCompanion: () => null,
      handlePendingMarkdownTargetRename: async () => {},
      handleCompanionRename: async () => {},
      handleSourceRename: async () => null,
      handleSourceFolderRename: async () => ({ matched: 0, moved: 0, updated: 0, orphaned: 0, conflicts: [] }),
      handleSourceFolderDelete: async () => ({ matched: 0, moved: 0, updated: 0, orphaned: 0, conflicts: [] }),
      handleSourceCreate: async () => {},
      handleSourceDelete: async () => {},
      handleCompanionDelete: async () => {},
      handleCompanionMetadataChanged: async () => null,
      invalidatePendingMarkdownTarget: () => {},
      invalidateLegacyCanvas: () => {},
    },
    overlayRenderingService: {
      scheduleMenus: noop,
      scheduleSubitemRefresh: noop,
      scheduleFileRefresh: noop,
      invalidate: noop,
    },
    contextTargetService: {
      peekRecentContextTarget: () => null,
      resolveMarkdownNoteLinkTarget: () => null,
      isNativeMenuManagedTarget: () => false,
    },
    menuController: {
      panelBuilder: { clearFileTitleCache: noop },
      addToNativeMenu: noop,
      detach: noop,
      hideMenu: noop,
    },
    noteTitleRenderService: { clearTitleCache: noop },
    persistentMenuManager: {
      detach: noop,
      invalidateLinkedContextSourcePaths: noop,
    },
    notebookNavigatorRuleService: {
      shouldAutoApplyOnMetadataChange: () => false,
      shouldAutoApplyOnFileOpen: () => false,
      scheduleApply: noop,
      markUserEdited: noop,
      applyRulesToFile: async () => false,
    },
    taskCheckboxHandler: { scheduleChecklistPropertyUpdate: noop },
    sharedServices: {
      status: {
        getStatusPropertyKey: () => 'status',
        normalize: normalizeStatus,
        getDoneStatuses: () => {
          const configured = plugin.settings.recurrenceCompletionStatuses;
          const source = configured.length ? configured : ['complete', 'wont-do'];
          return Array.from(new Set(source.map(normalizeStatus).filter(Boolean)));
        },
      },
    },
    subitemRelationshipSyncService: {
      reconcileMarkdownParentText: async () => {},
      repairBrokenBodyLinksForParent: async () => 0,
      reconcileMarkdownParent: async () => {},
    },
    parentLinkResolutionService: { getParentsForChild: () => [] },
    linkedSubitemCheckboxService: { refreshReferencesForChild: async () => {} },
    fileNamingService: {
      shouldProcess: () => false,
      updateFilenameIfNeeded: async () => false,
      syncTitleFromFilename: async () => false,
      syncFileTimestamps: async () => false,
    },
    bodySubitemLinkService: { scanFile: async () => [] },
    bulkEditService: { cleanupLinksForDeletedFile: async () => 0 },
    eventService: {
      onFilesUpdated: () => noop,
      emitFilesUpdated: noop,
      emitDeleteComplete: noop,
    },
  };

  registerGcmEvents(plugin);

  return {
    plugin,
    mutations,
    addFile(path, frontmatter = {}) {
      const file = new TFile(path, frontmatter);
      filesByPath.set(path, file);
      return file;
    },
    replaceFile(path, frontmatter = {}) {
      const file = new TFile(path, frontmatter);
      filesByPath.set(path, file);
      return file;
    },
    renameFile(file, oldPath, newPath) {
      filesByPath.delete(oldPath);
      file.path = newPath;
      file.extension = newPath.split('.').pop() || '';
      filesByPath.set(newPath, file);
      for (const callback of listeners.get('vault:rename') || []) callback(file, oldPath);
    },
    deleteFile(file) {
      filesByPath.delete(file.path);
      for (const callback of listeners.get('vault:delete') || []) callback(file);
    },
    metadataChanged(file) {
      for (const callback of listeners.get('metadata:changed') || []) callback(file);
    },
    setCachedFrontmatter(file, frontmatter) {
      cachedFrontmatterByFile.set(file, frontmatter);
    },
    cleanup() {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

async function settleDebounces() {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

test('a metadata burst reconciles every distinct markdown file exactly once', async () => {
  const harness = createHarness();
  const files = Array.from({ length: 100 }, (_value, index) =>
    harness.addFile(`Inbox/file-${index}.md`, { status: 'complete' }));

  for (const file of files) harness.metadataChanged(file);
  await settleDebounces();

  assert.equal(harness.mutations.length, 100);
  assert.deepEqual(
    new Set(harness.mutations.map(({ path }) => path)),
    new Set(files.map(({ path }) => path)),
  );
  assert.ok(harness.mutations.every(({ source }) => source === 'service'));
  harness.cleanup();
});

test('repeated events for one file still coalesce into one mutation', async () => {
  const harness = createHarness();
  const file = harness.addFile('Inbox/repeated.md', { status: 'complete' });

  for (let index = 0; index < 100; index += 1) harness.metadataChanged(file);
  await settleDebounces();

  assert.equal(harness.mutations.length, 1);
  assert.equal(harness.mutations[0].file, file);
  harness.cleanup();
});

test('a queued path resolves the current live file before mutation', async () => {
  const harness = createHarness();
  const staleFile = harness.addFile('Inbox/replaced.md', { status: 'complete' });
  harness.metadataChanged(staleFile);
  const liveFile = harness.replaceFile('Inbox/replaced.md', { status: 'complete' });
  await settleDebounces();

  assert.equal(harness.mutations.length, 1);
  assert.equal(harness.mutations[0].file, liveFile);
  harness.cleanup();
});

test('rename migrates a queued path and delete removes queued work', async () => {
  const renameHarness = createHarness();
  const renamedFile = renameHarness.addFile('Inbox/old-name.md', { status: 'complete' });
  renameHarness.metadataChanged(renamedFile);
  renameHarness.renameFile(renamedFile, 'Inbox/old-name.md', 'Inbox/new-name.md');
  await settleDebounces();

  assert.deepEqual(renameHarness.mutations.map(({ path }) => path), ['Inbox/new-name.md']);
  renameHarness.cleanup();

  const deleteHarness = createHarness();
  const deletedFile = deleteHarness.addFile('Inbox/deleted.md', { status: 'complete' });
  deleteHarness.metadataChanged(deletedFile);
  deleteHarness.deleteFile(deletedFile);
  await settleDebounces();

  assert.equal(deleteHarness.mutations.length, 0);
  deleteHarness.cleanup();
});

test('plugin cleanup cancels pending completed-date work', async () => {
  const harness = createHarness();
  const file = harness.addFile('Inbox/unload.md', { status: 'complete' });
  harness.metadataChanged(file);
  harness.cleanup();
  await settleDebounces();

  assert.equal(harness.mutations.length, 0);
});

test('one failed mutation cannot prevent other queued files from reconciling', async () => {
  const harness = createHarness({ failedPaths: ['Inbox/bad.md'] });
  const files = [
    harness.addFile('Inbox/good-a.md', { status: 'complete' }),
    harness.addFile('Inbox/bad.md', { status: 'complete' }),
    harness.addFile('Inbox/good-b.md', { status: 'complete' }),
  ];
  for (const file of files) harness.metadataChanged(file);
  await settleDebounces();

  assert.deepEqual(
    harness.mutations.map(({ path }) => path),
    files.map(({ path }) => path),
  );
  assert.match(files[0].frontmatter.completedDate, /^2026-07-30T/);
  assert.equal(files[1].frontmatter.completedDate, undefined);
  assert.match(files[2].frontmatter.completedDate, /^2026-07-30T/);
  harness.cleanup();
});

test('a queued batch re-resolves rename, delete, and replacement state between slow mutations', async () => {
  const slowGate = { entered: deferred(), release: deferred() };
  const harness = createHarness({
    mutationGates: new Map([['Inbox/slow.md', slowGate]]),
  });
  const slowFile = harness.addFile('Inbox/slow.md', { status: 'complete' });
  const renamedFile = harness.addFile('Inbox/rename-before-turn.md', { status: 'complete' });
  const deletedFile = harness.addFile('Inbox/delete-before-turn.md', { status: 'complete' });
  const replacedFile = harness.addFile('Inbox/replace-before-turn.md', { status: 'complete' });

  harness.metadataChanged(slowFile);
  harness.metadataChanged(renamedFile);
  harness.metadataChanged(deletedFile);
  harness.metadataChanged(replacedFile);
  await slowGate.entered.promise;

  harness.renameFile(renamedFile, 'Inbox/rename-before-turn.md', 'Inbox/renamed-before-turn.md');
  harness.deleteFile(deletedFile);
  const liveReplacement = harness.replaceFile('Inbox/replace-before-turn.md', { status: 'complete' });
  slowGate.release.resolve();
  await settleDebounces();

  assert.deepEqual(
    harness.mutations.map(({ path }) => path),
    ['Inbox/slow.md', 'Inbox/renamed-before-turn.md', 'Inbox/replace-before-turn.md'],
  );
  assert.equal(harness.mutations[2].file, liveReplacement);
  assert.equal(deletedFile.frontmatter.completedDate, undefined);
  harness.cleanup();
});

test('separate timer batches never overlap their frontmatter mutations', async () => {
  const slowGate = { entered: deferred(), release: deferred() };
  const harness = createHarness({
    mutationGates: new Map([['Inbox/slow-batch-a.md', slowGate]]),
  });
  const batchA = harness.addFile('Inbox/slow-batch-a.md', { status: 'complete' });
  const batchB = harness.addFile('Inbox/batch-b.md', { status: 'complete' });

  harness.metadataChanged(batchA);
  await slowGate.entered.promise;
  harness.metadataChanged(batchB);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(harness.mutations.map(({ path }) => path), ['Inbox/slow-batch-a.md']);
  assert.equal(batchB.frontmatter.completedDate, undefined);

  slowGate.release.resolve();
  await settleDebounces();

  assert.deepEqual(
    harness.mutations.map(({ path }) => path),
    ['Inbox/slow-batch-a.md', 'Inbox/batch-b.md'],
  );
  assert.equal(batchB.frontmatter.completedDate, '2026-07-30T12:34:56');
  harness.cleanup();
});

test('live frontmatter is rechecked before a cached add or removal is applied', async () => {
  const harness = createHarness();
  const staleAdd = harness.addFile('Inbox/stale-add.md', { status: 'todo' });
  harness.setCachedFrontmatter(staleAdd, { status: 'complete' });
  const staleRemove = harness.addFile('Inbox/stale-remove.md', {
    status: 'complete',
    completedDate: '2026-07-29T10:00:00',
  });
  harness.setCachedFrontmatter(staleRemove, {
    status: 'todo',
    completedDate: '2026-07-29T10:00:00',
  });

  harness.metadataChanged(staleAdd);
  harness.metadataChanged(staleRemove);
  await settleDebounces();

  assert.equal(staleAdd.frontmatter.completedDate, undefined);
  assert.equal(staleRemove.frontmatter.completedDate, '2026-07-29T10:00:00');
  assert.ok(harness.mutations.every(({ source }) => source === 'service'));
  harness.cleanup();
});

test('configured completion aliases use the shared canonical status contract', async () => {
  const harness = createHarness({ completionStatuses: ['done'] });
  const file = harness.addFile('Inbox/done-alias.md', { status: 'done' });
  harness.metadataChanged(file);
  await settleDebounces();

  assert.equal(file.frontmatter.completedDate, '2026-07-30T12:34:56');
  assert.equal(harness.mutations.length, 1);
  assert.equal(harness.mutations[0].source, 'service');
  harness.cleanup();
});

test('completedDate set, normalize, remove, and preserve semantics remain unchanged', async () => {
  const harness = createHarness();
  const cases = [
    harness.addFile('Inbox/complete.md', { status: 'complete' }),
    harness.addFile('Inbox/wont-do.md', { status: 'wont-do', completedDate: ['2026-07-29T10:00:00', '2026-07-30T10:00:00'] }),
    harness.addFile('Inbox/reopened.md', { status: 'todo', completedDate: '2026-07-29T10:00:00' }),
    harness.addFile('Inbox/statusless.md', { completedDate: '2026-07-29T10:00:00' }),
    harness.addFile('Inbox/already-complete.md', { status: 'complete', completedDate: '2026-07-28T10:00:00' }),
  ];

  for (const file of cases) {
    harness.metadataChanged(file);
    await settleDebounces();
  }

  assert.equal(cases[0].frontmatter.completedDate, '2026-07-30T12:34:56');
  assert.equal(cases[1].frontmatter.completedDate, '2026-07-30T10:00:00');
  assert.equal(cases[2].frontmatter.completedDate, undefined);
  assert.equal(cases[3].frontmatter.completedDate, '2026-07-29T10:00:00');
  assert.equal(cases[4].frontmatter.completedDate, '2026-07-28T10:00:00');
  assert.equal(harness.mutations.length, 3);
  harness.cleanup();
});
