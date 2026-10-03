import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const apiSource = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
const managerSource = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');
const openingSource = readFileSync(new URL('../src/services/note-opening-service.ts', import.meta.url), 'utf8');

async function importTypeScriptUtility(relativeUrl) {
  const source = readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}
const requestUtility = await importTypeScriptUtility('../src/utils/editable-note-preview-request.ts');

test('legacy preview requests retain path and caller validation', () => {
  const anchorEl = { isConnected: true };
  assert.deepEqual(requestUtility.normalizeEditableNotePreviewRequest({
    sourcePluginId: ' tps-calendar-base ', filePath: 'Calendar\\New.md', anchorEl, focusEditor: true,
  }), { sourcePluginId: 'tps-calendar-base', filePath: 'Calendar/New.md', anchorEl, focusEditor: true });
  for (const request of [
    null,
    { sourcePluginId: '', filePath: 'Note.md', anchorEl },
    { sourcePluginId: 'bad/id', filePath: 'Note.md', anchorEl },
    { sourcePluginId: 'calendar', filePath: '../Note.md', anchorEl },
    { sourcePluginId: 'calendar', filePath: '/Note.md', anchorEl },
    { sourcePluginId: 'calendar', filePath: 'Note.md', anchorEl: { isConnected: false } },
  ]) assert.equal(requestUtility.normalizeEditableNotePreviewRequest(request), null);
});

test('GCM UI v2 routes preview to core Page Preview with native editor fallback', () => {
  const uiApi = apiSource.slice(apiSource.indexOf('ui: {'), apiSource.indexOf('diagnostics: {'));
  assert.match(uiApi, /ui:\s*\{\s*version:\s*2,/u);
  assert.match(uiApi, /presentCreatedNote:\s*\(request: CreatedNoteRequest\) => plugin\.noteOpeningService\.present\(request\)/u);
  assert.match(uiApi, /shouldForceBaseLinkPreview:\s*\(\) => plugin\.settings\.enableBasesForcedLinkPreview === true/u);
  assert.match(uiApi, /openEditableNotePreview:\s*async \(request: unknown\): Promise<boolean>/u);
  assert.match(uiApi, /plugin\.showNativeNotePreview\(file, normalized\.anchorEl\)/u);
  assert.match(uiApi, /previewed \|\| await plugin\.noteOpeningService\.open\(file\)/u);
  assert.doesNotMatch(uiApi, /showBaseLinkEditablePreview|spawnPopover/u);
  assert.match(openingSource, /await this\.open\(file, context\)/u);
  assert.doesNotMatch(openingSource, /showBaseLinkEditablePreview|createElement\('textarea'\)/u);
});

test('legacy preview API requests core Page Preview and falls back to native Open', async () => {
  const syntax = ts.createSourceFile('plugin-api.ts', apiSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let expression;
  const visit = node => {
    if (ts.isPropertyAssignment(node) && node.name.getText(syntax) === 'openEditableNotePreview') {
      expression = node.initializer.getText(syntax);
    } else ts.forEachChild(node, visit);
  };
  visit(syntax);
  assert.ok(expression);
  const javascript = ts.transpileModule(`const open = ${expression};`, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  class TFile { constructor(path) { this.path = path; this.extension = 'md'; } }
  class Anchor { constructor() { this.isConnected = true; this.ownerDocument = { defaultView: { HTMLElement: Anchor } }; } }
  const file = new TFile('Inbox/New.md');
  const openings = [], previews = [];
  let nativePreviewAvailable = true;
  const plugin = {
    app: { vault: { getAbstractFileByPath: path => path === file.path ? file : null } },
    noteOpeningService: { open: async target => { openings.push(target); return true; } },
    showNativeNotePreview: (target, anchor) => { previews.push([target, anchor]); return nativePreviewAvailable; },
    persistentMenuManager: { showBaseLinkEditablePreview: () => assert.fail('custom card must not be called') },
  };
  const logger = { flow() {}, flowWarn() {}, flowError() {} };
  const open = new Function('plugin', 'logger', 'normalizeEditableNotePreviewRequest', 'normalizePath', 'TFile',
    `${javascript}\nreturn open;`)(plugin, logger, requestUtility.normalizeEditableNotePreviewRequest, path => path, TFile);
  const anchor = new Anchor();
  assert.equal(await open({ sourcePluginId: 'calendar', filePath: file.path, anchorEl: anchor }), true);
  assert.deepEqual(previews, [[file, anchor]]);
  assert.deepEqual(openings, []);
  nativePreviewAvailable = false;
  assert.equal(await open({ sourcePluginId: 'calendar', filePath: file.path, anchorEl: new Anchor() }), true);
  assert.deepEqual(openings, [file]);
  assert.equal(await open({ sourcePluginId: 'calendar', filePath: '../New.md', anchorEl: new Anchor() }), false);
  assert.deepEqual(openings, [file]);
});

test('custom hover editor is absent; Base click preview uses only the registered core source', () => {
  assert.doesNotMatch(managerSource, /showBaseLinkEditablePreview|baseLinkPreviewEditorEl|forceCloseBaseLinkEditablePreview/u);
  assert.doesNotMatch(mainSource, /obsidian-hover-editor|spawnPopover|showBaseLinkEditablePreview/u);
  assert.match(mainSource, /registerHoverLinkSource\(TPSGlobalContextMenuPlugin\.NOTE_PREVIEW_SOURCE/u);
  assert.match(mainSource, /this\.app\.workspace\.trigger\('hover-link'/u);
  assert.match(mainSource, /registerBasesLinkPreviewHandler\(\)/u);
  assert.match(mainSource, /this\.showNativeNotePreview\(file, anchorEl, this\.app\.workspace\.activeLeaf, event\)/u);
  assert.doesNotMatch(stylesSource, /tps-gcm-base-link-preview|tps-gcm-hover-editor-note-scale/u);
  assert.match(settingsSource, /addOption\('preview', 'Obsidian Page Preview'\)/u);
  assert.match(settingsSource, /setName\('Force previews for Base links'\)/u);
  assert.equal(existsSync(new URL('../src/utils/editable-note-preview-document.ts', import.meta.url)), false);
});
