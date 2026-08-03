import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/views/log-base-create.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('ordered view kind and whole-Base target filters create a real bullet', async () => {
  const { resolveTpsTableLineCreateDefaults, buildTpsTableMarkdownLine } = await loadModule();
  const defaults = resolveTpsTableLineCreateDefaults([
    { or: ['kind == "bullet"', 'kind == "task"'] },
    { and: ['file.path == this.file.path', 'project == "Home"'] },
  ], (value) => value === 'this.file.path' ? '2026-07-13.md' : value);
  assert.deepEqual(defaults, {
    kind: 'bullet',
    targetPath: '2026-07-13.md',
    targetPathSpecified: true,
    fields: { project: 'Home' },
  });
  assert.equal(buildTpsTableMarkdownLine(defaults.kind, 'Remember this', defaults.fields), '- Remember this [project:: Home]');
});

test('first matching any branch controls task versus bullet creation', async () => {
  const { resolveTpsTableLineCreateDefaults, buildTpsTableMarkdownLine } = await loadModule();
  const defaults = resolveTpsTableLineCreateDefaults([
    { any: ['kind == "task"', 'kind == "bullet"'] },
    'task.path == "Inbox.md"',
  ]);
  assert.equal(defaults.kind, 'task');
  assert.equal(defaults.targetPath, 'Inbox.md');
  assert.equal(defaults.targetPathSpecified, true);
  assert.equal(
    buildTpsTableMarkdownLine(defaults.kind, 'Follow up', {}, { checkboxState: '[ ]' }),
    '- [ ] Follow up',
  );
  assert.throws(
    () => buildTpsTableMarkdownLine(defaults.kind, 'Unmapped task', {}),
    /mapped checkbox state is required/u,
  );
});

test('higher-priority filters win while lower-priority roots fill missing defaults', async () => {
  const { resolveTpsTableLineCreateDefaults } = await loadModule();
  const defaults = resolveTpsTableLineCreateDefaults([
    { and: ['kind == "bullet"', 'status == "idea"'] },
    { and: ['status == "inbox"', 'file.path == "Inbox.md"'] },
  ]);
  assert.deepEqual(defaults, {
    kind: 'bullet',
    targetPath: 'Inbox.md',
    targetPathSpecified: true,
    fields: { status: 'idea' },
  });
});

test('table defaults distinguish an omitted target from an explicit target that resolves empty', async () => {
  const { resolveTpsTableLineCreateDefaults } = await loadModule();
  assert.deepEqual(resolveTpsTableLineCreateDefaults(['kind == "task"']), {
    kind: 'task',
    targetPath: null,
    targetPathSpecified: false,
    fields: {},
  });

  const explicitEmpty = resolveTpsTableLineCreateDefaults([
    { and: ['kind == "task"', 'file.path == this.file.path'] },
    'task.path == "Lower Priority.md"',
  ], (value) => value === 'this.file.path' ? '' : value);
  assert.deepEqual(explicitEmpty, {
    kind: 'task',
    targetPath: null,
    targetPathSpecified: true,
    fields: {},
  });
});

test('only canonical file.path and task.path filters claim the table write target', async () => {
  const { resolveTpsTableLineCreateDefaults } = await loadModule();
  assert.deepEqual(resolveTpsTableLineCreateDefaults([
    { and: ['kind == "task"', 'note.path == "Metadata.md"', 'path == "line-value"'] },
  ]), {
    kind: 'task',
    targetPath: null,
    targetPathSpecified: false,
    fields: { path: 'line-value' },
  });

  assert.deepEqual(resolveTpsTableLineCreateDefaults([
    { and: ['kind == "task"', 'task.file.path == "Source Alias.md"'] },
  ]), {
    kind: 'task',
    targetPath: null,
    targetPathSpecified: false,
    fields: {},
  });
});

test('conflicting canonical targets in one conjunction fail closed', async () => {
  const { resolveTpsTableLineCreateDefaults } = await loadModule();
  assert.deepEqual(resolveTpsTableLineCreateDefaults([
    { and: ['kind == "task"', 'file.path == "Inbox/A.md"', 'task.path == "Inbox/B.md"'] },
    'task.path == "Lower Priority.md"',
  ]), {
    kind: 'task',
    targetPath: null,
    targetPathSpecified: true,
    fields: {},
  });

  assert.equal(resolveTpsTableLineCreateDefaults([
    { and: ['file.path == "[[Inbox/A#Tasks|A]]"', 'task.path == "Inbox/A.md"'] },
  ]).targetPath, '[[Inbox/A#Tasks|A]]');
});

test('semantic line filters expose bullets, tasks, and headings without weakening ordinary log matching', async () => {
  const { buildTpsTableMarkdownLine, getTpsTableMarkdownLineKind, hasTpsTableLineKindFilter } = await loadModule();
  assert.equal(getTpsTableMarkdownLineKind('- A bullet'), 'bullet');
  assert.equal(getTpsTableMarkdownLineKind('- [ ] A task'), 'task');
  assert.equal(getTpsTableMarkdownLineKind('### A heading'), 'heading');
  assert.equal(getTpsTableMarkdownLineKind('Paragraph'), null);
  assert.equal(hasTpsTableLineKindFilter([{ or: ['kind == "bullet"', 'kind == "task"', 'kind == "h3"'] }]), true);
  assert.equal(hasTpsTableLineKindFilter(['file.ext == "md"']), false);
  assert.equal(
    buildTpsTableMarkdownLine('heading', 'A heading', { priority: 'low' }, {
      headingLevel: 3,
      tags: ['#work'],
    }),
    '### A heading #work [priority:: low]',
  );
  assert.equal(
    buildTpsTableMarkdownLine('task', 'Working', {}, { checkboxState: '[\\]' }),
    '- [\\] Working',
  );
});

test('table view owns filter-derived line creation and uses an atomic vault mutation', () => {
  const source = readFileSync(new URL('../src/views/log-base-view.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(await this\.createLineForView\(\)\) return/);
  assert.match(source, /vault\.process\(targetFile/);
  assert.match(source, /resolveTpsBaseWriteFile\(\{[\s\S]{0,180}explicitTargetSpecified: defaults\.targetPathSpecified/);
  assert.match(source, /createExplicitIfMissing: false/);
  assert.match(source, /markdownKind && hasTpsTableLineKindFilter\(filterRoots\)/);
  assert.match(source, /filterRoots = await this\.getEffectiveBaseFilterRoots\(true\)/);
  assert.match(source, /Could not read the Base filters, so TPS Table did not create anything\./);
  assert.match(source, /if \(failOnReadError\) throw error/);
  assert.ok(
    source.indexOf('await this.promptForLineTitle') < source.indexOf('this.plugin.resolveTpsBaseWriteFile'),
    'cancelling the title prompt must happen before a Daily Note fallback can create a note',
  );
  assert.match(source, /private async promptForLineTitle\([\s\S]{0,260}new TpsTableLineCreateModal/u);
});
