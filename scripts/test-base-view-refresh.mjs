import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadCoordinator() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tps-base-refresh-'));
  const outfile = path.join(directory, 'coordinator.mjs');
  await build({
    entryPoints: ['src/views/base-view-refresh.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  const module = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  return { module, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('Base refresh coordinator collapses a burst into one trailing render', async () => {
  const { module, cleanup } = await loadCoordinator();
  try {
    const pending = new Map();
    let nextId = 0;
    let renders = 0;
    const coordinator = new module.TpsBaseRefreshCoordinator(
      () => { renders += 1; },
      280,
      {
        setTimeout: (callback, delayMs) => {
          const id = ++nextId;
          pending.set(id, {
            callback: () => {
              pending.delete(id);
              callback();
            },
            delayMs,
          });
          return id;
        },
        clearTimeout: (id) => pending.delete(id),
      },
    );

    coordinator.request();
    coordinator.request();
    coordinator.request();
    assert.equal(pending.size, 1);
    assert.equal([...pending.values()][0].delayMs, 280);
    [...pending.values()][0].callback();
    assert.equal(renders, 1);

    coordinator.request();
    coordinator.cancel();
    assert.equal(pending.size, 0);
    assert.equal(renders, 1);
  } finally {
    await cleanup();
  }
});
