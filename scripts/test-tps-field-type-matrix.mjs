import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function importBundled(relativePath, obsidianNamespace = null) {
  const plugins = obsidianNamespace ? [{
    name: `obsidian-${obsidianNamespace}`,
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/u }, () => ({
        path: 'obsidian',
        namespace: obsidianNamespace,
      }));
      builder.onLoad({ filter: /.*/u, namespace: obsidianNamespace }, () => ({
        contents: `
          class Dummy {
            open() {}
            close() {}
          }
          class TFile {
            constructor(path, parentPath = '') {
              this.path = String(path);
              this.name = this.path.split('/').at(-1) || this.path;
              this.basename = this.name.replace(/\\.[^.]+$/u, '');
              this.extension = this.name.includes('.') ? this.name.split('.').at(-1) : '';
              this.parent = { path: String(parentPath) };
              this.stat = { size: 1, ctime: 1, mtime: 1 };
            }
          }
          globalThis[${JSON.stringify(`__${obsidianNamespace}TFile`)}] = TFile;
          const api = new Proxy(
            {
              BasesView: Dummy,
              FileView: Dummy,
              FuzzySuggestModal: Dummy,
              Modal: Dummy,
              Notice: Dummy,
              TFile,
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
  }] : [];
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function properties() {
  return [
    { id: 'kind', key: 'kind', label: 'Kind', type: 'kind', options: ['project', 'initiative'] },
    { id: 'folder-path', key: 'folderPath', label: 'Folder', type: 'folder' },
    { id: 'projects', key: 'projects', label: 'Projects', type: 'list', listItemType: 'text' },
    { id: 'estimate', key: 'estimate', label: 'Estimate', type: 'number' },
    { id: 'approved', key: 'approved', label: 'Approved', type: 'checkbox' },
    { id: 'scheduled', key: 'scheduled', label: 'Scheduled', type: 'datetime' },
    { id: 'recurrence', key: 'recurrence', label: 'Recurrence', type: 'recurrence' },
    { id: 'snooze', key: 'snooze', label: 'Snooze', type: 'snooze' },
    { id: 'owner', key: 'owner', label: 'Owner', type: 'selector', acceptsKind: 'person', optionSources: ['entity'] },
    { id: 'labels', key: 'labels', label: 'Labels', type: 'list', listItemType: 'tag' },
  ];
}

function makeListView(TpsListView, configuredProperties = properties()) {
  const view = Object.create(TpsListView.prototype);
  view.plugin = {
    settings: {
      properties: configuredProperties,
      linkedSubitemCheckboxMappings: [],
      ungroupedPosition: 'last',
    },
  };
  view.config = { get: () => undefined };
  view.containerEl = { closest: () => null };
  view.getBaseFile = () => null;
  view.getBaseContextFile = () => null;
  view.getEmbeddedBaseFilterRoot = () => null;
  view.app = {
    metadataCache: { getFileCache: () => ({ frontmatter: {}, tags: [], links: [] }) },
    vault: {},
    workspace: { trigger: () => {} },
  };
  return view;
}

const representativeLine = [
  '- [ ] Ship release',
  '[kind:: Project]',
  '[folderPath:: Archive/Stale]',
  '[projects:: Alpha]',
  '[projects:: Beta]',
  '[estimate:: 12.5]',
  '[approved:: false]',
  '[scheduled:: 2026-08-12 09:30:00]',
  '[recurrence:: FREQ=WEEKLY;BYDAY=MO]',
  '[snooze:: 2026-08-13 10:00:00]',
  '[owner:: [[People/Ada|Ada]]]',
  '[labels:: #hca, #urgent]',
  '^field-matrix',
].join(' ');

test('TPS Table keeps authored Kind separate while bare Kind stays additive for filter, group, and sort', async () => {
  const [
    { TpsTableView },
    { evaluateLogBaseFilterRoots },
    { getTpsBaseGroupValues },
  ] = await Promise.all([
    importBundled('../src/views/log-base-view.ts', 'tps-field-matrix-table'),
    importBundled('../src/views/log-base-filter.ts'),
    importBundled('../src/views/base-value-semantics.ts'),
  ]);
  const File = globalThis['__tps-field-matrix-tableTFile'];
  const file = new File('Projects/Launch.md', 'Projects');
  const view = Object.create(TpsTableView.prototype);
  view.plugin = {
    settings: { properties: properties(), linkedSubitemCheckboxMappings: [] },
    sharedServices: {
      status: {
        normalize: (value) => String(value ?? '').trim().toLowerCase(),
        isDoneStatus: () => false,
        getStatusPropertyKey: () => 'status',
      },
    },
    app: {
      vault: {
        cachedRead: async () => representativeLine,
        getMarkdownFiles: () => [file],
      },
      metadataCache: {
        getFileCache: () => ({ frontmatter: {}, tags: [], links: [] }),
        getFirstLinkpathDest: () => null,
      },
    },
  };
  view.getEffectiveBaseFilterRoots = async () => [];
  view.getSourceFiles = () => [file];
  view.lineMatches = () => true;
  view.lineMatchesHomeDateContext = () => true;
  view.sortEntries = (entries) => entries;

  const [entry] = await view.loadEntries();
  assert.ok(entry, 'the representative task must load');
  assert.equal(entry.fields.kind, 'Project', 'authored Kind must not be overwritten by structural task identity');
  assert.equal(view.getEntryValue(entry, 'kind'), 'Project', 'the configured Kind cell shows authored Kind only');
  assert.deepEqual(view.getEntryOrderingValue(entry, 'kind'), ['task', 'Project']);
  assert.equal(view.getEntryOrderingValue(entry, 'itemKind'), 'task');
  assert.equal(view.getEntryOrderingValue(entry, 'explicitKind'), 'Project');
  assert.deepEqual(
    getTpsBaseGroupValues(
      view.getEntryOrderingValue(entry, 'kind'),
      view.getOrderingSemantics('kind'),
      'separate',
    ),
    ['task', 'Project'],
  );

  const context = view.createFilterContext(entry.queryFields, file, entry.line, 'task', 1);
  assert.equal(evaluateLogBaseFilterRoots(['kind == task'], context), true);
  assert.equal(evaluateLogBaseFilterRoots(['kind == project'], context), true);
  assert.equal(evaluateLogBaseFilterRoots(['itemKind == task'], context), true);
  assert.equal(evaluateLogBaseFilterRoots(['itemKind == project'], context), false);
  assert.equal(evaluateLogBaseFilterRoots(['explicitKind == project'], context), true);
});

test('TPS List uses the same additive Kind contract for tasks, bullets, and headings', async () => {
  const { TpsListView } = await importBundled('../src/tps-list/views/TpsListView.ts', 'tps-field-matrix-list-kind');
  const File = globalThis['__tps-field-matrix-list-kindTFile'];
  const file = new File('Projects/Launch.md', 'Projects');
  const view = makeListView(TpsListView);
  const scenarios = [
    { itemKind: 'task', structural: 'task' },
    { itemKind: 'bullet', structural: 'bullet' },
    { itemKind: 'heading', headingLevel: 3, structural: 'h3' },
  ];

  for (const scenario of scenarios) {
    const task = {
      ...scenario,
      line: 1,
      text: representativeLine,
      displayText: 'Ship release',
      checkboxState: scenario.itemKind === 'task' ? '[ ]' : undefined,
      inlineFields: [
        { key: 'kind', value: 'Project' },
        { key: 'folderPath', value: 'Archive/Stale' },
      ],
    };
    const card = view.getTaskPropertyValue(file, task, 'kind', new Set());
    assert.equal(card?.text, 'Project', `${scenario.structural} configured Kind cell shows authored Kind`);
    assert.equal(card?.editable, true, `${scenario.structural} authored Kind is editable`);
    assert.equal(card?.rawValue, 'Project');
    assert.deepEqual(view.getTaskSortValue({ file, task, laneId: 'ungrouped' }, 'kind'), [scenario.structural, 'Project']);
    assert.deepEqual(view.getTaskLaneIds(task, 'kind', file), [`key:${scenario.structural}`, 'key:project']);
    assert.equal(view.evaluatePositiveTaskFilterString('kind == project', task, file), true);
    assert.equal(view.evaluatePositiveTaskFilterString(`itemKind == ${scenario.structural}`, task, file), true);
    assert.equal(view.evaluatePositiveTaskFilterString('itemKind == project', task, file), false);
    assert.deepEqual(view.getTaskSortValue({ file, task, laneId: 'ungrouped' }, 'itemKind'), scenario.structural);
    assert.deepEqual(
      [view.getTaskSortValue({ file, task, laneId: 'ungrouped' }, 'explicitKind')].flat(),
      ['Project'],
      `${scenario.structural} explicitKind contains authored identity only`,
    );
  }
});

test('configured Folder is the source folder everywhere and ignores stale authored carriers', async () => {
  const [
    { TpsTableView },
    { evaluateLogBaseFilterRoots },
    { TpsListView },
  ] = await Promise.all([
    importBundled('../src/views/log-base-view.ts', 'tps-field-matrix-table-folder'),
    importBundled('../src/views/log-base-filter.ts'),
    importBundled('../src/tps-list/views/TpsListView.ts', 'tps-field-matrix-list-folder'),
  ]);

  const TableFile = globalThis['__tps-field-matrix-table-folderTFile'];
  const tableFile = new TableFile('Projects/Launch.md', 'Projects');
  const table = Object.create(TpsTableView.prototype);
  table.plugin = {
    settings: { properties: properties(), linkedSubitemCheckboxMappings: [] },
    sharedServices: { status: { normalize: String, isDoneStatus: () => false, getStatusPropertyKey: () => 'status' } },
    app: {
      vault: { cachedRead: async () => representativeLine, getMarkdownFiles: () => [tableFile] },
      metadataCache: { getFileCache: () => ({ frontmatter: {}, tags: [], links: [] }), getFirstLinkpathDest: () => null },
    },
  };
  table.getEffectiveBaseFilterRoots = async () => [];
  table.getSourceFiles = () => [tableFile];
  table.lineMatches = () => true;
  table.lineMatchesHomeDateContext = () => true;
  table.sortEntries = (entries) => entries;
  const [entry] = await table.loadEntries();
  assert.equal(table.getEntryValue(entry, 'folderPath'), 'Projects');
  assert.equal(table.getEntryOrderingValue(entry, 'folderPath'), 'Projects');
  const tableContext = table.createFilterContext(entry.queryFields, tableFile, entry.line, 'task', 1);
  assert.equal(evaluateLogBaseFilterRoots(['folderPath == "Projects"'], tableContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['folderPath == "Archive/Stale"'], tableContext), false);

  const ListFile = globalThis['__tps-field-matrix-list-folderTFile'];
  const listFile = new ListFile('Projects/Launch.md', 'Projects');
  const list = makeListView(TpsListView);
  const task = {
    itemKind: 'task',
    line: 1,
    text: representativeLine,
    displayText: 'Ship release',
    checkboxState: '[ ]',
    inlineFields: [{ key: 'folderPath', value: 'Archive/Stale' }],
  };
  assert.deepEqual(list.getTaskPropertyValue(listFile, task, 'folderPath', new Set()), {
    text: 'Projects',
    title: 'Source folder: Projects',
    kind: 'folder',
    editable: false,
    rawValue: 'Projects',
  });
  assert.deepEqual(list.getTaskLaneIds(task, 'folderPath', listFile), ['key:projects']);
  assert.equal(list.getTaskSortValue({ file: listFile, task, laneId: 'key:projects' }, 'folderPath'), 'Projects');
  assert.equal(list.evaluatePositiveTaskFilterString('folderPath == "Projects"', task, listFile), true);
  assert.equal(list.evaluatePositiveTaskFilterString('folderPath == "Archive/Stale"', task, listFile), false);
  assert.equal(list.isWritableTaskGroupingProperty('folderPath'), false, 'dragging to a computed folder lane cannot write stale inline metadata');
});

test('repeated configured list carriers have one consistent visible, grouped, sorted, and stored value set', async () => {
  const [
    { TpsTableView },
    { TpsListView },
    {
      applyLogBasePropertyValueChoice,
      addLogBaseListPropertyValue,
      removeLogBaseListPropertyValue,
    },
    { readInlineFields },
    { getTpsBaseGroupValues },
  ] = await Promise.all([
    importBundled('../src/views/log-base-view.ts', 'tps-field-matrix-table-list'),
    importBundled('../src/tps-list/views/TpsListView.ts', 'tps-field-matrix-list-list'),
    importBundled('../src/views/log-base-property-choice.ts'),
    importBundled('../src/views/log-line-utils.ts'),
    importBundled('../src/views/base-value-semantics.ts'),
  ]);

  const TableFile = globalThis['__tps-field-matrix-table-listTFile'];
  const tableFile = new TableFile('Projects/Launch.md', 'Projects');
  const table = Object.create(TpsTableView.prototype);
  table.plugin = {
    settings: { properties: properties(), linkedSubitemCheckboxMappings: [] },
    sharedServices: { status: { normalize: String, isDoneStatus: () => false, getStatusPropertyKey: () => 'status' } },
    app: {
      vault: { cachedRead: async () => representativeLine, getMarkdownFiles: () => [tableFile] },
      metadataCache: { getFileCache: () => ({ frontmatter: {}, tags: [], links: [] }), getFirstLinkpathDest: () => null },
    },
  };
  table.getEffectiveBaseFilterRoots = async () => [];
  table.getSourceFiles = () => [tableFile];
  table.lineMatches = () => true;
  table.lineMatchesHomeDateContext = () => true;
  table.sortEntries = (entries) => entries;
  const [entry] = await table.loadEntries();
  assert.equal(table.getEntryValue(entry, 'projects'), 'Alpha, Beta');
  const tableOrderingValue = table.getEntryOrderingValue(entry, 'projects');
  assert.deepEqual(tableOrderingValue, ['Alpha', 'Beta']);
  assert.deepEqual(
    getTpsBaseGroupValues(tableOrderingValue, table.getOrderingSemantics('projects'), 'separate'),
    ['Alpha', 'Beta'],
    'Table grouping must still expose every list member',
  );
  const tableFilterContext = table.createFilterContext(entry.queryFields, tableFile, entry.line, 'task', 1);
  const { evaluateLogBaseFilterRoots } = await importBundled('../src/views/log-base-filter.ts');
  assert.equal(evaluateLogBaseFilterRoots(['projects == Alpha'], tableFilterContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['projects == Beta'], tableFilterContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['projects.contains(Beta)'], tableFilterContext), true);
  assert.equal(
    evaluateLogBaseFilterRoots(['projects.contains(Bet)'], tableFilterContext),
    false,
    'configured list contains matches complete parsed members instead of carrier substrings',
  );
  assert.equal(
    evaluateLogBaseFilterRoots(['task.title.contains("hip rele")'], tableFilterContext),
    true,
    'ordinary scalar text contains remains a substring match',
  );

  const ListFile = globalThis['__tps-field-matrix-list-listTFile'];
  const listFile = new ListFile('Projects/Launch.md', 'Projects');
  const list = makeListView(TpsListView);
  const task = {
    itemKind: 'task',
    line: 1,
    text: representativeLine,
    displayText: 'Ship release',
    checkboxState: '[ ]',
    inlineFields: [
      { key: 'projects', value: 'Alpha' },
      { key: 'projects', value: 'Beta' },
    ],
  };
  const card = list.getTaskPropertyValue(listFile, task, 'projects', new Set());
  assert.equal(card?.text, 'Alpha, Beta');
  assert.equal(card?.rawValue, 'Alpha, Beta');
  assert.deepEqual(list.getTaskLaneIds(task, 'projects', listFile), ['key:alpha', 'key:beta']);
  assert.deepEqual(list.getTaskSortValue({ file: listFile, task, laneId: 'key:Alpha' }, 'projects'), ['Alpha', 'Beta']);
  assert.equal(list.evaluatePositiveTaskFilterString('projects == Alpha', task, listFile), true);
  assert.equal(list.evaluatePositiveTaskFilterString('projects == Beta', task, listFile), true);
  assert.equal(list.evaluatePositiveTaskFilterString('projects.contains(Beta)', task, listFile), true);
  assert.equal(
    list.evaluatePositiveTaskFilterString('projects.contains(Bet)', task, listFile),
    false,
    'TPS List uses exact parsed-member contains semantics for configured lists',
  );
  assert.equal(
    list.evaluatePositiveTaskFilterString('task.title.contains("hip rele")', task, listFile),
    true,
    'TPS List preserves substring contains for ordinary scalar text',
  );

  const updated = applyLogBasePropertyValueChoice(
    representativeLine,
    properties().find((property) => property.key === 'projects'),
    { kind: 'literal', value: 'Gamma', label: 'Gamma', detail: 'Manual' },
  );
  assert.equal(readInlineFields(updated).projects, 'Alpha, Beta, Gamma');
  assert.equal((updated.match(/\[projects::/gu) || []).length, 1, 'mutation canonicalizes repeated carriers without losing a value');

  const addedThroughEditorRoute = addLogBaseListPropertyValue(
    representativeLine,
    properties().find((property) => property.key === 'projects'),
    'Gamma',
    'literal',
  );
  assert.equal(
    readInlineFields(addedThroughEditorRoute).projects,
    'Alpha, Beta, Gamma',
    'Table and List add-value editor callbacks preserve every repeated carrier',
  );
  const removedThroughEditorRoute = removeLogBaseListPropertyValue(
    addedThroughEditorRoute,
    properties().find((property) => property.key === 'projects'),
    'Beta',
  );
  assert.equal(
    readInlineFields(removedThroughEditorRoute).projects,
    'Alpha, Gamma',
    'Table and List remove-value editor callbacks can remove any repeated-carrier member',
  );
  assert.equal(
    (removedThroughEditorRoute.match(/\[projects::/gu) || []).length,
    1,
    'editor mutations retain one canonical carrier',
  );

  const customTagLine = '- [ ] Ship <!-- [labels:: #hca] [labels:: #urgent] -->';
  assert.deepEqual(
    table.getEntryConfiguredPropertyValueItems(
      {
        ...entry,
        line: customTagLine,
        fields: readInlineFields(customTagLine),
        fieldValues: (await importBundled('../src/views/log-line-utils.ts')).readInlineFieldValues(customTagLine),
      },
      properties().find((property) => property.key === 'labels'),
    ),
    ['#hca', '#urgent'],
    'custom tag-list carriers retain every authored member',
  );
});

test('line storage matrix preserves task, bullet, and heading structure while scalar types clear cleanly', async () => {
  const {
    readInlineFields,
    setLogInlineFieldValue,
    toggleLogLineSemanticTag,
  } = await importBundled('../src/views/log-line-utils.ts');
  const lineKinds = [
    '- [ ] Task title ^task-matrix',
    '- Bullet title ^bullet-matrix',
    '### Heading title ^heading-matrix',
  ];
  const values = new Map([
    ['textValue', 'hello'],
    ['numberValue', '12.5'],
    ['scheduled', '2026-08-12 09:30:00'],
    ['statusValue', 'working'],
    ['approved', 'false'],
    ['recurrence', 'FREQ=WEEKLY;BYDAY=MO'],
    ['snooze', '2026-08-13 10:00:00'],
    ['kind', 'project'],
    ['owner', '[[People/Ada|Ada]]'],
    ['projects', 'Alpha, Beta'],
  ]);

  for (const original of lineKinds) {
    let line = original;
    for (const [key, value] of values) line = setLogInlineFieldValue(line, key, value);
    const fields = readInlineFields(line);
    for (const [key, value] of values) {
      assert.equal(fields[key.toLowerCase()], value, `${original} stores ${key}`);
    }
    assert.match(line, /\^(?:task|bullet|heading)-matrix$/u, 'block identity stays at the end');
    assert.equal(line.trimStart().startsWith(original.trimStart().split(' ^')[0]), true, 'structural prefix and title are preserved');

    for (const key of values.keys()) line = setLogInlineFieldValue(line, key, null);
    assert.deepEqual(readInlineFields(line), {});
    assert.equal(line, original);
  }

  let tagged = '- [ ] Tags #hca [tags:: #urgent] ^tag-matrix';
  tagged = toggleLogLineSemanticTag(tagged, 'tags', 'project', false);
  assert.deepEqual(readInlineFields(tagged).tags, '#hca, #urgent, #project');
  tagged = toggleLogLineSemanticTag(tagged, 'tags', 'hca', true);
  assert.equal(readInlineFields(tagged).tags, '#urgent, #project');
  assert.doesNotMatch(tagged, /#hca\b/u);
  assert.match(tagged, /\^tag-matrix$/u);
});

test('TPS List note editor stores configured numbers as numbers, text as text, and blank as an absent key', async () => {
  const { TpsListView } = await importBundled('../src/tps-list/views/TpsListView.ts', 'tps-field-matrix-list-note');
  const File = globalThis['__tps-field-matrix-list-noteTFile'];
  const file = new File('Projects/Launch.md', 'Projects');
  const configured = [
    { id: 'estimate', key: 'estimate', label: 'Estimate', type: 'number' },
    { id: 'summary', key: 'summary', label: 'Summary', type: 'text' },
  ];
  const view = makeListView(TpsListView, configured);
  const frontmatter = { estimate: 1, summary: 'before' };
  let capturedCommit = null;
  view.app.metadataCache.getFileCache = () => ({ frontmatter });
  view.processFrontmatter = async (_file, mutator) => {
    await mutator(frontmatter);
    return true;
  };
  view.render = () => {};
  view.startListPropertyInput = (_span, _initialValue, commit) => { capturedCommit = commit; };
  const span = { hasClass: () => false };

  view.startListNotePropertyEdit(span, file, 'estimate', frontmatter.estimate);
  await capturedCommit('12.5');
  assert.equal(frontmatter.estimate, 12.5);
  assert.equal(typeof frontmatter.estimate, 'number');
  await assert.rejects(() => capturedCommit('not-a-number'), /valid number/u);
  assert.equal(frontmatter.estimate, 12.5, 'invalid input does not replace the current number');

  view.startListNotePropertyEdit(span, file, 'summary', frontmatter.summary);
  await capturedCommit('after');
  assert.equal(frontmatter.summary, 'after');
  assert.equal(typeof frontmatter.summary, 'string');
  await capturedCommit('');
  assert.equal(Object.hasOwn(frontmatter, 'summary'), false);
});

test('punctuation-bearing configured fields stay authored while exact virtual aliases stay structural', async () => {
  const aliasProperties = [
    { id: 'item-kind-authored', key: 'item-kind', label: 'Item kind authored', type: 'text' },
    { id: 'item-kind-underscore', key: 'item_kind', label: 'Item kind underscore', type: 'text' },
    { id: 'task-status-authored', key: 'task-status', label: 'Task status authored', type: 'selector', options: ['review'] },
    { id: 'heading-level-authored', key: 'heading-level', label: 'Heading level authored', type: 'number' },
  ];
  const source = [
    '- [ ] Alias task [item-kind:: authored-hyphen] [item_kind:: authored-underscore] [task-status:: review] [heading-level:: 5]',
    '### Alias heading [heading-level:: 5]',
  ].join('\n');
  const [
    { TpsTableView },
    { TpsListView },
    { evaluateLogBaseFilterRoots },
    { getTpsBaseGroupValues },
  ] = await Promise.all([
    importBundled('../src/views/log-base-view.ts', 'tps-field-matrix-table-aliases'),
    importBundled('../src/tps-list/views/TpsListView.ts', 'tps-field-matrix-list-aliases'),
    importBundled('../src/views/log-base-filter.ts'),
    importBundled('../src/views/base-value-semantics.ts'),
  ]);

  const TableFile = globalThis['__tps-field-matrix-table-aliasesTFile'];
  const tableFile = new TableFile('Projects/Aliases.md', 'Projects');
  const table = Object.create(TpsTableView.prototype);
  table.plugin = {
    settings: { properties: aliasProperties, linkedSubitemCheckboxMappings: [] },
    sharedServices: {
      status: {
        normalize: (value) => String(value ?? '').trim().toLowerCase(),
        isDoneStatus: () => false,
        getStatusPropertyKey: () => 'status',
      },
    },
    app: {
      vault: { cachedRead: async () => source, getMarkdownFiles: () => [tableFile] },
      metadataCache: {
        getFileCache: () => ({ frontmatter: {}, tags: [], links: [] }),
        getFirstLinkpathDest: () => null,
      },
    },
  };
  table.getEffectiveBaseFilterRoots = async () => [];
  table.getSourceFiles = () => [tableFile];
  table.lineMatches = () => true;
  table.lineMatchesHomeDateContext = () => true;
  table.sortEntries = (entries) => entries;
  const [tableTask, tableHeading] = await table.loadEntries();
  tableTask.queryFields['task.status'] = 'todo';

  assert.equal(table.getEntryValue(tableTask, 'item-kind'), 'authored-hyphen');
  assert.equal(table.getEntryValue(tableTask, 'item_kind'), 'authored-underscore');
  assert.equal(table.getEntryValue(tableTask, 'task-status'), 'review');
  assert.equal(table.getEntryValue(tableHeading, 'heading-level'), '5');
  assert.equal(table.getWritableInlineColumnKey('item-kind'), 'item-kind');
  assert.equal(table.getWritableInlineColumnKey('task-status'), 'task-status');
  assert.equal(table.getWritableInlineColumnKey('heading-level'), 'heading-level');
  assert.equal(table.getWritableInlineColumnKey('task.status'), null);
  assert.equal(table.getWritableInlineColumnKey('heading.level'), null);
  assert.equal(table.getEntryOrderingValue(tableTask, 'item-kind'), 'authored-hyphen');
  assert.equal(table.getEntryOrderingValue(tableTask, 'task-status'), 'review');
  assert.equal(table.getEntryOrderingValue(tableHeading, 'heading-level'), '5');
  assert.equal(table.getEntryOrderingValue(tableTask, 'itemKind'), 'task');
  assert.equal(table.getEntryOrderingValue(tableHeading, 'heading.level'), '3');
  assert.deepEqual(
    getTpsBaseGroupValues(
      table.getEntryOrderingValue(tableTask, 'item-kind'),
      table.getOrderingSemantics('item-kind'),
      'separate',
    ),
    ['authored-hyphen'],
  );

  const taskContext = table.createFilterContext(tableTask.queryFields, tableFile, tableTask.line, 'task', 1);
  assert.equal(evaluateLogBaseFilterRoots(['item-kind == authored-hyphen'], taskContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['item_kind == authored-underscore'], taskContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['item-kind == task'], taskContext), false);
  assert.equal(evaluateLogBaseFilterRoots(['itemKind == task'], taskContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['task-status == review'], taskContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['task-status == todo'], taskContext), false);
  assert.equal(evaluateLogBaseFilterRoots(['task.status == todo'], taskContext), true);
  const headingContext = table.createFilterContext(
    tableHeading.queryFields,
    tableFile,
    tableHeading.line,
    'h3',
    2,
  );
  assert.equal(evaluateLogBaseFilterRoots(['heading-level == 5'], headingContext), true);
  assert.equal(evaluateLogBaseFilterRoots(['heading.level == 3'], headingContext), true);

  const ListFile = globalThis['__tps-field-matrix-list-aliasesTFile'];
  const listFile = new ListFile('Projects/Aliases.md', 'Projects');
  const list = makeListView(TpsListView, aliasProperties);
  list.getMappedStatusForTask = () => 'todo';
  const task = {
    itemKind: 'task',
    line: 1,
    text: source.split('\n')[0],
    displayText: 'Alias task',
    checkboxState: '[ ]',
    inlineFields: [
      { key: 'item-kind', value: 'authored-hyphen' },
      { key: 'item_kind', value: 'authored-underscore' },
      { key: 'task-status', value: 'review' },
      { key: 'heading-level', value: '5' },
    ],
  };
  const heading = {
    itemKind: 'heading',
    headingLevel: 3,
    line: 2,
    text: source.split('\n')[1],
    displayText: 'Alias heading',
    inlineFields: [{ key: 'heading-level', value: '5' }],
  };

  for (const [key, expected] of [
    ['item-kind', 'authored-hyphen'],
    ['item_kind', 'authored-underscore'],
    ['task-status', 'review'],
    ['heading-level', '5'],
  ]) {
    const card = list.getTaskPropertyValue(listFile, task, key, new Set());
    assert.equal(card?.text, expected, `${key} displays its authored value`);
    assert.equal(card?.editable, true, `${key} keeps its configured editor`);
    assert.equal(list.getWritableTaskPropertyName(key), key, `${key} stays writable`);
    assert.equal(list.getTaskSortValue({ file: listFile, task, laneId: 'ungrouped' }, key), expected);
    assert.deepEqual(list.getTaskLaneIds(task, key, listFile), [`key:${expected}`]);
    assert.equal(list.evaluatePositiveTaskFilterString(`${key} == ${expected}`, task, listFile), true);
  }
  assert.equal(list.evaluatePositiveTaskFilterString('item-kind == task', task, listFile), false);
  assert.equal(list.evaluatePositiveTaskFilterString('itemKind == task', task, listFile), true);
  assert.equal(list.evaluatePositiveTaskFilterString('task-status == todo', task, listFile), false);
  assert.equal(list.evaluatePositiveTaskFilterString('task.status == todo', task, listFile), true);
  assert.deepEqual(list.getTaskLaneIds(task, 'itemKind', listFile), ['key:task']);
  assert.equal(list.getTaskSortValue({ file: listFile, task, laneId: 'ungrouped' }, 'itemKind'), 'task');
  assert.equal(list.getWritableTaskPropertyName('task.status'), null);
  assert.equal(list.getWritableTaskPropertyName('heading.level'), null);
  assert.equal(list.getTaskPropertyValue(listFile, heading, 'heading-level', new Set())?.text, '5');
  assert.equal(list.getTaskPropertyValue(listFile, heading, 'heading.level', new Set())?.text, '3');
  assert.deepEqual(list.getTaskLaneIds(heading, 'heading-level', listFile), ['key:5']);
  assert.deepEqual(list.getTaskLaneIds(heading, 'heading.level', listFile), ['key:3']);
  assert.equal(list.getTaskSortValue({ file: listFile, task: heading, laneId: 'ungrouped' }, 'heading-level'), '5');
  assert.equal(list.getTaskSortValue({ file: listFile, task: heading, laneId: 'ungrouped' }, 'heading.level'), 3);
  assert.equal(list.evaluatePositiveTaskFilterString('heading-level == 5', heading, listFile), true);
  assert.equal(list.evaluatePositiveTaskFilterString('heading.level == 3', heading, listFile), true);
});
