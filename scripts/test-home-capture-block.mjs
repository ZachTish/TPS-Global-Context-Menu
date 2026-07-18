import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadCaptureBlockModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/home-capture-block.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const captureBlock = await loadCaptureBlockModule();

test('formatHomeCaptureBlock creates plain and task capture blocks', () => {
  assert.equal(
    captureBlock.formatHomeCaptureBlock('first line\nsecond line', '09:15'),
    '- first line 09:15\n- second line 09:15\n',
  );
  assert.equal(
    captureBlock.formatHomeCaptureBlock('first line\nsecond line', '09:15', { task: true }),
    '- [ ] first line 09:15\n- [ ] second line 09:15\n',
  );
  assert.equal(
    captureBlock.formatHomeCaptureBlock('parent\n  child\nsecond root', '09:15'),
    '- parent 09:15\n    child\n- second root 09:15\n',
  );
  assert.equal(
    captureBlock.formatHomeCaptureBlock('\tfirst\n\t\tchild\n\tsecond', ''),
    '- first\n  \tchild\n- second\n',
  );
  assert.equal(captureBlock.formatHomeCaptureBlock('   ', '09:15'), '');
});

test('insertHomeCaptureBlock appends plain captures to the bottom by default', () => {
  const actual = captureBlock.insertHomeCaptureBlock('# Today\n\nBody\n', '- Capture 09:15\n');
  assert.equal(actual, '# Today\n\nBody\n\n- Capture 09:15\n');
});

test('insertHomeCaptureBlock inserts top captures after frontmatter', () => {
  const actual = captureBlock.insertHomeCaptureBlock(
    '---\nscheduled: 2026-07-04 00:00:00\n---\n\n# Today\n',
    '- Capture 09:15\n',
    { insertPosition: 'top' },
  );
  assert.equal(actual, '---\nscheduled: 2026-07-04 00:00:00\n---\n\n- Capture 09:15\n\n# Today\n');
});

test('insertHomeCaptureBlock creates the configured heading when missing', () => {
  const actual = captureBlock.insertHomeCaptureBlock(
    '# Today\n',
    '- Capture 09:15\n',
    { addHeading: true, heading: 'Inbox' },
  );
  assert.equal(actual, '# Today\n\n## Inbox\n\n- Capture 09:15\n');
});

test('insertHomeCaptureBlock appends inside an existing heading without eating the next section gap', () => {
  const actual = captureBlock.insertHomeCaptureBlock(
    '# Today\n\n## Capture\n\n- Existing 08:00\n\n## Later\n\nBody\n',
    '- Capture 09:15\n',
    { addHeading: true, heading: 'Capture' },
  );
  assert.equal(actual, '# Today\n\n## Capture\n\n- Existing 08:00\n- Capture 09:15\n\n## Later\n\nBody\n');
});

test('insertHomeCaptureBlock inserts at the top of an existing heading after heading whitespace', () => {
  const actual = captureBlock.insertHomeCaptureBlock(
    '# Today\n\n## Capture\n\n- Existing 08:00\n',
    '- Capture 09:15\n',
    { insertPosition: 'top', addHeading: true, heading: 'Capture' },
  );
  assert.equal(actual, '# Today\n\n## Capture\n\n- Capture 09:15\n- Existing 08:00\n');
});

test('capture heading discovery supports H1-H6 while ignoring frontmatter and fenced code', () => {
  const headings = captureBlock.listHomeCaptureHeadings([
    '---',
    '# YAML is not a heading',
    '---',
    '# Top ###',
    '',
    '```md',
    '## Backtick fence',
    '```',
    '  ## Section',
    '### Child',
    '#### Fourth',
    '##### Fifth',
    '###### Sixth',
    '~~~',
    '## Tilde fence',
    '~~~',
    '## Duplicate',
    '## Duplicate',
  ].join('\n'));

  assert.deepEqual(headings, [
    { line: 3, level: 1, text: 'Top', occurrence: 0, matchingCount: 1 },
    { line: 8, level: 2, text: 'Section', occurrence: 0, matchingCount: 1 },
    { line: 9, level: 3, text: 'Child', occurrence: 0, matchingCount: 1 },
    { line: 10, level: 4, text: 'Fourth', occurrence: 0, matchingCount: 1 },
    { line: 11, level: 5, text: 'Fifth', occurrence: 0, matchingCount: 1 },
    { line: 12, level: 6, text: 'Sixth', occurrence: 0, matchingCount: 1 },
    { line: 16, level: 2, text: 'Duplicate', occurrence: 0, matchingCount: 2 },
    { line: 17, level: 2, text: 'Duplicate', occurrence: 1, matchingCount: 2 },
  ]);
});

test('heading-target capture honors nested section boundaries and top or bottom insertion', () => {
  const source = [
    '# Root',
    '',
    '## Inbox',
    '',
    'Intro',
    '',
    '### Nested',
    '',
    'Nested body',
    '',
    '## Later',
    '',
    'Later body',
    '',
  ].join('\n');
  const target = captureBlock.listHomeCaptureHeadings(source).find((heading) => heading.text === 'Inbox');
  assert.ok(target);

  const bottom = captureBlock.insertHomeCaptureBlockUnderHeading(source, '- Captured 09:15\n', target, 'bottom');
  assert.equal(bottom.headingLine, 2);
  assert.equal(bottom.headingLevel, 2);
  assert.equal(bottom.content, [
    '# Root',
    '',
    '## Inbox',
    '',
    'Intro',
    '',
    '### Nested',
    '',
    'Nested body',
    '',
    '- Captured 09:15',
    '',
    '## Later',
    '',
    'Later body',
    '',
  ].join('\n'));

  const top = captureBlock.insertHomeCaptureBlockUnderHeading(source, '- Captured 09:15\n', target, 'top');
  assert.equal(top.content, [
    '# Root',
    '',
    '## Inbox',
    '',
    '- Captured 09:15',
    '',
    'Intro',
    '',
    '### Nested',
    '',
    'Nested body',
    '',
    '## Later',
    '',
    'Later body',
    '',
  ].join('\n'));
});

test('duplicate heading targets fail closed after line shifts or identity changes', () => {
  const source = '# Root\n\n## Log\n\nFirst\n\n## Log\n\nSecond\n';
  const targets = captureBlock.listHomeCaptureHeadings(source).filter((heading) => heading.text === 'Log');
  assert.equal(targets.length, 2);
  const shifted = `Prelude\n\n${source}`;
  assert.equal(
    captureBlock.insertHomeCaptureBlockUnderHeading(shifted, '- Captured 09:15\n', targets[1], 'bottom'),
    null,
  );
  assert.equal(
    captureBlock.insertHomeCaptureBlockUnderHeading(source.replace(/## Log\n\nSecond/u, '## Renamed\n\nSecond'), '- Capture\n', targets[1]),
    null,
  );
});

test('heading-target capture separates plain Markdown from adjacent section blocks', () => {
  const source = '# Root\n\n## Inbox\n\nIntro\n\n## Later\n';
  const target = captureBlock.listHomeCaptureHeadings(source).find((heading) => heading.text === 'Inbox');
  assert.ok(target);

  const bottom = captureBlock.insertHomeCaptureBlockUnderHeading(source, 'Captured 09:15\n', target, 'bottom');
  assert.equal(bottom.content, '# Root\n\n## Inbox\n\nIntro\n\nCaptured 09:15\n\n## Later\n');

  const top = captureBlock.insertHomeCaptureBlockUnderHeading(source, 'Captured 09:15\n', target, 'top');
  assert.equal(top.content, '# Root\n\n## Inbox\n\nCaptured 09:15\n\nIntro\n\n## Later\n');
});

test('prepareHomeCaptureDraft creates stable bottom and top editor slots', () => {
  const bottom = captureBlock.prepareHomeCaptureDraft('# Today', 'bottom');
  assert.deepEqual(bottom, {
    content: '# Today\n',
    startLine: 1,
    startOffset: 8,
  });

  const source = '---\nscheduled: 2026-07-11 00:00:00\n---\n\n# Today\n';
  const top = captureBlock.prepareHomeCaptureDraft(source, 'top');
  assert.equal(top.content, '---\nscheduled: 2026-07-11 00:00:00\n---\n\n\n\n# Today\n');
  assert.equal(top.startLine, 4);
  assert.deepEqual(
    captureBlock.prepareHomeCaptureDraft(top.content, 'top'),
    top,
    'reopening an unused top slot must not accumulate blank lines',
  );
  assert.deepEqual(
    captureBlock.resolveHomeCaptureDraftRange(top.content, top.startLine, ''),
    { from: top.startOffset, to: top.startOffset },
  );
  const topSnapshot = captureBlock.createHomeCaptureRangeSnapshot(top.content, top.startOffset, top.startOffset);
  assert.equal(
    captureBlock.replaceHomeCaptureRangeIfUnchanged(top.content, topSnapshot, [''], '- Capture 09:15'),
    '---\nscheduled: 2026-07-11 00:00:00\n---\n\n- Capture 09:15\n\n# Today\n',
  );
});

test('guarded capture replacement rejects outside prepends and appends', () => {
  const source = '# Today\nDraft';
  const snapshot = captureBlock.createHomeCaptureRangeSnapshot(source, 8, source.length);
  const allowedValues = new Set(['', 'D', 'Draft']);

  assert.equal(
    captureBlock.replaceHomeCaptureRangeIfUnchanged(source, snapshot, allowedValues, '- Draft 09:15\n'),
    '# Today\n- Draft 09:15\n',
  );
  assert.equal(
    captureBlock.replaceHomeCaptureRangeIfUnchanged(`external\n${source}`, snapshot, allowedValues, ''),
    null,
  );
  assert.equal(
    captureBlock.replaceHomeCaptureRangeIfUnchanged(`${source}\n- external`, snapshot, allowedValues, ''),
    null,
  );
});

test('guarded edit rollback restores only the exact snapshotted line revision', () => {
  const original = 'Before\nOriginal line\nAfter\n';
  const from = original.indexOf('Original line');
  const snapshot = captureBlock.createHomeCaptureRangeSnapshot(original, from, from + 'Original line'.length);
  const edited = `${snapshot.prefix}Edited line${snapshot.suffix}`;

  assert.equal(
    captureBlock.replaceHomeCaptureRangeIfUnchanged(edited, snapshot, ['Original line', 'Edited line'], 'Original line'),
    original,
  );
  assert.equal(
    captureBlock.replaceHomeCaptureRangeIfUnchanged(`New first line\n${edited}`, snapshot, ['Original line', 'Edited line'], 'Original line'),
    null,
  );
});
