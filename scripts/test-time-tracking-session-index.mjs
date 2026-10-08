import test from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
const root = fileURLToPath(new URL('..', import.meta.url));
const build = await esbuild.build({
  stdin: { contents: `export { TimeTrackingService } from './src/services/time-tracking-service'; export { TFile } from 'obsidian';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  plugins: [{ name: 'obsidian', setup(b) {
    b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},()=>({loader:'js',resolveDir:root,contents:`
      export { parse as parseYaml } from 'yaml';
      export class MarkdownView {}
      export class Notice {}
      export class TFile { constructor(path) { this.path=path; this.extension='md'; this.stat={mtime:1,size:1}; } }
      export const normalizePath = path => String(path).replace(/\\\\/g, '/');
    `}));
  }}],
});
const module = {exports:{}};
new Function('require','module','exports',build.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {TimeTrackingService,TFile}=module.exports;
const record = id => ({id,targetId:'target',sourcePath:'Target.md',targetType:'note',start:'2026-09-22T12:00:00Z'});
const document = fm => `---\n${stringify(fm)}---\n`;
function harness({enabled=true,initialized=true}={}) {
  const files=[],bodies=new Map(),metadata=new Map(),events=new Map(),layoutCallbacks=[],intervals=new Map(),timeouts=new Map();let handle=0;let reads=0;let readHook=null;
  const on=(event,fn)=>{const list=events.get(event)||[];list.push(fn);events.set(event,list);return {event,fn};};
  const offref=ref=>events.set(ref.event,(events.get(ref.event)||[]).filter(fn=>fn!==ref.fn));
  const timerWindow={setInterval:fn=>{intervals.set(++handle,fn);return handle;},clearInterval:id=>intervals.delete(id),setTimeout:fn=>{timeouts.set(++handle,fn);return handle;},clearTimeout:id=>timeouts.delete(id)};
  const emit=(event,...args)=>{for(const fn of events.get(event)||[])fn(...args);};
  const plugin={settings:{enableTimeTracking:enabled},registerEvent(){},registerInterval(){},getArchiveFolderPath:()=> '_archive',
    filePropertiesService:{isCompanionFile:f=>f.path.endsWith('.companion.md')},
    app:{workspace:{onLayoutReady(fn){layoutCallbacks.push(fn);}},metadataCache:{initialized,on:(event,fn)=>on('metadata:'+event,fn),offref,getFileCache:f=>metadata.get(f)},
      vault:{on,offref,getMarkdownFiles:()=>[...files],async cachedRead(f){reads++;if(readHook)return readHook(f);return bodies.get(f);}}},
    frontmatterMutationService:{async process(f,mutate){const fm=parse(bodies.get(f).split('---')[1]);mutate(fm);bodies.set(f,document(fm));}},
  };
  const service=new TimeTrackingService(plugin);
  const previous=globalThis.window;globalThis.window=timerWindow;service.setup();globalThis.window=previous;
  const add=(path,fm={},raw)=>{const f=new TFile(path);files.push(f);bodies.set(f,raw??document(fm));emit('create',f);return f;};
  const write=(f,fm,event='modify')=>{bodies.set(f,document(fm));emit(event,f);};
  const runStartup=async beforeTimers=>{
    const previous=globalThis.window;
    try {
      globalThis.window=timerWindow;
      for(const fn of layoutCallbacks)fn();
    } finally {globalThis.window=previous;}
    beforeTimers?.();
    const timers=[...timeouts.values()];timeouts.clear();for(const fn of timers)fn();
    if(service.sessionScan)await service.sessionScan;
    await new Promise(resolve=>setImmediate(resolve));
  };
  return {service,plugin,files,bodies,metadata,add,write,emit,runStartup,intervals,timeouts,events,timerWindow,activate(value){plugin.settings.enableTimeTracking=value;const previous=globalThis.window;try{globalThis.window=timerWindow;service.setup();}finally{globalThis.window=previous;}},reads:()=>reads,setReadHook:fn=>{readHook=fn;}};
}

test('native mode refuses task-line timers and task metadata writes', async () => {
  const h = harness();
  h.plugin.settings.enableTimeTracking = true;
  h.plugin.settings.dataArchitectureMode = 'native-records';
  const target = h.add('Task.md', { title: 'Task' }, '- [ ] Legacy task');
  let writes = 0;
  h.plugin.app.vault.process = async () => { writes++; };
  assert.equal(await h.service.startDailyTaskTimer('New inline task'), null);
  assert.equal(await h.service.startTimer({ file: target, type: 'task', lineNumber: 0, rawLine: '- [ ] Legacy task' }), null);
  await h.service.syncTargetScheduledMetadata({ file: target, type: 'task', lineNumber: 0 }, {
    id: 'old', targetId: 'old-task', targetType: 'task', sourcePath: target.path, start: '2026-09-22T12:00:00Z',
  }, { mode: 'running' });
  assert.equal(h.reads(), 0);
  assert.equal(writes, 0);
});

test('disabled startup leaves the timer source index unread, including disable before scheduled work',async()=>{
 for(const initiallyEnabled of [false,true]){
  const h=harness({enabled:initiallyEnabled});
  for(let i=0;i<1000;i++)h.add(`Ordinary ${i}.md`);
  let scans=0;const original=h.plugin.app.vault.getMarkdownFiles;
  h.plugin.app.vault.getMarkdownFiles=()=>{scans++;return original();};
  await h.runStartup(()=>{h.activate(false);});
  assert.equal(h.reads(),0,'disabled time tracking must not read every note after layout');
  assert.equal(scans,0,'disabled startup must not enumerate the vault');
  assert.equal(h.service.sessionSources.size,0);
 }
});

test('enabled startup prepares the timer index once through the existing synchronization owner',async()=>{
 const h=harness({enabled:false});
 for(let i=0;i<1000;i++)h.add(`Ordinary ${i}.md`);
 let refreshes=0;const refresh=h.service.refreshActiveTimerCache.bind(h.service);
 h.service.refreshActiveTimerCache=(...args)=>{refreshes++;return refresh(...args);};
 h.activate(true);
 await h.runStartup();
 assert.equal(h.reads(),1000,'enabling before the delayed callback still discovers stored sessions');
 assert.equal(refreshes,1,'startup synchronization already refreshes timer counts');
 assert.equal(h.service.sessionSources.size,1000);
});

test('enabled startup still restores active note timer counts without modifying the target',async()=>{
 const h=harness();h.plugin.settings.enableTimeTracking=true;
 const target=h.add('Target.md',{tpsId:'target',title:'Target'});
 h.add('Session.md',{timeTracking:[record('active')]});
 h.plugin.app.vault.getAbstractFileByPath=path=>h.files.find(file=>file.path===path)??null;
 const updates=[];h.plugin.eventService={emitFilesUpdated:paths=>updates.push(...paths)};
 const before=h.bodies.get(target);
 await h.runStartup();
 assert.equal(h.service.getActiveTimerCountForFileSync(target),1);
 assert.deepEqual(updates,['Target.md']);
 assert.equal(h.bodies.get(target),before);
 assert.equal(h.reads(),2);
});
test('warm scans share verified empty results, return independent records, and coalesce initial reads',async()=>{
 const h=harness();for(let i=0;i<1000;i++)h.add(`${i}.md`,i===9?{timeTracking:[record('one')]}:{});
 let companionChecks=0;h.plugin.filePropertiesService.isCompanionFile=()=>{companionChecks++;return false;};
 const [a,b]=await Promise.all([h.service.scanStoredSessions(),h.service.scanStoredSessions()]);assert.equal(h.reads(),1000);assert.equal(a.length,1);
 a[0].record.id='caller edit';a.sort(()=>0);assert.equal(b[0].record.id,'one');
 for(let i=0;i<3;i++)assert.equal((await h.service.scanStoredSessions())[0].record.id,'one');assert.equal(h.reads(),1000);assert.equal(companionChecks,4,'only actual timer candidates need companion classification');
});
test('same-stat edits, late stale metadata, source removal and own writes invalidate only affected notes',async()=>{
 const h=harness();const f=h.add('One.md');h.add('Other.md');await h.service.scanStoredSessions();
 h.metadata.set(f,{frontmatter:{timeTracking:[record('stale')]}});h.write(f,{timeTracking:[record('new')]});
 assert.equal((await h.service.scanStoredSessions())[0].record.id,'new');assert.equal(h.reads(),3);
 h.emit('metadata:changed',f);assert.equal((await h.service.scanStoredSessions())[0].record.id,'new');assert.equal(h.reads(),3,'late stale metadata must not invalidate a current source result');
 h.write(f,{});assert.deepEqual(await h.service.scanStoredSessions(),[]);
 await h.service.appendFrontmatterSession(f,record('own'));assert.equal((await h.service.scanStoredSessions())[0].record.id,'own');
 await h.service.replaceFrontmatterSession(f,'own',{...record('own'),end:'2026-09-22T13:00:00Z'});assert.ok((await h.service.scanStoredSessions())[0].record.end);
 await h.service.removeFrontmatterSession(f,'own');assert.deepEqual(await h.service.scanStoredSessions(),[]);
});
test('imports, rename/archive filters, deletion and same-path replacement remain visible',async()=>{
 const h=harness();const f=h.add('One.md',{timeTracking:[record('one')]});await h.service.scanStoredSessions();
 f.path='_archive/One.md';h.emit('rename',f,'One.md');assert.deepEqual(await h.service.scanStoredSessions(),[]);
 h.plugin.settings.timeTrackingIgnoreArchivedFiles=false;assert.equal((await h.service.scanStoredSessions()).length,1);
 h.files.splice(h.files.indexOf(f),1);h.emit('delete',f);const replacement=h.add('_archive/One.md',{timeTracking:[record('two')]});
 assert.equal((await h.service.scanStoredSessions())[0].record.id,'two');assert.equal(h.service.sessionSources.has(f),false);
 h.add('Imported.md',{timeTracking:[record('import')]});h.add('Hidden.companion.md',{timeTracking:[record('hidden')]});assert.equal((await h.service.scanStoredSessions()).length,2);assert.ok(h.service.sessionSources.has(replacement));
});
test('property changes invalidate cached negatives and in-flight configuration changes restart',async()=>{
 const h=harness();const f=h.add('One.md',{custom:[record('custom')]});assert.deepEqual(await h.service.scanStoredSessions(),[]);
 h.plugin.settings.timeTrackingPropertyKey='custom';assert.equal((await h.service.scanStoredSessions())[0].record.id,'custom');
 h.plugin.settings.timeTrackingPropertyKey='timeTracking';h.setReadHook(async file=>{h.setReadHook(null);h.plugin.settings.timeTrackingPropertyKey='custom';return h.bodies.get(file);});
 assert.equal((await h.service.scanStoredSessions())[0].record.id,'custom');
});
test('a change during an awaited read retries the changed path and preserves unrelated cached paths',async()=>{
 const h=harness();const a=h.add('A.md'),b=h.add('B.md');await h.service.scanStoredSessions();h.emit('modify',a);
 h.setReadHook(async f=>{const old=h.bodies.get(f);h.setReadHook(null);h.write(a,{timeTracking:[record('arrived')]});return old;});
 assert.equal((await h.service.scanStoredSessions())[0].record.id,'arrived');assert.equal(h.reads(),4);assert.ok(h.service.sessionSources.has(b));
});
test('unknown read failures and malformed source reject without publishing stale metadata, then a later explicit inspection can recover',async()=>{
 const h=harness();const f=h.add('One.md');h.metadata.set(f,{frontmatter:{timeTracking:[record('fallback')]}});
 h.setReadHook(async()=>{throw Error('temporarily unavailable');});
 const failures=await Promise.allSettled([h.service.scanStoredSessions(),h.service.scanStoredSessions()]);
 assert.ok(failures.every(result=>result.status==='rejected'));
 assert.equal(h.service.sessionSources.get(f)?.key,'','failure retains only an unknown discovery entry');
 h.setReadHook(null);
 for(const raw of ['---\ntimeTracking: [\n---\n','---\ntimeTracking: []\n','---\nscalar\n---\n','---\n- value\n---\n']){
  h.bodies.set(f,raw);await assert.rejects(h.service.scanStoredSessions(),/time-tracking-source-invalid/u);
  assert.equal(h.service.sessionSources.get(f)?.key,'','invalid source remains unknown');
 }
 h.bodies.set(f,document({timeTracking:[record('recovered')]}));assert.equal((await h.service.scanStoredSessions())[0].record.id,'recovered');
});
test('failed unknown recovery preserves known timer counts and blocks target preparation before starting a timer',async()=>{
 for(const failure of ['read','malformed']){
  const h=harness();const target=h.add('Target.md',{tpsId:'target',title:'Target'});
  const session=h.add('Session.md',{timeTracking:[record('known')]});
  h.plugin.app.vault.getAbstractFileByPath=path=>h.files.find(f=>f.path===path)??null;
  await h.service.refreshActiveTimerCache();assert.equal(h.service.getActiveTimerCountForFileSync(target),1);
  h.write(session,{});h.metadata.delete(session);
  if(failure==='read')h.setReadHook(async()=>{throw Error('unavailable');});
  else h.bodies.set(session,'---\ntimeTracking: [\n---\n');
  h.metadata.set(session,{frontmatter:{}});h.emit('metadata:resolved');
  let targetPreparations=0,writes=0;
  h.service.resolveAndEnsureTarget=async()=>{targetPreparations++;return {file:target,type:'note',tpsId:'target',title:'Target'};};
  h.service.writeNewSession=async()=>{writes++;};
  await assert.rejects(h.service.syncRunningScheduledMetadata(),/time-tracking-source-(?:unavailable|invalid)/u);
  assert.equal(h.service.getActiveTimerCountForFileSync(target),1,'failed recovery never publishes zero known timers');
  await assert.rejects(h.service.startTimer({file:target,type:'note'}),/time-tracking-source-(?:unavailable|invalid)/u);
  assert.equal(targetPreparations,0,'no identity preparation uses an incomplete discovery');assert.equal(writes,0);
  h.setReadHook(null);h.bodies.set(session,document({timeTracking:[record('known')]}));
  assert.equal((await h.service.scanStoredSessions())[0].record.id,'known','later explicit action can inspect the current source');
 }
});
test('source parsing handles BOM, CRLF, YAML end markers and case-insensitive keys without metadata',async()=>{
 const h=harness();h.add('One.md',{},'\uFEFF'+document({TIMETRACKING:[record('one')]}).replace(/---\n$/,'...\n').replace(/\n/g,'\r\n'));
 assert.equal((await h.service.scanStoredSessions())[0].record.id,'one');
});

test('file stat changes without metadata events and stats changing during reads cannot freeze an old result',async()=>{
 const h=harness();const f=h.add('One.md');await h.service.scanStoredSessions();
 h.bodies.set(f,document({timeTracking:[record('changed')]}));f.stat.mtime++;
 assert.equal((await h.service.scanStoredSessions())[0].record.id,'changed');
 f.stat.size++;h.setReadHook(async file=>{const old=h.bodies.get(file);h.bodies.set(file,document({timeTracking:[record('during-read')]}));file.stat.mtime++;h.setReadHook(null);return old;});
 assert.equal((await h.service.scanStoredSessions())[0].record.id,'during-read');
});
test('a rejected shared scan is released so subsequent callers can recover',async()=>{
 const h=harness();h.add('One.md',{timeTracking:[record('one')]});const original=h.plugin.app.vault.getMarkdownFiles;
 h.plugin.app.vault.getMarkdownFiles=()=>{throw Error('unavailable');};
 const results=await Promise.allSettled([h.service.scanStoredSessions(),h.service.scanStoredSessions()]);assert.ok(results.every(r=>r.status==='rejected'));
 h.plugin.app.vault.getMarkdownFiles=original;assert.equal((await h.service.scanStoredSessions())[0].record.id,'one');
});

test('disabled activation owns no timers, listeners, inventory, body read or UI publication during bursts', async()=>{
 const h=harness({enabled:false});
 let inventories=0, publications=0;
 h.plugin.app.vault.getMarkdownFiles=()=>{inventories++;return h.files;};
 h.plugin.eventService={emitFilesUpdated(){publications++;}};
 const revision=h.service.sessionSourceRevision;
 for(let i=0;i<1000;i++){
  const f=h.add(`Disabled ${i}.md`);
  for(const event of ['modify','rename','delete','metadata:changed'])h.emit(event,f);
 }
 await h.runStartup();
 await h.service.syncRunningScheduledMetadata();
 assert.deepEqual(await h.service.getRuntimeStatus(),{active:null,paused:null});
 assert.equal(h.events.size,0);
 assert.equal(h.intervals.size,0);
 assert.equal(h.timeouts.size,0);
 assert.equal(h.service.sessionSourceRevision,revision,'disabled events do not invalidate an unused source index');
 assert.deepEqual({inventories,reads:h.reads(),publications},{inventories:0,reads:0,publications:0});
});

test('enabling, disabling and enabling again owns one listener set and cancels previous layout/timer callbacks',async()=>{
 const h=harness({enabled:false});
 const target=h.add('Target.md',{tpsId:'target',title:'Target'});
 h.add('Session.md',{timeTracking:[record('first')]});
 h.plugin.app.vault.getAbstractFileByPath=path=>h.files.find(f=>f.path===path)??null;
 h.plugin.eventService={emitFilesUpdated(){}};
 h.activate(true);h.activate(true);
 assert.equal([...h.events.values()].reduce((n,refs)=>n+refs.length,0),6);
 assert.equal(h.intervals.size,1);
 const staleInterval=[...h.intervals.values()][0];
 await h.runStartup();
 assert.equal(h.service.getActiveTimerCountForFileSync(target),1);
 assert.equal(h.reads(),2);
 h.activate(false);
 assert.equal([...h.events.values()].flat().length,0);
 assert.equal(h.intervals.size,0);
 assert.equal(h.timeouts.size,0);
 assert.equal(h.service.sessionSources.size,0);
 assert.equal(h.service.activeTimerCountsByPath.size,0);
 const stoppedRevision=h.service.sessionSourceRevision;
 for(let i=0;i<100;i++)h.emit('metadata:changed',target);
 staleInterval();await h.runStartup();
 assert.equal(h.reads(),2);
 assert.equal(h.service.sessionSourceRevision,stoppedRevision);
 h.activate(true);
 assert.equal([...h.events.values()].flat().length,6);
 assert.equal(h.intervals.size,1);
 await h.runStartup();
 assert.equal(h.reads(),4,'reactivation discovers changes made while listeners were stopped');
 assert.equal(h.service.getActiveTimerCountForFileSync(target),1);
 h.service.detach();h.service.detach();
 assert.equal(h.intervals.size,0);
 assert.equal([...h.events.values()].flat().length,0);
});

test('disable during an awaited source read drains that read and stops all remaining inventory processing',async()=>{
 const h=harness();for(let i=0;i<1000;i++)h.add(`File ${i}.md`,{timeTracking:[record(`${i}`)]});
 let release;const wait=new Promise(resolve=>{release=resolve;});
 h.setReadHook(async f=>{await wait;return h.bodies.get(f);});
 const scan=h.service.scanStoredSessions();
 assert.equal(h.reads(),1);
 h.activate(false);release();
 assert.deepEqual(await scan,[]);
 assert.equal(h.reads(),1);
 assert.equal(h.service.sessionSources.size,0);
 assert.equal(h.service.activeTimerCountsByPath.size,0);
});

test('late work from a stopped activation cannot publish over a newly enabled scan',async()=>{
 const h=harness();const f=h.add('Session.md',{timeTracking:[record('old')]});
 let release;const wait=new Promise(resolve=>{release=resolve;});
 h.setReadHook(async file=>{const old=h.bodies.get(file);await wait;return old;});
 const oldScan=h.service.scanStoredSessions();
 h.activate(false);
 h.write(f,{timeTracking:[record('new')]});f.stat.mtime++;
 h.setReadHook(null);h.activate(true);
 assert.equal((await h.service.scanStoredSessions())[0].record.id,'new');
 release();assert.deepEqual(await oldScan,[]);
 assert.equal((await h.service.scanStoredSessions())[0].record.id,'new');
 assert.equal(h.reads(),2,'the stale read cannot invalidate or replace the new activation cache');
 h.service.detach();
});

test('complete metadata rejects 4000 non-candidates while eight stored sessions remain source-verified',async()=>{
 const h=harness();
 let inventories=0;const inventory=h.plugin.app.vault.getMarkdownFiles;
 h.plugin.app.vault.getMarkdownFiles=()=>{inventories++;return inventory();};
 for(let i=0;i<4008;i++){
  const fm=i<8?{timeTracking:[record(`active-${i}`)]}:{kind:['entity']};
  const f=h.add(`File ${i}.md`,fm);h.metadata.set(f,{frontmatter:fm});
 }
 h.emit('metadata:resolved');
 const sessions=await h.service.scanStoredSessions();
 assert.equal(sessions.length,8);assert.equal(h.reads(),8);
 const revision=h.service.sessionSourceRevision;
 for(let burst=0;burst<3;burst++)for(const f of h.files)h.emit('metadata:changed',f);
 assert.equal(h.service.sessionSourceRevision,revision,'unchanged metadata does not restart source recovery');
 assert.equal((await h.service.scanStoredSessions()).length,8);assert.equal(h.reads(),8);
 assert.equal(inventories,1,'metadata and repeated status bursts retain the single bootstrap inventory');
 const edited=h.files[4000];h.write(edited,{timeTracking:[record('new-import')]});
 assert.equal((await h.service.scanStoredSessions()).length,9);assert.equal(h.reads(),9);
 assert.equal(inventories,1,'a changed unknown path is discovered by the existing listener owner');
 h.service.detach();
});

test('cold unresolved startup waits for core metadata instead of reading the whole vault',async()=>{
 const h=harness({initialized:false});let inventories=0;
 const inventory=h.plugin.app.vault.getMarkdownFiles;
 h.plugin.app.vault.getMarkdownFiles=()=>{inventories++;return inventory();};
 for(let i=0;i<4049;i++){
  const fm=i<8?{timeTracking:[record(`active-${i}`)]}:{kind:['entity']};
  const f=h.add(`Cold ${i}.md`,fm);h.metadata.set(f,{frontmatter:fm});
 }
 h.service.activeTimerCountsByPath.set('Known.md',1);
 const pending=h.service.scanStoredSessions();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(inventories,0);assert.equal(h.reads(),0);
 assert.equal(h.service.activeTimerCountsByPath.get('Known.md'),1,'pending recovery does not publish an empty timer state');
 h.emit('metadata:resolved');assert.equal((await pending).length,8);
 assert.equal(inventories,1);assert.equal(h.reads(),8);h.service.detach();
});

test('unresolved Sync source changes remain unknown despite a stale metadata-negative cache',async()=>{
 const h=harness();const f=h.add('Imported.md',{kind:['entity']});
 h.metadata.set(f,{frontmatter:{kind:['entity']}});h.emit('metadata:resolved');
 assert.deepEqual(await h.service.scanStoredSessions(),[]);assert.equal(h.reads(),0);
 h.write(f,{timeTracking:[record('arrived-before-metadata')]});
 h.emit('metadata:changed',f);
 assert.equal((await h.service.scanStoredSessions())[0].record.id,'arrived-before-metadata');
 assert.equal(h.reads(),1,'a changed source cannot be excluded by a stale negative metadata cache');
 h.emit('metadata:changed',f);h.emit('metadata:resolved');
 assert.equal((await h.service.scanStoredSessions())[0].record.id,'arrived-before-metadata');
 assert.equal(h.reads(),1,'late resolved metadata does not replace the verified source');
 h.service.detach();
});

test('missing metadata remains source-inspected after resolved and configured keys are honored',async()=>{
 const h=harness();h.plugin.settings.timeTrackingPropertyKey='sessions';
 h.add('Unknown.md',{sessions:[record('unknown')]});
 const known=h.add('Known.md',{kind:['note']});h.metadata.set(known,{frontmatter:{kind:['note']}});
 h.emit('metadata:resolved');
 assert.equal((await h.service.scanStoredSessions())[0].record.id,'unknown');assert.equal(h.reads(),1);
 h.plugin.settings.timeTrackingPropertyKey='different';
 assert.deepEqual(await h.service.scanStoredSessions(),[]);
 assert.equal(h.reads(),3,'a changed configuration rechecks prior source/cache entries');
 h.service.detach();
});


test('disabling while a start waits for core metadata cancels target preparation and all timer writes',async()=>{
 const h=harness({initialized:false});const target=h.add('Target.md');let preparations=0,writes=0;
 h.service.resolveAndEnsureTarget=async()=>{preparations++;return {file:target,type:'note',tpsId:'target',title:'Target'};};
 h.service.writeNewSession=async()=>{writes++;};
 const pending=h.service.startTimer({file:target,type:'note'});await new Promise(resolve=>setImmediate(resolve));
 h.activate(false);assert.equal(await pending,null);assert.equal(preparations,0);assert.equal(writes,0);assert.equal(h.reads(),0);
});


test('unknown recovery blocks timer mutations with both single-active modes, including manual sessions, stop, edit and delete',async()=>{
 const actions=[
  ['start-single',h=>{h.plugin.settings.timeTrackingSingleActiveSession=true;return h.service.startTimer({file:h.files[0],type:'note'});}],
  ['start-multiple',h=>{h.plugin.settings.timeTrackingSingleActiveSession=false;return h.service.startTimer({file:h.files[0],type:'note'});}],
  ['manual',h=>h.service.addManualSession({file:h.files[0],type:'note'},'2026-09-22T12:00:00Z','2026-09-22T13:00:00Z')],
  ['stop',h=>h.service.stopActiveTimer()],['stop-file',h=>h.service.stopActiveTimerForFile(h.files[0])],
  ['stop-id',h=>h.service.stopTimerById('known')],['pause',h=>h.service.pauseActiveTimer()],
  ['edit',h=>h.service.updateSessionTimes('known','2026-09-22T12:00:00Z')],['delete',h=>h.service.deleteSession('known')],
 ];
 for(const failure of ['read','malformed'])for(const [name,action] of actions){
  const h=harness();const target=h.add('Target.md',{tpsId:'target',title:'Target'});const session=h.add('Session.md',{timeTracking:[record('known')]});
  await h.service.scanStoredSessions();h.service.activeTimerCountsByPath.set(target.path,1);
  h.write(session,{});h.metadata.set(session,{frontmatter:{}});h.emit('metadata:resolved');
  if(failure==='read')h.setReadHook(async()=>{throw Error('unavailable');});else h.bodies.set(session,'---\ntimeTracking: [\n---\n');
  const before=h.bodies.get(session);let preparations=0,writes=0,inventories=0;
  h.service.resolveAndEnsureTarget=async()=>{preparations++;return {file:target,type:'note',tpsId:'target',title:'Target'};};
  for(const method of ['writeNewSession','replaceStoredSession','removeStoredSession'])h.service[method]=async()=>{writes++;};
  const inventory=h.plugin.app.vault.getMarkdownFiles;h.plugin.app.vault.getMarkdownFiles=()=>{inventories++;return inventory();};
  await assert.rejects(action(h),/time-tracking-source-(?:unavailable|invalid)/u,`${failure}:${name}`);
  assert.deepEqual({preparations,writes,inventories},{preparations:0,writes:0,inventories:0},`${failure}:${name}`);
  assert.equal(h.bodies.get(session),before);assert.equal(h.service.getActiveTimerCountForFileSync(target),1);
 }
});


test('the exposed target resolver cannot prepare an identity from failed unknown recovery',async()=>{
 const h=harness();const file=h.add('Target.md');await h.service.scanStoredSessions();h.write(file,{});
 h.setReadHook(async()=>{throw Error('unavailable');});let preparations=0;
 h.service.resolveAndEnsureTarget=async()=>{preparations++;return null;};
 await assert.rejects(h.service.resolveActiveTarget(),/time-tracking-source-unavailable/u);assert.equal(preparations,0);
});

test('before layout activation and after unload, direct enabled consumers cannot enter legacy full-source discovery',async()=>{
 const h=harness();const file=h.add('Target.md');h.plugin.nativeRecordService={};h.service.detach();let inventories=0,preparations=0;
 h.plugin.app.vault.getMarkdownFiles=()=>{inventories++;return h.files;};
 h.service.resolveAndEnsureTarget=async()=>{preparations++;return null;};
 for(const action of [()=>h.service.getRuntimeStatus(),()=>h.service.startTimer({file,type:'note'}),()=>h.service.addManualSession({file,type:'note'},1,2)]){
  await assert.rejects(action(),/time-tracking-startup-not-ready/u);
 }
 assert.equal(inventories,0);assert.equal(h.reads(),0);assert.equal(preparations,0);
});


test('the registered native Start command passes readonly input to its sole preparation owner',async()=>{
 const source=readFileSync(new URL('../src/commands/register-commands.ts',import.meta.url),'utf8');
 const registration=source.match(/plugin\.addCommand\(\{\s*id: 'time-tracking-start-active-target',[\s\S]*?\n    \}\);/u)?.[0];
 assert.ok(registration);const compiled=await esbuild.transform(registration,{loader:'ts',target:'es2022'});
 const h=harness();const file=h.add('Target.md');await h.service.scanStoredSessions();h.write(file,{});
 h.setReadHook(async()=>{throw Error('unavailable');});let preparations=0,resolvers=0,callback;
 h.service.resolveAndEnsureTarget=async()=>{preparations++;return null;};
 h.service.resolveActiveTarget=async()=>{resolvers++;throw Error('duplicate preparation');};
 h.plugin.usesNativeRecordArchitecture=()=>true;h.plugin.app.workspace.getActiveFile=()=>file;
 h.plugin.timeTrackingService=h.service;h.plugin.addCommand=command=>{callback=command.callback;};
 new Function('plugin',compiled.code)(h.plugin);
 await assert.rejects(callback(),/time-tracking-source-unavailable/u);
 assert.equal(resolvers,0);assert.equal(preparations,0);
});


test('asset and folder events cannot turn complete bootstrap metadata into whole-vault unknown sources',async()=>{
 const h=harness();for(let i=0;i<1000;i++){const f=h.add(`Note ${i}.md`);h.metadata.set(f,{frontmatter:{}});}
 h.emit('metadata:resolved');const revision=h.service.sessionSourceRevision;const asset=new TFile('Image.png');asset.extension='png';
 for(const file of [asset,{path:'Folder'}])for(const event of ['create','modify','rename','delete'])h.emit(event,file);
 assert.equal(h.service.sessionMetadataReady,true);assert.equal(h.service.sessionSourceRevision,revision);
 assert.deepEqual(await h.service.scanStoredSessions(),[]);assert.equal(h.reads(),0);
});


test('an edit during 4049-note bootstrap retains settled metadata for untouched negatives and reads only nine candidate sources',async()=>{
 const h=harness();let inventories=0;const inventory=h.plugin.app.vault.getMarkdownFiles;
 h.plugin.app.vault.getMarkdownFiles=()=>{inventories++;return inventory();};
 for(let i=0;i<4049;i++){const fm=i<8?{timeTracking:[record(`stored-${i}`)]}:{};const f=h.add(`Bootstrap ${i}.md`,fm);h.metadata.set(f,{frontmatter:fm});}
 h.emit('metadata:resolved');const changed=h.files[4048];let edited=false;
 h.setReadHook(async file=>{if(!edited){edited=true;h.write(changed,{timeTracking:[record('arrived')]});}return h.bodies.get(file);});
 const sessions=await h.service.scanStoredSessions();assert.equal(sessions.length,9);
 assert.equal(h.reads(),9,'eight initial candidate notes plus the exact changed unknown source');
 assert.equal(inventories,1);assert.equal(h.service.sessionMetadataReady,true,'one source change does not revoke unrelated settled metadata');
 assert.equal((await h.service.scanStoredSessions()).length,9);assert.equal(h.reads(),9);assert.equal(inventories,1);
});

test('a late Sync change before the first inventory remains source-unknown even with settled stale metadata',async()=>{
 const h=harness();const file=h.add('Late Sync.md');h.metadata.set(file,{frontmatter:{}});h.emit('metadata:resolved');
 h.plugin.app.workspace.layoutReady=true;h.write(file,{timeTracking:[record('late-before-bootstrap')]});
 assert.equal((await h.service.scanStoredSessions())[0].record.id,'late-before-bootstrap');assert.equal(h.reads(),1);
});


test('unchanged metadata bursts during bootstrap preserve unvisited non-candidate proof without extra source reads',async()=>{
 const h=harness();for(let i=0;i<4049;i++){const fm=i<8?{timeTracking:[record(`stored-${i}`)]}:{};const f=h.add(`Burst ${i}.md`,fm);h.metadata.set(f,{frontmatter:fm});}
 h.emit('metadata:resolved');h.plugin.app.workspace.layoutReady=true;let burst=false;
 h.setReadHook(async file=>{if(!burst){burst=true;for(let i=0;i<3;i++)for(const f of h.files)h.emit('metadata:changed',f);}return h.bodies.get(file);});
 const revision=h.service.sessionSourceRevision;assert.equal((await h.service.scanStoredSessions()).length,8);
 assert.equal(h.service.sessionSourceRevision,revision);assert.equal(h.reads(),8);
});
