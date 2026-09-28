import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { parse, stringify } from 'yaml';
import { fileURLToPath } from 'node:url';

const momentForTest = (value) => {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T| |$)/u);
  return {
    isValid: () => !!match,
    format: (format) => match
      ? format === 'YYYY_MM_DD' ? `${match[1]}_${match[2]}_${match[3]}`
        : format === 'YYYYMMDD' ? `${match[1]}${match[2]}${match[3]}`
          : `${match[1]}-${match[2]}-${match[3]}`
      : '',
  };
};
momentForTest.ISO_8601 = Symbol('ISO_8601');
momentForTest.invalid = () => momentForTest('');
globalThis.window = { moment: momentForTest, setTimeout, clearTimeout };
globalThis.titleOwnershipYaml = { parse, stringify };
const bundle = await build({
  stdin: {
    contents: [
      "export { FileNamingService } from './src/services/file-naming-service.ts';",
      "export { FrontmatterMutationService } from './src/services/frontmatter-mutation-service.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
  plugins: [{
    name: 'title-ownership-obsidian',
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'title-ownership' }));
      builder.onLoad({ filter: /.*/, namespace: 'title-ownership' }, () => ({
        loader: 'js',
        contents: `
          export class TFile { static [Symbol.hasInstance](file) { return file?.isTestFile === true; } }
          export class TFolder {}
          export class MarkdownView {}
          export class Menu {}
          export class Notice {}
          export const parseYaml = globalThis.titleOwnershipYaml.parse;
          export const stringifyYaml = globalThis.titleOwnershipYaml.stringify;
          export const moment = globalThis.window.moment;
          export const normalizePath = value => String(value || '').replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/').replace(/^\\//, '');
        `,
      }));
    },
  }],
});
const { FileNamingService, FrontmatterMutationService } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function fixture(initial = '---\nkind: note\n---\nInitial body\n', basename = 'QA initial filename') {
  let content = initial;
  const file = { isTestFile: true, path: `Inbox/${basename}.md`, name: `${basename}.md`, basename, extension: 'md', parent: { path: 'Inbox' }, stat: { ctime: 0, mtime: 0 } };
  const stats = { cachedReads: 0, rawReads: 0, queues: 0, processes: 0, modifies: 0, renamed: 0, events: 0, indexed: 0 };
  let atQueue = null;
  let atProcess = null;
  const frontmatter = () => parse(content.replace(/^\uFEFF/u, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)?.[1] || '') || {};
  const rename = (basename) => { file.basename = basename; file.name = `${basename}.md`; file.path = `Inbox/${file.name}`; };
  const plugin = {
    manifest: { id: 'tps-global-context-menu' },
    settings: { autoSyncTitleFromFilename: true, enableAutoRename: true, enableActivityLog: false, frontmatterAutoWriteExclusions: '', folderExclusions: '', dailyNoteDateFormat: 'YYYY-MM-DD', properties: [] },
    registerEvent() {},
    shouldIgnoreAutoFrontmatterWrite: () => false,
    nativeRecordService: { isRecordFile: () => false, hasRecordIdentityEvidence: async () => false, hasRecordIdentityEvidenceInFrontmatter: fm => Object.hasOwn(fm, 'tpsId') },
    bulkEditService: {
      shouldSkipNoteLevelRecurrence: async () => false,
      canMutateFrontmatterSafely: async () => true,
      async runSerializedFrontmatterWrite(_file, action) {
        stats.queues++;
        await atQueue?.();
        return action();
      },
    },
    eventService: { emitFilesUpdated() { stats.events++; }, emitExplicitAction() {} },
    entityIndexService: { upsertFile() { stats.indexed++; } },
    app: {
      internalPlugins: { getPluginById: () => null, plugins: {} },
      plugins: { getPlugin: () => null, plugins: {} },
      vault: {
        configDir: '.obsidian',
        adapter: { async read() { throw Error('No Daily Notes configuration in fixture'); } },
        getFiles: () => [file], getMarkdownFiles: () => [file],
        getAbstractFileByPath: path => path === file.path ? file : null,
        getFileByPath: path => path === file.path ? file : null,
        cachedRead: async () => { stats.cachedReads++; return content; },
        read: async () => { stats.rawReads++; return content; },
        modify: async (_file, next) => { stats.modifies++; content = next; },
        process: async (_file, update) => {
          stats.processes++;
          await atProcess?.();
          const next = update(content);
          if (next !== content) stats.modifies++;
          content = next;
          return content;
        },
        on: () => ({}),
      },
      metadataCache: { initialized: true, getFileCache: () => ({ frontmatter: frontmatter() }), on: () => ({}) },
      workspace: { getActiveFile: () => null, getLeavesOfType: () => [] },
      fileManager: { renameFile: async (_file, path) => { stats.renamed++; rename(path.split('/').at(-1).slice(0, -3)); } },
    },
  };
  plugin.frontmatterMutationService = new FrontmatterMutationService(plugin);
  const service = plugin.fileNamingService = new FileNamingService(plugin);
  return {
    file, plugin, service, stats, frontmatter, rename,
    source: () => content,
    setSource: next => { content = next; },
    beforeWrite: callback => { atQueue = callback; },
    beforeProcess: callback => { atProcess = callback; },
    async sync(options = {}) {
      await service.whenDailyNoteConfigurationReady();
      await service.syncTitleFromFilename(file, { force: true, onlyIfMissing: true, onlyIfHasFrontmatter: true, bypassCreationGrace: true, ...options });
    },
  };
}

for (const initialTitle of [null, 'Untitled', '{{title}}']) {
  test(`delayed missing-title initialization preserves an authored title after ${initialTitle ?? 'no title'}`, async () => {
    const f = fixture(`---\nkind: note\n${initialTitle === null ? '' : `title: "${initialTitle}"\n`}---\nInitial body\n`);
    const authored = '---\ntitle: User-authored title\nkind: note\n---\nNew body marker\n';
    f.beforeWrite(() => f.setSource(authored));
    await f.sync();
    assert.equal(f.frontmatter().title, 'User-authored title');
    assert.equal(f.source(), authored, 'rejected automatic work leaves all current source bytes alone');
    assert.equal(f.stats.modifies, 0);
    assert.equal(f.stats.events, 0);
    assert.equal(f.stats.indexed, 0);
  });
}

for (const titles of ['title: Untitled\nTitle: User-authored title', 'Title: User-authored title\ntitle: Untitled']) {
  test(`current case-variant titles remain untouched: ${titles.split('\n')[0]}`, async () => {
    const f = fixture();
    const authored = `---\n${titles}\nkind: note\n---\nUser body\n`;
    f.beforeWrite(() => f.setSource(authored));
    await f.sync();
    assert.equal(f.source(), authored);
    assert.equal(f.stats.modifies, 0);
  });
}

test('a newer canonical title and filename survive the queued old filename candidate', async () => {
  const f = fixture();
  const authored = '---\ntitle: User-authored title\nkind: note\n---\nUser body\n';
  f.beforeWrite(() => { f.setSource(authored); f.rename('User-authored title'); });
  await f.sync();
  assert.equal(f.source(), authored);
  assert.equal(f.file.basename, 'User-authored title');
  assert.equal(f.stats.modifies, 0);
  assert.equal(f.stats.renamed, 0);
});

test('renaming while a filename-derived candidate waits does not persist the old basename', async () => {
  const f = fixture();
  const original = f.source();
  f.beforeWrite(() => f.rename('New filename'));
  await f.sync();
  assert.equal(f.source(), original);
  assert.equal(f.stats.modifies, 0);
});

test('unchanged authored titles reject repeated creation work before raw reads and the write queue', async () => {
  const f = fixture('---\ntitle: User-authored title\n---\nUser body\n');
  for (let i = 0; i < 20; i++) await f.sync();
  assert.equal(f.stats.queues, 0);
  assert.equal(f.stats.rawReads, 0);
  assert.equal(f.stats.modifies, 0);
});

for (const title of [null, 'Untitled', '{{title}}']) {
  test(`a still-eligible ${title ?? 'missing'} title is initialized once through the real writer`, async () => {
    const f = fixture(`---\nkind: note\n${title === null ? '' : `title: "${title}"\n`}---\nKeep body\n`);
    await f.sync();
    assert.equal(f.frontmatter().title, f.file.basename);
    assert.ok(f.source().endsWith('Keep body\n'));
    assert.equal(f.stats.modifies, 1);
    assert.equal(f.stats.events, 1);
    const rawReads = f.stats.rawReads;
    for (let i = 0; i < 10; i++) await f.sync();
    assert.equal(f.stats.modifies, 1);
    assert.equal(f.stats.rawReads, rawReads);
  });
}

test('template-derived synchronization preserves a title authored while it waits', async () => {
  const f = fixture('---\ntitle: Untitled\n---\nOriginal body\n');
  const authored = '---\ntitle: User-authored title\n---\nUser body\n';
  f.beforeWrite(() => f.setSource(authored));
  await f.sync({ onlyIfMissing: false, onlyIfTemplateDerived: true });
  assert.equal(f.source(), authored);
  assert.equal(f.stats.modifies, 0);
});

test('the existing scheduled-date exception still normalizes a template-derived title', async () => {
  const f = fixture('---\ntitle: Planning 2026-09-28\nscheduled: 2026-09-28\n---\nKeep body\n', 'Planning 2026-09-28');
  await f.sync({ onlyIfMissing: false, onlyIfTemplateDerived: true });
  assert.equal(f.frontmatter().title, 'Planning');
  assert.equal(f.stats.modifies, 1);
  assert.ok(f.source().endsWith('Keep body\n'));
});

test('a scheduled-marker exception cannot overwrite an unmarked authored title arriving in the queue', async () => {
  const f = fixture('---\ntitle: Planning 2026-09-28\nscheduled: 2026-09-28\n---\nOriginal body\n', 'Planning 2026-09-28');
  const authored = '---\ntitle: User-authored title\nscheduled: 2026-09-28\n---\nUser body\n';
  f.beforeWrite(() => f.setSource(authored));
  await f.sync({ onlyIfMissing: false, onlyIfTemplateDerived: true });
  assert.equal(f.source(), authored);
  assert.equal(f.stats.modifies, 0);
});

test('ordinary explicit filename synchronization retains its title and alias behavior', async () => {
  const f = fixture('---\ntitle: Previous authored name\n---\nKeep body\n');
  await f.sync({ onlyIfMissing: false });
  assert.equal(f.frontmatter().title, f.file.basename);
  assert.deepEqual(f.frontmatter().aliases, ['Previous authored name']);
  assert.equal(f.stats.modifies, 1);
});

test('current-source rejection preserves comments, quotes, BOM and CRLF without normalization', async () => {
  const source = '\uFEFF---\r\n# Authored comment\r\nTitle: "User title"\r\nkind: note\r\n---\r\nUser body\r\n';
  const f = fixture(source);
  f.setSource('---\nkind: note\n---\nInitial body\n');
  f.beforeProcess(() => f.setSource(source));
  await f.sync();
  assert.equal(f.source(), source);
  assert.equal(f.stats.modifies, 0);
  assert.equal(f.stats.events, 0);
});


test('current source reaching the atomic writer wins even after the outer write queue has started', async () => {
  const f = fixture();
  const current = '---\ntitle: User-authored title\n---\nNewest body at process\n';
  f.beforeProcess(() => f.setSource(current));
  await f.sync();
  assert.equal(f.source(), current);
  assert.equal(f.stats.processes, 1);
  assert.equal(f.stats.modifies, 0);
  assert.equal(f.stats.events, 0);
});

test('valid title changes preserve unrelated source bytes and existing aliases', async () => {
  const f = fixture('\uFEFF---\r\n# Authored ordering\r\naliases: [Existing alias]\r\nTitle: "Previous title"\r\nstatus: "Keep quoted"\r\n---\r\nUser body\r\n');
  await f.sync({ onlyIfMissing: false });
  assert.equal(f.frontmatter().Title, 'QA initial filename');
  assert.deepEqual(f.frontmatter().aliases, ['Existing alias', 'Previous title']);
  assert.ok(f.source().startsWith('\uFEFF---\r\n# Authored ordering\r\n'));
  assert.ok(f.source().endsWith('status: "Keep quoted"\r\n---\r\nUser body\r\n'));
  assert.equal(f.stats.modifies, 1);
});

test('ambiguous title case variants are left unchanged by explicit filename synchronization', async () => {
  const source = '---\ntitle: First title\nTitle: Second title\n---\nBody\n';
  const f = fixture(source);
  await f.sync({ onlyIfMissing: false });
  assert.equal(f.source(), source);
  assert.equal(f.stats.modifies, 0);
});


for (const marker of ['tpsId: native-record', 'kind: workout-session', 'tags: [template]']) {
  test(`new source ownership/exclusion at the atomic boundary blocks title initialization: ${marker}`, async () => {
    const f = fixture();
    f.plugin.settings.frontmatterAutoWriteExclusions = 'tag:template';
    const source = `---\n${marker}\n---\nLatest body\n`;
    f.beforeProcess(() => f.setSource(source));
    await f.sync();
    assert.equal(f.source(), source);
    assert.equal(f.stats.modifies, 0);
    assert.equal(f.stats.events, 0);
  });
}

const syncRename = (f, previousPath = 'Inbox/Previous name.md') => f.service.syncTitleFromFilename(f.file, {
  bypassCreationGrace: true,
  renamedFromPath: previousPath,
});

test('explicit rename synchronizes an authored title once, preserving the body and alias', async () => {
  const f = fixture('---\ntitle: Previous name\n---\nKeep body\n', 'New name');
  await syncRename(f);
  assert.equal(f.frontmatter().title, 'New name');
  assert.deepEqual(f.frontmatter().aliases, ['Previous name']);
  assert.ok(f.source().endsWith('Keep body\n'));
  assert.equal(f.stats.modifies, 1);
  const raw = f.stats.rawReads;
  for (let i = 0; i < 100; i++) await syncRename(f);
  assert.equal(f.stats.modifies, 1);
  assert.equal(f.stats.queues, 1);
  assert.equal(f.stats.rawReads, raw);
});

test('moving a file without changing its name does not read or rewrite its authored title', async () => {
  const f = fixture('---\ntitle: Authored display title\n---\nKeep body\n', 'Filename');
  for (let i = 0; i < 100; i++) await syncRename(f, 'Other/Folder/Filename.md');
  assert.equal(f.frontmatter().title, 'Authored display title');
  assert.equal(f.stats.cachedReads, 0);
  assert.equal(f.stats.rawReads, 0);
  assert.equal(f.stats.queues, 0);
});

for (const [title, basename, scheduled] of [
  ['Question: why?', 'Question why', ''],
  ['Planning', '2026-09-28 Planning', '2026-09-28'],
]) {
  test(`title-owned filename synchronization preserves ${title}`, async () => {
    const f = fixture(`---\ntitle: "${title}"\n${scheduled ? `scheduled: ${scheduled}\n` : ''}---\nKeep body\n`, basename);
    // Use the configured filename formatter, including platform sanitization/date format.
    f.rename(f.service.buildExpectedBasename(title, scheduled));
    await syncRename(f);
    assert.equal(f.frontmatter().title, title);
    assert.equal(f.stats.queues, 0);
    assert.equal(f.stats.rawReads, 0);
    assert.equal(f.stats.modifies, 0);
  });
}

for (const boundary of ['beforeWrite', 'beforeProcess']) {
  test(`an explicit rename does not overwrite a newer title at ${boundary}`, async () => {
    const f = fixture('---\ntitle: Previous name\n---\nKeep body\n', 'New name');
    const source = '---\ntitle: Newer authored title\n---\nNewer body\n';
    f[boundary](() => f.setSource(source));
    await syncRename(f);
    assert.equal(f.source(), source);
    assert.equal(f.stats.modifies, 0);
  });
}

test('rename title synchronization respects the disabled setting without reads or writes', async () => {
  const f = fixture('---\ntitle: Previous name\n---\nKeep body\n', 'New name');
  f.plugin.settings.autoSyncTitleFromFilename = false;
  await syncRename(f);
  assert.equal(f.frontmatter().title, 'Previous name');
  assert.equal(f.stats.cachedReads, 0);
  assert.equal(f.stats.queues, 0);
});

test('disabling title synchronization while a rename waits prevents the write', async () => {
  const f = fixture('---\ntitle: Previous name\n---\nKeep body\n', 'New name');
  f.beforeProcess(() => { f.plugin.settings.autoSyncTitleFromFilename = false; });
  await syncRename(f);
  assert.equal(f.frontmatter().title, 'Previous name');
  assert.equal(f.stats.modifies, 0);
});

for (const marker of ['tpsId: native-record', 'kind: workout-session', 'tags: [template]']) {
  test(`explicit rename retains new atomic ownership/exclusion: ${marker}`, async () => {
    const f = fixture('---\ntitle: Previous name\n---\nKeep body\n', 'New name');
    f.plugin.settings.frontmatterAutoWriteExclusions = 'tag:template';
    const source = `---\ntitle: Previous name\n${marker}\n---\nConcurrent body\n`;
    f.beforeProcess(() => f.setSource(source));
    await syncRename(f);
    assert.equal(f.source(), source);
    assert.equal(f.stats.modifies, 0);
  });
}

test('a newer filename supersedes an earlier rename queued for title synchronization', async () => {
  const f = fixture('---\ntitle: Previous name\n---\nKeep body\n', 'First rename');
  f.beforeWrite(() => { f.beforeWrite(null); f.rename('Latest rename'); });
  await syncRename(f);
  assert.equal(f.stats.modifies, 0);
  await syncRename(f, 'Inbox/First rename.md');
  assert.equal(f.frontmatter().title, 'Latest rename');
  assert.equal(f.stats.modifies, 1);
});

test('native records skip filename-to-title work before source reads', async () => {
  const f = fixture('---\ntitle: Native title\ntpsId: stable-id\nkind: task\n---\nKeep body\n', 'New name');
  f.plugin.nativeRecordService.isRecordFile = () => true;
  await syncRename(f);
  assert.equal(f.frontmatter().title, 'Native title');
  assert.equal(f.stats.rawReads, 0);
  assert.equal(f.stats.cachedReads, 0);
  assert.equal(f.stats.queues, 0);
});
