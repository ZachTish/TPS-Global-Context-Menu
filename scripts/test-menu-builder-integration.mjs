import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadMenuBuilderModule() {
  const stubs = new Map([
    ["../main", "export default class TPSGlobalContextMenuPlugin {}"],
    ["../modals/text-input-modal", "export class TextInputModal { constructor(_app, _label, _value, submit) { globalThis.__tpsLatestTextInputSubmit = submit; } open() {} }"],
    ["../modals/PropertyValueSuggestModal", "export const openPropertyValueSuggestModal = () => {};"],
    ["../modals/FileSuggestModal", "export class FileSuggestModal { constructor(_app, choose, options) { globalThis.__tpsLatestFileSuggestChoose = choose; globalThis.__tpsLatestFileSuggestOptions = options; } open() {} }"],
    ["../modals/MultiFileSelectModal", "export class MultiFileSelectModal { constructor(_app, _choose, options) { globalThis.__tpsLatestMultiFileOptions = options; } open() {} }"],
    ["../modals/file-properties-relink-modal", "export const promptFilePropertiesRelink = () => {};"],
    ["../logger", "export const warn = () => {}; export const flow = () => {}; export const perf = () => {};"],
    ["../resolve-profiles", "export const resolveCustomProperties = (properties) => properties.filter((property) => !property.hidden);"],
    ["../services/view-mode-service", "export class ViewModeService {}"],
    ["../services/link-target-service", "export const parseLinksFromFrontmatterValue = () => [];"],
    ["../services/subitem-creation-service", "export const promptAndCreateSubitemForParent = async (_plugin, file) => { globalThis.__tpsLatestCreatedChildParentPath = file.path; };"],
    ["../utils/display-title", "export const getPlainDisplayTitle = (value, fallback) => value || fallback;"],
    ["../utils/entity-property", "export const isEntityReferenceProperty = () => false;"],
    ["./property-value-choice-menu", "export const addPropertyValueChoiceMenuItems = () => {};"],
    ["../utils/property-option-source", "export const propertyUsesEntityOptions = () => false;"],
    ["../utils/property-options", "export const getEffectivePropertyOptions = () => [];"],
    ["../services/archive-file-service", "export const isPathInArchiveFolder = () => false;"],
  ]);
  const result = await build({
    stdin: {
      contents: `
        export { MenuBuilder } from './src/menu/menu-builder.ts';
        export { PropertyRowService } from './src/services/property-row-service.ts';
        export { ParentLinkResolutionService } from './src/services/parent-link-resolution-service.ts';
        export { FilePropertiesService } from './src/services/file-properties-service.ts';
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
              export class TFolder {}
              export const parseYaml = value => JSON.parse(value || '{}');
              export const stringifyYaml = value => JSON.stringify(value);
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
    { id: "parents", key: "parent", label: "Parents", type: "list" },
    { id: "recurrence", key: "recurrence", label: "Recurrence", type: "recurrence" },
    { id: "created-date", key: "createdDate", label: "createdDate", type: "datetime" },
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
      dateCreatedFrontmatterKey: "dateCreated",
    },
    parentLinkResolutionService: {
      getParentKey: () => "parent",
      getParentsForChild: () => [],
      hasParent: () => false,
      getChildrenForParent: () => [],
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
  return { builder: new MenuBuilder(plugin, delegates), addFile, plugin, frontmatter, files };
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
  assert.equal(titles.some((title) => title.startsWith("Parents")), false);
  assert.equal(titles.some((title) => title.startsWith("Recurrence")), false);
  assert.equal(titles.some((title) => title.startsWith("createdDate")), false);
});

test("relationship counts and submenu contents share one lookup per menu construction", async () => {
  const { MenuBuilder, TFile } = await loadMenuBuilderModule();
  const { builder, addFile, plugin } = createBuilderHarness(MenuBuilder, TFile);
  const root = addFile("Notes/Root.md");
  const parent = addFile("Projects/Parent.md");
  const child = addFile("Notes/Child.md");
  const attachment = addFile("Reference/Attachment.pdf");
  for (let i = 0; i < 1024; i++) addFile(`Notes/unrelated-${i}.md`);
  let parentLookups = 0;
  let childLookups = 0;
  plugin.parentLinkResolutionService.getParentsForChild = file => {
    assert.equal(file, root);
    parentLookups++;
    return [{ file: parent }];
  };
  plugin.parentLinkResolutionService.getChildrenForParent = file => {
    assert.equal(file, root);
    childLookups++;
    return [child, attachment];
  };

  const menu = buildMenu(builder, [root], bridgeOptions([root]));
  const parentItem = menu.items.find(item => item.title === 'Link to Parent (1)');
  const childItem = menu.items.find(item => item.title === 'Link Children (2)');
  assert.ok(parentItem?.submenu);
  assert.ok(childItem?.submenu);
  assert.equal(parentItem.submenu.items.filter(item => item.title === parent.basename).length, 2);
  for (const file of [child, attachment]) {
    assert.equal(childItem.submenu.items.filter(item => item.title === file.basename).length, 1);
    assert.equal(childItem.submenu.items.filter(item => item.title === `Unlink ${file.basename}`).length, 1);
  }
  assert.equal(childItem.submenu.items.some(item => item.title === 'Create new child...'), true);
  assert.equal(childItem.submenu.items.some(item => item.title === 'Link existing child...'), true);
  assert.equal(parentLookups, 1, 'count and submenu must not resolve the same parents twice');
  assert.equal(childLookups, 1, 'count and submenu share one indexed child lookup');
});

test('one linked child has distinct open and unlink rows with the same child count', async () => {
  const { MenuBuilder, TFile } = await loadMenuBuilderModule();
  const { builder, addFile, plugin } = createBuilderHarness(MenuBuilder, TFile);
  const parent = addFile('Notes/Parent.md');
  const child = addFile('Notes/Child.md');
  plugin.parentLinkResolutionService.getChildrenForParent = () => [child];
  let opened = null;
  let unlinked = null;
  plugin.openFileInLeaf = async file => { opened = file; };
  plugin.bulkEditService.unlinkFromParent = async (childFile, parentFile) => {
    unlinked = [childFile, parentFile];
  };

  const menu = buildMenu(builder, [parent], bridgeOptions([parent]));
  const children = menu.items.find(item => item.title === 'Link Children (1)')?.submenu;
  assert.ok(children);
  const openRows = children.items.filter(item => item.title === child.basename);
  const unlinkRows = children.items.filter(item => item.title === `Unlink ${child.basename}`);
  assert.equal(openRows.length, 1);
  assert.equal(unlinkRows.length, 1);

  openRows[0].click();
  await unlinkRows[0].click();
  assert.equal(opened, child);
  assert.deepEqual(unlinked, [child, parent]);
});

test("relationship snapshots are local to one menu and a later menu reads fresh relationships", async () => {
  const { MenuBuilder, TFile } = await loadMenuBuilderModule();
  const { builder, addFile, plugin } = createBuilderHarness(MenuBuilder, TFile);
  const root = addFile("Notes/Root.md");
  const parent = addFile("Projects/Parent.md");
  const child = addFile("Notes/Child.md");
  let parentFiles = [];
  const childFiles = new Set();
  let lookups = 0;
  plugin.parentLinkResolutionService.getParentsForChild = () => parentFiles.map(file => ({ file }));
  plugin.parentLinkResolutionService.getChildrenForParent = () => { lookups++; return [...childFiles]; };

  const first = buildMenu(builder, [root], bridgeOptions([root]));
  assert.equal(first.items.find(item => item.title === 'Link Children').submenu.items.some(item => item.title === 'No linked children'), true);
  assert.equal(first.items.find(item => item.title === 'Link to Parent').submenu.items.some(item => item.title === 'No linked parents'), true);
  parentFiles = [parent];
  childFiles.add(child);
  const second = buildMenu(builder, [root], bridgeOptions([root]));
  assert.ok(second.items.find(item => item.title === 'Link Children (1)').submenu.items.find(item => item.title === child.basename));
  assert.ok(second.items.find(item => item.title === 'Link to Parent (1)').submenu.items.find(item => item.title === parent.basename));
  assert.equal(lookups, 2, 'each new menu reads the current relationship index');

  plugin.parentLinkResolutionService.isIgnoredFile = file => file === root;
  const ignored = buildMenu(builder, [root], bridgeOptions([root]));
  assert.equal(ignored.items.some(item => /^Link (?:Children|to Parent)/u.test(item.title)), false);
  assert.equal(lookups, 2, 'ignored roots do not query child relationships');
});

function useRealRelationshipServices(h, { ParentLinkResolutionService, FilePropertiesService }) {
  const reads = new Map();
  h.plugin.app.vault.getAllLoadedFiles = () => [...h.files.values()];
  h.plugin.app.vault.getAbstractFileByPath = path => h.files.get(path) || h.files.get(`${path}.md`) || null;
  h.plugin.app.metadataCache.getFirstLinkpathDest = target => h.files.get(target)
    || h.files.get(`${target}.md`) || [...h.files.values()].find(file => file.basename === target) || null;
  h.plugin.app.metadataCache.getFileCache = file => {
    reads.set(file.path, (reads.get(file.path) || 0) + 1);
    return { frontmatter: h.frontmatter.get(file.path) || {} };
  };
  h.plugin.app.vault.read = h.plugin.app.vault.cachedRead = () => { throw new Error('Relationship display must not read source bodies'); };
  h.plugin.app.vault.modify = h.plugin.app.vault.process = () => { throw new Error('Relationship display must not write notes'); };
  h.plugin.settings.parentLinkFrontmatterKey = 'childOf';
  h.plugin.settings.enableParentChildIgnoreRule = true;
  h.plugin.settings.parentChildIgnoreFrontmatterKey = 'relationshipMode';
  h.plugin.settings.parentChildIgnoreFrontmatterValue = 'ignore';
  h.plugin.filePropertiesService = new FilePropertiesService(h.plugin);
  h.plugin.parentLinkResolutionService = new ParentLinkResolutionService(h.plugin);
  return reads;
}

test('the real relationship index does not inspect unrelated notes while building a menu', async () => {
  const module = await loadMenuBuilderModule();
  const h = createBuilderHarness(module.MenuBuilder, module.TFile);
  h.plugin.settings.dataArchitectureMode = 'native-records';
  const root = h.addFile('Notes/Root.md');
  const child = h.addFile('Notes/Child.md');
  const ignored = h.addFile('Notes/Ignored.md');
  const companion = h.addFile('Notes/Moved companion.md');
  const ordinary = Array.from({ length: 1024 }, (_, i) => h.addFile(`Notes/ordinary-${i}.md`));
  h.frontmatter.set(child.path, { childOf: ['[[Notes/Root]]', '[[Notes/Child]]'] });
  h.frontmatter.set(ignored.path, { parent: '[[Notes/Root]]', relationshipMode: 'ignore' });
  h.frontmatter.set(companion.path, { tpsGcmFileProperties: 1, tpsGcmFileId: 'companion', tpsGcmSourcePath: 'Attachment.pdf', parent: '[[Notes/Root]]' });
  const reads = useRealRelationshipServices(h, module);
  h.plugin.parentLinkResolutionService.rebuildRelationshipIndex();
  reads.clear();
  const menu = buildMenu(h.builder, [root], bridgeOptions([root]));
  const children = menu.items.find(item => item.title === 'Link Children (1)')?.submenu;
  assert.ok(children?.items.some(item => item.title === child.basename));
  assert.equal(children.items.some(item => item.title === ignored.basename || item.title === companion.basename), false);
  for (const file of ordinary) assert.equal(reads.get(file.path) || 0, 0, `${file.path}: unrelated metadata is not inspected`);
  assert.equal(h.frontmatter.get(child.path).childOf.length, 2, 'read filtering preserves persisted self-links');
});

test('parent resolution shares one logical source within the call and refreshes it on the next call', async () => {
  const module = await loadMenuBuilderModule();
  const h = createBuilderHarness(module.MenuBuilder, module.TFile);
  const parent = h.addFile('Notes/Parent.md');
  const child = h.addFile('Notes/Child.md');
  h.frontmatter.set(child.path, { ChildOf: ['[[Notes/Parent]]', '[[Notes/Child]]'] });
  const reads = useRealRelationshipServices(h, module);
  const service = h.plugin.parentLinkResolutionService;
  assert.deepEqual(service.getParentsForChild(child).map(entry => entry.file), [parent]);
  assert.equal(reads.get(child.path), 1, 'ignore and persisted links share one current metadata acquisition');

  h.frontmatter.set(child.path, { parents: '[[Notes/Parent]]', relationshipMode: 'IGNORE' });
  reads.clear();
  assert.deepEqual(service.getParentsForChild(child), []);
  assert.equal(reads.get(child.path), 1, 'the next operation acquires current ignored metadata once');
  assert.deepEqual(service.getStoredParentsForChild(child).map(entry => entry.file), [parent], 'explicit unlink still sees ignored stored relationships');
  h.frontmatter.set(child.path, { PARENT: '[[Notes/Parent]]' });
  h.frontmatter.set(parent.path, { relationshipMode: 'ignore' });
  assert.deepEqual(service.getParentsForChild(child), [], 'parent ignore remains authoritative');
  h.plugin.settings.enableParentChildIgnoreRule = false;
  assert.deepEqual(service.getParentsForChild(child).map(entry => entry.file), [parent], 'new calls observe current settings');
  h.frontmatter.set(child.path, {});
  assert.deepEqual(service.getParentsForChild(child), [], 'removed links do not survive in retained state');
});

test('one logical lookup preserves real companion routing, exclusions and architecture changes', async () => {
  const module = await loadMenuBuilderModule();
  const h = createBuilderHarness(module.MenuBuilder, module.TFile);
  const parent = h.addFile('Views/Parent.base');
  const child = h.addFile('Attachments/Child.pdf');
  useRealRelationshipServices(h, module);
  const files = h.plugin.filePropertiesService;
  const parentCompanion = h.addFile(files.getCompanionPath(parent));
  const childCompanion = h.addFile(files.getCompanionPath(child));
  h.frontmatter.set(parentCompanion.path, { tpsGcmFileProperties: 1, tpsGcmFileId: 'parent', tpsGcmSourcePath: parent.path });
  h.frontmatter.set(childCompanion.path, {
    tpsGcmFileProperties: 1, tpsGcmFileId: 'child', tpsGcmSourcePath: child.path,
    CHILDOf: ['[[Views/Parent.base]]', '[[Attachments/Child.pdf]]'],
  });
  let childReads = 0;
  const read = files.read.bind(files);
  files.read = file => { if (file === child) childReads++; return read(file); };
  const service = h.plugin.parentLinkResolutionService;
  assert.deepEqual(service.getParentsForChild(child).map(entry => [entry.file, entry.kind]), [[parent, 'base-parent']]);
  assert.equal(childReads, 1, 'ignore and link resolution must not reopen the same logical companion');
  assert.deepEqual(service.getRelationshipCandidates(), [parent, child], 'companion files stay hidden');

  h.frontmatter.get(childCompanion.path).relationshipMode = 'ignore';
  childCompanion.stat.mtime++;
  assert.deepEqual(service.getParentsForChild(child), []);
  assert.deepEqual(service.getStoredParentsForChild(child).map(entry => entry.file), [parent]);
  delete h.frontmatter.get(childCompanion.path).relationshipMode;
  childCompanion.stat.mtime++;
  h.frontmatter.get(parentCompanion.path).relationshipMode = 'ignore';
  parentCompanion.stat.mtime++;
  assert.deepEqual(service.getParentsForChild(child), []);
  h.plugin.settings.dataArchitectureMode = 'native-records';
  assert.deepEqual(service.getRelationshipCandidates(), [], 'native mode does not revive attachment-backed relationships');
  assert.equal(h.frontmatter.get(childCompanion.path).CHILDOf.length, 2, 'inspection never removes stored self-links');
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

// The shared frontmatter writer owns filename updates. Model that boundary here;
// the real writer's mutation/rename contract is covered by its integration suite.
function installPropertyWriter(harness, { key = "title", enableAutoRename = true, result = "changed" } = {}) {
  const { plugin } = harness;
  const writes = [];
  const filenameUpdates = [];
  const storedValues = new Map();
  let insideWriter = false;
  plugin.settings.enableAutoRename = enableAutoRename;
  plugin.fileNamingService = {
    updateFilenameIfNeeded: async (file, options) => {
      filenameUpdates.push({ file, options, owner: insideWriter ? "writer" : "editor" });
    },
  };
  plugin.bulkEditService.updateFrontmatter = async (files, updates) => {
    writes.push({ files, updates });
    if (result === "error") throw new Error("Property write rejected");
    if (result === "rejected") return 0;
    let changed = 0;
    for (const file of files) {
      if (storedValues.get(file) === updates[key]) continue;
      storedValues.set(file, updates[key]);
      changed += 1;
      if (key.toLowerCase() === "title" && String(updates[key]).trim() && enableAutoRename) {
        insideWriter = true;
        try {
          await plugin.fileNamingService.updateFilenameIfNeeded(file, {
            bypassCreationGrace: true,
            titleOverride: String(updates[key]).trim(),
          });
        } finally {
          insideWriter = false;
        }
      }
    }
    return changed;
  };
  return { writes, filenameUpdates, storedValues };
}

function createTextRowInput(PropertyRowService, plugin, entries, property) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: (tag) => ({
        tag,
        children: [],
        listeners: new Map(),
        addEventListener(type, listener) { this.listeners.set(type, listener); },
        appendChild(child) { this.children.push(child); },
      }),
    },
  });
  try {
    const service = new PropertyRowService(plugin.app, plugin, { addSafeClickListener: () => {} });
    const row = service.createTextRow(entries, property);
    const input = row.children.find((child) => child.tag === "input");
    assert.ok(input?.listeners.get("change"), "the real row registers its change handler");
    return input;
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else delete globalThis.document;
  }
}

for (const scenario of [
  { name: "enabled auto-rename", expected: 1 },
  { name: "disabled auto-rename", enableAutoRename: false, expected: 0 },
  { name: "unchanged value", next: "Before", expected: 0 },
  { name: "rejected mutation", result: "rejected", expected: 0 },
  { name: "failed mutation", result: "error", expected: 0 },
  { name: "cleared title", next: "", expected: 0 },
  { name: "case-variant title key", key: "Title", expected: 1 },
  { name: "two selected notes", count: 2, expected: 2 },
]) {
  test(`the real custom title row leaves filename ownership to the writer: ${scenario.name}`, async () => {
    const { MenuBuilder, PropertyRowService, TFile } = await loadMenuBuilderModule();
    const harness = createBuilderHarness(MenuBuilder, TFile);
    const key = scenario.key ?? "title";
    const next = scenario.next ?? "After";
    const writer = installPropertyWriter(harness, { ...scenario, key });
    const files = Array.from({ length: scenario.count ?? 1 }, (_, index) => harness.addFile(`Notes/Before ${index}.md`));
    files.forEach((file) => writer.storedValues.set(file, "Before"));
    // Entry snapshots are deliberately separate from authoritative writer data.
    const entries = files.map((file) => ({ file, frontmatter: { [key]: "Before" } }));
    const input = createTextRowInput(PropertyRowService, harness.plugin, entries, { key, label: "Title", type: "text" });
    input.value = next;
    if (scenario.result === "error") {
      await assert.rejects(input.listeners.get("change")(), /Property write rejected/u);
    } else {
      await input.listeners.get("change")();
    }
    assert.deepEqual(writer.writes, [{ files, updates: { [key]: next } }]);
    assert.equal(writer.filenameUpdates.length, scenario.expected, "only successful, changed, enabled writer updates may rename");
    assert.equal(writer.filenameUpdates.every((update) => update.owner === "writer"), true, "the editor must not independently request a filename update");
    const persisted = scenario.result === "error" || scenario.result === "rejected" ? "Before" : next;
    assert.deepEqual(files.map((file) => writer.storedValues.get(file)), files.map(() => persisted));
  });
}

test("the real context menu excludes custom title keys and IDs before creating text editors", async () => {
  const { MenuBuilder, TFile } = await loadMenuBuilderModule();
  const harness = createBuilderHarness(MenuBuilder, TFile);
  harness.plugin.settings.properties = [
    { id: "custom-title", key: "title", label: "Canonical custom title", type: "text" },
    { id: "custom-title-case", key: " Title ", label: "Case-variant custom title", type: "text" },
    { id: "TITLE", key: "heading", label: "Title-ID custom text", type: "text" },
    { id: "summary", key: "summary", label: "Summary", type: "text" },
  ];
  const file = harness.addFile("Notes/Before.md");
  const titles = buildTitles(harness.builder, [file], bridgeOptions([file]));
  assert.equal(titles.some((title) => /custom title|custom text/u.test(title)), false);
  assert.equal(titles.includes("Summary (create field)"), true);
});

test("the real context-menu text editor delegates its exact value once without requesting a filename update", async () => {
  const { MenuBuilder, TFile } = await loadMenuBuilderModule();
  const harness = createBuilderHarness(MenuBuilder, TFile);
  harness.plugin.settings.properties = [{ id: "summary", key: "summary", label: "Summary", type: "text" }];
  harness.plugin.fieldInitializationService.isFieldDefinedForEntries = () => true;
  const file = harness.addFile("Notes/Before.md");
  harness.frontmatter.set(file.path, { summary: "Before" });
  const writer = installPropertyWriter(harness, { key: "summary" });
  writer.storedValues.set(file, "Before");
  const menu = buildMenu(harness.builder, [file], bridgeOptions([file]));
  const item = menu.items.find((entry) => entry.title === "Summary: Before");
  assert.ok(item?.click);
  try {
    await item.click();
    assert.equal(typeof globalThis.__tpsLatestTextInputSubmit, "function");
    await globalThis.__tpsLatestTextInputSubmit("After");
    assert.deepEqual(writer.writes, [{ files: [file], updates: { summary: "After" } }]);
    assert.equal(writer.filenameUpdates.length, 0);
    assert.equal(writer.storedValues.get(file), "After");
  } finally {
    delete globalThis.__tpsLatestTextInputSubmit;
  }
});
