import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
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
    true,
    "passive metadata churn may keep the existing panel for the same file",
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
