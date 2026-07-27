import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

const sources = {
  badgeRenderer: read('src/menu/badge-renderer.ts'),
  constants: read('src/constants.ts'),
  entityIndexCore: read('src/services/entity-index-core.ts'),
  entityIndexService: read('src/services/entity-index-service.ts'),
  entityModal: read('src/modals/EntitySuggestModal.ts'),
  inlineDecoration: read('src/services/inline-property-decoration-service.ts'),
  inlineSuggest: read('src/services/inline-property-suggest.ts'),
  linkedSubitem: read('src/services/linked-subitem-checkbox-service.ts'),
  logBase: read('src/views/log-base-view.ts'),
  main: read('src/main.ts'),
  menuBuilder: read('src/menu/menu-builder.ts'),
  menuController: read('src/menu/menu-controller.ts'),
  panelBuilder: read('src/menu/panel-builder.ts'),
  pluginApi: read('src/plugin-api.ts'),
  propertyRow: read('src/services/property-row-service.ts'),
  settings: read('src/settings-tab.ts'),
  subitemLineModel: read('src/services/subitem-line-model.ts'),
  taskContext: read('src/services/task-line-context-menu-service.ts'),
  taskEditorProperties: read('src/services/task-editor-properties.ts'),
  tpsList: read('src/tps-list/views/TpsListView.ts'),
  types: read('src/types.ts'),
};

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('Kind is a first-class property identity and settings normalization migrates legacy Kind fields', () => {
  assert.match(
    sources.constants,
    /\{\s*id:\s*'kind',\s*label:\s*'Kind',\s*key:\s*'kind',\s*type:\s*'kind'[\s\S]*?allowInlineSet:\s*false\s*\}/,
  );
  assert.match(sources.types, /type:\s*'text'\s*\|[\s\S]*?\|\s*'kind';/);
  assert.match(sources.types, /acceptsKind\?:\s*string;/);
  assert.match(sources.main, /const CUSTOM_PROPERTY_TYPES = new Set\(\[[\s\S]*?'kind',[\s\S]*?\]\);/);

  const normalization = sourceBlock(
    sources.main,
    'private normalizeCustomProperties(',
    'private normalizeVirtualBaseEmbedProperties(',
  );
  assert.match(
    normalization,
    /\(normalizedKey === 'kind' \|\| normalizedId === 'kind'\) && normalizedType !== 'kind'[\s\S]*?\?\s*'kind'/,
    'a legacy property identified by key or id must migrate to the Kind type',
  );
  assert.match(normalization, /String\(normalized\.acceptsKind \|\| ''\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(
    normalization,
    /if \(normalized\.type === 'kind'\) \{\s*delete normalized\.acceptsKind;\s*normalized\.allowInlineSet = false;/,
    'Kind identity is configured separately from constrained reference properties',
  );
  assert.match(
    normalization,
    /if \(normalized\.acceptsKind\) normalized\.listItemType = 'link';/,
    'constrained lists must persist entity links rather than tags or free text',
  );

  assert.match(sources.settings, /\.addOption\('kind', 'Kind \(Entity identity\)'\)/);
  assert.match(sources.settings, /\.setName\('Accepts kind'\)/);
  assert.match(sources.settings, /only offers notes or lines registered with that Kind/);
  assert.match(sources.settings, /if \(acceptsKind && prop\.type === 'list'\) prop\.listItemType = 'link';/);
});

test('the generic entity index is configured from every Kind property and is exposed as a versioned public API', () => {
  const dimensionConfiguration = sourceBlock(
    sources.main,
    'private configureEntityIndexDimensions(',
    'isInMobileStartupGracePeriod(',
  );
  assert.match(dimensionConfiguration, /\.filter\(\(property\) => property\?\.type === 'kind'\)/);
  assert.match(dimensionConfiguration, /\.map\(\(property\) => String\(property\.key \|\| ''\)\.trim\(\)\)/);
  assert.match(dimensionConfiguration, /\{\s*name:\s*'kind',\s*propertyKeys\s*\}/);

  assert.match(sources.entityIndexCore, /export interface EntityIndexDimensionDefinition/);
  assert.match(sources.entityIndexCore, /export interface EntityIndexQuery/);
  assert.match(sources.entityIndexCore, /allOf\?:\s*EntityIndexFilter;/);
  assert.match(sources.entityIndexCore, /anyOf\?:\s*EntityIndexFilter;/);
  assert.match(sources.entityIndexCore, /noneOf\?:\s*EntityIndexFilter;/);
  assert.match(sources.entityIndexCore, /dimensions\?:\s*EntityIndexFilter;/);
  assert.match(sources.entityIndexService, /registerDimension\(definition: EntityIndexDimensionDefinition\): \(\) => void/);
  assert.match(sources.entityIndexService, /metadataCache\.on\('changed'/);
  assert.match(sources.entityIndexService, /vault\.on\('rename'/);

  const api = sourceBlock(sources.pluginApi, 'entityIndex: {', 'overlays: {');
  assert.match(api, /version:\s*2/);
  for (const method of [
    'query',
    'queryAsync',
    'ensureReady',
    'getById',
    'getByPath',
    'getByLocator',
    'getByReferenceTarget',
    'getBySourcePath',
    'materializeReference',
    'getDimensionValues',
    'getRevision',
    'onChanged',
    'registerDimension',
    'invalidate',
  ]) {
    assert.match(api, new RegExp(`\\b${method}\\s*:`), `api.entityIndex must expose ${method}`);
  }
});

test('the entity picker constrains choices to accepted Kind values and has no free-text escape hatch', () => {
  assert.match(
    sources.entityModal,
    /dimensions:\s*\{\s*kind:\s*\{\s*anyOf:\s*\[\.\.\.this\.acceptedKinds\]/,
  );
  assert.match(sources.entityModal, /this\.entityIndex\.queryAsync\(query\)/);
  assert.match(sources.entityModal, /await this\.entityIndex\.ensureReady\(\)/);
  assert.match(sources.entityModal, /this\.entityIndex\.materializeReference\(currentEntity\)/);
  assert.match(sources.entityModal, /buildEntityReferenceChoices\(await this\.queryAcceptedEntities\(\)\)/);
  assert.match(sources.entityModal, /every returned value is a canonical\s*\n\s*\* wikilink to a note or line/);
  assert.match(sources.entityModal, /entityMatchesAcceptedKinds\(resolvedEntity, this\.acceptedKinds\)/);
  assert.doesNotMatch(sources.entityModal, /TextInputModal|createNew|customValue|freeText/);
});

test('all major note, inline, task, linked-subitem, TPS List, and TPS Table editors route constrained properties through the entity picker', () => {
  const directPropertyRoutes = [
    ['badge renderer', sources.badgeRenderer],
    ['context menu builder', sources.menuBuilder],
    ['menu controller', sources.menuController],
    ['stacked panel', sources.panelBuilder],
    ['property row', sources.propertyRow],
    ['inline decoration', sources.inlineDecoration],
    ['linked subitem', sources.linkedSubitem],
    ['task context and quick editor', sources.taskContext],
    ['TPS List', sources.tpsList],
    ['TPS Table', sources.logBase],
  ];
  for (const [label, source] of directPropertyRoutes) {
    assert.match(source, /isEntityReferenceProperty/, `${label} must recognize acceptsKind`);
    assert.match(source, /openEntitySuggestModal/, `${label} must open the constrained picker`);
  }

  assert.match(sources.inlineSuggest, /acceptsKind\?:\s*string/);
  assert.match(sources.inlineSuggest, /if \(suggestion\.acceptsKind\)/);
  assert.match(sources.inlineSuggest, /openEntitySuggestModal\(this\.plugin\.app, this\.plugin, suggestion\.acceptsKind/);
  assert.match(sources.inlineSuggest, /property\.type === 'kind'\) return null/);
  assert.match(sources.subitemLineModel, /if \(isEntityReferenceProperty\(prop\)\)/);
  assert.match(sources.subitemLineModel, /parseLinkListInput\(this\.readFrontmatterValue\(fm, prop\.key\)\)/);
});

test('TPS Table constrained cells render when empty and isolate picker clicks from row selection and opening', () => {
  const renderEntry = sourceBlock(
    sources.logBase,
    'private renderEntry(',
    'private formatEntityCellValue(',
  );
  assert.match(renderEntry, /configuredProperty && isEntityReferenceProperty\(configuredProperty\)/);
  assert.match(renderEntry, /entry\.fields\[normalizeInlineKey\(configuredProperty\.key\)\] \?\? ''/);
  assert.match(renderEntry, /cell\.setText\(displayValue \|\| `\+ \$\{configuredProperty\.label \|\| column\.label\}`\)/);
  assert.match(renderEntry, /cell\.setAttr\('role', 'button'\)/);
  assert.match(renderEntry, /cell\.addEventListener\('pointerdown',[\s\S]*?event\.stopPropagation\(\)/);
  assert.match(
    renderEntry,
    /cell\.addEventListener\('click',[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?event\.stopImmediatePropagation\(\);[\s\S]*?this\.openEntityCellEditor/,
  );
  assert.match(renderEntry, /event\.key !== 'Enter' && event\.key !== ' '/);

  const editor = sourceBlock(
    sources.logBase,
    'private openEntityCellEditor(',
    'private renderGroupRow(',
  );
  assert.match(editor, /openEntitySuggestModal\(this\.plugin\.app, this\.plugin, property/);
  assert.match(editor, /mergeEntityReferenceList\(current, choice\.wikilink\)/);
  assert.match(editor, /:\s*choice\.wikilink/);
  assert.match(editor, /setLogInlineFieldValue\(line, property\.key, nextValue\)/);
});

test('TPS List renders empty constrained note and task properties as editable picker targets', () => {
  const noteProperties = sourceBlock(
    sources.tpsList,
    'private renderListNoteProperties(',
    'private isWritableNotePropertyId(',
  );
  assert.match(noteProperties, /const entityReference = isEntityReferenceProperty\(configuredProperty\)/);
  assert.match(noteProperties, /const typedEmptyTarget = entityReference/);
  assert.match(noteProperties, /if \(!value && !typedEmptyTarget\) continue;/);
  assert.match(noteProperties, /text:\s*value \|\| `\+ \$\{configuredProperty\?\.label \|\| propName\}`/);
  assert.match(noteProperties, /\.\.\.\(editable \? \{ role: 'button', tabindex: '0' \} : \{\}\)/);

  const taskRow = sourceBlock(
    sources.tpsList,
    'private createListTaskRow(',
    'private startListTaskPropertyEdit(',
  );
  assert.match(taskRow, /let property = this\.getTaskPropertyValue\(file, task, propId, hidden\)/);
  assert.match(taskRow, /if \(!property\) \{\s*const configuredProperty = this\.getConfiguredCustomProperty\(propId\)/);
  assert.match(taskRow, /if \(isEntityReferenceProperty\(configuredProperty\)\)/);
  assert.match(taskRow, /text:\s*`\+ \$\{configuredProperty\?\.label \|\| configuredProperty\?\.key \|\| propId\}`/);
  assert.match(taskRow, /kind:\s*'entity',\s*editable:\s*true/);
  assert.match(taskRow, /property\.editable \? \{ role: 'button', tabindex: '0' \} : \{\}/);

  const taskEditor = sourceBlock(
    sources.tpsList,
    'private startListTaskPropertyEdit(',
    'private startListNotePropertyEdit(',
  );
  const entityTaskMutation = sourceBlock(
    sources.tpsList,
    'private async applyEntityTaskProperty(',
    'private startListNotePropertyEdit(',
  );
  const noteEditor = sourceBlock(
    sources.tpsList,
    'private startListNotePropertyEdit(',
    'private startListPropertyInput(',
  );
  assert.match(taskEditor, /this\.openListTaskEntityPicker\(file, task, configuredProperty, gcm\)/);
  assert.match(taskEditor, /openEntitySuggestModal\(this\.app, source, property/);
  assert.match(taskEditor, /this\.applyEntityTaskProperty\(\s*file,\s*task\.line,\s*expectedLine,\s*property,\s*choice\.wikilink/);
  assert.match(entityTaskMutation, /resolveExactLineRevisionIndex\(parts\.lines, targetLine - 1, expectedLine\)/);
  assert.match(entityTaskMutation, /readInlineFieldValue\(currentLine, property\.key\)/);
  assert.match(entityTaskMutation, /mergeEntityReferenceList\(currentValue, wikilink\)/);
  assert.match(entityTaskMutation, /setLogInlineFieldValue\(currentLine, property\.key, nextValue\)/);
  assert.match(entityTaskMutation, /\$\{event\}:stale-target/);
  assert.match(noteEditor, /openEntitySuggestModal\(this\.app, gcm, configuredProperty/);
  assert.match(noteEditor, /fm\[actualKey\] = configuredProperty\.type === 'list'/);
});

test('Kind identity stays out of task editors while structural task kind remains read-only', async () => {
  const { collectTaskEditorProperties } = await importBundled('../src/services/task-editor-properties.ts');
  const descriptors = collectTaskEditorProperties(
    '- [ ] Ship it [kind:: project] [Projects:: [[Projects/Alpha]]]',
    [
      { id: 'kind', key: 'kind', label: 'Kind', type: 'kind' },
      {
        id: 'projects',
        key: 'Projects',
        label: 'Projects',
        type: 'list',
        listItemType: 'link',
        acceptsKind: 'project',
      },
    ],
  );
  assert.deepEqual(
    descriptors.map(({ key, type }) => ({ key, type })),
    [{ key: 'Projects', type: 'list' }],
  );

  assert.match(sources.taskEditorProperties, /property\.type === 'kind'/);
  assert.match(sources.taskContext, /\|\| property\.type === 'kind'/);

  const taskPropertyResolution = sourceBlock(
    sources.tpsList,
    'private getTaskPropertyValue(',
    'private normalizeTaskPropertyId(',
  );
  assert.match(
    taskPropertyResolution,
    /normalized === 'kind'[\s\S]*?return \{ text: kind, kind: 'kind', editable: false \};/,
  );
});

test('multi-wikilink inline values parse and replace atomically without damaging sibling fields or visible text', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const line = '- [ ] Ship alpha [Projects:: [[Projects/Alpha]], [[Projects/Beta|Beta launch]]] [status:: working]';

  assert.equal(
    metadata.readInlineFieldValue(line, 'projects'),
    '[[Projects/Alpha]], [[Projects/Beta|Beta launch]]',
  );
  assert.deepEqual(logLines.readInlineFields(line), {
    projects: '[[Projects/Alpha]], [[Projects/Beta|Beta launch]]',
    status: 'working',
  });
  assert.equal(logLines.visibleLineText(line), 'Ship alpha');

  const replaced = metadata.setInlineFieldValueOnLine(
    line,
    'Projects',
    '[[Projects/Gamma]], [[Projects/Delta|Delta launch]]',
  );
  assert.equal(
    metadata.readInlineFieldValue(replaced, 'projects'),
    '[[Projects/Gamma]], [[Projects/Delta|Delta launch]]',
  );
  assert.equal(metadata.readInlineFieldValue(replaced, 'status'), 'working');
  assert.doesNotMatch(replaced, /\[\[Projects\/Alpha\]\]/);
  assert.equal(logLines.visibleLineText(replaced), 'Ship alpha');

  const retitled = logLines.setVisibleLineText(replaced, 'Ship renamed');
  assert.equal(logLines.visibleLineText(retitled), 'Ship renamed');
  assert.equal(
    metadata.readInlineFieldValue(retitled, 'projects'),
    '[[Projects/Gamma]], [[Projects/Delta|Delta launch]]',
  );
  assert.equal(metadata.readInlineFieldValue(retitled, 'status'), 'working');

  const nested = '    - [ ] Keep  deliberate  spacing [Projects:: [[Projects/Alpha]]] [status:: working]';
  const nestedUpdated = logLines.setLogInlineFieldValue(
    nested,
    'Projects',
    '[[Projects/Beta|Beta launch]], [[Projects/Gamma]]',
  );
  assert.match(nestedUpdated, /^ {4}- \[ \] Keep  deliberate  spacing/u);
  assert.equal(metadata.readInlineFieldValue(nestedUpdated, 'status'), 'working');
  assert.equal(
    metadata.readInlineFieldValue(nestedUpdated, 'projects'),
    '[[Projects/Beta|Beta launch]], [[Projects/Gamma]]',
  );
  assert.match(nestedUpdated, /<!-- \[Projects:: \[\[Projects\/Beta\|Beta launch\]\], \[\[Projects\/Gamma\]\]\] -->$/u);
});
