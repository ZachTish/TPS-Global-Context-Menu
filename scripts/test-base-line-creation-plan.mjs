import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/views/base-line-creation-plan.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadTaskCreationModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/tps-list/task-creation-utils.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-stub',
      setup(context) {
        context.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
        context.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents: 'export const normalizePath = (value) => String(value);',
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadTableCreationModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/views/log-base-create.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadFilterModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/views/log-base-filter.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('whole-Base kind and active-view fields resolve additively', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const plan = resolveTpsBaseLineCreationPlan([
    {
      and: [
        { or: ['priority == "low"', 'priority == "medium"', 'priority == "high"'] },
        'open == true',
      ],
    },
    {
      and: [
        'kind == "task"',
        'task.path == "Inbox/Tasks.md"',
      ],
    },
  ], {
    orderedMappedStatuses: ['todo', 'complete'],
    isDoneStatus: (status) => status === 'complete',
  });

  assert.equal(plan.blockedReason, null);
  assert.equal(plan.kind, 'task');
  assert.equal(plan.status, 'todo');
  assert.equal(plan.targetPath, 'Inbox/Tasks.md');
  assert.deepEqual(plan.fields, { priority: 'low' });
  assert.deepEqual(plan.diagnostics.selectedBranches, ['root[0].and[0].or[0]']);
});

test('completion booleans select only authoritatively classified statuses in mapping order', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const options = {
    orderedMappedStatuses: ['shipped', 'queued', 'canceled'],
    isDoneStatus: (status) => status === 'shipped' || status === 'canceled',
  };

  const open = resolveTpsBaseLineCreationPlan([
    'kind == "task"',
    'open == true',
  ], options);
  assert.equal(open.blockedReason, null);
  assert.equal(open.status, 'queued');

  const done = resolveTpsBaseLineCreationPlan([
    'kind == "task"',
    'done == true',
  ], options);
  assert.equal(done.blockedReason, null);
  assert.equal(done.status, 'shipped');

  const nextDone = resolveTpsBaseLineCreationPlan([
    'kind == "task"',
    'done == true',
    'status != "shipped"',
  ], options);
  assert.equal(nextDone.blockedReason, null);
  assert.equal(nextDone.status, 'canceled');
});

test('an explicit workflow status outranks boolean defaults but must be authoritatively classified', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const explicit = resolveTpsBaseLineCreationPlan([
    'kind == "task"',
    'status == "canceled"',
    'done == true',
  ], {
    orderedMappedStatuses: ['shipped', 'queued', 'canceled'],
    isDoneStatus: (status) => status === 'shipped' || status === 'canceled',
  });
  assert.equal(explicit.blockedReason, null);
  assert.equal(explicit.status, 'canceled');

  const unclassified = resolveTpsBaseLineCreationPlan([
    'kind == "task"',
    'status == "archived"',
    'done == true',
  ], {
    orderedMappedStatuses: ['shipped', 'queued', 'canceled'],
    isDoneStatus: (status) => status === 'archived' ? null : status !== 'queued',
  });
  assert.equal(unclassified.kind, null);
  assert.equal(unclassified.blockedReason, 'status-completion-unclassified:archived');
});

test('completion defaults block after resolving filters when no mapped status matches', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const resolvedValues = [];
  const plan = resolveTpsBaseLineCreationPlan([
    'task.path == this.target',
    'kind == "task"',
    'done == true',
  ], {
    resolveValue: (value) => {
      resolvedValues.push(value);
      return value === 'this.target' ? 'Inbox/Mapped Tasks.md' : value;
    },
    orderedMappedStatuses: ['queued'],
    isDoneStatus: () => false,
  });

  assert.deepEqual(resolvedValues, ['this.target', 'task', 'true']);
  assert.equal(plan.kind, null);
  assert.equal(plan.targetPath, null);
  assert.equal(plan.blockedReason, 'checkbox-status-mapping-unavailable:done');
});

test('entity links, tags, and scheduled defaults compose additively like a task Base view', async () => {
  const [
    { resolveTpsBaseLineCreationPlan },
    { buildKanbanRootTaskLine },
    { buildTpsTableMarkdownLine },
  ] = await Promise.all([loadModule(), loadTaskCreationModule(), loadTableCreationModule()]);
  const plan = resolveTpsBaseLineCreationPlan([
    {
      and: [
        'projects.contains("[[Entities/Project Note]]")',
        'contexts.contains("[[Entities/Context Note]]")',
        'tags.contains("qa/entity-default")',
        'scheduled >= date("2026-08-16")',
        'scheduled < date("2026-08-17")',
      ],
    },
    {
      and: [
        'kind == "task"',
        'task.path == "Inbox/Tasks.md"',
      ],
    },
  ]);

  assert.equal(plan.blockedReason, null);
  assert.equal(plan.kind, 'task');
  assert.equal(plan.targetPath, 'Inbox/Tasks.md');
  assert.equal(plan.status, null);
  assert.deepEqual(plan.tags, ['#qa/entity-default']);
  assert.deepEqual(plan.fields, {
    projects: '[[Entities/Project Note]]',
    contexts: '[[Entities/Context Note]]',
    scheduled: '2026-08-16',
  });

  const defaults = {
    // The owning view resolves its authoritative mapped open status before
    // calling the line builder; the utility no longer invents todo/[ ].
    status: plan.status || 'queued',
    targetPath: plan.targetPath,
    inlineFields: new Map(Object.entries(plan.fields).map(([key, value]) => [key, { key, value }])),
    tags: new Set(plan.tags),
    excludedTags: new Set(),
  };
  const expectedLine = '- [ ] Ship entity matrix #qa/entity-default [projects:: [[Entities/Project Note]]] [contexts:: [[Entities/Context Note]]] [scheduled:: 2026-08-16]';
  assert.equal(
    buildKanbanRootTaskLine({
      title: 'Ship entity matrix',
      propName: null,
      laneValue: null,
      itemKind: 'task',
      defaults,
      getCheckboxStateForStatus: (status) => status === 'queued' ? '[ ]' : null,
    }),
    expectedLine,
  );
  assert.equal(
    buildTpsTableMarkdownLine('task', 'Ship entity matrix', plan.fields, {
      checkboxState: '[ ]',
      tags: plan.tags,
    }),
    expectedLine,
  );
});

test('creation preserves exact authored custom-key identity for string and object filters', async () => {
  const [
    { resolveTpsBaseLineCreationPlan },
    { buildTpsTableMarkdownLine },
    { evaluateLogBaseFilterRoots },
  ] = await Promise.all([loadModule(), loadTableCreationModule(), loadFilterModule()]);
  const roots = [
    'kind == "task"',
    'client id == "A-17"',
    { property: 'client-id', operator: 'equals', value: 'B-18' },
    { field: 'client_id', comparison: 'equals', expected: 'C-19' },
  ];

  const plan = resolveTpsBaseLineCreationPlan(roots);

  assert.equal(plan.blockedReason, null);
  assert.equal(plan.kind, 'task');
  assert.deepEqual(plan.fields, {
    'client id': 'A-17',
    'client-id': 'B-18',
    client_id: 'C-19',
  });
  const line = buildTpsTableMarkdownLine('task', 'Identity check', plan.fields, { checkboxState: '[ ]' });
  assert.equal(
    line,
    '- [ ] Identity check [client id:: A-17] [client-id:: B-18] [client_id:: C-19]',
  );
  assert.equal(evaluateLogBaseFilterRoots(roots, {
    fields: plan.fields,
    rowKind: 'task',
    title: 'Identity check',
    rawLine: line,
    file: {
      path: 'Inbox/Identity.md',
      name: 'Identity.md',
      basename: 'Identity',
      extension: 'md',
      folder: 'Inbox',
      tags: [],
      frontmatter: {},
    },
  }), true, 'the created row must prospectively satisfy the exact same Base filters');

  const reservedAliasPlan = resolveTpsBaseLineCreationPlan(['item kind == "task"']);
  assert.equal(reservedAliasPlan.kind, 'task', 'compact reserved aliases still resolve structurally');
  assert.deepEqual(reservedAliasPlan.fields, {});
});

test('the production Shopping query shape inherits task kind and adds the view tag', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const plan = resolveTpsBaseLineCreationPlan([
    {
      and: [
        'task.tags.contains(shopping)',
      ],
    },
    {
      and: [
        'kind == "task"',
        'file.folder != "_archive"',
        'file.folder != "Archive"',
      ],
    },
  ]);

  assert.equal(plan.blockedReason, null);
  assert.equal(plan.kind, 'task');
  assert.deepEqual(plan.tags, ['#shopping']);
  assert.deepEqual(plan.fields, {});
});

test('task-scoped active filters retain task intent when mobile supplies only runtime roots', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const plan = resolveTpsBaseLineCreationPlan([
    {
      and: [
        'task.tags.contains(shopping)',
        'task.status == "working"',
      ],
    },
  ]);

  assert.equal(plan.blockedReason, null);
  assert.equal(plan.kind, 'task');
  assert.equal(plan.status, 'working');
  assert.deepEqual(plan.tags, ['#shopping']);
  assert.equal(plan.provenance.kind?.expression, 'task.tags.contains(shopping)');
});

test('the additive plan becomes matching TPS List and TPS Table Markdown', async () => {
  const [
    { resolveTpsBaseLineCreationPlan },
    { buildKanbanRootTaskLine },
    { buildTpsTableMarkdownLine },
  ] = await Promise.all([loadModule(), loadTaskCreationModule(), loadTableCreationModule()]);
  const plan = resolveTpsBaseLineCreationPlan([
    {
      and: [
        'status == "working"',
        { or: ['priority == "low"', 'priority == "medium"', 'priority == "high"'] },
        'scheduled >= date("2026-08-14")',
        'scheduled < date("2026-08-15")',
        'task.tags.contains("shopping")',
      ],
    },
    {
      and: [
        'kind == "task"',
        'task.path == "Inbox/Tasks.md"',
        'tags.contains("work")',
      ],
    },
  ]);
  assert.equal(plan.blockedReason, null);
  assert.deepEqual(plan.fields, { priority: 'low', scheduled: '2026-08-14' });
  assert.deepEqual(plan.tags, ['#shopping', '#work']);
  assert.equal(plan.status, 'working');
  assert.equal(plan.targetPath, 'Inbox/Tasks.md');

  const defaults = {
    status: plan.status,
    targetPath: plan.targetPath,
    inlineFields: new Map(Object.entries(plan.fields).map(([key, value]) => [key, { key, value }])),
    tags: new Set(plan.tags),
    excludedTags: new Set(),
  };
  assert.equal(
    buildKanbanRootTaskLine({
      title: 'Buy supplies',
      propName: null,
      laneValue: null,
      itemKind: 'task',
      defaults,
      getCheckboxStateForStatus: () => '[\\]',
    }),
    '- [\\] Buy supplies #shopping #work [priority:: low] [scheduled:: 2026-08-14]',
  );
  assert.equal(
    buildTpsTableMarkdownLine('task', 'Buy supplies', plan.fields, {
      checkboxState: '[\\]',
      tags: plan.tags,
    }),
    '- [\\] Buy supplies #shopping #work [priority:: low] [scheduled:: 2026-08-14]',
  );
});

test('ordered alternatives backtrack only when a later conjunct conflicts', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const plan = resolveTpsBaseLineCreationPlan([
    { or: ['priority == "low"', 'priority == "medium"', 'priority == "high"'] },
    'priority == "medium"',
    'kind == "task"',
  ]);

  assert.equal(plan.blockedReason, null);
  assert.deepEqual(plan.fields, { priority: 'medium' });
  assert.deepEqual(plan.diagnostics.selectedBranches, ['root[0].or[1]']);
  assert.ok(plan.diagnostics.conflicts.some((reason) => reason.startsWith('field-conflict:priority')));
});

test('mixed OR branches retain correlation instead of combining unrelated defaults', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const plan = resolveTpsBaseLineCreationPlan([
    {
      or: [
        { and: ['kind == "bullet"', 'priority == "low"'] },
        { and: ['kind == "task"', 'priority == "high"'] },
      ],
    },
    'kind == "task"',
  ]);

  assert.equal(plan.blockedReason, null);
  assert.equal(plan.kind, 'task');
  assert.deepEqual(plan.fields, { priority: 'high' });
  assert.deepEqual(plan.diagnostics.selectedBranches, ['root[0].or[1]']);
});

test('scheduled day windows choose their inclusive lower day', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const plan = resolveTpsBaseLineCreationPlan([
    {
      and: [
        'scheduled >= date("2026-08-14")',
        'scheduled < date("2026-08-15")',
      ],
    },
    'kind == "task"',
  ], { today: '2026-07-25' });

  assert.equal(plan.blockedReason, null);
  assert.deepEqual(plan.fields, { scheduled: '2026-08-14' });
});

test('today date arithmetic resolves to Markdown dates instead of literal expressions', async () => {
  const { resolveTpsBaseDateExpression, resolveTpsBaseLineCreationPlan } = await loadModule();
  assert.equal(resolveTpsBaseDateExpression('today() + "2d"', { today: '2026-07-25' }), '2026-07-27');
  assert.equal(resolveTpsBaseDateExpression('date("2026-08-14") - "1w"'), '2026-08-07');
  const plan = resolveTpsBaseLineCreationPlan([
    'kind == "task"',
    'scheduled == today() + "2d"',
  ], { today: '2026-07-25' });
  assert.equal(plan.blockedReason, null);
  assert.deepEqual(plan.fields, { scheduled: '2026-07-27' });

  const unsupported = resolveTpsBaseLineCreationPlan([
    'kind == "task"',
    'scheduled == today() + "2fortnights"',
  ], { today: '2026-07-25' });
  assert.deepEqual(unsupported.fields, {});
  assert.ok(unsupported.diagnostics.unsupportedFilters.some((entry) => entry.includes('2fortnights')));
});

test('strict date bounds choose the first safe whole day and detect empty windows', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const safe = resolveTpsBaseLineCreationPlan([
    { and: ['scheduled > date("2026-08-14")', 'scheduled <= date("2026-08-16")'] },
    'kind == "task"',
  ]);
  assert.deepEqual(safe.fields, { scheduled: '2026-08-15' });

  const impossible = resolveTpsBaseLineCreationPlan([
    { and: ['scheduled > date("2026-08-14")', 'scheduled < date("2026-08-15")'] },
    'kind == "task"',
  ]);
  assert.equal(impossible.kind, null);
  assert.equal(impossible.blockedReason, 'date-range-conflict:scheduled');
});

test('generic header defaults to H1 while an exact heading level is preserved', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const generic = resolveTpsBaseLineCreationPlan(['kind == "header"']);
  assert.equal(generic.kind, 'heading');
  assert.equal(generic.headingLevel, 1);

  const exact = resolveTpsBaseLineCreationPlan(['kind == "h4"']);
  assert.equal(exact.kind, 'heading');
  assert.equal(exact.headingLevel, 4);
});

test('tags support equality, containsAny order, and negated branch backtracking', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const plan = resolveTpsBaseLineCreationPlan([
    {
      and: [
        'tags.contains("#home")',
        'tags.containsAny("#low", "#medium", "#high")',
      ],
    },
    { not: ['tags.contains("#low")'] },
    'kind == "task"',
  ]);

  assert.equal(plan.blockedReason, null);
  assert.deepEqual(plan.tags, ['#home', '#medium']);
  assert.ok(plan.diagnostics.selectedBranches.includes('root[0].and[1].value[1]'));
});

test('NOT applies De Morgan rules to nested groups', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const plan = resolveTpsBaseLineCreationPlan([
    {
      not: {
        and: [
          'priority == "low"',
          'status == "working"',
        ],
      },
    },
    'priority == "low"',
    'kind == "task"',
  ]);

  assert.equal(plan.blockedReason, null);
  assert.deepEqual(plan.fields, { priority: 'low' });
  assert.equal(plan.status, null);
  assert.deepEqual(plan.diagnostics.selectedBranches, ['root[0].not.and[1]']);
});

test('canonical targets must agree and unresolved explicit targets fail closed', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const equivalent = resolveTpsBaseLineCreationPlan([
    'file.path == "[[Inbox/A#Tasks|A]]"',
    'task.path == "Inbox/A.md"',
    'kind == "bullet"',
  ]);
  assert.equal(equivalent.blockedReason, null);
  assert.equal(equivalent.targetPath, '[[Inbox/A#Tasks|A]]');
  assert.equal(equivalent.targetPathSpecified, true);

  const unresolved = resolveTpsBaseLineCreationPlan([
    'file.path == this.file.path',
    'kind == "task"',
  ], { resolveValue: (value) => value === 'this.file.path' ? '' : value });
  assert.equal(unresolved.blockedReason, 'unresolved-target-path');
});

test('active and whole-Base contradictions block instead of silently overriding', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const plan = resolveTpsBaseLineCreationPlan([
    'status == "working"',
    'status == "complete"',
    'kind == "task"',
  ]);
  assert.equal(plan.kind, null);
  assert.equal(plan.blockedReason, 'status-conflict:working:complete');
});

test('TPS Table can treat status as an inline field for bullet and heading rows', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const bullet = resolveTpsBaseLineCreationPlan([
    'kind == "bullet"',
    'status == "Active"',
  ], { nonTaskStatusAsField: true });
  assert.equal(bullet.blockedReason, null);
  assert.equal(bullet.kind, 'bullet');
  assert.equal(bullet.status, null);
  assert.deepEqual(bullet.fields, { status: 'Active' });

  const strict = resolveTpsBaseLineCreationPlan([
    'kind == "heading"',
    'status == "Active"',
  ]);
  assert.equal(strict.blockedReason, 'status-kind-conflict:heading');
});

test('fully supported ordered branches outrank earlier branches that cannot supply deterministic defaults', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const plan = resolveTpsBaseLineCreationPlan([
    {
      or: [
        { and: ['kind == "bullet"', 'file.name.contains("x")'] },
        { and: ['kind == "task"', 'priority == "high"'] },
      ],
    },
  ]);
  assert.equal(plan.blockedReason, null);
  assert.equal(plan.kind, 'task');
  assert.deepEqual(plan.fields, { priority: 'high' });
  assert.deepEqual(plan.diagnostics.selectedBranches, ['root[0].or[1]']);
  assert.deepEqual(plan.diagnostics.unsupportedFilters, []);
});

test('formula filters remain computed and never become writable creation defaults', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const stringFilter = resolveTpsBaseLineCreationPlan([
    'kind == "task"',
    'formula.ready == true',
  ]);
  assert.equal(stringFilter.kind, 'task');
  assert.deepEqual(stringFilter.fields, {});
  assert.ok(stringFilter.diagnostics.unsupportedFilters.some((entry) => entry.includes('formula.ready')));

  const objectFilter = resolveTpsBaseLineCreationPlan([
    { property: 'formula.bucket', operator: 'equals', value: 'High' },
    { property: 'priority', operator: 'equals', value: 'high' },
    'kind == "task"',
  ]);
  assert.deepEqual(objectFilter.fields, { priority: 'high' });
  assert.equal(Object.hasOwn(objectFilter.fields, 'formula.bucket'), false);
});

test('search stays bounded and reports the guard instead of exploding', async () => {
  const { resolveTpsBaseLineCreationPlan } = await loadModule();
  const plan = resolveTpsBaseLineCreationPlan([
    { or: Array.from({ length: 80 }, (_, index) => `priority == "p${index}"`) },
    'priority == "p79"',
    'kind == "task"',
  ]);
  assert.equal(plan.kind, null);
  assert.equal(plan.blockedReason, 'filter-search-limit');
  assert.equal(plan.diagnostics.searchLimited, true);
  assert.ok(plan.diagnostics.maxConcurrentStates <= 64);
  assert.ok(plan.diagnostics.nodeVisits <= 256);
});
