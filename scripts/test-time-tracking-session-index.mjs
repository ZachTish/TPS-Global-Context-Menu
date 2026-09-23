import test from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
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
function harness() {
  const files=[],bodies=new Map(),metadata=new Map(),events=new Map();let reads=0;let readHook=null;
  const on=(event,fn)=>{const list=events.get(event)||[];list.push(fn);events.set(event,list);return {};};
  const emit=(event,...args)=>{for(const fn of events.get(event)||[])fn(...args);};
  const plugin={settings:{},registerEvent(){},registerInterval(){},getArchiveFolderPath:()=> '_archive',
    filePropertiesService:{isCompanionFile:f=>f.path.endsWith('.companion.md')},
    app:{workspace:{onLayoutReady(){}},metadataCache:{on:(event,fn)=>on('metadata:'+event,fn),getFileCache:f=>metadata.get(f)},
      vault:{on,getMarkdownFiles:()=>[...files],async cachedRead(f){reads++;if(readHook)return readHook(f);return bodies.get(f);}}},
    frontmatterMutationService:{async process(f,mutate){const fm=parse(bodies.get(f).split('---')[1]);mutate(fm);bodies.set(f,document(fm));}},
  };
  const service=new TimeTrackingService(plugin);
  const previous=globalThis.window;globalThis.window={setInterval:()=>0};service.setup();globalThis.window=previous;
  const add=(path,fm={},raw)=>{const f=new TFile(path);files.push(f);bodies.set(f,raw??document(fm));emit('create',f);return f;};
  const write=(f,fm,event='modify')=>{bodies.set(f,document(fm));emit(event,f);};
  return {service,plugin,files,bodies,metadata,add,write,emit,reads:()=>reads,setReadHook:fn=>{readHook=fn;}};
}
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
 h.emit('metadata:changed',f);assert.equal((await h.service.scanStoredSessions())[0].record.id,'new');assert.equal(h.reads(),4);
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
test('read failures and malformed YAML are retried, with metadata fallback never permanently cached',async()=>{
 const h=harness();const f=h.add('One.md');h.metadata.set(f,{frontmatter:{timeTracking:[record('fallback')]}});
 h.setReadHook(async()=>{throw Error('temporarily unavailable');});assert.equal((await h.service.scanStoredSessions())[0].record.id,'fallback');assert.equal(h.service.sessionSources.has(f),false);
 h.setReadHook(null);h.bodies.set(f,'---\ntimeTracking: [\n---\n');await h.service.scanStoredSessions();assert.equal(h.service.sessionSources.has(f),false);
 h.bodies.set(f,document({timeTracking:[record('recovered')]}));assert.equal((await h.service.scanStoredSessions())[0].record.id,'recovered');
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
