import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { build } from 'esbuild';

const source = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('settings-tab.ts', source, ts.ScriptTarget.Latest, true);
const methods = [];
const wanted = new Set(['renderRecordSettings', 'renderDailyNoteRecognition', 'createTrackedSection', 'getSectionStateKey']);
let collapsible;
(function visit(node) {
  if ((ts.isMethodDeclaration(node) && wanted.has(node.name?.getText(ast))) || (ts.isGetAccessor(node) && node.name?.getText(ast) === 'settingsContentEl')) methods.push(node.getText(ast));
  if (ts.isVariableDeclaration(node) && node.name?.getText(ast) === 'createCollapsibleSection') collapsible = node.getText(ast);
  ts.forEachChild(node, visit);
})(ast);
const bundled = await build({ entryPoints: ['src/utils/kind-classification.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const classification = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

class Element {
  constructor(tag = 'div', options = {}, parent = null) {
    Object.assign(this, { tag, text: options.text || '', cls: options.cls || '', parentElement: parent, children: [], rows: [], attrs: {}, dataset: {}, style: {}, events: {}, open: false });
  }
  createEl(tag, options) { const child = new Element(tag, options, this); this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  setAttr(key, value) { this.attrs[key] = value; if (key === 'open') this.open = true; }
  setAttribute(...args) { this.setAttr(...args); }
  setText(value) { this.text = value; }
  empty() { this.children = []; this.rows = []; }
  addEventListener(type, callback) { (this.events[type] ||= []).push(callback); }
  closest() { return this.dataset.tpsSettingsRoute ? this : this.parentElement?.closest() || null; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelector(selector) { const label = selector.match(/aria-label="([^"]+)"/)?.[1]; return this.all().find(el => label ? el.attrs['aria-label'] === label : el.tag === selector) || null; }
  focus() { this.focused = true; }
  toggle(open) { this.open = open; for (const callback of this.events.toggle || []) callback(); }
}
class Setting {
  constructor(parent) { this.settingEl = parent.createDiv(); this.controlEl = this.settingEl.createDiv(); this.name = ''; parent.rows.push(this); }
  setName(value) { this.name = value; return this; }
  setDesc(value) { this.description = value; return this; }
  add(fn, tag) {
    const el = this.controlEl.createEl(tag);
    const c = { inputEl: el, selectEl: el, buttonEl: el, toggleEl: el, options: {}, setValue(value) { this.value = value; return this; }, setPlaceholder() { return this; }, setButtonText(value) { this.text = value; return this; }, setCta() { return this; }, setWarning() { return this; }, setDisabled() { return this; }, addOption(key, label) { this.options[key] = label; return this; }, onChange(callback) { this.change = callback; return this; }, onClick(callback) { this.click = callback; return this; } };
    this.control = c; fn(c); return this;
  }
  addText(fn) { return this.add(fn, 'input'); }
  addDropdown(fn) { return this.add(fn, 'select'); }
  addToggle(fn) { return this.add(fn, 'input'); }
  addButton(fn) { return this.add(fn, 'button'); }
}
const output = ts.transpileModule(`const ${collapsible}; export class Tab { ${methods.join('\n')} }`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  const calls = { saves: 0, vault: 0, migrations: 0, config: 0, opened: [] };
  const app = { setting: { open() { calls.opened.push('settings'); }, openTabById(id) { calls.opened.push(id); } }, vault: { getMarkdownFiles() { calls.vault++; return []; } } };
  const deps = { ...classification, Setting, Notice: class {}, TFile: class {}, PropertyMigrationModal: {} };
  const exports = {};
  new Function('exports', ...Object.keys(deps), output)(exports, ...Object.values(deps));
  const container = new Element();
  const tab = Object.assign(new exports.Tab(), { app, containerEl: container, sectionState: new Map(), activeClassificationType: '', addingRecordType: false, activeBaseCreateRouteIndex: -1, plugin: {
    fileNamingService: { getDailyNoteConfigurationSnapshot() { calls.config++; return { format: 'YYYY-MM-DD', folder: 'Inbox/Daily', source: 'core' }; } },
    settings: { nativeRecordKindPropertyKey: 'kind', nativeRecordKindPropertyKeys: {
      dailynote: { primary: { tag: 'journal/day' }, aliases: [{ tag: 'old/day' }] },
      food: { primary: { kindList: { key: 'kind', value: 'entity' } }, aliases: [], discriminator: { key: 'entityKind', value: 'food' } },
      task: { primary: { scalar: { key: 'kind', value: 'task' } }, aliases: [] },
    }, nativeBaseCreateRoutes: [] },
    async saveSettings() { calls.saves++; },
    propertyMigrationService: { async configureNewClassification(kind, definition) { calls.migrations++; tab.plugin.settings.nativeRecordKindPropertyKeys[kind] = { primary: definition, aliases: [] }; } },
  } });
  const render = () => { container.empty(); tab.renderRecordSettings(container); return container; };
  tab.display = render;
  const rows = () => container.all().flatMap(el => el.rows);
  const row = name => rows().find(row => row.name === name);
  return { tab, container, calls, render, row, rows };
}

test('Records opens with filename recognition, one closed mapping editor and no vault or save work', () => {
  const h = harness(); h.render();
  assert.equal(h.tab.activeClassificationType, 'dailynote');
  assert.match(h.row('Recognize by date filename').description, /Inbox\/Daily\/YYYY-MM-DD\.md/);
  assert.match(h.row('Recognize by date filename').description, /No Kind property or tag is required/);
  assert.equal(h.container.all().filter(el => el.tag === 'details').length, 1);
  assert.equal(h.container.all().find(el => el.tag === 'details').open, false);
  assert.equal(h.row('New record type'), undefined);
  assert.deepEqual({ saves: h.calls.saves, vault: h.calls.vault, migrations: h.calls.migrations }, { saves: 0, vault: 0, migrations: 0 });
  h.row('Recognize by date filename').control.click();
  assert.deepEqual(h.calls.opened, ['settings', 'daily-notes']);
});

test('one selected editor preserves all classification and creation actions and switches types without saving', () => {
  const h = harness(); h.render();
  for (const label of ['Identify this type by', 'Tag', 'Kind value', 'Kind list property', 'Single-value property', 'Save subtype', 'Use for new records', 'Update existing notes', 'Add earlier classification', 'Create new records with this mapping', 'Remove record mapping', 'Add Base route']) assert.ok(h.row(label), label);
  const detail = h.container.all().find(el => el.tag === 'details'); detail.toggle(true);
  h.row('Record type').control.change('food');
  assert.match(h.container.all().find(el => el.cls === 'tps-gcm-settings-record-summary').text, /kind contains entity · entityKind = food/);
  assert.equal(h.container.querySelector('[aria-label="Subtype property key"]').parentElement.parentElement.style.display, '');
  h.render();
  assert.equal(h.container.all().find(el => el.tag === 'details').open, true);
  assert.equal(h.calls.saves, 0); assert.equal(h.calls.migrations, 0); assert.equal(h.calls.vault, 0);
});

test('adding a type is deliberate and cancellation restores focus without writing settings', () => {
  const h = harness(); h.render();
  h.row('Add a record type').control.click();
  assert.ok(h.row('New record type'));
  assert.equal(h.container.querySelector('[aria-label="New record type name"]').focused, true);
  assert.ok(h.row('Add record type'));
  h.row('Add a record type').control.click();
  assert.equal(h.row('New record type'), undefined);
  assert.equal(h.container.querySelector('[aria-label="Record type classification"]').focused, true);
  h.tab.plugin.settings.nativeRecordKindPropertyKeys = {};
  h.render();
  h.row('Add a record type').control.click();
  assert.equal(h.container.querySelector('[aria-label="New record type name"]').focused, true);
  h.row('Add a record type').control.click();
  assert.equal(h.row('New record type'), undefined);
  assert.equal(h.container.querySelector('[aria-label="Add a record type"]').focused, true);
  assert.equal(h.calls.saves, 0); assert.equal(h.calls.migrations, 0);
});

test('Records has a separate reachable route and preserves the Custom fields entry point', () => {
  assert.match(source, /id: 'records', label: 'Records'/);
  assert.match(source, /activeRulesFieldsPage === 'records'\) this\.renderRecordSettings\(activePage\)/);
  assert.match(source, /private activeRulesFieldsPage: RulesFieldsPageId = 'custom-fields'/);
  for (const file of ['../src/types.ts', '../src/constants.ts']) assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /addingRecordType|activeClassificationType/);
  const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.tps-gcm-settings-route-button\s*\{[\s\S]*height: auto/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*\.tps-gcm-settings-subnav/);
});

test('subtype tag selection exposes one tag field, preserves drafts, and saves through reviewed migration',async()=>{
 const h=harness();let request;
 h.tab.plugin.propertyMigrationService.configureClassificationDiscriminator=async(...args)=>{request=args;};
 h.render();h.row('Record type').control.change('food');
 const selector=h.row('Identify subtype by').control;
 selector.change('tag');
 assert.equal(h.row('Subtype property').settingEl.style.display,'none');
 assert.equal(h.row('Subtype tag').settingEl.style.display,'');
 assert.equal(selector.selectEl.focused,true);
 assert.equal(h.calls.saves,0);assert.equal(h.calls.vault,0);
 await h.row('Save subtype').control.click();
 assert.deepEqual(request,['food',{key:'tags',value:'food'},{kindList:{key:'kind',value:'entity'}}]);
 for(let i=0;i<20;i++)h.render();
 assert.equal(h.calls.saves,0);assert.equal(h.calls.vault,0);
});
