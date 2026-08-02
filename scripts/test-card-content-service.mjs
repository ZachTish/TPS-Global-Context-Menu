import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const source = readFileSync(new URL('../src/services/card-content-service.ts', import.meta.url), 'utf8');
const shared = readFileSync(new URL('../src/services/shared/index.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');

async function loadCardContentService() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/card-content-service.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('GCM owns card content extraction and exposes it through the shared API', () => {
  assert.match(source, /export class CardContentService/);
  assert.match(source, /extractOpenTasksFromMarkdown/);
  assert.match(source, /overflowCount/);
  assert.match(source, /\\d\+\[\.\)\]/);
  assert.match(shared, /cardContent: plugin\.cardContentService/);
  assert.match(api, /cardContent: plugin\.cardContentService/);
});

test('card task previews exclude frontmatter and fenced-code examples', async () => {
  const { CardContentService } = await loadCardContentService();
  const service = new CardContentService();
  const lines = [
    '---',
    'quarantine:',
    '  - [ ] Frontmatter task',
    '---',
    '- [ ] Visible task',
    '```md',
    '- [ ] Hidden backtick task',
    '```',
    '~~~text',
    '- [ ] Hidden tilde task',
    '~~~',
  ];

  for (const newline of ['\n', '\r\n', '\r']) {
    assert.deepEqual(service.extractOpenTasksFromMarkdown('Inbox/Quarantined.md', lines.join(newline), {
      openTaskLimit: 20,
    }), {
      openTasks: [{
        internalId: 'Inbox/Quarantined.md:5',
        line: 5,
        text: 'Visible task',
        displayText: 'Visible task',
      }],
      overflowCount: 0,
    }, JSON.stringify(newline));
  }
});
