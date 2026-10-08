import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

async function loadService() {
  const result = await build({
    stdin: {
      contents: `
        export { ParentLinkResolutionService } from './src/services/parent-link-resolution-service.ts';
        export { OverlayRenderingService } from './src/services/overlay-rendering-service.ts';
        export { FilePropertiesService } from './src/services/file-properties-service.ts';
        export { TFile, TFolder } from 'obsidian';
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      sourcefile: 'parent-relationship-index-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'parent-relationship-index-stubs',
      setup(context) {
        context.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'test-stub' }));
        context.onResolve({ filter: /^\.\.\/logger$/u }, () => ({ path: 'logger', namespace: 'test-stub' }));
        context.onLoad({ filter: /.*/u, namespace: 'test-stub' }, (args) => ({
          loader: 'js',
          contents: args.path === 'logger'
            ? 'export const warn = () => {}; export const perf = () => {}; export const error = (...args) => (globalThis.__gcmParentIndexErrors ||= []).push(args); export const taskTrace = () => {};'
            : `
              export class Component {}
              export class Notice {}
              export class TFile {
                constructor(path) { this.setPath(path); }
                setPath(path) {
                  this.path = path;
                  this.name = path.split('/').pop();
                  this.extension = this.name.includes('.') ? this.name.split('.').pop().toLowerCase() : '';
                  this.basename = this.name.replace(/\\.[^.]+$/u, '');
                }
              }
              export class TFolder { constructor(path) { this.path = path; } }
              export const normalizePath = (path) => String(path || '').replace(/^\\/+|\\/+$/gu, '');
              export const parseYaml = (value) => JSON.parse(value || '{}');
              export const stringifyYaml = (value) => JSON.stringify(value);
            `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const modulePromise = loadService();
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function loadPersistentLookupHarness() {
  const sourcePath = fileURLToPath(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const tree = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const method = (name) => {
    let found = null;
    const visit = (node) => {
      if (ts.isMethodDeclaration(node) && node.name?.getText(tree) === name) found = node.getText(tree);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.ok(found, `${name} must exist in the real persistent menu manager`);
    return found;
  };
  const virtual = `
    export class PersistentLookupHarness {
      constructor(plugin) { this.plugin = plugin; }
      ${method('resolveChildFiles')}
      ${method('getParentChildRelationshipPaths')}
      children(file) { return this.resolveChildFiles(file); }
      relationshipPaths(file) { return this.getParentChildRelationshipPaths(file, []); }
    }
  `;
  const output = ts.transpileModule(virtual, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const persistentHarnessPromise = loadPersistentLookupHarness();

test('unmounted metadata bursts schedule no overlay timer or render; mounted consumers still refresh', async () => {
  const { OverlayRenderingService, TFile } = await modulePromise;
  let scheduled = 0, rendered = 0;
  const timers = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout(fn) { timers.set(++scheduled, fn); return scheduled; }, clearTimeout(id) { timers.delete(id); } };
  const visible = new TFile('Visible.md');
  const plugin = { persistentMenuManager: {
    hasRefreshConsumerForFile: file => file === visible,
    refreshMenusForFile: () => { rendered++; },
  } };
  const overlay = new OverlayRenderingService(plugin);
  try {
    for (let i = 0; i < 4000; i++) overlay.scheduleFileRefresh(new TFile(`Hidden-${i}.md`), 'metadata');
    assert.equal(scheduled, 0); assert.equal(overlay.pendingFiles.size, 0); assert.equal(rendered, 0);
    for (let i = 0; i < 100; i++) overlay.scheduleFileRefresh(visible, 'metadata', { force: true });
    assert.equal(scheduled, 1); assert.equal(overlay.pendingFiles.size, 1);
    overlay.flushNow(); assert.equal(rendered, 1);
    overlay.onunload(); overlay.scheduleFileRefresh(visible, 'late');
    assert.equal(scheduled, 1); assert.equal(overlay.pendingFiles.size, 0);
  } finally { overlay.onunload(); globalThis.window = previousWindow; }
});

async function makeHarness({ mode = 'native-records', initialized = false } = {}) {
  const { ParentLinkResolutionService, TFile, TFolder } = await modulePromise;
  const files = new Map();
  const frontmatter = new Map();
  const missingCache = new Set();
  const logicalProperties = new Map();
  const listeners = new Map();
  const layoutCallbacks = [];
  const cleanupCallbacks = [];
  let activeFile = null;
  let mountedFiles = [];
  const invalidations = [];
  const counters = { scans: 0, metadata: 0, rawReads: 0, writes: 0, invalidations: 0, catalogBuilds: 0 };
  const plugin = {
    settings: {
      dataArchitectureMode: mode,
      parentLinkFrontmatterKey: 'parent',
      enableParentChildIgnoreRule: false,
    },
    app: {
      vault: {
        getAllLoadedFiles: () => { counters.scans++; return [...files.values()]; },
        getAbstractFileByPath: (path) => files.get(path) || null,
        cachedRead: async () => { counters.rawReads++; throw new Error('display must not read bodies'); },
        read: async () => { counters.rawReads++; throw new Error('display must not read bodies'); },
        process: async () => { counters.writes++; throw new Error('display must not write'); },
        modify: async () => { counters.writes++; throw new Error('display must not write'); },
      },
      metadataCache: {
        initialized,
        on: (event, callback) => { listeners.set(event, callback); return {}; },
        getFileCache: (file) => {
          counters.metadata++;
          if (missingCache.has(file)) return null;
          return { frontmatter: frontmatter.get(file) || {} };
        },
        getFirstLinkpathDest: (target) => {
          const raw = String(target).replace(/\\.md$/iu, '');
          return files.get(target) || files.get(`${raw}.md`) || [...files.values()].find((file) => (
            file.basename === raw || file.name === raw
          )) || null;
        },
      },
      workspace: {
        onLayoutReady: (callback) => layoutCallbacks.push(callback),
        getActiveFile: () => activeFile,
        getLeavesOfType: (type) => type === 'markdown' ? mountedFiles.map((file) => ({ view: { file } })) : [],
      },
    },
    filePropertiesService: {
      isCompanionFile: (file) => file.path.startsWith('_assets/TPS File Properties/'),
      isPropertyTarget: (file) => plugin.settings.dataArchitectureMode !== 'native-records'
        && file.extension !== 'md' && !file.path.startsWith('_assets/TPS File Properties/'),
      read: (file) => logicalProperties.get(file) || {},
      setup: async () => { counters.catalogBuilds++; },
      handleMetadataResolved: async () => { counters.catalogBuilds++; },
    },
    overlayRenderingService: {
      invalidate: (request) => {
        const { reason, surfaces } = request;
        assert.deepEqual(surfaces, ['menus']);
        assert.match(reason, /parent-relationship-index/u);
        counters.invalidations++;
        invalidations.push(request);
      },
    },
    registerEvent: () => {},
    register: (callback) => cleanupCallbacks.push(callback),
  };
  const service = new ParentLinkResolutionService(plugin);
  plugin.parentLinkResolutionService = service;
  const add = (path, properties = {}) => {
    const file = new TFile(path);
    files.set(path, file);
    frontmatter.set(file, properties);
    return file;
  };
  const rename = (file, path) => {
    const oldPath = file.path;
    files.delete(oldPath);
    file.setPath(path);
    files.set(path, file);
    return oldPath;
  };
  return {
    TFile, TFolder, service, plugin, files, frontmatter, missingCache, logicalProperties, counters, invalidations, add, rename,
    setActive: (file) => { activeFile = file; },
    setMounted: (files) => { mountedFiles = files; },
    layoutReady: () => layoutCallbacks.forEach((callback) => callback()),
    resolveMetadata: () => { plugin.app.metadataCache.initialized = true; listeners.get('resolved')?.(); },
    unload: () => cleanupCallbacks.slice().reverse().forEach((callback) => callback()),
  };
}

test('10k no-child opens use one startup inventory and zero repeated metadata/body operations', async () => {
  const h = await makeHarness();
  const { PersistentLookupHarness } = await persistentHarnessPromise;
  const navigation = new PersistentLookupHarness(h.plugin);
  const parent = h.add('Parents/Empty.md');
  const linkedParent = h.add('Parents/Linked.md');
  const child = h.add('Tasks/Child.md', { parent: '[[Parents/Linked]]' });
  h.setActive(linkedParent);
  h.setMounted([linkedParent]);
  for (let index = 0; index < 10_000; index++) h.add(`Tasks/unrelated-${index}.md`);
  h.service.setup();
  assert.deepEqual(h.service.getChildrenForParent(linkedParent), [], 'cold navigation stays pending');
  const started = performance.now();
  h.resolveMetadata();
  await h.service.initialBuild;
  const seedMs = performance.now() - started;
  assert.equal(h.counters.scans, 1);
  assert.equal(h.counters.metadata, 10_003);
  assert.equal(h.counters.invalidations, 1, 'ready state refreshes mounted menus once');
  assert.deepEqual(h.invalidations[0].files, [], 'a cold menu has no mounted navigation to force-refresh');
  assert.equal(h.invalidations[0].ensureMenus, true, 'the cold menu is mounted once after indexing');
  assert.deepEqual(navigation.children(linkedParent), [child]);
  h.counters.metadata = 0;
  for (let open = 0; open < 50; open++) {
    assert.deepEqual(navigation.children(parent), []);
    assert.deepEqual([...navigation.relationshipPaths(parent)], []);
  }
  assert.equal(h.counters.metadata, 0, '50 empty-parent nav renders inspect no unrelated metadata');
  for (let open = 0; open < 50; open++) assert.deepEqual(navigation.children(linkedParent), [child]);
  assert.equal(h.counters.scans, 1, 'navigation never restarts the vault inventory');
  assert.ok(h.counters.metadata < 500, `only one linked child is inspected per open (${h.counters.metadata})`);
  assert.equal(h.counters.rawReads, 0);
  assert.equal(h.counters.writes, 0);
  console.log(`# 10k seed ${seedMs.toFixed(1)} ms; one inventory, 10003 metadata lookups; 50 repeated real child/path nav renders use zero empty-parent metadata lookups`);
});

test('index readiness refreshes mounted parents once without an extra ensure pass', async () => {
  const h = await makeHarness();
  const { OverlayRenderingService } = await modulePromise;
  const { PersistentLookupHarness } = await persistentHarnessPromise;
  const navigation = new PersistentLookupHarness(h.plugin);
  const parent = h.add('Parent.md');
  const child = h.add('Child.md', { parent: '[[Parent]]' });
  const inactiveParent = h.add('Inactive Parent.md');
  const inactiveChild = h.add('Inactive Child.md', { parent: '[[Inactive Parent]]' });
  h.setActive(parent);
  h.setMounted([parent, inactiveParent]);
  const displayedChildren = new Map([
    [parent.path, navigation.children(parent)],
    [inactiveParent.path, navigation.children(inactiveParent)],
  ]);
  let forcedRefreshes = 0;
  let ensurePasses = 0;
  h.plugin.persistentMenuManager = {
    hasMountedMenuForFile: () => true,
    ensureMenus: () => { ensurePasses++; },
    refreshMenusForFile: (file, force) => {
      assert.equal(force, true);
      forcedRefreshes++;
      displayedChildren.set(file.path, navigation.children(file));
    },
  };
  const previousWindow = globalThis.window;
  globalThis.window = globalThis;
  const overlay = new OverlayRenderingService(h.plugin);
  h.plugin.overlayRenderingService = overlay;
  try {
    h.service.setup();
    assert.deepEqual(displayedChildren.get(parent.path), [], 'the active mounted navigation starts pending');
    assert.deepEqual(displayedChildren.get(inactiveParent.path), [], 'the inactive mounted navigation starts pending');
    h.resolveMetadata();
    await h.service.initialBuild;
    overlay.flushNow();
    assert.equal(ensurePasses, 0, 'already-mounted navigation must not receive a redundant ensure pass');
    assert.equal(forcedRefreshes, 2);
    assert.deepEqual(displayedChildren.get(parent.path), [child]);
    assert.deepEqual(displayedChildren.get(inactiveParent.path), [inactiveChild]);
    assert.equal(h.counters.scans, 1);
  } finally {
    overlay.onunload();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('index readiness mounts a cold menu once without a second forced render', async () => {
  const h = await makeHarness({ initialized: true });
  const { OverlayRenderingService } = await modulePromise;
  const parent = h.add('Parent.md');
  const child = h.add('Child.md', { parent: '[[Parent]]' });
  h.setActive(parent);
  h.setMounted([parent]);
  let ensurePasses = 0;
  let forcedRefreshes = 0;
  h.plugin.persistentMenuManager = {
    hasMountedMenuForFile: () => false,
    ensureMenus: () => { ensurePasses++; assert.deepEqual(h.service.getChildrenForParent(parent), [child]); },
    refreshMenusForFile: () => { forcedRefreshes++; },
  };
  const previousWindow = globalThis.window;
  globalThis.window = globalThis;
  const overlay = new OverlayRenderingService(h.plugin);
  h.plugin.overlayRenderingService = overlay;
  try {
    h.service.setup();
    await h.service.initialBuild;
    overlay.flushNow();
    assert.equal(ensurePasses, 1);
    assert.equal(forcedRefreshes, 0);
    assert.equal(h.counters.scans, 1);
  } finally {
    overlay.onunload();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('a routine metadata edit on a parent with many children reindexes only that file', async () => {
  const h = await makeHarness();
  const parent = h.add('Parent.md');
  for (let index = 0; index < 1000; index++) h.add(`Child-${index}.md`, { parent: '[[Parent]]' });
  h.service.setup();
  h.resolveMetadata();
  await h.service.initialBuild;
  h.counters.metadata = 0;
  h.counters.scans = 0;
  h.frontmatter.set(parent, { title: 'Renamed display title' });
  h.service.onMetadataChanged(parent);
  assert.ok(h.counters.metadata <= 2, `parent metadata edit should not inspect 1000 children (${h.counters.metadata})`);
  assert.equal(h.counters.scans, 0);
  assert.equal(h.service.getChildrenForParent(parent).length, 1000);
});

test('same-path TFile replacement removes stale identity and keeps child order stable', async () => {
  const h = await makeHarness();
  const parent = h.add('Parent.md');
  const zChild = h.add('Z Child.md', { parent: '[[Parent]]' });
  const aChild = h.add('A Child.md', { parent: '[[Parent]]' });
  h.service.setup();
  h.resolveMetadata();
  await h.service.initialBuild;
  assert.deepEqual(h.service.getChildrenForParent(parent), [aChild, zChild]);

  const nextChild = new h.TFile(zChild.path);
  h.files.set(nextChild.path, nextChild);
  h.frontmatter.set(nextChild, { parent: '[[Parent]]' });
  h.service.onMetadataChanged(nextChild);
  assert.deepEqual(h.service.getChildrenForParent(parent), [aChild, nextChild]);
  assert.equal(h.service.knownFilePaths.has(zChild), false);
  assert.equal(h.service.knownFilePaths.size, 3);
  h.service.onFileDeleted(zChild);
  assert.deepEqual(h.service.getChildrenForParent(parent), [aChild, nextChild], 'late delete of old object must not remove replacement');

  const nextParent = new h.TFile(parent.path);
  h.files.set(nextParent.path, nextParent);
  h.service.onFileCreated(nextParent);
  assert.deepEqual(h.service.getChildrenForParent(nextParent), [aChild, nextChild]);
  assert.equal(h.service.knownFilePaths.has(parent), false);
  assert.equal(h.service.knownFilePaths.size, 3);

  const laterChild = new h.TFile(aChild.path);
  h.files.set(laterChild.path, laterChild);
  h.frontmatter.set(laterChild, { parent: '[[Parent]]' });
  h.service.onFileCreated(laterChild);
  assert.deepEqual(h.service.getChildrenForParent(nextParent), [laterChild, nextChild]);
  assert.equal(h.service.knownFilePaths.has(aChild), false);
  assert.equal(h.service.knownFilePaths.size, 3);
  assert.equal(h.counters.scans, 1);
});

test('unload during legacy catalog initialization prevents a late index seed or menu refresh', async () => {
  const h = await makeHarness({ mode: 'legacy' });
  h.add('Parent.md');
  let finishCatalog;
  h.plugin.filePropertiesService.handleMetadataResolved = () => new Promise((resolve) => { finishCatalog = resolve; });
  h.service.setup();
  h.resolveMetadata();
  await tick();
  h.unload();
  finishCatalog();
  await tick();
  h.resolveMetadata();
  await tick();
  assert.equal(h.counters.scans, 0);
  assert.equal(h.counters.invalidations, 0);
  assert.equal(h.service.knownFilePaths.size, 0);
});

test('an index seed failure reports an unconditional error and leaves the index pending', async () => {
  const h = await makeHarness({ mode: 'legacy' });
  h.add('Parent.md');
  const priorErrors = (globalThis.__gcmParentIndexErrors || []).length;
  h.plugin.filePropertiesService.handleMetadataResolved = async () => { throw new Error('catalog unavailable'); };
  h.service.setup();
  h.resolveMetadata();
  await h.service.initialBuild;
  assert.equal(globalThis.__gcmParentIndexErrors.length, priorErrors + 1);
  assert.match(globalThis.__gcmParentIndexErrors.at(-1)[0], /Could not build parent relationship index/u);
  assert.equal(h.counters.scans, 0);
  assert.equal(h.counters.invalidations, 0);
});

test('late load without an initialized flag seeds on its own startup tick and refreshes unresolved files once', async () => {
  const h = await makeHarness();
  delete h.plugin.app.metadataCache.initialized;
  const parent = h.add('Parent.md');
  const child = h.add('Child.md', {});
  h.setActive(parent);
  h.setMounted([parent]);
  h.missingCache.add(child);
  h.service.setup();
  assert.deepEqual(h.service.getChildrenForParent(parent), []);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await h.service.initialBuild;
  assert.equal(h.counters.scans, 1);
  assert.equal(h.counters.invalidations, 1);
  h.plugin.persistentMenuManager = { hasMountedMenuForFile: () => true };
  h.frontmatter.set(child, { parent: '[[Parent]]' });
  h.missingCache.delete(child);
  h.resolveMetadata();
  await tick();
  assert.deepEqual(h.service.getChildrenForParent(parent), [child]);
  assert.equal(h.counters.scans, 1, 'later resolution reindexes only files missing metadata');
  assert.equal(h.counters.invalidations, 2);
  assert.deepEqual(h.invalidations[1].files, [parent]);
  assert.equal(h.invalidations[1].force, true);
  h.resolveMetadata();
  await tick();
  assert.equal(h.counters.scans, 1, 'routine resolved events do not start another seed');
  assert.equal(h.counters.invalidations, 2);
});

test('a provisional seed revisits initially resolved links when final metadata resolution changes their target', async () => {
  const h = await makeHarness();
  delete h.plugin.app.metadataCache.initialized;
  const first = h.add('First/Ambiguous.md');
  const second = h.add('Second/Ambiguous.md');
  const child = h.add('Child.md', { parent: '[[Ambiguous]]' });
  let selected = first;
  h.plugin.app.metadataCache.getFirstLinkpathDest = (target) => target === 'Ambiguous' ? selected : null;
  h.service.setup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await h.service.initialBuild;
  assert.deepEqual(h.service.getChildrenForParent(first), [child]);
  selected = second;
  h.resolveMetadata();
  await tick();
  assert.deepEqual(h.service.getChildrenForParent(first), []);
  assert.deepEqual(h.service.getChildrenForParent(second), [child]);
  assert.equal(h.counters.scans, 1, 'final metadata resolution only revisits relationship-bearing children');
});

test('metadata, create, delete, and child rename update only affected relationships', async () => {
  const h = await makeHarness();
  const parent = h.add('Parent.md');
  const child = h.add('Child.md', { parent: '[[Parent]]' });
  const pending = h.add('Pending.md', { parent: '[[Future]]' });
  h.service.setup();
  h.resolveMetadata();
  await h.service.initialBuild;
  assert.deepEqual(h.service.getChildrenForParent(parent), [child]);
  h.counters.scans = 0;

  h.frontmatter.set(child, {});
  assert.deepEqual(h.service.onMetadataChanged(child), [parent.path]);
  assert.deepEqual(h.service.getChildrenForParent(parent), []);
  const future = h.add('Future.md');
  h.service.onFileCreated(future);
  assert.deepEqual(h.service.getChildrenForParent(future), [pending], 'a previously bare unresolved path becomes a child');
  const oldPath = h.rename(pending, 'Moved/Pending.md');
  h.service.onFileRenamed(pending, oldPath);
  assert.deepEqual(h.service.getChildrenForParent(future), [pending], 'child rename needs no metadata-changed event');
  h.files.delete(future.path);
  h.service.onFileDeleted(future);
  assert.deepEqual(h.service.getChildrenForParent(future), []);
  assert.equal(h.counters.scans, 0, 'ordinary lifecycle events never enumerate the vault');
  assert.equal(h.counters.rawReads + h.counters.writes, 0);
});

test('folder/target rename re-resolves bare paths even without child metadata events', async () => {
  const h = await makeHarness();
  const parent = h.add('Projects/Old/Parent.md');
  const child = h.add('Tasks/Child.md', { parent: '[[Projects/Old/Parent]]' });
  h.service.setup();
  h.resolveMetadata();
  await h.service.initialBuild;
  assert.deepEqual(h.service.getChildrenForParent(parent), [child]);
  h.files.delete(parent.path);
  parent.setPath('Projects/New/Parent.md');
  h.files.set(parent.path, parent);
  h.frontmatter.set(child, { parent: '[[Projects/New/Parent]]' });
  h.service.onFileRenamed(new h.TFolder('Projects/New'), 'Projects/Old');
  assert.deepEqual(h.service.getChildrenForParent(parent), [child]);
  assert.equal(h.counters.scans, 1);
});

test('non-Markdown companions, ignore rules, parent key, and both architecture toggles stay current', async () => {
  const h = await makeHarness({ mode: 'legacy' });
  const parent = h.add('Views/Parent.base');
  const child = h.add('Attachments/Child.pdf');
  h.logicalProperties.set(child, { parent: '[[Views/Parent.base]]' });
  h.service.setup();
  h.resolveMetadata();
  await h.service.initialBuild;
  assert.deepEqual(h.service.getChildrenForParent(parent), [child]);

  h.logicalProperties.set(child, { parent: '[[Views/Parent.base]]', relationshipMode: 'ignore' });
  h.service.onMetadataChanged(child);
  h.plugin.settings.enableParentChildIgnoreRule = true;
  h.plugin.settings.parentChildIgnoreFrontmatterKey = 'relationshipMode';
  h.plugin.settings.parentChildIgnoreFrontmatterValue = 'ignore';
  assert.deepEqual(h.service.getChildrenForParent(parent), []);
  h.plugin.settings.enableParentChildIgnoreRule = false;
  assert.deepEqual(h.service.getChildrenForParent(parent), [child]);

  h.plugin.settings.dataArchitectureMode = 'native-records';
  await h.service.onRelationshipSettingsChanged();
  assert.deepEqual(h.service.getChildrenForParent(parent), []);
  h.plugin.settings.dataArchitectureMode = 'legacy';
  await h.service.onRelationshipSettingsChanged();
  assert.deepEqual(h.service.getChildrenForParent(parent), [child]);
  assert.ok(h.counters.catalogBuilds >= 2, 'returning to legacy mode reestablishes the companion catalog');
  h.plugin.settings.parentLinkFrontmatterKey = 'relatedTo';
  h.logicalProperties.set(child, { relatedTo: '[[Views/Parent.base]]' });
  await h.service.onRelationshipSettingsChanged();
  assert.deepEqual(h.service.getChildrenForParent(parent), [child]);
  assert.equal(h.counters.rawReads + h.counters.writes, 0);
});

test('real legacy Canvas compatibility reads current JSON before changing the child index', async () => {
  const h = await makeHarness({ mode: 'legacy' });
  const { FilePropertiesService } = await modulePromise;
  const firstParent = h.add('First.md');
  const secondParent = h.add('Second.md');
  const canvas = h.add('Board.canvas');
  let json = JSON.stringify({ metadata: { frontmatter: { parent: '[[First]]' } } });
  h.plugin.app.vault.read = async (file) => {
    assert.equal(file, canvas);
    h.counters.rawReads++;
    return json;
  };
  h.plugin.filePropertiesService = new FilePropertiesService(h.plugin);
  await h.plugin.filePropertiesService.primeLegacyCanvasCache([canvas]);
  h.service.rebuildRelationshipIndex();
  assert.deepEqual(h.service.getChildrenForParent(firstParent), [canvas]);
  json = JSON.stringify({ metadata: { frontmatter: { parent: '[[Second]]' } } });
  h.plugin.filePropertiesService.invalidateLegacyCanvas(canvas);
  await h.plugin.filePropertiesService.primeLegacyCanvasCache([canvas]);
  h.service.onMetadataChanged(canvas);
  assert.deepEqual(h.service.getChildrenForParent(firstParent), []);
  assert.deepEqual(h.service.getChildrenForParent(secondParent), [canvas]);
  assert.equal(h.counters.rawReads, 2, 'one authoritative Canvas JSON read per edit, none on navigation');
  assert.equal(h.counters.scans, 1, 'the edit does not enumerate the vault');
});

// Compose both actual services so relationship operation counts include the
// real companion classifier, including its existing positive ownership.

async function makeActualParentPropertiesHarness(options = {}) {
  const h = await makeHarness({ initialized: true, ...options });
  const { FilePropertiesService } = await modulePromise;
  h.plugin.filePropertiesService = new FilePropertiesService(h.plugin);
  for (const method of ['setup', 'handleMetadataResolved', 'rebuildCompanionIndexUnlocked']) {
    assert.equal(typeof h.plugin.filePropertiesService[method], 'function', `${method} must be an actual catalog owner`);
    h.plugin.filePropertiesService[method] = () => {
      h.counters.catalogBuilds++;
      throw new Error(`Metadata-only relationship work must not request FileProperties.${method}`);
    };
  }
  // Parent must continue to own plain stored metadata, not resolve Native APIs.
  h.plugin.nativeRecordService = new Proxy({}, {
    get: (_target, key) => { throw new Error(`Parent must not access Native service: ${String(key)}`); },
  });
  return h;
}

function actualParentCompanionRecord(sourcePath, id, properties = {}) {
  return {
    tpsGcmFileProperties: 1,
    tpsGcmFileId: id,
    tpsGcmSourcePath: sourcePath,
    ...properties,
  };
}

function assertActualParentReadOnly(h) {
  assert.equal(h.counters.rawReads, 0, 'relationship/classification operations never read source bodies');
  assert.equal(h.counters.writes, 0, 'relationship/classification operations never enqueue mutations');
  assert.equal(h.counters.catalogBuilds, 0, 'direct metadata operations do not request legacy catalog rebuilds');
}

test('actual FileProperties: ordinary metadata reindex consumes one current cache read', async () => {
  const h = await makeActualParentPropertiesHarness();
  const first = h.add('First.md');
  const second = h.add('Second.md');
  const child = h.add('Child.md', { parent: '[[First]]' });
  h.service.rebuildRelationshipIndex();
  const updated = { parent: '[[Second]]', title: 'Current title', custom: { retained: true } };
  h.frontmatter.set(child, updated);
  h.counters.metadata = 0;
  assert.deepEqual(new Set(h.service.onMetadataChanged(child)), new Set([first.path, second.path]));
  assert.equal(h.counters.metadata, 1, 'published baseline performs 3 reads for one ordinary reindex');
  assert.deepEqual(h.service.getChildrenForParent(first), []);
  assert.deepEqual(h.service.getChildrenForParent(second), [child]);
  assert.equal(h.service.getLogicalFrontmatter(child), updated);
  assertActualParentReadOnly(h);
});

// Actual-source startup cooperation controls. Logical costs exercise elapsed
// checkpoints; they are operation/lifecycle proofs, not machine-speed claims.
// Existing register-events callbacks, limited to the prefix ending in the Parent
// dispatch. This retains actual eligibility/guards/order without executing later
// unrelated automation. It is NOT the complete registration/onload host test.
function extractActualParentDispatch({ ts, source, plugin, TFile, TFolder, assert }) {
  const tree = ts.createSourceFile('register-events.ts', source, ts.ScriptTarget.Latest, true);
  const wanted = [
    ['changed', 'plugin.app.metadataCache.on', 'onMetadataChanged'],
    ['create', 'plugin.app.vault.on', 'onFileCreated'],
    ['rename', 'plugin.app.vault.on', 'onFileRenamed'],
    ['delete', 'plugin.app.vault.on', 'onFileDeleted'],
    ['filesUpdated', 'plugin.eventService.onFilesUpdated', 'onMetadataChanged'],
  ];
  const callbacks = {};
  for (const [event, owner, method] of wanted) {
    const matches = [];
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === owner
        && (event === 'filesUpdated'
          || (ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === event))) {
        const callback = node.arguments[event === 'filesUpdated' ? 0 : 1];
        if (callback && ts.isArrowFunction(callback) && ts.isBlock(callback.body)) matches.push(callback);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.equal(matches.length, 1, `one actual ${owner}(${event}) callback`);
    const callback = matches[0];
    const at = callback.body.statements.findIndex((statement) => (
      statement.getText(tree).includes(`parentLinkResolutionService.${method}(`)
    ));
    assert.ok(at >= 0, `actual ${event} prefix must include ${method}`);
    const parameters = callback.parameters.map((parameter) => parameter.getText(tree)).join(', ');
    const body = callback.body.statements.slice(0, at + 1).map((statement) => {
      if (event !== 'filesUpdated') return statement.getText(tree);
      assert.ok(ts.isForOfStatement(statement) && ts.isBlock(statement.statement),
        'actual path subscriber retains its current-file loop');
      const statements = statement.statement.statements;
      const innerAt = statements.findIndex((inner) => inner.getText(tree)
        .includes(`parentLinkResolutionService.${method}(`));
      assert.ok(innerAt >= 0, 'actual path loop retains relationship eligibility');
      return statement.getText(tree).replace(statement.statement.getText(tree),
        `{\n${statements.slice(0, innerAt + 1).map((inner) => inner.getText(tree)).join('\n')}\n}`);
    }).join('\n');
    const output = ts.transpileModule(`const callback = (${parameters}) => { ${body} };`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    callbacks[event] = new Function('plugin', 'TFile', 'TFolder', 'refreshRelatedParentMenus',
      `${output}\nreturn callback;`)(plugin, TFile, TFolder, () => {});
  }
  return callbacks;
}

// The actual private migration completion method, not a made-up post-migration
// hook. Its caller's persistence/verification transaction is a separate required
// control below; this extraction proves only refresh's existing delivery order.
function extractActualMigrationRefresh({ ts, source, assert, logger }) {
  const tree = ts.createSourceFile('property-migration-service.ts', source, ts.ScriptTarget.Latest, true);
  const owners = tree.statements.filter((node) => ts.isClassDeclaration(node)
    && node.name?.text === 'PropertyMigrationService');
  assert.equal(owners.length, 1);
  const methods = owners[0].members.filter((node) => ts.isMethodDeclaration(node)
    && node.name.getText(tree) === 'refresh');
  assert.equal(methods.length, 1);
  assert.ok(methods[0].body);
  const output = ts.transpileModule(`const refresh = function (notes) ${methods[0].body.getText(tree)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('logger', `${output}\nreturn refresh;`)(logger);
}

// Test-only controlled CPU and host task boundary. A source operation explicitly
// calls charge; recorded work is synthetic, never a machine-time speed claim.
// Uses the host scheduler API, not any new Parent public/private method.
function controlledParentTasks({ assert, h, cost = 2 }) {
  const saved = ['performance', 'scheduler'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  let cpu = 0;
  const pending = [];
  const observations = [];
  const originalCache = h.plugin.app.metadataCache.getFileCache;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => cpu } });
  Object.defineProperty(globalThis, 'scheduler', { configurable: true, value: {
    yield: () => new Promise((resolve, reject) => {
      observations.push({ cpu, metadata: h.counters.metadata, scans: h.counters.scans });
      pending.push({ resolve, reject });
    }),
  } });
  h.plugin.app.metadataCache.getFileCache = (file) => {
    cpu += cost;
    return originalCache(file);
  };
  const pump = async () => { for (let n = 0; n < 32; n++) await Promise.resolve(); };
  return {
    observations,
    get pending() { return pending.length; },
    charge: (amount) => { cpu += amount; },
    release: async () => { assert.equal(pending.length, 1); pending.shift().resolve(); await pump(); },
    fail: async (error) => { assert.equal(pending.length, 1); pending.shift().reject(error); await pump(); },
    pump,
    async finish() {
      let settled = false;
      const owner = h.service.initialBuild;
      assert.ok(owner, 'join the actual existing initialBuild, not a new test readiness API');
      owner.then(() => { settled = true; }, () => { settled = true; });
      const limit = 2 * (h.files.size + 1) + 64;
      for (let n = 0; !settled && n < limit; n++) {
        if (pending.length) pending.shift().resolve();
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.equal(settled, true, 'finite owner settles; no timeout/skip or infinite auto-driver');
      assert.equal(pending.length, 0, 'owner completion leaves no extra scheduled task');
      await owner;
    },
    restore() {
      h.plugin.app.metadataCache.getFileCache = originalCache;
      for (const task of pending.splice(0)) task.resolve();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

// Register only after the clean next worktree exists and root approves running
// before-source controls. The injected helpers are the existing actual harness;
// dispatch must come from extractActualParentDispatch above, not fake forwarding.
function registerParentInitialCooperationControls({ test, assert, makeHarness,
  makeActualParentPropertiesHarness, makeDispatch, makeMigrationRefresh }) {
  const fixture = async () => {
    const h = await makeActualParentPropertiesHarness();
    h.first = h.add('First.md');
    h.second = h.add('Second.md');
    h.child = h.add('Child.md', { parent: '[[First]]' });
    for (let n = 0; n < 600; n++) h.add(`Queued/${n}.md`, { parent: '[[First]]' });
    h.plugin.api = undefined;
    h.plugin.canRunBackgroundAutomation = () => false;
    h.plugin.propertyMigrationService = { active: false };
    h.plugin.app.vault.getFileByPath = (path) => h.files.get(path) || null;
    h.dispatch = makeDispatch(h);
    return h;
  };
  const startHeld = async (h, tasks) => {
    h.service.setup();
    await tasks.pump();
    assert.equal(tasks.pending, 1, 'expensive initial discovery must pause before becoming public');
    assert.equal(h.service.indexReady, false);
    assert.equal(h.counters.scans, 1);
    assert.deepEqual(h.service.getChildrenForParent(h.first), [], 'partial reverse maps are not public');
  };
  const readOnly = (h) => {
    assert.equal(h.counters.rawReads, 0);
    assert.equal(h.counters.writes, 0);
    assert.equal(h.counters.catalogBuilds, 0);
    assert.equal(h.counters.scans, 1);
  };

  test('initial cooperation Parent: elapsed slices retain one current inventory and one ready refresh', async () => {
    const h = await fixture();
    const tasks = controlledParentTasks({ assert, h });
    try {
      await startHeld(h, tasks);
      assert.ok(tasks.observations[0].cpu <= 10, '8 ms plus one charged atomic operation, not 256 costly paths');
      assert.equal(h.counters.invalidations, 0);
      await tasks.finish();
      assert.equal(h.service.indexReady, true);
      assert.equal(h.service.knownFilePaths.size, h.files.size);
      assert.equal(h.counters.invalidations, 1);
      assert.ok(h.service.getChildrenForParent(h.first).includes(h.child));
      readOnly(h);
    } finally { h.unload(); tasks.restore(); }
  });

  const races = {
    'visited metadata': (h) => {
      assert.equal(h.service.knownFilePaths.has(h.child), true, 'the cursor already accepted this child');
      h.frontmatter.set(h.child, { parent: '[[Second]]' });
      h.dispatch.changed(h.child);
      return () => assert.ok(h.service.getChildrenForParent(h.second).includes(h.child));
    },
    'new child after inventory': (h) => {
      const created = h.add('Created-after-inventory.md', { parent: '[[Second]]' });
      h.dispatch.create(created);
      return () => assert.ok(h.service.getChildrenForParent(h.second).includes(created));
    },
    'queued deletion': (h) => {
      const deleted = h.files.get('Queued/599.md');
      assert.equal(h.service.knownFilePaths.has(deleted), false);
      h.files.delete(deleted.path);
      h.dispatch.delete(deleted);
      return () => assert.equal(h.service.knownFilePaths.has(deleted), false);
    },
    'visited child rename': (h) => {
      const oldPath = h.rename(h.child, 'Moved/Child.md');
      h.dispatch.rename(h.child, oldPath);
      return () => {
        assert.ok(h.service.getChildrenForParent(h.first).includes(h.child));
        assert.equal(h.service.knownFilesByPath.has(oldPath), false);
      };
    },
    'current replacement plus late stale events': (h) => {
      const stale = h.child;
      const current = h.add(stale.path, { parent: '[[Second]]' });
      h.dispatch.changed(current);
      h.dispatch.delete(stale);
      h.dispatch.changed(stale);
      return () => {
        assert.ok(h.service.getChildrenForParent(h.second).includes(current));
        assert.equal(h.service.knownFilePaths.has(stale), false);
      };
    },
  };
  for (const [name, mutate] of Object.entries(races)) test(`initial cooperation Parent actual dispatch: ${name}`, async () => {
    const h = await fixture();
    const tasks = controlledParentTasks({ assert, h });
    try {
      await startHeld(h, tasks);
      const verify = mutate(h);
      await tasks.finish();
      verify();
      assert.equal(h.service.knownFilesByPath.size, h.files.size);
      readOnly(h);
    } finally { h.unload(); tasks.restore(); }
  });

  test('initial cooperation actual metadata prefix preserves migration exclusion while API/automation are unavailable', async () => {
    const h = await fixture();
    const original = h.service.onMetadataChanged;
    let accepted = 0;
    h.service.onMetadataChanged = () => { accepted++; return []; };
    try {
      h.dispatch.changed(h.child);
      assert.equal(accepted, 1, 'no public API or background-automation prerequisite for Parent delivery');
      h.plugin.propertyMigrationService.active = true;
      h.dispatch.changed(h.child);
      assert.equal(accepted, 1, 'existing real migration guard must not be bypassed');
    } finally { h.service.onMetadataChanged = original; h.unload(); }
  });

  test('initial cooperation actual migration refresh delivers current Markdown objects during an unready held initial pass', async () => {
    const h = await fixture();
    const tasks = controlledParentTasks({ assert, h });
    const emitted = [];
    let nativeRefreshes = 0;
    h.plugin.manifest = { id: 'tps-global-context-menu' };
    h.plugin.nativeRecordService = { refreshConfiguration: () => { nativeRefreshes++; } };
    h.plugin.eventService = { emitFilesUpdated: (paths, options) => {
      emitted.push({ paths, options, active: h.plugin.propertyMigrationService.active });
      // Bounded subscriber prefix; not proof of the complete workspace pair or
      // the migration persistence transaction, both covered separately.
      h.dispatch.filesUpdated(paths);
    } };
    const refresh = makeMigrationRefresh();
    try {
      await startHeld(h, tasks);
      const old = h.child;
      const current = h.add(old.path, { parent: '[[Second]]' });
      h.plugin.propertyMigrationService.active = true;
      h.dispatch.changed(current); // Actual global listener deliberately skips it.
      refresh.call({ plugin: h.plugin, consumer: () => null }, [
        { path: current.path }, { path: 'Missing.md' }, { path: 'Ignored.base' },
      ]);
      assert.equal(nativeRefreshes, 1);
      assert.deepEqual(emitted, [{ paths: [current.path, 'Missing.md'],
        options: { sourcePluginId: h.plugin.manifest.id }, active: true }]);
      await tasks.finish();
      assert.ok(h.service.getChildrenForParent(h.second).includes(current));
      assert.equal(h.service.knownFilePaths.has(old), false);
      assert.equal(h.service.knownFilesByPath.get(current.path), current);
      readOnly(h);
    } finally { h.unload(); tasks.restore(); }
  });

  test('initial cooperation Parent: unload during a held slice forbids further indexing and ready refresh', async () => {
    const h = await fixture();
    const tasks = controlledParentTasks({ assert, h });
    try {
      await startHeld(h, tasks);
      h.unload();
      const before = { reads: h.counters.metadata, tasks: tasks.observations.length };
      await tasks.release();
      await tasks.finish();
      assert.equal(h.service.indexReady, false);
      assert.equal(h.service.knownFilePaths.size, 0);
      assert.equal(h.counters.invalidations, 0);
      assert.equal(h.counters.metadata, before.reads);
      assert.equal(tasks.observations.length, before.tasks);
    } finally { h.unload(); tasks.restore(); }
  });

}


const actualParentEventsSource = readFileSync(new URL('../src/events/register-events.ts', import.meta.url), 'utf8');
const actualParentMigrationSource = readFileSync(new URL('../src/services/property-migration-service.ts', import.meta.url), 'utf8');
function makeActualParentDispatch(h) {
  return extractActualParentDispatch({ ts, source: actualParentEventsSource,
    plugin: h.plugin, TFile: h.TFile, TFolder: h.TFolder, assert });
}
function makeActualParentMigrationRefresh() {
  return extractActualMigrationRefresh({ ts, source: actualParentMigrationSource, assert,
    logger: { warn: () => {} } });
}
registerParentInitialCooperationControls({ test, assert, makeHarness, makeActualParentPropertiesHarness,
  makeDispatch: makeActualParentDispatch, makeMigrationRefresh: makeActualParentMigrationRefresh });


test('actual FileProperties: one public logical read preserves the exact current frontmatter object', async () => {
  const h = await makeActualParentPropertiesHarness();
  const frontmatter = { title: 'Current', tags: ['a'], nested: { value: 1 } };
  const file = h.add('Current.md', frontmatter);
  assert.equal(h.service.getLogicalFrontmatter(file), frontmatter);
  assert.equal(h.counters.metadata, 1, 'published baseline performs classifier plus logical cache reads');
  assertActualParentReadOnly(h);
});

test('actual FileProperties: a missing cache is consumed once and a later operation remains fresh', async () => {
  const h = await makeActualParentPropertiesHarness();
  const parent = h.add('Parent.md');
  const child = h.add('Missing.md', { parent: '[[Parent]]' });
  h.service.rebuildRelationshipIndex();
  h.missingCache.add(child);
  h.counters.metadata = 0;
  h.service.onMetadataChanged(child);
  assert.equal(h.counters.metadata, 1, 'undefined/null must be distinguished from an unread operation-local cache');
  assert.deepEqual(h.service.getChildrenForParent(parent), []);
  const current = { parent: '[[Parent]]', title: 'Resolved later' };
  h.missingCache.delete(child);
  h.frontmatter.set(child, current);
  h.service.onMetadataChanged(child);
  assert.deepEqual(h.service.getChildrenForParent(parent), [child]);
  assert.equal(h.service.getLogicalFrontmatter(child), current);
  assertActualParentReadOnly(h);
});

test('actual FileProperties: a 10k metadata seed uses one inventory and one read per ordinary Markdown file', async () => {
  const h = await makeActualParentPropertiesHarness();
  const parent = h.add('Parent.md');
  const child = h.add('Child.md', { parent: '[[Parent]]' });
  for (let index = 0; index < 9_998; index++) h.add(`Ordinary/${index}.md`);
  const input = [...h.frontmatter].map(([file, frontmatter]) => [file, frontmatter]);
  h.service.rebuildRelationshipIndex();
  assert.equal(h.counters.scans, 1);
  assert.equal(h.counters.metadata, 10_000, 'real published classifier triples the existing stubbed-harness count');
  assert.equal(h.service.seedDirectCacheLookups, 10_000, 'seed telemetry counts actual Parent-owned cache acquisitions');
  assert.deepEqual(h.service.getChildrenForParent(parent), [child]);
  assert.equal(h.counters.scans, 1, 'querying existing relationships does not acquire another inventory');
  for (const [file, frontmatter] of input) assert.equal(h.frontmatter.get(file), frontmatter);
  assertActualParentReadOnly(h);
});

test('actual FileProperties: managed paths and positive raw ownership never invoke a metadata reader', async () => {
  const h = await makeActualParentPropertiesHarness();
  const managed = h.add('_assets/TPS File Properties/Unmarked.md', { parent: '[[Parent]]' });
  const moved = h.add('Moved/Owned.md', actualParentCompanionRecord('File.pdf', 'owned', { parent: '[[Parent]]' }));
  assert.equal(h.plugin.filePropertiesService.isCompanionFile(moved), true, 'prime the existing positive owner through its public classifier');
  h.frontmatter.set(moved, { parent: '[[Parent]]', nowOrdinary: true });
  h.service.rebuildRelationshipIndex();
  h.counters.metadata = 0;
  const originalRead = h.plugin.app.metadataCache.getFileCache;
  let suppliedReaderCalls = 0;
  h.plugin.app.metadataCache.getFileCache = () => { throw new Error('Known positive must not touch metadata'); };
  try {
    for (const file of [managed, moved]) {
      assert.equal(h.plugin.filePropertiesService.isCompanionFile(file, () => {
        suppliedReaderCalls++;
        throw new Error('Known positive must remain lazy');
      }), true);
      assert.equal(h.service.isRelationshipTarget(file), false);
      assert.deepEqual(h.service.getLogicalFrontmatter(file), {});
      h.service.onMetadataChanged(file);
    }
  } finally {
    h.plugin.app.metadataCache.getFileCache = originalRead;
  }
  assert.equal(suppliedReaderCalls, 0);
  assert.equal(h.counters.metadata, 0);
  assertActualParentReadOnly(h);
});

test('actual FileProperties: case-insensitive moved ownership becomes current ordinary metadata only after forget', async () => {
  const h = await makeActualParentPropertiesHarness();
  const parent = h.add('Parent.md');
  const moved = h.add('Moved/Casefold.md', {
    TPSGCMFILEPROPERTIES: '1', TPSGCMFILEID: 'case-id', TPSGCMSOURCEPATH: 'File.pdf',
    parent: '[[Parent]]',
  });
  h.service.rebuildRelationshipIndex();
  assert.deepEqual(h.service.getChildrenForParent(parent), []);
  const ordinary = { parent: '[[Parent]]', title: 'Ordinary after owner removal' };
  h.frontmatter.set(moved, ordinary);
  h.counters.metadata = 0;
  h.service.onMetadataChanged(moved);
  assert.equal(h.counters.metadata, 0, 'existing positive ownership still wins until its owner is forgotten');
  assert.deepEqual(h.service.getChildrenForParent(parent), []);
  h.plugin.filePropertiesService.forgetCompanion(moved);
  h.counters.metadata = 0;
  h.service.onMetadataChanged(moved);
  assert.equal(h.counters.metadata, 1, 'the forgotten path gets one fresh ordinary metadata read');
  assert.deepEqual(h.service.getChildrenForParent(parent), [moved]);
  assert.equal(h.service.getLogicalFrontmatter(moved), ordinary);
  assertActualParentReadOnly(h);
});

test('actual FileProperties: separate public logical operations never retain a prior metadata result', async () => {
  const h = await makeActualParentPropertiesHarness();
  const first = { title: 'First', status: 'todo', parent: '[[One]]' };
  const file = h.add('Fresh.md', first);
  assert.equal(h.service.getLogicalFrontmatter(file), first);
  const second = { title: 'Second', status: 'complete', parent: '[[Two]]' };
  h.frontmatter.set(file, second);
  assert.equal(h.service.getLogicalFrontmatter(file), second, 'direct callers do not require an event to read the next cache object');
  second.title = 'Mutated current object';
  assert.equal(h.service.getLogicalFrontmatter(file), second);
  assert.equal(h.service.getLogicalFrontmatter(file).title, 'Mutated current object');
  assert.deepEqual(first, { title: 'First', status: 'todo', parent: '[[One]]' });
  assertActualParentReadOnly(h);
});

test('actual FileProperties: native asset Markdown owns its properties while a native PDF is not indexed', async () => {
  const h = await makeActualParentPropertiesHarness();
  const parent = h.add('Parent.md');
  const assetProperties = {
    tpsId: 'asset-1', kind: 'asset', title: 'Native asset', sourcePath: 'File.pdf',
    sourceExtension: 'pdf', parent: '[[Parent]]', custom: { value: 5 },
  };
  const asset = h.add('_records/assets/asset-1.md', assetProperties);
  const pdfProperties = { parent: '[[Parent]]', title: 'Existing PDF cache value' };
  const pdf = h.add('File.pdf', pdfProperties);
  h.service.rebuildRelationshipIndex();
  assert.deepEqual(h.service.getChildrenForParent(parent), [asset]);
  assert.equal(h.service.isRelationshipTarget(pdf), false);
  assert.equal(h.service.getLogicalFrontmatter(asset), assetProperties);
  assert.equal(h.service.getLogicalFrontmatter(pdf), pdfProperties,
    'public logical reads preserve the old cache-valued contract even for files excluded from native indexing');
  assert.equal(h.frontmatter.get(asset), assetProperties);
  assertActualParentReadOnly(h);
});

test('actual FileProperties: legacy PDF logical reads use the existing mapped companion and fail closed on duplicates', async () => {
  const h = await makeActualParentPropertiesHarness({ mode: 'legacy' });
  const parent = h.add('Parent.md');
  const pdf = h.add('Attachments/File.pdf', { parent: '[[Wrong]]', shouldNotLeak: true });
  const companionRaw = actualParentCompanionRecord(pdf.path, 'first-id', { parent: '[[Parent]]', status: 'todo' });
  const companion = h.add('Moved/PDF properties.md', companionRaw);
  assert.equal(h.plugin.filePropertiesService.isCompanionFile(companion), true);
  h.service.rebuildRelationshipIndex();
  assert.deepEqual(h.service.getChildrenForParent(parent), [pdf]);
  assert.deepEqual(h.service.getLogicalFrontmatter(pdf), { parent: '[[Parent]]', status: 'todo' });
  assert.deepEqual(h.service.getLogicalFrontmatter(companion), {});
  const duplicate = h.add('Moved/Duplicate properties.md', actualParentCompanionRecord(pdf.path, 'second-id', {
    parent: '[[Parent]]', status: 'must-not-leak',
  }));
  assert.equal(h.plugin.filePropertiesService.isCompanionFile(duplicate), true, 'the public marker classifier owns index evidence');
  h.service.onMetadataChanged(pdf);
  assert.deepEqual(h.service.getLogicalFrontmatter(pdf), {});
  assert.deepEqual(h.service.getChildrenForParent(parent), []);
  h.files.delete(duplicate.path);
  h.plugin.filePropertiesService.forgetCompanion(duplicate);
  h.service.onMetadataChanged(pdf);
  assert.deepEqual(h.service.getLogicalFrontmatter(pdf), { parent: '[[Parent]]', status: 'todo' });
  assert.deepEqual(h.service.getChildrenForParent(parent), [pdf]);
  assert.equal(h.frontmatter.get(companion), companionRaw, 'raw storage and reserved markers remain owned by FileProperties');
  assertActualParentReadOnly(h);
});

test('actual FileProperties: default public companion classification stays current without a supplied reader', async () => {
  const h = await makeActualParentPropertiesHarness();
  const file = h.add('Public.md', {});
  assert.equal(h.plugin.filePropertiesService.isCompanionFile(file), false);
  assert.equal(h.plugin.filePropertiesService.isCompanionFile(file), false);
  assert.equal(h.counters.metadata, 2, 'negative classification is not persistently cached');
  h.frontmatter.set(file, actualParentCompanionRecord('File.pdf', 'public-id'));
  assert.equal(h.plugin.filePropertiesService.isCompanionFile(file), true, 'next default call sees new marker values');
  h.frontmatter.set(file, {});
  const reads = h.counters.metadata;
  assert.equal(h.plugin.filePropertiesService.isCompanionFile(file), true, 'existing positive raw owner is retained');
  assert.equal(h.counters.metadata, reads);
  h.plugin.filePropertiesService.forgetCompanion(file);
  assert.equal(h.plugin.filePropertiesService.isCompanionFile(file), false);
  assert.equal(h.counters.metadata, reads + 1);
  assertActualParentReadOnly(h);
});

test('actual FileProperties: a supplied classifier reader is lazy and does not perform an independent cache lookup', async () => {
  const h = await makeActualParentPropertiesHarness();
  const file = h.add('Reader.md', {});
  const raw = actualParentCompanionRecord('File.pdf', 'reader-id');
  let reads = 0;
  assert.equal(h.plugin.filePropertiesService.isCompanionFile(file, () => { reads++; return raw; }), true);
  assert.equal(reads, 1, 'classifier consumes the supplied frontmatter exactly once when needed');
  assert.equal(h.counters.metadata, 0, 'classifier must not also perform its own cache lookup');
  assert.deepEqual(h.service.getLogicalFrontmatter(file), {}, 'supplied positive evidence uses the unchanged companion owner');
  assertActualParentReadOnly(h);
});

test('actual FileProperties: current-TFile replacement and late stale-object events preserve relationship ownership', async () => {
  const h = await makeActualParentPropertiesHarness();
  const first = h.add('First.md');
  const second = h.add('Second.md');
  const stale = h.add('Child.md', { parent: '[[First]]' });
  h.service.rebuildRelationshipIndex();
  const current = new h.TFile(stale.path);
  h.files.set(current.path, current);
  const currentProperties = { parent: '[[Second]]', title: 'Replacement' };
  h.frontmatter.set(current, currentProperties);
  h.service.onMetadataChanged(current);
  h.service.onFileDeleted(stale);
  h.service.onMetadataChanged(stale);
  assert.deepEqual(h.service.getChildrenForParent(first), []);
  assert.deepEqual(h.service.getChildrenForParent(second), [current]);
  assert.equal(h.service.getLogicalFrontmatter(current), currentProperties);
  assert.equal(h.service.knownFilePaths.has(stale), false);
  const oldPath = h.rename(current, 'Moved/Child.md');
  h.service.onFileRenamed(current, oldPath);
  assert.deepEqual(h.service.getChildrenForParent(second), [current]);
  h.files.delete(current.path);
  h.service.onFileDeleted(current);
  assert.deepEqual(h.service.getChildrenForParent(second), []);
  assertActualParentReadOnly(h);
});

async function initialCooperationFixture(options = {}) {
  const h = await makeActualParentPropertiesHarness(options);
  h.first = h.add('First.md');
  h.second = h.add('Second.md');
  h.child = h.add('Child.md', { parent: '[[First]]' });
  for (let n = 0; n < 600; n++) h.add(`Queued/${n}.md`, { parent: '[[First]]' });
  h.plugin.api = undefined;
  h.plugin.canRunBackgroundAutomation = () => false;
  h.plugin.propertyMigrationService = { active: false };
  h.plugin.app.vault.getFileByPath = (path) => h.files.get(path) || null;
  h.dispatch = makeActualParentDispatch(h);
  return h;
}

async function beginHeldInitial(h, tasks, options) {
  h.service.setup(options);
  await tasks.pump();
  assert.equal(tasks.pending, 1, 'initial work over the elapsed budget must yield');
  assert.equal(h.service.indexReady, false, 'partial reverse maps remain private');
  assert.equal(h.counters.scans, 1);
  assert.equal(h.counters.invalidations, 0);
}

function assertInitialReadOnly(h, expectedScans = 1, expectedCatalogs = 0) {
  assert.equal(h.counters.scans, expectedScans);
  assert.equal(h.counters.catalogBuilds, expectedCatalogs);
  assert.equal(h.counters.rawReads, 0);
  assert.equal(h.counters.writes, 0);
}

test('initial cooperation Parent: cheap discovery has no mandatory task or retained metadata snapshot', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h, cost: 0 });
  try {
    h.service.setup();
    await tasks.pump();
    assert.equal(tasks.pending, 0);
    assert.equal(tasks.observations.length, 0);
    assert.equal(h.service.indexReady, true);
    const changed = { parent: '[[Second]]', title: 'Fresh per operation' };
    h.frontmatter.set(h.child, changed);
    h.dispatch.changed(h.child);
    assert.deepEqual(h.service.getChildrenForParent(h.second), [h.child]);
    assert.equal(h.service.getLogicalFrontmatter(h.child), changed);
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: native unsupported TFiles remain tracked without metadata acquisition', async () => {
  const h = await makeActualParentPropertiesHarness();
  const parent = h.add('Parent.md');
  const child = h.add('Child.md', { parent: '[[Parent]]' });
  const unsupported = [];
  for (let n = 0; n < 1000; n++) unsupported.push(h.add(`Binary/${n}.pdf`));
  const tasks = controlledParentTasks({ assert, h, cost: 0 });
  try {
    h.service.setup();
    await tasks.pump();
    assert.equal(h.service.knownFilePaths.size, 1002);
    assert.equal(h.counters.metadata, 2, 'native unsupported tracking is not a property read');
    assert.equal(tasks.pending, 0, 'cheap tracking does not force count-only task boundaries');
    const old = h.rename(unsupported[0], 'Moved/0.pdf');
    h.service.onFileRenamed(unsupported[0], old);
    h.files.delete(unsupported[1].path);
    h.service.onFileDeleted(unsupported[1]);
    assert.equal(h.service.knownFilesByPath.get('Moved/0.pdf'), unsupported[0]);
    assert.equal(h.service.knownFilePaths.has(unsupported[1]), false);
    assert.deepEqual(h.service.getChildrenForParent(parent), [child]);
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

const unvisitedTargetRaces = {
  'target deletion': (h, target) => {
    h.files.delete(target.path);
    h.dispatch.delete(target);
    return () => assert.equal(h.service.childrenByParentPath.has(target.path), false);
  },
  'target rename': (h, target) => {
    const old = h.rename(target, 'Moved/Target.md');
    h.dispatch.rename(target, old);
    return () => {
      assert.equal(h.service.childrenByParentPath.has(old), false);
      assert.deepEqual(h.service.getChildrenForParent(target), []);
    };
  },
  'containing folder deletion': (h, target) => {
    h.files.delete(target.path);
    h.dispatch.delete(new h.TFolder('Targets'));
    return () => assert.equal(h.service.childrenByParentPath.has(target.path), false);
  },
  'containing folder rename': (h, target) => {
    const old = h.rename(target, 'Moved/Target.md');
    h.dispatch.rename(new h.TFolder('Moved'), 'Targets');
    return () => {
      assert.equal(h.service.childrenByParentPath.has(old), false,
        'unvisited target had no known old path, but visited children must still be reconsidered');
      assert.deepEqual(h.service.getChildrenForParent(target), []);
    };
  },
};
for (const [name, mutate] of Object.entries(unvisitedTargetRaces)) {
  test(`initial cooperation Parent: visited child and unvisited ${name}`, async () => {
    const h = await initialCooperationFixture();
    const target = h.add('Targets/Target.md');
    h.frontmatter.set(h.child, { parent: '[[Targets/Target]]' });
    const tasks = controlledParentTasks({ assert, h });
    try {
      await beginHeldInitial(h, tasks);
      assert.equal(h.service.knownFilePaths.has(h.child), true);
      assert.equal(h.service.knownFilePaths.has(target), false);
      assert.ok(h.service.childrenByParentPath.get(target.path)?.has(h.child));
      const verify = mutate(h, target);
      await tasks.finish();
      verify();
      assert.equal(h.service.knownFilePaths.size, h.files.size);
      assertInitialReadOnly(h);
    } finally { h.unload(); tasks.restore(); }
  });
}

test('initial cooperation Parent: chained folder renames update visited unsupported members and old-path replacements', async () => {
  const h = await initialCooperationFixture();
  const unsupported = h.files.get('Queued/0.md');
  h.rename(unsupported, 'Targets/Visited.pdf');
  const target = h.add('Targets/Target.md');
  // Rename updates insertion order in this host. Make the unsupported member
  // genuinely visited while the later target remains queued at the first yield.
  const remaining = [...h.files.values()].filter(file => ![h.first, h.second, h.child, unsupported].includes(file));
  h.files.clear();
  for (const file of [h.first, h.second, h.child, unsupported, ...remaining]) h.files.set(file.path, file);
  h.frontmatter.set(h.child, { parent: '[[Targets/Target]]' });
  const tasks = controlledParentTasks({ assert, h });
  try {
    await beginHeldInitial(h, tasks);
    assert.equal(h.service.knownFilePaths.has(unsupported), true);
    assert.equal(h.service.knownFilePaths.has(target), false);
    h.rename(unsupported, 'Interim/Visited.pdf');
    h.rename(target, 'Interim/Target.md');
    h.dispatch.rename(new h.TFolder('Interim'), 'Targets');
    h.rename(unsupported, 'Final/Visited.pdf');
    h.rename(target, 'Final/Target.md');
    h.dispatch.rename(new h.TFolder('Final'), 'Interim');
    const replacement = h.add('Targets/Target.md');
    h.dispatch.create(replacement);
    await tasks.finish();
    assert.deepEqual(h.service.getChildrenForParent(replacement), [h.child]);
    assert.deepEqual(h.service.getChildrenForParent(target), []);
    assert.equal(h.service.knownFilesByPath.get('Final/Visited.pdf'), unsupported);
    assert.equal(h.service.knownFilesByPath.has('Targets/Visited.pdf'), false);
    assert.equal(h.service.knownFilesByPath.has('Interim/Visited.pdf'), false);
    assert.equal(h.service.knownFilePaths.size, h.files.size);
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: changes during final pending drain are not discarded', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h });
  try {
    await beginHeldInitial(h, tasks);
    const inventorySize = h.files.size;
    for (let n = 0; n < 20; n++) {
      const file = h.add(`Late/${n}.md`, { parent: '[[First]]' });
      h.dispatch.create(file);
    }
    let observedDrain = false;
    for (let n = 0; tasks.pending && n < 1000; n++) {
      if (h.service.knownFilePaths.size >= inventorySize + 1) { observedDrain = true; break; }
      await tasks.release();
    }
    assert.equal(observedDrain, true, 'pause after current pending work begins, not just the initial snapshot');
    const late = h.files.get('Late/0.md');
    h.frontmatter.set(late, { parent: '[[Second]]' });
    h.dispatch.changed(late);
    h.frontmatter.set(h.child, { parent: '[[Second]]' });
    h.dispatch.changed(h.child);
    await tasks.finish();
    assert.ok(h.service.getChildrenForParent(h.second).includes(late));
    assert.ok(h.service.getChildrenForParent(h.second).includes(h.child));
    assert.equal(h.service.getChildrenForParent(h.first).includes(late), false);
    assert.equal(h.service.knownFilePaths.size, h.files.size);
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: an explicit successful rebuild synchronously replaces and settles a held owner', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h });
  try {
    await beginHeldInitial(h, tasks);
    const initialGate = h.service.initialBuild;
    let settled = false;
    initialGate.then(() => { settled = true; });
    h.frontmatter.set(h.child, { parent: '[[Second]]' });
    assert.equal(h.service.rebuildRelationshipIndex('settings'), undefined, 'the existing explicit API remains synchronous');
    assert.equal(h.service.indexReady, true);
    assert.deepEqual(h.service.getChildrenForParent(h.second), [h.child]);
    await tasks.pump();
    assert.equal(settled, true, 'replacement releases the old completion gate even while its host task is paused');
    const count = h.counters.metadata;
    await tasks.release();
    await tasks.pump();
    assert.equal(h.counters.metadata, count, 'obsolete continuation cannot index over replacement');
    assert.equal(h.counters.invalidations, 0, 'explicit synchronous caller, not stale initial completion, owns its UI refresh');
    assertInitialReadOnly(h, 2);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: failed explicit replacement cannot publish late or retry automatically', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h });
  try {
    await beginHeldInitial(h, tasks);
    let settled = false;
    h.service.initialBuild.then(() => { settled = true; });
    const original = h.plugin.app.vault.getAllLoadedFiles;
    h.plugin.app.vault.getAllLoadedFiles = () => { h.counters.scans++; throw new Error('explicit inventory failed'); };
    assert.throws(() => h.service.rebuildRelationshipIndex(), /explicit inventory failed/u);
    h.plugin.app.vault.getAllLoadedFiles = original;
    await tasks.pump();
    assert.equal(settled, true);
    const before = h.counters.metadata;
    await tasks.release();
    await tasks.pump();
    h.resolveMetadata();
    h.service.setup();
    await h.service.onRelationshipSettingsChanged();
    assert.equal(h.service.indexReady, false);
    assert.equal(h.counters.metadata, before);
    assert.equal(h.counters.invalidations, 0);
    assertInitialReadOnly(h, 2);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: unchanged settings join discovery without canceling or duplicating it', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h });
  try {
    await beginHeldInitial(h, tasks);
    let saved = false;
    const saving = h.service.onRelationshipSettingsChanged().then(() => { saved = true; });
    await tasks.pump();
    assert.equal(saved, false);
    assert.equal(tasks.observations.length, 1);
    assert.equal(h.counters.scans, 1);
    await tasks.finish();
    await saving;
    assert.equal(saved, true);
    assert.equal(h.service.indexReady, true);
    assert.equal(h.counters.invalidations, 1);
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: a changed key replaces started unready discovery before its stale task resumes', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h });
  try {
    await beginHeldInitial(h, tasks);
    h.plugin.settings.parentLinkFrontmatterKey = 'relatedTo';
    h.frontmatter.set(h.child, { relatedTo: '[[Second]]' });
    let saved = false;
    const saving = h.service.onRelationshipSettingsChanged().then(() => { saved = true; });
    await tasks.pump();
    assert.equal(saved, true, 'settings replacement does not wait for the superseded host task');
    await saving;
    assert.equal(h.service.indexReady, true);
    assert.deepEqual(h.service.getChildrenForParent(h.second), [h.child]);
    const before = h.counters.metadata;
    await tasks.release();
    await tasks.pump();
    assert.equal(h.counters.metadata, before);
    assert.equal(h.counters.invalidations, 1, 'only the settings replacement publishes');
    assertInitialReadOnly(h, 2);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: settings before layout do not bypass proof for either equal or changed signatures', async () => {
  const h = await initialCooperationFixture({ initialized: false });
  const tasks = controlledParentTasks({ assert, h, cost: 0 });
  try {
    h.plugin.app.workspace.layoutReady = false;
    h.service.setup({ afterLayout: true });
    await h.service.onRelationshipSettingsChanged();
    h.plugin.settings.parentLinkFrontmatterKey = 'relatedTo';
    await h.service.onRelationshipSettingsChanged();
    assert.equal(h.counters.scans, 0);
    assert.equal(h.service.initialBuild, null);
    h.resolveMetadata();
    assert.equal(h.counters.scans, 0);
    h.layoutReady();
    await tasks.pump();
    assert.equal(h.service.indexReady, true);
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: scheduler rejection settles waiters and same-signature saves never retry', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h });
  const errorsBefore = (globalThis.__gcmParentIndexErrors || []).length;
  try {
    await beginHeldInitial(h, tasks);
    const saving = h.service.onRelationshipSettingsChanged();
    await tasks.fail(new Error('initial host task rejected'));
    await h.service.initialBuild;
    await saving;
    assert.equal(h.service.indexReady, false);
    assert.equal((globalThis.__gcmParentIndexErrors || []).length, errorsBefore + 1);
    const before = { ...h.counters };
    h.resolveMetadata();
    h.resolveMetadata();
    h.service.setup();
    await h.service.onRelationshipSettingsChanged();
    await tasks.pump();
    assert.deepEqual(h.counters, before);
    assert.equal(tasks.pending, 0);
    assert.equal(h.counters.invalidations, 0);
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: resolved during provisional discovery is drained before its first ready notification', async () => {
  const h = await initialCooperationFixture({ initialized: false });
  delete h.plugin.app.metadataCache.initialized;
  const target = h.add('Other/First.md');
  h.missingCache.add(h.child);
  const tasks = controlledParentTasks({ assert, h });
  try {
    h.service.setup();
    await new Promise(resolve => setTimeout(resolve, 0));
    await tasks.pump();
    assert.equal(tasks.pending, 1);
    assert.equal(h.service.indexReady, false);
    h.frontmatter.set(h.child, { parent: '[[Other/First]]' });
    h.missingCache.delete(h.child);
    h.resolveMetadata();
    h.resolveMetadata();
    await tasks.finish();
    assert.deepEqual(h.service.getChildrenForParent(target), [h.child]);
    assert.equal(h.service.provisionalStartupSeed, false);
    assert.equal(h.counters.invalidations, 1, 'resolved before first ready does not publish an obsolete provisional graph');
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: resolved catch-up cooperates and unload prevents its late refresh', async () => {
  const h = await initialCooperationFixture({ initialized: false });
  delete h.plugin.app.metadataCache.initialized;
  const tasks = controlledParentTasks({ assert, h, cost: 0 });
  try {
    h.service.setup();
    await new Promise(resolve => setTimeout(resolve, 0));
    await tasks.pump();
    assert.equal(h.service.indexReady, true);
    const before = h.counters.invalidations;
    const originalRead = h.plugin.app.metadataCache.getFileCache;
    h.plugin.app.metadataCache.getFileCache = file => { tasks.charge(2); return originalRead(file); };
    h.resolveMetadata();
    await tasks.pump();
    assert.equal(tasks.pending, 1, 'resolved catch-up cannot synchronously reread every provisional relationship');
    h.unload();
    const metadata = h.counters.metadata;
    await tasks.release();
    await tasks.pump();
    assert.equal(h.service.indexReady, false);
    assert.equal(h.service.knownFilePaths.size, 0);
    assert.equal(h.counters.metadata, metadata);
    assert.equal(h.counters.invalidations, before);
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

function deferredParentPrerequisite() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('initial cooperation Parent: accepted events during a held legacy prerequisite use the eventual current inventory', async () => {
  const h = await initialCooperationFixture({ mode: 'legacy' });
  const catalog = deferredParentPrerequisite();
  h.plugin.filePropertiesService.handleMetadataResolved = () => { h.counters.catalogBuilds++; return catalog.promise; };
  try {
    h.service.setup();
    assert.equal(h.counters.scans, 0);
    const stale = h.child;
    const current = h.add(stale.path, { parent: '[[Second]]' });
    h.dispatch.changed(current);
    const created = h.add('Created.md', { parent: '[[Second]]' });
    h.dispatch.create(created);
    const deleted = h.files.get('Queued/599.md');
    h.files.delete(deleted.path);
    h.dispatch.delete(deleted);
    const old = h.rename(h.first, 'Moved/First.md');
    h.dispatch.rename(h.first, old);
    catalog.resolve();
    await h.service.initialBuild;
    assert.deepEqual(h.service.getChildrenForParent(h.second), [current, created].sort((a, b) => a.path.localeCompare(b.path)));
    assert.equal(h.service.knownFilePaths.has(stale), false);
    assert.equal(h.service.knownFilePaths.size, h.files.size);
    assertInitialReadOnly(h, 1, 1);
  } finally { catalog.resolve(); h.unload(); }
});

test('initial cooperation Parent: same-signature legacy saves join the one catalog prerequisite', async () => {
  const h = await initialCooperationFixture({ mode: 'legacy' });
  const catalog = deferredParentPrerequisite();
  h.plugin.filePropertiesService.handleMetadataResolved = () => { h.counters.catalogBuilds++; return catalog.promise; };
  const tasks = controlledParentTasks({ assert, h, cost: 0 });
  try {
    h.service.setup();
    let settled = 0;
    const saves = [h.service.onRelationshipSettingsChanged(), h.service.onRelationshipSettingsChanged()]
      .map(promise => promise.then(() => { settled++; }));
    await tasks.pump();
    assert.equal(settled, 0);
    assert.equal(h.counters.catalogBuilds, 1);
    assert.equal(h.counters.scans, 0);
    catalog.resolve();
    await Promise.all(saves);
    assert.equal(settled, 2);
    assert.equal(h.service.indexReady, true);
    assert.equal(h.counters.invalidations, 1);
    assertInitialReadOnly(h, 1, 1);
  } finally { catalog.resolve(); h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: a changed native signature supersedes a started legacy prerequisite', async () => {
  const h = await initialCooperationFixture({ mode: 'legacy' });
  const catalog = deferredParentPrerequisite();
  h.plugin.filePropertiesService.handleMetadataResolved = () => { h.counters.catalogBuilds++; return catalog.promise; };
  const tasks = controlledParentTasks({ assert, h, cost: 0 });
  let saving;
  try {
    h.service.setup();
    h.plugin.settings.dataArchitectureMode = 'native-records';
    h.plugin.settings.parentLinkFrontmatterKey = 'relatedTo';
    h.frontmatter.set(h.child, { relatedTo: '[[Second]]' });
    let settled = false;
    saving = h.service.onRelationshipSettingsChanged().then(() => { settled = true; });
    await tasks.pump();
    assert.equal(settled, true, 'changed settings must not wait for an obsolete legacy catalog');
    assert.equal(h.service.indexReady, true);
    assert.deepEqual(h.service.getChildrenForParent(h.second), [h.child]);
    const before = { ...h.counters };
    catalog.resolve();
    await saving;
    await tasks.pump();
    assert.deepEqual(h.counters, before, 'obsolete catalog completion does no second scan/publication');
    assertInitialReadOnly(h, 1, 1);
  } finally { catalog.resolve(); await saving; h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: failed initial legacy proof cannot be retried by an unchanged save', async () => {
  const h = await initialCooperationFixture({ mode: 'legacy' });
  const catalog = deferredParentPrerequisite();
  h.plugin.filePropertiesService.handleMetadataResolved = () => { h.counters.catalogBuilds++; return catalog.promise; };
  const tasks = controlledParentTasks({ assert, h, cost: 0 });
  try {
    h.service.setup();
    catalog.reject(new Error('legacy proof failed'));
    await h.service.initialBuild;
    const before = { ...h.counters };
    h.resolveMetadata();
    h.service.setup();
    await h.service.onRelationshipSettingsChanged();
    assert.deepEqual(h.counters, before);
    assert.equal(h.service.indexReady, false);
    assertInitialReadOnly(h, 0, 1);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: overlapping changed legacy settings publish only the latest signature', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h, cost: 0 });
  const catalogs = [];
  h.plugin.filePropertiesService.setup = () => {
    h.counters.catalogBuilds++;
    const catalog = deferredParentPrerequisite();
    catalogs.push(catalog);
    return catalog.promise;
  };
  let firstSave, secondSave;
  try {
    h.service.setup();
    await h.service.initialBuild;
    h.plugin.settings.dataArchitectureMode = 'legacy';
    h.plugin.settings.parentLinkFrontmatterKey = 'firstKey';
    h.frontmatter.set(h.child, { firstKey: '[[First]]', finalKey: '[[Second]]' });
    firstSave = h.service.onRelationshipSettingsChanged();
    await tasks.pump();
    assert.equal(catalogs.length, 1);
    h.plugin.settings.parentLinkFrontmatterKey = 'finalKey';
    let secondSettled = false;
    secondSave = h.service.onRelationshipSettingsChanged().then(() => { secondSettled = true; });
    await tasks.pump();
    assert.equal(secondSettled, false, 'the second save cannot silently return while the current replacement is unready');
    h.resolveMetadata();
    for (const catalog of catalogs) catalog.resolve();
    await Promise.all([firstSave, secondSave]);
    assert.equal(h.service.indexReady, true);
    assert.deepEqual(h.service.getChildrenForParent(h.second), [h.child]);
    assert.equal(h.service.indexSettingsSignature, h.service.relationshipSettingsSignature());
    assert.equal(h.counters.invalidations, 2, 'initial plus latest settings owner, never stale settings publication');
    assert.equal(h.counters.rawReads + h.counters.writes, 0);
  } finally {
    for (const catalog of catalogs) catalog.resolve();
    await Promise.all([firstSave, secondSave]);
    h.unload(); tasks.restore();
  }
});

test('initial cooperation Parent: failed settings scan rejects both joined saves and never publishes an obsolete seed', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h, cost: 0 });
  const catalog = deferredParentPrerequisite();
  h.plugin.filePropertiesService.setup = () => { h.counters.catalogBuilds++; return catalog.promise; };
  let firstSave, joinedSave;
  try {
    h.service.setup();
    await h.service.initialBuild;
    h.plugin.settings.dataArchitectureMode = 'legacy';
    firstSave = h.service.onRelationshipSettingsChanged();
    await tasks.pump();
    joinedSave = h.service.onRelationshipSettingsChanged();
    // Attach both rejection observers before releasing the prerequisite.
    const outcomes = Promise.allSettled([firstSave, joinedSave]);
    const original = h.plugin.app.vault.getAllLoadedFiles;
    h.plugin.app.vault.getAllLoadedFiles = () => { h.counters.scans++; throw new Error('settings inventory failed'); };
    h.resolveMetadata();
    catalog.resolve();
    const result = await outcomes;
    h.plugin.app.vault.getAllLoadedFiles = original;
    assert.deepEqual(result.map(item => item.status), ['rejected', 'rejected'], 'all same-signature waiters observe the existing replacement error policy');
    for (const item of result) assert.match(String(item.reason), /settings inventory failed/u);
    assert.equal(h.service.indexReady, false);
    assert.equal(h.counters.invalidations, 1, 'only the original completed index was published');
    const before = { ...h.counters };
    await h.service.onRelationshipSettingsChanged();
    h.resolveMetadata();
    await tasks.pump();
    assert.deepEqual(h.counters, before, 'same failed configuration does not inventory/retry');
    assert.equal(h.counters.rawReads + h.counters.writes, 0);
  } finally { catalog.resolve(); h.unload(); tasks.restore(); }
});

for (const fail of [false, true]) test(`initial cooperation Parent: ${fail ? 'failed' : 'successful'} explicit replacement cancels held resolved catch-up`, async () => {
  const h = await initialCooperationFixture({ initialized: false });
  delete h.plugin.app.metadataCache.initialized;
  const tasks = controlledParentTasks({ assert, h, cost: 0 });
  try {
    h.service.setup();
    await new Promise(resolve => setTimeout(resolve, 0));
    await tasks.pump();
    const originalRead = h.plugin.app.metadataCache.getFileCache;
    h.plugin.app.metadataCache.getFileCache = file => { tasks.charge(2); return originalRead(file); };
    h.resolveMetadata();
    await tasks.pump();
    assert.equal(tasks.pending, 1);
    const original = h.plugin.app.vault.getAllLoadedFiles;
    if (fail) h.plugin.app.vault.getAllLoadedFiles = () => { h.counters.scans++; throw new Error('catch-up replacement failed'); };
    if (fail) assert.throws(() => h.service.rebuildRelationshipIndex(), /catch-up replacement failed/u);
    else assert.equal(h.service.rebuildRelationshipIndex(), undefined);
    h.plugin.app.vault.getAllLoadedFiles = original;
    const before = { ...h.counters };
    await tasks.release();
    await tasks.pump();
    h.resolveMetadata();
    await tasks.pump();
    assert.deepEqual(h.counters, before, 'obsolete catch-up cannot reindex or publish after explicit replacement');
    assert.equal(h.service.indexReady, !fail);
    assert.equal(h.service.provisionalStartupSeed, false);
    assert.equal(h.counters.rawReads + h.counters.writes, 0);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: public logical reads during suspension remain fresh and outside seed telemetry', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h });
  try {
    await beginHeldInitial(h, tasks);
    const before = h.service.seedDirectCacheLookups;
    const properties = { parent: '[[Second]]', title: 'Current unqueued public read' };
    h.frontmatter.set(h.child, properties);
    assert.equal(h.service.getLogicalFrontmatter(h.child), properties);
    assert.equal(h.service.seedDirectCacheLookups, before, 'a public operation is not discovery-owned merely because discovery is suspended');
    h.dispatch.changed(h.child);
    await tasks.finish();
    assert.deepEqual(h.service.getChildrenForParent(h.second), [h.child]);
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

function actualParentStartupHost(h) {
  // Execute every statement in the actual Main lifecycle. Unrelated UI/native
  // owners are registration-only facades, not a whole Obsidian workspace host.
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const owner = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'TPSGlobalContextMenuPlugin');
  assert.ok(owner);
  const methods = owner.members.filter(member => ts.isMethodDeclaration(member)
    && /^(?:onload|onunload|emitGcmApiChanged)$|startup|initializ/i.test(member.name.getText(tree)));
  const fields = owner.members.filter(member => ts.isPropertyDeclaration(member) && /startup|initializ/i.test(member.name.getText(tree)));
  for (const name of ['onload', 'onunload', 'emitGcmApiChanged']) {
    assert.ok(methods.some(member => member.name.getText(tree) === name));
  }
  const bindings = [];
  for (const node of tree.statements) {
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
  const registrations = { gcmEvents: 0, commands: 0, editors: 0, markdown: 0, dom: 0, settings: 0 };
  const layouts = [], cleanups = [];
  const metadataHandlers = new Map(), workspaceHandlers = new Map();
  h.plugin.app.metadataCache.on = (event, callback) => {
    const handlers = metadataHandlers.get(event) || [];
    handlers.push(callback); metadataHandlers.set(event, handlers); return {};
  };
  Object.assign(h.plugin.app.workspace, {
    layoutReady: false,
    on(event, callback) {
      const handlers = workspaceHandlers.get(event) || [];
      handlers.push(callback); workspaceHandlers.set(event, handlers); return {};
    },
    trigger(event, packet) { for (const callback of workspaceHandlers.get(event) || []) callback(packet); },
    onLayoutReady(callback) { if (this.layoutReady) callback(); else layouts.push(callback); },
    updateOptions() {},
  });
  // Pending native discovery makes accidental Parent-to-Native joins visible.
  const nativeReady = deferredParentPrerequisite();
  const dependencies = Object.fromEntries(bindings.map(name => [name, noop]));
  Object.assign(dependencies, {
    ParentLinkResolutionService: class { constructor(plugin) {
      const service = new h.service.constructor(plugin); h.service = service; return service;
    } },
    FilePropertiesService: class { constructor() { return h.plugin.filePropertiesService; } },
    NativeRecordService: class { setup() { return nativeReady.promise; } dispose() {} },
    PropertyMigrationService: class { active = false; async initialize() {} dispose() {} },
    Platform: { isMobile: false },
    TPS_EVENTS: { GCM_API_CHANGED: 'tps:gcm-api-changed', GCM_API_REQUEST: 'tps:gcm-api-request' },
    registerGcmEvents(plugin) {
      registrations.gcmEvents++;
      // Actual callback eligibility/order is exercised separately by the
      // register-events source-prefix controls above; this owns registration.
      h.plugin = plugin;
      h.dispatch = makeActualParentDispatch(h);
    },
    registerGcmCommands() { registrations.commands++; },
    window: { clearTimeout() {}, setTimeout() { return 1; }, setInterval() { return 1; } },
    setTimeout() { return 1; },
    document: { body: { classList: { remove() {} } } },
    TPSGlobalContextMenuPlugin: { BUILD_STAMP: 'actual-parent-full-onload-test' },
  });
  const code = ts.transpileModule(`export class Startup {
    ${fields.map(member => member.getText(tree)).join('\n')}
    ${methods.map(member => member.getText(tree)).join('\n')}
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(dependencies), code)(exports, ...Object.values(dependencies));
  const plugin = new Proxy(Object.assign(new exports.Startup(), h.plugin, {
    manifest: { id: 'tps-global-context-menu', dir: '.obsidian/plugins/tps-global-context-menu' },
    loadSettings: async () => {},
    usesNativeRecordArchitecture: () => true,
    shouldInstallWorkspaceOpenPatch: () => false,
    canRunBackgroundAutomation: () => false,
    register: callback => cleanups.push(callback),
    registerEditorExtension: () => registrations.editors++,
    registerMarkdownPostProcessor: () => registrations.markdown++,
    registerDomEvent: () => registrations.dom++,
    addSettingTab: () => registrations.settings++,
    registerInteractionHandlers: () => {},
  }), { get(target, key, receiver) { return key === 'api' || Reflect.has(target, key) ? Reflect.get(target, key, receiver) : noop; } });
  return {
    plugin, registrations,
    layout() {
      h.plugin.app.workspace.layoutReady = true;
      for (const callback of layouts.splice(0)) callback();
    },
    unload() {
      plugin.onunload();
      for (const cleanup of cleanups.slice().reverse()) cleanup();
      nativeReady.resolve(false);
    },
  };
}

test('initial cooperation actual full onload: surfaces and accepted callbacks are registered before Parent discovery resumes', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h });
  const startup = actualParentStartupHost(h);
  try {
    let loaded = false;
    await startup.plugin.onload().then(() => { loaded = true; });
    assert.equal(loaded, true);
    assert.equal(startup.registrations.gcmEvents, 1);
    assert.equal(startup.registrations.commands, 1);
    assert.ok(startup.registrations.editors >= 3);
    assert.equal(startup.registrations.markdown, 1);
    assert.equal(startup.registrations.settings, 1);
    assert.ok(startup.registrations.dom >= 4);
    assert.equal(h.counters.scans, 0, 'actual onload cannot seed before layout');
    startup.layout();
    await tasks.pump();
    assert.equal(tasks.pending, 1);
    assert.equal(h.service.indexReady, false);
    assert.equal(startup.plugin.api, undefined, 'Parent does not join or prematurely publish the pending Native owner');
    const created = h.add('During-main-discovery.md', { parent: '[[Second]]' });
    h.dispatch.create(created);
    await tasks.finish();
    assert.deepEqual(h.service.getChildrenForParent(h.second), [created]);
    assert.equal(h.service.knownFilePaths.size, h.files.size);
    assert.equal(h.counters.rawReads + h.counters.writes, 0);
  } finally { startup.unload(); tasks.restore(); }
});

async function holdReadyResolvedCatchup(h, tasks) {
  delete h.plugin.app.metadataCache.initialized;
  h.service.setup();
  await new Promise(resolve => setTimeout(resolve, 0));
  await tasks.pump();
  assert.equal(h.service.indexReady, true);
  const originalRead = h.plugin.app.metadataCache.getFileCache;
  h.plugin.app.metadataCache.getFileCache = file => { tasks.charge(2); return originalRead(file); };
  h.resolveMetadata();
  await tasks.pump();
  assert.equal(tasks.pending, 1);
  assert.equal(h.service.indexReady, true, 'a late catch-up preserves the existing visible provisional stage');
}

test('initial cooperation Parent: ready catch-up preserves synchronous normal lifecycle return paths and graph updates', async () => {
  const h = await initialCooperationFixture({ initialized: false });
  const tasks = controlledParentTasks({ assert, h, cost: 0 });
  try {
    await holdReadyResolvedCatchup(h, tasks);
    h.frontmatter.set(h.child, { parent: '[[Second]]' });
    assert.deepEqual(new Set(h.service.onMetadataChanged(h.child)), new Set([h.first.path, h.second.path]));
    assert.deepEqual(h.service.getChildrenForParent(h.second), [h.child]);
    const created = h.add('Created-ready.md', { parent: '[[Second]]' });
    assert.deepEqual(h.service.onFileCreated(created), [h.second.path]);
    assert.deepEqual(new Set(h.service.getChildrenForParent(h.second)), new Set([h.child, created]));
    const old = h.rename(h.child, 'Moved/Child.md');
    assert.deepEqual(h.service.onFileRenamed(h.child, old), [h.second.path]);
    assert.equal(h.service.knownFilesByPath.has(old), false);
    h.files.delete(created.path);
    assert.deepEqual(h.service.onFileDeleted(created), [h.second.path]);
    assert.deepEqual(h.service.getChildrenForParent(h.second), [h.child]);
    while (tasks.pending) await tasks.release();
    await tasks.pump();
    assert.deepEqual(h.service.getChildrenForParent(h.second), [h.child]);
    assert.equal(h.service.knownFilePaths.has(created), false);
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: rejected late catch-up keeps its prior ready index and releases its owner once', async () => {
  const h = await initialCooperationFixture({ initialized: false });
  const tasks = controlledParentTasks({ assert, h, cost: 0 });
  const errorsBefore = (globalThis.__gcmParentIndexErrors || []).length;
  try {
    await holdReadyResolvedCatchup(h, tasks);
    const owner = h.service.indexBuild;
    assert.ok(owner);
    const outcome = owner.promise.catch(error => error);
    await tasks.fail(new Error('resolved host task failed'));
    assert.match(String(await outcome), /resolved host task failed/u);
    assert.equal(h.service.indexBuild, null);
    assert.equal(h.service.indexReady, true, 'the existing late catch-up failure policy does not discard an already-ready graph');
    assert.equal((globalThis.__gcmParentIndexErrors || []).length, errorsBefore + 1);
    const before = { ...h.counters };
    h.resolveMetadata(); h.resolveMetadata();
    await tasks.pump();
    assert.deepEqual(h.counters, before);
    assert.equal(tasks.pending, 0);
    h.frontmatter.set(h.child, { parent: '[[Second]]' });
    assert.deepEqual(new Set(h.service.onMetadataChanged(h.child)), new Set([h.first.path, h.second.path]));
    assert.deepEqual(h.service.getChildrenForParent(h.second), [h.child]);
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: unsaved signature change settles obsolete discovery without claiming readiness', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h });
  try {
    await beginHeldInitial(h, tasks);
    h.plugin.settings.parentLinkFrontmatterKey = 'laterKey';
    h.frontmatter.set(h.child, { laterKey: '[[Second]]' });
    const before = h.counters.metadata;
    await tasks.release();
    await tasks.finish();
    assert.equal(h.service.indexBuild, null);
    assert.equal(h.service.indexReady, false);
    assert.equal(h.counters.metadata, before);
    assert.equal(h.counters.invalidations, 0);
    await h.service.onRelationshipSettingsChanged();
    assert.equal(h.service.indexReady, true);
    assert.deepEqual(h.service.getChildrenForParent(h.second), [h.child]);
    assertInitialReadOnly(h, 2);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: an undefined initial scheduler rejection is still one logged failure', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h });
  const errorsBefore = (globalThis.__gcmParentIndexErrors || []).length;
  try {
    await beginHeldInitial(h, tasks);
    await tasks.fail(undefined);
    await h.service.initialBuild;
    assert.equal(h.service.indexReady, false);
    assert.equal((globalThis.__gcmParentIndexErrors || []).length, errorsBefore + 1);
    assert.equal(globalThis.__gcmParentIndexErrors.at(-1)[1].error, undefined, 'do not manufacture or erase the rejection value');
    const before = { ...h.counters };
    await h.service.onRelationshipSettingsChanged();
    h.resolveMetadata();
    await tasks.pump();
    assert.deepEqual(h.counters, before);
    assert.equal(tasks.pending, 0);
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: an undefined settings prerequisite failure rejects both joined saves unchanged', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h, cost: 0 });
  const catalog = deferredParentPrerequisite();
  h.plugin.filePropertiesService.setup = () => { h.counters.catalogBuilds++; return catalog.promise; };
  try {
    h.service.setup();
    await h.service.initialBuild;
    h.plugin.settings.dataArchitectureMode = 'legacy';
    const first = h.service.onRelationshipSettingsChanged();
    await tasks.pump();
    const second = h.service.onRelationshipSettingsChanged();
    const outcomes = Promise.allSettled([first, second]);
    catalog.reject(undefined);
    const results = await outcomes;
    assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected']);
    assert.equal(results[0].reason, undefined);
    assert.equal(results[1].reason, undefined);
    assert.equal(h.service.indexReady, false);
    assert.equal(h.service.indexBuild, null);
    assert.equal(h.counters.invalidations, 1);
    const before = { ...h.counters };
    await h.service.onRelationshipSettingsChanged();
    assert.deepEqual(h.counters, before);
    assertInitialReadOnly(h, 1, 1);
  } finally { h.unload(); tasks.restore(); }
});


test('initial cooperation Parent: inventory cost reaches the task budget before metadata work', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h });
  const inventory = h.plugin.app.vault.getAllLoadedFiles;
  h.plugin.app.vault.getAllLoadedFiles = () => {
    const files = inventory();
    tasks.charge(12); // One atomic inventory can itself exceed the 8 ms budget.
    return files;
  };
  try {
    await beginHeldInitial(h, tasks);
    assert.equal(tasks.observations[0].cpu, 12, 'yield immediately after the atomic inventory');
    assert.equal(h.counters.metadata, 0, 'do not append another metadata slice to an over-budget inventory');
    await tasks.finish();
    assert.deepEqual(h.service.getChildrenForParent(h.first).includes(h.child), true);
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

test('initial cooperation Parent: folder entries cannot bypass the elapsed task budget', async () => {
  const h = await initialCooperationFixture();
  const tasks = controlledParentTasks({ assert, h, cost: 0 });
  const inventory = h.plugin.app.vault.getAllLoadedFiles;
  h.plugin.app.vault.getAllLoadedFiles = () => {
    const files = inventory();
    const folders = Array.from({ length: 20 }, (_, i) => new h.TFolder(`Folders/${i}`));
    const candidates = [...folders, ...files];
    candidates[Symbol.iterator] = function* () {
      for (const folder of folders) { tasks.charge(8); yield folder; }
      yield* files;
    };
    return candidates;
  };
  try {
    await beginHeldInitial(h, tasks);
    assert.equal(tasks.observations[0].cpu, 8, 'a folder-only slice yields at its budget');
    assert.equal(h.counters.metadata, 0);
    await tasks.finish();
    assert.equal(tasks.observations.length, 20);
    assert.deepEqual(h.service.getChildrenForParent(h.first).includes(h.child), true);
    assertInitialReadOnly(h);
  } finally { h.unload(); tasks.restore(); }
});

for (const fallback of ['MessageChannel', 'setTimeout']) {
  test(`initial cooperation Parent: 10000 notes use actual ${fallback} tasks and preserve every relationship`, async () => {
    const h = await makeHarness({ initialized: true });
    const parents = Array.from({ length: 100 }, (_, n) => h.add(`Parents/${n}.md`));
    const expected = new Map(parents.map(parent => [parent, []]));
    for (let n = 0; n < 9900; n++) {
      const parent = parents[n % parents.length];
      const child = h.add(`Tasks/${String(n).padStart(5, '0')}.md`, { parent: `[[${parent.path}]]` });
      expected.get(parent).push(child);
    }
    const saved = ['performance', 'scheduler', 'MessageChannel'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    const NativeMessageChannel = globalThis.MessageChannel;
    assert.equal(typeof NativeMessageChannel, 'function');
    let cpu = 0;
    const cache = h.plugin.app.metadataCache.getFileCache;
    h.plugin.app.metadataCache.getFileCache = file => { cpu += 2; return cache(file); };
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => cpu } });
    Object.defineProperty(globalThis, 'scheduler', { configurable: true, value: undefined });
    Object.defineProperty(globalThis, 'MessageChannel', { configurable: true, value: fallback === 'MessageChannel' ? NativeMessageChannel : undefined });
    let sentinel = null;
    const timer = setTimeout(() => {
      sentinel = { metadata: h.counters.metadata, ready: h.service.indexReady };
    }, 0);
    try {
      h.service.setup();
      // Resolved-promise checkpoints only drain microtasks and cannot let this timer run.
      await h.service.initialBuild;
      assert.ok(sentinel, 'a real host timer ran before initial indexing completed');
      assert.equal(sentinel.ready, false);
      assert.ok(sentinel.metadata >= 4 && sentinel.metadata < 10000, 'host work interleaves with the initial scan');
      assert.equal(h.counters.scans, 1);
      assert.equal(h.counters.metadata, 10000);
      assert.equal(h.service.knownFilePaths.size, 10000);
      assert.equal(h.counters.invalidations, 1);
      for (const [parent, children] of expected) assert.deepEqual(h.service.getChildrenForParent(parent), children);
      const { PersistentLookupHarness } = await persistentHarnessPromise;
      const navigation = new PersistentLookupHarness(h.plugin);
      const scans = h.counters.scans;
      for (let n = 0; n < 50; n++) {
        h.setActive(parents[n % 100]); h.setMounted([parents[n % 100]]);
        assert.deepEqual(navigation.children(parents[n % 100]), expected.get(parents[n % 100]));
      }
      assert.equal(h.counters.scans, scans, 'note/tab navigation does not inventory again');
      assert.equal(h.counters.rawReads, 0);
      assert.equal(h.counters.writes, 0);
      console.log(`# ${fallback}: 10000 notes; inventory=1; initialMetadata=10000; navigationInventories=0; reads=0; writes=0; real timer observed at ${sentinel.metadata} notes`);
    } finally {
      clearTimeout(timer); h.unload();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  });
}


test('initial cooperation Parent: actual file-open and tab callbacks reuse the ready relationship index', async () => {
  const h = await makeActualParentPropertiesHarness();
  const parent = h.add('Parent.md');
  const child = h.add('Child.md', { parent: '[[Parent]]' });
  const { PersistentLookupHarness } = await persistentHarnessPromise;
  const navigation = new PersistentLookupHarness(h.plugin);
  h.plugin.canRunBackgroundAutomation = () => false;
  h.plugin.notebookNavigatorRuleService = { shouldAutoApplyOnFileOpen: () => false };
  h.plugin.viewModeSuppressedPaths = new Set();
  h.service.setup();
  await h.service.initialBuild;
  h.setActive(parent); h.setMounted([parent]);
  const renderChildren = file => assert.deepEqual(navigation.children(file || parent), [child]);
  const source = readFileSync(new URL('../src/events/register-events.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('register-events.ts', source, ts.ScriptTarget.Latest, true);
  const callbacks = new Map();
  for (const event of ['file-open', 'active-leaf-change']) {
    const matches = [];
    const visit = node => {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 'plugin.app.workspace.on'
        && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === event) matches.push(node.arguments[1]);
      ts.forEachChild(node, visit);
    };
    visit(tree); assert.equal(matches.length, 1);
    const compiled = ts.transpileModule(`const callback = ${matches[0].getText(tree)};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    callbacks.set(event, new Function('plugin', 'TFile', 'Platform', 'logger',
      'refreshActiveInlineTitle', 'overlayRendering', 'scheduleSubitemRefresh',
      'throttledEnsureMenus', 'throttledEnsureLinkedSubitemCheckboxes',
      `${compiled}; return callback;`)(h.plugin, h.TFile, { isMobile: false }, { perf() {} },
      () => {}, { scheduleMenus: () => renderChildren(parent) }, renderChildren,
      () => renderChildren(parent), () => {}));
  }
  const scans = h.counters.scans;
  try {
    for (let n = 0; n < 50; n++) {
      callbacks.get('file-open')(parent);
      callbacks.get('active-leaf-change')();
    }
    assert.equal(h.counters.scans, scans, '100 actual navigation callbacks do not inventory again');
    assertActualParentReadOnly(h);
  } finally { h.unload(); }
});
