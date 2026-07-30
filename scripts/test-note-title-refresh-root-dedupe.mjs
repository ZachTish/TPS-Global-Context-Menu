import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const renderedRootSelector =
  '.markdown-preview-view, .markdown-reading-view, .markdown-rendered, .markdown-preview-section';
const sourceRoot = process.env.TPS_NOTE_TITLE_SOURCE_ROOT
  ? resolve(process.env.TPS_NOTE_TITLE_SOURCE_ROOT)
  : fileURLToPath(new URL('..', import.meta.url));
const serviceEntry = resolve(sourceRoot, 'src/services/note-title-render-service.ts');
const mainSource = readFileSync(resolve(sourceRoot, 'src/main.ts'), 'utf8');
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
}

globalThis.HTMLElement = FakeElement;

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
              'export class Notice {}',
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
          return { contents: 'export class TextInputModal {}' };
        }
        if (args.path === 'leaf-resolver') {
          return { contents: 'export function isStrictSourceMode() { return false; }' };
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
  const leaves = contentRoots.map((contentEl, index) => ({
    view: {
      file: new TestTFile(`Notes/View ${index + 1}.md`),
      contentEl,
    },
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
  let metadataResolutions = 0;
  const resolutionSources = [];
  const service = new serviceModule.NoteTitleRenderService({
    settings: { enableAutoRename: false },
    app: {
      workspace: {
        getLeavesOfType() {
          return [{ view: { file: viewFile, contentEl } }];
        },
      },
      metadataCache: {
        getFileCache(file) {
          return file === targetFile
            ? { frontmatter: { title: 'Rendered Target' } }
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
    ];
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
            return [{ view }];
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
      /registerInterval\(window\.setInterval\(\(\) => \{\s*this\.noteTitleRenderService\.refreshInlineTitles\(\);\s*\}, 900\)\);/u,
    );
  });
}
