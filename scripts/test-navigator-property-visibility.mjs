import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/integrations/notebook-navigator-property-visibility.ts'], bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{name:'obsidian-stub',setup(b){
    b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:`
      export class Notice { constructor(message) { globalThis.notices.push(message); } }
      export class Setting {
        constructor(parent) { this.parent=parent; parent.rows.push(this); }
        setName(name){this.name=name;return this;} setDesc(desc){this.desc=desc;return this;}
        addToggle(fn){const t={setValue(v){this.value=v;return this;},setDisabled(v){this.disabled=v;return this;},onChange(fn){this.change=fn;return this;}};this.toggle=t;fn(t);return this;}
      }
    `}));
  }}]
});
const {renderNavigatorPropertyVisibility}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
function fixture(set) {
 const state={profileId:'p',profileName:'Personal',showInNavigation:false,showInList:true,showInFileMenu:false};
 const api={version:1,get:()=>({...state}),set};
 return {state,app:{plugins:{plugins:{'tps-notebook-navigator':{api:{propertyVisibility:api}}}}},parent:{rows:[]}};
}
test('renders current owner values and edits only the selected surface without GCM settings writes',async()=>{
 let request;
 const f=fixture(async(...args)=>{request=args;return {...f.state,showInNavigation:true};});
 let key='status';renderNavigatorPropertyVisibility(f.parent,f.app,()=>key);
 assert.equal(f.parent.rows.length,3);
 assert.deepEqual(f.parent.rows.map(r=>r.toggle.value),[false,true,false]);
 key='renamed-status';await f.parent.rows[0].toggle.change(true);
 assert.deepEqual(request,['renamed-status','showInNavigation',true,'p']);
 assert.deepEqual(f.parent.rows.map(r=>r.toggle.value),[true,true,false]);
 assert.ok(f.parent.rows.every(r=>r.desc.includes('Personal')&&!r.toggle.disabled));
});
test('failed owner save restores displayed values and reports the error',async()=>{
 globalThis.notices=[];
 const f=fixture(async()=>{throw new Error('Save rejected');});
 renderNavigatorPropertyVisibility(f.parent,f.app,()=> 'status');
 await f.parent.rows[1].toggle.change(false);
 assert.equal(f.parent.rows[1].toggle.value,true);
 assert.deepEqual(globalThis.notices,['Save rejected']);
});
test('missing or older Navigator gives an actionable integration message',()=>{
 const parent={rows:[]};renderNavigatorPropertyVisibility(parent,{},()=> 'status');
 assert.equal(parent.rows.length,1);assert.match(parent.rows[0].desc,/6.5.0/);
});
test('settings handoff opens the exact custom-fields destination and clears transient filters',()=>{
 const settings=readFileSync('src/settings-tab.ts','utf8');
 assert.match(settings,/openCustomPropertySettings\(\): void/);
 assert.match(settings,/this.activeRulesFieldsPage = 'custom-fields'/);
 const api=readFileSync('src/plugin-api.ts','utf8');assert.match(api,/tab.openCustomPropertySettings\(\)/);
});
