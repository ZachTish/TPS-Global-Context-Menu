import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'tps-capture-markdown-'));
const bundlePath = path.join(temporaryDirectory, 'core.mjs');

await build({
  entryPoints: [path.join(root, 'src/services/home-capture-markdown-core.ts')],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});

const core = await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`);

test.after(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test('capture Markdown starts empty despite its visible bullet marker', () => {
  assert.equal(core.captureMarkdownHasContent('- '), false);
  assert.equal(core.captureMarkdownHasContent('- [ ] '), false);
  assert.equal(core.captureMarkdownHasContent('- A useful thought'), true);
  assert.equal(core.captureMarkdownHasContent('Plain text'), true);
});

test('live-editor Markdown writes without adding a second list marker', () => {
  assert.equal(core.formatCaptureMarkdownForWrite('- Thought', '12:34'), '- Thought 12:34\n');
  assert.equal(core.formatCaptureMarkdownForWrite('- [ ] Task', '12:34'), '- [ ] Task 12:34\n');
  assert.equal(core.formatCaptureMarkdownForWrite('Plain text', '12:34'), 'Plain text 12:34\n');
  assert.equal(
    core.formatCaptureMarkdownForWrite('- One\n- [ ] Two\nPlain', '12:34'),
    '- One 12:34\n- [ ] Two 12:34\nPlain 12:34\n',
  );
  assert.equal(
    core.formatCaptureMarkdownForWrite('- Parent\n  - Child\n    - Grandchild\n- [ ] Second\n\nPlain', '12:34'),
    '- Parent 12:34\n  - Child\n    - Grandchild\n- [ ] Second 12:34\n\nPlain 12:34\n',
  );
  assert.equal(
    core.formatCaptureMarkdownForWrite('\t- Parent\n\t\t- Child\n\t- Second\n\t- ', '12:34'),
    '\t- Parent 12:34\n\t\t- Child\n\t- Second 12:34\n\t- \n',
  );
});

test('Mod-L semantics toggle bullet and checkbox markers without changing content', () => {
  assert.equal(core.toggleCaptureTaskMarker('- Write this down'), '- [ ] Write this down');
  assert.equal(core.toggleCaptureTaskMarker('- [ ] Write this down'), '- Write this down');
  assert.equal(core.toggleCaptureTaskMarker('- [x] Finished'), '- Finished');
  assert.equal(core.toggleCaptureTaskMarker('Plain text'), '- [ ] Plain text');
  assert.equal(
    core.toggleCaptureTaskMarkers('- One\n- Two\nPlain', [1, 3]),
    '- [ ] One\n- Two\n- [ ] Plain',
  );
});

test('Backspace at visible content start removes the complete list marker', () => {
  assert.deepEqual(core.removeCaptureListMarkerAtCursor('- Thought', 2), { text: 'Thought', cursor: 0 });
  assert.deepEqual(core.removeCaptureListMarkerAtCursor('- [ ] Task', 6), { text: 'Task', cursor: 0 });
  assert.equal(core.removeCaptureListMarkerAtCursor('- Thought', 4), null);
});

test('Enter continues non-empty lists and exits an empty list', () => {
  assert.deepEqual(core.continueCaptureListAtCursor('- Thought', 9), {
    from: 9,
    to: 9,
    insert: '\n- ',
    cursor: 12,
  });
  assert.deepEqual(core.continueCaptureListAtCursor('- [x] Task', 10), {
    from: 10,
    to: 10,
    insert: '\n- [ ] ',
    cursor: 17,
  });
  assert.deepEqual(core.continueCaptureListAtCursor('- ', 2), {
    from: 0,
    to: 2,
    insert: '',
    cursor: 0,
  });
});

test('capture modal uses the scoped live editor and one submission action', async () => {
  const [modalSource, editorSource] = await Promise.all([
    readFile(path.join(root, 'src/services/home-capture-service.ts'), 'utf8'),
    readFile(path.join(root, 'src/services/home-capture-markdown-editor.ts'), 'utf8'),
  ]);
  assert.match(modalSource, /new CaptureMarkdownEditor/);
  assert.doesNotMatch(modalSource, /const addTask =/);
  assert.match(modalSource, /preserveMarkdown: true/);
  assert.match(modalSource, /text: this\.options\.task === true \? 'Add task' : 'Capture'/);
  assert.match(editorSource, /key: 'Mod-l'/);
  assert.match(editorSource, /doc: options\.initialValue \?\? '- '/);
  assert.match(editorSource, /captureDecorations/);
  assert.match(editorSource, /markdown\(\)/);
});

test('Daily Note feed line editor uses guarded one-line atomic replacement', async () => {
  const modalSource = await readFile(path.join(root, 'src/services/home-capture-service.ts'), 'utf8');
  assert.match(modalSource, /class HomeCaptureLineEditModal extends Modal/);
  assert.match(modalSource, /resolveHomeCaptureLineRange\(content, zeroBasedLine\)/);
  assert.match(modalSource, /replaceHomeCaptureRangeIfUnchanged\(current, this\.snapshot/);
  assert.match(modalSource, /Line editing supports one non-empty line\./);
  assert.match(modalSource, /line-editor:saved/);
});
