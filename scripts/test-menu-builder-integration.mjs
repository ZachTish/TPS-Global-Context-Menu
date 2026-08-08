import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadMenuBuilderModule() {
  const stubs = new Map([
    ["../main", "export default class TPSGlobalContextMenuPlugin {}"],
    ["../modals/text-input-modal", "export class TextInputModal { open() {} }"],
    ["../modals/FileSuggestModal", "export class FileSuggestModal { open() {} }"],
    ["../modals/MultiFileSelectModal", "export class MultiFileSelectModal { open() {} }"],
    ["../logger", "export const warn = () => {};"],
    ["../resolve-profiles", "export const resolveCustomProperties = (properties) => properties.filter((property) => !property.hidden);"],
    ["../services/view-mode-service", "export class ViewModeService {}"],
    ["../services/link-target-service", "export const parseLinksFromFrontmatterValue = () => [];"],
    ["../services/subitem-creation-service", "export const promptAndCreateSubitemForParent = async () => {};"],
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
    },
    noteTitleRenderService: { getDisplayTitle: (file) => file.basename },
    fieldInitializationService: {
      isFieldDefinedForEntries: () => false,
      checkAndInitialize: async () => false,
    },
    timeTrackingService: { getActiveTimerCountForFileSync: () => 0 },
    bulkEditService: {},
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

test("the real menu builder keeps non-Markdown single-file capabilities", async () => {
  const { MenuBuilder, TFile } = await loadMenuBuilderModule();
  const { builder, addFile } = createBuilderHarness(MenuBuilder, TFile);
  const pdf = addFile("Reference/Guide.pdf", 20);
  const canvas = addFile("Maps/System.canvas", 30);

  assert.deepEqual(buildTitles(builder, [pdf], bridgeOptions([pdf])), ["Write on PDF", "Archive"]);
  const canvasTitles = buildTitles(builder, [canvas], bridgeOptions([canvas]));
  assert.equal(canvasTitles.some((title) => title.startsWith("Tags")), true);
  assert.equal(canvasTitles.some((title) => title.startsWith("Categories")), true);
  assert.equal(canvasTitles.some((title) => title.startsWith("Priority")), true);
  assert.equal(canvasTitles.includes("Archive"), true);
});

test("mixed selections are order-independent and expose only actions valid for every file", async () => {
  const { MenuBuilder, TFile } = await loadMenuBuilderModule();
  const { builder, addFile } = createBuilderHarness(MenuBuilder, TFile);
  const note = addFile("Notes/Project.md", 40);
  const pdf = addFile("Reference/Guide.pdf", 50);

  const forward = buildTitles(builder, [note, pdf], bridgeOptions([note, pdf]));
  const reverse = buildTitles(builder, [pdf, note], bridgeOptions([pdf, note]));
  assert.deepEqual(forward, ["Archive (2 items)"]);
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
