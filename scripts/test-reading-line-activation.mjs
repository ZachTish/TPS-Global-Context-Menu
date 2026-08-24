import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadResolver() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tps-reading-line-'));
  const outfile = path.join(directory, 'resolver.mjs');
  await build({
    entryPoints: ['src/utils/reading-line-activation.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  const module = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  return { module, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('Reading View list ordinals resolve bullets without mistaking tasks or protected blocks', async () => {
  const { module, cleanup } = await loadResolver();
  try {
    const source = [
      '---', 'kind: qa', '---',
      '- first bullet',
      '- [ ] task',
      '  - nested bullet',
      '```', '- hidden code bullet', '```',
      '- final bullet',
    ].join('\n');
    assert.deepEqual(module.resolveReadingBulletSourceLine(source, 0), { lineIndex: 3, rawLine: '- first bullet' });
    assert.equal(module.resolveReadingBulletSourceLine(source, 1), null);
    assert.deepEqual(module.resolveReadingBulletSourceLine(source, 2), { lineIndex: 5, rawLine: '  - nested bullet' });
    assert.deepEqual(module.resolveReadingBulletSourceLine(source, 3), { lineIndex: 9, rawLine: '- final bullet' });
    assert.deepEqual(module.resolveReadingBulletSourceLine(source, 99, 5), { lineIndex: 5, rawLine: '  - nested bullet' });
  } finally {
    await cleanup();
  }
});
