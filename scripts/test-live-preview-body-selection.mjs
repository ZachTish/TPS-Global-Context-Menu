import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const tempDir = mkdtempSync(join(tmpdir(), 'tps-gcm-live-preview-selection-'));
const bundledPath = join(tempDir, 'live-preview-body-selection.mjs');

buildSync({
  entryPoints: [fileURLToPath(new URL('../src/services/live-preview-body-selection-service.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundledPath,
  logLevel: 'silent',
});

const {
  findMarkdownBodySelectionRange,
  isSelectAllShortcut,
} = await import(`${pathToFileURL(bundledPath).href}?${Date.now()}`);

test.after(() => rmSync(tempDir, { recursive: true, force: true }));

test('Live Preview Select All starts after a complete YAML frontmatter block', () => {
  const body = '# Heading\n\nBody text\n';
  const lf = `---\ntitle: Example\ntags:\n  - test\n---\n${body}`;
  const crlf = `---\r\ntitle: Example\r\n...\r\n${body.replaceAll('\n', '\r\n')}`;

  assert.deepEqual(findMarkdownBodySelectionRange(lf), {
    from: lf.indexOf(body),
    to: lf.length,
  });
  assert.deepEqual(findMarkdownBodySelectionRange(crlf), {
    from: crlf.indexOf(body.replaceAll('\n', '\r\n')),
    to: crlf.length,
  });
});

test('body selection handles empty bodies without selecting frontmatter', () => {
  const frontmatterOnly = '---\ntitle: Empty\n---';
  const trailingBreak = `${frontmatterOnly}\n`;
  assert.deepEqual(findMarkdownBodySelectionRange(frontmatterOnly), {
    from: frontmatterOnly.length,
    to: frontmatterOnly.length,
  });
  assert.deepEqual(findMarkdownBodySelectionRange(trailingBreak), {
    from: trailingBreak.length,
    to: trailingBreak.length,
  });
});

test('notes without valid frontmatter retain native Select All behavior', () => {
  assert.equal(findMarkdownBodySelectionRange('# Heading\nBody'), null);
  assert.equal(findMarkdownBodySelectionRange('---\ntitle: Unterminated\nBody'), null);
  assert.equal(findMarkdownBodySelectionRange(' ---\ntitle: Not frontmatter\n---\nBody'), null);
});

test('only unmodified Ctrl/Cmd+A is treated as Select All', () => {
  const event = (overrides = {}) => ({
    key: 'a', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false,
    ...overrides,
  });
  assert.equal(isSelectAllShortcut(event()), true);
  assert.equal(isSelectAllShortcut(event({ ctrlKey: false, metaKey: true, key: 'A' })), true);
  assert.equal(isSelectAllShortcut(event({ shiftKey: true })), false);
  assert.equal(isSelectAllShortcut(event({ altKey: true })), false);
  assert.equal(isSelectAllShortcut(event({ isComposing: true })), false);
  assert.equal(isSelectAllShortcut(event({ key: 'b' })), false);
});

test('the editor command is highest priority, Live Preview-only, and leaves Source mode native', () => {
  const serviceSource = readFileSync(new URL('../src/services/live-preview-body-selection-service.ts', import.meta.url), 'utf8');
  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(serviceSource, /Prec\.highest\(EditorView\.domEventHandlers/);
  assert.match(serviceSource, /isLivePreviewEditorRoot\(sourceRoot\)/);
  assert.match(serviceSource, /if \(!range\) return false/);
  assert.match(serviceSource, /EditorSelection\.single\(range\.from, range\.to\)/);
  assert.doesNotMatch(serviceSource, /isStrictSourceEditorRoot/);
  assert.match(mainSource, /registerEditorExtension\(createLivePreviewBodySelectionExtension\(\)\)/);
});
