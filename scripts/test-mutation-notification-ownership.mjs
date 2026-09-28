import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { parse, stringify } from 'yaml';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Commands has a nested state dependency in this lockfile. Use its own module
// instance so history annotations/fields belong to the same CodeMirror runtime.
const require = createRequire(import.meta.url);
const { historyField, undo } = require('@codemirror/commands');
const { EditorState, Transaction } = createRequire(require.resolve('@codemirror/commands'))('@codemirror/state');

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
      "export { MenuBuilder } from './src/menu/menu-builder.ts';",
      "export { wasChecklistCompletionPromptRecentlyHandled } from './src/handlers/checklist-handler.ts';",
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
      const contextUiStubs = new Map([
        ['../modals/FileSuggestModal', 'export class FileSuggestModal {}'],
        ['../modals/MultiFileSelectModal', 'export class MultiFileSelectModal {}'],
        ['../modals/file-properties-relink-modal', 'export const promptFilePropertiesRelink = () => {};'],
        ['../services/subitem-creation-service', 'export const promptAndCreateSubitemForParent = () => {};'],
        ['../modals/checklist-prompt-modal', `export class ChecklistPromptModal {
          constructor(_app, items, submit) { this.items = items; this.submit = submit; }
          open() { const prompt = globalThis.checklistOwnershipPrompt; prompt.calls.push([...this.items]); prompt.beforeAnswer?.(); this.submit(prompt.action); }
        }`],
      ]);
      builder.onResolve({ filter: /.*/u }, args => contextUiStubs.has(args.path) ? { path: args.path, namespace: 'context-ui' } : null);
      builder.onLoad({ filter: /.*/, namespace: 'context-ui' }, args => ({ loader: 'js', contents: contextUiStubs.get(args.path) }));
      builder.onResolve({ filter: /(?:text-input-modal|parent-link-handler)$/u }, args => ({ path: args.path.split('/').at(-1), namespace: 'mutation-ui' }));
      builder.onLoad({ filter: /.*/, namespace: 'mutation-ui' }, args => ({ loader: 'js', contents: args.path === 'text-input-modal'
        ? `export class TextInputModal { constructor(_app, _label, _value, submit) { globalThis.mutationTitleSubmit = submit; } open() {} }`
        : `export class ParentLinkHandler {}` }));
      builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'title-ownership' }));
      builder.onLoad({ filter: /.*/, namespace: 'title-ownership' }, () => ({
        loader: 'js',
        contents: `
          export class TFile { static [Symbol.hasInstance](file) { return file?.isTestFile === true; } }
          export class TFolder {}
          export class MarkdownView { static [Symbol.hasInstance](view) { return view?.isTestMarkdownView === true; } }
          export class Menu {}
          export class MenuItem {}
          export class App {}
          export class FuzzySuggestModal {}
          export const getAllTags = () => [];
          export class Notice { constructor(message) { globalThis.titleOwnershipNotices?.push(String(message)); } }
          export const parseYaml = globalThis.titleOwnershipYaml.parse;
          export const stringifyYaml = globalThis.titleOwnershipYaml.stringify;
          export const moment = globalThis.window.moment;
          export const normalizePath = value => String(value || '').replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/').replace(/^\\//, '');
        `,
      }));
    },
  }],
});
const { FileNamingService, FrontmatterMutationService, BulkEditService, NoteTitleRenderService, MenuBuilder, wasChecklistCompletionPromptRecentlyHandled } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function fixture(t, { title = 'Before', autoRename = true, extension = 'md' } = {}) {
  // Expected write failures are asserted below; suppress their bundled data-URL stacks.
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  const files = [];
  const sources = new Map();
  const events = [], explicit = [], order = [], delayedRefreshes = [], localRefreshes = [], timers = [];
  const notices = [];
  globalThis.titleOwnershipNotices = notices;
  t.after(() => { delete globalThis.titleOwnershipNotices; });
  const stats = { modifies: 0, renames: 0, namingChecks: 0, indexed: 0 };
  const add = (name = title, ext = extension) => {
    const file = { isTestFile: true, path: `Inbox/${name}.${ext}`, name: `${name}.${ext}`, basename: name, extension: ext, parent: { path: 'Inbox' }, stat: { ctime: 0, mtime: 0 } };
    files.push(file);
    sources.set(file, `---\ntitle: ${name}\n---\nKeep body marker\n`);
    return file;
  };
  const file = add();
  const frontmatter = target => parse(sources.get(target)?.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)/u)?.[1] || '') || {};
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
    file, files, sources, add, plugin, stats, events, explicit, order, timers, delayedRefreshes, localRefreshes, notices,
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

test('committed-rename display restores the authored title while incoming links are still updating', async t => {
  const f = fixture(t);
  const view = { file: f.file, title: 'Before' };
  const other = { file: f.add('Unrelated'), title: 'Unrelated' };
  const renders = [];
  f.plugin.app.workspace.getLeavesOfType = () => [{ view }, { view: other }];
  f.plugin.noteTitleRenderService.refreshInlineTitleForView = target => {
    renders.push(target);
    target.title = parse(f.sources.get(target.file).split('---')[1]).title;
  };
  let committed, finishLinks;
  const committedGate = new Promise(resolve => { committed = resolve; });
  const linksGate = new Promise(resolve => { finishLinks = resolve; });
  const rename = f.plugin.app.fileManager.renameFile;
  f.plugin.app.fileManager.renameFile = async (file, path) => {
    // Metadata for the authored title can arrive before core's rename finishes.
    f.plugin.noteTitleRenderService.handleMetadataChanged(file);
    await rename(file, path);
    view.title = file.basename;
    // Mock the committed core rename event. The actual register-events wiring
    // is covered separately by test-completed-date-event-batching.
    queueMicrotask(() => f.plugin.noteTitleRenderService.handleMetadataChanged(file));
    committed();
    await linksGate;
  };
  let saved = false;
  const save = f.prompt('Question: why?').then(() => { saved = true; });
  await committedGate;
  assert.equal(saved, false, 'link rewriting must still be pending');
  assert.equal(view.title, 'Question: why?');
  finishLinks();
  await save;
  assert.equal(f.file.basename, 'Question why');
  assert.equal(view.title, 'Question: why?');
  assert.equal(other.title, 'Unrelated');
  assert.deepEqual(renders, [view, view]);
  assert.equal(f.stats.modifies, 1);
  assert.equal(f.stats.renames, 1);
  for (let i = 0; i < 100; i++) await f.plugin.fileNamingService.updateFilenameIfNeeded(f.file);
  assert.deepEqual(renders, [view, view], 'unchanged filenames do not add title renders');
});


function contextHarness(f) {
  const rules = [];
  f.plugin.notebookNavigatorRuleService = {
    async applyRulesToFile(file, options) { rules.push({ file, options }); return false; },
  };
  const builder = new MenuBuilder(f.plugin, {});
  const entries = () => f.files.map(file => ({ file, frontmatter: {} }));
  return { builder, entries, rules };
}

test('context property burst announces each successful Markdown write once and keeps explicit rules', async t => {
  const f = fixture(t);
  for (let i = 1; i < 20; i++) f.add(`Context ${i}`);
  const rejected = f.files.at(-1);
  const modify = f.plugin.app.vault.modify;
  f.plugin.app.vault.modify = async (file, source) => {
    if (file === rejected) throw Error('Expected selected-file write failure');
    return modify(file, source);
  };
  const h = contextHarness(f);
  assert.equal(await h.builder.setContextPropertyValue(h.entries(), { key: 'priority' }, 'high', 'context-priority'), 19);
  assert.equal(f.stats.modifies, 19);
  assert.equal(f.events.length, 19, 'the menu must not announce the entire selection a second time');
  assert.deepEqual(f.events.flatMap(event => event.paths), f.files.slice(0, -1).map(file => file.path));
  assert.equal(f.explicit.length, 19);
  assert.equal(h.rules.length, 20, 'existing explicit rule selection remains unchanged');
  assert.ok(h.rules.every(({ options }) => options.force && options.bypassCreationGrace && options.reason === 'context-priority'));
  assert.deepEqual(f.delayedRefreshes, [], 'Markdown consumes writer/rule notifications, not a forced menu refresh');
  f.flush();
  assert.deepEqual(f.delayedRefreshes, []);
  for (const file of f.files) assert.ok(f.sources.get(file).endsWith('Keep body marker\n'));
});

test('unchanged context property bursts produce no mutation, notification, rule or forced render', async t => {
  const f = fixture(t);
  for (let i = 1; i < 20; i++) f.add(`No change ${i}`);
  const h = contextHarness(f);
  await h.builder.setContextPropertyValue(h.entries(), { key: 'priority' }, 'high', 'context-priority');
  f.events.length = f.explicit.length = f.delayedRefreshes.length = h.rules.length = 0;
  const writes = f.stats.modifies;
  for (let i = 0; i < 5; i++) assert.equal(await h.builder.setContextPropertyValue(h.entries(), { key: 'priority' }, 'high', 'context-priority'), 0);
  assert.equal(f.stats.modifies, writes);
  assert.equal(f.events.length + f.explicit.length + f.delayedRefreshes.length + h.rules.length, 0);
});

test('context property rule mutations retain their separate writer notification', async t => {
  const f = fixture(t);
  const h = contextHarness(f);
  f.plugin.notebookNavigatorRuleService.applyRulesToFile = async file => {
    await f.plugin.frontmatterMutationService.process(file, fm => { fm.icon = 'flag'; }, { kind: 'automation', surface: 'configured-rule' });
    return true;
  };
  assert.equal(await h.builder.setContextPropertyValue(h.entries(), { key: 'priority' }, 'high', 'context-priority'), 1);
  assert.equal(f.stats.modifies, 2);
  assert.equal(f.events.length, 2, 'one property write and one actual rule write, no final menu broadcast');
  assert.equal(f.explicit.length, 1, 'the automated rule is not a second user action');
  assert.match(f.sources.get(f.file), /icon: flag/);
  assert.deepEqual(f.delayedRefreshes, []);
});

test('attachment context edits retain the existing delegated event and delayed menu refresh', async t => {
  const f = fixture(t, { extension: 'pdf' });
  f.plugin.filePropertiesService = {
    isCompanionFile: () => false,
    isPropertyTarget: () => true,
    async process(file) {
      f.plugin.eventService.emitFilesUpdated([file.path, 'Companions/Attachment.md']);
      f.plugin.eventService.emitExplicitAction([file.path], { source: 'file-property' });
      return true;
    },
  };
  const h = contextHarness(f);
  assert.equal(await h.builder.setContextPropertyValue(h.entries(), { key: 'priority' }, 'high', 'context-priority'), 1);
  assert.deepEqual(f.events.map(event => event.paths), [[f.file.path, 'Companions/Attachment.md']]);
  assert.deepEqual(f.delayedRefreshes, [], 'do not precede the owning attachment refresh with another forced refresh');
  f.flush();
  assert.deepEqual(f.delayedRefreshes, [f.file.path]);
  assert.equal(h.rules.length, 1);
});

function completionHarness(t, { action = 'ignore', body = '- [ ] Keep incomplete item\n', key = 'status' } = {}) {
  const f = fixture(t, { autoRename: false });
  f.plugin.settings.checkOpenChecklistItems = true;
  f.plugin.sharedServices = { status: { getStatusPropertyKey: () => key } };
  f.sources.set(f.file, `---\ntitle: Before\n${key}: todo\n---\n${body}`);
  const initial = f.sources.get(f.file);
  const prompt = { action, calls: [] };
  globalThis.checklistOwnershipPrompt = prompt;
  t.after(() => { delete globalThis.checklistOwnershipPrompt; });
  const handler = f.plugin.bulkEditService.checklistHandler;
  const scans = t.mock.method(handler, 'scanChecklistItems');
  const handles = t.mock.method(handler, 'handleChecklistCompletion');
  t.mock.method(window, 'moment', value => value === undefined
    ? { format: () => '2026-09-28T12:00:00' } : momentForTest(value));
  return { ...f, initial, body, prompt, scans, handles, bulk: f.plugin.bulkEditService };
}

test('status completion checks once and accepts Ignore without a second prompt', async t => {
  const f = completionHarness(t);
  assert.equal(await f.bulk.setStatus([f.file], 'complete'), 1);
  assert.equal(f.handles.mock.callCount(), 1);
  assert.equal(f.scans.mock.callCount(), 1);
  assert.equal(f.prompt.calls.length, 1);
  assert.equal(f.stats.modifies, 1);
  assert.equal(f.events.length, 1);
  assert.match(f.sources.get(f.file), /status: complete/);
  assert.ok(f.sources.get(f.file).endsWith(f.body));
});

test('completion without open items scans once per action and unchanged bursts do not write', async t => {
  const f = completionHarness(t, { body: '- [x] Already completed item\n' });
  assert.equal(await f.bulk.setStatus([f.file], 'complete'), 1);
  for (let i = 0; i < 20; i++) assert.equal(await f.bulk.setStatus([f.file], 'complete'), 0);
  assert.equal(f.scans.mock.callCount(), 21, 'one configured check per explicit action');
  assert.equal(f.prompt.calls.length, 0);
  assert.equal(f.stats.modifies, 1);
  assert.equal(f.events.length, 1);
  assert.ok(f.sources.get(f.file).endsWith(f.body));
});

for (const action of ['cancel', 'open']) {
  test(`checklist ${action} aborts completion without changing the source`, async t => {
    const f = completionHarness(t, { action });
    const opened = [];
    f.plugin.app.workspace.getLeaf = () => ({ async openFile(file) { opened.push(file); } });
    assert.equal(await f.bulk.setStatus([f.file], 'complete'), 0);
    assert.equal(f.scans.mock.callCount(), 1);
    assert.equal(f.prompt.calls.length, 1);
    assert.equal(f.sources.get(f.file), f.initial);
    assert.equal(f.stats.modifies + f.events.length, 0);
    assert.deepEqual(opened, action === 'open' ? [f.file] : []);
  });
}

for (const [action, marker] of [['complete', 'x'], ['canceled', '-']]) {
  test(`checklist ${action} changes items and status without a redundant second scan`, async t => {
    const f = completionHarness(t, { action });
    assert.equal(await f.bulk.setStatus([f.file], 'complete'), 1);
    assert.equal(f.scans.mock.callCount(), 1);
    assert.equal(f.prompt.calls.length, 1);
    assert.equal(f.stats.modifies, 2, 'one checklist body write and one status write');
    assert.ok(f.sources.get(f.file).endsWith(`- [${marker}] Keep incomplete item\n`));
    assert.match(f.sources.get(f.file), /status: complete/);
  });
}

test('direct mapped-status frontmatter completion retains the same checklist gate', async t => {
  const f = completionHarness(t, { key: 'taskStatus' });
  assert.equal(await f.bulk.updateFrontmatter([f.file], { TASKSTATUS: 'complete' }), 1);
  assert.equal(f.scans.mock.callCount(), 1);
  assert.equal(f.prompt.calls.length, 1);
  assert.match(f.sources.get(f.file), /taskStatus: complete/i);
  assert.ok(f.sources.get(f.file).endsWith(f.body));
});

test('completion rechecks a write guard changed while the checklist prompt is open', async t => {
  const f = completionHarness(t, { action: 'complete' });
  let allowed = true;
  f.prompt.beforeAnswer = () => { allowed = false; };
  assert.equal(await f.bulk.setStatus([f.file], 'complete', { writeGuard: () => allowed }), 0);
  assert.equal(f.prompt.calls.length, 1);
  assert.equal(f.sources.get(f.file), f.initial);
  assert.equal(f.stats.modifies + f.events.length, 0);
});

test('parent cancellation still happens before the shared checklist owner', async t => {
  const f = completionHarness(t);
  f.plugin.settings.checkParentLinkStatuses = true;
  f.plugin.parentLinkResolutionService = { isRelationshipTarget: () => true };
  f.bulk.parentLinkHandler.isCompletionStatus = () => true;
  f.bulk.parentLinkHandler.handleParentLinkCompletion = async () => false;
  assert.equal(await f.bulk.setStatus([f.file], 'complete'), 0);
  assert.equal(f.scans.mock.callCount(), 0);
  assert.equal(f.sources.get(f.file), f.initial);
});

test('Ignore preserves a concurrent body edit made while the prompt is open', async t => {
  const f = completionHarness(t);
  f.prompt.beforeAnswer = () => { f.sources.set(f.file, f.sources.get(f.file) + 'Concurrent body edit\n'); };
  assert.equal(await f.bulk.setStatus([f.file], 'complete'), 1);
  assert.equal(f.prompt.calls.length, 1);
  assert.ok(f.sources.get(f.file).endsWith(f.body + 'Concurrent body edit\n'));
  assert.equal(f.stats.modifies, 1);
});

test('a slow checklist decision remains recognized by the external-status listener', async t => {
  const f = completionHarness(t);
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  f.prompt.beforeAnswer = () => { now += 10_000; };
  assert.equal(await f.bulk.setStatus([f.file], 'complete'), 1);
  assert.equal(f.prompt.calls.length, 1);
  assert.equal(wasChecklistCompletionPromptRecentlyHandled(f.file), true,
    'the existing external-status guard must see the completed decision, not an expired prompt-start timestamp');
  now += 4_001;
  assert.equal(wasChecklistCompletionPromptRecentlyHandled(f.file), false,
    'independent future external completions retain the existing expiration');
});

test('multi-file completion retains the existing no-prompt policy', async t => {
  const f = completionHarness(t);
  f.add('Second completion');
  assert.equal(await f.bulk.setStatus(f.files, 'complete'), 2);
  assert.equal(f.scans.mock.callCount(), 0);
  assert.equal(f.prompt.calls.length, 0);
  assert.equal(f.stats.modifies, 2);
});

test('disabled checklist checks and non-completion statuses do not scan', async t => {
  const f = completionHarness(t);
  await f.bulk.setStatus([f.file], 'working');
  f.plugin.settings.checkOpenChecklistItems = false;
  await f.bulk.setStatus([f.file], 'complete');
  assert.equal(f.scans.mock.callCount(), 0);
  assert.equal(f.prompt.calls.length, 0);
  assert.ok(f.sources.get(f.file).endsWith(f.body));
});


// A source buffer owns unsaved edits. The host save model deliberately mirrors
// TextFileView's in-flight behavior: a second save requests another pass but
// does not return the first pass's promise. Storage/events are the only mocked
// boundaries; selection mapping and undo use real CodeMirror state/history.
function openBufferFixture(t, { crlf = false, hiddenHeader = false } = {}) {
  const f = fixture(t);
  const initial = f.sources.get(f.file);
  f.sources.set(f.file, crlf ? initial.replace(/\n/g, '\r\n') : initial);
  // Only the history field is needed in this DOM-free host, not keyboard hooks.
  // Model the installed Live Preview boundary: hidden frontmatter rejects a
  // normal input transaction at a header selection. Programmatic set is allowed.
  // Actual Obsidian filter behavior is also exercised in the Test vault.
  const hiddenHeaderFilter = EditorState.transactionFilter.of(tr => {
    if (!hiddenHeader || tr.annotation(Transaction.userEvent) === 'set') return tr;
    const headerEnd = tr.startState.doc.toString().indexOf('\n---\n', 4) + 5;
    if (tr.docChanged && tr.newSelection.main.from < headerEnd) return [];
    return tr;
  });
  let state = EditorState.create({doc: initial + 'Pending body sentinel\n', selection: {anchor: hiddenHeader ? 0 : initial.length + 8}, extensions: [historyField, hiddenHeaderFilter]});
  const counts = {transactions: 0, nativeSaves: 0, wholeReplacements: 0, propertySynchronizations: 0};
  const listeners = new Map();
  f.plugin.app.vault.on = (name, callback) => { const ref = {name, callback}; listeners.set(ref, ref); return ref; };
  f.plugin.app.vault.offref = ref => listeners.delete(ref);
  const emit = name => { for (const ref of listeners.values()) if (ref.name === name) ref.callback(f.file); };
  const offset = position => state.doc.line(position.line + 1).from + position.ch;
  const position = offset => { const line = state.doc.lineAt(offset); return {line: line.number - 1, ch: offset - line.from}; };
  const editor = {
    getValue: () => state.doc.toString(),
    posToOffset: offset,
    offsetToPos: position,
    getCursor: () => position(state.selection.main.head),
    listSelections: () => state.selection.ranges.map(r => ({anchor: position(r.anchor), head: position(r.head)})),
    setValue() { counts.wholeReplacements++; throw Error('Do not replace an edited note wholesale'); },
    replaceRange(text, from, to = from, origin) { counts.transactions++; state = state.update({changes: {from: offset(from), to: offset(to), insert: text}, userEvent: origin}).state; view.requestSave(); },
    transaction(transaction, origin) {
      counts.transactions++;
      state = state.update({changes: (transaction.changes || []).map(c => ({from: offset(c.from), to: c.to ? offset(c.to) : offset(c.from), insert: c.text})), userEvent: origin}).state;
      view.requestSave();
    },
  };
  let nextSaveGate = null;
  const view = {
    isTestMarkdownView: true, file: f.file, editor, dirty: true, saving: false, saveAgain: false,
    data: editor.getValue(), lastSavedData: f.sources.get(f.file),
    getMode: () => 'source', getViewType: () => 'markdown', getViewData: () => editor.getValue(),
    setViewData(next, clear) {
      assert.equal(clear, false, 'never reset the editor state');
      // Public MarkdownView setter delegates to an incremental native `set`
      // transaction, then synchronizes Properties. The host boundary is mocked;
      // selection mapping and history below remain real CodeMirror behavior.
      const before = editor.getValue();
      let start = 0, oldEnd = before.length, newEnd = next.length;
      while (start < oldEnd && start < newEnd && before[start] === next[start]) start++;
      while (oldEnd > start && newEnd > start && before[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
      if (before !== next) editor.replaceRange(next.slice(start, newEnd), position(start), position(oldEnd), 'set');
      this.rawFrontmatter = editor.getValue().match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
      counts.propertySynchronizations++;
    },
    contentEl: { querySelector: () => null },
    requestSave() { this.dirty = true; this.data = editor.getValue(); },
    async save() {
      this.dirty = false;
      if (this.saving) { this.saveAgain = true; return; }
      this.saveAgain = false;
      const next = editor.getValue();
      if (next === this.lastSavedData) return;
      this.saving = true; this.lastSavedData = next;
      const gate = nextSaveGate; nextSaveGate = null;
      try {
        if (gate) await gate;
        counts.nativeSaves++; f.sources.set(f.file, next); emit('modify');
      } finally {
        this.saving = false;
        if (this.saveAgain) this.followupSave = this.save();
      }
    },
  };
  const leaf = {view};
  f.plugin.app.workspace.getLeavesOfType = type => type === 'markdown' ? [leaf] : [];
  f.plugin.app.workspace.activeLeaf = leaf;
  f.plugin.app.workspace.getActiveFile = () => view.file;
  return {
    ...f, view, editor, counts, listeners,
    saved: () => f.sources.get(f.file),
    append(text) { const end = state.doc.length; editor.replaceRange(text, position(end)); },
    holdNextSave(promise) { nextSaveGate = promise; },
    cursorTail: () => state.sliceDoc(state.selection.main.head),
    undo() { return undo({state, dispatch: transaction => { state = transaction.state; }}); },
  };
}

for (const crlf of [false, true]) {
  test(`a title write preserves a dirty ${crlf ? 'CRLF' : 'LF'} editor through the editor save owner`, async t => {
    const f = openBufferFixture(t, {crlf});
    const body = f.editor.getValue().split('---\n').slice(2).join('---\n');
    const cursorTail = f.cursorTail();
    assert.equal(await f.plugin.bulkEditService.updateFrontmatter([f.file], {title: 'After'}), 1);
    assert.ok(f.saved().endsWith(body), 'the pending body must reach storage with the new title');
    assert.equal(parse(f.saved().match(/^---\n([\s\S]*?)\n---/)[1]).title, 'After');
    assert.equal(f.editor.getValue(), f.saved(), 'buffer and persisted source agree at completion');
    assert.equal(f.cursorTail(), cursorTail, 'the body cursor stays on the same text');
    assert.equal(f.stats.modifies, 0, 'GCM must not submit an external full-file write to a dirty editor');
    assert.equal(f.counts.nativeSaves, 1);
    assert.equal(f.stats.renames, 1);
    assert.equal(f.events.length, 1);
    assert.equal(f.listeners.size, 0, 'any operation-local completion listeners are released');
    assert.equal(f.undo(), true, 'property edit is undoable');
    assert.ok(f.editor.getValue().endsWith(body), 'undoing the property edit retains the pre-existing body edit');
  });
}

test('unchanged property bursts do not save or disturb an existing dirty buffer', async t => {
  const f = openBufferFixture(t, {crlf: true});
  const reads = t.mock.method(f.plugin.app.vault, 'read');
  const draft = f.editor.getValue(), saved = f.saved(), cursorTail = f.cursorTail();
  for (let i = 0; i < 20; i++) assert.equal(await f.plugin.bulkEditService.updateFrontmatter([f.file], {title: 'Before'}), 0);
  assert.equal(f.editor.getValue(), draft); assert.equal(f.saved(), saved); assert.equal(f.cursorTail(), cursorTail);
  assert.equal(f.counts.nativeSaves, 0); assert.equal(f.counts.transactions, 0); assert.equal(f.stats.modifies, 0);
  assert.equal(reads.mock.callCount(), 0, 'unchanged open-note actions do not read disk');
  assert.equal(f.view.dirty, true);
});

test('body input arriving during an async property mutation is retained', async t => {
  const f = openBufferFixture(t);
  let release, entered;
  const gate = new Promise(r => { release = r; }), begun = new Promise(r => { entered = r; });
  const writing = f.plugin.frontmatterMutationService.process(f.file, async fm => { entered(); await gate; fm.title = 'After'; });
  await begun; f.append('Body typed while mutation awaited\n'); const expectedBody = f.editor.getValue().split('---\n').slice(2).join('---\n'); release();
  assert.equal(await writing, true);
  assert.ok(f.saved().endsWith(expectedBody)); assert.equal(f.editor.getValue(), f.saved()); assert.equal(f.stats.modifies, 0);
  assert.equal(f.undo(), true);
  assert.ok(f.editor.getValue().endsWith(expectedBody), 'undo title without undoing the intervening body input');
});

test('a property commit waits for its persisted result when a native save was already in flight', async t => {
  const f = openBufferFixture(t, {crlf: true});
  let release;
  f.holdNextSave(new Promise(r => { release = r; }));
  const firstSave = f.view.save();
  assert.equal(f.view.saving, true);
  f.append('Newer body while first save is pending\n');
  const expectedBody = f.editor.getValue().split('---\n').slice(2).join('---\n');
  let settled = false;
  const titleSave = f.plugin.bulkEditService.updateFrontmatter([f.file], {title: 'After'}).then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  const settledBeforeNativeSave = settled;
  release(); await firstSave; const changed = await titleSave; await f.view.followupSave;
  assert.equal(settledBeforeNativeSave, false, 'completion must not precede the pending native write');
  assert.equal(changed, 1); assert.ok(f.saved().endsWith(expectedBody));
  assert.equal(parse(f.saved().match(/^---\n([\s\S]*?)\n---/)[1]).title, 'After');
  assert.equal(f.editor.getValue(), f.saved()); assert.equal(f.stats.modifies, 0); assert.equal(f.stats.renames, 1);
  assert.equal(f.listeners.size, 0);
});

test('an older in-flight save with the same title cannot confirm a newer body commit', async t => {
  const f = openBufferFixture(t);
  let firstRelease, secondRelease;
  f.editor.replaceRange('After', {line: 1, ch: 7}, {line: 1, ch: 13}, 'input.type');
  f.holdNextSave(new Promise(r => { firstRelease = r; }));
  const firstSave = f.view.save();
  f.editor.replaceRange('Before', {line: 1, ch: 7}, {line: 1, ch: 12}, 'input.type');
  f.append('Body newer than the same-title save\n');
  f.holdNextSave(new Promise(r => { secondRelease = r; }));
  let settled = false;
  const operation = f.plugin.frontmatterMutationService.process(f.file, fm => { fm.title = 'After'; }).then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  firstRelease(); await firstSave; await new Promise(resolve => setImmediate(resolve));
  const completedOnOldSave = settled;
  secondRelease(); await f.view.followupSave; assert.equal(await operation, true);
  assert.equal(completedOnOldSave, false, 'a matching old title is not proof the current body was saved');
  assert.equal(f.editor.getValue(), f.saved()); assert.equal(f.listeners.size, 0);
});

test('a non-title property uses authored frontmatter from the pending buffer', async t => {
  const f = openBufferFixture(t);
  f.editor.replaceRange('Draft title', {line: 1, ch: 7}, {line: 1, ch: 13}, 'input.type');
  assert.equal(await f.plugin.bulkEditService.updateFrontmatter([f.file], {priority: 'high'}), 1);
  const fm = parse(f.saved().match(/^---\n([\s\S]*?)\n---/)[1]);
  assert.equal(fm.title, 'Draft title'); assert.equal(fm.priority, 'high');
  assert.equal(f.stats.renames, 0); assert.equal(f.counts.nativeSaves, 1); assert.equal(f.stats.modifies, 0);
});

for (const change of ['frontmatter', 'close', 'switch file', 'reading mode']) {
  test(`an async property action refuses a changed editing target: ${change}`, async t => {
    const f = openBufferFixture(t);
    let release, entered;
    const gate = new Promise(r => { release = r; }), begun = new Promise(r => { entered = r; });
    const operation = f.plugin.frontmatterMutationService.process(f.file, async fm => { entered(); await gate; fm.title = 'After'; });
    const rejection = assert.rejects(operation, /changed|pending/);
    await begun;
    if (change === 'frontmatter') f.editor.replaceRange('New user title', {line: 1, ch: 7}, {line: 1, ch: 13}, 'input.type');
    if (change === 'close') f.plugin.app.workspace.getLeavesOfType = () => [];
    if (change === 'switch file') f.view.file = f.add('Different target');
    if (change === 'reading mode') f.view.getMode = () => 'preview';
    const before = f.editor.getValue();
    release(); await rejection;
    assert.equal(f.editor.getValue(), before); assert.equal(f.stats.modifies, 0); assert.equal(f.counts.nativeSaves, 0);
    assert.equal(f.stats.renames, 0); assert.equal(f.events.length, 0); assert.equal(f.listeners.size, 0);
  });
}

test('save rejection preserves the edited buffer without a disk fallback or success notification', async t => {
  const f = openBufferFixture(t);
  const before = f.saved();
  f.view.save = async () => { throw Error('Synthetic save failure'); };
  await assert.rejects(f.plugin.frontmatterMutationService.process(f.file, fm => { fm.title = 'After'; }), /Synthetic save failure/);
  assert.equal(f.saved(), before); assert.match(f.editor.getValue(), /title: After/);
  assert.equal(f.stats.modifies, 0); assert.equal(f.stats.renames, 0); assert.equal(f.events.length, 0);
  assert.equal(f.listeners.size, 0);
});

test('an unconfirmed native save fails at its deadline without repair or a success notification', async t => {
  const f = openBufferFixture(t);
  let expire;
  const cleared = [];
  t.mock.method(window, 'setTimeout', callback => { expire = callback; return 421; });
  t.mock.method(window, 'clearTimeout', id => { cleared.push(id); });
  // TextFileView can swallow adapter errors. No modify event confirms the save.
  f.view.save = async () => {};
  const before = f.saved();
  const operation = f.plugin.frontmatterMutationService.process(f.file, fm => { fm.title = 'After'; });
  const rejection = assert.rejects(operation, /did not confirm saving/);
  await new Promise(resolve => setImmediate(resolve)); expire(); await rejection;
  assert.equal(f.saved(), before); assert.match(f.editor.getValue(), /title: After/);
  assert.equal(f.stats.modifies, 0); assert.equal(f.stats.renames, 0); assert.equal(f.events.length, 0);
  assert.equal(f.listeners.size, 0); assert.deepEqual(cleared, [421]);
});

test('the source editor remains the property owner when the active matching leaf is in Reading view', async t => {
  const f = openBufferFixture(t);
  const sourceLeaf = f.plugin.app.workspace.activeLeaf;
  const reading = {view: {...f.view, getMode: () => 'preview', editor: undefined}};
  f.plugin.app.workspace.getLeavesOfType = () => [reading, sourceLeaf];
  f.plugin.app.workspace.activeLeaf = reading;
  assert.equal(await f.plugin.bulkEditService.updateFrontmatter([f.file], {priority: 'high'}), 1);
  assert.match(f.editor.getValue(), /priority: high/); assert.equal(f.saved(), f.editor.getValue());
  assert.equal(f.stats.modifies, 0); assert.equal(f.counts.nativeSaves, 1);
});


test('the real title prompt reports a native-save failure instead of silently closing', async t => {
  const f = openBufferFixture(t);
  const before = f.saved();
  f.view.save = async () => { throw Error('Synthetic save failure'); };
  await f.prompt('After');
  assert.deepEqual(f.notices, ['Could not finish updating properties for 1 note.']);
  assert.equal(f.saved(), before); assert.match(f.editor.getValue(), /title: After/);
  assert.equal(f.stats.modifies, 0); assert.equal(f.stats.renames, 0);
  assert.equal(f.events.length, 0); assert.equal(f.explicit.length, 0); assert.equal(f.localRefreshes.length, 0);
  assert.equal(f.listeners.size, 0);
});

test('a partly failed bulk property action reports one failure summary and retains successful counts/events', async t => {
  const f = fixture(t);
  for (let i = 1; i < 20; i++) f.add(`Batch ${i}`);
  const failing = new Set(f.files.slice(7)), modify = f.plugin.app.vault.modify;
  f.plugin.app.vault.modify = async (file, next) => { if (failing.has(file)) throw Error('Synthetic save failure'); return modify(file, next); };
  assert.equal(await f.plugin.bulkEditService.updateFrontmatter(f.files, {priority: 'high'}), 7);
  assert.deepEqual(f.notices, ['Could not finish updating properties for 13 notes.']);
  assert.equal(f.stats.modifies, 7); assert.equal(f.events.length, 7); assert.equal(f.explicit.length, 7);
});

for (const afterRename of [false, true]) {
  test(`a core rename failure ${afterRename ? 'after' : 'before'} the path commit reports incomplete work and preserves its event`, async t => {
    const f = fixture(t);
    const rename = f.plugin.app.fileManager.renameFile;
    f.plugin.app.fileManager.renameFile = async (...args) => { if (afterRename) await rename(...args); throw Error('Synthetic rename failure'); };
    await f.prompt('After');
    assert.deepEqual(f.notices, ['Could not finish updating properties for 1 note.']);
    assert.equal(f.stats.modifies, 1); assert.match(f.sources.get(f.file), /title: After/);
    assert.equal(f.file.path, afterRename ? 'Inbox/After.md' : 'Inbox/Before.md');
    assert.deepEqual(f.events.map(event => event.paths), [[f.file.path]]);
    assert.equal(f.localRefreshes.length, 0);
  });
}

for (const message of ['Synthetic rename failure', 'ENOENT: no such file or directory']) {
  test(`automatic filename maintenance retains its handled-error policy: ${message}`, async t => {
    const f = fixture(t);
    f.sources.set(f.file, f.sources.get(f.file).replace('title: Before', 'title: After'));
    const attempts = t.mock.method(f.plugin.app.fileManager, 'renameFile', async () => { throw Error(message); });
    await assert.doesNotReject(f.plugin.fileNamingService.updateFilenameIfNeeded(f.file));
    assert.equal(attempts.mock.callCount(), 1); assert.equal(f.file.path, 'Inbox/Before.md');
    assert.deepEqual(f.notices, []); assert.equal(f.events.length, 0);
    await assert.rejects(f.plugin.fileNamingService.updateFilenameIfNeeded(f.file, {titleOverride: 'After'}), error => error.message === message);
  });
}

test('unchanged property requests and write-guard refusals are not presented as save errors', async t => {
  const f = openBufferFixture(t);
  await f.prompt('Before');
  assert.equal(await f.plugin.bulkEditService.updateFrontmatter([f.file], {title: 'After'}, {writeGuard: () => false}), 0);
  assert.deepEqual(f.notices, []); assert.equal(f.counts.nativeSaves, 0);
});

for (const open of [false, true]) {
  test(`unchanged ${open ? 'open' : 'closed'} properties preserve authored YAML order and comments`, async t => {
    const f = open ? openBufferFixture(t) : fixture(t);
    const source = "---\ntitle: 'Before' # authored comment\ncustom: preserve\n---\nKeep body marker\n";
    f.sources.set(f.file, source);
    if (open) {
      f.editor.replaceRange(source, {line: 0, ch: 0}, f.editor.offsetToPos(f.editor.getValue().length));
      f.counts.transactions = 0;
    }
    const reads = t.mock.method(f.plugin.app.vault, 'read');
    for (let i = 0; i < 20; i++) {
      assert.equal(await f.plugin.bulkEditService.updateFrontmatter([f.file], {custom: 'preserve'}), 0);
    }
    assert.equal(f.sources.get(f.file), source);
    assert.equal(f.stats.modifies + f.stats.renames + f.events.length, 0);
    assert.equal(reads.mock.callCount(), open ? 0 : 20);
    if (open) {
      assert.equal(f.editor.getValue(), source);
      assert.equal(f.counts.nativeSaves + f.counts.transactions, 0);
    }
    assert.equal(await f.plugin.bulkEditService.updateFrontmatter([f.file], {custom: 'changed'}), 1);
    assert.match(f.sources.get(f.file), /custom: changed/);
    assert.ok(f.sources.get(f.file).endsWith('Keep body marker\n'));
  });
}

test('a Live Preview hidden-header selection permits the property edit and retains undo', async t => {
  const f = openBufferFixture(t, {crlf: true, hiddenHeader: true});
  t.mock.method(window, 'setTimeout', (fn, ms) => setTimeout(fn, ms === 30_000 ? 5 : ms));
  const body = f.editor.getValue().slice(f.editor.getValue().indexOf('\n---\n', 4) + 5);
  assert.equal(await f.plugin.bulkEditService.updateFrontmatter([f.file], {title: 'After'}), 1);
  assert.match(f.saved(), /title: After/);
  assert.ok(f.saved().endsWith(body));
  assert.equal(f.counts.transactions, 1);
  assert.equal(f.counts.nativeSaves, 1);
  assert.equal(f.counts.propertySynchronizations, 1);
  assert.match(f.view.rawFrontmatter, /title: After/);
  assert.equal(f.undo(), true);
  assert.match(f.editor.getValue(), /title: Before/);
  assert.ok(f.editor.getValue().endsWith(body));
});
