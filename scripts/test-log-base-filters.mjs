import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/views/log-base-filter.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const context = {
  fields: { food: 'watermelon', completeddate: '2026-07-08T23:15:00', protein: '6' },
  contextDate: '2026-07-08',
  file: { path: 'Daily Notes/2026/07/08.md', name: '08.md', basename: '08', extension: 'md', folder: 'Daily Notes/2026/07', tags: ['health'], frontmatter: { kind: 'daily-note' } },
};

test('TPS Table combines file and inline row filters', async () => {
  const { evaluateLogBaseFilterRoots } = await loadModule();
  assert.equal(evaluateLogBaseFilterRoots([{ and: ['file.ext == "md"'] }, { and: ['completedDate >= date("2026-07-08")', 'protein > 5'] }], context), true);
  assert.equal(evaluateLogBaseFilterRoots([{ and: ['file.ext == "md"'] }, { and: ['completedDate < date("2026-07-08")'] }], context), false);
});

test('TPS Table preserves nested any/all/not semantics', async () => {
  const { evaluateLogBaseFilterNode } = await loadModule();
  assert.equal(evaluateLogBaseFilterNode({ and: [{ or: ['food == "watermelon"', 'food == "eggs"'] }, { not: 'file.path.startsWith("Archive/")' }] }, context), true);
});

test('Home context tokens work without changing standalone filter behavior', async () => {
  const { evaluateLogBaseFilterNode } = await loadModule();
  assert.equal(evaluateLogBaseFilterNode('completedDate >= this.scheduled', context), true);
  assert.equal(evaluateLogBaseFilterNode('completedDate < this.scheduled', context), false);
});

test('unsupported branches stay unknown instead of hiding rows', async () => {
  const { evaluateLogBaseFilterNode } = await loadModule();
  assert.equal(evaluateLogBaseFilterNode({ or: ['unsupported.magic()', 'food == "eggs"'] }, context), null);
  assert.equal(evaluateLogBaseFilterNode({ and: ['unsupported.magic()', 'food == "eggs"'] }, context), false);
});

test('active Food Log source and selected-day predicates match representative rows', async () => {
  const { evaluateLogBaseFilterRoots } = await loadModule();
  assert.equal(evaluateLogBaseFilterRoots([{ and: ['file.ext == "md"'] }, { and: ['completedDate >= date("2026-07-08")', 'completedDate < date("2026-07-09")'] }], context), true);
});
