import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function importServices() {
  const result = await build({
    stdin: {
      contents: `
        export { promoteChecklistItemToChild } from './src/plugin-api.ts';
        export { createSubitemForParentWithTitle } from './src/services/subitem-creation-service.ts';
        export { LinkedSubitemCheckboxService } from './src/services/linked-subitem-checkbox-service.ts';
        export { SubitemRelationshipSyncService } from './src/services/subitem-relationship-sync-service.ts';
        export { Notice, TFile } from 'obsidian';
      `,
      resolveDir: repoRoot,
      sourcefile: 'checklist-promotion-reliability-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({
          path: 'obsidian',
          namespace: 'checklist-promotion-test',
        }));
        builder.onLoad({ filter: /.*/u, namespace: 'checklist-promotion-test' }, () => ({
          loader: 'js',
          contents: `
            class Dummy {}
            class TFile {
              constructor(path) {
                this.path = path;
                this.name = path.split('/').pop() || path;
                this.basename = this.name.replace(/\\.[^.]+$/, '');
                this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
                this.parent = { path: '' };
              }
            }
            class TFolder extends Dummy {}
            class Notice {
              static messages = [];
              constructor(message) { Notice.messages.push(String(message)); }
            }
            const api = new Proxy({
              App: Dummy,
              BasesView: Dummy,
              FileView: Dummy,
              FuzzySuggestModal: Dummy,
              MarkdownView: Dummy,
              Menu: Dummy,
              Modal: Dummy,
              Notice,
              Setting: Dummy,
              TFile,
              TFolder,
              normalizePath: (value) => String(value ?? '').replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/'),
              parseYaml: (yaml) => Object.fromEntries(
                String(yaml || '').split(/\\r?\\n/u).flatMap((line) => {
                  const match = line.match(/^([A-Za-z0-9_.-]+):\\s*(.*?)\\s*$/u);
                  if (!match) return [];
                  const value = match[2].replace(/^"|"$/gu, '');
                  return [[match[1], value]];
                }),
              ),
              setIcon: () => undefined,
            }, { get(target, key) { return key in target ? target[key] : Dummy; } });
            module.exports = api;
          `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const servicesPromise = importServices();

function standardMappings() {
  return [
    { checkboxState: '[ ]', statuses: ['todo'] },
    { checkboxState: '[x]', statuses: ['complete'] },
    { checkboxState: '[-]', statuses: ['wont-do'] },
  ];
}

function createPromotionHarness(TFile, options = {}) {
  const rootFile = new TFile('Root.md');
  let parentContent = options.content ?? '- [ ] Promote me';
  const childContents = new Map();
  const events = [];
  const counts = {
    childCreates: 0,
    childDeletes: 0,
    childModifies: 0,
    parentWrites: 0,
    statusWrites: 0,
    metadataWrites: 0,
  };
  const normalize = (value) => String(value ?? '').trim().toLowerCase();
  const plugin = {
    settings: {
      checklistPromotionBehavior: options.behavior ?? 'remove',
      linkedSubitemCheckboxMappings: options.mappings ?? standardMappings(),
      autoSaveFolderPath: false,
      applyNotebookNavigatorRulesOnSubitemCreate: false,
      ignoredSubitemTags: [],
    },
    app: {
      vault: {
        cachedRead: async () => parentContent,
        getAbstractFileByPath: (path) => childContents.get(path)?.file ?? null,
        create: async (path, content) => {
          counts.childCreates += 1;
          events.push('child-create');
          if (options.createRaceExisting) {
            const racedFile = new TFile(path);
            childContents.set(path, { file: racedFile, content: options.racedContent ?? 'existing' });
            throw new Error('simulated create race');
          }
          if (options.createFailure) throw new Error('simulated create failure');
          const file = new TFile(path);
          childContents.set(path, { file, content });
          options.afterChildCreate?.({
            plugin,
            file,
            setChildContent: (next) => childContents.set(path, { file, content: String(next) }),
          });
          return file;
        },
        read: async (file) => file === rootFile ? parentContent : childContents.get(file.path)?.content ?? '',
        modify: async (file, content) => {
          counts.childModifies += 1;
          events.push('child-modify');
          const current = childContents.get(file.path);
          childContents.set(file.path, { file, content: String(content) });
          if (!current) throw new Error('unexpected child modify target');
        },
        delete: async (file) => {
          const current = childContents.get(file.path);
          if (!current || current.file !== file) throw new Error('ownership mismatch');
          childContents.delete(file.path);
          counts.childDeletes += 1;
          events.push('child-delete');
        },
        createFolder: async () => { throw new Error('unexpected folder creation'); },
      },
      metadataCache: {
        getFileCache: () => ({ frontmatter: {} }),
        fileToLinktext: (file) => file.path.replace(/\.md$/u, ''),
      },
      fileManager: {
        generateMarkdownLink: (file) => `[[${file.path.replace(/\.md$/u, '')}|${file.basename}]]`,
      },
    },
    parentLinkResolutionService: {
      getParentKey: () => 'childOf',
      getLogicalFrontmatter: () => ({}),
      isRelationshipTarget: () => true,
      isIgnoredFile: () => false,
      isIgnoredFrontmatter: () => false,
    },
    fileNamingService: {
      isDateOnlyBasename: () => false,
      getDailyNoteDateFormat: () => 'YYYY-MM-DD',
    },
    sharedServices: {
      status: {
        normalize,
        getStatusPropertyKey: () => options.statusKey ?? 'status',
        isDoneStatus: (status) => (options.doneStatuses ?? ['complete', 'wont-do']).includes(normalize(status)),
        setFileStatus: async (_file, status) => {
          counts.statusWrites += 1;
          events.push(`status:${status}`);
          if (options.statusWriteFailure) return false;
          const current = childContents.get(_file.path);
          if (!current) return false;
          const key = options.statusKey ?? 'status';
          const next = current.content.match(new RegExp(`^${key}:`, 'mu'))
            ? current.content.replace(new RegExp(`^${key}:.*$`, 'mu'), `${key}: "${status}"`)
            : current.content.replace(/^---\r?\n/u, `---\n${key}: "${status}"\n`);
          childContents.set(_file.path, { file: _file, content: next });
          return next !== current.content;
        },
      },
    },
    bulkEditService: {
      runSerializedFrontmatterWrite: async (_file, action) => action(),
    },
    frontmatterMutationService: {
      process: async () => { counts.metadataWrites += 1; },
    },
    subitemRelationshipSyncService: {
      mutateMarkdownBody: async (_file, mutator) => {
        options.beforeRevalidation?.({ plugin, setParentContent: (value) => { parentContent = value; } });
        events.push('source-revalidate');
        const lines = parentContent.split('\n');
        const changed = await mutator(lines, parentContent);
        if (!changed) return false;
        if (options.parentWriteFailure === 'before') throw new Error('simulated parent write failure');
        parentContent = lines.join('\n');
        counts.parentWrites += 1;
        events.push('parent-write');
        if (options.parentWriteFailure === 'after') throw new Error('simulated post-write failure');
        return true;
      },
    },
  };

  return {
    plugin,
    rootFile,
    counts,
    events,
    getParentContent: () => parentContent,
    getChildContent: (path) => childContents.get(path)?.content ?? null,
    hasChild: (path) => childContents.has(path),
  };
}

function createChildWorkflowLinkHarness(SubitemRelationshipSyncService, TFile, options = {}) {
  const parentFile = new TFile('Parent.md');
  const childFile = new TFile('Child.md');
  let parentContent = options.parentContent ?? '';
  let childFrontmatter = options.frontmatter ?? {};
  const counts = { mutations: 0, writes: 0 };
  const normalize = (value) => String(value ?? '').trim().toLowerCase();
  const getStatuses = (frontmatter, property) => {
    if (!frontmatter || typeof frontmatter !== 'object') return [];
    const actualKey = Object.keys(frontmatter).find((key) => key.toLowerCase() === String(property).toLowerCase());
    if (!actualKey) return [];
    const raw = frontmatter[actualKey];
    const values = Array.isArray(raw)
      ? raw
      : String(raw ?? '').includes(',')
        ? String(raw ?? '').split(',')
        : [raw];
    return values.map(normalize).filter(Boolean);
  };
  const plugin = {
    settings: {
      linkedSubitemCheckboxMappings: options.mappings ?? standardMappings(),
      linkedSubitemDefaultOpenState: options.defaultOpenState ?? '[ ]',
    },
    sharedServices: {
      status: {
        normalize,
        getStatusPropertyKey: () => options.statusKey ?? 'status',
        getStatuses,
        isDoneStatus: (status) => (options.doneStatuses ?? ['complete', 'wont-do']).includes(normalize(status)),
      },
    },
    app: {
      metadataCache: {
        getFileCache: () => ({ frontmatter: childFrontmatter }),
        fileToLinktext: (file) => file.path.replace(/\.md$/u, ''),
      },
    },
    bodySubitemLinkService: {
      scanText: () => [],
    },
    parentLinkResolutionService: {
      isIgnoredFile: (file) => (
        (file === parentFile && options.ignoreParent === true)
        || (file === childFile && options.ignoreChild === true)
      ),
      isIgnoredFrontmatter: () => options.ignoreFrontmatter === true,
    },
  };
  const service = new SubitemRelationshipSyncService(plugin);
  service.mutateMarkdownBody = async (_file, mutator) => {
    counts.mutations += 1;
    options.beforeMutation?.({
      plugin,
      setChildFrontmatter: (next) => { childFrontmatter = next; },
    });
    const lines = parentContent.split('\n');
    const changed = await mutator(lines, parentContent);
    if (!changed) return false;
    parentContent = lines.join('\n');
    counts.writes += 1;
    return true;
  };

  return {
    plugin,
    service,
    parentFile,
    childFile,
    counts,
    getParentContent: () => parentContent,
  };
}

test('child workflow body links honor a custom workflow key and mapped checkbox marker', async () => {
  const { SubitemRelationshipSyncService, TFile } = await servicesPromise;
  const harness = createChildWorkflowLinkHarness(SubitemRelationshipSyncService, TFile, {
    statusKey: 'workflowState',
    frontmatter: { WorkflowState: 'WORKING' },
    mappings: [
      { checkboxState: '[w]', statuses: ['working'] },
      { checkboxState: '[x]', statuses: ['complete'] },
    ],
  });

  const result = await harness.service.insertBodyLinkForChildWorkflow(
    harness.parentFile,
    harness.childFile,
  );

  assert.equal(result.changed, true);
  assert.equal(result.blockedReason, null);
  assert.equal(result.resolution.outcome, 'mapped');
  assert.equal(result.resolution.statusKey, 'workflowState');
  assert.equal(result.resolution.checkboxState, '[w]');
  assert.equal(harness.getParentContent(), '- [w] [[Child|Child]]\n');
  assert.deepEqual(harness.counts, { mutations: 1, writes: 1 });
});

test('child workflow body links reject ignored parents, children, and supplied child frontmatter before mutation', async () => {
  const { SubitemRelationshipSyncService, TFile } = await servicesPromise;
  for (const options of [
    { ignoreParent: true },
    { ignoreChild: true },
    { ignoreFrontmatter: true },
  ]) {
    const harness = createChildWorkflowLinkHarness(SubitemRelationshipSyncService, TFile, {
      ...options,
      frontmatter: { status: 'todo' },
    });
    const result = await harness.service.insertBodyLinkForChildWorkflow(
      harness.parentFile,
      harness.childFile,
      options.ignoreFrontmatter ? { frontmatter: { relationshipMode: 'ignore' } } : {},
    );
    assert.equal(result.changed, false);
    assert.equal(result.blockedReason, 'ignored');
    assert.equal(harness.getParentContent(), '');
    assert.deepEqual(harness.counts, { mutations: 0, writes: 0 });
  }
});

test('child workflow body links preserve statusless notes as bullets by default', async () => {
  const { SubitemRelationshipSyncService, TFile } = await servicesPromise;
  const harness = createChildWorkflowLinkHarness(SubitemRelationshipSyncService, TFile, {
    statusKey: 'workflowState',
    frontmatter: { title: 'Statusless child' },
    defaultOpenState: '[?]',
    mappings: [
      { checkboxState: '[?]', statuses: ['holding'] },
      { checkboxState: '[x]', statuses: ['complete'] },
    ],
  });

  const result = await harness.service.insertBodyLinkForChildWorkflow(
    harness.parentFile,
    harness.childFile,
  );

  assert.equal(result.changed, true);
  assert.equal(result.resolution.outcome, 'statusless');
  assert.equal(result.resolution.checkboxState, null);
  assert.equal(harness.getParentContent(), '- [[Child|Child]]\n');
  assert.deepEqual(harness.counts, { mutations: 1, writes: 1 });
});

test('configured-open statusless links use the exact persisted mapped open marker', async () => {
  const { SubitemRelationshipSyncService, TFile } = await servicesPromise;
  const harness = createChildWorkflowLinkHarness(SubitemRelationshipSyncService, TFile, {
    statusKey: 'workflowState',
    frontmatter: {},
    defaultOpenState: '[?]',
    mappings: [
      { checkboxState: '[ ]', statuses: ['todo'] },
      { checkboxState: '[?]', statuses: ['holding', 'paused'] },
      { checkboxState: '[x]', statuses: ['complete'] },
    ],
  });

  const result = await harness.service.insertBodyLinkForChildWorkflow(
    harness.parentFile,
    harness.childFile,
    { statuslessMode: 'configured-open' },
  );

  assert.equal(result.changed, true);
  assert.equal(result.resolution.outcome, 'statusless');
  assert.equal(result.resolution.checkboxState, '[?]');
  assert.deepEqual(result.resolution.mappingPlans[0], {
    checkboxState: '[?]',
    status: 'holding',
    statuses: ['holding', 'paused'],
    resolution: 'state',
  });
  assert.equal(harness.getParentContent(), '- [?] [[Child|Child]]\n');
});

test('child workflow body links fail closed before mutation for an unmapped nonempty status', async () => {
  const { SubitemRelationshipSyncService, TFile } = await servicesPromise;
  const harness = createChildWorkflowLinkHarness(SubitemRelationshipSyncService, TFile, {
    statusKey: 'workflowState',
    frontmatter: { workflowState: 'reviewing' },
    mappings: [
      { checkboxState: '[w]', statuses: ['working'] },
      { checkboxState: '[x]', statuses: ['complete'] },
    ],
  });

  const result = await harness.service.insertBodyLinkForChildWorkflow(
    harness.parentFile,
    harness.childFile,
  );

  assert.equal(result.changed, false);
  assert.equal(result.blockedReason, 'unmapped-status');
  assert.equal(result.resolution.outcome, 'unmapped');
  assert.equal(harness.getParentContent(), '');
  assert.deepEqual(harness.counts, { mutations: 0, writes: 0 });
});

test('child workflow body links abort without a write when mapping authority changes at mutation time', async () => {
  const { SubitemRelationshipSyncService, TFile } = await servicesPromise;
  const harness = createChildWorkflowLinkHarness(SubitemRelationshipSyncService, TFile, {
    statusKey: 'workflowState',
    frontmatter: { workflowState: 'working' },
    mappings: [{ checkboxState: '[w]', statuses: ['working'] }],
    beforeMutation: ({ plugin }) => {
      plugin.settings.linkedSubitemCheckboxMappings = [
        { checkboxState: '[?]', statuses: ['working'] },
      ];
    },
  });

  const result = await harness.service.insertBodyLinkForChildWorkflow(
    harness.parentFile,
    harness.childFile,
  );

  assert.equal(result.changed, false);
  assert.equal(result.blockedReason, 'workflow-changed');
  assert.equal(harness.getParentContent(), '');
  assert.deepEqual(harness.counts, { mutations: 1, writes: 0 });
});

test('configured-open statusless links reject a fallback row with an authoritative done status', async () => {
  const { SubitemRelationshipSyncService, TFile } = await servicesPromise;
  const harness = createChildWorkflowLinkHarness(SubitemRelationshipSyncService, TFile, {
    frontmatter: {},
    defaultOpenState: '[?]',
    mappings: [{ checkboxState: '[?]', statuses: ['holding', 'complete'] }],
  });

  const result = await harness.service.insertBodyLinkForChildWorkflow(
    harness.parentFile,
    harness.childFile,
    { statuslessMode: 'configured-open' },
  );

  assert.equal(result.changed, false);
  assert.equal(result.blockedReason, 'unmapped-status');
  assert.equal(harness.getParentContent(), '');
  assert.deepEqual(harness.counts, { mutations: 0, writes: 0 });
});

test('checklist promotion blocks stale, duplicate, and unmapped sources before every write', async () => {
  globalThis.window = { moment: null };
  const { Notice, TFile, promoteChecklistItemToChild } = await servicesPromise;
  Notice.messages.length = 0;

  const scenarios = [
    createPromotionHarness(TFile, {
      content: '- [!] Unmapped',
      mappings: standardMappings(),
    }),
    createPromotionHarness(TFile, {
      content: '- [ ] Duplicate\n- [ ] Duplicate',
    }),
    createPromotionHarness(TFile, {
      content: '- [ ] Stale source',
      beforeRevalidation: ({ setParentContent }) => setParentContent('- [ ] Changed source'),
    }),
    createPromotionHarness(TFile, {
      content: '- [ ] Mapping changed',
      beforeRevalidation: ({ plugin }) => {
        plugin.settings.linkedSubitemCheckboxMappings = [
          { checkboxState: '[x]', statuses: ['complete'] },
        ];
      },
    }),
    createPromotionHarness(TFile, {
      content: '- [ ] Missing completion mapping',
      behavior: 'complete-and-link',
      mappings: [{ checkboxState: '[ ]', statuses: ['todo'] }],
    }),
  ];
  const inputs = [
    { lineNumber: 0, rawLine: '- [!] Unmapped', text: 'Unmapped' },
    { lineNumber: 0, rawLine: '- [ ] Duplicate', text: 'Duplicate' },
    { lineNumber: 0, rawLine: '- [ ] Stale source', text: 'Stale source' },
    { lineNumber: 0, rawLine: '- [ ] Mapping changed', text: 'Mapping changed' },
    { lineNumber: 0, rawLine: '- [ ] Missing completion mapping', text: 'Missing completion mapping' },
  ];

  for (let index = 0; index < scenarios.length; index += 1) {
    const harness = scenarios[index];
    assert.equal(
      await promoteChecklistItemToChild(harness.plugin, harness.rootFile, inputs[index]),
      null,
    );
    assert.deepEqual(harness.counts, {
      childCreates: 0,
      childDeletes: 0,
      childModifies: 0,
      parentWrites: 0,
      statusWrites: 0,
      metadataWrites: 0,
    });
  }
});

test('checklist promotion revalidates the exact mapped revision before creating the child', async () => {
  globalThis.window = { moment: null };
  const { TFile, promoteChecklistItemToChild } = await servicesPromise;
  const harness = createPromotionHarness(TFile, {
    content: '- [ ] Promote me',
    behavior: 'remove',
  });

  const created = await promoteChecklistItemToChild(harness.plugin, harness.rootFile, {
    lineNumber: 0,
    rawLine: '- [ ] Promote me',
    text: 'Promote me',
  });

  assert.equal(created?.path, 'Promote me.md');
  assert.equal(harness.getParentContent(), '');
  assert.deepEqual(harness.counts, {
    childCreates: 1,
    childDeletes: 0,
    childModifies: 0,
    parentWrites: 1,
    statusWrites: 0,
    metadataWrites: 0,
  });
  assert.ok(harness.events.indexOf('source-revalidate') < harness.events.indexOf('child-create'));
  assert.ok(harness.events.indexOf('child-create') < harness.events.indexOf('parent-write'));
  assert.match(harness.getChildContent('Promote me.md'), /\nstatus: "todo"\n/u);
});

test('complete-and-link promotion uses the first mapped authoritative done status', async () => {
  globalThis.window = { moment: null };
  const { TFile, promoteChecklistItemToChild } = await servicesPromise;
  const harness = createPromotionHarness(TFile, {
    content: '- [ ] Finish release',
    behavior: 'complete-and-link',
    mappings: [
      { checkboxState: '[ ]', statuses: ['todo'] },
      { checkboxState: '[s]', statuses: ['shipped'] },
      { checkboxState: '[-]', statuses: ['canceled'] },
    ],
    doneStatuses: ['shipped', 'canceled'],
  });

  const created = await promoteChecklistItemToChild(harness.plugin, harness.rootFile, {
    lineNumber: 0,
    rawLine: '- [ ] Finish release',
    text: 'Finish release',
  });

  assert.equal(created?.path, 'Finish release.md');
  assert.equal(harness.getParentContent(), '- [[Finish release|Finish release]]');
  assert.match(harness.getChildContent('Finish release.md'), /\nstatus: "shipped"\n/u);
  assert.match(harness.getChildContent('Finish release.md'), /\ncompletedDate: /u);
  assert.equal(harness.counts.childCreates, 1);
  assert.equal(harness.counts.parentWrites, 1);
});

test('checklist promotion deletes only its owned child when the parent write never commits', async () => {
  globalThis.window = { moment: null };
  const { TFile, promoteChecklistItemToChild } = await servicesPromise;
  const harness = createPromotionHarness(TFile, {
    content: '- [ ] Roll back me\n  preserved child body',
    parentWriteFailure: 'before',
  });

  const created = await promoteChecklistItemToChild(harness.plugin, harness.rootFile, {
    lineNumber: 0,
    rawLine: '- [ ] Roll back me',
    text: 'Roll back me',
  });

  assert.equal(created, null);
  assert.equal(harness.getParentContent(), '- [ ] Roll back me\n  preserved child body');
  assert.equal(harness.hasChild('Roll back me.md'), false);
  assert.equal(harness.counts.childCreates, 1);
  assert.equal(harness.counts.childDeletes, 1);
  assert.deepEqual(harness.events.slice(-2), ['child-create', 'child-delete']);
});

test('checklist promotion keeps the owned child when an authoritative reread proves the parent committed', async () => {
  globalThis.window = { moment: null };
  const { TFile, promoteChecklistItemToChild } = await servicesPromise;
  const harness = createPromotionHarness(TFile, {
    content: '- [ ] Commit then throw',
    parentWriteFailure: 'after',
  });

  const created = await promoteChecklistItemToChild(harness.plugin, harness.rootFile, {
    lineNumber: 0,
    rawLine: '- [ ] Commit then throw',
    text: 'Commit then throw',
  });

  assert.equal(created?.path, 'Commit then throw.md');
  assert.equal(harness.getParentContent(), '');
  assert.equal(harness.hasChild('Commit then throw.md'), true);
  assert.equal(harness.counts.childDeletes, 0);
});

test('checklist promotion never adopts or mutates a raced target it did not create', async () => {
  globalThis.window = { moment: null };
  const { TFile, promoteChecklistItemToChild } = await servicesPromise;
  const harness = createPromotionHarness(TFile, {
    content: '- [ ] Raced target',
    createRaceExisting: true,
    racedContent: 'pre-existing content',
  });

  const created = await promoteChecklistItemToChild(harness.plugin, harness.rootFile, {
    lineNumber: 0,
    rawLine: '- [ ] Raced target',
    text: 'Raced target',
  });

  assert.equal(created, null);
  assert.equal(harness.getParentContent(), '- [ ] Raced target');
  assert.equal(harness.getChildContent('Raced target.md'), 'pre-existing content');
  assert.equal(harness.counts.childDeletes, 0);
  assert.equal(harness.counts.childModifies, 0);
  assert.equal(harness.counts.statusWrites, 0);
  assert.equal(harness.counts.metadataWrites, 0);
});

test('checklist promotion removes its owned child if checkbox authority changes during creation', async () => {
  globalThis.window = { moment: null };
  const { TFile, promoteChecklistItemToChild } = await servicesPromise;
  const harness = createPromotionHarness(TFile, {
    content: '- [ ] Mapping changes mid-create',
    afterChildCreate: ({ plugin }) => {
      plugin.settings.linkedSubitemCheckboxMappings = [
        { checkboxState: '[x]', statuses: ['complete'] },
      ];
    },
  });

  const created = await promoteChecklistItemToChild(harness.plugin, harness.rootFile, {
    lineNumber: 0,
    rawLine: '- [ ] Mapping changes mid-create',
    text: 'Mapping changes mid-create',
  });

  assert.equal(created, null);
  assert.equal(harness.getParentContent(), '- [ ] Mapping changes mid-create');
  assert.equal(harness.hasChild('Mapping changes mid-create.md'), false);
  assert.equal(harness.counts.childDeletes, 1);
});

test('checklist promotion authoritatively restores its mapped child status before committing the parent', async () => {
  globalThis.window = { moment: null };
  const { TFile, promoteChecklistItemToChild } = await servicesPromise;
  const harness = createPromotionHarness(TFile, {
    content: '- [ ] Restore mapped status',
    afterChildCreate: ({ setChildContent }) => {
      setChildContent('---\nstatus: "working"\n---\n');
    },
  });

  const created = await promoteChecklistItemToChild(harness.plugin, harness.rootFile, {
    lineNumber: 0,
    rawLine: '- [ ] Restore mapped status',
    text: 'Restore mapped status',
  });

  assert.equal(created?.path, 'Restore mapped status.md');
  assert.equal(harness.getParentContent(), '');
  assert.match(harness.getChildContent('Restore mapped status.md'), /\nstatus: "todo"\n/u);
  assert.equal(harness.counts.statusWrites, 1);
  assert.equal(harness.counts.childDeletes, 0);
});

test('Markdown-parent linked checkbox commits and verifies PDF and Base child companion status', async () => {
  const { LinkedSubitemCheckboxService, TFile } = await servicesPromise;
  const normalize = (value) => String(value ?? '').trim().toLowerCase();
  for (const extension of ['pdf', 'base']) {
    const parentFile = new TFile('Parent.md');
    const childFile = new TFile(`Child.${extension}`);
    let parentContent = `- [ ] [[${childFile.path}]]`;
    const childFrontmatter = { taskStatus: 'todo', title: `Child ${extension}` };
    let authoritativeReads = 0;
    let sourceReads = 0;
    const service = Object.create(LinkedSubitemCheckboxService.prototype);
    service.plugin = {
      settings: {
        linkedSubitemCheckboxMappings: [
          { checkboxState: '[ ]', statuses: ['todo'] },
          { checkboxState: '[x]', statuses: ['complete'] },
        ],
      },
      app: {
        vault: {
          read: async () => {
            sourceReads += 1;
            throw new Error('non-Markdown child bytes must not be parsed as YAML');
          },
        },
      },
      sharedServices: {
        status: {
          normalize,
        },
      },
      parentLinkResolutionService: {
        isIgnoredFile: () => false,
      },
      filePropertiesService: {
        getFrontmatterAsync: async (file) => {
          assert.equal(file, childFile);
          authoritativeReads += 1;
          return structuredClone(childFrontmatter);
        },
      },
      bodySubitemLinkService: {
        parseLine: (line) => line.includes(childFile.path)
          ? { linkTarget: childFile.path, wikilink: `[[${childFile.path}]]`, checkboxState: line.includes('[x]') ? '[x]' : '[ ]' }
          : null,
      },
      subitemRelationshipSyncService: {
        mutateMarkdownBody: async (file, mutator) => {
          assert.equal(file, parentFile);
          const lines = parentContent.split('\n');
          const changed = await mutator(lines, parentContent);
          if (changed) parentContent = lines.join('\n');
          return changed;
        },
        readMarkdownText: async (file) => {
          assert.equal(file, parentFile);
          return parentContent;
        },
      },
      bulkEditService: {
        setStatus: async (files, status, options) => {
          assert.deepEqual(files, [childFile]);
          assert.equal(options.writeGuard(), true);
          childFrontmatter.taskStatus = status;
          return 1;
        },
      },
    };
    service.subitemLineModelService = {
      getMappings: () => service.plugin.settings.linkedSubitemCheckboxMappings,
      getStatusKey: () => 'taskStatus',
    };
    service.resolveLinkedFile = () => childFile;
    service.refreshReferencesForChild = async () => undefined;
    service.scheduleRefreshForParentFile = () => undefined;
    service.scheduleDecorateForActiveView = () => undefined;
    service.refreshLivePreviewEditors = () => undefined;

    const changed = await service.setLinkedSubitemCheckboxState(
      parentFile,
      childFile,
      '[x]',
      { file: parentFile, lineNumber: 0, rawLine: parentContent },
    );

    assert.equal(changed, true);
    assert.equal(parentContent, `- [x] [[${childFile.path}]]`);
    assert.equal(childFrontmatter.taskStatus, 'complete');
    assert.equal(authoritativeReads, 2, 'preflight and post-write verification both use the companion');
    assert.equal(sourceReads, 0);
  }
});

test('non-Markdown parents create Markdown children from logical tags and temporal metadata without a body write', async () => {
  globalThis.window = { moment: null };
  const { createSubitemForParentWithTitle, TFile } = await servicesPromise;
  const creationSource = readFileSync(new URL('../src/services/subitem-creation-service.ts', import.meta.url), 'utf8');
  const promptBlock = creationSource.slice(
    creationSource.indexOf('export async function promptAndCreateSubitemForParent'),
    creationSource.indexOf('export async function createSubitemForParentWithTitle'),
  );
  assert.match(promptBlock, /parentLinkResolutionService\.isRelationshipTarget\(parentFile\)/u);
  assert.doesNotMatch(promptBlock, /parentFile\.extension\?\.toLowerCase\(\) !== 'md'/u);

  for (const extension of ['pdf', 'base']) {
    const parentFile = new TFile(`Reference/Parent.${extension}`);
    const files = new Map([[parentFile.path, parentFile]]);
    const logicalParent = {
      Tags: ['project', 'skip', '#PROJECT'],
      scheduled: '2026-08-15 09:30:00',
      due: '2026-08-16',
      allDay: true,
    };
    let createdContent = '';
    let bodyLinkCalls = 0;
    const plugin = {
      settings: {
        autoSaveFolderPath: false,
        applyNotebookNavigatorRulesOnSubitemCreate: false,
        ignoredSubitemTags: ['skip'],
      },
      app: {
        vault: {
          getAbstractFileByPath: (path) => files.get(path) ?? null,
          create: async (path, content) => {
            const file = new TFile(path);
            files.set(path, file);
            createdContent = content;
            return file;
          },
          createFolder: async () => undefined,
          getMarkdownFiles: () => [],
        },
        metadataCache: {
          getFileCache: () => ({ frontmatter: { tags: ['project'] } }),
          fileToLinktext: (file) => file.path,
        },
        fileManager: {
          generateMarkdownLink: (file) => `[[${file.path}]]`,
        },
      },
      parentLinkResolutionService: {
        isRelationshipTarget: (file) => file === parentFile || file.extension === 'md',
        isIgnoredFile: () => false,
        isIgnoredFrontmatter: () => false,
        getParentKey: () => 'childOf',
        getLogicalFrontmatter: (file) => file === parentFile ? logicalParent : {},
      },
      fileNamingService: {
        isDateOnlyBasename: () => false,
        getDailyNoteDateFormat: () => 'YYYY-MM-DD',
      },
      sharedServices: {
        status: {
          getStatusPropertyKey: () => 'taskStatus',
          normalize: (value) => String(value ?? '').trim().toLowerCase(),
          isDoneStatus: () => false,
        },
      },
      subitemRelationshipSyncService: {
        insertBodyLinkForChildWorkflow: async () => {
          bodyLinkCalls += 1;
          throw new Error('non-Markdown parent body must not be written');
        },
      },
      frontmatterMutationService: {
        process: async () => false,
      },
    };

    const created = await createSubitemForParentWithTitle(
      plugin,
      parentFile,
      `Created for ${extension}`,
      '/',
      { targetPath: `Created ${extension}.md`, suppressCreatedNotice: true },
    );

    assert.equal(created?.path, `Created ${extension}.md`);
    assert.match(createdContent, new RegExp(`childOf:\\n  - "\\[\\[Reference/Parent\\.${extension}\\]\\]"`, 'u'));
    assert.match(createdContent, /scheduled: 2026-08-15 09:30:00/u);
    assert.match(createdContent, /due: 2026-08-16/u);
    assert.match(createdContent, /allDay: true/u);
    assert.match(createdContent, /tags: \["project"\]/u);
    assert.doesNotMatch(createdContent, /skip/u);
    assert.equal(bodyLinkCalls, 0);
  }
});

test('derived child status fails closed for an unmapped checkbox and clears only with no checkbox reference', async () => {
  const { LinkedSubitemCheckboxService, TFile } = await servicesPromise;
  const childFile = new TFile('Child.md');
  const calls = { delete: 0, update: 0, refresh: 0 };
  const service = Object.create(LinkedSubitemCheckboxService.prototype);
  service.plugin = {
    app: { vault: { getFileByPath: () => null } },
    sharedServices: { status: { normalize: (value) => String(value ?? '').trim().toLowerCase() } },
    parentLinkResolutionService: { isIgnoredFile: () => false },
    subitemReferenceIndexService: { hasIgnoredReferenceForChild: async () => false },
    frontmatterMutationService: {
      deleteKeys: async () => { calls.delete += 1; },
      updateValues: async () => { calls.update += 1; },
    },
  };
  service.subitemLineModelService = {
    getMappings: () => standardMappings(),
    getNormalizedStatus: () => 'working',
    getStatusKey: () => 'status',
  };
  service.refreshReferencesForChild = async () => { calls.refresh += 1; };
  service.scheduleDecorateForActiveView = () => undefined;
  service.refreshLivePreviewEditors = () => undefined;

  const reference = (kind, checkboxState) => ({
    kind,
    checkboxState,
    childPath: childFile.path,
    parentPath: 'Parent.md',
  });

  assert.equal(
    await service.syncDerivedStatusForChildFromReferences(childFile, [reference('checkbox', '[!]')]),
    false,
  );
  assert.deepEqual(calls, { delete: 0, update: 0, refresh: 0 });

  assert.equal(
    await service.syncDerivedStatusForChildFromReferences(childFile, [reference('checkbox', null)]),
    false,
  );
  assert.deepEqual(calls, { delete: 0, update: 0, refresh: 0 });

  assert.equal(
    await service.syncDerivedStatusForChildFromReferences(childFile, [reference('bullet', null)]),
    true,
  );
  assert.deepEqual(calls, { delete: 1, update: 0, refresh: 1 });
});
