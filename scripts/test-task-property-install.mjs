import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/integrations/task-property-install.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});
const { installTaskRecordProperties } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

test('task field installation is scoped, complete, merge-safe, and idempotent', () => {
  const existing = [
    { id: 'kind', key: 'kind', type: 'kind' },
    { id: 'status', key: 'status', type: 'selector', options: ['active'], scopeKinds: ['workout-session'] },
  ];
  const first = installTaskRecordProperties(existing);
  const second = installTaskRecordProperties(first.properties);
  const keys = new Set(first.properties.map((property) => property.key));
  for (const key of ['status', 'priority', 'scheduled', 'due', 'timeEstimate', 'parents', 'recurrenceRule', 'completedDate']) {
    assert.equal(keys.has(key), true, `missing ${key}`);
  }
  const status = first.properties.find((property) => property.key === 'status');
  assert.deepEqual(status.scopeKinds, ['workout-session', 'task']);
  assert.deepEqual(status.options, ['todo', 'working', 'holding', 'wont-do', 'complete', 'migrated', 'active']);
  assert.equal(first.properties.filter((property) => property.key === 'status').length, 1);
  assert.deepEqual(second.properties, first.properties);
});
