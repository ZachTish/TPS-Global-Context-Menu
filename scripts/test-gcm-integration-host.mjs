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

class FakeWorkspaceEvents {
  constructor() {
    this.listeners = new Map();
    this.eventLog = [];
    this.failOn = false;
    this.failOffref = false;
  }

  on(name, callback) {
    if (this.failOn) throw new Error('listener creation failed');
    const ref = { name, callback };
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(ref);
    this.listeners.set(name, listeners);
    return ref;
  }

  offref(ref) {
    if (this.failOffref) throw new Error('listener removal failed');
    const listeners = this.listeners.get(ref.name) ?? [];
    this.listeners.set(ref.name, listeners.filter((candidate) => candidate !== ref));
  }

  trigger(name, ...args) {
    this.eventLog.push({ name, args });
    for (const ref of [...(this.listeners.get(name) ?? [])]) ref.callback(...args);
  }

  listenerCount(name) {
    return (this.listeners.get(name) ?? []).length;
  }
}

function createLogger() {
  const entries = [];
  return {
    entries,
    logger: {
      warn(event, details) {
        entries.push({ level: 'warn', event, details });
      },
      flow(event, details) {
        entries.push({ level: 'flow', event, details });
      },
    },
  };
}

function guardedApi(assertCurrent, overrides = {}) {
  return {
    apiVersion: 1,
    registerExternalAction() {
      assertCurrent();
      return () => undefined;
    },
    async openFile() {
      assertCurrent();
      return { status: 'opened' };
    },
    async startNoteTimer() {
      assertCurrent();
      return { status: 'started' };
    },
    async stopNoteTimerForFile() {
      assertCurrent();
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

const action = Object.freeze({
  id: 'food-log',
  pluginId: 'tps-health',
  order: 15,
  icon: 'apple',
  label: 'Log food',
  display: 'icon-only',
  title: 'Log food',
  isVisible: async () => true,
  onClick: async () => undefined,
});

async function loadHostFixture() {
  const contract = await loadPure('../src/tps-gcm-integration-contract.ts');
  const { TPSGcmIntegrationHost } = await loadPure('../src/tps-gcm-integration-host.ts');
  const workspace = new FakeWorkspaceEvents();
  const logging = createLogger();
  const host = new TPSGcmIntegrationHost({ workspace }, logging.logger);
  return { contract, TPSGcmIntegrationHost, workspace, logging, host };
}

function requestDescriptor(workspace, events, overrides = {}) {
  let accepted;
  workspace.trigger(events.REQUEST, {
    protocolVersion: 1,
    consumerPluginId: 'tps-health',
    accept(descriptor) {
      accepted = descriptor;
    },
    ...overrides,
  });
  return accepted;
}

test('host publishes one exact descriptor, services requests, withdraws, and replaces in order', async () => {
  const { contract, workspace, logging, host } = await loadHostFixture();
  const events = contract.TPS_GCM_INTEGRATION_SERVICE_EVENTS;
  const available = [];
  const unavailable = [];
  const registeredRefs = [];
  workspace.on(events.AVAILABLE, (descriptor) => available.push(descriptor));
  workspace.on(events.UNAVAILABLE, (descriptor) => unavailable.push(descriptor));

  const first = host.publish(
    (assertCurrent) => guardedApi(assertCurrent),
    (ref) => registeredRefs.push(ref),
  );
  assert.ok(first);
  assert.equal(host.getDescriptor(), first);
  assert.deepEqual(available, [first]);
  assert.deepEqual(unavailable, []);
  assert.equal(registeredRefs.length, 1);
  assert.equal(workspace.listenerCount(events.REQUEST), 1);
  assert.equal(requestDescriptor(workspace, events), first);

  let malformedAccepted = 0;
  requestDescriptor(workspace, events, {
    protocolVersion: 2,
    accept() {
      malformedAccepted += 1;
    },
  });
  assert.equal(malformedAccepted, 0);

  assert.doesNotThrow(() => requestDescriptor(workspace, events, {
    accept() {
      throw new Error('hostile consumer accept');
    },
  }));
  assert.ok(logging.entries.some((entry) => entry.event === 'request:accept-failed'));
  assert.equal(requestDescriptor(workspace, events), first);

  const second = host.publish((assertCurrent) => guardedApi(assertCurrent));
  assert.ok(second);
  assert.notEqual(second, first);
  assert.deepEqual(available, [first, second]);
  assert.deepEqual(unavailable, [first]);
  assert.equal(workspace.listenerCount(events.REQUEST), 1);
  assert.equal(requestDescriptor(workspace, events), second);

  host.withdraw('unload');
  host.withdraw('unload');
  assert.equal(host.getDescriptor(), undefined);
  assert.deepEqual(unavailable, [first, second]);
  assert.equal(workspace.listenerCount(events.REQUEST), 0);
  assert.equal(requestDescriptor(workspace, events), undefined);
});

test('replaced and withdrawn APIs reject new and in-flight work', async () => {
  const { host } = await loadHostFixture();
  let releaseOpen;
  const opening = new Promise((resolve) => {
    releaseOpen = resolve;
  });
  const first = host.publish((assertCurrent) => guardedApi(assertCurrent, {
    async openFile() {
      assertCurrent();
      await opening;
      assertCurrent();
      return { status: 'opened' };
    },
  }));
  const firstApi = first.api;
  const inFlight = firstApi.openFile(openRequest);

  const second = host.publish((assertCurrent) => guardedApi(assertCurrent));
  releaseOpen();
  await assert.rejects(inFlight, /GCM Integration API is unavailable/i);
  await assert.rejects(firstApi.openFile(openRequest), /GCM Integration API is unavailable/i);
  assert.throws(() => firstApi.registerExternalAction(action), /GCM Integration API is unavailable/i);
  assert.deepEqual(await second.api.openFile(openRequest), { status: 'opened' });

  host.withdraw('unload');
  await assert.rejects(second.api.openFile(openRequest), /GCM Integration API is unavailable/i);
  assert.throws(() => second.api.registerExternalAction(action), /GCM Integration API is unavailable/i);
});

test('listener setup failure rolls back and a physically retained listener stays epoch-inert', async () => {
  const { contract, workspace, host } = await loadHostFixture();
  const events = contract.TPS_GCM_INTEGRATION_SERVICE_EVENTS;

  assert.throws(() => host.publish(
    (assertCurrent) => guardedApi(assertCurrent),
    () => {
      workspace.failOffref = true;
      throw new Error('host registration rejected');
    },
  ), /host registration rejected/);
  assert.equal(host.getDescriptor(), undefined);
  assert.equal(workspace.listenerCount(events.REQUEST), 1, 'the fake intentionally retained the failed listener');
  let accepted = 0;
  workspace.trigger(events.REQUEST, {
    protocolVersion: 1,
    consumerPluginId: 'tps-health',
    accept() {
      accepted += 1;
    },
  });
  assert.equal(accepted, 0, 'epoch invalidation must fence a listener that could not be removed');

  workspace.failOffref = false;
  workspace.failOn = true;
  assert.throws(() => host.publish((assertCurrent) => guardedApi(assertCurrent)), /listener creation failed/);
  assert.equal(host.getDescriptor(), undefined);
});

test('reentrant registration, availability, and request callbacks cannot leave a half-published host', async () => {
  const registrationFixture = await loadHostFixture();
  const registrationEvents = registrationFixture.contract.TPS_GCM_INTEGRATION_SERVICE_EVENTS;
  const registrationResult = registrationFixture.host.publish(
    (assertCurrent) => guardedApi(assertCurrent),
    () => registrationFixture.host.withdraw('unload'),
  );
  assert.equal(registrationResult, undefined);
  assert.equal(registrationFixture.host.getDescriptor(), undefined);
  assert.equal(registrationFixture.workspace.listenerCount(registrationEvents.REQUEST), 0);

  const availabilityFixture = await loadHostFixture();
  const availabilityEvents = availabilityFixture.contract.TPS_GCM_INTEGRATION_SERVICE_EVENTS;
  availabilityFixture.workspace.on(availabilityEvents.AVAILABLE, () => {
    availabilityFixture.host.withdraw('unload');
  });
  const availabilityResult = availabilityFixture.host.publish(
    (assertCurrent) => guardedApi(assertCurrent),
  );
  assert.equal(availabilityResult, undefined);
  assert.equal(availabilityFixture.host.getDescriptor(), undefined);
  assert.equal(availabilityFixture.workspace.listenerCount(availabilityEvents.REQUEST), 0);

  const requestFixture = await loadHostFixture();
  const requestEvents = requestFixture.contract.TPS_GCM_INTEGRATION_SERVICE_EVENTS;
  const descriptor = requestFixture.host.publish((assertCurrent) => guardedApi(assertCurrent));
  let acceptedDescriptor;
  requestFixture.workspace.trigger(requestEvents.REQUEST, {
    protocolVersion: 1,
    consumerPluginId: 'tps-health',
    accept(value) {
      acceptedDescriptor = value;
      requestFixture.host.withdraw('unload');
    },
  });
  assert.equal(acceptedDescriptor, descriptor);
  assert.equal(requestFixture.host.getDescriptor(), undefined);
  assert.equal(requestFixture.workspace.listenerCount(requestEvents.REQUEST), 0);
});

test('host remains published when availability listeners throw and still withdraws when unavailable listeners throw', async () => {
  const { contract, workspace, logging, host } = await loadHostFixture();
  const events = contract.TPS_GCM_INTEGRATION_SERVICE_EVENTS;
  workspace.on(events.AVAILABLE, () => {
    throw new Error('hostile available listener');
  });
  workspace.on(events.UNAVAILABLE, () => {
    throw new Error('hostile unavailable listener');
  });

  const descriptor = host.publish((assertCurrent) => guardedApi(assertCurrent));
  assert.ok(descriptor);
  assert.equal(host.getDescriptor(), descriptor);
  assert.ok(logging.entries.some((entry) => entry.event === 'available:listener-failed'));

  assert.doesNotThrow(() => host.withdraw('unload'));
  assert.equal(host.getDescriptor(), undefined);
  assert.equal(workspace.listenerCount(events.REQUEST), 0);
  assert.ok(logging.entries.some((entry) => entry.event === 'unavailable:listener-failed'));
});

test('source hardening keeps effects conservative, disposal identity-safe, and callback rejection owned', () => {
  const mainSource = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
  const menuSource = readFileSync(
    fileURLToPath(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url)),
    'utf8',
  );
  const apiSource = readFileSync(
    fileURLToPath(new URL('../src/tps-gcm-integration-api.ts', import.meta.url)),
    'utf8',
  );
  const timeTrackingSource = readFileSync(
    fileURLToPath(new URL('../src/services/time-tracking-service.ts', import.meta.url)),
    'utf8',
  );

  assert.match(mainSource, /const registration = \{ \.\.\.action, id, pluginId \};/);
  assert.match(mainSource, /createGcmExternalActionRegistrationKey\(pluginId, id\)/);
  assert.match(mainSource, /this\.externalActionRegistrations\.get\(key\) !== registration/);
  assert.match(mainSource, /this\.externalActionRegistrations\.delete\(key\)/);
  assert.match(mainSource, /display: action\.display/);
  assert.match(mainSource, /action\.isVisible\?\.\(\{ filePath: file\.path, placement \}\)/);
  assert.match(mainSource, /await action\.onClick\(\{ filePath: file\.path, placement \}\)/);
  assert.match(mainSource, /return createTPSGcmIntegrationApi\(\{/);
  assert.match(mainSource, /getTimerSessionsById: \(sessionId\) => this\.timeTrackingService\.getTimerSessionsById\(sessionId\)/);
  assert.match(mainSource, /sessionId,\s+startedAt,\s+sourcePathSnapshot: requestedPath,\s+\}\)/);
  assert.match(mainSource, /stopActiveNoteTimerByIdForPath\(path, sessionId, endedAt\)/);
  assert.doesNotMatch(mainSource, /getActiveTimersForFile\(file\)/);
  assert.doesNotMatch(mainSource, /stopActiveTimerForFile\(file/);

  assert.match(apiSource, /let timerOperationTail: Promise<void> = Promise\.resolve\(\)/);
  assert.match(apiSource, /GCM note-timer cleanup requires an exact session identity/);
  assert.match(apiSource, /candidate\.id === selected\.id/);
  assert.match(apiSource, /selected\.targetType !== 'note'/);
  assert.match(apiSource, /endedAtMillis <= startedAt/);
  assert.match(apiSource, /endedAtMillis > now \+ TPS_GCM_TIMER_END_FUTURE_SKEW_MS/);
  assert.match(apiSource, /could not confirm whether the file-open effect completed/);
  assert.match(timeTrackingSource, /storedSessions\.length !== 1/);
  assert.match(timeTrackingSource, /includeIgnoredStorage: true,\s+requireFreshContent: true/);
  assert.match(timeTrackingSource, /candidate\.targetId !== stored\.record\.targetId/);
  assert.match(timeTrackingSource, /if \(!storageChanged \|\| !proposedUpdate\) return null/);
  assert.match(timeTrackingSource, /if \(!stored\) \{\s+new Notice\('Time tracking could not confirm the timer write\.'/);
  assert.match(timeTrackingSource, /throw new Error\(`Time tracking could not read authoritative storage:/);
  assert.match(timeTrackingSource, /const exactTargetFile = await this\.findNoteByTpsId\(stored\.record\.targetId, true\)/);
  assert.match(timeTrackingSource, /actualTargetId !== expectedTargetId/);
  assert.match(timeTrackingSource, /if \(match\) return null/);
  assert.match(timeTrackingSource, /const identityFile = await this\.findNoteByTpsId\(record\.targetId\)/);

  assert.match(menuSource, /Promise\.resolve\(action\.onClick\(context\)\)\.catch\(\(error\) =>/);
  assert.match(menuSource, /External action rejected/);
  assert.match(menuSource, /External action threw/);
  assert.match(menuSource, /error: logger\.errorSummary\(error\)/);
  assert.doesNotMatch(menuSource, /void action\.onClick\(context\);/);
});
