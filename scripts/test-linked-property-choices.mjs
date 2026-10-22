import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const result = await build({entryPoints:['src/utils/linked-property-options.ts'],bundle:true,format:'esm',write:false});
const m = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
function fixture() {
 const file={path:'Inbox/log.md'}, food={path:'Foods/Tea.md',basename:'Tea'};
 const target={food:'[[Tea|My tea]]',unit:'cup'}, source={sizes:['cup','ml'],other:10}; let calls=0, reads=0;
 const provider={label:'Sizes',sourceProperties:['sizes'],getChoices(fm){ calls++; return fm.sizes.map(value=>({value,label:value+' · label'})); }};
 const caches=new Map([[file,{frontmatter:target}],[food,{frontmatter:source}]]);
 const app={metadataCache:{getFileCache:f=>{reads++;return caches.get(f)},getFirstLinkpathDest:(path,from)=>{assert.equal(from,file.path);return path=== 'Tea'||path===food.path?food:null}},vault:{getMarkdownFiles(){throw Error('scan')},read(){throw Error('body read')},cachedRead(){throw Error('body read')}},plugins:{plugins:{test:{api:{linkedPropertyChoices:{version:1,providers:{sizes:provider}}}}}}};
 const property={key:'unit',type:'selector',optionSources:['linked'],linkedOptions:{linkProperty:'food',provider:'test:sizes'}};
 return {app,file,food,target,source,property,caches,counts:()=>({calls,reads})};
}
test('linked source uses indexed direct reads, labels and values are distinct',()=>{
 const f=fixture();assert.deepEqual(m.readLinkedChoices(f.app,f.property,f.file).choices,[{value:'cup',label:'cup · label'},{value:'ml',label:'ml · label'}]);assert.deepEqual(f.counts(),{calls:1,reads:2});
});
test('display fingerprint rejects unrelated body/metadata events before computing options',()=>{
 const f=fixture();const before=m.linkedChoiceInput(f.app,f.property,f.file).fingerprint;
 for(let i=0;i<1000;i++){f.source.other=i;assert.equal(m.linkedChoiceInput(f.app,f.property,f.file).fingerprint,before)}
 assert.equal(f.counts().calls,0); f.source.sizes=['g'];assert.notEqual(m.linkedChoiceInput(f.app,f.property,f.file).fingerprint,before);
});
test('renames, moves, current unit and food-link changes invalidate only this source',()=>{
 const f=fixture();const before=m.readLinkedChoices(f.app,f.property,f.file);f.food.path='Moved/Tea renamed.md';
 assert.notEqual(m.readLinkedChoices(f.app,f.property,f.file).fingerprint,before.fingerprint);
 f.target.food='[[Missing]]';assert.match(m.readLinkedChoices(f.app,f.property,f.file).message,/not be found/);
 f.target.food='[[Tea]]';f.target.unit='oz';assert.notEqual(m.readLinkedChoices(f.app,f.property,f.file).fingerprint,before.fingerprint);
});
test('one-element links, ambiguous links, block links, missing metadata and providers fail visibly',()=>{
 const f=fixture();f.target.food=['[[Tea]]'];assert.equal(m.readLinkedChoices(f.app,f.property,f.file).choices.length,2);
 f.target.food=['[[Tea]]','[[Other]]'];assert.match(m.readLinkedChoices(f.app,f.property,f.file).message,/Choose one/);
 f.target.food='[[Tea#Block]]';assert.match(m.readLinkedChoices(f.app,f.property,f.file).message,/whole note/);
 f.target.food='[[Tea]]';f.caches.delete(f.food);assert.match(m.readLinkedChoices(f.app,f.property,f.file).message,/Waiting/);
 f.caches.set(f.food,{frontmatter:f.source});f.app.plugins.plugins={};assert.match(m.readLinkedChoices(f.app,f.property,f.file).message,/Enable or update/);
});
test('generic list-property source is reusable without Health and no full entity index',()=>{
 const f=fixture();f.property.linkedOptions={linkProperty:'food',sourceProperty:'sizes'};f.source.sizes=['Small','Medium','Small',''];
 assert.deepEqual(m.readLinkedChoices(f.app,f.property,f.file).choices,[{value:'Small',label:'Small'},{value:'Medium',label:'Medium'}]);assert.equal(f.counts().calls,0);
});
test('fresh source/frontmatter override catches outdated metadata at save',()=>{
 const f=fixture();const before=m.readLinkedChoices(f.app,f.property,f.file);
 const fresh=m.readLinkedChoices(f.app,f.property,f.file,{...f.target,unit:'oz'},{sizes:['g']});assert.notEqual(fresh.fingerprint,before.fingerprint);assert.equal(fresh.choices[0].value,'g');
});
test('linked fields are routed through the existing selector on whole-note surfaces',()=>{
 for(const path of ['src/menu/panel-builder.ts','src/menu/badge-renderer.ts','src/services/property-row-service.ts']) assert.match(readFileSync(path,'utf8'),/if \(usesLinkedOptions\(prop\)\) \{ openLinkedPropertyEditor/);
 const modal=readFileSync('src/modals/PropertyValueSuggestModal.ts','utf8');assert.match(modal,/linkedRefs.forEach\(\(\{offref, ref\}\) => offref\(ref\)\)/);
 const settings=readFileSync('src/settings-tab.ts','utf8');assert.match(settings,/Choices from linked note/);assert.match(settings,/if \(!config.provider\)/);
});

const edits = await build({entryPoints:['src/services/linked-property-edit.ts'],bundle:true,format:'esm',write:false,plugins:[{name:'obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({loader:'js',resolveDir:process.cwd(),contents:'export { parse as parseYaml } from "yaml"; export class Notice { constructor(message) { globalThis.notices?.push(message); } }'}));}}]});
const {setLinkedPropertyChoice} = await import(`data:text/javascript;base64,${Buffer.from(edits.outputFiles[0].text).toString('base64')}`);
function editFixture() {
 const f=fixture();f.food.stat={mtime:1,size:30};f.file.extension='md';f.app.workspace={getLeavesOfType:()=>[]};f.app.vault.getAbstractFileByPath=path=>path===f.food.path?f.food:f.file;
 f.app.vault.read=async()=> '---\nsizes: [cup, ml]\n---\nbody';
 let mutations=0, queues=0, guardHook=()=>{};
 const plugin={app:f.app,bulkEditService:{async applyToFiles(files,callback,options){queues++;const draft={...f.target};await callback(draft,f.file);guardHook();if(!options.writeGuard(f.file))return 0;if(JSON.stringify(draft)!==JSON.stringify(f.target)){mutations++;Object.assign(f.target,draft);return 1}return 0;}}};
 return {...f,plugin,counts:()=>({queues,mutations}),hook:cb=>guardHook=cb};
}
test('explicit unit commit preserves unrelated properties and shares current-source validation',async()=>{
 const f=editFixture();f.target.extra='keep';const snapshot=m.readLinkedChoices(f.app,f.property,f.file);
 assert.equal(await setLinkedPropertyChoice(f.plugin,f.property,[f.file],'ml',[snapshot]),1);assert.equal(f.target.unit,'ml');assert.equal(f.target.extra,'keep');
 const same=m.readLinkedChoices(f.app,f.property,f.file);assert.equal(await setLinkedPropertyChoice(f.plugin,f.property,[f.file],'ml',[same]),0);assert.equal(f.counts().queues,1);
});
test('food/source changes and concurrent unit edits cannot apply a stale selection',async()=>{
 for(const change of ['source','link','unit','late']){
  const f=editFixture();const snapshot=m.readLinkedChoices(f.app,f.property,f.file);
  if(change==='source')f.app.vault.read=async()=> '---\nsizes: [g]\n---\nbody';
  if(change==='link')f.target.food='[[Missing]]';
  if(change==='unit')f.target.unit='oz';
  if(change==='late')f.hook(()=>{f.food.stat.mtime++});
  assert.equal(await setLinkedPropertyChoice(f.plugin,f.property,[f.file],'ml',[snapshot]),0,change);assert.equal(f.counts().mutations,0,change);
 }
});
test('source editor content takes precedence; source rename/delete while pending is rejected',async()=>{
 const f=editFixture();const snapshot=m.readLinkedChoices(f.app,f.property,f.file);
 f.app.workspace.getLeavesOfType=()=>[{view:{file:f.food,getMode:()=> 'source',editor:{getValue:()=> '---\nsizes: [g]\n---\nbody'}}}];
 assert.equal(await setLinkedPropertyChoice(f.plugin,f.property,[f.file],'ml',[snapshot]),0);
 f.app.workspace.getLeavesOfType=()=>[];f.hook(()=>{f.app.vault.getAbstractFileByPath=()=>null});
 assert.equal(await setLinkedPropertyChoice(f.plugin,f.property,[f.file],'ml',[snapshot]),0);
});
const modalBuild=await build({entryPoints:['src/modals/PropertyValueSuggestModal.ts'],bundle:true,format:'esm',write:false,plugins:[{name:'obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({loader:'js',contents:`class Dummy {constructor(app){this.app=app;this.inputEl={dispatchEvent(){globalThis.choiceRenders++}}}setPlaceholder(){}onOpen(){}onClose(){}open(){this.onOpen()}close(){this.onClose()}} module.exports=new Proxy({App:Dummy,FuzzySuggestModal:Dummy,Modal:Dummy,Notice:Dummy},{get:(t,k)=>t[k]||Dummy});`}));}}]});
const {PropertyValueSuggestModal} = await import(`data:text/javascript;base64,${Buffer.from(modalBuild.outputFiles[0].text).toString('base64')}`);
function emitter(object){const refs=[];object.on=(event,callback)=>{const ref={event,callback};refs.push(ref);return ref};object.offref=ref=>refs.splice(refs.indexOf(ref),1);object.emit=(event,...args)=>refs.filter(r=>r.event===event).forEach(r=>r.callback(...args));object.refs=refs;}
test('existing selector opens with one calculation, filters without recomputing, refreshes only relevant changes, and disposes',()=>{
 const f=fixture();emitter(f.app.vault);emitter(f.app.metadataCache);globalThis.choiceRenders=0;
 const modal=new PropertyValueSuggestModal(f.app,null,f.property,'cup',()=>{},[f.file]);modal.open();assert.equal(f.counts().calls,1);
 let renders=globalThis.choiceRenders;
 for(let i=0;i<500;i++){f.app.metadataCache.emit('changed',{path:'Daily.md'});modal.getItems();f.source.other=i;f.app.metadataCache.emit('changed',f.food)}
 assert.equal(f.counts().calls,1);assert.equal(globalThis.choiceRenders,renders);
 f.source.sizes=['g'];f.app.metadataCache.emit('changed',f.food);assert.equal(f.counts().calls,2);assert.ok(modal.getItems().some(item=>item.value==='g'));assert.ok(modal.getItems().some(item=>item.kind==='info'));
 modal.close();assert.equal(f.app.metadataCache.refs.length+f.app.vault.refs.length,0);
});

test('native Base file menus route linked selectors through the same guarded picker', () => {
 const source=readFileSync('src/menu/menu-builder.ts','utf8');
 const method=source.slice(source.indexOf('  addSelectorToMenu('),source.indexOf('  addEntityReferenceToMenu('));
 assert.match(method,/usesLinkedOptions\(prop\)/);
 assert.match(method,/openLinkedPropertyEditor\(this.plugin, prop, this.getPropertyFiles\(entries\)\)/);
 assert.ok(method.indexOf('openLinkedPropertyEditor') < method.indexOf('setSubmenu'));
});
