import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('GCM exposes the TPS identity service through the plugin API', () => {
  const service = read('src/services/tps-identity-service.ts');
  const api = read('src/plugin-api.ts');
  const shared = read('src/services/shared/index.ts');
  assert.match(service, /readonly internalIdKey = 'tpsId'/);
  assert.match(service, /readonly externalIdKey = 'externalId'/);
  assert.match(service, /buildCalendarExternalId\(event: CalendarIdentityInput\)/);
  assert.match(service, /calendar:\$\{this\.normalizeCalendarUrl\(sourceUrl\)\}#\$\{this\.normalizeIdentityValue\(eventId\)\}/);
  assert.match(service, /readLegacyCalendarIdentity/);
  assert.match(api, /identity: plugin\.identityService/);
  assert.match(shared, /Object\.assign\(plugin\.identityService/);
});
