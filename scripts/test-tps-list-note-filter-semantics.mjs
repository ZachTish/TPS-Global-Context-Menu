import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadTpsListViewHarness() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/tps-list/views/TpsListView.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({
          path: 'obsidian',
          namespace: 'tps-list-note-filter-test',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'tps-list-note-filter-test' }, () => ({
          contents: `
            class Dummy {}
            const api = new Proxy(
              {
                BasesView: Dummy,
                FileView: Dummy,
                FuzzySuggestModal: Dummy,
                Modal: Dummy,
                Notice: Dummy,
                TFile: Dummy,
                normalizePath: (value) => String(value),
                parseYaml: (value) => JSON.parse(value),
              },
              { get(target, key) { return key in target ? target[key] : Dummy; } },
            );
            module.exports = api;
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function makeFile(path) {
  const name = path.split('/').at(-1);
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/';
  return {
    path,
    name,
    basename: name.replace(/\.md$/u, ''),
    extension: 'md',
    parent: { path: folder },
    stat: { size: 100, ctime: 1, mtime: 2 },
  };
}

function normalizePropertyReference(reference) {
  return String(reference || '')
    .trim()
    .replace(/^note\./iu, '')
    .replace(/^properties?\s*\[\s*['"](.*?)['"]\s*\]$/iu, '$1')
    .replace(/[\s_-]+/gu, '')
    .toLocaleLowerCase();
}

async function createHarness({ files, frontmatter, roots, search = '' }) {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const folderProperty = {
    id: 'folder',
    key: 'folderPath',
    label: 'Folder',
    type: 'folder',
  };
  view.app = {
    vault: { getMarkdownFiles: () => files },
    metadataCache: {
      getFileCache: (file) => ({
        frontmatter: frontmatter.get(file.path) || {},
        tags: [],
        links: [],
      }),
    },
  };
  view.isBaseFileFilterReady = () => true;
  view.scheduleBaseFileFilterLoad = () => {};
  view.getActiveBasesSearchQuery = () => search;
  view.getBaseFilterRoots = () => roots;
  view.getBaseSourcePath = () => 'QA.base';
  view.getBaseContextFrontmatterValue = () => null;
  view.getGcmSettings = () => ({ properties: [folderProperty] });
  view.getConfiguredCustomProperty = (reference) => (
    ['folder', 'folderpath'].includes(normalizePropertyReference(reference)) ? folderProperty : null
  );
  view.getFrontmatterPropNameFromId = (reference) => {
    const raw = String(reference || '').trim();
    return /^note\./iu.test(raw) ? raw.slice(5) : null;
  };
  return view;
}

test('TPS List recognizes only bare Kind and configured Folder as note inclusion overrides', async () => {
  const view = await createHarness({ files: [], frontmatter: new Map(), roots: [] });
  assert.equal(view.filterTreeUsesNoteSemanticOverride({ property: 'kind', value: 'note' }), true);
  assert.equal(view.filterTreeUsesNoteSemanticOverride('kind == "note"'), true);
  assert.equal(view.filterTreeUsesNoteSemanticOverride({ property: 'note.kind', value: 'Project' }), false);
  assert.equal(view.filterTreeUsesNoteSemanticOverride({ property: 'folderPath', value: 'Projects' }), true);
  assert.equal(view.filterTreeUsesNoteSemanticOverride('note.folderPath.equals("Projects")'), true);
  assert.equal(view.filterTreeUsesNoteSemanticOverride({ property: 'file.folder', value: 'Projects' }), false);
  assert.equal(view.filterTreeUsesNoteSemanticOverride({ property: 'note.status', value: 'open' }), false);
  assert.equal(view.filterTreeUsesUnsupportedNoteContextReference('kind == this.kind'), true);
  assert.equal(view.filterTreeUsesUnsupportedNoteContextReference('scheduled == this.scheduled'), false);
});

test('bare Kind recovers structural notes while preserving every other supported filter', async () => {
  const native = makeFile('Native/Existing.md');
  const open = makeFile('Projects/Open.md');
  const closed = makeFile('Projects/Closed.md');
  const roots = [{
    and: [
      { property: 'kind', operator: 'equals', value: 'notes' },
      { property: 'note.status', operator: 'equals', value: 'open' },
    ],
  }];
  const view = await createHarness({
    files: [native, open, closed],
    frontmatter: new Map([
      [native.path, { status: 'open' }],
      [open.path, { status: 'open' }],
      [closed.path, { status: 'closed' }],
    ]),
    roots,
  });
  const nativeEntry = { file: native, getValue: () => null };
  const reconciled = view.reconcileNativeNoteEntries([nativeEntry]);
  assert.deepEqual(reconciled.map((entry) => entry.file.path), [native.path, open.path]);
  assert.equal(reconciled[1].getValue('note.status'), 'open');
});

test('bare Kind remains additive for authored note kinds', async () => {
  const project = makeFile('Projects/Project.md');
  const reference = makeFile('Projects/Reference.md');
  const view = await createHarness({
    files: [project, reference],
    frontmatter: new Map([
      [project.path, { kind: 'Project' }],
      [reference.path, { kind: 'Reference' }],
    ]),
    roots: [{ property: 'kind', operator: 'equals', value: 'Project' }],
  });
  const reconciled = view.reconcileNativeNoteEntries([]);
  assert.deepEqual(reconciled.map((entry) => entry.file.path), [project.path]);
  assert.equal(reconciled[0].getValue('kind'), 'Project');
});

test('configured Folder filters use the current source parent instead of stale frontmatter', async () => {
  const currentProject = makeFile('Projects/Current.md');
  const movedAway = makeFile('Archive/Moved.md');
  const roots = [{
    and: [
      { property: 'note.folder', operator: 'equals', value: 'Projects' },
      { property: 'note.status', operator: 'equals', value: 'open' },
    ],
  }];
  const view = await createHarness({
    files: [currentProject, movedAway],
    frontmatter: new Map([
      [currentProject.path, { folderPath: 'Archive', status: 'open' }],
      [movedAway.path, { folderPath: 'Projects', status: 'open' }],
    ]),
    roots,
  });
  const staleNativeEntry = { file: movedAway, getValue: () => 'Projects' };
  const reconciled = view.reconcileNativeNoteEntries([staleNativeEntry]);
  assert.deepEqual(reconciled.map((entry) => entry.file.path), [currentProject.path]);
  assert.equal(reconciled[0].getValue('note.folderPath'), 'Projects');
});

test('note reconciliation fails closed for unsupported native predicates and active search', async () => {
  const note = makeFile('Projects/Unsafe.md');
  const frontmatter = new Map([[note.path, {}]]);
  const unsafeView = await createHarness({
    files: [note],
    frontmatter,
    roots: [{
      and: [
        { property: 'kind', operator: 'equals', value: 'note' },
        'file.backlinks.contains("Other")',
      ],
    }],
  });
  assert.deepEqual(unsafeView.reconcileNativeNoteEntries([]), []);
  const preservedNative = { file: note, getValue: () => null };
  assert.deepEqual(unsafeView.reconcileNativeNoteEntries([preservedNative]), [preservedNative]);

  const searchedView = await createHarness({
    files: [note],
    frontmatter,
    roots: [{ property: 'kind', operator: 'equals', value: 'note' }],
    search: 'unsafe',
  });
  assert.deepEqual(searchedView.reconcileNativeNoteEntries([]), []);

  const contextualView = await createHarness({
    files: [note],
    frontmatter,
    roots: [{
      and: [
        { property: 'kind', operator: 'equals', value: 'note' },
        { property: 'note.owner', operator: '!=', value: 'this.owner' },
      ],
    }],
  });
  assert.deepEqual(contextualView.reconcileNativeNoteEntries([]), []);
});

test('note reconciliation reuses warm results and invalidates on an authoritative vault event', async () => {
  const note = makeFile('Projects/Cached.md');
  const view = await createHarness({
    files: [note],
    frontmatter: new Map([[note.path, { status: 'open' }]]),
    roots: [{ property: 'kind', operator: 'equals', value: 'note' }],
  });
  let vaultScans = 0;
  view.app.vault.getMarkdownFiles = () => {
    vaultScans += 1;
    return [note];
  };

  const first = view.reconcileNativeNoteEntries([]);
  const second = view.reconcileNativeNoteEntries([]);
  assert.equal(vaultScans, 1, 'an unchanged warm render should reuse the reconciled note set');
  assert.equal(second, first, 'warm reconciliation should preserve the cached entry identities');

  view.invalidateNoteSemanticReconciliation();
  const third = view.reconcileNativeNoteEntries([]);
  assert.equal(vaultScans, 2, 'vault and metadata events must invalidate the warm reconciliation');
  assert.notEqual(third, first);
  assert.deepEqual(third.map((entry) => entry.file.path), [note.path]);
});
