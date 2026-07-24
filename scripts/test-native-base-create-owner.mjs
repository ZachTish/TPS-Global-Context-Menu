import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const listSource = readFileSync(new URL('../src/tps-list/views/TpsListView.ts', import.meta.url), 'utf8');
const tableSource = readFileSync(new URL('../src/views/log-base-view.ts', import.meta.url), 'utf8');
const constantsSource = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
const dailyFeedSource = readFileSync(new URL('./fixtures/Daily Note Feed.base', import.meta.url), 'utf8');

test('native Bases create delegates to the owning TPS List view', () => {
  assert.match(mainSource, /registerTpsListNativeCreateHandler\(\)/);
  assert.match(mainSource, /getTpsListNativeCreateScope\(target\)/);
  assert.match(mainSource, /getVisibleTpsBaseCreateRoot\(scope, '\.tps-list-scroll'\)/);
  assert.match(mainSource, /await view\.createFileForView\(\)/);
  assert.match(mainSource, /evt\.stopImmediatePropagation\(\)/);
  assert.match(mainSource, /evt\.key !== 'Enter' && evt\.key !== ' '/);
  assert.match(listSource, /Object\.assign\(scrollEl, \{ __tpsListView: this \}\)/);
});

test('Daily Note Feed declares its selected note as the explicit task sink', () => {
  assert.match(constantsSource, /file\.path == this\.file\.path\s+    - task\.path == this\.file\.path/);
  assert.match(dailyFeedSource, /file\.path == this\.file\.path\s+    - task\.path == this\.file\.path/);
  assert.match(listSource, /resolveKanbanRootTaskTargetPath\(defaults\.targetPath/);
  assert.match(listSource, /for \(const root of \[\.\.\.roots\]\.reverse\(\)\)/);
  assert.match(listSource, /mergePriorityTaskCreationDefaults\(defaults, structured\)/);
  assert.match(listSource, /targetPath: higherPriority\.targetPathSpecified === true\s+\? higherPriority\.targetPath \?\? null\s+: lowerPriority\.targetPath \?\? null/);
});

test('native TPS List ownership cannot leak across neighboring Home components', () => {
  assert.match(mainSource, /'\.tps-home-panel'/);
  assert.match(mainSource, /const boundedOwner = target\.closest<HTMLElement>/);
  assert.match(mainSource, /getVisibleTpsBaseCreateRoot\(boundedOwner, rootSelector\) \? boundedOwner : null/);
  assert.match(mainSource, /getVisibleTpsBaseCreateRoot\(leaf, rootSelector\) \? leaf : null/);
});

test('native create ignores hidden stale custom views after a Base view switch', () => {
  assert.match(mainSource, /private getVisibleTpsBaseCreateRoot\(scope: HTMLElement, selector: string\): HTMLElement \| null/);
  assert.match(mainSource, /root\.isConnected && root\.getClientRects\(\)\.length > 0/);
  assert.match(mainSource, /return roots\.length === 1 \? roots\[0\] : null/);
  assert.match(listSource, /scrollEl\.removeClass\('tps-log-base'\)/);
  assert.match(listSource, /this\.scrollEl\.removeClass\('tps-list-scroll'\)/);
  assert.match(listSource, /__tpsListView === this\) delete/);
  assert.match(tableSource, /this\.containerEl\.removeClass\('tps-list-scroll'\)/);
  assert.match(tableSource, /this\.containerEl\.removeClass\('tps-log-base'\)/);
  assert.match(tableSource, /__tpsTableView === this\) delete/);
});

test('an in-flight TPS List create cannot fall through to native note creation', () => {
  assert.match(mainSource, /tpsNativeCreateInFlight === 'true'/);
  assert.match(mainSource, /delete listRoot\.dataset\.tpsNativeCreateInFlight/);
});
