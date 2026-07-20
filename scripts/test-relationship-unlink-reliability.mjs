import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';
import * as esbuild from 'esbuild';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

const build = await esbuild.build({
  stdin: {
    contents: [
      "export { SubitemRelationshipSyncService } from './src/services/subitem-relationship-sync-service.ts';",
      "export { ParentLinkResolutionService } from './src/services/parent-link-resolution-service.ts';",
      "export * from './src/services/relationship-outcome.ts';",
      "export { TFile, MarkdownView } from 'obsidian';",
    ].join('\n'),
    resolveDir: projectRoot,
    sourcefile: 'relationship-unlink-test-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
  plugins: [{
    name: 'relationship-obsidian-stub',
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'relationship-stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'relationship-stub' }, () => ({
        loader: 'js',
        contents: `
          export class App {}
          export class WorkspaceLeaf {}
          export class MarkdownView {}
          export class TFile {
            constructor(path) {
              this.path = path;
              this.name = path.split('/').pop() || path;
              this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
              this.basename = this.name.replace(/\\.[^.]+$/, '');
              this.parent = null;
            }
          }
          export class Notice { constructor(message) { this.message = message; } }
          export function normalizePath(path) {
            return String(path || '').replace(/\\\\/g, '/').replace(/^\\.\\//, '').replace(/\\/{2,}/g, '/');
          }
        `,
      }));
    },
  }],
});

const production = await import(
  `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`
);

const {
  MarkdownView,
  ParentLinkResolutionService,
  SubitemRelationshipSyncService,
  TFile,
  classifyTwoSidedRemovalStatus,
  formatParentUnlinkAggregateNotice,
  formatSingleRelationshipUnlinkNotice,
  runFailClosedTwoSidedRemoval,
  runGuardedRelationshipConversion,
  summarizeRelationshipUnlinkStatuses,
} = production;

function createSubitemHarness({
  initialContent = '- [[Child]]\nBody\n',
  childOutcome = 'removed',
  mutateBeforeProcess = null,
  processError = null,
  leaves = [],
  resolveBodyLinks = true,
} = {}) {
  const parentFile = new TFile('Notes/Parent.md');
  const childFile = new TFile('Notes/Child.md');
  const files = new Map([
    [parentFile.path, parentFile],
    [childFile.path, childFile],
    ['Parent.md', parentFile],
    ['Child.md', childFile],
    ['Parent', parentFile],
    ['Child', childFile],
  ]);
  let content = initialContent;
  let processCalls = 0;
  let beforeProcess = mutateBeforeProcess;

  const plugin = {
    settings: {
      enableLogging: false,
      linkedSubitemCheckboxMappings: [],
      linkedSubitemDefaultOpenState: '[ ]',
      properties: [],
      autoEmbedIgnoreFolders: [],
      autoEmbedIgnoreTags: [],
    },
    app: {
      vault: {
        read: async () => content,
        process: async (_file, transform) => {
          processCalls += 1;
          if (processError) throw processError;
          if (beforeProcess) {
            content = beforeProcess(content);
            beforeProcess = null;
          }
          content = transform(content);
          return content;
        },
        getAbstractFileByPath: (path) => resolveBodyLinks
          ? files.get(path) ?? files.get(String(path).replace(/^Notes\//, '')) ?? null
          : null,
        getMarkdownFiles: () => [parentFile, childFile],
      },
      metadataCache: {
        fileToLinktext: (file) => file.basename,
        getFileCache: () => ({ frontmatter: {} }),
        getFirstLinkpathDest: (target) => resolveBodyLinks
          ? files.get(target) ?? files.get(`${target}.md`) ?? files.get(`Notes/${target}.md`) ?? null
          : null,
      },
      workspace: {
        activeLeaf: null,
        getLeavesOfType: () => leaves,
      },
    },
    parentLinkResolutionService: {
      removeParentFromChildWithOutcome: async () => childOutcome,
      getParentsForChild: () => [],
    },
    bodySubitemLinkService: {
      parseLine(line) {
        const match = String(line || '').match(/\[\[([^\]|#]+)/);
        return match ? { linkTarget: match[1] } : null;
      },
      scanText: () => [],
    },
  };

  const service = new SubitemRelationshipSyncService(plugin);
  return {
    childFile,
    parentFile,
    plugin,
    service,
    getContent: () => content,
    setContent: (next) => { content = next; },
    getProcessCalls: () => processCalls,
  };
}

test('two-sided removal classification covers removed, absent, partial, and refused', () => {
  const cases = [
    ['removed', 'removed', 'removed'],
    ['removed', 'absent', 'removed'],
    ['absent', 'removed', 'removed'],
    ['absent', 'absent', 'absent'],
    ['removed', 'refused', 'partial'],
    ['refused', 'removed', 'partial'],
    ['absent', 'refused', 'refused'],
    ['refused', 'absent', 'refused'],
    ['refused', 'refused', 'refused'],
  ];
  for (const [left, right, expected] of cases) {
    assert.equal(classifyTwoSidedRemovalStatus(left, right), expected, `${left}/${right}`);
  }
});

test('unlink feedback never collapses partial or refused outcomes into an absent/no-op notice', () => {
  assert.deepEqual(
    summarizeRelationshipUnlinkStatuses('ready', ['removed', 'absent', 'partial', 'refused', 'partial']),
    {
      discovery: 'ready',
      removedCount: 1,
      absentCount: 1,
      partialCount: 2,
      refusedCount: 1,
    },
  );
  assert.equal(formatSingleRelationshipUnlinkNotice('absent', 'parent link'), 'No parent link existed.');
  assert.equal(
    formatSingleRelationshipUnlinkNotice('partial', 'parent link'),
    'Only part of parent link was removed; the other representation could not be verified or removed.',
  );
  assert.equal(
    formatSingleRelationshipUnlinkNotice('refused', 'parent link'),
    'Couldn’t remove parent link; the current state could not be verified.',
  );
  assert.equal(formatParentUnlinkAggregateNotice({
    discovery: 'ready',
    removedCount: 1,
    absentCount: 0,
    partialCount: 2,
    refusedCount: 3,
  }, 'Child'), 'Fully removed 1 parent link from Child. 2 partial; 3 refused.');
  assert.equal(formatParentUnlinkAggregateNotice({
    discovery: 'refused',
    removedCount: 0,
    absentCount: 0,
    partialCount: 0,
    refusedCount: 0,
  }, 'Child'), 'Couldn’t read the current parent links for Child; nothing was reported as removed.');
});

test('fail-closed sequencing never touches the second side after the first refuses', async () => {
  let secondCalls = 0;
  const outcome = await runFailClosedTwoSidedRemoval(
    async () => 'refused',
    async () => {
      secondCalls += 1;
      return 'removed';
    },
  );
  assert.deepEqual(outcome, { status: 'refused', first: 'refused', second: 'refused' });
  assert.equal(secondCalls, 0);
});

test('unlink reports removed only after both child metadata and parent body are absent', async () => {
  const harness = createSubitemHarness();
  const outcome = await harness.service.unlinkChildFromParent(harness.childFile, harness.parentFile);

  assert.deepEqual(outcome, { status: 'removed', child: 'removed', parent: 'removed' });
  assert.equal(harness.getContent(), 'Body\n');
  assert.equal(harness.getProcessCalls(), 1);
});

test('unlink reports absent when neither representation exists', async () => {
  const harness = createSubitemHarness({ initialContent: 'Body\n', childOutcome: 'absent' });
  const outcome = await harness.service.unlinkChildFromParent(harness.childFile, harness.parentFile);

  assert.deepEqual(outcome, { status: 'absent', child: 'absent', parent: 'absent' });
  assert.equal(harness.getContent(), 'Body\n');
  assert.equal(harness.getProcessCalls(), 0);
});

test('a concurrent closed-note edit is preserved and yields partial instead of false success', async () => {
  const harness = createSubitemHarness({
    childOutcome: 'removed',
    mutateBeforeProcess: (content) => `${content}Concurrent append\n`,
  });
  const outcome = await harness.service.unlinkChildFromParent(harness.childFile, harness.parentFile);

  assert.deepEqual(outcome, { status: 'partial', child: 'removed', parent: 'refused' });
  assert.match(harness.getContent(), /\[\[Child]]/);
  assert.match(harness.getContent(), /Concurrent append/);
});

test('a refused child-frontmatter removal leaves the parent body untouched', async () => {
  const harness = createSubitemHarness({ childOutcome: 'refused' });
  const before = harness.getContent();
  const outcome = await harness.service.unlinkChildFromParent(harness.childFile, harness.parentFile);

  assert.deepEqual(outcome, { status: 'refused', child: 'refused', parent: 'refused' });
  assert.equal(harness.getContent(), before);
  assert.equal(harness.getProcessCalls(), 0);
});

test('an unresolved body link that could target the child is refused instead of declared absent', async () => {
  const harness = createSubitemHarness({ childOutcome: 'removed', resolveBodyLinks: false });
  const before = harness.getContent();
  const outcome = await harness.service.unlinkChildFromParent(harness.childFile, harness.parentFile);

  assert.deepEqual(outcome, { status: 'partial', child: 'removed', parent: 'refused' });
  assert.equal(harness.getContent(), before);
});

test('serialized body mutations preserve both writes and drain their per-file queue', async () => {
  const harness = createSubitemHarness({ initialContent: 'Start' });
  let releaseFirst;
  let markEntered;
  const firstGate = new Promise((resolveGate) => { releaseFirst = resolveGate; });
  const firstEntered = new Promise((resolveEntered) => { markEntered = resolveEntered; });

  const first = harness.service.mutateMarkdownBodyWithOutcome(harness.parentFile, async (lines) => {
    markEntered();
    await firstGate;
    lines.push('First');
    return true;
  });
  await firstEntered;
  const second = harness.service.mutateMarkdownBodyWithOutcome(harness.parentFile, (lines) => {
    lines.push('Second');
    return true;
  });
  releaseFirst();

  assert.deepEqual(await Promise.all([first, second]), ['changed', 'changed']);
  assert.equal(harness.getContent(), 'Start\nFirst\nSecond');
  assert.equal(harness.service.bodyWriteChains.size, 0);
});

test('an open-editor revision change refuses the write before setValue or save', async () => {
  const harness = createSubitemHarness();
  let editorText = harness.getContent();
  let setValueCalls = 0;
  let requestSaveCalls = 0;
  const view = new MarkdownView();
  view.file = harness.parentFile;
  view.getViewType = () => 'markdown';
  view.contentEl = { querySelector: () => null };
  view.editor = {
    getValue: () => editorText,
    setValue: (next) => {
      setValueCalls += 1;
      editorText = next;
    },
  };
  view.requestSave = () => { requestSaveCalls += 1; };
  harness.plugin.app.workspace.getLeavesOfType = () => [{ view }];

  const outcome = await harness.service.mutateMarkdownBodyWithOutcome(harness.parentFile, async (lines) => {
    editorText += 'User edit\n';
    lines.splice(0, 1);
    return true;
  });

  assert.equal(outcome, 'refused');
  assert.equal(setValueCalls, 0);
  assert.equal(requestSaveCalls, 0);
  assert.match(editorText, /User edit/);
});

function createParentHarness(initialFrontmatter, forcedOutcome = null, resolveLinks = true) {
  const parentFile = new TFile('Notes/Parent.md');
  const childFile = new TFile('Notes/Child.md');
  const files = new Map([
    ['Parent', parentFile],
    ['Parent.md', parentFile],
    ['Notes/Parent.md', parentFile],
  ]);
  const frontmatter = structuredClone(initialFrontmatter);
  const plugin = {
    settings: { parentLinkFrontmatterKey: 'parent', autoSelfLinkParentInParentKey: false },
    app: {
      vault: {
        getAllLoadedFiles: () => [parentFile, childFile],
        getAbstractFileByPath: (path) => resolveLinks ? files.get(path) ?? null : null,
      },
      metadataCache: {
        getFileCache: () => ({ frontmatter: {} }),
        getFirstLinkpathDest: (target) => resolveLinks ? files.get(target) ?? files.get(`${target}.md`) ?? null : null,
      },
    },
    frontmatterMutationService: {
      async processGuardedWithOutcome(_file, mutator) {
        if (forcedOutcome) return forcedOutcome;
        const decision = mutator(frontmatter);
        if (decision === 'unchanged') return 'unchanged';
        if (decision === false) return 'guarded-abort';
        return 'changed';
      },
    },
  };
  return {
    childFile,
    parentFile,
    frontmatter,
    service: new ParentLinkResolutionService(plugin),
  };
}

test('child parent-frontmatter removal has authoritative removed/absent/refused outcomes', async () => {
  const removed = createParentHarness({ parent: ['[[Parent]]'] });
  assert.equal(await removed.service.removeParentFromChildWithOutcome(removed.childFile, removed.parentFile), 'removed');
  assert.deepEqual(removed.frontmatter, {});

  const absent = createParentHarness({ title: 'Child' });
  assert.equal(await absent.service.removeParentFromChildWithOutcome(absent.childFile, absent.parentFile), 'absent');
  assert.deepEqual(absent.frontmatter, { title: 'Child' });

  const refused = createParentHarness({ parent: ['[[Parent]]'] }, 'write-refused');
  assert.equal(await refused.service.removeParentFromChildWithOutcome(refused.childFile, refused.parentFile), 'refused');
  assert.deepEqual(refused.frontmatter, { parent: ['[[Parent]]'] });

  const unresolved = createParentHarness({ parent: ['[[Parent]]'] }, null, false);
  assert.equal(await unresolved.service.removeParentFromChildWithOutcome(unresolved.childFile, unresolved.parentFile), 'refused');
  assert.deepEqual(unresolved.frontmatter, { parent: ['[[Parent]]'] });
});

test('authoritative parent discovery reads the live mutation snapshot rather than metadata cache', async () => {
  const harness = createParentHarness({ parent: ['[[Parent]]'] });
  const parents = await harness.service.getParentsForChildAuthoritatively(harness.childFile);
  assert.deepEqual(parents?.map((entry) => entry.file.path), [harness.parentFile.path]);
});

test('conversion aborts on partial/refused unlink and accepts already-present replacement postconditions', async () => {
  for (const unlinkStatus of ['partial', 'refused']) {
    let createCalls = 0;
    const outcome = await runGuardedRelationshipConversion(
      async () => ({ status: unlinkStatus }),
      async () => {
        createCalls += 1;
        return 'created';
      },
    );
    assert.equal(outcome, 'unlink-refused');
    assert.equal(createCalls, 0);
  }

  assert.equal(await runGuardedRelationshipConversion(
    async () => ({ status: 'removed' }),
    async () => 'created',
  ), 'converted');
  assert.equal(await runGuardedRelationshipConversion(
    async () => ({ status: 'absent' }),
    async () => 'present',
  ), 'converted');
  assert.equal(await runGuardedRelationshipConversion(
    async () => ({ status: 'removed' }),
    async () => 'refused',
  ), 'replacement-refused');
});

test('attachment and parent wrappers consume typed outcomes and avoid stale read/modify writes', () => {
  const bulkSource = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');
  const attachmentStart = bulkSource.indexOf('async unlinkAttachmentWithOutcome');
  const attachmentEnd = bulkSource.indexOf('private removeEmbeddedAttachmentReferences', attachmentStart);
  const attachmentSource = bulkSource.slice(attachmentStart, attachmentEnd);
  const linkStart = bulkSource.indexOf('async linkAttachments');
  const linkEnd = bulkSource.indexOf('private generateEmbedLink', linkStart);
  const linkSource = bulkSource.slice(linkStart, linkEnd);

  assert.match(attachmentSource, /runFailClosedTwoSidedRemoval/);
  assert.match(attachmentSource, /mutateMarkdownBodyWithOutcome/);
  assert.doesNotMatch(attachmentSource, /cachedRead|vault\.modify/);
  assert.match(linkSource, /mutateMarkdownBodyWithOutcome/);
  assert.doesNotMatch(linkSource, /cachedRead|vault\.modify/);
  assert.match(bulkSource, /unlinkFromParentWithOutcome[\s\S]*result\.status === 'partial'/);
  assert.match(bulkSource, /getParentsForChildAuthoritatively/);
});
