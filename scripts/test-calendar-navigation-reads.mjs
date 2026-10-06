import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const managerPath = new URL('../src/menu/persistent-menu-manager.ts', import.meta.url);
const managerSource = ts.createSourceFile(managerPath.pathname, readFileSync(managerPath, 'utf8'), ts.ScriptTarget.Latest, true);
const methods = new Map();
function visit(node) {
  if (ts.isMethodDeclaration(node)) methods.set(node.name.getText(managerSource), node.getText(managerSource));
  ts.forEachChild(node, visit);
}
visit(managerSource);

// Execute the shipped parser and manager methods; only unrelated UI/external
// integrations are stubbed. No generated bundle or test runtime is written.
const modules = new Map();
function loadTypeScript(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const module = { exports: {} };
  modules.set(url.href, module.exports);
  const output = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const nativeRequire = createRequire(url);
  new Function('exports', 'module', 'require', output)(module.exports, module, (id) =>
    id.startsWith('.') ? loadTypeScript(new URL(`${id}.ts`, url)) : nativeRequire(id));
  return module.exports;
}
const taskMetadata = loadTypeScript(new URL('../src/utils/task-line-metadata.ts', import.meta.url));
const selectedMethods = [
  'countCalendarItemsOnDay', 'getCalendarItemsOnDay', 'collectScheduledTasksForCalendarItem',
  'collectTasksInFile', 'extractTasksFromContent', 'getCalendarTaskScheduledKeys',
  'parseInlineTaskProperties', 'dedupeCalendarPopoverItems', 'getCalendarPopoverItemPriority',
  'refreshCalendarButtonTimerState', 'renderCalendarButtonTimerState',
];
const output = ts.transpileModule(`export class Manager {
  ${selectedMethods.map((name) => {
    assert.ok(methods.has(name), name);
    return methods.get(name);
  }).join('\n')}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const module = {};
new Function('exports', 'parseTaskLine', 'getTaskDisplayTitle', 'resolveTaskScheduledValue', output)(
  module, taskMetadata.parseTaskLine, taskMetadata.getTaskDisplayTitle, () => undefined,
);

const date = new Date(2026, 8, 27, 12);
const scheduled = '2026-09-27T12:00:00';
function fixture(records, options = {}) {
  const files = records.map((record, index) => ({
    path: `Inbox/${record.name || `Note ${index}`}.md`,
    basename: record.name || `Note ${index}`, extension: 'md',
  }));
  const recordsByFile = new Map(files.map((file, index) => [file, records[index]]));
  const reads = [];
  let scans = 0;
  let metadataLookups = 0;
  let timerLookups = 0;
  const manager = Object.assign(new module.Manager(), {
    plugin: {
      app: {
        vault: {
          getMarkdownFiles() { scans++; return files; },
          async cachedRead(file) { reads.push(file.path); return recordsByFile.get(file).body || ''; },
          read() { assert.fail('Calendar display must not request fresh disk reads'); },
        },
        metadataCache: {
          getFileCache(file) { metadataLookups++; return recordsByFile.get(file).cache; },
        },
      },
      settings: { dataArchitectureMode: options.dataArchitectureMode ?? 'legacy' },
      usesNativeRecordArchitecture: () => options.dataArchitectureMode === 'native-records',
      timeTrackingService: {
        async getActiveTimersForFile() { timerLookups++; return options.getActiveTimers?.() ?? []; },
        getElapsedMsForSession: () => 60000,
        formatElapsed: () => '1:00',
      },
    },
    getCalendarBasePlugin: () => null,
    getExternalCalendarEventsForDay: async () => [],
    isDailyNoteFile: (_file, cache) => cache?.frontmatter?.daily === true,
    getScheduledDateFromFrontmatter: (frontmatter) => frontmatter.scheduled ? new Date(frontmatter.scheduled) : null,
    isDateOnSameLocalDay: (left, right) => left.toDateString() === right.toDateString(),
    parseScheduledValue: (value) => new Date(value),
    matchExternalEventForTaskMetadata: () => null,
    matchExternalEventForLocalFrontmatter: () => null,
    formatCalendarItemTime: () => '',
    getFileDisplayTitle: (file) => file.basename,
    resolveInlineTitleIconValue: () => null,
    resolveTitleIconColor: () => null,
    buildCalendarPopoverLocalSlotKey: (title, when) => `${title}:${when.getTime()}`,
    formatScheduledDayLabel: () => 'Sep 27',
  });
  return {
    manager, files, recordsByFile, reads, scans: () => scans,
    metadataLookups: () => metadataLookups,
    timerLookups: () => timerLookups,
  };
}

test('repeated calendar counts read no bodies for 1,000 indexed notes without checkbox tasks', async () => {
  const records = Array.from({ length: 1000 }, (_, index) => ({
    cache: index % 2 ? { listItems: [{ parent: -1 }] } : {}, body: 'Plain content\n- Ordinary bullet\n',
  }));
  records[10].cache.frontmatter = { scheduled };
  const f = fixture(records);
  for (let count = 0; count < 4; count++) assert.equal(await f.manager.countCalendarItemsOnDay(date), 1);
  assert.equal(f.scans(), 4, 'the existing metadata pass is retained');
  assert.equal(f.reads.length, 0, 'display counts must not load and parse unrelated note bodies');
});

test('scheduled notes and scheduled checkbox tasks keep their existing count and payloads', async () => {
  const f = fixture([
    { name: 'Meeting', cache: { frontmatter: { scheduled } }, body: 'Meeting notes' },
    { name: 'Daily', cache: { frontmatter: { daily: true, scheduled }, listItems: [{ task: ' ' }, { task: 'x' }] },
      body: `- [ ] Buy milk [scheduled:: ${scheduled}]\n- [x] Call [start:: ${scheduled}]\n- [ ] Unscheduled task` },
    { name: 'Plain', cache: {}, body: 'Nothing scheduled' },
  ]);
  const items = await f.manager.getCalendarItemsOnDay(date);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((item) => [item.kind, item.title, item.completed]), [
    ['task', 'Buy milk', false], ['task', 'Call', true], ['note', 'Meeting', undefined],
  ]);
  assert.deepEqual(f.reads, ['Inbox/Daily.md']);
  assert.equal(items[0].lineNumber, 0);
  assert.equal(items[1].lineNumber, 1);
  assert.match(items[0].rawLine, /^- \[ \] Buy milk/);
});

test('missing metadata remains an unknown source and still reads actual checkbox tasks', async () => {
  const f = fixture([
    { name: 'Unindexed', cache: null, body: `- [ ] New task [scheduled:: ${scheduled}]` },
    { name: 'Pending', cache: undefined, body: `- [/] In progress [scheduled:: ${scheduled}]` },
  ]);
  assert.equal(await f.manager.countCalendarItemsOnDay(date), 2);
  assert.deepEqual(f.reads, ['Inbox/Unindexed.md', 'Inbox/Pending.md']);
});

test('all string checkbox markers, including the empty marker, retain task reads', async () => {
  const f = fixture(['', ' ', 'x', '/'].map((marker, index) => ({
    name: `Task ${index}`, cache: { listItems: [{ task: marker }] },
    body: `- [${marker}] Item ${index} [scheduled:: ${scheduled}]`,
  })));
  assert.equal(await f.manager.countCalendarItemsOnDay(date), 4);
  assert.equal(f.reads.length, 4);
});

test('native calendar navigation selects note events without inspecting 4,000 historical checkbox bodies', async () => {
  const records = Array.from({ length: 4000 }, (_, index) => ({
    name: `Historical ${index}`,
    cache: { listItems: [{ task: ' ' }] },
    body: `- [ ] Old inline event ${index} [scheduled:: ${scheduled}]\nKeep authored history`,
  }));
  records.push({ name: 'Current meeting', cache: { frontmatter: { scheduled } }, body: 'Current note event' });
  const f = fixture(records, { dataArchitectureMode: 'native-records' });
  const items = await f.manager.getCalendarItemsOnDay(date);
  assert.equal(f.reads.length, 0, 'native event display must not read retired inline task bodies');
  assert.deepEqual(items.map(({ kind, title }) => [kind, title]), [['note', 'Current meeting']]);
});

test('initial and warm native calendar badge timer refreshes never query sources across four badges', async () => {
  const records = Array.from({ length: 4000 }, (_, index) => ({
    name: `Ordinary checkbox ${index}`,
    cache: { listItems: [{ task: ' ' }] },
    body: '- [ ] Unscheduled body task\nKeep body',
  }));
  records.push({ name: 'Meeting', cache: { frontmatter: { scheduled } }, body: 'Meeting notes' });
  const f = fixture(records, { dataArchitectureMode: 'native-records' });
  f.manager.calendarButtonTimerStates = new Set();
  const states = Array.from({ length: 4 }, () => ({
    file: f.files.at(-1), scheduledDate: date,
    labelEl: { isConnected: true, textContent: '' },
    buttonEl: { isConnected: true, title: '', classList: { add() {}, remove() {} } },
    count: null, sessionStart: null, activeCount: 0, lastFetchAt: 0, fetchInFlight: false,
  }));
  // Native badges expose the action without inventing a stale count. Only an
  // explicit popover invocation may query note and external-calendar sources.
  for (const state of states) {
    await f.manager.refreshCalendarButtonTimerState(state, true);
    assert.equal(state.count, null);
  }
  assert.deepEqual({ vaultInventories: f.scans(), bodyReads: f.reads.length, metadataLookups: f.metadataLookups() }, {
    vaultInventories: 0, bodyReads: 0, metadataLookups: 0,
  });
  for (let refresh = 0; refresh < 2; refresh++) {
    await Promise.all(states.map(state => f.manager.refreshCalendarButtonTimerState(state, false)));
  }
  assert.deepEqual({
    vaultInventories: f.scans(),
    bodyReads: f.reads.length,
    metadataLookups: f.metadataLookups(),
  }, { vaultInventories: 0, bodyReads: 0, metadataLookups: 0 });
  assert.equal(f.timerLookups(), 12, 'live elapsed timers must still refresh initially and periodically');
  assert.deepEqual(states.map(state => state.labelEl.textContent), Array(4).fill('Calendar'));
});

test('native calendar badge keeps elapsed timers live without retaining an old legacy count', async () => {
  let timers = [{ start: '2026-09-27T11:59:00' }, { start: '2026-09-27T11:59:30' }];
  const f = fixture([{ name: 'Meeting', cache: { frontmatter: { scheduled } } }], {
    dataArchitectureMode: 'native-records', getActiveTimers: () => timers,
  });
  const classes = new Set();
  const state = {
    file: f.files[0], scheduledDate: date,
    labelEl: { isConnected: true, textContent: '' },
    buttonEl: { isConnected: true, title: '', classList: {
      add: value => classes.add(value), remove: value => classes.delete(value),
    } },
    count: 99, sessionStart: null, activeCount: 0, lastFetchAt: 0, fetchInFlight: false,
  };
  await f.manager.refreshCalendarButtonTimerState(state, false);
  assert.equal(state.count, null);
  assert.equal(state.labelEl.textContent, '1:00 +1');
  assert.match(state.buttonEl.title, /^Calendar • running 1:00 plus 1 more$/u);
  assert.equal(classes.has('is-running-time'), true);
  timers = [];
  await f.manager.refreshCalendarButtonTimerState(state, false);
  assert.equal(state.labelEl.textContent, 'Calendar');
  assert.equal(classes.has('is-running-time'), false);
  assert.deepEqual({ vaultInventories: f.scans(), bodyReads: f.reads.length, metadataLookups: f.metadataLookups() }, {
    vaultInventories: 0, bodyReads: 0, metadataLookups: 0,
  });
});

test('explicit native calendar popovers use current note dates, creates and deletes after idle badge refreshes', async () => {
  const records = [{ name: 'Meeting', cache: { frontmatter: { scheduled } }, body: 'Keep note body' }];
  const f = fixture(records, { dataArchitectureMode: 'native-records' });
  assert.deepEqual((await f.manager.getCalendarItemsOnDay(date)).map(({ title }) => title), ['Meeting']);
  const tomorrow = new Date(2026, 8, 28, 12);
  records[0].cache.frontmatter.scheduled = '2026-09-28T12:00:00';
  assert.deepEqual(await f.manager.getCalendarItemsOnDay(date), []);
  assert.deepEqual((await f.manager.getCalendarItemsOnDay(tomorrow)).map(({ title }) => title), ['Meeting']);
  const created = { path: 'Inbox/Created.md', basename: 'Created', extension: 'md' };
  f.files.push(created);
  f.recordsByFile.set(created, { cache: { frontmatter: { scheduled } }, body: 'Fresh event note' });
  assert.deepEqual((await f.manager.getCalendarItemsOnDay(date)).map(({ title }) => title), ['Created']);
  f.files.splice(f.files.indexOf(created), 1);
  assert.deepEqual(await f.manager.getCalendarItemsOnDay(date), []);
  assert.equal(f.reads.length, 0);
});

test('legacy badge refreshes retain the live note and inline task count contract', async () => {
  const f = fixture([
    { name: 'Meeting', cache: { frontmatter: { scheduled } } },
    { name: 'Daily', cache: { frontmatter: { daily: true }, listItems: [{ task: ' ' }] }, body: `- [ ] Task [scheduled:: ${scheduled}]` },
  ]);
  const state = {
    file: f.files[0], scheduledDate: date,
    labelEl: { isConnected: true, textContent: '' },
    buttonEl: { isConnected: true, title: '', classList: { add() {}, remove() {} } },
    count: null, sessionStart: null, activeCount: 0, lastFetchAt: 0, fetchInFlight: false,
  };
  await f.manager.refreshCalendarButtonTimerState(state, true);
  assert.equal(state.count, 2);
  assert.equal(state.labelEl.textContent, 'Calendar (2)');
  f.files.splice(1, 1);
  await f.manager.refreshCalendarButtonTimerState(state, false);
  assert.equal(state.count, 1);
  assert.equal(state.labelEl.textContent, 'Calendar (1)');
  assert.deepEqual(f.reads, ['Inbox/Daily.md']);
});
