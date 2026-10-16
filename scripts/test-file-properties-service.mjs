import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadServiceModule() {
  const result = await build({
    stdin: {
      contents: `
        export {
          FilePropertiesService,
          FILE_PROPERTIES_ROOT,
          FILE_PROPERTIES_BY_ID_ROOT,
          FILE_PROPERTY_KEYS,
          RESERVED_FILE_PROPERTY_KEYS,
          isFilePropertiesCompanionPath,
          isFilePropertiesCompanionRecord,
        } from '../src/services/file-properties-service.ts';
        export { TFile, TFolder } from 'obsidian';
      `,
      resolveDir: dirname(fileURLToPath(import.meta.url)),
      sourcefile: 'file-properties-service-harness.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'file-properties-service-stubs',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({
          path: 'obsidian',
          namespace: 'file-properties-test',
        }));
        builder.onResolve({ filter: /^\.\.\/core$/u }, () => ({
          path: 'core',
          namespace: 'file-properties-test',
        }));
        builder.onResolve({ filter: /^\.\.\/logger$/u }, () => ({
          path: 'logger',
          namespace: 'file-properties-test',
        }));
        builder.onResolve({ filter: /^\.\.\/utils\/tag-utils$/u }, () => ({
          path: 'tag-utils',
          namespace: 'file-properties-test',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'file-properties-test' }, (args) => {
          if (args.path === 'obsidian') {
            return {
              loader: 'js',
              contents: `
                export class TAbstractFile {
                  constructor(path = '') {
                    this.path = normalizePath(path);
                    this.refreshIdentity();
                  }
                  refreshIdentity() {
                    this.name = this.path.split('/').filter(Boolean).pop() || '';
                  }
                }
                export class TFolder extends TAbstractFile {}
                export class TFile extends TAbstractFile {
                  constructor(path = '') {
                    super(path);
                    this.stat = { ctime: 1, mtime: 1, size: 0 };
                    this.refreshIdentity();
                  }
                  refreshIdentity() {
                    super.refreshIdentity();
                    const dot = this.name.lastIndexOf('.');
                    this.extension = dot >= 0 ? this.name.slice(dot + 1) : '';
                    this.basename = dot >= 0 ? this.name.slice(0, dot) : this.name;
                  }
                }
                export class Notice {
                  constructor(message, duration) {
                    globalThis.__tpsFilePropertiesNotices?.push({ message: String(message), duration });
                  }
                }
                export function normalizePath(value) {
                  return String(value || '')
                    .replace(/\\\\/gu, '/')
                    .replace(/\\/{2,}/gu, '/')
                    .replace(/^\\.\\//u, '')
                    .replace(/^\\/+|\\/+$/gu, '');
                }
                export const parseYaml = (value) => JSON.parse(String(value || '{}'));
                export const stringifyYaml = (value) => JSON.stringify(value);
              `,
            };
          }
          if (args.path === 'core') {
            return {
              loader: 'js',
              contents: `
                export const casefold = (value) => String(value ?? '').trim().toLowerCase();
                export const findKeyCaseInsensitive = (record, key) =>
                  Object.keys(record || {}).find((candidate) => casefold(candidate) === casefold(key)) || null;
                export const deleteValueCaseInsensitive = (record, key) => {
                  for (const candidate of Object.keys(record || {})) {
                    if (casefold(candidate) === casefold(key)) delete record[candidate];
                  }
                };
                export const setValueCaseInsensitive = (record, key, value) => {
                  for (const candidate of Object.keys(record || {})) {
                    if (casefold(candidate) === casefold(key)) delete record[candidate];
                  }
                  record[key] = value;
                };
              `,
            };
          }
          if (args.path === 'logger') {
            return {
              loader: 'js',
              contents: 'export const warn = () => {}; export const error = () => {};',
            };
          }
          return {
            loader: 'js',
            contents: `
              export function normalizeTagList(value) {
                const source = Array.isArray(value) ? value : String(value ?? '').split(/[\\s,]+/u);
                return [...new Set(source
                  .map((entry) => String(entry).trim().replace(/^#+/u, '').toLowerCase())
                  .filter(Boolean))];
              }
            `,
          };
        });
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const {
  FilePropertiesService,
  FILE_PROPERTIES_ROOT,
  FILE_PROPERTIES_BY_ID_ROOT,
  FILE_PROPERTY_KEYS,
  RESERVED_FILE_PROPERTY_KEYS,
  isFilePropertiesCompanionPath,
  isFilePropertiesCompanionRecord,
  TFile,
  TFolder,
} = await loadServiceModule();

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizePath(value) {
  return String(value || '')
    .replace(/\\/gu, '/')
    .replace(/\/{2,}/gu, '/')
    .replace(/^\.\//u, '')
    .replace(/^\/+|\/+$/gu, '');
}

function companionContent(raw) {
  return `---\n${JSON.stringify(raw)}\n---\n\n`;
}

function parseCompanionContent(content) {
  const match = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  return match ? JSON.parse(match[1]) : null;
}

function createHarness() {
  const entries = new Map();
  const contents = new WeakMap();
  const staleCachedReads = new WeakMap();
  const metadata = new WeakMap();
  const writeTargets = [];
  const createTargets = [];
  const generatedLinks = [];
  const workspaceEvents = [];
  const filesUpdated = [];
  const explicitActions = [];
  const notices = [];
  globalThis.__tpsFilePropertiesNotices = notices;
  let beforeNextFrontmatterWrite = null;
  let afterNextFrontmatterWrite = null;
  let nextCreateError = null;
  let nextRenameError = null;
  let nextWorkspaceEventError = null;
  const root = new TFolder('');
  entries.set('', root);

  function ensureFolder(path) {
    const normalized = normalizePath(path);
    if (!normalized) return root;
    const existing = entries.get(normalized);
    if (existing) {
      assert.ok(existing instanceof TFolder, `${normalized} must remain a folder`);
      return existing;
    }
    const parentPath = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    ensureFolder(parentPath);
    const folder = new TFolder(normalized);
    entries.set(normalized, folder);
    return folder;
  }

  function addFile(path, content = '') {
    const normalized = normalizePath(path);
    const parentPath = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    ensureFolder(parentPath);
    assert.equal(entries.has(normalized), false, `Duplicate fixture path: ${normalized}`);
    const file = new TFile(normalized);
    contents.set(file, String(content));
    file.stat.size = String(content).length;
    const parsed = file.extension.toLowerCase() === 'md' ? parseCompanionContent(content) : null;
    if (parsed) metadata.set(file, parsed);
    entries.set(normalized, file);
    return file;
  }

  function addCompanion(path, raw) {
    return addFile(path, companionContent(raw));
  }

  async function rename(file, nextPath) {
    if (nextRenameError) {
      const error = nextRenameError;
      nextRenameError = null;
      throw error;
    }
    const normalized = normalizePath(nextPath);
    const collision = entries.get(normalized);
    if (collision && collision !== file) throw new Error(`Target already exists: ${normalized}`);
    const parentPath = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    ensureFolder(parentPath);
    entries.delete(file.path);
    file.path = normalized;
    file.refreshIdentity();
    file.stat.mtime += 1;
    entries.set(normalized, file);
  }

  async function renameFolder(folder, nextPath) {
    const oldPath = folder.path;
    const normalized = normalizePath(nextPath);
    const affected = Array.from(entries.values()).filter((entry) => (
      entry === folder || entry.path.startsWith(`${oldPath}/`)
    ));
    for (const entry of affected) entries.delete(entry.path);
    const parentPath = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    ensureFolder(parentPath);
    for (const entry of affected) {
      entry.path = entry === folder
        ? normalized
        : `${normalized}${entry.path.slice(oldPath.length)}`;
      entry.refreshIdentity();
      if (entry instanceof TFile) entry.stat.mtime += 1;
      entries.set(entry.path, entry);
    }
  }

  function remove(file) {
    entries.delete(file.path);
  }

  function directEditCompanion(file, raw) {
    metadata.set(file, clone(raw));
    contents.set(file, companionContent(raw));
    file.stat.mtime += 1;
    file.stat.size = contents.get(file).length;
  }

  function setMetadataFrontmatter(file, raw) {
    metadata.set(file, clone(raw));
  }

  function suppressMetadata(file) {
    metadata.delete(file);
  }

  const vault = {
    getAbstractFileByPath(path) {
      return entries.get(normalizePath(path)) || null;
    },
    getFiles() {
      return Array.from(entries.values()).filter((entry) => entry instanceof TFile);
    },
    getMarkdownFiles() {
      return this.getFiles().filter((file) => file.extension.toLowerCase() === 'md');
    },
    async createFolder(path) {
      ensureFolder(path);
    },
    async create(path, content) {
      createTargets.push(normalizePath(path));
      if (nextCreateError) {
        const error = nextCreateError;
        nextCreateError = null;
        throw error;
      }
      return addFile(path, content);
    },
    async read(file) {
      if (!entries.has(file.path)) throw new Error(`Missing file: ${file.path}`);
      return contents.get(file) ?? '';
    },
    async cachedRead(file) {
      return staleCachedReads.has(file) ? staleCachedReads.get(file) : this.read(file);
    },
    rename,
    renameFolder,
  };

  const fileManager = {
    generateMarkdownLink(file) {
      generatedLinks.push(file.path);
      const escaped = String(file.path || '')
        .replace(/\\/gu, '\\\\')
        .replace(/([#\^|\[\]])/gu, '\\$1');
      return `[[${escaped}]]`;
    },
    async processFrontMatter(file, mutator) {
      assert.equal(file.extension.toLowerCase(), 'md', 'only a Markdown companion may be mutated');
      assert.equal(entries.get(file.path), file, 'writer target must be live');
      writeTargets.push(file.path);
      const beforeWrite = beforeNextFrontmatterWrite;
      beforeNextFrontmatterWrite = null;
      if (beforeWrite) await beforeWrite(file);
      const next = clone(metadata.get(file) || parseCompanionContent(contents.get(file)) || {});
      await mutator(next);
      metadata.set(file, clone(next));
      contents.set(file, companionContent(next));
      file.stat.mtime += 1;
      file.stat.size = contents.get(file).length;
      const afterWrite = afterNextFrontmatterWrite;
      afterNextFrontmatterWrite = null;
      if (afterWrite) await afterWrite(file);
    },
  };

  const plugin = {
    manifest: { id: 'tps-global-context-menu' },
    settings: { properties: [{ key: 'status' }, { key: 'priority' }, { key: 'tags' }] },
    app: {
      vault,
      fileManager,
      metadataCache: {
        getFileCache(file) {
          const frontmatter = metadata.get(file);
          return frontmatter ? { frontmatter: clone(frontmatter) } : null;
        },
      },
      workspace: {
        trigger(name, ...args) {
          if (nextWorkspaceEventError) {
            const error = nextWorkspaceEventError;
            nextWorkspaceEventError = null;
            throw error;
          }
          workspaceEvents.push({ name, args: clone(args) });
        },
      },
    },
    eventService: {
      emitFilesUpdated(paths, options) {
        filesUpdated.push({ paths: clone(paths), options: clone(options) });
      },
      emitExplicitAction(paths, options) {
        explicitActions.push({ paths: clone(paths), options: clone(options) });
      },
    },
  };

  return {
    plugin,
    vault,
    addFile,
    addCompanion,
    rename,
    renameFolder,
    remove,
    directEditCompanion,
    setMetadataFrontmatter,
    suppressMetadata,
    setStaleCachedRead(file, content) {
      staleCachedReads.set(file, String(content));
    },
    readContent: (file) => contents.get(file) ?? '',
    readRaw: (file) => clone(metadata.get(file) || null),
    writeTargets,
    createTargets,
    generatedLinks,
    workspaceEvents,
    filesUpdated,
    explicitActions,
    notices,
    injectConcurrentFrontmatterEdit(callback) {
      beforeNextFrontmatterWrite = callback;
    },
    injectAfterFrontmatterWrite(callback) {
      afterNextFrontmatterWrite = callback;
    },
    failNextCreate(message = 'Synthetic create failure') {
      nextCreateError = new Error(message);
    },
    failNextRename(message = 'Synthetic rename failure') {
      nextRenameError = new Error(message);
    },
    failNextWorkspaceEvent(message = 'Synthetic workspace event failure') {
      nextWorkspaceEventError = new Error(message);
    },
  };
}

function reservedRecord(sourcePath, fileId, user = {}, extra = {}) {
  const extension = sourcePath.split('.').pop().toLowerCase();
  return {
    [FILE_PROPERTY_KEYS.schema]: 1,
    [FILE_PROPERTY_KEYS.id]: fileId,
    [FILE_PROPERTY_KEYS.source]: `[[${sourcePath}]]`,
    [FILE_PROPERTY_KEYS.sourcePath]: sourcePath,
    [FILE_PROPERTY_KEYS.sourceExtension]: extension,
    ...extra,
    ...user,
  };
}

test('legacy Canvas properties are explicitly primed and copy-migrated without touching source JSON', async () => {
  const harness = createHarness();
  const canvasDocument = JSON.stringify({
    nodes: [{ id: 'node-1', type: 'text', text: 'Keep me' }],
    edges: [],
    metadata: { frontmatter: { status: 'legacy', tags: ['#Alpha'] } },
  });
  const canvas = harness.addFile('Boards/Roadmap.canvas', canvasDocument);
  harness.setStaleCachedRead(canvas, JSON.stringify({
    nodes: [],
    edges: [],
    metadata: { frontmatter: { status: 'stale-cache' } },
  }));
  const service = new FilePropertiesService(harness.plugin);

  await service.setup();
  assert.deepEqual(service.read(canvas), {}, 'setup must not parse every Canvas source');
  assert.equal(await service.primeLegacyCanvasCache([canvas]), 1);
  assert.deepEqual(service.read(canvas), { status: 'legacy', tags: ['alpha'] });
  harness.setMetadataFrontmatter(canvas, { status: 'metadata-refreshed', tags: ['#Beta'] });
  assert.deepEqual(service.read(canvas), { status: 'legacy', tags: ['alpha'] }, 'primed compatibility data remains stable until a source event');
  service.invalidateLegacyCanvas(canvas);
  assert.deepEqual(
    service.read(canvas),
    { status: 'metadata-refreshed', tags: ['beta'] },
    'Canvas source invalidation refreshes sync compatibility reads from MetadataCache',
  );
  assert.equal(service.hasCompanion(canvas), false, 'setup must remain read-only and lazy');
  assert.equal(harness.createTargets.length, 0);

  assert.equal(await service.process(canvas, (frontmatter) => {
    frontmatter.priority = 'high';
    frontmatter.tpsGcmSourcePath = 'Hijacked.canvas';
    frontmatter.TPSGCMFILEID = 'hijacked-id';
  }), true);

  assert.equal(harness.readContent(canvas), canvasDocument, 'legacy Canvas bytes must be untouched');
  assert.equal(harness.writeTargets.some((path) => path === canvas.path), false);
  const companionPath = `${FILE_PROPERTIES_ROOT}/Boards/Roadmap.canvas.md`;
  const companion = harness.vault.getAbstractFileByPath(companionPath);
  assert.ok(companion instanceof TFile);
  const raw = harness.readRaw(companion);
  assert.equal(raw[FILE_PROPERTY_KEYS.schema], 1);
  assert.match(raw[FILE_PROPERTY_KEYS.id], /^file_/u);
  assert.equal(raw[FILE_PROPERTY_KEYS.source], '[[Boards/Roadmap.canvas]]');
  assert.equal(raw[FILE_PROPERTY_KEYS.sourcePath], 'Boards/Roadmap.canvas');
  assert.equal(raw[FILE_PROPERTY_KEYS.sourceExtension], 'canvas');
  assert.match(raw[FILE_PROPERTY_KEYS.importedCanvasAt], /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(raw.priority, 'high');
  assert.equal(raw.status, 'legacy');
  assert.deepEqual(raw.tags, ['alpha']);
  assert.equal(raw.TPSGCMFILEID, undefined, 'reserved keys are protected case-insensitively');
  assert.equal(isFilePropertiesCompanionRecord(raw), true);
  assert.equal(isFilePropertiesCompanionRecord({ tpsGcmFileProperties: 1 }), false);
  assert.deepEqual(service.read(canvas), { status: 'legacy', priority: 'high', tags: ['alpha'] });
  assert.deepEqual(await service.getFrontmatterAsync(canvas), service.read(canvas));
  assert.equal(await service.process(canvas, () => {}), false, 'idempotent no-op writes stay no-op');

  const genericEvent = harness.workspaceEvents.find((event) => event.name === 'tps:gcm-file-properties-updated');
  assert.ok(genericEvent);
  assert.deepEqual(Object.keys(genericEvent.args[0]).sort(), [
    'action',
    'changedKeys',
    'itemId',
    'propertyFilePath',
    'sourcePluginId',
    'targetPath',
    'timestamp',
  ]);
  assert.equal(genericEvent.args[0].sourcePluginId, 'tps-global-context-menu');
  assert.equal(typeof genericEvent.args[0].timestamp, 'number');
  assert.doesNotMatch(JSON.stringify(genericEvent), /legacy|high|alpha/u, 'generic events must not leak property values');
  assert.deepEqual(harness.explicitActions.at(-1), {
    paths: [canvas.path],
    options: { sourcePluginId: 'tps-global-context-menu', source: 'file-properties' },
  });
  assert.ok(harness.workspaceEvents.some((event) => event.name === 'tps:gcm-canvas-properties-updated'));
});

test('source links safely escape special characters and orphaning removes the backlink-bearing value', async () => {
  const harness = createHarness();
  const source = harness.addFile('References/Plan #1^draft|final.pdf', 'special source bytes');
  const service = new FilePropertiesService(harness.plugin);

  await service.process(source, (frontmatter) => { frontmatter.status = 'active'; });
  const companion = service.getCompanionFile(source);
  assert.ok(companion instanceof TFile);
  const linked = harness.readRaw(companion)[FILE_PROPERTY_KEYS.source];
  assert.equal(linked, '[[References/Plan \\#1\\^draft\\|final.pdf]]');
  assert.ok(harness.generatedLinks.length > 0);
  assert.ok(
    harness.generatedLinks.every((path) => path === source.path),
    'live links are delegated to Obsidian link generation',
  );
  const generatedBeforeOrphan = harness.generatedLinks.length;

  harness.remove(source);
  await service.reconcileCompanions();
  const orphaned = harness.readRaw(companion);
  assert.equal(orphaned[FILE_PROPERTY_KEYS.sourceMissing], true);
  assert.equal(orphaned[FILE_PROPERTY_KEYS.source], undefined, 'orphaning cannot backlink to a same-path replacement');
  assert.equal(harness.generatedLinks.length, generatedBeforeOrphan, 'orphaning never synthesizes a replacement link');
  assert.equal(harness.readContent(source), 'special source bytes');

  const replacement = harness.addFile(source.path, 'replacement bytes');
  await service.relinkCompanion(companion, replacement);
  assert.equal(harness.readRaw(companion)[FILE_PROPERTY_KEYS.source], linked, 'explicit relink regenerates the safe source link');
});

test('concurrent operations create exactly one companion for every non-Markdown file type', async () => {
  const harness = createHarness();
  const service = new FilePropertiesService(harness.plugin);
  const sources = [
    harness.addFile('Files/Spec.pdf', '%PDF source bytes'),
    harness.addFile('Files/Cover.png', 'PNG source bytes'),
    harness.addFile('Files/Catalog.base', 'filters:\n  and: []'),
    harness.addFile('Files/Fixture.xyz', 'arbitrary source bytes'),
  ];
  const snapshots = new Map(sources.map((file) => [file, harness.readContent(file)]));

  for (const source of sources) {
    await Promise.all([
      service.process(source, (frontmatter) => { frontmatter.status = 'active'; }),
      service.process(source, (frontmatter) => { frontmatter.priority = 'medium'; }),
      service.addValuesToList([source], 'tags', ['one', 'two']),
    ]);
    assert.deepEqual(service.read(source), {
      status: 'active',
      priority: 'medium',
      tags: ['one', 'two'],
    });
    assert.equal(harness.readContent(source), snapshots.get(source));
    const expectedPath = `${FILE_PROPERTIES_ROOT}/${source.path}.md`;
    assert.ok(harness.vault.getAbstractFileByPath(expectedPath) instanceof TFile);
    assert.equal(harness.createTargets.filter((path) => path === expectedPath).length, 1);
  }

  assert.ok(harness.writeTargets.every((path) => path.endsWith('.md')));
  assert.deepEqual(await service.listKnownPropertyNames(), ['priority', 'status', 'tags']);
  assert.equal(isFilePropertiesCompanionPath(`${FILE_PROPERTIES_ROOT}/Files/Spec.pdf.md`), true);
  assert.equal(isFilePropertiesCompanionPath('Files/Spec.pdf'), false);
  for (const key of Object.values(FILE_PROPERTY_KEYS)) {
    assert.equal(RESERVED_FILE_PROPERTY_KEYS.has(key.toLowerCase()), true);
  }

  const video = harness.addFile('Files/Clip.mov', 'MOV source bytes');
  await service.initializeForConversion(video, { title: 'Clip', status: 'queued' });
  assert.deepEqual(service.read(video), { status: 'queued', title: 'Clip' });
  assert.equal(harness.readContent(video), 'MOV source bytes');

  const longName = `${'x'.repeat(225)}.pdf`;
  const longSource = harness.addFile(`Files/${longName}`, 'long-path source bytes');
  await service.process(longSource, (frontmatter) => { frontmatter.status = 'safe'; });
  const fallback = service.getCompanionFile(longSource);
  assert.ok(fallback.path.startsWith(`${FILE_PROPERTIES_BY_ID_ROOT}/`));
  assert.match(fallback.name, /^file_[a-zA-Z0-9_-]+\.md$/u);
  assert.equal(await service.process(longSource, () => {}), false);
  assert.equal(service.getCompanionFile(longSource), fallback, 'fallback resolution remains stable and idempotent');
  assert.equal(harness.readContent(longSource), 'long-path source bytes');
  harness.remove(longSource);
  await service.reconcileCompanions();
  await service.reconcileCompanions();
  assert.ok(harness.vault.getAbstractFileByPath(fallback.path) === fallback, 'orphan reconcile retains safe fallback path');
});

test('the entire managed catalog rejects non-Markdown sources and reconciliation reports them', async () => {
  const harness = createHarness();
  const nestedSource = harness.addFile(`${FILE_PROPERTIES_ROOT}/Imports/Unsafe.canvas`, 'catalog bytes');
  const service = new FilePropertiesService(harness.plugin);

  assert.equal(service.isPropertyTarget(nestedSource), false);
  assert.equal(service.isCanvasFile(nestedSource), false);
  assert.equal(await service.process(nestedSource, (frontmatter) => { frontmatter.status = 'unsafe'; }), false);
  assert.equal(service.getCompanionFile(nestedSource), null);
  assert.deepEqual(harness.createTargets, [], 'catalog entries never create companions of companions');
  assert.equal(harness.readContent(nestedSource), 'catalog bytes');

  const report = await service.reconcileCompanions();
  assert.ok(report.collisions.some((message) => (
    message.includes('Non-Markdown file inside the managed GCM file-property catalog')
    && message.includes(nestedSource.path)
  )));
});

test('moved companions and direct YAML edits refresh sync reads while duplicate mappings fail closed', async () => {
  const harness = createHarness();
  const source = harness.addFile('Media/Photo.jpg', 'JPEG bytes');
  const service = new FilePropertiesService(harness.plugin);
  await service.process(source, (frontmatter) => { frontmatter.status = 'new'; });
  const expectedPath = service.getCompanionPath(source);
  const companion = harness.vault.getAbstractFileByPath(expectedPath);
  const fileId = harness.readRaw(companion)[FILE_PROPERTY_KEYS.id];

  await harness.rename(companion, 'Moved/Photo properties.md');
  await service.handleCompanionRename(companion, expectedPath);
  assert.equal(service.isCompanionFile(companion), true, 'marker identifies moved companions outside the root');
  assert.equal(service.getCompanionFile(source), companion);
  assert.equal(service.getSourceFileForCompanion(companion), source);

  const edited = reservedRecord(source.path, fileId, { status: 'edited', rating: 5 });
  harness.directEditCompanion(companion, edited);
  await service.handleCompanionMetadataChanged(companion);
  assert.deepEqual(service.read(source), { rating: 5, status: 'edited' });

  const report = await service.reconcileCompanions();
  assert.equal(report.moved, 1);
  assert.equal(companion.path, expectedPath);

  const duplicate = harness.addCompanion('Moved/Duplicate properties.md', reservedRecord(
    source.path,
    'file_duplicate',
    { status: 'conflict' },
  ));
  await service.setup();
  assert.deepEqual(service.read(source), {}, 'duplicate source mappings must make sync reads fail closed');
  assert.equal(service.getSourceFileForCompanion(companion), null);
  assert.equal(service.getSourceFileForCompanion(duplicate), null);
  await assert.rejects(
    service.process(source, (frontmatter) => { frontmatter.status = 'unsafe'; }),
    /Multiple GCM file-property companions/u,
  );

  harness.remove(duplicate);
  service.forgetCompanion(duplicate.path);
  await service.setup();
  assert.deepEqual(service.read(source), { rating: 5, status: 'edited' });
});

test('duplicate stable IDs across different sources are ambiguous and block source routing and writes', async () => {
  const harness = createHarness();
  const first = harness.addFile('Files/One.pdf', 'one');
  const second = harness.addFile('Files/Two.pdf', 'two');
  const sharedId = 'file_shared';
  const firstCompanion = harness.addCompanion(
    `${FILE_PROPERTIES_ROOT}/${first.path}.md`,
    reservedRecord(first.path, sharedId, { status: 'one' }),
  );
  const secondCompanion = harness.addCompanion(
    `${FILE_PROPERTIES_ROOT}/${second.path}.md`,
    reservedRecord(second.path, sharedId, { status: 'two' }),
  );
  const service = new FilePropertiesService(harness.plugin);
  await service.setup();

  assert.deepEqual(service.read(first), {});
  assert.deepEqual(service.read(second), {});
  assert.equal(service.getSourceFileForCompanion(firstCompanion), null);
  assert.equal(service.getSourceFileForCompanion(secondCompanion), null);
  await assert.rejects(service.process(first, (frontmatter) => { frontmatter.status = 'changed'; }), /duplicated or ambiguous/u);
  assert.equal(harness.readContent(first), 'one');
  assert.equal(harness.readContent(second), 'two');
});

test('direct companion edits emit legacy Canvas values only for a unique live active mapping', async () => {
  const harness = createHarness();
  const callbackResults = [];
  const canvas = harness.addFile('Boards/Events.canvas', JSON.stringify({ nodes: [], edges: [] }));
  const service = new FilePropertiesService(harness.plugin, {
    onChanged: (result) => callbackResults.push(result),
  });
  await service.process(canvas, (frontmatter) => { frontmatter.status = 'active'; });
  const companion = service.getCompanionFile(canvas);
  const raw = harness.readRaw(companion);
  const initialLegacyCount = harness.workspaceEvents
    .filter((event) => event.name === 'tps:gcm-canvas-properties-updated').length;

  harness.directEditCompanion(companion, {
    ...raw,
    [FILE_PROPERTY_KEYS.sourceMissing]: true,
    status: 'orphan-secret',
  });
  await service.handleCompanionMetadataChanged(companion);
  assert.equal(
    harness.workspaceEvents.filter((event) => event.name === 'tps:gcm-canvas-properties-updated').length,
    initialLegacyCount,
    'missing mappings never emit the value-bearing compatibility event',
  );
  assert.equal(callbackResults.at(-1).sourceFile, null);
  assert.deepEqual(callbackResults.at(-1).frontmatter, {});
  const missingGeneric = harness.workspaceEvents.at(-1);
  assert.equal(missingGeneric.name, 'tps:gcm-file-properties-updated');
  assert.doesNotMatch(JSON.stringify(missingGeneric), /orphan-secret/u);

  const activeRaw = {
    ...harness.readRaw(companion),
    [FILE_PROPERTY_KEYS.sourceMissing]: undefined,
    status: 'active-again',
  };
  delete activeRaw[FILE_PROPERTY_KEYS.sourceMissing];
  harness.directEditCompanion(companion, activeRaw);
  await service.handleCompanionMetadataChanged(companion);
  const restoredLegacyCount = harness.workspaceEvents
    .filter((event) => event.name === 'tps:gcm-canvas-properties-updated').length;
  assert.equal(restoredLegacyCount, initialLegacyCount + 1, 'a unique active Canvas mapping emits compatibility values');

  const duplicateSource = harness.addCompanion(
    'Moved/Duplicate Canvas properties.md',
    reservedRecord(canvas.path, 'file_duplicate_source', { status: 'duplicate-source-secret' }),
  );
  await service.handleCompanionMetadataChanged(duplicateSource);
  assert.equal(
    harness.workspaceEvents.filter((event) => event.name === 'tps:gcm-canvas-properties-updated').length,
    restoredLegacyCount,
    'duplicate source mappings fail closed',
  );
  assert.equal(callbackResults.at(-1).sourceFile, null);
  assert.deepEqual(callbackResults.at(-1).frontmatter, {});
  assert.doesNotMatch(JSON.stringify(harness.workspaceEvents.at(-1)), /duplicate-source-secret/u);

  harness.remove(duplicateSource);
  service.forgetCompanion(duplicateSource);
  const otherSource = harness.addFile('Files/Shared-id.pdf', 'other source');
  const duplicateId = harness.addCompanion(
    'Moved/Duplicate stable ID.md',
    reservedRecord(otherSource.path, raw[FILE_PROPERTY_KEYS.id], { status: 'duplicate-id-secret' }),
  );
  await service.handleCompanionMetadataChanged(duplicateId);
  const editedWithDuplicateId = { ...harness.readRaw(companion), status: 'ambiguous-id-secret' };
  harness.directEditCompanion(companion, editedWithDuplicateId);
  await service.handleCompanionMetadataChanged(companion);
  assert.equal(
    harness.workspaceEvents.filter((event) => event.name === 'tps:gcm-canvas-properties-updated').length,
    restoredLegacyCount,
    'duplicate stable IDs fail closed even when the source path itself is unique',
  );
  assert.equal(callbackResults.at(-1).sourceFile, null);
  assert.deepEqual(callbackResults.at(-1).frontmatter, {});
  assert.doesNotMatch(JSON.stringify(harness.workspaceEvents.at(-1)), /ambiguous-id-secret/u);
});

test('direct source-path edits invalidate old and new sources while malformed moved records invalidate the prior source', async () => {
  const harness = createHarness();
  const first = harness.addFile('Boards/Before.canvas', JSON.stringify({ nodes: [], edges: [] }));
  const second = harness.addFile('Boards/After.canvas', JSON.stringify({ nodes: [], edges: [] }));
  const service = new FilePropertiesService(harness.plugin);
  await service.process(first, (frontmatter) => { frontmatter.status = 'sensitive-value'; });
  const companion = service.getCompanionFile(first);
  const raw = harness.readRaw(companion);
  const genericBeforePathEdit = harness.workspaceEvents
    .filter((event) => event.name === 'tps:gcm-file-properties-updated').length;
  const legacyBeforePathEdit = harness.workspaceEvents
    .filter((event) => event.name === 'tps:gcm-canvas-properties-updated').length;

  harness.directEditCompanion(companion, {
    ...raw,
    [FILE_PROPERTY_KEYS.source]: `[[${second.path}]]`,
    [FILE_PROPERTY_KEYS.sourcePath]: second.path,
    [FILE_PROPERTY_KEYS.sourceExtension]: 'canvas',
  });
  await service.handleCompanionMetadataChanged(companion);
  const pathEditGenerics = harness.workspaceEvents
    .filter((event) => event.name === 'tps:gcm-file-properties-updated')
    .slice(genericBeforePathEdit);
  assert.deepEqual(
    pathEditGenerics.map((event) => [event.args[0].action, event.args[0].targetPath]),
    [['removed', first.path], ['updated', second.path]],
    'direct remapping invalidates both logical source identities',
  );
  assert.doesNotMatch(JSON.stringify(pathEditGenerics), /sensitive-value/u);
  assert.deepEqual(service.read(first), {});
  assert.deepEqual(service.read(second), { status: 'sensitive-value' });
  assert.equal(
    harness.workspaceEvents.filter((event) => event.name === 'tps:gcm-canvas-properties-updated').length,
    legacyBeforePathEdit + 1,
    'only the new unique active Canvas source receives compatibility values',
  );

  const oldCompanionPath = companion.path;
  await harness.rename(companion, 'Moved/Directly edited properties.md');
  await service.handleCompanionRename(companion, oldCompanionPath);
  const genericBeforeMalformed = harness.workspaceEvents
    .filter((event) => event.name === 'tps:gcm-file-properties-updated').length;
  const legacyBeforeMalformed = harness.workspaceEvents
    .filter((event) => event.name === 'tps:gcm-canvas-properties-updated').length;
  harness.directEditCompanion(companion, { status: 'malformed-secret' });
  assert.equal(await service.handleCompanionMetadataChanged(companion), true);
  const malformedGenerics = harness.workspaceEvents
    .filter((event) => event.name === 'tps:gcm-file-properties-updated')
    .slice(genericBeforeMalformed);
  assert.deepEqual(
    malformedGenerics.map((event) => [event.args[0].action, event.args[0].targetPath]),
    [['removed', second.path]],
    'a moved companion that loses its marker still invalidates its prior source',
  );
  assert.doesNotMatch(JSON.stringify(malformedGenerics), /malformed-secret|sensitive-value/u);
  assert.equal(
    harness.workspaceEvents.filter((event) => event.name === 'tps:gcm-canvas-properties-updated').length,
    legacyBeforeMalformed,
  );
  assert.deepEqual(service.read(second), {});
});

test('companion extension changes invalidate routing without restoring the filename', async () => {
  const harness = createHarness();
  const source = harness.addFile('Files/Extension failure.pdf', 'source bytes');
  const service = new FilePropertiesService(harness.plugin);
  await service.process(source, (frontmatter) => { frontmatter.status = 'do-not-leak'; });
  const companion = service.getCompanionFile(source);
  const markdownPath = companion.path;
  await harness.rename(companion, markdownPath.replace(/\.md$/u, '.txt'));
  harness.failNextRename('Synthetic extension restore failure');

  await service.handleCompanionRename(companion, markdownPath);
  assert.equal(companion.extension, 'txt');
  assert.equal(service.getCompanionFile(source), null);
  assert.deepEqual(service.read(source), {});
  assert.equal(harness.readContent(source), 'source bytes');
  const invalidation = harness.workspaceEvents.at(-1);
  assert.equal(invalidation.name, 'tps:gcm-file-properties-updated');
  assert.equal(invalidation.args[0].action, 'removed');
  assert.equal(invalidation.args[0].targetPath, source.path);
  assert.doesNotMatch(JSON.stringify(invalidation), /do-not-leak/u);
  const report = await service.reconcileCompanions();
  assert.ok(report.collisions.some((message) => message.includes(companion.path)));
});

test('deleting a moved companion emits one redacted removal invalidation without recreating storage', async () => {
  const harness = createHarness();
  const canvasBytes = JSON.stringify({ nodes: [], edges: [] });
  const canvas = harness.addFile('Boards/Removed.canvas', canvasBytes);
  const service = new FilePropertiesService(harness.plugin);
  await service.process(canvas, (frontmatter) => { frontmatter.status = 'private-value'; });
  const companion = service.getCompanionFile(canvas);
  const originalPath = companion.path;
  const itemId = harness.readRaw(companion)[FILE_PROPERTY_KEYS.id];
  await harness.rename(companion, 'Moved/Removed Canvas properties.md');
  await service.handleCompanionRename(companion, originalPath);
  const legacyBeforeDelete = harness.workspaceEvents
    .filter((event) => event.name === 'tps:gcm-canvas-properties-updated').length;
  const createCount = harness.createTargets.length;

  harness.remove(companion);
  assert.equal(await service.handleCompanionDelete(companion), true);
  assert.equal(service.getCompanionFile(canvas), null);
  assert.equal(service.getSourceFileForCompanion(companion), null);
  assert.equal(harness.createTargets.length, createCount, 'deletion handling never recreates the companion');
  assert.equal(harness.readContent(canvas), canvasBytes);
  assert.equal(
    harness.workspaceEvents.filter((event) => event.name === 'tps:gcm-canvas-properties-updated').length,
    legacyBeforeDelete,
    'companion removal never emits user values through the legacy event',
  );
  const removal = harness.workspaceEvents.at(-1);
  assert.equal(removal.name, 'tps:gcm-file-properties-updated');
  assert.equal(removal.args[0].action, 'removed');
  assert.equal(removal.args[0].targetPath, canvas.path);
  assert.equal(removal.args[0].propertyFilePath, companion.path);
  assert.equal(removal.args[0].itemId, itemId);
  assert.deepEqual(removal.args[0].changedKeys, []);
  assert.doesNotMatch(JSON.stringify(removal), /private-value/u);
  assert.deepEqual(harness.filesUpdated.at(-1), {
    paths: [canvas.path, companion.path],
    options: { sourcePluginId: 'tps-global-context-menu' },
  });
});

test('vault deletion wiring delegates companion invalidation to the service', () => {
  const source = readFileSync(new URL('../src/events/register-events.ts', import.meta.url), 'utf8');
  assert.match(source, /isCompanionRename\(file, oldPath\)/u);
  assert.doesNotMatch(source, /extension was restored/);
  assert.match(source, /deletedCompanion[\s\S]{0,300}handleCompanionDelete\(file\)/u);
  assert.doesNotMatch(source, /deletedCompanion[\s\S]{0,200}forgetCompanion/u);
  // Canvas invalidation dispatch in both modes is exercised by the real
  // registered callbacks in test-completed-date-event-batching.mjs.
  assert.doesNotMatch(source, /notebookNavigatorRuleService\.scheduleApply/u);  assert.doesNotMatch(source, /handlePendingMarkdownTargetRename|handleSourceCreate|handleSourceRename|handleSourceDelete|handleSourceFolder/);
  assert.doesNotMatch(source, /invalidatePendingMarkdownTarget/);
});

test('three-way companion writes preserve unrelated direct Base edits and fail closed on same-key conflicts', async () => {
  const harness = createHarness();
  const source = harness.addFile('Files/Concurrent.pdf', 'source bytes');
  const service = new FilePropertiesService(harness.plugin);
  await service.process(source, (frontmatter) => { frontmatter.status = 'active'; });
  const companion = service.getCompanionFile(source);

  harness.injectConcurrentFrontmatterEdit((file) => {
    const live = harness.readRaw(file);
    live.baseEdited = 'preserve me';
    live.emptyValue = null;
    live.emptyList = [];
    harness.directEditCompanion(file, live);
  });
  await service.process(source, (frontmatter) => { frontmatter.status = 'done'; });
  assert.deepEqual(service.read(source), {
    status: 'done',
    baseEdited: 'preserve me',
    emptyList: [],
    emptyValue: null,
  });

  harness.injectConcurrentFrontmatterEdit((file) => {
    const live = harness.readRaw(file);
    live.status = 'edited-directly';
    harness.directEditCompanion(file, live);
  });
  await assert.rejects(
    service.process(source, (frontmatter) => { frontmatter.status = 'queued'; }),
    /Concurrent direct edit conflicts/u,
  );
  assert.deepEqual(harness.readRaw(companion).status, 'edited-directly');
  await service.handleCompanionMetadataChanged(companion);
  assert.deepEqual(service.read(source), {
    status: 'edited-directly',
    baseEdited: 'preserve me',
    emptyList: [],
    emptyValue: null,
  });

  harness.injectConcurrentFrontmatterEdit((file) => {
    const live = harness.readRaw(file);
    live.baseOnly = 42;
    harness.directEditCompanion(file, live);
  });
  await service.deleteKeys([source], ['status']);
  assert.deepEqual(service.read(source), {
    baseEdited: 'preserve me',
    baseOnly: 42,
    emptyList: [],
    emptyValue: null,
  });
  assert.equal(harness.readContent(source), 'source bytes');
});

test('starting fresh preserves exact-path history under a tombstone and creates an independent identity', async () => {
  const harness = createHarness();
  const source = harness.addFile('Assets/Reused.pdf', 'first source');
  const service = new FilePropertiesService(harness.plugin);
  await service.process(source, (frontmatter) => {
    frontmatter.status = 'historical';
    frontmatter.priority = 'high';
  });
  const retained = service.getCompanionFile(source);
  const retainedRawBefore = harness.readRaw(retained);
  const retainedId = retainedRawBefore[FILE_PROPERTY_KEYS.id];
  const retainedPath = retained.path;

  harness.remove(source);
  await service.reconcileCompanions();
  const replacement = harness.addFile(source.path, 'second source');
  assert.equal(service.getRelinkCandidate(replacement), retained);

  const fresh = await service.startFreshCompanion(replacement);
  const retainedRaw = harness.readRaw(retained);
  const freshRaw = harness.readRaw(fresh);
  assert.equal(retained.path, retainedPath);
  assert.equal(retainedRaw[FILE_PROPERTY_KEYS.sourcePath], replacement.path);
  assert.equal(retainedRaw[FILE_PROPERTY_KEYS.sourceMissing], true);
  assert.match(retainedRaw[FILE_PROPERTY_KEYS.tombstonedAt], /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(retainedRaw[FILE_PROPERTY_KEYS.id], retainedId);
  assert.equal(retainedRaw.status, 'historical');
  assert.equal(retainedRaw.priority, 'high');
  assert.notEqual(fresh, retained);
  assert.notEqual(freshRaw[FILE_PROPERTY_KEYS.id], retainedId);
  assert.equal(freshRaw[FILE_PROPERTY_KEYS.sourceMissing], undefined);
  assert.equal(freshRaw[FILE_PROPERTY_KEYS.tombstonedAt], undefined);
  assert.deepEqual(service.read(replacement), {});
  assert.equal(service.getRelinkCandidate(replacement), null);
  assert.equal(service.hasRelinkCandidates(replacement), false);

  await service.process(replacement, (frontmatter) => {
    frontmatter.status = 'current';
    frontmatter.owner = 'replacement';
  });
  assert.deepEqual(service.read(replacement), { status: 'current', owner: 'replacement' });
  assert.equal(harness.readRaw(retained).status, 'historical');
  assert.equal(harness.readRaw(retained).owner, undefined);
  assert.equal(harness.readContent(replacement), 'second source');

  const report = await service.reconcileCompanions();
  assert.equal(report.collisions.length, 0);
  assert.equal(harness.readRaw(retained)[FILE_PROPERTY_KEYS.tombstonedAt], retainedRaw[FILE_PROPERTY_KEYS.tombstonedAt]);
  assert.deepEqual(service.read(replacement), { status: 'current', owner: 'replacement' });
});

test('starting fresh restores retained history when the independent companion cannot be created', async () => {
  const harness = createHarness();
  const original = harness.addFile('Assets/Fresh failure.pdf', 'original');
  const service = new FilePropertiesService(harness.plugin);
  await service.process(original, (frontmatter) => {
    frontmatter.status = 'historical';
    frontmatter.priority = 'high';
  });
  const retained = service.getCompanionFile(original);
  const retainedId = harness.readRaw(retained)[FILE_PROPERTY_KEYS.id];

  harness.remove(original);
  await service.reconcileCompanions();
  const replacement = harness.addFile(original.path, 'replacement');
  const retainedBefore = harness.readRaw(retained);
  harness.failNextCreate('Synthetic independent companion create failure');

  await assert.rejects(
    service.startFreshCompanion(replacement),
    /Synthetic independent companion create failure/u,
  );
  assert.deepEqual(harness.readRaw(retained), retainedBefore, 'failed start-fresh restores the exact retained record');
  assert.equal(harness.readRaw(retained)[FILE_PROPERTY_KEYS.id], retainedId);
  assert.equal(harness.readRaw(retained)[FILE_PROPERTY_KEYS.tombstonedAt], undefined);
  assert.equal(harness.readRaw(retained)[FILE_PROPERTY_KEYS.sourceMissing], true);
  assert.equal(harness.readRaw(retained)[FILE_PROPERTY_KEYS.source], undefined);
  assert.equal(service.getRelinkCandidate(replacement), retained);
  assert.deepEqual(service.read(replacement), {});
});

test('a deterministic-path collision falls back by ID without overwriting either file', async () => {
  const harness = createHarness();
  const source = harness.addFile('Files/Blocked.pdf', 'source remains intact');
  const collisionPath = `${FILE_PROPERTIES_ROOT}/${source.path}.md`;
  const collision = harness.addFile(collisionPath, 'ordinary Markdown that belongs to the user');
  const service = new FilePropertiesService(harness.plugin);

  assert.deepEqual(await service.getFrontmatterAsync(source), {});
  await service.process(source, (frontmatter) => { frontmatter.status = 'safe'; });
  assert.equal(harness.readContent(source), 'source remains intact');
  assert.equal(harness.readContent(collision), 'ordinary Markdown that belongs to the user');
  const companion = service.getCompanionFile(source);
  assert.ok(companion.path.startsWith(`${FILE_PROPERTIES_BY_ID_ROOT}/`));
  assert.deepEqual(service.read(source), { status: 'safe' });
});

test('a unique moved companion remains usable when its mirrored location is occupied', async () => {
  const harness = createHarness();
  const source = harness.addFile('Files/Moved.pdf', 'source bytes');
  const moved = harness.addCompanion(
    'Custom/Moved file properties.md',
    reservedRecord(source.path, 'file_moved', { status: 'kept' }),
  );
  const collision = harness.addFile(
    `${FILE_PROPERTIES_ROOT}/${source.path}.md`,
    'ordinary collision',
  );
  const service = new FilePropertiesService(harness.plugin);
  await service.setup();

  assert.equal(service.getCompanionFile(source), moved);
  assert.deepEqual(service.read(source), { status: 'kept' });
  await service.process(source, (frontmatter) => { frontmatter.status = 'updated'; });
  assert.equal(service.getCompanionFile(source), moved);
  assert.equal(moved.path, 'Custom/Moved file properties.md');
  assert.deepEqual(service.read(source), { status: 'updated' });
  assert.equal(harness.readContent(collision), 'ordinary collision');
});

test('mutation provenance suppresses automation explicit actions and bulk failures stay visible and structured', async () => {
  const harness = createHarness();
  const healthy = harness.addFile('Files/Healthy.pdf', 'healthy');
  const conflicted = harness.addFile('Files/Conflicted.pdf', 'conflicted');
  harness.addCompanion(
    `${FILE_PROPERTIES_ROOT}/Files/Conflicted one.pdf.md`,
    reservedRecord(conflicted.path, 'file_conflict_one', { status: 'one' }),
  );
  harness.addCompanion(
    `${FILE_PROPERTIES_ROOT}/Files/Conflicted two.pdf.md`,
    reservedRecord(conflicted.path, 'file_conflict_two', { status: 'two' }),
  );
  const service = new FilePropertiesService(harness.plugin);

  await service.process(healthy, (frontmatter) => { frontmatter.status = 'direct'; });
  assert.equal(harness.explicitActions.length, 1, 'legacy two-argument direct calls remain user-explicit');

  await service.process(healthy, (frontmatter) => { frontmatter.status = 'background'; }, {
    kind: 'automation',
    sourcePluginId: 'tps-notebook-navigator',
    surface: 'notebook-navigator-rules',
  });
  assert.equal(harness.explicitActions.length, 1, 'automation never emits an explicit action');
  assert.deepEqual(harness.filesUpdated.at(-1).options, { sourcePluginId: 'tps-notebook-navigator' });
  assert.equal(
    harness.workspaceEvents.filter((event) => event.name === 'tps:gcm-file-properties-updated').at(-1).args[0].surface,
    'notebook-navigator-rules',
  );

  const detailed = await service.processMany([healthy, conflicted], (frontmatter) => {
    frontmatter.priority = 'high';
  });
  assert.deepEqual(detailed.updated, [healthy]);
  assert.equal(detailed.failures.length, 1);
  assert.equal(detailed.failures[0].path, conflicted.path);
  assert.match(detailed.failures[0].message, /Multiple GCM file-property companions/u);
  assert.match(harness.notices.at(-1).message, /1 of 2 files/u);

  const noticesBeforeAutomation = harness.notices.length;
  const automated = await service.processMany([healthy, conflicted], (frontmatter) => {
    frontmatter.owner = 'rule';
  }, { kind: 'automation', sourcePluginId: 'tps-notebook-navigator' });
  assert.deepEqual(automated.updated, [healthy]);
  assert.equal(automated.failures.length, 1);
  assert.equal(harness.notices.length, noticesBeforeAutomation, 'background failures do not raise direct-user Notices');

  const legacyReturn = await service.updateValues([healthy, conflicted], { rating: 5 });
  assert.deepEqual(legacyReturn, [healthy], 'legacy bulk APIs preserve successful-file return values');
});

test('an asynchronous consumer mutator only queues its own source', async () => {
  const harness = createHarness();
  const first = harness.addFile('Files/Slow.pdf', 'slow');
  const second = harness.addFile('Files/Fast.pdf', 'fast');
  const service = new FilePropertiesService(harness.plugin);
  let releaseSlow;
  let signalEntered;
  const entered = new Promise((resolve) => { signalEntered = resolve; });
  const hold = new Promise((resolve) => { releaseSlow = resolve; });

  const slow = service.process(first, async (frontmatter) => {
    signalEntered();
    await hold;
    frontmatter.status = 'slow-done';
  });
  await entered;
  assert.equal(await service.process(second, (frontmatter) => { frontmatter.status = 'fast-done'; }), true);
  assert.deepEqual(service.read(second), { status: 'fast-done' });
  releaseSlow();
  await slow;
  assert.deepEqual(service.read(first), { status: 'slow-done' });
});

test('first mutation authoritatively discovers a moved companion after provisional setup', async () => {
  const harness = createHarness();
  const source = harness.addFile('Files/Deferred.pdf', 'source');
  harness.addCompanion('Notes/Ordinary.md', { title: 'ordinary note', status: 'draft' });
  const moved = harness.addCompanion(
    'Moved/Deferred properties.md',
    reservedRecord(source.path, 'file_deferred', { status: 'retained' }),
  );
  harness.suppressMetadata(moved);
  harness.setStaleCachedRead(moved, '# stale display cache without a companion marker');
  const service = new FilePropertiesService(harness.plugin);

  await service.setup();
  assert.equal(service.getCompanionFile(source), null, 'layout-ready setup is provisional');
  await service.process(source, (frontmatter) => { frontmatter.priority = 'high'; });
  assert.equal(service.getCompanionFile(source), moved);
  assert.deepEqual(service.read(source), { status: 'retained', priority: 'high' });
  assert.equal(harness.createTargets.length, 0, 'authoritative fallback prevents a duplicate companion');
  assert.equal(service.cachedRawByCompanionPath.size, 1, 'ordinary Markdown frontmatter is not retained by the companion cache');
});

test('authoritative async reads discover moved companions after provisional setup', async () => {
  const harness = createHarness();
  const source = harness.addFile('Files/Early read.pdf', 'source');
  const moved = harness.addCompanion(
    'Moved/Early read properties.md',
    reservedRecord(source.path, 'file_early_read', { status: 'available' }),
  );
  harness.suppressMetadata(moved);
  harness.setStaleCachedRead(moved, '# stale display cache');
  const service = new FilePropertiesService(harness.plugin);

  await service.setup();
  assert.deepEqual(service.read(source), {}, 'sync cache-only reads remain provisional');
  assert.deepEqual(await service.getFrontmatterAsync(source), { status: 'available' });
  assert.equal(service.getCompanionFile(source), moved);
});

test('reconciliation uses authoritative markers and continues after a per-record write failure', async () => {
  const harness = createHarness();
  const first = harness.addFile('Files/Reconcile first.pdf', 'first');
  const second = harness.addFile('Files/Reconcile second.pdf', 'second');
  const firstCompanion = harness.addCompanion(
    'Moved/Reconcile first properties.md',
    reservedRecord(first.path, 'file_reconcile_first', { status: 'first' }, {
      [FILE_PROPERTY_KEYS.source]: '[[stale first link]]',
    }),
  );
  const secondCompanion = harness.addCompanion(
    'Moved/Reconcile second properties.md',
    reservedRecord(second.path, 'file_reconcile_second', { status: 'second' }, {
      [FILE_PROPERTY_KEYS.source]: '[[stale second link]]',
    }),
  );
  harness.suppressMetadata(firstCompanion);
  harness.suppressMetadata(secondCompanion);
  harness.setStaleCachedRead(firstCompanion, '# stale first display cache');
  harness.setStaleCachedRead(secondCompanion, '# stale second display cache');
  const service = new FilePropertiesService(harness.plugin);
  await service.setup();
  harness.injectConcurrentFrontmatterEdit(() => {
    throw new Error('Synthetic first reconcile write failure');
  });

  const report = await service.reconcileCompanions();
  assert.equal(report.scanned, 2);
  assert.equal(report.updated, 1, 'the second record still repairs after the first write fails');
  assert.ok(report.collisions.some((message) => /Synthetic first reconcile write failure/u.test(message)));
  assert.equal(
    parseCompanionContent(harness.readContent(firstCompanion))[FILE_PROPERTY_KEYS.source],
    '[[stale first link]]',
  );
  assert.equal(harness.readRaw(secondCompanion)[FILE_PROPERTY_KEYS.source], `[[${second.path}]]`);
  assert.deepEqual(service.read(second), { status: 'second' });
});

test('Canvas compatibility reads legacy cache only without an active, retained, or ambiguous mapping', async () => {
  const harness = createHarness();
  const active = harness.addFile('Boards/Active.canvas', '{}');
  const legacy = harness.addFile('Boards/Legacy.canvas', '{}');
  const retained = harness.addFile('Boards/Retained.canvas', '{}');
  const ambiguous = harness.addFile('Boards/Ambiguous.canvas', '{}');
  const nonCanvas = harness.addFile('Boards/Other.pdf', 'pdf');
  harness.setMetadataFrontmatter(active, { status: 'must-not-win' });
  harness.setMetadataFrontmatter(legacy, { status: 'legacy', tags: ['#One'], tpsGcmFileId: 'blocked' });
  harness.setMetadataFrontmatter(retained, { status: 'must-not-return' });
  harness.setMetadataFrontmatter(ambiguous, { status: 'must-not-return' });
  harness.addCompanion(`${FILE_PROPERTIES_ROOT}/${active.path}.md`, reservedRecord(active.path, 'file_active'));
  harness.addCompanion(`${FILE_PROPERTIES_ROOT}/${retained.path}.md`, reservedRecord(
    retained.path,
    'file_retained',
    { prior: 'value' },
    { [FILE_PROPERTY_KEYS.sourceMissing]: true },
  ));
  harness.addCompanion(`${FILE_PROPERTIES_ROOT}/Ambiguous one.canvas.md`, reservedRecord(ambiguous.path, 'file_ambiguous_one', { one: true }));
  harness.addCompanion(`${FILE_PROPERTIES_ROOT}/Ambiguous two.canvas.md`, reservedRecord(ambiguous.path, 'file_ambiguous_two', { two: true }));
  const service = new FilePropertiesService(harness.plugin);
  await service.setup();

  assert.deepEqual(service.readCanvasCompatibility(active), {}, 'active empty companion wins over legacy cache');
  assert.deepEqual(service.readCanvasCompatibility(legacy), { status: 'legacy', tags: ['one'] });
  assert.deepEqual(service.readCanvasCompatibility(retained), {});
  assert.deepEqual(service.readCanvasCompatibility(ambiguous), {});
  assert.deepEqual(service.readCanvasCompatibility(nonCanvas), {});
  assert.deepEqual(service.read(legacy), { status: 'legacy', tags: ['one'] }, 'generic sync consumers receive the safe cached Canvas fallback');
});

test('known property names include only unique live active records', async () => {
  const harness = createHarness();
  const active = harness.addFile('Files/Names Active.pdf', 'active');
  const missing = harness.addFile('Files/Names Missing.pdf', 'missing');
  const ambiguous = harness.addFile('Files/Names Ambiguous.pdf', 'ambiguous');
  harness.addCompanion(`${FILE_PROPERTIES_ROOT}/${active.path}.md`, reservedRecord(active.path, 'file_names_active', { activeName: true }));
  harness.addCompanion(`${FILE_PROPERTIES_ROOT}/${missing.path}.md`, reservedRecord(
    missing.path,
    'file_names_missing',
    { orphanOnly: true },
    { [FILE_PROPERTY_KEYS.sourceMissing]: true },
  ));
  harness.addCompanion(`${FILE_PROPERTIES_ROOT}/Names ambiguous one.md`, reservedRecord(ambiguous.path, 'file_names_one', { ambiguousOnly: true }));
  harness.addCompanion(`${FILE_PROPERTIES_ROOT}/Names ambiguous two.md`, reservedRecord(ambiguous.path, 'file_names_two', { ambiguousOnly: true }));
  const service = new FilePropertiesService(harness.plugin);
  await service.setup();
  assert.deepEqual(await service.listKnownPropertyNames(), ['activeName']);
});

function countFolderDiscovery(harness) {
  const original = harness.vault.getMarkdownFiles;
  let scans = 0;
  harness.vault.getMarkdownFiles = function (...args) {
    scans += 1;
    return original.apply(this, args);
  };
  return () => scans;
}


test('automatic companion maintenance implementations and transient rename state are deleted', () => {
  const source = readFileSync(new URL('../src/services/file-properties-service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /handleSourceCreate|handleSourceRename|handleSourceDelete|handleSourceFolderRename|handleSourceFolderDelete|handlePendingMarkdownTargetRename|captureSourceRenameCompanion|collectCompanionRecordsUnderFolder|pendingMarkdownTargetsByPath/);
});
