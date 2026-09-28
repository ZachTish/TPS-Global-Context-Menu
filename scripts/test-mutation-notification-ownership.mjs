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
      "export { BulkEditService } from './src/services/bulk-edit-service.ts';",
      "export { NoteTitleRenderService } from './src/services/note-title-render-service.ts';",
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
      builder.onResolve({ filter: /(?:text-input-modal|checklist-handler|parent-link-handler)$/u }, args => ({ path: args.path.split('/').at(-1), namespace: 'mutation-ui' }));
      builder.onLoad({ filter: /.*/, namespace: 'mutation-ui' }, args => ({ loader: 'js', contents: args.path === 'text-input-modal'
        ? `export class TextInputModal { constructor(_app, _label, _value, submit) { globalThis.mutationTitleSubmit = submit; } open() {} }`
        : `export class ChecklistHandler {} export class ParentLinkHandler {}` }));
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
const { FileNamingService, FrontmatterMutationService, BulkEditService, NoteTitleRenderService } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function fixture(t, { title = 'Before', autoRename = true, extension = 'md' } = {}) {
  // Expected write failures are asserted below; suppress their bundled data-URL stacks.
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  const files = [];
  const sources = new Map();
  const events = [], explicit = [], order = [], delayedRefreshes = [], localRefreshes = [], timers = [];
  const stats = { modifies: 0, renames: 0, namingChecks: 0, indexed: 0 };
  const add = (name = title, ext = extension) => {
    const file = { isTestFile: true, path: `Inbox/${name}.${ext}`, name: `${name}.${ext}`, basename: name, extension: ext, parent: { path: 'Inbox' }, stat: { ctime: 0, mtime: 0 } };
    files.push(file);
    sources.set(file, `---\ntitle: ${name}\n---\nKeep body marker\n`);
    return file;
  };
  const file = add();
  const frontmatter = target => parse(sources.get(target)?.match(/^---\n([\s\S]*?)\n---(?:\n|$)/u)?.[1] || '') || {};
  const originalTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 350) { timers.push(() => callback(...args)); return timers.length; }
    return originalTimeout(callback, delay, ...args);
  });
  const plugin = {
    manifest: { id: 'tps-global-context-menu' },
    settings: { autoSyncTitleFromFilename: true, enableAutoRename: autoRename, enableActivityLog: false, frontmatterAutoWriteExclusions: '', folderExclusions: '', dailyNoteDateFormat: 'YYYY-MM-DD', properties: [] },
    registerEvent() {}, shouldIgnoreAutoFrontmatterWrite: () => false,
    nativeRecordService: { isRecordFile: () => false, hasRecordIdentityEvidence: async () => false, hasRecordIdentityEvidenceInFrontmatter: () => false },
    eventService: {
      emitFilesUpdated(paths, cause) { events.push({ paths: [...paths], cause }); order.push('files-updated'); },
      emitExplicitAction(paths, cause) { explicit.push({ paths: [...paths], cause }); order.push('explicit-action'); },
    },
    entityIndexService: { upsertFile() { stats.indexed++; order.push('index'); } },
    persistentMenuManager: { refreshMenusForFile(file) { delayedRefreshes.push(file.path); } },
    overlayRenderingService: { scheduleFileRefresh(file, reason, options) { localRefreshes.push({ path: file.path, reason, options }); } },
    app: {
      internalPlugins: { getPluginById: () => null, plugins: {} }, plugins: { getPlugin: () => null, plugins: {} },
      vault: {
        configDir: '.obsidian', adapter: { async read() { throw Error('No Daily Notes configuration in fixture'); } },
        getFiles: () => files, getMarkdownFiles: () => files.filter(file => file.extension === 'md'),
        getAbstractFileByPath: path => files.find(file => file.path === path) || null,
        getFileByPath: path => files.find(file => file.path === path) || null,
        cachedRead: async file => sources.get(file), read: async file => sources.get(file),
        modify: async (file, next) => { stats.modifies++; sources.set(file, next); order.push('write'); }, on: () => ({}),
      },
      metadataCache: { initialized: true, getFileCache: file => ({ frontmatter: frontmatter(file) }), on: () => ({}) },
      workspace: { getActiveFile: () => null, getLeavesOfType: () => [] },
      fileManager: { renameFile: async (file, path) => { stats.renames++; file.path = path; file.name = path.split('/').at(-1); file.basename = file.name.slice(0, -3); order.push('rename'); } },
    },
  };
  plugin.frontmatterMutationService = new FrontmatterMutationService(plugin);
  plugin.bulkEditService = new BulkEditService(plugin);
  plugin.fileNamingService = new FileNamingService(plugin);
  const naming = plugin.fileNamingService.updateFilenameIfNeeded.bind(plugin.fileNamingService);
  plugin.fileNamingService.updateFilenameIfNeeded = async (...args) => { stats.namingChecks++; return naming(...args); };
  plugin.noteTitleRenderService = new NoteTitleRenderService(plugin);
  return {
    file, files, sources, add, plugin, stats, events, explicit, order, timers, delayedRefreshes, localRefreshes,
    async prompt(value) { await plugin.noteTitleRenderService.promptRenameTitle(file); await globalThis.mutationTitleSubmit(value); },
    flush() { while (timers.length) timers.shift()(); },
  };
}

test('real title prompt composes writer, filename and bulk ownership into one final-path notification', async t => {
  const f = fixture(t);
  await f.prompt('After');
  assert.equal(f.stats.modifies, 1);
  assert.equal(f.stats.renames, 1);
  assert.equal(f.stats.namingChecks, 1);
  assert.equal(f.events.length, 1, 'one mutation owner, no bulk/prompt re-announcements');
  assert.deepEqual(f.events[0], { paths: ['Inbox/After.md'], cause: { sourcePluginId: 'tps-global-context-menu' } });
  assert.deepEqual(f.explicit, [{ paths: ['Inbox/After.md'], cause: { sourcePluginId: 'tps-global-context-menu', source: 'frontmatter' } }]);
  assert.deepEqual(f.order, ['write', 'index', 'rename', 'files-updated', 'explicit-action']);
  assert.ok(f.sources.get(f.file).endsWith('Keep body marker\n'));
  assert.deepEqual(f.localRefreshes, [{ path: 'Inbox/After.md', reason: 'title-rename', options: { force: true, delayMs: 0 } }]);
  f.flush();
  assert.deepEqual(f.delayedRefreshes, [], 'Markdown refresh is owned by existing event consumers');
});

test('shared bulk title route completes once with auto rename disabled', async t => {
  const f = fixture(t, { autoRename: false });
  assert.equal(await f.plugin.bulkEditService.updateFrontmatter([f.file], { title: 'After' }), 1);
  assert.equal(f.stats.modifies, 1);
  assert.equal(f.stats.namingChecks, 0);
  assert.deepEqual(f.events.map(event => event.paths), [['Inbox/Before.md']]);
  assert.deepEqual(f.explicit.map(event => event.paths), [['Inbox/Before.md']]);
  f.flush();
  assert.deepEqual(f.delayedRefreshes, []);
});

test('non-title bulk burst announces only successful writes, once per changed file', async t => {
  const f = fixture(t);
  for (let i = 1; i < 20; i++) f.add(`Before ${i}`);
  const rejected = f.files.at(-1);
  const modify = f.plugin.app.vault.modify;
  f.plugin.app.vault.modify = async (file, next) => { if (file === rejected) throw Error('Expected write rejection'); return modify(file, next); };
  assert.equal(await f.plugin.bulkEditService.updateFrontmatter(f.files, { project: 'Example' }), 19);
  assert.equal(f.stats.modifies, 19);
  assert.equal(f.stats.namingChecks, 0);
  assert.equal(f.events.length, 19);
  assert.equal(f.explicit.length, 19);
  assert.deepEqual(f.events.map(event => event.paths[0]).sort(), f.files.slice(0, -1).map(file => file.path).sort());
  assert.ok(f.events.every(event => event.paths.length === 1));
  const count = f.events.length;
  assert.equal(await f.plugin.bulkEditService.updateFrontmatter(f.files.slice(0, -1), { project: 'Example' }), 0);
  assert.equal(f.events.length, count, 'unchanged repeat has no notifications');
  f.flush();
  assert.deepEqual(f.delayedRefreshes, []);
});

for (const afterRename of [false, true]) {
  test(`committed title write still announces the actual path when filename operation rejects ${afterRename ? 'after' : 'before'} rename`, async t => {
    const f = fixture(t);
    f.plugin.fileNamingService.updateFilenameIfNeeded = async file => {
      if (afterRename) await f.plugin.app.fileManager.renameFile(file, 'Inbox/After.md');
      throw Error('Expected rename rejection');
    };
    await assert.rejects(f.plugin.frontmatterMutationService.process(f.file, fm => { fm.title = 'After'; }), /Expected rename rejection/u);
    assert.equal(f.stats.modifies, 1);
    assert.deepEqual(f.events.map(event => event.paths), [[f.file.path]]);
    assert.deepEqual(f.explicit.map(event => event.paths), [[f.file.path]]);
    assert.equal(f.order.at(-2), 'files-updated');
    assert.equal(f.order.at(-1), 'explicit-action');
    assert.equal(parse(f.sources.get(f.file).split('---')[1]).title, 'After');
  });
}

test('automation preserves source attribution without becoming an explicit user action', async t => {
  const f = fixture(t);
  assert.equal(await f.plugin.frontmatterMutationService.process(f.file, fm => { fm.project = 'Example'; }, { kind: 'automation', sourcePluginId: 'test-automation', surface: 'automatic-rule' }), true);
  assert.deepEqual(f.events, [{ paths: [f.file.path], cause: { sourcePluginId: 'test-automation' } }]);
  assert.deepEqual(f.explicit, []);
});

test('explicit caller surface survives the shared mutation owner', async t => {
  const f = fixture(t);
  await f.plugin.frontmatterMutationService.process(f.file, fm => { fm.title = 'After'; }, { kind: 'user', sourcePluginId: 'test-caller', surface: 'test-property' });
  assert.deepEqual(f.explicit, [{ paths: ['Inbox/After.md'], cause: { sourcePluginId: 'test-caller', source: 'test-property' } }]);
});

test('unchanged and rejected title saves have no events, filename checks or prompt refreshes', async t => {
  const f = fixture(t);
  await f.prompt('Before');
  assert.equal(f.stats.modifies, 0);
  f.plugin.app.vault.modify = async () => { throw Error('Expected write rejection'); };
  await f.prompt('After');
  assert.equal(f.stats.namingChecks, 0);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.explicit, []);
  assert.deepEqual(f.localRefreshes, []);
  f.flush();
  assert.deepEqual(f.delayedRefreshes, []);
});

test('delegated attachment mutation retains its source/companion event and local refresh without bulk duplication', async t => {
  const f = fixture(t, { extension: 'pdf' });
  const companion = '.tps-file-properties/Before.md';
  let attached = {};
  f.plugin.filePropertiesService = {
    isCompanionFile: () => false,
    isPropertyTarget: file => file.extension === 'pdf',
    async process(file, mutate, cause) {
      const next = { ...attached }; await mutate(next);
      if (JSON.stringify(next) === JSON.stringify(attached)) return false;
      attached = next;
      f.plugin.eventService.emitFilesUpdated([file.path, companion], { sourcePluginId: 'tps-global-context-menu' });
      if (cause.kind !== 'automation') f.plugin.eventService.emitExplicitAction([file.path], { sourcePluginId: 'tps-global-context-menu', source: 'file-properties' });
      return true;
    },
  };
  assert.equal(await f.plugin.bulkEditService.updateFrontmatter([f.file], { project: 'Example' }), 1);
  assert.deepEqual(f.events.map(event => event.paths), [[f.file.path, companion]]);
  assert.equal(f.explicit.length, 1);
  assert.equal(f.stats.namingChecks, 0);
  f.flush();
  assert.deepEqual(f.delayedRefreshes, [f.file.path]);
  assert.equal(await f.plugin.bulkEditService.updateFrontmatter([f.file], { project: 'Example' }), 0);
  f.flush();
  assert.equal(f.events.length, 1);
  assert.deepEqual(f.delayedRefreshes, [f.file.path]);
});

for (const title of ['After', 'Question: why?']) {
  test(`a title-owned rename event does not start a second write: ${title}`, async t => {
    const f = fixture(t);
    const rename = f.plugin.app.fileManager.renameFile;
    const renameWork = [];
    f.plugin.app.fileManager.renameFile = async (file, path) => {
      const previousPath = file.path;
      await rename(file, path);
      renameWork.push(f.plugin.fileNamingService.syncTitleFromFilename(file, {
        bypassCreationGrace: true, renamedFromPath: previousPath,
      }));
    };
    await f.prompt(title);
    await Promise.all(renameWork);
    assert.equal(parse(f.sources.get(f.file).split('---')[1]).title, title);
    assert.equal(f.stats.modifies, 1);
    assert.equal(f.stats.renames, 1);
    assert.equal(f.events.length, 1);
    assert.equal(f.explicit.length, 1);
    assert.ok(f.sources.get(f.file).endsWith('Keep body marker\n'));
  });
}

test('title-driven filename completion restores authored text after core overwrites the view title', async t => {
  const f = fixture(t);
  const view = { file: f.file, title: 'Before' };
  const other = { file: f.add('Unrelated'), title: 'Unrelated' };
  const renders = [];
  f.plugin.app.workspace.getLeavesOfType = () => [{ view }, { view: other }];
  f.plugin.noteTitleRenderService.refreshInlineTitleForView = target => {
    renders.push(target);
    target.title = parse(f.sources.get(target.file).split('---')[1]).title;
  };
  const rename = f.plugin.app.fileManager.renameFile;
  f.plugin.app.fileManager.renameFile = async (file, path) => {
    // Metadata for the authored title can arrive before core's rename finishes.
    f.plugin.noteTitleRenderService.handleMetadataChanged(file);
    await rename(file, path);
    view.title = file.basename;
  };
  await f.prompt('Question: why?');
  assert.equal(f.file.basename, 'Question why');
  assert.equal(view.title, 'Question: why?');
  assert.equal(other.title, 'Unrelated');
  assert.deepEqual(renders, [view, view]);
  assert.equal(f.stats.modifies, 1);
  assert.equal(f.stats.renames, 1);
  for (let i = 0; i < 100; i++) await f.plugin.fileNamingService.updateFilenameIfNeeded(f.file);
  assert.deepEqual(renders, [view, view], 'unchanged filenames do not add title renders');
});
