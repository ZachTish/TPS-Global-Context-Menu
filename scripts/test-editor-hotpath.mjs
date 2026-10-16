import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const eventSource = readFileSync(new URL('../src/events/register-events.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const menuSource = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');

function findNode(sourceText, predicate) {
  const sourceFile = ts.createSourceFile('source.ts', sourceText, ts.ScriptTarget.Latest, true);
  let found;
  const visit = (node) => {
    if (found) return;
    if (predicate(node, sourceFile)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(found, 'expected source operation was not found');
  return found.getText(sourceFile);
}

function runTypeScript(source, context) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return vm.runInNewContext(compiled, context);
}

test('ordinary editor changes avoid whole-note reads and retired reconciliation', () => {
  const callbackSource = findNode(eventSource, (node) =>
    ts.isCallExpression(node)
      && node.expression.getText().endsWith('.workspace.on')
      && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === 'editor-change',
  );
  const callback = callbackSource.slice(callbackSource.indexOf(',' ) + 1, -1).trim();
  class TFile {
    constructor(path) {
      this.path = path;
      this.extension = 'md';
    }
  }
  const file = new TFile('Inbox/Typing.md');
  const other = new TFile('Inbox/Other.md');
  let active = file;
  let marks = 0;
  let fullReads = 0;
  let reconciliations = 0;
  let timers = 0;
  const plugin = {
    app: { workspace: { getActiveFile: () => active } },
    notebookNavigatorRuleService: { markUserEdited: () => { marks += 1; } },
    subitemRelationshipSyncService: { reconcileMarkdownParentText: () => { reconciliations += 1; } },
  };
  const handler = runTypeScript(`const handler = ${callback}; handler;`, {
    TFile,
    plugin,
    document: { activeElement: null },
    HTMLElement: class {},
    setTimeout: () => { timers += 1; },
  });
  const editor = { getValue: () => { fullReads += 1; return 'long note'; } };

  for (let i = 0; i < 1000; i += 1) handler(editor, { file });
  assert.equal(marks, 0, 'typing never invokes retired appearance maintenance');
  assert.ok(plugin.lastEditorChangeAt > 0);
  assert.equal(fullReads, 0);
  assert.equal(reconciliations, 0);
  assert.equal(timers, 0);

  active = other;
  handler(editor, { file });
  assert.equal(marks, 0, 'inactive editors also perform no appearance maintenance');
});

test('desktop typing creates no recurring title sweeps; mobile retains remount fallback', () => {
  const mobileFallback = findNode(mainSource, (node, sourceFile) =>
    ts.isIfStatement(node)
      && node.expression.getText(sourceFile) === 'Platform.isMobile'
      && node.thenStatement.getText(sourceFile).includes('this.noteTitleRenderService.refreshInlineTitles()'),
  );

  for (const isMobile of [false, true]) {
    let titleSweeps = 0;
    const intervals = [];
    const plugin = {
      registerInterval: (id) => id,
      noteTitleRenderService: { refreshInlineTitles: () => { titleSweeps += 1; } },
    };
    runTypeScript(`function install() { ${mobileFallback} } install.call(plugin);`, {
      Platform: { isMobile },
      plugin,
      window: { setInterval: (callback, delayMs) => { intervals.push({ callback, delayMs }); return 1; } },
    });
    assert.equal(intervals.length, isMobile ? 1 : 0);
    if (isMobile) {
      assert.equal(intervals[0].delayMs, 900);
      intervals[0].callback();
      assert.equal(titleSweeps, 1);
    } else {
      assert.equal(titleSweeps, 0);
    }
  }
});

test('desktop open, leaf, and layout events refresh the inline title with menus disabled', () => {
  const helperSource = findNode(eventSource, (node) =>
    ts.isVariableDeclaration(node) && node.name.getText() === 'refreshActiveInlineTitle',
  );
  assert.match(eventSource, /plugin\.app\.workspace\.onLayoutReady\(refreshActiveInlineTitle\)/u,
    'an already-open note receives an initial title after layout is ready');
  assert.match(menuSource, /private ensureInlineTitleIcon\(view: MarkdownView\): void \{\s*if \(!this\.plugin\.settings\.enableInlinePersistentMenus\) \{\s*this\.removeInlineTitleIcon\(view\);\s*return;/u,
    'the title refresh leaves the icon absent when inline menus are disabled');
  for (const eventName of ['file-open', 'active-leaf-change', 'layout-change']) {
    const callbackSource = findNode(eventSource, (node) =>
      ts.isCallExpression(node)
        && node.expression.getText().endsWith('.workspace.on')
        && ts.isStringLiteral(node.arguments[0])
        && node.arguments[0].text === eventName,
    );
    assert.match(callbackSource, /refreshActiveInlineTitle\(\)/u, `${eventName} must refresh the visible title`);
  }

  class TFile {
    constructor(path) { this.path = path; }
  }
  class MarkdownView {
    constructor(file) { this.file = file; }
  }
  const view = new MarkdownView(new TFile('Inbox/Opened.md'));
  let titleRefreshes = 0;
  let linkSweeps = 0;
  let iconRefreshes = 0;
  const plugin = {
    settings: { enableInlinePersistentMenus: false },
    app: { workspace: { getActiveViewOfType: () => view } },
    noteTitleRenderService: {
      refreshInlineTitle: () => { titleRefreshes += 1; },
      refreshInlineTitles: () => { linkSweeps += 1; },
    },
    persistentMenuManager: { refreshInlineTitleIcon: () => { iconRefreshes += 1; } },
  };
  const refresh = runTypeScript(`const ${helperSource}; refreshActiveInlineTitle;`, {
    plugin, MarkdownView, TFile,
  });
  refresh();
  assert.deepEqual({ titleRefreshes, linkSweeps, iconRefreshes }, {
    titleRefreshes: 1, linkSweeps: 0, iconRefreshes: 0,
  });
  view.file = null;
  refresh();
  assert.equal(titleRefreshes, 1, 'a non-Markdown leaf does not trigger title work');
});


test('property and creation routes have no appearance-rule follow-up writer', () => {
  const routes = [
    'menu/badge-renderer.ts', 'menu/menu-builder.ts', 'menu/menu-controller.ts',
    'menu/panel-builder.ts', 'services/property-row-service.ts',
    'services/note-operation-service.ts', 'services/subitem-creation-service.ts',
  ];
  for (const route of routes) {
    const source = readFileSync(new URL(`../src/${route}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /applyRulesToFile|applyNotebookNavigatorRulesToFile/, route);
  }
  const api = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
  const cycleStatus = findNode(api, node => ts.isPropertyAssignment(node) && node.name.getText() === 'cycleFileStatus');
  assert.doesNotMatch(cycleStatus, /applyRulesToFile/);
  assert.match(cycleStatus, /setFileStatus/);
});

test('title and subitem appearance use stored properties without rule evaluation or file reads', () => {
  for (const [path, iconMethod, colorMethod, colorHelper] of [
    ['menu/persistent-menu-manager.ts', 'resolveInlineTitleIconValue', 'resolveTitleIconColor', 'normalizeCssColorValue'],
    ['menu/subitem-metadata-service.ts', 'resolveFrontmatterIcon', 'resolveFrontmatterColor', 'isValidCssColor'],
  ]) {
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    let ruleLookups = 0;
    let reads = 0;
    const plugin = {
      settings: { notebookNavigatorRules: { enabled: true, frontmatterIconField: 'displayIcon' } },
      get notebookNavigatorRuleService() { ruleLookups++; throw Error('Retired evaluator accessed'); },
      app: { vault: { read() { reads++; }, cachedRead() { reads++; }, getMarkdownFiles() { reads++; } } },
    };
    const methods = [iconMethod, colorMethod, colorHelper, 'getFrontmatterValueCaseInsensitive']
      .map(name => findNode(source, node => ts.isMethodDeclaration(node) && node.name.getText() === name));
    const Resolver = runTypeScript(`class Resolver { ${methods.join('\n')} }; Resolver;`, {
      CSS: { supports: (_property, value) => value === 'red' || value === '#abcdef' },
    });
    const resolver = new Resolver();
    resolver.plugin = plugin;
    const fm = { icon: 'dumbbell', displayIcon: 'apple', color: '#abcdef' };
    const before = JSON.stringify(fm);
    for (let i = 0; i < 1000; i++) {
      const file = { path: `Inbox/Note ${i % 20}.md` };
      assert.equal(resolver[iconMethod](file, fm), 'dumbbell');
      assert.equal(resolver[colorMethod](fm, file), '#abcdef');
      assert.equal(resolver[iconMethod](file, { DISPLAYICON: 'apple' }), 'apple');
      assert.equal(resolver[iconMethod](file, {}), '');
      assert.equal(resolver[colorMethod]({}, file), '');
    }
    assert.equal(JSON.stringify(fm), before);
    assert.equal(ruleLookups, 0);
    assert.equal(reads, 0);
    assert.doesNotMatch(source, /getVisualOutputsForFile|resolveNotebookNavigatorRuleColor/);
  }
});


test('retired semantic-tag editor and evaluator are removed', () => {
  assert.equal(existsSync(new URL('../src/notebook-navigator-settings/hide-section.ts', import.meta.url)), false);
  const settings = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /HideSectionRenderer|hideRules|Semantic tags|Apply semantic tags/);
});


test('retired projection has no registration, preparation, cache or timer owner', () => {
  const api = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../src/services/property-migration-service.ts', import.meta.url), 'utf8');
  for (const source of [api, mainSource, migration]) {
    assert.doesNotMatch(source, /notebookNavigatorPresentation|setupPresentationProjection|invalidateNotebookNavigatorPresentation/);
  }
});


test('appearance evaluator, previews and editors are deleted', () => {
  for (const path of ['services/notebook-navigator-rule-service.ts', 'services/notebook-navigator-rule-engine.ts', 'notebook-navigator-settings/bucket-section.ts', 'notebook-navigator-settings/rules-section.ts', 'notebook-navigator-settings/ui-common.ts']) {
    assert.equal(existsSync(new URL(`../src/${path}`, import.meta.url)), false, path);
  }
  const settings = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /Enable Navigator rules|Virtual sort|Icon \+ color|bindNotebookNavigatorCommittedText|nnTextCommitTimers/);
  assert.doesNotMatch(mainSource, /notebookNavigatorRuleService|getRulePreviewForActiveFile/);
});


test('retired appearance editor styles are removed without dropping retained property/reference styles', () => {
  const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(styles, /tps-gcm-settings-frontmatter-rules-/);
  assert.match(styles, /tps-gcm-property-options-preview/);
  assert.match(styles, /tps-gcm-property-option-chip/);
  assert.match(styles, /tps-gcm-settings-base-query-callout/);
});


test('opening existing notes schedules display only, with no naming maintenance or body scans', () => {
  const call = findNode(eventSource, node => ts.isCallExpression(node)
    && node.expression.getText().endsWith('.workspace.on')
    && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'file-open');
  const callback = call.slice(call.indexOf(',') + 1, -1).trim();
  class TFile { constructor(path) { this.path = path; } }
  for (const isMobile of [false, true]) {
    let maintenance = 0, reads = 0, menus = 0, titles = 0;
    const timers = [];
    const plugin = {
      canRunBackgroundAutomation: () => true,
      get fileNamingService() { maintenance++; throw Error('Unexpected navigation maintenance'); },
      app: { vault: { read() { reads++; }, cachedRead() { reads++; }, getMarkdownFiles() { reads++; } } },
    };
    const handler = runTypeScript(`(${callback})`, {
      plugin, TFile, Platform: { isMobile }, logger: { perf() {} },
      refreshActiveInlineTitle() { titles++; }, scheduleSubitemRefresh() {},
      overlayRendering: { scheduleMenus() { menus++; }, scheduleFileRefresh() {} },
      setTimeout(fn) { timers.push(fn); },
    });
    for (let i = 0; i < 20; i++) handler(new TFile(`Inbox/Existing ${i}.md`));
    for (const timer of timers) timer();
    assert.equal(maintenance, 0);
    assert.equal(reads, 0);
    assert.equal(menus, 20);
    assert.equal(titles, 20);
    assert.equal(timers.length, isMobile ? 20 : 0, 'only existing mobile display refresh remains');
  }
});

test('settings startup does not load retired Companion rule files or plugin state', () => {
  assert.doesNotMatch(mainSource, /loadLegacyNotebookNavigatorCompanionSettings|plugins\/tps-notebook-navigator-companion|plugins\/TPS-Notebook-Navigator-Companion/);
  assert.match(mainSource, /const notebookNavigatorRulePayload = this\.resolveNotebookNavigatorRuleSettingsPayload\(loaded\)/);
});


test('retired file-open maintenance helper and post-create replay are absent', () => {
  for (const path of ['services/file-naming-service.ts', 'services/note-operation-service.ts', 'events/register-events.ts']) {
    assert.doesNotMatch(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), /processFileOnOpen/);
  }
});


test('100 incoming Markdown changes update displays without entering maintenance owners', () => {
  class TFile { constructor(path) { this.path = path; this.extension = 'md'; } }
  let maintenance = 0, reads = 0, titles = 0, menus = 0, metadataMenus = 0, parentUpdates = 0;
  const plugin = {
    settings: { dataArchitectureMode: 'native-records', enableAutoRename: true, autoSyncFileTimestamps: true },
    canRunBackgroundAutomation: () => true,
    get fileNamingService() { maintenance++; throw Error('Unexpected filename/timestamp write'); },
    get taskCheckboxHandler() { maintenance++; throw Error('Unexpected checklist write'); },
    get subitemRelationshipSyncService() { maintenance++; throw Error('Unexpected relationship repair'); },
    get linkedSubitemCheckboxService() { maintenance++; throw Error('Unexpected linked checkbox write'); },
    filePropertiesService: { isCompanionFile: () => false },
    parentLinkResolutionService: { onMetadataChanged() { parentUpdates++; return []; } },
    menuController: { panelBuilder: { clearFileTitleCache() {} } },
    noteTitleRenderService: { handleMetadataChanged() { titles++; } },
    app: { vault: { read() { reads++; }, cachedRead() { reads++; }, getMarkdownFiles() { reads++; } } },
  };
  const callbacks = ['changed', 'modify'].map(event => {
    const call = findNode(eventSource, node => ts.isCallExpression(node)
      && node.expression.getText().endsWith(event === 'changed' ? '.metadataCache.on' : '.vault.on')
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === event);
    return runTypeScript(`(${call.slice(call.indexOf(',') + 1, -1).trim()})`, {
      plugin, TFile, logger: { perf() {} },
      scheduleMetadataMenuRefresh() { metadataMenus++; },
      scheduleResponsiveMenuRefresh() { menus++; },
    });
  });
  const files = Array.from({ length: 100 }, (_, index) => new TFile(`Inbox/Incoming ${index}.md`));
  const before = JSON.stringify(files);
  for (const file of files) for (const callback of callbacks) callback(file);
  assert.equal(maintenance, 0);
  assert.equal(reads, 0);
  assert.equal(titles, 100);
  assert.equal(parentUpdates, 100);
  assert.equal(metadataMenus, 100);
  assert.equal(menus, 100);
  assert.equal(JSON.stringify(files), before);
  assert.doesNotMatch(eventSource, /debouncedFilenameSync|debouncedTimestampSync|shouldSyncTimestampForModify|recentEditorChangeAtByPath|timestampSyncEditorWindowMs/);
});


test('automatic folder-path synchronization has no writer, saved-setting consumer or UI', () => {
  const naming = readFileSync(new URL('../src/services/file-naming-service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(naming, /syncFolderPath|recentFolderPathWrites|getPersistedFolderPath/);
  for (const path of ['services/note-operation-service.ts', 'services/bulk-edit-service.ts', 'services/subitem-creation-service.ts', 'settings-tab.ts']) {
    assert.doesNotMatch(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), /autoSaveFolderPath/);
  }
});


test('automatic title propagation is removed while explicit maintenance remains', () => {
  const naming = readFileSync(new URL('../src/services/file-naming-service.ts', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(naming, /async syncTitleFromFilename\(|syncNativeRecordTitleFromFilename|renamedFromPath|autoSyncTitleFromFilename/);
  assert.doesNotMatch(settings, /autoSyncTitleFromFilename/);
  assert.match(naming, /async repairMissingTitlesAcrossVault/);
  assert.match(naming, /async repairTemplateDerivedTitlesAcrossVault/);
});

test('retired maintenance has no Controller-role execution gate or device-state reader', () => {
  assert.doesNotMatch(mainSource, /canRunBackgroundAutomation|getControllerDeviceRole|getStoredControllerDeviceRole|isControllerPluginEnabled/);
  assert.doesNotMatch(mainSource, /tps-device-role-/);
});
