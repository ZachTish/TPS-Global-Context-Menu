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
function fixture(records) {
  const files = records.map((record, index) => ({
    path: `Inbox/${record.name || `Note ${index}`}.md`,
    basename: record.name || `Note ${index}`, extension: 'md',
  }));
  const recordsByFile = new Map(files.map((file, index) => [file, records[index]]));
  const reads = [];
  let scans = 0;
  const manager = Object.assign(new module.Manager(), {
    plugin: {
      app: {
        vault: {
          getMarkdownFiles() { scans++; return files; },
          async cachedRead(file) { reads.push(file.path); return recordsByFile.get(file).body || ''; },
          read() { assert.fail('Calendar display must not request fresh disk reads'); },
        },
        metadataCache: { getFileCache(file) { return recordsByFile.get(file).cache; } },
      },
      settings: {},
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
  });
  return { manager, files, reads, scans: () => scans };
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
