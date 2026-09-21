import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

// Exercise the emitted/subscribed protocol, not just the registration strings.
const { build } = await import('esbuild');
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/gcm-event-service.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'obsidian-stub', setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const normalizePath = s => s;' }));
  } }],
});
const { GcmEventService } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
function fixture() {
  const listeners = new Map();
  const workspace = {
    on(name, fn) { const ref = { name, fn }; const group = listeners.get(name) || new Set(); group.add(ref); listeners.set(name, group); return ref; },
    offref(ref) { listeners.get(ref.name)?.delete(ref); },
    trigger(name, payload) { for (const ref of [...(listeners.get(name) || [])]) ref.fn(payload); },
  };
  return { workspace, service: new GcmEventService({ app: { workspace }, manifest: { id: 'gcm' } }) };
}
for (const [emit, subscribe, legacy, canonical] of [
  ['emitFilesUpdated', 'onFilesUpdated', 'tps-gcm-files-updated', 'tps:files-updated'],
  ['emitExplicitAction', 'onExplicitAction', 'tps-gcm-explicit-action', 'tps:gcm-explicit-action'],
  ['emitCalendarRefresh', 'onCalendarRefresh', 'tps-calendar-explicit-refresh', 'tps:calendar-explicit-refresh'],
]) {
  test(`${emit}: one API delivery per action; both raw names and separate actions preserved`, () => {
    const { service, workspace } = fixture(); const deliveries = []; const raw = [];
    const dispose = service[subscribe]((paths, payload) => deliveries.push({ paths, payload }));
    workspace.on(legacy, () => raw.push('legacy')); workspace.on(canonical, () => raw.push('canonical'));
    const first = service[emit](['A.md'], { sourcePluginId: 'caller', source: 'menu' });
    assert.equal(deliveries.length, 1); assert.deepEqual(deliveries[0].payload, first);
    assert.deepEqual(raw, ['legacy', 'canonical']);
    service[emit](['A.md']); assert.equal(deliveries.length, 2, 'same-file actions are not time-window deduplicated');
    workspace.trigger(legacy, ['B.md']); workspace.trigger(canonical, { paths: ['C.md'], sourcePluginId: 'external' });
    assert.deepEqual(deliveries.map(d => d.paths), [['A.md'], ['A.md'], ['B.md'], ['C.md']]);
    dispose(); service[emit](['D.md']); assert.equal(deliveries.length, 4);
  });
}
test('nested mirrored actions and independent legacy events are all delivered exactly once', () => {
  const { service, workspace } = fixture(); const paths = [];
  service.onFilesUpdated(p => paths.push(...p));
  workspace.on('tps-gcm-files-updated', p => {
    if (p[0] !== 'outer.md') return;
    service.emitFilesUpdated(['inner.md']);
    workspace.trigger('tps-gcm-files-updated', ['independent.md']);
  });
  service.emitFilesUpdated(['outer.md']);
  assert.deepEqual(paths, ['inner.md', 'independent.md', 'outer.md']);
});
