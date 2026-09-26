import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const bundle = await build({ stdin: { contents: `export * from './src/utils/property-migration'; export * from './src/services/property-migration-service'; export * from './src/modals/property-migration-modal'; export {TFile} from 'obsidian';`, resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'browser', write: false, plugins: [{name:'obsidian-test', setup(b){ b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'test'})); b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export class TFile { constructor(path){this.path=path;this.extension='md';} } export class Notice {} export class Modal {} export class Setting {}` })); }}] });
const { migrateNoteProperties: migrate, updateMigrationReferences: references, PropertyMigrationService, PropertyMigrationModal, TFile } = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const key = {kind:'key',from:'status',to:'taskStatus'};
const value = {kind:'value',key:'status',from:'todo',to:'ready'};
const fm = text => `---\n${text}\n---\nBody status: todo [status:: todo]\n`;
test('key rename preserves comments, CRLF, BOM, nested values and the complete body',()=>{
 const source='\uFEFF---\r\n# retained\r\nSTATUS: [todo, done] # kept\r\nother: |\r\n  untouched\r\n---\r\nBody\r\n';
 assert.equal(migrate(source,key),source.replace('STATUS:', '"taskStatus":'));
});
test('quoted keys, punctuation and case-only renames retain exact identity',()=>{
 assert.equal(migrate(fm("'status': todo"),{...key,to:'Status'}),fm('"Status": todo'));
 assert.equal(migrate(fm('status_code: todo'),key),fm('status_code: todo'));
 assert.equal(migrate(fm('status: todo'),{...key,to:'task: status'}),fm('"task: status": todo'));
});
test('literal value rename changes scalar and flat list strings only',()=>{
 assert.equal(migrate(fm('status: todo # comment\nother: todo'),value),fm('status: "ready" # comment\nother: todo'));
 assert.equal(migrate(fm('status: [todo, "todo", done, todo-later, {note: todo}]'),value),fm('status: ["ready", "ready", done, todo-later, {note: todo}]'));
 assert.equal(migrate(fm('status: true'),{...value,from:'true',to:'false'}),fm('status: true'));
});
test('numeric-looking new values stay strings and Markdown examples remain unchanged',()=>{
 assert.equal(migrate(fm('status: todo'),{...value,to:'123'}),fm('status: "123"'));
 assert.equal(migrate('```yaml\nstatus: todo\n```',key),'```yaml\nstatus: todo\n```');
});
for (const text of ['status: todo\ntaskStatus: done','status: todo\nSTATUS: done','status: [todo','status: todo\n<<: *defaults']) test(`conflict blocks without silently overwriting: ${text}`,()=>assert.throws(()=>migrate(fm(text),key)));
test('aliases and anchors block value rewrites but key renames preserve anchored values',()=>{
 assert.throws(()=>migrate(fm('status: &state todo\nother: *state'),value));
 assert.throws(()=>migrate(fm('other: &state todo\nstatus: *state'),value));
 assert.equal(migrate(fm('status: &state todo\nother: *state'),key),fm('"taskStatus": &state todo\nother: *state'));
});
test('unrelated malformed frontmatter is not a global migration blocker',()=>assert.equal(migrate(fm('other: [oops'),key),fm('other: [oops')));
test('missing close delimiter and multiline owned values are reported',()=>{
 assert.throws(()=>migrate('---\nstatus: todo\nBody',key));
 assert.throws(()=>migrate(fm('status: |\n  todo'),{...value,from:'todo\n'}));
});
test('references follow key renames without rewriting arbitrary labels or filter substrings',()=>{
 const settings={properties:[{id:'status',key:'status',label:'status',scopeProperties:[{key:'status',value:'todo'}]}],viewModeRules:[{conditions:[{type:'frontmatter',key:'status',value:'todo'}]}],parentChildIgnoreFrontmatterKey:'status',notebookNavigatorRules:{rules:[{conditions:[{source:'frontmatter',field:'status',operator:'is',value:'todo'},{source:'body',field:'status',operator:'contains',value:'status'}]}]}};
 references(settings,key); assert.equal(settings.properties[0].key,'taskStatus');assert.equal(settings.properties[0].label,'status');assert.equal(settings.properties[0].scopeProperties[0].key,'taskStatus');assert.equal(settings.viewModeRules[0].conditions[0].key,'taskStatus');assert.equal(settings.notebookNavigatorRules.rules[0].conditions[0].field,'taskStatus');assert.equal(settings.notebookNavigatorRules.rules[0].conditions[1].field,'status');
});
test('status value rename keeps options, classifications, checkbox targets and exact rules aligned',()=>{
 const settings={properties:[{id:'status',key:'status',options:['todo','done'],hideWhenProperties:[{key:'status',operator:'contains',value:'todo'}]}],activeStatusValues:['todo'],linkedSubitemCheckboxMappings:[{statuses:['todo'],toggleTargetStatus:'todo'}],parentChildIgnoreFrontmatterKey:'status',parentChildIgnoreFrontmatterValue:'todo'};
 references(settings,value); assert.deepEqual(settings.properties[0].options,['ready','done']);assert.equal(settings.properties[0].hideWhenProperties[0].value,'todo');assert.deepEqual(settings.activeStatusValues,['ready']);assert.deepEqual(settings.linkedSubitemCheckboxMappings[0],{statuses:['ready'],toggleTargetStatus:'ready'});assert.equal(settings.parentChildIgnoreFrontmatterValue,'ready');
});
function harness(entries={'Inbox/a.md':fm('status: todo')}) {
 const files=new Map(Object.keys(entries).map(path=>[path,new TFile(path)]));const data=new Map(Object.entries(entries));const storage=new Map();let saves=0;const writes=[];
 const plugin={manifest:{id:'tps-global-context-menu',dir:'.obsidian/plugins/tps-global-context-menu'},settings:{properties:[{id:'status',key:'status',options:['todo']}],unrelated:'keep'},app:{vault:{getMarkdownFiles:()=>[...files.values()],getAbstractFileByPath:path=>files.get(path),read:async file=>data.get(file.path),adapter:{exists:async path=>storage.has(path),write:async(path,text)=>storage.set(path,text),read:async path=>storage.get(path),remove:async path=>storage.delete(path)}}},frontmatterMutationService:{applyMigrationSource:async(file,before,after)=>{const current=data.get(file.path);if(current===after)return;if(current!==before)throw Error('stale');writes.push(file.path);data.set(file.path,after);}},saveSettings:async()=>{saves++;},eventService:{emitFilesUpdated(){}},notebookNavigatorRuleService:{invalidateNotebookNavigatorPresentation(){}}};
 const service=new PropertyMigrationService(plugin);plugin.propertyMigrationService=service;
 return {plugin,service,data,storage,writes,files,get saves(){return saves;}};
}
const configure=settings=>{settings.properties[0].key='taskStatus';};
test('cancel leaves notes, configuration and recovery storage untouched',async()=>{
 const h=harness();PropertyMigrationModal.confirm=async()=>false;assert.equal(await h.service.request(key,configure),false);assert.equal(h.saves,0);assert.equal(h.writes.length,0);assert.equal(h.storage.size,0);assert.equal(h.plugin.settings.properties[0].key,'status');
});
test('confirmed migration persists a recovery copy before writes, saves last and removes recovery',async()=>{
 const h=harness({'Inbox/a.md':fm('status: todo'),'_archive/b.md':fm('STATUS: done')});PropertyMigrationModal.confirm=async()=>true;
 const write=h.plugin.frontmatterMutationService.applyMigrationSource;h.plugin.frontmatterMutationService.applyMigrationSource=async(...args)=>{assert.equal(h.storage.size,1);assert.equal(h.saves,0);return write(...args);};
 assert.equal(await h.service.request(key,configure),true);assert.equal(h.writes.length,2);assert.equal(h.saves,1);assert.equal(h.storage.size,0);assert.equal(h.plugin.settings.properties[0].key,'taskStatus');assert.equal(h.service.active,false);
});
test('edited and newly matching notes during preview require fresh confirmation',async()=>{
 for (const add of [false,true]) {const h=harness();PropertyMigrationModal.confirm=async()=>{if(add){h.files.set('new.md',new TFile('new.md'));h.data.set('new.md',fm('status: todo'));}else h.data.set('Inbox/a.md',fm('status: changed'));return true;};await assert.rejects(h.service.request(key,configure),/Notes changed/);assert.equal(h.writes.length,0);assert.equal(h.storage.size,0);}
});
test('settings changes during preview are preserved and prevent migration',async()=>{
 const h=harness();PropertyMigrationModal.confirm=async()=>{h.plugin.settings.unrelated='new';return true;};await assert.rejects(h.service.request(key,configure),/Settings changed/);assert.equal(h.plugin.settings.unrelated,'new');assert.equal(h.writes.length,0);
});
test('partial write failure restores earlier notes and does not commit the new configuration',async()=>{
 const h=harness({'a.md':fm('status: todo'),'b.md':fm('status: done')});PropertyMigrationModal.confirm=async()=>true;const write=h.plugin.frontmatterMutationService.applyMigrationSource;let fail=true;h.plugin.frontmatterMutationService.applyMigrationSource=async(...args)=>{if(args[0].path==='b.md'&&fail){fail=false;throw Error('disk failure');}return write(...args);};
 await assert.rejects(h.service.request(key,configure),/disk failure/);assert.equal(h.data.get('a.md'),fm('status: todo'));assert.equal(h.storage.size,0);assert.equal(h.plugin.settings.properties[0].key,'status');
});
test('settings-save failure rolls back notes and settings',async()=>{
 const h=harness();PropertyMigrationModal.confirm=async()=>true;let count=0;h.plugin.saveSettings=async()=>{if(++count===1)throw Error('settings failure');};await assert.rejects(h.service.request(key,configure),/settings failure/);assert.equal(h.data.get('Inbox/a.md'),fm('status: todo'));assert.equal(h.plugin.settings.properties[0].key,'status');assert.equal(h.storage.size,0);
});
test('concurrent note edit is preserved and recovery survives a restart',async()=>{
 const h=harness();PropertyMigrationModal.confirm=async()=>true;h.plugin.saveSettings=async()=>{h.data.set('Inbox/a.md',fm('taskStatus: edited'));throw Error('save failed');};await assert.rejects(h.service.request(key,configure),/save failed/);assert.equal(h.storage.size,1);assert.equal(h.data.get('Inbox/a.md'),fm('taskStatus: edited'));const restarted=new PropertyMigrationService(h.plugin);await restarted.initialize();assert.equal(restarted.hasRecovery(),true);await assert.rejects(restarted.request(key,configure),/previous property migration/);
 h.plugin.saveSettings=async()=>{};h.data.set('Inbox/a.md',fm('"taskStatus": todo'));await restarted.recover();assert.equal(h.data.get('Inbox/a.md'),fm('status: todo'));assert.equal(h.storage.size,0);
});
test('all owning key controls use explicit migration actions and options are drafts',()=>{
 const source=readFileSync('src/settings-tab.ts','utf8');
 for(const key of ['dateCreatedFrontmatterKey','dateModifiedFrontmatterKey','viewModeFrontmatterKey','timeTrackingPropertyKey','taskVisibilityStateFrontmatterKey','parentLinkFrontmatterKey']) assert.match(source,new RegExp(`renderMigratingKeySetting\\([^\\n]+ '${key}'\\)`));
 assert.match(source,/Rename stored value/);assert.match(source,/draftOptions = value/);assert.match(source,/configureManagedNoteField\(settings, field, next\)/);assert.match(source,/this\.migrateProperty\(\{ kind: 'key', from: prop.key/);
});
test('unload cancels a scan promptly even when a vault read has not resolved',async()=>{
 const h=harness();h.plugin.app.vault.read=()=>new Promise(()=>{});const pending=h.service.request(key,configure);h.service.dispose();await assert.rejects(pending,/cancelled/);assert.equal(h.writes.length,0);assert.equal(h.service.busy,false);
});
test('failed recovery creation prevents all mutations without leaving a nonexistent recovery pending',async()=>{
 const h=harness();PropertyMigrationModal.confirm=async()=>true;h.plugin.app.vault.adapter.write=async()=>{throw Error('disk full');};await assert.rejects(h.service.request(key,configure),/disk full/);assert.equal(h.writes.length,0);assert.equal(h.service.hasRecovery(),false);assert.equal(h.plugin.settings.properties[0].key,'status');
});

test('inherited properties cannot be silently skipped by a key migration',()=>{
 assert.throws(()=>migrate(fm('defaults: &defaults {status: todo}\n<<: *defaults'),key),/merge keys/);
});

test('unrelated merged frontmatter is outside the migration scope',()=>{
 const source=fm('defaults: &defaults {unrelated: value}\n<<: *defaults');assert.equal(migrate(source,key),source);
});

test('custom keys sharing integration or default timestamp ownership move those mappings too',()=>{
 const integration={properties:[{id:'external',key:'externalId'}]};references(integration,{kind:'key',from:'externalId',to:'calendarIdentity'});assert.equal(integration.managedNoteFieldKeys.externalId,'calendarIdentity');assert.deepEqual(integration.managedNoteFieldAliases.externalId,[]);
 const timestamp={properties:[{id:'created',key:'datecreated'}]};references(timestamp,{kind:'key',from:'datecreated',to:'createdAt'});assert.equal(timestamp.dateCreatedFrontmatterKey,'createdAt');
});

test('a Calendar mapping confirmation updates matching Controller mappings, with settings saved after notes', async () => {
 const h=harness();
 const calendar={settings:{statusKey:'status',titleKey:'title'},saveSettings:async()=>{assert.match(h.data.get('Inbox/a.md'),/taskStatus/);}};
 const controller={settings:{statusKey:'status',startProperty:'scheduled'},saveSettings:async()=>{}};
 h.plugin.app.plugins={plugins:{'tps-calendar-base':calendar,'tps-controller':controller}};
 PropertyMigrationModal.confirm=async()=>true;
 assert.equal(await h.service.requestPluginKey('tps-calendar-base','statusKey','taskStatus'),true);
 assert.equal(calendar.settings.statusKey,'taskStatus');assert.equal(controller.settings.statusKey,'taskStatus');
 assert.equal(h.plugin.settings.properties[0].key,'taskStatus');assert.equal(h.storage.size,0);
});
test('cross-plugin cancellation and concurrent edits never change notes or other owners', async () => {
 for(const cancel of [true,false]) {
  const h=harness();const calendar={settings:{statusKey:'status'},saveSettings:async()=>{}};
  h.plugin.app.plugins={plugins:{'tps-calendar-base':calendar}};
  PropertyMigrationModal.confirm=async()=>{if(!cancel)calendar.settings.statusKey='concurrent';return !cancel;};
  if(cancel)assert.equal(await h.service.requestPluginKey('tps-calendar-base','statusKey','taskStatus'),false);
  else await assert.rejects(h.service.requestPluginKey('tps-calendar-base','statusKey','taskStatus'),/settings changed/);
  assert.equal(h.writes.length,0);
 }
});
test('consumer save failures restore note data and all participating mappings', async () => {
 const h=harness();let saves=0;
 const calendar={settings:{statusKey:'status'},saveSettings:async()=>{if(++saves===1)throw Error('consumer disk error');}};
 h.plugin.app.plugins={plugins:{'tps-calendar-base':calendar}};PropertyMigrationModal.confirm=async()=>true;
 await assert.rejects(h.service.requestPluginKey('tps-calendar-base','statusKey','taskStatus'),/consumer disk error/);
 assert.equal(calendar.settings.statusKey,'status');assert.equal(h.plugin.settings.properties[0].key,'status');assert.equal(h.data.get('Inbox/a.md'),fm('status: todo'));assert.equal(h.storage.size,0);
});
test('previous integration keys are migrated only in a confirmed change and removed from configuration', async () => {
 const h=harness({'a.md':fm('oldExternal: provider')});
 h.plugin.settings.managedNoteFieldKeys={externalId:'providerId'};h.plugin.settings.managedNoteFieldAliases={externalId:['oldExternal']};
 PropertyMigrationModal.confirm=async()=>true;
 await h.service.request({kind:'key',from:'providerId',to:'eventIdentity'},()=>{});
 assert.match(h.data.get('a.md'),/"eventIdentity": provider/);assert.doesNotMatch(h.data.get('a.md'),/oldExternal/);assert.deepEqual(h.plugin.settings.managedNoteFieldAliases.externalId,[]);
});


test('shared mappings wait for an active Health workout before writing any notes', async () => {
 const h=harness();
 h.plugin.app.plugins={plugins:{'tps-calendar-base':{settings:{statusKey:'status'},saveSettings:async()=>{}},'tps-health':{settings:{activeWorkoutId:'session-1'}}}};
 PropertyMigrationModal.confirm=async()=>true;
 await assert.rejects(h.service.requestPluginKey('tps-calendar-base','statusKey','taskStatus'),/Finish the active workout/);
 assert.equal(h.writes.length,0);assert.equal(h.storage.size,0);
});


test('shared key changes cannot combine distinct Health nutrient properties even in an empty vault', async () => {
 const h=harness({});
 h.plugin.app.plugins={plugins:{'tps-health':{settings:{nativeRecordProperties:{calories:'calories',proteinG:'proteinG'}},saveSettings:async()=>{}}}};
 await assert.rejects(h.service.request({kind:'key',from:'calories',to:'proteinG'},()=>{}),/another record property/);
 assert.equal(h.writes.length,0);assert.equal(h.storage.size,0);
});


test('Health-only key migration separates records from templates and other TPS notes and can merge them again',async()=>{
 const h=harness({'entry.md':fm('tpsId: food-1\nkind: food-entry'),'template.md':fm('kind: food'),'workout.md':fm('kind: workout-plan'),'task.md':fm('tpsId: task-1\nkind: task')});
 const health={settings:{nativeRecordKinds:{foodEntry:'food-entry',activityEntry:'activity-entry',workoutSession:'workout-session',workoutExercise:'workout-exercise'},nativeRecordProperties:{calories:'calories'}},nativeRecordService:{refreshConfiguration(){}}};
 h.plugin.app.plugins={plugins:{'tps-health':health}};
 h.plugin.nativeRecordService={getStorageProfile:kind=>({kindPropertyKey:h.plugin.settings.nativeRecordKindPropertyKeys?.[kind]||'kind'}),refreshConfiguration(){}};
 PropertyMigrationModal.confirm=async()=>false;assert.equal(await h.service.requestHealthKindKey('entryKind'),false);assert.equal(h.writes.length,0);
 PropertyMigrationModal.confirm=async()=>true;assert.equal(await h.service.requestHealthKindKey('entryKind'),true);
 assert.match(h.data.get('entry.md'),/"entryKind": food-entry/);
 assert.equal(h.data.get('template.md'),fm('kind: food'));assert.equal(h.data.get('workout.md'),fm('kind: workout-plan'));assert.equal(h.data.get('task.md'),fm('tpsId: task-1\nkind: task'));
 assert.equal(h.plugin.settings.nativeRecordKindPropertyKey,undefined);
 assert.equal(await h.service.requestHealthKindKey('kind'),true);assert.match(h.data.get('entry.md'),/"kind": food-entry/);assert.doesNotMatch(h.data.get('entry.md'),/entryKind/);
});


test('Health-scoped migration skips malformed unrelated templates but blocks possibly matching broken records',()=>{
 const change={kind:'key',from:'kind',to:'entryKind',recordKinds:['food-entry']};
 const unrelated=fm('kind: project\n- malformed');assert.equal(migrate(unrelated,change),unrelated);
 assert.throws(()=>migrate(fm('tpsId: one\nkind: food-entry\n- malformed'),change),/malformed/);
});


test('scoped Health migration cannot silently skip merged or aliased record identities',()=>{
 const change={kind:'key',from:'kind',to:'entryKind',recordKinds:['food-entry']};
 assert.throws(()=>migrate(fm('defaults: &defaults {tpsId: one, kind: food-entry}\n<<: *defaults'),change),/merge keys/);
 assert.throws(()=>migrate(fm('type: &type food-entry\ntpsId: one\nkind: *type'),change),/Aliased kind/);
});

test('classification tag renames update GCM mapping, scoped fields and presentation references',()=>{
 const settings={nativeRecordKindPropertyKeys:{food:{tag:'old/path'}},properties:[{scopeTags:['old/path']}],templateIdentificationTag:'old/path',notebookNavigatorRules:{rules:[{conditions:[{source:'tag',operator:'contains',value:'old/path'}]}]}};
 references(settings,{kind:'value',key:'tags',from:'old/path',to:'new'});
 assert.equal(settings.nativeRecordKindPropertyKeys.food.tag,'new');assert.deepEqual(settings.properties[0].scopeTags,['new']);assert.equal(settings.templateIdentificationTag,'new');assert.equal(settings.notebookNavigatorRules.rules[0].conditions[0].value,'new');
 assert.doesNotThrow(()=>references(settings,{kind:'key',from:'unrelated',to:'other'}));
});
