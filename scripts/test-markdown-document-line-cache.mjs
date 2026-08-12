import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/utils/markdown-document-line-cache.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function makeFiles(count) {
  return Array.from({ length: count }, (_, index) => ({
    path: `Inbox/Cache ${index}.md`,
    stat: { mtime: 100 + index, size: 20 + index },
  }));
}

test('cold Table source scans are bounded and unchanged rerenders use parsed lines', async () => {
  const { MarkdownDocumentLineCache } = await loadModule();
  const files = makeFiles(24);
  let reads = 0;
  let activeReads = 0;
  let maxActiveReads = 0;
  const cache = new MarkdownDocumentLineCache(async (file) => {
    reads += 1;
    activeReads += 1;
    maxActiveReads = Math.max(maxActiveReads, activeReads);
    await new Promise((resolve) => setTimeout(resolve, 2));
    activeReads -= 1;
    return `- [ ] ${file.path}`;
  });

  const cold = await cache.readMany(files);
  assert.equal(cold.cancelled, false);
  assert.equal(cold.results.length, files.length);
  assert.equal(reads, files.length);
  assert.ok(maxActiveReads > 1 && maxActiveReads <= 8, `max read concurrency was ${maxActiveReads}`);
  assert.equal(cold.results.every((result) => result.ok && result.cacheHit === false), true);

  const warm = await cache.readMany(files);
  assert.equal(reads, files.length, 'warm rerender must not reread unchanged source notes');
  assert.equal(warm.results.every((result) => result.ok && result.cacheHit === true), true);
  assert.equal(warm.results[0].ok && warm.results[0].lines[0].text, '- [ ] Inbox/Cache 0.md');
  assert.equal(cache.size, files.length);
  assert.equal(Object.isFrozen(warm), true);
  assert.equal(Object.isFrozen(warm.results), true);
});
test('modify invalidation rereads even when mtime and size do not change', async () => {
  const { MarkdownDocumentLineCache } = await loadModule();
  const file = makeFiles(1)[0];
  let content = '- [ ] Before';
  let reads = 0;
  const cache = new MarkdownDocumentLineCache(async () => {
    reads += 1;
    return content;
  });

  assert.equal((await cache.readMany([file])).results[0].lines[0].text, '- [ ] Before');
  content = '- [x] After';
  cache.invalidate(file.path);
  assert.equal((await cache.readMany([file])).results[0].lines[0].text, '- [x] After');
  assert.equal(reads, 2);
});

test('delete and rename invalidation cannot let an older in-flight read repopulate cache', async () => {
  const { MarkdownDocumentLineCache } = await loadModule();
  const file = makeFiles(1)[0];
  let resolveOld;
  let reads = 0;
  const cache = new MarkdownDocumentLineCache(() => {
    reads += 1;
    if (reads === 1) return new Promise((resolve) => { resolveOld = resolve; });
    return Promise.resolve('- [ ] New revision');
  });

  const oldBatch = cache.readMany([file]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  cache.invalidate(file.path);
  const newBatch = await cache.readMany([file]);
  assert.equal(newBatch.results[0].lines[0].text, '- [ ] New revision');
  resolveOld('- [ ] Old revision');
  assert.equal((await oldBatch).results[0].lines[0].text, '- [ ] Old revision');
  assert.equal((await cache.readMany([file])).results[0].lines[0].text, '- [ ] New revision');
  assert.equal(reads, 2, 'stale completion must not replace the current revision');

  const oldPath = file.path;
  file.path = 'Archive/Renamed.md';
  cache.invalidateRename(oldPath, file.path);
  assert.equal((await cache.readMany([file])).results[0].lines[0].text, '- [ ] New revision');
  assert.equal(reads, 3);
});

test('stale render cancellation stops scheduling additional source reads', async () => {
  const { MarkdownDocumentLineCache } = await loadModule();
  const files = makeFiles(100);
  let reads = 0;
  let cancelled = false;
  const cache = new MarkdownDocumentLineCache(async () => {
    reads += 1;
    await new Promise((resolve) => setTimeout(resolve, 2));
    cancelled = true;
    return '- [ ] Item';
  });

  const batch = await cache.readMany(files, { isCancelled: () => cancelled });
  assert.equal(batch.cancelled, true);
  assert.ok(reads > 0 && reads <= 8, `stale render started ${reads} reads`);
  assert.equal(batch.results.length, reads);
});
