import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as esbuild from 'esbuild';

const serviceSource = readFileSync(
  new URL('../src/services/linked-subitem-checkbox-service.ts', import.meta.url),
  'utf8',
);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

async function importProductionHelpers() {
  const helperSource = sourceBetween(
    serviceSource,
    'export type LinkedSubitemToggleResult',
    'const VIRTUAL_CHECKBOX_CLASS',
  );
  const transformed = await esbuild.transform(helperSource, {
    loader: 'ts',
    format: 'esm',
    target: 'node20',
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`);
}

test('toggle outcomes distinguish committed, unchanged, stale, and refused writes', async () => {
  const { classifyLinkedSubitemToggleOutcome } = await importProductionHelpers();
  assert.equal(classifyLinkedSubitemToggleOutcome('changed'), 'changed');
  assert.equal(classifyLinkedSubitemToggleOutcome('unchanged'), 'unchanged');
  assert.equal(classifyLinkedSubitemToggleOutcome('guarded-abort'), 'stale');
  for (const outcome of ['parse-failed', 'write-refused', 'unsupported']) {
    assert.equal(classifyLinkedSubitemToggleOutcome(outcome), 'refused');
  }
});

test('atomic toggle guard preserves a case-insensitive key and accepts the displayed live value', async () => {
  const { applyLinkedSubitemStatusToggle } = await importProductionHelpers();
  const frontmatter = { Title: 'Child', Status: ' Todo ' };

  assert.equal(applyLinkedSubitemStatusToggle(frontmatter, 'status', 'todo', 'complete'), true);
  assert.deepEqual(frontmatter, { Title: 'Child', Status: 'complete' });
  assert.equal(Object.hasOwn(frontmatter, 'status'), false);
});

test('atomic toggle guard refuses a stale cache value without modifying live frontmatter', async () => {
  const { applyLinkedSubitemStatusToggle } = await importProductionHelpers();
  const frontmatter = { status: 'working', priority: 'high' };
  const before = structuredClone(frontmatter);

  assert.equal(applyLinkedSubitemStatusToggle(frontmatter, 'status', 'todo', 'complete'), false);
  assert.deepEqual(frontmatter, before);
});

test('only the first of two clicks rendered from the same cached status can commit', async () => {
  const { applyLinkedSubitemStatusToggle } = await importProductionHelpers();
  const liveFrontmatter = { status: 'todo' };

  assert.equal(applyLinkedSubitemStatusToggle(liveFrontmatter, 'status', 'todo', 'complete'), true);
  assert.equal(applyLinkedSubitemStatusToggle(liveFrontmatter, 'status', 'todo', 'complete'), false);
  assert.deepEqual(liveFrontmatter, { status: 'complete' });
});

test('atomic toggle guard supports an authoritatively absent status', async () => {
  const { applyLinkedSubitemStatusToggle } = await importProductionHelpers();
  const frontmatter = { title: 'Child' };

  assert.equal(applyLinkedSubitemStatusToggle(frontmatter, 'status', '', 'todo'), true);
  assert.deepEqual(frontmatter, { title: 'Child', status: 'todo' });
});

test('rendered revision token distinguishes an absent token from an intentionally empty status', async () => {
  const { readLinkedSubitemRenderedStatusToken } = await importProductionHelpers();
  assert.equal(readLinkedSubitemRenderedStatusToken({ getAttribute: () => null }), null);
  assert.equal(readLinkedSubitemRenderedStatusToken({ getAttribute: () => '' }), '');
  assert.equal(readLinkedSubitemRenderedStatusToken({ getAttribute: () => ' Working ' }), 'working');
});

test('custom and native click paths share the guarded commit and remain handled after suppression', () => {
  const customHandler = sourceBetween(
    serviceSource,
    'private async handleCustomCheckboxClick',
    'private async handleNativeCheckboxInSubitemLine',
  );
  const nativeHandler = sourceBetween(
    serviceSource,
    'private async handleNativeCheckboxInSubitemLine',
    'private async commitLinkedSubitemToggle',
  );

  for (const handler of [customHandler, nativeHandler]) {
    assert.match(handler, /evt\.preventDefault\(\);[\s\S]*evt\.stopImmediatePropagation\(\);/);
    assert.match(handler, /const displayedStatus = readLinkedSubitemRenderedStatusToken\(/);
    assert.match(handler, /if \(displayedStatus == null\)/);
    assert.match(handler, /await this\.commitLinkedSubitemToggle\(childFile, displayedStatus, nextStatus/);
    assert.match(handler, /return true;/);
    assert.doesNotMatch(handler, /frontmatterMutationService\.process\(/);
  }
});

test('rendering records the exact status revision that click handlers guard against', () => {
  const modelSource = readFileSync(
    new URL('../src/services/subitem-line-model.ts', import.meta.url),
    'utf8',
  );
  const rowSource = readFileSync(
    new URL('../src/services/linked-subitem-row-builder.ts', import.meta.url),
    'utf8',
  );

  assert.match(modelSource, /renderedStatus: status/);
  assert.match(rowSource, /button\.dataset\.linkedSubitemStatus = model\.renderedStatus/);
  assert.match(serviceSource, /li\.dataset\.linkedSubitemStatus = model\.renderedStatus/);
  assert.match(serviceSource, /'data-linked-subitem-status': model\.renderedStatus/);
  assert.doesNotMatch(
    sourceBetween(serviceSource, 'private async handleCustomCheckboxClick', 'private async commitLinkedSubitemToggle'),
    /getNormalizedStatus\(childFile\)/,
  );
});

test('shared commit refreshes and reports success only for a changed outcome', () => {
  const commit = sourceBetween(
    serviceSource,
    'private async commitLinkedSubitemToggle',
    'private resolveMarkdownViewForElement',
  );
  const changedBranch = sourceBetween(
    commit,
    "if (result === 'changed')",
    "} else if (result === 'stale')",
  );
  const nonChangedBranches = commit.slice(commit.indexOf("} else if (result === 'stale')"));

  assert.match(commit, /frontmatterMutationService\.processGuardedWithOutcome/);
  assert.match(commit, /applyLinkedSubitemStatusToggle\(frontmatter, statusKey, displayedStatus, nextStatus\)/);
  assert.match(changedBranch, /refreshReferencesForChild/);
  assert.match(changedBranch, /scheduleDecorate/);
  assert.match(changedBranch, /refreshLivePreviewEditors/);
  assert.match(changedBranch, /new Notice\(`Set /);
  assert.doesNotMatch(nonChangedBranches, /refreshReferencesForChild|refreshLivePreviewEditors|new Notice\(`Set /);
  assert.match(nonChangedBranches, /changed before it could be toggled\. Try again\./);
  assert.match(nonChangedBranches, /Couldn’t update .*Try again\./);
});
