import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function importDailyNavDays() {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/daily-note-nav-days.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('Daily Note navigator day count defaults to seven and clamps persisted values to one through seven', async () => {
  const { normalizeDailyNavDayCount } = await importDailyNavDays();

  assert.equal(normalizeDailyNavDayCount(undefined), 7);
  assert.equal(normalizeDailyNavDayCount(null), 7);
  assert.equal(normalizeDailyNavDayCount(''), 7);
  assert.equal(normalizeDailyNavDayCount('not-a-number'), 7);
  assert.equal(normalizeDailyNavDayCount(0), 1);
  assert.equal(normalizeDailyNavDayCount('3'), 3);
  assert.equal(normalizeDailyNavDayCount(4.9), 4);
  assert.equal(normalizeDailyNavDayCount(12), 7);
});

test('short Daily Note navigator ranges stay contiguous and active-day centered with an even-count left bias', async () => {
  const { getDailyNavDayOffsets } = await importDailyNavDays();

  assert.deepEqual(getDailyNavDayOffsets(1, 4), [0]);
  assert.deepEqual(getDailyNavDayOffsets(2, 4), [-1, 0]);
  assert.deepEqual(getDailyNavDayOffsets(3, 4), [-1, 0, 1]);
  assert.deepEqual(getDailyNavDayOffsets(4, 4), [-2, -1, 0, 1]);
  assert.deepEqual(getDailyNavDayOffsets(5, 4), [-2, -1, 0, 1, 2]);
  assert.deepEqual(getDailyNavDayOffsets(6, 4), [-3, -2, -1, 0, 1, 2]);
});

test('the seven-day Daily Note navigator preserves the ISO Monday-Sunday week', async () => {
  const { getDailyNavDayOffsets } = await importDailyNavDays();

  assert.deepEqual(getDailyNavDayOffsets(7, 1), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(getDailyNavDayOffsets(7, 3), [-2, -1, 0, 1, 2, 3, 4]);
  assert.deepEqual(getDailyNavDayOffsets(7, 7), [-6, -5, -4, -3, -2, -1, 0]);
});

test('Daily Note navigator rendering and settings use the normalized persisted day count', () => {
  const managerSource = readFileSync(new URL('../src/handlers/daily-note-nav-manager.ts', import.meta.url), 'utf8');
  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const settingsSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');

  assert.match(managerSource, /getDailyNavDayOffsets\([\s\S]*?this\.plugin\.settings\.dailyNavDayCount/);
  assert.match(managerSource, /for \(const offset of dayOffsets\)/);
  assert.match(managerSource, /this\._currentDayCount === dayCount/);
  assert.match(mainSource, /this\.settings\.dailyNavDayCount = normalizeDailyNavDayCount\(this\.settings\.dailyNavDayCount\)/);
  assert.match(settingsSource, /\.setName\('Visible day buttons'\)/);
  assert.match(settingsSource, /\.setLimits\(1, 7, 1\)/);
});
