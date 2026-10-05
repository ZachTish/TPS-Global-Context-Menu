import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { parse, stringify } from 'yaml';
import { fileURLToPath } from 'node:url';

const momentForTest = value => {
  const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})(?:T| |$)/u);
  return { isValid: () => !!match, format: () => match?.[1] || '' };
};
momentForTest.ISO_8601 = Symbol('ISO_8601');
momentForTest.invalid = () => momentForTest('');
globalThis.window = { moment: momentForTest, setTimeout, clearTimeout };
globalThis.frontmatterRenameRaceYaml = { parse, stringify };
const bundled = await build({
  stdin: {
    contents: [
      "export { FrontmatterMutationService } from './src/services/frontmatter-mutation-service.ts';",
      "export { FileNamingService } from './src/services/file-naming-service.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{
    name: 'frontmatter-rename-race-obsidian',
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'race' }));
      builder.onLoad({ filter: /.*/, namespace: 'race' }, () => ({
        loader: 'js',
        contents: `
          export class TFile { static [Symbol.hasInstance](file) { return file?.isTestFile === true; } }
          export class TFolder {}
          export class MarkdownView {}
          export class Menu {}
          export class Notice {}
          export const parseYaml = globalThis.frontmatterRenameRaceYaml.parse;
          export const stringifyYaml = globalThis.frontmatterRenameRaceYaml.stringify;
          export const moment = globalThis.window.moment;
          export const normalizePath = value => String(value || '').replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/').replace(/^\\//, '');
        `,
      }));
    },
  }],
});
const { FrontmatterMutationService, FileNamingService } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`,
);

const initial = '---\ntitle: Synthetic task\nstatus: working\nscheduled: 2026-10-05T10:00:00\nkind: [transaction/event]\n---\nSynthetic body\n';
const frontmatter = source => parse(source.replace(/^\uFEFF/u, '').match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] || '') || {};
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

function fixture(source = initial) {
  const file = { isTestFile: true, path: 'Inbox/Synthetic task.md', name: 'Synthetic task.md', basename: 'Synthetic task', extension: 'md', parent: { path: 'Inbox' }, stat: { ctime: 0, mtime: 0 } };
  const disk = new Map([[file.path, source]]);
  const files = new Map([[file.path, file]]);
  const stats = { reads: 0, modifies: 0, processes: 0, writes: 0, mutators: 0, events: 0, indexes: 0, renames: 0 };
  let tail = Promise.resolve();
  const enqueue = action => {
    const operation = tail.then(action);
    tail = operation.catch(() => {});
    return operation;
  };
  let onWriteCapture = () => {};
  let onRename = async () => {};
  const read = target => {
    const content = disk.get(target.path);
    if (content === undefined) throw new Error('ENOENT: synthetic note missing');
    return content;
  };
  const plugin = {
    manifest: { id: 'tps-global-context-menu' },
    settings: { autoSyncTitleFromFilename: false, enableAutoRename: true, enableActivityLog: false, frontmatterAutoWriteExclusions: '', folderExclusions: '', dailyNoteDateFormat: 'YYYY-MM-DD', properties: [] },
    registerEvent() {}, shouldIgnoreAutoFrontmatterWrite: () => false,
    nativeRecordService: { isRecordFile: () => false, hasRecordIdentityEvidence: async () => false, hasRecordIdentityEvidenceInFrontmatter: () => false },
    bulkEditService: { shouldSkipNoteLevelRecurrence: async () => false, canMutateFrontmatterSafely: async () => true },
    eventService: { emitFilesUpdated() { stats.events++; }, emitExplicitAction() {} },
    entityIndexService: { upsertFile() { stats.indexes++; } },
    app: {
      internalPlugins: { getPluginById: () => null, plugins: {} },
      plugins: { getPlugin: () => null, plugins: {} },
      vault: {
        configDir: '.obsidian', adapter: { async read() { throw Error('No Daily Notes configuration in fixture'); } },
        getFiles: () => [...files.values()], getMarkdownFiles: () => [...files.values()],
        getAbstractFileByPath: path => files.get(path) || null,
        getFileByPath: path => files.get(path) || null,
        cachedRead: async target => read(target),
        read: async target => { stats.reads++; return read(target); },
        // Obsidian 1.14.4 captures the path before entering its adapter queue.
        // A queued writeFile creates the old path if rename removed it first.
        modify(target, next) {
          stats.modifies++;
          const capturedPath = target.path;
          onWriteCapture(capturedPath);
          return enqueue(() => { disk.set(capturedPath, next); stats.writes++; });
        },
        process(target, update) {
          stats.processes++;
          const capturedPath = target.path;
          onWriteCapture(capturedPath);
          return enqueue(() => {
            const current = disk.get(capturedPath);
            if (current === undefined) throw new Error('ENOENT: synthetic note missing');
            const next = update(current);
            if (next !== current) { disk.set(capturedPath, next); stats.writes++; }
            return next;
          });
        },
        on: () => ({}),
      },
      metadataCache: { initialized: true, getFileCache: target => ({ frontmatter: frontmatter(read(target)) }), on: () => ({}) },
      workspace: { getActiveFile: () => file, getLeavesOfType: () => [] },
      fileManager: {
        renameFile(target, nextPath) {
          const capturedPath = target.path;
          return enqueue(async () => {
            await onRename(capturedPath, nextPath);
            disk.set(nextPath, disk.get(capturedPath)); disk.delete(capturedPath);
            files.delete(capturedPath);
            target.path = nextPath;
            target.name = nextPath.split('/').at(-1);
            target.basename = target.name.slice(0, -3);
            files.set(nextPath, target);
            stats.renames++;
          });
        },
      },
    },
  };
  const service = plugin.frontmatterMutationService = new FrontmatterMutationService(plugin);
  const naming = plugin.fileNamingService = new FileNamingService(plugin);
  return { file, disk, files, stats, plugin, service, naming, enqueue,
    beforeRename: callback => { onRename = callback; },
    whenWriteCaptured: callback => { onWriteCapture = callback; },
  };
}

test('queued automatic rename cannot recreate the old note or announce a failed completion', { timeout: 3000 }, async () => {
  const f = fixture();
  const oldPath = f.file.path;
  const entered = deferred(), release = deferred(), renameEntered = deferred(), renameRelease = deferred(), captured = deferred();
  f.beforeRename(async () => { renameEntered.resolve(); await renameRelease.promise; });
  f.whenWriteCaptured(path => captured.resolve(path));
  const edit = f.service.process(f.file, async fm => {
    f.stats.mutators++; entered.resolve(); await release.promise;
    fm.status = 'complete'; fm.completedDate = '2026-10-05 17:30:00';
  });
  // Observe rejection immediately so a missing target cannot be unhandled.
  const outcome = edit.then(value => ({ value }), error => ({ error }));
  await entered.promise;
  const rename = f.naming.updateFilenameIfNeeded(f.file, { bypassCreationGrace: true });
  await renameEntered.promise;
  release.resolve();
  assert.equal(await captured.promise, oldPath, 'the write was queued while TFile still had its old path');
  renameRelease.resolve();
  await rename;
  const result = await outcome;
  assert.equal(f.disk.size, 1, 'only the moved note remains');
  assert.equal(f.disk.has(oldPath), false, 'the captured old path is never recreated');
  assert.ok(result.error, 'a failed completion must reject, not return changed=true');
  assert.equal(frontmatter(f.disk.get(f.file.path)).status, 'working');
  assert.equal(f.stats.mutators, 1);
  assert.equal(f.stats.events, 0);
  assert.equal(f.stats.indexes, 0);
  assert.equal(f.stats.writes, 0);
});

test('successful completion followed by automatic rename retains one completed note', async () => {
  const f = fixture();
  const oldPath = f.file.path;
  assert.equal(await f.service.process(f.file, fm => {
    f.stats.mutators++;
    fm.status = 'complete'; fm.completedDate = '2026-10-05 17:30:00';
  }), true);
  await f.naming.updateFilenameIfNeeded(f.file, { bypassCreationGrace: true });
  assert.equal(f.disk.size, 1);
  assert.equal(f.disk.has(oldPath), false);
  assert.equal(f.file.path, 'Inbox/2026-10-05 Synthetic task.md');
  assert.equal(frontmatter(f.disk.get(f.file.path)).status, 'complete');
  assert.equal(frontmatter(f.disk.get(f.file.path)).completedDate, '2026-10-05 17:30:00');
  assert.ok(f.disk.get(f.file.path).endsWith('Synthetic body\n'));
  assert.equal(f.stats.mutators, 1);
  assert.equal(f.stats.writes, 1);
  assert.equal(f.stats.renames, 1);
  assert.equal(f.stats.events, 1);
});

test('a completed automatic rename before write capture applies once to the same current TFile', async () => {
  const f = fixture();
  const oldPath = f.file.path;
  const entered = deferred(), release = deferred(), captured = deferred();
  f.whenWriteCaptured(path => captured.resolve(path));
  const pending = f.service.process(f.file, async fm => {
    f.stats.mutators++; entered.resolve(); await release.promise;
    fm.status = 'complete'; fm.completedDate = '2026-10-05 17:30:00';
  });
  await entered.promise;
  await f.naming.updateFilenameIfNeeded(f.file, { bypassCreationGrace: true });
  assert.equal(f.files.get(f.file.path), f.file);
  release.resolve();
  assert.equal(await captured.promise, f.file.path);
  assert.equal(await pending, true);
  assert.equal(f.disk.size, 1);
  assert.equal(f.disk.has(oldPath), false);
  assert.equal(frontmatter(f.disk.get(f.file.path)).status, 'complete');
  assert.equal(frontmatter(f.disk.get(f.file.path)).completedDate, '2026-10-05 17:30:00');
  assert.equal(f.stats.mutators, 1);
  assert.equal(f.stats.writes, 1);
  assert.equal(f.stats.renames, 1);
  assert.equal(f.stats.events, 1);
});

test('an async property action rejects a newer completion instead of overwriting it', async () => {
  const f = fixture();
  const entered = deferred(), release = deferred();
  const pending = f.service.process(f.file, async fm => {
    f.stats.mutators++; entered.resolve(); await release.promise; fm.color = '#4c76ae';
  });
  const outcome = assert.rejects(pending, /changed|pending/u);
  await entered.promise;
  const complete = initial.replace('status: working', 'status: complete\ncompletedDate: 2026-10-05 17:30:00');
  f.disk.set(f.file.path, complete);
  release.resolve();
  await outcome;
  assert.equal(f.disk.get(f.file.path), complete);
  assert.equal(f.stats.mutators, 1);
  assert.equal(f.stats.events, 0);
  assert.equal(f.stats.indexes, 0);
  assert.equal(f.stats.writes, 0);
});

test('current source is checked inside the adapter queue, not in a preceding read', async () => {
  const f = fixture();
  const queueEntered = deferred(), queueRelease = deferred(), captured = deferred();
  const blocker = f.enqueue(async () => { queueEntered.resolve(); await queueRelease.promise; });
  await queueEntered.promise;
  f.whenWriteCaptured(() => captured.resolve());
  const pending = f.service.process(f.file, fm => { f.stats.mutators++; fm.status = 'complete'; });
  const outcome = assert.rejects(pending, /changed|pending/u);
  await captured.promise;
  const newer = initial.replace('Synthetic body', 'Newer authored body');
  f.disk.set(f.file.path, newer);
  queueRelease.resolve();
  await blocker;
  await outcome;
  assert.equal(f.disk.get(f.file.path), newer);
  assert.equal(f.stats.writes, 0);
  assert.equal(f.stats.mutators, 1);
});

test('a same-path replacement TFile cannot receive a pending action', async () => {
  const f = fixture();
  const entered = deferred(), release = deferred();
  const pending = f.service.process(f.file, async fm => { entered.resolve(); await release.promise; fm.status = 'complete'; });
  const outcome = assert.rejects(pending, /changed|pending|target/u);
  await entered.promise;
  const replacement = { ...f.file };
  f.files.set(f.file.path, replacement);
  release.resolve();
  await outcome;
  assert.equal(f.disk.get(f.file.path), initial);
  assert.equal(f.stats.writes, 0);
  assert.equal(f.stats.events, 0);
});

test('target identity is checked after the atomic operation enters the adapter queue', async () => {
  const f = fixture();
  const entered = deferred(), release = deferred(), captured = deferred();
  const blocker = f.enqueue(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  f.whenWriteCaptured(() => captured.resolve());
  const pending = f.service.process(f.file, fm => { fm.status = 'complete'; });
  const outcome = assert.rejects(pending, /changed|pending|target/u);
  await captured.promise;
  f.files.set(f.file.path, { ...f.file });
  release.resolve();
  await blocker;
  await outcome;
  assert.equal(f.disk.get(f.file.path), initial, 'identical source bytes cannot authorize a different target');
  assert.equal(f.stats.writes, 0);
  assert.equal(f.stats.events, 0);
});

test('a target deleted before a pending action cannot be recreated', async () => {
  const f = fixture();
  const entered = deferred(), release = deferred();
  const pending = f.service.process(f.file, async fm => { entered.resolve(); await release.promise; fm.status = 'complete'; });
  const outcome = assert.rejects(pending, /ENOENT|changed|pending|target/u);
  await entered.promise;
  f.disk.delete(f.file.path); f.files.delete(f.file.path);
  release.resolve();
  await outcome;
  assert.equal(f.disk.size, 0);
  assert.equal(f.stats.events, 0);
  assert.equal(f.stats.writes, 0);
});

test('an external line-ending-only edit is real source drift, not permission to overwrite', async () => {
  const f = fixture();
  const entered = deferred(), release = deferred();
  const pending = f.service.process(f.file, async fm => { entered.resolve(); await release.promise; fm.status = 'complete'; });
  const outcome = assert.rejects(pending, /changed|pending/u);
  await entered.promise;
  const newer = initial.replace(/\n/gu, '\r\n');
  f.disk.set(f.file.path, newer);
  release.resolve();
  await outcome;
  assert.equal(f.disk.get(f.file.path), newer);
  assert.equal(f.stats.writes, 0);
  assert.equal(f.stats.events, 0);
});

for (const [label, source, body] of [
  ['LF', initial, 'Synthetic body\n'],
  ['BOM and CRLF', `\uFEFF${initial.replace(/\n/gu, '\r\n')}`, 'Synthetic body\r\n'],
  ['mixed body line endings', initial.replace('Synthetic body\n', 'First body\r\nSecond body\nThird body\r\n'), 'First body\r\nSecond body\nThird body\r\n'],
]) {
  test(`one successful async action preserves ${label} body bytes`, async () => {
    const f = fixture(source);
    assert.equal(await f.service.process(f.file, async fm => { f.stats.mutators++; await Promise.resolve(); fm.status = 'complete'; }), true);
    const saved = f.disk.get(f.file.path);
    assert.equal(frontmatter(saved).status, 'complete');
    assert.ok(saved.endsWith(body));
    assert.equal(saved.startsWith('\uFEFF'), source.startsWith('\uFEFF'));
    if (label === 'BOM and CRLF') assert.doesNotMatch(saved, /(?<!\r)\n/u);
    assert.equal(f.stats.mutators, 1);
    assert.equal(f.stats.modifies, 0);
    assert.equal(f.stats.processes, 1);
    assert.equal(f.stats.writes, 1);
    assert.equal(f.stats.events, 1);
  });
}

test('unchanged property bursts retain exact source without entering an atomic write', async () => {
  const source = initial.replace('status: working', 'status: "working" # authored');
  const f = fixture(source);
  for (let index = 0; index < 20; index++) assert.equal(await f.service.process(f.file, fm => { fm.status = 'working'; }), false);
  assert.equal(f.disk.get(f.file.path), source);
  assert.equal(f.stats.reads, 20);
  assert.equal(f.stats.modifies, 0);
  assert.equal(f.stats.processes, 0);
  assert.equal(f.stats.writes, 0);
  assert.equal(f.stats.events, 0);
});

for (const [label, source, body] of [
  ['ellipsis delimiter', initial.replace('\n---\nSynthetic body', '\n...\nSynthetic body'), 'Synthetic body\n'],
  ['whitespace-padded CRLF frontmatter', `\r\n \r\n${initial.replace(/\n/gu, '\r\n')}`, 'Synthetic body\r\n'],
  ['no frontmatter', 'First body\r\nSecond body\nThird body\r\n', 'First body\r\nSecond body\nThird body\r\n'],
  ['BOM without frontmatter', '\uFEFFFirst body\r\nSecond body\n', 'First body\r\nSecond body\n'],
  ['frontmatter without trailing newline', '---\nstatus: working\n---', ''],
]) {
  test(`a changed property preserves the accepted ${label} source's body`, async () => {
    const f = fixture(source);
    assert.equal(await f.service.process(f.file, fm => { fm.status = 'complete'; }), true);
    const saved = f.disk.get(f.file.path);
    assert.equal(frontmatter(saved).status, 'complete');
    assert.ok(saved.endsWith(body));
    assert.equal(saved.startsWith('\uFEFF'), source.startsWith('\uFEFF'));
    assert.equal(f.stats.writes, 1);
    assert.equal(f.stats.events, 1);
  });
}
