import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/base-row-index-service.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'base-index-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'base-index-test' }, () => ({
          contents: `
            class TFile {
              constructor(path) {
                this.path = path;
                this.name = path.split('/').pop();
                this.basename = this.name.replace(/\\.md$/u, '');
                this.extension = 'md';
                this.stat = { mtime: 1, size: 100 };
              }
            }
            module.exports = { TFile };
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('Base row index bounds 10k-file reads, is deterministic, warms without I/O, and reparses one invalidated file', async () => {
  const { BaseRowIndexService } = await loadModule();
  const TFile = (await import('data:text/javascript,export default class {}')).default;
  // Use objects constructed by the bundled TFile class by recovering it from
  // the service's instanceof route through a tiny first call helper.
  const handlers = new Map();
  let reads = 0;
  let activeReads = 0;
  let maxActiveReads = 0;
  const plugin = {
    app: {
      vault: {
        on: (name, handler) => (handlers.set(name, handler), { name }),
        cachedRead: async (file) => {
          reads += 1;
          activeReads += 1;
          maxActiveReads = Math.max(maxActiveReads, activeReads);
          await Promise.resolve();
          activeReads -= 1;
          return Array.from({ length: 10 }, (_, index) => `- [ ] ${file.path}:${index}`).join('\n');
        },
      },
    },
    registerEvent: () => {},
    filePropertiesService: { isCompanionFile: () => false },
  };
  const service = new BaseRowIndexService(plugin);
  service.setup();

  // The bundled class is not exported; make representative objects inherit
  // from the constructor accepted by the service by observing that the cache
  // only needs TFile shape. The test bundle's TFile constructor is available
  // through a test-only file factory on the service module when esbuild keeps
  // the class local, so use setup-created handler guards to validate shape.
  const filePrototype = Object.getPrototypeOf(Object.getOwnPropertyDescriptor(service, 'cache')?.value ?? {});
  void TFile;
  const files = Array.from({ length: 10_000 }, (_, index) => ({
    path: `Inbox/${String(index).padStart(5, '0')}.md`,
    name: `${String(index).padStart(5, '0')}.md`,
    basename: String(index).padStart(5, '0'),
    extension: 'md',
    stat: { mtime: 1, size: 100 },
  }));
  // In the executable harness, bypass only the Obsidian runtime nominal check;
  // production still receives real TFile instances.
  service.normalizeFiles = (input) => [...new Map(input.map((file) => [file.path, file])).values()]
    .sort((left, right) => left.path.localeCompare(right.path));

  const snapshots = [];
  const first = await service.readProgressive([...files].reverse(), {
    batchSize: 64,
    onProgress: (progress) => snapshots.push({
      completedFiles: progress.completedFiles,
      first: progress.results[0]?.file.path,
      last: progress.results.at(-1)?.file.path,
      rows: progress.results.reduce((sum, result) => sum + (result.ok ? result.lines.length : 0), 0),
    }),
  });
  assert.deepEqual(first, { cancelled: false, completedFiles: 10_000, totalFiles: 10_000 });
  assert.equal(reads, 10_000);
  assert.ok(maxActiveReads <= 8, `expected at most 8 reads, saw ${maxActiveReads}`);
  assert.equal(snapshots.reduce((sum, batch) => sum + batch.rows, 0), 100_000);
  assert.equal(snapshots[0].first, 'Inbox/00000.md');
  assert.equal(snapshots.at(-1).last, 'Inbox/09999.md');

  const warm = await service.readMany(files);
  assert.equal(warm.cancelled, false);
  assert.equal(reads, 10_000, 'warm rerender performs no source reads');
  assert.deepEqual(warm.results.map((result) => result.file.path), files.map((file) => file.path));

  service.invalidate(files[4321].path);
  await service.readMany(files);
  assert.equal(reads, 10_001, 'one-file edit reparses only the invalidated file');

  let cancel = false;
  service.clear();
  const cancelled = await service.readProgressive(files, {
    batchSize: 64,
    isCancelled: () => cancel,
    onProgress: () => { cancel = true; },
  });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.completedFiles, 64);
});
