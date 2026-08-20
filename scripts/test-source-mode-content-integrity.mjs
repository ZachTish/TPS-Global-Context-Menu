import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const tempDir = mkdtempSync(join(tmpdir(), 'tps-gcm-source-mode-'));
const bundledPath = join(tempDir, 'markdown-editor-mode.mjs');

buildSync({
  entryPoints: [fileURLToPath(new URL('../src/utils/markdown-editor-mode.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundledPath,
  logLevel: 'silent',
});

const {
  isLivePreviewEditorRoot,
  isStrictSourceEditorRoot,
} = await import(`${pathToFileURL(bundledPath).href}?${Date.now()}`);

function editorRoot({ markdown = true, livePreview = false, sourceClass = false } = {}) {
  const classes = new Set([
    ...(markdown ? ['markdown-source-view'] : []),
    ...(livePreview ? ['is-live-preview'] : []),
    ...(sourceClass ? ['is-source-mode'] : []),
  ]);
  return {
    matches(selector) {
      return selector === '.markdown-source-view' && classes.has('markdown-source-view');
    },
    classList: {
      contains(token) {
        return classes.has(token);
      },
    },
  };
}

test.after(() => rmSync(tempDir, { recursive: true, force: true }));

test('strict Source mode is the absence of Live Preview on a Markdown editor root', () => {
  const sourceWithoutOptionalClass = editorRoot();
  assert.equal(isStrictSourceEditorRoot(sourceWithoutOptionalClass), true);
  assert.equal(isLivePreviewEditorRoot(sourceWithoutOptionalClass), false);

  const sourceWithOptionalClass = editorRoot({ sourceClass: true });
  assert.equal(isStrictSourceEditorRoot(sourceWithOptionalClass), true);
  assert.equal(isLivePreviewEditorRoot(sourceWithOptionalClass), false);

  const livePreview = editorRoot({ livePreview: true });
  assert.equal(isStrictSourceEditorRoot(livePreview), false);
  assert.equal(isLivePreviewEditorRoot(livePreview), true);

  const unrelatedRoot = editorRoot({ markdown: false });
  assert.equal(isStrictSourceEditorRoot(unrelatedRoot), false);
  assert.equal(isLivePreviewEditorRoot(unrelatedRoot), false);
});

test('every TPS editor substitution fails closed in strict Source mode', () => {
  const inlineSource = readFileSync(new URL('../src/services/inline-property-decoration-service.ts', import.meta.url), 'utf8');
  const hidingSource = readFileSync(new URL('../src/services/hide-completed-checkboxes-service.ts', import.meta.url), 'utf8');
  const embedsSource = readFileSync(new URL('../src/services/virtual-base-embed-service.ts', import.meta.url), 'utf8');
  const linkedSubitemsSource = readFileSync(new URL('../src/services/linked-subitem-checkbox-service.ts', import.meta.url), 'utf8');
  const dailyNavSource = readFileSync(new URL('../src/handlers/daily-note-nav-manager.ts', import.meta.url), 'utf8');
  const persistentMenuSource = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');

  assert.match(inlineSource, /isStrictSourceEditorRoot\(root\).*?return Decoration\.none/s);
  assert.match(inlineSource, /handleScheduledTaskContinuationKeydown[\s\S]*?isStrictSourceEditorRoot\(root\).*?return false/);
  assert.match(inlineSource, /normalizeInlineDateTimeValues[\s\S]*?isStrictSourceEditorRoot\(root\).*?return;/);
  assert.match(hidingSource, /return isLivePreviewEditorRoot\(root\);/);
  assert.match(embedsSource, /return isLivePreviewEditorRoot\(root\);/);
  assert.match(
    linkedSubitemsSource,
    /buildEditorDecorations[\s\S]*?isStrictSourceMode\(markdownView\)[\s\S]*?Decoration\.none/,
  );
  assert.match(
    linkedSubitemsSource,
    /getLinkedSubitemRenderMode[\s\S]*?if \(isStrictSourceMode\(view\)\) return null/,
  );
  assert.match(
    persistentMenuSource,
    /ensureTopParentNav[\s\S]*?if \(this\.isStrictSourceMode\(view\)\)[\s\S]*?removeTopParentNav\(view\)[\s\S]*?removeBottomParentNav\(view\)/,
  );
  assert.match(
    dailyNavSource,
    /target\.leaf\.view instanceof MarkdownView && isStrictSourceMode\(target\.leaf\.view\)[\s\S]*?this\.detachNav\(\)/,
  );
  assert.match(
    persistentMenuSource,
    /private async ensureLinkedContextPanel[\s\S]*?\|\| isStrictSourceMode\(view\)[\s\S]*?this\.removeLinkedContextPanel\(view\);/,
  );
  assert.match(
    persistentMenuSource,
    /private isLinkedContextRenderActive[\s\S]*?&& !isStrictSourceMode\(view\);/,
  );

  for (const source of [inlineSource, hidingSource, embedsSource, linkedSubitemsSource]) {
    assert.doesNotMatch(source, /classList\.contains\(['"]is-source-mode['"]\)/);
  }
});

test('active mode transitions rebuild editor and injected surfaces from real view state', () => {
  const source = readFileSync(new URL('../src/events/register-events.ts', import.meta.url), 'utf8');
  assert.match(source, /getViewMode\(view\)/);
  assert.match(source, /isStrictSourceMode\(view\)/);
  assert.match(source, /plugin\.app\.workspace\.updateOptions\(\)/);
  assert.match(source, /hideCompletedCheckboxesService\?\.refreshAllEditors\(\)/);
  assert.match(source, /virtualBaseEmbedService\?\.scheduleRefresh\(0\)/);
  assert.doesNotMatch(source, /getViewModeSignature/);
});
