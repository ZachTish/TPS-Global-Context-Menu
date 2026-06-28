import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('GCM event service owns shared event emission', () => {
  const service = read('src/services/gcm-event-service.ts');
  assert.match(service, /TPS_LEGACY_EVENTS\.GCM_FILES_UPDATED/);
  assert.match(service, /TPS_EVENTS\.FILES_UPDATED/);
  assert.match(service, /TPS_LEGACY_EVENTS\.GCM_EXPLICIT_ACTION/);
  assert.match(service, /TPS_EVENTS\.GCM_EXPLICIT_ACTION/);
  assert.match(service, /TPS_LEGACY_EVENTS\.CALENDAR_SETTINGS_CHANGED/);
  assert.match(service, /TPS_EVENTS\.CALENDAR_SETTINGS_CHANGED/);
});

test('GCM internal callers delegate shared events through the event service', () => {
  const files = [
    'src/services/bulk-edit-service.ts',
    'src/services/frontmatter-mutation-service.ts',
    'src/services/shared/status-service.ts',
    'src/services/notebook-navigator-rule-service.ts',
    'src/services/time-tracking-service.ts',
    'src/menu/menu-builder.ts',
    'src/events/register-events.ts',
    'src/plugin-api.ts',
  ];

  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /TPS_LEGACY_EVENTS\.GCM_FILES_UPDATED/, file);
    assert.doesNotMatch(source, /TPS_EVENTS\.FILES_UPDATED/, file);
    assert.doesNotMatch(source, /TPS_LEGACY_EVENTS\.GCM_EXPLICIT_ACTION/, file);
    assert.doesNotMatch(source, /TPS_EVENTS\.GCM_EXPLICIT_ACTION/, file);
  }

  assert.match(read('src/plugin-api.ts'), /plugin\.eventService\.emitFilesUpdated/);
  assert.match(read('src/plugin-api.ts'), /plugin\.eventService\.emitExplicitAction/);
  assert.match(read('src/events/register-events.ts'), /plugin\.eventService\.onFilesUpdated/);
});

test('GCM status service exposes active and inactive status classification', () => {
  const constants = read('src/constants.ts');
  const types = read('src/types.ts');
  const statusService = read('src/services/shared/status-service.ts');
  const settingsTab = read('src/settings-tab.ts');

  assert.match(constants, /activeStatusValues: \['todo', 'working', 'holding'\]/);
  assert.match(types, /activeStatusValues: string\[\]/);
  assert.match(statusService, /getActiveStatuses\(\): string\[\]/);
  assert.match(statusService, /isActiveStatus\(raw: unknown\): boolean/);
  assert.match(statusService, /getInactiveStatuses\(\): string\[\]/);
  assert.match(statusService, /const active = new Set\(this\.getActiveStatuses\(\)\)/);
  assert.match(statusService, /if \(active\.has\(status\)\) continue;/);
  assert.match(settingsTab, /Active Status Values/);
});
