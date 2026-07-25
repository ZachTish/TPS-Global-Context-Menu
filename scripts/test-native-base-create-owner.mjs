import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const listSource = readFileSync(new URL('../src/tps-list/views/TpsListView.ts', import.meta.url), 'utf8');
const tableSource = readFileSync(new URL('../src/views/log-base-view.ts', import.meta.url), 'utf8');
const ownerSource = readFileSync(new URL('../src/views/native-base-create-owner.ts', import.meta.url), 'utf8');
const constantsSource = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
const dailyFeedSource = readFileSync(new URL('./fixtures/Daily Note Feed.base', import.meta.url), 'utf8');

class FakeElement {
  constructor(tagName = 'div', options = {}) {
    this.tagName = tagName.toLowerCase();
    this.parentElement = null;
    this.children = [];
    this.classes = new Set(options.classes || []);
    this.attributes = new Map(Object.entries(options.attributes || {}));
    this.textContent = options.textContent || '';
  }

  get lastElementChild() {
    return this.children.at(-1) || null;
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  matches(selectors) {
    return String(selectors || '').split(',').some((selector) => this.matchesOne(selector.trim()));
  }

  matchesOne(selector) {
    if (!selector) return false;
    if (selector.endsWith('> *')) {
      return this.parentElement?.matches(selector.slice(0, -3).trim()) === true;
    }
    if (selector.startsWith('.')) return this.classes.has(selector.slice(1));
    const attribute = selector.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/u);
    if (attribute) {
      if (!this.attributes.has(attribute[1])) return false;
      return attribute[2] == null || this.attributes.get(attribute[1]) === attribute[2];
    }
    return this.tagName === selector.toLowerCase();
  }

  closest(selectors) {
    let node = this;
    while (node) {
      if (node.matches(selectors)) return node;
      node = node.parentElement;
    }
    return null;
  }

  contains(candidate) {
    let node = candidate;
    while (node) {
      if (node === this) return true;
      node = node.parentElement;
    }
    return false;
  }

  querySelector(selectors) {
    for (const child of this.children) {
      if (child.matches(selectors)) return child;
      const nested = child.querySelector(selectors);
      if (nested) return nested;
    }
    return null;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

async function loadNativeCreateOwnerModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/views/native-base-create-owner.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

test('native Bases create delegates to the owning TPS List view', () => {
  assert.match(mainSource, /registerTpsListNativeCreateHandler\(\)/);
  assert.match(mainSource, /getTpsListNativeCreateScope\(target\)/);
  assert.match(mainSource, /getVisibleTpsBaseCreateRoot\(scope, '\.tps-list-scroll'\)/);
  assert.match(mainSource, /await view\.createFileForView\(\)/);
  assert.match(mainSource, /evt\.stopImmediatePropagation\(\)/);
  assert.match(mainSource, /evt\.key !== 'Enter' && evt\.key !== ' '/);
  assert.match(mainSource, /getTpsBaseNativeCreateEventTarget\(evt\.target\)/);
  assert.match(ownerSource, /target instanceof Element \? target : null/);
  assert.doesNotMatch(mainSource, /target\.closest\('\.tps-list-scroll'\)\) return/);
  assert.doesNotMatch(mainSource, /target\.closest\('\.tps-log-base'\)\) return/);
  assert.match(mainSource, /scope\.matches\(selector\) \? \[scope\] : \[\]/);
  assert.match(ownerSource, /const hasPlusIcon = candidate\.matches\(PLUS_ICON_SELECTOR\)/);
  assert.match(ownerSource, /isLastBaseChromeControl\(candidate, baseChrome\)/);
  assert.match(listSource, /Object\.assign\(scrollEl, \{ __tpsListView: this \}\)/);
});

test('nested SVG plus taps claim only the final item-create control in Base chrome', async () => {
  const priorElement = globalThis.Element;
  globalThis.Element = FakeElement;
  try {
    const {
      getTpsBaseNativeCreateEventTarget,
      isTpsBaseNativeCreateTarget,
    } = await loadNativeCreateOwnerModule();
    const scope = new FakeElement('section');
    const toolbar = scope.append(new FakeElement('div', { classes: ['bases-toolbar'] }));
    toolbar.append(new FakeElement('button', {
      attributes: { 'aria-label': 'Add view' },
    })).append(new FakeElement('svg', { classes: ['lucide-plus'] }));
    const createButton = toolbar.append(new FakeElement('button'));
    const createSvg = createButton.append(new FakeElement('svg', { classes: ['lucide-plus'] }));
    const createPath = createSvg.append(new FakeElement('path'));

    const normalized = getTpsBaseNativeCreateEventTarget(createPath);
    assert.equal(normalized, createPath);
    assert.equal(isTpsBaseNativeCreateTarget(normalized, scope), true);

    const addViewPath = toolbar.children[0].children[0].append(new FakeElement('path'));
    assert.equal(isTpsBaseNativeCreateTarget(addViewPath, scope), false);

    const popover = toolbar.append(new FakeElement('div', { classes: ['popover'] }));
    const popoverPath = popover
      .append(new FakeElement('button'))
      .append(new FakeElement('svg', { classes: ['lucide-plus'] }))
      .append(new FakeElement('path'));
    assert.equal(isTpsBaseNativeCreateTarget(popoverPath, scope), false);
    assert.equal(getTpsBaseNativeCreateEventTarget({}), null);
  } finally {
    if (priorElement === undefined) delete globalThis.Element;
    else globalThis.Element = priorElement;
  }
});

test('Daily Note Feed declares its selected note as the explicit task sink', () => {
  assert.match(constantsSource, /file\.path == this\.file\.path\s+    - task\.path == this\.file\.path/);
  assert.match(dailyFeedSource, /file\.path == this\.file\.path\s+    - task\.path == this\.file\.path/);
  assert.match(listSource, /resolveKanbanRootTaskTargetPath\(defaults\.targetPath/);
  assert.match(listSource, /for \(const root of \[\.\.\.roots\]\.reverse\(\)\)/);
  assert.match(listSource, /mergePriorityTaskCreationDefaults\(defaults, structured\)/);
  assert.match(listSource, /targetPath: higherPriority\.targetPathSpecified === true\s+\? higherPriority\.targetPath \?\? null\s+: lowerPriority\.targetPath \?\? null/);
});

test('native TPS List ownership cannot leak across neighboring Home components', () => {
  assert.match(mainSource, /'\.tps-home-panel'/);
  assert.match(mainSource, /const boundedOwner = target\.closest<HTMLElement>/);
  assert.match(mainSource, /getVisibleTpsBaseCreateRoot\(boundedOwner, rootSelector\) \? boundedOwner : null/);
  assert.match(mainSource, /getVisibleTpsBaseCreateRoot\(leaf, rootSelector\) \? leaf : null/);
});

test('native create ignores hidden stale custom views after a Base view switch', () => {
  assert.match(mainSource, /private getVisibleTpsBaseCreateRoot\(scope: HTMLElement, selector: string\): HTMLElement \| null/);
  assert.match(mainSource, /root\.isConnected && root\.getClientRects\(\)\.length > 0/);
  assert.match(mainSource, /return roots\.length === 1 \? roots\[0\] : null/);
  assert.match(listSource, /scrollEl\.removeClass\('tps-log-base'\)/);
  assert.match(listSource, /this\.scrollEl\.removeClass\('tps-list-scroll'\)/);
  assert.match(listSource, /__tpsListView === this\) delete/);
  assert.match(tableSource, /this\.containerEl\.removeClass\('tps-list-scroll'\)/);
  assert.match(tableSource, /this\.containerEl\.removeClass\('tps-log-base'\)/);
  assert.match(tableSource, /__tpsTableView === this\) delete/);
});

test('an in-flight TPS List create cannot fall through to native note creation', () => {
  assert.match(mainSource, /tpsNativeCreateInFlight === 'true'/);
  assert.match(mainSource, /delete listRoot\.dataset\.tpsNativeCreateInFlight/);
});
