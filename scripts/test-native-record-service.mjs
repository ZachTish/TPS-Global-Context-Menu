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
  if (text.includes('!tps-test-invalid-yaml!')) throw new Error('synthetic invalid YAML');
  if (/^\?\s+tpsId\s*$/mu.test(text)) throw new Error('synthetic explicit-key YAML rejection');
  if (/^-\s+tpsId\s*:/mu.test(text)) return [];
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
  LEGACY_NATIVE_RECORD_PROPERTY_PROFILE,
  FrontmatterMutationService,
  NativeRecordService,
  TFile,
  TFolder,
  TPS_NATIVE_RECORD_SCHEMA_VERSION,
  buildNativeRecordPath,
  isCanonicalCalendarRecordId,
  isValidNativeRecordKind,
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
  const metadataEventHandlers = new Map();
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
    const timestamp = Date.now();
    file.stat = { ctime: timestamp, mtime: timestamp, size: String(content || '').length };
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
    read: async (file) => contents.get(file) || '',
    process: async (file, processor) => {
      const next = processor(contents.get(file) || '');
      contents.set(file, next);
      file.stat.mtime = Date.now();
      file.stat.size = next.length;
      const parsed = parseNativeRecordDocument(next);
      if (parsed) metadata.set(file, parsed.frontmatter);
      if (options.emitModifyOnProcess) {
        for (const handler of vaultEventHandlers.get('modify') || []) handler(file);
      }
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
    emit: (eventName, ...args) => {
      for (const handler of vaultEventHandlers.get(eventName) || []) handler(...args);
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
      frontmatterAutoWriteExclusions: options.frontmatterAutoWriteExclusions || '',
    },
    manifest: { id: 'tps-global-context-menu' },
    registerEvent: () => {},
    app: {
      vault,
      metadataCache: {
        getFileCache: (file) => ({ frontmatter: metadata.get(file) }),
        on: (eventName, handler) => {
          const handlers = metadataEventHandlers.get(eventName) || [];
          handlers.push(handler);
          metadataEventHandlers.set(eventName, handlers);
          return {};
        },
        emit: (eventName, ...args) => {
          for (const handler of metadataEventHandlers.get(eventName) || []) handler(...args);
        },
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

async function planCurrent(service, entries) {
  return service.planIdentityChanges(entries, await service.snapshot());
}

test('native record envelope and path helpers are deterministic', () => {
  assert.equal(normalizeNativeRecordRoot(' /_records// '), '_records');
  assert.equal(normalizeNativeRecordRoot('/'), '');
  assert.equal(buildNativeRecordPath('_records', 'calendar-event', 'event:one'), '_records/calendar-events/event-one.md');
  assert.equal(buildNativeRecordPath('/', 'calendar-event', 'event:one', 'flat-root'), 'event-one.md');
  assert.equal(buildNativeRecordPath('/', 'calendar-event', 'event:one', 'flat-root', '2026-08-25 - Standup.md'), '2026-08-25 - Standup.md');
  assert.equal(buildNativeRecordPath('_records', 'nutrition-log', 'nutrition:one'), '_records/nutrition-log-records/nutrition-one.md');
  assert.equal(buildNativeRecordPath('_records', 'constructor', 'constructor:one'), '_records/constructor-records/constructor-one.md');
  assert.throws(() => buildNativeRecordPath('_records', true, 'boolean:one'), /Unsupported TPS native record kind/u);
  assert.equal(isValidNativeRecordKind('nutrition-log'), true);
  assert.equal(isValidNativeRecordKind('Nutrition log'), false);
  assert.equal(isValidNativeRecordKind(' nutrition-log'), false);
  assert.equal(isValidNativeRecordKind('nutrition-log '), false);
  assert.equal(isValidNativeRecordKind(true), false);
  assert.equal(isValidNativeRecordKind(null), false);
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

test('custom native record kinds retain the same atomic envelope contract', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.create(' nutrition-log', { title: 'Invalid' }, { id: 'invalid-kind' }),
    /Unsupported TPS native record kind/u,
  );
  await assert.rejects(
    () => service.create('nutrition-log ', { title: 'Invalid' }, { id: 'invalid-kind' }),
    /Unsupported TPS native record kind/u,
  );
  const created = await service.create('nutrition-log', { title: 'Lunch' }, { id: 'nutrition-log-one' });
  assert.equal(created.kind, 'nutrition-log');
  assert.equal(created.path, '_records/nutrition-log-records/nutrition-log-one.md');
  assert.equal(service.inspect(created.frontmatter)?.kind, 'nutrition-log');
  assert.equal((await service.resolve(created.id))?.kind, 'nutrition-log');
  assert.deepEqual((await service.list('nutrition-log')).map((record) => record.id), [created.id]);
  const updated = await service.update(created.id, { calories: 640 });
  assert.equal(updated?.frontmatter.calories, 640);
  const renamed = await service.rename(created.id, 'Lunch log');
  assert.equal(renamed?.path, '_records/nutrition-log-records/Lunch log.md');
  const archived = await service.archive(created.id);
  assert.equal(archived?.frontmatter.archived, true);
});

const calendarId = (suffix = '0') => `calendar:v1:abcdefghijklmnop:abcdefghijklmnopqrstuvwxyz${suffix}`;

test('calendar template authority requires the exact canonical ID grammar', async () => {
  assert.equal(isCanonicalCalendarRecordId(calendarId()), true);
  for (const id of [
    null, true, '', ` ${calendarId()}`, `${calendarId()} `,
    calendarId().replace('calendar:', 'Calendar:'),
    calendarId().replace(':v1:', ':v2:'),
    calendarId().replace('abcdefghijklmnop:', 'abcdefghijklmno:'),
    calendarId().slice(0, -1), `${calendarId()}x`,
    calendarId().replace('abcdefghijklmnop', 'abcdefghijklmno!'),
  ]) assert.equal(isCanonicalCalendarRecordId(id), false, String(id));

  const { service, entries } = createHarness();
  for (const kind of ['task', 'food-entry', 'nutrition-log', 'asset']) {
    await assert.rejects(service.create(kind, { title: 'Wrong route' }, { id: calendarId() }), /calendar-event structural route/u);
  }
  for (const id of ['calendar:v1:scope:digest', calendarId().slice(0, -1), `${calendarId()}x`]) {
    assert.equal(service.inspect({ tpsId: id, title: 'No public kind' }), null);
    await assert.rejects(service.create('calendar-event', { title: 'Invalid', kind: 'Team meeting' }, { id }), /collides with system storage/u);
    await assert.rejects(service.create('calendar-event', { title: 'Invalid' }, { id, body: 'Body' }), /canonical calendar record ID/u);
  }
  await assert.rejects(service.create('calendar-event', { title: 'Copied ID', tpsId: 'template-id' }, { id: calendarId() }), /collides with system storage/u);
  await assert.rejects(service.create('calendar-event', { title: 'Invalid body' }, { id: calendarId(), body: null }), /canonical calendar record ID/u);
  await assert.rejects(service.create('calendar-event', { title: 'Invalid kind', kind: ['meeting'] }, { id: calendarId() }), /kind must be a string/u);
  await assert.rejects(service.create('task', { title: 'Unchanged task contract' }, { id: 'task-body', body: 'Body' }), /canonical calendar record ID/u);
  assert.equal([...entries.values()].filter((entry) => entry instanceof TFile).length, 0);
});

test('canonical calendar creation stores no inferred public kind and writes the template body atomically', async () => {
  const { service, vault, contents } = createHarness();
  const body = 'User template content\n\n- [ ] Agenda\n';
  let creationSource;
  const create = vault.create;
  vault.create = async (path, source) => { creationSource = source; return create(path, source); };
  const record = await service.create('calendar-event', {
    title: 'Calendar occurrence', status: 'scheduled', scheduled: '2026-09-03T09:00:00-05:00',
  }, { id: calendarId(), body });
  const parsed = parseNativeRecordDocument(contents.get(record.file));
  assert.equal(record.kind, 'calendar-event');
  assert.equal(Object.hasOwn(record.frontmatter, 'kind'), false);
  assert.equal(Object.hasOwn(parsed.frontmatter, 'kind'), false);
  assert.equal(parsed.body, body);
  assert.equal(creationSource, contents.get(record.file), 'body is present in the sole create call, not a second write');
  assert.equal(service.inspect(parsed.frontmatter)?.kind, 'calendar-event');
  assert.equal(Object.hasOwn(service.inspect(parsed.frontmatter).frontmatter, 'kind'), false);
  assert.equal(isNativeRecordEnvelope(record.frontmatter), true);
  assert.equal((await service.resolve(record.id))?.kind, 'calendar-event');
  assert.deepEqual((await service.list('calendar-event')).map((item) => item.id), [record.id]);
  assert.deepEqual(await service.list('task'), []);
  const updated = await service.update(record.id, { status: 'complete' });
  assert.equal(updated?.frontmatter.status, 'complete');
  assert.equal(Object.hasOwn(updated.frontmatter, 'kind'), false);
  assert.equal(parseNativeRecordDocument(contents.get(record.file)).body, body);
  const reidentified = await service.reidentify(record.id, calendarId('1'));
  assert.equal(reidentified?.kind, 'calendar-event');
  assert.equal(Object.hasOwn(reidentified.frontmatter, 'kind'), false);
  assert.equal(Object.hasOwn(parseNativeRecordDocument(contents.get(record.file)).frontmatter, 'kind'), false);
  assert.equal(await service.canReidentify(reidentified.id, 'calendar-no-structural-authority'), false);
  const nullKind = await service.create('calendar-event', { title: 'Null means omitted', kind: null }, { id: calendarId('2') });
  assert.equal(Object.hasOwn(nullKind.frontmatter, 'kind'), false);
});

test('canonical calendar records preserve authored business kind casing across reads, sync, and identity plans', async () => {
  const { service, vault, contents } = createHarness('native-records', { emitModifyOnProcess: true });
  const body = 'Keep my notes.\n';
  const record = await service.create('calendar-event', {
    title: 'Project review', Kind: 'Team meeting', status: 'complete',
  }, { id: calendarId(), body });
  assert.equal(record.kind, 'calendar-event');
  assert.equal(record.frontmatter.Kind, 'Team meeting');
  assert.equal(Object.hasOwn(record.frontmatter, 'kind'), false);
  assert.deepEqual(await service.list('Team meeting'), []);
  assert.equal((await service.resolve(record.file))?.frontmatter.Kind, 'Team meeting');
  assert.equal((await service.update(record.id, { scheduled: '2026-09-04T10:00:00-05:00' }))?.frontmatter.Kind, 'Team meeting');
  assert.equal(await service.update(record.id, { kind: 'calendar-event' }), null, 'sync cannot replace the authored kind');
  await vault.process(record.file, (source) => source.replace('Kind: Team meeting', 'Kind: task'));
  assert.equal((await service.resolve(record.file))?.frontmatter.Kind, 'task');
  assert.deepEqual(await service.list('task'), [], 'business kind never changes structural task routing');
  const entries = [{ operation: 'reidentify', reference: record.id, nextId: calendarId('1'), updates: [{ location: 'Room 1' }] }];
  const plan = await planCurrent(service, entries);
  assert.ok(plan);
  const result = await service.applyIdentityChanges(plan, entries);
  assert.equal(result.ok, true);
  assert.equal(result.handles[0].kind, 'calendar-event');
  assert.equal(result.handles[0].frontmatter.Kind, 'task');
  const parsed = parseNativeRecordDocument(contents.get(record.file));
  assert.equal(parsed.frontmatter.Kind, 'task');
  assert.equal(Object.hasOwn(parsed.frontmatter, 'kind'), false);
  assert.equal(parsed.body, body);
  assert.equal(parsed.frontmatter.status, 'complete');
});

test('calendar identity adoption preserves an existing public kind and rejects noncalendar structural conversion', async () => {
  const { service, contents } = createHarness();
  const legacy = await service.create('calendar-event', { title: 'Existing event' }, { id: 'calendar-legacy' });
  const adopted = await service.reidentify(legacy.id, calendarId());
  assert.equal(adopted?.frontmatter.kind, 'calendar-event');
  assert.equal(parseNativeRecordDocument(contents.get(legacy.file)).frontmatter.kind, 'calendar-event');
  const task = await service.create('task', { title: 'Task stays task' }, { id: 'task-stays-task' });
  const before = contents.get(task.file);
  assert.equal(await service.canReidentify(task.id, calendarId('1')), false);
  assert.equal(await service.reidentify(task.id, calendarId('1')), null);
  assert.equal(contents.get(task.file), before);
});

test('calendar template create plans bind the exact body before any mutation', async () => {
  const { service, contents, entries: files } = createHarness();
  const entries = [{ operation: 'create', nextId: calendarId(), kind: 'calendar-event', properties: {
    title: 'Planned occurrence', kind: 'Client meeting',
  }, body: 'Approved body\n' }];
  assert.equal(await service.canApplyIdentityPlan(entries), true);
  const plan = await planCurrent(service, entries);
  assert.equal(plan.entries[0].body, entries[0].body);
  const substituted = await service.applyIdentityChanges(plan, [{ ...entries[0], body: 'Different body\n' }]);
  assert.equal(substituted.ok, false);
  assert.equal([...files.values()].filter((entry) => entry instanceof TFile).length, 0);
  const confirmedPlan = await planCurrent(service, entries);
  const result = await service.applyIdentityChanges(confirmedPlan, entries);
  assert.equal(result.ok, true);
  assert.equal(result.handles[0].frontmatter.kind, 'Client meeting');
  assert.equal(parseNativeRecordDocument(contents.get(result.handles[0].file)).body, entries[0].body);
});

test('canonical calendar IDs retain global duplicate protection regardless of public kind or ID case', async () => {
  const { service, vault, addFile } = createHarness();
  const first = await service.create('calendar-event', { title: 'First' }, { id: calendarId() });
  const duplicate = addFile('Inbox/duplicate.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: '', frontmatter: {
      tpsId: calendarId().toUpperCase(), kind: 'task', title: 'Conflicting note',
    },
  }));
  vault.emit('create', duplicate);
  assert.equal(await service.canCreateIdentity(calendarId()), false);
  assert.equal(await service.resolve(first.id), null);
  assert.equal(await service.resolve(first.file), null);
  assert.equal(await service.resolve(duplicate), null);
  await assert.rejects(service.list('calendar-event'), /identity conflicts must be resolved/u);
  await assert.rejects(service.create('calendar-event', { title: 'Third', kind: 'Another business kind' }, { id: calendarId() }), /already exists/u);
  assert.equal(await service.canApplyIdentityPlan([{ operation: 'create', nextId: calendarId(), kind: 'calendar-event', properties: { title: 'Planned duplicate' } }]), false);
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

test('canonical writes persist only tpsId, kind, and title while API projections retain virtual schema and file timestamps', async () => {
  const { service, contents } = createHarness();
  const created = await service.create('task', {
    title: 'Canonical task',
    status: 'todo',
  }, { id: 'task-canonical-envelope' });
  const raw = parseNativeRecordDocument(contents.get(created.file)).frontmatter;

  assert.deepEqual(
    Object.keys(raw).filter((key) => [
      'tpsId',
      'tpsSchemaVersion',
      'kind',
      'title',
      'createdDate',
      'modifiedDate',
    ].includes(key)).sort(),
    ['kind', 'title', 'tpsId'],
  );
  const inspection = service.inspect(raw);
  assert.equal(inspection?.schemaVersion, 1);
  assert.equal(inspection?.frontmatter.tpsSchemaVersion, 1);
  assert.equal(inspection?.frontmatter.createdDate, '');
  assert.equal(inspection?.frontmatter.modifiedDate, '');

  const resolved = await service.resolve(created.file);
  assert.equal(resolved?.frontmatter.tpsSchemaVersion, 1);
  assert.equal(resolved?.frontmatter.createdDate, new Date(created.file.stat.ctime).toISOString());
  assert.equal(resolved?.frontmatter.modifiedDate, new Date(created.file.stat.mtime).toISOString());
  assert.equal(resolved?.frontmatter.status, 'todo');
});

test('the built-in six-field property profile remains readable and consolidates in place', async () => {
  const { service, contents, addFile } = createHarness();
  const legacy = addFile('Imported/Legacy event.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Legacy body\n', frontmatter: {
      tpsId: 'calendar-legacy-property',
      tpsSchemaVersion: 1,
      kind: 'calendar-event',
      title: 'Legacy event',
      createdDate: '2026-08-20T10:00:00.000Z',
      modifiedDate: '2026-08-21T10:00:00.000Z',
      status: 'scheduled',
    },
  }));
  assert.equal(service.inspect(parseNativeRecordDocument(contents.get(legacy)).frontmatter)?.id, 'calendar-legacy-property');

  const result = await service.migrateStorageProfile();
  assert.deepEqual(result, { inspected: 1, updated: 1, skipped: 0, failed: 0 });
  assert.equal(legacy.path, 'Imported/Legacy event.md');
  const raw = parseNativeRecordDocument(contents.get(legacy)).frontmatter;
  assert.deepEqual(raw, {
    status: 'scheduled',
    tpsId: 'calendar-legacy-property',
    kind: 'calendar-event',
    title: 'Legacy event',
  });
  const projected = service.inspect(raw)?.frontmatter;
  assert.equal(projected?.tpsSchemaVersion, 1);
  assert.equal(projected?.createdDate, '');
  assert.equal(projected?.modifiedDate, '');
});

test('TPS definition kinds share the global tpsId namespace without relocating existing notes', async () => {
  const { service, vault, entries, contents, addFile } = createHarness();
  const folderByKind = new Map([
    ['food', 'foods'],
    ['exercise', 'exercises'],
    ['recipe', 'recipes'],
    ['workout-plan', 'workout-plans'],
    ['workflow', 'workflows'],
    ['time-entry', 'time-entries'],
  ]);
  for (const [kind, folder] of folderByKind) {
    const record = await service.create(kind, { title: `${kind} definition` }, { id: `${kind}-definition` });
    assert.equal(record.path, `_records/${folder}/${kind}-definition.md`);
  }

  const existing = addFile('Definitions/Foods/Apple.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Definition body\n', frontmatter: {
      tpsId: 'food-existing-global',
      kind: 'food',
      title: 'Apple',
      servingSize: 1,
    },
  }));
  vault.emit('create', existing);
  assert.equal(await service.canCreateIdentity('FOOD-EXISTING-GLOBAL'), false);
  await assert.rejects(
    service.create('recipe', { title: 'Collision' }, { id: 'food-existing-global' }),
    /already exists/u,
  );

  const beforePath = existing.path;
  const migration = await service.migrateStorageProfile();
  assert.equal(migration.failed, 0);
  assert.equal(existing.path, beforePath);
  assert.equal(entries.get(beforePath), existing);
  assert.equal(parseNativeRecordDocument(contents.get(existing)).frontmatter.servingSize, 1);
});

test('configured legacy tag storage remains read-only while new records use only the canonical envelope', async () => {
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
  assert.equal(service.version, 6);
  assert.deepEqual(service.getStorageProfile(), DEFAULT_NATIVE_RECORD_STORAGE_PROFILE);
  assert.equal(parsed.frontmatter.tpsId, 'food:one');
  assert.equal(parsed.frontmatter.kind, 'food-entry');
  assert.equal(parsed.frontmatter.title, 'Tagged lunch');
  assert.equal(Object.hasOwn(parsed.frontmatter, 'tpsSchemaVersion'), false);
  assert.equal(Object.hasOwn(parsed.frontmatter, 'createdDate'), false);
  assert.equal(Object.hasOwn(parsed.frontmatter, 'modifiedDate'), false);
  assert.equal(Object.hasOwn(parsed.frontmatter, 'recordType'), false);
  assert.equal(Object.hasOwn(parsed.frontmatter, 'name'), false);
  assert.deepEqual(parsed.frontmatter.tags, ['lunch', 'favorite']);
  assert.equal(parsed.frontmatter.tags.some((tag) => tag.startsWith('my/records/')), false);
  assert.equal(service.inspect(parsed.frontmatter)?.id, 'food:one');
  assert.equal((await service.resolve('food:one'))?.frontmatter.calories, 420);

  const updated = await service.update(created.file, { title: 'Updated lunch', calories: 500 });
  assert.equal(updated?.frontmatter.title, 'Updated lunch');
  const updatedRaw = parseNativeRecordDocument(contents.get(created.file)).frontmatter;
  assert.equal(updatedRaw.title, 'Updated lunch');
  assert.equal(updatedRaw.calories, 500);
  assert.equal(Object.hasOwn(updatedRaw, 'modifiedDate'), false);
  assert.equal(service.inspect({
    recordType: 'food-entry',
    name: 'Legacy tagged lunch',
    tags: ['lunch', 'my/records/v1/food-entry/food-old'],
  })?.id, 'food-old');
});

test('writable storage resolution freezes canonical keys and retains a valid tag profile only for reads', () => {
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
  assert.deepEqual(resolved.writeProfile, DEFAULT_NATIVE_RECORD_STORAGE_PROFILE);
  assert.deepEqual(resolved.readAliases, [resolved.configuredProfile]);
});

test('tag profiles keep property-only collisions as legacy read evidence without altering canonical writes', () => {
  const configured = {
    ...DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE,
    identityPropertyKey: 'name',
    schemaPropertyKey: 'recordKind',
    kindPropertyKey: 'recordKind',
    titlePropertyKey: 'name',
  };
  const resolved = resolveWritableNativeRecordStorageConfiguration(configured);

  assert.deepEqual(resolved.writeProfile, DEFAULT_NATIVE_RECORD_STORAGE_PROFILE);
  assert.equal(resolved.requiresSettingsMigration, true);
  assert.deepEqual(resolved.readAliases, [resolved.configuredProfile]);
});

test('legacy property customization is demoted to a read alias while the writer stays canonical', () => {
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
  assert.deepEqual(resolved.writeProfile, DEFAULT_NATIVE_RECORD_STORAGE_PROFILE);
  assert.deepEqual(resolved.readAliases, []);
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

test('the canonical writer never consumes tags while valid prior mappings remain readable aliases', () => {
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
    assert.deepEqual(resolved.writeProfile, DEFAULT_NATIVE_RECORD_STORAGE_PROFILE, systemKey);
    assert.equal(resolved.requiresSettingsMigration, true, systemKey);
    assert.deepEqual(resolved.readAliases, [resolved.configuredProfile], systemKey);
  }

  const { service } = createHarness('native-records', {
    identityPropertyKey: 'tags',
    schemaPropertyKey: 'tpsSchemaVersion',
    createdPropertyKey: 'createdDate',
    modifiedPropertyKey: 'modifiedDate',
  });
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
  assert.equal(Object.hasOwn(raw, 'tpsSchemaVersion'), false);
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
  assert.equal(legacyRaw.kind, 'task');
  assert.equal(legacyRaw.title, 'Matched legacy title');
  assert.equal(legacyRaw.producerField, 'preserve me');
  for (const key of ['tpsSchemaVersion', 'createdDate', 'modifiedDate']) {
    assert.equal(Object.hasOwn(legacyRaw, key), false, key);
  }
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
  const { service, vault, contents, addFile } = createHarness('native-records', {
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
  vault.emit('modify', partialUpdate);
  const timestampUpdated = await service.update(partialUpdate, { status: 'done' });
  assert.equal(timestampUpdated?.frontmatter.createdDate, new Date(partialUpdate.stat.ctime).toISOString());
  assert.equal(timestampUpdated?.frontmatter.modifiedDate, new Date(partialUpdate.stat.mtime).toISOString());
  assert.equal(Object.hasOwn(parseNativeRecordDocument(contents.get(partialUpdate)).frontmatter, 'createdDate'), false);
  assert.equal(Object.hasOwn(parseNativeRecordDocument(contents.get(partialUpdate)).frontmatter, 'modifiedDate'), false);

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
      legacyCreated: '2026-08-27T08:00:00.000Z',
      legacyModified: '2026-08-27T09:00:00.000Z',
    },
  }));
  assert.equal(service.inspect(parseNativeRecordDocument(contents.get(authoritative)).frontmatter)?.frontmatter.createdDate, '2026-08-27T08:00:00.000Z');

  const result = await service.migrateStorageProfile();
  assert.equal(result.failed, 0);
  const fallbackRaw = parseNativeRecordDocument(contents.get(partiallyMigrated)).frontmatter;
  const authoritativeRaw = parseNativeRecordDocument(contents.get(authoritative)).frontmatter;
  for (const raw of [fallbackRaw, authoritativeRaw]) {
    assert.equal(Object.hasOwn(raw, 'tpsSchemaVersion'), false);
    assert.equal(Object.hasOwn(raw, 'createdDate'), false);
    assert.equal(Object.hasOwn(raw, 'modifiedDate'), false);
  }
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
  const { service, vault, contents, addFile } = createHarness('native-records', {
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
  vault.emit('modify', legacyForUpdate);

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
  assert.equal(await service.canCreateIdentity('TASK-CASE-DUPLICATE'), false);
  assert.equal(await service.canCreateIdentity('TASK-SHADOW'), false);
  await assert.rejects(
    () => service.create('task', { title: 'Shadow collision' }, { id: 'TASK-SHADOW' }),
    /already exists/u,
  );
  assert.equal(await service.update(duplicate, { status: 'done' }), null);
  assert.equal(contents.get(duplicate), before);
  assert.equal(events.length, 0);
  assert.equal(indexed.length, 0);
  const result = await service.migrateStorageProfile();
  assert.deepEqual(result, { inspected: 1, updated: 0, skipped: 0, failed: 1 });
  assert.equal(contents.get(duplicate), before);
});

test('every case-variant tags value reserves its legacy identity evidence', async () => {
  const { service, contents, events, indexed, addFile } = createHarness();
  const duplicate = addFile('_records/tasks/task-case-tag-duplicate.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Duplicate tag body', frontmatter: {
      kind: 'task',
      title: 'Case tag duplicate',
      tags: ['todo', 'tps/record/v1/task/task-tag-first'],
      Tags: ['tps/record/v1/task/task-tag-shadow'],
    },
  }));
  const before = contents.get(duplicate);

  assert.equal(service.inspect(parseNativeRecordDocument(before).frontmatter), null);
  assert.equal(await service.canCreateIdentity('TASK-TAG-FIRST'), false);
  assert.equal(await service.canCreateIdentity('TASK-TAG-SHADOW'), false);
  await assert.rejects(
    () => service.create('task', { title: 'Tag shadow collision' }, { id: 'TASK-TAG-SHADOW' }),
    /already exists/u,
  );
  const result = await service.migrateStorageProfile();
  assert.deepEqual(result, { inspected: 1, updated: 0, skipped: 0, failed: 1 });
  assert.equal(contents.get(duplicate), before);
  assert.equal(events.length, 0);
  assert.equal(indexed.length, 0);
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
  const { service, plugin, vault, contents, addFile } = createHarness('native-records', {
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
  assert.equal(Object.hasOwn(raw, 'tpsSchemaVersion'), false);
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
  vault.emit('create', late);
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
  assert.doesNotMatch(output, /^tpsSchemaVersion:/mu);
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

test('reidentify atomically replaces property identity while preserving path, source, body, and business fields', async () => {
  const { service, contents, events, indexed, addFile } = createHarness();
  const original = [
    '\uFEFF---\r\n',
    'tpsId: calendar-old\r\n',
    'tpsSchemaVersion: 1\r\n',
    'kind: calendar-event\r\n',
    'title: "Provider: planning"\r\n',
    '# producer-owned placement and spelling must survive\r\n',
    'scheduled: 2026-10-02T14:00:00.000Z\r\n',
    'providerPayload: "Keep: exact"\r\n',
    'createdDate: 2026-08-27T12:00:00.000Z\r\n',
    'modifiedDate: 2026-08-27T12:00:00.000Z\r\n',
    'tags:\r\n',
    '  - hca\r\n',
    '---\r\n',
    'Human body with [[links]], tasks, and --- remains exact.\r\n',
  ].join('');
  const file = addFile('_records/calendar-events/readable-event.md', original);

  const result = await service.reidentify('calendar-old', 'calendar:v1:source:occurrence', {
    kind: 'user',
    surface: 'calendar-identity-migration',
    sourcePluginId: 'tps-controller',
  });
  const output = contents.get(file);

  assert.equal(result?.id, 'calendar:v1:source:occurrence');
  assert.equal(result?.path, file.path);
  assert.equal(await service.resolve('calendar-old'), null);
  assert.equal((await service.resolve('calendar:v1:source:occurrence'))?.path, file.path);
  assert.match(output, /^tpsId: "?calendar:v1:source:occurrence"?\r$/mu);
  assert.match(output, /^scheduled: 2026-10-02T14:00:00.000Z\r$/mu);
  assert.match(output, /^providerPayload: "Keep: exact"\r$/mu);
  assert.match(output, /^# producer-owned placement and spelling must survive\r$/mu);
  assert.match(output, /^  - hca\r$/mu);
  assert.ok(output.endsWith('Human body with [[links]], tasks, and --- remains exact.\r\n'));
  assert.equal(indexed.length, 1);
  assert.deepEqual(events, [
    {
      type: 'files',
      paths: [file.path],
      details: { sourcePluginId: 'tps-controller' },
    },
    {
      type: 'explicit',
      paths: [file.path],
      details: { sourcePluginId: 'tps-controller', source: 'calendar-identity-migration' },
    },
  ]);
});

test('reidentify adopts recognized tag identity and retains ordinary tags and body bytes', async () => {
  const { service, contents, addFile } = createHarness();
  const file = addFile('_records/calendar-events/legacy-tag-event.md', [
    '---\n',
    'kind: calendar-event\n',
    'title: Legacy tagged event\n',
    'tags:\n',
    '  - hca\n',
    '  - tps/record/v1/calendar-event/calendar-old-tag\n',
    'location: Conference room\n',
    '---\n',
    'Legacy event notes stay here.\n',
  ].join(''));

  assert.equal(await service.canApplyIdentityPlan([{
    operation: 'reidentify',
    reference: file,
    nextId: 'calendar:v1:source:tagged',
    updates: [{ tags: ['hca'] }],
  }]), true);
  const result = await service.reidentify('calendar-old-tag', 'calendar:v1:source:tagged');
  const parsed = parseNativeRecordDocument(contents.get(file));

  assert.equal(result?.id, 'calendar:v1:source:tagged');
  assert.equal(parsed.frontmatter.tpsId, 'calendar:v1:source:tagged');
  assert.equal(Object.hasOwn(parsed.frontmatter, 'tpsSchemaVersion'), false);
  assert.equal(parsed.frontmatter.kind, 'calendar-event');
  assert.equal(parsed.frontmatter.title, 'Legacy tagged event');
  assert.equal(parsed.frontmatter.location, 'Conference room');
  assert.deepEqual(parsed.frontmatter.tags, ['hca']);
  assert.equal(parsed.body, 'Legacy event notes stay here.\n');
  assert.equal(await service.resolve('calendar-old-tag'), null);
  assert.equal((await service.resolve('calendar:v1:source:tagged'))?.path, file.path);
});

test('a reidentified record can be cleaned up immediately while MetadataCache still reports the old ID', async () => {
  const { service, plugin, contents, addFile } = createHarness();
  const file = addFile('_records/calendar-events/stale-cache-event.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Body stays.\n', frontmatter: {
      tpsId: 'calendar-stale-old',
      tpsSchemaVersion: 1,
      kind: 'calendar-event',
      title: 'Stale cache event',
      legacyOccurrenceKey: 'provider:occurrence',
    },
  }));
  const staleFrontmatter = parseNativeRecordDocument(contents.get(file)).frontmatter;
  plugin.app.metadataCache.getFileCache = (candidate) => ({
    frontmatter: candidate === file
      ? staleFrontmatter
      : parseNativeRecordDocument(contents.get(candidate) || '')?.frontmatter,
  });

  assert.equal(
    (await service.reidentify('calendar-stale-old', 'calendar:v1:source:stale'))?.id,
    'calendar:v1:source:stale',
  );
  assert.equal((await service.resolve('calendar:v1:source:stale'))?.id, 'calendar:v1:source:stale');
  assert.equal((await service.resolve(file))?.id, 'calendar:v1:source:stale');
  assert.equal((await service.resolve(file.path))?.id, 'calendar:v1:source:stale');
  assert.equal((await service.resolve({ path: file.path }))?.id, 'calendar:v1:source:stale');
  plugin.app.metadataCache.emit('changed', file, '', { frontmatter: staleFrontmatter });
  assert.equal((await service.resolve(file))?.id, 'calendar:v1:source:stale');
  const cleaned = await service.update(file.path, {
    legacyOccurrenceKey: null,
    status: 'scheduled',
  });
  const parsed = parseNativeRecordDocument(contents.get(file));

  assert.equal(cleaned?.id, 'calendar:v1:source:stale');
  assert.equal(parsed.frontmatter.tpsId, 'calendar:v1:source:stale');
  assert.equal(Object.hasOwn(parsed.frontmatter, 'legacyOccurrenceKey'), false);
  assert.equal(parsed.frontmatter.status, 'scheduled');
  assert.equal(parsed.body, 'Body stays.\n');
});

test('reidentify fails closed for duplicate sources and occupied or blocked destinations', async () => {
  const { service, contents, events, indexed, addFile } = createHarness();
  const addRecord = (path, id, title) => addFile(path, serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: `${title} body\n`, frontmatter: {
      tpsId: id,
      tpsSchemaVersion: 1,
      kind: 'calendar-event',
      title,
    },
  }));
  const source = addRecord('_records/calendar-events/source.md', 'calendar-source', 'Source');
  const occupied = addRecord('_records/calendar-events/occupied.md', 'calendar-occupied', 'Occupied');
  const duplicateOne = addRecord('_records/calendar-events/duplicate-one.md', 'calendar-duplicate', 'Duplicate one');
  const duplicateTwo = addRecord('_records/calendar-events/duplicate-two.md', 'CALENDAR-DUPLICATE', 'Duplicate two');
  const blocked = addFile('_records/calendar-events/blocked.md', serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Blocked body\n', frontmatter: {
      tpsId: 'calendar-blocked',
      tpsSchemaVersion: 9,
      kind: 'calendar-event',
      title: 'Blocked evidence',
    },
  }));
  const before = new Map([source, occupied, duplicateOne, duplicateTwo, blocked].map((file) => [file, contents.get(file)]));

  assert.equal(await service.canCreateIdentity('calendar-new'), true);
  assert.equal(await service.canCreateIdentity('CALENDAR-OCCUPIED'), false);
  assert.equal(await service.canCreateIdentity('calendar-blocked'), false);
  assert.equal(await service.canCreateIdentity(''), false);
  assert.equal(await service.canApplyIdentityPlan([
    { operation: 'reidentify', reference: 'calendar-source', nextId: 'calendar-new', updates: [] },
    { operation: 'create', nextId: 'calendar-fresh', kind: 'calendar-event', properties: { title: 'Fresh' } },
  ]), true);
  assert.equal(await service.canApplyIdentityPlan([
    { operation: 'reidentify', reference: 'calendar-source', nextId: 'calendar-new', updates: [] },
    { operation: 'create', nextId: 'CALENDAR-NEW', kind: 'calendar-event', properties: { title: 'Fresh' } },
  ]), false);
  assert.equal(await service.canApplyIdentityPlan([
    { operation: 'create', nextId: 'calendar-occupied', kind: 'calendar-event', properties: { title: 'Occupied' } },
  ]), false);
  assert.equal(await service.canApplyIdentityPlan([
    { operation: 'create', nextId: 'calendar-fresh-without-properties', kind: 'calendar-event' },
  ]), false);
  assert.equal(await service.canApplyIdentityPlan([
    { operation: 'reidentify', reference: 'calendar-source', nextId: 'calendar-first', updates: [] },
    { operation: 'reidentify', reference: source.path, nextId: 'calendar-second', updates: [] },
  ]), false);
  await assert.rejects(
    () => service.list(),
    /identity conflicts must be resolved/u,
  );
  assert.equal(await service.canReidentify('calendar-source', 'calendar-new'), true);
  assert.equal(await service.canReidentify('calendar-source', 'CALENDAR-SOURCE'), true);
  assert.equal(await service.canReidentify('calendar-source', 'CALENDAR-OCCUPIED'), false);
  assert.equal(await service.canReidentify('calendar-source', 'calendar-blocked'), false);
  assert.equal(await service.canReidentify({ path: source.path, id: 'calendar-stale-source' }, 'calendar-new'), false);
  assert.equal(await service.canReidentify('calendar-duplicate', 'calendar-new'), false);
  assert.equal(await service.canReidentify('calendar-missing', 'calendar-new'), false);
  assert.equal(await service.canReidentify('calendar-source', ''), false);
  assert.equal(await service.reidentify('calendar-source', 'CALENDAR-OCCUPIED'), null);
  assert.equal(await service.reidentify('calendar-source', 'calendar-blocked'), null);
  assert.equal(await service.reidentify({ path: source.path, id: 'calendar-stale-source' }, 'calendar-new'), null);
  assert.equal(await service.reidentify('calendar-duplicate', 'calendar-new'), null);
  assert.equal(await service.reidentify('calendar-missing', 'calendar-new'), null);
  for (const [file, content] of before) assert.equal(contents.get(file), content);
  assert.equal(events.length, 0);
  assert.equal(indexed.length, 0);
});

test('resolve refreshes stale identity state from Vault bytes and rejects every duplicate reference form', async () => {
  const sourceFor = (id) => serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: `${id} body\n`, frontmatter: {
      tpsId: id,
      kind: 'calendar-event',
      title: id,
    },
  });
  const { service, vault, contents, addFile } = createHarness();
  const owner = addFile(
    '_records/calendar-events/resolve-owner.md',
    sourceFor('calendar-resolve-owner'),
  );
  const changed = addFile(
    '_records/calendar-events/resolve-changed.md',
    sourceFor('calendar-resolve-before'),
  );
  await service.snapshot();
  const originalRead = vault.read;
  let authoritativeReads = 0;
  vault.read = async (file) => {
    authoritativeReads += 1;
    return originalRead(file);
  };
  assert.equal(await service.resolve('calendar-not-present'), null);
  assert.equal(authoritativeReads, 0, 'a current authoritative index does not rescan for a missing ID');

  contents.set(changed, sourceFor('CALENDAR-RESOLVE-OWNER'));
  vault.emit('modify', changed);

  assert.equal(await service.resolve('calendar-resolve-owner'), null);
  assert.equal(authoritativeReads, 2, 'one stale generation performs one complete authoritative refresh');
  assert.equal(await service.resolve(owner), null);
  assert.equal(await service.resolve({ path: owner.path, id: 'calendar-resolve-owner' }), null);
  assert.equal(await service.resolve(changed), null);
  assert.equal(authoritativeReads, 2, 'subsequent ambiguous resolves reuse the current authoritative index');
  await assert.rejects(() => service.snapshot(), /identity conflicts must be resolved/u);
});

test('reidentify preflight matches source-writer eligibility and sees uncached on-disk destinations', async () => {
  const addRecordSource = (id, newline = '\n', body = 'Body\n') => serializeNativeRecordDocument({
    bom: '', newline, closer: '---', body, frontmatter: {
      tpsId: id,
      tpsSchemaVersion: 1,
      kind: 'calendar-event',
      title: id,
    },
  });

  {
    const { service, contents, metadata, addFile } = createHarness();
    const source = addFile('_records/calendar-events/source.md', addRecordSource('calendar-source'));
    const destination = addFile('_records/calendar-events/uncached.md', addRecordSource('calendar-uncached'));
    metadata.delete(destination);
    const before = contents.get(source);
    for (const reference of [source, source.path, { path: source.path, id: 'calendar-source' }]) {
      assert.equal(await service.canReidentify(reference, 'CALENDAR-UNCACHED'), false);
    }
    assert.equal(await service.canApplyIdentityPlan([{
      operation: 'reidentify',
      reference: source,
      nextId: 'CALENDAR-UNCACHED',
      updates: [],
    }]), false);
    assert.equal(await service.canCreateIdentity('CALENDAR-UNCACHED'), false);
    assert.equal(await service.canReidentify('calendar-source', 'CALENDAR-UNCACHED'), false);
    assert.equal(await service.reidentify('calendar-source', 'CALENDAR-UNCACHED'), null);
    assert.equal(contents.get(source), before);
  }

  {
    const { service, vault, contents, metadata, addFile } = createHarness();
    const source = addFile('_records/calendar-events/source.md', addRecordSource('calendar-source'));
    const destination = addFile('_records/calendar-events/destination.md', addRecordSource('calendar-before-edit'));
    assert.equal(await service.canReidentify(source, 'calendar-after-edit'), true);
    const pathsBefore = [...vault.getMarkdownFiles()].map((file) => file.path).sort();

    contents.set(destination, addRecordSource('calendar-after-edit'));
    metadata.set(destination, parseNativeRecordDocument(addRecordSource('calendar-before-edit')).frontmatter);
    vault.emit('modify', destination);

    assert.equal(await service.canCreateIdentity('CALENDAR-AFTER-EDIT'), false);
    assert.deepEqual(
      (await service.list('calendar-event')).map((record) => record.id).sort(),
      ['calendar-after-edit', 'calendar-source'],
    );
    assert.equal((await service.list('task')).length, 0);
    assert.equal(await service.canReidentify(source.path, 'CALENDAR-AFTER-EDIT'), false);
    assert.equal(await service.canApplyIdentityPlan([{
      operation: 'reidentify',
      reference: { path: source.path, id: 'calendar-source' },
      nextId: 'CALENDAR-AFTER-EDIT',
      updates: [],
    }]), false);
    assert.equal(await service.reidentify(source, 'CALENDAR-AFTER-EDIT'), null);
    await assert.rejects(
      () => service.create('calendar-event', { title: 'Must not duplicate' }, { id: 'CALENDAR-AFTER-EDIT' }),
      /already exists/u,
    );
    assert.deepEqual([...vault.getMarkdownFiles()].map((file) => file.path).sort(), pathsBefore);
  }

  {
    const { service, vault, contents, addFile } = createHarness();
    addFile('_records/calendar-events/source.md', addRecordSource('calendar-source'));
    const destination = addFile('_records/calendar-events/destination.md', addRecordSource('calendar-before-edit'));
    const originalRead = vault.read;
    let releaseFirstRead;
    let signalFirstRead;
    const firstReadStarted = new Promise((resolve) => { signalFirstRead = resolve; });
    const firstReadRelease = new Promise((resolve) => { releaseFirstRead = resolve; });
    let delayed = false;
    vault.read = async (file) => {
      if (!delayed) {
        delayed = true;
        signalFirstRead();
        await firstReadRelease;
      }
      return originalRead(file);
    };

    const firstPreflight = service.canCreateIdentity('calendar-after-edit');
    await firstReadStarted;
    contents.set(destination, addRecordSource('calendar-after-edit'));
    vault.emit('modify', destination);
    const secondPreflight = service.canCreateIdentity('CALENDAR-AFTER-EDIT');
    const missingResolve = service.resolve('calendar-not-present');
    releaseFirstRead();

    assert.equal(await missingResolve, null);
    assert.deepEqual(await Promise.all([firstPreflight, secondPreflight]), [false, false]);
    assert.deepEqual(
      (await service.list()).map((record) => record.id).sort(),
      ['calendar-after-edit', 'calendar-source'],
    );
  }

  {
    const { service, vault, metadata, addFile } = createHarness();
    const source = addFile('_records/calendar-events/source.md', addRecordSource('calendar-source'));
    const unreadable = addFile('_records/calendar-events/unreadable.md', addRecordSource('calendar-unreadable'));
    metadata.delete(unreadable);
    const originalRead = vault.read;
    vault.read = async (file) => {
      if (file === unreadable) throw new Error('synthetic read failure');
      return originalRead(file);
    };
    const pathsBefore = [...vault.getMarkdownFiles()].map((file) => file.path).sort();

    await assert.rejects(() => service.list(), /Unable to authoritatively read/u);
    await assert.rejects(() => service.canCreateIdentity('calendar-unreadable'), /Unable to authoritatively read/u);
    await assert.rejects(
      () => service.canApplyIdentityPlan([{
        operation: 'reidentify',
        reference: source,
        nextId: 'calendar-unreadable',
        updates: [],
      }]),
      /Unable to authoritatively read/u,
    );
    await assert.rejects(
      () => service.create('calendar-event', { title: 'Must not create' }, { id: 'calendar-unreadable' }),
      /Unable to authoritatively read/u,
    );
    assert.deepEqual([...vault.getMarkdownFiles()].map((file) => file.path).sort(), pathsBefore);
  }

  {
    const { service, vault, addFile } = createHarness();
    addFile('_records/calendar-events/malformed-identity.md', [
      '---',
      '{broken',
      'tpsId: calendar-malformed',
      'tpsSchemaVersion: 1',
      'kind: calendar-event',
      '---',
      'Body stays.',
    ].join('\n'));
    const pathsBefore = [...vault.getMarkdownFiles()].map((file) => file.path).sort();

    await assert.rejects(() => service.snapshot(), /Malformed native-record identity evidence/u);
    await assert.rejects(() => service.canCreateIdentity('calendar-malformed'), /Malformed native-record identity evidence/u);
    await assert.rejects(
      () => service.canApplyIdentityPlan([{ operation: 'create', nextId: 'calendar-canonical', kind: 'calendar-event', properties: { title: 'Canonical' } }]),
      /Malformed native-record identity evidence/u,
    );
    await assert.rejects(
      () => service.create('calendar-event', { title: 'Must not create' }, { id: 'calendar-canonical' }),
      /Malformed native-record identity evidence/u,
    );
    assert.deepEqual([...vault.getMarkdownFiles()].map((file) => file.path).sort(), pathsBefore);
  }

  for (const [name, malformedFrontmatter] of [
    ['flow', '{tpsId: calendar-flow-malformed, tpsSchemaVersion: 1, kind: calendar-event,'],
    ['indented', '  tpsId: calendar-indented-malformed\n  tpsSchemaVersion: 1\n!tps-test-invalid-yaml!'],
    ['root-sequence', '- tpsId: calendar-root-sequence-malformed\n  tpsSchemaVersion: 1'],
    ['explicit-key', '? tpsId\n: calendar-explicit-key-malformed'],
  ]) {
    const { service, vault, contents, addFile } = createHarness();
    const malformed = addFile(`_records/calendar-events/${name}-malformed.md`, [
      '---',
      malformedFrontmatter,
      '---',
      'Body stays.',
    ].join('\n'));
    const before = contents.get(malformed);
    const pathsBefore = [...vault.getMarkdownFiles()].map((file) => file.path).sort();

    await assert.rejects(() => service.list(), /identity evidence/u);
    await assert.rejects(() => service.canCreateIdentity(`calendar-${name}-new`), /identity evidence/u);
    await assert.rejects(() => service.canApplyIdentityPlan([{
      operation: 'create',
      nextId: `calendar-${name}-new`,
      kind: 'calendar-event',
      properties: { title: 'Must not create' },
    }]), /identity evidence/u);
    await assert.rejects(
      () => service.create('calendar-event', { title: 'Must not create' }, { id: `calendar-${name}-new` }),
      /identity evidence/u,
    );
    assert.equal(contents.get(malformed), before);
    assert.deepEqual([...vault.getMarkdownFiles()].map((file) => file.path).sort(), pathsBefore);
  }

  {
    const { service, vault, addFile } = createHarness();
    addFile('_records/calendar-events/existing.md', addRecordSource('calendar-existing'));
    const snapshot = await service.snapshot();
    const late = addFile('_records/calendar-events/late-legacy.md', addRecordSource('calendar-legacy-old'));
    vault.emit('create', late);

    assert.equal(await service.canApplyIdentityPlan([{
      operation: 'create',
      nextId: 'calendar-canonical-new',
      kind: 'calendar-event',
      properties: { title: 'Canonical' },
    }], snapshot.token), false);
  }

  {
    const { service, vault, contents, metadata, addFile } = createHarness();
    const clean = addFile('_records/calendar-events/clean.md', addRecordSource('calendar-clean'));
    const staleSource = addRecordSource('calendar-duplicate-business-key');
    const duplicateBusinessKeySource = serializeNativeRecordDocument({
      bom: '', newline: '\n', closer: '---', body: 'Body stays.\n', frontmatter: {
        tpsId: 'calendar-duplicate-business-key',
        tpsSchemaVersion: 1,
        kind: 'calendar-event',
        title: 'Duplicate business key',
        calendarId: 'calendar-one',
        CalendarId: 'calendar-two',
      },
    });
    const duplicate = addFile('_records/calendar-events/duplicate-business-key.md', staleSource);
    const staleFrontmatter = parseNativeRecordDocument(staleSource).frontmatter;
    metadata.set(duplicate, staleFrontmatter);
    contents.set(duplicate, duplicateBusinessKeySource);
    const cachedRead = vault.cachedRead;
    vault.cachedRead = async (file) => file === duplicate ? staleSource : cachedRead(file);
    vault.emit('modify', duplicate);
    const before = new Map([clean, duplicate].map((file) => [file, contents.get(file)]));

    assert.equal(await service.canApplyIdentityPlan([
      {
        operation: 'reidentify',
        reference: clean,
        nextId: 'calendar-clean-next',
        updates: [{ status: 'scheduled' }],
      },
      {
        operation: 'reidentify',
        reference: duplicate,
        nextId: 'calendar-duplicate-business-key-next',
        updates: [{ calendarId: null }],
      },
    ]), false);
    for (const [file, source] of before) assert.equal(contents.get(file), source);
  }

  {
    const { service, plugin, contents, events, indexed, addFile } = createHarness();
    const clean = addFile(
      '_records/calendar-events/flow-plan-clean.md',
      addRecordSource('calendar-flow-plan-clean'),
    );
    const flow = addFile('_records/calendar-events/flow-plan-later.md', [
      '---',
      '{"tpsId":"calendar-flow-plan-later","tpsSchemaVersion":1,"kind":"calendar-event","title":"Flow event","calendarId":"calendar-one"}',
      '---',
      'Flow body stays.',
      '',
    ].join('\n'));
    const before = new Map([clean, flow].map((file) => [file, contents.get(file)]));
    const flowOwnedKeys = [
      'tpsId',
      'tpsSchemaVersion',
      'kind',
      'title',
      'createdDate',
      'modifiedDate',
      'tags',
      'calendarId',
    ];

    assert.equal(await service.canApplyIdentityPlan([
      {
        operation: 'reidentify',
        reference: clean,
        nextId: 'calendar-flow-plan-clean-next',
        updates: [{ status: 'scheduled' }],
      },
      {
        operation: 'reidentify',
        reference: flow,
        nextId: 'calendar-flow-plan-later-next',
        updates: [{ calendarId: null }],
      },
    ]), false);
    assert.equal(
      await plugin.frontmatterMutationService.canProcessOwnedKeysPreservingSource(flow, flowOwnedKeys),
      false,
    );
    assert.equal(await plugin.frontmatterMutationService.processOwnedKeysPreservingSource(
      flow,
      flowOwnedKeys,
      (frontmatter) => { frontmatter.calendarId = 'calendar-two'; },
    ), false);
    for (const [file, source] of before) assert.equal(contents.get(file), source);
    assert.equal(events.length, 0);
    assert.equal(indexed.length, 0);
  }

  {
    const { service, contents, addFile } = createHarness();
    const source = addFile('_records/calendar-events/bare-cr.md', addRecordSource(
      'calendar-bare-cr',
      '\r',
      'Bare CR body\r',
    ));
    const before = contents.get(source);
    assert.equal(await service.canReidentify('calendar-bare-cr', 'calendar-bare-cr-next'), false);
    assert.equal(await service.reidentify('calendar-bare-cr', 'calendar-bare-cr-next'), null);
    assert.equal(contents.get(source), before);
  }

  {
    const { service, contents, addFile } = createHarness();
    const source = addFile('_records/calendar-events/duplicate-frontmatter.md', [
      addRecordSource('calendar-double-frontmatter', '\n', ''),
      '---\nsecond: block\n---\n',
    ].join(''));
    const before = contents.get(source);
    assert.equal(await service.canReidentify('calendar-double-frontmatter', 'calendar-double-frontmatter-next'), false);
    assert.equal(await service.reidentify('calendar-double-frontmatter', 'calendar-double-frontmatter-next'), null);
    assert.equal(contents.get(source), before);
  }
});

test('identity plans preflight exact create and ordered update payloads before any writes', async () => {
  const sourceFor = (id, tags = ['hca']) => serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: `${id} body\n`, frontmatter: {
      tpsId: id,
      tpsSchemaVersion: 1,
      kind: 'calendar-event',
      title: id,
      tags,
    },
  });
  const { service, contents, events, indexed, addFile } = createHarness();
  const first = addFile('_records/calendar-events/payload-first.md', sourceFor('calendar-payload-first'));
  const second = addFile('_records/calendar-events/payload-second.md', sourceFor('calendar-payload-second'));
  const before = new Map([first, second].map((file) => [file, contents.get(file)]));

  assert.equal(await service.canApplyIdentityPlan([
    {
      operation: 'reidentify',
      reference: first,
      nextId: 'calendar-payload-first-next',
      updates: [{ title: 'First title' }, { title: 'Final title', status: 'scheduled' }],
    },
    {
      operation: 'create',
      nextId: 'calendar-payload-invalid-create',
      kind: 'calendar-event',
      properties: {
        title: 'Invalid create',
        tags: ['hca', 'tps/record/v1/calendar-event/calendar-other-owner'],
      },
    },
  ]), false);
  assert.equal(await service.canApplyIdentityPlan([
    {
      operation: 'reidentify',
      reference: first,
      nextId: 'calendar-payload-first-next',
      updates: [{ status: 'scheduled' }],
    },
    {
      operation: 'reidentify',
      reference: second,
      nextId: 'calendar-payload-second-next',
      updates: [{ tags: ['hca', 'tps/record/v1/calendar-event/calendar-other-owner'] }],
    },
  ]), false);
  for (const [file, source] of before) assert.equal(contents.get(file), source);
  assert.equal(events.length, 0);
  assert.equal(indexed.length, 0);

  const configured = createHarness('native-records', { titlePropertyKey: 'eventTitle' });
  assert.equal(await configured.service.canApplyIdentityPlan([{
    operation: 'create',
    nextId: 'calendar-storage-collision',
    kind: 'calendar-event',
    properties: { title: 'Canonical title', eventTitle: 'Business title' },
  }]), true);
  const configuredRecord = await configured.service.create('calendar-event', {
    title: 'Canonical title',
    eventTitle: 'Business title',
  }, { id: 'calendar-storage-collision' });
  assert.equal(configuredRecord.frontmatter.title, 'Canonical title');
  assert.equal(configuredRecord.frontmatter.eventTitle, 'Business title');

  const stale = createHarness();
  const staleFile = stale.addFile('_records/calendar-events/stale-baseline.md', sourceFor('calendar-stale-baseline'));
  const staleSnapshot = await stale.service.snapshot();
  assert.deepEqual(staleSnapshot.records[0].frontmatter.tags, ['hca']);
  assert.equal((await stale.service.update(staleFile, { tags: ['hca', 'concurrent'] }))?.id, 'calendar-stale-baseline');
  assert.equal(await stale.service.planIdentityChanges([{
    operation: 'reidentify',
    reference: staleFile,
    nextId: 'calendar-stale-baseline-next',
    updates: [{ tags: ['hca'] }],
  }], staleSnapshot), null);
  assert.deepEqual((await stale.service.resolve(staleFile))?.frontmatter.tags, ['hca', 'concurrent']);

  const racing = createHarness();
  const racingFile = racing.addFile('_records/calendar-events/racing-baseline.md', sourceFor('calendar-racing-baseline'));
  const racingSnapshot = await racing.service.snapshot();
  const originalRead = racing.vault.read;
  let signalRead;
  let releaseRead;
  let delayedRead = false;
  const readStarted = new Promise((resolve) => { signalRead = resolve; });
  const readRelease = new Promise((resolve) => { releaseRead = resolve; });
  racing.vault.read = async (file) => {
    if (!delayedRead) {
      delayedRead = true;
      signalRead();
      await readRelease;
    }
    return originalRead(file);
  };
  const racingPlan = racing.service.planIdentityChanges([{
    operation: 'reidentify',
    reference: racingFile,
    nextId: 'calendar-racing-baseline-next',
    updates: [{ tags: ['hca'] }],
  }], racingSnapshot);
  await readStarted;
  assert.equal((await racing.service.update(racingFile, { tags: ['hca', 'racing'] }))?.id, 'calendar-racing-baseline');
  releaseRead();
  assert.equal(await racingPlan, null);
  assert.deepEqual((await racing.service.resolve(racingFile))?.frontmatter.tags, ['hca', 'racing']);
});

test('identity plans bind create kind and reidentify source path plus current ID', async () => {
  const sourceFor = (id) => serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: `${id} body\n`, frontmatter: {
      tpsId: id,
      kind: 'calendar-event',
      title: id,
    },
  });
  const reidentify = createHarness();
  const first = reidentify.addFile(
    '_records/calendar-events/plan-source-first.md',
    sourceFor('calendar-plan-source-first'),
  );
  const second = reidentify.addFile(
    '_records/calendar-events/plan-source-second.md',
    sourceFor('calendar-plan-source-second'),
  );
  const beforeFirst = reidentify.contents.get(first);
  const beforeSecond = reidentify.contents.get(second);
  const plannedEntries = [{
    operation: 'reidentify',
    reference: first,
    nextId: 'calendar-plan-bound-next',
    fileName: 'Bound target',
    updates: [],
  }];
  const plan = await planCurrent(reidentify.service, plannedEntries);
  assert.deepEqual(plan?.entries, [{
    operation: 'reidentify',
    nextId: 'calendar-plan-bound-next',
    expectedPath: '_records/calendar-events/Bound target.md',
    sourcePath: first.path,
    currentId: 'calendar-plan-source-first',
  }]);

  const substituted = await reidentify.service.applyIdentityChanges(plan, [{
    ...plannedEntries[0],
    reference: second,
  }]);
  assert.deepEqual(substituted, {
    ok: false,
    handles: [],
    failedIndex: null,
    error: 'plan-revalidation-failed',
  });
  assert.equal(reidentify.contents.get(first), beforeFirst);
  assert.equal(reidentify.contents.get(second), beforeSecond);
  assert.equal(reidentify.events.length, 0);
  assert.equal(reidentify.indexed.length, 0);

  const create = createHarness('native-records', { root: '/', layout: 'flat-root' });
  const createEntries = [{
    operation: 'create',
    nextId: 'plan-bound-create',
    kind: 'task',
    fileName: 'Bound create',
    properties: { title: 'Bound create' },
  }];
  const createPlan = await planCurrent(create.service, createEntries);
  assert.deepEqual(createPlan?.entries, [{
    operation: 'create',
    nextId: 'plan-bound-create',
    expectedPath: 'Bound create.md',
    kind: 'task',
  }]);

  const changedKind = await create.service.applyIdentityChanges(createPlan, [{
    ...createEntries[0],
    kind: 'calendar-event',
  }]);
  assert.deepEqual(changedKind, {
    ok: false,
    handles: [],
    failedIndex: null,
    error: 'plan-revalidation-failed',
  });
  assert.equal(create.vault.getFileByPath('Bound create.md'), null);
  assert.equal(create.events.length, 0);
  assert.equal(create.indexed.length, 0);
});

test('identity plans apply a no-rename reidentify at its source path and fail closed on invalid path contracts', async () => {
  const sourceFor = (id, body) => serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body, frontmatter: {
      tpsId: id,
      tpsSchemaVersion: 1,
      kind: 'calendar-event',
      title: id,
      tags: ['hca'],
    },
  });
  const { service, vault, contents, addFile } = createHarness();
  const stationary = addFile(
    'Legacy/no-rename.md',
    sourceFor('calendar-no-rename', 'No-rename body must survive byte-for-byte.\n'),
  );
  const renamed = addFile(
    'Legacy/rename.md',
    sourceFor('calendar-rename', 'Rename body must also survive.\n'),
  );
  const entries = [
    {
      operation: 'reidentify',
      reference: stationary,
      nextId: 'calendar-no-rename-next',
      updates: [{ status: 'complete', completedDate: '2026-08-31 13:04:28' }],
    },
    {
      operation: 'reidentify',
      reference: renamed,
      nextId: 'calendar-rename-next',
      fileName: 'Renamed record',
      updates: [{ status: 'scheduled' }],
    },
  ];
  const plan = await planCurrent(service, entries);
  assert.deepEqual(plan?.entries.map((entry) => entry.expectedPath), [
    'Legacy/no-rename.md',
    '_records/calendar-events/Renamed record.md',
  ]);

  const applied = await service.applyIdentityChanges(plan, entries);
  assert.equal(applied.ok, true);
  assert.equal(applied.failedIndex, null);
  assert.deepEqual(applied.handles.map((handle) => handle.path), [
    'Legacy/no-rename.md',
    '_records/calendar-events/Renamed record.md',
  ]);
  const stationaryPersisted = parseNativeRecordDocument(contents.get(stationary));
  assert.equal(stationaryPersisted?.frontmatter.tpsId, 'calendar-no-rename-next');
  assert.equal(stationaryPersisted?.frontmatter.status, 'complete');
  assert.equal(stationaryPersisted?.frontmatter.completedDate, '2026-08-31 13:04:28');
  assert.equal(stationaryPersisted?.body, 'No-rename body must survive byte-for-byte.\n');
  assert.equal((await service.resolve('calendar-no-rename-next'))?.path, 'Legacy/no-rename.md');
  assert.equal(await service.resolve('calendar-no-rename'), null);
  assert.equal(parseNativeRecordDocument(contents.get(renamed))?.body, 'Rename body must also survive.\n');

  const guarded = addFile(
    'Legacy/guarded-no-rename.md',
    sourceFor('calendar-guarded-no-rename', 'Guarded body.\n'),
  );
  vault.emit('create', guarded);
  const guardedBefore = contents.get(guarded);
  const guardedPlan = await planCurrent(service, [{
    operation: 'reidentify',
    reference: guarded,
    nextId: 'calendar-guarded-no-rename-next',
    updates: [],
  }]);
  assert.equal(await service.reidentify(guarded, 'calendar-guarded-no-rename-next', { kind: 'automation' }, {
    expectedPath: 'Legacy/wrong-path.md',
    planToken: guardedPlan.token,
  }), null);
  assert.equal(await service.reidentify(guarded, 'calendar-guarded-no-rename-next', { kind: 'automation' }, {
    expectedPath: guardedPlan.entries[0].expectedPath,
  }), null);
  assert.equal(contents.get(guarded), guardedBefore);
  assert.equal((await service.resolve('calendar-guarded-no-rename'))?.path, 'Legacy/guarded-no-rename.md');
});

test('identity plans bind collision-resolved rename paths and reject changed path configuration before mutation', async () => {
  const sourceFor = (id) => serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: `${id} body\n`, frontmatter: {
      tpsId: id,
      tpsSchemaVersion: 1,
      kind: 'calendar-event',
      title: id,
    },
  });
  const { service, plugin, contents, addFile } = createHarness();
  const first = addFile('Legacy/first.md', sourceFor('calendar-path-first'));
  const second = addFile('Legacy/second.md', sourceFor('calendar-path-second'));
  addFile('_records/calendar-events/Readable.md', '# unrelated collision\n');
  const snapshot = await service.snapshot();
  const entries = [
    {
      operation: 'reidentify',
      reference: first,
      nextId: 'calendar-path-first-next',
      fileName: 'Readable',
      updates: [{ title: '[[ _records/calendar-events/Readable (2)|Readable ]]' }],
    },
    {
      operation: 'reidentify',
      reference: second,
      nextId: 'calendar-path-second-next',
      fileName: 'Second readable',
      updates: [],
    },
  ];
  const plan = await service.planIdentityChanges(entries, snapshot);
  assert.deepEqual(plan?.entries.map((entry) => entry.expectedPath), [
    '_records/calendar-events/Readable (2).md',
    '_records/calendar-events/Second readable.md',
  ]);
  assert.equal((await service.reidentify(first, entries[0].nextId, { kind: 'automation' }, {
    fileName: entries[0].fileName,
    expectedPath: plan.entries[0].expectedPath,
    planToken: plan.token,
  }))?.path, '_records/calendar-events/Readable (2).md');
  assert.equal((await service.reidentify(second, entries[1].nextId, { kind: 'automation' }, {
    fileName: entries[1].fileName,
    expectedPath: plan.entries[1].expectedPath,
    planToken: plan.token,
  }))?.path, '_records/calendar-events/Second readable.md');

  const sameIdPlan = await planCurrent(service, [{
    operation: 'reidentify',
    reference: 'calendar-path-second-next',
    nextId: 'calendar-path-second-next',
    fileName: 'Same identity rename',
    updates: [],
  }]);
  assert.equal((await service.reidentify('calendar-path-second-next', 'calendar-path-second-next', { kind: 'automation' }, {
    fileName: 'Same identity rename',
    expectedPath: sameIdPlan.entries[0].expectedPath,
    planToken: sameIdPlan.token,
  }))?.path, '_records/calendar-events/Same identity rename.md');

  const guarded = addFile('Legacy/guarded.md', sourceFor('calendar-path-guarded'));
  plugin.app.vault.emit('create', guarded);
  const guardedBefore = contents.get(guarded);
  const guardedPlan = await planCurrent(service, [{
    operation: 'reidentify',
    reference: guarded,
    nextId: 'calendar-path-guarded-next',
    fileName: 'Guarded',
    updates: [],
  }]);
  plugin.settings.nativeRecordRootPath = 'Changed root';
  assert.equal(await service.reidentify(guarded, 'calendar-path-guarded-next', { kind: 'automation' }, {
    fileName: 'Guarded',
    expectedPath: guardedPlan.entries[0].expectedPath,
    planToken: guardedPlan.token,
  }), null);
  assert.equal(contents.get(guarded), guardedBefore);

  const flat = createHarness('native-records', { root: 'Flat records', layout: 'flat-root' });
  const flatSource = flat.addFile('Legacy/flat.md', sourceFor('calendar-flat'));
  const flatPlan = await planCurrent(flat.service, [{
    operation: 'reidentify',
    reference: flatSource,
    nextId: 'calendar-flat-next',
    fileName: 'Flat readable',
    updates: [],
  }]);
  assert.equal(flatPlan?.entries[0].expectedPath, 'Flat records/Flat readable.md');

  const batch = createHarness();
  const batchFirst = batch.addFile('Legacy/batch-first.md', sourceFor('calendar-batch-first'));
  const batchSecond = batch.addFile('Legacy/batch-second.md', sourceFor('calendar-batch-second'));
  const sameNameEntries = [
    { operation: 'reidentify', reference: batchFirst, nextId: 'calendar-batch-first-next', fileName: 'Shared', updates: [] },
    { operation: 'reidentify', reference: batchSecond, nextId: 'calendar-batch-second-next', fileName: 'Shared', updates: [] },
    { operation: 'create', nextId: 'calendar-batch-create', kind: 'calendar-event', fileName: 'Shared', properties: { title: 'Created' } },
  ];
  const sameNamePlan = await planCurrent(batch.service, sameNameEntries);
  assert.deepEqual(sameNamePlan?.entries.map((entry) => entry.expectedPath), [
    '_records/calendar-events/Shared.md',
    '_records/calendar-events/Shared (2).md',
    '_records/calendar-events/Shared (3).md',
  ]);
  assert.deepEqual((await batch.service.applyIdentityChanges(sameNamePlan, sameNameEntries)).handles.map((handle) => handle.path), [
    '_records/calendar-events/Shared.md',
    '_records/calendar-events/Shared (2).md',
    '_records/calendar-events/Shared (3).md',
  ]);

  const vacated = createHarness();
  const vacating = vacated.addFile('_records/calendar-events/Vacated.md', sourceFor('calendar-vacating'));
  const follower = vacated.addFile('Legacy/follower.md', sourceFor('calendar-follower'));
  const vacatedPlan = await planCurrent(vacated.service, [
    { operation: 'reidentify', reference: vacating, nextId: 'calendar-vacating-next', fileName: 'Moved', updates: [] },
    { operation: 'reidentify', reference: follower, nextId: 'calendar-follower-next', fileName: 'Vacated', updates: [] },
  ]);
  assert.deepEqual(vacatedPlan?.entries.map((entry) => entry.expectedPath), [
    '_records/calendar-events/Moved.md',
    '_records/calendar-events/Vacated.md',
  ]);

  for (const interference of ['create-path', 'update-source']) {
    const concurrent = createHarness();
    const concurrentFirst = concurrent.addFile('Legacy/concurrent-first.md', sourceFor('calendar-concurrent-first'));
    const concurrentSecond = concurrent.addFile('Legacy/concurrent-second.md', sourceFor('calendar-concurrent-second'));
    const concurrentEntries = [
      { operation: 'reidentify', reference: concurrentFirst, nextId: 'calendar-concurrent-first-next', fileName: 'First planned', updates: [] },
      { operation: 'reidentify', reference: concurrentSecond, nextId: 'calendar-concurrent-second-next', fileName: 'Later planned', updates: [{ tags: ['planned'] }] },
    ];
    const concurrentPlan = await planCurrent(concurrent.service, concurrentEntries);
    const firstBefore = concurrent.contents.get(concurrentFirst);
    if (interference === 'create-path') {
      await concurrent.service.create('calendar-event', { title: 'Unrelated' }, {
        id: 'calendar-unrelated-create', fileName: 'Later planned',
      });
    } else {
      assert.equal((await concurrent.service.update(concurrentSecond, { tags: ['concurrent'] }))?.id, 'calendar-concurrent-second');
    }
    assert.equal((await concurrent.service.applyIdentityChanges(concurrentPlan, concurrentEntries)).ok, false);
    assert.equal(concurrent.contents.get(concurrentFirst), firstBefore);
    assert.equal(await concurrent.service.resolve('calendar-concurrent-first-next'), null);
  }

  const raced = createHarness();
  const racedFirst = raced.addFile('Legacy/raced-first.md', sourceFor('calendar-raced-first'));
  const racedSecond = raced.addFile('Legacy/raced-second.md', sourceFor('calendar-raced-second'));
  const racedEntries = [
    { operation: 'reidentify', reference: racedFirst, nextId: 'calendar-raced-first-next', fileName: 'Raced first', updates: [] },
    { operation: 'reidentify', reference: racedSecond, nextId: 'calendar-raced-second-next', fileName: 'Raced second', updates: [{ tags: ['planned'] }] },
  ];
  const racedPlan = await planCurrent(raced.service, racedEntries);
  const racedFirstBefore = raced.contents.get(racedFirst);
  const originalProcess = raced.vault.process;
  let releaseProcess;
  let signalProcess;
  const processStarted = new Promise((resolve) => { signalProcess = resolve; });
  const processRelease = new Promise((resolve) => { releaseProcess = resolve; });
  raced.vault.process = async (file, processor) => {
    if (file === racedSecond) {
      signalProcess();
      await processRelease;
    }
    return originalProcess(file, processor);
  };
  const unrelatedUpdate = raced.service.update(racedSecond, { tags: ['concurrent'] });
  await processStarted;
  const racedApply = raced.service.applyIdentityChanges(racedPlan, racedEntries);
  releaseProcess();
  assert.equal((await unrelatedUpdate)?.id, 'calendar-raced-second');
  assert.equal((await racedApply).ok, false);
  assert.equal(raced.contents.get(racedFirst), racedFirstBefore);
  assert.equal(await raced.service.resolve('calendar-raced-first-next'), null);

  const migrating = createHarness();
  const migrationFirst = migrating.addFile('_records/calendar-events/migration-first.md', sourceFor('calendar-migration-first'));
  const migrationSecond = migrating.addFile('_records/calendar-events/migration-second.md', sourceFor('calendar-migration-second'));
  const migrationEntries = [
    { operation: 'reidentify', reference: migrationFirst, nextId: 'calendar-migration-first-next', fileName: 'Migration first', updates: [] },
    { operation: 'reidentify', reference: migrationSecond, nextId: 'calendar-migration-second-next', fileName: 'Migration second', updates: [] },
  ];
  const migrationPlan = await planCurrent(migrating.service, migrationEntries);
  const migrationFirstBefore = migrating.contents.get(migrationFirst);
  const migrationProcess = migrating.vault.process;
  let releaseMigration;
  let signalMigration;
  const migrationStarted = new Promise((resolve) => { signalMigration = resolve; });
  const migrationRelease = new Promise((resolve) => { releaseMigration = resolve; });
  let pausedMigration = false;
  migrating.vault.process = async (file, processor) => {
    if (!pausedMigration) {
      pausedMigration = true;
      signalMigration();
      await migrationRelease;
    }
    return migrationProcess(file, processor);
  };
  const storageMigration = migrating.service.migrateStorageProfile();
  await migrationStarted;
  const migrationApply = migrating.service.applyIdentityChanges(migrationPlan, migrationEntries);
  releaseMigration();
  await storageMigration;
  assert.equal((await migrationApply).ok, false);
  assert.equal(parseNativeRecordDocument(migrating.contents.get(migrationFirst)).frontmatter.tpsId, 'calendar-migration-first');
  assert.equal(await migrating.service.resolve('calendar-migration-first-next'), null);

  const externalRace = createHarness();
  const externalFirst = externalRace.addFile('Legacy/external-first.md', sourceFor('calendar-external-first'));
  const externalSecond = externalRace.addFile('Legacy/external-second.md', sourceFor('calendar-external-second'));
  const unrelatedFile = externalRace.addFile('Unrelated.md', '# unrelated\n');
  const externalEntries = [
    { operation: 'reidentify', reference: externalFirst, nextId: 'calendar-external-first-next', fileName: 'External first', updates: [] },
    { operation: 'reidentify', reference: externalSecond, nextId: 'calendar-external-second-next', fileName: 'External second', updates: [] },
  ];
  const externalPlan = await planCurrent(externalRace.service, externalEntries);
  const externalRename = externalRace.plugin.app.fileManager.renameFile;
  let injectedExternalModify = false;
  externalRace.plugin.app.fileManager.renameFile = async (file, path) => {
    await externalRename(file, path);
    if (!injectedExternalModify) {
      injectedExternalModify = true;
      externalRace.vault.emit('modify', unrelatedFile);
    }
  };
  const partial = await externalRace.service.applyIdentityChanges(externalPlan, externalEntries);
  assert.equal(partial.ok, false);
  assert.equal(partial.failedIndex, 1);
  assert.deepEqual(partial.handles.map((handle) => handle.id), ['calendar-external-first-next']);
  assert.equal((await externalRace.service.resolve('calendar-external-first-next'))?.path, '_records/calendar-events/External first.md');
  assert.equal(await externalRace.service.resolve('calendar-external-second-next'), null);
});

test('internal identity writes keep one authoritative scan across a planned batch', async () => {
  const sourceFor = (id) => serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: `${id} body\n`, frontmatter: {
      tpsId: id,
      tpsSchemaVersion: 1,
      kind: 'calendar-event',
      title: id,
    },
  });
  const { service, vault, addFile } = createHarness('native-records', { emitModifyOnProcess: true });
  const first = addFile('_records/calendar-events/first.md', sourceFor('calendar-first'));
  const second = addFile('_records/calendar-events/second.md', sourceFor('calendar-second'));
  const originalRead = vault.read;
  let reads = 0;
  vault.read = async (file) => {
    reads += 1;
    return originalRead(file);
  };

  const snapshot = await service.snapshot();
  assert.equal(await service.canApplyIdentityPlan([
    { operation: 'reidentify', reference: first, nextId: 'calendar-first-next', updates: [] },
    { operation: 'reidentify', reference: second, nextId: 'calendar-second-next', updates: [] },
  ], snapshot.token), true);
  assert.equal((await service.reidentify(first, 'calendar-first-next'))?.id, 'calendar-first-next');
  assert.equal((await service.reidentify(second, 'calendar-second-next'))?.id, 'calendar-second-next');
  assert.equal(reads, 8);
});

test('reidentify revalidates the old ID inside the write transaction', async () => {
  const { service, plugin, vault, contents, events, indexed } = createHarness();
  const record = await service.create('calendar-event', { title: 'CAS event' }, {
    id: 'calendar-before-cas',
    now: new Date('2026-08-27T12:00:00.000Z'),
  });
  const sourcePreservingWriter = plugin.frontmatterMutationService.processOwnedKeysPreservingSource
    .bind(plugin.frontmatterMutationService);
  let injected = false;
  plugin.frontmatterMutationService.processOwnedKeysPreservingSource = async (...args) => {
    if (!injected) {
      injected = true;
      await vault.process(record.file, (source) => source.replace(
        /^tpsId: calendar-before-cas$/mu,
        'tpsId: calendar-changed-elsewhere',
      ));
    }
    return sourcePreservingWriter(...args);
  };
  const eventCount = events.length;
  const indexCount = indexed.length;

  assert.equal(await service.reidentify('calendar-before-cas', 'calendar-after-cas'), null);
  assert.match(contents.get(record.file), /^tpsId: calendar-changed-elsewhere$/mu);
  assert.doesNotMatch(contents.get(record.file), /calendar-after-cas/u);
  assert.equal(events.length, eventCount);
  assert.equal(indexed.length, indexCount);
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
  assert.equal(Object.hasOwn(raw, 'modifiedDate'), false);
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

  const beforeInvalidUpdate = contents.get(created.file);
  assert.equal(await service.update(created.file, { calories: 700, tpsId: 'forbidden', kind: 'asset' }), null);
  assert.equal(contents.get(created.file), beforeInvalidUpdate);
  const updated = await service.update(created.file, { calories: 700 });
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
  assert.equal(Object.hasOwn(parsed?.frontmatter || {}, 'tpsSchemaVersion'), false);
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

test('native draft adoption honors explicit Global path and tag exclusions', async () => {
  for (const fixture of [
    {
      exclusions: 'path:Excluded/',
      path: 'Excluded/Path draft.md',
      tags: ['keep'],
    },
    {
      exclusions: 'tag:template',
      path: 'Tagged draft.md',
      tags: ['template', 'keep'],
    },
  ]) {
    const { vault, contents } = createHarness('native-records', {
      frontmatterAutoWriteExclusions: fixture.exclusions,
    });
    const draft = await vault.create(fixture.path, serializeNativeRecordDocument({
      bom: '',
      newline: '\n',
      closer: '---',
      body: '',
      frontmatter: {
        kind: 'task',
        title: 'Excluded draft',
        tags: fixture.tags,
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(draft.path, fixture.path);
    const parsed = parseNativeRecordDocument(contents.get(draft));
    assert.equal(Object.hasOwn(parsed?.frontmatter || {}, 'tpsId'), false);
    assert.deepEqual(parsed?.frontmatter.tags, fixture.tags);
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

test('standalone task creation preserves task semantics without source or parent metadata', async () => {
  const { service, plugin, events } = createHarness();
  const rawLine = '- [ ] Standalone task #work #health [priority:: high] [scheduled:: 2026-08-29 09:00:00] [timeEstimate:: 45]';
  plugin.taskApiService.parseLine = (path, lineNumber, line) => {
    assert.equal(path, '');
    assert.equal(lineNumber, 0);
    assert.equal(line, rawLine);
    return {
      type: 'task-line',
      id: ':1',
      stableId: null,
      path: '',
      line: 1,
      lineNumber: 0,
      rawLine,
      title: 'Standalone task',
      checkbox: '[ ]',
      marker: ' ',
      status: 'todo',
      inlineStatus: '',
      isComplete: false,
      tags: ['work', 'health'],
      fields: {
        priority: 'high',
        scheduled: '2026-08-29 09:00:00',
        timeEstimate: '45',
      },
      blockLineCount: 1,
    };
  };

  const record = await service.createStandaloneTask(rawLine, {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'create-task-modal:standalone-native-task-record',
  });

  assert.equal(record.kind, 'task');
  assert.equal(record.frontmatter.title, 'Standalone task');
  assert.equal(record.frontmatter.status, 'todo');
  assert.deepEqual(record.frontmatter.tags, ['work', 'health']);
  assert.equal(record.frontmatter.priority, 'high');
  assert.equal(record.frontmatter.scheduled, '2026-08-29 09:00:00');
  assert.equal(record.frontmatter.timeEstimate, 45);
  for (const key of ['sourcePath', 'sourceLine', 'parents', 'promotionState']) {
    assert.equal(Object.hasOwn(record.frontmatter, key), false, `${key} must stay absent`);
  }
  assert.ok(events.some((event) => (
    event.type === 'explicit'
    && event.details?.source === 'create-task-modal:standalone-native-task-record'
  )));
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
  assert.equal(
    (fileNamingSource.match(/hasWorkflowOwnedFilenameEvidence\(currentFile\)/gu) || []).length,
    2,
    'title-to-filename and filename-to-title synchronization both recheck authoritative identity evidence',
  );
  assert.match(
    fileNamingSource,
    /nativeRecordService\?\.hasRecordIdentityEvidence\(file, content\)/u,
    'the mutation-boundary guard reuses one authoritative source snapshot',
  );
  assert.match(fileNamingSource, /Native-record filenames are owned by their creating workflow/u);
});

test('native filename protection survives a cold cache and malformed frontmatter', async () => {
  const { service, plugin, contents, metadata, addFile } = createHarness('native-records', { root: '/', layout: 'flat-root' });
  const validSource = [
    '---',
    'tpsId: workout-cold-cache',
    'tpsSchemaVersion: 1',
    'kind: workout-session',
    'title: Workout 2026-08-31 07.04',
    'createdDate: "2026-08-31T12:04:50.628Z"',
    'modifiedDate: "2026-08-31T12:04:50.628Z"',
    '---',
    '',
  ].join('\n');
  const valid = addFile('2026-08-31 - Workout 07.04.md', validSource);
  metadata.delete(valid);
  assert.equal(service.isRecordFile(valid), false, 'the fast cache/index check intentionally starts cold');
  assert.equal(await service.hasRecordIdentityEvidence(valid), true);

  const staleCache = addFile('2026-08-31 - Stale-cache workout.md', validSource);
  metadata.set(staleCache, { title: 'Previously ordinary' });
  assert.equal(service.isRecordFile(staleCache), false, 'stale ordinary cache contains no native marker');
  assert.equal(
    await service.hasRecordIdentityEvidence(staleCache),
    true,
    'negative cache evidence never overrides authoritative native-record bytes',
  );

  const malformedSource = [
    '---',
    'tpsId: workout-malformed',
    'tpsSchemaVersion: 1',
    'kind: workout-session',
    'title: Workout 2026-08-31 07.04',
    'icon: file-text',
    'icon: file-text',
    '!tps-test-invalid-yaml!',
    '---',
    '',
  ].join('\n');
  const malformed = addFile('Workout 2026-08-31 07.04.md', malformedSource);
  assert.equal(parseNativeRecordDocument(malformedSource), null, 'malformed YAML keeps MetadataCache unavailable');
  assert.equal(await service.hasRecordIdentityEvidence(malformed), true, 'raw identity evidence still protects the workflow filename');

  const indexedThenMalformed = addFile('2026-08-31 - Indexed workout.md', validSource);
  plugin.app.metadataCache.emit('changed', indexedThenMalformed, '', { frontmatter: parseNativeRecordDocument(validSource).frontmatter });
  assert.equal(service.isRecordFile(indexedThenMalformed), true);
  contents.set(indexedThenMalformed, malformedSource);
  metadata.delete(indexedThenMalformed);
  plugin.app.metadataCache.emit('changed', indexedThenMalformed, '', { frontmatter: undefined });
  assert.equal(service.isRecordFile(indexedThenMalformed), false, 'the malformed cache event clears the fast identity index');
  assert.equal(await service.hasRecordIdentityEvidence(indexedThenMalformed), true, 'authoritative bytes retain protection after index loss');

  assert.equal(
    service.hasRecordIdentityEvidenceInFrontmatter(parseNativeRecordDocument(validSource).frontmatter),
    true,
    'the synchronous mutation-boundary classifier recognizes a valid record',
  );
  assert.equal(
    service.hasRecordIdentityEvidenceInFrontmatter({ tpsId: '' }),
    true,
    'the mutation-boundary classifier fails closed for an incomplete identity property',
  );
  assert.equal(
    service.hasRecordIdentityEvidenceInFrontmatter({ tpsSchemaVersion: 'not-a-version' }),
    true,
    'the mutation-boundary classifier fails closed for malformed schema-only evidence',
  );
  assert.equal(
    service.hasRecordIdentityEvidenceInFrontmatter({ title: 'Ordinary note' }),
    false,
    'ordinary frontmatter remains eligible for generic automation',
  );

  const ordinaryMalformed = addFile('Ordinary malformed.md', '---\ntitle: Ordinary\nicon: one\nicon: two\n---\n');
  assert.equal(await service.hasRecordIdentityEvidence(ordinaryMalformed), false);
});

test('legacy mode rejects new record creation and leaves existing behavior opt-in', async () => {
  const { service } = createHarness('legacy');
  assert.equal(service.getMode(), 'legacy');
  await assert.rejects(
    service.create('task', { title: 'Must not create' }),
    /requires the native-records data architecture mode/u,
  );
});

test('native record creation rechecks architecture after asynchronous folder preparation', async () => {
  const { service, plugin, vault, entries } = createHarness('native-records', { root: 'Records' });
  const createFolder = vault.createFolder;
  vault.createFolder = async (path) => {
    const result = await createFolder(path);
    plugin.settings.dataArchitectureMode = 'legacy';
    return result;
  };

  await assert.rejects(
    service.create('task', { title: 'Do not create after mode change' }),
    /requires the native-records data architecture mode/u,
  );
  assert.equal(
    [...entries.values()].filter((entry) => entry instanceof TFile).length,
    0,
    'folder preparation may finish, but no record file is written after the mode change',
  );
});

test('standalone task creation rechecks its semantic mapping after asynchronous folder preparation', async () => {
  const { service, plugin, vault, entries } = createHarness('native-records', { root: 'Records' });
  const rawLine = '- [ ] Mapping race task';
  plugin.taskApiService.parseLine = () => ({
    type: 'task-line',
    id: ':1',
    stableId: null,
    path: '',
    line: 1,
    lineNumber: 0,
    rawLine,
    title: 'Mapping race task',
    checkbox: '[ ]',
    marker: ' ',
    status: 'todo',
    inlineStatus: '',
    isComplete: false,
    tags: [],
    fields: {},
    blockLineCount: 1,
  });
  let mappingCurrent = true;
  const createFolder = vault.createFolder;
  vault.createFolder = async (path) => {
    const result = await createFolder(path);
    mappingCurrent = false;
    return result;
  };

  await assert.rejects(
    service.createStandaloneTask(rawLine, undefined, () => mappingCurrent),
    /checkbox mapping changed/u,
  );
  assert.equal(
    [...entries.values()].filter((entry) => entry instanceof TFile).length,
    0,
    'mapping changes may leave an empty prepared folder but never a stale-status task record',
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
  assert.match(apiSource, /capabilities: Object\.freeze\(\{ customKinds: true, calendarTemplateRecords: true \}\)/u);
  assert.match(apiSource, /const nativeRecordsApi = \{[\s\S]{0,300}version: plugin\.nativeRecordService\.version[\s\S]{0,1800}createAsset:[\s\S]{0,1800}resolve:[\s\S]{0,300}list:[\s\S]{0,300}snapshot:[\s\S]{0,1800}canCreateIdentity:[\s\S]{0,800}canApplyIdentityPlan:[\s\S]{0,800}planIdentityChanges:[\s\S]{0,800}applyIdentityChanges:[\s\S]{0,800}canReidentify:[\s\S]{0,800}reidentify:[\s\S]{0,800}rename:[\s\S]{0,800}archive:/u);
  assert.match(readFileSync(new URL('../src/services/native-record-service.ts', import.meta.url), 'utf8'), /readonly version = 6;/u);
  assert.match(apiSource, /ensureAsset:[\s\S]{0,700}resolveAsset:/u);
  assert.match(apiSource, /const taskRecordsApi = \{[\s\S]{0,200}version: 1[\s\S]{0,500}promote:[\s\S]{0,900}resolve:/u);
  assert.match(apiSource, /nativeRecords: nativeRecordsApi,[\s\S]{0,100}taskRecords: taskRecordsApi/u);
});
