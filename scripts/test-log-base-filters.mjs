import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const logBaseViewSource = readFileSync(new URL('../src/views/log-base-view.ts', import.meta.url), 'utf8');
const pluginStylesSource = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

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

async function loadFormulaService() {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/services/tps-base-formula-service.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadGroupingModule() {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/views/base-row-grouping.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadTotalsModule() {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/views/log-base-totals.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
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
            globalThis.__TpsTableFormulaTestFile = Dummy;
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

test('TPS Table evaluates deterministic Base date arithmetic against generated dates', async () => {
  const { evaluateLogBaseFilterRoots } = await loadModule();
  assert.equal(
    evaluateLogBaseFilterRoots(
      ['scheduled == date("2026-08-12") + "2d"'],
      { ...context, fields: { scheduled: '2026-08-14' } },
    ),
    true,
  );
});

test('unsupported branches stay unknown instead of hiding rows', async () => {
  const { evaluateLogBaseFilterNode } = await loadModule();
  assert.equal(evaluateLogBaseFilterNode({ or: ['unsupported.magic()', 'food == "eggs"'] }, context), null);
  assert.equal(evaluateLogBaseFilterNode({ and: ['unsupported.magic()', 'food == "eggs"'] }, context), false);
});

test('TPS Table heading rows satisfy generic and exact structural kind filters', async () => {
  const { evaluateLogBaseFilterRoots } = await loadModule();
  const headingContext = {
    ...context,
    rowKind: 'h3',
    fields: { priority: 'low' },
  };
  assert.equal(evaluateLogBaseFilterRoots(['kind == "header"', 'priority == "low"'], headingContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['kind == "heading"'], headingContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['kind == "h3"'], headingContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['kind == "h2"'], headingContext), false);
});

test('TPS Table exposes clean heading titles, levels, and raw tags as synthesized columns', async () => {
  const { TpsTableView } = await loadViewModule();
  const view = Object.create(TpsTableView.prototype);
  const file = {
    path: 'Inbox/Headings.md',
    name: 'Headings.md',
    basename: 'Headings',
    extension: 'md',
    parent: { path: 'Inbox' },
  };
  view.plugin = {
    settings: {},
    app: {
      vault: {
        getMarkdownFiles: () => [file],
        cachedRead: async () => '# Launch plan #qa-heading [priority:: low]',
      },
      metadataCache: {
        getFileCache: () => ({ frontmatter: {} }),
        getFirstLinkpathDest: () => null,
      },
    },
  };
  view.getEffectiveBaseFilterRoots = async () => [{ and: ['kind == "header"', 'tags.contains(qa-heading)'] }];
  view.lineMatchesHomeDateContext = () => true;
  view.sortEntries = (entries) => entries;
  view.getHomeContextDate = () => '';

  const entries = await view.loadEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, 'Launch plan');
  assert.equal(entries[0].queryFields.headinglevel, '1');
  assert.equal(entries[0].queryFields.tags, '#qa-heading');
  assert.equal(view.getEntryValue(entries[0], 'heading.level'), '1');
  assert.equal(view.getEntryValue(entries[0], 'tags'), '#qa-heading');
});

test('TPS Table excludes frontmatter and fenced-code examples from synthesized rows', async () => {
  const [{ TpsTableView }, { tpsBaseFormulaService }] = await Promise.all([
    loadViewModule(),
    loadFormulaService(),
  ]);
  const view = Object.create(TpsTableView.prototype);
  const file = {
    path: 'Inbox/Quarantined.md',
    name: 'Quarantined.md',
    basename: 'Quarantined',
    extension: 'md',
    parent: { path: 'Inbox' },
  };
  const content = [
    '---',
    'quarantine:',
    '  - [ ] Frontmatter task',
    '---',
    '# Visible heading',
    '- [ ] Visible task [open:: true] [done:: true] [checkboxStatus:: complete] [task.status:: complete]',
    '- Visible bullet',
    'Visible record [kind:: Project]',
    '```md',
    '# Hidden backtick heading',
    '- [ ] Hidden backtick task',
    '- Hidden backtick bullet',
    'Hidden backtick record [kind:: Project]',
    '```',
    '~~~text',
    '# Hidden tilde heading',
    '- [ ] Hidden tilde task',
    '- Hidden tilde bullet',
    '~~~',
  ].join('\n');
  view.plugin = {
    settings: { linkedSubitemCheckboxMappings: [] },
    sharedServices: {
      status: {
        normalize: (value) => String(value || '').toLowerCase(),
        checkboxStateToStatus: () => 'todo',
        isDoneStatus: () => false,
      },
    },
    app: {
      vault: {
        getMarkdownFiles: () => [file],
        cachedRead: async () => content,
      },
      metadataCache: {
        getFileCache: () => ({ frontmatter: {} }),
        getFirstLinkpathDest: () => null,
      },
    },
  };
  view.getEffectiveBaseFilterRoots = async () => [{
    or: ['kind == "task"', 'kind == "bullet"', 'kind == "heading"', 'kind == "project"'],
  }];
  view.getHomeContextDate = () => null;
  view.lineMatches = () => true;
  view.lineMatchesHomeDateContext = () => true;
  view.sortEntries = (entries) => entries;
  view.compiledFormulaSet = tpsBaseFormulaService.compile({
    structural_task: 'kind == "task" && checkboxState == "[ ]" && task.checkboxState == "[ ]"',
    no_invented_workflow: 'task.status == null && task.open == null && task.done == null',
  }, 'unmapped-structural-task');

  const entries = await view.loadEntries();
  assert.deepEqual(
    entries.map((entry) => ({ title: entry.title, line: entry.lineNumber + 1 })),
    [
      { title: 'Visible heading', line: 5 },
      { title: 'Visible task', line: 6 },
      { title: 'Visible bullet', line: 7 },
      { title: 'Visible record', line: 8 },
    ],
  );
  assert.equal(entries[1].queryFields.checkboxstate, '[ ]');
  assert.equal(Object.hasOwn(entries[1].queryFields, 'status'), false);
  assert.equal(Object.hasOwn(entries[1].queryFields, 'taskstatus'), false);
  assert.equal(Object.hasOwn(entries[1].queryFields, 'checkboxstatus'), false);
  assert.equal(Object.hasOwn(entries[1].queryFields, 'open'), false);
  assert.equal(Object.hasOwn(entries[1].queryFields, 'done'), false);
  assert.equal(view.getEntryValue(entries[1], 'formula.structural_task'), 'true');
  assert.equal(view.getEntryValue(entries[1], 'formula.no_invented_workflow'), 'true');
});

test('TPS Table canonical task.path filters address the containing note', async () => {
  const { evaluateLogBaseFilterRoots } = await loadModule();
  const taskContext = { ...context, rowKind: 'task', fields: { kind: 'task' } };
  assert.equal(evaluateLogBaseFilterRoots(['task.path == "Daily Notes/2026/07/08.md"'], taskContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['task.path == "Inbox.md"'], taskContext), false);
});

test('active Food Log source and selected-day predicates match representative rows', async () => {
  const { evaluateLogBaseFilterRoots } = await loadModule();
  assert.equal(evaluateLogBaseFilterRoots([{ and: ['file.ext == "md"'] }, { and: ['completedDate >= date("2026-07-08")', 'completedDate < date("2026-07-09")'] }], context), true);
});

test('TPS Table derives task status fields and follows the active view without sticky completion defaults', async () => {
  const [
    { evaluateLogBaseFilterRoots },
    { getTpsTableMarkdownLineKind, getTpsTableTaskQueryFields },
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
  ];
  const statusByState = new Map([
    ['[ ]', 'todo'],
    ['[\\]', 'working'],
    ['[?]', 'holding'],
    ['[x]', 'complete'],
    ['[-]', 'wont-do'],
  ]);
  const synthesizedRows = rows.map(([line, title]) => ({
    title,
    fields: {
      kind: 'task',
      ...getTpsTableTaskQueryFields(
        line,
        (state) => statusByState.get(state) || '',
        (status) => status === 'complete' || status === 'wont-do',
      ),
    },
  }));
  const acceptedTypes = new Set(['tps-table']);
  const select = (viewName) => {
    const roots = extractPersistedFilterRoots(definition, viewName, acceptedTypes).filters ?? [];
    return synthesizedRows
      .filter((row) => evaluateLogBaseFilterRoots(roots, { ...context, fields: row.fields }) === true)
      .map((row) => row.title);
  };

  assert.deepEqual(select('All tasks'), ['Todo', 'Working', 'Holding', 'Complete', 'Wont do']);
  assert.deepEqual(select('Working'), ['Working']);
  assert.deepEqual(select('All tasks again'), ['Todo', 'Working', 'Holding', 'Complete', 'Wont do']);
  assert.deepEqual(select('Open'), ['Todo', 'Working', 'Holding']);
  assert.deepEqual(select('Complete'), ['Complete']);
  assert.equal(getTpsTableMarkdownLineKind('1. [ ] Ordered task'), 'task');
  assert.deepEqual(
    getTpsTableTaskQueryFields('12) [ ] Ordered task', () => 'todo', () => false),
    {
      status: 'todo',
      checkboxstatus: 'todo',
      checkboxstate: '[ ]',
      open: 'true',
      isopen: 'true',
      done: 'false',
      isdone: 'false',
      completed: 'false',
      complete: 'false',
    },
  );
  assert.deepEqual(
    getTpsTableTaskQueryFields('- [!] Review', () => 'reviewing', () => false),
    {
      status: 'reviewing',
      checkboxstatus: 'reviewing',
      checkboxstate: '[!]',
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
      checkboxstate: '[z]',
      open: 'false',
      isopen: 'false',
      done: 'true',
      isdone: 'true',
      completed: 'true',
      complete: 'true',
    },
  );
  assert.deepEqual(
    getTpsTableTaskQueryFields('- [!] Unmapped', () => '', () => false),
    { checkboxstate: '[!]' },
  );
  assert.deepEqual(
    getTpsTableTaskQueryFields('- [q] Unknown authority', () => 'queued', () => null),
    { status: 'queued', checkboxstatus: 'queued', checkboxstate: '[q]' },
  );
  assert.equal(
    evaluateLogBaseFilterRoots(
      [{ property: 'task.status', operator: 'is', value: 'working' }],
      { ...context, fields: synthesizedRows[1].fields },
    ),
    true,
  );
  assert.match(logBaseViewSource, /const taskQueryFields = getTpsTableTaskQueryFields\(/);
  assert.match(logBaseViewSource, /queryFields = \{\s*\.\.\.queryFields,\s*\.\.\.taskQueryFields,\s*\}/);
  assert.match(
    logBaseViewSource,
    /createFilterContext\(\s*queryFields,\s*file,\s*line,\s*rowKind(?:,\s*index \+ 1)?\s*\)/,
  );
  assert.match(logBaseViewSource, /entry\.fields\[normalized\] \?\? entry\.queryFields\?\.\[normalized\]/);
  assert.doesNotMatch(logBaseViewSource, /Object\.assign\(fields,\s*getTpsTableTaskQueryFields\(/);
  assert.match(logBaseViewSource, /linkedSubitemCheckboxMappings/);
  assert.match(logBaseViewSource, /mapSubitemCheckboxStateToStatus\(checkboxMappings, checkboxState\)/);
  assert.match(logBaseViewSource, /normalizeLinkedSubitemMappings\(this\.plugin\.settings\?\.linkedSubitemCheckboxMappings/);
  assert.match(logBaseViewSource, /statusService\?\.isDoneStatus/);
});

test('TPS Table grouping places unmatched rows from the view setting and uses mapped task status', async () => {
  const [{ TpsTableView }, { groupTpsBaseRows }] = await Promise.all([
    loadViewModule(),
    loadGroupingModule(),
  ]);
  const File = globalThis.__TpsTableFormulaTestFile;
  const file = Object.assign(new File(), {
    path: 'Inbox/Status Rows.md',
    name: 'Status Rows.md',
    basename: 'Status Rows',
    extension: 'md',
    parent: { path: 'Inbox' },
  });
  const view = Object.create(TpsTableView.prototype);
  view.plugin = {
    app: { metadataCache: { getFirstLinkpathDest: () => null } },
  };
  const task = {
    file,
    line: '- [ ] Canonical task status',
    lineNumber: 0,
    title: 'Canonical task status',
    fields: {},
    queryFields: { 'task.status': 'todo', checkboxstatus: 'todo' },
  };
  const noteLike = {
    file,
    line: '- Home Renovations [status:: working]',
    lineNumber: 1,
    title: 'Home Renovations',
    fields: { status: 'working' },
    queryFields: {},
  };
  const unmatched = {
    file,
    line: '- Plain row',
    lineNumber: 2,
    title: 'Plain row',
    fields: {},
    queryFields: {},
  };

  assert.equal(view.getEntryValue(task, 'status'), 'todo');
  assert.equal(view.getEntryValue(task, 'task.status'), 'todo');
  assert.equal(view.getEntryValue(noteLike, 'status'), 'working');
  const groups = groupTpsBaseRows(
    [task, noteLike, unmatched],
    (entry) => view.getEntryRawValue(entry, 'status'),
    'asc',
    'first',
  );
  assert.deepEqual(groups.map((group) => group.key), [null, 'todo', 'working']);
  assert.match(mainSource, /key: 'ungroupedPosition'[\s\S]{0,220}first: 'Top'[\s\S]{0,80}last: 'Bottom'/u);
  assert.match(logBaseViewSource, /getConfigValue\('ungroupedPosition'\)/u);
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

test('TPS Table runtime mappings stay exact and default creation follows the first authoritative open row', async () => {
  const { TpsTableView } = await loadViewModule();
  const view = Object.create(TpsTableView.prototype);
  view.plugin = {
    settings: { linkedSubitemCheckboxMappings: [] },
    sharedServices: {
      status: {
        normalize: (value) => String(value ?? '').trim().toLowerCase(),
        isDoneStatus: (status) => status === 'shipped',
      },
    },
  };

  assert.deepEqual(view.getTaskCheckboxMappings(), []);
  assert.equal(view.getDefaultMappedTaskStatus('open'), null);
  view.plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[q]', statuses: ['queued'] },
    { checkboxState: '[s]', statuses: ['shipped'] },
  ];
  assert.deepEqual(view.getTaskCheckboxMappings().map((mapping) => mapping.checkboxState), ['[q]', '[s]']);
  assert.equal(view.getDefaultMappedTaskStatus('open'), 'queued');
  assert.equal(view.getDefaultMappedTaskStatus('done'), 'shipped');

  delete view.plugin.sharedServices.status.isDoneStatus;
  assert.equal(view.getDefaultMappedTaskStatus('open'), null);
  assert.equal(view.getDefaultMappedTaskStatus('done'), null);
});

test('TPS Table task creation revalidates its exact mapping inside the atomic append callback', async () => {
  const { TpsTableView } = await loadViewModule();
  const File = globalThis.__TpsTableFormulaTestFile;
  const target = new File();
  Object.assign(target, {
    path: 'Inbox/Mapping Race.md',
    name: 'Mapping Race.md',
    basename: 'Mapping Race',
    extension: 'md',
    parent: { path: 'Inbox' },
  });
  let content = '';
  let processCalls = 0;
  const view = Object.create(TpsTableView.prototype);
  view.containerEl = { closest: () => null };
  view.plugin = {
    settings: {
      properties: [],
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[q]', statuses: ['queued'] },
        { checkboxState: '[s]', statuses: ['shipped'] },
      ],
    },
    sharedServices: {
      status: {
        normalize: (value) => String(value ?? '').trim().toLowerCase(),
        isDoneStatus: (status) => status === 'shipped',
      },
    },
    resolveTpsBaseWriteFile: async () => {
      view.plugin.settings.linkedSubitemCheckboxMappings = [
        { checkboxState: '[s]', statuses: ['shipped'] },
      ];
      return { file: target, reason: 'resolved', source: 'filter', path: target.path };
    },
    app: {
      vault: {
        process: async (file, updater) => {
          assert.equal(file, target);
          processCalls += 1;
          content = updater(content);
        },
      },
    },
  };
  view.getEffectiveBaseFilterRoots = async () => ['kind == "task"'];
  view.getBaseFile = () => null;
  view.getViewName = () => 'Mapping race';
  view.getLineCreateContextPath = () => null;
  view.promptForLineTitle = async () => 'Do not append stale marker';
  view.queueRender = () => undefined;

  assert.equal(await view.createLineForView(), true);
  assert.equal(processCalls, 1);
  assert.equal(content, '');
});

test('TPS Table task creation rejects a stale open/done classification inside the atomic append callback', async () => {
  const { TpsTableView } = await loadViewModule();
  const File = globalThis.__TpsTableFormulaTestFile;
  const target = new File();
  Object.assign(target, {
    path: 'Inbox/Done Race.md',
    name: 'Done Race.md',
    basename: 'Done Race',
    extension: 'md',
    parent: { path: 'Inbox' },
  });
  let content = '';
  let doneStatuses = new Set(['shipped']);
  const view = Object.create(TpsTableView.prototype);
  view.containerEl = { closest: () => null };
  view.plugin = {
    settings: {
      properties: [],
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[q]', statuses: ['queued'] },
        { checkboxState: '[s]', statuses: ['shipped'] },
      ],
    },
    sharedServices: {
      status: {
        normalize: (value) => String(value ?? '').trim().toLowerCase(),
        isDoneStatus: (status) => doneStatuses.has(status),
      },
    },
    resolveTpsBaseWriteFile: async () => {
      doneStatuses = new Set(['queued', 'shipped']);
      return { file: target, reason: 'resolved', source: 'filter', path: target.path };
    },
    app: {
      vault: {
        process: async (_file, updater) => { content = updater(content); },
      },
    },
  };
  view.getEffectiveBaseFilterRoots = async () => ['kind == "task"', 'open == true'];
  view.getBaseFile = () => null;
  view.getViewName = () => 'Done race';
  view.getLineCreateContextPath = () => null;
  view.promptForLineTitle = async () => 'Do not append stale open state';
  view.queueRender = () => undefined;

  assert.equal(await view.createLineForView(), true);
  assert.equal(content, '');
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

test('TPS Table resolves persisted filters from its owning standalone Base leaf', async () => {
  const { TpsTableView } = await loadViewModule();
  const File = globalThis.__TpsTableFormulaTestFile;
  const baseFile = new File();
  Object.assign(baseFile, {
    path: 'Bases/Standalone Tasks.base',
    name: 'Standalone Tasks.base',
    basename: 'Standalone Tasks',
    extension: 'base',
    stat: { mtime: 42 },
  });
  const unrelatedFile = new File();
  Object.assign(unrelatedFile, {
    path: 'Inbox/Other.md',
    name: 'Other.md',
    basename: 'Other',
    extension: 'md',
  });
  const runtimeRoot = { and: ['priority == "high"'] };
  const activeViewRoot = { and: ['kind == "task"'] };
  const wholeBaseRoot = { and: ['file.folder == "Inbox"'] };
  const definition = {
    filters: wholeBaseRoot,
    views: [{ type: 'tps-table', name: 'Standalone Tasks', filters: activeViewRoot }],
  };

  for (const activeFile of [null, unrelatedFile]) {
    const containerEl = { closest: () => null };
    const decoyView = new File();
    decoyView.containerEl = { contains: () => false };
    decoyView.file = unrelatedFile;
    const ownerView = new File();
    ownerView.containerEl = { contains: (candidate) => candidate === containerEl };
    ownerView.file = baseFile;
    const reads = [];
    const view = Object.create(TpsTableView.prototype);
    view.containerEl = containerEl;
    view.config = {
      name: 'Standalone Tasks',
      get: (key) => key === 'filters' ? runtimeRoot : null,
    };
    view.plugin = {
      app: {
        workspace: {
          getActiveFile: () => activeFile,
          iterateAllLeaves(callback) {
            callback({ view: decoyView });
            callback({ view: ownerView });
          },
        },
        vault: {
          getFileByPath: () => null,
          cachedRead: async (file) => {
            reads.push(file);
            return JSON.stringify(definition);
          },
        },
      },
    };

    assert.equal(view.getBaseFile(), baseFile);
    assert.deepEqual(
      await view.getEffectiveBaseFilterRoots(true),
      [runtimeRoot, activeViewRoot, wholeBaseRoot],
    );
    assert.deepEqual(reads, [baseFile]);
  }

  const resolverBlock = sourceBlock(
    logBaseViewSource,
    '  private getBaseFile(): TFile | null {',
    '  private createFilterContext(',
  );
  assert.match(resolverBlock, /getOwningWorkspaceFile\(this\.plugin\.app, this\.containerEl, 'base'\)/);
  assert.doesNotMatch(resolverBlock, /controller|queryController|getActiveFile/);
});

test('TPS Table never falls through to native note creation when mobile loses the Base identity', async () => {
  const { TpsTableView } = await loadViewModule();
  const view = Object.create(TpsTableView.prototype);
  view.config = { get: () => ({ and: ['task.tags.contains(shopping)'] }) };
  view.containerEl = { closest: () => null };
  view.getBaseFile = () => null;

  assert.deepEqual(await view.getEffectiveBaseFilterRoots(false), [{ and: ['task.tags.contains(shopping)'] }]);
  await assert.rejects(
    view.getEffectiveBaseFilterRoots(true),
    /Could not resolve the Base definition for line creation/,
  );
});

test('TPS Table formulas drive synthesized-row filters, columns, sorting, grouping, and totals values', async () => {
  const [
    { TpsTableView },
    { tpsBaseFormulaService },
    { evaluateLogBaseFilterRoots },
    { groupTpsBaseRows },
    { calculateTpsTableTotals },
  ] = await Promise.all([
    loadViewModule(),
    loadFormulaService(),
    loadModule(),
    loadGroupingModule(),
    loadTotalsModule(),
  ]);
  const File = globalThis.__TpsTableFormulaTestFile;
  const file = new File();
  Object.assign(file, {
    path: 'Inbox/Formula Rows.md',
    name: 'Formula Rows.md',
    basename: 'Formula Rows',
    extension: 'md',
    parent: { path: 'Inbox' },
    stat: { size: 200, ctime: 1_786_000_000_000, mtime: 1_786_000_100_000 },
  });
  const view = Object.create(TpsTableView.prototype);
  view.containerEl = { closest: () => null };
  view.plugin = {
    settings: {
      properties: [
        { id: 'status', key: 'status', type: 'selector', acceptsKind: 'status', optionSources: ['entity'] },
      ],
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[ ]', statuses: ['todo'] },
      ],
    },
    app: {
      vault: {
        getMarkdownFiles: () => [file],
        getFileByPath: () => null,
        cachedRead: async () => [
          '1. [ ] **[[Projects/Parser|Ship parser]]** #qa [points:: 6] [status:: blocked] [kind:: project]',
          '- Plain record [points:: 3]',
          '### Heading row [points:: 5]',
        ].join('\n'),
      },
      workspace: { getActiveFile: () => null },
      metadataCache: {
        getFileCache: () => ({ frontmatter: { parentPoints: 2 }, tags: [], links: [] }),
        getFirstLinkpathDest: () => null,
      },
    },
    sharedServices: { status: { checkboxStateToStatus: () => 'todo', normalize: (value) => value, isDoneStatus: () => false } },
  };
  view.compiledFormulaSet = tpsBaseFormulaService.compile({
    total: 'number(points) + number(note.parentPoints)',
    doubled: 'formula.total * 2',
    carrier: 'kind',
    visible: 'formula.total >= 7 && kind != "bullet"',
    day: 'date("2026-08-10")',
    owner: 'link("People/Ada.md", "Ada")',
    labels: '["alpha", "beta"]',
    at_expected_line: 'line.number == 4',
    task_identity: 'kinds.contains("task")',
    project_identity: 'kinds.contains("project")',
    relational_status: 'status',
    workflow_status: 'task.status',
    raw_checkbox_state: 'checkboxState == "[ ]" && task.checkboxState == "[ ]"',
  }, 'table-formula-integration');
  view.config = { lineFilterAnyKeys: ['points'], lineFilterKeys: [] };
  view.getEffectiveBaseFilterRoots = async () => ['formula.visible'];
  view.lineMatchesHomeDateContext = () => true;
  view.getHomeContextDate = () => null;
  view.getBaseFile = () => null;
  view.getLineCreateContextPath = () => null;
  view.sortEntries = (entries) => entries;

  const entries = await view.loadEntries();
  assert.deepEqual(entries.map((entry) => entry.title), ['Ship parser', 'Heading row']);
  assert.equal(view.getEntryValue(entries[0], 'formula.total'), '8');
  assert.equal(view.getEntryValue(entries[0], 'formula.doubled'), '16');
  assert.equal(view.getEntryValue(entries[0], 'formula.carrier'), 'task');
  assert.equal(view.getEntryValue(entries[1], 'formula.carrier'), 'h3');
  assert.equal(view.getEntryValue(entries[0], 'formula.task_identity'), 'true');
  assert.equal(view.getEntryValue(entries[0], 'formula.project_identity'), 'true');
  assert.equal(view.getEntryValue(entries[0], 'formula.relational_status'), 'blocked');
  assert.equal(view.getEntryValue(entries[0], 'formula.workflow_status'), 'todo');
  assert.equal(view.getEntryValue(entries[0], 'formula.raw_checkbox_state'), 'true');
  assert.equal(
    evaluateLogBaseFilterRoots(['formula.doubled == 16'], {
      fields: entries[0].queryFields,
      file: { path: file.path, name: file.name, basename: file.basename, extension: file.extension, folder: 'Inbox', tags: [], frontmatter: {} },
      formulaSession: entries[0].formulaSession,
    }),
    true,
  );
  const formulaContext = {
    fields: entries[0].queryFields,
    rowKind: 'task',
    file: { path: file.path, name: file.name, basename: file.basename, extension: file.extension, folder: 'Inbox', tags: [], frontmatter: {} },
    formulaSession: entries[0].formulaSession,
  };
  assert.equal(evaluateLogBaseFilterRoots([{ property: 'formula.day', operator: '==', value: '2026-08-10' }], formulaContext), true);
  assert.equal(evaluateLogBaseFilterRoots([{ property: 'formula.owner', operator: '==', value: '[[People/Ada]]' }], formulaContext), true);
  assert.equal(evaluateLogBaseFilterRoots([{ property: 'formula.labels', operator: 'contains', value: 'beta' }], formulaContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['kind == task'], formulaContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['kind == project'], formulaContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['itemKind == task'], formulaContext), true);
  const failures = [];
  const failingFormulaContext = { ...formulaContext, onFormulaFailure: (result) => failures.push(result) };
  assert.equal(
    evaluateLogBaseFilterRoots([{ not: 'formula.missing' }], failingFormulaContext),
    false,
    'a broken formula cannot be negated into an included row',
  );
  assert.equal(failingFormulaContext.formulaFailed, true);
  assert.equal(
    evaluateLogBaseFilterRoots([{ or: ['formula.missing', 'formula.total == 8'] }], failingFormulaContext),
    false,
    'an evaluated broken branch fails closed before a later true sibling',
  );
  const failuresBeforeShortCircuit = failures.length;
  assert.equal(
    evaluateLogBaseFilterRoots([{ or: ['formula.total == 8', 'formula.missing'] }], failingFormulaContext),
    true,
    'a decisive true branch prevents evaluation of an unreachable broken sibling',
  );
  assert.equal(failures.length, failuresBeforeShortCircuit);
  assert.equal(
    evaluateLogBaseFilterRoots([{ property: 'formula.total', operator: 'approximately', value: 8 }], failingFormulaContext),
    false,
    'unsupported formula filter operators fail closed',
  );
  assert.ok(failures.some((failure) => failure.code === 'unsupported-formula-filter-operator'));
  assert.equal(
    view.createFilterContext({ kind: 'task' }, file, '- [ ] Created', 'task', 4).formulaSession.get('at_expected_line').value,
    true,
  );

  const groups = groupTpsBaseRows(entries, (entry) => view.getEntryRawValue(entry, 'formula.carrier'));
  assert.deepEqual(groups.map((group) => group.key), ['h3', 'task']);
  const totals = calculateTpsTableTotals([{
    key: 'formula.total',
    values: entries.map((entry) => view.getEntryRawValue(entry, 'formula.total')),
  }]);
  assert.equal(totals.values.get('formula.total'), '15');

  view.config = { sort: [{ property: 'formula.total', direction: 'desc' }] };
  view.sortEntries = TpsTableView.prototype.sortEntries;
  assert.deepEqual(view.sortEntries([...entries].reverse()).map((entry) => entry.title), ['Ship parser', 'Heading row']);
});

test('TPS Table uses native two-axis scrolling and restores both axes after a rerender', () => {
  const render = sourceBlock(
    logBaseViewSource,
    'private async render(): Promise<void>',
    'private async loadEntries()',
  );
  const scrollRegistration = sourceBlock(
    logBaseViewSource,
    'private configureTableScroller(',
    'private applyColumnWidth(',
  );

  assert.match(render, /const previousScroller = this\.containerEl\.querySelector<HTMLElement>\('\.tps-log-base-table-scroll'\)/u);
  assert.match(render, /const previousScrollLeft = previousScroller\?\.scrollLeft \?\? 0/u);
  assert.match(render, /const previousScrollTop = previousScroller\?\.scrollTop \?\? 0/u);
  assert.ok(
    render.indexOf('const previousScrollLeft') < render.indexOf('this.containerEl.empty()'),
    'scroll position must be captured before replacing the table DOM',
  );
  assert.match(render, /tableScroller\.scrollLeft = Math\.min\(previousScrollLeft,/u);
  assert.match(render, /tableScroller\.scrollTop = Math\.min\(previousScrollTop,/u);

  assert.match(scrollRegistration, /scroller\.tabIndex = 0/u);
  assert.match(scrollRegistration, /scroller\.setAttribute\('role', 'region'\)/u);
  assert.doesNotMatch(scrollRegistration, /addEventListener|preventDefault|setPointerCapture|transform/iu);
  assert.match(
    pluginStylesSource,
    /\.tps-log-base-table-scroll[\s\S]*?overflow-x:\s*auto !important;[\s\S]*?overflow-y:\s*auto !important;[\s\S]*?overscroll-behavior-x:\s*contain !important;[\s\S]*?overscroll-behavior-y:\s*auto !important;[\s\S]*?touch-action:\s*pan-x pan-y !important;/u,
  );
});
