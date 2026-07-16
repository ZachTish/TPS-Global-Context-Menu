import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/identity-migration-service.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');

test('GCM provides a non-mutating dry run for legacy calendar identity migration', () => {
  assert.match(source, /dryRunLegacyCalendarIdentityMigration/);
  assert.match(source, /readLegacyCalendarIdentity/);
  assert.match(source, /tpsIdAction: .*create/);
  assert.doesNotMatch(source, /processFrontMatter|vault\.modify|vault\.process/);
  assert.match(api, /identityMigration: plugin\.identityMigrationService/);
});
