import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function loadUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/item-property-mutation.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

const { applyTaskItemPropertyMutation } = await loadUtility();
const task = '- [ ] Example [priority:: low] [Parents:: [[Alpha]]] #one #two';

test('scalar batch properties replace while list properties add and deduplicate', () => {
  const scalar = applyTaskItemPropertyMutation(task, {
    id: 'priority', key: 'priority', label: 'Priority', type: 'selector',
  }, { key: 'priority', action: 'set', values: ['high'] });
  assert.match(scalar, /\[priority:: high\]/u);
  assert.doesNotMatch(scalar, /\[priority:: low\]/u);

  const parents = { id: 'parents', key: 'Parents', label: 'Parents', type: 'list', listItemType: 'link' };
  const added = applyTaskItemPropertyMutation(task, parents, {
    key: 'Parents', action: 'add', values: ['[[Beta]]', '[[Alpha]]'],
  });
  assert.match(added, /\[Parents:: \[\[Alpha\]\], \[\[Beta\]\]\]/u);
  const removed = applyTaskItemPropertyMutation(added, parents, {
    key: 'Parents', action: 'remove', values: ['[[Alpha]]'],
  });
  assert.doesNotMatch(removed, /\[\[Alpha\]\]/u);
  assert.match(removed, /\[Parents:: \[\[Beta\]\]\]/u);
});

test('tag-list batch mutations add, remove, and clear without changing other fields', () => {
  const tags = { id: 'tags', key: 'tags', label: 'Tags', type: 'list', listItemType: 'tag' };
  const added = applyTaskItemPropertyMutation(task, tags, {
    key: 'tags', action: 'add', values: ['two', 'three'],
  });
  assert.match(added, /#one/u);
  assert.match(added, /#two/u);
  assert.match(added, /#three/u);
  const removed = applyTaskItemPropertyMutation(added, tags, {
    key: 'tags', action: 'remove', values: ['one'],
  });
  assert.doesNotMatch(removed, /#one\b/u);
  assert.match(removed, /\[priority:: low\]/u);
  const cleared = applyTaskItemPropertyMutation(removed, tags, { key: 'tags', action: 'clear' });
  assert.doesNotMatch(cleared, /#[\w/-]+/u);
  assert.match(cleared, /\[Parents:: \[\[Alpha\]\]\]/u);
});
