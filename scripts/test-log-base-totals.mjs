import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/views/log-base-totals.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('TPS Table totals position normalizes persisted values safely', async () => {
  const { normalizeTotalsRowPosition } = await loadModule();
  assert.equal(normalizeTotalsRowPosition('top'), 'top');
  assert.equal(normalizeTotalsRowPosition('BOTTOM'), 'bottom');
  assert.equal(normalizeTotalsRowPosition('unexpected'), 'off');
  assert.equal(normalizeTotalsRowPosition(null), 'off');
});

test('TPS Table totals sum strict numeric columns and retain a label column', async () => {
  const { calculateTpsTableTotals } = await loadModule();
  const result = calculateTpsTableTotals([
    { key: 'food', values: ['Eggs', 'Toast'] },
    { key: 'cal', values: ['131', '90'] },
    { key: 'protein', values: ['12.6', '5'] },
    { key: 'amount', values: ['1,000.25', '2.5'] },
  ]);
  assert.equal(result.labelKey, 'food');
  assert.deepEqual(Object.fromEntries(result.values), { cal: '221', protein: '17.6', amount: '1002.75' });
});

test('TPS Table totals reject mixed data and metadata-like numeric columns', async () => {
  const { calculateTpsTableTotals } = await loadModule();
  const result = calculateTpsTableTotals([
    { key: 'qty', values: ['1', '', '2'] },
    { key: 'price', values: ['10', 'unknown', '20'] },
    { key: 'completedDate', values: ['20260712', '20260713'] },
    { key: 'lineNumber', values: ['4', '8'] },
    { key: 'line.number', values: ['4', '8'] },
    { key: 'line.level', values: ['1', '2'] },
    { key: 'file.size', values: ['100', '200'] },
    { key: 'foodId', values: ['101', '102'] },
  ]);
  assert.deepEqual(Object.fromEntries(result.values), { qty: '3' });
});
