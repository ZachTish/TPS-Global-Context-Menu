import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

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

function createHealthApi(overrides = {}) {
  const sourceApi = {};
  return {
    apiVersion: 1,
    supportedHomeActionIds: [
      'tps-health:log-food',
      'tps-health:log-activity',
      'tps-health:start-workout',
    ],
    sourceApi,
    executeHomeAction: async () => true,
    prepareFoodDescription: async () => ({ status: 'prepared' }),
    ensureLogBase: async () => 'Health.base',
    getMetricRenderConfigs: () => [],
    isWorkoutFile: () => false,
    openFoodLogEntryMenu: async () => ({ status: 'opened' }),
    ...overrides,
  };
}

function createDescriptor(api = createHealthApi()) {
  return {
    protocolVersion: 1,
    providerPluginId: 'tps-health',
    api,
  };
}

class FakeWorkspaceEvents {
  listeners = new Map();

  on(name, callback) {
    const ref = { name, callback };
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(ref);
    this.listeners.set(name, listeners);
    return ref;
  }

  offref(ref) {
    const listeners = this.listeners.get(ref.name) ?? [];
    this.listeners.set(ref.name, listeners.filter((candidate) => candidate !== ref));
  }

  trigger(name, ...args) {
    for (const ref of [...(this.listeners.get(name) ?? [])]) ref.callback(...args);
  }
}

const exactContext = Object.freeze({
  source: 'tps-home',
  dateIso: '2026-07-12',
  dailyNotePath: 'System/Dailynotes/2026-07-12.md',
  componentId: 'food-tracker',
  basePath: 'Food Log.base',
});

test('the plugin-owned client tracks provider lifecycle once and fences disposed listeners', async () => {
  const {
    TPS_HEALTH_UI_SERVICE_EVENTS,
  } = await loadPure('../src/tps-health-ui-contract.ts');
  const { TPSHealthUiClient } = await loadPure('../src/tps-health-ui-client.ts');
  const workspace = new FakeWorkspaceEvents();
  const registeredRefs = [];
  const availability = [];
  const client = new TPSHealthUiClient({ workspace }, 'tps-global-context-menu');

  client.start(
    (ref) => registeredRefs.push(ref),
    (api) => availability.push(api),
  );
  assert.equal(registeredRefs.length, 2);
  assert.deepEqual(availability, [undefined]);

  const firstDescriptor = createDescriptor();
  workspace.trigger(TPS_HEALTH_UI_SERVICE_EVENTS.AVAILABLE, firstDescriptor);
  assert.equal(availability.length, 2);
  assert.equal(availability[1].sourceApi, firstDescriptor.api);
  workspace.trigger(TPS_HEALTH_UI_SERVICE_EVENTS.AVAILABLE, firstDescriptor);
  assert.equal(availability.length, 2);

  workspace.trigger(TPS_HEALTH_UI_SERVICE_EVENTS.UNAVAILABLE, firstDescriptor);
  assert.deepEqual(availability.slice(2), [undefined]);
  workspace.trigger(TPS_HEALTH_UI_SERVICE_EVENTS.AVAILABLE, firstDescriptor);
  assert.equal(availability.length, 3);

  const secondDescriptor = createDescriptor();
  workspace.trigger(TPS_HEALTH_UI_SERVICE_EVENTS.AVAILABLE, secondDescriptor);
  assert.equal(availability.length, 4);
  assert.equal(availability[3].sourceApi, secondDescriptor.api);

  client.dispose();
  assert.equal(availability.at(-1), undefined);
  const countAfterDispose = availability.length;
  workspace.trigger(TPS_HEALTH_UI_SERVICE_EVENTS.AVAILABLE, createDescriptor());
  assert.equal(availability.length, countAfterDispose);
  assert.equal(client.getApi(), undefined);
});

test('all three Health Home actions await the provider with the exact selected date and never need a workspace command', async () => {
  const { routeHealthUiHomeAction } = await loadPure('../src/services/health-ui-home-action-route.ts');
  const calls = [];
  const api = createHealthApi({
    async executeHomeAction(commandId, context) {
      calls.push({ commandId, context });
      return true;
    },
  });

  for (const commandId of api.supportedHomeActionIds) {
    assert.deepEqual(await routeHealthUiHomeAction(() => api, commandId, exactContext), {
      matched: true,
      status: 'handled',
      commandId,
    });
  }

  assert.deepEqual(calls, api.supportedHomeActionIds.map((commandId) => ({
    commandId,
    context: exactContext,
  })));
  assert.ok(calls.every((call) => call.context.dateIso === '2026-07-12'));
  assert.ok(calls.every((call) => call.context.dailyNotePath === 'System/Dailynotes/2026-07-12.md'));
});

test('Health Home actions fail closed for absence, false, throw, rejection, stale swap, and incomplete context', async () => {
  const { routeHealthUiHomeAction } = await loadPure('../src/services/health-ui-home-action-route.ts');
  const commandId = 'tps-health:log-activity';

  assert.deepEqual(await routeHealthUiHomeAction(() => undefined, commandId, exactContext), {
    matched: true,
    status: 'unavailable',
    commandId,
  });
  const falseApi = createHealthApi({ executeHomeAction: async () => false });
  assert.deepEqual(await routeHealthUiHomeAction(() => falseApi, commandId, exactContext), {
    matched: true,
    status: 'unavailable',
    commandId,
  });

  const thrownFailure = new Error('provider threw');
  const throwingApi = createHealthApi({ executeHomeAction: () => { throw thrownFailure; } });
  const thrown = await routeHealthUiHomeAction(() => throwingApi, commandId, exactContext);
  assert.equal(thrown.matched, true);
  assert.equal(thrown.status, 'failed');
  assert.equal(thrown.error, thrownFailure);

  const rejectedFailure = new Error('provider rejected');
  const rejectedApi = createHealthApi({ executeHomeAction: async () => { throw rejectedFailure; } });
  const rejected = await routeHealthUiHomeAction(() => rejectedApi, commandId, exactContext);
  assert.equal(rejected.matched, true);
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.error, rejectedFailure);

  let resolveExecution;
  const deferredExecution = new Promise((resolve) => { resolveExecution = resolve; });
  const staleApi = createHealthApi({ executeHomeAction: () => deferredExecution });
  const replacementApi = createHealthApi();
  let currentApi = staleApi;
  const stale = routeHealthUiHomeAction(() => currentApi, commandId, exactContext);
  currentApi = replacementApi;
  resolveExecution(true);
  assert.deepEqual(await stale, {
    matched: true,
    status: 'unavailable',
    commandId,
  });

  const validApi = createHealthApi();
  assert.deepEqual(await routeHealthUiHomeAction(() => validApi, commandId, { ...exactContext, dailyNotePath: '' }), {
    matched: true,
    status: 'unavailable',
    commandId,
  });
  assert.deepEqual(await routeHealthUiHomeAction(() => validApi, 'plugin:ordinary', exactContext), { matched: false });
});

test('Describe preserves source unless the same current provider returns prepared', async () => {
  const { prepareCurrentHealthUiFoodDescription } = await loadPure('../src/services/health-ui-food-description.ts');
  const request = { description: 'oatmeal and berries', context: exactContext };

  assert.deepEqual(await prepareCurrentHealthUiFoodDescription(() => undefined, request), { status: 'unavailable' });

  const failure = new Error('research failed');
  const failedApi = createHealthApi({ prepareFoodDescription: async () => { throw failure; } });
  const failed = await prepareCurrentHealthUiFoodDescription(() => failedApi, request);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, failure);

  let resolvePreparation;
  const deferredPreparation = new Promise((resolve) => { resolvePreparation = resolve; });
  const unloadingApi = createHealthApi({ prepareFoodDescription: () => deferredPreparation });
  let currentApi = unloadingApi;
  const pending = prepareCurrentHealthUiFoodDescription(() => currentApi, request);
  currentApi = undefined;
  resolvePreparation({ status: 'prepared' });
  assert.deepEqual(await pending, { status: 'unavailable' });

  let rejectPreparation;
  const rejectedPreparation = new Promise((_resolve, reject) => { rejectPreparation = reject; });
  const replacedApi = createHealthApi({ prepareFoodDescription: () => rejectedPreparation });
  currentApi = replacedApi;
  const rejectedPending = prepareCurrentHealthUiFoodDescription(() => currentApi, request);
  currentApi = createHealthApi();
  rejectPreparation(new Error('stale provider unloaded'));
  assert.deepEqual(await rejectedPending, { status: 'unavailable' });

  const preparedApi = createHealthApi();
  assert.deepEqual(
    await prepareCurrentHealthUiFoodDescription(() => preparedApi, request),
    { status: 'prepared' },
  );
});

test('desktop Describe keeps newer capture text when a deferred provider resolves prepared', () => {
  const homeSource = readFileSync(new URL('../src/views/home-view.ts', import.meta.url), 'utf8');
  const submitStart = homeSource.indexOf('const submit = async (task: boolean) => {');
  const preparationStart = homeSource.indexOf(
    'const preparation = await prepareCurrentHealthUiFoodDescription',
    submitStart,
  );
  const clearStart = homeSource.indexOf("runReplacement('', 'food-describe-clear')", preparationStart);
  assert.ok(submitStart >= 0 && preparationStart > submitStart && clearStart > preparationStart);

  const beforePreparation = homeSource.slice(submitStart, preparationStart);
  const submittedSource = beforePreparation.match(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*this\.getHomeCaptureSessionValue\(session\)\s*;/,
  );
  assert.ok(
    submittedSource,
    'desktop Describe must snapshot the exact submitted editor text before awaiting Health',
  );

  const submittedName = submittedSource[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const currentSource = String.raw`this\.getHomeCaptureSessionValue\(session\)`;
  const identityGuard = new RegExp(
    String.raw`if\s*\(\s*(?:${currentSource}\s*!==\s*${submittedName}|${submittedName}\s*!==\s*${currentSource})\s*\)[\s\S]{0,1000}?\breturn\b`,
  );
  assert.match(
    homeSource.slice(preparationStart, clearStart),
    identityGuard,
    'desktop Describe must leave post-submit edits intact when the deferred provider completes',
  );
});

test('mobile Describe keeps newer textarea text when a deferred provider resolves prepared', () => {
  const homeSource = readFileSync(new URL('../src/views/home-view.ts', import.meta.url), 'utf8');
  const firstSubmitStart = homeSource.indexOf('const submit = async (task: boolean) => {');
  const submitStart = homeSource.indexOf('const submit = async (task: boolean) => {', firstSubmitStart + 1);
  const preparationStart = homeSource.indexOf(
    'const preparation = await prepareCurrentHealthUiFoodDescription',
    submitStart,
  );
  const clearStart = homeSource.indexOf("textarea.value = ''", preparationStart);
  assert.ok(submitStart >= 0 && preparationStart > submitStart && clearStart > preparationStart);

  const beforePreparation = homeSource.slice(submitStart, preparationStart);
  const submittedSource = beforePreparation.match(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*textarea\.value\s*;/,
  );
  assert.ok(
    submittedSource,
    'mobile Describe must snapshot the exact submitted textarea text before awaiting Health',
  );

  const submittedName = submittedSource[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const currentSource = String.raw`textarea\.value`;
  const identityGuard = new RegExp(
    String.raw`if\s*\(\s*(?:${currentSource}\s*!==\s*${submittedName}|${submittedName}\s*!==\s*${currentSource})\s*\)[\s\S]{0,1000}?\breturn\b`,
  );
  assert.match(
    homeSource.slice(preparationStart, clearStart),
    identityGuard,
    'mobile Describe must leave post-submit edits intact when the deferred provider completes',
  );
});

test('GCM Health integration has one lifecycle owner, targeted refresh, and no private discovery', () => {
  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const homeSource = readFileSync(new URL('../src/views/home-view.ts', import.meta.url), 'utf8');
  const tableSource = readFileSync(new URL('../src/views/log-base-view.ts', import.meta.url), 'utf8');
  const panelSource = readFileSync(new URL('../src/menu/panel-builder.ts', import.meta.url), 'utf8');
  const actionSource = readFileSync(new URL('../src/services/home-component-action-service.ts', import.meta.url), 'utf8');
  const mobileOverlayTestSource = readFileSync(new URL('./test-mobile-overlay-contract.mjs', import.meta.url), 'utf8');
  const combined = [mainSource, homeSource, tableSource, panelSource, actionSource].join('\n');

  assert.match(mainSource, /private healthUiClient\?: TPSHealthUiClient/);
  assert.match(mainSource, /const lifecycleEpoch = \+\+this\.lifecycleEpoch/);
  assert.match(mainSource, /loadSettingsForLifecycle\(lifecycleEpoch\)/);
  assert.match(mainSource, /this\.healthUiClient !== healthUiClient/);
  assert.match(mainSource, /getHealthUiApi\(\): Readonly<TPSHealthUiApiSnapshot> \| undefined/);
  assert.match(mainSource, /const settings = await this\.loadSettingsForLifecycle\(lifecycleEpoch\);\s*if \(!settings \|\| !this\.isCurrentLifecycle\(lifecycleEpoch\)\) return;\s*this\.settings = settings/);
  const settingsLoadBody = mainSource.slice(
    mainSource.indexOf('private async loadSettingsForLifecycle'),
    mainSource.indexOf('private normalizeHomeComponents'),
  );
  assert.doesNotMatch(settingsLoadBody, /this\.settings/);
  assert.match(settingsLoadBody, /if \(!this\.isCurrentLifecycle\(lifecycleEpoch\)\) return null;\s*await this\.saveData\(settings\);\s*if \(!this\.isCurrentLifecycle\(lifecycleEpoch\)\) return null/);
  const refreshBody = mainSource.slice(
    mainSource.indexOf('private refreshHealthUiConsumers'),
    mainSource.indexOf('private async loadSettingsForLifecycle'),
  );
  assert.match(refreshBody, /refreshHealthActionAvailability/);
  assert.match(refreshBody, /scheduleMenus/);
  assert.doesNotMatch(refreshBody, /\.render\(|ensureLogBase|ensureDefault/);

  assert.match(tableSource, /const healthUiRoute = await this\.runHomeScopedHealthAction\(command\.id\)/);
  assert.match(tableSource, /if \(healthUiRoute !== null\) return healthUiRoute/);
  assert.match(tableSource, /__tpsTableEntry = entry/);
  assert.match(tableSource, /renderedLine: entry\.line/);
  const foodMenuStart = tableSource.indexOf('if (isFoodLogEntry(entry))');
  const foodUnavailable = tableSource.indexOf('context-menu:health-food-unavailable', foodMenuStart);
  const genericMenuStart = tableSource.indexOf('this.setActiveContextRow(row)', foodMenuStart);
  const genericSelection = tableSource.indexOf('this.applyEntryContextSelection(evt, row)', foodMenuStart);
  assert.ok(foodMenuStart >= 0 && foodUnavailable > foodMenuStart && genericMenuStart > foodUnavailable);
  assert.ok(genericSelection > foodUnavailable && genericSelection < genericMenuStart);
  assert.match(
    tableSource.slice(foodUnavailable, genericMenuStart),
    /food-log row was left unchanged[\s\S]*return;/,
  );
  const healthRouteBody = tableSource.slice(
    tableSource.indexOf('private async runHomeScopedHealthAction'),
    tableSource.indexOf('private getHomeContextHost'),
  );
  assert.match(healthRouteBody, /private async runHomeScopedHealthAction/);
  assert.match(healthRouteBody, /await routeHealthUiHomeAction/);
  assert.match(healthRouteBody, /\(\) => this\.plugin\.getHealthUiApi\(\)/);
  assert.doesNotMatch(healthRouteBody, /getLineCreateContextPath/);
  assert.match(healthRouteBody, /getExactHomeContextPath\(homeHost\)/);
  const exactPathBody = tableSource.slice(
    tableSource.indexOf('private getExactHomeContextPath'),
    tableSource.indexOf('private openEntryContextMenu'),
  );
  assert.match(exactPathBody, /homeHost\.dataset\.tpsContextPath/);
  assert.doesNotMatch(exactPathBody, /closest<HTMLElement>/);

  const desktopPrepare = homeSource.indexOf('const preparation = await prepareCurrentHealthUiFoodDescription');
  const desktopClear = homeSource.indexOf("runReplacement('', 'food-describe-clear')");
  assert.ok(desktopPrepare >= 0 && desktopClear > desktopPrepare);
  const mobilePrepare = homeSource.indexOf('const preparation = await prepareCurrentHealthUiFoodDescription', desktopPrepare + 1);
  const mobileCurrentGuard = homeSource.indexOf('if (!this.isHomeRenderCurrent(generation) || !textarea.isConnected) return;', mobilePrepare);
  const mobileClear = homeSource.indexOf("textarea.value = ''", mobilePrepare);
  assert.ok(mobilePrepare > desktopPrepare && mobileCurrentGuard > mobilePrepare && mobileClear > mobileCurrentGuard);

  for (const pattern of [
    /\.tpsHealth\b/,
    /getPlugin\?\.\(['"]tps-health['"]\)/,
    /plugins\?\.\['tps-health'\]/,
    /TPS-health \(Dev\)/,
    /openFoodLogger/,
    /openWorkoutStarter/,
    /openFoodDescriber/,
    /openFoodLogEntryMenuFromLine/,
  ]) assert.doesNotMatch(combined, pattern);
  assert.doesNotMatch(actionSource, /Object\.values\(|loadedPlugin|\.homeActions/);
  const healthActionBranch = actionSource.slice(
    actionSource.indexOf("if (action.target !== 'workspace' && isHealthUiHomeActionId"),
    actionSource.indexOf('const result = await routeHomeComponentAction'),
  );
  assert.match(healthActionBranch, /await routeHealthUiHomeAction/);
  assert.match(healthActionBranch, /\(\) => this\.plugin\.getHealthUiApi\(\)/);
  assert.doesNotMatch(healthActionBranch, /executeWorkspaceCommand|routeHomeComponentAction/);
  assert.doesNotMatch(mobileOverlayTestSource, /TPS-health \(Dev\)/);
});
