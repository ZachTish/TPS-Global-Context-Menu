import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const build = await esbuild.build({
  entryPoints: [
    fileURLToPath(new URL('../src/services/daily-note-home-setting-transaction.ts', import.meta.url)),
  ],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});
const transactionModule = await import(
  `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`
);
const { runDailyNoteHomeSettingTransaction } = transactionModule;

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function createOptions({ requestedValue = false, previousValue = true } = {}) {
  let generation = 1;
  let available = true;
  let setting = previousValue;
  let enabled = previousValue;
  const applyCalls = [];
  const persistSnapshots = [];
  const options = {
    requestedValue,
    previousValue,
    async applyEnabled(value) {
      applyCalls.push(value);
      enabled = value;
      return true;
    },
    getEnabled: () => enabled,
    setSetting(value) {
      setting = value;
    },
    async persist() {
      persistSnapshots.push(setting);
    },
    isCurrent: () => generation === 1,
    isAvailable: () => available,
  };
  return {
    options,
    applyCalls,
    persistSnapshots,
    get setting() { return setting; },
    get enabled() { return enabled; },
    setGeneration(value) { generation = value; },
    setAvailable(value) { available = value; },
  };
}

test('the requested preference remains provisional until runtime application succeeds', async () => {
  const harness = createOptions();
  const gate = deferred();
  harness.options.applyEnabled = async (value) => {
    harness.applyCalls.push(value);
    const applied = await gate.promise;
    if (applied) Object.defineProperty(harness, 'enabled', { value, configurable: true });
    return applied;
  };

  const transaction = runDailyNoteHomeSettingTransaction(harness.options);
  await Promise.resolve();
  assert.equal(harness.setting, true);
  assert.deepEqual(harness.persistSnapshots, []);

  gate.resolve(true);
  const result = await transaction;
  assert.equal(result.status, 'applied');
  assert.equal(result.persisted, true);
  assert.equal(harness.setting, false);
  assert.deepEqual(harness.persistSnapshots, [false]);
});

test('a save that throws after writing is compensated by a persisted runtime rollback', async () => {
  const harness = createOptions();
  let persistAttempt = 0;
  harness.options.persist = async () => {
    harness.persistSnapshots.push(harness.setting);
    persistAttempt += 1;
    if (persistAttempt === 1) throw new Error('post-write refresh failure');
  };

  const result = await runDailyNoteHomeSettingTransaction(harness.options);
  assert.equal(result.status, 'rolled-back');
  assert.equal(result.effectiveValue, true);
  assert.equal(result.persisted, true);
  assert.deepEqual(harness.applyCalls, [false, true]);
  assert.deepEqual(harness.persistSnapshots, [false, true]);
  assert.equal(harness.setting, true);
});

test('failed rollback reapplies and persists the requested runtime state', async () => {
  const harness = createOptions();
  let applyAttempt = 0;
  harness.options.applyEnabled = async (value) => {
    harness.applyCalls.push(value);
    applyAttempt += 1;
    if (applyAttempt === 2) return false;
    Object.defineProperty(harness, 'enabled', { value, configurable: true });
    return true;
  };
  let persistAttempt = 0;
  harness.options.persist = async () => {
    harness.persistSnapshots.push(harness.setting);
    persistAttempt += 1;
    if (persistAttempt === 1) throw new Error('initial save failed');
  };

  const result = await runDailyNoteHomeSettingTransaction(harness.options);
  assert.equal(result.status, 'recovered-requested');
  assert.equal(result.effectiveValue, false);
  assert.equal(result.persisted, true);
  assert.deepEqual(harness.applyCalls, [false, true, false]);
  assert.deepEqual(harness.persistSnapshots, [false, false]);
  assert.equal(harness.setting, false);
});

test('a newer toggle supersedes an in-flight transaction without an obsolete save', async () => {
  let generation = 1;
  let setting = true;
  let enabled = true;
  const firstGate = deferred();
  const persisted = [];
  const makeOptions = (requestedValue, ownGeneration, applyEnabled) => ({
    requestedValue,
    previousValue: setting,
    applyEnabled,
    getEnabled: () => enabled,
    setSetting(value) { setting = value; },
    async persist() { persisted.push(setting); },
    isCurrent: () => generation === ownGeneration,
    isAvailable: () => true,
  });

  const first = runDailyNoteHomeSettingTransaction(makeOptions(false, 1, async (value) => {
    await firstGate.promise;
    enabled = value;
    return true;
  }));
  await Promise.resolve();
  generation = 2;
  const second = runDailyNoteHomeSettingTransaction(makeOptions(true, 2, async (value) => {
    enabled = value;
    return true;
  }));
  assert.equal((await second).status, 'applied');
  firstGate.resolve();
  assert.equal((await first).status, 'stale');
  assert.equal(setting, true);
  assert.deepEqual(persisted, [true]);
});

test('a stale compensating-save rejection cannot overwrite the newer toggle result', async () => {
  const harness = createOptions();
  const compensatingSaveStarted = deferred();
  const compensatingSaveGate = deferred();
  let persistAttempt = 0;
  harness.options.persist = async () => {
    persistAttempt += 1;
    if (persistAttempt === 1) throw new Error('requested save failed');
    compensatingSaveStarted.resolve();
    await compensatingSaveGate.promise;
    throw new Error('stale compensating save failed');
  };

  const transaction = runDailyNoteHomeSettingTransaction(harness.options);
  await compensatingSaveStarted.promise;
  harness.setGeneration(2);
  compensatingSaveGate.resolve();
  const result = await transaction;
  assert.equal(result.status, 'stale');
  assert.equal(result.persisted, false);
});

test('plugin unload makes an in-flight transaction unavailable without saving or rollback scopes', async () => {
  const harness = createOptions();
  const gate = deferred();
  harness.options.applyEnabled = async (value) => {
    harness.applyCalls.push(value);
    await gate.promise;
    return true;
  };

  const transaction = runDailyNoteHomeSettingTransaction(harness.options);
  await Promise.resolve();
  harness.setAvailable(false);
  gate.resolve();
  const result = await transaction;
  assert.equal(result.status, 'unavailable');
  assert.equal(harness.setting, true);
  assert.deepEqual(harness.persistSnapshots, []);
  assert.deepEqual(harness.applyCalls, [false]);
});
