import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bridgeSource = readFileSync(
  new URL(
    "../src/services/tps-notebook-navigator-menu-bridge.ts",
    import.meta.url,
  ),
  "utf8",
);
const builderSource = readFileSync(
  new URL("../src/menu/menu-builder.ts", import.meta.url),
  "utf8",
);
const controllerSource = readFileSync(
  new URL("../src/menu/menu-controller.ts", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(
  new URL("../src/main.ts", import.meta.url),
  "utf8",
);

async function loadBridgeModule() {
  const result = await build({
    stdin: {
      contents: `
        export * from './src/services/tps-notebook-navigator-menu-bridge.ts';
        export { TFile } from 'obsidian';
      `,
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
      sourcefile: "tps-notebook-navigator-menu-bridge-test-entry.ts",
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
            contents: `
            export class TFile {
              constructor(path, ctime = 1) {
                this.path = path;
                this.extension = path.includes('.') ? path.split('.').pop() : '';
                this.stat = { ctime, mtime: ctime, size: 0 };
              }
            }
          `,
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

class FakeWorkspace {
  listeners = new Map();
  requests = [];
  offCount = 0;

  on(name, callback) {
    const ref = { name, callback };
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(ref);
    this.listeners.set(name, listeners);
    return ref;
  }

  offref(ref) {
    this.offCount += 1;
    const listeners = this.listeners.get(ref.name) ?? [];
    this.listeners.set(
      ref.name,
      listeners.filter((candidate) => candidate !== ref),
    );
  }

  trigger(name, payload) {
    if (name === "tps:notebook-navigator-api-request")
      this.requests.push(payload);
    for (const ref of [...(this.listeners.get(name) ?? [])])
      ref.callback(payload);
  }
}

function createMenusApi() {
  const registrations = [];
  let disposeCount = 0;
  return {
    registrations,
    get disposeCount() {
      return disposeCount;
    },
    registerRowMenu(callback, options) {
      const registration = { callback, options, active: true };
      registrations.push(registration);
      return () => {
        if (!registration.active) return;
        registration.active = false;
        disposeCount += 1;
      };
    },
  };
}

function apiPayload(
  menus,
  timestamp,
  available = true,
  hostInstanceId = "host-a",
) {
  return {
    source: "tps-notebook-navigator",
    sourcePluginId: "tps-notebook-navigator",
    hostInstanceId,
    timestamp,
    available,
    api: available ? { menus } : null,
  };
}

function noteTarget(file, overrides = {}) {
  return {
    providerId: "tps/entity-types",
    rowId: `entity:note:${file.path}`,
    kind: "tps/entity-type/note",
    label: file.path,
    file,
    sourcePath: file.path,
    typeId: "entity:note",
    checkbox: null,
    ...overrides,
  };
}

function createHarness(TFile) {
  const workspace = new FakeWorkspace();
  const liveFiles = new Map();
  const exactCalls = [];
  const host = {
    app: {
      workspace,
      vault: { getFileByPath: (path) => liveFiles.get(path) ?? null },
    },
    manifest: { id: "tps-global-context-menu" },
    settings: { inlineMenuOnly: false },
    menuController: {
      addToExactFileMenu(menu, files) {
        exactCalls.push({ menu, files });
        menu.addItem((item) => item.setTitle("GCM note action"));
        menu.addSeparator();
        menu.addItem((item) => item.setTitle("Archive"));
      },
    },
  };
  const file = new TFile("Projects/Launch.md", 100);
  liveFiles.set(file.path, file);
  return { workspace, liveFiles, exactCalls, host, file };
}

function applyRegistration(registration, target) {
  const operations = [];
  const context = {
    target,
    addItem: (callback) => operations.push({ kind: "item", callback }),
    addSeparator: () => operations.push({ kind: "separator" }),
  };
  registration.callback(context);
  return operations;
}

test("row eligibility is limited to built-in note-backed entity records", async () => {
  const module = await loadBridgeModule();
  const {
    TFile,
    TpsNotebookNavigatorMenuBridge,
    isBuiltInNoteEntityRowTarget,
  } = module;
  const { host, workspace, file } = createHarness(TFile);
  const menus = createMenusApi();
  const bridge = new TpsNotebookNavigatorMenuBridge(host);
  bridge.start();
  workspace.requests[0].respond(apiPayload(menus, 10));
  const supports = menus.registrations[0].options.supports;

  assert.equal(isBuiltInNoteEntityRowTarget(noteTarget(file)), true);
  assert.equal(supports(noteTarget(file)), true);
  assert.equal(supports(noteTarget(file, { typeId: "kind:project" })), true);
  assert.equal(supports(noteTarget(file, { typeId: "kind:status" })), true);
  assert.equal(
    supports(noteTarget(file, { providerId: "another-provider" })),
    false,
  );
  assert.equal(
    supports(
      noteTarget(file, {
        kind: "tps/entity-type/task",
        checkbox: { checked: false },
      }),
    ),
    false,
  );
  assert.equal(
    supports(
      noteTarget(file, { kind: "tps/entity-type/bullet", sourceLineNumber: 8 }),
    ),
    false,
  );
  assert.equal(
    supports(
      noteTarget(file, {
        kind: "tps/entity-type/heading",
        sourceLineNumber: 3,
      }),
    ),
    false,
  );
  assert.equal(supports(noteTarget(file, { sourcePath: "Other.md" })), false);
  assert.equal(supports(noteTarget(file, { sourceLineNumber: 0 })), false);
  assert.equal(supports(noteTarget(file, { typeId: "entity:task" })), false);
  bridge.stop();
});

test("lifecycle registration is idempotent and stale payloads cannot remove a newer API", async () => {
  const { TFile, TpsNotebookNavigatorMenuBridge } = await loadBridgeModule();
  const { host, workspace } = createHarness(TFile);
  const first = createMenusApi();
  const second = createMenusApi();
  const bridge = new TpsNotebookNavigatorMenuBridge(host);

  bridge.start();
  bridge.start();
  assert.equal(workspace.requests.length, 1);
  assert.equal(
    (workspace.listeners.get("tps:notebook-navigator-api-changed") ?? [])
      .length,
    1,
  );

  workspace.requests[0].respond({
    source: "tps-notebook-navigator",
    sourcePluginId: "tps-notebook-navigator",
    timestamp: 1,
    available: true,
    api: { menus: first },
  });
  assert.equal(
    first.registrations.length,
    0,
    "a pre-4.11 payload without host identity must fail closed",
  );

  workspace.requests[0].respond(apiPayload(first, 100));
  assert.equal(first.registrations.length, 1);
  workspace.trigger(
    "tps:notebook-navigator-api-changed",
    apiPayload(first, 100),
  );
  assert.equal(
    first.registrations.length,
    1,
    "same API must not register twice",
  );

  workspace.trigger(
    "tps:notebook-navigator-api-changed",
    apiPayload(second, 50, true, "host-b"),
  );
  assert.equal(first.disposeCount, 1);
  assert.equal(second.registrations.length, 1);

  workspace.trigger(
    "tps:notebook-navigator-api-changed",
    apiPayload(null, 200, false, "host-a"),
  );
  assert.equal(
    second.disposeCount,
    0,
    "a retiring host cannot tear down the replacement even with a later wall clock",
  );
  workspace.trigger(
    "tps:notebook-navigator-api-changed",
    apiPayload(null, 50, false, "host-b"),
  );
  assert.equal(
    second.disposeCount,
    1,
    "the current host unloads even when availability used the same timestamp",
  );

  bridge.stop();
  bridge.stop();
  assert.equal(workspace.offCount, 1);
});

test("a failed replacement preserves the existing working registration", async () => {
  const { TFile, TpsNotebookNavigatorMenuBridge } = await loadBridgeModule();
  const { host, workspace } = createHarness(TFile);
  const first = createMenusApi();
  const throwing = {
    registerRowMenu() {
      throw new Error("replacement failed");
    },
  };
  const invalid = {
    registerRowMenu() {
      return null;
    },
  };
  const second = createMenusApi();
  const bridge = new TpsNotebookNavigatorMenuBridge(host);

  bridge.start();
  workspace.requests[0].respond(apiPayload(first, 100));
  assert.equal(first.registrations.length, 1);

  workspace.trigger(
    "tps:notebook-navigator-api-changed",
    apiPayload(throwing, 200, true, "host-b"),
  );
  assert.equal(
    first.disposeCount,
    0,
    "throwing replacement must leave the old registration active",
  );

  workspace.trigger(
    "tps:notebook-navigator-api-changed",
    apiPayload(invalid, 300, true, "host-c"),
  );
  assert.equal(
    first.disposeCount,
    0,
    "invalid replacement disposer must leave the old registration active",
  );

  workspace.trigger(
    "tps:notebook-navigator-api-changed",
    apiPayload(null, 400, false, "host-b"),
  );
  assert.equal(
    first.disposeCount,
    0,
    "an unavailable event for a rejected replacement must not remove the active host",
  );

  workspace.trigger(
    "tps:notebook-navigator-api-changed",
    apiPayload(second, 100, true, "host-d"),
  );
  assert.equal(
    first.disposeCount,
    1,
    "old registration is released only after replacement succeeds",
  );
  assert.equal(second.registrations.length, 1);

  bridge.stop();
  assert.equal(second.disposeCount, 1);
});

test("exact row actions use the canonical current file and never retarget a stale snapshot", async () => {
  const { TFile, TpsNotebookNavigatorMenuBridge } = await loadBridgeModule();
  const { host, workspace, liveFiles, exactCalls, file } = createHarness(TFile);
  const menus = createMenusApi();
  const bridge = new TpsNotebookNavigatorMenuBridge(host);
  bridge.start();
  workspace.requests[0].respond(apiPayload(menus, 10));
  const registration = menus.registrations[0];

  const operations = applyRegistration(registration, noteTarget(file));
  assert.deepEqual(
    operations.map((entry) => entry.kind),
    ["item", "separator", "item"],
  );
  assert.equal(exactCalls.length, 1);
  assert.deepEqual(exactCalls[0].files, [file]);

  const crossRealmSnapshot = {
    path: file.path,
    extension: "md",
    stat: { ctime: file.stat.ctime },
  };
  assert.equal(
    registration.options.supports(noteTarget(crossRealmSnapshot)),
    true,
  );
  applyRegistration(registration, noteTarget(crossRealmSnapshot));
  assert.deepEqual(
    exactCalls.at(-1).files,
    [file],
    "the vault-resolved TFile is authoritative",
  );

  const replacement = new TFile(file.path, 200);
  liveFiles.set(file.path, replacement);
  assert.equal(registration.options.supports(noteTarget(file)), false);
  assert.deepEqual(applyRegistration(registration, noteTarget(file)), []);
  assert.equal(
    registration.options.supports(noteTarget(crossRealmSnapshot)),
    false,
  );
  assert.deepEqual(
    applyRegistration(registration, noteTarget(crossRealmSnapshot)),
    [],
  );

  liveFiles.delete(file.path);
  assert.equal(registration.options.supports(noteTarget(replacement)), false);
  assert.deepEqual(
    applyRegistration(registration, noteTarget(replacement)),
    [],
  );
  bridge.stop();
});

test("menu construction is transactional and settings refresh replaces registration once", async () => {
  const { TFile, TpsNotebookNavigatorMenuBridge } = await loadBridgeModule();
  const { host, workspace, file } = createHarness(TFile);
  const menus = createMenusApi();
  const bridge = new TpsNotebookNavigatorMenuBridge(host);
  bridge.start();
  workspace.requests[0].respond(apiPayload(menus, 10));

  host.menuController.addToExactFileMenu = (menu) => {
    menu.addItem(() => {});
    menu.addSeparator();
    throw new Error("synthetic builder failure");
  };
  assert.deepEqual(
    applyRegistration(menus.registrations[0], noteTarget(file)),
    [],
  );

  host.settings.inlineMenuOnly = true;
  bridge.refresh();
  assert.equal(menus.disposeCount, 1);
  assert.equal(menus.registrations.length, 2);
  assert.equal(
    menus.registrations[1].options.supports(noteTarget(file)),
    false,
  );
  bridge.stop();
  assert.equal(menus.disposeCount, 2);
});

test("source contract keeps the foreign bridge exact, task-exclusive, and lifecycle-owned", () => {
  const exactStart = builderSource.indexOf("addToExactFileMenu(");
  const exactEnd = builderSource.indexOf(
    "private addResolvedFilesToMenu(",
    exactStart,
  );
  const exactBlock = builderSource.slice(exactStart, exactEnd);
  assert.ok(exactStart >= 0 && exactEnd > exactStart);
  assert.match(exactBlock, /current !== candidate/);
  assert.match(exactBlock, /addResolvedFilesToMenu/);
  assert.doesNotMatch(exactBlock, /contextTargetService/);
  assert.match(
    controllerSource,
    /addToExactFileMenu\(menu: GcmMenuSink, files: readonly TFile\[\]/,
  );
  assert.match(
    bridgeSource,
    /target\.kind === TPS_NOTEBOOK_NAVIGATOR_NOTE_ENTITY_KIND/,
  );
  assert.match(bridgeSource, /target\.sourceLineNumber === undefined/);
  assert.match(
    bridgeSource,
    /payload\.hostInstanceId === this\.currentHostInstanceId/,
  );
  assert.doesNotMatch(
    bridgeSource,
    /latestPayloadTimestamp|payload\.timestamp\s*[<>]/,
  );
  assert.doesNotMatch(bridgeSource, /as unknown as Menu|as Menu/);
  assert.match(mainSource, /this\.tpsNotebookNavigatorMenuBridge\.start\(\)/);
  assert.match(mainSource, /this\.tpsNotebookNavigatorMenuBridge\?\.stop\(\)/);
  assert.match(
    mainSource,
    /this\.tpsNotebookNavigatorMenuBridge\?\.refresh\(\)/,
  );
});
