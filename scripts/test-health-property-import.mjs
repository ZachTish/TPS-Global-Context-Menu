import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/integrations/health-property-import.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleRecord = { exports: {} };
new Function('module', 'exports', compiled)(moduleRecord, moduleRecord.exports);
const { importHealthPropertyCatalog } = moduleRecord.exports;

const catalog = {
  version: 1,
  food: [{
    id: 'calories',
    key: 'calories',
    label: 'Serving calories',
    type: 'number',
    icon: 'flame',
    scope: {
      mode: 'any',
      tags: ['my/food'],
      paths: ['Health/Foods'],
      properties: [{ key: 'kind', value: 'food', operator: 'equals' }],
    },
  }],
  dailyRollups: [{
    id: 'rollup-consumedcalories',
    key: 'consumedCalories',
    label: 'Consumed calories',
    type: 'number',
    icon: 'flame',
    scope: {
      mode: 'all',
      properties: [
        { key: 'healthUpdatedAt', value: '', operator: 'exists' },
        { key: 'consumedCalories', value: '', operator: 'exists' },
      ],
    },
  }],
};

test('import adds Health fields with separate food and rollup scopes', () => {
  const result = importHealthPropertyCatalog([{ id: 'status', key: 'status' }], catalog);
  assert.equal(result.added, 2);
  assert.equal(result.updated, 0);
  assert.deepEqual(result.properties[0], { id: 'status', key: 'status' });
  assert.deepEqual(result.properties[1].scopeTags, ['my/food']);
  assert.deepEqual(result.properties[1].scopePaths, ['Health/Foods']);
  assert.deepEqual(result.properties[1].scopeProperties, [{ key: 'kind', value: 'food', operator: 'equals' }]);
  assert.equal(result.properties[1].scopeMode, 'any');
  assert.deepEqual(result.properties[2].scopeProperties, [
    { key: 'healthUpdatedAt', value: '', operator: 'exists' },
    { key: 'consumedCalories', value: '', operator: 'exists' },
  ]);
  assert.equal(result.properties[2].scopeMode, 'all');
  assert.equal(result.properties[1].showInContextMenu, false);
  assert.equal(result.properties[2].showInContextMenu, false);
});

test('import keeps every definition but defaults only actionable scoped fields into the context menu', () => {
  const nativeRecords = [
    'status',
    'priority',
    'scheduled',
    'due',
    'tags',
    'parents',
    'quantity',
    'unit',
    'calories',
    'protein',
    'activityMinutes',
  ].map((key) => ({
    id: `record-${key}`,
    key,
    label: key,
    type: key === 'tags' || key === 'parents' ? 'list' : 'text',
    scope: { mode: 'any', kinds: ['activity-entry'] },
  }));
  nativeRecords.push({
    id: 'record-unscoped-quantity',
    key: 'unscopedQuantity',
    label: 'Unscoped quantity',
    type: 'number',
    scope: { mode: 'any' },
  });

  const result = importHealthPropertyCatalog([], {
    version: 2,
    food: [],
    dailyRollups: [],
    nativeRecords,
  });

  assert.equal(result.properties.length, nativeRecords.length);
  const visibleKeys = result.properties
    .filter((property) => property.showInContextMenu)
    .map((property) => property.key);
  assert.deepEqual(visibleKeys, [
    'status',
    'priority',
    'scheduled',
    'due',
    'tags',
    'parents',
    'quantity',
    'unit',
  ]);
  assert.equal(result.properties.find((property) => property.key === 'calories').showInContextMenu, false);
  assert.equal(result.properties.find((property) => property.key === 'activityMinutes').showInContextMenu, false);
});

test('quantity and unit are context actions only when the imported definition has a real scope', () => {
  const result = importHealthPropertyCatalog([], {
    version: 2,
    food: [],
    dailyRollups: [],
    nativeRecords: [
      { id: 'quantity', key: 'quantity', label: 'Quantity', type: 'number', scope: { mode: 'any' } },
      { id: 'unit', key: 'unit', label: 'Unit', type: 'text', scope: { mode: 'any', kinds: ['food-entry'] } },
    ],
  });

  assert.equal(result.properties.find((property) => property.key === 'quantity').showInContextMenu, false);
  assert.equal(result.properties.find((property) => property.key === 'unit').showInContextMenu, true);
});

test('re-import refreshes matching keys without duplicates and retires stale imported fields', () => {
  const existing = [
    { id: 'status', key: 'status' },
    { id: 'user-calories', key: 'calories', label: 'Old calories' },
    { id: 'health-import-food-old', key: 'oldHealthKey' },
  ];
  const first = importHealthPropertyCatalog(existing, catalog);
  const second = importHealthPropertyCatalog(first.properties, catalog);
  assert.equal(first.added, 1);
  assert.equal(first.updated, 1);
  assert.equal(first.removed, 1);
  assert.equal(first.properties.filter((property) => property.key === 'calories').length, 1);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 2);
  assert.equal(second.removed, 0);
  assert.deepEqual(second.properties, first.properties);
});

test('explicit refresh applies catalog defaults to imported fields but preserves user-owned overrides', () => {
  const result = importHealthPropertyCatalog([
    {
      id: 'health-import-food-calories',
      key: 'calories',
      showInContextMenu: true,
    },
    {
      id: 'user-activity-minutes',
      key: 'activityMinutes',
      showInContextMenu: true,
    },
  ], {
    version: 2,
    food: [{
      id: 'calories', key: 'calories', label: 'Calories', type: 'number',
      scope: { mode: 'any', kinds: ['food-entry'] },
    }],
    dailyRollups: [],
    nativeRecords: [{
      id: 'activity-minutes', key: 'activityMinutes', label: 'Activity minutes', type: 'number',
      scope: { mode: 'any', kinds: ['activity-entry'] },
    }],
  });

  assert.equal(result.properties.find((property) => property.key === 'calories').showInContextMenu, false);
  assert.equal(result.properties.find((property) => property.key === 'activityMinutes').showInContextMenu, true);
});

test('version 2 native record fields merge kind scopes with an existing task field', () => {
  const result = importHealthPropertyCatalog([{
    id: 'status', key: 'status', label: 'Status', type: 'selector', scopeKinds: ['task'], options: ['todo'],
  }], {
    version: 2,
    food: [],
    dailyRollups: [],
    nativeRecords: [{
      id: 'record-status', key: 'status', label: 'Status', type: 'selector', options: ['active', 'complete'],
      scope: { mode: 'any', kinds: ['workout-session', 'activity-entry'] },
    }],
  });
  assert.equal(result.properties.length, 1);
  assert.deepEqual(result.properties[0].scopeKinds, ['workout-session', 'activity-entry', 'task']);
  assert.deepEqual(result.properties[0].options, ['active', 'complete', 'todo']);
  assert.equal(result.properties[0].showWhen, 'always');
});

test('unsupported catalogs fail before settings can be replaced', () => {
  assert.throws(() => importHealthPropertyCatalog([], { version: 3 }), /unsupported property catalog/i);
});

test('settings UI wires one explicit task and Health catalog action', () => {
  const settingsSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
  assert.match(settingsSource, /Install TPS task and Health fields/);
  assert.match(settingsSource, /installTaskRecordProperties/);
  assert.match(settingsSource, /getPropertyCatalog/);
  assert.match(settingsSource, /tps-record-properties:installed/);
});
