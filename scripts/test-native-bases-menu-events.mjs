import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync('src/events/register-events.ts','utf8');
const ast=ts.createSourceFile('events.ts',source,ts.ScriptTarget.Latest,true);
const callbacks=new Map();
function visit(node){
 if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='on'&&ts.isStringLiteral(node.arguments[0])&&['file-menu','files-menu'].includes(node.arguments[0].text))callbacks.set(node.arguments[0].text,node.arguments[1].getText(ast));
 ts.forEachChild(node,visit);
}
visit(ast);
class File {constructor(path){this.path=path;this.extension='md';}}
function callback(name,plugin){
 const code=ts.transpile(`const handler=${callbacks.get(name)};`,{target:ts.ScriptTarget.ES2022});
 return Function('plugin','TFile',code+';return handler;')(plugin,File);
}
function harness(){
 const calls=[],plugin={settings:{inlineMenuOnly:false},contextTargetService:new Proxy({}, {get(){throw Error('Bases must not consult ambient DOM or selection');}}),menuController:{addToExactFileMenu:(menu,files,options)=>{assert.equal(options.nativeMenu,true);calls.push({menu,files});},addToNativeMenu:()=>{throw Error('Bases must retain its exact target selection');}}};
 return {plugin,calls,single:callback('file-menu',plugin),multi:callback('files-menu',plugin)};
}
test('Core Bases single-card events retain the supplied note despite absent or stale ambient selection',()=>{
 const h=harness(),menu={},file=new File('Inbox/Selected card.md');h.single(menu,file,'bases-context-menu');
 assert.deepEqual(h.calls,[{menu,files:[file]}]);
 h.single(menu,{path:'Inbox'},'bases-context-menu');assert.equal(h.calls.length,1,'folders are not notes');
});
test('native Kanban file-link events retain their supplied note without ambient DOM',()=>{
 const h=harness(),menu={},file=new File('Inbox/Card.md');h.single(menu,file,'link-context-menu');assert.deepEqual(h.calls,[{menu,files:[file]}]);
 h.plugin.settings.inlineMenuOnly=true;h.single(menu,file,'link-context-menu');assert.equal(h.calls.length,1);
});
test('Core Bases selections keep every supplied live file and preserve inline-only execution state',()=>{
 const h=harness(),menu={},a=new File('A.md'),b=new File('B.md');h.multi(menu,[a,{path:'Folder'},b],'bases-context-menu');assert.deepEqual(h.calls,[{menu,files:[a,b]}]);
 h.plugin.settings.inlineMenuOnly=true;h.single(menu,a,'bases-context-menu');h.multi(menu,[a,b],'bases-context-menu');assert.equal(h.calls.length,1);
});
test('repeated Bases menu events require no vault reads, scans, writes or DOM discovery',()=>{
 const h=harness(),file=new File('A.md');h.plugin.app=new Proxy({}, {get(){throw Error('No vault work is needed to route a menu');}});
 for(let i=0;i<1000;i++){h.single({},file,'bases-context-menu');h.multi({},[file],'bases-context-menu');}
 assert.equal(h.calls.length,2000);
});
test('other native menu sources retain the existing managed-target guard and Navigator ownership',()=>{
 const h=harness();let native=0;
 h.plugin.contextTargetService={peekRecentContextTarget:()=>null,isNotebookNavigatorContextTarget:()=>true};h.single({},new File('A.md'),'file-explorer-context-menu');assert.equal(h.calls.length,0);
 h.plugin.contextTargetService={peekRecentContextTarget:()=>null,isNotebookNavigatorContextTarget:()=>false,resolveMarkdownNoteLinkTarget:()=>null,isNativeMenuManagedTarget:()=>false};h.plugin.menuController.addToNativeMenu=()=>native++;
 h.single({},new File('A.md'),'file-explorer-context-menu');assert.equal(native,0);
 h.plugin.contextTargetService.isNativeMenuManagedTarget=()=>true;h.single({},new File('A.md'),'file-explorer-context-menu');assert.equal(native,1);
});
