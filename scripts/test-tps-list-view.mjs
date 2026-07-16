import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const viewSource = readFileSync(new URL('../src/tps-list/views/TpsListView.ts', import.meta.url), 'utf8');
const bridgeSource = readFileSync(new URL('../src/views/tps-list-bridge-view.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
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
    setTpsListHeadingText('## [[Projects/Launch|Launch plan]]', 'Release plan'),
    '## [[Projects/Launch|Release plan]]',
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

test('TPS List structural bullet mode creates a Markdown bullet instead of a note or checkbox task', async () => {
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
  assert.equal(
    buildKanbanRootTaskLine({ ...common, itemKind: 'bullet' }),
    '- Capture this #inbox [project:: Home]',
  );
  assert.equal(
    buildKanbanRootTaskLine({ ...common, itemKind: 'task' }),
    '- [ ] Capture this #inbox [project:: Home]',
  );
  assert.match(viewSource, /const lineKind = getKanbanRootLineKind\(creationMode\);/);
  assert.match(viewSource, /taskFilter,\s+lineKind,\s+\);/);
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
