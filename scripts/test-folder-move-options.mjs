import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

function actualMethod(file,name) {
  const source=readFileSync(new URL(file,import.meta.url),'utf8');
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let method;
  function visit(node){if(ts.isMethodDeclaration(node)&&node.name?.getText(ast)===name)method=node.getText(ast);ts.forEachChild(node,visit);}visit(ast);
  assert.ok(method,`Missing ${name}`);return method;
}
class Folder {constructor(path){this.path=path;}}
class File {constructor(path){this.path=path;this.parent={path:path.includes('/')?path.slice(0,path.lastIndexOf('/')):'/'};}}
const code=ts.transpileModule('export class Owner {'+actualMethod('../src/menu/menu-controller.ts','getTypeFolderOptions')+'}',{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const output={};new Function('exports','TFolder','TFile',code)(output,Folder,File);
function harness(paths=[],files=[]){let current=[new Folder('/'),...paths.map(p=>new Folder(p)),...files.map(p=>new File(p))],calls=0;const owner=new output.Owner();owner.app={vault:{getAllLoadedFiles(){calls++;return current;}}};return {owner,options:()=>owner.getTypeFolderOptions(),calls:()=>calls,replace:(paths,files=[])=>{current=[new Folder('/'),...paths.map(p=>new Folder(p)),...files.map(p=>new File(p))];}};}
function counted(run){let comparisons=0;const previous=String.prototype.startsWith;String.prototype.startsWith=function(...args){comparisons++;return previous.apply(this,args);};try{return {value:run(),comparisons};}finally{String.prototype.startsWith=previous;}}

test('folder picker preserves empty leaves, file-bearing parents and nearest ancestor labels',()=>{
 const h=harness(['Projects','Projects/Empty','Projects/Parent','Projects/Parent/Leaf','Empty','Empty/Leaf'],['Projects/note.md','Projects/Parent/readme.pdf','root.md']);
 assert.deepEqual(h.options(),[{path:'Empty/Leaf',label:'Leaf'},{path:'Projects',label:'Projects'},{path:'Projects/Empty',label:'Projects/Empty'},{path:'Projects/Parent',label:'Projects/Parent'},{path:'Projects/Parent/Leaf',label:'Parent/Leaf'}]);assert.equal(h.calls(),1);
});
test('prefix siblings and sparse nested paths cannot change leaf classification',()=>{
 const h=harness(['Art','Artist','Artist/Child','A','A/B/C','Trailing/','Trailing/Deep/']);
 assert.deepEqual(h.options().map(x=>x.path),['A/B/C','Art','Artist/Child','Trailing/Deep']);
});
test('root-only vaults and duplicate normalized paths do not invent destinations',()=>{
 assert.deepEqual(harness([],['root.md']).options(),[]);assert.deepEqual(harness(['One','One/']).options(),[{path:'One',label:'One'}]);
});
test('Unicode labels and locale ordering match the existing path sort',()=>{
 const paths=['Work space','Work space/日本語','Étage','alpha','Alpha'];const h=harness(paths,['Work space/readme.md']);const actual=h.options();assert.deepEqual(actual.map(x=>x.path),paths.slice().sort((a,b)=>a.localeCompare(b)));assert.equal(actual.find(x=>x.path.endsWith('日本語')).label,'Work space/日本語');
});
test('large wide folder trees do not compare every pair of folders',()=>{
 const paths=Array.from({length:1500},(_,i)=>'Folder '+String(i).padStart(4,'0')),h=harness(paths),result=counted(h.options);assert.equal(result.value.length,1500);assert.ok(result.comparisons<paths.length*8,`${result.comparisons} prefix comparisons for ${paths.length} folders`);assert.equal(h.calls(),1);
});
test('unchanged bursts read the current folder inventory once per request without quadratic work',()=>{
 const h=harness(Array.from({length:200},(_,i)=>'Root/Folder '+i));const first=h.options();const measured=counted(()=>Array.from({length:25},()=>h.options()));assert.ok(measured.comparisons<200*25*8,`${measured.comparisons} comparisons`);for(const options of measured.value)assert.deepEqual(options,first);assert.equal(h.calls(),26);
});
test('moves, new folders and changed direct-file membership are reflected on the next call',()=>{
 const h=harness(['Root','Root/A','Root/B'],['Root/note.md']);assert.deepEqual(h.options().map(x=>x.path),['Root','Root/A','Root/B']);h.replace(['Renamed','Renamed/A','New'],['Renamed/A/note.md']);assert.deepEqual(h.options(),[{path:'New',label:'New'},{path:'Renamed/A',label:'A'}]);assert.equal(h.calls(),2);
});
test('folder submenu retains selected path, labels and exact move callback targets',async()=>{
 const menuCode=ts.transpileModule('export class Builder {'+actualMethod('../src/menu/menu-builder.ts','populateFolderMenu')+'}',{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;const out={};new Function('exports',menuCode)(out);const options=harness(['A','A/子','B'],['A/note.md']).options();const moved=[];const b=new out.Builder();b.delegates={getTypeFolderOptions:()=>options,moveFiles:async(entries,path)=>moved.push({entries,path})};const items=[],menu={addItem(fn){const item={setTitle(title){this.title=title;return this},setChecked(checked){this.checked=checked;return this},onClick(fn){this.click=fn;return this}};items.push(item);fn(item)}};const entries=[{file:new File('A/note.md')}];b.populateFolderMenu(menu,entries);assert.deepEqual(items.map(i=>i.title),options.map(o=>o.label));assert.deepEqual(items.map(i=>i.checked),[true,false,false]);await items[1].click();assert.equal(moved[0].entries,entries);assert.equal(moved[0].path,'A/子');
});
