import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/handlers/checklist-handler.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
  plugins: [{
    name: 'checklist-obsidian-stub',
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        loader: 'js',
        contents: `
          export class TFile { constructor(path) { this.path = path; this.basename = path.replace(/\\.md$/, ''); } }
          export class Modal {
            constructor(app) { this.app = app; }
            open() { this.onResult?.(globalThis.__tpsChecklistTestAction ?? 'cancel'); }
            close() {}
          }
          export class Setting {}
          export class ButtonComponent {}
          export class Notice {}
        `,
      }));
    },
  }],
});
const { ChecklistHandler } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
);
const file = { path: 'Inbox/Checklist.md', basename: 'Checklist' };

test('checklist scan failures are explicit and completion fails closed', async () => {
  const handler = new ChecklistHandler({
    vault: {
      async read() { throw new Error('read refused'); },
    },
  });
  assert.deepEqual(await handler.scanChecklistItems(file), { ok: false, items: [] });
  assert.equal(await handler.handleChecklistCompletion(file), false);
});

test('checklist body updates use the latest atomic revision and preserve concurrent appends', async () => {
  let content = '- [ ] Original\n';
  const handler = new ChecklistHandler({
    vault: {
      async process(_file, mutator) {
        content += 'Concurrent append\n';
        content = mutator(content);
      },
    },
  });
  assert.equal(await handler.updateChecklistItems(file, 'complete'), true);
  assert.equal(content, '- [x] Original\nConcurrent append\n');
});

test('checklist body write rejection cannot authorize status completion', async () => {
  const handler = new ChecklistHandler({
    vault: {
      async process() { throw new Error('write refused'); },
    },
  });
  assert.equal(await handler.updateChecklistItems(file, 'canceled'), false);
  const source = readFileSync(new URL('../src/handlers/checklist-handler.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(!\(await this\.updateChecklistItems\(file, 'complete'\)\)\) return false;/);
  assert.match(source, /if \(!\(await this\.updateChecklistItems\(file, 'canceled'\)\)\) return false;/);
  assert.doesNotMatch(source, /vault\.modify\(/);
});

test('completion and cancellation choices both fail closed when their atomic body write is refused', async () => {
  const handler = new ChecklistHandler({
    vault: {
      async read() { return '- [ ] Still open\n'; },
      async process() { throw new Error('write refused'); },
    },
  });

  globalThis.__tpsChecklistTestAction = 'complete';
  assert.equal(await handler.handleChecklistCompletion(file), false);
  globalThis.__tpsChecklistTestAction = 'canceled';
  assert.equal(await handler.handleChecklistCompletion(file), false);
  delete globalThis.__tpsChecklistTestAction;
});
