import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function loadService() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/services/linked-context-service.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    plugins: [{ name: 'obsidian-stub', setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        loader: 'js',
        contents: 'export class TFile { static [Symbol.hasInstance](value) { return value?.__tfile === true; } }',
      }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

test('frontmatter links show the whole note', async () => {
  const { resolveLinkedContextRange } = await loadService();
  assert.deepEqual(resolveLinkedContextRange(2, 12, {
    frontmatterPosition: { start: { line: 0 }, end: { line: 3 } }, headings: [],
  }), { kind: 'note', startLine: 0, endLine: 11 });
});

test('heading links include nested content until the next peer or parent heading', async () => {
  const { resolveLinkedContextRange, extractLinkedContextMarkdown } = await loadService();
  const range = resolveLinkedContextRange(3, 14, { headings: [
    { level: 2, position: { start: { line: 3 } } },
    { level: 3, position: { start: { line: 6 } } },
    { level: 2, position: { start: { line: 9 } } },
  ] });
  assert.deepEqual(range, { kind: 'heading', startLine: 3, endLine: 8 });
  assert.equal(extractLinkedContextMarkdown([
    '', '', '', '## Standup [[Target]]', '- first', '  - nested', '### Detail', 'body', '', '## Next',
  ], range), '- first\n  - nested\n### Detail\nbody\n');
});

test('empty heading excerpts are omitted while nested visible content remains', async () => {
  const { LinkedContextService, hasMeaningfulLinkedContextMarkdown } = await loadService();
  assert.equal(hasMeaningfulLinkedContextMarkdown('\n<!-- bookkeeping -->\n^empty-heading\n'), false);
  assert.equal(hasMeaningfulLinkedContextMarkdown('\n### Nested\n- visible\n'), true);

  const target = { __tfile: true, path: 'Target.md', extension: 'md', basename: 'Target', stat: { mtime: 1 } };
  const source = { __tfile: true, path: 'Daily.md', extension: 'md', basename: 'Daily', stat: { mtime: 2 } };
  const link = (line) => ({ link: 'Target', position: { start: { line }, end: { line } } });
  const cache = {
    links: [link(0), link(4)],
    embeds: [],
    headings: [
      { level: 2, position: { start: { line: 0 } } },
      { level: 2, position: { start: { line: 4 } } },
    ],
  };
  const app = {
    metadataCache: {
      resolvedLinks: { 'Daily.md': { 'Target.md': 2 } },
      getFileCache: (file) => file.path === 'Daily.md' ? cache : undefined,
      getFirstLinkpathDest: (raw) => raw === 'Target' ? target : null,
    },
    vault: {
      getAbstractFileByPath: (path) => path === 'Daily.md' ? source : null,
      cachedRead: async () => '## Empty [[Target]]\n\n<!-- bookkeeping -->\n^empty-heading\n## Useful [[Target]]\n- [ ] actual content',
    },
  };

  const items = await new LinkedContextService(app).collect(target);
  assert.deepEqual(items.map((item) => [item.startLine, item.markdown]), [
    [4, '- [ ] actual content'],
  ]);
});

test('ordinary links show only their source line', async () => {
  const { resolveLinkedContextRange } = await loadService();
  assert.deepEqual(resolveLinkedContextRange(7, 20, { headings: [] }), {
    kind: 'line', startLine: 7, endLine: 7,
  });
});

function createCollectionHarness() {
  const target = { __tfile: true, path: 'Target.md', extension: 'md', basename: 'Target', stat: { mtime: 1 } };
  const files = new Map([
    ['Zeta.md', { __tfile: true, path: 'Zeta.md', extension: 'md', basename: 'Zeta', stat: { mtime: 10 } }],
    ['alpha.md', { __tfile: true, path: 'alpha.md', extension: 'md', basename: 'alpha', stat: { mtime: 20 } }],
  ]);
  const contents = new Map([
    ['Zeta.md', '- [ ] Zeta first [[Target]]\nplain\n- [ ] Zeta second [[Target]]'],
    ['alpha.md', '- [ ] Alpha first [[Target]]\nplain\n- [ ] Alpha second [[Target]]'],
  ]);
  const link = (line) => ({
    link: 'Target',
    position: { start: { line }, end: { line } },
  });
  const caches = new Map([
    ['Zeta.md', { links: [link(2), link(0)], embeds: [], headings: [] }],
    ['alpha.md', { links: [link(2), link(0)], embeds: [], headings: [] }],
  ]);
  const app = {
    metadataCache: {
      resolvedLinks: {
        'Zeta.md': { 'Target.md': 2 },
        'alpha.md': { 'Target.md': 2 },
      },
      getFileCache: (file) => caches.get(file.path),
      getFirstLinkpathDest: (raw) => raw === 'Target' ? target : null,
    },
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      cachedRead: async (file) => contents.get(file.path) || '',
    },
  };
  return { app, target, files, contents };
}

test('linked context source order is configurable while excerpts keep document order', async () => {
  const { LinkedContextService } = await loadService();
  const { app, target } = createCollectionHarness();
  const service = new LinkedContextService(app);

  const ascending = await service.collect(target, 'source-asc');
  assert.deepEqual(ascending.map((item) => [item.sourceFile.path, item.startLine]), [
    ['alpha.md', 0],
    ['alpha.md', 2],
    ['Zeta.md', 0],
    ['Zeta.md', 2],
  ]);

  const descending = await service.collect(target, 'source-desc');
  assert.deepEqual(descending.map((item) => [item.sourceFile.path, item.startLine]), [
    ['Zeta.md', 0],
    ['Zeta.md', 2],
    ['alpha.md', 0],
    ['alpha.md', 2],
  ]);
});

test('linked context ordering and ids do not change after an in-card task mutation', async () => {
  const { LinkedContextService } = await loadService();
  const { app, target, files, contents } = createCollectionHarness();
  const service = new LinkedContextService(app);
  const before = await service.collect(target, 'source-desc');

  files.get('Zeta.md').stat.mtime = 999;
  contents.set('Zeta.md', '- [x] Zeta first [[Target]]\nplain\n- [ ] Zeta second [[Target]]');
  const after = await service.collect(target, 'source-desc');

  assert.deepEqual(after.map((item) => item.id), before.map((item) => item.id));
  assert.deepEqual(after.map((item) => item.sourceFile.path), before.map((item) => item.sourceFile.path));
  assert.match(after[0].markdown, /^- \[x\]/);
});

test('an explicitly removed source stays absent while resolved links and file lookup are stale', async () => {
  const { LinkedContextService } = await loadService();
  const { app, target } = createCollectionHarness();
  const service = new LinkedContextService(app);

  // Simulate the vault delete/rename callback arriving before metadataCache
  // drops the old edge and before the old file lookup has settled.
  const items = await service.collect(target, 'source-asc', new Set(['alpha.md']));
  assert.deepEqual(items.map((item) => item.sourceFile.path), ['Zeta.md', 'Zeta.md']);
});

test('linked context recovery and source invalidation predicates fail closed', async () => {
  const {
    getLinkedContextRecoveryIdleDelay,
    isLinkedContextSourceChangeRelevant,
    normalizeLinkedContextSortOrder,
    shouldDeferLinkedContextMountForScroll,
    shouldRecoverLinkedContextPanel,
  } = await loadService();

  assert.equal(getLinkedContextRecoveryIdleDelay(1_000, 1_100, 240), 140);
  assert.equal(getLinkedContextRecoveryIdleDelay(1_000, 1_240, 240), 0);
  assert.equal(getLinkedContextRecoveryIdleDelay(0, 1_100, 240), 0);
  assert.equal(getLinkedContextRecoveryIdleDelay(1_000, 900, 240), 240);

  assert.equal(shouldDeferLinkedContextMountForScroll('top', 25), true);
  assert.equal(shouldDeferLinkedContextMountForScroll('top', 24), false);
  assert.equal(shouldDeferLinkedContextMountForScroll('top', 600), true);
  assert.equal(shouldDeferLinkedContextMountForScroll('bottom', 600), false);
  assert.equal(shouldDeferLinkedContextMountForScroll('top', Number.NaN), true);

  assert.equal(normalizeLinkedContextSortOrder('source-desc'), 'source-desc');
  assert.equal(normalizeLinkedContextSortOrder('modified-desc'), 'source-asc');
  assert.equal(shouldRecoverLinkedContextPanel({
    enabled: true,
    panelConnected: false,
    activeFilePath: 'Target.md',
    mountedFilePath: 'Target.md',
  }), true);
  assert.equal(shouldRecoverLinkedContextPanel({
    enabled: true,
    panelConnected: false,
    activeFilePath: 'Other.md',
    mountedFilePath: 'Target.md',
  }), false);
  assert.equal(shouldRecoverLinkedContextPanel({
    enabled: false,
    panelConnected: false,
    activeFilePath: 'Target.md',
    mountedFilePath: 'Target.md',
  }), false);

  assert.equal(isLinkedContextSourceChangeRelevant('Old source.md', 'Target.md', new Set(['Old source.md']), 0), true);
  assert.equal(isLinkedContextSourceChangeRelevant('New source.md', 'Target.md', new Set(), 1), true);
  assert.equal(isLinkedContextSourceChangeRelevant('Unrelated.md', 'Target.md', new Set(), 0), false);
});
