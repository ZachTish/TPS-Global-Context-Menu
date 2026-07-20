import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as esbuild from 'esbuild';

const menuBuilderSource = readFileSync(new URL('../src/menu/menu-builder.ts', import.meta.url), 'utf8');
const panelActionSource = readFileSync(new URL('../src/menu/panel-action-service.ts', import.meta.url), 'utf8');
const panelBuilderSource = readFileSync(new URL('../src/menu/panel-builder.ts', import.meta.url), 'utf8');
const persistentMenuSource = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');
const bulkEditSource = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');

async function importModule(relativePath) {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

test('unarchive canonicalizes scalar, comma, hash, and list tag shapes before removing archive', async () => {
  const { normalizeTagList } = await importModule('../src/utils/tag-utils.ts');
  const withoutArchive = (raw) => normalizeTagList(raw)
    .filter((tag) => tag !== 'archive' && !tag.startsWith('archive/'));

  assert.deepEqual(withoutArchive('archive'), []);
  assert.deepEqual(withoutArchive('archive, #project'), ['project']);
  assert.deepEqual(withoutArchive('#archive #project'), ['project']);
  assert.deepEqual(withoutArchive(['#archive', 'Project', 'project']), ['project']);
  assert.deepEqual(withoutArchive(['archive/completed', 'project']), ['project']);

  assert.match(menuBuilderSource, /const tagsKey = Object\.keys\(frontmatter\)[\s\S]{0,100}key\.toLowerCase\(\) === 'tags'/);
  assert.match(menuBuilderSource, /const tags = normalizeTagList\(tagsKey \? frontmatter\[tagsKey\] : undefined\);/);
  assert.match(menuBuilderSource, /tag !== archiveTag && !tag\.startsWith\(`\$\{archiveTag\}\/`\)/);
  assert.match(menuBuilderSource, /if \(filteredTags\.length > 0\)[\s\S]{0,180}delete frontmatter\[tagsKey\]/);
});

test('link success notices consume committed counts and report zero as no change', () => {
  assert.match(menuBuilderSource, /const linkedCount = await this\.plugin\.bulkEditService\.linkToParent/);
  assert.match(menuBuilderSource, /const linkedCount = await this\.plugin\.bulkEditService\.linkChildren/);
  assert.match(menuBuilderSource, /new Notice\(linkedCount > 0/);
  assert.match(menuBuilderSource, /No new parent link was added/);
  assert.match(menuBuilderSource, /No new child links were added/);
  assert.match(menuBuilderSource, /No new attachments were embedded/);

  assert.match(panelActionSource, /showParentLinkResult\(linkedCount: number/);
  assert.match(panelActionSource, /showChildLinkResult\(linkedCount: number/);
  assert.match(panelActionSource, /showAttachmentLinkResult\(addedCount: number/);
  assert.match(panelActionSource, /linkedCount > 0/);
  assert.match(panelActionSource, /addedCount > 0/);
  assert.match(panelActionSource, /No new parent links were added/);
  assert.match(panelActionSource, /No new child links were added/);
  assert.match(panelActionSource, /No new attachments were embedded/);

  assert.match(panelBuilderSource, /const linkedCount = await this\.plugin\.bulkEditService\.linkToParent/);
  assert.match(panelBuilderSource, /const linkedCount = await this\.plugin\.bulkEditService\.linkChildren/);
  assert.match(panelBuilderSource, /new Notice\(linkedCount > 0/);

  for (const source of [menuBuilderSource, panelActionSource, panelBuilderSource]) {
    assert.doesNotMatch(source, /new Notice\(`Linked \$\{(?:files|unique|childFilesToAdd)\.length/);
    assert.doesNotMatch(source, /new Notice\(`Embedded \$\{added\} attachment\(s\)/);
  }
});

test('unlink notices distinguish removed, absent, partial, refused, and discovery failure', async () => {
  const {
    formatParentUnlinkAggregateNotice,
    formatSingleRelationshipUnlinkNotice,
  } = await importModule('../src/services/relationship-outcome.ts');

  assert.equal(formatSingleRelationshipUnlinkNotice('removed', 'parent link'), 'Removed parent link.');
  assert.equal(formatSingleRelationshipUnlinkNotice('absent', 'parent link'), 'No parent link existed.');
  assert.equal(
    formatSingleRelationshipUnlinkNotice('partial', 'parent link'),
    'Only part of parent link was removed; the other representation could not be verified or removed.',
  );
  assert.equal(
    formatSingleRelationshipUnlinkNotice('refused', 'parent link'),
    'Couldn’t remove parent link; the current state could not be verified.',
  );
  assert.equal(formatParentUnlinkAggregateNotice({
    discovery: 'ready',
    removedCount: 2,
    absentCount: 0,
    partialCount: 1,
    refusedCount: 1,
  }, 'Child'), 'Fully removed 2 parent links from Child. 1 partial; 1 refused.');
  assert.equal(formatParentUnlinkAggregateNotice({
    discovery: 'refused',
    removedCount: 0,
    absentCount: 0,
    partialCount: 0,
    refusedCount: 0,
  }, 'Child'), 'Couldn’t read the current parent links for Child; nothing was reported as removed.');

  assert.match(bulkEditSource, /async unlinkFromParent\([^)]*\): Promise<boolean>/);
  assert.match(bulkEditSource, /async unlinkFromParentWithOutcome\([^)]*\): Promise<RelationshipUnlinkOutcome>/);
  assert.match(bulkEditSource, /async unlinkFromAllParents\([^)]*\): Promise<number>/);
  assert.match(bulkEditSource, /async unlinkFromAllParentsWithOutcome\([^)]*\): Promise<RelationshipUnlinkAggregateOutcome>/);
  assert.match(bulkEditSource, /async unlinkAttachment\([^)]*\): Promise<boolean>/);
  assert.match(bulkEditSource, /async unlinkAttachmentWithOutcome\([^)]*\): Promise<AttachmentUnlinkOutcome>/);

  assert.equal(
    (menuBuilderSource.match(/const outcome = await this\.plugin\.bulkEditService\.unlinkFromParentWithOutcome/g) || []).length,
    2,
  );
  assert.match(menuBuilderSource, /formatSingleRelationshipUnlinkNotice/);
  assert.match(menuBuilderSource, /catch \(error\)/);

  assert.match(panelBuilderSource, /showParentUnlinkResult\([\s\S]{0,120}RelationshipUnlinkOutcome/);
  assert.match(panelBuilderSource, /showParentUnlinkAggregateResult\([\s\S]{0,120}RelationshipUnlinkAggregateOutcome/);
  assert.match(panelBuilderSource, /showAttachmentUnlinkResult\(outcome: AttachmentUnlinkOutcome/);
  assert.equal(
    (panelBuilderSource.match(/unlinkFromParentWithOutcome\([^;]+?\.then\(/gs) || []).length,
    3,
  );
  assert.equal(
    (panelBuilderSource.match(/unlinkFromAllParentsWithOutcome\([^;]+?\.then\(/gs) || []).length,
    3,
  );
  assert.equal(
    (panelBuilderSource.match(/unlinkAttachmentWithOutcome\([^;]+?\.then\(/gs) || []).length,
    1,
  );
  assert.match(panelBuilderSource, /formatSingleRelationshipUnlinkNotice/);
  assert.match(panelBuilderSource, /formatParentUnlinkAggregateNotice/);
  assert.equal((panelBuilderSource.match(/\.catch\(\(error\) => this\.reportAsyncPanelActionFailure/g) || []).length >= 9, true);

  assert.match(persistentMenuSource, /unlinkFromParentWithOutcome/);
  assert.match(persistentMenuSource, /formatSingleRelationshipUnlinkNotice/);
  assert.match(persistentMenuSource, /Persistent parent unlink failed/);
});

test('archive counts only files moved by the current action', () => {
  assert.match(
    panelBuilderSource,
    /if \(this\.isPathInFolder\(liveFile\.path, archiveFolder\)\) \{\s*continue;\s*\}/,
  );
  assert.doesNotMatch(
    panelBuilderSource,
    /if \(this\.isPathInFolder\(liveFile\.path, archiveFolder\)\) \{\s*movedCount \+= 1;/,
  );
  assert.match(panelBuilderSource, /movedCount > 0[\s\S]*'No files were archived\.'/);
});
