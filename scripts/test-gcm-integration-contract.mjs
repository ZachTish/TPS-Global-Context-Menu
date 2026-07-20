import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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

function validAction(overrides = {}) {
  return {
    id: 'food-log',
    pluginId: 'tps-health',
    order: 15,
    icon: 'apple',
    label: 'Log food',
    display: 'icon-only',
    title: 'Log food',
    isVisible: async () => true,
    onClick: async () => undefined,
    ...overrides,
  };
}

function validRawApi(overrides = {}) {
  return {
    apiVersion: 1,
    registerExternalAction() {
      return () => undefined;
    },
    async openFile() {
      return { status: 'opened' };
    },
    async startNoteTimer() {
      return { status: 'started' };
    },
    async stopNoteTimerForFile() {
      return { status: 'stopped' };
    },
    ...overrides,
  };
}

const openRequest = Object.freeze({
  path: 'Health/Workouts/Strength.md',
  leafPolicy: 'reuse-current-unless-pinned',
  reveal: true,
});

const startRequest = Object.freeze({
  path: 'Health/Workouts/Strength.md',
  title: 'Strength',
  sessionId: 'gcm-workout-strength',
  startedAt: '2026-07-20T05:00:00.000Z',
});

const stopRequest = Object.freeze({
  path: 'Health/Workouts/Strength.md',
  endedAt: '2026-07-20T05:12:34.000Z',
  sessionId: 'gcm-workout-strength',
});

test('boundary parsers return frozen primitive snapshots and reject unsafe paths or timestamps', async () => {
  const contract = await loadPure('../src/tps-gcm-integration-contract.ts');

  const context = contract.parseTPSGcmExternalActionContext({
    filePath: 'Daily/2026-07-20.md',
    placement: 'bottom',
    ignored: { privateFile: true },
  });
  assert.deepEqual(context, { filePath: 'Daily/2026-07-20.md', placement: 'bottom' });
  assert.equal(Object.isFrozen(context), true);
  assert.deepEqual(Object.values(context).map((value) => typeof value), ['string', 'string']);

  const parsedOpen = contract.parseTPSGcmOpenFileRequest({ ...openRequest, ignored: true });
  const parsedStart = contract.parseTPSGcmStartNoteTimerRequest({ ...startRequest, ignored: true });
  const parsedStop = contract.parseTPSGcmStopNoteTimerRequest({ ...stopRequest, ignored: true });
  assert.deepEqual(parsedOpen, openRequest);
  assert.deepEqual(parsedStart, startRequest);
  assert.deepEqual(parsedStop, stopRequest);
  assert.equal(Object.isFrozen(parsedOpen), true);
  assert.equal(Object.isFrozen(parsedStart), true);
  assert.equal(Object.isFrozen(parsedStop), true);

  for (const path of [
    '/Health/Workout.md',
    'Health/../Workout.md',
    'Health\\Workout.md',
    'Health//Workout.md',
    'Health/Workout.base',
  ]) {
    assert.equal(contract.parseTPSGcmOpenFileRequest({ ...openRequest, path }), undefined, path);
  }
  assert.equal(contract.parseTPSGcmStopNoteTimerRequest({
    ...stopRequest,
    endedAt: '2026-07-20T00:12:34-05:00',
  }), undefined);
  assert.equal(contract.parseTPSGcmStopNoteTimerRequest({
    ...stopRequest,
    endedAt: 'not-a-date',
  }), undefined);
  assert.equal(contract.parseTPSGcmStartNoteTimerRequest({
    path: startRequest.path,
    title: startRequest.title,
  }), undefined, 'owned timer starts require an exact session identity');
  assert.equal(contract.parseTPSGcmStartNoteTimerRequest({
    ...startRequest,
    startedAt: '2026-07-20T00:00:00-05:00',
  }), undefined, 'owned timer starts require a canonical instant');
  assert.equal(contract.parseTPSGcmStartNoteTimerRequest({
    ...startRequest,
    sessionId: ' invalid ',
  }), undefined);
  assert.equal(contract.parseTPSGcmStopNoteTimerRequest({
    ...stopRequest,
    sessionId: '../wrong',
  }), undefined);
  const stopWithoutOwnership = { ...stopRequest };
  delete stopWithoutOwnership.sessionId;
  assert.equal(contract.parseTPSGcmStopNoteTimerRequest(stopWithoutOwnership), undefined);

  for (const [parser, status] of [
    [contract.parseTPSGcmOpenFileResult, 'opened'],
    [contract.parseTPSGcmStartNoteTimerResult, 'already-running'],
    [contract.parseTPSGcmStopNoteTimerResult, 'not-running'],
  ]) {
    const result = parser({ status, ignored: true });
    assert.deepEqual(result, { status });
    assert.equal(Object.isFrozen(result), true);
  }
  assert.equal(contract.parseTPSGcmOpenFileResult({ status: 'failed' }), undefined);
  assert.equal(contract.parseTPSGcmStartNoteTimerResult({ status: 'running-maybe' }), undefined);
  assert.deepEqual(contract.parseTPSGcmStopNoteTimerResult({ status: 'invalid-end' }), {
    status: 'invalid-end',
  });
  assert.equal(contract.parseTPSGcmStopNoteTimerResult({ status: 'stopped-something' }), undefined);
});

test('external action parsing requires explicit display and freezes a bounded registration snapshot', async () => {
  const contract = await loadPure('../src/tps-gcm-integration-contract.ts');
  const source = validAction();
  const parsed = contract.parseTPSGcmExternalActionRegistration(source);

  assert.ok(parsed);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(parsed.display, 'icon-only');
  assert.notEqual(parsed, source);
  assert.equal(contract.parseTPSGcmExternalActionRegistration(validAction({ display: 'text-only' })), undefined);
  const missingDisplay = validAction();
  delete missingDisplay.display;
  assert.equal(contract.parseTPSGcmExternalActionRegistration(missingDisplay), undefined);
  assert.equal(contract.parseTPSGcmExternalActionRegistration(validAction({ order: 1.5 })), undefined);
  assert.equal(contract.parseTPSGcmExternalActionRegistration(validAction({ label: ' Log food' })), undefined);
});

test('accessors, inherited capabilities, and hostile property descriptors are rejected without invocation', async () => {
  const contract = await loadPure('../src/tps-gcm-integration-contract.ts');
  let getterReads = 0;
  const accessorContext = {
    placement: 'bottom',
    get filePath() {
      getterReads += 1;
      return 'Daily/2026-07-20.md';
    },
  };
  assert.equal(contract.parseTPSGcmExternalActionContext(accessorContext), undefined);
  assert.equal(getterReads, 0);

  const inheritedContext = Object.create({
    filePath: 'Daily/2026-07-20.md',
    placement: 'bottom',
  });
  assert.equal(contract.parseTPSGcmExternalActionContext(inheritedContext), undefined);

  const accessorApi = validRawApi();
  Object.defineProperty(accessorApi, 'openFile', {
    configurable: true,
    get() {
      getterReads += 1;
      return async () => ({ status: 'opened' });
    },
  });
  assert.equal(contract.parseTPSGcmIntegrationApiSnapshot(accessorApi), undefined);
  assert.equal(getterReads, 0);

  const inheritedApi = Object.create(validRawApi());
  assert.equal(contract.parseTPSGcmIntegrationApiSnapshot(inheritedApi), undefined);

  const hostileProxy = new Proxy({}, {
    getOwnPropertyDescriptor() {
      throw new Error('hostile descriptor');
    },
  });
  assert.equal(contract.parseTPSGcmIntegrationServiceDescriptor(hostileProxy), undefined);

  const accessorResult = Object.defineProperty({}, 'status', {
    get() {
      getterReads += 1;
      return 'opened';
    },
  });
  assert.equal(contract.parseTPSGcmOpenFileResult(accessorResult), undefined);
  assert.equal(getterReads, 0);
});

test('API wrappers preserve receivers, pass primitive-only callback contexts, validate results, and dispose once', async () => {
  const contract = await loadPure('../src/tps-gcm-integration-contract.ts');
  let registeredAction;
  let disposeCalls = 0;
  const receivedRequests = [];
  let rawApi;
  rawApi = validRawApi({
    registerExternalAction(action) {
      assert.equal(this, rawApi);
      assert.equal(Object.isFrozen(action), true);
      registeredAction = action;
      return function dispose() {
        assert.equal(this, undefined);
        disposeCalls += 1;
      };
    },
    openFile(request) {
      assert.equal(this, rawApi);
      assert.equal(Object.isFrozen(request), true);
      receivedRequests.push(request);
      return { status: 'opened', privateLeaf: { id: 1 } };
    },
    startNoteTimer(request) {
      assert.equal(this, rawApi);
      assert.equal(Object.isFrozen(request), true);
      receivedRequests.push(request);
      return Promise.resolve({ status: 'already-running', privateSession: { id: 2 } });
    },
    stopNoteTimerForFile(request) {
      assert.equal(this, rawApi);
      assert.equal(Object.isFrozen(request), true);
      receivedRequests.push(request);
      return { status: 'stopped', privateSession: { id: 3 } };
    },
  });

  const api = contract.parseTPSGcmIntegrationApiSnapshot(rawApi);
  assert.ok(api);
  assert.equal(api.sourceApi, rawApi);
  assert.equal(Object.isFrozen(api), true);

  const callbackContexts = [];
  let sourceAction;
  sourceAction = validAction({
    isVisible(context) {
      assert.equal(this, sourceAction);
      assert.equal(Object.isFrozen(context), true);
      callbackContexts.push(context);
      return true;
    },
    onClick(context) {
      assert.equal(this, sourceAction);
      assert.equal(Object.isFrozen(context), true);
      callbackContexts.push(context);
      return undefined;
    },
  });
  const dispose = api.registerExternalAction(sourceAction);
  assert.equal(registeredAction.display, 'icon-only');
  const callbackInput = {
    filePath: 'Daily/2026-07-20.md',
    placement: 'bottom',
    file: { path: 'private-object-must-not-cross.md' },
  };
  assert.equal(await registeredAction.isVisible(callbackInput), true);
  await registeredAction.onClick(callbackInput);
  assert.deepEqual(callbackContexts, [
    { filePath: 'Daily/2026-07-20.md', placement: 'bottom' },
    { filePath: 'Daily/2026-07-20.md', placement: 'bottom' },
  ]);
  assert.ok(callbackContexts.every((context) => !Object.hasOwn(context, 'file')));

  assert.deepEqual(await api.openFile(openRequest), { status: 'opened' });
  assert.deepEqual(await api.startNoteTimer(startRequest), { status: 'already-running' });
  assert.deepEqual(await api.stopNoteTimerForFile(stopRequest), { status: 'stopped' });
  assert.ok(receivedRequests.every((request) => Object.isFrozen(request)));

  dispose();
  dispose();
  assert.equal(disposeCalls, 1);
});

test('hostile and receiver-sensitive thenables cannot bypass async output validation', async () => {
  const contract = await loadPure('../src/tps-gcm-integration-contract.ts');
  let hostileThenReads = 0;
  const hostileThenable = Object.defineProperty({}, 'then', {
    get() {
      hostileThenReads += 1;
      throw new Error('do not assimilate me');
    },
  });
  const hostileApi = contract.parseTPSGcmIntegrationApiSnapshot(validRawApi({
    openFile() {
      return hostileThenable;
    },
  }));
  await assert.rejects(hostileApi.openFile(openRequest), /invalid open-file result/i);
  assert.equal(hostileThenReads, 1);

  let thenable;
  thenable = {
    then(resolve) {
      assert.equal(this, thenable);
      resolve({ status: 'started', ignored: true });
    },
  };
  const receiverApi = contract.parseTPSGcmIntegrationApiSnapshot(validRawApi({
    startNoteTimer() {
      return thenable;
    },
  }));
  const started = await receiverApi.startNoteTimer(startRequest);
  assert.deepEqual(started, { status: 'started' });
  assert.equal(Object.isFrozen(started), true);

  const invalidOutputApi = contract.parseTPSGcmIntegrationApiSnapshot(validRawApi({
    stopNoteTimerForFile() {
      return { status: 'maybe-stopped' };
    },
  }));
  await assert.rejects(invalidOutputApi.stopNoteTimerForFile(stopRequest), /invalid stop-timer result/i);

  const badActionApi = contract.parseTPSGcmIntegrationApiSnapshot(validRawApi({
    registerExternalAction(action) {
      void action;
      return null;
    },
  }));
  assert.throws(() => badActionApi.registerExternalAction(validAction()), /invalid external action disposer/i);

  let registered;
  const callbackApi = contract.parseTPSGcmIntegrationApiSnapshot(validRawApi({
    registerExternalAction(action) {
      registered = action;
      return () => undefined;
    },
  }));
  callbackApi.registerExternalAction(validAction({
    isVisible() {
      return hostileThenable;
    },
    onClick() {
      return false;
    },
  }));
  await assert.rejects(
    registered.isVisible({ filePath: 'Daily/2026-07-20.md', placement: 'bottom' }),
    /invalid external action visibility result/i,
  );
  await assert.rejects(
    registered.onClick({ filePath: 'Daily/2026-07-20.md', placement: 'bottom' }),
    /invalid external action callback result/i,
  );
});

test('service descriptors and requests are exact-identity, frozen, versioned, and receiver-bound', async () => {
  const contract = await loadPure('../src/tps-gcm-integration-contract.ts');
  const rawApi = validRawApi();
  const rawDescriptor = {
    protocolVersion: 1,
    providerPluginId: 'tps-global-context-menu',
    api: rawApi,
  };
  const descriptor = contract.parseTPSGcmIntegrationServiceDescriptor(rawDescriptor);
  assert.ok(descriptor);
  assert.equal(descriptor.sourceDescriptor, rawDescriptor);
  assert.equal(descriptor.api.sourceApi, rawApi);
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.api), true);

  const created = contract.createTPSGcmIntegrationServiceDescriptor(rawApi);
  assert.equal(Object.isFrozen(created), true);
  assert.equal(Object.isFrozen(created.api), true);
  assert.equal(created.protocolVersion, 1);
  assert.equal(created.providerPluginId, 'tps-global-context-menu');

  let accepted;
  let sourceRequest;
  sourceRequest = {
    protocolVersion: 1,
    consumerPluginId: 'tps-health',
    accept(value) {
      assert.equal(this, sourceRequest);
      accepted = value;
    },
  };
  const request = contract.parseTPSGcmIntegrationServiceRequest(sourceRequest);
  assert.ok(request);
  assert.equal(Object.isFrozen(request), true);
  request.accept(created);
  assert.equal(accepted, created);

  let asyncAcceptRan = false;
  const asyncRequest = contract.parseTPSGcmIntegrationServiceRequest({
    protocolVersion: 1,
    consumerPluginId: 'async-consumer',
    async accept() {
      asyncAcceptRan = true;
      throw new Error('owned async rejection');
    },
  });
  assert.ok(asyncRequest);
  assert.throws(
    () => asyncRequest.accept(created),
    /must return undefined synchronously/i,
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(asyncAcceptRan, true);

  assert.equal(contract.parseTPSGcmIntegrationServiceDescriptor({
    ...rawDescriptor,
    protocolVersion: 2,
  }), undefined);
  assert.equal(contract.parseTPSGcmIntegrationServiceDescriptor({
    ...rawDescriptor,
    providerPluginId: 'lookalike-gcm',
  }), undefined);
  assert.equal(contract.parseTPSGcmIntegrationServiceRequest({
    ...sourceRequest,
    consumerPluginId: ' tps-health',
  }), undefined);
});
