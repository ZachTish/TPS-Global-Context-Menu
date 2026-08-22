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
const logLineUtilsSource = readFileSync(new URL('../src/views/log-line-utils.ts', import.meta.url), 'utf8');
const logBaseCreateSource = readFileSync(new URL('../src/views/log-base-create.ts', import.meta.url), 'utf8');
const menuBuilderSource = readFileSync(new URL('../src/menu/menu-builder.ts', import.meta.url), 'utf8');
const gcmStyles = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');
const kanbanSource = readFileSync(new URL('../../TPS-Kanban (Dev)/src/views/KanbanView.ts', import.meta.url), 'utf8');
const kanbanMain = readFileSync(new URL('../../TPS-Kanban (Dev)/src/main.ts', import.meta.url), 'utf8');
const kanbanStyles = readFileSync(new URL('../../TPS-Kanban (Dev)/src/styles.css', import.meta.url), 'utf8');

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

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

async function loadTaskDropUtils() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/tps-list/task-drop-utils.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
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
            globalThis.__TpsListFormulaTestFile = Dummy;
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

async function loadFormulaService() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/tps-base-formula-service.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('GCM is the sole TPS List source and runtime owner', () => {
  assert.match(
    viewSource,
    /row\.dataset\.taskLineIdentity = getTaskLineIdentity\(task\.rawLine\)/,
    'rendered TPS List task rows must carry their exact source-line fingerprint',
  );
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

test('TPS List host bridge exposes live GCM mappings without confusing them with List defaults', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const mappings = [{ checkboxState: '[!]', statuses: ['urgent'] }];
  const gcmPlugin = {
    settings: { linkedSubitemCheckboxMappings: mappings, properties: [{ id: 'priority', key: 'priority' }] },
    sharedServices: { status: { normalize: (value) => String(value || '').trim().toLowerCase() } },
  };
  view.plugin = {
    gcmPlugin,
    listSettings: { defaultView: 'cards', defaultRootTaskPath: 'Inbox/Tasks.md' },
    settings: { linkedSubitemCheckboxMappings: [{ checkboxState: '[x]', statuses: ['wrong-owner'] }] },
  };
  assert.equal(view.getGcmPlugin(), gcmPlugin);
  assert.equal(view.getGcmSettings(), gcmPlugin.settings);
  assert.equal(view.getListSettings().defaultView, 'cards');
  assert.deepEqual(view.getGcmCheckboxMappings().map(({ checkboxState, statuses }) => ({ checkboxState, statuses })), mappings);
  assert.match(bridgeSource, /gcmPlugin:\s*plugin/u);
  assert.match(bridgeSource, /listSettings:\s*DEFAULT_SETTINGS/u);
  assert.doesNotMatch(bridgeSource, /settings:\s*DEFAULT_SETTINGS/u);
});

test('TPS List aligns note, task, bullet, and heading rows through one semantic leading slot', () => {
  const listRenderer = sourceBlock(
    viewSource,
    'private renderList(',
    'private formatListGroupLabel(',
  );
  const noteRenderer = sourceBlock(
    viewSource,
    'private createListNoteRow(',
    'private openListNoteContextMenu(',
  );
  const headingRenderer = sourceBlock(
    viewSource,
    'private createListHeadingRow(',
    'private createListTaskRow(',
  );
  const taskRenderer = sourceBlock(
    viewSource,
    'private createListTaskRow(',
    'private renderListTaskBooleanProperty(',
  );

  assert.match(listRenderer, /createEl\('ul',[\s\S]*?cls: 'tps-list-native-rows',[\s\S]*?attr: \{ role: 'list' \}/u);
  for (const renderer of [noteRenderer, headingRenderer, taskRenderer]) {
    assert.match(renderer, /createEl\('li'/u);
    assert.match(renderer, /tps-list-native-row-body/u);
  }
  assert.match(noteRenderer, /tps-list-native-leading tps-list-native-file-marker/u);
  assert.match(headingRenderer, /tps-list-native-leading tps-list-native-heading-marker/u);
  assert.match(taskRenderer, /tps-list-native-leading tps-list-native-bullet-marker/u);
  assert.match(taskRenderer, /tps-list-native-leading tps-list-native-checkbox/u);
  assert.match(taskRenderer, /--tps-list-task-indent', `\$\{depth \* 22\}px`/u);

  assert.match(
    gcmStyles,
    /\.tps-list-native-rows\s*\{[\s\S]*?list-style:\s*none;[\s\S]*?margin:\s*0;[\s\S]*?padding:\s*0;/u,
  );
  assert.match(
    gcmStyles,
    /\.tps-list-native-row\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*var\(--checkbox-size, 18px\) minmax\(0, 1fr\);[\s\S]*?margin:\s*0;[\s\S]*?padding:\s*0;/u,
  );
  assert.match(gcmStyles, /\.tps-list-native-leading\s*\{[\s\S]*?width:\s*var\(--checkbox-size, 18px\);[\s\S]*?min-width:\s*var\(--checkbox-size, 18px\);[\s\S]*?margin:\s*0;/u);
  assert.match(gcmStyles, /\.tps-list-native-checkbox\s*\{[\s\S]*?border-radius:\s*var\(--checkbox-radius, 4px\);[\s\S]*?box-shadow:\s*none;/u);
  assert.match(gcmStyles, /\.tps-list-native-row-body\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?display:\s*flex;/u);
  assert.match(gcmStyles, /\.tps-list-native-row--task\s*\{[\s\S]*?padding-inline-start:\s*var\(--tps-list-task-indent, 0px\);/u);
  assert.doesNotMatch(gcmStyles, /\.tps-list-native-row--note\s*\{[^}]*?(?:margin-left|padding-left|text-indent)\s*:/u);
  assert.doesNotMatch(gcmStyles, /\.tps-list-native-(?:row|leading|file-marker)[^}]*margin-left:\s*-/u);
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
  assert.match(viewSource, /const selectionId = `note:\$\{displayLaneId\}:\$\{displayFile\.path\}`/);
  assert.match(viewSource, /const selectionFingerprint = hashSelectionIdentity\(task\.text \|\| taskTitle\)/);
  assert.match(viewSource, /const selectionId = `\$\{isBullet \? 'bullet' : 'task'\}:\$\{displayLane\.id\}:\$\{file\.path\}:\$\{task\.line\}:\$\{selectionFingerprint\}`/);
  assert.match(viewSource, /void this\.applyTpsListRowSelection\(event, row\)/);
  assert.match(viewSource, /registerListRowModifierSelection\(row\)/);
  assert.match(viewSource, /stopImmediatePropagation\(\);\s*void this\.applyTpsListRowSelection\(event, row\)/);
  assert.match(viewSource, /toggleOrderedSelection\(this\.selectedRowIds, selectionId, this\.renderedRowOrder\)/);
  assert.match(viewSource, /mode = this\.toggleRowSelection\(selectionId\) \? 'toggle-off' : 'toggle-on'/);
  assert.match(viewSource, /candidate\.dataset\.tpsListSelectionId === this\.selectionAnchorRowId/);
  assert.match(viewSource, /syncTpsListSelectionRows\(selectedRows, anchorRow, this\.scrollEl\)/);
  assert.match(viewSource, /contextmenu[\s\S]{0,350}await this\.applyTpsListRowSelection\(event, row, true\)[\s\S]{0,220}openTaskLineContextMenu/u);
  assert.match(viewSource, /row\.dataset\.tpsTaskContext = 'true'/);
  assert.match(viewSource, /if \(event\.shiftKey \|\| event\.metaKey \|\| event\.ctrlKey\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*void this\.applyTpsListRowSelection\(event, row\)/);
  assert.match(mainSource, /void listView\?\.applyTpsListRowSelection\?\.\(evt, listRow\)/);
  assert.match(mainSource, /applyTpsListRowSelection[\s\S]{0,300}openBaseNotePreviewFromClick/);
  assert.match(viewSource, /reconcileTpsListSelectionRows\(/);
  assert.doesNotMatch(
    viewSource,
    /\(selectionPruned \|\| anchorPruned\) && typeof taskSelectionService\?\.reconcileTpsListSelectionRows/,
    'every rerender must refresh canonical selected task coordinates, even when local selection IDs remain visible',
  );
  assert.match(viewSource, /releaseTpsListSelection\?\.\(this\.scrollEl\)/);
  assert.match(viewSource, /row\.classList\.toggle\('tps-list-native-row--selected', selected\)/);
  assert.match(viewSource, /row\.setAttribute\('aria-selected', selected \? 'true' : 'false'\)/);
  assert.match(viewSource, /const seen = new Set<string>\(\)/);
  assert.match(viewSource, /menuController\?\.addToExactFileMenu\?\.\(menu, targets, \{[\s\S]{0,100}includeTags: true,[\s\S]{0,100}includeSingleTargetActions: targets\.length === 1/);
  assert.doesNotMatch(viewSource, /querySelectorAll<HTMLElement>\('\.tps-kanban-card\[data-path\]'\)/);
  assert.match(gcmStyles, /\.tps-list-native-row--selected\s*\{[\s\S]*color-mix\(in srgb, var\(--interactive-accent\) 10%, transparent\)/);
});

test('TPS List canonicalizes companion Base rows to one logical source without losing property values', async () => {
  const semanticReconciliation = sourceBlock(
    viewSource,
    'private reconcileNativeNoteEntries(',
    'private getNoteSemanticReconciliationKey(',
  );
  assert.match(
    semanticReconciliation,
    /for \(const file of this\.app\.vault\.getMarkdownFiles\(\)\) \{\s*if \(this\.getGcmPlugin\(\)\?\.filePropertiesService\?\.isCompanionFile\?\.\(file\)\) continue;/u,
    'semantic note recovery must not synthesize a managed or moved companion back into the logical rows',
  );
  const { TpsListView } = await loadTpsListViewHarness();
  const File = globalThis.__TpsListFormulaTestFile;
  const createFile = (path, extension) => {
    const file = new File();
    const name = path.split('/').at(-1);
    Object.assign(file, {
      path,
      name,
      basename: name.slice(0, -(extension.length + 1)),
      extension,
      parent: { path: path.split('/').slice(0, -1).join('/') },
    });
    return file;
  };
  const source = createFile('Assets/A report.pdf', 'pdf');
  const unrelated = createFile('Assets/Z already sorted.png', 'png');
  const companion = createFile('_assets/TPS File Properties/_by-id/file_report.md', 'md');
  const orphan = createFile('_assets/TPS File Properties/Assets/Missing.pdf.md', 'md');
  const sourceEntry = {
    file: source,
    getValue: (property) => property === 'status' ? null : `source:${String(property)}`,
  };
  const companionEntry = {
    file: companion,
    getValue: (property) => property === 'status' ? 'review' : `companion:${String(property)}`,
  };
  const unrelatedEntry = { file: unrelated, getValue: (property) => `unrelated:${String(property)}` };
  const orphanEntry = { file: orphan, getValue: () => 'orphan' };
  const view = Object.create(TpsListView.prototype);
  view.plugin = {
    settings: {},
    filePropertiesService: {
      isCompanionFile: (file) => file === companion || file === orphan,
      getSourceFileForCompanion: (file) => file === companion ? source : null,
    },
  };

  const canonical = view.canonicalizeFilePropertyEntries([sourceEntry, unrelatedEntry, companionEntry, orphanEntry]);
  assert.equal(canonical.changed, true);
  assert.equal(canonical.entries.length, 2, 'the companion replaces the duplicate source row and an orphan fails closed');
  assert.equal(canonical.entries[0].file, unrelated, 'the companion keeps its native sorted position');
  assert.equal(canonical.entries[1].file, source);
  assert.equal(canonical.entries[1].getValue('status'), 'review', 'property values remain owned by the companion row');
  assert.equal(canonical.entries[1].getValue('file.path'), source.path);
  assert.equal(canonical.entries[1].getValue('file.name'), source.name);
  assert.equal(canonical.entries[1].getValue('file.folder'), 'Assets');
  assert.equal(canonical.entries[1].getValue('file.ext'), 'pdf');
  view.config = { sort: [{ property: 'file.path', direction: 'asc' }] };
  assert.deepEqual(
    view.sortEntriesForView(canonical.entries).map((entry) => entry.file.path),
    [source.path, unrelated.path],
    'configured file sorting is reapplied to logical source semantics after native companion canonicalization',
  );

  let mutationTarget = null;
  view.plugin.frontmatterMutationService = {
    process: async (file) => {
      mutationTarget = file;
      return true;
    },
  };
  await view.processFrontmatter(companion, () => {});
  assert.equal(mutationTarget, source, 'property edits target the logical source and delegate back to the companion store');
  await assert.rejects(() => view.processFrontmatter(orphan, () => {}), /orphaned or ambiguous/u);
});

test('TPS List view settings own unmatched placement and task grouping reads visible task tags', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const config = new Map([
    ['groupBy', { property: 'tags', direction: 'ASC' }],
    ['ungroupedPosition', 'first'],
  ]);
  view.config = { get: (key) => config.get(key) };
  view.plugin = { settings: { ungroupedPosition: 'last' } };

  const task = {
    itemKind: 'task',
    line: 1,
    text: 'Ship the fix #hca [tags:: project, #urgent]',
    checkboxState: '[ ]',
    inlineFields: [{ key: 'tags', value: 'project, #urgent' }],
  };

  assert.deepEqual(view.getTaskLaneIds(task, 'tags'), [
    'key:#hca',
    'key:#project',
    'key:#urgent',
  ]);
  assert.equal(view.getUngroupedPosition(), 'first');

  const group = (key) => ({ key, entries: [], hasKey: () => key != null });
  view.getLaneOrderViewId = () => 'Base::View';
  view.getLegacyUnknownBaseViewId = () => 'unknown::View';
  view.plugin.settings.laneOrderByView = {
    'Base::View': ['key:hca', 'ungrouped', 'key:idea'],
  };
  const groups = [group('idea'), group(null), group('hca')];
  assert.deepEqual(
    view.applyManualLaneOrder(groups).map((entry) => entry.key),
    [null, 'hca', 'idea'],
    'Top must override a stale manual rank for the ungrouped lane',
  );

  config.set('ungroupedPosition', 'last');
  assert.deepEqual(
    view.applyManualLaneOrder(groups).map((entry) => entry.key),
    ['hca', 'idea', null],
    'Bottom must override a stale manual rank for the ungrouped lane',
  );
  config.delete('ungroupedPosition');
  assert.equal(view.getUngroupedPosition(), 'last');
  assert.match(bridgeSource, /key: 'ungroupedPosition'[\s\S]{0,220}first: 'Top'[\s\S]{0,80}last: 'Bottom'/u);
});

test('TPS List applies the same cross-family stable path and line ordering as TPS Table', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const File = globalThis.__TpsListFormulaTestFile;
  const makeFile = (path) => {
    const file = new File();
    const name = path.split('/').at(-1);
    Object.assign(file, {
      path,
      name,
      basename: name.replace(/\.md$/u, ''),
      extension: 'md',
      parent: { path: path.split('/').slice(0, -1).join('/') },
    });
    return file;
  };
  const taskFile = makeFile('Inbox/QA/Open Tasks.md');
  const projectFile = makeFile('Inbox/QA/Project Note.md');
  const view = Object.create(TpsListView.prototype);
  view.config = {};
  view.plugin = { settings: {} };
  const noteItems = [{
    entry: { file: projectFile, getValue: () => null },
    depth: 0,
    hasChildren: false,
    childCount: 0,
    children: [],
  }];
  const taskItems = [
    { file: taskFile, task: { line: 8, itemKind: 'task', rawLine: '- [/] Working' }, laneId: 'ungrouped' },
    { file: taskFile, task: { line: 7, itemKind: 'task', rawLine: '- [ ] Todo' }, laneId: 'ungrouped' },
  ];

  assert.deepEqual(
    view.getSortedListRows(noteItems, taskItems).map(({ row }) => row.kind === 'note'
      ? `note:${row.item.entry.file.path}`
      : `task:${row.item.file.path}:${row.item.task.line}`),
    [
      'task:Inbox/QA/Open Tasks.md:7',
      'task:Inbox/QA/Open Tasks.md:8',
      'note:Inbox/QA/Project Note.md',
    ],
  );
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
  assert.equal(
    resolveExactLineRevisionIndex(['same', 'same'], 0, 'same'),
    -1,
    'a duplicate at the preferred coordinate must not impersonate the captured revision',
  );
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

test('TPS List configured property editors resolve only an exact, unambiguous rendered revision', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const file = { path: 'Inbox/Property editor revision.md' };
  const original = '- [ ] Ship safely <!-- tps-inline-props: {"externalId":"original"} -->';
  const replacedComment = '- [ ] Ship safely <!-- tps-inline-props: {"externalId":"replacement"} -->';
  const task = {
    itemKind: 'task',
    line: 2,
    text: 'Ship safely',
    rawLine: original,
  };
  let content = ['# Tasks', 'Inserted paragraph', 'Intervening text', original].join('\n');
  view.app = { vault: { cachedRead: async () => content } };

  assert.equal(
    await view.resolveRenderedTaskLine(file, task, 'test-property-editor'),
    original,
    'a source revision shifted by an insertion may relocate when its exact line is unique',
  );

  content = ['# Tasks', replacedComment].join('\n');
  assert.equal(
    await view.resolveRenderedTaskLine(file, task, 'test-property-editor'),
    '',
    'a hidden-comment replacement with the same visible title is a stale revision',
  );

  content = ['# Tasks', replacedComment, original, original].join('\n');
  assert.equal(
    await view.resolveRenderedTaskLine(file, task, 'test-property-editor'),
    '',
    'duplicate exact revisions away from the rendered position are ambiguous',
  );

  assert.match(
    sourceBlock(
      viewSource,
      'private async resolveRenderedTaskLine(',
      'private async mutateRenderedTaskLine(',
    ),
    /const expectedLine = String\(task\.rawLine \?\? ''\)[\s\S]*resolveExactLineRevisionIndex\(parts\.lines, targetLine - 1, expectedLine\)/u,
  );
});

test('TPS List heading and bullet entry points relocate only a unique rendered revision', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const file = { path: 'Inbox/List entry revision.md' };
  const renderedLine = '- Bullet [owner:: Ada]';
  let content = ['# List', 'Inserted', renderedLine].join('\n');
  view.app = { vault: { cachedRead: async () => content } };

  assert.deepEqual(
    await view.resolveRenderedLineRevision(file, 2, renderedLine, 'BulletLineOpen', 'line item'),
    { lineIndex: 2, rawLine: renderedLine },
    'a unique captured revision may relocate after an insertion',
  );

  content = ['# List', 'Inserted', '- Bullet [owner:: Grace]'].join('\n');
  assert.equal(
    await view.resolveRenderedLineRevision(file, 2, renderedLine, 'BulletLineOpen', 'line item'),
    null,
    'a different line at the old coordinate must not impersonate the rendered bullet',
  );

  content = [renderedLine, '# List', renderedLine].join('\n');
  assert.equal(
    await view.resolveRenderedLineRevision(file, 2, renderedLine, 'HeadingLineOpen', 'heading'),
    null,
    'duplicate exact revisions are ambiguous and must fail closed',
  );

  assert.equal(
    await view.resolveRenderedLineRevision(file, 2, '', 'HeadingLineOpen', 'heading'),
    null,
    'entry points without a captured revision must fail closed',
  );
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
    { itemKind: 'task', line: 6, text: 'Custom unmapped', checkboxState: '[!]', inlineFields: [] },
    { itemKind: 'task', line: 7, text: 'Missing marker', checkboxState: undefined, inlineFields: [] },
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
  view.getAuthoritativeDoneStatuses = () => new Set(['complete', 'wont-do']);
  view.getStatusForCheckboxState = (checkboxState) => statuses.get(checkboxState) || '';
  view.isEmbeddedScheduledDailyTaskBoard = () => false;
  view.resolveBaseContextToken = (value) => String(value || '').replace(/^(["'])(.*)\1$/u, '$2');

  const select = (viewName) => {
    roots = extractPersistedFilterRoots(definition, viewName, new Set(['tps-list'])).filters ?? [];
    const taskFilter = view.getTaskRootFilterFromBaseFilters();
    return tasks.filter((task) => view.taskMatchesRootFilter(task, taskFilter, null)).map((task) => task.text);
  };

  assert.deepEqual(select('All tasks'), ['Todo', 'Working', 'Holding', 'Complete', 'Wont do', 'Custom unmapped', 'Missing marker']);
  assert.deepEqual(select('Working'), ['Working']);
  assert.deepEqual(select('All tasks again'), ['Todo', 'Working', 'Holding', 'Complete', 'Wont do', 'Custom unmapped', 'Missing marker']);
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

test('TPS List task drops reject unmapped statuses before confirmation and write one captured plan atomically', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const file = { path: 'Inbox/Tasks.md' };
  let content = '- [ ] Task';
  let processCalls = 0;
  let confirmationCalls = 0;

  view.app = {
    vault: {
      async process(receivedFile, updater) {
        assert.equal(receivedFile, file);
        processCalls += 1;
        content = updater(content);
      },
    },
    workspace: { trigger() {} },
  };
  view.parseLineItem = () => ({ itemKind: 'task' });
  view.clearTaskCachesForPath = () => {};
  view.confirmTaskDrop = async () => {
    confirmationCalls += 1;
    return true;
  };
  view.buildTaskDropPlan = async () => ({
    changes: ['Task: Inbox/Tasks.md:1'],
    filterTags: [],
    filterStatus: null,
    mappingError: 'No valid mapping.',
    currentLine: '- [ ] Task',
    nextLine: '- [ ] Task',
    itemKind: 'task',
  });

  assert.equal(await view.confirmAndApplyInlineTaskDrop(file, 1, 'status', 'working'), false);
  assert.equal(confirmationCalls, 0);
  assert.equal(processCalls, 0);
  assert.equal(content, '- [ ] Task');

  view.buildTaskDropPlan = async () => ({
    changes: ['Task: Inbox/Tasks.md:1', 'Set checkbox state to [/].'],
    filterTags: [],
    filterStatus: null,
    mappingError: null,
    currentLine: '- [ ] Task',
    nextLine: '- [/] Task',
    itemKind: 'task',
  });

  assert.equal(await view.confirmAndApplyInlineTaskDrop(file, 1, 'status', 'working'), true);
  assert.equal(confirmationCalls, 1);
  assert.equal(processCalls, 1);
  assert.equal(content, '- [/] Task');

  content = '- [?] Concurrent edit';
  assert.equal(await view.confirmAndApplyInlineTaskDrop(file, 1, 'status', 'working'), false);
  assert.equal(confirmationCalls, 2);
  assert.equal(processCalls, 2);
  assert.equal(content, '- [?] Concurrent edit');
});

test('TPS List pointer drops re-resolve the exact source revision and fail closed when it is ambiguous', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const file = { path: 'Inbox/Tasks.md' };
  const sourceLine = '- [ ] Move me [project:: Alpha]';
  let content = `# inserted before drop\n${sourceLine}\n- [ ] Neighbor`;
  let confirmationCalls = 0;
  let processCalls = 0;

  view.app = {
    vault: {
      async cachedRead(receivedFile) {
        assert.equal(receivedFile, file);
        return content;
      },
      async process(receivedFile, updater) {
        assert.equal(receivedFile, file);
        processCalls += 1;
        content = updater(content);
      },
    },
    workspace: { trigger() {} },
  };
  view.getTaskRootFilterFromBaseFilters = () => ({
    tags: new Set(),
    excludeTags: new Set(),
    statuses: new Set(),
  });
  view.isStatusPropertyName = () => false;
  view.normalizeInlinePropertyKey = (value) => String(value || '').trim().toLowerCase();
  view.getWorkflowStatusFieldKeysToClear = () => [];
  view.clearTaskCachesForPath = () => {};
  view.confirmTaskDrop = async () => {
    confirmationCalls += 1;
    return true;
  };

  assert.equal(
    await view.confirmAndApplyInlineTaskDrop(file, 1, 'project', 'Beta', [], sourceLine),
    true,
    'an insertion before drop must not redirect the write to the new numeric line',
  );
  assert.equal(content, '# inserted before drop\n- [ ] Move me [project:: Beta]\n- [ ] Neighbor');
  assert.equal(confirmationCalls, 1);
  assert.equal(processCalls, 1);

  content = `${sourceLine}\n- [ ] Neighbor`;
  view.confirmTaskDrop = async () => {
    confirmationCalls += 1;
    content = `# inserted during confirmation\n${content}`;
    return true;
  };
  assert.equal(
    await view.confirmAndApplyInlineTaskDrop(file, 1, 'project', 'Gamma', [], sourceLine),
    true,
    'the captured plan must re-resolve the same revision again during the atomic write',
  );
  assert.equal(content, '# inserted during confirmation\n- [ ] Move me [project:: Gamma]\n- [ ] Neighbor');
  assert.equal(confirmationCalls, 2);
  assert.equal(processCalls, 2);

  content = `# inserted before ambiguous duplicates\n${sourceLine}\n${sourceLine}`;
  const ambiguousContent = content;
  assert.equal(
    await view.confirmAndApplyInlineTaskDrop(file, 1, 'project', 'Wrong target', [], sourceLine),
    false,
    'two shifted exact matches cannot establish one mutation identity',
  );
  assert.equal(content, ambiguousContent);
  assert.equal(confirmationCalls, 2, 'an ambiguous source must be blocked before confirmation');
  assert.equal(processCalls, 2, 'an ambiguous source must be blocked before vault.process');
});

test('TPS List status drops remove only checkbox-owned inline status fields', async () => {
  const {
    buildKanbanTaskDropLine,
    parseKanbanLineItem,
    removeKanbanInlineTaskProperties,
    updateKanbanInlineTaskPropertyText,
  } = await loadTaskDropUtils();
  const isStatusPropertyName = (name) => String(name || '').toLowerCase() === 'status';
  assert.equal(
    buildKanbanTaskDropLine({
      line: '- [ ] Task [status:: todo] [checkboxStatus:: todo] [relationStatus:: [[Statuses/Todo]]]',
      propName: 'status',
      value: 'working',
      statusCheckboxState: '[/]',
      statusFieldKeysToRemove: ['status', 'checkboxStatus'],
      isStatusPropertyName,
    }),
    '- [/] Task [relationStatus:: [[Statuses/Todo]]]',
  );
  assert.equal(
    buildKanbanTaskDropLine({
      line: '- [ ] Task [status:: [[Statuses/Todo]]] [checkboxStatus:: todo]',
      propName: 'status',
      value: 'working',
      statusCheckboxState: '[/]',
      statusFieldKeysToRemove: ['checkboxStatus'],
      isStatusPropertyName,
    }),
    '- [/] Task [status:: [[Statuses/Todo]]]',
  );
  assert.equal(
    removeKanbanInlineTaskProperties(
      '- [ ] Task `[task.status:: todo]` [task.status:: [[Statuses/Todo]]] [Relation Status:: [[Statuses/Todo]]]',
      ['task.status', 'checkboxStatus'],
    ),
    '- [ ] Task `[task.status:: todo]` [Relation Status:: [[Statuses/Todo]]]',
    'closed code spans and relational fields survive while one nested workflow field is removed intact',
  );
  assert.equal(parseKanbanLineItem('- [xx] Malformed checkbox-shaped line', true), null);
  assert.equal(
    buildKanbanTaskDropLine({
      line: '- [xx] Malformed checkbox-shaped line',
      propName: 'status',
      value: 'working',
      statusCheckboxState: '[/]',
      statusFieldKeysToRemove: ['status'],
      isStatusPropertyName,
    }),
    '- [xx] Malformed checkbox-shaped line',
    'unsupported checkbox-shaped lines fail closed instead of becoming tasks or bullets',
  );
  assert.equal(
    updateKanbanInlineTaskPropertyText(
      '- [ ] Task [projects:: Alpha] [projects:: Beta]',
      'projects',
      'Gamma',
      ['Beta'],
      { id: 'projects', label: 'Projects', key: 'projects', type: 'list', listItemType: 'text' },
    ),
    '- [ ] Task [projects:: Alpha, Gamma]',
    'dragging from a repeated list carrier removes the actual source lane and preserves every sibling value',
  );
  assert.equal(
    updateKanbanInlineTaskPropertyText(
      '- [ ] Task [owner:: [[People/Ada|Ada]]] [project:: Alpha] [owner:: [[People/Bob|Bob]]]',
      'owner',
      '[[People/Carol|Carol]]',
      ['[[People/Bob|Bob]]'],
      { id: 'owner', label: 'Owner', key: 'owner', type: 'list', listItemType: 'link' },
    ),
    '- [ ] Task [project:: Alpha] [owner:: [[People/Ada|Ada]], [[People/Carol|Carol]]]',
    'link-list lane moves preserve balanced wikilinks and canonicalize repeated carriers',
  );
  assert.equal(
    updateKanbanInlineTaskPropertyText(
      '- [ ] Task [owner:: [[People/Ada|Ada]]] [project:: Alpha] [owner:: stale]',
      'owner',
      '[[People/Carol|Carol]]',
    ),
    '- [ ] Task [project:: Alpha] [owner:: [[People/Carol|Carol]]]',
    'scalar lane moves remove every matching carrier without corrupting nested brackets',
  );

  const semanticTagMove = buildKanbanTaskDropLine({
    line: '- [ ] Task #alpha #keep [tag:: #alpha] [tags:: #other] [tags:: #alpha, #third] [owner:: [[People/Ada|Ada]]] ^task-id',
    propName: 'tags',
    value: 'beta',
    sourceLaneValues: ['#alpha'],
    isStatusPropertyName,
  });
  assert.deepEqual(
    parseKanbanLineItem(semanticTagMove, true)?.text.includes('[owner:: [[People/Ada|Ada]]]'),
    true,
    'semantic tag moves preserve unrelated balanced metadata',
  );
  assert.doesNotMatch(semanticTagMove, /(?:^|\s)#alpha(?=\s|$)|\[(?:tag|tags)::[^\]]*#alpha/iu);
  assert.match(semanticTagMove, /(?:^|\s)#beta(?=\s|\^|$)/iu);
  assert.match(semanticTagMove, /(?:^|\s)#keep(?=\s|\^|$)/iu);
  assert.equal((semanticTagMove.match(/\[tags::/giu) || []).length, 1, 'repeated singular/plural carriers collapse to one');
  assert.match(semanticTagMove, /\[tags::\s*#other, #third\]/iu);

  const clearedSemanticLane = buildKanbanTaskDropLine({
    line: '- [ ] Task [tag:: #alpha] [tags:: #alpha]',
    propName: 'tags',
    value: null,
    sourceLaneValues: ['alpha'],
    isStatusPropertyName,
  });
  assert.equal(clearedSemanticLane, '- [ ] Task', 'dropping into the empty lane clears every source carrier');
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
  const semanticTaskBulletText = 'Bullet with additive task identity [kind:: task] #waiting';
  const waitingText = [...waitingOnlyText, sharedText, semanticTaskBulletText];
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
    `- ${semanticTaskBulletText}`,
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
  view.getAuthoritativeDoneStatuses = () => new Set(['complete', 'wont-do']);
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
    [...taskText, semanticTaskBulletText],
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

test('TPS List keeps native Bases note inclusion authoritative when no semantic override is active', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const included = { file: { path: 'Inbox/Included.md' }, getValue: () => null };
  const excluded = { file: { path: 'Inbox/Excluded.md' }, getValue: () => null };
  const nativeGroups = [{ key: null, entries: [included] }];
  let vaultScans = 0;
  view.app = {
    vault: {
      getMarkdownFiles: () => {
        vaultScans++;
        return [included.file, excluded.file];
      },
    },
  };
  view.data = { data: [included], groupedData: nativeGroups };
  view.isBaseFileFilterReady = () => true;
  view.getActiveBasesSearchQuery = () => '';
  view.getBaseFilterRoots = () => [];
  view.getConfiguredCustomProperty = () => null;

  assert.deepEqual(view.getSourceGroupsForRender(null, false), nativeGroups);
  assert.equal(vaultScans, 0, 'note rendering must never recreate rows by scanning the vault');
  assert.equal(
    view.getSourceGroupsForRender(null, false).flatMap((group) => group.entries).includes(excluded),
    false,
    'ordinary note filters/search/formulas remain native-owned',
  );
  assert.doesNotMatch(viewSource, /getFallbackNoteEntriesFromBaseFilters|getFallbackNoteFormulaSession|__tpsFormulaFallback/u);
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

test('TPS List keeps unmapped task identity but never invents workflow state or mutates a stale revision', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const file = { path: 'Inbox/Mapping QA.md' };
  const mappings = [
    { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete' },
    { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    { checkboxState: '[?]', statuses: ['working'], toggleTargetStatus: 'complete' },
  ];
  let services = {
    status: {
      normalize: (value) => String(value || '').trim().toLowerCase(),
      getDoneStatuses: () => ['complete'],
      getStatusPropertyKey: () => 'taskStatus',
      getRelationalStatusPropertyKey: () => 'status',
    },
  };
  view.getGcmSettings = () => ({ linkedSubitemCheckboxMappings: mappings, properties: [] });
  view.getGcmServices = () => services;
  view.getRelationshipSettingsSources = () => [{ recurrenceCompletionStatuses: ['complete', 'wont-do'] }];
  view.getTaskVisibleTitle = (task) => task.text;
  view.getTaskInlineValues = (task, key) => (task.inlineFields || [])
    .filter((field) => field.key === key)
    .map((field) => field.value);
  view.getTaskExplicitKindValues = () => [];
  view.createFormulaFileContext = () => ({ path: file.path });
  view.createFormulaThisValue = () => null;
  view.getGroupByPropId = (value) => value;
  view.isEmbeddedScheduledDailyTaskBoard = () => false;
  view.resolveBaseContextToken = (value) => String(value || '').replace(/^(?:"([^"]*)"|'([^']*)')$/u, '$1$2');
  view.app = {
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    workspace: { trigger() {} },
    vault: {},
  };
  view.plugin = { settings: {} };

  const todo = { itemKind: 'task', line: 1, checkboxState: '[ ]', text: 'Todo', rawLine: '- [ ] Todo', inlineFields: [] };
  const unmapped = { itemKind: 'task', line: 2, checkboxState: '[!]', text: 'Custom', rawLine: '- [!] Custom', inlineFields: [{ key: 'status', value: 'relational' }] };
  const missing = { itemKind: 'task', line: 3, checkboxState: undefined, text: 'Missing', rawLine: '- Missing', inlineFields: [] };
  const bullet = { itemKind: 'bullet', line: 4, checkboxState: '[ ]', text: 'Bullet', rawLine: '- Bullet', inlineFields: [] };

  assert.deepEqual(view.resolveMappedTaskCheckbox(todo), { checkboxState: '[ ]', status: 'todo' });
  assert.equal(view.resolveMappedTaskCheckbox(unmapped), null);
  assert.equal(view.resolveMappedTaskCheckbox(missing), null);
  assert.equal(view.resolveMappedTaskCheckbox(bullet), null, 'bullets remain explicitly state-less');
  assert.deepEqual(view.getTaskLaneIds(unmapped, 'status', file), ['ungrouped']);

  const invalidContext = view.createTaskFormulaContext(file, unmapped);
  assert.equal(invalidContext.row.status, 'relational', 'the relational row status remains independent');
  assert.equal(invalidContext.row.checkboxState, undefined);
  assert.equal(invalidContext.row.checkboxStatus, undefined);
  assert.equal(invalidContext.row.open, undefined);
  assert.equal(invalidContext.task.status, undefined, 'task.status never inherits relational status');
  assert.equal(invalidContext.task.checkboxState, undefined);
  const bulletContext = view.createTaskFormulaContext(file, bullet);
  assert.equal(bulletContext.row.checkboxState, undefined);
  assert.equal(bulletContext.task, null);

  const checkbox = { checked: true };
  let toggleWrites = 0;
  view.updateTaskCheckboxState = async () => { toggleWrites += 1; };
  view.requestTaskCheckboxToggle(file, unmapped, checkbox);
  assert.equal(toggleWrites, 0);
  assert.equal(checkbox.checked, false);

  view.isWritableTaskGroupingProperty = () => true;
  view.getDisplayLaneWritableValues = () => [];
  const cardEl = {
    setPointerCapture() {},
    addEventListener() {},
    removeEventListener() {},
  };
  view.beginTaskPointerDrag(
    { button: 0, pointerId: 9, clientX: 1, clientY: 2 },
    file,
    unmapped,
    'project',
    { id: 'lane', label: 'Lane', groups: [], laneIds: ['lane'] },
    cardEl,
  );
  assert.equal(view.activeTaskPointerDrag.checkboxState, undefined);
  assert.equal(view.buildPointerTaskDropPayload(view.activeTaskPointerDrag).checkboxState, undefined);

  services = {
    status: {
      normalize: (value) => String(value || '').trim().toLowerCase(),
      getStatusPropertyKey: () => 'taskStatus',
      getRelationalStatusPropertyKey: () => 'status',
    },
  };
  assert.deepEqual([...view.getDoneStatuses()], [], 'legacy recurrence settings never become a hidden done-status fallback');
  assert.equal(view.classifyDoneStatus('todo'), null, 'a missing done-status service remains unknown instead of inventing an open state');
  assert.equal(view.getDefaultMappedTaskStatus('open'), null, 'creation fails closed without an authoritative done-status snapshot');
  assert.deepEqual(
    view.getWorkflowStatusFieldKeysToClear(),
    ['taskStatus', 'task.status', 'checkboxStatus'],
    'the exact configured relational status key is excluded from checkbox-owned cleanup',
  );

  services.status.getDoneStatuses = () => ['complete'];
  let content = '- [ ] Different task';
  let processCalls = 0;
  view.clearTaskCachesForPath = () => {};
  view.app.vault.process = async (_file, updater) => {
    processCalls += 1;
    content = updater(content);
  };
  await TpsListView.prototype.updateTaskCheckboxState.call(view, file, 1, '[x]', '[ ]', '- [ ] Original task');
  assert.equal(content, '- [ ] Different task', 'same-marker replacement at the old line is never toggled');

  content = '- [ ] Original task';
  view.app.vault.process = async (_file, updater) => {
    processCalls += 1;
    mappings[0].toggleTargetStatus = 'working';
    content = updater(content);
  };
  await TpsListView.prototype.updateTaskCheckboxState.call(view, file, 1, '[x]', '[ ]', '- [ ] Original task');
  assert.equal(content, '- [ ] Original task', 'a changed toggle mapping blocks the captured mutation');

  mappings[0].toggleTargetStatus = 'complete';
  content = 'Inserted line\n- [ ] Original task';
  view.app.vault.process = async (_file, updater) => {
    processCalls += 1;
    content = updater(content);
  };
  await TpsListView.prototype.updateTaskCheckboxState.call(view, file, 1, '[x]', '[ ]', '- [ ] Original task');
  assert.equal(content, 'Inserted line\n- [x] Original task', 'one uniquely moved exact revision is safely relocated');
  assert.equal(processCalls, 3);

  mappings.splice(0, mappings.length,
    { checkboxState: '[q]', statuses: ['queued'], toggleTargetStatus: 'shipped' },
    { checkboxState: '[s]', statuses: ['shipped'], toggleTargetStatus: 'queued' },
  );
  services.status.getDoneStatuses = () => ['shipped'];
  assert.equal(view.getDefaultMappedTaskStatus('open'), 'queued');
  assert.equal(view.getDefaultMappedTaskStatus('done'), 'shipped');
  assert.equal(
    view.buildRootTaskLine(
      'Custom workflow',
      null,
      null,
      { mode: 'tasks' },
      'task',
      { status: 'queued', inlineFields: new Map(), tags: new Set(), excludedTags: new Set() },
    ),
    '- [q] Custom workflow',
  );
  services.status.getDoneStatuses = () => ['queued', 'shipped'];
  assert.equal(view.getDefaultMappedTaskStatus('open'), null, 'creation blocks when no authoritative mapped open status exists');
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

test('TPS List excludes frontmatter and fenced-code examples from synthesized rows', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  view.getAuthoritativeDoneStatuses = () => new Set(['complete', 'wont-do']);
  view.getStatusForCheckboxState = () => 'todo';
  const content = [
    '---',
    'quarantine:',
    '  - [ ] Frontmatter task',
    '---',
    '# Visible heading',
    '- [ ] Visible task',
    '- Visible bullet',
    '```md',
    '# Hidden backtick heading',
    '- [ ] Hidden backtick task',
    '- Hidden backtick bullet',
    '```',
    '~~~text',
    '# Hidden tilde heading',
    '- [ ] Hidden tilde task',
    '- Hidden tilde bullet',
    '~~~',
  ].join('\n');

  const rows = view.parseOpenTasks(
    content,
    'Inbox/Quarantined.md',
    Number.MAX_SAFE_INTEGER,
    true,
    true,
    true,
  ).openTasks;

  assert.deepEqual(
    rows.map((row) => ({ kind: row.itemKind, title: row.displayText, line: row.line })),
    [
      { kind: 'heading', title: 'Visible heading', line: 5 },
      { kind: 'task', title: 'Visible task', line: 6 },
      { kind: 'bullet', title: 'Visible bullet', line: 7 },
    ],
  );
});

test('TPS List does not carry hierarchy across a top-level protected block', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  view.getAuthoritativeDoneStatuses = () => new Set(['complete', 'wont-do']);
  view.getStatusForCheckboxState = () => 'todo';

  const topLevelRows = view.parseOpenTasks(
    [
      '- [ ] Parent before code',
      '```md',
      '- [ ] Hidden code task',
      '```',
      '  - [ ] Separate top-level task',
    ].join('\n'),
    'Inbox/Hierarchy.md',
    Number.MAX_SAFE_INTEGER,
    true,
  ).openTasks;
  assert.deepEqual(
    topLevelRows.map(({ line, parentLine, displayText }) => ({ line, parentLine, displayText })),
    [
      { line: 1, parentLine: undefined, displayText: 'Parent before code' },
      { line: 5, parentLine: undefined, displayText: 'Separate top-level task' },
    ],
  );

  const nestedRows = view.parseOpenTasks(
    [
      '- [ ] Parent around code',
      '  ```md',
      '  - [ ] Hidden nested code task',
      '  ```',
      '  - [ ] Child after nested code',
    ].join('\n'),
    'Inbox/Nested-Hierarchy.md',
    Number.MAX_SAFE_INTEGER,
    true,
  ).openTasks;
  assert.deepEqual(
    nestedRows.map(({ line, parentLine, displayText }) => ({ line, parentLine, displayText })),
    [
      { line: 1, parentLine: undefined, displayText: 'Parent around code' },
      { line: 5, parentLine: 1, displayText: 'Child after nested code' },
    ],
  );
});

test('TPS List classifies each loaded note once and derives previews from the canonical task set', () => {
  const loader = sourceBlock(
    viewSource,
    'private loadOpenTasksForFile(file: TFile)',
    'private parseOpenTasks(',
  );
  assert.equal((loader.match(/scanMarkdownDocumentLines\(content\)/gu) || []).length, 1);
  assert.equal((loader.match(/this\.parseOpenTasks\(/gu) || []).length, 1);
  assert.doesNotMatch(loader, /extractOpenTasksFromMarkdown|contentApi|fallback/u);
  assert.match(loader, /openCandidates\.length - openTasks\.length/u);
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
  assert.match(viewSource, /openHeadingLineContextMenu\(event, file, task\.line, task\.rawLine \|\| '', row\)/);
  assert.match(viewSource, /openRenderedLineInNote\([\s\S]{0,180}task\.rawLine \|\| ''[\s\S]{0,180}'HeadingLineOpen'/);
  assert.match(viewSource, /addHeadingAction\('Delete heading', 'trash-2'/);
  assert.match(viewSource, /source: 'tps-list-heading-menu'/);
  assert.match(viewSource, /blockKind: 'heading-section'/);
  assert.match(viewSource, /reason: 'tps-list-heading-delete'/);
  assert.match(
    viewSource,
    /addToNativeMenu\?\.\(menu, \[file\], \{[\s\S]{0,180}includeTitle: false,[\s\S]{0,180}excludeCustomPropertyKeys:/,
  );
  assert.match(viewSource, /item\.task\.itemKind === 'heading' \? 'heading' as const : 'task' as const/);
  assert.match(viewSource, /if \(task\.itemKind === 'heading'\) return true;/);
  assert.match(viewSource, /Obsidian Bases is the sole authority for note inclusion/u);
  assert.match(gcmStyles, /\.tps-list-native-row--heading/);
});

test('TPS List opens plain bullets in the line editor and composes the normal GCM menu', () => {
  assert.match(viewSource, /if \(isBullet && this\.openBulletLineEditor\(event, file, task\.line, task\.rawLine \|\| ''\)\) return;/);
  assert.match(viewSource, /if \(!isBullet && this\.openTaskQuickEditor\(event, row, title\)\) return;/);
  assert.match(viewSource, /resolveRenderedLineRevision\([\s\S]{0,180}'BulletLineEditor'[\s\S]{0,180}service\.openLineEditor\(file, revision\.lineIndex\)/);
  assert.match(viewSource, /this\.openBulletLineContextMenu\(event, file, task\.line, task\.rawLine \|\| ''\)/);
  assert.match(viewSource, /resolveExactLineRevisionIndex\(parts\.lines, preferredIndex, expectedLine\)/);
  assert.match(viewSource, /open:stale-target/);
  assert.match(viewSource, /Refresh the view and try again/);
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
  assert.match(viewSource, /addInlineTagsToTaskLine\(line, value\)/);
  assert.match(logLineUtilsSource, /collapseEmptiedInlineFieldComments\(source, matchingFields\)/);
  assert.match(viewSource, /removeInlineTagFromTaskLine\(line, tag\)/);
  assert.match(viewSource, /resolveExactLineRevisionIndex\(parts\.lines, lineIndex, rawLine\)/);
  assert.match(viewSource, /menuController\?\.addToExactFileMenu\?\.\(menu, targets, \{[\s\S]{0,100}includeTags: true,[\s\S]{0,100}includeSingleTargetActions: targets\.length === 1/);
  assert.match(menuBuilderSource, /allEntriesSupportProperties && options\.includeTags === true/);
  assert.match(menuBuilderSource, /label: 'Tags',[\s\S]{0,100}key: 'tags',[\s\S]{0,100}listItemType: 'tag'/);
  assert.match(logBaseSource, /this\.addEntryTagsMenu\(menu, entry\)/);
  assert.match(logBaseSource, /setTitle\(current\.length > 0 \? `Tags \(\$\{current\.length\}\)` : 'Tags'\)/);
  assert.match(logBaseSource, /addLogLineSemanticTags\(line, 'tags', tags\)/);
  assert.match(logBaseSource, /toggleLogLineSemanticTag\(line, 'tags', tag, true\)/);
  assert.match(logBaseSource, /column\.normalized !== 'linenumber'[\s\S]{0,120}column\.normalized !== 'tags'/);
  assert.doesNotMatch(logBaseSource, /column\.normalized !== 'tag'/);

  const { addLogLineSemanticTags, addLogLineTag, readLogLineTags, removeLogLineTag } = await loadLogLineUtils();
  assert.deepEqual(readLogLineTags('#Alpha, beta, #alpha'), ['alpha', 'beta']);
  assert.equal(addLogLineTag('#alpha', 'QA/Base'), '#alpha, #qa/base');
  assert.equal(removeLogLineTag('#alpha, #qa/base', '#alpha'), '#qa/base');
  assert.equal(removeLogLineTag('#alpha', 'alpha'), null);
  const tableLine = '- [ ] Table row #existing <!-- [tpsId:: row-tags] --> ^row-tags';
  const taggedTableLine = addLogLineSemanticTags(tableLine, 'tags', 'One, two, #ONE');
  assert.match(taggedTableLine, /\[tags:: #existing, #one, #two\]/u);
  assert.match(taggedTableLine, /\[tpsId:: row-tags\]/u);
  assert.match(taggedTableLine, /\^row-tags$/u);
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
  assert.match(logBaseSource, /this\.renderedTaskEntryOrder = getTpsTableTaskSelectionOrder\(renderedEntries\)/);
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

test('TPS List task lane synthesis reuses one full-vault task build without changing task results', async () => {
  const renderAsyncStart = viewSource.indexOf('  private async renderAsync(');
  const renderAsyncEnd = viewSource.indexOf('\n  private ', renderAsyncStart + '  private async renderAsync('.length);
  assert.ok(renderAsyncStart >= 0 && renderAsyncEnd > renderAsyncStart);
  const renderAsyncSource = viewSource.slice(renderAsyncStart, renderAsyncEnd);
  assert.equal((renderAsyncSource.match(/this\.buildTaskRenderItemsByLane\(/g) || []).length, 1);
  const buildAt = renderAsyncSource.indexOf('const taskRenderItemsByLane = this.buildTaskRenderItemsByLane(');
  const synthesizeAt = renderAsyncSource.indexOf('groups = this.ensureGroupsForTaskLanes(', buildAt);
  const parentsAt = renderAsyncSource.indexOf('parentByChild = this.buildParentByChild(groups)', synthesizeAt);
  const lanesAt = renderAsyncSource.indexOf('this.buildLaneRenderItemsByLane(groups, parentByChild)', parentsAt);
  assert.ok(buildAt >= 0 && buildAt < synthesizeAt && synthesizeAt < parentsAt && parentsAt < lanesAt);

  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const file = { path: 'Inbox/Tasks.md' };
  const tasks = [
    { text: 'First task', laneIds: ['key:todo'] },
    { text: 'Second task', laneIds: ['key:doing', 'key:done'] },
  ];
  let fullVaultVisits = 0;
  view.app = { vault: { getMarkdownFiles: () => (fullVaultVisits += 1, [file]) } };
  Object.assign(view, {
    isBaseFileFilterReady: () => true,
    getActiveBasesSearchQuery: () => '',
    getExplicitTaskSourceFiles: () => [],
    shouldScanVaultForTaskFilters: () => true,
    getAllLineItemsForFile: () => tasks,
    taskMatchesRootFilter: () => true,
    taskMatchesSearchQuery: () => true,
    getTaskLaneIds: (task) => task.laneIds,
    getGroupByPropId: (propName) => propName,
    getLaneId: (group) => group.key == null ? 'ungrouped' : `key:${String(group.key).toLowerCase()}`,
    applyManualLaneOrder: (groups) => groups,
  });
  const groups = [{ key: 'todo', entries: [{ file }], hasKey: () => true }];
  const buildTasks = (sourceGroups) => view.buildTaskRenderItemsByLane(
    sourceGroups, 'status', new Set([file.path]), { mode: 'tasks', hasTaskDirective: true },
  );
  const beforeSynthesis = buildTasks(groups);
  assert.equal(fullVaultVisits, 1);
  const groupsWithTaskLanes = view.ensureGroupsForTaskLanes(groups, beforeSynthesis);
  assert.deepEqual(
    groupsWithTaskLanes.map((group) => [view.getLaneId(group), group.entries.length]),
    [['key:todo', 1], ['key:doing', 0], ['key:done', 0]],
  );
  const afterSynthesisOracle = buildTasks(groupsWithTaskLanes);
  assert.equal(fullVaultVisits, 2);
  const snapshot = (map) => Array.from(map, ([laneId, items]) => [
    laneId,
    items.map(({ task }) => tasks.indexOf(task)),
  ]);
  assert.deepEqual(snapshot(beforeSynthesis), [
    ['key:todo', [0]], ['key:doing', [1]], ['key:done', [1]],
  ]);
  assert.deepEqual(snapshot(afterSynthesisOracle), snapshot(beforeSynthesis));
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

  assert.equal(normalizeTpsBaseWriteFallbackMode(undefined), 'today-daily-note');
  assert.equal(normalizeTpsBaseWriteFallbackMode('unexpected'), 'today-daily-note');
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

test('TPS List uses the shared public FileView owner resolver', () => {
  const resolverBlock = sourceBlock(
    viewSource,
    '  private getRuntimeBaseFile(): TFile | null {',
    '  private getEmbeddedBasePathFromDom(): string | null {',
  );
  assert.match(resolverBlock, /getOwningWorkspaceFile\(this\.app, this\.containerEl, 'base'\)/);
  assert.doesNotMatch(resolverBlock, /controller|queryController|activeLeaf|getViewState/);
});

test('TPS List never falls through to native note creation when mobile loses the Base identity', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  view.getRuntimeBaseFilterRoots = () => [{ and: ['task.tags.contains(shopping)'] }];
  view.getStampedBaseFilterRoots = () => null;
  view.getBaseFile = () => null;
  view.getBaseContextFile = () => null;

  await assert.rejects(
    view.getBaseFilterRootsForCreation(),
    /Could not resolve the Base definition for line creation/,
  );
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

test('TPS List formulas power synthesized task display, filtering, grouping, sorting, and search without becoming writable', async () => {
  const [{ TpsListView }, { tpsBaseFormulaService }] = await Promise.all([
    loadTpsListViewHarness(),
    loadFormulaService(),
  ]);
  const File = globalThis.__TpsListFormulaTestFile;
  const file = new File();
  Object.assign(file, {
    path: 'Inbox/Formula Tasks.md',
    name: 'Formula Tasks.md',
    basename: 'Formula Tasks',
    extension: 'md',
    parent: { path: 'Inbox' },
    stat: { size: 100, ctime: 1_786_000_000_000, mtime: 1_786_000_100_000 },
  });
  const task = {
    itemKind: 'task',
    line: 4,
    checkboxState: '[ ]',
    text: 'Ship formulas #qa [points:: 5] [status:: blocked] [kind:: project]',
    rawLine: '- [ ] Ship formulas #qa [points:: 5] [status:: blocked] [kind:: project] [Project:: Alpha] [project:: Beta] [blank:: ]',
    displayText: 'Ship formulas',
    inlineFields: [
      { key: 'points', value: '5' },
      { key: 'status', value: 'blocked' },
      { key: 'kind', value: 'project' },
      { key: 'Project', value: 'Alpha' },
      { key: 'project', value: 'Beta' },
      { key: 'blank', value: '' },
    ],
  };
  const compiled = tpsBaseFormulaService.compile({
    total: 'number(points) + number(note.parentPoints)',
    bucket: 'if(formula.total >= 7, "High", "Low")',
    search_label: 'title.lower() + " ready"',
    ready: 'formula.total >= 7 && task.open',
    relational_status: 'status',
    workflow_status: 'task.status',
    raw_tag: 'tags.contains("#qa")',
    day: 'date("2026-08-10")',
    owner: 'link("People/Ada.md", "Ada")',
    labels: '["alpha", "beta"]',
    at_expected_line: 'line.number == 4',
    task_identity: 'kinds.contains("task")',
    project_identity: 'kinds.contains("project")',
    canonical_kinds: 'kinds.length == 2 && kinds[0] == "task" && kinds[1] == "project"',
    aliases_share_aggregate: 'Project.length == 2 && project.length == 2 && Project[0] == "Alpha" && project[1] == "Beta"',
    blank_is_present: 'blank == ""',
    raw_is_source: 'line.raw.startsWith("- [ ] Ship formulas")',
    raw_checkbox_state: 'checkboxState == "[ ]" && task.checkboxState == "[ ]"',
    false_value: 'false',
    empty_value: 'null',
  }, 'list-formula-integration');
  const view = Object.create(TpsListView.prototype);
  view.taskFormulaSessions = new WeakMap();
  view.formulaDiagnostics = new Set();
  view.config = { groupBy: { property: 'formula.bucket', direction: 'asc' } };
  view.plugin = { settings: {}, app: null };
  view.app = {
    vault: { getFileByPath: () => null },
    workspace: { getActiveFile: () => null },
    metadataCache: {
      getFileCache: () => ({ frontmatter: { parentPoints: 2, kind: 'task' }, tags: [], links: [] }),
    },
  };
  view.getActiveFormulaSet = () => compiled;
  view.getStatusForCheckboxState = () => 'todo';
  view.getAuthoritativeDoneStatuses = () => new Set(['complete']);
  view.getBaseContextFile = () => null;
  view.getBaseFile = () => null;
  view.getBaseSourcePath = () => 'Formula Tasks.base';
  view.getConfiguredBaseViewName = () => 'Formula QA';
  view.createFormulaThisValue = () => null;
  view.getConfiguredCustomProperty = () => null;

  const property = view.getTaskPropertyValue(file, task, 'formula.total', new Set());
  assert.deepEqual(property, { text: '7', title: '7', kind: 'formula', editable: false });
  assert.deepEqual(
    view.getTaskPropertyValue(file, task, 'formula.ready', new Set()),
    { text: 'Yes', title: 'formula.ready: Yes', kind: 'checkbox', editable: false, rawValue: true },
  );
  assert.deepEqual(
    view.getTaskPropertyValue(file, task, 'formula.false_value', new Set()),
    { text: 'No', title: 'formula.false_value: No', kind: 'checkbox', editable: false, rawValue: false },
  );
  assert.equal(view.getTaskPropertyValue(file, task, 'formula.empty_value', new Set()), null);
  assert.equal(view.getTaskPropertyValue(file, task, 'formula.missing', new Set())?.kind, 'formula-error');
  assert.equal(view.getTaskPropertyValue(file, task, 'line', new Set()).text, '4');
  assert.equal(view.evaluateGenericTaskValueFilterExpression('formula.total >= 7', task, file), true);
  assert.equal(view.evaluateGenericTaskValueFilterExpression('formula.total > 7', task, file), false);
  assert.equal(view.evaluateTaskFilterString('formula.ready', task, file), true);
  assert.equal(view.evaluateTaskFilterString('!formula.ready', task, file), false);
  assert.equal(view.evaluateTaskFilterObject({ property: 'formula.day', operator: '==', value: '2026-08-10' }, task, file), true);
  assert.equal(view.evaluateTaskFilterObject({ property: 'formula.owner', operator: '==', value: '[[People/Ada]]' }, task, file), true);
  assert.equal(view.evaluateTaskFilterObject({ property: 'formula.labels', operator: 'contains', value: 'beta' }, task, file), true);
  assert.equal(view.evaluateTaskFilterString('kind == task', task, file), true);
  assert.equal(view.evaluateTaskFilterString('kind == project', task, file), true);
  assert.equal(view.evaluateTaskFilterString('itemKind == task', task, file), true);
  assert.equal(view.evaluateTaskFilterObject({ property: 'kind', operator: 'is', value: 'project' }, task, file), true);
  const additiveKindFilter = view.getTaskRootFilterFromBaseFilters(['kind == project']);
  assert.equal(additiveKindFilter.mode, 'mixed');
  assert.equal(additiveKindFilter.hasTaskDirective, true);
  assert.equal(additiveKindFilter.includeBullets, false);
  assert.equal(additiveKindFilter.includeHeadings, false);
  view.getBaseFilterRoots = () => ['kind == project'];
  assert.equal(view.taskMatchesRootFilter(task, additiveKindFilter, file), true);
  const bulletIdentity = {
    ...task,
    itemKind: 'bullet',
    checkboxState: undefined,
    text: 'Project record [kind:: project]',
    inlineFields: [{ key: 'kind', value: 'project' }],
  };
  assert.equal(view.taskMatchesRootFilter(bulletIdentity, additiveKindFilter, file), false);
  assert.equal(view.getTaskFormulaSession(file, task).get('task_identity').value, true);
  assert.equal(view.getTaskFormulaSession(file, task).get('project_identity').value, true);
  assert.equal(view.getTaskFormulaSession(file, task).get('canonical_kinds').value, true);
  const mixedCasePluralKindTask = {
    ...task,
    inlineFields: [
      ...task.inlineFields.filter((field) => field.key.toLowerCase() !== 'kind'),
      { key: 'kind', value: '[Project, project, Tasks, task]' },
    ],
  };
  assert.equal(
    view.getTaskFormulaSession(file, mixedCasePluralKindTask).get('canonical_kinds').value,
    true,
    'additive row.kinds canonicalizes case and structural plurals without duplicates',
  );
  view.getBaseFilterRoots = () => [{ not: 'formula.missing' }];
  assert.equal(
    view.taskMatchesStructuredBaseFilters(task, file),
    false,
    'a broken formula cannot be negated into an included synthetic row',
  );
  view.getBaseFilterRoots = () => [{ or: ['formula.missing', 'formula.total == 7'] }];
  assert.equal(
    view.taskMatchesStructuredBaseFilters(task, file),
    false,
    'an evaluated broken branch fails closed before a later true sibling',
  );
  view.getBaseFilterRoots = () => [{ or: ['formula.total == 7', 'formula.missing'] }];
  assert.equal(
    view.taskMatchesStructuredBaseFilters(task, file),
    true,
    'a decisive true branch short-circuits an unreachable broken sibling',
  );
  view.getBaseFilterRoots = () => [{ property: 'formula.total', operator: 'approximately', value: 7 }];
  assert.equal(view.taskMatchesStructuredBaseFilters(task, file), false, 'unsupported formula operators fail closed');
  view.getBaseFilterRoots = () => [{ property: 'formula.total', operator: 'notMatchesRegex', value: 7 }];
  assert.equal(view.taskMatchesStructuredBaseFilters(task, file), false, 'unknown negated operators cannot become inequality fallbacks');
  assert.equal(
    view.evaluateTaskFilterObject({ property: 'formula.total', operator: 'is not', value: 8 }, task, file),
    true,
    'the explicit negative-equality allowlist remains supported',
  );
  assert.equal(
    view.evaluateTaskFilterObject({ property: 'formula.labels', operator: 'not contains', value: 'gamma' }, task, file),
    true,
    'the explicit negative-contains allowlist remains supported',
  );
  assert.equal(
    view.lineMatchesCreationFilters('- [ ] Created [points:: 5]', file, [{ not: 'formula.missing' }], 4),
    null,
    'creation reports an unresolved formula instead of treating it as an ordinary mismatch',
  );
  assert.equal(view.getTaskFormulaSession(file, task).get('relational_status').value, 'blocked');
  assert.equal(view.getTaskFormulaSession(file, task).get('workflow_status').value, 'todo');
  assert.equal(view.getTaskFormulaSession(file, task).get('raw_tag').value, true);
  assert.equal(view.getTaskFormulaSession(file, task).get('aliases_share_aggregate').value, true);
  assert.equal(view.getTaskFormulaSession(file, task).get('blank_is_present').value, true);
  assert.equal(view.getTaskFormulaSession(file, task).get('raw_is_source').value, true);
  assert.equal(view.getTaskFormulaSession(file, task).get('raw_checkbox_state').value, true);
  assert.deepEqual(view.getTaskLaneIds(task, 'formula.bucket', file), ['key:high']);
  view.config = { groupBy: { property: 'formula.owner', direction: 'asc' } };
  assert.deepEqual(view.getTaskLaneIds(task, 'formula.owner', file), ['key:people/ada.md']);
  assert.ok(view.getTaskSortValue({ file, task, laneId: 'key:High' }, 'formula.total'));
  const nativeEntry = { file, getValue: () => new Date(2026, 7, 10) };
  assert.equal(
    view.getListSortValue({ kind: 'note', item: { entry: nativeEntry }, nativeIndex: 0 }, 'formula.day'),
    view.getTaskSortValue({ file, task, laneId: 'key:High' }, 'formula.day'),
  );
  assert.equal(view.taskMatchesSearchQuery(file, task, 'ready'), true);
  assert.equal(view.getAppendedLineNumber('one\ntwo\nthree\n'), 4);
  assert.equal(
    view.lineMatchesCreationFilters('- [ ] Created [points:: 5]', file, ['formula.at_expected_line'], 4),
    true,
  );
  assert.equal(
    view.lineMatchesCreationFilters('- [ ] Created [points:: 5]', file, ['formula.at_expected_line'], 1),
    false,
  );
  assert.equal(view.getWritableTaskPropertyName('formula.total'), null);
  assert.equal(view.isWritableTaskGroupingProperty('formula.bucket'), false);
});

test('a formula-only Base filter discovers checkbox, bullet, and heading rows even with zero native note rows', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const File = globalThis.__TpsListFormulaTestFile;
  const file = new File();
  Object.assign(file, {
    path: 'Inbox/Formula Only.md',
    name: 'Formula Only.md',
    basename: 'Formula Only',
    extension: 'md',
    parent: { path: 'Inbox' },
  });
  const rows = [
    { itemKind: 'task', line: 1, checkboxState: '[ ]', text: 'Task', inlineFields: [] },
    { itemKind: 'bullet', line: 2, text: 'Bullet', inlineFields: [] },
    { itemKind: 'heading', headingLevel: 2, line: 3, text: 'Heading', inlineFields: [] },
  ];
  const view = Object.create(TpsListView.prototype);
  view.data = { data: [], groupedData: [] };
  view.app = { vault: { getMarkdownFiles: () => [file] } };
  view.getBaseFilterRoots = () => ['formula.include'];
  view.shouldShowCompletedTasks = () => false;
  view.getAuthoritativeDoneStatuses = () => new Set(['complete']);
  view.isEmbeddedScheduledDailyTaskBoard = () => false;
  view.isBaseFileFilterReady = () => true;
  view.getActiveBasesSearchQuery = () => '';
  view.getExplicitTaskSourceFiles = () => [];
  view.getAllLineItemsForFile = () => rows;
  view.taskMatchesRootFilter = () => true;
  view.taskMatchesSearchQuery = () => true;
  view.getTaskLaneIds = () => ['ungrouped'];
  view.getGroupByPropId = () => null;

  const taskFilter = view.getTaskRootFilterFromBaseFilters();
  assert.equal(taskFilter.hasTaskDirective, true);
  assert.equal(taskFilter.includeBullets, true);
  assert.equal(taskFilter.includeHeadings, true);
  assert.equal(view.shouldScanVaultForTaskFilters(taskFilter), true);
  const result = view.buildTaskRenderItemsByLane(
    view.getSourceGroupsForRender(null, false),
    null,
    new Set(),
    taskFilter,
  );
  assert.deepEqual(
    result.get('ungrouped')?.map(({ task }) => task.itemKind),
    ['task', 'bullet', 'heading'],
  );

  view.getBaseFilterRoots = () => ['note.title == "formula.fake"'];
  const quotedLiteralFilter = view.getTaskRootFilterFromBaseFilters();
  assert.equal(quotedLiteralFilter.hasTaskDirective, false);
  assert.equal(view.shouldScanVaultForTaskFilters(quotedLiteralFilter), false);
});

test('GCM exposes the canonical nesting-aware line metadata parser as a versioned read-only API', () => {
  const pluginApiSource = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
  assert.match(pluginApiSource, /lineMetadata:\s*\{\s*version:\s*1/u);
  assert.match(pluginApiSource, /readInlineFields:\s*\(line:\s*string\)\s*=>\s*parseLineEntityMetadata\(line\)\?\.fields\s*\?\?\s*\[\]/u);
  assert.match(pluginApiSource, /readInlineFieldValue:\s*\(line:\s*string,\s*key:\s*string\)\s*=>\s*readLineEntityInlineFieldValue\(line,\s*key\)/u);
  assert.match(pluginApiSource, /readTags:\s*\(line:\s*string\)\s*=>\s*parseLineEntityMetadata\(line\)\?\.tags\s*\?\?\s*\[\]/u);
  assert.match(pluginApiSource, /parseStringList:\s*\(value:\s*unknown\)\s*=>\s*parseStringListInput\(value\)/u);
  assert.match(pluginApiSource, /parseTags:\s*\(value:\s*unknown\)\s*=>\s*parseTaskTagValues\(value\)/u);
  assert.match(pluginApiSource, /getDisplayTitle:\s*\(line:\s*string\)\s*=>\s*getSharedLineDisplayTitle\(line\)/u);
  assert.match(pluginApiSource, /scanDocument:\s*\(content:\s*string\)\s*=>\s*Object\.freeze\([\s\S]*?getMarkdownContentLines\(content\)/u);
  assert.match(pluginApiSource, /parseLine:\s*\(line:\s*string\)\s*=>\s*\{\s*const parsed = parseLineEntityMetadata\(line\);[\s\S]*?fields:\s*parsed\?\.fields\s*\?\?\s*\[\],[\s\S]*?tags:\s*parsed\?\.tags\s*\?\?\s*\[\],[\s\S]*?displayTitle:\s*parsed\?\.displayTitle\s*\?\?\s*''/u);
  assert.doesNotMatch(pluginApiSource, /parseLine:[\s\S]{0,500}readTaskInlineFields|parseLine:[\s\S]{0,500}readTaskLineTags/u);
});

test('TPS List pointer drag resolves the real rendered group and cleans up mouse and mobile state', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const displayLane = {
    id: 'display:hca',
    label: 'hca',
    groups: [],
    laneIds: ['key:hca'],
  };
  const laneEl = { dataset: { displayLaneId: displayLane.id } };
  const target = {
    closest: (selector) => {
      assert.match(selector, /\.tps-list-native-group\[data-display-lane-id\]/u);
      return laneEl;
    },
  };
  view.containerEl = { contains: (candidate) => candidate === laneEl };
  view.renderedDisplayLanesById = new Map([[displayLane.id, displayLane]]);
  assert.equal(view.getRenderedDisplayLaneFromElement(target), displayLane);
  view.containerEl = { contains: () => false };
  assert.equal(view.getRenderedDisplayLaneFromElement(target), null, 'foreign/stale group elements fail closed');

  const priorWindow = globalThis.window;
  let timerCallback = null;
  let timerCleared = false;
  globalThis.window = {
    setTimeout: (callback) => (timerCallback = callback, 41),
    clearTimeout: (id) => { if (id === 41) timerCleared = true; },
  };
  try {
    view.isWritableTaskGroupingProperty = () => true;
    view.getDisplayLaneWritableValues = () => ['hca'];
    const classes = new Set();
    let captured = false;
    let lostPointerCapture = null;
    const cardEl = {
      isConnected: true,
      dataset: {},
      ownerDocument: {
        createElement: () => ({
          className: '', textContent: '', children: [], style: {}, isConnected: false,
          setAttribute() {},
          appendChild(child) { this.children.push(child); },
          remove() { this.isConnected = false; },
        }),
        body: { appendChild(el) { el.isConnected = true; } },
      },
      addClass: (name) => classes.add(name),
      removeClass: (name) => classes.delete(name),
      addEventListener: (name, callback) => { if (name === 'lostpointercapture') lostPointerCapture = callback; },
      removeEventListener: (name, callback) => {
        if (name === 'lostpointercapture' && lostPointerCapture === callback) lostPointerCapture = null;
      },
      setPointerCapture: () => { captured = true; },
      hasPointerCapture: () => captured,
      releasePointerCapture: () => { captured = false; },
    };
    const task = {
      itemKind: 'task',
      line: 3,
      text: 'Move me',
      rawLine: '- [ ] Move me [tags:: hca]',
      checkboxState: '[ ]',
    };
    const file = { path: 'Inbox/Tasks.md' };
    view.getMappedCheckboxStateForTask = () => '[ ]';
    view.getTaskVisibleTitle = () => 'Move me';
    view.selectedRowIds = new Set();
    view.getSelectedRows = () => [];
    view.beginTaskPointerDrag(
      { button: 0, pointerId: 7, pointerType: 'touch', clientX: 10, clientY: 10 },
      file,
      task,
      'tags',
      displayLane,
      cardEl,
    );
    assert.equal(view.activeTaskPointerDrag.activated, false);
    assert.equal(view.activeTaskPointerDrag.rawLine, task.rawLine);
    assert.equal(view.buildPointerTaskDropPayload(view.activeTaskPointerDrag).rawLine, task.rawLine);
    assert.equal(captured, false, 'touch scrolling keeps pointer capture off before long press');
    timerCallback();
    assert.equal(view.activeTaskPointerDrag.activated, true);
    assert.equal(captured, true);
    assert.equal(classes.has('tps-list-native-row--drag-ready'), true);
    view.handleTaskPointerMove({
      pointerId: 7,
      clientX: 30,
      clientY: 10,
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(view.activeTaskPointerDrag.moved, true);
    assert.equal(view.activeTaskPointerDrag.preview?.el?.isConnected, true);
    view.cancelTaskPointerDrag({ pointerId: 7 });
    assert.equal(view.activeTaskPointerDrag, null);
    assert.equal(captured, false);
    assert.equal(classes.size, 0);

    timerCallback = null;
    timerCleared = false;
    view.beginTaskPointerDrag(
      { button: 0, pointerId: 8, pointerType: 'touch', clientX: 10, clientY: 10 },
      file,
      task,
      'tags',
      displayLane,
      cardEl,
    );
    view.handleTaskPointerMove({ pointerId: 8, clientX: 10, clientY: 30 });
    assert.equal(view.activeTaskPointerDrag, null, 'a touch pan before long press remains a scroll gesture');
    assert.equal(timerCleared, true);

    view.beginTaskPointerDrag(
      { button: 0, pointerId: 9, pointerType: 'mouse', clientX: 10, clientY: 10 },
      file,
      task,
      'tags',
      displayLane,
      cardEl,
    );
    assert.equal(typeof lostPointerCapture, 'function');
    lostPointerCapture();
    assert.equal(view.activeTaskPointerDrag, null, 'lost pointer capture always releases drag state');
  } finally {
    globalThis.window = priorWindow;
  }

  const renderList = sourceBlock(viewSource, 'private renderList(', 'private formatListGroupLabel(');
  assert.match(renderList, /'data-display-lane-id': displayLane\.id/u);
  assert.match(viewSource, /this\.renderedDisplayLanesById = new Map\(displayLanes\.map/u);
  assert.match(viewSource, /TPS_LIST_TOUCH_DRAG_HOLD_MS = 550/u);
  assert.match(viewSource, /TPS_LIST_POINTER_DRAG_DISTANCE_PX = 10/u);
  assert.match(viewSource, /registerDomEvent\(document, 'pointercancel'/u);
  assert.match(viewSource, /registerDomEvent\(window, 'blur', \(\) => this\.clearActiveTaskPointerDrag\(\)\)/u);
  assert.match(viewSource, /visibilitychange[\s\S]*?clearActiveTaskPointerDrag/u);
  assert.match(viewSource, /onunload\(\): void \{[\s\S]*?this\.clearActiveTaskPointerDrag\(\)/u);
  assert.match(
    sourceBlock(viewSource, 'private async handleTaskPointerDropEvent(', 'private beginTaskPointerDrag('),
    /this\.confirmAndApplyInlineTaskDrop\([\s\S]*?parsed\.rawLine/u,
    'cross-view pointer drops must pass their captured source revision into planning',
  );
  assert.match(
    sourceBlock(viewSource, 'private async handleTaskPointerUp(', 'private cancelTaskPointerDrag('),
    /this\.confirmAndApplyInlineTaskDrop\([\s\S]*?active\.rawLine/u,
    'local pointer drops must pass their captured source revision into planning',
  );
  assert.match(
    sourceBlock(viewSource, 'private createListTaskRow(', 'private renderListTaskBooleanProperty('),
    /title\.addEventListener\('pointerdown',[\s\S]*?this\.beginTaskPointerDrag\(event, file, task, propName, displayLane, row\)/u,
    'the visible task title must be a usable mouse and long-press drag surface',
  );
  assert.match(
    sourceBlock(viewSource, 'private createListTaskRow(', 'private renderListTaskBooleanProperty('),
    /contextmenu[\s\S]*?this\.activeTaskPointerDrag\?\.cardEl === row[\s\S]*?event\.preventDefault\(\)[\s\S]*?return/u,
    'the synthetic touch context menu must not race an armed long-press drag',
  );
  assert.doesNotMatch(
    sourceBlock(viewSource, 'private getCardPropertyIds(', 'private sortEntriesForView('),
    /slice\(0,\s*4\)/u,
    'every field selected in the Base must remain visible in TPS List',
  );
});

test('TPS List invalidates synthesized task-only rows for delete and rename events', async () => {
  const lifecycle = sourceBlock(viewSource, '// Keep synthesized rows stable', "this.registerEvent(this.app.workspace.on('file-open'");
  assert.match(lifecycle, /vault\.on\('rename',[\s\S]*?clearTaskCachesForPath\(oldPath\)[\s\S]*?clearTaskCachesForPath\(file\.path\)/u);
  assert.match(lifecycle, /vault\.on\('delete',[\s\S]*?clearTaskCachesForPath\(file\.path\)/u);
  assert.match(lifecycle, /taskFilter\.mode === 'tasks'[\s\S]*?taskFilter\.mode === 'bullets'[\s\S]*?taskFilter\.hasTaskDirective/u);

  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const file = { path: 'Inbox/Deleted task source.md' };
  let resolveRead;
  let liveFile = file;
  let refreshes = 0;
  view.app = {
    vault: {
      cachedRead: () => new Promise((resolve) => { resolveRead = resolve; }),
      getFileByPath: () => liveFile,
    },
  };
  view.renderGeneration = 1;
  view.refreshDebounced = () => { refreshes += 1; };
  view.openTasksByPath = new Map();
  view.allTasksByPath = new Map();
  view.openTaskOverflowByPath = new Map();
  view.openTasksLoading = new Set();
  view.taskCacheEpochByPath = new Map();
  view.taskIndexLoadGeneration = 4;
  view.taskIndexLoadPromise = Promise.resolve();
  view.taskIndexLoadKey = 'stale-load';
  view.taskIndexProgress = { completedFiles: 1, totalFiles: 2, complete: false };

  view.loadOpenTasksForFile(file);
  view.clearTaskCachesForPath(file.path);
  assert.equal(view.taskIndexLoadGeneration, 5);
  assert.equal(view.taskIndexLoadPromise, null);
  assert.equal(view.taskIndexLoadKey, '');
  assert.equal(view.taskIndexProgress, null);
  resolveRead('- [ ] stale deleted task');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(view.allTasksByPath.has(file.path), false, 'an invalidated async read cannot restore stale rows');
  assert.equal(view.openTasksLoading.size, 0);
  assert.equal(refreshes, 1, 'the settled batch schedules one clean reload');

  refreshes = 0;
  view.loadOpenTasksForFile(file);
  liveFile = null;
  resolveRead('- [ ] stale deleted task');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(view.allTasksByPath.has(file.path), false, 'a deleted/renamed file identity cannot commit its read');
  assert.equal(refreshes, 1);
});

test('TPS List preserves the real Bases scroller and avoids variable-height row virtualization', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const lane = {
    scrollTop: 33,
    closest: () => ({ dataset: { displayLaneId: 'lane-a' } }),
  };
  view.scrollEl = { scrollTop: 420, scrollLeft: 17 };
  view.containerEl = {
    scrollTop: 0,
    scrollLeft: 0,
    querySelectorAll: () => [lane],
  };

  const state = view.captureRenderScrollState();
  assert.deepEqual(state, { top: 420, left: 17, laneCards: { 'lane-a': 33 } });

  view.scrollEl.scrollTop = 0;
  view.scrollEl.scrollLeft = 0;
  lane.scrollTop = 0;
  view.restoreRenderScrollState(state);
  assert.equal(view.scrollEl.scrollTop, 420);
  assert.equal(view.scrollEl.scrollLeft, 17);
  assert.equal(lane.scrollTop, 33);
  assert.equal(view.containerEl.scrollTop, 0, 'the non-scrolling content wrapper is never treated as the scroll owner');

  const styles = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');
  const rowRule = styles.match(/\.tps-list-native-row\s*\{([\s\S]*?)\n\s*\}/u)?.[1] || '';
  assert.doesNotMatch(rowRule, /content-visibility|contain-intrinsic/u);
});

test('TPS List special field routing is consistent for task, bullet, heading, and note rows', async () => {
  const { TpsListView } = await loadTpsListViewHarness();
  const view = Object.create(TpsListView.prototype);
  const file = {
    path: 'Projects/QA.md',
    parent: { path: 'Projects' },
  };
  view.isStatusPropertyName = () => false;
  view.getFrontmatterPropNameFromId = () => null;
  view.getConfiguredCustomProperty = () => ({
    id: 'folder',
    key: 'folderPath',
    label: 'Folder',
    type: 'folder',
  });
  for (const itemKind of ['task', 'bullet', 'heading']) {
    assert.deepEqual(
      view.getTaskPropertyValue(file, { itemKind }, 'folderPath', new Set()),
      {
        text: 'Projects',
        title: 'Source folder: Projects',
        kind: 'folder',
        editable: false,
        rawValue: 'Projects',
      },
    );
  }

  const span = { hasClass: () => false };
  let recurrenceRoutes = 0;
  let snoozeRoutes = 0;
  let scalarRoutes = 0;
  view.isTagProperty = () => false;
  view.openListTaskRecurrencePicker = () => { recurrenceRoutes += 1; };
  view.openListTaskScheduledPicker = () => { snoozeRoutes += 1; };
  view.openListTaskScalarEditor = () => { scalarRoutes += 1; };
  for (const itemKind of ['task', 'bullet', 'heading']) {
    const task = { itemKind };
    view.getConfiguredCustomProperty = () => ({
      id: 'recurrence',
      key: 'recurrence',
      label: 'Recurrence',
      type: 'recurrence',
    });
    view.startListTaskPropertyEdit(span, file, task, {
      text: 'daily',
      kind: 'recurrence',
      editable: true,
      propName: 'recurrence',
      rawValue: 'FREQ=DAILY',
    });
    view.getConfiguredCustomProperty = () => ({
      id: 'snooze',
      key: 'snooze',
      label: 'Snooze',
      type: 'snooze',
    });
    view.startListTaskPropertyEdit(span, file, task, {
      text: 'tomorrow',
      kind: 'snooze',
      editable: true,
      propName: 'snooze',
      rawValue: '2026-08-13 09:00',
    });
  }
  assert.equal(recurrenceRoutes, 3);
  assert.equal(snoozeRoutes, 3);
  assert.equal(scalarRoutes, 0);

  const noteRenderer = sourceBlock(viewSource, 'private renderListNoteProperties(', 'private createListBooleanPropertyControl(');
  assert.match(noteRenderer, /sourceFolderProperty[\s\S]*?\(logicalFile \?\? entry\.file\)\.parent\?\.path \|\| '\/'/u);
  assert.match(noteRenderer, /noteRecurrenceProperty[\s\S]*?&& !noteRecurrenceProperty/u);
});
