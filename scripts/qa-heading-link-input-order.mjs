// Explicit browser integration check, separate from the platform-independent unit suite.
// Usage: node scripts/qa-heading-link-input-order.mjs [path-to-Chrome-or-Chromium]
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { DEPENDENCY_CACHE_ROOT } from '../../workspace-paths.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const browserPath = process.argv[2] || process.env.TPS_HEADING_BROWSER
  || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const baselineSource = execFileSync('git', ['show', '7.3.6:src/services/heading-link-suggest.ts'], { cwd: repo, encoding: 'utf8' });
const currentSource = readFileSync(new URL('../src/services/heading-link-suggest.ts', import.meta.url), 'utf8');
function extractClass(source, name) {
  const ast = ts.createSourceFile('suggest.ts', source, ts.ScriptTarget.Latest, true);
  return ast.statements.find(ts.isClassDeclaration).getText(ast).replace('export class HeadingLinkSuggest', `class ${name}`);
}
const bundle = await build({
  stdin: {
    loader: 'ts', resolveDir: repo,
    contents: `
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
class Component {
  cleanups = [];
  registerDomEvent(target, name, callback, options) {
    target.addEventListener(name, callback, options);
    this.cleanups.push(() => target.removeEventListener(name, callback, options));
  }
  registerEvent(ref) { this.cleanups.push(ref.off); }
  unload() { this.onunload(); for (const cleanup of this.cleanups) cleanup(); }
}
class MarkdownView {}
class TFile {}
${extractClass(baselineSource, 'Baseline')}
${extractClass(baselineSource.replace('window.setTimeout(() => this.refresh(), 0);', ''), 'CaptureOnly')}
${extractClass(currentSource, 'AfterCommit')}
async function run(Suggest, withKeydown) {
  const host = document.body.appendChild(document.createElement('div'));
  const callbacks = new Map();
  const events = [];
  let cm, scans = 0, renders = 0;
  const editor = {
    hasFocus: () => cm.hasFocus,
    getCursor: () => ({ line: 0, ch: cm.state.selection.main.head }),
    getLine: (line) => cm.state.doc.line(line + 1).text,
  };
  const file = { path: 'Fixture/Active.md', extension: 'md' };
  const view = { file, editor, contentEl: host, getMode: () => 'source' };
  cm = new EditorView({ parent: host, state: EditorState.create({
    doc: '# H', selection: { anchor: 3 }, extensions: [EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        events.push({ event: 'editor-change', doc: cm.state.doc.toString() });
        callbacks.get('editor-change')?.(editor, view);
      }
    })],
  }) });
  const plugin = { app: {
    workspace: {
      getActiveViewOfType: () => view,
      on: (name, callback) => { callbacks.set(name, callback); return { off: () => callbacks.delete(name) }; },
    },
    vault: { getMarkdownFiles: () => { scans++; return [{ path: 'Fixture/Target.md', basename: 'Heading target', extension: 'md' }]; } },
    metadataCache: { getFileCache: () => ({}) },
  }, filePropertiesService: { isCompanionFile: () => false } };
  const suggest = new Suggest(plugin);
  suggest.render = () => { renders++; };
  suggest.onload();
  cm.focus();
  const capture = () => events.push({ event: 'capture-input', doc: cm.state.doc.toString() });
  document.addEventListener('input', capture, true);
  if (withKeydown) cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', keyCode: 229, bubbles: true }));
  // Model browser composition input: mutate the real content DOM, dispatch input,
  // and let CodeMirror's real MutationObserver commit it. Never dispatch keyup.
  const text = cm.contentDOM.querySelector('.cm-line').firstChild;
  text.nodeValue = '# Heading';
  const range = document.createRange();
  range.setStart(text, 9); range.collapse(true);
  getSelection().removeAllRanges(); getSelection().addRange(range);
  cm.contentDOM.dispatchEvent(new InputEvent('input', {
    bubbles: true, inputType: 'insertCompositionText', data: 'eading', isComposing: true,
  }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const result = { version: Suggest.name, withKeydown, focused: cm.hasFocus, doc: cm.state.doc.toString(), scans, renders, events };
  suggest.unload(); document.removeEventListener('input', capture, true); cm.destroy(); host.remove();
  return result;
}
(async () => {
  try {
    const results = [];
    for (const Suggest of [Baseline, CaptureOnly, AfterCommit]) {
      for (const withKeydown of [false, true]) results.push(await run(Suggest, withKeydown));
    }
    document.querySelector('#results').textContent = JSON.stringify(results);
  } catch (error) { document.querySelector('#results').textContent = JSON.stringify({ error: String(error), stack: error.stack }); }
})();
`,
  },
  bundle: true, format: 'iife', write: false, logLevel: 'silent',
});
const profile = await mkdtemp(join(DEPENDENCY_CACHE_ROOT, 'heading-input-browser-'));
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/bundle.js' ? 'application/javascript' : 'text/html');
  response.end(request.url === '/bundle.js' ? bundle.outputFiles[0].text
    : '<!doctype html><pre id="results">pending</pre><script src="/bundle.js"></script>');
});
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(browserPath, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-component-update', `--user-data-dir=${profile}`,
    '--virtual-time-budget=1500', '--dump-dom', `http://127.0.0.1:${server.address().port}`,
  ]);
  let output = '';
  child.stdout.on('data', (part) => { output += part; });
  child.stderr.resume();
  const timeout = setTimeout(() => child.kill(), 25000);
  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  } finally { clearTimeout(timeout); }
  assert.equal(exitCode, 0, 'isolated browser must finish successfully');
  const results = JSON.parse(output.match(/<pre id="results">(.*?)<\/pre>/s)?.[1] || 'null');
  assert.ok(Array.isArray(results), JSON.stringify(results));
  assert.equal(results.length, 6);
  for (const result of results) {
    const expectedScans = result.version === 'AfterCommit' || (result.version === 'Baseline' && result.withKeydown) ? 1 : 0;
    assert.equal(result.focused, true);
    assert.equal(result.doc, '# Heading');
    assert.deepEqual(result.events, [{ event: 'capture-input', doc: '# H' }, { event: 'editor-change', doc: '# Heading' }]);
    assert.equal(result.scans, expectedScans, JSON.stringify(result));
    assert.equal(result.renders, expectedScans, JSON.stringify(result));
  }
  console.log(JSON.stringify({ result: 'passed', boundary: 'real CodeMirror DOM/MutationObserver; simulated Obsidian after-commit event; no physical IME or popup visual QA', results }, null, 2));
} finally {
  server.close();
  // This is only the unique profile created by this invocation, never a user's browser profile.
  await rm(profile, { recursive: true, force: true });
}
