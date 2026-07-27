import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function importBundled(relativePath) {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

async function importServiceBundled() {
  const build = await esbuild.build({
    stdin: {
      contents: `
        export { EntityIndexService } from '../src/services/entity-index-service.ts';
        export { TAbstractFile, TFile } from 'obsidian';
      `,
      resolveDir: fileURLToPath(new URL('.', import.meta.url)),
      sourcefile: 'entity-index-service-harness.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'obsidian-test-double',
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({
          path: 'obsidian',
          namespace: 'entity-index-test',
        }));
        build.onLoad(
          { filter: /.*/, namespace: 'entity-index-test' },
          () => ({
            loader: 'js',
            contents: `
              export class TAbstractFile {
                constructor(path = '') {
                  this.path = path;
                }
              }
              export class TFile extends TAbstractFile {
                constructor(path, basename, extension = 'md') {
                  super(path);
                  this.basename = basename ?? path.split('/').pop().replace(/\\.[^.]+$/, '');
                  this.extension = extension;
                }
              }
            `,
          }),
        );
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

const corePromise = importBundled('../src/services/entity-index-core.ts');
const servicePromise = importServiceBundled();

const sources = [
  {
    path: 'Projects/Atlas.md',
    basename: 'Atlas',
    frontmatter: {
      kind: 'Project',
      portfolio: ['Work', 'Strategic'],
      state: 'Active',
    },
  },
  {
    path: 'Projects/beacon.md',
    basename: 'Beacon',
    frontmatter: {
      KIND: ['project', 'Initiative'],
      portfolio: 'Personal',
      state: 'Active',
    },
  },
  {
    path: 'People/Ada.md',
    basename: 'Ada',
    frontmatter: {
      kind: 'Person',
      portfolio: 'Work',
      state: 'Inactive',
    },
  },
  {
    path: 'Projects/Archived.md',
    basename: 'Archived',
    frontmatter: {
      kind: 'Project',
      portfolio: 'Work',
      state: 'Inactive',
    },
  },
];

function configuredCore(EntityIndexCore) {
  const index = new EntityIndexCore();
  index.configureDimensions([
    { name: 'kind', propertyKeys: ['kind', 'entityType'] },
    { name: 'portfolio', propertyKeys: ['portfolio'] },
    { name: 'lifecycle', propertyKeys: ['state'] },
  ]);
  index.rebuild(sources);
  return index;
}

test('indexes scalar and array frontmatter without hardcoding dimension names or values', async () => {
  const { EntityIndexCore } = await corePromise;
  const index = configuredCore(EntityIndexCore);

  assert.deepEqual(index.getDimensionValues('KIND'), ['Initiative', 'Person', 'Project']);
  assert.deepEqual(index.getDimensionValues('portfolio'), ['Personal', 'Strategic', 'Work']);
  assert.deepEqual(
    index.query({ dimensions: { kind: 'PROJECT' } }).map((record) => record.path),
    ['Projects/Archived.md', 'Projects/Atlas.md', 'Projects/beacon.md'],
  );
  assert.deepEqual(
    index.query({ dimensions: { lifecycle: 'active' } }).map((record) => record.path),
    ['Projects/Atlas.md', 'Projects/beacon.md'],
  );
  assert.deepEqual(
    index.query({
      dimensions: {
        kind: { anyOf: ['project'] },
        portfolio: { noneOf: 'Personal' },
      },
    }).map((record) => record.path),
    ['Projects/Archived.md', 'Projects/Atlas.md'],
    'per-dimension predicates support picker-friendly anyOf constraints',
  );
});

test('combines allOf, anyOf, and noneOf with case-insensitive exact matching', async () => {
  const { EntityIndexCore } = await corePromise;
  const index = configuredCore(EntityIndexCore);

  assert.deepEqual(
    index.query({
      allOf: {
        kind: ['PROJECT', 'initiative'],
        lifecycle: 'active',
      },
      anyOf: {
        portfolio: ['work', 'personal'],
        kind: 'person',
      },
      noneOf: {
        portfolio: 'strategic',
        lifecycle: 'inactive',
      },
    }).map((record) => record.path),
    ['Projects/beacon.md'],
  );
  assert.deepEqual(
    index.query({ dimensions: { kind: 'pro' } }),
    [],
    'dimension matching is exact rather than a substring match',
  );
  assert.deepEqual(
    index.query({
      dimensions: { kind: 'project' },
      allOf: { kind: 'initiative' },
    }).map((record) => record.path),
    ['Projects/beacon.md'],
    'the dimensions alias combines additively with explicit allOf constraints',
  );
});

test('returns deterministically sorted, immutable records and revision-cached query arrays', async () => {
  const { EntityIndexCore } = await corePromise;
  const index = configuredCore(EntityIndexCore);
  const query = { dimensions: { kind: ['project', 'initiative'] } };
  const first = index.query(query);
  const second = index.query({
    dimensions: { KIND: ['Initiative', 'PROJECT'] },
  });

  assert.equal(first, second, 'semantically equivalent exact queries share the cache entry');
  assert.deepEqual(first.map((record) => record.basename), ['Archived', 'Atlas', 'Beacon']);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first[0]));
  assert.ok(Object.isFrozen(first[0].dimensions));
  assert.ok(Object.isFrozen(first[0].dimensions.kind));
  assert.equal(first[0].displayName, first[0].name);
  assert.throws(() => first.push(first[0]), TypeError);
  assert.throws(() => {
    first[0].dimensions.kind[0] = 'Changed';
  }, TypeError);

  const firstDimensionValues = index.getDimensionValues('kind');
  assert.equal(
    index.getDimensionValues('KIND'),
    firstDimensionValues,
    'dimension-value scans are cached until the revision changes',
  );
  for (let searchIndex = 0; searchIndex < 300; searchIndex += 1) {
    index.query({ search: `cache-entry-${searchIndex}` });
  }
  assert.ok(
    index.queryCache.size <= 256,
    'distinct searches cannot grow the revision query cache without bound',
  );
});

test('incremental upserts and removals mutate exactly once and invalidate only affected caches', async () => {
  const { EntityIndexCore } = await corePromise;
  const index = configuredCore(EntityIndexCore);
  const revisions = [];
  const unsubscribe = index.onChanged((revision) => revisions.push(revision));
  const initialRevision = index.getRevision();
  const cached = index.query({ dimensions: { kind: 'project' } });

  const unchanged = index.upsert(sources[0]);
  assert.equal(unchanged?.path, 'Projects/Atlas.md');
  assert.equal(index.getRevision(), initialRevision, 'an identical upsert is a no-op');
  assert.equal(
    index.query({ dimensions: { kind: 'project' } }),
    cached,
    'an identical upsert keeps the cached result',
  );

  index.upsert({
    id: 'entity:atlas',
    path: 'Projects/Atlas.md',
    basename: 'Atlas',
    frontmatter: {
      kind: 'Area',
      portfolio: 'Work',
      state: 'Active',
    },
  });
  assert.equal(index.getRevision(), initialRevision + 1);
  assert.equal(index.getById('ENTITY:ATLAS')?.path, 'Projects/Atlas.md');
  assert.equal(index.getByPath('projects\\atlas.md')?.id, 'entity:atlas');
  assert.notEqual(index.query({ dimensions: { kind: 'project' } }), cached);
  assert.deepEqual(
    index.query({ dimensions: { kind: 'project' } }).map((record) => record.basename),
    ['Archived', 'Beacon'],
  );

  const beforeMissingRemoval = index.query();
  const revisionBeforeMissingRemoval = index.getRevision();
  assert.equal(index.removeByPath('Projects/Missing.md'), false);
  assert.equal(index.getRevision(), revisionBeforeMissingRemoval);
  assert.equal(index.query(), beforeMissingRemoval);

  assert.equal(index.removeByPath('PROJECTS/BEACON.MD'), true);
  assert.equal(index.getRevision(), revisionBeforeMissingRemoval + 1);
  assert.equal(index.getByPath('Projects/beacon.md'), null);
  assert.equal(index.removeByPath('Projects/beacon.md'), false);
  assert.deepEqual(revisions, [initialRevision + 1, initialRevision + 2]);

  const moved = index.upsert({
    id: 'entity:atlas',
    path: 'Areas/Atlas.md',
    basename: 'Atlas',
    frontmatter: { kind: 'Area' },
  });
  assert.equal(moved?.path, 'Areas/Atlas.md');
  assert.equal(index.getByPath('Projects/Atlas.md'), null, 'moving an ID removes its old path');
  assert.equal(index.getByPath('Areas/Atlas.md')?.id, 'entity:atlas');
  assert.equal(index.getRevision(), initialRevision + 3);

  const replaced = index.upsert({
    id: 'entity:atlas-v2',
    path: 'Areas/Atlas.md',
    basename: 'Atlas',
    frontmatter: { kind: 'Area' },
  });
  assert.equal(replaced?.id, 'entity:atlas-v2');
  assert.equal(index.getById('entity:atlas'), null, 'replacing a path removes its prior ID');
  assert.equal(index.getByPath('Areas/Atlas.md')?.id, 'entity:atlas-v2');
  assert.equal(index.getRevision(), initialRevision + 4);

  unsubscribe();
  const revisionsBeforeInvalidate = revisions.length;
  const revisionBeforeInvalidate = index.getRevision();
  index.invalidate();
  assert.equal(index.getRevision(), revisionBeforeInvalidate + 1);
  assert.deepEqual(index.query(), []);
  assert.equal(revisions.length, revisionsBeforeInvalidate);
});

test('one failing change listener cannot block later listeners or index mutations', async () => {
  const { EntityIndexCore } = await corePromise;
  const index = configuredCore(EntityIndexCore);
  const observed = [];
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    index.onChanged(() => {
      throw new Error('listener failure');
    });
    index.onChanged((revision) => observed.push(revision));
    index.upsert({
      path: 'Projects/Listener.md',
      basename: 'Listener',
      frontmatter: { kind: 'Project' },
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.deepEqual(observed, [index.getRevision()]);
  assert.equal(index.getByPath('Projects/Listener.md')?.basename, 'Listener');
});

test('dimension registration is generic and a configuration change requires a fresh rebuild', async () => {
  const { EntityIndexCore } = await corePromise;
  const index = configuredCore(EntityIndexCore);
  const priorRevision = index.getRevision();

  index.registerDimension({
    name: 'audience',
    propertyKeys: ['portfolio'],
  });
  assert.ok(index.getRevision() > priorRevision);
  assert.deepEqual(index.query(), [], 'configuration invalidation prevents stale dimension results');

  index.rebuild(sources);
  assert.deepEqual(
    index.query({ dimensions: { audience: 'work' } }).map((record) => record.basename),
    ['Ada', 'Archived', 'Atlas'],
  );
  assert.deepEqual(
    index.getDimensionDefinitions().map(({ name }) => name),
    ['audience', 'kind', 'lifecycle', 'portfolio'],
  );
});

test('duplicate stable IDs and prototype-named dimensions remain internally consistent', async () => {
  const { EntityIndexCore } = await corePromise;
  const index = new EntityIndexCore();
  index.configureDimensions([
    { name: '__proto__', propertyKeys: ['prototypeKind'] },
    { name: 'constructor', propertyKeys: ['constructorKind'] },
  ]);
  index.rebuild([
    {
      id: 'entity:shared',
      path: 'Entities/Old.md',
      frontmatter: { prototypeKind: 'safe' },
    },
    {
      id: 'entity:shared',
      path: 'Entities/New.md',
      frontmatter: {
        prototypeKind: 'safe',
        constructorKind: 'factory',
      },
    },
  ]);

  assert.equal(index.getByPath('Entities/Old.md'), null);
  assert.equal(index.getByPath('Entities/New.md')?.id, 'entity:shared');
  assert.equal(Object.getPrototypeOf(index.getById('entity:shared').dimensions), null);
  assert.deepEqual(
    index.query({ dimensions: { __proto__: 'safe' } }).map(({ path }) => path),
    ['Entities/New.md'],
  );
  assert.deepEqual(index.getDimensionValues('constructor'), ['factory']);
  assert.deepEqual(index.query({ dimensions: { toString: 'missing' } }), []);
});

test('search and limit operate after dimension filtering without changing deterministic order', async () => {
  const { EntityIndexCore } = await corePromise;
  const index = configuredCore(EntityIndexCore);

  assert.deepEqual(
    index.query({
      dimensions: { kind: 'project' },
      search: 'projects/',
      limit: 2,
    }).map((record) => record.basename),
    ['Archived', 'Atlas'],
  );
  assert.deepEqual(index.query({ limit: 0 }), []);
});

test('Obsidian service exposes the integration contract and cache-refresh event wiring', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/services/entity-index-service.ts', import.meta.url)),
    'utf8',
  );
  for (const method of [
    'setup',
    'configureDimensions',
    'registerDimension',
    'query',
    'invalidate',
    'rebuild',
    'upsertFile',
    'getRevision',
    'getById',
    'getByPath',
    'getDimensionValues',
    'onChanged',
  ]) {
    assert.match(source, new RegExp(`\\b${method}\\s*\\(`));
  }
  assert.match(source, /metadataCache\.on\('changed'/);
  assert.match(source, /metadataCache\.on\('resolved'/);
  assert.match(source, /vault\.on\('create'/);
  assert.match(source, /vault\.on\('modify'/);
  assert.match(source, /vault\.on\('delete'/);
  assert.match(source, /vault\.on\('rename'/);
  assert.match(source, /invalidate\(paths\?: readonly string\[\]\)/);
});

function createServiceHost(TFile, initialNotes = []) {
  const eventHandlers = {
    metadata: new Map(),
    vault: new Map(),
  };
  const files = [...initialNotes.map((note) =>
    new TFile(note.path, note.basename, note.extension ?? 'md'))];
  const frontmatterByFile = new Map(
    files.map((file, index) => [file, initialNotes[index].frontmatter ?? {}]),
  );
  const register = (group, event, handler) => {
    const handlers = group.get(event) ?? [];
    handlers.push(handler);
    group.set(event, handlers);
    return { event, handler };
  };
  const metadataCache = {
    on: (event, handler) => register(eventHandlers.metadata, event, handler),
    getFileCache: (file) => ({ frontmatter: frontmatterByFile.get(file) }),
  };
  const vault = {
    on: (event, handler) => register(eventHandlers.vault, event, handler),
    getMarkdownFiles: () => files.filter((file) => file.extension.toLowerCase() === 'md'),
    getAbstractFileByPath: (path) => files.find((file) => file.path === path) ?? null,
  };
  const registeredEvents = [];
  const host = {
    app: { metadataCache, vault },
    registerEvent: (eventRef) => registeredEvents.push(eventRef),
  };
  const emit = (group, event, ...args) => {
    for (const handler of eventHandlers[group].get(event) ?? []) handler(...args);
  };
  return {
    host,
    files,
    frontmatterByFile,
    registeredEvents,
    emitMetadata: (event, ...args) => emit('metadata', event, ...args),
    emitVault: (event, ...args) => emit('vault', event, ...args),
  };
}

test('service preserves external dimensions across configured-dimension refreshes', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [{
    path: 'Entities/Comet.md',
    basename: 'Comet',
    frontmatter: {
      category: 'Celestial',
      audience: 'Signal Guild',
    },
  }]);
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{ name: 'category', propertyKeys: ['category'] }]);
  const unregister = service.registerDimension({
    name: 'audience',
    propertyKeys: ['audience'],
  });

  assert.deepEqual(
    service.query({ dimensions: { audience: 'signal guild' } }).map(({ path }) => path),
    ['Entities/Comet.md'],
  );

  service.configureDimensions([{ name: 'category', propertyKeys: ['classification'] }]);
  assert.deepEqual(
    service.query({ dimensions: { audience: 'SIGNAL GUILD' } }).map(({ path }) => path),
    ['Entities/Comet.md'],
    'a settings refresh must not discard dimensions registered through the public API',
  );

  unregister();
  assert.deepEqual(
    service.query({ dimensions: { audience: 'Signal Guild' } }),
    [],
    'unregistering removes only the external dimension',
  );
});

test('dimension-change listeners query a rebuilt service instead of an empty stale core', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [{
    path: 'Entities/Comet.md',
    basename: 'Comet',
    frontmatter: {
      category: 'Celestial',
      audience: 'Signal Guild',
    },
  }]);
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{ name: 'category', propertyKeys: ['category'] }]);
  assert.equal(service.query().length, 1);

  const observedPaths = [];
  service.onChanged(() => {
    observedPaths.push(...service.query({
      dimensions: { audience: 'Signal Guild' },
    }).map(({ path }) => path));
  });
  service.registerDimension({
    name: 'audience',
    propertyKeys: ['audience'],
  });
  assert.deepEqual(observedPaths, ['Entities/Comet.md']);
});

test('full invalidation publishes one final-state revision and never an empty intermediate index', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [{
    path: 'Entities/Comet.md',
    basename: 'Comet',
    frontmatter: { category: 'Celestial' },
  }]);
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{ name: 'category', propertyKeys: ['category'] }]);
  assert.equal(service.query().length, 1);

  const observations = [];
  service.onChanged((revision) => {
    observations.push({
      revision,
      paths: service.query().map(({ path }) => path),
    });
  });
  service.invalidate();

  assert.deepEqual(observations, [{
    revision: service.getRevision(),
    paths: ['Entities/Comet.md'],
  }]);
});

test('pre-build vault events stay lazy while an explicit frontmatter upsert builds one final snapshot', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [
    {
      path: 'Entities/Seed.md',
      basename: 'Seed',
      frontmatter: { classification: 'Cached' },
    },
    {
      path: 'Entities/Peer.md',
      basename: 'Peer',
      frontmatter: { classification: 'Peer' },
    },
  ]);
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{
    name: 'classification',
    propertyKeys: ['classification'],
  }]);
  service.setup();
  const observations = [];
  service.onChanged((revision) => {
    observations.push({
      revision,
      paths: service.query().map(({ path }) => path),
      seedClass: service.getByPath('Entities/Seed.md')?.dimensions.classification,
    });
  });

  const seed = fixture.files[0];
  fixture.emitMetadata('changed', seed, null, {
    frontmatter: { classification: 'Partial event' },
  });
  assert.deepEqual(observations, [], 'pre-build incremental events cannot publish partial state');

  service.upsertFile(seed, { classification: 'Immediate' });
  assert.deepEqual(observations, [{
    revision: service.getRevision(),
    paths: ['Entities/Peer.md', 'Entities/Seed.md'],
    seedClass: ['Immediate'],
  }]);
});

test('service uses case-insensitive frontmatter titles as display names', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [
    {
      path: 'Entities/Atlas.md',
      basename: 'Atlas',
      frontmatter: { TITLE: 'Atlas Program', classification: 'Constellation' },
    },
    {
      path: 'Entities/Fallback.md',
      basename: 'Fallback',
      frontmatter: { title: '  ', classification: 'Constellation' },
    },
  ]);
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{
    name: 'classification',
    propertyKeys: ['classification'],
  }]);

  const records = service.query({ dimensions: { classification: 'constellation' } });
  assert.deepEqual(records.map(({ displayName }) => displayName), ['Atlas Program', 'Fallback']);
  assert.equal(service.getByPath('Entities/Atlas.md')?.name, 'Atlas Program');
});

test('metadata and vault events incrementally refresh, rename, and remove indexed notes', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [{
    path: 'Entities/Seed.md',
    basename: 'Seed',
    frontmatter: { classification: 'Seed' },
  }]);
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{
    name: 'classification',
    propertyKeys: ['classification'],
  }]);
  service.setup();
  service.setup();

  assert.equal(fixture.registeredEvents.length, 6, 'setup is idempotent');
  assert.deepEqual(service.query().map(({ path }) => path), ['Entities/Seed.md']);

  const seed = fixture.files[0];
  fixture.emitMetadata('changed', seed, null, {
    frontmatter: { classification: 'Sprout', title: 'Growing Seed' },
  });
  assert.equal(service.getByPath(seed.path)?.displayName, 'Growing Seed');
  assert.deepEqual(
    service.query({ dimensions: { classification: 'sprout' } }).map(({ path }) => path),
    ['Entities/Seed.md'],
  );

  const created = new TFile('Entities/New.md', 'New');
  fixture.files.push(created);
  fixture.frontmatterByFile.set(created, { classification: 'Fresh' });
  fixture.emitVault('create', created);
  assert.equal(service.getByPath('Entities/New.md')?.dimensions.classification[0], 'Fresh');

  fixture.frontmatterByFile.set(created, { classification: 'Updated' });
  fixture.emitVault('modify', created);
  assert.deepEqual(
    service.query({ dimensions: { classification: 'updated' } }).map(({ path }) => path),
    ['Entities/New.md'],
  );

  const oldPath = created.path;
  created.path = 'Entities/Renamed.md';
  created.basename = 'Renamed';
  fixture.emitVault('rename', created, oldPath);
  assert.equal(service.getByPath(oldPath), null);
  assert.equal(service.getByPath(created.path)?.basename, 'Renamed');

  fixture.emitVault('delete', created);
  assert.equal(service.getByPath(created.path), null);

  const revisionBeforeRepeatedResolution = service.getRevision();
  const cachedBeforeRepeatedResolution = service.query();
  fixture.emitMetadata('resolved');
  assert.equal(
    service.getRevision(),
    revisionBeforeRepeatedResolution,
    'a repeated metadata resolution must not rescan an already-built index',
  );
  assert.equal(service.query(), cachedBeforeRepeatedResolution);

  fixture.frontmatterByFile.set(seed, { classification: 'Resolved' });
  service.invalidate();
  fixture.emitMetadata('resolved');
  assert.deepEqual(
    service.query({ dimensions: { classification: 'resolved' } }).map(({ path }) => path),
    ['Entities/Seed.md'],
  );
});

test('generic index sources contain no hardcoded entity-kind values', () => {
  const coreSource = readFileSync(
    fileURLToPath(new URL('../src/services/entity-index-core.ts', import.meta.url)),
    'utf8',
  );
  const serviceSource = readFileSync(
    fileURLToPath(new URL('../src/services/entity-index-service.ts', import.meta.url)),
    'utf8',
  );
  for (const source of [coreSource, serviceSource]) {
    for (const value of ['project', 'person', 'task', 'area']) {
      assert.doesNotMatch(
        source,
        new RegExp(`(?:===|!==|case\\\\s+)\\\\s*['"\`]${value}['"\`]`, 'i'),
        `generic index logic must not branch on the ${value} kind`,
      );
    }
  }
});
