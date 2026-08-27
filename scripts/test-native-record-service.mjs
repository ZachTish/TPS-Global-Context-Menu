import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

function parseYamlScalar(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('{') && value.endsWith('}'))) {
    return JSON.parse(value);
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/gu, "'");
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  return value;
}

function parseYamlForNativeRecordTest(source) {
  const text = String(source || '').trim();
  if (!text) return {};
  if (text.startsWith('{')) return JSON.parse(text);
  const result = {};
  let listKey = null;
  const lines = String(source || '').replace(/\r\n/gu, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const list = line.match(/^\s+-\s+(.*)$/u);
    if (list && listKey) {
      result[listKey].push(parseYamlScalar(list[1]));
      continue;
    }
    const pair = line.match(/^([^#\s][^:]*):(?:\s*(.*))?$/u);
    if (!pair) continue;
    const key = pair[1].trim().replace(/^['"]|['"]$/gu, '');
    const rawValue = pair[2] ?? '';
    const blockMarker = rawValue.trim().match(/^([|>])([+-]?)$/u);
    if (blockMarker) {
      const blockLines = [];
      let indent = null;
      let cursor = index + 1;
      for (; cursor < lines.length; cursor += 1) {
        const blockLine = lines[cursor];
        if (!blockLine.trim()) {
          blockLines.push('');
          continue;
        }
        const leading = blockLine.match(/^\s+/u)?.[0].length || 0;
        if (!leading) break;
        indent ??= leading;
        if (leading < indent) break;
        blockLines.push(blockLine.slice(indent));
      }
      const joined = blockMarker[1] === '>'
        ? blockLines.join(' ').replace(/ +/gu, ' ')
        : blockLines.join('\n');
      result[key] = blockMarker[2] === '-' ? joined : `${joined}\n`;
      index = cursor - 1;
      listKey = null;
      continue;
    }
    if (!rawValue.trim()) {
      result[key] = [];
      listKey = key;
    } else {
      result[key] = parseYamlScalar(rawValue);
      listKey = null;
    }
  }
  return result;
}

function yamlScalarForNativeRecordTest(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (value == null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  return !text || /[:#\r\n]|^[-?,\[\]{}&*!|>'"%@`]|\s$/u.test(text)
    ? JSON.stringify(text)
    : text;
}

function stringifyYamlForNativeRecordTest(record) {
  const output = [];
  for (const [key, value] of Object.entries(record || {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      output.push(`${key}:`);
      for (const entry of value) output.push(`  - ${yamlScalarForNativeRecordTest(entry)}`);
    } else {
      output.push(`${key}: ${yamlScalarForNativeRecordTest(value)}`);
    }
  }
  return `${output.join('\n')}\n`;
}

async function loadModule() {
  const result = await build({
    stdin: {
      contents: `
        export * from '../src/services/native-record-service.ts';
        export { FrontmatterMutationService } from '../src/services/frontmatter-mutation-service.ts';
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
            return { loader: 'js', contents: 'export const flow = () => {}; export const flowError = () => {}; export const perf = () => {}; export const warn = () => {}; export const error = () => {}; export const debug = () => {};' };
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
              export class MarkdownView {}
              export class WorkspaceLeaf {}
              export class Notice {}
              export class TFile extends TAbstractFile {
                constructor(path = '') { super(path); this.refreshIdentity(); }
                refreshIdentity() {
                  super.refreshIdentity();
                  const dot = this.name.lastIndexOf('.');
                  this.extension = dot >= 0 ? this.name.slice(dot + 1) : '';
                  this.basename = dot >= 0 ? this.name.slice(0, dot) : this.name;
                }
              }
              export const parseYaml = globalThis.__parseYamlForNativeRecordTest;
              export const stringifyYaml = globalThis.__stringifyYamlForNativeRecordTest;
              export function setIcon() {}
              export function moment() { return { isValid: () => false, format: () => '' }; }
              moment.ISO_8601 = 'ISO_8601';
            `,
          };
        });
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

globalThis.__parseYamlForNativeRecordTest = parseYamlForNativeRecordTest;
globalThis.__stringifyYamlForNativeRecordTest = stringifyYamlForNativeRecordTest;
globalThis.window ??= { setTimeout, clearTimeout };

const {
  DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE,
  DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
  FrontmatterMutationService,
  NativeRecordService,
  TFile,
  TFolder,
  TPS_NATIVE_RECORD_SCHEMA_VERSION,
  buildNativeRecordPath,
  isNativeRecordEnvelope,
  normalizeNativeRecordRoot,
  parseNativeRecordDocument,
  resolveWritableNativeRecordStorageConfiguration,
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

function createHarness(mode = 'native-records', options = {}) {
  const entries = new Map();
  const contents = new WeakMap();
  const metadata = new WeakMap();
  const events = [];
  const indexed = [];
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
    settings: {
      dataArchitectureMode: mode,
      nativeRecordRootPath: options.root ?? '_records',
      nativeRecordLayout: options.layout ?? 'kind-folders',
      nativeRecordIdentityMode: options.identityMode,
      nativeRecordIdentityPropertyKey: options.identityPropertyKey,
      nativeRecordSchemaPropertyKey: options.schemaPropertyKey,
      nativeRecordIdentityTagPrefix: options.identityTagPrefix,
      nativeRecordKindPropertyKey: options.kindPropertyKey,
      nativeRecordTitlePropertyKey: options.titlePropertyKey,
      nativeRecordCreatedPropertyKey: options.createdPropertyKey,
      nativeRecordModifiedPropertyKey: options.modifiedPropertyKey,
      nativeRecordStorageAliases: options.storageAliases || [],
    },
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
        renameFile: (file, path) => vault.rename(file, path),
      },
    },
    entityIndexService: { upsertFile: (...args) => indexed.push(args) },
    eventService: {
      emitFilesUpdated: (paths, details) => events.push({ type: 'files', paths, details }),
      emitExplicitAction: (paths, details) => events.push({ type: 'explicit', paths, details }),
    },
    taskApiService: { get: async () => null },
    saveSettings: async () => {},
  };
  plugin.frontmatterMutationService = new FrontmatterMutationService(plugin);
  const service = new NativeRecordService(plugin);
  service.setup();
  return { service, plugin, vault, entries, contents, metadata, events, indexed, addFile };
}

test('native record envelope and path helpers are deterministic', () => {
  assert.equal(normalizeNativeRecordRoot(' /_records// '), '_records');
  assert.equal(normalizeNativeRecordRoot('/'), '');
  assert.equal(buildNativeRecordPath('_records', 'calendar-event', 'event:one'), '_records/calendar-events/event-one.md');
  assert.equal(buildNativeRecordPath('/', 'calendar-event', 'event:one', 'flat-root'), 'event-one.md');
  assert.equal(buildNativeRecordPath('/', 'calendar-event', 'event:one', 'flat-root', '2026-08-25 - Standup.md'), '2026-08-25 - Standup.md');
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

test('frontmatter fences must be column-zero and indented scalar markers survive consolidation', async () => {
  assert.equal(parseNativeRecordDocument('  ---\ntpsId: task-nope\n---\n'), null);
  const source = [
    '\uFEFF---',
    'tpsId: task-indented-fence',
    'tpsSchemaVersion: 1',
    'kind: task',
    'title: Indented fence task',
    'description: |-',
    '  first line',
    '  ---',
    '  last line',
    '---',
    'Body line',
    '  ---',
    'Body tail',
  ].join('\n');
  const parsed = parseNativeRecordDocument(source);
  assert.equal(parsed?.frontmatter.description, 'first line\n---\nlast line');
  assert.equal(parsed?.body, 'Body line\n  ---\nBody tail');

  const { service, contents, addFile } = createHarness();
  const file = addFile('_records/tasks/task-indented-fence.md', source);
  const result = await service.migrateStorageProfile();
  assert.equal(result.failed, 0);
  const persisted = parseNativeRecordDocument(contents.get(file));
  assert.equal(persisted?.frontmatter.description, 'first line\n---\nlast line');
  assert.equal(persisted?.body, 'Body line\n  ---\nBody tail');
});

test('flat-root layout creates every native record directly in the configured destination', async () => {
  const { service } = createHarness('native-records', { root: '/', layout: 'flat-root' });
  const task = await service.create('task', { title: 'Root task' }, { id: 'task-root' });
  const food = await service.create('food-entry', { title: 'Root food' }, { id: 'food-root' });
  assert.equal(task.path, 'task-root.md');
  assert.equal(food.path, 'food-root.md');
});

test('a configured tag profile is retained only for reads while every new record writes property identity', async () => {
  const { service, contents } = createHarness('native-records', {
    root: '/',
    layout: 'flat-root',
    identityMode: 'tag',
    identityTagPrefix: 'my/records',
    kindPropertyKey: 'recordType',
    titlePropertyKey: 'name',
    createdPropertyKey: '',
    modifiedPropertyKey: '',
  });
  const created = await service.create('food-entry', {
    title: 'Tagged lunch',
    tags: ['lunch', '#favorite'],
    calories: 420,
  }, { id: 'food:one' });
  const parsed = parseNativeRecordDocument(contents.get(created.file));
  assert.equal(service.version, 4);
  assert.equal(service.getStorageProfile().identityMode, 'property');
  assert.equal(parsed.frontmatter.tpsId, 'food:one');
  assert.equal(parsed.frontmatter.tpsSchemaVersion, 1);
  assert.equal(Object.hasOwn(parsed.frontmatter, 'kind'), false);
  assert.equal(Object.hasOwn(parsed.frontmatter, 'title'), false);
  assert.equal(Object.hasOwn(parsed.frontmatter, 'createdDate'), false);
  assert.equal(Object.hasOwn(parsed.frontmatter, 'modifiedDate'), false);
  assert.equal(parsed.frontmatter.recordType, 'food-entry');
  assert.equal(parsed.frontmatter.name, 'Tagged lunch');
  assert.deepEqual(parsed.frontmatter.tags, ['lunch', 'favorite']);
  assert.equal(parsed.frontmatter.tags.some((tag) => tag.startsWith('my/records/')), false);
  assert.equal(service.inspect(parsed.frontmatter)?.id, 'food:one');
  assert.equal((await service.resolve('food:one'))?.frontmatter.calories, 420);

  const updated = await service.update(created.file, { title: 'Updated lunch', calories: 500 });
  assert.equal(updated?.frontmatter.title, 'Updated lunch');
  const updatedRaw = parseNativeRecordDocument(contents.get(created.file)).frontmatter;
  assert.equal(updatedRaw.name, 'Updated lunch');
  assert.equal(updatedRaw.calories, 500);
  assert.equal(Object.hasOwn(updatedRaw, 'modifiedDate'), false);
  assert.equal(service.inspect({
    recordType: 'food-entry',
    name: 'Legacy tagged lunch',
    tags: ['lunch', 'my/records/v1/food-entry/food-old'],
  })?.id, 'food-old');
});

test('writable storage resolution retires tag writers, keeps their exact reader, and repairs a blank kind key', () => {
  const configured = {
    ...DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE,
    identityTagPrefix: 'custom/items',
    kindPropertyKey: '',
    titlePropertyKey: 'name',
  };
  const resolved = resolveWritableNativeRecordStorageConfiguration(configured, [configured]);
  assert.equal(resolved.retiredTagIdentity, true);
  assert.equal(resolved.requiresSettingsMigration, true);
  assert.equal(resolved.configuredProfile.identityMode, 'tag');
  assert.equal(resolved.writeProfile.identityMode, 'property');
  assert.equal(resolved.writeProfile.kindPropertyKey, 'kind');
  assert.equal(resolved.writeProfile.titlePropertyKey, 'name');
  assert.deepEqual(resolved.readAliases, [resolved.configuredProfile]);
});

test('tag retirement repairs property-key collisions that were irrelevant to the legacy tag reader', () => {
  const configured = {
    ...DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE,
    identityPropertyKey: 'name',
    schemaPropertyKey: 'recordKind',
    kindPropertyKey: 'recordKind',
    titlePropertyKey: 'name',
  };
  const resolved = resolveWritableNativeRecordStorageConfiguration(configured);

  assert.equal(resolved.writeProfile.identityMode, 'property');
  assert.equal(resolved.writeProfile.titlePropertyKey, 'name');
  assert.equal(resolved.writeProfile.kindPropertyKey, 'recordKind');
  assert.equal(resolved.writeProfile.identityPropertyKey, 'tpsId');
  assert.equal(resolved.writeProfile.schemaPropertyKey, 'tpsSchemaVersion');
  assert.equal(resolved.requiresSettingsMigration, true);
  assert.deepEqual(resolved.readAliases, [resolved.configuredProfile]);
});

test('property writer repair makes every required system key unique and preserves disabled timestamps', () => {
  const resolved = resolveWritableNativeRecordStorageConfiguration({
    identityMode: 'property',
    identityPropertyKey: 'name',
    schemaPropertyKey: 'name',
    kindPropertyKey: 'name',
    titlePropertyKey: 'name',
    createdPropertyKey: 'name',
    modifiedPropertyKey: '',
    identityTagPrefix: 'tps/record',
  });
  const keys = [
    resolved.writeProfile.identityPropertyKey,
    resolved.writeProfile.schemaPropertyKey,
    resolved.writeProfile.kindPropertyKey,
    resolved.writeProfile.titlePropertyKey,
    resolved.writeProfile.createdPropertyKey,
  ];

  assert.equal(new Set(keys.map((key) => key.toLowerCase())).size, keys.length);
  assert.equal(resolved.writeProfile.titlePropertyKey, 'name');
  assert.equal(resolved.writeProfile.modifiedPropertyKey, '');
  assert.equal(resolved.requiresSettingsMigration, true);
});

test('tag aliases and the active pre-edit profile outrank capped older property history', () => {
  const customTagProfile = {
    ...DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE,
    identityTagPrefix: 'legacy/pinned',
  };
  const customPropertyProfile = {
    ...DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
    identityPropertyKey: 'pinnedLegacyId',
    schemaPropertyKey: 'pinnedLegacySchema',
  };
  const propertyHistory = Array.from({ length: 16 }, (_, index) => ({
    identityMode: 'property',
    identityPropertyKey: `historyId${index}`,
    schemaPropertyKey: `historySchema${index}`,
    identityTagPrefix: 'tps/record',
    kindPropertyKey: 'kind',
    titlePropertyKey: 'title',
    createdPropertyKey: 'createdDate',
    modifiedPropertyKey: 'modifiedDate',
  }));
  const resolved = resolveWritableNativeRecordStorageConfiguration(
    DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE,
    [...propertyHistory, customTagProfile],
  );
  assert.equal(resolved.readAliases.length, 14);
  assert.equal(resolved.readAliases[0].identityMode, 'tag');
  assert.equal(resolved.readAliases.some((profile) => profile.identityTagPrefix === 'legacy/pinned'), true);

  const { service, plugin } = createHarness('native-records', {
    identityPropertyKey: customPropertyProfile.identityPropertyKey,
    schemaPropertyKey: customPropertyProfile.schemaPropertyKey,
    storageAliases: [customTagProfile, ...propertyHistory.slice(0, 11)],
  });
  service.rememberCurrentStorageProfile();
  assert.equal(plugin.settings.nativeRecordStorageAliases.length, 13);
  assert.equal(plugin.settings.nativeRecordStorageAliases[0].identityTagPrefix, 'legacy/pinned');
  assert.equal(plugin.settings.nativeRecordStorageAliases.some((profile) => (
    profile.identityPropertyKey === 'pinnedLegacyId'
  )), true);
  assert.equal(service.inspect({
    kind: 'task',
    title: 'Delayed legacy arrival',
    tags: ['todo', 'legacy/pinned/v1/task/task-delayed'],
  })?.id, 'task-delayed');
  assert.equal(service.inspect({
    pinnedLegacyId: 'task-delayed-property',
    pinnedLegacySchema: 1,
    kind: 'task',
    title: 'Delayed property arrival',
  })?.id, 'task-delayed-property');

  const fullTagHistory = Array.from({ length: 12 }, (_, index) => ({
    ...DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE,
    identityTagPrefix: `legacy/full-cap-${index}`,
  }));
  const { service: fullCapService, plugin: fullCapPlugin } = createHarness('native-records', {
    identityPropertyKey: customPropertyProfile.identityPropertyKey,
    schemaPropertyKey: customPropertyProfile.schemaPropertyKey,
    storageAliases: fullTagHistory,
  });
  fullCapService.rememberCurrentStorageProfile();
  assert.equal(fullCapPlugin.settings.nativeRecordStorageAliases.length, 13);
  assert.equal(fullCapPlugin.settings.nativeRecordStorageAliases.slice(0, 12).every((profile) => (
    profile.identityMode === 'tag'
  )), true);
  assert.equal(fullCapPlugin.settings.nativeRecordStorageAliases[12].identityPropertyKey, 'pinnedLegacyId');
  assert.equal(fullCapPlugin.settings.nativeRecordStorageAliases[12].identityMode, 'property');
});

test('property writer reserves tags across every system-key repair and retains valid prior mappings for reads', () => {
  const systemKeys = [
    'identityPropertyKey',
    'schemaPropertyKey',
    'kindPropertyKey',
    'titlePropertyKey',
    'createdPropertyKey',
    'modifiedPropertyKey',
  ];
  for (const systemKey of systemKeys) {
    const configured = {
      identityMode: 'property',
      identityPropertyKey: 'tpsId',
      schemaPropertyKey: 'tpsSchemaVersion',
      identityTagPrefix: 'tps/record',
      kindPropertyKey: 'kind',
      titlePropertyKey: 'title',
      createdPropertyKey: 'createdDate',
      modifiedPropertyKey: 'modifiedDate',
      [systemKey]: 'tags',
    };
    const resolved = resolveWritableNativeRecordStorageConfiguration(configured);
    const writableKeys = [
      resolved.writeProfile.identityPropertyKey,
      resolved.writeProfile.schemaPropertyKey,
      resolved.writeProfile.kindPropertyKey,
      resolved.writeProfile.titlePropertyKey,
      resolved.writeProfile.createdPropertyKey,
      resolved.writeProfile.modifiedPropertyKey,
    ];
    assert.equal(writableKeys.some((key) => key.toLowerCase() === 'tags'), false, systemKey);
    assert.equal(new Set(writableKeys.map((key) => key.toLowerCase())).size, writableKeys.length, systemKey);
    assert.equal(resolved.requiresSettingsMigration, true, systemKey);
    assert.deepEqual(resolved.readAliases, [resolved.configuredProfile], systemKey);
  }

  const { service } = createHarness('native-records', { identityPropertyKey: 'tags' });
  assert.equal(service.inspect({
    tags: 'task-legacy-tags-property',
    tpsSchemaVersion: 1,
    kind: 'task',
    title: 'Legacy tags-key task',
  })?.id, 'task-legacy-tags-property');
});

test('even a fully collided legacy configuration writes safe properties without consuming semantic tags', async () => {
  const { service, contents } = createHarness('native-records', {
    identityPropertyKey: 'tags',
    schemaPropertyKey: 'tags',
    kindPropertyKey: 'tags',
    titlePropertyKey: 'tags',
    createdPropertyKey: 'tags',
    modifiedPropertyKey: 'tags',
  });
  const created = await service.create('food-entry', {
    title: 'Safe lunch',
    tags: ['food', 'lunch'],
  }, { id: 'food-safe' });
  const raw = parseNativeRecordDocument(contents.get(created.file)).frontmatter;
  assert.deepEqual(raw.tags, ['food', 'lunch']);
  assert.equal(raw.tpsId, 'food-safe');
  assert.equal(raw.tpsSchemaVersion, 1);
  assert.equal(raw.kind, 'food-entry');
  assert.equal(raw.title, 'Safe lunch');
});

test('only exact matched aliases own cleanup keys across create, update, and consolidation', async () => {
  const legacyPropertyProfile = {
    ...DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
    identityPropertyKey: 'legacyId',
    schemaPropertyKey: 'legacySchema',
    kindPropertyKey: 'legacyKind',
    titlePropertyKey: 'name',
    createdPropertyKey: 'legacyCreated',
    modifiedPropertyKey: 'legacyModified',
  };
  const { service, contents, indexed, addFile } = createHarness('native-records', {
    storageAliases: [legacyPropertyProfile],
  });
  const current = await service.create('task', {
    title: 'Current task',
    name: 'User-owned display name',
  }, { id: 'task-current-alias-shape' });
  assert.equal(parseNativeRecordDocument(contents.get(current.file)).frontmatter.name, 'User-owned display name');

  const updated = await service.update(current.file, { status: 'done' });
  assert.equal(updated?.frontmatter.name, 'User-owned display name');
  assert.equal(parseNativeRecordDocument(contents.get(current.file)).frontmatter.name, 'User-owned display name');

  const cleanedCreate = await service.create('task', {
    title: 'Property-only create',
    tags: ['todo', 'tps/record/v1/task/task-property-only-create'],
    legacyId: 'task-property-only-create',
    legacySchema: 1,
    legacyKind: 'task',
    name: 'Legacy alias title',
  }, { id: 'task-property-only-create' });
  const cleanedCreateRaw = parseNativeRecordDocument(contents.get(cleanedCreate.file)).frontmatter;
  assert.deepEqual(cleanedCreateRaw.tags, ['todo']);
  assert.equal(cleanedCreateRaw.tpsId, 'task-property-only-create');
  assert.deepEqual(cleanedCreate.frontmatter.tags, ['todo']);
  const cleanedCreateIndex = [...indexed].reverse().find(([file]) => file === cleanedCreate.file)?.[1];
  assert.deepEqual(cleanedCreateIndex?.tags, ['todo']);
  for (const key of ['legacyId', 'legacySchema', 'legacyKind', 'name']) {
    assert.equal(Object.hasOwn(cleanedCreateRaw, key), false, key);
    assert.equal(Object.hasOwn(cleanedCreate.frontmatter, key), false, `returned ${key}`);
    assert.equal(Object.hasOwn(cleanedCreateIndex || {}, key), false, `indexed ${key}`);
  }

  await assert.rejects(
    service.create('task', {
      title: 'Conflicting create',
      legacyId: 'task-conflicting-alias',
      legacySchema: 1,
      legacyKind: 'task',
      name: 'Conflicting alias title',
    }, { id: 'task-conflicting-writer' }),
    /conflicting or invalid storage identity evidence/u,
  );
  await assert.rejects(
    service.create('task', {
      title: 'Malformed legacy tag create',
      tags: ['todo', 'tps/record/v1/task'],
    }, { id: 'task-malformed-create' }),
    /conflicting or invalid storage identity evidence/u,
  );

  const legacy = addFile('_records/tasks/task-matched-legacy.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Legacy body', frontmatter: {
      LegacyId: 'task-matched-legacy',
      LegacySchema: 1,
      LegacyKind: 'task',
      Name: 'Matched legacy title',
      LegacyCreated: '2026-08-25T10:00:00.123Z',
      LegacyModified: '2026-08-25T10:00:00.456Z',
      producerField: 'preserve me',
    },
  }));
  const result = await service.migrateStorageProfile();
  assert.equal(result.failed, 0);
  assert.ok(result.updated >= 1);

  const currentRaw = parseNativeRecordDocument(contents.get(current.file)).frontmatter;
  assert.equal(currentRaw.name, 'User-owned display name');
  const legacyRaw = parseNativeRecordDocument(contents.get(legacy)).frontmatter;
  assert.equal(legacyRaw.tpsId, 'task-matched-legacy');
  assert.equal(legacyRaw.tpsSchemaVersion, 1);
  assert.equal(legacyRaw.kind, 'task');
  assert.equal(legacyRaw.title, 'Matched legacy title');
  assert.equal(legacyRaw.createdDate, '2026-08-25T10:00:00.123Z');
  assert.equal(legacyRaw.modifiedDate, '2026-08-25T10:00:00.456Z');
  assert.equal(legacyRaw.producerField, 'preserve me');
  for (const key of ['LegacyId', 'LegacySchema', 'LegacyKind', 'Name', 'LegacyCreated', 'LegacyModified']) {
    assert.equal(Object.hasOwn(legacyRaw, key), false, key);
  }
});

test('a valid current writer preserves dormant partial alias fields and owns timestamp precedence', async () => {
  const legacyProfile = {
    ...DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
    identityPropertyKey: 'externalId',
    schemaPropertyKey: 'externalSchema',
    kindPropertyKey: 'externalKind',
    titlePropertyKey: 'externalTitle',
    createdPropertyKey: 'legacyCreated',
    modifiedPropertyKey: 'legacyModified',
  };
  const { service, contents, addFile } = createHarness('native-records', {
    storageAliases: [legacyProfile],
  });
  const dormant = addFile('_records/tasks/task-dormant-current.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Dormant body', frontmatter: {
      tpsId: 'task-dormant-current',
      tpsSchemaVersion: 1,
      kind: 'task',
      title: 'Current identity wins',
      createdDate: '2026-08-27T10:00:00.000Z',
      modifiedDate: '2026-08-27T11:00:00.000Z',
      externalId: 'provider-user-value',
    },
  }));
  assert.equal(service.inspect(parseNativeRecordDocument(contents.get(dormant)).frontmatter)?.id, 'task-dormant-current');
  const dormantUpdated = await service.update(dormant, { status: 'done' });
  assert.equal(dormantUpdated?.frontmatter.externalId, 'provider-user-value');
  assert.equal(parseNativeRecordDocument(contents.get(dormant)).frontmatter.externalId, 'provider-user-value');

  const partiallyMigrated = addFile('_records/tasks/task-partial-timestamps.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Timestamp body', frontmatter: {
      tpsId: 'task-partial-timestamps',
      tpsSchemaVersion: 1,
      kind: 'task',
      title: 'Current timestamp title',
      createdDate: '',
      modifiedDate: '',
      externalId: 'task-partial-timestamps',
      externalSchema: 1,
      externalKind: 'task',
      externalTitle: 'Legacy timestamp title',
      legacyCreated: '2026-08-25T18:12:13.456Z',
      legacyModified: '2026-08-26T18:12:13.456Z',
    },
  }));
  const fallbackInspection = service.inspect(parseNativeRecordDocument(contents.get(partiallyMigrated)).frontmatter);
  assert.equal(fallbackInspection?.frontmatter.createdDate, '2026-08-25T18:12:13.456Z');
  assert.equal(fallbackInspection?.frontmatter.modifiedDate, '2026-08-26T18:12:13.456Z');

  const partialUpdate = addFile('_records/tasks/task-partial-timestamps-update.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Timestamp update body', frontmatter: {
      tpsId: 'task-partial-timestamps-update', tpsSchemaVersion: 1, kind: 'task', title: 'Timestamp update',
      createdDate: '', modifiedDate: '',
      externalId: 'task-partial-timestamps-update', externalSchema: 1,
      externalKind: 'task', externalTitle: 'Legacy timestamp update',
      legacyCreated: '2026-08-24T18:12:13.456Z', legacyModified: '2026-08-25T18:12:13.456Z',
    },
  }));
  const timestampUpdated = await service.update(partialUpdate, { status: 'done' });
  assert.equal(timestampUpdated?.frontmatter.createdDate, '2026-08-24T18:12:13.456Z');
  assert.equal(parseNativeRecordDocument(contents.get(partialUpdate)).frontmatter.createdDate, '2026-08-24T18:12:13.456Z');

  const authoritative = addFile('_records/tasks/task-authoritative-timestamps.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: '', frontmatter: {
      tpsId: 'task-authoritative-timestamps',
      tpsSchemaVersion: 1,
      kind: 'task',
      title: 'Authoritative timestamps',
      createdDate: '2026-08-27T08:00:00.000Z',
      modifiedDate: '2026-08-27T09:00:00.000Z',
      externalId: 'task-authoritative-timestamps',
      externalSchema: 1,
      externalKind: 'task',
      externalTitle: 'Old alias title',
      legacyCreated: '2025-01-01T00:00:00.000Z',
      legacyModified: '2025-01-02T00:00:00.000Z',
    },
  }));
  assert.equal(service.inspect(parseNativeRecordDocument(contents.get(authoritative)).frontmatter)?.frontmatter.createdDate, '2026-08-27T08:00:00.000Z');

  const result = await service.migrateStorageProfile();
  assert.equal(result.failed, 0);
  const fallbackRaw = parseNativeRecordDocument(contents.get(partiallyMigrated)).frontmatter;
  assert.equal(fallbackRaw.createdDate, '2026-08-25T18:12:13.456Z');
  assert.equal(fallbackRaw.modifiedDate, '2026-08-26T18:12:13.456Z');
  const authoritativeRaw = parseNativeRecordDocument(contents.get(authoritative)).frontmatter;
  assert.equal(authoritativeRaw.createdDate, '2026-08-27T08:00:00.000Z');
  assert.equal(authoritativeRaw.modifiedDate, '2026-08-27T09:00:00.000Z');
  assert.equal(parseNativeRecordDocument(contents.get(dormant)).frontmatter.externalId, 'provider-user-value');
});

test('missing current timestamps fail closed when agreeing identity aliases disagree on fallback values', async () => {
  const firstAlias = {
    ...DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
    identityPropertyKey: 'firstId', schemaPropertyKey: 'firstSchema',
    kindPropertyKey: 'firstKind', titlePropertyKey: 'firstTitle',
    createdPropertyKey: 'firstCreated', modifiedPropertyKey: '',
  };
  const secondAlias = {
    ...DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
    identityPropertyKey: 'secondId', schemaPropertyKey: 'secondSchema',
    kindPropertyKey: 'secondKind', titlePropertyKey: 'secondTitle',
    createdPropertyKey: 'secondCreated', modifiedPropertyKey: '',
  };
  const { service, contents, addFile } = createHarness('native-records', {
    storageAliases: [firstAlias, secondAlias],
  });
  const conflicted = addFile('_records/tasks/task-timestamp-conflict.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Timestamp conflict body', frontmatter: {
      tpsId: 'task-timestamp-conflict', tpsSchemaVersion: 1, kind: 'task', title: 'Timestamp conflict',
      createdDate: '', modifiedDate: '',
      firstId: 'task-timestamp-conflict', firstSchema: 1, firstKind: 'task', firstTitle: 'First alias',
      firstCreated: '2026-08-25T00:00:00.000Z',
      secondId: 'task-timestamp-conflict', secondSchema: 1, secondKind: 'task', secondTitle: 'Second alias',
      secondCreated: '2026-08-26T00:00:00.000Z',
    },
  }));
  const before = contents.get(conflicted);
  assert.equal(service.inspect(parseNativeRecordDocument(before).frontmatter), null);
  assert.deepEqual(await service.migrateStorageProfile(), {
    inspected: 1, updated: 0, skipped: 0, failed: 1,
  });
  assert.equal(contents.get(conflicted), before);
});

test('legacy readers with agreeing identity but different titles fail closed without a current writer', async () => {
  const firstAlias = {
    ...DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
    identityPropertyKey: 'firstId', schemaPropertyKey: 'firstSchema',
    kindPropertyKey: 'firstKind', titlePropertyKey: 'firstTitle',
    createdPropertyKey: '', modifiedPropertyKey: '',
  };
  const secondAlias = {
    ...DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
    identityPropertyKey: 'secondId', schemaPropertyKey: 'secondSchema',
    kindPropertyKey: 'secondKind', titlePropertyKey: 'secondTitle',
    createdPropertyKey: '', modifiedPropertyKey: '',
  };
  const { service, contents, addFile } = createHarness('native-records', {
    storageAliases: [firstAlias, secondAlias],
  });
  const conflicted = addFile('_records/tasks/task-title-conflict.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Title conflict body', frontmatter: {
      firstId: 'task-title-conflict', firstSchema: 1, firstKind: 'task', firstTitle: 'First title',
      secondId: 'task-title-conflict', secondSchema: 1, secondKind: 'task', secondTitle: 'Second title',
    },
  }));
  const before = contents.get(conflicted);
  assert.equal(service.inspect(parseNativeRecordDocument(before).frontmatter), null);
  assert.deepEqual(await service.migrateStorageProfile(), {
    inspected: 1, updated: 0, skipped: 0, failed: 1,
  });
  assert.equal(contents.get(conflicted), before);
});

test('legacy property identity in tags is recovered only without a valid current writer and cleans up conservatively', async () => {
  const legacyTagsIdentityProfile = {
    ...DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
    identityPropertyKey: 'tags',
    schemaPropertyKey: 'legacySchema',
    kindPropertyKey: 'legacyKind',
    titlePropertyKey: 'legacyTitle',
    createdPropertyKey: '',
    modifiedPropertyKey: '',
  };
  const ambiguousTagsTitleProfile = {
    ...DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
    identityPropertyKey: 'otherId',
    schemaPropertyKey: 'otherSchema',
    kindPropertyKey: 'otherKind',
    titlePropertyKey: 'tags',
    createdPropertyKey: '',
    modifiedPropertyKey: '',
  };
  const { service, contents, addFile } = createHarness('native-records', {
    storageAliases: [legacyTagsIdentityProfile, ambiguousTagsTitleProfile],
  });

  const current = await service.create('task', {
    title: 'Current semantic tags',
    tags: ['work', '#mobile'],
  }, { id: 'task-current-semantic-tags' });
  const currentRawBefore = parseNativeRecordDocument(contents.get(current.file)).frontmatter;
  assert.deepEqual(currentRawBefore.tags, ['work', 'mobile']);
  assert.equal(service.inspect(currentRawBefore)?.id, 'task-current-semantic-tags');
  assert.equal((await service.resolve('task-current-semantic-tags'))?.path, current.path);

  const legacyForUpdate = addFile('_records/tasks/task-tags-update.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Update body', frontmatter: {
      tags: 'task-tags-update',
      legacySchema: 1,
      legacyKind: 'task',
      legacyTitle: 'Legacy tags update',
      producerField: 'update producer',
    },
  }));
  const legacyForMigration = addFile('_records/tasks/task-tags-migration.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Migration body', frontmatter: {
      tags: 'task-tags-migration',
      legacySchema: 1,
      legacyKind: 'task',
      legacyTitle: 'Legacy tags migration',
      producerField: 'migration producer',
    },
  }));
  const ambiguous = addFile('_records/tasks/task-tags-ambiguous.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Ambiguous body', frontmatter: {
      tags: 'task-tags-ambiguous',
      legacySchema: 1,
      legacyKind: 'task',
      legacyTitle: 'Legacy tags ambiguous',
      otherId: 'task-tags-ambiguous',
      otherSchema: 1,
      otherKind: 'task',
    },
  }));
  const ambiguousBefore = contents.get(ambiguous);

  assert.equal(service.inspect(parseNativeRecordDocument(contents.get(legacyForUpdate)).frontmatter)?.id, 'task-tags-update');
  const updated = await service.update(legacyForUpdate, { status: 'done' });
  assert.equal(updated?.id, 'task-tags-update');
  const updatedRaw = parseNativeRecordDocument(contents.get(legacyForUpdate)).frontmatter;
  assert.equal(updatedRaw.tpsId, 'task-tags-update');
  assert.equal(updatedRaw.status, 'done');
  assert.equal(updatedRaw.producerField, 'update producer');
  for (const key of ['tags', 'legacySchema', 'legacyKind', 'legacyTitle']) {
    assert.equal(Object.hasOwn(updatedRaw, key), false, key);
  }

  assert.equal(service.inspect(parseNativeRecordDocument(ambiguousBefore).frontmatter), null);
  assert.equal(await service.update(ambiguous, { status: 'done' }), null);
  assert.equal(contents.get(ambiguous), ambiguousBefore);

  const result = await service.migrateStorageProfile();
  assert.equal(result.failed, 1);
  const migratedRaw = parseNativeRecordDocument(contents.get(legacyForMigration)).frontmatter;
  assert.equal(migratedRaw.tpsId, 'task-tags-migration');
  assert.equal(migratedRaw.producerField, 'migration producer');
  for (const key of ['tags', 'legacySchema', 'legacyKind', 'legacyTitle']) {
    assert.equal(Object.hasOwn(migratedRaw, key), false, key);
  }
  assert.deepEqual(parseNativeRecordDocument(contents.get(current.file)).frontmatter.tags, ['work', 'mobile']);
  assert.equal(contents.get(ambiguous), ambiguousBefore);
});

test('built-in legacy tps/record tags remain readable without a persisted alias', async () => {
  const { service, contents, addFile } = createHarness('native-records', {
    identityMode: 'property',
    identityPropertyKey: 'itemId',
    schemaPropertyKey: 'itemSchema',
    kindPropertyKey: 'recordType',
    titlePropertyKey: 'name',
  });
  const legacy = addFile('_records/tasks/legacy-task.md', serializeNativeRecordDocument({
    bom: '',
    newline: '\n',
    closer: '---',
    body: '',
    frontmatter: {
      tags: ['todo', 'tps/record/v1/task/task-legacy'],
      kind: 'task',
      title: 'Legacy task',
    },
  }));
  const inspection = service.inspect(parseNativeRecordDocument(contents.get(legacy))?.frontmatter);
  assert.equal(inspection?.id, 'task-legacy');
  assert.equal(inspection?.profile.identityMode, 'tag');
  assert.equal(inspection?.profile.identityTagPrefix, 'tps/record');
  assert.equal((await service.resolve('task-legacy'))?.path, legacy.path);
});

test('legacy tag prefixes dedupe and reconcile case-insensitively end to end', async () => {
  const upperProfile = {
    ...DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE,
    identityTagPrefix: 'Legacy/Items',
  };
  const lowerProfile = {
    ...upperProfile,
    identityTagPrefix: 'legacy/items',
  };
  const resolved = resolveWritableNativeRecordStorageConfiguration(
    DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
    [upperProfile, lowerProfile],
  );
  assert.equal(resolved.readAliases.length, 1);

  const { service, contents, addFile } = createHarness('native-records', {
    storageAliases: [upperProfile, lowerProfile],
  });
  const created = await service.create('task', {
    title: 'Casefolded prefix create',
    tags: ['todo', 'legacy/items/v1/task/task-prefix-create'],
  }, { id: 'task-prefix-create' });
  assert.deepEqual(parseNativeRecordDocument(contents.get(created.file)).frontmatter.tags, ['todo']);

  const legacy = addFile('_records/tasks/task-prefix-legacy.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Prefix body', frontmatter: {
      kind: 'task', title: 'Casefolded prefix legacy',
      tags: ['todo', 'legacy/items/v1/task/task-prefix-legacy'],
    },
  }));
  assert.equal(service.inspect(parseNativeRecordDocument(contents.get(legacy)).frontmatter)?.id, 'task-prefix-legacy');
  const result = await service.migrateStorageProfile();
  assert.equal(result.failed, 0);
  const raw = parseNativeRecordDocument(contents.get(legacy)).frontmatter;
  assert.equal(raw.tpsId, 'task-prefix-legacy');
  assert.deepEqual(raw.tags, ['todo']);
});

test('property records reconcile every recognized reserved tag independently of legacy title mappings', async () => {
  const customTagProfile = {
    ...DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE,
    identityTagPrefix: 'legacy/custom-items',
    kindPropertyKey: 'legacyKind',
    titlePropertyKey: 'legacyName',
  };
  const { service, contents, indexed, addFile } = createHarness('native-records', {
    identityPropertyKey: 'itemId',
    schemaPropertyKey: 'itemSchema',
    kindPropertyKey: 'recordType',
    titlePropertyKey: 'name',
    storageAliases: [customTagProfile],
  });

  const created = await service.create('task', {
    title: 'Strict property create',
    tags: ['todo', 'tps/record/v1/task/task-strict-create'],
  }, { id: 'task-strict-create' });
  assert.deepEqual(parseNativeRecordDocument(contents.get(created.file)).frontmatter.tags, ['todo']);
  assert.deepEqual(created.frontmatter.tags, ['todo']);
  assert.deepEqual(indexed.at(-1)?.[1].tags, ['todo']);

  for (const reservedTag of [
    'tps/record/v1/calendar-event/task-wrong-kind',
    'legacy/custom-items/v1/task/task-wrong-id-shadow',
  ]) {
    await assert.rejects(service.create('task', {
      title: 'Rejected reserved tag',
      tags: ['todo', reservedTag],
    }, { id: reservedTag.includes('wrong-kind') ? 'task-wrong-kind' : 'task-wrong-id' }), /conflicting or invalid storage identity evidence/u);
  }

  const clean = await service.create('task', {
    title: 'Post-update reconciliation',
    tags: ['todo'],
  }, { id: 'task-post-update-tags' });
  const builtInUpdated = await service.update(clean.file, {
    tags: ['todo', 'tps/record/v1/task/task-post-update-tags'],
  });
  assert.deepEqual(builtInUpdated?.frontmatter.tags, ['todo']);
  assert.deepEqual(parseNativeRecordDocument(contents.get(clean.file)).frontmatter.tags, ['todo']);
  const customUpdated = await service.update(clean.file, {
    tags: ['todo', 'legacy/custom-items/v1/task/task-post-update-tags'],
  });
  assert.deepEqual(customUpdated?.frontmatter.tags, ['todo']);
  assert.deepEqual(parseNativeRecordDocument(contents.get(clean.file)).frontmatter.tags, ['todo']);
  const beforeConflict = contents.get(clean.file);
  assert.equal(await service.update(clean.file, {
    tags: ['todo', 'tps/record/v1/food-entry/task-post-update-tags'],
  }), null);
  assert.equal(contents.get(clean.file), beforeConflict);

  const migratable = addFile('_records/tasks/task-strict-migrate.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Strict body', frontmatter: {
      itemId: 'task-strict-migrate',
      itemSchema: 1,
      recordType: 'task',
      name: 'Strict migration',
      tags: ['todo', 'legacy/custom-items/v1/task/task-strict-migrate'],
    },
  }));
  const wrongKind = addFile('_records/tasks/task-strict-wrong-kind.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: '', frontmatter: {
      itemId: 'task-strict-wrong-kind',
      itemSchema: 1,
      recordType: 'task',
      name: 'Wrong-kind migration',
      tags: ['todo', 'legacy/custom-items/v1/calendar-event/task-strict-wrong-kind'],
    },
  }));
  const wrongKindBefore = contents.get(wrongKind);
  const result = await service.migrateStorageProfile();
  assert.equal(result.failed, 1);
  assert.deepEqual(parseNativeRecordDocument(contents.get(migratable)).frontmatter.tags, ['todo']);
  assert.equal(contents.get(wrongKind), wrongKindBefore);
});

test('conflicting property and legacy-tag identities fail closed', () => {
  const { service } = createHarness();
  assert.equal(service.inspect({
    tpsId: 'task-property',
    tpsSchemaVersion: 1,
    kind: 'task',
    title: 'Conflicted task',
    tags: ['todo', 'tps/record/v1/task/task-tag'],
  }), null);
});

test('legacy hex tag IDs keep canonical UTF-8 compatibility and property identity disambiguates raw literals', async () => {
  const { service, contents, addFile } = createHarness();
  const legacyUnsafe = addFile('_records/food-entries/legacy-unsafe-id.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: '', frontmatter: {
      kind: 'food-entry',
      title: 'Old writer unsafe ID',
      tags: ['food', 'tps/record/v1/food-entry/hex-666f6f643a6f6e65'],
    },
  }));
  assert.equal(service.inspect(parseNativeRecordDocument(contents.get(legacyUnsafe)).frontmatter)?.id, 'food:one');

  const literalHex = addFile('_records/tasks/literal-hex-id.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: '', frontmatter: {
      tpsId: 'hex-3a', tpsSchemaVersion: 1, kind: 'task', title: 'Literal hex ID',
      tags: ['todo', 'tps/record/v1/task/hex-3a'],
    },
  }));
  const decodedHex = addFile('_records/tasks/decoded-hex-id.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: '', frontmatter: {
      tpsId: ':', tpsSchemaVersion: 1, kind: 'task', title: 'Decoded hex ID',
      tags: ['todo', 'tps/record/v1/task/hex-3a'],
    },
  }));
  const literalLetters = addFile('_records/tasks/literal-hex-letters.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: '', frontmatter: {
      tpsId: 'hex-4142', tpsSchemaVersion: 1, kind: 'task', title: 'Literal hex letters',
      tags: ['todo', 'tps/record/v1/task/hex-4142'],
    },
  }));
  assert.equal(service.inspect(parseNativeRecordDocument(contents.get(literalHex)).frontmatter)?.id, 'hex-3a');
  assert.equal(service.inspect(parseNativeRecordDocument(contents.get(decodedHex)).frontmatter)?.id, ':');
  assert.equal(service.inspect(parseNativeRecordDocument(contents.get(literalLetters)).frontmatter)?.id, 'hex-4142');

  const result = await service.migrateStorageProfile();
  assert.equal(result.failed, 0);
  assert.equal(parseNativeRecordDocument(contents.get(legacyUnsafe)).frontmatter.tpsId, 'food:one');
  for (const [file, expectedId] of [
    [literalHex, 'hex-3a'],
    [decodedHex, ':'],
    [literalLetters, 'hex-4142'],
  ]) {
    const raw = parseNativeRecordDocument(contents.get(file)).frontmatter;
    assert.equal(raw.tpsId, expectedId);
    assert.deepEqual(raw.tags, ['todo']);
  }

  const invalidHarness = createHarness();
  const invalid = invalidHarness.addFile('_records/tasks/invalid-utf8-hex.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Invalid body', frontmatter: {
      kind: 'task', title: 'Invalid UTF-8', tags: ['todo', 'tps/record/v1/task/hex-ff'],
    },
  }));
  const invalidBefore = invalidHarness.contents.get(invalid);
  assert.equal(invalidHarness.service.inspect(parseNativeRecordDocument(invalidBefore).frontmatter), null);
  assert.deepEqual(await invalidHarness.service.migrateStorageProfile(), {
    inspected: 1, updated: 0, skipped: 0, failed: 1,
  });
  assert.equal(invalidHarness.contents.get(invalid), invalidBefore);
});

test('readable storage fields and tag evidence are case-insensitive without losing timestamps', () => {
  const { service } = createHarness();
  const mixedCase = {
    TPSID: 'task-case-a',
    TPSSchemaVersion: 1,
    Kind: 'task',
    Title: 'Mixed-case task',
    CreatedDate: new Date('2026-08-25T10:11:12.123Z'),
    ModifiedDate: '2026-08-25T10:11:13.456Z',
  };
  const inspection = service.inspect(mixedCase);
  assert.equal(inspection?.id, 'task-case-a');
  assert.equal(inspection?.frontmatter.title, 'Mixed-case task');
  assert.equal(inspection?.frontmatter.createdDate, '2026-08-25T10:11:12.123Z');
  assert.equal(inspection?.frontmatter.modifiedDate, '2026-08-25T10:11:13.456Z');

  assert.equal(service.inspect({
    ...mixedCase,
    Tags: ['todo', 'tps/record/v1/task/task-case-b'],
  }), null, 'case-variant property identity conflicts with a case-variant legacy tag');
  assert.equal(service.inspect({
    ...mixedCase,
    Tags: ['todo', 'tps/record/v1/task'],
  }), null, 'malformed reserved evidence cannot hide behind a case-variant tags key');
});

test('partial or invalid property identity cannot be masked by a valid legacy tag', async () => {
  const { service, contents, events, indexed, addFile } = createHarness();
  const partial = addFile('_records/tasks/task-partial-property.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Partial body', frontmatter: {
      tpsId: 'task-property-a',
      kind: 'task',
      title: 'Partial property marker',
      tags: ['todo', 'tps/record/v1/task/task-tag-b'],
    },
  }));
  const invalidSchema = addFile('_records/tasks/task-invalid-schema.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Schema body', frontmatter: {
      tpsId: 'task-property-c',
      tpsSchemaVersion: 2,
      kind: 'task',
      title: 'Invalid schema marker',
      tags: ['todo', 'tps/record/v1/task/task-tag-d'],
    },
  }));
  const beforePartial = contents.get(partial);
  const beforeInvalidSchema = contents.get(invalidSchema);

  assert.equal(service.inspect(parseNativeRecordDocument(beforePartial).frontmatter), null);
  assert.equal(service.inspect(parseNativeRecordDocument(beforeInvalidSchema).frontmatter), null);
  assert.equal(await service.update(partial, { status: 'done' }), null);
  assert.equal(contents.get(partial), beforePartial);
  assert.equal(events.length, 0);
  assert.equal(indexed.length, 0);

  const result = await service.migrateStorageProfile();
  assert.deepEqual(result, { inspected: 2, updated: 0, skipped: 0, failed: 2 });
  assert.equal(contents.get(partial), beforePartial);
  assert.equal(contents.get(invalidSchema), beforeInvalidSchema);
});

test('tag-profile identity property names remain dormant while valid property aliases explain shared markers', () => {
  const dormantTagProfile = {
    ...DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE,
    identityPropertyKey: 'externalId',
    schemaPropertyKey: 'externalVersion',
    identityTagPrefix: 'legacy/dormant',
  };
  const { service: tagService } = createHarness('native-records', {
    storageAliases: [dormantTagProfile],
  });
  assert.equal(tagService.inspect({
    externalId: 'provider-owned-value',
    kind: 'task',
    title: 'Dormant tag fields',
    tags: ['todo', 'legacy/dormant/v1/task/task-dormant'],
  })?.id, 'task-dormant');

  const { service: propertyService } = createHarness('native-records', {
    identityPropertyKey: 'tpsId',
    schemaPropertyKey: 'customSchema',
  });
  assert.equal(propertyService.inspect({
    tpsId: 'task-shared-marker',
    customSchema: 1,
    kind: 'task',
    title: 'Shared marker',
  })?.id, 'task-shared-marker');
});

test('case-variant duplicate storage keys block inspect, update, and consolidation without changing bytes', async () => {
  const { service, contents, events, indexed, addFile } = createHarness();
  const duplicate = addFile('_records/tasks/task-case-duplicate.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Duplicate body', frontmatter: {
      tpsId: 'task-case-duplicate',
      TPSID: 'task-shadow',
      tpsSchemaVersion: 1,
      kind: 'task',
      title: 'Case duplicate',
      tags: ['todo'],
    },
  }));
  const before = contents.get(duplicate);

  assert.equal(service.inspect(parseNativeRecordDocument(before).frontmatter), null);
  assert.equal(await service.update(duplicate, { status: 'done' }), null);
  assert.equal(contents.get(duplicate), before);
  assert.equal(events.length, 0);
  assert.equal(indexed.length, 0);
  const result = await service.migrateStorageProfile();
  assert.deepEqual(result, { inspected: 1, updated: 0, skipped: 0, failed: 1 });
  assert.equal(contents.get(duplicate), before);
});

test('valid property identity cannot mask malformed or multiple reserved legacy tag evidence', async () => {
  const customLegacyProfile = {
    ...DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE,
    identityTagPrefix: 'legacy/custom',
  };
  const { service, contents, addFile } = createHarness('native-records', {
    storageAliases: [customLegacyProfile],
  });
  const malformed = addFile('_records/tasks/task-malformed.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: '', frontmatter: {
      tpsId: 'task-malformed',
      tpsSchemaVersion: 1,
      kind: 'task',
      title: 'Malformed evidence',
      tags: ['todo', 'tps/record/v1/task'],
    },
  }));
  const multiple = addFile('_records/tasks/task-multiple.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: '', frontmatter: {
      tpsId: 'task-multiple',
      tpsSchemaVersion: 1,
      kind: 'task',
      title: 'Multiple evidence',
      tags: [
        'todo',
        'legacy/custom/v1/task/task-multiple',
        'legacy/custom/v1/task/task-shadow',
      ],
    },
  }));
  const beforeMalformed = contents.get(malformed);
  const beforeMultiple = contents.get(multiple);

  assert.equal(service.inspect(parseNativeRecordDocument(beforeMalformed).frontmatter), null);
  assert.equal(service.inspect(parseNativeRecordDocument(beforeMultiple).frontmatter), null);
  const result = await service.migrateStorageProfile();
  assert.deepEqual(result, { inspected: 2, updated: 0, skipped: 0, failed: 2 });
  assert.equal(contents.get(malformed), beforeMalformed);
  assert.equal(contents.get(multiple), beforeMultiple);
});

test('blocked identity evidence reserves recoverable IDs and poisons global ownership for every reference shape', async () => {
  const { service, vault, contents, events, addFile } = createHarness();
  const valid = addFile('_records/tasks/task-union-valid.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Valid body', frontmatter: {
      tpsId: 'task-union-owner', tpsSchemaVersion: 1, kind: 'task', title: 'Valid union owner',
    },
  }));
  const blocked = addFile('_records/tasks/task-union-blocked.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Blocked body', frontmatter: {
      tpsId: 'task-union-owner', tpsSchemaVersion: 1, kind: 'task', title: 'Blocked union owner',
      tags: ['todo', 'tps/record/v1/calendar-event/task-union-owner'],
    },
  }));
  const validBefore = contents.get(valid);
  const blockedBefore = contents.get(blocked);

  assert.equal(await service.resolve('task-union-owner'), null);
  assert.equal(await service.resolve(valid), null);
  assert.equal(await service.resolve({ path: valid.path }), null);
  assert.equal(await service.update(valid, { status: 'done' }), null);
  assert.equal(await service.rename(valid, 'Forbidden union rename'), null);
  await assert.rejects(
    service.create('task', { title: 'Forbidden union create' }, { id: 'TASK-UNION-OWNER' }),
    /native record ID already exists/u,
  );
  assert.deepEqual(await service.migrateStorageProfile(), {
    inspected: 2, updated: 0, skipped: 0, failed: 2,
  });
  assert.equal(contents.get(valid), validBefore);
  assert.equal(contents.get(blocked), blockedBefore);
  assert.equal(vault.getMarkdownFiles().length, 2);
  assert.equal(events.length, 0);
});

test('incomplete and malformed record markers are migration failures even without a complete envelope', async () => {
  const { service, vault, contents, addFile } = createHarness();
  const incomplete = addFile('_records/tasks/incomplete-tag-evidence.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Incomplete body', frontmatter: {
      tags: ['todo', 'tps/record/v1/task/task-incomplete-evidence'],
    },
  }));
  const malformed = addFile('_records/tasks/malformed-tag-evidence.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Malformed body', frontmatter: {
      tags: ['todo', 'tps/record/v1/task'],
    },
  }));
  const schemaOnly = addFile('_records/tasks/schema-only-evidence.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Schema body', frontmatter: {
      tpsSchemaVersion: 1,
    },
  }));
  const snapshots = new Map([incomplete, malformed, schemaOnly].map((file) => [file, contents.get(file)]));

  await assert.rejects(
    service.create('task', { title: 'Forbidden incomplete reuse' }, { id: 'TASK-INCOMPLETE-EVIDENCE' }),
    /native record ID already exists/u,
  );
  assert.deepEqual(await service.migrateStorageProfile(), {
    inspected: 3, updated: 0, skipped: 0, failed: 3,
  });
  for (const [file, before] of snapshots) assert.equal(contents.get(file), before);
  assert.equal(vault.getMarkdownFiles().length, 3);
});

test('conflicting full property readers block every recoverable ID instead of disappearing from migration', async () => {
  const legacyProfile = {
    ...DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
    identityPropertyKey: 'legacyId',
    schemaPropertyKey: 'legacySchema',
    kindPropertyKey: 'legacyKind',
    titlePropertyKey: 'legacyTitle',
    createdPropertyKey: '',
    modifiedPropertyKey: '',
  };
  const { service, contents, addFile } = createHarness('native-records', {
    storageAliases: [legacyProfile],
  });
  const conflicted = addFile('_records/tasks/conflicting-property-readers.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Conflict body', frontmatter: {
      tpsId: 'task-current-conflict', tpsSchemaVersion: 1, kind: 'task', title: 'Current conflict',
      legacyId: 'calendar-legacy-conflict', legacySchema: 1,
      legacyKind: 'calendar-event', legacyTitle: 'Legacy conflict',
    },
  }));
  const before = contents.get(conflicted);
  assert.equal(service.inspect(parseNativeRecordDocument(before).frontmatter), null);
  for (const [kind, id] of [
    ['task', 'TASK-CURRENT-CONFLICT'],
    ['calendar-event', 'CALENDAR-LEGACY-CONFLICT'],
  ]) {
    await assert.rejects(
      service.create(kind, { title: 'Forbidden conflict reuse' }, { id }),
      /native record ID already exists/u,
    );
  }
  assert.deepEqual(await service.migrateStorageProfile(), {
    inspected: 1, updated: 0, skipped: 0, failed: 1,
  });
  assert.equal(contents.get(conflicted), before);
});

test('storage consolidation refuses every path that shares a global stable ID', async () => {
  const legacyProfile = {
    ...DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE,
    identityTagPrefix: 'legacy/items',
  };
  const { service, contents, addFile } = createHarness('native-records', {
    storageAliases: [legacyProfile],
  });
  const first = addFile('_records/tasks/duplicate-one.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'First body', frontmatter: {
      kind: 'task',
      title: 'Duplicate one',
      tags: ['todo', 'legacy/items/v1/task/task-duplicate'],
    },
  }));
  const second = addFile('_records/tasks/duplicate-two.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Second body', frontmatter: {
      kind: 'task',
      title: 'Duplicate two',
      tags: ['todo', 'legacy/items/v1/task/task-duplicate'],
    },
  }));
  const beforeFirst = contents.get(first);
  const beforeSecond = contents.get(second);

  const result = await service.migrateStorageProfile();
  assert.deepEqual(result, { inspected: 2, updated: 0, skipped: 0, failed: 2 });
  assert.equal(contents.get(first), beforeFirst);
  assert.equal(contents.get(second), beforeSecond);
});

test('explicit create refuses an ID already owned by multiple paths instead of creating a third record', async () => {
  const { service, vault, addFile } = createHarness();
  for (const [path, title] of [
    ['_records/tasks/duplicate-create-one.md', 'Duplicate create one'],
    ['_records/tasks/duplicate-create-two.md', 'Duplicate create two'],
  ]) {
    addFile(path, serializeNativeRecordDocument({
      bom: '', newline: '\n', closer: '---', body: '', frontmatter: {
        tpsId: 'task-duplicate-create',
        tpsSchemaVersion: 1,
        kind: 'task',
        title,
      },
    }));
  }
  assert.equal(vault.getMarkdownFiles().length, 2);
  await assert.rejects(
    service.create('task', { title: 'Forbidden third record' }, { id: 'TASK-DUPLICATE-CREATE' }),
    /native record ID already exists: TASK-DUPLICATE-CREATE/u,
  );
  assert.equal(vault.getMarkdownFiles().length, 2);
  assert.equal(vault.getFileByPath('_records/tasks/TASK-DUPLICATE-CREATE.md'), null);
});

test('casefolded in-flight create reservations allow exactly one concurrent explicit ID owner', async () => {
  const { service, vault, contents } = createHarness();
  const results = await Promise.allSettled([
    service.create('task', { title: 'Concurrent one' }, {
      id: 'task-concurrent-create',
      fileName: 'Concurrent one',
    }),
    service.create('task', { title: 'Concurrent two' }, {
      id: 'TASK-CONCURRENT-CREATE',
      fileName: 'Concurrent two',
    }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.match(
    String(results.find((result) => result.status === 'rejected')?.reason || ''),
    /ID creation is already in progress/u,
  );
  const owners = vault.getMarkdownFiles().filter((file) => {
    const raw = parseNativeRecordDocument(contents.get(file));
    return service.inspect(raw?.frontmatter)?.id.toLowerCase() === 'task-concurrent-create';
  });
  assert.equal(owners.length, 1);
});

test('rename refuses a direct path when its stable ID has multiple owners', async () => {
  const { service, contents, entries, events, addFile } = createHarness();
  const first = addFile('_records/tasks/rename-duplicate-one.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'First rename body', frontmatter: {
      tpsId: 'task-rename-duplicate', tpsSchemaVersion: 1, kind: 'task', title: 'Rename one',
    },
  }));
  const second = addFile('_records/tasks/rename-duplicate-two.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Second rename body', frontmatter: {
      tpsId: 'task-rename-duplicate', tpsSchemaVersion: 1, kind: 'task', title: 'Rename two',
    },
  }));
  const firstBefore = contents.get(first);
  const secondBefore = contents.get(second);
  assert.equal(await service.rename(first, 'Forbidden rename'), null);
  assert.equal(first.path, '_records/tasks/rename-duplicate-one.md');
  assert.equal(second.path, '_records/tasks/rename-duplicate-two.md');
  assert.equal(entries.get(first.path), first);
  assert.equal(entries.get(second.path), second);
  assert.equal(contents.get(first), firstBefore);
  assert.equal(contents.get(second), secondBefore);
  assert.equal(events.length, 0);
});

test('storage migration removes only legacy identity tags and keeps aliases for late Sync arrivals', async () => {
  const legacyProfile = {
    ...DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE,
    identityPropertyKey: 'externalId',
    schemaPropertyKey: 'externalVersion',
    identityTagPrefix: 'tishos/item',
    kindPropertyKey: 'recordType',
    titlePropertyKey: 'name',
    createdPropertyKey: '',
    modifiedPropertyKey: '',
  };
  const { service, plugin, contents, addFile } = createHarness('native-records', {
    storageAliases: [legacyProfile],
  });
  const created = addFile('_records/calendar-events/calendar-event-1.md', serializeNativeRecordDocument({
    bom: '\uFEFF',
    newline: '\r\n',
    closer: '...',
    body: 'Human-authored body\r\n',
    frontmatter: {
      recordType: 'calendar-event',
      name: 'Migration event',
      tags: ['calendar', 'important', 'tishos/item/v1/calendar-event/calendar-event-1'],
      scheduled: '2026-08-25T14:00:00.000Z',
      customProperty: { preserved: true },
      externalId: 'calendar-provider-owned',
      externalVersion: 7,
    },
  }));
  const result = await service.migrateStorageProfile();
  assert.deepEqual(result, { inspected: 1, updated: 1, skipped: 0, failed: 0 });
  const migrated = parseNativeRecordDocument(contents.get(created));
  const raw = migrated.frontmatter;
  assert.equal(raw.tpsId, 'calendar-event-1');
  assert.equal(raw.tpsSchemaVersion, 1);
  assert.equal(raw.kind, 'calendar-event');
  assert.equal(raw.title, 'Migration event');
  assert.deepEqual(raw.tags, ['calendar', 'important']);
  assert.equal(raw.scheduled, '2026-08-25T14:00:00.000Z');
  assert.deepEqual(raw.customProperty, { preserved: true });
  assert.equal(raw.externalId, 'calendar-provider-owned');
  assert.equal(raw.externalVersion, 7);
  assert.equal(Object.hasOwn(raw, 'recordType'), false);
  assert.equal(Object.hasOwn(raw, 'name'), false);
  assert.equal(migrated.bom, '\uFEFF');
  assert.equal(migrated.newline, '\r\n');
  assert.equal(migrated.closer, '...');
  assert.equal(migrated.body, 'Human-authored body\r\n');
  assert.equal((await service.resolve('calendar-event-1'))?.kind, 'calendar-event');
  assert.deepEqual(plugin.settings.nativeRecordStorageAliases, [legacyProfile]);

  const late = addFile('_records/calendar-events/calendar-event-late.md', serializeNativeRecordDocument({
    bom: '',
    newline: '\n',
    closer: '---',
    body: '',
    frontmatter: {
      recordType: 'calendar-event',
      name: 'Late arrival',
      tags: ['calendar', 'tishos/item/v1/calendar-event/calendar-event-late'],
    },
  }));
  assert.equal((await service.resolve('calendar-event-late'))?.path, late.path);
});

test('updating a legacy tag record adopts property identity without reserializing unrelated source', async () => {
  const { service, plugin, contents, events, indexed, addFile } = createHarness();
  const original = [
    '\uFEFF---\r\n',
    'title: "Legacy source task"\r\n',
    '# producer-owned bytes remain in this exact location\r\n',
    'producerField: "Keep: exact spelling"\r\n',
    'scheduled: 2026-09-01T14:30:00Z\r\n',
    'tags:\r\n',
    '  - todo\r\n',
    '  - important\r\n',
    '  - tps/record/v1/task/task-source-preserved\r\n',
    'kind: task\r\n',
    '---\r\n',
    'Body with --- and title: text stays byte-for-byte.\r\n',
  ].join('');
  const legacy = addFile('_records/tasks/task-source-preserved.md', original);
  const helperCalls = [];
  const sourcePreservingWriter = plugin.frontmatterMutationService.processOwnedKeysPreservingSource
    .bind(plugin.frontmatterMutationService);
  plugin.frontmatterMutationService.processOwnedKeysPreservingSource = async (...args) => {
    helperCalls.push({ ownedKeys: [...args[1]], cause: args[3], options: args[4] });
    return sourcePreservingWriter(...args);
  };

  const updated = await service.update(legacy, {
    title: 'Updated source task',
    status: 'done',
  }, { kind: 'user', surface: 'native-record-source-preservation-test' });
  const output = contents.get(legacy);
  const stripOwnedSource = (source) => source
    .replace(/^title:[^\r\n]*(?:\r?\n)/gmu, '')
    .replace(/^tags:(?:\r?\n)(?:[ \t]+-[^\r\n]*(?:\r?\n))*/gmu, '')
    .replace(/^(?:tpsId|tpsSchemaVersion|createdDate|modifiedDate|status):[^\r\n]*(?:\r?\n)/gmu, '');

  assert.equal(updated?.id, 'task-source-preserved');
  assert.equal(updated?.frontmatter.title, 'Updated source task');
  assert.deepEqual(updated?.frontmatter.tags, ['todo', 'important']);
  assert.equal(stripOwnedSource(output), stripOwnedSource(original));
  assert.match(output, /^tpsId: task-source-preserved\r$/mu);
  assert.match(output, /^tpsSchemaVersion: 1\r$/mu);
  assert.match(output, /^title: Updated source task\r$/mu);
  assert.match(output, /^status: done\r$/mu);
  assert.match(output, /^  - todo\r$/mu);
  assert.match(output, /^  - important\r$/mu);
  assert.doesNotMatch(output, /tps\/record\/v1\/task\/task-source-preserved/u);
  assert.ok(output.endsWith('Body with --- and title: text stays byte-for-byte.\r\n'));
  assert.equal(helperCalls.length, 1);
  assert.ok(helperCalls[0].ownedKeys.includes('tags'));
  assert.ok(helperCalls[0].ownedKeys.includes('tpsId'));
  assert.ok(helperCalls[0].ownedKeys.includes('status'));
  assert.deepEqual(helperCalls[0].options, { emitEvents: false, updateEntityIndex: false });
  assert.equal(indexed.length, 1, 'only NativeRecordService owns the final index update');
  assert.equal(events.filter((event) => event.type === 'files').length, 1);
  assert.equal(events.filter((event) => event.type === 'explicit').length, 1);
});

test('invalid detached update candidates cannot change bytes, timestamps, events, or indexes', async () => {
  const { service, contents, events, indexed } = createHarness();
  const created = await service.create('task', {
    title: 'Valid task',
    status: 'todo',
    tags: ['todo'],
  }, {
    id: 'task-invalid-candidate',
    now: new Date('2026-08-27T12:00:00.000Z'),
  });
  events.length = 0;
  indexed.length = 0;
  const before = contents.get(created.file);

  const emptyTitle = await service.update(created.file, { title: '   ' });
  assert.equal(emptyTitle, null);
  assert.equal(contents.get(created.file), before);
  assert.equal(events.length, 0);
  assert.equal(indexed.length, 0);

  const malformedIdentityEvidence = await service.update(created.file, {
    tags: ['todo', 'tps/record/v1/task'],
  });
  assert.equal(malformedIdentityEvidence, null);
  assert.equal(contents.get(created.file), before);
  assert.equal(events.length, 0);
  assert.equal(indexed.length, 0);
  const raw = parseNativeRecordDocument(contents.get(created.file)).frontmatter;
  assert.equal(raw.modifiedDate, '2026-08-27T12:00:00.000Z');
  assert.equal(raw.title, 'Valid task');
  assert.deepEqual(raw.tags, ['todo']);
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
  assert.match(String(contents.get(created.file)), /^tpsId: food-1$/mu);

  const assetSource = addFile('Documents/spec.pdf', '%PDF-test');
  const asset = await service.createAsset(assetSource, { title: 'Spec' }, { id: 'asset-1' });
  assert.equal(asset.path, '_records/assets/asset-1.md');
  assert.equal(asset.frontmatter.sourcePath, 'Documents/spec.pdf');
  assert.equal((await service.ensureAsset(assetSource)).id, 'asset-1');
  assert.equal(service.resolveAssetCached(assetSource)?.id, 'asset-1');
  assert.equal((await service.resolveAsset(assetSource))?.id, 'asset-1');
  assert.ok(events.some((event) => event.type === 'explicit'));
});

test('native record callers can choose readable filenames without changing stable identity', async () => {
  const { service, addFile } = createHarness('native-records', { root: '/', layout: 'flat-root' });
  addFile('2026-08-25 - Standup.md', 'ordinary note');
  const created = await service.create('calendar-event', {
    title: 'Standup',
    scheduled: '2026-08-25T09:00:00.000Z',
  }, { id: 'calendar-event-1', fileName: '2026-08-25 - Standup' });
  assert.equal(created.path, '2026-08-25 - Standup (2).md');
  assert.equal(created.id, 'calendar-event-1');

  const renamed = await service.rename(created.file, '2026-08-26 - Standup');
  assert.equal(renamed?.path, '2026-08-26 - Standup.md');
  assert.equal(renamed?.id, 'calendar-event-1');
  assert.equal((await service.resolve('calendar-event-1'))?.path, '2026-08-26 - Standup.md');
});

test('a new empty task draft created by core Bases is adopted into the canonical native task folder', async () => {
  const { service, vault, entries, contents, events } = createHarness('native-records', {
    storageAliases: [{
      ...DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
      identityPropertyKey: 'legacyId',
      schemaPropertyKey: 'legacySchema',
      titlePropertyKey: 'name',
    }],
  });
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
      name: 'Draft producer name',
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
  assert.equal(parsed?.frontmatter.name, 'Draft producer name');
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

test('native record identity remains resolvable after a user or plugin rename', async () => {
  const { service, vault, entries } = createHarness();
  const created = await service.create('calendar-event', {
    title: 'Renamed event',
    scheduled: '2026-08-25T09:00:00.000Z',
  }, { id: 'calendar-event-1' });

  await vault.rename(created.file, '_records/calendar-events/2026-08-25 Renamed event.md');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(created.file.path, '_records/calendar-events/2026-08-25 Renamed event.md');
  assert.equal(entries.get(created.file.path), created.file);
  assert.equal(await service.resolve('calendar-event-1').then((record) => record?.path), created.file.path);
});

test('native record rename remains indexed before MetadataCache is ready', async () => {
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

  assert.equal(record.path, '_records/calendar-events/2026-08-25 Cold cache event.md');
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
  assert.equal(Object.hasOwn(result.record?.frontmatter || {}, 'sourceTaskId'), false, 'tpsId is the only task-record identity');
  assert.equal(contents.get(source), '# Inbox\n- [[_records/tasks/task-123|Ship release]]\n  - supporting note\n');
  assert.equal((await service.resolve('task-123'))?.path, result.record?.path);
});

test('task identity normalization removes only a matching legacy sourceTaskId alias', async () => {
  const { service } = createHarness();
  const matching = await service.create('task', { title: 'Matching', sourceTaskId: 'task-one' }, { id: 'task-one' });
  const conflicting = await service.create('task', { title: 'Conflicting', sourceTaskId: 'old-inline-id' }, { id: 'task-two' });
  const result = await service.normalizeTaskRecordIdentities();
  assert.deepEqual(result, { inspected: 2, updated: 1, skipped: 1 });
  assert.equal(Object.hasOwn((await service.resolve(matching.file)).frontmatter, 'sourceTaskId'), false);
  assert.equal((await service.resolve(conflicting.file)).frontmatter.sourceTaskId, 'old-inline-id', 'conflicting history fails closed');
});

test('only task lines with an authored scheduled or due value cross the native-record boundary', () => {
  assert.equal(taskLineNeedsNativeRecord('- [ ] Quick reminder'), false);
  assert.equal(taskLineNeedsNativeRecord('- [ ] Meeting [scheduled:: 2026-08-26 09:00:00]'), true);
  assert.equal(taskLineNeedsNativeRecord('- [ ] Submit report [due:: 2026-08-28]'), true);
  assert.equal(taskLineNeedsNativeRecord('- [ ] Clear date [scheduled:: ] [due:: ]'), false);
  assert.equal(taskLineNeedsNativeRecord('- Plain bullet [scheduled:: 2026-08-26 09:00:00]'), false);
});

test('ordinary note auto-naming never overrides workflow-owned native record filenames', () => {
  assert.match(fileNamingSource, /nativeRecordService\?\.isRecordFile\(file\)/u);
  assert.match(fileNamingSource, /Native-record filenames are owned by their creating workflow/u);
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
  assert.match(apiSource, /const nativeRecordsApi = \{[\s\S]{0,300}version: plugin\.nativeRecordService\.version[\s\S]{0,1800}createAsset:[\s\S]{0,1800}resolve:[\s\S]{0,1800}rename:[\s\S]{0,800}archive:/u);
  assert.match(apiSource, /ensureAsset:[\s\S]{0,700}resolveAsset:/u);
  assert.match(apiSource, /const taskRecordsApi = \{[\s\S]{0,200}version: 1[\s\S]{0,500}promote:[\s\S]{0,900}resolve:/u);
  assert.match(apiSource, /nativeRecords: nativeRecordsApi,[\s\S]{0,100}taskRecords: taskRecordsApi/u);
});
