import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Prec, Facet, EditorState } from '@codemirror/state';

const source = ts.createSourceFile('rows.ts', readFileSync(new URL('../src/services/linked-subitem-checkbox-service.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const builder = ts.createSourceFile('builder.ts', readFileSync(new URL('../src/services/linked-subitem-row-builder.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
function declaration(source, name) {
  let found;
  function visit(node) {
    if (node.name?.getText(source) === name && (ts.isMethodDeclaration(node) || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node))) found = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, name);
  return found;
}
class Element {
  constructor(host = null) {
    this.host = host;
    this.children = [];
    this.dataset = {};
    this.classes = new Set();
    this.classList = { add: (...names) => names.forEach(n => this.classes.add(n)), remove: (...names) => names.forEach(n => this.classes.delete(n)), contains: n => this.classes.has(n) };
  }
  get childNodes() { return this.children; }
  replaceChildren(...children) { this.children = children; }
  get nextElementSibling() { return this.host?.children[this.host.children.indexOf(this) + 1] ?? null; }
  get previousElementSibling() { return this.host?.children[this.host.children.indexOf(this) - 1] ?? null; }
  insertAdjacentElement(_position, row) { row.host = this.host; this.host.children.splice(this.host.children.indexOf(this) + 1, 0, row); }
  replaceWith(row) { row.host = this.host; this.host.children.splice(this.host.children.indexOf(this), 1, row); this.host = null; }
  remove() { if (this.host) this.host.children.splice(this.host.children.indexOf(this), 1); this.host = null; }
  closest() { return this.host; }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (child.classes.has(selector.slice(1))) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
}
let builds = 0;
function buildLinkedSubitemRow(model) {
  builds++;
  const container = new Element();
  container.classList.add('tps-gcm-linked-subitem-row-content');
  container.model = structuredClone(model);
  container.dataset = {linkedSubitemPath: model.childFile.path, linkedSubitemParent: model.parentFile.path};
  const content = new Element(); content.model = structuredClone(model); container.children.push(content);
  return { container, checkbox: null, pillsContainer: new Element() };
}
const output = ts.transpileModule(`
${declaration(builder, 'getLinkedSubitemRenderSignature')}
export ${declaration(source, 'LinkedSubitemRowWidget')}
export class Renderer {
  readingRows = new WeakMap();
  normalizeReadingModeHostElement(host) { return host; }
  findReadingModeNativeLink(host) { return host.anchor; }
  ${declaration(source, 'renderReadingModeRow')}
  ${declaration(source, 'removeStaleReadingRows')}
  ${declaration(source, 'buildFallbackSourceLineToElementMap')}
  ${declaration(source, 'getReadingModeSource')}
  ${declaration(source, 'getEditorExtension')}
}
`, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
const exports = {};
class WidgetType { updateDOM() { return false; } }
new Function('exports', 'WidgetType', 'buildLinkedSubitemRow', 'CM_WIDGET_CLASS', 'Prec', output)(exports, WidgetType, buildLinkedSubitemRow, 'widget', Prec);
function model() {
  return {childFile: {path: 'child.md'}, parentFile: {path: 'parent.md'}, kind: 'bullet', displayLabel: 'Child', checkboxState: '[ ]', checkboxIcon: 'circle', visualState: 'open', visualStateClass: 'is-open', pills: [{kind:'status',label:'Open',value:'open',propertyKey:'status'}]};
}
function fixture() {
  const renderer = new exports.Renderer();
  const host = new Element();
  host.anchor = new Element(host);
  host.children.push(host.anchor);
  return {renderer, host, model: model()};
}
function widget(m) { return new exports.LinkedSubitemRowWidget(m, ()=>{}, ()=>{}, ()=>{}); }

test('unchanged reading rows preserve DOM and do not build another row', () => {
  const f = fixture();
  const row = f.renderer.renderReadingModeRow(f.host, f.model);
  const before = builds;
  for(let i=0;i<100;i++) assert.equal(f.renderer.renderReadingModeRow(f.host, structuredClone(f.model)), row);
  assert.equal(builds, before);
  assert.equal(f.host.children.length, 2);
});
test('each rendered value or action target invalidates both reading and editor reuse', () => {
  const changes = [m=>m.displayLabel='Renamed', m=>m.kind='checkbox', m=>m.checkboxState='[x]', m=>m.checkboxIcon='star', m=>m.visualState='complete', m=>m.visualStateClass='is-complete', m=>m.pills[0].label='New', m=>m.pills[0].propertyKey='newStatus', m=>m.pills[0].value='done', m=>m.parentFile.path='another.md', m=>m.childFile.path='renamed.md'];
  for (const change of changes) {
    const f=fixture(); const before=f.renderer.renderReadingModeRow(f.host,f.model); const oldWidget=widget(f.model);
    const next=structuredClone(f.model); change(next);
    const after=f.renderer.renderReadingModeRow(f.host,next);
    assert.notEqual(after,before); assert.equal(before.host,null); assert.equal(f.host.children.length,2);
    assert.deepEqual(after.model,next); assert.equal(oldWidget.eq(widget(next)),false);
  }
});
test('editor equality snapshots paths and updates all content while retaining its mounted wrapper', () => {
  const m=model(); const old=widget(m);
  assert.equal(old.eq(widget(structuredClone(m))),true);
  m.childFile.path='renamed.md';
  assert.equal(old.eq(widget(m)),false);
  const dom = new Element();
  assert.equal(widget(m).updateDOM(dom),true);
  assert.equal(dom.dataset.linkedSubitemPath,'renamed.md');
  assert.deepEqual(dom.childNodes[0].model,m);
  m.displayLabel='New title'; m.pills[0].label='New pill';
  widget(m).updateDOM(dom);
  assert.deepEqual(dom.childNodes[0].model,m);
});
test('native rerenders and externally removed rows are repaired without trusting stale cache', () => {
  const f=fixture(); const before=f.renderer.renderReadingModeRow(f.host,f.model);
  before.remove(); const restored=f.renderer.renderReadingModeRow(f.host,f.model);
  assert.notEqual(restored,before); assert.equal(f.host.children.length,2);
  f.host.anchor.classList.remove('tps-gcm-hidden-native-link');
  const repaired=f.renderer.renderReadingModeRow(f.host,f.model);
  assert.notEqual(repaired,restored);
  assert.equal(f.host.anchor.classList.contains('tps-gcm-hidden-native-link'),true);
  const native = new Element(); native.anchor=new Element(native); native.children.push(native.anchor);
  assert.ok(f.renderer.renderReadingModeRow(native,f.model));
});
test('stale sweep preserves retained rows and restores removed native links', () => {
  const a=fixture(), b=fixture(); const root=new Element(); root.children.push(a.host,b.host);
  const keep=a.renderer.renderReadingModeRow(a.host,a.model); const remove=a.renderer.renderReadingModeRow(b.host,b.model);
  a.renderer.removeStaleReadingRows(root,new Set([keep]));
  assert.equal(remove.host,null); assert.equal(keep.host,a.host);
  assert.equal(b.host.anchor.classList.contains('tps-gcm-hidden-native-link'),false);
  assert.equal(b.host.classList.contains('tps-gcm-linked-subitem-task'),false);
  assert.equal(a.host.classList.contains('tps-gcm-linked-subitem-task'),true);
});
test('nested retained children do not preserve removed parent marker classes', () => {
  const a=fixture(), b=fixture(); const root=new Element(); root.children.push(a.host); a.host.children.push(b.host);
  a.renderer.renderReadingModeRow(a.host,a.model); const child=a.renderer.renderReadingModeRow(b.host,b.model);
  a.renderer.removeStaleReadingRows(root,new Set([child]));
  assert.equal(a.host.classList.contains('tps-gcm-linked-subitem-task'),false);
  assert.equal(b.host.classList.contains('tps-gcm-linked-subitem-task'),true);
});
test('missing native target leaves the host untouched', () => {
  const f=fixture(); f.host.anchor=null; const before=builds;
  assert.equal(f.renderer.renderReadingModeRow(f.host,f.model),null);
  assert.equal(builds,before); assert.equal(f.host.classes.size,0);
});
test('reading refresh sweeps only after complete mapping and never clears before rendering', () => {
  const method=declaration(source,'decorateView');
  assert.match(method,/retainedRows.size === subitemEntries.size/);
  const render=method.slice(method.indexOf('const retainedRows'));
  assert.doesNotMatch(render,/clearDecorations/);
});

test('fallback maps actual destinations once per host, in order, ignoring section-relative lines', () => {
  const renderer = new exports.Renderer();
  function host(target) {
    const h={line:0};
    const anchor={closest:()=>h,getAttribute:()=>target};
    h.querySelectorAll=()=>[anchor]; h.childNodes=[anchor];
    return h;
  }
  const hosts=[host('other'),host('child'),host('child')];
  const prose=host('child'); prose.childNodes.unshift({nodeType:3,textContent:'An inline reference to '});
  renderer.resolveLinkedFile=link=>({path:link+'.md'});
  const entries=new Map(['other','child','child'].map((path,i)=>[i+5,{childFile:{path:path+'.md'},model:{parentFile:{path:'parent.md'}}}]));
  const mapped=renderer.buildFallbackSourceLineToElementMap({querySelectorAll:()=>[prose,...hosts]},[],entries);
  assert.deepEqual([...mapped.values()],hosts);
  assert.equal(new Set(mapped.values()).size,3);
});
test('Reading view uses current preview data even when the hidden editor is stale or preview is empty', () => {
  const renderer = new exports.Renderer();
  assert.equal(renderer.getReadingModeSource({data:'current',editor:{getValue:()=> 'stale'}}),'current');
  assert.equal(renderer.getReadingModeSource({data:'',editor:{getValue:()=> 'stale'}}),'');
  assert.equal(renderer.getReadingModeSource({editor:{getValue:()=> 'fallback'}}),'fallback');
});

test('linked-row extension precedes native link decorations regardless of registration order', () => {
  const facet=Facet.define();
  const renderer=new exports.Renderer();
  renderer.editorExtension=facet.of('linked row');
  for (const extensions of [[facet.of('native link'), renderer.getEditorExtension()], [renderer.getEditorExtension(), facet.of('native link')]]) {
    assert.deepEqual(EditorState.create({extensions}).facet(facet), ['linked row','native link']);
  }
});
