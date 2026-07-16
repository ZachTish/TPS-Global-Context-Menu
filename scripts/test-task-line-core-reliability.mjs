import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function importBundled(relativePath) {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

const metadataPromise = importBundled('../src/utils/task-line-metadata.ts');
const taskBlockPromise = importBundled('../src/utils/task-block-move.ts');

test('task source titles preserve link markup while display titles unwrap links anywhere', async () => {
  const { getPlainTaskTitle, getTaskDisplayTitle, getTaskSourceTitle } = await metadataPromise;
  const line = '- [ ] [[Notes/Project#Next|Project]] follow up with [Pat](People/Pat.md) on [Board](https://example.test/a_(b)) and [[Team|team]] [scheduled:: 2026-07-14 09:00:00] #work';

  assert.equal(
    getTaskSourceTitle(line),
    '[[Notes/Project#Next|Project]] follow up with [Pat](People/Pat.md) on [Board](https://example.test/a_(b)) and [[Team|team]]',
  );
  assert.equal(getTaskDisplayTitle(line), 'Project follow up with Pat on Board and team');
  assert.equal(
    getPlainTaskTitle('Review [[Reference|the reference]] and [the board](https://example.test/board)'),
    'Review the reference and the board',
  );
});

test('inline-field scanning preserves balanced wikilinks inside bracket and parenthesis fields', async () => {
  const {
    getTaskSourceTitle,
    readInlineFieldValue,
    setInlineFieldValueOnTaskLine,
    setTaskTitle,
  } = await metadataPromise;
  const line = '- [ ] Review plan [parents:: [[Projects/Test]]] (related:: [[Projects/Other]]) [scheduled:: 2026-07-14] #work';

  assert.equal(readInlineFieldValue(line, 'parents'), '[[Projects/Test]]');
  assert.equal(readInlineFieldValue(line, 'related'), '[[Projects/Other]]');
  assert.equal(getTaskSourceTitle(line), 'Review plan');
  assert.equal(
    setTaskTitle(line, 'Review renamed'),
    '- [ ] Review renamed [parents:: [[Projects/Test]]] (related:: [[Projects/Other]]) [scheduled:: 2026-07-14] #work',
  );
  assert.equal(
    setInlineFieldValueOnTaskLine(line, 'parents', '[[Projects/New]]'),
    '- [ ] Review plan (related:: [[Projects/Other]]) [scheduled:: 2026-07-14] #work [parents:: [[Projects/New]]]',
  );
  assert.equal(
    setInlineFieldValueOnTaskLine(line, 'parents', null),
    '- [ ] Review plan (related:: [[Projects/Other]]) [scheduled:: 2026-07-14] #work',
  );
});

test('title and full-body edits normalize leading links and retain their local association', async () => {
  const {
    getTaskDisplayTitle,
    getTaskSourceTitle,
    readInlineFieldValue,
    readTaskAssociatedNotePath,
    setTaskEditableBody,
    setTaskTitle,
  } = await metadataPromise;
  const hidden = '%% tps-inline-props:{"externalId":"reminders:abc","remindersSyncedTitle":"Birthday Dinner"} %%';
  const legacy = `- [ ] [[Events/Birthday Dinner#2026-07-13|Birthday Dinner]] [parents:: [[2026-07-13]]] [scheduled:: 2026-07-13 17:45:00] [tpsId:: item_abc] ${hidden}`;

  const renamed = setTaskTitle(legacy, 'Birthday Dinner renamed');
  assert.equal(getTaskSourceTitle(renamed), 'Birthday Dinner renamed');
  assert.equal(getTaskDisplayTitle(renamed), 'Birthday Dinner renamed');
  assert.equal(readTaskAssociatedNotePath(renamed), 'Events/Birthday Dinner');
  assert.equal(readInlineFieldValue(renamed, 'parents'), '[[2026-07-13]]');
  assert.equal(readInlineFieldValue(renamed, 'scheduled'), '2026-07-13 17:45:00');
  assert.equal(readInlineFieldValue(renamed, 'tpsId'), 'item_abc');
  assert.match(renamed, /"externalId":"reminders:abc"/u);
  assert.equal((renamed.match(/tps-inline-props:/gu) || []).length, 1);
  assert.doesNotMatch(getTaskSourceTitle(renamed), /\[\[|\]\]/u);

  const edited = setTaskEditableBody(
    legacy,
    '[[Events/Birthday Dinner#2026-07-13|Birthday Dinner]] with cake [parents:: [[Family/Events]]]',
  );
  assert.equal(getTaskSourceTitle(edited), 'Birthday Dinner with cake');
  assert.equal(readTaskAssociatedNotePath(edited), 'Events/Birthday Dinner');
  assert.equal(readInlineFieldValue(edited, 'parents'), '[[Family/Events]]');
  assert.equal(readInlineFieldValue(edited, 'tpsId'), 'item_abc');
  assert.match(edited, /"externalId":"reminders:abc"/u);
  assert.equal((edited.match(/tps-inline-props:/gu) || []).length, 1);

  const linkedInput = setTaskTitle('- [ ] Old title', '[Project brief](Projects/Project%20Brief.md#Next) follow up');
  assert.equal(getTaskSourceTitle(linkedInput), 'Project brief follow up');
  assert.equal(readTaskAssociatedNotePath(linkedInput), 'Projects/Project Brief.md');

  const externalInput = setTaskTitle('- [ ] Old title', '[Website](https://example.test/event) follow up');
  assert.equal(getTaskSourceTitle(externalInput), 'Website follow up');
  assert.equal(readTaskAssociatedNotePath(externalInput), '');
});

test('clone cleanup strips every hidden TPS metadata carrier without removing visible fields', async () => {
  const { readInlineFieldValue, stripTaskInlinePropsMetadata } = await metadataPromise;
  const encoded = encodeURIComponent(JSON.stringify({ externalId: 'encoded', associatedNotePath: 'Notes/Encoded.md' }));
  const line = [
    '- [ ] Clone me [scheduled:: 2026-07-14] [parents:: [[Projects/Test]]]',
    '%% tps-inline-props:{"externalId":"raw","associatedNotePath":"Notes/Raw.md"} %%',
    '<!-- tps-inline-props: {"externalId":"html-comment"} -->',
    `[tpsInlineProps:: ${encoded}]`,
    '<span data-tps-inline-props="{&quot;externalId&quot;:&quot;span&quot;}"></span>',
    '[^tps-inline:clone]: payload',
  ].join(' ');
  const stripped = stripTaskInlinePropsMetadata(line);

  assert.doesNotMatch(stripped, /tps-inline|data-tps|externalId|associatedNotePath|payload/iu);
  assert.equal(readInlineFieldValue(stripped, 'scheduled'), '2026-07-14');
  assert.equal(readInlineFieldValue(stripped, 'parents'), '[[Projects/Test]]');
  assert.match(stripped, /^- \[ \] Clone me/u);
});

test('task relocation uses exact and stable identities and refuses ambiguous fallback matches', async () => {
  const { findCurrentTaskLineIndex } = await taskBlockPromise;

  const exact = '- [ ] Exact task [tpsId:: exact_1]';
  assert.equal(findCurrentTaskLineIndex(['before', exact], 1, exact, 'Exact task'), 1);
  assert.equal(findCurrentTaskLineIndex([exact, 'before'], 1, exact, 'Exact task'), 0);

  const staleById = '- [ ] Original title [tpsId:: stable_1]';
  assert.equal(
    findCurrentTaskLineIndex(['- [ ] Renamed elsewhere [tpsId:: stable_1]'], 4, staleById, 'Original title'),
    0,
  );
  const staleBySubitem = '- [ ] Original child [subitemId:: child_1]';
  assert.equal(
    findCurrentTaskLineIndex(['- [ ] Renamed child [subitemId:: child_1]'], 3, staleBySubitem, 'Original child'),
    0,
  );

  const legacy = '- [ ] [[Notes/Project#Next|Project]] [scheduled:: 2026-07-14]';
  assert.equal(
    findCurrentTaskLineIndex(['- [ ] Project [scheduled:: 2026-07-15]'], 5, legacy, '[[Notes/Project#Next|Project]]'),
    0,
  );
  assert.equal(
    findCurrentTaskLineIndex(['- [ ] Project', '- [ ] Project [scheduled:: 2026-07-15]'], 5, legacy, 'Project'),
    -1,
  );
  assert.equal(
    findCurrentTaskLineIndex([exact, exact], 9, exact, 'Exact task'),
    -1,
  );
  const duplicateIdentity = '- [ ] Original [tpsId:: duplicate_1]';
  assert.equal(
    findCurrentTaskLineIndex(
      ['- [ ] Only this title [tpsId:: duplicate_1]', '- [ ] Another title [tpsId:: duplicate_1]'],
      8,
      duplicateIdentity,
      'Only this title',
    ),
    -1,
  );
});

test('daily-note migrated source blocks shed clone identities while destination blocks stay authoritative', async () => {
  const { readInlineFieldValue } = await metadataPromise;
  const { buildDailyNoteScratchpadMovedTaskBlock, insertTaskBlockAfterFrontmatter } = await taskBlockPromise;
  const sourceBlock = [
    '- [ ] Root task [scheduled:: 2026-07-14] [tpsId:: root_1] [subitemId:: root_sub] %% tps-inline-props:{"externalId":"event-root","associatedNotePath":"Notes/Root.md"} %%',
    '  - [ ] Child task [tpsId:: child_1] %% tps-inline-props:{"externalId":"event-child"} %%',
    '    Supporting detail %% tps-inline-props:{"associatedNotePath":"Notes/Detail.md"} %%',
  ];
  const original = [...sourceBlock];
  const scratchpad = buildDailyNoteScratchpadMovedTaskBlock(sourceBlock, { targetPath: 'Projects/Target.md' });

  assert.deepEqual(sourceBlock, original);
  assert.match(scratchpad[0], /^- \[>\] Root task/u);
  assert.equal(readInlineFieldValue(scratchpad[0], 'scheduled'), '2026-07-14');
  assert.equal(readInlineFieldValue(scratchpad[0], 'migratedTo'), '[[Projects/Target]]');
  assert.doesNotMatch(scratchpad.join('\n'), /tpsId|subitemId|tps-inline-props|externalId|associatedNotePath/u);
  assert.match(scratchpad[1], /^  - \[ \] Child task/u);
  assert.equal(scratchpad[2].trim(), 'Supporting detail');

  const destination = insertTaskBlockAfterFrontmatter('', sourceBlock).content;
  assert.match(destination, /\[tpsId:: root_1\]/u);
  assert.match(destination, /"associatedNotePath":"Notes\/Root.md"/u);
});
