import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadMenuBuilderModule() {
  const stubs = new Map([
    ["../main", "export default class TPSGlobalContextMenuPlugin {}"],
    ["../modals/text-input-modal", "export class TextInputModal { open() {} }"],
    ["../modals/FileSuggestModal", "export class FileSuggestModal { constructor(_app, choose, options) { globalThis.__tpsLatestFileSuggestChoose = choose; globalThis.__tpsLatestFileSuggestOptions = options; } open() {} }"],
    ["../modals/MultiFileSelectModal", "export class MultiFileSelectModal { constructor(_app, _choose, options) { globalThis.__tpsLatestMultiFileOptions = options; } open() {} }"],
    ["../modals/file-properties-relink-modal", "export const promptFilePropertiesRelink = () => {};"],
    ["../logger", "export const warn = () => {};"],
    ["../resolve-profiles", "export const resolveCustomProperties = (properties) => properties.filter((property) => !property.hidden);"],
    ["../services/view-mode-service", "export class ViewModeService {}"],
    ["../services/link-target-service", "export const parseLinksFromFrontmatterValue = () => [];"],
    ["../services/subitem-creation-service", "export const promptAndCreateSubitemForParent = async (_plugin, file) => { globalThis.__tpsLatestCreatedChildParentPath = file.path; };"],
    ["../utils/display-title", "export const getPlainDisplayTitle = (value, fallback) => value || fallback;"],
    ["../utils/entity-property", "export const isEntityReferenceProperty = () => false;"],
    ["./property-value-choice-menu", "export const addPropertyValueChoiceMenuItems = () => {};"],
    ["../utils/property-option-source", "export const propertyUsesEntityOptions = () => false;"],
    ["../services/archive-file-service", "export const isPathInArchiveFolder = () => false;"],
  ]);
  const result = await build({
    stdin: {
      contents: `
        export { MenuBuilder } from './src/menu/menu-builder.ts';
        export { TFile } from 'obsidian';
      `,
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
      sourcefile: "menu-builder-integration-test-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "menu-builder-test-doubles",
        setup(esbuild) {
          esbuild.onResolve({ filter: /^obsidian$/u }, () => ({
            path: "obsidian",
            namespace: "test-double",
          }));
          esbuild.onResolve({ filter: /.*/u }, (args) => {
            if (!stubs.has(args.path)) return null;
            return { path: args.path, namespace: "test-double" };
          });
          esbuild.onLoad({ filter: /^obsidian$/u, namespace: "test-double" }, () => ({
            loader: "js",
            contents: `
              export class App {}
              export class Menu {}
              export class MenuItem {}
              export class Notice { constructor() {} }
              export class TFile {
                constructor(path, ctime = 1) {
                  this.path = path;
                  this.extension = path.includes('.') ? path.split('.').pop().toLowerCase() : '';
                  this.name = path.split('/').pop();
                  this.basename = this.name.replace(/\\.[^.]+$/, '');
                  this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' };
                  this.stat = { ctime, mtime: ctime, size: 0 };
                }
              }
              export const normalizePath = (value) => String(value || '').replace(/^\\/+|\\/+$/g, '');
            `,
          }));
          esbuild.onLoad({ filter: /.*/u, namespace: "test-double" }, (args) => ({
            loader: "js",
            contents: stubs.get(args.path),
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

class FakeItem {
  title = "";
  disabled = false;
  submenu = null;

  setTitle(value) { this.title = String(value); return this; }
  setIcon() { return this; }
  setSection() { return this; }
  setWarning() { return this; }
  setChecked() { return this; }
  setDisabled(value) { this.disabled = Boolean(value); return this; }
  onClick(callback) { this.click = callback; return this; }
  setSubmenu() { this.submenu = new FakeMenu(); return this.submenu; }
}

class FakeMenu {
  items = [];

  addItem(callback) {
    const item = new FakeItem();
    callback(item);
    this.items.push(item);
    return this;
  }

  addSeparator() { return this; }
}

function createBuilderHarness(MenuBuilder, TFile) {
  const files = new Map();
  const frontmatter = new Map();
  const properties = [
    { id: "tags", key: "tags", label: "Tags", type: "list", listItemType: "tag" },
    { id: "legacy-tag", key: "Tag", label: "Legacy Tag", type: "selector" },
    { id: "categories", key: "categories", label: "Categories", type: "list", listItemType: "tag" },
    { id: "priority", key: "priority", label: "Priority", type: "selector" },
  ];
  const plugin = {
    app: {
      vault: {
        getFileByPath: (path) => files.get(path) ?? null,
        getMarkdownFiles: () => [...files.values()].filter((file) => file.extension === "md"),
      },
      metadataCache: {
        getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) ?? {} }),
      },
      fileManager: {},
    },
    settings: {
      properties,
      showCustomPropertiesInContextMenu: true,
      enableTimeTracking: true,
    },
    parentLinkResolutionService: {
      getParentsForChild: () => [],
      hasParent: () => false,
      isIgnoredFile: () => false,
      isRelationshipTarget: (file) => !file.path.startsWith("_assets/TPS File Properties/"),
      getRelationshipCandidates: () => [...files.values()].filter((file) => (
        file.extension === "md"
          ? !file.path.startsWith("_assets/TPS File Properties/")
          : true
      )),
    },
    noteTitleRenderService: { getDisplayTitle: (file) => file.basename },
    filePropertiesService: {
      isCompanionFile: (file) => file.path.startsWith("_assets/TPS File Properties/"),
      isPropertyTarget: (file) => file.extension !== "md" && !file.path.startsWith("_assets/TPS File Properties/"),
      read: (file) => frontmatter.get(file.path) ?? {},
      hasCompanion: () => false,
      getRelinkCandidate: () => null,
      hasRelinkCandidates: () => false,
      listRelinkCandidates: () => { throw new Error('context-menu construction must not enumerate relink candidates'); },
      ensureCompanion: async () => null,
    },
    fieldInitializationService: {
      isFieldDefinedForEntries: () => false,
      checkAndInitialize: async () => false,
    },
    timeTrackingService: { getActiveTimerCountForFileSync: () => 0 },
    bulkEditService: {
      linkToParent: async (targets, parent) => {
        globalThis.__tpsLatestBatchParentWrite = { targets, parent };
        return targets.length;
      },
    },
    notebookNavigatorRuleService: { applyRulesToFile: async () => {} },
    eventService: { emitFilesUpdated: () => {} },
    noteOperationService: {},
    getArchiveFolderPath: () => "_archive",
    runQueuedDelete: async (_targets, action) => action(),
  };
  const delegates = {
    createFileEntries: (targets) => targets.map((file) => ({
      file,
      frontmatter: frontmatter.get(file.path) ?? {},
    })),
    openAddTagModal: () => {},
    openAddListValueModal: () => {},
    openScheduledModal: () => {},
    openRecurrenceModalNative: () => {},
    openSnoozeModal: () => {},
    getRecurrenceValue: () => "",
    moveFiles: async () => {},
    getTypeFolderOptions: () => [],
  };
  const addFile = (path, ctime) => {
    const file = new TFile(path, ctime);
    files.set(path, file);
    frontmatter.set(path, {});
    return file;
  };
  return { builder: new MenuBuilder(plugin, delegates), addFile };
}

function buildTitles(builder, targets, options) {
  const menu = new FakeMenu();
  builder.addToExactFileMenu(menu, targets, options);
  return menu.items.map((item) => item.title);
}

function buildMenu(builder, targets, options) {
  const menu = new FakeMenu();
  builder.addToExactFileMenu(menu, targets, options);
  return menu;
}

const bridgeOptions = (files) => ({
  includeTitle: false,
  includeDelete: false,
  excludeStandardTagProperties: files.every((file) => file.extension === "md"),
  includeSingleTargetActions: files.length === 1,
});

test("the real menu builder de-duplicates only standard Markdown tags", async () => {
  const { MenuBuilder, TFile } = await loadMenuBuilderModule();
  const { builder, addFile } = createBuilderHarness(MenuBuilder, TFile);
  const note = addFile("Notes/Project.md", 10);
  const titles = buildTitles(builder, [note], bridgeOptions([note]));

  assert.equal(titles.some((title) => title.startsWith("Tags")), false);
  assert.equal(titles.some((title) => title.startsWith("Legacy Tag")), false);
  assert.equal(titles.some((title) => title.startsWith("Categories")), true);
  assert.equal(titles.some((title) => title.startsWith("Priority")), true);
  assert.equal(titles.includes("Link to Parent"), true);
  assert.equal(titles.includes("Time Tracking"), true);
});

test("note time tracking exposes one inferred-target start action instead of task-vs-note modes", async () => {
  const { MenuBuilder, TFile } = await loadMenuBuilderModule();
  const { builder, addFile } = createBuilderHarness(MenuBuilder, TFile);
  const note = addFile("Notes/Project.md", 11);
  const menu = buildMenu(builder, [note], bridgeOptions([note]));
  const timeTracking = menu.items.find((item) => item.title === "Time Tracking");
  const titles = timeTracking.submenu.items.map((item) => item.title);

  assert.deepEqual(titles, ["Start work session", "Add manual session"]);
  assert.equal(titles.some((title) => /Track with task|Track with note/u.test(title)), false);
});

test("multi-note menus apply one parent choice to the exact selected files", async () => {
  const { MenuBuilder, TFile } = await loadMenuBuilderModule();
  const { builder, addFile } = createBuilderHarness(MenuBuilder, TFile);
  const alpha = addFile("Notes/Alpha.md", 12);
  const beta = addFile("Notes/Beta.md", 13);
  const parent = addFile("Projects/Parent.md", 14);
  const menu = buildMenu(builder, [alpha, beta], {
    includeTitle: true,
    includeTags: true,
    includeSingleTargetActions: false,
  });
  const parentItem = menu.items.find((item) => item.title === "Link to Parent (2 items)");
  assert.ok(parentItem?.submenu);
  parentItem.submenu.items.find((item) => item.title === "Link selected items to parent...")?.click?.();
  assert.equal(globalThis.__tpsLatestFileSuggestOptions.candidateFiles.includes(parent), true);
  assert.equal(globalThis.__tpsLatestFileSuggestOptions.filter(alpha), false);
  assert.equal(globalThis.__tpsLatestFileSuggestOptions.filter(beta), false);
  await globalThis.__tpsLatestFileSuggestChoose(parent);
  assert.deepEqual(globalThis.__tpsLatestBatchParentWrite.targets, [alpha, beta]);
  assert.equal(globalThis.__tpsLatestBatchParentWrite.parent, parent);
});

test("the real menu builder exposes native properties for every non-Markdown file type", async () => {
  const { MenuBuilder, TFile } = await loadMenuBuilderModule();
  const { builder, addFile } = createBuilderHarness(MenuBuilder, TFile);
  const targets = [
    addFile("Reference/Guide.pdf", 20),
    addFile("Maps/System.canvas", 30),
    addFile("Views/Projects.base", 31),
    addFile("Media/Preview.png", 32),
    addFile("Data/Export.bin", 33),
  ];

  for (const target of targets) {
    const titles = buildTitles(builder, [target], bridgeOptions([target]));
    assert.equal(titles.some((title) => title.startsWith("Tags")), true, target.path);
    assert.equal(titles.some((title) => title.startsWith("Categories")), true, target.path);
    assert.equal(titles.some((title) => title.startsWith("Priority")), true, target.path);
    assert.equal(titles.includes("Create file properties note"), true, target.path);
    assert.equal(titles.includes("Link to Parent"), true, target.path);
    assert.equal(titles.includes("Link Children"), true, target.path);
    assert.equal(titles.includes("Embed Attachments"), false, target.path);
    assert.equal(titles.some((title) => title.startsWith("Convert to ")), false, target.path);
    assert.equal(titles.includes("Time Tracking"), false, target.path);
    assert.equal(titles.includes("Archive"), true, target.path);
  }

  const note = addFile("Notes/Logical parent.md", 33.5);
  const companion = addFile("_assets/TPS File Properties/Media/Preview.png.md", 34);
  const companionTitles = buildTitles(builder, [companion], bridgeOptions([companion]));
  assert.equal(companionTitles.some((title) => title.startsWith("Tags")), false);
  assert.equal(companionTitles.some((title) => title.startsWith("Priority")), false);
  assert.equal(companionTitles.includes("Link to Parent"), false);

  const pdfMenu = buildMenu(builder, [targets[0]], bridgeOptions([targets[0]]));
  const parentMenu = pdfMenu.items.find((item) => item.title === "Link to Parent")?.submenu;
  assert.ok(parentMenu);
  parentMenu.items.find((item) => item.title === "Link existing parent...")?.click?.();
  assert.equal(globalThis.__tpsLatestFileSuggestOptions.includeAllExtensions, true);
  assert.equal(globalThis.__tpsLatestFileSuggestOptions.candidateFiles.includes(note), true);
  assert.equal(globalThis.__tpsLatestFileSuggestOptions.candidateFiles.includes(targets[2]), true);
  assert.equal(globalThis.__tpsLatestFileSuggestOptions.candidateFiles.includes(companion), false);

  const childMenu = pdfMenu.items.find((item) => item.title === "Link Children")?.submenu;
  assert.ok(childMenu);
  assert.equal(childMenu.items.some((item) => item.title === "Create new child..."), true);
  childMenu.items.find((item) => item.title === "Create new child...")?.click?.();
  assert.equal(globalThis.__tpsLatestCreatedChildParentPath, targets[0].path);
  childMenu.items.find((item) => item.title === "Link existing child...")?.click?.();
  assert.equal(globalThis.__tpsLatestMultiFileOptions.candidateFiles.includes(note), true);
  assert.equal(globalThis.__tpsLatestMultiFileOptions.candidateFiles.includes(targets[1]), true);
  assert.equal(globalThis.__tpsLatestMultiFileOptions.candidateFiles.includes(companion), false);
});

test("mixed selections are order-independent and expose only actions valid for every file", async () => {
  const { MenuBuilder, TFile } = await loadMenuBuilderModule();
  const { builder, addFile } = createBuilderHarness(MenuBuilder, TFile);
  const note = addFile("Notes/Project.md", 40);
  const pdf = addFile("Reference/Guide.pdf", 50);

  const forward = buildTitles(builder, [note, pdf], bridgeOptions([note, pdf]));
  const reverse = buildTitles(builder, [pdf, note], bridgeOptions([pdf, note]));
  assert.equal(forward.some((title) => title.startsWith("Tags")), true);
  assert.equal(forward.some((title) => title.startsWith("Categories")), true);
  assert.equal(forward.some((title) => title.startsWith("Priority")), true);
  assert.equal(forward.includes("Archive (2 items)"), true);
  assert.equal(forward.includes("Convert to canvases (2)"), false);
  assert.equal(forward.includes("Time Tracking"), false);
  assert.deepEqual(reverse, forward);
});

test("all-Markdown multi-selection keeps batch properties and conversions but no single-target actions", async () => {
  const { MenuBuilder, TFile } = await loadMenuBuilderModule();
  const { builder, addFile } = createBuilderHarness(MenuBuilder, TFile);
  const first = addFile("Notes/First.md", 60);
  const second = addFile("Notes/Second.md", 70);
  const titles = buildTitles(builder, [first, second], bridgeOptions([first, second]));

  assert.equal(titles.some((title) => title.startsWith("Priority")), true);
  assert.equal(titles.some((title) => title.startsWith("Categories")), true);
  assert.equal(titles.some((title) => title.startsWith("Tags")), false);
  assert.equal(titles.includes("Convert to list items (2)"), true);
  assert.equal(titles.includes("Convert to canvases (2)"), true);
  assert.equal(titles.includes("Link to Parent"), false);
  assert.equal(titles.includes("Embed Attachments"), false);
  assert.equal(titles.includes("Time Tracking"), false);
  assert.equal(titles.includes("Archive (2 items)"), true);
});
