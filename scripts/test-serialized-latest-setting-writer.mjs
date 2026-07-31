import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const build = await esbuild.build({
  entryPoints: [
    fileURLToPath(new URL('../src/services/serialized-latest-setting-writer.ts', import.meta.url)),
  ],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});
const writerModule = await import(
  `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`
);
const { SerializedLatestSettingWriter } = writerModule;

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

test('a failed older selection cannot clobber a newer queued value', async () => {
  const writer = new SerializedLatestSettingWriter();
  let value = 'Original.base';
  let persistAttempt = 0;
  const firstSaveStarted = deferred();
  const firstSaveGate = deferred();
  const access = {
    get: () => value,
    set: (next) => { value = next; },
    persist: async () => {
      persistAttempt += 1;
      if (persistAttempt === 1) {
        firstSaveStarted.resolve();
        await firstSaveGate.promise;
        throw new Error('first selection failed');
      }
    },
  };

  const first = writer.write('calendar', 'A.base', access);
  await firstSaveStarted.promise;
  const second = writer.write('calendar', 'B.base', access);
  firstSaveGate.resolve();

  assert.equal(await first, 'superseded');
  assert.equal(await second, 'applied');
  assert.equal(value, 'B.base');
  assert.equal(persistAttempt, 2);
});

test('a failed latest selection rolls back to the last serialized success', async () => {
  const writer = new SerializedLatestSettingWriter();
  let value = 'Original.base';
  let persistAttempt = 0;
  const firstSaveStarted = deferred();
  const firstSaveGate = deferred();
  const access = {
    get: () => value,
    set: (next) => { value = next; },
    persist: async () => {
      persistAttempt += 1;
      if (persistAttempt === 1) {
        firstSaveStarted.resolve();
        await firstSaveGate.promise;
        return;
      }
      if (persistAttempt === 2) throw new Error('latest selection failed');
    },
  };

  const first = writer.write('calendar', 'A.base', access);
  await firstSaveStarted.promise;
  const second = writer.write('calendar', 'B.base', access);
  firstSaveGate.resolve();

  assert.equal(await first, 'superseded');
  await assert.rejects(second, /latest selection failed/);
  assert.equal(value, 'A.base');
  assert.equal(persistAttempt, 3, 'latest failure must persist its rollback');
});

test('a post-write failure persists the previous value as compensation', async () => {
  const writer = new SerializedLatestSettingWriter();
  let value = 'Original.base';
  const persisted = [];
  let persistAttempt = 0;
  const access = {
    get: () => value,
    set: (next) => { value = next; },
    persist: async () => {
      persisted.push(value);
      persistAttempt += 1;
      if (persistAttempt === 1) throw new Error('refresh failed after disk write');
    },
  };

  await assert.rejects(
    writer.write('calendar', 'Selected.base', access),
    /refresh failed after disk write/,
  );
  assert.equal(value, 'Original.base');
  assert.deepEqual(persisted, ['Selected.base', 'Original.base']);
});

test('a failed latest selection renders the last serialized success exactly once', async () => {
  const writer = new SerializedLatestSettingWriter();
  let value = 'Original.base';
  let persistAttempt = 0;
  const firstSaveStarted = deferred();
  const firstSaveGate = deferred();
  const rendered = [];
  const access = {
    get: () => value,
    set: (next) => { value = next; },
    persist: async () => {
      persistAttempt += 1;
      if (persistAttempt === 1) {
        firstSaveStarted.resolve();
        await firstSaveGate.promise;
        return;
      }
      if (persistAttempt === 2) throw new Error('latest selection failed');
    },
  };
  const selectAndRender = async (selected) => {
    try {
      const result = await writer.write('calendar', selected, access);
      if (result === 'applied') rendered.push(value);
      return result;
    } catch (error) {
      rendered.push(value);
      throw error;
    }
  };

  const first = selectAndRender('A.base');
  await firstSaveStarted.promise;
  const second = selectAndRender('B.base');
  firstSaveGate.resolve();

  assert.equal(await first, 'superseded');
  await assert.rejects(second, /latest selection failed/);
  assert.equal(value, 'A.base');
  assert.deepEqual(rendered, ['A.base']);
});

test('different setting keys do not block one another', async () => {
  const writer = new SerializedLatestSettingWriter();
  const values = { calendar: 'Old calendar.base', food: 'Old food.base' };
  const calendarGate = deferred();
  const calendarStarted = deferred();

  const calendar = writer.write('calendar', 'New calendar.base', {
    get: () => values.calendar,
    set: (value) => { values.calendar = value; },
    persist: async () => {
      calendarStarted.resolve();
      await calendarGate.promise;
    },
  });
  await calendarStarted.promise;
  const food = writer.write('food', 'New food.base', {
    get: () => values.food,
    set: (value) => { values.food = value; },
    persist: async () => {},
  });

  assert.equal(await food, 'applied');
  assert.equal(values.food, 'New food.base');
  calendarGate.resolve();
  assert.equal(await calendar, 'applied');
});
