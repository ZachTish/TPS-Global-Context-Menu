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
          filter: /^\.\.\/(handlers\/parent-link-format|services\/view-mode-service|modals\/remove-hidden-subitems-modal|modals\/checklist-prompt-modal|services\/unresolved-subitem-modal|logger|utils\/completed-date-utils)$/,
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
                  globalThis.__GcmEventBatchingTestTFolder = TFolder;
                  export class MarkdownView {}
                  globalThis.__GcmEventMarkdownView = MarkdownView;
                  export class WorkspaceLeaf {}
                  export const Platform = { isMobile: false };
                  globalThis.__GcmEventPlatform = Platform;
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
            if (args.path.endsWith('checklist-prompt-modal')) {
              return {
                loader: 'js',
                contents: `export class ChecklistPromptModal {
                  constructor(app, items, resolve, allowLineMutation) {
                    this.app = app;
                    this.items = items;
                    this.resolve = resolve;
                    this.allowLineMutation = allowLineMutation;
                  }
                  open() {
                    this.app.checklistPrompts.push({ items: this.items, allowLineMutation: this.allowLineMutation });
                    this.resolve('cancel');
                  }
                }`,
              };
            }
            if (args.path.endsWith('unresolved-subitem-modal')) {
              return { loader: 'js', contents: 'export async function checkAndPromptForUnresolvedSubitems(plugin, file) { globalThis.__GcmUnresolvedChecks++; await plugin.app.vault.cachedRead(file); }' };
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
            throw new Error(`Unexpected event-batching test stub: ${args.path}`);
          },
        );
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

const { registerGcmEvents } = await loadRegisterEvents();
const TFile = globalThis.__GcmEventBatchingTestTFile;
const TFolder = globalThis.__GcmEventBatchingTestTFolder;

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
  enableLinkedSubitemCheckboxes = true,
  checkOpenChecklistItems = false,
  dataArchitectureMode,
  statusKey = 'status',
} = {}) {
  const listeners = new Map();
  const cleanups = [];
  const filesByPath = new Map();
  const cachedFrontmatterByFile = new Map();
  const mutations = [];
  const invalidations = [];
  let selectedBodyReads = 0;
  let rawBodyReads = 0;
  let linkedRefreshes = 0;
  const checklistPrompts = [];
  let filesUpdatedHandler = null;
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
      checkOpenChecklistItems,
      dataArchitectureMode,
      subitems_IgnoreRules: [],
      enableAutoRename: false,
      autoSyncTitleFromFilename: false,
      enableAutoInsertBlankLineOnOpen: false,
      enableLinkedSubitemCheckboxes,
    },
    registerEvent() {},
    register(cleanup) {
      cleanups.push(cleanup);
    },
    registerInterval() {},
    canRunBackgroundAutomation() {
      return true;
    },
    app: {
      checklistPrompts,
      workspace: {
        on: on('workspace'),
        onLayoutReady() {},
        activeLeaf: null,
        getActiveViewOfType() { return null; },
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
        async read(file) {
          rawBodyReads++;
          return file.body || '';
        },
        async cachedRead(file) {
          selectedBodyReads++;
          return file.body || '';
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
      hasCompanion: () => false,
      primeLegacyCanvasCache: async () => 0,
    },
    overlayRenderingService: {
      scheduleMenus: noop,
      scheduleSubitemRefresh: () => { linkedRefreshes++; },
      scheduleFileRefresh: noop,
      invalidate: (options) => { invalidations.push(options); },
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
    noteTitleRenderService: { handleMetadataChanged: noop },
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
        getStatusPropertyKey: () => statusKey,
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
    parentLinkResolutionService: {
      getParentsForChild: () => [],
      isRelationshipTarget: (file) => file.extension === 'md',
      onMetadataChanged: () => [],
      onFileCreated: () => [],
      onFileRenamed: () => [],
      onFileDeleted: () => [],
    },
    linkedSubitemCheckboxService: { refreshReferencesForChild: async () => {} },
    fileNamingService: {
      isCalendarEventFile: () => false,
      shouldProcess: () => false,
      updateFilenameIfNeeded: async () => false,
      syncTitleFromFilename: async () => false,
      syncFileTimestamps: async () => false,
    },
    bodySubitemLinkService: { scanFile: async () => [] },
    bulkEditService: { cleanupLinksForDeletedFile: async () => 0 },
    eventService: {
      onFilesUpdated: (callback) => { filesUpdatedHandler = callback; return noop; },
      emitFilesUpdated: noop,
      emitDeleteComplete: noop,
    },
  };

  registerGcmEvents(plugin);

  return {
    plugin,
    mutations,
    invalidations,
    checklistPrompts,
    rawBodyReads: () => rawBodyReads,
    navigationCounts: () => ({ selectedBodyReads, linkedRefreshes }),
    emit(scope, event, ...args) {
      for (const callback of listeners.get(`${scope}:${event}`) || []) callback(...args);
    },
    emitFilesUpdated(paths) { filesUpdatedHandler?.(paths); },
    addFile(path, frontmatter = {}, body = '') {
      const file = new TFile(path, frontmatter);
      file.body = body;
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

test('startup metadata and modify bursts do not add completion dates or attempt frontmatter writes', async () => {
  const h = createHarness();
  const files = Array.from({ length: 100 }, (_value, index) => h.addFile(
    `Inbox/existing-${index}.md`,
    index % 3 === 0
      ? { kind: ['transaction/workout'], status: 'complete' }
      : index % 3 === 1
        ? { kind: ['transaction/event'], status: 'cancelled' }
        : { status: 'todo', completedDate: '2026-09-24T18:00:00' },
  ));
  const before = files.map((file) => JSON.stringify(file.frontmatter));

  for (const file of files) {
    h.emit('vault', 'modify', file);
    h.metadataChanged(file);
  }
  await settleDebounces();

  assert.equal(h.mutations.length, 0, 'ordinary metadata changes must never call a frontmatter writer');
  assert.deepEqual(files.map((file) => JSON.stringify(file.frontmatter)), before);
  assert.equal(h.navigationCounts().selectedBodyReads, 0);
  h.cleanup();
});

test('external status and filename changes do not silently reconcile completedDate', async () => {
  const h = createHarness();
  const workout = h.addFile('Inbox/workout.md', { status: 'todo' });
  const event = h.addFile('Inbox/event.md', { status: 'todo' });

  workout.frontmatter.status = 'complete';
  event.frontmatter.status = 'cancelled';
  h.emit('vault', 'modify', workout);
  h.metadataChanged(workout);
  h.emit('vault', 'modify', event);
  h.metadataChanged(event);
  h.renameFile(event, 'Inbox/event.md', 'Inbox/renamed-event.md');
  await settleDebounces();

  assert.equal(h.mutations.length, 0);
  assert.equal(workout.frontmatter.completedDate, undefined);
  assert.equal(event.frontmatter.completedDate, undefined);
  h.cleanup();
});

test('authored completion survives metadata refresh with checklist checking enabled and an open item', async () => {
  // The prior fixture disabled this setting and stubbed checklist scanning as
  // empty. Use the real ChecklistHandler scanner with a real unchecked line.
  const h = createHarness({ checkOpenChecklistItems: true, dataArchitectureMode: 'native-records' });
  const body = '# Authored event\n- [ ] Still unchecked\nBody sentinel stays unchanged\n';
  const file = h.addFile('Inbox/External complete with checklist.md', { kind: 'transaction', transactionKind: 'event' }, body);
  const previous = { ...file.frontmatter };
  h.setCachedFrontmatter(file, previous);
  h.metadataChanged(file);

  file.frontmatter = { ...previous, status: 'complete', completedDate: '2026-10-05T17:30:00' };
  const saved = JSON.stringify(file.frontmatter);
  // Vault modify can arrive while metadata still describes the prior source.
  h.emit('vault', 'modify', file);
  h.setCachedFrontmatter(file, { ...file.frontmatter });
  h.metadataChanged(file);
  await settleDebounces();

  try {
    assert.deepEqual({
      mutations: h.mutations.length,
      frontmatter: JSON.stringify(file.frontmatter),
      body: file.body,
      checklistReads: h.rawBodyReads(),
      prompts: h.checklistPrompts,
    }, {
      mutations: 0,
      frontmatter: saved,
      body,
      checklistReads: 0,
      prompts: [],
    }, 'saved completion is authoritative: no background rollback, checklist scan or prompt');
  } finally { h.cleanup(); }
});

for (const [name, options, previous, completion] of [
  ['native desktop working status', { dataArchitectureMode: 'native-records' }, { status: 'working' }, { status: 'complete' }],
  ['legacy desktop done alias', { dataArchitectureMode: 'legacy' }, { status: 'todo' }, { status: 'done' }],
  ['native mobile completed alias', { mobile: true, dataArchitectureMode: 'native-records' }, {}, { status: 'completed' }],
  ['legacy mobile finished alias', { mobile: true, dataArchitectureMode: 'legacy' }, { status: 'working' }, { status: 'finished' }],
  ['mapped case-insensitive list status', { dataArchitectureMode: 'native-records', statusKey: 'taskStatus' }, { TaskStatus: ['working'], status: 'external relation' }, { TaskStatus: ['done'] }],
  ['mapped status and date casing', { dataArchitectureMode: 'native-records', statusKey: 'workflow' }, { WORKFLOW: 'working', status: 'external relation' }, { WORKFLOW: 'complete', CompletedDate: '2026-10-05T18:00:00' }],
]) {
  test(`metadata observers preserve saved completion and body for ${name}`, async () => {
    const previousMobile = globalThis.__GcmEventPlatform.isMobile;
    globalThis.__GcmEventPlatform.isMobile = options.mobile || false;
    const h = createHarness({ ...options, checkOpenChecklistItems: true });
    const body = '- [ ] User-owned checklist\nPreserved body\r\n';
    const file = h.addFile(`Inbox/External ${name}.md`, { ...previous }, body);
    h.setCachedFrontmatter(file, { ...previous });
    h.metadataChanged(file);
    file.frontmatter = { ...previous, completedDate: '2026-10-05T17:59:00', ...completion };
    if ('CompletedDate' in completion) delete file.frontmatter.completedDate;
    const saved = JSON.stringify(file.frontmatter);
    h.emit('vault', 'modify', file);
    h.setCachedFrontmatter(file, { ...file.frontmatter });
    h.metadataChanged(file);
    await settleDebounces();
    try {
      assert.equal(JSON.stringify(file.frontmatter), saved, 'authored keys, aliases and timestamps remain exact');
      assert.equal(file.body, body);
      assert.deepEqual([h.mutations.length, h.rawBodyReads(), h.checklistPrompts.length], [0, 0, 0]);
    } finally {
      h.cleanup();
      globalThis.__GcmEventPlatform.isMobile = previousMobile;
    }
  });
}

test('startup and repeated completion metadata with open items never create a rollback decision', async () => {
  const h = createHarness({ checkOpenChecklistItems: true, dataArchitectureMode: 'native-records' });
  const file = h.addFile('Inbox/Already saved completion.md', {
    status: 'complete', completedDate: '2026-10-04T18:00:00', title: 'Saved title',
  }, '- [ ] Keep open\n');
  const saved = JSON.stringify(file.frontmatter);
  try {
    for (let i = 0; i < 100; i++) {
      h.emit('vault', 'modify', file);
      h.metadataChanged(file);
    }
    await settleDebounces();
    assert.equal(JSON.stringify(file.frontmatter), saved);
    assert.equal(file.body, '- [ ] Keep open\n');
    assert.deepEqual([h.mutations.length, h.rawBodyReads(), h.checklistPrompts.length], [0, 0, 0]);
  } finally { h.cleanup(); }
});

test('delayed completion metadata cannot overwrite a newer authored reopen', async () => {
  const h = createHarness({ checkOpenChecklistItems: true, dataArchitectureMode: 'native-records' });
  const file = h.addFile('Inbox/Reopened before metadata settled.md', { status: 'todo' }, '- [ ] Still open\n');
  h.metadataChanged(file);
  file.frontmatter = { status: 'complete', completedDate: '2026-10-05T18:00:00' };
  h.emit('vault', 'modify', file);
  h.setCachedFrontmatter(file, { ...file.frontmatter });
  h.metadataChanged(file);
  file.frontmatter = { status: 'working', title: 'Newer user edit', completedDate: 'User-authored retained value' };
  file.body += 'Newer body edit\n';
  const saved = JSON.stringify(file.frontmatter);
  const body = file.body;
  h.emit('vault', 'modify', file);
  // The cache still describes complete; the current source is already reopened.
  h.metadataChanged(file);
  await settleDebounces();
  try {
    assert.equal(JSON.stringify(file.frontmatter), saved);
    assert.equal(file.body, body);
    assert.deepEqual([h.mutations.length, h.rawBodyReads(), h.checklistPrompts.length], [0, 0, 0]);
  } finally { h.cleanup(); }
});

for (const lifecycle of ['rename', 'replacement', 'unload']) {
  test(`completion metadata followed by ${lifecycle} cannot carry a passive rollback writer`, async () => {
    const h = createHarness({ checkOpenChecklistItems: true, dataArchitectureMode: 'native-records' });
    const original = h.addFile(`Inbox/Completion ${lifecycle}.md`, { status: 'working' }, '- [ ] Original body\n');
    h.metadataChanged(original);
    original.frontmatter = { status: 'complete', completedDate: '2026-10-05T18:00:00' };
    h.emit('vault', 'modify', original);
    h.metadataChanged(original);
    let current = original;
    if (lifecycle === 'rename') {
      h.renameFile(original, original.path, `Inbox/2026-10-05 Completion ${lifecycle}.md`);
      h.metadataChanged(original);
    } else if (lifecycle === 'replacement') {
      h.deleteFile(original);
      current = h.replaceFile(original.path, { status: 'complete', completedDate: '2026-10-05T19:00:00', title: 'Different file' });
      current.body = '- [ ] Replacement body\n';
      h.metadataChanged(current);
    } else {
      h.cleanup();
    }
    const saved = JSON.stringify(current.frontmatter);
    const body = current.body;
    await settleDebounces();
    try {
      assert.equal(JSON.stringify(current.frontmatter), saved);
      assert.equal(current.body, body);
      assert.deepEqual([h.mutations.length, h.rawBodyReads(), h.checklistPrompts.length], [0, 0, 0]);
    } finally { if (lifecycle !== 'unload') h.cleanup(); }
  });
}

test('switching notes never schedules checklist writes or retired link repairs', async () => {
  const h = createHarness();
  let checklist = 0, retired = 0;
  h.plugin.taskCheckboxHandler.scheduleChecklistPropertyUpdate = () => checklist++;
  h.plugin.subitemRelationshipSyncService.repairBrokenBodyLinksForParent = () => retired++;
  h.plugin.subitemRelationshipSyncService.ensureBodyLinksForChild = () => retired++;
  const files = [h.addFile('Inbox/A.md'), h.addFile('Inbox/B.md')];
  // An unrelated large vault must not turn navigation into a sweep.
  for (let i = 0; i < 1000; i++) h.addFile(`Inbox/unrelated-${i}.md`);
  for (const file of [...files, ...files]) {
    h.emit('workspace', 'active-leaf-change');
    h.emit('workspace', 'file-open', file);
  }
  assert.equal(checklist, 0);
  assert.equal(retired, 0);
  assert.equal(h.mutations.length, 0);
  h.emit('vault', 'modify', files[0]);
  assert.equal(checklist, 1, 'actual edits still own checklist maintenance');
  await settleDebounces();
  h.cleanup();
});

test('irrelevant metadata changes skip raw template-protection reads', async () => {
  const h = createHarness();
  let reads = 0;
  h.plugin.settings.frontmatterAutoWriteExclusions = '#template';
  h.plugin.app.vault.read = async () => { reads++; return 'Ordinary note'; };
  for (let i = 0; i < 100; i++) h.metadataChanged(h.addFile(`Inbox/unchanged-${i}.md`));
  await settleDebounces();
  assert.equal(reads, 0);
  assert.equal(h.mutations.length, 0);
  h.cleanup();
});

test('startup create announcements schedule no creation writers while post-layout creation keeps its owner', async () => {
  const h = createHarness();
  const calls = { templateGate: 0, rules: 0, title: 0, timestamps: 0, fileProperties: 0 };
  h.plugin.app.workspace.layoutReady = false;
  h.plugin.settings.autoSyncTitleFromFilename = true;
  h.plugin.fileNamingService.whenDailyNoteConfigurationReady = async () => { calls.templateGate++; };
  h.plugin.fileNamingService.getDailyNoteConfigurationSnapshot = () => null;
  h.plugin.fileNamingService.syncTitleFromFilename = async () => { calls.title++; };
  h.plugin.fileNamingService.syncFileTimestamps = async () => { calls.timestamps++; };
  h.plugin.notebookNavigatorRuleService.scheduleApply = () => { calls.rules++; };
  h.plugin.filePropertiesService.isPropertyTarget = file => file.extension === 'png';
  h.plugin.filePropertiesService.handleSourceCreate = async () => { calls.fileProperties++; };
  for (let i = 0; i < 1_000; i++) h.emit('vault', 'create', h.addFile(`Inbox/Existing ${i}.md`));
  h.emit('vault', 'create', h.addFile('Inbox/Existing attachment.png'));
  await settleDebounces();
  assert.deepEqual(calls, { templateGate: 0, rules: 0, title: 0, timestamps: 0, fileProperties: 0 });
  assert.equal(h.mutations.length, 0);

  h.plugin.app.workspace.layoutReady = true;
  h.emit('vault', 'create', h.addFile('Inbox/Actual new note.md'));
  h.emit('vault', 'create', h.addFile('Inbox/Actual new attachment.png'));
  await settleDebounces();
  assert.deepEqual(calls, { templateGate: 1, rules: 2, title: 1, timestamps: 1, fileProperties: 1 });
  h.cleanup();
});

test('ordinary Markdown rename reaches title synchronization immediately alongside companion bookkeeping', () => {
  const h = createHarness();
  const calls = [];
  h.plugin.settings.autoSyncTitleFromFilename = true;
  h.plugin.filePropertiesService.handlePendingMarkdownTargetRename = async (...args) => { calls.push(['companion', ...args]); };
  h.plugin.fileNamingService.syncTitleFromFilename = async (...args) => { calls.push(['title', ...args]); };
  h.plugin.fileNamingService.syncFileTimestamps = async () => { throw Error('Unrelated writer'); };
  const f = h.addFile('Inbox/Untitled.md', { title: 'Untitled' });
  h.renameFile(f, f.path, 'Inbox/Named.md');
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'companion');
  assert.deepEqual(calls[1], ['title', f, { bypassCreationGrace: true, renamedFromPath: 'Inbox/Untitled.md' }]);
  h.cleanup();
});

for (const disabled of ['setting', 'workflow']) {
  test(`Markdown rename avoids the title writer when ${disabled} owns the guard`, () => {
    const h = createHarness();
    h.plugin.settings.autoSyncTitleFromFilename = disabled !== 'setting';
    h.plugin.nativeRecordService = { isInternalIdentityWrite: () => disabled === 'workflow' };
    h.plugin.fileNamingService.syncTitleFromFilename = async () => { throw Error('Unexpected title writer'); };
    const f = h.addFile('Inbox/Untitled.md');
    h.renameFile(f, f.path, 'Inbox/Named.md');
    h.cleanup();
  });
}

test('committed filename title propagation runs without background automation authority', () => {
  const h = createHarness();
  const calls = [];
  h.plugin.settings.autoSyncTitleFromFilename = true;
  h.plugin.canRunBackgroundAutomation = () => false;
  h.plugin.fileNamingService.syncTitleFromFilename = async (...args) => calls.push(args);
  const f = h.addFile('Inbox/Untitled.md', { title: 'Untitled' });
  h.renameFile(f, f.path, 'Inbox/Named.md');
  assert.deepEqual(calls, [[f, { bypassCreationGrace: true, renamedFromPath: 'Inbox/Untitled.md' }]]);
  h.cleanup();
});

for (const background of [false, true]) {
  test(`a committed Markdown filename change refreshes its title before link settlement (background=${background})`, async () => {
    const h = createHarness();
    h.plugin.canRunBackgroundAutomation = () => background;
    const file = h.addFile('Inbox/Question.md', { title: 'Question: why?' });
    const pendingLinks = deferred();
    h.plugin.filePropertiesService.handlePendingMarkdownTargetRename = () => pendingLinks.promise;
    const rendered = [];
    let visibleTitle = 'Question';
    h.plugin.noteTitleRenderService.handleMetadataChanged = f => { rendered.push([f.path, f.frontmatter.title]); visibleTitle = f.frontmatter.title; };
    h.plugin.app.vault.read = async () => { throw Error('Display must not read source'); };
    h.renameFile(file, file.path, 'Inbox/Question why.md');
    // A view created after GCM registers its core listener later in this event.
    visibleTitle = 'Question why';
    await Promise.resolve();
    assert.equal(visibleTitle, 'Question: why?');
    assert.deepEqual(rendered, [['Inbox/Question why.md', 'Question: why?']]);
    assert.equal(h.mutations.length, 0);
    pendingLinks.resolve();
    h.cleanup();
  });
}

test('100 folder-only moves do not request redundant title renders or source mutations', async () => {
  const h = createHarness();
  let renders = 0, reads = 0;
  h.plugin.noteTitleRenderService.handleMetadataChanged = () => renders++;
  h.plugin.app.vault.read = async () => { reads++; return ''; };
  const file = h.addFile('Inbox/Named.md', { title: 'Named' });
  for (let i = 0; i < 100; i++) h.renameFile(file, file.path, `Inbox/Folder${i}/Named.md`);
  await Promise.resolve();
  assert.deepEqual([renders, reads, h.mutations.length], [0, 0, 0]);
  h.cleanup();
});

// Exercise the actual registered callbacks. Spies measure dispatch to the legacy
// service boundary; its read/write/conflict behavior is covered by the separate
// real-service suite and installed first-use operation-count QA.
function observeLegacyLifecycle(h) {
  const calls = [];
  for (const name of [
    'captureSourceRenameCompanion', 'handlePendingMarkdownTargetRename',
    'handleCompanionRename', 'handleSourceRename', 'handleSourceFolderRename',
    'handleSourceFolderDelete', 'handleSourceCreate', 'handleSourceDelete',
    'handleCompanionDelete', 'handleCompanionMetadataChanged',
    'invalidatePendingMarkdownTarget', 'invalidateLegacyCanvas',
  ]) {
    const original = h.plugin.filePropertiesService[name];
    h.plugin.filePropertiesService[name] = (...args) => {
      calls.push(name);
      return original(...args);
    };
  }
  return calls;
}

test('native-record folder and attachment event bursts never dispatch legacy indexing or bookkeeping', () => {
  const h = createHarness();
  h.plugin.settings.dataArchitectureMode = 'native-records';
  h.plugin.canRunBackgroundAutomation = () => false;
  const calls = observeLegacyLifecycle(h);
  const cleaned = [];
  h.plugin.bulkEditService.cleanupLinksForDeletedFile = async (path) => cleaned.push(path);
  try {
    for (let i = 0; i < 20; i++) {
      const folder = new TFolder(`Inbox/New ${i}`);
      h.emit('vault', 'rename', folder, `Inbox/Old ${i}`);
      h.emit('vault', 'delete', folder);
      const asset = h.addFile(`Inbox/image ${i}.png`);
      h.renameFile(asset, asset.path, `Inbox/renamed ${i}.png`);
      h.deleteFile(asset);
      const canvas = h.addFile(`Inbox/Board ${i}.canvas`);
      h.emit('vault', 'modify', canvas);
      h.metadataChanged(canvas);
    }
    assert.deepEqual(calls, []);
    assert.equal(cleaned.length, 20, 'ordinary link cleanup remains owned by the delete event');
  } finally { h.cleanup(); }
});

test('inactive companions stay excluded without reading, repairing or notifying their legacy service', () => {
  const h = createHarness();
  h.plugin.settings.dataArchitectureMode = 'native-records';
  const calls = observeLegacyLifecycle(h);
  const companion = h.addFile('System/File properties/example.md');
  h.plugin.filePropertiesService.isCompanionFile = (file) => file === companion;
  h.plugin.filePropertiesService.isCompanionRename = (file) => file === companion;
  let ordinaryWork = 0;
  let deleteNotifications = 0;
  h.plugin.bulkEditService.cleanupLinksForDeletedFile = async () => ordinaryWork++;
  h.plugin.noteTitleRenderService.handleMetadataChanged = () => ordinaryWork++;
  h.plugin.fileNamingService.syncTitleFromFilename = async () => ordinaryWork++;
  h.plugin.eventService.emitDeleteComplete = () => deleteNotifications++;
  try {
    h.metadataChanged(companion);
    h.emit('vault', 'modify', companion);
    h.renameFile(companion, companion.path, 'System/File properties/example.txt');
    h.deleteFile(companion);
    assert.deepEqual(calls, []);
    assert.equal(ordinaryWork, 0, 'retired records must not fall through into ordinary note automation');
    assert.equal(deleteNotifications, 1);
  } finally { h.cleanup(); }
});

test('native-record Markdown renames retain title refresh and configured sync without a legacy queue', async () => {
  const h = createHarness();
  h.plugin.settings.dataArchitectureMode = 'native-records';
  h.plugin.settings.autoSyncTitleFromFilename = true;
  const calls = observeLegacyLifecycle(h);
  const file = h.addFile('Inbox/Before.md', { title: 'Authored title' });
  const titles = [];
  const cleaned = [];
  const invalidated = [];
  h.plugin.noteTitleRenderService.handleMetadataChanged = (f) => titles.push(['render', f.path]);
  h.plugin.fileNamingService.syncTitleFromFilename = async (f) => titles.push(['sync', f.path]);
  h.plugin.bulkEditService.cleanupLinksForDeletedFile = async (path) => cleaned.push(path);
  h.plugin.persistentMenuManager.invalidateLinkedContextSourcePaths = (paths) => invalidated.push(paths);
  try {
    h.renameFile(file, file.path, 'Inbox/After.md');
    await Promise.resolve();
    assert.deepEqual(titles, [['sync', 'Inbox/After.md'], ['render', 'Inbox/After.md']]);
    h.deleteFile(file);
    assert.deepEqual(calls, []);
    assert.deepEqual(cleaned, ['Inbox/After.md']);
    assert.deepEqual(invalidated, [['Inbox/After.md']]);
  } finally { h.cleanup(); }
});

test('legacy mode retains folder, source, companion and pending-target event routing', async () => {
  const h = createHarness();
  h.plugin.settings.dataArchitectureMode = 'legacy';
  h.plugin.canRunBackgroundAutomation = () => false;
  const calls = observeLegacyLifecycle(h);
  try {
    const folder = new TFolder('Inbox/New');
    h.emit('vault', 'rename', folder, 'Inbox/Old');
    h.emit('vault', 'delete', folder);
    const asset = h.addFile('Inbox/image.png');
    h.renameFile(asset, asset.path, 'Inbox/renamed.png');
    h.deleteFile(asset);
    const md = h.addFile('Inbox/Target.md');
    h.renameFile(md, md.path, 'Inbox/Moved.md');
    const canvas = h.addFile('Inbox/Board.canvas');
    h.emit('vault', 'modify', canvas);
    h.metadataChanged(canvas);
    const companion = h.addFile('System/File properties/example.md');
    h.plugin.filePropertiesService.isCompanionFile = (file) => file === companion;
    h.plugin.filePropertiesService.isCompanionRename = (file) => file === companion;
    h.metadataChanged(companion);
    h.renameFile(companion, companion.path, 'System/File properties/moved.md');
    h.deleteFile(companion);
    await Promise.resolve();
    assert.deepEqual(calls, [
      'handleSourceFolderRename', 'handleSourceFolderDelete',
      'captureSourceRenameCompanion', 'handleSourceRename',
      'invalidatePendingMarkdownTarget', 'handleSourceDelete',
      'handlePendingMarkdownTargetRename', 'invalidateLegacyCanvas', 'invalidateLegacyCanvas',
      'handleCompanionMetadataChanged', 'handleCompanionRename',
      'invalidatePendingMarkdownTarget', 'handleCompanionDelete',
    ]);
  } finally { h.cleanup(); }
});

test('lifecycle dispatch reads the current architecture setting at each event', () => {
  const h = createHarness();
  h.plugin.settings.dataArchitectureMode = 'native-records';
  const calls = observeLegacyLifecycle(h);
  const folder = new TFolder('Inbox/New');
  try {
    h.emit('vault', 'rename', folder, 'Inbox/Old');
    h.plugin.settings.dataArchitectureMode = 'legacy';
    h.emit('vault', 'rename', folder, 'Inbox/Old');
    h.plugin.settings.dataArchitectureMode = 'native-records';
    h.emit('vault', 'delete', folder);
    assert.deepEqual(calls, ['handleSourceFolderRename']);
  } finally { h.cleanup(); }
});

test('Canvas metadata invalidates its legacy cache before reindexing and refreshes linked Markdown parents', () => {
  const h = createHarness();
  h.plugin.settings.dataArchitectureMode = 'legacy';
  const parent = h.addFile('Inbox/Parent.md');
  const canvas = h.addFile('Inbox/Board.canvas');
  const calls = [];
  h.plugin.filePropertiesService.invalidateLegacyCanvas = (file) => {
    assert.equal(file, canvas);
    calls.push('invalidate');
  };
  h.plugin.parentLinkResolutionService.onMetadataChanged = (file) => {
    assert.equal(file, canvas);
    calls.push('reindex');
    return [parent.path];
  };
  h.plugin.overlayRenderingService.scheduleFileRefresh = (file, reason) => {
    if (reason === 'metadata-parent-menu-refresh') calls.push(`refresh:${file.path}`);
  };
  try {
    h.metadataChanged(canvas);
    assert.deepEqual(calls, ['invalidate', 'reindex', `refresh:${parent.path}`]);
  } finally { h.cleanup(); }
});

test('a Canvas JSON modify without a companion reads current properties before reindexing', async () => {
  const h = createHarness();
  h.plugin.settings.dataArchitectureMode = 'legacy';
  const parent = h.addFile('Inbox/Parent.md');
  const canvas = h.addFile('Inbox/Board.canvas');
  const calls = [];
  h.plugin.filePropertiesService.invalidateLegacyCanvas = () => calls.push('invalidate');
  h.plugin.filePropertiesService.primeLegacyCanvasCache = async (files) => {
    assert.deepEqual(files, [canvas]);
    calls.push('read-current-canvas');
    return 1;
  };
  h.plugin.parentLinkResolutionService.onMetadataChanged = (file) => {
    assert.equal(file, canvas);
    calls.push('reindex');
    return [parent.path];
  };
  h.plugin.overlayRenderingService.scheduleFileRefresh = (file, reason) => {
    if (reason === 'canvas-parent-menu-refresh') calls.push(`refresh:${file.path}`);
  };
  try {
    h.emit('vault', 'modify', canvas);
    await Promise.resolve();
    assert.deepEqual(calls, ['invalidate', 'read-current-canvas', 'reindex', `refresh:${parent.path}`]);
  } finally { h.cleanup(); }
});

test('a Canvas modify with a companion reindexes its current logical properties without a JSON read', () => {
  const h = createHarness();
  h.plugin.settings.dataArchitectureMode = 'legacy';
  const parent = h.addFile('Inbox/Parent.md');
  const canvas = h.addFile('Inbox/Board.canvas');
  const calls = [];
  h.plugin.filePropertiesService.hasCompanion = () => true;
  h.plugin.filePropertiesService.invalidateLegacyCanvas = () => calls.push('invalidate');
  h.plugin.filePropertiesService.primeLegacyCanvasCache = async () => {
    throw new Error('companion-backed Canvas must not read its JSON on modify');
  };
  h.plugin.parentLinkResolutionService.onMetadataChanged = (file) => {
    assert.equal(file, canvas);
    calls.push('reindex');
    return [parent.path];
  };
  h.plugin.overlayRenderingService.scheduleFileRefresh = (file, reason) => {
    if (reason === 'canvas-parent-menu-refresh') calls.push(`refresh:${file.path}`);
  };
  try {
    h.emit('vault', 'modify', canvas);
    assert.deepEqual(calls, ['invalidate', 'reindex', `refresh:${parent.path}`]);
  } finally { h.cleanup(); }
});

test('migration-style Markdown filesUpdated reindexes changed parent values after metadata events were suppressed', () => {
  const h = createHarness();
  const parent = h.addFile('Inbox/Parent.md');
  const child = h.addFile('Inbox/Child.md');
  h.plugin.propertyMigrationService = { active: true };
  const calls = [];
  h.plugin.parentLinkResolutionService.onMetadataChanged = (file) => {
    calls.push(`reindex:${file.path}`);
    return [parent.path];
  };
  h.plugin.overlayRenderingService.scheduleFileRefresh = (file, reason) => {
    if (reason === 'file-update-parent-menu-refresh') calls.push(`refresh:${file.path}`);
  };
  try {
    h.metadataChanged(child);
    assert.deepEqual(calls, []);
    h.emitFilesUpdated([child.path]);
    assert.deepEqual(calls, [`reindex:${child.path}`, `refresh:${parent.path}`]);
  } finally { h.cleanup(); }
});

test('opening a note never inspects unresolved child lines; configured child display still refreshes', async () => {
  for (const dataArchitectureMode of ['native-records', 'legacy']) {
    for (const enableLinkedSubitemCheckboxes of [true, false]) {
      const h = createHarness();
      const file = h.addFile('Inbox/Selected.md');
      h.plugin.settings.dataArchitectureMode = dataArchitectureMode;
      h.plugin.settings.enableLinkedSubitemCheckboxes = enableLinkedSubitemCheckboxes;
      h.plugin.app.workspace.getActiveFile = () => file;
      globalThis.__GcmUnresolvedChecks = 0;
      try {
        h.emit('workspace', 'file-open', file);
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(globalThis.__GcmUnresolvedChecks, 0, `${dataArchitectureMode}: no automatic repair prompt`);
        assert.deepEqual(h.navigationCounts(), {
          selectedBodyReads: 0,
          linkedRefreshes: enableLinkedSubitemCheckboxes ? 1 : 0,
        }, `${dataArchitectureMode}: keep only enabled child-link presentation`);
      } finally {
        h.cleanup();
      }
    }
  }
});

test('disabled child-link presentation keeps independent initial task controls', () => {
  for (const enabled of [true, false]) {
    const h = createHarness({ enableLinkedSubitemCheckboxes: enabled });
    assert.deepEqual(h.invalidations.find((entry) => entry.reason === 'initial-setup')?.surfaces,
      enabled
        ? ['menus', 'inline-task-controls', 'linked-subitems']
        : ['menus', 'inline-task-controls']);
    h.cleanup();
  }
});

test('mobile opening retains enabled child display but skips both refreshes when disabled', async () => {
  globalThis.__GcmEventPlatform.isMobile = true;
  try {
    for (const enableLinkedSubitemCheckboxes of [true, false]) {
      const h = createHarness();
      const file = h.addFile('Inbox/Mobile.md');
      h.plugin.settings.dataArchitectureMode = 'native-records';
      h.plugin.settings.enableLinkedSubitemCheckboxes = enableLinkedSubitemCheckboxes;
      h.plugin.app.workspace.getActiveFile = () => file;
      globalThis.__GcmUnresolvedChecks = 0;
      try {
        h.emit('workspace', 'file-open', file);
        await new Promise(resolve => setTimeout(resolve, 525));
        assert.deepEqual(h.navigationCounts(), {
          selectedBodyReads: 0,
          linkedRefreshes: enableLinkedSubitemCheckboxes ? 2 : 0,
        });
        assert.equal(globalThis.__GcmUnresolvedChecks, 0);
      } finally {
        h.cleanup();
      }
    }
  } finally {
    globalThis.__GcmEventPlatform.isMobile = false;
  }
});

test('retired automatic mode rules cannot mutate a view during metadata, opening or active-leaf bursts',async()=>{
 const h=createHarness({dataArchitectureMode:'native-records',enableLinkedSubitemCheckboxes:false});
 const f=h.addFile('Inbox/Manual mode.md',{viewmode:'reading',scheduled:'2026-09-22',title:'Keep title'},'Keep source body');
 const snapshot=JSON.stringify(f.frontmatter),body=f.body,state={file:f.path,mode:'source',source:true};
 let viewMutations=0,inventories=0,titleRefreshes=0;
 const view=Object.assign(new globalThis.__GcmEventMarkdownView(),{file:f,getViewType:()=> 'markdown',getState:()=>({...state}),getMode:()=> 'source',setState:async()=>{viewMutations++;}});
 h.plugin.app.workspace.activeLeaf={view,getViewState:()=>({type:'markdown',state:{...state}}),setViewState:async()=>{viewMutations++;}};
 h.plugin.app.workspace.getActiveFile=()=>f;
 h.plugin.app.workspace.getActiveViewOfType=()=>view;
 h.plugin.noteTitleRenderService.refreshInlineTitle=()=>{titleRefreshes++;};
 h.plugin.app.vault.getMarkdownFiles=()=>{inventories++;return[f];};
 h.plugin.settings.enableViewModeSwitching=true;
 h.plugin.settings.viewModeRules=[{mode:'reading',conditions:[{type:'path',operator:'contains',value:'Inbox'}]}];
 for(let i=0;i<100;i++){
  h.emit('workspace','active-leaf-change',h.plugin.app.workspace.activeLeaf);
  h.emit('workspace','file-open',f);
  h.metadataChanged(f);
 }
 await new Promise(resolve=>setTimeout(resolve,40));
 assert.equal(viewMutations,0);assert.equal(inventories,0);assert.equal(h.rawBodyReads(),0);
 assert.equal(h.mutations.length,0);assert.equal(JSON.stringify(f.frontmatter),snapshot);assert.equal(f.body,body);
 assert.ok(titleRefreshes>0,'the ordinary display callbacks still execute');
 h.cleanup();
});
