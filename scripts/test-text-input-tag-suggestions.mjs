import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const modal = readFileSync(new URL('../src/modals/text-input-modal.ts', import.meta.url), 'utf8');
const taskMenu = readFileSync(new URL('../src/services/task-line-context-menu-service.ts', import.meta.url), 'utf8');
const list = readFileSync(new URL('../src/tps-list/views/TpsListView.ts', import.meta.url), 'utf8');
const table = readFileSync(new URL('../src/views/log-base-view.ts', import.meta.url), 'utf8');

test('free-text tag suggestions require an explicit pointer choice', () => {
  assert.match(modal, /options:\s*\{ suggestions\?: readonly string\[\] \}/u);
  assert.match(modal, /value\.toLocaleLowerCase\(\)\.includes\(normalizedQuery\)/u);
  assert.match(modal, /option\.addEventListener\(["']click["'],[\s\S]*?textComponent\?\.setValue\(value\)/u);
  assert.match(modal, /if \(e\.key === ["']Enter["']\) \{[\s\S]*?void this\.submit\(\)/u);
  assert.doesNotMatch(modal, /selectedIndex|activeSuggestion|highlightedSuggestion/u);
});

test('every free-text task tag editor supplies known vault tags', () => {
  for (const source of [taskMenu, list, table]) {
    assert.match(source, /suggestions: collectKnownVaultTags\(/u);
  }
});
