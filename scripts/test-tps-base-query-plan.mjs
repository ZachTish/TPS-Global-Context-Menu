import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadModule(entry) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('compiled TPS query plan is stable, rejects unsupported clauses, and prunes row families', async () => {
  const { compileTpsBaseQueryPlan } = await loadModule('../src/views/tps-base-query-plan.ts');
  const roots = [
    { or: ['kind == "task"', 'kind == "project"'] },
    { and: ['folder != "_archive"', '!status.containsAny("complete", "wont-do")'] },
  ];
  const first = compileTpsBaseQueryPlan({ roots, viewName: 'Tasks' });
  const second = compileTpsBaseQueryPlan({ roots: structuredClone(roots), viewName: 'Tasks' });
  assert.equal(first.valid, true);
  assert.equal(first.signature, second.signature);
  assert.deepEqual([...first.rowFamilies].sort(), ['line', 'note', 'task']);

  const invalid = compileTpsBaseQueryPlan({
    roots: [{ property: 'status', operator: 'approximately', value: 'todo' }],
    viewName: 'Tasks',
  });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.diagnostics[0].code, 'unsupported-filter-operator');
  assert.equal(invalid.diagnostics[0].property, 'status');
  assert.equal(invalid.diagnostics[0].operator, 'approximately');
});

test('production Tasks Base semantics include open tasks and projects while excluding terminal and archived rows', async () => {
  const [{ evaluateLogBaseFilterRoots }, { composeEffectiveFilterRoots, extractFilterRootCandidates }] = await Promise.all([
    loadModule('../src/views/log-base-filter.ts'),
    loadModule('../src/tps-list/base-filter-roots.ts'),
  ]);
  const globalRoots = [{ or: ['kind == "task"', 'kind == "project"'] }];
  const viewRoots = [{ and: ['folder != "_archive"', '!status.containsAny("complete", "wont-do")'] }];
  const roots = composeEffectiveFilterRoots(globalRoots, viewRoots);
  const file = (path, frontmatter = {}) => ({
    path,
    name: path.split('/').at(-1),
    basename: path.split('/').at(-1).replace(/\.md$/u, ''),
    extension: 'md',
    folder: path.split('/').slice(0, -1).join('/'),
    tags: [],
    frontmatter,
  });
  const rows = [
    { id: 'task-open', rowKind: 'task', fields: { kind: 'task', status: 'todo', folder: 'Inbox' }, file: file('Inbox/Tasks.md') },
    { id: 'task-complete', rowKind: 'task', fields: { kind: 'task', status: 'complete', folder: 'Inbox' }, file: file('Inbox/Tasks.md') },
    { id: 'task-wont-do', rowKind: 'task', fields: { kind: 'task', status: 'wont-do', folder: 'Inbox' }, file: file('Inbox/Tasks.md') },
    { id: 'task-migrated', rowKind: 'task', fields: { kind: 'task', status: 'migrated', folder: 'Inbox' }, file: file('Inbox/Tasks.md') },
    { id: 'project', rowKind: 'note', fields: { kind: 'note', explicitkind: 'project', status: 'working', folder: 'Projects' }, file: file('Projects/Alpha.md', { kind: 'project' }) },
    { id: 'archived-project', rowKind: 'note', fields: { kind: 'note', explicitkind: 'project', status: 'working', folder: '_archive' }, file: file('_archive/Old.md', { kind: 'project' }) },
    { id: 'nested-archived-task', rowKind: 'task', fields: { kind: 'task', status: 'todo', folder: '_archive/QA' }, file: file('_archive/QA/TPS Filter Smoke Source.md') },
    { id: 'prefixed-archive-task', rowKind: 'task', fields: { kind: 'task', status: 'todo', folder: '_archive-old/QA' }, file: file('_archive-old/QA/Still Archived.md') },
  ];
  const result = rows.filter((row) => evaluateLogBaseFilterRoots(roots, row) === true).map((row) => row.id);
  assert.deepEqual(result, ['task-open', 'task-migrated', 'project']);
  assert.equal(
    evaluateLogBaseFilterRoots([...roots, 'task.open'], rows[3]),
    false,
    'migrated follows the literal authored exclusion; task.open is required for strict open-only behavior',
  );

  assert.deepEqual(
    extractFilterRootCandidates(['{"queryState":{"filters":["kind == task"]}}', ...globalRoots]),
    globalRoots,
    'serialized runtime controller state is not executed as a filter root',
  );

  assert.equal(evaluateLogBaseFilterRoots(['folder is "_archive"'], rows[6]), true);
  assert.equal(evaluateLogBaseFilterRoots(['folder is not "_archive"'], rows[6]), false);
  assert.equal(evaluateLogBaseFilterRoots([{ property: 'file.folder', operator: 'is', value: '_archive' }], rows[6]), true);
  assert.equal(evaluateLogBaseFilterRoots([{ property: 'folderPath', operator: 'is not', value: '_archive' }], rows[7]), false);
});
