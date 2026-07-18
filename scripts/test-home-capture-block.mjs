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
