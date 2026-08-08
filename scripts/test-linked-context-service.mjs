import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function loadService() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/services/linked-context-service.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    plugins: [{ name: 'obsidian-stub', setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: 'export class TFile {}' }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

test('frontmatter links show the whole note', async () => {
  const { resolveLinkedContextRange } = await loadService();
  assert.deepEqual(resolveLinkedContextRange(2, 12, {
    frontmatterPosition: { start: { line: 0 }, end: { line: 3 } }, headings: [],
  }), { kind: 'note', startLine: 0, endLine: 11 });
});

test('heading links include nested content until the next peer or parent heading', async () => {
  const { resolveLinkedContextRange } = await loadService();
  assert.deepEqual(resolveLinkedContextRange(3, 14, { headings: [
    { level: 2, position: { start: { line: 3 } } },
    { level: 3, position: { start: { line: 6 } } },
    { level: 2, position: { start: { line: 9 } } },
  ] }), { kind: 'heading', startLine: 3, endLine: 8 });
});

test('ordinary links show only their source line', async () => {
  const { resolveLinkedContextRange } = await loadService();
  assert.deepEqual(resolveLinkedContextRange(7, 20, { headings: [] }), {
    kind: 'line', startLine: 7, endLine: 7,
  });
});
