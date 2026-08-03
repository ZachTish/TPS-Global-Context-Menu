import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const serviceSource = readFileSync(new URL('../src/services/task-status-checkbox-reconcile-service.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');

const mappings = [
  { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete' },
  { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo' },
  { checkboxState: '[\\]', statuses: ['working'], toggleTargetStatus: 'complete' },
  { checkboxState: '[?]', statuses: ['holding'], toggleTargetStatus: 'todo' },
  { checkboxState: '[-]', statuses: ['wont-do'], toggleTargetStatus: 'todo' },
];

async function importUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/task-status-checkbox-reconcile.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

test('task status reconciliation maps inline status fields into task checkbox markers', async () => {
  const { reconcileTaskStatusLine } = await importUtility();

  assert.deepEqual(
    reconcileTaskStatusLine(
      '- [ ] Body task two with a much longer label [status:: working]',
      'status',
      mappings,
    ),
    {
      changed: true,
      line: '- [\\] Body task two with a much longer label',
      status: 'working',
      checkboxState: '[\\]',
    },
  );

  assert.equal(
    reconcileTaskStatusLine('- [ ] Done thing [status:: complete]', 'status', mappings, {
      completedAt: new Date(2026, 5, 3, 14, 5, 6),
    }).line,
    '- [x] Done thing [completedDate:: 2026-06-03 14:05:06]',
  );
  assert.equal(
    reconcileTaskStatusLine('- [x] Done thing [status:: complete] [completedDate:: 2026-06-01 09:00:00]', 'status', mappings, {
      completedAt: new Date(2026, 5, 3, 14, 5, 6),
    }).line,
    '- [x] Done thing [completedDate:: 2026-06-01 09:00:00]',
  );
  assert.equal(
    reconcileTaskStatusLine('- [X] Uppercase done [status:: complete]', 'status', mappings, {
      completedAt: new Date(2026, 5, 3, 14, 5, 6),
    }).line,
    '- [x] Uppercase done [completedDate:: 2026-06-03 14:05:06]',
  );
  assert.equal(
    reconcileTaskStatusLine('- [ ] Canceled thing [status:: wont-do]', 'status', mappings, {
      completedAt: new Date(2026, 5, 3, 14, 5, 6),
    }).line,
    '- [-] Canceled thing [completedDate:: 2026-06-03 14:05:06]',
  );
  assert.equal(
    reconcileTaskStatusLine('- [x] Reopened [status:: todo] [completedDate:: 2026-06-01 09:00:00]', 'status', mappings).line,
    '- [ ] Reopened',
  );
  assert.equal(
    reconcileTaskStatusLine('- [ ] Waiting thing (status:: holding)', 'status', mappings).line,
    '- [?] Waiting thing',
  );
  assert.equal(
    reconcileTaskStatusLine('  1. [ ] Ordered task [state:: working] #tag', 'state', mappings).line,
    '  1. [\\] Ordered task #tag',
  );
});

test('task status reconciliation leaves unrelated and unmapped lines alone', async () => {
  const { reconcileTaskStatusLine } = await importUtility();

  assert.equal(
    reconcileTaskStatusLine('- [ ] Body task [priority:: high]', 'status', mappings).line,
    '- [ ] Body task [priority:: high]',
  );
  assert.equal(
    reconcileTaskStatusLine('- [ ] Body task [status:: unknown]', 'status', mappings).line,
    '- [ ] Body task [status:: unknown]',
  );
  assert.equal(
    reconcileTaskStatusLine('- plain list item [status:: working]', 'status', mappings).line,
    '- plain list item [status:: working]',
  );
});

test('task status reconciliation preserves an alternate marker and honors canonical status aliases', async () => {
  const { reconcileTaskStatusLine } = await importUtility();
  const alternateMappings = [
    { checkboxState: '[\\]', statuses: ['working'] },
    { checkboxState: '[/]', statuses: ['working'] },
    { checkboxState: '[d]', statuses: ['done'] },
  ];
  const normalizeStatus = (value) => ({ done: 'complete', completed: 'complete' }[String(value).trim().toLowerCase()] || String(value).trim().toLowerCase());

  assert.equal(
    reconcileTaskStatusLine('- [/] Keep this working marker [status:: working]', 'status', alternateMappings, {
      normalizeStatus,
    }).line,
    '- [/] Keep this working marker',
  );
  assert.equal(
    reconcileTaskStatusLine('- [ ] Alias completion [status:: completed]', 'status', alternateMappings, {
      normalizeStatus,
      completeMarkers: ['d'],
      completedAt: new Date(2026, 5, 3, 14, 5, 6),
    }).line,
    '- [d] Alias completion [completedDate:: 2026-06-03 14:05:06]',
  );
});

test('task status reconciliation is registered as an enabled GCM automation', () => {
  assert.match(serviceSource, /export class TaskStatusCheckboxReconcileService extends Component/);
  assert.match(serviceSource, /vault\.process\(file, \(data\) =>/);
  assert.match(serviceSource, /workspace\.on\('editor-change'/);
  assert.match(serviceSource, /workspace\.on\('active-leaf-change'/);
  assert.match(serviceSource, /isEditorQuiet\(\)/);
  assert.match(serviceSource, /scanMarkdownDocumentLines\(data\)/);
  assert.match(serviceSource, /documentLines\[index\]\?\.isContent !== true/);
  assert.match(serviceSource, /reconcileTaskStatusLine\(line, statusKey, mappings, \{[\s\S]{0,180}normalizeStatus/);
  assert.match(serviceSource, /data\.includes\('\\r'\) \? '\\r' : '\\n'/);
  assert.match(serviceSource, /getCompleteMarkers\(mappings\)/);
  assert.match(mainSource, /new TaskStatusCheckboxReconcileService\(this\)/);
  assert.match(mainSource, /this\.addChild\(this\.taskStatusCheckboxReconcileService\)/);
  assert.match(settingsSource, /Sync inline status to checkbox marker/);
});
