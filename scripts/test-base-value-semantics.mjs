import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const tableSource = readFileSync(new URL('../src/views/log-base-view.ts', import.meta.url), 'utf8');
const listSource = readFileSync(new URL('../src/tps-list/views/TpsListView.ts', import.meta.url), 'utf8');
const tableOptionsSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const listOptionsSource = readFileSync(new URL('../src/views/tps-list-bridge-view.ts', import.meta.url), 'utf8');

async function loadSemantics() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/views/base-value-semantics.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadGrouping() {
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

const property = (type, extras = {}) => ({
  id: `qa-${type}`,
  key: `qa-${type}`,
  label: type,
  type,
  ...extras,
});

test('shared semantics resolve every sortable TPS field family', async () => {
  const { resolveTpsBaseValueSemantics } = await loadSemantics();
  assert.deepEqual(resolveTpsBaseValueSemantics('title', property('text')), { kind: 'text', collection: false });
  assert.deepEqual(resolveTpsBaseValueSemantics('estimate', property('number')), { kind: 'number', collection: false });
  assert.deepEqual(resolveTpsBaseValueSemantics('scheduled', property('datetime')), { kind: 'datetime', collection: false });
  assert.deepEqual(resolveTpsBaseValueSemantics('ready', property('checkbox')), { kind: 'boolean', collection: false });
  assert.deepEqual(resolveTpsBaseValueSemantics('status', property('selector')), { kind: 'choice', collection: false });
  assert.deepEqual(resolveTpsBaseValueSemantics('kind', property('kind')), { kind: 'choice', collection: false });
  assert.deepEqual(resolveTpsBaseValueSemantics('tags', property('list', { listItemType: 'tag' })), {
    kind: 'tag', collection: true, itemKind: 'tag',
  });
  assert.deepEqual(resolveTpsBaseValueSemantics('aliases', property('list', { listItemType: 'text' })), {
    kind: 'text', collection: true, itemKind: 'text',
  });
  assert.deepEqual(resolveTpsBaseValueSemantics('links', property('list', { listItemType: 'link' })), {
    kind: 'link', collection: true, itemKind: 'link',
  });
  assert.deepEqual(resolveTpsBaseValueSemantics('owner', property('selector', {
    acceptsKind: 'person',
    optionSources: ['entity'],
  })), { kind: 'link', collection: false });
  assert.deepEqual(resolveTpsBaseValueSemantics('owners', property('list', {
    listItemType: 'text',
    acceptsKind: 'person',
    optionSources: ['manual', 'entity'],
  })), { kind: 'link', collection: true, itemKind: 'link' });
  assert.deepEqual(resolveTpsBaseValueSemantics('formula.score'), { kind: 'formula', collection: false });
  assert.deepEqual(resolveTpsBaseValueSemantics('file.tags'), { kind: 'tag', collection: true, itemKind: 'tag' });
  assert.deepEqual(resolveTpsBaseValueSemantics('completedDate'), { kind: 'datetime', collection: false });
});

test('typed comparison handles numbers, dates, booleans, choices, lists, links, formulas, and stable ties', async () => {
  const { compareTpsBaseValues } = await loadSemantics();
  const asc = (left, right, semantics) => compareTpsBaseValues(left, right, semantics, 'asc');
  const desc = (left, right, semantics) => compareTpsBaseValues(left, right, semantics, 'desc');

  assert.equal(Math.sign(asc('2', '10', { kind: 'number', collection: false })), -1);
  assert.equal(Math.sign(asc('-12.5', '-2', { kind: 'number', collection: false })), -1);
  assert.equal(Math.sign(desc('2', '10', { kind: 'number', collection: false })), 1);
  assert.equal(Math.sign(asc('2026-02-01 09:30', '2026-10-01 08:00', { kind: 'datetime', collection: false })), -1);
  assert.equal(Math.sign(asc(false, true, { kind: 'boolean', collection: false })), -1);
  assert.equal(Math.sign(asc('false', 'true', { kind: 'boolean', collection: false })), -1);
  assert.equal(Math.sign(asc('Stage 2', 'Stage 10', { kind: 'choice', collection: false })), -1);
  assert.equal(asc('Ready', 'ready', { kind: 'choice', collection: false }), 0, 'case-insensitive equal values remain a stable tie');

  const tags = { kind: 'tag', collection: true, itemKind: 'tag' };
  assert.equal(Math.sign(asc(['#alpha', '#zeta'], ['#beta'], tags)), -1);
  assert.equal(asc(['#Alpha'], ['alpha'], tags), 0);
  const links = { kind: 'link', collection: true, itemKind: 'link' };
  assert.equal(
    Math.sign(asc(['[[People/Alice|Zed]]'], ['[[People/Bob|Amy]]'], links)),
    -1,
    'entity links compare by canonical target instead of a misleading alias',
  );

  const formula = { kind: 'formula', collection: false };
  assert.equal(Math.sign(asc(2, 10, formula)), -1);
  assert.equal(Math.sign(asc(new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'), formula)), -1);
  assert.equal(Math.sign(asc([2, 10], [3], formula)), -1);

  assert.equal(asc('', null, { kind: 'text', collection: false }), 0);
  assert.equal(Math.sign(asc('', 'value', { kind: 'text', collection: false })), 1);
  assert.equal(Math.sign(desc('', 'value', { kind: 'text', collection: false })), 1, 'empty stays last when descending');
  assert.equal(asc('same', 'same', { kind: 'text', collection: false }), 0);
});

test('native Bases public Value wrappers share typed sort and grouping behavior', async () => {
  const { compareTpsBaseValues, getTpsBaseGroupValues } = await loadSemantics();
  const nativeList = (values) => ({
    constructor: { type: 'list' },
    length: () => values.length,
    get: (index) => values[index],
  });
  const semantics = { kind: 'number', collection: true, itemKind: 'number' };
  assert.equal(Math.sign(compareTpsBaseValues(nativeList([2, 10]), nativeList([3]), semantics)), -1);
  assert.deepEqual(getTpsBaseGroupValues(nativeList(['HCA', 'Project']), {
    kind: 'tag', collection: true, itemKind: 'tag',
  }), ['#HCA', '#Project']);
});

test('multi-value grouping defaults to fan-out and supports one combined lane', async () => {
  const {
    getTpsBaseGroupValues,
    resolveTpsBaseMultiValueGroupingMode,
  } = await loadSemantics();
  const tags = { kind: 'tag', collection: true, itemKind: 'tag' };
  assert.equal(resolveTpsBaseMultiValueGroupingMode(undefined), 'separate');
  assert.equal(resolveTpsBaseMultiValueGroupingMode('combined'), 'combined');
  assert.deepEqual(getTpsBaseGroupValues(['HCA', 'Project', 'hca'], tags), ['#HCA', '#Project']);
  assert.deepEqual(getTpsBaseGroupValues(['HCA', 'Project', 'hca'], tags, 'combined'), ['#HCA, #Project']);
  assert.deepEqual(getTpsBaseGroupValues([], tags), []);
  assert.deepEqual(getTpsBaseGroupValues(['', null, 'undefined'], tags), []);
});

test('bare Kind keeps structural and authored identities additive without rewriting authored values', async () => {
  const { getTpsBaseAdditiveKindValues, getTpsBaseGroupValues } = await loadSemantics();
  const semantics = { kind: 'choice', collection: true, itemKind: 'choice' };

  assert.deepEqual(getTpsBaseAdditiveKindValues('tasks', ['Project', 'HCA', 'project']), [
    'task',
    'Project',
    'HCA',
  ]);
  assert.deepEqual(getTpsBaseAdditiveKindValues('h2', 'project, reference'), [
    'h2',
    'project',
    'reference',
  ]);
  assert.deepEqual(getTpsBaseAdditiveKindValues(null, '[Project, HCA]'), ['Project', 'HCA']);
  assert.deepEqual(
    getTpsBaseGroupValues(getTpsBaseAdditiveKindValues('task', 'Project, HCA'), semantics, 'separate'),
    ['task', 'Project', 'HCA'],
  );
  assert.deepEqual(
    getTpsBaseGroupValues(getTpsBaseAdditiveKindValues('task', 'Project, HCA'), semantics, 'combined'),
    ['task, Project, HCA'],
  );
});

test('TPS row grouping fans out by default, combines on request, and retains unmatched placement', async () => {
  const { groupTpsBaseRows } = await loadGrouping();
  const rows = [
    { id: 'multi', tags: ['Project', 'HCA'] },
    { id: 'hca', tags: ['hca'] },
    { id: 'empty', tags: [] },
  ];
  const semantics = { kind: 'tag', collection: true, itemKind: 'tag' };
  const separate = groupTpsBaseRows(rows, (row) => row.tags, 'asc', 'first', 'separate', semantics);
  assert.deepEqual(separate.map((group) => [group.key, group.rows.map((row) => row.id)]), [
    [null, ['empty']],
    ['#HCA', ['multi', 'hca']],
    ['#Project', ['multi']],
  ]);
  const combined = groupTpsBaseRows(rows, (row) => row.tags, 'asc', 'last', 'combined', semantics);
  assert.deepEqual(combined.map((group) => [group.key, group.rows.map((row) => row.id)]), [
    ['#hca', ['hca']],
    ['#Project, #HCA', ['multi']],
    [null, ['empty']],
  ]);

  const numeric = groupTpsBaseRows(
    [{ value: '10' }, { value: '2' }],
    (row) => row.value,
    'asc',
    'last',
    'separate',
    { kind: 'number', collection: false },
  );
  assert.deepEqual(numeric.map((group) => group.key), ['2', '10']);
});

test('TPS Table and TPS List consume one typed contract and expose the grouping choice', () => {
  for (const [label, source] of [['TPS Table', tableSource], ['TPS List', listSource]]) {
    assert.match(source, /compareTpsBaseValues/u, `${label} must use shared typed comparisons`);
    assert.match(source, /resolveTpsBaseValueSemantics/u, `${label} must resolve configured field semantics`);
    assert.match(source, /getConfigValue\('multiValueGrouping'\)/u, `${label} must read the per-view grouping mode`);
  }
  assert.match(tableSource, /groupTpsBaseRows\([\s\S]{0,500}multiValueGrouping[\s\S]{0,120}groupSemantics/u);
  assert.match(listSource, /getTpsBaseGroupValues\([\s\S]{0,300}this\.getMultiValueGroupingMode\(\)/u);

  for (const [label, source] of [['TPS Table options', tableOptionsSource], ['TPS List options', listOptionsSource]]) {
    assert.match(source, /key: 'multiValueGrouping'/u, `${label} must persist the choice in the Base view`);
    assert.match(source, /default: 'separate'/u, `${label} must default to one instance per value`);
    assert.match(source, /separate: 'Show in every matching group'/u);
    assert.match(source, /combined: 'Show in one combined group'/u);
  }
});
