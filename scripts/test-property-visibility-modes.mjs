import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const resolveProfiles = readFileSync(new URL('../src/resolve-profiles.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const constants = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const panelBuilder = readFileSync(new URL('../src/menu/panel-builder.ts', import.meta.url), 'utf8');
const persistentMenu = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const inlineDecoration = readFileSync(new URL('../src/services/inline-property-decoration-service.ts', import.meta.url), 'utf8');
const visibility = readFileSync(new URL('../src/services/custom-property-visibility.ts', import.meta.url), 'utf8');

test('custom property visibility distinguishes key presence from value presence', () => {
  assert.match(types, /showWhen\?: 'always' \| 'populated' \| 'exists' \| 'empty' \| 'blank' \| 'missing' \| 'never'/);
  assert.match(types, /inlineShowWhen\?: 'always' \| 'populated' \| 'exists' \| 'empty' \| 'blank' \| 'missing' \| 'never'/);
  assert.match(types, /contextMenuShowWhen\?: 'always' \| 'populated' \| 'exists' \| 'empty' \| 'blank' \| 'missing' \| 'never'/);
  assert.match(resolveProfiles, /surface: CustomPropertySurface = 'any'/);
  assert.match(resolveProfiles, /getCustomPropertySurfaceVisibilityMode\(property, surface\)/);
  assert.match(visibility, /surface === "inline"[\s\S]{0,180}property\.inlineShowWhen \|\| property\.showWhen \|\| "always"/);
  assert.match(visibility, /surface === "context"[\s\S]{0,180}property\.contextMenuShowWhen \|\| property\.showWhen \|\| "always"/);
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
  assert.match(persistentMenu, /resolveCustomProperties\([\s\S]{0,80}this\.plugin\.settings\.properties \|\| \[\][\s\S]{0,120}entries[\s\S]{0,120}new ViewModeService\(\)[\s\S]{0,80}'inline'/);
  assert.match(persistentMenu, /resolveCustomProperties\([\s\S]{0,80}this\.plugin\.settings\.properties \|\| \[\][\s\S]{0,120}entries[\s\S]{0,120}new ViewModeService\(\)[\s\S]{0,80}'inline'/);
  assert.match(readFileSync(new URL('../src/menu/menu-builder.ts', import.meta.url), 'utf8'), /resolveCustomProperties\(this\.plugin\.settings\.properties \|\| \[\], propertyEntries, new ViewModeService\(\), 'context'\)/);
});

test('property-row visibility actions target the inline override and refresh mounted panels immediately', () => {
  for (const source of [panelBuilder, persistentMenu]) {
    assert.match(source, /getCustomPropertySurfaceVisibilityMode\([^,]+, 'inline'\)/);
    assert.match(source, /createCustomPropertySurfaceVisibilityPatch\('inline', mode\)/);
    assert.match(source, /Use property visibility/);
    assert.match(source, /inlineShowWhen: undefined/);
    assert.match(source, /visibilityPatch\('always'\)/);
    assert.match(source, /applyCustomPropertyVisibilityUpdate\(\{/);
  }
  assert.match(visibility, /options\.commit\(properties\);[\s\S]{0,120}options\.refresh\(\);[\s\S]{0,220}await options\.persist\(\)/);
  assert.match(persistentMenu, /refreshMountedCustomPropertyPresentationViews\([\s\S]{0,220}ensureTopParentNav\(view, options\)/);
  assert.match(persistentMenu, /refreshBaseLinkPreviewProperties\(\)/);
  assert.match(persistentMenu, /refreshCustomPropertyPreviewSurfaces\(\)/);
});

test('GCM keeps Health properties out of its core catalog and retires only managed definitions', () => {
  assert.doesNotMatch(constants, /TPS_HEALTH_(?:FOOD|WORKOUT|GCM)_PROPERTIES/);
  assert.doesNotMatch(constants, /id: 'tps-health-/);
  assert.doesNotMatch(mainSource, /TPS_HEALTH_GCM_PROPERTIES|ensureHealthFoodProperties/);
  assert.match(mainSource, /private removeRetiredBundledCustomProperties\(/);
  assert.match(mainSource, /id\.startsWith\('tps-health-'\)/);
  assert.match(mainSource, /LEGACY_HEALTH_CUSTOM_PROPERTY_IDS\.has\(id\)/);
  assert.match(mainSource, /removedRetiredPropertyCount = normalizedProperties\.length - this\.settings\.properties\.length/);
  assert.match(mainSource, /migration:removed-retired-bundled-properties'[\s\S]{0,120}count: removedRetiredPropertyCount/);
  assert.doesNotMatch(mainSource, /this\.settings\.homeComponentActions\['workout-tracker'\]\s*=/);
  assert.match(panelBuilder, /const scopedProperties = resolveCustomProperties/);
  assert.match(panelBuilder, /configuredKeys = new Set\(\(this\.plugin\.settings\.properties \|\| \[\]\)/);
});

test('lean optional-property defaults stay off and the inline master toggle is authoritative', () => {
  for (const key of [
    'enableInlinePersistentMenus',
    'enableInLivePreview',
    'enableInPreview',
    'enableInSidePanels',
    'showCustomPropertiesInInlineUi',
    'showCustomPropertiesInContextMenu',
    'inheritNotebookNavigatorTagColors',
    'enableTimeTracking',
  ]) {
    assert.match(constants, new RegExp(`${key}: false`));
  }
  assert.match(types, /DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS[\s\S]{0,120}enabled: false,[\s\S]{0,80}autoApplyOnFileOpen: false/);
  assert.match(inlineDecoration, /private getInlinePropertyKeys\(\): Set<string> \{[\s\S]{0,160}showCustomPropertiesInInlineUi === false\) return keys/);
  assert.match(inlineDecoration, /private getInlineDateTimePropertyKeys\(\): Set<string> \{[\s\S]{0,160}showCustomPropertiesInInlineUi === false\) return keys/);
});

test('TPS Health metric rings use goal state instead of metric color for bounded goals', () => {
  assert.ok(panelBuilder.includes("type TPSHealthMetricState = 'good' | 'under' | 'over' | 'neutral';"));
  assert.ok(panelBuilder.includes('data-tps-health-state'));
  assert.match(panelBuilder, /wrapper\.className = `tps-gcm-health-metric tps-gcm-health-metric--\$\{display\.state\}`/);
  assert.match(panelBuilder, /if \(hasMin && hasMax\) \{[\s\S]{0,160}value < Math\.min\(min, max\)[\s\S]{0,160}value > Math\.max\(min, max\)[\s\S]{0,120}return 'good'/);
  assert.match(panelBuilder, /if \(hasMax\) return value > max \? 'over' : 'good'/);
  assert.match(panelBuilder, /if \(hasMin\) return value < min \? 'under' : 'good'/);
  assert.match(panelBuilder, /if \(state === 'good'\) return 'var\(--color-green\)'/);
  assert.match(panelBuilder, /if \(state === 'under' \|\| state === 'over'\) return 'var\(--color-red\)'/);
  assert.match(panelBuilder, /labelPercent: goal > 0 \? `\$\{percent\}%` : '--'/);
  assert.match(panelBuilder, /return `\/ \$\{this\.roundHealthMetricValue\(Math\.min\(min, max\)\)\}-\$\{this\.roundHealthMetricValue\(Math\.max\(min, max\)\)\} \$\{unit\}`\.trim\(\)/);
  assert.match(readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8'), /color: var\(--tps-gcm-health-color\);/);
});
