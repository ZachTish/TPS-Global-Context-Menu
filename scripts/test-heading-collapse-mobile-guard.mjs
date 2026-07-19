import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/heading-collapse-on-open-service.ts', import.meta.url), 'utf8');
const constantsSource = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');

test('collapse-on-open is skipped on mobile before running fold automation', () => {
  assert.match(source, /import \{ Component, MarkdownView, Platform, TFile \} from 'obsidian';/);
  assert.match(source, /Platform\.isMobile \|\| this\.plugin\.settings\.collapseHeadingsOnOpen !== true \|\| wasAlreadyOpen/);
  assert.match(source, /Platform\.isMobile \|\| this\.plugin\.settings\.collapseHeadingsOnOpen !== true/);
  assert.match(settingsSource, /Desktop only\./);
  assert.match(settingsSource, /Mobile skips this automation/);
  assert.match(constantsSource, /collapseHeadingsOnOpen:\s*false/);
});

test('mobile native fold controls keep a real touch target', () => {
  assert.match(stylesSource, /--folding-offset: 32px/);
  assert.match(stylesSource, /\.cm-fold-indicator/);
  assert.match(stylesSource, /width: 28px !important/);
  assert.match(stylesSource, /\.collapse-indicator/);
  assert.match(stylesSource, /touch-action: manipulation !important/);
});
