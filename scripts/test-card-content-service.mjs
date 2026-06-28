import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/card-content-service.ts', import.meta.url), 'utf8');
const shared = readFileSync(new URL('../src/services/shared/index.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');

test('GCM owns card content extraction and exposes it through the shared API', () => {
  assert.match(source, /export class CardContentService/);
  assert.match(source, /extractOpenTasksFromMarkdown/);
  assert.match(source, /overflowCount/);
  assert.match(source, /\\d\+\[\.\)\]/);
  assert.match(shared, /cardContent: plugin\.cardContentService/);
  assert.match(api, /cardContent: plugin\.cardContentService/);
});
