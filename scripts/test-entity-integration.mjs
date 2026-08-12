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
  propertyChoiceMenu: read('src/menu/property-value-choice-menu.ts'),
  propertyOptionSource: read('src/utils/property-option-source.ts'),
  propertyRow: read('src/services/property-row-service.ts'),
  propertyValueModal: read('src/modals/PropertyValueSuggestModal.ts'),
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
  assert.match(sources.types, /optionSources\?:\s*PropertyOptionSource\[\]/);
  assert.match(sources.types, /PropertyOptionSource = 'manual' \| 'vault' \| 'entity'/);
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
  assert.match(
    normalization,
    /normalizeAcceptedKindSetting\(normalized\.acceptsKind\)/,
    'multiple accepted Kinds must normalize to the backward-compatible canonical string',
  );
  assert.match(
    normalization,
    /if \(normalized\.type === 'kind'\) \{\s*delete normalized\.acceptsKind;\s*normalized\.allowInlineSet = false;/,
    'Kind identity is configured separately from constrained reference properties',
  );
  assert.match(
    normalization,
    /normalized\.optionSources = normalizePropertyOptionSources\(normalized\)/,
    'legacy source settings must normalize to the composable source contract',
  );
  assert.match(
    normalization,
    /normalized\.acceptsKind[\s\S]*?normalized\.optionSources\.length === 1[\s\S]*?normalized\.optionSources\[0\] === 'entity'[\s\S]*?normalized\.listItemType = 'link'/,
    'entity-only lists must persist links without hardcoding mixed-source lists',
  );

  assert.match(sources.settings, /\.addOption\('kind', 'Kind \(Entity identity\)'\)/);
  assert.match(sources.settings, /\.setName\('Accepted kinds'\)/);
  assert.match(sources.settings, /separated by commas or new lines/);
  assert.match(sources.settings, /defaults this field to Entities only/);
  assert.match(sources.settings, /\.setName\('Value sources'\)/);
  assert.match(sources.settings, /\.addOption\('manual\+vault\+entity', 'Manual \+ vault \+ entities'\)/);
  assert.match(sources.settings, /prop\.type === 'list' && isEntityOnlyProperty\(prop\)/);
  assert.match(
    sources.propertyOptionSource,
    /hasAcceptedKind\(property\)[\s\S]*?property\?\.type !== 'kind'[\s\S]*?sources = \['entity'\]/,
    'legacy acceptsKind properties must retain their entity-only behavior',
  );
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
  assert.match(sources.entityIndexCore, /entityTypes\?:/);
  assert.match(sources.entityIndexCore, /lineKinds\?:/);
  assert.match(sources.entityIndexService, /registerDimension\(definition: EntityIndexDimensionDefinition\): \(\) => void/);
  assert.match(sources.entityIndexService, /metadataCache\.on\('changed'/);
  assert.match(sources.entityIndexService, /vault\.on\('rename'/);

  const api = sourceBlock(sources.pluginApi, 'entityIndex: {', 'overlays: {');
  assert.match(api, /version:\s*3/);
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
    /dimensions:\s*\{\s*kind:\s*\{\s*anyOf:\s*\[\.\.\.acceptedKinds\]/,
  );
  assert.match(sources.entityModal, /entityIndex\.queryAsync\(query\)/);
  assert.match(sources.entityModal, /await entityIndex\.ensureReady\(\)/);
  assert.match(sources.entityModal, /entityIndex\.materializeReference\(currentEntity\)/);
  assert.match(sources.entityModal, /buildEntityReferenceChoices\(await this\.queryAcceptedEntities\(\)\)/);
  assert.match(sources.entityModal, /every returned value is a canonical\s*\n\s*\* wikilink to a note or line/);
  assert.match(sources.entityModal, /entityMatchesAcceptedKinds\(resolvedEntity, acceptedKinds\)/);
  assert.doesNotMatch(sources.entityModal, /TextInputModal|createNew|customValue|freeText/);

  assert.match(sources.propertyValueModal, /propertyUsesManualOptions\(this\.property\)/);
  assert.match(sources.propertyValueModal, /getEffectivePropertyOptions\(this\.app, this\.property\)/);
  assert.match(sources.propertyValueModal, /propertyUsesEntityOptions\(this\.property\)/);
  assert.match(sources.propertyValueModal, /queryAcceptedEntityRecords\(this\.entityIndex, this\.acceptedKinds\)/);
  assert.match(
    sources.propertyValueModal,
    /resolveCurrentEntityReferenceChoice\(\s*this\.entityIndex,\s*this\.acceptedKinds,\s*item\.entity/,
    'combined pickers must revalidate entity choices before persisting their canonical wikilink',
  );
  assert.match(
    sources.propertyChoiceMenu,
    /if \(allowManual\)[\s\S]*?Set custom value…[\s\S]*?if \(allowEntities\)[\s\S]*?openEntitySuggestModal\(app, source, property/,
    'manual and entity choices are independently enabled by the property source contract',
  );
  assert.match(
    sources.propertyChoiceMenu,
    /normalizeAcceptsKind\(property\.acceptsKind\)[\s\S]*?acceptedKinds\.join\(' or '\)/,
    'context-menu picker titles must describe multi-Kind unions',
  );
});

test('list property editors expose a blank additive manual entry instead of editing the full current list', () => {
  assert.match(
    sources.propertyValueModal,
    /isList \? 'Add new list item…' : 'Set custom value…'/,
  );
  assert.match(
    sources.propertyValueModal,
    /isList \? '' : this\.currentValue/,
    'TPS List and entity-backed TPS Table pickers must start a new list item with a blank input',
  );
  assert.match(
    sources.propertyChoiceMenu,
    /setTitle\(isList \? 'Add new list item…' : 'Set custom value…'\)/,
  );
  assert.match(
    sources.propertyChoiceMenu,
    /isList \? '' : current/,
    'native TPS Table list menus must not prefill the editor with the serialized existing list',
  );
  assert.match(
    sources.propertyValueModal,
    /renderSuggestion\([\s\S]*?isCurrentListMember\(match\.item\)[\s\S]*?✓[\s\S]*?aria-selected[\s\S]*?private isCurrentListMember\(/,
    'the fuzzy add-value picker must identify values that are already members of the list',
  );
});

test('all major editors keep Kind constraints while combined surfaces expose manual, vault, and entity choices', () => {
  const combinedEntityRoutes = [
    ['badge renderer', sources.badgeRenderer],
    ['inline decoration', sources.inlineDecoration],
    ['linked subitem', sources.linkedSubitem],
  ];
  for (const [label, source] of combinedEntityRoutes) {
    assert.match(source, /isEntityReferenceProperty/, `${label} must recognize acceptsKind`);
    assert.match(source, /openPropertyValueSuggestModal/, `${label} must open the combined constrained picker`);
  }

  const combinedMenuRoutes = [
    ['context menu builder', sources.menuBuilder],
    ['task context menu', sources.taskContext],
    ['TPS Table', sources.logBase],
  ];
  for (const [label, source] of combinedMenuRoutes) {
    assert.match(source, /isEntityReferenceProperty|propertyUsesEntityOptions/, `${label} must recognize entity-backed properties`);
    assert.match(source, /addPropertyValueChoiceMenuItems/, `${label} must expose the combined source-aware menu`);
  }

  const combinedModalRoutes = [
    ['whole-note list editor', sources.menuController],
    ['stacked panel', sources.panelBuilder],
    ['property row', sources.propertyRow],
    ['inline property suggest', sources.inlineSuggest],
    ['TPS List', sources.tpsList],
  ];
  for (const [label, source] of combinedModalRoutes) {
    assert.match(source, /isEntityReferenceProperty|propertyUsesEntityOptions/, `${label} must recognize entity-backed properties`);
    assert.match(source, /openPropertyValueSuggestModal/, `${label} must expose the combined source-aware picker`);
  }

  assert.match(sources.inlineSuggest, /acceptsKind\?:\s*string/);
  assert.match(sources.inlineSuggest, /propertyUsesEntityOptions\(suggestion\.property\)/);
  assert.match(sources.inlineSuggest, /openPropertyValueSuggestModal\(this\.plugin\.app, this\.plugin, property/);
  assert.match(sources.inlineSuggest, /property\.type === 'kind'\) return null/);
  assert.match(sources.subitemLineModel, /if \(isEntityReferenceProperty\(prop\)\)/);
  assert.match(
    sources.subitemLineModel,
    /prop\.type === 'list' && !isLinkListProperty\(prop\)[\s\S]*?parseMixedListInput\(rawValue\)[\s\S]*?parseLinkListInput\(rawValue\)/,
    'entity-backed text lists preserve both literal and relational values while link-only lists stay canonical',
  );
});

test('TPS Table constrained cells render when empty and isolate picker clicks from row selection and opening', () => {
  const renderEntry = sourceBlock(
    sources.logBase,
    'private renderEntry(',
    'private renderConfiguredPropertyCell(',
  );
  const configuredRenderer = sourceBlock(
    sources.logBase,
    'private renderConfiguredPropertyCell(',
    'private formatConfiguredPropertyCellValue(',
  );
  const dispatcher = sourceBlock(
    sources.logBase,
    'private openConfiguredPropertyCellEditor(',
    'private openConfiguredPropertyValuePicker(',
  );
  const propertyValuePicker = sourceBlock(
    sources.logBase,
    'private openConfiguredPropertyValuePicker(',
    'private openChoiceCellEditor(',
  );
  const typedCell = sourceBlock(
    sources.logBase,
    'private configureTypedCell(',
    'private isTagColumn(',
  );

  assert.match(renderEntry, /if \(configuredProperty\) \{\s*this\.renderConfiguredPropertyCell\(cell, entry, column, configuredProperty\)/);
  assert.match(
    configuredRenderer,
    /property\.type === 'list'[\s\S]*?storedValues[\s\S]*?propertyUsesEntityOptions\(property\)[\s\S]*?entry\.fields\[normalizePropertyKeyIdentity\(property\.key\)\] \?\? ''/,
  );
  assert.match(configuredRenderer, /display \|\| `\+ \$\{property\.label \|\| column\.label\}`/);
  assert.match(configuredRenderer, /this\.openConfiguredPropertyCellEditor\(entry, column, property, cell\)/);
  assert.match(typedCell, /cell\.setAttr\('role', 'button'\)/);
  assert.match(typedCell, /cell\.addEventListener\('pointerdown',[\s\S]*?event\.stopPropagation\(\)/);
  assert.match(
    typedCell,
    /cell\.addEventListener\('click',[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?event\.stopImmediatePropagation\(\);[\s\S]*?activate\(\)/,
  );
  assert.match(typedCell, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(dispatcher, /propertyUsesEntityOptions\(property\)[\s\S]*?this\.openConfiguredPropertyValuePicker\(entry, property\)/);
  assert.match(propertyValuePicker, /openPropertyValueSuggestModal\(/);
  assert.match(
    propertyValuePicker,
    /property\.type === 'list'[\s\S]*?readInlineFieldCarrierValues\(entry\.line, property\.key\)\.join\(', '\)/,
    'TPS Table entity-backed list pickers must receive every repeated carrier',
  );
  assert.match(propertyValuePicker, /applyLogBasePropertyValueChoice\(line, property, choice\)/);
  assert.match(propertyValuePicker, /source: choice\.kind/);
});

test('TPS List renders empty constrained note and task properties as editable picker targets', () => {
  const noteProperties = sourceBlock(
    sources.tpsList,
    'private renderListNoteProperties(',
    'private isWritableNotePropertyId(',
  );
  assert.match(noteProperties, /const entityReference = [\s\S]*?isEntityReferenceProperty\(configuredProperty\)/);
  assert.match(noteProperties, /const typedEmptyTarget = Boolean\(configuredProperty\) \|\| editable/);
  assert.match(noteProperties, /if \(!value && !typedEmptyTarget\) continue;/);
  assert.match(noteProperties, /text:\s*displayValue \|\| `\+ \$\{propertyLabel\}`/);
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
    'private async openListTaskScalarEditor(',
  );
  const entityTaskPicker = sourceBlock(
    sources.tpsList,
    'private async openListTaskEntityPicker(',
    'private async resolveRenderedTaskLine(',
  );
  const taskMutation = sourceBlock(
    sources.tpsList,
    'private async mutateRenderedTaskLine(',
    'private async openListTaskTagPicker(',
  );
  const noteEditor = sourceBlock(
    sources.tpsList,
    'private startListNotePropertyEdit(',
    'private startListPropertyInput(',
  );
  assert.match(taskEditor, /this\.openListTaskEntityPicker\(file, task, configuredProperty, gcm\)/);
  assert.match(entityTaskPicker, /openPropertyValueSuggestModal\(this\.app, source, property, currentValue/);
  assert.match(
    entityTaskPicker,
    /property\.type === 'list'[\s\S]*?readInlineFieldCarrierValues\(expectedLine, property\.key\)\.join\(', '\)/,
    'entity-backed list pickers must receive every repeated carrier for selected-state rendering',
  );
  assert.match(
    entityTaskPicker,
    /applyLogBasePropertyValueChoice\(line, property, choice\)/,
    'task entity/list edits must share the aggregate, repeated-carrier-safe mutation path',
  );
  assert.match(taskMutation, /resolveExactLineRevisionIndex\(parts\.lines, targetLine - 1, expectedLine\)/);
  assert.match(taskMutation, /\$\{event\}:stale-target/);
  assert.match(noteEditor, /openPropertyValueSuggestModal\(\s*this\.app,\s*gcm,\s*configuredProperty/);
  assert.match(noteEditor, /choice\.kind === 'clear'[\s\S]*?delete fm\[actualKey\]/);
  assert.match(noteEditor, /choice\.kind === 'entity'[\s\S]*?mergeEntityReferenceList\(fm\[actualKey\], choice\.value\)/);
  assert.match(noteEditor, /fm\[actualKey\] = choice\.value/);
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
