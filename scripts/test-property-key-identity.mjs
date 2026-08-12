import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

async function importModule(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    external: ['obsidian'],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const identity = await importModule('../src/utils/property-key-identity.ts');
const logLines = await importModule('../src/views/log-line-utils.ts');
const taskDrop = await importModule('../src/tps-list/task-drop-utils.ts');
const settingsSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

test('property identity ignores only case and edge whitespace', () => {
  assert.equal(identity.propertyKeysEqual(' Client-ID ', 'client-id'), true);
  assert.equal(identity.propertyKeysEqual('Client-ID', 'client_id'), false);
  assert.equal(identity.propertyKeysEqual('Client-ID', 'client id'), false);
  assert.equal(identity.propertyKeysEqual('résumé', 'RÉSUMÉ'), true);
  assert.equal(identity.propertyKeysEqual('', ''), false);
});

test('settings diagnostics preserve existing definitions while rejecting blank and exact duplicates', () => {
  const properties = [
    { key: '' },
    { key: 'Client-ID' },
    { key: 'client-id' },
    { key: 'client_id' },
    { key: 'client id' },
  ];
  const snapshot = structuredClone(properties);
  assert.deepEqual(identity.collectPropertyKeyDiagnostics(properties), [
    { code: 'blank', index: 0, key: '', duplicateIndexes: [] },
    { code: 'duplicate', index: 1, key: 'Client-ID', duplicateIndexes: [2] },
    { code: 'duplicate', index: 2, key: 'client-id', duplicateIndexes: [1] },
  ]);
  assert.deepEqual(properties, snapshot, 'diagnostics must never migrate or discard persisted keys');
  assert.equal(identity.getPropertyKeyDiagnostic(properties, 3, ' CLIENT ID ')?.code, 'duplicate');
  assert.equal(identity.getPropertyKeyDiagnostic(properties, 4, 'client.id'), null);
});

test('new custom-field defaults are unique without treating punctuation variants as duplicates', () => {
  assert.equal(identity.createUniquePropertyKey('new_prop', [
    { key: 'NEW_PROP' },
    { key: 'new_prop_2' },
    { key: 'new-prop' },
  ]), 'new_prop_3');
  assert.equal(identity.createUniquePropertyKey('new_prop', [{ key: 'new-prop' }]), 'new_prop');
});

test('custom-field settings block invalid saves and diagnose preserved legacy definitions', () => {
  assert.match(settingsSource, /createUniquePropertyKey\('new_prop', this\.plugin\.settings\.properties\)/u);
  assert.doesNotMatch(settingsSource, /key: 'new_prop', type: 'text'/u);
  assert.match(settingsSource, /getPropertyKeyDiagnostic\(this\.plugin\.settings\.properties, index, candidate\)[\s\S]*if \(diagnostic\) return;[\s\S]*prop\.key = candidate/u);
  assert.match(settingsSource, /setAttribute\('aria-invalid', diagnostic \? 'true' : 'false'\)/u);
  assert.match(mainSource, /collectPropertyKeyDiagnostics\(this\.settings\.properties\)[\s\S]*custom-property-keys:invalid[\s\S]*preserved-for-manual-repair/u);
});

test('TPS Table reads and writes punctuation-distinct inline fields independently', () => {
  const original = '- [ ] Review <!-- [Client-ID:: hyphen] [client_id:: underscore] [client.id:: dotted] -->';
  assert.deepEqual(logLines.readInlineFields(original), {
    'client-id': 'hyphen',
    client_id: 'underscore',
    'client.id': 'dotted',
  });
  assert.deepEqual(logLines.readInlineFieldCarrierValues(original, 'CLIENT-ID'), ['hyphen']);

  const updated = logLines.setLogInlineFieldValue(original, 'client-id', 'changed');
  assert.deepEqual(logLines.readInlineFields(updated), {
    'client-id': 'changed',
    client_id: 'underscore',
    'client.id': 'dotted',
  });
  assert.match(updated, /\[client_id:: underscore\]/u);
  assert.match(updated, /\[client\.id:: dotted\]/u);
});

test('TPS List repeated-carrier collection uses exact case-insensitive identity', () => {
  const fields = [
    { key: 'Client-ID', value: 'one' },
    { key: 'client-id', value: 'two' },
    { key: 'client_id', value: 'three' },
    { key: 'client id', value: 'four' },
  ];
  assert.deepEqual(identity.collectPropertyValuesByKey(fields, 'CLIENT-ID'), ['one', 'two']);
  assert.deepEqual(identity.collectPropertyValuesByKey(fields, 'client_id'), ['three']);
  assert.deepEqual(identity.collectPropertyValuesByKey(fields, 'client id'), ['four']);
});

test('TPS List task-drop cleanup never removes punctuation-distinct fields', () => {
  const source = '- [ ] Task [Client-ID:: one] [client_id:: two] [client.id:: three]';
  assert.equal(
    taskDrop.removeKanbanInlineTaskProperties(source, ['client-id']),
    '- [ ] Task [client_id:: two] [client.id:: three]',
  );
  assert.equal(
    taskDrop.updateKanbanInlineTaskPropertyText(source, 'client-id', 'changed'),
    '- [ ] Task [client_id:: two] [client.id:: three] [client-id:: changed]',
  );
});
