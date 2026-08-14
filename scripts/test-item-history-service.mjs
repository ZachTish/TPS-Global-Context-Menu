import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/item-history-service.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadStoreModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/item-history-store.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const itemHistoryStoreSource = await readFile(
  fileURLToPath(new URL('../src/services/item-history-store.ts', import.meta.url)),
  'utf8',
);

function createPlugin() {
  const file = { path: 'Daily/2026-08-14.md' };
  let content = '- [ ] Ship release [priority:: high]';
  const localStorage = new Map();
  return {
    plugin: {
      manifest: { id: 'tps-global-context-menu' },
      settings: {
        enableItemHistory: true,
        itemHistoryRetentionDays: 90,
        itemHistoryMaxEntries: 25_000,
      },
      app: {
        appId: 'test-vault-app-id',
        loadLocalStorage: (key) => localStorage.get(key) ?? null,
        saveLocalStorage: (key, value) => {
          if (value == null) localStorage.delete(key);
          else localStorage.set(key, value);
        },
        vault: {
          adapter: { getBasePath: () => '/private/test-vault' },
          getName: () => 'Test Vault',
          getFileByPath: (path) => path === file.path ? file : null,
          cachedRead: async () => content,
        },
      },
    },
    file,
    localStorage,
    setContent(value) { content = value; },
  };
}

const cause = {
  kind: 'user',
  sourcePluginId: 'tps-global-context-menu',
  surface: 'task-line-context-menu',
};

test('task history records redacted field changes under a stable injected identity', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  const fixture = createPlugin();
  const store = new MemoryItemHistoryStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  await service.setup();

  const before = '- [ ] Ship release [priority:: high]';
  const handle = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: before },
  });
  assert.ok(handle);
  assert.equal(store.pending.size, 1);
  assert.doesNotMatch(JSON.stringify([...store.pending.values()]), /Ship release/u, 'pending intent must not contain raw task text');

  const after = service.ensureTaskIdentity(handle, '- [ ] Ship release [status:: working]');
  assert.match(after, /\[tpsId:: item_/u);
  fixture.setContent(after);
  await service.commitTaskMutation(handle, {
    after: { path: fixture.file.path, lineNumber: 0, rawLine: after },
    sourceDisposition: 'retained',
  });

  const events = await service.query({ path: fixture.file.path, lineNumber: 0, rawLine: after });
  assert.equal(events.length, 1);
  assert.equal(events[0].entityId, handle.entityId);
  assert.equal(events[0].cause.surface, 'task-line-context-menu');
  assert.deepEqual(events[0].changes.find((change) => change.field.toLowerCase() === 'priority'), {
    field: 'priority',
    before: { state: 'value', value: 'high' },
    after: { state: 'absent' },
  });
  assert.deepEqual(events[0].changes.find((change) => change.field.toLowerCase() === 'status'), {
    field: 'status',
    before: { state: 'absent' },
    after: { state: 'value', value: 'working' },
  });
  assert.doesNotMatch(JSON.stringify(events), /Ship release/u, 'committed history must not contain the raw task title');
  assert.deepEqual(await service.stats(), { events: 1, entities: 1, pending: 0 });
});

test('confirmed live before-state prevents stale rendered fields from being attributed to the user action', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  const fixture = createPlugin();
  const store = new MemoryItemHistoryStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  const rendered = '- [ ] Task [priority:: low] [tpsId:: item_live_before]';
  const liveBefore = '- [ ] Task [priority:: high] [tpsId:: item_live_before]';
  const after = '- [ ] Task [priority:: high] [status:: working] [tpsId:: item_live_before]';
  const handle = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 1, rawLine: rendered },
  });

  await service.commitTaskMutation(handle, {
    confirmedBefore: { path: fixture.file.path, lineNumber: 7, rawLine: liveBefore },
    after: { path: fixture.file.path, lineNumber: 7, rawLine: after },
    sourceDisposition: 'retained',
  });

  const [event] = await service.query('item_live_before');
  assert.deepEqual(event.locatorBefore, { path: fixture.file.path, lineNumber: 7 });
  assert.deepEqual(event.locatorAfter, { path: fixture.file.path, lineNumber: 7 });
  assert.deepEqual(event.changes, [{
    field: 'status',
    before: { state: 'absent' },
    after: { state: 'value', value: 'working' },
  }]);
});

test('confirmed history revisions reject conflicting identities and non-task after states', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  const fixture = createPlugin();
  const store = new MemoryItemHistoryStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  const before = '- [ ] Task [tpsId:: item_confirmed]';

  const conflicting = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: before },
  });
  await service.commitTaskMutation(conflicting, {
    confirmedBefore: {
      path: fixture.file.path,
      lineNumber: 0,
      rawLine: `${before} [subitemId:: item_other]`,
    },
    after: { path: fixture.file.path, lineNumber: 0, rawLine: `${before} [status:: working]` },
  });

  const converted = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: before },
  });
  await service.commitTaskMutation(converted, {
    confirmedBefore: { path: fixture.file.path, lineNumber: 0, rawLine: before },
    after: { path: fixture.file.path, lineNumber: 0, rawLine: 'Plain bullet [tpsId:: item_confirmed]' },
  });

  assert.deepEqual(await service.query('item_confirmed'), []);
  assert.equal(store.pending.size, 0);
});

test('renamed configured status, priority, and tags keys remain canonical allowlisted history fields', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  const fixture = createPlugin();
  fixture.plugin.settings.properties = [
    { id: 'status', key: 'phase' },
    { id: 'priority', key: 'importance' },
    { id: 'tags', key: 'topics' },
    { id: 'custom', key: 'secret-custom' },
  ];
  fixture.plugin.sharedServices = {
    status: { getStatusPropertyKey: () => 'phase' },
  };
  const store = new MemoryItemHistoryStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  const before = '- [ ] Task [phase:: queued] [importance:: low] [topics:: #alpha, #beta] [secret-custom:: private] [tpsId:: item_aliases]';
  const after = '- [ ] Task [phase:: working] [topics:: #beta, #gamma] [secret-custom:: changed-private] [tpsId:: item_aliases]';
  const handle = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: before },
  });
  await service.commitTaskMutation(handle, {
    confirmedBefore: { path: fixture.file.path, lineNumber: 0, rawLine: before },
    after: { path: fixture.file.path, lineNumber: 0, rawLine: after },
  });

  const [event] = await service.query('item_aliases');
  assert.deepEqual(event.changes.map((change) => change.field).sort(), ['priority', 'status', 'tags']);
  assert.doesNotMatch(JSON.stringify(event), /private/u);
  assert.deepEqual(event.changes.find((change) => change.field === 'priority'), {
    field: 'priority',
    before: { state: 'value', value: 'low' },
    after: { state: 'absent' },
  });
});

test('move history preserves entity identity and records source disposition and locators', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  const fixture = createPlugin();
  const store = new MemoryItemHistoryStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  const before = '- [ ] Move me [tpsId:: item_existing]';
  const handle = await service.beginTaskMutation({
    action: 'task.move',
    cause: { ...cause, surface: 'task-drag' },
    before: { path: 'Daily/2026-08-14.md', lineNumber: 4, rawLine: before },
    targetPath: 'Projects/Alpha.md',
  });
  assert.ok(handle);
  assert.equal(handle.entityId, 'item_existing');
  assert.equal(service.ensureTaskIdentity(handle, before), before);

  await service.commitTaskMutation(handle, {
    after: { path: 'Projects/Alpha.md', lineNumber: 8, rawLine: before },
    sourceDisposition: 'removed',
  });
  const [event] = await service.query('item_existing');
  assert.equal(event.action, 'task.move');
  assert.equal(event.sourceDisposition, 'removed');
  assert.deepEqual(event.locatorBefore, { path: 'Daily/2026-08-14.md', lineNumber: 4 });
  assert.deepEqual(event.locatorAfter, { path: 'Projects/Alpha.md', lineNumber: 8 });
});

test('history cursor pagination does not skip events sharing one millisecond', async () => {
  const { MemoryItemHistoryStore } = await loadStoreModule();
  const store = new MemoryItemHistoryStore();
  const occurredAt = 123_456;
  for (const eventId of ['event_a', 'event_b', 'event_c']) {
    store.events.set(eventId, {
      schemaVersion: 1,
      eventId,
      operationId: eventId,
      entityId: 'item_cursor',
      entityKind: 'task',
      action: 'task.update',
      occurredAt,
      committedAt: occurredAt,
      cause,
      changes: [],
      locatorBefore: { path: 'Inbox.md', lineNumber: 0 },
      outcome: 'committed',
    });
  }

  const first = await store.query('item_cursor', 2);
  assert.deepEqual(first.map((event) => event.eventId), ['event_c', 'event_b']);
  const second = await store.query('item_cursor', 2, first.at(-1).occurredAt, first.at(-1).eventId);
  assert.deepEqual(second.map((event) => event.eventId), ['event_a']);
});

test('task renames are recorded without persisting either title', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  const fixture = createPlugin();
  const store = new MemoryItemHistoryStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  const before = '- [ ] Confidential old title [tpsId:: item_rename]';
  const handle = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: before },
  });
  const after = '- [ ] Confidential new title [tpsId:: item_rename]';
  await service.commitTaskMutation(handle, {
    after: { path: fixture.file.path, lineNumber: 0, rawLine: after },
  });
  const [event] = await service.query('item_rename');
  assert.deepEqual(event.changes.find((change) => change.field === 'content'), {
    field: 'content',
    before: { state: 'value', value: '[changed]' },
    after: { state: 'value', value: '[changed]' },
  });
  assert.doesNotMatch(JSON.stringify({ event, pending: [...store.pending.values()] }), /Confidential/u);
});

test('pending intents and committed events serialize only allowlisted redacted task state', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  const fixture = createPlugin();
  const store = new MemoryItemHistoryStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  const before = [
    '- [ ] Do not persist this title',
    '[status:: mailto:person@private.example]',
    '[priority:: obsidian://open?vault=Private]',
    '[status:: //protocol-relative.private.example/path]',
    '[externalId:: ext-secret]',
    '[uri:: custom+private://hidden.example/path]',
    '[content:: content-secret]',
    '[title:: title-secret]',
    '[body:: body-secret]',
    '[recurrenceTaskId:: recurrence-secret]',
    '[customSecret:: arbitrary-secret]',
    '[tags:: safe, www.private.example]',
    '[tag:: [[Private Tag Note]]]',
    '#www.visible-private.example',
  ].join(' ');
  const handle = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: before },
  });
  assert.ok(handle);

  const [pending] = [...store.pending.values()];
  assert.deepEqual(pending.before, {
    checkbox: '[ ]',
    fields: {
      priority: '[redacted-url]',
      status: '[redacted-url]',
    },
    tags: ['[redacted-url]', '[redacted-link]'],
  });
  assert.doesNotMatch(
    JSON.stringify(pending),
    /Do not persist|person@|private\.example|visible-private|Private Tag Note|ext-secret|content-secret|title-secret|body-secret|recurrence-secret|arbitrary-secret|obsidian:\/\/|custom\+private:\/\//u,
  );

  const after = [
    '- [x] Another title that must stay transient',
    `[tpsId:: ${handle.entityId}]`,
    '[status:: working]',
    '[priority:: www.secret.example]',
    '[externalId:: other-external-secret]',
    '[content:: other-content-secret]',
    '[tags:: safe]',
  ].join(' ');
  await service.commitTaskMutation(handle, {
    after: { path: fixture.file.path, lineNumber: 0, rawLine: after },
    sourceDisposition: 'retained',
  });

  const [event] = await service.query(handle.entityId);
  assert.deepEqual(
    event.changes.map((change) => change.field).sort(),
    ['checkbox', 'status', 'tags'],
  );
  assert.doesNotMatch(
    JSON.stringify({ event, pending: [...store.pending.values()] }),
    /Another title|secret\.example|other-external-secret|other-content-secret|www\./u,
  );
});

test('identity races are rejected so callers can abort the pending intent without blocking content', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  const fixture = createPlugin();
  const store = new MemoryItemHistoryStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  const handle = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: '- [ ] Original task' },
  });
  assert.ok(handle);

  assert.throws(
    () => service.ensureTaskIdentity(handle, '- [ ] Replaced task [tpsId:: different-item]'),
    /identity changed before the mutation/u,
  );
  assert.throws(
    () => service.ensureTaskIdentity(
      handle,
      `- [ ] Conflicting task [tpsId:: ${handle.entityId}] [subitemId:: different-subitem]`,
    ),
    /identity changed before the mutation/u,
  );
  const adopted = service.ensureTaskIdentity(
    handle,
    `- [ ] Matching subitem [subitemId:: ${handle.entityId}]`,
  );
  assert.match(adopted, new RegExp(`\\[tpsId:: ${handle.entityId}\\]`, 'u'));

  await service.abortTaskMutation(handle);

  const sensitiveIdentity = 'https://identity.private.example/user';
  const sensitiveHandle = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: {
      path: fixture.file.path,
      lineNumber: 0,
      rawLine: `- [ ] Sensitive identity [tpsId:: ${sensitiveIdentity}]`,
    },
  });
  assert.ok(sensitiveHandle);
  assert.notEqual(sensitiveHandle.entityId, sensitiveIdentity);
  assert.doesNotMatch(JSON.stringify([...store.pending.values()]), /identity\.private\.example/u);
  assert.throws(
    () => service.ensureTaskIdentity(
      sensitiveHandle,
      `- [ ] Sensitive identity [tpsId:: ${sensitiveIdentity}]`,
    ),
    /identity changed before the mutation/u,
  );
  await service.abortTaskMutation(sensitiveHandle);

  const oversizedIdentity = `oversized_${'x'.repeat(161)}`;
  const oversizedHandle = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: {
      path: fixture.file.path,
      lineNumber: 0,
      rawLine: `- [ ] Oversized identity [subitemId:: ${oversizedIdentity}]`,
    },
  });
  assert.ok(oversizedHandle);
  assert.notEqual(oversizedHandle.entityId, oversizedIdentity);
  assert.doesNotMatch(JSON.stringify([...store.pending.values()]), new RegExp(oversizedIdentity, 'u'));
  assert.throws(
    () => service.ensureTaskIdentity(
      oversizedHandle,
      `- [ ] Oversized identity [subitemId:: ${oversizedIdentity}]`,
    ),
    /identity changed before the mutation/u,
  );
  await service.abortTaskMutation(oversizedHandle);

  assert.deepEqual(await service.stats(), { events: 0, entities: 0, pending: 0 });
});

test('public cause metadata accepts bounded tokens but cannot persist URL or whitespace payloads', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  const fixture = createPlugin();
  const store = new MemoryItemHistoryStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  const before = '- [ ] Cause validation';

  assert.equal(await service.beginTaskMutation({
    action: 'task.update',
    cause: {
      kind: 'user',
      sourcePluginId: 'https://private.example/plugin',
      surface: 'reminder-modal',
    },
    before: { path: fixture.file.path, lineNumber: 0, rawLine: before },
  }), null);
  assert.equal(await service.beginTaskMutation({
    action: 'task.update',
    cause: {
      kind: 'user',
      sourcePluginId: 'tps-controller',
      surface: 'reminder modal private payload',
    },
    before: { path: fixture.file.path, lineNumber: 0, rawLine: before },
  }), null);

  const accepted = await service.beginTaskMutation({
    action: 'task.update',
    cause: {
      kind: 'user',
      sourcePluginId: 'vendor/plugin.id',
      surface: 'reminder/modal.v2',
      commandId: 'tps-controller:open/reminder',
      interactionId: 'interaction/123.abc-xyz',
    },
    before: { path: fixture.file.path, lineNumber: 0, rawLine: before },
  });
  assert.deepEqual(accepted.cause, {
    kind: 'user',
    sourcePluginId: 'vendor/plugin.id',
    surface: 'reminder/modal.v2',
    commandId: 'tps-controller:open/reminder',
    interactionId: 'interaction/123.abc-xyz',
  });
  await service.abortTaskMutation(accepted);

  const sanitized = await service.beginTaskMutation({
    action: 'task.update',
    cause: {
      kind: 'user',
      sourcePluginId: 'tps-controller',
      surface: 'reminder-modal',
      commandId: 'https://command.private.example/open',
      interactionId: 'customer secret payload',
    },
    before: { path: fixture.file.path, lineNumber: 0, rawLine: before },
  });
  assert.deepEqual(sanitized.cause, {
    kind: 'user',
    sourcePluginId: 'tps-controller',
    surface: 'reminder-modal',
  });
  assert.doesNotMatch(JSON.stringify([...store.pending.values()]), /command\.private\.example|customer secret/u);
  await service.abortTaskMutation(sanitized);
});

test('history is explicit-user-only, fail-open, abortable, and clearable', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  const fixture = createPlugin();
  const store = new MemoryItemHistoryStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  const before = '- [ ] Task';

  assert.equal(await service.beginTaskMutation({
    action: 'task.update',
    before: { path: fixture.file.path, lineNumber: 0, rawLine: before },
  }), null, 'background/API calls without an explicit user cause must not be journaled');

  const handle = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: before },
  });
  assert.ok(handle);
  await service.abortTaskMutation(handle);
  assert.deepEqual(await service.stats(), { events: 0, entities: 0, pending: 0 });

  fixture.plugin.settings.enableItemHistory = false;
  assert.equal(await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: before },
  }), null);
  await service.clear();
  assert.deepEqual(await service.stats(), { events: 0, entities: 0, pending: 0 });
});

test('memory store pruning enforces age, global, per-item, and pending bounds', async () => {
  const { MemoryItemHistoryStore } = await loadStoreModule();
  const store = new MemoryItemHistoryStore();
  const now = Date.now();
  for (let index = 0; index < 7; index += 1) {
    store.events.set(`event_${index}`, {
      schemaVersion: 1,
      eventId: `event_${index}`,
      operationId: `event_${index}`,
      entityId: index < 5 ? 'item_a' : 'item_b',
      entityKind: 'task',
      action: 'task.update',
      occurredAt: now - index * 100,
      committedAt: now - index * 100,
      cause,
      changes: [],
      locatorBefore: { path: 'Inbox.md', lineNumber: index },
      outcome: 'committed',
    });
  }
  store.pending.set('old', {
    schemaVersion: 1,
    operationId: 'old',
    entityId: 'item_old',
    entityKind: 'task',
    action: 'task.update',
    cause,
    locatorBefore: { path: 'Inbox.md', lineNumber: 0 },
    before: { checkbox: ' ', fields: {}, tags: [] },
    startedAt: now - 10_000,
  });
  await store.prune({ minOccurredAt: now - 1_000, maxEntries: 4, maxPerEntity: 2, pendingBefore: now - 1_000 });
  assert.equal(store.events.size, 4);
  assert.equal([...store.events.values()].filter((event) => event.entityId === 'item_a').length, 2);
  assert.equal(store.pending.size, 0);
});

test('memory store commits are immutable and idempotent while preserving a conflicting pending intent', async () => {
  const { MemoryItemHistoryStore } = await loadStoreModule();
  const store = new MemoryItemHistoryStore();
  const pending = {
    schemaVersion: 1,
    operationId: 'op_immutable',
    entityId: 'item_immutable',
    entityKind: 'task',
    action: 'task.update',
    cause,
    locatorBefore: { path: 'Inbox.md', lineNumber: 2 },
    before: { checkbox: '[ ]', fields: { status: 'open' }, tags: [] },
    startedAt: 100,
  };
  const event = {
    schemaVersion: 1,
    eventId: pending.operationId,
    operationId: pending.operationId,
    entityId: pending.entityId,
    entityKind: 'task',
    action: pending.action,
    occurredAt: pending.startedAt,
    committedAt: 200,
    cause,
    changes: [{
      field: 'status',
      before: { state: 'value', value: 'open' },
      after: { state: 'value', value: 'done' },
    }],
    locatorBefore: pending.locatorBefore,
    locatorAfter: pending.locatorBefore,
    outcome: 'committed',
  };
  const entity = {
    entityId: pending.entityId,
    entityKind: 'task',
    currentLocator: pending.locatorBefore,
    lastSeenAt: 200,
  };

  await store.putPending(pending);
  const readPending = await store.getPending(pending.operationId);
  assert.deepEqual(readPending, pending);
  readPending.before.fields.status = 'mutated-copy';
  assert.equal((await store.getPending(pending.operationId)).before.fields.status, 'open');
  assert.equal(await store.commit(pending.operationId, event, entity), 'committed');
  assert.equal(store.events.size, 1);
  assert.equal(store.pending.size, 0);
  assert.equal(await store.getPending(pending.operationId), null);

  await store.putPending(pending);
  const reorderedEvent = {
    outcome: event.outcome,
    locatorAfter: event.locatorAfter,
    locatorBefore: event.locatorBefore,
    changes: event.changes,
    cause: event.cause,
    committedAt: event.committedAt,
    occurredAt: event.occurredAt,
    action: event.action,
    entityKind: event.entityKind,
    entityId: event.entityId,
    operationId: event.operationId,
    eventId: event.eventId,
    schemaVersion: event.schemaVersion,
  };
  assert.equal(await store.commit(pending.operationId, reorderedEvent, entity), 'idempotent');
  assert.equal(store.events.size, 1, 'an identical retry must not duplicate or overwrite the event');
  assert.equal(store.pending.size, 0, 'an identical retry still resolves the pending intent');

  await store.putPending(pending);
  await assert.rejects(
    store.commit(pending.operationId, { ...event, outcome: 'partial' }, entity),
    /already exists with different content/u,
  );
  assert.equal(store.events.get(event.eventId).outcome, 'committed');
  assert.equal(store.pending.size, 1, 'a conflicting retry must leave crash evidence intact');

  const missingStore = new MemoryItemHistoryStore();
  assert.equal(
    await missingStore.commit(pending.operationId, event, entity),
    'missing-pending',
  );
  assert.deepEqual(await missingStore.stats(), { events: 0, entities: 0, pending: 0 });

  const mismatchedStore = new MemoryItemHistoryStore();
  await mismatchedStore.putPending({ ...pending, action: 'task.delete' });
  await assert.rejects(
    mismatchedStore.commit(pending.operationId, event, entity),
    /does not match the event/u,
  );
  assert.deepEqual(await mismatchedStore.stats(), { events: 0, entities: 0, pending: 1 });
});

test('IndexedDB commit and prune enqueue dependent writes only in active request callbacks', () => {
  const indexedClassStart = itemHistoryStoreSource.indexOf('export class IndexedDbItemHistoryStore');
  const memoryClassStart = itemHistoryStoreSource.indexOf('export class MemoryItemHistoryStore');
  const indexedClass = itemHistoryStoreSource.slice(indexedClassStart, memoryClassStart);
  const commitStart = indexedClass.indexOf('  async commit(');
  const queryStart = indexedClass.indexOf('  async query(', commitStart);
  const pruneStart = indexedClass.indexOf('  async prune(', queryStart);
  const statsStart = indexedClass.indexOf('  async stats(', pruneStart);
  const commitSource = indexedClass.slice(commitStart, queryStart);
  const pruneSource = indexedClass.slice(pruneStart, statsStart);

  assert.doesNotMatch(commitSource, /await\s+(?:requestResult|transactionDone|Promise\.all)/u);
  assert.match(commitSource, /eventRequest\.onsuccess\s*=\s*\(\)\s*=>/u);
  assert.match(commitSource, /pendingRequest\.onsuccess\s*=\s*\(\)\s*=>/u);
  assert.match(commitSource, /pendingStore\.delete\(operationId\)/u);
  assert.doesNotMatch(pruneSource, /await\s+(?:requestResult|transactionDone|Promise\.all)/u);
  assert.match(pruneSource, /openCursor\(null, 'prev'\)/u);
  assert.match(pruneSource, /request\.onsuccess\s*=\s*\(\)\s*=>/u);
  assert.match(pruneSource, /cursor\.delete\(\)/u);
});

test('store-level pruning enforces the non-configurable 365-day, 25k, 200-item, and 24-hour ceilings', async () => {
  const { MemoryItemHistoryStore } = await loadStoreModule();
  const now = Date.now();
  const makeEvent = (eventId, entityId, occurredAt) => ({
    schemaVersion: 1,
    eventId,
    operationId: eventId,
    entityId,
    entityKind: 'task',
    action: 'task.update',
    occurredAt,
    committedAt: occurredAt,
    cause,
    changes: [],
    locatorBefore: { path: 'Inbox.md', lineNumber: 0 },
    outcome: 'committed',
  });

  const globalStore = new MemoryItemHistoryStore();
  for (let index = 0; index < 25_001; index += 1) {
    globalStore.events.set(
      `event_global_${index}`,
      makeEvent(`event_global_${index}`, `item_global_${index}`, now - index),
    );
  }
  globalStore.events.set('event_too_old', makeEvent(
    'event_too_old',
    'item_too_old',
    now - 366 * 86_400_000,
  ));
  globalStore.pending.set('pending_recent', {
    schemaVersion: 1,
    operationId: 'pending_recent',
    entityId: 'item_recent',
    entityKind: 'task',
    action: 'task.update',
    cause,
    locatorBefore: { path: 'Inbox.md', lineNumber: 0 },
    before: { checkbox: '[ ]', fields: {}, tags: [] },
    startedAt: now,
  });
  globalStore.pending.set('pending_too_old', {
    ...globalStore.pending.get('pending_recent'),
    operationId: 'pending_too_old',
    startedAt: now - 25 * 60 * 60_000,
  });
  await globalStore.prune({
    minOccurredAt: 0,
    maxEntries: 100_000,
    maxPerEntity: 100_000,
    pendingBefore: 0,
  });
  assert.equal(globalStore.events.size, 25_000);
  assert.equal(globalStore.events.has('event_too_old'), false);
  assert.deepEqual([...globalStore.pending.keys()], ['pending_recent']);

  const entityStore = new MemoryItemHistoryStore();
  for (let index = 0; index < 201; index += 1) {
    entityStore.events.set(
      `event_entity_${index}`,
      makeEvent(`event_entity_${index}`, 'item_one', now - index),
    );
  }
  await entityStore.prune({
    minOccurredAt: 0,
    maxEntries: 100_000,
    maxPerEntity: 100_000,
    pendingBefore: 0,
  });
  assert.equal(entityStore.events.size, 200);
});

test('successful commits schedule bounded pruning without adding prune latency to the mutation', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  class TrackingStore extends MemoryItemHistoryStore {
    pruneCalls = [];
    async prune(options) {
      this.pruneCalls.push({ ...options });
      await super.prune(options);
    }
  }
  const fixture = createPlugin();
  fixture.plugin.settings.itemHistoryRetentionDays = 10_000;
  fixture.plugin.settings.itemHistoryMaxEntries = 100_000;
  const store = new TrackingStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  const handle = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: '- [ ] Task [status:: open]' },
  });
  const after = service.ensureTaskIdentity(handle, '- [ ] Task [status:: done]');
  await service.commitTaskMutation(handle, {
    after: { path: fixture.file.path, lineNumber: 0, rawLine: after },
  });
  assert.equal(store.events.size, 1, 'the event commit completes before background maintenance');

  await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
  assert.equal(store.pruneCalls.length, 1);
  const [options] = store.pruneCalls;
  assert.equal(options.maxEntries, 25_000);
  assert.equal(options.maxPerEntity, 200);
  assert.ok(options.minOccurredAt >= Date.now() - 365 * 86_400_000 - 100);
  assert.ok(options.pendingBefore >= Date.now() - 86_400_000 - 100);
});

test('startup reconciliation commits strong create evidence, aborts unchanged work, and retains uncertainty', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);

  const createdFixture = createPlugin();
  const createdStore = new MemoryItemHistoryStore();
  const firstCreateService = new ItemHistoryService(createdFixture.plugin, createdStore);
  const createHandle = await firstCreateService.beginTaskMutation({
    action: 'task.create',
    cause,
    before: { path: createdFixture.file.path, lineNumber: 0, rawLine: '- [ ] Private created title' },
  });
  createdFixture.setContent(firstCreateService.ensureTaskIdentity(
    createHandle,
    '- [ ] Private created title',
  ));
  const recoveredCreateService = new ItemHistoryService(createdFixture.plugin, createdStore);
  await recoveredCreateService.setup();
  assert.deepEqual(await recoveredCreateService.stats(), { events: 1, entities: 1, pending: 0 });
  assert.doesNotMatch(JSON.stringify([...createdStore.events.values()]), /Private created title/u);

  const generatedUpdateFixture = createPlugin();
  const generatedUpdateStore = new MemoryItemHistoryStore();
  const firstGeneratedUpdateService = new ItemHistoryService(
    generatedUpdateFixture.plugin,
    generatedUpdateStore,
  );
  const generatedUpdateHandle = await firstGeneratedUpdateService.beginTaskMutation({
    action: 'task.update',
    cause,
    before: {
      path: generatedUpdateFixture.file.path,
      lineNumber: 0,
      rawLine: '- [ ] Private updated title [status:: open]',
    },
  });
  generatedUpdateFixture.setContent(firstGeneratedUpdateService.ensureTaskIdentity(
    generatedUpdateHandle,
    '- [ ] Private updated title [status:: done]',
  ));
  const recoveredGeneratedUpdateService = new ItemHistoryService(
    generatedUpdateFixture.plugin,
    generatedUpdateStore,
  );
  await recoveredGeneratedUpdateService.setup();
  assert.deepEqual(
    await recoveredGeneratedUpdateService.stats(),
    { events: 1, entities: 1, pending: 0 },
  );
  const [generatedUpdateEvent] = [...generatedUpdateStore.events.values()];
  assert.equal(generatedUpdateEvent.action, 'task.update');
  assert.equal(generatedUpdateEvent.sourceDisposition, 'retained');
  assert.doesNotMatch(JSON.stringify(generatedUpdateEvent), /Private updated title/u);

  const collidingCreateFixture = createPlugin();
  const collidingCreateLine = '- [ ] Existing private title [tpsId:: item_existing_create]';
  collidingCreateFixture.setContent(collidingCreateLine);
  const collidingCreateStore = new MemoryItemHistoryStore();
  const firstCollidingCreateService = new ItemHistoryService(
    collidingCreateFixture.plugin,
    collidingCreateStore,
  );
  await firstCollidingCreateService.beginTaskMutation({
    action: 'task.create',
    cause,
    before: {
      path: collidingCreateFixture.file.path,
      lineNumber: 0,
      rawLine: collidingCreateLine,
    },
  });
  const recoveredCollidingCreateService = new ItemHistoryService(
    collidingCreateFixture.plugin,
    collidingCreateStore,
  );
  await recoveredCollidingCreateService.setup();
  assert.deepEqual(
    await recoveredCollidingCreateService.stats(),
    { events: 0, entities: 0, pending: 1 },
    'a pre-existing identity is not proof that a create write happened',
  );

  const abortedFixture = createPlugin();
  const unchangedLine = '- [ ] Unchanged private title [tpsId:: item_unchanged] [status:: open]';
  abortedFixture.setContent(unchangedLine);
  const abortedStore = new MemoryItemHistoryStore();
  const firstAbortedService = new ItemHistoryService(abortedFixture.plugin, abortedStore);
  await firstAbortedService.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: abortedFixture.file.path, lineNumber: 0, rawLine: unchangedLine },
  });
  const recoveredAbortedService = new ItemHistoryService(abortedFixture.plugin, abortedStore);
  await recoveredAbortedService.setup();
  assert.deepEqual(await recoveredAbortedService.stats(), { events: 0, entities: 0, pending: 0 });

  const uncertainFixture = createPlugin();
  const uncertainBefore = '- [ ] Uncertain private title [tpsId:: item_uncertain] [priority:: high]';
  uncertainFixture.setContent(uncertainBefore);
  const uncertainStore = new MemoryItemHistoryStore();
  const firstUncertainService = new ItemHistoryService(uncertainFixture.plugin, uncertainStore);
  await firstUncertainService.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: uncertainFixture.file.path, lineNumber: 0, rawLine: uncertainBefore },
  });
  uncertainFixture.setContent('- [ ] Uncertain private title [tpsId:: item_uncertain] [priority:: low]');
  const recoveredUncertainService = new ItemHistoryService(uncertainFixture.plugin, uncertainStore);
  await recoveredUncertainService.setup();
  assert.deepEqual(await recoveredUncertainService.stats(), { events: 0, entities: 0, pending: 1 });
  assert.doesNotMatch(JSON.stringify([...uncertainStore.pending.values()]), /Uncertain private title/u);

  const changedCreateFixture = createPlugin();
  const changedCreateStore = new MemoryItemHistoryStore();
  const firstChangedCreateService = new ItemHistoryService(changedCreateFixture.plugin, changedCreateStore);
  const changedCreateHandle = await firstChangedCreateService.beginTaskMutation({
    action: 'task.create',
    cause,
    before: {
      path: changedCreateFixture.file.path,
      lineNumber: 0,
      rawLine: '- [ ] Private created title [status:: open]',
    },
  });
  changedCreateFixture.setContent(firstChangedCreateService.ensureTaskIdentity(
    changedCreateHandle,
    '- [ ] Private created title [status:: done]',
  ));
  const recoveredChangedCreateService = new ItemHistoryService(
    changedCreateFixture.plugin,
    changedCreateStore,
  );
  await recoveredChangedCreateService.setup();
  assert.deepEqual(
    await recoveredChangedCreateService.stats(),
    { events: 0, entities: 0, pending: 1 },
    'a post-create state change cannot be back-attributed to the creation event',
  );
});

test('startup reconciliation keeps missing-source moves and conflicting dual identities uncertain', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);

  const moveFixture = createPlugin();
  const sourcePath = 'Daily/2026-08-14.md';
  const targetPath = 'Projects/Alpha.md';
  const sourceFile = { path: sourcePath };
  const targetFile = { path: targetPath };
  const files = new Map([[sourcePath, sourceFile], [targetPath, targetFile]]);
  const contents = new Map([
    [sourcePath, '- [ ] Private moved title [tpsId:: item_missing_source]'],
    [targetPath, ''],
  ]);
  moveFixture.plugin.app.vault.getFileByPath = (path) => files.get(path) ?? null;
  moveFixture.plugin.app.vault.cachedRead = async (file) => contents.get(file.path) ?? '';
  const moveStore = new MemoryItemHistoryStore();
  const firstMoveService = new ItemHistoryService(moveFixture.plugin, moveStore);
  await firstMoveService.beginTaskMutation({
    action: 'task.move',
    cause,
    before: {
      path: sourcePath,
      lineNumber: 0,
      rawLine: contents.get(sourcePath),
    },
    targetPath,
  });
  contents.set(targetPath, contents.get(sourcePath));
  files.delete(sourcePath);
  contents.delete(sourcePath);

  const recoveredMoveService = new ItemHistoryService(moveFixture.plugin, moveStore);
  await recoveredMoveService.setup();
  assert.deepEqual(
    await recoveredMoveService.stats(),
    { events: 0, entities: 0, pending: 1 },
    'a renamed, deleted, or unavailable source file is not proof of a committed move',
  );

  const generatedMoveFixture = createPlugin();
  const generatedFiles = new Map([[sourcePath, sourceFile], [targetPath, targetFile]]);
  const generatedContents = new Map([
    [sourcePath, '- [ ] Private generated-ID move'],
    [targetPath, ''],
  ]);
  generatedMoveFixture.plugin.app.vault.getFileByPath = (path) => generatedFiles.get(path) ?? null;
  generatedMoveFixture.plugin.app.vault.cachedRead = async (file) => generatedContents.get(file.path) ?? '';
  const generatedMoveStore = new MemoryItemHistoryStore();
  const firstGeneratedMoveService = new ItemHistoryService(
    generatedMoveFixture.plugin,
    generatedMoveStore,
  );
  const generatedMoveHandle = await firstGeneratedMoveService.beginTaskMutation({
    action: 'task.move',
    cause,
    before: {
      path: sourcePath,
      lineNumber: 0,
      rawLine: generatedContents.get(sourcePath),
    },
    targetPath,
  });
  generatedContents.set(
    targetPath,
    firstGeneratedMoveService.ensureTaskIdentity(
      generatedMoveHandle,
      generatedContents.get(sourcePath),
    ),
  );
  const recoveredGeneratedMoveService = new ItemHistoryService(
    generatedMoveFixture.plugin,
    generatedMoveStore,
  );
  await recoveredGeneratedMoveService.setup();
  assert.deepEqual(
    await recoveredGeneratedMoveService.stats(),
    { events: 0, entities: 0, pending: 1 },
    'a generated ID in the target cannot prove that the still-unidentified source was removed',
  );

  const identityFixture = createPlugin();
  const identityBefore = '- [ ] Private identity title [tpsId:: item_expected] [status:: open]';
  identityFixture.setContent(identityBefore);
  const identityStore = new MemoryItemHistoryStore();
  const firstIdentityService = new ItemHistoryService(identityFixture.plugin, identityStore);
  await firstIdentityService.beginTaskMutation({
    action: 'task.update',
    cause,
    before: {
      path: identityFixture.file.path,
      lineNumber: 0,
      rawLine: identityBefore,
    },
  });
  identityFixture.setContent(
    '- [ ] Private identity title [tpsId:: item_expected] [subitemId:: item_conflict] [status:: done]',
  );

  const recoveredIdentityService = new ItemHistoryService(identityFixture.plugin, identityStore);
  await recoveredIdentityService.setup();
  assert.deepEqual(
    await recoveredIdentityService.stats(),
    { events: 0, entities: 0, pending: 1 },
    'conflicting live identity fields cannot authorize a recovered event',
  );
});

test('disable, re-enable, and clear invalidate stale handles while re-running local maintenance', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  class LifecycleStore extends MemoryItemHistoryStore {
    clearPendingCalls = 0;
    pruneCalls = 0;
    async clearPending() {
      this.clearPendingCalls += 1;
      await super.clearPending();
    }
    async prune(options) {
      this.pruneCalls += 1;
      await super.prune(options);
    }
  }
  const fixture = createPlugin();
  const store = new LifecycleStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  await service.setup();

  const staleHandle = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: '- [ ] Stale private title' },
  });
  assert.equal(store.pending.size, 1);

  fixture.plugin.settings.enableItemHistory = false;
  service.updateEnabled(false);
  fixture.plugin.settings.enableItemHistory = true;
  service.updateEnabled(true);
  const freshHandle = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: '- [ ] Fresh private title' },
  });
  assert.ok(freshHandle);
  assert.equal(store.clearPendingCalls, 1);
  assert.ok(store.pruneCalls >= 2, 're-enable performs startup pruning after pending invalidation');
  assert.deepEqual([...store.pending.keys()], [freshHandle.operationId]);

  await service.commitTaskMutation(staleHandle, {
    after: {
      path: fixture.file.path,
      lineNumber: 0,
      rawLine: service.ensureTaskIdentity(staleHandle, '- [ ] Stale private title [status:: done]'),
    },
  });
  assert.equal(store.events.size, 0, 'a pre-toggle handle cannot repopulate cleared history');

  const freshAfter = service.ensureTaskIdentity(
    freshHandle,
    '- [ ] Fresh private title [status:: done]',
  );
  await service.commitTaskMutation(freshHandle, {
    after: { path: fixture.file.path, lineNumber: 0, rawLine: freshAfter },
  });
  assert.equal(store.events.size, 1);

  const clearStaleHandle = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: '- [ ] Clear private title' },
  });
  await service.clear();
  await service.commitTaskMutation(clearStaleHandle, {
    after: {
      path: fixture.file.path,
      lineNumber: 0,
      rawLine: service.ensureTaskIdentity(
        clearStaleHandle,
        '- [ ] Clear private title [priority:: high]',
      ),
    },
  });
  assert.deepEqual(await service.stats(), { events: 0, entities: 0, pending: 0 });
});

test('a disable racing an older clear keeps the newer pending-invalidation marker', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  class DeferredClearStore extends MemoryItemHistoryStore {
    clearEntered = null;
    releaseClear = null;
    async clear() {
      await new Promise((resolve) => {
        this.clearEntered = () => undefined;
        this.releaseClear = resolve;
        this.clearEntered();
      });
      await super.clear();
    }
  }
  const fixture = createPlugin();
  const store = new DeferredClearStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  await service.setup();

  const clearStarted = new Promise((resolve) => {
    Object.defineProperty(store, 'clearEntered', {
      configurable: true,
      set(callback) {
        Object.defineProperty(store, 'clearEntered', { value: callback, writable: true });
        resolve();
      },
      get() { return null; },
    });
  });
  const clearing = service.clear();
  await clearStarted;
  fixture.plugin.settings.enableItemHistory = false;
  service.updateEnabled(false);
  store.releaseClear();
  await clearing;

  assert.equal(
    fixture.localStorage.get('tps-global-context-menu:item-history:discard-pending-on-enable'),
    true,
  );
});

test('a transient history-store setup failure is retried in the same plugin session', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  class FailOnceStore extends MemoryItemHistoryStore {
    setupCalls = 0;
    async setup() {
      this.setupCalls += 1;
      if (this.setupCalls === 1) throw new Error('synthetic transient setup failure');
    }
  }
  const fixture = createPlugin();
  const store = new FailOnceStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  const input = {
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: '- [ ] Retry setup' },
  };

  assert.equal(await service.beginTaskMutation(input), null);
  const retry = await service.beginTaskMutation(input);
  assert.ok(retry);
  assert.equal(store.setupCalls, 2);
  await service.abortTaskMutation(retry);
});

test('a failed clear remains durable and retries before history can be read again', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  class FailOnceClearStore extends MemoryItemHistoryStore {
    clearCalls = 0;
    async clear() {
      this.clearCalls += 1;
      if (this.clearCalls === 1) throw new Error('synthetic transient clear failure');
      await super.clear();
    }
  }
  const fixture = createPlugin();
  const store = new FailOnceClearStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  await service.setup();
  const now = Date.now();
  store.events.set('retained_before_clear', {
    schemaVersion: 1,
    eventId: 'retained_before_clear',
    operationId: 'retained_before_clear',
    entityId: 'item_retained_before_clear',
    entityKind: 'task',
    action: 'task.update',
    occurredAt: now,
    committedAt: now,
    cause,
    changes: [],
    locatorBefore: { path: fixture.file.path, lineNumber: 0 },
    outcome: 'committed',
  });

  await service.clear();
  assert.equal(store.events.size, 1, 'a transient failure leaves the durable clear request pending');
  assert.equal(
    fixture.localStorage.get('tps-global-context-menu:item-history:clear-all-on-setup'),
    true,
  );

  assert.deepEqual(await service.stats(), { events: 0, entities: 0, pending: 0 });
  assert.equal(store.clearCalls, 2, 'the next history access retries the complete clear');
  assert.equal(
    fixture.localStorage.has('tps-global-context-menu:item-history:clear-all-on-setup'),
    false,
  );
  assert.equal(
    fixture.localStorage.has('tps-global-context-menu:item-history:discard-pending-on-enable'),
    false,
  );
});

test('a clear whose first store setup fails is completed by the next successful setup', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  class FailOnceSetupStore extends MemoryItemHistoryStore {
    setupCalls = 0;
    async setup() {
      this.setupCalls += 1;
      if (this.setupCalls === 1) throw new Error('synthetic transient setup failure during clear');
    }
  }
  const fixture = createPlugin();
  const store = new FailOnceSetupStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  const now = Date.now();
  store.events.set('retained_before_setup', {
    schemaVersion: 1,
    eventId: 'retained_before_setup',
    operationId: 'retained_before_setup',
    entityId: 'item_retained_before_setup',
    entityKind: 'task',
    action: 'task.update',
    occurredAt: now,
    committedAt: now,
    cause,
    changes: [],
    locatorBefore: { path: fixture.file.path, lineNumber: 0 },
    outcome: 'committed',
  });

  await service.clear();
  assert.equal(store.events.size, 1);
  assert.equal(
    fixture.localStorage.get('tps-global-context-menu:item-history:clear-all-on-setup'),
    true,
  );
  await service.setup();
  assert.deepEqual(await service.stats(), { events: 0, entities: 0, pending: 0 });
  assert.equal(store.setupCalls, 2);
  assert.equal(
    fixture.localStorage.has('tps-global-context-menu:item-history:clear-all-on-setup'),
    false,
  );
});

test('disable races cannot resume a stale commit or startup recovery through a read-only reopen', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  class DeferredStore extends MemoryItemHistoryStore {
    pausePendingRead = false;
    pausePendingList = false;
    pendingReadEntered = null;
    pendingListEntered = null;
    releasePendingRead = null;
    releasePendingList = null;

    async getPending(operationId) {
      if (this.pausePendingRead) {
        this.pausePendingRead = false;
        await new Promise((resolve) => {
          this.releasePendingRead = resolve;
          this.pendingReadEntered?.();
        });
      }
      return super.getPending(operationId);
    }

    async listPending() {
      if (this.pausePendingList) {
        this.pausePendingList = false;
        await new Promise((resolve) => {
          this.releasePendingList = resolve;
          this.pendingListEntered?.();
        });
      }
      return super.listPending();
    }
  }

  const fixture = createPlugin();
  const store = new DeferredStore();
  const service = new ItemHistoryService(fixture.plugin, store);
  const handle = await service.beginTaskMutation({
    action: 'task.update',
    cause,
    before: { path: fixture.file.path, lineNumber: 0, rawLine: '- [ ] Private race title' },
  });
  const after = service.ensureTaskIdentity(handle, '- [ ] Private race title [status:: done]');
  const pendingReadEntered = new Promise((resolve) => { store.pendingReadEntered = resolve; });
  store.pausePendingRead = true;
  const commit = service.commitTaskMutation(handle, {
    after: { path: fixture.file.path, lineNumber: 0, rawLine: after },
  });
  await pendingReadEntered;
  fixture.plugin.settings.enableItemHistory = false;
  service.updateEnabled(false);
  await service.stats();
  store.releasePendingRead();
  await commit;
  assert.deepEqual(await store.stats(), { events: 0, entities: 0, pending: 0 });

  const recoveryFixture = createPlugin();
  const recoveryStore = new DeferredStore();
  const firstRecoveryService = new ItemHistoryService(recoveryFixture.plugin, recoveryStore);
  const recoveryHandle = await firstRecoveryService.beginTaskMutation({
    action: 'task.create',
    cause,
    before: { path: recoveryFixture.file.path, lineNumber: 0, rawLine: '- [ ] Private recovery title' },
  });
  recoveryFixture.setContent(firstRecoveryService.ensureTaskIdentity(
    recoveryHandle,
    '- [ ] Private recovery title',
  ));
  const recoveringService = new ItemHistoryService(recoveryFixture.plugin, recoveryStore);
  const pendingListEntered = new Promise((resolve) => { recoveryStore.pendingListEntered = resolve; });
  recoveryStore.pausePendingList = true;
  const setup = recoveringService.setup();
  await pendingListEntered;
  recoveryFixture.plugin.settings.enableItemHistory = false;
  recoveringService.updateEnabled(false);
  recoveryStore.releasePendingList();
  await setup;
  assert.equal(recoveryStore.events.size, 0, 'disable during recovery cannot fabricate a committed event');
});

test('disabled startup clears pending intent and still enforces retained-history bounds', async () => {
  const [{ ItemHistoryService }, { MemoryItemHistoryStore }] = await Promise.all([loadModule(), loadStoreModule()]);
  const fixture = createPlugin();
  fixture.plugin.settings.enableItemHistory = false;
  fixture.plugin.settings.itemHistoryRetentionDays = 1;
  const store = new MemoryItemHistoryStore();
  const now = Date.now();
  const makeEvent = (eventId, occurredAt) => ({
    schemaVersion: 1,
    eventId,
    operationId: eventId,
    entityId: 'item_retained',
    entityKind: 'task',
    action: 'task.update',
    occurredAt,
    committedAt: occurredAt,
    cause,
    changes: [],
    locatorBefore: { path: 'Inbox.md', lineNumber: 0 },
    outcome: 'committed',
  });
  store.events.set('old', makeEvent('old', now - 2 * 86_400_000));
  store.events.set('current', makeEvent('current', now));
  store.pending.set('disabled_pending', {
    schemaVersion: 1,
    operationId: 'disabled_pending',
    entityId: 'item_pending',
    entityKind: 'task',
    action: 'task.update',
    cause,
    locatorBefore: { path: 'Inbox.md', lineNumber: 0 },
    before: { checkbox: '[ ]', fields: {}, tags: [] },
    startedAt: now,
  });

  const service = new ItemHistoryService(fixture.plugin, store);
  await service.setup();
  assert.deepEqual([...store.events.keys()], ['current']);
  assert.equal(store.pending.size, 0);
  assert.equal((await service.query('item_retained')).length, 1);
});

test('history namespaces stay stable and distinct for same-named mobile vaults', async () => {
  const { createVaultHistoryNamespace } = await loadModule();
  const storageKey = 'tps-global-context-menu:item-history:vault-id';
  const createMobilePlugin = (appId, vaultId) => {
    const storage = new Map([[storageKey, vaultId]]);
    return {
      manifest: { id: 'tps-global-context-menu' },
      app: {
        appId,
        loadLocalStorage: (key) => storage.get(key) ?? null,
        saveLocalStorage: (key, value) => storage.set(key, value),
        vault: {
          adapter: {},
          getName: () => 'Same Vault Name',
        },
      },
    };
  };
  const firstPlugin = createMobilePlugin('mobile-app-alpha', 'vault_alpha');
  const secondPlugin = createMobilePlugin('mobile-app-beta', 'vault_beta');
  const first = await createVaultHistoryNamespace(firstPlugin);
  const firstAgain = await createVaultHistoryNamespace(firstPlugin);
  const second = await createVaultHistoryNamespace(secondPlugin);

  assert.equal(firstAgain, first);
  assert.notEqual(second, first);
  assert.match(first, /^tps-global-context-menu-item-history-[a-f0-9]{8,32}$/u);
  assert.doesNotMatch(first, /Same Vault Name|mobile-app|vault_alpha/u);
});

test('a pinned history namespace survives a vault folder move and rename', async () => {
  const { createVaultHistoryNamespace } = await loadModule();
  const storage = new Map([
    ['tps-global-context-menu:item-history:vault-id', 'vault_stable_identity'],
  ]);
  let basePath = '/vaults/Before';
  let vaultName = 'Before';
  const plugin = {
    manifest: { id: 'tps-global-context-menu' },
    app: {
      appId: 'stable-app-id',
      loadLocalStorage: (key) => storage.get(key) ?? null,
      saveLocalStorage: (key, value) => {
        if (value == null) storage.delete(key);
        else storage.set(key, value);
      },
      vault: {
        adapter: { getBasePath: () => basePath },
        getName: () => vaultName,
      },
    },
  };

  const before = await createVaultHistoryNamespace(plugin);
  assert.equal(
    storage.get('tps-global-context-menu:item-history:database-namespace'),
    before,
    'the legacy-compatible database name is pinned on first resolution',
  );
  basePath = '/renamed/Vault After';
  vaultName = 'Vault After';
  const after = await createVaultHistoryNamespace(plugin);

  assert.equal(after, before);
});
