import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const createTaskModalSource = readFileSync(new URL('../src/modals/create-task-modal.ts', import.meta.url), 'utf8');
const pluginStylesSource = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');

async function loadCreateTaskModules() {
  const result = await build({
    stdin: {
      contents: `
        export { CreateTaskService } from './src/services/create-task-service.ts';
        export { resolveCreateTaskModalCopy } from './src/modals/create-task-modal.ts';
        export { AiAssistedTaskService } from './src/services/ai-assisted-task-service.ts';
        export { buildCreatedTaskLine, normalizeCreateTaskCheckboxMarker } from './src/utils/create-task-parser.ts';
        export { Modal, TFile, Notice } from 'obsidian';
      `,
      resolveDir: repoRoot,
      sourcefile: 'create-task-checkbox-test-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-test-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'obsidian-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'obsidian-test' }, () => ({
          loader: 'js',
          contents: `
            export class App {}
            export class Modal {
              static instances = [];
              constructor(app) { this.app = app; Modal.instances.push(this); }
              open() {}
              close() {}
            }
            export class FuzzySuggestModal extends Modal {}
            export class Setting {}
            export class ButtonComponent {}
            export class TextComponent {}
            export class ToggleComponent {}
            export class Notice {
              static messages = [];
              constructor(message) { Notice.messages.push(String(message)); }
            }
            export class TFile {
              constructor(path) {
                this.path = path;
                this.name = path.split('/').pop() || path;
                this.basename = this.name.replace(/\\.[^.]+$/, '');
                this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
              }
            }
            export class TFolder {
              constructor(path) {
                this.path = path;
                this.name = path.split('/').pop() || path;
                this.children = [];
              }
            }
            export function normalizePath(value) {
              return String(value ?? '').trim().replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/');
            }
            export function parseYaml(value) {
              return JSON.parse(String(value || '{}'));
            }
            export function stringifyYaml(value) {
              return JSON.stringify(value ?? {});
            }
            export function moment() {
              return { format: () => '2026-08-02' };
            }
          `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function mappings() {
  return [
    { checkboxState: '[o]', statuses: ['todo'], toggleTargetStatus: 'complete', label: 'Open' },
    { checkboxState: '[?]', statuses: ['holding'], toggleTargetStatus: 'todo', label: 'Holding' },
    { checkboxState: '[d]', statuses: ['complete'], toggleTargetStatus: 'todo', label: 'Done' },
  ];
}

function normalizeStatus(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'done' ? 'complete' : normalized;
}

function taskResult(overrides = {}) {
  return {
    createTrackedRecord: false,
    parentMode: 'note',
    title: 'Mapped task',
    targetFile: null,
    checkboxMarker: 'o',
    checkboxStatus: 'todo',
    checkboxStatuses: ['todo'],
    priority: '',
    scheduledValue: '',
    allDay: false,
    timeEstimate: 0,
    taskLine: '- [x] untrusted prebuilt line',
    ...overrides,
  };
}

test('create-task parser rejects missing and malformed checkbox tokens instead of truncating or defaulting', async () => {
  const { buildCreatedTaskLine, normalizeCreateTaskCheckboxMarker } = await loadCreateTaskModules();
  assert.equal(normalizeCreateTaskCheckboxMarker(' '), ' ');
  assert.equal(normalizeCreateTaskCheckboxMarker('[o]'), 'o');
  assert.equal(normalizeCreateTaskCheckboxMarker('oops'), null);
  assert.equal(normalizeCreateTaskCheckboxMarker(''), null);
  assert.throws(
    () => buildCreatedTaskLine({ title: 'No implicit marker', checkboxMarker: '' }),
    /must be one configured character/,
  );
  assert.throws(
    () => buildCreatedTaskLine({ title: 'No truncation', checkboxMarker: 'oops' }),
    /must be one configured character/,
  );
});

test('Create task modal copy distinguishes a native task note from a legacy checkbox', async () => {
  const { resolveCreateTaskModalCopy } = await loadCreateTaskModules();
  assert.deepEqual(resolveCreateTaskModalCopy(true), {
    title: 'Create task note',
    taskDescription: 'Creates a note-backed task. Natural language schedule text is parsed into its Scheduled field.',
    targetDescription: 'Creates a standalone task note.',
    checkboxLabel: 'Initial status',
    submitLabel: 'Create task note',
  });
  assert.deepEqual(resolveCreateTaskModalCopy(false), {
    title: 'Create task',
    taskDescription: 'Natural language schedule text is parsed into the Scheduled field.',
    targetDescription: 'The containing note is the task parent.',
    checkboxLabel: 'Checkbox',
    submitLabel: 'Create task',
  });
});

test('Create task parent controls expose an accessible standalone reset and wrap on narrow screens', () => {
  assert.match(createTaskModalSource, /setName\(this\.options\.allowStandaloneParent \? 'Parent' : 'Write to'\)/u);
  assert.match(createTaskModalSource, /setButtonText\('Today'\)[\s\S]*this\.parentMode = 'note';[\s\S]*this\.targetFile = null;/u);
  assert.match(createTaskModalSource, /setButtonText\('Standalone'\)/u);
  assert.match(createTaskModalSource, /todayParentButton\?\.buttonEl\.setAttribute\('aria-pressed', String\(today\)\)/u);
  assert.match(createTaskModalSource, /setAttribute\('aria-pressed', String\(standalone\)\)/u);
  assert.match(createTaskModalSource, /Choose a parent note; current parent is Standalone/u);
  assert.match(pluginStylesSource, /\.tps-gcm-create-task-parent \.setting-item-control \{\s*flex-wrap: wrap;/u);
  assert.match(pluginStylesSource, /\.tps-gcm-create-task-parent \.setting-item-control button \{[\s\S]*white-space: normal;/u);
});

test('Create task opens standalone by default in native mode without resolving a Daily Note', async () => {
  const { CreateTaskService, Modal } = await loadCreateTaskModules();
  globalThis.window = { moment: () => ({ format: () => '2026-08-28' }) };
  let dailyNoteCalls = 0;
  const plugin = {
    settings: {
      createTaskDefaultParentMode: 'standalone',
      linkedSubitemCheckboxMappings: mappings(),
    },
    sharedServices: { status: { normalize: normalizeStatus, getStatusOptions: () => ['todo', 'working', 'holding', 'complete', 'wont-do'] } },
    nativeRecordService: { isEnabled: () => true },
    noteOperationService: {
      async ensureDailyNote() {
        dailyNoteCalls += 1;
        throw new Error('standalone must not resolve a Daily Note');
      },
    },
    app: {},
  };

  new CreateTaskService(plugin).openCreateTaskModal();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(dailyNoteCalls, 0);
  const modal = Modal.instances.at(-1);
  assert.equal(modal.options.defaultParentMode, 'standalone');
  assert.equal(modal.options.defaultTargetFile, null);
  assert.equal(modal.options.allowStandaloneParent, true);
  assert.deepEqual(modal.options.checkboxOptions.map(({ status, label }) => ({ status, label })), [
    { status: 'todo', label: 'todo' },
    { status: 'working', label: 'working' },
    { status: 'holding', label: 'holding' },
    { status: 'complete', label: 'complete' },
    { status: 'wont-do', label: 'wont-do' },
  ]);
});

test('Create task defers the configured Daily Note default and Legacy destination until submission', async () => {
  const { CreateTaskService, Modal } = await loadCreateTaskModules();
  globalThis.window = { moment: () => ({ format: () => '2026-08-28' }) };
  for (const [native, configuredMode] of [[true, 'today-daily-note'], [false, 'standalone']]) {
    let dailyNoteCalls = 0;
    const plugin = {
      settings: {
        createTaskDefaultParentMode: configuredMode,
        linkedSubitemCheckboxMappings: mappings(),
      },
      sharedServices: { status: { normalize: normalizeStatus, getStatusOptions: () => ['todo', 'working', 'holding', 'complete', 'wont-do'] } },
      nativeRecordService: { isEnabled: () => native },
      noteOperationService: {
        async ensureDailyNote() {
          dailyNoteCalls += 1;
          throw new Error('opening or canceling the modal must not create a Daily Note');
        },
      },
      app: {},
    };

    new CreateTaskService(plugin).openCreateTaskModal();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(dailyNoteCalls, 0);
    const modal = Modal.instances.at(-1);
    assert.equal(modal.options.defaultParentMode, native ? 'standalone' : 'note');
    assert.equal(modal.options.defaultTargetFile, null);
    assert.equal(modal.options.allowStandaloneParent, native);
  }
});

test('manual create derives ordered options and rebuilds the line from the selected configured marker', async () => {
  const { CreateTaskService, TFile } = await loadCreateTaskModules();
  globalThis.window = { setTimeout: (callback) => callback(), moment: () => ({ format: () => '2026-08-02' }) };
  const file = new TFile('Inbox/Tasks.md');
  let content = '# Tasks\n';
  let processCalls = 0;
  let dailyNoteCalls = 0;
  const historyEvents = [];
  const plugin = {
    settings: {
      linkedSubitemCheckboxMappings: mappings(),
      autoSyncFileTimestamps: false,
      dateCreatedFrontmatterKey: 'createdDate',
      dateModifiedFrontmatterKey: 'modifiedDate',
      fileTimestampFormat: 'YYYY-MM-DD HH:mm:ss',
    },
    sharedServices: { status: { normalize: normalizeStatus, getStatusOptions: () => ['todo', 'working', 'holding', 'complete', 'wont-do'] } },
    noteOperationService: {
      async ensureDailyNote() {
        dailyNoteCalls += 1;
        return file;
      },
    },
    itemHistoryService: {
      async beginTaskMutation(input) {
        historyEvents.push({ type: 'begin', input });
        return { id: 'pending-create' };
      },
      ensureTaskIdentity(_handle, line) {
        historyEvents.push({ type: 'ensure' });
        return `${line} [tpsId:: create-history-id]`;
      },
      async commitTaskMutation(_handle, input) {
        historyEvents.push({ type: 'commit', input });
      },
      async abortTaskMutation() {
        historyEvents.push({ type: 'abort' });
      },
    },
    app: {
      vault: {
        async process(_file, updater) {
          processCalls += 1;
          historyEvents.push({ type: 'process-start' });
          content = updater(content);
          historyEvents.push({ type: 'process-done' });
        },
        async cachedRead() { return content; },
      },
      workspace: { getLeaf: () => ({}) },
    },
    async openFileInLeaf() {},
    findOpenLeafForFile() { return null; },
  };
  const service = new CreateTaskService(plugin);

  assert.deepEqual(
    service.getCheckboxOptions().map(({ checkboxMarker, status }) => ({ checkboxMarker, status })),
    [
      { checkboxMarker: 'o', status: 'todo' },
      { checkboxMarker: '?', status: 'holding' },
      { checkboxMarker: 'd', status: 'complete' },
    ],
  );

  const created = await service.createTask(taskResult());
  assert.equal(created, file);
  assert.equal(processCalls, 1);
  assert.equal(dailyNoteCalls, 1);
  assert.match(content, /- \[o\] Mapped task/);
  assert.match(content, /\[tpsId:: create-history-id\]/u);
  assert.doesNotMatch(content, /untrusted prebuilt line|\[x\]/);
  assert.deepEqual(historyEvents.map((event) => event.type), [
    'begin',
    'process-start',
    'ensure',
    'process-done',
    'commit',
  ]);
  assert.deepEqual(historyEvents[0].input.cause, {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'create-task-modal',
  });
  assert.equal(historyEvents[4].input.after.path, file.path);
  assert.equal(historyEvents[4].input.after.lineNumber, 1);
  assert.match(historyEvents[4].input.after.rawLine, /\[tpsId:: create-history-id\]/u);
});

test('native standalone Create task writes only one task record and never resolves or mutates a Daily Note', async () => {
  const { CreateTaskService, TFile, Notice } = await loadCreateTaskModules();
  Notice.messages.length = 0;
  const recordFile = new TFile('_records/tasks/task-standalone.md');
  let dailyNoteCalls = 0;
  let sourceWriteCalls = 0;
  let promotionCalls = 0;
  let createInput = null;
  const opened = [];
  const plugin = {
    settings: {
      createTaskDefaultParentMode: 'standalone',
      linkedSubitemCheckboxMappings: [{ checkboxState: '[?]', statuses: ['holding'] }],
      autoSyncFileTimestamps: false,
      dateCreatedFrontmatterKey: 'createdDate',
      dateModifiedFrontmatterKey: 'modifiedDate',
      fileTimestampFormat: 'YYYY-MM-DD HH:mm:ss',
    },
    sharedServices: { status: { normalize: normalizeStatus, getStatusOptions: () => ['todo', 'review', 'complete'] } },
    noteOperationService: {
      async ensureDailyNote() { dailyNoteCalls += 1; return null; },
    },
    nativeRecordService: {
      isEnabled: () => true,
      async create(kind, properties, options) {
        createInput = { kind, properties, options };
        return { file: recordFile, path: recordFile.path };
      },
      async promoteTask() { promotionCalls += 1; },
    },
    app: {
      vault: {
        async process() { sourceWriteCalls += 1; },
      },
      workspace: { getLeaf: () => ({}) },
    },
    noteOpeningService: { async present(request) { opened.push(request.filePath); return true; } },
    async openFileInLeaf(file) { opened.push(file); },
  };

  const created = await new CreateTaskService(plugin).createTask(taskResult({
    createTrackedRecord: true,
    parentMode: 'standalone',
    title: 'Standalone task #work',
    checkboxMarker: 'review',
    checkboxStatus: 'review',
    checkboxStatuses: ['review'],
    priority: 'high',
    scheduledValue: '2026-08-29 09:00:00',
    timeEstimate: 45,
  }));

  assert.equal(created, recordFile);
  assert.equal(dailyNoteCalls, 0);
  assert.equal(sourceWriteCalls, 0);
  assert.equal(promotionCalls, 0);
  assert.equal(createInput.kind, 'task');
  assert.deepEqual(createInput.properties, {
    title: 'Standalone task',
    status: 'review',
    tags: ['work'],
    priority: 'high',
    scheduled: '2026-08-29 09:00:00',
    timeEstimate: 45,
  });
  assert.deepEqual(createInput.options.cause, {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'create-task-modal:standalone-native-task-record',
  });
  assert.deepEqual(opened, [recordFile.path]);
  assert.ok(Notice.messages.some((message) => message.includes('Created standalone task note')));
});

test('Legacy Create task rejects an impossible standalone request before resolving or writing a note', async () => {
  const { CreateTaskService, Notice } = await loadCreateTaskModules();
  Notice.messages.length = 0;
  let dailyNoteCalls = 0;
  let processCalls = 0;
  const plugin = {
    settings: {
      linkedSubitemCheckboxMappings: mappings(),
      autoSyncFileTimestamps: false,
    },
    sharedServices: { status: { normalize: normalizeStatus, getStatusOptions: () => ['todo', 'working', 'holding', 'complete', 'wont-do'] } },
    noteOperationService: { async ensureDailyNote() { dailyNoteCalls += 1; return null; } },
    app: { vault: { async process() { processCalls += 1; } } },
  };

  const created = await new CreateTaskService(plugin).createTask(taskResult({
    parentMode: 'standalone',
  }));

  assert.equal(created, null);
  assert.equal(dailyNoteCalls, 0);
  assert.equal(processCalls, 0);
  assert.ok(Notice.messages.some((message) => message.includes('require Atomic note')));
});

test('native Create task rejects a containing-note request before any task-line write', async () => {
  const { CreateTaskService, TFile, Notice } = await loadCreateTaskModules();
  Notice.messages.length = 0;
  const sourceFile = new TFile('Inbox/Tasks.md');
  let writes = 0;
  let recordCreations = 0;
  let dailyNoteCalls = 0;
  const plugin = {
    settings: { linkedSubitemCheckboxMappings: mappings() },
    nativeRecordService: {
      isEnabled: () => true,
      async createStandaloneTask() { recordCreations += 1; },
    },
    noteOperationService: { async ensureDailyNote() { dailyNoteCalls += 1; } },
    app: { vault: { async process() { writes += 1; } } },
  };

  const created = await new CreateTaskService(plugin).createTask(taskResult({
    createTrackedRecord: true,
    parentMode: 'note',
    targetFile: sourceFile,
  }));

  assert.equal(created, null);
  assert.equal(writes, 0);
  assert.equal(recordCreations, 0);
  assert.equal(dailyNoteCalls, 0);
  assert.ok(Notice.messages.some((message) => message.includes('standalone notes')));
});

test('Create task fails closed before any write when its native or legacy route changes while open', async () => {
  const { CreateTaskService, Notice } = await loadCreateTaskModules();
  Notice.messages.length = 0;
  for (const [expectedNative, currentNative] of [[true, false], [false, true]]) {
    let processCalls = 0;
    let dailyNoteCalls = 0;
    const plugin = {
      nativeRecordService: { isEnabled: () => currentNative },
      noteOperationService: {
        async ensureDailyNote() {
          dailyNoteCalls += 1;
          return null;
        },
      },
      app: {
        vault: {
          async process() { processCalls += 1; },
        },
      },
    };

    const created = await new CreateTaskService(plugin).createTask(taskResult({
      createTrackedRecord: expectedNative,
    }));

    assert.equal(created, null);
    assert.equal(processCalls, 0);
    assert.equal(dailyNoteCalls, 0);
  }
  assert.equal(Notice.messages.filter((message) => message.includes('mode changed')).length, 2);
});

test('native standalone Create task returns its created note when navigation fails', async () => {
  const { CreateTaskService, TFile, Notice } = await loadCreateTaskModules();
  Notice.messages.length = 0;
  const recordFile = new TFile('_records/tasks/created.md');
  let writes = 0;
  const plugin = {
    settings: { linkedSubitemCheckboxMappings: mappings(), autoSyncFileTimestamps: false },
    sharedServices: { status: { normalize: normalizeStatus, getStatusOptions: () => ['todo', 'working', 'holding', 'complete', 'wont-do'] } },
    nativeRecordService: {
      isEnabled: () => true,
      async create() { return { file: recordFile, path: recordFile.path }; },
    },
    app: { vault: { async process() { writes += 1; } } },
    noteOpeningService: { async present() { throw new Error('navigation failed'); } },
  };

  const created = await new CreateTaskService(plugin).createTask(taskResult({
    createTrackedRecord: true,
    parentMode: 'standalone',
  }));

  assert.equal(created, recordFile);
  assert.equal(writes, 0);
  assert.ok(Notice.messages.some((message) => message.includes('could not be opened automatically')));
});

test('manual create fails before target creation or processing when mappings are missing or stale', async () => {
  const { CreateTaskService } = await loadCreateTaskModules();
  let processCalls = 0;
  let dailyNoteCalls = 0;
  const plugin = {
    settings: {
      linkedSubitemCheckboxMappings: [{ checkboxState: '[oops]', statuses: ['todo'] }],
      autoSyncFileTimestamps: false,
    },
    sharedServices: { status: { normalize: normalizeStatus, getStatusOptions: () => ['todo', 'working', 'holding', 'complete', 'wont-do'] } },
    noteOperationService: { async ensureDailyNote() { dailyNoteCalls += 1; return null; } },
    app: { vault: { async process() { processCalls += 1; } }, workspace: {} },
  };
  const service = new CreateTaskService(plugin);

  assert.equal(await service.createTask(taskResult()), null);
  assert.equal(processCalls, 0);
  assert.equal(dailyNoteCalls, 0);
});

test('manual create preserves an explicitly selected alternate marker for the same status', async () => {
  const { CreateTaskService, TFile } = await loadCreateTaskModules();
  globalThis.window = { setTimeout: (callback) => callback(), moment: () => ({ format: () => '2026-08-02' }) };
  const file = new TFile('Inbox/Tasks.md');
  let content = '# Tasks\n';
  const plugin = {
    settings: {
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[o]', statuses: ['todo'], toggleTargetStatus: 'complete' },
        { checkboxState: '[?]', statuses: ['todo'], toggleTargetStatus: 'todo' },
        { checkboxState: '[d]', statuses: ['complete'], toggleTargetStatus: 'todo' },
      ],
      autoSyncFileTimestamps: false,
    },
    sharedServices: { status: { normalize: normalizeStatus, getStatusOptions: () => ['todo', 'working', 'holding', 'complete', 'wont-do'] } },
    noteOperationService: { async ensureDailyNote() { return file; } },
    app: {
      vault: {
        async process(_file, updater) { content = updater(content); },
        async cachedRead() { return content; },
      },
      workspace: { getLeaf: () => ({}) },
    },
    async openFileInLeaf() {},
    findOpenLeafForFile() { return null; },
  };
  const service = new CreateTaskService(plugin);

  assert.equal(await service.createTask(taskResult({
    targetFile: file,
    checkboxMarker: '?',
    checkboxStatus: 'todo',
    checkboxStatuses: ['todo'],
  })), file);
  assert.match(content, /- \[\?\] Mapped task/u);
});

test('manual create performs zero markdown writes when the selected semantic mapping changes at the process boundary', async () => {
  const { CreateTaskService, TFile } = await loadCreateTaskModules();
  globalThis.window = { setTimeout: (callback) => callback(), moment: () => ({ format: () => '2026-08-02' }) };
  const file = new TFile('Inbox/Tasks.md');
  let content = '# Tasks\n';
  let processCalls = 0;
  let markdownWrites = 0;
  const plugin = {
    settings: {
      linkedSubitemCheckboxMappings: mappings(),
      autoSyncFileTimestamps: false,
      dateCreatedFrontmatterKey: 'createdDate',
      dateModifiedFrontmatterKey: 'modifiedDate',
      fileTimestampFormat: 'YYYY-MM-DD HH:mm:ss',
    },
    sharedServices: { status: { normalize: normalizeStatus, getStatusOptions: () => ['todo', 'working', 'holding', 'complete', 'wont-do'] } },
    noteOperationService: { async ensureDailyNote() { return file; } },
    app: {
      vault: {
        async process(_file, updater) {
          processCalls += 1;
          plugin.settings.linkedSubitemCheckboxMappings = [
            { checkboxState: '[q]', statuses: ['todo'], toggleTargetStatus: 'complete' },
            { checkboxState: '[d]', statuses: ['complete'], toggleTargetStatus: 'todo' },
          ];
          const next = updater(content);
          if (next !== content) markdownWrites += 1;
          content = next;
        },
        async cachedRead() { return content; },
      },
      workspace: { getLeaf: () => ({}) },
    },
    async openFileInLeaf() {},
  };
  const service = new CreateTaskService(plugin);

  assert.equal(await service.createTask(taskResult({ targetFile: file })), null);
  assert.equal(processCalls, 1, 'the CAS must execute inside the atomic updater');
  assert.equal(markdownWrites, 0);
  assert.equal(content, '# Tasks\n');
});

test('manual create rejects ordered status-row drift captured while its modal was open', async () => {
  const { CreateTaskService, TFile } = await loadCreateTaskModules();
  const file = new TFile('Inbox/Tasks.md');
  let processCalls = 0;
  const plugin = {
    settings: {
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[o]', statuses: ['holding', 'todo'] },
        { checkboxState: '[d]', statuses: ['complete'] },
      ],
      autoSyncFileTimestamps: false,
    },
    sharedServices: { status: { normalize: normalizeStatus, getStatusOptions: () => ['todo', 'working', 'holding', 'complete', 'wont-do'] } },
    noteOperationService: { async ensureDailyNote() { return file; } },
    app: {
      vault: { async process() { processCalls += 1; } },
      workspace: {},
    },
  };
  const service = new CreateTaskService(plugin);

  assert.equal(await service.createTask(taskResult({
    targetFile: file,
    checkboxStatuses: ['todo', 'holding'],
  })), null);
  assert.equal(processCalls, 0);
});

function aiFixture(TFile, mappingRows = mappings()) {
  const target = new TFile('Inbox/Tasks.md');
  let content = '# Tasks\n';
  let processCalls = 0;
  let proposalCalls = 0;
  const api = {
    async proposeTaskCreation() {
      proposalCalls += 1;
      return {
        title: 'buy milk',
        targetFilePath: target.path,
        checkboxMarker: 'x',
        priority: '',
        scheduledValue: '',
        allDay: false,
        timeEstimate: 0,
        insertionStrategy: 'after_frontmatter',
        heading: '',
        rationale: '',
        confidence: 1,
        warnings: [],
      };
    },
  };
  const plugin = {
    settings: {
      linkedSubitemCheckboxMappings: mappingRows,
      autoSyncFileTimestamps: false,
      dateCreatedFrontmatterKey: 'createdDate',
      dateModifiedFrontmatterKey: 'modifiedDate',
      fileTimestampFormat: 'YYYY-MM-DD HH:mm:ss',
    },
    sharedServices: { status: { normalize: normalizeStatus, getStatusOptions: () => ['todo', 'working', 'holding', 'complete', 'wont-do'] } },
    app: {
      plugins: { plugins: { 'tps-ai-assistant': { api } } },
      internalPlugins: { plugins: {} },
      workspace: {
        getActiveFile: () => target,
        getLeaf: () => ({}),
      },
      vault: {
        getAllLoadedFiles: () => [target],
        getAbstractFileByPath: (path) => path === target.path ? target : null,
        async cachedRead() { return content; },
        async process(_file, updater) {
          processCalls += 1;
          content = updater(content);
        },
      },
    },
    fileNamingService: { getDailyNoteDateFormat: () => 'YYYY-MM-DD' },
    async openFileInLeaf() {},
  };
  return {
    plugin,
    target,
    get content() { return content; },
    get processCalls() { return processCalls; },
    get proposalCalls() { return proposalCalls; },
  };
}

test('AI proposals replace model checkbox guesses with the canonical semantic mapping', async () => {
  const { AiAssistedTaskService, TFile } = await loadCreateTaskModules();
  globalThis.window = { moment: () => ({ format: () => '2026-08-02' }) };
  const fixture = aiFixture(TFile);
  const service = new AiAssistedTaskService(fixture.plugin);

  const proposal = await service.propose('buy milk', [], null);
  assert.equal(proposal.checkboxMarker, 'o');
  assert.equal(fixture.proposalCalls, 1);
  assert.equal(await service.accept(proposal), fixture.target);
  assert.equal(fixture.processCalls, 1);
  assert.match(fixture.content, /- \[o\] buy milk/);
});

test('AI accepts only canonical Todo or Complete markers and performs zero writes otherwise', async () => {
  const { AiAssistedTaskService, TFile } = await loadCreateTaskModules();
  globalThis.window = { moment: () => ({ format: () => '2026-08-02' }) };
  const fixture = aiFixture(TFile);
  const service = new AiAssistedTaskService(fixture.plugin);
  const proposal = await fixture.plugin.app.plugins.plugins['tps-ai-assistant'].api.proposeTaskCreation();

  assert.equal(await service.accept(proposal), null);
  assert.equal(fixture.processCalls, 0);

  fixture.plugin.settings.linkedSubitemCheckboxMappings = [{ checkboxState: '[?]', statuses: ['holding'] }];
  await assert.rejects(() => service.propose('buy milk', [], null), /does not have a valid checkbox mapping/);
  assert.equal(fixture.proposalCalls, 1, 'mapping failure must happen before another model request');
  assert.equal(fixture.processCalls, 0);
});

test('AI accept performs zero markdown writes when its semantic mapping changes at the process boundary', async () => {
  const { AiAssistedTaskService, TFile } = await loadCreateTaskModules();
  globalThis.window = { moment: () => ({ format: () => '2026-08-02' }) };
  const fixture = aiFixture(TFile);
  const service = new AiAssistedTaskService(fixture.plugin);
  const proposal = await service.propose('buy milk', [], null);
  let content = '# Tasks\n';
  let processCalls = 0;
  let markdownWrites = 0;
  fixture.plugin.app.vault.process = async (_file, updater) => {
    processCalls += 1;
    fixture.plugin.settings.linkedSubitemCheckboxMappings = [
      { checkboxState: '[q]', statuses: ['todo'], toggleTargetStatus: 'complete' },
      { checkboxState: '[d]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    ];
    const next = updater(content);
    if (next !== content) markdownWrites += 1;
    content = next;
  };

  assert.equal(await service.accept(proposal), null);
  assert.equal(processCalls, 1, 'the CAS must execute inside the atomic updater');
  assert.equal(markdownWrites, 0);
  assert.equal(content, '# Tasks\n');
});

test('AI accept rejects ordered semantic-row drift captured by the proposal', async () => {
  const { AiAssistedTaskService, TFile } = await loadCreateTaskModules();
  globalThis.window = { moment: () => ({ format: () => '2026-08-02' }) };
  const fixture = aiFixture(TFile, [
    { checkboxState: '[o]', statuses: ['todo', 'holding'], toggleTargetStatus: 'complete' },
    { checkboxState: '[d]', statuses: ['complete'], toggleTargetStatus: 'todo' },
  ]);
  const service = new AiAssistedTaskService(fixture.plugin);
  const proposal = await service.propose('buy milk', [], null);
  fixture.plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[o]', statuses: ['holding', 'todo'], toggleTargetStatus: 'complete' },
    { checkboxState: '[d]', statuses: ['complete'], toggleTargetStatus: 'todo' },
  ];

  assert.equal(await service.accept(proposal), null);
  assert.equal(fixture.processCalls, 0);
});
