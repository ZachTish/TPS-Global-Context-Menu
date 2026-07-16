import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

async function loadCore() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/home-component-action-core.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadPure(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const context = {
  source: 'tps-home',
  dateIso: '2026-07-12',
  dailyNotePath: '2026-07-12.md',
  componentId: 'base:daily note feed.base',
  basePath: 'Daily Note Feed.base',
};

test('Home action settings normalize malformed input, targets, and duplicate IDs', async () => {
  const { normalizeHomeComponentActions } = await loadCore();
  assert.deepEqual(normalizeHomeComponentActions(null), {});
  assert.deepEqual(normalizeHomeComponentActions({
    ' Food-Tracker ': [
      { id: 'food', commandId: ' tps-health:log-food ', label: ' Log food ', icon: ' apple ', target: 'home-note' },
      { id: 'FOOD', commandId: 'plugin:second', target: 'invalid' },
      { commandId: 'plugin:third', target: 'workspace' },
      { id: 'missing-command' },
    ],
  }), {
    'food-tracker': [
      { id: 'food', commandId: 'tps-health:log-food', label: 'Log food', icon: 'apple', target: 'home-note' },
      { id: 'FOOD-2', commandId: 'plugin:second', target: 'home-note' },
      { id: 'action-3-plugin-third', commandId: 'plugin:third', target: 'workspace' },
    ],
  });
});

test('selected-note actions prefer registered handlers and never run the workspace command', async () => {
  const { routeHomeComponentAction } = await loadCore();
  let registeredCalls = 0;
  let providerCalls = 0;
  let workspaceCalls = 0;
  const result = await routeHomeComponentAction(
    { id: 'capture', commandId: 'gcm:capture', target: 'home-note' },
    context,
    {
      getRegisteredHandler: () => async (received) => {
        registeredCalls += 1;
        assert.deepEqual(received, context);
      },
      getProviders: () => [{ canHandle: () => true, execute: () => { providerCalls += 1; } }],
      executeWorkspaceCommand: async () => { workspaceCalls += 1; return true; },
    },
  );
  assert.deepEqual(result, { status: 'handled', route: 'registered' });
  assert.equal(registeredCalls, 1);
  assert.equal(providerCalls, 0);
  assert.equal(workspaceCalls, 0);
});

test('selected-note actions pass exact Home context to the first claiming provider', async () => {
  const { routeHomeComponentAction } = await loadCore();
  const calls = [];
  const result = await routeHomeComponentAction(
    { id: 'food', commandId: 'tps-health:log-food', target: 'home-note' },
    context,
    {
      getRegisteredHandler: () => null,
      getProviders: () => [
        { canHandle: () => false, execute: () => { throw new Error('must not execute'); } },
        {
          canHandle: (commandId) => commandId === 'tps-health:log-food',
          execute: (commandId, received) => {
            calls.push({ commandId, received });
            return true;
          },
        },
      ],
      executeWorkspaceCommand: async () => { throw new Error('must not execute'); },
    },
  );
  assert.deepEqual(result, { status: 'handled', route: 'provider' });
  assert.deepEqual(calls, [{ commandId: 'tps-health:log-food', received: context }]);
});

test('unsupported or invalid selected-note actions fail closed', async () => {
  const { routeHomeComponentAction } = await loadCore();
  let workspaceCalls = 0;
  const dependencies = {
    getRegisteredHandler: () => null,
    getProviders: () => [],
    executeWorkspaceCommand: async () => { workspaceCalls += 1; return true; },
  };
  assert.deepEqual(
    await routeHomeComponentAction({ id: 'x', commandId: 'plugin:x', target: 'home-note' }, context, dependencies),
    { status: 'unavailable' },
  );
  assert.deepEqual(
    await routeHomeComponentAction(
      { id: 'x', commandId: 'plugin:x', target: 'home-note' },
      { ...context, dailyNotePath: '' },
      dependencies,
    ),
    { status: 'unavailable' },
  );
  assert.equal(workspaceCalls, 0);
});

test('workspace actions use only explicit normal command execution', async () => {
  const { routeHomeComponentAction } = await loadCore();
  let workspaceCommand = '';
  const result = await routeHomeComponentAction(
    { id: 'normal', commandId: 'plugin:normal', target: 'workspace' },
    context,
    {
      getRegisteredHandler: () => { throw new Error('must not inspect contextual handlers'); },
      getProviders: () => { throw new Error('must not inspect contextual providers'); },
      executeWorkspaceCommand: async (commandId) => {
        workspaceCommand = commandId;
        return true;
      },
    },
  );
  assert.deepEqual(result, { status: 'handled', route: 'workspace' });
  assert.equal(workspaceCommand, 'plugin:normal');
});

test('Home Base source substitution preserves whole-base and active-view filter trees', async () => {
  const { addHomeBaseContextFilter, resolveHomeBaseDefinitionSourcePath } = await loadPure('../src/views/home-base-context.ts');
  const source = JSON.stringify({
    filters: { and: ['file.path == this.file.path', 'file.ext == "md"'] },
    views: [{ type: 'tps-list', filters: { or: ['kind == "task"', 'kind == "bullet"'] } }],
  });
  const resolved = JSON.parse(resolveHomeBaseDefinitionSourcePath(source, 'Daily Notes/2026-07-12.md'));
  assert.deepEqual(resolved.filters, {
    and: ['file.path == "Daily Notes/2026-07-12.md"', 'file.ext == "md"'],
  });
  assert.deepEqual(resolved.views[0].filters, {
    or: ['kind == "task"', 'kind == "bullet"'],
  });
  const workout = JSON.parse(addHomeBaseContextFilter(source, 'workoutDate == date("2026-07-12")'));
  assert.deepEqual(workout.filters, {
    and: [
      { and: ['file.path == this.file.path', 'file.ext == "md"'] },
      'workoutDate == date("2026-07-12")',
    ],
  });
  assert.deepEqual(workout.views[0].filters, {
    or: ['kind == "task"', 'kind == "bullet"'],
  });
});

test('Home UI, capture writer, and feed Base keep selected-note context explicit', () => {
  const homeSource = readFileSync(new URL('../src/views/home-view.ts', import.meta.url), 'utf8');
  const actionServiceSource = readFileSync(new URL('../src/services/home-component-action-service.ts', import.meta.url), 'utf8');
  const captureSource = readFileSync(new URL('../src/services/home-capture-service.ts', import.meta.url), 'utf8');
  const captureEditorSource = readFileSync(new URL('../src/services/home-capture-markdown-editor.ts', import.meta.url), 'utf8');
  const constantsSource = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
  const apiSource = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
  const contextSource = readFileSync(new URL('../src/views/base-embed-context.ts', import.meta.url), 'utf8');
  const bridgeSource = readFileSync(new URL('../src/views/tps-list-bridge-view.ts', import.meta.url), 'utf8');
  const commandSource = readFileSync(new URL('../src/commands/register-commands.ts', import.meta.url), 'utf8');
  const feedSource = readFileSync(new URL('./fixtures/Daily Note Feed.base', import.meta.url), 'utf8');

  assert.match(homeSource, /renderHomeComponentActions/);
  assert.match(homeSource, /Add command to this component/);
  assert.match(homeSource, /Target selected Daily Note/);
  assert.match(homeSource, /Run normally in workspace/);
  assert.match(homeSource, /dailyNotePath: dailyNote\.path/);
  assert.match(homeSource, /sourcePath,\s*\}, \(\) => MarkdownRenderer\.render/);
  assert.doesNotMatch(homeSource, /headerActions:/);
  assert.doesNotMatch(actionServiceSource, /getActiveFile/);
  assert.match(apiSource, /homeActions:/);
  assert.match(contextSource, /sourcePath\?: string/);
  assert.match(bridgeSource, /dataset\.tpsContextPath = renderContext\.sourcePath/);
  assert.match(captureSource, /requestedPath/);
  assert.match(captureSource, /vault\.process\(file/);
  assert.match(captureSource, /tps-home-context-capture-live-editor/);
  assert.doesNotMatch(captureSource, /const addTask =/);
  assert.match(captureEditorSource, /key: 'Mod-l'/);
  assert.match(captureEditorSource, /overflow: 'visible'/);
  assert.match(commandSource, /id: 'capture-to-home-note'/);
  assert.match(commandSource, /id: 'add-task-to-home-note'/);
  assert.match(constantsSource, /HOME_DAILY_NOTE_FEED_BASE_PATH/);
  assert.match(constantsSource, /homeComponentActions:/);
  assert.match(constantsSource, /homeComponents:\s*\[\s*\{ type: 'base', path: HOME_DAILY_NOTE_FEED_BASE_PATH \},\s*'calendar',\s*'open-unscheduled-tasks',\s*\]/);

  assert.match(feedSource, /file\.path == this\.file\.path/);
  assert.match(feedSource, /views:\s*\n\s*- type: tps-list/);
  assert.match(feedSource, /name: Daily note/);
  assert.match(feedSource, /^\s+createAction: default\s*$/m);
  assert.doesNotMatch(feedSource, /createCommandId:/);
  assert.match(feedSource, /filters:\s*\n\s*or:\s*\n\s*- kind == "task"\s*\n\s*- kind == "bullet"/);
  assert.match(constantsSource, /commandId: 'tps-global-context-menu:capture-to-home-note'/);
  assert.doesNotMatch(constantsSource, /commandId: 'tps-health:/);
  assert.doesNotMatch(constantsSource, /'food-tracker'|'workout-tracker'/);
});
