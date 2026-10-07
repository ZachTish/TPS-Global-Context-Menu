import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {build} from 'esbuild';
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
function method(path,name){
 const source=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true);let result;
 function visit(node){if(ts.isMethodDeclaration(node)&&node.name.getText(source)===name)result=node.getText(source);ts.forEachChild(node,visit);}visit(source);assert.ok(result,name);return result;
}
function loadMethods(source){
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const exports={};new Function('exports',output)(exports);return exports;
}
const {Manual,Activation,Settings}=loadMethods(`
const RETIRED_HOME_SETTING_KEYS=[];
export class Manual { ${method('src/menu/panel-action-service.ts','setViewModeForFile')} }
export class Activation { ${method('src/main.ts','syncTimeTrackingActivation')} }
export class Settings { ${method('src/main.ts','stripLegacySettingsFields')} }
`);

test('automatic mode owner, public methods, command, per-note enforcement and stale-mount replay are absent',()=>{
 assert.equal(existsSync(new URL('../src/handlers/view-mode-manager.ts',import.meta.url)),false);
 const visit=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?visit(new URL(`${entry.name}/`,dir)):entry.name.endsWith('.ts')?[readFileSync(new URL(entry.name,dir),'utf8')]:[]);
 const runtime=visit(new URL('../src/',import.meta.url)).join('\n');
 assert.doesNotMatch(runtime,/viewModeManager|ViewModeManager|force-view-mode-check|handlePotentialFrontmatterChange|shouldSkipViewModeSwitch|suppressViewModeSwitchForPathUntilFocusChange|repairStaleLivePreviewMount|shouldRepairStaleLivePreviewSnapshot/);
 assert.doesNotMatch(read('src/services/view-mode-service.ts'),/resolveTargetMode|normalizeMode|matchesMode|applyModeToState|setViewState/);
});

test('automatic controls/defaults/settings types/migration references/styles are removed; manual controls remain reachable',()=>{
 for(const path of ['src/types.ts','src/constants.ts','src/settings-tab.ts','src/utils/property-migration.ts'])assert.doesNotMatch(read(path),/enableViewModeSwitching|viewModeFrontmatterKey|viewModeIgnoredFolders|viewModeRules/,path);
 const settings=read('src/settings-tab.ts');
 assert.doesNotMatch(settings,/id: 'view-mode'|Enable automatic view mode switching|tps-gcm-viewmode-/);
 assert.match(settings,/activeSettingsPage === 'menus-surfaces'[\s\S]*Show manual view mode controls[\s\S]*enableInlineManualViewMode/);
 assert.doesNotMatch(read('styles.css'),/tps-gcm-viewmode-/);
 for(const title of ['Reading View','Live Preview','Source Mode'])assert.ok(read('src/menu/panel-action-service.ts').includes(title));
});

test('loading/saving retired settings cannot reenable automation or alter unrelated note/settings data',()=>{
 const s=new Settings();
 const record={enableViewModeSwitching:true,viewModeFrontmatterKey:'customMode',viewModeIgnoredFolders:'Private',viewModeRules:[{mode:'reading'}],enableInlineManualViewMode:false,enableTimeTracking:false,properties:[{key:'customMode'}],nativeRecordKindPropertyKey:'kind'};
 s.stripLegacySettingsFields(record);
 assert.deepEqual(record,{enableInlineManualViewMode:false,enableTimeTracking:false,properties:[{key:'customMode'}],nativeRecordKindPropertyKey:'kind'});
 assert.match(read('src/main.ts'),/hadAutomaticViewModeSettings[\s\S]*needsSettingsMigration[\s\S]*persistSettingsSnapshot/);
});

test('manual Reading/Live Preview/Source choices still call the core view exactly once with no metadata write',async()=>{
 for(const [mode,expected] of [['reading',{mode:'preview'}],['live',{mode:'source',source:false}],['source',{mode:'source',source:true}]]){
  const file={path:'Inbox/Mode.md'};const calls=[];const before={file:file.path,mode:'source',source:true,scroll:12};
  const view={file,getViewType:()=> 'markdown',getState:()=>({...before}),async setState(state,options){calls.push({state,options});}};
  const leaf={view};const service=new Manual();
  service.app={workspace:{getLeavesOfType:()=>[leaf],activeLeaf:leaf,getLeaf:()=>assert.fail('manual mode should reuse the open leaf')}};
  service.plugin={openFileInLeaf:()=>assert.fail('an already open note must not be reopened'),frontmatterMutationService:{process:()=>assert.fail('manual mode must not write note properties')}};
  await service.setViewModeForFile(file,mode);
  const state={...before,...expected};if(mode==='reading')delete state.source;
  assert.deepEqual(calls,[{state,options:{history:true}}]);
  assert.equal(view.file,file);assert.deepEqual(before,{file:file.path,mode:'source',source:true,scroll:12});
 }
});

test('startup readiness and settings saves share one activation owner; settings unchanged do not repeat startup setup',()=>{
 const p=new Activation();const counts={service:0,status:0,refresh:0};let mounted=false;
 p.timeTrackingService={setup(){counts.service++;}};
 p.timeTrackingStatusBarService={setup(){counts.status++;if(mounted)return false;mounted=true;return true;},refresh(){counts.refresh++;}};
 p.syncTimeTrackingActivation();assert.deepEqual(counts,{service:0,status:0,refresh:0});
 p.api={version:1};p.syncTimeTrackingActivation();assert.deepEqual(counts,{service:1,status:1,refresh:0});
 p.syncTimeTrackingActivation();assert.deepEqual(counts,{service:2,status:2,refresh:1});
 assert.match(read('src/main.ts'),/saveSettings\(\)[\s\S]*this\.syncTimeTrackingActivation\(\)/);
 assert.match(read('src/main.ts'),/onunload\(\)[\s\S]*timeTrackingStatusBarService\?\.detach\(\)[\s\S]*timeTrackingService\?\.detach\(\)/);
});

test('retiring mode enforcement preserves shared custom-field and ignore condition evaluation',async()=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/services/view-mode-service.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
 const {ViewModeService}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
 const service=new ViewModeService();
 assert.equal(service.evaluateConditions('all',[{type:'frontmatter',key:'STATUS',operator:'equals',value:'todo'},{type:'path',operator:'starts-with',value:'Inbox'}],{status:'todo',path:'Inbox/Task.md'}),true);
 assert.equal(service.evaluateConditions('any',[{type:'frontmatter',key:'status',operator:'equals',value:'done'},{type:'path',operator:'contains',value:'Elsewhere'}],{status:'todo',path:'Inbox/Task.md'}),false);
 assert.deepEqual(service.getRuleConditions({key:'status',value:'todo'}),[{type:'frontmatter',key:'status',operator:'equals',value:'todo'}]);
});
