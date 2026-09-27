import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadVisibilityModule() {
  const result = await build({
    stdin: {
      contents: `
        export * from './src/services/custom-property-visibility.ts';
        export { resolveCustomProperties } from './src/resolve-profiles.ts';
      `,
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
      sourcefile: "custom-property-surface-visibility-test-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "obsidian-test-double",
        setup(esbuild) {
          esbuild.onResolve({ filter: /^obsidian$/u }, () => ({
            path: "obsidian",
            namespace: "test-double",
          }));
          esbuild.onLoad({ filter: /.*/u, namespace: "test-double" }, () => ({
            loader: "js",
            contents: "export class WorkspaceLeaf {}",
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

test("surface visibility resolves overrides, participation gates, and global hiding in order", async () => {
  const { getCustomPropertySurfaceVisibilityMode } = await loadVisibilityModule();
  const property = {
    id: "priority",
    key: "priority",
    label: "Priority",
    type: "selector",
    showWhen: "populated",
    inlineShowWhen: "always",
    contextMenuShowWhen: "missing",
  };

  assert.equal(getCustomPropertySurfaceVisibilityMode(property, "inline"), "always");
  assert.equal(getCustomPropertySurfaceVisibilityMode(property, "context"), "missing");
  assert.equal(getCustomPropertySurfaceVisibilityMode(property, "any"), "populated");
  assert.equal(
    getCustomPropertySurfaceVisibilityMode({ ...property, showInCollapsed: false }, "inline"),
    "never",
  );
  assert.equal(
    getCustomPropertySurfaceVisibilityMode({ ...property, showInContextMenu: false }, "context"),
    "never",
  );
  assert.equal(
    getCustomPropertySurfaceVisibilityMode({ ...property, hidden: true }, "inline"),
    "never",
  );
});

test("surface menu choices map to their matching Settings override", async () => {
  const { createCustomPropertySurfaceVisibilityPatch } = await loadVisibilityModule();

  assert.deepEqual(createCustomPropertySurfaceVisibilityPatch("inline", "always"), {
    hidden: false,
    showInCollapsed: true,
    inlineShowWhen: "always",
  });
  assert.deepEqual(createCustomPropertySurfaceVisibilityPatch("inline", "never"), {
    hidden: false,
    showInCollapsed: true,
    inlineShowWhen: "never",
  });
  assert.deepEqual(createCustomPropertySurfaceVisibilityPatch("context", "exists"), {
    hidden: false,
    showInContextMenu: true,
    contextMenuShowWhen: "exists",
  });
  assert.deepEqual(createCustomPropertySurfaceVisibilityPatch("any", "never"), {
    hidden: true,
    showWhen: "never",
  });
});

test("Always show includes a missing Priority immediately without changing context-menu visibility", async () => {
  const {
    applyCustomPropertyVisibilityUpdate,
    createCustomPropertySurfaceVisibilityPatch,
    resolveCustomProperties,
  } = await loadVisibilityModule();
  let properties = [{
    id: "priority",
    key: "priority",
    label: "Priority",
    type: "selector",
    showWhen: "populated",
    contextMenuShowWhen: "populated",
    showInCollapsed: false,
  }];
  const entries = [{ file: { path: "Inbox/Missing priority.md" }, frontmatter: {} }];
  const resolve = (surface) => resolveCustomProperties(properties, entries, {}, surface);
  assert.deepEqual(resolve("inline"), []);
  assert.deepEqual(resolve("context"), []);

  const events = [];
  let finishPersistence;
  const persistenceGate = new Promise((resolveGate) => {
    finishPersistence = resolveGate;
  });
  const update = applyCustomPropertyVisibilityUpdate({
    properties,
    index: 0,
    patch: createCustomPropertySurfaceVisibilityPatch("inline", "always"),
    commit: (nextProperties) => {
      properties = nextProperties;
      events.push("commit");
    },
    refresh: () => events.push("refresh"),
    persist: async () => {
      events.push("persist:start");
      await persistenceGate;
      events.push("persist:end");
    },
  });

  assert.deepEqual(events, ["commit", "refresh", "persist:start"]);
  assert.equal(resolve("inline")[0]?.key, "priority");
  assert.deepEqual(resolve("context"), [], "the inline menu choice leaves context visibility unchanged");
  finishPersistence();
  assert.equal(await update, true);
  assert.deepEqual(events, ["commit", "refresh", "persist:start", "persist:end"]);
});

test("matching frontmatter can hide one configured field on every property surface", async () => {
  const { resolveCustomProperties } = await loadVisibilityModule();
  const properties = [
    {
      id: "status",
      key: "status",
      label: "Status",
      type: "selector",
      showWhen: "always",
      inlineShowWhen: "always",
      contextMenuShowWhen: "always",
      hideWhenProperties: [{ key: "kind", value: "area", operator: "equals" }],
    },
    {
      id: "priority",
      key: "priority",
      label: "Priority",
      type: "selector",
      showWhen: "always",
    },
  ];
  const area = [{ file: { path: "Areas/Home.md" }, frontmatter: { Kind: "AREA", status: "active" } }];
  const project = [{ file: { path: "Projects/Home.md" }, frontmatter: { kind: "project", status: "active" } }];

  for (const surface of ["any", "inline", "context"]) {
    assert.deepEqual(
      resolveCustomProperties(properties, area, {}, surface).map((property) => property.id),
      ["priority"],
      `${surface} hides only Status for a case-insensitive kind match`,
    );
    assert.deepEqual(
      resolveCustomProperties(properties, project, {}, surface).map((property) => property.id),
      ["status", "priority"],
      `${surface} keeps Status for a nonmatching item`,
    );
  }
});

test("hide conditions are OR rules and mixed selections fail safely", async () => {
  const { resolveCustomProperties } = await loadVisibilityModule();
  const status = {
    id: "status",
    key: "status",
    label: "Status",
    type: "selector",
    hideWhenProperties: [
      { key: "kind", value: "area", operator: "equals" },
      { key: "lifecycle", value: "archived", operator: "equals" },
    ],
  };

  assert.deepEqual(
    resolveCustomProperties([status], [
      { file: { path: "Areas/Home.md" }, frontmatter: { kind: "area" } },
      { file: { path: "Projects/App.md" }, frontmatter: { kind: "project" } },
    ], {}, "context"),
    [],
    "a batch action is hidden when the field is inapplicable to any selected item",
  );
  assert.deepEqual(
    resolveCustomProperties([status], [
      { file: { path: "Projects/Old.md" }, frontmatter: { kind: "project", lifecycle: "archived" } },
    ], {}, "inline"),
    [],
    "any matching rule hides the field",
  );
});

test("kind scopes distinguish note records from structural task lines", async () => {
  const { resolveCustomProperties } = await loadVisibilityModule();
  const properties = [
    { id: "status", key: "status", type: "selector", scopeKinds: ["task", "workout-session"] },
    { id: "protein", key: "proteinG", type: "number", scopeKinds: ["food-entry"] },
  ];
  assert.deepEqual(
    resolveCustomProperties(properties, [{ kind: "task", file: { path: "Today.md" }, frontmatter: {} }], {}, "context")
      .map((property) => property.id),
    ["status"],
  );
  assert.deepEqual(
    resolveCustomProperties(properties, [{ kind: "note", file: { path: "Food.md" }, frontmatter: { kind: "FOOD-ENTRY" } }], {}, "inline")
      .map((property) => property.id),
    ["protein"],
    "authored frontmatter kind overrides the structural note-row kind",
  );
  assert.deepEqual(
    resolveCustomProperties([{ ...properties[0], excludeKinds: ["area"] }], [{ file: { path: "Area.md" }, frontmatter: { kind: "area" } }], {}, "any"),
    [],
  );
});

test("mounted views refresh once, continue after one renderer throws, and never block persistence", async () => {
  const {
    applyCustomPropertyVisibilityUpdate,
    refreshMountedCustomPropertyPresentationViews,
  } = await loadVisibilityModule();
  const broken = { id: "broken" };
  const shared = { id: "shared" };
  const secondary = { id: "secondary" };
  const refreshed = [];
  const errors = [];
  refreshMountedCustomPropertyPresentationViews(
    [[broken, shared], [shared, secondary]],
    (view, options) => {
      refreshed.push([view.id, options.force]);
      if (view === broken) throw new Error("stale view");
    },
    (view) => errors.push(view.id),
  );
  assert.deepEqual(refreshed, [["broken", true], ["shared", true], ["secondary", true]]);
  assert.deepEqual(errors, ["broken"]);

  const events = [];
  await applyCustomPropertyVisibilityUpdate({
    properties: [{ id: "priority", key: "priority", type: "selector" }],
    index: 0,
    patch: { inlineShowWhen: "always" },
    commit: () => events.push("commit"),
    refresh: () => {
      events.push("refresh");
      throw new Error("synthetic render failure");
    },
    onRefreshError: () => events.push("refresh:error"),
    persist: async () => {
      events.push("persist");
    },
  });
  assert.deepEqual(events, ["commit", "refresh", "refresh:error", "persist"]);
});

test("forced preview refresh bypasses an unchanged frontmatter signature", async () => {
  const { shouldReuseCustomPropertyPreviewPanel } = await loadVisibilityModule();
  const unchangedPreview = {
    hasExistingPanel: true,
    isCurrentSignature: true,
    isCurrentPath: true,
  };

  assert.equal(
    shouldReuseCustomPropertyPreviewPanel({ ...unchangedPreview, force: false }),
    true,
    "passive refreshes may reuse an unchanged preview panel",
  );
  assert.equal(
    shouldReuseCustomPropertyPreviewPanel({ ...unchangedPreview, force: true }),
    false,
    "visibility-only changes force a fresh preview panel",
  );
  assert.equal(
    shouldReuseCustomPropertyPreviewPanel({
      hasExistingPanel: true,
      isCurrentSignature: false,
      isCurrentPath: true,
      force: false,
    }),
    false,
    "changed semantic properties require a refresh even when the path is unchanged",
  );
  assert.equal(
    shouldReuseCustomPropertyPreviewPanel({
      hasExistingPanel: false,
      isCurrentSignature: true,
      isCurrentPath: true,
      force: false,
    }),
    false,
  );
});

test("stacked-panel collapse state remains path-owned across forced rebuilds", () => {
  const source = readFileSync(
    new URL("../src/menu/panel-builder.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /stackedPropertiesCollapsedByPath\.get\(file\.path\)/);
  assert.match(source, /stackedPropertiesCollapsedByPath\.set\(file\.path, nextCollapsed\)/);
});

test('property search hides cards even when theme cards use display flex', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /details\.tps-gcm-property-card\[hidden\]\s*\{\s*display: none !important/);
});


test('property finder keeps accessible native controls and a single open editor', () => {
  const source = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
  assert.match(source, /aria-label', 'Find custom properties'/);
  assert.match(source, /aria-label', 'Filter properties by type'/);
  assert.match(source, /card.element !== details\) card.element.open = false/);
});

function loadPreviewBridgeMethods() {
  const extract = (path, name, predicate = ts.isMethodDeclaration) => {
    const ast = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    let found;
    const visit = node => {
      if (predicate(node) && node.name?.getText(ast) === name) found = node.getText(ast);
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.ok(found, name);
    return found;
  };
  return ts.transpileModule(`
    export class TFile { constructor(public path: string) {} extension = 'md'; }
    ${extract('../src/services/custom-property-visibility.ts', 'shouldReuseCustomPropertyPreviewPanel', ts.isFunctionDeclaration)}
    export class Bridge {
      ${['installBasesPreviewPropertiesBridge', 'refreshBasesPreviewProperties', 'enhanceBasesPreviewProperties', 'getPreviewPropertiesSignature', 'refreshCustomPropertyPreviewSurfaces'].map(name => extract('../src/main.ts', name)).join('\n')}
    }
  `, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
}
const previewBridgeMethods = loadPreviewBridgeMethods();

function createPreviewBridgeHarness() {
  let nextTimer = 0, now = 0, builds = 0, queries = 0, mounted = null;
  const timers = new Map(), handlers = {};
  const clock = {
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  class HTMLElement {}
  const root = Object.assign(new HTMLElement(), {
    dataset: {}, classList: { add() {} }, closest() { return null; }, matches() { return false; },
    querySelector(selector) {
      if (selector === '.tps-gcm-bases-preview-properties') return mounted;
      if (selector.startsWith('.markdown-preview-view')) return root;
      return null;
    },
    prepend(panel) { mounted = panel; },
  });
  const document = { body: {}, querySelectorAll(selector) { queries++; return selector.startsWith('.hover-popover') ? [root] : []; } };
  class MutationObserver { constructor(callback) { this.callback = callback; } observe(target, options) { this.options = options; } }
  const exports = {};
  new Function('exports', 'window', 'document', 'MutationObserver', 'HTMLElement', 'logger', previewBridgeMethods)(
    exports, clock, document, MutationObserver, HTMLElement, { warn() {}, debug() {} },
  );
  const a = new exports.TFile('Inbox/A.md'), b = new exports.TFile('Inbox/B.md');
  let currentFile = a;
  const frontmatter = new Map([[a, { status: 'active', kind: 'task' }], [b, { status: 'active', kind: 'task' }]]);
  const events = type => ({ on(name, fn) { handlers[`${type}:${name}`] = fn; return fn; } });
  const bridge = Object.assign(new exports.Bridge(), {
    settings: { showCustomPropertiesUnderTitle: true, showCustomPropertiesInInlineUi: true, properties: [{ key: 'status' }] },
    basesPreviewPropertiesRefreshTimer: null, basesPreviewPropertiesRetryTimers: [],
    app: { metadataCache: { ...events('metadata'), getFileCache(file) { return { frontmatter: frontmatter.get(file) }; } }, vault: events('vault'), workspace: { onLayoutReady() {} } },
    nativeRecordService: { inspect() { return null; } },
    registerEvent() {}, isCalendarBaseEmbedElement() { return false; },
    resolveMarkdownFileFromPreview() { return currentFile; }, removeLateNativePreviewMetadata() {},
    menuController: { getPanelBuilder() { return { createStackedPropertiesPanel(file) {
      builds++;
      const panel = { dataset: {}, file, classList: { add() {} }, remove() { if (mounted === panel) mounted = null; } };
      return panel;
    } }; } },
  });
  bridge.enhanceBasesPreviewProperties(root);
  bridge.installBasesPreviewPropertiesBridge();
  const drain = () => {
    let iterations = 0;
    while (timers.size) {
      assert.ok(++iterations < 100, 'preview callbacks must terminate');
      const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      timers.delete(id); now = timer.at; timer.fn();
    }
  };
  return { bridge, a, b, root, frontmatter, timers, drain,
    emit(type, name, file) { handlers[`${type}:${name}`]?.(file); },
    get stats() { return { builds, queries }; }, get panel() { return mounted; },
    changeFile(file) { currentFile = file; },
  };
}

test('preview metadata bursts preserve unrelated controls with one coalesced refresh', () => {
  const h = createPreviewBridgeHarness(), original = h.panel;
  for (let i = 0; i < 10; i++) { h.emit('vault', 'modify', h.b); h.emit('metadata', 'changed', h.b); }
  assert.equal(h.timers.size, 1, 'one pending refresh, no delayed forced replays');
  h.drain();
  assert.equal(h.panel, original);
  assert.deepEqual(h.stats, { builds: 1, queries: 2 });
});

test('body-only metadata updates preserve controls while changed fields rebuild once', () => {
  const h = createPreviewBridgeHarness(), original = h.panel;
  h.frontmatter.get(h.a).position = { start: { line: 0 }, end: { line: 4 } };
  h.emit('vault', 'modify', h.a); h.emit('metadata', 'changed', h.a); h.drain();
  assert.equal(h.panel, original, 'cache position is not a semantic property');
  h.frontmatter.get(h.a).status = 'done';
  h.emit('vault', 'modify', h.a); h.emit('metadata', 'changed', h.a); h.drain();
  assert.notEqual(h.panel, original);
  assert.equal(h.stats.builds, 2);
});

test('visibility dependencies outside configured fields invalidate the existing preview signature', () => {
  const h = createPreviewBridgeHarness(), original = h.panel;
  h.frontmatter.get(h.a).kind = 'note';
  h.frontmatter.get(h.a).hiddenByRule = true;
  h.emit('metadata', 'changed', h.a); h.drain();
  assert.notEqual(h.panel, original, 'kind/tag/custom scope fields can change visible controls');
  assert.equal(h.stats.builds, 2);
});

test('preview path changes and explicit visibility actions still refresh unchanged values', () => {
  const h = createPreviewBridgeHarness(), original = h.panel;
  h.changeFile(h.b); h.emit('metadata', 'changed', h.b); h.drain();
  assert.notEqual(h.panel, original);
  assert.equal(h.panel.file, h.b);
  h.b.path = 'Inbox/Renamed B.md'; h.emit('vault', 'rename', h.b); h.drain();
  assert.equal(h.root.dataset.tpsGcmPreviewPropertiesPath, h.b.path);
  const before = h.stats.builds;
  h.bridge.refreshCustomPropertyPreviewSurfaces();
  assert.equal(h.stats.builds, before + 1, 'settings changes retain their explicit force path');
});

test('late preview mounting and path attributes use the existing DOM observer without retry timers', () => {
  const h = createPreviewBridgeHarness();
  h.panel.remove();
  h.root.closest = selector => selector.startsWith('.hover-popover') ? h.root : null;
  const observer = h.bridge.basesPreviewPropertiesObserver;
  assert.equal(observer.options.attributes, true);
  assert.ok(observer.options.attributeFilter.includes('data-path'));
  observer.callback([{ target: h.root, addedNodes: [] }]);
  assert.equal(h.timers.size, 1);
  h.drain();
  assert.ok(h.panel);
  assert.equal(h.stats.builds, 2);
  assert.equal(h.timers.size, 0);
});

test('an already-built preview arriving inside a wrapper is discovered without a retry', () => {
  const h = createPreviewBridgeHarness();
  h.panel.remove();
  const wrapper = Object.assign(Object.create(Object.getPrototypeOf(h.root)), {
    closest() { return null; },
    querySelector(selector) { return selector.startsWith('.hover-popover') ? h.root : null; },
  });
  h.bridge.basesPreviewPropertiesObserver.callback([{ target: {}, addedNodes: [wrapper] }]);
  assert.equal(h.timers.size, 1);
  h.drain();
  assert.ok(h.panel);
});
