import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-notebook-presentation-test-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({
          path: 'obsidian-notebook-presentation-test-stub',
          namespace: 'obsidian-notebook-presentation-test-stub',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'obsidian-notebook-presentation-test-stub' }, () => ({
          contents: `
            export class TFile {
              static [Symbol.hasInstance](value) {
                return Boolean(value && typeof value.path === 'string' && typeof value.extension === 'string');
              }
            }
            export class TFolder {}
            export class Notice {}
            export function normalizePath(path) {
              return String(path || '').replace(/\\\\/gu, '/').replace(/\\/+/gu, '/');
            }
            export function setIcon() {}
            export function parseYaml() { return {}; }
            export function stringifyYaml(value) { return JSON.stringify(value); }
            export function moment(value) { return globalThis.__presentationMoment(value); }
            moment.ISO_8601 = 'ISO_8601';
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function createEmitter() {
  const listeners = new Map();
  return {
    on(name, callback) {
      const callbacks = listeners.get(name) ?? new Set();
      callbacks.add(callback);
      listeners.set(name, callbacks);
      return () => callbacks.delete(callback);
    },
    emit(name, ...args) {
      for (const callback of Array.from(listeners.get(name) ?? [])) callback(...args);
    },
  };
}

function makeFile(path) {
  const name = path.split('/').at(-1);
  const extension = name.includes('.') ? name.split('.').at(-1) : '';
  return {
    path,
    name,
    basename: name.replace(/\.[^.]+$/u, ''),
    extension,
    stat: { ctime: 1_725_000_000_000, mtime: 1_735_000_000_000 },
  };
}

function visualRule() {
  return {
    id: 'urgent-body',
    name: 'Urgent body',
    enabled: true,
    property: '',
    operator: 'is',
    value: '',
    pathPrefix: '',
    icon: 'alert-triangle',
    color: '#ff0000',
    match: 'all',
    conditions: [{ source: 'body', field: '', operator: 'contains', value: 'urgent' }],
  };
}

function makeFixture() {
  const metadataEvents = createEmitter();
  const vaultEvents = createEmitter();
  const filesUpdatedListeners = new Set();
  const parent = makeFile('Notes/Parent.md');
  const child = makeFile('Notes/Child.md');
  const unrelated = makeFile('Notes/Unrelated.md');
  const files = new Map([parent, child, unrelated].map((file) => [file.path, file]));
  const frontmatter = new Map([
    [parent.path, { status: 'focus' }],
    [child.path, { parent: '[[Parent]]' }],
    [unrelated.path, {}],
  ]);
  const bodies = new Map([
    [parent.path, 'Parent body'],
    [child.path, 'ordinary body'],
    [unrelated.path, 'Unrelated body'],
  ]);
  const reads = new Map();
  const deferredReads = new Map();
  let writes = 0;

  const settings = {
    notebookNavigatorRules: {
      enabled: true,
      frontmatterWriteExclusions: '',
      frontmatterIconField: 'icon',
      frontmatterColorField: 'color',
      clearIconWhenNoMatch: false,
      clearColorWhenNoMatch: false,
      rules: [visualRule()],
      hideRules: [],
      smartSort: {
        enabled: true,
        field: 'ICON',
        separator: '_',
        appendBasename: true,
        relationshipGrouping: 'none',
        clearWhenNoMatch: false,
        buckets: [{
          id: 'generated-icon-and-parent',
          name: 'Generated icon and parent',
          enabled: true,
          match: 'all',
          conditions: [
            { source: 'frontmatter', field: 'icon', operator: 'is', value: 'alert-triangle' },
            { source: 'parent-frontmatter', field: 'status', operator: 'is', value: 'focus' },
          ],
          conditionGroups: [],
          sortCriteria: [],
        }],
      },
    },
  };

  const app = {
    plugins: { plugins: {} },
    internalPlugins: { plugins: {} },
    metadataCache: {
      on: metadataEvents.on,
      getFileCache(file) {
        return { frontmatter: frontmatter.get(file.path) ?? {}, tags: [] };
      },
    },
    vault: {
      on: vaultEvents.on,
      getFileByPath(path) {
        return files.get(path) ?? null;
      },
      getAbstractFileByPath(path) {
        return files.get(path) ?? null;
      },
      getFiles() {
        return Array.from(files.values());
      },
      async cachedRead(file) {
        reads.set(file.path, (reads.get(file.path) ?? 0) + 1);
        const captured = bodies.get(file.path) ?? '';
        const deferred = deferredReads.get(file.path);
        if (deferred) {
          deferredReads.delete(file.path);
          deferred.started();
          return new Promise((resolve) => {
            deferred.release = () => resolve(captured);
          });
        }
        return captured;
      },
      async modify() {
        writes += 1;
      },
      async process() {
        writes += 1;
      },
    },
    workspace: {
      getActiveFile: () => null,
    },
  };

  const registered = [];
  const plugin = {
    app,
    settings,
    manifest: { id: 'tps-global-context-menu' },
    registerEvent(ref) {
      registered.push(ref);
      return ref;
    },
    register(disposer) {
      registered.push(disposer);
      return disposer;
    },
    canRunBackgroundAutomation: () => true,
    filePropertiesService: {
      isCompanionFile: () => false,
      isPropertyTarget: () => false,
      hasCompanion: () => false,
    },
    parentLinkResolutionService: {
      getParentsForChild(file) {
        return file.path === child.path ? [{ file: parent }] : [];
      },
    },
    nativeRecordService: { inspect: () => null },
    sharedServices: {
      visualMetadata: {
        getIconField: () => settings.notebookNavigatorRules.frontmatterIconField,
        getColorField: () => settings.notebookNavigatorRules.frontmatterColorField,
      },
    },
    eventService: {
      onFilesUpdated(callback) {
        filesUpdatedListeners.add(callback);
        return () => filesUpdatedListeners.delete(callback);
      },
    },
  };
  app.plugins.plugins['tps-global-context-menu'] = plugin;

  return {
    app,
    plugin,
    settings,
    metadataEvents,
    vaultEvents,
    parent,
    child,
    unrelated,
    frontmatter,
    bodies,
    reads,
    getWrites: () => writes,
    deferNextRead(file) {
      let startedResolve;
      const startedPromise = new Promise((resolve) => { startedResolve = resolve; });
      const deferred = { started: startedResolve, release: () => {} };
      deferredReads.set(file.path, deferred);
      return {
        started: startedPromise,
        release: () => deferred.release(),
      };
    },
  };
}

globalThis.__presentationMoment = () => ({
  isValid: () => false,
  format: () => '',
});
globalThis.window = {
  setTimeout,
  clearTimeout,
  moment: globalThis.__presentationMoment,
};

const { NotebookNavigatorRuleService } = await importBundled(
  '../src/services/notebook-navigator-rule-service.ts',
);

test('presentation cache is read-only, collision-accurate, body-aware, and dependency-invalidated', async (t) => {
  const fixture = makeFixture();
  const service = new NotebookNavigatorRuleService(fixture.plugin);
  service.setupPresentationProjection();
  t.after(() => service.dispose());

  const revisions = [];
  const unsubscribe = service.onNotebookNavigatorPresentationChanged((revision) => revisions.push(revision));

  assert.equal(service.getNotebookNavigatorPresentation(fixture.child), undefined);

  const deferred = fixture.deferNextRead(fixture.child);
  const firstEnsure = service.ensureNotebookNavigatorPresentation([fixture.child]);
  await deferred.started;
  fixture.bodies.set(fixture.child.path, 'urgent body changed while the first read was pending');
  fixture.vaultEvents.emit('modify', fixture.child);
  deferred.release();
  await firstEnsure;

  assert.equal(fixture.reads.get(fixture.child.path), 2, 'a stale async read must retry only its own path');
  assert.deepEqual(service.getNotebookNavigatorPresentation(fixture.child), {
    filePath: fixture.child.path,
    values: {
      color: '#ff0000',
      ICON: '000_Child',
    },
  });
  assert.equal(
    Object.isFrozen(service.getNotebookNavigatorPresentation(fixture.child).values),
    true,
  );
  assert.equal(fixture.getWrites(), 0, 'projection must not call a vault mutation path');

  await service.ensureNotebookNavigatorPresentation([fixture.child]);
  assert.equal(fixture.reads.get(fixture.child.path), 2, 'prepared entries must be served from cache');

  const revisionBeforeUnrelated = service.getNotebookNavigatorPresentationRevision();
  fixture.vaultEvents.emit('modify', fixture.unrelated);
  await Promise.resolve();
  assert.equal(
    service.getNotebookNavigatorPresentationRevision(),
    revisionBeforeUnrelated,
    'an unrelated unprepared file must not publish a projection revision',
  );

  fixture.frontmatter.get(fixture.parent.path).status = 'other';
  fixture.metadataEvents.emit('changed', fixture.parent);
  assert.equal(
    service.getNotebookNavigatorPresentation(fixture.child),
    undefined,
    'a parent metadata change must stale the prepared child synchronously',
  );
  await service.ensureNotebookNavigatorPresentation([fixture.child]);
  assert.deepEqual(service.getNotebookNavigatorPresentation(fixture.child), {
    filePath: fixture.child.path,
    values: {
      color: '#ff0000',
      ICON: '001_Child',
    },
  });

  const unrelatedDeferred = fixture.deferNextRead(fixture.unrelated);
  const unrelatedEnsure = service.ensureNotebookNavigatorPresentation([fixture.unrelated]);
  await unrelatedDeferred.started;
  fixture.vaultEvents.emit('modify', fixture.child);
  unrelatedDeferred.release();
  await unrelatedEnsure;
  assert.equal(
    fixture.reads.get(fixture.unrelated.path),
    1,
    'a path-local invalidation must not cancel or retry an unrelated in-flight ensure',
  );
  assert.notEqual(service.getNotebookNavigatorPresentation(fixture.unrelated), undefined);

  fixture.bodies.set(fixture.child.path, 'ordinary body');
  fixture.vaultEvents.emit('modify', fixture.child);
  assert.equal(service.getNotebookNavigatorPresentation(fixture.child.path), undefined);
  await service.ensureNotebookNavigatorPresentation([fixture.child.path]);
  assert.deepEqual(service.getNotebookNavigatorPresentation(fixture.child.path), {
    filePath: fixture.child.path,
    values: { ICON: '001_Child' },
  });

  fixture.settings.notebookNavigatorRules.smartSort.enabled = false;
  service.invalidateNotebookNavigatorPresentation();
  assert.equal(service.getNotebookNavigatorPresentation(fixture.child), undefined);
  await service.ensureNotebookNavigatorPresentation([fixture.child]);
  assert.equal(
    service.getNotebookNavigatorPresentation(fixture.child),
    null,
    'prepared files with no generated destination values use null, not stale/undefined',
  );

  assert.ok(revisions.length >= 3);
  const revisionCount = revisions.length;
  unsubscribe();
  service.invalidateNotebookNavigatorPresentation();
  await Promise.resolve();
  assert.equal(revisions.length, revisionCount, 'onChanged must return a working unsubscribe');
});

test('plugin wires the exact top-level notebookNavigatorPresentation v1 contract and lifecycle', () => {
  const apiSource = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  assert.match(apiSource, /const notebookNavigatorPresentationApi = \{[\s\S]{0,900}version:\s*1,[\s\S]{0,900}ensure:[\s\S]{0,900}get:[\s\S]{0,900}getRevision:[\s\S]{0,900}onChanged:/u);
  assert.match(apiSource, /notebookNavigatorPresentation:\s*notebookNavigatorPresentationApi/u);
  assert.match(mainSource, /notebookNavigatorRuleService\.setupPresentationProjection\(\)/u);
  assert.match(mainSource, /saveSettings\(\)[\s\S]{0,1800}invalidateNotebookNavigatorPresentation\(\)/u);
});
