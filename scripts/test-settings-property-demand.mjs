import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { build } from 'esbuild';

const source = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('settings-tab.ts', source, ts.ScriptTarget.Latest, true);
const methods = [];
const wanted = new Set(['renderProperties', 'renderCustomPropertyEditor', 'renderPropertyOptionSettings']);
(function visit(node) {
  if (ts.isMethodDeclaration(node) && wanted.has(node.name?.getText(ast))) methods.push(node.getText(ast));
  ts.forEachChild(node, visit);
})(ast);
const bundled = await build({
  stdin: { contents: `export * from './src/utils/property-options'; export * from './src/utils/property-option-source';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'obsidian', setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class App {} export const getAllTags = () => [];', loader: 'js' }));
  } }],
});
const helpers = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

class Element {
  constructor(tag = 'div', options = {}) { this.tag = tag; this.children = []; this.style = {}; this.dataset = {}; this.attrs = { ...(options.attr || {}) }; this.cls = options.cls || ''; this.text = options.text || ''; this.events = {}; this.hidden = false; this.open = false; this.rows = []; }
  createEl(tag, options = {}) { const el = new Element(tag, options); this.children.push(el); return el; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  empty() { this.children = []; this.rows = []; }
  setAttr(key, value) { this.attrs[key] = value; if (key === 'open') this.open = true; }
  setAttribute(...args) { this.setAttr(...args); }
  setText(value) { this.text = value; }
  toggleClass() {}
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  querySelector(selector) { return this.all().find(el => selector.startsWith('.') ? el.cls.split(' ').includes(selector.slice(1)) : el.tag === selector) || null; }
  all() { return this.children.flatMap(el => [el, ...el.all()]); }
  toggle(open) { this.open = open; for (const fn of this.events.toggle || []) fn(); }
}
class Setting {
  constructor(parent) { this.settingEl = parent.createDiv(); this.controlEl = this.settingEl.createDiv(); this.descEl = this.settingEl.createDiv(); parent.rows.push(this); }
  setName(value) { this.name = value; return this; }
  setDesc(value) { this.descEl.text = value; return this; }
  addControl(fn, tag) {
    const el = this.controlEl.createEl(tag);
    const control = { inputEl: el, selectEl: el, buttonEl: el, value: '', options: {}, setValue(value) { this.value = value; el.value = value; return this; }, setPlaceholder() { return this; }, setButtonText(value) { el.text = value; return this; }, setDisabled() { return this; }, addOption(k, v) { this.options[k] = v; return this; }, onChange(fn) { this.change = fn; return this; }, onClick(fn) { this.click = fn; return this; } };
    this.control = control; fn(control); return this;
  }
  addText(fn) { return this.addControl(fn, 'input'); }
  addSearch(fn) { return this.addControl(fn, 'input'); }
  addTextArea(fn) { return this.addControl(fn, 'textarea'); }
  addDropdown(fn) { return this.addControl(fn, 'select'); }
  addToggle(fn) { return this.addControl(fn, 'input'); }
  addButton(fn) { return this.addControl(fn, 'button'); }
}
const code = ts.transpileModule(`export class Tab { ${methods.join('\n')} }`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(properties, { openKeys = [], withValues = false } = {}) {
  const counts = { scans: 0, metadata: 0, values: 0, saves: 0, kinds: 0 };
  const files = Array.from({ length: 1000 }, (_, i) => ({ path: `Inbox/${i}.md`, frontmatter: { value: i % 2 ? 'Beta' : 'Alpha' } }));
  const app = { vault: { getMarkdownFiles() { counts.scans++; return files; } }, metadataCache: { getFileCache(file) { counts.metadata++; return { frontmatter: file.frontmatter }; } } };
  const deps = { ...helpers, Setting, getPropertyKeyDiagnostic: () => '', renderNavigatorPropertyVisibility: () => {}, normalizeAcceptsKind: value => value ? [value] : [], normalizeAcceptedKindSetting: value => String(value || ''), formatAcceptedKindConstraint: value => String(value), document: {} };
  const exports = {};
  new Function('exports', ...Object.keys(deps), code)(exports, ...Object.values(deps));
  const tab = Object.assign(new exports.Tab(), { app, propertySearch: '', propertyTypeFilter: '', sectionState: new Map(openKeys.map(k => [`Custom Property::${k}`, true])), plugin: { settings: { properties }, saveSettings: async () => { counts.saves++; }, entityIndexService: { getDimensionValues() { counts.kinds++; return ['task']; } } }, serializePropertyScopeCondition: x => x });
  tab.renderCustomPropertyValueSettings = (el, prop) => { counts.values++; if (withValues) tab.renderPropertyOptionSettings(el, prop, () => {}); };
  const container = new Element();
  const render = () => { tab.renderProperties(container); return container.children.filter(el => el.tag === 'details'); };
  return { tab, app, counts, container, render };
}
const prop = (id, extra = {}) => ({ id, key: id, label: id, type: 'selector', options: ['Manual'], optionSources: ['manual'], ...extra });

test('collapsed cards do no editor or option work, including repeated route renders', () => {
  const properties = Array.from({ length: 57 }, (_, i) => prop(`field${i}`));
  const h = harness(properties, { withValues: true });
  for (let i = 0; i < 20; i++) assert.equal(h.render().length, 57);
  assert.deepEqual(h.counts, { scans: 0, metadata: 0, values: 0, saves: 0, kinds: 0 });
  assert.equal(h.container.all().filter(e => e.cls === 'tps-collapsible-section-content').length, 0);
});

test('opening a card renders only its editor; collapse and reopen preserve drafts', () => {
  const h = harness([prop('one'), prop('two')]);
  const cards = h.render(); cards[0].toggle(true);
  assert.equal(h.counts.values, 1);
  assert.equal(h.counts.kinds, 0, 'helper copy must not initialize the vault entity index');
  const editor = cards[0].querySelector('.tps-collapsible-section-content');
  assert.ok(editor); editor.querySelector('input').value = 'Unapplied key';
  cards[0].toggle(false); cards[0].toggle(true);
  assert.equal(h.counts.values, 1);
  assert.equal(editor.querySelector('input').value, 'Unapplied key');
  cards[1].toggle(true);
  assert.equal(cards[0].open, false);
  assert.equal(h.counts.values, 2);
  assert.equal(h.counts.saves, 0);
});

test('restored open card is ready immediately without rendering its siblings', () => {
  const h = harness([prop('one'), prop('two'), prop('three')], { openKeys: ['two'] });
  const cards = h.render();
  assert.equal(h.counts.values, 1);
  assert.ok(cards[1].querySelector('.tps-collapsible-section-content'));
  cards[1].toggle(true);
  assert.equal(h.counts.values, 1, 'native queued toggle must not build twice');
});

test('manual-only and entity-only option previews do not scan unused vault values', () => {
  for (const sources of [['manual'], ['entity'], ['manual', 'entity']]) {
    const h = harness([]); const container = new Element();
    h.tab.renderPropertyOptionSettings(container, prop('value', { optionSources: sources, acceptsKind: 'project' }), () => {});
    assert.equal(h.counts.scans, 0, sources.join('+'));
    assert.equal(h.counts.metadata, 0);
    const chips = container.querySelector('.tps-gcm-property-options-preview');
    assert.deepEqual(chips.children.map(e => e.text), sources.includes('manual') ? ['Manual'] : []);
  }
});

test('vault preview still discovers current values and preserves manual-first ordering', () => {
  const h = harness([]), container = new Element();
  h.tab.renderPropertyOptionSettings(container, prop('value', { optionSources: ['manual', 'vault'] }), () => {});
  assert.equal(h.counts.scans, 1); assert.equal(h.counts.metadata, 1000);
  assert.deepEqual(container.querySelector('.tps-gcm-property-options-preview').children.map(e => e.text), ['Manual', 'Alpha', 'Beta']);
  assert.ok(container.all().some(e => e.text === '2 vault values found'));
});
