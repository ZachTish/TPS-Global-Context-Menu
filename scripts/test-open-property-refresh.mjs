import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function method(path, name) {
  const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  let found;
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === name) found = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found, name); return found;
}
const output = ts.transpileModule(`
${read('src/utils/custom-property-entry.ts')}
export class Builder { ${method('src/menu/panel-builder.ts', 'refreshStackedPropertiesPanel')} }
export class Manager { ${method('src/menu/persistent-menu-manager.ts', 'refreshOpenPropertiesForFile')} }
`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
new Function('exports', output)(exports);
const { propertyPanelSignature, Builder, Manager } = exports;

function fixture() {
  const file = { path: 'Inbox/Open.md' }, other = { path: 'Inbox/Other.md' };
  let cache = { frontmatter: { kind: ['note'], status: 'working' } };
  const counts = { reads: 0, renders: 0, replacements: 0, focuses: 0 };
  const doc = { activeElement: { name: 'body editor' } };
  const view = { file };
  let current;
  function panel(fm) {
    const result = { dataset: { frontmatterSignature: propertyPanelSignature(fm) }, ownerDocument: doc };
    const value = { owner: result, focus(options) { assert.deepEqual(options, { preventScroll: true }); counts.focuses++; doc.activeElement = this; } };
    const row = { dataset: { tpsGcmPropertyKey: 'status', tpsGcmPropertyId: 'status' }, querySelector: () => value };
    value.closest = () => row;
    value.classList = { contains: () => false };
    result.contains = node => node?.owner === result;
    result.querySelectorAll = () => [row];
    result.querySelector = () => value;
    result.replaceWith = next => { counts.replacements++; current = next; };
    result.value = value;
    result.values = structuredClone(fm);
    return result;
  }
  const builder = Object.assign(new Builder(), {
    plugin: { app: { metadataCache: { getFileCache(target) { assert.equal(target, file); counts.reads++; return cache; } } } },
    createStackedPropertiesPanel(target) { assert.equal(target, file); counts.renders++; return panel(cache.frontmatter || {}); },
  });
  current = panel(cache.frontmatter);
  const container = { isConnected: true, querySelector: () => current };
  const manager = Object.assign(new Manager(), {
    topParentNavs: new Map([[view, container]]),
    plugin: { menuController: { getPanelBuilder: () => builder } },
  });
  return { file, other, view, container, manager, counts, doc, current: () => current,
    setCache: next => { cache = next; }, refresh: () => manager.refreshOpenPropertiesForFile(file) };
}

test('mounted property values refresh while the body retains focus, including removal and empty frontmatter', () => {
  const f = fixture(), body = f.doc.activeElement;
  for (const fm of [{kind: ['note','task'], status: 'complete', amount: 0, done: false}, {kind: ['note']}, {}]) {
    f.setCache({frontmatter: fm}); f.refresh();
    assert.deepEqual(f.current().values, fm);
    assert.equal(f.doc.activeElement, body);
  }
  assert.deepEqual(f.counts, {reads: 3, renders: 3, replacements: 3, focuses: 0});
});

test('1,000 unchanged body metadata events retain the exact panel and perform no renders', () => {
  const f = fixture(), initial = f.current();
  for (let i = 0; i < 1000; i++) {
    f.setCache({frontmatter: {status: 'working', kind: ['note'], position: {end: {offset: i}}}});
    f.refresh();
  }
  assert.equal(f.current(), initial);
  assert.deepEqual(f.counts, {reads: 1000, renders: 0, replacements: 0, focuses: 0});
});

test('unrelated, switched and detached notes cause no metadata reads or renders', () => {
  const f = fixture();
  for (let i = 0; i < 1000; i++) f.manager.refreshOpenPropertiesForFile(f.other);
  f.view.file = f.other; f.refresh();
  f.view.file = f.file; f.container.isConnected = false; f.refresh();
  assert.deepEqual(f.counts, {reads: 0, renders: 0, replacements: 0, focuses: 0});
});

test('metadata absence keeps the current values; a later current revision wins', () => {
  const f = fixture(), old = f.current();
  f.setCache(null); f.refresh(); assert.equal(f.current(), old);
  f.setCache({frontmatter: {status: 'newer user edit'}}); f.refresh();
  f.refresh(); assert.deepEqual(f.current().values, {status: 'newer user edit'});
  assert.equal(f.counts.renders, 1);
});

test('refresh preserves property-button focus without scrolling or entering an input', () => {
  const f = fixture();
  f.doc.activeElement = f.current().value;
  f.setCache({frontmatter: {status: 'complete'}}); f.refresh();
  assert.equal(f.doc.activeElement, f.current().value);
  assert.equal(f.counts.focuses, 1);
});

test('all mounted copies update once and no unopened file is discovered', () => {
  const f = fixture(); let second = 0;
  f.manager.topParentNavs.set({file:f.file}, {isConnected:true, querySelector: () => ({dataset: {frontmatterSignature: propertyPanelSignature({kind:['note'],status:'working'})}})});
  const first = f.manager.plugin.menuController.getPanelBuilder();
  const refresh = first.refreshStackedPropertiesPanel.bind(first);
  first.refreshStackedPropertiesPanel = (panel,file) => { second++; refresh(panel,file); };
  f.refresh(); assert.equal(second, 2); assert.equal(f.counts.renders, 0);
});

test('the existing metadata callback owns the immediate refresh; creation records the rendered signature', () => {
  const events = read('src/events/register-events.ts');
  const changed = events.slice(events.indexOf("plugin.app.metadataCache.on('changed'"), events.indexOf("plugin.app.vault.on('modify'"));
  assert.match(changed, /refreshOpenPropertiesForFile\(file\)/);
  assert.ok(changed.indexOf('propertyMigrationService?.active') < changed.indexOf('refreshOpenPropertiesForFile'));
  assert.match(method('src/menu/panel-builder.ts', 'createStackedPropertiesPanel'), /panel\.dataset\.frontmatterSignature = propertyPanelSignature\(frontmatter\)/);
  const refresh = method('src/menu/panel-builder.ts','refreshStackedPropertiesPanel') + method('src/menu/persistent-menu-manager.ts','refreshOpenPropertiesForFile');
  assert.doesNotMatch(refresh, /setTimeout|setInterval|\.vault\.|getMarkdownFiles|\.editor\.|setViewData|save\(/);
});
