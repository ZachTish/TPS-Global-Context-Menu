import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const leafResolverSource = readFileSync(new URL('../src/services/leaf-resolver.ts', import.meta.url), 'utf8');
const noteTitleSource = readFileSync(new URL('../src/services/note-title-render-service.ts', import.meta.url), 'utf8');
const persistentMenuSource = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');
const menuBuilderSource = readFileSync(new URL('../src/menu/menu-builder.ts', import.meta.url), 'utf8');
const panelActionSource = readFileSync(new URL('../src/menu/panel-action-service.ts', import.meta.url), 'utf8');

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

test('inline title activation intercepts markdown title clicks without waiting for rendered-title refresh', () => {
  const activationSource = noteTitleSource.slice(
    noteTitleSource.indexOf('handleInlineTitleActivation'),
    noteTitleSource.indexOf('handleInlineTitleKeydown'),
  );

  assert.doesNotMatch(activationSource, /tps-gcm-inline-title-frontmatter/);
  assert.match(activationSource, /event instanceof MouseEvent && event\.button !== 0/);
  assert.match(activationSource, /event instanceof PointerEvent && event\.button !== 0/);
  assert.match(noteTitleSource, /event\.preventDefault\(\);/);
  assert.match(noteTitleSource, /void this\.promptRenameTitle\(file\);/);
});

test('note menus show one plain clickable title row across native and panel surfaces', () => {
  assert.match(noteTitleSource, /const display = getPlainDisplayTitle\(rawTitle, file\.basename\)/);
  assert.match(menuBuilderSource, /setTitle\(`Title: \$\{displayTitle\}`\)/);
  assert.match(menuBuilderSource, /setSection\('tps-title'\)/);
  assert.match(menuBuilderSource, /void this\.promptRenameFile\(file\)/);
  assert.match(menuBuilderSource, /if \(String\(prop\.key \|\| ''\).*=== 'title'.*return;/);
  assert.match(panelActionSource, /setTitle\(`Title: \$\{getPlainDisplayTitle/);
  assert.doesNotMatch(panelActionSource, /setTitle\('Rename Title'\)/);
  assert.match(noteTitleSource, /'NoteTitle', 'rename:prompt'/);
  assert.match(noteTitleSource, /'NoteTitle', 'rename:done'/);
});

test('focused inline title is not rewritten during active native title editing', () => {
  assert.match(noteTitleSource, /document\.activeElement instanceof HTMLElement && titleEl\.contains\(document\.activeElement\)/);
  assert.match(noteTitleSource, /if \(document\.activeElement instanceof HTMLElement && titleEl\.contains\(document\.activeElement\)\) return;/);
});

test('generated Untitled frontmatter title can be cleared with Backspace', () => {
  assert.match(noteTitleSource, /handleInlineTitleKeydown\(event: KeyboardEvent\)/);
  assert.match(noteTitleSource, /handleInlineTitleKeyup\(event: KeyboardEvent\)/);
  assert.match(noteTitleSource, /event\.key !== 'Backspace' && event\.key !== 'Delete'/);
  assert.match(noteTitleSource, /document\.getSelection\(\)/);
  assert.match(noteTitleSource, /if \(visibleTitle\) return false;/);
  assert.match(noteTitleSource, /isGeneratedUntitledTitle\(file, visibleTitle\)/);
  assert.match(noteTitleSource, /delete frontmatter\[key\]/);
});

test('title icons are not rendered in strict source mode', () => {
  assert.match(persistentMenuSource, /isStrictSourceMode,/);
  assert.match(persistentMenuSource, /this\.plugin\.noteTitleRenderService\?\.scheduleInlineTitleRefresh\?\.\(targetView\);/);
  assert.match(persistentMenuSource, /if \(isStrictSourceMode\(view\)\) \{/);
  assert.match(persistentMenuSource, /this\.removeInlineTitleIcon\(view\);/);
  assert.match(persistentMenuSource, /private isStrictSourceMode\(view: MarkdownView\): boolean \{\s*return isStrictSourceMode\(view\);\s*\}/);
});

test('delayed and recurring title refreshes reconcile mobile title-icon remounts', () => {
  assert.match(noteTitleSource, /private refreshInlineTitleAndIcon\(view: MarkdownView\): void/);
  assert.match(noteTitleSource, /this\.refreshInlineTitleForView\(view\);\s*this\.plugin\.persistentMenuManager\?\.refreshInlineTitleIcon\(view\);/);
  assert.match(noteTitleSource, /refreshInlineTitles\(\): void \{[\s\S]*this\.refreshInlineTitleAndIcon\(view\)/);
  assert.match(noteTitleSource, /window\.setTimeout\(\(\) => this\.refreshInlineTitleAndIcon\(view\), delay\)/);
  assert.match(persistentMenuSource, /const scopedInlineTitle = \(\) => \(/);
  assert.match(persistentMenuSource, /if \(!previewView\) return scopedInlineTitle\(\)/);
  assert.match(persistentMenuSource, /if \(!sourceView\) return scopedInlineTitle\(\)/);
  assert.match(persistentMenuSource, /document\.activeElement instanceof HTMLElement && titleEl\.contains\(document\.activeElement\)/);
  assert.match(persistentMenuSource, /private ensureInlineTitleIcon\(view: MarkdownView\): void \{\s*if \(!this\.plugin\.settings\.enableInlinePersistentMenus\) \{\s*this\.removeInlineTitleIcon\(view\);\s*return;/);
});
