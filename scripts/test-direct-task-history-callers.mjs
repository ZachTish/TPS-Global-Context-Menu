import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const listSource = readFileSync(new URL('../src/tps-list/views/TpsListView.ts', import.meta.url), 'utf8');
const tableSource = readFileSync(new URL('../src/views/log-base-view.ts', import.meta.url), 'utf8');
const inlineSource = readFileSync(new URL('../src/services/inline-property-decoration-service.ts', import.meta.url), 'utf8');
const deleteSource = readFileSync(new URL('../src/services/line-item-delete-service.ts', import.meta.url), 'utf8');
const taskLineContextSource = readFileSync(
  new URL('../src/services/task-line-context-menu-service.ts', import.meta.url),
  'utf8',
);

async function loadBundledModule(relativePath, namespace) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace }));
        builder.onLoad({ filter: /.*/, namespace }, () => ({
          contents: `
            class Dummy {}
            class TFile {
              static [Symbol.hasInstance](value) {
                return Boolean(value && typeof value === 'object' && typeof value.path === 'string');
              }
              constructor(path = '') {
                this.path = String(path);
                this.name = this.path.split('/').at(-1) || this.path;
                this.basename = this.name.replace(/\\.[^.]+$/, '');
                this.extension = this.name.includes('.') ? this.name.split('.').at(-1) : '';
              }
            }
            const api = new Proxy(
              {
                App: Dummy,
                BasesView: Dummy,
                Component: Dummy,
                FileView: Dummy,
                FuzzySuggestModal: Dummy,
                ItemView: Dummy,
                MarkdownView: Dummy,
                Menu: Dummy,
                Modal: Dummy,
                Notice: Dummy,
                Plugin: Dummy,
                TFile,
                WorkspaceLeaf: Dummy,
                normalizePath: (value) => String(value),
                parseYaml: (value) => JSON.parse(value),
              },
              { get(target, key) { return key in target ? target[key] : Dummy; } },
            );
            module.exports = api;
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function createHistoryRecorder(events) {
  return {
    async beginTaskMutation(input) {
      events.push({ type: 'begin', input });
      return { operationId: 'history-op', entityId: 'history-id' };
    },
    ensureTaskIdentity(_handle, line) {
      events.push({ type: 'ensure', line });
      return `${line} [tpsId:: history-id]`;
    },
    async commitTaskMutation(_handle, input) {
      events.push({ type: 'commit', input });
    },
    async abortTaskMutation() {
      events.push({ type: 'abort' });
    },
  };
}

function createEditorDoc(content) {
  const text = String(content);
  const lines = text.split('\n');
  return {
    lines: lines.length,
    toString: () => text,
    line(number) {
      const index = number - 1;
      let from = 0;
      for (let current = 0; current < index; current += 1) from += lines[current].length + 1;
      const lineText = lines[index];
      if (lineText == null) throw new RangeError(`Missing line ${number}`);
      return { number, from, to: from + lineText.length, text: lineText };
    },
  };
}

test('direct task history callers declare task-only surfaces and atomic identity hooks', () => {
  assert.match(listSource, /surface: 'tps-list'/u);
  assert.match(listSource, /action: 'task\.checkbox'/u);
  assert.match(listSource, /action: 'task\.update'/u);
  assert.match(tableSource, /surface: 'tps-table'/u);
  assert.match(tableSource, /parseTaskLine\(entry\.line\)[\s\S]*?beginDirectTaskHistory/u);
  assert.match(tableSource, /taskHistory:[\s\S]*?surface: 'delete'/u);
  assert.match(inlineSource, /surface: 'inline-property'/u);
  assert.match(inlineSource, /resolveEditorSourceFile\(view: EditorView\)/u);
  const editorBranch = inlineSource.match(/if \(targetLine\.kind === 'editor'\)[\s\S]*?\n      return;\n    }/)?.[0] || '';
  assert.match(editorBranch, /targetLine\.view\.dispatch\([\s\S]*?insert: nextLine/u);
  assert.doesNotMatch(editorBranch, /beginDirectTaskHistory|commitDirectTaskHistory|ensureDirectTaskHistoryIdentity/u);
  assert.match(deleteSource, /parseTaskLine\(target\.rawLine\)[\s\S]*?beginDirectTaskHistory/u);
  assert.match(deleteSource, /vault\.process\([\s\S]*?ensureDirectTaskHistoryIdentity/u);
  assert.match(
    taskLineContextSource,
    /Bullet — No status[\s\S]{0,900}historyTerminalDelete: true/u,
    'task-to-bullet conversion must explicitly close the selected task history',
  );
});

test('task context Status menu exposes the shared task-to-bullet action', async () => {
  const { TaskLineContextMenuService, truncateTaskMenuLabel } = await loadBundledModule(
    '../src/services/task-line-context-menu-service.ts',
    'direct-history-task-status-bullet-menu',
  );
  class TestMenuItem {
    constructor() {
      this.title = '';
      this.submenu = null;
      this.click = null;
    }
    setTitle(title) { this.title = String(title); return this; }
    setIcon() { return this; }
    setChecked() { return this; }
    setSection() { return this; }
    onClick(callback) { this.click = callback; return this; }
    setSubmenu() { this.submenu = new TestMenu(); return this.submenu; }
  }
  class TestMenu {
    constructor() {
      this.items = [];
      this.classes = new Set();
      this.dom = { classList: { add: (value) => this.classes.add(value) } };
    }
    addItem(callback) {
      const item = new TestMenuItem();
      callback(item);
      this.items.push(item);
      return this;
    }
    addSeparator() { return this; }
  }

  const plugin = {
    settings: {
      properties: [],
      showCustomPropertiesInContextMenu: false,
      enableTimeTracking: false,
    },
    noteTitleRenderService: { getDisplayTitle: () => 'Source note' },
  };
  const service = new TaskLineContextMenuService(plugin);
  service.getCheckboxMappings = () => [{
    checkboxState: '[ ]',
    statuses: ['todo'],
    label: 'Todo',
    icon: 'square',
  }];
  service.getCheckboxMutationSignature = () => 'status-menu-signature';
  service.getStatusForCheckboxToken = () => 'todo';
  service.getContextTaskTitle = () => 'A task title that is deliberately much longer than the menu limit';
  const conversions = [];
  service.convertTaskToBullet = async (context, signature) => {
    conversions.push({ context, signature });
    return true;
  };
  const context = {
    file: { path: 'Inbox/Status bullet.md', basename: 'Status bullet' },
    lineIndex: 0,
    lineNumber: 1,
    rawLine: '- [ ] A task title that is deliberately much longer than the menu limit',
    title: 'A task title that is deliberately much longer than the menu limit',
    checkboxToken: '[ ]',
    isCalendarTask: false,
    calendarAllDay: false,
  };
  const menu = new TestMenu();

  service.addTaskLineMenuItems(menu, context, { includeNoteActions: false });

  const titleItem = menu.items.find((item) => item.title.startsWith('Title:'));
  assert.equal(titleItem.title, truncateTaskMenuLabel(`Title: ${context.title}`));
  assert.equal(Array.from(titleItem.title).length, 25);
  assert.equal(titleItem.title.endsWith('…'), true);
  assert.equal(menu.items.every((item) => Array.from(item.title).length <= 25), true);
  const statusItem = menu.items.find((item) => item.title === 'Status: todo');
  assert.ok(statusItem?.submenu, 'the task Status row should own a submenu');
  const bulletItem = statusItem.submenu.items.find((item) => item.title === 'Bullet — No status');
  assert.ok(bulletItem?.click, 'the Status submenu should expose task-to-bullet conversion');
  assert.equal(menu.classes.has('tps-gcm-task-line-menu'), true);
  assert.equal(statusItem.submenu.classes.has('tps-gcm-task-line-menu'), true);

  bulletItem.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(conversions, [{ context, signature: 'status-menu-signature' }]);
});

test('task-menu timer duplication adopts and commits its history identity in the atomic create write', async () => {
  const { TaskLineContextMenuService } = await loadBundledModule(
    '../src/services/task-line-context-menu-service.ts',
    'direct-history-task-menu-timer-duplicate',
  );
  const events = [];
  const file = { path: 'Inbox/Timer duplicate.md', basename: 'Timer duplicate' };
  let content = '- [ ] Timed source [scheduled:: 2026-08-14 09:00:00]';
  const plugin = {
    itemHistoryService: createHistoryRecorder(events),
    settings: { autoSyncFileTimestamps: false },
    app: {
      vault: {
        process: async (_file, updater) => {
          events.push({ type: 'process:start' });
          content = updater(content);
          events.push({ type: 'process:end' });
          return content;
        },
      },
    },
    eventService: { emitFilesUpdated() {} },
    overlayRenderingService: { invalidate() {} },
  };
  const service = new TaskLineContextMenuService(plugin);
  service.getCheckboxMappings = () => [{ checkboxState: '[ ]', statuses: ['todo'] }];
  service.getCheckboxMutationSignature = () => 'timer-mapping';
  service.resolveTaskCreationCheckboxState = () => '[ ]';
  service.resolveLineIndex = () => 0;
  service.buildTimerDuplicateTaskLine = () => '- [ ] Timer duplicate';

  const duplicate = await service.duplicateTaskBelowForTimer({
    file,
    lineIndex: 0,
    lineNumber: 1,
    rawLine: content,
    title: 'Timed source',
    checkboxToken: '[ ]',
    isCalendarTask: true,
    calendarAllDay: false,
  });

  assert.equal(content, [
    '- [ ] Timed source [scheduled:: 2026-08-14 09:00:00]',
    '- [ ] Timer duplicate [tpsId:: history-id]',
  ].join('\n'));
  assert.equal(duplicate?.rawLine, '- [ ] Timer duplicate [tpsId:: history-id]');
  assert.equal(duplicate?.lineIndex, 1);
  assert.deepEqual(events.map((event) => event.type), [
    'begin',
    'process:start',
    'ensure',
    'process:end',
    'commit',
  ]);
  assert.deepEqual(events[0].input, {
    action: 'task.create',
    cause: {
      kind: 'user',
      sourcePluginId: 'tps-global-context-menu',
      surface: 'task-timer-duplicate',
    },
    before: {
      path: file.path,
      lineNumber: 1,
      rawLine: '- [ ] Timer duplicate',
    },
  });
  assert.deepEqual(events.at(-1).input, {
    after: {
      path: file.path,
      lineNumber: 1,
      rawLine: '- [ ] Timer duplicate [tpsId:: history-id]',
    },
    outcome: 'committed',
  });
});

test('task-menu timer duplication aborts history when the persisted result does not confirm the inserted task', async () => {
  const { TaskLineContextMenuService } = await loadBundledModule(
    '../src/services/task-line-context-menu-service.ts',
    'direct-history-task-menu-timer-duplicate-unconfirmed',
  );
  const events = [];
  const file = { path: 'Inbox/Unconfirmed timer duplicate.md', basename: 'Unconfirmed timer duplicate' };
  const content = '- [ ] Timed source [scheduled:: 2026-08-14 09:00:00]';
  const plugin = {
    itemHistoryService: createHistoryRecorder(events),
    settings: { autoSyncFileTimestamps: false },
    app: {
      vault: {
        process: async (_file, updater) => {
          events.push({ type: 'process:start' });
          updater(content);
          events.push({ type: 'process:end' });
          return content;
        },
      },
    },
    eventService: { emitFilesUpdated() {} },
    overlayRenderingService: { invalidate() {} },
  };
  const service = new TaskLineContextMenuService(plugin);
  service.getCheckboxMappings = () => [{ checkboxState: '[ ]', statuses: ['todo'] }];
  service.getCheckboxMutationSignature = () => 'timer-mapping';
  service.resolveTaskCreationCheckboxState = () => '[ ]';
  service.resolveLineIndex = () => 0;
  service.buildTimerDuplicateTaskLine = () => '- [ ] Timer duplicate';

  const duplicate = await service.duplicateTaskBelowForTimer({
    file,
    lineIndex: 0,
    lineNumber: 1,
    rawLine: content,
    title: 'Timed source',
    checkboxToken: '[ ]',
    isCalendarTask: true,
    calendarAllDay: false,
  });

  assert.equal(duplicate, null);
  assert.deepEqual(events.map((event) => event.type), [
    'begin',
    'process:start',
    'ensure',
    'process:end',
    'abort',
  ]);
  assert.equal(events.some((event) => event.type === 'commit'), false);
});

test('Quick Editor task-to-bullet conversion records a terminal task deletion without tagging the bullet', async () => {
  const { TaskLineContextMenuService } = await loadBundledModule(
    '../src/services/task-line-context-menu-service.ts',
    'direct-history-task-menu-bullet-conversion',
  );
  const events = [];
  const file = { path: 'Inbox/Bullet conversion.md', basename: 'Bullet conversion' };
  let content = '- [ ] Convert this task';
  const plugin = {
    itemHistoryService: createHistoryRecorder(events),
    settings: { autoSyncFileTimestamps: false },
    app: {
      vault: {
        process: async (_file, updater) => {
          events.push({ type: 'process:start' });
          content = updater(content);
          events.push({ type: 'process:end' });
          return content;
        },
      },
    },
    taskCheckboxHandler: {
      async handleExternalChecklistStateMutation() {
        events.push({ type: 'followup' });
      },
    },
    eventService: { emitFilesUpdated() {} },
    overlayRenderingService: { invalidate() {} },
  };
  const service = new TaskLineContextMenuService(plugin);
  service.resolveLineIndex = () => 0;
  service.getCheckboxMappings = () => [{ checkboxState: '[ ]', statuses: ['todo'] }];
  service.getCheckboxMutationSignature = () => 'bullet-mapping';
  service.getCompleteMarkers = () => ['x'];
  const context = {
    file,
    lineIndex: 0,
    lineNumber: 1,
    rawLine: content,
    title: 'Convert this task',
    checkboxToken: '[ ]',
    isCalendarTask: false,
    calendarAllDay: false,
  };

  const changed = await service.updateTaskLine(
    context,
    (line) => line.replace(/^(-\s+)\[[^\]]*\]\s*/u, '$1'),
    {
      checkboxMutation: true,
      expectedMappingSignature: 'bullet-mapping',
      historyTerminalDelete: true,
    },
  );

  assert.equal(changed, true);
  assert.equal(content, '- Convert this task');
  assert.doesNotMatch(content, /tpsId::/u);
  assert.equal(events.some((event) => event.type === 'ensure'), false);
  assert.deepEqual(events.map((event) => event.type), [
    'begin',
    'process:start',
    'process:end',
    'followup',
    'commit',
  ]);
  assert.equal(events[0].input.action, 'task.delete');
  assert.equal(events[0].input.cause.surface, 'task-line-context-menu');
  assert.deepEqual(events.at(-1).input, {
    confirmedBefore: {
      path: file.path,
      lineNumber: 0,
      rawLine: '- [ ] Convert this task',
    },
    sourceDisposition: 'removed',
    outcome: 'committed',
  });
});

test('TPS List root creation journals tasks with an atomic identity while leaving bullets untracked', async () => {
  const { TpsListView } = await loadBundledModule(
    '../src/tps-list/views/TpsListView.ts',
    'direct-history-list-create',
  );

  const runCreate = async (itemKind) => {
    const events = [];
    const file = {
      path: `Inbox/List ${itemKind}.md`,
      name: `List ${itemKind}.md`,
      basename: `List ${itemKind}`,
      extension: 'md',
      parent: { path: 'Inbox' },
    };
    let content = 'Existing line';
    let filteredLine = '';
    const plugin = {
      itemHistoryService: createHistoryRecorder(events),
      settings: { openTaskDestinationAfterCreate: false },
    };
    const view = Object.create(TpsListView.prototype);
    view.plugin = plugin;
    view.app = {
      vault: {
        process: async (_file, updater) => {
          events.push({ type: 'process:start' });
          content = updater(content);
          events.push({ type: 'process:end' });
          return content;
        },
      },
      plugins: { getPlugin: () => null, plugins: {} },
      workspace: { trigger() {} },
    };
    view.promptForRootLineTitle = async () => `Created ${itemKind}`;
    view.buildRootTaskLine = () => itemKind === 'task'
      ? '- [ ] Created task'
      : '- Created bullet';
    view.normalizeTaskStatus = (value) => String(value || '').trim().toLowerCase();
    view.normalizeCheckboxState = (value) => String(value || '').trim();
    view.parseLineItem = (line) => /^- \[ \] /u.test(line)
      ? { itemKind: 'task', checkboxState: '[ ]', text: line }
      : { itemKind: 'bullet', text: line };
    view.resolveRootTaskTargetFile = async () => file;
    view.getCheckboxStateForStatus = (status) => status === 'todo' ? '[ ]' : null;
    view.getStatusForCheckboxState = (state) => state === '[ ]' ? 'todo' : '';
    view.lineMatchesCreationFilters = (line) => {
      filteredLine = line;
      events.push({ type: 'filter', line });
      return true;
    };
    view.clearTaskCachesForPath = () => undefined;
    view.queuePostCreateRefresh = () => undefined;

    await view.createRootTaskForLane(
      null,
      { id: 'ungrouped', label: 'Ungrouped', groups: [], laneIds: ['ungrouped'] },
      { mode: itemKind === 'task' ? 'tasks' : 'bullets' },
      itemKind,
      [],
      {
        mode: itemKind === 'task' ? 'tasks' : 'bullets',
        status: itemKind === 'task' ? 'todo' : null,
        inlineFields: new Map(),
        tags: new Set(),
        excludedStatuses: new Set(),
        excludedTags: new Set(),
      },
    );
    return { content, events, file, filteredLine };
  };

  const task = await runCreate('task');
  assert.equal(task.content, 'Existing line\n- [ ] Created task [tpsId:: history-id]\n');
  assert.equal(task.filteredLine, '- [ ] Created task [tpsId:: history-id]');
  assert.deepEqual(task.events.map((event) => event.type), [
    'begin',
    'process:start',
    'ensure',
    'filter',
    'process:end',
    'commit',
  ]);
  assert.deepEqual(task.events[0].input, {
    action: 'task.create',
    cause: {
      kind: 'user',
      sourcePluginId: 'tps-global-context-menu',
      surface: 'tps-list',
    },
    before: {
      path: task.file.path,
      lineNumber: 0,
      rawLine: '- [ ] Created task',
    },
  });
  assert.deepEqual(task.events.at(-1).input, {
    after: {
      path: task.file.path,
      lineNumber: 1,
      rawLine: '- [ ] Created task [tpsId:: history-id]',
    },
    outcome: 'committed',
  });

  const bullet = await runCreate('bullet');
  assert.equal(bullet.content, 'Existing line\n- Created bullet\n');
  assert.equal(bullet.filteredLine, '- Created bullet');
  assert.deepEqual(bullet.events.map((event) => event.type), [
    'process:start',
    'filter',
    'process:end',
  ]);
});

test('TPS Table creation journals tasks with an atomic identity while leaving bullets untracked', async () => {
  const { TpsTableView } = await loadBundledModule(
    '../src/views/log-base-view.ts',
    'direct-history-table-create',
  );

  const runCreate = async (kind) => {
    const events = [];
    const file = {
      path: `Inbox/Table ${kind}.md`,
      name: `Table ${kind}.md`,
      basename: `Table ${kind}`,
      extension: 'md',
      parent: { path: 'Inbox' },
      stat: { size: 0, ctime: 0, mtime: 0 },
    };
    let content = 'Existing line';
    let filteredLine = '';
    const view = Object.create(TpsTableView.prototype);
    view.containerEl = { closest: () => null };
    view.plugin = {
      itemHistoryService: createHistoryRecorder(events),
      settings: {
        properties: [],
        linkedSubitemCheckboxMappings: [
          { checkboxState: '[ ]', statuses: ['todo'] },
          { checkboxState: '[x]', statuses: ['done'] },
        ],
      },
      sharedServices: {
        status: {
          normalize: (value) => String(value || '').trim().toLowerCase(),
          isDoneStatus: (status) => status === 'done',
        },
      },
      resolveTpsBaseWriteFile: async () => ({
        file,
        reason: 'resolved',
        source: 'filter',
        path: file.path,
      }),
      app: {
        vault: {
          process: async (_file, updater) => {
            events.push({ type: 'process:start' });
            content = updater(content);
            events.push({ type: 'process:end' });
            return content;
          },
        },
      },
    };
    view.getEffectiveBaseFilterRoots = async () => [`kind == "${kind}"`];
    view.getBaseFile = () => null;
    view.getViewName = () => `${kind} creation`;
    view.getLineCreateContextPath = () => null;
    view.promptForLineTitle = async () => `Created ${kind}`;
    view.getDefaultMappedTaskStatus = () => 'todo';
    view.applyConfiguredSourceFileFields = (fields) => fields;
    view.createFilterContext = (fields, targetFile, line, rowKind, lineNumber) => {
      filteredLine = line;
      events.push({ type: 'filter', line });
      return {
        fields,
        file: {
          path: targetFile.path,
          name: targetFile.name,
          basename: targetFile.basename,
          extension: targetFile.extension,
          folder: targetFile.parent?.path || '',
          tags: [],
          frontmatter: {},
        },
        rowKind,
        rawLine: line,
        lineNumber,
        formulaFailed: false,
        filterFailed: false,
      };
    };
    view.queueRender = () => undefined;

    const handled = await view.createLineForView();
    return { content, events, file, filteredLine, handled };
  };

  const task = await runCreate('task');
  assert.equal(task.handled, true);
  assert.equal(task.content, 'Existing line\n- [ ] Created task [tpsId:: history-id]\n');
  assert.equal(task.filteredLine, '- [ ] Created task [tpsId:: history-id]');
  assert.deepEqual(task.events.map((event) => event.type), [
    'begin',
    'process:start',
    'ensure',
    'filter',
    'process:end',
    'commit',
  ]);
  assert.equal(task.events[0].input.action, 'task.create');
  assert.equal(task.events[0].input.cause.surface, 'tps-table');
  assert.deepEqual(task.events.at(-1).input, {
    after: {
      path: task.file.path,
      lineNumber: 1,
      rawLine: '- [ ] Created task [tpsId:: history-id]',
    },
    outcome: 'committed',
  });

  const bullet = await runCreate('bullet');
  assert.equal(bullet.handled, true);
  assert.equal(bullet.content, 'Existing line\n- Created bullet\n');
  assert.equal(bullet.filteredLine, '- Created bullet');
  assert.deepEqual(bullet.events.map((event) => event.type), [
    'process:start',
    'filter',
    'process:end',
  ]);
});

test('TPS List checkbox writes identity and history in the same successful mutation', async () => {
  const { TpsListView } = await loadBundledModule('../src/tps-list/views/TpsListView.ts', 'direct-history-list');
  const view = Object.create(TpsListView.prototype);
  const events = [];
  const file = { path: 'Inbox/List history.md' };
  let content = '- [ ] Original task';
  view.plugin = { itemHistoryService: createHistoryRecorder(events) };
  view.app = {
    vault: {
      process: async (_file, updater) => {
        events.push({ type: 'process:start' });
        content = updater(content);
        events.push({ type: 'process:end' });
      },
    },
    workspace: { trigger() {} },
  };
  view.normalizeCheckboxState = (value) => String(value || '').trim();
  view.getStatusForCheckboxState = (state) => state === '[ ]' ? 'todo' : state === '[x]' ? 'done' : null;
  view.getGcmCheckboxMappings = () => [
    { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'done' },
    { checkboxState: '[x]', statuses: ['done'], toggleTargetStatus: 'todo' },
  ];
  view.clearTaskCachesForPath = () => {};

  await TpsListView.prototype.updateTaskCheckboxState.call(
    view,
    file,
    1,
    '[x]',
    '[ ]',
    '- [ ] Original task',
  );

  assert.equal(content, '- [x] Original task [tpsId:: history-id]');
  assert.deepEqual(events.map((event) => event.type), [
    'begin',
    'process:start',
    'ensure',
    'process:end',
    'commit',
  ]);
  assert.deepEqual(events[0].input, {
    action: 'task.checkbox',
    cause: {
      kind: 'user',
      sourcePluginId: 'tps-global-context-menu',
      surface: 'tps-list',
    },
    before: {
      path: file.path,
      lineNumber: 0,
      rawLine: '- [ ] Original task',
    },
  });
  assert.equal(events.at(-1).input.after.rawLine, content);
  assert.equal(events.at(-1).input.after.lineNumber, 0);
  assert.equal(events.at(-1).input.sourceDisposition, 'retained');

  events.length = 0;
  content = '- [ ] Changed elsewhere';
  await TpsListView.prototype.updateTaskCheckboxState.call(
    view,
    file,
    1,
    '[x]',
    '[ ]',
    '- [ ] Original task',
  );
  assert.equal(content, '- [ ] Changed elsewhere');
  assert.deepEqual(events.map((event) => event.type), [
    'begin',
    'process:start',
    'process:end',
    'abort',
  ]);

  events.length = 0;
  content = '- [ ] Original task';
  view.plugin.itemHistoryService = {
    ...createHistoryRecorder(events),
    ensureTaskIdentity(_handle, line) {
      events.push({ type: 'ensure', line });
      throw new Error('Task history identity changed before the mutation was written.');
    },
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await TpsListView.prototype.updateTaskCheckboxState.call(
      view,
      file,
      1,
      '[x]',
      '[ ]',
      '- [ ] Original task',
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(content, '- [x] Original task', 'identity races must not block the requested content change');
  assert.deepEqual(events.map((event) => event.type), [
    'begin',
    'process:start',
    'ensure',
    'process:end',
    'abort',
  ]);
});

test('TPS List drop and rendered-property paths record tasks while leaving bullets untracked', async () => {
  const { TpsListView } = await loadBundledModule('../src/tps-list/views/TpsListView.ts', 'direct-history-list-writes');
  const view = Object.create(TpsListView.prototype);
  const events = [];
  const file = { path: 'Inbox/List direct writes.md' };
  let content = '- [ ] Drop task';
  view.plugin = { itemHistoryService: createHistoryRecorder(events) };
  view.app = {
    vault: {
      process: async (_file, updater) => {
        events.push({ type: 'process:start' });
        content = updater(content);
        events.push({ type: 'process:end' });
      },
    },
    workspace: { trigger() {} },
  };
  view.clearTaskCachesForPath = () => {};

  const dropped = await TpsListView.prototype.applyInlineTaskDropPlan.call(
    view,
    file,
    1,
    'project',
    'Alpha',
    [],
    {
      filterTags: [],
      filterStatus: null,
      currentLine: '- [ ] Drop task',
      nextLine: '- [ ] Drop task [project:: Alpha]',
    },
  );
  assert.equal(dropped, true);
  assert.equal(content, '- [ ] Drop task [project:: Alpha] [tpsId:: history-id]');
  assert.deepEqual(events.map((event) => event.type), [
    'begin',
    'process:start',
    'ensure',
    'process:end',
    'commit',
  ]);

  events.length = 0;
  content = '- [ ] Property task';
  const propertyChanged = await TpsListView.prototype.mutateRenderedTaskLine.call(
    view,
    file,
    1,
    content,
    'priority',
    'property-update',
    (line) => `${line} [priority:: high]`,
  );
  assert.equal(propertyChanged, true);
  assert.equal(content, '- [ ] Property task [priority:: high] [tpsId:: history-id]');
  assert.deepEqual(events.map((event) => event.type), [
    'begin',
    'process:start',
    'ensure',
    'process:end',
    'commit',
  ]);

  events.length = 0;
  content = '- Bullet';
  const bulletChanged = await TpsListView.prototype.mutateRenderedTaskLine.call(
    view,
    file,
    1,
    content,
    'priority',
    'property-update',
    (line) => `${line} [priority:: low]`,
  );
  assert.equal(bulletChanged, true);
  assert.equal(content, '- Bullet [priority:: low]');
  assert.deepEqual(events.map((event) => event.type), ['process:start', 'process:end']);
});

test('TPS Table records task row updates but leaves bullet rows outside history', async () => {
  const { TpsTableView } = await loadBundledModule('../src/views/log-base-view.ts', 'direct-history-table');
  const view = Object.create(TpsTableView.prototype);
  const events = [];
  const history = createHistoryRecorder(events);
  let content = '- [ ] Table task';
  view.plugin = {
    itemHistoryService: history,
    app: {
      vault: {
        process: async (_file, updater) => {
          events.push({ type: 'process:start' });
          content = updater(content);
          events.push({ type: 'process:end' });
        },
      },
    },
  };
  view.queueRender = () => {};
  const file = { path: 'Inbox/Table history.md' };
  const taskEntry = {
    id: 'task',
    selectionId: 'task',
    file,
    lineNumber: 0,
    line: content,
    title: 'Table task',
    fields: {},
  };

  const changed = await TpsTableView.prototype.updateEntryLine.call(
    view,
    taskEntry,
    (line) => `${line} [priority:: high]`,
  );
  assert.equal(changed, true);
  assert.equal(content, '- [ ] Table task [priority:: high] [tpsId:: history-id]');
  assert.deepEqual(events.map((event) => event.type), [
    'begin',
    'process:start',
    'ensure',
    'process:end',
    'commit',
  ]);
  assert.equal(events[0].input.cause.surface, 'tps-table');

  events.length = 0;
  content = '- Bullet row';
  const bulletEntry = { ...taskEntry, id: 'bullet', selectionId: 'bullet', line: content, title: 'Bullet row' };
  await TpsTableView.prototype.updateEntryLine.call(
    view,
    bulletEntry,
    (line) => `${line} [priority:: low]`,
  );
  assert.equal(content, '- Bullet row [priority:: low]');
  assert.deepEqual(events.map((event) => event.type), ['process:start', 'process:end']);
});

test('inline-property file task edits share the atomic write with identity adoption', async () => {
  const { InlinePropertyDecorationService } = await loadBundledModule(
    '../src/services/inline-property-decoration-service.ts',
    'direct-history-inline',
  );
  const service = Object.create(InlinePropertyDecorationService.prototype);
  const events = [];
  const file = { path: 'Inbox/Inline history.md' };
  let content = '- [ ] Inline task [priority:: low]';
  service.plugin = {
    itemHistoryService: createHistoryRecorder(events),
    app: {
      vault: {
        process: async (_file, updater) => {
          events.push({ type: 'process:start' });
          content = updater(content);
          events.push({ type: 'process:end' });
        },
      },
    },
  };
  const target = { kind: 'file', file, lineIndex: 0, lineText: content };

  await InlinePropertyDecorationService.prototype.replaceInlinePropertyLine.call(
    service,
    target,
    '- [ ] Inline task [priority:: high]',
  );

  assert.equal(content, '- [ ] Inline task [priority:: high] [tpsId:: history-id]');
  assert.equal(target.lineText, content);
  assert.deepEqual(events.map((event) => event.type), [
    'begin',
    'process:start',
    'ensure',
    'process:end',
    'commit',
  ]);
  assert.equal(events[0].input.cause.surface, 'inline-property');
  assert.equal(events.at(-1).input.after.rawLine, content);
});

test('inline editor changes remain unjournaled until a durable vault write can be confirmed', async () => {
  const { InlinePropertyDecorationService } = await loadBundledModule(
    '../src/services/inline-property-decoration-service.ts',
    'direct-history-inline-editor',
  );
  const originalLine = '- [ ] Inline task [priority:: low]';
  const nextLine = '- [ ] Inline task [priority:: high]';
  const service = Object.create(InlinePropertyDecorationService.prototype);
  const events = [];
  let dispatches = 0;
  const state = { doc: createEditorDoc(originalLine) };
  const view = {
    state,
    dispatch(transaction) {
      dispatches += 1;
      state.doc = createEditorDoc(transaction.changes.insert);
    },
  };
  service.plugin = { itemHistoryService: createHistoryRecorder(events) };
  const target = {
    kind: 'editor',
    view,
    file: { path: 'Inbox/Inline editor.md' },
    lineNumber: 1,
    lineFrom: 0,
    lineTo: originalLine.length,
    lineText: originalLine,
  };

  await InlinePropertyDecorationService.prototype.replaceInlinePropertyLine.call(
    service,
    target,
    nextLine,
  );

  assert.equal(dispatches, 1);
  assert.equal(state.doc.toString(), nextLine);
  assert.equal(target.lineText, nextLine);
  assert.deepEqual(events, [], 'editor-state dispatch must not claim durable item history');
  assert.doesNotMatch(nextLine, /tpsId::/u);
});

test('Home selected-task history ignores unchanged saves and commits changed lines from saved content', async () => {
  const { TpsHomeView } = await loadBundledModule('../src/views/home-view.ts', 'direct-history-home');
  const view = Object.create(TpsHomeView.prototype);
  const events = [];
  view.plugin = { itemHistoryService: createHistoryRecorder(events) };
  const file = { path: 'Inbox/Home selected task.md' };
  const before = '- [ ] Selected task [priority:: low]';

  const unchanged = await TpsHomeView.prototype.beginHomeTaskHistory.call(
    view,
    file,
    'update',
    before,
    before,
    0,
    'home-quick-capture-mobile',
  );
  assert.deepEqual(unchanged, []);
  assert.deepEqual(events, []);

  const next = '- [ ] Selected task [priority:: high]';
  const intents = await TpsHomeView.prototype.beginHomeTaskHistory.call(
    view,
    file,
    'update',
    before,
    next,
    0,
    'home-quick-capture-desktop',
  );
  const ensured = TpsHomeView.prototype.applyHomeTaskHistoryIdentities.call(view, next, intents);
  await TpsHomeView.prototype.commitHomeTaskHistory.call(view, intents, ensured);

  assert.equal(ensured, `${next} [tpsId:: history-id]`);
  assert.deepEqual(events.map((event) => event.type), ['begin', 'ensure', 'commit']);
  assert.equal(events[0].input.cause.surface, 'home-quick-capture-desktop');
  assert.equal(events.at(-1).input.after.rawLine, ensured);
  assert.equal(events.at(-1).input.after.lineNumber, 0);
  assert.equal(events.at(-1).input.sourceDisposition, 'retained');
});

test('line-item deletion commits task history after the atomic delete and ignores bullets', async () => {
  const { performLineItemDelete } = await loadBundledModule(
    '../src/services/line-item-delete-service.ts',
    'direct-history-delete',
  );
  const events = [];
  const history = createHistoryRecorder(events);
  const file = { path: 'Inbox/Delete history.md' };
  let content = '- [ ] Delete task';
  const app = {
    vault: {
      process: async (_file, updater) => {
        events.push({ type: 'process:start' });
        content = updater(content);
        events.push({ type: 'process:end' });
      },
    },
  };

  const result = await performLineItemDelete({
    app,
    file,
    lineIndex: 0,
    rawLine: content,
    itemLabel: 'task',
    source: 'test',
    taskHistory: {
      service: history,
      cause: {
        kind: 'user',
        sourcePluginId: 'tps-global-context-menu',
        surface: 'delete',
      },
    },
  }, 'delete-subtree', { showNotices: false });

  assert.equal(result.outcome, 'deleted');
  assert.equal(content, '');
  assert.deepEqual(events.map((event) => event.type), [
    'begin',
    'process:start',
    'ensure',
    'process:end',
    'commit',
  ]);
  assert.deepEqual(events.at(-1).input, {
    confirmedBefore: {
      path: 'Inbox/Delete history.md',
      lineNumber: 0,
      rawLine: '- [ ] Delete task',
    },
    sourceDisposition: 'removed',
    outcome: 'committed',
  });

  events.length = 0;
  content = '- Bullet';
  const bulletResult = await performLineItemDelete({
    app,
    file,
    lineIndex: 0,
    rawLine: content,
    itemLabel: 'record',
    source: 'test',
    taskHistory: {
      service: history,
      cause: {
        kind: 'user',
        sourcePluginId: 'tps-global-context-menu',
        surface: 'delete',
      },
    },
  }, 'delete-subtree', { showNotices: false });
  assert.equal(bulletResult.outcome, 'deleted');
  assert.deepEqual(events.map((event) => event.type), ['process:start', 'process:end']);
});

test('direct task history guards fail open and abort an uncommitted handle', async () => {
  const {
    beginDirectTaskHistory,
    commitDirectTaskHistory,
    ensureDirectTaskHistoryIdentity,
  } = await loadBundledModule('../src/utils/direct-task-history.ts', 'direct-history-guard');
  const context = {
    action: 'task.update',
    surface: 'tps-list',
    path: 'Inbox/Fail open.md',
    lineNumber: 0,
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const begin = await beginDirectTaskHistory({
      async beginTaskMutation() {
        throw new Error('unavailable');
      },
    }, {
      action: 'task.update',
      cause: { kind: 'user', sourcePluginId: 'tps-global-context-menu', surface: 'tps-list' },
      before: { path: context.path, lineNumber: 0, rawLine: '- [ ] Task' },
    });
    assert.equal(begin, null);

    const handle = { operationId: 'pending' };
    const ensured = ensureDirectTaskHistoryIdentity({
      ensureTaskIdentity() {
        throw new Error('identity unavailable');
      },
    }, handle, '- [ ] Task', context);
    assert.deepEqual(ensured, { line: '- [ ] Task', ready: false });

    let aborts = 0;
    await commitDirectTaskHistory({
      async commitTaskMutation() {
        throw new Error('commit unavailable');
      },
      async abortTaskMutation() {
        aborts += 1;
      },
    }, handle, { outcome: 'committed' }, context);
    assert.equal(aborts, 1);
  } finally {
    console.error = originalConsoleError;
  }
});
