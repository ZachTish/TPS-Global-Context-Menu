import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const logBaseViewSource = readFileSync(new URL('../src/views/log-base-view.ts', import.meta.url), 'utf8');

async function loadModule() {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/views/log-base-filter.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadCreateModule() {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/views/log-base-create.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadBaseFilterRoots() {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/tps-list/base-filter-roots.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadViewModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/views/log-base-view.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'tps-table-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'tps-table-test' }, () => ({
          contents: `
            class Dummy {}
            const api = new Proxy(
              {
                BasesView: Dummy,
                Modal: Dummy,
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

const context = {
  fields: { food: 'watermelon', completeddate: '2026-07-08T23:15:00', protein: '6' },
  contextDate: '2026-07-08',
  file: { path: 'Daily Notes/2026/07/08.md', name: '08.md', basename: '08', extension: 'md', folder: 'Daily Notes/2026/07', tags: ['health'], frontmatter: { kind: 'daily-note' } },
};

test('TPS Table combines file and inline row filters', async () => {
  const { evaluateLogBaseFilterRoots } = await loadModule();
  assert.equal(evaluateLogBaseFilterRoots([{ and: ['file.ext == "md"'] }, { and: ['completedDate >= date("2026-07-08")', 'protein > 5'] }], context), true);
  assert.equal(evaluateLogBaseFilterRoots([{ and: ['file.ext == "md"'] }, { and: ['completedDate < date("2026-07-08")'] }], context), false);
});

test('TPS Table preserves nested any/all/not semantics', async () => {
  const { evaluateLogBaseFilterNode } = await loadModule();
  assert.equal(evaluateLogBaseFilterNode({ and: [{ or: ['food == "watermelon"', 'food == "eggs"'] }, { not: 'file.path.startsWith("Archive/")' }] }, context), true);
});

test('Home context tokens work without changing standalone filter behavior', async () => {
  const { evaluateLogBaseFilterNode } = await loadModule();
  assert.equal(evaluateLogBaseFilterNode('completedDate >= this.scheduled', context), true);
  assert.equal(evaluateLogBaseFilterNode('completedDate < this.scheduled', context), false);
});

test('unsupported branches stay unknown instead of hiding rows', async () => {
  const { evaluateLogBaseFilterNode } = await loadModule();
  assert.equal(evaluateLogBaseFilterNode({ or: ['unsupported.magic()', 'food == "eggs"'] }, context), null);
  assert.equal(evaluateLogBaseFilterNode({ and: ['unsupported.magic()', 'food == "eggs"'] }, context), false);
});

test('active Food Log source and selected-day predicates match representative rows', async () => {
  const { evaluateLogBaseFilterRoots } = await loadModule();
  assert.equal(evaluateLogBaseFilterRoots([{ and: ['file.ext == "md"'] }, { and: ['completedDate >= date("2026-07-08")', 'completedDate < date("2026-07-09")'] }], context), true);
});

test('TPS Table derives task status fields and follows the active view without sticky completion defaults', async () => {
  const [
    { evaluateLogBaseFilterRoots },
    { getTpsTableTaskQueryFields },
    { extractPersistedFilterRoots },
  ] = await Promise.all([loadModule(), loadCreateModule(), loadBaseFilterRoots()]);
  const definition = {
    filters: { and: ['kind == "task"'] },
    views: [
      { type: 'tps-table', name: 'All tasks' },
      { type: 'tps-table', name: 'Working', filters: { and: ['status == "working"'] } },
      { type: 'tps-table', name: 'All tasks again' },
      { type: 'tps-table', name: 'Open', filters: { and: ['open == true'] } },
      { type: 'tps-table', name: 'Complete', filters: { and: ['status == "complete"'] } },
    ],
  };
  const rows = [
    ['- [ ] Todo', 'Todo'],
    ['- [\\] Working', 'Working'],
    ['- [?] Holding', 'Holding'],
    ['- [x] Complete', 'Complete'],
    ['- [-] Wont do', 'Wont do'],
  ].map(([line, title]) => ({
    title,
    fields: { kind: 'task', ...getTpsTableTaskQueryFields(line) },
  }));
  const acceptedTypes = new Set(['tps-table']);
  const select = (viewName) => {
    const roots = extractPersistedFilterRoots(definition, viewName, acceptedTypes).filters ?? [];
    return rows
      .filter((row) => evaluateLogBaseFilterRoots(roots, { ...context, fields: row.fields }) === true)
      .map((row) => row.title);
  };

  assert.deepEqual(select('All tasks'), ['Todo', 'Working', 'Holding', 'Complete', 'Wont do']);
  assert.deepEqual(select('Working'), ['Working']);
  assert.deepEqual(select('All tasks again'), ['Todo', 'Working', 'Holding', 'Complete', 'Wont do']);
  assert.deepEqual(select('Open'), ['Todo', 'Working', 'Holding']);
  assert.deepEqual(select('Complete'), ['Complete']);
  assert.deepEqual(
    getTpsTableTaskQueryFields('- [!] Review', () => 'reviewing', () => false),
    {
      status: 'reviewing',
      checkboxstatus: 'reviewing',
      open: 'true',
      isopen: 'true',
      done: 'false',
      isdone: 'false',
      completed: 'false',
      complete: 'false',
    },
  );
  assert.deepEqual(
    getTpsTableTaskQueryFields('- [z] Archived', () => 'archived', (status) => status === 'archived'),
    {
      status: 'archived',
      checkboxstatus: 'archived',
      open: 'false',
      isopen: 'false',
      done: 'true',
      isdone: 'true',
      completed: 'true',
      complete: 'true',
    },
  );
  assert.equal(
    evaluateLogBaseFilterRoots(
      [{ property: 'task.status', operator: 'is', value: 'working' }],
      { ...context, fields: rows[1].fields },
    ),
    true,
  );
  assert.match(logBaseViewSource, /queryFields = \{[\s\S]{0,200}\.\.\.getTpsTableTaskQueryFields\(/);
  assert.match(
    logBaseViewSource,
    /createFilterContext\(\s*queryFields,\s*file,\s*line,\s*markdownKind\s*\)/,
  );
  assert.match(logBaseViewSource, /entry\.fields\[normalized\] \?\? entry\.queryFields\?\.\[normalized\]/);
  assert.doesNotMatch(logBaseViewSource, /Object\.assign\(fields,\s*getTpsTableTaskQueryFields\(/);
  assert.match(logBaseViewSource, /linkedSubitemCheckboxMappings/);
  assert.match(logBaseViewSource, /getKanbanStatusForCheckboxState\(checkboxState, checkboxMappings\)/);
  assert.match(logBaseViewSource, /statusService\?\.isDoneStatus/);
});

test('TPS Table task tag filters use exact task-tag membership across aliases and Markdown forms', async () => {
  const { TpsTableView } = await loadViewModule();
  const view = Object.create(TpsTableView.prototype);
  const file = {
    path: 'Inbox/Tagged Tasks.md',
    name: 'Tagged Tasks.md',
    basename: 'Tagged Tasks',
    extension: 'md',
    parent: { path: 'Inbox' },
  };
  const waitingOnlyLines = [
    '- [ ] Raw waiting #waiting',
    '- [ ] Singular waiting [tag:: #waiting]',
    '- [ ] Plural waiting [tags:: #waiting]',
    '- [ ] Structural kind wins [kind:: note] [tag:: #waiting]',
  ];
  const homeOnlyLines = [
    '- [ ] Raw home #home',
    '- [ ] Singular home [tag:: #home]',
    '- [ ] Plural home [tags:: #home]',
  ];
  const sharedLine = '- [ ] Multi waiting and home [tags:: #waiting, #home]';
  const waitingLines = [...waitingOnlyLines, sharedLine];
  const homeLines = [sharedLine, ...homeOnlyLines];
  const taskLines = [
    ...waitingOnlyLines,
    sharedLine,
    ...homeOnlyLines,
    '- [ ] Longer waiting tag #waiting-room',
    '- [ ] Longer home tag [tags:: #home-office]',
    '- [ ] File tag only',
  ];
  const sourceLines = [
    ...taskLines,
    '- Bullet with task-shaped tag #waiting',
    'Plain line cannot spoof task kind [kind:: task] [tags:: #waiting]',
  ];
  let filterRoots = [];
  view.plugin = {
    settings: {
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[ ]', statuses: ['todo'] },
      ],
    },
    sharedServices: {
      status: {
        normalize: (value) => String(value || '').toLowerCase(),
        checkboxStateToStatus: () => '',
        isDoneStatus: () => false,
      },
    },
    app: {
      vault: {
        getMarkdownFiles: () => [file],
        cachedRead: async () => sourceLines.join('\n'),
      },
      metadataCache: {
        getFileCache: () => ({
          tags: [],
          frontmatter: { tags: '#waiting, #home' },
        }),
      },
    },
  };
  view.getEffectiveBaseFilterRoots = async () => filterRoots;
  view.getHomeContextDate = () => null;
  view.lineMatches = () => true;
  view.lineMatchesHomeDateContext = () => true;
  view.sortEntries = (entries) => entries;

  const select = async (tagFilter) => {
    filterRoots = [{ and: ['kind == "task"', tagFilter] }];
    return (await view.loadEntries()).map((entry) => entry.line);
  };
  const aliases = ['tag', 'tags', 'task.tag', 'task.tags'];
  const literalForms = (tag) => [tag, `#${tag}`, `"${tag}"`, `"#${tag}"`];

  for (const alias of aliases) {
    for (const [tag, expected] of [['waiting', waitingLines], ['home', homeLines]]) {
      for (const literal of literalForms(tag)) {
        const expression = `${alias}.contains(${literal})`;
        assert.deepEqual(await select(expression), expected, expression);
      }
      const objectFilter = { property: alias, operator: 'contains', value: tag };
      assert.deepEqual(await select(objectFilter), expected, JSON.stringify(objectFilter));
    }
  }

  assert.deepEqual(
    await select('file.tags.contains(waiting)'),
    taskLines,
    'file.tags must remain source-note metadata and must not be treated as task tags',
  );
  assert.deepEqual(
    await select('file.tags.contains(wait)'),
    [],
    'file.tags.contains must use exact tag membership rather than substrings',
  );
});

test('TPS Table loadEntries keeps task query aliases out of inferred display columns', async () => {
  const { TpsTableView } = await loadViewModule();
  const view = Object.create(TpsTableView.prototype);
  const file = {
    path: 'Inbox/Tasks.md',
    name: 'Tasks.md',
    basename: 'Tasks',
    extension: 'md',
    parent: { path: 'Inbox' },
  };
  view.plugin = {
    settings: {
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[ ]', statuses: ['todo'] },
        { checkboxState: '[x]', statuses: ['complete'] },
      ],
    },
    sharedServices: {
      status: {
        normalize: (value) => String(value || '').toLowerCase(),
        checkboxStateToStatus: () => '',
        isDoneStatus: (status) => status === 'complete',
      },
    },
    app: {
      vault: {
        getMarkdownFiles: () => [file],
        cachedRead: async () => '- [ ] Todo\n- [x] Complete',
      },
    },
  };
  view.getEffectiveBaseFilterRoots = async () => [{ and: ['kind == "task"'] }];
  view.createFilterContext = (fields, sourceFile) => ({
    fields,
    file: {
      path: sourceFile.path,
      name: sourceFile.name,
      basename: sourceFile.basename,
      extension: sourceFile.extension,
      folder: sourceFile.parent.path,
      tags: [],
      frontmatter: {},
    },
  });
  view.lineMatchesHomeDateContext = () => true;
  view.sortEntries = (entries) => entries;
  view.getConfiguredColumnKeys = () => [];
  view.isHomeFoodSummary = () => false;

  const entries = await view.loadEntries();
  assert.equal(entries.length, 2);
  assert.deepEqual(Object.keys(entries[0].fields), ['kind']);
  assert.equal(entries[0].queryFields.status, 'todo');
  assert.equal(entries[1].queryFields.status, 'complete');
  const columns = view.getColumns(entries).map((column) => column.key);
  assert.deepEqual(columns, ['kind', 'source', 'line']);
});

test('TPS Table creation-time filter reads fail closed while rendering remains tolerant', async () => {
  const { TpsTableView } = await loadViewModule();
  const view = Object.create(TpsTableView.prototype);
  const readError = new Error('synthetic Base read failure');
  view.config = { get: () => null };
  view.containerEl = { closest: () => null };
  view.getViewName = () => 'Tasks';
  view.getBaseFile = () => ({ path: 'Tasks.base' });
  view.plugin = {
    app: {
      vault: {
        cachedRead: async () => {
          throw readError;
        },
      },
    },
  };

  assert.deepEqual(await view.getEffectiveBaseFilterRoots(false), []);
  await assert.rejects(
    view.getEffectiveBaseFilterRoots(true),
    (error) => error === readError,
  );
});
