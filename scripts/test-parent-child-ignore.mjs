import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const obsidianStubPlugin = {
  name: 'parent-child-ignore-obsidian-stub',
  setup(context) {
    context.onResolve({ filter: /^obsidian$/u }, () => ({
      path: 'obsidian',
      namespace: 'parent-child-ignore-test',
    }));
    context.onLoad({ filter: /.*/u, namespace: 'parent-child-ignore-test' }, () => ({
      loader: 'js',
      contents: `
        export class App {}
        class TestMenuItem {
          constructor() { this.title = ''; this.checked = false; this.click = null; }
          setTitle(value) { this.title = String(value); return this; }
          setChecked(value) { this.checked = Boolean(value); return this; }
          setIcon() { return this; }
          setDisabled() { return this; }
          onClick(callback) { this.click = callback; return this; }
        }
        export class Menu {
          static latest = null;
          constructor() { this.items = []; Menu.latest = this; }
          addItem(callback) { const item = new TestMenuItem(); callback(item); this.items.push(item); return this; }
          addSeparator() { return this; }
          showAtPosition() {}
          showAtMouseEvent() {}
          onHide() {}
          hide() {}
        }
        export class Modal {
          static latest = null;
          constructor() { Modal.latest = this; this.contentEl = {}; this.modalEl = {}; }
          open() { Modal.latest = this; }
          close() {}
        }
        export class Setting {}
        export const getAllTags = () => ({});
        export const setIcon = () => {};
        export class TFile {
          constructor(path) {
            this.path = path;
            this.name = path.split('/').pop() || path;
            this.basename = this.name.replace(/\\.[^.]+$/u, '');
            this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
            this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' };
            this.stat = { ctime: 1, mtime: 1, size: 0 };
          }
        }
        export const normalizePath = (value) => String(value ?? '').replace(/\\\\/gu, '/').replace(/^\\/+|\\/+$/gu, '');
      `,
    }));
  },
};

async function importParentChildIgnoreService() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/parent-child-ignore-service.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function importParentLinkResolutionService() {
  const result = await build({
    stdin: {
      contents: `
        export { ParentLinkResolutionService } from './src/services/parent-link-resolution-service.ts';
        export { TFile } from 'obsidian';
      `,
      resolveDir: repoRoot,
      sourcefile: 'parent-child-ignore-resolution-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [obsidianStubPlugin],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function importUnresolvedSubitemService() {
  const result = await build({
    stdin: {
      contents: `
        export { checkAndPromptForUnresolvedSubitems } from './src/services/unresolved-subitem-modal.ts';
        export { Modal, TFile } from 'obsidian';
      `,
      resolveDir: repoRoot,
      sourcefile: 'parent-child-ignore-unresolved-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [obsidianStubPlugin],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function importPropertyRowService() {
  const stubs = new Map([
    ['../main', 'export default class TPSGlobalContextMenuPlugin {}'],
    ['../modals/text-input-modal', 'export class TextInputModal { open() {} }'],
    ['../modals/PropertyValueSuggestModal', 'export const openPropertyValueSuggestModal = () => {};'],
    ['../logger', 'export const flow = () => {}; export const warn = () => {};'],
  ]);
  const result = await build({
    stdin: {
      contents: `
        export { PropertyRowService } from './src/services/property-row-service.ts';
        export { Menu, TFile } from 'obsidian';
      `,
      resolveDir: repoRoot,
      sourcefile: 'parent-child-ignore-property-row-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [
      obsidianStubPlugin,
      {
        name: 'parent-child-ignore-property-row-stubs',
        setup(context) {
          context.onResolve({ filter: /.*/u }, (args) => (
            stubs.has(args.path)
              ? { path: args.path, namespace: 'parent-child-ignore-property-row-stub' }
              : null
          ));
          context.onLoad({ filter: /.*/u, namespace: 'parent-child-ignore-property-row-stub' }, (args) => ({
            loader: 'js',
            contents: stubs.get(args.path),
          }));
        },
      },
    ],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function importSubitemMetadataService() {
  const stubs = new Map([
    ['../resolve-profiles', 'export const resolveCustomProperties = () => [];'],
    ['../services/view-mode-service', 'export class ViewModeService {}'],
    ['../logger', 'export const warn = () => {}; export const flow = () => {};'],
    ['../services/link-target-service', 'export const parseLinksFromFrontmatterValue = () => []; export const resolveLinkTargetToFile = () => null;'],
    ['../utils/property-option-source', 'export const propertyUsesEntityOptions = () => false;'],
  ]);
  const result = await build({
    stdin: {
      contents: `
        export { SubitemMetadataService } from './src/menu/subitem-metadata-service.ts';
        export { TFile } from 'obsidian';
      `,
      resolveDir: repoRoot,
      sourcefile: 'nonmarkdown-subitem-metadata-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [
      obsidianStubPlugin,
      {
        name: 'nonmarkdown-subitem-metadata-stubs',
        setup(context) {
          context.onResolve({ filter: /.*/u }, (args) => (
            stubs.has(args.path)
              ? { path: args.path, namespace: 'nonmarkdown-subitem-metadata-stub' }
              : null
          ));
          context.onLoad({ filter: /.*/u, namespace: 'nonmarkdown-subitem-metadata-stub' }, (args) => ({
            loader: 'js',
            contents: stubs.get(args.path),
          }));
        },
      },
    ],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function extractMethod(source, methodName, sourcePath) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let method = null;
  const visit = (node) => {
    if (ts.isMethodDeclaration(node) && node.name?.getText(sourceFile) === methodName) {
      method = node.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(method, `Missing ${methodName} in ${sourcePath}`);
  return method;
}

async function importTopChildResolverHarness() {
  const sourcePath = fileURLToPath(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const method = extractMethod(source, 'resolveChildFilesForTopButton', sourcePath);
  const virtualSource = `
    class TFile {
      constructor(path) {
        this.path = path;
        this.name = path.split('/').pop() || path;
        this.basename = this.name.replace(/\\.[^.]+$/u, '');
        this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
      }
    }
    const logger = { warn: () => undefined };
    export class TopChildResolverHarness {
      constructor(bodyLinks, ignoredPaths, reverseChildren = []) {
        this.scanCount = 0;
        this.reverseChildren = reverseChildren;
        this.plugin = {
          parentLinkResolutionService: {
            isIgnoredFile: (file) => ignoredPaths.has(file.path),
          },
          bodySubitemLinkService: {
            scanFile: async () => {
              this.scanCount += 1;
              return bodyLinks;
            },
          },
        };
      }
      resolveChildFiles() { return this.reverseChildren; }
      ${method}
      run(file, knownChildren) {
        return this.resolveChildFilesForTopButton(file, knownChildren);
      }
    }
    export { TFile };
  `;
  const output = ts.transpileModule(virtualSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

async function importTagInheritanceHarness() {
  const sourcePath = fileURLToPath(new URL('../src/services/bulk-edit-service.ts', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const getTagsMethod = extractMethod(source, 'getInheritableParentTags', sourcePath);
  const mergeMethod = extractMethod(source, 'mergeParentTagsIntoChildren', sourcePath);
  const virtualSource = `
    import { mergeNormalizedTags, normalizeTagList, parseTagInput } from './src/utils/tag-utils.ts';
    export class TFile {
      constructor(path) {
        this.path = path;
        this.name = path.split('/').pop() || path;
        this.basename = this.name.replace(/\\.[^.]+$/u, '');
        this.extension = this.name.includes('.') ? this.name.split('.').pop().toLowerCase() : '';
      }
    }
    const runInBatches = async (items, callback) => {
      for (const item of items) await callback(item);
    };
    const logger = { error: () => undefined };

    export class TagInheritanceHarness {
      constructor(plugin) {
        this.plugin = plugin;
        this.safeChecks = [];
        this.serializedPaths = [];
      }
      findFrontmatterKeyCaseInsensitive(frontmatter, key) {
        return Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      }
      setFrontmatterValueCaseInsensitive(frontmatter, key, value) {
        const existing = this.findFrontmatterKeyCaseInsensitive(frontmatter, key);
        frontmatter[existing ?? key] = value;
      }
      getFrontmatterValueCaseInsensitive(frontmatter, key) {
        const existing = this.findFrontmatterKeyCaseInsensitive(frontmatter, key);
        return existing ? frontmatter[existing] : undefined;
      }
      async canMutateFrontmatterSafely(file) {
        this.safeChecks.push(file.path);
        return true;
      }
      async runSerializedFrontmatterWrite(file, action) {
        this.serializedPaths.push(file.path);
        await action();
      }
      ${getTagsMethod}
      ${mergeMethod}
      run(children, parent) { return this.mergeParentTagsIntoChildren(children, parent); }
    }
  `;
  const result = await build({
    stdin: {
      contents: virtualSource,
      resolveDir: repoRoot,
      sourcefile: 'nonmarkdown-tag-inheritance-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('parent/child ignore predicate is disabled by default and matches exact key/value pairs case-insensitively', async () => {
  const { matchesParentChildIgnoreRule, resolveParentChildIgnoreRule } = await importParentChildIgnoreService();
  const enabled = {
    enableParentChildIgnoreRule: true,
    parentChildIgnoreFrontmatterKey: ' Relationship Mode ',
    parentChildIgnoreFrontmatterValue: ' Ignore ',
  };

  assert.deepEqual(resolveParentChildIgnoreRule({}), { enabled: false, key: '', value: '' });
  assert.equal(matchesParentChildIgnoreRule({ 'relationship mode': 'IGNORE' }, { ...enabled, enableParentChildIgnoreRule: false }), false);
  assert.equal(matchesParentChildIgnoreRule({ 'relationship mode': 'IGNORE' }, enabled), true);
  assert.equal(matchesParentChildIgnoreRule({ RELATIONSHIPMODE: 'IGNORE' }, enabled), false, 'key matching is exact, not normalized beyond case/edge whitespace');
  assert.equal(matchesParentChildIgnoreRule({ 'RELATIONSHIP MODE': ['show', ' ignore '] }, enabled), true);
  assert.equal(matchesParentChildIgnoreRule({ 'relationship mode': 'ignored' }, enabled), false, 'value matching is exact, not a prefix');
  assert.equal(matchesParentChildIgnoreRule({ 'relationship mode': { value: 'ignore' } }, enabled), false);
});

test('ignored relationships are hidden and blocked without rewriting persisted links; explicit removal still works', async () => {
  const { ParentLinkResolutionService, TFile } = await importParentLinkResolutionService();
  const parent = new TFile('Parent.md');
  const child = new TFile('Child.md');
  const files = new Map([[parent.path, parent], [child.path, child]]);
  const frontmatter = new Map([
    [parent.path, {}],
    [child.path, { childOf: ['[[Parent]]'] }],
  ]);
  let mutationCount = 0;
  const plugin = {
    settings: {
      parentLinkFrontmatterKey: 'childOf',
      autoSelfLinkParentInParentKey: false,
      enableParentChildIgnoreRule: true,
      parentChildIgnoreFrontmatterKey: 'relationshipMode',
      parentChildIgnoreFrontmatterValue: 'ignore',
    },
    app: {
      vault: {
        getAllLoadedFiles: () => [...files.values()],
        getAbstractFileByPath: (path) => files.get(path) ?? files.get(`${path}.md`) ?? null,
      },
      metadataCache: {
        getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) ?? {} }),
        getFirstLinkpathDest: (target) => {
          const normalized = String(target || '').replace(/\\.md$/iu, '');
          return [...files.values()].find((file) => (
            file.path.replace(/\\.md$/iu, '') === normalized || file.basename === normalized
          )) ?? null;
        },
        fileToLinktext: (file) => file.path.replace(/\\.md$/iu, ''),
      },
      fileManager: {
        generateMarkdownLink: (file) => `[[${file.path.replace(/\\.md$/iu, '')}]]`,
      },
    },
    frontmatterMutationService: {
      process: async (file, mutator) => {
        mutationCount += 1;
        const value = frontmatter.get(file.path) ?? {};
        const before = JSON.stringify(value);
        mutator(value);
        return JSON.stringify(value) !== before;
      },
    },
  };
  const service = new ParentLinkResolutionService(plugin);

  assert.equal(service.getParentsForChild(child).length, 1);
  frontmatter.set(child.path, { childOf: ['[[Parent]]'], RelationshipMode: ' IGNORE ' });
  const persistedBefore = structuredClone(frontmatter.get(child.path));
  assert.deepEqual(service.getParentsForChild(child), []);
  assert.equal(service.getStoredParentsForChild(child)[0]?.file.path, parent.path);
  assert.deepEqual(frontmatter.get(child.path), persistedBefore, 'read filtering cannot rewrite frontmatter');
  assert.equal(await service.addParentToChild(child, parent), false);
  assert.equal(mutationCount, 0, 'ignored linking is rejected before a mutation starts');

  assert.equal(await service.removeParentFromChild(child, parent), true);
  assert.deepEqual(frontmatter.get(child.path), { RelationshipMode: ' IGNORE ' }, 'explicit unlink preserves the ignore pair');

  frontmatter.set(child.path, { childOf: ['[[Parent]]'] });
  frontmatter.set(parent.path, { relationshipMode: 'ignore' });
  assert.deepEqual(service.getParentsForChild(child), []);
  assert.equal(service.getStoredParentsForChild(child)[0]?.file.path, parent.path);
  assert.deepEqual(service.getAllFileTargets().map((file) => file.path), [child.path]);
});

test('PDF and Base relationship writes round-trip through logical companion frontmatter', async () => {
  const { ParentLinkResolutionService, TFile } = await importParentLinkResolutionService();
  const parentBase = new TFile('Views/Plan.base');
  const childPdf = new TFile('Reference/Brief.pdf');
  const reverseParentPdf = new TFile('Reference/Source.pdf');
  const reverseChildBase = new TFile('Views/Detail.base');
  const note = new TFile('Notes/Visible.md');
  const companion = new TFile('_assets/TPS File Properties/Reference/Brief.pdf.md');
  const loaded = [parentBase, childPdf, reverseParentPdf, reverseChildBase, note, companion];
  const files = new Map(loaded.map((file) => [file.path, file]));
  const markdownFrontmatter = new Map([[note.path, {}], [companion.path, { tpsGcmFileProperties: 1 }]]);
  const logicalFrontmatter = new Map([
    [parentBase.path, {}],
    [childPdf.path, {}],
    [reverseParentPdf.path, {}],
    [reverseChildBase.path, {}],
  ]);
  const resolvePath = (raw) => {
    const value = String(raw || '').trim();
    const wikiTarget = value.startsWith('[[') && value.endsWith(']]')
      ? value.slice(2, -2)
      : value;
    const markdownDivider = wikiTarget.indexOf('](');
    const markdownTarget = wikiTarget.startsWith('[') && wikiTarget.endsWith(')') && markdownDivider >= 0
      ? wikiTarget.slice(markdownDivider + 2, -1)
      : wikiTarget;
    const target = markdownTarget.split('|')[0].trim();
    return files.get(target) ?? files.get(`${target}.md`) ?? null;
  };
  const plugin = {
    settings: {
      parentLinkFrontmatterKey: 'childOf',
      autoSelfLinkParentInParentKey: false,
      enableParentChildIgnoreRule: true,
      parentChildIgnoreFrontmatterKey: 'relationshipMode',
      parentChildIgnoreFrontmatterValue: 'ignore',
    },
    app: {
      vault: {
        getAllLoadedFiles: () => loaded,
        getAbstractFileByPath: (path) => files.get(path) ?? null,
      },
      metadataCache: {
        getFileCache: (file) => ({ frontmatter: markdownFrontmatter.get(file.path) ?? {} }),
        getFirstLinkpathDest: (target) => resolvePath(target),
        fileToLinktext: (file) => file.path,
      },
      fileManager: {
        generateMarkdownLink: (file) => `[[${file.path}]]`,
      },
    },
    filePropertiesService: {
      isCompanionFile: (file) => file.path.startsWith('_assets/TPS File Properties/'),
      isPropertyTarget: (file) => file.extension !== 'md' && !file.path.startsWith('_assets/TPS File Properties/'),
      read: (file) => logicalFrontmatter.get(file.path) ?? {},
    },
    frontmatterMutationService: {
      process: async (file, mutator) => {
        const target = file.extension === 'md'
          ? (markdownFrontmatter.get(file.path) ?? {})
          : (logicalFrontmatter.get(file.path) ?? {});
        await mutator(target);
        if (file.extension === 'md') markdownFrontmatter.set(file.path, target);
        else logicalFrontmatter.set(file.path, target);
        return true;
      },
    },
  };
  const service = new ParentLinkResolutionService(plugin);

  assert.equal(await service.addParentToChild(childPdf, parentBase), true);
  assert.deepEqual(logicalFrontmatter.get(childPdf.path)?.childOf, ['[[Views/Plan.base]]']);
  assert.deepEqual(service.getParentsForChild(childPdf).map((entry) => [entry.file.path, entry.kind]), [
    [parentBase.path, 'base-parent'],
  ]);

  assert.equal(await service.addParentToChild(reverseChildBase, reverseParentPdf), true);
  assert.deepEqual(service.getParentsForChild(reverseChildBase).map((entry) => [entry.file.path, entry.kind]), [
    [reverseParentPdf.path, 'other-parent'],
  ]);

  assert.deepEqual(service.getRelationshipCandidates().map((file) => file.path), [
    parentBase.path,
    childPdf.path,
    reverseParentPdf.path,
    reverseChildBase.path,
    note.path,
  ], 'the managed companion is never a logical relationship target');

  logicalFrontmatter.set(childPdf.path, {
    ...logicalFrontmatter.get(childPdf.path),
    RelationshipMode: ' IGNORE ',
  });
  assert.deepEqual(service.getParentsForChild(childPdf), []);
  assert.equal(service.getStoredParentsForChild(childPdf)[0]?.file.path, parentBase.path);
  assert.equal(service.getRelationshipCandidates().some((file) => file.path === childPdf.path), false);
});

test('parent-tag inheritance is logical, ignored-tag filtered, and companion-aware in both directions', async () => {
  const { TagInheritanceHarness, TFile } = await importTagInheritanceHarness();
  const markdownParent = new TFile('Parents/Markdown.md');
  const pdfParent = new TFile('Parents/Document.pdf');
  const markdownChild = new TFile('Children/Note.md');
  const pdfChild = new TFile('Children/Document.pdf');
  const baseChild = new TFile('Children/View.base');
  const ignoredChild = new TFile('Children/Ignored.base');
  const companion = new TFile('_assets/TPS File Properties/Children/Document.pdf.md');
  const logical = new Map([
    [markdownParent.path, { Tags: ['#Shared', 'skip', 'ALPHA', 'shared'] }],
    [pdfParent.path, { Tag: '#Remote #skip #REMOTE' }],
    [markdownChild.path, { tags: ['existing'] }],
    [pdfChild.path, { tags: ['existing', 'SHARED'] }],
    [baseChild.path, { tags: ['alpha'] }],
    [ignoredChild.path, { tags: ['preserve'] }],
    [companion.path, { tags: ['preserve-companion'] }],
  ]);
  const ignored = new Set([ignoredChild.path]);
  const isCompanion = (file) => file.path.startsWith('_assets/TPS File Properties/');
  const plugin = {
    settings: { ignoredSubitemTags: ['skip'] },
    parentLinkResolutionService: {
      getLogicalFrontmatter: (file) => logical.get(file.path) ?? {},
      isRelationshipTarget: (file) => !isCompanion(file) && ['md', 'pdf', 'base'].includes(file.extension),
      isIgnoredFile: (file) => ignored.has(file.path),
    },
    frontmatterMutationService: {
      process: async (file, mutator) => {
        const current = logical.get(file.path) ?? {};
        const before = JSON.stringify(current);
        await mutator(current);
        logical.set(file.path, current);
        return JSON.stringify(current) !== before;
      },
    },
  };
  const service = new TagInheritanceHarness(plugin);

  assert.deepEqual(
    (await service.run([markdownChild, ignoredChild, companion], pdfParent)).map((file) => file.path),
    [markdownChild.path],
  );
  assert.deepEqual(logical.get(markdownChild.path).tags, ['existing', 'remote']);
  assert.deepEqual(logical.get(ignoredChild.path).tags, ['preserve']);
  assert.deepEqual(logical.get(companion.path).tags, ['preserve-companion']);

  assert.deepEqual(
    (await service.run([pdfChild, baseChild], markdownParent)).map((file) => file.path),
    [pdfChild.path, baseChild.path],
  );
  assert.deepEqual(logical.get(pdfChild.path).tags, ['existing', 'shared', 'alpha']);
  assert.deepEqual(logical.get(baseChild.path).tags, ['alpha', 'shared']);
  assert.deepEqual(service.safeChecks, [markdownChild.path]);
  assert.deepEqual(service.serializedPaths, [markdownChild.path]);
});

test('subitem reverse discovery merges body and companion-backed relationships exactly once', async () => {
  const { SubitemMetadataService, TFile } = await importSubitemMetadataService();
  const rootBase = new TFile('Views/Root.base');
  const markdownRoot = new TFile('Notes/Root.md');
  const pdfChild = new TFile('Reference/Child.pdf');
  const companion = new TFile('_assets/TPS File Properties/Reference/Child.pdf.md');
  const logical = new Map([
    [rootBase.path, { sort: 1 }],
    [markdownRoot.path, {}],
    [pdfChild.path, { childOf: ['[[Views/Root.base]]'], priority: 'high' }],
  ]);
  let bodyScanCount = 0;
  const plugin = {
    app: {
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
      vault: { cachedRead: async () => { throw new Error('non-Markdown files must not be read as text'); } },
    },
    parentLinkResolutionService: {
      getRelationshipCandidates: () => [rootBase, markdownRoot, pdfChild],
      getParentsForChild: (file) => file === pdfChild
        ? [{ file: rootBase, kind: 'base-parent', source: 'child-frontmatter' }]
        : [],
      getLogicalFrontmatter: (file) => logical.get(file.path) ?? {},
      isIgnoredFile: (file) => file === companion,
    },
    bodySubitemLinkService: {
      scanFile: async (file) => {
        bodyScanCount += 1;
        return file === markdownRoot ? [{ childFile: pdfChild }] : [];
      },
    },
  };
  const service = new SubitemMetadataService(plugin, {
    createFileEntries: (files) => files.map((file) => ({ file, frontmatter: {} })),
  });
  const parentIndex = service.buildParentToChildrenIndex();
  assert.deepEqual(parentIndex.get(rootBase.path)?.map((file) => file.path), [pdfChild.path]);

  const baseRelations = await service.collectDirectSubitemRelations(rootBase, parentIndex);
  assert.equal(bodyScanCount, 0, 'a Base relationship never triggers Markdown body scanning');
  assert.deepEqual([...baseRelations.keys()], [pdfChild.path]);

  const markdownIndex = new Map([[markdownRoot.path, [pdfChild]]]);
  const mergedRelations = await service.collectDirectSubitemRelations(markdownRoot, markdownIndex);
  assert.equal(bodyScanCount, 1);
  assert.deepEqual([...mergedRelations.keys()], [pdfChild.path], 'body and reverse-index discovery render one child row');
  assert.deepEqual(service.getResolvedFrontmatter(pdfChild, { priority: 'low', fallbackOnly: true }), {
    priority: 'high',
    fallbackOnly: true,
    childOf: ['[[Views/Root.base]]'],
  });
});

test('relationship consumers share logical frontmatter and opt in to all-file picker candidates', () => {
  const parentResolution = readFileSync(new URL('../src/services/parent-link-resolution-service.ts', import.meta.url), 'utf8');
  const metadata = readFileSync(new URL('../src/menu/subitem-metadata-service.ts', import.meta.url), 'utf8');
  const persistent = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');
  const menuBuilder = readFileSync(new URL('../src/menu/menu-builder.ts', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../src/menu/panel-builder.ts', import.meta.url), 'utf8');
  const fileSuggest = readFileSync(new URL('../src/modals/FileSuggestModal.ts', import.meta.url), 'utf8');
  const multiSelect = readFileSync(new URL('../src/modals/MultiFileSelectModal.ts', import.meta.url), 'utf8');

  assert.match(parentResolution, /getLogicalFrontmatter[\s\S]{0,650}filePropertiesService\.read\(file\)/u);
  assert.match(parentResolution, /getRelationshipCandidates[\s\S]{0,320}isRelationshipTarget\(file\)/u);
  assert.match(parentResolution, /isIgnoredFile[\s\S]{0,240}getLogicalFrontmatter\(file\)/u);
  assert.match(parentResolution, /getStoredParentsForChild[\s\S]{0,180}getLogicalFrontmatter\(childFile\)/u);
  assert.match(metadata, /buildParentToChildrenIndex[\s\S]{0,700}getRelationshipCandidates\(\)/u);
  assert.match(metadata, /getResolvedFrontmatter[\s\S]{0,260}getLogicalFrontmatter\(file\)/u);
  assert.ok(
    (persistent.match(/parentLinkResolutionService\.getRelationshipCandidates\(\)/gu) || []).length >= 2,
    'persistent relationship paths and child rows must share logical candidate enumeration',
  );
  assert.match(menuBuilder, /resolveChildFilesFor[\s\S]{0,300}getRelationshipCandidates\(\)/u);
  assert.ok(
    (panel.match(/parentLinkResolutionService\.getLogicalFrontmatter\(/gu) || []).length >= 3,
    'panel sorting and both archive/ignore tag reads use logical frontmatter',
  );
  assert.match(fileSuggest, /candidateFiles\?: readonly TFile\[\][\s\S]{0,180}includeAllExtensions\?: boolean/u);
  assert.match(fileSuggest, /const source = this\.candidateFiles \?\? this\.app\.vault\.getAllLoadedFiles\(\)/u);
  assert.match(multiSelect, /candidateFiles\?: readonly TFile\[\][\s\S]{0,260}this\.app\.vault\.getMarkdownFiles\(\)/u);
});

test('body-only ignored children and ignored roots never reach the top Children popover', async () => {
  const { TopChildResolverHarness, TFile } = await importTopChildResolverHarness();
  const root = new TFile('Root.md');
  const ignoredChild = new TFile('Ignored child.md');
  const visibleChild = new TFile('Visible child.md');
  const ignoredPaths = new Set([ignoredChild.path]);
  const bodyLinks = [
    { childFile: ignoredChild },
    { childFile: visibleChild },
  ];
  const harness = new TopChildResolverHarness(bodyLinks, ignoredPaths);

  assert.deepEqual((await harness.run(root)).map((file) => file.path), [visibleChild.path]);
  assert.equal(harness.scanCount, 1);
  assert.deepEqual((await harness.run(root, [ignoredChild])).map((file) => file.path), [visibleChild.path]);

  const ignoredRootHarness = new TopChildResolverHarness(bodyLinks, new Set([root.path]));
  assert.deepEqual(await ignoredRootHarness.run(root), []);
  assert.equal(ignoredRootHarness.scanCount, 0, 'an ignored root is rejected before body-link discovery');
});

test('unresolved-link cleanup rechecks ignored parents before opening and at every write boundary', async () => {
  const { checkAndPromptForUnresolvedSubitems, Modal, TFile } = await importUnresolvedSubitemService();
  const parent = new TFile('Parent.md');
  let ignored = true;
  let readCount = 0;
  let mutationCount = 0;
  let lastMutatedLines = null;
  const plugin = {
    parentLinkResolutionService: {
      isIgnoredFile: () => ignored,
    },
    subitemRelationshipSyncService: {
      readMarkdownText: async () => {
        readCount += 1;
        return '- [ ] [[Missing child]]';
      },
      mutateMarkdownBody: async (_file, mutator) => {
        mutationCount += 1;
        const lines = ['- [ ] [[Missing child]]'];
        ignored = true;
        await mutator(lines);
        lastMutatedLines = [...lines];
      },
    },
    bodySubitemLinkService: {
      scanText: () => [{
        childFile: null,
        childPath: 'Missing child.md',
        rawLine: '- [ ] [[Missing child]]',
        line: 0,
      }],
    },
    app: {
      vault: {
        getAbstractFileByPath: () => null,
      },
    },
  };

  assert.equal(await checkAndPromptForUnresolvedSubitems(plugin, parent), false);
  assert.equal(readCount, 0, 'ignored roots are rejected before body-link reads');

  ignored = false;
  const staleModalResult = checkAndPromptForUnresolvedSubitems(plugin, parent);
  await new Promise((resolve) => setImmediate(resolve));
  const staleModal = Modal.latest;
  assert.ok(staleModal, 'expected unresolved-link modal to open');
  ignored = true;
  await staleModal.onResolve([0]);
  assert.equal(await staleModalResult, true);
  assert.equal(mutationCount, 0, 'a modal opened before ignore was enabled cannot remove a line afterward');

  ignored = false;
  const commitRaceResult = checkAndPromptForUnresolvedSubitems(plugin, parent);
  await new Promise((resolve) => setImmediate(resolve));
  const commitRaceModal = Modal.latest;
  assert.ok(commitRaceModal, 'expected a second unresolved-link modal to open');
  await commitRaceModal.onResolve([0]);
  assert.equal(await commitRaceResult, true);
  assert.equal(mutationCount, 1, 'the commit-race harness reaches the mutation boundary once');
  assert.deepEqual(lastMutatedLines, ['- [ ] [[Missing child]]'], 'the mutation callback recheck preserves the persisted line');
});

test('stale linked-property menus cannot change status, priority, or folder after the relationship becomes ignored', async () => {
  const { PropertyRowService, Menu, TFile } = await importPropertyRowService();
  const child = new TFile('Child.md');
  const entry = { file: child, frontmatter: { status: 'todo', priority: 'normal' } };
  const writes = [];
  let allowed = true;
  const plugin = {
    bulkEditService: {
      removeFrontmatterKey: async () => { writes.push('remove'); return 1; },
      setStatus: async () => { writes.push('status'); return 1; },
      updateFrontmatter: async () => { writes.push('priority'); return 1; },
    },
    notebookNavigatorRuleService: {
      applyRulesToFile: async () => writes.push('rules'),
    },
    viewModeManager: {
      handlePotentialFrontmatterChange: () => writes.push('view-mode'),
    },
  };
  const app = {
    workspace: { getActiveFile: () => null },
    vault: { getAbstractFileByPath: (path) => path === child.path ? child : null },
    metadataCache: {},
  };
  const delegates = {
    showMenuAtAnchor: () => undefined,
    getTypeFolderOptions: () => [{ path: '_archive', label: 'Archive' }],
    moveFiles: async () => { writes.push('folder'); },
  };
  const service = new PropertyRowService(app, plugin, delegates);

  service.openStatusSubmenu({}, [entry], undefined, ['todo', 'complete'], undefined, () => allowed);
  const statusItem = Menu.latest.items.find((item) => item.title === 'complete');
  assert.equal(typeof statusItem?.click, 'function');
  allowed = false;
  await statusItem.click();
  assert.equal(entry.frontmatter.status, 'todo');

  allowed = true;
  service.openPrioritySubmenu({}, [entry], undefined, ['normal', 'high'], 'priority', () => allowed);
  const priorityItem = Menu.latest.items.find((item) => item.title === 'high');
  assert.equal(typeof priorityItem?.click, 'function');
  allowed = false;
  await priorityItem.click();
  assert.equal(entry.frontmatter.priority, 'normal');

  allowed = true;
  service.openTypeSubmenu({}, [entry], () => allowed);
  const folderItem = Menu.latest.items.find((item) => item.title === 'Archive');
  assert.equal(typeof folderItem?.click, 'function');
  allowed = false;
  await folderItem.click();

  assert.deepEqual(writes, [], 'all stale menu callbacks are rejected before local or persisted mutation');
});

test('linked-property status guard is carried through an async prompt to the bulk mutation boundary', async () => {
  const { PropertyRowService, Menu, TFile } = await importPropertyRowService();
  const child = new TFile('Child.md');
  const entry = { file: child, frontmatter: { status: 'todo' } };
  let allowed = true;
  let releasePrompt;
  let signalPrompt;
  const promptReached = new Promise((resolve) => { signalPrompt = resolve; });
  const promptGate = new Promise((resolve) => { releasePrompt = resolve; });
  let persistedWrites = 0;
  const plugin = {
    bulkEditService: {
      setStatus: async (_files, _status, options) => {
        signalPrompt();
        await promptGate;
        if (options?.writeGuard?.(child) === false) return 0;
        persistedWrites += 1;
        return 1;
      },
    },
    notebookNavigatorRuleService: { applyRulesToFile: async () => undefined },
    viewModeManager: { handlePotentialFrontmatterChange: () => undefined },
  };
  const service = new PropertyRowService(
    {
      workspace: { getActiveFile: () => null },
      vault: { getAbstractFileByPath: () => child },
      metadataCache: {},
    },
    plugin,
    { showMenuAtAnchor: () => undefined },
  );

  service.openStatusSubmenu({}, [entry], undefined, ['todo', 'complete'], undefined, () => allowed);
  const statusItem = Menu.latest.items.find((item) => item.title === 'complete');
  const pendingClick = statusItem.click();
  await promptReached;
  allowed = false;
  releasePrompt();
  await pendingClick;

  assert.equal(persistedWrites, 0);
  assert.equal(entry.frontmatter.status, 'todo', 'the optimistic entry is not changed when the boundary guard rejects the write');
});

test('ignore guards cover relationship panels, body widgets, automation, creation, and explicit bulk unlink', () => {
  const sources = {
    panel: readFileSync(new URL('../src/menu/panel-builder.ts', import.meta.url), 'utf8'),
    panelAction: readFileSync(new URL('../src/menu/panel-action-service.ts', import.meta.url), 'utf8'),
    menu: readFileSync(new URL('../src/menu/menu-builder.ts', import.meta.url), 'utf8'),
    metadata: readFileSync(new URL('../src/menu/subitem-metadata-service.ts', import.meta.url), 'utf8'),
    checkbox: readFileSync(new URL('../src/services/linked-subitem-checkbox-service.ts', import.meta.url), 'utf8'),
    sync: readFileSync(new URL('../src/services/subitem-relationship-sync-service.ts', import.meta.url), 'utf8'),
    creation: readFileSync(new URL('../src/services/subitem-creation-service.ts', import.meta.url), 'utf8'),
    bulk: readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8'),
    fileSuggest: readFileSync(new URL('../src/modals/FileSuggestModal.ts', import.meta.url), 'utf8'),
    multiFileSelect: readFileSync(new URL('../src/modals/MultiFileSelectModal.ts', import.meta.url), 'utf8'),
    unresolved: readFileSync(new URL('../src/services/unresolved-subitem-modal.ts', import.meta.url), 'utf8'),
    propertyRow: readFileSync(new URL('../src/services/property-row-service.ts', import.meta.url), 'utf8'),
    menuController: readFileSync(new URL('../src/menu/menu-controller.ts', import.meta.url), 'utf8'),
    settings: readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8'),
    checklist: readFileSync(new URL('../src/handlers/checklist-handler.ts', import.meta.url), 'utf8'),
  };

  assert.match(sources.panel, /buildSubitemTreeRecursive[\s\S]{0,350}isIgnoredFile\(file\)/u);
  assert.match(sources.metadata, /relationshipRootIgnored[\s\S]{0,320}bodySubitemLinkService\.scanFile/u);
  assert.match(sources.checkbox, /ensureForView[\s\S]{0,420}isIgnoredFile\(file\)/u);
  assert.match(sources.checkbox, /syncDerivedStatusForChildFromReferences[\s\S]{0,220}isIgnoredFile\(childFile\)/u);
  assert.match(sources.checkbox, /buildEditorDecorations[\s\S]{0,1100}isIgnoredFile\(parentFile\)/u);
  assert.match(sources.sync, /linkExistingChildToParent[\s\S]{0,300}isIgnoredFile\(childFile\)[\s\S]{0,120}isIgnoredFile\(parentFile\)/u);
  assert.match(sources.creation, /parseYaml\(finalFrontmatterLines\.slice\(1\)\.join\('\\n'\)\)/u);
  assert.match(sources.creation, /isIgnoredFrontmatter\(childWorkflowFrontmatter\)/u);
  assert.match(sources.bulk, /unlinkFromAllParents[\s\S]{0,260}getStoredParentsForChild\(childFile\)/u);
  assert.match(sources.menu, /filter: \(candidate\) => \([\s\S]{0,180}!this\.plugin\.parentLinkResolutionService\.isIgnoredFile\(candidate\)/u);
  assert.match(sources.panel, /filter: \(candidate\) => \([\s\S]{0,180}!this\.plugin\.parentLinkResolutionService\.isIgnoredFile\(candidate\)/u);
  assert.match(sources.panelAction, /canUseRelationshipActions[\s\S]{0,360}isRelationshipTarget\(file\)[\s\S]{0,120}isIgnoredFile\(file\)/u);
  assert.match(sources.fileSuggest, /fileFilter[\s\S]{0,1000}extensionFiltered\.filter\(this\.fileFilter\)/u);
  assert.match(sources.multiFileSelect, /files\.filter\(options\.filter\)/u);
  assert.match(sources.unresolved, /checkAndPromptForUnresolvedSubitems[\s\S]{0,240}isIgnoredFile\(parentFile\)/u);
  assert.match(sources.unresolved, /mutateMarkdownBody\(parentFile,[\s\S]{0,180}isIgnoredFile\(parentFile\)/u);
  assert.match(sources.checkbox, /openScheduledModal[\s\S]{0,240}\(\) => !relationshipIsIgnored\(\)/u);
  assert.match(sources.checkbox, /openAddTagModal[\s\S]{0,220}\(\) => !relationshipIsIgnored\(\)/u);
  assert.match(sources.propertyRow, /openStatusSubmenu[\s\S]{0,180}writeGuard\?: \(\) => boolean/u);
  assert.match(sources.propertyRow, /setStatus\(files, status, \{ writeGuard \}\)/u);
  assert.match(sources.menuController, /openAddTagModal\([\s\S]{0,260}writeGuard\?\.\(\) === false/u);
  assert.match(sources.menuController, /addTag\(files, tag, key, \{ writeGuard \}\)/u);
  assert.match(sources.menuController, /openScheduledModal\([\s\S]{0,500}writeGuard\?\.\(\) === false/u);
  assert.match(sources.menuController, /updateScheduledDetails\([\s\S]{0,260}\{ writeGuard \}/u);
  assert.match(sources.menuController, /runQueuedMove\([\s\S]{0,180}writeGuard\?\.\(\) === false/u);
  assert.match(sources.bulk, /frontmatterMutationService\.process\(file,[\s\S]{0,120}options\.writeGuard\?\.\(file\) === false/u);
  assert.match(sources.checklist, /handleChecklistCompletion\(file: TFile, writeGuard\?: \(\) => boolean\)/u);
  assert.match(sources.checklist, /writeGuard\?\.\(\) === false[\s\S]{0,80}await this\.app\.vault\.modify/u);
  assert.equal((sources.settings.match(/linkedSubitemCheckboxService\.ensureForAllMarkdownViews\(\)/gu) || []).length >= 3, true);
  assert.equal((sources.settings.match(/linkedSubitemCheckboxService\.refreshLivePreviewEditors\(\)/gu) || []).length >= 3, true);
});
