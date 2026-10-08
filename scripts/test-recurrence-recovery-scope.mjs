import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { parse, stringify } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const result = await build({
  stdin: { contents: "export { BulkEditService } from './src/services/bulk-edit-service.ts'; export { RecurrenceService } from './src/services/recurrence-service.ts'; export { TFile } from 'obsidian';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'recurrence-recovery-obsidian', setup(builder) {
    builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'recurrence-recovery' }));
    builder.onLoad({ filter: /.*/, namespace: 'recurrence-recovery' }, () => ({ loader: 'js', resolveDir: root, contents: `
      import { parse } from 'yaml';
      class Dummy { open() {} }
      class TFile { constructor(path) { this.path = path; this.name = path.split('/').pop(); this.basename = this.name.replace(/\\.md$/u, ''); this.extension = 'md'; } }
      module.exports = new Proxy({ TFile, App: Dummy, Modal: Dummy, Notice: Dummy, parseYaml: parse, normalizePath: value => String(value).replace(/\\\\/gu, '/').replace(/\\/{2,}/gu, '/') }, { get: (target, key) => key in target ? target[key] : Dummy });
    ` }));
  } }],
});
const module = { exports: {} };
new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
const { BulkEditService, RecurrenceService, TFile } = module.exports;

test('recurrence setup/unload never writes an empty session cache and cancels owned prompt/save timers', async () => {
  const timers = new Map(), callbacks = [], handlers = new Map(); let next = 0;
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout(fn) { timers.set(++next, fn); callbacks.push(fn); return next; }, clearTimeout(id) { timers.delete(id); } };
  let adapterCalls = 0, prompts = 0;
  const file = new TFile('Inbox/Template.md');
  const plugin = { settings: {}, manifest: { dir: '.obsidian/plugins/tps-global-context-menu' }, registerEvent() {}, app: {
    workspace: { on(name, fn) { handlers.set(name, fn); return {}; } },
    metadataCache: { getFileCache() { return { frontmatter: {} }; } },
    vault: { on() { return {}; }, getAbstractFileByPath: () => file,
      adapter: { exists: async () => { adapterCalls++; return false; }, read: async () => { adapterCalls++; return ''; }, write: async () => { adapterCalls++; } } },
  } };
  const service = new RecurrenceService(plugin);
  service.handleTemplateLeave = async () => { prompts++; };
  try {
    service.setup(); assert.equal(timers.size, 0); assert.equal(adapterCalls, 0);
    service.markFileAsModified(file.path);
    service.dirtyTemplates.add(file.path); service.lastActiveFilePath = file.path;
    handlers.get('active-leaf-change')({ view: { file: new TFile('Other.md') } });
    assert.equal(timers.size, 2);
    service.cleanup(); assert.equal(timers.size, 0);
    for (const callback of callbacks) await callback();
    assert.equal(adapterCalls, 0); assert.equal(prompts, 0);
  } finally { service.cleanup(); globalThis.window = previousWindow; }
});

test('unload during session-cache comparison cannot write afterward; active saves still persist', async () => {
  let callback; const previousWindow = globalThis.window;
  globalThis.window = { setTimeout(fn) { callback = fn; return 1; }, clearTimeout() {} };
  const waiting = deferred(); let writes = 0, reads = 0;
  const plugin = { settings: {}, manifest: { dir: '.obsidian/plugins/tps-global-context-menu' }, app: { vault: { adapter: {
    exists: async () => true,
    read: async () => { reads++; await waiting.promise; return '{}'; },
    write: async () => { writes++; },
  } } } };
  const service = new RecurrenceService(plugin);
  try {
    service.markFileAsModified('Inbox/One.md'); const saving = callback(); await flush();
    assert.equal(reads, 1); service.cleanup(); waiting.resolve(); await saving; assert.equal(writes, 0);
    service.markFileAsModified('Inbox/Two.md'); await callback(); assert.equal(writes, 1);
  } finally { service.cleanup(); globalThis.window = previousWindow; }
});

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function flush() { for (let n = 0; n < 20; n++) await Promise.resolve(); }

function harness(count = 10000) {
  const files = new Map();
  const counts = { inventory: 0, metadata: 0, reads: 0, writes: 0, lookups: 0 };
  const processed = [];
  let readHook = async () => {};
  let createHook = async () => {};
  const add = (path, frontmatter = {}, source) => {
    const file = Object.assign(new TFile(path), { frontmatter, source: source ?? `---\n${stringify(frontmatter)}---\nBody` }); files.set(path, file); return file;
  };
  for (let n = 0; n < count; n++) add(`Inbox/ordinary-${n}.md`, { title: 'Ordinary' });
  const plugin = {
    settings: { enableRecurrence: true, recurrenceCompletionStatuses: ['done'], recurringTemplateFolder: '', templateIdentificationTag: 'template' },
    app: {
      vault: {
        getMarkdownFiles: () => { counts.inventory++; return [...files.values()]; },
        getAbstractFileByPath: path => { counts.lookups++; return files.get(path) ?? null; },
        read: async file => { counts.reads++; await readHook(file); return file.source; },
      },
      metadataCache: {
        getFileCache: file => { counts.metadata++; return { frontmatter: file.frontmatter }; },
        getFirstLinkpathDest: path => files.get(path) ?? files.get(`${path}.md`) ?? null,
      },
    },
    filePropertiesService: { isCompanionFile: file => file.companion === true },
  };
  const service = new BulkEditService(plugin);
  service.isConfiguredDailyNoteTemplate = async file => file.dailyTemplate === true;
  service.shouldSkipNoteLevelRecurrence = async file => file.daily === true;
  service.createNextRecurrenceInstance = async (file, fm) => { processed.push([file.path, fm.status]); await createHook(file); counts.writes++; return true; };
  return { service, plugin, files, add, counts, processed,
    readHook: action => { readHook = action; }, createHook: action => { createHook = action; } };
}
const recurring = status => ({ recurrenceRule: 'FREQ=DAILY', scheduled: '2026-10-07 09:00:00', status });

test('scoped ordinary paths perform no inventory, body reads or mutation attempts', async () => {
  const h = harness();
  await h.service.checkMissingRecurrences(['Inbox/ordinary-4.md', 'Inbox/ordinary-7.md']);
  assert.deepEqual(h.counts, { inventory: 0, metadata: 2, reads: 0, writes: 0, lookups: 2 });
});

test('empty scope and disabled recovery do no work', async () => {
  const h = harness();
  await h.service.checkMissingRecurrences([]);
  h.plugin.settings.enableRecurrence = false;
  await h.service.checkMissingRecurrences();
  await h.service.checkMissingRecurrences(['Inbox/ordinary-4.md']);
  assert.deepEqual(h.counts, { inventory: 0, metadata: 0, reads: 0, writes: 0, lookups: 0 });
});

test('targeted completed recurrence retains configured status and deduplicates normalized paths', async () => {
  const h = harness(); const file = h.add('Inbox/Recurring.md', recurring('DONE'));
  await h.service.checkMissingRecurrences([file.path, ` ${file.path} `, 'Inbox//Recurring.md', file.path]);
  assert.deepEqual(h.processed, [[file.path, 'DONE']]);
  assert.deepEqual(h.counts, { inventory: 0, metadata: 1, reads: 1, writes: 1, lookups: 1 });
});

test('startup without arguments preserves full recovery', async () => {
  const h = harness(); h.add('Inbox/Recurring.md', recurring('done'));
  await h.service.checkMissingRecurrences();
  assert.equal(h.counts.inventory, 1); assert.equal(h.counts.metadata, 10001);
  assert.equal(h.counts.lookups, 0); assert.equal(h.counts.reads, 1); assert.equal(h.counts.writes, 1);
});

test('scoped recovery preserves recurrence inherited from a linked series template', async () => {
  const h = harness(); const template = h.add('Templates/Series.md', recurring('open'));
  const file = h.add('Inbox/Instance.md', { recurrenceTemplate: `[[${template.path}]]`, status: 'done', scheduled: '2026-10-07 09:00:00' });
  await h.service.checkMissingRecurrences([file.path]);
  assert.deepEqual(h.processed, [[file.path, 'done']]);
  assert.equal(h.counts.inventory, 0); assert.equal(h.counts.metadata, 3); assert.equal(h.counts.reads, 1); assert.equal(h.counts.writes, 1);
});

test('scoped arrivals during full startup are retained and observe later metadata', async () => {
  const h = harness(0); const first = h.add('Inbox/First.md', recurring('done'));
  const later = h.add('Inbox/Later.md', recurring('open')); const gate = deferred();
  h.readHook(async file => { if (file === later && h.counts.reads === 2) await gate.promise; });
  const startup = h.service.checkMissingRecurrences(); await flush();
  first.frontmatter = recurring('done-later'); first.source = `---\n${stringify(first.frontmatter)}---\nBody`;
  h.plugin.settings.recurrenceCompletionStatuses.push('done-later');
  const arrivals = [h.service.checkMissingRecurrences([first.path]), h.service.checkMissingRecurrences([first.path])];
  await flush(); assert.equal(h.counts.inventory, 1); assert.equal(h.counts.reads, 2);
  gate.resolve(); await Promise.all([startup, ...arrivals]);
  assert.deepEqual(h.processed, [[first.path, 'done'], [first.path, 'done-later']]);
  assert.equal(h.counts.inventory, 1); assert.equal(h.counts.metadata, 3); assert.equal(h.counts.lookups, 1);
});

test('full requests supersede pending scoped paths and coalesce before dispatch', async () => {
  const h = harness(2); const file = h.add('Inbox/Recurring.md', recurring('done'));
  await Promise.all([h.service.checkMissingRecurrences([file.path]), h.service.checkMissingRecurrences(), h.service.checkMissingRecurrences(), h.service.checkMissingRecurrences([file.path])]);
  assert.equal(h.counts.inventory, 1); assert.equal(h.counts.lookups, 0); assert.equal(h.counts.metadata, 3);
  assert.equal(h.processed.length, 1);
});

test('full request arriving during a scoped pass takes over the pending pass', async () => {
  const h = harness(0); const first = h.add('Inbox/First.md', recurring('done')); const second = h.add('Inbox/Second.md', recurring('done')); const gate = deferred();
  h.createHook(async file => { if (file === first && h.processed.length === 1) await gate.promise; });
  const active = h.service.checkMissingRecurrences([first.path]); await flush();
  const scoped = h.service.checkMissingRecurrences([second.path]); const full = h.service.checkMissingRecurrences();
  gate.resolve(); await Promise.all([active, scoped, full]);
  assert.equal(h.counts.inventory, 1); assert.equal(h.counts.lookups, 1);
  assert.deepEqual(h.processed.map(row => row[0]), [first.path, first.path, second.path]);
});

test('missing paths, companion notes, unsafe source and daily exclusions remain skipped', async () => {
  const h = harness(0);
  const companion = Object.assign(h.add('Inbox/Companion.md', recurring('done')), { companion: true });
  const unsafe = h.add('Inbox/Unsafe.md', recurring('done'), '---\ntags: [broken\n---\n');
  const daily = Object.assign(h.add('Inbox/Daily.md', recurring('done')), { daily: true });
  const template = Object.assign(h.add('Inbox/Daily template.md', recurring('done')), { dailyTemplate: true });
  await h.service.checkMissingRecurrences(['Gone.md', companion.path, unsafe.path, daily.path, template.path]);
  assert.equal(h.counts.inventory, 0); assert.equal(h.counts.metadata, 3); assert.equal(h.counts.reads, 3); assert.equal(h.counts.writes, 0);
});

test('metadata can select candidates but current source owns completion and rule removal', async () => {
  const h = harness(0);
  const reopened = h.add('Inbox/Reopened.md', recurring('done'), `---\n${stringify(recurring('open'))}---\nBody`);
  const removed = h.add('Inbox/Removed rule.md', recurring('done'), '---\nstatus: done\n---\nBody');
  await h.service.checkMissingRecurrences([reopened.path, removed.path]);
  assert.equal(h.counts.inventory, 0); assert.equal(h.counts.reads, 2); assert.equal(h.counts.writes, 0);
});

test('worker failures reject joined callers, drain later requests once, and never auto-retry the failed mutation', async () => {
  const h = harness(0); const failed = h.add('Inbox/Fail.md', recurring('done')); const later = h.add('Inbox/Later.md', recurring('done')); const gate = deferred();
  const failure = new Error('write rejected');
  h.createHook(async file => { if (file === failed) { await gate.promise; throw failure; } });
  const first = h.service.checkMissingRecurrences([failed.path]); await flush();
  const second = h.service.checkMissingRecurrences([later.path]);
  const settled = Promise.allSettled([first, second]); gate.resolve();
  const results = await settled;
  assert.ok(results.every(value => value.status === 'rejected' && value.reason === failure));
  assert.deepEqual(h.processed.map(row => row[0]), [failed.path, later.path]);
  assert.equal(h.counts.inventory, 0); assert.equal(h.counts.writes, 1);
  h.createHook(async () => {}); await h.service.checkMissingRecurrences([later.path]);
  assert.equal(h.processed.length, 3, 'a new explicit request works after the failed flight clears');
});

for (const rule of ['FREQ=DAILY', 'GCM-TRACKER']) {
  test(`queued recovery with stale metadata creates one actual successor for ${rule}`, async () => {
    const h = harness(0); const fm = { ...recurring('done'), recurrenceRule: rule, tags: ['keep'] };
    const sourceFile = h.add('Inbox/Series.md', fm, `---\n${stringify(fm)}---\nOriginal body\n`);
    sourceFile.parent = { path: 'Inbox' };
    const created = []; const journal = new Map(); const gate = deferred(); const marked = deferred();
    let firstMark = true;
    h.plugin.manifest = { dir: '.obsidian/plugins/tps-global-context-menu' };
    h.plugin.app.vault.cachedRead = async file => file.source;
    h.plugin.app.vault.adapter = {
      exists: async path => h.files.has(path) || journal.has(path),
      read: async path => journal.get(path), write: async (path, value) => { journal.set(path, value); },
    };
    h.plugin.app.vault.create = async (path, content) => {
      assert.equal(h.files.has(path), false, 'real creation must never overwrite a successor');
      const file = h.add(path, parse(content.split('---')[1]), content); file.parent = { path: 'Inbox' };
      created.push(file); return file;
    };
    h.plugin.frontmatterMutationService = { process: async (file, mutate) => {
      const current = parse(file.source.split('---')[1]); mutate(current);
      file.source = `---\n${stringify(current)}---\nOriginal body\n`;
      // Simulate Obsidian metadata delivery lag. Source bytes are authoritative,
      // but the completed source's metadata retains its original marker-less fm.
      if (file !== sourceFile) file.frontmatter = current;
      if (file === sourceFile && firstMark && current.recurrenceLastGenerated) {
        firstMark = false; marked.resolve(); await gate.promise;
      }
    } };
    h.service.createNextRecurrenceInstance = BulkEditService.prototype.createNextRecurrenceInstance;
    h.service.advanceOccurrenceToFuture = () => new Date(2026, 9, 8, 9);
    const previousWindow = globalThis.window;
    globalThis.window = { moment: () => ({ format: format => format === 'YYYY-MM-DD HH:mm:ss' ? '2026-10-08 09:00:00' : '2026-10-08' }) };
    try {
      const startup = h.service.checkMissingRecurrences(); await marked.promise;
      const next = h.service.checkMissingRecurrences([sourceFile.path]); gate.resolve();
      await Promise.all([startup, next]);
      assert.equal(created.length, 1, 'the queued scope must reuse the existing successor despite stale metadata');
      assert.equal(h.counts.inventory, 1); assert.equal(h.files.size, 2);
      assert.equal(sourceFile.frontmatter.recurrenceLastGenerated, undefined, 'the fixture really retained stale metadata');
      assert.ok(parse(sourceFile.source.split('---')[1]).recurrenceLastGenerated);
      assert.equal(created[0].frontmatter.status, undefined); assert.deepEqual(created[0].frontmatter.tags, ['keep']);
      assert.match(created[0].source, /Original body/u);
    } finally { globalThis.window = previousWindow; }
  });
}

test('public shared service forwards scope, while startup and live generation routes remain', () => {
  const shared = readFileSync(new URL('../src/services/shared/index.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const bulk = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');
  const recurrence = readFileSync(new URL('../src/services/recurrence-service.ts', import.meta.url), 'utf8');
  assert.match(shared, /checkMissingRecurrences: \(paths\?: readonly string\[\]\) => plugin\.bulkEditService\.checkMissingRecurrences\(paths\)/u);
  assert.match(main, /await this\.bulkEditService\.checkMissingRecurrences\(\)/u);
  assert.match(bulk, /await this\.createNextRecurrenceInstance\([\s\S]{0,250}previousStatus/u);
  assert.match(recurrence, /await this\.plugin\.bulkEditService\.createNextRecurrenceInstance\(file, fm\)/u);
});
