import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const resolveProfiles = readFileSync(new URL('../src/resolve-profiles.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const panelBuilder = readFileSync(new URL('../src/menu/panel-builder.ts', import.meta.url), 'utf8');
const persistentMenu = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');

test('custom property visibility distinguishes key presence from value presence', () => {
  assert.match(types, /showWhen\?: 'always' \| 'populated' \| 'exists' \| 'empty' \| 'blank' \| 'missing' \| 'never'/);
  assert.match(types, /inlineShowWhen\?: 'always' \| 'populated' \| 'exists' \| 'empty' \| 'blank' \| 'missing' \| 'never'/);
  assert.match(types, /contextMenuShowWhen\?: 'always' \| 'populated' \| 'exists' \| 'empty' \| 'blank' \| 'missing' \| 'never'/);
  assert.match(resolveProfiles, /surface: CustomPropertySurface = 'any'/);
  assert.match(resolveProfiles, /surface === 'inline'[\s\S]{0,120}property\.inlineShowWhen \|\| property\.showWhen \|\| 'always'/);
  assert.match(resolveProfiles, /surface === 'context'[\s\S]{0,120}property\.contextMenuShowWhen \|\| property\.showWhen \|\| 'always'/);
  assert.match(resolveProfiles, /mode === 'never'[\s\S]{0,80}return false/);
  assert.match(resolveProfiles, /mode === 'populated'[\s\S]{0,220}hasPopulatedValue\(context\.frontmatter, key\)/);
  assert.match(resolveProfiles, /mode === 'exists'[\s\S]{0,220}hasFrontmatterKey\(context\.frontmatter, key\)/);
  assert.match(resolveProfiles, /mode === 'blank'[\s\S]{0,260}hasFrontmatterKey\(context\.frontmatter, key\) && !hasPopulatedValue\(context\.frontmatter, key\)/);
  assert.match(resolveProfiles, /mode === 'missing'[\s\S]{0,220}!hasFrontmatterKey\(context\.frontmatter, key\)/);
  assert.match(resolveProfiles, /mode === 'empty'[\s\S]{0,220}!hasPopulatedValue\(context\.frontmatter, key\)/);
  assert.match(resolveProfiles, /function hasFrontmatterKey\(frontmatter: Record<string, unknown>, key: string\): boolean/);
});

test('property visibility UI names each key and value mode explicitly', () => {
  for (const source of [settings, panelBuilder]) {
    assert.match(source, /Property visibility/);
    assert.match(source, /Inline visibility/);
    assert.match(source, /Context menu visibility/);
    assert.match(source, /Only when key has value/);
    assert.match(source, /Only when key exists/);
    assert.match(source, /Only when key exists but is empty/);
    assert.match(source, /Only when key is missing/);
    assert.match(source, /Only when missing or empty/);
    assert.match(source, /Never show/);
  }

  for (const source of [panelBuilder, persistentMenu]) {
    assert.match(source, /Only show when key exists/);
    assert.match(source, /Only show when key exists but is empty/);
    assert.match(source, /Only show when key is missing/);
    assert.match(source, /Only show when missing or empty/);
    assert.match(source, /Never show/);
  }
});

test('inline and context menu visibility are resolved independently', () => {
  assert.match(panelBuilder, /resolveCustomProperties\(this\.plugin\.settings\.properties \|\| \[\], entries, new ViewModeService\(\), 'inline'\)/);
  assert.match(panelBuilder, /resolveCustomProperties\(this\.plugin\.settings\.properties \|\| \[\], entries, new ViewModeService\(\), 'inline'\)[\s\S]{0,120}\.filter\(\(prop\) => prop && prop\.showInCollapsed !== false\)/);
  assert.match(persistentMenu, /resolveCustomProperties\([\s\S]{0,160}new ViewModeService\(\),\s*'inline'/);
  assert.match(persistentMenu, /resolveCustomProperties\(this\.plugin\.settings\.properties \|\| \[\], entries, new ViewModeService\(\), 'inline'\)/);
  assert.match(persistentMenu, /resolveCustomProperties\(this\.plugin\.settings\.properties \|\| \[\], entries, new ViewModeService\(\), 'inline'\)/);
  assert.match(readFileSync(new URL('../src/menu/menu-builder.ts', import.meta.url), 'utf8'), /resolveCustomProperties\(this\.plugin\.settings\.properties \|\| \[\], propertyEntries, new ViewModeService\(\), 'context'\)/);
});
