import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/notebook-navigator-menu-service.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
  plugins: [{
    name: 'supported-menu-obsidian-stub',
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        loader: 'js',
        contents: `
          export class Component { registerEvent() {} }
          export class TFile {
            constructor(path) {
              this.path = path;
              this.extension = path.split('.').pop();
              this.basename = path.split('/').pop().replace(/\\.[^.]+$/, '');
            }
            static [Symbol.hasInstance](value) {
              return Boolean(value && typeof value.path === 'string' && typeof value.extension === 'string');
            }
          }
          export class MenuItem {}
        `,
      }));
    },
  }],
});

const { NotebookNavigatorMenuService } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
);

function file(path) {
  return { path, extension: path.split('.').pop(), basename: path.split('/').pop().replace(/\.[^.]+$/, '') };
}

function createProvider(version = '2.0.0', options = {}) {
  const callbacks = [];
  let registrations = 0;
  let disposals = 0;
  const api = {
    getVersion: () => {
      if (options.throwVersion) throw new Error('version unavailable');
      return version;
    },
    menus: {
      registerFileMenu(callback) {
        callbacks.push(callback);
        registrations += 1;
        options.onRegister?.();
        if (options.omitDisposer) return undefined;
        return () => { disposals += 1; };
      },
    },
  };
  return {
    api,
    callbacks,
    get registrations() { return registrations; },
    get disposals() { return disposals; },
  };
}

function createHarness(provider) {
  const calls = [];
  const workspaceListeners = new Map();
  const plugin = {
    settings: { inlineMenuOnly: false },
    app: {
      plugins: { plugins: provider ? { 'notebook-navigator': { api: provider.api } } : {} },
      workspace: {
        onLayoutReady(callback) { this.layoutReady = callback; },
        on(name, callback) {
          workspaceListeners.set(name, callback);
          return { name };
        },
      },
    },
    menuController: {
      addToNotebookNavigatorMenu(addItem, files) {
        calls.push({ addItem, paths: files.map((candidate) => candidate.path) });
      },
    },
  };
  return { calls, plugin, service: new NotebookNavigatorMenuService(plugin), workspaceListeners };
}

test('Notebook Navigator public menu callback uses its immutable effective selection exactly once', () => {
  const provider = createProvider();
  const harness = createHarness(provider);
  harness.service.onload();
  assert.equal(provider.registrations, 1);
  assert.equal(harness.service.ensureRegistered(), true);
  assert.equal(provider.registrations, 1);

  let added = 0;
  const addItem = () => { added += 1; };
  provider.callbacks[0]({
    addItem,
    file: file('Notes/A.md'),
    selection: {
      mode: 'multiple',
      files: [file('Notes/A.md'), file('Notes/B.md'), file('Notes/A.md')],
    },
  });
  assert.deepEqual(harness.calls.map(({ paths }) => paths), [['Notes/A.md', 'Notes/B.md']]);
  harness.calls[0].addItem(() => undefined);
  assert.equal(added, 1);
});

test('provider replacement disposes the old callback and stale callbacks fail closed', () => {
  const first = createProvider('2.0.0');
  const second = createProvider('2.1.0');
  const harness = createHarness(first);
  harness.service.onload();

  harness.plugin.app.plugins.plugins['notebook-navigator'] = { api: second.api };
  assert.equal(harness.service.ensureRegistered(), true);
  assert.equal(first.disposals, 1);
  assert.equal(second.registrations, 1);

  const context = {
    addItem: () => undefined,
    file: file('Notes/Current.md'),
    selection: { mode: 'single', files: [file('Notes/Current.md')] },
  };
  first.callbacks[0](context);
  assert.equal(harness.calls.length, 0);
  second.callbacks[0](context);
  assert.deepEqual(harness.calls[0].paths, ['Notes/Current.md']);

  harness.service.onunload();
  assert.equal(second.disposals, 1);
  second.callbacks[0](context);
  assert.equal(harness.calls.length, 1);
});

test('delayed lifecycle callbacks cannot revive a contribution after unload', () => {
  const provider = createProvider();
  const harness = createHarness(provider);
  harness.service.onload();
  assert.equal(provider.registrations, 1);

  harness.service.onunload();
  assert.equal(provider.disposals, 1);
  harness.plugin.app.workspace.layoutReady();
  harness.workspaceListeners.get('layout-change')?.();

  assert.equal(provider.registrations, 1);
  assert.equal(harness.service.ensureRegistered(), false);
});

test('registration revalidates lifecycle and provider identity after external code returns', () => {
  const unloadOptions = {};
  const unloadingProvider = createProvider('2.0.0', unloadOptions);
  const unloadingHarness = createHarness(unloadingProvider);
  unloadOptions.onRegister = () => unloadingHarness.service.onunload();
  unloadingHarness.service.onload();
  assert.equal(unloadingProvider.registrations, 1);
  assert.equal(unloadingProvider.disposals, 1);
  assert.equal(unloadingHarness.service.ensureRegistered(), false);

  const replacementOptions = {};
  const replacedProvider = createProvider('2.0.0', replacementOptions);
  const replacementProvider = createProvider('2.1.0');
  const replacementHarness = createHarness(replacedProvider);
  replacementOptions.onRegister = () => {
    replacementHarness.plugin.app.plugins.plugins['notebook-navigator'] = { api: replacementProvider.api };
  };
  replacementHarness.service.onload();
  assert.equal(replacedProvider.disposals, 1);
  assert.equal(replacementHarness.service.ensureRegistered(), true);
  assert.equal(replacementProvider.registrations, 1);
});

test('registration is single-flight and version diagnostics cannot wedge disposal', () => {
  const options = { throwVersion: true };
  const provider = createProvider('2.0.0', options);
  const harness = createHarness(provider);
  options.onRegister = () => {
    assert.equal(harness.service.ensureRegistered(), false);
  };

  harness.service.onload();
  assert.equal(provider.registrations, 1);
  assert.equal(harness.service.ensureRegistered(), true);
  harness.service.onunload();
  assert.equal(provider.disposals, 1);
});

test('single-flight registration cannot leak a nested replacement provider', () => {
  const outerOptions = {};
  const outer = createProvider('2.0.0', outerOptions);
  const nested = createProvider('2.1.0');
  const harness = createHarness(outer);
  outerOptions.onRegister = () => {
    harness.plugin.app.plugins.plugins['notebook-navigator'] = { api: nested.api };
    assert.equal(harness.service.ensureRegistered(), false);
    harness.plugin.app.plugins.plugins['notebook-navigator'] = { api: outer.api };
  };

  harness.service.onload();
  assert.equal(outer.registrations, 1);
  assert.equal(nested.registrations, 0);

  harness.plugin.app.plugins.plugins['notebook-navigator'] = { api: nested.api };
  assert.equal(harness.service.ensureRegistered(), true);
  assert.equal(outer.disposals, 1);
  assert.equal(nested.registrations, 1);
});

test('missing API or a provider that violates the disposer contract stays disabled', () => {
  const missing = createHarness(null);
  missing.service.onload();
  assert.equal(missing.service.ensureRegistered(), false);

  const provider = createProvider('unknown', { omitDisposer: true });
  const invalid = createHarness(provider);
  invalid.service.onload();
  assert.equal(invalid.service.ensureRegistered(), false);
  invalid.plugin.app.workspace.layoutReady();
  invalid.workspaceListeners.get('layout-change')?.();
  assert.equal(provider.registrations, 1);
  provider.callbacks[0]({
    addItem: () => undefined,
    file: file('Notes/Nope.md'),
    selection: { mode: 'single', files: [file('Notes/Nope.md')] },
  });
  assert.equal(invalid.calls.length, 0);
});

test('menu routing uses supported contribution APIs without prototype or instance interception', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../src/services/notebook-navigator-menu-service.ts', import.meta.url), 'utf8');
  const events = readFileSync(new URL('../src/events/register-events.ts', import.meta.url), 'utf8');
  const builder = readFileSync(new URL('../src/menu/menu-builder.ts', import.meta.url), 'utf8');

  assert.equal(existsSync(new URL('../src/menu/menu-patcher.ts', import.meta.url)), false);
  assert.doesNotMatch(main, /setupMenuPatch|restoreMenuPatch|Menu\.prototype/);
  assert.match(service, /menus\?\.registerFileMenu|registerFileMenu\.call/);
  assert.match(events, /workspace\.on\('file-menu'/);
  assert.match(events, /workspace\.on\('files-menu'/);
  assert.match(events, /workspace\.on\('editor-menu'/);
  assert.match(events, /foldExpansionContextMenuService\?\.addMenuItemForTarget/);
  assert.doesNotMatch(builder, /menu\.addItem\s*=/);
  assert.doesNotMatch(builder, /\(menu as any\)\.items|_tpsHandled|_isTpsItem/);
});
