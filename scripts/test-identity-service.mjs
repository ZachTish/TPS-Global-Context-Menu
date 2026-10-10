import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('GCM exposes the TPS identity service through the plugin API', () => {
  const service = read('src/services/tps-identity-service.ts');
  const api = read('src/plugin-api.ts');
  const shared = read('src/services/shared/index.ts');
  assert.match(service, /get internalIdKey\(\): string/);
  assert.match(service, /get externalIdKey\(\): string/);
  assert.match(service, /buildCalendarExternalId\(event: CalendarIdentityInput\)/);
  assert.match(service, /calendar:\$\{this\.normalizeCalendarUrl\(sourceUrl\)\}#\$\{this\.normalizeIdentityValue\(eventId\)\}/);
  assert.match(service, /readLegacyCalendarIdentity/);
  assert.match(api, /identity: plugin\.identityService/);
  assert.match(shared, /Object\.assign\(plugin\.identityService/);
});


async function identityOwner(settings = {}) {
  const bundled = await build({ stdin: { contents: "export { IdentityService } from './src/services/tps-identity-service';", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'obsidian', setup(builder) {
    builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'stub' }));
    builder.onLoad({ filter: /.*/u, namespace: 'stub' }, () => ({ contents: 'export class TFile {} export class Notice {}' }));
  } }] });
  const { IdentityService } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  const source = {};
  let writes = 0;
  const plugin = { settings, frontmatterMutationService: { async process(_file, mutate) { writes++; mutate(source); } } };
  return { owner: new IdentityService(plugin), source, get writes() { return writes; } };
}

test('identity owner uses id by default and follows saved physical keys without fallback reads or automatic rewriting', async () => {
  const fresh = await identityOwner();
  assert.equal(fresh.owner.internalIdKey, 'id');
  assert.equal(fresh.owner.getInternalId({ tpsId: 'historical' }), null);
  assert.equal(fresh.writes, 0);
  fresh.owner.setInternalId(fresh.source, 'stable-id');
  assert.deepEqual(fresh.source, { id: 'stable-id' });
  for (const key of ['recordIdentity', 'tpsId']) {
    const h = await identityOwner({ nativeRecordIdentityPropertyKey: key });
    h.source[key] = 'unchanged-id';
    assert.equal(h.owner.getInternalId(h.source), 'unchanged-id');
    assert.equal(await h.owner.ensureInternalId({}), 'unchanged-id');
    assert.deepEqual(h.source, { [key]: 'unchanged-id' });
    assert.equal(h.owner.getInternalId({ id: 'different-physical-key' }), null);
  }
});
