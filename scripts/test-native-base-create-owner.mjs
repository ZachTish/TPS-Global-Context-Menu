import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const listSource = readFileSync(new URL('../src/tps-list/views/TpsListView.ts', import.meta.url), 'utf8');
const constantsSource = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
const dailyFeedSource = readFileSync(new URL('./fixtures/Daily Note Feed.base', import.meta.url), 'utf8');

test('native Bases create delegates to the owning TPS List view', () => {
  assert.match(mainSource, /registerTpsListNativeCreateHandler\(\)/);
  assert.match(mainSource, /getTpsListNativeCreateScope\(target\)/);
  assert.match(mainSource, /scope\.querySelector<HTMLElement>\('\.tps-list-scroll'\)/);
  assert.match(mainSource, /await view\.createFileForView\(\)/);
  assert.match(mainSource, /evt\.stopImmediatePropagation\(\)/);
  assert.match(mainSource, /evt\.key !== 'Enter' && evt\.key !== ' '/);
  assert.match(listSource, /Object\.assign\(scrollEl, \{ __tpsListView: this \}\)/);
});

test('Daily Note Feed declares its selected note as the explicit task sink', () => {
  assert.match(constantsSource, /file\.path == this\.file\.path\s+    - task\.path == this\.file\.path/);
  assert.match(dailyFeedSource, /file\.path == this\.file\.path\s+    - task\.path == this\.file\.path/);
  assert.match(listSource, /resolveKanbanRootTaskTargetPath\(defaults\.targetPath/);
  assert.match(listSource, /for \(const root of \[\.\.\.this\.getBaseFilterRoots\(\)\]\.reverse\(\)\)/);
  assert.match(listSource, /mergePriorityTaskCreationDefaults\(defaults, structured\)/);
  assert.match(listSource, /targetPath: higherPriority\.targetPath \?\? lowerPriority\.targetPath \?\? null/);
});

test('native TPS List ownership cannot leak across neighboring Home components', () => {
  assert.match(mainSource, /'\.tps-home-panel'/);
  assert.match(mainSource, /return owner\.querySelector<HTMLElement>\('\.tps-list-scroll'\) \? owner : null/);
  assert.match(mainSource, /const listRoots = Array\.from\(leaf\.querySelectorAll<HTMLElement>\('\.tps-list-scroll'\)\)/);
  assert.match(mainSource, /if \(listRoots\.length !== 1\) return null/);
});

test('an in-flight TPS List create cannot fall through to native note creation', () => {
  assert.match(mainSource, /tpsNativeCreateInFlight === 'true'/);
  assert.match(mainSource, /delete listRoot\.dataset\.tpsNativeCreateInFlight/);
});
