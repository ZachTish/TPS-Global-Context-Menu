import esbuild from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const tempDir = await mkdtemp(join(tmpdir(), 'tps-gcm-frontmatter-mutation-test-'));
const outfile = join(tempDir, 'test-frontmatter-mutation-service.bundle.mjs');
const obsidianStub = resolve('scripts/frontmatter-mutation-obsidian-stub.mjs');

try {
  await esbuild.build({
    entryPoints: ['scripts/test-frontmatter-mutation-service.mjs'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-frontmatter-test-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: obsidianStub }));
      },
    }],
  });

  const exitCode = await new Promise((resolveExit) => {
    const child = spawn(process.execPath, ['--test', outfile], { stdio: 'inherit' });
    child.on('exit', (code) => resolveExit(code ?? 1));
    child.on('error', () => resolveExit(1));
  });

  process.exitCode = Number(exitCode);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
