import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  const timestamps = new Map();
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
    recentEditorChangeAtByPath: timestamps,
    document: { activeElement: null },
    HTMLElement: class {},
    setTimeout: () => { timers += 1; },
  });
  const editor = { getValue: () => { fullReads += 1; return 'long note'; } };

  for (let i = 0; i < 1000; i += 1) handler(editor, { file });
  assert.equal(marks, 1000);
  assert.ok(timestamps.get(file.path) > 0);
  assert.ok(plugin.lastEditorChangeAt > 0);
  assert.equal(fullReads, 0);
  assert.equal(reconciliations, 0);
  assert.equal(timers, 0);

  active = other;
  handler(editor, { file });
  assert.equal(marks, 1000, 'an inactive editor does not mark the active note edited');
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
