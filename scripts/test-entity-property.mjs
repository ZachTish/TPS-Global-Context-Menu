import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/utils/entity-property.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const entityProperty = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
);

test('accepted kinds normalize without hardcoded values', () => {
  assert.deepEqual(
    entityProperty.normalizeAcceptsKind(['Project', 'person, Place', 'project']),
    ['Project', 'person', 'Place'],
  );
  assert.equal(entityProperty.isEntityReferenceProperty({ acceptsKind: 'Recipe' }), true);
  assert.equal(entityProperty.isEntityReferenceProperty({ acceptsKind: '  ' }), false);
});

test('configured properties resolve exact keys and supported Base prefixes', () => {
  const properties = [
    { id: 'projects-field', key: 'Projects', acceptsKind: 'Project' },
    { id: 'crm.project', key: 'Project owner', acceptsKind: 'Person' },
  ];

  assert.equal(entityProperty.resolveConfiguredProperty(properties, 'task.projects'), properties[0]);
  assert.equal(entityProperty.resolveConfiguredProperty(properties, 'note["Projects"]'), properties[0]);
  assert.equal(entityProperty.resolveConfiguredProperty(properties, { field: 'properties.Projects' }), properties[0]);
  assert.equal(entityProperty.resolveConfiguredProperty(properties, 'crm.project'), properties[1]);
  assert.equal(entityProperty.resolveConfiguredProperty(properties, 'task.unknown'), null);
});

test('entity choices are canonical Markdown links, readable, sorted, and deduplicated', () => {
  const choices = entityProperty.buildEntityReferenceChoices([
    { id: '2', path: 'Projects/Zeta.md', title: 'Zeta launch' },
    { id: '1', path: 'Projects/Alpha.md', title: 'Alpha' },
    { id: 'duplicate', path: 'projects/alpha.md', title: 'Duplicate' },
    { id: 'unsafe-alias', path: 'Projects/Delimiter.md', title: 'A | B\n[launch]' },
    { id: 'not-markdown', path: 'Assets/code.js', title: 'Code' },
  ]);

  assert.deepEqual(choices.map((choice) => choice.label), ['A | B\n[launch]', 'Alpha', 'Zeta launch']);
  assert.equal(choices[0].wikilink, '[[Projects/Delimiter|A - B launch]]');
  assert.equal(choices[1].detail, 'Projects/Alpha');
  assert.equal(choices[1].wikilink, '[[Projects/Alpha]]');
  assert.equal(choices[2].wikilink, '[[Projects/Zeta|Zeta launch]]');
});

test('entity-reference lists deduplicate and remove by target rather than alias text', () => {
  assert.deepEqual(
    entityProperty.mergeEntityReferenceList(
      ['[[Projects/Alpha|Old title]]', '[[Projects/Beta]]'],
      '[[projects/alpha|Current title]], [[Projects/Gamma]]',
    ),
    ['[[projects/alpha|Current title]]', '[[Projects/Beta]]', '[[Projects/Gamma]]'],
  );
  assert.deepEqual(
    entityProperty.removeEntityReferenceListValues(
      ['[[Projects/Alpha|Old title]]', '[[Projects/Beta]]'],
      '[[projects/alpha|Different title]]',
    ),
    ['[[Projects/Beta]]'],
  );
});

test('entity index owners resolve through the service and public API shapes', () => {
  const service = { query: () => [] };
  assert.equal(entityProperty.resolveEntityIndexQueryable(service), service);
  assert.equal(entityProperty.resolveEntityIndexQueryable({ entityIndexService: service }), service);
  assert.equal(entityProperty.resolveEntityIndexQueryable({ api: { entities: service } }), service);
  assert.equal(entityProperty.resolveEntityIndexQueryable({ api: { entityIndex: service } }), service);
  assert.equal(entityProperty.resolveEntityIndexQueryable({}), null);
});
