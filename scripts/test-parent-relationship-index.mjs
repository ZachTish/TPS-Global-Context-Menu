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
  await tick();
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
    await tick();
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
    await tick();
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
  await tick();
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
  await tick();
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
  await tick();
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
  await tick();
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
  await tick();
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
  await tick();
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
  await tick();
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
  await tick();
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
