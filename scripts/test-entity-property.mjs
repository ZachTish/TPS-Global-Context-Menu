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
const logLineResult = await build({
  entryPoints: [fileURLToPath(new URL('../src/views/log-line-utils.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const logLineUtils = await import(
  `data:text/javascript;base64,${Buffer.from(logLineResult.outputFiles[0].text).toString('base64')}`
);

test('accepted kinds normalize without hardcoded values', () => {
  assert.deepEqual(
    entityProperty.normalizeAcceptsKind(['Project', 'person, Place', 'project']),
    ['Project', 'person', 'Place'],
  );
  assert.equal(entityProperty.isEntityReferenceProperty({ acceptsKind: 'Recipe' }), true);
  assert.equal(entityProperty.isEntityReferenceProperty({ acceptsKind: '  ' }), false);
  assert.equal(
    entityProperty.entityMatchesAcceptedKinds(
      { dimensions: { kind: ['Context', 'Area'] } },
      ['project', 'context'],
    ),
    true,
  );
  assert.equal(
    entityProperty.entityMatchesAcceptedKinds(
      { dimensions: { kind: 'Person' } },
      ['project', 'context'],
    ),
    false,
  );
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

test('canonical entity aliases cannot terminate hidden inline-property carriers', () => {
  const target = 'Projects/Delimiter';
  const title = 'Review --> launch <!-- draft';
  const wikilink = entityProperty.formatEntityReference({
    id: 'comment-delimiter',
    path: `${target}.md`,
    title,
  });

  assert.equal(wikilink, `[[${target}|Review - launch - draft]]`);
  assert.doesNotMatch(wikilink, /<!--|-->/u);
  assert.equal(
    entityProperty.getEntityReferenceTargetIdentity(wikilink),
    target.toLocaleLowerCase(),
    'sanitizing the alias must not change the canonical link target',
  );

  let taskLine = '- [ ] Ship safely [tpsId:: qa-comment-delimiter] <!-- [priority:: high] -->';
  taskLine = logLineUtils.setLogInlineFieldValue(taskLine, 'projects', wikilink);
  taskLine = logLineUtils.setLogInlineFieldValue(taskLine, 'contexts', '[[Contexts/Home]]');

  assert.equal(
    (taskLine.match(/-->/gu) || []).length,
    1,
    'Table/List/task-editor writes keep exactly the carrier closing delimiter',
  );
  assert.equal(
    (taskLine.match(/<!--/gu) || []).length,
    1,
    'the selected alias cannot inject a nested carrier opener',
  );
  const carrierBody = taskLine.match(/<!--([\s\S]*?)-->/u)?.[1] || '';
  assert.doesNotMatch(carrierBody, /<!--|-->/u);
  assert.deepEqual(logLineUtils.readInlineFields(taskLine), {
    tpsid: 'qa-comment-delimiter',
    priority: 'high',
    projects: wikilink,
    contexts: '[[Contexts/Home]]',
  });
});

test('unsafe entity targets are omitted before a hidden carrier can be mutated', () => {
  const unsafeClosePath = {
    id: 'unsafe-close-path',
    path: 'Projects/Alpha --> Beta.md',
    title: 'Alpha Beta',
  };
  const unsafeOpenPath = {
    id: 'unsafe-open-path',
    path: 'Projects/Gamma <!-- Delta.md',
    title: 'Gamma Delta',
  };
  const unsafeDeclaredTarget = {
    id: 'unsafe-declared-target',
    path: 'Projects/Declared Safe.md',
    referenceTarget: 'Projects/Declared Safe.md#^unsafe-->',
    title: 'Declared target',
  };
  const ordinaryNote = {
    id: 'ordinary-note',
    path: 'Projects/Ordinary.md',
    title: 'Ordinary',
  };
  const ordinaryBlock = {
    id: 'ordinary-block',
    path: 'Projects/Registry.md',
    entityType: 'block',
    blockId: 'ordinary-block',
    referenceState: 'ready',
    title: 'Ordinary block',
  };

  for (const unsafeEntity of [unsafeClosePath, unsafeOpenPath, unsafeDeclaredTarget]) {
    assert.equal(entityProperty.formatEntityReference(unsafeEntity), '');
    assert.equal(entityProperty.entityToReferenceChoice(unsafeEntity), null);
  }

  const choices = entityProperty.buildEntityReferenceChoices([
    unsafeClosePath,
    ordinaryNote,
    unsafeOpenPath,
    ordinaryBlock,
    unsafeDeclaredTarget,
  ]);
  assert.deepEqual(
    choices.map(({ wikilink }) => wikilink),
    [
      '[[Projects/Ordinary]]',
      '[[Projects/Registry#^ordinary-block|Ordinary block]]',
    ],
    'unsafe note paths and declared targets never reach the picker',
  );

  let taskLine = '- [ ] Ship safely [tpsId:: qa-target-delimiter] <!-- [priority:: high] -->';
  for (const choice of choices) {
    taskLine = logLineUtils.setLogInlineFieldValue(taskLine, 'projects', choice.wikilink);
  }
  assert.equal((taskLine.match(/-->/gu) || []).length, 1);
  assert.equal((taskLine.match(/<!--/gu) || []).length, 1);
  assert.equal(
    logLineUtils.readInlineFields(taskLine).projects,
    '[[Projects/Registry#^ordinary-block|Ordinary block]]',
  );
});

test('line entities in one note remain distinct and use native block-link targets', () => {
  const choices = entityProperty.buildEntityReferenceChoices([
    {
      id: 'line:registry#^alpha',
      path: 'Entities/Registry.md',
      sourcePath: 'Entities/Registry.md',
      entityType: 'block',
      blockId: 'alpha',
      subpath: '#^alpha',
      lineKind: 'heading',
      lineNumber: 4,
      referenceState: 'ready',
      displayName: 'Project Alpha',
    },
    {
      id: 'line:registry#^beta',
      path: 'Entities/Registry.md',
      entityType: 'block',
      blockId: 'beta',
      lineKind: 'bullet',
      lineNumber: 8,
      referenceState: 'ready',
      displayName: 'Project Beta',
    },
    {
      id: 'line-provisional:registry:12',
      path: 'Entities/Registry.md',
      entityType: 'block',
      lineKind: 'task',
      lineNumber: 12,
      referenceState: 'provisional',
      displayName: 'Project Gamma',
    },
  ]);

  assert.equal(choices.length, 3);
  assert.equal(
    choices.find(({ label }) => label === 'Project Alpha').wikilink,
    '[[Entities/Registry#^alpha|Project Alpha]]',
  );
  assert.equal(
    choices.find(({ label }) => label === 'Project Beta').wikilink,
    '[[Entities/Registry#^beta|Project Beta]]',
  );
  const provisional = choices.find(({ label }) => label === 'Project Gamma');
  assert.equal(provisional.wikilink, '');
  assert.equal(provisional.referenceState, 'provisional');
  assert.match(provisional.detail, /task line 12/u);
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
  assert.deepEqual(
    entityProperty.mergeEntityReferenceList(
      ['[[Entities/Registry#^alpha|Old Alpha]]'],
      '[[entities/registry.md#^alpha|Current Alpha]], [[Entities/Registry#^beta|Beta]]',
    ),
    ['[[entities/registry.md#^alpha|Current Alpha]]', '[[Entities/Registry#^beta|Beta]]'],
    'block anchors are part of identity while .md and alias text are not',
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
