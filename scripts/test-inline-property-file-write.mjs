import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function importAtomicLineReplacement() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/atomic-line-replacement.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

test('inline property file edits preserve concurrent unrelated changes and line endings', async () => {
  const { replaceExactLineRevision } = await importAtomicLineReplacement();
  const originalLine = '- [ ] Task [priority:: low]';
  const current = `Concurrent heading\r\nIntro\r\n${originalLine}\r\nTail\r\n`;
  const result = replaceExactLineRevision(
    current,
    1,
    originalLine,
    '- [ ] Task [priority:: high]',
  );

  assert.equal(result.route, 'relocated');
  assert.equal(result.resolvedLineIndex, 2);
  assert.equal(
    result.content,
    'Concurrent heading\r\nIntro\r\n- [ ] Task [priority:: high]\r\nTail\r\n',
  );
});

test('inline property file edits keep the captured index authoritative when identical lines exist', async () => {
  const { replaceExactLineRevision } = await importAtomicLineReplacement();
  const originalLine = '- item [score:: 1]';
  const result = replaceExactLineRevision(
    `${originalLine}\nMiddle\n${originalLine}\n`,
    2,
    originalLine,
    '- item [score:: 2]',
  );

  assert.equal(result.route, 'exact');
  assert.equal(result.resolvedLineIndex, 2);
  assert.equal(result.content, `${originalLine}\nMiddle\n- item [score:: 2]\n`);
});

test('inline property file edits refuse missing or ambiguously relocated source revisions', async () => {
  const { replaceExactLineRevision } = await importAtomicLineReplacement();
  const originalLine = '- item [score:: 1]';
  const ambiguousContent = `Inserted\n${originalLine}\n${originalLine}\n`;
  const ambiguous = replaceExactLineRevision(ambiguousContent, 0, originalLine, '- item [score:: 2]');
  const missing = replaceExactLineRevision('Changed elsewhere\n', 0, originalLine, '- item [score:: 2]');

  assert.deepEqual(ambiguous, {
    content: ambiguousContent,
    route: 'conflict',
    resolvedLineIndex: null,
    conflictReason: 'ambiguous',
  });
  assert.deepEqual(missing, {
    content: 'Changed elsewhere\n',
    route: 'conflict',
    resolvedLineIndex: null,
    conflictReason: 'missing',
  });
});

test('rendered inline property writes use atomic revision checks and structured outcomes', () => {
  const source = readFileSync(new URL('../src/services/inline-property-decoration-service.ts', import.meta.url), 'utf8');
  const method = source.match(/private async replaceInlinePropertyLine[\s\S]*?\n  private setInlineFieldValue/)?.[0] || '';

  assert.match(source, /from '\.\.\/utils\/atomic-line-replacement'/);
  assert.match(method, /vault\.process\(targetLine\.file, \(content\) =>/);
  assert.match(method, /replaceExactLineRevision\(/);
  assert.match(method, /file-edit:conflict/);
  assert.match(method, /file-edit:failed/);
  assert.match(method, /file-edit:done/);
  assert.doesNotMatch(method, /vault\.cachedRead/);
  assert.doesNotMatch(method, /vault\.modify/);
});
