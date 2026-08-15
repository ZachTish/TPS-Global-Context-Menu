import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
const logBase = read('src/views/log-base-view.ts');
const main = read('src/main.ts');
const taskLineContext = read('src/services/task-line-context-menu-service.ts');
const taskWorkflowMutation = read('src/utils/task-checkbox-workflow-mutation.ts');
const tpsList = read('src/tps-list/views/TpsListView.ts');
const tagModal = read('src/modals/TagSuggestModal.ts');
const propertyChoice = read('src/views/log-base-property-choice.ts');

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

test('known vault tags normalize, deduplicate case-insensitively, and sort', async () => {
  const { collectKnownVaultTags } = await importBundled('../src/utils/known-tags.ts');
  const app = {
    metadataCache: {
      getTags: () => ({
        '#CAFÉ': 3,
        '#café': 2,
        '#work/project': 4,
        '#HOME': 2,
        home: 1,
        '#qa/typed': 3,
        '#仕事': 2,
        '#bad@tag': 1,
        '#emoji🙂': 1,
        '#': 1,
      }),
    },
  };
  assert.deepEqual(
    collectKnownVaultTags(app),
    ['café', 'home', 'qa/typed', 'work/project', '仕事'],
  );
});

test('the tag chooser normalizer preserves Unicode current tags and rejects invalid tokens', async () => {
  const { normalizeTagValue, parseTagInput } = await importBundled('../src/utils/tag-utils.ts');
  const current = ['#CAFÉ', '#仕事', '#work/project', '#bad@tag', '#emoji🙂', '#']
    .map((tag) => normalizeTagValue(tag))
    .filter(Boolean);

  assert.deepEqual(current, ['café', '仕事', 'work/project']);
  assert.deepEqual(
    parseTagInput('#café #仕事 #WORK/Project'),
    ['café', '仕事', 'work/project'],
    'Unicode hashtag tokenization must not truncate or drop picker-compatible tags',
  );
  assert.equal(normalizeTagValue('#bad@tag'), '');
  assert.equal(normalizeTagValue('#emoji🙂'), '');
  assert.match(
    tagModal,
    /\.map\(\(tag\) => normalizeTagValue\(tag\)\.toLocaleLowerCase\(\)\)/,
    'current selections must use the behaviorally tested Unicode-aware normalizer',
  );
});

test('the Base tag chooser is a searchable vault list rather than a text property editor', () => {
  assert.match(tagModal, /extends FuzzySuggestModal<string>/);
  assert.match(tagModal, /Search vault tags/);
  assert.match(tagModal, /getItems\(\): string\[\]/);
  assert.match(tagModal, /Selected · choose to remove/);
  assert.match(tagModal, /purpose: 'toggle tag'/);
  assert.doesNotMatch(tagModal, /TextInputModal/);
});

test('TPS Table renders empty Tags and Scheduled cells as isolated typed controls', () => {
  const configuredRenderer = sourceBlock(
    logBase,
    'private renderConfiguredPropertyCell(',
    'private formatConfiguredPropertyCellValue(',
  );
  const typedCell = sourceBlock(
    logBase,
    'private configureTypedCell(',
    'private isTagColumn(',
  );

  assert.match(configuredRenderer, /this\.isTagColumn\(column, property\)/);
  assert.match(configuredRenderer, /this\.openTagCellEditor\(entry, property\.key\)/);
  assert.match(configuredRenderer, /this\.isDatetimeColumn\(column, property\)/);
  assert.match(configuredRenderer, /this\.openScheduledCellEditor\(entry, property\)/);
  assert.match(configuredRenderer, /display \|\| `\+ \$\{property\.label \|\| column\.label\}`/);
  assert.match(configuredRenderer, /current \|\| `\+ \$\{property\.label \|\| column\.label\}`/);
  assert.match(typedCell, /cell\.dataset\.tpsTableCellIntent = 'property'/);
  assert.match(typedCell, /cell\.setAttr\('role', 'button'\)/);
  assert.match(typedCell, /cell\.addEventListener\('pointerdown',[\s\S]*?event\.stopPropagation\(\)/);
  assert.match(typedCell, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(logBase, /new TagSuggestModal\(this\.plugin\.app, available/);
  assert.match(logBase, /toggleLogLineSemanticTag\(line, key, tag, selected\)/);
  assert.match(logBase, /new ScheduledModal\(this\.plugin\.app, current, timeEstimate, allDay/);
  assert.match(logBase, /setLogInlineFieldValue\(\s*next,\s*'timeEstimate'/);
  assert.match(logBase, /setLogInlineFieldValue\(\s*next,\s*'allDay'/);
});

test('TPS Table property cells own their click intent and configured selectors open a dropdown', () => {
  const renderEntry = sourceBlock(
    logBase,
    'private renderEntry(',
    'private renderConfiguredPropertyCell(',
  );
  const configuredRenderer = sourceBlock(
    logBase,
    'private renderConfiguredPropertyCell(',
    'private renderGenericInlinePropertyCell(',
  );
  const dispatcher = sourceBlock(
    logBase,
    'private openConfiguredPropertyCellEditor(',
    'private openConfiguredPropertyValuePicker(',
  );
  const propertyValuePicker = sourceBlock(
    logBase,
    'private openConfiguredPropertyValuePicker(',
    'private openChoiceCellEditor(',
  );
  const choiceEditor = sourceBlock(
    logBase,
    'private openChoiceCellEditor(',
    'private openCheckboxCellEditor(',
  );

  assert.match(logBase, /cell\.dataset\.tpsTableCellIntent = 'navigation'/);
  assert.match(logBase, /private configureTypedCell\([\s\S]*?cell\.dataset\.tpsTableCellIntent = 'property'/);
  assert.match(
    renderEntry,
    /if \(configuredProperty\) \{\s*this\.renderConfiguredPropertyCell\(cell, entry, column, configuredProperty\)/,
    'every configured column must be dispatched before any generic navigation cell',
  );
  assert.match(
    dispatcher,
    /propertyUsesEntityOptions\(property\)[\s\S]*?this\.openConfiguredPropertyValuePicker\(entry, property\)[\s\S]*?property\.type === 'selector' && this\.isTaskStatusSelector\(entry, property\)/,
    'entity-backed fields must reach the searchable picker before checkbox workflow status routing',
  );
  assert.match(dispatcher, /this\.openSelectorCellEditor\(entry, property, anchor\)/);
  assert.match(
    dispatcher,
    /property\.type === 'selector'[\s\S]*?property\.type === 'kind'[\s\S]*?this\.openChoiceCellEditor\(entry, property, anchor\)/,
  );
  assert.match(dispatcher, /property\.type === 'list'[\s\S]*?this\.openListCellEditor\(entry, property, anchor\)/);
  assert.match(dispatcher, /property\.type === 'checkbox'[\s\S]*?this\.openCheckboxCellEditor\(entry, property, anchor\)/);
  assert.match(dispatcher, /new TextInputModal\(/);
  assert.match(dispatcher, /property\.type === 'number' && next && !Number\.isFinite\(Number\(next\)\)/);
  assert.match(
    configuredRenderer,
    /const entityOptions = propertyUsesEntityOptions\(property\)[\s\S]*?!entityOptions && this\.isTagColumn\(column, property\)[\s\S]*?!entityOptions && this\.isDatetimeColumn\(column, property\)/,
    'entity sources must own the cell before legacy tag or datetime editors',
  );
  assert.match(
    propertyValuePicker,
    /openPropertyValueSuggestModal\([\s\S]*?this\.plugin\.app,[\s\S]*?this\.plugin,[\s\S]*?property,[\s\S]*?currentValue/,
    'TPS Table entity cells must open the combined searchable picker directly',
  );
  assert.match(
    propertyValuePicker,
    /this\.updateEntryLine\([\s\S]*?applyLogBasePropertyValueChoice\(line, property, choice\)/,
  );
  assert.match(
    propertyChoice,
    /choice\.kind === 'clear'[\s\S]*?property\.type !== 'list'[\s\S]*?choice\.kind === 'entity'[\s\S]*?mergeEntityReferenceList[\s\S]*?mergeMixedEntityReferenceList/,
    'entity-list choices must merge into the existing list rather than replace it as a scalar',
  );
  assert.match(choiceEditor, /addPropertyValueChoiceMenuItems\(\{/);
  assert.match(choiceEditor, /onChooseLiteral: \(value\) => this\.setConfiguredCellValue\(entry, property, value, 'literal'\)/);
  assert.match(choiceEditor, /onChooseEntity: \(choice\) => this\.setConfiguredCellValue\([\s\S]*?choice\.wikilink,[\s\S]*?'entity'/);
  assert.match(logBase, /taskLineContextMenuService\.openTaskStatusPicker\(/);
  assert.match(logBase, /sharedServices\?\.status\?\.getStatusPropertyKey\?\.\(\)/);
  assert.match(logBase, /normalizedId === 'status'/);
  assert.match(logBase, /target\?\.closest\('\[data-tps-table-cell-intent="property"\]'\)/);
  assert.match(main, /'\[data-tps-table-cell-intent="property"\]'/);
  assert.match(taskLineContext, /openTaskStatusPicker\(/);
  assert.match(taskLineContext, /this\.setTaskStatusCheckboxState\(line, mapping\.checkboxState\)/);
  assert.match(taskLineContext, /setTaskCheckboxWorkflowState\(/);
  assert.match(taskWorkflowMutation, /'taskStatus'/);
  assert.match(taskWorkflowMutation, /'task\.status'/);
  assert.match(taskWorkflowMutation, /'task\.checkboxStatus'/);
  assert.match(taskWorkflowMutation, /'checkboxStatus'/);
  assert.match(taskWorkflowMutation, /normalized === relationalStatusKey/);
  assert.match(taskLineContext, /status-picker:change/);
  assert.match(taskLineContext, /checkboxMutation:\s*true/);
  assert.match(taskLineContext, /handleExternalChecklistStateMutation\(/);
});

test('TPS Table combined picker choices execute clear, scalar replacement, and additive list storage', async () => {
  const { applyLogBasePropertyValueChoice } = await importBundled('../src/views/log-base-property-choice.ts');
  const { readInlineFields } = await importBundled('../src/views/log-line-utils.ts');
  const metadata = '%% tps-inline-props:{"createdDate":"2026-07-30 09:15:00"} %%';
  const linkListProperty = {
    id: 'projects',
    key: 'projects',
    label: 'Projects',
    type: 'list',
    listItemType: 'link',
    acceptsKind: 'project',
    optionSources: ['manual', 'entity'],
  };
  let line = `- [ ] Preserve relations [projects:: [[Projects/Alpha]], [[Projects/Two|Two, Inc.]]] [priority:: high] ${metadata} ^picker-row`;

  line = applyLogBasePropertyValueChoice(line, linkListProperty, {
    kind: 'entity',
    value: '[[Projects/Three|Three, LLC]]',
    label: 'Three, LLC',
    detail: 'Project',
    entity: {},
  });
  let fields = readInlineFields(line);
  assert.equal(
    fields.projects,
    '[[Projects/Alpha]], [[Projects/Two|Two, Inc.]], [[Projects/Three|Three, LLC]]',
  );
  assert.equal(fields.priority, 'high');
  assert.match(line, /"createdDate":"2026-07-30 09:15:00"/u);
  assert.match(line, /\^picker-row$/u);

  line = applyLogBasePropertyValueChoice(line, linkListProperty, {
    kind: 'literal',
    value: '[[Projects/Four|Four, Co.]]',
    label: 'Four, Co.',
    detail: 'Manual',
  });
  fields = readInlineFields(line);
  assert.equal(
    fields.projects,
    '[[Projects/Alpha]], [[Projects/Two|Two, Inc.]], [[Projects/Three|Three, LLC]], [[Projects/Four|Four, Co.]]',
  );

  const mixedListProperty = {
    ...linkListProperty,
    id: 'parents',
    key: 'parents',
    label: 'Parents',
    listItemType: 'text',
  };
  let mixed = `- [ ] Mixed parents [parents:: waiting, [[Projects/Alpha]]] ${metadata} ^mixed-row`;
  mixed = applyLogBasePropertyValueChoice(mixed, mixedListProperty, {
    kind: 'entity',
    value: '[[Areas/Home|Home, Area]]',
    label: 'Home, Area',
    detail: 'Area',
    entity: {},
  });
  assert.equal(
    readInlineFields(mixed).parents,
    'waiting, [[Projects/Alpha]], [[Areas/Home|Home, Area]]',
  );

  const scalarProperty = {
    id: 'owner',
    key: 'owner',
    label: 'Owner',
    type: 'text',
    acceptsKind: 'person',
    optionSources: ['entity'],
  };
  let scalar = '- [ ] Scalar owner [owner:: [[People/Alex]]] [priority:: medium] ^scalar-row';
  scalar = applyLogBasePropertyValueChoice(scalar, scalarProperty, {
    kind: 'entity',
    value: '[[People/Jules]]',
    label: 'Jules',
    detail: 'Person',
    entity: {},
  });
  assert.equal(readInlineFields(scalar).owner, '[[People/Jules]]');
  assert.equal(readInlineFields(scalar).priority, 'medium');

  const unchanged = applyLogBasePropertyValueChoice(scalar, scalarProperty, {
    kind: 'custom',
    value: '',
    label: 'Set custom value…',
    detail: 'Manual',
  });
  assert.equal(unchanged, scalar);

  scalar = applyLogBasePropertyValueChoice(scalar, scalarProperty, {
    kind: 'clear',
    value: '',
    label: '(none)',
    detail: 'Clear value',
  });
  assert.equal(readInlineFields(scalar).owner, undefined);
  assert.equal(readInlineFields(scalar).priority, 'medium');
  assert.match(scalar, /\^scalar-row$/u);
});

test('task.status remains the editable checkbox workflow column when bare status is relational', () => {
  const renderEntry = sourceBlock(
    logBase,
    'private renderEntry(',
    'private renderConfiguredPropertyCell(',
  );
  const statusResolver = sourceBlock(
    logBase,
    'private isExplicitTaskWorkflowStatusColumn(',
    'private openTagCellEditor(',
  );

  assert.match(
    renderEntry,
    /this\.isExplicitTaskWorkflowStatusColumn\(column\.key\)[\s\S]*?this\.createTaskWorkflowStatusProperty\(column\)[\s\S]*?: resolveConfiguredProperty/,
  );
  assert.match(statusResolver, /normalized === 'task\.status'/);
  assert.match(statusResolver, /normalized === 'checkboxstatus'/);
  assert.match(statusResolver, /id: 'task\.status'/);
  assert.match(statusResolver, /key: 'task\.status'/);
  assert.match(statusResolver, /sharedServices\?\.status\?\.getStatusOptions/);

  assert.match(tpsList, /const workflowStatusReference = this\.isStatusPropertyName\(propId\)/);
  assert.match(tpsList, /property\.kind === 'status' \|\| this\.isStatusPropertyName\(propName\)/);
  assert.match(tpsList, /openListTaskWorkflowStatusPicker/);
  assert.match(tpsList, /service\.openTaskStatusPicker/);
});

test('TPS Table gives arbitrary nonstructural columns a safe raw-value editor', () => {
  const renderEntry = sourceBlock(
    logBase,
    'private renderEntry(',
    'private renderConfiguredPropertyCell(',
  );
  const genericEditor = sourceBlock(
    logBase,
    'private renderGenericInlinePropertyCell(',
    'private getWritableInlineColumnKey(',
  );
  const writableResolver = sourceBlock(
    logBase,
    'private getWritableInlineColumnKey(',
    'private formatConfiguredPropertyCellValue(',
  );

  assert.match(
    renderEntry,
    /else if \(this\.getWritableInlineColumnKey\(column\.key\)\) \{\s*this\.renderGenericInlinePropertyCell\(cell, entry, column\)/,
    'an unregistered Base field must not fall through to note navigation',
  );
  assert.match(genericEditor, /this\.configureTypedCell\(/);
  assert.match(genericEditor, /display \|\| `\+ \$\{column\.label\}`/);
  assert.match(genericEditor, /new TextInputModal\(/);
  assert.match(genericEditor, /setLogInlineFieldValue\(line, propertyKey, next \|\| null\)/);
  assert.match(writableResolver, /\^\(\?:file\|formula\)\\\./);
  assert.match(writableResolver, /\^task\\\.\(\?:status\|checkboxstatus\)\$/);
  for (const structuralKey of ['title', 'path', 'line', 'kind', 'headinglevel', 'open', 'done', 'checkboxstatus']) {
    assert.match(writableResolver, new RegExp(`'${structuralKey}'`));
  }
});

test('empty Accepted-Kind TPS Table cells stay property-owned and open the entity picker', () => {
  const renderEntry = sourceBlock(
    logBase,
    'private renderEntry(',
    'private renderConfiguredPropertyCell(',
  );
  const configuredRenderer = sourceBlock(
    logBase,
    'private renderConfiguredPropertyCell(',
    'private formatConfiguredPropertyCellValue(',
  );
  const dispatcher = sourceBlock(
    logBase,
    'private openConfiguredPropertyCellEditor(',
    'private openConfiguredPropertyValuePicker(',
  );
  const propertyValuePicker = sourceBlock(
    logBase,
    'private openConfiguredPropertyValuePicker(',
    'private openChoiceCellEditor(',
  );

  assert.match(
    renderEntry,
    /if \(configuredProperty\) \{\s*this\.renderConfiguredPropertyCell\(cell, entry, column, configuredProperty\)/,
    'an empty configured field must never fall through to row navigation',
  );
  assert.match(
    configuredRenderer,
    /propertyUsesEntityOptions\(property\)[\s\S]*?entry\.fields\[normalizePropertyKeyIdentity\(property\.key\)\] \?\? ''/,
    'entity-backed fields must read the stored field rather than a synthetic query value',
  );
  assert.match(
    configuredRenderer,
    /display \|\| `\+ \$\{property\.label \|\| column\.label\}`[\s\S]*?this\.openConfiguredPropertyCellEditor\(entry, column, property, cell\)/,
  );
  assert.match(
    dispatcher,
    /propertyUsesEntityOptions\(property\)[\s\S]*?this\.openConfiguredPropertyValuePicker\(entry, property\)/,
  );
  assert.match(
    propertyValuePicker,
    /openPropertyValueSuggestModal\([\s\S]*?applyLogBasePropertyValueChoice\(line, property, choice\)/,
    'mixed manual, vault, and entity sources must share one searchable source-aware dropdown',
  );
  assert.match(
    logBase,
    /target\?\.closest\('\[data-tps-table-cell-intent="property"\]'\)[\s\S]*?evt\.preventDefault\(\)[\s\S]*?evt\.stopPropagation\(\)[\s\S]*?return/,
  );
  assert.match(
    main,
    /private isBaseLinkPreviewExcludedTarget\([\s\S]*?'\[data-tps-table-cell-intent="property"\]'/,
  );
});

test('TPS Table selector mutations preserve line identity and sibling fields', async () => {
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  let line = '- [ ] Ship selector fix [tpsId:: selector-row] <!-- [contexts:: [[Contexts/Home]]] --> ^selector-row';

  line = logLines.setLogInlineFieldValue(line, 'priority', 'high');

  assert.match(line, /^- \[ \] Ship selector fix/u);
  assert.equal(logLines.readInlineFields(line).priority, 'high');
  assert.equal(logLines.readInlineFields(line).tpsid, 'selector-row');
  assert.equal(logLines.readInlineFields(line).contexts, '[[Contexts/Home]]');
  assert.match(line, /\^selector-row$/u);
});

test('task Status selection clears every checkbox-owned carrier while preserving relational status', async () => {
  const mutation = await importBundled('../src/utils/task-checkbox-workflow-mutation.ts');
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const source = '- [ ] Finish selector QA [workflowStatus:: holding] [taskStatus:: legacy] [status:: [[Statuses/Holding]]] [task.status:: holding] [task.checkboxStatus:: holding] [checkboxStatus:: holding] [priority:: high] `[task.status:: sample]` ^selector-status';

  const line = mutation.setTaskCheckboxWorkflowState(source, '[x]', {
    workflowStatusKey: 'workflowStatus',
    relationalStatusKey: 'status',
  });

  assert.match(line, /^- \[x\] Finish selector QA/u);
  assert.equal(metadata.readInlineFieldValue(line, 'workflowStatus'), '');
  assert.equal(metadata.readInlineFieldValue(line, 'taskStatus'), '', 'a renamed workflow key must not leave its legacy carrier behind');
  assert.equal(metadata.readInlineFieldValue(line, 'status'), '[[Statuses/Holding]]');
  assert.equal(metadata.readInlineFieldValue(line, 'task.status'), '');
  assert.equal(metadata.readInlineFieldValue(line, 'task.checkboxStatus'), '');
  assert.equal(metadata.readInlineFieldValue(line, 'checkboxStatus'), '');
  assert.equal(metadata.readInlineFieldValue(line, 'priority'), 'high');
  assert.match(line, /`\[task\.status:: sample\]`/u);
  assert.match(line, /\^selector-status$/u);
});

test('TPS List renders empty typed cells and routes task and note edits through native pickers', () => {
  assert.match(tpsList, /const typedEmptyTarget = Boolean\(configuredProperty\) \|\| editable/);
  assert.match(tpsList, /if \(!value && !typedEmptyTarget\) continue/);
  assert.match(
    tpsList,
    /configuredProperty[\s\S]*?text: `\+ \$\{configuredProperty\.label \|\| configuredProperty\.key \|\| propId\}`[\s\S]*?editable: true/,
    'all configured empty task properties must remain editable targets',
  );
  assert.match(tpsList, /openPropertyValueSuggestModal\(this\.app, source, property, currentValue/);
  assert.match(tpsList, /openPropertyValueSuggestModal\(\s*this\.app,\s*gcm,\s*configuredProperty/);
  assert.match(tpsList, /this\.isTagProperty\(configuredProperty, propId\)/);
  assert.match(tpsList, /this\.isDatetimeProperty\(configuredProperty, propId\)/);
  assert.match(tpsList, /this\.openListTaskTagPicker\(file, task/);
  assert.match(tpsList, /this\.openListTaskScheduledPicker\(/);
  assert.match(
    tpsList,
    /const writablePropertyName = this\.getWritableTaskPropertyName\(propId\)[\s\S]*?kind: 'text'[\s\S]*?editable: true[\s\S]*?propName: writablePropertyName/,
    'empty unregistered writable columns must expose a generic line-field editor',
  );
  assert.match(
    tpsList,
    /configuredProperty\?\.type === 'list'[\s\S]*?this\.openListTaskListEditor\(span, file, task, configuredProperty\)/,
    'configured task lists must expose additive selection plus per-value removal',
  );
  assert.match(
    tpsList,
    /configuredProperty[\s\S]*?configuredProperty\.type === 'list'[\s\S]*?this\.openListNoteListEditor\(span, file, writableProp, rawValue, configuredProperty\)/,
    'configured note lists must expose additive selection plus per-value removal',
  );
  assert.match(
    tpsList,
    /private getWritableTaskPropertyName\([\s\S]*?lower\.startsWith\('file\.'\)[\s\S]*?lower\.startsWith\('formula\.'\)/,
  );
  assert.match(tpsList, /new TagSuggestModal\(this\.app, \[\.\.\.collectKnownVaultTags\(this\.app\), \.\.\.current\]/);
  assert.match(tpsList, /toggleLogLineSemanticTag\(line, propertyKey, tag, selected\)/);
  assert.match(tpsList, /new ScheduledModal\(this\.app, current, timeEstimate, allDay/);
  const taskEditor = sourceBlock(
    tpsList,
    'private startListTaskPropertyEdit(',
    'private async openListTaskWorkflowStatusPicker(',
  );
  assert.match(
    taskEditor,
    /const configuredProperty = this\.getConfiguredCustomProperty\(propName\)[\s\S]*?task\.itemKind !== 'heading'[\s\S]*?!propertyUsesEntityOptions\(configuredProperty\)[\s\S]*?this\.openListTaskWorkflowStatusPicker/,
    'a relational bare status must bypass the checkbox workflow picker',
  );
  const noteEditor = sourceBlock(
    tpsList,
    'private startListNotePropertyEdit(',
    'private startListPropertyInput(',
  );
  for (const [label, editor] of [['task', taskEditor], ['note', noteEditor]]) {
    assert.ok(
      editor.indexOf('this.isTagProperty(') < editor.indexOf("configuredProperty?.type === 'list'"),
      `${label} tag lists must keep the vault tag picker ahead of the generic list picker`,
    );
    assert.ok(
      editor.indexOf('this.isDatetimeProperty(') < editor.indexOf("configuredProperty?.type === 'list'"),
      `${label} datetime fields must keep the scheduled picker ahead of the generic list picker`,
    );
  }
  assert.match(tpsList, /resolveExactLineRevisionIndex\(parts\.lines, targetLine - 1, expectedLine\)/);
  assert.match(tpsList, /source line changed while the property picker was open/);
  assert.match(
    tpsList,
    /applyLogBasePropertyValueChoice\(line, property, choice\)[\s\S]*?addLogBaseListPropertyValue\([\s\S]*?removeLogBaseListPropertyValue\(line, property, value\)/,
    'the combined picker must clear, replace scalar values, and add list values through the exact-line mutation',
  );
  assert.match(tpsList, /collectTpsListInlineFields\(text\)/);
  assert.doesNotMatch(tpsList, /mergeEntityReferenceList\(fm\[actualKey\] \?\? rawValue/);
});

test('TPS List and TPS Table give recurrence, snooze, and folder fields canonical typed behavior', () => {
  const tableRenderer = sourceBlock(
    logBase,
    'private renderConfiguredPropertyCell(',
    'private renderTableBooleanCell(',
  );
  const tableDispatcher = sourceBlock(
    logBase,
    'private openConfiguredPropertyCellEditor(',
    'private openConfiguredPropertyValuePicker(',
  );
  const tableRecurrence = sourceBlock(
    logBase,
    'private openRecurrenceCellEditor(',
    'private openSelectorCellEditor(',
  );
  assert.match(tableRenderer, /property\.type === 'folder'[\s\S]*?entry\.file\.parent\?\.path \|\| '\/'[\s\S]*?tpsTableCellIntent = 'source-folder'/u);
  assert.match(tableDispatcher, /property\.type === 'recurrence'[\s\S]*?openRecurrenceCellEditor\(entry, property\)/u);
  assert.match(tableDispatcher, /property\.type === 'folder'\) return/u);
  assert.match(logBase, /property\?\.type === 'datetime'[\s\S]{0,100}property\?\.type === 'snooze'/u);
  assert.match(tableRecurrence, /new RecurrenceModal\([\s\S]*?setConfiguredCellValue\(entry, property, rule \|\| null, 'recurrence'\)[\s\S]*?showEndsOn: false/u);

  const listTaskDispatcher = sourceBlock(
    tpsList,
    'private startListTaskPropertyEdit(',
    'private async openListTaskWorkflowStatusPicker(',
  );
  const listRecurrence = sourceBlock(
    tpsList,
    'private async openListTaskRecurrencePicker(',
    'private startListNotePropertyEdit(',
  );
  const listNoteDispatcher = sourceBlock(
    tpsList,
    'private startListNotePropertyEdit(',
    'private startListPropertyInput(',
  );
  assert.match(tpsList, /configuredForProperty\?\.type === 'folder'[\s\S]*?text: folder[\s\S]*?editable: false/u);
  assert.match(tpsList, /sourceFolderProperty = configuredProperty\?\.type === 'folder'/u);
  assert.match(tpsList, /noteRecurrenceProperty = configuredProperty\?\.type === 'recurrence'/u);
  assert.match(
    tpsList,
    /displayValue = noteRecurrenceProperty && !value \? 'Not recurring' : value/u,
    'an unset whole-note recurrence must not look like an editable add-property affordance',
  );
  assert.match(
    tpsList,
    /Recurrence is read-only in GCM; edit the note frontmatter property directly/u,
    'TPS List must explain the same whole-note recurrence policy as canonical GCM',
  );
  assert.match(
    tpsList,
    /noteRecurrenceProperty \? ' tps-list-native-property--readonly' : ''/u,
  );
  assert.match(listTaskDispatcher, /configuredProperty\?\.type === 'recurrence'[\s\S]*?openListTaskRecurrencePicker/u);
  assert.match(listTaskDispatcher, /configuredProperty\?\.type === 'folder'\) return/u);
  assert.match(listRecurrence, /new RecurrenceModal\([\s\S]*?mutateRenderedTaskLine\([\s\S]*?'recurrence-update'[\s\S]*?showEndsOn: false/u);
  assert.match(listNoteDispatcher, /configuredProperty\?\.type === 'folder' \|\| configuredProperty\?\.type === 'recurrence'/u);
  assert.match(listNoteDispatcher, /configuredProperty\?\.type === 'snooze'[\s\S]*?menuController\.openSnoozeModal/u);
  assert.match(tpsList, /property\?\.type === 'datetime'[\s\S]{0,100}property\?\.type === 'snooze'/u);
});

test('TPS List generic note edits preserve the live frontmatter value type', () => {
  const noteEditor = sourceBlock(
    tpsList,
    'private startListNotePropertyEdit(',
    'private startListPropertyInput(',
  );
  const coercer = sourceBlock(
    tpsList,
    'private coerceUnconfiguredFrontmatterValue(',
    'private formatEntityPropertyValue(',
  );

  assert.match(
    noteEditor,
    /processFrontmatter\(file, \(fm\) => \{[\s\S]*?const actualKey = this\.findFrontmatterKeyCaseInsensitive\(fm, writableProp\) \|\| writableProp;[\s\S]*?const currentValue = fm\[actualKey\]/,
    'the editor must re-read the current value inside the owned frontmatter transaction',
  );
  assert.match(
    noteEditor,
    /else if \(!configuredProperty\) \{\s*fm\[actualKey\] = this\.coerceUnconfiguredFrontmatterValue\(currentValue, nextValue\)/,
    'only unconfigured fields should infer their stored type from the live value',
  );
  assert.match(coercer, /Array\.isArray\(currentValue\)[\s\S]*?parseMixedListInput\(trimmed\)/);
  assert.match(coercer, /existingValues\.every\(\(value\) => typeof value === 'number'\)/);
  assert.match(coercer, /existingValues\.every\(\(value\) => typeof value === 'boolean'\)/);
  assert.match(coercer, /existingValues\.every\(\(value\) => value instanceof Date\)/);
  assert.match(coercer, /typeof currentValue === 'boolean'[\s\S]*?this\.parseEditableBoolean\(trimmed\)/);
  assert.match(coercer, /typeof currentValue === 'number'[\s\S]*?Number\(trimmed\)/);
  assert.match(coercer, /currentValue instanceof Date[\s\S]*?this\.parseEditableDate\(trimmed\)/);
  assert.match(coercer, /private parseEditableBoolean\([\s\S]*?\^\(\?:false\|no\|0\|off\)\$/);
  assert.match(coercer, /private parseEditableDate\([\s\S]*?Number\.isNaN\(parsed\.getTime\(\)\)/);
  assert.match(
    coercer,
    /if \(currentValue instanceof Date\)[\s\S]*?return trimmed/,
    'date-looking strings must remain strings while Date objects remain Date objects',
  );
});

test('TPS List heading cells keep populated and empty writable properties editable', async () => {
  const propertyResolver = sourceBlock(
    tpsList,
    'private getTaskPropertyValue(',
    'private normalizeTaskPropertyId(',
  );
  const headingRenderer = sourceBlock(
    tpsList,
    'private createListHeadingRow(',
    'private createListTaskRow(',
  );
  const lineResolver = sourceBlock(
    tpsList,
    'private async resolveRenderedTaskLine(',
    'private async mutateRenderedTaskLine(',
  );
  const lineMutator = sourceBlock(
    tpsList,
    'private async mutateRenderedTaskLine(',
    'private async openListTaskTagPicker(',
  );

  assert.doesNotMatch(
    propertyResolver,
    /editable: task\.itemKind !== 'heading'/,
    'existing heading tags and inline fields must not be rendered inert',
  );
  assert.match(
    headingRenderer,
    /const configuredProperty = this\.getConfiguredCustomProperty\(propId\)[\s\S]*?editable: true[\s\S]*?const writablePropertyName = this\.getWritableTaskPropertyName\(propId\)[\s\S]*?kind: 'text'[\s\S]*?editable: true/,
    'empty configured and unregistered heading fields must render an editable target',
  );
  assert.match(
    headingRenderer,
    /tps-list-native-property--editable[\s\S]*?role: 'button', tabindex: '0'/,
    'heading property cells must expose keyboard-operable button semantics',
  );
  assert.match(
    headingRenderer,
    /addEventListener\('pointerdown'[\s\S]*?event\.stopPropagation\(\)[\s\S]*?addEventListener\('click'[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?startListTaskPropertyEdit/,
    'heading property pointers must remain property-owned instead of opening the note',
  );
  assert.match(
    headingRenderer,
    /addEventListener\('keydown'[\s\S]*?event\.key !== 'Enter' && event\.key !== ' '[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?startListTaskPropertyEdit/,
    'Enter and Space must open the heading property editor without bubbling to row navigation',
  );
  assert.match(
    lineResolver,
    /task\.itemKind === 'heading'[\s\S]*?parseTpsListHeadingLine\(line\)[\s\S]*?this\.parseLineItem\(line, true\)/,
  );
  assert.match(
    lineMutator,
    /const expectedIsHeading = parseTpsListHeadingLine\(expectedLine\) != null[\s\S]*?expectedIsHeading[\s\S]*?parseTpsListHeadingLine\(currentLine\) != null/,
    'stale-safe inline mutations must accept headings while still checking structural identity',
  );

  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const heading = '# Release QA [qaValue:: before] [contexts:: [[Contexts/Mobile]]] ^heading-edit';
  const updated = logLines.setLogInlineFieldValue(heading, 'qaValue', 'after');
  const added = logLines.setLogInlineFieldValue(updated, 'priority', 'high');

  assert.match(added, /^# Release QA/u);
  assert.equal(logLines.readInlineFields(added).qavalue, 'after');
  assert.equal(logLines.readInlineFields(added).contexts, '[[Contexts/Mobile]]');
  assert.equal(logLines.readInlineFields(added).priority, 'high');
  assert.match(added, /\^heading-edit$/u);
});

test('typed task mutations preserve sibling hidden fields through a full entity, tag, and schedule sequence', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  let line = '- [ ] QA Typed [tpsId:: qa-typed] <!-- [priority:: high] -->';

  line = logLines.setLogInlineFieldValue(
    line,
    'projects',
    '[[Projects/Alpha]], [[Entities#^project-line|Project line]]',
  );
  line = logLines.setLogInlineFieldValue(
    line,
    'contexts',
    '[[Contexts/Home]]',
  );
  line = logLines.setLogInlineFieldValue(line, 'tags', '#qa/typed');
  line = logLines.setLogInlineFieldValue(line, 'scheduled', '2026-08-15 09:30:00');
  line = logLines.setLogInlineFieldValue(line, 'timeEstimate', '45');
  line = logLines.setLogInlineFieldValue(line, 'allDay', null);

  assert.equal(metadata.getTaskDisplayTitle(line), 'QA Typed');
  assert.equal(metadata.readInlineFieldValue(line, 'tpsId'), 'qa-typed');
  assert.equal(metadata.readInlineFieldValue(line, 'priority'), 'high');
  assert.equal(
    metadata.readInlineFieldValue(line, 'projects'),
    '[[Projects/Alpha]], [[Entities#^project-line|Project line]]',
  );
  assert.equal(metadata.readInlineFieldValue(line, 'contexts'), '[[Contexts/Home]]');
  assert.equal(metadata.readInlineFieldValue(line, 'scheduled'), '2026-08-15 09:30:00');
  assert.equal(metadata.readInlineFieldValue(line, 'timeEstimate'), '45');
  assert.deepEqual(metadata.readTaskLineTags(line), ['qa/typed']);
  assert.equal(metadata.readInlineFieldValue(line, 'allDay'), '');
});

test('TPS List preserves hidden multi-link fields through its parse-to-render property model', async () => {
  const { collectTpsListInlineFields } = await importBundled(
    '../src/tps-list/task-inline-property-fields.ts',
  );
  const fields = collectTpsListInlineFields(
    '- [ ] QA row [tpsId:: qa-row] <!-- [projects:: [[Projects/Alpha]], [[Entities/Registry#^project-line|Project line]]] [contexts:: [[Contexts/Home]]] [tags:: #home #work] [scheduled:: 2026-08-15 09:30:00] [timeEstimate:: 45] --> ^qa-row',
  );
  const byKey = new Map(fields.map((field) => [field.key.toLocaleLowerCase(), field.value]));

  assert.equal(
    byKey.get('projects'),
    '[[Projects/Alpha]], [[Entities/Registry#^project-line|Project line]]',
  );
  assert.equal(byKey.get('contexts'), '[[Contexts/Home]]');
  assert.equal(byKey.get('tags'), '#home #work');
  assert.equal(byKey.get('scheduled'), '2026-08-15 09:30:00');
  assert.equal(byKey.get('timeestimate'), '45');
  assert.equal(byKey.get('tpsid'), 'qa-row');
});

test('tag lists accept whitespace or comma storage without dropping existing tags', async () => {
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  assert.deepEqual(logLines.readLogLineTags('#home #work'), ['home', 'work']);
  assert.deepEqual(logLines.readLogLineTags('#home, #work'), ['home', 'work']);
  assert.equal(logLines.addLogLineTag('#home #work', 'new'), '#home, #work, #new');
  assert.equal(logLines.removeLogLineTag('#home #work', 'home'), '#work');
});

test('built-in Base Tags cells render the complete semantic task tag set', async () => {
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const line = '- [ ] QA tags #visible <!-- [tags:: #hidden] [topicTags:: #isolated] -->';

  assert.deepEqual(
    logLines.readLogLinePropertyTags(line, 'tags', '#hidden'),
    ['visible', 'hidden'],
  );
  assert.deepEqual(
    logLines.readLogLinePropertyTags(line, 'tag', '#hidden'),
    ['visible', 'hidden'],
  );
  assert.deepEqual(
    logLines.readLogLinePropertyTags(line, 'topicTags', '#isolated'),
    ['isolated'],
    'a custom tag field must not absorb unrelated task hashtags',
  );
  assert.match(logBase, /readLogLinePropertyTags\(\s*entry\.line,/);
});

test('TPS List keeps visible and hidden tags together without duplicate display values', async () => {
  const { collectTpsListInlineFields } = await importBundled(
    '../src/tps-list/task-inline-property-fields.ts',
  );
  const fields = collectTpsListInlineFields(
    '- [ ] QA list tags #visible #same <!-- [tags:: #hidden, #same] -->',
  );
  const semanticTags = fields
    .filter((field) => /^(?:tag|tags)$/iu.test(field.key))
    .flatMap((field) => field.value.match(/#[\p{L}\p{N}_/-]+/gu) || []);

  assert.deepEqual(semanticTags, ['#hidden', '#same', '#visible']);
  assert.match(tpsList, /Array\.from\(new Set\(values\.map\(\(value\) => value\.trim\(\)\)\.filter\(Boolean\)\)\)/);
});

test('TPS Table semantic tag toggle removes raw hashtags and persists add/remove through its row mutation path', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const originalLine = '- [ ] QA Table tags #home <!-- [tags:: #work] [tpsId:: qa-table-tags] --> ^qa-table-tags';
  const entry = {
    lineNumber: 0,
    line: originalLine,
    fields: { tpsid: 'qa-table-tags', tags: '#work' },
  };
  const removed = logLines.mutateLogLineContent(
    `${originalLine}\n`,
    entry,
    (line) => logLines.toggleLogLineSemanticTag(line, 'tags', 'home', true),
  );

  assert.equal(removed.outcome, 'changed');
  const removedLine = removed.content.trimEnd();
  assert.deepEqual(metadata.readTaskLineTags(removedLine), ['work']);
  assert.doesNotMatch(removedLine, /(?:^|[ \t])#home(?:$|[ \t])/u);
  assert.equal(metadata.readInlineFieldValue(removedLine, 'tpsId'), 'qa-table-tags');
  assert.match(removedLine, /\^qa-table-tags$/u);

  const restored = logLines.mutateLogLineContent(
    removed.content,
    entry,
    (line) => logLines.toggleLogLineSemanticTag(line, 'tags', 'home', false),
  );
  assert.equal(restored.outcome, 'changed', 'stable tpsId resolves the row after its first mutation');
  assert.deepEqual(metadata.readTaskLineTags(restored.content.trimEnd()), ['work', 'home']);
  assert.equal(metadata.readInlineFieldValue(restored.content, 'tpsId'), 'qa-table-tags');
});

test('TPS Table comma-tag creation is atomic, deduped, and preserves protected metadata', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const original = '- [ ] QA Table multi-tags #existing <!-- [tpsId:: qa-table-multi] --> ^qa-table-multi';
  const updated = logLines.addLogLineSemanticTags(original, 'tags', 'One, two, #ONE');

  assert.deepEqual(metadata.readTaskLineTags(updated), ['existing', 'one', 'two']);
  assert.equal(metadata.readInlineFieldValue(updated, 'tpsId'), 'qa-table-multi');
  assert.match(updated, /\^qa-table-multi$/u);
  assert.equal(logLines.addLogLineSemanticTags(updated, 'tags', 'TWO, one'), updated);
});

test('TPS List semantic tag toggle preserves nested layout while removing raw and hidden tags', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const lineItems = await importBundled('../src/utils/line-item-deletion.ts');
  const originalLine = '    - [ ] QA  List tags #home <!-- [tags:: #work] [tpsId:: qa-list-tags] --> ^qa-list-tags';
  let content = `Parent\n${originalLine}\n`;

  const mutateLikeTpsList = (expectedLine, tag, selected) => {
    const parts = lineItems.splitLineItemContent(content);
    const index = lineItems.resolveExactLineRevisionIndex(parts.lines, 1, expectedLine);
    assert.notEqual(index, -1);
    parts.lines[index] = logLines.toggleLogLineSemanticTag(
      parts.lines[index],
      'tags',
      tag,
      selected,
    );
    content = `${parts.lines.join(parts.newline)}${parts.endsWithNewline ? parts.newline : ''}`;
    return parts.lines[index];
  };

  const removedHome = mutateLikeTpsList(originalLine, 'home', true);
  assert.match(removedHome, /^ {4}- \[ \] QA  List tags/u);
  assert.deepEqual(metadata.readTaskLineTags(removedHome), ['work']);
  assert.equal(metadata.readInlineFieldValue(removedHome, 'tpsId'), 'qa-list-tags');
  assert.match(removedHome, /\^qa-list-tags$/u);

  const removedWork = mutateLikeTpsList(removedHome, 'work', true);
  assert.deepEqual(metadata.readTaskLineTags(removedWork), []);
  assert.equal(metadata.readInlineFieldValue(removedWork, 'tags'), '');
  assert.equal(metadata.readInlineFieldValue(removedWork, 'tpsId'), 'qa-list-tags');

  const restoredHome = mutateLikeTpsList(removedWork, 'home', false);
  assert.deepEqual(metadata.readTaskLineTags(restoredHome), ['home']);
  assert.equal(metadata.readInlineFieldValue(restoredHome, 'tpsId'), 'qa-list-tags');
});

test('semantic tag canonicalization merges singular and plural carriers without touching protected metadata', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const payload = '%% tps-inline-props:{"externalId":"remote","memo":"keep #protected [tag:: ghost] exactly"} %%';
  const original = `    - [ ] QA  canonical #home [tag:: work] [tags:: #other] [project:: #unrelated] ${payload} ^qa-canonical`;

  assert.deepEqual(
    metadata.readTaskLineTags(original),
    ['home', 'work', 'other'],
    'protected JSON and unrelated inline fields are not semantic task tags',
  );

  const withoutWork = logLines.toggleLogLineSemanticTag(original, 'tags', 'work', true);
  assert.match(withoutWork, /^ {4}- \[ \] QA  canonical #home/u);
  assert.deepEqual(metadata.readTaskLineTags(withoutWork), ['home', 'other']);
  assert.doesNotMatch(withoutWork, /\[tag:: work\]/u);
  assert.equal(metadata.readInlineFieldValue(withoutWork, 'tags'), '#home, #other');
  assert.equal(metadata.readInlineFieldValue(withoutWork, 'project'), '#unrelated');
  assert.ok(withoutWork.includes(payload), 'the protected carrier remains byte-identical');
  assert.match(withoutWork, /\^qa-canonical$/u);

  const withoutHome = logLines.toggleLogLineSemanticTag(withoutWork, 'tags', 'home', true);
  assert.deepEqual(metadata.readTaskLineTags(withoutHome), ['other']);
  assert.doesNotMatch(withoutHome, /(?:^|[ \t])#home(?:$|[ \t])/u);
  assert.equal(metadata.readInlineFieldValue(withoutHome, 'tags'), '#other');
  assert.equal(metadata.readInlineFieldValue(withoutHome, 'project'), '#unrelated');
  assert.ok(withoutHome.includes(payload), 'raw hashtag removal cannot rewrite protected JSON');
  assert.match(withoutHome, /^ {4}- \[ \] QA  canonical/u);
  assert.match(withoutHome, /\^qa-canonical$/u);
});

test('typed row mutation preserves CRLF, final newline, and an absolute-final block ID', async () => {
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const content = [
    '---',
    'kind: task-source',
    '---',
    '- [ ] QA row [tpsId:: qa-row] ^qa-row',
    '',
  ].join('\r\n');
  const entry = {
    lineNumber: 3,
    line: '- [ ] QA row [tpsId:: qa-row] ^qa-row',
    fields: { tpsid: 'qa-row' },
  };
  const result = logLines.mutateLogLineContent(
    content,
    entry,
    (line) => logLines.setLogInlineFieldValue(line, 'projects', '[[Projects/Alpha]]'),
  );

  assert.equal(result.outcome, 'changed');
  assert.equal((result.content.match(/\r\n/gu) || []).length, 4);
  assert.equal(result.content.endsWith('\r\n'), true);
  assert.match(
    result.content.split('\r\n')[3],
    /<!-- \[projects:: \[\[Projects\/Alpha\]\]\] --> \^qa-row$/u,
  );
});

test('generic hidden fields never corrupt supported TPS JSON metadata carriers', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const payload = JSON.stringify({
    externalId: 'remote',
    associatedNotePath: 'Notes/Associated.md',
    memo: '[projects:: protected JSON text]',
  });
  const carriers = [
    `%% tps-inline-props:${payload} %%`,
    `<!-- tps-inline-props: ${payload} -->`,
    `[tpsInlineProps:: ${encodeURIComponent(payload)}]`,
    `<span data-tps-inline-props="${payload.replaceAll('"', '&quot;')}"></span>`,
  ];

  for (const carrier of carriers) {
    const source = `- [ ] Protected ${carrier} ^protected`;
    const updated = logLines.setLogInlineFieldValue(
      source,
      'projects',
      '[[Projects/Alpha]]',
    );
    assert.equal(
      metadata.readTaskAssociatedNotePath(updated),
      'Notes/Associated.md',
      carrier,
    );
    assert.equal(metadata.readInlineFieldValue(updated, 'projects'), '[[Projects/Alpha]]');
    assert.match(updated, /protected(?:%20| |&quot;)JSON(?:%20| |&quot;)text/iu);
    assert.match(updated, /\^protected$/u);
  }
});

test('typed fields and tags ignore closed code and protected lookalikes while preserving hidden GCM fields', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const { collectTpsListInlineFields } = await importBundled(
    '../src/tps-list/task-inline-property-fields.ts',
  );
  const code = '`[projects:: [[Code/False]]] #code [tags:: #code-field]`';
  const protectedCarrier = '%% tps-inline-props:{"memo":"keep  [projects:: [[Protected/False]]] #protected [tags:: #protected-field]  exactly"} %%';
  const original = `- [ ] Semantic ${code} ${protectedCarrier} #visible <!-- [projects:: [[Projects/Real]]] [tags:: #hidden] [tpsId:: semantic-row] --> ^semantic-row`;

  assert.equal(
    metadata.readInlineFieldValue(original, 'projects'),
    '[[Projects/Real]]',
    'inline-code and TPS JSON lookalikes cannot shadow the real hidden field',
  );
  assert.deepEqual(metadata.readTaskLineTags(original), ['visible', 'hidden']);
  assert.deepEqual(metadata.readInlineTags(original), ['visible']);
  const listFields = collectTpsListInlineFields(original);
  assert.deepEqual(
    listFields
      .filter(({ key }) => /^(?:projects|tags?|tpsId)$/iu.test(key))
      .map(({ key, value }) => [key.toLocaleLowerCase(), value]),
    [
      ['projects', '[[Projects/Real]]'],
      ['tags', '#hidden'],
      ['tpsid', 'semantic-row'],
      ['tag', '#visible'],
    ],
    'TPS List exposes only semantic fields while retaining visible tags',
  );

  const replaced = logLines.setLogInlineFieldValue(
    original,
    'projects',
    '[[Projects/Replaced]]',
  );
  assert.equal(
    metadata.readInlineFieldValue(replaced, 'projects'),
    '[[Projects/Replaced]]',
  );
  assert.ok(replaced.includes(code), 'inline code remains byte-identical after a typed write');
  assert.ok(
    replaced.includes(protectedCarrier),
    'protected TPS metadata remains byte-identical after a typed write',
  );
  assert.equal(metadata.readInlineFieldValue(replaced, 'tpsId'), 'semantic-row');
  assert.deepEqual(metadata.readTaskLineTags(replaced), ['visible', 'hidden']);

  const removed = logLines.setLogInlineFieldValue(replaced, 'projects', null);
  assert.equal(metadata.readInlineFieldValue(removed, 'projects'), '');
  assert.ok(removed.includes(code), 'inline code remains byte-identical after field removal');
  assert.ok(
    removed.includes(protectedCarrier),
    'protected TPS metadata remains byte-identical after field removal',
  );
  assert.deepEqual(metadata.readTaskLineTags(removed), ['visible', 'hidden']);
  assert.match(removed, /<!-- \[tags:: #hidden\] \[tpsId:: semantic-row\] -->/u);
  assert.match(removed, /\^semantic-row$/u);

  const withoutVisible = metadata.removeInlineTagFromTaskLine(removed, 'visible');
  assert.deepEqual(metadata.readTaskLineTags(withoutVisible), ['hidden']);
  assert.ok(withoutVisible.includes(code), 'tag removal cannot rewrite inline code');
  assert.ok(
    withoutVisible.includes(protectedCarrier),
    'tag removal cannot rewrite protected TPS metadata',
  );
});

test('native task-line field writes never replace field-shaped code or protected payload text', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const code = '`[scheduled:: 2099-01-01]`';
  const protectedCarrier = '%% tps-inline-props:{"memo":"keep  [scheduled:: 2098-01-01]  exactly"} %%';
  const original = `- [ ] Native ${code} ${protectedCarrier} [scheduled:: 2026-08-15] ^native-row`;

  const replaced = metadata.setInlineFieldValueOnTaskLine(
    original,
    'scheduled',
    '2026-08-16',
  );
  assert.equal(metadata.readInlineFieldValue(replaced, 'scheduled'), '2026-08-16');
  assert.ok(replaced.includes(code));
  assert.ok(replaced.includes(protectedCarrier));
  assert.match(replaced, /\[scheduled:: 2026-08-16\] \^native-row$/u);

  const removed = metadata.setInlineFieldValueOnTaskLine(replaced, 'scheduled', null);
  assert.equal(metadata.readInlineFieldValue(removed, 'scheduled'), '');
  assert.ok(removed.includes(code));
  assert.ok(removed.includes(protectedCarrier));
  assert.match(removed, /\^native-row$/u);
});
