import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

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
        export { ParentLinkResolutionService } from '../src/services/parent-link-resolution-service.ts';
        export { ItemHistoryService } from '../src/services/item-history-service.ts';
        export { MemoryItemHistoryStore } from '../src/services/item-history-store.ts';
        export { FileNamingService } from '../src/services/file-naming-service.ts';
        export { matchesAutomaticMutationPathExclusion } from '../src/utils/template-protection';
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
        // Count the actual classifier only in this test bundle; no runtime hook ships.
        builder.onLoad({ filter: /native-record-service\.ts$/ }, (args) => {
          let contents = readFileSync(args.path, 'utf8');
          const marker = 'function inspectWithProfile(\n  raw: Record<string, unknown>,\n  profile: TpsNativeRecordStorageProfile,\n): TpsNativeRecordInspection | null {';
          assert.equal(contents.includes(marker), true, 'profile inspection counter must target the real function');
          contents = contents.replace(marker, `${marker}\n  globalThis.__nativeRecordProfileInspection?.(raw, profile);`);
          const copyMarker = 'const frontmatter = { ...raw } as TpsNativeRecordEnvelope;';
          assert.equal(contents.includes(copyMarker), true, 'envelope counter must target the real copy');
          contents = contents.replace(copyMarker, `globalThis.__nativeRecordEnvelopeCopy?.(raw, profile);\n  ${copyMarker}`);
          return { contents, loader: 'ts', resolveDir: dirname(args.path) };
        });
        builder.onLoad({ filter: /native-record-document\.ts$/ }, (args) => {
          let contents = readFileSync(args.path, 'utf8');
          const marker = 'export function parseNativeRecordDocument(content: string): ParsedNativeRecordDocument | null {';
          assert.equal(contents.includes(marker), true, 'authoritative parse counter must target the same extracted parser');
          contents = contents.replace(marker, `${marker}\n  globalThis.__nativeRecordAuthoritativeParse?.();`);
          return { contents, loader: 'ts', resolveDir: dirname(args.path) };
        });
        builder.onResolve({ filter: /property-migration-modal$/ }, () => ({ path: 'modal', namespace: 'migration-modal-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'migration-modal-test' }, () => ({ contents: 'export class PropertyMigrationModal { static async confirm(){ return true; } }' }));
        builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'native-record-test' }));
        builder.onResolve({ filter: /^\.\.\/logger$/u }, () => ({ path: 'logger', namespace: 'native-record-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'native-record-test' }, (args) => {
          if (args.path === 'logger') {
            return { loader: 'js', contents: 'export const flow = () => {}; export const flowWarn = () => {}; export const flowError = () => {}; export const perf = () => {}; export const warn = () => {}; export const error = () => {}; export const debug = () => {};' };
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
  ParentLinkResolutionService,
  ItemHistoryService,
  MemoryItemHistoryStore,
  FileNamingService,
  matchesAutomaticMutationPathExclusion,
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

test('indexed snapshots are synchronous display projections with zero inventory or body reads', async () => {
  const h = createHarness('native-records', { deferSetup: true });
  const task = h.addFile('Task.md', '---\ntpsId: one\nkind: task\ntitle: One\n---\nBody');
  assert.deepEqual(h.service.indexedSnapshot(), { ready: false, records: [] });
  await h.service.setup();
  assert.equal(h.service.indexedSnapshot().ready, false, 'initial discovery alone is not metadata completion');
  h.plugin.app.metadataCache.emit('resolved');
  const counts = { inventory: 0, reads: 0, writes: 0 };
  for (const [method, key] of [['getMarkdownFiles', 'inventory'], ['read', 'reads'], ['cachedRead', 'reads'], ['process', 'writes']]) {
    const original = h.vault[method];
    h.vault[method] = (...args) => { counts[key]++; return original(...args); };
  }
  for (let i = 0; i < 100; i++) {
    const result = h.service.indexedSnapshot('task', { includeConflicts: true });
    assert.equal(result.ready, true); assert.equal(result.records[0].file, task);
    assert.equal(result.records[0].id, 'one'); assert.deepEqual(result.conflicts, []);
    assert.equal('token' in result, false); assert.equal('revision' in result, false);
  }
  assert.deepEqual(counts, { inventory: 0, reads: 0, writes: 0 });
  h.service.dispose(); assert.equal(h.service.indexedSnapshot().ready, false);
});

test('metadata resolution restores display readiness without weakening later source authority or ID reservation', async () => {
  const h = createHarness('native-records', { deferSetup: true });
  const file = h.addFile('Task.md', '---\ntpsId: old\nkind: task\ntitle: Old\n---\nBody');
  await h.service.setup(); h.plugin.app.metadataCache.emit('resolved');
  await h.service.snapshot();
  const next = '---\ntpsId: new\nkind: task\ntitle: New\n---\nBody';
  h.contents.set(file, next); h.vault.emit('modify', file);
  const generation = h.service.identitySourceGeneration;
  assert.equal(h.service.indexedSnapshot().ready, false);
  h.plugin.app.metadataCache.emit('changed', file, '', { frontmatter: h.metadata.get(file) });
  assert.equal(h.service.indexedSnapshot().ready, false, 'a per-file stale changed event is not completion');
  h.metadata.set(file, parseNativeRecordDocument(next).frontmatter);
  h.plugin.app.metadataCache.emit('resolved');
  assert.equal(h.service.indexedSnapshot().records[0].id, 'new');
  assert.equal(h.service.identitySourceGeneration, generation);
  assert.equal(h.service.authoritativeSourceCache.has(file.path), false);
  assert.equal(h.service.authoritativeIndexDirtyPaths.has(file.path), true);
  let reads = 0; const read = h.vault.read;
  h.vault.read = async (...args) => { reads++; return read(...args); };
  assert.equal(await h.service.canCreateIdentity('new'), false, 'resolved metadata cannot authorize a conflicting new ID');
  assert.equal(reads, 1, 'the invalidated current source is still verified at reservation');
  assert.equal((await h.service.snapshot()).records[0].id, 'new');
  assert.equal(reads, 1, 'current source reuse remains intact');
});

test('indexed kind filtering still reports conflicts in other kinds', async () => {
  const h = createHarness('native-records', { deferSetup: true });
  h.addFile('Task1.md', '---\ntpsId: duplicate\nkind: task\ntitle: One\n---\n');
  h.addFile('Task2.md', '---\ntpsId: duplicate\nkind: task\ntitle: Two\n---\n');
  h.addFile('Calendar.md', '---\ntpsId: event\nkind: calendar-event\ntitle: Event\n---\n');
  await h.service.setup(); h.plugin.app.metadataCache.emit('resolved');
  const projected = h.service.indexedSnapshot('calendar-event', { includeConflicts: true });
  assert.equal(projected.ready, true); assert.equal(projected.records.length, 1);
  assert.deepEqual(projected.conflicts.map(conflict => conflict.path), ['Task1.md', 'Task2.md']);
  assert.throws(() => h.service.indexedSnapshot('calendar-event'), /identity conflicts/u);
});

test('disabled retired history performs no store startup, pruning or publication wait', async () => {
  const tasks = manualStartupTasks(); const h = startupLoad('native-records', 2);
  h.plugin.settings.enableItemHistory = false;
  let storeCalls = 0;
  class UnavailableRetiredStore extends MemoryItemHistoryStore {
    async setup() { storeCalls++; throw new Error('retired store must not open'); }
    async clearPending() { storeCalls++; }
    async prune() { storeCalls++; }
  }
  const p = coldStartupHarness(h, { historyStore: new UnavailableRetiredStore() });
  const loaded = p.plugin.onload();
  try {
    await loaded; p.layout(); await tasks.drain(); await flushStartupMicrotasks();
    assert.deepEqual(p.publications, [2]); assert.equal(storeCalls, 0);
    assert.equal(p.plugin.itemHistoryService.activationMaintenance, null);
  } finally { p.unload(); await tasks.drain(); tasks.restore(); }
});

test('computed native fields use atomic current source, preserve authored bytes, and update title in the same action', async () => {
  const h = createHarness('native-records', { identityMode: 'property', schemaPropertyKey: '', modifiedPropertyKey: 'updated' });
  const created = await h.service.create('nutrition-log', { title: 'Food', quantity: 1, calories: 100 }, { id: 'food' });
  const source = h.contents.get(created.file).replace('quantity: 1', 'quantity: 3').replace('calories: 100', '# authored comment\ncalories: 100') + 'Authored body\n';
  const process = h.vault.process;
  h.vault.process = async (file, processor) => {
    h.contents.set(file, source);
    return process(file, processor);
  };
  let observedQuantity;
  const result = await h.service.updateFromSource(created.id, ['calories', 'title'], current => {
    observedQuantity = current.quantity;
    return { calories: Number(current.quantity) * 100, title: 'Updated food' };
  });
  assert.equal(observedQuantity, 3); assert.equal(result.frontmatter.calories, 300);
  const next = h.contents.get(created.file);
  assert.match(next, /quantity: 3/u); assert.match(next, /# authored comment\ncalories: 300/u);
  assert.match(next, /title: Updated food/u); assert.equal(parseNativeRecordDocument(next).body, 'Authored body\n');
  assert.equal(result.id, 'food'); assert.equal(result.kind, 'nutrition-log');
});

test('computed no-ops and rejected callbacks preserve source and modified timestamps', async () => {
  const h = createHarness('native-records', { identityMode: 'property', schemaPropertyKey: '', modifiedPropertyKey: 'updated' });
  const created = await h.service.create('nutrition-log', { title: 'Food', calories: 100 }, { id: 'food' });
  const before = h.contents.get(created.file); let events = h.events.length;
  assert.equal((await h.service.updateFromSource(created.id, ['calories'], current => ({ calories: current.calories }))).id, 'food');
  assert.equal(h.contents.get(created.file), before); assert.equal(h.events.length, events);
  for (const [keys, compute] of [
    [['calories'], () => null], [['calories'], () => ({ protein: 10 })],
    [['tpsId'], () => ({ tpsId: 'other' })], [['kind'], () => ({ kind: 'task' })],
    [['modifiedDate'], () => ({ modifiedDate: 'later' })], [['tags'], () => ({ tags: ['changed'] })],
    [['calories'], async () => ({ calories: 300 })], [['calories'], () => Promise.resolve({ calories: 300 })],
  ]) {
    assert.equal(await h.service.updateFromSource(created.id, keys, compute), null);
    assert.equal(h.contents.get(created.file), before); assert.equal(h.events.length, events);
  }
});

test('computed fields reject stale mappings, concurrent identity arrivals, and current-source exclusions', async () => {
  for (const change of ['mapping', 'identity', 'excluded-tag', 'excluded-path', 'excluded-template', 'unsafe-tag']) {
    const h = createHarness();
    const record = await h.service.create('nutrition-log', { title: 'Food', calories: 100 }, { id: 'food' });
    const before = h.contents.get(record.file); const process = h.vault.process; let computations = 0;
    h.vault.process = async (file, processor) => {
      if (change === 'mapping') h.plugin.settings.nativeRecordTitlePropertyKey = 'newTitle';
      if (change === 'identity') {
        const duplicate = h.addFile('Duplicate.md', before); h.vault.emit('create', duplicate);
      }
      if (change === 'excluded-tag') {
        h.plugin.settings.frontmatterAutoWriteExclusions = 'tag:protected';
        h.contents.set(file, before.replace('\n---\n', '\ntags:\n  - protected\n---\n'));
      }
      if (change === 'excluded-path') h.plugin.settings.frontmatterAutoWriteExclusions = file.path;
      if (change === 'excluded-template') {
        h.plugin.settings.frontmatterAutoWriteExclusions = 'tag:custom-blueprint';
        h.plugin.settings.templateIdentificationTag = 'custom-blueprint';
        h.contents.set(file, before.replace('\n---\n', '\ntags:\n  - custom-blueprint\n---\n'));
      }
      if (change === 'unsafe-tag') {
        h.plugin.settings.frontmatterAutoWriteExclusions = 'tag:custom-blueprint';
        h.contents.set(file, before.replace('\n---\n', '\ntags: 42\n---\n'));
      }
      return process(file, processor);
    };
    assert.equal(await h.service.updateFromSource(record.id, ['calories'], () => {
      computations++; return { calories: 300 };
    }, { kind: 'automation' }), null);
    assert.equal(computations, 0, change);
    assert.equal(parseNativeRecordDocument(h.contents.get(record.file)).frontmatter.calories, 100, change);
  }
});

test('computed automation rejects configured path exclusion before entering the serialized writer', async () => {
  const h = createHarness(); const record = await h.service.create('nutrition-log', { title: 'Food', calories: 100 }, { id: 'food' });
  await h.service.snapshot(); h.plugin.settings.frontmatterAutoWriteExclusions = record.path;
  let writes = 0, computations = 0; const process = h.vault.process;
  h.vault.process = (...args) => { writes++; return process(...args); };
  assert.equal(await h.service.updateFromSource(record.id, ['calories'], () => { computations++; return { calories: 200 }; }, { kind: 'automation' }), null);
  assert.equal(writes, 0); assert.equal(computations, 0);
  assert.equal(parseNativeRecordDocument(h.contents.get(record.file)).frontmatter.calories, 100);
});

test('twenty computed nutrition writes retain one existing authority index instead of rescanning the vault', async () => {
  const h = createHarness(); const records = [];
  for (let i = 0; i < 20; i++) records.push(await h.service.create('nutrition-log', { title: `Food ${i}`, calories: 100 }, { id: `food-${i}` }));
  await h.service.snapshot(); let inventories = 0, reads = 0, cachedReads = 0, processes = 0;
  const inventory = h.vault.getMarkdownFiles, read = h.vault.read, cachedRead = h.vault.cachedRead, process = h.vault.process;
  h.vault.getMarkdownFiles = () => { inventories++; return inventory(); };
  h.vault.read = (...args) => { reads++; return read(...args); };
  h.vault.cachedRead = (...args) => { cachedReads++; return cachedRead(...args); };
  h.vault.process = (...args) => { processes++; return process(...args); };
  for (const record of records) {
    const updated = await h.service.updateFromSource(record.id, ['calories'], current => ({ calories: Number(current.calories) + 10 }));
    assert.equal(updated.frontmatter.calories, 110);
  }
  assert.deepEqual({ inventories, reads, cachedReads, processes }, { inventories: 0, reads: 0, cachedReads: 0, processes: 20 },
    'warm ID handles use the existing identity index; each writer computes against its selected atomic current source');
});

test('computed selected-path edits read only their selected source and preserve custom kind and business property names', async () => {
  const h = createHarness('native-records', { kindPropertyKey: 'recordType', titlePropertyKey: 'name' });
  const records = [];
  for (let i = 0; i < 20; i++) records.push(await h.service.create('nutrition-log', { title: `Food ${i}`, energy: 100 }, { id: `food-${i}` }));
  await h.service.snapshot(); let inventories = 0, reads = 0, cachedReads = 0, processes = 0;
  const inventory = h.vault.getMarkdownFiles, read = h.vault.read, cachedRead = h.vault.cachedRead, process = h.vault.process;
  h.vault.getMarkdownFiles = () => { inventories++; return inventory(); };
  h.vault.read = (...args) => { reads++; return read(...args); };
  h.vault.cachedRead = (...args) => { cachedReads++; return cachedRead(...args); };
  h.vault.process = (...args) => { processes++; return process(...args); };
  for (const record of records) {
    const updated = await h.service.updateFromSource(record.path, ['energy', 'title'], current => {
      assert.equal(current.kind, 'nutrition-log'); return { energy: Number(current.energy) + 10, title: `${current.title} edited` };
    });
    assert.equal(updated.frontmatter.energy, 110); assert.equal(updated.kind, 'nutrition-log');
    const current = parseNativeRecordDocument(h.contents.get(record.file)).frontmatter;
    assert.equal(current.recordType, 'nutrition-log'); assert.equal(current.name, `${record.frontmatter.title} edited`); assert.equal(current.title, undefined);
  }
  assert.deepEqual({ inventories, reads, cachedReads, processes }, { inventories: 0, reads: 20, cachedReads: 0, processes: 20 },
    'selected paths require selected fresh reads only; no global authority scan is repeated');
});

test('identity batch interruption retains the committed prefix and never starts the next creation', async () => {
  const h = createHarness(); let current = true;
  const entries = [0, 1].map(i => ({ operation: 'create', nextId: `new-${i}`, kind: 'task', properties: { title: `New ${i}` } }));
  const plan = await h.service.planIdentityChanges(entries, await h.service.snapshot());
  const create = h.vault.create; let creates = 0;
  h.vault.create = async (...args) => { creates++; const file = await create(...args); current = false; return file; };
  const applied = await h.service.applyIdentityChanges(plan, entries, { kind: 'automation' }, { isCurrent: () => current });
  assert.equal(applied.ok, false); assert.equal(applied.failedIndex, 1);
  assert.equal(applied.error, 'native-identity-apply-interrupted'); assert.equal(creates, 1);
  assert.deepEqual(applied.handles.map(handle => handle.id), ['new-0']);
  assert.ok(h.vault.getFileByPath('_records/tasks/new-0.md'));
  assert.equal(h.vault.getFileByPath('_records/tasks/new-1.md'), null);
});

test('identity batch checks the caller owner at the queued source-write boundary', async () => {
  const h = createHarness(); const record = await h.service.create('task', { title: 'Original' }, { id: 'old' });
  const before = h.contents.get(record.file); let current = true;
  const entries = [{ operation: 'reidentify', nextId: 'new', reference: record.id, updates: [{ title: 'Changed' }] }];
  const plan = await h.service.planIdentityChanges(entries, await h.service.snapshot());
  const process = h.vault.process;
  h.vault.process = (file, processor) => { current = false; return process(file, processor); };
  const applied = await h.service.applyIdentityChanges(plan, entries, { kind: 'automation' }, { isCurrent: () => current });
  assert.equal(applied.ok, false); assert.equal(applied.error, 'native-identity-apply-interrupted');
  assert.deepEqual(applied.handles, []); assert.equal(h.contents.get(record.file), before);
});

test('interruption after reidentification reports its committed handle and skips later business updates', async () => {
  const h = createHarness(); const record = await h.service.create('task', { title: 'Original' }, { id: 'old' });
  let current = true; const entries = [{ operation: 'reidentify', nextId: 'new', reference: record.id, updates: [{ title: 'Changed' }] }];
  const plan = await h.service.planIdentityChanges(entries, await h.service.snapshot());
  const process = h.vault.process;
  h.vault.process = async (...args) => { const value = await process(...args); current = false; return value; };
  const applied = await h.service.applyIdentityChanges(plan, entries, { kind: 'automation' }, { isCurrent: () => current });
  assert.equal(applied.ok, false); assert.equal(applied.error, 'native-identity-apply-interrupted');
  assert.equal(applied.handles[0].id, 'new'); assert.equal(applied.handles[0].frontmatter.title, 'Original');
  assert.equal(parseNativeRecordDocument(h.contents.get(record.file)).frontmatter.tpsId, 'new');
});

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
      workspace: { layoutReady: options.layoutReady !== false },
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
  if (!options.deferSetup) service.setup();
  return { service, plugin, vault, entries, contents, metadata, events, indexed, addFile };
}

async function committedTitleRenameHarness(options = {}) {
  const h = createHarness('native-records', { root: 'Inbox', layout: 'flat-root', ...options });
  h.plugin.nativeRecordService = h.service;
  Object.assign(h.plugin.settings, {
    autoSyncTitleFromFilename: true, enableAutoRename: true, dailyNoteDateFormat: 'YYYY-MM-DD',
    properties: [], folderExclusions: '',
  });
  h.plugin.shouldIgnoreAutoFrontmatterWrite = () => false;
  h.plugin.matchesAutoFrontmatterExclusionPattern = matchesAutomaticMutationPathExclusion;
  h.plugin.bulkEditService = { shouldSkipNoteLevelRecurrence: async () => false };
  h.naming = h.plugin.fileNamingService = new FileNamingService(h.plugin);
  await h.naming.whenDailyNoteConfigurationReady();
  h.syncRename = (file, oldPath) => h.naming.syncTitleFromFilename(file, {
    bypassCreationGrace: true, renamedFromPath: oldPath,
  });
  h.counts = { inventories: 0, rawReads: 0, cachedReads: 0, processes: 0, writes: 0, renames: 0 };
  for (const [method, counter] of [['getMarkdownFiles', 'inventories'], ['read', 'rawReads'], ['cachedRead', 'cachedReads'], ['rename', 'renames']]) {
    const original = h.vault[method];
    h.vault[method] = (...args) => { h.counts[counter]++; return original(...args); };
  }
  const process = h.vault.process;
  h.vault.process = async (file, mutate) => {
    h.counts.processes++;
    return process(file, source => {
      const next = mutate(source);
      if (next !== source) h.counts.writes++;
      return next;
    });
  };
  return h;
}

test('committed native filename edits propagate the configured title once without another rename or vault inventory', async () => {
  const h = await committedTitleRenameHarness({ titlePropertyKey: 'name', kindPropertyKey: 'recordType' });
  const record = await h.service.create('task', { title: 'Untitled', status: 'todo' }, { id: 'title-one', fileName: 'Untitled' });
  const before = h.contents.get(record.file).replace('\n---\n', '\n# Keep this comment\nother: preserved\n---\n') + 'Keep body\r\n- [ ] Keep checklist\n';
  h.contents.set(record.file, before);
  h.metadata.set(record.file, parseNativeRecordDocument(before).frontmatter);
  const oldPath = record.file.path;
  await h.vault.rename(record.file, 'Inbox/My task.md');
  for (const key of Object.keys(h.counts)) h.counts[key] = 0;
  await h.syncRename(record.file, oldPath);
  assert.equal(record.file.path, 'Inbox/My task.md');
  const after = h.contents.get(record.file);
  assert.equal(parseNativeRecordDocument(after).frontmatter.name, 'My task');
  assert.equal(parseNativeRecordDocument(after).frontmatter.title, undefined);
  assert.equal(after, before.replace('name: Untitled', 'name: My task'));
  assert.deepEqual(h.counts, { inventories: 0, rawReads: 1, cachedReads: 0, processes: 1, writes: 1, renames: 0 });
  const stableCounts = { ...h.counts };
  for (let i = 0; i < 100; i++) await h.syncRename(record.file, oldPath);
  assert.deepEqual(h.counts, stableCounts, 'unchanged duplicate observations do not enter the writer or read sources');
});

test('committed native rename can inspect a cold metadata title through the existing selected-source owner', async () => {
  const h = await committedTitleRenameHarness();
  const record = await h.service.create('task', { title: 'Before' }, { id: 'cold-rename' });
  const oldPath = record.file.path;
  await h.vault.rename(record.file, 'Inbox/After.md');
  h.metadata.delete(record.file);
  for (const key of Object.keys(h.counts)) h.counts[key] = 0;
  await h.syncRename(record.file, oldPath);
  assert.equal(parseNativeRecordDocument(h.contents.get(record.file)).frontmatter.title, 'After');
  assert.equal(h.counts.writes, 1);
  assert.equal(h.counts.inventories, 0);
});

test('internal native import filename maintenance is captured synchronously and never changes the authored title', async () => {
  const h = await committedTitleRenameHarness();
  const record = await h.service.create('task', { title: 'Authored: title?' }, { id: 'internal-rename' });
  const before = h.contents.get(record.file);
  const pending = [];
  h.vault.on('rename', (file, oldPath) => {
    assert.equal(h.service.isInternalIdentityWrite(oldPath), true);
    assert.equal(h.service.isInternalIdentityWrite(file.path), true);
    pending.push(h.syncRename(file, oldPath));
  });
  await h.service.rename(record.file, 'Import owned name', { kind: 'automation' });
  await Promise.all(pending);
  assert.equal(h.contents.get(record.file), before);
  assert.equal(h.counts.processes, 0);
  assert.equal(h.service.isInternalIdentityWrite(record.file.path), false);
});

for (const condition of ['title', 'filename', 'replacement', 'identity', 'daily', 'process', 'tag', 'path', 'folder', 'setting']) {
  test(`committed native title propagation preserves a newer ${condition} at the atomic writer`, async () => {
    const h = await committedTitleRenameHarness();
    const record = await h.service.create('task', { title: 'Before' }, { id: `race-${condition}` });
    const oldPath = record.file.path;
    await h.vault.rename(record.file, 'Inbox/After.md');
    for (const key of Object.keys(h.counts)) h.counts[key] = 0;
    const before = h.contents.get(record.file);
    let expected = before;
    const process = h.vault.process;
    h.vault.process = async (file, mutate) => {
      if (condition === 'title') expected = before.replace('title: Before', 'title: Newer title');
      if (condition === 'identity') expected = before.replace(`tpsId: race-${condition}`, 'tpsId: new-identity');
      if (condition === 'daily') expected = before.replace('kind: task', 'kind: dailynote');
      if (condition === 'process') expected = before.replace('\n---\n', '\nrunType: active\n---\n');
      if (condition === 'tag') {
        h.plugin.settings.frontmatterAutoWriteExclusions = 'tag:keep';
        expected = before.replace('\n---\n', '\ntags:\n  - keep\n---\n');
      }
      if (condition === 'path') h.plugin.settings.frontmatterAutoWriteExclusions = file.path;
      if (condition === 'folder') h.plugin.settings.folderExclusions = 'Inbox/';
      if (condition === 'setting') h.plugin.settings.autoSyncTitleFromFilename = false;
      if (condition === 'filename') await h.vault.rename(file, 'Inbox/Latest name.md');
      if (condition === 'replacement') h.addFile(file.path, before.replace('title: Before', 'title: Replacement'));
      h.contents.set(file, expected);
      return process(file, mutate);
    };
    await h.syncRename(record.file, oldPath);
    assert.equal(h.contents.get(record.file), expected);
    assert.equal(h.counts.writes, 0);
    assert.equal(h.counts.inventories, 0);
  });
}

test('committed native title propagation preserves current duplicate identity conflicts', async () => {
  const h = await committedTitleRenameHarness();
  const record = await h.service.create('task', { title: 'Before' }, { id: 'duplicate-rename' });
  const oldPath = record.file.path;
  await h.vault.rename(record.file, 'Inbox/After.md');
  const before = h.contents.get(record.file);
  const duplicate = h.addFile('Inbox/Duplicate.md', before);
  h.vault.emit('create', duplicate);
  await h.syncRename(record.file, oldPath);
  assert.equal(h.contents.get(record.file), before);
  assert.equal(h.counts.writes, 0);
});

for (const field of ['id', 'kind', 'title']) {
  test(`committed native propagation rejects changed ${field} before the selected source read`, async () => {
    const h = await committedTitleRenameHarness();
    const record = await h.service.create('task', { title: 'Before' }, { id: 'source-before-read' });
    const oldPath = record.file.path;
    await h.vault.rename(record.file, 'Inbox/After.md');
    const before = h.contents.get(record.file);
    const expected = field === 'id' ? before.replace('tpsId: source-before-read', 'tpsId: new-owner')
      : field === 'kind' ? before.replace('kind: task', 'kind: food-entry')
        : before.replace('title: Before', 'title: Current title');
    const update = h.service.updateFromSource.bind(h.service);
    h.service.updateFromSource = (...args) => { h.contents.set(record.file, expected); return update(...args); };
    await h.syncRename(record.file, oldPath);
    assert.equal(h.contents.get(record.file), expected);
    assert.equal(h.counts.writes, 0);
  });
}

test('committed native propagation fails closed on a malformed current source and leaves the renamed file in place', async () => {
  const h = await committedTitleRenameHarness();
  const record = await h.service.create('task', { title: 'Before' }, { id: 'malformed-title' });
  const oldPath = record.file.path;
  await h.vault.rename(record.file, 'Inbox/After.md');
  const malformed = '---\n!tps-test-invalid-yaml!\n---\nCurrent body\n';
  h.contents.set(record.file, malformed);
  await h.syncRename(record.file, oldPath);
  assert.equal(h.contents.get(record.file), malformed);
  assert.equal(record.file.path, 'Inbox/After.md');
  assert.equal(h.counts.writes, 0);
});

test('committed native rename keeps generic create/open synchronization and disabled settings inactive', async () => {
  const h = await committedTitleRenameHarness();
  const record = await h.service.create('task', { title: 'Authored title' }, { id: 'no-generic-rename' });
  const before = h.contents.get(record.file);
  for (let i = 0; i < 100; i++) await h.naming.syncTitleFromFilename(record.file, { force: true, bypassCreationGrace: true });
  assert.equal(h.contents.get(record.file), before);
  assert.equal(h.counts.rawReads, 0);
  assert.equal(h.counts.cachedReads, 0);
  h.plugin.settings.autoSyncTitleFromFilename = false;
  const oldPath = record.file.path;
  await h.vault.rename(record.file, 'Inbox/User name.md');
  await h.syncRename(record.file, oldPath);
  assert.equal(h.contents.get(record.file), before);
  assert.equal(h.counts.writes, 0);
});

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
  await assert.rejects(service.create('calendar-event', { title: 'Invalid kind', kind: [42] }, { id: calendarId() }), /kind must be text or a list of text/u);
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

function inspectMigration(service, value) {
  const previous = service.readingMigrationSources;
  service.readingMigrationSources = true;
  try { return service.inspect(value); } finally { service.readingMigrationSources = previous; }
}

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
  assert.equal(inspectMigration(service, parsed.frontmatter)?.id, 'food:one');
  assert.equal((await service.resolve('food:one'))?.frontmatter.calories, 420);

  const updated = await service.update(created.file, { title: 'Updated lunch', calories: 500 });
  assert.equal(updated?.frontmatter.title, 'Updated lunch');
  const updatedRaw = parseNativeRecordDocument(contents.get(created.file)).frontmatter;
  assert.equal(updatedRaw.title, 'Updated lunch');
  assert.equal(updatedRaw.calories, 500);
  assert.equal(Object.hasOwn(updatedRaw, 'modifiedDate'), false);
  assert.equal(inspectMigration(service, {
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
  assert.equal(inspectMigration(service, {
    kind: 'task',
    title: 'Delayed legacy arrival',
    tags: ['todo', 'legacy/pinned/v1/task/task-delayed'],
  })?.id, 'task-delayed');
  assert.equal(inspectMigration(service, {
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
  assert.equal(inspectMigration(service, {
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
  assert.equal(inspectMigration(service, parseNativeRecordDocument(contents.get(dormant)).frontmatter)?.id, 'task-dormant-current');
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
  const fallbackInspection = inspectMigration(service, parseNativeRecordDocument(contents.get(partiallyMigrated)).frontmatter);
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
  assert.equal(inspectMigration(service, parseNativeRecordDocument(contents.get(authoritative)).frontmatter)?.frontmatter.createdDate, '2026-08-27T08:00:00.000Z');

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

  assert.equal(service.inspect(parseNativeRecordDocument(contents.get(legacyForUpdate)).frontmatter), null);
  await service.migrateStorageProfile();
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
  assert.equal(service.inspect(parseNativeRecordDocument(contents.get(legacy))?.frontmatter), null);
  const inspection = inspectMigration(service, parseNativeRecordDocument(contents.get(legacy))?.frontmatter);
  assert.equal(inspection?.id, 'task-legacy');
  assert.equal(inspection?.profile.identityMode, 'tag');
  assert.equal(inspection?.profile.identityTagPrefix, 'tps/record');
  assert.equal(await service.resolve('task-legacy'), null);
  await service.migrateStorageProfile();
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
  assert.equal(service.inspect(parseNativeRecordDocument(contents.get(legacy)).frontmatter), null);
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
  assert.equal(inspectMigration(service, parseNativeRecordDocument(contents.get(legacyUnsafe)).frontmatter)?.id, 'food:one');

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
  assert.equal(inspectMigration(service, parseNativeRecordDocument(contents.get(literalHex)).frontmatter)?.id, 'hex-3a');
  assert.equal(inspectMigration(service, parseNativeRecordDocument(contents.get(decodedHex)).frontmatter)?.id, ':');
  assert.equal(inspectMigration(service, parseNativeRecordDocument(contents.get(literalLetters)).frontmatter)?.id, 'hex-4142');

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
  assert.equal(inspectMigration(invalidHarness.service, parseNativeRecordDocument(invalidBefore).frontmatter), null);
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
  const inspection = inspectMigration(service, mixedCase);
  assert.equal(inspection?.id, 'task-case-a');
  assert.equal(inspection?.frontmatter.title, 'Mixed-case task');
  assert.equal(inspection?.frontmatter.createdDate, '2026-08-25T10:11:12.123Z');
  assert.equal(inspection?.frontmatter.modifiedDate, '2026-08-25T10:11:13.456Z');

  assert.equal(inspectMigration(service, {
    ...mixedCase,
    Tags: ['todo', 'tps/record/v1/task/task-case-b'],
  }), null, 'case-variant property identity conflicts with a case-variant legacy tag');
  assert.equal(inspectMigration(service, {
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
  assert.equal(inspectMigration(tagService, {
    externalId: 'provider-owned-value',
    kind: 'task',
    title: 'Dormant tag fields',
    tags: ['todo', 'legacy/dormant/v1/task/task-dormant'],
  })?.id, 'task-dormant');

  const { service: propertyService } = createHarness('native-records', {
    identityPropertyKey: 'tpsId',
    schemaPropertyKey: 'customSchema',
  });
  assert.equal(inspectMigration(propertyService, {
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

test('rename refuses a direct path when its stable ID has multiple known owners', async () => {
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
  service.indexFile(first);
  service.indexFile(second);
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

test('storage migration removes legacy identities and retires aliases for late Sync arrivals', async () => {
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
  assert.deepEqual(plugin.settings.nativeRecordStorageAliases, []);

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
  assert.equal(await service.resolve('calendar-event-late'), null);
});

test('updating a current record removes agreeing identity tags without reserializing unrelated source', async () => {
  const { service, plugin, contents, events, indexed, addFile } = createHarness();
  const original = [
    '\uFEFF---\r\n',
    'title: "Legacy source task"\r\n',
    'tpsId: task-source-preserved\r\n',
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

  assert.equal(await service.resolve('calendar-old-tag'), null);
  await service.migrateStorageProfile();
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
  assert.equal(authoritativeReads, 1, 'only the changed source needs an authoritative read');
  assert.equal(await service.resolve(owner), null);
  assert.equal(await service.resolve({ path: owner.path, id: 'calendar-resolve-owner' }), null);
  assert.equal(await service.resolve(changed), null);
  assert.equal(authoritativeReads, 4, 'each selected path rereads only its source and retains the known conflict');
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
    operation: 'create', nextId: 'calendar-storage-collision', kind: 'calendar-event',
    properties: { title: 'Canonical title', eventTitle: 'Business title' },
  }]), false, 'a custom title mapping cannot overwrite a different value');
  const configuredRecord = await configured.service.create('calendar-event', {title: 'Canonical title'}, {id:'calendar-storage-collision'});
  assert.equal(configuredRecord.frontmatter.title, 'Canonical title');
  assert.equal(parseNativeRecordDocument(configured.contents.get(configuredRecord.file)).frontmatter.eventTitle, 'Canonical title');

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
  assert.equal(draft.path, 'Untitled.md');
  await service.prepareCreatedNote(draft);

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
  const { service, vault } = createHarness();
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
    await service.prepareCreatedNote(file);
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
    const { service, vault, contents } = createHarness('native-records', {
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
    await service.prepareCreatedNote(draft);

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

test('native mode rejects task-line promotion before reading or writing its source', async () => {
  const { service, plugin, addFile, contents } = createHarness();
  const sourceLine = '- [ ] Ship release #work [scheduled:: 2026-08-25 09:00:00]';
  const source = addFile('Inbox.md', `# Inbox\n${sourceLine}\n  - supporting note\n`);
  let reads = 0;
  plugin.taskApiService.get = async () => { reads += 1; throw new Error('unexpected task-line read'); };

  const result = await service.promoteTask({ path: source.path, lineNumber: 1, rawLine: sourceLine });
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.match(result.error, /unavailable/u);
  assert.equal(reads, 0);
  assert.equal(contents.get(source), `# Inbox\n${sourceLine}\n  - supporting note\n`);
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
    (fileNamingSource.match(/hasWorkflowOwnedFilenameEvidence\(currentFile(?:, true)?\)/gu) || []).length,
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

test('native profile is mandatory and legacy active paths remain gated', () => {
  assert.match(typesSource, /TpsDataArchitectureMode = 'legacy' \| 'native-records'/u);
  assert.match(constantsSource, /dataArchitectureMode: 'native-records'/u);
  assert.match(constantsSource, /nativeRecordRootPath: '_records'/u);
  assert.match(settingsSource, /Atomic note/u);
  assert.doesNotMatch(settingsSource, /addOption\('legacy', 'Atomic line'\)/u);
  assert.match(mainSource, /this\.settings\.dataArchitectureMode = 'native-records'/u);
  assert.match(mainSource, /if \(!this\.usesNativeRecordArchitecture\(\)\) \{[\s\S]{0,1200}registerBasesView\(TPS_TABLE_VIEW_TYPE[\s\S]{0,1200}registerBasesView\(TPS_LIST_VIEW_TYPE/u);
  assert.match(mainSource, /if \(!this\.usesNativeRecordArchitecture\(\)\) this\.baseRowIndexService\.setup\(\)/u);
  assert.match(mainSource, /if \(!this\.usesNativeRecordArchitecture\(\)\) this\.addChild\(this\.virtualBaseEmbedService\)/u);
  assert.match(mainSource, /if \(!this\.usesNativeRecordArchitecture\(\)\) this\.baseLineEditProtocolService\.register\(\)/u);
  assert.match(filePropertiesSource, /dataArchitectureMode !== 'native-records'[\s\S]{0,180}file instanceof TFile/u);
});

test('public GCM API exposes versioned generic and task record contracts', () => {
  assert.match(apiSource, /capabilities: Object\.freeze\(\{ customKinds: true, calendarTemplateRecords: true, kindPropertyKeys: true, conflictAwareSnapshots: true, freshIdentityCreates: true, selectedFileAuthority: true, indexedSnapshot: true, updateFromSource: true, identityApplyCancellation: true \}\)/u);
  assert.match(apiSource, /const nativeRecordsApi = \{[\s\S]{0,300}version: plugin\.nativeRecordService\.version[\s\S]{0,1800}createAsset:[\s\S]{0,1800}resolve:[\s\S]{0,300}list:[\s\S]{0,300}snapshot:[\s\S]{0,1800}canCreateIdentity:[\s\S]{0,800}canApplyIdentityPlan:[\s\S]{0,800}planIdentityChanges:[\s\S]{0,800}applyIdentityChanges:[\s\S]{0,800}canReidentify:[\s\S]{0,800}reidentify:[\s\S]{0,800}rename:[\s\S]{0,800}archive:/u);
  assert.match(readFileSync(new URL('../src/services/native-record-service.ts', import.meta.url), 'utf8'), /readonly version = 6;/u);
  assert.match(apiSource, /ensureAsset:[\s\S]{0,700}resolveAsset:/u);
  assert.match(apiSource, /const taskRecordsApi = \{[\s\S]{0,200}version: 2,\s*supportsPromotion: false[\s\S]{0,500}promote:[\s\S]{0,900}resolve:/u);
  assert.match(apiSource, /nativeRecords: nativeRecordsApi,[\s\S]{0,100}taskRecords: taskRecordsApi/u);
});

test('current-only record readers reject old kinds while identity evidence still prevents duplicate IDs', async () => {
 const {service,addFile}=createHarness('native-records',{kindPropertyKey:'entityKind'});
 const old=addFile('_records/tasks/old-key.md',serializeNativeRecordDocument({bom:'',newline:'\n',closer:'---',body:'',frontmatter:{tpsId:'task-old-key',kind:'task',title:'Old'}}));
 assert.equal(service.getStorageProfile().kindPropertyKey,'entityKind');
 assert.equal(service.inspect({tpsId:'task-old-key',kind:'task',title:'Old'}),null);
 assert.equal(await service.resolve(old),null);
 await assert.rejects(service.create('task',{title:'Duplicate'},{id:'task-old-key'}));
 const created=await service.create('task',{title:'New'},{id:'task-new-key'});
 assert.equal(created.kind,'task');
 assert.equal(service.inspect({tpsId:'task-new-key',entityKind:'task',title:'New'})?.kind,'task');
});


test('Health records use an independent current key for creation, updates, resolution and identity changes', async()=>{
 const {service,plugin,contents}=createHarness();
 plugin.settings.nativeRecordKindPropertyKeys={'food-entry':'entryKind','activity-entry':'entryKind','workout-session':'entryKind'};
 const entry=await service.create('food-entry',{title:'Lunch',calories:100},{id:'food-entry-key-test'});
 assert.match(contents.get(entry.file),/entryKind: food-entry/);assert.doesNotMatch(contents.get(entry.file),/^kind:/m);
 assert.equal(service.inspect({tpsId:entry.id,title:'Lunch',kind:'food-entry'}),null);
 assert.equal(service.inspect({tpsId:entry.id,title:'Lunch',entryKind:'food-entry'})?.kind,'food-entry');
 const updated=await service.update(entry.path,{calories:150});assert.equal(updated.frontmatter.calories,150);
 assert.match(contents.get(entry.file),/entryKind: food-entry/);assert.doesNotMatch(contents.get(entry.file),/^kind:/m);
 const renamed=await service.reidentify(entry.path,'food-entry-new-key-test');assert.equal(renamed.id,'food-entry-new-key-test');
 assert.match(contents.get(entry.file),/entryKind: food-entry/);
 const task=await service.create('task',{title:'Task'});assert.match(contents.get(task.file),/^kind: task/m);
 service.refreshConfiguration();assert.equal((await service.resolve(entry.path))?.kind,'food-entry');
});

test('explicit per-kind keys can equal the shared key and persist without an enabled Health plugin',async()=>{
 const {service,plugin,contents}=createHarness();
 await service.configureKindPropertyKeys({'workout-session':'kind'},{});
 const entry=await service.create('workout-session',{title:'Workout'});
 assert.match(contents.get(entry.file),/^kind: workout-session/m);
 assert.equal(service.getStorageProfile('workout-session').kindPropertyKey,'kind');
 await assert.rejects(service.configureKindPropertyKeys({},{}),/mappings changed/);
 assert.equal(plugin.settings.nativeRecordKindPropertyKeys['workout-session'],'kind');
});

test('kind key map save failure restores the previous persisted mapping', async()=>{
 const {service,plugin}=createHarness();let saves=0;
 plugin.saveSettings=async()=>{if(++saves===1)throw Error('Storage failed');};
 await assert.rejects(service.configureKindPropertyKeys({'food-entry':'entryKind'},{}),/Storage failed/);
 assert.deepEqual(service.getKindPropertyKeys(),{});assert.equal(saves,2);
});


test('creating a record rejects all current physical identity keys instead of silently dropping them',async()=>{
 const {service,plugin}=createHarness('native-records',{kindPropertyKey:'recordType'});
 plugin.settings.nativeRecordKindPropertyKeys={'food-entry':'entryKind'};
 await assert.rejects(service.create('food-entry',{title:'Lunch',recordType:'user data'}),/collides with system storage/);
 await assert.rejects(service.create('task',{title:'Task',entryKind:'user data'}),/collides with system storage/);
});


test('an edit during a large source scan retries changed files instead of restarting every read', async () => {
  const {service,vault,contents,addFile}=createHarness();
  const files=Array.from({length:1000},(_,i)=>addFile(`Inbox/note-${i}.md`, '---\ntitle: Ordinary\n---\nOrdinary body'));
  const original=vault.read,reads=new Map();let changed=false;
  vault.read=async file=>{
    reads.set(file,(reads.get(file)||0)+1);
    const source=await original(file);
    if(file===files[900]&&!changed){changed=true;contents.set(files[0],'Edited body');vault.emit('modify',files[0]);}
    return source;
  };
  await service.snapshot();
  assert.equal(reads.get(files[0]),2);
  assert.equal(reads.get(files[500]),1,'unchanged earlier files are not read again');
  assert.ok([...reads.values()].reduce((a,b)=>a+b,0)<=1009);
  let before=[...reads.values()].reduce((a,b)=>a+b,0);
  const originalIndex=service.indexFile.bind(service);let classifications=0;
  service.indexFile=(...args)=>{classifications++;return originalIndex(...args);};
  contents.set(files[20],'Another body');vault.emit('modify',files[20]);
  await service.create('food-entry',{title:'Oats',calories:100},{id:'food-oats'});
  assert.equal([...reads.values()].reduce((a,b)=>a+b,0)-before,1,'logging after an ordinary edit only reads that changed file');
  assert.ok(classifications<5,'unchanged ordinary properties are not repeatedly classified as records');
});

test('source cache preserves internal writes through an unrelated later edit and handles rename/delete/replacement', async()=>{
  const {service,vault,contents,entries,addFile}=createHarness();
  const record=await service.create('food-entry',{title:'First',calories:100},{id:'food-cache'});
  const ordinary=addFile('Inbox/ordinary.md','Ordinary');vault.emit('create',ordinary);
  await service.snapshot();
  await service.update(record.file,{calories:250});
  contents.set(ordinary,'Changed');vault.emit('modify',ordinary);
  await service.snapshot();assert.equal((await service.resolve('food-cache')).frontmatter.calories,250);
  await vault.rename(record.file,'Inbox/renamed.md');
  assert.equal((await service.resolve('food-cache')).path,'Inbox/renamed.md');
  const raw=contents.get(record.file);entries.delete(record.file.path);vault.emit('delete',record.file);
  assert.equal(await service.resolve('food-cache'),null);
  const replacement=addFile('Inbox/renamed.md',raw);vault.emit('create',replacement);
  assert.equal((await service.resolve('food-cache')).file,replacement);
});

test('an in-flight source change cannot publish its earlier identity bytes', async()=>{
  const {service,vault,contents,addFile}=createHarness();
  const record=await service.create('food-entry',{title:'Owner'},{id:'food-owner'});
  const other=addFile('Inbox/new.md','Ordinary');vault.emit('create',other);
  const original=vault.read;let changed=false;
  vault.read=async file=>{
    const stale=await original(file);
    if(file===other&&!changed){changed=true;contents.set(other,contents.get(record.file));vault.emit('modify',other);}
    return stale;
  };
  await assert.rejects(()=>service.create('food-entry',{title:'Duplicate'},{id:'food-owner'}),/already exists/);
  assert.equal(await service.resolve('food-owner'),null,'the concurrent duplicate must be indexed');
});


test('a cached non-record is reconsidered after source and storage configuration changes', async()=>{
  const {service,plugin,vault,contents,addFile}=createHarness();
  const ordinary=addFile('Inbox/later-record.md','---\ntitle: Ordinary\n---\nBody');
  await service.snapshot();
  contents.set(ordinary,'---\ntitle: Later\ntpsId: later-food\nkind: food-entry\ntpsSchemaVersion: 1\n---\nBody');
  vault.emit('modify',ordinary);
  assert.equal((await service.resolve('later-food'))?.path,ordinary.path);
  const original=vault.read;let reads=0;
  vault.read=async file=>{reads++;return original(file);};
  service.refreshConfiguration();
  assert.equal((await service.resolve('later-food'))?.path,ordinary.path);
  assert.equal(reads,1,'configuration refresh discards all prior source classifications');
});

test('incremental source reconciliation retains unchanged records and repairs provisional metadata', async()=>{
  const {service,plugin,vault,contents,addFile}=createHarness();
  const files=Array.from({length:1000},(_,i)=>addFile(`Inbox/record-${i}.md`,`---\ntpsId: food-${i}\nkind: food-entry\ntitle: Food ${i}\n---\nBody`));
  const ordinary=addFile('Inbox/ordinary.md','Ordinary');
  assert.equal((await service.snapshot()).records.length,1000);
  contents.set(ordinary,'Edited ordinary');vault.emit('modify',ordinary);
  plugin.app.metadataCache.emit('changed',files[500],'',{frontmatter:{tpsId:'poison',kind:'food-entry',title:'Stale'}});
  const original=service.indexFile.bind(service);let classifications=0;
  service.indexFile=(...args)=>{classifications++;return original(...args);};
  await service.create('food-entry',{title:'New food'},{id:'food-new'});
  assert.ok(classifications<=3,'only the provisional record and new record lifecycle need classification');
  assert.equal((await service.resolve('food-500'))?.path,files[500].path);
  assert.equal(await service.resolve('poison'),null);
  assert.equal((await service.snapshot()).records.length,1001);
  contents.set(files[0],'No record now');vault.emit('modify',files[0]);
  assert.equal(await service.resolve('food-0'),null);
  assert.equal((await service.snapshot()).records.length,1000);
});

test('cold vault discovery indexes existing records without reading or adopting existing task drafts', async () => {
  const { service, plugin, vault, contents } = createHarness('native-records', { layoutReady: false });
  let reads = 0;
  const read = vault.cachedRead;
  vault.cachedRead = async file => { reads++; return read(file); };
  const discovered = [];
  for (let i = 0; i < 1000; i++) {
    const fm = i % 2 ? { kind: 'task', title: `Existing ${i}`, tpsId: `existing-${i}` } : { kind: 'task', title: `Existing ${i}` };
    const text = serializeNativeRecordDocument({ bom: '', newline: '\n', closer: '---', body: '', frontmatter: fm });
    const file = await vault.create(`Existing ${i}.md`, text);
    discovered.push({ file, text });
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(reads, 0, 'startup create events must not read note bodies for draft adoption');
  assert.equal(service.recordsByPath.size, 500, 'existing native records are indexed during discovery');
  for (const { file, text } of discovered) {
    assert.equal(contents.get(file), text);
    assert.equal(service.newlyCreatedFiles.has(file), false);
  }
  plugin.app.workspace.layoutReady = true;
  for (const { file } of discovered) plugin.app.metadataCache.emit('changed', file);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(reads, 0, 'late metadata does not reinterpret discovered notes as new drafts');
  const draft = await vault.create('Actually new.md', '---\nkind: task\ntitle: New\n---\n');
  plugin.app.metadataCache.emit('changed', draft);
  assert.equal(draft.path, 'Actually new.md');
  assert.equal(reads, 0);
  await service.prepareCreatedNote(draft);
  assert.match(draft.path, /^_records\/tasks\/task-/);
});

test('record inspection prepares mappings once and keeps returned profiles and note mutations independent', () => {
  const { service, addFile } = createHarness();
  let preparations = 0;
  const prepare = service.getStorageConfiguration;
  service.getStorageConfiguration = function () { preparations++; return prepare.call(this); };
  service.inspectionProfiles = null;
  const fm = { tpsId: 'prepared', kind: 'task', title: 'Before' };
  for (let i = 0; i < 1000; i++) assert.equal(service.inspect(fm)?.id, 'prepared');
  const file = addFile('Prepared.md', fm);
  for (let i = 0; i < 1000; i++) service.indexFile(file, fm);
  assert.equal(service.recordsByPath.get(file.path)?.tpsId, 'prepared');
  assert.equal(preparations, 1);
  const first = service.inspect(fm);
  first.profile.identityPropertyKey = 'poisoned';
  first.frontmatter.title = 'Caller-owned copy';
  fm.title = 'After';
  assert.equal(service.inspect(fm)?.frontmatter.title, 'After');
  assert.equal(service.inspect(fm)?.profile.identityPropertyKey, 'tpsId');
  fm.tpsId = '';
  assert.equal(service.inspect(fm), null, 'conflicting evidence is still evaluated on every call');
});

test('prepared inspection tracks nested key changes, aliases and migration mode without requiring a settings save', () => {
  const { service, plugin } = createHarness();
  const fm = { tpsId: 'mapped', kind: 'task', title: 'Mapped' };
  assert.equal(service.inspect(fm)?.id, 'mapped');
  plugin.settings.nativeRecordKindPropertyKeys = { task: 'taskKind' };
  assert.equal(service.inspect(fm), null);
  fm.taskKind = 'task';
  assert.equal(service.inspect(fm)?.profile.kindPropertyKey, 'taskKind');
  plugin.settings.nativeRecordKindPropertyKeys.task = 'recordType';
  assert.equal(service.inspect(fm), null);
  fm.recordType = 'task';
  assert.equal(service.inspect(fm)?.profile.kindPropertyKey, 'recordType');
  for (const change of [
    () => { plugin.settings.nativeRecordStorageAliases.push({ ...DEFAULT_NATIVE_RECORD_STORAGE_PROFILE, identityPropertyKey: 'oldId' }); },
    () => { plugin.settings.nativeRecordStorageAliases[0].titlePropertyKey = 'oldTitle'; },
    () => { service.readingMigrationSources = true; },
    () => { plugin.settings.nativeRecordTitlePropertyKey = 'name'; },
    () => { service.readingMigrationSources = false; },
  ]) {
    const previous = service.inspectionProfiles;
    change();
    const result = service.inspect(fm);
    assert.notEqual(service.inspectionProfiles, previous);
    service.inspectionProfiles = null;
    assert.deepEqual(service.inspect(fm), result, 'cached and freshly prepared classification agree');
  }
});

test('cold source verification overlaps reads with a bounded worker count', async()=>{
  const {service,vault,addFile}=createHarness();
  for(let i=0;i<40;i++)addFile(`Inbox/cold-${i}.md`,'Ordinary');
  const original=vault.read,pending=[];let active=0,peak=0,reads=0,done=false;
  vault.read=file=>new Promise(resolve=>{
    reads++;active++;peak=Math.max(peak,active);
    pending.push(async()=>{active--;resolve(await original(file));});
  });
  const scan=service.snapshot().finally(()=>{done=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,8,'independent reads start together');
  while(!done){
    const batch=pending.splice(0);await Promise.all(batch.map(release=>release()));
    await new Promise(resolve=>setImmediate(resolve));
  }
  await scan;assert.equal(reads,40);assert.equal(active,0);assert.equal(peak,8);
});

test('a failed parallel scan drains pending reads and never commits a record', async()=>{
  const {service,vault,addFile,entries}=createHarness();
  for(let i=0;i<20;i++)addFile(`Inbox/failure-${i}.md`,'Ordinary');
  const original=vault.read,pending=[];let done=false,reads=0;
  vault.read=file=>new Promise((resolve,reject)=>{
    reads++;pending.push({file,resolve,reject});
  });
  const write=service.create('food-entry',{title:'Pending food'},{id:'food-failed-read'});
  const rejected=assert.rejects(write,/Unable to authoritatively read/).finally(()=>{done=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,8);
  pending.shift().reject(Error('Storage offline'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(done,false,'the refresh remains owned until in-flight reads settle');
  assert.equal(reads,8,'no further reads start after the failure');
  for(const item of pending.splice(0))item.resolve(await original(item.file));
  await rejected;
  assert.equal([...entries.values()].filter(file=>file.path.includes('food-failed-read')).length,0);
  vault.read=original;
  assert.ok(await service.create('food-entry',{title:'Retry food'},{id:'food-failed-read'}));
});

test('ordinary index updates do not walk unrelated blocked identities', async()=>{
  const {service,addFile}=createHarness();
  const blocked=Array.from({length:250},(_,i)=>addFile(`Inbox/blocked-${i}.md`,`---\ntpsId: blocked-${i}\nkind: food-entry\n---\n`));
  const ordinary=addFile('Inbox/ordinary.md','---\ntitle: Ordinary\n---\n');
  await service.refreshIdentityIndexFromVaultSource();
  let deletes=0;
  for(const paths of service.blockedPathsById.values()){
    const original=paths.delete.bind(paths);paths.delete=path=>{deletes++;return original(path);};
  }
  service.indexFile(ordinary,{title:'Changed'});
  assert.equal(deletes,0,'an ordinary file cannot own any blocked identity');
  service.removePath(blocked[0].path);
  assert.equal(service.blockedPathsById.has('blocked-0'),false);
  assert.equal(service.blockedPathsById.get('blocked-1').has(blocked[1].path),true);
  assert.equal(service.blockedIdentityEvidencePaths.has(blocked[0].path),false);
  assert.equal(service.blockedIdentityEvidencePaths.size,249);
});

test('opt-in conflict snapshot isolates invalid unrelated records without releasing their identities', async () => {
  const {service,addFile,contents}=createHarness();
  const doc=fm=>serializeNativeRecordDocument({bom:'',newline:'\n',closer:'---',body:'Keep this body\n',frontmatter:fm});
  const invalid=addFile('broken-item.md',doc({tpsId:'item-broken',entityKind:'food',nested:{keep:true}}));
  addFile('event.md',doc({tpsId:'calendar-owned',kind:'calendar-event',title:'Event'}));
  await assert.rejects(()=>service.snapshot(),/identity conflicts/);
  const before=contents.get(invalid);
  const snapshot=await service.snapshot(undefined,{includeConflicts:true});
  assert.equal(snapshot.records.length,1);
  assert.deepEqual(snapshot.conflicts.map(x=>x.ids),[['item-broken']]);
  assert.equal(snapshot.conflicts[0].path,'broken-item.md');
  snapshot.conflicts[0].frontmatter.nested.keep=false;
  assert.equal((await service.snapshot(undefined,{includeConflicts:true})).conflicts[0].frontmatter.nested.keep,true);
  assert.equal(await service.canCreateIdentity('ITEM-BROKEN'),false);
  assert.equal(await service.planIdentityChanges([{operation:'create',nextId:'item-broken',kind:'calendar-event',properties:{title:'Wrong owner'}}],snapshot),null);
  assert.equal(await service.canCreateIdentity('calendar-free'),true);
  assert.equal(contents.get(invalid),before);
});

test('conflict snapshots report all duplicate and blocked owners, including custom kind evidence', async () => {
  const {service,addFile}=createHarness();
  const doc=fm=>serializeNativeRecordDocument({bom:'',newline:'\n',closer:'---',body:'',frontmatter:fm});
  addFile('a.md',doc({tpsId:'shared',kind:'calendar-event',title:'A'}));
  addFile('b.md',doc({tpsId:'SHARED',kind:'calendar-event',title:'B'}));
  addFile('c.md',doc({tpsId:'other',kind:'calendar-event',title:'Valid'}));
  addFile('d.md',doc({tpsId:'OTHER',kind:'calendar-event'}));
  const s=await service.snapshot(undefined,{includeConflicts:true});
  assert.equal(s.records.length,0);
  assert.equal(s.conflicts.length,4);
  assert.ok(s.conflicts.every(c=>c.kinds.includes('calendar-event')));
  assert.equal(await service.canCreateIdentity('shared'),false);
  await assert.rejects(()=>service.list(),/identity conflicts/);
});

test('large conflict snapshots collect ownership in linear passes without changing diagnostics', async (t) => {
  const { service, plugin, vault, addFile } = createHarness();
  plugin.settings.nativeRecordKindPropertyKeys = { 'food-entry': 'entryKind' };
  const expected = [];
  const add = (path, frontmatter, ids, kinds) => {
    addFile(path, serializeNativeRecordDocument({ bom: '', newline: '\n', closer: '---', body: 'Unchanged body\n', frontmatter }));
    if (ids) expected.push({ path, ids, kinds, frontmatter });
  };
  for (let index = 0; index < 2500; index += 1) {
    add(`Records/${index}.md`, { tpsId: `task-${index}`, kind: 'task', title: `Task ${index}` });
  }
  for (let index = 0; index < 850; index += 1) {
    const id = `duplicate-${index}`;
    for (const suffix of ['b', 'a']) {
      add(`Conflicts/${index}-${suffix}.md`, { tpsId: id, kind: 'calendar-event', title: suffix }, [id], ['calendar-event']);
    }
    const blockedId = index === 0 ? 'duplicate-0' : `blocked-${index}`;
    add(`Blocked/${index}.md`, { tpsId: blockedId, entryKind: 'food-entry', nested: { keep: true } }, [blockedId], ['food-entry']);
  }
  // One blocked path can reserve several IDs, and the same ID can occur in
  // both ownership indexes. Diagnostics retain sorted, deduplicated identities.
  const multi = expected.find(conflict => conflict.path === 'Blocked/1.md');
  multi.frontmatter.TPSID = 'z-extra-identity';
  multi.ids.push('z-extra-identity');
  const multiFile = vault.getFileByPath(multi.path);
  await vault.process(multiFile, () => serializeNativeRecordDocument({
    bom: '', newline: '\n', closer: '---', body: 'Unchanged body\n', frontmatter: multi.frontmatter,
  }));
  expected.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const cold = await service.snapshot(undefined, { includeConflicts: true });
  assert.equal(cold.records.length, 2500);
  assert.deepEqual(cold.conflicts, expected);

  let indexEntryVisits = 0;
  let profileReads = 0;
  let sourceReads = 0;
  const indexes = [service.pathsById, service.blockedPathsById];
  for (const index of indexes) {
    const entries = index[Symbol.iterator].bind(index);
    index[Symbol.iterator] = function* () {
      for (const entry of entries()) {
        indexEntryVisits += 1;
        yield entry;
      }
    };
  }
  const getProfiles = service.getInspectionProfiles.bind(service);
  service.getInspectionProfiles = () => { profileReads += 1; return getProfiles(); };
  const read = vault.read.bind(vault);
  vault.read = async file => { sourceReads += 1; return read(file); };
  const passes = 3;
  for (let pass = 0; pass < passes; pass += 1) {
    const snapshot = await service.snapshot(undefined, { includeConflicts: true });
    assert.deepEqual(snapshot.conflicts, expected, 'path/ID/kind ordering and authored frontmatter remain identical');
    assert.deepEqual(snapshot.records, cold.records);
    snapshot.conflicts.find(conflict => conflict.path === 'Blocked/1.md').frontmatter.nested.keep = false;
  }
  assert.equal(sourceReads, 0, 'warm diagnostics do not reread unchanged sources');
  assert.ok(indexEntryVisits <= passes * (2 * service.pathsById.size + service.blockedPathsById.size),
    `ownership indexes must be traversed a bounded number of times, not once per conflict: ${indexEntryVisits} visits`);
  assert.ok(profileReads <= passes * 2,
    `mapping signatures must be read once for validation and once for diagnostics per snapshot: ${profileReads} reads`);
  t.diagnostic(JSON.stringify({ conflicts: expected.length, passes, indexEntryVisits, profileReads, sourceReads }));
});

test('fresh food identities avoid 30 seconds of modeled serial reads in a cold 10,000-note vault',async()=>{
 const h=createHarness();
 for(let i=0;i<10000;i++)h.addFile(`Notes/${i}.md`,'Ordinary');
 let reads=0;const read=h.vault.read;h.vault.read=async file=>{reads++;return read(file);};
 await h.service.create('food-entry',{title:'Existing contract'},{id:'known-new-id'});
 assert.equal(reads,10000);assert.equal(reads*3,30000,'3 ms per serial mobile storage read');
 h.service.authoritativeSourceCache.clear();h.service.authoritativeIdentityGeneration=-1;reads=0;
 const fresh=await h.service.createFresh('food-entry',{title:'New food',calories:100});
 assert.match(fresh.id,/^food-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.equal(reads,0);assert.equal(fresh.frontmatter.calories,100);
 assert.equal(parseNativeRecordDocument(h.contents.get(fresh.file)).frontmatter.tpsId,fresh.id);
 assert.equal(h.service.authoritativeIdentityGeneration,-1,'fresh creation does not falsely certify the global index');
});

test('fresh creation cannot accept caller IDs, plan tokens, or protected identity properties',async()=>{
 const {service,vault}=createHarness();
 for(const options of [{id:'reused'},{planToken:1},{expectedPath:'existing.md'}])
  await assert.rejects(service.createFresh('food-entry',{title:'Invalid'},options),/cannot supply an identity/);
 for(const key of ['tpsId','TPSID','kind'])
  await assert.rejects(service.createFresh('food-entry',{title:'Invalid',[key]:'reused'}),/collides with system storage/);
 assert.equal(vault.getMarkdownFiles().length,0);
});

test('fresh creation retains known conflict checks and in-flight ID reservations',async()=>{
 const h=createHarness();
 const existing=h.addFile('Existing.md','---\ntpsId: forced-id\nkind: food-entry\ntitle: Owner\n---\n');
 h.service.indexFile(existing);
 h.service.generateCryptographicId=()=> 'forced-id';
 await assert.rejects(h.service.createFresh('food-entry',{title:'Duplicate'}),/already exists/);
 h.service.generateCryptographicId=()=> 'reserved-id';
 let release;const gate=new Promise(resolve=>{release=resolve;});const create=h.vault.create;
 h.vault.create=async(...args)=>{await gate;return create(...args);};
 const first=h.service.createFresh('food-entry',{title:'First'});
 try{await assert.rejects(h.service.createFresh('food-entry',{title:'Second'}),/already in progress/);}finally{release();}
 await first;assert.equal(h.vault.getMarkdownFiles().length,2);
});

test('fresh logging does not wait for a pending whole-vault verification', {timeout:2000}, async()=>{
 const h=createHarness();h.addFile('Slow.md','Ordinary');
 let release;const gate=new Promise(resolve=>{release=resolve;});const read=h.vault.read;
 h.vault.read=async file=>{await gate;return read(file);};
 const pending=h.service.refreshIdentityIndexFromVaultSource();
 try{
  const record=await h.service.createFresh('food-entry',{title:'While syncing'});
  assert.equal(record.frontmatter.title,'While syncing');
 }finally{release();await pending;}
});

test('fresh creation retains exclusive plans, write failures, and retry reservations',async()=>{
 const h=createHarness();h.service.nativePlanMutationLock=Symbol('plan');
 await assert.rejects(h.service.createFresh('food-entry',{title:'Locked'}),/currently being applied/);
 h.service.nativePlanMutationLock=null;
 h.service.generateCryptographicId=()=> 'retry-id';const create=h.vault.create;
 h.vault.create=async()=>{throw Error('Storage failed');};
 await assert.rejects(h.service.createFresh('food-entry',{title:'Retry'}),/Storage failed/);
 assert.equal(h.service.inFlightCreateIds.size,0);
 h.vault.create=create;
 assert.equal((await h.service.createFresh('food-entry',{title:'Retry'})).id,'retry-id');
});

test('secure-random unavailability retains authoritative source verification',async()=>{
 const h=createHarness();h.addFile('Uncached.md','Ordinary');
 h.service.generateCryptographicId=()=>null;
 let reads=0;const read=h.vault.read;h.vault.read=async file=>{reads++;return read(file);};
 await h.service.createFresh('food-entry',{title:'Fallback'});assert.equal(reads,1);
});

test('explicit identities still detect nonstandard whitespace YAML hidden by core metadata',async()=>{
 const h=createHarness();
 h.addFile('Whitespace.md','--- \t\ntpsId: hidden-owner\nkind: food-entry\ntitle: Owner\n--- \t\n');
 h.plugin.app.metadataCache.getFileCache=()=>({sections:[{type:'paragraph'}]});
 await assert.rejects(h.service.create('food-entry',{title:'Duplicate'},{id:'hidden-owner'}),/already exists/);
 assert.match(apiSource,/freshIdentityCreates: true/);
 assert.match(apiSource,/createFresh:[\s\S]{0,400}nativeRecordService\.createFresh/);
});

test('configured hierarchy creates and updates a Health record without confusing its parent kind with identity', async () => {
 const {service,plugin,contents}=createHarness();
 plugin.settings.nativeRecordKindPropertyKeys={'food-entry':{key:'transactionKind',value:'food-entry',parentKind:'transaction'}};
 const created=await service.create('food-entry',{title:'Lunch',calories:120},{id:'hierarchy-food'});
 assert.match(contents.get(created.file),/^kind: transaction$/m);
 assert.match(contents.get(created.file),/^transactionKind: food-entry$/m);
 assert.equal(created.kind,'food-entry');
 const update=await service.update(created.path,{calories:180});assert.equal(update.kind,'food-entry');
 assert.match(contents.get(created.file),/^kind: transaction$/m);
 assert.equal((await service.resolve(created.path))?.kind,'food-entry');
 await assert.rejects(service.create('task',{title:'Duplicate'},{id:'hierarchy-food'}));
 const renamed=await service.reidentify(created.path,'hierarchy-food-new');assert.equal(renamed.kind,'food-entry');
 assert.match(contents.get(created.file),/^transactionKind: food-entry$/m);
});

test('configured kind list creates native records and reads explicit legacy tag/scalar aliases', async () => {
 const {service,plugin,contents,addFile,vault}=createHarness();
 plugin.settings.nativeRecordKindPropertyKeys={'food-entry':{
  primary:{kindList:{key:'kind',value:'transaction/macros'}},
  aliases:[{tag:'kind/food/transaction'},{scalar:{key:'kind',value:'food-entry'}}],
 }};
 const created=await service.create('food-entry',{title:'Lunch',calories:120,tags:['lunch']},{id:'kind-list-food'});
 const source=contents.get(created.file);
 assert.match(source,/kind:\s*\n\s*- transaction\/macros/u);
 assert.doesNotMatch(source,/kind\/food\/transaction/u);
 assert.equal(service.inspect({tpsId:'kind-list-food',title:'Lunch',kind:['transaction/macros','user/custom']})?.kind,'food-entry');
 assert.equal(service.inspect({tpsId:'legacy-food',title:'Old lunch',tags:['kind/food/transaction']})?.kind,'food-entry');
 assert.equal(service.inspect({tpsId:'legacy-scalar',title:'Old lunch',kind:'food-entry'})?.kind,'food-entry');
 const updated=await service.update(created.path,{calories:180});
 assert.equal(updated.kind,'food-entry');
 assert.match(contents.get(created.file),/kind:\s*\n\s*- transaction\/macros/u);
 const legacy=addFile('_records/food-entries/legacy-kind.md',serializeNativeRecordDocument({
  bom:'',newline:'\n',closer:'---',body:'Authored body',frontmatter:{
   tpsId:'legacy-kind',tpsSchemaVersion:1,kind:'food-entry',title:'Old lunch',calories:100,
  },
 }));
 vault.emit('modify',legacy);
 assert.equal((await service.update(legacy,{calories:150}))?.kind,'food-entry');
 assert.match(contents.get(legacy),/^kind: food-entry$/mu,'an ordinary metadata edit does not silently migrate legacy notes');
 assert.match(contents.get(legacy),/Authored body$/u);
 const conflicting=addFile('_records/food-entries/conflicting-kind.md',serializeNativeRecordDocument({
  bom:'',newline:'\n',closer:'---',body:'Unchanged body',frontmatter:{
   tpsId:'conflicting-kind',tpsSchemaVersion:1,kind:'unrelated',title:'Other lunch',tags:['kind/food/transaction'],calories:100,
  },
 }));
 vault.emit('modify',conflicting);
 const before=contents.get(conflicting);
 assert.equal(await service.update(conflicting,{calories:150}),null);
 assert.equal(contents.get(conflicting),before,'an occupied non-legacy scalar is never replaced by a list');
});

test('configured shared kind-list identity keeps native record subtypes distinct', async () => {
 const {service,plugin,contents}=createHarness();
 plugin.settings.nativeRecordKindPropertyKeys={
  'finance-transaction':{
   primary:{kindList:{key:'category',value:'transaction/money'}},
   aliases:[{tag:'legacy/finance'}],
   discriminator:{key:'recordType',value:'ordinary'},
  },
  'investment-transaction':{
   primary:{kindList:{key:'category',value:'transaction/money'}},
   aliases:[{tag:'legacy/investment'}],
   discriminator:{key:'recordType',value:'investment'},
  },
 };
 const ordinary={tpsId:'ordinary-one',title:'Coffee',category:['transaction/money'],recordType:'ordinary'};
 const investment={tpsId:'investment-one',title:'Shares',category:['transaction/money'],recordType:'investment'};
 assert.equal(service.inspect(ordinary)?.kind,'finance-transaction');
 assert.equal(service.inspect(investment)?.kind,'investment-transaction');
 assert.equal(service.inspect({...ordinary,recordType:'other'}),null);
 assert.equal(service.inspect({tpsId:'unknown',title:'Unknown',category:['transaction/money']}),null);
 assert.equal(service.inspect({tpsId:'old',title:'Old',tags:['legacy/investment']})?.kind,'investment-transaction');
 const created=await service.create('investment-transaction',{title:'New shares'},{id:'investment-new'});
 const persisted=parseNativeRecordDocument(contents.get(created.file)).frontmatter;
 assert.deepEqual(persisted.category,['transaction/money']);
 assert.equal(persisted.recordType,'investment');
 assert.equal(service.inspect(persisted)?.kind,'investment-transaction');
 assert.equal((await service.update(created.path,{title:'Updated shares'}))?.kind,'investment-transaction');
 assert.equal(parseNativeRecordDocument(contents.get(created.file)).frontmatter.recordType,'investment');
 await assert.rejects(service.create('finance-transaction',{title:'Wrong',recordType:'investment'},{id:'wrong'}),/collides|conflicting/u);
});

test('cold index resolves migrated scalar records through configured list and subtype fields', async () => {
 const {service,plugin,addFile}=createHarness();
 plugin.settings.nativeRecordKindPropertyKeys={
  'finance-transaction':{
   primary:{kindList:{key:'kind',value:'transaction/financial'}},
   aliases:[{scalar:{key:'kind',value:'finance-transaction'}}],
   discriminator:{key:'type',value:'transaction'},
  },
  'investment-transaction':{
   primary:{kindList:{key:'kind',value:'transaction/financial'}},
   aliases:[{scalar:{key:'kind',value:'investment-transaction'}}],
   discriminator:{key:'type',value:'investmentTransaction'},
  },
  'activity-entry':{
   primary:{kindList:{key:'kind',value:'transaction/activity'}},
   aliases:[{scalar:{key:'kind',value:'activity-entry'}}],
  },
 };
 const finance=addFile('Inbox/migrated-finance.md',serializeNativeRecordDocument({
  bom:'',newline:'\n',closer:'---',body:'Finance body',frontmatter:{
   tpsId:'wallet:migrated-one',title:'Coffee',kind:['transaction/financial'],type:'transaction',amount:5,
  },
 }));
 const activity=addFile('Inbox/migrated-activity.md',serializeNativeRecordDocument({
  bom:'',newline:'\n',closer:'---',body:'Activity body',frontmatter:{
   tpsId:'activity:migrated-one',title:'Walk',kind:['transaction/activity'],distance:2,
  },
 }));
 service.refreshConfiguration();
 assert.equal(service.inspect({tpsId:'wallet:migrated-one',title:'Coffee',kind:['transaction/financial'],type:'transaction'})?.kind,'finance-transaction');
 assert.equal(service.inspect({tpsId:'activity:migrated-one',title:'Walk',kind:['transaction/activity']})?.kind,'activity-entry');
 assert.equal((await service.resolve('wallet:migrated-one'))?.file,finance);
 assert.equal((await service.resolve('activity:migrated-one'))?.file,activity);
 assert.equal((await service.resolve(finance))?.kind,'finance-transaction');
 assert.equal((await service.resolve(activity))?.kind,'activity-entry');
 assert.deepEqual((await service.snapshot()).records.map(record=>record.id).sort(),['activity:migrated-one','wallet:migrated-one']);
});

test('all configured shared-path groups create and resolve without legacy tags after a cold index',async()=>{
 const {service,plugin,contents}=createHarness();
 const groups={
  'transaction/financial':{'finance-transaction':['type','transaction'],'investment-transaction':['type','investmentTransaction']},
  'entity/food':{food:['tpsRecordType','food'],meal:['tpsRecordType','meal'],recipe:['tpsRecordType','recipe']},
  'transaction/macros':{'food-entry':['tpsRecordType','food-entry'],'meal-entry':['tpsRecordType','meal-entry']},
  'transaction/workout':{'workout-session':['tpsRecordType','workout-session'],'workout-exercise':['tpsRecordType','workout-exercise']},
  'task/project':{project:['tpsRecordType','project'],collection:['tpsRecordType','collection']},
 };
 plugin.settings.nativeRecordKindPropertyKeys=Object.fromEntries(Object.entries(groups).flatMap(([path,kinds])=>Object.entries(kinds).map(([kind,[key,value]])=>[
  kind,{primary:{kindList:{key:'kind',value:path}},aliases:[{tag:`legacy/${kind}`}],discriminator:{key,value}},
 ])));
 const created=[];
 for(const [path,kinds] of Object.entries(groups))for(const [kind,[key,value]] of Object.entries(kinds)){
  const record=await service.create(kind,{title:`New ${kind}`},{id:`sample:${kind}`});
  const persisted=parseNativeRecordDocument(contents.get(record.file)).frontmatter;
  assert.deepEqual(persisted.kind,[path]);
  assert.equal(persisted[key],value);
  assert.equal(Object.hasOwn(persisted,'tags'),false);
  assert.equal(service.inspect(persisted)?.kind,kind);
  created.push(record);
 }
 service.refreshConfiguration();
 for(const record of created){
  assert.equal((await service.resolve(record.id))?.kind,record.kind);
  assert.equal((await service.resolve(record.file))?.kind,record.kind);
 }
 assert.equal((await service.snapshot()).records.length,created.length);
});

test('canonical calendar records preserve template-authored kind lists', async () => {
 const {service,contents}=createHarness();
 const event=await service.create('calendar-event',{title:'Meeting',kind:['transaction/event','user/visible']},
  {id:'calendar:v1:abcdefghijklmnop:abcdefghijklmnopqrstuvwxyz7'});
 assert.match(contents.get(event.file),/transaction\/event/u);
 await service.update(event.path,{scheduled:'2026-10-03'});
 assert.match(contents.get(event.file),/user\/visible/u);
 assert.equal((await service.resolve(event.path))?.kind,'calendar-event');
});

test('disabled kind writer rejects native creation while older matching notes remain readable', async () => {
 const {service,plugin,entries}=createHarness();
 plugin.settings.nativeRecordKindPropertyKeys={'food-entry':{
  primary:{tag:'kind/food/transaction'},aliases:[{scalar:{key:'kind',value:'food-entry'}}],writeDisabled:true,
 }};
 assert.equal(service.inspect({tpsId:'older-food',title:'Lunch',tags:['kind/food/transaction']})?.kind,'food-entry');
 await assert.rejects(service.create('food-entry',{title:'New lunch'}),/disabled until a writer is configured/u);
 assert.equal([...entries.values()].filter(entry=>entry instanceof TFile).length,0);
});

test('configured subtype values decode to canonical record kinds and reject conflicting hierarchy identities',async()=>{
 const {service,plugin,contents}=createHarness();
 plugin.settings.nativeRecordKindPropertyKeys={'food-entry':{key:'transactionKind',value:'food',parentKind:'transaction'}};
 const entry=await service.create('food-entry',{title:'Snack'});
 assert.match(contents.get(entry.file),/^transactionKind: food$/m);
 assert.equal(service.inspect({tpsId:entry.id,title:'Snack',kind:'transaction',transactionKind:'food'})?.kind,'food-entry');
 assert.equal(service.inspect({tpsId:entry.id,title:'Snack',kind:'entity',transactionKind:'food'}),null);
 assert.equal(service.inspect({tpsId:entry.id,title:'Snack',kind:'food-entry'}),null);
});

test('calendar template classification survives creation and update with Health classifications configured',async()=>{
 const {service,plugin,contents}=createHarness();
 plugin.settings.nativeRecordKindPropertyKeys={'food-entry':{key:'transactionKind',value:'food-entry',parentKind:'transaction'},food:{key:'entityKind',value:'food',parentKind:'entity'}};
 const created=await service.create('calendar-event',{title:'Meeting',kind:'transaction',transactionKind:'event'},{id:'calendar:v1:abcdefghijklmnop:abcdefghijklmnopqrstuvwxyz0'});
 assert.match(contents.get(created.file),/^transactionKind: event$/m);
 await service.update(created.path,{scheduled:'2026-09-28'});
 assert.match(contents.get(created.file),/^kind: transaction$/m);assert.match(contents.get(created.file),/^transactionKind: event$/m);
 assert.equal((await service.resolve(created.path))?.kind,'calendar-event');
});

test('calendar hierarchy preserves legacy IDs while canonical calendar IDs do not require public classification',async()=>{
 const {service,plugin,contents}=createHarness();
 plugin.settings.nativeRecordKindPropertyKeys={'calendar-event':{key:'transactionKind',value:'event',parentKind:'transaction'}};
 const legacy=await service.create('calendar-event',{title:'Legacy'},{id:'legacy-calendar-id'});
 assert.match(contents.get(legacy.file),/^kind: transaction$/m);assert.equal((await service.resolve(legacy.path))?.kind,'calendar-event');
 const event=await service.create('calendar-event',{title:'Event',kind:'transaction',transactionKind:'event'},{id:'calendar:v1:abcdefghijklmnop:abcdefghijklmnopqrstuvwxyzz'});
 await service.update(event.path,{scheduled:'2026-09-29'});assert.match(contents.get(event.file),/^transactionKind: event$/m);
 const plain=await service.create('calendar-event',{title:'No default classification'},{id:'calendar:v1:abcdefghijklmnop:abcdefghijklmnopqrstuvwxyz1'});
 assert.equal((await service.resolve(plain.path))?.kind,'calendar-event');assert.doesNotMatch(contents.get(plain.file),/^kind:/m);
});

test('presentation profile reads share prepared mappings and return detached nested classifications', () => {
  const { service, plugin } = createHarness();
  plugin.settings.nativeRecordKindPropertyKeys = Object.fromEntries(
    Array.from({ length: 26 }, (_, i) => [`perf-${i}`, { key: 'entityKind', parentKind: 'entity', value: `type-${i}` }]),
  );
  let configurations = 0;
  const resolve = service.getStorageConfiguration;
  service.getStorageConfiguration = function () { configurations++; return resolve.call(this); };
  for (let i = 0; i < 1000; i++) {
    assert.equal(service.getStorageProfile('perf-0').classification.value, 'type-0');
    assert.equal(service.getIdentityEvidenceProfiles().length >= 27, true);
    assert.equal(service.getReadableStorageProfiles().length, 27);
  }
  assert.equal(configurations, 1, 'shared settings resolve once, not once per note/mapping');
  const publicProfile = service.getStorageProfile('perf-0');
  publicProfile.classification.value = 'poisoned';
  const evidence = service.getIdentityEvidenceProfiles();
  evidence[1].classification.parentKind = 'poisoned';
  const keys = service.getKindPropertyKeys();
  keys['perf-0'] = 'poisoned';
  assert.equal(service.getStorageProfile('perf-0').classification.value, 'type-0');
  assert.equal(service.getStorageProfile('perf-0').classification.parentKind, 'entity');
  assert.equal(service.getKindPropertyKeys()['perf-0'], 'entityKind');
  plugin.settings.nativeRecordKindPropertyKeys['perf-0'].value = 'updated';
  assert.equal(service.getStorageProfile('perf-0').classification.value, 'updated');
  assert.equal(configurations, 2, 'in-place settings edits invalidate prepared mappings');
});

test('complete configured tags replace kind properties through record creation, update and re-identify', async () => {
 const {service,plugin,contents}=createHarness();
 plugin.settings.nativeRecordKindPropertyKeys={'food-entry':{tag:'kind/food/transaction'}};
 const created=await service.create('food-entry',{title:'Lunch',tags:['favorite']},{id:'tag-food'});
 assert.match(contents.get(created.file),/kind\/food\/transaction/);
 assert.doesNotMatch(contents.get(created.file),/^kind:/m);
 assert.equal(service.inspect({tpsId:'tag-food',title:'Lunch',tags:['kind/food/transaction']})?.kind,'food-entry');
 assert.equal(service.inspect({tpsId:'tag-food',title:'Lunch',kind:'food-entry'}),null);
 const updated=await service.update(created.path,{calories:180});assert.equal(updated.kind,'food-entry');
 assert.match(contents.get(created.file),/favorite/);assert.doesNotMatch(contents.get(created.file),/^kind:/m);
 const renamed=await service.reidentify(created.path,'tag-food-new');assert.equal(renamed.kind,'food-entry');
 assert.equal((await service.resolve(created.path))?.id,'tag-food-new');
});

test('tags have arbitrary paths, exact matching and ambiguous identities are rejected', async () => {
 const {service,plugin}=createHarness();
 plugin.settings.nativeRecordKindPropertyKeys={'food-entry':{tag:'food'},exercise:{tag:'Food/Library/custom/entry'}};
 assert.equal(service.inspect({tpsId:'a',title:'A',tags:['FOOD']})?.kind,'food-entry');
 assert.equal(service.inspect({tpsId:'a',title:'A',tags:['food/other']}),null);
 assert.equal(service.inspect({tpsId:'a',title:'A',tags:['food','Food/Library/custom/entry']}),null);
 plugin.settings.nativeRecordKindPropertyKeys['food-entry'].tag='logs/nutrition';
 assert.equal(service.inspect({tpsId:'a',title:'A',tags:['FOOD']}),null);
 assert.equal(service.inspect({tpsId:'a',title:'A',tags:['logs/nutrition']})?.kind,'food-entry');
});

test('canonical calendar identity remains independent of public template tags',async()=>{
 const {service,plugin,contents}=createHarness();
 plugin.settings.nativeRecordKindPropertyKeys={'calendar-event':{tag:'anything/events'},'food-entry':{tag:'kind/food/transaction'}};
 const created=await service.create('calendar-event',{title:'Calendar',tags:['anything/events']},{id:'calendar:v1:abcdefghijklmnop:abcdefghijklmnopqrstuvwxyz2'});
 await service.update(created.path,{scheduled:'2026-10-01'});
 assert.equal((await service.resolve(created.path))?.kind,'calendar-event');
 assert.match(contents.get(created.file),/anything\/events/);assert.doesNotMatch(contents.get(created.file),/^kind:/m);
});


function countedRecordInspection(service, raw) {
  const calls = new Map();
  let copies = 0;
  globalThis.__nativeRecordProfileInspection = (source, profile) => {
    assert.equal(source, raw, 'this synchronous operation only inspects its input');
    calls.set(profile, (calls.get(profile) || 0) + 1);
  };
  globalThis.__nativeRecordEnvelopeCopy = () => { copies++; };
  try {
    return { result: service.inspect(raw), calls, get copies() { return copies; } };
  } finally {
    delete globalThis.__nativeRecordProfileInspection;
    delete globalThis.__nativeRecordEnvelopeCopy;
  }
}

function assertSingleProfileEvaluation(measurement, expectedCalls, expectedCopies) {
  assert.equal([...measurement.calls.values()].every(count => count === 1), true,
    'a prepared profile must be evaluated at most once during one inspection, including null results');
  assert.equal(measurement.calls.size, expectedCalls);
  assert.equal(measurement.copies, expectedCopies);
}

function manualStartupTasks(route = 'scheduler') {
  const original = {
    scheduler: globalThis.scheduler,
    MessageChannel: globalThis.MessageChannel,
    setTimeout: globalThis.setTimeout,
  };
  const pending = [];
  let closedPorts = 0;
  const schedule = () => new Promise((resolve, reject) => { resolve.reject = reject; pending.push(resolve); });
  globalThis.scheduler = route === 'scheduler' ? { yield: schedule } : undefined;
  globalThis.MessageChannel = route === 'channel' ? class {
    port1 = { onmessage: null, close() { closedPorts++; } };
    port2 = { close() { closedPorts++; }, postMessage: () => pending.push(() => this.port1.onmessage?.()) };
  } : undefined;
  if (route === 'timer') globalThis.setTimeout = callback => { pending.push(callback); return 1; };
  return {
    get pending() { return pending.length; },
    get closedPorts() { return closedPorts; },
    async step() {
      assert.ok(pending.length, 'an owned task boundary must be pending');
      pending.shift()();
      for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    },
    async fail(error) {
      const continuation = pending.shift();
      assert.equal(typeof continuation?.reject, 'function', 'a scheduler task must be owned before rejection');
      continuation.reject(error);
      for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    },
    async drain() {
      for (let tasks = 0; pending.length; tasks++) {
        assert.ok(tasks < 100, 'finite startup cannot introduce a retry loop');
        await this.step();
      }
    },
    restore() { Object.assign(globalThis, original); },
  };
}

function startupLoad(mode = 'native-records', count = 1025) {
  const h = createHarness(mode, { deferSetup: true, layoutReady: false });
  const counters = { inventories: 0, metadata: 0, reads: 0, writes: 0 };
  for (let i = 0; i < count; i++) {
    const file = h.addFile(`startup-${i}.md`, '');
    h.metadata.set(file, { tpsId: `startup-${i}`, tpsSchemaVersion: 1, kind: 'task', title: `Task ${i}` });
  }
  for (const [host, method, key] of [
    [h.vault, 'getMarkdownFiles', 'inventories'],
    [h.plugin.app.metadataCache, 'getFileCache', 'metadata'],
    [h.vault, 'read', 'reads'], [h.vault, 'cachedRead', 'reads'],
    [h.vault, 'create', 'writes'], [h.vault, 'process', 'writes'], [h.vault, 'rename', 'writes'],
  ]) {
    const original = host[method];
    host[method] = function (...args) { counters[key]++; return original.apply(this, args); };
  }
  return { ...h, counters };
}

function startupPublicationHarness(h, dailyConfigurationReady = Promise.resolve()) {
  // Preserve every prior publication/unload assertion against the complete
  // actual lifecycle, now including the layout-owned initialization method.
  const harn = coldStartupHarness(h, { dailyConfigurationReady });
  return {
    ...harn,
    get availability() { return harn.availability.map(packet => packet.available); },
  };
}

function assertColdStartupContinuationOwners(h, p, tasks) {
  assert.ok(h.service.initialDiscovery?.queue.size, 'Native discovery still owns unfinished work');
  // Whole onload uses both actual owners. Parent contributes an independent
  // continuation when its elapsed 8 ms budget is reached, including under load.
  const parent = p.plugin.parentLinkResolutionService;
  assert.equal(tasks.pending, 1 + Number(!parent.indexReady),
    'one Native continuation plus the independently suspended Parent owner');
}

async function flushStartupMicrotasks() {
  for (let turn = 0; turn < 16; turn++) await Promise.resolve();
}

function coldStartupHarness(h, {
  initialized = true,
  dailyConfigurationReady = Promise.resolve(),
  settingsReady = Promise.resolve(),
  historyStore,
  actualDaily = false,
} = {}) {
  // The whole real onload is executed, not just the pre-publication prefix.
  // UI/component implementations are bounded registration facades; native and
  // parent discovery are actual services with an actual synthetic file host.
  const source = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true);
  const owner = source.statements.find(node => ts.isClassDeclaration(node)
    && node.name?.text === 'TPSGlobalContextMenuPlugin');
  assert.ok(owner);
  const methods = owner.members.filter(member => ts.isMethodDeclaration(member)
    && /^(?:onload|onunload|emitGcmApiChanged|registerNoteTitleDocument)$|startup|initializ/i.test(member.name.getText(source)));
  const fields = owner.members.filter(member => ts.isPropertyDeclaration(member)
    && /startup|initializ/i.test(member.name.getText(source)));
  for (const name of ['onload', 'onunload', 'emitGcmApiChanged']) {
    assert.ok(methods.some(member => member.name.getText(source) === name), `${name} must be actual source`);
  }
  const bindings = [];
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause) continue;
    const clause = node.importClause;
    if (clause.name) bindings.push(clause.name.text);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) bindings.push(clause.namedBindings.name.text);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const binding of clause.namedBindings.elements) bindings.push(binding.name.text);
    }
  }
  const noop = new Proxy(function () { return noop; }, {
    get(_target, key) {
      if (key === 'then') return undefined;
      if (key === Symbol.toPrimitive) return () => '';
      if (key === Symbol.iterator) return function* () {};
      return noop;
    },
    construct() { return noop; },
  });
  const layoutCallbacks = [], cleanups = [], publications = [], availability = [];
  const workspaceListeners = new Map();
  const registrations = { commands: 0, editors: 0, markdown: 0, dom: 0, settings: 0, events: 0, interactions: 0 };
  let relationshipInventories = 0;
  h.vault.getAllLoadedFiles = () => { relationshipInventories++; return [...h.entries.values()]; };
  Object.assign(h.plugin.app.workspace, {
    on(name, callback) {
      const handlers = workspaceListeners.get(name) || [];
      handlers.push(callback);
      workspaceListeners.set(name, handlers);
      return {};
    },
    trigger(name, packet) {
      if (name === 'tps:gcm-api-changed') availability.push(packet);
      for (const callback of workspaceListeners.get(name) || []) callback(packet);
    },
    onLayoutReady(callback) {
      if (this.layoutReady) callback();
      else layoutCallbacks.push(callback);
    },
    updateOptions() {},
    iterateAllLeaves() {},
    getActiveFile: () => null,
    getLeavesOfType: () => [],
  });
  if (initialized === null) delete h.plugin.app.metadataCache.initialized;
  else h.plugin.app.metadataCache.initialized = initialized;
  const dependencies = Object.fromEntries(bindings.map(name => [name, noop]));
  Object.assign(dependencies, {
    NativeRecordService: class { constructor() { return h.service; } },
    ParentLinkResolutionService,
    FileNamingService: actualDaily ? FileNamingService : class { whenDailyNoteConfigurationReady() { return dailyConfigurationReady; } },
    FilePropertiesService: class {
      isCompanionFile() { return false; }
      isPropertyTarget() { return false; }
      handleMetadataResolved() { return Promise.resolve(); }
      setup() { return Promise.resolve(); }
      dispose() {}
    },
    Platform: { isMobile: false },
    TPS_EVENTS: { GCM_API_CHANGED: 'tps:gcm-api-changed', GCM_API_REQUEST: 'tps:gcm-api-request' },
    registerGcmEvents() { registrations.events++; },
    registerGcmCommands() { registrations.commands++; },
    setupPluginApi(plugin) {
      publications.push(h.service.recordsByPath.size);
      plugin.api = { nativeRecords: h.service };
    },
    window: { clearTimeout() {}, setTimeout() { return 1; }, setInterval() { return 1; } },
    setTimeout() { return 1; },
    document: { body: { classList: { remove() {} } } },
    TPSGlobalContextMenuPlugin: { BUILD_STAMP: 'actual-full-onload-cold-test' },
  });
  if (historyStore) dependencies.ItemHistoryService = class {
    constructor(plugin) { return new ItemHistoryService(plugin, historyStore); }
  };
  const code = ts.transpileModule(`export class Startup {
    ${fields.map(member => member.getText(source)).join('\n')}
    ${methods.map(member => member.getText(source)).join('\n')}
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(dependencies), code)(exports, ...Object.values(dependencies));
  const plugin = new Proxy(Object.assign(new exports.Startup(), h.plugin, {
    manifest: { id: 'tps-global-context-menu', dir: '.obsidian/plugins/tps-global-context-menu' },
    loadSettings: () => settingsReady,
    usesNativeRecordArchitecture: () => h.plugin.settings.dataArchitectureMode === 'native-records',
    shouldInstallWorkspaceOpenPatch: () => false,
    canRunBackgroundAutomation: () => false,
    register: callback => cleanups.push(callback),
    registerEditorExtension: () => registrations.editors++,
    registerMarkdownPostProcessor: () => registrations.markdown++,
    registerDomEvent: () => registrations.dom++,
    addSettingTab: () => registrations.settings++,
    registerInteractionHandlers: () => registrations.interactions++,
  }), { get(target, key, receiver) { return key === 'api' || Reflect.has(target, key) ? Reflect.get(target, key, receiver) : noop; } });
  return {
    plugin, publications, availability, registrations, layoutCallbacks,
    get relationshipInventories() { return relationshipInventories; },
    requestApi: () => h.plugin.app.workspace.trigger('tps:gcm-api-request'),
    layout() {
      h.plugin.app.workspace.layoutReady = true;
      for (const callback of layoutCallbacks.splice(0)) callback();
    },
    unload() { plugin.onunload(); for (const cleanup of cleanups.slice().reverse()) cleanup(); },
  };
}

test('cold split: full onload finishes registrations without awaiting layout-started discovery', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  let settled = false;
  const loaded = p.plugin.onload().then(() => { settled = true; });
  try {
    await flushStartupMicrotasks();
    assert.equal(settled, true, 'Obsidian must be able to finish plugin loading before layout readiness');
    assert.equal(p.registrations.commands, 1);
    assert.ok(p.registrations.editors >= 3);
    assert.equal(p.registrations.markdown, 1);
    assert.ok(p.registrations.dom >= 3);
    assert.equal(p.registrations.settings, 1);
    assert.equal(p.registrations.events, 1);
    assert.equal(p.registrations.interactions, 1);
    assert.equal(p.plugin.api, undefined);
  } finally { p.unload(); await tasks.drain(); await loaded; tasks.restore(); }
});

test('cold split: full onload performs zero native or relationship inventory before layout', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  const loaded = p.plugin.onload();
  try {
    await flushStartupMicrotasks();
    assert.deepEqual(h.counters, { inventories: 0, metadata: 0, reads: 0, writes: 0 });
    assert.equal(p.relationshipInventories, 0);
    assert.equal(tasks.pending, 0, 'no discovery continuation runs before the host is ready');
  } finally { p.unload(); await tasks.drain(); await loaded; tasks.restore(); }
});

test('cold split: native listeners capture startup events without per-file indexing before layout', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  const loaded = p.plugin.onload();
  try {
    await flushStartupMicrotasks();
    for (let index = 0; index < 100; index++) h.vault.emit('create', h.vault.getFileByPath(`startup-${index}.md`));
    h.plugin.app.metadataCache.emit('changed', h.vault.getFileByPath('startup-0.md'), '', {
      frontmatter: { tpsId: 'startup-0', tpsSchemaVersion: 1, kind: 'task', title: 'Latest before layout' },
    });
    h.metadata.set(h.vault.getFileByPath('startup-0.md'), {
      tpsId: 'startup-0', tpsSchemaVersion: 1, kind: 'task', title: 'Latest before layout',
    });
    assert.deepEqual(h.counters, { inventories: 0, metadata: 0, reads: 0, writes: 0 });
    assert.equal(h.service.recordsByPath.size, 0);
    for (let index = 0; index < 100; index++) {
      assert.equal(h.service.newlyCreatedFiles.has(h.vault.getFileByPath(`startup-${index}.md`)), false,
        'host discovery creates are not user task drafts');
    }
    p.layout();
    await tasks.drain();
    await flushStartupMicrotasks();
    assert.equal(h.counters.inventories, 1);
    assert.equal(h.service.recordsByPath.size, 1025);
    assert.equal(h.service.recordsByPath.get('startup-0.md').title, 'Latest before layout');
  } finally { p.unload(); await tasks.drain(); await loaded; tasks.restore(); }
});

test('cold split: the relationship listener waits for layout even with warm metadata proof', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad('native-records', 2);
  const p = coldStartupHarness(h);
  // Actual relationship setup isolated from the main native barrier makes this
  // control independently fail for the eager relationship owner.
  const service = new ParentLinkResolutionService(p.plugin);
  p.plugin.parentLinkResolutionService = service;
  p.plugin.filePropertiesService = { isCompanionFile: () => false, isPropertyTarget: () => false };
  try {
    service.setup({ afterLayout: true });
    assert.equal(p.relationshipInventories, 0);
    assert.equal(h.counters.metadata, 0);
    p.layout();
    await flushStartupMicrotasks();
    assert.equal(p.relationshipInventories, 1);
    assert.equal(h.counters.metadata, 2);
  } finally { p.unload(); tasks.restore(); }
});

test('cold split: API requests remain unavailable until one complete owned post-layout inventory', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  const loaded = p.plugin.onload();
  try {
    await flushStartupMicrotasks();
    p.requestApi();
    assert.equal(p.availability.at(-1)?.available, false, 'early consumers receive an explicit unavailable announcement');
    assert.equal(p.plugin.api, undefined);
    p.layout();
    await flushStartupMicrotasks();
    assertColdStartupContinuationOwners(h, p, tasks);
    assert.equal(p.plugin.api, undefined);
    p.requestApi();
    assert.equal(p.availability.at(-1)?.available, false);
    await tasks.drain();
    await flushStartupMicrotasks();
    assert.equal(h.counters.inventories, 1, 'Native retains its single initial inventory');
    assert.deepEqual(p.publications, [1025]);
    assert.equal(p.availability.at(-1)?.available, true);
    assert.equal(p.relationshipInventories, 1);
    assert.equal(h.counters.reads + h.counters.writes, 0);
  } finally { p.unload(); await tasks.drain(); await loaded; tasks.restore(); }
});

test('cold split: a resolved event during the settings await is not lost by late relationship setup', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad('native-records', 2);
  let release;
  const p = coldStartupHarness(h, { initialized: false, settingsReady: new Promise(resolve => { release = resolve; }) });
  const loaded = p.plugin.onload();
  try {
    h.plugin.app.metadataCache.emit('resolved');
    release();
    await flushStartupMicrotasks();
    p.layout();
    await tasks.drain();
    await flushStartupMicrotasks();
    assert.equal(p.relationshipInventories, 1, 'the public global-resolution proof survives earlier startup awaits');
    assert.equal(h.counters.inventories, 1);
    assert.deepEqual(p.publications, [2]);
  } finally { p.unload(); await tasks.drain(); await loaded; tasks.restore(); }
});

test('cold split: actual Daily metadata owner receives global resolution captured during loadSettings', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad('native-records', 2);
  let release;
  const p = coldStartupHarness(h, { initialized: null, actualDaily: true,
    settingsReady: new Promise(resolve => { release = resolve; }),
  });
  const loaded = p.plugin.onload();
  try {
    h.plugin.app.metadataCache.emit('resolved');
    assert.equal(p.plugin.startupMetadataResolved, true, 'actual early onload listener observes the public proof');
    release();
    await loaded;
    await p.plugin.fileNamingService.whenDailyNoteConfigurationReady();
    assert.equal(p.plugin.fileNamingService.isDailyNoteMetadataCacheReady(), true,
      'the late actual Daily constructor must not lose an already observed global resolved event');
    assert.deepEqual(h.counters, { inventories: 0, metadata: 0, reads: 0, writes: 0 });
    assert.equal(p.relationshipInventories, 0);
    p.layout();
    await tasks.drain();
    await flushStartupMicrotasks();
    assert.deepEqual(p.publications, [2]);
  } finally { release(); p.unload(); await tasks.drain(); await loaded; tasks.restore(); }
});

test('cold split: actual Daily owner retains explicit whole-cache rebuild blocking', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad('native-records', 2);
  let release;
  const p = coldStartupHarness(h, { initialized: false, actualDaily: true,
    settingsReady: new Promise(resolve => { release = resolve; }),
  });
  const loaded = p.plugin.onload();
  try {
    h.plugin.app.metadataCache.emit('resolved');
    release();
    await loaded;
    await p.plugin.fileNamingService.whenDailyNoteConfigurationReady();
    assert.equal(p.plugin.fileNamingService.isDailyNoteMetadataCacheReady(), false,
      'a prior captured proof cannot override an explicit current whole-cache rebuild');
    h.plugin.app.metadataCache.initialized = true;
    h.plugin.app.metadataCache.emit('resolved');
    await flushStartupMicrotasks();
    assert.equal(p.plugin.fileNamingService.isDailyNoteMetadataCacheReady(), true);
  } finally { release(); p.unload(); await tasks.drain(); await loaded; tasks.restore(); }
});

test('cold split: actual Daily readiness without a private flag still requires current public global proof', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad('native-records', 2);
  const p = coldStartupHarness(h, { initialized: null, actualDaily: true });
  const loaded = p.plugin.onload();
  try {
    await loaded;
    await p.plugin.fileNamingService.whenDailyNoteConfigurationReady();
    assert.equal(p.plugin.fileNamingService.isDailyNoteMetadataCacheReady(), false, 'no proof is not readiness');
    h.plugin.app.metadataCache.emit('resolved');
    await flushStartupMicrotasks();
    assert.equal(p.plugin.fileNamingService.isDailyNoteMetadataCacheReady(), true);
    h.plugin.app.metadataCache.initialized = false;
    assert.equal(p.plugin.fileNamingService.isDailyNoteMetadataCacheReady(), false, 'current rebuild revokes prior proof');
    delete h.plugin.app.metadataCache.initialized;
    assert.equal(p.plugin.fileNamingService.isDailyNoteMetadataCacheReady(), false, 'removing the private flag cannot revive stale proof');
    h.plugin.app.metadataCache.emit('resolved');
    await flushStartupMicrotasks();
    assert.equal(p.plugin.fileNamingService.isDailyNoteMetadataCacheReady(), true, 'new public proof owns recovery');
    assert.deepEqual(h.counters, { inventories: 0, metadata: 0, reads: 0, writes: 0 });
  } finally { p.unload(); await tasks.drain(); await loaded; tasks.restore(); }
});

test('cold split: disposal before layout settles early native commands without source or reservation work', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad('native-records', 2);
  const p = coldStartupHarness(h);
  const setup = h.service.setup({ afterLayout: true });
  const outcomes = Promise.allSettled([
    h.service.createFresh('task', { title: 'Must not allocate' }),
    h.service.create('task', { title: 'Must not reserve' }, { id: 'cancelled-creation' }),
    h.service.resolve('startup-0.md'),
    h.service.snapshot(),
  ]);
  try {
    await flushStartupMicrotasks();
    assert.deepEqual(h.counters, { inventories: 0, metadata: 0, reads: 0, writes: 0 });
    h.service.dispose();
    assert.equal(await setup, false);
    for (const outcome of await outcomes) {
      assert.equal(outcome.status, 'rejected');
      assert.match(String(outcome.reason), /startup was cancelled/u);
    }
    p.layout();
    await tasks.drain();
    assert.deepEqual(h.counters, { inventories: 0, metadata: 0, reads: 0, writes: 0 });
    assert.equal(h.service.inFlightCreateIds.size, 0);
    assert.equal(h.service.recordsByPath.size, 0);
  } finally { h.service.dispose(); await setup; await outcomes; await tasks.drain(); tasks.restore(); }
});

test('cold split: explicit synchronous configuration replacement before layout fully owns readiness', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad('native-records', 2);
  const p = coldStartupHarness(h);
  const setup = h.service.setup({ afterLayout: true });
  try {
    h.plugin.settings.nativeRecordKindPropertyKeys = { task: { key: 'transactionKind', value: 'task', parentKind: 'transaction' } };
    for (const file of h.vault.getMarkdownFiles()) h.metadata.set(file, {
      tpsId: file.basename, kind: 'transaction', transactionKind: 'task', title: `Mapped ${file.basename}`,
    });
    const inventoriesBeforeReplacement = h.counters.inventories;
    h.service.refreshConfiguration();
    assert.equal(h.service.recordsByPath.size, 2, 'explicit replacement remains synchronous');
    assert.equal(await setup, true);
    const after = { ...h.counters };
    assert.equal(after.inventories - inventoriesBeforeReplacement, 1);
    p.layout();
    await tasks.drain();
    assert.deepEqual(h.counters, after, 'the superseded layout callback cannot rescan or republish');
    for (const file of h.vault.getMarkdownFiles()) {
      const record = h.service.recordsByPath.get(file.path);
      assert.equal(record.tpsId, file.basename);
      assert.equal(record.kind, 'task', 'the index retains its normalized structural envelope');
      assert.equal(h.metadata.get(file).transactionKind, 'task', 'authored mapping remains unchanged');
      assert.equal(h.service.inspect(h.metadata.get(file))?.kind, 'task');
    }
    assert.equal(h.counters.reads + h.counters.writes, 0);
  } finally { h.service.dispose(); await setup; await tasks.drain(); tasks.restore(); }
});

test('cold split: failed explicit replacement before layout rejects the owned readiness without retry or publication', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad('native-records', 2);
  const p = coldStartupHarness(h, { historyStore: new MemoryItemHistoryStore() });
  const loaded = p.plugin.onload();
  try {
    await loaded;
    h.service.indexFile = () => { throw new Error('synthetic early explicit replacement failure'); };
    assert.throws(() => h.service.refreshConfiguration(), /synthetic early explicit replacement failure/u);
    await assert.rejects(h.service.setup(), /synthetic early explicit replacement failure/u);
    p.layout();
    await tasks.drain();
    await flushStartupMicrotasks();
    assert.deepEqual(p.publications, []);
    assert.equal(p.plugin.api, undefined);
    assert.equal(h.counters.inventories, 1, 'initial layout work cannot restart the failed replacement');
    assert.equal(h.counters.reads + h.counters.writes, 0);
  } finally { p.unload(); await loaded; await tasks.drain(); tasks.restore(); }
});

test('cold split: early fresh creation waits before generating or reserving an identity', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  const setup = h.service.setup({ afterLayout: true });
  let generated = 0;
  const generate = h.service.generateCryptographicId.bind(h.service);
  h.service.generateCryptographicId = (...args) => { generated++; return generate(...args); };
  let result;
  const create = h.service.createFresh('food-entry', { title: 'Early food' }).then(value => { result = value; }, error => { result = error; });
  try {
    await flushStartupMicrotasks();
    assert.equal(generated, 0, 'readiness joins before ID allocation, not merely before the final write');
    assert.equal(h.service.inFlightCreateIds.size, 0);
    assert.equal(h.counters.writes, 0);
    assert.equal(result, undefined);
    p.layout();
    await tasks.drain();
    assert.equal(await setup, true);
    await create;
    assert.ok(result?.file instanceof TFile);
    assert.equal(generated, 1);
    assert.equal(h.counters.writes, 1);
  } finally { h.service.dispose(); await tasks.drain(); await setup; await create; tasks.restore(); }
});

test('cold split: early asset creation waits before checking the incomplete asset map', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  const image = h.addFile('image.png', 'synthetic image');
  const asset = h.addFile('existing-asset.md', `---\ntpsId: asset-existing\ntpsSchemaVersion: 1\nkind: asset\ntitle: Existing\nsourcePath: image.png\nsourceExtension: png\n---\n`);
  const setup = h.service.setup({ afterLayout: true });
  let cachedLookups = 0;
  const lookup = h.service.resolveAssetCached.bind(h.service);
  h.service.resolveAssetCached = (...args) => { cachedLookups++; return lookup(...args); };
  let result;
  const create = h.service.ensureAsset(image).then(value => { result = value; }, error => { result = error; });
  try {
    await flushStartupMicrotasks();
    assert.equal(cachedLookups, 0, 'an absent entry in a partial index must not authorize a second asset');
    assert.equal(h.counters.reads + h.counters.writes, 0);
    assert.equal(result, undefined);
    p.layout();
    await tasks.drain();
    assert.equal(await setup, true);
    await create;
    assert.equal(result?.file, asset);
    assert.equal(h.counters.writes, 0);
  } finally { h.service.dispose(); await tasks.drain(); await setup; await create; tasks.restore(); }
});

test('cold split: identity normalization cannot report success from a partial task inventory', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  const setup = h.service.setup({ afterLayout: true });
  let result;
  const normalization = h.service.normalizeTaskRecordIdentities().then(value => { result = value; }, error => { result = error; });
  try {
    await flushStartupMicrotasks();
    assert.equal(result, undefined, 'a native command joins initial discovery before snapshotting its candidates');
    assert.equal(h.counters.reads + h.counters.writes, 0);
    p.layout();
    await tasks.drain();
    assert.equal(await setup, true);
    await normalization;
    assert.deepEqual(result, { inspected: 1025, updated: 0, skipped: 0 });
  } finally { h.service.dispose(); await tasks.drain(); await setup; await normalization; tasks.restore(); }
});

test('cold split: unload prevents late layout callbacks from doing more discovery or publication', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  const loaded = p.plugin.onload();
  try {
    await flushStartupMicrotasks();
    p.unload();
    const before = { ...h.counters };
    p.layout();
    await tasks.drain();
    await loaded;
    assert.deepEqual(h.counters, before);
    assert.equal(p.relationshipInventories, 0);
    assert.deepEqual(p.publications, []);
    assert.equal(p.availability.at(-1)?.available, false);
  } finally { h.service.dispose(); tasks.restore(); }
});

test('cold split: full-source facade reaches all registrations and exact inventories after layout', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  const loaded = p.plugin.onload();
  try {
    await flushStartupMicrotasks();
    p.layout();
    await tasks.drain();
    await loaded;
    await flushStartupMicrotasks();
    assert.deepEqual(p.publications, [1025]);
    assert.equal(p.availability.at(-1)?.available, true);
    assert.equal(p.registrations.commands, 1);
    assert.ok(p.registrations.editors >= 3);
    assert.equal(p.registrations.markdown, 1);
    assert.ok(p.registrations.dom >= 3);
    assert.equal(p.registrations.settings, 1);
    assert.equal(p.registrations.events, 1);
    assert.equal(p.registrations.interactions, 1);
    assert.equal(h.counters.inventories, 1);
    assert.equal(p.relationshipInventories, 1);
    assert.equal(h.service.recordsByPath.size, 1025);
    assert.equal(h.counters.reads + h.counters.writes, 0);
  } finally { p.unload(); await tasks.drain(); tasks.restore(); }
});

test('cold split: failed owned discovery settles once without publication or an automatic retry', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  let attempts = 0;
  const index = h.service.indexFile.bind(h.service);
  h.service.indexFile = (...args) => {
    if (++attempts === 400) throw new Error('synthetic post-layout inventory failure');
    return index(...args);
  };
  const loaded = p.plugin.onload().catch(() => undefined);
  try {
    await flushStartupMicrotasks();
    p.layout();
    await tasks.drain();
    await loaded;
    await assert.rejects(h.service.setup(), /synthetic post-layout inventory failure/u);
    assert.equal(h.service.setup(), h.service.setupPromise, 'failed owner cannot silently restart');
    assert.deepEqual(p.publications, []);
    assert.equal(p.plugin.api, undefined);
    assert.equal(h.counters.inventories, 1);
    assert.ok(p.relationshipInventories <= 1, 'independent relationship discovery cannot retry on native failure');
    assert.equal(tasks.pending, 0);
    assert.equal(h.counters.reads + h.counters.writes, 0);
  } finally { p.unload(); tasks.restore(); }
});

test('cold split: API publication joins replacement history recovery rather than its superseded startup epoch', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  h.plugin.settings.enableItemHistory = true;
  let entered, release;
  const enteredRecovery = new Promise(resolve => { entered = resolve; });
  class DeferredInvalidationStore extends MemoryItemHistoryStore {
    async clearPending() {
      entered();
      await new Promise(resolve => { release = resolve; });
      return super.clearPending();
    }
  }
  const p = coldStartupHarness(h, { historyStore: new DeferredInvalidationStore() });
  const loaded = p.plugin.onload();
  try {
    await loaded;
    const history = p.plugin.itemHistoryService;
    p.plugin.settings.enableItemHistory = false;
    history.updateEnabled(false);
    p.plugin.settings.enableItemHistory = true;
    history.updateEnabled(true);
    p.layout();
    await tasks.drain();
    await enteredRecovery;
    await flushStartupMicrotasks();
    assert.deepEqual(p.publications, [], 'the captured old epoch cannot publish over newer recovery');
    assert.equal(p.plugin.api, undefined);
    release();
    await history.setup();
    await flushStartupMicrotasks();
    assert.deepEqual(p.publications, [1025]);
    assert.equal(p.availability.at(-1)?.available, true);
  } finally {
    release?.(); await loaded; p.unload(); await tasks.drain(); tasks.restore();
  }
});

test('cold split: regular task creation joins discovery before reserving its requested identity', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  const setup = h.service.setup({ afterLayout: true });
  let result;
  const create = h.service.create('task', { title: 'Early task' }, { id: 'early-task' })
    .then(value => { result = value; }, error => { result = error; });
  try {
    await flushStartupMicrotasks();
    assert.equal(h.service.inFlightCreateIds.size, 0, 'the shared task creation entry must wait before reservation');
    assert.equal(h.counters.reads + h.counters.writes, 0);
    assert.equal(result, undefined);
    p.layout();
    await tasks.drain();
    assert.equal(await setup, true);
    await finishAuthoritativeOperation({ tasks }, observeAuthoritativeOperation(create));
    assert.equal(result?.id, 'early-task');
    assert.equal(h.counters.writes, 1);
  } finally { h.service.dispose(); await tasks.drain(); await setup; await create; tasks.restore(); }
});

test('cold split: selected-path resolution waits before reading or replacing the partial index', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  const selected = h.addFile('selected.md', '---\ntpsId: selected-task\ntpsSchemaVersion: 1\nkind: task\ntitle: Selected\n---\n');
  const setup = h.service.setup({ afterLayout: true });
  let result;
  const resolve = h.service.resolve(selected).then(value => { result = value; }, error => { result = error; });
  try {
    await flushStartupMicrotasks();
    assert.equal(h.counters.reads, 0, 'the readiness check must precede selected-source resolution');
    assert.equal(result, undefined);
    p.layout();
    await tasks.drain();
    assert.equal(await setup, true);
    await resolve;
    assert.equal(result?.id, 'selected-task');
    assert.equal(h.counters.reads, 1);
    assert.equal(h.counters.writes, 0);
  } finally { h.service.dispose(); await tasks.drain(); await setup; await resolve; tasks.restore(); }
});

test('cold split: authoritative snapshot does not start a second source pass before metadata readiness', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  const setup = h.service.setup({ afterLayout: true });
  let result;
  const snapshot = h.service.snapshot().then(value => { result = value; }, error => { result = error; });
  try {
    await flushStartupMicrotasks();
    assert.equal(h.counters.reads, 0, 'metadata discovery and authoritative source verification have separate owners');
    assert.equal(h.counters.inventories, 0);
    assert.equal(result, undefined);
    p.layout();
    await tasks.drain();
    assert.equal(await setup, true);
    await finishAuthoritativeOperation({ tasks }, observeAuthoritativeOperation(snapshot));
    assert.equal(Array.isArray(result?.records), true);
    assert.equal(h.counters.writes, 0);
  } finally { h.service.dispose(); await tasks.drain(); await setup; await snapshot; tasks.restore(); }
});

test('cold split: pre-layout metadata/create/delete/rename/replacement sources survive the first inventory', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  const loaded = p.plugin.onload();
  try {
    await flushStartupMicrotasks();
    const changed = h.vault.getFileByPath('startup-0.md');
    const changedMetadata = { ...h.metadata.get(changed), title: 'Accepted before initial inventory' };
    h.metadata.set(changed, changedMetadata);
    h.plugin.app.metadataCache.emit('changed', changed, '', { frontmatter: changedMetadata });

    const deleted = h.vault.getFileByPath('startup-1000.md');
    h.entries.delete(deleted.path);
    h.vault.emit('delete', deleted);
    h.plugin.app.metadataCache.emit('changed', deleted, '', { frontmatter: h.metadata.get(deleted) });

    const renamed = h.vault.getFileByPath('startup-1001.md');
    const oldPath = renamed.path;
    h.entries.delete(oldPath);
    renamed.path = 'renamed-before-layout.md';
    renamed.refreshIdentity();
    h.entries.set(renamed.path, renamed);
    h.vault.emit('rename', renamed, oldPath);
    const reusedOldPath = h.addFile(oldPath, '');
    h.metadata.set(reusedOldPath, { tpsId: 'reused-before-layout', tpsSchemaVersion: 1, kind: 'task', title: 'Reused old path' });
    h.vault.emit('create', reusedOldPath);

    const oldOwner = h.vault.getFileByPath('startup-1002.md');
    const replacement = h.addFile(oldOwner.path, '');
    h.metadata.set(replacement, { tpsId: 'replacement-before-layout', tpsSchemaVersion: 1, kind: 'task', title: 'Current replacement' });
    h.vault.emit('create', replacement);
    h.vault.emit('delete', oldOwner);
    h.plugin.app.metadataCache.emit('changed', oldOwner, '', { frontmatter: h.metadata.get(oldOwner) });

    const created = h.addFile('created-before-layout.md', '');
    h.metadata.set(created, { tpsId: 'created-before-layout', tpsSchemaVersion: 1, kind: 'task', title: 'Created before layout' });
    h.vault.emit('create', created);
    const beforeLayout = { ...h.counters };
    const source = [...h.entries.values()].filter(file => file instanceof TFile && file.extension === 'md')
      .map(file => ({ file, path: file.path, metadata: structuredClone(h.metadata.get(file)), body: h.contents.get(file) }));

    p.layout();
    await tasks.drain();
    await loaded;
    await flushStartupMicrotasks();
    assert.equal(h.service.recordsByPath.size, source.length);
    for (const item of source) {
      assert.equal(h.service.recordsByPath.get(item.path)?.tpsId, item.metadata.tpsId, item.path);
      assert.equal(h.service.recordsByPath.get(item.path)?.title, item.metadata.title, item.path);
      assert.deepEqual(h.metadata.get(item.file), item.metadata, 'discovery must not change metadata');
      assert.equal(h.contents.get(item.file), item.body, 'discovery must not change source');
    }
    assert.equal(h.service.recordsByPath.has(deleted.path), false);
    assert.equal(h.service.pathsById.has('startup-1002'), false, 'replaced old identity cannot survive');
    for (const file of [renamed, reusedOldPath, replacement, created]) {
      assert.equal(h.service.newlyCreatedFiles.has(file), false, 'pre-layout discovery does not adopt task drafts');
    }
    assert.deepEqual(p.publications, [source.length]);
    assert.equal(h.counters.inventories, 1);
    assert.equal(h.counters.reads + h.counters.writes, 0);
    assert.deepEqual(beforeLayout, { inventories: 0, metadata: 0, reads: 0, writes: 0 });
  } finally { p.unload(); await tasks.drain(); await loaded; tasks.restore(); }
});

test('cold split: pre-layout conflicting identities retain duplicate ownership blocking after discovery', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = coldStartupHarness(h);
  const loaded = p.plugin.onload();
  try {
    await flushStartupMicrotasks();
    const duplicate = h.addFile('duplicate-before-layout.md', '');
    h.metadata.set(duplicate, { tpsId: 'startup-0', tpsSchemaVersion: 1, kind: 'task', title: 'Conflicting new owner' });
    h.vault.emit('create', duplicate);
    const beforeLayout = { ...h.counters };
    p.layout();
    await tasks.drain();
    await loaded;
    assert.deepEqual([...h.service.pathsById.get('startup-0')].sort(), ['duplicate-before-layout.md', 'startup-0.md']);
    assert.equal(h.service.hasUniquePathOwnership('startup-0', 'startup-0.md'), false);
    assert.equal(h.service.hasUniquePathOwnership('startup-0', duplicate.path), false);
    assert.equal(h.service.recordsByPath.size, 1026);
    assert.equal(h.counters.reads + h.counters.writes, 0);
    assert.deepEqual(beforeLayout, { inventories: 0, metadata: 0, reads: 0, writes: 0 });
  } finally { p.unload(); await tasks.drain(); await loaded; tasks.restore(); }
});

test('cold split: a global resolved event before layout records proof without eager relationship discovery', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad('native-records', 2);
  const p = coldStartupHarness(h, { initialized: false });
  const service = new ParentLinkResolutionService(p.plugin);
  p.plugin.parentLinkResolutionService = service;
  p.plugin.filePropertiesService = { isCompanionFile: () => false, isPropertyTarget: () => false };
  try {
    service.setup({ afterLayout: true });
    h.plugin.app.metadataCache.emit('resolved');
    const beforeLayout = { inventories: p.relationshipInventories, metadata: h.counters.metadata };
    p.layout();
    await flushStartupMicrotasks();
    assert.equal(p.relationshipInventories, 1);
    assert.equal(h.counters.metadata, 2);
    assert.deepEqual(beforeLayout, { inventories: 0, metadata: 0 });
  } finally { p.unload(); tasks.restore(); }
});

test('actual onload publishes the native API only after its initial inventory completes', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = startupPublicationHarness(h);
  try {
    const loaded = p.plugin.onload();
    await flushStartupMicrotasks();
    p.layout();
    assertColdStartupContinuationOwners(h, p, tasks);
    assert.equal(p.plugin.api === undefined, true, 'no consumer receives a partly indexed NativeRecords API');
    assert.deepEqual(p.availability, []);
    await tasks.drain();
    await loaded;
    assert.deepEqual(p.publications, [1025]);
    assert.deepEqual(p.availability, [true]);
    assert.equal(h.counters.inventories, 1);
    assert.equal(h.counters.reads + h.counters.writes, 0);
  } finally { p.unload(); tasks.restore(); }
});

test('actual onunload during an initial yield cannot resume onload or republish the API', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = startupPublicationHarness(h);
  try {
    const loaded = p.plugin.onload();
    await flushStartupMicrotasks();
    p.layout();
    assertColdStartupContinuationOwners(h, p, tasks);
    p.unload();
    const atUnload = { ...h.counters };
    await tasks.drain();
    await loaded;
    assert.deepEqual(h.counters, atUnload);
    assert.equal(p.plugin.api === undefined, true);
    assert.deepEqual(p.publications, []);
    assert.deepEqual(p.availability, [false]);
  } finally { h.service.dispose?.(); tasks.restore(); }
});

test('actual onload cannot republish after unloading during the existing daily-configuration await', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  let ready;
  const p = startupPublicationHarness(h, new Promise(resolve => { ready = resolve; }));
  try {
    const loaded = p.plugin.onload();
    await flushStartupMicrotasks();
    p.layout();
    await tasks.drain();
    assert.deepEqual(p.publications, []);
    p.unload();
    ready();
    await loaded;
    assert.equal(p.plugin.api === undefined, true);
    assert.deepEqual(p.publications, []);
    assert.deepEqual(p.availability, [false]);
  } finally { h.service.dispose?.(); tasks.restore(); }
});

test('actual onload unloaded during its first settings await never starts native discovery', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const p = startupPublicationHarness(h);
  let ready;
  p.plugin.loadSettings = () => new Promise(resolve => { ready = resolve; });
  try {
    const loaded = p.plugin.onload();
    await flushStartupMicrotasks();
    assert.deepEqual(h.counters, { inventories: 0, metadata: 0, reads: 0, writes: 0 });
    p.unload();
    ready();
    await loaded;
    assert.deepEqual(h.counters, { inventories: 0, metadata: 0, reads: 0, writes: 0 });
    assert.equal(tasks.pending, 0);
    assert.equal(p.plugin.api === undefined, true);
    assert.deepEqual(p.publications, []);
    assert.deepEqual(p.availability, [false]);
  } finally { h.service.dispose?.(); tasks.restore(); }
});

for (const [mode, route] of [
  ['native-records', 'scheduler'], ['native-records', 'channel'],
  ['native-records', 'timer'], ['legacy', 'scheduler'],
]) test(`initial ${mode} setup yields bounded metadata work through ${route} tasks`, async () => {
  const tasks = manualStartupTasks(route);
  const h = startupLoad(mode);
  try {
    const setup = h.service.setup();
    assert.ok(setup instanceof Promise, 'initial inventory has an explicit awaited owner');
    assert.equal(h.service.setup(), setup, 'concurrent setup calls join the same initial owner');
    assert.equal(tasks.pending, 1, 'a real task, not a resolved promise, separates slices');
    assert.ok(h.counters.metadata > 0 && h.counters.metadata <= 256);
    assert.ok(h.service.recordsByPath.size < 1025, 'startup is not published as complete before its inventory drains');
    let previous = h.counters.metadata;
    while (tasks.pending) {
      await tasks.step();
      assert.ok(h.counters.metadata - previous <= 256, 'every continuation has a file-count bound');
      previous = h.counters.metadata;
    }
    assert.equal(await setup, true);
    assert.deepEqual(h.counters, { inventories: 1, metadata: 1025, reads: 0, writes: 0 });
    assert.equal(h.service.recordsByPath.size, 1025);
    assert.equal(h.service.blockedIdentityEvidencePaths.size, 0);
    for (let i = 0; i < 1025; i++) assert.equal(h.service.recordsByPath.get(`startup-${i}.md`).title, `Task ${i}`);
    if (route === 'channel') assert.ok(tasks.closedPorts >= 2 && tasks.closedPorts % 2 === 0);
    assert.equal(h.service.setup(), setup, 'a completed initial owner is not a second inventory');
  } finally { h.service.dispose?.(); tasks.restore(); }
});

test('initial setup yields at its elapsed-work bound before the file-count limit', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad('native-records', 17);
  const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let elapsed = 0;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => elapsed } });
  const getFileCache = h.plugin.app.metadataCache.getFileCache;
  h.plugin.app.metadataCache.getFileCache = file => { elapsed += 2; return getFileCache(file); };
  try {
    const setup = h.service.setup();
    assert.equal(tasks.pending, 1);
    assert.equal(h.counters.metadata, 4, 'the 8 ms branch yields after four controlled 2 ms metadata steps');
    let previous = h.counters.metadata;
    while (tasks.pending) {
      await tasks.step();
      assert.ok(h.counters.metadata - previous <= 4, 'each real continuation uses the elapsed-work bound again');
      previous = h.counters.metadata;
    }
    assert.equal(await setup, true);
    assert.deepEqual(h.counters, { inventories: 1, metadata: 17, reads: 0, writes: 0 });
    assert.equal(h.service.recordsByPath.size, 17);
  } finally {
    h.service.dispose?.();
    Object.defineProperty(globalThis, 'performance', originalPerformance);
    tasks.restore();
  }
});

test('initial setup listeners preserve newer sources before and after a queued file is visited', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  try {
    const setup = h.service.setup();
    assert.equal(tasks.pending, 1);
    const visited = h.entries.get('startup-0.md');
    const queued = h.entries.get('startup-1024.md');
    for (const file of [visited, queued]) {
      h.plugin.app.metadataCache.emit('changed', file, '', { frontmatter: {
        tpsId: h.metadata.get(file).tpsId, tpsSchemaVersion: 1, kind: 'task', title: 'Current source', status: 'complete',
      } });
      assert.equal(h.service.recordsByPath.get(file.path)?.title, 'Current source', 'listeners precede the first yield');
    }
    await tasks.drain();
    assert.equal(await setup, true);
    for (const file of [visited, queued]) {
      assert.equal(h.service.recordsByPath.get(file.path)?.title, 'Current source', 'old queued MetadataCache cannot overwrite a newer accepted event');
      assert.equal(h.service.recordsByPath.get(file.path)?.status, 'complete');
      assert.equal(h.service.authoritativeIndexDirtyPaths.has(file.path), true, 'metadata-only discovery cannot clear dirty source ownership');
    }
    assert.equal(h.counters.inventories, 1);
    assert.equal(h.counters.reads + h.counters.writes, 0);
  } finally { h.service.dispose?.(); tasks.restore(); }
});

test('initial setup cannot resurrect deleted, renamed or replaced queued file objects', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  try {
    const setup = h.service.setup();
    assert.equal(tasks.pending, 1);
    const deleted = h.entries.get('startup-1020.md');
    h.entries.delete(deleted.path);
    h.vault.emit('delete', deleted);
    const renamed = h.entries.get('startup-1021.md');
    await h.vault.rename(renamed, 'renamed-startup.md');
    const obsolete = h.entries.get('startup-1022.md');
    const replacement = h.addFile(obsolete.path, '');
    h.metadata.set(replacement, { tpsId: 'replacement', tpsSchemaVersion: 1, kind: 'task', title: 'Replacement' });
    h.plugin.app.metadataCache.emit('changed', replacement, '', { frontmatter: h.metadata.get(replacement) });
    h.plugin.app.metadataCache.emit('changed', obsolete, '', { frontmatter: h.metadata.get(obsolete) });
    h.vault.emit('delete', obsolete);
    const created = h.addFile('created-during-startup.md', '');
    h.metadata.set(created, { tpsId: 'created', tpsSchemaVersion: 1, kind: 'task', title: 'Created' });
    h.vault.emit('create', created);
    await tasks.drain();
    assert.equal(await setup, true);
    assert.equal(h.service.recordsByPath.has(deleted.path), false);
    assert.equal(h.service.recordsByPath.has('startup-1021.md'), false);
    assert.equal(h.service.recordsByPath.get(renamed.path)?.title, 'Task 1021');
    assert.equal(h.service.recordsByPath.get(replacement.path)?.tpsId, 'replacement');
    assert.equal(h.service.recordsByPath.get(created.path)?.title, 'Created');
    assert.equal(h.service.pathsById.has('startup-1020'), false);
    assert.equal(h.service.pathsById.has('startup-1022'), false);
    assert.equal(h.counters.inventories, 1);
    assert.equal(h.counters.reads, 0, 'a known cached rename retains the existing no-body-read route');
  } finally { h.service.dispose?.(); tasks.restore(); }
});

for (const cache of ['cached', 'cold']) test(`a current ${cache} renamed target is indexed without removing a reused old path`, async () => {
  const h = createHarness('native-records', { deferSetup: true });
  let replacement;
  h.vault.on('rename', (_file, oldPath) => {
    if (cache === 'cold') h.metadata.delete(_file);
    replacement = h.addFile(oldPath, '');
    h.metadata.set(replacement, { tpsId: 'old-path-replacement', tpsSchemaVersion: 1, kind: 'task', title: 'Old path replacement' });
    h.plugin.app.metadataCache.emit('changed', replacement, '', { frontmatter: h.metadata.get(replacement) });
  });
  assert.equal(await h.service.setup(), true);
  const file = h.addFile('original-before-rename.md', serializeNativeRecordDocument({ bom: '', newline: '\n', closer: '---', body: '', frontmatter: {
    tpsId: 'renamed-current', tpsSchemaVersion: 1, kind: 'task', title: 'Current renamed target',
  } }));
  h.vault.emit('create', file);
  assert.equal(h.service.recordsByPath.get(file.path)?.tpsId, 'renamed-current');
  await h.vault.rename(file, 'current-renamed-target.md');
  await flushStartupMicrotasks();
  assert.equal(h.entries.get('original-before-rename.md'), replacement);
  assert.equal(h.service.recordsByPath.get(replacement.path)?.tpsId, 'old-path-replacement');
  assert.equal(h.service.recordsByPath.get(file.path)?.tpsId, 'renamed-current', 'a live old-path replacement does not suppress a legitimate current target');
  assert.deepEqual([...h.service.pathsById.get('renamed-current')], [file.path]);
  assert.deepEqual([...h.service.pathsById.get('old-path-replacement')], [replacement.path]);
  h.service.dispose();
});

for (const race of ['delete', 'replacement', 'metadata', 'post-startup-metadata', 'invalid-metadata', 'removed-identity', 'modify', 'rebuild', 'dispose']) {
  test(`a deferred startup rename read cannot replace newer ${race} ownership`, async () => {
    const tasks = manualStartupTasks();
    const h = startupLoad();
    let finishRead, rename;
    const originalRename = h.service.handleRecordRename.bind(h.service);
    h.service.handleRecordRename = (...args) => rename = originalRename(...args);
    try {
      const setup = h.service.setup();
      assert.equal(tasks.pending, 1);
      const file = h.entries.get('startup-1024.md');
      const originalPath = file.path;
      const source = serializeNativeRecordDocument({ bom: '', newline: '\n', closer: '---', body: 'Original body', frontmatter: h.metadata.get(file) });
      h.metadata.delete(file);
      h.vault.cachedRead = () => { h.counters.reads++; return new Promise(resolve => { finishRead = resolve; }); };
      await h.vault.rename(file, 'deferred-startup-rename.md');
      assert.equal(typeof finishRead, 'function', 'the actual rename listener has reached its source-read await');
      assert.equal(h.service.pendingRenameReads.has(file), true);
      assert.equal(h.service.recordsByPath.has(originalPath), false);
      const current = { tpsId: 'current-rename', tpsSchemaVersion: 1, kind: 'task', title: 'Current source', status: 'complete' };
      if (race === 'delete') {
        h.entries.delete(file.path);
        h.vault.emit('delete', file);
      } else if (race === 'replacement') {
        const replacement = h.addFile(file.path, '');
        h.plugin.app.metadataCache.emit('changed', replacement, '', { frontmatter: current });
      } else if (race === 'metadata' || race === 'post-startup-metadata') {
        if (race === 'post-startup-metadata') {
          await tasks.drain();
          assert.equal(await setup, true);
        }
        h.plugin.app.metadataCache.emit('changed', file, '', { frontmatter: current });
      } else if (race === 'invalid-metadata') {
        h.plugin.app.metadataCache.emit('changed', file, '', { frontmatter: { ...current, TPSID: 'conflicting-id' } });
        assert.equal(h.service.blockedIdentityEvidencePaths.has(file.path), true);
      } else if (race === 'removed-identity') {
        h.plugin.app.metadataCache.emit('changed', file, '', { frontmatter: { title: 'No longer a native record' } });
      } else if (race === 'modify') {
        h.vault.emit('modify', file);
      } else if (race === 'rebuild') {
        h.metadata.set(file, current);
        h.service.refreshConfiguration();
      } else h.service.dispose();
      const atChange = { ...h.counters };
      finishRead(source);
      await rename;
      assert.equal(h.counters.metadata, atChange.metadata, 'an obsolete read does not re-inspect MetadataCache');
      if (race === 'replacement' || race === 'metadata' || race === 'post-startup-metadata' || race === 'rebuild') {
        assert.equal(h.service.recordsByPath.get(file.path)?.tpsId, current.tpsId);
        assert.equal(h.service.recordsByPath.get(file.path)?.status, 'complete');
      } else assert.equal(h.service.recordsByPath.has(file.path), false, 'an obsolete read cannot revive a deleted, blocked or disposed record');
      if (race === 'invalid-metadata') assert.equal(h.service.blockedIdentityEvidencePaths.has(file.path), true);
      assert.equal(h.service.pendingRenameReads.has(file), false, 'settled reads retain no ownership token');
      await tasks.drain();
      assert.equal(await setup, race !== 'dispose');
      assert.equal(h.service.pathsById.has('startup-1024'), false);
      assert.equal(h.service.authoritativeIndexDirtyPaths.has(file.path), true);
      assert.equal(h.counters.inventories, race === 'rebuild' ? 2 : 1);
      assert.equal(h.counters.reads, 1, 'only the already-started selected source is read');
      assert.equal(h.counters.writes, 1, 'only the synthetic user rename writes; discovery never does');
    } finally { h.service.dispose?.(); tasks.restore(); }
  });
}

test('a superseded rename read cannot clear a later rename read owner', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  const reads = [], renames = [];
  const originalRename = h.service.handleRecordRename.bind(h.service);
  h.service.handleRecordRename = (...args) => {
    const pending = originalRename(...args);
    renames.push(pending);
    return pending;
  };
  try {
    const setup = h.service.setup();
    const file = h.entries.get('startup-1024.md');
    const originalSource = serializeNativeRecordDocument({ bom: '', newline: '\n', closer: '---', body: '', frontmatter: h.metadata.get(file) });
    h.metadata.delete(file);
    h.vault.cachedRead = () => { h.counters.reads++; return new Promise(resolve => reads.push(resolve)); };
    await h.vault.rename(file, 'first-deferred-rename.md');
    await h.vault.rename(file, 'second-deferred-rename.md');
    assert.equal(reads.length, 2);
    reads[0](originalSource);
    await renames[0];
    assert.equal(h.service.recordsByPath.has(file.path), false);
    assert.equal(h.service.pendingRenameReads.has(file), true, 'the old finally cannot clear the newer read owner');
    reads[1](serializeNativeRecordDocument({ bom: '', newline: '\n', closer: '---', body: '', frontmatter: {
      tpsId: 'current-second-rename', tpsSchemaVersion: 1, kind: 'task', title: 'Second renamed current source', status: 'complete',
    } }));
    await renames[1];
    assert.equal(h.service.recordsByPath.get(file.path)?.tpsId, 'current-second-rename');
    assert.equal(h.service.recordsByPath.get(file.path)?.status, 'complete');
    assert.equal(h.service.pendingRenameReads.has(file), false);
    await tasks.drain();
    assert.equal(await setup, true);
    assert.equal(h.service.recordsByPath.has('first-deferred-rename.md'), false);
    assert.equal(h.service.pathsById.has('startup-1024'), false);
    assert.equal(h.counters.inventories, 1);
    assert.equal(h.counters.reads, 2);
    assert.equal(h.counters.writes, 2);
  } finally { h.service.dispose?.(); tasks.restore(); }
});

test('dispose cancels initial setup and all later callbacks without claiming completion', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  try {
    const setup = h.service.setup();
    assert.equal(tasks.pending, 1);
    h.service.dispose();
    const atDispose = { ...h.counters };
    const before = [...h.service.recordsByPath];
    await tasks.drain();
    assert.equal(await setup, false);
    const first = h.entries.get('startup-0.md');
    h.plugin.app.metadataCache.emit('changed', first, '', { frontmatter: { ...h.metadata.get(first), title: 'After unload' } });
    h.vault.emit('create', first);
    h.vault.emit('modify', first);
    h.vault.emit('delete', first);
    h.vault.emit('rename', first, 'old.md');
    assert.deepEqual(h.counters, atDispose);
    assert.deepEqual([...h.service.recordsByPath], before);
    assert.equal(h.counters.reads + h.counters.writes, 0);
  } finally { h.service.dispose?.(); tasks.restore(); }
});

test('explicit synchronous configuration rebuild supersedes a paused initial setup', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  try {
    const setup = h.service.setup();
    assert.equal(tasks.pending, 1);
    const last = h.entries.get('startup-1024.md');
    h.metadata.set(last, { ...h.metadata.get(last), title: 'Configured current' });
    assert.equal(h.service.refreshConfiguration(), undefined, 'the explicit rebuild contract stays synchronous');
    assert.equal(h.service.recordsByPath.size, 1025);
    assert.equal(h.service.recordsByPath.get(last.path)?.title, 'Configured current');
    const afterRebuild = { ...h.counters };
    await tasks.drain();
    assert.equal(await setup, true, 'the complete synchronous replacement satisfies initial readiness');
    assert.deepEqual(h.counters, afterRebuild, 'the superseded startup continuation does no more indexing');
    assert.equal(h.counters.inventories, 2);
    assert.equal(h.counters.reads + h.counters.writes, 0);
  } finally { h.service.dispose?.(); tasks.restore(); }
});

test('initial setup reads nested in-place mappings again after a task boundary', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  try {
    h.plugin.settings.nativeRecordKindPropertyKeys = {
      task: { primary: { kindList: { key: 'Type', value: 'Records/task' } } },
    };
    const first = h.entries.get('startup-0.md');
    const last = h.entries.get('startup-1024.md');
    const firstSource = { tpsId: 'startup-0', tpsSchemaVersion: 1, Type: ['Records/task'], title: 'First mapped' };
    const lastSource = { tpsId: 'startup-1024', tpsSchemaVersion: 1, Type: ['Records/current'], title: 'Current mapped' };
    const original = structuredClone([firstSource, lastSource]);
    h.metadata.set(first, firstSource);
    h.metadata.set(last, lastSource);
    const setup = h.service.setup();
    assert.equal(tasks.pending, 1);
    assert.equal(h.service.recordsByPath.get(first.path)?.kind, 'task');
    h.plugin.settings.nativeRecordKindPropertyKeys.task.primary.kindList.value = 'Records/current';
    await tasks.drain();
    assert.equal(await setup, true);
    assert.equal(h.service.recordsByPath.get(first.path)?.title, 'First mapped', 'the accepted earlier file remains its own snapshot');
    assert.equal(h.service.recordsByPath.get(last.path)?.kind, 'task', 'the next file checks current nested settings without requiring a save');
    assert.equal(h.service.recordsByPath.get(last.path)?.title, 'Current mapped');
    assert.deepEqual([firstSource, lastSource], original);
    assert.deepEqual(h.counters, { inventories: 1, metadata: 1025, reads: 0, writes: 0 });
  } finally { h.service.dispose?.(); tasks.restore(); }
});

test('a failed synchronous replacement rejects initial readiness and stops its old continuation', async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  try {
    const setup = h.service.setup();
    assert.equal(tasks.pending, 1);
    const error = new Error('Synthetic explicit replacement failure');
    const rejected = assert.rejects(setup, error);
    h.service.getInspectionProfiles = () => { throw error; };
    assert.throws(() => h.service.refreshConfiguration(), error, 'explicit callers retain synchronous errors');
    await rejected;
    const atFailure = { ...h.counters };
    await tasks.drain();
    assert.deepEqual(h.counters, atFailure, 'an obsolete initial owner cannot restart after replacement failure');
    assert.equal(h.service.initialDiscovery, null);
    assert.equal(h.service.setup(), setup, 'failure does not silently create another startup');
    assert.equal(tasks.pending, 0);
    assert.equal(h.counters.inventories, 2);
    assert.equal(h.counters.reads + h.counters.writes, 0);
  } finally { h.service.dispose?.(); tasks.restore(); }
});

for (const failure of ['inspection', 'scheduler']) test(`initial ${failure} failure rejects its owner and schedules no automatic retry`, async () => {
  const tasks = manualStartupTasks();
  const h = startupLoad();
  try {
    const setup = h.service.setup();
    assert.equal(tasks.pending, 1);
    const error = new Error(`Synthetic startup ${failure} error`);
    const rejected = assert.rejects(setup, error);
    if (failure === 'inspection') h.service.getInspectionProfiles = () => { throw error; };
    else globalThis.scheduler.yield = () => Promise.reject(error);
    await tasks.step();
    await rejected;
    const atFailure = { ...h.counters };
    await tasks.drain();
    assert.deepEqual(h.counters, atFailure);
    assert.equal(tasks.pending, 0);
    assert.equal(h.counters.inventories, 1);
    assert.equal(h.counters.reads + h.counters.writes, 0);
    h.plugin.app.metadataCache.emit('resolved');
    assert.deepEqual(h.service.indexedSnapshot(), { ready: false, records: [] }, 'later metadata cannot publish a partially failed discovery');
  } finally { h.service.dispose?.(); tasks.restore(); }
});

for (const variant of ['ordinary', 'canonical', 'mapped-26']) {
  test(`cold setup shares one per-file inspection across 10000 ${variant} metadata notes`, async () => {
    const h = createHarness('native-records', { deferSetup: true });
    h.plugin.settings.nativeRecordKindPropertyKeys = variant === 'mapped-26'
      ? Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`perf-${i}`, {
        key: 'entityKind', parentKind: 'entity', value: `type-${i}`,
      }]))
      : {};
    const sources = [];
    for (let i = 0; i < 10000; i++) {
      const file = h.addFile(`cold-${i}.md`, '');
      const raw = variant === 'ordinary' ? { title: `Ordinary ${i}`, tags: ['notes'] }
        : variant === 'canonical' ? { tpsId: `cold-${i}`, kind: 'task', title: `Task ${i}` }
        : { tpsId: `cold-${i}`, kind: 'entity', entityKind: 'type-0', title: `Entity ${i}` };
      h.metadata.set(file, raw);
      sources.push(raw);
    }
    const before = structuredClone(sources);
    const counters = { inventories: 0, metadata: 0, reads: 0, writes: 0, profileAccesses: 0, configurations: 0, evaluations: 0, copies: 0 };
    let slices = 1;
    const yieldSlice = h.service.yieldInitialDiscovery.bind(h.service);
    h.service.yieldInitialDiscovery = async () => { slices++; await yieldSlice(); };
    const perSource = new Map();
    for (const [host, name, key] of [
      [h.vault, 'getMarkdownFiles', 'inventories'],
      [h.plugin.app.metadataCache, 'getFileCache', 'metadata'],
      [h.vault, 'read', 'reads'], [h.vault, 'cachedRead', 'reads'],
      [h.vault, 'create', 'writes'], [h.vault, 'process', 'writes'], [h.vault, 'rename', 'writes'],
      [h.service, 'getInspectionProfiles', 'profileAccesses'],
      [h.service, 'getStorageConfiguration', 'configurations'],
    ]) {
      const original = host[name];
      host[name] = function (...args) { counters[key]++; return original.apply(this, args); };
    }
    globalThis.__nativeRecordProfileInspection = (raw, profile) => {
      counters.evaluations++;
      const profiles = perSource.get(raw) || new Map();
      profiles.set(profile, (profiles.get(profile) || 0) + 1);
      perSource.set(raw, profiles);
    };
    globalThis.__nativeRecordEnvelopeCopy = () => { counters.copies++; };
    try { assert.equal(await h.service.setup(), true); } finally {
      delete globalThis.__nativeRecordProfileInspection;
      delete globalThis.__nativeRecordEnvelopeCopy;
    }
    assert.equal(counters.inventories, 1);
    assert.equal(counters.metadata, sources.length);
    assert.equal(counters.reads, 0, 'cold metadata indexing is not authoritative body verification');
    assert.equal(counters.writes, 0);
    assert.equal(counters.configurations, 1, 'the existing configuration cache stays generation-scoped');
    assert.equal(counters.profileAccesses, slices, 'one current settings signature per synchronous slice');
    assert.ok(slices < sources.length, 'slice preparation avoids per-file configuration serialization');
    assert.equal(counters.evaluations, sources.length * (variant === 'mapped-26' ? 27 : 3));
    assert.equal([...perSource.values()].every(profiles => [...profiles.values()].every(count => count === 1)), true,
      'every exact prepared profile, including a no-match, is evaluated once per file');
    assert.equal(counters.copies, sources.length * (variant === 'ordinary' ? 0 : variant === 'canonical' ? 1 : 2));
    assert.equal(h.service.recordsByPath.size, variant === 'ordinary' ? 0 : sources.length);
    assert.equal(h.service.blockedIdentityEvidencePaths.size, 0);
    for (let i = 0; i < sources.length; i++) {
      const indexed = h.service.recordsByPath.get(`cold-${i}.md`);
      if (variant === 'ordinary') assert.equal(indexed, undefined);
      else {
        assert.equal(indexed.tpsId, sources[i].tpsId);
        assert.equal(indexed.title, sources[i].title);
        assert.equal(indexed.kind, variant === 'canonical' ? 'task' : 'perf-0');
      }
    }
    assert.deepEqual(sources, before);
  });
}

test('cold setup rechecks in-place mappings between yielded slices and each later metadata event', async () => {
  const h = createHarness('native-records', { deferSetup: true });
  h.plugin.settings.nativeRecordKindPropertyKeys = { task: { tag: 'records/old' } };
  const first = h.addFile('first.md', '');
  for (let i = 0; i < 255; i++) h.addFile(`between-${i}.md`, '');
  const second = h.addFile('second.md', '');
  h.metadata.set(first, { tpsId: 'first', title: 'First', tags: ['records/old'], status: 'open' });
  h.metadata.set(second, { tpsId: 'second', title: 'Second', tags: ['records/new'], status: 'open' });
  const yieldSlice = h.service.yieldInitialDiscovery.bind(h.service);
  h.service.yieldInitialDiscovery = async () => {
    h.plugin.settings.nativeRecordKindPropertyKeys.task.tag = 'records/new';
    await yieldSlice();
  };
  assert.equal(await h.service.setup(), true);
  assert.equal(h.service.recordsByPath.get(first.path)?.kind, 'task');
  assert.equal(h.service.recordsByPath.get(second.path)?.kind, 'task');
  h.plugin.settings.nativeRecordKindPropertyKeys.task.tag = 'records/final';
  const completed = { tpsId: 'first', title: 'Changed', tags: ['records/final'], status: 'complete' };
  h.plugin.app.metadataCache.emit('changed', first, '', { frontmatter: completed });
  assert.equal(h.service.recordsByPath.get(first.path)?.title, 'Changed');
  assert.equal(h.service.recordsByPath.get(first.path)?.status, 'complete');
  h.plugin.app.metadataCache.emit('changed', first, '', { frontmatter: { title: 'No longer a record' } });
  assert.equal(h.service.recordsByPath.has(first.path), false);
  assert.equal(h.service.blockedIdentityEvidencePaths.has(first.path), false);
});

test('profile inspection reuse rejects 1000 ordinary notes without repeated no-match evaluations', () => {
  const { service } = createHarness();
  let evaluations = 0;
  for (let i = 0; i < 1000; i++) {
    const measurement = countedRecordInspection(service, { title: `Ordinary ${i}`, tags: ['notes'] });
    assert.equal(measurement.result, null);
    assertSingleProfileEvaluation(measurement, 3, 0);
    evaluations += [...measurement.calls.values()].reduce((sum, count) => sum + count, 0);
  }
  assert.equal(evaluations, 3000, 'burst work scales with profiles, not repeated validation passes');
});

for (const mapped of [false, true]) {
  test(`prepared profile references avoid duplicate classification in 10000 ${mapped ? 'mapped' : 'canonical'} title inspections`, () => {
    const { service, plugin } = createHarness();
    const kinds = ['task', 'food-entry', 'activity-entry', 'workout-session', 'workout-exercise', 'food', 'exercise', 'recipe', 'workout-plan', 'workflow', 'time-entry', 'asset'];
    if (mapped) {
      plugin.settings.nativeRecordKindPropertyKeys = Object.fromEntries(kinds.map(kind => [kind, {
        primary: { kindList: { key: 'Type', value: `Records/${kind}` } },
        aliases: [{ scalar: { key: 'LegacyType', value: kind } }],
      }]));
    }
    const notes = Array.from({ length: 10000 }, (_, index) => ({
      tpsId: `title-inspection-${index}`,
      title: `Note ${String(10000 - index).padStart(5, '0')}`,
      ...(mapped ? { Type: ['Records/task'] } : { kind: 'task' }),
    }));
    const original = structuredClone(notes);
    let evaluations = 0;
    let copies = 0;
    globalThis.__nativeRecordProfileInspection = () => { evaluations++; };
    globalThis.__nativeRecordEnvelopeCopy = () => { copies++; };
    try {
      let firstTitles;
      // A body-only metadata invalidation may ask for the same live titles again.
      // Reuse belongs inside each inspection, never across notes or passes.
      for (let pass = 0; pass < 2; pass++) {
        evaluations = 0;
        copies = 0;
        const titles = notes.map(note => {
          const inspection = service.inspect(note);
          assert.equal(inspection?.id, note.tpsId);
          assert.equal(inspection?.kind, 'task');
          assert.equal(inspection?.frontmatter.title, note.title);
          return inspection.frontmatter.title;
        });
        assert.equal(evaluations, notes.length * (mapped ? 25 : 3),
          'evidence, readable and current passes must share the prepared profiles');
        assert.equal(copies, notes.length, 'one matching profile needs one envelope copy per note');
        if (pass === 0) firstTitles = titles;
        else assert.deepEqual(titles, firstTitles);
      }
    } finally {
      delete globalThis.__nativeRecordProfileInspection;
      delete globalThis.__nativeRecordEnvelopeCopy;
    }
    assert.deepEqual(notes, original);
  });
}

test('prepared profile references preserve normalized aliases, key order and detached public profiles', () => {
  const classification = { kindList: { key: 'Type', value: 'Records/task' }, recordKind: 'task' };
  const alias = { ...DEFAULT_NATIVE_RECORD_STORAGE_PROFILE, kindPropertyKey: '', classification };
  const reorderedAlias = Object.fromEntries(Object.entries(alias).reverse());
  const { service, plugin } = createHarness('native-records', {
    identityPropertyKey: ' recordId ', schemaPropertyKey: ' recordSchema ',
    kindPropertyKey: ' recordKind ', titlePropertyKey: ' name ',
    createdPropertyKey: ' created ', modifiedPropertyKey: ' modified ',
    storageAliases: [alias, reorderedAlias],
  });
  plugin.settings.nativeRecordKindPropertyKeys = { task: { kindList: { key: 'Type', value: 'Records/task' } } };
  service.readingMigrationSources = true;
  const readable = service.getReadableStorageProfiles();
  const mapped = readable.filter(profile => profile.classification?.recordKind === 'task');
  assert.equal(mapped.length, 1, 'a reordered normalized alias must not duplicate its current classification');
  assert.deepEqual(mapped[0].classification, { kindList: { key: 'Type', value: 'Records/task' }, recordKind: 'task' });
  const legacy = readable.find(profile => profile.identityPropertyKey === 'recordId');
  assert.equal(legacy.schemaPropertyKey, 'recordSchema');
  assert.equal(legacy.kindPropertyKey, 'recordKind');
  assert.equal(legacy.titlePropertyKey, 'name');
  const raw = { RECORDID: 'legacy-task', RecordSchema: 1, RecordKind: 'task', NAME: 'Legacy title', created: '2026-10-01' };
  assert.equal(service.inspect(raw)?.frontmatter.title, 'Legacy title');
  mapped[0].classification.kindList.value = 'Poisoned/mapping';
  legacy.titlePropertyKey = 'poisoned';
  assert.equal(service.inspect(raw)?.frontmatter.title, 'Legacy title');
  const current = { tpsId: 'current-task', title: 'Current title', Type: ['Records/task'] };
  const inspection = service.inspect(current);
  assert.equal(inspection?.kind, 'task');
  inspection.profile.classification.kindList.value = 'Poisoned/result';
  assert.equal(service.inspect(current)?.kind, 'task');
  service.readingMigrationSources = false;
  assert.equal(service.inspect(raw), null, 'legacy aliases remain migration-only');
  assert.equal(service.inspect(current)?.kind, 'task');
});

test('prepared profile references recheck live title, status, list shape, conflicts and in-place mapping edits', () => {
  const { service, plugin } = createHarness();
  plugin.settings.nativeRecordKindPropertyKeys = {
    task: {
      primary: { kindList: { key: 'Type', value: 'Records/task' } },
      aliases: [{ scalar: { key: 'Type', value: 'legacy-task' } }],
    },
    food: { kindList: { key: 'Type', value: 'Records/food' } },
  };
  const raw = { tpsId: 'live-task', title: 'Before', status: 'open', Type: ['Records/task'] };
  const first = service.inspect(raw);
  raw.title = 'After';
  raw.status = 'complete';
  const changed = service.inspect(raw);
  assert.equal(changed?.frontmatter.title, 'After');
  assert.equal(changed?.frontmatter.status, 'complete');
  assert.equal(first?.frontmatter.title, 'Before');
  assert.equal(first?.frontmatter.status, 'open');
  raw.Type = 'Records/task';
  assert.equal(service.inspect(raw), null, 'a primary list path does not accept the same scalar text');
  raw.Type = 'legacy-task';
  assert.equal(service.inspect(raw)?.kind, 'task');
  plugin.settings.nativeRecordKindPropertyKeys.task.aliases[0].scalar.value = 'older-task';
  assert.equal(service.inspect(raw), null, 'nested alias edits take effect without a settings save');
  raw.Type = 'older-task';
  assert.equal(service.inspect(raw)?.kind, 'task');
  plugin.settings.nativeRecordKindPropertyKeys.task.primary.kindList.value = 'Records/action';
  raw.Type = ['Records/task'];
  assert.equal(service.inspect(raw), null);
  raw.Type = ['Records/action'];
  assert.equal(service.inspect(raw)?.kind, 'task');
  raw.Type.push('Records/food');
  assert.equal(service.inspect(raw), null, 'conflicting classifications remain invalid');
  raw.Type = ['Records/action'];
  raw.TPSID = 'conflicting-id';
  assert.equal(service.inspect(raw), null, 'case-duplicate identity remains invalid');
  delete raw.TPSID;
  raw.TYPE = ['Records/action'];
  assert.throws(() => service.inspect(raw), /Ambiguous frontmatter property/);
  delete raw.TYPE;
  assert.equal(service.inspect(raw)?.kind, 'task');
});

test('profile inspection reuse covers native kinds and arbitrary nested tag mappings', () => {
  const kinds = ['task', 'food-entry', 'activity-entry', 'workout-session', 'workout-exercise', 'calendar-event', 'nutrition-log'];
  const { service, plugin } = createHarness();
  for (const kind of kinds) {
    const measurement = countedRecordInspection(service, { tpsId: `fixture-${kind}`, kind, title: 'Fixture' });
    assert.equal(measurement.result?.kind, kind);
    // Readable profiles retain their prepared evidence/current identity instead
    // of requiring a second classification and envelope for normalized clones.
    assertSingleProfileEvaluation(measurement, 3, 1);
  }
  plugin.settings.nativeRecordKindPropertyKeys = Object.fromEntries(kinds.map(kind => [kind, { tag: `custom/${kind}` }]));
  const ordinary = countedRecordInspection(service, { title: 'Ordinary', tags: ['notes'] });
  assert.equal(ordinary.result, null);
  assertSingleProfileEvaluation(ordinary, 10, 0);
  for (const kind of kinds) {
    const measurement = countedRecordInspection(service, { tpsId: `fixture-${kind}`, title: 'Fixture', tags: [`custom/${kind}`] });
    assert.equal(measurement.result?.kind, kind);
    assertSingleProfileEvaluation(measurement, 8, 1);
  }
  const calendar = countedRecordInspection(service, {
    tpsId: 'calendar:v1:abcdefghijklmnop:abcdefghijklmnopqrstuvwxyz2', title: 'Calendar', tags: ['unrelated'],
  });
  assert.equal(calendar.result?.kind, 'calendar-event');
  assertSingleProfileEvaluation(calendar, 10, 1);
});

test('profile inspection reuse preserves current custom keys, pair mappings and legacy migration readers', () => {
  const current = createHarness('native-records', { kindPropertyKey: 'recordType', titlePropertyKey: 'name' });
  const mapped = countedRecordInspection(current.service, { tpsId: 'current-food', recordType: 'food-entry', name: 'Food' });
  assert.equal(mapped.result?.kind, 'food-entry');
  assertSingleProfileEvaluation(mapped, 3, 1);
  const pair = createHarness();
  pair.plugin.settings.nativeRecordKindPropertyKeys = { 'food-entry': { key: 'entryType', parentKind: 'transaction', value: 'food' } };
  const paired = countedRecordInspection(pair.service, { tpsId: 'food', title: 'Food', kind: 'transaction', entryType: 'food' });
  assert.equal(paired.result?.kind, 'food-entry');
  assertSingleProfileEvaluation(paired, 2, 2);
  const legacy = createHarness('native-records', {
    identityPropertyKey: 'recordId', schemaPropertyKey: 'recordSchema', kindPropertyKey: 'recordType',
    titlePropertyKey: 'name', createdPropertyKey: 'created', modifiedPropertyKey: 'updated',
  });
  const raw = { recordId: 'legacy-food', recordSchema: 1, recordType: 'food-entry', name: 'Food', created: '2026-09-27', updated: '2026-09-27' };
  assert.equal(legacy.service.inspect(raw), null, 'legacy storage remains migration-only');
  legacy.service.readingMigrationSources = true;
  const migrated = countedRecordInspection(legacy.service, raw);
  assert.equal(migrated.result?.id, 'legacy-food');
  assertSingleProfileEvaluation(migrated, 4, 1);
  legacy.service.readingMigrationSources = false;
  assert.equal(legacy.service.inspect(raw), null);
});

test('profile inspection reuse keeps equivalent distinct profiles separate and repeated objects shared', () => {
  const { service } = createHarness();
  const profiles = service.getInspectionProfiles();
  const equivalent = { ...profiles.write };
  profiles.evidence.push(equivalent, equivalent);
  profiles.readable.push(equivalent, equivalent);
  const measurement = countedRecordInspection(service, { tpsId: 'duplicate-profiles', kind: 'task', title: 'Task' });
  assert.equal(measurement.result?.id, 'duplicate-profiles');
  assert.equal(measurement.calls.get(equivalent), 1);
  assert.equal(measurement.calls.get(profiles.write), 1);
  assertSingleProfileEvaluation(measurement, 4, 2);
});

test('profile inspection reuse does not survive input edits, mapping edits or returned-value mutation', () => {
  const { service, plugin } = createHarness();
  plugin.settings.nativeRecordKindPropertyKeys = { 'food-entry': { tag: 'logs/food' } };
  const raw = { tpsId: 'food-one', title: 'Before', tags: ['logs/food'] };
  const before = structuredClone(raw);
  const first = countedRecordInspection(service, raw);
  assert.equal(first.result?.kind, 'food-entry');
  assert.deepEqual(raw, before);
  first.result.frontmatter.title = 'Caller copy';
  first.result.profile.classification.tag = 'poisoned';
  raw.title = 'Edited';
  raw.tpsId = 'food-two';
  const second = countedRecordInspection(service, raw);
  assert.equal(second.result?.id, 'food-two');
  assert.equal(second.result?.frontmatter.title, 'Edited');
  assert.equal(second.result?.profile.classification.tag, 'logs/food');
  assert.notEqual(first.result.frontmatter, second.result.frontmatter);
  const other = countedRecordInspection(service, { ...raw, tpsId: 'other-food', title: 'Other source' });
  assert.equal(other.result?.id, 'other-food');
  assert.equal(other.result?.frontmatter.title, 'Other source');
  delete raw.tpsId;
  assert.equal(countedRecordInspection(service, raw).result, null);
  raw.tpsId = 'food-two';
  assert.equal(countedRecordInspection(service, raw).result?.id, 'food-two');
  plugin.settings.nativeRecordKindPropertyKeys['food-entry'].tag = 'logs/nutrition';
  assert.equal(countedRecordInspection(service, raw).result, null);
  raw.tags = ['logs/nutrition'];
  assert.equal(countedRecordInspection(service, raw).result?.kind, 'food-entry');
});

test('profile inspection reuse preserves conflicting evidence and timestamp fallback isolation', () => {
  const { service, plugin } = createHarness();
  plugin.settings.nativeRecordKindPropertyKeys = { 'food-entry': { tag: 'food' }, exercise: { tag: 'exercise' } };
  assert.equal(countedRecordInspection(service, { tpsId: 'conflict', title: 'Both', tags: ['food', 'exercise'] }).result, null);
  assert.equal(countedRecordInspection(service, { tpsId: 'a', TPSID: 'b', title: 'Case conflict', tags: ['food'] }).result, null);
  plugin.settings.nativeRecordKindPropertyKeys = {};
  const raw = { tpsId: 'fallback', tpsSchemaVersion: 1, title: 'Fallback', kind: 'task', createdDate: '2026-09-01', modifiedDate: '2026-09-02' };
  const original = structuredClone(raw);
  service.readingMigrationSources = true;
  assert.equal(countedRecordInspection(service, raw).result?.frontmatter.createdDate, '2026-09-01');
  assert.deepEqual(raw, original);
  service.readingMigrationSources = false;
  const current = countedRecordInspection(service, raw);
  assert.equal(current.result?.frontmatter.createdDate, '', 'evidence fallback cannot mutate the current-profile result');
  assert.equal(current.result?.frontmatter.modifiedDate, '');
  assert.deepEqual(raw, original);
});

test('post-layout create and metadata bursts do no draft IO; the explicit handoff prepares once', async () => {
  const { service, plugin, vault } = createHarness();
  const counts = { cachedRead: 0, read: 0, process: 0, rename: 0, timers: 0 };
  for (const method of ['cachedRead', 'read', 'process', 'rename']) {
    const original = vault[method];
    vault[method] = (...args) => { counts[method]++; return original(...args); };
  }
  const originalTimer = globalThis.setTimeout;
  const files = [];
  try {
    globalThis.setTimeout = (...args) => { counts.timers++; return originalTimer(...args); };
    for (let i = 0; i < 1000; i++) {
      const file = await vault.create(`Inbox/Draft ${i}.md`, '---\nkind: task\n---\n');
      files.push(file);
      for (let j = 0; j < 3; j++) plugin.app.metadataCache.emit('changed', file);
    }
    await Promise.resolve();
    assert.deepEqual(counts, { cachedRead: 0, read: 0, process: 0, rename: 0, timers: 0 });
    await Promise.all([service.prepareCreatedNote(files[0]), service.prepareCreatedNote(files[0])]);
    assert.equal(counts.process, 1);
    assert.equal(counts.rename, 1);
    assert.equal(counts.read, 0);
    assert.equal(counts.timers, 0);
    const after = { ...counts };
    for (let i = 0; i < 5; i++) {
      plugin.app.metadataCache.emit('changed', files[0]);
      await service.prepareCreatedNote(files[0]);
    }
    assert.deepEqual(counts, after);
  } finally { globalThis.setTimeout = originalTimer; }
});

test('task preparation preserves a concurrent body edit or newly applied exclusion without later retries', async () => {
  for (const change of ['body', 'exclusion']) {
    const { service, plugin, vault, contents } = createHarness();
    const file = await vault.create('Inbox/Draft.md', '---\nkind: task\n---\n');
    const original = vault.process;
    let writes = 0, renames = 0;
    vault.rename = async () => { renames++; };
    vault.process = async (...args) => {
      writes++;
      if (change === 'body') contents.set(file, '---\nkind: task\n---\nConcurrent human body');
      else plugin.settings.frontmatterAutoWriteExclusions = 'path:Inbox/';
      return original(...args);
    };
    await service.prepareCreatedNote(file);
    const expected = contents.get(file);
    assert.equal(expected.includes('tpsId'), false);
    assert.equal(file.path, 'Inbox/Draft.md');
    assert.equal(renames, 0);
    plugin.app.metadataCache.emit('changed', file);
    await service.prepareCreatedNote(file);
    assert.equal(writes, 1);
    assert.equal(contents.get(file), expected);
    if (change === 'body') assert.match(expected, /Concurrent human body/);
  }
});

test('preparation failures propagate once; metadata changes do not retry reads, writes or renames', async () => {
  for (const method of ['cachedRead', 'process', 'rename']) {
    const { service, plugin, vault } = createHarness();
    const file = await vault.create('Inbox/Failed.md', '---\nkind: task\n---\n');
    let attempts = 0;
    vault[method] = async () => { attempts++; throw new Error(`failed ${method}`); };
    await assert.rejects(service.prepareCreatedNote(file), new RegExp(`failed ${method}`));
    for (let i = 0; i < 3; i++) {
      plugin.app.metadataCache.emit('changed', file);
      await service.prepareCreatedNote(file);
    }
    assert.equal(attempts, 1);
    assert.equal(file.path, 'Inbox/Failed.md');
  }
});

test('old files and fully prepared native creations are not adopted at the handoff', async () => {
  const { service, vault, addFile, contents } = createHarness();
  const old = addFile('Existing.md', '---\nkind: task\n---\n');
  const prepared = await service.create('task', { title: 'Owned creation' }, { id: 'owned-task' });
  let writes = 0;
  vault.process = async () => { writes++; assert.fail('already prepared'); };
  for (const file of [old, prepared.file]) {
    const before = contents.get(file);
    await service.prepareCreatedNote(file);
    assert.equal(contents.get(file), before);
  }
  assert.equal(writes, 0);
});

for (const shape of ['file', 'path', 'path+id']) {
  test(`selected-file ${shape} edits inspect only their source, including a 100-read burst`, async () => {
    const h = createHarness();
    for (let i = 0; i < 1000; i++) h.addFile(`Inbox/ordinary-${i}.md`, 'Unrelated body\n');
    const file = h.addFile('Inbox/Selected.md', '---\ntpsId: selected-id\nkind: food-entry\ntitle: Selected\n---\nKeep this body\n');
    const reference = shape === 'file' ? file : shape === 'path' ? file.path : { path: file.path, id: 'selected-id' };
    let scans = 0, reads = 0, writes = 0;
    const enumerate = h.vault.getMarkdownFiles, read = h.vault.read, process = h.vault.process;
    h.vault.getMarkdownFiles = () => { scans++; return enumerate(); };
    h.vault.read = async target => { reads++; assert.equal(target, file); return read(target); };
    h.vault.process = async (...args) => { writes++; return process(...args); };
    for (let i = 0; i < 100; i++) assert.equal((await h.service.resolve(reference))?.id, 'selected-id');
    assert.deepEqual({scans, reads, writes}, {scans: 0, reads: 100, writes: 0});
    assert.equal((await h.service.update(reference, {calories: 150}))?.frontmatter.calories, 150);
    assert.equal(scans, 0);
    assert.equal(writes, 1);
    assert.equal(h.service.authoritativeSourceCache.size, 0, 'local reads do not claim globally verified identity');
    assert.ok(h.contents.get(file).endsWith('Keep this body\n'));
  });
}

test('selected-file authority does not conceal unseen duplicates from later global operations', async () => {
  const h = createHarness();
  const source = '---\ntpsId: selected-owner\nkind: food-entry\ntitle: Selected\n---\nBody\n';
  const file = h.addFile('Inbox/Selected.md', source);
  const duplicate = h.addFile('Inbox/Uncached duplicate.md', source);
  h.metadata.delete(duplicate);
  assert.equal((await h.service.update(file, {calories: 20}))?.frontmatter.calories, 20);
  assert.equal(h.contents.get(duplicate), source);
  assert.equal(await h.service.resolve('selected-owner'), null, 'ID lookup must still discover the duplicate');
  assert.equal(await h.service.update(file, {calories: 30}), null, 'known conflicts remain blocked');
  assert.equal(await h.service.reidentify(file, 'replacement-id'), null);
  assert.equal(await h.service.canCreateIdentity('selected-owner'), false);
});

test('selected-file references never redirect a missing path or detached TFile to another owner', async () => {
  const h = createHarness();
  const source = '---\ntpsId: selected-owner\nkind: food-entry\ntitle: Selected\n---\nBody\n';
  const file = h.addFile('Inbox/Selected.md', source);
  const replacement = h.addFile(file.path, source);
  for (const reference of [file, {path: 'Inbox/Missing.md', id: 'selected-owner'}, {path: replacement.path, id: 'stale-owner'}]) {
    assert.equal(await h.service.resolve(reference), null);
    assert.equal(await h.service.update(reference, {calories: 20}), null);
  }
  assert.equal(h.contents.get(replacement), source);
});

test('selected-file updates preserve concurrent body edits and reject changed identity at the atomic boundary', async () => {
  for (const changeIdentity of [false, true]) {
    const h = createHarness();
    const source = '---\ntpsId: selected-owner\nkind: food-entry\ntitle: Selected\n---\nBody\n';
    const file = h.addFile('Inbox/Selected.md', source);
    const process = h.vault.process;
    h.vault.process = async (...args) => {
      h.contents.set(file, source.replace('Body', 'Concurrent body').replace('selected-owner', changeIdentity ? 'new-owner' : 'selected-owner'));
      return process(...args);
    };
    const updated = await h.service.update(file, {calories: 20});
    assert.equal(updated?.id || null, changeIdentity ? null : 'selected-owner');
    assert.ok(h.contents.get(file).endsWith('Concurrent body\n'));
    if (changeIdentity) assert.doesNotMatch(h.contents.get(file), /calories:/);
  }
});

test('selected-file rename remains local and rechecks identity after folder preparation', async () => {
  for (const changeIdentity of [false, true]) {
    const h = createHarness();
    const source = '---\ntpsId: selected-owner\nkind: food-entry\ntitle: Selected\n---\nBody\n';
    const file = h.addFile('Inbox/Selected.md', source);
    let scans = 0;
    const enumerate = h.vault.getMarkdownFiles;
    h.vault.getMarkdownFiles = () => { scans++; return enumerate(); };
    const prepare = h.service.ensureParentFolder.bind(h.service);
    h.service.ensureParentFolder = async path => {
      await prepare(path);
      if (changeIdentity) h.contents.set(file, source.replace('selected-owner', 'new-owner'));
    };
    const renamed = await h.service.rename(file, 'Renamed');
    assert.equal(!!renamed, !changeIdentity);
    assert.equal(scans, 0);
    assert.equal(file.path, changeIdentity ? 'Inbox/Selected.md' : '_records/food-entries/Renamed.md');
  }
});

test('selected-file read rejects replacement, movement and configuration changes without rescanning', async () => {
  for (const race of ['replacement', 'move', 'mapping']) {
    const h = createHarness();
    const source = '---\ntpsId: selected-owner\nkind: food-entry\ntitle: Selected\n---\nBody\n';
    const file = h.addFile('Inbox/Selected.md', source);
    h.vault.getMarkdownFiles = () => { throw Error('No global scan'); };
    h.vault.read = async () => {
      if (race === 'replacement') h.addFile(file.path, source);
      if (race === 'move') await h.vault.rename(file, 'Inbox/Moved.md');
      if (race === 'mapping') h.plugin.settings.nativeRecordIdentityPropertyKey = 'otherId';
      return source;
    };
    assert.equal(await h.service.resolve(file), null);
  }
});

test('selected-file edits reject a moved target at the atomic boundary', async () => {
  const h = createHarness();
  const source = '---\ntpsId: selected-owner\nkind: food-entry\ntitle: Selected\n---\nBody\n';
  const file = h.addFile('Inbox/Selected.md', source);
  const process = h.vault.process;
  h.vault.process = async (...args) => {
    await h.vault.rename(file, 'Inbox/Moved.md');
    return process(...args);
  };
  assert.equal(await h.service.update(file, {calories: 20}), null);
  assert.equal(h.contents.get(file), source);
});

for (const operation of ['canReidentify', 'reidentify', 'canApplyIdentityPlan']) {
  test(`selected-file ${operation} still verifies unknown duplicate identities`, async () => {
    const h = createHarness();
    const source = '---\ntpsId: selected-owner\nkind: food-entry\ntitle: Selected\n---\nBody\n';
    const file = h.addFile('Inbox/Selected.md', source);
    const other = h.addFile('Inbox/Unknown.md', source);
    h.metadata.delete(other);
    let scans = 0;
    const enumerate = h.vault.getMarkdownFiles;
    h.vault.getMarkdownFiles = () => { scans++; return enumerate(); };
    const result = operation === 'canApplyIdentityPlan'
      ? await h.service.canApplyIdentityPlan([{operation:'reidentify',reference:file,nextId:'new-id',updates:[]}])
      : await h.service[operation](file, 'new-id');
    assert.equal(result, operation === 'reidentify' ? null : false);
    assert.ok(scans > 0);
    assert.equal(h.contents.get(file), source);
    assert.equal(h.contents.get(other), source);
  });
}

async function authoritativeWorkload(count = 32) {
  const h = createHarness('native-records', { deferSetup: true });
  h.files = Array.from({ length: count }, (_, i) => h.addFile(`Authority/record-${i}.md`,
    `---\ntpsId: authority-${i}\nkind: task\ntitle: Record ${i}\nlabel: Label ${i}\n---\nPreserve body ${i}\n`));
  assert.equal(await h.service.setup(), true);
  return h;
}

function editAuthoritativeSource(h, file = h.files[0], title = 'Current source') {
  const next = h.contents.get(file).replace(/^title:.*$/mu, `title: ${title}`);
  h.contents.set(file, next);
  file.stat.mtime += 1;
  file.stat.size = next.length;
  h.vault.emit('modify', file);
  return next;
}

function authoritativeCpuBudget(h, phase, cost = 2) {
  // Deterministically model CPU spent in the actual private pass. Cheap visits
  // advance no clock: they must not incur a count-only/clamped task penalty.
  const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  const parseObserver = globalThis.__nativeRecordAuthoritativeParse;
  let elapsed = 0;
  const counts = { inventories: 0, reads: 0, writes: 0, prune: 0, acquire: 0, parse: 0, index: 0 };
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => elapsed } });
  const restorations = [];
  const wrap = (host, method, key, measuredPhase) => {
    const original = host[method];
    host[method] = function (...args) {
      counts[key]++;
      const result = original.apply(this, args);
      if (phase === measuredPhase) elapsed += cost;
      return result;
    };
    restorations.push(() => { host[method] = original; });
  };
  wrap(h.vault, 'getMarkdownFiles', 'inventories');
  wrap(h.vault, 'read', 'reads');
  for (const method of ['process', 'create', 'rename', 'createFolder']) wrap(h.vault, method, 'writes');
  wrap(h.service.authoritativeSourceCache, 'get', 'acquire', 'acquire');
  wrap(h.service, 'indexFile', 'index', 'commit');
  const cache = h.service.authoritativeSourceCache;
  const keys = cache.keys;
  cache.keys = function* () {
    for (const path of keys.call(this)) {
      counts.prune++;
      if (phase === 'prune') elapsed += cost;
      yield path;
    }
  };
  restorations.push(() => { cache.keys = keys; });
  globalThis.__nativeRecordAuthoritativeParse = () => {
    counts.parse++;
    if (phase === 'parse') elapsed += cost;
  };
  const tasks = manualStartupTasks();
  const taskObservations = [];
  const schedule = globalThis.scheduler.yield;
  globalThis.scheduler.yield = () => { taskObservations.push({ elapsed, ...counts }); return schedule(); };
  let taskTurns = 0;
  const step = tasks.step.bind(tasks);
  tasks.step = async () => { taskTurns++; await step(); };
  return {
    counts, tasks, taskObservations,
    get taskTurns() { return taskTurns; },
    restore() {
      tasks.restore();
      for (const restore of restorations.reverse()) restore();
      globalThis.__nativeRecordAuthoritativeParse = parseObserver;
      Object.defineProperty(globalThis, 'performance', performanceDescriptor);
    },
  };
}

function observeAuthoritativeOperation(operation) {
  const observed = { settled: false, result: undefined, error: undefined };
  observed.promise = operation.then(result => {
    observed.settled = true; observed.result = result;
  }, error => {
    observed.settled = true; observed.error = error;
  });
  return observed;
}

async function reachAuthoritativeTask(work, operation) {
  for (let turn = 0; !work.tasks.pending && !operation.settled && turn < 1000; turn++) await flushStartupMicrotasks();
  assert.equal(operation.settled, false, 'expensive authoritative work must not finish in one uninterrupted task');
  assert.equal(work.tasks.pending, 1, 'eight read workers must share one task-yield owner, not eight independent yields');
}

async function finishAuthoritativeOperation(work, operation) {
  for (let turn = 0; !operation.settled && turn < 4000; turn++) {
    if (work.tasks.pending) await work.tasks.step();
    else await flushStartupMicrotasks();
  }
  assert.equal(operation.settled, true, 'finite source work and cancellation must settle without a retry/poller');
  await operation.promise;
  if (operation.error) throw operation.error;
  return operation.result;
}

async function readyAuthoritativePhase(phase) {
  const h = await authoritativeWorkload();
  if (phase === 'prune' || phase === 'acquire') {
    await h.service.refreshIdentityIndexFromVaultSource();
    editAuthoritativeSource(h);
  }
  return h;
}

test('authoritative refresh task observer detects the existing actual service task helper', async () => {
  const h = await authoritativeWorkload(1);
  const work = authoritativeCpuBudget(h, 'none');
  const operation = observeAuthoritativeOperation(h.service.yieldInitialDiscovery());
  try {
    assert.equal(operation.settled, false);
    assert.equal(work.tasks.pending, 1);
    await finishAuthoritativeOperation(work, operation);
    assert.equal(work.taskTurns, 1, 'a microtask-only continuation cannot satisfy this observer');
    assert.equal(work.counts.inventories + work.counts.reads + work.counts.writes, 0);
  } finally { h.service.dispose(); work.restore(); }
});

test('authoritative refresh late creation task is driven after the cold setup drain has already returned', async () => {
  const h = startupLoad('native-records', 17);
  const work = authoritativeCpuBudget(h, 'parse');
  const p = coldStartupHarness(h);
  const setup = h.service.setup({ afterLayout: true });
  const create = observeAuthoritativeOperation(h.service.create('task', { title: 'Early task' }, { id: 'late-task' }));
  try {
    await flushStartupMicrotasks();
    assert.equal(h.service.inFlightCreateIds.size, 0);
    assert.equal(h.counters.reads + h.counters.writes, 0);
    assert.equal(create.settled, false);
    p.layout();
    await work.tasks.drain();
    assert.equal(await setup, true);
    await flushStartupMicrotasks();
    assert.equal(create.settled, false, 'setup completion alone cannot settle the later source-verification owner');
    assert.equal(work.tasks.pending, 1, 'a source task is queued after the one-time startup drain returned');
    assert.equal(h.counters.writes, 0);
    const created = await finishAuthoritativeOperation(work, create);
    assert.equal(created.id, 'late-task');
    assert.equal(h.counters.writes, 1);
    assert.equal(h.service.inFlightCreateIds.size, 0);
    assert.equal(work.counts.reads, 17);
    assert.ok(work.taskTurns > 0);
  } finally { h.service.dispose(); await work.tasks.drain(); work.restore(); }
});

for (const phase of ['prune', 'acquire', 'parse', 'commit']) {
  test(`authoritative refresh yields costly ${phase} work before publishing or clearing dirty sources`, async () => {
    const h = await readyAuthoritativePhase(phase);
    const work = authoritativeCpuBudget(h, phase);
    const inputs = h.files.map(file => h.contents.get(file));
    const operation = observeAuthoritativeOperation(h.service.refreshIdentityIndexFromVaultSource());
    try {
      await reachAuthoritativeTask(work, operation);
      assert.ok(work.counts[phase === 'commit' ? 'index' : phase] > 0);
      assert.ok(work.counts[phase === 'commit' ? 'index' : phase] < h.files.length, 'the CPU-bound stage is incomplete at its first task boundary');
      const firstSliceLimit = phase === 'prune' ? 5 : phase === 'commit' ? 4 : 8;
      assert.ok(work.counts[phase === 'commit' ? 'index' : phase] <= firstSliceLimit,
        'the shared 8 ms budget allows one atomic iterator step or the bounded in-flight reader group, not an almost-complete scan');
      assert.notEqual(h.service.authoritativeIdentityGeneration, h.service.identitySourceGeneration);
      assert.ok(h.service.authoritativeIndexDirtyPaths.size > 0);
      const joined = observeAuthoritativeOperation(h.service.snapshot());
      await flushStartupMicrotasks();
      assert.equal(joined.settled, false, 'public consumers cannot materialize a partially committed identity index');
      await finishAuthoritativeOperation(work, operation);
      const snapshot = await finishAuthoritativeOperation(work, joined);
      assert.equal(snapshot.records.length, 32);
      assert.equal(work.counts.inventories, 1, 'concurrent callers join the existing single flight');
      assert.equal(work.counts.reads, phase === 'prune' || phase === 'acquire' ? 1 : 32);
      assert.equal(work.counts.index, phase === 'prune' || phase === 'acquire' ? 1 : 32);
      assert.equal(work.counts.writes, 0);
      assert.equal(h.service.authoritativeIndexDirtyPaths.size, 0);
      assert.equal(h.service.authoritativeIdentityGeneration, h.service.identitySourceGeneration);
      assert.deepEqual(h.files.map(file => h.contents.get(file)), inputs);
      let previousClock = 0;
      for (const boundary of work.taskObservations) {
        assert.ok(boundary.elapsed - previousClock <= 16, 'every continued CPU slice obeys the shared budget plus bounded reader/atomic allowance');
        previousClock = boundary.elapsed;
      }
    } finally { h.service.dispose(); work.restore(); }
  });
}

test('authoritative refresh keeps cheap 10000-cache-hit warm edits on the no-task path with one read and index', async () => {
  const h = await authoritativeWorkload(10000);
  await h.service.refreshIdentityIndexFromVaultSource();
  const current = editAuthoritativeSource(h);
  const work = authoritativeCpuBudget(h, 'none');
  const operation = observeAuthoritativeOperation(h.service.refreshIdentityIndexFromVaultSource());
  try {
    await finishAuthoritativeOperation(work, operation);
    assert.equal(work.tasks.pending, 0);
    assert.equal(work.taskTurns, 0, 'cheap cache hits must not receive a count-only task-yield penalty');
    assert.equal(work.counts.inventories, 1);
    assert.equal(work.counts.reads, 1);
    assert.equal(work.counts.parse, 1);
    assert.equal(work.counts.index, 1);
    assert.equal(work.counts.prune, 9999);
    assert.ok(work.counts.acquire >= 10000, 'unchanged files still use the existing source cache');
    assert.equal(h.service.recordsByPath.get(h.files[0].path).title, 'Current source');
    assert.equal(h.contents.get(h.files[0]), current);
    assert.equal(work.counts.writes, 0);
    const before = { ...work.counts };
    await h.service.refreshIdentityIndexFromVaultSource();
    assert.deepEqual(work.counts, before, 'already authoritative unchanged requests do no additional work');
  } finally { h.service.dispose(); work.restore(); }
});

for (const phase of ['prune', 'acquire', 'commit']) {
  for (const invalidation of ['generation', 'revision-only', 'configuration']) {
    test(`authoritative refresh rechecks ${invalidation} after a held ${phase} task`, async () => {
      const h = await readyAuthoritativePhase(phase);
      const work = authoritativeCpuBudget(h, phase);
      const operation = observeAuthoritativeOperation(h.service.snapshot());
      try {
        await reachAuthoritativeTask(work, operation);
        const generation = h.service.identitySourceGeneration;
        if (invalidation === 'configuration') {
          h.plugin.settings.nativeRecordTitlePropertyKey = 'label';
          h.service.refreshConfiguration();
        } else {
          const file = h.files[0];
          const current = h.contents.get(file).replace(/^title:.*$/mu, 'title: Edited during task');
          h.contents.set(file, current); file.stat.mtime++; file.stat.size = current.length;
          if (invalidation === 'generation') {
            h.vault.emit('modify', file);
            h.plugin.app.metadataCache.emit('changed', file, '', { frontmatter: {
              tpsId: 'poisoned-cache-id', kind: 'task', title: 'Stale metadata',
            } });
          } else h.service.invalidateAuthoritativeSources([file.path]);
        }
        if (invalidation === 'revision-only') assert.equal(h.service.identitySourceGeneration, generation, 'internal source revisions do not require a new public generation');
        const snapshot = await finishAuthoritativeOperation(work, operation);
        assert.equal(snapshot.records.length, 32);
        assert.equal(h.service.recordsByPath.get(h.files[0].path).title,
          invalidation === 'configuration' ? 'Label 0' : 'Edited during task');
        assert.equal(h.service.pathsById.has('poisoned-cache-id'), false);
        assert.equal(h.service.authoritativeIndexDirtyPaths.size, 0);
        assert.equal(h.service.authoritativeIdentityGeneration, h.service.identitySourceGeneration);
        assert.equal(work.counts.writes, 0);
      } finally { h.service.dispose(); work.restore(); }
    });
  }
}

for (const change of ['delete', 'rename', 'replacement', 'unannounced-replacement']) {
  test(`authoritative refresh cannot restore an obsolete TFile after ${change} during commit`, async () => {
    const h = await authoritativeWorkload();
    const work = authoritativeCpuBudget(h, 'commit');
    const operation = observeAuthoritativeOperation(h.service.snapshot());
    try {
      await reachAuthoritativeTask(work, operation);
      const obsolete = h.files[31];
      const oldPath = obsolete.path;
      if (change === 'delete') { h.entries.delete(oldPath); h.vault.emit('delete', obsolete); }
      else if (change === 'rename') await h.vault.rename(obsolete, 'Authority/Renamed.md');
      else {
        const replacement = h.addFile(oldPath, h.contents.get(obsolete).replace('authority-31', 'replacement-id'));
        if (change === 'replacement') h.vault.emit('create', replacement);
      }
      const snapshot = await finishAuthoritativeOperation(work, operation);
      assert.equal(snapshot.records.length, change === 'delete' ? 31 : 32);
      if (change === 'rename') {
        assert.equal(h.service.recordsByPath.has(oldPath), false);
        assert.equal(snapshot.records.find(record => record.id === 'authority-31')?.path, 'Authority/Renamed.md');
      } else if (change === 'delete') assert.equal(h.service.pathsById.has('authority-31'), false);
      else {
        assert.equal(h.service.recordsByPath.get(oldPath)?.tpsId, 'replacement-id');
        assert.equal(h.service.pathsById.has('authority-31'), false);
      }
      assert.equal(h.service.authoritativeIndexDirtyPaths.size, 0);
      assert.equal(h.service.authoritativeIdentityGeneration, h.service.identitySourceGeneration);
      assert.equal(work.counts.writes, change === 'rename' ? 1 : 0);
    } finally { h.service.dispose(); work.restore(); }
  });
}

for (const phase of ['prune', 'acquire', 'parse', 'commit']) {
  test(`authoritative refresh disposal at ${phase} task cancels all waiters without publication or restart`, async () => {
    const h = await readyAuthoritativePhase(phase);
    const work = authoritativeCpuBudget(h, phase);
    const operation = observeAuthoritativeOperation(h.service.snapshot());
    try {
      await reachAuthoritativeTask(work, operation);
      const joined = observeAuthoritativeOperation(h.service.snapshot());
      await flushStartupMicrotasks();
      const inventories = work.counts.inventories;
      const indexed = work.counts.index;
      h.service.dispose();
      await assert.rejects(() => finishAuthoritativeOperation(work, operation), /cancelled/u);
      await assert.rejects(() => finishAuthoritativeOperation(work, joined), /cancelled/u);
      assert.equal(work.counts.inventories, inventories, 'cancelled scans cannot recursively restart');
      assert.equal(work.counts.index, indexed, 'late task continuations cannot accept more source records');
      assert.notEqual(h.service.authoritativeIdentityGeneration, h.service.identitySourceGeneration);
      assert.ok(h.service.authoritativeIndexDirtyPaths.size > 0);
      assert.equal(h.service.authoritativeIdentityRefresh, null);
      assert.equal(work.counts.writes, 0);
    } finally { h.service.dispose(); work.restore(); }
  });
}

test('authoritative refresh drains already-started reads on disposal but never parses, indexes or publishes them', async () => {
  const h = await authoritativeWorkload();
  const work = authoritativeCpuBudget(h, 'none');
  const originalRead = h.vault.read;
  const pending = [];
  h.vault.read = file => new Promise(resolve => pending.push(async () => resolve(await originalRead(file))));
  const operation = observeAuthoritativeOperation(h.service.snapshot());
  try {
    for (let turn = 0; pending.length < 8 && !operation.settled && turn < 100; turn++) await flushStartupMicrotasks();
    assert.equal(pending.length, 8);
    h.service.dispose();
    await flushStartupMicrotasks();
    assert.equal(operation.settled, false, 'owned in-flight Vault reads are drained before releasing the single flight');
    await Promise.all(pending.splice(0).map(release => release()));
    await assert.rejects(() => finishAuthoritativeOperation(work, operation), /cancelled/u);
    assert.equal(work.counts.reads, 8);
    assert.equal(work.counts.parse, 0, 'disposed read callbacks must not spend CPU parsing old bytes');
    assert.equal(work.counts.index, 0);
    assert.equal(work.counts.inventories, 1);
    assert.equal(h.service.authoritativeIdentityGeneration, -1);
    assert.ok(h.service.authoritativeIndexDirtyPaths.size > 0);
    assert.equal(h.service.authoritativeIdentityRefresh, null);
    assert.equal(work.counts.writes, 0);
  } finally { h.service.dispose(); work.restore(); }
});

test('authoritative refresh preserves duplicate blocking when a second owner appears during a held commit', async () => {
  const h = await authoritativeWorkload();
  const work = authoritativeCpuBudget(h, 'commit');
  const operation = observeAuthoritativeOperation(h.service.snapshot(undefined, { includeConflicts: true }));
  try {
    await reachAuthoritativeTask(work, operation);
    const duplicate = h.addFile('Authority/Duplicate.md', h.contents.get(h.files[0]));
    h.vault.emit('create', duplicate);
    const snapshot = await finishAuthoritativeOperation(work, operation);
    assert.equal(snapshot.records.length, 31);
    assert.equal(snapshot.conflicts.some(conflict => conflict.ids.includes('authority-0')), true);
    assert.equal(h.service.pathsById.get('authority-0').size, 2);
    await assert.rejects(() => h.service.create('task', { title: 'Duplicate' }, { id: 'authority-0' }), /already exists/u);
    assert.equal(work.counts.writes, 0);
  } finally { h.service.dispose(); work.restore(); }
});

test('authoritative refresh task rejection releases one failed owner without clearing dirty sources or retrying', async () => {
  const h = await authoritativeWorkload();
  const work = authoritativeCpuBudget(h, 'commit');
  const schedulerFailure = Error('Authoritative task unavailable');
  let yields = 0;
  globalThis.scheduler = { yield: () => { yields++; return Promise.reject(schedulerFailure); } };
  const left = observeAuthoritativeOperation(h.service.snapshot());
  const right = observeAuthoritativeOperation(h.service.snapshot());
  try {
    await assert.rejects(() => finishAuthoritativeOperation(work, left), error => error === schedulerFailure);
    await assert.rejects(() => finishAuthoritativeOperation(work, right), error => error === schedulerFailure);
    assert.equal(yields, 1);
    assert.equal(work.counts.inventories, 1);
    assert.equal(h.service.authoritativeIdentityRefresh, null);
    assert.equal(h.service.authoritativeIdentityGeneration, -1);
    assert.ok(h.service.authoritativeIndexDirtyPaths.size > 0);
    assert.equal(work.counts.writes, 0);
  } finally { h.service.dispose(); work.restore(); }
});

for (const position of ['committed', 'queued']) {
  test(`authoritative refresh ignores metadata-only poison for a ${position} path while its source owner is held`, async () => {
    const h = await authoritativeWorkload();
    const work = authoritativeCpuBudget(h, 'commit');
    const operation = observeAuthoritativeOperation(h.service.snapshot());
    try {
      await reachAuthoritativeTask(work, operation);
      assert.equal(h.plugin.api, undefined, 'source ownership is independent of public API publication');
      const file = h.files[position === 'committed' ? 0 : 31];
      assert.ok(work.counts.index >= 1 && work.counts.index < 32);
      const source = h.contents.get(file);
      const stat = { ...file.stat };
      const generation = h.service.identitySourceGeneration;
      const revision = h.service.authoritativeSourceRevision;
      h.plugin.app.metadataCache.emit('changed', file, '', { frontmatter: {
        tpsId: 'metadata-poison', kind: 'task', title: 'Unverified metadata',
      } });
      assert.equal(h.service.pathsById.has('metadata-poison'), false, 'an active source owner must not accept provisional projection bytes');
      assert.equal(h.service.identitySourceGeneration, generation);
      assert.equal(h.service.authoritativeSourceRevision, revision, 'projection-only events must not invalidate verified source bytes');
      assert.equal(h.contents.get(file), source);
      assert.deepEqual(file.stat, stat);
      const snapshot = await finishAuthoritativeOperation(work, operation);
      assert.equal(snapshot.records.length, 32);
      assert.equal(h.service.recordsByPath.get(file.path).tpsId, position === 'committed' ? 'authority-0' : 'authority-31');
      assert.equal(h.service.recordsByPath.get(file.path).title, position === 'committed' ? 'Record 0' : 'Record 31');
      assert.equal(work.counts.reads, 32, 'stale metadata must not reread verified source');
      assert.equal(work.counts.writes, 0);
      h.plugin.app.metadataCache.emit('changed', file, '', { frontmatter: { tpsId: 'post-owner-poison', kind: 'task', title: 'Stale' } });
      assert.equal(h.service.pathsById.has('post-owner-poison'), false, 'the existing authoritative-generation guard remains after successful release');
    } finally { h.service.dispose(); work.restore(); }
  });
}

test('authoritative refresh failed-owner release restores ordinary metadata projection and later source reconciliation', async () => {
  const h = await authoritativeWorkload();
  const work = authoritativeCpuBudget(h, 'commit');
  const operation = observeAuthoritativeOperation(h.service.snapshot());
  const failure = Error('Held task failed');
  try {
    await reachAuthoritativeTask(work, operation);
    const file = h.files[0];
    const poison = { tpsId: 'metadata-after-failure', kind: 'task', title: 'Projection' };
    h.plugin.app.metadataCache.emit('changed', file, '', { frontmatter: poison });
    assert.equal(h.service.pathsById.has(poison.tpsId), false);
    await work.tasks.fail(failure);
    await assert.rejects(() => finishAuthoritativeOperation(work, operation), error => error === failure);
    assert.equal(h.service.authoritativeIdentityRefresh, null);
    assert.equal(h.service.authoritativeIdentityGeneration, -1);
    h.plugin.app.metadataCache.emit('changed', file, '', { frontmatter: poison });
    assert.equal(h.service.recordsByPath.get(file.path).tpsId, poison.tpsId, 'without an active owner, existing unready projection semantics remain');
    const reads = work.counts.reads;
    const recovered = observeAuthoritativeOperation(h.service.snapshot());
    assert.equal((await finishAuthoritativeOperation(work, recovered)).records.length, 32);
    assert.equal(work.counts.reads, reads, 'later recovery uses the retained verified source cache');
    assert.equal(h.service.recordsByPath.get(file.path).tpsId, 'authority-0');
    assert.equal(h.service.pathsById.has(poison.tpsId), false);
    assert.equal(work.counts.writes, 0);
  } finally { h.service.dispose(); work.restore(); }
});

test('authoritative refresh rejected parse task drains the other started reads and preserves its original error', async () => {
  const h = await authoritativeWorkload();
  const work = authoritativeCpuBudget(h, 'parse');
  const read = h.vault.read;
  const pending = [];
  let started = 0;
  h.vault.read = file => { started++; return new Promise(resolve => pending.push(async () => resolve(await read(file)))); };
  const left = observeAuthoritativeOperation(h.service.snapshot());
  const right = observeAuthoritativeOperation(h.service.snapshot());
  const failure = Error('Parse task unavailable');
  try {
    for (let turn = 0; pending.length < 8 && !left.settled && turn < 100; turn++) await flushStartupMicrotasks();
    assert.equal(pending.length, 8);
    await Promise.all(pending.splice(0, 4).map(release => release()));
    await reachAuthoritativeTask(work, left);
    assert.equal(work.counts.parse, 4);
    await work.tasks.fail(failure);
    await flushStartupMicrotasks();
    assert.equal(left.settled || right.settled, false, 'task failure must still drain owned Vault reads');
    assert.equal(started, 8, 'no later reads may start after a scheduler failure');
    await Promise.all(pending.splice(0).map(release => release()));
    await flushStartupMicrotasks();
    assert.equal(work.taskObservations.length, 1, 'late read completion must not schedule another task for an already failed owner');
    assert.equal(work.tasks.pending, 0);
    await assert.rejects(() => finishAuthoritativeOperation(work, left), error => error === failure);
    await assert.rejects(() => finishAuthoritativeOperation(work, right), error => error === failure);
    assert.equal(started, 8);
    assert.equal(work.counts.parse, 4);
    assert.equal(work.counts.index, 0);
    assert.equal(work.counts.inventories, 1);
    assert.equal(h.service.authoritativeIdentityGeneration, -1);
    assert.equal(h.service.authoritativeIdentityRefresh, null);
    assert.ok(h.service.authoritativeIndexDirtyPaths.size > 0);
    assert.equal(work.counts.writes, 0);
  } finally { h.service.dispose(); work.restore(); }
});
