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
const lineProviderPromise = importBundled('../src/services/line-entity-source-provider.ts');

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

test('anyOf Kind queries return a Project-or-Area union and exclude unrelated entities', async () => {
  const { EntityIndexCore } = await corePromise;
  const index = configuredCore(EntityIndexCore);
  index.upsert({
    path: 'Areas/Operations.md',
    basename: 'Operations',
    frontmatter: {
      kind: 'Area',
      portfolio: 'Work',
      state: 'Active',
    },
  });

  const matches = index.query({
    dimensions: {
      kind: { anyOf: ['project', 'area'] },
    },
  });
  assert.deepEqual(
    matches.map((record) => record.path).sort((left, right) => left.localeCompare(right)),
    [
      'Areas/Operations.md',
      'Projects/Archived.md',
      'Projects/Atlas.md',
      'Projects/beacon.md',
    ],
  );
  assert.equal(
    matches.some((record) => record.path === 'People/Ada.md'),
    false,
    'Person entities must not leak into a Project-or-Area picker',
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

test('source snapshots atomically replace multiple line entities without displacing their note', async () => {
  const { EntityIndexCore } = await corePromise;
  const index = new EntityIndexCore();
  index.configureDimensions([{ name: 'kind', propertyKeys: ['kind'] }]);
  index.rebuild([{
    path: 'Work/Entities.md',
    frontmatter: { kind: 'Notebook' },
  }]);
  const note = index.getByPath('Work/Entities.md');
  const initialRevision = index.getRevision();
  const observed = [];
  index.onChanged((revision) => observed.push(revision));

  const firstSnapshot = index.replaceSource('lines:work/entities.md', [
    {
      id: 'line:work/entities.md#^project-alpha',
      path: 'Work/Entities.md',
      sourcePath: 'Work/Entities.md',
      entityType: 'block',
      blockId: 'project-alpha',
      lineKind: 'heading',
      lineNumber: 3,
      name: 'Project Alpha',
      frontmatter: { kind: 'Project' },
    },
    {
      id: 'line:work/entities.md#^context-home',
      path: 'Work/Entities.md',
      sourcePath: 'Work/Entities.md',
      entityType: 'block',
      blockId: 'context-home',
      lineKind: 'bullet',
      lineNumber: 4,
      name: 'Home',
      frontmatter: { kind: 'Context' },
    },
  ]);
  assert.equal(firstSnapshot.length, 2);
  assert.equal(index.getRevision(), initialRevision + 1, 'one file snapshot publishes one revision');
  assert.equal(index.getByPath('Work/Entities.md'), note, 'line records never replace note lookup');
  assert.equal(index.getBySourcePath('Work/Entities.md').length, 3);
  assert.equal(
    index.getByReferenceTarget('[[Work/Entities#^project-alpha|Project Alpha]]')?.name,
    'Project Alpha',
  );

  index.replaceSource('lines:work/entities.md', [{
    id: 'line:work/entities.md#^context-home',
    path: 'Work/Entities.md',
    sourcePath: 'Work/Entities.md',
    entityType: 'block',
    blockId: 'context-home',
    lineKind: 'bullet',
    lineNumber: 8,
    name: 'Home context',
    frontmatter: { kind: 'Context' },
  }]);
  assert.equal(index.getRevision(), initialRevision + 2);
  assert.equal(index.getById('line:work/entities.md#^project-alpha'), null);
  assert.equal(index.getByLocator({
    path: 'Work/Entities',
    entityType: 'block',
    blockId: 'context-home',
  })?.name, 'Home context');
  assert.deepEqual(observed, [initialRevision + 1, initialRevision + 2]);
});

test('duplicate ready block identities fail closed in both rebuilds and source replacements', async () => {
  const { EntityIndexCore } = await corePromise;
  const index = new EntityIndexCore();
  index.configureDimensions([{ name: 'kind', propertyKeys: ['kind'] }]);
  const ambiguous = [
    {
      id: 'line:entities.md#^duplicate',
      path: 'Entities.md',
      entityType: 'block',
      blockId: 'duplicate',
      lineKind: 'bullet',
      lineNumber: 1,
      name: 'First',
      frontmatter: { kind: 'Project' },
    },
    {
      id: 'line:entities.md#^duplicate',
      path: 'Entities.md',
      entityType: 'block',
      blockId: 'duplicate',
      lineKind: 'task',
      lineNumber: 2,
      name: 'Second',
      frontmatter: { kind: 'Project' },
    },
  ];

  index.rebuild(ambiguous);
  assert.deepEqual(index.query({ dimensions: { kind: 'Project' } }), []);

  index.rebuild([{ path: 'Entities.md', frontmatter: { kind: 'Notebook' } }]);
  const before = index.getRevision();
  const accepted = index.replaceSource('lines:entities.md', [
    ...ambiguous,
    {
      id: 'line:entities.md#^unique',
      path: 'Entities.md',
      entityType: 'block',
      blockId: 'unique',
      lineKind: 'heading',
      lineNumber: 3,
      name: 'Unique',
      frontmatter: { kind: 'Project' },
    },
  ]);
  assert.deepEqual(accepted.map(({ name }) => name), ['Unique']);
  assert.equal(index.getRevision(), before + 1);
  assert.equal(index.getById('line:entities.md#^duplicate'), null);
});

test('line provider scans task, bullet, and heading entities but skips frontmatter and fences', async () => {
  const { LineEntitySourceProvider } = await lineProviderPromise;
  const provider = new LineEntitySourceProvider();
  const content = [
    '---',
    'kind: Project',
    '---',
    '# Project North [Kind:: Project]',
    '- Home [kind:: Context] ^context-home',
    '- [ ] Ship it [kind:: Task]',
    '```md',
    '- Hidden [kind:: Project]',
    '```',
    'Plain paragraph [kind:: Project]',
  ].join('\n');

  const sources = provider.scanFile(
    'Entities/Mixed.md',
    content,
    [{ name: 'kind', propertyKeys: ['kind'] }],
  );
  assert.deepEqual(
    sources.map(({ lineKind, name, referenceState }) => ({ lineKind, name, referenceState })),
    [
      { lineKind: 'heading', name: 'Project North', referenceState: 'provisional' },
      { lineKind: 'bullet', name: 'Home', referenceState: 'ready' },
      { lineKind: 'task', name: 'Ship it', referenceState: 'provisional' },
    ],
  );
  assert.equal(sources[1].subpath, '#^context-home');
  assert.equal(provider.getDescriptor(sources[0].id)?.lineNumber, 4);
});

test('line provider ignores inline-code and protected-metadata field lookalikes', async () => {
  const { LineEntitySourceProvider } = await lineProviderPromise;
  const provider = new LineEntitySourceProvider();
  const sources = provider.scanFile(
    'Entities/Protected.md',
    [
      '- Inline code `example [kind:: Project]`',
      '- Double-tick code `` [kind:: Project] ``',
      '- Hidden percent %% tps-inline-props: {"example":" [kind:: Project]"} %%',
      '- Hidden comment <!-- tps-inline-props: {"example":" [kind:: Project]"} -->',
      '- Hidden span <span data-tps-inline-props=\'{"example":" [kind:: Project]"}\'></span>',
      '- Visible [kind:: Context] `example [kind:: Project]`',
      '- Visible hidden [kind:: Project] %% tps-inline-props: {"example":" [kind:: Context]"} %%',
      '- Unclosed literal ` example [kind:: Project]',
      '- Escaped literal \\` example [kind:: Context]',
    ].join('\n'),
    [{ name: 'kind', propertyKeys: ['kind'] }],
  );

  assert.deepEqual(
    sources.map(({ name, frontmatter }) => ({ name, kind: frontmatter.kind })),
    [
      {
        name: 'Visible `example [kind:: Project]`',
        kind: 'Context',
      },
      {
        name: 'Visible hidden',
        kind: 'Project',
      },
      {
        name: 'Unclosed literal ` example',
        kind: 'Project',
      },
      {
        name: 'Escaped literal \\` example',
        kind: 'Context',
      },
    ],
  );
});

test('line provider withholds block IDs duplicated by non-entity lines', async () => {
  const { LineEntitySourceProvider } = await lineProviderPromise;
  const provider = new LineEntitySourceProvider();
  const sources = provider.scanFile(
    'Entities/Duplicates.md',
    [
      '- Project entity [kind:: Project] ^duplicate',
      'Ordinary paragraph ^duplicate',
      '- Context entity [kind:: Context] ^unique-context',
    ].join('\n'),
    [{ name: 'kind', propertyKeys: ['kind'] }],
  );

  assert.deepEqual(sources.map(({ name }) => name), ['Context entity']);
  assert.equal(provider.getDescriptor('line:entities/duplicates.md#^duplicate'), null);
});

test('native block uniqueness consistently ignores frontmatter and fenced examples', async () => {
  const { LineEntitySourceProvider } = await lineProviderPromise;
  const provider = new LineEntitySourceProvider(() => 'unused');
  let content = [
    '---',
    'example: ^entity-ready',
    '---',
    '- Project entity [kind:: Project] ^entity-ready',
    '```md',
    'Code example ^entity-ready',
    '```',
  ].join('\n');
  const [ready] = provider.scanFile(
    'Entities/Code-Examples.md',
    content,
    [{ name: 'kind', propertyKeys: ['kind'] }],
  );
  assert.equal(ready?.blockId, 'entity-ready');

  const materialized = await provider.materialize(
    { path: 'Entities/Code-Examples.md' },
    { id: ready.id },
    {
      process: async (_file, transform) => {
        content = transform(content);
        return content;
      },
    },
  );
  assert.equal(materialized.blockId, 'entity-ready');
  assert.equal(materialized.changed, false);
  assert.equal(materialized.lineNumber, 4);
});

test('invalid fence-like lines cannot expose code examples as entities', async () => {
  const { LineEntitySourceProvider } = await lineProviderPromise;
  const provider = new LineEntitySourceProvider();
  const sources = provider.scanFile(
    'Entities/Fences.md',
    [
      '```md',
      '- Hidden one [kind:: Project]',
      '```not-a-close',
      '- Hidden two [kind:: Project]',
      '```',
      '- Visible [kind:: Project]',
    ].join('\n'),
    [{ name: 'kind', propertyKeys: ['kind'] }],
  );

  assert.deepEqual(sources.map(({ name }) => name), ['Visible']);
});

test('line provider lazily materializes native block links while preserving LF and CRLF bytes', async () => {
  const { LineEntitySourceProvider } = await lineProviderPromise;
  for (const newline of ['\n', '\r\n']) {
    const provider = new LineEntitySourceProvider(() => 'tps-fixed-block');
    let content = [
      '# Project North [kind:: Project]',
      '- Context Home [kind:: Context]',
      '',
    ].join(newline);
    const sources = provider.scanFile(
      'Entities/Mixed.md',
      content,
      [{ name: 'kind', propertyKeys: ['kind'] }],
    );
    const selected = sources[0];
    const file = { path: 'Entities/Mixed.md' };
    const result = await provider.materialize(
      file,
      { id: selected.id },
      {
        process: async (_file, transform) => {
          content = transform(content);
          return content;
        },
      },
    );

    assert.equal(result.blockId, 'tps-fixed-block');
    assert.match(content.split(newline)[0], /\^tps-fixed-block$/u);
    assert.equal(
      (content.match(/\r\n/gu) || []).length,
      newline === '\r\n' ? 2 : 0,
      'materialization preserves the original newline representation',
    );
    assert.equal(content.endsWith(newline), true, 'final newline remains unchanged');
  }
});

test('line materialization keeps legacy identity keys distinct and prefers native block identity', async () => {
  const {
    LineEntityResolutionError,
    LineEntitySourceProvider,
  } = await lineProviderPromise;
  const provider = new LineEntitySourceProvider(() => 'tps-fixed-block');
  let content = [
    '- Target [kind:: Project] [tpsId:: old-id]',
    '- Other [kind:: Project] [subitemId:: other-id]',
  ].join('\n');
  const [provisional] = provider.scanFile(
    'Entities/Identity.md',
    content,
    [{ name: 'kind', propertyKeys: ['kind'] }],
  );

  content = [
    '- Target changed [kind:: Project] [tpsId:: new-id]',
    '- Other [kind:: Project] [subitemId:: old-id]',
  ].join('\n');
  await assert.rejects(
    provider.materialize(
      { path: 'Entities/Identity.md' },
      { id: provisional.id },
      {
        process: async (_file, transform) => {
          content = transform(content);
          return content;
        },
      },
    ),
    (error) =>
      error instanceof LineEntityResolutionError
      && error.code === 'stale-source',
  );
  assert.equal(
    content.includes('^tps-fixed-block'),
    false,
    'a tpsId can never retarget to an unrelated subitemId',
  );

  const readyProvider = new LineEntitySourceProvider(() => 'unused');
  const originalReady = [
    '- Ready target [kind:: Project] [tpsId:: ready-old] ^ready-native',
    '- Other [kind:: Project] [tpsId:: other-id]',
  ].join('\n');
  const [ready] = readyProvider.scanFile(
    'Entities/Ready-Identity.md',
    originalReady,
    [{ name: 'kind', propertyKeys: ['kind'] }],
  );
  let changedReady = [
    '- Ready target changed [kind:: Context] [tpsId:: ready-new] ^ready-native',
    '- Other [kind:: Project] [tpsId:: ready-old]',
  ].join('\n');
  const resolved = await readyProvider.materialize(
    { path: 'Entities/Ready-Identity.md' },
    { id: ready.id },
    {
      process: async (_file, transform) => {
        changedReady = transform(changedReady);
        return changedReady;
      },
    },
  );
  assert.equal(resolved.blockId, 'ready-native');
  assert.equal(resolved.lineNumber, 1);
  assert.equal(resolved.changed, false);
  assert.equal(changedReady.match(/\^ready-native$/gmu)?.length, 1);
});

test('provisional lines never retarget through legacy identity lookalikes in code or protected metadata', async () => {
  const {
    LineEntityResolutionError,
    LineEntitySourceProvider,
  } = await lineProviderPromise;
  const cases = [
    {
      label: 'closed inline code',
      lookalike: '`example [tpsId:: spoof-code]`',
      replacementIdentity: '[tpsId:: spoof-code]',
    },
    {
      label: 'protected TPS metadata',
      lookalike: '%% tps-inline-props:{"memo":" [subitemId:: spoof-protected]"} %%',
      replacementIdentity: '[subitemId:: spoof-protected]',
    },
  ];

  for (const fixture of cases) {
    const provider = new LineEntitySourceProvider(() => 'must-not-materialize');
    let content = `- Original [kind:: Project] ${fixture.lookalike}`;
    const [provisional] = provider.scanFile(
      'Entities/Legacy-Lookalike.md',
      content,
      [{ name: 'kind', propertyKeys: ['kind'] }],
    );
    assert.ok(provisional, fixture.label);
    assert.deepEqual(
      provider.getDescriptor(provisional.id)?.legacyIdentities,
      [],
      `${fixture.label} is not captured as a stable legacy identity`,
    );

    content = `- Unrelated [kind:: Project] ${fixture.replacementIdentity}`;
    await assert.rejects(
      provider.materialize(
        { path: 'Entities/Legacy-Lookalike.md' },
        { id: provisional.id },
        {
          process: async (_file, transform) => {
            content = transform(content);
            return content;
          },
        },
      ),
      (error) =>
        error instanceof LineEntityResolutionError
        && error.code === 'stale-source',
      fixture.label,
    );
    assert.equal(
      content.includes('^must-not-materialize'),
      false,
      `${fixture.label} cannot redirect a stale provisional selection`,
    );
  }
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
    'queryAsync',
    'ensureReady',
    'invalidate',
    'rebuild',
    'upsertFile',
    'getRevision',
    'getById',
    'getByPath',
    'getByLocator',
    'getByReferenceTarget',
    'getBySourcePath',
    'materializeReference',
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
  const contentByFile = new Map(
    files.map((file, index) => [file, initialNotes[index].content ?? '']),
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
    cachedRead: async (file) => contentByFile.get(file) ?? '',
    read: async (file) => contentByFile.get(file) ?? '',
    process: async (file, transform) => {
      const next = transform(contentByFile.get(file) ?? '');
      contentByFile.set(file, next);
      return next;
    },
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
    contentByFile,
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

test('first metadata resolution repairs an index built before frontmatter was ready', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [{
    path: 'Entities/Early.md',
    basename: 'Early',
    frontmatter: { kind: 'Project' },
  }]);
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{ name: 'kind', propertyKeys: ['kind'] }]);
  service.setup();

  const file = fixture.files[0];
  fixture.frontmatterByFile.set(file, {});
  assert.deepEqual(
    service.query({ dimensions: { kind: 'project' } }),
    [],
    'an early lazy build reproduces the partially populated startup cache',
  );
  assert.deepEqual(Object.keys(service.getByPath(file.path)?.dimensions ?? {}), []);

  fixture.frontmatterByFile.set(file, { kind: 'Project' });
  const revisionBeforeResolution = service.getRevision();
  fixture.emitMetadata('resolved');

  assert.deepEqual(
    service.query({ dimensions: { kind: 'project' } }).map(({ path }) => path),
    ['Entities/Early.md'],
    'the first authoritative resolution rebuilds already-created note records',
  );
  assert.ok(service.getRevision() > revisionBeforeResolution);

  const revisionAfterResolution = service.getRevision();
  const cachedAfterResolution = service.query({ dimensions: { kind: 'project' } });
  fixture.emitMetadata('resolved');
  assert.equal(
    service.getRevision(),
    revisionAfterResolution,
    'later metadata resolution events do not rescan a healthy index',
  );
  assert.equal(
    service.query({ dimensions: { kind: 'project' } }),
    cachedAfterResolution,
    'later metadata resolution events preserve the revision-scoped query cache',
  );
});

test('first metadata resolution rebuilds an active line index without ghosts or duplicates', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [{
    path: 'Entities/Startup.md',
    basename: 'Startup',
    frontmatter: { kind: 'Project' },
    content: '- Startup line [kind:: Project] ^startup-project',
  }]);
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{ name: 'kind', propertyKeys: ['kind'] }]);
  service.setup();

  const file = fixture.files[0];
  fixture.frontmatterByFile.set(file, {});
  assert.deepEqual(
    (await service.queryAsync({ dimensions: { kind: 'Project' } }))
      .map(({ entityType, blockId }) => ({ entityType, blockId })),
    [{ entityType: 'block', blockId: 'startup-project' }],
    'an early async query reproduces line readiness beside incomplete note metadata',
  );

  fixture.frontmatterByFile.set(file, { kind: 'Project' });
  fixture.emitMetadata('resolved');
  await service.ensureReady();

  const repaired = await service.queryAsync({ dimensions: { kind: 'Project' } });
  assert.deepEqual(
    repaired.map(({ entityType, path, sourcePath, blockId, referenceTarget }) => ({
      entityType,
      path,
      sourcePath,
      blockId,
      referenceTarget,
    })),
    [
      {
        entityType: 'note',
        path: 'Entities/Startup.md',
        sourcePath: 'Entities/Startup.md',
        blockId: '',
        referenceTarget: 'Entities/Startup.md',
      },
      {
        entityType: 'block',
        path: 'Entities/Startup.md',
        sourcePath: 'Entities/Startup.md',
        blockId: 'startup-project',
        referenceTarget: 'Entities/Startup.md#^startup-project',
      },
    ],
    'the authoritative rebuild restores the note and exactly one ready line entity',
  );
  assert.deepEqual(
    service.query({ dimensions: { kind: 'Project' } })
      .map(({ entityType, path }) => ({ entityType, path })),
    [{ entityType: 'note', path: 'Entities/Startup.md' }],
    'synchronous queries stay note-only after line readiness restarts',
  );

  const revisionAfterRepair = service.getRevision();
  const cachedAfterRepair = await service.queryAsync({ dimensions: { kind: 'Project' } });
  fixture.emitMetadata('resolved');
  assert.equal(service.getRevision(), revisionAfterRepair);
  assert.equal(
    await service.queryAsync({ dimensions: { kind: 'Project' } }),
    cachedAfterRepair,
    'later metadata resolution preserves the combined entity query cache',
  );
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

  fixture.emitMetadata('resolved');
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

test('async service readiness adds task, bullet, and heading entities without changing note APIs', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [{
    path: 'Entities/Registry.md',
    basename: 'Registry',
    frontmatter: { kind: 'Registry' },
    content: [
      '# Apollo [kind:: Project]',
      '- Home [kind:: Context] ^context-home',
      '- [ ] Delivery [kind:: Project]',
    ].join('\n'),
  }]);
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{ name: 'kind', propertyKeys: ['kind'] }]);

  assert.deepEqual(
    service.query({ dimensions: { kind: 'Project' } }),
    [],
    'legacy synchronous query builds notes without exposing a partial line scan',
  );
  const projectEntities = await service.queryAsync({
    dimensions: { kind: 'Project' },
  });
  assert.deepEqual(
    projectEntities.map(({ entityType, lineKind, name, referenceState }) => ({
      entityType,
      lineKind,
      name,
      referenceState,
    })),
    [
      {
        entityType: 'block',
        lineKind: 'heading',
        name: 'Apollo',
        referenceState: 'provisional',
      },
      {
        entityType: 'block',
        lineKind: 'task',
        name: 'Delivery',
        referenceState: 'provisional',
      },
    ],
  );
  assert.equal(service.getByPath('Entities/Registry.md')?.entityType, 'note');
  assert.equal(service.getBySourcePath('Entities/Registry.md').length, 4);
  assert.equal(
    service.getByReferenceTarget('Entities/Registry#^context-home')?.name,
    'Home',
  );
});

test('ready line index follows file create, rename, and delete without ghost source records', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [{
    path: 'Entities/Registry.md',
    basename: 'Registry',
    frontmatter: { kind: 'Registry' },
    content: '',
  }]);
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{ name: 'kind', propertyKeys: ['kind'] }]);
  service.setup();
  await service.ensureReady();

  const created = new TFile('Entities/Lifecycle.md', 'Lifecycle');
  fixture.files.push(created);
  fixture.frontmatterByFile.set(created, {});
  fixture.contentByFile.set(
    created,
    '- Lifecycle project [kind:: Project] ^lifecycle-project',
  );
  const beforeCreate = service.getRevision();
  fixture.emitVault('create', created);
  const createdProjects = await service.queryAsync({
    dimensions: { kind: 'Project' },
  });
  assert.deepEqual(
    createdProjects.map(({ entityType, sourcePath, blockId }) => ({
      entityType,
      sourcePath,
      blockId,
    })),
    [{
      entityType: 'block',
      sourcePath: 'Entities/Lifecycle.md',
      blockId: 'lifecycle-project',
    }],
  );
  assert.equal(
    service.getRevision() - beforeCreate,
    2,
    'creation publishes one note revision and one line-source revision',
  );
  assert.equal(
    service.getByReferenceTarget('Entities/Lifecycle#^lifecycle-project')?.sourcePath,
    'Entities/Lifecycle.md',
  );
  const stableAfterCreate = service.getRevision();
  await service.queryAsync({ dimensions: { kind: 'Project' } });
  assert.equal(service.getRevision(), stableAfterCreate, 'a cached follow-up query does not rescan');

  const oldPath = created.path;
  created.path = 'Entities/Lifecycle Renamed.md';
  created.basename = 'Lifecycle Renamed';
  const beforeRename = service.getRevision();
  fixture.emitVault('rename', created, oldPath);
  const renamedProjects = await service.queryAsync({
    dimensions: { kind: 'Project' },
  });
  assert.deepEqual(
    renamedProjects.map(({ sourcePath, blockId }) => ({ sourcePath, blockId })),
    [{
      sourcePath: 'Entities/Lifecycle Renamed.md',
      blockId: 'lifecycle-project',
    }],
  );
  assert.deepEqual(service.getBySourcePath(oldPath), []);
  assert.equal(service.getByReferenceTarget('Entities/Lifecycle#^lifecycle-project'), null);
  assert.equal(
    service.getByReferenceTarget('Entities/Lifecycle Renamed#^lifecycle-project')?.sourcePath,
    'Entities/Lifecycle Renamed.md',
  );
  const renameRevisions = service.getRevision() - beforeRename;
  assert.ok(
    renameRevisions >= 2 && renameRevisions <= 4,
    `rename revisions stay bounded (observed ${renameRevisions})`,
  );
  const stableAfterRename = service.getRevision();
  await service.queryAsync({ dimensions: { kind: 'Project' } });
  assert.equal(service.getRevision(), stableAfterRename, 'renamed content remains revision-cached');

  const renamedPath = created.path;
  const beforeDelete = service.getRevision();
  fixture.emitVault('delete', created);
  fixture.files.splice(fixture.files.indexOf(created), 1);
  const deletedProjects = await service.queryAsync({
    dimensions: { kind: 'Project' },
  });
  assert.deepEqual(deletedProjects, []);
  assert.deepEqual(service.getBySourcePath(renamedPath), []);
  assert.equal(
    service.getByReferenceTarget('Entities/Lifecycle Renamed#^lifecycle-project'),
    null,
  );
  const deleteRevisions = service.getRevision() - beforeDelete;
  assert.ok(
    deleteRevisions >= 1 && deleteRevisions <= 2,
    `delete revisions stay bounded (observed ${deleteRevisions})`,
  );
  const stableAfterDelete = service.getRevision();
  await service.queryAsync({ dimensions: { kind: 'Project' } });
  assert.equal(service.getRevision(), stableAfterDelete, 'deleted sources do not reappear on query');
});

test('synchronous queries remain deterministic note-only after entity readiness', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [{
    path: 'Entities/Project.md',
    basename: 'Project',
    frontmatter: { kind: 'Project' },
    content: '- Project line [kind:: Project] ^project-line',
  }]);
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{ name: 'kind', propertyKeys: ['kind'] }]);

  assert.deepEqual(
    service.query({ dimensions: { kind: 'Project' } }).map(({ entityType }) => entityType),
    ['note'],
  );
  assert.deepEqual(
    (await service.queryAsync({ dimensions: { kind: 'Project' } }))
      .map(({ entityType }) => entityType),
    ['note', 'block'],
  );
  const syncAfter = service.query({ dimensions: { kind: 'Project' } });
  assert.deepEqual(syncAfter.map(({ entityType }) => entityType), ['note']);
  assert.equal(
    service.query({ dimensions: { kind: 'Project' } }),
    syncAfter,
    'the note-only view remains revision-cached',
  );
});

test('dimension reconfiguration restarts an in-flight line readiness build', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [{
    path: 'Entities/Race.md',
    basename: 'Race',
    content: '- Racing project [kind:: Project]',
  }]);
  let releaseFirstRead;
  let firstRead = true;
  fixture.host.app.vault.cachedRead = async (file) => {
    if (!firstRead) return fixture.contentByFile.get(file) ?? '';
    firstRead = false;
    return new Promise((resolve) => {
      releaseFirstRead = () => resolve(fixture.contentByFile.get(file) ?? '');
    });
  };
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{ name: 'kind', propertyKeys: ['kind'] }]);
  const pendingQuery = service.queryAsync({ dimensions: { kind: 'Project' } });
  await Promise.resolve();
  assert.equal(typeof releaseFirstRead, 'function');

  service.registerDimension({ name: 'audience', propertyKeys: ['audience'] });
  releaseFirstRead();
  const results = await pendingQuery;
  assert.deepEqual(
    results.map(({ name, entityType }) => ({ name, entityType })),
    [{ name: 'Racing project', entityType: 'block' }],
  );
});

test('transient line scan failures retry once per later readiness request', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [{
    path: 'Entities/Transient.md',
    basename: 'Transient',
    content: '- Retry project [kind:: Project]',
  }]);
  let readAttempts = 0;
  fixture.host.app.vault.cachedRead = async (file) => {
    readAttempts += 1;
    if (readAttempts <= 2) throw new Error(`transient read ${readAttempts}`);
    return fixture.contentByFile.get(file) ?? '';
  };
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{ name: 'kind', propertyKeys: ['kind'] }]);
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(
      await service.queryAsync({ dimensions: { kind: 'Project' } }),
      [],
      'the initial failed scan returns a bounded partial result',
    );
    assert.equal(readAttempts, 1);
    assert.deepEqual(
      await service.queryAsync({ dimensions: { kind: 'Project' } }),
      [],
      'one later query makes one bounded retry rather than looping forever',
    );
    assert.equal(readAttempts, 2);
    assert.deepEqual(
      (await service.queryAsync({ dimensions: { kind: 'Project' } }))
        .map(({ name, entityType }) => ({ name, entityType })),
      [{ name: 'Retry project', entityType: 'block' }],
    );
    assert.equal(readAttempts, 3);
  } finally {
    console.error = originalConsoleError;
  }
});

test('selecting a provisional line materializes one native block link and reindexes it ready', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [{
    path: 'Entities/Registry.md',
    basename: 'Registry',
    content: '- [ ] Project Mercury [kind:: Project]',
  }]);
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{ name: 'kind', propertyKeys: ['kind'] }]);
  const [provisional] = await service.queryAsync({
    dimensions: { kind: 'Project' },
  });
  const before = fixture.contentByFile.get(fixture.files[0]);
  assert.equal(provisional.referenceState, 'provisional');
  assert.equal(before.includes('^tps-'), false, 'indexing itself never mutates the source');

  const materialized = await service.materializeReference(provisional);
  const after = fixture.contentByFile.get(fixture.files[0]);
  assert.equal(materialized?.referenceState, 'ready');
  assert.match(materialized?.subpath || '', /^#\^tps-[A-Za-z0-9-]+$/u);
  assert.match(after, /\^tps-[A-Za-z0-9-]+$/u);
  assert.equal((after.match(/\^tps-/gu) || []).length, 1);
  assert.equal(
    service.getByReferenceTarget(materialized.referenceTarget)?.id,
    materialized.id,
  );
});

test('ready line selection revalidates whole-file uniqueness and current Kind state', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const original = '- Project entity [kind:: Project] [tpsId:: entity-1] ^entity-ready';
  const fixture = createServiceHost(TFile, [{
    path: 'Entities/Ready.md',
    basename: 'Ready',
    content: original,
  }]);
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{ name: 'kind', propertyKeys: ['kind'] }]);
  const [ready] = await service.queryAsync({ dimensions: { kind: 'Project' } });
  assert.equal(ready.referenceState, 'ready');

  fixture.contentByFile.set(
    fixture.files[0],
    `${original}\nOrdinary paragraph ^entity-ready`,
  );
  assert.equal(
    await service.materializeReference(ready),
    null,
    'a duplicate added outside the indexed entity set rejects the stale ready choice',
  );

  const changedKind = '- Project entity [kind:: Context] [tpsId:: entity-1] ^entity-ready';
  fixture.contentByFile.set(fixture.files[0], changedKind);
  const refreshed = await service.materializeReference(ready);
  assert.deepEqual(refreshed?.dimensions.kind, ['Context']);
  assert.deepEqual(
    await service.queryAsync({ dimensions: { kind: 'Project' } }),
    [],
  );
});

test('service line replacement is one revision and stale or duplicate identities never write', async () => {
  const { EntityIndexService, TFile } = await servicePromise;
  const fixture = createServiceHost(TFile, [{
    path: 'Entities/Registry.md',
    basename: 'Registry',
    content: [
      '- First [kind:: Project]',
      '- Second [kind:: Project]',
    ].join('\n'),
  }]);
  const service = new EntityIndexService(fixture.host);
  service.configureDimensions([{ name: 'kind', propertyKeys: ['kind'] }]);
  service.setup();
  service.query();
  const beforeReadyRevision = service.getRevision();
  const initial = await service.queryAsync({ dimensions: { kind: 'Project' } });
  assert.equal(service.getRevision(), beforeReadyRevision + 1);
  assert.equal(initial.length, 2);

  const replacement = [
    '- First renamed [kind:: Project]',
    '- Third [kind:: Project]',
  ].join('\n');
  const beforeReplacementRevision = service.getRevision();
  fixture.emitMetadata('changed', fixture.files[0], replacement, { frontmatter: {} });
  fixture.contentByFile.set(fixture.files[0], replacement);
  await Promise.resolve();
  assert.equal(service.getRevision(), beforeReplacementRevision + 1);
  assert.deepEqual(
    (await service.queryAsync({ dimensions: { kind: 'Project' } })).map(({ name }) => name),
    ['First renamed', 'Third'],
  );

  const stale = (await service.queryAsync({ dimensions: { kind: 'Project' } }))[0];
  const changedOutsideIndex = replacement.replace('First renamed', 'Changed elsewhere');
  fixture.contentByFile.set(fixture.files[0], changedOutsideIndex);
  assert.equal(await service.materializeReference(stale), null);
  assert.equal(
    fixture.contentByFile.get(fixture.files[0]),
    changedOutsideIndex,
    'stale selection fails closed without appending a block ID',
  );

  const duplicateReady = [
    '- First [kind:: Project] ^duplicate',
    '- Second [kind:: Project] ^duplicate',
  ].join('\n');
  fixture.emitMetadata('changed', fixture.files[0], duplicateReady, { frontmatter: {} });
  fixture.contentByFile.set(fixture.files[0], duplicateReady);
  await Promise.resolve();
  assert.deepEqual(
    await service.queryAsync({ dimensions: { kind: 'Project' } }),
    [],
    'both lines with an ambiguous ready block identity are withheld',
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
