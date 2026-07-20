import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transform } from 'esbuild';

const helperSource = readFileSync(
  new URL('../src/events/checklist-status-transition.ts', import.meta.url),
  'utf8',
);
const registerEventsSource = readFileSync(
  new URL('../src/events/register-events.ts', import.meta.url),
  'utf8',
);
const transformed = await transform(helperSource, {
  loader: 'ts',
  format: 'esm',
  target: 'node20',
});
const helpers = await import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`);
const normalize = (value) => String(value ?? '').trim().toLowerCase();

test('guarded checklist transition preserves key casing and manages completedDate', () => {
  const frontmatter = { Status: 'todo', title: 'Task' };
  assert.equal(helpers.applyGuardedChecklistStatusTransition(frontmatter, {
    statusKey: 'status',
    expectedStatus: 'todo',
    targetStatus: 'complete',
    normalizeStatus: normalize,
    completedAt: '2026-07-20 12:00:00',
  }), true);
  assert.deepEqual(frontmatter, {
    Status: 'complete',
    title: 'Task',
    completedDate: '2026-07-20 12:00:00',
  });

  assert.equal(helpers.applyGuardedChecklistStatusTransition(frontmatter, {
    statusKey: 'status',
    expectedStatus: 'complete',
    targetStatus: 'todo',
    normalizeStatus: normalize,
    completedAt: 'ignored',
  }), true);
  assert.deepEqual(frontmatter, { Status: 'todo', title: 'Task' });
});

test('stale status guard is byte-for-byte non-mutating', () => {
  const frontmatter = { status: 'working', completedDate: '2026-07-19 10:00:00', priority: 'high' };
  const before = structuredClone(frontmatter);
  assert.equal(helpers.applyGuardedChecklistStatusTransition(frontmatter, {
    statusKey: 'status',
    expectedStatus: 'complete',
    targetStatus: 'todo',
    normalizeStatus: normalize,
    completedAt: 'ignored',
  }), false);
  assert.deepEqual(frontmatter, before);
});

test('only one transition based on the same observed status can commit', () => {
  const frontmatter = { status: 'complete', completedDate: '2026-07-20 12:00:00' };
  const options = {
    statusKey: 'status',
    expectedStatus: 'complete',
    targetStatus: 'todo',
    normalizeStatus: normalize,
    completedAt: 'ignored',
  };
  assert.equal(helpers.applyGuardedChecklistStatusTransition(frontmatter, options), true);
  assert.equal(helpers.applyGuardedChecklistStatusTransition(frontmatter, options), false);
  assert.deepEqual(frontmatter, { status: 'todo' });
});

test('mutation outcomes distinguish durable no-op, stale guard, and refusal', () => {
  assert.equal(helpers.classifyGuardedStatusWriteOutcome('changed', false), 'changed');
  assert.equal(helpers.classifyGuardedStatusWriteOutcome('unchanged', false), 'unchanged');
  assert.equal(helpers.classifyGuardedStatusWriteOutcome('guarded-abort', true), 'stale');
  for (const outcome of ['guarded-abort', 'parse-failed', 'write-refused', 'unsupported']) {
    assert.equal(helpers.classifyGuardedStatusWriteOutcome(outcome, false), 'refused');
  }
});

test('external scan failure restores the previous status under the observed completion revision', async () => {
  const writes = [];
  const result = await helpers.recoverExternalChecklistCompletionAfterScanFailure({
    previousStatus: 'working',
    liveStatus: 'complete',
    isCompletionStatus: (status) => status === 'complete',
    writeStatus: async (targetStatus, expectedStatus) => {
      writes.push({ targetStatus, expectedStatus });
      return 'changed';
    },
  });
  assert.deepEqual(writes, [{ targetStatus: 'working', expectedStatus: 'complete' }]);
  assert.deepEqual(result, { restoreStatus: 'working', outcome: 'changed' });
});

test('external scan failure surfaces a refused restore without treating it as success', async () => {
  const result = await helpers.recoverExternalChecklistCompletionAfterScanFailure({
    previousStatus: 'todo',
    liveStatus: 'done',
    isCompletionStatus: (status) => status === 'done',
    writeStatus: async () => 'refused',
  });
  assert.deepEqual(result, { restoreStatus: 'todo', outcome: 'refused' });
});

test('external checklist workflow guards both restore and reapply writes', () => {
  assert.match(registerEventsSource, /writeConfiguredStatus\(liveFile, restoreStatus, liveStatus\)/);
  assert.match(registerEventsSource, /writeConfiguredStatus\(liveFile, liveStatus, restoreStatus\)/);
  assert.match(registerEventsSource, /recoverExternalChecklistCompletionAfterScanFailure/);
  assert.match(registerEventsSource, /Couldn’t verify checklist items/);
  assert.match(registerEventsSource, /processGuardedWithOutcome/);
  assert.doesNotMatch(registerEventsSource, /frontmatterMutationService\.process\(file, \(frontmatter\) =>/);
  assert.match(registerEventsSource, /External checklist completion guard failed/);
  assert.match(registerEventsSource, /Reactive completed-date write failed/);
  assert.match(registerEventsSource, /Reactive completed-date cleanup failed/);
});
