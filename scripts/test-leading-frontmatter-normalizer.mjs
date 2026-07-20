import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transform } from 'esbuild';

const source = readFileSync(
  new URL('../src/services/leading-frontmatter-normalizer.ts', import.meta.url),
  'utf8',
);
const transformed = await transform(source, { loader: 'ts', format: 'esm', target: 'node20' });
const { normalizeLeadingWhitespaceBeforeFrontmatter } = await import(
  `data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`
);

function createHarness(initial, beforeCommit = null) {
  let content = initial;
  let calls = 0;
  const app = {
    vault: {
      async process(_file, mutator) {
        calls += 1;
        if (beforeCommit) content = beforeCommit(content);
        content = mutator(content);
      },
    },
  };
  return { app, file: { path: 'Daily.md' }, get content() { return content; }, get calls() { return calls; } };
}

test('leading-frontmatter normalization preserves a concurrent append and all remaining bytes', async () => {
  const harness = createHarness('\n\n---\r\ntitle: Daily\r\n---\r\nBody\r\n', (current) => `${current}Concurrent append\r\n`);
  assert.equal(await normalizeLeadingWhitespaceBeforeFrontmatter(harness.app, harness.file), true);
  assert.equal(harness.content, '---\r\ntitle: Daily\r\n---\r\nBody\r\nConcurrent append\r\n');
  assert.equal(harness.calls, 1);
});

test('already-leading frontmatter is byte-identical', async () => {
  const raw = '\uFEFF---  \nkey: value\n---\nBody\n';
  const harness = createHarness(raw);
  assert.equal(await normalizeLeadingWhitespaceBeforeFrontmatter(harness.app, harness.file), false);
  assert.equal(harness.content, raw);
});

test('ordinary leading content is never trimmed', async () => {
  const raw = '\nIntro\n---\nnot: frontmatter\n---\n';
  const harness = createHarness(raw);
  assert.equal(await normalizeLeadingWhitespaceBeforeFrontmatter(harness.app, harness.file), false);
  assert.equal(harness.content, raw);
});
