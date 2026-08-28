import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const controllerSource = readFileSync(
  new URL('../src/menu/menu-controller.ts', import.meta.url),
  'utf8',
);

async function loadNavigationModule() {
  const result = await build({
    entryPoints: [
      fileURLToPath(
        new URL(
          '../src/services/notebook-navigator-tag-navigation.ts',
          import.meta.url,
        ),
      ),
    ],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  );
}

function navigatorPlugin(calls, result = true, list = undefined) {
  const navigation = {
    async navigateToTag(tag) {
      assert.equal(this, navigation);
      calls.push(tag);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return {
    api: {
      navigation,
      list,
    },
  };
}

function appWithPlugins(plugins) {
  return {
    plugins: {
      plugins,
      getPlugin(pluginId) {
        return plugins[pluginId] ?? null;
      },
    },
  };
}

test('GCM tag search delegates through the shared TPS-first navigator chain', () => {
  assert.match(
    controllerSource,
    /import\s*\{[\s\S]*?navigateTagWithNotebookNavigator[\s\S]*?\}\s*from '\.\.\/services\/notebook-navigator-tag-navigation';/u,
  );
  assert.match(
    controllerSource,
    /triggerTagSearch\(tag: string\): void \{[\s\S]*?navigateTagWithNotebookNavigator\(this\.app as any, cleanTag/u,
  );
  assert.doesNotMatch(
    controllerSource,
    /triggerTagSearch\(tag: string\): void \{[\s\S]*?getPlugin\?\.\('notebook-navigator'\)/u,
  );
  assert.match(
    controllerSource,
    /navigateTagWithNotebookNavigator\([\s\S]*?\.then\([\s\S]*?\.catch\(\(error: unknown\) => \{/u,
  );
});

test('TPS Notebook Navigator wins when both navigators are ready', async () => {
  const {
    navigateTagWithNotebookNavigator,
    TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID,
  } = await loadNavigationModule();
  const tpsCalls = [];
  const upstreamCalls = [];
  const clearCalls = [];
  const list = {
    setSearch(value) {
      assert.equal(this, list);
      clearCalls.push(value);
      return true;
    },
  };
  const result = await navigateTagWithNotebookNavigator(
    appWithPlugins({
      'tps-notebook-navigator': navigatorPlugin(tpsCalls, true, list),
      'notebook-navigator': navigatorPlugin(upstreamCalls),
    }),
    'qa/route',
  );

  assert.equal(result, TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID);
  assert.deepEqual(tpsCalls, ['qa/route']);
  assert.deepEqual(upstreamCalls, []);
  assert.deepEqual(clearCalls, [null]);
});

test('upstream Notebook Navigator remains compatible when TPS is absent', async () => {
  const {
    navigateTagWithNotebookNavigator,
    UPSTREAM_NOTEBOOK_NAVIGATOR_PLUGIN_ID,
  } = await loadNavigationModule();
  const upstreamCalls = [];
  const result = await navigateTagWithNotebookNavigator(
    appWithPlugins({
      'notebook-navigator': navigatorPlugin(upstreamCalls),
    }),
    'qa/route',
  );

  assert.equal(result, UPSTREAM_NOTEBOOK_NAVIGATOR_PLUGIN_ID);
  assert.deepEqual(upstreamCalls, ['qa/route']);
});

test('TPS rejection fails open to upstream and reports only the failed route', async () => {
  const {
    navigateTagWithNotebookNavigator,
    UPSTREAM_NOTEBOOK_NAVIGATOR_PLUGIN_ID,
  } = await loadNavigationModule();
  const tpsCalls = [];
  const upstreamCalls = [];
  const failures = [];
  const tpsError = new Error('TPS is reloading');
  const result = await navigateTagWithNotebookNavigator(
    appWithPlugins({
      'tps-notebook-navigator': navigatorPlugin(tpsCalls, tpsError),
      'notebook-navigator': navigatorPlugin(upstreamCalls),
    }),
    'qa/route',
    (failure) => failures.push(failure),
  );

  assert.equal(result, UPSTREAM_NOTEBOOK_NAVIGATOR_PLUGIN_ID);
  assert.deepEqual(tpsCalls, ['qa/route']);
  assert.deepEqual(upstreamCalls, ['qa/route']);
  assert.deepEqual(failures, [
    {
      pluginId: 'tps-notebook-navigator',
      phase: 'navigate',
      reason: 'rejected',
      error: tpsError,
    },
  ]);
});

test('false and synchronous-throw navigation results continue through the chain', async () => {
  const { navigateTagWithNotebookNavigator } = await loadNavigationModule();
  const failures = [];
  const upstreamError = new Error('upstream unavailable');
  const tpsNavigation = {
    navigateToTag() {
      return false;
    },
  };
  const upstreamNavigation = {
    navigateToTag() {
      throw upstreamError;
    },
  };
  const result = await navigateTagWithNotebookNavigator(
    appWithPlugins({
      'tps-notebook-navigator': { api: { navigation: tpsNavigation } },
      'notebook-navigator': { api: { navigation: upstreamNavigation } },
    }),
    'qa/route',
    (failure) => failures.push(failure),
  );

  assert.equal(result, null);
  assert.deepEqual(failures, [
    {
      pluginId: 'tps-notebook-navigator',
      phase: 'navigate',
      reason: 'returned-false',
    },
    {
      pluginId: 'notebook-navigator',
      phase: 'navigate',
      reason: 'rejected',
      error: upstreamError,
    },
  ]);
});

test('an installed but unready TPS plugin fails open to upstream', async () => {
  const {
    navigateTagWithNotebookNavigator,
    UPSTREAM_NOTEBOOK_NAVIGATOR_PLUGIN_ID,
  } = await loadNavigationModule();
  const upstreamCalls = [];
  const result = await navigateTagWithNotebookNavigator(
    appWithPlugins({
      'tps-notebook-navigator': { api: { navigation: {} } },
      'notebook-navigator': navigatorPlugin(upstreamCalls),
    }),
    'qa/route',
  );

  assert.equal(result, UPSTREAM_NOTEBOOK_NAVIGATOR_PLUGIN_ID);
  assert.deepEqual(upstreamCalls, ['qa/route']);
});

test('TPS filter-clear failures do not switch a successful route to upstream', async () => {
  const {
    navigateTagWithNotebookNavigator,
    TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID,
  } = await loadNavigationModule();
  const tpsCalls = [];
  const upstreamCalls = [];
  const failures = [];
  const clearError = new Error('filter API is reloading');
  const result = await navigateTagWithNotebookNavigator(
    appWithPlugins({
      'tps-notebook-navigator': navigatorPlugin(tpsCalls, true, {
        setSearch() {
          return Promise.reject(clearError);
        },
      }),
      'notebook-navigator': navigatorPlugin(upstreamCalls),
    }),
    'qa/route',
    (failure) => failures.push(failure),
  );

  assert.equal(result, TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID);
  assert.deepEqual(tpsCalls, ['qa/route']);
  assert.deepEqual(upstreamCalls, []);
  assert.deepEqual(failures, [
    {
      pluginId: 'tps-notebook-navigator',
      phase: 'clear-search',
      reason: 'rejected',
      error: clearError,
    },
  ]);
});

test('missing and false TPS filter clearing remain successful TPS routes', async () => {
  const {
    navigateTagWithNotebookNavigator,
    TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID,
  } = await loadNavigationModule();
  const missingFailures = [];
  const falseFailures = [];
  const missingResult = await navigateTagWithNotebookNavigator(
    appWithPlugins({
      'tps-notebook-navigator': navigatorPlugin([], true),
    }),
    'qa/missing',
    (failure) => missingFailures.push(failure),
  );
  const falseResult = await navigateTagWithNotebookNavigator(
    appWithPlugins({
      'tps-notebook-navigator': navigatorPlugin([], true, {
        setSearch() {
          return false;
        },
      }),
    }),
    'qa/false',
    (failure) => falseFailures.push(failure),
  );

  assert.equal(missingResult, TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID);
  assert.equal(falseResult, TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID);
  assert.deepEqual(missingFailures, [
    {
      pluginId: 'tps-notebook-navigator',
      phase: 'clear-search',
      reason: 'missing',
    },
  ]);
  assert.deepEqual(falseFailures, [
    {
      pluginId: 'tps-notebook-navigator',
      phase: 'clear-search',
      reason: 'returned-false',
    },
  ]);
});

test('no ready navigator returns unavailable without throwing', async () => {
  const { navigateTagWithNotebookNavigator } = await loadNavigationModule();
  const result = await navigateTagWithNotebookNavigator(
    appWithPlugins({}),
    'qa/route',
  );

  assert.equal(result, null);
});
