import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadFilterModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/tps-list/base-filter-roots.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadGuideModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/base-query-guide.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const accepted = new Set(['tps-list']);

test('whole-Base and active-view filters are separate effective AND roots', async () => {
  const { extractPersistedFilterRoots, combineEffectiveFilterResults } = await loadFilterModule();
  const parsed = {
    filters: { or: ['file.folder == "Inbox"', 'file.folder == "Projects"'] },
    views: [
      { type: 'tps-list', name: 'Open', filters: { and: ['kind == "task"', 'status != "complete"'] } },
      { type: 'tps-list', name: 'Completed', filters: { and: ['kind == "task"', 'status == "complete"'] } },
    ],
  };
  const result = extractPersistedFilterRoots(parsed, 'Open', accepted);
  assert.deepEqual(result.filters, [parsed.views[0].filters, parsed.filters]);
  assert.equal(combineEffectiveFilterResults([true, true]), true);
  assert.equal(combineEffectiveFilterResults([true, false]), false);
  assert.equal(combineEffectiveFilterResults([false, true]), false);
});

test('inactive sibling-view filters never leak into the active view', async () => {
  const { extractPersistedFilterRoots } = await loadFilterModule();
  const parsed = {
    filters: { and: ['file.ext == "md"'] },
    views: [
      { type: 'tps-list', name: 'Today', filters: { and: ['scheduled == today()'] } },
      { type: 'tps-list', name: 'Later', filters: { and: ['scheduled > today()'] } },
      { type: 'table', name: 'Evidence', filters: { and: ['kind == "note"'] } },
    ],
  };
  const result = extractPersistedFilterRoots(parsed, 'Later', accepted);
  assert.deepEqual(result.filters, [parsed.views[1].filters, parsed.filters]);
});

test('runtime edits, active-view filters, and whole-Base filters compose without duplicates', async () => {
  const { composeEffectiveFilterRoots } = await loadFilterModule();
  const runtime = { and: ['priority == "high"'] };
  const active = { or: ['status == "todo"', 'status == "doing"'] };
  const base = { and: ['kind == "task"'] };
  assert.deepEqual(composeEffectiveFilterRoots([runtime, active], [active, base]), [runtime, active, base]);
});

test('unknown filter results cannot become a definite match or bypass a known failure', async () => {
  const { combineEffectiveFilterResults, combineFilterTreeResults } = await loadFilterModule();
  assert.equal(combineEffectiveFilterResults([null, true]), null);
  assert.equal(combineEffectiveFilterResults([null, false, true]), false);
  assert.equal(combineEffectiveFilterResults([null, null]), null);
  assert.equal(combineFilterTreeResults([null, false], 'or'), null);
  assert.equal(combineFilterTreeResults([null, true], 'or'), true);
});

test('missing requested view does not borrow filters from another named view', async () => {
  const { extractPersistedFilterRoots } = await loadFilterModule();
  const parsed = {
    filters: { and: ['file.ext == "md"'] },
    views: [{ type: 'tps-list', name: 'Only', filters: { and: ['status == "todo"'] } }],
  };
  const result = extractPersistedFilterRoots(parsed, 'Missing', accepted);
  assert.deepEqual(result.filters, [parsed.filters]);
});

test('Base query guide keeps the Daily Note Feed target and row kinds explicit', async () => {
  const { CURRENT_DAILY_NOTE_FEED_QUERY, BASE_QUERY_GUIDE_GOTCHAS } = await loadGuideModule();
  assert.match(CURRENT_DAILY_NOTE_FEED_QUERY, /file\.path == this\.file\.path/);
  assert.match(CURRENT_DAILY_NOTE_FEED_QUERY, /task\.path == this\.file\.path/);
  assert.match(CURRENT_DAILY_NOTE_FEED_QUERY, /kind == "task"/);
  assert.match(CURRENT_DAILY_NOTE_FEED_QUERY, /kind == "bullet"/);
  assert.match(CURRENT_DAILY_NOTE_FEED_QUERY, /kind == "header"/);
  assert.ok(BASE_QUERY_GUIDE_GOTCHAS.some((note) => /h1 through h6/.test(note)));
  assert.ok(BASE_QUERY_GUIDE_GOTCHAS.some((note) => /display-only/.test(note)));
});

test('Base query guide includes the complete documented native file property set and GCM virtual fields', async () => {
  const { BASE_QUERY_GUIDE_SECTIONS } = await loadGuideModule();
  const expressions = BASE_QUERY_GUIDE_SECTIONS.flatMap((section) => section.entries.map((entry) => entry.expression));
  for (const property of [
    'file.backlinks',
    'file.ctime',
    'file.embeds',
    'file.ext',
    'file.file',
    'file.folder',
    'file.links',
    'file.mtime',
    'file.name',
    'file.path',
    'file.properties',
    'file.size',
    'file.tags',
  ]) {
    assert.ok(expressions.includes(property), `missing native Base property ${property}`);
  }
  assert.ok(expressions.includes('task.path / task.file.path / line.path / heading.path'));
  assert.ok(expressions.includes('kind == "header" / kind == "heading"'));
  assert.ok(expressions.includes('kind == "h1" … kind == "h6"'));
  assert.ok(expressions.includes('heading.level'));
  assert.ok(expressions.includes('title / task.title / line.text / heading.text'));
  assert.ok(expressions.includes('lineFilterKey / lineProperty / lineFilterKeys'));
  assert.ok(expressions.includes('lineFilterAnyKeys'));
  assert.ok(expressions.includes('task.<inline-key> or <inline-key>'));
  assert.ok(expressions.includes('<field> / line.<field> / log.<field>'));
});

test('settings renders the Base query guide at the bottom before the settings footer', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/settings-tab.ts', import.meta.url)), 'utf8');
  const diagnostics = source.indexOf("'Debug Logging'");
  const guideRender = source.indexOf('this.renderBaseQueryGuide(containerEl, createSection);');
  const footer = source.indexOf('Note: native context menu items are preserved');
  assert.ok(diagnostics >= 0);
  assert.ok(guideRender > diagnostics);
  assert.ok(footer > guideRender);
  assert.match(source, /'Base query guide'/);
});
