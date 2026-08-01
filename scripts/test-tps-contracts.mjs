import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/tps-contracts.ts', import.meta.url), 'utf8');

function hasExportedValue(key, value) {
  const pattern = new RegExp(`${key}:\\s*["']${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`);
  return pattern.test(source);
}

test('shared TPS contract exports stable namespaced events', () => {
  assert.equal(hasExportedValue('CONTROLLER_SETTINGS_CHANGED', 'tps:controller-settings-changed'), true);
  assert.equal(hasExportedValue('CALENDAR_SYNC_COMPLETED', 'tps:calendar-sync-completed'), true);
  assert.equal(hasExportedValue('FILES_UPDATED', 'tps:files-updated'), true);
  assert.equal(hasExportedValue('GCM_API_REQUEST', 'tps:gcm-api-request'), true);
  assert.equal(hasExportedValue('GCM_API_CHANGED', 'tps:gcm-api-changed'), true);
  assert.equal(hasExportedValue('GCM_EXPLICIT_ACTION', 'tps:gcm-explicit-action'), true);
  assert.equal(hasExportedValue('CALENDAR_EXPLICIT_REFRESH', 'tps:calendar-explicit-refresh'), true);
});

test('GCM API lifecycle publishes exact available and unavailable contract versions', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /emitGcmApiChanged\(available:[\s\S]{0,1400}source:\s*['"]tps-global-context-menu['"][\s\S]{0,500}api,[\s\S]{0,500}formulasVersion:[\s\S]{0,500}lineMetadataVersion:[\s\S]{0,500}entityIndexVersion:[\s\S]{0,500}configurationVersion:[\s\S]{0,500}taskLinesVersion:[\s\S]{0,500}taskCheckboxesVersion:/u);
  assert.match(main, /setupPluginApi\(this\);[\s\S]{0,500}workspace\.on\(TPS_EVENTS\.GCM_API_REQUEST[\s\S]{0,500}emitGcmApiChanged\(true\)/u);
  assert.match(main, /delete \(this as any\)\.api;[\s\S]{0,300}emitGcmApiChanged\(false\)/u);
});

test('GCM public capability surface owns cross-plugin configuration and task interactions', () => {
  const api = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
  const shared = readFileSync(new URL('../src/services/shared/index.ts', import.meta.url), 'utf8');
  assert.match(api, /configuration:\s*\{[\s\S]{0,1500}version:\s*1,[\s\S]{0,1500}isInlinePropertyAllowed:[\s\S]{0,1500}getParentLinkPolicy:/u);
  assert.match(api, /taskLines:\s*\{[\s\S]{0,1500}version:\s*1,[\s\S]{0,1500}handleContextMenu:[\s\S]{0,1500}openQuickEditorForElement:/u);
  assert.match(api, /taskCheckboxes:\s*\{[\s\S]{0,1500}version:\s*1,[\s\S]{0,1500}getMappings:[\s\S]{0,1500}stateForStatus:[\s\S]{0,1500}statusForState:/u);
  assert.doesNotMatch(api, /taskCheckboxes:[\s\S]{0,2000}return plugin\.settings\.linkedSubitemCheckboxMappings/u);
  assert.match(shared, /getChildKeys:\s*\(\):\s*string\[\][\s\S]{0,500}plugin\.settings\.childLinkFrontmatterKey[\s\S]{0,500}['"]parentOf['"]/u);
});

test('shared TPS contract keeps legacy aliases for migration', () => {
  assert.equal(hasExportedValue('GCM_FILES_UPDATED', 'tps-gcm-files-updated'), true);
  assert.equal(hasExportedValue('GCM_EXPLICIT_ACTION', 'tps-gcm-explicit-action'), true);
  assert.equal(hasExportedValue('CALENDAR_SETTINGS_CHANGED', 'tps-calendar-settings-changed'), true);
  assert.equal(hasExportedValue('CALENDAR_EXPLICIT_REFRESH', 'tps-calendar-explicit-refresh'), true);
});

test('shared notifier API includes non-sending dry-run preparation', () => {
  assert.match(source, /dryRunMessage\?: \(text: string, file\?: unknown, title\?: string\) => unknown/);
});
