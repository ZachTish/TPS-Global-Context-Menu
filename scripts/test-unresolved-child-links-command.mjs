import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const built = await build({
  entryPoints: [fileURLToPath(new URL('../src/commands/register-commands.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'command-boundary-stubs',
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
      builder.onResolve({ filter: /(?:file-properties-relink-modal|unresolved-subitem-modal|logger)$/ }, args => ({
        path: args.path,
        namespace: 'stub',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => {
        if (args.path === 'obsidian') return { loader: 'js', contents: `
          export class TFile {
            constructor(path) { this.path = path; this.extension = path.split('.').pop(); }
          }
          export class MarkdownView {}
          export class Notice { constructor(message) { globalThis.__commandNotices.push(message); } }
          globalThis.__commandTFile = TFile;
        ` };
        if (args.path.endsWith('file-properties-relink-modal')) {
          return { loader: 'js', contents: 'export function promptFilePropertiesRelink() {}' };
        }
        if (args.path.endsWith('unresolved-subitem-modal')) return { loader: 'js', contents: `
          export async function checkAndPromptForUnresolvedSubitems(plugin, file) {
            globalThis.__commandChecks.push(file);
            await plugin.app.vault.cachedRead(file);
          }
        ` };
        return { loader: 'js', contents: 'export function warn(...args) { globalThis.__commandWarnings.push(args); }' };
      });
    },
  }],
});
const { registerGcmCommands } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

test('unresolved child-link cleanup is absent in native mode and selected-file scoped in legacy mode', async () => {
  for (const mode of ['native-records', 'legacy']) {
    const commands = new Map();
    const reads = [];
    globalThis.__commandChecks = [];
    globalThis.__commandNotices = [];
    globalThis.__commandWarnings = [];
    const file = new globalThis.__commandTFile('Inbox/Selected.md');
    let active = file;
    const plugin = {
      settings: { dataArchitectureMode: mode },
      addCommand(command) { commands.set(command.id, command); },
      app: {
        workspace: { getActiveFile: () => active },
        vault: { async cachedRead(target) { reads.push(target); return '---\ntitle: Selected\n---\n'; } },
      },
    };
    registerGcmCommands(plugin);
    const command = commands.get('check-active-note-child-links');
    if (mode === 'native-records') {
      assert.equal(command, undefined);
      assert.deepEqual([reads.length, globalThis.__commandChecks.length], [0, 0]);
      continue;
    }
    assert.equal(command.name, 'Child links: Check unresolved links in current note');
    assert.equal(command.checkCallback(true), true);
    assert.deepEqual([reads.length, globalThis.__commandChecks.length], [0, 0], `${mode}: availability is read-only`);
    assert.equal(command.checkCallback(false), true);
    await Promise.resolve();
    assert.deepEqual(reads, [file], `${mode}: inspect only the requested note`);
    assert.deepEqual(globalThis.__commandChecks, [file]);
    active = new globalThis.__commandTFile('Inbox/Board.canvas');
    assert.equal(command.checkCallback(false), false);
    active = null;
    assert.equal(command.checkCallback(false), false);
    assert.equal(reads.length, 1);
    assert.deepEqual(globalThis.__commandNotices, []);
  }
});

test('a command read failure reports one error instead of leaving a rejected promise', async () => {
  const commands = new Map();
  const file = new globalThis.__commandTFile('Inbox/Selected.md');
  globalThis.__commandChecks = [];
  globalThis.__commandNotices = [];
  globalThis.__commandWarnings = [];
  registerGcmCommands({
    settings: { dataArchitectureMode: 'legacy' },
    addCommand(command) { commands.set(command.id, command); },
    app: {
      workspace: { getActiveFile: () => file },
      vault: { async cachedRead() { throw Error('synthetic read failure'); } },
    },
  });
  assert.equal(commands.get('check-active-note-child-links').checkCallback(false), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(globalThis.__commandWarnings.length, 1);
  assert.deepEqual(globalThis.__commandNotices, ['TPS GCM: Could not inspect child links in this note.']);
});
