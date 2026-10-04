import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/utils/kind-reference-migration.ts'], bundle: true,
  platform: 'browser', format: 'esm', write: false });
const { planKindReferenceSettings, planKindBaseReferences, planPropertyKeyNavigatorReferences,
  planPropertyKeyBaseReferences } = await import('data:text/javascript;base64,' +
  Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const primary = { kindList: { key: 'kind', value: 'entity/food' } };
const change = { kind: 'classification', recordKind: 'food', from: primary,
  to: { kindList: { key: 'kind', value: 'entity/ingredient' } } };
const condition = (field, value) => ({ source: 'frontmatter', field, operator: 'is', value });

test('one configured kind-list path carries exact GCM scopes, Navigator rules and Navigator settings', () => {
  const gcm = { properties: [{ id: 'parents', type: 'list', scopeKinds: ['entity/food', 'other'],
    scopeProperties: [{ key: 'kind', operator: 'equals', value: 'entity/food' }] }],
    notebookNavigatorRules: { rules: [{ id: 'food', match: 'all', conditions: [condition('kind', 'entity/food')] }] } };
  const navigator = { vaultProfiles: [{ hiddenFileProperties: ['kind=entity/food'],
    shortcuts: [{ type: 'search', provider: 'internal', query: '.kind=entity/food' }] }],
    propertyAppearances: { 'key:kind=entity/food': { titleRows: 2 } } };
  const result = planKindReferenceSettings(gcm, navigator, change, { food: primary });
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.gcm.properties[0].scopeKinds, ['entity/ingredient', 'other']);
  assert.equal(result.gcm.properties[0].scopeProperties[0].value, 'entity/ingredient');
  assert.equal(result.gcm.notebookNavigatorRules.rules[0].conditions[0].value, 'entity/ingredient');
  assert.deepEqual(result.navigator.vaultProfiles[0].hiddenFileProperties, ['kind=entity/ingredient']);
  assert.equal(result.navigator.vaultProfiles[0].shortcuts[0].query, '.kind=entity/ingredient');
  assert.ok(result.navigator.propertyAppearances['key:kind=entity/ingredient']);
  assert.equal(gcm.properties[0].scopeKinds[0], 'entity/food', 'planning must not edit live settings');
});

test('shared path requires the selected discriminator in an AND rule; generic scopes and views block', () => {
  const mappings = { food: { primary, aliases: [], discriminator: { key: 'tpsRecordType', value: 'food' } },
    recipe: { primary, aliases: [], discriminator: { key: 'tpsRecordType', value: 'recipe' } } };
  const gcm = { properties: [{ id: 'parents', scopeKinds: ['entity/food'] }], notebookNavigatorRules: { rules: [
    { id: 'food', match: 'all', conditions: [condition('kind', 'entity/food'), condition('tpsRecordType', 'food')] },
    { id: 'recipe', match: 'all', conditions: [condition('kind', 'entity/food'), condition('tpsRecordType', 'recipe')] },
  ] } };
  const navigator = { vaultProfiles: [{ hiddenFileProperties: ['kind=entity/food'] }] };
  const result = planKindReferenceSettings(gcm, navigator, change, mappings);
  assert.equal(result.gcm.notebookNavigatorRules.rules[0].conditions[0].value, 'entity/ingredient');
  assert.equal(result.gcm.notebookNavigatorRules.rules[1].conditions[0].value, 'entity/food');
  assert.match(result.blocked.join(' '), /GCM custom property.*shared kind path/u);
  assert.match(result.blocked.join(' '), /Notebook Navigator.*shared kind path/u);
  const generic = planKindBaseReferences('filters:\n  and:\n    - list(kind).contains("entity/food")\n', change, mappings);
  assert.match(generic.blocked.join(' '), /shared kind path/u);
  const paired = planKindBaseReferences('filters:\n  and:\n    - list(kind).contains("entity/food") && tpsRecordType == "food"\n', change, mappings);
  assert.deepEqual(paired.blocked, []);
  assert.match(paired.after, /entity\/ingredient/u);
  const unsafeOr = planKindReferenceSettings({ properties: [], notebookNavigatorRules: { rules: [
    { id: 'or-recipe', match: 'any', conditions: [condition('kind', 'entity/food'), condition('tpsRecordType', 'recipe')] },
  ] } }, null, change, mappings);
  assert.match(unsafeOr.blocked.join(' '), /or-recipe.*shared kind path/u);
});

test('Base filter edit preserves other formulas, comments and bytes; ambiguous use blocks with location', () => {
  const source = '# keep this comment\nfilters:\n  and:\n    - list(kind).contains("entity/food")\nformulas:\n  label: title + "!"\n';
  const result = planKindBaseReferences(source, change, { food: primary });
  assert.deepEqual(result.blocked, []);
  assert.equal(result.after, source.replace('entity/food', 'entity/ingredient'));
  const ambiguous = planKindBaseReferences('filters:\n  and:\n    - kind.startsWith("entity/food")\n', change, { food: primary });
  assert.match(ambiguous.blocked.join(' '), /filters.and.0/u);
  const formula = planKindBaseReferences('formulas:\n  label: "entity/food"\n', change, { food: primary });
  assert.match(formula.blocked.join(' '), /formulas.label/u);
});

test('shared discriminator edits update paired GCM rule and exact Base filter only', () => {
  const mappings = { food: { primary, aliases: [], discriminator: { key: 'tpsRecordType', value: 'food' } },
    recipe: { primary, aliases: [], discriminator: { key: 'tpsRecordType', value: 'recipe' } } };
  const edit = { kind: 'discriminator', recordKind: 'food', primary,
    from: { key: 'tpsRecordType', value: 'food' }, to: { key: 'recordType', value: 'ingredient' } };
  const gcm = { properties: [{ id: 'specific', scopeKinds: ['entity/food'],
    scopeProperties: [{ key: 'tpsRecordType', operator: 'equals', value: 'food' }] }], notebookNavigatorRules: { rules: [
    { id: 'food', match: 'all', conditions: [condition('kind', 'entity/food'), condition('tpsRecordType', 'food')] },
    { id: 'recipe', match: 'all', conditions: [condition('kind', 'entity/food'), condition('tpsRecordType', 'recipe')] },
  ] } };
  const navigator = { vaultProfiles: [{ hiddenFileProperties: ['tpsRecordType=food'],
    shortcuts: [{ type: 'search', query: '.tpsRecordType=food' }] }],
    propertyAppearances: { 'key:tpsRecordType=food': { titleRows: 2 } } };
  const result = planKindReferenceSettings(gcm, navigator, edit, mappings);
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.gcm.notebookNavigatorRules.rules[0].conditions[1], condition('recordType', 'ingredient'));
  assert.deepEqual(result.gcm.notebookNavigatorRules.rules[1].conditions[1], condition('tpsRecordType', 'recipe'));
  assert.deepEqual(result.gcm.properties[0].scopeProperties[0], { key: 'recordType', operator: 'equals', value: 'ingredient' });
  assert.equal(result.navigator.vaultProfiles[0].shortcuts[0].query, '.recordType=ingredient');
  assert.deepEqual(result.navigator.vaultProfiles[0].hiddenFileProperties, ['recordType=ingredient']);
  assert.ok(result.navigator.propertyAppearances['key:recordType=ingredient']);
  const source = 'filters:\n  and:\n    - list(kind).contains("entity/food") && tpsRecordType == "food"\n';
  const base = planKindBaseReferences(source, edit, mappings);
  assert.deepEqual(base.blocked, []);
  assert.match(base.after, /recordType == "ingredient"/u);
  assert.doesNotMatch(base.after, /tpsRecordType == "food"/u);
});

test('global property-key rename carries exact Navigator visibility, sorting and shortcut references', () => {
  const navigator = { propertySortKey: 'kind, scheduled', propertyGroupKey: 'kind',
    defaultFolderSortPropertyKey: 'kind', noteGrouping: 'property-desc:kind',
    vaultProfiles: [{ propertyKeys: [{ key: 'kind', showInNavigation: true }],
      hiddenFileProperties: ['kind=entity/food'], shortcuts: [{ type: 'search', query: '.kind=entity/food' }] }],
    propertyAppearances: { 'key:kind=entity/food': { titleRows: 2 } } };
  const result = planPropertyKeyNavigatorReferences(navigator, 'kind', 'recordKinds');
  assert.deepEqual(result.blocked, []);
  assert.equal(result.navigator.propertySortKey, 'recordKinds, scheduled');
  assert.equal(result.navigator.propertyGroupKey, 'recordKinds');
  assert.equal(result.navigator.defaultFolderSortPropertyKey, 'recordKinds');
  assert.equal(result.navigator.noteGrouping, 'property-desc:recordKinds');
  assert.equal(result.navigator.vaultProfiles[0].propertyKeys[0].key, 'recordKinds');
  assert.deepEqual(result.navigator.vaultProfiles[0].hiddenFileProperties, ['recordKinds=entity/food']);
  assert.equal(result.navigator.vaultProfiles[0].shortcuts[0].query, '.recordKinds=entity/food');
  assert.ok(result.navigator.propertyAppearances['key:recordKinds=entity/food']);
  assert.equal(navigator.propertySortKey, 'kind, scheduled');
  const conflict = planPropertyKeyNavigatorReferences({ propertySortKey: 'kind, recordKinds' }, 'kind', 'recordKinds');
  assert.match(conflict.blocked.join(' '), /destination key/u);
});

test('global property-key rename updates exact Base filters and view fields while preserving literals and comments', () => {
  const source = '# kind is a user label\nfilters:\n  and:\n    - (list(kind).contains("entity/food") || kind == "kind")\nformulas:\n  marker: if(!note.kind.isEmpty(), note.kind, "kind")\nproperties:\n  note.kind:\n    displayName: Kind\nviews:\n  - type: table\n    order:\n      - kind\n    sort:\n      - property: kind\n        direction: ASC\n';
  const result = planPropertyKeyBaseReferences(source, 'kind', 'recordKinds');
  assert.deepEqual(result.blocked, []);
  assert.equal(result.after, source.replace('list(kind)', 'list(recordKinds)').replace('|| kind ==', '|| recordKinds ==')
    .replaceAll('note.kind', 'note.recordKinds').replace('      - kind\n', '      - recordKinds\n')
    .replace('property: kind', 'property: recordKinds'));
  const ambiguous = planPropertyKeyBaseReferences('filters:\n  and:\n    - custom(kind)\n', 'kind', 'recordKinds');
  assert.match(ambiguous.blocked.join(' '), /filters.and.0.*unrecognized expression/u);
});

test('calendar custom-field keys use the same configured reference migration', () => {
  for (const field of ['allDay', 'location', 'calendar']) {
    const next = `${field}Configured`;
    const navigator = { vaultProfiles: [{ propertyKeys: [{ key: field, showInNavigation: true }],
      hiddenFileProperties: [`${field}=example`], shortcuts: [{ type: 'search', query: `.${field}=example` }] }] };
    const settings = planPropertyKeyNavigatorReferences(navigator, field, next);
    assert.deepEqual(settings.blocked, [], field);
    assert.equal(settings.navigator.vaultProfiles[0].propertyKeys[0].key, next, field);
    assert.equal(settings.navigator.vaultProfiles[0].hiddenFileProperties[0], `${next}=example`, field);
    assert.equal(settings.navigator.vaultProfiles[0].shortcuts[0].query, `.${next}=example`, field);
    const base = planPropertyKeyBaseReferences(`filters:\n  and:\n    - ${field} == \"example\"\n`, field, next);
    assert.deepEqual(base.blocked, [], field);
    assert.match(base.after, new RegExp(`${next} ==`), field);
  }
});
