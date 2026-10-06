import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import ts from 'typescript';

const renderedRootSelector =
  '.markdown-preview-view, .markdown-reading-view, .markdown-rendered, .markdown-preview-section';
const sourceRoot = process.env.TPS_NOTE_TITLE_SOURCE_ROOT
  ? resolve(process.env.TPS_NOTE_TITLE_SOURCE_ROOT)
  : fileURLToPath(new URL('..', import.meta.url));
const serviceEntry = resolve(sourceRoot, 'src/services/note-title-render-service.ts');
const mainSource = readFileSync(resolve(sourceRoot, 'src/main.ts'), 'utf8');
const leafResolverSource = readFileSync(resolve(sourceRoot, 'src/services/leaf-resolver.ts'), 'utf8');
const visibilityHelperSource = leafResolverSource.slice(
  leafResolverSource.indexOf('export function isLeafVisible('),
  leafResolverSource.indexOf('export function isSideDockLeaf('),
);
let querySelectorAllCalls = 0;

class FakeElement {
  constructor(name, classes = []) {
    this.name = name;
    this.classes = new Set(classes);
    this.children = [];
    this.parentElement = null;
    this.isLink = false;
    this.dataset = {};
    this.textContent = '';
    this.title = '';
    this.queryObserver = null;
    this.isConnected = true;
    this.rect = { width: 800, height: 600 };
    this.computedStyle = { display: 'block', visibility: 'visible' };
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  matches(selector) {
    if (
      this.isLink
      && /(?:internal-link|data-href|data-linkpath|app:\/\/obsidian\.md\/)/u.test(selector)
    ) {
      return true;
    }
    return selector
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .some((part) => part.startsWith('.') && this.classes.has(part.slice(1)));
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    querySelectorAllCalls += 1;
    this.queryObserver?.(selector);
    const matches = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  getAttribute(name) {
    if (name === 'data-href') return this.dataset.href ?? null;
    if (name === 'data-linkpath') return this.dataset.linkpath ?? null;
    if (name === 'href') return this.dataset.href ?? null;
    return null;
  }

  countLinks() {
    let count = this.isLink ? 1 : 0;
    for (const child of this.children) count += child.countLinks();
    return count;
  }

  getBoundingClientRect() {
    this.geometryObserver?.('rect');
    return this.rect;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector.replace(':scope > ', ''))[0] ?? null;
  }

  contains(target) {
    return target === this || this.children.some(child => child.contains?.(target));
  }

  addClass(name) { this.classes.add(name); }
  removeClass(name) { this.classes.delete(name); }
  setAttribute() {}
  set className(value) { this.classes = new Set(value.split(' ')); }
  get firstElementChild() { return this.children[0] ?? null; }

  prepend(child) {
    child.remove();
    child.parentElement = this;
    child.isConnected = this.isConnected;
    this.children.unshift(child);
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    }
    this.parentElement = null;
    this.isConnected = false;
  }
}

globalThis.HTMLElement = FakeElement;
globalThis.window = {
  getComputedStyle(element) {
    element.geometryObserver?.('style');
    return element.computedStyle;
  },
};

function makeLeaf(view) {
  return { view, containerEl: new FakeElement('leaf') };
}

const serviceBuild = await build({
  entryPoints: [serviceEntry],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  plugins: [{
    name: 'note-title-refresh-test-stubs',
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({
        path: 'obsidian',
        namespace: 'note-title-refresh-stub',
      }));
      builder.onResolve({ filter: /text-input-modal$/ }, () => ({
        path: 'text-input-modal',
        namespace: 'note-title-refresh-stub',
      }));
      builder.onResolve({ filter: /leaf-resolver$/ }, () => ({
        path: 'leaf-resolver',
        namespace: 'note-title-refresh-stub',
      }));
      builder.onResolve({ filter: /logger$/ }, () => ({
        path: 'logger',
        namespace: 'note-title-refresh-stub',
      }));
      builder.onResolve({ filter: /display-title$/ }, () => ({
        path: 'display-title',
        namespace: 'note-title-refresh-stub',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'note-title-refresh-stub' }, (args) => {
        if (args.path === 'obsidian') {
          return {
            contents: [
              'export class MarkdownView {}',
              'export class Notice { constructor(message) { globalThis.__tpsTitleNotice = message; } }',
              'export class TFile {',
              '  constructor(path) {',
              '    this.path = path;',
              '    this.extension = "md";',
              '    this.basename = path.split("/").pop().replace(/\\.md$/u, "");',
              '    this.name = `${this.basename}.md`;',
              '  }',
              '}',
              'globalThis.__tpsNoteTitleRefreshTFile = TFile;',
            ].join('\n'),
          };
        }
        if (args.path === 'text-input-modal') {
          return { contents: 'export class TextInputModal { constructor(app, label, initialValue, submit) { globalThis.__tpsTitleSubmit = submit; } open() {} }' };
        }
        if (args.path === 'leaf-resolver') {
          return {
            loader: 'ts',
            // Execute the actual eligibility helper; only editor mode is modeled.
            contents: `export function isStrictSourceMode(view) { return view.strictSource === true; }\n${visibilityHelperSource}`,
          };
        }
        if (args.path === 'logger') {
          return {
            contents: [
              'export function flow() {}',
              'export function flowError() {}',
              'export function error() {}',
            ].join('\n'),
          };
        }
        return {
          contents: 'export function getPlainDisplayTitle(value, fallback) { return String(value || fallback || ""); }',
        };
      });
    },
  }],
});
const serviceModule = await import(
  `data:text/javascript;base64,${Buffer.from(serviceBuild.outputFiles[0].text).toString('base64')}`
);
const TestTFile = globalThis.__tpsNoteTitleRefreshTFile;

function makeLink(name) {
  const link = new FakeElement(name, ['internal-link']);
  link.isLink = true;
  link.dataset.href = 'Target';
  link.textContent = 'Target';
  return link;
}

function makeNestedTree({ sectionCount = 4, linksPerSection = 3 } = {}) {
  const content = new FakeElement('content');
  const reading = content.append(new FakeElement('reading', ['markdown-reading-view']));
  const wrapper = reading.append(new FakeElement('wrapper'));
  const rendered = wrapper.append(new FakeElement('rendered', ['markdown-rendered']));
  const sections = [];
  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
    const section = rendered.append(
      new FakeElement(`section-${sectionIndex}`, ['markdown-preview-section']),
    );
    sections.push(section);
    for (let linkIndex = 0; linkIndex < linksPerSection; linkIndex += 1) {
      section.append(makeLink(`link-${sectionIndex}-${linkIndex}`));
    }
  }
  return { content, reading, rendered, sections };
}

function makeDisjointTree({ rootCount = 4, linksPerRoot = 3 } = {}) {
  const content = new FakeElement('content');
  const roots = [];
  for (let rootIndex = 0; rootIndex < rootCount; rootIndex += 1) {
    const root = content.append(
      new FakeElement(`root-${rootIndex}`, ['markdown-preview-section']),
    );
    roots.push(root);
    for (let linkIndex = 0; linkIndex < linksPerRoot; linkIndex += 1) {
      root.append(makeLink(`link-${rootIndex}-${linkIndex}`));
    }
  }
  return { content, roots };
}

function createHarness(contentRoots) {
  const titleRefreshes = [];
  const processedRoots = [];
  let linkVisits = 0;
  const leaves = contentRoots.map((contentEl, index) => makeLeaf({
    file: new TestTFile(`Notes/View ${index + 1}.md`),
    contentEl,
  }));
  const service = new serviceModule.NoteTitleRenderService({
    app: {
      workspace: {
        getLeavesOfType(type) {
          assert.equal(type, 'markdown');
          return leaves;
        },
      },
    },
  });
  service.refreshInlineTitleAndIcon = (view) => {
    titleRefreshes.push(view.file.path);
  };
  service.processRenderedNoteLinks = (root, sourcePath) => {
    processedRoots.push({ name: root.name, sourcePath });
    linkVisits += root.countLinks();
  };
  return {
    service,
    titleRefreshes,
    processedRoots,
    get linkVisits() {
      return linkVisits;
    },
  };
}

function createRealServiceHarness(contentEl, { viewPath = 'Notes/Benchmark.md' } = {}) {
  const targetFile = new TestTFile('Notes/Target.md');
  const viewFile = new TestTFile(viewPath);
  let targetTitle = 'Rendered Target';
  let metadataResolutions = 0;
  const resolutionSources = [];
  const service = new serviceModule.NoteTitleRenderService({
    settings: { enableAutoRename: false },
    app: {
      workspace: {
        getLeavesOfType() {
          return [makeLeaf({ file: viewFile, contentEl })];
        },
      },
      metadataCache: {
        getFileCache(file) {
          return file === targetFile
            ? { frontmatter: { title: targetTitle } }
            : null;
        },
        getFirstLinkpathDest(rawTarget, sourcePath) {
          metadataResolutions += 1;
          resolutionSources.push(sourcePath);
          return rawTarget === 'Target' ? targetFile : null;
        },
      },
      vault: {
        getFileByPath(path) {
          return path === targetFile.path ? targetFile : null;
        },
      },
    },
  });
  service.refreshInlineTitleAndIcon = () => {};
  return {
    service,
    targetFile,
    viewFile,
    setTargetTitle(value) { targetTitle = value; },
    resolutionSources,
    get metadataResolutions() {
      return metadataResolutions;
    },
  };
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function percentile(values, percentileValue) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * percentileValue) - 1];
}

if (process.env.TPS_NOTE_TITLE_BENCHMARK === '1') {
  const benchmarkCase = process.env.TPS_NOTE_TITLE_BENCHMARK_CASE || 'dense-nested';
  const benchmarkIterations = Math.max(
    1,
    Number.parseInt(process.env.TPS_NOTE_TITLE_BENCHMARK_ITERATIONS || '40', 10),
  );
  const measurements = [];
  let expectedVisits = 0;
  let expectedQueries = 0;
  for (let iteration = 0; iteration < benchmarkIterations; iteration += 1) {
    const tree = benchmarkCase === 'empty-nested'
      ? makeNestedTree({ sectionCount: 500, linksPerSection: 0 })
      : benchmarkCase === 'disjoint'
        ? makeDisjointTree({ rootCount: 500, linksPerRoot: 20 })
        : makeNestedTree({ sectionCount: 500, linksPerSection: 20 });
    const harness = createRealServiceHarness(tree.content);
    querySelectorAllCalls = 0;
    const startedAt = performance.now();
    harness.service.refreshInlineTitles();
    measurements.push(performance.now() - startedAt);
    expectedVisits = harness.metadataResolutions;
    expectedQueries = querySelectorAllCalls;
  }
  process.stdout.write(`${JSON.stringify({
    sourceRoot,
    benchmarkCase,
    iterations: measurements.length,
    candidateRoots: benchmarkCase === 'disjoint' ? 500 : 502,
    links: benchmarkCase === 'empty-nested' ? 0 : 10_000,
    querySelectorAllCalls: expectedQueries,
    linkVisits: expectedVisits,
    medianMs: median(measurements),
    p95Ms: percentile(measurements, 0.95),
  })}\n`);
} else {
  test('recurring title refresh processes one outer root for a nested rendered view', () => {
    const tree = makeNestedTree({ sectionCount: 500, linksPerSection: 20 });
    const harness = createHarness([tree.content]);

    harness.service.refreshInlineTitles();

    assert.deepEqual(harness.titleRefreshes, ['Notes/View 1.md']);
    assert.deepEqual(
      harness.processedRoots,
      [{ name: 'reading', sourcePath: 'Notes/View 1.md' }],
    );
    assert.equal(harness.linkVisits, 10_000, 'every rendered link must remain reachable exactly once');
  });

  test('disjoint rendered roots remain independently processed in document order', () => {
    const content = new FakeElement('content');
    const first = content.append(new FakeElement('first', ['markdown-preview-section']));
    first.append(makeLink('first-link'));
    const ordinaryWrapper = content.append(new FakeElement('ordinary-wrapper'));
    const second = ordinaryWrapper.append(new FakeElement('second', ['markdown-rendered']));
    second.append(makeLink('second-link-1'));
    second.append(makeLink('second-link-2'));
    const harness = createHarness([content]);

    harness.service.refreshInlineTitles();

    assert.deepEqual(
      harness.processedRoots,
      [
        { name: 'first', sourcePath: 'Notes/View 1.md' },
        { name: 'second', sourcePath: 'Notes/View 1.md' },
      ],
    );
    assert.equal(harness.linkVisits, 3);
  });

  test('candidate ancestry is bounded to the queried content root', () => {
    const outside = new FakeElement('outside', ['markdown-reading-view']);
    const content = outside.append(new FakeElement('content'));
    const section = content.append(new FakeElement('section', ['markdown-preview-section']));
    section.append(makeLink('link'));
    const harness = createHarness([content]);

    harness.service.refreshInlineTitles();

    assert.deepEqual(
      harness.processedRoots,
      [{ name: 'section', sourcePath: 'Notes/View 1.md' }],
    );
    assert.equal(harness.linkVisits, 1);
  });

  test('a matching content root is not mistaken for a queried ancestor', () => {
    const content = new FakeElement('content', ['markdown-reading-view']);
    const section = content.append(new FakeElement('section', ['markdown-preview-section']));
    section.append(makeLink('link'));
    const harness = createHarness([content]);

    harness.service.refreshInlineTitles();

    assert.deepEqual(
      harness.processedRoots,
      [{ name: 'section', sourcePath: 'Notes/View 1.md' }],
    );
    assert.equal(harness.linkVisits, 1);
  });

  test('title and icon refresh runs first and once for every valid Markdown leaf', () => {
    const first = new FakeElement('first-content');
    const firstRoot = first.append(new FakeElement('first-root', ['markdown-preview-view']));
    firstRoot.append(makeLink('first-link'));
    const second = new FakeElement('second-content');
    const secondRoot = second.append(new FakeElement('second-root', ['markdown-rendered']));
    secondRoot.append(makeLink('second-link'));
    const invalidFileContent = new FakeElement('invalid-file-content');
    invalidFileContent.append(new FakeElement('invalid-file-root', ['markdown-rendered']));
    const invalidContent = {};
    const leaves = [
      { view: { file: new TestTFile('Notes/First.md'), contentEl: first } },
      { view: { file: { path: 'Notes/Not a TFile.md' }, contentEl: invalidFileContent } },
      { view: { file: new TestTFile('Notes/Invalid content.md'), contentEl: invalidContent } },
      { view: { file: new TestTFile('Notes/Second.md'), contentEl: second } },
    ].map(({ view }) => makeLeaf(view));
    const lifecycle = [];
    first.queryObserver = () => lifecycle.push('query:first');
    second.queryObserver = () => lifecycle.push('query:second');
    const service = new serviceModule.NoteTitleRenderService({
      app: {
        workspace: {
          getLeavesOfType() {
            return leaves;
          },
        },
      },
    });
    const processedRoots = [];
    service.refreshInlineTitleAndIcon = (view) => lifecycle.push(`title:${view.file.path}`);
    service.processRenderedNoteLinks = (root, sourcePath) => {
      processedRoots.push({ name: root.name, sourcePath });
    };

    service.refreshInlineTitles();

    assert.deepEqual(
      lifecycle,
      [
        'title:Notes/First.md',
        'query:first',
        'title:Notes/Second.md',
        'query:second',
      ],
    );
    assert.deepEqual(
      processedRoots,
      [
        { name: 'first-root', sourcePath: 'Notes/First.md' },
        { name: 'second-root', sourcePath: 'Notes/Second.md' },
      ],
    );
  });

  test('newly mounted rendered roots are processed on the next recurring refresh', () => {
    const firstContent = new FakeElement('first-content');
    firstContent.append(new FakeElement('first-root', ['markdown-rendered']));
    const secondContent = new FakeElement('second-content');
    secondContent.append(new FakeElement('second-root', ['markdown-preview-section']));
    const view = {
      file: new TestTFile('Notes/Dynamic.md'),
      contentEl: firstContent,
    };
    const processedRoots = [];
    const service = new serviceModule.NoteTitleRenderService({
      app: {
        workspace: {
          getLeavesOfType() {
            return [makeLeaf(view)];
          },
        },
      },
    });
    service.refreshInlineTitleAndIcon = () => {};
    service.processRenderedNoteLinks = (root) => processedRoots.push(root.name);

    service.refreshInlineTitles();
    view.contentEl = secondContent;
    service.refreshInlineTitles();

    assert.deepEqual(processedRoots, ['first-root', 'second-root']);
  });

  test('outer-root processing preserves link titles, targets, exclusions, and source paths', () => {
    const content = new FakeElement('content');
    const reading = content.append(new FakeElement('reading', ['markdown-reading-view']));
    const readingLink = reading.append(makeLink('reading-link'));
    const rendered = reading.append(new FakeElement('rendered', ['markdown-rendered']));
    const renderedLink = rendered.append(makeLink('rendered-link'));
    const section = rendered.append(new FakeElement('section', ['markdown-preview-section']));
    const sectionLink = section.append(makeLink('section-link'));
    const aliasedLink = section.append(makeLink('aliased-link'));
    aliasedLink.textContent = 'Custom alias';
    const menu = reading.append(new FakeElement('menu', ['menu']));
    const excludedLink = menu.append(makeLink('excluded-link'));
    const harness = createRealServiceHarness(content, { viewPath: 'Notes/Source.md' });

    harness.service.refreshInlineTitles();

    for (const link of [readingLink, renderedLink, sectionLink]) {
      assert.equal(link.textContent, 'Rendered Target');
      assert.equal(link.dataset.tpsGcmOriginalText, 'Target');
      assert.equal(link.dataset.tpsGcmRenderedTitle, 'Rendered Target');
      assert.equal(link.dataset.href, 'Target', 'rendered text must not change the link target');
      assert.equal(link.title, harness.targetFile.path);
    }
    assert.equal(aliasedLink.textContent, 'Custom alias');
    assert.equal(aliasedLink.dataset.tpsGcmRenderedTitle, undefined);
    assert.equal(excludedLink.textContent, 'Target');
    assert.equal(excludedLink.dataset.tpsGcmRenderedTitle, undefined);
    assert.equal(harness.metadataResolutions, 4);
    assert.deepEqual(harness.resolutionSources, Array(4).fill('Notes/Source.md'));
  });

  test('the recurring selector and 900 ms mobile refresh contract remain unchanged', () => {
    assert.equal(
      renderedRootSelector,
      '.markdown-preview-view, .markdown-reading-view, .markdown-rendered, .markdown-preview-section',
    );
    assert.match(
      mainSource,
      /if \(Platform\.isMobile\) \{\s*this\.registerInterval\(window\.setInterval\(\(\) => \{\s*this\.noteTitleRenderService\.refreshInlineTitles\(\);\s*\}, 900\)\);\s*\}/u,
    );
  });
}


function makeRenameHarness({ changed = true, autoRename = true, failure = false } = {}) {
  const file = new TestTFile('Inbox/Before.md');
  const state = { title: 'Before', renames: 0, events: 0, refreshes: 0 };
  const plugin = {
    settings: { enableAutoRename: autoRename },
    app: {
      vault: { getFileByPath: path => path === file.path ? file : null },
      metadataCache: { getFileCache: () => ({ frontmatter: { title: state.title } }) },
    },
    fileNamingService: {
      async updateFilenameIfNeeded(target, options) {
        state.renames++;
        target.path = `Inbox/${options.titleOverride}.md`;
      },
    },
    bulkEditService: {
      async updateFrontmatter(files, updates) {
        if (failure) throw new Error('Write failed');
        if (!changed) return 0;
        state.title = updates.title;
        // The shared writer owns the filename update and its completion event.
        if (autoRename) await plugin.fileNamingService.updateFilenameIfNeeded(files[0], { titleOverride: updates.title });
        plugin.eventService.emitFilesUpdated([files[0].path]);
        return 1;
      },
    },
    eventService: { emitFilesUpdated() { state.events++; } },
    overlayRenderingService: { scheduleFileRefresh() { state.refreshes++; } },
  };
  globalThis.__tpsTitleNotice = null;
  return { file, state, service: new serviceModule.NoteTitleRenderService(plugin) };
}

function watchRenderedTitleWork(t, service, file) {
  const callbacks = [];
  t.mock.method(globalThis, 'setTimeout', callback => {
    callbacks.push(callback);
    return callbacks.length;
  });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = { setTimeout: globalThis.setTimeout };
  globalThis.document = { activeElement: null };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  // Exercise the actual render path with an already-rendered inline title.
  // A differing filename is not permission for the renderer to mutate it.
  const title = new FakeElement('title', ['inline-title']);
  service.resolveInlineTitleElement = () => title;
  return {
    callbacks,
    render() {
      title.textContent = service.getDisplayTitle(file);
      service.refreshInlineTitle({ file });
    },
    drain() {
      while (callbacks.length) callbacks.shift()();
    },
  };
}

test('rendering mismatched or stale titles never schedules filename mutations', t => {
  const { file, state, service } = makeRenameHarness();
  const work = watchRenderedTitleWork(t, service, file);
  // Metadata/display caches can temporarily retain the previous title after a
  // rename. Repeated rendering must not turn that stale value into a new edit.
  file.path = 'Inbox/Already renamed.md';
  file.basename = 'Already renamed';
  for (let index = 0; index < 25; index++) work.render();
  state.title = 'New cached title';
  service.clearTitleCache(file.path);
  for (let index = 0; index < 25; index++) work.render();
  const scheduled = work.callbacks.length;
  work.drain();
  assert.deepEqual({ scheduled, renames: state.renames }, { scheduled: 0, renames: 0 });
  assert.equal(file.path, 'Inbox/Already renamed.md');
});

test('rendering after an explicit title save does not replay the writer-owned rename', async t => {
  const { file, state, service } = makeRenameHarness();
  const work = watchRenderedTitleWork(t, service, file);
  await service.promptRenameTitle(file);
  await globalThis.__tpsTitleSubmit('After');
  assert.equal(state.renames, 1, 'the explicit frontmatter writer still owns the filename update');
  for (let index = 0; index < 25; index++) work.render();
  const scheduled = work.callbacks.length;
  work.drain();
  assert.deepEqual({ scheduled, renames: state.renames }, { scheduled: 0, renames: 1 });
  assert.equal(file.path, 'Inbox/After.md');
});

test('a cancelled or rejected title write cannot rename the file or announce success', async () => {
  const { file, state, service } = makeRenameHarness({ changed: false });
  await service.promptRenameTitle(file);
  await globalThis.__tpsTitleSubmit('After');
  assert.equal(file.path, 'Inbox/Before.md');
  assert.equal(state.title, 'Before');
  assert.equal(state.renames, 0);
  assert.equal(state.events, 0);
  assert.equal(state.refreshes, 0);
});

test('a successful title edit uses the shared writer once for the filename', async () => {
  const { file, state, service } = makeRenameHarness();
  await service.promptRenameTitle(file);
  await globalThis.__tpsTitleSubmit('  After   rename  ');
  assert.equal(state.title, 'After rename');
  assert.equal(file.path, 'Inbox/After rename.md');
  assert.equal(state.renames, 1);
  assert.equal(state.events, 1);
  assert.equal(state.refreshes, 1);
});

test('title editing with auto-rename disabled preserves the filename', async () => {
  const { file, state, service } = makeRenameHarness({ autoRename: false });
  await service.promptRenameTitle(file);
  await globalThis.__tpsTitleSubmit('After');
  assert.equal(state.title, 'After');
  assert.equal(file.path, 'Inbox/Before.md');
  assert.equal(state.renames, 0);
});

test('an exception during title editing leaves the filename alone and reports failure', async () => {
  const { file, state, service } = makeRenameHarness({ failure: true });
  await service.promptRenameTitle(file);
  await globalThis.__tpsTitleSubmit('After');
  assert.equal(file.path, 'Inbox/Before.md');
  assert.equal(state.title, 'Before');
  assert.equal(state.renames, 0);
  assert.equal(globalThis.__tpsTitleNotice, 'Title rename failed.');
});


function metadataTitleHarness(t) {
  const file = new TestTFile('Inbox/Native.md');
  const other = new TestTFile('Inbox/Other.md');
  const counts = { reads: 0, writes: 0, timers: 0, links: 0, textWrites: 0, titleLookups: 0, metadata: 0 };
  let title = 'Before';
  const makeView = file => {
    const element = new FakeElement('title', ['inline-title']);
    element.textContent = file === other ? 'Other' : 'Before';
    element.contains = target => target === element;
    element.addClass = key => element.classes.add(key);
    element.removeClass = key => element.classes.delete(key);
    element.setAttribute = () => {};
    return { file, element };
  };
  const first = makeView(file), second = makeView(file), unrelated = makeView(other);
  const leaves = [first, second, unrelated, { file: null }].map(view => ({ view }));
  const service = new serviceModule.NoteTitleRenderService({ settings: { enableInlinePersistentMenus: false }, app: {
    workspace: { getLeavesOfType(type) { assert.equal(type, 'markdown'); return leaves; } },
    metadataCache: { getFileCache(target) { counts.metadata++; return { frontmatter: { title: target === file ? title : 'Other' } }; } },
    vault: { read() { counts.reads++; }, cachedRead() { counts.reads++; }, modify() { counts.writes++; }, getMarkdownFiles() { throw Error('No vault scan'); } },
  } });
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  globalThis.document = { activeElement: null };
  globalThis.window = { setTimeout() { counts.timers++; } };
  t.after(() => { globalThis.document = previousDocument; globalThis.window = previousWindow; });
  service.resolveInlineTitleElement = view => { counts.titleLookups++; return view.element; };
  service.setInlineTitleText = (element, next) => { counts.textWrites++; element.textContent = next; };
  service.processRenderedNoteLinks = () => { counts.links++; };
  service.getDisplayTitle(file); // Populate the old display cache before metadata changes.
  service.getDisplayTitle(other);
  counts.metadata = 0;
  return { service, file, other, counts, first, second, unrelated, setTitle(value) { title = value; } };
}

test('an uncached already-open desktop title paints without inline menus or a timer', t => {
  const h = metadataTitleHarness(t);
  h.service.clearTitleCache(h.file.path);
  h.first.element.textContent = 'Native';
  h.service.refreshInlineTitle(h.first);
  assert.equal(h.first.element.textContent, 'Before');
  assert.equal(h.counts.textWrites, 1);
  assert.equal(h.counts.timers, 0);
  assert.equal(h.counts.reads, 0);
  assert.equal(h.counts.writes, 0);
});

test('metadata arrival refreshes every open title for that file synchronously', t => {
  const h = metadataTitleHarness(t);
  h.setTitle('After');
  h.service.handleMetadataChanged(h.file);
  assert.equal(h.first.element.textContent, 'After');
  assert.equal(h.second.element.textContent, 'After');
  assert.equal(h.unrelated.element.textContent, 'Other');
  assert.deepEqual(h.counts, { reads: 0, writes: 0, timers: 0, links: 0, textWrites: 2, titleLookups: 2, metadata: 1 });
});

test('unchanged metadata bursts cause no title lookups, DOM writes, file reads or timers', t => {
  const h = metadataTitleHarness(t);
  for (let i = 0; i < 100; i++) h.service.handleMetadataChanged(h.file);
  assert.deepEqual(h.counts, { reads: 0, writes: 0, timers: 0, links: 0, textWrites: 0, titleLookups: 0, metadata: 100 });
  h.setTitle('First'); h.service.handleMetadataChanged(h.file);
  h.setTitle('Latest'); h.service.handleMetadataChanged(h.file);
  assert.equal(h.first.element.textContent, 'Latest');
  assert.equal(h.counts.textWrites, 4);
  assert.equal(h.counts.titleLookups, 4);
});

test('unchanged metadata for an unopened note avoids rendered DOM work', t => {
  const h = metadataTitleHarness(t);
  const closed = new TestTFile('Inbox/Closed.md');
  h.service.getDisplayTitle(closed);
  const before = h.counts.metadata;
  for (let i = 0; i < 100; i++) h.service.handleMetadataChanged(closed);
  assert.equal(h.counts.metadata, before + 100);
  assert.equal(h.counts.textWrites, 0);
  assert.equal(h.counts.links, 0);
  assert.equal(h.service.linkTitleCache.has(closed.path), true);
  assert.equal(h.service.linkTitleCache.has(h.other.path), true);
});

test('a real target-title change refreshes existing rendered links without a recurring timer', () => {
  const content = new FakeElement('content');
  const reading = content.append(new FakeElement('reading', ['markdown-reading-view']));
  const link = reading.append(makeLink('target-link'));
  const h = createRealServiceHarness(content);
  h.service.refreshInlineTitles();
  assert.equal(link.textContent, 'Rendered Target');
  const queriesBefore = querySelectorAllCalls;
  const resolutionsBefore = h.metadataResolutions;

  for (let i = 0; i < 100; i++) h.service.handleMetadataChanged(h.targetFile);
  assert.equal(querySelectorAllCalls, queriesBefore);
  assert.equal(h.metadataResolutions, resolutionsBefore);

  h.setTargetTitle('Renamed Target');
  h.service.handleMetadataChanged(h.targetFile);
  assert.equal(link.textContent, 'Renamed Target');
  assert.equal(h.metadataResolutions, resolutionsBefore + 1);
});

test('metadata refresh preserves active title editing and strict-source filename display', t => {
  const h = metadataTitleHarness(t);
  h.setTitle('New title');
  globalThis.document.activeElement = h.first.element;
  h.first.element.textContent = 'Still typing';
  h.second.strictSource = true;
  h.service.handleMetadataChanged(h.file);
  assert.equal(h.first.element.textContent, 'Still typing');
  assert.equal(h.second.element.textContent, 'Native');
  assert.equal(h.counts.writes, 0);
});

test('the existing metadata listener owns immediate title display refresh', () => {
  const source = readFileSync(resolve(sourceRoot, 'src/events/register-events.ts'), 'utf8');
  const handler = source.slice(source.indexOf("plugin.app.metadataCache.on('changed'"), source.indexOf("plugin.app.vault.on('modify'"));
  assert.match(handler, /noteTitleRenderService\?\.handleMetadataChanged\(file\)/u);
});

// These cases execute the real title service and visibility predicate. The three
// unchanged icon lifecycle methods run too; DOM, icon painting, file metadata,
// and editor-mode reporting are modeled rather than an Obsidian/mobile host.
const menuSource = readFileSync(resolve(sourceRoot, 'src/menu/persistent-menu-manager.ts'), 'utf8');
const parsedMenu = ts.createSourceFile('persistent-menu-manager.ts', menuSource, ts.ScriptTarget.Latest, true);
const iconMethodNames = new Set(['refreshInlineTitleIcon', 'ensureInlineTitleIcon', 'removeInlineTitleIcon']);
const iconMethods = [];
function collectIconMethods(node) {
  if (ts.isMethodDeclaration(node) && iconMethodNames.has(node.name.getText(parsedMenu))) {
    iconMethods.push(node.getText(parsedMenu));
  }
  ts.forEachChild(node, collectIconMethods);
}
collectIconMethods(parsedMenu);
assert.equal(iconMethods.length, 3);
const iconClass = await transform(`class IconHarness { ${iconMethods.join('\n')} }`, { loader: 'ts' });

function sweepHarness(t, { architecture = 'native-records', inlineMenus = true } = {}) {
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const events = [], leaves = [], targets = new Map(), titles = new Map(), timers = [];
  const counts = { resolutions: 0, metadata: 0, titleLookups: 0, titleWrites: 0, icons: 0, paints: 0 };
  globalThis.document = {
    activeElement: null,
    createElement() {
      const element = new FakeElement('icon');
      element.style = { removeProperty() {} };
      return element;
    },
  };
  globalThis.window = {
    ...previousWindow,
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
  };
  t.after(() => { globalThis.document = previousDocument; globalThis.window = previousWindow; });
  const plugin = {
    settings: { dataArchitectureMode: architecture, enableInlinePersistentMenus: inlineMenus },
    app: {
      workspace: { getLeavesOfType() { return leaves; }, activeLeaf: null },
      metadataCache: {
        getFileCache(file) { counts.metadata++; return { frontmatter: { title: titles.get(file.path) ?? file.basename } }; },
        getFirstLinkpathDest(raw, sourcePath) {
          counts.resolutions++; events.push(`link:${sourcePath}`);
          return targets.get(raw) ?? null;
        },
      },
      vault: {
        getFileByPath(path) { return [...targets.values()].find(file => file.path === path) ?? null; },
        getMarkdownFiles() { throw Error('No vault inventory'); },
        read() { throw Error('No body read'); },
        cachedRead() { throw Error('No body read'); },
        modify() { throw Error('No source mutation'); },
      },
    },
  };
  const service = new serviceModule.NoteTitleRenderService(plugin);
  service.resolveInlineTitleElement = view => { counts.titleLookups++; return view.inlineTitle; };
  service.setInlineTitleText = (element, next) => {
    events.push(`write:${element.name}`); counts.titleWrites++; element.textContent = next;
  };
  const IconHarness = new Function('TFile', 'isStrictSourceMode', `${iconClass.code}; return IconHarness;`)(
    TestTFile, view => view.strictSource === true,
  );
  const icons = new IconHarness();
  Object.assign(icons, {
    plugin, titleIcons: new Map(), resolveInlineTitleElement: view => view.inlineTitle,
    resolveInlineTitleIconValue: () => 'file-text', resolveTitleIconColor: () => '',
    renderInlineTitleIcon() { counts.paints++; },
  });
  const refreshIcon = icons.refreshInlineTitleIcon.bind(icons);
  icons.refreshInlineTitleIcon = view => { counts.icons++; events.push(`icon:${view.file.path}`); refreshIcon(view); };
  plugin.persistentMenuManager = icons;
  function addTarget(path, title) {
    const file = new TestTFile(path);
    targets.set(file.basename, file); targets.set(file.path, file); titles.set(file.path, title);
    return file;
  }
  function addLeaf({ path, links = 1, connected = true, display = 'block', visibility = 'visible', width = 800, height = 600, strictSource = false } = {}) {
    const tree = makeNestedTree({ sectionCount: 1, linksPerSection: links });
    const file = addTarget(path ?? `Notes/View ${leaves.length}.md`, `Authored ${leaves.length}`);
    const inlineTitle = new FakeElement(file.path, ['inline-title']);
    inlineTitle.textContent = file.basename;
    const leaf = makeLeaf({ file, contentEl: tree.content, inlineTitle, strictSource });
    leaf.containerEl.isConnected = connected;
    leaf.containerEl.computedStyle = { display, visibility };
    leaf.containerEl.rect = { width, height };
    leaf.containerEl.geometryObserver = kind => events.push(`${kind}:${file.path}`);
    leaves.push(leaf);
    return { leaf, tree, view: leaf.view, link: tree.sections[0].children[0] };
  }
  return { service, plugin, icons, counts, events, leaves, targets, titles, timers, addTarget, addLeaf };
}

for (const architecture of ['native-records', 'legacy']) {
  test(`recurring sweep skips hidden/detached DOM across cold and warm bursts (${architecture})`, t => {
    const h = sweepHarness(t, { architecture });
    h.addTarget('Notes/Target.md', 'Rendered Target');
    h.addLeaf({ links: 1000, display: 'none' });
    h.addLeaf({ links: 1000, visibility: 'hidden' });
    h.addLeaf({ links: 1000, connected: false });
    querySelectorAllCalls = 0;
    for (let tick = 0; tick < 12; tick++) h.service.refreshInlineTitles();
    assert.deepEqual(h.counts, { resolutions: 0, metadata: 0, titleLookups: 0, titleWrites: 0, icons: 0, paints: 0 });
    assert.equal(querySelectorAllCalls, 0, 'ineligible leaves must not query title or rendered-link DOM');
    assert.equal(h.events.filter(event => event.startsWith('rect:')).length, 24);
    assert.equal(h.events.filter(event => event.startsWith('style:')).length, 24);
    assert.equal(h.timers.length, 0, 'the refresh must not schedule replacement work');
  });
}

test('every visible split pane refreshes while hidden retained links do no work', t => {
  const h = sweepHarness(t);
  h.addTarget('Notes/Target.md', 'Rendered Target');
  const first = h.addLeaf({ links: 200 }), second = h.addLeaf({ links: 300 });
  h.addLeaf({ links: 4000, display: 'none' });
  h.addLeaf({ links: 5000, connected: false });
  h.plugin.app.workspace.activeLeaf = first.leaf;
  h.service.refreshInlineTitles();
  assert.equal(h.counts.resolutions, 500);
  assert.equal(h.counts.icons, 2);
  assert.equal(second.link.textContent, 'Rendered Target', 'nonactive visible panes remain consumers');
  assert.equal(h.icons.titleIcons.size, 2);
  h.service.refreshInlineTitles();
  assert.equal(h.counts.resolutions, 1000, 'visible links retain their existing warm fallback');
  assert.equal(h.counts.titleWrites, 2, 'unchanged titles remain mounted');
  assert.equal(h.counts.paints, 2, 'unchanged icons remain mounted');
  h.plugin.settings.dataArchitectureMode = 'legacy';
  h.service.refreshInlineTitles();
  assert.equal(h.counts.resolutions, 1500, 'legacy mode refreshes the same two visible panes');
  assert.equal(h.counts.icons, 6);
  assert.equal(h.counts.titleWrites, 2);
  assert.equal(h.counts.paints, 2);
});

test('all eligibility geometry/style reads finish before title, icon or link work', t => {
  const h = sweepHarness(t);
  h.addTarget('Notes/Target.md', 'Rendered Target');
  const first = h.addLeaf(), hidden = h.addLeaf({ display: 'none' }), second = h.addLeaf();
  h.service.refreshInlineTitles();
  const eligibility = [first, hidden, second].flatMap(({ view }) => [`rect:${view.file.path}`, `style:${view.file.path}`]);
  assert.deepEqual(h.events.slice(0, eligibility.length), eligibility);
  assert.ok(h.events.slice(eligibility.length).every(event => !/^(rect|style):/u.test(event)));
  assert.equal(h.counts.resolutions, 2);
});

test('shared eligibility honors connection, size and computed visibility without active-leaf narrowing', t => {
  const h = sweepHarness(t);
  const smallWidth = h.addLeaf({ width: 39 }), smallHeight = h.addLeaf({ height: 39 });
  const boundary = h.addLeaf({ width: 40, height: 40 }), missing = h.addLeaf();
  delete missing.leaf.containerEl;
  h.service.refreshInlineTitles();
  assert.equal(h.counts.icons, 1);
  assert.equal(boundary.view.inlineTitle.textContent, 'Authored 2');
  assert.equal(smallWidth.view.inlineTitle.textContent, smallWidth.view.file.basename);
  assert.equal(smallHeight.view.inlineTitle.textContent, smallHeight.view.file.basename);
});

test('a hidden retained root catches up on its next visible tick without a metadata event', t => {
  const h = sweepHarness(t);
  h.addTarget('Notes/Target.md', 'Rendered Target');
  const pane = h.addLeaf({ display: 'none' });
  const alias = pane.tree.sections[0].append(makeLink('alias')); alias.textContent = 'Authored alias';
  h.service.refreshInlineTitles();
  assert.equal(pane.link.textContent, 'Target');
  assert.equal(h.counts.resolutions, 0);
  pane.leaf.containerEl.computedStyle.display = 'block';
  h.service.refreshInlineTitles();
  assert.equal(pane.link.textContent, 'Rendered Target');
  assert.equal(alias.textContent, 'Authored alias');
  assert.equal(pane.link.dataset.href, 'Target');
  assert.equal(h.counts.resolutions, 2);
});

for (const lifecycle of ['new target', 'renamed target']) {
  test(`uncached ${lifecycle} is retitled when its retained hidden pane becomes visible`, t => {
    const h = sweepHarness(t);
    const pane = h.addLeaf();
    let target;
    if (lifecycle === 'renamed target') {
      target = h.addTarget('Notes/Target.md', 'Before rename');
      h.service.refreshInlineTitles();
      assert.equal(pane.link.textContent, 'Before rename');
      h.targets.delete(target.path); h.targets.delete(target.basename);
      target.path = 'Notes/Arrived.md'; target.basename = 'Arrived'; target.name = 'Arrived.md';
      pane.link.dataset.href = 'Arrived'; // Core's own incoming-link target update.
      h.targets.set('Arrived', target); h.targets.set(target.path, target);
      h.titles.set(target.path, 'After rename');
    } else {
      h.service.processRenderedNoteLinks(pane.tree.reading, pane.view.file.path);
      assert.equal(pane.link.textContent, 'Target');
      target = h.addTarget('Notes/Target.md', 'Newly available');
    }
    pane.leaf.containerEl.computedStyle.display = 'none';
    assert.equal(h.service.linkTitleCache.has(target.path), false);
    const before = pane.link.textContent;
    h.service.handleMetadataChanged(target);
    assert.equal(pane.link.textContent, before, 'uncached target metadata has no prior rendered-link ownership');
    const calls = h.counts.resolutions;
    h.service.refreshInlineTitles();
    assert.equal(h.counts.resolutions, calls);
    pane.leaf.containerEl.computedStyle.display = 'block';
    h.service.refreshInlineTitles();
    assert.equal(pane.link.textContent, lifecycle === 'new target' ? 'Newly available' : 'After rename');
  });
}

test('delayed title and icon remounts retain both the existing tick and direct refresh owners', t => {
  const h = sweepHarness(t);
  const pane = h.addLeaf({ links: 0 });
  h.service.refreshInlineTitles();
  const originalIcon = h.icons.titleIcons.get(pane.view);
  const replaceTitle = () => {
    const title = new FakeElement(pane.view.file.path, ['inline-title']);
    title.textContent = pane.view.file.basename;
    pane.view.inlineTitle = title;
    return title;
  };
  const replacement = replaceTitle();
  h.service.refreshInlineTitles();
  assert.equal(replacement.textContent, 'Authored 0');
  assert.equal(h.icons.titleIcons.get(pane.view).parentElement, replacement);
  assert.notEqual(h.icons.titleIcons.get(pane.view), originalIcon);
  assert.equal(originalIcon.isConnected, false);
  pane.leaf.containerEl.computedStyle.display = 'none';
  const delayed = replaceTitle();
  h.service.scheduleInlineTitleRefresh(pane.view);
  assert.deepEqual(h.timers.map(timer => timer.delay), [0, 120, 400]);
  for (const timer of h.timers) timer.callback();
  assert.equal(delayed.textContent, 'Authored 0', 'direct owners are not visibility-gated');
  assert.equal(h.icons.titleIcons.get(pane.view).parentElement, delayed);
});

test('visible strict Source and active title editing retain text and icon protections', t => {
  const h = sweepHarness(t);
  h.addTarget('Notes/Target.md', 'Rendered Target');
  const pane = h.addLeaf();
  h.service.refreshInlineTitles();
  pane.view.strictSource = true;
  h.service.refreshInlineTitles();
  assert.equal(pane.view.inlineTitle.textContent, pane.view.file.basename);
  assert.equal(h.icons.titleIcons.has(pane.view), false);
  assert.equal(h.counts.resolutions, 2, 'strict Source does not silently exclude retained rendered roots');
  pane.view.strictSource = false;
  pane.view.inlineTitle.textContent = 'Currently typing';
  globalThis.document.activeElement = pane.view.inlineTitle;
  h.service.refreshInlineTitles();
  assert.equal(pane.view.inlineTitle.textContent, 'Currently typing');
  assert.equal(h.icons.titleIcons.has(pane.view), false);
  globalThis.document.activeElement = null;
  h.service.refreshInlineTitles();
  assert.equal(pane.view.inlineTitle.textContent, 'Authored 0');
  assert.equal(h.icons.titleIcons.size, 1);
});

test('disabled inline menus still refresh eligible text and links without icons', t => {
  const h = sweepHarness(t, { inlineMenus: false });
  h.addTarget('Notes/Target.md', 'Rendered Target');
  const pane = h.addLeaf();
  h.service.refreshInlineTitles();
  assert.equal(pane.view.inlineTitle.textContent, 'Authored 0');
  assert.equal(pane.link.textContent, 'Rendered Target');
  assert.equal(h.icons.titleIcons.size, 0);
  assert.equal(h.counts.paints, 0);
});

test('metadata and postprocessor owners still update hidden rendered links independently', t => {
  const h = sweepHarness(t);
  const target = h.addTarget('Notes/Target.md', 'Before');
  const pane = h.addLeaf({ display: 'none' });
  h.service.processRenderedNoteLinks(pane.tree.reading, pane.view.file.path);
  assert.equal(pane.link.textContent, 'Before');
  h.titles.set(target.path, 'After');
  h.service.handleMetadataChanged(target);
  assert.equal(pane.link.textContent, 'After');
  assert.equal(h.events.some(event => /^(rect|style):/u.test(event)), false);
});
