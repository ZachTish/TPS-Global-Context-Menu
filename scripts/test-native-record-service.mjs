import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({
    stdin: {
      contents: `
        export * from '../src/services/native-record-service.ts';
        export { TFile, TFolder } from 'obsidian';
      `,
      resolveDir: dirname(fileURLToPath(import.meta.url)),
      sourcefile: 'native-record-service-harness.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'native-record-stubs',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'native-record-test' }));
        builder.onResolve({ filter: /^\.\.\/logger$/u }, () => ({ path: 'logger', namespace: 'native-record-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'native-record-test' }, (args) => {
          if (args.path === 'logger') {
            return { loader: 'js', contents: 'export const flow = () => {}; export const flowError = () => {};' };
          }
          return {
            loader: 'js',
            contents: `
              export function normalizePath(value) {
                return String(value || '').replace(/\\\\/gu, '/').replace(/\\/{2,}/gu, '/').replace(/^\\.\\//u, '').replace(/^\\/+|\\/+$/gu, '');
              }
              export class TAbstractFile {
                constructor(path = '') { this.path = normalizePath(path); this.refreshIdentity(); }
                refreshIdentity() { this.name = this.path.split('/').filter(Boolean).pop() || ''; }
              }
              export class TFolder extends TAbstractFile {}
              export class TFile extends TAbstractFile {
                constructor(path = '') { super(path); this.refreshIdentity(); }
                refreshIdentity() {
                  super.refreshIdentity();
                  const dot = this.name.lastIndexOf('.');
                  this.extension = dot >= 0 ? this.name.slice(dot + 1) : '';
                  this.basename = dot >= 0 ? this.name.slice(0, dot) : this.name;
                }
              }
              export const parseYaml = (value) => JSON.parse(String(value || '{}'));
              export const stringifyYaml = (value) => JSON.stringify(value);
            `,
          };
        });
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const {
  NativeRecordService,
  TFile,
  TFolder,
  TPS_NATIVE_RECORD_SCHEMA_VERSION,
  buildNativeRecordPath,
  isNativeRecordEnvelope,
  normalizeNativeRecordRoot,
  parseNativeRecordDocument,
  serializeNativeRecordDocument,
  taskLineNeedsNativeRecord,
} = await loadModule();

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const constantsSource = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const filePropertiesSource = readFileSync(new URL('../src/services/file-properties-service.ts', import.meta.url), 'utf8');
const fileNamingSource = readFileSync(new URL('../src/services/file-naming-service.ts', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');

function createHarness(mode = 'native-records') {
  const entries = new Map();
  const contents = new WeakMap();
  const metadata = new WeakMap();
  const events = [];
  const vaultEventHandlers = new Map();
  const root = new TFolder('');
  entries.set('', root);

  function ensureFolder(path) {
    const normalized = normalizeNativeRecordRoot(path);
    if (!path || !normalized) return root;
    const existing = entries.get(normalized);
    if (existing) return existing;
    const parent = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    if (parent) ensureFolder(parent);
    const folder = new TFolder(normalized);
    entries.set(normalized, folder);
    return folder;
  }

  function addFile(path, content) {
    const normalized = String(path).replace(/^\/+|\/+$/gu, '');
    const parent = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    if (parent) ensureFolder(parent);
    const file = new TFile(normalized);
    entries.set(normalized, file);
    contents.set(file, String(content || ''));
    const parsed = parseNativeRecordDocument(String(content || ''));
    if (parsed) metadata.set(file, parsed.frontmatter);
    return file;
  }

  const vault = {
    getMarkdownFiles: () => [...entries.values()].filter((entry) => entry instanceof TFile && entry.extension === 'md'),
    getAbstractFileByPath: (path) => entries.get(String(path).replace(/^\/+|\/+$/gu, '')) || null,
    getFileByPath(path) {
      const entry = this.getAbstractFileByPath(path);
      return entry instanceof TFile ? entry : null;
    },
    createFolder: async (path) => ensureFolder(path),
    create: async (path, content) => {
      const file = addFile(path, content);
      for (const handler of vaultEventHandlers.get('create') || []) handler(file);
      return file;
    },
    cachedRead: async (file) => contents.get(file) || '',
    process: async (file, processor) => {
      const next = processor(contents.get(file) || '');
      contents.set(file, next);
      const parsed = parseNativeRecordDocument(next);
      if (parsed) metadata.set(file, parsed.frontmatter);
      return next;
    },
    rename: async (file, nextPath) => {
      const oldPath = file.path;
      entries.delete(oldPath);
      file.path = String(nextPath).replace(/^\/+|\/+$/gu, '');
      file.refreshIdentity();
      entries.set(file.path, file);
      for (const handler of vaultEventHandlers.get('rename') || []) handler(file, oldPath);
    },
    on: (eventName, handler) => {
      const handlers = vaultEventHandlers.get(eventName) || [];
      handlers.push(handler);
      vaultEventHandlers.set(eventName, handlers);
      return {};
    },
  };
  const plugin = {
    settings: { dataArchitectureMode: mode, nativeRecordRootPath: '_records' },
    manifest: { id: 'tps-global-context-menu' },
    registerEvent: () => {},
    app: {
      vault,
      metadataCache: {
        getFileCache: (file) => ({ frontmatter: metadata.get(file) }),
        on: () => ({}),
      },
      fileManager: {
        generateMarkdownLink: (file, _sourcePath, _subpath, alias) => `[[${file.path.replace(/\.md$/u, '')}|${alias}]]`,
      },
    },
    entityIndexService: { upsertFile: () => {} },
    eventService: {
      emitFilesUpdated: (paths, details) => events.push({ type: 'files', paths, details }),
      emitExplicitAction: (paths, details) => events.push({ type: 'explicit', paths, details }),
    },
    taskApiService: { get: async () => null },
  };
  const service = new NativeRecordService(plugin);
  service.setup();
  return { service, plugin, vault, entries, contents, metadata, events, addFile };
}

test('native record envelope and path helpers are deterministic', () => {
  assert.equal(normalizeNativeRecordRoot(' /_records// '), '_records');
  assert.equal(buildNativeRecordPath('_records', 'calendar-event', 'event:one'), '_records/calendar-events/event-one.md');
  const envelope = {
    tpsId: 'task-1',
    tpsSchemaVersion: TPS_NATIVE_RECORD_SCHEMA_VERSION,
    kind: 'task',
    title: 'One',
    createdDate: '2026-08-24T00:00:00.000Z',
    modifiedDate: '2026-08-24T00:00:00.000Z',
  };
  assert.equal(isNativeRecordEnvelope(envelope), true);
  const content = serializeNativeRecordDocument({ bom: '', newline: '\r\n', closer: '...', body: 'notes', frontmatter: envelope });
  const parsed = parseNativeRecordDocument(content);
  assert.deepEqual(parsed?.frontmatter, envelope);
  assert.equal(parsed?.newline, '\r\n');
  assert.equal(parsed?.closer, '...');
  assert.equal(parsed?.body, 'notes');
});

test('native record create, update, archive, and asset paths preserve typed values', async () => {
  const { service, contents, events, addFile } = createHarness();
  const created = await service.create('food-entry', {
    title: 'Lunch',
    calories: 640,
    protein: 42,
    tags: ['food', 'lunch'],
  }, { id: 'food-1', now: new Date('2026-08-24T12:00:00.000Z'), cause: { kind: 'user' } });
  assert.equal(created.path, '_records/food-entries/food-1.md');
  assert.equal(created.frontmatter.calories, 640);
  assert.deepEqual(created.frontmatter.tags, ['food', 'lunch']);

  const updated = await service.update(created.file, { calories: 700, tpsId: 'forbidden', kind: 'asset' });
  assert.equal(updated?.id, 'food-1');
  assert.equal(updated?.kind, 'food-entry');
  assert.equal(updated?.frontmatter.calories, 700);
  const archived = await service.archive(created.id);
  assert.equal(archived?.frontmatter.archived, true);
  assert.match(String(contents.get(created.file)), /"tpsId":"food-1"/u);

  const assetSource = addFile('Documents/spec.pdf', '%PDF-test');
  const asset = await service.createAsset(assetSource, { title: 'Spec' }, { id: 'asset-1' });
  assert.equal(asset.path, '_records/assets/asset-1.md');
  assert.equal(asset.frontmatter.sourcePath, 'Documents/spec.pdf');
  assert.equal((await service.ensureAsset(assetSource)).id, 'asset-1');
  assert.equal(service.resolveAssetCached(assetSource)?.id, 'asset-1');
  assert.equal((await service.resolveAsset(assetSource))?.id, 'asset-1');
  assert.ok(events.some((event) => event.type === 'explicit'));
});

test('a new empty task draft created by core Bases is adopted into the canonical native task folder', async () => {
  const { service, vault, entries, contents, events } = createHarness();
  const draft = await vault.create('Untitled.md', serializeNativeRecordDocument({
    bom: '',
    newline: '\n',
    closer: '---',
    body: '',
    frontmatter: {
      kind: 'task',
      title: null,
      status: null,
      priority: null,
      scheduled: null,
      due: null,
      timeEstimate: null,
      parents: null,
      tags: null,
    },
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(draft.path, /^_records\/tasks\/task-[^.]+\.md$/u);
  assert.equal(entries.has('Untitled.md'), false);
  const parsed = parseNativeRecordDocument(contents.get(draft));
  assert.equal(parsed?.frontmatter.kind, 'task');
  assert.equal(parsed?.frontmatter.title, 'Untitled');
  assert.equal(parsed?.frontmatter.status, 'todo');
  assert.equal(parsed?.frontmatter.tpsSchemaVersion, 1);
  assert.match(String(parsed?.frontmatter.tpsId), /^task-/u);
  assert.equal((await service.resolve(String(parsed?.frontmatter.tpsId)))?.path, draft.path);
  assert.ok(events.some((event) => event.type === 'explicit'
    && event.details?.source === 'native-base-new-task'));
});

test('native draft adoption never absorbs existing, non-task, enveloped, or body-bearing notes', async () => {
  const { vault } = createHarness();
  const cases = [
    ['Body task.md', { kind: 'task', title: '' }, 'human notes'],
    ['Project.md', { kind: 'project', title: '' }, ''],
    ['Partial.md', { kind: 'task', title: '', tpsId: 'manual-id' }, ''],
    ['Schema.md', { kind: 'task', title: '', tpsSchemaVersion: 1 }, ''],
  ];
  for (const [path, frontmatter, body] of cases) {
    const file = await vault.create(path, serializeNativeRecordDocument({
      bom: '', newline: '\n', closer: '---', body, frontmatter,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(file.path, path);
  }
});

test('native record IDs remain the canonical filenames after a user or plugin rename', async () => {
  const { service, vault, entries } = createHarness();
  const created = await service.create('calendar-event', {
    title: 'Renamed event',
    scheduled: '2026-08-25T09:00:00.000Z',
  }, { id: 'calendar-event-1' });

  await vault.rename(created.file, '_records/calendar-events/2026-08-25 Renamed event.md');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(created.file.path, '_records/calendar-events/calendar-event-1.md');
  assert.equal(entries.get(created.file.path), created.file);
  assert.equal(await service.resolve('calendar-event-1').then((record) => record?.path), created.file.path);
});

test('native record rename restores the canonical filename before MetadataCache is ready', async () => {
  const { service, vault, entries, metadata, addFile } = createHarness();
  const record = addFile('_records/calendar-events/calendar-event-cold.md', serializeNativeRecordDocument({
    bom: '',
    newline: '\n',
    closer: '---',
    body: '',
    frontmatter: {
      tpsId: 'calendar-event-cold',
      tpsSchemaVersion: 1,
      kind: 'calendar-event',
      title: 'Cold cache event',
      createdDate: '2026-08-25T09:00:00.000Z',
      modifiedDate: '2026-08-25T09:00:00.000Z',
    },
  }));
  metadata.delete(record);

  await vault.rename(record, '_records/calendar-events/2026-08-25 Cold cache event.md');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(record.path, '_records/calendar-events/calendar-event-cold.md');
  assert.equal(entries.get(record.path), record);
  assert.equal(await service.resolve('calendar-event-cold').then((resolved) => resolved?.path), record.path);
});

test('task promotion creates one task record and replaces only the confirmed source line with a stable link', async () => {
  const { service, plugin, addFile, contents } = createHarness();
  const sourceLine = '- [ ] Ship release #work [scheduled:: 2026-08-25 09:00:00]';
  const source = addFile('Inbox.md', `# Inbox\n${sourceLine}\n  - supporting note\n`);
  plugin.taskApiService.get = async () => ({
    type: 'task-line',
    id: 'Inbox.md:2',
    stableId: 'task-123',
    path: source.path,
    line: 2,
    lineNumber: 1,
    rawLine: sourceLine,
    title: 'Ship release',
    checkbox: '[ ]',
    marker: ' ',
    status: 'todo',
    inlineStatus: '',
    isComplete: false,
    tags: ['work'],
    fields: { scheduled: '2026-08-25 09:00:00', timeEstimate: '45' },
    blockLineCount: 2,
  });

  const result = await service.promoteTask({ path: source.path, lineNumber: 1, rawLine: sourceLine });
  assert.equal(result.ok, true);
  assert.equal(result.record?.path, '_records/tasks/task-123.md');
  assert.equal(result.record?.frontmatter.timeEstimate, 45);
  assert.equal(contents.get(source), '# Inbox\n- [[_records/tasks/task-123|Ship release]]\n  - supporting note\n');
  assert.equal((await service.resolve('task-123'))?.path, result.record?.path);
});

test('only task lines with an authored scheduled or due value cross the native-record boundary', () => {
  assert.equal(taskLineNeedsNativeRecord('- [ ] Quick reminder'), false);
  assert.equal(taskLineNeedsNativeRecord('- [ ] Meeting [scheduled:: 2026-08-26 09:00:00]'), true);
  assert.equal(taskLineNeedsNativeRecord('- [ ] Submit report [due:: 2026-08-28]'), true);
  assert.equal(taskLineNeedsNativeRecord('- [ ] Clear date [scheduled:: ] [due:: ]'), false);
  assert.equal(taskLineNeedsNativeRecord('- Plain bullet [scheduled:: 2026-08-26 09:00:00]'), false);
});

test('ordinary note auto-naming never renames canonical native record files', () => {
  assert.match(fileNamingSource, /nativeRecordService\?\.isRecordFile\(file\)/u);
  assert.match(fileNamingSource, /trigger Obsidian's update-links prompt/u);
});

test('legacy mode rejects new record creation and leaves existing behavior opt-in', async () => {
  const { service } = createHarness('legacy');
  assert.equal(service.getMode(), 'legacy');
  await assert.rejects(
    service.create('task', { title: 'Must not create' }),
    /requires the native-records data architecture mode/u,
  );
});

test('native profile is explicit, default-off, and removes legacy active paths only after reload', () => {
  assert.match(typesSource, /TpsDataArchitectureMode = 'legacy' \| 'native-records'/u);
  assert.match(constantsSource, /dataArchitectureMode: 'legacy'/u);
  assert.match(constantsSource, /nativeRecordRootPath: '_records'/u);
  assert.match(settingsSource, /Legacy TPS views and companions/u);
  assert.match(settingsSource, /Native Markdown records and core Bases/u);
  assert.match(settingsSource, /Changing this requires an Obsidian reload/u);
  assert.match(mainSource, /if \(!this\.usesNativeRecordArchitecture\(\)\) \{[\s\S]{0,1200}registerBasesView\(TPS_TABLE_VIEW_TYPE[\s\S]{0,1200}registerBasesView\(TPS_LIST_VIEW_TYPE/u);
  assert.match(mainSource, /if \(!this\.usesNativeRecordArchitecture\(\)\) this\.baseRowIndexService\.setup\(\)/u);
  assert.match(mainSource, /if \(!this\.usesNativeRecordArchitecture\(\)\) this\.addChild\(this\.virtualBaseEmbedService\)/u);
  assert.match(mainSource, /if \(!this\.usesNativeRecordArchitecture\(\)\) this\.baseLineEditProtocolService\.register\(\)/u);
  assert.match(filePropertiesSource, /dataArchitectureMode !== 'native-records'[\s\S]{0,180}file instanceof TFile/u);
});

test('public GCM API exposes versioned generic and task record contracts', () => {
  assert.match(apiSource, /const nativeRecordsApi = \{[\s\S]{0,300}version: plugin\.nativeRecordService\.version[\s\S]{0,1800}createAsset:[\s\S]{0,1800}resolve:[\s\S]{0,1800}archive:/u);
  assert.match(apiSource, /ensureAsset:[\s\S]{0,700}resolveAsset:/u);
  assert.match(apiSource, /const taskRecordsApi = \{[\s\S]{0,200}version: 1[\s\S]{0,500}promote:[\s\S]{0,900}resolve:/u);
  assert.match(apiSource, /nativeRecords: nativeRecordsApi,[\s\S]{0,100}taskRecords: taskRecordsApi/u);
});
