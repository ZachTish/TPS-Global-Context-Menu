import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const leafResolverSource = readFileSync(new URL('../src/services/leaf-resolver.ts', import.meta.url), 'utf8');
const noteTitleSource = readFileSync(new URL('../src/services/note-title-render-service.ts', import.meta.url), 'utf8');
const persistentMenuSource = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');

test('strict source mode is detected separately from live preview', () => {
  assert.match(leafResolverSource, /export function isStrictSourceMode\(view: MarkdownView\): boolean/);
  assert.match(leafResolverSource, /if \(mode === 'preview'\) return false/);
  assert.match(leafResolverSource, /if \(mode === 'source'\) \{/);
  assert.match(leafResolverSource, /state\?\.mode === 'source'/);
  assert.match(leafResolverSource, /state\.source === true/);
  assert.match(leafResolverSource, /\.markdown-source-view/);
  assert.match(leafResolverSource, /!sourceView\.classList\.contains\('is-live-preview'\)/);
});

test('frontmatter title rendering restores filename in strict source mode', () => {
  assert.match(noteTitleSource, /import \{ isStrictSourceMode \} from '\.\/leaf-resolver';/);
  assert.match(noteTitleSource, /refreshInlineTitle\(view: MarkdownView\): void/);
  assert.match(noteTitleSource, /scheduleInlineTitleRefresh\(view: MarkdownView/);
  assert.match(noteTitleSource, /\.markdown-source-view \[aria-label\*="click to edit title"\]/);
  assert.match(noteTitleSource, /if \(isStrictSourceMode\(view\)\) \{/);
  assert.match(noteTitleSource, /this\.restoreFilenameInlineTitle\(titleEl, file\);/);
  assert.match(noteTitleSource, /this\.setInlineTitleText\(titleEl, file\.basename\);/);
  assert.match(noteTitleSource, /delete titleEl\.dataset\.tpsGcmRenderedTitle/);
  assert.match(noteTitleSource, /titleEl\.removeClass\('tps-gcm-inline-title-frontmatter'\)/);
});

test('title icons are not rendered in strict source mode', () => {
  assert.match(persistentMenuSource, /isStrictSourceMode,/);
  assert.match(persistentMenuSource, /this\.plugin\.noteTitleRenderService\?\.scheduleInlineTitleRefresh\?\.\(targetView\);/);
  assert.match(persistentMenuSource, /if \(isStrictSourceMode\(view\)\) \{/);
  assert.match(persistentMenuSource, /this\.removeInlineTitleIcon\(view\);/);
  assert.match(persistentMenuSource, /private isStrictSourceMode\(view: MarkdownView\): boolean \{\s*return isStrictSourceMode\(view\);\s*\}/);
});
