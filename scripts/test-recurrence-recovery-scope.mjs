import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { parse, stringify } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const result = await build({
  stdin: { contents: "export { BulkEditService } from './src/services/bulk-edit-service.ts'; export { TFile } from 'obsidian';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'recurrence-recovery-obsidian', setup(builder) {
    builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'recurrence-recovery' }));
    builder.onLoad({ filter: /.*/, namespace: 'recurrence-recovery' }, () => ({ loader: 'js', resolveDir: root, contents: `
      import { parse } from 'yaml';
      class Dummy { open() {} }
      class TFile { constructor(path) { this.path = path; this.name = path.split('/').pop(); this.basename = this.name.replace(/\\.md$/u, ''); this.extension = 'md'; } }
      module.exports = new Proxy({ TFile, App: Dummy, Modal: Dummy, Notice: Dummy, parseYaml: parse, normalizePath: value => String(value).replace(/\\\\/gu, '/').replace(/\\/{2,}/gu, '/') }, { get: (target, key) => key in target ? target[key] : Dummy });
    ` }));
  } }],
});
const module = { exports: {} };
new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
const { BulkEditService, TFile } = module.exports;

test('template propagation has no navigation listener, prompt, or mutation method', () => {
 assert.equal(existsSync(new URL('../src/services/recurrence-service.ts', import.meta.url)), false);
 const bulk = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');
 assert.doesNotMatch(bulk, /applyTemplateToOpenInstances/);
 assert.equal(new BulkEditService({settings:{}}).applyTemplateToOpenInstances, undefined);
});

test('automatic recurrence recovery has no worker, queue, startup trigger or shared API', () => {
  const shared = readFileSync(new URL('../src/services/shared/index.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const bulk = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(main + shared + bulk, /checkMissingRecurrences|runMissingRecurrenceCheck|drainRecurrenceRecovery|recurrenceRecovery|startupCheckTimer/);
  const service = new BulkEditService({ settings: { enableRecurrence: true } });
  assert.equal(service.checkMissingRecurrences, undefined);
  assert.equal(service.runMissingRecurrenceCheck, undefined);
  assert.equal(service.drainRecurrenceRecovery, undefined);
});

test('ordinary edits cannot record recurrence sessions or prompt for a split', () => {
 const bulk = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');
 const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
 const settings = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
 assert.doesNotMatch(main + bulk, /\brecurrenceService\b|promptForFrontmatterChange|markFileAsModified|recurrence-session\.json/);
 assert.doesNotMatch(settings, /promptOnRecurrenceEdit|recurrencePromptTimeout|Prompt on Edit/);
});
