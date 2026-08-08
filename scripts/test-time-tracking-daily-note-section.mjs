import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const build = await esbuild.build({
  entryPoints: [
    fileURLToPath(new URL('../src/services/time-tracking-daily-note-section.ts', import.meta.url)),
  ],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});
const api = await import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);

const input = (overrides = {}) => ({
  heading: 'Time Tracking',
  placement: 'top',
  sessionHeading: '9:15 AM · Project Alpha',
  blockId: 'tps-time-tt-one',
  ...overrides,
});

test('top placement inserts the section immediately after frontmatter', () => {
  const source = '---\ntitle: Daily\ntags:\n  - day\n---\n\n# Existing title\nBody\n';
  const result = api.ensureTimeTrackingSessionSection(source, input());

  assert.equal(result.created, true);
  assert.equal(
    result.content,
    '---\ntitle: Daily\ntags:\n  - day\n---\n## Time Tracking\n\n### 9:15 AM · Project Alpha ^tps-time-tt-one\n\n\n# Existing title\nBody\n',
  );
  assert.deepEqual(api.resolveTimeTrackingSessionAnchor(result.content, 'tps-time-tt-one'), {
    headingLine: 7,
    contentLine: 8,
  });
});

test('bottom placement appends a new section after existing note content', () => {
  const source = '---\ntitle: Daily\n---\n\n# Existing title\nBody';
  const result = api.ensureTimeTrackingSessionSection(source, input({ placement: 'bottom' }));

  assert.equal(
    result.content,
    '---\ntitle: Daily\n---\n\n# Existing title\nBody\n\n## Time Tracking\n\n### 9:15 AM · Project Alpha ^tps-time-tt-one\n\n',
  );
});

test('top and bottom placement order sessions within an existing section', () => {
  const source = '## Time Tracking\n\n### Older ^older\n\nolder notes\n\n## Later\nKeep\n';
  const top = api.ensureTimeTrackingSessionSection(source, input());
  assert.ok(top.content.indexOf('^tps-time-tt-one') < top.content.indexOf('^older'));

  const bottom = api.ensureTimeTrackingSessionSection(
    source,
    input({ placement: 'bottom' }),
  );
  assert.ok(bottom.content.indexOf('^tps-time-tt-one') > bottom.content.indexOf('older notes'));
  assert.ok(bottom.content.indexOf('^tps-time-tt-one') < bottom.content.indexOf('## Later'));
});

test('reuses the first real matching heading and ignores YAML and fenced fake headings', () => {
  const source = [
    '---',
    'example: "## Time Tracking"',
    '---',
    '',
    '```md',
    '## Time Tracking',
    '```',
    '',
    '## Time Tracking',
    '',
    'Existing notes',
    '',
    '## Time Tracking',
    '',
    'Duplicate section',
    '',
  ].join('\n');
  const result = api.ensureTimeTrackingSessionSection(source, input());

  const realHeading = result.content.indexOf('## Time Tracking', result.content.indexOf('```', 10) + 3);
  const inserted = result.content.indexOf('^tps-time-tt-one');
  assert.ok(inserted > realHeading);
  assert.ok(inserted < result.content.indexOf('Existing notes'));
  assert.equal((result.content.match(/\^tps-time-tt-one/g) || []).length, 1);
});

test('preserves CRLF and does not normalize unrelated note bytes', () => {
  const source = '---\r\ntitle: Daily\r\n---\r\n\r\nBody  \r\n';
  const result = api.ensureTimeTrackingSessionSection(source, input());

  assert.equal(result.content.replace(/\r\n/g, '').includes('\n'), false);
  assert.match(result.content, /Body  \r\n$/);
  assert.ok(result.content.includes('^tps-time-tt-one\r\n\r\n'));
});

test('is idempotent for an existing stable session block id', () => {
  const first = api.ensureTimeTrackingSessionSection('', input());
  const second = api.ensureTimeTrackingSessionSection(
    first.content,
    input({ sessionHeading: 'Changed title', placement: 'bottom' }),
  );

  assert.equal(second.created, false);
  assert.equal(second.content, first.content);
  assert.equal((second.content.match(/\^tps-time-tt-one/g) || []).length, 1);
});

test('an unterminated fence prevents a fake heading from becoming the session container', () => {
  const source = '```md\n## Time Tracking\n';
  const result = api.ensureTimeTrackingSessionSection(source, input({ placement: 'bottom' }));

  assert.equal(result.content, '```md\n## Time Tracking\n\n## Time Tracking\n\n### 9:15 AM · Project Alpha ^tps-time-tt-one\n\n');
});

test('rollback removes only a still-empty generated anchor', () => {
  const generated = api.ensureTimeTrackingSessionSection('## Time Tracking\n\n', input()).content;
  const rolledBack = api.removeEmptyTimeTrackingSessionAnchor(generated, 'tps-time-tt-one');
  assert.equal(rolledBack.includes('^tps-time-tt-one'), false);

  const withNotes = generated.replace('\n\n', '\nA user note\n');
  assert.equal(api.removeEmptyTimeTrackingSessionAnchor(withNotes, 'tps-time-tt-one'), withNotes);
});
