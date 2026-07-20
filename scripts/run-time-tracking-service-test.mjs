import esbuild from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const tempDir = await mkdtemp(join(tmpdir(), 'tps-gcm-time-tracking-service-test-'));
const outfile = join(tempDir, 'test-time-tracking-service.bundle.mjs');

try {
  await esbuild.build({
    entryPoints: ['scripts/test-time-tracking-service.mjs'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-test-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({
          path: 'obsidian-test-stub',
          namespace: 'obsidian-test-stub',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'obsidian-test-stub' }, () => ({
          loader: 'js',
          contents: `
            export class TFile {
              constructor(path) {
                this.path = path;
                this.name = path.split('/').pop() || path;
                this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
                this.basename = this.name.replace(/\\.[^.]+$/, '');
              }
            }
            export class MarkdownView {}
            export class Notice { constructor(message) { this.message = message; } }
            export const normalizePath = (value) => String(value || '')
              .replace(/\\\\/g, '/')
              .replace(/\\/{2,}/g, '/')
              .replace(/^\\.\\//, '');
            export const parseYaml = (value) => JSON.parse(value);
          `,
        }));
      },
    }],
  });

  const exitCode = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', outfile], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });

  process.exitCode = Number(exitCode);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
