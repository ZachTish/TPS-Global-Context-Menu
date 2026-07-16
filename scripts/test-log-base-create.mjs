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
  assert.deepEqual(defaults, { kind: 'bullet', targetPath: '2026-07-13.md', fields: { project: 'Home' } });
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
  assert.equal(buildTpsTableMarkdownLine(defaults.kind, 'Follow up', {}), '- [ ] Follow up');
});

test('higher-priority filters win while lower-priority roots fill missing defaults', async () => {
  const { resolveTpsTableLineCreateDefaults } = await loadModule();
  const defaults = resolveTpsTableLineCreateDefaults([
    { and: ['kind == "bullet"', 'status == "idea"'] },
    { and: ['status == "inbox"', 'file.path == "Inbox.md"'] },
  ]);
  assert.deepEqual(defaults, { kind: 'bullet', targetPath: 'Inbox.md', fields: { status: 'idea' } });
});

test('semantic line filters expose bullets and tasks without weakening ordinary log matching', async () => {
  const { getTpsTableMarkdownLineKind, hasTpsTableLineKindFilter } = await loadModule();
  assert.equal(getTpsTableMarkdownLineKind('- A bullet'), 'bullet');
  assert.equal(getTpsTableMarkdownLineKind('- [ ] A task'), 'task');
  assert.equal(getTpsTableMarkdownLineKind('Paragraph'), null);
  assert.equal(hasTpsTableLineKindFilter([{ or: ['kind == "bullet"', 'kind == "task"'] }]), true);
  assert.equal(hasTpsTableLineKindFilter(['file.ext == "md"']), false);
});

test('table view owns filter-derived line creation and uses an atomic vault mutation', () => {
  const source = readFileSync(new URL('../src/views/log-base-view.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(await this\.createLineForView\(\)\) return/);
  assert.match(source, /vault\.process\(targetFile/);
  assert.match(source, /missing-explicit-markdown-target/);
  assert.match(source, /markdownKind && hasTpsTableLineKindFilter\(filterRoots\)/);
});
