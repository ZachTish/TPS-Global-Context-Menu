import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

class TFile {
  constructor(path) { this.path = path; this.basename = path.split('/').pop().replace(/\.md$/, ''); }
}
const notices = [];
const source = readFileSync(new URL('../src/handlers/daily-note-nav-manager.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
new Function('exports', 'module', 'require', output)(module.exports, module, id => {
  if (id === 'obsidian') return {
    Component: class {}, Modal: class {}, MarkdownView: class {}, TFile,
    normalizePath: value => value, Notice: class { constructor(message) { notices.push(message); } }, Platform: {},
  };
  if (id.endsWith('/logger')) return { error() {}, warn() {} };
  if (id.endsWith('/daily-note-task-schedule')) return {
    parseDailyNoteFileDate: (app, _settings, file) => app.recognizedDates.get(file) ?? null,
  };
  if (id.endsWith('/leaf-resolver')) return { isStrictSourceMode: () => false };
  if (id.endsWith('/daily-note-nav-days')) return {};
  throw Error(`Unexpected import ${id}`);
});

function moment(value = '2026-09-28') {
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return {
    isValid: () => !Number.isNaN(date.getTime()),
    format: () => date.toISOString().slice(0, 10),
    startOf() { return this; },
    add(amount) { date.setUTCDate(date.getUTCDate() + amount); return this; },
  };
}

function fixture() {
  const files = new Map(), recognizedDates = new Map();
  const stats = { confirmations: [], ensure: [], opened: [], filenameFallback: 0, scans: 0, reads: 0, writes: 0 };
  const state = { folder: 'Daily', ready: true, confirmed: true, found: null, created: null, duringConfirm: null };
  const sourceLeaf = { name: 'source' };
  const core = { folder: 'Daily', format: 'YYYY-MM-DD', template: 'Template.md' };
  const plugin = {
    settings: {},
    app: {
      recognizedDates,
      plugins: { getPlugin: () => null },
      internalPlugins: { getPluginById: () => ({ enabled: true, instance: { options: core } }) },
      vault: {
        getAbstractFileByPath: path => files.get(path),
        getMarkdownFiles() { stats.scans++; return [...files.values()]; },
        read() { stats.reads++; assert.fail('Navigation must not read source'); },
        modify() { stats.writes++; assert.fail('Navigation must not write'); },
      },
      metadataCache: {
        getFirstLinkpathDest(name) { stats.filenameFallback++; return [...files.values()].find(f => f.path.endsWith('/' + name)); },
        getFileCache: file => ({ frontmatter: file.frontmatter ?? {} }),
      },
      workspace: { getLeaf: () => sourceLeaf },
    },
    fileNamingService: {
      whenDailyNoteConfigurationReady: async () => {},
      getDailyNoteConfigurationSnapshot: () => ({ ...core, folder: state.folder }),
      isDailyNoteMetadataCacheReady: () => state.ready,
    },
    api: { dailyNotes: {
      pathForIsoDate: date => `${state.folder}/${date}.md`,
      findForIsoDate: () => state.found,
      ensureForIsoDate: async (date, options) => {
        stats.ensure.push({ date, options });
        return options?.expectedPath === `${state.folder}/${date}.md` ? state.created : null;
      },
    } },
    noteOperationService: { ensureDailyNote: async (...args) => { stats.ensure.push({ oldRoute: args }); return state.created; } },
    openFileInLeaf: async (file, _newLeaf, resolveLeaf, options) => {
      stats.opened.push({ file, leaf: resolveLeaf(), options }); return true;
    },
  };
  const manager = new module.exports.DailyNoteNavManager(plugin);
  manager.confirmCreateDailyNote = async (title, path) => {
    stats.confirmations.push({ title, path }); state.duringConfirm?.(); return state.confirmed;
  };
  const add = path => { const file = new TFile(path); files.set(path, file); return file; };
  return { plugin, manager, state, stats, add, sourceLeaf, recognizedDates };
}

async function run(fn) {
  const original = globalThis.window;
  globalThis.window = { moment };
  notices.length = 0;
  try { await fn(); } finally { globalThis.window = original; }
}

test('date-strip creation ignores an unrecognized archived filename collision', () => run(async () => {
  const f = fixture(); f.add('_archive/2026-09-28.md'); f.state.created = new TFile('Daily/2026-09-28.md');
  // The provider reports absence; the returned created file is an API boundary fixture.
  await f.manager.goToDate('2026-09-28', 0, f.sourceLeaf);
  assert.deepEqual(f.stats.confirmations, [{ title: '2026-09-28', path: 'Daily/2026-09-28.md' }]);
  assert.deepEqual(f.stats.ensure, [{ date: '2026-09-28', options: { expectedPath: 'Daily/2026-09-28.md' } }]);
  assert.equal(f.stats.opened[0]?.file, f.state.created);
  assert.equal(f.stats.filenameFallback, 0);
}));

test('recognized legacy notes open read-only in the originating leaf', () => run(async () => {
  const f = fixture(); f.state.found = f.add('Journal/My named day.md');
  await f.manager.goToDate('2026-09-28', 0, f.sourceLeaf);
  assert.equal(f.stats.opened[0]?.file, f.state.found);
  assert.equal(f.stats.opened[0]?.leaf, f.sourceLeaf);
  assert.equal(f.stats.confirmations.length, 0); assert.equal(f.stats.ensure.length, 0);
  assert.equal(f.stats.scans + f.stats.reads + f.stats.writes, 0);
}));

test('100 unchanged canonical opens perform no scans, reads, mutations or creation calls', () => run(async () => {
  const f = fixture(); f.state.found = f.add('Daily/2026-09-28.md');
  for (let i = 0; i < 100; i++) await f.manager.goToDate('2026-09-28', 0, f.sourceLeaf);
  assert.equal(f.stats.opened.length, 100);
  assert.equal(f.stats.scans + f.stats.reads + f.stats.writes + f.stats.filenameFallback, 0);
  assert.equal(f.stats.confirmations.length + f.stats.ensure.length, 0);
}));

test('navigation uses shared configuration even when Periodic Notes disagrees', () => run(async () => {
  const f = fixture(); f.state.found = f.add('Daily/2026-09-28.md');
  f.add('Other/2026-09-28.md');
  f.plugin.app.plugins.getPlugin = () => ({ settings: { daily: { folder: 'Other', format: 'YYYY-MM-DD' } } });
  await f.manager.goToDate('2026-09-28', 0, f.sourceLeaf);
  assert.equal(f.stats.opened[0]?.file, f.state.found);
}));

test('a folder change during confirmation cannot silently redirect creation', () => run(async () => {
  const f = fixture(); f.state.created = new TFile('Changed/2026-09-28.md');
  f.state.duringConfirm = () => { f.state.folder = 'Changed'; };
  await f.manager.goToDate('2026-09-28', 0, f.sourceLeaf);
  assert.deepEqual(f.stats.ensure, [{ date: '2026-09-28', options: { expectedPath: 'Daily/2026-09-28.md' } }]);
  assert.equal(f.stats.opened.length, 0);
}));

test('cold identity defers absent navigation; canonical observation can still open', () => run(async () => {
  const f = fixture(); f.state.ready = false;
  await f.manager.goToDate('2026-09-28', 0, f.sourceLeaf);
  assert.equal(f.stats.confirmations.length + f.stats.ensure.length + f.stats.opened.length, 0);
  assert.equal(notices.length, 1);
  f.state.found = f.add('Daily/2026-09-28.md');
  await f.manager.goToDate('2026-09-28', 0, f.sourceLeaf);
  assert.equal(f.stats.opened[0]?.file, f.state.found);
}));

test('cancelled and refused creation never open a filename fallback', () => run(async () => {
  const f = fixture(); f.state.confirmed = false;
  await f.manager.goToDate('2026-09-28', 0, f.sourceLeaf);
  assert.equal(f.stats.ensure.length + f.stats.opened.length, 0);
  f.state.confirmed = true; f.add('Daily/2026-09-28.md');
  await f.manager.goToDate('2026-09-28', 0, f.sourceLeaf);
  assert.equal(f.stats.opened.length, 0, 'an excluded canonical occupant must not be opened');
  assert.equal(f.stats.ensure.length, 1);
}));

test('date-strip visibility uses shared classification, including mapped and excluded kinds', () => run(async () => {
  const f = fixture(), file = f.add('_archive/2026-09-28.md');
  const leaf = { view: { file }, getViewState: () => ({ type: 'markdown' }) };
  assert.equal(f.manager.getDailyNoteLeafInfo(leaf), null, 'a date filename alone is not Daily identity');
  f.recognizedDates.set(file, '2026-09-28');
  assert.deepEqual(f.manager.getDailyNoteLeafInfo(leaf), { leaf, isoDate: '2026-09-28', kind: 'daily-note' });
  f.recognizedDates.delete(file);
  file.frontmatter = { kind: 'workout-session', scheduled: '2026-09-28' };
  assert.equal(f.manager.getDailyNoteLeafInfo(leaf), null);
}));
