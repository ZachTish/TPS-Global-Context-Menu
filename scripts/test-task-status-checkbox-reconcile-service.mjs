import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const serviceSource = readFileSync(new URL('../src/services/task-status-checkbox-reconcile-service.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');

const mappings = [
  { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete' },
  { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo' },
  { checkboxState: '[\\]', statuses: ['working'], toggleTargetStatus: 'complete' },
  { checkboxState: '[?]', statuses: ['holding'], toggleTargetStatus: 'todo' },
  { checkboxState: '[-]', statuses: ['wont-do'], toggleTargetStatus: 'todo' },
];

async function importUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/task-status-checkbox-reconcile.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

test('task status reconciliation maps inline status fields into task checkbox markers', async () => {
  const { reconcileTaskStatusLine } = await importUtility();

  assert.deepEqual(
    reconcileTaskStatusLine(
      '- [ ] Body task two with a much longer label [status:: working]',
      'status',
      mappings,
    ),
    {
      changed: true,
      line: '- [\\] Body task two with a much longer label',
      status: 'working',
      checkboxState: '[\\]',
    },
  );

  assert.equal(
    reconcileTaskStatusLine('- [ ] Done thing [status:: complete]', 'status', mappings, {
      completedAt: new Date(2026, 5, 3, 14, 5, 6),
    }).line,
    '- [x] Done thing [completedDate:: 2026-06-03 14:05:06]',
  );
  assert.equal(
    reconcileTaskStatusLine('- [x] Done thing [status:: complete] [completedDate:: 2026-06-01 09:00:00]', 'status', mappings, {
      completedAt: new Date(2026, 5, 3, 14, 5, 6),
    }).line,
    '- [x] Done thing [completedDate:: 2026-06-01 09:00:00]',
  );
  assert.equal(
    reconcileTaskStatusLine('- [X] Uppercase done [status:: complete]', 'status', mappings, {
      completedAt: new Date(2026, 5, 3, 14, 5, 6),
    }).line,
    '- [x] Uppercase done [completedDate:: 2026-06-03 14:05:06]',
  );
  assert.equal(
    reconcileTaskStatusLine('- [ ] Canceled thing [status:: wont-do]', 'status', mappings, {
      completedAt: new Date(2026, 5, 3, 14, 5, 6),
    }).line,
    '- [-] Canceled thing [completedDate:: 2026-06-03 14:05:06]',
  );
  assert.equal(
    reconcileTaskStatusLine('- [x] Reopened [status:: todo] [completedDate:: 2026-06-01 09:00:00]', 'status', mappings).line,
    '- [ ] Reopened',
  );
  assert.equal(
    reconcileTaskStatusLine('- [ ] Waiting thing (status:: holding)', 'status', mappings).line,
    '- [?] Waiting thing',
  );
  assert.equal(
    reconcileTaskStatusLine('  1. [ ] Ordered task [state:: working] #tag', 'state', mappings).line,
    '  1. [\\] Ordered task #tag',
  );
});

test('task status reconciliation leaves unrelated and unmapped lines alone', async () => {
  const { reconcileTaskStatusLine } = await importUtility();

  assert.equal(
    reconcileTaskStatusLine('- [ ] Body task [priority:: high]', 'status', mappings).line,
    '- [ ] Body task [priority:: high]',
  );
  assert.equal(
    reconcileTaskStatusLine('- [ ] Body task [status:: unknown]', 'status', mappings).line,
    '- [ ] Body task [status:: unknown]',
  );
  assert.equal(
    reconcileTaskStatusLine('- plain list item [status:: working]', 'status', mappings).line,
    '- plain list item [status:: working]',
  );
});

test('native checkbox changes synchronize completedDate without requiring an inline status field', async () => {
  const { reconcileTaskStatusLine } = await importUtility();
  const completedAt = new Date(2026, 7, 11, 19, 12, 13);

  assert.equal(
    reconcileTaskStatusLine('- [x] Checked in Obsidian', 'status', mappings, { completedAt }).line,
    '- [x] Checked in Obsidian [completedDate:: 2026-08-11 19:12:13]',
  );
  assert.equal(
    reconcileTaskStatusLine(
      '- [ ] Reopened in Obsidian [completedDate:: 2026-08-10 08:00:00]',
      'status',
      mappings,
      { completedAt },
    ).line,
    '- [ ] Reopened in Obsidian',
  );
  assert.equal(
    reconcileTaskStatusLine('- [z] Custom state [completedDate:: 2026-08-10 08:00:00]', 'status', mappings, { completedAt }).line,
    '- [z] Custom state [completedDate:: 2026-08-10 08:00:00]',
    'unmapped markers must retain their user-authored metadata',
  );
});

test('completedDate follows native checkbox state when inline status-to-checkbox sync is disabled', async () => {
  const { reconcileTaskStatusLine } = await importUtility();

  assert.equal(
    reconcileTaskStatusLine(
      '- [x] Manual completion [status:: todo]',
      'status',
      mappings,
      {
        syncStatusToCheckbox: false,
        completedAt: new Date(2026, 7, 11, 19, 12, 13),
      },
    ).line,
    '- [x] Manual completion [status:: todo] [completedDate:: 2026-08-11 19:12:13]',
  );
});

test('task status reconciliation preserves an alternate marker and honors canonical status aliases', async () => {
  const { reconcileTaskStatusLine } = await importUtility();
  const alternateMappings = [
    { checkboxState: '[\\]', statuses: ['working'] },
    { checkboxState: '[/]', statuses: ['working'] },
    { checkboxState: '[d]', statuses: ['done'] },
  ];
  const normalizeStatus = (value) => ({ done: 'complete', completed: 'complete' }[String(value).trim().toLowerCase()] || String(value).trim().toLowerCase());

  assert.equal(
    reconcileTaskStatusLine('- [/] Keep this working marker [status:: working]', 'status', alternateMappings, {
      normalizeStatus,
    }).line,
    '- [/] Keep this working marker',
  );
  assert.equal(
    reconcileTaskStatusLine('- [ ] Alias completion [status:: completed]', 'status', alternateMappings, {
      normalizeStatus,
      completeMarkers: ['d'],
      completedAt: new Date(2026, 5, 3, 14, 5, 6),
    }).line,
    '- [d] Alias completion [completedDate:: 2026-06-03 14:05:06]',
  );
});

test('task reconciliation is registered and keeps completedDate independent of status-sync enablement', () => {
  assert.match(serviceSource, /export class TaskStatusCheckboxReconcileService extends Component/);
  assert.match(serviceSource, /vault\.process\(file, \(data\) =>/);
  assert.match(serviceSource, /workspace\.on\('editor-change'/);
  assert.doesNotMatch(serviceSource, /workspace\.on\('active-leaf-change'/);
  assert.match(serviceSource, /isEditorQuiet\(\)/);
  assert.match(serviceSource, /scanMarkdownDocumentLines\(data\)/);
  assert.match(serviceSource, /documentLines\[index\]\?\.isContent !== true/);
  assert.match(serviceSource, /reconcileTaskStatusLine\(line, statusKey, mappings, \{[\s\S]{0,180}normalizeStatus/);
  assert.match(serviceSource, /data\.includes\('\\r'\) \? '\\r' : '\\n'/);
  assert.match(serviceSource, /getCompleteMarkers\(mappings\)/);
  assert.match(serviceSource, /syncStatusToCheckbox: this\.isStatusSyncEnabled\(\)/);
  assert.match(serviceSource, /canAutomaticallyMutatePathWithExclusions\(file, this\.plugin\.settings\)/);
  assert.match(serviceSource, /canAutomaticallyMutateTemplateSource\(data, this\.plugin\.settings\)/);
  assert.doesNotMatch(serviceSource, /scheduleFile[\s\S]{0,180}if \(!this\.isStatusSyncEnabled\(\)\) return/);
  assert.match(mainSource, /new TaskStatusCheckboxReconcileService\(this\)/);
  assert.match(mainSource, /if \(!this\.usesNativeRecordArchitecture\(\)\) this\.addChild\(this\.taskStatusCheckboxReconcileService\)/);
  assert.doesNotMatch(settingsSource, /Sync inline status to checkbox marker/);
});

async function importService() {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/services/task-status-checkbox-reconcile-service.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'obsidian-service-stub', setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
        export class Component { registerEvent() {} }
        export class TFile { constructor(path) { this.path = path; this.extension = path.split('.').pop(); } }
        globalThis.__ReconcileTFile = TFile;
      ` }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const serviceModule = await importService();
function serviceFixture(source, { latest = source, settings = {} } = {}) {
  const counts = { cachedRead: 0, read: 0, process: 0, refresh: 0 };
  const events = new Map();
  const file = new globalThis.__ReconcileTFile('Inbox/Example.md');
  let saved = latest;
  const on = (name, callback) => events.set(name, callback);
  const plugin = {
    settings: { linkedSubitemCheckboxMappings: mappings, frontmatterAutoWriteExclusions: '#template', ...settings },
    sharedServices: { status: { getStatusPropertyKey: () => 'status', normalize: v => String(v ?? '').toLowerCase(), getDoneStatuses: () => ['complete'] } },
    app: {
      vault: { on, async cachedRead() { counts.cachedRead++; return source; }, async read() { counts.read++; return saved; },
        async process(_file, transform) { counts.process++; saved = transform(saved); } },
      workspace: { on, onLayoutReady(callback) { events.set('layout-ready', callback); }, getActiveFile: () => file, updateOptions() { counts.refresh++; } },
    },
  };
  return { service: new serviceModule.TaskStatusCheckboxReconcileService(plugin), file, counts, events, saved: () => saved };
}

test('ordinary navigation and layout readiness schedule no checkbox maintenance', () => {
  const f = serviceFixture('Plain note');
  f.service.scheduleFile = () => assert.fail('navigation must not schedule maintenance');
  f.service.onload();
  for (let i = 0; i < 100; i++) {
    f.events.get('active-leaf-change')?.();
    f.events.get('file-open')?.(f.file);
    f.events.get('layout-ready')?.();
  }
  assert.deepEqual(f.counts, { cachedRead: 0, read: 0, process: 0, refresh: 0 });
  const scheduled = [];
  f.service.scheduleFile = (file, reason) => scheduled.push([file, reason]);
  f.events.get('modify')(f.file);
  f.events.get('editor-change')({}, { file: f.file });
  assert.deepEqual(scheduled, [[f.file, 'vault-modify'], [f.file, 'editor-change']]);
});

test('plain notes and already reconciled tasks never enter the disk/write queue', async () => {
  for (const source of ['Plain note\n', '- [ ] Open task\n', '- [x] Finished [completedDate:: 2026-09-27 09:00:00]\n']) {
    const f = serviceFixture(source);
    assert.equal(await f.service.reconcileFileNow(f.file), 0);
    assert.deepEqual(f.counts, { cachedRead: 1, read: 0, process: 0, refresh: 0 });
    assert.equal(f.saved(), source);
  }
});

test('missing mappings and excluded paths stop before any read', async () => {
  for (const settings of [{ linkedSubitemCheckboxMappings: [] }, { frontmatterAutoWriteExclusions: 'path:Inbox/' }]) {
    const f = serviceFixture('- [x] Done', { settings });
    assert.equal(await f.service.reconcileFileNow(f.file), 0);
    assert.deepEqual(f.counts, { cachedRead: 0, read: 0, process: 0, refresh: 0 });
  }
});

test('changed tasks reconcile atomically, preserve concurrent body edits and line endings', async () => {
  const f = serviceFixture('- [ ] Do it [status:: working]\r\n', { latest: 'New paragraph\r\n- [ ] Do it [status:: working]\r\n' });
  assert.equal(await f.service.reconcileFileNow(f.file), 1);
  assert.equal(f.saved(), 'New paragraph\r\n- [\\] Do it\r\n');
  assert.deepEqual(f.counts, { cachedRead: 1, read: 0, process: 1, refresh: 1 });
});

test('a concurrent reconciliation causes no refresh or stale rewrite', async () => {
  const latest = '- [\\] Do it\n';
  const f = serviceFixture('- [ ] Do it [status:: working]\n', { latest });
  assert.equal(await f.service.reconcileFileNow(f.file), 0);
  assert.equal(f.saved(), latest);
  assert.equal(f.counts.refresh, 0);
});

test('template exclusions are checked in the cached preflight and again at the atomic write', async () => {
  const protectedSource = '---\ntags: [template]\n---\n- [x] Done\n';
  const f = serviceFixture(protectedSource);
  assert.equal(await f.service.reconcileFileNow(f.file), 0);
  assert.equal(f.counts.process, 0);
  const concurrent = serviceFixture('- [x] Done\n', { latest: protectedSource });
  assert.equal(await concurrent.service.reconcileFileNow(concurrent.file), 0);
  assert.equal(concurrent.saved(), protectedSource);
  assert.equal(concurrent.counts.refresh, 0);
});

test('frontmatter and fenced examples are not reconciled', async () => {
  const source = '---\nexample: |\n  - [x] Example\n---\n```md\n- [x] Example\n```\n';
  const f = serviceFixture(source);
  assert.equal(await f.service.reconcileFileNow(f.file), 0);
  assert.equal(f.counts.process, 0);
});
