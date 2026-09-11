import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
async function load(path) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../' + path, import.meta.url))], bundle: true, write: false,
    format: 'esm', platform: 'node', logLevel: 'silent', plugins: [{ name: 'stub', setup(b) {
      b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
        export class TFile { static [Symbol.hasInstance](value) { return value?.extension === 'md'; } }
        export class Notice { constructor() {} }
      ` }));
    } }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const migration = await load('src/services/retired-home-migration.ts');
const line = await load('src/services/line-editor-core.ts');

test('removes Home registration, services, API, commands, settings, and CSS', () => {
  const main = read('src/main.ts');
  assert.doesNotMatch(main, /registerView\(|DailyNoteHomeService|HomeCaptureService|HomeComponentActionService|openHomeView/);
  assert.doesNotMatch(read('src/plugin-api.ts'), /homeActions:/);
  for (const id of ['open-home', 'home-quick-capture', 'capture-to-current-note', 'capture-to-home-note', 'add-task-to-home-note']) {
    assert.ok(!read('src/commands/register-commands.ts').includes(`id: '${id}'`));
  }
  for (const key of migration.RETIRED_HOME_SETTING_KEYS) {
    assert.ok(!read('src/types.ts').includes(key + ':'));
    assert.ok(!read('src/constants.ts').includes(key + ':'));
    assert.ok(!read('src/settings-tab.ts').includes(key));
  }
  assert.doesNotMatch(read('src/plugin-styles.ts'), /tps-home/);
  assert.equal(existsSync(new URL('../src/views/home-view.ts', import.meta.url)), false);
});

test('Daily Note workflows and accessible settings routes remain available', () => {
  const settings = read('src/settings-tab.ts');
  for (const label of ['Daily notes', 'Collapse headings on first open', 'Enable Daily Note Navigation', 'Auto-Populate Scheduled Items', 'Inherit Daily Note date for unscheduled tasks']) assert.ok(settings.includes(label));
  assert.match(settings, /activeWorkflowPage: WorkflowPageId = 'daily-notes'/);
  assert.match(settings, /aria-pressed/);
  assert.match(read('styles.css'), /@media \(max-width: 700px\)/);
  assert.match(read('src/main.ts'), /new DailyNoteNavManager/);
  assert.match(read('src/commands/register-commands.ts'), /id: 'create-task'/);
});

test('existing Daily Note Home state becomes normal Markdown without changing other tab metadata', () => {
  const previous = { type: 'tps-home', state: { dailyNotePath: 'Inbox/2026-09-11.md', dateIso: '2026-09-11' }, pinned: true, group: 'a', title: 'TPS Home', icon: 'layout-dashboard' };
  const snapshot = structuredClone(previous);
  assert.deepEqual(migration.retiredHomeReplacement(previous, () => true), { type: 'markdown', state: { file: 'Inbox/2026-09-11.md', mode: 'preview' }, pinned: true, group: 'a' });
  assert.deepEqual(previous, snapshot);
  assert.equal(migration.retiredHomeReplacement({ type: 'markdown', state: { file: 'A.md' } }, () => { throw Error('must not resolve unrelated tabs'); }), null);
});

test('standalone and missing-note Home tabs become empty without creating files', () => {
  assert.deepEqual(migration.retiredHomeReplacement({ type: 'tps-home', state: {} }, () => false), { type: 'empty', state: {} });
  assert.deepEqual(migration.retiredHomeReplacement({ type: 'tps-home', state: { dailyNotePath: 'missing.md' } }, () => false), { type: 'empty', state: {} });
});

test('restores deferred legacy tabs once, preserves unrelated leaves and vault content', async () => {
  const states = [{ type: 'tps-home', state: { dailyNotePath: 'Day.md' } }, { type: 'tps-home', state: {} }, { type: 'markdown', state: { file: 'Other.md' } }];
  const changes = [];
  const app = { workspace: { iterateAllLeaves(fn) { states.forEach((_, i) => fn({ getViewState: () => states[i], async setViewState(next) { changes.push(i); states[i] = next; } })); } }, vault: { getAbstractFileByPath(path) { assert.equal(path, 'Day.md'); return { path, extension: 'md' }; } } };
  await migration.restoreRetiredHomeTabs(app);
  await migration.restoreRetiredHomeTabs(app);
  assert.deepEqual(changes, [0, 1]);
  assert.equal(states[2].state.file, 'Other.md');
});

test('a failed legacy tab does not prevent other tabs restoring', async () => {
  let changed = 0;
  const app = { workspace: { iterateAllLeaves(fn) {
    fn({ getViewState: () => ({ type: 'tps-home', state: {} }), setViewState: async () => { throw Error('synthetic view failure'); } });
    fn({ getViewState: () => ({ type: 'tps-home', state: {} }), setViewState: async () => { changed++; } });
  } }, vault: {} };
  await migration.restoreRetiredHomeTabs(app);
  assert.equal(changed, 1);
});

test('user navigation while another legacy tab restores is respected', async () => {
  let second = { type: 'tps-home', state: {} };
  const app = { workspace: { iterateAllLeaves(fn) {
    fn({ getViewState: () => ({ type: 'tps-home', state: {} }), setViewState: async () => { second = { type: 'markdown', state: { file: 'User choice.md' } }; } });
    fn({ getViewState: () => second, setViewState: async () => { throw Error('must not replace user choice'); } });
  } }, vault: {} };
  await migration.restoreRetiredHomeTabs(app);
  assert.equal(second.state.file, 'User choice.md');
});

test('settings retirement removes only known legacy keys and keeps concurrent unrelated values', async () => {
  const main = read('src/main.ts');
  const method = main.slice(main.indexOf('  private stripLegacySettingsFields('), main.indexOf('  createDefaultRule()'));
  const body = method.slice(method.indexOf('{') + 1, method.lastIndexOf('}'));
  const strip = new Function('record', 'RETIRED_HOME_SETTING_KEYS', body);
  const initial = { other: 'old', future: { enabled: true }, ...Object.fromEntries(migration.RETIRED_HOME_SETTING_KEYS.map(k => [k, true])) };
  const next = structuredClone(initial);
  strip(next, migration.RETIRED_HOME_SETTING_KEYS);
  assert.deepEqual(next, { other: 'old', future: { enabled: true } });
  assert.match(main, /hadRetiredHomeSettings \|\|/);
  assert.match(main, /for \(const key of RETIRED_HOME_SETTING_KEYS\) delete record\[key\]/);
  const { SettingsPersistenceCoordinator } = await load('src/settings-persistence.ts');
  let disk = { ...initial, other: 'remote update' };
  const coordinator = new SettingsPersistenceCoordinator(async () => structuredClone(disk), async value => { disk = value; });
  coordinator.setBaseline(initial);
  await coordinator.request(next);
  assert.deepEqual(disk, { other: 'remote update', future: { enabled: true } });
});

test('independent line editor preserves line endings and refuses concurrent source changes', () => {
  const source = 'before\r\n- [ ] task [tpsId:: identity]\r\nafter';
  const range = line.resolveLineRange(source, 1);
  const snapshot = line.createLineRangeSnapshot(source, range.from, range.to);
  assert.equal(snapshot.value, '- [ ] task [tpsId:: identity]');
  assert.equal(line.replaceLineRangeIfUnchanged(source, snapshot, [snapshot.value], '- [x] task [tpsId:: identity]'), 'before\r\n- [x] task [tpsId:: identity]\r\nafter');
  assert.equal(line.replaceLineRangeIfUnchanged(source + ' changed', snapshot, [snapshot.value], 'edit'), null);
  assert.equal(line.resolveLineRange(source, -1), null);
  assert.equal(line.resolveLineRange(source, 100), null);
});


test('unloading during retirement stops before the next tab', async () => {
  let active = true;
  let changed = 0;
  const app = { workspace: { iterateAllLeaves(fn) {
    for (let i = 0; i < 2; i++) fn({ getViewState: () => ({ type: 'tps-home', state: {} }), setViewState: async () => { changed++; active = false; } });
  } }, vault: {} };
  await migration.restoreRetiredHomeTabs(app, () => active);
  assert.equal(changed, 1);
});


test('workspace traversal continues past unrelated leaves when the host stops on truthy callback results', async () => {
  let restored = 0;
  const leaves = [
    { getViewState: () => ({ type: 'markdown', state: { file: 'First.md' } }) },
    { getViewState: () => ({ type: 'tps-home', state: {} }), setViewState: async () => { restored++; } },
  ];
  const app = { workspace: { iterateAllLeaves(fn) { for (const leaf of leaves) if (fn(leaf)) break; } }, vault: {} };
  await migration.restoreRetiredHomeTabs(app);
  assert.equal(restored, 1);
});
