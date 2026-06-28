import esbuild from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const tempDir = await mkdtemp(join(tmpdir(), 'tps-gcm-time-tracking-test-'));
const outfile = join(tempDir, 'test-time-tracking-format.bundle.mjs');

try {
  await esbuild.build({
    entryPoints: ['scripts/test-time-tracking-format.mjs'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    logLevel: 'silent',
  });

  const exitCode = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', outfile], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });

  process.exitCode = Number(exitCode);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
