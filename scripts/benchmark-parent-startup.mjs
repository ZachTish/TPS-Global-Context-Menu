import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

// Component benchmark, not an installed Obsidian/input-to-paint measurement.
// Compile both actual source versions before timing; reuse the regression harness
// and actual FileProperties classifier. No files, settings or note bodies change.
const testURL = new URL('./test-parent-relationship-index.mjs', import.meta.url);
const source = readFileSync(testURL, 'utf8');
const tree = ts.createSourceFile(testURL.pathname, source, ts.ScriptTarget.Latest, true);
function helper(name) {
  const matches = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(matches.length, 1, `one actual ${name} helper`);
  return matches[0].getText(tree).replaceAll('import.meta.url', JSON.stringify(testURL.href));
}
const loadText = helper('loadService')
  .replace('loadService()', 'loadService(parentSource)')
  .replace('setup(context) {', `setup(context) {
    context.onLoad({ filter: /parent-link-resolution-service\\.ts$/u }, () => ({ contents: parentSource, loader: 'ts' }));`);
const load = new Function('build', 'fileURLToPath', 'Buffer', `${loadText}; return loadService;`)(build, fileURLToPath, Buffer);
const baselineRef = process.argv[2] || '4cf8cc5b49f8f69c76c5b528d93c208070913352';
const baseline = execFileSync('git', ['show', `${baselineRef}:src/services/parent-link-resolution-service.ts`], { encoding: 'utf8' });
const candidate = readFileSync(new URL('../src/services/parent-link-resolution-service.ts', import.meta.url), 'utf8');
const modules = { before: await load(baseline), after: await load(candidate) };
const schedulerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
Object.defineProperty(globalThis, 'scheduler', { configurable: true, value: undefined });
assert.equal(typeof globalThis.MessageChannel, 'function', 'use the actual host MessageChannel');
const results = [];
try {
  for (let pair = 0; pair < 3; pair++) {
    for (const label of pair % 2 ? ['after', 'before'] : ['before', 'after']) {
      const modulePromise = Promise.resolve(modules[label]);
      const makeHarness = new Function('modulePromise', 'assert', `${helper('makeHarness')}; return makeHarness;`)(modulePromise, assert);
      const makeActual = new Function('makeHarness', 'modulePromise', 'assert', `${helper('makeActualParentPropertiesHarness')}; return makeActualParentPropertiesHarness;`)(makeHarness, modulePromise, assert);
      const h = await makeActual();
      const parents = Array.from({ length: 100 }, (_, n) => h.add(`Parents/${n}.md`));
      for (let n = 0; n < 9900; n++) h.add(`Tasks/${String(n).padStart(5, '0')}.md`, { parent: `[[${parents[n % 100].path}]]` });
      let taskYields = 0;
      if (h.service.yieldIndexBuild) {
        const original = h.service.yieldIndexBuild.bind(h.service);
        h.service.yieldIndexBuild = () => { taskYields++; return original(); };
      }
      let last = performance.now();
      let maxHeartbeatGapMs = 0;
      let heartbeats = 0;
      const heartbeat = setInterval(() => {
        const now = performance.now();
        maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - last);
        last = now; heartbeats++;
      }, 1);
      const start = performance.now();
      h.service.setup();
      await h.service.initialBuild;
      const completionMs = performance.now() - start;
      // Let the blocked baseline timer run before stopping observation.
      await new Promise(resolve => setTimeout(resolve, 0));
      clearInterval(heartbeat);
      assert.equal(h.service.indexReady, true, JSON.stringify(globalThis.__gcmParentIndexErrors?.map(entry => entry.map(value => value?.error?.message || String(value)))));
      const initialMetadata = h.counters.metadata;
      const graph = parents.map(parent => [parent.path, h.service.getChildrenForParent(parent).map(child => child.path)]);
      assert.equal(graph.reduce((total, [, children]) => total + children.length, 0), 9900);
      const graphSHA256 = createHash('sha256').update(JSON.stringify(graph)).digest('hex');
      assert.equal(h.counters.scans, 1); assert.equal(initialMetadata, 10000);
      assert.equal(h.counters.rawReads, 0); assert.equal(h.counters.writes, 0);
      h.unload();
      const result = { pair: pair + 1, label, notes: 10000, edges: 9900, inventories: h.counters.scans,
        initialMetadata, rawReads: h.counters.rawReads, writes: h.counters.writes, taskYields,
        heartbeats, completionMs: +completionMs.toFixed(2), maxHeartbeatGapMs: +maxHeartbeatGapMs.toFixed(2), graphSHA256 };
      results.push(result); console.log(JSON.stringify(result));
    }
  }
  assert.equal(new Set(results.map(x => x.graphSHA256)).size, 1, 'all six complete relationship graphs are identical');
  const median = values => values.sort((a, b) => a - b)[1];
  for (const label of ['before', 'after']) {
    const samples = results.filter(x => x.label === label);
    console.log(JSON.stringify({ label, samples: 3, medianCompletionMs: median(samples.map(x => x.completionMs)),
      medianMaxHeartbeatGapMs: median(samples.map(x => x.maxHeartbeatGapMs)) }));
  }
} finally {
  if (schedulerDescriptor) Object.defineProperty(globalThis, 'scheduler', schedulerDescriptor);
  else delete globalThis.scheduler;
}
