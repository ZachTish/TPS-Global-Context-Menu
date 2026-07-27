import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
const logBase = read('src/views/log-base-view.ts');
const tpsList = read('src/tps-list/views/TpsListView.ts');
const tagModal = read('src/modals/TagSuggestModal.ts');

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('known vault tags normalize, deduplicate case-insensitively, and sort', async () => {
  const { collectKnownVaultTags } = await importBundled('../src/utils/known-tags.ts');
  const app = {
    metadataCache: {
      getTags: () => ({
        '#CAFÉ': 3,
        '#café': 2,
        '#work/project': 4,
        '#HOME': 2,
        home: 1,
        '#qa/typed': 3,
        '#仕事': 2,
        '#bad@tag': 1,
        '#emoji🙂': 1,
        '#': 1,
      }),
    },
  };
  assert.deepEqual(
    collectKnownVaultTags(app),
    ['café', 'home', 'qa/typed', 'work/project', '仕事'],
  );
});

test('the tag chooser normalizer preserves Unicode current tags and rejects invalid tokens', async () => {
  const { normalizeTagValue, parseTagInput } = await importBundled('../src/utils/tag-utils.ts');
  const current = ['#CAFÉ', '#仕事', '#work/project', '#bad@tag', '#emoji🙂', '#']
    .map((tag) => normalizeTagValue(tag))
    .filter(Boolean);

  assert.deepEqual(current, ['café', '仕事', 'work/project']);
  assert.deepEqual(
    parseTagInput('#café #仕事 #WORK/Project'),
    ['café', '仕事', 'work/project'],
    'Unicode hashtag tokenization must not truncate or drop picker-compatible tags',
  );
  assert.equal(normalizeTagValue('#bad@tag'), '');
  assert.equal(normalizeTagValue('#emoji🙂'), '');
  assert.match(
    tagModal,
    /\.map\(\(tag\) => normalizeTagValue\(tag\)\.toLocaleLowerCase\(\)\)/,
    'current selections must use the behaviorally tested Unicode-aware normalizer',
  );
});

test('the Base tag chooser is a searchable vault list rather than a text property editor', () => {
  assert.match(tagModal, /extends FuzzySuggestModal<string>/);
  assert.match(tagModal, /Search vault tags/);
  assert.match(tagModal, /getItems\(\): string\[\]/);
  assert.match(tagModal, /Selected · choose to remove/);
  assert.match(tagModal, /purpose: 'toggle tag'/);
  assert.doesNotMatch(tagModal, /TextInputModal/);
});

test('TPS Table renders empty Tags and Scheduled cells as isolated typed controls', () => {
  assert.match(logBase, /this\.isTagColumn\(column, configuredProperty\)/);
  assert.match(logBase, /this\.openTagCellEditor\(entry, configuredProperty\?\.key \|\| column\.key\)/);
  assert.match(logBase, /this\.isDatetimeColumn\(column, configuredProperty\)/);
  assert.match(logBase, /this\.openScheduledCellEditor\(/);
  assert.match(logBase, /cell\.setAttr\('role', 'button'\)/);
  assert.match(logBase, /cell\.addEventListener\('pointerdown',[\s\S]*?event\.stopPropagation\(\)/);
  assert.match(logBase, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(logBase, /new TagSuggestModal\(this\.plugin\.app, available/);
  assert.match(logBase, /toggleLogLineSemanticTag\(line, key, tag, selected\)/);
  assert.match(logBase, /new ScheduledModal\(this\.plugin\.app, current, timeEstimate, allDay/);
  assert.match(logBase, /setLogInlineFieldValue\(\s*next,\s*'timeEstimate'/);
  assert.match(logBase, /setLogInlineFieldValue\(\s*next,\s*'allDay'/);
});

test('TPS List renders empty typed cells and routes task and note edits through native pickers', () => {
  assert.match(tpsList, /const typedEmptyTarget = entityReference/);
  assert.match(tpsList, /this\.isTagProperty\(configuredProperty, propId\)/);
  assert.match(tpsList, /this\.isDatetimeProperty\(configuredProperty, propId\)/);
  assert.match(tpsList, /this\.openListTaskTagPicker\(file, task/);
  assert.match(tpsList, /this\.openListTaskScheduledPicker\(/);
  assert.match(tpsList, /new TagSuggestModal\(this\.app, \[\.\.\.collectKnownVaultTags\(this\.app\), \.\.\.current\]/);
  assert.match(tpsList, /toggleLogLineSemanticTag\(line, propertyKey, tag, selected\)/);
  assert.match(tpsList, /new ScheduledModal\(this\.app, current, timeEstimate, allDay/);
  assert.match(tpsList, /resolveExactLineRevisionIndex\(parts\.lines, targetLine - 1, expectedLine\)/);
  assert.match(tpsList, /source line changed while the property picker was open/);
  assert.match(tpsList, /setLogInlineFieldValue\(currentLine, property\.key, nextValue\)/);
  assert.match(tpsList, /collectTpsListInlineFields\(text\)/);
  assert.doesNotMatch(tpsList, /mergeEntityReferenceList\(fm\[actualKey\] \?\? rawValue/);
});

test('typed task mutations preserve sibling hidden fields through a full entity, tag, and schedule sequence', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  let line = '- [ ] QA Typed [tpsId:: qa-typed] <!-- [priority:: high] -->';

  line = logLines.setLogInlineFieldValue(
    line,
    'projects',
    '[[Projects/Alpha]], [[Entities#^project-line|Project line]]',
  );
  line = logLines.setLogInlineFieldValue(
    line,
    'contexts',
    '[[Contexts/Home]]',
  );
  line = logLines.setLogInlineFieldValue(line, 'tags', '#qa/typed');
  line = logLines.setLogInlineFieldValue(line, 'scheduled', '2026-08-15 09:30:00');
  line = logLines.setLogInlineFieldValue(line, 'timeEstimate', '45');
  line = logLines.setLogInlineFieldValue(line, 'allDay', null);

  assert.equal(metadata.getTaskDisplayTitle(line), 'QA Typed');
  assert.equal(metadata.readInlineFieldValue(line, 'tpsId'), 'qa-typed');
  assert.equal(metadata.readInlineFieldValue(line, 'priority'), 'high');
  assert.equal(
    metadata.readInlineFieldValue(line, 'projects'),
    '[[Projects/Alpha]], [[Entities#^project-line|Project line]]',
  );
  assert.equal(metadata.readInlineFieldValue(line, 'contexts'), '[[Contexts/Home]]');
  assert.equal(metadata.readInlineFieldValue(line, 'scheduled'), '2026-08-15 09:30:00');
  assert.equal(metadata.readInlineFieldValue(line, 'timeEstimate'), '45');
  assert.deepEqual(metadata.readTaskLineTags(line), ['qa/typed']);
  assert.equal(metadata.readInlineFieldValue(line, 'allDay'), '');
});

test('TPS List preserves hidden multi-link fields through its parse-to-render property model', async () => {
  const { collectTpsListInlineFields } = await importBundled(
    '../src/tps-list/task-inline-property-fields.ts',
  );
  const fields = collectTpsListInlineFields(
    '- [ ] QA row [tpsId:: qa-row] <!-- [projects:: [[Projects/Alpha]], [[Entities/Registry#^project-line|Project line]]] [contexts:: [[Contexts/Home]]] [tags:: #home #work] [scheduled:: 2026-08-15 09:30:00] [timeEstimate:: 45] --> ^qa-row',
  );
  const byKey = new Map(fields.map((field) => [field.key.toLocaleLowerCase(), field.value]));

  assert.equal(
    byKey.get('projects'),
    '[[Projects/Alpha]], [[Entities/Registry#^project-line|Project line]]',
  );
  assert.equal(byKey.get('contexts'), '[[Contexts/Home]]');
  assert.equal(byKey.get('tags'), '#home #work');
  assert.equal(byKey.get('scheduled'), '2026-08-15 09:30:00');
  assert.equal(byKey.get('timeestimate'), '45');
  assert.equal(byKey.get('tpsid'), 'qa-row');
});

test('tag lists accept whitespace or comma storage without dropping existing tags', async () => {
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  assert.deepEqual(logLines.readLogLineTags('#home #work'), ['home', 'work']);
  assert.deepEqual(logLines.readLogLineTags('#home, #work'), ['home', 'work']);
  assert.equal(logLines.addLogLineTag('#home #work', 'new'), '#home, #work, #new');
  assert.equal(logLines.removeLogLineTag('#home #work', 'home'), '#work');
});

test('built-in Base Tags cells render the complete semantic task tag set', async () => {
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const line = '- [ ] QA tags #visible <!-- [tags:: #hidden] [topicTags:: #isolated] -->';

  assert.deepEqual(
    logLines.readLogLinePropertyTags(line, 'tags', '#hidden'),
    ['visible', 'hidden'],
  );
  assert.deepEqual(
    logLines.readLogLinePropertyTags(line, 'tag', '#hidden'),
    ['visible', 'hidden'],
  );
  assert.deepEqual(
    logLines.readLogLinePropertyTags(line, 'topicTags', '#isolated'),
    ['isolated'],
    'a custom tag field must not absorb unrelated task hashtags',
  );
  assert.match(logBase, /readLogLinePropertyTags\(\s*entry\.line,/);
});

test('TPS List keeps visible and hidden tags together without duplicate display values', async () => {
  const { collectTpsListInlineFields } = await importBundled(
    '../src/tps-list/task-inline-property-fields.ts',
  );
  const fields = collectTpsListInlineFields(
    '- [ ] QA list tags #visible #same <!-- [tags:: #hidden, #same] -->',
  );
  const semanticTags = fields
    .filter((field) => /^(?:tag|tags)$/iu.test(field.key))
    .flatMap((field) => field.value.match(/#[\p{L}\p{N}_/-]+/gu) || []);

  assert.deepEqual(semanticTags, ['#hidden', '#same', '#visible']);
  assert.match(tpsList, /Array\.from\(new Set\(values\.map\(\(value\) => value\.trim\(\)\)\.filter\(Boolean\)\)\)/);
});

test('TPS Table semantic tag toggle removes raw hashtags and persists add/remove through its row mutation path', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const originalLine = '- [ ] QA Table tags #home <!-- [tags:: #work] [tpsId:: qa-table-tags] --> ^qa-table-tags';
  const entry = {
    lineNumber: 0,
    line: originalLine,
    fields: { tpsid: 'qa-table-tags', tags: '#work' },
  };
  const removed = logLines.mutateLogLineContent(
    `${originalLine}\n`,
    entry,
    (line) => logLines.toggleLogLineSemanticTag(line, 'tags', 'home', true),
  );

  assert.equal(removed.outcome, 'changed');
  const removedLine = removed.content.trimEnd();
  assert.deepEqual(metadata.readTaskLineTags(removedLine), ['work']);
  assert.doesNotMatch(removedLine, /(?:^|[ \t])#home(?:$|[ \t])/u);
  assert.equal(metadata.readInlineFieldValue(removedLine, 'tpsId'), 'qa-table-tags');
  assert.match(removedLine, /\^qa-table-tags$/u);

  const restored = logLines.mutateLogLineContent(
    removed.content,
    entry,
    (line) => logLines.toggleLogLineSemanticTag(line, 'tags', 'home', false),
  );
  assert.equal(restored.outcome, 'changed', 'stable tpsId resolves the row after its first mutation');
  assert.deepEqual(metadata.readTaskLineTags(restored.content.trimEnd()), ['work', 'home']);
  assert.equal(metadata.readInlineFieldValue(restored.content, 'tpsId'), 'qa-table-tags');
});

test('TPS List semantic tag toggle preserves nested layout while removing raw and hidden tags', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const lineItems = await importBundled('../src/utils/line-item-deletion.ts');
  const originalLine = '    - [ ] QA  List tags #home <!-- [tags:: #work] [tpsId:: qa-list-tags] --> ^qa-list-tags';
  let content = `Parent\n${originalLine}\n`;

  const mutateLikeTpsList = (expectedLine, tag, selected) => {
    const parts = lineItems.splitLineItemContent(content);
    const index = lineItems.resolveExactLineRevisionIndex(parts.lines, 1, expectedLine);
    assert.notEqual(index, -1);
    parts.lines[index] = logLines.toggleLogLineSemanticTag(
      parts.lines[index],
      'tags',
      tag,
      selected,
    );
    content = `${parts.lines.join(parts.newline)}${parts.endsWithNewline ? parts.newline : ''}`;
    return parts.lines[index];
  };

  const removedHome = mutateLikeTpsList(originalLine, 'home', true);
  assert.match(removedHome, /^ {4}- \[ \] QA  List tags/u);
  assert.deepEqual(metadata.readTaskLineTags(removedHome), ['work']);
  assert.equal(metadata.readInlineFieldValue(removedHome, 'tpsId'), 'qa-list-tags');
  assert.match(removedHome, /\^qa-list-tags$/u);

  const removedWork = mutateLikeTpsList(removedHome, 'work', true);
  assert.deepEqual(metadata.readTaskLineTags(removedWork), []);
  assert.equal(metadata.readInlineFieldValue(removedWork, 'tags'), '');
  assert.equal(metadata.readInlineFieldValue(removedWork, 'tpsId'), 'qa-list-tags');

  const restoredHome = mutateLikeTpsList(removedWork, 'home', false);
  assert.deepEqual(metadata.readTaskLineTags(restoredHome), ['home']);
  assert.equal(metadata.readInlineFieldValue(restoredHome, 'tpsId'), 'qa-list-tags');
});

test('semantic tag canonicalization merges singular and plural carriers without touching protected metadata', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const payload = '%% tps-inline-props:{"externalId":"remote","memo":"keep #protected [tag:: ghost] exactly"} %%';
  const original = `    - [ ] QA  canonical #home [tag:: work] [tags:: #other] [project:: #unrelated] ${payload} ^qa-canonical`;

  assert.deepEqual(
    metadata.readTaskLineTags(original),
    ['home', 'work', 'other'],
    'protected JSON and unrelated inline fields are not semantic task tags',
  );

  const withoutWork = logLines.toggleLogLineSemanticTag(original, 'tags', 'work', true);
  assert.match(withoutWork, /^ {4}- \[ \] QA  canonical #home/u);
  assert.deepEqual(metadata.readTaskLineTags(withoutWork), ['home', 'other']);
  assert.doesNotMatch(withoutWork, /\[tag:: work\]/u);
  assert.equal(metadata.readInlineFieldValue(withoutWork, 'tags'), '#home, #other');
  assert.equal(metadata.readInlineFieldValue(withoutWork, 'project'), '#unrelated');
  assert.ok(withoutWork.includes(payload), 'the protected carrier remains byte-identical');
  assert.match(withoutWork, /\^qa-canonical$/u);

  const withoutHome = logLines.toggleLogLineSemanticTag(withoutWork, 'tags', 'home', true);
  assert.deepEqual(metadata.readTaskLineTags(withoutHome), ['other']);
  assert.doesNotMatch(withoutHome, /(?:^|[ \t])#home(?:$|[ \t])/u);
  assert.equal(metadata.readInlineFieldValue(withoutHome, 'tags'), '#other');
  assert.equal(metadata.readInlineFieldValue(withoutHome, 'project'), '#unrelated');
  assert.ok(withoutHome.includes(payload), 'raw hashtag removal cannot rewrite protected JSON');
  assert.match(withoutHome, /^ {4}- \[ \] QA  canonical/u);
  assert.match(withoutHome, /\^qa-canonical$/u);
});

test('typed row mutation preserves CRLF, final newline, and an absolute-final block ID', async () => {
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const content = [
    '---',
    'kind: task-source',
    '---',
    '- [ ] QA row [tpsId:: qa-row] ^qa-row',
    '',
  ].join('\r\n');
  const entry = {
    lineNumber: 3,
    line: '- [ ] QA row [tpsId:: qa-row] ^qa-row',
    fields: { tpsid: 'qa-row' },
  };
  const result = logLines.mutateLogLineContent(
    content,
    entry,
    (line) => logLines.setLogInlineFieldValue(line, 'projects', '[[Projects/Alpha]]'),
  );

  assert.equal(result.outcome, 'changed');
  assert.equal((result.content.match(/\r\n/gu) || []).length, 4);
  assert.equal(result.content.endsWith('\r\n'), true);
  assert.match(
    result.content.split('\r\n')[3],
    /<!-- \[projects:: \[\[Projects\/Alpha\]\]\] --> \^qa-row$/u,
  );
});

test('generic hidden fields never corrupt supported TPS JSON metadata carriers', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const payload = JSON.stringify({
    externalId: 'remote',
    associatedNotePath: 'Notes/Associated.md',
    memo: '[projects:: protected JSON text]',
  });
  const carriers = [
    `%% tps-inline-props:${payload} %%`,
    `<!-- tps-inline-props: ${payload} -->`,
    `[tpsInlineProps:: ${encodeURIComponent(payload)}]`,
    `<span data-tps-inline-props="${payload.replaceAll('"', '&quot;')}"></span>`,
  ];

  for (const carrier of carriers) {
    const source = `- [ ] Protected ${carrier} ^protected`;
    const updated = logLines.setLogInlineFieldValue(
      source,
      'projects',
      '[[Projects/Alpha]]',
    );
    assert.equal(
      metadata.readTaskAssociatedNotePath(updated),
      'Notes/Associated.md',
      carrier,
    );
    assert.equal(metadata.readInlineFieldValue(updated, 'projects'), '[[Projects/Alpha]]');
    assert.match(updated, /protected(?:%20| |&quot;)JSON(?:%20| |&quot;)text/iu);
    assert.match(updated, /\^protected$/u);
  }
});

test('typed fields and tags ignore closed code and protected lookalikes while preserving hidden GCM fields', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const logLines = await importBundled('../src/views/log-line-utils.ts');
  const { collectTpsListInlineFields } = await importBundled(
    '../src/tps-list/task-inline-property-fields.ts',
  );
  const code = '`[projects:: [[Code/False]]] #code [tags:: #code-field]`';
  const protectedCarrier = '%% tps-inline-props:{"memo":"keep  [projects:: [[Protected/False]]] #protected [tags:: #protected-field]  exactly"} %%';
  const original = `- [ ] Semantic ${code} ${protectedCarrier} #visible <!-- [projects:: [[Projects/Real]]] [tags:: #hidden] [tpsId:: semantic-row] --> ^semantic-row`;

  assert.equal(
    metadata.readInlineFieldValue(original, 'projects'),
    '[[Projects/Real]]',
    'inline-code and TPS JSON lookalikes cannot shadow the real hidden field',
  );
  assert.deepEqual(metadata.readTaskLineTags(original), ['visible', 'hidden']);
  assert.deepEqual(metadata.readInlineTags(original), ['visible']);
  const listFields = collectTpsListInlineFields(original);
  assert.deepEqual(
    listFields
      .filter(({ key }) => /^(?:projects|tags?|tpsId)$/iu.test(key))
      .map(({ key, value }) => [key.toLocaleLowerCase(), value]),
    [
      ['projects', '[[Projects/Real]]'],
      ['tags', '#hidden'],
      ['tpsid', 'semantic-row'],
      ['tag', '#visible'],
    ],
    'TPS List exposes only semantic fields while retaining visible tags',
  );

  const replaced = logLines.setLogInlineFieldValue(
    original,
    'projects',
    '[[Projects/Replaced]]',
  );
  assert.equal(
    metadata.readInlineFieldValue(replaced, 'projects'),
    '[[Projects/Replaced]]',
  );
  assert.ok(replaced.includes(code), 'inline code remains byte-identical after a typed write');
  assert.ok(
    replaced.includes(protectedCarrier),
    'protected TPS metadata remains byte-identical after a typed write',
  );
  assert.equal(metadata.readInlineFieldValue(replaced, 'tpsId'), 'semantic-row');
  assert.deepEqual(metadata.readTaskLineTags(replaced), ['visible', 'hidden']);

  const removed = logLines.setLogInlineFieldValue(replaced, 'projects', null);
  assert.equal(metadata.readInlineFieldValue(removed, 'projects'), '');
  assert.ok(removed.includes(code), 'inline code remains byte-identical after field removal');
  assert.ok(
    removed.includes(protectedCarrier),
    'protected TPS metadata remains byte-identical after field removal',
  );
  assert.deepEqual(metadata.readTaskLineTags(removed), ['visible', 'hidden']);
  assert.match(removed, /<!-- \[tags:: #hidden\] \[tpsId:: semantic-row\] -->/u);
  assert.match(removed, /\^semantic-row$/u);

  const withoutVisible = metadata.removeInlineTagFromTaskLine(removed, 'visible');
  assert.deepEqual(metadata.readTaskLineTags(withoutVisible), ['hidden']);
  assert.ok(withoutVisible.includes(code), 'tag removal cannot rewrite inline code');
  assert.ok(
    withoutVisible.includes(protectedCarrier),
    'tag removal cannot rewrite protected TPS metadata',
  );
});

test('native task-line field writes never replace field-shaped code or protected payload text', async () => {
  const metadata = await importBundled('../src/utils/task-line-metadata.ts');
  const code = '`[scheduled:: 2099-01-01]`';
  const protectedCarrier = '%% tps-inline-props:{"memo":"keep  [scheduled:: 2098-01-01]  exactly"} %%';
  const original = `- [ ] Native ${code} ${protectedCarrier} [scheduled:: 2026-08-15] ^native-row`;

  const replaced = metadata.setInlineFieldValueOnTaskLine(
    original,
    'scheduled',
    '2026-08-16',
  );
  assert.equal(metadata.readInlineFieldValue(replaced, 'scheduled'), '2026-08-16');
  assert.ok(replaced.includes(code));
  assert.ok(replaced.includes(protectedCarrier));
  assert.match(replaced, /\[scheduled:: 2026-08-16\] \^native-row$/u);

  const removed = metadata.setInlineFieldValueOnTaskLine(replaced, 'scheduled', null);
  assert.equal(metadata.readInlineFieldValue(removed, 'scheduled'), '');
  assert.ok(removed.includes(code));
  assert.ok(removed.includes(protectedCarrier));
  assert.match(removed, /\^native-row$/u);
});
