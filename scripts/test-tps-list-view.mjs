import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const viewSource = readFileSync(new URL('../src/tps-list/views/TpsListView.ts', import.meta.url), 'utf8');
const bridgeSource = readFileSync(new URL('../src/views/tps-list-bridge-view.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const logBaseSource = readFileSync(new URL('../src/views/log-base-view.ts', import.meta.url), 'utf8');
const logBaseCreateSource = readFileSync(new URL('../src/views/log-base-create.ts', import.meta.url), 'utf8');
const menuBuilderSource = readFileSync(new URL('../src/menu/menu-builder.ts', import.meta.url), 'utf8');
const gcmStyles = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');
const kanbanSource = readFileSync(new URL('../../TPS-Kanban (Dev)/src/views/KanbanView.ts', import.meta.url), 'utf8');
const kanbanMain = readFileSync(new URL('../../TPS-Kanban (Dev)/src/main.ts', import.meta.url), 'utf8');
const kanbanStyles = readFileSync(new URL('../../TPS-Kanban (Dev)/src/styles.css', import.meta.url), 'utf8');

async function loadHierarchy() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/tps-list/tps-list-hierarchy.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadTaskCreationUtils() {
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

async function loadBaseEmbedContext() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/views/base-embed-context.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadFilterKindUtils() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/tps-list/filter-kind-utils.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadBaseFilterRoots() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/tps-list/base-filter-roots.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadHeadingLineUtils() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/tps-list/heading-line-utils.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadOrderedSelection() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/utils/ordered-selection.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadLineItemDeletion() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/utils/line-item-deletion.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadBulletLineSourceTarget() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/tps-list/bullet-line-source-target.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadTpsBaseWriteTargetService() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/tps-base-write-target-service.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-stub',
      setup(context) {
        context.onResolve({ filter: /^obsidian$/ }, () => ({
          path: 'obsidian',
          namespace: 'tps-base-write-target-test',
        }));
        context.onLoad({ filter: /.*/, namespace: 'tps-base-write-target-test' }, () => ({
          contents: `
            class TFile {
              constructor(path) {
                this.path = String(path);
                this.name = this.path.split('/').at(-1) || this.path;
                this.basename = this.name.replace(/\\.[^.]+$/, '');
                this.extension = this.name.includes('.') ? this.name.split('.').at(-1) : '';
              }
            }
            globalThis.__TpsBaseWriteTargetTestFile = TFile;
            module.exports = {
              TFile,
              normalizePath: (value) => String(value).replace(/\\\\/g, '/').replace(/\\/+/g, '/'),
            };
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadLogLineUtils() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/views/log-line-utils.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadBaseRowGrouping() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/views/base-row-grouping.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

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
          namespace: 'tps-list-test',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'tps-list-test' }, () => ({
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

test('GCM is the sole TPS List source and runtime owner', () => {
  assert.match(bridgeSource, /new TpsListView/);
  assert.match(viewSource, /export class TpsListView extends BasesView/);
  assert.match(viewSource, /type = TPS_LIST_VIEW_TYPE/);
  assert.match(viewSource, /extractPersistedFilterRoots/);
  assert.match(viewSource, /composeEffectiveFilterRoots/);
  assert.match(gcmStyles, /\.tps-list-native-row--task/);
  assert.doesNotMatch(bridgeSource, /TPS-Kanban|KanbanView/);
  assert.doesNotMatch(viewSource, /KANBAN_VIEW_TYPE|tps-kanban-board|tps-kanban-view-controls/);
  assert.doesNotMatch(kanbanMain, /TPS_LIST_VIEW_TYPE|createTpsListBasesView/);
  assert.doesNotMatch(kanbanSource, /TPS_LIST_VIEW_TYPE|tps-list-native|renderTpsList|createTpsList/);
  assert.doesNotMatch(kanbanStyles, /\.tps-list/);
});

test('TPS List Shift-click selects every visible row kind in one persistent DOM order', () => {
  assert.match(viewSource, /private selectedRowIds = new Set<string>\(\)/);
  assert.match(viewSource, /private selectionAnchorRowId: string \| null = null/);
  assert.match(viewSource, /private renderedRowOrder: string\[\] = \[\]/);
  assert.match(viewSource, /private selectRowRange\(selectionId: string\): number/);
  assert.match(viewSource, /getOrderedSelectionRange\(this\.renderedRowOrder, this\.selectionAnchorRowId, selectionId\)/);
  assert.match(viewSource, /applyTpsListRowSelection\(event: MouseEvent, target: HTMLElement, preserveIfSelected = false\)/);
  assert.match(viewSource, /if \(event\.shiftKey\) \{[\s\S]{0,300}this\.selectRowRange\(selectionId\)/);
  assert.match(viewSource, /querySelectorAll<HTMLElement>\('\.tps-list-native-row\[data-tps-list-selection-id\]'\)/);
  assert.match(viewSource, /const rowOccurrences = new Map<string, number>\(\)/);
  assert.match(viewSource, /this\.renderedRowOrder = Array\.from\(/);
  assert.match(viewSource, /const selectionId = `\$\{baseId\}#\$\{occurrence\}`/);
  assert.doesNotMatch(viewSource, /this\.renderedRowOrder = \[\.\.\.new Set/);
  assert.match(viewSource, /const selectionId = `note:\$\{displayLaneId\}:\$\{entry\.file\.path\}`/);
  assert.match(viewSource, /const selectionFingerprint = hashSelectionIdentity\(task\.text \|\| taskTitle\)/);
  assert.match(viewSource, /const selectionId = `\$\{isBullet \? 'bullet' : 'task'\}:\$\{displayLane\.id\}:\$\{file\.path\}:\$\{task\.line\}:\$\{selectionFingerprint\}`/);
  assert.match(viewSource, /void this\.applyTpsListRowSelection\(event, row\)/);
  assert.match(viewSource, /registerListRowModifierSelection\(row\)/);
  assert.match(viewSource, /stopImmediatePropagation\(\);\s*void this\.applyTpsListRowSelection\(event, row\)/);
  assert.match(viewSource, /toggleOrderedSelection\(this\.selectedRowIds, selectionId, this\.renderedRowOrder\)/);
  assert.match(viewSource, /mode = this\.toggleRowSelection\(selectionId\) \? 'toggle-off' : 'toggle-on'/);
  assert.match(viewSource, /candidate\.dataset\.tpsListSelectionId === this\.selectionAnchorRowId/);
  assert.match(viewSource, /syncTpsListSelectionRows\(selectedRows, anchorRow, this\.scrollEl\)/);
  assert.match(viewSource, /row\.dataset\.tpsTaskContext = 'true'/);
  assert.match(viewSource, /if \(event\.shiftKey \|\| event\.metaKey \|\| event\.ctrlKey\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*void this\.applyTpsListRowSelection\(event, row\)/);
  assert.match(mainSource, /void listView\?\.applyTpsListRowSelection\?\.\(evt, listRow\)/);
  assert.match(mainSource, /applyTpsListRowSelection[\s\S]{0,300}openBaseNotePreviewFromClick/);
  assert.match(viewSource, /reconcileTpsListSelectionRows\(/);
  assert.match(viewSource, /releaseTpsListSelection\?\.\(this\.scrollEl\)/);
  assert.match(viewSource, /row\.classList\.toggle\('tps-list-native-row--selected', selected\)/);
  assert.match(viewSource, /row\.setAttribute\('aria-selected', selected \? 'true' : 'false'\)/);
  assert.match(viewSource, /const seen = new Set<string>\(\)/);
  assert.doesNotMatch(viewSource, /querySelectorAll<HTMLElement>\('\.tps-kanban-card\[data-path\]'\)/);
  assert.match(gcmStyles, /\.tps-list-native-row--selected\s*\{[\s\S]*color-mix\(in srgb, var\(--interactive-accent\) 10%, transparent\)/);
});

test('ordered selection helper handles ranges and clears a toggled-off anchor', async () => {
  const { getOrderedSelectionRange, toggleOrderedSelection } = await loadOrderedSelection();
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(getOrderedSelectionRange(order, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(getOrderedSelectionRange(order, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(getOrderedSelectionRange(order, null, 'c'), ['c']);
  assert.deepEqual(getOrderedSelectionRange(order, 'missing', 'c'), ['c']);
  const mixedRows = ['note:a#0', 'task:b:4#0', 'bullet:c:8#0', 'note:a#1'];
  assert.deepEqual(
    getOrderedSelectionRange(mixedRows, 'note:a#0', 'note:a#1'),
    mixedRows,
  );
  const toggledOff = toggleOrderedSelection(new Set(['a']), 'a', order);
  assert.deepEqual([...toggledOff.selected], []);
  assert.equal(toggledOff.anchor, null);
  assert.equal(toggledOff.removed, true);
  const remaining = toggleOrderedSelection(new Set(['a', 'c']), 'c', order);
  assert.deepEqual([...remaining.selected], ['a']);
  assert.equal(remaining.anchor, 'a');
  const toggledOn = toggleOrderedSelection(remaining.selected, 'b', order);
  assert.deepEqual([...toggledOn.selected], ['a', 'b']);
  assert.equal(toggledOn.anchor, 'b');
  assert.equal(toggledOn.removed, false);
});

test('line-item deletion either removes a subtree or promotes nested content one level', async () => {
  const {
    deleteLineItemAtIndex,
    extractHeadingSectionBlock,
    extractIndentedLineBlock,
    resolveExactLineRevisionIndex,
    splitLineItemContent,
  } = await loadLineItemDeletion();
  const source = [
    '- [ ] parent',
    '  - child',
    '    continuation',
    '    - grandchild',
    '- sibling',
  ].join('\n');
  const lines = splitLineItemContent(source).lines;
  const block = extractIndentedLineBlock(lines, 0);
  assert.equal(block.nestedContentLineCount, 3);
  assert.equal(block.promotionColumns, 2);
  assert.equal(deleteLineItemAtIndex(source, 0, 'delete-subtree').content, '- sibling');
  assert.equal(
    deleteLineItemAtIndex(source, 0, 'promote-children').content,
    ['- child', '  continuation', '  - grandchild', '- sibling'].join('\n'),
  );
  assert.equal(resolveExactLineRevisionIndex(lines, 0, '- [ ] parent'), 0);
  assert.equal(resolveExactLineRevisionIndex(['same', 'same'], 5, 'same'), -1);

  const crlf = '- parent\r\n  child\r\nnext\r\n';
  assert.equal(deleteLineItemAtIndex(crlf, 0, 'promote-children').content, 'child\r\nnext\r\n');

  const headingSource = [
    '## Section',
    'intro paragraph',
    '### Nested section',
    '- nested bullet',
    '',
    '## Following section',
    'following paragraph',
  ].join('\n');
  const headingLines = splitLineItemContent(headingSource).lines;
  const headingBlock = extractHeadingSectionBlock(headingLines, 0);
  assert.equal(headingBlock.endExclusive, 5);
  assert.equal(headingBlock.nestedContentLineCount, 3);
  assert.equal(headingBlock.promotionColumns, 0);
  assert.equal(
    deleteLineItemAtIndex(headingSource, 0, 'delete-subtree', 'heading-section').content,
    ['## Following section', 'following paragraph'].join('\n'),
  );
  assert.equal(
    deleteLineItemAtIndex(headingSource, 0, 'promote-children', 'heading-section').content,
    ['intro paragraph', '### Nested section', '- nested bullet', '', '## Following section', 'following paragraph'].join('\n'),
  );
  assert.equal(extractHeadingSectionBlock(['### Empty', '## Next'], 0).nestedContentLineCount, 0);
  assert.equal(extractHeadingSectionBlock(['not a heading'], 0).lines.length, 0);
});

test('TPS List resolves the Home-stamped Daily Note before Base and workspace fallbacks', async () => {
  const { resolveBaseEmbedSourcePath } = await loadBaseEmbedContext();
  assert.equal(
    resolveBaseEmbedSourcePath(['2026-07-14.md', 'Daily Note Feed.base', '2026-07-13.md']),
    '2026-07-14.md',
  );
  assert.equal(resolveBaseEmbedSourcePath(['Daily Note Feed.base', '', null]), null);
  assert.match(viewSource, /const stampedContextPath = this\.getStampedBaseContextPath\(\);/);
  assert.match(viewSource, /this\.containerEl\?\.dataset\.tpsContextPath/);
  assert.match(viewSource, /contextHost\?\.dataset\.tpsContextPath/);
});

test('TPS List resolves deterministic Base date expressions before prospective matching', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  view.getBaseContextFile = () => null;
  view.getBaseContextFrontmatterValue = () => null;
  assert.equal(view.resolveBaseContextToken('date("2026-08-12") + "2d"'), '2026-08-14');
});

test('TPS List scans every requested synthesized Markdown row family', async () => {
  const {
    filterTreeIncludesStructuralKind,
    isBareSemanticKindFilter,
    matchesTpsListStructuralKind,
    normalizeTpsListHeadingKind,
  } = await loadFilterKindUtils();
  const filters = { or: ['kind == "task"', 'kind == "bullet"'] };
  assert.equal(filterTreeIncludesStructuralKind(filters, 'task'), true);
  assert.equal(filterTreeIncludesStructuralKind(filters, 'bullet'), true);
  assert.equal(filterTreeIncludesStructuralKind({ or: ['kind == "task"', 'kind == "food"'] }, 'bullet'), false);
  assert.equal(filterTreeIncludesStructuralKind({ or: ['kind == header'] }, 'heading'), true);
  assert.equal(filterTreeIncludesStructuralKind({ or: ['kind == "h3"'] }, 'heading'), true);
  assert.equal(normalizeTpsListHeadingKind('headers'), 'heading');
  assert.equal(normalizeTpsListHeadingKind('h6'), 'h6');
  assert.equal(matchesTpsListStructuralKind('header', 'heading', 2), true);
  assert.equal(matchesTpsListStructuralKind('h2', 'heading', 2), true);
  assert.equal(matchesTpsListStructuralKind('h3', 'heading', 2), false);
  assert.equal(isBareSemanticKindFilter('kind', ['h3']), false);
  assert.equal(isBareSemanticKindFilter('kind', ['project']), true);
  assert.match(viewSource, /if \(!filter\.includeBullets && !filter\.includeHeadings\) return this\.getAllTasksForFile\(file\);/);
  assert.match(viewSource, /filterTreeIncludesStructuralKind\(root, 'heading'\)/);
});

test('TPS List lets effective Base filters own task completion visibility across view switches', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const { extractPersistedFilterRoots } = await loadBaseFilterRoots();
  const view = Object.create(TpsListView.prototype);
  const definition = {
    filters: { and: ['kind == "task"'] },
    views: [
      { type: 'tps-list', name: 'All tasks' },
      { type: 'tps-list', name: 'Working', filters: { and: ['status == "working"'] } },
      { type: 'tps-list', name: 'All tasks again' },
      { type: 'tps-list', name: 'Open', filters: { and: ['open == true'] } },
      { type: 'tps-list', name: 'Closed', filters: { and: ['open == false'] } },
      { type: 'tps-list', name: 'Complete', filters: { and: ['complete == true'] } },
    ],
  };
  const tasks = [
    { itemKind: 'task', line: 1, text: 'Todo', checkboxState: '[ ]', inlineFields: [] },
    { itemKind: 'task', line: 2, text: 'Working', checkboxState: '[\\]', inlineFields: [] },
    { itemKind: 'task', line: 3, text: 'Holding', checkboxState: '[?]', inlineFields: [] },
    { itemKind: 'task', line: 4, text: 'Complete', checkboxState: '[x]', inlineFields: [] },
    { itemKind: 'task', line: 5, text: 'Wont do', checkboxState: '[-]', inlineFields: [] },
  ];
  const statuses = new Map([
    ['[ ]', 'todo'],
    ['[\\]', 'working'],
    ['[?]', 'holding'],
    ['[x]', 'complete'],
    ['[-]', 'wont-do'],
  ]);
  let roots = [];
  view.getBaseFilterRoots = () => roots;
  view.shouldShowCompletedTasks = () => false;
  view.getDoneStatuses = () => new Set(['complete', 'wont-do']);
  view.getStatusForCheckboxState = (checkboxState) => statuses.get(checkboxState) || 'todo';
  view.isEmbeddedScheduledDailyTaskBoard = () => false;
  view.resolveBaseContextToken = (value) => String(value || '').replace(/^(["'])(.*)\1$/u, '$2');

  const select = (viewName) => {
    roots = extractPersistedFilterRoots(definition, viewName, new Set(['tps-list'])).filters ?? [];
    const taskFilter = view.getTaskRootFilterFromBaseFilters();
    return tasks.filter((task) => view.taskMatchesRootFilter(task, taskFilter, null)).map((task) => task.text);
  };

  assert.deepEqual(select('All tasks'), ['Todo', 'Working', 'Holding', 'Complete', 'Wont do']);
  assert.deepEqual(select('Working'), ['Working']);
  assert.deepEqual(select('All tasks again'), ['Todo', 'Working', 'Holding', 'Complete', 'Wont do']);
  assert.deepEqual(select('Open'), ['Todo', 'Working', 'Holding']);
  assert.deepEqual(select('Closed'), ['Complete', 'Wont do']);
  assert.deepEqual(select('Complete'), ['Complete', 'Wont do']);

  roots = [
    { property: 'status', operator: 'is', value: 'working' },
    definition.filters,
  ];
  const runtimeObjectFilter = view.getTaskRootFilterFromBaseFilters();
  assert.deepEqual(
    tasks.filter((task) => view.taskMatchesRootFilter(task, runtimeObjectFilter, null)).map((task) => task.text),
    ['Working'],
  );

  roots = [{ property: 'open', operator: 'is', value: false }, definition.filters];
  const runtimeClosedFilter = view.getTaskRootFilterFromBaseFilters();
  assert.deepEqual(
    tasks.filter((task) => view.taskMatchesRootFilter(task, runtimeClosedFilter, null)).map((task) => task.text),
    ['Complete', 'Wont do'],
  );

  roots = [{ property: 'done', operator: 'is', value: true }, definition.filters];
  const runtimeDoneFilter = view.getTaskRootFilterFromBaseFilters();
  assert.deepEqual(
    tasks.filter((task) => view.taskMatchesRootFilter(task, runtimeDoneFilter, null)).map((task) => task.text),
    ['Complete', 'Wont do'],
  );
});

test('TPS List task tag filters use exact task-tag membership across aliases and Markdown forms', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const taggedFile = {
    path: 'Inbox/Tagged Tasks.md',
    name: 'Tagged Tasks.md',
    basename: 'Tagged Tasks',
    extension: 'md',
    parent: { path: 'Inbox' },
  };
  const untaggedFile = {
    path: 'Inbox/Untagged Source.md',
    name: 'Untagged Source.md',
    basename: 'Untagged Source',
    extension: 'md',
    parent: { path: 'Inbox' },
  };
  const waitingOnlyText = [
    'Raw waiting #waiting',
    'Singular waiting [tag:: #waiting]',
    'Plural waiting [tags:: #waiting]',
    'Late raw waiting [a:: 1] [b:: 2] [c:: 3] [d:: 4] [e:: 5] [f:: 6] [g:: 7] #waiting',
    'Structural kind wins [kind:: note] [tag:: #waiting]',
  ];
  const homeOnlyText = [
    'Raw home #home',
    'Singular home [tag:: #home]',
    'Plural home [tags:: #home]',
  ];
  const sharedText = 'Multi waiting and home [tags:: #waiting, #home]';
  const waitingText = [...waitingOnlyText, sharedText];
  const homeText = [sharedText, ...homeOnlyText];
  const taskText = [
    ...waitingOnlyText,
    sharedText,
    ...homeOnlyText,
    'Longer waiting tag #waiting-room',
    'Longer home tag [tags:: #home-office]',
    'File tag only',
  ];
  const source = [
    ...taskText.map((text) => `- [ ] ${text}`),
    '- Bullet cannot spoof task kind [kind:: task] #waiting',
  ].join('\n');
  const fileFrontmatter = new Map([
    [taggedFile.path, { tags: ['#waiting', '#home'] }],
    [untaggedFile.path, { tags: ['#other'] }],
  ]);
  let roots = [];
  view.app = {
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: fileFrontmatter.get(file.path) ?? {} }),
    },
  };
  view.getBaseFilterRoots = () => roots;
  view.shouldShowCompletedTasks = () => false;
  view.getDoneStatuses = () => new Set(['complete', 'wont-do']);
  view.getStatusForCheckboxState = () => 'todo';
  view.isEmbeddedScheduledDailyTaskBoard = () => false;
  view.resolveBaseContextToken = (value) => String(value || '').replace(/^(["'])(.*)\1$/u, '$2');
  const rows = view.parseOpenTasks(
    source,
    taggedFile.path,
    Number.MAX_SAFE_INTEGER,
    true,
    true,
  ).openTasks;

  const select = (tagFilter, file = taggedFile) => {
    roots = [{ and: ['kind == "task"', tagFilter] }];
    const taskFilter = view.getTaskRootFilterFromBaseFilters();
    return rows
      .filter((task) => view.taskMatchesRootFilter(task, taskFilter, file))
      .map((task) => task.text);
  };
  const aliases = ['tag', 'tags', 'task.tag', 'task.tags'];
  const literalForms = (tag) => [tag, `#${tag}`, `"${tag}"`, `"#${tag}"`];

  for (const alias of aliases) {
    for (const [tag, expected] of [['waiting', waitingText], ['home', homeText]]) {
      for (const literal of literalForms(tag)) {
        const expression = `${alias}.contains(${literal})`;
        assert.deepEqual(select(expression), expected, expression);
      }
      const objectFilter = { property: alias, operator: 'contains', value: tag };
      assert.deepEqual(select(objectFilter), expected, JSON.stringify(objectFilter));

      roots = [{ and: ['kind == "task"', `${alias}.contains(${tag})`] }];
      const defaults = view.getRootTaskCreationDefaults(view.getTaskRootFilterFromBaseFilters());
      assert.deepEqual([...defaults.tags], [`#${tag}`], `${alias} should create a task that satisfies its tag filter`);
    }
  }

  assert.deepEqual(
    select('file.tags.contains(waiting)', taggedFile),
    taskText,
    'file.tags should select tasks by source-note metadata without becoming a task tag',
  );
  assert.deepEqual(
    select('file.tags.contains(waiting)', untaggedFile),
    [],
    'task tags must not satisfy a file.tags filter',
  );
  assert.deepEqual(
    select('file.tags.contains(wait)', taggedFile),
    [],
    'file.tags.contains must use exact tag membership rather than substrings',
  );
});

test('TPS List normalizes configured checkbox status aliases before completion checks', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  view.getGcmCheckboxMappings = () => [
    { checkboxState: '[d]', statuses: ['done'] },
  ];
  view.getGcmServices = () => ({
    status: {
      normalize: (value) => value === 'done' ? 'complete' : String(value || '').toLowerCase(),
      getDoneStatuses: () => ['complete', 'wont-do'],
    },
  });
  assert.equal(view.getStatusForCheckboxState('[d]'), 'complete');
  assert.equal(view.getDoneStatuses().has(view.getStatusForCheckboxState('[d]')), true);
});

test('TPS List ignores a stale filter load that finishes after a newer view', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const pending = [];
  view.app = {
    vault: {
      cachedRead: () => new Promise((resolve) => pending.push(resolve)),
    },
  };
  view.refreshDebounced = () => {};
  view.extractBaseFileFilterRoots = (_parsed, viewName) => ({
    viewName,
    viewNames: ['All tasks', 'Working'],
    filters: [{ and: [`view == "${viewName}"`] }],
  });
  const file = { path: 'Tasks.base', stat: { mtime: 1 } };

  const workingLoad = view.loadBaseFileFilters(file, 1, 'Working');
  const allLoad = view.loadBaseFileFilters(file, 1, 'All tasks');
  pending[1]('{}');
  await allLoad;
  assert.equal(view.baseFileFilterCache.viewName, 'All tasks');
  pending[0]('{}');
  await workingLoad;
  assert.equal(view.baseFileFilterCache.viewName, 'All tasks');
  view.getBaseFile = () => file;
  view.getConfiguredBaseViewName = () => '';
  view.baseFileFilterCache.viewNames = ['All tasks'];
  assert.equal(view.isBaseFileFilterReady(), true);
});

test('TPS List skips ambiguous filters from multiple unidentified embedded Base blocks', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const content = [
    '```base',
    JSON.stringify({
      filters: { and: ['kind == "task"'] },
      views: [{ type: 'tps-list', name: 'First', filters: { and: ['status == "working"'] } }],
    }),
    '```',
    '',
    '```base',
    JSON.stringify({
      filters: { and: ['kind == "task"'] },
      views: [{ type: 'tps-list', name: 'Second', filters: { and: ['status == "complete"'] } }],
    }),
    '```',
  ].join('\n');
  let reads = 0;
  view.app = {
    vault: {
      cachedRead: async () => {
        reads += 1;
        return content;
      },
    },
  };
  view.refreshDebounced = () => {};
  const file = { path: 'Inbox/Embedded host.md', stat: { mtime: 1 } };

  await view.loadEmbeddedBaseFilters(file, 1, '');
  assert.equal(view.embeddedBaseFilterCache.viewName, '');
  assert.deepEqual(view.embeddedBaseFilterCache.viewNames, ['First', 'Second']);
  assert.equal(view.embeddedBaseFilterCache.filters, null);

  view.getBaseContextFile = () => file;
  view.getConfiguredBaseViewName = () => '';
  assert.equal(view.getEmbeddedBaseFilterRoot(), null);
  assert.equal(reads, 1);
});

test('TPS List parses, displays, and safely renames Markdown headings', async () => {
  const { getTpsListHeadingDisplayTitle, parseTpsListHeadingLine, setTpsListHeadingText } = await loadHeadingLineUtils();
  assert.deepEqual(parseTpsListHeadingLine('## what im doing today'), {
    itemKind: 'heading',
    headingLevel: 2,
    text: 'what im doing today',
  });
  assert.deepEqual(parseTpsListHeadingLine('   ### Scoped heading ###'), {
    itemKind: 'heading',
    headingLevel: 3,
    text: 'Scoped heading',
  });
  assert.equal(parseTpsListHeadingLine('####### not a heading'), null);
  assert.equal(parseTpsListHeadingLine('#missing-space'), null);
  assert.equal(getTpsListHeadingDisplayTitle('## [[Projects/Launch|Launch plan]]'), 'Launch plan');
  assert.equal(
    getTpsListHeadingDisplayTitle('### Launch plan #work [priority:: low] <!-- keep --> ^launch'),
    'Launch plan',
  );
  assert.equal(
    setTpsListHeadingText('## [[Projects/Launch|Launch plan]]', 'Release plan'),
    '## [[Projects/Launch|Release plan]]',
  );
  assert.equal(
    setTpsListHeadingText('### Launch plan #work [priority:: low] <!-- keep -->', 'Release plan'),
    '### Release plan #work [priority:: low] <!-- keep -->',
  );
  assert.equal(
    setTpsListHeadingText('### Launch  plan  [priority:: low  value]  #work <!-- keep   spacing --> ^launch', 'Release plan'),
    '### Release plan  [priority:: low  value]  #work <!-- keep   spacing --> ^launch',
  );
  assert.equal(
    setTpsListHeadingText('# #tag [priority:: low]', 'Release'),
    '# Release #tag [priority:: low]',
  );
  assert.equal(
    setTpsListHeadingText('# [priority:: low]', 'Release'),
    '# Release [priority:: low]',
  );
  assert.match(viewSource, /parseTpsListHeadingLine\(line\) \?\? this\.parseLineItem/);
  assert.match(viewSource, /private createListHeadingRow\(/);
  assert.match(viewSource, /row\.dataset\.tpsHeadingKind = headingKind/);
  assert.match(viewSource, /addHeadingAction\(`Title: \$\{getTpsListHeadingDisplayTitle\(rawLine\)/);
  assert.match(viewSource, /this\.promptRenderedLineTitle\('heading', file, lineIndex, rawLine\)/);
  assert.match(viewSource, /addHeadingAction\('Open heading in note', 'file-text'/);
  assert.match(viewSource, /openHeadingLineContextMenu\(event, file, task\.line, row\)/);
  assert.match(viewSource, /addHeadingAction\('Delete heading', 'trash-2'/);
  assert.match(viewSource, /source: 'tps-list-heading-menu'/);
  assert.match(viewSource, /blockKind: 'heading-section'/);
  assert.match(viewSource, /reason: 'tps-list-heading-delete'/);
  assert.match(viewSource, /addToNativeMenu\?\.\(menu, \[file\], \{ includeTitle: false \}\)/);
  assert.match(viewSource, /item\.task\.itemKind === 'heading' \? 'heading' as const : 'task' as const/);
  assert.match(viewSource, /if \(task\.itemKind === 'heading'\) return true;/);
  assert.match(viewSource, /!propRaw\.toLowerCase\(\)\.startsWith\('note\.'\) && \['itemtype', 'itemkind', 'kind'\]\.includes\(normalizedProp\)/);
  assert.match(viewSource, /if \(\/\^note\\\.kind\\b\/i\.test\(expr\)\) return false;/);
  assert.match(viewSource, /if \(propRaw\.toLowerCase\(\) === 'note\.kind'\) return false;/);
  assert.match(gcmStyles, /\.tps-list-native-row--heading/);
});

test('TPS List opens plain bullets in the line editor and composes the normal GCM menu', () => {
  assert.match(viewSource, /if \(isBullet && this\.openBulletLineEditor\(event, file, task\.line\)\) return;/);
  assert.match(viewSource, /if \(!isBullet && this\.openTaskQuickEditor\(event, row, title\)\) return;/);
  assert.match(viewSource, /service\.openLineEditor\(file, Math\.max\(0, oneBasedLine - 1\)\)/);
  assert.match(viewSource, /this\.openBulletLineContextMenu\(event, file, task\.line\)/);
  assert.match(viewSource, /setTitle\(title\)[\s\S]{0,220}setSection\(section\)/);
  assert.match(viewSource, /addLineAction\(`Title: \$\{getPlainDisplayTitle\(visibleLineText\(rawLine\)\)/);
  assert.match(viewSource, /this\.promptRenderedLineTitle\('bullet', file, lineIndex, rawLine\)/);
  assert.match(viewSource, /addLineAction\('Edit full line\.\.\.', 'text-cursor-input'/);
  assert.match(viewSource, /addLineAction\('Open source note', 'external-link'/);
  assert.match(viewSource, /addLineAction\('Open line in note', 'file-text'/);
  assert.match(viewSource, /addLineAction\('Delete line item', 'trash-2'/);
  assert.match(viewSource, /requestLineItemDelete\(\{/);
  assert.match(viewSource, /source: 'tps-list-bullet-menu'/);
  assert.match(viewSource, /deleteLabel: `Delete \$\{targetLabel\}`/);
  assert.match(viewSource, /includeTitle: false/);
  assert.match(viewSource, /menuController\.addToNativeMenu\(menu, \[menuTarget\], \{/);
  assert.match(viewSource, /this\.app\.workspace\.trigger\('file-menu', menu as any, menuTarget as any\)/);
  assert.match(viewSource, /const menuTarget = sourceNote \?\? file/);
  assert.match(viewSource, /if \(sourceNote && sourceNote\.path !== file\.path\)/);
  assert.match(viewSource, /if \(!sourceNote && typeof lineService\?\.createNoteForLine === 'function'\)/);
  assert.match(viewSource, /addLineAction\('Create note for bullet', 'file-plus-2'/);
  assert.match(viewSource, /lineService\.createNoteForLine\(context\)/);
  assert.match(viewSource, /clearRecentContextTarget\?\.\(\)/);
  assert.match(viewSource, /this\.app\.workspace\.trigger\('file-menu', menu as any, menuTarget as any\)/);
  assert.match(viewSource, /\(item as any\)\._isTpsItem = true/);
});

test('TPS List and TPS Table row menus expose built-in tag actions', async () => {
  assert.match(viewSource, /this\.addBulletLineTagsMenu\(menu, file, lineIndex, rawLine\)/);
  assert.match(viewSource, /`Line tags \(\$\{current\.length\}\)` : 'Line tags'/);
  assert.match(viewSource, /setTitle\('Add tag\.\.\.'\)/);
  assert.match(viewSource, /addInlineTagToTaskLine\(line, tag\)/);
  assert.match(logBaseSource, /replace\(\/<!--\\s\*-->\/g, ''\)/);
  assert.match(viewSource, /removeInlineTagFromTaskLine\(line, tag\)/);
  assert.match(viewSource, /resolveExactLineRevisionIndex\(parts\.lines, lineIndex, rawLine\)/);
  assert.match(viewSource, /menuController\?\.addToNativeMenu\?\.\(menu, targets, \{ includeTags: true \}\)/);
  assert.match(menuBuilderSource, /propertyEntries\.length > 0 && options\.includeTags === true/);
  assert.match(menuBuilderSource, /label: 'Tags',[\s\S]{0,100}key: 'tags',[\s\S]{0,100}listItemType: 'tag'/);
  assert.match(logBaseSource, /this\.addEntryTagsMenu\(menu, entry\)/);
  assert.match(logBaseSource, /setTitle\(current\.length > 0 \? `Tags \(\$\{current\.length\}\)` : 'Tags'\)/);
  assert.match(logBaseSource, /addLogLineTag\(readInlineFields\(line\)\.tags, tag\)/);
  assert.match(logBaseSource, /removeLogLineTag\(readInlineFields\(line\)\.tags, tag\)/);
  assert.match(logBaseSource, /setInlineFieldValue\([\s\S]{0,80}'tags'/);
  assert.match(logBaseSource, /column\.normalized !== 'linenumber'[\s\S]{0,120}column\.normalized !== 'tags'/);
  assert.doesNotMatch(logBaseSource, /column\.normalized !== 'tag'/);

  const { addLogLineTag, readLogLineTags, removeLogLineTag } = await loadLogLineUtils();
  assert.deepEqual(readLogLineTags('#Alpha, beta, #alpha'), ['alpha', 'beta']);
  assert.equal(addLogLineTag('#alpha', 'QA/Base'), '#alpha, #qa/base');
  assert.equal(removeLogLineTag('#alpha, #qa/base', '#alpha'), '#qa/base');
  assert.equal(removeLogLineTag('#alpha', 'alpha'), null);
});

test('TPS List and TPS Table group synthesized rows by their containing source note', async () => {
  const {
    getSourceNoteGroupValue,
    getTpsBaseGroupLaneId,
    groupTpsBaseRows,
    isSourceNoteGroupProperty,
    resolveTpsBaseGroupDescriptor,
  } = await loadBaseRowGrouping();
  const alpha = {
    path: 'Projects/Alpha.md',
    name: 'Alpha.md',
    basename: 'Alpha',
    extension: 'md',
    parent: { path: 'Projects' },
  };
  const duplicateAlpha = {
    path: 'Archive/Alpha.md',
    name: 'Alpha.md',
    basename: 'Alpha',
    extension: 'md',
    parent: { path: 'Archive' },
  };
  const beta = {
    path: 'Projects/Beta.md',
    name: 'Beta.md',
    basename: 'Beta',
    extension: 'md',
    parent: { path: 'Projects' },
  };

  assert.deepEqual(resolveTpsBaseGroupDescriptor({ property: 'file.path', direction: 'DESC' }), {
    property: 'file.path',
    direction: 'desc',
  });
  assert.equal(isSourceNoteGroupProperty('file.name'), true);
  assert.equal(isSourceNoteGroupProperty('task.path'), true);
  assert.equal(isSourceNoteGroupProperty('file.tags'), false);
  assert.equal(getSourceNoteGroupValue(alpha, 'file.name'), 'Alpha.md');
  assert.equal(getSourceNoteGroupValue(alpha, 'file.basename'), 'Alpha');
  assert.equal(getSourceNoteGroupValue(alpha, 'file.path'), 'Projects/Alpha.md');
  assert.equal(getSourceNoteGroupValue(alpha, 'task.file.path'), 'Projects/Alpha.md');
  assert.equal(getSourceNoteGroupValue(alpha, 'file.folder'), 'Projects');
  assert.equal(getTpsBaseGroupLaneId('Projects/Alpha.md'), 'key:projects/alpha.md');
  assert.equal(getTpsBaseGroupLaneId('projects/alpha.md'), 'key:projects/alpha.md');
  assert.equal(getTpsBaseGroupLaneId(null), 'ungrouped');

  const rows = [alpha, duplicateAlpha, beta];
  const nameGroups = groupTpsBaseRows(rows, (row) => getSourceNoteGroupValue(row, 'file.name'), 'asc');
  assert.deepEqual(nameGroups.map((group) => [group.key, group.rows.length]), [
    ['Alpha.md', 2],
    ['Beta.md', 1],
  ]);
  const pathGroups = groupTpsBaseRows(rows, (row) => getSourceNoteGroupValue(row, 'file.path'), 'desc');
  assert.deepEqual(pathGroups.map((group) => group.key), [
    'Projects/Beta.md',
    'Projects/Alpha.md',
    'Archive/Alpha.md',
  ]);

  assert.match(viewSource, /if \(isSourceNoteGroupProperty\(raw\)\) return raw/);
  assert.match(viewSource, /this\.getTaskLaneIds\(task, propName, file\)/);
  assert.match(viewSource, /getSourceNoteGroupValue\(file, propId\)/);
  assert.match(viewSource, /return \[getTpsBaseGroupLaneId\(sourceNoteValue\)\]/);
  assert.match(viewSource, /if \(!this\.isWritableTaskGroupingProperty\(propName\)\) return/);
  assert.match(logBaseSource, /resolveTpsBaseGroupDescriptor\(this\.getConfigValue\('groupBy'\)\)/);
  assert.match(logBaseSource, /groupTpsBaseRows\(entries/);
  assert.match(logBaseSource, /tps-log-base-group-row/);
  assert.match(logBaseSource, /scope: 'rowgroup'/);
  assert.match(logBaseSource, /this\.renderedEntryOrder = renderedEntries\.map/);
  assert.doesNotMatch(logBaseSource, /tps-log-base-row tps-log-base-row--group/);
});

test('task-only source-note grouping keeps synthesized tasks reachable by canonical lane ID', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  view.config = {
    get: (key) => key === 'groupBy' ? { property: 'file.path', direction: 'ASC' } : undefined,
  };
  view.applyManualLaneOrder = (groups) => groups;

  const file = {
    path: 'Inbox/QA Task Sink.md',
    name: 'QA Task Sink.md',
    basename: 'QA Task Sink',
    extension: 'md',
    parent: { path: 'Inbox' },
  };
  const task = {
    itemKind: 'task',
    line: 1,
    text: 'QA task',
    checkboxState: '[ ]',
  };
  const duplicateFile = {
    ...file,
    path: 'Archive/QA Task Sink.md',
    parent: { path: 'Archive' },
  };

  assert.equal(view.getGroupByPropName(), 'file.path');
  assert.equal(view.getGroupByPropId('file.path'), 'file.path');
  const taskLaneIds = view.getTaskLaneIds(task, 'file.path', file);
  const tasksByLane = new Map(taskLaneIds.map((laneId) => [
    laneId,
    [{ file, task, laneId, laneLabel: file.path }],
  ]));
  const groups = view.ensureGroupsForTaskLanes([], tasksByLane);
  const visibleTasks = groups.flatMap((group) => tasksByLane.get(view.getLaneId(group)) ?? []);

  assert.deepEqual(taskLaneIds, ['key:inbox/qa task sink.md']);
  assert.deepEqual(groups.map((group) => view.getLaneId(group)), ['key:inbox/qa task sink.md']);
  assert.equal(groups[0].key, 'Inbox/QA Task Sink.md');
  assert.equal(visibleTasks.length, 1);

  const nativeEntries = [file, duplicateFile].map((sourceFile) => ({
    file: sourceFile,
    getValue: () => 'native value that must not own source grouping',
  }));
  const filenameGroups = view.groupEntriesBySourceNote(nativeEntries, 'file.name');
  const pathGroups = view.groupEntriesBySourceNote(nativeEntries, 'file.path');
  assert.deepEqual(filenameGroups.map((group) => [group.key, group.entries.length]), [
    ['QA Task Sink.md', 2],
  ]);
  assert.deepEqual(pathGroups.map((group) => group.key), [
    'Inbox/QA Task Sink.md',
    'Archive/QA Task Sink.md',
  ]);
});

test('bullet source-note resolution prefers explicit record paths and ignores dailyNotePath', async () => {
  const { resolveBulletLineSourceTarget } = await loadBulletLineSourceTarget();
  const line = '- [[_assets/Yogurt|Yogurt]] [type:: foodLog] [foodPath:: _assets/Yogurt.md] [dailyNotePath:: 2026-07-13.md]';
  const result = resolveBulletLineSourceTarget(line, '2026-07-13.md', {
    resolveToPath: (target) => ({
      '_assets/Yogurt.md': '_assets/Yogurt.md',
      '_assets/Yogurt': '_assets/Yogurt.md',
      '2026-07-13.md': '2026-07-13.md',
    })[target] ?? null,
    extractTargets: (text) => Array.from(text.matchAll(/\[\[([^|\]]+)/g), (match) => match[1]),
  });
  assert.deepEqual(result, {
    resolution: { path: '_assets/Yogurt.md', route: 'source-field', sourceKey: 'foodPath' },
    ambiguousVisibleTargets: false,
  });
});

test('bullet source-note resolution honors associations, exercise precedence, and fail-closed links', async () => {
  const { resolveBulletLineSourceTarget } = await loadBulletLineSourceTarget();
  const resolveToPath = (target) => ({
    'Projects/Associated.md': 'Projects/Associated.md',
    '_assets/Bench.md': '_assets/Bench.md',
    '2026-07-14.md': '2026-07-14.md',
    'Projects/One': 'Projects/One.md',
    'Projects/Two': 'Projects/Two.md',
  })[target] ?? null;
  const extractTargets = (text) => Array.from(text.matchAll(/\[\[([^|\]]+)/g), (match) => match[1]);

  const associated = resolveBulletLineSourceTarget(
    '- item [foodPath:: _assets/Bench.md] %% tps-inline-props:{"associatedNotePath":"Projects/Associated.md"} %%',
    '2026-07-14.md',
    { resolveToPath, extractTargets },
  );
  assert.deepEqual(associated.resolution, {
    path: 'Projects/Associated.md',
    route: 'association',
    sourceKey: 'associatedNotePath',
  });

  const exercise = resolveBulletLineSourceTarget(
    '- set [exercisePath:: _assets/Bench.md] [workoutPath:: 2026-07-14.md]',
    '2026-07-14.md',
    { resolveToPath, extractTargets },
  );
  assert.deepEqual(exercise.resolution, {
    path: '_assets/Bench.md',
    route: 'source-field',
    sourceKey: 'exercisePath',
  });

  const ambiguous = resolveBulletLineSourceTarget(
    '- [[Projects/One]] and [[Projects/Two]] [dailyNotePath:: 2026-07-14.md]',
    '2026-07-14.md',
    { resolveToPath, extractTargets },
  );
  assert.equal(ambiguous.resolution, null);
  assert.equal(ambiguous.ambiguousVisibleTargets, true);

  const ownerOnly = resolveBulletLineSourceTarget(
    '- plain line [dailyNotePath:: 2026-07-14.md]',
    '2026-07-14.md',
    { resolveToPath, extractTargets },
  );
  assert.deepEqual(ownerOnly, { resolution: null, ambiguousVisibleTargets: false });
});

test('TPS List structural modes create task, bullet, and heading Markdown', async () => {
  const { buildKanbanRootTaskLine, getKanbanRootLineKind } = await loadTaskCreationUtils();
  const defaults = {
    status: 'todo',
    targetPath: 'Inbox.md',
    inlineFields: new Map([['project', { key: 'project', value: 'Home' }]]),
    tags: new Set(['#inbox']),
    excludedTags: new Set(),
  };
  const common = {
    title: 'Capture this',
    propName: null,
    laneValue: null,
    defaults,
    getCheckboxStateForStatus: () => '[ ]',
  };

  assert.equal(getKanbanRootLineKind('bullets'), 'bullet');
  assert.equal(getKanbanRootLineKind('tasks'), 'task');
  assert.equal(getKanbanRootLineKind('notes'), null);
  assert.equal(getKanbanRootLineKind('heading'), 'heading');
  assert.equal(getKanbanRootLineKind('headers'), 'heading');
  assert.equal(getKanbanRootLineKind('h2'), 'heading');
  assert.equal(
    buildKanbanRootTaskLine({ ...common, itemKind: 'bullet' }),
    '- Capture this #inbox [project:: Home]',
  );
  assert.equal(
    buildKanbanRootTaskLine({ ...common, itemKind: 'task' }),
    '- [ ] Capture this #inbox [project:: Home]',
  );
  assert.equal(
    buildKanbanRootTaskLine({ ...common, itemKind: 'heading', headingLevel: 2 }),
    '## Capture this #inbox [project:: Home]',
  );
  assert.match(viewSource, /const lineKind = linePlan\.kind;/);
  assert.match(viewSource, /taskFilter,\s+lineKind,\s+creationFilterRoots,\s+lineDefaults,\s+\);/);
});

test('shared TPS Base write resolver keeps fallback subordinate to explicit filters', async () => {
  const {
    normalizeTpsBaseWriteFallbackMode,
    normalizeTpsBaseWriteNotePath,
    resolveTpsBaseWriteTarget,
  } = await loadTpsBaseWriteTargetService();
  const TestFile = globalThis.__TpsBaseWriteTargetTestFile;
  const filtered = new TestFile('Inbox/Filtered.md');
  const specific = new TestFile('Inbox/Specific.md');
  const daily = new TestFile('Daily/2026-07-24.md');
  const files = new Map([
    [filtered.path, filtered],
    [specific.path, specific],
  ]);
  let dailyNoteRequests = 0;
  const host = {
    app: {
      vault: {
        getAbstractFileByPath: (path) => files.get(path) ?? null,
      },
    },
    settings: {
      tpsBaseWriteFallbackMode: 'filter-required',
      tpsBaseWriteFallbackPath: '',
    },
    noteOperationService: {
      ensureDailyNote: async (dateValue) => {
        dailyNoteRequests += 1;
        assert.equal(dateValue, '2026-07-24 00:00:00');
        return daily;
      },
    },
  };
  const todayIsoDate = () => '2026-07-24';

  assert.equal(normalizeTpsBaseWriteFallbackMode(undefined), 'filter-required');
  assert.equal(normalizeTpsBaseWriteFallbackMode('unexpected'), 'filter-required');
  assert.equal(normalizeTpsBaseWriteFallbackMode('today-daily-note'), 'today-daily-note');
  assert.equal(normalizeTpsBaseWriteFallbackMode('specific-note'), 'specific-note');
  assert.equal(normalizeTpsBaseWriteNotePath('[[Inbox/Specific|label]]'), 'Inbox/Specific.md');
  assert.equal(normalizeTpsBaseWriteNotePath('[label](Inbox/Specific.md#Section)'), 'Inbox/Specific.md');

  assert.deepEqual(
    await resolveTpsBaseWriteTarget(host, { todayIsoDate }),
    { file: null, source: null, path: null, reason: 'filter-required' },
  );

  host.settings.tpsBaseWriteFallbackMode = 'today-daily-note';
  assert.deepEqual(
    await resolveTpsBaseWriteTarget(host, { todayIsoDate }),
    { file: daily, source: 'today-daily-note', path: daily.path, reason: 'resolved' },
  );
  assert.equal(dailyNoteRequests, 1);

  host.settings.tpsBaseWriteFallbackMode = 'specific-note';
  host.settings.tpsBaseWriteFallbackPath = '[[Inbox/Specific]]';
  assert.deepEqual(
    await resolveTpsBaseWriteTarget(host, { todayIsoDate }),
    { file: specific, source: 'specific-note', path: specific.path, reason: 'resolved' },
  );

  assert.deepEqual(
    await resolveTpsBaseWriteTarget(host, {
      explicitTargetPath: 'Inbox/Filtered.md',
      explicitTargetSpecified: true,
      createExplicitIfMissing: false,
      todayIsoDate,
    }),
    { file: filtered, source: 'filter', path: filtered.path, reason: 'resolved' },
  );
  assert.deepEqual(
    await resolveTpsBaseWriteTarget(host, {
      explicitTargetPath: 'Inbox/Missing.md',
      explicitTargetSpecified: true,
      createExplicitIfMissing: false,
      todayIsoDate,
    }),
    { file: null, source: 'filter', path: 'Inbox/Missing.md', reason: 'filter-target-not-found' },
  );
  assert.deepEqual(
    await resolveTpsBaseWriteTarget(host, {
      explicitTargetPath: null,
      explicitTargetSpecified: true,
      createExplicitIfMissing: false,
      todayIsoDate,
    }),
    { file: null, source: 'filter', path: null, reason: 'invalid-filter-target' },
  );
  assert.equal(dailyNoteRequests, 1, 'no fallback may run after an explicit filter claims the target');

  assert.match(mainSource, /const result = await resolveTpsBaseWriteTarget\(this,[\s\S]*todayIsoDate:/);
  assert.match(viewSource, /gcmPlugin\.resolveTpsBaseWriteFile\(\{\s*explicitTargetPath: defaults\.targetPath,\s*explicitTargetSpecified: defaults\.targetPathSpecified === true,/);
  assert.match(logBaseSource, /this\.plugin\.resolveTpsBaseWriteFile\(\{\s*explicitTargetPath: defaults\.targetPath,\s*explicitTargetSpecified: defaults\.targetPathSpecified,/);
});

test('TPS List active-view target filters retain ownership when resolved or unresolved', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const taskFilter = {
    mode: 'tasks',
    includeDone: true,
    statuses: new Set(),
    tags: new Set(),
    excludeStatuses: new Set(),
    excludeTags: new Set(),
  };
  let roots = [
    { and: ['task.path == "Inbox/Active View.md"'] },
    { and: ['task.path == "Inbox/Whole Base.md"'] },
  ];
  view.getBaseFilterRoots = () => roots;
  view.resolveBaseContextToken = (value) => String(value || '');

  const resolved = view.getRootTaskCreationDefaults(taskFilter);
  assert.equal(resolved.targetPath, 'Inbox/Active View.md');
  assert.equal(resolved.targetPathSpecified, true);

  roots = [
    { and: ['task.path == this.file.path'] },
    { and: ['task.path == "Inbox/Whole Base.md"'] },
  ];
  view.resolveBaseContextToken = (value) => value === 'this.file.path' ? '' : String(value || '');
  const unresolved = view.getRootTaskCreationDefaults(taskFilter);
  assert.equal(unresolved.targetPath, null);
  assert.equal(
    unresolved.targetPathSpecified,
    true,
    'an unresolved explicit active-view filter must block lower-priority Base and settings fallbacks',
  );

  const resolverCalls = [];
  view.getGcmPlugin = () => ({
    resolveTpsBaseWriteFile: async (options) => {
      resolverCalls.push(options);
      return { file: null, source: 'filter', path: null, reason: 'invalid-filter-target' };
    },
  });
  assert.equal(await view.resolveRootTaskTargetFile(resolved), null);
  assert.equal(await view.resolveRootTaskTargetFile(unresolved), null);
  assert.deepEqual(resolverCalls, [
    {
      explicitTargetPath: 'Inbox/Active View.md',
      explicitTargetSpecified: true,
      createExplicitIfMissing: true,
    },
    {
      explicitTargetPath: null,
      explicitTargetSpecified: true,
      createExplicitIfMissing: true,
    },
  ]);
});

test('TPS List only treats canonical file.path and task.path filters as write targets', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const taskFilter = {
    mode: 'tasks',
    includeDone: true,
    statuses: new Set(),
    tags: new Set(),
    excludeStatuses: new Set(),
    excludeTags: new Set(),
  };
  view.resolveBaseContextToken = (value) => String(value || '');

  view.getBaseFilterRoots = () => [{
    and: [
      'kind == "task"',
      'note.path == "Metadata.md"',
      'task.file.path == "Source Alias.md"',
      'path == "line-value"',
    ],
  }];
  const metadataOnly = view.getRootTaskCreationDefaults(taskFilter);
  assert.equal(metadataOnly.targetPath, null);
  assert.equal(metadataOnly.targetPathSpecified, false);

  view.getBaseFilterRoots = () => [{
    and: [
      'kind == "task"',
      'file.path == "Inbox/A.md"',
      'task.path == "Inbox/B.md"',
    ],
  }];
  const conflicting = view.getRootTaskCreationDefaults(taskFilter);
  assert.equal(conflicting.targetPath, null);
  assert.equal(conflicting.targetPathSpecified, true);
});

test('TPS List creation waits for persisted Base filters before resolving settings fallback', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const runtimeRoot = { and: ['kind == "task"'] };
  const persistedRoot = { and: ['task.path == "Inbox/Persisted.md"'] };
  const baseFile = { path: 'Tasks.base', stat: { mtime: 42 } };
  let releaseLoad;
  let persistedRoots = null;
  let resolved = false;

  view.getRuntimeBaseFilterRoots = () => [runtimeRoot];
  view.getStampedBaseFilterRoots = () => null;
  view.getBaseFile = () => baseFile;
  view.getConfiguredBaseViewName = () => 'Tasks';
  view.loadBaseFileFilters = async () => {
    await new Promise((resolve) => {
      releaseLoad = resolve;
    });
    persistedRoots = [persistedRoot];
    return true;
  };
  view.getBaseFileFilterRoot = () => persistedRoots;

  const rootsPromise = view.getBaseFilterRootsForCreation().then((roots) => {
    resolved = true;
    return roots;
  });
  await Promise.resolve();
  assert.equal(resolved, false, 'creation must not race ahead of the persisted-filter read');
  releaseLoad();
  assert.deepEqual(await rootsPromise, [runtimeRoot, persistedRoot]);
  assert.match(viewSource, /creationFilterRoots = await this\.getBaseFilterRootsForCreation\(\)/);
  assert.match(viewSource, /getRootTaskCreationDefaults\(effectiveTaskFilter, effectiveFilterRoots\)/);
});

test('TPS List and TPS Table create Base-filtered headings with an explicit level', async () => {
  const { getKanbanRootLineKind } = await loadTaskCreationUtils();
  assert.equal(getKanbanRootLineKind('heading'), 'heading');
  assert.equal(getKanbanRootLineKind('headings'), 'heading');
  assert.equal(getKanbanRootLineKind('header'), 'heading');
  assert.equal(getKanbanRootLineKind('h6'), 'heading');
  assert.match(viewSource, /const lineKind = linePlan\.kind;\s*if \(lineKind\) \{/);
  assert.match(viewSource, /headingLevel: defaults\.headingLevel/);
  assert.match(viewSource, /if \(task\.itemKind === 'heading'\) return;/);
  assert.match(logBaseCreateSource, /TpsTableLineKind = 'bullet' \| 'task' \| 'heading'/);
  assert.match(logBaseCreateSource, /kind === 'heading' \? `\$\{'#'\.repeat\(headingLevel\)\} `/);
});

test('TPS List keeps nested tasks with their parent while sorting siblings', async () => {
  const { orderTpsListHierarchy } = await loadHierarchy();
  const rows = [
    { kind: 'task', label: 'Zulu', nativeIndex: 0, taskKey: 'a' },
    { kind: 'task', label: 'Zulu child', nativeIndex: 1, taskKey: 'b', parentTaskKey: 'a' },
    { kind: 'task', label: 'Alpha', nativeIndex: 2, taskKey: 'c' },
    { kind: 'task', label: 'Alpha child', nativeIndex: 3, taskKey: 'd', parentTaskKey: 'c' },
  ];
  assert.deepEqual(
    orderTpsListHierarchy(rows, (a, b) => a.label.localeCompare(b.label)).map(({ row, depth }) => [row.label, depth]),
    [['Alpha', 0], ['Alpha child', 1], ['Zulu', 0], ['Zulu child', 1]],
  );
});

test('TPS List safely roots filtered-parent orphans', async () => {
  const { orderTpsListHierarchy } = await loadHierarchy();
  const rows = [{ kind: 'task', label: 'Child', nativeIndex: 0, taskKey: 'child', parentTaskKey: 'missing' }];
  assert.deepEqual(orderTpsListHierarchy(rows, () => 0).map(({ row, depth }) => [row.label, depth]), [['Child', 0]]);
});

test('TPS List measures Markdown indentation consistently', async () => {
  const { getMarkdownIndentColumns } = await loadHierarchy();
  assert.equal(getMarkdownIndentColumns('    - [ ] task'), 4);
  assert.equal(getMarkdownIndentColumns('\t- [ ] task'), 4);
  assert.equal(getMarkdownIndentColumns('  \t- [ ] task'), 4);
});
