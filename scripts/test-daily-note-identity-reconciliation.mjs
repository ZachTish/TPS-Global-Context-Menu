import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

async function loadDailyNoteIdentity() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/utils/daily-note-task-schedule.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian-stub', namespace: 'obsidian-stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'obsidian-stub' }, () => ({
          loader: 'js',
          contents: `
            const months = {
              Jan: 1, January: 1, Feb: 2, February: 2, Mar: 3, March: 3,
              Apr: 4, April: 4, May: 5, Jun: 6, June: 6, Jul: 7, July: 7,
              Aug: 8, August: 8, Sep: 9, Sept: 9, September: 9,
              Oct: 10, October: 10, Nov: 11, November: 11, Dec: 12, December: 12,
            };
            const shortMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const longMonths = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            const shortDays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            const longDays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
            const pad = value => String(value).padStart(2, '0');
            const parse = value => {
              const text = String(value || '').trim();
              let match = text.match(/^(\\d{4})-(\\d{2})-(\\d{2})(?:[ T]\\d{2}:\\d{2}(?::\\d{2})?)?$/);
              if (!match) match = text.match(/^(\\d{4})_(\\d{2})_(\\d{2})$/);
              if (!match) match = text.match(/^(\\d{4})(\\d{2})(\\d{2})$/);
              if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
              match = text.match(/^(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\\s+([A-Za-z]+)\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})$/);
              if (!match) match = text.match(/^([A-Za-z]+)\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})$/);
              if (match && months[match[1]]) return new Date(Number(match[3]), months[match[1]] - 1, Number(match[2]));
              return new Date(Number.NaN);
            };
            const factory = value => {
              const date = parse(value);
              return {
                isValid: () => !Number.isNaN(date.getTime()),
                format(pattern) {
                  return String(pattern || '')
                    .replace('dddd', longDays[date.getDay()])
                    .replace('ddd', shortDays[date.getDay()])
                    .replace('MMMM', longMonths[date.getMonth()])
                    .replace('MMM', shortMonths[date.getMonth()])
                    .replace('YYYY', String(date.getFullYear()))
                    .replace('MM', pad(date.getMonth() + 1))
                    .replace('DD', pad(date.getDate()))
                    .replace(/(^|[^D])D([^D]|$)/, (_all, before, after) => before + String(date.getDate()) + after);
                },
              };
            };
            factory.ISO_8601 = Symbol('ISO_8601');
            factory.invalid = () => ({ isValid: () => false, format: () => '' });
            export const moment = factory;
            export class App {}
            export class TFile {
              constructor(path) { this.setPath(path); }
              setPath(path) {
                this.path = path;
                this.name = path.split('/').pop() || path;
                this.basename = this.name.replace(/\\.[^.]+$/, '');
                this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
              }
              static [Symbol.hasInstance](value) {
                return Boolean(value && value.__isTestTFile === true);
              }
            }
            export class TFolder {}
            export class Notice {}
            export function normalizePath(path) {
              return String(path || '').replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/').replace(/^\\//, '');
            }
            export function parseYaml(source) {
              const parsed = {};
              for (const line of String(source || '').split(/\\r?\\n/)) {
                const match = line.match(/^([^:#]+):\\s*(.*)$/);
                if (!match) continue;
                let value = match[2].trim();
                try {
                  value = JSON.parse(value);
                } catch {
                  if (/^(['"]).*\\1$/.test(value)) value = value.slice(1, -1);
                }
                parsed[match[1].trim()] = value;
              }
              return parsed;
            }
            export function stringifyYaml(value) { return JSON.stringify(value); }
          `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const identity = await loadDailyNoteIdentity();

function makeFile(path) {
  const name = path.split('/').pop() || path;
  return {
    __isTestTFile: true,
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    extension: 'md',
  };
}

function createHarness(entries = [], { format = 'ddd, MMM D YYYY', folder = '', onCreateFolder, onRead } = {}) {
  const files = new Map();
  const frontmatter = new Map();
  const contents = new Map();
  const folders = new Map();
  const renames = [];
  const vaultListeners = new Map();
  const metadataListeners = new Map();
  let markdownScanCount = 0;
  let vaultReadCount = 0;
  const coreOptions = { folder, format, template: '' };
  const emit = (listeners, event, ...args) => {
    for (const callback of listeners.get(event) || []) callback(...args);
  };
  for (const entry of entries) {
    const file = makeFile(entry.path);
    files.set(file.path, file);
    frontmatter.set(file.path, entry.frontmatter || {});
    const fields = entry.frontmatter || {};
    contents.set(file.path, entry.content ?? (Object.keys(fields).length > 0
      ? `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n`
      : ''));
  }
  const app = {
    internalPlugins: {
      getPluginById(id) {
        return id === 'daily-notes'
          ? { enabled: true, instance: { options: coreOptions } }
          : null;
      },
      plugins: {},
    },
    metadataCache: {
      getFileCache(file) {
        return { frontmatter: frontmatter.get(file.path) || {} };
      },
      on(event, callback) {
        const callbacks = metadataListeners.get(event) || [];
        callbacks.push(callback);
        metadataListeners.set(event, callbacks);
      },
    },
    vault: {
      getAbstractFileByPath(path) {
        return files.get(path) || folders.get(path) || null;
      },
      getMarkdownFiles() {
        markdownScanCount += 1;
        return Array.from(files.values());
      },
      async read(file) {
        if (!contents.has(file.path)) throw new Error(`Missing file: ${file.path}`);
        vaultReadCount += 1;
        const current = contents.get(file.path);
        await onRead?.({ app, file, current, contents, frontmatter });
        return current;
      },
      on(event, callback) {
        const callbacks = vaultListeners.get(event) || [];
        callbacks.push(callback);
        vaultListeners.set(event, callbacks);
      },
      async createFolder(path) {
        await onCreateFolder?.({ path, files, frontmatter, folders });
        folders.set(path, { path, children: [] });
      },
    },
    fileManager: {
      async renameFile(file, targetPath) {
        const oldPath = file.path;
        assert.equal(files.get(oldPath), file);
        assert.equal(files.has(targetPath), false);
        files.delete(oldPath);
        const metadata = frontmatter.get(oldPath) || {};
        const content = contents.get(oldPath) || '';
        frontmatter.delete(oldPath);
        contents.delete(oldPath);
        file.path = targetPath;
        file.name = targetPath.split('/').pop() || targetPath;
        file.basename = file.name.replace(/\.[^.]+$/, '');
        files.set(targetPath, file);
        frontmatter.set(targetPath, metadata);
        contents.set(targetPath, content);
        renames.push({ oldPath, targetPath });
        emit(vaultListeners, 'rename', file, oldPath);
      },
    },
  };
  return {
    app,
    files,
    frontmatter,
    contents,
    folders,
    renames,
    coreOptions,
    emitMetadata(event, ...args) {
      emit(metadataListeners, event, ...args);
    },
    addFile(path, metadata = {}) {
      const file = makeFile(path);
      files.set(path, file);
      frontmatter.set(path, metadata);
      contents.set(path, Object.keys(metadata).length > 0
        ? `---\n${Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n`
        : '');
      emit(vaultListeners, 'create', file);
      emit(metadataListeners, 'changed', file);
      identity.invalidateDailyNoteCandidateIndex(app);
      return file;
    },
    get markdownScanCount() {
      return markdownScanCount;
    },
    get vaultReadCount() {
      return vaultReadCount;
    },
  };
}

test('flat-root readable records are never classified as Daily Notes', () => {
  const harness = createHarness([
    { path: '2026-08-25 - Calendar event.md', frontmatter: { kind: 'calendar-event', scheduled: '2026-08-25 09:00:00' } },
    { path: '2026-08-25 - Honeycrisp apple.md', frontmatter: { kind: 'food-entry', scheduled: '2026-08-25 12:00:00' } },
    { path: '2026-08-25 - Workout 06.16.md', frontmatter: { kind: 'workout-session', scheduled: '2026-08-25 06:16:00' } },
    { path: '2026-08-03T10-00.md', frontmatter: {} },
    { path: '2026-08-28.backup.md', frontmatter: {} },
    { path: 'Tue, Aug 25 2026.md', frontmatter: { kind: 'workout' } },
    { path: '2026-08-29.md', frontmatter: { kind: 'calendar-event' } },
    { path: '2026-08-30.md', frontmatter: { kind: 'food-entry' } },
    { path: '2026-08-31.md', frontmatter: { kind: 'workout-session' } },
    { path: '2026-09-01.md', frontmatter: { type: 'project' } },
    { path: '2026-09-02.md', frontmatter: { types: ['asset'] } },
  ]);
  for (const file of harness.files.values()) {
    assert.equal(identity.parseDailyNoteFileDate(harness.app, {}, file), null, file.path);
    assert.equal(identity.getInheritedDailyNoteTaskScheduledValue(harness.app, {}, file), null, file.path);
  }
  assert.equal(identity.findExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-25'), null);
});

test('strict whole-name legacy formats and authoritative metadata remain supported', () => {
  const harness = createHarness([
    { path: '2026-08-25.md' },
    { path: '20260826.md' },
    { path: 'August 27, 2026.md' },
    { path: 'Tuesday, August 28th 2026.md' },
    { path: 'Named daily 2026-08-28.md', frontmatter: { tags: ['daily-note'] } },
    { path: 'Journal.md', frontmatter: { recordKind: 'daily-note', scheduled: '2026-08-29 00:00:00' } },
    { path: 'Daily alias.md', frontmatter: { kind: 'daily', scheduled: '2026-08-30' } },
    { path: 'Note daily alias.md', frontmatter: { kind: 'note/daily', scheduled: '2026-08-31' } },
    { path: 'Type note daily kind alias.md', frontmatter: { kind: 'type/note/daily', scheduled: '2026-09-01' } },
    { path: 'Daily type alias.md', frontmatter: { type: 'note/daily', scheduled: '2026-09-02' } },
    { path: 'Daily tag alias.md', frontmatter: { tags: ['type/note/daily'], scheduled: '2026-09-03' } },
    { path: 'Daily Note Template.md', frontmatter: { kind: 'dailynote', scheduled: '<% tp.date.now() %>' } },
    { path: 'Workout.md', frontmatter: { kind: 'workout', tags: ['dailynote'], scheduled: '2026-09-04 00:00:00' } },
    { path: 'Workout Session.md', frontmatter: { kind: 'workout-session', tags: ['dailynote'], scheduled: '2026-09-04 00:00:00' } },
    { path: '2026-09-05.md', frontmatter: { kind: 'calendar-event', tags: ['dailynote'] } },
  ]);
  const settings = { nativeRecordKindPropertyKey: 'recordKind' };
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('2026-08-25.md')), '2026-08-25');
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('20260826.md')), '2026-08-26');
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('August 27, 2026.md')), '2026-08-27');
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('Tuesday, August 28th 2026.md')), '2026-08-28');
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('Named daily 2026-08-28.md')), '2026-08-28');
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('Journal.md')), '2026-08-29');
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('Daily alias.md')), '2026-08-30');
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('Note daily alias.md')), '2026-08-31');
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('Type note daily kind alias.md')), '2026-09-01');
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('Daily type alias.md')), '2026-09-02');
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('Daily tag alias.md')), '2026-09-03');
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('Daily Note Template.md')), null);
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('Workout.md')), null);
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('Workout Session.md')), null);
  assert.equal(identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('2026-09-05.md')), null);
});

test('an authoritative non-Daily kind wins over stale Daily Note tags and blocks mutation', async () => {
  const canonicalPath = 'Tue, Aug 25 2026.md';
  const harness = createHarness([{
    path: canonicalPath,
    frontmatter: { kind: 'calendar-event', tags: ['dailynote'], type: 'note/daily' },
  }]);
  const file = harness.files.get(canonicalPath);
  assert.equal(identity.parseDailyNoteFileDate(harness.app, {}, file), null);
  const result = await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-25');
  assert.deepEqual(result, { status: 'blocked', file: null, reason: 'target-not-daily-note' });
  assert.deepEqual(harness.renames, []);
});

test('custom authored kind values veto canonical and strict-path Daily identity', async () => {
  const settings = { nativeRecordKindPropertyKey: 'recordKind' };
  const canonicalPath = 'Tue, Aug 25 2026.md';
  const harness = createHarness([
    { path: canonicalPath, frontmatter: { recordKind: 'meeting' } },
    { path: '2026-08-26.md', frontmatter: { recordKind: 'meeting' } },
    { path: '2026-08-27.md', frontmatter: { kinds: ['dailynote', 'meeting'] } },
    { path: '2026-08-28.md', frontmatter: { type: 'meeting' } },
  ]);

  assert.equal(
    identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get(canonicalPath)),
    null,
  );
  assert.equal(
    identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('2026-08-26.md')),
    null,
  );
  assert.equal(
    identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('2026-08-27.md')),
    null,
  );
  // `type`/`types` remains a deliberate compatibility surface: unknown legacy
  // type values do not override strict path identity, while known TPS record
  // types continue to veto it.
  assert.equal(
    identity.parseDailyNoteFileDate(harness.app, settings, harness.files.get('2026-08-28.md')),
    '2026-08-28',
  );

  assert.deepEqual(
    await identity.reconcileExistingDailyNoteForIsoDate(harness.app, settings, '2026-08-25'),
    { status: 'blocked', file: null, reason: 'target-not-daily-note' },
  );
  assert.deepEqual(
    await identity.reconcileExistingDailyNoteForIsoDate(harness.app, settings, '2026-08-26'),
    { status: 'absent', file: null },
  );
  assert.deepEqual(harness.renames, []);
});

test('live non-Daily bytes override stale Daily Note cache before canonical return or legacy rename', async () => {
  const projectBytes = (date) => [
    '---',
    'kind: project',
    `scheduled: ${date} 00:00:00`,
    '---',
    'Project body',
  ].join('\n');
  const canonical = createHarness([{
    path: 'Tue, Aug 25 2026.md',
    frontmatter: { kind: 'dailynote' },
    content: projectBytes('2026-08-25'),
  }]);
  assert.deepEqual(
    await identity.reconcileExistingDailyNoteForIsoDate(canonical.app, {}, '2026-08-25'),
    { status: 'blocked', file: null, reason: 'source-identity-changed' },
  );
  assert.deepEqual(canonical.renames, []);

  const legacy = createHarness([{
    path: '2026-08-26.md',
    frontmatter: { kind: 'dailynote' },
    content: projectBytes('2026-08-26'),
  }]);
  assert.deepEqual(
    await identity.reconcileExistingDailyNoteForIsoDate(legacy.app, {}, '2026-08-26'),
    { status: 'blocked', file: null, reason: 'source-identity-changed' },
  );
  assert.deepEqual(legacy.renames, []);
  assert.equal(legacy.files.has('2026-08-26.md'), true);
});

test('a dirty named legacy Daily Note overrides stale-negative cache before absence can create a duplicate', async () => {
  const path = 'Planning journal.md';
  const harness = createHarness([{
    path,
    frontmatter: { kind: 'project' },
    content: [
      '---',
      'kind: dailynote',
      'scheduled: 2026-08-27 00:00:00',
      '---',
      'Live Daily Note body',
    ].join('\n'),
  }]);
  const file = harness.files.get(path);
  assert.equal(identity.findExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-27'), null);
  identity.markDailyNoteCandidatePathDirty(harness.app, file);

  const result = await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-27');
  assert.equal(result.status, 'found');
  assert.equal(result.file?.path, 'Thu, Aug 27 2026.md');
  assert.deepEqual(harness.renames, [{ oldPath: path, targetPath: 'Thu, Aug 27 2026.md' }]);
});

test('a live moved companion override is excluded from the Daily Note candidate index', async () => {
  const path = 'Moved companion candidate.md';
  const harness = createHarness([{
    path,
    frontmatter: { kind: 'dailynote', scheduled: '2026-09-06 00:00:00' },
    content: [
      '---',
      'tpsGcmFileProperties: 1',
      'tpsGcmFileId: moved-companion',
      'tpsGcmSourcePath: Assets/Source.canvas',
      'kind: dailynote',
      'scheduled: 2026-09-06 00:00:00',
      '---',
      'Companion body',
    ].join('\n'),
  }]);
  identity.markDailyNoteCandidatePathDirty(harness.app, harness.files.get(path));

  assert.deepEqual(
    await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, '2026-09-06'),
    { status: 'absent', file: null },
  );
  assert.deepEqual(harness.renames, []);
});

test('startup reconciliation waits for initialized metadata before trusting a non-null stale cache', async () => {
  const path = 'Startup planning.md';
  const liveFrontmatter = { kind: 'dailynote', scheduled: '2026-08-29 00:00:00' };
  const harness = createHarness([{
    path,
    frontmatter: { kind: 'project' },
    content: '---\nkind: dailynote\nscheduled: 2026-08-29 00:00:00\n---\nStartup Daily Note',
  }]);
  harness.app.metadataCache.initialized = false;

  const pending = identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-29');
  setTimeout(() => {
    harness.frontmatter.set(path, liveFrontmatter);
    harness.app.metadataCache.initialized = true;
    harness.emitMetadata('resolved');
  }, 40);
  const result = await pending;

  assert.equal(result.status, 'found');
  assert.equal(result.file?.path, 'Sat, Aug 29 2026.md');
  assert.deepEqual(harness.renames, [{ oldPath: path, targetPath: 'Sat, Aug 29 2026.md' }]);
});

test('a newer dirty generation supersedes an older async source read', async () => {
  const path = 'Concurrent planning.md';
  let changedDuringRead = false;
  const harness = createHarness(
    [{
      path,
      frontmatter: { kind: 'project' },
      content: '---\nkind: project\n---\nOld project bytes',
    }],
    {
      async onRead({ app, file, contents }) {
        if (changedDuringRead || file.path !== path) return;
        changedDuringRead = true;
        contents.set(path, '---\nkind: dailynote\nscheduled: 2026-08-28 00:00:00\n---\nNew Daily Note bytes');
        identity.markDailyNoteCandidatePathDirty(app, file);
      },
    },
  );
  identity.markDailyNoteCandidatePathDirty(harness.app, harness.files.get(path));

  const result = await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-28');
  assert.equal(result.status, 'found');
  assert.equal(result.file?.path, 'Fri, Aug 28 2026.md');
  assert.deepEqual(harness.renames, [{ oldPath: path, targetPath: 'Fri, Aug 28 2026.md' }]);
  assert.ok(harness.vaultReadCount >= 3, 'the superseded read must be retried before reconciliation');
});

test('delayed path and global metadata-ready events preserve a newer dirty generation', async () => {
  for (const readyScope of ['path', 'global']) {
    const isoDate = readyScope === 'path' ? '2026-08-30' : '2026-08-31';
    const targetPath = readyScope === 'path' ? 'Sun, Aug 30 2026.md' : 'Mon, Aug 31 2026.md';
    const sourcePath = `${readyScope} delayed metadata.md`;
    const harness = createHarness([{
      path: sourcePath,
      frontmatter: { kind: 'project' },
      content: '---\nkind: project\n---\nOld project bytes',
    }]);
    const file = harness.files.get(sourcePath);

    identity.markDailyNoteCandidatePathDirty(harness.app, file);
    harness.contents.set(sourcePath, [
      '---',
      'kind: dailynote',
      `scheduled: ${isoDate} 00:00:00`,
      '---',
      'New Daily Note bytes',
    ].join('\n'));
    identity.markDailyNoteCandidatePathDirty(harness.app, file);

    // This event belongs to the first write. Because Obsidian supplies no
    // generation token, neither a path event nor a global resolved event may
    // clear the newer pending source proof.
    identity.markDailyNoteCandidateMetadataReady(
      harness.app,
      readyScope === 'path' ? file : undefined,
    );

    const result = await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, isoDate);
    assert.equal(result.status, 'found');
    assert.equal(result.file?.path, targetPath);
    assert.deepEqual(harness.renames, [{ oldPath: sourcePath, targetPath }]);
  }
});

test('warm absence checks do not reread the full vault after dirty paths are inspected once', async () => {
  const path = 'Recently edited project.md';
  const harness = createHarness([{
    path,
    frontmatter: { kind: 'project' },
    content: '---\nkind: project\n---\nProject body',
  }]);
  identity.markDailyNoteCandidatePathDirty(harness.app, harness.files.get(path));
  assert.deepEqual(
    await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-30'),
    { status: 'absent', file: null },
  );
  assert.equal(harness.vaultReadCount, 1);
  assert.deepEqual(
    await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-31'),
    { status: 'absent', file: null },
  );
  assert.equal(harness.vaultReadCount, 1, 'the warm path must reuse the live override without another source read');
});

test('a recovered persisted configuration yields when Core Daily Notes settles or changes', () => {
  const harness = createHarness([], { folder: '', format: '' });
  assert.equal(identity.registerDailyNoteConfigurationOverride(harness.app, 'Journal', 'YYYY_MM_DD'), true);
  assert.equal(
    identity.getDailyNotePathForIsoDate(harness.app, {}, '2026-08-25'),
    'Journal/2026_08_25.md',
  );

  harness.coreOptions.folder = 'New Journal';
  harness.coreOptions.format = 'YYYY-MM-DD';
  harness.coreOptions.template = 'Templates/Daily';
  assert.equal(
    identity.getDailyNotePathForIsoDate(harness.app, {}, '2026-08-25'),
    'New Journal/2026-08-25.md',
  );
  assert.equal(identity.hasActiveDailyNoteConfigurationOverride(harness.app), false);
  assert.equal(identity.registerDailyNoteConfigurationOverride(harness.app, 'Journal', 'YYYY_MM_DD'), false);
});

test('public lookup stays synchronous and observational while explicit reconciliation renames one legacy note', async () => {
  const harness = createHarness([{ path: '2026-08-25.md', frontmatter: { kind: 'dailynote' } }]);
  const observed = identity.findExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-25');
  assert.equal(observed?.path, '2026-08-25.md');
  assert.equal(observed instanceof Promise, false);
  assert.deepEqual(harness.renames, []);

  const reconciled = await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-25');
  assert.equal(reconciled.status, 'found');
  assert.equal(reconciled.file?.path, 'Tue, Aug 25 2026.md');
  assert.deepEqual(harness.renames, [{ oldPath: '2026-08-25.md', targetPath: 'Tue, Aug 25 2026.md' }]);
});

test('expected-path reconciliation never renames through a changed provider target', async () => {
  const harness = createHarness([{ path: '20260825.md' }]);
  const result = await identity.reconcileExistingDailyNoteForIsoDate(
    harness.app,
    {},
    '2026-08-25',
    { expectedPath: 'Old Daily/2026-08-25.md' },
  );
  assert.deepEqual(result, { status: 'blocked', file: null, reason: 'expected-path-mismatch' });
  assert.deepEqual(harness.renames, []);
  assert.equal(harness.files.has('20260825.md'), true);
});

test('mixed constrained and unconstrained reconciliation shares one ISO-date mutation gate', async () => {
  let releaseFolderCreate;
  const folderCreateReleased = new Promise((resolve) => { releaseFolderCreate = resolve; });
  let folderCreateEntered;
  const folderCreateStarted = new Promise((resolve) => { folderCreateEntered = resolve; });
  let blocked = false;
  const harness = createHarness(
    [{ path: '20260825.md', frontmatter: { kind: 'dailynote' } }],
    {
      folder: 'Daily',
      async onCreateFolder({ path }) {
        if (blocked || path !== 'Daily') return;
        blocked = true;
        folderCreateEntered();
        await folderCreateReleased;
      },
    },
  );
  const constrained = identity.reconcileExistingDailyNoteForIsoDate(
    harness.app,
    {},
    '2026-08-25',
    { expectedPath: 'Daily/Tue, Aug 25 2026.md' },
  );
  const firstBoundary = await Promise.race([
    folderCreateStarted.then(() => 'folder-create'),
    constrained.then((result) => ({ result })),
  ]);
  assert.equal(firstBoundary, 'folder-create');
  harness.coreOptions.folder = 'New Daily';
  const unconstrained = identity.reconcileExistingDailyNoteForIsoDate(
    harness.app,
    {},
    '2026-08-25',
  );
  releaseFolderCreate();

  const [first, second] = await Promise.all([constrained, unconstrained]);
  assert.equal(first.status, 'blocked');
  assert.equal(second.status, 'found');
  assert.deepEqual(harness.renames, [{
    oldPath: '20260825.md',
    targetPath: 'New Daily/Tue, Aug 25 2026.md',
  }], 'the ordinary joiner retries only after the first rename lane closes');
  assert.equal(harness.files.has('20260825.md'), false);
  assert.equal(harness.files.has('New Daily/Tue, Aug 25 2026.md'), true);
});

test('canonical and distinct legacy candidates are blocked as ambiguous', async () => {
  const harness = createHarness([
    { path: 'Tue, Aug 25 2026.md', frontmatter: { kind: 'dailynote' } },
    { path: '2026-08-25.md', frontmatter: { kind: 'dailynote' } },
    { path: 'Named 2026-08-25.md', frontmatter: { tags: ['daily-note'] } },
  ]);
  const result = await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-25');
  assert.deepEqual(result, { status: 'blocked', file: null, reason: 'canonical-and-legacy-candidates' });
  assert.deepEqual(harness.renames, []);
});

test('conflicting authoritative date signals block every implicated date', async () => {
  const harness = createHarness([
    {
      path: 'Named 2026-08-25.md',
      frontmatter: {
        kind: 'dailynote',
        scheduled: '2026-08-26 00:00:00',
        title: 'August 27, 2026',
      },
    },
  ]);
  assert.equal(identity.parseDailyNoteFileDate(harness.app, {}, harness.files.get('Named 2026-08-25.md')), null);
  for (const isoDate of ['2026-08-25', '2026-08-26', '2026-08-27']) {
    const result = await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, isoDate);
    assert.deepEqual(result, { status: 'blocked', file: null, reason: 'conflicting-identity-signals' }, isoDate);
  }
});

test('strict ISO APIs reject timestamps, non-ASCII digits, and impossible dates', async () => {
  const harness = createHarness();
  assert.equal(identity.normalizeDailyNoteIsoDate('2024-02-29'), '2024-02-29');
  for (const value of ['2026-02-29', '2026-02-30', '2026-08-25T00:00:00', '２０２６-０８-２５', '2026-8-25']) {
    assert.equal(identity.normalizeDailyNoteIsoDate(value), null, value);
    assert.equal(identity.findExistingDailyNoteForIsoDate(harness.app, {}, value), null, value);
    assert.equal(identity.getDailyNotePathForIsoDate(harness.app, {}, value), null, value);
    assert.deepEqual(
      await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, value),
      { status: 'blocked', file: null, reason: 'invalid-iso-date' },
      value,
    );
  }
});

test('candidate lookup scans once across dates and invalidates after a vault change', () => {
  const harness = createHarness([{ path: '2026-08-25.md' }]);
  assert.equal(identity.findExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-25')?.path, '2026-08-25.md');
  assert.equal(identity.findExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-26'), null);
  assert.equal(identity.findExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-27'), null);
  assert.equal(harness.markdownScanCount, 1);

  harness.addFile('2026-08-26.md');
  assert.equal(identity.findExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-26')?.path, '2026-08-26.md');
  assert.equal(harness.markdownScanCount, 2);
});

test('zero-byte canonical Daily Notes do not wait for an impossible metadata entry', async () => {
  const path = 'Inbox/Daily/2026-08-25.md';
  const harness = createHarness(
    [{ path, content: '' }],
    { folder: 'Inbox/Daily', format: 'YYYY-MM-DD' },
  );
  const file = harness.files.get(path);
  file.stat = { ctime: 1, mtime: 1, size: 0 };
  harness.app.metadataCache.initialized = true;
  harness.app.metadataCache.getFileCache = () => null;

  assert.equal(identity.isMarkdownMetadataEntrySettled(harness.app, file), true);
  assert.deepEqual(
    await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-25'),
    { status: 'found', file },
  );
  assert.deepEqual(harness.renames, []);
});

test('blocked identity can read only the exact canonical Daily Note without authorizing legacy mutation', () => {
  const canonicalPath = 'Inbox/Daily/2026-08-25.md';
  const legacyPath = 'Legacy 2026-08-26.md';
  const harness = createHarness(
    [
      { path: canonicalPath, content: '' },
      { path: legacyPath, frontmatter: { kind: 'dailynote', scheduled: '2026-08-26' } },
    ],
    { folder: 'Inbox/Daily', format: 'YYYY-MM-DD' },
  );

  assert.equal(
    identity.findCanonicalDailyNoteForIsoDate(harness.app, {}, '2026-08-25'),
    harness.files.get(canonicalPath),
  );
  assert.equal(
    identity.findCanonicalDailyNoteForIsoDate(harness.app, {}, '2026-08-26'),
    null,
    'the read-only fallback must not surface or migrate a legacy candidate',
  );
  assert.equal(identity.findCanonicalDailyNoteForIsoDate(harness.app, {}, 'not-a-date'), null);
  assert.deepEqual(harness.renames, []);
});

test('canonical read fallback rejects authoritative non-Daily identity and unresolved non-empty bytes', () => {
  const canonicalPath = 'Inbox/Daily/2026-08-25.md';
  const harness = createHarness(
    [{ path: canonicalPath, frontmatter: { kind: 'project' } }],
    { folder: 'Inbox/Daily', format: 'YYYY-MM-DD' },
  );
  const file = harness.files.get(canonicalPath);
  file.stat = { ctime: 1, mtime: 1, size: 20 };

  assert.equal(
    identity.findCanonicalDailyNoteForIsoDate(harness.app, {}, '2026-08-25'),
    null,
    'an authoritative non-Daily kind must veto the configured path',
  );

  harness.frontmatter.set(canonicalPath, {});
  harness.app.metadataCache.getFileCache = () => null;
  assert.equal(
    identity.findCanonicalDailyNoteForIsoDate(harness.app, {}, '2026-08-25'),
    null,
    'a non-empty canonical file without current cached metadata must wait',
  );

  file.stat = { ctime: 1, mtime: 1, size: 0 };
  assert.equal(
    identity.findCanonicalDailyNoteForIsoDate(harness.app, {}, '2026-08-25'),
    file,
    'a zero-byte canonical file cannot conceal non-Daily frontmatter',
  );
  assert.deepEqual(harness.renames, []);
});

test('unrelated malformed notes settle observational identity while reconciliation stays fail-closed', async () => {
  const dailyPath = 'Inbox/Daily/2026-08-25.md';
  const malformedPath = '_archive/TPS Linter Unsafe YAML QA.md';
  const harness = createHarness(
    [
      { path: dailyPath, content: '' },
      { path: malformedPath, frontmatter: { kind: 'project' }, content: '---\nkind: project\n' },
    ],
    { folder: 'Inbox/Daily', format: 'YYYY-MM-DD' },
  );
  const dailyFile = harness.files.get(dailyPath);
  const malformedFile = harness.files.get(malformedPath);
  identity.markDailyNoteCandidatePathDirty(harness.app, malformedFile);

  assert.equal(await identity.refreshPendingDailyNoteCandidatePaths(harness.app, {}), false);
  assert.equal(
    identity.hasPendingDailyNoteCandidatePathRefresh(harness.app),
    false,
    'stable malformed bytes must not masquerade as indexing work forever',
  );
  assert.equal(
    identity.findExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-25'),
    dailyFile,
    'an unrelated malformed source must not hide an existing canonical Daily Note',
  );
  assert.deepEqual(
    await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-25'),
    { status: 'blocked', file: null, reason: 'dirty-source-unresolved' },
    'mutation reconciliation must remain fail-closed while malformed identity evidence exists',
  );

  harness.contents.set(malformedPath, '---\nkind: project\n---\nRepaired');
  identity.markDailyNoteCandidatePathDirty(harness.app, malformedFile);
  assert.equal(await identity.refreshPendingDailyNoteCandidatePaths(harness.app, {}), true);
  assert.deepEqual(
    await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-25'),
    { status: 'found', file: dailyFile },
  );
});

test('background metadata floods share one worker and replay bounded progress through zero dirty', async () => {
  const entries = Array.from({ length: 48 }, (_, index) => ({
    path: `Inbox/Startup ${String(index).padStart(2, '0')}.md`,
    content: `Startup ${index}`,
  }));
  let activeReads = 0;
  let maxConcurrentReads = 0;
  let firstReadReleased = false;
  let signalFirstReadStarted;
  let releaseFirstRead;
  const firstReadStarted = new Promise((resolve) => { signalFirstReadStarted = resolve; });
  const firstReadGate = new Promise((resolve) => { releaseFirstRead = resolve; });
  const harness = createHarness(entries, {
    async onRead() {
      activeReads += 1;
      maxConcurrentReads = Math.max(maxConcurrentReads, activeReads);
      try {
        if (!firstReadReleased) {
          firstReadReleased = true;
          signalFirstReadStarted();
          await firstReadGate;
        }
      } finally {
        activeReads -= 1;
      }
    },
  });
  const files = Array.from(harness.files.values());
  for (const file of files.slice(0, -1)) {
    identity.markDailyNoteCandidatePathDirty(harness.app, file);
  }

  const originalNow = Date.now;
  let fakeNow = 0;
  Date.now = () => {
    fakeNow += 1_500;
    return fakeNow;
  };
  try {
    const owner = identity.refreshPendingDailyNoteCandidatePaths(harness.app, {});
    const joined = Array.from({ length: 2_048 }, () =>
      identity.refreshPendingDailyNoteCandidatePaths(harness.app, {}));
    assert.ok(joined.every((promise) => promise === owner), 'every overlapping callback must join one promise');

    await firstReadStarted;
    identity.markDailyNoteCandidatePathDirty(harness.app, files.at(-1));
    const trailing = identity.refreshPendingDailyNoteCandidatePaths(harness.app, {});
    assert.equal(trailing, owner, 'a generation arriving mid-pass must request replay on the same owner');
    releaseFirstRead();

    const results = await Promise.all([owner, ...joined, trailing]);
    assert.ok(results.every(Boolean));
    assert.equal(identity.hasPendingDailyNoteCandidatePathRefresh(harness.app), false);
    assert.equal(maxConcurrentReads, 1, 'background refreshes must never reread the vault concurrently');
    assert.equal(
      harness.vaultReadCount,
      files.length,
      'bounded passes must continue making progress without rereading drained generations',
    );
    const afterSettlement = identity.refreshPendingDailyNoteCandidatePaths(harness.app, {});
    assert.notEqual(
      afterSettlement,
      owner,
      'ownership must clear before settlement so a later callback cannot join a completed worker',
    );
    assert.equal(await afterSettlement, true);
  } finally {
    releaseFirstRead?.();
    Date.now = originalNow;
  }
});

test('async reconciliation waits for unresolved metadata before proving absence', async () => {
  const harness = createHarness([
    {
      path: 'Planning 2026-08-25.md',
      frontmatter: { kind: 'dailynote', scheduled: '2026-08-25 00:00:00' },
    },
  ]);
  const getResolvedCache = harness.app.metadataCache.getFileCache.bind(harness.app.metadataCache);
  let cacheReady = false;
  harness.app.metadataCache.initialized = false;
  harness.app.metadataCache.getFileCache = (file) => cacheReady ? getResolvedCache(file) : null;

  assert.equal(identity.findExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-25'), null);
  const pending = identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-25');
  setTimeout(() => {
    cacheReady = true;
    harness.app.metadataCache.initialized = true;
    harness.emitMetadata('resolved');
  }, 40);
  const result = await pending;

  assert.equal(result.status, 'found');
  assert.equal(result.file?.path, 'Tue, Aug 25 2026.md');
  assert.deepEqual(harness.renames, [
    { oldPath: 'Planning 2026-08-25.md', targetPath: 'Tue, Aug 25 2026.md' },
  ]);
});

test('ambiguous legacy identity and canonical collision fail closed', async () => {
  const ambiguous = createHarness([
    { path: '2026-08-25.md', frontmatter: { kind: 'dailynote' } },
    { path: 'Named 2026-08-25.md', frontmatter: { tags: ['daily-note'] } },
  ]);
  const ambiguousResult = await identity.reconcileExistingDailyNoteForIsoDate(ambiguous.app, {}, '2026-08-25');
  assert.deepEqual(ambiguousResult, { status: 'blocked', file: null, reason: 'ambiguous-legacy-candidates' });
  assert.deepEqual(ambiguous.renames, []);

  const collision = createHarness([{ path: '2026-08-25.md', frontmatter: { kind: 'dailynote' } }]);
  collision.folders.set('Tue, Aug 25 2026.md', { path: 'Tue, Aug 25 2026.md', children: [] });
  const collisionResult = await identity.reconcileExistingDailyNoteForIsoDate(collision.app, {}, '2026-08-25');
  assert.deepEqual(collisionResult, { status: 'blocked', file: null, reason: 'target-occupied' });
  assert.deepEqual(collision.renames, []);
});

test('legacy reconciliation aborts if the source is renamed while its target folder is created', async () => {
  const oldPath = 'Legacy daily 2026-08-25.md';
  const newPath = 'User renamed this note.md';
  const harness = createHarness(
    [{ path: oldPath, frontmatter: { kind: 'dailynote' } }],
    {
      folder: 'Daily',
      async onCreateFolder({ files, frontmatter }) {
        const file = files.get(oldPath);
        assert.ok(file);
        const metadata = frontmatter.get(oldPath);
        files.delete(oldPath);
        frontmatter.delete(oldPath);
        file.path = newPath;
        file.name = newPath;
        file.basename = newPath.replace(/\.md$/u, '');
        files.set(newPath, file);
        frontmatter.set(newPath, metadata);
      },
    },
  );

  const result = await identity.reconcileExistingDailyNoteForIsoDate(harness.app, {}, '2026-08-25');
  assert.deepEqual(result, { status: 'blocked', file: null, reason: 'legacy-source-changed' });
  assert.deepEqual(harness.renames, []);
  assert.equal(harness.files.has(newPath), true);
  assert.equal(harness.files.has('Daily/Tue, Aug 25 2026.md'), false);
});

test('Daily Note classification consumers use the hardened shared path', () => {
  const apiSource = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
  const fileNamingSource = readFileSync(new URL('../src/services/file-naming-service.ts', import.meta.url), 'utf8');
  const bulkEditSource = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');
  const noteOperationSource = readFileSync(new URL('../src/services/note-operation-service.ts', import.meta.url), 'utf8');
  const dailyNoteScheduleSource = readFileSync(new URL('../src/utils/daily-note-task-schedule.ts', import.meta.url), 'utf8');
  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const findForIsoDateSource = apiSource.match(/findForIsoDate:[\s\S]*?dateForFile:/u)?.[0] || '';

  assert.match(apiSource, /dailyNotes:\s*\{[\s\S]{0,120}version:\s*4/u);
  assert.match(findForIsoDateSource, /findCanonicalDailyNoteForIsoDate/u);
  assert.match(findForIsoDateSource, /if \(canonical\) return canonical/u);
  assert.match(findForIsoDateSource, /dailyNoteIdentityReady\(\)/u);
  assert.match(findForIsoDateSource, /findExistingDailyNoteForIsoDate/u);
  assert.match(apiSource, /dateForFile:\s*\(file: Pick<TFile, 'path' \| 'basename'>\) =>[\s\S]{0,160}normalizeDailyNoteIsoDate\(parseDailyNoteFileDate/u);
  assert.match(apiSource, /pathForIsoDate:[\s\S]{0,180}normalizeDailyNoteIsoDate\(isoDate\)/u);
  assert.match(apiSource, /refreshDailyNoteConfiguration\(\)[\s\S]{0,180}getDailyNotePathForIsoDate/u);
  assert.match(apiSource, /ensureForIsoDate: async[\s\S]{0,900}expectedPath[\s\S]{0,900}whenDailyNoteConfigurationReady\(\)/u);
  assert.match(apiSource, /ensure:expected-path-mismatch[\s\S]{0,500}noteOperationService\.ensureDailyNote/u);
  assert.match(noteOperationSource, /currentTargetPath !== path[\s\S]{0,120}expectedPath !== null && currentTargetPath !== expectedPath/u);
  assert.match(fileNamingSource, /parseDailyNoteFileDate\(this\.plugin\.app, this\.plugin\.settings, file\) !== null/u);
  assert.match(fileNamingSource, /registerEvent\.call\(this\.plugin, ref\)/u);
  assert.doesNotMatch(dailyNoteScheduleSource, /vault\?\.on\?\./u);
  assert.match(mainSource, /await this\.fileNamingService\.whenDailyNoteConfigurationReady\(\);\s*setupPluginApi\(this\)/u);
  assert.match(bulkEditSource, /return this\.plugin\.fileNamingService\.isDailyNoteFile\(file\)/u);
  assert.match(noteOperationSource, /reconcileExistingDailyNoteForIsoDate\([\s\S]{0,180}expectedPath === null \? undefined : \{ expectedPath \}/u);
  assert.match(noteOperationSource, /resolution\.status === 'blocked'[\s\S]*return null/u);
});
